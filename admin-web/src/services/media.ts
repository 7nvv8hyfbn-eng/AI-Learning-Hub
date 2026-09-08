import type { MediaAssetDto, MediaContentType } from '@ai-learning-hub/contracts'
import { catalogAssets, normalizeCategoryKey } from '../../../packages/catalog-assets/manifest'

export const mediaTypeLabels: Record<MediaContentType, string> = { theme: '通识基础', course: '课程', lab: '实训', resource: '资源', article: '文章', challenge: '挑战', page_hero: '页面头图', global: '平台通用' }
export const mediaKindLabels: Record<MediaAssetDto['kind'], string> = { cover: '内容封面', hero: '页面头图', illustration: '插画', icon_preview: '图标参考' }
export const mediaSourceLabels: Record<MediaAssetDto['source'], string> = { upload: '管理员上传', image2_seed: '内置生成素材', system: '系统素材' }
export const categoryKeyFor = normalizeCategoryKey
export const mediaCategories = (type: string) => [...new Set(catalogAssets.flatMap((asset) => asset.defaultFor?.filter((rule) => rule.contentType === type).map((rule) => rule.categoryKey) || []))]
