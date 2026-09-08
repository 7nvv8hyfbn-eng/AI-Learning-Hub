import { resolveDataMode } from './data-mode'
import { randomId } from './random-id'
export const dataMode = resolveDataMode(import.meta.env.VITE_DATA_MODE, import.meta.env.PROD, import.meta.env.MODE)
const baseUrl = import.meta.env.VITE_API_BASE_URL || '/api/v1'

interface Envelope<T> {
  code: number
  errorCode?: string
  availableAt?: string
  nextAction?: { label: string; route: string }
  message: string
  data: T
  requestId: string
}

let refreshPromise: Promise<boolean> | null = null
export class ApiError extends Error {
  constructor(message: string, public status: number, public code?: string, public availableAt?: string, public nextAction?: { label: string; route: string }) { super(availableAt ? `${message}（预计 ${new Date(availableAt).toLocaleString('zh-CN')} 可重试）` : message) }
}
export const AUTH_SESSION_CLEARED_EVENT = 'student-auth-session-cleared'
export const COMMUNITY_VERIFICATION_REQUIRED_EVENT = 'community-verification-required'

const clearSession = () => {
  sessionStorage.removeItem('student-access-token')
  sessionStorage.removeItem('student-user')
  window.dispatchEvent(new CustomEvent(AUTH_SESSION_CLEARED_EVENT))
}

const refresh = async () => {
  const response = await fetch(`${baseUrl}/auth/refresh`, { method: 'POST', credentials: 'include' })
  if (!response.ok) {
    if (response.status === 401) { clearSession(); return false }
    throw new ApiError('服务暂时不可用，请重新连接', response.status)
  }
  const body = await response.json().catch(() => null) as Envelope<{ accessToken: string }> | null
  if (!body || body.code !== 0 || !body.data.accessToken) {
    throw new ApiError('会话响应异常，请重新连接', 502)
  }
  sessionStorage.setItem('student-access-token', body.data.accessToken)
  return true
}
export const restoreRefresh = () => refreshPromise ||= refresh().finally(() => { refreshPromise = null })

export async function request<T>(path: string, init: RequestInit = {}, retry = true): Promise<T> {
  const token = sessionStorage.getItem('student-access-token')
  let response: Response
  try {
    response = await fetch(`${baseUrl}${path}`, {
      ...init,
      credentials: 'include',
      headers: {
        ...(init.body instanceof FormData ? {} : { 'content-type': 'application/json' }),
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...init.headers,
      },
    })
  } catch {
    throw new ApiError('网络暂时不可用，请重新连接；未回退到 Mock 数据', 0)
  }
  if (response.status === 401 && retry) {
    if (await restoreRefresh()) return request<T>(path, init, false)
  }
  const body = await response.json().catch(() => null) as Envelope<T> | null
  if (!response.ok || !body || body.code !== 0) {
    if (body?.errorCode === 'COMMUNITY_VERIFICATION_REQUIRED') window.dispatchEvent(new CustomEvent(COMMUNITY_VERIFICATION_REQUIRED_EVENT))
    throw new ApiError(body?.message || `请求失败（${response.status}）`, response.status, body?.errorCode, body?.availableAt, body?.nextAction)
  }
  return body.data
}
const pendingWrites = new Map<string, string>()
/** 丢失响应后以相同键重试；仅内存保存，成功后释放。草稿可传入本地恢复快照中的稳定键。 */
export async function writeRequest<T>(path: string, method: string, body: unknown, key?: string, retry = true) {
  const serialized = JSON.stringify(body), operation = `${method}:${path}:${serialized}`
  if (!pendingWrites.has(operation)) {
    if (pendingWrites.size >= 64) pendingWrites.delete(pendingWrites.keys().next().value!)
    pendingWrites.set(operation, key || randomId())
  }
  const result = await request<T>(path, { method, body: serialized, headers: { 'idempotency-key': pendingWrites.get(operation)! } }, retry)
  pendingWrites.delete(operation)
  return result
}
export async function downloadFile(id: string) {
  const load = () => fetch(`${baseUrl}/files/${encodeURIComponent(id)}/download`, { credentials: 'include', headers: { authorization: `Bearer ${sessionStorage.getItem('student-access-token') || ''}` } })
  let response = await load()
  if (response.status === 401 && await restoreRefresh()) response = await load()
  if (!response.ok) throw new ApiError(response.status === 403 || response.status === 404 ? '资源不存在或没有下载权限' : '下载暂不可用，请重试', response.status)
  return response.blob()
}
