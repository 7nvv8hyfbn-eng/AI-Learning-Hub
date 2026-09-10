import type { CommunityAuthorDto } from '@ai-learning-hub/contracts'
import { Prisma } from '@prisma/client'
import { badgeUserInclude, publicIdentityHidden, trustedVerifiedType, userBadgeSettings, type BadgeContext } from './user-badges'
export const authorInclude = { ...badgeUserInclude, school: true } satisfies Prisma.UserInclude
export type CommunityAuthor = Prisma.UserGetPayload<{ include: typeof authorInclude }>
export const profileMediaUrl = (fileId?: string | null) => fileId ? `/api/v1/files/profile/${encodeURIComponent(fileId)}` : null
export function authorDto(user: CommunityAuthor, context?: BadgeContext): CommunityAuthorDto {
  if (publicIdentityHidden(user, context?.now)) return { id: user.id, username: '', displayName: '账号资料暂不可见', avatar: null, school: null, major: null, verifiedType: 'none', badges: [] }
  return { id: user.id, username: user.username, displayName: user.displayName, avatar: profileMediaUrl(user.communityProfile?.avatarFileId), school: user.school?.name || null, major: user.major, verifiedType: trustedVerifiedType(user), badges: userBadgeSettings(user, context).badges }
}
export const json = (value: unknown) => JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue
