import type { AuthUser, ModeratorScope } from '@ai-learning-hub/contracts'

export const moderatorActionsFor = (user: AuthUser | null, scope: ModeratorScope, authorId: string) =>
  user && user.id !== authorId && user.communityWriteEnabled && !user.permissions.length
    ? user.moderatorCapabilities?.find((grant) => grant.scope === scope)?.actions.filter(action => authorId !== 'platform-content' || action === 'takedown') || [] : []
