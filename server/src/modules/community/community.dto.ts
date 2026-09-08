import { Type } from 'class-transformer'
import { ArrayMaxSize, ArrayMinSize, ArrayUnique, IsArray, IsBoolean, IsDateString, IsIn, IsInt, IsObject, IsOptional, IsString, IsUrl, Length, Matches, Max, MaxLength, Min, ValidateIf, ValidateNested } from 'class-validator'
import { CommunityPostType as DatabasePostType } from '@prisma/client'
import { communityOperations, type CommunityPostInput, type CommunityCommentInput, type CommunityPostType, type CommunityVisibility, type CommunityContentBlock, type CommunityBindingInput, type LearningContentType, type CommunityFeedMode, type CommunitySignalInput, type ResourceContributionInput, type CommunityOperation } from '@ai-learning-hub/contracts'
import type { CommunityProfileInput, CommunityProfileTab, OnboardingInput, UsernameInput, CommunitySearchType } from '@ai-learning-hub/contracts'
import type { ContentDetectionInput, ContentDetectionRule } from '@ai-learning-hub/contracts'
import { USERNAME_PATTERN } from '../auth/username'
const communityPostTypes = Object.values(DatabasePostType)

export class ContentPolicyDto {
  @IsInt() @Min(1) expectedVersion!: number
  @IsOptional() @IsArray() @ArrayMaxSize(100) rules?: ContentDetectionRule[]
  @IsOptional() @IsInt() @Min(1) rollbackVersion?: number
  @IsString() @Length(1, 500) reason!: string
}
export class ContentTrialDto {
  @IsObject() fields!: ContentDetectionInput
  @IsOptional() @IsArray() @ArrayMaxSize(100) rules?: ContentDetectionRule[]
}
export class ContentReviewDecisionDto {
  @IsInt() @Min(1) expectedRevision!: number
  @IsInt() @Min(1) ruleVersion!: number
  @IsIn(['approve', 'reject']) action!: 'approve' | 'reject'
  @IsString() @Length(1, 500) reason!: string
}

export class BlockDto {
  @IsIn(['paragraph', 'rich_text', 'heading', 'list', 'code', 'image', 'quote']) type!: CommunityContentBlock['type']
  @IsOptional() @IsInt() @Min(1) @Max(6) level?: number
  @IsOptional() @IsBoolean() ordered?: boolean
  @IsOptional() @IsArray() @ArrayMaxSize(100) @IsString({ each: true }) @MaxLength(1000, { each: true }) items?: string[]
  @IsOptional() @IsString() @MaxLength(10000) text?: string
  @IsOptional() @IsString() @MaxLength(12000) code?: string
  @IsOptional() @Matches(/^[a-z0-9+#.-]{0,30}$/i) language?: string
  @IsOptional() @IsString() @Length(1, 100) fileId?: string
  @IsOptional() @IsString() @MaxLength(200) alt?: string
}
export class BindingDto implements CommunityBindingInput {
  @IsIn(['theme', 'course', 'lesson', 'lab', 'resource', 'article', 'challenge', 'lab_run']) type!: LearningContentType
  @IsString() @Length(1, 100) id!: string
}
export class ContributionDto implements ResourceContributionInput {
  @IsIn(['video', 'article', 'document']) kind!: ResourceContributionInput['kind']
  @IsOptional() @IsString() @Length(1, 100) categoryId?: string
  @IsArray() @ArrayMaxSize(8) @ArrayUnique() @IsString({ each: true }) @MaxLength(30, { each: true }) tags!: string[]
  @IsBoolean() teachingReuseConsent!: boolean
  @IsOptional() @IsString() @MaxLength(120) sourceName?: string
  @ValidateIf((input: ContributionDto) => !!input.sourceUrl) @IsUrl({ protocols: ['http', 'https'], require_protocol: true }) @MaxLength(500) sourceUrl?: string
  @IsOptional() @IsString() @Length(1, 100) videoAssetId?: string
  @IsOptional() @IsString() @Length(1, 100) attachmentFileId?: string
  @IsOptional() @IsString() @Length(1, 100) coverFileId?: string
}
export class PostDto implements CommunityPostInput {
  @IsOptional() @IsString() @Length(1, 100) coverFileId?: string | null
  @IsOptional() @IsInt() @Min(1) expectedRevision?: number
  @IsIn(communityPostTypes) type!: CommunityPostType
  @IsOptional() @IsString() @MaxLength(160) title?: string
  @IsArray() @ArrayMaxSize(30) @ValidateNested({ each: true }) @Type(() => BlockDto) contentBlocks!: CommunityContentBlock[]
  @IsArray() @ArrayMaxSize(8) @ValidateNested({ each: true }) @Type(() => BindingDto) bindings!: BindingDto[]
  @IsArray() @ArrayMaxSize(5) @ArrayUnique() @IsString({ each: true }) topicIds!: string[]
  @IsIn(['public', 'school']) visibility!: CommunityVisibility
  @IsIn(['draft', 'published']) status!: 'draft' | 'published'
  @IsOptional() @IsIn(['note', 'lab_run', 'challenge', 'article']) sourceType?: CommunityPostInput['sourceType']
  @IsOptional() @IsString() @Length(1, 100) sourceId?: string
  @IsOptional() @ValidateNested() @Type(() => ContributionDto) contribution?: ContributionDto
}
export class CommentDto implements CommunityCommentInput {
  @IsOptional() @IsInt() @Min(1) expectedRevision?: number
  @IsArray() @ArrayMaxSize(10) @ValidateNested({ each: true }) @Type(() => BlockDto) contentBlocks!: CommunityContentBlock[]
  @IsOptional() @IsString() @MaxLength(100) parentId?: string
}
export class AdminPostDto extends PostDto {
  @IsString() @Length(4, 500) @Matches(/\S/) reason!: string
}
export class CommunityQueryDto {
  @IsOptional() @IsIn(['for_you', 'following', 'latest']) mode: CommunityFeedMode = 'for_you'
  @IsOptional() @IsIn(['all', ...communityPostTypes]) type: CommunityPostType | 'all' = 'all'
  @IsOptional() @IsString() @MaxLength(2000) cursor?: string
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(30) limit = 20
  @IsOptional() @IsString() @MaxLength(120) keyword?: string
  @IsOptional() @IsString() @MaxLength(100) bindingId?: string
}
export class ReportDto {
  @IsOptional() @IsIn(['harassment', 'privacy', 'spam', 'copyright', 'misinformation', 'safety', 'other']) category = 'other'
  @IsOptional() @IsArray() @ArrayMaxSize(3) @ArrayUnique() @IsString({ each: true }) @MaxLength(500, { each: true }) @IsUrl({ protocols: ['https'], require_protocol: true, disallow_auth: true }, { each: true }) evidence: string[] = []
  @IsString() @Length(2, 100) @Matches(/\S/) reason!: string
  @IsOptional() @IsString() @MaxLength(1000) description = ''
}
export class FeedUpdatesDto extends CommunityQueryDto {
  @IsDateString() since!: string
}
const safeProfileText = /^[^\p{Cc}<>]*$/u
export class ProfileDto implements CommunityProfileInput {
  @IsInt() @Min(1) expectedUserRevision!: number
  @IsInt() @Min(1) expectedProfileRevision!: number
  @IsString() @Length(1, 40) @Matches(safeProfileText) displayName!: string
  @IsString() @MaxLength(500) @Matches(safeProfileText) bio!: string
  @IsString() @MaxLength(120) @Matches(safeProfileText) headline!: string
  @IsString() @MaxLength(60) @Matches(safeProfileText) location!: string
  @ValidateIf((input: ProfileDto) => !!input.websiteUrl) @IsUrl({ protocols: ['http', 'https'], require_protocol: true }) @MaxLength(300) websiteUrl!: string
  @IsArray() @ArrayMaxSize(10) @IsString({ each: true }) @MaxLength(40, { each: true }) @Matches(safeProfileText, { each: true }) expertiseTopics!: string[]
  @IsBoolean() allowAchievementDrafts!: boolean
}
export class ProfileMediaDto {
  @Type(() => Number) @IsInt() @Min(1) expectedUserRevision!: number
  @Type(() => Number) @IsInt() @Min(1) expectedProfileRevision!: number
}
export class ProfilePinDto {
  @IsInt() @Min(1) expectedProfileRevision!: number
}
export class ProfileTimelineQueryDto {
  @IsIn(['posts', 'replies', 'media', 'liked']) tab: CommunityProfileTab = 'posts'
  @IsOptional() @IsString() @MaxLength(2000) cursor?: string
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(30) limit = 20
}
export class ProfileRelationQueryDto {
  @IsOptional() @IsString() @MaxLength(2000) cursor?: string
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(50) limit = 20
}
export class InterestsDto {
  @IsArray() @ArrayUnique() @ArrayMaxSize(3) @IsString({ each: true }) themeIds!: string[]
}
export class UsernameDto implements UsernameInput {
  @Matches(USERNAME_PATTERN) username!: string
}
export class OnboardingDto extends InterestsDto implements OnboardingInput {
  @IsInt() @Min(1) expectedRevision!: number
  @IsInt() @Min(1) expectedProfileRevision!: number
  @IsOptional() @IsString() @MaxLength(100) schoolId?: string
  @IsOptional() @IsString() @MaxLength(100) departmentId?: string
  @IsString() @MaxLength(100) major!: string
  @IsString() @MaxLength(40) grade!: string
  @IsString() @MaxLength(120) headline!: string
}
export class SearchDto {
  @IsString() @MaxLength(120) q = ''
  @IsIn(['all', 'posts', 'users', 'topics', 'courses', 'labs', 'resources', 'articles']) type: CommunitySearchType = 'all'
  @IsOptional() @IsString() @MaxLength(2000) cursor?: string
  @Type(() => Number) @IsInt() @Min(1) @Max(30) limit = 20
}
export class TopicDto {
  @Matches(/^[a-z0-9]+(?:-[a-z0-9]+)*$/) @MaxLength(80) slug!: string
  @IsString() @Length(1, 60) name!: string
  @IsString() @MaxLength(500) description!: string
  @IsIn(['purple', 'green', 'blue', 'yellow', 'teal', 'orange']) accent!: string
  @IsOptional() @IsString() @MaxLength(100) themeId?: string
  @IsIn(['active', 'closed']) status!: string
  @IsBoolean() recommended!: boolean
  @IsInt() @Min(0) @Max(9999) sortOrder!: number
  @IsString() @Length(4, 500) @Matches(/\S/) reason!: string
}
export class ModerationDto {
  @IsIn(['restore', 'limit', 'label', 'hide', 'remove', 'reject', 'disable_author']) action!: 'restore' | 'limit' | 'label' | 'hide' | 'remove' | 'reject' | 'disable_author'
  @IsString() @Length(4, 500) @Matches(/\S/) reason!: string
  @ValidateIf((input: ModerationDto) => input.action === 'label' || input.label !== undefined) @IsString() @Length(1, 60) @Matches(/\S/) label?: string
}
export class OfficialDto {
  @IsInt() @Min(1) expectedRevision!: number
  @IsIn(['none', 'teacher', 'official', 'mentor']) verifiedType!: string
  @IsArray() @ArrayMaxSize(10) @IsString({ each: true }) expertiseTopics!: string[]
  @IsString() @Length(4, 500) @Matches(/\S/) reason!: string
}
export class PolicyDto {
  @IsOptional() @IsInt() @Min(1) expectedRevision?: number
  @IsIn(['qualityWeight', 'learningWeight', 'explorationWeight', 'limitedPenalty']) parameter!: string
  @IsInt() @Min(0) @Max(40) value!: number
  @IsString() @Length(4, 500) @Matches(/\S/) reason!: string
}
const restrictableOperations = communityOperations.filter((operation): operation is Exclude<CommunityOperation, 'read'> => operation !== 'read')
export class RestrictionCreateDto {
  @IsString() @Length(2, 100) @Matches(/\S/) ruleCode!: string
  @IsString() @Length(1, 100) userId!: string
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(7) @ArrayUnique() @IsIn(restrictableOperations, { each: true }) operations!: Array<typeof restrictableOperations[number]>
  @IsOptional() @IsDateString() startsAt?: string
  @IsDateString() endsAt!: string
  @IsString() @Length(4, 500) @Matches(/\S/) reason!: string
}
export class RestrictionUpdateDto {
  @IsString() @Length(2, 100) @Matches(/\S/) ruleCode!: string
  @IsInt() @Min(1) expectedRevision!: number
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(7) @ArrayUnique() @IsIn(restrictableOperations, { each: true }) operations!: Array<typeof restrictableOperations[number]>
  @IsOptional() @IsDateString() startsAt?: string
  @IsDateString() endsAt!: string
  @IsString() @Length(4, 500) @Matches(/\S/) reason!: string
}
export class RestrictionRevokeDto {
  @IsInt() @Min(1) expectedRevision!: number
  @IsString() @Length(4, 500) @Matches(/\S/) reason!: string
}
export class EligibilityPolicyUpdateDto {
  @IsInt() @Min(1) expectedRevision!: number
  @IsIn(['post', 'comment', 'upload', 'interaction', 'report']) operation!: 'post' | 'comment' | 'upload' | 'interaction' | 'report'
  @IsInt() @Min(1) @Max(10000) limit!: number
  @IsInt() @Min(10) @Max(86400) windowSeconds!: number
  @IsString() @Length(4, 500) @Matches(/\S/) reason!: string
}
export class SignalDto implements CommunitySignalInput {
  @IsIn(['community_post_click', 'community_post_expand', 'community_binding_click', 'community_profile_visit', 'community_topic_visit', 'community_to_course', 'community_to_lab', 'community_to_resource', 'community_to_article', 'community_to_challenge', 'community_search_to_course', 'community_search_to_lab', 'community_search_to_resource', 'community_search_to_article']) eventType!: CommunitySignalInput['eventType']
  @IsString() @Length(1, 100) targetId!: string
  @IsIn(['post', 'user', 'topic', 'course', 'lab', 'resource', 'article']) targetType!: CommunitySignalInput['targetType']
  @IsOptional() @ValidateNested() @Type(() => BindingDto) binding?: BindingDto
  @IsOptional() @IsString() @MaxLength(100) requestId?: string
  @IsOptional() @IsString() @MaxLength(100) sessionId?: string
  @IsOptional() @IsInt() @Min(0) @Max(300) position?: number
}
export class ImpressionDto {
  @IsString() @Length(1, 100) requestId!: string
  @IsString() @Length(1, 100) postId!: string
  @IsOptional() @IsInt() @Min(0) @Max(120000) dwellMs?: number
}
export class ImpressionsDto {
  @IsArray() @ArrayMaxSize(30) @ValidateNested({ each: true }) @Type(() => ImpressionDto) items!: ImpressionDto[]
}
export class FeedbackDto {
  @IsString() @Length(1, 100) postId!: string
  @IsIn(['hide', 'not_interested']) type!: 'hide' | 'not_interested'
}
