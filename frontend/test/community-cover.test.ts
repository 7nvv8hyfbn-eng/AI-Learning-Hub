import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import CommunityCoverField from '../src/community/CommunityCoverField.vue'
import { communityApi } from '../src/services/api/community'
import { flushRender, setupComponent } from '../src/community/test-renderer'

const state = vi.hoisted(() => ({ editor: { form: {}, saving: false, pendingUploads: 0, registerUpload: vi.fn() }, auth: { user: { id: 'owner' } }, store: { epoch: 1, composerSession: 1, composerOpen: true }, allowed: true }))
vi.mock('../src/community/composables/useCommunityDraft', () => ({ useCommunityDraft: () => state.editor }))
vi.mock('../src/community/composables/useCommunityAccess', () => ({ useCommunityAccess: () => ({ requireWrite: () => state.allowed, decision: () => ({ allowed: state.allowed }) }) }))
vi.mock('../src/stores/auth', () => ({ useAuthStore: () => state.auth }))
vi.mock('../src/stores/community', () => ({ useCommunityStore: () => state.store }))
vi.mock('../src/services/api/community', () => ({ communityApi: { upload: vi.fn(), image: vi.fn() } }))
interface Field { choose(event: Event): Promise<void>; remove(): void; preview: string; error: string }
const event = () => ({ target: { files: [new File(['cover'], 'cover.png', { type: 'image/png' })], value: 'cover.png' } }) as unknown as Event
beforeEach(() => {
  vi.resetAllMocks()
  state.editor.registerUpload.mockImplementation(() => { state.editor.pendingUploads++; let done = false; return () => { if (!done) state.editor.pendingUploads--; done = true } });
  Object.assign(state.editor, { form: {}, saving: false, pendingUploads: 0 }); state.auth.user.id = 'owner'; state.store.epoch = 1; state.allowed = true
  vi.mocked(communityApi.image).mockResolvedValue('blob:old-cover')
})
afterEach(() => vi.restoreAllMocks())

describe('共用封面选择器', () => {
  it('上传成功替换独立封面，上传中禁止保存与移除；卸载释放预览', async () => {
    const revoke = vi.spyOn(URL, 'revokeObjectURL'), update = vi.fn()
    let finish!: (value: { id: string }) => void
    vi.mocked(communityApi.upload).mockImplementation(() => new Promise((resolve) => { finish = resolve }))
    const field = setupComponent<Field>(CommunityCoverField, { modelValue: 'old', 'onUpdate:modelValue': update })
    await flushRender(); expect(field.state.preview).toBe('blob:old-cover')
    const pending = field.state.choose(event())
    expect(state.editor.saving).toBe(false); expect(state.editor.pendingUploads).toBe(1)
    field.state.remove(); expect(update).not.toHaveBeenCalled()
    finish({ id: 'new-cover' }); await pending
    expect(update).toHaveBeenCalledWith('new-cover'); expect(state.editor.saving).toBe(false)
    field.state.remove(); expect(update).toHaveBeenLastCalledWith(undefined)
    field.unmount(); expect(revoke).toHaveBeenCalledWith('blob:old-cover')
  })
  it('上传失败保留原封面，权限拒绝不发请求', async () => {
    const update = vi.fn(), field = setupComponent<Field>(CommunityCoverField, { modelValue: 'old', 'onUpdate:modelValue': update })
    await flushRender()
    vi.mocked(communityApi.upload).mockRejectedValue(new Error('图片超过 5MB'))
    await field.state.choose(event())
    expect(field.state.error).toBe('图片超过 5MB'); expect(field.state.preview).toBe('blob:old-cover'); expect(update).not.toHaveBeenCalled()
    state.allowed = false; await field.state.choose(event()); expect(communityApi.upload).toHaveBeenCalledOnce()
    field.unmount()
  })
  it.each(['account', 'draft', 'unmount'])('%s 变化后的迟到上传不覆盖新草稿', async (change) => {
    const update = vi.fn()
    let finish!: (value: { id: string }) => void
    vi.mocked(communityApi.upload).mockImplementation(() => new Promise((resolve) => { finish = resolve }))
    const field = setupComponent<Field>(CommunityCoverField, { 'onUpdate:modelValue': update })
    const pending = field.state.choose(event())
    if (change === 'account') state.auth.user.id = 'another'
    else if (change === 'draft') state.editor.form = {}
    else field.unmount()
    finish({ id: 'late-cover' }); await pending
    expect(update).not.toHaveBeenCalled()
    if (change !== 'unmount') field.unmount()
  })
})
