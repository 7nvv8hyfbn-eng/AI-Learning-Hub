import { Prisma } from '@prisma/client'
import type { AuthUser } from '@ai-learning-hub/contracts'
import { profileMediaUrl } from '../community/community.mapper'
import { moderatorActions } from '../community/moderator-grants'
import { badgeUserInclude, userBadgeSettings, type BadgeContext } from '../community/user-badges'
export const authUserInclude = {
  ...badgeUserInclude,
  school: true,
  communityProfile: true,
  identityVerification: { select: { status: true } },
  moderatorGrants: { where: { enabled: true } },
  userRoles: { include: { role: { include: { _count: { select: { permissions: true } }, permissions: { include: { permission: true } } } } } },
} satisfies Prisma.UserInclude
export function authUserDto(user: Prisma.UserGetPayload<{ include: typeof authUserInclude }>, context?: BadgeContext): AuthUser {
  const roles = user.userRoles.map((row) => row.role.code)
  const trusted = (!!user.communityProfile?.verifiedType && user.communityProfile.verifiedType !== 'none') || roles.some((role) => ['super_admin', 'admin', 'community_official', 'teacher', 'mentor'].includes(role))
  return {
    id: user.id, email: user.email, username: user.username, displayName: user.displayName,
    revision: user.revision, profileRevision: user.communityProfile?.revision || 1, sessionVersion: user.sessionVersion, schoolId: user.schoolId, departmentId: user.departmentId, grade: user.grade,
    avatarUrl: profileMediaUrl(user.communityProfile?.avatarFileId), school: user.school?.name || null, major: user.major,
    onboardingCompleted: !!user.onboardingCompletedAt,
    emailVerificationRequired: !user.emailVerifiedAt && !!(user.profile as Record<string, unknown>)?.emailVerificationRequired,
    identityVerificationStatus: user.identityVerification?.status || 'unsubmitted',
    communityWriteEnabled: trusted || user.identityVerification?.status === 'approved',
    roles,
    badges: userBadgeSettings(user, context).badges,
    moderatorCapabilities: (user.moderatorGrants || []).map((grant) => ({ scope: grant.scope, actions: moderatorActions(grant) })),
    permissions: [...new Set(user.userRoles.flatMap((row) => row.role.permissions.map((grant) => grant.permission.code)))],
  }
}
