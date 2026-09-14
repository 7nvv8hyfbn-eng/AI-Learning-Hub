import { Prisma, PrismaClient } from '@prisma/client'
import { LANDING_DEFAULT_CONFIG, LANDING_MODULE_KEYS, LANDING_MODULE_LABELS } from '@ai-learning-hub/contracts'

/** 独立窄升级：不运行完整Seed，不修改旧模块、账号或学习内容。 */
export async function upgradeLanding(prisma: PrismaClient) {
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext('homepage-community-landing-v1'))::text`
    const existing = await tx.homepageModule.findMany({
      where: { moduleKey: { in: [...LANDING_MODULE_KEYS] } },
      include: {
        items: { orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }] },
        currentDraftVersion: true,
        publishedVersion: true,
        versions: { orderBy: { versionNo: 'desc' }, take: 1, select: { versionNo: true } },
      },
    })
    const publications = await tx.homepagePublication.findMany({ orderBy: { version: 'desc' }, select: { id: true, version: true, snapshot: true } })
    const hasPublication = publications.some((row) => Array.isArray(row.snapshot) && row.snapshot.some((module) => module && typeof module === 'object' && 'moduleKey' in module && module.moduleKey === 'landing_hero'))
    if (hasPublication && existing.length === 5) {
      // 首屏卡片已固定为代码资源，历史推荐与发布快照原样保留。
      return { changed: false, version: publications[0].version }
    }
    if (existing.length || hasPublication) throw new Error('发现未完成的落地页升级或既有草稿，停止自动升级以保护人工编辑')
    const posts = await tx.communityPost.findMany({ where: { status: 'published', visibility: 'public', portalConsent: true, deletedAt: null, publishedAt: { not: null }, author: { status: 'active' } }, orderBy: [{ publishedAt: 'desc' }, { id: 'desc' }], take: 3, select: { id: true } })
    const labs = await tx.lab.findMany({ where: { status: 'published', deletedAt: null }, orderBy: { sortOrder: 'asc' }, take: 2, select: { id: true } })
    const topics = await tx.communityTopic.findMany({ where: { status: 'active' }, orderBy: [{ recommended: 'desc' }, { sortOrder: 'asc' }], take: 5, select: { id: true } })
    const creators = await tx.user.findMany({ where: { status: 'active', communityProfile: { isNot: null }, communityPosts: { some: { status: 'published', visibility: 'public', portalConsent: true, deletedAt: null } }, userRoles: { none: { role: { code: { in: ['admin', 'super_admin'] } } } } }, orderBy: { createdAt: 'asc' }, take: 4, select: { id: true } })
    const now = new Date()
    for (const [sortOrder, key] of LANDING_MODULE_KEYS.entries()) {
      const refs = key === 'landing_featured' ? [
        ...labs.map((row, index) => ({ targetType: 'lab', targetId: row.id, coverOverride: index ? 'robotVision' : 'robotCar' })),
        ...posts.slice(0, 1).map((row) => ({ targetType: 'community_post', targetId: row.id, coverOverride: 'aiWorkspace' })),
      ] : key === 'landing_community_overview' ? [
        ...topics.map((row) => ({ targetType: 'community_topic', targetId: row.id })),
        ...creators.map((row) => ({ targetType: 'community_user', targetId: row.id })),
      ] : []
      const module = await tx.homepageModule.create({ data: { moduleKey: key, name: LANDING_MODULE_LABELS[key], moduleType: 'community_landing_v1', sortOrder, status: 'published', publishedAt: now, config: JSON.parse(JSON.stringify(LANDING_DEFAULT_CONFIG[key])) as Prisma.InputJsonValue, items: { create: refs.map((ref, index) => ({ ...ref, sortOrder: index })) } }, include: { items: { orderBy: { sortOrder: 'asc' } } } })
      const snapshot = JSON.parse(JSON.stringify(module)) as Prisma.InputJsonValue
      const version = await tx.homepageModuleVersion.create({ data: { moduleId: module.id, versionNo: 1, snapshot } })
      await tx.homepageModule.update({ where: { id: module.id }, data: { publishedVersionId: version.id, currentDraftVersionId: version.id } })
    }
    const modules = await tx.homepageModule.findMany({ where: { moduleKey: { in: [...LANDING_MODULE_KEYS] } }, orderBy: { sortOrder: 'asc' }, include: { items: { orderBy: { sortOrder: 'asc' } } } })
    const version = (publications[0]?.version || 0) + 1
    // 只复制最近有效发布里的旧快照作为兼容段，绝不读取旧模块人工草稿。
    const previous = publications.find((row) => Array.isArray(row.snapshot) && row.snapshot.length > 0)?.snapshot
    const legacy = Array.isArray(previous) ? previous.filter((item) => item && typeof item === 'object' && 'moduleKey' in item && !(LANDING_MODULE_KEYS as readonly unknown[]).includes(item.moduleKey)) : []
    await tx.homepagePublication.create({ data: { version, snapshot: JSON.parse(JSON.stringify([...legacy, ...modules])) as Prisma.InputJsonValue } })
    return { changed: true, version, createdModules: 5 }
  }, { timeout: 30000 })
}

if (require.main === module) {
  const prisma = new PrismaClient()
  upgradeLanding(prisma).then((result) => console.log(JSON.stringify(result)))
    .catch((error: unknown) => { console.error(error instanceof Error ? error.message : '落地页升级失败'); process.exitCode = 1 })
    .finally(() => prisma.$disconnect())
}
