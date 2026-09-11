import { BadRequestException, Injectable } from '@nestjs/common'
import type { MediaAsset, FileRecord, Prisma } from '@prisma/client'
import type { CatalogContentType, CatalogCoverData, MediaContentType, ResolvedMedia } from '@ai-learning-hub/contracts'
import { normalizeCategoryKey } from '@ai-learning-hub/catalog-assets'
import { PrismaService } from '../../prisma/prisma.service'

export const mediaObject = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
export function safeLegacyCover(value: unknown) {
  if (typeof value !== 'string' || !value || value.includes('\\') || [...value].some((character) => character.charCodeAt(0) <= 32)) return null
  try {
    const relative = /^\/(?!\/)/.test(value)
    const url = new URL(value, relative ? 'https://legacy.invalid' : undefined)
    return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password && ![...url.searchParams.keys()].some((key) => /signature|token|credential|expires|x-amz|x-goog|^sig$/i.test(key)) ? value : null
  } catch { return null }
}
type MediaWithFile = MediaAsset & { file: FileRecord }
export interface MediaReadCache {
  assets: MediaWithFile[]
  rules: Array<{ contentType: string; categoryKey: string; asset: MediaWithFile }>
}
export function mediaCategory(type: CatalogContentType, item: Record<string, unknown>, data: Record<string, unknown>) {
  const snapshot = mediaObject(mediaObject(item.publishedVersion).snapshot)
  const category = type === 'theme' ? item.slug
    : type === 'lab' ? snapshot.labType || item.labType
    : type === 'challenge' ? snapshot.challengeType || item.challengeType
    : type === 'resource' || type === 'article' ? snapshot.category || item.category
    : data.theme || data.category || data.coverVariant
  return normalizeCategoryKey(type, String(category || 'generic'))
}

@Injectable()
export class MediaResolverService {
  constructor(private readonly prisma: PrismaService) {}

  present(asset: MediaAsset & { file: FileRecord }, source: ResolvedMedia['source']): ResolvedMedia {
    return { id: asset.id, url: `/api/v1/public/media/${encodeURIComponent(asset.id)}`, alt: asset.altText, width: asset.width, height: asset.height, focalPoint: { x: asset.focalX, y: asset.focalY }, source }
  }

  async prepare(items: Array<{ payload: unknown; coverAssetId?: string | null; publishedVersion?: { snapshot: unknown } | null }>, publicOnly: boolean): Promise<MediaReadCache> {
    const ids = [...new Set(items.flatMap((item) => {
      const snapshot = mediaObject(item.publishedVersion?.snapshot)
      const data = publicOnly ? mediaObject(snapshot.data || snapshot.payload) : mediaObject(item.payload)
      const id = Object.hasOwn(data, 'coverAssetId') ? data.coverAssetId : !publicOnly ? item.coverAssetId : undefined
      return typeof id === 'string' ? [id] : []
    }))]
    const active = { status: 'active' as const, deletedAt: null, file: { visibility: 'public' } }
    const [assets, rules] = await Promise.all([
      ids.length ? this.prisma.mediaAsset.findMany({ where: { id: { in: ids }, ...active }, include: { file: true } }) : [],
      this.prisma.mediaDefaultRule.findMany({ where: { active: true, asset: active }, include: { asset: { include: { file: true } } } }),
    ])
    return { assets, rules }
  }

  async resolve(input: { contentType: MediaContentType; categoryKey?: string; explicitAssetId?: string | null; legacyCover?: unknown; allowLegacy?: boolean }, tx: Prisma.TransactionClient = this.prisma, cache?: MediaReadCache): Promise<ResolvedMedia | null> {
    const active = { status: 'active' as const, deletedAt: null, file: { visibility: 'public' } }
    if (input.explicitAssetId) {
      const asset = cache ? cache.assets.find((asset) => asset.id === input.explicitAssetId) : await tx.mediaAsset.findFirst({ where: { id: input.explicitAssetId, ...active }, include: { file: true } })
      if (asset) return this.present(asset, 'explicit')
    } else if (input.allowLegacy) {
      const url = safeLegacyCover(input.legacyCover)
      if (url) return { id: null, url, alt: '', width: 1200, height: 675, focalPoint: { x: 0.5, y: 0.5 }, source: 'legacy' }
    }
    const categoryKey = normalizeCategoryKey(input.contentType, input.categoryKey || 'generic')
    const keys = [
      { contentType: input.contentType, categoryKey, source: 'category_default' as const },
      { contentType: input.contentType, categoryKey: 'generic', source: 'type_default' as const },
      { contentType: 'global', categoryKey: 'generic', source: 'global_default' as const },
    ]
    const rules = cache?.rules || await tx.mediaDefaultRule.findMany({ where: { active: true, OR: keys.map(({ contentType, categoryKey }) => ({ contentType, categoryKey })), asset: active }, include: { asset: { include: { file: true } } } })
    for (const key of keys) {
      const rule = rules.find((rule) => rule.contentType === key.contentType && rule.categoryKey === key.categoryKey)
      if (rule) return this.present(rule.asset, key.categoryKey === 'generic' && key.source === 'category_default' ? 'type_default' : key.source)
    }
    return null
  }

  async data(type: CatalogContentType, item: Record<string, unknown>, data: Record<string, unknown>, publicOnly: boolean, cache?: MediaReadCache): Promise<Record<string, unknown> & CatalogCoverData> {
    // 属性缺失才是旧快照；显式 null 是“移除”，不可让旧 cover 复活。
    const explicit = Object.hasOwn(data, 'coverAssetId') ? data.coverAssetId : !publicOnly && item.coverAssetId ? item.coverAssetId : undefined
    const categoryKey = mediaCategory(type, publicOnly ? item : { ...item, publishedVersion: undefined }, data)
    const input = { contentType: type, categoryKey, explicitAssetId: typeof explicit === 'string' ? explicit : null }
    const [explicitCover, fallback] = await Promise.all([
      this.resolve({ ...input, legacyCover: data.cover, allowLegacy: explicit === undefined }, this.prisma, cache),
      this.resolve({ contentType: type, categoryKey }, this.prisma, cache),
    ])
    let resolved = explicitCover
    const pinned = type === 'course' && publicOnly ? mediaObject(data.coverImage) : {}
    if (typeof pinned.assetId === 'string' && typeof pinned.fileId === 'string') {
      const focal = mediaObject(pinned.focalPoint)
      resolved = { id: pinned.assetId, url: `/api/v1/public/media/${encodeURIComponent(pinned.assetId)}/files/${encodeURIComponent(pinned.fileId)}`,
        alt: String(pinned.alt || ''), width: Number(pinned.width), height: Number(pinned.height),
        focalPoint: { x: Number(focal.x ?? .5), y: Number(focal.y ?? .5) }, source: 'explicit' }
    }
    return {
      ...data, cover: resolved?.url || '', coverAssetId: typeof explicit === 'string' ? explicit : null,
      coverAlt: resolved?.alt || String(item.title || ''), coverFocalPoint: resolved?.focalPoint || { x: 0.5, y: 0.5 },
      coverSource: resolved?.source || null, coverFallback: fallback,
      ...(!publicOnly ? { coverAsset: resolved, coverWarning: explicit && resolved?.source !== 'explicit' ? '当前显式封面已失效，前台正在使用默认封面' : '' } : {}),
    }
  }

  async assertBinding(tx: Prisma.TransactionClient, assetId: unknown, kind: 'cover' | 'hero' = 'cover') {
    if (assetId === undefined || assetId === null) return
    if (typeof assetId !== 'string' || !assetId || !await tx.mediaAsset.count({ where: { id: assetId, kind, status: 'active', deletedAt: null, file: { visibility: 'public' } } })) throw new BadRequestException('封面素材不存在、已归档或用途不匹配')
  }
}
