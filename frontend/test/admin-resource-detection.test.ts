import { beforeEach, describe, expect, it, vi } from 'vitest'
import ResourceManagementView from '../../admin-web/src/views/management/ResourceManagementView.vue'
import { api } from '../../admin-web/src/services/api'
import { flushRender, setupComponent } from '../src/community/test-renderer'

const messages = vi.hoisted(() => ({ success: vi.fn(), warning: vi.fn() }))
vi.mock('../../admin-web/node_modules/element-plus', () => ({ ElMessage: messages }))
vi.mock('../../admin-web/node_modules/vue-router', () => ({ useRoute: () => ({ query: {} }) }))
vi.mock('../../admin-web/src/stores/session', () => ({ useSessionStore: () => ({ user: { permissions: ['resource.read', 'resource.write', 'resource.publish'] } }) }))
vi.mock('../../admin-web/src/services/api', () => ({ api: vi.fn() }))
let outcome: object, reject = false
beforeEach(() => {
  vi.resetAllMocks(); reject = false; outcome = { status: 'reviewing' }
  vi.mocked(api).mockImplementation(async (path) => {
    if (path.endsWith('/publish')) { if (reject) throw new Error('内容未发布，请修改当前输入'); return outcome }
    if (path.startsWith('/admin/resources?')) return { items: [{ id: 'synthetic-slug', databaseId: 'synthetic-resource', title: '合成资源', data: {} }], total: 1, page: 1, pageSize: 10 }
    if (path === '/admin/resources/synthetic-resource') return { title: '合成资源' }
    if (path === '/admin/resource-hub/config') return { revision: 1, bannerPostIds: [], sectionCategoryCodes: [] }
    if (path.startsWith('/admin/resource-hub/')) return []
    return { items: [] }
  })
})

describe('后台资源发布真实状态提示', () => {
  it('待复核不提示发布成功', async () => {
    const view = setupComponent<{ publish(): Promise<void> }>(ResourceManagementView)
    await flushRender(); await view.state.publish()
    expect(messages.success).not.toHaveBeenCalled()
    expect(messages.warning).toHaveBeenCalledWith(expect.stringContaining('尚未公开'))
    expect(api).toHaveBeenCalledWith('/admin/resources/synthetic-resource/publish', { method: 'POST' })
    view.unmount()
  })
  it('已发布的提醒正常显示，重复命中不重复提示', async () => {
    outcome = { status: 'published', detection: { action: 'warn', hits: [{ explanation: '请确认资料授权' }, { explanation: '请确认资料授权' }] } }
    const view = setupComponent<{ publish(): Promise<void> }>(ResourceManagementView)
    await flushRender(); await view.state.publish()
    expect(messages.success).toHaveBeenCalledWith('资源已发布')
    expect(messages.warning).toHaveBeenCalledWith('请确认资料授权')
    view.unmount()
  })
  it('拒绝时不清空编辑字段，也不弹出成功提示', async () => {
    const view = setupComponent<{ publish(): Promise<void>; fields: { tags: string } }>(ResourceManagementView)
    await flushRender(); view.state.fields.tags = '保留的合成标签'; reject = true
    await expect(view.state.publish()).rejects.toThrow('内容未发布')
    expect(view.state.fields.tags).toBe('保留的合成标签')
    expect(messages.success).not.toHaveBeenCalled()
    expect(messages.warning).not.toHaveBeenCalled()
    view.unmount()
  })
})
