import { Prisma, type Course } from '@prisma/client'
import { curriculumVersion, demoThemes, getCourseCurriculum, type DemoCourse } from '@ai-learning-hub/demo-fixtures'
import { createRequire } from 'node:module'
import { isDeepStrictEqual } from 'node:util'

export const curriculumInclude = {
  coverAsset: true,
  versions: { orderBy: { versionNo: 'asc' }, include: { chapters: { orderBy: { sortOrder: 'asc' }, include: {
    lessons: { orderBy: { sortOrder: 'asc' }, include: { blocks: { orderBy: { sortOrder: 'asc' } } } },
  } } } },
} as const satisfies Prisma.CourseInclude
export type ExistingCurriculum = Prisma.CourseGetPayload<{ include: typeof curriculumInclude }>
const object = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
const json = (value: unknown): Prisma.InputJsonObject => JSON.parse(JSON.stringify(value)) as Prisma.InputJsonObject

export function curriculumPayload(fixture: DemoCourse, coverAssetId: string) {
  const theme = demoThemes.find((item) => item.slug === fixture.theme)
  return {
    coverAssetId, category: theme?.title || '', level: fixture.level, hours: fixture.hours, durationMinutes: fixture.durationMinutes,
    mode: fixture.mode, icon: fixture.icon, coverVariant: fixture.coverVariant, learners: fixture.learners, rating: fixture.rating,
    chapters: fixture.chapters, instructor: { name: fixture.instructor, title: 'AI 创客课程讲师' },
    certificate: (theme?.title || 'AI') + ' 学习证书', recommended: fixture.recommended, progress: fixture.progress,
  }
}

/** 新建版本，保留原课程 ID、旧章节、学习记录和所有历史快照。 */
export async function createCurriculumVersion(tx: Prisma.TransactionClient, course: Pick<Course, 'id' | 'title' | 'summary'>, fixture: DemoCourse, assetIds: Record<string, string>, versionNo: number) {
  const curriculum = getCourseCurriculum(fixture.slug)
  const coverAssetId = assetIds[fixture.coverAssetKey]
  if (!curriculum || !coverAssetId) throw new Error('课程或封面未就绪：' + fixture.slug)
  const payload = curriculumPayload(fixture, coverAssetId)
  const version = await tx.courseVersion.create({ data: {
    courseId: course.id, versionNo,
    snapshot: json({ title: course.title, summary: course.summary, data: payload, curriculumVersion }),
    chapters: { create: curriculum.chapters.map((chapter, ci) => ({
      title: chapter.title, sortOrder: ci + 1, lessons: { create: chapter.lessons.map((lesson, li) => ({
        title: lesson.title, summary: lesson.summary, durationMinutes: lesson.durationMinutes, lessonType: 'article', sortOrder: li + 1,
        blocks: { create: lesson.blocks.map((block, bi) => {
          const content = { ...block.content }
          if (block.blockType === 'image') {
            const assetId = assetIds[String(content.assetId)]
            if (!assetId) throw new Error('课程插图未导入：' + content.assetId)
            content.assetId = assetId
          }
          return { blockType: block.blockType, sortOrder: bi + 1, content: json(content) }
        }) },
      })) },
    })) },
  } })
  // 与现有 Seed 一致，运行镜像仅依赖编译后的应用模块。
  const { freezeCourseImages } = createRequire(__filename)('../dist/modules/courses/course-images') as typeof import('../src/modules/courses/course-images')
  await freezeCourseImages(tx, version.id, coverAssetId)
  await tx.course.update({ where: { id: course.id }, data: {
    payload, coverAssetId, currentDraftVersionId: version.id, publishedVersionId: version.id, status: 'published',
    publishedAt: new Date(), ...(versionNo > 1 ? { version: { increment: 1 } } : {}),
  } })
  return version
}

/** 对照旧 Seed 的完整结构；任何人工改动或新版本都保守跳过。 */
export function curriculumUpgradeReason(course: ExistingCurriculum | null, fixture: DemoCourse): string | null {
  if (!course) return '课程不存在'
  if (course.dataOrigin !== 'demo_seed') return '来源为 ' + course.dataOrigin
  if (course.versions.some((version) => object(version.snapshot).curriculumVersion === curriculumVersion)) return '已升级'
  if (course.deletedAt || course.status !== 'published') return '课程已删除、归档或未发布'
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
