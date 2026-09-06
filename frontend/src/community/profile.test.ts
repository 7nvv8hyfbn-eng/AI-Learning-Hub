import { beforeEach, describe, expect, it, vi } from 'vitest'
import { reactive } from 'vue'
import type { AuthUser, CommunityProfileDto } from '@ai-learning-hub/contracts'
import CommunityProfileView from './CommunityProfileView.vue'
import { communityApi } from '../services/api/community'
import { flushRender, setupComponent } from './test-renderer'

interface ProfileState {
  profile: CommunityProfileDto | null
  tab: string
  legacyPanel: string | null
  editOpen: boolean
}

const routing = vi.hoisted(() => ({
  route: {} as Record<string, unknown>,
  replace: vi.fn(),
}))
const auth = vi.hoisted(() => ({ user: { id: 'student', username: 'student' } as AuthUser }))
vi.mock('vue-router', () => ({ useRoute: () => routing.route, useRouter: () => ({ replace: routing.replace }) }))
vi.mock('../stores/auth', () => ({ useAuthStore: () => auth }))
vi.mock('../stores/community', () => ({ useCommunityStore: () => ({ operations: {}, postCopies: () => [], follow: vi.fn() }) }))
vi.mock('../services/api/community', () => ({ communityApi: { profile: vi.fn(), timeline: vi.fn(), relations: vi.fn(), signals: vi.fn(), feedback: vi.fn(), updateProfile: vi.fn(), profileImage: vi.fn(), removeProfileImage: vi.fn(), username: vi.fn(), pin: vi.fn() } }))

const profile = (isSelf = true): CommunityProfileDto => ({
  id: isSelf ? 'student' : 'teacher', username: isSelf ? 'student' : 'teacher', displayName: isSelf ? '学习者' : '教师',
  avatar: null, school: 'AI 学院', major: '人工智能', verifiedType: isSelf ? 'none' : 'teacher',
  revision: 2, userRevision: 3, bio: '简介', headline: '一句话', location: null, websiteUrl: null, bannerUrl: null,
  joinedAt: '2026-01-01T00:00:00.000Z', expertiseTopics: [], postCount: 1, replyCount: 2, likesReceived: 3,
  followerCount: 4, followingCount: 5, following: false, followedBy: false, muted: false, blocked: false,
  isSelf, pinnedPost: null, topics: [], ...(isSelf ? { allowAchievementDrafts: false } : {}),
})

beforeEach(() => {
  vi.resetAllMocks()
  routing.route = reactive({ path: '/community/user/student', fullPath: '/community/user/student', params: { username: 'student' }, query: {} })
  vi.mocked(communityApi.profile).mockResolvedValue(profile())
  vi.mocked(communityApi.timeline).mockResolvedValue({ posts: [], replies: [], nextCursor: null })
  vi.mocked(communityApi.relations).mockResolvedValue({ items: [], nextCursor: null })
  vi.mocked(communityApi.signals).mockResolvedValue({})
})

describe('独立社区个人主页', () => {
  it('按公开用户名读取资料，再按真实用户ID读取动态', async () => {
    const view = setupComponent<ProfileState>(CommunityProfileView)
    await flushRender()
    expect(communityApi.profile).toHaveBeenCalledWith('student')
    expect(communityApi.timeline).toHaveBeenCalledWith('student', 'posts', undefined)
    expect(view.state.profile?.displayName).toBe('学习者')
    view.unmount()
  })

  it('旧 answers 链接映射到真实回复时间线', async () => {
    Object.assign(routing.route, { fullPath: '/community/user/student?tab=answers', query: { tab: 'answers' } })
    const view = setupComponent<ProfileState>(CommunityProfileView)
    await flushRender()
    expect(view.state.tab).toBe('replies')
    expect(communityApi.timeline).toHaveBeenCalledWith('student', 'replies', undefined)
    view.unmount()
  })

  it('其他用户不能进入赞过标签或资料编辑器', async () => {
    vi.mocked(communityApi.profile).mockResolvedValue(profile(false))
    Object.assign(routing.route, { path: '/community/user/teacher', fullPath: '/community/user/teacher?tab=liked&settings=1', params: { username: 'teacher' }, query: { tab: 'liked', settings: '1' } })
    const view = setupComponent<ProfileState>(CommunityProfileView)
    await flushRender()
    expect(view.state.tab).toBe('posts')
    expect(view.state.editOpen).toBe(false)
    expect(communityApi.timeline).toHaveBeenCalledWith('teacher', 'posts', undefined)
    view.unmount()
  })
})
