import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CreatorContentSummaryDto, LearningCollectionDto, ResourceContributionDetailDto, ResourceHubHomeDto, ResourceHubListDto, VideoAssetDto, VideoPlaybackDto } from '@ai-learning-hub/contracts'
import { mockCommunity, resetCommunityMock } from './community.mock'
import { mockResourceHub, resetResourceHubMock } from './resourceHub.mock'

const values = new Map<string, string>()
const localStorageStub = {
  getItem: (key: string) => values.get(key) ?? null,
  setItem: (key: string, value: string) => { values.set(key, value) },
  removeItem: (key: string) => { values.delete(key) },
  clear: () => { values.clear() },
}

beforeEach(() => {
  vi.stubGlobal('localStorage', localStorageStub)
  values.clear()
  resetCommunityMock()
  resetResourceHubMock()
})
afterEach(() => {
  resetResourceHubMock()
  vi.unstubAllGlobals()
})

describe('资源共创 Mock 与正式契约语义', () => {
  it('固定返回 24 条真实形态演示作品、3 张 Banner 和四个核心分区', async () => {
    const home = await mockResourceHub<ResourceHubHomeDto>('/home')
    const list = await mockResourceHub<ResourceHubListDto>('/items?kind=all')
    expect(list.items).toHaveLength(24)
    expect(home.banners).toHaveLength(3)
    expect(home.sections.map((section) => section.categoryCode)).toEqual(['ai-foundation', 'lab-demo', 'model-deployment', 'agent-practice'])
    expect(new Set(list.items.map((item) => item.kind))).toEqual(new Set(['video', 'article', 'document']))
    expect(list.items.filter((item) => item.kind === 'video').every((item) => item.videoAssetId && item.mediaStatus === 'ready' && item.coverUrl)).toBe(true)
  })

  it('筛选作用于完整结果，社区隐藏后各资源入口同步不可见', async () => {
    const filtered = await mockResourceHub<ResourceHubListDto>('/items?kind=video&category=agent-practice&keyword=Agent')
    expect(filtered.items.length).toBeGreaterThan(0)
    expect(filtered.items.every((item) => item.kind === 'video' && item.category?.code === 'agent-practice')).toBe(true)
    const hiddenId = filtered.items[0].postId!
    await mockCommunity(`/posts/${hiddenId}/hide`, 'POST')
    const after = await mockResourceHub<ResourceHubListDto>('/items?kind=all')
    await expect(mockResourceHub(`/contributions/${hiddenId}`)).rejects.toThrow()
    expect(after.items.some((item) => item.postId === hiddenId)).toBe(false)
  })

  it('合集新增、去重、排序、删除与修订冲突均持久化', async () => {
    let collection = await mockResourceHub<LearningCollectionDto>('/collections', 'POST', { name: '我的学习清单', description: '固定测试', visibility: 'private', learningGoal: '完成两项资源' })
    collection = await mockResourceHub<LearningCollectionDto>(`/collections/${collection.id}/items`, 'POST', { postId: 'resource-demo-ai-literacy' })
    collection = await mockResourceHub<LearningCollectionDto>(`/collections/${collection.id}/items`, 'POST', { postId: 'resource-demo-campus-agent' })
    const duplicate = await mockResourceHub<LearningCollectionDto>(`/collections/${collection.id}/items`, 'POST', { postId: 'resource-demo-campus-agent' })
    expect(duplicate.items).toHaveLength(2)
    const reversed = duplicate.items.map((item) => item.id).reverse()
    collection = await mockResourceHub<LearningCollectionDto>(`/collections/${collection.id}/order`, 'PUT', { expectedRevision: duplicate.revision, itemIds: reversed })
    expect(collection.items.map((item) => item.id)).toEqual(reversed)
    await expect(mockResourceHub(`/collections/${collection.id}/order`, 'PUT', { expectedRevision: duplicate.revision, itemIds: reversed })).rejects.toThrow('已变化')
    collection = await mockResourceHub<LearningCollectionDto>(`/collections/${collection.id}/items/${collection.items[0].id}`, 'DELETE')
    expect(collection.items).toHaveLength(1)
  })

  it('上传视频和资料后返回可用的演示对象地址，观看进度可续取', async () => {
    const video = await mockResourceHub<VideoAssetDto>('/uploads/video', 'POST', new File(['video'], 'demo.mp4', { type: 'video/mp4' }))
    const document = await mockResourceHub<{ id: string; mimeType: string }>('/uploads/document', 'POST', new File(['notes'], 'notes.txt', { type: 'text/plain' }))
    expect(video).toMatchObject({ status: 'ready', originalMimeType: 'video/mp4' })
    expect(await mockResourceHub<VideoAssetDto>(`/videos/${video.id}`)).toEqual(video)
    expect(document.mimeType).toBe('text/plain')
    await expect(mockResourceHub(`/videos/${video.id}/playback`)).rejects.toThrow('不可见')
    await mockCommunity('/posts', 'POST', { type: 'note', title: '合成视频投稿', contentBlocks: [{ type: 'paragraph', text: '用于验证观看进度的合成教程' }], bindings: [], topicIds: [], visibility: 'public', status: 'published', contribution: { kind: 'video', categoryId: 'ai-foundation', tags: [], videoAssetId: video.id } })
    const playback = await mockResourceHub<VideoPlaybackDto>(`/videos/${video.id}/playback`)
    expect(playback.sources[0]).toMatchObject({ type: 'video/mp4', src: expect.stringMatching(/^blob:/) })
    await mockResourceHub(`/videos/${video.id}/progress`, 'PUT', { positionSeconds: 24, watchedSeconds: 18, completed: false, eventKey: 'mock-watch-1' })
    expect((await mockResourceHub<VideoPlaybackDto>(`/videos/${video.id}/playback`)).progress).toMatchObject({ positionSeconds: 24, watchedSeconds: 18, completed: false })
  })

  it('作者下架资源后从公开结果移除并保留为自己的草稿', async () => {
    const id = 'resource-demo-campus-agent'
    await mockCommunity(`/posts/${id}/unpublish`, 'POST')
    expect((await mockResourceHub<ResourceHubListDto>('/items?kind=all')).items.some((entry) => entry.postId === id)).toBe(false)
    const studio = await mockResourceHub<CreatorContentSummaryDto>('/studio')
    expect(studio.drafts.some((post) => post.id === id)).toBe(true)
    expect(studio.pendingReview).toEqual([])
  })

  it('详情、作者、互动与社区帖子共用同一份数据', async () => {
    const detail = await mockResourceHub<ResourceContributionDetailDto>('/contributions/resource-demo-campus-agent')
    const community = await mockCommunity<typeof detail.post>('/posts/resource-demo-campus-agent', 'GET')
    expect(detail.post).toEqual(community)
    expect(detail.contribution).toEqual(detail.post.contribution)
    expect(detail.stats.views).toBeGreaterThan(0)
    expect(detail.related.every((item) => item.id !== detail.post.id)).toBe(true)
  })

  it('未认证禁止资源上传和社区合集，但保留私人合集与观看进度', async () => {
    values.set('community-demo-user', JSON.stringify({ identityVerificationStatus: 'unsubmitted' }))
    await expect(mockResourceHub('/uploads/video', 'POST', new File(['video'], 'demo.mp4', { type: 'video/mp4' }))).rejects.toMatchObject({ code: 'COMMUNITY_VERIFICATION_REQUIRED' })
    await expect(mockResourceHub('/uploads/document', 'POST', new File(['notes'], 'notes.txt', { type: 'text/plain' }))).rejects.toMatchObject({ code: 'COMMUNITY_VERIFICATION_REQUIRED' })
    await expect(mockResourceHub('/collections', 'POST', { name: '公开清单', description: '', visibility: 'community' })).rejects.toMatchObject({ code: 'COMMUNITY_VERIFICATION_REQUIRED' })
    const privateCollection = await mockResourceHub<LearningCollectionDto>('/collections', 'POST', { name: '私人清单', description: '', visibility: 'private' })
    await expect(mockResourceHub(`/collections/${privateCollection.id}/items`, 'POST', { postId: 'resource-demo-ai-literacy' })).resolves.toMatchObject({ itemCount: 1 })
    await expect(mockResourceHub('/videos/video-resource-demo-ai-literacy/progress', 'PUT', { positionSeconds: 10, watchedSeconds: 8, completed: false })).resolves.toMatchObject({ positionSeconds: 10 })
  })
})
