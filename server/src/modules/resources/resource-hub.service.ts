import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { createHmac, timingSafeEqual } from 'node:crypto'
import type { Prisma } from '@prisma/client'
import type {
  CommunityContentBlock,
  LearningCollectionDto,
  LearningCollectionInput,
  LearningCollectionSummaryDto,
  ResourceHubAdminConfigDto,
  ResourceHubCategoryDto,
  ResourceHubHomeDto,
  ResourceHubItemDto,
  ResourceHubListDto,
  WatchProgressInput,
} from '@ai-learning-hub/contracts'
import { PrismaService } from '../../prisma/prisma.service'
import { authorDto, authorInclude } from '../community/community.mapper'
import { CommunityPostService, postInclude, type HydratedPost } from '../community/post.service'
import { CommunityVisibilityPolicyService } from '../community/visibility.service'
import { CourseService } from '../courses/course.service'
import { STORAGE_SERVICE, type StorageService, type UploadedPathFile } from '../storage/storage.types'
import { ResourceService } from './resource.service'
import type { CollectionInputDto, ContributionAdminDto, ResourceCategoryInputDto, ResourceHubQueryDto } from './resource-hub.dto'
import { VideoProcessingService } from './video-processing.service'

type HubConfig = { bannerPostIds: string[]; sectionCategoryCodes: string[] }

const defaultConfig: HubConfig = {
  bannerPostIds: [],
  sectionCategoryCodes: ['ai-foundation', 'lab-demo', 'model-deployment', 'agent-practice'],
}

const cursorOffset = (cursor: string) => {
  if (!cursor) return 0
  try {
    const value = Number(Buffer.from(cursor, 'base64url').toString('utf8'))
    return Number.isSafeInteger(value) && value >= 0 ? value : 0
  } catch { return 0 }
}

export function parseSingleRange(header: string | undefined, size: number) {
  if (!header) return null
  if (!header.startsWith('bytes=') || header.includes(',')) throw new RangeError('只支持单范围请求')
  const [rawStart, rawEnd] = header.slice(6).split('-', 2)
  if (!rawStart && !rawEnd) throw new RangeError('范围格式不正确')
  let start: number, end: number
  if (!rawStart) {
    const suffix = Number(rawEnd)
    if (!Number.isSafeInteger(suffix) || suffix <= 0) throw new RangeError('后缀范围不正确')
    start = Math.max(0, size - suffix)
    end = size - 1
  } else {
    start = Number(rawStart)
    end = rawEnd ? Number(rawEnd) : size - 1
  }
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end < start || start >= size) throw new RangeError('请求范围不可满足')
  return { start, end: Math.min(end, size - 1) }
}

@Injectable()
export class ResourceHubService {
  private readonly tokenSecret: string

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly posts: CommunityPostService,
    private readonly visibility: CommunityVisibilityPolicyService,
    private readonly resources: ResourceService,
    private readonly courses: CourseService,
    private readonly videoProcessing: VideoProcessingService,
    @Inject(STORAGE_SERVICE) private readonly storage: StorageService,
  ) {
    this.tokenSecret = String(config.get('VIDEO_PLAYBACK_SECRET') || config.getOrThrow('JWT_SECRET'))
  }

  async uploadVideo(userId: string, file: UploadedPathFile) {
    await this.visibility.viewer(userId)
    if (!['video/mp4', 'video/quicktime', 'video/webm'].includes(file.mimetype)) throw new BadRequestException('仅支持 MP4、MOV、WebM 视频')
    const maxBytes = Math.max(1, Math.min(1024, Number(this.config.get('VIDEO_UPLOAD_MAX_MB') || 1024))) * 1024 * 1024
    const stored = await this.storage.uploadPath(file, { uploadedBy: userId, visibility: 'private', maxBytes })
    try {
      const asset = await this.prisma.videoAsset.create({
        data: { uploaderId: userId, sourceFileId: stored.id, originalName: stored.originalName, originalMimeType: stored.mimeType },
      })
      void this.videoProcessing.processNext()
      return {
        id: asset.id,
        status: asset.status,
        originalName: asset.originalName,
        originalMimeType: asset.originalMimeType,
        durationSeconds: null,
        width: null,
        height: null,
        rotation: 0,
        attempts: 0,
        lastError: null,
        posterUrl: null,
        createdAt: asset.createdAt.toISOString(),
        updatedAt: asset.updatedAt.toISOString(),
      }
    } catch (error) {
      await this.storage.delete(stored.id).catch(() => undefined)
      throw error
    }
  }

  async video(userId: string, id: string) {
    await this.visibility.viewer(userId)
    const asset = await this.prisma.videoAsset.findFirst({ where: { id, uploaderId: userId } })
    if (!asset) throw new NotFoundException('视频不存在')
    return {
      id: asset.id,
      status: asset.status,
      originalName: asset.originalName,
      originalMimeType: asset.originalMimeType,
      durationSeconds: asset.durationSeconds,
      width: asset.width,
      height: asset.height,
      rotation: asset.rotation,
      attempts: asset.attempts,
      lastError: asset.lastError,
      posterUrl: asset.posterFileId ? this.mediaUrl(asset.posterFileId, userId) : null,
      createdAt: asset.createdAt.toISOString(),
      updatedAt: asset.updatedAt.toISOString(),
    }
  }

  async uploadDocument(userId: string, file: UploadedPathFile) {
    await this.visibility.viewer(userId)
    const maxBytes = Math.max(1, Math.min(500, Number(this.config.get('RESOURCE_ATTACHMENT_MAX_MB') || 100))) * 1024 * 1024
    return this.storage.uploadPath(file, { uploadedBy: userId, visibility: 'private', maxBytes })
  }

  retryVideo(userId: string, id: string, administrative = false) {
    return this.videoProcessing.retry(userId, id, administrative)
  }

  cleanupVideoOrphans(userId: string) {
    return this.videoProcessing.cleanupOrphans(userId)
  }

  collectionToCourse(userId: string, collectionId: string, input: { courseId?: string; slug?: string; title?: string }) {
    return this.courses.createDraftFromCollection(collectionId, input, userId)
  }

  categories(): Promise<ResourceHubCategoryDto[]> {
    return this.prisma.resourceCategory.findMany({
      where: { active: true },
      select: { id: true, code: true, name: true, description: true, icon: true, sortOrder: true },
      orderBy: [{ sortOrder: 'asc' }, { code: 'asc' }],
    })
  }

  async list(userId: string, query: ResourceHubQueryDto): Promise<ResourceHubListDto> {
    const all = await this.allItems(userId)
    const keyword = query.keyword.trim().toLocaleLowerCase()
    const items = all.filter((item) =>
      (!keyword || [item.title, item.summary, item.author?.displayName || '', ...item.tags].some((value) => value.toLocaleLowerCase().includes(keyword))) &&
      (!query.category || item.category?.code === query.category) &&
      (query.kind === 'all' || item.kind === query.kind) &&
      (!query.authorId || item.author?.id === query.authorId))
    items.sort(query.sort === 'popular'
      ? (a, b) => b.stats.views - a.stats.views || b.publishedAt.localeCompare(a.publishedAt) || b.id.localeCompare(a.id)
      : query.sort === 'likes'
        ? (a, b) => b.stats.likes - a.stats.likes || b.publishedAt.localeCompare(a.publishedAt) || b.id.localeCompare(a.id)
        : query.sort === 'bookmarks'
          ? (a, b) => b.stats.bookmarks - a.stats.bookmarks || b.publishedAt.localeCompare(a.publishedAt) || b.id.localeCompare(a.id)
          : (a, b) => b.publishedAt.localeCompare(a.publishedAt) || b.id.localeCompare(a.id))
    const offset = cursorOffset(query.cursor)
    const page = items.slice(offset, offset + query.limit)
    return { items: page, nextCursor: offset + page.length < items.length ? Buffer.from(String(offset + page.length)).toString('base64url') : null }
  }

  async home(userId: string): Promise<ResourceHubHomeDto> {
    const [items, categories, config, collections] = await Promise.all([
      this.allItems(userId),
      this.categories(),
      this.hubConfig(),
      this.collections(userId),
    ])
    const contributions = items.filter((item) => item.sourceType === 'contribution')
    const configured = config.bannerPostIds.map((id) => contributions.find((item) => item.postId === id)).filter((item): item is ResourceHubItemDto => !!item)
    const banners = (configured.length ? configured : contributions.filter((item) => item.featured).concat(contributions)).filter((item, index, all) => all.findIndex((candidate) => candidate.id === item.id) === index).slice(0, 3)
    const bannerRows = banners.length ? await this.prisma.communityPost.findMany({ where: { id: { in: banners.map((item) => item.postId!) } }, select: { id: true, contentBlocks: true } }) : []
    const bannerFiles = new Map(bannerRows.flatMap((row) => {
      const block = (row.contentBlocks as CommunityContentBlock[]).find((item) => item.type === 'image' && item.alt === '资源中心 Banner')
      return block?.type === 'image' ? [[row.id, block.fileId] as const] : []
    }))
    const featured = contributions.filter((item) => item.featured).concat(contributions).filter((item, index, all) => all.findIndex((candidate) => candidate.id === item.id) === index).slice(0, 2)
    const sectionCodes = config.sectionCategoryCodes.filter((code) => categories.some((category) => category.code === code))
    const sections = sectionCodes.map((code) => ({
      key: code,
      title: categories.find((category) => category.code === code)!.name,
      categoryCode: code,
      items: contributions.filter((item) => item.category?.code === code).slice(0, 6),
    })).filter((section) => section.items.length)
    const likedIds = new Set((await this.prisma.communityPostReaction.findMany({
      where: { userId, reactionType: 'like', post: { contribution: { is: { kind: 'video' } } } },
      select: { postId: true },
      orderBy: { createdAt: 'desc' },
      take: 12,
    })).map((row) => row.postId))
    return {
      banners: banners.map((item) => bannerFiles.has(item.id) ? { ...item, coverUrl: this.mediaUrl(bannerFiles.get(item.id)!, userId) } : item),
      categories,
      categoryCounts: categories.reduce<Record<string, number>>((counts, category) => {
        counts[category.code] = items.filter((item) => item.category?.code === category.code).length
        return counts
      }, { all: items.length }),
      featured,
      sections,
      rankings: {
        week: await this.ranking(items, new Date(Date.now() - 7 * 86400000)),
        month: await this.ranking(items, new Date(Date.now() - 30 * 86400000)),
        all: [...items].sort((a, b) => b.stats.views - a.stats.views || b.id.localeCompare(a.id)).slice(0, 5),
      },
      collections,
      likedVideos: contributions.filter((item) => !!item.postId && likedIds.has(item.postId)).slice(0, 4),
      liveReplay: contributions.filter((item) => item.liveReplay && item.kind === 'video').slice(0, 4),
    }
  }

  async detail(userId: string, postId: string) {
    const post = await this.posts.detail(userId, postId)
    if (!post.contribution) throw new NotFoundException('资源作品不存在')
    const stored = await this.prisma.resourceContribution.findUnique({ where: { postId }, include: { videoAsset: true } })
    if (!stored) throw new NotFoundException('资源作品不存在')
    const items = await this.allItems(userId)
    const currentItem = items.find((item) => item.postId === postId)
    const coverFileId = stored.coverFileId || stored.videoAsset?.posterFileId || post.contentBlocks.find((block) => block.type === 'image')?.fileId
    const coverUrl = coverFileId ? this.mediaUrl(coverFileId, userId) : null
    const collection = await this.prisma.learningCollectionItem.findFirst({
      where: { contributionPostId: postId, collection: { OR: [{ ownerId: userId }, { visibility: 'community' }] } },
      orderBy: { createdAt: 'asc' },
      select: { collectionId: true },
    })
    const contribution = {
      ...post.contribution,
      coverUrl,
      video: post.contribution.video ? { ...post.contribution.video, posterUrl: coverUrl } : null,
      attachment: post.contribution.attachment ? {
        ...post.contribution.attachment,
        downloadUrl: this.attachmentUrl(post.contribution.attachment.id, userId),
      } : null,
    }
    return {
      post,
      contribution,
      stats: currentItem?.stats || { views: 0, likes: post.stats.likes, comments: post.stats.comments, bookmarks: post.stats.bookmarks, downloads: 0 },
      collection: collection ? await this.collection(userId, collection.collectionId) : null,
      related: items.filter((candidate) => candidate.postId !== postId && (candidate.category?.code === post.contribution?.category?.code || candidate.tags.some((tag) => post.contribution?.tags.includes(tag)))).slice(0, 6),
    }
  }

  async studio(userId: string) {
    const rows = await this.prisma.communityPost.findMany({
      where: { authorId: userId, deletedAt: null, contribution: { isNot: null } },
      include: postInclude,
      orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
    })
    const posts = await this.posts.mapMany(userId, rows)
    const items = await this.mapContributions(userId, rows, posts)
    return {
      items: items.filter((item) => rows.find((row) => row.id === item.postId)?.status === 'published'),
      drafts: posts.filter((post) => post.status === 'draft'),
      processing: items.filter((item) => item.mediaStatus === 'uploaded' || item.mediaStatus === 'processing' || item.mediaStatus === 'failed'),
    }
  }

  async creator(viewerId: string, userId: string) {
    const visiblePost = await this.visibility.where(viewerId)
    const [items, collections] = await Promise.all([
      this.allItems(viewerId),
      this.prisma.learningCollection.findMany({
        where: { ownerId: userId, ...(viewerId === userId ? {} : { visibility: 'community' }) },
        include: { owner: { include: authorInclude }, items: { where: { contribution: { post: visiblePost } }, include: { contribution: { include: { videoAsset: true } } } } },
        orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
      }),
    ])
    return { items: items.filter((item) => item.sourceType === 'contribution' && item.author?.id === userId), collections: collections.map((row) => this.collectionSummary(row, viewerId)) }
  }

  async collections(userId: string): Promise<LearningCollectionSummaryDto[]> {
    const visiblePost = await this.visibility.where(userId)
    const rows = await this.prisma.learningCollection.findMany({
      where: { ownerId: userId },
      include: {
        owner: { include: authorInclude },
        items: { where: { contribution: { post: visiblePost } }, include: { contribution: { include: { videoAsset: true } } } },
      },
      orderBy: [{ systemKind: 'desc' }, { updatedAt: 'desc' }],
    })
    return rows.map((row) => this.collectionSummary(row, userId))
  }

  async collection(userId: string, id: string): Promise<LearningCollectionDto> {
    const row = await this.prisma.learningCollection.findFirst({
      where: {
        ...(id === 'watch-later' ? { ownerId: userId, systemKind: 'watch_later' } : { id }),
        OR: [{ ownerId: userId }, { visibility: 'community' }],
      },
      include: {
        owner: { include: authorInclude },
        items: {
          include: { contribution: { include: { videoAsset: true } } },
          orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
        },
      },
    })
    if (!row) throw new NotFoundException('合集不存在或不可见')
    const visibleRows = await this.prisma.communityPost.findMany({
      where: { AND: [await this.visibility.where(userId), { id: { in: row.items.map((item) => item.contributionPostId) } }] },
      include: postInclude,
    })
    const visiblePosts = await this.posts.mapMany(userId, visibleRows)
    const visible = new Map(visiblePosts.map((post) => [post.id, post]))
    const sourceRows = visibleRows.filter((post) => visible.has(post.id))
    const mapped = await this.mapContributions(userId, sourceRows, sourceRows.map((post) => visible.get(post.id)!))
    const items = row.items.flatMap((item) => {
        const contribution = mapped.find((candidate) => candidate.postId === item.contributionPostId)
        return contribution ? [{ id: item.id, sortOrder: item.sortOrder, contribution }] : []
      })
    const videos = items.filter((item) => item.contribution.kind === 'video')
    return {
      ...this.collectionSummary(row, userId),
      itemCount: items.length,
      videoCount: videos.length,
      durationSeconds: videos.reduce((total, item) => total + (item.contribution.durationSeconds || 0), 0),
      items,
    }
  }

  async createCollection(userId: string, input: CollectionInputDto) {
    await this.visibility.viewer(userId)
    const row = await this.prisma.learningCollection.create({ data: { ownerId: userId, name: input.name.trim(), description: input.description.trim(), visibility: input.visibility, learningGoal: input.learningGoal.trim() } })
    return this.collection(userId, row.id)
  }

  async updateCollection(userId: string, id: string, input: LearningCollectionInput) {
    const changed = await this.prisma.learningCollection.updateMany({
      where: { id, ownerId: userId, systemKind: null, revision: input.expectedRevision },
      data: { name: input.name.trim(), description: input.description.trim(), visibility: input.visibility, learningGoal: input.learningGoal?.trim() || '', revision: { increment: 1 } },
    })
    if (!changed.count) throw new ConflictException('合集已变化、不可编辑或不存在')
    return this.collection(userId, id)
  }

  async addToCollection(userId: string, id: string, postId: string) {
    await this.visibility.assertPost(userId, postId)
    if (!await this.prisma.resourceContribution.count({ where: { postId } })) throw new NotFoundException('资源作品不存在')
    const collection = id === 'watch-later'
      ? await this.prisma.learningCollection.upsert({
        where: { ownerId_systemKind: { ownerId: userId, systemKind: 'watch_later' } },
        create: { ownerId: userId, name: '稍后再看', systemKind: 'watch_later' },
        update: {},
      })
      : await this.prisma.learningCollection.findFirst({ where: { id, ownerId: userId } })
    if (!collection) throw new ForbiddenException('只能修改自己的合集')
    const max = await this.prisma.learningCollectionItem.aggregate({ where: { collectionId: collection.id }, _max: { sortOrder: true } })
    await this.prisma.learningCollectionItem.createMany({ data: [{ collectionId: collection.id, contributionPostId: postId, sortOrder: (max._max.sortOrder || 0) + 1 }], skipDuplicates: true })
    await this.prisma.learningCollection.update({ where: { id: collection.id }, data: { revision: { increment: 1 } } })
    return this.collection(userId, collection.id)
  }

  async removeFromCollection(userId: string, id: string, itemId: string) {
    const changed = await this.prisma.learningCollectionItem.deleteMany({ where: { id: itemId, collection: { id, ownerId: userId } } })
    if (!changed.count) throw new ForbiddenException('只能修改自己的合集')
    await this.prisma.learningCollection.update({ where: { id }, data: { revision: { increment: 1 } } })
    return this.collection(userId, id)
  }

  async reorderCollection(userId: string, id: string, expectedRevision: number, itemIds: string[]) {
    await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM learning_collections WHERE id = ${id} FOR UPDATE`
      const collection = await tx.learningCollection.findFirst({ where: { id, ownerId: userId, revision: expectedRevision }, include: { items: true } })
      if (!collection) throw new ConflictException('合集已变化、不可编辑或不存在')
      if (collection.items.length !== itemIds.length || collection.items.some((item) => !itemIds.includes(item.id))) throw new BadRequestException('排序项必须与合集当前内容一致')
      for (const [sortOrder, itemId] of itemIds.entries()) await tx.learningCollectionItem.update({ where: { id: itemId }, data: { sortOrder } })
      await tx.learningCollection.update({ where: { id }, data: { revision: { increment: 1 } } })
    })
    return this.collection(userId, id)
  }

  async playback(userId: string, assetId: string) {
    const asset = await this.visibleAsset(userId, assetId)
    const expires = Math.floor(Date.now() / 1000) + 6 * 60 * 60
    const token = this.sign('play', assetId, userId, expires)
    const poster = asset.posterFileId ? this.mediaUrl(asset.posterFileId, userId) : null
    const progress = await this.prisma.resourceWatchProgress.findUnique({ where: { userId_videoAssetId: { userId, videoAssetId: assetId } } })
    return {
      assetId,
      sources: [{ src: `/api/v1/resource-hub/play/${encodeURIComponent(assetId)}?token=${encodeURIComponent(token)}`, type: 'video/mp4' }],
      poster,
      durationSeconds: asset.durationSeconds!,
      expiresAt: new Date(expires * 1000).toISOString(),
      captions: [],
      chapters: [],
      progress: progress ? { positionSeconds: progress.positionSeconds, watchedSeconds: progress.watchedSeconds, completed: !!progress.completedAt } : null,
    }
  }

  async playbackFile(assetId: string, token: string, start?: number, end?: number) {
    const userId = this.verify('play', assetId, token)
    const asset = await this.visibleAsset(userId, assetId)
    return this.storage.open(asset.playableFileId!, start, end)
  }

  async mediaFile(fileId: string, token: string) {
    const userId = this.verify('media', fileId, token)
    const [allowed, publicFile] = await Promise.all([
      this.prisma.resourceContribution.count({
        where: {
          OR: [{ coverFileId: fileId }, { videoAsset: { is: { posterFileId: fileId } } }],
          post: await this.visibility.where(userId),
        },
      }),
      this.prisma.fileRecord.count({ where: { id: fileId, visibility: 'public' } }),
    ])
    if (!allowed && !publicFile) throw new NotFoundException('媒体不存在或不可见')
    return this.storage.open(fileId)
  }

  async attachmentFile(fileId: string, token: string) {
    const userId = this.verify('attachment', fileId, token)
    const allowed = await this.prisma.resourceContribution.count({
      where: { attachmentFileId: fileId, post: await this.visibility.where(userId) },
    })
    if (!allowed) throw new NotFoundException('附件不存在或不可见')
    return this.storage.open(fileId)
  }

  async progress(userId: string, assetId: string, input: WatchProgressInput) {
    const asset = await this.visibleAsset(userId, assetId)
    if (input.positionSeconds > asset.durationSeconds! + 5 || input.watchedSeconds > asset.durationSeconds! + 5) throw new BadRequestException('观看进度超出视频时长')
    const completed = input.completed && input.positionSeconds >= asset.durationSeconds! * 0.9
    const result = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`watch:${userId}:${assetId}`},0))::text`
      const current = await tx.resourceWatchProgress.findUnique({ where: { userId_videoAssetId: { userId, videoAssetId: assetId } } })
      const watchedSeconds = Math.max(current?.watchedSeconds || 0, input.watchedSeconds)
      const row = await tx.resourceWatchProgress.upsert({
        where: { userId_videoAssetId: { userId, videoAssetId: assetId } },
        create: { userId, videoAssetId: assetId, positionSeconds: input.positionSeconds, watchedSeconds, completedAt: completed ? new Date() : null },
        update: { positionSeconds: input.positionSeconds, watchedSeconds, ...(completed && !current?.completedAt ? { completedAt: new Date() } : {}) },
      })
      if (watchedSeconds >= Math.min(30, asset.durationSeconds! * 0.1)) {
        const bucket = Math.floor(Date.now() / (6 * 60 * 60 * 1000))
        await tx.activityEvent.createMany({
          data: [{ eventKey: `resource-watch:${userId}:${assetId}:${bucket}`, userId, eventType: 'resource_valid_watch', actionType: 'resource_valid_watch', entityType: 'post', entityId: asset.contribution!.postId, targetType: 'post', targetId: asset.contribution!.postId, payload: { assetId, durationSeconds: asset.durationSeconds, clientEventKey: input.eventKey } }],
          skipDuplicates: true,
        })
      }
      return row
    })
    return { positionSeconds: result.positionSeconds, watchedSeconds: result.watchedSeconds, completed: !!result.completedAt }
  }

  async configState(): Promise<ResourceHubAdminConfigDto> {
    const row = await this.prisma.systemSetting.findUnique({ where: { key: 'resource_hub_config' } })
    const config = this.configValue(row?.value)
    return { revision: row?.revision || 0, ...config }
  }

  async updateConfig(input: ResourceHubAdminConfigDto) {
    const [posts, categories] = await Promise.all([
      this.prisma.resourceContribution.count({
        where: {
          postId: { in: input.bannerPostIds },
          post: { status: 'published', visibility: 'public', deletedAt: null, author: { status: 'active' } },
          OR: [{ kind: { not: 'video' } }, { videoAsset: { is: { status: 'ready' } } }],
        },
      }),
      this.prisma.resourceCategory.count({ where: { code: { in: input.sectionCategoryCodes }, active: true } }),
    ])
    if (posts !== new Set(input.bannerPostIds).size) throw new BadRequestException('Banner 作品必须公开、已发布、作者有效且视频已处理完成')
    if (categories !== new Set(input.sectionCategoryCodes).size) throw new BadRequestException('首页分区包含无效分类')
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended('resource-hub-config',0))::text`
      const current = await tx.systemSetting.findUnique({ where: { key: 'resource_hub_config' } })
      if ((current?.revision || 0) !== input.revision) throw new ConflictException('资源中心配置已变化，请刷新后重试')
      const value = { bannerPostIds: input.bannerPostIds, sectionCategoryCodes: input.sectionCategoryCodes }
      const updated = await tx.systemSetting.upsert({ where: { key: 'resource_hub_config' }, create: { key: 'resource_hub_config', value }, update: { value, revision: { increment: 1 } } })
      return { revision: updated.revision, ...value }
    })
  }

  async adminItems(userId: string, query: ResourceHubQueryDto) {
    const contribution = {
      ...(query.category ? { category: { code: query.category } } : {}),
      ...(query.kind === 'all' ? {} : { kind: query.kind }),
    }
    const rows = await this.prisma.communityPost.findMany({
      where: {
        contribution: Object.keys(contribution).length ? { is: contribution } : { isNot: null },
        ...(query.keyword ? { OR: [{ title: { contains: query.keyword, mode: 'insensitive' } }, { plainText: { contains: query.keyword, mode: 'insensitive' } }] } : {}),
      },
      include: { ...postInclude, _count: { select: { reports: true } } },
      orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
      take: query.limit,
    })
    const mapped = await this.mapContributions(userId, rows, await this.posts.mapMany(userId, rows))
    return rows.flatMap((row) => {
      const item = mapped.find((candidate) => candidate.postId === row.id)
      return item ? [{ ...item, status: row.status, visibility: row.visibility, reportCount: row._count.reports, deletedAt: row.deletedAt?.toISOString() || null }] : []
    })
  }

  async updateContribution(actorId: string, postId: string, input: ContributionAdminDto) {
    const category = await this.prisma.resourceCategory.findFirst({ where: { id: input.categoryId, active: true } })
    if (!category) throw new BadRequestException('资源分类不存在或已停用')
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM community_posts WHERE id = ${postId} FOR UPDATE`
      const current = await tx.resourceContribution.findUnique({ where: { postId } })
      if (!current) throw new NotFoundException('资源作品不存在')
      const updated = await tx.resourceContribution.update({
        where: { postId },
        data: { categoryId: category.id, featured: input.featured, liveReplay: input.liveReplay, revision: { increment: 1 } },
      })
      await tx.auditLog.create({
        data: { actorId, action: 'resource_contribution_update', targetType: 'community_post', targetId: postId, details: { reason: input.reason, categoryId: category.id, featured: input.featured, liveReplay: input.liveReplay } },
      })
      return updated
    })
  }

  adminCategories() {
    return this.prisma.resourceCategory.findMany({ orderBy: [{ sortOrder: 'asc' }, { code: 'asc' }] })
  }

  async createCategory(actorId: string, input: ResourceCategoryInputDto) {
    const code = input.code?.trim().toLowerCase()
    if (!code || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(code)) throw new BadRequestException('分类标识仅支持小写字母、数字和连字符')
    const row = await this.prisma.resourceCategory.create({ data: { code, name: input.name.trim(), description: input.description.trim(), icon: input.icon.trim(), sortOrder: input.sortOrder, active: input.active } })
    await this.prisma.auditLog.create({ data: { actorId, action: 'resource_category_create', targetType: 'resource_category', targetId: row.id } })
    return row
  }

  async updateCategory(actorId: string, id: string, input: ResourceCategoryInputDto) {
    const row = await this.prisma.resourceCategory.update({ where: { id }, data: { name: input.name.trim(), description: input.description.trim(), icon: input.icon.trim(), sortOrder: input.sortOrder, active: input.active } })
    await this.prisma.auditLog.create({ data: { actorId, action: 'resource_category_update', targetType: 'resource_category', targetId: id } })
    return row
  }

  processingFailures() {
    return this.prisma.videoAsset.findMany({
      where: { status: 'failed' },
      select: { id: true, originalName: true, attempts: true, lastError: true, updatedAt: true, uploader: { select: { id: true, displayName: true } }, contribution: { select: { postId: true, post: { select: { title: true } } } } },
      orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
      take: 100,
    })
  }

  resourceReports() {
    return this.prisma.communityReport.findMany({
      where: { post: { contribution: { isNot: null } } },
      select: { id: true, postId: true, reason: true, description: true, status: true, createdAt: true, handledAt: true },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: 100,
    })
  }

  adminCollections() {
    return this.prisma.learningCollection.findMany({
      where: { visibility: 'community' },
      select: {
        id: true,
        name: true,
        description: true,
        learningGoal: true,
        revision: true,
        updatedAt: true,
        owner: { select: { id: true, username: true, displayName: true } },
        _count: { select: { items: true, courseLinks: true } },
        courseLinks: { select: { courseId: true, courseVersionId: true, sourceRevision: true, createdAt: true }, orderBy: { createdAt: 'desc' }, take: 5 },
      },
      orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
      take: 100,
    })
  }

  private async allItems(userId: string): Promise<ResourceHubItemDto[]> {
    // ponytail: 校园规模先在服务端合并两种来源；达到万级内容后再改为数据库 UNION 游标。
    const where = await this.visibility.where(userId)
    const rows = await this.prisma.communityPost.findMany({
      where: { AND: [where, { contribution: { isNot: null } }, { OR: [{ contribution: { is: { kind: { not: 'video' } } } }, { contribution: { is: { videoAsset: { is: { status: 'ready' } } } } }] }] },
      include: postInclude,
      orderBy: [{ publishedAt: 'desc' }, { id: 'desc' }],
    })
    const posts = await this.posts.mapMany(userId, rows)
    const contributions = await this.mapContributions(userId, rows, posts)
    const legacy = []
    let page = 1
    for (;;) {
      const result = await this.resources.list({ page, pageSize: 100, keyword: '' }, true)
      legacy.push(...result.items.map((item): ResourceHubItemDto => ({
        sourceType: 'legacy_resource',
        id: item.slug,
        postId: null,
        title: item.title,
        summary: item.summary,
        kind: 'document',
        category: null,
        tags: Array.isArray(item.data.tags) ? item.data.tags : [],
        coverUrl: typeof item.data.cover === 'string' ? item.data.cover : null,
        author: null,
        stats: { views: item.views, likes: 0, comments: 0, bookmarks: Number(item.data.favorites || 0), downloads: item.downloads },
        durationSeconds: null,
        videoAssetId: null,
        mediaStatus: null,
        publishedAt: item.publishedAt || item.updatedAt,
        route: `/resources?preview=${encodeURIComponent(item.slug)}`,
        featured: Boolean(item.data.featured),
        liveReplay: false,
      })))
      if (page * 100 >= result.total) break
      page++
    }
    return [...contributions, ...legacy]
  }

  private async mapContributions(userId: string, rows: HydratedPost[], posts: Awaited<ReturnType<CommunityPostService['mapMany']>>) {
    return rows.flatMap((row): ResourceHubItemDto[] => {
      const post = posts.find((candidate) => candidate.id === row.id)
      const contribution = row.contribution
      if (!post || !contribution) return []
      const coverFileId = contribution.coverFileId || contribution.videoAsset?.posterFileId || (row.contentBlocks as Array<{ type?: string; fileId?: string }>).find((block) => block.type === 'image')?.fileId
      return [{
        sourceType: 'contribution',
        id: row.id,
        postId: row.id,
        title: row.title || '未命名资源',
        summary: row.plainText.slice(0, 220),
        kind: contribution.kind,
        category: contribution.category ? { id: contribution.category.id, code: contribution.category.code, name: contribution.category.name, description: contribution.category.description, icon: contribution.category.icon, sortOrder: contribution.category.sortOrder } : null,
        tags: contribution.tags,
        coverUrl: coverFileId ? this.mediaUrl(coverFileId, userId) : null,
        author: post.author,
        stats: { views: row.impressionCount, likes: row.likeCount, comments: row.commentCount, bookmarks: row.bookmarkCount, downloads: 0 },
        durationSeconds: contribution.videoAsset?.durationSeconds || null,
        videoAssetId: contribution.videoAssetId,
        mediaStatus: contribution.videoAsset?.status || null,
        publishedAt: post.publishedAt,
        route: contribution.kind === 'video' ? `/resources/watch/${row.id}` : `/resources/read/${row.id}`,
        featured: contribution.featured,
        liveReplay: contribution.liveReplay,
      }]
    })
  }

  private collectionSummary(row: {
    id: string; name: string; description: string; learningGoal: string; visibility: 'private' | 'community'; systemKind: string | null; revision: number; updatedAt: Date
    ownerId: string; owner: Parameters<typeof authorDto>[0]
    items: Array<{ contribution: { videoAsset: { durationSeconds: number | null } | null } }>
  }, userId: string): LearningCollectionSummaryDto {
    const videos = row.items.map((item) => item.contribution.videoAsset).filter((video): video is NonNullable<typeof video> => !!video)
    return {
      id: row.id,
      name: row.name,
      description: row.description,
      visibility: row.visibility,
      systemKind: row.systemKind === 'watch_later' ? 'watch_later' : null,
      learningGoal: row.learningGoal,
      itemCount: row.items.length,
      videoCount: videos.length,
      durationSeconds: videos.reduce((total, video) => total + (video.durationSeconds || 0), 0),
      owner: authorDto(row.owner),
      isOwner: row.ownerId === userId,
      revision: row.revision,
      updatedAt: row.updatedAt.toISOString(),
    }
  }

  private async ranking(items: ResourceHubItemDto[], since: Date) {
    const [postEvents, legacyEvents] = await Promise.all([
      this.prisma.activityEvent.findMany({ where: { eventType: 'resource_valid_watch', targetId: { in: items.flatMap((item) => item.postId ? [item.postId] : []) }, createdAt: { gte: since } }, select: { targetId: true } }),
      this.prisma.resourceView.findMany({ where: { resource: { slug: { in: items.filter((item) => item.sourceType === 'legacy_resource').map((item) => item.id) } }, createdAt: { gte: since } }, select: { resource: { select: { slug: true } } } }),
    ])
    const counts = new Map<string, number>()
    for (const row of postEvents) if (row.targetId) counts.set(row.targetId, (counts.get(row.targetId) || 0) + 1)
    for (const row of legacyEvents) counts.set(row.resource.slug, (counts.get(row.resource.slug) || 0) + 1)
    return [...items].sort((a, b) => (counts.get(b.postId || b.id) || 0) - (counts.get(a.postId || a.id) || 0) || b.publishedAt.localeCompare(a.publishedAt) || b.id.localeCompare(a.id)).slice(0, 5)
  }

  private async visibleAsset(userId: string, id: string) {
    const asset = await this.prisma.videoAsset.findFirst({
      where: { id, status: 'ready', playableFileId: { not: null }, durationSeconds: { gt: 0 }, contribution: { is: { post: await this.visibility.where(userId) } } },
      include: { contribution: true },
    })
    if (!asset) throw new NotFoundException('视频不存在、未就绪或不可见')
    return asset
  }

  private mediaUrl(fileId: string, userId: string) {
    const expires = Math.floor(Date.now() / 1000) + 2 * 60 * 60
    return `/api/v1/resource-hub/media/${encodeURIComponent(fileId)}?token=${encodeURIComponent(this.sign('media', fileId, userId, expires))}`
  }

  private attachmentUrl(fileId: string, userId: string) {
    const expires = Math.floor(Date.now() / 1000) + 2 * 60 * 60
    return `/api/v1/resource-hub/download/${encodeURIComponent(fileId)}?token=${encodeURIComponent(this.sign('attachment', fileId, userId, expires))}`
  }

  private sign(purpose: string, targetId: string, userId: string, expires: number) {
    const payload = Buffer.from(`${purpose}\n${targetId}\n${userId}\n${expires}`).toString('base64url')
    const signature = createHmac('sha256', this.tokenSecret).update(payload).digest('base64url')
    return `${payload}.${signature}`
  }

  private verify(purpose: string, targetId: string, token: string) {
    const [payload, received] = token.split('.', 2)
    if (!payload || !received) throw new ForbiddenException('播放凭据无效')
    const expected = createHmac('sha256', this.tokenSecret).update(payload).digest()
    const actual = Buffer.from(received, 'base64url')
    if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) throw new ForbiddenException('播放凭据无效')
    const [tokenPurpose, tokenTarget, userId, expiresValue] = Buffer.from(payload, 'base64url').toString('utf8').split('\n')
    if (tokenPurpose !== purpose || tokenTarget !== targetId || Number(expiresValue) < Math.floor(Date.now() / 1000)) throw new ForbiddenException('播放凭据已失效')
    return userId
  }

  private async hubConfig(): Promise<HubConfig> {
    const row = await this.prisma.systemSetting.findUnique({ where: { key: 'resource_hub_config' } })
    return this.configValue(row?.value)
  }

  private configValue(value: Prisma.JsonValue | null | undefined): HubConfig {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return defaultConfig
    const data = value as Record<string, unknown>
    return {
      bannerPostIds: Array.isArray(data.bannerPostIds) ? data.bannerPostIds.filter((item): item is string => typeof item === 'string') : [],
      sectionCategoryCodes: Array.isArray(data.sectionCategoryCodes) ? data.sectionCategoryCodes.filter((item): item is string => typeof item === 'string') : defaultConfig.sectionCategoryCodes,
    }
  }
}
