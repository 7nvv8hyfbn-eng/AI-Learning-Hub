import type { Prisma } from '@prisma/client'

// 所有入口直接判断当前处罚，期限届满即时失效；不回写内容状态，不覆盖新的审核结果。
export const activeSanction = (action?: string, now = new Date()): Prisma.CommunityModerationActionWhereInput => ({
  ...(action ? { action } : {}), revokedAt: null, subjectId: { not: null }, OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
})
export const availableAccount = (): Prisma.UserWhereInput => ({ status: 'active', receivedModeration: { none: activeSanction('ban') } })
export const visibleProfile = (): Prisma.UserWhereInput => ({ ...availableAccount(), NOT: { receivedModeration: { some: { ...activeSanction('takedown'), targetType: 'profile' } } } })
export const visibleCollection = (): Prisma.LearningCollectionWhereInput => ({ visibility: 'community', contentStatus: 'published', owner: availableAccount(), moderationActions: { none: activeSanction('takedown') } })
export const visibleComment = (): Prisma.CommunityCommentWhereInput => ({ author: availableAccount(), moderationActions: { none: activeSanction('takedown') } })
export const visiblePublicPost = (): Prisma.CommunityPostWhereInput => ({ status: 'published', visibility: 'public', deletedAt: null, publishedAt: { not: null }, author: availableAccount(), moderationActions: { none: activeSanction('takedown') } })
