import { describe, expect, it, vi } from 'vitest'
import { demoCourses } from '@ai-learning-hub/demo-fixtures'
import { curriculumUpgradeReason, type ExistingCurriculum } from '../prisma/course-curriculum'
import { upgradeCourses } from '../prisma/upgrade-courses'

// 固定旧 Seed 结构，用于验证只允许升级未改动的模板，不能放宽为仅按来源判断。
function legacyCourse() {
  const fixture = demoCourses[0], payload = { durationMinutes: 150, coverAssetId: 'old-cover' }
  const chapterNames = ['概念与目标', '核心方法', '受控实践', '复盘与验证']
  const names = [['建立问题意识', '理解关键术语', '明确学习成果'], ['拆解核心原理', '阅读结构图解', '辨析常见误区'], ['准备实践环境', '完成受控操作', '检查运行结果'], ['整理关键要点', '完成知识测验', '规划下一步学习']]
  return {
    id: 'course1', slug: fixture.slug, title: fixture.title, summary: fixture.summary, dataOrigin: 'demo_seed', version: 1,
    status: 'published', deletedAt: null, currentDraftVersionId: 'v1', publishedVersionId: 'v1', coverAssetId: 'old-cover', payload,
    coverAsset: { id: 'old-cover', assetKey: 'course--' + fixture.slug, revision: 1, status: 'active', deletedAt: null, source: 'image2_seed' },
    versions: [{ id: 'v1', versionNo: 1, snapshot: { title: fixture.title, summary: fixture.summary, data: { ...payload } },
      chapters: chapterNames.map((title, ci) => ({ title: `${ci + 1}. ${title}`, description: `${fixture.title}的${title}学习单元。`, sortOrder: ci + 1,
        lessons: names[ci].map((name, li) => ({ title: name, summary: fixture.summary + name + '。', lessonType: 'article', sortOrder: li + 1, durationMinutes: 13,
          blocks: [
            ['heading', { text: fixture.title + '：' + name }], ['paragraph', { text: fixture.summary }],
            ['diagram', { title: '学习结构', nodes: ['输入', '方法', '结果', '验证'] }],
            ['code', { language: 'text', code: `目标: ${name}\n检查: 能够解释并完成对应练习` }],
            ['key_points', { items: ['理解关键概念', '完成受控练习', '记录验证证据'] }],
            ['quiz', { question: `如何验证“${name}”已经完成？`, answer: '用可复核的结果和学习记录验证。' }],
            ['resource', { title: '配套学习资料', route: '/resources' }], ['next_lesson', { title: names[ci][li + 1] || '进入下一章节' }],
          ].map(([blockType, content], bi) => ({ blockType, content, sortOrder: bi + 1 })),
        })),
      })),
    }],
  } as unknown as ExistingCurriculum
}

describe('显式演示课程升级保护', () => {
  it('只接纳完整旧模板；正常盘点没有写入', async () => {
    const course = legacyCourse()
    expect(curriculumUpgradeReason(course, demoCourses[0])).toBeNull()
    const db = { course: { findMany: vi.fn(async () => [course]) }, $transaction: vi.fn() }
    const result = await upgradeCourses(db as never)
    expect(result.mode).toBe('dry-run')
    expect(result.report.filter((row) => row.status === 'eligible')).toHaveLength(1)
    expect(db.$transaction).not.toHaveBeenCalled()
  })
  it.each(['admin_created', 'imported'])('保护 %s 来源', (dataOrigin) => {
    expect(curriculumUpgradeReason({ ...legacyCourse(), dataOrigin }, demoCourses[0])).toContain('来源')
  })
  it('保护新草稿、新发布、改名、改正文、改顺序及换过的封面', () => {
    const edits: Array<(course: ExistingCurriculum) => void> = [
      (course) => { course.currentDraftVersionId = 'v2' },
      (course) => { course.versions.push({ ...course.versions[0], id: 'v2', versionNo: 2 }) },
      (course) => { course.version++ }, (course) => { course.title += '（教师修订）' },
      (course) => { course.versions[0].chapters[0].lessons[0].blocks[1].content = { text: '教师真实内容' } },
      (course) => { course.versions[0].chapters[0].lessons[0].blocks[5].content = { question: '新问题', answer: '新答案' } },
      (course) => { course.versions[0].chapters[0].sortOrder = 8 },
      (course) => { course.coverAsset!.revision++ },
    ]
    for (const edit of edits) { const course = legacyCourse(); edit(course); expect(curriculumUpgradeReason(course, demoCourses[0])).not.toBeNull() }
  })
  it('重复执行已升级课程不导入图片、不新建版本', async () => {
    const course = legacyCourse()
    course.versions[0].snapshot = { curriculumVersion: 'xiaoxue-v2' }
    const db = { course: { findMany: vi.fn(async () => [course]) }, $transaction: vi.fn() }
    const result = await upgradeCourses(db as never, true)
    expect(result.report[0]).toMatchObject({ status: 'skipped', reason: '已升级' })
    expect(db.$transaction).not.toHaveBeenCalled()
  })
})
