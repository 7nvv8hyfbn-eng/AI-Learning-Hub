import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError, AUTH_SESSION_CLEARED_EVENT, request, restoreRefresh } from '../src/services/api/client'
import { authApi } from '../src/services/api/auth'
import { assessmentApi } from '../src/services/api/assessments'
const stored = new Map<string, string>()
beforeEach(() => {
  stored.clear(); stored.set('student-access-token', 'local-test-token')
  vi.stubGlobal('sessionStorage', { getItem: (key: string) => stored.get(key) || null, setItem: (key: string, value: string) => stored.set(key, value), removeItem: (key: string) => stored.delete(key) })
  vi.stubGlobal('window', new EventTarget())
})
afterEach(() => vi.unstubAllGlobals())
describe('真实HTTP客户端会话边界', () => {
  it('资格错误保留结构化字段并在人机提示中带出解除时间', () => {
    const error = new ApiError('发布过于频繁', 429, 'COMMUNITY_RATE_LIMITED', '2026-09-06T12:00:00.000Z')
    expect(error).toMatchObject({ status: 429, code: 'COMMUNITY_RATE_LIMITED', availableAt: '2026-09-06T12:00:00.000Z' })
    expect(error.message).toContain('可重试')
  })
  it.each(['注册', '测评'] as const)('普通HTTP%s可发送请求，丢失响应后同键重试，成功后新操作换键', async (kind) => {
    const source = globalThis.crypto
    vi.stubGlobal('crypto', { getRandomValues: source.getRandomValues.bind(source) })
    expect(crypto.randomUUID).toBeUndefined()
    const fetcher = vi.fn<typeof fetch>().mockRejectedValueOnce(new TypeError('response lost')).mockImplementation(async () => new Response(JSON.stringify({ code: 0, data: { user: { id: 'http-registered' }, accessToken: 'isolated-test-token', score: 100 } })))
    vi.stubGlobal('fetch', fetcher)
    const input = { username: 'http_test_user', displayName: 'HTTP测试用户', email: 'http-registration@example.test', password: 'IsolatedTestOnly123!', agreementVersion: 'v1' }
    const submit = kind === '注册' ? () => authApi.register(input) : () => assessmentApi.submit('http-quiz', [{ questionId: 'q1', answer: 'a' }])
    await expect(submit()).rejects.toMatchObject({ status: 0 })
    expect(fetcher).toHaveBeenCalledOnce()
    await expect(submit()).resolves.toMatchObject(kind === '注册' ? { id: 'http-registered' } : { score: 100 })
    await submit()
    const keys = fetcher.mock.calls.map(([, init]) => (init?.headers as Record<string, string>)['idempotency-key'])
    expect(keys[0]).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
    expect(keys[1]).toBe(keys[0]); expect(keys[2]).not.toBe(keys[0])
    expect(fetcher.mock.calls.every(([url, init]) => String(url).endsWith(kind === '注册' ? '/auth/register' : '/challenges/http-quiz/submit') && init?.method === 'POST')).toBe(true)
    expect(fetcher.mock.calls[1][1]?.body).toBe(fetcher.mock.calls[0][1]?.body)
  })
  it('刷新503不清空会话，网络错误不回退演示数据', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 503 })))
    await expect(restoreRefresh()).rejects.toMatchObject({ status: 503 })
    expect(stored.has('student-access-token')).toBe(true)
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('offline')))
    await expect(request('/me')).rejects.toBeInstanceOf(ApiError)
    expect(stored.has('student-access-token')).toBe(true)
  })
  it('刷新401清空旧凭据且广播重新登录门禁', async () => {
    const listener = vi.fn(); window.addEventListener(AUTH_SESSION_CLEARED_EVENT, listener)
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 401 })))
    expect(await restoreRefresh()).toBe(false)
    expect(stored.has('student-access-token')).toBe(false); expect(listener).toHaveBeenCalledOnce()
  })
  it('并发刷新仅一条请求，完成后下一次能够重新刷新', async () => {
    const fetcher = vi.fn().mockImplementation(async () => new Response(JSON.stringify({ code: 0, data: { accessToken: 'renewed-test-token' } })))
    vi.stubGlobal('fetch', fetcher)
    await Promise.all([restoreRefresh(), restoreRefresh(), restoreRefresh()])
    expect(fetcher).toHaveBeenCalledOnce()
    await restoreRefresh()
    expect(fetcher).toHaveBeenCalledTimes(2)
  })
})
