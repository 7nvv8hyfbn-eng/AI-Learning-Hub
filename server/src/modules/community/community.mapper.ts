import type { CommunityAuthorDto, CommunityVerifiedType } from '@ai-learning-hub/contracts'
import { Prisma } from '@prisma/client'
export const authorInclude = { school: true, communityProfile: true, userRoles: { include: { role: true } } } satisfies Prisma.UserInclude
export type CommunityAuthor = Prisma.UserGetPayload<{ include: typeof authorInclude }>
export const profileMediaUrl = (fileId?: string | null) => fileId ? `/api/v1/files/profile/${encodeURIComponent(fileId)}` : null
export function authorDto(user: CommunityAuthor): CommunityAuthorDto {
  const roles = user.userRoles.map((row) => row.role.code)
  const verified = user.communityProfile?.verifiedType || 'none'
  const verifiedType: CommunityVerifiedType = verified === 'official' && roles.includes('community_official') ? 'official'
    : verified === 'teacher' && roles.includes('teacher') ? 'teacher' : verified === 'mentor' && roles.includes('mentor') ? 'mentor' : 'none'
  return { id: user.id, username: user.username, displayName: user.displayName, avatar: profileMediaUrl(user.communityProfile?.avatarFileId), school: user.school?.name || null, major: user.major, verifiedType }
}
export const json = (value: unknown) => JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue
