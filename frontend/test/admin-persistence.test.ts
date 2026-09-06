import { beforeEach, describe, expect, it, vi } from 'vitest'
import { setupComponent, flushRender } from '../src/community/test-renderer'
import UsersView from '../../admin-web/src/views/UsersView.vue'
import CommunityView from '../../admin-web/src/views/CommunityView.vue'
import { usersApi } from '../../admin-web/src/services/users'
import { communityAdminApi } from '../../admin-web/src/services/community'
import type { AdminUserDetailDto, CommunityAdminInspectionDto } from '@ai-learning-hub/contracts'
vi.mock('../../admin-web/src/stores/session', () => ({ useSessionStore: () => ({ user: { id: 'operator', permissions: ['user.read', 'user.write', 'community.read', 'community.write'] } }) }))
vi.mock('../../admin-web/src/services/users', () => ({ usersApi: { list: vi.fn(), options: vi.fn(), detail: vi.fn(), action: vi.fn(), update: vi.fn() } }))
vi.mock('../../admin-web/src/services/community', () => ({ communityAdminApi: { summary: vi.fn(), posts: vi.fn(), inspection: vi.fn(), editPost: vi.fn(), image: vi.fn() } }))
vi.mock('../../admin-web/src/services/api', () => ({ api: vi.fn() }))
vi.mock('../../admin-web/node_modules/element-plus', () => ({ ElMessage: { success: vi.fn() } }))
const user = (id: string): AdminUserDetailDto => ({ user: { id, displayName: id, revision: 3, major: id }, security: {}, community: {}, activities: [], audits: [] }) as unknown as AdminUserDetailDto
const inspection = (id: string): CommunityAdminInspectionDto => ({ post: { id, title: id, type: 'general', revision: 4, status: 'published', visibility: 'public', contentBlocks: [{ type: 'paragraph', text: `body-${id}` }, { type: 'code', code: id }], bindings: [], topics: [] }, comments: [], reports: [] }) as unknown as CommunityAdminInspectionDto
beforeEach(() => {
  vi.resetAllMocks()
  vi.mocked(usersApi.list).mockResolvedValue({ items: [], page: 1, pageSize: 20, total: 0 })
  vi.mocked(usersApi.options).mockResolvedValue({ schools: [], roles: [] })
  vi.mocked(usersApi.detail).mockImplementation(async (id) => user(id))
  vi.mocked(communityAdminApi.posts).mockResolvedValue({ items: [], page: 1, pageSize: 20, total: 0 })
  vi.mocked(communityAdminApi.inspection).mockImplementation(async (id) => inspection(id))
})
describe('后台异步详情与冻结操作目标', () => {
  it('用户详情加载时不显示旧目标，弹窗冻结账号、版本与编辑副本', async () => {
    const view = setupComponent<{ inspect: (id: string) => Promise<void>; openAction: (action: string) => void; apply: () => Promise<void>; selected: AdminUserDetailDto | null; form: { displayName: string }; actionTarget: { id: string; revision: number } }>(UsersView)
    await flushRender(); await view.state.inspect('A'); view.state.openAction('edit')
    view.state.form.displayName = 'A的修改'
    let resolve!: (value: AdminUserDetailDto) => void
    vi.mocked(usersApi.detail).mockReturnValueOnce(new Promise((done) => { resolve = done }))
    const loadingB = view.state.inspect('B')
    expect(view.state.selected).toBeNull()
    resolve(user('B')); await loadingB
    expect(view.state.actionTarget).toMatchObject({ id: 'A', revision: 3 }); expect(view.state.form.displayName).toBe('A的修改')
    await view.state.apply()
    expect(usersApi.update).toHaveBeenCalledWith('A', expect.objectContaining({ expectedRevision: 3, displayName: 'A的修改' }))
    view.unmount()
  })
  it('社区迟到详情不覆盖新选择，编辑以打开时完整快照提交', async () => {
    const view = setupComponent<{ inspect: (id: string) => Promise<void>; selected: CommunityAdminInspectionDto | null; openPost: () => void; savePost: (publish?: boolean) => Promise<void>; postForm: { text: string } }>(CommunityView)
    await flushRender()
    let resolve!: (value: CommunityAdminInspectionDto) => void
    vi.mocked(communityAdminApi.inspection).mockReturnValueOnce(new Promise((done) => { resolve = done }))
    const stale = view.state.inspect('stale')
    await view.state.inspect('A'); resolve(inspection('stale')); await stale
    expect(view.state.selected?.post.id).toBe('A')
    view.state.openPost(); view.state.postForm.text = 'A的新正文'
    await view.state.inspect('B')
    await view.state.savePost()
    expect(communityAdminApi.editPost).toHaveBeenCalledWith('A', expect.objectContaining({ expectedRevision: 4, contentBlocks: [{ type: 'paragraph', text: 'A的新正文' }, { type: 'code', code: 'A' }] }))
    view.unmount()
  })
  it('外部精选草稿由后台明确确认后才发布', async () => {
    const curated = inspection('community-lcz-1356')
    curated.post.status = 'draft'
    const view = setupComponent<{ inspect: (id: string) => Promise<void>; openPost: () => void; savePost: (publish?: boolean) => Promise<void>; postForm: { reason: string } }>(CommunityView)
    vi.mocked(communityAdminApi.inspection).mockResolvedValue(curated)
    await flushRender(); await view.state.inspect(curated.post.id); view.state.openPost()
    view.state.postForm.reason = '已核对来源与编辑内容'
    await view.state.savePost(true)
    expect(communityAdminApi.editPost).toHaveBeenCalledWith(curated.post.id, expect.objectContaining({ status: 'published', expectedRevision: 4 }))
    view.unmount()
  })
})
