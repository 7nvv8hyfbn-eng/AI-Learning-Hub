import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { LearningCollectionInput } from '@ai-learning-hub/contracts'
import ResourceStudioView from '../src/views/ResourceStudioView.vue'
import { resourceHubApi } from '../src/services/api/resourceHub'
import { flushRender, setupComponent } from '../src/community/test-renderer'

vi.mock('../src/services/api/resourceHub', () => ({ resourceHubApi: { studio: vi.fn(), collections: vi.fn(), createCollection: vi.fn(), updateCollection: vi.fn() } }))
vi.mock('../src/stores/community', () => ({ useCommunityStore: () => ({}) }))
vi.mock('../src/community/composables/useCommunityAccess', () => ({ useCommunityAccess: () => ({ requireWrite: () => true }) }))
interface State { collectionForm: LearningCollectionInput & { id: string }; collectionOpen: boolean; notice: string; error: string; saveCollection(): Promise<void> }
beforeEach(() => {
  vi.resetAllMocks()
  vi.mocked(resourceHubApi.studio).mockResolvedValue({ items: [], drafts: [], pendingReview: [], processing: [] })
  vi.mocked(resourceHubApi.collections).mockResolvedValue([])
})
describe('资源工作室合集检测反馈', () => {
  it.each(['create', 'edit'])('%s 待审不提示社区可见，仍使用原保存入口', async (mode) => {
    const saved = { contentStatus: 'pending_review', detection: { action: 'review', ruleVersion: 1, hits: [], mediaReview: 'not_performed' } }
    vi.mocked(resourceHubApi.createCollection).mockResolvedValue(saved as never)
    vi.mocked(resourceHubApi.updateCollection).mockResolvedValue(saved as never)
    const view = setupComponent<State>(ResourceStudioView); await flushRender()
    Object.assign(view.state.collectionForm, { id: mode === 'edit' ? 'synthetic-collection' : '', name: '合成学习清单', description: '合成说明', visibility: 'community' })
    view.state.collectionOpen = true
    await view.state.saveCollection()
    expect(view.state.notice).toContain('尚未公开')
    expect(view.state.collectionOpen).toBe(false)
    expect(mode === 'edit' ? resourceHubApi.updateCollection : resourceHubApi.createCollection).toHaveBeenCalledOnce()
    view.unmount()
  })
  it('拒绝保留合集表单和输入，warn显示命中解释', async () => {
    const view = setupComponent<State>(ResourceStudioView); await flushRender()
    Object.assign(view.state.collectionForm, { name: '保留合成输入', description: '合成说明', visibility: 'community' }); view.state.collectionOpen = true
    view.state.notice = '上一次的合集已创建'
    vi.mocked(resourceHubApi.createCollection).mockRejectedValueOnce(new Error('内容未发布，请修改输入'))
    await view.state.saveCollection()
    expect(view.state.collectionOpen).toBe(true)
    expect(view.state.collectionForm.name).toBe('保留合成输入')
    expect(view.state.error).toContain('内容未发布')
    expect(view.state.notice).toBe('')
    vi.mocked(resourceHubApi.createCollection).mockResolvedValueOnce({ detection: { action: 'warn', ruleVersion: 1, hits: [{ explanation: '请确认教学资料来源' }], mediaReview: 'not_performed' } } as never)
    await view.state.saveCollection()
    expect(view.state.notice).toBe('提醒：请确认教学资料来源')
    view.unmount()
  })
})
