import { describe, expect, it, vi } from 'vitest'
import { createSSRApp, reactive } from 'vue'
import { renderToString } from 'vue/server-renderer'
import { demoAchievements } from '@ai-learning-hub/demo-fixtures'
import { iconRegistry } from '@ai-learning-hub/catalog-assets/icons/registry'
import CategoryCover from '../components/base/CategoryCover.vue'
import AppIcon from '../components/base/AppIcon.vue'
import { flushRender, setupComponent } from '../community/test-renderer'
import { localCatalogMedia, type CoverData, type CoverFrame } from './catalog'

interface CoverState { current: CoverFrame | undefined; onError: (event: Event) => void }
const failedImage = (src: string) => ({ target: { getAttribute: () => src } }) as unknown as Event

describe('真实封面与矢量组件', () => {
  it('图片失败按主图→服务端fallback→global→中性态前进，不循环也不误伤迟到事件', async () => {
    const media = reactive<CoverData>({ cover: '/broken.webp', coverFallback: { ...localCatalogMedia('default--course--generic')!, url: '/fallback.webp' } })
    const view = setupComponent<CoverState>(CategoryCover, { title: '测试课程', media })
    try {
      expect(view.state.current?.url).toBe('/broken.webp')
      view.state.onError(failedImage('/broken.webp')); await flushRender()
      expect(view.state.current?.url).toBe('/fallback.webp')
      view.state.onError(failedImage('/broken.webp')); await flushRender()
      expect(view.state.current?.url).toBe('/fallback.webp')
      view.state.onError(failedImage('/fallback.webp')); await flushRender()
      const global = localCatalogMedia('default--global--generic')!.url
      expect(view.state.current?.url).toBe(global)
      view.state.onError(failedImage(global)); await flushRender()
      expect(view.state.current).toBeUndefined()
      media.cover = '/new.webp'; await flushRender()
      expect(view.state.current?.url).toBe('/new.webp')
      view.state.onError(failedImage('/broken.webp')); await flushRender()
      expect(view.state.current?.url).toBe('/new.webp')
    } finally { view.unmount() }
  })

  it('普通封面输出真实img、lazy、语义alt与焦点，不在图内重复标题或中央图标', async () => {
    const html = await renderToString(createSSRApp(CategoryCover, { title: 'AI Agent Function Calling', media: { cover: '/api/media/asset/file', coverAlt: '工具调用节点', coverFocalPoint: { x: .25, y: .75 } } }))
    expect(html).toContain('loading="lazy"')
    expect(html).toContain('alt="工具调用节点"')
    expect(html).toContain('object-position:25% 75%')
    expect(html).toContain('width="1200"')
    expect(html).not.toContain('<svg')
    expect(html).not.toContain('AI Agent Function Calling')
    const hero = await renderToString(createSSRApp(CategoryCover, { title: '', decorative: true, eager: true, media: { cover: '/hero.webp' }, ratio: '2 / 1' }))
    expect(hero).toContain('loading="eager"')
    expect(hero).toContain('alt=""')
    expect(hero).toContain('aspect-ratio:2 / 1')
  })

  it('12成就code对应独立Symbol；未知与原型属性使用中性图标并开发告警', async () => {
    const symbols = []
    for (const achievement of demoAchievements) {
      expect(Object.hasOwn(iconRegistry, achievement.code)).toBe(true)
      symbols.push(iconRegistry[achievement.code])
      const html = await renderToString(createSSRApp(AppIcon, { name: achievement.code }))
      expect(html).toContain('<svg')
      expect(html).toContain(`<use href="#icon-${iconRegistry[achievement.code]}"`)
      expect(html).not.toContain('<image')
      expect(html).not.toContain('<path')
      expect(html).not.toContain(achievement.code)
    }
    expect(new Set(symbols).size).toBe(12)
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      for (const name of ['unknown-media-icon', 'toString', '__proto__', 'constructor']) {
        const view = setupComponent<{ href: string }>(AppIcon, { name })
        expect(view.state.href).toBe(`#icon-${iconRegistry.missing}`)
        expect(warn).toHaveBeenCalledWith(`[AppIcon] 未知图标：${name}`)
        view.unmount()
      }
    } finally { warn.mockRestore() }
  })
})
