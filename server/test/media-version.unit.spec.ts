import { describe, expect, it, vi } from 'vitest'
import { CourseService } from '../src/modules/courses/course.service'
import { LabService } from '../src/modules/labs/lab.service'
import { ChallengeService } from '../src/modules/challenges/challenge.service'
import { ArticleService } from '../src/modules/articles/article.service'

describe('媒体快照相关结构写入的事务边界', () => {
  it('课程发布结构首次编辑克隆草稿并映射块ID，原发布记录不被修改', async () => {
    const version = { id: 'published', courseId: 'course1', snapshot: { data: { coverAssetId: 'cover-old' }, mediaFiles: [{ assetId: 'image-old', fileId: 'file-old' }], publishedAt: '2026-09-01' }, chapters: [{ id: 'chapter-old', title: '旧章节', description: '', sortOrder: 0, lessons: [{ id: 'lesson-old', title: '旧课时', summary: '', lessonType: 'article', durationMinutes: 10, sortOrder: 0, blocks: [{ id: 'block-old', blockType: 'paragraph', sortOrder: 0, content: { text: '旧正文' } }] }] }] }
    const tx = {
      course: { findUnique: vi.fn(async () => ({ id: 'course1', currentDraftVersionId: 'published', publishedVersionId: 'published', currentDraftVersion: version, _count: { versions: 1 } })), update: vi.fn() },
      lessonBlock: { findUnique: vi.fn(async () => ({ lesson: { chapter: { version } } })), create: vi.fn(async () => ({ id: 'block-new' })), update: vi.fn(async () => ({ id: 'block-new' })) },
      courseVersion: { create: vi.fn(async () => ({ id: 'draft-new' })) },
      courseChapter: { create: vi.fn(async () => ({ id: 'chapter-new' })) },
      courseLesson: { create: vi.fn(async () => ({ id: 'lesson-new' })) },
    }
    const db = { $transaction: vi.fn(async (fn: (client: unknown) => unknown) => fn(tx)) }
    const binding = vi.fn()
    const service = new CourseService(db as never, { binding } as never)
    const result = await service.editStructure('block', 'block-old', (client, id) => client.lessonBlock.update({ where: { id }, data: { content: { text: '新正文' } } }))
    expect(result.id).toBe('block-new')
    expect(binding).toHaveBeenCalledWith(tx, undefined)
    expect(tx.lessonBlock.update).toHaveBeenCalledWith({ where: { id: 'block-new' }, data: { content: { text: '新正文' } } })
    expect(tx.courseVersion.create.mock.calls[0]).toBeDefined()
    expect(version.chapters[0]!.lessons[0]!.blocks[0]!.content).toEqual({ text: '旧正文' })
    expect(version.snapshot.mediaFiles).toEqual([{ assetId: 'image-old', fileId: 'file-old' }])
    expect(tx.courseVersion.create).toHaveBeenCalledWith({ data: { courseId: 'course1', versionNo: 2, snapshot: { data: { coverAssetId: 'cover-old' } } } })
  })
  it('已有其他草稿时拒绝过期发布结构ID，不按位置猜映射', async () => {
    const tx = {
      courseChapter: { findUnique: vi.fn(async () => ({ version: { id: 'published', courseId: 'course1' } })) },
      course: { findUnique: vi.fn(async () => ({ currentDraftVersionId: 'draft-new', publishedVersionId: 'published' })) },
    }
    const db = { $transaction: vi.fn(async (fn: (client: unknown) => unknown) => fn(tx)) }, change = vi.fn()
    await expect(new CourseService(db as never, { binding: vi.fn() } as never).editStructure('chapter', 'old', change)).rejects.toMatchObject({ status: 409 })
    expect(change).not.toHaveBeenCalled()
  })
  it('实训确保草稿、结构写与刷新严格使用同一事务，异常不刷新', async () => {
    const order: string[] = [], tx = {}, db = { $transaction: vi.fn(async (fn: (client: unknown) => unknown) => fn(tx)) }
    const service = new LabService(db as never, { binding: vi.fn(async () => { order.push('lock') }) } as never)
    vi.spyOn(service as any, 'ensureDraft').mockImplementation(async (_id, client) => { expect(client).toBe(tx); order.push('draft'); return 'draft1' })
    vi.spyOn(service as any, 'refreshDraft').mockImplementation(async (_id, client) => { expect(client).toBe(tx); order.push('snapshot') })
    await service.editDraft('lab1', async (client) => { expect(client).toBe(tx); order.push('structure'); return true })
    expect(order).toEqual(['lock', 'draft', 'structure', 'snapshot'])
    order.length = 0
    await expect(service.editDraft('lab1', async () => { throw new Error('invalid structure') })).rejects.toThrow()
    expect(order).toEqual(['lock', 'draft'])
  })
  it.each(['linkQuestionBank', 'linkPaper'] as const)('挑战%s的关联写入和快照刷新在同一个锁内', async (method) => {
    const tx = { challenge: { update: vi.fn() } }, db = { $transaction: vi.fn(async (fn: (client: unknown) => unknown) => fn(tx)) }
    const binding = vi.fn(), service = new ChallengeService(db as never, { binding } as never)
    const draft = vi.spyOn(service as any, 'ensureDraft').mockResolvedValue('draft1')
    const refresh = vi.spyOn(service as any, 'refreshDraft').mockResolvedValue(undefined)
    vi.spyOn(service, 'detail').mockResolvedValue({} as never)
    await service[method]('challenge1', 'target1')
    expect(binding).toHaveBeenCalledWith(tx, undefined)
    expect(draft).toHaveBeenCalledWith('challenge1', tx)
    expect(refresh).toHaveBeenCalledWith('challenge1', tx)
    expect(tx.challenge.update).toHaveBeenCalledTimes(1)
  })
  it('文章定时发布准备与快照使用同事务，不从控制器分段提交', async () => {
    const tx = { article: { update: vi.fn(async () => ({ id: 'a1' })) } }, db = { $transaction: vi.fn(async (fn: (client: unknown) => unknown) => fn(tx)) }
    const service = new ArticleService(db as never, { binding: vi.fn() } as never)
    const draft = vi.spyOn(service as any, 'ensureDraft').mockResolvedValue('draft1')
    const refresh = vi.spyOn(service as any, 'refreshDraft').mockResolvedValue(undefined)
    await service.schedule('a1', new Date('2030-01-01'))
    expect(draft).toHaveBeenCalledWith('a1', tx)
    expect(refresh).toHaveBeenCalledWith('a1', tx)
    expect(tx.article.update).toHaveBeenCalledTimes(1)
  })
})
