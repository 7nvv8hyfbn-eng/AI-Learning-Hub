import { createCommunityFixtures, demoArticles, demoChallenges, demoCourses, demoLabs, demoResourceHubCategories, demoResourceHubContributions, demoResources, demoStudents, demoThemes, lczCuratedPosts } from '@ai-learning-hub/demo-fixtures'
import { normalizeTopicName, COMMUNITY_USERNAME_PATTERN, type CommunityInlineReferenceDto, communityOperations, type AuthUser, type CampusIdentityVerificationDto, type CommunityAuthorDto, type CommunityCommentDto, type CommunityContentBlock, type CommunityContextDto, type CommunityEligibilityDto, type CommunityNotificationDto, type CommunityOperation, type CommunityPostDetailDto, type CommunityPostInput, type CommunityProfileDto, type CommunityTopicDto } from '@ai-learning-hub/contracts'
import { inlineBlocksTokens } from '../../community/inlineBlocks'
import { randomId } from './random-id'
import { mockCoverUrl, resetMockImages } from './community-images.mock'
import { mockFixtureCover } from '../../media/catalog'
import { defaultContentDetectionPolicy, detectContent, postDetectionInput, type ContentDetectionInput, type ContentDetectionResult } from '@ai-learning-hub/contracts'
import { contentDetectionNotice } from '../../community/labels'
import { reportCategories, type LearningCollectionDto, type GovernanceAppealInput, type GovernanceMineDto, type GovernanceReportInput, type GovernanceTarget } from '@ai-learning-hub/contracts'

export const checkMockContent = (input: ContentDetectionInput) => {
  const result = detectContent(input, defaultContentDetectionPolicy)
  if (result.action === 'reject') throw Object.assign(new Error(contentDetectionNotice(result)), { code: 'CONTENT_REJECTED' })
  return result
}
const fixtures = createCommunityFixtures({ courses: demoCourses, labs: demoLabs, articles: demoArticles, themes: demoThemes, students: demoStudents })
const authors: CommunityAuthorDto[] = fixtures.users.map((user) => ({ id: user.username, username: user.username, displayName: user.displayName, verifiedType: user.verifiedType, badges: user.verifiedType === 'none' ? [] : [{ code: user.verifiedType, label: ({ official: '官方', teacher: '认证教师', mentor: '学习导师' })[user.verifiedType], tone: user.verifiedType === 'official' ? 'orange' : 'blue' }], avatar: null, major: user.major, school: 'AI 创客学院' }))
const text = (blocks: CommunityContentBlock[]) => blocks.map((block) => block.type === 'image' ? block.alt : block.type === 'code' ? block.code : block.type === 'list' ? block.items.join(' ') : block.type === 'rich_text' ? block.text.replace(/<[^>]*>/g, '') : block.text).join('\n')
const topics: CommunityTopicDto[] = fixtures.topics.map((topic) => ({
  ...topic,
  themeId: topic.theme,
  status: 'active',
  following: false,
  postCount: fixtures.posts.filter((post) => post.topics.includes(topic.id)).length + lczCuratedPosts.filter((post) => post.topics.includes(topic.id)).length,
  followerCount: 0,
}))
const fixturePosts: CommunityPostDetailDto[] = fixtures.posts.map((post) => ({
  id: post.id, type: post.type, status: 'published', visibility: post.visibility, portalConsent: false, title: post.title, body: text(post.blocks), bodyPreview: text(post.blocks).slice(0, 320), contentBlocks: post.blocks, author: authors.find((user) => user.id === post.author)!,
  bindings: post.bindings.filter((b) => b.type !== 'lab_run').map((binding) => { const content = (binding.type === 'course' ? demoCourses : binding.type === 'lab' ? demoLabs : demoArticles).find((row) => row.slug === binding.id)!; return { type: binding.type, id: binding.id, slug: binding.id, title: content.title, summary: content.summary, cover: mockFixtureCover(binding.type === 'course' ? 'course' : binding.type === 'lab' ? 'lab' : 'article', content).cover, route: binding.type === 'course' ? `/courses/${binding.id}` : binding.type === 'lab' ? `/labs/${binding.id}` : `/frontier?article=${binding.id}`, status: 'published' } }),
  topics: topics.filter((topic) => post.topics.includes(topic.id)), stats: { views: 0, likes: fixtures.reactions.filter((r) => r.postId === post.id && r.type === 'like').length, useful: fixtures.reactions.filter((r) => r.postId === post.id && r.type === 'useful').length, comments: 2, bookmarks: fixtures.bookmarks.filter((r) => r.postId === post.id).length },
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
    stats: { views: 0, likes: 0, useful: 0, comments: 0, bookmarks: 0 },
    viewerState: { liked: false, markedUseful: false, bookmarked: false, followingAuthor: false },
    recommendationReasons: ['外部社区精选 · 本地固定演示'],
    labels: ['外部社区精选', '本地演示已发布'],
    question: null,
    publishedAt: post.sourcePublishedAt,
    editedAt: null,
  }
})
const resourcePosts: CommunityPostDetailDto[] = demoResourceHubContributions.map((item, index) => {
  const cover = item.coverUrl
  const category = demoResourceHubCategories.find((row) => row.code === item.categoryCode)!
  const author = authors.find((row) => row.id === item.author) || authors[0]
  return {
    id: item.id,
    revision: 1,
    type: item.kind === 'article' ? 'frontier_discussion' : item.kind === 'video' ? 'lab_result' : 'note',
    status: 'published',
    visibility: 'public',
    title: item.title,
    body: item.summary,
    bodyPreview: item.summary,
    contentBlocks: [{ type: 'paragraph', text: item.summary }],
    author,
    bindings: [],
    topics: topics.filter((topic) => item.tags.some((tag) => `${topic.name}${topic.slug}`.toLowerCase().includes(tag.toLowerCase()))).slice(0, 3),
    stats: { views: 0, likes: item.likes, useful: 0, comments: item.comments, bookmarks: item.bookmarks },
    viewerState: { liked: false, markedUseful: false, bookmarked: false, followingAuthor: false },
    recommendationReasons: ['资源共创固定演示数据'],
    labels: ['演示内容'],
    question: null,
    publishedAt: item.publishedAt,
    editedAt: null,
    contribution: {
      postId: item.id,
      kind: item.kind,
      categoryId: category.id,
      category: { ...category },
      tags: item.tags,
      teachingReuseConsent: true,
      coverFileId: undefined,
      coverUrl: cover,
      featured: !!item.featured,
      liveReplay: !!item.liveReplay,
      revision: 1,
      video: item.kind === 'video' ? {
        id: `video-${item.id}`,
        status: 'ready',
        originalName: `${item.id}.mp4`,
        originalMimeType: 'video/mp4',
        durationSeconds: item.durationSeconds || 60,
        width: 1280,
        height: 720,
        rotation: 0,
        attempts: 1,
        lastError: null,
        posterUrl: cover,
        createdAt: item.publishedAt,
        updatedAt: item.publishedAt,
      } : null,
      attachment: item.kind === 'document' ? { id: `file-${item.id}`, name: `${item.title}.txt`, size: 320 + index, mimeType: 'text/plain', downloadUrl: item.attachmentUrl } : null,
    },
  }
})
const initialPosts = [...fixturePosts, ...curatedPosts, ...resourcePosts]
const resourceComments: CommunityCommentDto[] = resourcePosts.map((post) => {
  const author = post.author.id === authors[0].id ? editorialAuthor : authors[0]
  const body = '这个演示条目的步骤和边界很清楚，适合继续补充实践记录。'
  return { id: `comment-${post.id}`, postId: post.id, author, parentId: null, rootId: null, body, contentBlocks: [{ type: 'paragraph', text: body }], deleted: false, likes: 0, liked: false, accepted: false, createdAt: post.publishedAt }
})
const initialComments: CommunityCommentDto[] = [
  ...fixtures.comments.map((c) => ({ id: c.id, postId: c.postId, author: authors.find((u) => u.id === c.author)!, parentId: c.parentId, rootId: c.parentId, body: c.body, contentBlocks: [{ type: 'paragraph' as const, text: c.body }], deleted: false, likes: 0, liked: false, accepted: false, createdAt: new Date().toISOString() })),
  ...resourceComments,
]
const initialNotifications: CommunityNotificationDto[] = fixtures.notifications.filter((n) => n.recipient === authors[0].id).map((n) => ({ id: n.id, type: n.type, actor: authors.find((a) => a.id === n.actor)!, entityType: n.entityType, entityId: n.entityId, text: n.text, count: 1, readAt: null, createdAt: n.createdAt, source: 'community' }))
let comments = structuredClone(initialComments), notifications = structuredClone(initialNotifications)
let posts = structuredClone(initialPosts)
const publishedIds = new Set(initialPosts.map((post) => post.id))
const initialFollowing = fixtures.follows.filter((f) => f.follower === authors[0].id).map((f) => f.followee)
const hidden = new Set<string>(), muted = new Set<string>(), blocked = new Set<string>(), following = new Set(initialFollowing)
const viewSessions = new Map<string, { expiresAt: number; postIds?: Set<string> }>()
const viewed = new Set<string>()
const cursors = new Map<string, { ids: string[]; offset: number; mode: string; type: string; requestId: string }>()
let bio = '', headline = '', location = '', websiteUrl = '', expertiseTopics: string[] = [], bannerUrl: string | null = null, pinnedPostId: string | null = null, allowAchievementDrafts = false, userRevision = 1, profileRevision = 1
let pendingChanges: CommunityProfileDto['pendingChanges'], profileDetection: ContentDetectionResult | undefined
const initialVerification: CampusIdentityVerificationDto = { status: 'approved', submittedAt: '2026-08-30T08:00:00.000Z', reviewedAt: '2026-08-30T09:00:00.000Z', reviewReason: '演示账号固定审核结果', maskedRealName: '张*', maskedIdNumber: '3301**********1234', className: '计算机科学与技术 2026-1 班', studentNo: 'DEMO20260001', revision: 2 }
let verification = structuredClone(initialVerification)
let governance: GovernanceMineDto = { actions: [], reports: [], appeals: [], reviews: [] }
const joinedAt = '2026-08-30T08:00:00.000Z'
const storageKey = 'ai-learning-community:demo-v5'
export const mockResourceActivity: Array<{ targetId: string; eventType: 'community_post_click' | 'resource_valid_watch' | 'impression'; createdAt: number; eventKey?: string }> = []
let restored = false
const restoreMock = () => {
if (restored) return
restored = true
try {
  const stored = JSON.parse(localStorage.getItem(storageKey) || 'null')
  if (stored?.version === 5) {
    if (Array.isArray(stored.createdTopics)) topics.push(...stored.createdTopics.filter((topic: CommunityTopicDto) => !topics.some((row) => row.id === topic.id)))
    posts = stored.posts; (stored.publishedIds || posts.filter((post: CommunityPostDetailDto) => post.status === 'published').map((post: CommunityPostDetailDto) => post.id)).forEach((id: string) => publishedIds.add(id)); posts.forEach((post) => { post.stats.views ??= 0 }); comments = stored.comments; notifications = stored.notifications
    mockResourceActivity.splice(0, mockResourceActivity.length, ...(stored.resourceActivity || []))
    for (const id of stored.hidden) hidden.add(id)
    for (const id of stored.muted) muted.add(id)
    for (const id of stored.blocked) blocked.add(id)
    following.clear(); for (const id of stored.following) following.add(id)
    topics.forEach((topic) => { topic.following = stored.topicIds.includes(topic.id) })
    bio = stored.bio; headline = stored.headline; location = stored.location || ''; websiteUrl = stored.websiteUrl || ''; expertiseTopics = stored.expertiseTopics || []; bannerUrl = stored.bannerUrl || null; pinnedPostId = stored.pinnedPostId || null; allowAchievementDrafts = stored.allowAchievementDrafts
    userRevision = stored.userRevision || 1; profileRevision = stored.profileRevision || 1
    pendingChanges = stored.pendingChanges; profileDetection = stored.profileDetection
    if (stored.verification) verification = stored.verification
    if (stored.governance) governance = stored.governance
    authors[0].avatar = stored.avatar || null
  }
} catch { /* 损坏的本地演示状态使用可重置的初始数据。 */ }
}
const persist = () => { try { localStorage.setItem(storageKey, JSON.stringify({ version: 5, posts, publishedIds: [...publishedIds], comments, notifications, createdTopics: topics.filter((topic) => !fixtures.topics.some((row) => row.id === topic.id)), resourceActivity: mockResourceActivity, hidden: [...hidden], muted: [...muted], blocked: [...blocked], following: [...following], topicIds: topics.filter((t) => t.following).map((t) => t.id), bio, headline, location, websiteUrl, expertiseTopics, bannerUrl, pinnedPostId, avatar: authors[0].avatar, allowAchievementDrafts, userRevision, profileRevision, verification, pendingChanges, profileDetection, governance })) } catch { throw new Error('本地演示存储已满，请清理浏览器空间') } }
export const resetCommunityMock = () => {
  resetMockImages()
  restored = true
  posts = structuredClone(initialPosts); comments = structuredClone(initialComments); notifications = structuredClone(initialNotifications)
  publishedIds.clear(); initialPosts.forEach((post) => publishedIds.add(post.id))
  topics.splice(0, topics.length, ...topics.filter((topic) => fixtures.topics.some((row) => row.id === topic.id)))
  mockResourceActivity.length = 0
  hidden.clear(); muted.clear(); blocked.clear(); following.clear(); cursors.clear(); viewSessions.clear(); viewed.clear(); initialFollowing.forEach((id) => following.add(id))
  topics.forEach((topic) => { topic.following = false; topic.followerCount = 0 })
  bio = ''; headline = ''; location = ''; websiteUrl = ''; expertiseTopics = []; bannerUrl = null; pinnedPostId = null; allowAchievementDrafts = false; userRevision = 1; profileRevision = 1; verification = structuredClone(initialVerification); authors[0].avatar = null
  pendingChanges = undefined; profileDetection = undefined
  governance = { actions: [], reports: [], appeals: [], reviews: [] }
  if (typeof localStorage !== 'undefined') localStorage.removeItem(storageKey)
}
const context = (): CommunityContextDto => ({ todayPlan: null, continueCourse: null, continueLab: null, currentChallenge: null, trendingTopics: topics.slice(0, 6), suggestedUsers: authors.filter((user) => user.verifiedType !== 'none'), needsInterests: topics.filter((t) => t.following).length < 3 })
export const mockTargetUnavailable = (type: string, id: string, authorId: string) => governance.actions.some((row) => !row.revokedAt && (!row.expiresAt || Date.parse(row.expiresAt) > Date.now()) && (row.action === 'ban' && authorId === authors[0].id || row.action === 'takedown' && row.target.id === id && (row.target.type === type || ['post', 'resource'].includes(type) && ['post', 'resource'].includes(row.target.type))))
const visible = (ownDrafts = false) => posts.filter((p) => !mockTargetUnavailable('post', p.id, p.author.id) && !hidden.has(p.id) && !muted.has(p.author.id) && !blocked.has(p.author.id) && (p.status === 'published' || p.status === 'limited' || (ownDrafts && ['draft', 'pending_review'].includes(p.status) && p.author.id === authors[0].id)))
const mockPostRelations = (saved: CommunityPostDetailDto, input: CommunityPostInput, previous?: CommunityPostDetailDto) => {
  const quotedPostId = input.quotedPostId === undefined ? previous?.quotedPostId || null : input.quotedPostId
  if (quotedPostId === saved.id) throw new Error('不能引用自己这篇帖子')
  if (previous && publishedIds.has(previous.id) && previous.quotedPostId !== quotedPostId) throw new Error('已公开帖子的引用目标不能更换')
  if (quotedPostId && (!previous || previous.status !== 'published') && !visible().some((post) => post.id === quotedPostId && post.visibility === 'public' && post.status === 'published')) throw new Error('只能引用当前可见的公开帖子')
  if (quotedPostId && input.status === 'published' && !text(input.contentBlocks.filter((block) => block.type !== 'image')).trim()) throw new Error('请写下自己的观点后再引用发布')
  const tokens = [...new Map(inlineBlocksTokens(input.contentBlocks).map((token) => [`${token.kind}:${token.query}`, token])).values()]
  if (tokens.filter((token) => token.kind === 'mention').length > 8) throw new Error('每篇帖子最多提及 8 位用户')
  const refs: CommunityInlineReferenceDto[] = [], joined = new Set(input.topicIds), created: CommunityTopicDto[] = []
  for (const token of tokens) {
    const old = previous?.inlineReferences?.find((ref) => ref.kind === token.kind && normalizeTopicName(ref.text.slice(1)) === token.query)
    if (token.kind === 'mention') {
      const user = authors.find((user) => user.username.toLowerCase() === token.query && !blocked.has(user.id) && !muted.has(user.id) && !mockTargetUnavailable('profile', user.id, user.id))
      const selected = input.inlineReferences?.find((ref) => ref.kind === 'mention' && normalizeTopicName(ref.text.slice(1)) === token.query)
      if (!old && selected && selected.id !== user?.id) throw new Error('所选用户已改名或不可互动，请重新选择')
      if (old || user) refs.push({ kind: 'mention', text: token.text, id: old?.id || user!.id })
    } else {
      let topic = old ? topics.find((topic) => topic.id === old.id) : [...topics, ...created].find((topic) => normalizeTopicName(topic.name) === token.query)
      if (!topic && saved.status === 'published' && saved.visibility === 'public') { const id = randomId(); topic = { id, slug: id, name: token.text.slice(1), description: '', themeId: null, accent: 'orange', recommended: false, sortOrder: 0, status: 'active', following: false, postCount: 1, followerCount: 0 }; created.push(topic) }
      if (topic?.status === 'active') { refs.push({ kind: 'topic', text: token.text, id: topic.id }); joined.add(topic.id) }
      else if (!topic) joined.add(`pending:${token.query}`)
    }
  }
  if (joined.size > 5) throw new Error('正文和手动选择合计最多关联 5 个话题')
  topics.push(...created)
  return { quotedPostId, quotedPost: null, inlineReferences: refs, manualTopicIds: [...input.topicIds], topics: topics.filter((topic) => joined.has(topic.id)) }
}
const mockPostProjection = (post: CommunityPostDetailDto) => {
  const available = visible(), original = available.find((row) => row.id === post.quotedPostId && row.status === 'published' && row.visibility === 'public')
  const links = (references: CommunityInlineReferenceDto[] = []) => references.map((ref) => ({ ...ref, route: ref.kind === 'topic' ? topics.some((topic) => topic.id === ref.id && topic.status === 'active') ? `/community/topic/${topics.find((topic) => topic.id === ref.id)!.slug}` : undefined : authors.some((user) => user.id === ref.id && !blocked.has(user.id) && !muted.has(user.id) && !mockTargetUnavailable('profile', user.id, user.id)) ? `/community/people/${ref.id}` : undefined }))
  return { ...post, inlineReferences: links(post.inlineReferences), stats: { ...post.stats, quotes: available.filter((row) => row.quotedPostId === post.id && row.status === 'published').length }, quotedPost: !post.quotedPostId ? null : original ? { id: original.id, available: true, author: original.author, publishedAt: original.publishedAt, title: original.title, contentBlocks: original.contentBlocks.filter((block) => block.type !== 'image'), inlineReferences: links(original.inlineReferences), thumbnailFileId: original.contentBlocks.find((block) => block.type === 'image')?.fileId } : { id: post.quotedPostId, available: false } }
}
export const recordMockResourceActivity = (targetId: string, eventType: typeof mockResourceActivity[number]['eventType'], eventKey?: string) => {
  restoreMock()
  if (!visible().some((post) => post.id === targetId)) throw new Error('动态不可见或已删除')
  if (eventKey && mockResourceActivity.some((event) => event.eventKey === eventKey)) return
  mockResourceActivity.push({ targetId, eventType, createdAt: Date.now(), ...(eventKey ? { eventKey } : {}) })
  persist()
}
export const mockResourceContributionPosts = (ownDrafts = false) => {
  restoreMock()
  return structuredClone(visible(ownDrafts).filter((post) => !!post.contribution))
}
const requirePost = (id: string) => { const post = visible(true).find((p) => p.id === id); if (!post) throw new Error('动态不可见或已删除'); return post }
const requireOwner = (authorId: string) => { if (authorId !== authors[0].id) throw new Error('只能修改自己的内容') }
const mockVerificationStatus = () => {
  let status = verification.status
  try {
    const stored = typeof localStorage === 'undefined' ? null : JSON.parse(localStorage.getItem('community-demo-user') || 'null')
    status = stored?.identityVerificationStatus || status
  } catch { /* 损坏的演示会话沿用内存认证状态。 */ }
  return status
}
const mockEligibility = (): CommunityEligibilityDto => {
  const allowed = mockVerificationStatus() === 'approved'
  const operations = Object.fromEntries(communityOperations.map((operation) => [operation, operation === 'read' || allowed
    ? { allowed: true, reasonCode: null, message: null, availableAt: null, nextAction: null }
    : { allowed: false, reasonCode: 'COMMUNITY_VERIFICATION_REQUIRED', message: '需要完成校园实名认证后才能参与社区公开操作。', availableAt: null, nextAction: { label: '前往认证', route: '/community/verification' } }])) as CommunityEligibilityDto['operations']
  for (const action of governance.actions) {
    if (action.revokedAt || action.expiresAt && Date.parse(action.expiresAt) <= Date.now()) continue
    const keys = action.action === 'ban' ? communityOperations : action.action === 'mute' ? ['post', 'comment'] : action.action === 'restrict' ? action.operations : []
    for (const key of keys) if (communityOperations.includes(key as CommunityOperation)) operations[key as CommunityOperation] = { allowed: false, reasonCode: action.action === 'ban' ? 'ACCOUNT_UNAVAILABLE' : 'COMMUNITY_OPERATION_RESTRICTED', message: action.reason, availableAt: action.expiresAt, nextAction: null }
  }
  return {
    canRead: operations.read.allowed,
    canPost: operations.post.allowed,
    canComment: operations.comment.allowed,
    canUpload: operations.upload.allowed,
    operations,
    evaluatedAt: new Date().toISOString(),
  }
}
export const assertMockCommunityWrite = (operation: CommunityOperation = 'post') => {
  const decision = mockEligibility().operations[operation]
  if (!decision.allowed) throw Object.assign(new Error(decision.message!), { code: decision.reasonCode, availableAt: decision.availableAt, nextAction: decision.nextAction })
}
const filtered = (url: URL) => visible().filter((p) => (!url.searchParams.get('type') || url.searchParams.get('type') === 'all' || p.type === url.searchParams.get('type')) && (url.searchParams.get('mode') !== 'following' || following.has(p.author.id) || p.topics.some((t) => topics.find((topic) => topic.id === t.id)?.following)))
const profileFor = (id: string): CommunityProfileDto => {
  const user = authors.find((author) => author.id === id)
  if (!user || mockTargetUnavailable('profile', id, id)) throw new Error('用户不存在或不可见')
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
    ...(own ? { allowAchievementDrafts, pendingChanges, detection: profileDetection } : {}),
    postCount: publicPosts.length,
    replyCount: comments.filter((comment) => comment.author.id === id && !comment.deleted && (comment.status || 'published') === 'published' && visible().some((post) => post.id === comment.postId)).length,
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
const saveMockProfile = (changes: CommunityProfileDto['pendingChanges']) => {
  const next = { username: authors[0].username, displayName: authors[0].displayName, bio, headline, location, websiteUrl, expertiseTopics, ...pendingChanges, ...changes }
  const detection = checkMockContent({ username: next.username, displayName: next.displayName, bio: next.bio, headline: next.headline, location: next.location, websiteUrl: next.websiteUrl, expertiseTopics: next.expertiseTopics.join('\n') })
  if (detection.action === 'review') pendingChanges = next
  else {
    pendingChanges = undefined
    authors[0].username = next.username; authors[0].displayName = next.displayName
    bio = next.bio; headline = next.headline; location = next.location; websiteUrl = next.websiteUrl; expertiseTopics = next.expertiseTopics
  }
  profileDetection = detection; profileRevision++
  return detection
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
    identityVerificationStatus: stored.identityVerificationStatus || verification.status,
    communityWriteEnabled: (stored.identityVerificationStatus || verification.status) === 'approved',
    revision: userRevision,
    profileRevision,
  }
}
export async function mockCommunity<T>(path: string, method: string, body?: unknown): Promise<T> {
  restoreMock()
  posts.forEach((post) => { post.revision ??= 1 })
  comments.forEach((comment) => { comment.revision ??= 1 })
  if (typeof localStorage !== 'undefined') {
    try {
      const user = JSON.parse(localStorage.getItem('community-demo-user') || 'null')
      if (user?.username) {
        Object.assign(authors[0], { username: user.username, displayName: user.displayName, school: user.school, major: user.major })
        if (user.identityVerificationStatus === 'unsubmitted' && verification.status === 'approved') verification = { status: 'unsubmitted', submittedAt: null, reviewedAt: null, reviewReason: null, maskedRealName: null, maskedIdNumber: null, className: null, studentNo: null, revision: null }
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
  if (root === 'governance') {
    if (id === 'mine' && method === 'GET') return structuredClone(governance) as T
    if (id === 'reports' && method === 'POST') {
      assertMockCommunityWrite('report')
      const input = body as GovernanceReportInput & { targetType: GovernanceTarget; targetId: string }
      if (!['post', 'comment', 'resource', 'collection', 'profile'].includes(input.targetType) || !Object.hasOwn(reportCategories, input.category) || !input.reason?.trim() || input.reason.length > 100 || (input.description?.length || 0) > 1000) throw new Error('举报对象、分类或说明无效')
      const post = posts.find((row) => row.id === input.targetId), comment = comments.find((row) => row.id === input.targetId), profile = authors.find((row) => row.id === input.targetId)
      if ((input.targetType === 'post' || input.targetType === 'resource') && (!post || !visible().some((row) => row.id === post.id))) throw new Error('内容当前不可举报')
      if (input.targetType === 'resource' && !post?.contribution) throw new Error('资源作品不存在')
      if (input.targetType === 'comment' && (!comment || comment.deleted || !visible().some((row) => row.id === comment.postId) || mockTargetUnavailable('comment', comment.id, comment.author.id))) throw new Error('评论当前不可举报')
      if (input.targetType === 'profile' && (!profile || mockTargetUnavailable('profile', profile.id, profile.id))) throw new Error('资料不存在')
      const collection = input.targetType === 'collection' ? await (await import('./resourceHub.mock')).mockResourceHub<LearningCollectionDto>(`/collections/${input.targetId}`) : null
      if (collection && (collection.visibility !== 'community' || collection.contentStatus !== 'published' || mockTargetUnavailable('collection', collection.id, collection.owner.id))) throw new Error('合集当前不可举报')
      const revision = post?.revision || comment?.revision || collection?.revision || (profile?.id === authors[0].id ? profileRevision : 1)
      const targetType = post?.contribution ? 'resource' : input.targetType
      const duplicate = governance.reports.find((row) => row.target.id === input.targetId && row.target.type === targetType && row.target.revision === revision)
      if (duplicate) return { reported: true, id: duplicate.id } as T
      if ((input.evidence?.length || 0) > 3 || input.evidence?.some((url) => !/^https:\/\//.test(url))) throw new Error('证据最多3条，必须为 HTTPS 链接')
      const reportId = randomId(), now = new Date().toISOString()
      governance.reports.unshift({ id: reportId, revision: 1, target: { type: targetType, id: input.targetId, revision, title: post?.title || comment?.body || profile?.displayName || collection?.name || '', available: true, route: null }, category: input.category, reason: input.reason, description: input.description || '', evidence: input.evidence || [], status: 'pending', assignedToId: null, dueAt: new Date(Date.now() + 48 * 3600000).toISOString(), createdAt: now, resultReason: '', actionId: null })
      persist(); return { reported: true, id: reportId } as T
    }
    if (id === 'appeals' && method === 'POST') {
      const input = body as GovernanceAppealInput
      if ((input.evidence?.length || 0) > 3 || input.evidence?.some((url) => !/^https:\/\//.test(url) || url.length > 500) || input.reason.length > 1000) throw new Error('申诉说明或证据无效')
      if (!!input.actionId === !!input.reviewId || input.reason.trim().length < 10) throw new Error('请关联具体处罚或修订并填写至少10字理由')
      if (input.actionId ? !governance.actions.some((row) => row.id === input.actionId && !row.revokedAt) : !governance.reviews.some((row) => row.id === input.reviewId && row.status === 'rejected')) throw new Error('没有可申诉的本人记录')
      const same = governance.appeals.filter((row) => input.actionId ? row.actionId === input.actionId : row.reviewId === input.reviewId)
      const duplicate = same.find((row) => row.reason === input.reason.trim() && JSON.stringify(row.evidence) === JSON.stringify(input.evidence || []))
      if (duplicate) return duplicate as T
      if (same.some((row) => ['pending', 'reviewing'].includes(row.status))) throw new Error('此事项已有待处理申诉')
      if (governance.appeals.filter((row) => Date.now() - Date.parse(row.createdAt) < 86400000).length >= 5) throw new Error('今日申诉次数已达上限')
      const row = { id: randomId(), revision: 1, actionId: input.actionId || null, reviewId: input.reviewId || null, reason: input.reason.trim(), evidence: input.evidence || [], status: 'pending' as const, resultReason: '', assignedToId: null, dueAt: new Date(Date.now() + 48 * 3600000).toISOString(), createdAt: new Date().toISOString() }
      governance.appeals.unshift(row); persist(); return row as T
    }
    throw new Error('不支持的演示治理操作')
  }
  const readonlyWrite = root === 'verification' || root === 'notifications' || root === 'signals' || method === 'DELETE' || ['hide', 'not-interested', 'mute', 'block', 'unpublish'].includes(action || '') || (root === 'feed' && (id === 'impressions' || id === 'dwell' || id === 'view-context'))
  const draftWrite = root === 'drafts' || root === 'posts' && (body as CommunityPostInput | undefined)?.status === 'draft'
  if (method !== 'GET' && !readonlyWrite && !draftWrite && root !== 'onboarding') {
    const operation: CommunityOperation = action === 'report' ? 'report' : root === 'comments' || action === 'comments' || root === 'questions' ? 'comment' : root === 'profile' ? 'profile' : root === 'topics' || root === 'users' || action === 'reactions' || action === 'bookmark' ? 'interaction' : 'post'
    assertMockCommunityWrite(operation)
  }
  let value: unknown
  if (root === 'verification') {
    if (method === 'GET') value = verification
    else if (id === 'demo-review') {
      const input = body as { status: 'pending' | 'approved' | 'rejected' | 'revoked'; reason: string }
      const allowed = verification.status === 'pending' ? ['approved', 'rejected'] : verification.status === 'approved' ? ['revoked'] : []
      if (!allowed.includes(input.status)) throw new Error('当前演示认证状态不能执行该审核操作')
      verification = { ...verification, status: input.status, reviewedAt: new Date().toISOString(), reviewReason: input.reason || '演示审核结果', revision: (verification.revision || 0) + 1 }
      value = verification
    } else if (method === 'PUT') {
      if (verification.status === 'pending' || verification.status === 'approved') throw new Error(verification.status === 'pending' ? '认证资料正在审核中，不能重复覆盖' : '认证已通过，如需修改请先撤销')
      const input = body as { realName: string; idNumber: string; className: string; studentNo: string; expectedRevision?: number }
      if (verification.revision !== null && input.expectedRevision !== verification.revision) throw new Error('认证资料状态已变化，请重新读取')
      verification = { status: 'pending', submittedAt: new Date().toISOString(), reviewedAt: null, reviewReason: null, maskedRealName: `${input.realName.trim().slice(0, 1)}*`, maskedIdNumber: `${input.idNumber.trim().slice(0, 4)}**********${input.idNumber.trim().slice(-4).toUpperCase()}`, className: input.className.trim(), studentNo: input.studentNo.trim().toUpperCase(), revision: (verification.revision || 0) + 1 }
      value = verification
    }
    const user = authUser()
    const updated = { ...user, identityVerificationStatus: (value as CampusIdentityVerificationDto).status, communityWriteEnabled: (value as CampusIdentityVerificationDto).status === 'approved' }
    localStorage.setItem('community-demo-user', JSON.stringify(updated))
  } else if (root === 'drafts') {
    if (method === 'GET') value = visible(true).filter((p) => p.status === 'draft' && p.author.id === authors[0].id).map((p) => ({ id: p.id, revision: p.revision, updatedAt: p.editedAt || p.publishedAt, input: { expectedRevision: p.revision, type: p.type, title: p.title || '', coverFileId: p.coverFileId, contentBlocks: p.contentBlocks, bindings: p.bindings.map((b) => ({ type: b.type, id: b.id })), inlineReferences: p.inlineReferences?.map(({ kind, text, id }) => ({ kind, text, id })), quotedPostId: p.quotedPostId, topicIds: p.manualTopicIds || p.topics.map((t) => t.id), visibility: p.visibility, portalConsent: p.portalConsent === true, status: 'draft', ...(p.contribution ? { contribution: { kind: p.contribution.kind, categoryId: p.contribution.categoryId, tags: p.contribution.tags, teachingReuseConsent: p.contribution.teachingReuseConsent, sourceName: p.contribution.sourceName, sourceUrl: p.contribution.sourceUrl, videoAssetId: p.contribution.videoAssetId, attachmentFileId: p.contribution.attachmentFileId, coverFileId: p.contribution.coverFileId } } : {}) } }))
    else { if (id && requirePost(id).status !== 'draft') throw new Error('不是草稿'); return mockCommunity<T>(id ? `/posts/${id}` : '/posts', method, body ? { ...body as CommunityPostInput, status: 'draft' } : undefined) }
  } else if (root === 'onboarding') {
    if (method === 'GET') value = [{ id: 'demo-school', name: 'AI 创客学院（本地演示）' }]
    else { const input = body as { themeIds: string[]; schoolId: string; major: string; headline: string }; checkMockContent({ headline: input.headline }); await mockCommunity('/interests', 'POST', input); const contentDetection = saveMockProfile({ headline: input.headline }); userRevision++; const user = JSON.parse(localStorage.getItem('community-demo-user') || '{}'); value = { ...user, school: input.schoolId ? 'AI 创客学院' : null, major: input.major, onboardingCompleted: true, contentDetection } }
  } else if (root === 'search' && id === 'suggestions') {
    const q = (url.searchParams.get('q') || '').normalize('NFKC').toLowerCase()
    value = url.searchParams.get('kind') === 'topic'
      ? topics.filter((topic) => topic.status === 'active' && (normalizeTopicName(topic.name).includes(normalizeTopicName(q)) || `${topic.name} ${topic.description}`.normalize('NFKC').toLowerCase().includes(q))).slice(0, 8).map((topic) => ({ kind: 'topic', id: topic.id, name: topic.name, postCount: topic.postCount }))
      : authors.filter((user) => COMMUNITY_USERNAME_PATTERN.test(user.username) && !muted.has(user.id) && !blocked.has(user.id) && !mockTargetUnavailable('profile', user.id, user.id) && `${user.username} ${user.displayName}`.normalize('NFKC').toLowerCase().includes(q)).slice(0, 8).map((user) => ({ kind: 'mention', id: user.id, name: user.displayName, username: user.username, avatar: user.avatar, verifiedType: user.verifiedType, badges: user.badges }))
  } else if (root === 'search') {
    const q = (url.searchParams.get('q') || '').toLowerCase(), type = url.searchParams.get('type') || 'all', offset = Number(url.searchParams.get('cursor') || 0), limit = type === 'all' ? 3 : 20
    const matches = (value: string) => !!q && value.toLowerCase().includes(q)
    const catalog = (rows: Array<{ slug: string; title: string; summary: string }>) => rows.filter((r) => matches(`${r.title} ${r.summary}`)).map((r) => ({ ...r, id: r.slug, status: 'published', data: r, updatedAt: '', publishedAt: null, sortOrder: 0 }))
    const all = { posts: visible().filter((r) => matches(`${r.title} ${r.body}`)), users: authors.filter((r) => !muted.has(r.id) && !blocked.has(r.id) && matches(`${r.username} ${r.displayName}`)), topics: topics.filter((r) => matches(`${r.name} ${r.description}`)), courses: catalog(demoCourses), labs: catalog(demoLabs), resources: catalog(demoResources), articles: catalog(demoArticles) }
    value = { ...Object.fromEntries(Object.entries(all).map(([key, rows]) => [key, type === 'all' || type === key ? rows.slice(offset, offset + limit) : []])), nextCursor: type !== 'all' && type in all && all[type as keyof typeof all].length > offset + limit ? String(offset + limit) : null }
  } else if (root === 'feed') {
    const visibleOwnIds = new Set(visible().filter((post) => post.author.id === authors[0].id && post.status === 'published').map((post) => post.id))
    const invalidPriorityIds = (url.searchParams.get('priorityIds') || '').split(',').filter(Boolean).slice(0, 150).filter((id) => !visibleOwnIds.has(id))
    if (id === 'updates') value = { invalidPriorityIds, count: filtered(url).filter((p) => p.publishedAt > (url.searchParams.get('since') || '')).length }
    else if (id === 'view-context' && method === 'POST') {
      const requestId = randomId(), expiresAt = Date.now() + 3600000
      viewSessions.set(requestId, { expiresAt }); value = { requestId, expiresAt: new Date(expiresAt).toISOString() }
    }
    else if (id === 'impressions' && method === 'POST') {
      const items: Array<{ requestId: string; postId: string; views: number }> = []
      for (const entry of (body as { items: import('@ai-learning-hub/contracts').CommunityImpressionInput[] }).items) {
        const session = viewSessions.get(entry.requestId), post = visible().find((row) => row.id === entry.postId && row.status === 'published')
        if (!session || session.expiresAt <= Date.now() || session.postIds && !session.postIds.has(entry.postId) || !post || (entry.dwellMs || 0) < 1000) continue
        const key = `impression:${entry.requestId}:${entry.postId}`
        if (!viewed.has(key)) { viewed.add(key); post.stats.views++; recordMockResourceActivity(entry.postId, 'impression', key) }
        items.push({ requestId: entry.requestId, postId: entry.postId, views: post.stats.views })
      }
      value = { received: true, items }
    }
    else if (method !== 'GET') value = { received: true }
    else {
      const cursor = url.searchParams.get('cursor'), type = url.searchParams.get('type') || 'all', mode = url.searchParams.get('mode') || 'for_you'
      const session = cursor ? cursors.get(cursor) : { ids: filtered(url).sort((a, b) => b.publishedAt.localeCompare(a.publishedAt) || b.id.localeCompare(a.id)).map((p) => p.id), offset: 0, type, mode, requestId: randomId() }
      if (!session || session.type !== type || session.mode !== mode) throw new Error('游标已失效或筛选不匹配，请刷新')
      const list = visible().filter((p) => session.ids.slice(session.offset, session.offset + 20).includes(p.id)).sort((a, b) => session.ids.indexOf(a.id) - session.ids.indexOf(b.id))
      if (!viewSessions.has(session.requestId)) viewSessions.set(session.requestId, { expiresAt: Date.now() + 3600000, postIds: new Set() })
      list.forEach((post) => viewSessions.get(session.requestId)!.postIds!.add(post.id))
      const nextCursor = session.offset + 20 < session.ids.length ? randomId() : null
      if (nextCursor) cursors.set(nextCursor, { ...session, offset: session.offset + 20 })
      value = { requestId: session.requestId, policyVersion: 'demo-fixtures', degraded: false, invalidPriorityIds, items: list.map((post) => ({ type: 'post', id: post.id, post })), nextCursor }
    }
  } else if (root === 'context') value = context()
  else if (root === 'eligibility') value = mockEligibility()
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
  else if (root === 'signals') {
    const input = body as { eventType: string; targetType: string; targetId: string }
    if (input.eventType === 'community_post_click' && input.targetType === 'post') recordMockResourceActivity(input.targetId, 'community_post_click')
    value = { recorded: true }
  }
  else if (root === 'topics') {
    if (action === 'follow') { const topic = topics.find((t) => t.id === id)!; topic.following = method === 'PUT'; value = { active: topic.following } }
    else if (action === 'posts') value = visible().filter((p) => p.topics.some((t) => t.slug === id))
    else value = id ? topics.find((topic) => topic.slug === id && topic.status === 'active') : topics
  } else if (root === 'bookmarks') value = visible().filter((p) => p.viewerState.bookmarked)
  else if (root === 'notifications') {
    const available = notifications.filter((n) => n.entityType !== 'post' || visible().some((p) => p.id === n.entityId))
    if (id === 'unread-count') value = { count: available.filter((n) => !n.readAt).length }
    else if (method === 'GET') value = available
    else { notifications.forEach((n) => { if (id === 'read-all' || n.id === id) n.readAt ||= new Date().toISOString() }); value = { read: true } }
  }
  else if (root === 'profile') {
    if (id === 'username') {
      const user = JSON.parse(localStorage.getItem('community-demo-user') || '{}')
      if (user.usernameChanged) throw new Error('公开用户名只能修改一次')
      const username = (body as { username: string }).username.trim().toLowerCase()
      if (!/^(?!_)(?!.*__)[a-z0-9_]{4,24}(?<!_)$/.test(username) || ['admin', 'administrator', 'root', 'system', 'official', 'moderator', 'support', 'api', 'www'].includes(username) || authors.some((a) => a.username.toLowerCase() === username)) throw new Error('用户名不可用')
      const contentDetection = saveMockProfile({ username }); userRevision++
      value = { ...user, ...authUser(), usernameChanged: contentDetection.action !== 'review', contentDetection }
      localStorage.setItem('community-demo-user', JSON.stringify(value))
    }
    else if (id === 'avatar' || id === 'banner') {
      const input = body as { file?: File; expectedUserRevision: number; expectedProfileRevision: number }
      if (input.expectedUserRevision !== userRevision || input.expectedProfileRevision !== profileRevision) throw new Error('资料已更新，请重新读取')
      if (method === 'POST' && !input.file) throw new Error('请选择图片')
      saveMockProfile({})
      if (method === 'POST') {
        const url = URL.createObjectURL(input.file!)
        if (id === 'avatar') authors[0].avatar = url
        else bannerUrl = url
      } else if (id === 'avatar') authors[0].avatar = null
      else bannerUrl = null
      userRevision++; value = { user: authUser(), profile: profileFor(authors[0].id) }
    } else if (id === 'pinned-post') {
      const input = body as { expectedProfileRevision: number }
      if (input.expectedProfileRevision !== profileRevision) throw new Error('资料已更新，请重新读取')
      saveMockProfile({}); pinnedPostId = null; value = profileFor(authors[0].id)
    } else {
      const input = body as { expectedUserRevision: number; expectedProfileRevision: number; displayName: string; bio: string; headline: string; location: string; websiteUrl: string; expertiseTopics: string[]; allowAchievementDrafts: boolean }
      if (input.expectedUserRevision !== userRevision || input.expectedProfileRevision !== profileRevision) throw new Error('资料已更新，请重新读取')
      const fields = [input.displayName, input.bio, input.headline, input.location, ...input.expertiseTopics]
      if (!input.displayName?.trim() || input.displayName.length > 40 || input.bio.length > 500 || input.headline.length > 120 || input.location.length > 60 || input.expertiseTopics.length > 10 || input.expertiseTopics.some((topic) => topic.length > 40) || fields.some((text) => /[\p{Cc}<>]/u.test(text))) throw new Error('资料包含不允许的字符')
      if (input.websiteUrl) {
        try { if (!['http:', 'https:'].includes(new URL(input.websiteUrl).protocol)) throw new Error() } catch { throw new Error('个人网站需要完整的 http 或 https 地址') }
      }
      const normalizedTopics = input.expertiseTopics.map((topic) => topic.trim()).filter(Boolean)
      if (new Set(normalizedTopics).size !== normalizedTopics.length) throw new Error('擅长话题不能重复')
      saveMockProfile({ displayName: input.displayName.trim(), bio: input.bio.trim(), headline: input.headline.trim(), location: input.location.trim(), websiteUrl: input.websiteUrl.trim(), expertiseTopics: normalizedTopics })
      allowAchievementDrafts = !!input.allowAchievementDrafts; userRevision++
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
        const rows = comments.filter((comment) => comment.author.id === id && !comment.deleted && (comment.status || 'published') === 'published' && visible().some((post) => post.id === comment.postId)).sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id))
        value = { posts: [], replies: rows.slice(offset, offset + limit).map((comment) => { const post = posts.find((row) => row.id === comment.postId)!; return { id: comment.id, postId: comment.postId, postTitle: post.title, bodyPreview: comment.body.slice(0, 320), likes: comment.likes, accepted: comment.accepted, createdAt: comment.createdAt } }), nextCursor: rows.length > offset + limit ? String(offset + limit) : null }
      } else {
        const rows = visible().filter((post) => (tab === 'liked' ? post.viewerState.liked : post.author.id === id) && (tab !== 'media' || post.contentBlocks.some((block) => block.type === 'image')) && (tab !== 'posts' || post.id !== profile.pinnedPost?.id)).sort((a, b) => b.publishedAt.localeCompare(a.publishedAt) || b.id.localeCompare(a.id))
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
    else if (action === 'posts' || action === 'answers') value = visible().filter((p) => action === 'posts' ? p.author.id === id : comments.some((c) => c.postId === p.id && c.author.id === id && !c.deleted && (c.status || 'published') === 'published'))
    else value = profileFor(id)
  } else if (root === 'questions') { const post = requirePost(id); requireOwner(post.author.id); if (!comments.some((c) => c.id === fourth && c.postId === id && !c.deleted && (c.status || 'published') === 'published')) throw new Error('回答不可用'); if (post.question) { post.question.status = 'solved'; post.question.acceptedCommentId = fourth; comments.forEach((c) => { if (c.postId === id) c.accepted = c.id === fourth }) }; value = post }
  else if (root === 'comments') {
    const comment = comments.find((c) => c.id === id)
    if (!comment || muted.has(comment.author.id)) throw new Error('评论不存在')
    const post = requirePost(comment.postId)
    if (action && ((comment.status || 'published') !== 'published' || !['published', 'limited'].includes(post.status))) throw new Error('待审评论不能进行公开互动')
    if (action === 'report') return mockCommunity<T>('/governance/reports', 'POST', { ...body as object, targetType: 'comment', targetId: id, category: 'other' })
    if (!action) requireOwner(comment.author.id)
    if (action === 'like') { comment.liked = method === 'PUT'; comment.likes = comment.liked ? 1 : 0 }
    else if (method === 'DELETE') { if (!comment.deleted && (comment.status || 'published') === 'published') post.stats.comments--; comment.deleted = true; comment.body = '该评论已删除'; comment.contentBlocks = []; comment.accepted = false; if (post.question?.acceptedCommentId === id) { post.question.acceptedCommentId = null; post.question.status = 'open' } }
    else if (method === 'PATCH') {
      const input = body as { contentBlocks: CommunityContentBlock[]; expectedRevision?: number }
      if (input.expectedRevision !== comment.revision) throw new Error('评论已有新修订，请刷新后再编辑')
      if (!['published', 'limited'].includes(post.status) || comment.deleted) throw new Error('评论当前不可编辑')
      const detection = checkMockContent({ commentBody: text(input.contentBlocks), mediaCaption: postDetectionInput('', '', input.contentBlocks).mediaCaption })
      const wasPublished = (comment.status || 'published') === 'published'
      comment.contentBlocks = input.contentBlocks; comment.body = text(input.contentBlocks); comment.detection = detection
      comment.status = detection.action === 'review' ? 'pending_review' : 'published'; comment.revision = (comment.revision || 1) + 1
      post.stats.comments += Number(comment.status === 'published') - Number(wasPublished)
      if (comment.status === 'pending_review') { comment.accepted = false; if (post.question?.acceptedCommentId === id) { post.question.acceptedCommentId = null; post.question.status = 'open' } }
    }
    value = comment
  } else if (root === 'posts') {
    const post = id ? requirePost(id) : undefined
    if (post && ['comments', 'reactions', 'bookmark'].includes(action) && !['published', 'limited'].includes(post.status)) throw new Error('待审内容或草稿不能进行公开互动')
    if (action === 'quotes') value = visible().filter((row) => row.status === 'published' && row.quotedPostId === id)
    else if (action === 'comments') {
      if (method === 'POST') {
        const input = body as { contentBlocks: CommunityContentBlock[]; parentId?: string }
        if (post!.status === 'draft') throw new Error('草稿不能评论')
        if (input.parentId && !comments.some((c) => c.id === input.parentId && c.postId === id && !c.parentId && !c.deleted && (c.status || 'published') === 'published')) throw new Error('仅支持两级公开评论')
        const detection = checkMockContent({ commentBody: text(input.contentBlocks), mediaCaption: postDetectionInput('', '', input.contentBlocks).mediaCaption })
        const comment: CommunityCommentDto = { id: randomId(), revision: 1, status: detection.action === 'review' ? 'pending_review' : 'published', detection, postId: id, author: authors[0], parentId: input.parentId || null, rootId: input.parentId || null, body: text(input.contentBlocks), contentBlocks: input.contentBlocks, deleted: false, likes: 0, liked: false, accepted: false, createdAt: new Date().toISOString() }
        comments.push(comment); if (comment.status === 'published') post!.stats.comments++; value = comment
      } else {
        const readable = (c: CommunityCommentDto) => c.status !== 'pending_review' || c.author.id === authors[0].id
        const all = comments.filter((c) => c.postId === id)
        const candidates = all.filter((c) => readable(c) || !c.parentId && all.some((reply) => reply.parentId === c.id && readable(reply)))
        const parentId = url.searchParams.get('parentId') || null, cursorId = url.searchParams.get('cursor')
        const limit = Math.min(50, Math.max(1, Number(url.searchParams.get('limit')) || 25))
        if (parentId && !all.some((c) => c.id === parentId && !c.parentId)) throw new Error('一级评论不存在')
        const cursor = cursorId ? all.find((c) => c.id === cursorId) : null
        if (cursorId && (!cursor || cursor.parentId !== parentId)) throw new Error('评论游标不属于当前讨论')
        const compare = (a: CommunityCommentDto, b: CommunityCommentDto) => a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0
        const rows = candidates.filter((c) => fourth ? c.id === fourth : c.parentId === parentId && (!cursor || compare(c, cursor) > 0)).sort(compare)
        const items = rows.slice(0, fourth ? 1 : limit).map((c) => {
          const deleted = c.deleted || muted.has(c.author.id) || (c.status || 'published') !== 'published' && !(c.status === 'pending_review' && c.author.id === authors[0].id)
          return { ...c, ...(deleted ? { author: { id: '', username: '', displayName: '不可见用户', avatar: null, school: null, major: null, verifiedType: 'none', badges: [] }, body: '该评论已删除或不可见', contentBlocks: [], deleted: true, detection: undefined, likes: 0, liked: false, accepted: false } : {}), replyCount: all.filter((reply) => reply.parentId === c.id && readable(reply)).length }
        })
        if (fourth && !items.length) throw new Error('评论不存在或不可见')
        value = fourth ? items[0] : { items, nextCursor: rows.length > limit ? items.at(-1)!.id : null }
      }
    } else if (action === 'pin') {
      requireOwner(post!.author.id)
      if (post!.status !== 'published' || post!.visibility !== 'public') throw new Error('只能置顶自己的公开动态')
      const input = body as { expectedProfileRevision: number }
      if (input.expectedProfileRevision !== profileRevision) throw new Error('资料已更新，请重新读取')
      saveMockProfile({}); pinnedPostId = post!.id; value = profileFor(authors[0].id)
    } else if (action === 'reactions' || action === 'bookmark') {
      const state = action === 'bookmark' ? 'bookmarked' : fourth === 'like' ? 'liked' : 'markedUseful'
      const stat = action === 'bookmark' ? 'bookmarks' : fourth === 'like' ? 'likes' : 'useful'
      const active = method === 'PUT'
      if (post!.viewerState[state] !== active) post!.stats[stat] += active ? 1 : -1
      post!.viewerState[state] = active; value = { active }
    } else if (action === 'hide' || action === 'not-interested') { visible().filter((p) => action === 'hide' ? p.id === id : p.type === post!.type).forEach((p) => hidden.add(p.id)); value = {} }
    else if (action === 'report') return mockCommunity<T>('/governance/reports', 'POST', { ...body as object, targetType: 'post', targetId: id, category: 'other' })
    else if (action === 'unpublish') {
      requireOwner(post!.author.id)
      if (post!.status !== 'published') throw new Error('只有已发布动态可以下架')
      post!.status = 'draft'
      if (pinnedPostId === post!.id) pinnedPostId = null
      value = { unpublished: true }
    }
    else if (method === 'DELETE') { requireOwner(post!.author.id); posts = posts.filter((p) => p.id !== id); value = { deleted: true } }
    else if (method === 'POST' || method === 'PATCH') {
      const input = body as CommunityPostInput, now = new Date().toISOString()
      if (post) requireOwner(post.author.id)
      if (post && input.expectedRevision !== post.revision) throw new Error('动态已有新修订，请刷新后再编辑')
      const savedId = id || randomId()
      const contribution = input.contribution ? {
        ...post?.contribution,
        ...input.contribution,
        postId: savedId,
        category: demoResourceHubCategories.find((category) => category.id === input.contribution?.categoryId) || null,
        coverUrl: input.contribution.coverFileId ? mockCoverUrl(input.contribution.coverFileId) : post?.contribution?.coverFileId ? null : post?.contribution?.coverUrl || null,
        featured: post?.contribution?.featured || false,
        liveReplay: post?.contribution?.liveReplay || false,
        revision: (post?.contribution?.revision || 0) + 1,
        video: input.contribution.kind === 'video' ? post?.contribution?.video || {
          id: input.contribution.videoAssetId!,
          status: 'ready' as const,
          originalName: '本地演示视频.mp4',
          originalMimeType: 'video/mp4',
          durationSeconds: 60,
          width: 1280,
          height: 720,
          rotation: 0,
          attempts: 1,
          lastError: null,
          posterUrl: null,
          createdAt: now,
          updatedAt: now,
        } : null,
        attachment: input.contribution.kind === 'document' ? post?.contribution?.attachment || { id: input.contribution.attachmentFileId!, name: '本地演示资料.pdf', size: 120000, mimeType: 'application/pdf' } : null,
      } : post?.contribution
      const detection = input.status === 'published' ? checkMockContent(postDetectionInput(input.title, text(input.contentBlocks), input.contentBlocks, contribution)) : undefined
      const saved: CommunityPostDetailDto = { ...structuredClone(initialPosts[0]), id: savedId, revision: (post?.revision || 0) + 1, type: input.type, status: detection?.action === 'review' ? 'pending_review' : input.status, detection, visibility: input.visibility, portalConsent: input.portalConsent === true && input.visibility === 'public', title: input.title || null, coverFileId: input.coverFileId === undefined ? post?.coverFileId || null : input.coverFileId, body: text(input.contentBlocks), bodyPreview: text(input.contentBlocks).slice(0, 320), contentBlocks: input.contentBlocks, author: authors[0], topics: topics.filter((t) => input.topicIds.includes(t.id)), stats: post?.stats || { views: 0, likes: 0, comments: 0, bookmarks: 0, useful: 0 }, viewerState: post?.viewerState || { liked: false, markedUseful: false, bookmarked: false, followingAuthor: false }, question: input.type === 'question' ? post?.question || { status: 'open', acceptedCommentId: null, teacherAnswered: false } : null, bindings: await Promise.all(input.bindings.map(async (binding) => (await mockCommunity<{ binding: CommunityPostDetailDto['bindings'][number] }>(`/bindings/context?${new URLSearchParams({ type: binding.type, id: binding.id })}`, 'GET')).binding)), contribution, publishedAt: post?.publishedAt || now, editedAt: id ? now : null }
      const relations = mockPostRelations(saved, input, post)
      Object.assign(saved, relations)
      if (saved.status === 'published') publishedIds.add(saved.id)
      posts = [saved, ...posts.filter((p) => p.id !== saved.id)]; value = saved
    } else value = id ? post : visible().filter((p) => (!url.searchParams.get('keyword') || `${p.title} ${p.body}`.includes(url.searchParams.get('keyword')!)) && (!url.searchParams.get('bindingId') || p.bindings.some((b) => b.id === url.searchParams.get('bindingId'))))
  }
  if (value === undefined) throw new Error('演示数据中没有此内容')
  if (method !== 'GET' && typeof localStorage !== 'undefined') persist()
  return JSON.parse(JSON.stringify(value, (_key, row) => row && row.stats && Array.isArray(row.contentBlocks) && row.author ? mockPostProjection(row) : row)) as T
}
