import { Transform, Type } from 'class-transformer'
import { IsBoolean, IsDateString, IsIn, IsInt, IsOptional, IsString, Length, Matches, Max, MaxLength, Min } from 'class-validator'
import type { AdminUserQueryDto, CampusIdentityVerificationInput, IdentityReviewInput } from '@ai-learning-hub/contracts'

export const queryBoolean = ({ value }: { value: unknown }) => value === 'true' ? true : value === 'false' ? false : value
export class PageQuery {
  @Type(() => Number) @IsInt() @Min(1) @Max(100000) page = 1
  @Type(() => Number) @IsInt() @Min(1) @Max(100) pageSize = 20
  @IsOptional() @IsString() @MaxLength(120) keyword?: string
  @IsOptional() @IsString() @MaxLength(40) status?: string
  @IsOptional() @IsDateString() createdFrom?: string
  @IsOptional() @IsDateString() createdTo?: string
  @IsOptional() @IsIn(['asc', 'desc']) sortOrder: 'asc' | 'desc' = 'desc'
}
export class UserQuery extends PageQuery implements AdminUserQueryDto {
  @IsOptional() @IsIn(['active', 'disabled', 'locked']) declare status?: 'active' | 'disabled' | 'locked'
  @IsOptional() @IsString() @MaxLength(40) userType?: string
  @IsOptional() @IsString() @MaxLength(60) role?: string
  @IsOptional() @IsString() @MaxLength(60) registrationSource?: string
  @IsOptional() @IsString() @MaxLength(100) schoolId?: string
  @IsOptional() @Transform(queryBoolean) @IsBoolean() onboardingCompleted?: boolean
  @IsOptional() @Transform(queryBoolean) @IsBoolean() emailVerified?: boolean
  @IsOptional() @IsIn(['unsubmitted', 'pending', 'approved', 'rejected', 'revoked']) identityVerificationStatus?: AdminUserQueryDto['identityVerificationStatus']
  @IsOptional() @IsDateString() lastLoginFrom?: string
  @IsOptional() @IsDateString() lastLoginTo?: string
  @IsOptional() @IsIn(['createdAt', 'lastLoginAt', 'displayName']) sortBy: 'createdAt' | 'lastLoginAt' | 'displayName' = 'createdAt'
}
export class CampusIdentityVerificationInputDto implements CampusIdentityVerificationInput {
  @Transform(({ value }) => typeof value === 'string' ? value.trim() : value) @IsString() @Length(2, 40) @Matches(/^[\p{L}·\s]+$/u) realName!: string
  @Transform(({ value }) => typeof value === 'string' ? value.trim().toUpperCase() : value) @IsString() @Length(18, 18) idNumber!: string
  @Transform(({ value }) => typeof value === 'string' ? value.trim() : value) @IsString() @Length(1, 80) @Matches(/^[^\p{Cc}<>]+$/u) className!: string
  @Transform(({ value }) => typeof value === 'string' ? value.trim().replace(/\s+/g, '').toUpperCase() : value) @IsString() @Matches(/^[A-Z0-9_-]{2,40}$/) studentNo!: string
  @IsOptional() @IsInt() @Min(1) expectedRevision?: number
}
export class IdentityReviewDto implements IdentityReviewInput {
  @IsInt() @Min(1) expectedRevision!: number
  @Transform(({ value }) => typeof value === 'string' ? value.trim() : value) @IsString() @Length(4, 500) @Matches(/\S/) reason!: string
}
export class UserReasonDto {
  @IsString() @Length(4, 500) @Matches(/\S/) reason!: string
}
export class UserStatusUpdateDto extends UserReasonDto {
  @IsIn(['active', 'disabled', 'locked']) status!: 'active' | 'disabled' | 'locked'
  @IsInt() @Min(1) expectedRevision!: number
}
export class UserUpdateDto extends UserReasonDto {
  @IsInt() @Min(1) expectedRevision!: number
  @IsString() @Length(1, 40) displayName!: string
  @IsOptional() @IsString() @MaxLength(100) schoolId?: string
  @IsOptional() @IsString() @MaxLength(100) departmentId?: string
  @IsString() @MaxLength(100) major!: string
  @IsString() @MaxLength(40) grade!: string
  @IsOptional() @IsString() @MaxLength(100) studentNo?: string
  @IsOptional() @IsString() @MaxLength(100) teacherNo?: string
}
