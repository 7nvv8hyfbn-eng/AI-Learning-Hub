import { loadBadgeContext, type BadgeContext } from '../community/user-badges'
import { activeSanction, availableAccount, visibleCollection, visibleComment } from '../community/governance-policy'
import { assertNotReplaced } from '../auth/session-revocation'
import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, NotFoundException, Optional } from '@nestjs/common'
import { REQUEST } from '@nestjs/core'
import { ConfigService } from '@nestjs/config'
import { createHash, createHmac, timingSafeEqual } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { Prisma, type LearningCollection } from '@prisma/client'
import type {
  CommunityContentBlock,
  CreatorContentSection,
  CreatorContentSummaryDto,
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
import { CollectionPageQueryDto, ResourceHubQueryDto, StudioQueryDto, type CollectionInputDto, type ContributionAdminDto, type ResourceCategoryInputDto } from './resource-hub.dto'
import { VideoProcessingService } from './video-processing.service'
import { StorageQuotaService } from '../storage/storage-quota.service'
import { FileAccessService } from '../storage/file-access.service'
import { fileScanDto } from '../storage/file-scan'
import { idempotency, lockFileReferences, reserveIdempotency } from '../../common/persistence'
import { ContentDetectionService } from '../community/content-detection.service'
import type { AuthRequest } from '../auth/auth.types'
import { authUserDto, authUserInclude } from '../auth/auth.mapper'
import { assertAdminNetwork } from '../../common/deployment-security'

type HubConfig = { bannerPostIds: string[]; sectionCategoryCodes: string[] }
type HubCandidate = { sourceType: ResourceHubItemDto['sourceType']; id: string; databaseId: string; publishedAt: Date; views: number; featured: boolean }
type HubSelection = {
  sourceType?: ResourceHubItemDto['sourceType']; postIds?: string[]; featuredFirst?: boolean; liveReplay?: boolean; liked?: boolean
  related?: { postId: string; categoryId: string | null; tags: string[] }; since?: Date
}
type HubCursor = { id: string; sourceType: ResourceHubItemDto['sourceType']; publishedAt: string; views: number; asOf: string; filter: string }
const readRowCursor = (cursor: string, scope: string): { id: string; at: Date } | null => {
  if (!cursor) return null
  try {
    const row = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as { id: string; at: string; scope: string }
    if (!row || row.scope !== scope || typeof row.id !== 'string' || !row.id || row.id.length > 100 || !Number.isFinite(Date.parse(row.at))) throw new Error()
    return { id: row.id, at: new Date(row.at) }
  } catch { throw new BadRequestException('分页条件已变化或游标无效，请重新读取第一页') }
}
const nextRowCursor = (row: { id: string; updatedAt?: Date; createdAt?: Date }, scope: string) => Buffer.from(JSON.stringify({ id: row.id, at: (row.updatedAt || row.createdAt)!.toISOString(), scope })).toString('base64url')

const defaultConfig: HubConfig = {
  bannerPostIds: [],
  sectionCategoryCodes: ['ai-foundation', 'lab-demo', 'model-deployment', 'agent-practice'],
}

const fileChecksum = async (path: string) => {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(path)) hash.update(chunk as Buffer)
  return hash.digest('hex')
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
    private readonly detection: ContentDetectionService,
    private readonly quota: StorageQuotaService,
    private readonly fileAccess: FileAccessService,
    @Optional() @Inject(REQUEST) private readonly request?: AuthRequest,
  ) {
    this.tokenSecret = String(config.get('VIDEO_PLAYBACK_SECRET') || config.getOrThrow('JWT_SECRET'))
  }

  async uploadVideo(userId: string, file: UploadedPathFile, key?: string) {
    await this.visibility.assertOperation(userId, 'upload')
    if (!['video/mp4', 'video/quicktime', 'video/webm'].includes(file.mimetype)) throw new BadRequestException('仅支持 MP4、MOV、WebM 视频')
    const request = await reserveIdempotency(this.prisma, userId, 'resource-video-upload', key, { name: file.originalname, mimeType: file.mimetype, size: file.size, checksum: await fileChecksum(file.path) })
    if (request.resourceId) return this.video(userId, request.resourceId)
    const maxBytes = Math.max(1, Math.min(1024, Number(this.config.get('VIDEO_UPLOAD_MAX_MB') || 1024))) * 1024 * 1024
    let stored: Awaited<ReturnType<StorageService['uploadPath']>> | null = null
    try {
      stored = await this.storage.uploadPath(file, { uploadedBy: userId, visibility: 'private', maxBytes })
      if (stored.securityScan?.quarantined) throw new BadRequestException(stored.securityScan.message || '视频已隔离')
      const reservation = this.quota.current()
      if (!reservation) throw new BadRequestException('视频上传缺少容量预留')
      const asset = await this.prisma.$transaction(async (tx) => {
        await this.quota.queue(tx, reservation)
        const created = await tx.videoAsset.create({ data: { uploaderId: userId, sourceFileId: stored!.id, originalName: stored!.originalName, originalMimeType: stored!.mimeType, reservationId: reservation.id } })
        await request.complete(tx, created.id)
        return created
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
        securityScan: stored.securityScan,
      }
    } catch (error) {
      if (stored && !stored.securityScan?.quarantined) await this.storage.delete(stored.id).catch(() => undefined)
      await request.cancel()
      throw error
    }
  }

  async video(userId: string, id: string) {
    await this.visibility.viewer(userId)
    const asset = await this.prisma.videoAsset.findFirst({ where: { id, uploaderId: userId }, include: { sourceFile: true } })
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
      securityScan: fileScanDto(asset.sourceFile),
    }
  }

  async uploadDocument(userId: string, file: UploadedPathFile, key?: string) {
    await this.visibility.assertOperation(userId, 'upload')
    const request = await reserveIdempotency(this.prisma, userId, 'resource-document-upload', key, { name: file.originalname, mimeType: file.mimetype, size: file.size, checksum: await fileChecksum(file.path) })
    if (request.resourceId) {
      const existing = await this.prisma.fileRecord.findFirst({ where: { id: request.resourceId, uploadedBy: userId } })
      if (!existing) throw new BadRequestException('原上传结果已失效，请重新选择文件')
      return { id: existing.id, originalName: existing.originalName, mimeType: existing.mimeType, size: existing.size, checksum: existing.checksum, securityScan: fileScanDto(existing) }
    }
    const maxBytes = Math.max(1, Math.min(500, Number(this.config.get('RESOURCE_ATTACHMENT_MAX_MB') || 100))) * 1024 * 1024
    let stored: Awaited<ReturnType<StorageService['uploadPath']>> | null = null
    try {
      stored = await this.storage.uploadPath(file, { uploadedBy: userId, visibility: 'private', maxBytes })
      await this.prisma.$transaction((tx) => request.complete(tx, stored!.id))
      return stored
    } catch (error) {
      if (stored) await this.storage.delete(stored.id).catch(() => undefined)
      await request.cancel()
      throw error
    }
  }

  async retryVideo(userId: string, id: string, administrative = false) {
    if (!administrative) await this.visibility.assertOperation(userId, 'upload')
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
    const filter = createHash('sha256').update(JSON.stringify([userId, query.keyword.trim(), query.category, query.kind, query.authorId, query.sort])).digest('hex')
    let cursor: HubCursor | undefined
    if (query.cursor) {
      try {
        cursor = JSON.parse(Buffer.from(query.cursor, 'base64url').toString('utf8')) as HubCursor
        if (!cursor || cursor.filter !== filter || !['contribution', 'legacy_resource'].includes(cursor.sourceType) || typeof cursor.id !== 'string' || !cursor.id || cursor.id.length > 100 || !Number.isSafeInteger(cursor.views) || cursor.views < 0 || typeof cursor.publishedAt !== 'string' || typeof cursor.asOf !== 'string' || !Number.isFinite(Date.parse(cursor.publishedAt)) || !Number.isFinite(Date.parse(cursor.asOf))) throw new Error()
      } catch { throw new BadRequestException('分页条件已变化或游标无效，请重新读取第一页') }
    }
    const asOf = cursor ? new Date(cursor.asOf) : new Date()
    const rows = await this.selectItems(userId, query, {}, await this.visibility.publicPostsSql(userId), asOf, cursor)
    const page = rows.slice(0, query.limit)
    const items = await this.hydrateItems(userId, page, asOf)
    const last = page.at(-1)
    return { items, nextCursor: rows.length > query.limit && last ? Buffer.from(JSON.stringify({ id: last.id, sourceType: last.sourceType, publishedAt: last.publishedAt.toISOString(), views: last.views, asOf: asOf.toISOString(), filter } satisfies HubCursor)).toString('base64url') : null }
  }

  async home(userId: string): Promise<ResourceHubHomeDto> {
    const [categories, config, collections, scope] = await Promise.all([this.categories(), this.hubConfig(), userId ? this.collections(userId, { ...new ResourceHubQueryDto(), limit: 4 }) : { items: [] }, this.visibility.publicPostsSql(userId)])
    const asOf = new Date()
    const select = async (limit: number, options: HubSelection = {}, query: Partial<ResourceHubQueryDto> = {}) => (await this.selectItems(userId, { ...new ResourceHubQueryDto(), limit, ...query }, options, scope, asOf)).slice(0, limit)
    const sectionCodes = config.sectionCategoryCodes.filter((code) => categories.some((category) => category.code === code))
    const [configured, priority, sections, week, month, all, likedVideos, liveReplay] = await Promise.all([
      select(5, { postIds: config.bannerPostIds, sourceType: 'contribution' }),
      select(3, { featuredFirst: true, sourceType: 'contribution' }),
      Promise.all(sectionCodes.map((category) => select(6, { sourceType: 'contribution' }, { category }))),
      select(5, { since: new Date(asOf.getTime() - 7 * 86400000) }, { sort: 'popular' }),
      select(5, { since: new Date(asOf.getTime() - 30 * 86400000) }, { sort: 'popular' }),
      select(5, {}, { sort: 'popular' }),
      userId ? select(4, { sourceType: 'contribution', liked: true }, { kind: 'video' }) : [],
      select(4, { sourceType: 'contribution', liveReplay: true }),
    ])
    const candidates = [...new Map([configured, priority, ...sections, week, month, all, likedVideos, liveReplay].flat().map((row) => [`${row.sourceType}:${row.id}`, row])).values()]
    const mapped = new Map((await this.hydrateItems(userId, candidates, asOf)).map((item) => [`${item.sourceType}:${item.id}`, item]))
    const items = (rows: HubCandidate[], period = false) => rows.flatMap((row) => {
      const item = mapped.get(`${row.sourceType}:${row.id}`)
      return item ? [{ ...item, ...(period ? { rankingViews: row.views } : {}) }] : []
    })
    const ordered = config.bannerPostIds.flatMap((id) => configured.filter((item) => item.id === id))
    const banners = items(ordered.length ? ordered.slice(0, 3) : priority)
    const bannerRows = banners.length ? await this.prisma.communityPost.findMany({ where: { id: { in: banners.map((item) => item.id) } }, select: { id: true, contentBlocks: true, visibility: true, status: true }, take: 3 }) : []
    const bannerFiles = new Map(bannerRows.flatMap((row) => {
      const block = (row.contentBlocks as CommunityContentBlock[]).find((item) => item.type === 'image' && item.alt === '资源中心 Banner')
      return block?.type === 'image' ? [[row.id, block.fileId] as const] : []
    }))
    return {
      banners: banners.map((item) => bannerFiles.has(item.id) ? { ...item, coverUrl: bannerRows.some(row => row.id === item.id && row.visibility === 'public' && row.status === 'published') ? this.publicCoverUrl(bannerFiles.get(item.id)!) : this.mediaUrl(bannerFiles.get(item.id)!, userId) } : item),
      categories, featured: items(priority.slice(0, 2)),
      sections: sections.map((rows, index) => ({ key: sectionCodes[index], title: categories.find((category) => category.code === sectionCodes[index])!.name, categoryCode: sectionCodes[index], items: items(rows) })).filter((section) => section.items.length),
      rankings: { week: items(week, true), month: items(month, true), all: items(all, true) },
      collections: collections.items, likedVideos: items(likedVideos), liveReplay: items(liveReplay),
    }
  }

  async detail(userId: string, postId: string) {
    const post = await this.posts.detail(userId, postId)
    if (!post.contribution) throw new NotFoundException('资源作品不存在')
    const stored = await this.prisma.resourceContribution.findUnique({ where: { postId }, include: { videoAsset: true } })
    if (!stored) throw new NotFoundException('资源作品不存在')
    const asOf = new Date()
    const relatedRows = await this.selectItems(userId, { ...new ResourceHubQueryDto(), limit: 6 }, { related: { postId, categoryId: stored.categoryId, tags: stored.tags } }, await this.visibility.publicPostsSql(userId), asOf)
    const related = await this.hydrateItems(userId, relatedRows.slice(0, 6), asOf)
    const events = await this.prisma.activityEvent.count({ where: { targetType: 'post', targetId: postId, eventType: stored.kind === 'video' ? 'resource_valid_watch' : 'community_post_click', createdAt: { lte: asOf } } })
    const current = await this.prisma.communityPost.findUniqueOrThrow({ where: { id: postId }, select: { impressionCount: true } })
    const coverFileId = stored.coverFileId || stored.videoAsset?.posterFileId || post.contentBlocks.find((block) => block.type === 'image')?.fileId
    const coverUrl = coverFileId ? this.mediaUrl(coverFileId, userId) : null
    const collection = await this.prisma.learningCollectionItem.findFirst({
      where: { contributionPostId: postId, collection: { OR: [{ ownerId: userId }, visibleCollection()] } },
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
      stats: { views: events, plays: stored.kind === 'video' ? events : null, impressions: current.impressionCount, likes: post.stats.likes, comments: post.stats.comments, bookmarks: post.stats.bookmarks, downloads: 0 },
      collection: collection ? await this.collection(userId, collection.collectionId, new CollectionPageQueryDto(), postId) : null,
      related,
    }
  }

  async studio(userId: string, query: StudioQueryDto = new StudioQueryDto()): Promise<CreatorContentSummaryDto> {
    if (query.cursor && !query.section) throw new BadRequestException('工作室翻页需要指定内容分组')
    const base: Prisma.CommunityPostWhereInput = { authorId: userId, deletedAt: null, contribution: { isNot: null } }
    const filters: Record<CreatorContentSection, Prisma.CommunityPostWhereInput> = {
      items: { status: 'published' }, drafts: { status: 'draft' }, pendingReview: { status: 'pending_review' },
      processing: { contribution: { is: { videoAsset: { status: { in: ['uploaded', 'processing', 'failed'] } } } } },
    }
    const pages: Record<CreatorContentSection, HydratedPost[]> = { items: [], drafts: [], pendingReview: [], processing: [] }
    const nextCursors: CreatorContentSummaryDto['nextCursors'] = { items: null, drafts: null, pendingReview: null, processing: null }
    const [totals, processing] = await Promise.all([
      this.prisma.communityPost.groupBy({ by: ['status'], where: base, _count: { _all: true } }),
      this.prisma.communityPost.count({ where: { AND: [base, filters.processing] } }),
      ...((query.section ? [query.section] : Object.keys(filters)) as CreatorContentSection[]).map(async (section) => {
        const scope = `studio:${userId}:${section}`, cursor = readRowCursor(query.cursor, scope)
        const rows = await this.prisma.communityPost.findMany({
          where: { AND: [base, filters[section], ...(cursor ? [{ OR: [{ updatedAt: { lt: cursor.at } }, { updatedAt: cursor.at, id: { lt: cursor.id } }] }] : [])] },
          include: postInclude, orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }], take: query.limit + 1,
        })
        pages[section] = rows.slice(0, query.limit)
        nextCursors[section] = rows.length > query.limit ? nextRowCursor(pages[section].at(-1)!, scope) : null
      }),
    ])
    const rows = [...new Map(Object.values(pages).flat().map((row) => [row.id, row])).values()]
    const posts = rows.length ? await this.posts.mapMany(userId, rows) : []
    const items = await this.mapContributions(userId, rows, posts)
    const postById = new Map(posts.map((post) => [post.id, post])), itemById = new Map(items.map((item) => [item.id, item]))
    const mapped = (section: 'items' | 'processing') => pages[section].flatMap((row) => itemById.has(row.id) ? [itemById.get(row.id)!] : [])
    const drafts = (section: 'drafts' | 'pendingReview') => pages[section].flatMap((row) => postById.has(row.id) ? [postById.get(row.id)!] : [])
    const count = (status: string) => totals.find((row) => row.status === status)?._count._all || 0
    return { items: mapped('items'), drafts: drafts('drafts'), pendingReview: drafts('pendingReview'), processing: mapped('processing'), nextCursors, counts: { items: count('published'), drafts: count('draft'), pendingReview: count('pending_review'), processing } }
  }

  async creator(viewerId: string, userId: string, query: ResourceHubQueryDto = new ResourceHubQueryDto()) {
    const scope = `collections:${viewerId}:${userId}`
    const cursor = readRowCursor(query.collectionsCursor, scope)
    const [page, collections] = await Promise.all([
      this.list(viewerId, { ...query, authorId: userId }),
      this.prisma.learningCollection.findMany({
        where: { ownerId: userId, AND: [viewerId === userId ? {} : visibleCollection(), ...(cursor ? [{ OR: [{ updatedAt: { lt: cursor.at } }, { updatedAt: cursor.at, id: { lt: cursor.id } }] }] : [])] },
        include: { owner: { include: authorInclude } },
        orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
        take: 19,
      }),
    ])
    return { ...page, collections: await this.collectionSummaries(viewerId, collections.slice(0, 18)), collectionsNextCursor: collections.length > 18 ? nextRowCursor(collections[17], scope) : null }
  }

  async collections(userId: string, query: ResourceHubQueryDto = new ResourceHubQueryDto()) {
    const cursor = query.cursor ? await this.prisma.learningCollection.findFirst({ where: { id: query.cursor, ownerId: userId }, select: { id: true, updatedAt: true, systemKind: true } }) : null
    if (query.cursor && !cursor) throw new BadRequestException('合集游标无效，请重新读取第一页')
    const rows = await this.prisma.learningCollection.findMany({
      where: { ownerId: userId, ...(cursor ? { OR: [
        cursor.systemKind === null ? { systemKind: { not: null } } : { systemKind: { lt: cursor.systemKind } },
        { systemKind: cursor.systemKind, OR: [{ updatedAt: { lt: cursor.updatedAt } }, { updatedAt: cursor.updatedAt, id: { lt: cursor.id } }] },
      ] } : {}) },
      include: { owner: { include: authorInclude } },
      orderBy: [{ systemKind: 'desc' }, { updatedAt: 'desc' }, { id: 'desc' }],
      take: query.limit + 1,
    })
    const page = rows.slice(0, query.limit)
    return { items: await this.collectionSummaries(userId, page), nextCursor: rows.length > query.limit ? page.at(-1)!.id : null }
  }

  async collection(userId: string, id: string, query: CollectionPageQueryDto = new CollectionPageQueryDto(), focusPostId?: string): Promise<LearningCollectionDto> {
    const row = await this.prisma.learningCollection.findFirst({
      where: {
        ...(id === 'watch-later' ? { ownerId: userId, systemKind: 'watch_later' } : { id }),
        OR: [{ ownerId: userId }, visibleCollection()],
      },
      include: { owner: { include: authorInclude } },
    })
    if (!row) throw new NotFoundException('合集不存在或不可见')
    const visible = await this.visibility.where(userId)
    const cursor = query.cursor ? await this.prisma.learningCollectionItem.findFirst({ where: { id: query.cursor, collectionId: row.id }, select: { id: true, sortOrder: true } }) : null
    if (query.cursor && !cursor) throw new BadRequestException('合集条目游标无效，请重新读取第一页')
    const focus = !cursor && focusPostId ? await this.prisma.learningCollectionItem.findFirst({ where: { collectionId: row.id, contributionPostId: focusPostId, contribution: { post: visible } }, select: { id: true, sortOrder: true } }) : null
    const anchor = cursor || focus, before = !!cursor && query.direction === 'before'
    const boundary: Prisma.LearningCollectionItemWhereInput = anchor ? { OR: [
      { sortOrder: before ? { lt: anchor.sortOrder } : { gt: anchor.sortOrder } },
      { sortOrder: anchor.sortOrder, id: before ? { lt: anchor.id } : focus ? { gte: anchor.id } : { gt: anchor.id } },
    ] } : {}
    const candidates = await this.prisma.learningCollectionItem.findMany({
      where: { collectionId: row.id, contribution: { post: visible }, ...boundary },
      select: { id: true, sortOrder: true, contributionPostId: true },
      orderBy: [{ sortOrder: before ? 'desc' : 'asc' }, { id: before ? 'desc' : 'asc' }], take: query.limit + 1,
    })
    const page = candidates.slice(0, query.limit)
    if (before) page.reverse()
    const visibleRows = await this.prisma.communityPost.findMany({
      where: { AND: [visible, { id: { in: page.map((item) => item.contributionPostId) } }] },
      include: postInclude, take: query.limit,
    })
    const visiblePosts = await this.posts.mapMany(userId, visibleRows)
    const mapped = await this.mapContributions(userId, visibleRows, visiblePosts)
    const items = page.flatMap((item) => {
        const contribution = mapped.find((candidate) => candidate.postId === item.contributionPostId)
        return contribution ? [{ id: item.id, sortOrder: item.sortOrder, contribution }] : []
      })
    const hasPrevious = before ? candidates.length > query.limit : cursor ? true : focus ? !!await this.prisma.learningCollectionItem.findFirst({ where: { collectionId: row.id, contribution: { post: visible }, OR: [{ sortOrder: { lt: focus.sortOrder } }, { sortOrder: focus.sortOrder, id: { lt: focus.id } }] }, select: { id: true } }) : false
    const hasNext = before ? true : candidates.length > query.limit
    return {
      ...(await this.collectionSummaries(userId, [row]))[0],
      ...(row.ownerId === userId ? { detection: await this.detection.result('collection', row.id, row.revision) } : {}),
      items, nextCursor: hasNext && page.length ? page.at(-1)!.id : null, previousCursor: hasPrevious && page.length ? page[0].id : null,
    }
  }

  async createCollection(userId: string, input: CollectionInputDto, key?: string) {
    await this.visibility.viewer(userId)
    if (input.visibility === 'community') await this.visibility.assertOperation(userId, 'collection')
    const id = await this.prisma.$transaction(async (tx) => {
      await lockFileReferences(tx)
      const request = await idempotency(tx, userId, 'resource-collection-create', key, input)
      if (request.resourceId) return request.resourceId
      const row = await tx.learningCollection.create({ data: { ownerId: userId, name: input.name.trim(), description: input.description.trim(), visibility: input.visibility, learningGoal: input.learningGoal.trim() } })
      await this.detectCollection(tx, row)
      await request.complete(row.id)
      return row.id
    })
    return this.collection(userId, id)
  }

  async updateCollection(userId: string, id: string, input: LearningCollectionInput) {
    if (!Number.isSafeInteger(input.expectedRevision) || Number(input.expectedRevision) < 1) throw new BadRequestException('编辑合集必须提供当前修订号')
    await this.visibility.viewer(userId)
    const current = await this.prisma.learningCollection.findFirst({ where: { id, ownerId: userId, systemKind: null }, select: { visibility: true } })
    if (!current) throw new ConflictException('合集已变化、不可编辑或不存在')
    if (current.visibility === 'community' || input.visibility === 'community') await this.visibility.assertOperation(userId, 'collection')
    await this.prisma.$transaction(async (tx) => {
      await lockFileReferences(tx)
      const changed = await tx.learningCollection.updateMany({
        where: { id, ownerId: userId, systemKind: null, revision: input.expectedRevision },
        data: { name: input.name.trim(), description: input.description.trim(), visibility: input.visibility, learningGoal: input.learningGoal?.trim() || '', revision: { increment: 1 } },
      })
      if (!changed.count) throw new ConflictException('合集已变化、不可编辑或不存在')
      await this.detectCollection(tx, await tx.learningCollection.findUniqueOrThrow({ where: { id } }))
    })
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
    if (collection.visibility === 'community') await this.visibility.assertOperation(userId, 'collection')
    await this.prisma.$transaction(async (tx) => {
      await lockFileReferences(tx)
      const max = await tx.learningCollectionItem.aggregate({ where: { collectionId: collection.id }, _max: { sortOrder: true } })
      await tx.learningCollectionItem.createMany({ data: [{ collectionId: collection.id, contributionPostId: postId, sortOrder: (max._max.sortOrder || 0) + 1 }], skipDuplicates: true })
      await this.detectCollection(tx, await tx.learningCollection.update({ where: { id: collection.id }, data: { revision: { increment: 1 } } }))
    })
    return this.collection(userId, collection.id)
  }

  async removeFromCollection(userId: string, id: string, itemId: string) {
    const collection = await this.prisma.learningCollection.findFirst({ where: { id, ownerId: userId }, select: { visibility: true } })
    if (!collection) throw new ForbiddenException('只能修改自己的合集')
    if (collection.visibility === 'community') await this.visibility.assertOperation(userId, 'collection')
    await this.prisma.$transaction(async (tx) => {
      await lockFileReferences(tx)
      const changed = await tx.learningCollectionItem.deleteMany({ where: { id: itemId, collection: { id, ownerId: userId } } })
      if (!changed.count) throw new ForbiddenException('只能修改自己的合集')
      await this.detectCollection(tx, await tx.learningCollection.update({ where: { id }, data: { revision: { increment: 1 } } }))
    })
    return this.collection(userId, id)
  }

  async reorderCollection(userId: string, id: string, expectedRevision: number, itemIds: string[]) {
    const visible = await this.prisma.learningCollection.findFirst({ where: { id, ownerId: userId }, select: { visibility: true } })
    if (!visible) throw new ConflictException('合集已变化、不可编辑或不存在')
    if (visible.visibility === 'community') await this.visibility.assertOperation(userId, 'collection')
    await this.prisma.$transaction(async (tx) => {
      await lockFileReferences(tx)
      await tx.$queryRaw`SELECT id FROM learning_collections WHERE id = ${id} FOR UPDATE`
      const collection = await tx.learningCollection.findFirst({ where: { id, ownerId: userId, revision: expectedRevision } })
      if (!collection) throw new ConflictException('合集已变化、不可编辑或不存在')
      const slots = await tx.learningCollectionItem.findMany({ where: { collectionId: id, id: { in: itemIds } }, select: { id: true, sortOrder: true }, orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }], take: itemIds.length })
      if (!itemIds.length || slots.length !== itemIds.length) throw new BadRequestException('排序项必须属于当前合集且不能重复')
      for (const [index, itemId] of itemIds.entries()) await tx.learningCollectionItem.update({ where: { id: itemId }, data: { sortOrder: slots[index].sortOrder } })
      await this.detectCollection(tx, await tx.learningCollection.update({ where: { id }, data: { revision: { increment: 1 } } }))
    })
    return this.collection(userId, id)
  }

  private async detectCollection(tx: Prisma.TransactionClient, row: LearningCollection) {
    const result = row.visibility === 'community' ? await this.detection.check(tx, { collectionName: row.name, collectionDescription: row.description, collectionGoal: row.learningGoal }) : null
    const contentStatus = result?.action === 'review' ? 'pending_review' : 'published'
    if (row.contentStatus !== contentStatus) await tx.learningCollection.update({ where: { id: row.id, revision: row.revision }, data: { contentStatus } })
    if (result) await this.detection.record(tx, { type: 'collection', id: row.id, revision: row.revision, authorId: row.ownerId, submittedById: row.ownerId }, result, { name: row.name, description: row.description, learningGoal: row.learningGoal, visibility: row.visibility })
    else await tx.contentReview.updateMany({ where: { targetType: 'collection', targetId: row.id, status: 'pending' }, data: { status: 'superseded' } })
  }

  async playback(userId: string, assetId: string) {
    const asset = await this.visibleAsset(userId, assetId, true)
    const expires = Math.floor(Date.now() / 1000) + 6 * 60 * 60
    const token = this.sign('play', assetId, userId, expires)
    const posterFileId = asset.contribution?.coverFileId || asset.posterFileId
    const poster = posterFileId ? this.mediaUrl(posterFileId, userId) : null
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
    const userId = await this.verify('play', assetId, token)
    const asset = await this.visibleAsset(userId, assetId, true)
    return this.storage.open(asset.playableFileId!, start, end)
  }

  async mediaFile(fileId: string, token: string) {
    const userId = await this.verify('media', fileId, token)
    await this.fileAccess.assert(userId, fileId)
    return this.storage.open(fileId)
  }

  async publicCover(fileId: string) {
    const file = await this.prisma.fileRecord.findUnique({ where: { id: fileId } })
    if (!file || file.quarantinedAt || !['image/jpeg', 'image/png', 'image/webp', 'image/avif'].includes(file.mimeType)) throw new NotFoundException('封面不存在')
    // 社区上传默认私有；是否可预览由下方已发布公开作品的实际封面绑定决定。
    const scope = await this.visibility.publicPostsSql('')
    const rows = await this.prisma.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      SELECT p.id FROM community_posts p JOIN resource_contributions c ON c.post_id = p.id
      LEFT JOIN video_assets v ON v.id = c.video_asset_id
      WHERE ${scope} AND (c.kind <> 'video' OR v.status = 'ready') AND (
        COALESCE(c.cover_file_id, v.poster_file_id, jsonb_path_query_first(p.content_blocks, '$[*] ? (@.type == "image")')->>'fileId') = ${fileId}
        OR p.content_blocks @> ${JSON.stringify([{ type: 'image', fileId, alt: '资源中心 Banner' }])}::jsonb
      ) LIMIT 1`)
    if (!rows.length) throw new NotFoundException('封面不存在或内容未公开')
    // 已发布的公开预览不要求上传者继续具备校园发帖资格；账号封禁仍立即生效。
    if (!await this.prisma.user.count({ where: { id: file.uploadedBy, AND: [availableAccount()] } })) throw new NotFoundException('封面不存在或账号不可用')
    return this.storage.open(fileId)
  }

  private publicCoverUrl(fileId: string) { return `/api/v1/resource-hub/covers/${encodeURIComponent(fileId)}` }

  async attachmentFile(fileId: string, token: string) {
    const userId = await this.verify('attachment', fileId, token)
    await this.assertMediaPost(userId, { contribution: { is: { attachmentFileId: fileId } } }, fileId)
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
          post: { status: 'published', visibility: 'public', deletedAt: null, author: availableAccount(), moderationActions: { none: activeSanction('takedown') } },
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
    const scope = createHash('sha256').update(JSON.stringify(['admin-resources', userId, query.keyword, query.kind, query.category])).digest('hex')
    const cursor = readRowCursor(query.cursor, scope)
    const contribution = {
      ...(query.category ? { category: { code: query.category } } : {}),
      ...(query.kind === 'all' ? {} : { kind: query.kind }),
    }
    const rows = await this.prisma.communityPost.findMany({
      where: {
        contribution: Object.keys(contribution).length ? { is: contribution } : { isNot: null },
        AND: [await this.visibility.adminWhere(), ...(cursor ? [{ OR: [{ updatedAt: { lt: cursor.at } }, { updatedAt: cursor.at, id: { lt: cursor.id } }] }] : [])],
        ...(query.keyword ? { OR: [{ title: { contains: query.keyword, mode: 'insensitive' } }, { plainText: { contains: query.keyword, mode: 'insensitive' } }] } : {}),
      },
      include: { ...postInclude, _count: { select: { reports: true } } },
      orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
      take: query.limit + 1,
    })
    const page = rows.slice(0, query.limit)
    const mapped = await this.mapContributions(userId, page, await this.posts.mapMany(userId, page))
    const items = page.flatMap((row) => {
      const item = mapped.find((candidate) => candidate.postId === row.id)
      return item ? [{ ...item, status: row.status, visibility: row.visibility, reportCount: row._count.reports, deletedAt: row.deletedAt?.toISOString() || null }] : []
    })
    return { items, nextCursor: rows.length > query.limit ? nextRowCursor(page.at(-1)!, scope) : null }
  }

  async updateContribution(actorId: string, postId: string, input: ContributionAdminDto) {
    const category = await this.prisma.resourceCategory.findFirst({ where: { id: input.categoryId, active: true } })
    if (!category) throw new BadRequestException('资源分类不存在或已停用')
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM community_posts WHERE id = ${postId} FOR UPDATE`
      if (!await tx.communityPost.count({ where: { AND: [{ id: postId }, await this.visibility.adminWhere(tx)] } })) throw new NotFoundException('资源作品不存在或为私人草稿')
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

  async processingFailures(query: ResourceHubQueryDto = new ResourceHubQueryDto()) {
    const cursor = readRowCursor(query.cursor, 'processing')
    const rows = await this.prisma.videoAsset.findMany({
      where: { status: 'failed', ...(cursor ? { OR: [{ updatedAt: { lt: cursor.at } }, { updatedAt: cursor.at, id: { lt: cursor.id } }] } : {}) },
      select: { id: true, originalName: true, attempts: true, lastError: true, updatedAt: true, uploader: { select: { id: true, displayName: true } }, contribution: { select: { postId: true, post: { select: { title: true } } } } },
      orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
      take: query.limit + 1,
    })
    const items = rows.slice(0, query.limit)
    return { items, nextCursor: rows.length > query.limit ? nextRowCursor(items.at(-1)!, 'processing') : null }
  }

  capacity(userId: string) { return this.quota.capacity(userId) }

  async mediaRuntime() {
    const [capacity, rows, unavailableFiles, quarantinedFiles, pending, failures] = await Promise.all([
      this.quota.capacity(),
      this.prisma.videoAsset.findMany({ where: { status: { in: ['uploaded', 'processing', 'failed'] } }, select: { id: true, originalName: true, status: true, attempts: true, lastError: true, leaseExpiresAt: true, sourceFile: { select: { quarantinedAt: true } } }, orderBy: [{ updatedAt: 'desc' }, { id: 'asc' }], take: 100 }),
      this.prisma.fileRecord.count({ where: { scanStatus: { in: ['unavailable', 'not_scanned'] } } }),
      this.prisma.fileRecord.count({ where: { quarantinedAt: { not: null } } }),
      this.prisma.mediaGcJob.count(),
      this.prisma.mediaGcJob.findMany({ where: { attempts: { gt: 0 } }, select: { id: true, attempts: true, lastError: true }, orderBy: { updatedAt: 'desc' }, take: 20 }),
    ])
    return { capacity, queue: rows.map(({ sourceFile, leaseExpiresAt, ...row }) => ({ ...row, leaseExpiresAt: leaseExpiresAt?.toISOString() ?? null, retryable: row.status === 'failed' && !sourceFile.quarantinedAt && row.attempts < Math.max(1, Math.min(5, Number(this.config.get('VIDEO_PROCESSING_MAX_ATTEMPTS') || 3))) })), scan: { configured: !!this.config.get('MEDIA_CLAMSCAN_PATH'), unavailableFiles, quarantinedFiles }, cleanup: { pending, failures } }
  }

  async resourceReports(query: ResourceHubQueryDto = new ResourceHubQueryDto()) {
    const cursor = readRowCursor(query.cursor, 'reports')
    const rows = await this.prisma.communityReport.findMany({
      where: { post: { contribution: { isNot: null } }, ...(cursor ? { OR: [{ createdAt: { lt: cursor.at } }, { createdAt: cursor.at, id: { lt: cursor.id } }] } : {}) },
      select: { id: true, postId: true, reason: true, description: true, status: true, createdAt: true, handledAt: true },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: query.limit + 1,
    })
    const items = rows.slice(0, query.limit)
    return { items, nextCursor: rows.length > query.limit ? nextRowCursor(items.at(-1)!, 'reports') : null }
  }

  async adminCollections(query: ResourceHubQueryDto = new ResourceHubQueryDto()) {
    const cursor = readRowCursor(query.cursor, 'admin-collections')
    const rows = await this.prisma.learningCollection.findMany({
      where: { visibility: 'community', ...(cursor ? { OR: [{ updatedAt: { lt: cursor.at } }, { updatedAt: cursor.at, id: { lt: cursor.id } }] } : {}) },
      select: {
        id: true,
        name: true,
        description: true,
        learningGoal: true,
        revision: true,
        contentStatus: true,
        updatedAt: true,
        owner: { select: { id: true, username: true, displayName: true } },
        _count: { select: { items: true, courseLinks: true } },
        courseLinks: { select: { courseId: true, courseVersionId: true, sourceRevision: true, createdAt: true }, orderBy: { createdAt: 'desc' }, take: 5 },
      },
      orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
      take: query.limit + 1,
    })
    const items = rows.slice(0, query.limit)
    return { items, nextCursor: rows.length > query.limit ? nextRowCursor(items.at(-1)!, 'admin-collections') : null }
  }

  private async selectItems(userId: string, query: ResourceHubQueryDto, options: HubSelection, scope: Prisma.Sql, asOf = new Date(), cursor?: HubCursor): Promise<HubCandidate[]> {
    const popular = query.sort === 'popular'
    const keyword = query.keyword.trim()
    const postFilters = [scope, Prisma.sql`COALESCE(p.published_at, p.created_at) <= ${asOf}`, Prisma.sql`(c.kind <> 'video' OR v.status = 'ready')`]
    if (query.category) postFilters.push(Prisma.sql`category.code = ${query.category}`)
    if (query.authorId) postFilters.push(Prisma.sql`p.author_id = ${query.authorId}`)
    if (query.kind !== 'all') postFilters.push(Prisma.sql`c.kind::text = ${query.kind}`)
    if (options.sourceType === 'legacy_resource') postFilters.push(Prisma.sql`FALSE`)
    if (options.postIds) postFilters.push(options.postIds.length ? Prisma.sql`p.id IN (${Prisma.join(options.postIds)})` : Prisma.sql`FALSE`)
    if (options.liveReplay) postFilters.push(Prisma.sql`c.live_replay = true AND c.kind = 'video'`)
    if (options.liked) postFilters.push(Prisma.sql`EXISTS (SELECT 1 FROM community_post_reactions reaction WHERE reaction.user_id = ${userId} AND reaction.post_id = p.id AND reaction.reaction_type = 'like')`)
    if (options.related) postFilters.push(Prisma.sql`p.id <> ${options.related.postId} AND (c.category_id IS NOT DISTINCT FROM ${options.related.categoryId} OR c.tags && ${options.related.tags}::text[])`)
    if (keyword) postFilters.push(Prisma.sql`(
      strpos(lower(COALESCE(p.title, '未命名资源')), lower(${keyword})) > 0
      OR (${!!userId} AND strpos(lower(left(p.plain_text, 220)), lower(${keyword})) > 0)
      OR EXISTS (SELECT 1 FROM unnest(c.tags) tag WHERE strpos(lower(tag), lower(${keyword})) > 0)
      OR (${!!userId} AND strpos(lower(CASE WHEN EXISTS (SELECT 1 FROM community_moderation_actions m WHERE m.subject_id = p.author_id AND m.target_type = 'profile' AND m.action = 'takedown' AND m.revoked_at IS NULL AND (m.expires_at IS NULL OR m.expires_at > NOW())) THEN '账号资料暂不可见' ELSE author.display_name END), lower(${keyword})) > 0))`)
    const legacyData = Prisma.sql`COALESCE(NULLIF(version.snapshot->'data', 'null'::jsonb), version.snapshot->'payload', '{}'::jsonb)`
    const legacyTags = Prisma.sql`CASE WHEN jsonb_typeof(${legacyData}->'tags') = 'array' THEN ${legacyData}->'tags' ELSE '[]'::jsonb END`
    const legacyFilters = [Prisma.sql`r.deleted_at IS NULL AND r.status = 'published' AND COALESCE(r.published_at, version.created_at) <= ${asOf}`]
    if (options.sourceType === 'contribution' || query.category || query.authorId || !['all', 'document'].includes(query.kind) || options.postIds || options.liveReplay || options.liked) legacyFilters.push(Prisma.sql`FALSE`)
    if (keyword) legacyFilters.push(Prisma.sql`(strpos(lower(COALESCE(version.snapshot->>'title', '')), lower(${keyword})) > 0 OR strpos(lower(COALESCE(version.snapshot->>'summary', '')), lower(${keyword})) > 0 OR EXISTS (SELECT 1 FROM jsonb_array_elements_text(${legacyTags}) tag WHERE strpos(lower(tag), lower(${keyword})) > 0))`)
    if (options.related?.categoryId) legacyFilters.push(Prisma.sql`${legacyTags} ?| ${options.related.tags}::text[]`)
    const postCounts = popular ? Prisma.sql`LEFT JOIN (
      SELECT target_id, event_type, count(*)::double precision AS views FROM activity_events
      WHERE target_type = 'post' AND event_type IN ('resource_valid_watch', 'community_post_click') AND created_at <= ${asOf}
        ${options.since ? Prisma.sql`AND created_at >= ${options.since}` : Prisma.empty}
      GROUP BY target_id, event_type
    ) metrics ON metrics.target_id = p.id AND metrics.event_type = CASE WHEN c.kind = 'video' THEN 'resource_valid_watch' ELSE 'community_post_click' END` : Prisma.empty
    const legacyCounts = popular ? Prisma.sql`LEFT JOIN (
      SELECT resource_id, count(*)::double precision AS views FROM resource_views WHERE created_at <= ${asOf}
        ${options.since ? Prisma.sql`AND created_at >= ${options.since}` : Prisma.empty}
      GROUP BY resource_id
    ) metrics ON metrics.resource_id = r.id` : Prisma.empty
    const seek = cursor ? Prisma.sql`WHERE ${popular ? Prisma.sql`(views, published_at, id COLLATE "C", source_type COLLATE "C") < (${cursor.views}, ${new Date(cursor.publishedAt)}, ${cursor.id}, ${cursor.sourceType})` : Prisma.sql`(published_at, id COLLATE "C", source_type COLLATE "C") < (${new Date(cursor.publishedAt)}, ${cursor.id}, ${cursor.sourceType})`}` : Prisma.empty
    return this.prisma.$queryRaw<HubCandidate[]>(Prisma.sql`
      WITH candidates AS (
        SELECT 'contribution'::text AS source_type, p.id, p.id AS database_id, COALESCE(p.published_at, p.created_at) AS published_at, ${popular ? Prisma.sql`COALESCE(metrics.views, 0)` : Prisma.sql`0::double precision`} AS views, c.featured
        FROM community_posts p JOIN resource_contributions c ON c.post_id = p.id
        JOIN users author ON author.id = p.author_id
        LEFT JOIN resource_categories category ON category.id = c.category_id
        LEFT JOIN video_assets v ON v.id = c.video_asset_id
        ${postCounts} WHERE ${Prisma.join(postFilters, ' AND ')}
        UNION ALL
        SELECT 'legacy_resource'::text, r.slug, r.id, COALESCE(r.published_at, version.created_at), ${popular ? Prisma.sql`COALESCE(metrics.views, 0)` : Prisma.sql`0::double precision`}, COALESCE((${legacyData}->>'featured') = 'true', false)
        FROM resources r JOIN resource_versions version ON version.id = r.published_version_id
        ${legacyCounts} WHERE ${Prisma.join(legacyFilters, ' AND ')}
      )
      SELECT source_type AS "sourceType", id, database_id AS "databaseId", published_at AS "publishedAt", views, featured
      FROM candidates ${seek}
      ORDER BY ${options.featuredFirst ? Prisma.sql`featured DESC,` : Prisma.empty} ${popular ? Prisma.sql`views DESC,` : Prisma.empty} published_at DESC, id COLLATE "C" DESC, source_type COLLATE "C" DESC
      LIMIT ${query.limit + 1}`)
  }

  private async hydrateItems(userId: string, candidates: HubCandidate[], asOf = new Date()): Promise<ResourceHubItemDto[]> {
    if (!candidates.length) return []
    const contributionIds = candidates.filter((item) => item.sourceType === 'contribution').map((item) => item.id)
    const legacyIds = candidates.filter((item) => item.sourceType === 'legacy_resource').map((item) => item.databaseId)
    const [rows, legacy] = await Promise.all([
      contributionIds.length ? this.prisma.communityPost.findMany({ where: { id: { in: contributionIds }, AND: [await this.visibility.where(userId)] }, include: postInclude, take: contributionIds.length }) : [],
      legacyIds.length ? this.resources.list({ page: 1, pageSize: legacyIds.length, keyword: '' }, true, legacyIds) : { items: [] },
    ])
    const commentCounts = !userId && rows.length ? await this.prisma.communityComment.groupBy({ by: ['postId'], where: { postId: { in: rows.map(row => row.id) }, status: 'published', deletedAt: null, ...visibleComment() }, _count: { _all: true } }) : []
    const badgeContext = await loadBadgeContext(this.prisma)
    const summaries = !rows.length ? [] : userId ? await this.posts.mapMany(userId, rows) : rows.map(row => ({ id: row.id, author: authorDto(row.author, badgeContext), publishedAt: (row.publishedAt || row.createdAt).toISOString(), stats: { comments: commentCounts.find(count => count.postId === row.id)?._count._all || 0 } }))
    const contributions = rows.length ? await this.mapContributions(userId, rows, summaries, asOf) : []
    const mapped = new Map<string, ResourceHubItemDto>(contributions.map((item) => [`contribution:${item.id}`, item]))
    for (const item of legacy.items) mapped.set(`legacy_resource:${item.slug}`, {
      sourceType: 'legacy_resource', id: item.slug, postId: null, title: item.title, summary: userId ? item.summary : '', kind: 'document', category: null,
      tags: Array.isArray(item.data.tags) ? item.data.tags : [], coverUrl: typeof item.data.cover === 'string' ? item.data.cover : null, author: null,
      stats: { views: item.views, likes: 0, comments: 0, bookmarks: Number(item.data.favorites || 0), downloads: item.downloads },
      durationSeconds: null, videoAssetId: null, mediaStatus: null, publishedAt: item.publishedAt || item.updatedAt,
      route: `/resources?preview=${encodeURIComponent(item.slug)}`, featured: Boolean(item.data.featured), liveReplay: false,
    })
    return candidates.flatMap((candidate) => {
      const item = mapped.get(`${candidate.sourceType}:${candidate.id}`)
      return item ? [{ ...item, publishedAt: candidate.publishedAt.toISOString() }] : []
    })
  }

  private async mapContributions(userId: string, rows: HydratedPost[], posts: Array<{ id: string; author: ResourceHubItemDto['author']; publishedAt: string; stats: { comments: number } }>, asOf = new Date()) {
    const counts = rows.length ? await this.prisma.activityEvent.groupBy({ by: ['targetId', 'eventType'], where: { targetType: 'post', targetId: { in: rows.map((row) => row.id) }, eventType: { in: ['resource_valid_watch', 'community_post_click'] }, createdAt: { lte: asOf } }, _count: { _all: true } }) : []
    const views = new Map(counts.map((row) => [`${row.targetId}:${row.eventType}`, row._count._all]))
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
        summary: userId ? row.plainText.slice(0, 220) : '',
        kind: contribution.kind,
        category: contribution.category ? { id: contribution.category.id, code: contribution.category.code, name: contribution.category.name, description: contribution.category.description, icon: contribution.category.icon, sortOrder: contribution.category.sortOrder } : null,
        tags: contribution.tags,
        coverUrl: coverFileId ? row.visibility === 'public' && row.status === 'published' ? this.publicCoverUrl(coverFileId) : this.mediaUrl(coverFileId, userId) : null,
        author: userId ? post.author : null,
        stats: { views: views.get(`${row.id}:${contribution.kind === 'video' ? 'resource_valid_watch' : 'community_post_click'}`) || 0, plays: contribution.kind === 'video' ? views.get(`${row.id}:resource_valid_watch`) || 0 : null, impressions: row.impressionCount, likes: row.likeCount, comments: post.stats.comments, bookmarks: row.bookmarkCount, downloads: 0 },
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

  private async collectionSummaries(userId: string, rows: Array<LearningCollection & { owner: Parameters<typeof authorDto>[0] }>) {
    if (!rows.length) return []
    const scope = await this.visibility.publicPostsSql(userId)
    const counts = await this.prisma.$queryRaw<Array<{ id: string; itemCount: number; videoCount: number; durationSeconds: number }>>(Prisma.sql`
      SELECT item.collection_id AS id, count(*)::integer AS "itemCount", count(v.id)::integer AS "videoCount",
        COALESCE(sum(v.duration_seconds), 0)::double precision AS "durationSeconds"
      FROM learning_collection_items item
      JOIN resource_contributions c ON c.post_id = item.contribution_post_id
      JOIN community_posts p ON p.id = c.post_id
      LEFT JOIN video_assets v ON v.id = c.video_asset_id
      WHERE item.collection_id IN (${Prisma.join(rows.map((row) => row.id))}) AND ${scope}
      GROUP BY item.collection_id`)
    const badgeContext = await loadBadgeContext(this.prisma)
    const byId = new Map(counts.map((row) => [row.id, row]))
    return rows.map((row) => this.collectionSummary(row, userId, byId.get(row.id) || { itemCount: 0, videoCount: 0, durationSeconds: 0 }, badgeContext))
  }

  private collectionSummary(row: {
    id: string; name: string; description: string; learningGoal: string; visibility: 'private' | 'community'; contentStatus: string; systemKind: string | null; revision: number; updatedAt: Date
    ownerId: string; owner: Parameters<typeof authorDto>[0]
  }, userId: string, counts: Pick<LearningCollectionSummaryDto, 'itemCount' | 'videoCount' | 'durationSeconds'>, badgeContext: BadgeContext): LearningCollectionSummaryDto {
    return {
      id: row.id,
      name: row.name,
      description: row.description,
      visibility: row.visibility,
      contentStatus: row.contentStatus as LearningCollectionSummaryDto['contentStatus'],
      systemKind: row.systemKind === 'watch_later' ? 'watch_later' : null,
      learningGoal: row.learningGoal,
      ...counts,
      owner: authorDto(row.owner, badgeContext),
      isOwner: row.ownerId === userId,
      revision: row.revision,
      updatedAt: row.updatedAt.toISOString(),
    }
  }

  private async assertMediaPost(userId: string, media: Prisma.CommunityPostWhereInput, targetId: string) {
    await this.visibility.assertMediaEligibility(userId)
    const post = await this.prisma.communityPost.findFirst({ where: { AND: [media, await this.visibility.where(userId, true)] }, select: { authorId: true } })
    if (post) { await this.visibility.assertMediaEligibility(post.authorId); return }
    const reviewer = await this.prisma.user.count({ where: { id: userId, AND: ['community.moderate', 'resource.read'].map((code) => ({ userRoles: { some: { role: { permissions: { some: { permission: { code } } } } } } })) } })
    if (reviewer && await this.prisma.communityPost.count({ where: { AND: [media, await this.visibility.adminWhere()] } })) {
      await this.visibility.auditAdminRead(userId, 'resource_media', targetId)
      return
    }
    throw new NotFoundException('媒体不存在或不可见')
  }

  private async visibleAsset(userId: string, id: string, preview = false) {
    await this.visibility.assertMediaEligibility(userId)
    const asset = await this.prisma.videoAsset.findFirst({
      where: { id, status: 'ready', playableFileId: { not: null }, durationSeconds: { gt: 0 }, ...(preview ? {} : { contribution: { is: { post: await this.visibility.where(userId) } } }) },
      include: { contribution: true },
    })
    if (!asset?.contribution) throw new NotFoundException('视频不存在、未就绪或不可见')
    await this.visibility.assertMediaEligibility(asset.uploaderId)
    if (preview) await this.assertMediaPost(userId, { id: asset.contribution.postId }, id)
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
    const user = this.request?.user
    if (user?.id !== userId || !user.sessionId) throw new ForbiddenException('媒体授权需要有效设备会话')
    const payload = Buffer.from(`${purpose}\n${targetId}\n${userId}\n${expires}\n${user.sessionId}\n${user.sessionVersion || 0}`).toString('base64url')
    const signature = createHmac('sha256', this.tokenSecret).update(payload).digest('base64url')
    return `${payload}.${signature}`
  }

  private async verify(purpose: string, targetId: string, token: string) {
    if (typeof token !== 'string' || token.length > 2048 || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token)) throw new ForbiddenException('播放凭据无效')
    const [payload, received] = token.split('.')
    if (!payload || !received) throw new ForbiddenException('播放凭据无效')
    const expected = createHmac('sha256', this.tokenSecret).update(payload).digest()
    const actual = Buffer.from(received, 'base64url')
    if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) throw new ForbiddenException('播放凭据无效')
    const fields = Buffer.from(payload, 'base64url').toString('utf8').split('\n')
    const [tokenPurpose, tokenTarget, userId, expiresValue, sessionId, sessionVersion] = fields
    if (fields.length !== 6 || !userId || !sessionId || !/^\d+$/.test(sessionVersion) || !/^\d+$/.test(expiresValue) || !Number.isSafeInteger(Number(expiresValue)) || tokenPurpose !== purpose || tokenTarget !== targetId || Number(expiresValue) <= Math.floor(Date.now() / 1000)) throw new ForbiddenException('播放凭据已失效')
    const session = await this.prisma.refreshToken.findUnique({ where: { id: sessionId }, include: { user: { include: authUserInclude } } })
    if (session?.userId === userId) assertNotReplaced(session)
    if (!session || session.userId !== userId || session.revokedAt || session.expiresAt <= new Date() || session.user.status !== 'active' || session.user.sessionVersion !== Number(sessionVersion)) throw new ForbiddenException('媒体所属设备会话已失效')
    const administrative = authUserDto(session.user).permissions.length > 0
    if (session.client === 'admin' || administrative) {
      assertAdminNetwork(this.config, this.request?.ip)
      if (session.client !== 'admin' || !session.mfaVerified || !session.user.mfaEnabledAt) throw new ForbiddenException('管理媒体需要后台 MFA 会话')
    }
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
