import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CommunityDraftDto, CommunityPostDetailDto, CommunityPostInput, ResourceContributionDetailDto, ResourceHubListDto, VideoPlaybackDto } from '@ai-learning-hub/contracts'
import { mockCommunity, resetCommunityMock } from '../src/services/api/community.mock'
import { mockResourceHub, resetResourceHubMock } from '../src/services/api/resourceHub.mock'
import { demoImages } from '../src/services/api/community-images.mock'

beforeEach(() => {
  const storage = new Map<string, string>()
  vi.stubGlobal('localStorage', { getItem: (key: string) => storage.get(key) || null, setItem: (key: string, value: string) => storage.set(key, value), removeItem: (key: string) => storage.delete(key) })
  resetCommunityMock(); resetResourceHubMock()
})
afterEach(() => { resetCommunityMock(); resetResourceHubMock(); vi.unstubAllGlobals() })

describe('教程图文与视频封面往返', () => {
  it('普通图文封面独立保存、恢复和移除，不创建教程投稿', async () => {
    const input: CommunityPostInput = { type: 'general', title: '社区图文', status: 'draft', visibility: 'public', contentBlocks: [{ type: 'paragraph', text: '社区正文' }], bindings: [], topicIds: [], coverFileId: 'cover-a' }
    const saved = await mockCommunity<CommunityPostDetailDto>('/drafts', 'POST', input)
    const draft = (await mockCommunity<CommunityDraftDto[]>('/drafts', 'GET')).find((row) => row.id === saved.id)!
    expect(draft.input.coverFileId).toBe('cover-a')
    expect(draft.input.contribution).toBeUndefined()
    const cleared = await mockCommunity<CommunityPostDetailDto>(`/drafts/${saved.id}`, 'PATCH', { ...draft.input, coverFileId: null })
    expect(cleared.coverFileId).toBeNull()
    expect(cleared.contentBlocks).toEqual(input.contentBlocks)
    expect((await mockResourceHub<ResourceHubListDto>('/items')).items.some((item) => item.id === saved.id)).toBe(false)
  })
  it.each(['article', 'video'] as const)('%s 保存后列表、详情及播放器读取封面，移除不继续展示旧封面', async (kind) => {
    demoImages.set('cover-a', new File(['cover'], 'cover.png', { type: 'image/png' }))
    const video = kind === 'video' ? await mockResourceHub<{ id: string }>('/uploads/video', 'POST', new File(['video'], 'video.mp4', { type: 'video/mp4' })) : undefined
    const input: CommunityPostInput = { type: 'general', title: '封面往返测试', status: 'published', visibility: 'public', contentBlocks: [{ type: 'paragraph', text: '教程正文保持独立' }], bindings: [], topicIds: [], contribution: { kind, tags: [], teachingReuseConsent: false, videoAssetId: video?.id, coverFileId: 'cover-a' } }
    const saved = await mockCommunity<CommunityPostDetailDto>('/posts', 'POST', input)
    const detail = await mockResourceHub<ResourceContributionDetailDto>(`/contributions/${saved.id}`)
    const list = await mockResourceHub<ResourceHubListDto>('/items')
    expect(detail.contribution.coverUrl).toMatch(/^blob:/)
    expect(list.items.find((item) => item.id === saved.id)?.coverUrl).toBe(detail.contribution.coverUrl)
    if (video) expect((await mockResourceHub<VideoPlaybackDto>(`/videos/${video.id}/playback`)).poster).toBe(detail.contribution.coverUrl)
    const restored = await mockCommunity<CommunityPostDetailDto>(`/posts/${saved.id}`, 'GET')
    expect(restored.contribution?.coverFileId).toBe('cover-a')
    expect(restored.contentBlocks).toEqual(input.contentBlocks)
    await mockCommunity(`/posts/${saved.id}`, 'PATCH', { ...input, expectedRevision: restored.revision, status: 'draft' })
    const draft = (await mockCommunity<CommunityDraftDto[]>('/drafts', 'GET')).find((row) => row.id === saved.id)!
    expect(draft.input.contribution).toMatchObject({ kind, coverFileId: 'cover-a' })
    expect(draft.input.expectedRevision).toBe(draft.revision)
    await mockCommunity(`/drafts/${saved.id}`, 'PATCH', draft.input)
    const latest = await mockCommunity<CommunityPostDetailDto>(`/posts/${saved.id}`, 'GET')
    await mockCommunity(`/posts/${saved.id}`, 'PATCH', { ...input, expectedRevision: latest.revision, contribution: { ...input.contribution, coverFileId: undefined } })
    expect((await mockResourceHub<ResourceContributionDetailDto>(`/contributions/${saved.id}`)).contribution.coverUrl).toBeNull()
    if (video) expect((await mockResourceHub<VideoPlaybackDto>(`/videos/${video.id}/playback`)).poster).toBeNull()
  })
})
