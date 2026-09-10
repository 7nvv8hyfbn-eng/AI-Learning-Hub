import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { CommunityCommentDto, CommunityCommentPageDto, CommunityPostDetailDto } from '@ai-learning-hub/contracts'
import CommunityPostView from './CommunityPostView.vue'
import { communityApi } from '../services/api/community'
import { flushRender, setupComponent } from './test-renderer'

vi.mock('vue-router', () => ({ useRoute: () => ({ params: { postId: 'post' }, fullPath: '/community/post/post', hash: '' }) }))
vi.mock('../stores/auth', () => ({ useAuthStore: () => ({ user: { id: 'owner', communityWriteEnabled: true } }) }))
vi.mock('../services/api/community', () => ({ communityApi: { post: vi.fn(), comments: vi.fn(), commentDetail: vi.fn(), comment: vi.fn() } }))

const comment = (id: string, parentId: string | null = null): CommunityCommentDto => ({
  id, postId: 'post', parentId, rootId: parentId, revision: 1, status: 'published',
  author: { id: 'owner', username: 'owner', displayName: '合成学生', avatar: null, school: null, major: null, verifiedType: 'none' },
  body: '合成讨论', contentBlocks: [{ type: 'paragraph', text: '合成讨论' }], deleted: false, likes: 0, liked: false, accepted: false,
  createdAt: '2026-01-01T00:00:00Z', replyCount: parentId ? 0 : 2,
})
interface State {
  roots: CommunityCommentDto[]; comments: CommunityCommentDto[]; replies: Record<string, CommunityCommentPageDto>; nextCursor: string | null
  loadComments(parentId?: string): Promise<void>
  act(action: () => Promise<unknown>, operation: 'read', comment: CommunityCommentDto): Promise<void>
}
beforeEach(() => {
  vi.resetAllMocks()
  vi.mocked(communityApi.post).mockResolvedValue({ id: 'post', author: comment('root-a').author, status: 'published', stats: { comments: 1041 } } as CommunityPostDetailDto)
  vi.mocked(communityApi.comments).mockResolvedValue({ items: [comment('root-a')], nextCursor: 'root-a' })
})

describe('评论和回复分开翻页', () => {
  it('父级翻页、回复翻页保持归属并去重，操作后保留已加载内容', async () => {
    const view = setupComponent<State>(CommunityPostView)
    await flushRender()
    expect(communityApi.comments).toHaveBeenCalledTimes(1)
    vi.mocked(communityApi.comments).mockResolvedValueOnce({ items: [comment('root-a'), comment('root-b')], nextCursor: null })
    await view.state.loadComments()
    expect(communityApi.comments).toHaveBeenLastCalledWith('post', { parentId: undefined, cursor: 'root-a' })
    vi.mocked(communityApi.comments).mockResolvedValueOnce({ items: [comment('reply-a', 'root-a')], nextCursor: 'reply-a' })
    await view.state.loadComments('root-a')
    vi.mocked(communityApi.comments).mockResolvedValueOnce({ items: [comment('reply-a', 'root-a'), comment('reply-b', 'root-a')], nextCursor: null })
    await view.state.loadComments('root-a')
    expect(communityApi.comments).toHaveBeenLastCalledWith('post', { parentId: 'root-a', cursor: 'reply-a' })
    expect(view.state.comments.map((row) => row.id)).toEqual(['root-a', 'reply-a', 'reply-b', 'root-b'])
    vi.mocked(communityApi.commentDetail).mockResolvedValue({ ...comment('root-a'), deleted: true, contentBlocks: [], body: '该评论已删除或不可见' })
    await view.state.act(async () => ({}), 'read', view.state.roots[0])
    expect(view.state.comments.map((row) => row.id)).toEqual(['root-a', 'reply-a', 'reply-b', 'root-b'])
    expect(view.state.roots[0].deleted).toBe(true)
    expect(communityApi.comments).toHaveBeenCalledTimes(4)
    view.unmount()
  })

  it('离开详情后丢弃在途评论页，重复点击不重复请求', async () => {
    const view = setupComponent<State>(CommunityPostView)
    await flushRender()
    let resolve!: (page: CommunityCommentPageDto) => void
    vi.mocked(communityApi.comments).mockReturnValueOnce(new Promise((done) => { resolve = done }))
    const pending = view.state.loadComments()
    await view.state.loadComments()
    expect(communityApi.comments).toHaveBeenCalledTimes(2)
    view.unmount()
    resolve({ items: [comment('late')], nextCursor: null })
    await pending
    expect(view.state.roots.map((row) => row.id)).toEqual(['root-a'])
  })

  it('采纳的后续回复定向加载父项和回答，不遍历前面的评论页', async () => {
    vi.mocked(communityApi.post).mockResolvedValue({ id: 'post', author: comment('root-a').author, status: 'published', question: { acceptedCommentId: 'reply-521' } } as CommunityPostDetailDto)
    vi.mocked(communityApi.commentDetail).mockResolvedValueOnce(comment('reply-521', 'root-z')).mockResolvedValueOnce(comment('root-z'))
    const view = setupComponent<State>(CommunityPostView)
    await flushRender()
    expect(view.state.comments.map((row) => row.id)).toEqual(['root-a', 'root-z', 'reply-521'])
    expect(communityApi.comments).toHaveBeenCalledTimes(1)
    expect(communityApi.commentDetail).toHaveBeenCalledTimes(2)
    view.unmount()
  })
})
