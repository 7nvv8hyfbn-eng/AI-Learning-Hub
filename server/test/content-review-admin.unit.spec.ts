import 'reflect-metadata'
import { describe, expect, it, vi } from 'vitest'
import { CommunityAdminController } from '../src/modules/community/admin.controller'
import { PERMISSIONS_KEY } from '../src/modules/auth/permissions.decorator'
import { ContentDetectionService } from '../src/modules/community/content-detection.service'
import { contentDetectionFields } from '@ai-learning-hub/contracts'

const setup = (targetType = 'post') => {
  const row = { id: 'synthetic-review', targetType, targetId: 'synthetic-target', contentRevision: 3, ruleVersion: 7, status: 'pending', payload: { changes: { bio: '合成待审简介' } } }
  const prisma = { contentReview: { findUnique: vi.fn(async () => row), findMany: vi.fn(async () => []), count: vi.fn(async () => 0) }, communityPost: { findFirst: vi.fn(async () => ({ title: '合成投稿', plainText: '合成正文', contentBlocks: [], labels: ['合成标签'], contribution: null })) } }
  const visibility = { auditAdminRead: vi.fn() }
  const controller = new CommunityAdminController(prisma as never, {} as never, {} as never, {} as never, {} as never, {} as never, {} as never, visibility as never, {} as never, {} as never)
  return { row, prisma, visibility, controller, user: { id: 'synthetic-reviewer', permissions: ['community.read', 'community.moderate'] } }
}

describe('内容复核后台读取边界', () => {
  it('规则和复核API均要求审核权限，列表不返回原始载荷', async () => {
    const { controller, prisma } = setup()
    for (const method of ['contentPolicy', 'contentPolicyHistory', 'configureContentPolicy', 'trialContent', 'contentReviews', 'contentReview', 'decideContent'] as const) expect(Reflect.getMetadata(PERMISSIONS_KEY, controller[method])).toEqual(['community.moderate'])
    await controller.contentReviews({ page: 1, pageSize: 20, status: 'pending' } as never)
    expect(prisma.contentReview.findMany).toHaveBeenCalledWith(expect.objectContaining({ select: { id: true, targetType: true, targetId: true, authorId: true, contentRevision: true, ruleVersion: true, status: true, findings: true, reason: true, createdAt: true } }))
  })
  it('帖子详情只读取匹配复核修订的文字，访问日志仅记录对象ID', async () => {
    const { controller, prisma, visibility, row, user } = setup()
    expect(await controller.contentReview(user as never, row.id)).toMatchObject({ contentAvailable: true, payload: { postTitle: '合成投稿', postBody: '合成正文', postLabels: '合成标签', mediaCaption: '' } })
    expect(prisma.communityPost.findFirst).toHaveBeenCalledWith({ where: { id: row.targetId, revision: 3, status: { not: 'draft' } }, include: { contribution: true } })
    expect(visibility.auditAdminRead).toHaveBeenCalledWith(user.id, 'content_review', row.id)
  })
  it('新正文不能冒充旧复核内容，失配时明确不可读取', async () => {
    const { controller, prisma, row, user } = setup()
    prisma.communityPost.findFirst.mockResolvedValue(null as never)
    expect(await controller.contentReview(user as never, row.id)).toMatchObject({ payload: null, contentAvailable: false })
  })
  it('资料复核返回保存的原始变更，不查询对外旧资料', async () => {
    const { controller, prisma, row, user } = setup('profile')
    expect(await controller.contentReview(user as never, row.id)).toMatchObject({ payload: row.payload, contentAvailable: true })
    expect(prisma.communityPost.findFirst).not.toHaveBeenCalled()
  })
  it('后台资源原文需要原资源查看权限，社区审核角色不能旁路读取', async () => {
    const { controller, visibility, row, user } = setup('resource')
    await expect(controller.contentReview(user as never, row.id)).rejects.toThrow('资源查看权限')
    expect(visibility.auditAdminRead).not.toHaveBeenCalled()
    await expect(controller.contentReview({ ...user, permissions: [...user.permissions, 'resource.read'] } as never, row.id)).resolves.toMatchObject({ contentAvailable: true })
  })
})

describe('后台隐藏后恢复的增量检测', () => {
  it.each((['post', 'comment'] as const).flatMap((target) => (['allow', 'warn', 'review', 'reject'] as const).map((action) => ({ target, action }))))('$target恢复重新检测并执行$action', async ({ target, action }) => {
    const post = { id: 'synthetic-post', authorId: 'synthetic-owner', revision: 3, status: 'published', deletedAt: null, publishedAt: new Date(0), title: '合成恢复检测', plainText: '合成恢复检测', contentBlocks: [], labels: [], bindings: [], topics: [], visibility: 'public', contribution: null }
    const comment = { id: 'synthetic-comment', postId: post.id, authorId: post.authorId, revision: 2, status: 'published', body: '合成恢复检测', contentBlocks: [], deletedAt: null }
    const row = target === 'post' ? post : comment
    const update = (value: typeof post | typeof comment, data: Record<string, unknown>) => Object.assign(value, { ...data, ...(data.revision ? { revision: value.revision + 1 } : {}) })
    const tx = {
      $queryRaw: vi.fn(),
      communityPost: { findUnique: vi.fn(async () => post), findUniqueOrThrow: vi.fn(async () => post), update: vi.fn(async ({ data }) => update(post, data)), count: vi.fn(async () => 1) },
      communityComment: { findUnique: vi.fn(async () => comment), findUniqueOrThrow: vi.fn(async () => comment), update: vi.fn(async ({ data }) => update(comment, data)), count: vi.fn(async () => comment.status === 'published' ? 1 : 0) },
      communityProfile: { updateMany: vi.fn() }, communityPostTopic: { findMany: vi.fn(async () => []) }, communityPostRevision: { createMany: vi.fn() }, communityQuestionState: { updateMany: vi.fn() },
      communityModerationAction: { create: vi.fn(), count: vi.fn(async () => 0) }, user: { count: vi.fn(async () => 1) }, activityEvent: { create: vi.fn() }, contentReview: { updateMany: vi.fn(), create: vi.fn() },
      systemSetting: { findUnique: vi.fn(async () => ({ value: { version: 7, rules: action === 'allow' ? [] : [{ id: 'synthetic-restore', content: '合成恢复检测', method: 'literal', fields: [...contentDetectionFields], category: 'school', action, enabled: true, explanation: '合成教学测试' }] } })), createMany: vi.fn() },
    }
    const prisma = { ...tx, $transaction: (fn: (client: typeof tx) => unknown) => fn(tx) }
    const notifications = { send: vi.fn() }
    const detection = new ContentDetectionService(prisma as never, notifications as never, {} as never, {} as never)
    const controller = new CommunityAdminController(prisma as never, {} as never, {} as never, notifications as never, {} as never, {} as never, {} as never, { adminWhere: vi.fn(async () => ({ status: { not: 'draft' } })) } as never, detection, {} as never)
    const user = { id: 'synthetic-reviewer', permissions: ['community.moderate'] } as never
    await expect(controller.moderate(user, target, row.id, { action: 'hide', reason: '旧路径不能绕过治理' })).rejects.toThrow('治理工作台')
    row.status = 'hidden' // 既有历史隐藏内容仍须通过当前检测后恢复
    const hiddenRevision = row.revision
    vi.clearAllMocks()
    const result = controller.moderate(user, target, row.id, { action: 'restore', reason: '重新检测合成测试内容' })
    if (action === 'reject') {
      await expect(result).rejects.toThrow('内容未发布')
      expect(row.status).toBe('hidden')
      expect(row.revision).toBe(hiddenRevision)
      expect(tx.contentReview.create).not.toHaveBeenCalled()
      expect(tx.communityModerationAction.create).not.toHaveBeenCalled()
      expect(notifications.send).not.toHaveBeenCalled()
    } else {
      await expect(result).resolves.toMatchObject({ handled: true, detection: { action, ruleVersion: 7, mediaReview: 'not_performed' } })
      expect(row.status).toBe(action === 'review' ? 'pending_review' : 'published')
      expect(tx.contentReview.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ targetType: target, targetId: row.id, contentRevision: hiddenRevision + 1, ruleVersion: 7, status: action === 'review' ? 'pending' : 'not_required' }) }))
      if (action === 'review') {
        if (target === 'post') expect(post.publishedAt).toBeNull()
        else expect(tx.communityPost.update).toHaveBeenCalledWith({ where: { id: post.id }, data: { commentCount: 0 } })
        await expect(controller.moderate(user, target, row.id, { action: 'restore', reason: '不能绕过指定修订复核' })).rejects.toThrow('对应修订')
      }
    }
  })
})
