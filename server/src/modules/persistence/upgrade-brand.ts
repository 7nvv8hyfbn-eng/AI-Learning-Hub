import { Prisma, PrismaClient } from '@prisma/client'
import { BRAND_NAME, BRAND_SLOGAN, BRAND_SLOGAN_LINES } from '@ai-learning-hub/contracts'

const oldNames = ['AI MAKER CAMPUS', 'AI数智化学习平台', 'AI 数智化学习平台', 'AI Learning Hub']
const oldSubtitles = ['高校 AI 创客学习平台', '面向高校学生的 AI 学习与实训平台']
const rules: Record<string, Record<string, { previous: unknown[]; next: Prisma.InputJsonValue }>> = {
  landing_hero: {
    brandName: { previous: oldNames, next: BRAND_NAME },
    brandSubtitle: { previous: oldSubtitles, next: BRAND_SLOGAN },
    titleFirst: { previous: ['加入 AI 创客社区'], next: BRAND_SLOGAN_LINES[0] },
    titleSecond: { previous: ['一起学习 · 实践 · 成长'], next: BRAND_SLOGAN_LINES[1] },
  },
  landing_bottom_cta: { title: { previous: ['现在就加入 AI 创客社区'], next: `现在就加入 ${BRAND_NAME}` } },
  hero_banner: {
    eyebrow: { previous: [...oldNames, ...oldSubtitles], next: BRAND_NAME },
    titleLines: { previous: [['学 AI，不止是听懂。', '还要亲手做出来。']], next: [...BRAND_SLOGAN_LINES] },
  },
}
const equal = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)
const object = (value: unknown): Record<string, Prisma.JsonValue> | undefined => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, Prisma.JsonValue> : undefined

/** 仅接管明确的旧默认值。发布快照和人工草稿分别升级，历史版本不改写。 */
export async function upgradeBrand(prisma: PrismaClient) {
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended('settings-version',0))::text`
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext('homepage-community-landing-v1'))::text`
    const report = { brand: BRAND_NAME, settings: [] as string[], modules: [] as string[], draftVersions: 0, publishedVersions: 0, publicationVersion: 0, preservedCustomFields: [] as string[] }
    const settings = { platform_name: { previous: oldNames, next: BRAND_NAME }, platform_subtitle: { previous: oldSubtitles, next: BRAND_SLOGAN } }
    for (const [key, rule] of Object.entries(settings)) {
      const current = await tx.systemSetting.findUnique({ where: { key } })
      if (current && equal(current.value, rule.next)) continue
      if (current && !rule.previous.some((value) => equal(value, current.value))) { report.preservedCustomFields.push(`settings.${key}`); continue }
      await tx.systemSetting.upsert({ where: { key }, create: { key, value: rule.next }, update: { value: rule.next, revision: { increment: 1 } } })
      report.settings.push(key)
    }
    if (report.settings.length) {
      const version = await tx.systemSetting.findUnique({ where: { key: 'settings_version' } })
      await tx.systemSetting.upsert({ where: { key: 'settings_version' }, create: { key: 'settings_version', value: 1 }, update: { value: Number(version?.value || 0) + 1, revision: { increment: 1 } } })
    }
    const patchConfig = (key: string, value: Prisma.JsonValue, context: string) => {
      const config = object(value)
      if (!config) throw new Error(`品牌升级遇到无效配置：${context}`)
      const result = { ...config } as Prisma.JsonObject
      for (const [field, rule] of Object.entries(rules[key] || {})) {
        if (!(field in config) || equal(config[field], rule.next)) continue
        if (rule.previous.some((previous) => equal(config[field], previous))) result[field] = rule.next as Prisma.JsonValue
        else report.preservedCustomFields.push(`${context}.${field}`)
      }
      return result
    }
    const patchSnapshot = (value: Prisma.JsonValue, context: string): Prisma.JsonValue => {
      const snapshot = object(value)
      const key = String(snapshot?.moduleKey || '')
      if (!snapshot || !rules[key] || !('config' in snapshot)) return value
      return { ...snapshot, config: patchConfig(key, snapshot.config, context) }
    }
    const latest = await tx.homepagePublication.findFirst({ orderBy: { version: 'desc' } })
    if (latest && !Array.isArray(latest.snapshot)) throw new Error('门户发布快照无效，停止品牌升级')
    const previous = (latest?.snapshot || []) as Prisma.JsonArray
    const published = previous.map((snapshot) => patchSnapshot(snapshot, `published.${object(snapshot)?.moduleKey}`))
    const modules = await tx.homepageModule.findMany({
      where: { moduleKey: { in: Object.keys(rules) } },
      include: { currentDraftVersion: true, versions: { orderBy: { versionNo: 'desc' }, take: 1, select: { versionNo: true } } },
    })
    for (const module of modules) {
      const config = patchConfig(module.moduleKey, module.config, `draft.${module.moduleKey}`)
      const index = previous.findIndex((snapshot) => object(snapshot)?.moduleKey === module.moduleKey)
      let versionNo = module.versions[0]?.versionNo || 0
      const data: Prisma.HomepageModuleUpdateInput = {}
      if (!equal(config, module.config)) data.config = config as Prisma.InputJsonObject
      if (index >= 0 && !equal(previous[index], published[index])) {
        const version = await tx.homepageModuleVersion.create({ data: { moduleId: module.id, versionNo: ++versionNo, snapshot: published[index] as Prisma.InputJsonValue } })
        data.publishedVersion = { connect: { id: version.id } }
        data.publishedAt = new Date()
        report.publishedVersions++
        if (module.currentDraftVersionId === module.publishedVersionId) data.currentDraftVersion = { connect: { id: version.id } }
      }
      if (module.currentDraftVersion && !data.currentDraftVersion) {
        const snapshot = patchSnapshot(module.currentDraftVersion.snapshot, `draftVersion.${module.moduleKey}`)
        if (!equal(snapshot, module.currentDraftVersion.snapshot)) {
          const version = await tx.homepageModuleVersion.create({ data: { moduleId: module.id, versionNo: ++versionNo, snapshot: snapshot as Prisma.InputJsonValue } })
          data.currentDraftVersion = { connect: { id: version.id } }
          report.draftVersions++
        }
      }
      if (Object.keys(data).length) {
        await tx.homepageModule.update({ where: { id: module.id }, data })
        report.modules.push(module.moduleKey)
      }
    }
    report.publicationVersion = latest?.version || 0
    if (!equal(previous, published)) {
      const publication = await tx.homepagePublication.create({ data: { version: report.publicationVersion + 1, snapshot: published as Prisma.InputJsonArray } })
      report.publicationVersion = publication.version
    }
    report.preservedCustomFields = [...new Set(report.preservedCustomFields)]
    return report
  }, { timeout: 30000 })
}
