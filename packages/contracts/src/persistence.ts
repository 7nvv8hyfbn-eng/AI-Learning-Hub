import type { AdminUserDto, CampusIdentityVerificationDto, IdentityVerificationStatus } from './auth'
import type { CommunityBindingInput, CommunityContentBlock, CommunityPostType, CommunityVisibility } from './community'

export interface AdminUserQueryDto {
  page?: number; pageSize?: number; keyword?: string; status?: 'active' | 'disabled' | 'locked'
  userType?: string; role?: string; registrationSource?: string; schoolId?: string
  onboardingCompleted?: boolean; emailVerified?: boolean
  identityVerificationStatus?: IdentityVerificationStatus
  createdFrom?: string; createdTo?: string; lastLoginFrom?: string; lastLoginTo?: string
  sortBy?: 'createdAt' | 'lastLoginAt' | 'displayName'; sortOrder?: 'asc' | 'desc'
}
export interface AdminUserSummaryDto extends AdminUserDto {
  avatar: string | null; roles: string[]; emailVerified: boolean; revision: number
  department: { id: string; name: string } | null
}
export interface UserActionEventDto {
  id: string; eventType: string; actorId: string | null; entityType: string | null; entityId: string | null
  source: string; occurredAt: string
}
export type AdminUserActivityDto = UserActionEventDto
export interface AdminUserDetailDto {
  user: AdminUserSummaryDto & { studentNo?: string | null; teacherNo: string | null; updatedAt: string }
  security: {
    agreementVersion: string | null; agreementAcceptedAt: string | null; emailVerifiedAt: string | null
    passwordSet: boolean; activeSessions: number; lastLoginResult: string | null
    identities: Array<{ provider: string; createdAt: string }>
  }
  community: {
    revision: number; headline: string; bio: string; verifiedType: string; expertiseTopics: string[]
    postCount: number; commentCount: number; followerCount: number; followingCount: number; reportCount: number
  }
  verification: CampusIdentityVerificationDto
  activities: AdminUserActivityDto[]
  audits: Array<{ id: string; action: string; reason: string; createdAt: string }>
}
export interface AdminUserUpdateInput {
  reason: string; expectedRevision: number
  displayName: string; schoolId?: string; departmentId?: string; major: string; grade: string
  studentNo?: string; teacherNo?: string
}
export interface AdminCommunityPostQueryDto {
  page?: number; pageSize?: number; keyword?: string; status?: string; authorId?: string
  postType?: CommunityPostType; visibility?: CommunityVisibility; topicId?: string; schoolId?: string
  hasMedia?: boolean; reported?: boolean; createdFrom?: string; createdTo?: string
  sortBy?: 'createdAt' | 'publishedAt' | 'editedAt'; sortOrder?: 'asc' | 'desc'
}
export interface AdminCommunityCommentQueryDto extends AdminCommunityPostQueryDto { postId?: string }
export interface CommunityPostRevisionDto {
  id: string; postId: string; revisionNo: number; editorId: string; editorType: string
  titleSnapshot: string | null; contentBlocksSnapshot: CommunityContentBlock[]
  bindingsSnapshot: CommunityBindingInput[]; topicIdsSnapshot: string[]
  visibilitySnapshot: string; statusSnapshot: string; reason: string; createdAt: string
}
export interface RequestIdempotencyDto { resourceId: string; status: 'completed'; expiresAt: string }
export interface PersistenceStatusDto {
  database: { connected: boolean; type: 'PostgreSQL'; migrations: Array<{ name: string; finishedAt: string | null }>; ready: boolean }
  storage: { driver: string; writable: boolean }
  counts: { users: number; posts: number; drafts: number; comments: number; files: number; pendingReports: number }
  lastWriteAt: string | null
}
