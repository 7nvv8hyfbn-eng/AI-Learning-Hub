import { demoResourceHubCategories, demoResourceHubContributions } from '@ai-learning-hub/demo-fixtures'
import type { CommunityAuthorDto, CommunityPostDetailDto, LearningCollectionDto, LearningCollectionSummaryDto, ResourceContributionDetailDto, ResourceHubHomeDto, ResourceHubItemDto, ResourceHubListDto, VideoAssetDto, VideoPlaybackDto } from '@ai-learning-hub/contracts'
import { mockCommunity, mockResourceContributionPosts } from './community.mock'
import { randomId } from './random-id'

const collectionsKey = 'ai-learning-resource-hub:collections-v1'
const progressKey = 'ai-learning-resource-hub:progress-v1'
const student: CommunityAuthorDto = { id: 'student', username: 'student', displayName: '造梦少年', verifiedType: 'none', avatar: null, school: 'AI 创客学院', major: '计算机科学与技术' }
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
const item = (post: CommunityPostDetailDto): ResourceHubItemDto => {
  const contribution = post.contribution!
  const fixture = demoResourceHubContributions.find((row) => row.id === post.id)
  return {
  sourceType: 'contribution',
  id: post.id,
  postId: post.id,
  title: post.title || '未命名资源',
  summary: post.bodyPreview,
  kind: contribution.kind,
  category: contribution.category,
  tags: contribution.tags,
  coverUrl: contribution.coverUrl,
  author: post.author,
  stats: { views: fixture?.views || 0, likes: post.stats.likes, comments: post.stats.comments, bookmarks: post.stats.bookmarks, downloads: 0 },
  durationSeconds: contribution.video?.durationSeconds || null,
  videoAssetId: contribution.video?.id || contribution.videoAssetId || null,
  mediaStatus: contribution.video?.status || null,
  publishedAt: post.publishedAt,
  route: contribution.kind === 'video' ? `/resources/watch/${post.id}` : `/resources/read/${post.id}`,
  featured: contribution.featured,
  liveReplay: contribution.liveReplay,
  }
}
const all = () => mockResourceContributionPosts().map(item)

type StoredCollection = Omit<LearningCollectionDto, 'items'> & { postIds: string[] }
const readCollections = (): StoredCollection[] => {
  const fallback: StoredCollection[] = [
    { id: 'demo-collection-agent', name: 'Agent 入门播放列表', description: '从工具调用到多智能体协作', visibility: 'community', systemKind: null, learningGoal: '按顺序完成四个 Agent 实践', itemCount: 4, videoCount: 3, durationSeconds: 4340, owner: student, isOwner: true, revision: 1, updatedAt: '2026-08-29T12:00:00.000Z', postIds: ['resource-demo-first-agent', 'resource-demo-function', 'resource-demo-memory', 'resource-demo-multi-agent'] },
  ]
  try { return JSON.parse(localStorage.getItem(collectionsKey) || 'null') || fallback } catch { return fallback }
}
const saveCollections = (value: StoredCollection[]) => localStorage.setItem(collectionsKey, JSON.stringify(value))
const summary = ({ postIds, ...value }: StoredCollection): LearningCollectionSummaryDto => {
  void postIds
  return value
}
const detail = (value: StoredCollection): LearningCollectionDto => ({
  ...summary(value),
  items: value.postIds.flatMap((postId, sortOrder) => {
    const contribution = all().find((entry) => entry.postId === postId)
    return contribution ? [{ id: `${value.id}-${postId}`, sortOrder, contribution }] : []
  }),
})
const watchLater = () => {
  const rows = readCollections()
  let value = rows.find((row) => row.systemKind === 'watch_later')
  if (!value) {
    value = { id: 'demo-watch-later', name: '稍后再看', description: '仅自己可见', visibility: 'private', systemKind: 'watch_later', learningGoal: '', itemCount: 0, videoCount: 0, durationSeconds: 0, owner: student, isOwner: true, revision: 1, updatedAt: new Date().toISOString(), postIds: [] }
    rows.unshift(value); saveCollections(rows)
  }
  return value
}

export async function mockResourceHub<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
  const url = new URL(path, 'http://mock.invalid')
  const parts = url.pathname.split('/').filter(Boolean)
  let value: unknown
  if (parts[0] === 'home') {
    const entries = all(), collections = readCollections().map(summary)
    value = {
      banners: entries.filter((entry) => entry.featured).slice(0, 3).map((entry) => {
        const bannerUrl = demoResourceHubContributions.find((row) => row.id === entry.id)?.bannerUrl
        return bannerUrl ? { ...entry, coverUrl: bannerUrl } : entry
      }),
      categories: demoResourceHubCategories.map((entry) => ({ ...entry })),
      categoryCounts: demoResourceHubCategories.reduce<Record<string, number>>((counts, entry) => ({ ...counts, [entry.code]: entries.filter((item) => item.category?.code === entry.code).length }), { all: entries.length }),
      featured: entries.filter((entry) => entry.featured).slice(0, 2),
      sections: ['ai-foundation', 'lab-demo', 'model-deployment', 'agent-practice'].map((code) => ({ key: code, title: category(code)!.name, categoryCode: code, items: entries.filter((entry) => entry.category?.code === code).slice(0, 6) })),
      rankings: { week: entries.slice(0, 5), month: [...entries].sort((a, b) => b.stats.likes - a.stats.likes).slice(0, 5), all: [...entries].sort((a, b) => b.stats.views - a.stats.views).slice(0, 5) },
      collections,
      likedVideos: entries.filter((entry) => entry.kind === 'video').slice(4, 8),
      liveReplay: entries.filter((entry) => entry.liveReplay),
    } satisfies ResourceHubHomeDto
  } else if (parts[0] === 'categories') value = demoResourceHubCategories
  else if (parts[0] === 'items') {
    const keyword = (url.searchParams.get('keyword') || '').toLowerCase(), kind = url.searchParams.get('kind') || 'all', categoryCode = url.searchParams.get('category') || ''
    const rows = all().filter((entry) => (!keyword || `${entry.title}${entry.summary}${entry.tags.join('')}`.toLowerCase().includes(keyword)) && (kind === 'all' || entry.kind === kind) && (!categoryCode || entry.category?.code === categoryCode))
    value = { items: rows, nextCursor: null } satisfies ResourceHubListDto
  } else if (parts[0] === 'studio') {
    const posts = mockResourceContributionPosts(true).filter((post) => post.author.id === student.id)
    const entries = posts.map(item)
    value = {
      items: entries.filter((entry) => posts.find((post) => post.id === entry.postId)?.status === 'published'),
      drafts: posts.filter((post) => post.status === 'draft'),
      processing: entries.filter((entry) => ['uploaded', 'processing', 'failed'].includes(entry.mediaStatus || '')),
    }
  } else if (parts[0] === 'creators') {
    value = { items: all().filter((entry) => entry.author?.id === parts[1]), collections: readCollections().filter((entry) => entry.owner.id === parts[1] && (parts[1] === student.id || entry.visibility === 'community')).map(summary) }
  } else if (parts[0] === 'contributions') {
    const post = await mockCommunity<ResourceContributionDetailDto['post']>(`/posts/${parts[1]}`, 'GET')
    if (!post.contribution) throw new Error('资源作品不存在')
    const entry = item(post)
    const uploaded = post.contribution?.attachmentFileId ? uploadedDocuments.get(post.contribution.attachmentFileId) : undefined
    const contribution = uploaded && post.contribution?.attachment
      ? { ...post.contribution, attachment: { ...post.contribution.attachment, name: uploaded.name, size: uploaded.size, mimeType: uploaded.mimeType, downloadUrl: uploaded.url } }
      : post.contribution!
    const collection = readCollections().find((row) => row.postIds.includes(post.id))
    value = { post: { ...post, contribution }, contribution, stats: entry.stats, collection: collection ? detail(collection) : null, related: all().filter((candidate) => candidate.id !== entry.id && candidate.category?.code === entry.category?.code).slice(0, 6) } satisfies ResourceContributionDetailDto
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
    const entry = demoResourceHubContributions.find((candidate) => `video-${candidate.id}` === parts[1])
    const uploaded = uploadedVideos.get(parts[1])
    if (!entry && !uploaded) throw new Error('视频不存在')
    let progress = null
    try { progress = JSON.parse(localStorage.getItem(progressKey) || '{}')[parts[1]] || null } catch { /* 使用空进度。 */ }
    value = { assetId: parts[1], sources: [{ src: entry?.videoUrl || uploaded!.url, type: 'video/mp4' }], poster: entry?.coverUrl || null, durationSeconds: entry?.durationSeconds || 60, expiresAt: new Date(Date.now() + 21600000).toISOString(), captions: [], chapters: [], progress } satisfies VideoPlaybackDto
  } else if (parts[0] === 'videos' && parts[2] === 'progress') {
    const input = body as { positionSeconds: number; watchedSeconds: number; completed: boolean }
    let state: Record<string, unknown> = {}
    try { state = JSON.parse(localStorage.getItem(progressKey) || '{}') } catch { /* 重建演示进度。 */ }
    state[parts[1]] = input; localStorage.setItem(progressKey, JSON.stringify(state)); value = input
  } else if (parts[0] === 'uploads' && parts[1] === 'video') {
    const file = body as File
    const now = new Date().toISOString()
    const id = `demo-upload-${randomId()}`
    const asset = { id, status: 'ready', originalName: file.name, originalMimeType: file.type || 'video/mp4', durationSeconds: null, width: null, height: null, rotation: 0, attempts: 1, lastError: null, posterUrl: null, createdAt: now, updatedAt: now } satisfies VideoAssetDto
    uploadedVideos.set(id, { url: URL.createObjectURL(file), asset })
    value = asset
  } else if (parts[0] === 'uploads' && parts[1] === 'document') {
    const file = body as File
    const id = `demo-file-${randomId()}`
    uploadedDocuments.set(id, { url: URL.createObjectURL(file), name: file.name, mimeType: file.type || 'application/octet-stream', size: file.size })
    value = { id, originalName: file.name, mimeType: file.type, size: file.size, checksum: 'demo' }
  } else if (parts[0] === 'collections') {
    const rows = readCollections()
    if (!parts[1] && method === 'GET') value = rows.map(summary)
    else if (!parts[1] && method === 'POST') {
      const input = body as { name: string; description: string; visibility: 'private' | 'community'; learningGoal?: string }
      const created: StoredCollection = { id: `demo-collection-${randomId()}`, ...input, learningGoal: input.learningGoal || '', systemKind: null, itemCount: 0, videoCount: 0, durationSeconds: 0, owner: student, isOwner: true, revision: 1, updatedAt: new Date().toISOString(), postIds: [] }
      rows.push(created); saveCollections(rows); value = detail(created)
    } else {
      const target = parts[1] === 'watch-later' ? watchLater() : readCollections().find((row) => row.id === parts[1])
      if (!target) throw new Error('合集不存在')
      if (parts[2] === 'items' && method === 'POST') {
        const postId = (body as { postId: string }).postId
        if (!target.postIds.includes(postId)) target.postIds.push(postId)
        target.revision++; target.updatedAt = new Date().toISOString(); target.itemCount = target.postIds.length
        const entries = all().filter((entry) => target.postIds.includes(entry.postId || ''))
        target.videoCount = entries.filter((entry) => entry.kind === 'video').length
        target.durationSeconds = entries.reduce((total, entry) => total + (entry.durationSeconds || 0), 0)
        const next = readCollections().filter((row) => row.id !== target.id); next.push(target); saveCollections(next); value = detail(target)
      } else if (parts[2] === 'items' && parts[3] && method === 'DELETE') {
        target.postIds = target.postIds.filter((postId) => `${target.id}-${postId}` !== parts[3])
        target.revision++; target.updatedAt = new Date().toISOString(); target.itemCount = target.postIds.length
        const entries = all().filter((entry) => target.postIds.includes(entry.postId || ''))
        target.videoCount = entries.filter((entry) => entry.kind === 'video').length
        target.durationSeconds = entries.reduce((total, entry) => total + (entry.durationSeconds || 0), 0)
        const next = readCollections().filter((row) => row.id !== target.id); next.push(target); saveCollections(next); value = detail(target)
      } else if (parts[2] === 'order' && method === 'PUT') {
        const input = body as { expectedRevision: number; itemIds: string[] }
        if (input.expectedRevision !== target.revision || input.itemIds.length !== target.postIds.length) throw new Error('合集已变化，请刷新后重试')
        const ordered = input.itemIds.map((itemId) => target.postIds.find((postId) => `${target.id}-${postId}` === itemId))
        if (ordered.some((postId) => !postId) || new Set(ordered).size !== target.postIds.length) throw new Error('合集排序项不完整')
        target.postIds = ordered as string[]; target.revision++; target.updatedAt = new Date().toISOString()
        const next = readCollections().filter((row) => row.id !== target.id); next.push(target); saveCollections(next); value = detail(target)
      } else if (method === 'PATCH') {
        const input = body as { name: string; description: string; visibility: 'private' | 'community'; learningGoal?: string; expectedRevision?: number }
        if (input.expectedRevision !== target.revision || target.systemKind) throw new Error('合集已变化、不可编辑或不存在')
        Object.assign(target, { name: input.name, description: input.description, visibility: input.visibility, learningGoal: input.learningGoal || '', revision: target.revision + 1, updatedAt: new Date().toISOString() })
        const next = readCollections().filter((row) => row.id !== target.id); next.push(target); saveCollections(next); value = detail(target)
      } else value = detail(target)
    }
  }
  if (value === undefined) throw new Error('演示数据中没有此资源能力')
  return JSON.parse(JSON.stringify(value)) as T
}
