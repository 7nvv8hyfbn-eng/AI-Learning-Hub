import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { communityOperations, type CommunityEligibilityDto, type CommunityFeedDto, type CommunityPostDetailDto } from '@ai-learning-hub/contracts'
import { MAX_FEED_CACHES, MAX_FEED_ITEMS, useCommunityStore } from '../stores/community'
import { communityApi } from '../services/api/community'
import { mockCommunity, resetCommunityMock } from '../services/api/community.mock'

vi.mock('../services/api/community', () => ({ communityApi: { feed: vi.fn(), context: vi.fn(), eligibility: vi.fn(), post: vi.fn(), follow: vi.fn(), following: vi.fn(), reaction: vi.fn() } }))
beforeEach(() => {
  setActivePinia(createPinia()); vi.resetAllMocks(); resetCommunityMock()
  const allowed = { allowed: true, reasonCode: null, message: null, availableAt: null, nextAction: null }
  vi.mocked(communityApi.eligibility).mockResolvedValue({ canRead: true, canPost: true, canComment: true, canUpload: true, operations: Object.fromEntries(communityOperations.map((operation) => [operation, allowed])), evaluatedAt: new Date(0).toISOString() } as CommunityEligibilityDto)
})
const postFixture = () => mockCommunity<CommunityPostDetailDto>('/posts/community-note-1', 'GET')
const page = (posts: CommunityPostDetailDto[], cursor = 'stable-cursor'): CommunityFeedDto => ({ requestId: 'stable-session', policyVersion: 'v1', items: posts.map((post) => ({ type: 'post', id: post.id, post })), nextCursor: cursor, degraded: false })
describe('社区账号状态隔离', () => {
  it('待复核投稿不插入公开流，旧公开缓存撤出且不伪造发布成功', async () => {
    const store = useCommunityStore(), post = await postFixture()
    vi.mocked(communityApi.feed).mockResolvedValue(page([post]))
    await store.loadFeed('latest', 'all'); await store.loadFeed('for_you', 'all')
    store.openComposer()
    store.published({ ...post, status: 'pending_review' })
    expect(Object.values(store.feeds).every((feed) => !feed.items.some((item) => item.id === post.id) && !feed.publishedPosts.some((item) => item.id === post.id))).toBe(true)
    expect(store.publishNotice?.text).toContain('尚未公开')
    expect(store.publishNotice?.text).not.toContain('发布成功')
  })
  it('warn不改动正文，发布提示解释命中但不重复堆叠', async () => {
    const store = useCommunityStore(), post = await postFixture()
    store.published({ ...post, detection: { action: 'warn', ruleVersion: 1, mediaReview: 'not_performed', hits: [{ ruleId: 'synthetic', field: 'postBody', category: 'spam', action: 'warn', explanation: '请确认资源授权' }] } })
    expect(store.publishNotice?.text).toContain('提醒：请确认资源授权')
    expect(post.body).not.toContain('请确认资源授权')
  })
  it('登出清空游标、滚动位置、草稿、未读与旧请求，迟到响应不恢复状态', async () => {
    const store = useCommunityStore()
    let resolve!: (value: CommunityFeedDto) => void
    vi.mocked(communityApi.feed).mockReturnValue(new Promise((done) => { resolve = done }))
    store.unread = 8; store.openComposer({ title: '未发布的私人草稿' }); store.publishNotice = { id: 'old-post', text: '旧账号发布提示' }
    const loading = store.loadFeed('latest', 'question')
    store.feeds['latest:question'].scroll = 640
    store.clear()
    resolve({ requestId: 'old-session', policyVersion: 'v1', items: [], nextCursor: 'old-cursor', degraded: false })
    await loading
    expect(store.feeds).toEqual({}); expect(store.draft).toBeNull(); expect(store.unread).toBe(0)
    expect(store.composerOpen).toBe(false); expect(store.context).toBeNull(); expect(store.publishNotice).toBeNull(); expect(store.lastFeedLocation).toBe('/community')
  })
  it('发布返回DTO置顶去重，保留会话游标和滚动位置，其余缓存失效', async () => {
    const store = useCommunityStore(), post = await postFixture(), old = { ...post, id: 'old-post' }
    vi.mocked(communityApi.feed).mockResolvedValue(page([old, post]))
    await store.loadFeed('latest', 'all')
    await store.loadFeed('for_you', 'all')
    const current = store.feeds['for_you:all']
    current.scroll = 800; store.openComposer()
    store.published({ ...post, title: '刚刚发布的已确认内容' })
    expect(current.items.map((item) => item.id)).toEqual([post.id, old.id])
    expect(current.items[0]).toMatchObject({ post: { title: '刚刚发布的已确认内容' } })
    expect(current.cursor).toBe('stable-cursor'); expect(current.requestId).toBe('stable-session'); expect(current.scroll).toBe(800)
    expect(store.feeds['latest:all'].loaded).toBe(false); expect(store.composerOpen).toBe(false)
    expect(store.publishNotice?.text).toContain('发布成功，已插入当前列表顶部')
    expect(communityApi.feed).toHaveBeenCalledTimes(2)
    vi.mocked(communityApi.feed).mockResolvedValue(page([post, { ...post, id: 'next-post' }], 'next-cursor'))
    await store.loadFeed('for_you', 'all')
    expect(communityApi.feed).toHaveBeenLastCalledWith('for_you', 'all', 'stable-cursor')
    expect(current.items.map((item) => item.id)).toEqual([post.id, old.id, 'next-post'])
  })
  it('当前类型及关注语义不匹配时不硬插，匹配的最新和关注流可置顶', async () => {
    const store = useCommunityStore(), post = await postFixture()
    expect(post.topics.length).toBeGreaterThan(0)
    for (const [mode, type, followsTopic, inserted] of [['for_you', 'question', false, false], ['following', 'note', false, false], ['following', 'note', true, true], ['latest', 'note', false, true]] as const) {
      store.clear()
      vi.mocked(communityApi.feed).mockResolvedValue(page([]))
      await store.loadFeed(mode, type)
      store.published({ ...post, viewerState: { ...post.viewerState, followingAuthor: false }, topics: post.topics.map((topic) => ({ ...topic, following: followsTopic })) })
      expect(store.feeds[`${mode}:${type}`].items.some((item) => item.id === post.id)).toBe(inserted)
      expect(store.publishNotice?.text).toContain(inserted ? '插入当前列表顶部' : '当前筛选未展示')
    }
  })
  it('发布期间的刷新响应不会覆盖新帖，其他模式迟到响应不能恢复失效缓存', async () => {
    const store = useCommunityStore(), post = await postFixture()
    vi.mocked(communityApi.feed).mockResolvedValue(page([]))
    await store.loadFeed('for_you', 'all')
    let resolveOther!: (value: CommunityFeedDto) => void, resolveCurrent!: (value: CommunityFeedDto) => void
    vi.mocked(communityApi.feed).mockReturnValueOnce(new Promise((done) => { resolveOther = done }))
    const other = store.loadFeed('latest', 'all', true)
    vi.mocked(communityApi.feed).mockReturnValueOnce(new Promise((done) => { resolveCurrent = done }))
    const current = store.loadFeed('for_you', 'all', true)
    store.published(post)
    resolveOther(page([])); resolveCurrent(page([{ ...post, id: 'ranked-post' }]))
    await Promise.all([other, current])
    expect(store.feeds['latest:all'].loaded).toBe(false)
    expect(store.feeds['for_you:all'].items.map((item) => item.id)).toEqual([post.id, 'ranked-post'])
  })
  it('取消用户或话题关注仅使关注缓存失效，不触发自动刷新或重置其他模式', async () => {
    const store = useCommunityStore(), post = await postFixture()
    vi.mocked(communityApi.feed).mockResolvedValue(page([post]))
    vi.mocked(communityApi.follow).mockImplementation(async (_id, _topic, active) => ({ active }))
    await store.loadFeed('for_you', 'all'); await store.loadFeed('latest', 'all'); await store.loadFeed('following', 'all')
    const recommended = store.feeds['for_you:all'], latest = store.feeds['latest:all']
    for (const [id, topic] of [[post.author.id, false], [post.topics[0].id, true]] as const) {
      store.feeds['following:all'].loaded = true
      await store.follow(id, topic, false)
      expect(communityApi.follow).toHaveBeenLastCalledWith(id, topic, false)
      expect(store.feeds['following:all'].loaded).toBe(false)
      expect(store.feeds['for_you:all']).toBe(recommended); expect(store.feeds['latest:all']).toBe(latest)
      expect(recommended.loaded).toBe(true); expect(latest.loaded).toBe(true)
    }
    expect(communityApi.feed).toHaveBeenCalledTimes(3)
    vi.mocked(communityApi.feed).mockResolvedValue(page([]))
    await store.loadFeed('following', 'all', true)
    expect(store.feeds['following:all'].items).toEqual([])
  })
  it('隐藏或删除替换缓存实例，进行中的旧流响应不能把已移除帖子重新加入', async () => {
    const store = useCommunityStore(), post = await postFixture()
    vi.mocked(communityApi.feed).mockResolvedValue(page([post]))
    await store.loadFeed('for_you', 'all')
    let resolve!: (value: CommunityFeedDto) => void
    vi.mocked(communityApi.feed).mockReturnValueOnce(new Promise((done) => { resolve = done }))
    const loading = store.loadFeed('for_you', 'all', true)
    store.removePost(post.id)
    resolve(page([post])); await loading
    expect(store.feeds['for_you:all'].items).toEqual([])
    expect(store.feeds['for_you:all'].loaded).toBe(false)
  })
})
describe('有界信息流与乐观互动', () => {
  it('右栏冷加载从既有关注接口获得真实状态，迟到上下文不覆盖用户刚执行的关注', async () => {
    const store = useCommunityStore(), post = await postFixture()
    vi.mocked(communityApi.context).mockResolvedValue({ trendingTopics: [], suggestedUsers: [post.author], todayPlan: null, continueCourse: null, continueLab: null, currentChallenge: null, needsInterests: false })
    vi.mocked(communityApi.following).mockResolvedValue([post.author])
    await store.loadContext('viewer')
    expect(communityApi.following).toHaveBeenCalledWith('viewer'); expect(store.authorFollowing[post.author.id]).toBe(true)
    store.authorFollowing[post.author.id] = false
    await store.loadContext('viewer'); expect(store.authorFollowing[post.author.id]).toBe(false)
  })
  it('单流只保留150项，下一游标与每项来源页同步，六个LRU之外仅保留定位元数据', async () => {
    const store = useCommunityStore(), post = await postFixture()
    vi.mocked(communityApi.feed).mockResolvedValueOnce(page(Array.from({ length: 100 }, (_, index) => ({ ...post, id: `first-${index}` })), 'page-2'))
    await store.loadFeed('for_you', 'all')
    vi.mocked(communityApi.feed).mockResolvedValueOnce(page(Array.from({ length: 100 }, (_, index) => ({ ...post, id: `second-${index}` })), 'page-3'))
    await store.loadFeed('for_you', 'all')
    const entry = store.feeds['for_you:all']
    expect(entry.items).toHaveLength(MAX_FEED_ITEMS); expect(entry.items[0].id).toBe('first-50')
    expect(entry.cursor).toBe('page-3'); expect(Object.keys(entry.pageCursors)).toHaveLength(150)
    store.rememberFeed('for_you:all', 4500, { id: 'second-20', offset: 115 })
    vi.mocked(communityApi.feed).mockResolvedValue(page([post]))
    for (const type of ['question', 'note', 'lab_result', 'project', 'frontier_discussion', 'achievement'] as const) await store.loadFeed('latest', type)
    expect(store.feedOrder).toHaveLength(MAX_FEED_CACHES)
    expect(Object.values(store.feeds).filter((feed) => feed.items.length)).toHaveLength(MAX_FEED_CACHES)
    expect(store.feeds['for_you:all']).toMatchObject({ evicted: true, items: [], cursor: 'page-3', scroll: 4500, resumeCursor: 'page-2', anchor: { id: 'second-20', offset: 115 } })
    await store.loadFeed('for_you', 'all')
    expect(communityApi.feed).toHaveBeenLastCalledWith('for_you', 'all', 'page-2')
  })
  it.each(['follow', 'publish', 'remove'] as const)('业务失效%s优先于LRU检查点，下次从首段重建而非旧游标追加', async (action) => {
    const store = useCommunityStore(), post = await postFixture()
    vi.mocked(communityApi.feed).mockResolvedValue(page([post], 'stale-cursor'))
    await store.loadFeed('following', 'all')
    store.feeds['following:all'].resumeCursor = 'stale-resume'
    store.feeds['following:all'].evicted = true; store.feeds['following:all'].loaded = false
    if (action === 'follow') store.invalidateFollowing()
    if (action === 'publish') { store.lastFeedLocation = '/community?mode=latest&type=all'; store.published(post) }
    if (action === 'remove') store.removePost(post.id)
    vi.mocked(communityApi.feed).mockResolvedValue(page([], 'fresh-next'))
    await store.loadFeed('following', 'all')
    expect(communityApi.feed).toHaveBeenLastCalledWith('following', 'all', undefined)
    expect(store.feeds['following:all']).toMatchObject({ evicted: false, items: [], cursor: 'fresh-next', loaded: true })
  })
  it('点赞立即跨缓存回写，同操作锁定，失败只回滚自身字段不覆盖并发收藏', async () => {
    const store = useCommunityStore(), post = await postFixture(), copy = structuredClone(post)
    post.viewerState.liked = false; post.viewerState.bookmarked = false; copy.viewerState = { ...post.viewerState }
    vi.mocked(communityApi.feed).mockResolvedValue(page([copy])); await store.loadFeed('latest', 'all')
    let rejectLike!: (error: Error) => void
    vi.mocked(communityApi.reaction).mockImplementation((_id, kind, active) => kind === 'like' ? new Promise((_, reject) => { rejectLike = reject }) : Promise.resolve({ active }))
    const count = post.stats.likes, request = store.react(post, 'like')
    expect(post.viewerState.liked).toBe(true); expect(copy.stats.likes).toBe(count + 1)
    expect(store.operations[`${post.id}:like`]).toBe(true)
    await store.react(post, 'like'); expect(communityApi.reaction).toHaveBeenCalledTimes(1)
    await store.react(post, 'bookmark')
    const rejection = expect(request).rejects.toThrow('网络失败')
    rejectLike(new Error('网络失败')); await rejection
    expect(post.viewerState.liked).toBe(false); expect(copy.stats.likes).toBe(count)
    expect(post.viewerState.bookmarked).toBe(true); expect(copy.viewerState.bookmarked).toBe(true)
    expect(store.operations[`${post.id}:like`]).toBeUndefined(); expect(communityApi.post).not.toHaveBeenCalled()
  })
  it('作者与话题关注乐观同步右栏、详情和缓存，失败恢复计数且不触发重载', async () => {
    const store = useCommunityStore(), post = await postFixture()
    const topic = structuredClone(post.topics[0]); topic.following = false
    post.topics = [structuredClone(topic)]
    vi.mocked(communityApi.feed).mockResolvedValue(page([post])); await store.loadFeed('for_you', 'all')
    vi.mocked(communityApi.context).mockResolvedValue({ trendingTopics: [topic], suggestedUsers: [post.author] } as Awaited<ReturnType<typeof communityApi.context>>); await store.loadContext()
    let reject!: (error: Error) => void
    vi.mocked(communityApi.follow).mockReturnValue(new Promise((_, rejectPromise) => { reject = rejectPromise }))
    const request = store.follow(topic.id, true, true, topic)
    expect(post.topics[0].following).toBe(true); expect(topic.following).toBe(true)
    expect(topic.followerCount).toBe(1)
    const rejection = expect(request).rejects.toThrow('失败'); reject(new Error('失败')); await rejection
    expect(post.topics[0].following).toBe(false); expect(topic.followerCount).toBe(0)
    vi.mocked(communityApi.follow).mockImplementation(async (_id, _topic, active) => ({ active }))
    await store.follow(post.author.id, false, true, undefined, post)
    expect(store.authorFollowing[post.author.id]).toBe(true); expect(post.viewerState.followingAuthor).toBe(true)
    expect(communityApi.feed).toHaveBeenCalledTimes(1)
  })
  it('旧账号迟到的互动失败不回写新账号状态', async () => {
    const store = useCommunityStore(), post = await postFixture()
    let reject!: (error: Error) => void
    vi.mocked(communityApi.reaction).mockReturnValue(new Promise((_, fail) => { reject = fail }))
    const request = store.react(post, 'like'), assertion = expect(request).rejects.toThrow('旧请求')
    store.clear(); store.operations['new:like'] = true
    reject(new Error('旧请求')); await assertion
    expect(store.feeds).toEqual({}); expect(store.operations).toEqual({ 'new:like': true })
  })
})
