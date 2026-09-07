import { Type } from 'class-transformer'
import { ArrayMaxSize, ArrayUnique, IsArray, IsBoolean, IsIn, IsInt, IsOptional, IsString, Length, Max, MaxLength, Min } from 'class-validator'
import type { LearningCollectionInput, WatchProgressInput } from '@ai-learning-hub/contracts'

export class ResourceHubQueryDto {
  @IsOptional() @IsString() @MaxLength(120) keyword = ''
  @IsOptional() @IsString() @MaxLength(80) category = ''
  @IsOptional() @IsIn(['all', 'video', 'article', 'document']) kind: 'all' | 'video' | 'article' | 'document' = 'all'
  @IsOptional() @IsString() @MaxLength(100) authorId = ''
  @IsOptional() @IsIn(['latest', 'popular', 'likes', 'bookmarks']) sort: 'latest' | 'popular' | 'likes' | 'bookmarks' = 'latest'
  @IsOptional() @IsString() @MaxLength(200) cursor = ''
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(48) limit = 18
}

export class CollectionInputDto implements LearningCollectionInput {
  @IsString() @Length(1, 80) name!: string
  @IsString() @MaxLength(500) description = ''
  @IsIn(['private', 'community']) visibility!: 'private' | 'community'
  @IsOptional() @IsString() @MaxLength(500) learningGoal = ''
  @IsOptional() @IsInt() @Min(1) expectedRevision?: number
}

export class CollectionItemDto {
  @IsString() @Length(1, 100) postId!: string
}

export class CollectionReorderDto {
  @IsInt() @Min(1) expectedRevision!: number
  @IsArray() @ArrayMaxSize(200) @ArrayUnique() @IsString({ each: true }) itemIds!: string[]
}

export class WatchProgressDto implements WatchProgressInput {
  @IsInt() @Min(0) @Max(86_400) positionSeconds!: number
  @IsInt() @Min(0) @Max(86_400) watchedSeconds!: number
  @IsBoolean() completed!: boolean
  @IsString() @Length(8, 128) eventKey!: string
}

export class ResourceHubConfigDto {
  @IsInt() @Min(0) revision!: number
  @IsArray() @ArrayMaxSize(5) @ArrayUnique() @IsString({ each: true }) bannerPostIds!: string[]
  @IsArray() @ArrayMaxSize(12) @ArrayUnique() @IsString({ each: true }) sectionCategoryCodes!: string[]
}

export class ResourceCategoryInputDto {
  @IsOptional() @IsString() @Length(2, 60) code?: string
  @IsString() @Length(2, 60) name!: string
  @IsString() @MaxLength(200) description = ''
  @IsString() @Length(1, 60) icon = 'resource'
  @IsInt() @Min(0) @Max(9999) sortOrder = 0
  @IsBoolean() active = true
}

export class CollectionCourseDto {
  @IsOptional() @IsString() @Length(1, 100) courseId?: string
  @IsOptional() @IsString() @Length(2, 120) slug?: string
  @IsOptional() @IsString() @Length(2, 160) title?: string
}

export class ContributionAdminDto {
  @IsOptional() @IsString() @Length(1, 100) categoryId?: string
  @IsBoolean() featured!: boolean
  @IsBoolean() liveReplay!: boolean
  @IsString() @Length(4, 500) reason!: string
}
