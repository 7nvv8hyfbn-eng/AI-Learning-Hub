import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.setConfig({ testTimeout: 20_000 })

const mocks = vi.hoisted(() => ({
  auth: {
    login: vi.fn(),
    logout: vi.fn(),
    me: vi.fn(),
  },
  behavior: {
    favorites: vi.fn(),
    plans: vi.fn(),
    growth: vi.fn(),
  },
}))

vi.mock('../services/api/auth', () => ({ authApi: mocks.auth }))
vi.mock('../services/api/behavior', () => ({ behaviorApi: mocks.behavior }))

const memoryStorage = () => {
  const values = new Map<string, string>()
  return {
    getItem: (key: string) => values.get(key) || null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
    clear: () => values.clear(),
    key: (index: number) => [...values.keys()][index] || null,
    get length() { return values.size },
  } satisfies Storage
}

const setup = async () => {
  vi.resetModules()
  vi.stubEnv('VITE_DATA_MODE', 'api')
  const demoRead = vi.fn(() => { throw new Error('API 模式禁止读取本地演示状态') })
  vi.stubGlobal('sessionStorage', memoryStorage())
  vi.stubGlobal('localStorage', { ...memoryStorage(), getItem: demoRead })
  vi.stubGlobal('window', { dispatchEvent: vi.fn() })
  vi.stubGlobal('CustomEvent', class {})
  setActivePinia(createPinia())
  const [{ useLearningStore }, { useAuthStore }] = await Promise.all([
    import('./learning'),
    import('./auth'),
  ])
  return { learning: useLearningStore(), auth: useAuthStore(), demoRead }
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.auth.login.mockResolvedValue({
    id: 'student-real',
    email: 'student@example.invalid',
    displayName: '真实学生',
    roles: ['student'],
    permissions: [],
  })
  mocks.auth.logout.mockResolvedValue(undefined)
  mocks.behavior.favorites.mockResolvedValue([{ targetType: 'course', targetId: 'real-course' }])
  mocks.behavior.plans.mockResolvedValue([{
    id: 'real-plan',
    title: '真实计划',
    targetDate: '2026-10-01T00:00:00.000Z',
    status: 'active',
  }])
  mocks.behavior.growth.mockResolvedValue({
    points: 88,
    courseProgress: [{ progress: 42, course: { slug: 'real-course' }, updatedAt: '2026-08-29T08:00:00.000Z' }],
    notes: [],
    labRuns: [{ status: 'submitted', progress: 100, lab: { slug: 'real-lab' }, startedAt: '2026-08-29T08:10:00.000Z' }],
    assessmentAttempts: [{ id: 'real-attempt', submittedAt: '2026-08-29T08:20:00.000Z' }],
    achievements: [{}],
    certificates: [],
    knowledgeStats: [{ accuracy: 75 }],
  })
})

describe('真实 API 学习状态隔离', () => {
  it('未登录时从严格空状态启动且不读取本地演示数据', async () => {
    const { learning, demoRead } = await setup()
    expect(demoRead).not.toHaveBeenCalled()
    expect(learning.courseProgress).toEqual({})
    expect(learning.labProgress).toEqual({})
    expect(learning.plans).toEqual([])
    expect(learning.recentCourses).toEqual([])
    expect(learning.recentLabs).toEqual([])
    expect(learning.accountSyncState).toBe('anonymous')
  })

  it('登录且服务端同步成功后仅填充真实账号数据', async () => {
    const { learning, auth } = await setup()
    await auth.login('student@example.invalid', 'test-password')
    expect(await learning.syncFromApi()).toBe(true)
    expect(learning.courseProgress).toEqual({ 'real-course': 42 })
    expect(learning.labProgress).toEqual({ 'real-lab': 100 })
    expect(learning.plans.map((item) => item.id)).toEqual(['real-plan'])
    expect(learning.recentCourses).toEqual(['real-course'])
    expect(learning.accountSyncState).toBe('synced')
    expect(learning.courseProgress).not.toHaveProperty('llm-zero')
    expect(learning.labProgress).not.toHaveProperty('agent-workbench')
  })

  it('退出账号后清空全部账号成长状态', async () => {
    const { learning, auth } = await setup()
    await auth.login('student@example.invalid', 'test-password')
    await learning.syncFromApi()
    await auth.logout()
    expect(auth.user).toBeNull()
    expect(learning.favorites).toEqual([])
    expect(learning.courseProgress).toEqual({})
    expect(learning.labProgress).toEqual({})
    expect(learning.plans).toEqual([])
    expect(learning.assessmentRecords).toEqual([])
    expect(learning.serverGrowth).toBeUndefined()
    expect(learning.accountSyncState).toBe('anonymous')
  })

  it('切换账号时先清空旧账号数据再接受新同步结果', async () => {
    const { learning, auth } = await setup()
    await auth.login('student@example.invalid', 'test-password')
    await learning.syncFromApi()
    mocks.behavior.favorites.mockResolvedValue([])
    mocks.behavior.plans.mockResolvedValue([])
    mocks.behavior.growth.mockResolvedValue({
      points: 12,
      courseProgress: [{ progress: 9, course: { slug: 'second-course' }, updatedAt: '2026-08-29T09:00:00.000Z' }],
      notes: [],
      labRuns: [],
      assessmentAttempts: [],
      achievements: [],
      certificates: [],
      knowledgeStats: [],
    })
    await auth.login('second@example.invalid', 'test-password')
    expect(learning.courseProgress).toEqual({})
    expect(learning.accountSyncState).toBe('anonymous')
    expect(await learning.syncFromApi()).toBe(true)
    expect(learning.courseProgress).toEqual({ 'second-course': 9 })
    expect(learning.courseProgress).not.toHaveProperty('real-course')
    expect(learning.accountSyncState).toBe('synced')
  })

  it('任一服务端同步失败时保持严格空状态', async () => {
    const { learning } = await setup()
    learning.courseProgress.stale = 66
    mocks.behavior.growth.mockRejectedValue(new Error('同步失败'))
    expect(await learning.syncFromApi()).toBe(false)
    expect(learning.courseProgress).toEqual({})
    expect(learning.plans).toEqual([])
    expect(learning.serverGrowth).toBeUndefined()
    expect(learning.accountSyncState).toBe('sync-error')
  })

  it('Refresh 失败时清除会话并发出账号状态清理事件', async () => {
    vi.resetModules()
    vi.stubEnv('VITE_DATA_MODE', 'api')
    const storage = memoryStorage()
    storage.setItem('student-access-token', 'expired-token')
    storage.setItem('student-user', '{"id":"stale"}')
    const dispatchEvent = vi.fn()
    vi.stubGlobal('sessionStorage', storage)
    vi.stubGlobal('window', { dispatchEvent })
    vi.stubGlobal('CustomEvent', class {
      constructor(public readonly type: string) {}
    })
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ code: 40101, message: '未登录' }), { status: 401 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ code: 40101, message: '刷新失败' }), { status: 401 })))
    const { AUTH_SESSION_CLEARED_EVENT, request } = await import('../services/api/client')
    await expect(request('/protected')).rejects.toThrow('未登录')
    expect(storage.getItem('student-access-token')).toBeNull()
    expect(storage.getItem('student-user')).toBeNull()
    expect(dispatchEvent).toHaveBeenCalledWith(expect.objectContaining({ type: AUTH_SESSION_CLEARED_EVENT }))
  })
})
