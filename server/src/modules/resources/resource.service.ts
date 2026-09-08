import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common'
import { Prisma, PublishStatus } from '@prisma/client'
import { ContentSupportService } from '../../common/content/content-support.service'
import { PrismaService } from '../../prisma/prisma.service'
import type { PageQueryDto } from '../../common/content/page-query.dto'
import type { CreateResourceDto, UpdateResourceDto } from './resource.dto'
import { lockFileReferences } from '../../common/persistence'
import { ContentDetectionService } from '../community/content-detection.service'

const dataFields = ['downloadPermission', 'difficulty', 'tags', 'coverAssetId', 'themeId', 'courseId', 'labId']

@Injectable()
export class ResourceService {
  constructor(private readonly prisma: PrismaService, private readonly support: ContentSupportService, private readonly detection: ContentDetectionService) {}
  remove(id: string, actorId: string) { return this.support.remove('resource', id, actorId) }

  private snapshot(snapshot: Prisma.JsonValue | null | undefined) {
    const value = this.support.data(snapshot)
    return {
      title: typeof value.title === 'string' ? value.title : undefined,
      summary: typeof value.summary === 'string' ? value.summary : undefined,
      category: typeof value.category === 'string' ? value.category : undefined,
      format: typeof value.format === 'string' ? value.format : undefined,
      visibility: typeof value.visibility === 'string' ? value.visibility : undefined,
      fileId: typeof value.fileId === 'string' ? value.fileId : null,
      data: this.support.data((value.data || value.payload) as Prisma.JsonValue),
    }
  }

  async list(query: PageQueryDto, publicOnly = false) {
    const where: Prisma.ResourceWhereInput = this.support.where(publicOnly ? { ...query, keyword: '' } : query, publicOnly)
    if (publicOnly) where.publishedVersion = { is: query.keyword ? { OR: [
      { snapshot: { path: ['title'], string_contains: query.keyword, mode: 'insensitive' } },
      { snapshot: { path: ['summary'], string_contains: query.keyword, mode: 'insensitive' } },
    ] } : {} }
    const [items, total] = await this.prisma.$transaction([
      this.prisma.resource.findMany({ ...this.support.page(query), where, include: { publishedVersion: true } }),
      this.prisma.resource.count({ where }),
    ])
    const covers = await this.support.media.prepare(items, publicOnly)
    return {
      items: await Promise.all(items.map(async (item) => {
        const published = publicOnly ? this.snapshot(item.publishedVersion?.snapshot) : null
        return {
          ...await this.support.render('resource', {
            ...item,
            title: publicOnly ? published?.title ?? '' : item.title,
            summary: publicOnly ? published?.summary ?? '' : item.summary,
          }, !publicOnly, published?.data || this.support.data(item.payload), covers),
          category: published?.category || item.category,
          format: published?.format || item.format,
          visibility: published?.visibility || item.visibility,
          downloads: item.downloadCount,
          views: item.viewCount,
        }
      })),
      page: query.page,
      pageSize: query.pageSize,
      total,
    }
  }

  async detail(value: string, publicOnly = false) {
    const item = await this.prisma.resource.findFirst({
      where: { OR: [{ id: value }, { slug: value }], deletedAt: null, ...(publicOnly ? { status: PublishStatus.published } : {}) },
      include: {
        file: { include: { uploader: { select: { id: true, displayName: true } } } },
        currentDraftVersion: true,
        publishedVersion: true,
        versions: { orderBy: { versionNo: 'desc' } },
      },
    })
    if (!item) throw new NotFoundException('资源不存在')
    if (publicOnly && !item.publishedVersion) throw new NotFoundException('资源尚无有效发布版本')
    const published = publicOnly ? this.snapshot(item.publishedVersion?.snapshot) : null
    const publishedFile = publicOnly && published?.fileId
      ? await this.prisma.fileRecord.findUnique({ where: { id: published.fileId }, include: { uploader: { select: { id: true, displayName: true } } } })
      : null
    const file = publicOnly ? publishedFile : item.file
    return {
      ...await this.support.render('resource', {
        ...item,
        title: publicOnly ? published?.title ?? '' : item.title,
        summary: publicOnly ? published?.summary ?? '' : item.summary,
      }, !publicOnly, published?.data || this.support.data(item.payload)),
      category: published?.category || item.category,
      format: published?.format || item.format,
      visibility: published?.visibility || item.visibility,
      downloads: item.downloadCount,
      views: item.viewCount,
      file: file ? { id: file.id, name: file.originalName, size: file.size, mimeType: file.mimeType } : null,
      uploadedBy: file?.uploader || null,
      ...(!publicOnly ? {
        currentDraftVersionId: item.currentDraftVersionId,
        publishedVersionId: item.publishedVersionId,
        versions: item.versions.map((version) => ({
          id: version.id,
          versionNo: version.versionNo,
          createdAt: version.createdAt.toISOString(),
          snapshot: version.snapshot,
        })),
      } : {}),
    }
  }

  async create(input: CreateResourceDto, actorId: string) {
    const data = { coverAssetId: null, ...this.support.pick(input, dataFields) }
    const item = await this.prisma.$transaction(async (tx) => {
      await this.support.binding(tx, input.coverAssetId)
      if (input.fileId && !await tx.fileRecord.count({ where: { id: input.fileId, quarantinedAt: null, OR: [{ uploadedBy: actorId }, { resources: { some: {} } }] } })) throw new BadRequestException('资源文件不存在、已隔离或无权使用')
      const resource = await tx.resource.create({
        data: {
          coverAssetId: input.coverAssetId || null,
          slug: input.slug,
          title: input.title,
          summary: input.summary,
          sortOrder: input.sortOrder,
          category: input.category,
          format: input.format,
          visibility: input.visibility,
          fileId: input.fileId || null,
          payload: this.support.sanitize(data),
        },
      })
      const version = await tx.resourceVersion.create({
        data: { resourceId: resource.id, versionNo: 1, snapshot: this.support.json({ title: resource.title, summary: resource.summary, category: resource.category, format: resource.format, visibility: resource.visibility, data, fileId: resource.fileId }) },
      })
      return tx.resource.update({ where: { id: resource.id }, data: { currentDraftVersionId: version.id } })
    })
    await this.syncRelations(item.id, input.courseId, input.labId)
    await this.support.audit(actorId, 'create', 'resources', item.id)
    return this.support.render('resource', item, true)
  }

  async update(id: string, input: UpdateResourceDto, actorId: string) {
    const item = await this.prisma.$transaction(async (tx) => {
      await this.support.binding(tx, input.coverAssetId)
      const current = await tx.resource.findUnique({ where: { id, deletedAt: null } })
      if (!current) throw new NotFoundException('资源不存在')
      const data = { ...this.support.data(current.payload), ...this.support.pick(input, dataFields) }
      if (input.fileId && !await tx.fileRecord.count({ where: { id: input.fileId, quarantinedAt: null, OR: [{ uploadedBy: actorId }, { resources: { some: {} } }] } })) throw new BadRequestException('资源文件不存在、已隔离或无权使用')
      const resource = await tx.resource.update({
        where: { id },
        data: {
          ...this.support.pick(input, ['title', 'summary', 'sortOrder', 'category', 'format', 'visibility', 'fileId', 'coverAssetId']),
          payload: this.support.sanitize(data),
          version: { increment: 1 },
        },
      })
      const versionNo = await tx.resourceVersion.count({ where: { resourceId: id } }) + 1
      const version = await tx.resourceVersion.create({
        data: {
          resourceId: id,
          versionNo,
          snapshot: this.support.json({
            title: resource.title,
            summary: resource.summary,
            category: resource.category,
            format: resource.format,
            visibility: resource.visibility,
            data,
            fileId: resource.fileId,
          }),
        },
      })
      return tx.resource.update({ where: { id }, data: { currentDraftVersionId: version.id } })
    })
    if (input.courseId !== undefined || input.labId !== undefined) await this.syncRelations(id, input.courseId, input.labId)
    await this.support.audit(actorId, 'update', 'resources', id)
    return this.support.render('resource', item, true)
  }

  async setPublished(id: string, published: boolean, actorId: string) {
    const item = await this.prisma.$transaction(async (tx) => {
      await this.support.binding(tx, undefined)
      const draftId = published ? await this.ensureDraft(id, tx) : null
      const draft = draftId ? await tx.resourceVersion.findUniqueOrThrow({ where: { id: draftId } }) : null
      const snapshot = this.snapshot(draft?.snapshot)
      const detection = published ? await this.detection.check(tx, { resourceTitle: snapshot.title || '', resourceDescription: snapshot.summary || '', resourceTags: Array.isArray(snapshot.data.tags) ? snapshot.data.tags.filter((tag): tag is string => typeof tag === 'string').join('\n') : '' }) : null
      const held = detection?.action === 'review'
      const saved = await tx.resource.update({ where: { id }, data: published
        ? held ? { status: PublishStatus.reviewing, publishedAt: null, version: { increment: 1 } } : { status: PublishStatus.published, publishedAt: new Date(), publishedVersionId: draftId, version: { increment: 1 } }
        : { status: PublishStatus.archived, version: { increment: 1 } } })
      if (detection) await this.detection.record(tx, { type: 'resource', id, revision: saved.version, authorId: actorId, submittedById: actorId }, detection, { draftVersionId: draftId!, snapshot: draft!.snapshot as Prisma.InputJsonValue })
      else await tx.contentReview.updateMany({ where: { targetType: 'resource', targetId: id, status: 'pending' }, data: { status: 'superseded' } })
      return saved
    })
    await this.support.audit(actorId, published ? 'publish' : 'archive', 'resources', id)
    return { ...await this.support.render('resource', item, true), detection: await this.detection.result('resource', id, item.version) }
  }

  async restoreVersion(id: string, versionId: string, actorId: string) {
    const version = await this.prisma.resourceVersion.findFirst({ where: { id: versionId, resourceId: id } })
    if (!version) throw new NotFoundException('资源版本不存在')
    const snapshot = this.snapshot(version.snapshot)
    await this.prisma.$transaction(async (tx) => {
      await lockFileReferences(tx)
      const versionNo = await tx.resourceVersion.count({ where: { resourceId: id } }) + 1
      const draft = await tx.resourceVersion.create({
        data: { resourceId: id, versionNo, snapshot: version.snapshot as Prisma.InputJsonValue },
      })
      await tx.resource.update({
        where: { id },
        data: {
          title: snapshot.title || '',
          summary: snapshot.summary || '',
          category: snapshot.category || '',
          format: snapshot.format || '',
          visibility: snapshot.visibility || 'authenticated',
          payload: this.support.sanitize(snapshot.data),
          coverAssetId: typeof snapshot.data.coverAssetId === 'string' ? snapshot.data.coverAssetId : null,
          fileId: snapshot.fileId,
          currentDraftVersionId: draft.id,
          version: { increment: 1 },
        },
      })
    })
    await this.support.audit(actorId, 'restore_version', 'resources', id)
    return this.detail(id)
  }

  private async ensureDraft(resourceId: string, tx: Prisma.TransactionClient): Promise<string> {
    const resource = await tx.resource.findUnique({
      where: { id: resourceId, deletedAt: null },
      include: { currentDraftVersion: true, _count: { select: { versions: true } } },
    })
    if (!resource) throw new NotFoundException('资源不存在')
    if (resource.currentDraftVersionId && resource.currentDraftVersionId !== resource.publishedVersionId) return resource.currentDraftVersionId
    const version = await tx.resourceVersion.create({
      data: {
        resourceId,
        versionNo: resource._count.versions + 1,
        snapshot: (resource.currentDraftVersion?.snapshot || this.support.json({
          title: resource.title,
          summary: resource.summary,
          category: resource.category,
          format: resource.format,
          visibility: resource.visibility,
          data: this.support.data(resource.payload),
          fileId: resource.fileId,
        })) as Prisma.InputJsonValue,
      },
    })
    await tx.resource.update({ where: { id: resourceId }, data: { currentDraftVersionId: version.id } })
    return version.id
  }

  private async syncRelations(resourceId: string, courseId?: string, labId?: string) {
    await this.prisma.$transaction(async (tx) => {
      if (courseId !== undefined) {
        await tx.courseResource.deleteMany({ where: { resourceId } })
        if (courseId) await tx.courseResource.create({ data: { resourceId, courseId } })
      }
      if (labId !== undefined) {
        await tx.labResource.deleteMany({ where: { resourceId } })
        if (labId) await tx.labResource.create({ data: { resourceId, labId } })
      }
    })
  }
}
