import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { contentDetectionFields, defaultContentDetectionPolicy, detectContent, type CommunityCommentDto, type CommunityDraftDto, type CommunityPostDetailDto, type CommunityPostInput, type CommunityProfileDto, type CommunityProfileTimelineDto, type CommunityProfileUpdateDto, type CreatorContentSummaryDto, type LearningCollectionDto, type ResourceContributionDetailDto, type ResourceHubListDto, type VideoAssetDto } from '@ai-learning-hub/contracts'
import { mockCommunity, resetCommunityMock } from './community.mock'
import { mockResourceHub, resetResourceHubMock } from './resourceHub.mock'

const values = new Map<string, string>()
const reviewText = '反诈学习案例：先交保证金再返佣'
const rejectText = '合成拒绝样本'
const rules = structuredClone(defaultContentDetectionPolicy.rules)
const input = (text = 'RAG 教程：const key = process.env.API_KEY;'): CommunityPostInput => ({ type: 'note', title: '合成学习笔记', contentBlocks: [{ type: 'paragraph', text }], bindings: [], topicIds: [], visibility: 'public', status: 'published' })

beforeEach(() => {
  vi.stubGlobal('localStorage', { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value), removeItem: (key: string) => values.delete(key) })
  values.clear(); resetCommunityMock(); resetResourceHubMock()
  // 仅在测试期间启用合成拒绝规则，不改变演示环境默认策略。
  defaultContentDetectionPolicy.rules.push({ id: 'synthetic-reject', content: rejectText, method: 'literal', fields: [...contentDetectionFields], category: 'school', action: 'reject', enabled: true, explanation: '仅用于验证拒绝后保留编辑内容。' })
})
afterEach(() => {
  defaultContentDetectionPolicy.rules = structuredClone(rules)
  resetResourceHubMock(); resetCommunityMock(); vi.unstubAllGlobals()
})

describe('内容检测 Mock 与共享规则的增量契约', () => {
  it('四级动作与共享检测器一致；原文保留、拒绝不覆盖、旧修订不可编辑', async () => {
    let post = await mockCommunity<CommunityPostDetailDto>('/posts', 'POST', input())
    expect(post).toMatchObject({ status: 'published', detection: { action: 'allow' } })
    const warning = '加群领取付费资源：请讨论版权边界'
    post = await mockCommunity<CommunityPostDetailDto>(`/posts/${post.id}`, 'PATCH', { ...input(warning), expectedRevision: post.revision })
    expect(post.detection).toEqual(detectContent({ postTitle: post.title!, postBody: warning, postLabels: '', mediaCaption: '' }, defaultContentDetectionPolicy))
    await expect(mockCommunity(`/posts/${post.id}`, 'PATCH', { ...input(rejectText), expectedRevision: post.revision })).rejects.toMatchObject({ code: 'CONTENT_REJECTED' })
    expect(await mockCommunity(`/posts/${post.id}`, 'GET')).toEqual(post)
    const transformed = reviewText.split('').join('\u200b')
    post = await mockCommunity<CommunityPostDetailDto>(`/posts/${post.id}`, 'PATCH', { ...input(transformed), expectedRevision: post.revision })
    expect(post).toMatchObject({ status: 'pending_review', body: transformed, detection: { action: 'review', mediaReview: 'not_performed' } })
    expect(await mockCommunity<CommunityPostDetailDto[]>('/posts', 'GET')).not.toContainEqual(expect.objectContaining({ id: post.id }))
    expect(await mockCommunity<CommunityPostDetailDto[]>('/users/student/posts', 'GET')).not.toContainEqual(expect.objectContaining({ id: post.id }))
    expect(JSON.stringify(await mockCommunity('/search?q=合成学习笔记', 'GET'))).not.toContain(post.id)
    await expect(mockCommunity(`/posts/${post.id}/comments`, 'POST', { contentBlocks: input().contentBlocks })).rejects.toThrow('待审')
    await expect(mockCommunity(`/posts/${post.id}`, 'PATCH', { ...input(), expectedRevision: post.revision! - 1 })).rejects.toThrow('修订')
    const corrected = await mockCommunity<CommunityPostDetailDto>(`/posts/${post.id}`, 'PATCH', { ...input(), expectedRevision: post.revision })
    expect(corrected).toMatchObject({ status: 'published', detection: { action: 'allow' } })
  })

  it('草稿列表携带编辑修订；待审评论不进入公开时间线或计数', async () => {
    const draft = await mockCommunity<CommunityPostDetailDto>('/posts', 'POST', { ...input(), status: 'draft' })
    const drafts = await mockCommunity<CommunityDraftDto[]>('/drafts', 'GET')
    expect(drafts.find((row) => row.id === draft.id)?.revision).toBe(draft.revision)
    const post = await mockCommunity<CommunityPostDetailDto>(`/drafts/${draft.id}`, 'PATCH', { ...input(), expectedRevision: draft.revision })
    expect(post.status).toBe('draft')
    const published = await mockCommunity<CommunityPostDetailDto>(`/posts/${post.id}`, 'PATCH', { ...input(), expectedRevision: post.revision })
    const comment = await mockCommunity<CommunityCommentDto>(`/posts/${post.id}/comments`, 'POST', { contentBlocks: input(reviewText).contentBlocks })
    expect(comment.status).toBe('pending_review')
    expect((await mockCommunity<CommunityPostDetailDto>(`/posts/${post.id}`, 'GET')).stats.comments).toBe(published.stats.comments)
    const timeline = await mockCommunity<CommunityProfileTimelineDto>('/users/student/timeline?tab=replies', 'GET')
    expect(timeline.replies.some((row) => row.id === comment.id)).toBe(false)
    await expect(mockCommunity(`/comments/${comment.id}/like`, 'PUT')).rejects.toThrow('待审')
    const saved = await mockCommunity<CommunityCommentDto>(`/comments/${comment.id}`, 'PATCH', { contentBlocks: input().contentBlocks, expectedRevision: comment.revision })
    expect(saved.status).toBe('published')
    await expect(mockCommunity(`/comments/${comment.id}`, 'PATCH', { contentBlocks: input(rejectText).contentBlocks, expectedRevision: saved.revision })).rejects.toMatchObject({ code: 'CONTENT_REJECTED' })
    expect(await mockCommunity<CommunityCommentDto[]>(`/posts/${post.id}/comments`, 'GET')).toContainEqual(saved)
  })

  it('资料复核保留旧公开值，非文字修改重新绑定修订，拒绝不修改资料', async () => {
    const before = await mockCommunity<CommunityProfileDto>('/users/student', 'GET')
    const fields = { displayName: before.displayName, bio: reviewText, headline: '', location: '', websiteUrl: '', expertiseTopics: [], allowAchievementDrafts: false }
    const held = await mockCommunity<CommunityProfileUpdateDto>('/profile', 'PATCH', { ...fields, expectedUserRevision: before.userRevision, expectedProfileRevision: before.revision })
    expect(held.profile).toMatchObject({ bio: before.bio, pendingChanges: { bio: reviewText }, detection: { action: 'review' } })
    const avatar = await mockCommunity<CommunityProfileUpdateDto>('/profile/avatar', 'DELETE', { expectedUserRevision: held.profile.userRevision, expectedProfileRevision: held.profile.revision })
    expect(avatar.profile).toMatchObject({ revision: held.profile.revision + 1, bio: before.bio, pendingChanges: { bio: reviewText }, detection: { action: 'review' } })
    await expect(mockCommunity('/profile', 'PATCH', { ...fields, bio: rejectText, expectedUserRevision: avatar.profile.userRevision, expectedProfileRevision: avatar.profile.revision })).rejects.toMatchObject({ code: 'CONTENT_REJECTED' })
    expect(await mockCommunity('/users/student', 'GET')).toEqual(avatar.profile)
  })

  it('合集内容、成员变更重检；拒绝不写入，旁路详情不暴露他人待审合集', async () => {
    const fields = { name: '合成合集', description: reviewText, visibility: 'community' }
    let collection = await mockResourceHub<LearningCollectionDto>('/collections', 'POST', fields)
    expect(collection).toMatchObject({ contentStatus: 'pending_review', detection: { action: 'review' } })
    collection = await mockResourceHub<LearningCollectionDto>(`/collections/${collection.id}/items`, 'POST', { postId: 'resource-demo-campus-agent' })
    expect(collection.contentStatus).toBe('pending_review')
    await expect(mockResourceHub(`/collections/${collection.id}`, 'PATCH', { ...fields, description: rejectText, expectedRevision: collection.revision })).rejects.toMatchObject({ code: 'CONTENT_REJECTED' })
    expect(await mockResourceHub(`/collections/${collection.id}`)).toEqual(collection)
    const key = 'ai-learning-resource-hub:collections-v1'
    const stored = JSON.parse(values.get(key)!)
    stored.find((row: { id: string }) => row.id === collection.id).owner.id = 'synthetic-other-author'
    values.set(key, JSON.stringify(stored))
    await expect(mockResourceHub(`/collections/${collection.id}`)).rejects.toThrow('不存在')
    expect((await mockResourceHub<ResourceContributionDetailDto>('/contributions/resource-demo-campus-agent')).collection).toBeNull()
  })

  it('资源标签进入复核；工作室单独列待审，本人可预览但不能产生观看进度', async () => {
    const video = await mockResourceHub<VideoAssetDto>('/uploads/video', 'POST', new File(['synthetic'], 'synthetic.mp4', { type: 'video/mp4' }))
    const post = await mockCommunity<CommunityPostDetailDto>('/posts', 'POST', { ...input(), contribution: { kind: 'video', videoAssetId: video.id, tags: [reviewText], teachingReuseConsent: false } })
    expect(post).toMatchObject({ status: 'pending_review', detection: { action: 'review', hits: [expect.objectContaining({ field: 'resourceTags' })] } })
    const studio = await mockResourceHub<CreatorContentSummaryDto>('/studio')
    expect(studio.pendingReview.map((row) => row.id)).toContain(post.id)
    expect(studio.drafts.map((row) => row.id)).not.toContain(post.id)
    expect((await mockResourceHub<ResourceHubListDto>('/items')).items.map((row) => row.postId)).not.toContain(post.id)
    await expect(mockResourceHub(`/videos/${video.id}/playback`)).resolves.toMatchObject({ assetId: video.id })
    await expect(mockResourceHub(`/videos/${video.id}/progress`, 'PUT', { positionSeconds: 1, watchedSeconds: 1, completed: false })).rejects.toThrow('待审')
  })
})
