import { describe, expect, it, vi } from 'vitest'
import { CommunityCommentService } from '../src/modules/community/comment.service'

const comment = (id: string, authorId = 'synthetic-author', status = 'published') => ({ id, postId: 'synthetic-post', authorId, status, revision: 2, parentId: null, rootId: null, deletedAt: null, body: '合成教学评论', contentBlocks: [], likeCount: 0, createdAt: new Date(0), author: { id: authorId, username: authorId, displayName: '合成学生', status: 'active', profile: {}, identityVerification: null, userRoles: [], receivedModeration: [], _count: { receivedModeration: 0 } }, reactions: [], moderationActions: [], _count: { replies: 0 } })

describe('评论复核读取与提交结果', () => {
  it('只映射当前页和本人的复核信息，使用额外一条确定下一页', async () => {
    const rows = Array.from({ length: 26 }, (_, n) => comment(`synthetic-${n}`))
    const prisma = { systemSetting: { findUnique: vi.fn(async () => null) },
      communityComment: { findMany: vi.fn(async () => rows) },
      communityQuestionState: { findUnique: vi.fn(async () => null) },
      contentReview: { findMany: vi.fn(async () => []) },
    }
    const service = new CommunityCommentService(prisma as never, {} as never, { assertPost: vi.fn(), authorExclusions: vi.fn(async () => ({ authors: [] })) } as never, {} as never, {} as never, {} as never)
    const result = await service.list('synthetic-viewer', 'synthetic-post')
    expect(result.items).toHaveLength(25)
    expect(result.nextCursor).toBe('synthetic-24')
    expect(prisma.communityComment.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ postId: 'synthetic-post', parentId: null }), take: 26 }))
    expect(prisma.contentReview.findMany).not.toHaveBeenCalled()
  })

  it('有界读取仍遮蔽被下架的资料，封禁父项仅显示占位', async () => {
    const masked = { ...comment('masked'), author: { ...comment('masked').author, receivedModeration: [{ expiresAt: null }] } }
    const banned = { ...comment('banned'), author: { ...comment('banned').author, _count: { receivedModeration: 1 } }, _count: { replies: 521 } }
    const prisma = { systemSetting: { findUnique: vi.fn(async () => null) }, communityComment: { findMany: vi.fn(async () => [masked, banned]) }, communityQuestionState: { findUnique: vi.fn(async () => null) }, contentReview: { findMany: vi.fn(async () => []) } }
    const service = new CommunityCommentService(prisma as never, {} as never, { assertPost: vi.fn(), authorExclusions: vi.fn(async () => ({ authors: [] })) } as never, {} as never, {} as never, {} as never)
    const { items } = await service.list('synthetic-viewer', 'synthetic-post')
    expect(items[0]).toMatchObject({ deleted: false, author: { username: '', displayName: '账号资料暂不可见' } })
    expect(items[1]).toMatchObject({ deleted: true, author: { id: '', username: '' }, body: '该评论已删除或不可见', contentBlocks: [], replyCount: 521 })
  })

  it('拒绝将另一帖子或另一父评论的游标用于当前分页', async () => {
    const prisma = { systemSetting: { findUnique: vi.fn(async () => null) }, communityComment: { findUnique: vi.fn(async () => ({ id: 'other', postId: 'another-post', parentId: null, createdAt: new Date() })), findMany: vi.fn() } }
    const service = new CommunityCommentService(prisma as never, {} as never, { assertPost: vi.fn() } as never, {} as never, {} as never, {} as never)
    await expect(service.list('viewer', 'synthetic-post', { cursor: 'other' })).rejects.toThrow('游标')
    expect(prisma.communityComment.findMany).not.toHaveBeenCalled()
  })
  it('评论超过500条仍定向返回刚保存的评论，不重复查询所有评论', async () => {
    const row = comment('synthetic-comment-501')
    const tx = { $queryRaw: vi.fn(), communityComment: { create: vi.fn(async () => row) }, communityPost: { update: vi.fn() } }
    const prisma = { systemSetting: { findUnique: vi.fn(async () => null) },
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
    const prisma = { systemSetting: { findUnique: vi.fn(async () => null) },
      communityComment: { findMany: vi.fn().mockResolvedValueOnce([row]).mockResolvedValueOnce([]) },
      communityQuestionState: { findUnique: vi.fn(async () => null) },
      contentReview: { findMany: vi.fn(async () => [{ id: 'synthetic-review', targetId: row.id, contentRevision: 2, findings: detection, status: 'rejected', reason: '请移除合成隐私信息后重投' }]) },
    }
    const service = new CommunityCommentService(prisma as never, {} as never, { assertPost: vi.fn(), authorExclusions: vi.fn(async () => ({ authors: [] })) } as never, {} as never, {} as never, {} as never)
    expect((await service.list(row.authorId, row.postId)).items).toEqual([expect.objectContaining({ body: row.body, deleted: false, status: 'pending_review', detection: { ...detection, review: { id: 'synthetic-review', status: 'rejected', reason: '请移除合成隐私信息后重投' } } })])
    expect(prisma.contentReview.findMany).toHaveBeenCalledWith({ where: { targetType: 'comment', OR: [{ targetId: row.id, contentRevision: 2 }] } })
    expect((await service.list('synthetic-other', row.postId)).items).toEqual([])
    expect(prisma.contentReview.findMany).toHaveBeenCalledOnce()
  })
})
