/** 开发期提取白名单；正式镜像仅包含输出，不包含账号夹具。修改内容时显式递增 release。 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { createHash } from 'node:crypto'
import path from 'node:path'
import { demoCourses, demoThemes, demoLabs, getCourseCurriculum, demoResourceHubContributions } from '../../packages/demo-fixtures/src/index'
import { catalogAssets } from '../../packages/catalog-assets/manifest'

const root = path.resolve(__dirname, '../..')
const sha = (data: Buffer | string) => createHash('sha256').update(data).digest('hex')
const source = JSON.parse(readFileSync(path.join(root, 'server/resources/community-starter/content.json'), 'utf8')) as {
  batch: string; posts: Array<{ id: string; title: string; body: string; postType: string; category: string; image: string; replies: Array<{ id: string; body: string }> }>
}
const starter = JSON.parse(readFileSync(path.join(root, 'server/resources/community-starter/manifest.json'), 'utf8')) as { images: Array<{ id: string; file: string }> }
const media: Record<string, { root: string; file: string; bytes: number; sha256: string; mime: string; width?: number; height?: number; alt?: string; kind?: string; contentType?: string }> = {}
function asset(key: string, base: string, file: string, mime: string, extra = {}) {
  const buffer = readFileSync(path.join(root, base, file))
  media[key] = { root: base, file, bytes: buffer.length, sha256: sha(buffer), mime, ...extra }
  return key
}
const topics = [
  { slug: 'ai-hardware', name: 'AI硬件', description: '交流开发板、传感器与智能硬件实践。', accent: 'green' },
  { slug: 'model-deployment', name: '大模型部署', description: '讨论模型部署、运行环境与服务验证。', accent: 'blue' },
  { slug: 'ai-applications', name: 'AI应用', description: '分享 AI 应用、Agent 与综合项目经验。', accent: 'purple' },
  { slug: 'ai-insights', name: 'AI咨询', description: '交流 AI 学习问题、技术观察与应用方向。', accent: 'orange' },
]
const showcases = [
  { key: 'ai-assistant', displayName: 'AI 学习助手', headline: '学习路线与入门指引', bio: '平台官方展示主页，介绍 AI 学习方向与入门资源。当前不提供在线问答服务。' },
  { key: 'lab-guide', displayName: '实训指导', headline: '模拟实训与实践指引', bio: '平台官方展示主页，帮助了解模拟实训的目标、步骤和复盘方法。' },
  { key: 'course-team', displayName: '课程运营', headline: '课程与教程内容指引', bio: '平台官方展示主页，介绍通识课程、教程中心与学习内容。' },
]
const community = source.posts.map(p => ({ id: p.id, title: p.title, body: p.body, postType: p.postType, category: p.category, topics: [topics.find(t => t.name === p.category)!.slug],
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
const stepNames = ['阅读任务目标', '检查实验环境', '配置关键参数', '执行受控操作', '观察运行日志', '验证输出结果', '修正异常状态', '提交实验报告']
const labs = demoLabs.map(l => {
  const a = catalogAssets.find(a => a.assetKey === l.coverAssetKey)!
  asset(l.coverAssetKey, 'packages/catalog-assets', a.file, 'image/webp', { width: a.width, height: a.height, alt: a.altText, kind: a.kind, contentType: 'lab' })
  return { slug: l.slug, title: l.title, summary: l.summary, labType: l.labType, cover: l.coverAssetKey,
    category: { command: 'Linux 命令', deployment: '模型部署', hardware: '智能硬件', project: '综合项目', agent: 'AI Agent' }[l.labType],
    level: l.level, durationMinutes: l.durationMinutes, icon: l.icon, coverVariant: l.coverVariant, result: l.result, skills: l.skills,
    steps: Array.from({ length: l.steps }, (_, index) => ({ stepKey: `step-${index + 1}`, title: stepNames[index]!, description: `${l.title}：${stepNames[index]}。`,
      sortOrder: index, instruction: { action: 'confirm', type: l.labType, expectedLog: `${stepNames[index]}完成` }, validator: { type: 'confirmation', expected: true },
      score: Math.floor(100 / l.steps) + (index === l.steps - 1 ? 100 % l.steps : 0) })) }
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
const bundle = { release: 2, versions: { community: 2, courses: 1, tutorials: 1, labs: 1 }, legacyCommunityBatch: source.batch, community, topics, showcases, courses, tutorials, labs,
  categories,
  playlist: { id: 'resource-demo-collection-agent', name: 'Agent 入门播放列表', description: '从工具调用到多智能体协作', learningGoal: '按顺序完成四个 Agent 实践',
    items: ['resource-demo-first-agent', 'resource-demo-function', 'resource-demo-memory', 'resource-demo-multi-agent'] }, media }
const directory = path.join(root, 'server/resources/project-content')
const output = JSON.stringify(bundle, null, 2) + '\n'
if (process.argv.includes('--write')) { mkdirSync(directory, { recursive: true }); writeFileSync(path.join(directory, 'content.json'), output); writeFileSync(path.join(directory, 'manifest.json'), JSON.stringify({ release: bundle.release, sha256: sha(output) }, null, 2) + '\n') }
else if (readFileSync(path.join(directory, 'content.json'), 'utf8') !== output || JSON.parse(readFileSync(path.join(directory, 'manifest.json'), 'utf8')).sha256 !== sha(output)) throw new Error('正式内容清单过期，请递增版本后执行 content:prepare')
console.log(JSON.stringify({ community: community.length, replies: community.flatMap(p => p.replies).length, topics: topics.length, showcases: showcases.length, courses: courses.length, lessons: courses.flatMap(c => c.chapters.flatMap(ch => ch.lessons)).length, tutorials: tutorials.length, labs: labs.length, steps: labs.reduce((n, l) => n + l.steps.length, 0), media: Object.keys(media).length, sha256: sha(output) }))
