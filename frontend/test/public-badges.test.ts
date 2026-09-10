import { describe, expect, it, vi } from 'vitest'
import { createSSRApp, h } from 'vue'
import { renderToString } from 'vue/server-renderer'
import { createPinia, setActivePinia } from 'pinia'
import type { CommunityAuthorDto, CommunityUserBadge, UserBadgeSettingsDto, UserBadgeUpdateInput } from '@ai-learning-hub/contracts'
import CommunityUserBadges from '../src/community/CommunityUserBadges.vue'
import { useCommunityStore } from '../src/stores/community'
import UserPublicBadges from '../../admin-web/src/components/UserPublicBadges.vue'
import { usersApi } from '../../admin-web/src/services/users'
import { setupComponent, flushRender } from '../src/community/test-renderer'

vi.mock('../../admin-web/src/services/users', () => ({ usersApi: { badges: vi.fn(), updateBadges: vi.fn() } }))
const badges: CommunityUserBadge[] = [{ code: 'official', label: '官方', tone: 'orange' }, { code: 'moderator', label: '版主', tone: 'purple', scopes: ['community', 'tutorials'] }, { code: 'custom:热心同学', label: '热心同学', tone: 'green' }]
describe('公开标签展示和副本同步', () => {
  it('最多两个标签并显示真实范围，其余可通过键盘读取', async () => {
    const html = await renderToString(createSSRApp({ render: () => h(CommunityUserBadges, { badges, verifiedType: 'official' }) }))
    expect(html.match(/class="user-badge"/g)).toHaveLength(2)
    expect(html).toContain('社区、教程中心版主'); expect(html).toContain('tabindex="0"'); expect(html).toContain('+1')
    expect(html.match(/>官方</g)).toHaveLength(1)
  })
  it('空数组禁止旧身份回退，缺字段时兼容；纯文字安全转义', async () => {
    const render = (props: object) => renderToString(createSSRApp({ render: () => h(CommunityUserBadges, props) }))
    expect(await render({ badges: [], verifiedType: 'official' })).not.toContain('官方')
    expect(await render({ verifiedType: 'official' })).toContain('官方')
    expect(await render({ badges: [{ code: 'custom:text', label: '<img src=x>', tone: 'green' }] })).toContain('&lt;img src=x&gt;')
  })
  it('新资料同时更新推荐作者、多个帖子与引用作者，清空标签不会漏掉副本', () => {
    setActivePinia(createPinia()); const store = useCommunityStore()
    const author = (): CommunityAuthorDto => ({ id: 'same', username: 'same', displayName: '原昵称', avatar: null, school: null, major: null, verifiedType: 'official', badges })
    const copies = [author(), author(), author(), author()]
    store.context = { suggestedUsers: [copies[0]] } as never
    store.publishedPosts = [{ post: { id: 'p1', author: copies[1], quotedPost: { available: true, author: copies[2] } } }, { post: { id: 'p2', author: copies[3] } }] as never
    store.syncAuthors([{ id: 'same', displayName: '新昵称', badges: [] }])
    for (const copy of copies) expect(copy).toMatchObject({ displayName: '新昵称', verifiedType: 'official', badges: [] })
  })
})
describe('后台公开标签保存', () => {
  interface State { settings?: UserBadgeSettingsDto; form: Omit<UserBadgeUpdateInput, 'expectedRevision'>; error: string; toggle(code: string): void; save(): Promise<void> }
  const settings = (): UserBadgeSettingsDto => ({ publicVisible: true, revision: 3, badges: [...badges], automaticBadges: badges.slice(0, 2), customBadges: [{ label: '热心同学', tone: 'green' }], hiddenAutomaticBadges: [] })
  it('保存使用服务端版本并立即回显规范化结果；409保留输入', async () => {
    vi.mocked(usersApi.badges).mockResolvedValue(settings() as never)
    const view = setupComponent<State>(UserPublicBadges, { userId: 'target', userRevision: 1 }); await flushRender()
    view.state.toggle('moderator'); view.state.form.reason = '调整公开显示范围'
    vi.mocked(usersApi.updateBadges).mockRejectedValueOnce(new Error('409：公开资料已变化'))
    await view.state.save(); expect(view.state.error).toContain('409'); expect(view.state.form.hiddenAutomaticBadges).toEqual(['moderator'])
    vi.mocked(usersApi.updateBadges).mockResolvedValueOnce({ ...settings(), revision: 4, badges: [badges[0]], customBadges: [], hiddenAutomaticBadges: ['moderator'] } as never)
    await view.state.save()
    expect(usersApi.updateBadges).toHaveBeenLastCalledWith('target', expect.objectContaining({ expectedRevision: 3, reason: '调整公开显示范围', hiddenAutomaticBadges: ['moderator'] }))
    expect(view.state.settings?.revision).toBe(4); expect(view.state.form.customBadges).toEqual([]); view.unmount()
  })
  it('离开详情后不接受迟到读取，不允许只读账号保存', async () => {
    let resolve!: (value: UserBadgeSettingsDto) => void
    vi.mocked(usersApi.badges).mockReturnValueOnce(new Promise(done => { resolve = done }))
    const view = setupComponent<State>(UserPublicBadges, { userId: 'self', userRevision: 1, readonly: true })
    view.unmount(); resolve(settings()); await flushRender(); expect(view.state.settings).toBeUndefined()
  })
})
