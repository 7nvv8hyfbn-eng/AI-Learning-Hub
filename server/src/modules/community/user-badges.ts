import { BadRequestException } from '@nestjs/common'
import { Prisma } from '@prisma/client'
import { automaticBadgeCodes, automaticBadgeLabels, userBadgeTones, type AutomaticBadgeCode, type CommunityUserBadge, type CommunityVerifiedType, type CustomUserBadge, type UserBadgeSettingsDto } from '@ai-learning-hub/contracts'
import { communityAccountDecision } from './visibility.service'
import { moderatorActions } from './moderator-grants'

export const badgeUserInclude = {
  communityProfile: true,
  identityVerification: { select: { status: true } },
  moderatorGrants: { select: { scope: true, enabled: true, canDelete: true, canMute: true, canBan: true } },
  userRoles: { include: { role: { include: { _count: { select: { permissions: true } } } } } },
  receivedModeration: { where: { revokedAt: null, OR: [{ action: 'ban' }, { action: 'takedown', targetType: 'profile' }] }, select: { action: true, targetType: true, expiresAt: true } },
  communityRestrictions: { where: { revokedAt: null, operations: { has: 'post' } }, select: { startsAt: true, endsAt: true } },
} satisfies Prisma.UserInclude
export type BadgeUser = Prisma.UserGetPayload<{ include: typeof badgeUserInclude }>
export interface BadgeContext { agreementVersion: string | null; now: Date }
export async function loadBadgeContext(tx: Prisma.TransactionClient): Promise<BadgeContext> {
  const row = await tx.systemSetting.findUnique({ where: { key: 'registration' }, select: { value: true } })
  const value = row?.value as Prisma.JsonObject | undefined
  return { agreementVersion: typeof value?.agreementVersion === 'string' ? value.agreementVersion : null, now: new Date() }
}
export function trustedVerifiedType(user: Pick<BadgeUser, 'communityProfile' | 'userRoles'>): CommunityVerifiedType {
  const verified = user.communityProfile?.verifiedType || 'none'
  const role = verified === 'official' ? 'community_official' : verified
  return ['official', 'teacher', 'mentor'].includes(verified) && user.userRoles.some((row) => row.role.code === role) ? verified as CommunityVerifiedType : 'none'
}
export const publicIdentityHidden = (user: BadgeUser, now = new Date()) => user.status !== 'active' || user.receivedModeration.some((row) => !row.expiresAt || row.expiresAt > now)
const reserved = new Set([...Object.values(automaticBadgeLabels), '官方账号', '社区官方', '教师', '导师', '前台版主', '社区版主', '教程中心版主', '管理员', '超级管理员', ...automaticBadgeCodes])
const normalize = (label: string) => label.normalize('NFKC').replace(/[\s\p{Cc}\p{Cf}]/gu, '')
export function normalizeCustomBadges(value: unknown): CustomUserBadge[] {
  if (!Array.isArray(value) || value.length > 3) throw new BadRequestException('最多添加 3 个普通标签')
  const seen = new Set<string>(), badges: CustomUserBadge[] = []
  for (const item of value) {
    if (!item || typeof item !== 'object' || Array.isArray(item) || Object.keys(item).some((key) => !['label', 'tone'].includes(key)) || typeof item.label !== 'string' || !userBadgeTones.includes(item.tone)) throw new BadRequestException('标签只允许纯文字和指定主题色')
    const label = normalize(item.label), key = label.toLowerCase()
    if (!label || [...label].length > 12 || /[<>]/.test(label)) throw new BadRequestException('标签须为 1～12 字的纯文字')
    if (reserved.has(key)) throw new BadRequestException('身份标签须通过现有认证或前台版主授权流程设置')
    if (!seen.has(key)) { seen.add(key); badges.push({ label, tone: item.tone }) }
  }
  return badges
}
export function userBadgeSettings(user: BadgeUser, context?: BadgeContext): UserBadgeSettingsDto {
  const now = context?.now || new Date(), profile = user.communityProfile
  const hiddenAutomaticBadges = (profile?.hiddenAutomaticBadges || []).filter((code): code is AutomaticBadgeCode => automaticBadgeCodes.includes(code as AutomaticBadgeCode))
  const customBadges = normalizeCustomBadges(profile?.customBadges || [])
  const automaticBadges: CommunityUserBadge[] = []
  if (!publicIdentityHidden(user, now)) {
    const verified = trustedVerifiedType(user)
    if (verified !== 'none') automaticBadges.push({ code: verified, label: automaticBadgeLabels[verified], tone: verified === 'official' ? 'orange' : verified === 'teacher' ? 'blue' : 'green' })
    const eligible = context && !communityAccountDecision(user, context.agreementVersion) && !user.userRoles.some((row) => row.role._count.permissions > 0) && !user.communityRestrictions.some((row) => row.startsAt <= now && row.endsAt > now)
    const scopes = eligible ? user.moderatorGrants.filter((grant) => grant.enabled && moderatorActions(grant).length).map((grant) => grant.scope) : []
    if (scopes.length) automaticBadges.push({ code: 'moderator', label: automaticBadgeLabels.moderator, tone: 'purple', scopes: [...new Set(scopes)] })
  }
  const badges: CommunityUserBadge[] = publicIdentityHidden(user, now) ? [] : [...automaticBadges.filter((badge) => !hiddenAutomaticBadges.includes(badge.code as AutomaticBadgeCode)), ...customBadges.map((badge) => ({ ...badge, code: `custom:${badge.label}` as const }))]
  return { publicVisible: !publicIdentityHidden(user, now), revision: profile?.revision || 1, badges, automaticBadges, customBadges, hiddenAutomaticBadges }
}
