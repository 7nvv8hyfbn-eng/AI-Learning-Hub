import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, getActivePinia, setActivePinia } from 'pinia'
import { createSSRApp, h, nextTick, reactive, ref } from 'vue'
import { renderToString, type SSRContext } from 'vue/server-renderer'
import { createMemoryHistory, createRouter, isNavigationFailure, NavigationFailureType, useLink } from 'vue-router'
import { useCommunityDraft } from '../src/community/composables/useCommunityDraft'
import { useCommunityStore } from '../src/stores/community'
import { communityApi } from '../src/services/api/community'
import type { CommunityAuthorDto, CommunityPostDetailDto } from '@ai-learning-hub/contracts'
import CommunityQuickComposer from '../src/community/CommunityQuickComposer.vue'
import CommunityComposer from '../src/community/CommunityComposer.vue'
import CommunityDraftConflict from '../src/community/CommunityDraftConflict.vue'
import CommunityDraftsView from '../src/community/CommunityDraftsView.vue'
import { setupComponent } from '../src/community/test-renderer'
import { communityScrollRoot } from '../src/community/composables/useCommunityScrollRoot'
import { ApiError } from '../src/services/api/client'

const account = reactive({ user: { id: 'owner-a', communityWriteEnabled: true } as { id: string; communityWriteEnabled: boolean } | null, dataMode: 'mock' })
vi.mock('../src/stores/auth', () => ({ useAuthStore: () => account }))
vi.mock('../src/services/api/community', () => ({ communityApi: { topics: vi.fn(), drafts: vi.fn(), save: vi.fn(), saveDraft: vi.fn(), upload: vi.fn(), bindingContext: vi.fn(), post: vi.fn() } }))
const storage = new Map<string, string>()
const key = (id: string, intent = 'post') => `community-draft:mock:${id}:${intent}`
const settle = async () => { await nextTick(); await Promise.resolve(); await nextTick() }
const post = { id: 'saved-post', type: 'general', status: 'published', topics: [], viewerState: {} } as CommunityPostDetailDto
beforeEach(() => {
  vi.useFakeTimers(); vi.resetAllMocks(); storage.clear(); setActivePinia(createPinia())
  account.user = { id: 'owner-a', communityWriteEnabled: true }
  account.dataMode = 'mock'
  vi.stubGlobal('localStorage', { get length() { return storage.size }, key: (i: number) => Array.from(storage.keys())[i] ?? null, getItem: (name: string) => storage.get(name) || null, setItem: (name: string, value: string) => storage.set(name, value), removeItem: (name: string) => storage.delete(name) })
  vi.stubGlobal('window', new EventTarget())
  vi.mocked(communityApi.topics).mockResolvedValue([])
  vi.mocked(communityApi.drafts).mockResolvedValue([])
  vi.mocked(communityApi.save).mockResolvedValue(post)
  vi.mocked(communityApi.saveDraft).mockResolvedValue({ id: 'server-draft' } as CommunityPostDetailDto)
})
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllGlobals() })
describe('共享发布器与草稿账号隔离', () => {
  it('自动保存尚未返回时点击发布，等待草稿确认后继续同一帖发布', async () => {
    const store = useCommunityStore(), editor = useCommunityDraft()
    store.openComposer(); await settle(); editor.body = '自动保存中的明确发布请求'
    let finish!: (value: CommunityPostDetailDto) => void
    vi.mocked(communityApi.saveDraft).mockReturnValueOnce(new Promise(resolve => { finish = resolve }))
    const autosave = editor.save(true); await settle()
    const publish = editor.save(); finish({ ...post, id: 'autosaved', revision: 2, status: 'draft' })
    await autosave; expect(await publish).toBe(true)
    expect(communityApi.save).toHaveBeenCalledWith(expect.objectContaining({ expectedRevision: 2, status: 'published' }), 'autosaved', expect.any(String))
    expect(store.composerOpen).toBe(false)
  })
  it('等待自动保存期间切换账号，排队发布不能写入新会话', async () => {
    const store = useCommunityStore(), editor = useCommunityDraft()
    store.openComposer(); await settle(); editor.body = '旧账号尚未确认的发布'
    let finish!: (value: CommunityPostDetailDto) => void
    vi.mocked(communityApi.saveDraft).mockReturnValueOnce(new Promise(resolve => { finish = resolve }))
    const autosave = editor.save(true); await settle(); const publish = editor.save()
    account.user = { id: 'owner-b', communityWriteEnabled: true }; await settle()
    finish({ ...post, status: 'draft' }); await autosave
    expect(await publish).toBe(false); expect(communityApi.save).not.toHaveBeenCalled()
  })
  it('多选逐张确认，预留四张名额；取消不上传，成功后的顺序稳定', async () => {
    const editor = useCommunityDraft(), store = useCommunityStore()
    store.openComposer(); await settle()
    const files = [1, 2, 3, 4].map((n) => new File([String(n)], `${n}.png`, { type: 'image/png' }))
    await editor.uploadFiles(files)
    expect(editor.pendingImages).toBe(4); expect(communityApi.upload).not.toHaveBeenCalled()
    await editor.uploadFiles([files[0]!])
    expect(editor.error).toContain('还可添加 0 张'); expect(editor.pendingImages).toBe(4)
    expect(editor.activeImage).toMatchObject({ position: 1, total: 4 })
    editor.cancelImage(editor.activeImage!.id)
    expect(editor.activeImage).toMatchObject({ position: 2, total: 4 })
    for (let i = 1; i < 4; i++) {
      vi.mocked(communityApi.upload).mockResolvedValueOnce({ id: `file-${i}` })
      await editor.saveEditedImage(editor.activeImage!.id, files[i]!, `说明${i}`)
    }
    expect(editor.images).toEqual([1, 2, 3].map((i) => ({ fileId: `file-${i}`, alt: `说明${i}` })))
    expect(editor.pendingImages).toBe(0); expect(communityApi.upload).toHaveBeenCalledTimes(3)
  })
  it('图片上传失败可同键重试且只插入一次，失败不清空正文', async () => {
    const editor = useCommunityDraft(), store = useCommunityStore()
    store.openComposer(); await settle(); editor.body = '上传失败仍保留的正文'
    const file = new File(['pixels'], 'retry.png', { type: 'image/png' })
    await editor.uploadFiles([file]); const id = editor.activeImage!.id
    vi.mocked(communityApi.upload).mockRejectedValueOnce(new Error('网络断开')).mockResolvedValueOnce({ id: 'new-file' })
    await expect(editor.saveEditedImage(id, file, '说明')).rejects.toThrow('网络断开')
    expect(editor.images).toEqual([]); expect(editor.body).toContain('仍保留')
    expect(await editor.saveEditedImage(id, file, '说明')).toBe(true)
    expect(await editor.saveEditedImage(id, file, '说明')).toBe(false)
    const calls = vi.mocked(communityApi.upload).mock.calls
    expect(calls[0]![1]!.key).toBe(calls[1]![1]!.key)
    expect(editor.images).toEqual([{ fileId: 'new-file', alt: '说明' }])
  })
  it('重新编辑成功才替换引用，取消保留顺序和说明；移除只解除草稿引用', async () => {
    const editor = useCommunityDraft(), store = useCommunityStore()
    store.openComposer({ contentBlocks: [{ type: 'paragraph', text: '正文' }, { type: 'image', fileId: 'a', alt: '甲' }, { type: 'image', fileId: 'b', alt: '乙' }] }); await settle()
    editor.editImage('a'); expect(editor.activeImage).toMatchObject({ fileId: 'a', alt: '甲' })
    editor.cancelImage(editor.activeImage!.id)
    expect(editor.images.map((image) => image.fileId)).toEqual(['a', 'b'])
    editor.richBlocks = editor.blocks; editor.editImage('a')
    vi.mocked(communityApi.upload).mockResolvedValueOnce({ id: 'a-edited' })
    await editor.saveEditedImage(editor.activeImage!.id, new File(['x'], 'edited.png', { type: 'image/png' }), '甲')
    expect(editor.images).toEqual([{ fileId: 'a-edited', alt: '甲' }, { fileId: 'b', alt: '乙' }])
    expect(editor.richBlocks.filter((block) => block.type === 'image').map((block) => block.fileId)).toEqual(['a-edited', 'b'])
    editor.removeImage('a-edited'); expect(editor.images).toEqual([{ fileId: 'b', alt: '乙' }])
    expect(editor.richBlocks.some((block) => block.type === 'image' && block.fileId === 'a-edited')).toBe(false)
  })
  it('待处理图片阻止发布和高级切换，正文照常自动保存，刷新提醒重新选择', async () => {
    const view = setupComponent<{ advanced: () => void }>(CommunityQuickComposer)
    const editor = useCommunityDraft(), store = useCommunityStore()
    store.openComposer(); await settle(); editor.body = '可恢复正文'
    editor.images = [{ fileId: 'uploaded', alt: '已上传说明' }]
    await editor.uploadFiles([new File(['x'], 'local.png', { type: 'image/png' })]); await settle()
    view.state.advanced(); expect(store.composerMode).toBe('quick')
    expect(await editor.save()).toBe(false); expect(communityApi.save).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(10000)
    expect(communityApi.saveDraft).toHaveBeenCalled(); expect(editor.dirty).toBe(true)
    const copy = JSON.parse(storage.get(key('owner-a'))!)
    expect(copy.pendingImages).toBe(true)
    expect(copy.input.contentBlocks).toEqual([{ type: 'paragraph', text: '可恢复正文' }, { type: 'image', fileId: 'uploaded', alt: '已上传说明' }])
    expect(storage.get(key('owner-a'))).not.toMatch(/blob:|local\.png|pixels/)
    store.composerOpen = false; editor.restoreLocal(key('owner-a')); await settle()
    expect(editor.pendingImages).toBe(0); expect(editor.imageNotice).toContain('重新选择')
    expect(editor.body).toBe('可恢复正文'); expect(editor.images).toEqual([{ fileId: 'uploaded', alt: '已上传说明' }])
    view.unmount()
  })
  it('关闭再打开同账号发布器，旧上传回调不能写进新草稿', async () => {
    const editor = useCommunityDraft(), store = useCommunityStore()
    store.openComposer(); await settle()
    const file = new File(['x'], 'one.png', { type: 'image/png' })
    await editor.uploadFiles([file])
    let done!: (row: { id: string }) => void
    vi.mocked(communityApi.upload).mockReturnValueOnce(new Promise((resolve) => { done = resolve }))
    const uploading = editor.saveEditedImage(editor.activeImage!.id, file, '旧图')
    const signal = vi.mocked(communityApi.upload).mock.calls[0]![1]!.signal
    editor.discard(); store.openComposer(); await settle(); editor.body = '新草稿'
    done({ id: 'late' }); expect(await uploading).toBe(false)
    expect(signal!.aborted).toBe(true); expect(editor.images).toEqual([]); expect(editor.body).toBe('新草稿')
  })
  it('已选择同一文件可以再次选择；批次中任一文件超限则明确拒绝整批', async () => {
    const editor = useCommunityDraft(), store = useCommunityStore()
    store.openComposer(); await settle()
    const file = new File(['x'], 'one.png', { type: 'image/png' })
    const target = { files: [file], value: 'one.png' }
    await editor.upload({ target } as unknown as Event); expect(target.value).toBe('')
    editor.cancelImage(editor.activeImage!.id); target.value = 'one.png'
    await editor.upload({ target } as unknown as Event); expect(editor.pendingImages).toBe(1)
    await editor.uploadFiles([file, new File(['bad'], 'file.gif', { type: 'image/gif' })])
    expect(editor.error).toContain('PNG'); expect(editor.pendingImages).toBe(1)
  })
  it('替代退出前立即保存最新输入，停止自动同步，原账号可恢复且不串号', async () => {
    const editor = useCommunityDraft(), store = useCommunityStore()
    store.openComposer(); await settle()
    editor.body = '刚输入尚未来得及自动保存的正文'; editor.form.title = '会话恢复标题'
    editor.preserveSession()
    expect(JSON.parse(storage.get(key('owner-a'))!).input.contentBlocks).toEqual([{ type: 'paragraph', text: '刚输入尚未来得及自动保存的正文' }])
    expect(JSON.parse(storage.get(key('owner-a'))!).unconfirmed).toBeUndefined()
    account.user = null; store.clear(); await settle(); await vi.advanceTimersByTimeAsync(12000)
    expect(communityApi.save).not.toHaveBeenCalled(); expect(communityApi.saveDraft).not.toHaveBeenCalled()
    account.user = { id: 'owner-b', communityWriteEnabled: true }; store.openComposer(); await settle()
    expect(editor.body).toBe(''); expect(storage.has(key('owner-b'))).toBe(false)
    store.clear(); account.user = { id: 'owner-a', communityWriteEnabled: true }; editor.restoreLocal(key('owner-a')); await settle()
    expect(editor.body).toBe('刚输入尚未来得及自动保存的正文'); expect(editor.savedAt).toContain('尚未同步')
  })
  it('关闭编辑器后草稿箱刷新，继续编辑使用最新封面及版本', async () => {
    const view = setupComponent<{ drafts: unknown[] }>(CommunityDraftsView)
    await settle()
    const store = useCommunityStore()
    store.openComposer({ title: '封面草稿', contentBlocks: [] })
    await settle()
    const updated = { id: 'draft', revision: 3, input: { coverFileId: 'new-cover', expectedRevision: 3 } }
    vi.mocked(communityApi.drafts).mockResolvedValueOnce([updated] as never)
    store.composerOpen = false
    await settle()
    expect(view.state.drafts).toEqual([updated])
    view.unmount()
  })
  it('普通图文草稿保留独立封面与原帖子类型，清除封面显式发送 null', async () => {
    const editor = useCommunityDraft(), store = useCommunityStore()
    store.openComposer({ type: 'general', status: 'draft', title: '普通图文', contentBlocks: [{ type: 'paragraph', text: '正文保持独立' }], coverFileId: 'own-cover' })
    await settle()
    expect(store.composerMode).toBe('rich')
    expect(await editor.save(true)).toBe(true)
    expect(communityApi.saveDraft).toHaveBeenLastCalledWith(expect.objectContaining({ type: 'general', coverFileId: 'own-cover' }), undefined, expect.any(String))
    expect(vi.mocked(communityApi.saveDraft).mock.calls[0][0].contribution).toBeUndefined()
    editor.form.coverFileId = null
    await editor.save(true)
    expect(communityApi.saveDraft).toHaveBeenLastCalledWith(expect.objectContaining({ coverFileId: null }), expect.any(String), expect.any(String))
  })
  it('图文复用真实发布：失败保稿、同键重试、待复核不声称公开', async () => {
    const editor = useCommunityDraft(), store = useCommunityStore()
    const blocks = [{ type: 'rich_text' as const, text: '<h2>实践记录</h2><p><strong>核心结论</strong></p>' }, { type: 'image' as const, fileId: 'owned-file', alt: '实验截图' }]
    store.openComposer({ title: '课程实践', contentBlocks: blocks, visibility: 'school', contribution: { kind: 'article', tags: [], teachingReuseConsent: false } })
    await settle()
    expect(store.composerMode).toBe('rich')
    expect(editor.blocks).toEqual(blocks)
    vi.mocked(communityApi.save).mockRejectedValueOnce(new ApiError('网络断开', 0)).mockResolvedValueOnce({ ...post, status: 'pending_review' })
    expect(await editor.save()).toBe(false)
    expect(store.composerOpen).toBe(true)
    expect(editor.blocks).toEqual(blocks)
    expect(JSON.parse(storage.get(key('owner-a', 'article'))!).input.contentBlocks).toEqual(blocks)
    expect(await editor.save()).toBe(true)
    const calls = vi.mocked(communityApi.save).mock.calls
    expect(calls[0][2]).toBe(calls[1][2])
    expect(calls[1][0]).toMatchObject({ visibility: 'school', contentBlocks: blocks, contribution: { kind: 'article' } })
    expect(storage.has(key('owner-a', 'article'))).toBe(false)
    expect(store.publishNotice?.text).toContain('尚未公开')
    expect(store.publishNotice?.text).not.toContain('发布成功')
  })
  it('图文输入错误不发送；草稿恢复不丢失格式、文件ID或覆盖可见范围', async () => {
    const editor = useCommunityDraft(), store = useCommunityStore()
    const blocks = [{ type: 'rich_text' as const, text: '<p>保留正文</p>' }]
    store.openComposer({ title: '图文草稿', status: 'draft', visibility: 'school', contentBlocks: blocks, expectedRevision: 2, contribution: { kind: 'article', tags: [], teachingReuseConsent: false } }, 'existing-draft')
    await settle()
    editor.richError = '图片未上传'
    expect(await editor.save()).toBe(false)
    expect(communityApi.save).not.toHaveBeenCalled()
    expect(editor.blocks).toEqual(blocks)
    editor.richError = ''
    await editor.save(true)
    expect(communityApi.saveDraft).toHaveBeenCalledWith(expect.objectContaining({ contentBlocks: blocks, visibility: 'school', expectedRevision: 2 }), 'existing-draft', expect.any(String))
  })
  it.each(['inline', 'quick-dialog', 'advanced-dialog'])('%s 冲突恢复控件位于实际编辑表单内，不被原生模态弹窗隔离', async (mode) => {
    const pinia = createPinia()
    setActivePinia(pinia)
    const router = createRouter({ history: createMemoryHistory(), routes: ['/community', '/community/drafts'].map((path) => ({ path, component: { render: () => null } })) })
    await router.push('/community')
    const store = useCommunityStore(), editor = useCommunityDraft()
    store.openComposer({ status: 'draft', contentBlocks: [{ type: 'paragraph', text: '冲突输入副本' }], expectedRevision: 1 }, 'conflicted-draft')
    store.composerMode = mode === 'advanced-dialog' ? 'advanced' : 'quick'
    store.composerInline = mode === 'inline'
    await settle(); editor.conflict = true
    const app = createSSRApp({ render: () => h('main', [mode === 'inline' ? h(CommunityQuickComposer) : null, h(CommunityComposer)]) })
    app.use(pinia); app.use(router)
    const context: SSRContext = {}, html = await renderToString(app, context)
    const dialogs = context.teleports?.body || ''
    const activeContainer = mode === 'inline' ? html : dialogs.match(/<dialog\b[^>]*\bcommunity-composer\b[\s\S]*?<\/dialog>/)?.[0] || ''
    const form = activeContainer.match(/<form\b[\s\S]*?<\/form>/)?.[0] || ''
    expect(form).toContain('role="alert"')
    expect(form).toContain('读取服务器版本'); expect(form).toContain('保留当前副本')
    expect((html + dialogs).match(/读取服务器版本/g)).toHaveLength(1)
    if (mode !== 'inline') expect(html).not.toContain('读取服务器版本')
    editor.keepCopy()
    expect(editor.body).toBe('冲突输入副本'); expect(editor.dirty).toBe(true)
    expect(store.editingId).toBeUndefined(); expect(editor.draftId).toBeUndefined(); expect(editor.form.expectedRevision).toBeUndefined()
    expect(editor.conflict).toBe(false)
  })
  it.each([400, 404])('已发布或删除的恢复草稿返回%s后保留错误和输入，由用户明确选择新副本', async (status) => {
    account.dataMode = 'api'
    const editor = useCommunityDraft(), store = useCommunityStore()
    store.openComposer({ status: 'draft', contentBlocks: [{ type: 'paragraph', text: '失效关联的私有输入' }], expectedRevision: 2 }, 'expired-draft')
    await settle()
    vi.mocked(communityApi.saveDraft).mockRejectedValueOnce(new ApiError('草稿不存在或无权操作', status))
    expect(await editor.save(true)).toBe(false)
    expect(editor.error).toBe('草稿不存在或无权操作'); expect(editor.draftUnavailable).toBe(true)
    expect(editor.body).toBe('失效关联的私有输入'); expect(editor.draftId).toBe('expired-draft')
    const feedback = await renderToString(createSSRApp(CommunityDraftConflict).use(getActivePinia()!))
    expect(feedback).toContain('另存为新副本，不会覆盖原内容'); expect(feedback).toContain('保留当前副本')
    expect(feedback).not.toContain('读取服务器版本')
    const oldKey = vi.mocked(communityApi.saveDraft).mock.calls[0][2]
    await vi.advanceTimersByTimeAsync(15000)
    expect(communityApi.saveDraft).toHaveBeenCalledTimes(1)
    expect(await editor.save(true)).toBe(false); expect(communityApi.saveDraft).toHaveBeenCalledTimes(1)
    editor.keepCopy()
    expect(editor.draftUnavailable).toBe(false); expect(editor.draftId).toBeUndefined(); expect(store.editingId).toBeUndefined()
    expect(editor.form.expectedRevision).toBeUndefined(); expect(editor.body).toBe('失效关联的私有输入')
    expect(await editor.save(true)).toBe(true)
    expect(communityApi.saveDraft).toHaveBeenLastCalledWith(expect.objectContaining({ contentBlocks: [{ type: 'paragraph', text: '失效关联的私有输入' }] }), undefined, expect.any(String))
    expect(vi.mocked(communityApi.saveDraft).mock.calls[1][2]).not.toBe(oldKey)
    expect(communityApi.save).not.toHaveBeenCalled()
  })
  it('普通400校验错误不能把既有草稿判为失效或切换成新副本', async () => {
    const editor = useCommunityDraft(), store = useCommunityStore()
    store.openComposer({ status: 'draft', contentBlocks: [{ type: 'paragraph', text: '等待修正的有效草稿' }], expectedRevision: 2 }, 'valid-draft')
    await settle()
    vi.mocked(communityApi.saveDraft).mockRejectedValueOnce(new ApiError('关联内容不存在、未发布或无权查看', 400))
    expect(await editor.save(true)).toBe(false)
    expect(editor.draftUnavailable).toBe(false); expect(editor.conflict).toBe(false); expect(editor.draftId).toBe('valid-draft')
    expect(editor.error).toBe('关联内容不存在、未发布或无权查看')
    expect(await editor.save(true)).toBe(true)
    expect(communityApi.saveDraft).toHaveBeenLastCalledWith(expect.anything(), 'valid-draft', expect.any(String))
  })
  it.each([[false, false], [true, false], [false, true], [true, true]])('创建响应丢失后修改正文，draft=%s普通HTTP=%s先确认旧键再更新同一真实ID', async (asDraft, http) => {
    if (http) { const source = globalThis.crypto; vi.stubGlobal('crypto', { getRandomValues: source.getRandomValues.bind(source) }); expect(crypto.randomUUID).toBeUndefined() }
    const editor = useCommunityDraft(), store = useCommunityStore()
    const api = asDraft ? vi.mocked(communityApi.saveDraft) : vi.mocked(communityApi.save)
    api.mockRejectedValueOnce(new ApiError('server committed; response lost', 0))
    api.mockResolvedValue({ ...post, id: 'committed-one', revision: 1 })
    store.openComposer(); await settle(); editor.body = '第一版已在服务器提交'; await settle()
    expect(await editor.save(asDraft)).toBe(false)
    const firstKey = api.mock.calls[0][2]
    expect(firstKey).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
    editor.body = '响应丢失后继续修改第二版'; await settle()
    expect(await editor.save(asDraft)).toBe(true)
    expect(api).toHaveBeenCalledTimes(3)
    expect(api.mock.calls[1][2]).toBe(firstKey)
    expect(api.mock.calls[1][0].contentBlocks).toEqual([{ type: 'paragraph', text: '第一版已在服务器提交' }])
    expect(api.mock.calls[2][1]).toBe('committed-one')
    expect(api.mock.calls[2][0]).toMatchObject({ expectedRevision: 1, contentBlocks: [{ type: 'paragraph', text: '响应丢失后继续修改第二版' }] })
    expect(api.mock.calls[2][2]).not.toBe(firstKey)
  })
  it.each([false, true])('延迟ACK期间继续输入，draft=%s不关闭编辑器且保留后续正文', async (asDraft) => {
    const editor = useCommunityDraft(), store = useCommunityStore()
    const api = asDraft ? vi.mocked(communityApi.saveDraft) : vi.mocked(communityApi.save)
    let acknowledge!: (row: CommunityPostDetailDto) => void
    api.mockReturnValueOnce(new Promise((resolve) => { acknowledge = resolve }))
    store.openComposer(); await settle(); editor.body = '已提交版本'; await settle()
    const saving = editor.save(asDraft); await settle()
    editor.body = '等待确认时新增的正文'; await settle()
    acknowledge({ ...post, id: 'ack-one', revision: 1 })
    expect(await saving).toBe(false)
    expect(editor.body).toBe('等待确认时新增的正文'); expect(editor.dirty).toBe(true); expect(store.composerOpen).toBe(true)
    expect(asDraft ? editor.draftId : store.editingId).toBe('ack-one')
    expect(editor.form.expectedRevision).toBe(1)
    expect(storage.get(key('owner-a'))).toContain('等待确认时新增的正文')
    await editor.save(asDraft)
    expect(api.mock.calls[1][1]).toBe('ack-one')
  })
  it.each([false, true])('重放未ACK请求期间继续输入，draft=%s先确认再按同ID提交新正文', async (asDraft) => {
    const editor = useCommunityDraft(), store = useCommunityStore()
    const api = asDraft ? vi.mocked(communityApi.saveDraft) : vi.mocked(communityApi.save)
    api.mockRejectedValueOnce(new ApiError('response lost', 0))
    store.openComposer(); await settle(); editor.body = '旧提交正文'; await settle()
    expect(await editor.save(asDraft)).toBe(false)
    let acknowledge!: (row: CommunityPostDetailDto) => void
    api.mockReturnValueOnce(new Promise((resolve) => { acknowledge = resolve }))
    const saving = editor.save(asDraft); await settle()
    editor.body = '重放等待期间的新正文'; await settle()
    acknowledge({ ...post, id: 'replayed-one', revision: 1 })
    expect(await saving).toBe(true)
    expect(api).toHaveBeenCalledTimes(3)
    expect(api.mock.calls[2][1]).toBe('replayed-one')
    expect(api.mock.calls[2][0].contentBlocks).toEqual([{ type: 'paragraph', text: '重放等待期间的新正文' }])
  })
  it.each(['post-b', 'post-a'])('同账号关闭再开%s，旧服务端读取不能跨编辑会话覆盖', async (target) => {
    const editor = useCommunityDraft(), store = useCommunityStore()
    store.openComposer({ contentBlocks: [{ type: 'paragraph', text: '旧会话' }] }, 'post-a'); await settle()
    let resolve!: (post: CommunityPostDetailDto) => void
    vi.mocked(communityApi.post).mockReturnValueOnce(new Promise((done) => { resolve = done }))
    const reading = editor.readServer()
    editor.discard(); store.openComposer({ contentBlocks: [{ type: 'paragraph', text: '新会话正在输入' }] }, target); await settle()
    resolve({ ...post, contentBlocks: [{ type: 'paragraph', text: '迟到旧版本' }], bindings: [], visibility: 'public' })
    await reading
    expect(editor.body).toBe('新会话正在输入'); expect(store.editingId).toBe(target)
  })
  it('存储拒绝不阻断真实保存，成功后的同文新发布使用新幂等键', async () => {
    const editor = useCommunityDraft(), store = useCommunityStore()
    vi.stubGlobal('localStorage', { get length() { return storage.size }, key: (i: number) => Array.from(storage.keys())[i] ?? null, getItem: () => null, setItem: () => { throw new Error('quota') }, removeItem: () => { throw new Error('storage disabled') } })
    store.openComposer(); await settle(); editor.body = '同文两次独立发布'; await settle()
    expect(await editor.save()).toBe(true)
    const first = vi.mocked(communityApi.save).mock.calls[0][2]
    store.openComposer(); await settle(); editor.body = '同文两次独立发布'; await settle()
    expect(await editor.save()).toBe(true)
    expect(vi.mocked(communityApi.save).mock.calls[1][2]).not.toBe(first)
    expect(editor.error).toBe('')
  })
  it('丢失响应保留幂等键重试，409保留输入并提供服务器版本恢复', async () => {
    account.dataMode = 'api'
    const editor = useCommunityDraft(), store = useCommunityStore()
    store.openComposer(); await settle(); editor.body = '不可丢失正文'; await settle()
    vi.mocked(communityApi.save).mockRejectedValueOnce(new ApiError('response lost', 0))
    expect(await editor.save()).toBe(false)
    const key = vi.mocked(communityApi.save).mock.calls[0][2]
    expect(editor.savedAt).toBe('尚未同步到服务器')
    expect(await editor.save()).toBe(true)
    expect(vi.mocked(communityApi.save).mock.calls[1][2]).toBe(key)
    store.openComposer({ contentBlocks: [{ type: 'paragraph', text: '本机未覆盖内容' }], expectedRevision: 1 }, 'existing')
    await settle()
    vi.mocked(communityApi.save).mockRejectedValueOnce(new ApiError('版本冲突', 409))
    expect(await editor.save()).toBe(false); expect(editor.conflict).toBe(true); expect(editor.body).toBe('本机未覆盖内容')
    const attempts = vi.mocked(communityApi.save).mock.calls.length
    expect(await editor.save()).toBe(false); expect(editor.conflict).toBe(true); expect(communityApi.save).toHaveBeenCalledTimes(attempts)
    vi.mocked(communityApi.post).mockResolvedValue({ ...post, revision: 2, contentBlocks: [{ type: 'paragraph', text: '服务器版本' }], bindings: [], topics: [], visibility: 'public' })
    await editor.readServer(); expect(editor.body).toBe('服务器版本'); expect(editor.form.expectedRevision).toBe(2); expect(editor.conflict).toBe(false)
  })
  it('服务端版本迟到响应在切号后不得写入新账号恢复快照', async () => {
    const editor = useCommunityDraft(), store = useCommunityStore()
    store.openComposer({ contentBlocks: [{ type: 'paragraph', text: 'A私有草稿' }], status: 'draft' }, 'private-a')
    await settle()
    let resolve!: (post: CommunityPostDetailDto) => void
    vi.mocked(communityApi.post).mockReturnValue(new Promise((done) => { resolve = done }))
    const reading = editor.readServer()
    store.clear(); account.user = { id: 'owner-b' }; await settle()
    resolve({ ...post, contentBlocks: [{ type: 'paragraph', text: 'A私有服务器版本' }], bindings: [], visibility: 'public' })
    await reading
    expect(editor.body).toBe(''); expect(editor.savedAt).toBe(''); expect(storage.has(key('owner-b'))).toBe(false)
  })
  it('首次空提交失败后补正文可以重试，Promise不被永久缓存', async () => {
    const editor = useCommunityDraft(), store = useCommunityStore()
    store.openComposer(); await settle()
    expect(await editor.save()).toBe(false)
    expect(editor.error).toContain('正文')
    editor.body = '第二次填写的有效正文'; await settle()
    expect(await editor.save()).toBe(true)
    expect(communityApi.save).toHaveBeenCalledTimes(1)
    expect(vi.mocked(communityApi.save).mock.calls[0][0].contentBlocks).toEqual([{ type: 'paragraph', text: '第二次填写的有效正文' }])
    expect(editor.body).toBe(''); expect(store.composerOpen).toBe(false)
  })
  it('快捷高级编辑打开写图文并保留正文、图片和发布参数', async () => {
    const view = setupComponent<{ advanced: () => void }>(CommunityQuickComposer)
    const editor = useCommunityDraft(), store = useCommunityStore()
    store.openComposer({ type: 'note', title: '学习笔记', visibility: 'school' }); store.composerInline = true; await settle()
    editor.body = '切换编辑模式不丢内容'; editor.images = [{ fileId: 'image-a', alt: '学习图片' }]
    editor.form.bindings = [{ type: 'course', id: 'course-a' }]; editor.form.topicIds = ['topic-a']
    view.state.advanced(); await settle()
    expect(store.composerMode).toBe('rich'); expect(store.composerInline).toBe(false)
    expect(useCommunityDraft()).toBe(editor)
    expect(editor.richBlocks).toEqual([{ type: 'paragraph', text: '切换编辑模式不丢内容' }, { type: 'image', fileId: 'image-a', alt: '学习图片' }])
    await editor.save()
    expect(communityApi.save).toHaveBeenCalledWith(expect.objectContaining({ type: 'note', title: '学习笔记', visibility: 'school', bindings: [{ type: 'course', id: 'course-a' }], topicIds: ['topic-a'], contentBlocks: [{ type: 'paragraph', text: '切换编辑模式不丢内容' }, { type: 'image', fileId: 'image-a', alt: '学习图片' }] }), undefined, expect.any(String))
    view.unmount()
  })
  it('切号取消待保存定时器，保留前账号已保存稿且不写后账号', async () => {
    const editor = useCommunityDraft(), store = useCommunityStore()
    store.openComposer(); await settle(); editor.body = '已保存给A'; await settle()
    await vi.advanceTimersByTimeAsync(2001)
    const saved = storage.get(key('owner-a'))
    expect(saved).toContain('已保存给A')
    editor.body = '尚未落盘的A内容'; await settle()
    store.clear(); account.user = { id: 'owner-b' }; await settle()
    await vi.advanceTimersByTimeAsync(11000)
    expect(storage.get(key('owner-a'))).toBe(saved)
    expect(storage.has(key('owner-b'))).toBe(false); expect(storage.has(key('anonymous'))).toBe(false)
    expect(editor.body).toBe(''); expect(communityApi.saveDraft).not.toHaveBeenCalled()
  })
  it('迟到上传和关联响应不能注入另一账号', async () => {
    const editor = useCommunityDraft(), store = useCommunityStore()
    let uploadDone!: (row: { id: string }) => void, bindingDone!: (row: Awaited<ReturnType<typeof communityApi.bindingContext>>) => void
    vi.mocked(communityApi.upload).mockReturnValue(new Promise((resolve) => { uploadDone = resolve }))
    vi.mocked(communityApi.bindingContext).mockReturnValue(new Promise((resolve) => { bindingDone = resolve }))
    store.openComposer(); await settle()
    editor.bindingId = 'course-a'
    const binding = editor.addBinding(), file = new File(['test'], 'one.png', { type: 'image/png' })
    await editor.uploadFiles([file])
    const upload = editor.saveEditedImage(editor.activeImage!.id, file, '学习图片')
    store.clear(); account.user = { id: 'owner-b' }; await settle()
    bindingDone({ binding: { title: '前账号课程' }, topicIds: ['old-topic'] } as Awaited<ReturnType<typeof communityApi.bindingContext>>); uploadDone({ id: 'old-image' })
    await Promise.all([binding, upload])
    expect(editor.images).toEqual([]); expect(editor.form.bindings).toEqual([]); expect(editor.form.topicIds).toEqual([])
  })
  it('迟到保存不得清除后账号内容、草稿或保存状态', async () => {
    const editor = useCommunityDraft(), store = useCommunityStore()
    let oldDone!: (row: CommunityPostDetailDto) => void
    vi.mocked(communityApi.saveDraft).mockReturnValueOnce(new Promise((resolve) => { oldDone = resolve }))
    store.openComposer(); await settle(); editor.body = '账号A'; await settle()
    const oldSave = editor.save(true); await settle()
    store.clear(); account.user = { id: 'owner-b' }; store.openComposer(); await settle()
    editor.body = '账号B'; await settle()
    expect(await editor.save(true)).toBe(true)
    oldDone({ id: 'draft-a' } as CommunityPostDetailDto)
    expect(await oldSave).toBe(false)
    expect(editor.body).toBe('账号B'); expect(editor.draftId).toBe('server-draft')
    expect(storage.get(key('owner-b'))).toContain('账号B')
  })
  it('已打开A时打开B会明确拦截，关闭后正文和目标一起切换', async () => {
    const editor = useCommunityDraft(), store = useCommunityStore()
    store.openComposer({ contentBlocks: [{ type: 'paragraph', text: '正文A' }] }, 'post-a'); await settle()
    store.openComposer({ contentBlocks: [{ type: 'paragraph', text: '正文B' }] }, 'post-b'); await settle()
    expect(store.editingId).toBe('post-a'); expect(editor.body).toBe('正文A'); expect(editor.closePrompt).toBe(true); expect(store.composerRequest?.id).toBe('post-b')
    editor.discard()
    store.openComposer({ contentBlocks: [{ type: 'paragraph', text: '正文B' }] }, 'post-b'); await settle()
    expect(store.editingId).toBe('post-b'); expect(editor.body).toBe('正文B')
  })
  it('已发布内容的本地编辑稿恢复时保留编辑目标，不新建重复帖子', async () => {
    const editor = useCommunityDraft(), store = useCommunityStore()
    store.openComposer({ contentBlocks: [{ type: 'paragraph', text: '旧正文' }] }, 'original-id'); await settle()
    editor.body = '恢复后应编辑原帖'; await settle(); await editor.save(true)
    store.composerOpen = false; store.editingId = undefined
    editor.restoreLocal(key('owner-a', 'edit:original-id')); await settle()
    expect(store.editingId).toBe('original-id'); expect(editor.body).toBe('恢复后应编辑原帖')
    await editor.save()
    expect(communityApi.save).toHaveBeenLastCalledWith(expect.anything(), 'original-id', expect.any(String))
  })
  it('侧栏首次打开和再次聚焦不滚动可见编辑区，完全离开视口才移动中栏', async () => {
    const scroll = vi.fn(), focus = vi.fn()
    const root = ref({ scrollTop: 300, scrollTo: scroll, getBoundingClientRect: () => ({ top: 0, bottom: 600 }) })
    const view = setupComponent<{ panel: HTMLElement }>(CommunityQuickComposer, {}, undefined, [[communityScrollRoot, root]])
    let bounds = { top: 150, bottom: 450 }
    view.state.panel = { getBoundingClientRect: () => bounds, querySelector: () => ({ focus }) } as unknown as HTMLElement
    const store = useCommunityStore()
    store.openComposer(); store.composerInline = true; await settle()
    expect(scroll).not.toHaveBeenCalled(); expect(focus).toHaveBeenCalledOnce()
    store.openComposer(); await settle()
    expect(scroll).not.toHaveBeenCalled(); expect(focus).toHaveBeenCalledTimes(2)
    bounds = { top: -500, bottom: -100 }
    store.openComposer(); await settle()
    expect(scroll).toHaveBeenCalledWith({ top: -320, behavior: 'smooth' }); expect(focus).toHaveBeenCalledTimes(3)
    view.unmount()
  })
  it('普通快捷打开不读取话题或学习目录，切换类型保留正文且空稿不写服务端', async () => {
    const view = setupComponent<{ open: (type: 'note' | 'question') => void }>(CommunityQuickComposer)
    const editor = useCommunityDraft(), store = useCommunityStore()
    store.openComposer(); store.composerInline = true; await settle()
    expect(communityApi.topics).not.toHaveBeenCalled(); expect(communityApi.bindingContext).not.toHaveBeenCalled()
    view.state.open('question'); await settle(); await vi.advanceTimersByTimeAsync(15000)
    expect(communityApi.saveDraft).not.toHaveBeenCalled()
    editor.body = '类型切换保留的正文'; await settle(); view.state.open('note'); await settle()
    expect(editor.body).toBe('类型切换保留的正文'); expect(editor.form.type).toBe('note')
    await vi.advanceTimersByTimeAsync(2000)
    expect(editor.savedAt).toBe('本地演示草稿已保存'); expect(communityApi.saveDraft).not.toHaveBeenCalled()
    await editor.loadTopics(); expect(communityApi.topics).toHaveBeenCalledOnce()
    view.unmount()
  })
  it('快捷顶部只保留内容类型和关闭按钮，且不覆盖可见范围', async () => {
    const pinia = getActivePinia()!
    const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/community', component: { render: () => null } }] })
    await router.push('/community')
    const editor = useCommunityDraft(), store = useCommunityStore()
    store.openComposer({ visibility: 'school' }); store.composerInline = true; await settle()
    const app = createSSRApp(CommunityQuickComposer)
    app.use(pinia); app.use(router)
    const html = await renderToString(app)
    expect(html).toContain('aria-label="发布内容类型"')
    expect(html).toContain('aria-label="收起快捷发布"')
    expect(html).not.toContain('aria-label="可见范围"')
    expect(html).not.toContain('登录社区用户')
    expect(html).not.toContain('仅同校用户')
    expect(editor.form.visibility).toBe('school')
    editor.discard(); store.openComposer(); await settle()
    expect(editor.form.visibility).toBe('public')
  })
  it('首屏直接展示投稿检测结果，不依赖滚动且不误报已发布', async () => {
    const pinia = getActivePinia()!
    const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/community', component: { render: () => null } }] })
    await router.push('/community')
    const store = useCommunityStore()
    const root = ref({ scrollTop: 0, scrollHeight: 1400, clientHeight: 400 } as HTMLElement)
    for (const text of ['内容已保存，等待人工复核，尚未公开。', '发布成功。提醒：请确认资源授权']) {
      store.publishNotice = { id: 'synthetic-result', text }
      const app = createSSRApp(CommunityComposer)
      app.use(pinia); app.use(router); app.provide(communityScrollRoot, root)
      const html = await renderToString(app)
      expect(html).toContain(`<span>${text}</span>`)
      expect(html).toContain('role="status"')
      expect(html).toContain('/community/post/synthetic-result')
      expect(html).not.toContain('community-publish-feedback')
      expect(html).not.toContain('<strong>已发布</strong>')
    }
  })
  it('返回顶部胶囊展示三位真实社区用户并返回主滚动区顶部', async () => {
    const pinia = getActivePinia()!
    const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/community', component: { render: () => null } }] })
    await router.push('/community')
    const users: CommunityAuthorDto[] = ['林宇', '周楠', '陈曦'].map((displayName, index) => ({ id: `user-${index}`, username: `user-${index}`, displayName, avatar: null, school: null, major: null, verifiedType: 'none' }))
    const store = useCommunityStore()
    store.context = { todayPlan: null, continueCourse: null, continueLab: null, currentChallenge: null, trendingTopics: [], suggestedUsers: users, needsInterests: false }
    const scrollTo = vi.fn(), scrollElement = Object.assign(new EventTarget(), { scrollTop: 251, scrollHeight: 1400, clientHeight: 400, scrollTo })
    const root = ref(scrollElement as unknown as HTMLElement)
    const view = setupComponent<{ backToTop: () => void; updateBackToTop: () => void; showBackToTop: boolean }>(CommunityComposer, {}, [pinia, router], [[communityScrollRoot, root]])
    view.state.updateBackToTop()
    expect(view.state.showBackToTop).toBe(true)
    scrollElement.scrollTop = 250; view.state.updateBackToTop()
    expect(view.state.showBackToTop).toBe(false)
    scrollElement.scrollTop = 251; view.state.updateBackToTop()
    view.state.backToTop()
    expect(scrollTo).toHaveBeenCalledWith({ top: 0, behavior: 'smooth' })
    const app = createSSRApp(CommunityComposer)
    app.use(pinia); app.use(router); app.provide(communityScrollRoot, root)
    const html = await renderToString(app)
    expect(html).toContain('community-publish-feedback')
    expect(html).toContain('已发布')
    expect(html.match(/avatar-xs/g)).toHaveLength(3)
    expect(html).not.toContain('查看动态')
    expect(html).not.toContain('关闭发布提示')
    view.unmount()
  })
  it('普通浏览超过四分之一时显示返回顶部控件', async () => {
    const pinia = getActivePinia()!
    const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/community', component: { render: () => null } }] })
    await router.push('/community')
    expect(useCommunityStore().publishNotice).toBeNull()
    const root = ref({ scrollTop: 251, scrollHeight: 1400, clientHeight: 400, scrollTo: vi.fn() } as unknown as HTMLElement)
    const app = createSSRApp(CommunityComposer)
    app.use(pinia); app.use(router); app.provide(communityScrollRoot, root)
    expect(await renderToString(app)).toContain('community-publish-feedback')
  })
  it('首次登录从欢迎页进入社区后绑定后创建的滚动根节点', async () => {
    const pinia = getActivePinia()!
    const router = createRouter({ history: createMemoryHistory(), routes: ['/welcome', '/community'].map((path) => ({ path, component: { render: () => null } })) })
    await router.push('/welcome')
    let main: HTMLElement | null = null
    vi.stubGlobal('document', { querySelector: vi.fn(() => main) })
    const scrollElement = Object.assign(new EventTarget(), { scrollTop: 251, scrollHeight: 1400, clientHeight: 400, scrollTo: vi.fn() })
    router.afterEach(() => { void nextTick(() => { main = scrollElement as unknown as HTMLElement }) })
    const view = setupComponent<{ showBackToTop: boolean }>(CommunityComposer, {}, [pinia, router])
    await router.push('/community'); await settle()
    scrollElement.dispatchEvent(new Event('scroll'))
    expect(view.state.showBackToTop).toBe(true)
    view.unmount()
  })
  it('清空已暂存文字不会恢复旧正文，也不额外创建空服务端草稿', async () => {
    const editor = useCommunityDraft(), store = useCommunityStore()
    store.openComposer(); await settle(); editor.body = '待清空的本地正文'; await settle()
    await vi.advanceTimersByTimeAsync(2000); expect(storage.get(key('owner-a'))).toContain('待清空')
    editor.body = ''; await settle(); await editor.saveAndClose()
    expect(communityApi.saveDraft).not.toHaveBeenCalled(); expect(storage.has(key('owner-a'))).toBe(false)
    store.openComposer(); await settle(); expect(editor.body).toBe('')
  })
})

describe('发布器到草稿箱的真实路由生命周期', () => {
  const views: Array<{ unmount: () => void }> = []
  afterEach(() => { for (const view of views.splice(0).reverse()) view.unmount() })
  const setupNavigation = async (initial = '/community', mode: 'quick' | 'advanced' = 'quick') => {
    const pinia = createPinia(), router = createRouter({ history: createMemoryHistory(), routes: ['/community', '/community/drafts', '/welcome'].map((path) => ({ path, component: { render: () => null } })) })
    setActivePinia(pinia)
    await router.push(initial)
    const composer = setupComponent<{ finish: (save: boolean) => Promise<void>; cancel: () => void }>(CommunityComposer, {}, [pinia, router])
    const link = setupComponent<{ navigate: (event: MouseEvent) => Promise<unknown> }>({ setup: () => useLink({ to: '/community/drafts' }) }, {}, [pinia, router])
    views.push(composer, link)
    const editor = useCommunityDraft(), store = useCommunityStore()
    store.openComposer(); store.composerMode = mode; store.composerInline = false
    await settle()
    const clickDrafts = () => link.state.navigate(new Event('click', { cancelable: true }) as MouseEvent)
    return { router, editor, store, composer: composer.state, clickDrafts }
  }
  it.each(['quick', 'advanced'] as const)('%s 已保存草稿点击链接后到达草稿箱并关闭全局面板', async (mode) => {
    const { router, editor, store, composer, clickDrafts } = await setupNavigation('/community', mode)
    editor.body = '保留同一条草稿'; await settle(); expect(await editor.save(true)).toBe(true)
    await clickDrafts(); await settle()
    expect(editor.closePrompt).toBe(true); expect(router.currentRoute.value.path).toBe('/community')
    await composer.finish(true); for (let i = 0; i < 10; i++) await settle()
    expect(router.currentRoute.value.path).toBe('/community/drafts')
    expect(store.composerOpen).toBe(false); expect(editor.closePrompt).toBe(false)
    expect(editor.draftId).toBe('server-draft'); expect(storage.get(key('owner-a'))).toContain('保留同一条草稿')
    expect(communityApi.saveDraft).toHaveBeenCalledTimes(2)
  })
  it('未保存选择继续编辑取消导航，后续关闭也不会恢复被取消的跳转', async () => {
    const { router, editor, store, composer, clickDrafts } = await setupNavigation()
    editor.body = '取消后仍在原稿'; await settle()
    expect(isNavigationFailure(await clickDrafts(), NavigationFailureType.aborted)).toBe(true)
    expect(editor.closePrompt).toBe(true); composer.cancel(); await settle()
    expect(router.currentRoute.value.path).toBe('/community'); expect(store.composerOpen).toBe(true)
    expect(editor.body).toBe('取消后仍在原稿'); expect(editor.dirty).toBe(true)
    expect(communityApi.saveDraft).not.toHaveBeenCalled()
    editor.close(); await composer.finish(true); await settle()
    expect(router.currentRoute.value.path).toBe('/community'); expect(store.composerOpen).toBe(false)
  })
  it.each([true, false])('未保存选择保存=%s后才允许导航并关闭，保存失败不丢稿', async (save) => {
    const { router, editor, store, composer, clickDrafts } = await setupNavigation()
    editor.body = '三选决定之前保留内容'; await settle(); await clickDrafts()
    expect(router.currentRoute.value.path).toBe('/community'); expect(store.composerOpen).toBe(true)
    if (save) {
      vi.mocked(communityApi.saveDraft).mockRejectedValueOnce(new Error('隔离保存失败'))
      await composer.finish(true); await settle()
      expect(router.currentRoute.value.path).toBe('/community'); expect(store.composerOpen).toBe(true)
      expect(editor.closePrompt).toBe(true); expect(editor.body).toBe('三选决定之前保留内容')
    }
    await composer.finish(save)
    for (let i = 0; i < 10; i++) await settle()
    expect(router.currentRoute.value.path).toBe('/community/drafts'); expect(store.composerOpen).toBe(false)
    expect(editor.closePrompt).toBe(false)
    expect(storage.has(key('owner-a'))).toBe(save)
  })
  it('已在草稿箱的重复导航仍关闭已保存稿，未保存稿则确认后再关闭', async () => {
    const { router, editor, store, composer, clickDrafts } = await setupNavigation('/community/drafts')
    editor.body = '同路由已保存稿'; await settle(); await editor.save(true)
    expect(isNavigationFailure(await clickDrafts(), NavigationFailureType.duplicated)).toBe(true)
    expect(editor.closePrompt).toBe(true); await composer.finish(true); await settle()
    expect(store.composerOpen).toBe(false); expect(editor.draftId).toBe('server-draft')
    editor.restoreLocal(key('owner-a')); await settle(); editor.body = '同路由尚未保存的修改'; await settle()
    await clickDrafts(); expect(editor.closePrompt).toBe(true); expect(store.composerOpen).toBe(true)
    composer.cancel(); expect(editor.body).toBe('同路由尚未保存的修改')
    expect(router.currentRoute.value.path).toBe('/community/drafts'); expect(store.composerOpen).toBe(true)
    await clickDrafts(); await composer.finish(true); await settle()
    expect(store.composerOpen).toBe(false); expect(router.currentRoute.value.path).toBe('/community/drafts')
    expect(editor.draftId).toBe('server-draft')
    expect(communityApi.saveDraft).toHaveBeenLastCalledWith(expect.anything(), 'server-draft', expect.any(String))
  })
  it('其他守卫取消目标导航时保留已保存的全局编辑面板', async () => {
    const { router, editor, store, clickDrafts } = await setupNavigation()
    editor.body = '其他守卫取消也不关闭'; await settle(); await editor.save(true)
    const remove = router.beforeEach(() => false)
    expect(isNavigationFailure(await clickDrafts(), NavigationFailureType.aborted)).toBe(true)
    expect(router.currentRoute.value.path).toBe('/community'); expect(store.composerOpen).toBe(true)
    expect(editor.body).toBe('其他守卫取消也不关闭'); expect(editor.closePrompt).toBe(true)
    remove()
  })
  it.each(['video', 'article', 'document', 'quote'] as const)('空编辑器直接进入 %s，不恢复其他意图的本地草稿', async (kind) => {
    const { editor, store } = await setupNavigation()
    storage.set(key('owner-a'), JSON.stringify({ input: { ...editor.form, contentBlocks: [{ type: 'paragraph', text: '旧社区草稿' }] } }))
    store.openComposer(kind === 'quote' ? { quotedPostId: 'quoted-target' } : { contribution: { kind, tags: [], teachingReuseConsent: false } })
    await settle()
    expect(editor.closePrompt).toBe(false); expect(editor.body).toBe('')
    expect(kind === 'quote' ? editor.form.quotedPostId : editor.form.contribution?.kind).toBe(kind === 'quote' ? 'quoted-target' : kind); expect(store.composerIntent).toBe(kind)
    expect(store.composerInline).toBe(false); expect(store.composerMode).toBe(kind === 'article' ? 'rich' : kind === 'quote' ? 'quick' : 'advanced')
    expect(editor.hasWork).toBe(kind === 'quote'); expect(communityApi.saveDraft).not.toHaveBeenCalled()
    expect(editor.localCopies()).toHaveLength(1)
  })
  it.each(['video', 'article', 'document', 'quote'] as const)('所有非空状态切换 %s 必须确认，保存后自动执行最新目标', async (kind) => {
    const { editor, store, composer } = await setupNavigation()
    for (const state of ['unsaved', 'autosaved', 'image-edit', 'upload', 'public-edit']) {
      if (store.composerOpen) editor.discard()
      store.openComposer(undefined, state === 'public-edit' ? 'original-public' : undefined)
      await settle(); editor.body = `保留-${state}`; await settle()
      if (state === 'autosaved') { await editor.save(true); expect(editor.dirty).toBe(false) }
      if (state === 'image-edit') await editor.uploadFiles([new File(['x'], 'edit.png', { type: 'image/png' })])
      const cancel = vi.fn(), release = state === 'upload' ? editor.registerUpload(cancel) : () => {}
      expect(editor.hasWork, JSON.stringify({ before: state, kind, body: editor.body, blocks: editor.blocks, form: editor.form, mode: store.composerMode })).toBe(true)
      const oldSession = store.composerSession
      store.openComposer(kind === 'quote' ? { quotedPostId: 'quoted-target' } : { contribution: { kind, tags: [], teachingReuseConsent: false } })
      await settle()
      expect(editor.closePrompt, JSON.stringify({ state, mode: store.composerMode, body: editor.body, blocks: editor.blocks, saving: editor.saving, request: store.composerRequest })).toBe(true); expect(store.composerSession).toBe(oldSession)
      expect(editor.body).toBe(`保留-${state}`)
      composer.cancel(); expect(editor.body).toBe(`保留-${state}`); expect(store.composerOpen).toBe(true)
      store.openComposer(kind === 'quote' ? { quotedPostId: 'quoted-target' } : { contribution: { kind, tags: [], teachingReuseConsent: false } })
      const count = vi.mocked(communityApi.saveDraft).mock.calls.length
      await composer.finish(true); await settle()
      if (state === 'upload') expect(cancel).toHaveBeenCalledOnce()
      if (state === 'public-edit') expect(vi.mocked(communityApi.saveDraft).mock.calls.length).toBe(count)
      expect(store.composerOpen).toBe(true); expect(editor.closePrompt).toBe(false)
      expect(kind === 'quote' ? editor.form.quotedPostId : editor.form.contribution?.kind).toBe(kind === 'quote' ? 'quoted-target' : kind); expect(editor.body).toBe('')
      expect(editor.pendingImages).toBe(0); expect(editor.pendingUploads).toBe(0); expect(store.editingId).toBeUndefined()
      release()
    }
  })
  it('快速连续目标只保留最后一个，revision 冲突保稿，放弃后才切换', async () => {
    const { editor, store, composer } = await setupNavigation()
    editor.body = '发生冲突的当前稿'; await settle()
    for (const kind of ['video', 'article', 'document'] as const) store.openComposer(kind === 'quote' ? { quotedPostId: 'quoted-target' } : { contribution: { kind, tags: [], teachingReuseConsent: false } })
    vi.mocked(communityApi.saveDraft).mockRejectedValueOnce(new ApiError('revision 冲突', 409))
    await composer.finish(true)
    expect(editor.body).toBe('发生冲突的当前稿'); expect(editor.closePrompt).toBe(true); expect(editor.conflict).toBe(true)
    expect(store.composerRequest?.intent).toBe('document')
    await composer.finish(false)
    expect(editor.form.contribution?.kind).toBe('document'); expect(editor.conflict).toBe(false)
  })
  it('确认保存期间返回编辑，迟到成功不能自动关闭或执行已取消的目标', async () => {
    const { editor, store, composer } = await setupNavigation()
    editor.body = '保存期间取消切换'; await settle()
    let resolve!: (value: CommunityPostDetailDto) => void
    vi.mocked(communityApi.saveDraft).mockReturnValueOnce(new Promise((done) => { resolve = done }))
    store.openComposer({ contribution: { kind: 'article', tags: [], teachingReuseConsent: false } })
    const saving = composer.finish(true); await settle(); composer.cancel()
    resolve({ ...post, id: 'safe-draft', revision: 1 }); await saving
    expect(store.composerOpen).toBe(true); expect(store.composerIntent).toBe('post')
    expect(editor.body).toBe('保存期间取消切换'); expect(editor.draftId).toBe('safe-draft')
  })
})
