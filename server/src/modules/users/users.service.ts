import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { Prisma } from '@prisma/client'
import type { AdminIdentityVerificationDto, AdminUserSummaryDto, AdminUserDetailDto, AuthUser, CampusIdentityVerificationDto, PageResult } from '@ai-learning-hub/contracts'
import { PrismaService } from '../../prisma/prisma.service'
import { actionEvent, idempotency, lockFileReferences, lockUser } from '../../common/persistence'
import { moderatorGrantDto } from '../community/moderator-grants'
import { badgeUserInclude, loadBadgeContext, normalizeCustomBadges, userBadgeSettings } from '../community/user-badges'
import { automaticBadgeCodes, type UserBadgeUpdateInput } from '@ai-learning-hub/contracts'
import type { ModeratorGrantInput } from '@ai-learning-hub/contracts'
import { ContentDetectionService } from '../community/content-detection.service'
import { CampusIdentityVerificationInputDto, IdentityReviewDto, UserQuery, UserStatusUpdateDto, UserUpdateDto } from './users.dto'
import { RegistrationService } from '../auth/registration.service'
import { decryptIdentity, encryptIdentity, identityFingerprint, maskIdNumber, maskRealName, normalizeIdNumber, normalizeStudentNo, parseIdentityDataKey } from './identity-data'

const userSelect = {
  id: true, username: true, displayName: true, email: true, status: true, userType: true, profile: true, studentNo: true,
  registrationSource: true, major: true, grade: true, schoolId: true, departmentId: true,
  school: { select: { id: true, name: true } }, department: { select: { id: true, name: true } },
  lastLoginAt: true, createdAt: true, updatedAt: true, onboardingCompletedAt: true, emailVerifiedAt: true,
  revision: true, userRoles: { select: { role: { select: { code: true } } } },
  identityVerification: { select: { status: true } },
  _count: { select: { communityPosts: { where: { status: 'published' as const, deletedAt: null } } } },
} satisfies Prisma.UserSelect
type UserRow = Prisma.UserGetPayload<{ select: typeof userSelect }>
const avatar = (profile: Prisma.JsonValue) => {
  const url = profile && typeof profile === 'object' && !Array.isArray(profile) ? profile.avatarUrl : null
  return typeof url === 'string' && /^\/(?:uploads|api\/v1\/files)\/[a-zA-Z0-9/_?.=&%-]+$/.test(url) ? url : null
}
const summary = (row: UserRow, includeStudentNo = false): AdminUserSummaryDto => ({
  id: row.id, username: row.username, displayName: row.displayName, email: row.email,
  status: row.status, userType: row.userType, registrationSource: row.registrationSource,
  major: row.major, grade: row.grade, school: row.school, department: row.department,
  lastLoginAt: row.lastLoginAt?.toISOString() || null, createdAt: row.createdAt.toISOString(),
  onboardingCompleted: !!row.onboardingCompletedAt, emailVerified: !!row.emailVerifiedAt,
  roles: row.userRoles.map((grant) => grant.role.code), communityPostCount: row._count.communityPosts,
  avatar: avatar(row.profile), revision: row.revision,
  identityVerificationStatus: row.identityVerification?.status || 'unsubmitted',
  ...(includeStudentNo ? { studentNo: row.studentNo } : {}),
})
const emptyVerification = (): CampusIdentityVerificationDto => ({ status: 'unsubmitted', submittedAt: null, reviewedAt: null, reviewReason: null, maskedRealName: null, maskedIdNumber: null, className: null, studentNo: null, revision: null })
export const dateRange = (from?: string, to?: string) => ({ ...(from ? { gte: new Date(from) } : {}), ...(to ? { lte: new Date(to.length === 10 ? `${to}T23:59:59.999Z` : to) } : {}) })
@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService, private readonly registration: RegistrationService, private readonly config: ConfigService, private readonly detection: ContentDetectionService) {}
  private identityKey() {
    try { return parseIdentityDataKey(this.config.get<string>('IDENTITY_DATA_KEY')) }
    catch { throw new ServiceUnavailableException('校园实名认证能力尚未配置，请联系管理员') }
  }
  where(q: UserQuery, includeStudentNo = false): Prisma.UserWhereInput {
    return {
      ...(q.keyword ? { OR: ['username', 'displayName', 'email', ...(includeStudentNo ? ['studentNo'] : []), 'teacherNo'].map((field) => ({ [field]: { contains: q.keyword, mode: 'insensitive' } })) } : {}),
      ...(q.status ? { status: q.status } : {}), ...(q.userType ? { userType: q.userType } : {}),
      ...(q.role ? { userRoles: { some: { role: { code: q.role } } } } : {}),
      ...(q.registrationSource ? { registrationSource: q.registrationSource } : {}),
      ...(q.schoolId ? { schoolId: q.schoolId } : {}),
      ...(q.onboardingCompleted === undefined ? {} : { onboardingCompletedAt: q.onboardingCompleted ? { not: null } : null }),
      ...(q.emailVerified === undefined ? {} : { emailVerifiedAt: q.emailVerified ? { not: null } : null }),
      ...(q.identityVerificationStatus === 'unsubmitted' ? { identityVerification: null } : q.identityVerificationStatus ? { identityVerification: { is: { status: q.identityVerificationStatus } } } : {}),
      createdAt: dateRange(q.createdFrom, q.createdTo), lastLoginAt: dateRange(q.lastLoginFrom, q.lastLoginTo),
    }
  }
  async list(query: UserQuery, includeStudentNo = false): Promise<PageResult<AdminUserSummaryDto>> {
    const where = this.where(query, includeStudentNo)
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.user.findMany({ where, select: userSelect, orderBy: [{ [query.sortBy]: query.sortOrder }, { id: query.sortOrder }], skip: (query.page - 1) * query.pageSize, take: query.pageSize }),
      this.prisma.user.count({ where }),
    ], { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead })
    return { items: rows.map((row) => summary(row, includeStudentNo)), total, page: query.page, pageSize: query.pageSize }
  }
  async detail(id: string, includeStudentNo = false): Promise<AdminUserDetailDto> {
    const row = await this.prisma.user.findUnique({ where: { id }, select: {
      ...userSelect, teacherNo: true, agreementVersion: true, agreementAcceptedAt: true,
      passwordHash: true, communityProfile: true, moderatorGrants: true, identities: { select: { provider: true, createdAt: true } },
      loginLogs: { orderBy: { createdAt: 'desc' }, take: 1, select: { result: true } },
    } })
    if (!row) throw new NotFoundException('用户不存在')
    const [activeSessions, commentCount, reportCount, activities, audits] = await this.prisma.$transaction([
      this.prisma.refreshToken.count({ where: { userId: id, revokedAt: null, expiresAt: { gt: new Date() } } }),
      this.prisma.communityComment.count({ where: { authorId: id, status: 'published', deletedAt: null } }),
      this.prisma.communityReport.count({ where: { reporterId: id } }),
      this.prisma.activityEvent.findMany({ where: { userId: id, NOT: { eventType: 'post_draft_saved' }, OR: [{ targetType: { not: 'post' } }, { targetId: { in: (await this.prisma.communityPost.findMany({ where: { authorId: id, status: { not: 'draft' }, publishedAt: { not: null } }, select: { id: true } })).map((p) => p.id) } }, { targetType: null }] }, orderBy: { occurredAt: 'desc' }, take: 100, select: { id: true, userId: true, actionType: true, eventType: true, entityType: true, entityId: true, targetType: true, targetId: true, source: true, occurredAt: true } }),
      this.prisma.auditLog.findMany({ where: { targetType: 'user', targetId: id }, orderBy: { createdAt: 'desc' }, take: 100 }),
    ])
    return {
      user: { ...summary(row, includeStudentNo), ...(includeStudentNo ? { studentNo: row.studentNo } : {}), teacherNo: row.teacherNo, updatedAt: row.updatedAt.toISOString() },
      moderatorGrants: row.moderatorGrants.map(moderatorGrantDto),
      security: { agreementVersion: row.agreementVersion, agreementAcceptedAt: row.agreementAcceptedAt?.toISOString() || null,
        emailVerifiedAt: row.emailVerifiedAt?.toISOString() || null, passwordSet: !!row.passwordHash, activeSessions,
        lastLoginResult: row.loginLogs[0]?.result || null, identities: row.identities.map((r) => ({ provider: r.provider, createdAt: r.createdAt.toISOString() })) },
      community: { revision: row.communityProfile?.revision || 1, headline: row.communityProfile?.headline || '', bio: row.communityProfile?.bio || '', verifiedType: row.communityProfile?.verifiedType || 'none', expertiseTopics: row.communityProfile?.expertiseTopics || [], postCount: row._count.communityPosts, commentCount, reportCount, followerCount: row.communityProfile?.followerCount || 0, followingCount: row.communityProfile?.followingCount || 0 },
      verification: includeStudentNo ? await this.verificationSummary(id) : { ...emptyVerification(), status: row.identityVerification?.status || 'unsubmitted' },
      activities: activities.map((r) => ({ id: r.id, actorId: r.userId, eventType: r.actionType || r.eventType, entityType: r.entityType || r.targetType, entityId: r.entityId || r.targetId, source: r.source, occurredAt: r.occurredAt.toISOString() })),
      audits: audits.map((r) => ({ id: r.id, action: r.action, reason: typeof (r.details as Prisma.JsonObject).reason === 'string' ? String((r.details as Prisma.JsonObject).reason) : '', createdAt: r.createdAt.toISOString() })),
    }
  }
  async badges(actor: AuthUser, userId: string) {
    if (!actor.permissions.includes('user.badge.manage')) throw new ForbiddenException('缺少公开标签管理权限')
    const [user, context] = await Promise.all([this.prisma.user.findUnique({ where: { id: userId }, include: badgeUserInclude }), loadBadgeContext(this.prisma)])
    if (!user) throw new NotFoundException('用户不存在')
    return userBadgeSettings(user, context)
  }
  async updateBadges(actor: AuthUser, userId: string, input: UserBadgeUpdateInput) {
    if (!actor.permissions.includes('user.badge.manage')) throw new ForbiddenException('缺少公开标签管理权限')
    const customBadges = normalizeCustomBadges(input.customBadges)
    if (!Array.isArray(input.hiddenAutomaticBadges) || input.hiddenAutomaticBadges.length > 4 || input.hiddenAutomaticBadges.some((code) => !automaticBadgeCodes.includes(code))) throw new BadRequestException('隐藏标签代码无效')
    const hiddenAutomaticBadges = [...new Set(input.hiddenAutomaticBadges)], reason = input.reason?.trim()
    if (!reason || reason.length < 4 || reason.length > 500) throw new BadRequestException('请填写 4～500 字的操作原因')
    return this.prisma.$transaction(async (tx) => {
      await lockFileReferences(tx)
      await this.assertTarget(actor, userId, tx)
      const user = await tx.user.findUniqueOrThrow({ where: { id: userId }, include: badgeUserInclude }), context = await loadBadgeContext(tx)
      const before = userBadgeSettings(user, context)
      if (before.revision !== input.expectedRevision) throw new ConflictException('公开资料或标签已变化，请重新读取后修改')
      for (const code of before.hiddenAutomaticBadges) if (!hiddenAutomaticBadges.includes(code) && !before.automaticBadges.some((badge) => badge.code === code)) throw new BadRequestException('当前身份或版主授权无效，不能恢复该自动标签')
      const data = { customBadges: customBadges as unknown as Prisma.InputJsonValue, hiddenAutomaticBadges, revision: before.revision + 1 }
      await tx.communityProfile.upsert({ where: { userId }, create: { userId, ...data }, update: data })
      await tx.auditLog.create({ data: { actorId: actor.id, action: 'public_user_badges_updated', targetType: 'user', targetId: userId, details: { reason, source: 'admin-web', before: { customBadges: before.customBadges, hiddenAutomaticBadges: before.hiddenAutomaticBadges }, after: { customBadges, hiddenAutomaticBadges } } as unknown as Prisma.InputJsonValue } })
      return userBadgeSettings(await tx.user.findUniqueOrThrow({ where: { id: userId }, include: badgeUserInclude }), context)
    })
  }
  async updateModeratorGrants(actor: AuthUser, userId: string, input: ModeratorGrantInput, key?: string) {
    if (!actor.permissions.includes('user.moderator.manage')) throw new ForbiddenException('缺少前台版主授权管理权限')
    if (!key) throw new BadRequestException('请携带授权修改幂等键')
    if (input.enabled && (!input.scopes.length || !(input.canDelete || input.canMute || input.canBan))) throw new BadRequestException('请选择管理范围和至少一项允许动作')
    return this.prisma.$transaction(async (tx) => {
      // 与处置共用短事务锁：撤销返回后，旧页面的下一次处置不能沿用旧授权。
      await lockFileReferences(tx)
      await this.assertTarget(actor, userId, tx)
      const request = await idempotency(tx, actor.id, `moderator-grants:${userId}`, key, input)
      if (request.resourceId) return { updated: true, revision: Number(request.resourceId) }
      const user = await tx.user.findUniqueOrThrow({ where: { id: userId } })
      if (user.revision !== input.expectedRevision) throw new ConflictException('用户资料或授权已更新，请重新读取')
      const before = await tx.frontendModeratorGrant.findMany({ where: { userId } })
      await tx.frontendModeratorGrant.updateMany({ where: { userId, ...(input.enabled ? { scope: { notIn: input.scopes } } : {}) }, data: { enabled: false, grantedById: actor.id, revision: { increment: 1 } } })
      if (input.enabled) for (const scope of input.scopes) {
        const data = { enabled: true, canDelete: input.canDelete, canMute: input.canMute, canBan: input.canBan, grantedById: actor.id }
        await tx.frontendModeratorGrant.upsert({ where: { userId_scope: { userId, scope } }, create: { userId, scope, ...data }, update: { ...data, revision: { increment: 1 } } })
      }
      const after = await tx.frontendModeratorGrant.findMany({ where: { userId } })
      await tx.user.update({ where: { id: userId }, data: { revision: { increment: 1 } } })
      await tx.auditLog.create({ data: { actorId: actor.id, action: 'frontend_moderator_grants_updated', targetType: 'user', targetId: userId, details: { reason: input.reason.trim(), source: 'admin-web', before: before.map((grant) => ({ ...moderatorGrantDto(grant) })), after: after.map((grant) => ({ ...moderatorGrantDto(grant) })) } } })
      await request.complete(String(user.revision + 1))
      return { updated: true, revision: user.revision + 1, grants: after.map(moderatorGrantDto) }
    })
  }
  async verificationSummary(userId: string): Promise<CampusIdentityVerificationDto> {
    const row = await this.prisma.campusIdentityVerification.findUnique({ where: { userId } })
    if (!row) return emptyVerification()
    const key = this.identityKey()
    return {
      status: row.status,
      submittedAt: row.submittedAt.toISOString(),
      reviewedAt: row.reviewedAt?.toISOString() || null,
      reviewReason: row.reviewReason,
      maskedRealName: maskRealName(decryptIdentity(row.realNameEncrypted, key, 'real-name')),
      maskedIdNumber: maskIdNumber(decryptIdentity(row.idNumberEncrypted, key, 'id-number')),
      className: row.className,
      studentNo: row.studentNo,
      revision: row.revision,
    }
  }
  async submitVerification(userId: string, input: CampusIdentityVerificationInputDto) {
    let idNumber: string
    try { idNumber = normalizeIdNumber(input.idNumber) }
    catch (error) { throw new BadRequestException(error instanceof Error ? error.message : '身份证号无效') }
    const key = this.identityKey(), studentNo = normalizeStudentNo(input.studentNo), now = new Date()
    const fingerprint = identityFingerprint(idNumber, key)
    try {
      await this.prisma.$transaction(async (tx) => {
        await lockUser(tx, userId)
        const user = await tx.user.findUnique({ where: { id: userId }, select: { status: true } })
        if (!user || user.status !== 'active') throw new ForbiddenException('账号当前不可提交认证')
        await tx.$queryRaw`SELECT id FROM campus_identity_verifications WHERE user_id = ${userId} FOR UPDATE`
        const current = await tx.campusIdentityVerification.findUnique({ where: { userId } })
        if (current?.status === 'pending') throw new ConflictException('认证资料正在审核中，不能重复覆盖')
        if (current?.status === 'approved') throw new ConflictException('认证已通过，如需修改请先联系管理员撤销')
        if (current && input.expectedRevision !== current.revision) throw new ConflictException('认证资料状态已变化，请重新读取')
        if (!current && input.expectedRevision !== undefined) throw new ConflictException('认证资料状态已变化，请重新读取')
        if (await tx.campusIdentityVerification.count({ where: { userId: { not: userId }, idNumberFingerprint: fingerprint, status: { in: ['pending', 'approved'] } } })) throw new ConflictException('该身份资料已用于其他账号，请联系管理员处理')
        if (await tx.campusIdentityVerification.count({ where: { userId: { not: userId }, studentNo: { equals: studentNo, mode: 'insensitive' }, status: { in: ['pending', 'approved'] } } })) throw new ConflictException('该学号已用于其他账号，请联系管理员处理')
        const data = {
          realNameEncrypted: encryptIdentity(input.realName.trim(), key, 'real-name'),
          idNumberEncrypted: encryptIdentity(idNumber, key, 'id-number'),
          idNumberFingerprint: fingerprint,
          idNumberLast4: idNumber.slice(-4),
          className: input.className.trim(), studentNo, status: 'pending' as const, submittedAt: now,
          reviewedAt: null, reviewedById: null, reviewReason: null,
        }
        if (current) await tx.campusIdentityVerification.update({ where: { id: current.id }, data: { ...data, revision: { increment: 1 } } })
        else await tx.campusIdentityVerification.create({ data: { userId, ...data } })
        await actionEvent(tx, userId, 'identity_verification_submitted', 'user', userId)
      })
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') throw new ConflictException('该身份资料或学号已用于其他账号，请联系管理员处理')
      throw error
    }
    return this.verificationSummary(userId)
  }
  async identityDetail(actorId: string, userId: string): Promise<AdminIdentityVerificationDto> {
    const row = await this.prisma.campusIdentityVerification.findUnique({ where: { userId }, include: { reviewedBy: { select: { id: true, displayName: true } } } })
    if (!row) throw new NotFoundException('用户尚未提交实名认证')
    const key = this.identityKey(), realName = decryptIdentity(row.realNameEncrypted, key, 'real-name'), idNumber = decryptIdentity(row.idNumberEncrypted, key, 'id-number')
    const suspectedDuplicateStudentNo = !!await this.prisma.campusIdentityVerification.count({ where: { userId: { not: userId }, studentNo: { equals: row.studentNo, mode: 'insensitive' } } })
    await this.prisma.auditLog.create({ data: { actorId, action: 'identity_sensitive_read', targetType: 'identity_verification', targetId: row.id } })
    return { id: row.id, userId, realName, idNumber, status: row.status, submittedAt: row.submittedAt.toISOString(), reviewedAt: row.reviewedAt?.toISOString() || null, reviewReason: row.reviewReason, maskedRealName: maskRealName(realName), maskedIdNumber: maskIdNumber(idNumber), className: row.className, studentNo: row.studentNo, revision: row.revision, reviewedBy: row.reviewedBy, suspectedDuplicateStudentNo }
  }
  async reviewIdentity(actor: AuthUser, userId: string, action: 'approve' | 'reject' | 'revoke', input: IdentityReviewDto) {
    await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM campus_identity_verifications WHERE user_id = ${userId} FOR UPDATE`
      const row = await tx.campusIdentityVerification.findUnique({ where: { userId } })
      if (!row) throw new NotFoundException('用户尚未提交实名认证')
      const expected = action === 'revoke' ? 'approved' : 'pending'
      if (row.status !== expected) throw new ConflictException('认证状态已变化，当前操作不再适用')
      if (row.revision !== input.expectedRevision) throw new ConflictException('认证资料已被其他审核人更新，请重新读取')
      const status = action === 'approve' ? 'approved' : action === 'reject' ? 'rejected' : 'revoked'
      await tx.campusIdentityVerification.update({ where: { id: row.id }, data: { status, reviewedAt: new Date(), reviewedById: actor.id, reviewReason: input.reason, revision: { increment: 1 } } })
      if (action === 'approve') {
        const schoolSetting = await tx.systemSetting.findUnique({ where: { key: 'campus_school_id' } })
        const configuredSchoolId = typeof schoolSetting?.value === 'string' && await tx.school.count({ where: { id: schoolSetting.value, status: 'active' } }) ? schoolSetting.value : undefined
        await tx.user.update({ where: { id: userId }, data: { studentNo: row.studentNo, ...(configuredSchoolId ? { schoolId: configuredSchoolId } : {}) } })
      }
      await tx.auditLog.create({ data: { actorId: actor.id, action: `identity_${status}`, targetType: 'identity_verification', targetId: row.id, details: { reason: input.reason } } })
    })
    return { updated: true }
  }
  private async assertTarget(actor: AuthUser, id: string, tx: Prisma.TransactionClient) {
    if (actor.id === id) throw new BadRequestException('不能对当前管理员执行此账号操作')
    await lockUser(tx, id)
    const target = await tx.user.findUnique({ where: { id }, select: { userRoles: { select: { role: { select: { code: true } } } } } })
    if (!target) throw new NotFoundException('用户不存在')
    if (target.userRoles.some((r) => ['admin', 'super_admin'].includes(r.role.code)) && !actor.roles.includes('super_admin')) throw new ForbiddenException('管理管理员账号需要超级管理员权限')
  }
  private async audit(tx: Prisma.TransactionClient, actorId: string, id: string, action: string, reason: string) {
    await tx.auditLog.create({ data: { actorId, action, targetType: 'user', targetId: id, details: { reason } } })
    await actionEvent(tx, actorId, action, 'user', id, { reason }, 'admin-web')
  }
  async status(actor: AuthUser, id: string, input: UserStatusUpdateDto) {
    return this.prisma.$transaction(async (tx) => {
      await lockFileReferences(tx)
      await this.assertTarget(actor, id, tx)
      const current = await tx.user.findUniqueOrThrow({ where: { id } })
      if ((input.status !== 'active' || current.status !== 'active') && !actor.roles.includes('super_admin')) throw new ForbiddenException('设置或撤销无限期账号停用需要超级管理员；临时封禁请通过治理工作台设置期限')
      if (current.status === input.status) throw new ConflictException('账号已经处于此状态，不重复处置')
      if (!input.expectedRevision) throw new BadRequestException('请携带账号版本')
      if (!(await tx.user.updateMany({ where: { id, revision: input.expectedRevision }, data: { status: input.status, revision: { increment: 1 }, ...(input.status !== 'active' ? { sessionVersion: { increment: 1 } } : {}) } })).count) throw new ConflictException('账号资料已变化，请刷新')
      if (input.status !== 'active') await tx.refreshToken.updateMany({ where: { userId: id, revokedAt: null }, data: { revokedAt: new Date() } })
      // 新的账号状态决定替代旧的手工状态记录；独立治理封禁继续生效。
      await tx.communityModerationAction.updateMany({ where: { subjectId: id, action: 'ban', revokedAt: null, metadata: { path: ['accountStatus'], not: Prisma.DbNull } }, data: { revokedAt: new Date(), revokedById: actor.id, revokeReason: input.reason, revision: { increment: 1 } } })
      if (input.status !== 'active') {
        const action = await tx.communityModerationAction.create({ data: { actorId: actor.id, subjectId: id, targetType: 'profile', targetId: id, action: 'ban', reason: input.reason, ruleCode: '账号管理：无限期停用', metadata: { accountStatus: input.status, accountRevision: input.expectedRevision + 1 } } })
        await tx.userNotification.create({ data: { recipientId: id, notificationType: 'moderation', entityType: 'moderation_action', entityId: action.id, dedupeKey: `governance:${id}:moderation_action:${action.id}`, payload: { message: `账号已停用：${input.reason}。可通过账号恢复与申诉查看依据。` } } })
      } else {
        await tx.userNotification.create({ data: { recipientId: id, notificationType: 'moderation', entityType: 'account_restored', entityId: id, dedupeKey: `governance:${id}:account_restored:${input.expectedRevision}`, payload: { message: `账号状态已恢复：${input.reason}。其他有效处罚仍需分别复核。` } } })
      }
      await this.audit(tx, actor.id, id, `user_${input.status}`, input.reason)
      return { updated: true }
    })
  }
  async action(actor: AuthUser, id: string, action: 'revoke_sessions' | 'reset_onboarding', reason: string) {
    return this.prisma.$transaction(async (tx) => {
      await this.assertTarget(actor, id, tx)
      await tx.user.update({ where: { id }, data: { revision: { increment: 1 }, ...(action === 'revoke_sessions' ? { sessionVersion: { increment: 1 } } : { onboardingCompletedAt: null }) } })
      if (action === 'revoke_sessions') await tx.refreshToken.updateMany({ where: { userId: id, revokedAt: null }, data: { revokedAt: new Date() } })
      await this.audit(tx, actor.id, id, action, reason)
      return { updated: true }
    })
  }
  async resetPassword(actor: AuthUser, id: string, reason: string) {
    await this.prisma.$transaction(async (tx) => {
      await this.assertTarget(actor, id, tx)
      await this.audit(tx, actor.id, id, 'password_reset_requested', reason)
    })
    const target = await this.prisma.user.findUniqueOrThrow({ where: { id }, select: { email: true } })
    return this.registration.forgot(target.email, `admin:${actor.id}`)
  }
  async update(actor: AuthUser, id: string, input: UserUpdateDto, allowStudentNo = false) {
    const { expectedRevision, reason, displayName, ...data } = input
    if (data.studentNo !== undefined && !allowStudentNo) throw new ForbiddenException('缺少实名资料读取权限')
    if (data.schoolId && !await this.prisma.school.count({ where: { id: data.schoolId, status: 'active' } })) throw new BadRequestException('学校不存在')
    if (data.departmentId && !await this.prisma.department.count({ where: { id: data.departmentId, schoolId: data.schoolId } })) throw new BadRequestException('院系与学校不匹配')
    await this.prisma.$transaction(async (tx) => {
      await lockFileReferences(tx)
      await this.assertTarget(actor, id, tx)
      const verification = await tx.campusIdentityVerification.findUnique({ where: { userId: id }, select: { status: true, studentNo: true } })
      if (verification?.status === 'approved' && data.studentNo !== undefined && normalizeStudentNo(data.studentNo) !== verification.studentNo) throw new ConflictException('已认证学号只能先撤销认证后修改')
      if (!(await tx.user.updateMany({ where: { id, revision: expectedRevision }, data: { ...data, schoolId: data.schoolId || null, departmentId: data.departmentId || null, revision: { increment: 1 } } })).count) throw new ConflictException('资料已变化，请刷新')
      await this.detection.saveProfile(tx, id, { displayName }, actor.id)
      await this.audit(tx, actor.id, id, 'profile_updated', reason)
    })
    return this.detail(id)
  }
}
