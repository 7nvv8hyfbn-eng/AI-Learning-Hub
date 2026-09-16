import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { assistantConfigDefaults } from '@ai-learning-hub/contracts'
import { setupComponent } from '../src/community/test-renderer'
import AssistantEntry from '../src/assistant/AssistantEntry.vue'
import { assistantApi } from '../src/services/api/assistant'
import { assistantState as state, loadAssistantConfig, resetAssistant, sendAssistantQuestion, toggleAssistant, closeAssistant } from '../src/assistant/assistantState'
vi.mock('../src/services/api/assistant', () => ({ assistantApi: { config: vi.fn(), chat: vi.fn() } }))
beforeEach(() => { resetAssistant(); vi.resetAllMocks(); vi.mocked(assistantApi.config).mockResolvedValue({ ...assistantConfigDefaults }) })
afterEach(() => { resetAssistant(); vi.useRealTimers(); vi.unstubAllGlobals() })
describe('小雪问答生命周期', () => {
  it('配置共用请求，启用状态确认前不打开', async () => {
    toggleAssistant(); expect(state.open).toBe(false)
    const a = loadAssistantConfig(), b = loadAssistantConfig(); await Promise.all([a, b])
    expect(assistantApi.config).toHaveBeenCalledTimes(1); toggleAssistant(); expect(state.open).toBe(true)
  })
  it('空输入、超长输入与并发发送不产生多余模型请求', async () => {
    await loadAssistantConfig()
    vi.mocked(assistantApi.chat).mockImplementation(() => new Promise(() => {}))
    await sendAssistantQuestion('  '); await sendAssistantQuestion('x'.repeat(2001))
    expect(assistantApi.chat).not.toHaveBeenCalled()
    void sendAssistantQuestion('第一个问题'); await sendAssistantQuestion('重复')
    expect(assistantApi.chat).toHaveBeenCalledTimes(1); expect(state.messages).toHaveLength(2)
  })
  it('失败保留问题，重试不重复插入用户消息', async () => {
    await loadAssistantConfig(); vi.mocked(assistantApi.chat).mockRejectedValueOnce(new Error('模型余额不足'))
    await sendAssistantQuestion('你好'); expect(state.messages[1]?.content).toBe('模型余额不足')
    vi.mocked(assistantApi.chat).mockResolvedValue({ reply: '欢迎学习' })
    await sendAssistantQuestion('你好', state.messages[1]!.id)
    expect(state.messages).toHaveLength(2); expect(state.messages[1]?.state).toBe('done')
    expect(vi.mocked(assistantApi.chat).mock.calls[1]?.[0].messages).toEqual([{ role: 'user', content: '你好' }])
  })
  it('关闭后取消请求、保留历史、忽略迟到结果', async () => {
    await loadAssistantConfig(); toggleAssistant()
    let resolve!: (value: { reply: string }) => void
    vi.mocked(assistantApi.chat).mockImplementation(() => new Promise(done => { resolve = done }))
    const pending = sendAssistantQuestion('你好'); closeAssistant()
    expect(vi.mocked(assistantApi.chat).mock.calls[0]?.[1]?.aborted).toBe(true)
    resolve({ reply: '旧回答' }); await pending; toggleAssistant()
    expect(state.open).toBe(true); expect(state.messages[1]?.state).toBe('error'); expect(state.messages[1]?.content).not.toBe('旧回答')
  })
  it('账号退出清空历史和配置，旧账号结果不能写回', async () => {
    let finishConfig!: (v: typeof assistantConfigDefaults) => void
    vi.mocked(assistantApi.config).mockImplementationOnce(() => new Promise(done => { finishConfig = done }))
    const pendingConfig = loadAssistantConfig(); resetAssistant(); finishConfig({ ...assistantConfigDefaults, name: '旧账号' }); await pendingConfig
    expect(state.ready).toBe(false); expect(state.config.name).toBe('小雪助手')
    await loadAssistantConfig()
    let finish!: (v: { reply: string }) => void
    vi.mocked(assistantApi.chat).mockImplementationOnce(() => new Promise(done => { finish = done }))
    const pending = sendAssistantQuestion('私有问题'); resetAssistant(); finish({ reply: '私有回答' }); await pending
    expect(state.messages).toEqual([])
  })
  it('后台关闭或配置读取失败不发送问题，不假装接通', async () => {
    vi.mocked(assistantApi.config).mockResolvedValueOnce({ ...assistantConfigDefaults, enabled: false })
    await loadAssistantConfig(); toggleAssistant(); await sendAssistantQuestion('你好')
    expect(state.open).toBe(false); expect(assistantApi.chat).not.toHaveBeenCalled()
    resetAssistant(); vi.mocked(assistantApi.config).mockRejectedValueOnce(new Error('网络中断'))
    await loadAssistantConfig(); expect(state.configError).toBe('网络中断'); expect(state.ready).toBe(false)
  })
})
describe('四种动作', () => {
  it('随机不连续重复，连点只有一个复位计时器，卸载清理', () => {
    vi.useFakeTimers(); vi.stubGlobal('window', { matchMedia: () => ({ matches: false }) })
    const view = setupComponent<{ action: string; activate: () => void }>(AssistantEntry, { name: '小雪', position: 'right', open: false })
    let previous = 'idle'
    for (let i = 0; i < 12; i++) { view.state.activate(); expect(view.state.action).not.toBe(previous); previous = view.state.action; expect(vi.getTimerCount()).toBe(1) }
    vi.advanceTimersByTime(850); expect(view.state.action).toBe('idle')
    view.state.activate(); view.unmount(); expect(vi.getTimerCount()).toBe(0)
  })
  it('减少动态效果时保持默认姿态，不添加计时器', () => {
    vi.useFakeTimers(); vi.stubGlobal('window', { matchMedia: () => ({ matches: true }) })
    const view = setupComponent<{ action: string; activate: () => void }>(AssistantEntry, { name: '小雪', position: 'left', open: false })
    view.state.activate(); expect(view.state.action).toBe('idle'); expect(vi.getTimerCount()).toBe(0); view.unmount()
  })
})
