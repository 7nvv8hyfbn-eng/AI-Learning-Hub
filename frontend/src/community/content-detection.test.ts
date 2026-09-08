import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { CommunityPostDetailDto, ContentDetectionResult } from '@ai-learning-hub/contracts'
import CommunityPostView from './CommunityPostView.vue'
import { contentDetectionNotice } from './labels'
import { flushRender, setupComponent } from './test-renderer'
import { communityApi } from '../services/api/community'

vi.mock('vue-router', () => ({ useRoute: () => ({ params: { postId: 'synthetic-post' }, fullPath: '/community/post/synthetic-post' }) }))
vi.mock('../stores/auth', () => ({ useAuthStore: () => ({ user: { id: 'synthetic-owner', communityWriteEnabled: true } }) }))
vi.mock('../services/api/community', () => ({ communityApi: { post: vi.fn(), comments: vi.fn(), comment: vi.fn() } }))
beforeEach(() => { vi.resetAllMocks(); vi.mocked(communityApi.comments).mockResolvedValue([]) })

const detection: ContentDetectionResult = { action: 'review', ruleVersion: 1, hits: [], mediaReview: 'not_performed' }
interface ViewState { post: CommunityPostDetailDto | null; body: string; error: string; notice: string; submit(): Promise<void> }

describe('内容检测学生端提示', () => {
  it('四级动作不混淆，复核通过不会继续提示尚未公开', () => {
    expect(contentDetectionNotice()).toBe('')
    expect(contentDetectionNotice({ ...detection, action: 'allow' })).toBe('')
    expect(contentDetectionNotice(detection)).toContain('尚未公开')
    expect(contentDetectionNotice({ ...detection, action: 'reject' })).toContain('保留并修改')
    expect(contentDetectionNotice({ ...detection, review: { id: 'r', status: 'approved', reason: '合成案例' } })).not.toContain('尚未公开')
    expect(contentDetectionNotice({ ...detection, review: { id: 'r', status: 'rejected', reason: '请脱敏合成号码' } })).toContain('请脱敏合成号码')
  })
  it('重复命中只提示一次，不声称已完成媒体画面审核', () => {
    const hit = { ruleId: 'synthetic', field: 'postBody' as const, category: 'spam' as const, action: 'warn' as const, explanation: '请确认资源授权' }
    expect(contentDetectionNotice({ ...detection, action: 'warn', hits: [hit, hit] })).toBe('提醒：请确认资源授权')
  })
  it.each(['draft', 'pending_review'] as const)('%s详情不会因请求公开评论接口失败而消失', async (status) => {
    vi.mocked(communityApi.post).mockResolvedValue({ id: 'synthetic-post', status } as CommunityPostDetailDto)
    vi.mocked(communityApi.comments).mockRejectedValue(new Error('待审帖子不可公开读取'))
    const view = setupComponent<ViewState>(CommunityPostView)
    await flushRender()
    expect(view.state.post?.status).toBe(status)
    expect(view.state.error).toBe('')
    expect(communityApi.comments).not.toHaveBeenCalled()
    view.unmount()
  })
  it('评论复核和拒绝均不伪造发布成功；拒绝保留编辑框输入', async () => {
    vi.mocked(communityApi.post).mockResolvedValue({ id: 'synthetic-post', status: 'published' } as CommunityPostDetailDto)
    vi.mocked(communityApi.comment).mockResolvedValue({ id: 'synthetic-comment', detection, status: 'pending_review' } as never)
    const view = setupComponent<ViewState>(CommunityPostView)
    await flushRender()
    view.state.body = '合成教学评论'
    await view.state.submit()
    expect(view.state.notice).toContain('尚未公开')
    expect(view.state.notice).not.toContain('发布成功')
    expect(view.state.body).toBe('')
    vi.mocked(communityApi.comment).mockRejectedValue(new Error('内容未发布，请保留并修改当前输入'))
    view.state.body = '保留的合成教学评论'
    await view.state.submit()
    expect(view.state.body).toBe('保留的合成教学评论')
    expect(view.state.error).toContain('内容未发布')
    expect(view.state.notice).toBe('')
    view.unmount()
  })
})
