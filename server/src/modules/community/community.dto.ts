import { Type } from 'class-transformer'
import { ArrayMaxSize, ArrayUnique, IsArray, IsBoolean, IsDateString, IsIn, IsInt, IsOptional, IsString, IsUrl, Length, Matches, Max, MaxLength, Min, ValidateIf, ValidateNested } from 'class-validator'
import { CommunityPostType as DatabasePostType } from '@prisma/client'
import type { CommunityPostInput, CommunityCommentInput, CommunityPostType, CommunityVisibility, CommunityContentBlock, CommunityBindingInput, LearningContentType, CommunityFeedMode, CommunitySignalInput } from '@ai-learning-hub/contracts'
import type { CommunityProfileInput, CommunityProfileTab, OnboardingInput, UsernameInput, CommunitySearchType } from '@ai-learning-hub/contracts'
const communityPostTypes = Object.values(DatabasePostType)

export class BlockDto {
  @IsIn(['paragraph', 'code', 'image', 'quote']) type!: CommunityContentBlock['type']
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
export class PostDto implements CommunityPostInput {
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
  @Matches(/^[a-z][a-z0-9_]{3,29}$/) username!: string
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
