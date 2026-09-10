import { describe, expect, it, vi } from 'vitest'
import type { CommunityPost } from '@prisma/client'
import { CommunityPostRelationsService, postInlineTokens } from '../src/modules/community/post-relations.service'
import { CommunityNotificationService } from '../src/modules/community/notification.service'

const post = (overrides: Partial<CommunityPost> = {}) => ({ id: 'post-a', authorId: 'writer', status: 'published', visibility: 'public', inlineReferences: [], quotedPostId: null, contentBlocks: [{ type: 'paragraph', text: '#模型 @student_1' }], ...overrides }) as CommunityPost
const setup = () => {
  const topics = [{ id: 'manual', name: '手动话题', normalizedName: '手动话题', status: 'active' }]
  const tx = {
    systemSetting: { findUnique: vi.fn(async () => null) },
    $queryRaw: vi.fn(async () => [{ attempts: 1, expires_at: new Date(Date.now() + 3600000), retry_after: 3600 }]),
    communityTopic: { findMany: vi.fn(async () => topics), upsert: vi.fn(async ({ create }) => ({ ...create, id: 'new-topic', status: 'active' })) },
    user: { findMany: vi.fn(async () => [{ id: 'original-user', username: 'student_1' }]), count: vi.fn(async () => 1) },
    communityPost: { update: vi.fn(async () => ({})), count: vi.fn(async () => 1), findFirst: vi.fn(async () => ({ id: 'target', authorId: 'original-author' })), findMany: vi.fn(async () => []), groupBy: vi.fn(async () => []) },
    communityPostTopic: { deleteMany: vi.fn(), createMany: vi.fn() },
    communityPostRevision: { count: vi.fn(async () => 0) },
  }
  const visibility = { where: vi.fn(async (id: string) => ({ viewer: id })), authorExclusions: vi.fn(async () => ({ authors: ['blocked'] })) }, notifications = { send: vi.fn() }
  const service = new CommunityPostRelationsService(tx as never, visibility as never, notifications as never)
  return { tx, topics, visibility, notifications, service }
}
describe('正文实体与引用在既有帖子事务内持久化', () => {
  it('只解析安全文字，富文本跨格式节点可识别，链接、代码、图片替代文字不参与', () => {
    expect(postInlineTokens([{ type: 'rich_text', text: '<p>#模<strong>型</strong> @student_1</p><a href="https://x">#链接 @ignored_1</a><pre><code>#代码 @ignored_2</code></pre><p>a@student.test</p>' }, { type: 'image', fileId: 'file', alt: '#图片' }, { type: 'code', code: '#代码', language: 'text' }]).map((row) => row.text)).toEqual(['#模型', '@student_1'])
  })
  it.each(['draft', 'pending_review'] as const)('%s 保存稳定提及但不新建公共话题、不通知', async (status) => {
    const { tx, service, notifications } = setup(), value = post({ status })
    const result = await service.resolve(tx as never, value, [])
    await service.notify(tx as never, value, result.refs)
    expect(tx.communityTopic.upsert).not.toHaveBeenCalled(); expect(notifications.send).not.toHaveBeenCalled()
    expect(result.refs).toEqual([{ kind: 'mention', text: '@student_1', id: 'original-user' }])
  })
  it('同校投稿不创建公共话题；公开发布才创建并合并手动选择', async () => {
    const { tx, service } = setup()
    await service.resolve(tx as never, post({ visibility: 'school' }), ['manual'])
    expect(tx.communityTopic.upsert).not.toHaveBeenCalled()
    const result = await service.resolve(tx as never, post(), ['manual'])
    expect(result.topicIds).toEqual(['manual', 'new-topic'])
    expect(tx.communityPostTopic.createMany).toHaveBeenLastCalledWith({ data: [{ postId: 'post-a', topicId: 'manual', manual: true }, { postId: 'post-a', topicId: 'new-topic', manual: false }], skipDuplicates: true })
    expect(tx.$queryRaw).toHaveBeenCalled()
  })
  it('删除正文标签仍保留独立手选话题，自动关联不会保留', async () => {
    const { tx, service } = setup()
    const result = await service.resolve(tx as never, post({ contentBlocks: [{ type: 'paragraph', text: '没有标签' }] }), ['manual'], [], [{ kind: 'topic', id: 'new-topic', text: '#模型' }])
    expect(result).toEqual({ refs: [], topicIds: ['manual'] })
  })
  it('同名大小写标签只创建一次并合并数量上限', async () => {
    const { tx, service } = setup()
    await service.resolve(tx as never, post({ contentBlocks: [{ type: 'paragraph', text: '#Model #model' }] }), [])
    expect(tx.communityTopic.upsert).toHaveBeenCalledTimes(1)
    await expect(service.resolve(tx as never, post({ contentBlocks: [{ type: 'paragraph', text: '#一 #二 #三 #四 #五 #六' }] }), [])).rejects.toThrow('5 个话题')
  })
  it('历史提及沿用原 ID，不串到后来占用旧 username 的新账号', async () => {
    const { tx, service } = setup(); tx.user.findMany.mockResolvedValue([{ id: 'new-owner', username: 'student_1' }])
    const result = await service.resolve(tx as never, post({ status: 'draft' }), [], [], [{ kind: 'mention', text: '@student_1', id: 'original-user' }])
    expect(result.refs.find((ref) => ref.kind === 'mention')?.id).toBe('original-user')
    await expect(service.resolve(tx as never, post({ status: 'draft' }), [], [{ kind: 'mention', text: '@student_1', id: 'original-user' }])).rejects.toThrow('重新选择')
  })
  it('不可解析的手打用户名保持文字，伪造所选 ID 拒绝', async () => {
    const { tx, service } = setup(); tx.user.findMany.mockResolvedValue([])
    expect((await service.resolve(tx as never, post({ status: 'draft' }), [])).refs).toEqual([])
    await expect(service.resolve(tx as never, post({ status: 'draft' }), [], [{ kind: 'mention', text: '@student_1', id: 'fake' }])).rejects.toThrow('重新选择')
  })
  it('公开编辑只通知新增提及，接收者看不到帖子时不发送', async () => {
    const { tx, service, notifications } = setup()
    const refs = [{ kind: 'mention' as const, text: '@student_1', id: 'original-user' }]
    await service.notify(tx as never, post(), refs, refs); expect(notifications.send).not.toHaveBeenCalled()
    tx.communityPost.count.mockResolvedValue(0); await service.notify(tx as never, post(), refs); expect(notifications.send).not.toHaveBeenCalled()
    tx.communityPost.count.mockResolvedValue(1); await service.notify(tx as never, post(), refs); expect(notifications.send).toHaveBeenCalledWith('original-user', 'writer', 'mention', 'post', 'post-a', tx)
  })
  it('引用禁止自己和已公开目标替换，已下架旧帖也不可改目标', async () => {
    const { tx, service } = setup()
    await expect(service.quote(tx as never, 'writer', 'post-a', post(), true)).rejects.toThrow('不能引用自己')
    await expect(service.quote(tx as never, 'writer', 'another', post({ quotedPostId: 'target', publishedAt: new Date() }), true)).rejects.toThrow('不能更换')
    tx.communityPostRevision.count.mockResolvedValue(1)
    await expect(service.quote(tx as never, 'writer', 'another', post({ status: 'draft', quotedPostId: 'target', publishedAt: null }), true)).rejects.toThrow('不能更换')
  })
  it('新引用必须是可见公开原帖，失效草稿可保存但不可发布', async () => {
    const { tx, service } = setup(); tx.communityPost.findFirst.mockResolvedValue(null as never)
    await expect(service.quote(tx as never, 'writer', 'target', null, true)).rejects.toThrow('公开帖子')
    await service.quote(tx as never, 'writer', 'target', post({ status: 'draft', quotedPostId: 'target' }), false)
    await expect(service.quote(tx as never, 'writer', 'target', post({ status: 'draft', quotedPostId: 'target' }), true)).rejects.toThrow('公开帖子')
    expect(tx.communityPost.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { AND: expect.arrayContaining([expect.objectContaining({ status: 'published', visibility: 'public', deletedAt: null }), { viewer: 'writer' }]) } }))
  })
  it('失效原帖 DTO 只返回占位；引用数量一次批量聚合有效已发布内容', async () => {
    const { tx, service } = setup()
    const result = await service.quotes('viewer', [post({ quotedPostId: 'unavailable' }), post({ id: 'post-b', quotedPostId: 'unavailable' })])
    expect(result.previews.get('unavailable')).toEqual({ id: 'unavailable', available: false })
    expect(tx.communityPost.groupBy).toHaveBeenCalledTimes(1)
    expect(tx.communityPost.groupBy).toHaveBeenCalledWith({ by: ['quotedPostId'], where: { AND: [{ viewer: 'viewer' }, { status: 'published', quotedPostId: { in: ['post-a', 'post-b'] } }] }, _count: { _all: true } })
  })
  it('提及和引用的通知幂等跨小时生效，不携带正文预览', async () => {
    const tx = { userNotification: { createMany: vi.fn(), updateMany: vi.fn() } }, service = new CommunityNotificationService({} as never, {} as never)
    await service.send('recipient', 'writer', 'mention', 'post', 'post-a', tx as never)
    expect(tx.userNotification.createMany.mock.calls[0]![0]).toEqual({ data: [{ recipientId: 'recipient', actorId: 'writer', notificationType: 'mention', entityType: 'post', entityId: 'post-a', dedupeKey: 'recipient:mention:post:post-a', actorIds: ['writer'] }], skipDuplicates: true })
    await service.send('recipient', 'writer', 'quote', 'post', 'post-a', tx as never)
    expect(tx.userNotification.createMany.mock.calls[1]![0].data[0].dedupeKey).toBe('recipient:quote:post:post-a')
  })
})
