/** 开发期提取白名单；正式镜像仅包含输出，不包含账号夹具。修改内容时显式递增 release。 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { createHash } from 'node:crypto'
import path from 'node:path'
import { demoCourses, demoThemes, getCourseCurriculum, demoResourceHubContributions } from '../../packages/demo-fixtures/src/index'
import { catalogAssets } from '../../packages/catalog-assets/manifest'

const root = path.resolve(__dirname, '../..')
const sha = (data: Buffer | string) => createHash('sha256').update(data).digest('hex')
const source = JSON.parse(readFileSync(path.join(root, 'server/resources/community-starter/content.json'), 'utf8')) as {
  batch: string; posts: Array<{ id: string; title: string; body: string; postType: string; category: string; image: string; replies: Array<{ id: string; body: string }> }>
}
const starter = JSON.parse(readFileSync(path.join(root, 'server/resources/community-starter/manifest.json'), 'utf8')) as { images: Array<{ id: string; file: string }> }
const media: Record<string, { root: string; file: string; bytes: number; sha256: string; mime: string; width?: number; height?: number; alt?: string; kind?: string }> = {}
function asset(key: string, base: string, file: string, mime: string, extra = {}) {
  const buffer = readFileSync(path.join(root, base, file))
  media[key] = { root: base, file, bytes: buffer.length, sha256: sha(buffer), mime, ...extra }
  return key
}
const community = source.posts.map(p => ({ id: p.id, title: p.title, body: p.body, postType: p.postType, category: p.category,
  image: 'community:' + p.image, replies: p.replies.map(r => ({ id: r.id, body: r.body })) }))
for (const a of starter.images) asset('community:' + a.id, 'server/resources/community-starter', a.file, 'image/webp')
const courses = demoCourses.map(c => {
  const curriculum = getCourseCurriculum(c.slug)!
  const category = demoThemes.find(t => t.slug === c.theme)!.title
  const keys = [c.coverAssetKey, ...curriculum.chapters.flatMap(ch => ch.lessons.flatMap(l => l.blocks.filter(b => b.blockType === 'image').map(b => String(b.content.assetId))))]
  for (const key of keys) {
    const a = catalogAssets.find(a => a.assetKey === key)!
    asset(key, 'packages/catalog-assets', a.file, 'image/webp', { width: a.width, height: a.height, alt: a.altText, kind: a.kind })
  }
  return { slug: c.slug, title: c.title, summary: c.summary, cover: c.coverAssetKey, category, level: c.level, hours: c.hours,
    durationMinutes: c.durationMinutes, mode: c.mode, icon: c.icon, coverVariant: c.coverVariant, recommended: c.recommended,
    chapters: curriculum.chapters, sources: curriculum.sources }
})
const tutorials = demoResourceHubContributions.map(c => {
  const mediaKey = (file: string | undefined, mime: string) => file ? asset('tutorial:' + file.replace('/demo/resource-hub/', ''), 'frontend/public/demo/resource-hub', file.replace('/demo/resource-hub/', ''), mime) : null
  return { id: c.id, title: c.title, summary: c.summary, kind: c.kind, categoryCode: c.categoryCode, tags: c.tags,
    cover: mediaKey(c.coverUrl, 'image/jpeg')!, video: mediaKey(c.videoUrl, 'video/mp4'), attachment: mediaKey(c.attachmentUrl, 'text/plain'),
    banner: mediaKey(c.bannerUrl, 'image/jpeg'), featured: !!c.featured, liveReplay: !!c.liveReplay,
    durationSeconds: c.kind === 'video' ? 8 : null }
})
// 分类以正式迁移中的初始定义为准，避免把演示夹具的文案当成人工修改覆盖。
const categoryMigration = readFileSync(path.join(root, 'server/prisma/migrations/20260906100000_resource_cocreation/migration.sql'), 'utf8')
const categories = [...categoryMigration.matchAll(/\('(resource-category-[^']+)', '([^']+)', '([^']+)', '([^']+)', '([^']+)', (\d+), true, CURRENT_TIMESTAMP\)/g)].map(([, id, code, name, description, icon, order]) => ({ id: id!, code: code!, name: name!, description: description!, icon: icon!, sortOrder: Number(order) }))
if (categories.length !== 7) throw new Error('正式分类定义数量不完整')
const bundle = { release: 1, versions: { community: 1, courses: 1, tutorials: 1 }, legacyCommunityBatch: source.batch, community, courses, tutorials,
  categories,
  playlist: { id: 'resource-demo-collection-agent', name: 'Agent 入门播放列表', description: '从工具调用到多智能体协作', learningGoal: '按顺序完成四个 Agent 实践',
    items: ['resource-demo-first-agent', 'resource-demo-function', 'resource-demo-memory', 'resource-demo-multi-agent'] }, media }
const directory = path.join(root, 'server/resources/project-content')
const output = JSON.stringify(bundle, null, 2) + '\n'
if (process.argv.includes('--write')) { mkdirSync(directory, { recursive: true }); writeFileSync(path.join(directory, 'content.json'), output); writeFileSync(path.join(directory, 'manifest.json'), JSON.stringify({ release: bundle.release, sha256: sha(output) }, null, 2) + '\n') }
else if (readFileSync(path.join(directory, 'content.json'), 'utf8') !== output || JSON.parse(readFileSync(path.join(directory, 'manifest.json'), 'utf8')).sha256 !== sha(output)) throw new Error('正式内容清单过期，请递增版本后执行 content:prepare')
console.log(JSON.stringify({ community: community.length, replies: community.flatMap(p => p.replies).length, courses: courses.length, lessons: courses.flatMap(c => c.chapters.flatMap(ch => ch.lessons)).length, tutorials: tutorials.length, media: Object.keys(media).length, sha256: sha(output) }))
