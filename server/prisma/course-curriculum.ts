import { Prisma, type Course } from '@prisma/client'
import { curriculumVersion, demoThemes, getCourseCurriculum, type DemoCourse } from '@ai-learning-hub/demo-fixtures'
import { createRequire } from 'node:module'

export { curriculumInclude, curriculumUpgradeReason, type ExistingCurriculum } from '../src/modules/project-content/legacy-course'
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
