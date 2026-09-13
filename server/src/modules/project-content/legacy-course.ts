import { Prisma } from '@prisma/client'
import { isDeepStrictEqual } from 'node:util'
import type { ContentBundle, ContentMedia } from './bundle'
export const curriculumInclude = {
  coverAsset: true,
  versions: { orderBy: { versionNo: 'asc' }, include: { chapters: { orderBy: { sortOrder: 'asc' }, include: {
    lessons: { orderBy: { sortOrder: 'asc' }, include: { blocks: { orderBy: { sortOrder: 'asc' } } } },
  } } } },
} as const satisfies Prisma.CourseInclude
export type ExistingCurriculum = Prisma.CourseGetPayload<{ include: typeof curriculumInclude }>
const object = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}

/** 对照旧 Seed 的完整结构；任何人工改动或新版本都保守跳过。 */
export function curriculumUpgradeReason(course: ExistingCurriculum | null, fixture: { slug: string; title: string; summary: string }): string | null {
  if (!course) return '课程不存在'
  if (course.dataOrigin !== 'demo_seed') return '来源为 ' + course.dataOrigin
  if (course.deletedAt || course.status !== 'published') return '课程已删除、归档或未发布'
  if (course.versions.some(version => object(version.snapshot).curriculumVersion === 'xiaoxue-v2')) return '已升级'
  const version = course.versions[0]
  if (course.version !== 1 || course.versions.length !== 1 || version?.versionNo !== 1 ||
    course.currentDraftVersionId !== version.id || course.publishedVersionId !== version.id) return '已有编辑或人工发布版本'
  if (course.title !== fixture.title || course.summary !== fixture.summary) return '标题或简介已修改'
  const snapshot = object(version.snapshot), payload = object(course.payload)
  if (snapshot.title !== fixture.title || snapshot.summary !== fixture.summary || !isDeepStrictEqual(snapshot.data, payload)) return '基础信息与原始快照不一致'
  const cover = course.coverAsset
  if (!cover || cover.assetKey !== 'course--' + fixture.slug || cover.source !== 'image2_seed' || cover.revision !== 1 || cover.status !== 'active' || cover.deletedAt ||
    payload.coverAssetId !== cover.id || course.coverAssetId !== cover.id) return '原始封面已修改或不可用'
  if (typeof payload.durationMinutes !== 'number' || payload.durationMinutes <= 0) return '原始时长无效'
  const chapterNames = ['概念与目标', '核心方法', '受控实践', '复盘与验证']
  const lessonNames = [
    ['建立问题意识', '理解关键术语', '明确学习成果'], ['拆解核心原理', '阅读结构图解', '辨析常见误区'],
    ['准备实践环境', '完成受控操作', '检查运行结果'], ['整理关键要点', '完成知识测验', '规划下一步学习'],
  ]
  if (version.chapters.length !== chapterNames.length) return '章节结构已修改'
  for (const [ci, chapter] of version.chapters.entries()) {
    if (chapter.title !== (ci + 1) + '. ' + chapterNames[ci] || chapter.description !== fixture.title + '的' + chapterNames[ci] + '学习单元。' ||
      chapter.sortOrder !== ci + 1 || chapter.lessons.length !== 3) return '章节内容已修改'
    for (const [li, lesson] of chapter.lessons.entries()) {
      const name = lessonNames[ci][li]
      if (lesson.title !== name || lesson.summary !== fixture.summary + name + '。' || lesson.lessonType !== 'article' ||
        lesson.sortOrder !== li + 1 || lesson.durationMinutes !== Math.max(12, Math.round(payload.durationMinutes / 12))) return '课时内容已修改'
      const expected = [
        ['heading', { text: fixture.title + '：' + name }], ['paragraph', { text: fixture.summary }],
        ['diagram', { title: '学习结构', nodes: ['输入', '方法', '结果', '验证'] }],
        ['code', { language: 'text', code: '目标: ' + name + '\n检查: 能够解释并完成对应练习' }],
        ['key_points', { items: ['理解关键概念', '完成受控练习', '记录验证证据'] }],
        ['quiz', { question: '如何验证“' + name + '”已经完成？', answer: '用可复核的结果和学习记录验证。' }],
        ['resource', { title: '配套学习资料', route: '/resources' }],
        ['next_lesson', { title: lessonNames[ci][li + 1] || '进入下一章节' }],
      ]
      if (lesson.blocks.length !== expected.length || lesson.blocks.some((block, bi) =>
        block.sortOrder !== bi + 1 || block.blockType !== expected[bi][0] || !isDeepStrictEqual(block.content, expected[bi][1]))) return '正文、练习或内容块已修改'
    }
  }
  return null
}

/** 已通过旧版 xiaoxue-v2 升级器的课程也逐块核验，不把版本名称当作覆盖许可。 */
export async function legacyCourseReason(tx: Prisma.TransactionClient, course: ExistingCurriculum | null, definition: ContentBundle['courses'][number], media: ContentBundle['media']) {
  const reason = curriculumUpgradeReason(course, definition)
  if (!reason || !course) return reason
  const version = course.versions.find(v => v.id === course.publishedVersionId)
  if (course.dataOrigin !== 'demo_seed' || course.version !== 2 || course.versions.length !== 2 || version?.versionNo !== 2 || course.currentDraftVersionId !== version.id || course.status !== 'published' || course.deletedAt || course.title !== definition.title || course.summary !== definition.summary || object(version.snapshot).curriculumVersion !== 'xiaoxue-v2') return reason
  const payload = { ...object(object(version.snapshot).data) }; delete payload.coverImage
  if (!isDeepStrictEqual(payload, course.payload) || version.chapters.length !== definition.chapters.length) return '旧课程基础资料已修改'
  const assetIds = [course.coverAssetId!, ...version.chapters.flatMap(ch => ch.lessons.flatMap(l => l.blocks.filter(b => b.blockType === 'image').map(b => String(object(b.content).assetId))))]
  const assets = await tx.mediaAsset.findMany({ where: { id: { in: assetIds } }, include: { file: true } })
  const assetMatches = (id: string, key: string) => {
    const asset = assets.find(a => a.id === id), expected = (media as Record<string, ContentMedia>)[key]
    return asset && expected && asset.assetKey === key && asset.source === 'image2_seed' && asset.revision === 1 && asset.status === 'active' && !asset.deletedAt && !asset.file.quarantinedAt && asset.file.checksum === expected.sha256
  }
  if (!assetMatches(course.coverAssetId!, definition.cover)) return '旧课程封面已修改'
  for (const [ci, expectedChapter] of definition.chapters.entries()) {
    const ch = version.chapters[ci]!
    if (ch.title !== expectedChapter.title || ch.sortOrder !== ci + 1 || ch.lessons.length !== expectedChapter.lessons.length) return '旧课程章节已修改'
    for (const [li, expectedLesson] of expectedChapter.lessons.entries()) {
      const lesson = ch.lessons[li]!
      if (lesson.title !== expectedLesson.title || lesson.summary !== expectedLesson.summary || lesson.durationMinutes !== expectedLesson.durationMinutes || lesson.sortOrder !== li + 1 || lesson.blocks.length !== expectedLesson.blocks.length) return '旧课程课时已修改'
      for (const [bi, expectedBlock] of expectedLesson.blocks.entries()) {
        const block = lesson.blocks[bi]!, actual = object(block.content), expected = object(expectedBlock.content)
        if (block.blockType !== expectedBlock.blockType || block.sortOrder !== bi + 1) return '旧课程正文结构已修改'
        if (block.blockType === 'image') {
          if (!assetMatches(String(actual.assetId), String(expected.assetId)) || actual.alt !== expected.alt || actual.caption !== expected.caption) return '旧课程插图已修改'
        } else if (!isDeepStrictEqual(actual, expected)) return '旧课程正文已修改'
      }
    }
  }
  return null
}
