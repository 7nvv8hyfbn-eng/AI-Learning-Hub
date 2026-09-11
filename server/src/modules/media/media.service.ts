import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common'
import { Prisma } from '@prisma/client'
import { randomUUID } from 'node:crypto'
import { publicPageVisualKeys, type MediaContentType, type PublicPageVisualSetting } from '@ai-learning-hub/contracts'
import { PrismaService } from '../../prisma/prisma.service'
import { lockFileReferences } from '../../common/persistence'
import { STORAGE_SERVICE, type StorageService, type UploadedFile } from '../storage/storage.types'
import type { AuthUser } from '../auth/auth.types'
import { inspectMediaImage } from './image-validation'
import { MediaResolverService, mediaObject } from './media-resolver.service'
import { mediaTypes, type MediaDefaultDto, type MediaQueryDto, type MediaUpdateDto, type MediaUploadDto } from './media.dto'
import { mediaUsage, unusedMediaIds } from './media-usage'
import { releaseUnboundMediaFile } from './media-gc'

@Injectable()
export class MediaService {
  constructor(private readonly prisma: PrismaService, private readonly resolver: MediaResolverService, @Inject(STORAGE_SERVICE) private readonly storage: StorageService) {}
  private present(asset: Awaited<ReturnType<MediaService['record']>>) {
    const { file, ...rest } = asset
    return { ...rest, url: `/api/v1/admin/media-assets/${asset.id}/preview`, publicUrl: asset.status === 'active' && !asset.deletedAt && file.visibility === 'public' ? this.resolver.present(asset, 'explicit').url : null, file: { id: file.id, mimeType: file.mimeType, size: file.size, checksum: file.checksum } }
  }
  async record(id: string) {
    const asset = await this.prisma.mediaAsset.findFirst({ where: { id }, include: { file: true } })
    if (!asset) throw new NotFoundException('素材不存在')
    return asset
  }
  async detail(id: string) { return this.present(await this.record(id)) }
  async pinnedFile(assetId: string, fileId: string, publicOnly: boolean) {
    if (typeof fileId !== 'string' || !fileId || fileId.length > 80) throw new NotFoundException('课程图片不存在')
    const published = await this.prisma.courseVersion.count({ where: {
      snapshot: { path: ['mediaFiles'], array_contains: [{ assetId, fileId }] },
      ...(publicOnly ? { course: { status: 'published', deletedAt: null } } : {}),
    } })
    const draft = !publicOnly && (await this.prisma.mediaAsset.count({ where: { id: assetId, fileId } }) || await this.prisma.lessonBlock.count({ where: {
      blockType: 'image', AND: [{ content: { path: ['assetId'], equals: assetId } }, { content: { path: ['fileId'], equals: fileId } }],
    } }))
    if (!published && !draft) throw new NotFoundException('课程图片不存在')
    const file = await this.prisma.fileRecord.findFirst({ where: { id: fileId, visibility: 'public', quarantinedAt: null, mimeType: { startsWith: 'image/' } } })
    if (!file) throw new NotFoundException('课程图片不可读取')
    return file
  }
  async list(query: MediaQueryDto) {
    const where: Prisma.MediaAssetWhereInput = {
      deletedAt: null, ...(query.status ? { status: query.status } : {}),
      ...(query.kind ? { kind: query.kind } : {}), ...(query.source ? { source: query.source } : {}),
      ...(query.contentType ? { contentType: query.contentType } : {}), ...(query.categoryKey ? { categoryKey: query.categoryKey } : {}),
      ...(query.keyword ? { OR: [{ name: { contains: query.keyword, mode: 'insensitive' } }, { assetKey: { contains: query.keyword, mode: 'insensitive' } }] } : {}),
    }
    if (query.onlyUnused) {
      const candidates = await this.prisma.mediaAsset.findMany({ where, select: { id: true } })
      where.id = { in: await unusedMediaIds(this.prisma, candidates.map((candidate) => candidate.id)) }
    }
    const [items, total] = await this.prisma.$transaction([
      this.prisma.mediaAsset.findMany({ where, include: { file: true }, orderBy: [{ createdAt: 'desc' }, { id: 'asc' }], skip: (query.page - 1) * query.pageSize, take: query.pageSize }),
      this.prisma.mediaAsset.count({ where }),
    ])
    return { items: items.map((asset) => this.present(asset)), total, page: query.page, pageSize: query.pageSize }
  }
  async upload(file: UploadedFile, input: MediaUploadDto, actor: AuthUser) {
    const trustedSvg = actor.roles.some((role) => ['admin', 'super_admin'].includes(role))
    const dimensions = await inspectMediaImage(file, trustedSvg)
    const stored = await this.storage.upload(file, { uploadedBy: actor.id, visibility: 'public', catalogMedia: true, trustedSvg })
    if (stored.securityScan?.quarantined) throw new BadRequestException(stored.securityScan.message || '文件已隔离')
    const asset = await this.prisma.$transaction(async (tx) => {
      await lockFileReferences(tx)
      const existing = await tx.mediaAsset.findUnique({ where: { fileId: stored.id } })
      if (existing) {
        if (existing.deletedAt) throw new ConflictException('相同图片已软删除；保留期内不能重复上传，请在受控清理完成后重新导入')
        if (existing.status !== 'active') throw new ConflictException('相同图片已归档；请在素材库恢复后使用')
        return existing
      }
      const created = await tx.mediaAsset.create({ data: { assetKey: `upload--${randomUUID()}`, fileId: stored.id, name: input.name, kind: input.kind, contentType: input.contentType, categoryKey: input.categoryKey, altText: input.altText, ...dimensions, createdBy: actor.id } })
      await tx.auditLog.create({ data: { actorId: actor.id, action: 'media_upload', targetType: 'media_asset', targetId: created.id } })
      return created
    }).catch(async (error: unknown) => {
      // 提交结果不明时重新查绑定；已提交/共享文件保留，真正孤立文件才排队补偿。
      await releaseUnboundMediaFile(this.prisma, this.storage, stored.id).catch(() => undefined)
      throw error
    })
    return this.detail(asset.id)
  }
  async update(id: string, input: MediaUpdateDto, actorId: string) {
    await this.prisma.$transaction(async (tx) => {
      await lockFileReferences(tx)
      const current = await tx.mediaAsset.findUnique({ where: { id } })
      if (!current || current.deletedAt) throw new NotFoundException('素材不存在')
      if (current.revision !== input.expectedRevision) throw new ConflictException('素材版本已变化，请刷新后重试')
      if (input.status === 'archived' && await tx.mediaDefaultRule.count({ where: { assetId: id, active: true } })) throw new BadRequestException('素材正在作为默认封面，请先替换默认规则')
      const changes = { name: input.name, altText: input.altText, focalX: input.focalX, focalY: input.focalY, status: input.status }
      await tx.mediaAsset.update({ where: { id }, data: { ...changes, revision: { increment: 1 } } })
      await tx.auditLog.create({ data: { actorId, action: 'media_update', targetType: 'media_asset', targetId: id, details: changes } })
    })
    return this.detail(id)
  }
  async remove(id: string, actorId: string) {
    return this.prisma.$transaction(async (tx) => {
      await lockFileReferences(tx)
      const asset = await tx.mediaAsset.findUnique({ where: { id } })
      if (!asset) throw new NotFoundException('素材不存在')
      const usage = await mediaUsage(tx, id)
      if (usage.length) throw new BadRequestException('素材仍被默认规则、内容草稿或历史版本引用；可先查看引用并归档非默认素材')
      await tx.mediaAsset.update({ where: { id }, data: { status: 'archived', deletedAt: new Date(), revision: { increment: 1 } } })
      await tx.auditLog.create({ data: { actorId, action: 'media_soft_delete', targetType: 'media_asset', targetId: id } })
      return { deleted: true, physicalDeleted: false }
    })
  }
  async usage(id: string) { await this.record(id); return mediaUsage(this.prisma, id) }
  async defaults() {
    return this.prisma.mediaDefaultRule.findMany({ orderBy: [{ contentType: 'asc' }, { categoryKey: 'asc' }], include: { asset: { select: { id: true, name: true, status: true } } } })
  }
  async setDefault(contentType: string, categoryKey: string, input: MediaDefaultDto, actorId: string) {
    if (!mediaTypes.includes(contentType as MediaContentType) || !/^[a-z0-9-]{1,80}$/.test(categoryKey)) throw new BadRequestException('默认封面类型或分类不合法')
    return this.prisma.$transaction(async (tx) => {
      await lockFileReferences(tx)
      await this.resolver.assertBinding(tx, input.assetId, contentType === 'page_hero' ? 'hero' : 'cover')
      const where = { contentType_categoryKey: { contentType, categoryKey } }
      const current = await tx.mediaDefaultRule.findUnique({ where })
      if (current && current.revision !== input.expectedRevision) throw new ConflictException('默认规则已变化，请刷新后重试')
      const rule = await tx.mediaDefaultRule.upsert({ where, create: { contentType, categoryKey, assetId: input.assetId }, update: { assetId: input.assetId, active: true, revision: { increment: 1 } } })
      await tx.auditLog.create({ data: { actorId, action: 'media_default_update', targetType: 'media_default', targetId: rule.id } })
      return rule
    })
  }
  async pageVisuals() {
    const setting = await this.prisma.systemSetting.findUnique({ where: { key: 'public_page_visuals' } })
    const value = mediaObject(setting?.value)
    const heroes = Object.fromEntries(await Promise.all(publicPageVisualKeys.map(async (key) => [key, await this.resolver.resolve({ contentType: 'page_hero', categoryKey: key.replace('HeroAssetId', ''), explicitAssetId: typeof value[key] === 'string' ? value[key] : null })])))
    return { revision: setting?.revision || 0, heroes }
  }
  async pageVisualConfig() {
    const setting = await this.prisma.systemSetting.findUnique({ where: { key: 'public_page_visuals' } })
    return { revision: setting?.revision || 0, value: Object.fromEntries(publicPageVisualKeys.map((key) => [key, mediaObject(setting?.value)[key] || null])) }
  }
  async setPageVisuals(value: PublicPageVisualSetting, expectedRevision: number, actorId: string) {
    if (!value || Object.getPrototypeOf(value) !== Object.prototype || Object.keys(value).some((key) => !publicPageVisualKeys.includes(key as typeof publicPageVisualKeys[number]))) throw new BadRequestException('页面视觉字段不合法')
    return this.prisma.$transaction(async (tx) => {
      await lockFileReferences(tx)
      const current = await tx.systemSetting.findUnique({ where: { key: 'public_page_visuals' } })
      if ((current?.revision || 0) !== expectedRevision) throw new ConflictException('页面视觉配置已变化，请刷新后重试')
      for (const id of Object.values(value)) await this.resolver.assertBinding(tx, id, 'hero')
      const config = Object.fromEntries(publicPageVisualKeys.map((key) => [key, value[key] || null]))
      await tx.systemSetting.upsert({ where: { key: 'public_page_visuals' }, create: { key: 'public_page_visuals', value: config }, update: { value: config, revision: { increment: 1 } } })
      await tx.auditLog.create({ data: { actorId, action: 'page_visuals_update', targetType: 'setting', targetId: 'public_page_visuals' } })
      return { saved: true }
    })
  }
}
