import type { ModeratorScope } from '../moderation'

export const automaticBadgeCodes = ['official', 'moderator', 'teacher', 'mentor'] as const
export type AutomaticBadgeCode = typeof automaticBadgeCodes[number]
export const userBadgeTones = ['orange', 'purple', 'green', 'blue'] as const
export type UserBadgeTone = typeof userBadgeTones[number]
export interface CustomUserBadge { label: string; tone: UserBadgeTone }
export interface CommunityUserBadge extends CustomUserBadge {
  code: AutomaticBadgeCode | `custom:${string}`
  scopes?: ModeratorScope[]
}
export const automaticBadgeLabels: Record<AutomaticBadgeCode, string> = {
  official: '官方', moderator: '版主', teacher: '认证教师', mentor: '学习导师',
}
export interface UserBadgeSettingsDto {
  publicVisible: boolean
  revision: number
  badges: CommunityUserBadge[]
  automaticBadges: CommunityUserBadge[]
  customBadges: CustomUserBadge[]
  hiddenAutomaticBadges: AutomaticBadgeCode[]
}
export interface UserBadgeUpdateInput {
  expectedRevision: number
  customBadges: CustomUserBadge[]
  hiddenAutomaticBadges: AutomaticBadgeCode[]
  reason: string
}
