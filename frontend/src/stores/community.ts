import { defineStore } from 'pinia'
import type { CommunityAuthorDto, CommunityContextDto, CommunityEligibilityDto, CommunityFeedMode, CommunityPostDetailDto, CommunityPostInput, CommunityPostSummaryDto, CommunityPostType, FeedUnitDto } from '@ai-learning-hub/contracts'
import { communityApi } from '../services/api/community'
import { contentDetectionNotice } from '../community/labels'
import { ApiError } from '../services/api/client'
export const MAX_FEED_ITEMS = 150, MAX_FEED_CACHES = 6
export type ComposerIntent = 'post' | 'video' | 'article' | 'document' | 'quote' | 'edit' | 'restore'
export interface ComposerRequest { input: CommunityPostInput; id?: string; intent: ComposerIntent; localKey?: string }
interface FeedState {
  items: FeedUnitDto[]; cursor: string | null; loaded: boolean; scroll: number; requestId: string; loadSequence: number
  pageCursors: Record<string, string | undefined>; resumeCursor?: string; anchor?: { id: string; offset: number }; evicted?: boolean; revealPostId?: string
}
export const useCommunityStore = defineStore('community', {
  state: () => ({ feeds: {} as Record<string, FeedState>, publishedPosts: [] as Extract<FeedUnitDto, { type: 'post' }>[], feedOrder: [] as string[], operations: {} as Record<string, boolean>, authorFollowing: {} as Record<string, boolean>, context: null as CommunityContextDto | null, eligibility: null as CommunityEligibilityDto | null, unread: 0, composerOpen: false, composerMode: 'quick' as 'quick' | 'advanced' | 'rich', composerInline: false, composerIntent: 'post' as ComposerIntent, composerSession: 0, composerRequest: null as ComposerRequest | null, composerLocalKey: undefined as string | undefined, draft: null as CommunityPostInput | null, editingId: undefined as string | undefined, publishNotice: null as { id: string; text: string } | null, error: '', epoch: 0, lastFeedLocation: '/community' }),
  actions: {
    clear() { const epoch = this.epoch + 1; this.$reset(); this.epoch = epoch },
    openComposer(input?: Partial<CommunityPostInput>, id?: string, options?: { intent?: ComposerIntent; localKey?: string }) {
      if (this.composerOpen && !input && !id && !options && this.composerIntent === 'post') {
        window.dispatchEvent(new CustomEvent('community-composer-focus'))
        return
      }
      const request: ComposerRequest = { input: { type: 'general', title: '', contentBlocks: [], bindings: [], topicIds: [], visibility: 'public', status: 'published', ...input }, id, intent: options?.intent || (id ? input?.status === 'draft' ? 'restore' : 'edit' : input?.quotedPostId ? 'quote' : input?.contribution?.kind || 'post'), localKey: options?.localKey }
      if (this.composerOpen) this.composerRequest = request
      else this.applyComposerRequest(request)
    },
    applyComposerRequest(request: ComposerRequest) {
      const value = request.input
      const rich = value.contribution?.kind === 'article' || !!value.coverFileId || value.contentBlocks.some((block) => ['rich_text', 'heading', 'list'].includes(block.type))
      this.$patch((state) => Object.assign(state, { draft: value, editingId: request.id, composerIntent: request.intent, composerLocalKey: request.localKey,
        composerMode: rich ? 'rich' : request.id || value.contribution ? 'advanced' : 'quick',
        composerInline: request.intent === 'post' && !rich && !request.id && typeof location !== 'undefined' && location.pathname === '/community' && typeof matchMedia !== 'undefined' && !matchMedia('(max-width: 767px)').matches,
        composerRequest: null, publishNotice: null, composerOpen: true }))
      this.composerSession++
    },
    async loadContext(userId?: string) {
      const epoch = this.epoch
      const [context, following, eligibility] = await Promise.all([communityApi.context(), userId ? communityApi.following(userId) : Promise.resolve([]), communityApi.eligibility()])
      if (epoch !== this.epoch) return
      const followedIds = new Set(following.map((user) => user.id))
      for (const user of context.suggestedUsers) if (!(user.id in this.authorFollowing)) this.authorFollowing[user.id] = followedIds.has(user.id)
      this.context = context
      this.syncAuthors([...following, ...context.suggestedUsers])
      this.eligibility = eligibility
    },
    touchFeed(key: string) {
      this.feedOrder = [...this.feedOrder.filter((value) => value !== key), key]
      while (this.feedOrder.length > MAX_FEED_CACHES) {
        const stale = this.feedOrder.shift()!, entry = this.feeds[stale]
        if (entry) this.feeds[stale] = { ...entry, items: [], pageCursors: {}, loaded: false, evicted: true }
      }
    },
    rememberFeed(key: string, scroll: number, anchor?: { id: string; offset: number }) {
      const entry = this.feeds[key]
      if (!entry || entry.revealPostId) return
      entry.scroll = scroll
      if (anchor) { entry.anchor = anchor; entry.resumeCursor = entry.pageCursors[anchor.id] }
    },
    prioritizeFeed(key: string, items: FeedUnitDto[]) {
      const [mode, type] = key.split(':')
      const priorities = mode === 'for_you' ? this.publishedPosts.filter((item) => type === 'all' || item.post.type === type) : []
      const ids = new Set(priorities.map((item) => item.post.id))
      const rest = items.filter((item) => { const id = item.type === 'post' ? item.post.id : item.id; if (ids.has(id)) return false; ids.add(id); return true })
      return [...priorities, ...rest.slice(Math.max(0, rest.length - (MAX_FEED_ITEMS - priorities.length)))]
    },
    prunePublished(ids: string[] = []) {
      if (!ids.length) return
      this.unavailableQuotes(ids)
      const removed = new Set(ids)
      this.publishedPosts = this.publishedPosts.filter((item) => !removed.has(item.post.id))
      for (const entry of Object.values(this.feeds)) {
        entry.items = entry.items.filter((item) => item.type !== 'post' || !removed.has(item.post.id))
        if (entry.revealPostId && removed.has(entry.revealPostId)) entry.revealPostId = undefined
      }
    },
    async loadFeed(mode: CommunityFeedMode, type: CommunityPostType | 'all', reset = false) {
      const key = `${mode}:${type}`, epoch = this.epoch
      this.lastFeedLocation = `/community?${new URLSearchParams({ mode, type })}`
      this.feeds[key] ||= { items: [], cursor: null, loaded: false, scroll: 0, requestId: '', pageCursors: {}, loadSequence: 0, revealPostId: mode === 'for_you' ? this.publishedPosts.find((item) => type === 'all' || item.post.type === type)?.post.id : undefined }
      this.touchFeed(key)
      const entry = this.feeds[key]
      const reload = reset || (!entry.loaded && !entry.evicted)
      const sequence = ++entry.loadSequence
      const refreshed = new Set(reset && mode === 'for_you' ? this.publishedPosts.map((item) => item.post.id) : [])
      const cursor = reload ? undefined : entry.evicted ? entry.resumeCursor : entry.cursor || undefined
      const result = await communityApi.feed(mode, type, cursor, this.publishedPosts.map((item) => item.post.id))
      if (epoch !== this.epoch || this.feeds[key] !== entry || sequence !== entry.loadSequence) return
      if (reset) {
        this.publishedPosts = this.publishedPosts.filter((item) => !refreshed.has(item.post.id))
        entry.anchor = undefined; entry.resumeCursor = undefined; entry.scroll = 0
        if (entry.revealPostId && refreshed.has(entry.revealPostId)) entry.revealPostId = undefined
        for (const [otherKey, other] of Object.entries(this.feeds)) if (refreshed.size && otherKey !== key && otherKey.startsWith('for_you:')) this.feeds[otherKey] = { ...other, loaded: false, evicted: false, cursor: null }
      }
      entry.items = this.prioritizeFeed(key, [...(reload ? [] : entry.items), ...result.items])
      this.syncAuthors(result.items.flatMap(item => item.type === 'post' ? [item.post.author, ...(item.post.quotedPost?.available ? [item.post.quotedPost.author] : [])] : []))
      this.prunePublished(result.invalidPriorityIds)
      const kept = new Set(entry.items.map((item) => item.id))
      entry.pageCursors = Object.fromEntries(Object.entries(entry.pageCursors).filter(([id]) => kept.has(id)))
      for (const item of result.items) if (kept.has(item.id)) entry.pageCursors[item.id] = cursor
      entry.evicted = false
      entry.cursor = result.nextCursor; entry.requestId = result.requestId; entry.loaded = true
      this.error = result.degraded ? '推荐暂不可用，当前按可见内容发布时间展示。' : ''
    },
    async refreshPost(id: string) {
      const epoch = this.epoch
      let post: CommunityPostDetailDto
      try { post = await communityApi.post(id) }
      catch (cause) { if (epoch === this.epoch && cause instanceof ApiError && [403, 404].includes(cause.status)) this.removePost(id); throw cause }
      if (epoch !== this.epoch) return post
      this.syncAuthors([post.author, ...(post.quotedPost?.available ? [post.quotedPost.author] : [])])
      if (post.status !== 'published') { this.removePost(id); return post }
      if (post.visibility !== 'public') this.unavailableQuotes([id])
      for (const item of this.publishedPosts) if (item.post.id === id) item.post = post
      for (const feed of Object.values(this.feeds)) for (const item of feed.items) if (item.type === 'post' && item.id === id) item.post = post
      return post
    },
    invalidateFollowing() {
      for (const [key, feed] of Object.entries(this.feeds)) if (key.startsWith('following:')) this.feeds[key] = { ...feed, loaded: false, evicted: false, cursor: null, resumeCursor: undefined }
    },
    postCopies(post?: CommunityPostSummaryDto) {
      return [...new Set([...(post ? [post] : []), ...this.publishedPosts.map((item) => item.post), ...Object.values(this.feeds).flatMap((feed) => feed.items.flatMap((item) => item.type === 'post' ? [item.post] : []))])]
    },
    syncAuthors(authors: Array<Pick<CommunityAuthorDto, 'id'> & Partial<CommunityAuthorDto>>) {
      const latest = new Map(authors.map(author => [author.id, author]))
      const copies = [...(this.context?.suggestedUsers || []), ...this.postCopies().flatMap(post => [post.author, ...(post.quotedPost?.available ? [post.quotedPost.author] : [])])]
      for (const author of copies) {
        const updated = latest.get(author.id)
        if (updated) Object.assign(author, Object.fromEntries(Object.entries(updated).filter(([key, value]) => ['username', 'displayName', 'avatar', 'school', 'major', 'verifiedType', 'badges'].includes(key) && value !== undefined)))
      }
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
      try { const result = await communityApi.reaction(post.id, kind, active); if (epoch === this.epoch && result) for (const { row } of snapshots) { row.viewerState[stateKey] = result.active; if (result.stats) row.stats = { ...row.stats, ...result.stats, views: Math.max(row.stats.views || 0, result.stats.views || 0) } } }
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
    unavailableQuotes(ids: string[], authorId?: string) {
      for (const post of this.postCopies()) if (post.quotedPostId && (ids.includes(post.quotedPostId) || authorId && post.quotedPost?.available && post.quotedPost.author.id === authorId)) post.quotedPost = { id: post.quotedPostId, available: false }
    },
    removePost(id: string, authorId?: string) {
      this.unavailableQuotes([id], authorId)
      const keep = (item: FeedUnitDto) => item.id !== id && (!authorId || item.type !== 'post' || item.post.author.id !== authorId)
      this.publishedPosts = this.publishedPosts.filter(keep)
      for (const [key, feed] of Object.entries(this.feeds)) this.feeds[key] = { ...feed, loaded: false, evicted: false, cursor: null, resumeCursor: undefined, items: feed.items.filter(keep) }
    },
    published(post: CommunityPostDetailDto, keepComposer = false, newlyCreated?: boolean) {
      this.syncAuthors([post.author])
      const isNew = newlyCreated ?? (!this.editingId || this.draft?.status === 'draft')
      const query = new URLSearchParams(this.lastFeedLocation.split('?')[1]), mode = query.get('mode') || 'for_you', type = query.get('type') || 'all'
      const key = `${mode}:${type}`, entry = this.feeds[key]
      const matches = post.status === 'published' && mode === 'for_you' && (type === 'all' || type === post.type)
      if (post.status !== 'published') this.removePost(post.id)
      else {
        if (isNew) this.publishedPosts = [{ type: 'post' as const, id: post.id, post }, ...this.publishedPosts.filter((item) => item.post.id !== post.id)].slice(0, MAX_FEED_ITEMS)
        else for (const item of this.publishedPosts) if (item.post.id === post.id) item.post = post
        for (const [feedKey, feed] of Object.entries(this.feeds)) {
          const feedType = feedKey.split(':')[1]
          feed.items = feed.items.flatMap((item) => item.type !== 'post' || item.post.id !== post.id ? [item] : feedType === 'all' || feedType === post.type ? [{ ...item, post }] : [])
          if (feedKey.startsWith('for_you:')) {
            feed.items = this.prioritizeFeed(feedKey, feed.items)
            if (isNew && (feedType === 'all' || feedType === post.type)) { feed.anchor = undefined; feed.resumeCursor = undefined; feed.scroll = 0; feed.revealPostId = post.id }
          } else if (isNew) this.feeds[feedKey] = { ...feed, loaded: false, evicted: false, cursor: null, resumeCursor: undefined }
        }
      }
      const notice = contentDetectionNotice(post.detection)
      this.publishNotice = { id: post.id, text: post.status === 'draft' ? '草稿已保存，尚未公开。' : post.status === 'pending_review' ? notice || '投稿已保存，正在等待人工复核，尚未公开。可查看并修改后重新提交。' : `${isNew ? '发布' : '更新'}成功${isNew ? entry && matches ? '，已插入当前列表顶部' : '，可在推荐列表查看' : ''}${notice ? `。${notice}` : ''}` }
      if (!keepComposer) this.composerOpen = false
      return post.id
    },
  },
})
