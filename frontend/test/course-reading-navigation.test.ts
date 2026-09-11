import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createPinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import CourseView from '../src/views/CourseView.vue'
import { provideCommunityScrollRoot } from '../src/community/composables/useCommunityScrollRoot'
import { flushRender, setupComponent } from '../src/community/test-renderer'

vi.mock('../src/services/api/client', async (original) => ({ ...await original<object>(), dataMode: 'mock' }))
vi.mock('../src/composables/useRequireAuth', () => ({ ensureAuth: () => true }))

const views: Array<{ unmount: () => void }> = []
beforeEach(() => {
  const classList = { add: vi.fn(), remove: vi.fn() }
  vi.stubGlobal('document', { documentElement: { classList }, body: { classList } })
})
afterEach(() => { for (const view of views.splice(0).reverse()) view.unmount(); vi.unstubAllGlobals() })

const reading = async () => {
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/courses/:courseId', component: { render: () => null } }] })
  await router.push('/courses/llm-zero?lesson=1&source=topics')
  const pinia = createPinia()
  const layout = setupComponent<{ root: HTMLElement }>({ setup: () => ({ root: provideCommunityScrollRoot() }) }, {}, [pinia, router])
  const root = { scrollTop: 0 }
  layout.state.root = root as HTMLElement
  const view = setupComponent<{ currentLesson: number; lessonContent: HTMLElement; detailLoading: boolean; startLearning: (next?: boolean) => Promise<void> }>(CourseView, {}, [pinia, router])
  views.push(layout, view)
  await flushRender()
  const scroll = vi.fn(() => { root.scrollTop = 420 })
  view.state.lessonContent = { scrollIntoView: scroll } as unknown as HTMLElement
  const navigationDone = () => new Promise<void>((resolve) => {
    const stop = router.afterEach(() => { stop(); resolve() })
  })
  return { router, root, view, scroll, navigationDone }
}

it('切换课时在布局恢复位置后定位正文，并保留其他查询参数', async () => {
  const { router, root, view, scroll, navigationDone } = await reading()
  expect(view.state.detailLoading).toBe(false)
  expect(scroll).not.toHaveBeenCalled()
  for (const lesson of [2, 4, 1]) {
    root.scrollTop = 900
    const navigated = navigationDone()
    view.state.currentLesson = lesson
    await navigated
    await flushRender()
    expect(router.currentRoute.value.query).toEqual({ lesson: String(lesson), source: 'topics' })
    expect(root.scrollTop).toBe(420)
    expect(scroll).toHaveBeenLastCalledWith({ block: 'start' })
  }
  expect(scroll).toHaveBeenCalledTimes(3)
})

it('开始学习定位当前正文，继续下一节只在导航完成后定位一次', async () => {
  const { router, root, view, scroll, navigationDone } = await reading()
  await view.state.startLearning()
  expect(scroll).toHaveBeenLastCalledWith({ behavior: 'smooth', block: 'start' })
  scroll.mockClear()
  root.scrollTop = 900
  const navigated = navigationDone()
  await view.state.startLearning(true)
  await navigated
  await flushRender()
  expect(router.currentRoute.value.query.lesson).toBe('2')
  expect(scroll).toHaveBeenCalledExactlyOnceWith({ block: 'start' })
  expect(root.scrollTop).toBe(420)
})
