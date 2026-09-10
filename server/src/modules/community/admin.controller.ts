import { normalizeTopicName } from '@ai-learning-hub/contracts'
import { CommunityGovernanceService } from './governance.service'
import { GovernanceDecisionDto } from './governance.dto'
import { activeSanction, availableAccount } from './governance-policy'
import { BadRequestException, Body, ConflictException, Controller, Get, Headers, Ip, Param, Patch, Post, Query, UseGuards } from '@nestjs/common'
import { PrismaService } from '../../prisma/prisma.service'
import { AuthGuard } from '../auth/auth.guard'
import { PermissionsGuard } from '../auth/permissions.guard'
import { Permissions } from '../auth/permissions.decorator'
import { CurrentUser } from '../auth/current-user.decorator'
import type { AuthUser } from '../auth/auth.types'
import { CommunityPostService, postInclude } from './post.service'
import { CommunityCommentService } from './comment.service'
import { CommunityNotificationService } from './notification.service'
import { LearningFeedPipeline } from '../feed/feed.service'
import { authorDto, authorInclude, json } from './community.mapper'
import { AdminPostDto, ContentPolicyDto, ContentReviewDecisionDto, ContentTrialDto, EligibilityPolicyUpdateDto, ModerationDto, OfficialDto, PolicyDto, RestrictionCreateDto, RestrictionRevokeDto, RestrictionUpdateDto, TopicDto } from './community.dto'
import { Inject } from '@nestjs/common'
import { STORAGE_SERVICE, StorageService } from '../storage/storage.types'
import { communityMetrics } from './community-metrics'
import { CommunityAdminService, curatedDraftWhere } from './admin.service'
import { AdminCommunityQuery } from './admin-query.dto'
import { CommunityVisibilityPolicyService } from './visibility.service'
import { actionEvent, lockFileReferences, lockUser, postRevision } from '../../common/persistence'
import { Prisma } from '@prisma/client'
import { ContentDetectionService } from './content-detection.service'
import { detectContent, postDetectionInput } from '@ai-learning-hub/contracts'
import type { CommunityContentBlock, ContentDetectionResult } from '@ai-learning-hub/contracts'

@Controller('admin/community')
@UseGuards(AuthGuard, PermissionsGuard)
@Permissions('community.read')
export class CommunityAdminController {
  constructor(private readonly prisma: PrismaService, private readonly posts: CommunityPostService, private readonly comments: CommunityCommentService, private readonly notifications: CommunityNotificationService, private readonly feed: LearningFeedPipeline, @Inject(STORAGE_SERVICE) private readonly storage: StorageService, private readonly admin: CommunityAdminService, private readonly visibility: CommunityVisibilityPolicyService, private readonly detection: ContentDetectionService, private readonly governance: CommunityGovernanceService) {}
  @Get('content-policy') @Permissions('community.moderate')
  contentPolicy() { return this.detection.policy() }
  @Get('content-policy/history') @Permissions('community.moderate')
  contentPolicyHistory() { return this.detection.history() }
  @Patch('content-policy') @Permissions('community.moderate')
  configureContentPolicy(@CurrentUser() user: AuthUser, @Body() input: ContentPolicyDto) { return this.detection.configure(user.id, input) }
  @Post('content-policy/trial') @Permissions('community.moderate')
  async trialContent(@Body() input: ContentTrialDto) {
    const current = await this.detection.policy()
    return { ...detectContent(input.fields, input.rules === undefined ? current : { version: current.version, rules: input.rules }), previewOnly: true, saved: false }
  }
  @Get('content-reviews') @Permissions('community.moderate')
  async contentReviews(@Query() query: AdminCommunityQuery) {
    if (query.status && !['pending', 'approved', 'rejected', 'superseded'].includes(query.status)) throw new BadRequestException('复核状态无效')
    const where = { status: query.status || 'pending' }
    const [items, total] = await Promise.all([
      this.prisma.contentReview.findMany({ where, select: { id: true, targetType: true, targetId: true, authorId: true, contentRevision: true, ruleVersion: true, status: true, findings: true, reason: true, createdAt: true }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], skip: (query.page - 1) * query.pageSize, take: query.pageSize }),
      this.prisma.contentReview.count({ where }),
    ])
    return { items, total, page: query.page, pageSize: query.pageSize }
  }
  @Get('content-reviews/:id') @Permissions('community.moderate')
  async contentReview(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    const row = await this.prisma.contentReview.findUnique({ where: { id } })
    if (!row) throw new BadRequestException('复核记录不存在')
    if (row.targetType === 'resource' && !user.permissions.includes('resource.read')) throw new BadRequestException('读取资源复核还需要资源查看权限')
    // 复用现有正文，只读取与复核一致的修订；旧修订不得展示新内容让审核人误判。
    const post = row.targetType === 'post' ? await this.prisma.communityPost.findFirst({ where: { id: row.targetId, revision: row.contentRevision, status: { not: 'draft' } }, include: { contribution: true } }) : null
    await this.visibility.auditAdminRead(user.id, 'content_review', id)
    return { ...row, payload: row.targetType === 'post' ? post ? postDetectionInput(post.title, post.plainText, post.contentBlocks as CommunityContentBlock[], post.contribution, post.labels) : null : row.payload, contentAvailable: row.targetType !== 'post' || !!post }
  }
  @Post('content-reviews/:id/decision') @Permissions('community.moderate')
  decideContent(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() input: ContentReviewDecisionDto) { return this.detection.decide(user.id, id, input) }
  @Patch('posts/:id') @Permissions('community.write')
  async editPost(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() input: AdminPostDto, @Headers('idempotency-key') key?: string, @Ip() ip?: string) {
    const row = await this.prisma.communityPost.findUnique({ where: { id }, include: { bindings: true } })
    const reviewableDraft = !!row && row.status === 'draft' && !!await this.prisma.communityPost.count({ where: { AND: [{ id }, curatedDraftWhere] } })
    if (!row || !reviewableDraft && !await this.prisma.communityPost.count({ where: { id, ...await this.visibility.adminWhere() } })) throw new BadRequestException('动态不存在或为私人草稿')
    const result = await this.posts.save(row.authorId, { ...input, bindings: row.bindings.map((binding) => ({ type: binding.targetType as AdminPostDto['bindings'][number]['type'], id: binding.targetId })), sourceType: row.sourceType as AdminPostDto['sourceType'] || undefined, sourceId: row.sourceId || undefined }, id, { actorId: user.id, action: 'edit', reason: input.reason }, key, ip)
    return this.mappedForOperator(user.id, result.id)
  }
  @Post('official/:id/posts') @Permissions('community.official.publish')
  async officialPost(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() input: AdminPostDto, @Headers('idempotency-key') key?: string, @Ip() ip?: string) {
    const author = await this.prisma.user.findUnique({ where: { id }, include: authorInclude })
    if (!author || author.status !== 'active' || !['official', 'teacher', 'mentor'].includes(authorDto(author).verifiedType)) throw new BadRequestException('只能选择已认证的有效官方或指导账号')
    const result = await this.posts.save(id, input, undefined, { actorId: user.id, action: 'official_publish', reason: input.reason }, key, ip)
    return this.mappedForOperator(user.id, result.id)
  }
  private async mappedForOperator(userId: string, id: string) {
    const row = await this.prisma.communityPost.findUniqueOrThrow({ where: { id }, include: postInclude })
    return { ...(await this.posts.mapMany(userId, [row]))[0], detection: await this.detection.result('post', row.id, row.revision) }
  }
  @Get('media/:id')
  async media(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    const scope = await this.visibility.adminWhere()
    const attached = await this.prisma.communityPost.count({ where: { AND: [scope, { OR: [{ coverFileId: id }, { contribution: { coverFileId: id } }, { contentBlocks: { array_contains: [{ type: 'image', fileId: id }] } }] }] } }) || await this.prisma.communityComment.count({ where: { post: scope, contentBlocks: { array_contains: [{ type: 'image', fileId: id }] } } })
    if (!attached) throw new BadRequestException('图片未关联社区内容')
    await this.visibility.auditAdminRead(user.id, 'file', id)
    return { url: `/api/v1/files/${encodeURIComponent(id)}/download` }
  }
  @Get('summary') async summary() {
    return communityMetrics(this.prisma)
  }
  @Get('posts') list(@CurrentUser() user: AuthUser, @Query() query: AdminCommunityQuery) { return this.admin.list(user.id, query) }
  @Get('posts/:id') async detail(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    const row = await this.prisma.communityPost.findUnique({ where: { id }, include: postInclude })
    const reviewableDraft = !!row && row.status === 'draft' && !!await this.prisma.communityPost.count({ where: { AND: [{ id }, curatedDraftWhere] } })
    if (!row || !reviewableDraft && !await this.prisma.communityPost.count({ where: { id, ...await this.visibility.adminWhere() } })) throw new BadRequestException('动态不存在或为私人草稿')
    if (reviewableDraft || ['pending_review', 'hidden', 'removed'].includes(row.status)) await this.visibility.auditAdminRead(user.id, 'post', id)
    const reports = user.permissions.includes('community.report.manage') ? await this.prisma.communityReport.findMany({ where: { OR: [{ postId: id }, { comment: { postId: id } }] }, select: { id: true, postId: true, commentId: true, reason: true, description: true, status: true, createdAt: true } }) : []
    if (reports.length) await this.visibility.auditAdminRead(user.id, 'report', id)
    let recommendation = null
    if (user.permissions.includes('community.feed.manage')) {
      const session = await this.prisma.communityFeedSession.findFirst({ where: { entries: { array_contains: [{ type: 'post', id }] } }, orderBy: { createdAt: 'desc' } })
      const entry = (session?.entries as unknown as Array<{ id: string; score?: { source: string; total: number; dimensions: Record<string, number>; reasonCodes: string[] } }> | undefined)?.find((item) => item.id === id)
      if (entry?.score) recommendation = { policyVersion: session!.policyVersion, candidateSources: [...new Set([entry.score.source, ...entry.score.reasonCodes])], total: entry.score.total, dimensions: entry.score.dimensions, filter: row.status === 'published' ? 'allow' : row.status === 'limited' ? 'downrank' : 'drop', reasons: entry.score.reasonCodes }
    }
    const [revisions, moderation, actions, files] = await Promise.all([
      this.prisma.communityPostRevision.findMany({ where: { postId: id, ...(reviewableDraft ? {} : { statusSnapshot: { not: 'draft' } }) }, orderBy: { revisionNo: 'desc' } }),
      this.prisma.communityModerationAction.findMany({ where: { targetType: 'post', targetId: id }, select: { id: true, action: true, reason: true, createdAt: true }, orderBy: { createdAt: 'desc' } }),
      this.prisma.activityEvent.findMany({ where: { targetType: 'post', targetId: id, NOT: { eventType: 'post_draft_saved' } }, select: { id: true, eventType: true, actionType: true, userId: true, entityType: true, entityId: true, targetType: true, targetId: true, source: true, occurredAt: true }, orderBy: { occurredAt: 'desc' }, take: 100 }),
      this.prisma.fileRecord.findMany({ where: { id: { in: [...(row.contentBlocks as Array<{ fileId?: string }>).flatMap((b) => b.fileId ? [b.fileId] : []), ...[row.coverFileId, row.contribution?.coverFileId].filter((id): id is string => !!id)] } }, select: { id: true, originalName: true, mimeType: true, size: true } }),
    ])
    return { post: (await this.posts.mapMany(user.id, [row]))[0], comments: (await this.comments.list(user.id, id, { limit: 5 }, true)).items, reports, recommendation, revisions, moderation, actions: actions.map((a) => ({ id: a.id, eventType: a.actionType || a.eventType, actorId: a.userId, entityType: a.entityType || a.targetType, entityId: a.entityId || a.targetId, source: a.source, occurredAt: a.occurredAt.toISOString() })), files: await Promise.all(files.map(async (f) => ({ ...f, exists: await this.storage.exists(f.id) }))) }
  }
  @Get('comments') commentList(@CurrentUser() user: AuthUser, @Query() query: AdminCommunityQuery) { return this.admin.comments(user.id, query) }
  @Get('topics') topicList(@Query() query: AdminCommunityQuery) { return this.admin.topics(query) }
  @Get('users') users(@Query() query: AdminCommunityQuery) { return this.admin.users(query) }
  @Post('topics') @Permissions('community.topic.manage')
  async createTopic(@CurrentUser() user: AuthUser, @Body() input: TopicDto) { return this.saveTopic(user.id, input) }
  @Patch('topics/:id') @Permissions('community.topic.manage')
  async editTopic(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() input: TopicDto) { return this.saveTopic(user.id, input, id) }
  private async saveTopic(actorId: string, input: TopicDto, id?: string) {
    const { reason, ...fields } = input
    if (fields.themeId && !await this.prisma.theme.count({ where: { id: fields.themeId, status: 'published', deletedAt: null } })) throw new BadRequestException('关联学习主题不存在')
    return this.prisma.$transaction(async (tx) => {
      const normalizedName = normalizeTopicName(fields.name)
      const existing = await tx.communityTopic.findUnique({ where: { normalizedName } })
      const original = id ? await tx.communityTopic.findUnique({ where: { id } }) : null
      const legacyDuplicate = original?.normalizedName === null && normalizeTopicName(original.name) === normalizedName
      if (existing && existing.id !== id && !legacyDuplicate) throw new BadRequestException('同名话题已存在')
      const data = { ...fields, normalizedName: legacyDuplicate && existing?.id !== id ? null : normalizedName, themeId: fields.themeId || null }
      const row = id ? await tx.communityTopic.update({ where: { id }, data }) : await tx.communityTopic.create({ data })
      await tx.communityModerationAction.create({ data: { actorId, targetType: 'topic', targetId: row.id, action: id ? 'update' : 'create', reason } })
      return row
    })
  }
  @Get('reports') @Permissions('community.report.manage')
  reports(@CurrentUser() user: AuthUser, @Query() query: AdminCommunityQuery) { return this.admin.reports(user.id, query) }
  @Post('reports/:id/handle') @Permissions('community.report.manage', 'community.moderate')
  handle(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() input: GovernanceDecisionDto) { return this.governance.decideReport(user, id, input) }
  @Post(':target/:id/moderate') @Permissions('community.moderate')
  async moderate(@CurrentUser() user: AuthUser, @Param('target') target: string, @Param('id') id: string, @Body() input: ModerationDto) {
    return this.prisma.$transaction((tx) => this.moderateTx(user, target, id, input, tx))
  }
  private async moderateTx(user: AuthUser, target: string, id: string, input: ModerationDto, tx: Prisma.TransactionClient) {
    await lockFileReferences(tx)
    if (['hide', 'remove', 'disable_author'].includes(input.action)) throw new BadRequestException('下架和封禁请使用治理工作台，提交规则依据、期限及内容版本')
    if (input.action === 'restore' && await tx.communityModerationAction.count({ where: { ...activeSanction(), targetId: id, action: { in: ['takedown', 'ban'] } } })) throw new ConflictException('仍有有效处罚，请通过对应处罚或申诉撤销')
    let detection: ContentDetectionResult | undefined
    if (!['post', 'comment'].includes(target) || input.action === 'reject') throw new BadRequestException('处理对象或操作不合法')
      const row = target === 'post' ? await tx.communityPost.findUnique({ where: { id } }) : await tx.communityComment.findUnique({ where: { id } })
      if (!row) throw new BadRequestException('内容不存在')
      if (row.deletedAt) throw new ConflictException('内容已经删除，不能通过历史恢复入口重新公开')
      if (['restore', 'limit'].includes(input.action) && !await tx.user.count({ where: { ...availableAccount(), id: row.authorId } })) throw new ConflictException('作者当前不可用，不能恢复内容')
      if (row.status === 'pending_review' && !['hide', 'remove', 'disable_author'].includes(input.action)) throw new ConflictException('待复核内容必须通过对应修订的复核记录处理，不能直接恢复或限制展示')
      if (!await tx.communityPost.count({ where: { id: target === 'post' ? id : (row as { postId: string }).postId, ...await this.visibility.adminWhere(tx) } })) throw new BadRequestException('私人草稿不属于社区审核范围')
      if (target === 'post') {
        const post = await tx.communityPost.findUniqueOrThrow({ where: { id }, include: { contribution: true } })
        const labels = input.action === 'label' ? [...post.labels, input.label || input.reason] : post.labels
        if (['restore', 'limit'].includes(input.action) || input.action === 'label' && ['published', 'limited'].includes(post.status)) detection = await this.detection.check(tx, postDetectionInput(post.title, post.plainText, post.contentBlocks as CommunityContentBlock[], post.contribution, labels))
        const status = detection?.action === 'review' ? 'pending_review' : input.action === 'limit' ? 'limited' : input.action === 'hide' ? 'hidden' : input.action === 'remove' ? 'removed' : input.action === 'label' ? post.status : 'published'
        await tx.$queryRaw`SELECT id FROM community_posts WHERE id = ${id} FOR UPDATE`
        await postRevision(tx, id, user.id, 'moderation', input.reason)
        const saved = await tx.communityPost.update({ where: { id }, data: { revision: { increment: 1 }, labels, status, deletedAt: input.action === 'remove' ? new Date() : null, ...(status === 'pending_review' ? { publishedAt: null } : status === 'published' || status === 'limited' ? { publishedAt: post.publishedAt || new Date() } : {}) } })
        if (detection) await this.detection.record(tx, { type: 'post', id, revision: saved.revision, authorId: saved.authorId, submittedById: user.id }, detection)
        await postRevision(tx, id, user.id, 'moderation', input.reason)
        await tx.communityProfile.updateMany({ where: { userId: row.authorId }, data: { postCount: await tx.communityPost.count({ where: { authorId: row.authorId, status: 'published', deletedAt: null } }) } })
        for (const { topicId } of await tx.communityPostTopic.findMany({ where: { postId: id } })) await tx.communityTopic.update({ where: { id: topicId }, data: { postCount: await tx.communityPostTopic.count({ where: { topicId, post: { status: 'published', deletedAt: null } } }) } })
      } else {
        if (['limit', 'label'].includes(input.action)) throw new BadRequestException('评论只支持隐藏、删除或恢复')
        const comment = await tx.communityComment.findUniqueOrThrow({ where: { id } })
        if (input.action === 'restore') detection = await this.detection.check(tx, { commentBody: comment.body, mediaCaption: (comment.contentBlocks as CommunityContentBlock[]).flatMap((block) => block.type === 'image' ? [block.alt || ''] : block.type === 'code' ? [block.language] : []).join('\n') })
        const saved = await tx.communityComment.update({ where: { id }, data: { revision: { increment: 1 }, status: detection?.action === 'review' ? 'pending_review' : input.action === 'restore' ? 'published' : input.action === 'hide' ? 'hidden' : 'removed', deletedAt: input.action === 'remove' ? new Date() : null } })
        if (detection) await this.detection.record(tx, { type: 'comment', id, revision: saved.revision, authorId: saved.authorId, submittedById: user.id }, detection, comment.contentBlocks as Prisma.InputJsonValue)
        const postId = (row as { postId: string }).postId
        await tx.communityPost.update({ where: { id: postId }, data: { commentCount: await tx.communityComment.count({ where: { postId, status: 'published', deletedAt: null } }) } })
        if (input.action !== 'restore') await tx.communityQuestionState.updateMany({ where: { acceptedCommentId: id }, data: { acceptedCommentId: null, solvedAt: null, status: 'open' } })
      }
      await tx.communityModerationAction.create({ data: { actorId: user.id, targetType: target, targetId: id, action: input.action, reason: input.reason } })
      await actionEvent(tx, user.id, 'moderation_applied', target, id, { action: input.action, reason: input.reason }, 'admin-web')
      await this.notifications.send(row.authorId, user.id, 'moderation', target, id, tx)
      return { handled: true, detection }
  }
  @Get('official') @Permissions('community.official.publish')
  async official() {
    const users = await this.prisma.user.findMany({ where: { status: 'active' }, include: authorInclude, take: 100 })
    return users.map((row) => ({ ...authorDto(row), expertiseTopics: row.communityProfile?.expertiseTopics || [] }))
  }
  @Patch('official/:id') @Permissions('community.official.publish', 'platform.manage')
  async verify(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() input: OfficialDto) {
    if (!input.expectedRevision) throw new BadRequestException('请携带社区资料版本')
    const roleCode = input.verifiedType === 'official' ? 'community_official' : input.verifiedType
    const role = input.verifiedType !== 'none' ? await this.prisma.role.findUnique({ where: { code: roleCode } }) : null
    if (input.verifiedType !== 'none' && !role) throw new BadRequestException('认证角色尚未配置')
    await this.prisma.$transaction(async (tx) => {
      await lockFileReferences(tx)
      await lockUser(tx, id)
      await this.detection.saveProfile(tx, id, { expertiseTopics: input.expertiseTopics }, user.id, input.expectedRevision)
      await tx.communityProfile.update({ where: { userId: id }, data: { verifiedType: input.verifiedType } })
      await tx.userRole.deleteMany({ where: { userId: id, role: { code: { in: ['community_official', 'teacher', 'mentor'] } } } })
      if (role) await tx.userRole.create({ data: { userId: id, roleId: role.id } })
      await tx.communityModerationAction.create({ data: { actorId: user.id, targetType: 'user', targetId: id, action: 'verify', reason: input.reason, metadata: { verifiedType: input.verifiedType } } })
    })
    return { updated: true }
  }
  @Get('restrictions') @Permissions('community.moderate')
  restrictions() { return this.visibility.restrictions() }
  @Post('restrictions') @Permissions('community.moderate')
  createRestriction(@CurrentUser() user: AuthUser, @Body() input: RestrictionCreateDto) { return this.governance.saveRestriction(user, input) }
  @Patch('restrictions/:id') @Permissions('community.moderate')
  updateRestriction(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() input: RestrictionUpdateDto) { return this.governance.saveRestriction(user, input, id) }
  @Post('restrictions/:id/revoke') @Permissions('community.moderate')
  revokeRestriction(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() input: RestrictionRevokeDto) { return this.governance.revokeRestriction(user, id, input.expectedRevision, input.reason) }
  @Get('eligibility-policy') @Permissions('community.moderate')
  eligibilityPolicy() { return this.visibility.policy() }
  @Patch('eligibility-policy') @Permissions('community.moderate')
  updateEligibilityPolicy(@CurrentUser() user: AuthUser, @Body() input: EligibilityPolicyUpdateDto) { return this.visibility.updateEligibilityPolicy(user.id, input) }
  @Get('policy') @Permissions('community.feed.manage')
  policy() { return this.feed.policy() }
  @Patch('policy') @Permissions('community.feed.manage')
  async updatePolicy(@CurrentUser() user: AuthUser, @Body() input: PolicyDto) {
    const policy = await this.feed.policy()
    if (input.parameter === 'limitedPenalty') policy.penalties.limited = input.value / 100
    else {
      const key = { qualityWeight: 'quality', learningWeight: 'learning', explorationWeight: 'exploration' }[input.parameter]
      if (!key) throw new BadRequestException('策略参数不合法')
      policy.weights[key] = input.value / 100
      const sum = Object.values(policy.weights).reduce((total, value) => total + value, 0)
      for (const key of Object.keys(policy.weights)) policy.weights[key] /= sum
    }
    policy.version = `learning-v1-${Date.now()}`
    await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext('settings:community_feed_policy'))::text`
      const old = await tx.systemSetting.findUnique({ where: { key: 'community_feed_policy' } })
      if (old && input.expectedRevision !== old.revision) throw new ConflictException('推荐设置已变化，请刷新')
      const { revision: _revision, ...snapshot } = policy
      void _revision
      const updated = await tx.systemSetting.upsert({ where: { key: 'community_feed_policy' }, create: { key: 'community_feed_policy', value: json(snapshot) }, update: { value: json(snapshot), revision: { increment: 1 } } })
      policy.revision = updated.revision
      await tx.communityModerationAction.create({ data: { actorId: user.id, targetType: 'feed', targetId: policy.version, action: 'configure', reason: input.reason, metadata: { parameter: input.parameter, value: input.value } } })
    })
    return policy
  }
}
