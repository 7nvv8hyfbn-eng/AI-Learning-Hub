import type { CommunityOperation } from './community'

export const reportCategories = { harassment: '骚扰与不当内容', privacy: '隐私泄露', spam: '垃圾广告', copyright: '版权问题', misinformation: '内容不准确', safety: '安全风险', other: '其他' } as const
export type ReportCategory = keyof typeof reportCategories
export type GovernanceTarget = 'post' | 'comment' | 'resource' | 'collection' | 'profile'
export type GovernanceStatus = 'pending' | 'reviewing' | 'resolved' | 'rejected'
export const governanceStatusLabels: Record<GovernanceStatus, string> = { pending: '待处理', reviewing: '处理中', resolved: '已处理', rejected: '驳回' }
export const sanctionLabels = { warn: '提醒', restrict: '限制单项功能', mute: '临时禁言', takedown: '内容下架', ban: '账号封禁' } as const
export type SanctionAction = keyof typeof sanctionLabels
export interface GovernanceReportInput { category: ReportCategory; reason: string; description?: string; evidence?: string[] }
export interface GovernanceDecisionInput {
  expectedRevision: number; action: SanctionAction | 'reject'; reason: string; ruleCode: string
  operation?: Exclude<CommunityOperation, 'read'>; expiresAt?: string
  expectedContentRevision?: number
}
export interface GovernanceTargetDto { type: string; id: string; revision: number | null; title: string; route: string | null; available: boolean; text?: string; currentRevision?: number | null }
export interface GovernanceReportDto {
  id: string; revision: number; target: GovernanceTargetDto; category: ReportCategory; reason: string; description: string; evidence: string[]
  status: GovernanceStatus; assignedToId: string | null; dueAt: string; createdAt: string; resultReason: string; actionId: string | null
}
export interface GovernanceActionDto {
  id: string; revision: number; target: GovernanceTargetDto; action: SanctionAction; reason: string; ruleCode: string
  expiresAt: string | null; revokedAt: string | null; revokeReason: string; active: boolean; createdAt: string; operations: string[]
}
export interface GovernanceAppealInput { actionId?: string; reviewId?: string; reason: string; evidence?: string[] }
export interface GovernanceRestrictionInput { operations: Exclude<CommunityOperation, 'read'>[]; startsAt?: string; endsAt: string; reason: string; ruleCode: string }
export interface GovernanceAppealDto {
  id: string; revision: number; actionId: string | null; reviewId: string | null; reason: string; evidence: string[]
  status: GovernanceStatus; resultReason: string; assignedToId: string | null; dueAt: string; createdAt: string
}
export interface GovernanceReviewDto {
  id: string; targetType: string; targetId: string; contentRevision: number; ruleVersion: number; status: string; reason: string
  assignedToId: string | null; dueAt: string; createdAt: string
}
export interface GovernanceMineDto { actions: GovernanceActionDto[]; reports: GovernanceReportDto[]; appeals: GovernanceAppealDto[]; reviews: GovernanceReviewDto[]; hasMore?: boolean }
export interface GovernanceQueueDto { reports: GovernanceReportDto[]; appeals: GovernanceAppealDto[]; reviews: GovernanceReviewDto[]; total: number; page: number; pageSize: number }
