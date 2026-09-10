import { describe, expect, it, vi } from 'vitest'
import type { Prisma } from '@prisma/client'
import type { PrismaService } from '../src/prisma/prisma.service'
import { ContentDetectionService } from '../src/modules/community/content-detection.service'
import { defaultContentDetectionPolicy } from '@ai-learning-hub/contracts'

function setup() {
  const settings = new Map<string, { key: string; value: unknown }>()
  const tx = {
    $queryRaw: vi.fn().mockResolvedValue([]),
    systemSetting: {
      findUnique: vi.fn(async ({ where }: { where: { key: string } }) => settings.get(where.key) ?? null),
      findMany: vi.fn(async () => [...settings.values()].filter((row) => row.key.startsWith('content_detection_policy:'))),
      createMany: vi.fn(async ({ data }: { data: Array<{ key: string; value: unknown }> }) => {
        for (const row of data) if (!settings.has(row.key)) settings.set(row.key, structuredClone(row))
      }),
      upsert: vi.fn(async ({ where, create, update }: { where: { key: string }; create: { key: string; value: unknown }; update: { value: unknown } }) => {
        settings.set(where.key, structuredClone(settings.has(where.key) ? { key: where.key, value: update.value } : create))
      }),
    },
    communityModerationAction: { create: vi.fn().mockResolvedValue({}) },
    $transaction: async <T>(fn: (client: unknown) => Promise<T>) => fn(tx),
  }
  const notifications = { send: vi.fn() }, signals = { record: vi.fn() }
  return { service: new ContentDetectionService(tx as unknown as PrismaService, notifications as never, signals as never, { approve: vi.fn() } as never), tx, settings, notifications, signals }
}

describe('规则版本持久化边界', () => {
  it('无配置使用小型默认规则；读取不创建数据库数据且不共享可变默认值', async () => {
    const { service, tx } = setup()
    const initial = await service.policy()
    initial.rules.pop()
    expect((await service.policy()).rules).toHaveLength(defaultContentDetectionPolicy.rules.length)
    expect(tx.systemSetting.upsert).not.toHaveBeenCalled()
  })
  it('新增、改动、删除用同一规则集合保存；回退创建新版本并保留历史', async () => {
    const { service, tx } = setup()
    const added = { ...defaultContentDetectionPolicy.rules[0]!, id: 'school-confirmed', method: 'exact' as const, content: '合成限制样本', category: 'school' as const, explanation: '仅测试学校明确确认后的规则配置。' }
    await service.configure('synthetic-admin', { expectedVersion: 1, rules: [...defaultContentDetectionPolicy.rules, added], reason: '测试新增规则' })
    await service.configure('synthetic-admin', { expectedVersion: 2, rules: [added], reason: '测试删除与修改规则' })
    const rolled = await service.configure('synthetic-admin', { expectedVersion: 3, rollbackVersion: 1, reason: '测试回退默认规则' })
    expect(rolled).toEqual({ ...defaultContentDetectionPolicy, version: 4 })
    expect((await service.history()).map((row) => row.version)).toEqual([4, 3, 2, 1])
    expect(tx.communityModerationAction.create).toHaveBeenLastCalledWith(expect.objectContaining({ data: expect.objectContaining({ action: 'rollback', reason: '测试回退默认规则', metadata: { previousVersion: 3, version: 4, rollbackVersion: 1 } }) }))
  })
  it('旧配置版本不能覆盖新规则，版本不能倒退或跳号', async () => {
    const { service, tx } = setup()
    await service.configure('synthetic-admin', { expectedVersion: 1, rules: [], reason: '测试配置' })
    await expect(service.configure('synthetic-admin', { expectedVersion: 1, rules: [], reason: '测试陈旧配置' })).rejects.toThrow('已有新版本')
    await expect(service.configure('synthetic-admin', { expectedVersion: 2, rollbackVersion: 8, reason: '测试非法回退' })).rejects.toThrow('之前')
    expect(tx.systemSetting.upsert).toHaveBeenCalledTimes(1)
  })
  it('检测拒绝不会写入原文，错误提示不包含合成凭据', async () => {
    const { service, tx } = setup()
    await service.configure('synthetic-admin', { expectedVersion: 1, rules: [{ ...defaultContentDetectionPolicy.rules[0]!, action: 'reject' }], reason: '测试学校明确配置拒绝' })
    const token = ['ghp', 'a1b2c3'.repeat(6)].join('_')
    await expect(service.check(tx as unknown as Prisma.TransactionClient, { postBody: token })).rejects.toMatchObject({ response: { errorCode: 'CONTENT_REJECTED', message: expect.not.stringContaining(token) } })
    expect(JSON.stringify(tx.communityModerationAction.create.mock.calls)).not.toContain(token)
  })
  it('检测取得共享规则锁，配置取得排他锁；真实并发留待飞牛验证', async () => {
    const { service, tx } = setup()
    await service.check(tx as unknown as Prisma.TransactionClient, { postBody: '技术教程' })
    expect(tx.$queryRaw.mock.calls[0]![0].join('')).toContain('pg_advisory_xact_lock_shared')
    await service.configure('synthetic-admin', { expectedVersion: 1, rules: [], reason: '合成配置' })
    expect(tx.$queryRaw.mock.calls[1]![0].join('')).toContain('pg_advisory_xact_lock(')
  })
  it('缺理由、混合回退和规则、非法规则均不写入', async () => {
    const { service, tx } = setup()
    await expect(service.configure('synthetic-admin', { expectedVersion: 1, rules: [], reason: ' ' })).rejects.toThrow()
    await expect(service.configure('synthetic-admin', { expectedVersion: 1, rules: [], rollbackVersion: 1, reason: '合成配置' })).rejects.toThrow()
    await expect(service.configure('synthetic-admin', { expectedVersion: 1, rules: [{ ...defaultContentDetectionPolicy.rules[0]!, content: '__proto__' }], reason: '合成配置' })).rejects.toThrow()
    expect(tx.systemSetting.upsert).not.toHaveBeenCalled()
  })
})

function reviewSetup() {
  const { service, tx, notifications, signals } = setup()
  const review = { id: 'synthetic-review', targetType: 'post', targetId: 'synthetic-post', contentRevision: 3, ruleVersion: 1, status: 'pending', authorId: 'synthetic-author' }
  const database = Object.assign(tx, {
    contentReview: { findUnique: vi.fn().mockResolvedValue(review), updateMany: vi.fn().mockResolvedValue({ count: 1 }), create: vi.fn().mockResolvedValue(review) },
    user: { count: vi.fn().mockResolvedValue(1) },
    communityPost: { updateMany: vi.fn().mockResolvedValue({ count: 1 }), count: vi.fn().mockResolvedValue(1), findUniqueOrThrow: vi.fn().mockResolvedValue({ id: 'synthetic-post', postType: 'note', bindings: [] }), update: vi.fn() },
    communityProfile: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
    communityPostTopic: { findMany: vi.fn().mockResolvedValue([]) },
  })
  return { service, tx: database, review, notifications, signals, input: { expectedRevision: 3, ruleVersion: 1, action: 'approve' as const, reason: '确认本修订为合成教学案例，仅放行本修订' } }
}

describe('内容修订复核保护', () => {
  it('通过投稿复核复用发布信号，驳回和旧修订不产生公开信号', async () => {
    const { service, tx, review, input, notifications, signals } = reviewSetup()
    await service.decide('synthetic-reviewer', review.id, { ...input, action: 'reject' })
    expect(signals.record).not.toHaveBeenCalled()
    expect(notifications.send).toHaveBeenCalledWith(review.authorId, 'synthetic-reviewer', 'moderation', 'content_review', review.id, tx)
    await service.decide('synthetic-reviewer', review.id, input)
    expect(signals.record).toHaveBeenCalledWith(review.authorId, 'community_post_publish', 'post', review.targetId, { postType: 'note', topicIds: [], bindingKeys: [] }, tx)
    tx.contentReview.findUnique.mockResolvedValue({ ...review, status: 'approved' })
    await expect(service.decide('synthetic-reviewer', review.id, input)).rejects.toThrow('旧版本')
    expect(signals.record).toHaveBeenCalledOnce()
    expect(notifications.send).toHaveBeenCalledTimes(2)
  })

  it.each([false, true])('通过评论复核时恢复真实互动信号和通知，回复=%s', async (reply) => {
    const { service, tx, review, input, notifications, signals } = reviewSetup()
    tx.contentReview.findUnique.mockResolvedValue({ ...review, targetType: 'comment' })
    const comment = { id: review.targetId, postId: 'synthetic-parent-post', parentId: reply ? 'synthetic-parent-comment' : null, post: { authorId: 'synthetic-post-author', postType: 'question' }, parent: reply ? { authorId: 'synthetic-comment-author', status: 'published', deletedAt: null } : null }
    Object.assign(tx, { communityComment: { updateMany: vi.fn(async () => ({ count: 1 })), findUniqueOrThrow: vi.fn(async () => comment), count: vi.fn(async () => 1) } })
    await service.decide('synthetic-reviewer', review.id, input)
    expect(signals.record).toHaveBeenCalledWith(review.authorId, reply ? 'community_reply_create' : 'community_comment_create', 'post', comment.postId, { authorId: comment.post.authorId, postType: 'question', commentId: comment.id }, tx)
    expect(notifications.send).toHaveBeenCalledWith(reply ? 'synthetic-comment-author' : 'synthetic-post-author', review.authorId, reply ? 'reply' : 'comment', 'post', comment.postId, tx)
    expect(notifications.send).toHaveBeenLastCalledWith(review.authorId, 'synthetic-reviewer', 'moderation', 'content_review', review.id, tx)
  })

  it('被回复的评论撤下后不能借复核恢复回复互动', async () => {
    const { service, tx, review, input, notifications, signals } = reviewSetup()
    tx.contentReview.findUnique.mockResolvedValue({ ...review, targetType: 'comment' })
    Object.assign(tx, { communityComment: { updateMany: vi.fn(async () => ({ count: 1 })), count: vi.fn(async () => 0), findUniqueOrThrow: vi.fn(async () => ({ postId: 'synthetic-post', parentId: 'synthetic-parent', parent: { status: 'pending_review', deletedAt: null } })) } })
    await expect(service.decide('synthetic-reviewer', review.id, input)).rejects.toThrow('被回复的评论已不可见')
    expect(signals.record).not.toHaveBeenCalled()
    expect(notifications.send).not.toHaveBeenCalled()
    expect(tx.contentReview.updateMany).not.toHaveBeenCalled()
  })

  it('合集审批匹配所有者、公开意图和当前修订；冲突不留成功记录', async () => {
    const { service, tx, review, input } = reviewSetup()
    tx.contentReview.findUnique.mockResolvedValue({ ...review, targetType: 'collection' })
    const collection = { updateMany: vi.fn().mockResolvedValue({ count: 0 }) }
    Object.assign(tx, { learningCollection: collection })
    await expect(service.decide('synthetic-reviewer', review.id, input)).rejects.toThrow('合集内容或可见范围已变化')
    expect(collection.updateMany).toHaveBeenCalledWith({ where: { id: review.targetId, revision: 3, contentStatus: 'pending_review', visibility: 'community', ownerId: review.authorId }, data: { contentStatus: 'published' } })
    expect(tx.contentReview.updateMany).not.toHaveBeenCalled()
  })

  it('资源审批额外要求发布权限，且只放行命中记录中的草稿快照', async () => {
    const { service, tx, review, input } = reviewSetup()
    tx.contentReview.findUnique.mockResolvedValue({ ...review, targetType: 'resource', payload: { draftVersionId: 'synthetic-draft' } })
    const roles = { count: vi.fn().mockResolvedValue(0) }, resource = { updateMany: vi.fn().mockResolvedValue({ count: 1 }) }
    Object.assign(tx, { userRole: roles, resource })
    await expect(service.decide('synthetic-reviewer', review.id, input)).rejects.toThrow('资源发布权限')
    expect(resource.updateMany).not.toHaveBeenCalled()
    roles.count.mockResolvedValue(1)
    await service.decide('synthetic-reviewer', review.id, input)
    expect(roles.count).toHaveBeenLastCalledWith({ where: { userId: 'synthetic-reviewer', role: { permissions: { some: { permission: { code: 'resource.publish' } } } } } })
    expect(resource.updateMany).toHaveBeenCalledWith({ where: { id: review.targetId, version: 3, currentDraftVersionId: 'synthetic-draft', status: 'reviewing', deletedAt: null }, data: { status: 'published', publishedAt: expect.any(Date), publishedVersionId: 'synthetic-draft' } })
  })

  it('资源后续编辑使旧快照审批失效', async () => {
    const { service, tx, review, input } = reviewSetup()
    tx.contentReview.findUnique.mockResolvedValue({ ...review, targetType: 'resource', payload: { draftVersionId: 'synthetic-old-draft' } })
    Object.assign(tx, { userRole: { count: vi.fn().mockResolvedValue(1) }, resource: { updateMany: vi.fn().mockResolvedValue({ count: 0 }) } })
    await expect(service.decide('synthetic-reviewer', review.id, input)).rejects.toThrow('资源已有新修订')
    expect(tx.contentReview.updateMany).not.toHaveBeenCalled()
  })
  it('审批同时绑定内容修订、待复核状态和规则版本，豁免仅针对当前修订', async () => {
    const { service, tx, input } = reviewSetup()
    expect(await service.decide('synthetic-reviewer', 'synthetic-review', input)).toMatchObject({ status: 'approved', contentRevision: 3, ruleVersion: 1 })
    expect(tx.communityPost.updateMany).toHaveBeenCalledWith({ where: { id: 'synthetic-post', authorId: 'synthetic-author', revision: 3, status: 'pending_review', deletedAt: null }, data: { status: 'published', publishedAt: expect.any(Date) } })
    expect(tx.communityModerationAction.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ metadata: expect.objectContaining({ exemptionScope: 'this_revision_only', mediaReview: 'not_performed' }) }) }))
  })
  it('编辑后旧审批不能发布新正文，CAS失败不会记录成功', async () => {
    const { service, tx, input } = reviewSetup()
    tx.communityPost.updateMany.mockResolvedValue({ count: 0 })
    await expect(service.decide('synthetic-reviewer', 'synthetic-review', input)).rejects.toThrow('旧复核不能放行新内容')
    expect(tx.contentReview.updateMany).not.toHaveBeenCalled()
    expect(tx.communityModerationAction.create).not.toHaveBeenCalled()
  })
  it('陈旧请求、已被新投稿替代的记录和新规则都要求重新读取检测', async () => {
    const { service, tx, review, input } = reviewSetup()
    await expect(service.decide('synthetic-reviewer', 'synthetic-review', { ...input, expectedRevision: 2 })).rejects.toThrow('旧版本')
    tx.contentReview.findUnique.mockResolvedValue({ ...review, status: 'superseded' })
    await expect(service.decide('synthetic-reviewer', 'synthetic-review', input)).rejects.toThrow('旧版本')
    tx.contentReview.findUnique.mockResolvedValue(review)
    await service.configure('synthetic-admin', { expectedVersion: 1, rules: [], reason: '合成规则更新' })
    await expect(service.decide('synthetic-reviewer', 'synthetic-review', input)).rejects.toThrow('编辑后重新提交检测')
    expect(tx.communityPost.updateMany).not.toHaveBeenCalled()
  })
  it('驳回保留原文但不恢复公开，记录理由且不永久禁用作者', async () => {
    const { service, tx, input } = reviewSetup()
    await service.decide('synthetic-reviewer', 'synthetic-review', { ...input, action: 'reject' })
    expect(tx.communityPost.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: { status: 'pending_review', publishedAt: null } }))
    expect(tx.contentReview.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'rejected', reason: input.reason }) }))
  })
  it('新提交使旧待复核失效，保留本次命中与规则版本', async () => {
    const { service, tx } = reviewSetup()
    const detection = { action: 'review' as const, ruleVersion: 1, hits: [], mediaReview: 'not_performed' as const }
    await service.record(tx as unknown as Prisma.TransactionClient, { type: 'post', id: 'synthetic-post', revision: 4, authorId: 'synthetic-author', submittedById: 'synthetic-author' }, detection)
    expect(tx.contentReview.updateMany).toHaveBeenCalledWith({ where: { targetType: 'post', targetId: 'synthetic-post', status: 'pending' }, data: { status: 'superseded' } })
    expect(tx.contentReview.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ contentRevision: 4, ruleVersion: 1, status: 'pending', findings: detection }) }))
  })
})

function profileSetup() {
  const { service, tx } = setup()
  const user = { id: 'synthetic-owner', username: 'student_example', displayName: '原公开昵称', revision: 4, usernameChangedAt: null }
  const profile = { userId: user.id, revision: 3, bio: '原公开简介', headline: '课程学习', location: '', websiteUrl: '', expertiseTopics: ['LLM'] }
  const database = Object.assign(tx, {
    user: { findUniqueOrThrow: vi.fn().mockResolvedValue(user), update: vi.fn(), updateMany: vi.fn().mockResolvedValue({ count: 1 }), count: vi.fn().mockResolvedValue(0) },
    communityProfile: { upsert: vi.fn().mockResolvedValue(profile), updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
    contentReview: { findFirst: vi.fn().mockResolvedValue(null), findUnique: vi.fn(), count: vi.fn().mockResolvedValue(0), updateMany: vi.fn().mockResolvedValue({ count: 1 }), create: vi.fn().mockResolvedValue({}) },
  })
  return { service, tx: database, user, profile }
}

describe('公开资料暂存', () => {
  it.each(['approve', 'reject'] as const)('仅昵称资料复核 %s 仍执行非空的资料修订校验', async (action) => {
    const { service, tx, user, profile } = profileSetup()
    tx.user.count.mockResolvedValue(1)
    tx.contentReview.findUnique.mockResolvedValue({ id: 'synthetic-review', targetType: 'profile', targetId: user.id, authorId: user.id, contentRevision: profile.revision, ruleVersion: 1, status: 'pending', payload: { changes: { displayName: '合成教学昵称' }, userRevision: user.revision } })
    // Prisma 的空 updateMany 不执行 UPDATE，不能把它当成成功的 CAS。
    tx.communityProfile.updateMany.mockImplementation(async ({ data }: { data: object }) => ({ count: Object.keys(data).length ? 1 : 0 }))
    await expect(service.decide('synthetic-reviewer', 'synthetic-review', { expectedRevision: 3, ruleVersion: 1, action, reason: '合成资料审核' })).resolves.toMatchObject({ status: action === 'approve' ? 'approved' : 'rejected' })
    expect(tx.communityProfile.updateMany).toHaveBeenCalledWith({ where: { userId: user.id, revision: 3 }, data: { revision: 3 } })
    expect(tx.user.updateMany).toHaveBeenCalledWith({ where: { id: user.id, revision: 4 }, data: { ...(action === 'approve' ? { displayName: '合成教学昵称' } : {}), revision: { increment: 1 } } })
  })

  it('账号或资料任一版本冲突都不能记录复核成功', async () => {
    const { service, tx, user } = profileSetup()
    tx.user.count.mockResolvedValue(1)
    tx.contentReview.findUnique.mockResolvedValue({ id: 'synthetic-review', targetType: 'profile', targetId: user.id, authorId: user.id, contentRevision: 3, ruleVersion: 1, status: 'pending', payload: { changes: { bio: '合成说明' }, userRevision: 4 } })
    const input = { expectedRevision: 3, ruleVersion: 1, action: 'approve' as const, reason: '合成版本冲突' }
    tx.user.updateMany.mockResolvedValueOnce({ count: 0 })
    await expect(service.decide('synthetic-reviewer', 'synthetic-review', input)).rejects.toThrow('账号已有新修订')
    expect(tx.communityProfile.updateMany).not.toHaveBeenCalled()
    tx.communityProfile.updateMany.mockResolvedValueOnce({ count: 0 })
    await expect(service.decide('synthetic-reviewer', 'synthetic-review', input)).rejects.toThrow('公开资料已有新修订')
    expect(tx.contentReview.updateMany).not.toHaveBeenCalled()
    expect(tx.communityModerationAction.create).not.toHaveBeenCalled()
  })
  it('待审昵称简介保留原公开资料，未审批文字仅进入修订载荷', async () => {
    const { service, tx, user, profile } = profileSetup()
    const changes = { displayName: '合成案例昵称', bio: '反诈案例：先交保证金再返佣' }
    const result = await service.saveProfile(tx as unknown as Prisma.TransactionClient, user.id, changes, user.id, 3)
    expect(result.action).toBe('review')
    expect(user.displayName).toBe('原公开昵称')
    expect(profile.bio).toBe('原公开简介')
    expect(tx.user.update).not.toHaveBeenCalled()
    expect(tx.communityProfile.updateMany).toHaveBeenCalledWith({ where: { userId: user.id, revision: 3 }, data: { revision: { increment: 1 } } })
    expect(tx.contentReview.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ contentRevision: 4, status: 'pending', payload: expect.objectContaining({ changes, userRevision: 4, snapshot: expect.objectContaining({ username: user.username, bio: changes.bio }) }) }) }))
  })
  it('正常昵称简介直接保存；代码术语不触发限制', async () => {
    const { service, tx, user } = profileSetup()
    expect((await service.saveProfile(tx as unknown as Prisma.TransactionClient, user.id, { displayName: 'AI Agent 学习者', bio: '学习 RAG 与 ComfyUI' })).action).toBe('allow')
    expect(tx.user.update).toHaveBeenCalledWith({ where: { id: user.id }, data: { displayName: 'AI Agent 学习者' } })
    expect(tx.communityProfile.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: { bio: '学习 RAG 与 ComfyUI', revision: { increment: 1 } } }))
  })
  it('引导页改简介不会丢弃注册时待审的用户名和昵称', async () => {
    const { service, tx, user } = profileSetup()
    tx.contentReview.findFirst.mockResolvedValue({ status: 'pending', payload: { changes: { username: 'chosen_example', displayName: '大家一起去骚扰（反面案例）' }, initialUsername: true } })
    expect((await service.saveProfile(tx as unknown as Prisma.TransactionClient, user.id, { headline: '继续学习' })).action).toBe('review')
    expect(tx.contentReview.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ payload: expect.objectContaining({ changes: { username: 'chosen_example', displayName: '大家一起去骚扰（反面案例）', headline: '继续学习' }, initialUsername: true }) }) }))
    expect(tx.user.update).not.toHaveBeenCalled()
  })
  it.each(['pending', 'rejected'])('资料局部更新省略昵称时保留%s文字并重新检测', async (status) => {
    const { service, tx, user } = profileSetup()
    const displayName = '大家一起去骚扰（合成反面案例）'
    tx.contentReview.findFirst.mockResolvedValue({ status, payload: { changes: { displayName } } })
    expect((await service.saveProfile(tx as unknown as Prisma.TransactionClient, user.id, { headline: '学习 AI Agent' })).action).toBe('review')
    expect(tx.contentReview.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ contentRevision: 4, status: 'pending', payload: expect.objectContaining({ changes: { displayName, headline: '学习 AI Agent' }, snapshot: expect.objectContaining({ displayName }) }) }) }))
    expect(tx.user.update).not.toHaveBeenCalled()
  })
  it('明确清空待审简介或话题仍按新输入检测，不恢复旧暂存值', async () => {
    const { service, tx, user } = profileSetup()
    tx.contentReview.findFirst.mockResolvedValue({ status: 'pending', payload: { changes: { bio: '先交保证金再返佣（合成反面案例）', expertiseTopics: ['待修改话题'] } } })
    expect((await service.saveProfile(tx as unknown as Prisma.TransactionClient, user.id, { bio: '', expertiseTopics: [] })).action).toBe('allow')
    expect(tx.communityProfile.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: { bio: '', expertiseTopics: [], revision: { increment: 1 } } }))
  })
  it('用户名复核期间保留占用，同名注册或修改不能抢占', async () => {
    const { service, tx } = profileSetup()
    tx.contentReview.count.mockResolvedValue(1)
    await expect(service.assertUsernameAvailable(tx as unknown as Prisma.TransactionClient, 'CHOSEN_example', 'synthetic-other')).rejects.toThrow('正在复核')
    expect(tx.contentReview.count).toHaveBeenCalledWith({ where: { targetType: 'profile', status: 'pending', targetId: { not: 'synthetic-other' }, payload: { path: ['changes', 'username'], equals: 'chosen_example' } } })
    expect(tx.$queryRaw.mock.calls[0]![1]).toBe('content-username:chosen_example')
  })
  it('公开资料旧版本和直接拒绝不会覆盖旧公开文本', async () => {
    const { service, tx, user } = profileSetup()
    await expect(service.saveProfile(tx as unknown as Prisma.TransactionClient, user.id, { bio: '新输入' }, user.id, 2)).rejects.toThrow('已更新')
    await service.configure('synthetic-admin', { expectedVersion: 1, rules: [{ ...defaultContentDetectionPolicy.rules[2]!, action: 'reject' }], reason: '合成拒绝测试' })
    await expect(service.saveProfile(tx as unknown as Prisma.TransactionClient, user.id, { bio: '先交保证金再返佣' })).rejects.toThrow('内容未发布')
    expect(tx.user.update).not.toHaveBeenCalled()
    expect(tx.communityProfile.updateMany).not.toHaveBeenCalled()
  })
})
