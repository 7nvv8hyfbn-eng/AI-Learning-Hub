import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia } from 'pinia'
import { ref } from 'vue'
import { createMemoryHistory, createRouter } from 'vue-router'
import { setupComponent, flushRender } from '../src/community/test-renderer'
import { communityScrollRoot, provideCommunityScrollRoot } from '../src/community/composables/useCommunityScrollRoot'
import { useCommunityStore } from '../src/stores/community'
import { communityApi } from '../src/services/api/community'
import CommunityFeedView from '../src/community/CommunityFeedView.vue'
import CommunityBlocks from '../src/community/CommunityBlocks.vue'
import CommunityImageGallery from '../src/community/CommunityImageGallery.vue'
import CommunityPostMenu from '../src/community/CommunityPostMenu.vue'
import AppDialog from '../src/components/base/AppDialog.vue'
import { relativeTime } from '../src/community/labels'
import type { CommunityFeedDto } from '@ai-learning-hub/contracts'

vi.mock('../src/services/api/community', () => ({ communityApi: { feed: vi.fn(), impressions: vi.fn(), updates: vi.fn(), image: vi.fn() } }))
const views: Array<{ unmount: () => void }> = []
class Observer {
  static instances: Observer[] = []
  observe = vi.fn(); disconnect = vi.fn()
  constructor(public callback: (entries: Array<{ isIntersecting: boolean; target: unknown }>) => void, public options: IntersectionObserverInit) { Observer.instances.push(this) }
}
class Resize {
  static instances: Resize[] = []
  observe = vi.fn(); disconnect = vi.fn()
  constructor(public callback: () => void) { Resize.instances.push(this) }
}
const classList = () => { const values = new Set<string>(); return { add: (value: string) => values.add(value), remove: (value: string) => values.delete(value), contains: (value: string) => values.has(value) } }
beforeEach(() => {
  vi.useFakeTimers(); vi.resetAllMocks(); Observer.instances = []; Resize.instances = []
  vi.stubGlobal('window', Object.assign(new EventTarget(), { setInterval, clearInterval, innerWidth: 1200, innerHeight: 800 }))
  vi.stubGlobal('document', { documentElement: { classList: classList() }, body: { classList: classList(), style: { overflow: '' } }, visibilityState: 'visible', activeElement: null, querySelector: vi.fn(() => null) })
  vi.stubGlobal('HTMLElement', class {})
  vi.stubGlobal('IntersectionObserver', Observer); vi.stubGlobal('ResizeObserver', Resize)
  vi.mocked(communityApi.feed).mockResolvedValue({ items: [], requestId: 'r1', nextCursor: null, degraded: false, policyVersion: 'v1' })
  vi.mocked(communityApi.impressions).mockResolvedValue({}); vi.mocked(communityApi.updates).mockResolvedValue({ count: 2 })
})
afterEach(() => { for (const view of views.splice(0).reverse()) view.unmount(); vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllGlobals() })
const routing = async (path = '/community') => {
  const router = createRouter({ history: createMemoryHistory(), routes: ['/community', '/community/post/:postId', '/topics'].map((path) => ({ path, component: { render: () => null } })) })
  await router.push(path)
  return router
}
describe('社区生命周期与浏览状态', () => {
  it('挂载布局锁定html/body，普通路由位置由中栏管理，卸载解除class', async () => {
    const router = await routing('/topics')
    const view = setupComponent<{ root: HTMLElement }>({ setup: () => ({ root: provideCommunityScrollRoot() }) }, {}, [createPinia(), router]); views.push(view)
    const root = { scrollTop: 500 }; view.state.root = root as HTMLElement
    expect(document.body.classList.contains('community-layout-active')).toBe(true)
    await router.push('/community/post/one'); await flushRender(); expect(root.scrollTop).toBe(0)
    root.scrollTop = 250
    await router.push('/topics'); await flushRender(); expect(root.scrollTop).toBe(500)
    view.unmount(); views.pop()
    expect(document.body.classList.contains('community-layout-active')).toBe(false)
    expect(document.documentElement.classList.contains('community-layout-active')).toBe(false)
  })
  it('无限加载观察当前中栏，缓存Tab切换不重复请求，离开释放观察器和计时器', async () => {
    const router = await routing(), pinia = createPinia()
    const root = ref({ scrollTop: 430, scrollTo: vi.fn(), getBoundingClientRect: () => ({ top: 0, bottom: 700 }) })
    const view = setupComponent<{ feedRoot: HTMLElement; sentinel: HTMLElement; change: (mode: 'latest', type: 'all') => Promise<void> }>(CommunityFeedView, {}, [pinia, router], [[communityScrollRoot, root]]); views.push(view)
    const postNode = { dataset: { postId: 'p1' } }, rows = { querySelectorAll: vi.fn((selector: string) => selector.includes('community-post') ? [postNode] : []), querySelector: () => null }
    view.state.feedRoot = rows as unknown as HTMLElement; view.state.sentinel = {} as HTMLElement
    await flushRender()
    const store = useCommunityStore(pinia)
    store.feeds['for_you:all'].scroll = 430; root.value.scrollTop = 430
    expect(Observer.instances).toHaveLength(1)
    expect(Observer.instances.every((observer) => observer.options.root === root.value)).toBe(true)
    expect(communityApi.impressions).not.toHaveBeenCalled()
    await view.state.change('latest', 'all'); await flushRender()
    root.value.scrollTop = 220
    await router.replace('/community'); await flushRender()
    expect(root.value.scrollTop).toBe(430); expect(communityApi.feed).toHaveBeenCalledTimes(2)
    view.unmount(); views.pop()
    expect(Observer.instances.every((observer) => observer.disconnect.mock.calls.length)).toBe(true)
    expect(vi.getTimerCount()).toBe(0)
  })
  it('离开页面后迟到首屏响应不能创建Observer和轮询', async () => {
    let resolve!: (value: CommunityFeedDto) => void
    vi.mocked(communityApi.feed).mockReturnValue(new Promise((done) => { resolve = done }))
    const router = await routing(), view = setupComponent(CommunityFeedView, {}, [createPinia(), router])
    view.unmount()
    resolve({ items: [], requestId: 'late', nextCursor: null, degraded: false, policyVersion: 'v1' }); await flushRender()
    expect(Observer.instances).toHaveLength(0)
    expect(vi.getTimerCount()).toBe(0)
  })
  it('真实截断才发overflow，ResizeObserver卸载解绑', () => {
    const overflow = vi.fn(), view = setupComponent<{ textRoot: HTMLElement; measure: () => void }>(CommunityBlocks, { blocks: [{ type: 'paragraph', text: '文字' }], compact: true, onOverflow: overflow }); views.push(view)
    const paragraph = { scrollHeight: 30, clientHeight: 30 }
    view.state.textRoot = paragraph as HTMLElement
    view.state.measure(); expect(overflow).toHaveBeenLastCalledWith(false)
    paragraph.scrollHeight = 90; view.state.measure(); expect(overflow).toHaveBeenLastCalledWith(true)
    view.unmount(); views.pop(); expect(Resize.instances[0].disconnect).toHaveBeenCalled()
  })
  it('画廊并行限量加载，离开后返回的ObjectURL仍释放', async () => {
    const revoke = vi.spyOn(URL, 'revokeObjectURL')
    const resolves: Array<(value: string) => void> = []
    vi.mocked(communityApi.image).mockImplementation(() => new Promise((resolve) => { resolves.push(resolve) }))
    const images = Array.from({ length: 4 }, (_, index) => ({ fileId: `image-${index}` }))
    const view = setupComponent<{ load: () => Promise<void>; urls: Record<string, string>; step: (delta: number) => void; selected: number }>(CommunityImageGallery, { images }); views.push(view)
    const loading = view.state.load()
    expect(communityApi.image).toHaveBeenCalledTimes(4)
    const queued = setupComponent<{ load: () => Promise<void> }>(CommunityImageGallery, { images: images.map((image) => ({ fileId: `queued-${image.fileId}` })) }); views.push(queued)
    const queuedLoading = queued.state.load()
    expect(communityApi.image).toHaveBeenCalledTimes(4)
    queued.unmount(); views.pop()
    resolves[0]('blob:first'); await flushRender(); expect(view.state.urls['image-0']).toBe('blob:first')
    view.state.step(-1); expect(view.state.selected).toBe(3)
    view.unmount(); views.pop(); expect(revoke).toHaveBeenCalledWith('blob:first')
    for (let i = 1; i < resolves.length; i++) resolves[i](`blob:late-${i}`)
    await loading
    await queuedLoading
    expect(communityApi.image).toHaveBeenCalledTimes(4)
    expect(revoke).toHaveBeenCalledTimes(4)
  })
  it('菜单使用auto popover并定位在视口边界内，滚动时关闭并移除监听', async () => {
    const view = setupComponent<{ trigger: HTMLButtonElement; panel: HTMLElement; position: { left: string; top: string }; toggle: () => Promise<void> }>(CommunityPostMenu); views.push(view)
    const focus = vi.fn(), hide = vi.fn()
    view.state.trigger = { getBoundingClientRect: () => ({ right: 1190, bottom: 780, top: 744 }) } as HTMLButtonElement
    view.state.panel = { showPopover: vi.fn(), hidePopover: hide, offsetWidth: 180, offsetHeight: 240, querySelector: () => ({ focus }) } as unknown as HTMLElement
    await view.state.toggle()
    expect(view.state.position).toEqual({ left: '1010px', top: '500px' }); expect(focus).toHaveBeenCalled()
    window.dispatchEvent(new Event('scroll')); expect(hide).toHaveBeenCalled()
    view.unmount(); views.pop(); const calls = hide.mock.calls.length
    window.dispatchEvent(new Event('scroll')); expect(hide).toHaveBeenCalledTimes(calls)
  })
  it('多个AppDialog只有最上层响应Escape，关闭/卸载恢复各自body锁', async () => {
    interface DialogState { dialog: HTMLDialogElement; syncDialog: (open: boolean) => Promise<void> }
    const bottomClose = vi.fn(), topClose = vi.fn(), autofocus = vi.fn(), fallbackFocus = vi.fn()
    const bottom = setupComponent<DialogState>(AppDialog, { modelValue: true, title: '编辑器', 'onUpdate:modelValue': bottomClose }); views.push(bottom)
    const fakeDialog = () => { const item = { open: false, showModal: () => { item.open = true }, close: () => { item.open = false }, querySelector: (selector: string) => ({ focus: selector === '[autofocus]' ? autofocus : fallbackFocus }) }; return item as unknown as HTMLDialogElement }
    bottom.state.dialog = fakeDialog(); await bottom.state.syncDialog(true)
    expect(autofocus).toHaveBeenCalledWith({ preventScroll: true }); expect(fallbackFocus).not.toHaveBeenCalled()
    const top = setupComponent<DialogState>(AppDialog, { modelValue: true, title: '保留草稿', 'onUpdate:modelValue': topClose }); views.push(top)
    top.state.dialog = fakeDialog(); await top.state.syncDialog(true)
    const escape = new Event('keydown', { cancelable: true }); Object.assign(escape, { key: 'Escape' }); window.dispatchEvent(escape)
    expect(topClose).toHaveBeenCalledOnce(); expect(bottomClose).not.toHaveBeenCalled(); expect(document.body.style.overflow).toBe('hidden')
    await top.state.syncDialog(false); top.unmount(); views.pop(); expect(document.body.style.overflow).toBe('hidden')
    await bottom.state.syncDialog(false); bottom.unmount(); views.pop(); expect(document.body.style.overflow).toBe('')
  })
  it('相对时间覆盖刚刚、分钟、小时、昨天及跨年日期', () => {
    const now = new Date('2026-08-30T12:00:00+08:00').getTime()
    expect(relativeTime(new Date(now - 10000).toISOString(), now)).toBe('刚刚')
    expect(relativeTime(new Date(now - 5 * 60000).toISOString(), now)).toBe('5 分钟前')
    expect(relativeTime(new Date(now - 2 * 3600000).toISOString(), now)).toBe('2 小时前')
    expect(relativeTime(new Date(now - 24 * 3600000).toISOString(), now)).toBe('昨天')
    expect(relativeTime('2025-08-01T00:00:00Z', now)).toContain('2025')
  })
})
