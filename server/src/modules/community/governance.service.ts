import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common'
import { Prisma, type CommunityAppeal, type CommunityModerationAction, type CommunityReport, type ContentReview } from '@prisma/client'
import type { AuthUser, GovernanceActionDto, GovernanceAppealInput, GovernanceDecisionInput, GovernanceReportDto, GovernanceTarget, GovernanceTargetDto } from '@ai-learning-hub/contracts'
import { sanctionLabels } from '@ai-learning-hub/contracts'
import { PrismaService } from '../../prisma/prisma.service'
import { digest, idempotency, lockFileReferences, lockUser, rateLimit } from '../../common/persistence'
import { CommunityVisibilityPolicyService } from './visibility.service'
import { CommunityNotificationService } from './notification.service'
import { ContentDetectionService } from './content-detection.service'
import { activeSanction, visibleCollection, visibleProfile, visibleComment } from './governance-policy'
import type { ReportDto } from './community.dto'
import type { GovernanceQueryDto } from './governance.dto'

const openStatuses = ['pending', 'reviewing']
const sanctionActions = Object.keys(sanctionLabels)
type Target = GovernanceTargetDto & { subjectId: string; postId?: string; commentId?: string; collectionId?: string; profileId?: string }
type Tx = Prisma.TransactionClient

@Injectable()
export class CommunityGovernanceService {
  constructor(private readonly prisma: PrismaService, private readonly visibility: CommunityVisibilityPolicyService, private readonly notifications: CommunityNotificationService, private readonly detection: ContentDetectionService) {}
  private permission(actor: AuthUser, ...codes: string[]) {
    if (!codes.every((code) => actor.permissions.includes(code))) throw new ForbiddenException('缺少治理操作权限')
  }
  private async audit(tx: Tx, actorId: string, action: string, targetType: string, targetId: string, details: Prisma.InputJsonObject = {}) {
    await tx.auditLog.create({ data: { actorId, action, targetType, targetId, details } })
  }
  private async target(tx: Tx, type: string, id: string): Promise<Target> {
    if (type === 'post' || type === 'resource') {
      const row = await tx.communityPost.findUnique({ where: { id }, include: { contribution: { select: { postId: true } } } })
      if (!row || type === 'resource' && !row.contribution) throw new NotFoundException('举报对象不存在')
      const available = row.status !== 'draft' && (!!row.publishedAt || !!await tx.contentReview.count({ where: { targetType: 'post', targetId: id } }))
      return { type: row.contribution ? 'resource' : 'post', id, subjectId: row.authorId, postId: id, revision: row.revision, title: available ? row.title || row.plainText.slice(0, 160) : '内容当前未公开', text: available ? row.plainText : undefined, available, route: available ? `/community/post/${id}` : null }
    }
    if (type === 'comment') {
      const row = await tx.communityComment.findUnique({ where: { id }, include: { post: { select: { status: true, publishedAt: true } } } })
      if (!row) throw new NotFoundException('举报对象不存在')
      const available = row.post.status !== 'draft' && (!!row.post.publishedAt || !!await tx.contentReview.count({ where: { targetType: 'post', targetId: row.postId } }))
      return { type, id, subjectId: row.authorId, commentId: id, revision: row.revision, title: available ? row.body.slice(0, 160) : '所属动态当前未公开', text: available ? row.body : undefined, available, route: available ? `/community/post/${row.postId}#comment-${id}` : null }
    }
    if (type === 'collection') {
      const row = await tx.learningCollection.findUnique({ where: { id } })
      if (!row) throw new NotFoundException('举报对象不存在')
      return { type, id, subjectId: row.ownerId, collectionId: id, revision: row.revision, title: row.visibility === 'community' ? row.name : '合集当前为私人内容', text: row.visibility === 'community' ? `${row.description}\n${row.learningGoal}` : undefined, available: row.visibility === 'community', route: row.visibility === 'community' ? `/resources/collections/${id}` : null }
    }
    if (type === 'profile') {
      const row = await tx.user.findUnique({ where: { id }, select: { id: true, username: true, displayName: true, communityProfile: { select: { revision: true, bio: true, headline: true, websiteUrl: true } } } })
      if (!row) throw new NotFoundException('举报对象不存在')
      return { type, id, subjectId: id, profileId: id, revision: row.communityProfile?.revision || 1, title: row.displayName, text: [row.communityProfile?.headline, row.communityProfile?.bio, row.communityProfile?.websiteUrl].filter(Boolean).join('\n'), available: true, route: `/community/user/${row.username}` }
    }
    throw new BadRequestException('不支持的治理对象')
  }
  private targetDto(target: Target): GovernanceTargetDto {
    return { type: target.type, id: target.id, revision: target.revision, title: target.title, text: target.text, route: target.route, available: target.available }
  }
  private async reference(type: string, id: string, revision?: number | null): Promise<GovernanceTargetDto> {
    try {
      const target = this.targetDto(await this.target(this.prisma, type, id))
      return { ...target, currentRevision: target.revision, revision: revision ?? null, text: revision === target.revision ? target.text : undefined }
    }
    catch (error) { if (!(error instanceof NotFoundException)) throw error; return { type, id, revision: revision ?? null, title: '关联内容已不可用', route: null, available: false } }
  }
  private reportTarget(row: CommunityReport) { return row.commentId ? ['comment', row.commentId] : row.postId ? ['post', row.postId] : row.collectionId ? ['collection', row.collectionId] : ['profile', row.profileId!] }
  private async reportDto(row: CommunityReport, viewerId?: string): Promise<GovernanceReportDto> {
    const [type, id] = this.reportTarget(row)
    let target = await this.reference(type, id, row.contentRevision)
    if (viewerId) {
      let visible = false
      try {
        if (row.postId) visible = !!await this.visibility.assertPost(viewerId, row.postId)
        else if (row.commentId) {
          const comment = await this.prisma.communityComment.findFirst({ where: { id, status: 'published', deletedAt: null, ...visibleComment() } })
          visible = !!comment && !!await this.visibility.assertPost(viewerId, comment.postId)
        } else if (row.collectionId) visible = !!await this.prisma.learningCollection.count({ where: { id, ...visibleCollection() } })
        else visible = !!await this.prisma.user.count({ where: { id, ...visibleProfile() } })
      } catch (error) { if (!(error instanceof ForbiddenException || error instanceof NotFoundException)) throw error }
      if (!visible) target = { ...target, title: '关联内容当前不可见', text: undefined, route: null, available: false }
    }
    return { id: row.id, revision: row.revision, target, category: row.category as GovernanceReportDto['category'], reason: row.reason, description: row.description, evidence: row.evidence, status: row.status as GovernanceReportDto['status'], assignedToId: row.assignedToId, dueAt: row.dueAt.toISOString(), createdAt: row.createdAt.toISOString(), resultReason: row.resultReason, actionId: row.actionId }
  }
  private appealDto(row: CommunityAppeal) {
    return { id: row.id, revision: row.revision, actionId: row.actionId, reviewId: row.reviewId, reason: row.reason, evidence: row.evidence, status: row.status, resultReason: row.resultReason, assignedToId: row.assignedToId, dueAt: row.dueAt.toISOString(), createdAt: row.createdAt.toISOString() }
  }
  private reviewDto(row: ContentReview) {
    return { id: row.id, targetType: row.targetType, targetId: row.targetId, contentRevision: row.contentRevision, ruleVersion: row.ruleVersion, status: row.status, reason: row.reason, assignedToId: row.assignedToId, dueAt: row.dueAt.toISOString(), createdAt: row.createdAt.toISOString() }
  }
  private async actionDto(row: CommunityModerationAction): Promise<GovernanceActionDto> {
    const restriction = await this.prisma.communityOperationRestriction.findUnique({ where: { moderationActionId: row.id }, select: { operations: true } })
    const metadata = row.metadata as { startsAt?: string; operations?: string[] }
    return { id: row.id, revision: row.revision, target: await this.reference(row.targetType, row.targetId, row.contentRevision), action: row.action as GovernanceActionDto['action'], reason: row.reason, ruleCode: row.ruleCode, expiresAt: row.expiresAt?.toISOString() || null, revokedAt: row.revokedAt?.toISOString() || null, revokeReason: row.revokeReason, active: !row.revokedAt && (!row.expiresAt || row.expiresAt > new Date()) && (!metadata.startsAt || Date.parse(metadata.startsAt) <= Date.now()), createdAt: row.createdAt.toISOString(), operations: restriction?.operations || metadata.operations || [] }
  }
  async report(userId: string, type: GovernanceTarget, id: string, input: ReportDto, ip?: string) {
    await this.visibility.assertOperation(userId, 'report')
    return this.prisma.$transaction(async (tx) => {
      await lockFileReferences(tx)
      const target = await this.target(tx, type, id)
      if (!target.available) throw new NotFoundException('内容当前不可举报')
      if (type === 'post' || type === 'resource') await this.visibility.assertPost(userId, id)
      else if (type === 'comment') {
        const row = await tx.communityComment.findFirst({ where: { id, status: 'published', deletedAt: null, ...visibleComment(), authorId: { notIn: (await this.visibility.authorExclusions(userId)).authors } } })
        if (!row) throw new NotFoundException('评论当前不可见')
        await this.visibility.assertPost(userId, row.postId)
      } else {
        const blocked = (await this.visibility.authorExclusions(userId)).authors.includes(target.subjectId)
        const visible = type === 'collection' ? await tx.learningCollection.count({ where: { id, ...visibleCollection() } }) : await tx.user.count({ where: { id, ...visibleProfile() } })
        if (blocked || !visible) throw new NotFoundException('对象当前不可见')
      }
      const targetKey = `${target.postId ? 'post' : type}:${id}:r${target.revision}`
      const existing = await tx.communityReport.findFirst({ where: { reporterId: userId, OR: [{ targetKey }, { targetKey: `${target.postId ? 'post' : type}:${id}`, status: { in: openStatuses } }] } })
      if (existing) return { reported: true, id: existing.id }
      await this.visibility.consumeQuota(tx, userId, 'report', ip)
      const row = await tx.communityReport.create({ data: { reporterId: userId, targetKey, postId: target.postId, commentId: target.commentId, collectionId: target.collectionId, profileId: target.profileId, category: input.category, reason: input.reason.trim(), description: input.description.trim(), evidence: input.evidence, contentRevision: target.revision } })
      await this.audit(tx, userId, 'community_report_submitted', 'report', row.id)
      return { reported: true, id: row.id }
    })
  }
  async queue(actor: AuthUser, query: GovernanceQueryDto) {
    this.permission(actor, 'community.moderate', 'community.report.manage')
    const common = { ...(query.assigned === 'mine' ? { assignedToId: actor.id } : query.assigned === 'unassigned' ? { assignedToId: null } : {}), ...(query.overdue ? { dueAt: { lt: new Date() } } : {}) }
    const start = (query.page - 1) * query.pageSize
    // 混合事项按界面分组分页，总数与每页数量一致，不分别取满三页。
    const page = (offset: number, count: number) => ({ skip: Math.max(0, start - offset), take: Math.max(0, Math.min(offset + count, start + query.pageSize) - Math.max(offset, start)), orderBy: [{ dueAt: 'asc' as const }, { id: 'asc' as const }] })
    const reportWhere: Prisma.CommunityReportWhereInput = { ...common, ...(query.kind === 'processing' ? { status: 'reviewing' } : query.status === 'all' ? {} : { status: query.status }), ...(query.category ? { category: query.category } : {}), ...(query.keyword ? { reason: { contains: query.keyword, mode: 'insensitive' } } : {}), ...(query.targetType ? query.targetType === 'resource' ? { post: { contribution: { isNot: null } } } : query.targetType === 'post' ? { postId: { not: null }, post: { contribution: null } } : { [query.targetType === 'comment' ? 'commentId' : query.targetType === 'collection' ? 'collectionId' : 'profileId']: { not: null } } : {}) }
    const appealWhere = { ...common, ...(query.kind === 'processing' ? { status: 'reviewing' } : query.status === 'all' ? {} : { status: query.status }) }
    const reviewWhere: Prisma.ContentReviewWhereInput = { ...common, status: 'pending', ...(query.kind === 'processing' ? { AND: [{ assignedToId: { not: null } }] } : {}), ...(query.targetType ? { targetType: query.targetType === 'resource' ? 'post' : query.targetType } : {}) }
    const [reportCount, appealCount, reviewCount] = await Promise.all([
      ['reports', 'processing'].includes(query.kind) ? this.prisma.communityReport.count({ where: reportWhere }) : 0,
      ['appeals', 'processing'].includes(query.kind) ? this.prisma.communityAppeal.count({ where: appealWhere }) : 0,
      ['reviews', 'processing'].includes(query.kind) ? this.prisma.contentReview.count({ where: reviewWhere }) : 0,
    ])
    const [reviews, reports, appeals] = await Promise.all([
      reviewCount ? this.prisma.contentReview.findMany({ where: reviewWhere, ...page(0, reviewCount) }) : [],
      reportCount ? this.prisma.communityReport.findMany({ where: reportWhere, ...page(reviewCount, reportCount) }) : [],
      appealCount ? this.prisma.communityAppeal.findMany({ where: appealWhere, ...page(reviewCount + reportCount, appealCount) }) : [],
    ])
    await this.audit(this.prisma, actor.id, 'governance_queue_read', 'governance', query.kind)
    return { reports: await Promise.all(reports.map((row) => this.reportDto(row))), appeals: appeals.map((row) => this.appealDto(row)), reviews: reviews.map((row) => this.reviewDto(row)), total: reportCount + appealCount + reviewCount, page: query.page, pageSize: query.pageSize }
  }
  async claim(actor: AuthUser, kind: string, id: string, revision: number) {
    this.permission(actor, 'community.moderate', 'community.report.manage')
    return this.prisma.$transaction(async (tx) => {
      await lockFileReferences(tx)
      let count = 0
      if (kind === 'reports') count = (await tx.communityReport.updateMany({ where: { id, revision, status: 'pending', assignedToId: null }, data: { assignedToId: actor.id, claimedAt: new Date(), status: 'reviewing', revision: { increment: 1 } } })).count
      else if (kind === 'appeals') {
        const appeal = await tx.communityAppeal.findUnique({ where: { id }, include: { moderationAction: true, review: true } })
        if (appeal && (appeal.authorId === actor.id || appeal.moderationAction?.actorId === actor.id || appeal.review?.reviewedById === actor.id)) throw new ForbiddenException('本人或原处理人不能领取此申诉')
        if (appeal?.moderationAction?.action === 'ban') {
          this.permission(actor, 'user.write', 'user.session.revoke')
          if (!appeal.moderationAction.expiresAt && !actor.roles.includes('super_admin')) throw new ForbiddenException('永久封禁申诉需由超级管理员领取')
        }
        count = (await tx.communityAppeal.updateMany({ where: { id, revision, status: 'pending', assignedToId: null }, data: { assignedToId: actor.id, claimedAt: new Date(), status: 'reviewing', revision: { increment: 1 } } })).count
      }
      else if (kind === 'reviews') count = (await tx.contentReview.updateMany({ where: { id, contentRevision: revision, status: 'pending', assignedToId: null }, data: { assignedToId: actor.id, claimedAt: new Date() } })).count
      else throw new BadRequestException('领取类型无效')
      if (!count) throw new ConflictException('事项已被领取、处理或版本变化，请刷新')
      await this.audit(tx, actor.id, 'governance_claimed', kind, id)
      return { claimed: true }
    })
  }
  async release(actor: AuthUser, kind: string, id: string, revision: number) {
    this.permission(actor, 'community.moderate', 'community.report.manage')
    return this.prisma.$transaction(async (tx) => {
      await lockFileReferences(tx)
      const assignee = actor.roles.includes('super_admin') ? { not: null } : actor.id
      const data = { assignedToId: null, claimedAt: null }
      let count = 0
      if (kind === 'reports') count = (await tx.communityReport.updateMany({ where: { id, revision, assignedToId: assignee, status: 'reviewing' }, data: { ...data, status: 'pending', revision: { increment: 1 } } })).count
      else if (kind === 'appeals') count = (await tx.communityAppeal.updateMany({ where: { id, revision, assignedToId: assignee, status: 'reviewing' }, data: { ...data, status: 'pending', revision: { increment: 1 } } })).count
      else if (kind === 'reviews') count = (await tx.contentReview.updateMany({ where: { id, contentRevision: revision, assignedToId: assignee, status: 'pending' }, data })).count
      else throw new BadRequestException('事项类型无效')
      if (!count) throw new ConflictException('仅领取人或超级管理员可退回尚未处理的当前事项')
      await this.audit(tx, actor.id, 'governance_released', kind, id)
      return { released: true }
    })
  }
  async history(actor: AuthUser, type: string, id: string) {
    this.permission(actor, 'community.moderate')
    const target = await this.target(this.prisma, type, id)
    const rows = await this.prisma.communityModerationAction.findMany({ where: { targetId: id, targetType: target.type, subjectId: target.subjectId, action: { in: sanctionActions } }, orderBy: { createdAt: 'desc' }, take: 100 })
    await this.audit(this.prisma, actor.id, 'governance_history_read', target.type, id)
    return { target: this.targetDto(target), actions: await Promise.all(rows.map((row) => this.actionDto(row))) }
  }
  private assertClaim(actorId: string, assignedToId: string | null) {
    if (assignedToId !== actorId) throw new ConflictException('请先领取此事项；其他管理员已领取时不能并发处理')
  }
  private async apply(tx: Tx, actor: AuthUser, target: Target, input: GovernanceDecisionInput, startsAt = new Date()) {
    this.permission(actor, 'community.moderate')
    if (input.action === 'reject') throw new BadRequestException('驳回必须关联举报')
    if (!target.available) throw new ConflictException('内容已变为私人草稿，不能读取或处置当前草稿')
    if (input.action === 'ban') this.permission(actor, 'user.write', 'user.session.revoke')
    if (target.subjectId === actor.id) throw new ForbiddenException('不能处理自己的内容或账号')
    const protectedTarget = await tx.userRole.count({ where: { userId: target.subjectId, role: { code: { in: ['admin', 'super_admin'] } } } })
    if (protectedTarget && !actor.roles.includes('super_admin')) throw new ForbiddenException('处理管理员需要超级管理员权限')
    const expiresAt = input.expiresAt ? new Date(input.expiresAt) : null
    if (expiresAt && (expiresAt <= new Date() || expiresAt.getTime() > Date.now() + 365 * 86400000)) throw new BadRequestException('期限必须在未来且不超过一年')
    if (['restrict', 'mute'].includes(input.action) && !expiresAt) throw new BadRequestException('单项限制与临时禁言必须填写期限')
    if (input.action === 'restrict' && !input.operation) throw new BadRequestException('请选择限制的单项功能')
    if (input.action !== 'restrict' && input.operation) throw new BadRequestException('只有单项限制可指定功能')
    if (input.action === 'ban' && !expiresAt && !actor.roles.includes('super_admin')) throw new ForbiddenException('永久封禁只允许超级管理员作出有依据的决定')
    await lockUser(tx, target.subjectId)
    const duplicate = await tx.communityModerationAction.findFirst({ where: { ...activeSanction(input.action), subjectId: target.subjectId, ...(['ban', 'mute', 'restrict'].includes(input.action) ? {} : { targetType: target.type, targetId: target.id }), ...(input.action === 'warn' ? { contentRevision: target.revision } : {}), ...(input.action === 'restrict' ? { restriction: { is: { operations: { has: input.operation! } } } } : {}) } })
    if (duplicate) throw new ConflictException('当前已有相同有效处罚，不能重复处罚')
    if (expiresAt && startsAt >= expiresAt) throw new BadRequestException('限制结束时间必须晚于开始时间')
    if (expiresAt && expiresAt.getTime() - startsAt.getTime() > 366 * 86400000) throw new BadRequestException('限制持续时间不能超过一年')
    const operations = input.action === 'mute' ? ['post', 'comment'] : input.action === 'restrict' ? [input.operation!] : []
    const action = await tx.communityModerationAction.create({ data: { actorId: actor.id, subjectId: target.subjectId, targetType: target.type, targetId: target.id, postId: target.postId, commentId: target.commentId, collectionId: target.collectionId, contentRevision: target.revision, action: input.action, reason: input.reason.trim(), ruleCode: input.ruleCode.trim(), expiresAt, metadata: { startsAt: startsAt.toISOString(), operations } } })
    if (operations.length) await tx.communityOperationRestriction.create({ data: { userId: target.subjectId, operations, startsAt, endsAt: expiresAt!, reason: input.reason.trim(), createdById: actor.id, moderationActionId: action.id } })
    if (input.action === 'ban') {
      await tx.user.update({ where: { id: target.subjectId }, data: { sessionVersion: { increment: 1 }, revision: { increment: 1 } } })
      await tx.refreshToken.updateMany({ where: { userId: target.subjectId, revokedAt: null }, data: { revokedAt: new Date() } })
    }
    await this.audit(tx, actor.id, 'governance_sanction_applied', 'moderation_action', action.id, { action: input.action, ruleCode: action.ruleCode, reason: action.reason })
    await this.notifications.governance(target.subjectId, 'moderation_action', action.id, `收到${sanctionLabels[input.action]}：${action.reason}。可查看规则、期限并申诉。`, tx)
    return action
  }
  async decideReport(actor: AuthUser, id: string, input: GovernanceDecisionInput) {
    this.permission(actor, 'community.report.manage', 'community.moderate')
    return this.prisma.$transaction(async (tx) => {
      await lockFileReferences(tx)
      const report = await tx.communityReport.findUnique({ where: { id } })
      if (!report || report.revision !== input.expectedRevision || !openStatuses.includes(report.status)) throw new ConflictException('举报已处理或版本变化')
      this.assertClaim(actor.id, report.assignedToId)
      const [type, targetId] = this.reportTarget(report)
      const target = input.action === 'reject' ? null : await this.target(tx, type, targetId)
      if (target && target.revision !== (report.contentRevision ?? input.expectedContentRevision)) throw new ConflictException('内容已有新修订或历史版本未知，请重新核对当前内容，不能用旧举报直接处罚新修订')
      const action = target ? await this.apply(tx, actor, target, input) : null
      await tx.communityReport.update({ where: { id }, data: { status: input.action === 'reject' ? 'rejected' : 'resolved', resultReason: input.reason.trim(), handledBy: actor.id, handledAt: new Date(), actionId: action?.id, revision: { increment: 1 } } })
      await this.audit(tx, actor.id, 'community_report_decided', 'report', id, { actionId: action?.id || null, result: input.action, reason: input.reason })
      await this.notifications.governance(report.reporterId, 'report', `${id}:${report.revision}`, `你的举报${input.action === 'reject' ? '已驳回' : '已处理'}：${input.reason.trim()}`, tx)
      return { handled: true, actionId: action?.id || null }
    })
  }
  async decideDirect(actor: AuthUser, type: GovernanceTarget, id: string, input: GovernanceDecisionInput, key?: string) {
    this.permission(actor, 'community.moderate')
    if (!key) throw new BadRequestException('请携带处置幂等键')
    return this.prisma.$transaction(async (tx) => {
      await lockFileReferences(tx)
      const request = await idempotency(tx, actor.id, `governance:${type}:${id}`, key, input)
      if (request.resourceId) return { handled: true, actionId: request.resourceId }
      const target = await this.target(tx, type, id)
      if (target.revision !== input.expectedRevision) throw new ConflictException('当前内容已变化，请重新读取')
      const action = await this.apply(tx, actor, target, input)
      await request.complete(action.id)
      return { handled: true, actionId: action.id }
    })
  }
  private async revokeTx(tx: Tx, actor: AuthUser, row: CommunityModerationAction, reason: string) {
    this.permission(actor, 'community.moderate')
    if (row.action === 'ban') this.permission(actor, 'user.write', 'user.session.revoke')
    if (row.action === 'ban' && !row.expiresAt && !actor.roles.includes('super_admin')) throw new ForbiddenException('撤销永久封禁需要超级管理员权限')
    if (!row.subjectId || !sanctionActions.includes(row.action)) throw new BadRequestException('此记录不是可撤销处罚')
    if (row.subjectId === actor.id) throw new ForbiddenException('不能自行撤销处罚')
    if (!actor.roles.includes('super_admin') && await tx.userRole.count({ where: { userId: row.subjectId, role: { code: { in: ['admin', 'super_admin'] } } } })) throw new ForbiddenException('处理管理员需要超级管理员权限')
    if (row.revokedAt) throw new ConflictException('该处罚已经撤销')
    await lockUser(tx, row.subjectId)
    const accountState = row.metadata as { accountStatus?: string; accountRevision?: number }
    if (accountState.accountStatus) {
      const current = await tx.user.findUniqueOrThrow({ where: { id: row.subjectId } })
      if (current.status !== accountState.accountStatus) throw new ConflictException('账号已有新的管理决定，请核查当前状态，不能用旧申诉覆盖')
      if (await tx.communityModerationAction.count({ where: { ...activeSanction('ban'), subjectId: row.subjectId, id: { not: row.id } } })) throw new ConflictException('账号仍有其他有效封禁，请分别复核')
      await tx.user.update({ where: { id: row.subjectId }, data: { status: 'active', revision: { increment: 1 }, sessionVersion: { increment: 1 } } })
    }
    await tx.communityModerationAction.update({ where: { id: row.id }, data: { revokedAt: new Date(), revokedById: actor.id, revokeReason: reason.trim(), revision: { increment: 1 } } })
    await tx.communityOperationRestriction.updateMany({ where: { moderationActionId: row.id, revokedAt: null }, data: { revokedAt: new Date(), revokedById: actor.id, revision: { increment: 1 } } })
    // 不回写 published/active；新修订、删除、其他处罚与人工账号状态继续生效。
    await this.audit(tx, actor.id, 'governance_sanction_revoked', 'moderation_action', row.id, { reason })
    await this.notifications.governance(row.subjectId, 'moderation_revoked', row.id, `已撤销${sanctionLabels[row.action as keyof typeof sanctionLabels]}：${reason}。内容与账号仍需满足当前审核及其他有效限制。`, tx)
  }
  async revoke(actor: AuthUser, id: string, revision: number, reason: string) {
    return this.prisma.$transaction(async (tx) => {
      await lockFileReferences(tx)
      const row = await tx.communityModerationAction.findUnique({ where: { id } })
      if (!row || row.revision !== revision) throw new ConflictException('处罚记录已变化')
      await this.revokeTx(tx, actor, row, reason)
      return { revoked: true }
    })
  }
  async saveRestriction(actor: AuthUser, input: { userId?: string; expectedRevision?: number; operations: NonNullable<GovernanceDecisionInput['operation']>[]; startsAt?: string; endsAt: string; reason: string; ruleCode: string }, id?: string) {
    await this.prisma.$transaction(async (tx) => {
      await lockFileReferences(tx)
      const current = id ? await tx.communityOperationRestriction.findUnique({ where: { id }, include: { moderationAction: true } }) : null
      if (id && (!current || current.revokedAt || current.revision !== input.expectedRevision)) throw new ConflictException('限制已变化，请刷新')
      if (current) {
        if (!current.moderationAction) throw new ConflictException('历史限制尚未迁移到治理记录')
        await this.revokeTx(tx, actor, current.moderationAction, `调整限制：${input.reason}`)
      }
      const target = await this.target(tx, 'profile', current?.userId || input.userId!)
      for (const operation of input.operations) await this.apply(tx, actor, target, { expectedRevision: target.revision!, action: 'restrict', operation, reason: input.reason, ruleCode: input.ruleCode, expiresAt: input.endsAt }, input.startsAt ? new Date(input.startsAt) : new Date())
    })
    return { updated: true }
  }
  async revokeRestriction(actor: AuthUser, id: string, revision: number, reason: string) {
    return this.prisma.$transaction(async (tx) => {
      await lockFileReferences(tx)
      const row = await tx.communityOperationRestriction.findUnique({ where: { id }, include: { moderationAction: true } })
      if (!row || row.revision !== revision || row.revokedAt) throw new ConflictException('限制已变化或已经撤销')
      if (!row.moderationAction) throw new ConflictException('历史限制尚未迁移到治理记录')
      await this.revokeTx(tx, actor, row.moderationAction, reason)
      return { revoked: true }
    })
  }
  async appeal(userId: string, input: GovernanceAppealInput, ip?: string) {
    if (!!input.actionId === !!input.reviewId) throw new BadRequestException('申诉必须关联一项具体处罚或被驳回的内容修订')
    return this.prisma.$transaction(async (tx) => {
      await lockFileReferences(tx)
      const action = input.actionId ? await tx.communityModerationAction.findFirst({ where: { id: input.actionId, subjectId: userId, action: { in: sanctionActions } } }) : null
      const review = input.reviewId ? await tx.contentReview.findFirst({ where: { id: input.reviewId, authorId: userId, status: 'rejected' } }) : null
      if (!action && !review) throw new NotFoundException('没有可申诉的本人处罚或内容修订')
      if (action?.revokedAt) throw new ConflictException('该处罚已经撤销')
      const requestHash = digest(JSON.stringify([input.actionId || null, input.reviewId || null, input.reason.trim(), input.evidence || []]))
      const duplicate = await tx.communityAppeal.findUnique({ where: { authorId_requestHash: { authorId: userId, requestHash } } })
      if (duplicate) return this.appealDto(duplicate)
      if (await tx.communityAppeal.count({ where: { authorId: userId, ...(action ? { actionId: action.id } : { reviewId: review!.id }), status: { in: openStatuses } } })) throw new ConflictException('此事项已有待处理申诉，请等待结果；补充新理由可在处理后再次提交')
      await rateLimit(tx, userId, 'community:appeal', 5, 86400000, '今日申诉提交次数已达上限，请稍后再试')
      if (ip) await rateLimit(tx, ip, 'community:appeal:ip', 100, 86400000, '当前网络申诉过于频繁，请稍后再试')
      const row = await tx.communityAppeal.create({ data: { authorId: userId, actionId: action?.id, reviewId: review?.id, requestHash, reason: input.reason.trim(), evidence: input.evidence || [] } })
      await this.audit(tx, userId, 'community_appeal_submitted', 'appeal', row.id)
      return this.appealDto(row)
    })
  }
  async appealDetail(actor: AuthUser, id: string) {
    this.permission(actor, 'community.moderate', 'community.report.manage')
    const row = await this.prisma.communityAppeal.findUnique({ where: { id }, include: { moderationAction: true, review: true } })
    if (!row) throw new NotFoundException('申诉不存在')
    await this.audit(this.prisma, actor.id, 'community_appeal_read', 'appeal', id)
    return { appeal: this.appealDto(row), action: row.moderationAction ? await this.actionDto(row.moderationAction) : null, review: row.review ? this.reviewDto(row.review) : null }
  }
  async decideAppeal(actor: AuthUser, id: string, input: { expectedRevision: number; action: 'approve' | 'reject'; reason: string }) {
    this.permission(actor, 'community.moderate', 'community.report.manage')
    return this.prisma.$transaction(async (tx) => {
      await lockFileReferences(tx)
      const row = await tx.communityAppeal.findUnique({ where: { id }, include: { moderationAction: true, review: true } })
      if (!row || row.revision !== input.expectedRevision || !openStatuses.includes(row.status)) throw new ConflictException('申诉已处理或版本变化')
      this.assertClaim(actor.id, row.assignedToId)
      if (row.authorId === actor.id) throw new ForbiddenException('不能处理自己的申诉')
      if (row.moderationAction?.actorId === actor.id || row.review?.reviewedById === actor.id) throw new ForbiddenException('申诉必须由非原处理人复核')
      if (input.action === 'approve') {
        if (row.moderationAction) await this.revokeTx(tx, actor, row.moderationAction, input.reason)
        else if (row.review) {
          if (row.review.status !== 'rejected') throw new ConflictException('原复核状态已变化')
          await tx.contentReview.update({ where: { id: row.review.id }, data: { status: 'pending', assignedToId: actor.id } })
          await this.detection.decideTx(tx, actor.id, row.review.id, { expectedRevision: row.review.contentRevision, ruleVersion: row.review.ruleVersion, action: 'approve', reason: input.reason })
        }
      }
      await tx.communityAppeal.update({ where: { id }, data: { status: input.action === 'approve' ? 'resolved' : 'rejected', resultReason: input.reason.trim(), handledById: actor.id, handledAt: new Date(), revision: { increment: 1 } } })
      await this.audit(tx, actor.id, 'community_appeal_decided', 'appeal', id, { result: input.action, reason: input.reason })
      await this.notifications.governance(row.authorId, 'appeal', id, `你的申诉${input.action === 'approve' ? '已通过' : '已驳回'}：${input.reason.trim()}`, tx)
      return { handled: true }
    })
  }
  async mine(userId: string, page = 1) {
    const pagination = { skip: (page - 1) * 100, take: 101 }
    const [actions, reports, appeals, reviews] = await Promise.all([
      this.prisma.communityModerationAction.findMany({ where: { subjectId: userId, action: { in: sanctionActions } }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], ...pagination }),
      this.prisma.communityReport.findMany({ where: { reporterId: userId }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], ...pagination }),
      this.prisma.communityAppeal.findMany({ where: { authorId: userId }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], ...pagination }),
      this.prisma.contentReview.findMany({ where: { authorId: userId, status: 'rejected' }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], ...pagination }),
    ])
    return { actions: await Promise.all(actions.slice(0, 100).map((row) => this.actionDto(row))), reports: await Promise.all(reports.slice(0, 100).map((row) => this.reportDto(row, userId))), appeals: appeals.slice(0, 100).map((row) => this.appealDto(row)), reviews: reviews.slice(0, 100).map((row) => this.reviewDto(row)), hasMore: [actions, reports, appeals, reviews].some((rows) => rows.length > 100) }
  }
}
