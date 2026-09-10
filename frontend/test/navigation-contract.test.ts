import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { communityNavigation, communityNavActive } from '../src/community/labels'
import { iconRegistry } from '../../packages/catalog-assets/icons/registry'
const source = (name: string) => readFileSync(new URL(`../src/${name}`, import.meta.url), 'utf8')
describe('声明式导航契约', () => {
  it('手机第二项是教程中心，所有教程子页面高亮，通识仍保留在更多功能', () => {
    expect(communityNavigation.filter((item) => item.mobile).sort((a, b) => a.mobileOrder - b.mobileOrder).map((item) => item.path)).toEqual(['/community', '/resources', '/notifications', '/profile'])
    expect(communityNavigation.find((item) => item.path === '/topics')).toMatchObject({ desktop: true, mobile: false })
    for (const path of ['/resources', '/resources/studio', '/resources/video/one', '/resources/article/two', '/resources/collections/three']) expect(communityNavActive(path, '/resources')).toBe(true)
    expect(iconRegistry['tutorial-center']).toBe('c5045-2325926'); expect(iconRegistry['feed-refresh']).toBe('c5045-2325927')
    expect(iconRegistry.folder).toBe('kabao'); expect(iconRegistry['feed-search']).toBe('c53651-search'); expect(iconRegistry['post-views']).toBe('post-views')
    const sprite = readFileSync(new URL('../../packages/catalog-assets/icons/iconfont.js', import.meta.url), 'utf8')
    for (const id of ['2325926', '2325927']) expect(sprite).toContain(`<symbol id="icon-c5045-${id}" viewBox="0 0 1024 1024">`)
  })
  it('本人动态、话题和关注入口使用公开username路由，不把内部用户id作为用户名', () => {
    const profile = source('views/ProfileView.vue')
    const links = [...profile.matchAll(/:to="`(\/community\/user\/[^`]+)`"/g)].map((match) => match[1])
    expect(links).toEqual(['/community/user/${auth.user?.username}', '/community/user/${auth.user?.username}?tab=topics', '/community/user/${auth.user?.username}?tab=following'])
    expect(source('router.ts')).toContain("path: '/community/user/:username'")
    expect(source('layouts/CommunityLayout.vue')).toContain('`/community/user/${auth.user?.username}`')
  })
  it('社区桌面与移动Logo回社区，品牌门户保留独立入口', () => {
    const layout = source('layouts/CommunityLayout.vue')
    const logos = [...layout.matchAll(/<RouterLink class="brand[^"]*" to="([^"]+)"/g)]
    expect(logos).toHaveLength(2); expect(logos.map((match) => match[1])).toEqual(['/community', '/community'])
    expect(layout).toContain('to="/welcome">查看品牌门户')
    expect(communityNavigation.find((item) => item.label === '社区首页')?.path).toBe('/community')
  })
  it('只读提示直接使用顶层 computed，避免嵌套 ref 被当作真值', () => {
    const layout = source('layouts/CommunityLayout.vue')
    expect(layout).toContain('const { canPost, decision, message, nextAction } = useCommunityAccess()')
    expect(layout).toContain('v-if="!canPost && route.path !== \'/community/verification\'"')
    expect(layout).not.toContain('access.canWrite')
  })
  it('受限的发布器和上传入口保留草稿并展示解除时间与解决入口', () => {
    for (const name of ['community/CommunityQuickComposer.vue', 'community/CommunityAdvancedComposer.vue']) {
      const composer = source(name)
      expect(composer).toContain('availability()')
      expect(composer).toContain('nextAction.route')
      expect(composer).toMatch(/草稿仍(?:会自动|可)保存/)
    }
    for (const name of ['community/CommunityComposerTools.vue', 'community/ResourceContributionFields.vue']) {
      const upload = source(name)
      expect(upload).toContain("availability('upload')")
      expect(upload).toContain('uploadDecision.nextAction.route')
      expect(upload).toContain('!uploadDecision.allowed')
    }
    const admin = readFileSync(new URL('../../admin-web/src/views/CommunityView.vue', import.meta.url), 'utf8')
    expect(admin).toContain('开始时间<input v-model="restrictionForm.startsAt"')
  })
  it('每条路由声明Meta，守卫不写Meta，移动导航不用数组下标', () => {
    const router = source('router.ts')
    for (const line of router.split('\n').filter((value) => value.trim().startsWith('{ path:'))) expect(line).toMatch(/meta: \{.*title:.*layout:.*requiresAuth:|meta: \{.*title:.*requiresAuth:.*layout:/)
    expect(router).not.toMatch(/to\.meta\.\w+\s*=(?!=)/)
    expect(source('layouts/CommunityLayout.vue')).not.toMatch(/communityNavigation\[/)
    expect(communityNavigation.filter((item) => item.mobile).map((item) => item.mobileOrder).sort()).toEqual([1, 2, 4, 5])
  })
  it('学习页面采用adaptive wide，实训仍沉浸，分组激活涵盖子页面', () => {
    const router = source('router.ts')
    for (const path of ['/topics', '/courses/:courseId', '/labs', '/resources', '/frontier', '/assessments']) {
      const line = router.split('\n').find((value) => value.includes(`path: '${path}'`))!
      expect(line).toContain("layout: 'adaptive'"); expect(line).toContain("communityMode: 'wide'")
    }
    expect(router.split('\n').find((value) => value.includes("path: '/labs/:labId'"))).toContain("layout: 'immersive'")
    expect(communityNavActive('/community/post/example', '/community')).toBe(true)
    expect(communityNavActive('/community/drafts', '/community')).toBe(false)
    expect(communityNavActive('/courses/example', '/topics')).toBe(true)
    expect(communityNavActive('/labs/example', '/labs')).toBe(true)
  })
  it('学习者头像样式不再覆盖同级账号状态标签', () => {
    const css = readFileSync(new URL('../../admin-web/src/styles.css', import.meta.url), 'utf8')
    expect(css).toContain('.learner-list > button > span:first-child,')
    expect(css).not.toContain('.learner-list > button > span,')
  })
})
