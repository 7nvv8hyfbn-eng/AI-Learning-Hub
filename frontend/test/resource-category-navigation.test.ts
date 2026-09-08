import { afterEach, expect, it, vi } from 'vitest'
import type { ResourceHubHomeDto } from '@ai-learning-hub/contracts'
import ResourcesView from '../src/views/ResourcesView.vue'
import { resourceHubApi } from '../src/services/api/resourceHub'
import { flushRender, setupComponent } from '../src/community/test-renderer'

const route = vi.hoisted(() => ({ query: {}, fullPath: '/resources' }))
const replace = vi.hoisted(() => vi.fn())
vi.mock('vue-router', () => ({ useRoute: () => route, useRouter: () => ({ replace }) }))
vi.mock('../src/services/api/resourceHub', () => ({ resourceHubApi: { home: vi.fn(), list: vi.fn() } }))
vi.mock('../src/stores/community', () => ({ useCommunityStore: () => ({}) }))
vi.mock('../src/stores/auth', () => ({ useAuthStore: () => ({ user: null }) }))
vi.mock('../src/stores/content/resources', () => ({ useResourcesStore: () => ({ items: [], load: async () => {} }), mapSelectedResource: () => null }))
vi.mock('../src/services/api/client', () => ({ dataMode: 'mock' }))
vi.mock('../src/services/api/behavior', () => ({ behaviorApi: {} }))
vi.mock('../src/community/coop/RichEditPanel.vue', () => ({ default: { render: () => null } }))

afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks() })

it('固定四类加全部资源，其他分类仍可使用原筛选入口', async () => {
  vi.stubGlobal('sessionStorage', { getItem: () => null, setItem: vi.fn() })
  vi.stubGlobal('window', { scrollY: 0 })
  const codes = ['handbook', 'creator-share', 'agent-practice', 'lab-demo', 'ai-foundation', 'model-deployment', 'tool-tutorial', 'new-category', 'uncategorized']
  vi.mocked(resourceHubApi.home).mockResolvedValue({ categories: codes.map((code) => ({ id: code, code, name: code })), banners: [], rankings: { week: [], month: [], all: [] } } as unknown as ResourceHubHomeDto)
  vi.mocked(resourceHubApi.list).mockResolvedValue({ items: [], nextCursor: null })
  const view = setupComponent<{ primaryCategories: { code: string }[]; moreCategories: { code: string }[]; selectCategory(code: string): Promise<void>; category: string }>(ResourcesView)
  try {
    await flushRender()
    expect(view.state.primaryCategories.map((entry) => entry.code)).toEqual(['ai-foundation', 'lab-demo', 'model-deployment', 'agent-practice'])
    expect(view.state.moreCategories.map((entry) => entry.code)).toEqual(['handbook', 'creator-share', 'tool-tutorial', 'new-category'])
    await view.state.selectCategory('handbook')
    expect(resourceHubApi.list).toHaveBeenLastCalledWith(expect.objectContaining({ category: 'handbook' }))
    expect(replace).toHaveBeenLastCalledWith({ query: expect.objectContaining({ category: 'handbook' }) })
    await view.state.selectCategory('')
    expect(view.state.category).toBe('')
    expect(resourceHubApi.list).toHaveBeenLastCalledWith(expect.objectContaining({ category: '' }))
  } finally { view.unmount() }
})
