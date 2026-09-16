import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { assistantConfigDefaults, type AssistantAdminConfigDto, type AssistantConnectionDto } from '@ai-learning-hub/contracts'
import AssistantSettingsView from '../../admin-web/src/views/AssistantSettingsView.vue'
import { assistantApi } from '../../admin-web/src/services/assistant'
import { setupComponent, flushRender } from '../src/community/test-renderer'
const permissions = vi.hoisted(() => ({ value: ['settings.read', 'settings.write'] }))
vi.mock('../../admin-web/src/stores/session', () => ({ useSessionStore: () => ({ user: { permissions: permissions.value } }) }))
vi.mock('../../admin-web/src/services/assistant', () => ({ assistantApi: { config: vi.fn(), save: vi.fn(), test: vi.fn() } }))
const initial: AssistantAdminConfigDto = { ...assistantConfigDefaults, revision: 8, modelConfigured: true, modelName: 'deepseek-flash', modelBaseUrl: 'https://api.deepseek.com' }
type State = { form: typeof assistantConfigDefaults; saved: AssistantAdminConfigDto; save(): Promise<void>; testConnection(): Promise<void>; error: string; notice: string; connection: AssistantConnectionDto }
const views: { unmount(): void }[] = []
beforeEach(() => { vi.resetAllMocks(); permissions.value = ['settings.read', 'settings.write']; vi.mocked(assistantApi.config).mockResolvedValue({ ...initial }) })
afterEach(() => { views.splice(0).forEach(v => v.unmount()) })
async function mount() { const view = setupComponent<State>(AssistantSettingsView); views.push(view); await flushRender(); return view.state }
describe('助手后台真实保存状态', () => {
  it('保存携带读取的版本，成功后重新获取配置', async () => {
    const state = await mount(); state.form.welcome = '新的欢迎语'
    vi.mocked(assistantApi.config).mockResolvedValue({ ...initial, welcome: '新的欢迎语', revision: 9 })
    await state.save()
    expect(assistantApi.save).toHaveBeenCalledWith({ ...assistantConfigDefaults, welcome: '新的欢迎语', expectedRevision: 8 })
    expect(assistantApi.config).toHaveBeenCalledTimes(2); expect(state.saved.revision).toBe(9); expect(state.notice).toContain('保存')
  })
  it('版本冲突保留输入并显示错误，不宣称成功', async () => {
    const state = await mount(); state.form.name = '待保存名字'
    vi.mocked(assistantApi.save).mockRejectedValue(new Error('设置版本已变化，请重新读取后重试'))
    await state.save()
    expect(state.error).toContain('版本已变化'); expect(state.notice).toBe(''); expect(state.form.name).toBe('待保存名字')
  })
  it('连接失败按失败展示，不能标绿', async () => {
    const state = await mount(); vi.mocked(assistantApi.test).mockResolvedValue({ ok: false, message: '模型认证失败' })
    await state.testConnection(); expect(state.connection).toEqual({ ok: false, message: '模型认证失败' })
  })
  it('只读账号不能保存或测试模型', async () => {
    permissions.value = ['settings.read']; const state = await mount()
    await state.save(); await state.testConnection()
    expect(assistantApi.save).not.toHaveBeenCalled(); expect(assistantApi.test).not.toHaveBeenCalled()
  })
})
