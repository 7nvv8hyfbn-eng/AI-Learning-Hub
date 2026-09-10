import { resolveDataMode } from './data-mode'
import { randomId } from './random-id'
import { browserSession, serializedRefresh } from '../../../../packages/contracts/browser/session'
import { ACCOUNT_BANNED, SESSION_REPLACED, SESSION_REPLACED_MESSAGE } from '@ai-learning-hub/contracts'
export const studentSession = browserSession('student')
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

const refresh = async () => {
  if (studentSession.ended) return false
  const previous = studentSession.token(), generation = studentSession.generation
  const { status, body } = await serializedRefresh(baseUrl + '/auth/refresh', previous, 'student').catch(() => { throw new ApiError('连接暂时异常，请重新连接', 0) })
  if (generation !== studentSession.generation) return false
  if (status === 401) {
    studentSession.end(body?.errorCode, previous, body?.message)
    if (body?.errorCode === SESSION_REPLACED) throw new ApiError(SESSION_REPLACED_MESSAGE, 401, SESSION_REPLACED)
    if (body?.errorCode === ACCOUNT_BANNED) throw new ApiError(body.message || '账号已被封禁', 401, ACCOUNT_BANNED)
    return false
  }
  if (status < 200 || status >= 300) throw new ApiError('服务暂时不可用，请重新连接', status)
  if (!body || body.code !== 0 || !body.data?.accessToken) throw new ApiError('会话响应异常，请重新连接', 502)
  studentSession.rotate(body.data.accessToken)
  return true
}
export const restoreRefresh = () => refreshPromise ||= refresh().finally(() => { refreshPromise = null })

export async function request<T>(path: string, init: RequestInit = {}, retry = true): Promise<T> {
  const token = studentSession.token(), generation = studentSession.generation
  const authentication = path.startsWith('/auth/') || path.startsWith('/community/recovery')
  if (studentSession.ended && !authentication && !['GET', 'HEAD'].includes(init.method || 'GET')) throw new ApiError('请重新登录后手动提交，未同步内容已保留', 401)
  let response: Response
  try {
    response = await fetch(`${baseUrl}${path}`, {
      ...init,
      signal: init.signal ? AbortSignal.any([init.signal, studentSession.signal]) : studentSession.signal,
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
  const body = await response.json().catch(() => null) as Envelope<T> | null
  if (generation !== studentSession.generation) throw new ApiError('会话已变化，请重新操作', 401)
  if (response.status === 401 && body?.errorCode === ACCOUNT_BANNED) {
    studentSession.end(ACCOUNT_BANNED, token, body.message)
    throw new ApiError(body.message, 401, ACCOUNT_BANNED, body.availableAt, body.nextAction)
  }
  if (response.status === 401 && body?.errorCode === SESSION_REPLACED) {
    studentSession.end(SESSION_REPLACED, token)
    throw new ApiError(SESSION_REPLACED_MESSAGE, 401, SESSION_REPLACED)
  }
  if (response.status === 401 && retry && !authentication) {
    if (await restoreRefresh()) return request<T>(path, init, false)
  }
  if (!response.ok || !body || body.code !== 0) {
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
  const token = studentSession.token(), generation = studentSession.generation
  const load = () => fetch(`${baseUrl}/files/${encodeURIComponent(id)}/download`, { credentials: 'include', signal: studentSession.signal, headers: { authorization: `Bearer ${studentSession.token() || ''}` } })
  let response = await load()
  if (response.status === 401 && (await response.clone().json().catch(() => null))?.errorCode === SESSION_REPLACED) {
    studentSession.end(SESSION_REPLACED, token)
    throw new ApiError(SESSION_REPLACED_MESSAGE, 401, SESSION_REPLACED)
  }
  if (response.status === 401 && await restoreRefresh()) response = await load()
  if (!response.ok) throw new ApiError(response.status === 403 || response.status === 404 ? '资源不存在或没有下载权限' : '下载暂不可用，请重试', response.status)
  const blob = await response.blob()
  if (generation !== studentSession.generation) throw new ApiError('会话已变化，请重新下载', 401)
  return blob
}
