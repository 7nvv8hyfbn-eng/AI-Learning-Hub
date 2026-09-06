import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common'
import { Prisma } from '@prisma/client'
import { LANDING_MODULE_KEYS, isLandingModuleKey, landingConfigIssues, landingItemLimit, landingTargetTypes, isLandingImage, type HomepageModuleKey, type HomepageResolvedItemDto, type PublicHomepageDto } from '@ai-learning-hub/contracts'
import { PrismaService } from '../../prisma/prisma.service'
import { ArticleService } from '../articles/article.service'
import { ChallengeService } from '../challenges/challenge.service'
import { CourseService } from '../courses/course.service'
import { LabService } from '../labs/lab.service'
import { ResourceService } from '../resources/resource.service'
import { ThemeService } from '../themes/theme.service'
import type { CreateHomepageItemDto, CreateHomepageModuleDto, ReorderDto, UpdateHomepageModuleDto } from './homepage.dto'
import { ContentReferenceService } from '../../common/content-reference/content-reference.service'

type SnapshotModule = Record<string, unknown> & { items?: Array<Record<string, unknown>> }

@Injectable()
export class HomepageService {
  private readonly allowedKeys = new Set<string>(LANDING_MODULE_KEYS)

  constructor(
    private readonly prisma: PrismaService,
    private readonly themes: ThemeService,
    private readonly courses: CourseService,
    private readonly labs: LabService,
    private readonly resources: ResourceService,
    private readonly articles: ArticleService,
    private readonly challenges: ChallengeService,
    private readonly references: ContentReferenceService,
  ) {}

  async adminModules() {
    const modules = await this.prisma.homepageModule.findMany({
      where: { moduleKey: { in: [...LANDING_MODULE_KEYS] } },
      orderBy: { sortOrder: 'asc' },
      include: { items: { orderBy: { sortOrder: 'asc' } } },
    })
    return Promise.all(modules.map(async (module) => ({
      ...module,
      items: await Promise.all(module.items.map(async (item) => ({
        ...item,
        relationValid: await this.isPublishedTarget(item.targetType, item.targetId),
      }))),
    })))
  }

  async preview(): Promise<PublicHomepageDto> {
    const modules = await this.prisma.homepageModule.findMany({
      where: { enabled: true, moduleKey: { in: [...LANDING_MODULE_KEYS] } },
      orderBy: { sortOrder: 'asc' },
      include: { items: { where: { enabled: true }, orderBy: { sortOrder: 'asc' } } },
    })
    return this.render(modules, modules[0]?.updatedAt || new Date(), 0)
  }

  async published(): Promise<PublicHomepageDto> {
    const publication = await this.prisma.homepagePublication.findFirst({ orderBy: { version: 'desc' } })
    if (!publication || !Array.isArray(publication.snapshot)) return { modules: [], updatedAt: new Date(0).toISOString(), version: 0 }
    return this.render(publication.snapshot as SnapshotModule[], publication.publishedAt, publication.version)
  }

  async createModule(input: CreateHomepageModuleDto) {
    void input
    throw new BadRequestException('门户落地页固定五个区域，不允许新增模块')
  }

  async updateModule(id: string, input: UpdateHomepageModuleDto) {
    const current = await this.requireLandingModule(id)
    if (input.sortOrder !== undefined && input.sortOrder !== LANDING_MODULE_KEYS.indexOf(current.moduleKey)) throw new BadRequestException('落地页区域顺序固定')
    if (input.enabled === false && ['landing_hero', 'landing_bottom_cta'].includes(current.moduleKey)) throw new BadRequestException('首屏与底部行动区必须启用')
    if (input.config) this.assertConfig(current.moduleKey, input.config)
    const { config, ...rest } = input
    return this.editDraft(id, (tx) => tx.homepageModule.update({
      where: { id },
      data: { ...rest, ...(config ? { config: config as Prisma.InputJsonValue } : {}) },
    }))
  }

  async reorder(input: ReorderDto) {
    const modules = await this.adminModules()
    if (input.items.length !== 5 || input.items.some((item) => modules.find((module) => module.id === item.id)?.sortOrder !== item.sortOrder)) throw new BadRequestException('落地页区域顺序固定')
    return this.adminModules()
  }

  async addItem(moduleId: string, input: CreateHomepageItemDto) {
    const module = await this.requireLandingModule(moduleId)
    await this.validateItem(module.moduleKey, input)
    return this.editDraft(moduleId, async (tx) => {
      const items = await tx.homepageItem.findMany({ where: { moduleId } })
      if (items.length >= landingItemLimit(module.moduleKey)) throw new BadRequestException('推荐数量已达上限')
      if (module.moduleKey === 'landing_community_overview' && items.filter((row) => row.targetType === input.targetType).length >= (input.targetType === 'community_topic' ? 5 : 4)) throw new BadRequestException('话题最多五项，创作者最多四项')
      return tx.homepageItem.create({ data: { moduleId, ...input } })
    })
  }

  async reorderItems(moduleId: string, input: ReorderDto) {
    await this.requireLandingModule(moduleId)
    const existing = await this.prisma.homepageItem.findMany({
      where: { moduleId, id: { in: input.items.map((item) => item.id) } },
      select: { id: true },
    })
    if (existing.length !== input.items.length) throw new NotFoundException('推荐内容不存在或不属于当前模块')
    await this.editDraft(moduleId, (tx) => Promise.all(input.items.map((item) => tx.homepageItem.update({
      where: { id: item.id },
      data: { sortOrder: item.sortOrder },
    }))))
    return this.adminModules()
  }

  async deleteItem(moduleId: string, id: string) {
    await this.requireLandingModule(moduleId)
    await this.editDraft(moduleId, (tx) => tx.homepageItem.deleteMany({ where: { id, moduleId } }))
    return { deleted: true }
  }

  async publish() {
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext('homepage-community-landing-v1'))::text`
      const draftModules = await tx.homepageModule.findMany({
        where: { moduleKey: { in: [...LANDING_MODULE_KEYS] } },
        orderBy: { sortOrder: 'asc' },
        include: { items: { where: { enabled: true }, orderBy: { sortOrder: 'asc' } }, _count: { select: { versions: true } } },
      })
      if (draftModules.length !== 5 || draftModules.some((module, index) => module.moduleKey !== LANDING_MODULE_KEYS[index] || module.sortOrder !== index)) throw new BadRequestException('落地页需完成固定五区域升级')
      const hero = draftModules.find((module) => module.moduleKey === 'landing_hero')!
      const firstPost = hero.items.find((item) => item.sortOrder < 4 && item.targetType === 'community_post')
      const fifth = hero.items.find((item) => item.sortOrder === 4)
      let fifthIssue = !fifth || fifth.targetType !== 'community_post' ? '缺少社区帖子快照' : ''
      if (!fifthIssue && fifth!.targetId === firstPost?.targetId) fifthIssue = '社区帖子快照与第1张重复'
      if (!fifthIssue) {
        const post = await tx.communityPost.findUnique({ where: { id: fifth!.targetId }, select: { status: true, visibility: true, deletedAt: true, publishedAt: true, author: { select: { status: true } } } })
        fifthIssue = !post ? '社区帖子不存在'
          : post.deletedAt ? '社区帖子已删除'
            : post.status === 'hidden' ? '社区帖子已隐藏'
              : post.status !== 'published' || !post.publishedAt ? '社区帖子未发布'
                : post.visibility !== 'public' ? '社区帖子非公开'
                  : post.author.status !== 'active' ? '帖子作者已失效' : ''
      }
      if (fifthIssue) throw new BadRequestException(`首页存在配置未完成模块：${hero.name}（${fifthIssue}）`)
      const modules = draftModules.filter((module) => module.enabled)
      const incomplete = modules.map((module) => ({ module, issues: this.readinessIssues(module) })).filter((item) => item.issues.length)
      if (incomplete.length) throw new BadRequestException(`首页存在配置未完成模块：${incomplete.map((item) => `${item.module.name}（${item.issues.join('、')}）`).join('；')}`)
      const published = []
      const publishedAt = new Date()
      for (const module of modules) {
        const snapshot = {
          moduleKey: module.moduleKey,
          name: module.name,
          moduleType: module.moduleType,
          enabled: module.enabled,
          sortOrder: module.sortOrder,
          config: module.config,
          items: module.items,
        } as Prisma.InputJsonValue
        let versionId = module.currentDraftVersionId
        if (!versionId || versionId === module.publishedVersionId) {
          versionId = (await tx.homepageModuleVersion.create({
            data: { moduleId: module.id, versionNo: module._count.versions + 1, snapshot },
          })).id
        } else {
          await tx.homepageModuleVersion.update({ where: { id: versionId }, data: { snapshot } })
        }
        const updated = await tx.homepageModule.update({
          where: { id: module.id },
          data: {
            status: 'published',
            publishedAt,
            currentDraftVersionId: versionId,
            publishedVersionId: versionId,
          },
        })
        published.push({ ...updated, items: module.items })
      }
      const latest = await tx.homepagePublication.findFirst({ orderBy: { version: 'desc' } })
      const legacy = Array.isArray(latest?.snapshot) ? latest.snapshot.filter((item) => item && typeof item === 'object' && 'moduleKey' in item && !this.allowedKeys.has(String(item.moduleKey))) : []
      return tx.homepagePublication.create({
        data: { version: (latest?.version || 0) + 1, snapshot: JSON.parse(JSON.stringify([...legacy, ...published])) as Prisma.InputJsonValue },
      })
    })
  }

  private async render(modules: SnapshotModule[], updatedAt: Date, version: number): Promise<PublicHomepageDto> {
    const rendered = (await Promise.all(modules
      .filter((module) => module.enabled !== false && this.allowedKeys.has(String(module.moduleKey)))
      .sort((left, right) => Number(left.sortOrder || 0) - Number(right.sortOrder || 0))
      .map(async (module) => {
        const sourceItems = (module.items || []).filter((item) => item.enabled !== false)
        let items = (await Promise.all(sourceItems
          .map(async (item, index) => {
            const resolved = await this.resolve(String(item.targetType), String(item.targetId))
            return resolved ? { ...resolved, slot: Number.isInteger(Number(item.sortOrder)) ? Number(item.sortOrder) : index, ...(item.titleOverride ? { title: String(item.titleOverride) } : {}), ...(item.summaryOverride ? { summary: String(item.summaryOverride) } : {}), data: { ...resolved.data, ...(isLandingImage(item.coverOverride) ? { cover: item.coverOverride } : {}) } } : null
          })))
          .filter((item) => item !== null)
        if (module.moduleKey === 'landing_hero') {
          const earlierPostIds = sourceItems.filter((item) => Number(item.sortOrder) < 4 && item.targetType === 'community_post').map((item) => String(item.targetId))
          const fifth = items.find((item) => item.slot === 4)
          if (!fifth || fifth.targetType !== 'community_post' || earlierPostIds.includes(fifth.slug)) {
            items = items.filter((item) => item.slot !== 4)
            const fallback = await this.prisma.communityPost.findFirst({
              where: { id: { notIn: earlierPostIds }, status: 'published', visibility: 'public', deletedAt: null, publishedAt: { not: null }, author: { status: 'active' } },
              orderBy: [{ publishedAt: 'desc' }, { id: 'desc' }],
              select: { id: true },
            })
            const resolved = fallback && await this.references.resolvePublicCommunity('community_post', fallback.id)
            if (resolved) items.push({ ...resolved, slot: 4 })
          }
        }
        return {
          id: String(module.moduleKey),
          moduleKey: String(module.moduleKey) as HomepageModuleKey,
          name: String(module.name || ''),
          sortOrder: Number(module.sortOrder || 0),
          config: module.config && typeof module.config === 'object' && !Array.isArray(module.config) ? module.config as Record<string, unknown> : {},
          items: items.sort((left, right) => (left.slot ?? 0) - (right.slot ?? 0)),
        }
      })))
    return {
      pageMode: 'community_landing_v1',
      community: { members: await this.prisma.user.count({ where: { status: 'active', userType: 'student' } }), creators: rendered.flatMap((module) => module.items.filter((item) => item.targetType === 'community_user').map((item) => item.data as unknown as NonNullable<PublicHomepageDto['community']>['creators'][number])).slice(0, 4) },
      modules: version > 0 ? rendered.filter((module) => this.readinessIssues(module).length === 0) : rendered,
      updatedAt: updatedAt.toISOString(),
      version,
    }
  }

  private readinessIssues(module: {
    moduleKey: string
    config: unknown
    items?: unknown[]
  }) {
    if (!isLandingModuleKey(module.moduleKey)) return ['旧模块只保留归档']
    const issues = landingConfigIssues(module.moduleKey, module.config)
    if ((module.items?.length || 0) > landingItemLimit(module.moduleKey)) issues.push('推荐数量超过上限')
    return issues
  }

  private async resolve(targetType: string, targetId: string) {
    try {
      if (targetType.startsWith('community_')) return this.references.resolvePublicCommunity(targetType, targetId)
      if (targetType === 'resource') {
        const resource = await this.prisma.resource.findFirst({ where: { OR: [{ id: targetId }, { slug: targetId }], status: 'published', deletedAt: null, visibility: 'public' }, include: { publishedVersion: true } })
        const snapshot = resource?.publishedVersion?.snapshot
        if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot) || snapshot.visibility !== 'public') return null
      }
      const item = targetType === 'theme' ? await this.themes.detail(targetId, true)
        : targetType === 'course' ? await this.courses.detail(targetId, true)
          : targetType === 'lab' ? await this.labs.detail(targetId, true)
            : targetType === 'resource' ? await this.resources.detail(targetId, true)
              : targetType === 'article' ? await this.articles.detail(targetId, true)
                : targetType === 'challenge' ? await this.challenges.detail(targetId, true)
                  : null
      return item ? { targetType: targetType as HomepageResolvedItemDto['targetType'], slug: item.slug, title: item.title, summary: item.summary, data: item.data } : null
    } catch (error) {
      if (error instanceof NotFoundException) return null
      throw error
    }
  }

  private async isPublishedTarget(targetType: string, targetId: string) {
    return Boolean(await this.resolve(targetType, targetId))
  }

  private async requireLandingModule(id: string) {
    const module = await this.prisma.homepageModule.findUnique({ where: { id } })
    if (!module || !isLandingModuleKey(module.moduleKey)) throw new BadRequestException('旧首页模块只保留归档，不允许编辑或重新发布')
    return { ...module, moduleKey: module.moduleKey }
  }

  private assertConfig(key: Parameters<typeof landingConfigIssues>[0], config: unknown) {
    const issues = landingConfigIssues(key, config)
    if (issues.length) throw new BadRequestException(issues.join('；'))
  }

  private async validateItem(key: Parameters<typeof landingTargetTypes>[0], input: CreateHomepageItemDto) {
    if (!(landingTargetTypes(key) as readonly string[]).includes(input.targetType)) throw new BadRequestException('当前区域不支持该关联类型')
    if (input.coverOverride && !isLandingImage(input.coverOverride)) throw new BadRequestException('封面必须为本地正式资源')
    if (!await this.isPublishedTarget(input.targetType, input.targetId)) throw new BadRequestException('关联内容不存在或不允许公开展示')
  }

  async updateItem(moduleId: string, id: string, input: CreateHomepageItemDto) {
    const module = await this.requireLandingModule(moduleId)
    const item = await this.prisma.homepageItem.findFirst({ where: { id, moduleId } })
    if (!item) throw new NotFoundException('推荐内容不存在')
    if (item.targetType !== input.targetType || item.targetId !== input.targetId) throw new BadRequestException('替换关联请先移除再添加')
    await this.validateItem(module.moduleKey, input)
    return this.editDraft(moduleId, (tx) => tx.homepageItem.update({ where: { id }, data: input }))
  }

  async contentOptions(type: string) {
    if (!['community_post', 'community_topic', 'community_user', 'course', 'lab', 'article', 'resource'].includes(type)) throw new BadRequestException('不支持的内容类型')
    const rows = type === 'community_post' ? await this.prisma.communityPost.findMany({ where: { status: 'published', visibility: 'public', deletedAt: null, publishedAt: { not: null }, author: { status: 'active' } }, orderBy: [{ publishedAt: 'desc' }, { id: 'desc' }], select: { id: true }, take: 100 })
      : type === 'community_topic' ? await this.prisma.communityTopic.findMany({ where: { status: 'active' }, select: { id: true }, take: 100 })
        : type === 'community_user' ? await this.prisma.user.findMany({ where: { status: 'active', communityProfile: { isNot: null } }, select: { id: true }, take: 100 })
          : type === 'course' ? await this.prisma.course.findMany({ where: { status: 'published', deletedAt: null }, select: { id: true }, take: 100 })
            : type === 'lab' ? await this.prisma.lab.findMany({ where: { status: 'published', deletedAt: null }, select: { id: true }, take: 100 })
              : type === 'article' ? await this.prisma.article.findMany({ where: { status: 'published', deletedAt: null }, select: { id: true }, take: 100 })
                : await this.prisma.resource.findMany({ where: { status: 'published', deletedAt: null, visibility: 'public' }, select: { id: true }, take: 100 })
    return (await Promise.all(rows.map(async (row) => { const item = await this.resolve(type, row.id); return item ? { id: row.id, title: item.title } : null }))).filter((item) => item !== null)
  }

  private async editDraft<T>(moduleId: string, update: (tx: Prisma.TransactionClient) => Promise<T>) {
    return this.prisma.$transaction(async (tx) => {
      // ponytail: 低频门户编辑共用发布锁；高频多人编辑时再按模块细分锁。
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext('homepage-community-landing-v1'))::text`
      const result = await update(tx)
      await this.createDraft(tx, moduleId)
      return result
    })
  }

  private async createDraft(tx: Prisma.TransactionClient, moduleId: string) {
    const module = await tx.homepageModule.findUnique({
      where: { id: moduleId },
      include: { items: { orderBy: { sortOrder: 'asc' } }, _count: { select: { versions: true } } },
    })
    if (!module) throw new NotFoundException('首页模块不存在')
    const snapshot = JSON.parse(JSON.stringify({
      moduleKey: module.moduleKey,
      name: module.name,
      moduleType: module.moduleType,
      enabled: module.enabled,
      sortOrder: module.sortOrder,
      config: module.config,
      items: module.items,
    })) as Prisma.InputJsonValue
    if (module.currentDraftVersionId && module.currentDraftVersionId !== module.publishedVersionId) {
      await tx.homepageModuleVersion.update({ where: { id: module.currentDraftVersionId }, data: { snapshot } })
      return
    }
    const version = await tx.homepageModuleVersion.create({
      data: { moduleId, versionNo: module._count.versions + 1, snapshot },
    })
    await tx.homepageModule.update({ where: { id: moduleId }, data: { currentDraftVersionId: version.id } })
  }
}
