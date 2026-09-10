export const SESSION_REPLACED = 'SESSION_REPLACED'
export const ACCOUNT_BANNED = 'ACCOUNT_BANNED'
export const SESSION_REPLACED_MESSAGE = '你的账号已在其他设备登录，当前设备已退出。'
export type SessionRevocationReason = 'replaced_by_login' | 'manual_logout' | 'security_revoke'

export interface AuthUser {
  badges?: import('./community/badges').CommunityUserBadge[]
  sessionId?: string
  sessionClient?: import('./account-security').SessionClient
  mfaVerified?: boolean
  contentDetection?: import('./content-detection').ContentDetectionResult
  revision?: number
  profileRevision?: number
  sessionVersion?: number
  grade?: string | null
  schoolId?: string | null
  departmentId?: string | null
  id: string
  email: string
  username: string
  displayName: string
  avatarUrl: string | null
  school: string | null
  major: string | null
  onboardingCompleted: boolean
  emailVerificationRequired: boolean
  identityVerificationStatus: IdentityVerificationStatus
  communityWriteEnabled: boolean
  roles: string[]
  permissions: string[]
  moderatorCapabilities?: import('./moderation').ModeratorCapability[]
}
export interface AuthSessionDto { user: AuthUser; accessToken: string; expiresIn: number }
export interface RegisterInput {
  username: string; displayName: string; email: string; password: string; agreementVersion: string; inviteCode?: string
}
export interface RegistrationSettingsDto {
  revision?: number
  expectedRevision?: number
  mode: 'open' | 'invite' | 'closed'
  emailVerification: boolean
  agreementVersion: string
  passwordMinLength: number
  schoolRequired: boolean
  registrationRateWindowMinutes: number
  registrationMaxAttemptsPerIp: number
  registrationMaxAttemptsPerIdentifier: number
  registrationMaxSuccessPerIp: number
}
export interface RegistrationConfigDto extends RegistrationSettingsDto {
  mailAvailable: boolean
  inviteAvailable: boolean
}
export interface PasswordForgotInput { email: string }
export interface PasswordResetInput { token: string; password: string }
export interface OnboardingInput { schoolId?: string; departmentId?: string; major: string; grade: string; headline: string; themeIds: string[]; expectedRevision?: number; expectedProfileRevision?: number }
export interface UsernameInput { username: string }
export type IdentityVerificationStatus = 'unsubmitted' | 'pending' | 'approved' | 'rejected' | 'revoked'
export interface CampusIdentityVerificationDto {
  status: IdentityVerificationStatus
  submittedAt: string | null
  reviewedAt: string | null
  reviewReason: string | null
  maskedRealName: string | null
  maskedIdNumber: string | null
  className: string | null
  studentNo: string | null
  revision: number | null
}
export interface CampusIdentityVerificationInput {
  realName: string
  idNumber: string
  className: string
  studentNo: string
  expectedRevision?: number
}
export interface AdminIdentityVerificationDto extends CampusIdentityVerificationDto {
  id: string
  userId: string
  realName: string
  idNumber: string
  reviewedBy: { id: string; displayName: string } | null
  suspectedDuplicateStudentNo: boolean
}
export interface IdentityReviewInput { expectedRevision: number; reason: string }
export interface AdminUserDto {
  id: string; username: string; displayName: string; email: string; status: string
  registrationSource: string; school: { id: string; name: string } | null
  major: string | null; grade: string | null; lastLoginAt: string | null
  createdAt: string; onboardingCompleted: boolean; communityPostCount: number
  userType: string
  department?: { name: string } | null
  identityVerificationStatus: IdentityVerificationStatus
  studentNo?: string | null
}
export interface UserStatusInput { status: 'active' | 'disabled' | 'locked'; reason?: string; expectedRevision?: number }
