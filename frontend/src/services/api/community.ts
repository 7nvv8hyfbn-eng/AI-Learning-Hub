import type { CommunityAuthorDto, CommunityBindingInput, CommunityBindingContextDto, CommunityCommentDto, CommunityCommentInput, CommunityContextDto, CommunityFeedDto, CommunityFeedMode, CommunityNotificationDto, CommunityPostDetailDto, CommunityPostInput, CommunityPostType, CommunityProfileDto, CommunityProfileInput, CommunityProfileRelationsDto, CommunityProfileTab, CommunityProfileTimelineDto, CommunityProfileUpdateDto, CommunitySignalInput, CommunityTopicDto } from '@ai-learning-hub/contracts'
import { dataMode, request, writeRequest } from './client'
import { mockCommunity } from './community.mock'
import { randomId } from './random-id'
import type { AuthUser, CommunityDraftDto, CommunitySearchResultDto, CommunitySearchType, OnboardingInput } from '@ai-learning-hub/contracts'
const demoImages = new Map<string, File>()
const call = <T>(path: string, method = 'GET', body?: unknown, key?: string): Promise<T> => dataMode === 'api'
  ? method === 'GET' ? request<T>(`/community${path}`) : writeRequest<T>(`/community${path}`, method, body, key)
  : mockCommunity<T>(path, method, body)
export const communityApi = {
  feed: (mode: CommunityFeedMode, type: CommunityPostType | 'all', cursor?: string) => call<CommunityFeedDto>(`/feed?${new URLSearchParams({ mode, type, ...(cursor ? { cursor } : {}) })}`),
  updates: (since: string, mode: CommunityFeedMode, type: CommunityPostType | 'all') => call<{ count: number }>(`/feed/updates?${new URLSearchParams({ since, mode, type })}`),
  context: () => call<CommunityContextDto>('/context'),
  bindingContext: (binding: CommunityBindingInput) => call<CommunityBindingContextDto>(`/bindings/context?${new URLSearchParams({ type: binding.type, id: binding.id })}`),
  post: (id: string) => call<CommunityPostDetailDto>(`/posts/${id}`),
  save: (input: CommunityPostInput, id?: string, key?: string) => call<CommunityPostDetailDto>(id ? `/posts/${id}` : '/posts', id ? 'PATCH' : 'POST', input, key),
  remove: (id: string) => call(`/posts/${id}`, 'DELETE'),
  list: (kind: 'posts' | 'bookmarks' | 'user' | 'answers' | 'topic', id = '', query = '') => call<CommunityPostDetailDto[]>(kind === 'user' || kind === 'answers' ? `/users/${encodeURIComponent(id)}/${kind === 'answers' ? 'answers' : 'posts'}` : kind === 'topic' ? `/topics/${encodeURIComponent(id)}/posts` : `/${kind}${query ? `?${query}` : ''}`),
  comments: (id: string) => call<CommunityCommentDto[]>(`/posts/${id}/comments`),
  comment: (postId: string, input: CommunityCommentInput, id?: string) => call<CommunityCommentDto>(id ? `/comments/${id}` : `/posts/${postId}/comments`, id ? 'PATCH' : 'POST', input),
  removeComment: (id: string) => call(`/comments/${id}`, 'DELETE'),
  accept: (postId: string, id: string) => call(`/questions/${postId}/accept/${id}`, 'POST'),
  reaction: (id: string, kind: 'like' | 'useful' | 'bookmark', active: boolean) => call<{ active: boolean; stats?: CommunityPostDetailDto['stats'] }>(`/posts/${id}/${kind === 'bookmark' ? 'bookmark' : `reactions/${kind}`}`, active ? 'PUT' : 'DELETE'),
  commentLike: (id: string, active: boolean) => call(`/comments/${id}/like`, active ? 'PUT' : 'DELETE'),
  follow: (id: string, topic: boolean, active: boolean) => call<{ active: boolean; followerCount?: number }>(`/${topic ? 'topics' : 'users'}/${id}/follow`, active ? 'PUT' : 'DELETE'),
  profile: (username: string) => call<CommunityProfileDto>(`/users/by-username/${encodeURIComponent(username)}`),
  username: (username: string) => call<AuthUser>('/profile/username', 'PATCH', { username }),
  onboarding: (input: OnboardingInput) => call<AuthUser>('/onboarding', 'POST', input),
  schools: () => call<Array<{ id: string; name: string; departments?: Array<{ id: string; name: string }> }>>('/onboarding/schools'),
  search: (q: string, type: CommunitySearchType, cursor?: string) => call<CommunitySearchResultDto>(`/search?${new URLSearchParams({ q, type, ...(cursor ? { cursor } : {}) })}`),
  drafts: () => call<CommunityDraftDto[]>('/drafts'),
  saveDraft: (input: CommunityPostInput, id?: string, key?: string) => call<CommunityPostDetailDto>(id ? `/drafts/${id}` : '/drafts', id ? 'PATCH' : 'POST', { ...input, status: 'draft' }, key),
  deleteDraft: (id: string) => call(`/drafts/${id}`, 'DELETE'),
  async following(id: string): Promise<CommunityAuthorDto[]> { return (await call<CommunityProfileRelationsDto>(`/users/${encodeURIComponent(id)}/following?limit=50`)).items },
  relations: (id: string, kind: 'followers' | 'following', cursor?: string) => call<CommunityProfileRelationsDto>(`/users/${encodeURIComponent(id)}/${kind}?${new URLSearchParams({ limit: '20', ...(cursor ? { cursor } : {}) })}`),
  timeline: (id: string, tab: CommunityProfileTab, cursor?: string) => call<CommunityProfileTimelineDto>(`/users/${encodeURIComponent(id)}/timeline?${new URLSearchParams({ tab, limit: '20', ...(cursor ? { cursor } : {}) })}`),
  updateProfile: (input: CommunityProfileInput) => call<CommunityProfileUpdateDto>('/profile', 'PATCH', input),
  pin: (id: string | null, expectedProfileRevision: number) => call<CommunityProfileDto>(id ? `/posts/${encodeURIComponent(id)}/pin` : '/profile/pinned-post', id ? 'PUT' : 'DELETE', { expectedProfileRevision }),
  topics: () => call<CommunityTopicDto[]>('/topics'),
  interests: (themeIds: string[]) => call<CommunityContextDto>('/interests', 'POST', { themeIds }),
  feedback: (id: string, kind: 'hide' | 'not-interested' | 'mute' | 'block', active = true) => call(`/${kind === 'mute' || kind === 'block' ? 'users' : 'posts'}/${id}/${kind}`, active ? 'POST' : 'DELETE'),
  report: (id: string, reason: string, description: string, comment = false) => call(`/${comment ? 'comments' : 'posts'}/${id}/report`, 'POST', { reason, description }),
  notifications: () => call<CommunityNotificationDto[]>('/notifications'),
  unread: () => call<{ count: number }>('/notifications/unread-count'),
  read: (id?: string) => call(id ? `/notifications/${id}/read` : '/notifications/read-all', 'POST'),
  signals: (input: CommunitySignalInput) => call('/signals', 'POST', input),
  impressions: (items: Array<{ requestId: string; postId: string; dwellMs?: number }>, dwell = false) => call(`/feed/${dwell ? 'dwell' : 'impressions'}`, 'POST', { items }),
  async upload(file: File) {
    if (file.size > 5 * 1024 * 1024 || !['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || !/\.(png|jpe?g|webp)$/i.test(file.name)) throw new Error('请选择不超过 5MB 的 PNG、JPEG 或 WebP 图片')
    if (dataMode === 'mock') { const id = `demo-image-${randomId()}`; demoImages.set(id, file); return { id } }
    const form = new FormData(); form.append('file', file)
    return request<{ id: string }>('/community/media', { method: 'POST', body: form })
  },
  async profileImage(file: File, kind: 'avatar' | 'banner', expectedUserRevision: number, expectedProfileRevision: number) {
    const limit = kind === 'avatar' ? 5 : 8
    if (file.size > limit * 1024 * 1024 || !['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) throw new Error(`请选择不超过 ${limit}MB 的 PNG、JPEG 或 WebP 图片`)
    if (dataMode === 'mock') return mockCommunity<CommunityProfileUpdateDto>(`/profile/${kind}`, 'POST', { file, expectedUserRevision, expectedProfileRevision })
    const form = new FormData()
    form.append('file', file, `community-${kind}.webp`)
    form.append('expectedUserRevision', String(expectedUserRevision))
    form.append('expectedProfileRevision', String(expectedProfileRevision))
    return request<CommunityProfileUpdateDto>(`/community/profile/${kind}`, { method: 'POST', body: form })
  },
  removeProfileImage: (kind: 'avatar' | 'banner', expectedUserRevision: number, expectedProfileRevision: number) => call<CommunityProfileUpdateDto>(`/profile/${kind}`, 'DELETE', { expectedUserRevision, expectedProfileRevision }),
  async image(id: string) {
    if (dataMode === 'mock') { const file = demoImages.get(id); if (!file) throw new Error('演示图片仅保存在当前浏览器会话'); return URL.createObjectURL(file) }
    const { url } = await call<{ url: string }>(`/media/${id}/url`)
    const source = url.startsWith('/api/') && import.meta.env.VITE_API_BASE_URL?.startsWith('http') ? new URL(url, import.meta.env.VITE_API_BASE_URL).href : url
    const response = await fetch(source, { headers: url.startsWith('/api/') ? { authorization: `Bearer ${sessionStorage.getItem('student-access-token') || ''}` } : {} })
    if (!response.ok) throw new Error('图片不可见或已失效')
    return URL.createObjectURL(await response.blob())
  },
}
