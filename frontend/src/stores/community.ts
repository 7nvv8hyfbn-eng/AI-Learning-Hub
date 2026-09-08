import { defineStore } from 'pinia'
import type { CommunityContextDto, CommunityEligibilityDto, CommunityFeedMode, CommunityPostDetailDto, CommunityPostInput, CommunityPostSummaryDto, CommunityPostType, FeedUnitDto } from '@ai-learning-hub/contracts'
import { communityApi } from '../services/api/community'
import { contentDetectionNotice } from '../community/labels'
export const MAX_FEED_ITEMS = 150, MAX_FEED_CACHES = 6
interface FeedState {
  items: FeedUnitDto[]; publishedPosts: FeedUnitDto[]; cursor: string | null; loaded: boolean; scroll: number; requestId: string
  pageCursors: Record<string, string | undefined>; resumeCursor?: string; anchor?: { id: string; offset: number }; evicted?: boolean
}
export const useCommunityStore = defineStore('community', {
  state: () => ({ feeds: {} as Record<string, FeedState>, feedOrder: [] as string[], operations: {} as Record<string, boolean>, authorFollowing: {} as Record<string, boolean>, context: null as CommunityContextDto | null, eligibility: null as CommunityEligibilityDto | null, unread: 0, composerOpen: false, composerMode: 'quick' as 'quick' | 'advanced' | 'rich', composerInline: false, draft: null as CommunityPostInput | null, editingId: undefined as string | undefined, publishNotice: null as { id: string; text: string } | null, error: '', epoch: 0, lastFeedLocation: '/community' }),
  actions: {
    clear() { const epoch = this.epoch + 1; this.$reset(); this.epoch = epoch },
    openComposer(input?: Partial<CommunityPostInput>, id?: string) {
      if (this.composerOpen) {
        window.dispatchEvent(new CustomEvent('community-composer-focus'))
        if (input || id) window.dispatchEvent(new CustomEvent('api-error', { detail: { message: '请先保存或关闭当前编辑，再打开其他内容；当前草稿未被覆盖。' } }))
        return
      }
      this.draft = { type: 'general', title: '', contentBlocks: [], bindings: [], topicIds: [], visibility: 'public', status: 'published', ...input }
      this.composerMode = id ? 'advanced' : 'quick'
      this.composerInline = typeof location !== 'undefined' && location.pathname === '/community' && typeof matchMedia !== 'undefined' && !matchMedia('(max-width: 767px)').matches && !id
      this.editingId = id; this.publishNotice = null; this.composerOpen = true
    },
    async loadContext(userId?: string) {
      const epoch = this.epoch
      const [context, following, eligibility] = await Promise.all([communityApi.context(), userId ? communityApi.following(userId) : Promise.resolve([]), communityApi.eligibility()])
      if (epoch !== this.epoch) return
      const followedIds = new Set(following.map((user) => user.id))
      for (const user of context.suggestedUsers) if (!(user.id in this.authorFollowing)) this.authorFollowing[user.id] = followedIds.has(user.id)
      this.context = context
      this.eligibility = eligibility
    },
    touchFeed(key: string) {
      this.feedOrder = [...this.feedOrder.filter((value) => value !== key), key]
      while (this.feedOrder.length > MAX_FEED_CACHES) {
        const stale = this.feedOrder.shift()!, entry = this.feeds[stale]
        if (entry) this.feeds[stale] = { ...entry, items: [], publishedPosts: [], pageCursors: {}, loaded: false, evicted: true }
      }
    },
    rememberFeed(key: string, scroll: number, anchor?: { id: string; offset: number }) {
      const entry = this.feeds[key]
      if (!entry) return
      entry.scroll = scroll
      if (anchor) { entry.anchor = anchor; entry.resumeCursor = entry.pageCursors[anchor.id] }
    },
    async loadFeed(mode: CommunityFeedMode, type: CommunityPostType | 'all', reset = false) {
      const key = `${mode}:${type}`, epoch = this.epoch
      this.lastFeedLocation = `/community?${new URLSearchParams({ mode, type })}`
      this.feeds[key] ||= { items: [], publishedPosts: [], cursor: null, loaded: false, scroll: 0, requestId: '', pageCursors: {} }
      this.touchFeed(key)
      const entry = this.feeds[key]
      const reload = reset || (!entry.loaded && !entry.evicted)
      if (reset) { entry.publishedPosts = []; entry.anchor = undefined; entry.resumeCursor = undefined; entry.scroll = 0 }
      const cursor = reload ? undefined : entry.evicted ? entry.resumeCursor : entry.cursor || undefined
      const result = await communityApi.feed(mode, type, cursor)
      if (epoch !== this.epoch || this.feeds[key] !== entry) return
      const retained = reload ? entry.publishedPosts : entry.items
      const ids = new Set(retained.map((item) => item.id))
      entry.items = [...retained, ...result.items.filter((item) => !ids.has(item.id))].slice(-MAX_FEED_ITEMS)
      const kept = new Set(entry.items.map((item) => item.id))
      entry.publishedPosts = entry.publishedPosts.filter((item) => kept.has(item.id))
      entry.pageCursors = Object.fromEntries(Object.entries(entry.pageCursors).filter(([id]) => kept.has(id)))
      for (const item of result.items) if (kept.has(item.id)) entry.pageCursors[item.id] = cursor
      entry.evicted = false
      entry.cursor = result.nextCursor; entry.requestId = result.requestId; entry.loaded = true
      this.error = result.degraded ? '推荐暂不可用，当前按可见内容发布时间展示。' : ''
    },
    async refreshPost(id: string) {
      const epoch = this.epoch
      const post = await communityApi.post(id)
      if (epoch !== this.epoch) return post
      for (const feed of Object.values(this.feeds)) for (const item of feed.items) if (item.type === 'post' && item.id === id) item.post = post
      return post
    },
    invalidateFollowing() {
      for (const [key, feed] of Object.entries(this.feeds)) if (key.startsWith('following:')) this.feeds[key] = { ...feed, loaded: false, evicted: false, cursor: null, resumeCursor: undefined, publishedPosts: [] }
    },
    postCopies(post?: CommunityPostSummaryDto) {
      return [...new Set([...(post ? [post] : []), ...Object.values(this.feeds).flatMap((feed) => feed.items.flatMap((item) => item.type === 'post' ? [item.post] : []))])]
    },
    async react(post: CommunityPostSummaryDto, kind: 'like' | 'useful' | 'bookmark') {
      const key = `${post.id}:${kind}`, epoch = this.epoch
      if (this.operations[key]) return
      const stateKey = kind === 'like' ? 'liked' : kind === 'useful' ? 'markedUseful' : 'bookmarked'
      const countKey = kind === 'like' ? 'likes' : kind === 'useful' ? 'useful' : 'bookmarks'
      const active = !post.viewerState[stateKey]
      const snapshots = this.postCopies(post).filter((row) => row.id === post.id).map((row) => ({ row, state: row.viewerState[stateKey], count: row.stats[countKey] }))
      this.operations[key] = true
      for (const { row, state, count } of snapshots) { row.viewerState[stateKey] = active; row.stats[countKey] = Math.max(0, count + (active === state ? 0 : active ? 1 : -1)) }
      try { const result = await communityApi.reaction(post.id, kind, active); if (epoch === this.epoch && result) for (const { row } of snapshots) { row.viewerState[stateKey] = result.active; if (result.stats) row.stats = { ...result.stats } } }
      catch (cause) { if (epoch === this.epoch) for (const { row, state, count } of snapshots) { row.viewerState[stateKey] = state; row.stats[countKey] = count }; throw cause }
      finally { if (epoch === this.epoch) delete this.operations[key] }
    },
    async follow(id: string, topic: boolean, active: boolean, target?: { following: boolean; followerCount?: number }, post?: CommunityPostSummaryDto) {
      const key = `follow:${topic ? 'topic' : 'user'}:${id}`, epoch = this.epoch
      if (this.operations[key]) return
      this.operations[key] = true
      const posts = this.postCopies(post)
      const authors = !topic ? posts.filter((row) => row.author.id === id).map((row) => ({ row, value: row.viewerState.followingAuthor })) : []
      const topics = topic ? [...(this.context?.trendingTopics || []), ...posts.flatMap((row) => row.topics), ...Object.values(this.feeds).flatMap((feed) => feed.items.flatMap((item) => item.type === 'topic_suggestion' ? item.topics : []))].filter((row) => row.id === id) : []
      const targets = [...new Set([...topics, ...(target ? [target] : [])])].map((row) => ({ row, value: row.following, count: row.followerCount }))
      const previousAuthor = this.authorFollowing[id]
      if (!topic) this.authorFollowing[id] = active
      for (const { row } of authors) row.viewerState.followingAuthor = active
      for (const { row, value, count } of targets) { row.following = active; if (count !== undefined) row.followerCount = Math.max(0, count + (value === active ? 0 : active ? 1 : -1)) }
      try { const result = await communityApi.follow(id, topic, active); if (epoch === this.epoch) { if (result) { if (!topic) this.authorFollowing[id] = result.active; for (const { row } of authors) row.viewerState.followingAuthor = result.active; for (const { row } of targets) { row.following = result.active; if (result.followerCount !== undefined) row.followerCount = result.followerCount } }; this.invalidateFollowing() } }
      catch (cause) {
        if (epoch === this.epoch) {
          if (!topic) { if (previousAuthor === undefined) delete this.authorFollowing[id]; else this.authorFollowing[id] = previousAuthor }
          for (const { row, value } of authors) row.viewerState.followingAuthor = value
          for (const { row, value, count } of targets) { row.following = value; if (count !== undefined) row.followerCount = count }
        }
        throw cause
      } finally { if (epoch === this.epoch) delete this.operations[key] }
    },
    removePost(id: string) {
      for (const [key, feed] of Object.entries(this.feeds)) this.feeds[key] = { ...feed, loaded: false, evicted: false, cursor: null, resumeCursor: undefined, items: feed.items.filter((item) => item.id !== id), publishedPosts: (feed.publishedPosts || []).filter((item) => item.id !== id) }
    },
    published(post: CommunityPostDetailDto, keepComposer = false) {
      const query = new URLSearchParams(this.lastFeedLocation.split('?')[1]), mode = query.get('mode') || 'for_you', type = query.get('type') || 'all'
      const key = `${mode}:${type}`, entry = this.feeds[key]
      const matches = post.status === 'published' && (type === 'all' || type === post.type) && (mode !== 'following' || post.viewerState.followingAuthor || post.topics.some((topic) => topic.following))
      for (const [otherKey, feed] of Object.entries(this.feeds)) if (otherKey !== key) this.feeds[otherKey] = { ...feed, loaded: false, evicted: false, cursor: null, resumeCursor: undefined, items: feed.items.filter((item) => item.id !== post.id), publishedPosts: [] }
      if (entry) {
        entry.items = entry.items.filter((item) => item.id !== post.id)
        entry.publishedPosts = (entry.publishedPosts || []).filter((item) => item.id !== post.id)
      }
      if (entry && matches) {
        const item: FeedUnitDto = { type: 'post', id: post.id, post }
        entry.publishedPosts = [item, ...entry.publishedPosts].slice(0, MAX_FEED_ITEMS)
        entry.items = [item, ...entry.items].slice(0, MAX_FEED_ITEMS)
      }
      const notice = contentDetectionNotice(post.detection)
      this.publishNotice = { id: post.id, text: post.status === 'pending_review' ? notice || '投稿已保存，正在等待人工复核，尚未公开。可查看并修改后重新提交。' : `${this.editingId ? '更新' : '发布'}成功${entry ? matches ? '，已插入当前列表顶部' : '，当前筛选未展示此内容' : '，可查看动态'}${notice ? `。${notice}` : ''}` }
      if (!keepComposer) this.composerOpen = false
      return post.id
    },
  },
})
