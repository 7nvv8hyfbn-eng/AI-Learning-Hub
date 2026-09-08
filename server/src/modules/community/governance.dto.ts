import { Transform, Type } from 'class-transformer'
import { ArrayMaxSize, ArrayUnique, IsArray, IsBoolean, IsDateString, IsIn, IsInt, IsOptional, IsString, IsUrl, Length, Matches, Max, MaxLength, Min } from 'class-validator'
import { communityOperations, reportCategories, sanctionLabels, type GovernanceDecisionInput, type GovernanceTarget } from '@ai-learning-hub/contracts'
import { ReportDto } from './community.dto'
import { queryBoolean } from '../users/users.dto'

export class GovernanceReportDto extends ReportDto {
  @IsIn(['post', 'comment', 'resource', 'collection', 'profile']) targetType!: GovernanceTarget
  @IsString() @Length(1, 100) targetId!: string
}
export class GovernanceDecisionDto implements GovernanceDecisionInput {
  @IsOptional() @IsInt() @Min(1) expectedContentRevision?: number
  @IsInt() @Min(1) expectedRevision!: number
  @IsIn([...Object.keys(sanctionLabels), 'reject']) action!: GovernanceDecisionInput['action']
  @IsString() @Length(4, 500) @Matches(/\S/) reason!: string
  @IsString() @Length(2, 100) @Matches(/\S/) ruleCode!: string
  @IsOptional() @IsIn(communityOperations.filter((x) => x !== 'read')) operation?: GovernanceDecisionInput['operation']
  @IsOptional() @IsDateString() expiresAt?: string
}
export class GovernanceRevisionDto { @IsInt() @Min(1) expectedRevision!: number }
export class GovernancePageDto { @IsOptional() @Type(() => Number) @IsInt() @Min(1) page = 1 }
export class GovernanceRevokeDto extends GovernanceRevisionDto { @IsString() @Length(4, 500) @Matches(/\S/) reason!: string }
export class GovernanceAppealDto {
  @IsOptional() @IsString() @Length(1, 100) actionId?: string
  @IsOptional() @IsString() @Length(1, 100) reviewId?: string
  @IsString() @Length(10, 1000) @Matches(/\S/) reason!: string
  @IsOptional() @IsArray() @ArrayMaxSize(3) @ArrayUnique() @IsString({ each: true }) @MaxLength(500, { each: true }) @IsUrl({ protocols: ['https'], require_protocol: true, disallow_auth: true }, { each: true }) evidence: string[] = []
}
export class GovernanceAppealDecisionDto extends GovernanceRevokeDto { @IsIn(['approve', 'reject']) action!: 'approve' | 'reject' }
export class GovernanceQueryDto {
  @IsOptional() @IsIn(['reports', 'appeals', 'reviews', 'processing']) kind: 'reports' | 'appeals' | 'reviews' | 'processing' = 'reports'
  @IsOptional() @IsIn(['pending', 'reviewing', 'resolved', 'rejected', 'all']) status = 'pending'
  @IsOptional() @IsIn(['mine', 'unassigned', 'all']) assigned = 'all'
  @IsOptional() @IsIn(Object.keys(reportCategories)) category?: string
  @IsOptional() @IsIn(['post', 'comment', 'resource', 'collection', 'profile']) targetType?: GovernanceTarget
  @IsOptional() @IsString() @MaxLength(120) keyword?: string
  @IsOptional() @Transform(queryBoolean) @IsBoolean() overdue = false
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page = 1
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(50) pageSize = 20
}
