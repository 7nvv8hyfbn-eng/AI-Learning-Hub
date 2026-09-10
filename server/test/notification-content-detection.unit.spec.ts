import { describe, expect, it, vi } from 'vitest'
import { CommunityNotificationService } from '../src/modules/community/notification.service'

const notification = (entityType = 'content_review', entityId = 'synthetic-review', notificationType = 'moderation') => ({ id: `synthetic-${entityId}`, recipientId: 'synthetic-owner', actorId: 'synthetic-reviewer', actorIds: ['synthetic-reviewer'], entityType, entityId, notificationType, createdAt: new Date(0), readAt: null })
const setup = (rows = [notification()]) => {
  const reviews = [{ id: 'synthetic-review', authorId: 'synthetic-owner', targetType: 'post', targetId: 'synthetic-post', contentRevision: 3, status: 'rejected', reason: '请补充合成案例说明' }]
  const prisma = { systemSetting: { findUnique: vi.fn(async () => null) },
    userNotification: { findMany: vi.fn(async () => rows), createMany: vi.fn(), updateMany: vi.fn() },
    user: { findMany: vi.fn(async () => []) },
    communityPost: { findMany: vi.fn(async () => []) },
    notification: { findMany: vi.fn(async () => []) },
    contentReview: { findMany: vi.fn(async ({ where }: { where: { authorId?: string } }) => reviews.filter((row) => where.authorId === undefined || row.authorId === where.authorId)) },
  }
  const visibility = { viewer: vi.fn(), where: vi.fn(async () => ({ status: 'published' })), authorExclusions: vi.fn(async () => ({ authors: ['synthetic-reviewer'] })) }
  return { prisma, service: new CommunityNotificationService(prisma as never, visibility as never), reviews }
}

describe('复核通知私密读取与发布边界', () => {
  it('作者收到具体修订的驳回理由，通知不查询检测正文和命中载荷', async () => {
    const { service, prisma } = setup()
    expect(await service.list('synthetic-owner')).toEqual([expect.objectContaining({ entityType: 'post', entityId: 'synthetic-post', actor: null, text: '你的投稿第 3 次修订复核未通过，尚未公开。请补充合成案例说明' })])
    expect(prisma.contentReview.findMany).toHaveBeenCalledWith({ where: { id: { in: ['synthetic-review'] }, authorId: 'synthetic-owner', status: { in: ['approved', 'rejected'] } }, select: { id: true, targetType: true, targetId: true, contentRevision: true, status: true, reason: true } })
    expect(prisma.userNotification.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { recipientId: 'synthetic-owner', OR: [{ notificationType: 'moderation' }, { NOT: { actorId: { in: ['synthetic-reviewer'] } } }] } }))
  })
  it('非作者不能凭通知中的复核ID取得他人驳回理由', async () => {
    const { service } = setup()
    expect(await service.list('synthetic-other')).toEqual([])
  })
  it('待审帖子不展示普通互动通知，作者的复核结果仍可读取', async () => {
    const { service } = setup([notification('post', 'synthetic-pending-post', 'comment'), notification()])
    const items = await service.list('synthetic-owner')
    expect(items).toHaveLength(1)
    expect(items[0]?.type).toBe('moderation')
  })
  it('无复核通知时不额外读审核表；历史通过结果明确限定修订', async () => {
    const empty = setup([])
    expect(await empty.service.list('synthetic-owner')).toEqual([])
    expect(empty.prisma.contentReview.findMany).not.toHaveBeenCalled()
    const approved = setup(); approved.reviews[0]!.status = 'approved'
    expect((await approved.service.list('synthetic-owner'))[0]?.text).toContain('第 3 次修订已通过复核')
  })
  it('复用现有通知去重，两个修订结果不会被同一小时合并', async () => {
    const { service, prisma } = setup()
    await service.send('synthetic-owner', 'synthetic-reviewer', 'moderation', 'content_review', 'synthetic-review-3')
    await service.send('synthetic-owner', 'synthetic-reviewer', 'moderation', 'content_review', 'synthetic-review-4')
    const keys = prisma.userNotification.createMany.mock.calls.map((args) => (args as unknown as [{ data: Array<{ dedupeKey: string }> }])[0].data[0]!.dedupeKey)
    expect(new Set(keys).size).toBe(2)
    expect(JSON.stringify(prisma.userNotification.createMany.mock.calls)).not.toContain('请补充合成案例说明')
  })
})
