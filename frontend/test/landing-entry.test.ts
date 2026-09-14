import { readFileSync, readdirSync } from 'node:fs'
import { createSSRApp, h } from 'vue'
import { renderToString } from 'vue/server-renderer'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { LANDING_DEFAULT_CONFIG, LANDING_MODULE_KEYS, landingConfigIssues, isLandingImage, type HomepageResolvedItemDto } from '@ai-learning-hub/contracts'
import LandingRenderer from '../src/landing/LandingRenderer.vue'
import { landingAssets, landingAsset } from '../src/assets/landing/manifest'
import { MockHomepageRepository } from '../src/homepage/repositories'
import { setupComponent, flushRender } from '../src/community/test-renderer'
import { communityNavigation } from '../src/community/labels'
import { visibleAdminNavigation } from '../../admin-web/src/navigation'

const state = vi.hoisted(() => ({
  auth: { user: null as { id: string } | null },
  push: vi.fn(), open: vi.fn(), following: vi.fn(), follow: vi.fn(),
  store: { authorFollowing: {} as Record<string, boolean>, operations: {} as Record<string, boolean> },
}))
vi.mock('../src/stores/auth', () => ({ useAuthStore: () => state.auth }))
vi.mock('../src/stores/authUi', () => ({ useAuthUiStore: () => ({ open: state.open }) }))
vi.mock('../src/stores/community', () => ({ useCommunityStore: () => ({ ...state.store, follow: state.follow }) }))
vi.mock('../src/services/api/community', () => ({ communityApi: { following: state.following } }))
vi.mock('vue-router', () => ({ useRouter: () => ({ push: state.push }) }))
const source = (path: string) => readFileSync(new URL(`../src/${path}`, import.meta.url), 'utf8')
beforeEach(() => { vi.clearAllMocks(); state.auth.user = null; state.store.authorFollowing = {}; state.following.mockResolvedValue([]) })

describe('社区化入口', () => {
  it('固定五区配置拒绝能力越界、原型字段与不可用图片引用', () => {
    for (const key of LANDING_MODULE_KEYS) expect(landingConfigIssues(key, LANDING_DEFAULT_CONFIG[key])).toEqual([])
    expect(landingConfigIssues('landing_capabilities', { ...LANDING_DEFAULT_CONFIG.landing_capabilities, items: [] })).toContain('社区能力固定六项')
    expect(landingConfigIssues('landing_hero', { ...LANDING_DEFAULT_CONFIG.landing_hero, constructor: 'unsafe' })).toContain('包含未支持字段')
    for (const key of ['https://example.com/a.webp', '/api/v1/storage/missing', 'data:image/png;base64,AA', '__proto__']) {
      expect(isLandingImage(key)).toBe(false); expect(landingAsset(key, 'heroArms')).toBe(landingAssets.heroArms)
    }
  })

  it('5张WebP与6个96x96可编辑SVG仅由manifest引用', () => {
    expect(Object.keys(landingAssets)).toHaveLength(11)
    const icons = readdirSync(new URL('../src/assets/landing/icons/', import.meta.url))
    expect(icons).toHaveLength(6)
    for (const file of icons) {
      const svg = source(`assets/landing/icons/${file}`)
      expect(svg).toContain('viewBox="0 0 96 96"')
      expect(svg).toMatch(/<path /)
      expect(svg).toMatch(/<linearGradient /)
      expect(svg).not.toMatch(/<image|href=|base64|<script|onload=/i)
    }
    const manifest = source('assets/landing/manifest.ts')
    expect([...manifest.matchAll(/import .*\.webp'/g)]).toHaveLength(5)
    expect(source('landing/LandingRenderer.vue')).not.toMatch(/https:\/\/|base64|2222229b585f/)
  })

  it('三入口使用LandingLayout，教程列表允许访客，学习内容与创作入口要求登录', () => {
    const router = source('router.ts')
    const route = (path: string) => router.split('\n').find((line) => line.includes(`path: '${path}'`))
    for (const path of ['/', '/welcome', '/__homepage-preview']) expect(route(path)).toContain("layout: 'landing'")
    for (const path of ['/terms', '/privacy', '/reset-password', '/verify-email']) {
      expect(route(path)).toContain("layout: 'public'"); expect(route(path)).toContain('requiresAuth: false')
    }
    expect(route('/resources')).toContain('requiresAuth: false')
    for (const path of ['/topics', '/courses/:courseId', '/labs', '/labs/:labId', '/resources/watch/:postId', '/resources/read/:postId', '/resources/studio', '/frontier', '/assessments', '/profile', '/bookmarks', '/notifications']) expect(route(path)).toContain('requiresAuth: true')
    expect(communityNavigation.every((item) => item.requiresAuth)).toBe(true)
    expect(router).toContain('redirect: to.fullPath')
    expect(source('layouts/LandingLayout.vue')).not.toContain('AppHeader')
    expect(source('layouts/PublicLayout.vue')).toContain('AppHeader')
  })

  it('首屏、底部和内容登录复用AuthUi并准确保存目标，预览不触发认证', async () => {
    const homepage = await MockHomepageRepository.load()
    const view = setupComponent<{ navigate: (path?: string) => void }>(LandingRenderer, { homepage })
    view.state.navigate(); expect(state.open).toHaveBeenLastCalledWith({ redirect: '/community', action: undefined })
    view.state.navigate('/courses/llm-zero?lesson=first'); expect(state.open).toHaveBeenLastCalledWith({ redirect: '/courses/llm-zero?lesson=first', action: undefined })
    view.unmount()
    const preview = setupComponent<{ navigate: () => void }>(LandingRenderer, { homepage, preview: true })
    state.open.mockClear(); preview.state.navigate(); expect(state.open).not.toHaveBeenCalled(); preview.unmount()
  })

  it('话题和创作者查看更多沿用搜索页type契约，登录前后均保留筛选目标', async () => {
    const targets = [...source('landing/LandingRenderer.vue').matchAll(/navigate\('(\/community\/search\?[^']+)'\)/g)].map((match) => match[1])
    expect(targets).toEqual(['/community/search?type=topics', '/community/search?type=users'])
    expect(source('community/CommunitySearchView.vue')).toContain('route.query.type')
    const view = setupComponent<{ navigate: (path: string) => void }>(LandingRenderer, { homepage: await MockHomepageRepository.load() })
    for (const target of targets) {
      state.auth.user = null
      view.state.navigate(target)
      expect(state.open).toHaveBeenLastCalledWith({ redirect: target, action: undefined })
      state.auth.user = { id: 'viewer' }
      view.state.navigate(target)
      expect(state.push).toHaveBeenLastCalledWith(target)
    }
    view.unmount()
  })

  it('已登录硬刷品牌页同步配置创作者关注状态，不依赖建议用户列表', async () => {
    const homepage = await MockHomepageRepository.load(), id = homepage.community!.creators[0].id
    state.auth.user = { id: 'viewer' }; state.following.mockResolvedValue([{ id }])
    const view = setupComponent<{ follow: (item: HomepageResolvedItemDto) => void; followingLoading: boolean }>(LandingRenderer, { homepage })
    expect(view.state.followingLoading).toBe(true)
    await flushRender()
    expect(state.following).toHaveBeenCalledWith('viewer')
    expect(state.store.authorFollowing[id]).toBe(true)
    expect(state.store.authorFollowing[homepage.community!.creators[1].id]).toBe(false)
    expect(view.state.followingLoading).toBe(false)
    const creator = homepage.modules.flatMap((module) => module.items).find((item) => item.targetType === 'community_user' && item.data.id === id)!
    view.state.follow(creator)
    expect(state.follow).toHaveBeenCalledWith(id, false, false)
    expect(state.push).not.toHaveBeenCalled()
    view.unmount()
  })

  it('真实HTML落地页有五区、六能力与三精选，无导航或假播放按钮', async () => {
    const homepage = await MockHomepageRepository.load()
    const app = createSSRApp(LandingRenderer, { homepage, preview: true })
    app.component('RouterLink', { props: ['to'], setup: (props, { slots }) => () => h('a', { href: props.to }, slots.default?.()) })
    const html = await renderToString(app)
    expect(html).toContain('<h1 id="landing-title" aria-label="破盒启智、交互赋能 数训筑基、共创未来">破盒启智、交互赋能<span>数训筑基、共创未来</span>')
    expect(html).toContain('<strong>DAILY-AI HUB</strong>')
    expect(html).toContain('class="brand-mark">D</span>')
    expect(html).toContain('<small>破盒启智、交互赋能 数训筑基、共创未来</small>')
    expect(html.match(/class="landing-capability"/g)).toHaveLength(6)
    expect(html.match(/landing-card-featured/g)).toHaveLength(3)
    expect(html.match(/登录 \/ 注册/g)).toHaveLength(2)
    expect(html).not.toMatch(/<nav|播放视频|10832|10,832/)
    expect(html).toContain('width="1200" height="600" loading="lazy"')
  })

  it('首屏五张卡片固定，同类、混合及倒序推荐均不改变内容', async () => {
    const homepage = await MockHomepageRepository.load()
    const hero = homepage.modules[0]!
    for (const types of [
      ['community_post', 'community_post', 'community_post', 'community_post', 'community_post'],
      ['resource', 'course', 'community_post', 'lab', 'article'],
    ] as const) {
      hero.items = types.map((targetType, index) => ({ targetType, slug: `hero-${index}`, title: `首屏关联${index + 1}`, summary: '当前已发布内容', data: {} }))
      for (const items of [[...hero.items], [...hero.items].reverse()]) {
        hero.items = items
        const app = createSSRApp(LandingRenderer, { homepage, preview: true })
        app.component('RouterLink', { setup: (_, { slots }) => () => h('a', {}, slots.default?.()) })
        const html = await renderToString(app)
        expect([...html.matchAll(/<h3>([^<]+)<\/h3>/g)].slice(0, 5).map((match) => match[1])).toEqual(['今天学到的 AI，动手试一试', '部署你的第一个 AI 模型', 'AI Agent 智能助手开发实训', '大模型入门学习手册', '把想法带进社区，一起做出来'])
      }
    }
    expect(source('styles/pages/landing.css')).toContain('.landing-hero-arms, .landing-mosaic-code, .landing-mosaic-resource, .landing-mosaic-topic { display: none; }')
  })

  it('空推荐仍展示五张静态卡片，不带入测试作者、私有帖子或互动数', async () => {
    const homepage = await MockHomepageRepository.load()
    const hero = homepage.modules[0]!
    const render = async () => {
      const app = createSSRApp(LandingRenderer, { homepage, preview: true })
      app.component('RouterLink', { setup: (_, { slots }) => () => h('a', {}, slots.default?.()) })
      const html = await renderToString(app)
      return html.slice(html.indexOf('<div class="landing-hero-mosaic"'), html.indexOf('</section>'))
    }
    hero.items = []
    const empty = await render()
    hero.items = [{ slot: 0, targetType: 'community_post', slug: 'private-post', title: '私有测试内容', summary: '测试摘要', data: { author: { username: 'test-account', displayName: '测试作者' }, likeCount: 9999 } }]
    expect(await render()).toBe(empty)
    expect((empty.match(/class="landing-content-card /g) || [])).toHaveLength(5)
    expect(empty).toContain('landing-feature-robot-vision.webp')
    expect(empty).toContain('landing-feature-ai-workspace.webp')
    expect(empty).not.toMatch(/private-post|test-account|测试作者|9999/)
  })

  it('后台轻量分组按权限过滤，社区先于学习且保留五组全部路由', () => {
    expect(visibleAdminNavigation(['homepage.read'])).toEqual([{ label: '门户与系统', items: [['homepage', '门户落地页', '/homepage', 'homepage.read']] }])
    expect(visibleAdminNavigation([])).toEqual([])
    const groups = visibleAdminNavigation(['dashboard.read', 'community.read', 'course.read', 'growth.read', 'homepage.read'])
    expect(groups.map((group) => group.label)).toEqual(['工作台', '社区运营', '学习内容', '用户运营', '门户与系统'])
  })
})
