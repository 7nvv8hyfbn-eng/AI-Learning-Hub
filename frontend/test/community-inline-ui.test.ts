// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp, h, nextTick, reactive } from 'vue'
import type { CommunityInlineCandidateDto, CommunityInlineReference } from '@ai-learning-hub/contracts'
import CommunityInlineSuggestions from '../src/community/CommunityInlineSuggestions.vue'
import { communityApi } from '../src/services/api/community'
import { communityInlineHtml } from '../src/community/inlineHtml'
import { inlineBlocksTokens } from '../src/community/inlineBlocks'
const store = reactive({ epoch: 1, composerSession: 1, composerOpen: true })
const draft = reactive({ form: { inlineReferences: [] as CommunityInlineReference[] } })
vi.mock('../src/stores/community', () => ({ useCommunityStore: () => store }))
vi.mock('../src/community/composables/useCommunityDraft', () => ({ useCommunityDraft: () => draft }))
vi.mock('../src/services/api/community', () => ({ communityApi: { suggestions: vi.fn() } }))
let area: HTMLTextAreaElement, form: HTMLFormElement, unmount: () => void
const candidates: CommunityInlineCandidateDto[] = [{ id: 'topic-a', kind: 'topic', name: '模型 部署', postCount: 30 }, { id: 'topic-b', kind: 'topic', name: '模型评测', postCount: 12 }]
const input = (value: string, caret = value.length) => { area.value = value; area.focus(); area.setSelectionRange(caret, caret); area.dispatchEvent(new Event('input', { bubbles: true })) }
const settle = async () => { await vi.advanceTimersByTimeAsync(205); await nextTick() }
beforeEach(() => {
  vi.useFakeTimers(); vi.resetAllMocks(); Object.assign(store, { epoch: 1, composerSession: 1, composerOpen: true }); draft.form.inlineReferences = []
  vi.mocked(communityApi.suggestions).mockResolvedValue(candidates)
  form = document.createElement('form'); area = document.createElement('textarea'); form.append(area); document.body.append(form)
  const root = document.createElement('div'); form.append(root)
  const app = createApp({ render: () => h(CommunityInlineSuggestions, { target: area }) }); app.mount(root); unmount = () => { app.unmount(); form.remove() }
})
afterEach(() => { unmount(); vi.useRealTimers() })
describe('正文补全键盘、光标与会话', () => {
  it('200ms 防抖；中间选项替换完整标记，保留前后文本和空格', async () => {
    input('前 #模型旧词 后文', 5); await vi.advanceTimersByTimeAsync(150)
    expect(communityApi.suggestions).not.toHaveBeenCalled(); await settle()
    const event = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }); area.dispatchEvent(event)
    expect(event.defaultPrevented).toBe(true); expect(area.value).toBe('前 #模型_部署 后文')
    expect(area.selectionStart).toBe('前 #模型_部署 '.length); expect(draft.form.inlineReferences).toEqual([{ kind: 'topic', text: '#模型_部署', id: 'topic-a' }])
  })
  it('方向键和 Tab 确认不冒泡为提交；Escape 仅关闭候选', async () => {
    const parent = vi.fn(); form.addEventListener('keydown', parent)
    input('#模'); await settle()
    area.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }))
    area.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }))
    expect(area.value).toBe('#模型评测 '); expect(parent).not.toHaveBeenCalled()
    input('#模'); await settle(); area.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })); await nextTick()
    expect(document.querySelector('[role=listbox]')).toBeNull(); expect(store.composerOpen).toBe(true)
  })
  it('中文组合期间不检索、不抢回车；组合结束可搜索中文昵称', async () => {
    area.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true })); input('@张'); await settle()
    expect(communityApi.suggestions).not.toHaveBeenCalled()
    const enter = new KeyboardEvent('keydown', { key: 'Enter', isComposing: true, bubbles: true, cancelable: true }); area.dispatchEvent(enter)
    expect(enter.defaultPrevented).toBe(false)
    area.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true })); await settle()
    expect(communityApi.suggestions).toHaveBeenCalledWith('mention', '张')
  })
  it('较早请求不能覆盖新检索，换账号和关闭编辑器使迟到结果失效', async () => {
    let first!: (value: CommunityInlineCandidateDto[]) => void, second!: (value: CommunityInlineCandidateDto[]) => void
    vi.mocked(communityApi.suggestions).mockImplementationOnce(() => new Promise((resolve) => { first = resolve })).mockImplementationOnce(() => new Promise((resolve) => { second = resolve }))
    input('#旧'); await settle(); input('#新'); await settle(); second([candidates[1]!]); await nextTick(); first([candidates[0]!]); await nextTick()
    expect(document.querySelector('[role=listbox]')?.textContent).toContain('模型评测'); expect(document.querySelector('[role=listbox]')?.textContent).not.toContain('模型 部署')
    store.epoch++; await nextTick(); expect(document.querySelector('[role=listbox]')).toBeNull()
    input('#新'); store.composerOpen = false; await settle(); expect(document.querySelector('[role=listbox]')).toBeNull()
  })
  it('弹窗编辑器的候选位于同一个原生 dialog 内，可被鼠标触屏访问', async () => {
    const dialog = document.createElement('dialog'); document.body.append(dialog); dialog.append(form)
    input('#模'); await settle()
    expect(dialog.querySelector('[role=listbox]')).not.toBeNull()
    ;(dialog.querySelector('[role=option]') as HTMLButtonElement).click()
    expect(area.value).toBe('#模型_部署 ')
    document.body.append(form); dialog.remove()
  })
  it('鼠标或触屏点击只选择一个候选，最多展示8条', async () => {
    vi.mocked(communityApi.suggestions).mockResolvedValue(Array.from({ length: 12 }, (_, i) => ({ ...candidates[0]!, id: `t${i}` })))
    input('#模'); await settle(); expect(document.querySelectorAll('[role=option]')).toHaveLength(8)
    ;(document.querySelector('[role=option]') as HTMLButtonElement).click()
    expect(draft.form.inlineReferences).toHaveLength(1); expect(area.value).toBe('#模型_部署 ')
  })
})
describe('安全行内展示与解析', () => {
  it('跨格式的完整话题成一个链接；原链接、代码、邮件和图片alt保持原语义', () => {
    const html = '<p>#模<strong>型</strong> @student_1</p><p><code>#模型</code> test@student_1.com <a href="https://a">@student_1</a></p><img src="https://a/image" alt="@student_1"><script>alert(1)</script>'
    const refs = [{ kind: 'topic' as const, text: '#模型', id: 'topic', route: '/community/topic/model' }, { kind: 'mention' as const, text: '@student_1', id: 'stable', route: '/community/people/stable' }]
    const doc = new DOMParser().parseFromString(communityInlineHtml(html, refs), 'text/html')
    expect([...doc.querySelectorAll('a[data-community-inline]')].map((a) => [a.textContent, a.getAttribute('href')])).toEqual([['#模型', '/community/topic/model'], ['@student_1', '/community/people/stable']])
    expect(doc.querySelector('script')).toBeNull(); expect(doc.querySelector('code')?.textContent).toBe('#模型'); expect(inlineBlocksTokens([{ type: 'rich_text', text: html }]).map((token) => token.text)).toEqual(['#模型', '@student_1'])
  })
})
