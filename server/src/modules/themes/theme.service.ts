import { Injectable, NotFoundException } from '@nestjs/common'
import { Prisma, PublishStatus } from '@prisma/client'
import { ContentSupportService } from '../../common/content/content-support.service'
import { PrismaService } from '../../prisma/prisma.service'
import type { PageQueryDto } from '../../common/content/page-query.dto'
import type { CreateThemeDto, UpdateThemeDto } from './theme.dto'

const fields = ['subtitle', 'introduction', 'coverAssetId', 'icon', 'accent', 'recommended', 'recommendedCourseIds', 'relatedLabIds', 'relatedResourceIds']
const publishedCourseCount = { select: { courses: { where: { status: PublishStatus.published, deletedAt: null, publishedVersionId: { not: null } } } } } as const

@Injectable()
export class ThemeService {
  constructor(private readonly prisma: PrismaService, private readonly support: ContentSupportService) {}
  remove(id: string, actorId: string) { return this.support.remove('theme', id, actorId) }

  private snapshot(snapshot: Prisma.JsonValue | null | undefined) {
    const value = this.support.data(snapshot)
    return {
      title: typeof value.title === 'string' ? value.title : undefined,
      summary: typeof value.summary === 'string' ? value.summary : undefined,
      data: this.support.data((value.data || value.payload) as Prisma.JsonValue),
      paths: Array.isArray(value.paths) ? value.paths : [],
    }
  }

  async list(query: PageQueryDto, publicOnly = false) {
    const where = this.support.where(query, publicOnly)
    const [items, total] = await this.prisma.$transaction([
      this.prisma.theme.findMany({
        ...this.support.page(query),
        where,
        include: {
          _count: publishedCourseCount,
          publishedVersion: true,
          paths: {
            where: publicOnly ? { status: PublishStatus.published } : {},
            orderBy: { sortOrder: 'asc' },
            include: { stages: { orderBy: { sortOrder: 'asc' }, include: { contents: true } } },
          },
        },
      }),
      this.prisma.theme.count({ where }),
    ])
    const covers = await this.support.media.prepare(items, publicOnly)
    return {
      items: await Promise.all(items.map(async (item) => {
        const published = publicOnly ? this.snapshot(item.publishedVersion?.snapshot) : null
        return {
          ...await this.support.render('theme', {
            ...item,
            title: published?.title || item.title,
            summary: published?.summary || item.summary,
          }, !publicOnly, { ...(published?.data || this.support.data(item.payload)), courseCount: item._count.courses }, covers),
          paths: publicOnly ? published?.paths || [] : item.paths,
        }
      })),
      page: query.page,
      pageSize: query.pageSize,
      total,
    }
  }

  async detail(value: string, publicOnly = false) {
    const item = await this.prisma.theme.findFirst({
      where: { OR: [{ id: value }, { slug: value }], deletedAt: null, ...(publicOnly ? { status: PublishStatus.published } : {}) },
      include: {
        _count: publishedCourseCount,
        currentDraftVersion: true,
        publishedVersion: true,
        versions: { orderBy: { versionNo: 'desc' } },
        paths: {
          where: publicOnly ? { status: PublishStatus.published } : {},
          orderBy: { sortOrder: 'asc' },
          include: { stages: { orderBy: { sortOrder: 'asc' }, include: { contents: true } } },
        },
      },
    })
    if (!item) throw new NotFoundException('主题不存在')
    const published = publicOnly ? this.snapshot(item.publishedVersion?.snapshot) : null
    return {
      ...await this.support.render('theme', {
        ...item,
        title: published?.title || item.title,
        summary: published?.summary || item.summary,
      }, !publicOnly, { ...(published?.data || this.support.data(item.payload)), courseCount: item._count.courses }),
      paths: publicOnly ? published?.paths || [] : item.paths,
      ...(!publicOnly ? {
        currentDraftVersionId: item.currentDraftVersionId,
        publishedVersionId: item.publishedVersionId,
        versions: item.versions.map((version) => ({ id: version.id, versionNo: version.versionNo, createdAt: version.createdAt.toISOString() })),
      } : {}),
    }
  }

  async create(input: CreateThemeDto, actorId: string) {
    const data = { coverAssetId: null, ...this.support.pick(input, fields) }
    const item = await this.prisma.$transaction(async (tx) => {
      await this.support.binding(tx, input.coverAssetId)
      const theme = await tx.theme.create({
        data: {
          coverAssetId: input.coverAssetId || null,
          slug: input.slug,
          title: input.title,
          summary: input.summary,
          sortOrder: input.sortOrder,
          payload: this.support.sanitize(data),
        },
      })
      const version = await tx.themeVersion.create({
        data: { themeId: theme.id, versionNo: 1, snapshot: this.support.json({ title: theme.title, summary: theme.summary, data, paths: [] }) },
      })
      return tx.theme.update({ where: { id: theme.id }, data: { currentDraftVersionId: version.id } })
    })
    await this.support.audit(actorId, 'create', 'themes', item.id)
    return this.support.render('theme', item, true)
  }

  async update(id: string, input: UpdateThemeDto, actorId: string) {
    const item = await this.prisma.$transaction(async (tx) => {
      await this.support.binding(tx, input.coverAssetId)
      const draftId = await this.ensureDraft(id, tx)
      const current = await tx.theme.findUniqueOrThrow({ where: { id } })
      const data = { ...this.support.data(current.payload), ...this.support.pick(input, fields) }
      const theme = await tx.theme.update({ where: { id }, data: {
        ...this.support.pick(input, ['title', 'summary', 'sortOrder', 'coverAssetId']), payload: this.support.sanitize(data), version: { increment: 1 },
      } })
      const draft = await tx.themeVersion.findUniqueOrThrow({ where: { id: draftId } })
      await tx.themeVersion.update({ where: { id: draftId }, data: { snapshot: this.support.json({ title: theme.title, summary: theme.summary, data, paths: this.snapshot(draft.snapshot).paths }) } })
      return theme
    })
    await this.support.audit(actorId, 'update', 'themes', id)
    return this.support.render('theme', item, true)
  }

  async setPublished(id: string, published: boolean, actorId: string) {
    const item = await this.prisma.$transaction(async (tx) => {
      await this.support.binding(tx, undefined)
      const draftId = published ? await this.ensureDraft(id, tx) : null
      if (published) await this.refreshDraft(id, tx)
      return tx.theme.update({ where: { id }, data: published
        ? { status: PublishStatus.published, publishedAt: new Date(), publishedVersionId: draftId, version: { increment: 1 } }
        : { status: PublishStatus.archived, version: { increment: 1 } } })
    })
    await this.support.audit(actorId, published ? 'publish' : 'archive', 'themes', id)
    return this.support.render('theme', item, true)
  }

  async upsertPath(themeId: string, input: {
    name: string
    description: string
    stages: Array<{
      stageKey: string
      name: string
      stageType: string
      description?: string
      unlockRule: Record<string, unknown>
      targetType?: string
      targetId?: string
    }>
  }) {
    const path = await this.prisma.$transaction(async (tx) => {
      await this.support.binding(tx, undefined)
      await this.ensureDraft(themeId, tx)
      const theme = await tx.theme.findUnique({ where: { id: themeId } })
      if (!theme) throw new NotFoundException('主题不存在')
      const saved = await tx.learningPath.upsert({
        where: { themeId_name: { themeId, name: input.name } },
        update: { description: input.description },
        create: { themeId, name: input.name, description: input.description, status: PublishStatus.published },
      })
      await tx.learningPathStage.deleteMany({ where: { pathId: saved.id } })
      for (const [index, stage] of input.stages.entries()) {
        const created = await tx.learningPathStage.create({
          data: {
            pathId: saved.id,
            stageKey: stage.stageKey,
            name: stage.name,
            stageType: stage.stageType,
            description: stage.description || '',
            unlockRule: stage.unlockRule as Prisma.InputJsonValue,
            sortOrder: index + 1,
          },
        })
        if (stage.targetType && stage.targetId) {
          await tx.pathContent.create({ data: { stageId: created.id, targetType: stage.targetType, targetId: stage.targetId } })
        }
      }
      await this.refreshDraft(themeId, tx)
      return tx.learningPath.findUnique({ where: { id: saved.id }, include: { stages: { orderBy: { sortOrder: 'asc' }, include: { contents: true } } } })
    })
    return path
  }

  private async ensureDraft(themeId: string, tx: Prisma.TransactionClient): Promise<string> {
    const theme = await tx.theme.findUnique({
      where: { id: themeId, deletedAt: null },
      include: { currentDraftVersion: true, _count: { select: { versions: true } } },
    })
    if (!theme) throw new NotFoundException('主题不存在')
    if (theme.currentDraftVersionId && theme.currentDraftVersionId !== theme.publishedVersionId) return theme.currentDraftVersionId
    const version = await tx.themeVersion.create({
      data: {
        themeId,
        versionNo: theme._count.versions + 1,
        snapshot: (theme.currentDraftVersion?.snapshot || {
          title: theme.title,
          summary: theme.summary,
          data: this.support.data(theme.payload),
          paths: [],
        }) as Prisma.InputJsonValue,
      },
    })
    await tx.theme.update({ where: { id: themeId }, data: { currentDraftVersionId: version.id } })
    return version.id
  }

  private async refreshDraft(themeId: string, tx: Prisma.TransactionClient) {
    const theme = await tx.theme.findUnique({
      where: { id: themeId },
      include: {
        paths: { orderBy: { sortOrder: 'asc' }, include: { stages: { orderBy: { sortOrder: 'asc' }, include: { contents: true } } } },
      },
    })
    if (!theme?.currentDraftVersionId) throw new NotFoundException('主题草稿不存在')
    await tx.themeVersion.update({
      where: { id: theme.currentDraftVersionId },
      data: {
        snapshot: this.support.json({
          title: theme.title,
          summary: theme.summary,
          data: this.support.data(theme.payload),
          paths: theme.paths,
        }),
      },
    })
  }
}
