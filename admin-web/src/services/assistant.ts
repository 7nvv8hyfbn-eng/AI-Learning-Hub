import type { AssistantAdminConfigDto, AssistantConfigInput, AssistantConnectionDto } from '@ai-learning-hub/contracts'
import { api } from './api'

export const assistantApi = {
  config: () => api<AssistantAdminConfigDto>('/admin/assistant/config'),
  save: (input: AssistantConfigInput) => api<AssistantAdminConfigDto>('/admin/assistant/config', { method: 'PATCH', body: JSON.stringify(input) }),
  test: () => api<AssistantConnectionDto>('/admin/assistant/test', { method: 'POST' }),
}
