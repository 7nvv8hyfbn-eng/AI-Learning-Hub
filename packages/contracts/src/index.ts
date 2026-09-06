import type { CatalogCoverData } from './media'

export enum PublishStatus {
  DRAFT = 'draft',
  REVIEWING = 'reviewing',
  PUBLISHED = 'published',
  ARCHIVED = 'archived',
}

export enum UserStatus {
  ACTIVE = 'active',
  DISABLED = 'disabled',
  LOCKED = 'locked',
}

export enum LabType {
  AGENT = 'agent',
  DEPLOYMENT = 'deployment',
  COMMAND = 'command',
  HARDWARE = 'hardware',
  PROJECT = 'project',
}

export enum LabRunStatus {
  READY = 'ready',
  RUNNING = 'running',
  SUCCESS = 'success',
  FAILED = 'failed',
  STOPPED = 'stopped',
  SUBMITTED = 'submitted',
}

export enum FavoriteTargetType {
  COURSE = 'course',
  LAB = 'lab',
  RESOURCE = 'resource',
  ARTICLE = 'article',
}

export enum QuestionType {
  SINGLE = 'single',
  MULTIPLE = 'multiple',
  TRUE_FALSE = 'true_false',
  SHORT_ANSWER = 'short_answer',
  CODE = 'code',
}

export interface ApiEnvelope<T> {
  code: number
  message: string
  data: T
  requestId: string
}

export interface PageResult<T> {
  items: T[]
  page: number
  pageSize: number
  total: number
}

export interface CatalogBaseDto<TData extends object = Record<string, unknown>> {
  id: string
  slug: string
  title: string
  summary: string
  status: PublishStatus
  sortOrder: number
  publishedAt: string | null
  data: TData
  updatedAt: string
}

export interface AdminCatalogItemDto<TData extends object = Record<string, unknown>>
  extends CatalogBaseDto<TData> {
  databaseId: string
  dataOrigin?: 'demo_seed' | 'admin_created' | 'imported'
}

export interface ContentCreateBase {
  slug: string
  title: string
  summary: string
  sortOrder?: number
}

export interface ContentUpdateBase {
  title?: string
  summary?: string
  sortOrder?: number
}

export interface ThemeWriteFields {
  subtitle?: string
  introduction?: string
  coverAssetId?: string | null
  icon?: string
  accent?: string
  recommended?: boolean
  recommendedCourseIds?: string[]
  relatedLabIds?: string[]
  relatedResourceIds?: string[]
}

export interface ThemeData extends ThemeWriteFields, Partial<CatalogCoverData> {
  learners?: number
  completionRate?: number
  courseCount?: number
  hours?: number
  coverVariant?: string
}

export interface LearningPathStageDto {
  id: string
  stageKey: string
  name: string
  description: string
  stageType: string
  sortOrder: number
  unlockRule: Record<string, unknown>
  contents: Array<{ targetType: string; targetId: string; sortOrder: number }>
}

export type ThemeSummaryDto = CatalogBaseDto<ThemeData>
export interface ThemeDetailDto extends ThemeSummaryDto {
  paths: Array<{ id: string; name: string; description: string; stages: LearningPathStageDto[] }>
}
export type AdminThemeSummaryDto = AdminCatalogItemDto<ThemeData>
export interface AdminThemeDetailDto extends AdminThemeSummaryDto {
  paths: ThemeDetailDto['paths']
}
export interface CreateThemeInput extends ContentCreateBase, ThemeWriteFields {}
export type UpdateThemeInput = ContentUpdateBase & Partial<ThemeWriteFields>

export interface CourseData extends Partial<CatalogCoverData> {
  category?: string
  level?: string
  cover?: string
  coverVariant?: string
  icon?: string
  mode?: string
  hours?: number
  durationMinutes?: number
  instructor?: { name: string; title?: string }
  learners?: number
  rating?: number
  certificate?: string
  chapters?: number
  progress?: number
  recommended?: boolean
}
export type CourseSummaryDto = CatalogBaseDto<CourseData>
export interface CourseDetailDto extends CourseSummaryDto {
  chapters: Array<{
    id: string
    title: string
    description: string
    sortOrder: number
    lessons: Array<{
      id: string
      title: string
      summary: string
      lessonType: string
      durationMinutes: number
      sortOrder: number
      blocks: Array<{ id: string; blockType: string; sortOrder: number; content: Record<string, unknown> }>
    }>
  }>
  relatedResources: Array<{ id?: string; slug: string; title: string }>
  relatedLabs: Array<{ id?: string; slug: string; title: string }>
}
export type AdminCourseSummaryDto = AdminCatalogItemDto<CourseData>
export interface AdminCourseDetailDto extends AdminCourseSummaryDto, Omit<CourseDetailDto, keyof CourseSummaryDto> {
  themeId: string | null
  currentDraftVersionId: string | null
  publishedVersionId: string | null
}
export interface CreateCourseInput extends ContentCreateBase {
  themeId?: string
  category?: string
  level?: string
  coverAssetId?: string | null
  mode?: string
  hours?: number
  durationMinutes?: number
  instructorName?: string
  instructorTitle?: string
  certificate?: string
}
export type UpdateCourseInput = ContentUpdateBase & Omit<Partial<CreateCourseInput>, keyof ContentCreateBase>

export interface LabWriteFields {
  category?: string
  level?: string
  durationMinutes?: number
  coverAssetId?: string | null
  objective?: string
  task?: string
  hints?: string[]
  scoring?: Array<{ label: string; points: number }>
  resultSubmission?: string
  typeConfig?: Record<string, unknown>
}
export interface LabData extends LabWriteFields, Partial<CatalogCoverData> {
  icon?: string
  coverVariant?: string
  completionRate?: number
  participants?: number
  steps?: number
  result?: string
  skills?: string[]
}
export type LabSummaryDto = CatalogBaseDto<LabData> & { labType: LabType }
export interface LabDetailDto extends LabSummaryDto {
  steps: Array<{
    id: string
    stepKey: string
    title: string
    description: string
    sortOrder: number
    instruction: Record<string, unknown>
    validator: Record<string, unknown>
    score: number
  }>
  tools: Array<{ name: string; toolType: string; description: string }>
  resources: Array<{ slug: string; title: string }>
}
export type AdminLabSummaryDto = AdminCatalogItemDto<LabData> & { labType: LabType }
export interface AdminLabDetailDto extends AdminLabSummaryDto, Omit<LabDetailDto, keyof LabSummaryDto> {
  currentDraftVersionId: string | null
  publishedVersionId: string | null
}
export interface CreateLabInput extends ContentCreateBase, LabWriteFields {
  labType: LabType
}
export type UpdateLabInput = ContentUpdateBase & Partial<Omit<CreateLabInput, keyof ContentCreateBase>>

export interface ResourceWriteFields {
  coverAssetId?: string | null
  difficulty?: string
  tags?: string[]
  downloadPermission?: 'public' | 'authenticated' | 'restricted'
  themeId?: string
  courseId?: string
  labId?: string
}
export interface ResourceData extends ResourceWriteFields, Partial<CatalogCoverData> {
  coverVariant?: string
  icon?: string
  theme?: string
  featured?: boolean
  favorites?: number
}
export type ResourceSummaryDto = CatalogBaseDto<ResourceData> & {
  category: string
  format: string
  visibility: string
  downloads: number
  views: number
}
export interface ResourceDetailDto extends ResourceSummaryDto {
  file: null | { id: string; name: string; size: number; mimeType: string }
  uploadedBy: null | { id: string; displayName: string }
}
export type AdminResourceSummaryDto = AdminCatalogItemDto<ResourceData> & Omit<ResourceSummaryDto, keyof CatalogBaseDto<ResourceData>>
export interface ResourceVersionDto {
  id: string
  versionNo: number
  createdAt: string
  snapshot: { title: string; summary: string; data: ResourceData; fileId?: string | null }
}
export interface AdminResourceDetailDto extends AdminResourceSummaryDto, Omit<ResourceDetailDto, keyof ResourceSummaryDto> {
  versions: ResourceVersionDto[]
}
export interface CreateResourceInput extends ContentCreateBase, ResourceWriteFields {
  category: string
  format: string
  visibility: 'public' | 'authenticated' | 'private'
  fileId?: string
}
export type UpdateResourceInput = ContentUpdateBase & Partial<Omit<CreateResourceInput, keyof ContentCreateBase>>

export interface ArticleWriteFields {
  coverAssetId?: string | null
  author?: string
  readMinutes?: number
  blocks?: Array<Record<string, unknown>>
  tags?: string[]
}
export interface ArticleData extends ArticleWriteFields, Partial<CatalogCoverData> {
  content?: string[]
  coverVariant?: string
  icon?: string
  favorites?: number
}
export type ArticleSummaryDto = CatalogBaseDto<ArticleData> & {
  category: string
  views: number
  recommendations: Array<{ positionKey: string }>
}
export type ArticleDetailDto = ArticleSummaryDto
export type AdminArticleSummaryDto = AdminCatalogItemDto<ArticleData> & Omit<ArticleSummaryDto, keyof CatalogBaseDto<ArticleData>>
export interface AdminArticleDetailDto extends AdminArticleSummaryDto {
  scheduledAt: string | null
}
export interface CreateArticleInput extends ContentCreateBase, ArticleWriteFields {
  category: string
}
export type UpdateArticleInput = ContentUpdateBase & Partial<Omit<CreateArticleInput, keyof ContentCreateBase>>

export interface ChallengeWriteFields {
  coverAssetId?: string | null
  startAt?: string
  endAt?: string
  leaderboardEnabled?: boolean
  integration?: 'web-native' | 'quiz-box-miniapp' | 'quiz-box-webview' | 'external-url'
}
export interface ChallengeData extends ChallengeWriteFields, Partial<CatalogCoverData> {
  durationMinutes?: number
  questions?: number
  participants?: number
  difficulty?: string
}
export type ChallengeSummaryDto = CatalogBaseDto<ChallengeData> & {
  challengeType: string
  targetScore: number
  rewardPoints: number
}
export type ChallengeDetailDto = ChallengeSummaryDto
export type AdminChallengeSummaryDto = AdminCatalogItemDto<ChallengeData> & Omit<ChallengeSummaryDto, keyof CatalogBaseDto<ChallengeData>>
export interface AdminChallengeDetailDto extends AdminChallengeSummaryDto {
  questionBankId: string | null
  paperId: string | null
  rules: Array<{ id: string; ruleKey: string; config: unknown }>
}
export interface CreateChallengeInput extends ContentCreateBase, ChallengeWriteFields {
  challengeType: string
  targetScore: number
  rewardPoints: number
}
export type UpdateChallengeInput = ContentUpdateBase & Partial<Omit<CreateChallengeInput, keyof ContentCreateBase>>

export interface AdminDomainDtoMap {
  themes: AdminThemeSummaryDto
  courses: AdminCourseSummaryDto
  labs: AdminLabSummaryDto
  resources: AdminResourceSummaryDto
  articles: AdminArticleSummaryDto
  challenges: AdminChallengeSummaryDto
}

export interface AdminDomainCreateInputMap {
  themes: CreateThemeInput
  courses: CreateCourseInput
  labs: CreateLabInput
  resources: CreateResourceInput
  articles: CreateArticleInput
  challenges: CreateChallengeInput
}

export interface AdminDomainUpdateInputMap {
  themes: UpdateThemeInput
  courses: UpdateCourseInput
  labs: UpdateLabInput
  resources: UpdateResourceInput
  articles: UpdateArticleInput
  challenges: UpdateChallengeInput
}

export const HOMEPAGE_MODULE_REGISTRY = {
  hero_banner: { label: '首屏横幅', layout: 'hero' },
  ability_method: { label: '能力方法', layout: 'summary' },
  theme_direction: { label: '主题方向', layout: 'grid' },
  weekly_featured: { label: '本周精选', layout: 'grid' },
  featured_labs: { label: '精选实训', layout: 'grid' },
  maker_projects: { label: '创客项目', layout: 'grid' },
  frontier_news: { label: '前沿资讯', layout: 'grid' },
  resource_tools: { label: '资源工具', layout: 'grid' },
  weekly_challenge: { label: '每周挑战', layout: 'grid' },
  growth_summary: { label: '成长概览', layout: 'summary' },
  student_activity: { label: '学习动态', layout: 'grid' },
  bottom_action: { label: '底部行动', layout: 'action' },
} as const

export type HomepageModuleKey = keyof typeof HOMEPAGE_MODULE_REGISTRY | import('./landing').LandingModuleKey
export const HOMEPAGE_MODULE_KEYS = Object.keys(HOMEPAGE_MODULE_REGISTRY) as HomepageModuleKey[]

export interface HomepageResolvedItemDto {
  targetType: 'theme' | 'course' | 'lab' | 'resource' | 'article' | 'challenge' | 'community_post' | 'community_topic' | 'community_user'
  slug: string
  title: string
  summary: string
  data: Record<string, unknown>
  slot?: number
}

export interface PublicHomepageModuleDto {
  id: string
  moduleKey: HomepageModuleKey
  name: string
  sortOrder: number
  config: Record<string, unknown>
  items: HomepageResolvedItemDto[]
}

export interface PublicHomepageDto {
  pageMode?: 'community_landing_v1'
  community?: { members: number; creators: import('./landing').LandingPublicAuthor[] }
  version: number
  updatedAt: string
  modules: PublicHomepageModuleDto[]
}

export const HOMEPAGE_PREVIEW_MESSAGE = 'ai-learning-hub:homepage-preview'
export const HOMEPAGE_PREVIEW_READY_MESSAGE = 'ai-learning-hub:homepage-preview-ready'
export const HOMEPAGE_PREVIEW_SIZE_MESSAGE = 'ai-learning-hub:homepage-preview-size'
export interface HomepagePreviewMessage {
  type: typeof HOMEPAGE_PREVIEW_MESSAGE
  homepage: PublicHomepageDto
}
export interface HomepagePreviewReadyMessage {
  type: typeof HOMEPAGE_PREVIEW_READY_MESSAGE
}
export interface HomepagePreviewSizeMessage {
  type: typeof HOMEPAGE_PREVIEW_SIZE_MESSAGE
  width: number
  height: number
}

export interface DashboardMetricDto {
  current: number
  previous: number
  changeRate: number | null
  range: { start: string; end: string }
}

export interface DashboardTrendPoint {
  date: string
  activeUsers: number
  learningMinutes: number
}

export interface DashboardDto {
  community: { todayPosts: number; activeUsers: number; unanswered: number; pendingReports: number }
  learning: { publishedCourses: number; publishedLabs: number; publishedResources: number; activeChallenges: number }
  kpis: {
    users: DashboardMetricDto
    activeUsers: DashboardMetricDto
    publishedCourses: DashboardMetricDto
    labParticipants: DashboardMetricDto
  }
  trend: DashboardTrendPoint[]
  moduleCounts: Record<string, number>
  todos: Array<{ id: string; type: string; title: string; module: string; dueAt: string | null; route: string; priority: string }>
  operations: Array<{ id: string; actorId: string | null; method: string; path: string; result: string; createdAt: string }>
}

export interface GrowthSnapshotDto {
  points: number
  level: number | null
  courseProgress: unknown[]
  labRuns: unknown[]
  assessmentAttempts: unknown[]
  achievements: unknown[]
  certificates: unknown[]
}
export * from './community'
export * from './auth'
export * from './persistence'
export * from './landing'
export * from './media'
export * from './resource-hub'
