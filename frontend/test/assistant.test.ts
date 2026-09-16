import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { assistantConfigDefaults, type AssistantDigestDto } from '@ai-learning-hub/contracts'
import { setupComponent } from '../src/community/test-renderer'
import AssistantEntry from '../src/assistant/AssistantEntry.vue'
import { assistantApi } from '../src/services/api/assistant'
import { assistantState as state, loadAssistantConfig, resetAssistant, sendAssistantQuestion, toggleAssistant, closeAssistant, requestAssistantDigest, showAssistantChat } from '../src/assistant/assistantState'
vi.mock('../src/services/api/assistant', () => ({ assistantApi: { config: vi.fn(), chat: vi.fn(), digest: vi.fn() } }))
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
describe('帖子简讯生命周期', () => {
  const digest = (postId: string): AssistantDigestDto => ({ postId, title: `标题-${postId}`, summary: `摘要-${postId}`, keywords: ['学习'] })
  it('只向接口传当前postId，标题使用服务器结果', async () => {
    await loadAssistantConfig(); vi.mocked(assistantApi.digest).mockResolvedValue(digest('p1'))
    await requestAssistantDigest('p1', '列表旧标题')
    expect(assistantApi.digest).toHaveBeenCalledWith({ postId: 'p1' }, expect.any(AbortSignal))
    expect(state.view).toBe('digest'); expect(state.open).toBe(true); expect(state.busy).toBe(false)
    expect(state.digest).toEqual(digest('p1')); expect(state.digestTitle).toBe('标题-p1')
  })
  it('快速换帖会取消旧请求，旧结果和错误均不能覆盖新帖', async () => {
    await loadAssistantConfig()
    let first!: (value: AssistantDigestDto) => void, second!: (reason: Error) => void
    vi.mocked(assistantApi.digest).mockImplementationOnce(() => new Promise(done => { first = done }))
      .mockImplementationOnce(() => new Promise((_done, reject) => { second = reject }))
      .mockResolvedValueOnce(digest('p3'))
    const a = requestAssistantDigest('p1'), b = requestAssistantDigest('p2')
    expect(vi.mocked(assistantApi.digest).mock.calls[0]?.[1]?.aborted).toBe(true)
    expect(state.digest).toBeNull(); expect(state.busy).toBe(true)
    first(digest('p1')); await a
    expect(state.digest).toBeNull(); expect(state.busy).toBe(true)
    await requestAssistantDigest('p3'); second(new Error('旧帖子失败')); await b
    expect(state.digest).toEqual(digest('p3')); expect(state.digestError).toBe('')
  })
  it('关闭并重开同一帖子也不能接收上一轮结果', async () => {
    await loadAssistantConfig()
    let finish!: (value: AssistantDigestDto) => void
    vi.mocked(assistantApi.digest).mockImplementationOnce(() => new Promise(done => { finish = done })).mockResolvedValueOnce({ ...digest('p1'), summary: '新摘要' })
    const old = requestAssistantDigest('p1'); closeAssistant()
    expect(state.digestPostId).toBe(''); expect(state.digest).toBeNull()
    expect(vi.mocked(assistantApi.digest).mock.calls[0]?.[1]?.aborted).toBe(true)
    await requestAssistantDigest('p1'); finish(digest('p1')); await old
    expect(state.digest?.summary).toBe('新摘要')
  })
  it('返回错误postId或空摘要进入失败态；重试能恢复', async () => {
    await loadAssistantConfig(); vi.mocked(assistantApi.digest).mockResolvedValueOnce(digest('wrong'))
    await requestAssistantDigest('p1'); expect(state.digestError).toContain('不一致'); expect(state.digest).toBeNull()
    vi.mocked(assistantApi.digest).mockResolvedValueOnce({ ...digest('p1'), summary: ' ' })
    await requestAssistantDigest('p1'); expect(state.digestError).toContain('有效内容')
    vi.mocked(assistantApi.digest).mockResolvedValueOnce(digest('p1'))
    await requestAssistantDigest('p1'); expect(state.digest).toEqual(digest('p1')); expect(state.digestError).toBe('')
  })
  it('普通问答与简讯共用取消机制，返回问答保留已有历史', async () => {
    await loadAssistantConfig(); vi.mocked(assistantApi.chat).mockResolvedValue({ reply: '已有回答' })
    await sendAssistantQuestion('已有问题')
    vi.mocked(assistantApi.digest).mockImplementation(() => new Promise(() => {}))
    void requestAssistantDigest('p1'); showAssistantChat()
    expect(state.view).toBe('chat'); expect(state.busy).toBe(false); expect(state.digestPostId).toBe('')
    expect(state.messages.map(m => m.content)).toEqual(['已有问题', '已有回答'])
    expect(vi.mocked(assistantApi.digest).mock.calls[0]?.[1]?.aborted).toBe(true)
  })
  it('未就绪、空编号和简讯关闭不发请求，关键词关闭仍可生成，普通问答不受影响', async () => {
    await requestAssistantDigest('p1'); await loadAssistantConfig(); await requestAssistantDigest(' ')
    state.config.digestEnabled = false; await requestAssistantDigest('p1')
    expect(assistantApi.digest).not.toHaveBeenCalled()
    vi.mocked(assistantApi.chat).mockResolvedValue({ reply: '仍可问答' }); await sendAssistantQuestion('你好')
    expect(state.messages.at(-1)?.content).toBe('仍可问答')
    state.config.digestEnabled = true; state.config.keywords = false
    vi.mocked(assistantApi.digest).mockResolvedValue(digest('p1')); await requestAssistantDigest('p1')
    expect(state.digest?.postId).toBe('p1')
  })
  it('刷新关闭简讯的设置取消当前生成，助手和问答仍可用', async () => {
    await loadAssistantConfig()
    vi.mocked(assistantApi.digest).mockImplementation(() => new Promise(() => {})); void requestAssistantDigest('p1')
    vi.mocked(assistantApi.config).mockResolvedValue({ ...assistantConfigDefaults, digestEnabled: false }); await loadAssistantConfig()
    expect(state.view).toBe('chat'); expect(state.open).toBe(true); expect(state.busy).toBe(false)
    expect(vi.mocked(assistantApi.digest).mock.calls[0]?.[1]?.aborted).toBe(true)
  })
  it('账号退出会丢弃简讯，不向下一个账号泄露内容', async () => {
    await loadAssistantConfig(); let finish!: (value: AssistantDigestDto) => void
    vi.mocked(assistantApi.digest).mockImplementation(() => new Promise(done => { finish = done }))
    const pending = requestAssistantDigest('private'); resetAssistant(); finish(digest('private')); await pending
    expect(state.digest).toBeNull(); expect(state.digestPostId).toBe(''); expect(state.open).toBe(false)
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
