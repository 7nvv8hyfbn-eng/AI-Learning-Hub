import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ContentDetectionField, ContentDetectionPolicy, ContentDetectionResult, ContentDetectionRule, ContentReviewDto } from '@ai-learning-hub/contracts'
import CommunityView from '../../admin-web/src/views/CommunityView.vue'
import { communityAdminApi } from '../../admin-web/src/services/community'
import { flushRender, setupComponent } from '../src/community/test-renderer'

vi.mock('../../admin-web/node_modules/vue-router', () => ({ useRoute: () => ({ query: {} }) }))
vi.mock('../../admin-web/src/stores/session', () => ({ useSessionStore: () => ({ user: { id: 'synthetic-reviewer', permissions: ['community.read', 'community.moderate', 'resource.publish'] } }) }))
vi.mock('../../admin-web/src/services/community', () => ({ communityAdminApi: { summary: vi.fn(), posts: vi.fn(), contentPolicy: vi.fn(), contentPolicyHistory: vi.fn(), configureContentPolicy: vi.fn(), trialContent: vi.fn(), contentReviews: vi.fn(), contentReview: vi.fn(), decideContent: vi.fn() } }))
const policy: ContentDetectionPolicy = { version: 7, rules: [{ id: 'synthetic-rule', content: '合成风险短语', method: 'literal', fields: ['postBody'], category: 'school', action: 'review', enabled: true, explanation: '仅用于合成测试' }] }
const review = (id: string, contentRevision = 3): ContentReviewDto => ({ id, targetId: `synthetic-${id}`, targetType: 'post', authorId: 'synthetic-owner', contentRevision, ruleVersion: 7, status: 'pending', findings: { action: 'review', ruleVersion: 7, hits: [], mediaReview: 'not_performed' }, reason: '', createdAt: '2026-01-01T00:00:00Z', contentAvailable: true, payload: { postBody: '合成内容' } })
interface State {
  contentPolicy: ContentDetectionPolicy
  ruleForm: ContentDetectionRule
  ruleReason: string
  ruleOpen: boolean
  deletingRule: boolean
  error: string
  editRule(rule?: ContentDetectionRule, remove?: boolean): void
  saveRule(): Promise<void>
  saveContentPolicy(input: { rules?: ContentDetectionRule[]; rollbackVersion?: number; reason: string }): Promise<void>
  trialField: ContentDetectionField
  trialText: string
  trialResult: ContentDetectionResult | null
  trialContent(): Promise<void>
  selectedReview: ContentReviewDto | null
  reviewOpen: boolean
  reviewReason: string
  openReview(id: string): Promise<void>
  decideReview(action: 'approve' | 'reject'): Promise<void>
}
beforeEach(() => {
  vi.resetAllMocks()
  vi.mocked(communityAdminApi.posts).mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 20 })
  vi.mocked(communityAdminApi.configureContentPolicy).mockImplementation(async (input) => ({ version: input.expectedVersion + 1, rules: input.rules || policy.rules }))
  vi.mocked(communityAdminApi.contentPolicyHistory).mockResolvedValue([policy])
  vi.mocked(communityAdminApi.contentReview).mockImplementation(async (id) => review(id))
})
const mount = async () => { const view = setupComponent<State>(CommunityView); await flushRender(); view.state.contentPolicy = structuredClone(policy); return view }

describe('后台内容规则与修订复核', () => {
  it.each([false, true])('编辑或删除期间刷新出新规则不能覆盖旧副本：删除=%s', async (remove) => {
    const view = await mount()
    view.state.editRule(view.state.contentPolicy.rules[0], remove); view.state.ruleForm.content = '未完成的修改'
    view.state.contentPolicy = { ...structuredClone(policy), version: 8 }
    await view.state.saveRule()
    expect(communityAdminApi.configureContentPolicy).not.toHaveBeenCalled()
    expect(view.state.ruleForm.content).toBe('未完成的修改')
    expect(view.state.error).toContain('规则已有新版本')
    view.unmount()
  })

  it('编辑副本不污染当前策略，保存携带原版本并保留规则顺序', async () => {
    const view = await mount()
    view.state.editRule(view.state.contentPolicy.rules[0]); view.state.ruleForm.enabled = false; view.state.ruleReason = '合成停用理由'
    expect(view.state.contentPolicy.rules[0]?.enabled).toBe(true)
    await view.state.saveRule()
    expect(communityAdminApi.configureContentPolicy).toHaveBeenCalledWith({ expectedVersion: 7, reason: '合成停用理由', rules: [{ ...policy.rules[0], enabled: false }] })
    expect(view.state.contentPolicy.version).toBe(8)
    expect(view.state.ruleOpen).toBe(false)
    view.unmount()
  })
  it('新增与删除复用同一版本写接口，取消删除不写数据', async () => {
    const view = await mount()
    view.state.editRule(); Object.assign(view.state.ruleForm, { ...policy.rules[0], id: 'synthetic-new' }); view.state.ruleReason = '合成新增规则'
    await view.state.saveRule()
    expect(view.state.contentPolicy.rules.map(rule => rule.id)).toEqual(['synthetic-rule', 'synthetic-new'])
    const prompt = vi.fn(() => { throw new Error('prompt() is not supported.') })
    vi.stubGlobal('window', { prompt })
    try {
      view.state.editRule(view.state.contentPolicy.rules[1], true)
      expect(view.state.deletingRule).toBe(true)
      expect(view.state.ruleOpen).toBe(true)
      view.state.ruleOpen = false
      expect(communityAdminApi.configureContentPolicy).toHaveBeenCalledOnce()
      view.state.editRule(view.state.contentPolicy.rules[1], true)
      view.state.ruleReason = '合成删除理由'
      await view.state.saveRule()
      expect(communityAdminApi.configureContentPolicy).toHaveBeenLastCalledWith({ expectedVersion: 8, reason: '合成删除理由', rules: policy.rules })
      expect(prompt).not.toHaveBeenCalled()
    } finally { vi.unstubAllGlobals(); view.unmount() }
  })
  it('回退只传历史版本，不用旧版本号覆盖当前版本；失败保留编辑输入', async () => {
    const view = await mount()
    await view.state.saveContentPolicy({ rollbackVersion: 2, reason: '合成回退理由' })
    expect(communityAdminApi.configureContentPolicy).toHaveBeenCalledWith({ expectedVersion: 7, rollbackVersion: 2, reason: '合成回退理由' })
    view.state.editRule(view.state.contentPolicy.rules[0]); view.state.ruleForm.content = '尚未保存的内容'; view.state.ruleReason = '合成修订理由'
    vi.mocked(communityAdminApi.configureContentPolicy).mockRejectedValue(new Error('规则已有新版本，请刷新'))
    await view.state.saveRule()
    expect(view.state.ruleOpen).toBe(true)
    expect(view.state.ruleForm.content).toBe('尚未保存的内容')
    expect(view.state.error).toContain('已有新版本')
    view.unmount()
  })
  it('试跑传选中字段，不创建投稿、不修改规则，并保留命中解释', async () => {
    const view = await mount()
    const result = { ...review('r').findings, previewOnly: true as const, saved: false as const }
    vi.mocked(communityAdminApi.trialContent).mockResolvedValue(result)
    view.state.trialField = 'resourceDescription'; view.state.trialText = '合成说明'
    await view.state.trialContent()
    expect(communityAdminApi.trialContent).toHaveBeenCalledWith({ resourceDescription: '合成说明' })
    expect(view.state.trialResult).toEqual(result)
    expect(communityAdminApi.configureContentPolicy).not.toHaveBeenCalled()
    expect(communityAdminApi.decideContent).not.toHaveBeenCalled()
    view.unmount()
  })
  it('迟到详情不能覆盖新目标，审批绑定弹窗读取的修订与规则', async () => {
    const view = await mount()
    let resolve!: (value: ContentReviewDto) => void
    vi.mocked(communityAdminApi.contentReview).mockReturnValueOnce(new Promise(done => { resolve = done }))
    const stale = view.state.openReview('A')
    await view.state.openReview('B'); resolve(review('A', 8)); await stale
    expect(view.state.selectedReview?.id).toBe('B')
    view.state.reviewReason = '确认该修订是合成教学案例'
    await view.state.decideReview('approve')
    expect(communityAdminApi.decideContent).toHaveBeenCalledWith('B', { expectedRevision: 3, ruleVersion: 7, action: 'approve', reason: '确认该修订是合成教学案例' })
    expect(view.state.reviewOpen).toBe(false)
    view.unmount()
  })
  it('版本冲突保留审核理由；未读取完整内容或无理由时不能审批', async () => {
    const view = await mount()
    await view.state.openReview('A'); await view.state.decideReview('approve')
    expect(communityAdminApi.decideContent).not.toHaveBeenCalled()
    view.state.reviewReason = '合成复核理由'; view.state.selectedReview!.contentAvailable = false
    await view.state.decideReview('approve')
    expect(communityAdminApi.decideContent).not.toHaveBeenCalled()
    view.state.selectedReview!.contentAvailable = true
    vi.mocked(communityAdminApi.decideContent).mockRejectedValue(new Error('正文已变化，旧复核不能放行新内容'))
    await view.state.decideReview('reject')
    expect(view.state.reviewOpen).toBe(true); expect(view.state.reviewReason).toBe('合成复核理由')
    expect(view.state.error).toContain('旧复核')
    view.unmount()
  })
})
