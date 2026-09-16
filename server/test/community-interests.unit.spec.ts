import { describe, expect, it, vi } from 'vitest'
import { CommunityContextService } from '../src/modules/community/context.service'

function setup() {
  const users = new Map(['one', 'two'].map((id) => [id, { id, onboardingCompletedAt: null as Date | null, communityProfile: { interestsSelectedAt: null as Date | null, postCount: 0 } }]))
  const prisma = {
    theme: { findMany: vi.fn(async () => ['a', 'b', 'c'].map((id) => ({ id }))) },
    communityTopic: { findMany: vi.fn(async () => []) },
    communityTopicFollow: { count: vi.fn(async () => 0) },
    communityProfile: { upsert: vi.fn(async ({ where, update }) => Object.assign(users.get(where.userId)!.communityProfile, update)) },
    learningPlan: { findFirst: vi.fn(async () => null) }, lessonProgress: { findFirst: vi.fn(async () => null) },
    labRun: { findFirst: vi.fn(async () => null) }, challenge: { findFirst: vi.fn(async () => null) },
    user: { findMany: vi.fn(async () => []) }, notification: { findFirst: vi.fn(async () => null) },
    systemSetting: { findUnique: vi.fn(async () => null) },
    $transaction: async <T>(fn: (tx: unknown) => Promise<T>) => fn(prisma),
  }
  const visibility = { viewer: vi.fn(async (id: string) => users.get(id)), authorExclusions: vi.fn(async () => ({ authors: [] })), assertOperation: vi.fn() }
  const service = new CommunityContextService(prisma as never, visibility as never, { resolveMany: vi.fn(async () => new Map()) } as never, {} as never, {} as never, {} as never, {} as never, {} as never)
  return { service, prisma, users, visibility }
}

describe('社区兴趣选择只完成一次', () => {
  it('无关联话题也保存完成状态，重复读取和其他账号互不影响', async () => {
    const { service, users } = setup()
    expect((await service.context('one')).needsInterests).toBe(true)
    expect((await service.interests('one', ['a', 'b', 'c'])).needsInterests).toBe(false)
    expect(users.get('one')!.communityProfile.interestsSelectedAt).toBeInstanceOf(Date)
    expect((await service.context('one')).needsInterests).toBe(false)
    expect((await service.context('two')).needsInterests).toBe(true)
  })

  it('已完成完整引导或已选择后取消全部关注，不重新弹出', async () => {
    const { service, users } = setup()
    users.get('one')!.onboardingCompletedAt = new Date()
    users.get('two')!.communityProfile.interestsSelectedAt = new Date()
    expect((await service.context('one')).needsInterests).toBe(false)
    expect((await service.context('two')).needsInterests).toBe(false)
  })

  it('无效选择、权限拒绝或事务失败均不返回成功或记录完成', async () => {
    const { service, prisma, visibility } = setup()
    await expect(service.interests('one', ['a'])).rejects.toThrow('请选择 3 个学习方向')
    prisma.theme.findMany.mockResolvedValueOnce([{ id: 'a' }, { id: 'b' }])
    await expect(service.interests('one', ['a', 'b', 'b'])).rejects.toThrow('学习方向不存在')
    visibility.assertOperation.mockRejectedValueOnce(new Error('禁止修改资料'))
    await expect(service.interests('one', ['a', 'b', 'c'])).rejects.toThrow('禁止修改资料')
    expect(prisma.communityProfile.upsert).not.toHaveBeenCalled()
    prisma.communityProfile.upsert.mockRejectedValueOnce(new Error('写入失败'))
    await expect(service.interests('one', ['a', 'b', 'c'])).rejects.toThrow('写入失败')
    expect((await service.context('one')).needsInterests).toBe(true)
  })
})
