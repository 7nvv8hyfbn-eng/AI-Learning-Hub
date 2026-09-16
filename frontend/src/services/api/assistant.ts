import { assistantConfigDefaults, type AssistantConfigDto, type AssistantChatInput, type AssistantChatDto, type AssistantDigestInput, type AssistantDigestDto } from '@ai-learning-hub/contracts'
import { dataMode, request } from './client'

export const assistantApi = {
  config: (signal?: AbortSignal): Promise<AssistantConfigDto> => dataMode === 'api'
    ? request('/assistant/config', { signal }) : Promise.resolve({ ...assistantConfigDefaults }),
  chat: (input: AssistantChatInput, signal?: AbortSignal): Promise<AssistantChatDto> => {
    if (dataMode !== 'api') return Promise.reject(new Error('问答暂未接通：当前是演示数据源，请在 API 模式连接后端'))
    return request('/assistant/chat', { method: 'POST', body: JSON.stringify(input), signal })
  },
  digest: (input: AssistantDigestInput, signal?: AbortSignal): Promise<AssistantDigestDto> => {
    if (dataMode !== 'api') return Promise.reject(new Error('简讯暂未接通：当前是演示数据源，请在 API 模式连接后端'))
    return request('/assistant/digest', { method: 'POST', body: JSON.stringify(input), signal })
  },
}
