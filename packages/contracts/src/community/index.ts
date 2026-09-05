export const communityPostTypes = ['question', 'note', 'lab_result', 'project', 'frontier_discussion', 'achievement', 'general'] as const
export type CommunityPostType = typeof communityPostTypes[number]
export type CommunityPostStatus = 'draft' | 'published' | 'limited' | 'hidden' | 'removed'
export type CommunityVisibility = 'public' | 'school'
export type CommunityReactionType = 'like' | 'useful'
export type CommunityFeedMode = 'for_you' | 'following' | 'latest'
export type CommunityVerifiedType = 'none' | 'teacher' | 'official' | 'mentor'
export type LearningContentType = 'theme' | 'course' | 'lesson' | 'lab' | 'resource' | 'article' | 'challenge' | 'lab_run'
export type CommunityContentBlock =
  | { type: 'paragraph'; text: string }
  | { type: 'code'; language: string; code: string }
  | { type: 'image'; fileId: string; alt?: string }
  | { type: 'quote'; text: string }
export interface LearningContentReferenceDto {
  type: LearningContentType; id: string; slug?: string; title: string; summary?: string
  cover?: string; category?: string; route: string; status: string
}
export interface CommunityBindingInput { type: LearningContentType; id: string }
export type CommunityBindingDto = LearningContentReferenceDto
export interface CommunityBindingContextDto { binding: CommunityBindingDto; topicIds: string[] }
export interface CommunityAuthorDto {
  id: string; username: string; displayName: string; avatar: string | null
  school: string | null; major: string | null; verifiedType: CommunityVerifiedType
}
export interface CommunityProfileDto extends CommunityAuthorDto {
  revision: number; userRevision: number
  bio: string; headline: string; location: string | null; websiteUrl: string | null
  bannerUrl: string | null; joinedAt: string; expertiseTopics: string[]; allowAchievementDrafts?: boolean
  postCount: number; replyCount: number; likesReceived: number
  followerCount: number; followingCount: number; following: boolean; followedBy: boolean
  muted: boolean; blocked: boolean; isSelf: boolean
  pinnedPost: CommunityPostSummaryDto | null
  topics: CommunityTopicDto[]
}
export interface CommunityProfileInput {
  expectedUserRevision: number; expectedProfileRevision: number
  displayName: string; bio: string; headline: string; location: string; websiteUrl: string
  expertiseTopics: string[]; allowAchievementDrafts: boolean
}
export interface CommunityProfileUpdateDto { user: import('../auth').AuthUser; profile: CommunityProfileDto }
export type CommunityProfileTab = 'posts' | 'replies' | 'media' | 'liked'
export interface CommunityReplySummaryDto {
  id: string; postId: string; postTitle: string | null; bodyPreview: string
  likes: number; accepted: boolean; createdAt: string
}
export interface CommunityProfileTimelineDto {
  posts: CommunityPostSummaryDto[]; replies: CommunityReplySummaryDto[]; nextCursor: string | null
}
export interface CommunityProfileRelationDto extends CommunityAuthorDto { following: boolean }
export interface CommunityProfileRelationsDto { items: CommunityProfileRelationDto[]; nextCursor: string | null }
export interface CommunityTopicDto {
  id: string; slug: string; name: string; description: string; accent: string
  themeId: string | null; status: string; recommended: boolean; sortOrder: number
  postCount: number; followerCount: number; following: boolean
}
export interface CommunityViewerStateDto {
  liked: boolean; markedUseful: boolean; bookmarked: boolean; followingAuthor: boolean
}
export interface CommunityPostSummaryDto {
  revision?: number
  mediaCount?: number
  reportCount?: number
  id: string; type: CommunityPostType; status: CommunityPostStatus; visibility: CommunityVisibility
  title: string | null; bodyPreview: string; contentBlocks: CommunityContentBlock[]
  author: CommunityAuthorDto; bindings: CommunityBindingDto[]; topics: CommunityTopicDto[]
  stats: { likes: number; useful: number; comments: number; bookmarks: number }
  viewerState: CommunityViewerStateDto; recommendationReasons: string[]; labels: string[]
  question: { status: 'open' | 'solved' | 'closed'; acceptedCommentId: string | null; teacherAnswered: boolean } | null
  publishedAt: string; editedAt: string | null
}
export interface CommunityPostDetailDto extends CommunityPostSummaryDto { body: string }
export interface CommunityPostInput {
  expectedRevision?: number
  type: CommunityPostType; title?: string; contentBlocks: CommunityContentBlock[]
  bindings: CommunityBindingInput[]; topicIds: string[]; visibility: CommunityVisibility
  status: 'draft' | 'published'; sourceType?: 'note' | 'lab_run' | 'challenge' | 'article'; sourceId?: string
}
export interface CommunityCommentDto {
  revision?: number
  id: string; postId: string; author: CommunityAuthorDto; parentId: string | null; rootId: string | null
  body: string; contentBlocks: CommunityContentBlock[]; deleted: boolean; likes: number
  liked: boolean; accepted: boolean; createdAt: string
}
export interface CommunityCommentInput { contentBlocks: CommunityContentBlock[]; parentId?: string; expectedRevision?: number }
export interface CommunityLearningSummary { id: string; title: string; route: string; type?: LearningContentType; progress?: number; summary?: string }
export interface CommunityContextDto {
  todayPlan: CommunityLearningSummary | null; continueCourse: CommunityLearningSummary | null
  continueLab: CommunityLearningSummary | null; currentChallenge: CommunityLearningSummary | null
  trendingTopics: CommunityTopicDto[]; suggestedUsers: CommunityAuthorDto[]; needsInterests: boolean
  officialNotice?: CommunityLearningSummary | null
}
export type FeedUnitDto =
  | { type: 'post'; id: string; post: CommunityPostSummaryDto }
  | { type: 'continue_learning' | 'continue_lab' | 'challenge' | 'official_notice'; id: string; content: CommunityLearningSummary }
  | { type: 'topic_suggestion'; id: string; topics: CommunityTopicDto[] }
export interface CommunityFeedDto {
  requestId: string; policyVersion: string; items: FeedUnitDto[]; nextCursor: string | null; degraded: boolean
}
export interface CommunityNotificationDto {
  id: string; type: 'comment' | 'reply' | 'like' | 'useful' | 'answer_accepted' | 'follow' | 'mention' | 'official' | 'moderation'
  actor: CommunityAuthorDto | null; entityType: string; entityId: string; text: string
  count: number; readAt: string | null; createdAt: string; source: 'community' | 'platform'
}
export interface CommunitySignalInput {
  eventType: 'community_post_click' | 'community_post_expand' | 'community_binding_click' | 'community_profile_visit' | 'community_topic_visit' | 'community_to_course' | 'community_to_lab' | 'community_to_resource' | 'community_to_article' | 'community_to_challenge' | 'community_search_to_course' | 'community_search_to_lab' | 'community_search_to_resource' | 'community_search_to_article'
  targetId: string; targetType: 'post' | 'user' | 'topic' | 'course' | 'lab' | 'resource' | 'article'; binding?: CommunityBindingInput
  requestId?: string; sessionId?: string; position?: number
}
export interface CommunityFeedPolicyDto {
  revision?: number
  version: string; candidateLimits: Record<string, number>; weights: Record<string, number>; penalties: Record<string, number>
  diversity: { maxSameAuthorInWindow: number; authorWindowSize: number; maxSameTypeConsecutive: number; maxOfficialInWindow: number }
  insertions: { continueLearningRange: [number, number]; challengeRange: [number, number]; topicSuggestionRange: [number, number] }
}
export interface CommunityAdminReportDto {
  id: string; postId: string | null; commentId: string | null; reason: string; description: string
  status: string; createdAt: string
}
export interface CommunityAdminInspectionDto {
  post: CommunityPostDetailDto; comments: CommunityCommentDto[]; reports: CommunityAdminReportDto[]
  recommendation: { policyVersion: string; candidateSources: string[]; total: number; dimensions: Record<string, number>; filter: string; reasons: string[] } | null
  revisions?: import('../persistence').CommunityPostRevisionDto[]
  actions?: import('../persistence').UserActionEventDto[]
  moderation?: Array<{ id: string; action: string; reason: string; createdAt: string }>
  files?: Array<{ id: string; originalName: string; mimeType: string; size: number; exists: boolean }>
}
export interface CommunityAdminSummaryDto { todayPosts: number; unanswered: number; pendingReports: number; activeUsers: number }
export interface CommunityModerationInput {
  action: 'restore' | 'limit' | 'label' | 'hide' | 'remove' | 'reject' | 'disable_author'
  reason: string; label?: string
}
import type { ArticleSummaryDto, CourseSummaryDto, LabSummaryDto, ResourceSummaryDto } from '../index'
export type CommunitySearchType = 'all' | 'posts' | 'users' | 'topics' | 'courses' | 'labs' | 'resources' | 'articles'
export interface CommunitySearchResultDto {
  posts: CommunityPostSummaryDto[]; users: CommunityAuthorDto[]; topics: CommunityTopicDto[]
  courses: CourseSummaryDto[]; labs: LabSummaryDto[]; resources: ResourceSummaryDto[]; articles: ArticleSummaryDto[]
  nextCursor: string | null
}
export interface CommunityDraftDto { id: string; input: CommunityPostInput; updatedAt: string; revision?: number }
