import { BadRequestException, CanActivate, ConflictException, ExecutionContext, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common'
import { Prisma, type User } from '@prisma/client'
import { communityOperations, type CommunityEligibilityDecisionDto, type CommunityEligibilityDto, type CommunityEligibilityPolicyDto, type CommunityOperation, type CommunityOperationRestrictionDto } from '@ai-learning-hub/contracts'
import { PrismaService } from '../../prisma/prisma.service'
import { idempotency, rateLimit } from '../../common/persistence'
import { activeSanction, availableAccount, visiblePublicPost } from './governance-policy'

const protectedOperations = communityOperations.filter((operation): operation is Exclude<CommunityOperation, 'read'> => operation !== 'read')
const trustedRoles = new Set(['super_admin', 'admin', 'community_official', 'teacher', 'mentor'])
const quotaDefaults: CommunityEligibilityPolicyDto['quotas'] = {
  post: { limit: 5, windowSeconds: 60 }, comment: { limit: 30, windowSeconds: 60 }, upload: { limit: 12, windowSeconds: 300 },
  interaction: { limit: 120, windowSeconds: 60 }, report: { limit: 10, windowSeconds: 3600 },
}
const quotaBounds: Record<keyof CommunityEligibilityPolicyDto['quotas'], { limit: [number, number]; windowSeconds: [number, number] }> = {
  post: { limit: [1, 60], windowSeconds: [10, 3600] }, comment: { limit: [1, 300], windowSeconds: [10, 3600] },
  upload: { limit: [1, 100], windowSeconds: [30, 86400] }, interaction: { limit: [10, 1000], windowSeconds: [10, 3600] },
  report: { limit: [1, 100], windowSeconds: [60, 86400] },
}
const allowed = (): CommunityEligibilityDecisionDto => ({ allowed: true, reasonCode: null, message: null, availableAt: null, nextAction: null })
const denied = (reasonCode: NonNullable<CommunityEligibilityDecisionDto['reasonCode']>, message: string, nextAction: CommunityEligibilityDecisionDto['nextAction'] = null, availableAt: string | null = null): CommunityEligibilityDecisionDto => ({ allowed: false, reasonCode, message, availableAt, nextAction })

type ParticipationUser = Pick<User, 'status' | 'profile' | 'emailVerifiedAt' | 'agreementVersion'> & {
  communityProfile: { verifiedType: string } | null
  userRoles: Array<{ role: { code: string } }>
  identityVerification: { status: string } | null
}
// 公开标签和实际前台操作共用资格判断；显示设置不参与任何授权。
export function communityAccountDecision(user: ParticipationUser | null, configuredAgreement: unknown): CommunityEligibilityDecisionDto | null {
  if (!user || user.status !== 'active') return denied('ACCOUNT_UNAVAILABLE', '账号当前不可使用社区。')
  const profile = user.profile as Record<string, unknown>
  const trusted = (!!user.communityProfile?.verifiedType && user.communityProfile.verifiedType !== 'none') || user.userRoles.some((entry) => trustedRoles.has(entry.role.code))
  if (profile?.emailVerificationRequired === true && !user.emailVerifiedAt) return denied('EMAIL_VERIFICATION_REQUIRED', '请先完成邮箱验证后再参与社区公开操作。', { label: '前往账号中心', route: '/profile' })
  if (user.agreementVersion && typeof configuredAgreement === 'string' && user.agreementVersion !== configuredAgreement) return denied('AGREEMENT_UPDATE_REQUIRED', '用户协议已更新，请确认后再参与社区公开操作。', { label: '查看并确认', route: '/welcome' })
  if (!trusted && user.identityVerification?.status !== 'approved') return denied('COMMUNITY_VERIFICATION_REQUIRED', '需要完成校园实名认证后才能参与社区公开操作。', { label: '前往认证', route: '/community/verification' })
  return null
}

function normalizedQuota(value: unknown, fallback: { limit: number; windowSeconds: number }, bounds: { limit: [number, number]; windowSeconds: [number, number] }) {
  const input = value && typeof value === 'object' ? value as Record<string, unknown> : {}
  const limit = Number.isInteger(input.limit) && Number(input.limit) >= bounds.limit[0] && Number(input.limit) <= bounds.limit[1] ? Number(input.limit) : fallback.limit
  const windowSeconds = Number.isInteger(input.windowSeconds) && Number(input.windowSeconds) >= bounds.windowSeconds[0] && Number(input.windowSeconds) <= bounds.windowSeconds[1] ? Number(input.windowSeconds) : fallback.windowSeconds
  return { limit, windowSeconds }
}

@Injectable()
export class CommunityVisibilityPolicyService {
  constructor(private readonly prisma: PrismaService) {}
  async adminWhere(_tx?: Prisma.TransactionClient): Promise<Prisma.CommunityPostWhereInput> {
    // 复核后隐藏的内容仍归后台管理；从未投稿的私人草稿及其删除记录不进入审核。
    return { status: { not: 'draft' }, OR: [{ publishedAt: { not: null } }, { contentReviews: { some: {} } }] }
  }
  async auditAdminRead(actorId: string, targetType: string, targetId: string) {
    await this.prisma.auditLog.create({ data: { actorId, action: 'restricted_content_read', targetType, targetId } })
  }
  async viewer(userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId, AND: [availableAccount()] }, include: { communityProfile: true, school: true, userRoles: { include: { role: true } } } })
    if (!user || user.status !== 'active') throw new ForbiddenException('账号当前不可使用社区')
    return user
  }
  async policy(tx: Prisma.TransactionClient = this.prisma): Promise<CommunityEligibilityPolicyDto> {
    const stored = await tx.systemSetting.findUnique({ where: { key: 'community_eligibility_policy' } })
    const value = stored?.value && typeof stored.value === 'object' && !Array.isArray(stored.value) ? stored.value as Record<string, unknown> : {}
    const quotas = value.quotas && typeof value.quotas === 'object' && !Array.isArray(value.quotas) ? value.quotas as Record<string, unknown> : {}
    return {
      revision: stored?.revision || 1,
      quotas: Object.fromEntries(Object.entries(quotaDefaults).map(([key, fallback]) => [key, normalizedQuota(quotas[key], fallback, quotaBounds[key as keyof typeof quotaBounds])])) as CommunityEligibilityPolicyDto['quotas'],
    }
  }
  async eligibility(userId: string, tx: Prisma.TransactionClient = this.prisma): Promise<CommunityEligibilityDto> {
    const now = await this.databaseNow(tx)
    const [user, registration, restrictions] = await Promise.all([
      tx.user.findUnique({ where: { id: userId, AND: [availableAccount()] }, include: { communityProfile: true, identityVerification: true, userRoles: { include: { role: true } } } }),
      tx.systemSetting.findUnique({ where: { key: 'registration' } }),
      tx.communityOperationRestriction.findMany({ where: { userId, revokedAt: null, startsAt: { lte: now }, endsAt: { gt: now } }, orderBy: [{ endsAt: 'desc' }, { id: 'desc' }] }),
    ])
    const decisions = Object.fromEntries(communityOperations.map((operation) => [operation, allowed()])) as CommunityEligibilityDto['operations']
    const configuredAgreement = registration?.value && typeof registration.value === 'object' && !Array.isArray(registration.value) ? (registration.value as Record<string, unknown>).agreementVersion : null
    const base = communityAccountDecision(user, configuredAgreement)
    for (const operation of protectedOperations) {
      if (base) decisions[operation] = { ...base }
      else {
        const restriction = restrictions.find((entry) => entry.operations.includes(operation))
        if (restriction) decisions[operation] = denied('COMMUNITY_OPERATION_RESTRICTED', `当前${this.operationLabel(operation)}功能暂不可用：${restriction.reason}`, null, restriction.endsAt.toISOString())
      }
    }
    if (base?.reasonCode === 'ACCOUNT_UNAVAILABLE') decisions.read = { ...base }
    return {
      canRead: decisions.read.allowed,
      canPost: decisions.post.allowed,
      canComment: decisions.comment.allowed,
      canUpload: decisions.upload.allowed,
      operations: decisions,
      evaluatedAt: now.toISOString(),
    }
  }
  async assertOperation(userId: string, operation: CommunityOperation, tx: Prisma.TransactionClient = this.prisma) {
    const decision = (await this.eligibility(userId, tx)).operations[operation]
    if (!decision.allowed) throw new ForbiddenException({ message: decision.message, errorCode: decision.reasonCode, availableAt: decision.availableAt, nextAction: decision.nextAction })
  }
  async assertMediaEligibility(userId: string) {
    const decision = (await this.eligibility(userId)).operations.upload
    // 限制上传这一单项功能不影响已有内容阅读；账号、邮箱、协议和校园资格仍须有效。
    if (!decision.allowed && decision.reasonCode !== 'COMMUNITY_OPERATION_RESTRICTED') throw new ForbiddenException({ message: decision.message, errorCode: decision.reasonCode, nextAction: decision.nextAction })
  }
  async consumeQuota(tx: Prisma.TransactionClient, userId: string, operation: keyof CommunityEligibilityPolicyDto['quotas'], ip?: string) {
    await this.assertOperation(userId, operation, tx)
    const quota = (await this.policy(tx)).quotas[operation]
    await rateLimit(tx, userId, `community:${operation}:account`, quota.limit, quota.windowSeconds * 1000, `${this.operationLabel(operation)}过于频繁，请稍后再试`, 'COMMUNITY_RATE_LIMITED')
    if (ip) await rateLimit(tx, ip, `community:${operation}:ip`, Math.min(10_000, quota.limit * 20), quota.windowSeconds * 1000, '当前网络的社区操作过于频繁，请稍后再试', 'COMMUNITY_RATE_LIMITED')
  }
  async reserveUploadQuota(userId: string, ip?: string, key?: string, endpoint = 'upload') {
    await this.assertOperation(userId, 'upload')
    await this.prisma.$transaction(async (tx) => {
      const request = await idempotency(tx, userId, `community-upload-quota:${endpoint}`, key, { operation: 'upload', endpoint })
      if (request.resourceId) return
      await this.consumeQuota(tx, userId, 'upload', ip)
      await request.complete('reserved')
    })
  }
  async restrictions(): Promise<CommunityOperationRestrictionDto[]> {
    const [rows, now] = await Promise.all([
      this.prisma.communityOperationRestriction.findMany({ include: { user: true, createdBy: true }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: 500 }),
      this.databaseNow(),
    ])
    return rows.map((row) => this.restrictionDto(row, now))
  }
  async updateEligibilityPolicy(actorId: string, input: { expectedRevision: number; operation: keyof CommunityEligibilityPolicyDto['quotas']; limit: number; windowSeconds: number; reason: string }) {
    const bounds = quotaBounds[input.operation]
    if (input.limit < bounds.limit[0] || input.limit > bounds.limit[1] || input.windowSeconds < bounds.windowSeconds[0] || input.windowSeconds > bounds.windowSeconds[1]) throw new BadRequestException('限流参数超出当前操作的安全范围')
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext('settings:community_eligibility_policy'))::text`
      const old = await tx.systemSetting.findUnique({ where: { key: 'community_eligibility_policy' } })
      if ((old?.revision || 1) !== input.expectedRevision) throw new ConflictException('社区资格策略已变化，请刷新')
      const policy = await this.policy(tx)
      policy.quotas[input.operation] = { limit: input.limit, windowSeconds: input.windowSeconds }
      const value = JSON.parse(JSON.stringify({ quotas: policy.quotas })) as Prisma.InputJsonValue
      const stored = await tx.systemSetting.upsert({ where: { key: 'community_eligibility_policy' }, create: { key: 'community_eligibility_policy', value, revision: input.expectedRevision + 1 }, update: { value, revision: { increment: 1 } } })
      await tx.communityModerationAction.create({ data: { actorId, targetType: 'community_eligibility_policy', targetId: input.operation, action: 'configure', reason: input.reason, metadata: { limit: input.limit, windowSeconds: input.windowSeconds, revision: stored.revision } } })
      return { ...policy, revision: stored.revision }
    })
  }
  private async databaseNow(tx: Pick<Prisma.TransactionClient, '$queryRaw'> = this.prisma) {
    const [row] = await tx.$queryRaw<Array<{ now: Date }>>`SELECT NOW() AS now`
    return new Date(row.now)
  }
  private restrictionDto(row: Prisma.CommunityOperationRestrictionGetPayload<{ include: { user: true; createdBy: true } }>, now: Date): CommunityOperationRestrictionDto {
    return { id: row.id, revision: row.revision, userId: row.userId, username: row.user.username, displayName: row.user.displayName, operations: row.operations as CommunityOperationRestrictionDto['operations'], reason: row.reason, startsAt: row.startsAt.toISOString(), endsAt: row.endsAt.toISOString(), revokedAt: row.revokedAt?.toISOString() || null, createdBy: `${row.createdBy.displayName}（${row.createdBy.username}）`, createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString(), active: !row.revokedAt && row.startsAt <= now && row.endsAt > now }
  }
  private operationLabel(operation: CommunityOperation) {
    return ({ read: '读取', post: '发帖', comment: '评论', upload: '上传', interaction: '互动', profile: '公开资料', collection: '公开合集', report: '举报' } as Record<CommunityOperation, string>)[operation]
  }
  async authorExclusions(userId: string) {
    const feedback = await this.prisma.communityFeedback.findMany({ where: { OR: [{ userId }, { targetId: userId, feedbackType: 'block' }] } })
    return {
      authors: feedback.filter((row) => ['block', 'mute_author'].includes(row.feedbackType)).map((row) => row.userId === userId ? row.targetId : row.userId),
      posts: feedback.filter((row) => ['hide', 'not_interested'].includes(row.feedbackType)).map((row) => row.targetId),
      types: feedback.filter((row) => row.feedbackType === 'not_interested' && row.postType).map((row) => row.postType!),
    }
  }
  async where(userId: string, ownDrafts = false): Promise<Prisma.CommunityPostWhereInput> {
    if (!userId) return visiblePublicPost()
    const [viewer, feedback] = await Promise.all([this.viewer(userId), this.authorExclusions(userId)])
    return {
      deletedAt: null, author: availableAccount(), moderationActions: { none: activeSanction('takedown') },
      authorId: { notIn: feedback.authors }, id: { notIn: feedback.posts }, postType: { notIn: feedback.types },
      AND: [
        { OR: [{ status: { in: ['published', 'limited'] } }, ...(ownDrafts ? [{ authorId: userId, status: { in: ['draft' as const, 'pending_review' as const] } }] : [])] },
        { OR: [{ visibility: 'public' }, ...(viewer.schoolId ? [{ visibility: 'school' as const, schoolId: viewer.schoolId }] : []), ...(ownDrafts ? [{ authorId: userId, status: { in: ['draft' as const, 'pending_review' as const] } }] : [])] },
      ],
    }
  }
  // 资源跨表 UNION 的同一公开读取策略；调用方固定使用 community_posts p。
  // 反馈和处罚保留在数据库内判断，不把所有排除ID加载进应用内存。
  async publicPostsSql(userId: string): Promise<Prisma.Sql> {
    const viewer = userId ? await this.viewer(userId) : null
    return Prisma.sql`
      p.deleted_at IS NULL AND p.status IN ('published', 'limited')
      AND ${userId ? Prisma.sql`TRUE` : Prisma.sql`p.status = 'published' AND p.published_at IS NOT NULL`}
      AND (p.visibility = 'public' OR (p.visibility = 'school' AND p.school_id = ${viewer?.schoolId || null}))
      AND EXISTS (SELECT 1 FROM users u WHERE u.id = p.author_id AND u.status = 'active')
      AND NOT EXISTS (SELECT 1 FROM community_moderation_actions m
        WHERE m.subject_id = p.author_id AND m.action = 'ban' AND m.revoked_at IS NULL
          AND (m.expires_at IS NULL OR m.expires_at > NOW()))
      AND NOT EXISTS (SELECT 1 FROM community_moderation_actions m
        WHERE m.post_id = p.id AND m.subject_id IS NOT NULL AND m.action = 'takedown' AND m.revoked_at IS NULL
          AND (m.expires_at IS NULL OR m.expires_at > NOW()))
      AND NOT EXISTS (SELECT 1 FROM community_feedback f WHERE
        (f.user_id = ${userId} AND (
          (f.feedback_type IN ('block', 'mute_author') AND f.target_id = p.author_id)
          OR (f.feedback_type IN ('hide', 'not_interested') AND f.target_id = p.id)
          OR (f.feedback_type = 'not_interested' AND f.post_type = p.post_type)))
        OR (f.user_id = p.author_id AND f.target_id = ${userId} AND f.feedback_type = 'block'))`
  }
  async assertPost(userId: string, id: string, ownDrafts = false) {
    const post = await this.prisma.communityPost.findFirst({ where: { AND: [await this.where(userId, ownDrafts), { id }] } })
    if (!post) throw new NotFoundException('内容不存在或当前不可见')
    return post
  }
}

@Injectable()
export class CommunityUploadGuard implements CanActivate {
  constructor(private readonly visibility: CommunityVisibilityPolicyService) {}
  async canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest<{ user?: { id: string }; ip?: string; method?: string; originalUrl?: string; headers?: Record<string, string | string[] | undefined> }>()
    if (!request.user?.id) return false
    const key = request.headers?.['idempotency-key']
    const endpoint = `${request.method || 'POST'}:${(request.originalUrl || 'upload').split('?')[0]}`
    if (endpoint.includes('/community/profile/')) await this.visibility.assertOperation(request.user.id, 'profile')
    await this.visibility.reserveUploadQuota(request.user.id, request.ip, typeof key === 'string' ? key : undefined, endpoint)
    return true
  }
}
