import { describe, expect, it, vi } from 'vitest'
import { CommunityCommentService } from '../src/modules/community/comment.service'

const comment = (id: string, authorId = 'synthetic-author', status = 'published') => ({ id, postId: 'synthetic-post', authorId, status, revision: 2, parentId: null, rootId: null, deletedAt: null, body: '合成教学评论', contentBlocks: [], likeCount: 0, createdAt: new Date(0), author: { id: authorId, username: authorId, displayName: '合成学生', status: 'active', userRoles: [] }, reactions: [] })

describe('评论复核读取与提交结果', () => {
  it('评论超过500条仍定向返回刚保存的评论，不重复查询所有评论', async () => {
    const row = comment('synthetic-comment-501')
    const tx = { $queryRaw: vi.fn(), communityComment: { create: vi.fn(async () => row) }, communityPost: { update: vi.fn() } }
    const prisma = {
      $transaction: (fn: (tx: unknown) => Promise<unknown>) => fn(tx),
      communityComment: { findMany: vi.fn(async ({ where, take }: { where: { id?: string }; take: number }) => where.id === row.id ? [row] : Array.from({ length: take }, (_, n) => comment(`synthetic-comment-${n}`))) },
      communityQuestionState: { findUnique: vi.fn(async () => null) },
      contentReview: { findMany: vi.fn(async () => []) },
    }
    const visibility = { assertOperation: vi.fn(), assertPost: vi.fn(async () => ({ status: 'published', authorId: 'synthetic-other', postType: 'note' })), consumeQuota: vi.fn(), authorExclusions: vi.fn(async () => ({ authors: [] })) }
    const service = new CommunityCommentService(prisma as never, { blocks: vi.fn(async () => ({ clean: [], plainText: row.body })) } as never, visibility as never, { send: vi.fn() } as never, { record: vi.fn() } as never, { check: vi.fn(async () => ({ action: 'allow' })), record: vi.fn() } as never)
    expect(await service.save(row.authorId, row.postId, { contentBlocks: [] })).toMatchObject({ id: row.id })
    expect(prisma.communityComment.findMany).toHaveBeenCalledOnce()
    expect(prisma.communityComment.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ id: row.id }), take: 1 }))
  })

  it('重载后本人可读待审正文和驳回理由，其他读者不查询审核载荷', async () => {
    const row = comment('synthetic-held', 'synthetic-author', 'pending_review')
    const detection = { action: 'review', ruleVersion: 1, mediaReview: 'not_performed', hits: [] }
    const prisma = {
      communityComment: { findMany: vi.fn(async ({ where }: { where: { OR: Array<{ authorId?: string }> } }) => where.OR.some((clause) => clause.authorId === row.authorId) ? [row] : []) },
      communityQuestionState: { findUnique: vi.fn(async () => null) },
      contentReview: { findMany: vi.fn(async () => [{ id: 'synthetic-review', targetId: row.id, contentRevision: 2, findings: detection, status: 'rejected', reason: '请移除合成隐私信息后重投' }]) },
    }
    const service = new CommunityCommentService(prisma as never, {} as never, { assertPost: vi.fn(), authorExclusions: vi.fn(async () => ({ authors: [] })) } as never, {} as never, {} as never, {} as never)
    expect(await service.list(row.authorId, row.postId)).toEqual([expect.objectContaining({ body: row.body, deleted: false, status: 'pending_review', detection: { ...detection, review: { id: 'synthetic-review', status: 'rejected', reason: '请移除合成隐私信息后重投' } } })])
    expect(prisma.contentReview.findMany).toHaveBeenCalledWith({ where: { targetType: 'comment', OR: [{ targetId: row.id, contentRevision: 2 }] } })
    expect(await service.list('synthetic-other', row.postId)).toEqual([])
    expect(prisma.contentReview.findMany).toHaveBeenCalledOnce()
  })
})
