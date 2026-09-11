import { Prisma } from '@prisma/client'

export const catalogTables = [
  ['theme', 'learning_themes', 'learning_theme_versions', 'theme_id'],
  ['course', 'courses', 'course_versions', 'course_id'],
  ['lab', 'labs', 'lab_versions', 'lab_id'],
  ['resource', 'resources', 'resource_versions', 'resource_id'],
  ['article', 'articles', 'article_versions', 'article_id'],
  ['challenge', 'challenges', 'challenge_versions', 'challenge_id'],
] as const
export interface MediaUsage { type: string; id: string; title: string; usage: 'draft' | 'published' | 'history' | 'default' | 'setting' }

export async function unusedMediaIds(tx: Prisma.TransactionClient, ids: string[]) {
  if (!ids.length) return []
  const checks = catalogTables.flatMap(([, table, versions]) => [
    Prisma.sql`NOT EXISTS (SELECT 1 FROM ${Prisma.raw(table)} c WHERE c.cover_asset_id=m.id)`,
    Prisma.sql`NOT EXISTS (SELECT 1 FROM ${Prisma.raw(versions)} v WHERE v.snapshot::text LIKE ('%' || m.id || '%'))`,
  ])
  const rows = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
    SELECT m.id FROM media_assets m WHERE m.id IN (${Prisma.join(ids)})
    AND ${Prisma.join(checks, ' AND ')}
    AND NOT EXISTS (SELECT 1 FROM lesson_blocks b WHERE b.block_type='image' AND b.content_json->>'assetId'=m.id)
    AND NOT EXISTS (SELECT 1 FROM media_default_rules r WHERE r.asset_id=m.id)
    AND NOT EXISTS (SELECT 1 FROM system_settings s WHERE s.key='public_page_visuals' AND s.value::text LIKE ('%' || m.id || '%'))`)
  return rows.map((row) => row.id)
}

export async function mediaUsage(tx: Prisma.TransactionClient, assetId: string): Promise<MediaUsage[]> {
  const result: MediaUsage[] = []
  const needle = `%${assetId.replace(/[%_\\]/g, '\\$&')}%`
  for (const [type, table, versions, foreignKey] of catalogTables) {
    const current = await tx.$queryRaw<Array<{ id: string; title: string }>>(Prisma.sql`SELECT id,title FROM ${Prisma.raw(table)} WHERE cover_asset_id=${assetId}`)
    result.push(...current.map((row) => ({ ...row, type, usage: 'draft' as const })))
    const history = await tx.$queryRaw<Array<{ id: string; title: string; usage: 'published' | 'history' }>>(Prisma.sql`
      SELECT v.id,c.title,CASE WHEN c.published_version_id=v.id AND c.status='published' AND c.deleted_at IS NULL THEN 'published' ELSE 'history' END AS usage
      FROM ${Prisma.raw(versions)} v JOIN ${Prisma.raw(table)} c ON c.id=v.${Prisma.raw(foreignKey)}
      WHERE v.snapshot::text LIKE ${needle}`)
    result.push(...history.map((row) => ({ ...row, type })))
  }
  const defaults = await tx.mediaDefaultRule.findMany({ where: { assetId }, select: { id: true, contentType: true, categoryKey: true } })
  const lessons = await tx.$queryRaw<Array<{ id: string; title: string; usage: 'draft' | 'published' | 'history' }>>`
    SELECT DISTINCT v.id,c.title,CASE WHEN c.published_version_id=v.id AND c.status='published' AND c.deleted_at IS NULL THEN 'published'
      WHEN c.current_draft_version_id=v.id THEN 'draft' ELSE 'history' END AS usage
    FROM lesson_blocks b JOIN course_lessons l ON l.id=b.lesson_id JOIN course_chapters ch ON ch.id=l.chapter_id
    JOIN course_versions v ON v.id=ch.course_version_id JOIN courses c ON c.id=v.course_id
    WHERE b.block_type='image' AND b.content_json->>'assetId'=${assetId}`
  result.push(...lessons.filter((row) => !result.some((item) => item.type === 'course' && item.id === row.id)).map((row) => ({ ...row, type: 'course' })))
  result.push(...defaults.map((rule) => ({ type: rule.contentType, id: rule.id, title: rule.categoryKey, usage: 'default' as const })))
  const settings = await tx.systemSetting.findMany({ where: { key: 'public_page_visuals' }, select: { key: true, value: true } })
  if (settings.some((setting) => JSON.stringify(setting.value).includes(assetId))) result.push({ type: 'page_hero', id: 'public_page_visuals', title: '页面视觉资源', usage: 'setting' })
  return result
}
