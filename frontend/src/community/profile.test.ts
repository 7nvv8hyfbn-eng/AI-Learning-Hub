import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { reactive } from 'vue'
import type { AuthUser, CommunityProfileDto, CommunityProfileInput } from '@ai-learning-hub/contracts'
import CommunityProfileView from './CommunityProfileView.vue'
import { communityApi } from '../services/api/community'
import { flushRender, setupComponent } from './test-renderer'

interface ProfileState {
  profile: CommunityProfileDto | null
  tab: string
  legacyPanel: string | null
  editOpen: boolean
  openEditor(): void
  form: CommunityProfileInput
  username: string
  posts: NonNullable<CommunityProfileDto['pinnedPost']>[]
}

const routing = vi.hoisted(() => ({
  route: {} as Record<string, unknown>,
  replace: vi.fn(),
}))
const auth = vi.hoisted(() => ({ user: { id: 'student', username: 'student', communityWriteEnabled: true } as AuthUser }))
vi.mock('vue-router', () => ({ useRoute: () => routing.route, useRouter: () => ({ replace: routing.replace }) }))
vi.mock('../stores/auth', () => ({ useAuthStore: () => auth }))
vi.mock('../stores/community', () => ({ useCommunityStore: () => ({ operations: {}, syncAuthors: vi.fn(), postCopies: () => [], follow: vi.fn() }) }))
vi.mock('../services/api/community', () => ({ communityApi: { profile: vi.fn(), profileById: vi.fn(), timeline: vi.fn(), relations: vi.fn(), signals: vi.fn(), feedback: vi.fn(), updateProfile: vi.fn(), profileImage: vi.fn(), removeProfileImage: vi.fn(), username: vi.fn(), pin: vi.fn() } }))

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
  vi.stubGlobal('window', new EventTarget())
  vi.stubGlobal('document', Object.assign(new EventTarget(), { visibilityState: 'visible' }))
  routing.route = reactive({ path: '/community/user/student', fullPath: '/community/user/student', params: { username: 'student' }, query: {} })
  vi.mocked(communityApi.profile).mockResolvedValue(profile())
  vi.mocked(communityApi.timeline).mockResolvedValue({ posts: [], replies: [], nextCursor: null })
  vi.mocked(communityApi.relations).mockResolvedValue({ items: [], nextCursor: null })
  vi.mocked(communityApi.signals).mockResolvedValue({})
})
afterEach(() => { vi.unstubAllGlobals() })

describe('独立社区个人主页', () => {
  it('回到页面刷新同一用户标签及帖子副本，保留未保存资料且不重载动态', async () => {
    const original: CommunityProfileDto = { ...profile(), verifiedType: 'official', badges: [{ code: 'official', label: '官方', tone: 'orange' }] }
    vi.mocked(communityApi.profile).mockResolvedValue(original)
    const view = setupComponent<ProfileState>(CommunityProfileView)
    await flushRender()
    view.state.openEditor(); view.state.form.bio = '尚未保存的简介'
    view.state.posts = [{ id: 'post', author: { ...original }, quotedPost: { available: true, author: { ...original } } }] as never
    let resolve!: (value: CommunityProfileDto) => void
    vi.mocked(communityApi.profileById).mockReturnValueOnce(new Promise(done => { resolve = done }))
    window.dispatchEvent(new Event('focus')); document.dispatchEvent(new Event('visibilitychange'))
    expect(communityApi.profileById).toHaveBeenCalledExactlyOnceWith('student')
    resolve({ ...original, badges: [], revision: 4 }); await flushRender()
    expect(view.state.profile).toMatchObject({ badges: [], verifiedType: 'official' })
    expect(view.state.posts[0]?.author.badges).toEqual([])
    expect(view.state.posts[0]?.quotedPost).toMatchObject({ author: { badges: [] } })
    expect(view.state.form).toMatchObject({ bio: '尚未保存的简介', expectedProfileRevision: 2 })
    expect(view.state.editOpen).toBe(true); expect(communityApi.timeline).toHaveBeenCalledTimes(1)
    view.unmount(); window.dispatchEvent(new Event('focus'))
    expect(communityApi.profileById).toHaveBeenCalledTimes(1)
  })

  it('隐藏窗口不读取，切换账号后忽略旧主页迟到的标签', async () => {
    const view = setupComponent<ProfileState>(CommunityProfileView)
    await flushRender()
    Object.assign(document, { visibilityState: 'hidden' }); window.dispatchEvent(new Event('focus'))
    expect(communityApi.profileById).not.toHaveBeenCalled()
    Object.assign(document, { visibilityState: 'visible' })
    let resolve!: (value: CommunityProfileDto) => void
    vi.mocked(communityApi.profileById).mockReturnValueOnce(new Promise(done => { resolve = done }))
    document.dispatchEvent(new Event('visibilitychange'))
    expect(communityApi.profileById).toHaveBeenCalledExactlyOnceWith('student')
    vi.mocked(communityApi.profile).mockResolvedValue({ ...profile(false), badges: [] })
    Object.assign(routing.route, { fullPath: '/community/user/teacher', params: { username: 'teacher' } }); await flushRender()
    resolve({ ...profile(), badges: [{ code: 'official', label: '官方', tone: 'orange' }] }); await flushRender()
    expect(view.state.profile).toMatchObject({ id: 'teacher', badges: [] })
    view.unmount()
  })

  it('公开展示保持旧资料，编辑器恢复待审新值和当前修订', async () => {
    vi.mocked(communityApi.profile).mockResolvedValue({ ...profile(), pendingChanges: { username: 'synthetic_pending', displayName: '待审昵称', bio: '待审简介', expertiseTopics: ['RAG'] } })
    const view = setupComponent<ProfileState>(CommunityProfileView)
    await flushRender()
    view.state.openEditor()
    expect(view.state.profile?.displayName).toBe('学习者')
    expect(view.state.form).toMatchObject({ displayName: '待审昵称', bio: '待审简介', expertiseTopics: ['RAG'], expectedUserRevision: 3, expectedProfileRevision: 2 })
    expect(view.state.username).toBe('synthetic_pending')
    view.unmount()
  })
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
