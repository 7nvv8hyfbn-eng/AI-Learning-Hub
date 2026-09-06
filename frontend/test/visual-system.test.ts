import { readFileSync, existsSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { createSSRApp } from 'vue'
import { renderToString } from 'vue/server-renderer'
import { describe, expect, it } from 'vitest'
import { avatarCandidates, communityAvatarSource, communityAvatars, communityArt } from '../src/assets/community/manifest'
import CommunityAvatar from '../src/components/base/CommunityAvatar.vue'
import CommunityBindingCard from '../src/community/CommunityBindingCard.vue'
import FollowButton from '../src/components/base/FollowButton.vue'
import { setupComponent, flushRender } from '../src/community/test-renderer'

const source = (name: string) => readFileSync(new URL(`../src/${name}`, import.meta.url), 'utf8')

describe('学习社区视觉契约', () => {
  it('社区后台顶部多条件筛选按控件最小宽自然换行，不压缩日期或影响内部列表工具条', () => {
    const css = readFileSync(new URL('../../admin-web/src/community.css', import.meta.url), 'utf8')
    expect(css.match(/\.community-admin-filter\s*\{([^}]+)\}/)?.[1]).toContain('flex-wrap: wrap')
    const fields = css.match(/\.community-admin-page > \.community-admin-filter > :is\(input, select\)\s*\{([^}]+)\}/)?.[1]
    expect(fields).toContain('flex: 1 1 10rem')
    expect(fields).toContain('min-width: min(100%, 10rem)')
    expect(fields).toContain('max-width: 22.5rem')
  })
  it('真实头像优先，显式资源键优先于稳定用户名映射', () => {
    const real = '/uploads/student-avatar.webp'
    expect(avatarCandidates(real, 'learner', 'official-teacher')).toEqual([real, communityAvatars['official-teacher']])
    expect(communityAvatarSource('campus-guide-1')).toBe(communityAvatars['ai-learning-assistant'])
    expect(communityAvatarSource('campus-guide-2')).toBe(communityAvatars['official-teacher'])
    expect(communityAvatarSource()).toBeUndefined()
    expect(communityAvatarSource('', '__proto__')).toBeUndefined()
  })

  it('同一用户名跨列表顺序保持同一头像，缺失或不安全地址不作为真实图片', () => {
    const names = ['顾安', '林远', '云帆', 'student123', 'student456', 'student789']
    const before = Object.fromEntries(names.map((name) => [name, communityAvatarSource(name)]))
    const after = Object.fromEntries([...names].reverse().map((name) => [name, communityAvatarSource(name)]))
    expect(after).toEqual(before)
    expect(new Set(Object.values(before)).size).toBeGreaterThan(1)
    expect(communityAvatarSource(' Student123 ')).toBe(communityAvatarSource('student123'))
    for (const unsafe of ['javascript:alert(1)', 'data:image/png;base64,AAA', '//external.test/avatar', '']) expect(avatarCandidates(unsafe)).toEqual([])
    expect(avatarCandidates('https://cdn.example.test/user.webp')).toEqual(['https://cdn.example.test/user.webp'])
  })

  it('加载错误依次回退到生成头像与文字，头像占位宽高稳定', async () => {
    const mounted = setupComponent<{ source?: string; failed: number; initials: string; dimension: number }>(CommunityAvatar, { src: '/broken.webp', username: 'student123', name: '学生123', size: 'lg' })
    try {
      expect(mounted.state.source).toBe('/broken.webp')
      mounted.state.failed++
      await flushRender()
      expect(mounted.state.source).toBe(communityAvatarSource('student123'))
      mounted.state.failed++
      await flushRender()
      expect(mounted.state.source).toBeUndefined()
      expect(mounted.state.initials).toBe('学')
      expect(mounted.state.dimension).toBe(72)
    } finally { mounted.unmount() }
    const html = await renderToString(createSSRApp(CommunityAvatar, { name: '学生123', username: 'student123', size: 'sm' }))
    expect(html).toContain('width="36"')
    expect(html).toContain('height="36"')
    expect(html).toContain('loading="lazy"')
    expect(html).toContain('学生123的头像')
  })

  it('14张正式资源独立、透明、尺寸固定并通过集中manifest导出', () => {
    const manifest = source('assets/community/manifest.ts')
    const images = [...manifest.matchAll(/import \w+ from '(\.\/[^']+\.webp)'/g)].map((match) => match[1]!)
    expect(images).toHaveLength(14)
    expect(new Set(images).size).toBe(14)
    const artSizes = [[1200, 520], [480, 240], [560, 260], [480, 360], [360, 220], [480, 360]]
    const hashes = images.map((path, index) => {
      const image = readFileSync(new URL(`../src/assets/community/${path.slice(2)}`, import.meta.url))
      expect(image.subarray(0, 4).toString()).toBe('RIFF')
      expect(image.subarray(8, 16).toString()).toBe('WEBPVP8X')
      expect(image[20]! & 0x10).toBe(0x10)
      expect([image.readUIntLE(24, 3) + 1, image.readUIntLE(27, 3) + 1]).toEqual(index < 6 ? artSizes[index] : [256, 256])
      return createHash('sha256').update(image).digest('hex')
    })
    expect(new Set(hashes).size).toBe(14)
    expect(Object.values(communityArt).map(({ width, height }) => [width, height])).toEqual(artSizes)
    expect(Object.keys(communityAvatars)).toHaveLength(8)
  })

  it('关联卡复用原route，内容类别保留差异，关注按钮只承载显示与事件', async () => {
    for (const [type, category, icon] of [['course', 'course', 'book'], ['lesson', 'course', 'book'], ['lab_run', 'lab', 'terminal'], ['resource', 'resource', 'folder'], ['article', 'article', 'sparkles'], ['challenge', 'challenge', 'trophy'], ['theme', 'theme', 'network']]) {
      const mounted = setupComponent<{ category: string; icon: string }>(CommunityBindingCard, { binding: { type, title: '关联内容', route: '/original-route' } })
      try { expect([mounted.state.category, mounted.state.icon]).toEqual([category, icon]) } finally { mounted.unmount() }
    }
    const html = await renderToString(createSSRApp(FollowButton, { active: true, pending: true, label: '取消关注用户' }))
    expect(html).toContain('aria-pressed="true"')
    expect(html).toContain('disabled')
    expect(html).toContain('已关注')
    expect(source('community/CommunityBindingCard.vue')).toContain(':to="binding.route || undefined"')
    expect(source('components/base/FollowButton.vue')).not.toContain('useCommunityStore')
  })

  it('全部登录宽页使用wide，公开门户和深色实训布局不被覆盖', () => {
    const router = source('router.ts')
    const route = (path: string) => router.split('\n').find((line) => line.includes(`path: '${path}'`))
    for (const path of ['/topics', '/courses/:courseId', '/labs', '/resources', '/frontier', '/assessments', '/profile', '/bookmarks', '/notifications', '/community/search', '/community/drafts']) expect(route(path)).toContain("communityMode: 'wide'")
    expect(route('/welcome')).toContain("layout: 'landing'")
    expect(route('/terms')).toContain("layout: 'public'")
    expect(route('/labs/:labId')).toContain("layout: 'immersive'")
    expect(router).toContain('｜AI数智化学习平台')
  })

  it('学习主题页使用真实数据链路组成课程任务看板且不修改左侧导航', () => {
    const page = source('views/TopicsView.vue')
    const css = source('styles/pages/topics.css')
    const icons = readFileSync(new URL('../../packages/catalog-assets/icons/registry.ts', import.meta.url), 'utf8')
    expect(page).toContain('visual-key="topicsHeroAssetId"')
    expect(page).toContain('>继续学习 <AppIcon name="arrow-up-right"')
    expect(page).not.toContain('>立即学习 <AppIcon')
    expect(page.slice(page.indexOf('<PageHero'), page.indexOf('<nav class="topics-theme-nav"'))).not.toContain('继续学习')
    expect(page).not.toContain('共 {{ filtered.length }} 门课程')
    expect(page).toContain('class="button primary topics-course-action"')
    expect(page.indexOf('class="button primary topics-course-action"')).toBeGreaterThan(page.indexOf('<details class="topics-filter-popover">'))
    expect(page).not.toContain('topics-page-header')
    expect(page).not.toContain('topics-stage-board')
    expect(page).not.toContain('const stageItems')
    expect(page).not.toContain('loadThemeDetail')
    expect(page).toContain('class="topics-theme-nav"')
    expect(page).toContain('class="topics-course-search"')
    expect(page.indexOf('class="topics-course-search"')).toBeGreaterThan(page.indexOf('id="course-board"'))
    expect(page).toContain('`topics-${themes.find')
    expect(page).toContain('name="topics-progress"')
    expect(page).toContain('name="topics-hot"')
    for (const name of ['all', 'llm', 'agent', 'image', 'deployment', 'hardware', 'security', 'progress', 'hot']) {
      expect(icons).toContain(`'topics-${name}'`)
    }
    expect(page).toContain('<details class="topics-filter-popover">')
    expect(page).toContain('v-model="level"')
    expect(page).toContain('v-model="duration"')
    expect(page).toContain('v-model="mode"')
    expect(page).toContain('v-model="sort"')
    expect(page).toContain('class="card-grid topics-course-grid"')
    expect(page).toContain('courses.slice(4, 8)')
    expect(page).not.toContain('activity-heatmap')
    expect(css).toContain('.topics-course-grid { grid-template-columns: repeat(2')
    expect(css).toContain('.topics-course-search {')
    expect(css).toContain('.topics-course-action {')
    expect(css).not.toContain('.topics-hero-action')
    expect(css).not.toContain('.topics-stage-board')
    expect(css).toContain('.topics-recommendation-grid { grid-template-columns: repeat(4')
    expect(css).toContain('@media (min-width: 768px) and (max-width: 1279px)')
    expect(css).toContain('.topics-course-grid, .topics-recommendation-grid { grid-template-columns: minmax(0, 1fr)')
    expect(source('layouts/CommunityLayout.vue')).toContain('<AppIcon :name="item.icon" :size="21" />')
  })

  it('规则弹窗局部约束宽度并单独滚动长内容，关闭按钮不随内容挤出', () => {
    const page = source('views/AssessmentsView.vue'), css = source('styles/pages/assessments.css')
    expect(page).toContain('class="challenge-rules-dialog"')
    expect(page).toContain('{{ challengeRules }}')
    expect(page).not.toContain('JSON.stringify(challenge?.data')
    const card = css.match(/\.challenge-rules-dialog \.dialog-card\s*\{([^}]+)\}/)?.[1]
    expect(card).toContain('grid-template-columns: minmax(0, 1fr)')
    expect(card).toContain('grid-template-rows: auto minmax(0, 1fr)')
    expect(card).toContain('overflow: hidden')
    const pre = css.match(/\.challenge-rules-dialog pre\s*\{([^}]+)\}/)?.[1]
    for (const rule of ['min-width: 0', 'min-height: 0', 'white-space: pre-wrap', 'overflow-wrap: anywhere', 'overflow: auto']) expect(pre).toContain(rule)
    expect(css.match(/\.challenge-rules-dialog \.dialog-title \.icon-button\s*\{([^}]+)\}/)?.[1]).toContain('flex-shrink: 0')
  })

  it('样式入口只加载分层文件，基础重置、复选框和深色工作台迁移完整', () => {
    const imports = [...source('styles.css').matchAll(/@import "\.\/([^"]+)";/g)].map((match) => match[1]!)
    expect(new Set(imports).size).toBe(imports.length)
    for (const name of ['tokens', 'foundations', 'components', 'public', 'workspaces']) expect(imports).toContain(`styles/${name}.css`)
    for (const name of ['shell', 'navigation', 'feed', 'composer', 'post', 'rail', 'collection', 'responsive']) expect(imports).toContain(`styles/community/${name}.css`)
    expect(imports.at(-1)).toBe('styles/community/responsive.css')
    for (const old of ['styles/legacy.css', 'styles/community.css']) expect(existsSync(new URL(`../src/${old}`, import.meta.url))).toBe(false)
    expect(source('styles/foundations.css')).toContain('*, *::before, *::after { box-sizing: border-box; }')
    expect(source('styles/components.css')).toContain('.app-dialog .dialog-form label.community-checkbox')
    for (const selector of ['.immersive-nav {', '.immersive-nav a {', '.community-lab-share {', '.community-lab-share p {']) expect(source('styles/workspaces.css')).toContain(selector)
    expect(source('styles/responsive.css')).toContain('prefers-reduced-motion: reduce')
    expect(source('styles/tokens.css')).toContain('--muted: var(--amc-text-secondary)')
    for (const file of imports.filter((name) => name !== 'styles/workspaces.css')) expect(source(file)).not.toMatch(/font-size: (?:0?\.(?:[0-6][0-9]*|7[0-4]?)rem|1[01]px);/)
  })

  it('右栏内容按自然高度排列，不能裁切话题操作；发布插画完整显示', () => {
    const rail = source('styles/community/rail.css')
    const railLayout = rail.match(/\.community-right-rail\s*\{([^}]+)\}/)?.[1]
    expect(railLayout).toContain('grid-auto-rows: max-content')
    expect(railLayout).toContain('overflow-y: auto')
    expect(rail).not.toMatch(/\.rail-topics-card\s*\{[^}]*overflow:\s*(?:hidden|clip)/)
    const decoration = source('styles/community/composer.css').match(/\.composer-decoration\s*\{([^}]+)\}/)?.[1]
    expect(decoration).toContain('object-fit: contain')
    expect(decoration).toContain('max-width: 420px')
    expect(decoration).toContain('pointer-events: none')
    expect(decoration).not.toContain('mask-image')
  })

  it('引导页资料字段独立对齐，主题复选与移动单列不依赖弹层样式', () => {
    const style = source('community/CommunityOnboardingView.vue').match(/<style scoped>([\s\S]+)<\/style>/)?.[1]
    expect(style).toContain('.dialog-form { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr))')
    expect(style).toContain('.dialog-form > label { display: grid; gap: 8px; min-width: 0')
    expect(style).toContain('.dialog-form > label :is(input, select) { width: 100%; min-width: 0')
    expect(style).toContain('.dialog-form > :not(label) { grid-column: 1 / -1')
    expect(style).toContain('.onboarding-themes label { display: flex; align-items: center')
    expect(style).toContain('min-height: 16px')
    expect(style).toMatch(/@media \(max-width: 767px\)[\s\S]*\.dialog-form, \.onboarding-themes \{ grid-template-columns: minmax\(0, 1fr\)/)
    expect(style).toContain('border-radius: var(--amc-radius-large)')
    expect(style).not.toMatch(/background:\s*white|#[0-9a-f]{3,8}/i)
  })

  it('API实训动作表单限定深色工作台作用域，禁用参数仍清晰可读', () => {
    const style = source('styles/workspaces.css')
    const scope = '.lab-page .workspace-type > .dialog-form'
    expect(style).toContain(`${scope} { display: grid; grid-template-columns: minmax(0, 1fr)`)
    expect(style).toContain(`${scope} > label { display: grid`)
    const textarea = style.match(/\.lab-page \.workspace-type > \.dialog-form textarea \{([^}]+)\}/)?.[1]
    expect(textarea).toContain('width: 100%')
    expect(textarea).toContain('color: var(--lab-text)')
    expect(textarea).toContain('background: var(--lab-surface-raised)')
    const disabled = style.match(/\.lab-page \.workspace-type > \.dialog-form textarea:disabled \{([^}]+)\}/)?.[1]
    expect(disabled).toContain('color: var(--lab-muted)')
    expect(disabled).toContain('opacity: 1')
    expect(style).toContain(`${scope} > button:disabled`)
    expect(source('views/LabWorkspaceView.vue')).toContain(':disabled="state !== \'running\'"')
  })
})
