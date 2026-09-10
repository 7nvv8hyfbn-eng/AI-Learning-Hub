import { demoResourceHubCategories, demoResourceHubContributions } from '@ai-learning-hub/demo-fixtures'
import type { CommunityAuthorDto, ResourceHubCreatorDto, CommunityPostDetailDto, LearningCollectionDto, LearningCollectionSummaryDto, ResourceContributionDetailDto, ResourceHubHomeDto, ResourceHubItemDto, ResourceHubListDto, VideoAssetDto, VideoPlaybackDto } from '@ai-learning-hub/contracts'
import { assertMockCommunityWrite, checkMockContent, mockCommunity, mockResourceActivity, mockResourceContributionPosts, recordMockResourceActivity } from './community.mock'
import { randomId } from './random-id'
import { mockCoverUrl } from './community-images.mock'
import type { CollectionPageQuery, CreatorContentSection, CreatorContentSummaryDto, ResourceHubPageDto } from '@ai-learning-hub/contracts'

const collectionsKey = 'ai-learning-resource-hub:collections-v1'
const progressKey = 'ai-learning-resource-hub:progress-v1'
const student: CommunityAuthorDto = { id: 'student', username: 'student', displayName: '造梦少年', verifiedType: 'none', badges: [], avatar: null, school: 'AI 创客学院', major: '计算机科学与技术' }
const category = (code: string) => demoResourceHubCategories.find((item) => item.code === code) || null
const uploadedVideos = new Map<string, { url: string; asset: VideoAssetDto }>()
const uploadedDocuments = new Map<string, { url: string; name: string; mimeType: string; size: number }>()
export const resetResourceHubMock = () => {
  for (const url of [...[...uploadedVideos.values()].map((video) => video.url), ...[...uploadedDocuments.values()].map((file) => file.url)]) URL.revokeObjectURL(url)
  uploadedVideos.clear()
  uploadedDocuments.clear()
  if (typeof localStorage !== 'undefined') {
    localStorage.removeItem(collectionsKey)
    localStorage.removeItem(progressKey)
  }
}
const item = (post: CommunityPostDetailDto, asOf = Date.now()): ResourceHubItemDto => {
  const contribution = post.contribution!
  const fixture = demoResourceHubContributions.find((row) => row.id === post.id)
  const events = mockResourceActivity.filter((event) => event.targetId === post.id && event.createdAt <= asOf)
  const views = (fixture?.views || 0) + events.filter((event) => event.eventType === (contribution.kind === 'video' ? 'resource_valid_watch' : 'community_post_click')).length
  return {
  sourceType: 'contribution',
  id: post.id,
  postId: post.id,
  title: post.title || '未命名资源',
  summary: post.bodyPreview,
  kind: contribution.kind,
  category: contribution.category,
  tags: contribution.tags,
  coverUrl: mockCoverUrl(contribution.coverFileId) || contribution.video?.posterUrl || fixture?.coverUrl || mockCoverUrl(post.contentBlocks.find((block) => block.type === 'image')?.fileId) || contribution.coverUrl,
  author: post.author,
  stats: { views, plays: contribution.kind === 'video' ? views : null, impressions: events.filter((event) => event.eventType === 'impression').length, likes: post.stats.likes, comments: post.stats.comments, bookmarks: post.stats.bookmarks, downloads: 0 },
  durationSeconds: contribution.video?.durationSeconds || null,
  videoAssetId: contribution.video?.id || contribution.videoAssetId || null,
  mediaStatus: contribution.video?.status || null,
  publishedAt: post.publishedAt,
  route: contribution.kind === 'video' ? `/resources/watch/${post.id}` : `/resources/read/${post.id}`,
  featured: contribution.featured,
  liveReplay: contribution.liveReplay,
  }
}
const all = () => mockResourceContributionPosts().map((post) => item(post))

const encodeCursor = (value: unknown) => btoa(String.fromCharCode(...new TextEncoder().encode(JSON.stringify(value))))
const decodeCursor = (value: string) => JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(value), (character) => character.charCodeAt(0))))
const descending = (a: string, b: string) => a < b ? 1 : a > b ? -1 : 0
const pageItems = (posts: CommunityPostDetailDto[], url: URL, authorId = ''): ResourceHubListDto => {
  const keyword = (url.searchParams.get('keyword') || '').trim().toLowerCase(), kind = url.searchParams.get('kind') || 'all', categoryCode = url.searchParams.get('category') || ''
  const popular = url.searchParams.get('sort') === 'popular', filter = JSON.stringify([keyword, kind, categoryCode, popular, authorId])
  const limit = Math.min(48, Math.max(1, Number(url.searchParams.get('limit')) || 18))
  const raw = url.searchParams.get('cursor')
  let cursor: { item: ResourceHubItemDto; filter: string; asOf: string } | undefined
  if (raw) {
    try { cursor = decodeCursor(raw); if (!cursor || cursor.filter !== filter || !cursor.item || !Number.isFinite(Date.parse(cursor.asOf))) throw new Error() }
    catch { throw new Error('分页条件已变化或游标无效，请重新读取第一页') }
  }
  const asOf = cursor?.asOf || new Date().toISOString()
  const entries = posts.map((post) => item(post, Date.parse(asOf)))
  const order = (a: ResourceHubItemDto, b: ResourceHubItemDto) => (popular ? b.stats.views - a.stats.views : 0) || descending(a.publishedAt, b.publishedAt) || descending(a.id, b.id) || descending(a.sourceType, b.sourceType)
  const rows = entries.filter((entry) => entry.publishedAt <= asOf && (!authorId || entry.author?.id === authorId) && (!keyword || [entry.title, entry.summary, entry.author?.displayName || '', ...entry.tags].some((text) => text.toLowerCase().includes(keyword))) && (kind === 'all' || entry.kind === kind) && (!categoryCode || entry.category?.code === categoryCode) && (!cursor || order(entry, cursor.item) > 0)).sort(order)
  const items = rows.slice(0, limit), last = items.at(-1)
  return { items, nextCursor: rows.length > limit && last ? encodeCursor({ item: { id: last.id, sourceType: last.sourceType, publishedAt: last.publishedAt, stats: { views: last.stats.views } }, filter, asOf }) : null }
}

type StoredCollection = Omit<LearningCollectionDto, 'items' | 'nextCursor' | 'previousCursor'> & { postIds: string[] }
const readCollections = (): StoredCollection[] => {
  const fallback: StoredCollection[] = [
    { id: 'demo-collection-agent', name: 'Agent 入门播放列表', description: '从工具调用到多智能体协作', visibility: 'community', systemKind: null, learningGoal: '按顺序完成四个 Agent 实践', itemCount: 4, videoCount: 3, durationSeconds: 4340, owner: student, isOwner: true, revision: 1, updatedAt: '2026-08-29T12:00:00.000Z', postIds: ['resource-demo-first-agent', 'resource-demo-function', 'resource-demo-memory', 'resource-demo-multi-agent'] },
  ]
  try { return JSON.parse(localStorage.getItem(collectionsKey) || 'null') || fallback } catch { return fallback }
}
const saveCollections = (value: StoredCollection[], changed: StoredCollection) => {
  changed.detection = changed.visibility === 'community' ? checkMockContent({ collectionName: changed.name, collectionDescription: changed.description, collectionGoal: changed.learningGoal }) : undefined
  changed.contentStatus = changed.detection?.action === 'review' ? 'pending_review' : 'published'
  localStorage.setItem(collectionsKey, JSON.stringify(value))
}
const summary = ({ postIds, ...value }: StoredCollection): LearningCollectionSummaryDto => {
  const entries = all().filter((entry) => postIds.includes(entry.postId || ''))
  return { ...value, itemCount: entries.length, videoCount: entries.filter((entry) => entry.kind === 'video').length, durationSeconds: entries.reduce((sum, entry) => sum + (entry.durationSeconds || 0), 0) }
}
const detail = (value: StoredCollection, query: CollectionPageQuery & { limit?: number } = {}, focusPostId?: string): LearningCollectionDto => {
  const entries = new Map(all().map((entry) => [entry.postId, entry]))
  const complete = value.postIds.flatMap((postId, sortOrder) => entries.has(postId) ? [{ id: `${value.id}-${postId}`, sortOrder, contribution: entries.get(postId)! }] : [])
  const anchor = query.cursor ? value.postIds.findIndex((postId) => `${value.id}-${postId}` === query.cursor) : -1
  if (query.cursor && anchor < 0) throw new Error('合集条目游标无效')
  const focus = !query.cursor && focusPostId ? complete.find((entry) => entry.contribution.postId === focusPostId)?.sortOrder : undefined
  const before = !!query.cursor && query.direction === 'before', limit = Math.min(48, Math.max(1, query.limit || 18))
  const candidates = complete.filter((entry) => query.cursor ? before ? entry.sortOrder < anchor : entry.sortOrder > anchor : focus === undefined || entry.sortOrder >= focus)
  if (before) candidates.reverse()
  const items = candidates.slice(0, limit)
  if (before) items.reverse()
  const hasPrevious = before ? candidates.length > limit : query.cursor ? true : focus !== undefined && complete.some((entry) => entry.sortOrder < focus)
  return { ...summary(value), items, nextCursor: (before || candidates.length > limit) && items.length ? items.at(-1)!.id : null, previousCursor: hasPrevious && items.length ? items[0].id : null }
}
const watchLater = () => {
  const rows = readCollections()
  let value = rows.find((row) => row.systemKind === 'watch_later')
  if (!value) {
    value = { id: 'demo-watch-later', name: '稍后再看', description: '仅自己可见', visibility: 'private', systemKind: 'watch_later', learningGoal: '', itemCount: 0, videoCount: 0, durationSeconds: 0, owner: student, isOwner: true, revision: 1, updatedAt: new Date().toISOString(), postIds: [] }
    rows.unshift(value); saveCollections(rows, value)
  }
  return value
}

export async function mockResourceHub<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
  const url = new URL(path, 'http://mock.invalid')
  const parts = url.pathname.split('/').filter(Boolean)
  let value: unknown
  if (parts[0] === 'home') {
    const entries = all(), collections = (await mockResourceHub<ResourceHubPageDto<LearningCollectionSummaryDto>>('/collections?limit=4')).items
    value = {
      banners: entries.filter((entry) => entry.featured).slice(0, 3).map((entry) => {
        const bannerUrl = demoResourceHubContributions.find((row) => row.id === entry.id)?.bannerUrl
        return bannerUrl ? { ...entry, coverUrl: bannerUrl } : entry
      }),
      categories: demoResourceHubCategories.map((entry) => ({ ...entry })),
      featured: entries.filter((entry) => entry.featured).slice(0, 2),
      sections: ['ai-foundation', 'lab-demo', 'model-deployment', 'agent-practice'].map((code) => ({ key: code, title: category(code)!.name, categoryCode: code, items: entries.filter((entry) => entry.category?.code === code).slice(0, 6) })),
      rankings: Object.fromEntries([['week', 7], ['month', 30], ['all', Infinity]].map(([key, days]) => [key, entries.map((entry) => ({ ...entry, rankingViews: key === 'all' ? entry.stats.views : mockResourceActivity.filter((event) => event.targetId === entry.id && event.eventType === (entry.kind === 'video' ? 'resource_valid_watch' : 'community_post_click') && event.createdAt >= Date.now() - Number(days) * 86400000 && event.createdAt <= Date.now()).length })).sort((a, b) => b.rankingViews - a.rankingViews || descending(a.publishedAt, b.publishedAt) || descending(a.id, b.id)).slice(0, 5)])) as ResourceHubHomeDto['rankings'],
      collections,
      likedVideos: entries.filter((entry) => entry.kind === 'video').slice(4, 8),
      liveReplay: entries.filter((entry) => entry.liveReplay).slice(0, 4),
    } satisfies ResourceHubHomeDto
  } else if (parts[0] === 'capacity') {
    const quotaBytes = 10 * 1024 ** 3
    value = { driver: 'mock', usedBytes: 0, reservedBytes: 0, temporaryReservedBytes: 0, quotaBytes, remainingBytes: quotaBytes, activeUploads: 0, parallelUploadLimit: 2, queuedTasks: 0, queueLimit: 3, site: { usedBytes: 0, reservedBytes: 0, temporaryReservedBytes: 0, capacityBytes: quotaBytes, availableBytes: quotaBytes, temporaryFreeBytes: quotaBytes, minimumFreeBytes: 2 * 1024 ** 3, activeUploads: 0, queuedTasks: 0 }, unavailableReason: 'Mock演示容量，不代表实际存储或扫描结果' }
  } else if (parts[0] === 'categories') value = demoResourceHubCategories
  else if (parts[0] === 'items') {
    value = pageItems(mockResourceContributionPosts(), url, url.searchParams.get('authorId') || '')
  } else if (parts[0] === 'studio') {
    const posts = mockResourceContributionPosts(true).filter((post) => post.author.id === student.id)
    const groups = { items: posts.filter((post) => post.status === 'published'), drafts: posts.filter((post) => post.status === 'draft'), pendingReview: posts.filter((post) => post.status === 'pending_review'), processing: posts.filter((post) => ['uploaded', 'processing', 'failed'].includes(post.contribution?.video?.status || '')) }
    const pages: Record<CreatorContentSection, typeof posts> = { items: [], drafts: [], pendingReview: [], processing: [] }
    const nextCursors: CreatorContentSummaryDto['nextCursors'] = { items: null, drafts: null, pendingReview: null, processing: null }
    const requested = url.searchParams.get('section') as CreatorContentSection | null, raw = url.searchParams.get('cursor')
    if (requested && !Object.hasOwn(pages, requested) || raw && !requested) throw new Error('工作室翻页需要指定内容分组')
    const limit = Math.min(48, Math.max(1, Number(url.searchParams.get('limit')) || 18)), at = (post: CommunityPostDetailDto) => post.editedAt || post.publishedAt
    for (const section of (requested ? [requested] : Object.keys(groups)) as CreatorContentSection[]) {
      const scope = `studio:${student.id}:${section}`, cursor = raw ? decodeCursor(raw) as { id: string; at: string; scope: string } : null
      if (cursor && cursor.scope !== scope) throw new Error('工作室游标无效')
      const rows = groups[section].filter((post) => !cursor || at(post) < cursor.at || at(post) === cursor.at && post.id < cursor.id).sort((a, b) => descending(at(a), at(b)) || descending(a.id, b.id))
      pages[section] = rows.slice(0, limit)
      if (rows.length > limit) { const last = pages[section].at(-1)!; nextCursors[section] = encodeCursor({ id: last.id, at: at(last), scope }) }
    }
    value = { items: pages.items.map((post) => item(post)), drafts: pages.drafts, pendingReview: pages.pendingReview, processing: pages.processing.map((post) => item(post)), nextCursors, counts: Object.fromEntries(Object.entries(groups).map(([key, rows]) => [key, rows.length])) as CreatorContentSummaryDto['counts'] } satisfies CreatorContentSummaryDto
  } else if (parts[0] === 'creators') {
    const scope = `collections:${student.id}:${parts[1]}`, raw = url.searchParams.get('collectionsCursor')
    const cursor = raw ? decodeCursor(raw) as { id: string; at: string; scope: string } : null
    if (cursor && cursor.scope !== scope) throw new Error('合集游标不属于当前作者')
    const collections = readCollections().filter((entry) => entry.owner.id === parts[1] && (parts[1] === student.id || entry.visibility === 'community' && (entry.contentStatus || 'published') === 'published') && (!cursor || entry.updatedAt < cursor.at || entry.updatedAt === cursor.at && entry.id < cursor.id)).sort((a, b) => descending(a.updatedAt, b.updatedAt) || descending(a.id, b.id))
    value = { ...pageItems(mockResourceContributionPosts(), url, parts[1]), collections: collections.slice(0, 18).map(summary), collectionsNextCursor: collections.length > 18 ? encodeCursor({ id: collections[17].id, at: collections[17].updatedAt, scope }) : null } satisfies ResourceHubCreatorDto
  } else if (parts[0] === 'contributions') {
    const post = await mockCommunity<ResourceContributionDetailDto['post']>(`/posts/${parts[1]}`, 'GET')
    if (!post.contribution) throw new Error('资源作品不存在')
    const entry = item(post)
    const uploaded = post.contribution?.attachmentFileId ? uploadedDocuments.get(post.contribution.attachmentFileId) : undefined
    const contribution = uploaded && post.contribution?.attachment
      ? { ...post.contribution, attachment: { ...post.contribution.attachment, name: uploaded.name, size: uploaded.size, mimeType: uploaded.mimeType, downloadUrl: uploaded.url } }
      : { ...post.contribution! }
    contribution.coverUrl = entry.coverUrl
    if (contribution.video) contribution.video = { ...contribution.video, posterUrl: entry.coverUrl }
    const collection = readCollections().find((row) => row.postIds.includes(post.id) && (row.owner.id === student.id || row.visibility === 'community' && (row.contentStatus || 'published') === 'published'))
    value = { post: { ...post, contribution }, contribution, stats: entry.stats, collection: collection ? detail(collection, {}, post.id) : null, related: all().filter((candidate) => candidate.id !== entry.id && candidate.category?.code === entry.category?.code).slice(0, 6) } satisfies ResourceContributionDetailDto
  } else if (parts[0] === 'videos' && parts.length === 2) {
    const fixture = demoResourceHubContributions.find((candidate) => `video-${candidate.id}` === parts[1])
    const uploaded = uploadedVideos.get(parts[1])
    if (!fixture && !uploaded) throw new Error('视频不存在')
    const now = fixture?.publishedAt || new Date().toISOString()
    value = uploaded?.asset || {
      id: parts[1],
      status: 'ready',
      originalName: `${fixture!.title}.mp4`,
      originalMimeType: 'video/mp4',
      durationSeconds: fixture!.durationSeconds ?? null,
      width: 1280,
      height: 720,
      rotation: 0,
      attempts: 1,
      lastError: null,
      posterUrl: fixture!.coverUrl,
      createdAt: now,
      updatedAt: now,
    } satisfies VideoAssetDto
  } else if (parts[0] === 'videos' && parts[2] === 'playback') {
    const post = mockResourceContributionPosts(true).find((post) => (post.contribution?.video?.id || post.contribution?.videoAssetId) === parts[1])
    if (!post) throw new Error('视频不存在或不可见')
    const entry = demoResourceHubContributions.find((candidate) => `video-${candidate.id}` === parts[1])
    const uploaded = uploadedVideos.get(parts[1])
    if (!entry && !uploaded) throw new Error('视频不存在')
    let progress = null
    try { progress = JSON.parse(localStorage.getItem(progressKey) || '{}')[parts[1]] || null } catch { /* 使用空进度。 */ }
    value = { assetId: parts[1], sources: [{ src: entry?.videoUrl || uploaded!.url, type: 'video/mp4' }], poster: item(post).coverUrl, durationSeconds: entry?.durationSeconds || 60, expiresAt: new Date(Date.now() + 21600000).toISOString(), captions: [], chapters: [], progress } satisfies VideoPlaybackDto
  } else if (parts[0] === 'videos' && parts[2] === 'progress') {
    const post = mockResourceContributionPosts().find((post) => (post.contribution?.video?.id || post.contribution?.videoAssetId) === parts[1])
    if (!post) throw new Error('待审预览不能计入学习进度')
    const input = body as { positionSeconds: number; watchedSeconds: number; completed: boolean }
    let state: Record<string, typeof input> = {}
    try { state = JSON.parse(localStorage.getItem(progressKey) || '{}') } catch { /* 重建演示进度。 */ }
    const duration = post.contribution?.video?.durationSeconds || 60
    if (input.positionSeconds > duration + 5 || input.watchedSeconds > duration + 5) throw new Error('观看进度超出视频时长')
    const current = state[parts[1]], watchedSeconds = Math.max(current?.watchedSeconds || 0, input.watchedSeconds)
    value = state[parts[1]] = { positionSeconds: input.positionSeconds, watchedSeconds, completed: !!current?.completed || input.completed && input.positionSeconds >= duration * 0.9 }
    localStorage.setItem(progressKey, JSON.stringify(state))
    if (watchedSeconds >= Math.min(30, duration * 0.1)) recordMockResourceActivity(post.id, 'resource_valid_watch', `watch:${parts[1]}:${Math.floor(Date.now() / 21600000)}`)
  } else if (parts[0] === 'uploads' && parts[1] === 'video') {
    assertMockCommunityWrite()
    const file = body as File
    const now = new Date().toISOString()
    const id = `demo-upload-${randomId()}`
    const asset = { id, status: 'ready', originalName: file.name, originalMimeType: file.type || 'video/mp4', durationSeconds: null, width: null, height: null, rotation: 0, attempts: 1, lastError: null, posterUrl: null, createdAt: now, updatedAt: now } satisfies VideoAssetDto
    uploadedVideos.set(id, { url: URL.createObjectURL(file), asset })
    value = asset
  } else if (parts[0] === 'uploads' && parts[1] === 'document') {
    assertMockCommunityWrite()
    const file = body as File
    const id = `demo-file-${randomId()}`
    uploadedDocuments.set(id, { url: URL.createObjectURL(file), name: file.name, mimeType: file.type || 'application/octet-stream', size: file.size })
    value = { id, originalName: file.name, mimeType: file.type, size: file.size, checksum: 'demo', securityScan: { status: 'unavailable', message: 'Mock未执行恶意文件扫描', scannedAt: null, quarantined: false } }
  } else if (parts[0] === 'collections') {
    const rows = readCollections()
    if (!parts[1] && method === 'GET') {
      const ordered = rows.filter((entry) => entry.owner.id === student.id).sort((a, b) => (a.systemKind === b.systemKind ? 0 : a.systemKind === null ? -1 : b.systemKind === null ? 1 : descending(a.systemKind, b.systemKind)) || descending(a.updatedAt, b.updatedAt) || descending(a.id, b.id))
      const cursor = url.searchParams.get('cursor'), index = cursor ? ordered.findIndex((entry) => entry.id === cursor) : -1
      if (cursor && index < 0) throw new Error('合集游标无效')
      const limit = Math.min(48, Math.max(1, Number(url.searchParams.get('limit')) || 18)), page = ordered.slice(index + 1, index + 1 + limit)
      value = { items: page.map(summary), nextCursor: ordered.length > index + 1 + limit ? page.at(-1)!.id : null }
    }
    else if (!parts[1] && method === 'POST') {
      const input = body as { name: string; description: string; visibility: 'private' | 'community'; learningGoal?: string }
      if (input.visibility === 'community') assertMockCommunityWrite()
      const created: StoredCollection = { id: `demo-collection-${randomId()}`, ...input, learningGoal: input.learningGoal || '', systemKind: null, itemCount: 0, videoCount: 0, durationSeconds: 0, owner: student, isOwner: true, revision: 1, updatedAt: new Date().toISOString(), postIds: [] }
      rows.push(created); saveCollections(rows, created); value = detail(created)
    } else {
      const target = parts[1] === 'watch-later' ? watchLater() : readCollections().find((row) => row.id === parts[1])
      if (!target || target.owner.id !== student.id && (target.visibility !== 'community' || (target.contentStatus || 'published') !== 'published')) throw new Error('合集不存在')
      if (method !== 'GET' && target.owner.id !== student.id) throw new Error('只能修改自己的合集')
      if (parts[2] === 'items' && method === 'POST') {
        if (target.visibility === 'community') assertMockCommunityWrite()
        const postId = (body as { postId: string }).postId
        if (!target.postIds.includes(postId)) target.postIds.push(postId)
        target.revision++; target.updatedAt = new Date().toISOString(); target.itemCount = target.postIds.length
        const entries = all().filter((entry) => target.postIds.includes(entry.postId || ''))
        target.videoCount = entries.filter((entry) => entry.kind === 'video').length
        target.durationSeconds = entries.reduce((total, entry) => total + (entry.durationSeconds || 0), 0)
        const next = readCollections().filter((row) => row.id !== target.id); next.push(target); saveCollections(next, target); value = detail(target)
      } else if (parts[2] === 'items' && parts[3] && method === 'DELETE') {
        if (target.visibility === 'community') assertMockCommunityWrite()
        target.postIds = target.postIds.filter((postId) => `${target.id}-${postId}` !== parts[3])
        target.revision++; target.updatedAt = new Date().toISOString(); target.itemCount = target.postIds.length
        const entries = all().filter((entry) => target.postIds.includes(entry.postId || ''))
        target.videoCount = entries.filter((entry) => entry.kind === 'video').length
        target.durationSeconds = entries.reduce((total, entry) => total + (entry.durationSeconds || 0), 0)
        const next = readCollections().filter((row) => row.id !== target.id); next.push(target); saveCollections(next, target); value = detail(target)
      } else if (parts[2] === 'order' && method === 'PUT') {
        if (target.visibility === 'community') assertMockCommunityWrite()
        const input = body as { expectedRevision: number; itemIds: string[] }
        if (input.expectedRevision !== target.revision) throw new Error('合集已变化，请刷新后重试')
        const ordered = input.itemIds.map((itemId) => target.postIds.find((postId) => `${target.id}-${postId}` === itemId))
        if (!ordered.length || ordered.some((postId) => !postId) || new Set(ordered).size !== ordered.length) throw new Error('合集排序项无效')
        const slots = target.postIds.flatMap((postId, index) => ordered.includes(postId) ? [index] : [])
        slots.forEach((slot, index) => { target.postIds[slot] = ordered[index]! })
        target.revision++; target.updatedAt = new Date().toISOString()
        const next = readCollections().filter((row) => row.id !== target.id); next.push(target); saveCollections(next, target); value = detail(target)
      } else if (method === 'PATCH') {
        const input = body as { name: string; description: string; visibility: 'private' | 'community'; learningGoal?: string; expectedRevision?: number }
        if (target.visibility === 'community' || input.visibility === 'community') assertMockCommunityWrite()
        if (input.expectedRevision !== target.revision || target.systemKind) throw new Error('合集已变化、不可编辑或不存在')
        Object.assign(target, { name: input.name, description: input.description, visibility: input.visibility, learningGoal: input.learningGoal || '', revision: target.revision + 1, updatedAt: new Date().toISOString() })
        const next = readCollections().filter((row) => row.id !== target.id); next.push(target); saveCollections(next, target); value = detail(target)
      } else value = detail(target, { cursor: url.searchParams.get('cursor') || '', direction: url.searchParams.get('direction') === 'before' ? 'before' : 'after', limit: Number(url.searchParams.get('limit')) || 18 })
    }
  }
  if (value === undefined) throw new Error('演示数据中没有此资源能力')
  return JSON.parse(JSON.stringify(value)) as T
}
