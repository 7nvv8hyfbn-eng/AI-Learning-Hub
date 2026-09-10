import type { CommunityAuthorDto, CommunityBindingInput, CommunityBindingContextDto, CommunityCommentDto, CommunityCommentPageDto, CommunityCommentQuery, CommunityCommentInput, CommunityContextDto, CommunityEligibilityDto, CommunityFeedDto, CommunityFeedMode, CommunityNotificationDto, CommunityPostDetailDto, CommunityPostInput, CommunityPostType, CommunityProfileDto, CommunityProfileInput, CommunityProfileRelationsDto, CommunityProfileTab, CommunityProfileTimelineDto, CommunityProfileUpdateDto, CommunitySignalInput, CommunityTopicDto } from '@ai-learning-hub/contracts'
import { dataMode, request, writeRequest, studentSession } from './client'
import { SESSION_REPLACED } from '@ai-learning-hub/contracts'
import { assertMockCommunityWrite, mockCommunity } from './community.mock'
import { randomId } from './random-id'
import type { GovernanceAppealInput, GovernanceMineDto, GovernanceReportInput, GovernanceTarget } from '@ai-learning-hub/contracts'
import type { AuthUser, CampusIdentityVerificationDto, CampusIdentityVerificationInput, CommunityDraftDto, CommunitySearchResultDto, CommunitySearchType, IdentityVerificationStatus, OnboardingInput } from '@ai-learning-hub/contracts'
import { demoImages } from './community-images.mock'
const call = <T>(path: string, method = 'GET', body?: unknown, key?: string): Promise<T> => dataMode === 'api'
  ? method === 'GET' ? request<T>(`/community${path}`) : writeRequest<T>(`/community${path}`, method, body, key)
  : mockCommunity<T>(path, method, body)
export const communityApi = {
  moderationTarget: (type: string, id: string) => call<import('@ai-learning-hub/contracts').ModeratorTargetDto>(`/moderation/targets/${encodeURIComponent(type)}/${encodeURIComponent(id)}`),
  moderate: (type: string, id: string, input: import('@ai-learning-hub/contracts').ModeratorDecisionInput) => call<{ handled: boolean; actionId: string }>(`/moderation/targets/${encodeURIComponent(type)}/${encodeURIComponent(id)}/decision`, 'POST', input),
  governance: (page = 1) => call<GovernanceMineDto>(`/governance/mine?page=${page}`),
  reportTarget: (targetType: GovernanceTarget, targetId: string, input: GovernanceReportInput) => call<{ reported: boolean; id: string }>('/governance/reports', 'POST', { targetType, targetId, ...input }),
  appeal: (input: GovernanceAppealInput) => call('/governance/appeals', 'POST', input),
  recoverySession: (identifier: string, password: string) => request<{ token: string; expiresIn: number }>('/community/recovery/session', { method: 'POST', body: JSON.stringify({ identifier, password }) }, false),
  recoveryMine: (token: string, page = 1) => request<GovernanceMineDto>(`/community/recovery/mine?page=${page}`, { headers: { authorization: `Bearer ${token}` } }, false),
  recoveryAppeal: (token: string, input: GovernanceAppealInput) => request('/community/recovery/appeals', { method: 'POST', headers: { authorization: `Bearer ${token}` }, body: JSON.stringify(input) }, false),
  feed: (mode: CommunityFeedMode, type: CommunityPostType | 'all', cursor?: string, priorityIds: string[] = []) => call<CommunityFeedDto>(`/feed?${new URLSearchParams({ mode, type, ...(cursor ? { cursor } : {}), ...(priorityIds.length ? { priorityIds: priorityIds.join(',') } : {}) })}`),
  updates: (since: string, mode: CommunityFeedMode, type: CommunityPostType | 'all', priorityIds: string[] = []) => call<{ count: number; invalidPriorityIds?: string[] }>(`/feed/updates?${new URLSearchParams({ since, mode, type, ...(priorityIds.length ? { priorityIds: priorityIds.join(',') } : {}) })}`),
  context: () => call<CommunityContextDto>('/context'),
  eligibility: () => call<CommunityEligibilityDto>('/eligibility'),
  verification: () => call<CampusIdentityVerificationDto>('/verification'),
  submitVerification: (input: CampusIdentityVerificationInput) => call<CampusIdentityVerificationDto>('/verification', 'PUT', input),
  demoVerificationStatus: (status: Exclude<IdentityVerificationStatus, 'unsubmitted'>, reason: string) => call<CampusIdentityVerificationDto>('/verification/demo-review', 'POST', { status, reason }),
  bindingContext: (binding: CommunityBindingInput) => call<CommunityBindingContextDto>(`/bindings/context?${new URLSearchParams({ type: binding.type, id: binding.id })}`),
  post: (id: string) => call<CommunityPostDetailDto>(`/posts/${id}`),
  save: (input: CommunityPostInput, id?: string, key?: string) => call<CommunityPostDetailDto>(id ? `/posts/${id}` : '/posts', id ? 'PATCH' : 'POST', input, key),
  unpublish: (id: string) => call<{ unpublished: boolean }>(`/posts/${id}/unpublish`, 'POST'),
  remove: (id: string) => call(`/posts/${id}`, 'DELETE'),
  list: (kind: 'posts' | 'bookmarks' | 'user' | 'answers' | 'topic', id = '', query = '') => call<CommunityPostDetailDto[]>(kind === 'user' || kind === 'answers' ? `/users/${encodeURIComponent(id)}/${kind === 'answers' ? 'answers' : 'posts'}` : kind === 'topic' ? `/topics/${encodeURIComponent(id)}/posts` : `/${kind}${query ? `?${query}` : ''}`),
  comments: (id: string, query: CommunityCommentQuery = {}) => call<CommunityCommentPageDto>(`/posts/${id}/comments?${new URLSearchParams({ limit: String(query.limit || 25), ...(query.cursor ? { cursor: query.cursor } : {}), ...(query.parentId ? { parentId: query.parentId } : {}) })}`),
  commentDetail: (postId: string, id: string) => call<CommunityCommentDto>(`/posts/${postId}/comments/${id}`),
  comment: (postId: string, input: CommunityCommentInput, id?: string) => call<CommunityCommentDto>(id ? `/comments/${id}` : `/posts/${postId}/comments`, id ? 'PATCH' : 'POST', input),
  removeComment: (id: string) => call(`/comments/${id}`, 'DELETE'),
  accept: (postId: string, id: string) => call(`/questions/${postId}/accept/${id}`, 'POST'),
  reaction: (id: string, kind: 'like' | 'useful' | 'bookmark', active: boolean) => call<{ active: boolean; stats?: Partial<CommunityPostDetailDto['stats']> }>(`/posts/${id}/${kind === 'bookmark' ? 'bookmark' : `reactions/${kind}`}`, active ? 'PUT' : 'DELETE'),
  commentLike: (id: string, active: boolean) => call(`/comments/${id}/like`, active ? 'PUT' : 'DELETE'),
  follow: (id: string, topic: boolean, active: boolean) => call<{ active: boolean; followerCount?: number }>(`/${topic ? 'topics' : 'users'}/${id}/follow`, active ? 'PUT' : 'DELETE'),
  profileById: (id: string) => call<CommunityProfileDto>(`/users/${encodeURIComponent(id)}`),
  quotes: (id: string) => call<CommunityPostDetailDto[]>(`/posts/${encodeURIComponent(id)}/quotes`),
  profile: (username: string) => call<CommunityProfileDto>(`/users/by-username/${encodeURIComponent(username)}`),
  username: (username: string) => call<AuthUser>('/profile/username', 'PATCH', { username }),
  onboarding: (input: OnboardingInput) => call<AuthUser>('/onboarding', 'POST', input),
  schools: () => call<Array<{ id: string; name: string; departments?: Array<{ id: string; name: string }> }>>('/onboarding/schools'),
  search: (q: string, type: CommunitySearchType, cursor?: string) => call<CommunitySearchResultDto>(`/search?${new URLSearchParams({ q, type, ...(cursor ? { cursor } : {}) })}`),
  suggestions: (kind: 'topic' | 'mention', q: string) => call<import('@ai-learning-hub/contracts').CommunityInlineCandidateDto[]>(`/search/suggestions?${new URLSearchParams({ kind, q })}`),
  drafts: () => call<CommunityDraftDto[]>('/drafts'),
  saveDraft: (input: CommunityPostInput, id?: string, key?: string) => call<CommunityPostDetailDto>(id ? `/drafts/${id}` : '/drafts', id ? 'PATCH' : 'POST', { ...input, status: 'draft' }, key),
  deleteDraft: (id: string) => call(`/drafts/${id}`, 'DELETE'),
  async following(id: string): Promise<CommunityAuthorDto[]> { return (await call<CommunityProfileRelationsDto>(`/users/${encodeURIComponent(id)}/following?limit=50`)).items },
  relations: (id: string, kind: 'followers' | 'following', cursor?: string) => call<CommunityProfileRelationsDto>(`/users/${encodeURIComponent(id)}/${kind}?${new URLSearchParams({ limit: '20', ...(cursor ? { cursor } : {}) })}`),
  timeline: (id: string, tab: CommunityProfileTab, cursor?: string) => call<CommunityProfileTimelineDto>(`/users/${encodeURIComponent(id)}/timeline?${new URLSearchParams({ tab, limit: '20', ...(cursor ? { cursor } : {}) })}`),
  updateProfile: (input: CommunityProfileInput) => call<CommunityProfileUpdateDto>('/profile', 'PATCH', input),
  pin: (id: string | null, expectedProfileRevision: number) => call<CommunityProfileDto>(id ? `/posts/${encodeURIComponent(id)}/pin` : '/profile/pinned-post', id ? 'PUT' : 'DELETE', { expectedProfileRevision }),
  topic: (slug: string) => call<CommunityTopicDto>(`/topics/${encodeURIComponent(slug)}`),
  topics: () => call<CommunityTopicDto[]>('/topics'),
  interests: (themeIds: string[]) => call<CommunityContextDto>('/interests', 'POST', { themeIds }),
  feedback: (id: string, kind: 'hide' | 'not-interested' | 'mute' | 'block', active = true) => call(`/${kind === 'mute' || kind === 'block' ? 'users' : 'posts'}/${id}/${kind}`, active ? 'POST' : 'DELETE'),
  report: (id: string, reason: string, description: string, comment = false) => call(`/${comment ? 'comments' : 'posts'}/${id}/report`, 'POST', { reason, description }),
  notifications: () => call<CommunityNotificationDto[]>('/notifications'),
  unread: () => call<{ count: number }>('/notifications/unread-count'),
  read: (id?: string) => call(id ? `/notifications/${id}/read` : '/notifications/read-all', 'POST'),
  signals: (input: CommunitySignalInput) => call('/signals', 'POST', input),
  viewContext: () => call<import('@ai-learning-hub/contracts').CommunityViewContextDto>('/feed/view-context', 'POST', {}),
  impressions: (items: import('@ai-learning-hub/contracts').CommunityImpressionInput[], dwell = false) => call<import('@ai-learning-hub/contracts').CommunityImpressionsDto>(`/feed/${dwell ? 'dwell' : 'impressions'}`, 'POST', { items }),
  async upload(file: File, options: { key?: string; signal?: AbortSignal } = {}) {
    if (file.size > 5 * 1024 * 1024 || !['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || !/\.(png|jpe?g|webp)$/i.test(file.name)) throw new Error('请选择不超过 5MB 的 PNG、JPEG 或 WebP 图片')
    if (dataMode === 'mock') { assertMockCommunityWrite('upload'); const id = `demo-image-${randomId()}`; demoImages.set(id, file); return { id } }
    const form = new FormData(); form.append('file', file)
    return request<{ id: string }>('/community/media', { method: 'POST', body: form, signal: options.signal, headers: { 'idempotency-key': options.key || randomId() } })
  },
  async profileImage(file: File, kind: 'avatar' | 'banner', expectedUserRevision: number, expectedProfileRevision: number) {
    const limit = kind === 'avatar' ? 5 : 8
    if (file.size > limit * 1024 * 1024 || !['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) throw new Error(`请选择不超过 ${limit}MB 的 PNG、JPEG 或 WebP 图片`)
    if (dataMode === 'mock') return mockCommunity<CommunityProfileUpdateDto>(`/profile/${kind}`, 'POST', { file, expectedUserRevision, expectedProfileRevision })
    const form = new FormData()
    form.append('file', file, `community-${kind}.webp`)
    form.append('expectedUserRevision', String(expectedUserRevision))
    form.append('expectedProfileRevision', String(expectedProfileRevision))
    return request<CommunityProfileUpdateDto>(`/community/profile/${kind}`, { method: 'POST', body: form, headers: { 'idempotency-key': randomId() } })
  },
  removeProfileImage: (kind: 'avatar' | 'banner', expectedUserRevision: number, expectedProfileRevision: number) => call<CommunityProfileUpdateDto>(`/profile/${kind}`, 'DELETE', { expectedUserRevision, expectedProfileRevision }),
  async imageBlob(id: string, signal?: AbortSignal): Promise<Blob> {
    if (dataMode === 'mock') { const file = demoImages.get(id); if (!file) throw new Error('演示图片仅保存在当前浏览器会话'); return file }
    const { url } = await call<{ url: string }>(`/media/${id}/url`)
    const source = url.startsWith('/api/') && import.meta.env.VITE_API_BASE_URL?.startsWith('http') ? new URL(url, import.meta.env.VITE_API_BASE_URL).href : url
    const token = studentSession.token()
    const response = await fetch(source, { signal: signal ? AbortSignal.any([signal, studentSession.signal]) : studentSession.signal, headers: url.startsWith('/api/') ? { authorization: `Bearer ${token || ''}` } : {} })
    if (response.status === 401 && (await response.clone().json().catch(() => null))?.errorCode === SESSION_REPLACED) studentSession.end(SESSION_REPLACED, token)
    if (!response.ok) throw new Error('图片不可见或已失效')
    return response.blob()
  },
  async image(id: string): Promise<string> {
    return URL.createObjectURL(await communityApi.imageBlob(id))
  },
}
