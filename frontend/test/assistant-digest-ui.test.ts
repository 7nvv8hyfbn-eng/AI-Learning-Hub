// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp, h, nextTick } from 'vue'
import { assistantConfigDefaults } from '@ai-learning-hub/contracts'
import AssistantPanel from '../src/assistant/AssistantPanel.vue'
import { assistantApi } from '../src/services/api/assistant'
import { assistantState as state, resetAssistant, requestAssistantDigest } from '../src/assistant/assistantState'
const router = vi.hoisted(() => ({ push: vi.fn() }))
vi.mock('vue-router', () => ({ useRouter: () => router }))
vi.mock('../src/services/api/assistant', () => ({ assistantApi: { digest: vi.fn(), config: vi.fn(), chat: vi.fn() } }))
let root: HTMLDivElement, unmount: () => void
beforeEach(() => {
  vi.resetAllMocks(); resetAssistant(); state.ready = true; state.config = { ...assistantConfigDefaults }
  Object.defineProperty(HTMLElement.prototype, 'scrollTo', { configurable: true, value: vi.fn() })
  root = document.createElement('div'); document.body.append(root)
  const app = createApp({ render: () => state.open ? h(AssistantPanel) : null }); app.mount(root)
  unmount = () => { app.unmount(); root.remove() }
})
afterEach(() => { unmount(); resetAssistant(); Reflect.deleteProperty(HTMLElement.prototype, 'scrollTo') })
const click = (text: string) => { const button = [...root.querySelectorAll('button')].find(b => b.textContent?.includes(text)); expect(button).toBeTruthy(); button!.click() }
const result = { postId: 'real-post', title: '真实帖子标题', summary: '正文摘要 <script>危险代码</script>', keywords: ['机器学习'] }
describe('简讯面板真实组件交互', () => {
  it('摘要按文本渲染，关键词开关实时隐藏，回原文先关闭再跳转真实路由', async () => {
    vi.mocked(assistantApi.digest).mockResolvedValue(result)
    await requestAssistantDigest('real-post'); await nextTick()
    expect(root.textContent).toContain(result.title); expect(root.textContent).toContain(result.summary)
    expect(root.querySelector('script')).toBeNull(); expect(root.querySelector('[aria-label="关键词"]')?.textContent).toContain('机器学习')
    state.config.keywords = false; await nextTick(); expect(root.querySelector('[aria-label="关键词"]')).toBeNull()
    router.push.mockImplementation(() => { expect(state.open).toBe(false) })
    click('查看原帖'); await nextTick(); expect(router.push).toHaveBeenCalledWith('/community/post/real-post')
    expect(root.querySelector('[role="dialog"]')).toBeNull()
  })
  it('展示整理中与真实失败；点击重试、普通问答会保留历史', async () => {
    let fail!: (cause: Error) => void
    vi.mocked(assistantApi.digest).mockImplementationOnce(() => new Promise((_done, reject) => { fail = reject }))
    const pending = requestAssistantDigest('real-post', '正在读的帖子'); await nextTick()
    expect(root.textContent).toContain('正在整理《正在读的帖子》')
    expect(document.activeElement).toBe(root.querySelector('[role="dialog"]'))
    fail(new Error('这篇帖子没有足够正文，暂时不能生成简讯')); await pending; await nextTick()
    expect(root.querySelector('[role="alert"]')?.textContent).toContain('没有足够正文')
    vi.mocked(assistantApi.digest).mockResolvedValue(result); click('重试简讯'); await Promise.resolve(); await nextTick()
    expect(root.textContent).toContain(result.summary)
    state.messages.push({ id: 100, role: 'assistant', content: '已有回答', state: 'done' })
    click('普通问答'); await nextTick(); await nextTick()
    expect(root.textContent).toContain('已有回答'); expect(document.activeElement).toBe(root.querySelector('textarea'))
  })
  it('Escape关闭时取消进行中的简讯请求', async () => {
    vi.mocked(assistantApi.digest).mockImplementation(() => new Promise(() => {}))
    void requestAssistantDigest('real-post'); await nextTick()
    root.querySelector('[role="dialog"]')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
    await nextTick(); expect(state.open).toBe(false); expect(root.querySelector('[role="dialog"]')).toBeNull()
    expect(vi.mocked(assistantApi.digest).mock.calls[0]?.[1]?.aborted).toBe(true)
  })
})
