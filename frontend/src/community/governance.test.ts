import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CommunityPostDetailDto, GovernanceMineDto, LearningCollectionDto } from '@ai-learning-hub/contracts'
import { mockCommunity, resetCommunityMock } from '../services/api/community.mock'
import { mockResourceHub, resetResourceHubMock } from '../services/api/resourceHub.mock'

const values = new Map<string, string>()
beforeEach(() => { vi.stubGlobal('localStorage', { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value), removeItem: (key: string) => values.delete(key) }); values.clear(); resetCommunityMock(); resetResourceHubMock() })
afterEach(() => vi.unstubAllGlobals())
const report = (type: string, id: string) => mockCommunity<{ id: string }>('/governance/reports', 'POST', { targetType: type, targetId: id, category: 'privacy', reason: '合成隐私风险', evidence: ['https://example.invalid/evidence'] })
describe('显式 Mock 治理契约', () => {
  it('举报记录匿名引用原实体，重复点击只保存一条，新修订可重新举报', async () => {
    const post = await mockCommunity<CommunityPostDetailDto>('/posts', 'POST', { type: 'note', contentBlocks: [{ type: 'paragraph', text: '合成教学讨论' }], bindings: [], topicIds: [], visibility: 'public', status: 'published' })
    const first = await report('post', post.id); expect((await report('post', post.id)).id).toBe(first.id)
    const mine = await mockCommunity<GovernanceMineDto>('/governance/mine', 'GET')
    expect(mine.reports).toHaveLength(1); expect(mine.reports[0]).not.toHaveProperty('reporterId'); expect(mine.reports[0].target).toMatchObject({ id: post.id, revision: 1 })
    await mockCommunity(`/posts/${post.id}`, 'PATCH', { expectedRevision: post.revision, type: 'note', contentBlocks: [{ type: 'paragraph', text: '补充后合成讨论' }], bindings: [], topicIds: [], visibility: 'public', status: 'published' })
    expect((await report('post', post.id)).id).not.toBe(first.id)
  })
  it('合集复用资源 Mock，私人、待审或虚构合集不能举报', async () => {
    await expect(report('collection', 'missing')).rejects.toThrow('合集不存在')
    const own = await mockResourceHub<LearningCollectionDto>('/collections', 'POST', { name: '合成私人合集', description: '', visibility: 'private' })
    await expect(report('collection', own.id)).rejects.toThrow('不可举报')
    const shared = await mockResourceHub<LearningCollectionDto>('/collections', 'POST', { name: '合成公开合集', description: '', visibility: 'community' })
    const result = await report('collection', shared.id)
    expect((await mockCommunity<GovernanceMineDto>('/governance/mine', 'GET')).reports.find((r) => r.id === result.id)?.target.title).toBe(shared.name)
  })
  it('无本人处罚不可申诉，坏分类或非HTTPS证据拒绝，重置演示清除治理数据', async () => {
    await expect(mockCommunity('/governance/appeals', 'POST', { actionId: 'someone-else', reason: '不允许对他人的事项提出申诉' })).rejects.toThrow('本人记录')
    await expect(mockCommunity('/governance/reports', 'POST', { targetType: 'profile', targetId: 'student', category: 'invalid', reason: '合成说明' })).rejects.toThrow('无效')
    await expect(mockCommunity('/governance/reports', 'POST', { targetType: 'profile', targetId: 'student', category: 'other', reason: '合成说明', evidence: ['javascript:alert(1)'] })).rejects.toThrow('HTTPS')
    await report('profile', 'student'); resetCommunityMock()
    expect(await mockCommunity<GovernanceMineDto>('/governance/mine', 'GET')).toEqual({ actions: [], reports: [], appeals: [], reviews: [] })
  })
})

describe('账号恢复接口的会话范围', () => {
  it('恢复令牌只放入该次请求；401不刷新普通会话，网络失败不回退Mock', async () => {
    vi.stubGlobal('sessionStorage', { getItem: () => 'ordinary-synthetic-session' })
    const fetcher = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({ code: 401, message: '恢复会话已过期' }), { status: 401 }))
    vi.stubGlobal('fetch', fetcher)
    const { communityApi } = await import('../services/api/community')
    await expect(communityApi.recoveryMine('scoped-synthetic-session')).rejects.toThrow('恢复会话已过期')
    expect(fetcher).toHaveBeenCalledOnce(); expect(fetcher.mock.calls[0]?.[0]).toContain('/community/recovery/mine')
    expect(fetcher.mock.calls[0]?.[1]).toMatchObject({ headers: { authorization: 'Bearer scoped-synthetic-session' } })
    fetcher.mockRejectedValueOnce(new Error('synthetic-offline'))
    await expect(communityApi.recoveryMine('scoped-synthetic-session')).rejects.toThrow('未回退到 Mock')
    expect(fetcher).toHaveBeenCalledTimes(2)
  })
})
