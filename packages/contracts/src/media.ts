export type CatalogContentType = 'theme' | 'course' | 'lab' | 'resource' | 'article' | 'challenge'
export type MediaContentType = CatalogContentType | 'page_hero' | 'global'
export type MediaCoverSource = 'explicit' | 'category_default' | 'type_default' | 'global_default' | 'legacy'
export interface LessonImageContent extends Record<string, unknown> {
  assetId: string
  fileId: string
  alt: string
  caption: string
  aspectRatio: string
  width: number
  height: number
  url?: string
}
export interface ResolvedMedia {
  id: string | null
  url: string
  alt: string
  width: number
  height: number
  focalPoint: { x: number; y: number }
  source: MediaCoverSource
}
export interface CatalogCoverData {
  cover: string
  coverAssetId: string | null
  coverAlt: string
  coverFocalPoint: { x: number; y: number }
  coverSource: MediaCoverSource | null
  coverFallback: ResolvedMedia | null
  coverAsset?: ResolvedMedia | null
  coverWarning?: string
}
export const publicPageVisualKeys = ['topicsHeroAssetId', 'labsHeroAssetId', 'resourcesHeroAssetId', 'frontierHeroAssetId', 'assessmentsHeroAssetId', 'profileHeroAssetId'] as const
export type PublicPageVisualKey = typeof publicPageVisualKeys[number]
export type PublicPageVisualSetting = Record<PublicPageVisualKey, string | null>
export interface PublicPageVisualsDto {
  revision: number
  heroes: Record<PublicPageVisualKey, ResolvedMedia | null>
}
export interface AdminPageVisualsDto {
  revision: number
  value: PublicPageVisualSetting
}
export interface MediaAssetDto {
  id: string
  assetKey: string
  fileId: string
  name: string
  kind: 'cover' | 'hero' | 'illustration' | 'icon_preview'
  source: 'upload' | 'image2_seed' | 'system'
  contentType: MediaContentType
  categoryKey: string
  altText: string
  width: number
  height: number
  focalX: number
  focalY: number
  status: 'active' | 'archived'
  revision: number
  createdAt: string
  updatedAt: string
  deletedAt: string | null
  url: string
  publicUrl: string | null
  file: { id: string; mimeType: string; size: number; checksum: string }
}
export interface MediaUsageDto {
  type: string
  id: string
  title: string
  usage: 'draft' | 'published' | 'history' | 'default' | 'setting'
}
export interface MediaDefaultRuleDto {
  id: string
  contentType: MediaContentType
  categoryKey: string
  assetId: string
  active: boolean
  revision: number
  asset: { id: string; name: string; status: 'active' | 'archived' }
}
