import { beforeEach, describe, expect, it, vi } from 'vitest'
import { reactive } from 'vue'
import type { CommunityPostDetailDto, CommunityTopicDto } from '@ai-learning-hub/contracts'
import CommunityCollectionView from './CommunityCollectionView.vue'
import { communityApi } from '../services/api/community'
import { flushRender, setupComponent } from './test-renderer'

interface CollectionState { posts: CommunityPostDetailDto[]; topic: CommunityTopicDto | null; tab: string }

const routing = vi.hoisted(() => ({ route: {} as Record<string, unknown> }))
vi.mock('vue-router', () => ({ useRoute: () => routing.route }))
vi.mock('../stores/learning', () => ({ useLearningStore: () => ({ notes: {}, favorites: [] }) }))
vi.mock('../stores/community', () => ({ useCommunityStore: () => ({ epoch: 0, operations: {}, follow: vi.fn(), openComposer: vi.fn() }) }))
vi.mock('./CommunityPostCard.vue', () => ({ default: { render: () => null } }))
vi.mock('../services/api/community', () => ({ communityApi: { topics: vi.fn(), list: vi.fn(), signals: vi.fn() } }))

const navigate = (view: 'topic' | 'bookmarks', slug = '') => Object.assign(routing.route, {
  path: view === 'topic' ? `/community/topic/${slug}` : '/bookmarks',
  fullPath: view === 'topic' ? `/community/topic/${slug}` : '/bookmarks',
  meta: { communityView: view },
  params: { slug },
  query: {},
})

beforeEach(() => {
  vi.resetAllMocks()
  routing.route = reactive({})
  vi.mocked(communityApi.topics).mockResolvedValue([{ id: 'topic-1', slug: 'linux', name: 'Linux', description: '系统基础', accent: '#000', themeId: null, status: 'active', recommended: true, sortOrder: 1, postCount: 2, followerCount: 1, following: false }])
  vi.mocked(communityApi.list).mockResolvedValue([])
  vi.mocked(communityApi.signals).mockResolvedValue({})
})

describe('社区集合页保持话题与收藏职责', () => {
  it('话题路由读取话题和动态并记录访问', async () => {
    navigate('topic', 'linux')
    const view = setupComponent<CollectionState>(CommunityCollectionView)
    await flushRender()
    expect(view.state.topic?.description).toBe('系统基础')
    expect(communityApi.list).toHaveBeenCalledWith('topic', 'linux')
    expect(communityApi.signals).toHaveBeenCalledWith(expect.objectContaining({ targetId: 'topic-1' }))
    view.unmount()
  })

  it('切换到收藏页时清除话题状态且不请求个人主页', async () => {
    navigate('topic', 'linux')
    const view = setupComponent<CollectionState>(CommunityCollectionView)
    await flushRender()
    navigate('bookmarks')
    await flushRender()
    expect(view.state.topic).toBeNull()
    expect(communityApi.list).toHaveBeenLastCalledWith('bookmarks', '', 'keyword=')
    view.unmount()
  })
})
