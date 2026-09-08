import { api } from '../services/api'
import type { ContentDetectionResult } from '@ai-learning-hub/contracts'

interface PublishTarget {
  databaseId: string
}

export const usePublishAction = (kind: string) => ({
  publish: (item: PublishTarget) => api<{ status: string; detection?: ContentDetectionResult }>(`/admin/${kind}/${item.databaseId}/publish`, { method: 'POST' }),
  archive: (item: PublishTarget) => api(`/admin/${kind}/${item.databaseId}/archive`, { method: 'POST' }),
})
