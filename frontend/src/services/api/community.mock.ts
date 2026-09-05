import { createCommunityFixtures, demoArticles, demoChallenges, demoCourses, demoLabs, demoResources, demoStudents, demoThemes, lczCuratedPosts } from '@ai-learning-hub/demo-fixtures'
import type { AuthUser, CommunityAuthorDto, CommunityCommentDto, CommunityContentBlock, CommunityContextDto, CommunityNotificationDto, CommunityPostDetailDto, CommunityPostInput, CommunityProfileDto, CommunityProfileUpdateDto, CommunityTopicDto } from '@ai-learning-hub/contracts'
import { randomId } from './random-id'
import { mockFixtureCover } from '../../media/catalog'
const fixtures = createCommunityFixtures({ courses: demoCourses, labs: demoLabs, articles: demoArticles, themes: demoThemes, students: demoStudents })
const authors: CommunityAuthorDto[] = fixtures.users.map((user) => ({ id: user.username, username: user.username, displayName: user.displayName, verifiedType: user.verifiedType, avatar: null, major: user.major, school: 'AI 创客学院' }))
const text = (blocks: CommunityContentBlock[]) => blocks.map((block) => block.type === 'image' ? block.alt : block.type === 'code' ? block.code : block.text).join('\n')
const topics: CommunityTopicDto[] = fixtures.topics.map((topic) => ({
  ...topic,
  themeId: topic.theme,
  status: 'active',
  following: false,
  postCount: fixtures.posts.filter((post) => post.topics.includes(topic.id)).length + lczCuratedPosts.filter((post) => post.topics.includes(topic.id)).length,
  followerCount: 0,
}))
const fixturePosts: CommunityPostDetailDto[] = fixtures.posts.map((post) => ({
  id: post.id, type: post.type, status: 'published', visibility: post.visibility, title: post.title, body: text(post.blocks), bodyPreview: text(post.blocks).slice(0, 320), contentBlocks: post.blocks, author: authors.find((user) => user.id === post.author)!,
  bindings: post.bindings.filter((b) => b.type !== 'lab_run').map((binding) => { const content = (binding.type === 'course' ? demoCourses : binding.type === 'lab' ? demoLabs : demoArticles).find((row) => row.slug === binding.id)!; return { type: binding.type, id: binding.id, slug: binding.id, title: content.title, summary: content.summary, cover: mockFixtureCover(binding.type === 'course' ? 'course' : binding.type === 'lab' ? 'lab' : 'article', content).cover, route: binding.type === 'course' ? `/courses/${binding.id}` : binding.type === 'lab' ? `/labs/${binding.id}` : `/frontier?article=${binding.id}`, status: 'published' } }),
  topics: topics.filter((topic) => post.topics.includes(topic.id)), stats: { likes: fixtures.reactions.filter((r) => r.postId === post.id && r.type === 'like').length, useful: fixtures.reactions.filter((r) => r.postId === post.id && r.type === 'useful').length, comments: 2, bookmarks: fixtures.bookmarks.filter((r) => r.postId === post.id).length },
  viewerState: { liked: fixtures.reactions.some((r) => r.postId === post.id && r.username === authors[0].id && r.type === 'like'), markedUseful: fixtures.reactions.some((r) => r.postId === post.id && r.username === authors[0].id && r.type === 'useful'), bookmarked: fixtures.bookmarks.some((r) => r.postId === post.id && r.username === authors[0].id), followingAuthor: fixtures.follows.some((f) => f.follower === authors[0].id && f.followee === post.author) }, recommendationReasons: ['显式演示数据 · 与 Seed 共用语义'], labels: [], question: post.type === 'question' ? { status: 'open', acceptedCommentId: null, teacherAnswered: false } : null, publishedAt: post.publishedAt, editedAt: null,
}))
const editorialAuthor = authors.find((author) => author.id === 'campus-guide-1')!
const curatedPosts: CommunityPostDetailDto[] = lczCuratedPosts.map((post) => {
  const body = text(post.adaptedBlocks)
  const theme = demoThemes.find((item) => item.slug === post.themeSlug)!
  return {
    id: `community-${post.sourceKey.replace(':', '-')}`,
    type: post.postType,
    status: 'published',
    visibility: 'public',
    title: post.adaptedTitle,
    body,
    bodyPreview: body.slice(0, 320),
    contentBlocks: post.adaptedBlocks,
    author: editorialAuthor,
    bindings: [{
      type: 'theme',
      id: theme.slug,
      slug: theme.slug,
      title: theme.title,
      summary: theme.summary,
      cover: mockFixtureCover('theme', theme).cover,
      route: `/topics?theme=${theme.slug}`,
      status: 'published',
    }],
    topics: topics.filter((topic) => post.topics.includes(topic.id)),
    stats: { likes: 0, useful: 0, comments: 0, bookmarks: 0 },
    viewerState: { liked: false, markedUseful: false, bookmarked: false, followingAuthor: false },
    recommendationReasons: ['外部社区精选 · 本地固定演示'],
    labels: ['外部社区精选', '本地演示已发布'],
    question: null,
    publishedAt: post.sourcePublishedAt,
    editedAt: null,
  }
})
const initialPosts = [...fixturePosts, ...curatedPosts]
const initialComments: CommunityCommentDto[] = fixtures.comments.map((c) => ({ id: c.id, postId: c.postId, author: authors.find((u) => u.id === c.author)!, parentId: c.parentId, rootId: c.parentId, body: c.body, contentBlocks: [{ type: 'paragraph', text: c.body }], deleted: false, likes: 0, liked: false, accepted: false, createdAt: new Date().toISOString() }))
const initialNotifications: CommunityNotificationDto[] = fixtures.notifications.filter((n) => n.recipient === authors[0].id).map((n) => ({ id: n.id, type: n.type, actor: authors.find((a) => a.id === n.actor)!, entityType: n.entityType, entityId: n.entityId, text: n.text, count: 1, readAt: null, createdAt: n.createdAt, source: 'community' }))
let comments = structuredClone(initialComments), notifications = structuredClone(initialNotifications)
let posts = structuredClone(initialPosts)
const initialFollowing = fixtures.follows.filter((f) => f.follower === authors[0].id).map((f) => f.followee)
const hidden = new Set<string>(), muted = new Set<string>(), blocked = new Set<string>(), following = new Set(initialFollowing)
const cursors = new Map<string, { ids: string[]; offset: number; mode: string; type: string; requestId: string }>()
let bio = '', headline = '', location = '', websiteUrl = '', expertiseTopics: string[] = [], bannerUrl: string | null = null, pinnedPostId: string | null = null, allowAchievementDrafts = false, userRevision = 1, profileRevision = 1
const joinedAt = '2026-08-30T08:00:00.000Z'
const storageKey = 'ai-learning-community:demo-v4'
let restored = false
const restoreMock = () => {
if (restored) return
restored = true
try {
  const stored = JSON.parse(localStorage.getItem(storageKey) || 'null')
  if (stored?.version === 4) {
    posts = stored.posts; comments = stored.comments; notifications = stored.notifications
    for (const id of stored.hidden) hidden.add(id)
    for (const id of stored.muted) muted.add(id)
    for (const id of stored.blocked) blocked.add(id)
    following.clear(); for (const id of stored.following) following.add(id)
    topics.forEach((topic) => { topic.following = stored.topicIds.includes(topic.id) })
    bio = stored.bio; headline = stored.headline; location = stored.location || ''; websiteUrl = stored.websiteUrl || ''; expertiseTopics = stored.expertiseTopics || []; bannerUrl = stored.bannerUrl || null; pinnedPostId = stored.pinnedPostId || null; allowAchievementDrafts = stored.allowAchievementDrafts
    userRevision = stored.userRevision || 1; profileRevision = stored.profileRevision || 1
    authors[0].avatar = stored.avatar || null
  }
} catch { /* 损坏的本地演示状态使用可重置的初始数据。 */ }
}
const persist = () => { try { localStorage.setItem(storageKey, JSON.stringify({ version: 4, posts, comments, notifications, hidden: [...hidden], muted: [...muted], blocked: [...blocked], following: [...following], topicIds: topics.filter((t) => t.following).map((t) => t.id), bio, headline, location, websiteUrl, expertiseTopics, bannerUrl, pinnedPostId, avatar: authors[0].avatar, allowAchievementDrafts, userRevision, profileRevision })) } catch { throw new Error('本地演示存储已满，请清理浏览器空间') } }
export const resetCommunityMock = () => {
  restored = true
  posts = structuredClone(initialPosts); comments = structuredClone(initialComments); notifications = structuredClone(initialNotifications)
  hidden.clear(); muted.clear(); blocked.clear(); following.clear(); cursors.clear(); initialFollowing.forEach((id) => following.add(id))
  topics.forEach((topic) => { topic.following = false; topic.followerCount = 0 })
  bio = ''; headline = ''; location = ''; websiteUrl = ''; expertiseTopics = []; bannerUrl = null; pinnedPostId = null; allowAchievementDrafts = false; userRevision = 1; profileRevision = 1; authors[0].avatar = null
  if (typeof localStorage !== 'undefined') localStorage.removeItem(storageKey)
}
const context = (): CommunityContextDto => ({ todayPlan: null, continueCourse: null, continueLab: null, currentChallenge: null, trendingTopics: topics.slice(0, 6), suggestedUsers: authors.filter((user) => user.verifiedType !== 'none'), needsInterests: topics.filter((t) => t.following).length < 3 })
const visible = (ownDrafts = false) => posts.filter((p) => !hidden.has(p.id) && !muted.has(p.author.id) && !blocked.has(p.author.id) && (p.status === 'published' || p.status === 'limited' || (ownDrafts && p.status === 'draft' && p.author.id === authors[0].id)))
const requirePost = (id: string) => { const post = visible(true).find((p) => p.id === id); if (!post) throw new Error('动态不可见或已删除'); return post }
const requireOwner = (authorId: string) => { if (authorId !== authors[0].id) throw new Error('只能修改自己的内容') }
const filtered = (url: URL) => visible().filter((p) => (!url.searchParams.get('type') || url.searchParams.get('type') === 'all' || p.type === url.searchParams.get('type')) && (url.searchParams.get('mode') !== 'following' || following.has(p.author.id) || p.topics.some((t) => topics.find((topic) => topic.id === t.id)?.following)))
const profileFor = (id: string): CommunityProfileDto => {
  const user = authors.find((author) => author.id === id)
  if (!user) throw new Error('用户不存在或不可见')
  const own = id === authors[0].id
  const publicPosts = visible().filter((post) => post.author.id === id)
  const pinned = publicPosts.find((post) => post.id === pinnedPostId && post.status === 'published' && post.visibility === 'public') || null
  return {
    ...user,
    revision: own ? profileRevision : 1,
    userRevision: own ? userRevision : 1,
    bio: own ? bio : '在学习、实训与讨论中一起成长。',
    headline: own ? headline : '',
    location: own ? location || null : null,
    websiteUrl: own ? websiteUrl || null : null,
    bannerUrl: own ? bannerUrl : null,
    joinedAt,
    expertiseTopics: own ? expertiseTopics : [],
    ...(own ? { allowAchievementDrafts } : {}),
    postCount: publicPosts.length,
    replyCount: comments.filter((comment) => comment.author.id === id && !comment.deleted && visible().some((post) => post.id === comment.postId)).length,
    likesReceived: publicPosts.reduce((total, post) => total + post.stats.likes, 0),
    followerCount: new Set([...fixtures.follows.filter((follow) => follow.followee === id).map((follow) => follow.follower), ...(following.has(id) ? [authors[0].id] : [])]).size,
    followingCount: own ? following.size : fixtures.follows.filter((follow) => follow.follower === id).length,
    following: following.has(id),
    followedBy: fixtures.follows.some((follow) => follow.follower === id && follow.followee === authors[0].id),
    muted: muted.has(id),
    blocked: blocked.has(id),
    isSelf: own,
    pinnedPost: pinned,
    topics: own ? topics.filter((topic) => topic.following) : [],
  }
}
const authUser = (): AuthUser => {
  let stored: Partial<AuthUser> = {}
  try { stored = JSON.parse(localStorage.getItem('community-demo-user') || '{}') } catch { /* 使用固定演示账号。 */ }
  return {
    id: authors[0].id,
    username: authors[0].username,
    email: stored.email || '',
    displayName: authors[0].displayName,
    roles: stored.roles || ['student'],
    permissions: stored.permissions || [],
    avatarUrl: authors[0].avatar,
    school: authors[0].school,
    major: authors[0].major,
    onboardingCompleted: stored.onboardingCompleted ?? true,
    emailVerificationRequired: false,
    revision: userRevision,
    profileRevision,
  }
}
const profileUpdate = (): CommunityProfileUpdateDto => ({ user: authUser(), profile: profileFor(authors[0].id) })
export async function mockCommunity<T>(path: string, method: string, body?: unknown): Promise<T> {
  restoreMock()
  if (typeof localStorage !== 'undefined') {
    try {
      const user = JSON.parse(localStorage.getItem('community-demo-user') || 'null')
      if (user?.username) {
        Object.assign(authors[0], { username: user.username, displayName: user.displayName, school: user.school, major: user.major })
        for (const row of [...posts, ...comments]) if (row.author.id === authors[0].id) row.author = { ...authors[0] }
      }
    } catch { /* 损坏的演示账号不会覆盖当前展示资料。 */ }
  }
  if (path.startsWith('/users/by-username/')) {
    const username = decodeURIComponent(path.slice('/users/by-username/'.length)), user = authors.find((row) => row.username.toLowerCase() === username.toLowerCase())
    if (!user) throw new Error('用户不存在')
    return mockCommunity<T>(`/users/${user.id}`, method, body)
  }
  const url = new URL(path, 'http://mock.invalid'), parts = url.pathname.split('/').filter(Boolean)
  const [root, id, action, fourth] = parts
  let value: unknown
  if (root === 'drafts') {
    if (method === 'GET') value = visible(true).filter((p) => p.status === 'draft' && p.author.id === authors[0].id).map((p) => ({ id: p.id, updatedAt: p.editedAt || p.publishedAt, input: { type: p.type, title: p.title || '', contentBlocks: p.contentBlocks, bindings: p.bindings.map((b) => ({ type: b.type, id: b.id })), topicIds: p.topics.map((t) => t.id), visibility: p.visibility, status: 'draft' } }))
    else { if (id && requirePost(id).status !== 'draft') throw new Error('不是草稿'); return mockCommunity<T>(id ? `/posts/${id}` : '/posts', method, body ? { ...body as CommunityPostInput, status: 'draft' } : undefined) }
  } else if (root === 'onboarding') {
    if (method === 'GET') value = [{ id: 'demo-school', name: 'AI 创客学院（本地演示）' }]
    else { const input = body as { themeIds: string[]; schoolId: string; major: string; headline: string }; await mockCommunity('/interests', 'POST', input); headline = input.headline; const user = JSON.parse(localStorage.getItem('community-demo-user') || '{}'); value = { ...user, school: input.schoolId ? 'AI 创客学院' : null, major: input.major, onboardingCompleted: true } }
  } else if (root === 'search') {
    const q = (url.searchParams.get('q') || '').toLowerCase(), type = url.searchParams.get('type') || 'all', offset = Number(url.searchParams.get('cursor') || 0), limit = type === 'all' ? 3 : 20
    const matches = (value: string) => !!q && value.toLowerCase().includes(q)
    const catalog = (rows: Array<{ slug: string; title: string; summary: string }>) => rows.filter((r) => matches(`${r.title} ${r.summary}`)).map((r) => ({ ...r, id: r.slug, status: 'published', data: r, updatedAt: '', publishedAt: null, sortOrder: 0 }))
    const all = { posts: visible().filter((r) => matches(`${r.title} ${r.body}`)), users: authors.filter((r) => !muted.has(r.id) && !blocked.has(r.id) && matches(`${r.username} ${r.displayName}`)), topics: topics.filter((r) => matches(`${r.name} ${r.description}`)), courses: catalog(demoCourses), labs: catalog(demoLabs), resources: catalog(demoResources), articles: catalog(demoArticles) }
    value = { ...Object.fromEntries(Object.entries(all).map(([key, rows]) => [key, type === 'all' || type === key ? rows.slice(offset, offset + limit) : []])), nextCursor: type !== 'all' && type in all && all[type as keyof typeof all].length > offset + limit ? String(offset + limit) : null }
  } else if (root === 'feed') {
    if (id === 'updates') value = { count: filtered(url).filter((p) => p.publishedAt > (url.searchParams.get('since') || '')).length }
    else if (method !== 'GET') value = { received: true }
    else {
      const cursor = url.searchParams.get('cursor'), type = url.searchParams.get('type') || 'all', mode = url.searchParams.get('mode') || 'for_you'
      const session = cursor ? cursors.get(cursor) : { ids: filtered(url).sort((a, b) => b.publishedAt.localeCompare(a.publishedAt) || b.id.localeCompare(a.id)).map((p) => p.id), offset: 0, type, mode, requestId: randomId() }
      if (!session || session.type !== type || session.mode !== mode) throw new Error('游标已失效或筛选不匹配，请刷新')
      const list = visible().filter((p) => session.ids.slice(session.offset, session.offset + 20).includes(p.id)).sort((a, b) => session.ids.indexOf(a.id) - session.ids.indexOf(b.id))
      const nextCursor = session.offset + 20 < session.ids.length ? randomId() : null
      if (nextCursor) cursors.set(nextCursor, { ...session, offset: session.offset + 20 })
      value = { requestId: session.requestId, policyVersion: 'demo-fixtures', degraded: false, items: list.map((post) => ({ type: 'post', id: post.id, post })), nextCursor }
    }
  } else if (root === 'context') value = context()
  else if (root === 'bindings') {
    const type = url.searchParams.get('type'), id = url.searchParams.get('id')
    const catalog = type === 'course' ? demoCourses : type === 'lab' ? demoLabs : type === 'resource' ? demoResources : type === 'article' ? demoArticles : type === 'theme' ? demoThemes : type === 'challenge' ? demoChallenges : []
    const content = catalog.find((item) => item.slug === id)
    if (!content) throw new Error('关联内容不存在或不属于当前演示用户')
    const routes: Record<string, string> = { course: `/courses/${id}`, lab: `/labs/${id}`, resource: `/resources?resource=${id}`, article: `/frontier?article=${id}`, theme: `/topics?theme=${id}`, challenge: `/assessments?challenge=${id}` }
    const cover = mockFixtureCover(type as 'course' | 'lab' | 'resource' | 'article' | 'theme' | 'challenge', content).cover
    const binding = { type: type!, id: id!, title: content.title, cover, route: routes[type!], status: 'published' }
    const course = demoCourses.find((c) => binding.type === 'course' && c.slug === binding.id)
    value = { binding, topicIds: course ? topics.filter((topic) => topic.themeId === course.theme).slice(0, 3).map((topic) => topic.id) : [] }
  }
  else if (root === 'interests') { const selected = (body as { themeIds: string[] }).themeIds; topics.forEach((t) => { if (selected.includes(t.themeId || '')) t.following = true }); value = context() }
  else if (root === 'signals') value = { recorded: true }
  else if (root === 'topics') {
    if (action === 'follow') { const topic = topics.find((t) => t.id === id)!; topic.following = method === 'PUT'; value = { active: topic.following } }
    else if (action === 'posts') value = visible().filter((p) => p.topics.some((t) => t.slug === id))
    else value = topics
  } else if (root === 'bookmarks') value = visible().filter((p) => p.viewerState.bookmarked)
  else if (root === 'notifications') {
    const available = notifications.filter((n) => n.entityType !== 'post' || visible().some((p) => p.id === n.entityId))
    if (id === 'unread-count') value = { count: available.filter((n) => !n.readAt).length }
    else if (method === 'GET') value = available
    else { notifications.forEach((n) => { if (id === 'read-all' || n.id === id) n.readAt ||= new Date().toISOString() }); value = { read: true } }
  }
  else if (root === 'profile') {
    if (id === 'username') { const user = JSON.parse(localStorage.getItem('community-demo-user') || '{}'); if (user.usernameChanged) throw new Error('公开用户名只能修改一次'); const username = (body as { username: string }).username; if (!/^[a-z][a-z0-9_]{3,29}$/.test(username) || authors.some((a) => a.username === username)) throw new Error('用户名不可用'); authors[0].username = username; value = { ...user, username, usernameChanged: true }; localStorage.setItem('community-demo-user', JSON.stringify(value)) }
    else if (id === 'avatar' || id === 'banner') {
      const input = body as { file?: File; expectedUserRevision: number; expectedProfileRevision: number }
      if (input.expectedUserRevision !== userRevision || input.expectedProfileRevision !== profileRevision) throw new Error('资料已更新，请重新读取')
      if (method === 'POST') {
        if (!input.file) throw new Error('请选择图片')
        const url = URL.createObjectURL(input.file)
        if (id === 'avatar') authors[0].avatar = url
        else bannerUrl = url
      } else if (id === 'avatar') authors[0].avatar = null
      else bannerUrl = null
      userRevision++; profileRevision++; value = profileUpdate()
    } else if (id === 'pinned-post') {
      const input = body as { expectedProfileRevision: number }
      if (input.expectedProfileRevision !== profileRevision) throw new Error('资料已更新，请重新读取')
      pinnedPostId = null; profileRevision++; value = profileFor(authors[0].id)
    } else {
      const input = body as { expectedUserRevision: number; expectedProfileRevision: number; displayName: string; bio: string; headline: string; location: string; websiteUrl: string; expertiseTopics: string[]; allowAchievementDrafts: boolean }
      if (input.expectedUserRevision !== userRevision || input.expectedProfileRevision !== profileRevision) throw new Error('资料已更新，请重新读取')
      if (!input.displayName?.trim() || input.location.length > 60 || [input.displayName, input.bio, input.headline, input.location, ...input.expertiseTopics].some((text) => /[\p{Cc}<>]/u.test(text))) throw new Error('资料包含不允许的字符')
      if (input.websiteUrl && !/^https?:\/\//i.test(input.websiteUrl)) throw new Error('个人网站需要完整的 http 或 https 地址')
      authors[0].displayName = input.displayName.trim(); bio = input.bio.trim(); headline = input.headline.trim(); location = input.location.trim(); websiteUrl = input.websiteUrl.trim(); expertiseTopics = [...new Set(input.expertiseTopics.map((topic) => topic.trim()).filter(Boolean))]; allowAchievementDrafts = !!input.allowAchievementDrafts
      userRevision++; profileRevision++
      const user = authUser()
      if (typeof localStorage !== 'undefined') localStorage.setItem('community-demo-user', JSON.stringify(user))
      value = { user, profile: profileFor(authors[0].id) }
    }
  }
  else if (root === 'users') {
    if (action === 'timeline') {
      const profile = profileFor(id), tab = url.searchParams.get('tab') || 'posts', offset = Number(url.searchParams.get('cursor') || 0), limit = Number(url.searchParams.get('limit') || 20)
      if (tab === 'liked' && !profile.isSelf) throw new Error('赞过的内容仅自己可见')
      if (tab === 'replies') {
        const rows = comments.filter((comment) => comment.author.id === id && !comment.deleted && visible().some((post) => post.id === comment.postId)).sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id))
        value = { posts: [], replies: rows.slice(offset, offset + limit).map((comment) => { const post = posts.find((row) => row.id === comment.postId)!; return { id: comment.id, postId: comment.postId, postTitle: post.title, bodyPreview: comment.body.slice(0, 320), likes: comment.likes, accepted: comment.accepted, createdAt: comment.createdAt } }), nextCursor: rows.length > offset + limit ? String(offset + limit) : null }
      } else {
        const rows = visible().filter((post) => (tab === 'liked' ? post.viewerState.liked : post.author.id === id) && (tab !== 'media' || post.contentBlocks.some((block) => block.type === 'image')) && post.id !== profile.pinnedPost?.id).sort((a, b) => b.publishedAt.localeCompare(a.publishedAt) || b.id.localeCompare(a.id))
        value = { posts: rows.slice(offset, offset + limit), replies: [], nextCursor: rows.length > offset + limit ? String(offset + limit) : null }
      }
    }
    else if (action === 'followers' || action === 'following') {
      const offset = Number(url.searchParams.get('cursor') || 0), limit = Number(url.searchParams.get('limit') || 20)
      const ids = action === 'following'
        ? (id === authors[0].id ? [...following] : fixtures.follows.filter((follow) => follow.follower === id).map((follow) => follow.followee))
        : [...fixtures.follows.filter((follow) => follow.followee === id).map((follow) => follow.follower), ...(following.has(id) ? [authors[0].id] : [])]
      const rows = [...new Set(ids)].filter((userId) => !muted.has(userId) && !blocked.has(userId)).map((userId) => authors.find((author) => author.id === userId)).filter((author): author is CommunityAuthorDto => !!author)
      value = { items: rows.slice(offset, offset + limit).map((author) => ({ ...author, following: following.has(author.id) })), nextCursor: rows.length > offset + limit ? String(offset + limit) : null }
    }
    else if (action === 'follow') { if (method === 'PUT') following.add(id); else following.delete(id); posts.forEach((p) => { p.viewerState.followingAuthor = following.has(p.author.id) }); value = { active: method === 'PUT' } }
    else if (action === 'mute' || action === 'block') {
      const target = action === 'mute' ? muted : blocked
      if (method === 'DELETE') target.delete(id)
      else {
        target.add(id)
        if (action === 'block') following.delete(id)
      }
      value = { active: method !== 'DELETE', hidden: method !== 'DELETE' }
    }
    else if (action === 'posts' || action === 'answers') value = visible().filter((p) => action === 'posts' ? p.author.id === id : comments.some((c) => c.postId === p.id && c.author.id === id && !c.deleted))
    else value = profileFor(id)
  } else if (root === 'questions') { const post = requirePost(id); requireOwner(post.author.id); if (!comments.some((c) => c.id === fourth && c.postId === id && !c.deleted)) throw new Error('回答不可用'); if (post.question) { post.question.status = 'solved'; post.question.acceptedCommentId = fourth; comments.forEach((c) => { if (c.postId === id) c.accepted = c.id === fourth }) }; value = post }
  else if (root === 'comments') {
    const comment = comments.find((c) => c.id === id)
    if (!comment || muted.has(comment.author.id)) throw new Error('评论不存在')
    const post = requirePost(comment.postId)
    if (action === 'report') return { reported: true } as T
    if (!action) requireOwner(comment.author.id)
    if (action === 'like') { comment.liked = method === 'PUT'; comment.likes = comment.liked ? 1 : 0 }
    else if (method === 'DELETE') { if (!comment.deleted) post.stats.comments--; comment.deleted = true; comment.body = '该评论已删除'; comment.contentBlocks = []; comment.accepted = false; if (post.question?.acceptedCommentId === id) { post.question.acceptedCommentId = null; post.question.status = 'open' } }
    else if (method === 'PATCH') { comment.contentBlocks = (body as { contentBlocks: CommunityContentBlock[] }).contentBlocks; comment.body = text(comment.contentBlocks) }
    value = comment
  } else if (root === 'posts') {
    const post = id ? requirePost(id) : undefined
    if (action === 'comments') {
      if (method === 'POST') {
        const input = body as { contentBlocks: CommunityContentBlock[]; parentId?: string }
        if (post!.status === 'draft') throw new Error('草稿不能评论')
        if (input.parentId && !comments.some((c) => c.id === input.parentId && c.postId === id && !c.parentId && !c.deleted)) throw new Error('仅支持两级评论')
        const comment: CommunityCommentDto = { id: randomId(), postId: id, author: authors[0], parentId: input.parentId || null, rootId: input.parentId || null, body: text(input.contentBlocks), contentBlocks: input.contentBlocks, deleted: false, likes: 0, liked: false, accepted: false, createdAt: new Date().toISOString() }
        comments.push(comment); post!.stats.comments++; value = comment
      } else {
        const rows = comments.filter((c) => c.postId === id), order = new Map(rows.map((row, index) => [row.id, index]))
        value = rows.sort((a, b) => (order.get(a.parentId || a.id) ?? rows.length) - (order.get(b.parentId || b.id) ?? rows.length) || Number(!!a.parentId) - Number(!!b.parentId)).map((c) => muted.has(c.author.id) ? { ...c, body: '该评论不可见', contentBlocks: [], deleted: true } : c)
      }
    } else if (action === 'pin') {
      requireOwner(post!.author.id)
      if (post!.status !== 'published' || post!.visibility !== 'public') throw new Error('只能置顶自己的公开动态')
      const input = body as { expectedProfileRevision: number }
      if (input.expectedProfileRevision !== profileRevision) throw new Error('资料已更新，请重新读取')
      pinnedPostId = post!.id; profileRevision++; value = profileFor(authors[0].id)
    } else if (action === 'reactions' || action === 'bookmark') {
      const state = action === 'bookmark' ? 'bookmarked' : fourth === 'like' ? 'liked' : 'markedUseful'
      const stat = action === 'bookmark' ? 'bookmarks' : fourth === 'like' ? 'likes' : 'useful'
      const active = method === 'PUT'
      if (post!.viewerState[state] !== active) post!.stats[stat] += active ? 1 : -1
      post!.viewerState[state] = active; value = { active }
    } else if (action === 'hide' || action === 'not-interested') { visible().filter((p) => action === 'hide' ? p.id === id : p.type === post!.type).forEach((p) => hidden.add(p.id)); value = {} }
    else if (action === 'report') value = { reported: true }
    else if (method === 'DELETE') { requireOwner(post!.author.id); posts = posts.filter((p) => p.id !== id); value = { deleted: true } }
    else if (method === 'POST' || method === 'PATCH') {
      const input = body as CommunityPostInput, now = new Date().toISOString()
      if (post) requireOwner(post.author.id)
      const saved: CommunityPostDetailDto = { ...structuredClone(initialPosts[0]), id: id || randomId(), type: input.type, status: input.status, visibility: input.visibility, title: input.title || null, body: text(input.contentBlocks), bodyPreview: text(input.contentBlocks).slice(0, 320), contentBlocks: input.contentBlocks, author: authors[0], topics: topics.filter((t) => input.topicIds.includes(t.id)), stats: post?.stats || { likes: 0, comments: 0, bookmarks: 0, useful: 0 }, viewerState: post?.viewerState || { liked: false, markedUseful: false, bookmarked: false, followingAuthor: false }, question: input.type === 'question' ? post?.question || { status: 'open', acceptedCommentId: null, teacherAnswered: false } : null, bindings: await Promise.all(input.bindings.map(async (binding) => (await mockCommunity<{ binding: CommunityPostDetailDto['bindings'][number] }>(`/bindings/context?${new URLSearchParams({ type: binding.type, id: binding.id })}`, 'GET')).binding)), publishedAt: post?.publishedAt || now, editedAt: id ? now : null }
      posts = [saved, ...posts.filter((p) => p.id !== saved.id)]; value = saved
    } else value = id ? post : visible().filter((p) => (!url.searchParams.get('keyword') || `${p.title} ${p.body}`.includes(url.searchParams.get('keyword')!)) && (!url.searchParams.get('bindingId') || p.bindings.some((b) => b.id === url.searchParams.get('bindingId'))))
  }
  if (value === undefined) throw new Error('演示数据中没有此内容')
  if (method !== 'GET' && typeof localStorage !== 'undefined') persist()
  return JSON.parse(JSON.stringify(value)) as T
}
