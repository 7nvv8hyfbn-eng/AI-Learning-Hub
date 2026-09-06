import { Prisma } from '@prisma/client'
import type { AuthUser } from '@ai-learning-hub/contracts'
import { profileMediaUrl } from '../community/community.mapper'
export const authUserInclude = {
  school: true,
  communityProfile: true,
  userRoles: { include: { role: { include: { permissions: { include: { permission: true } } } } } },
} satisfies Prisma.UserInclude
export function authUserDto(user: Prisma.UserGetPayload<{ include: typeof authUserInclude }>): AuthUser {
  return {
    id: user.id, email: user.email, username: user.username, displayName: user.displayName,
    revision: user.revision, profileRevision: user.communityProfile?.revision || 1, sessionVersion: user.sessionVersion, schoolId: user.schoolId, departmentId: user.departmentId, grade: user.grade,
    avatarUrl: profileMediaUrl(user.communityProfile?.avatarFileId), school: user.school?.name || null, major: user.major,
    onboardingCompleted: !!user.onboardingCompletedAt,
    emailVerificationRequired: !user.emailVerifiedAt && !!(user.profile as Record<string, unknown>)?.emailVerificationRequired,
    roles: user.userRoles.map((row) => row.role.code),
    permissions: [...new Set(user.userRoles.flatMap((row) => row.role.permissions.map((grant) => grant.permission.code)))],
  }
}
