import data from './manifest.json'

export type CatalogContentType = 'theme' | 'course' | 'lab' | 'resource' | 'article' | 'challenge' | 'page_hero' | 'global'
export type CatalogAssetKind = 'cover' | 'hero' | 'illustration' | 'icon_preview'
export interface CatalogDefaultRule {
  contentType: CatalogContentType
  categoryKey: string
}
export interface CatalogAsset {
  assetKey: string
  contentType: CatalogContentType
  contentSlug?: string
  categoryKey: string
  name: string
  kind: CatalogAssetKind
  file: string
  width: number
  height: number
  altText: string
  focalX: number
  focalY: number
  source: 'image2_seed'
  knowledgePoint?: string
  mascot?: boolean
  defaultFor?: CatalogDefaultRule[]
}
export interface CatalogManifest {
  schemaVersion: number
  assets: CatalogAsset[]
  categoryAliases: Partial<Record<CatalogContentType, Record<string, string>>>
}

export const catalogManifest = data as CatalogManifest
export const catalogAssets = catalogManifest.assets
export const categoryAliases = catalogManifest.categoryAliases

export function getCatalogAsset(assetKey: string | null | undefined): CatalogAsset | undefined {
  return catalogAssets.find((asset) => asset.assetKey === assetKey)
}

export function normalizeCategoryKey(contentType: string, categoryKey?: string | null): string {
  const key = categoryKey?.trim() || 'generic'
  return categoryAliases[contentType as CatalogContentType]?.[key] ?? key
}

/** 按唯一清单声明的分类、类型和平台默认规则返回候选键，不解析运行环境URL。 */
export function getDefaultAssetKeys(contentType: string, categoryKey?: string | null): string[] {
  const candidates = [
    { contentType, categoryKey: normalizeCategoryKey(contentType, categoryKey) },
    { contentType, categoryKey: 'generic' },
    { contentType: 'global', categoryKey: 'generic' },
  ]
  return [...new Set(candidates.flatMap((rule) => catalogAssets
    .filter((asset) => asset.defaultFor?.some((entry) => entry.contentType === rule.contentType && entry.categoryKey === rule.categoryKey))
    .map((asset) => asset.assetKey)))]
}
