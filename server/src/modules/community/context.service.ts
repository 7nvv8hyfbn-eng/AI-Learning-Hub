import { normalizeTopicName } from '@ai-learning-hub/contracts'
import { availableAccount, visibleProfile, visibleComment } from './governance-policy'
import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common'
import type { CommunityBindingInput, CommunityBindingContextDto, CommunityContextDto, CommunityProfileDto, CommunityProfileRelationsDto, CommunityProfileTimelineDto, CommunityTopicDto } from '@ai-learning-hub/contracts'
import { PrismaService } from '../../prisma/prisma.service'
import { ContentReferenceService } from '../../common/content-reference/content-reference.service'
import { CommunityVisibilityPolicyService } from './visibility.service'
import { CommunityInteractionService } from './interaction.service'
import { authorDto, authorInclude, profileMediaUrl } from './community.mapper'
import type { OnboardingDto, ProfileDto, ProfileMediaDto, ProfileRelationQueryDto, ProfileTimelineQueryDto } from './community.dto'
import { RegistrationService } from '../auth/registration.service'
import { normalizeUsername } from '../auth/username'
import { authUserDto, authUserInclude } from '../auth/auth.mapper'
import { Prisma } from '@prisma/client'
import { actionEvent, lockFileReferences, reserveIdempotency } from '../../common/persistence'
import { ContentDetectionService } from './content-detection.service'
import { CommunityPostService, postInclude } from './post.service'
import { STORAGE_SERVICE, type StorageService } from '../storage/storage.types'
import { releaseUnboundMediaFile } from '../media/media-gc'
import sharp from 'sharp'
import { createHash } from 'node:crypto'

interface ProfileCursor { scope: string; at: string; id: string }
const encodeCursor = (scope: string, at: Date, id: string) => Buffer.from(JSON.stringify({ scope, at: at.toISOString(), id })).toString('base64url')
const decodeCursor = (cursor: string | undefined, scope: string): ProfileCursor | null => {
  if (!cursor) return null
  try {
    const parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString()) as ProfileCursor
    if (parsed.scope !== scope || typeof parsed.id !== 'string' || parsed.id.length > 100 || Number.isNaN(new Date(parsed.at).getTime())) throw new Error()
    return parsed
  } catch { throw new BadRequestException('分页游标无效') }
}

@Injectable()
export class CommunityContextService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly visibility: CommunityVisibilityPolicyService,
    private readonly references: ContentReferenceService,
    private readonly interactions: CommunityInteractionService,
    private readonly registration: RegistrationService,
    private readonly posts: CommunityPostService,
    @Inject(STORAGE_SERVICE) private readonly storage: StorageService,
    private readonly detection: ContentDetectionService,
  ) {}
  async byUsername(userId: string, username: string) {
    const user = await this.prisma.user.findFirst({ where: { username: { equals: username, mode: 'insensitive' } }, select: { id: true } })
    if (!user) throw new NotFoundException('用户不存在')
    return this.profile(userId, user.id)
  }
  async changeUsername(userId: string, username: string) {
    await this.visibility.assertOperation(userId, 'profile')
    const normalized = normalizeUsername(username)
    try {
      return await this.prisma.$transaction(async (tx) => {
        await lockFileReferences(tx)
        const changed = await tx.user.updateMany({ where: { id: userId, usernameChangedAt: null }, data: { revision: { increment: 1 } } })
        if (!changed.count) throw new BadRequestException('公开用户名只能修改一次')
        const contentDetection = await this.detection.saveProfile(tx, userId, { username: normalized })
        await actionEvent(tx, userId, 'profile_updated', 'user', userId)
        return { ...authUserDto(await tx.user.findUniqueOrThrow({ where: { id: userId }, include: authUserInclude })), contentDetection }
      })
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') throw new ConflictException('此用户名已被使用')
      throw error
    }
  }
  async onboarding(userId: string, input: OnboardingDto) {
    await this.visibility.viewer(userId)
    const settings = await this.registration.settings()
    const schoolSetting = await this.prisma.systemSetting.findUnique({ where: { key: 'campus_school_id' } })
    const campusSchoolId = typeof schoolSetting?.value === 'string' && await this.prisma.school.count({ where: { id: schoolSetting.value, status: 'active' } }) ? schoolSetting.value : null
    if (campusSchoolId && input.schoolId && input.schoolId !== campusSchoolId) throw new BadRequestException('学校由当前校园部署统一配置')
    const schoolId = campusSchoolId || input.schoolId || null
    if (settings.schoolRequired && !schoolId) throw new BadRequestException('请选择学校')
    if (schoolId && !await this.prisma.school.count({ where: { id: schoolId, status: 'active' } })) throw new BadRequestException('学校不存在')
    if (input.departmentId && (!schoolId || !await this.prisma.department.count({ where: { id: input.departmentId, schoolId } }))) throw new BadRequestException('院系不属于所选学校')
    await this.prisma.$transaction(async (tx) => {
      await lockFileReferences(tx)
      if (!input.expectedRevision || !input.expectedProfileRevision) throw new BadRequestException('请携带账号与社区资料版本')
      if (!(await tx.user.updateMany({ where: { id: userId, revision: input.expectedRevision }, data: { schoolId, departmentId: input.departmentId || null, major: input.major, grade: input.grade, onboardingCompletedAt: new Date(), revision: { increment: 1 } } })).count) throw new ConflictException('资料已更新，请重新读取')
      await this.saveInterests(tx, userId, input.themeIds)
      await this.detection.saveProfile(tx, userId, { headline: input.headline }, userId, input.expectedProfileRevision)
      await actionEvent(tx, userId, 'onboarding_completed', 'user', userId)
    })
    return authUserDto(await this.prisma.user.findUniqueOrThrow({ where: { id: userId }, include: authUserInclude }))
  }
  async bindingContext(userId: string, input: CommunityBindingInput): Promise<CommunityBindingContextDto> {
    await this.visibility.viewer(userId)
    const binding = (await this.references.resolveMany([input], userId, true)).get(`${input.type}:${input.id}`)!
    const courses = await this.prisma.course.findMany({ where: { status: 'published', deletedAt: null, OR: [{ id: input.type === 'course' ? binding.id : '__none__' }, { labs: { some: { labId: input.type === 'lab' ? binding.id : '__none__' } } }] }, select: { themeId: true }, take: 10 })
    const themes = [...courses.flatMap((row) => row.themeId ? [row.themeId] : []), ...(input.type === 'theme' ? [binding.id] : [])]
    const topics = await this.prisma.communityTopic.findMany({ where: { status: 'active', OR: [{ themeId: { in: themes } }, { posts: { some: { post: { AND: [await this.visibility.where(userId), { bindings: { some: { targetType: input.type, targetId: binding.id } } }] } } } }] }, select: { id: true }, orderBy: { sortOrder: 'asc' }, take: 3 })
    return { binding, topicIds: topics.map((topic) => topic.id) }
  }
  async topic(userId: string, slug: string): Promise<CommunityTopicDto> {
    await this.visibility.viewer(userId)
    const row = await this.prisma.communityTopic.findFirst({ where: { slug, status: 'active' }, include: { follows: { where: { userId } } } })
    if (!row) throw new NotFoundException('话题不存在或已关闭')
    const { follows, ...topic } = row
    return { ...topic, following: follows.length > 0 }
  }
  async topics(userId: string, query?: { text: string; after?: string; limit: number }): Promise<CommunityTopicDto[]> {
    await this.visibility.viewer(userId)
    const text = query?.text.normalize('NFKC').trim() || ''
    const rows = await this.prisma.communityTopic.findMany({ where: { status: 'active', ...(query?.after ? { id: { gt: query.after } } : {}), ...(text ? { OR: [{ normalizedName: { contains: normalizeTopicName(text) } }, { name: { contains: text, mode: 'insensitive' } }, { description: { contains: text, mode: 'insensitive' } }] } : {}) }, include: { follows: { where: { userId } } }, orderBy: query ? { id: 'asc' } : [{ recommended: 'desc' }, { sortOrder: 'asc' }], take: query ? Math.max(1, Math.min(31, query.limit)) : 200 })
    return rows.map(({ follows, ...row }) => ({ ...row, following: follows.length > 0 }))
  }
  async profile(userId: string, username: string): Promise<CommunityProfileDto> {
    await this.visibility.viewer(userId)
    const user = await this.prisma.user.findFirst({ where: { id: username, ...(username === userId ? availableAccount() : visibleProfile()) }, include: authorInclude })
    if (!user) throw new NotFoundException('用户不存在')
    const relations = user.id === userId ? [] : await this.prisma.communityFeedback.findMany({
      where: { OR: [{ userId, targetId: user.id, feedbackType: { in: ['mute_author', 'block'] } }, { userId: user.id, targetId: userId, feedbackType: 'block' }] },
      select: { userId: true, feedbackType: true },
    })
    if (relations.some((row) => row.userId === user.id && row.feedbackType === 'block')) throw new NotFoundException('用户不存在')
    const muted = relations.some((row) => row.userId === userId && row.feedbackType === 'mute_author')
    const blocked = relations.some((row) => row.userId === userId && row.feedbackType === 'block')
    const visibleWhere = await this.visibility.where(userId)
    const excluded = (await this.visibility.authorExclusions(userId)).authors
    const [topics, following, followedBy, postCount, replyCount, likes, followerCount, followingCount, pinned] = await Promise.all([
      this.prisma.communityTopic.findMany({ where: { status: 'active', follows: { some: { userId: user.id } } }, include: { follows: { where: { userId } } }, orderBy: [{ recommended: 'desc' }, { sortOrder: 'asc' }], take: 200 }),
      this.prisma.communityUserFollow.count({ where: { followerId: userId, followeeId: user.id } }),
      this.prisma.communityUserFollow.count({ where: { followerId: user.id, followeeId: userId } }),
      this.prisma.communityPost.count({ where: { AND: [visibleWhere, { authorId: user.id }] } }),
      this.prisma.communityComment.count({ where: { authorId: user.id, deletedAt: null, status: 'published', ...visibleComment(), post: visibleWhere } }),
      this.prisma.communityPost.aggregate({ where: { AND: [visibleWhere, { authorId: user.id }] }, _sum: { likeCount: true } }),
      this.prisma.communityUserFollow.count({ where: { followeeId: user.id, followerId: { notIn: excluded }, follower: visibleProfile() } }),
      this.prisma.communityUserFollow.count({ where: { followerId: user.id, followeeId: { notIn: excluded }, followee: visibleProfile() } }),
      user.communityProfile?.pinnedPostId ? this.prisma.communityPost.findFirst({
        where: { AND: [visibleWhere, { id: user.communityProfile.pinnedPostId, authorId: user.id, status: 'published', visibility: 'public', deletedAt: null }] },
        include: postInclude,
      }) : null,
    ])
    const pinnedPost = pinned ? (await this.posts.mapMany(userId, [pinned]))[0] : null
    const submission = user.id === userId ? await this.prisma.contentReview.findFirst({ where: { targetType: 'profile', targetId: userId }, orderBy: { contentRevision: 'desc' } }) : null
    const detection = submission ? await this.detection.result('profile', userId, submission.contentRevision) : undefined
    const held = submission && ['pending', 'rejected'].includes(submission.status) ? submission : null
    return {
      ...authorDto(user),
      ...(user.id === userId ? { detection, ...(held ? { pendingChanges: (held.payload as unknown as { changes: CommunityProfileDto['pendingChanges'] }).changes } : {}) } : {}),
      revision: user.communityProfile?.revision || 1,
      userRevision: user.revision,
      bio: user.communityProfile?.bio || '',
      headline: user.communityProfile?.headline || '',
      location: user.communityProfile?.location || null,
      websiteUrl: user.communityProfile?.websiteUrl || null,
      bannerUrl: profileMediaUrl(user.communityProfile?.bannerFileId),
      joinedAt: user.createdAt.toISOString(),
      expertiseTopics: user.communityProfile?.expertiseTopics || [],
      ...(user.id === userId ? { allowAchievementDrafts: user.communityProfile?.allowAchievementDrafts || false } : {}),
      postCount,
      replyCount,
      likesReceived: likes._sum.likeCount || 0,
      followerCount,
      followingCount,
      following: !!following,
      followedBy: !!followedBy,
      muted,
      blocked,
      isSelf: user.id === userId,
      pinnedPost,
      topics: topics.map(({ follows, ...topic }) => ({ ...topic, following: follows.length > 0 })),
    }
  }
  async updateProfile(userId: string, input: ProfileDto) {
    await this.visibility.assertOperation(userId, 'profile')
    const displayName = input.displayName.trim()
    if (!displayName) throw new BadRequestException('显示名不能为空')
    const data = {
      bio: input.bio.trim(),
      headline: input.headline.trim(),
      location: input.location.trim() || null,
      websiteUrl: input.websiteUrl.trim() || null,
      expertiseTopics: input.expertiseTopics.map((topic) => topic.trim()).filter(Boolean),
      allowAchievementDrafts: input.allowAchievementDrafts,
    }
    if (new Set(data.expertiseTopics).size !== data.expertiseTopics.length) throw new BadRequestException('擅长话题不能重复')
    await this.prisma.$transaction(async (tx) => {
      await lockFileReferences(tx)
      if (!(await tx.user.updateMany({ where: { id: userId, revision: input.expectedUserRevision }, data: { revision: { increment: 1 } } })).count) throw new ConflictException('账号资料已更新，请重新读取')
      const { allowAchievementDrafts, ...text } = data
      await this.detection.saveProfile(tx, userId, { ...text, location: text.location || '', websiteUrl: text.websiteUrl || '', displayName }, userId, input.expectedProfileRevision)
      await tx.communityProfile.update({ where: { userId }, data: { allowAchievementDrafts } })
      await actionEvent(tx, userId, 'profile_updated', 'user', userId)
    })
    return this.profileUpdateResult(userId)
  }
  private async profileUpdateResult(userId: string) {
    const [user, profile] = await Promise.all([
      this.prisma.user.findUniqueOrThrow({ where: { id: userId }, include: authUserInclude }),
      this.profile(userId, userId),
    ])
    return { user: authUserDto(user), profile }
  }
  async uploadProfileImage(userId: string, kind: 'avatar' | 'banner', file: Express.Multer.File, input: ProfileMediaDto, key?: string) {
    await this.visibility.assertOperation(userId, 'upload')
    await this.visibility.assertOperation(userId, 'profile')
    if (!file || !['image/png', 'image/jpeg', 'image/webp'].includes(file.mimetype)) throw new BadRequestException('仅支持 PNG、JPEG、WebP 图片')
    const dimensions = kind === 'avatar' ? { width: 512, height: 512, limit: 5 * 1024 * 1024 } : { width: 1500, height: 500, limit: 8 * 1024 * 1024 }
    if (file.size < 1 || file.size > dimensions.limit || file.buffer.length !== file.size) throw new BadRequestException(`${kind === 'avatar' ? '头像' : '主页封面'}图片大小不合法`)
    let buffer: Buffer
    try {
      const image = sharp(file.buffer, { failOn: 'error', limitInputPixels: 40_000_000 })
      const metadata = await image.metadata()
      if (!metadata.format || !['png', 'jpeg', 'webp'].includes(metadata.format)) throw new Error()
      buffer = await image.rotate().resize(dimensions.width, dimensions.height, { fit: 'cover', position: 'centre' }).webp({ quality: 86 }).toBuffer()
    } catch { throw new BadRequestException('图片内容损坏或格式不受支持') }
    const request = await reserveIdempotency(this.prisma, userId, `community-profile-${kind}`, key, { ...input, mimeType: file.mimetype, size: file.size, checksum: createHash('sha256').update(file.buffer).digest('hex') })
    if (request.resourceId) return this.profileUpdateResult(userId)
    let stored: Awaited<ReturnType<StorageService['upload']>> | null = null
    try {
      stored = await this.storage.upload({ originalname: `community-${kind}.webp`, mimetype: 'image/webp', size: buffer.length, buffer }, { uploadedBy: userId, visibility: 'public' })
      if (stored.securityScan?.quarantined) throw new BadRequestException(stored.securityScan.message || '图片已隔离')
      await this.prisma.$transaction(async (tx) => {
        await lockFileReferences(tx)
        const profile = await tx.communityProfile.upsert({ where: { userId }, create: { userId }, update: {} })
        if (!(await tx.user.updateMany({ where: { id: userId, revision: input.expectedUserRevision }, data: { revision: { increment: 1 } } })).count) throw new ConflictException('账号资料已更新，请重新读取')
        await this.detection.saveProfile(tx, userId, {}, userId, input.expectedProfileRevision)
        const field = kind === 'avatar' ? 'avatarFileId' : 'bannerFileId'
        await tx.communityProfile.update({ where: { userId }, data: { [field]: stored!.id } })
        await actionEvent(tx, userId, 'profile_image_updated', 'user', userId, { kind })
        const previousFileId = kind === 'avatar' ? profile.avatarFileId : profile.bannerFileId
        if (previousFileId && previousFileId !== stored!.id) await tx.mediaGcJob.upsert({ where: { fileId: previousFileId }, create: { fileId: previousFileId }, update: {} })
        await request.complete(tx, stored!.id)
      })
    } catch (error) {
      if (stored && !stored.securityScan?.quarantined) await releaseUnboundMediaFile(this.prisma, this.storage, stored.id)
      await request.cancel()
      throw error
    }
    return this.profileUpdateResult(userId)
  }
  async removeProfileImage(userId: string, kind: 'avatar' | 'banner', input: ProfileMediaDto) {
    await this.visibility.viewer(userId)
    await this.prisma.$transaction(async (tx) => {
      await lockFileReferences(tx)
      const profile = await tx.communityProfile.upsert({ where: { userId }, create: { userId }, update: {} })
      const previous = kind === 'avatar' ? profile.avatarFileId : profile.bannerFileId
      if (!(await tx.user.updateMany({ where: { id: userId, revision: input.expectedUserRevision }, data: { revision: { increment: 1 } } })).count) throw new ConflictException('账号资料已更新，请重新读取')
      await this.detection.saveProfile(tx, userId, {}, userId, input.expectedProfileRevision)
      const field = kind === 'avatar' ? 'avatarFileId' : 'bannerFileId'
      await tx.communityProfile.update({ where: { userId }, data: { [field]: null } })
      await actionEvent(tx, userId, 'profile_image_removed', 'user', userId, { kind })
      if (previous) await tx.mediaGcJob.upsert({ where: { fileId: previous }, create: { fileId: previous }, update: {} })
    })
    return this.profileUpdateResult(userId)
  }
  async pinPost(userId: string, postId: string | null, expectedProfileRevision: number) {
    if (postId) await this.visibility.assertOperation(userId, 'profile')
    else await this.visibility.viewer(userId)
    if (postId && !await this.prisma.communityPost.count({ where: { id: postId, authorId: userId, status: 'published', visibility: 'public', deletedAt: null } })) throw new NotFoundException('只能置顶自己的公开动态')
    await this.prisma.$transaction(async (tx) => {
      await lockFileReferences(tx)
      await this.detection.saveProfile(tx, userId, {}, userId, expectedProfileRevision)
      await tx.communityProfile.update({ where: { userId }, data: { pinnedPostId: postId } })
      await actionEvent(tx, userId, postId ? 'profile_post_pinned' : 'profile_post_unpinned', 'user', userId, postId ? { postId } : {})
    })
    return this.profile(userId, userId)
  }
  async timeline(userId: string, targetId: string, query: ProfileTimelineQueryDto): Promise<CommunityProfileTimelineDto> {
    const profile = await this.profile(userId, targetId)
    if (query.tab === 'liked' && !profile.isSelf) throw new ForbiddenException('赞过的内容仅自己可见')
    const scope = `timeline:${profile.id}:${query.tab}`, cursor = decodeCursor(query.cursor, scope), after = cursor ? new Date(cursor.at) : null
    if (query.tab === 'replies') {
      const rows = await this.prisma.communityComment.findMany({
        where: {
          authorId: profile.id,
          status: 'published',
          deletedAt: null,
          post: await this.visibility.where(userId),
          ...(after ? { OR: [{ createdAt: { lt: after } }, { createdAt: after, id: { lt: cursor!.id } }] } : {}),
        },
        include: { post: { select: { id: true, title: true, question: { select: { acceptedCommentId: true } } } } },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: query.limit + 1,
      })
      const page = rows.slice(0, query.limit), last = page.at(-1)
      return {
        posts: [],
        replies: page.map((row) => ({ id: row.id, postId: row.postId, postTitle: row.post.title, bodyPreview: row.body.slice(0, 320), likes: row.likeCount, accepted: row.post.question?.acceptedCommentId === row.id, createdAt: row.createdAt.toISOString() })),
        nextCursor: rows.length > query.limit && last ? encodeCursor(scope, last.createdAt, last.id) : null,
      }
    }
    const media = query.tab === 'media' ? { contentBlocks: { array_contains: [{ type: 'image' }] } } as Prisma.CommunityPostWhereInput : {}
    const liked = query.tab === 'liked' ? { reactions: { some: { userId: profile.id, reactionType: 'like' as const } } } : { authorId: profile.id }
    const rows = await this.prisma.communityPost.findMany({
      where: { AND: [
        await this.visibility.where(userId),
        liked,
        media,
        ...(query.tab === 'posts' && profile.pinnedPost ? [{ id: { not: profile.pinnedPost.id } }] : []),
        ...(after ? [{ OR: [{ publishedAt: { lt: after } }, { publishedAt: after, id: { lt: cursor!.id } }] }] : []),
      ] },
      include: postInclude,
      orderBy: [{ publishedAt: 'desc' }, { id: 'desc' }],
      take: query.limit + 1,
    })
    const page = rows.slice(0, query.limit), last = page.at(-1)
    return {
      posts: await this.posts.mapMany(userId, page),
      replies: [],
      nextCursor: rows.length > query.limit && last ? encodeCursor(scope, last.publishedAt || last.createdAt, last.id) : null,
    }
  }
  async relations(userId: string, targetId: string, kind: 'followers' | 'following', query: ProfileRelationQueryDto): Promise<CommunityProfileRelationsDto> {
    const profile = await this.profile(userId, targetId)
    const scope = `relations:${profile.id}:${kind}`, cursor = decodeCursor(query.cursor, scope), after = cursor ? new Date(cursor.at) : null
    const excluded = (await this.visibility.authorExclusions(userId)).authors
    const rows = await this.prisma.communityUserFollow.findMany({
      where: {
        ...(kind === 'followers' ? { followeeId: profile.id, followerId: { notIn: excluded }, follower: visibleProfile() } : { followerId: profile.id, followeeId: { notIn: excluded }, followee: visibleProfile() }),
        ...(after ? { OR: [{ createdAt: { lt: after } }, { createdAt: after, ...(kind === 'followers' ? { followerId: { lt: cursor!.id } } : { followeeId: { lt: cursor!.id } }) }] } : {}),
      },
      include: { follower: { include: authorInclude }, followee: { include: authorInclude } },
      orderBy: [{ createdAt: 'desc' }, kind === 'followers' ? { followerId: 'desc' } : { followeeId: 'desc' }],
      take: query.limit + 1,
    })
    const page = rows.slice(0, query.limit)
    const users = page.map((row) => kind === 'followers' ? row.follower : row.followee)
    const viewerFollows = await this.prisma.communityUserFollow.findMany({ where: { followerId: userId, followeeId: { in: users.map((user) => user.id) } }, select: { followeeId: true } })
    const followed = new Set(viewerFollows.map((row) => row.followeeId)), last = page.at(-1)
    return {
      items: users.map((user) => ({ ...authorDto(user), following: followed.has(user.id) })),
      nextCursor: rows.length > query.limit && last ? encodeCursor(scope, last.createdAt, kind === 'followers' ? last.followerId : last.followeeId) : null,
    }
  }
  async interests(userId: string, themeIds: string[]) {
    await this.visibility.assertOperation(userId, 'profile')
    await this.prisma.$transaction((tx) => this.saveInterests(tx, userId, themeIds))
    return this.context(userId)
  }
  private async saveInterests(tx: Prisma.TransactionClient, userId: string, themeIds: string[]) {
    if (themeIds.length !== 3) throw new BadRequestException('请选择 3 个学习方向')
    const themes = await tx.theme.findMany({ where: { OR: [{ id: { in: themeIds } }, { slug: { in: themeIds } }], status: 'published', deletedAt: null } })
    if (themes.length !== 3) throw new BadRequestException('学习方向不存在')
    const topics = await tx.communityTopic.findMany({ where: { themeId: { in: themes.map((theme) => theme.id) }, status: 'active' }, orderBy: { sortOrder: 'asc' } })
    for (const theme of themes) {
      const topic = topics.find((topic) => topic.themeId === theme.id)
      if (topic) {
        const changed = await tx.communityTopicFollow.createMany({ data: [{ userId, topicId: topic.id }], skipDuplicates: true })
        if (changed.count) {
          await tx.communityTopic.update({ where: { id: topic.id }, data: { followerCount: { increment: 1 } } })
          await actionEvent(tx, userId, 'community_topic_follow', 'topic', topic.id, { topicIds: [topic.id] })
        }
      }
    }
  }
  async context(userId: string): Promise<CommunityContextDto> {
    const viewer = await this.visibility.viewer(userId)
    const excluded = await this.visibility.authorExclusions(userId)
    const [plan, progress, run, challenge, topics, users, count, notice] = await Promise.all([
      this.prisma.learningPlan.findFirst({ where: { userId, status: 'active' }, orderBy: { updatedAt: 'desc' } }),
      this.prisma.lessonProgress.findFirst({ where: { userId, progress: { lt: 100 }, course: { status: 'published', deletedAt: null } }, orderBy: { updatedAt: 'desc' } }),
      this.prisma.labRun.findFirst({ where: { userId, status: { in: ['ready', 'running', 'stopped'] }, lab: { status: 'published', deletedAt: null } }, orderBy: { startedAt: 'desc' } }),
      this.prisma.challenge.findFirst({ where: { status: 'published', deletedAt: null }, orderBy: { publishedAt: 'desc' } }),
      this.topics(userId),
      this.prisma.user.findMany({ where: { id: { not: userId, notIn: excluded.authors }, ...visibleProfile(), communityProfile: { verifiedType: { in: ['teacher', 'mentor', 'official'] } } }, include: authorInclude, take: 4 }),
      this.prisma.communityTopicFollow.count({ where: { userId } }),
      this.prisma.notification.findFirst({ where: { status: 'published', audience: { in: ['all', 'student'] } }, orderBy: { publishedAt: 'desc' } }),
    ])
    const refs = await this.references.resolveMany([...(progress ? [{ type: 'course' as const, id: progress.courseId }] : []), ...(run ? [{ type: 'lab' as const, id: run.labId }] : []), ...(challenge ? [{ type: 'challenge' as const, id: challenge.id }] : [])], userId)
    const courseRef = progress ? refs.get(`course:${progress.courseId}`) : null
    const labRef = run ? refs.get(`lab:${run.labId}`) : null
    const challengeRef = challenge ? refs.get(`challenge:${challenge.id}`) : null
    return { todayPlan: plan ? { id: plan.id, title: plan.title, route: '/profile', progress: plan.progress } : null, continueCourse: courseRef ? { ...courseRef, progress: progress!.progress } : null, continueLab: labRef ? { ...labRef, progress: run!.progress } : null, currentChallenge: challengeRef || null, trendingTopics: topics.slice(0, 6), suggestedUsers: users.map(authorDto), needsInterests: count < 3 && !viewer.communityProfile?.postCount, officialNotice: notice ? { id: notice.id, title: notice.title, summary: notice.content, route: '/notifications' } : null }
  }
}
