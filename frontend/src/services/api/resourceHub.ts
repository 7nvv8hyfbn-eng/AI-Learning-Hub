import type { CreatorContentSummaryDto, LearningCollectionDto, LearningCollectionInput, LearningCollectionSummaryDto, ResourceContributionDetailDto, ResourceHubCategoryDto, ResourceHubHomeDto, ResourceHubListDto, VideoAssetDto, VideoPlaybackDto, WatchProgressInput } from '@ai-learning-hub/contracts'
import { ApiError, dataMode, request, restoreRefresh, writeRequest } from './client'
import { mockResourceHub } from './resourceHub.mock'
import { randomId } from './random-id'
import type { FileScanDto, StorageCapacityDto } from '@ai-learning-hub/contracts'

const call = <T>(path: string, method = 'GET', body?: unknown) => dataMode === 'api'
  ? method === 'GET' ? request<T>(`/resource-hub${path}`) : writeRequest<T>(`/resource-hub${path}`, method, body)
  : mockResourceHub<T>(path, method, body)

export type UploadHandle<T> = { promise: Promise<T>; cancel: () => void }
const upload = <T>(path: string, file: File, progress: (percentage: number) => void): UploadHandle<T> => {
  if (dataMode === 'mock') {
    progress(100)
    return { promise: mockResourceHub<T>(path, 'POST', file), cancel: () => undefined }
  }
  let active: XMLHttpRequest | null = null
  let cancelled = false
  const idempotencyKey = randomId()
  const promise = new Promise<T>((resolve, reject) => {
    const run = (retry: boolean) => {
      const xhr = active = new XMLHttpRequest()
      xhr.open('POST', `${import.meta.env.VITE_API_BASE_URL || '/api/v1'}/resource-hub${path}`)
      xhr.withCredentials = true
      const token = sessionStorage.getItem('student-access-token')
      if (token) xhr.setRequestHeader('authorization', `Bearer ${token}`)
      xhr.setRequestHeader('idempotency-key', idempotencyKey)
      xhr.upload.onprogress = (event) => { if (event.lengthComputable) progress(Math.round(event.loaded / event.total * 100)) }
      xhr.onerror = () => reject(new Error('上传连接中断，请重试'))
      xhr.onabort = () => { if (cancelled) reject(new Error('已取消上传')) }
      xhr.onload = async () => {
        if (xhr.status === 401 && retry) {
          try {
            if (await restoreRefresh()) { if (!cancelled) run(false); return }
          } catch { /* 继续返回本次上传错误。 */ }
        }
        try {
          const body = JSON.parse(xhr.responseText) as { code: number; errorCode?: string; message: string; data: T; availableAt?: string; nextAction?: { label: string; route: string } }
          if (xhr.status < 200 || xhr.status >= 300 || body.code !== 0) reject(new ApiError(body.message || `上传失败（${xhr.status}）`, xhr.status, body.errorCode, body.availableAt, body.nextAction))
          else resolve(body.data)
        } catch { reject(new Error(`上传响应异常（${xhr.status}）`)) }
      }
      const body = new FormData(); body.set('file', file); xhr.send(body)
    }
    run(true)
  })
  return { promise, cancel: () => { cancelled = true; active?.abort() } }
}

export const resourceHubApi = {
  home: () => call<ResourceHubHomeDto>('/home'),
  categories: () => call<ResourceHubCategoryDto[]>('/categories'),
  list: (query: { keyword?: string; category?: string; kind?: string; sort?: string; cursor?: string; limit?: number } = {}) => call<ResourceHubListDto>(`/items?${new URLSearchParams(Object.entries(query).flatMap(([key, value]) => value === undefined || value === '' ? [] : [[key, String(value)]]))}`),
  detail: (postId: string) => call<ResourceContributionDetailDto>(`/contributions/${encodeURIComponent(postId)}`),
  studio: () => call<CreatorContentSummaryDto>('/studio'),
  capacity: () => call<StorageCapacityDto>('/capacity'),
  creator: (userId: string) => call<{ items: ResourceHubListDto['items']; collections: LearningCollectionSummaryDto[] }>(`/creators/${encodeURIComponent(userId)}`),
  video: (assetId: string) => call<VideoAssetDto>(`/videos/${encodeURIComponent(assetId)}`),
  playback: (assetId: string) => call<VideoPlaybackDto>(`/videos/${encodeURIComponent(assetId)}/playback`),
  progress: (assetId: string, input: WatchProgressInput) => call<{ positionSeconds: number; watchedSeconds: number; completed: boolean }>(`/videos/${encodeURIComponent(assetId)}/progress`, 'PUT', input),
  retryVideo: (assetId: string) => call<VideoAssetDto>(`/videos/${encodeURIComponent(assetId)}/retry`, 'POST'),
  uploadVideo: (file: File, progress: (percentage: number) => void) => upload<VideoAssetDto>('/uploads/video', file, progress),
  uploadDocument: (file: File, progress: (percentage: number) => void) => upload<{ id: string; originalName: string; mimeType: string; size: number; securityScan?: FileScanDto }>('/uploads/document', file, progress),
  collections: () => call<LearningCollectionSummaryDto[]>('/collections'),
  collection: (id: string) => call<LearningCollectionDto>(`/collections/${encodeURIComponent(id)}`),
  createCollection: (input: LearningCollectionInput) => call<LearningCollectionDto>('/collections', 'POST', input),
  updateCollection: (id: string, input: LearningCollectionInput) => call<LearningCollectionDto>(`/collections/${encodeURIComponent(id)}`, 'PATCH', input),
  addToCollection: (id: string, postId: string) => call<LearningCollectionDto>(`/collections/${encodeURIComponent(id)}/items`, 'POST', { postId }),
  removeFromCollection: (id: string, itemId: string) => call<LearningCollectionDto>(`/collections/${encodeURIComponent(id)}/items/${encodeURIComponent(itemId)}`, 'DELETE'),
  reorderCollection: (id: string, expectedRevision: number, itemIds: string[]) => call<LearningCollectionDto>(`/collections/${encodeURIComponent(id)}/order`, 'PUT', { expectedRevision, itemIds }),
}
