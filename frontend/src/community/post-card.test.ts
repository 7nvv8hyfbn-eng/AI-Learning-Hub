import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { CommunityPostDetailDto } from '@ai-learning-hub/contracts'
import CommunityPostCard from './CommunityPostCard.vue'
import { communityApi } from '../services/api/community'
import { mockCommunity, resetCommunityMock } from '../services/api/community.mock'
import { setupComponent } from './test-renderer'
import { useCommunityStore } from '../stores/community'

interface CardState {
  hide: (kind: 'hide' | 'not-interested' | 'mute' | 'block') => Promise<void>
  reaction: (kind: 'like' | 'useful' | 'bookmark') => Promise<void>
  remove: () => Promise<void>
  unpublish: () => Promise<void>
  deleteOpen: boolean
  unpublishOpen: boolean
}

const access = vi.hoisted(() => ({ write: true, push: vi.fn() }))
vi.mock('../stores/auth', () => ({ useAuthStore: () => ({ user: { id: 'viewer', communityWriteEnabled: access.write } }) }))
vi.mock('vue-router', () => ({ useRouter: () => ({ push: access.push }) }))
vi.mock('../services/api/community', () => ({ communityApi: { post: vi.fn(), feedback: vi.fn(), remove: vi.fn(), unpublish: vi.fn(), reaction: vi.fn(), signals: vi.fn() } }))
vi.mock('../components/base/AppIcon.vue', () => ({ default: { render: () => null } }))
vi.mock('../components/base/AppDialog.vue', async () => {
  const { defineComponent, h } = await import('vue')
  return { default: defineComponent({ props: ['modelValue'], setup(props, { slots }) { return () => props.modelValue ? h('div', slots.default?.()) : null } }) }
})
beforeEach(() => { vi.resetAllMocks(); access.write = true; resetCommunityMock(); vi.mocked(communityApi.feedback).mockResolvedValue({}); vi.mocked(communityApi.remove).mockResolvedValue({}); vi.mocked(communityApi.unpublish).mockResolvedValue({ unpublished: true }); vi.mocked(communityApi.reaction).mockImplementation(async (_id, _kind, active) => ({ active })) })
describe('帖子移除事件不刷新不可见详情', () => {
  it('隐藏类操作只发hidden，点赞乐观更新且不拉取详情或重载列表', async () => {
    const post = await mockCommunity<CommunityPostDetailDto>('/posts/community-note-1', 'GET')
    vi.mocked(communityApi.post).mockResolvedValue(post)
    for (const action of ['hide', 'not-interested', 'mute', 'block'] as const) {
      const changed = vi.fn(), hidden = vi.fn(), view = setupComponent<CardState>(CommunityPostCard, { post, onChanged: changed, onHidden: hidden })
      await view.state.hide(action)
      expect(hidden).toHaveBeenCalledWith(post.id); expect(changed).not.toHaveBeenCalled()
      expect(communityApi.post).not.toHaveBeenCalled()
      view.unmount()
    }
    const changed = vi.fn(), view = setupComponent<CardState>(CommunityPostCard, { post, onChanged: changed })
    await view.state.reaction('like')
    expect(changed).not.toHaveBeenCalled(); expect(communityApi.post).not.toHaveBeenCalled()
    expect(post.viewerState.liked).toBe(true); expect(post.stats.likes).toBe(5)
    view.unmount()
  })
  it('作者确认删除只移除卡片，不跟随404详情请求', async () => {
    const fixture = await mockCommunity<CommunityPostDetailDto>('/posts/community-note-1', 'GET')
    const post = { ...fixture, author: { ...fixture.author, id: 'viewer' } }, changed = vi.fn(), hidden = vi.fn()
    const view = setupComponent<CardState>(CommunityPostCard, { post, onChanged: changed, onHidden: hidden })
    view.state.deleteOpen = true; await view.state.remove()
    expect(communityApi.remove).toHaveBeenCalledWith(post.id); expect(hidden).toHaveBeenCalledWith(post.id)
    expect(changed).not.toHaveBeenCalled(); expect(communityApi.post).not.toHaveBeenCalled()
    expect(view.state.deleteOpen).toBe(false)
    view.unmount()
  })
  it('作者确认下架资源时保留草稿语义并移除公开卡片', async () => {
    const fixture = await mockCommunity<CommunityPostDetailDto>('/posts/resource-demo-campus-agent', 'GET')
    const post = { ...fixture, author: { ...fixture.author, id: 'viewer' } }, changed = vi.fn(), hidden = vi.fn()
    const view = setupComponent<CardState>(CommunityPostCard, { post, onChanged: changed, onHidden: hidden })
    view.state.unpublishOpen = true; await view.state.unpublish()
    expect(communityApi.unpublish).toHaveBeenCalledWith(post.id); expect(hidden).toHaveBeenCalledWith(post.id)
    expect(changed).not.toHaveBeenCalled(); expect(communityApi.post).not.toHaveBeenCalled()
    expect(view.state.unpublishOpen).toBe(false)
    view.unmount()
  })
  it('未认证互动不写数据，仅提示主动认证并留在当前页面', async () => {
    access.write = false
    const windowTarget = new EventTarget(), notified = vi.fn()
    windowTarget.addEventListener('community-verification-required', notified)
    vi.stubGlobal('window', windowTarget)
    const post = await mockCommunity<CommunityPostDetailDto>('/posts/community-note-1', 'GET')
    const view = setupComponent<CardState>(CommunityPostCard, { post })
    try {
      await view.state.reaction('like')
      expect(communityApi.reaction).not.toHaveBeenCalled()
      expect(notified).not.toHaveBeenCalled()
      expect(access.push).not.toHaveBeenCalled()
      expect(useCommunityStore().accessNotice).toMatchObject({ reasonCode: 'COMMUNITY_VERIFICATION_REQUIRED', nextAction: { route: '/community/verification' } })
    } finally { view.unmount(); vi.unstubAllGlobals() }
  })
})
