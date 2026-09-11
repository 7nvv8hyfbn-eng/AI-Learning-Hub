import { describe, expect, it } from 'vitest'
import { publicPageVisualKeys, type PublicPageVisualsDto, type ResolvedMedia } from '@ai-learning-hub/contracts'
import { demoCourses, demoLabs, demoResources, demoArticles, demoChallenges, demoThemes } from '@ai-learning-hub/demo-fixtures'
import { catalogAssets, getDefaultAssetKeys, normalizeCategoryKey } from '@ai-learning-hub/catalog-assets'
import { apiCatalogCover, coverFrames, focalPosition, localCatalogMedia, mockCatalogCover, mockFixtureCover, pageHeroCover, safeCoverUrl } from './catalog'
import { itemCover } from '../homepage/module-utils'
import { landingAssets } from '../assets/landing/manifest'
import { MockHomepageRepository } from '../homepage/repositories'

const fallback: ResolvedMedia = { id: 'fallback', url: '/api/media/fallback/file', alt: '服务端默认图', width: 1200, height: 675, focalPoint: { x: .7, y: .3 }, source: 'category_default' }

describe('目录媒体单源解析', () => {
  it('166张正式素材均可由唯一glob找到，81条独立内容遵循fixture的coverAssetKey', () => {
    expect(catalogAssets).toHaveLength(166)
    for (const asset of catalogAssets) expect(localCatalogMedia(asset.assetKey)?.url).toBeTruthy()
    const groups = { course: demoCourses, lab: demoLabs, resource: demoResources, article: demoArticles, challenge: demoChallenges } as const
    const urls: string[] = []
    for (const type of Object.keys(groups) as Array<keyof typeof groups>) {
      for (const fixture of groups[type]) {
        const media = mockFixtureCover(type, fixture)
        expect(media.cover).toBe(localCatalogMedia(fixture.coverAssetKey)?.url)
        expect(media.coverSource).toBe('explicit')
        expect(media.coverFallback?.url).toBeTruthy()
        urls.push(media.cover)
      }
    }
    expect(urls).toHaveLength(81)
    expect(new Set(urls).size).toBe(81)
    for (const fixture of demoThemes) expect(mockFixtureCover('theme', fixture).cover).toBe(localCatalogMedia(getDefaultAssetKeys('theme', fixture.slug)[0]!)?.url)
  })

  it('中文分类沿用manifest映射，未知分类保持有序默认链', () => {
    expect(normalizeCategoryKey('resource', '学习手册')).toBe('handbook')
    for (const course of demoCourses) {
      const category = normalizeCategoryKey('course', demoThemes.find((theme) => theme.slug === course.theme)!.title)
      expect(catalogAssets.some((asset) => asset.kind === 'illustration' && asset.contentSlug === course.slug && asset.categoryKey === category)).toBe(true)
    }
    expect(getDefaultAssetKeys('resource', '不存在的分类').at(-1)).toBe('default--global--generic')
    expect(new Set(getDefaultAssetKeys('course', 'generic')).size).toBe(getDefaultAssetKeys('course', 'generic').length)
    expect(mockCatalogCover('course', '未知分类').coverSource).toBe('type_default')
    expect(mockCatalogCover('未知类型', '未知分类').coverSource).toBe('global_default')
    expect(mockCatalogCover('theme', demoThemes[0]!.slug).coverSource).toBe('category_default')
    expect(mockCatalogCover('course', 'generic').coverFallback?.source).toBe('type_default')
  })

  it('API解析不查Mock；null绑定、空封面和显式服务端fallback被原样保留', () => {
    const data = { cover: '/api/media/user-selected/file', coverAssetId: null, coverAlt: '后台配置的封面', coverFocalPoint: { x: .2, y: .8 }, coverFallback: fallback }
    expect(apiCatalogCover(data)).toMatchObject(data)
    const frames = coverFrames(apiCatalogCover(data))
    expect(frames.map((frame) => frame.url)).toEqual([data.cover, fallback.url, localCatalogMedia('default--global--generic')!.url])
    expect(frames[0]?.focalPoint).toEqual(data.coverFocalPoint)
    expect(coverFrames(apiCatalogCover({ cover: '', coverAssetId: null, coverFallback: fallback }))[0]?.url).toBe(fallback.url)
    expect(apiCatalogCover({}).cover).toBeUndefined()
    expect(coverFrames({})[0]?.url).toBe(localCatalogMedia('default--global--generic')!.url)
  })

  it('同一已解析结果跨Mock/API适配保持图片、alt、焦点、回退一致', () => {
    const mock = mockFixtureCover('course', demoCourses[0]!)
    expect(coverFrames(apiCatalogCover(mock))).toEqual(coverFrames(mock))
    expect(coverFrames({ cover: fallback.url, coverFallback: fallback }).filter((frame) => frame.url === fallback.url)).toHaveLength(1)
  })

  it('不安全URL不加载，非法焦点保持中心并限制在图片边界', () => {
    for (const input of [undefined, null, '', '//example.test/a', 'javascript:alert(1)', 'data:image/png;base64,A', '/a\\b', 'https://x.test/a b', 'https://user:secret@cdn.test/a', '/a?token=old', '/a?X-Amz-Signature=old', '/a?expires=100', '/a?credential=old', '/a?sig=old', '/a?x-goog-date=old', '/a\u0000b']) expect(safeCoverUrl(input)).toBe('')
    expect(safeCoverUrl('/api/media/id/file')).toBe('/api/media/id/file')
    expect(safeCoverUrl('https://cdn.example.test/a.webp')).toBeTruthy()
    expect(focalPosition({ x: -1, y: 2 })).toBe('0% 100%')
    expect(focalPosition({ x: NaN, y: Infinity })).toBe('50% 50%')
  })

  it('六类hero优先公开配置，null或不可用配置退回各自manifest默认', () => {
    expect(publicPageVisualKeys).toHaveLength(6)
    for (const key of publicPageVisualKeys) {
      const defaults = pageHeroCover(key)
      expect(defaults.cover).toBe(localCatalogMedia(`hero--${key.replace(/HeroAssetId$/, '')}`)?.url)
      const visuals = { revision: 4, heroes: Object.fromEntries(publicPageVisualKeys.map((name) => [name, name === key ? fallback : null])) } as PublicPageVisualsDto
      expect(pageHeroCover(key, visuals)).toMatchObject({ cover: fallback.url, coverAlt: fallback.alt, coverFocalPoint: fallback.focalPoint, coverFallback: defaults.coverFallback })
      visuals.heroes[key] = null
      expect(pageHeroCover(key, visuals).cover).toBe(defaults.cover)
      visuals.heroes[key] = { ...fallback, url: 'javascript:bad' }
      expect(pageHeroCover(key, visuals).cover).toBe(defaults.cover)
    }
  })

  it('官网目录内容使用同源图片，显式旧首页封面白名单保持兼容', async () => {
    const homepage = await MockHomepageRepository.load()
    const lab = homepage.modules.flatMap((module) => module.items).find((item) => item.targetType === 'lab')!
    expect(itemCover(lab).cover).toBe(mockFixtureCover('lab', demoLabs.find((item) => item.slug === lab.slug)!).cover)
    expect(itemCover({ ...lab, data: { ...lab.data, cover: 'robotCar' } }).cover).toBe(landingAssets.robotCar)
    expect(itemCover({ ...lab, data: { cover: '', coverAssetId: null } }).cover).toBe('')
  })
})
