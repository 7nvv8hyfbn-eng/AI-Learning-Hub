import { request } from './client'

export interface AssistantMessage {
  role: 'user' | 'assistant'
  content: string
}

export interface AssistantConfig {
  enabled: boolean
  name: string
  welcome: string
  position: 'left' | 'right'
  digestEnabled: boolean
  keywords: boolean
  length: 'short' | 'standard' | 'long'
  style: 'plain' | 'professional' | 'friendly'
}

export interface AssistantChatReply {
  reply: string
}

export interface AssistantDigestReply {
  postId: string
  title: string
  summary: string
  keywords: string[]
}

export const DEFAULT_ASSISTANT_CONFIG: AssistantConfig = {
  enabled: true,
  name: '小雪助手',
  welcome: '我是小雪，你的AI学习伙伴。可以问我关于课程、路线和练习的问题。',
  position: 'right',
  digestEnabled: false,
  keywords: false,
  length: 'standard',
  style: 'friendly',
}

/** 助手配置：沿用 client.ts 的鉴权与错误解包；失败时由调用方保留默认并展示真实提示。 */
export async function studentConfig(): Promise<AssistantConfig> {
  return request<AssistantConfig>('/assistant/config', { method: 'GET' })
}

/** 小雪问答：失败抛出 ApiError 真实提示，不回退预设回复。 */
export async function chatAssistant(messages: AssistantMessage[], signal?: AbortSignal): Promise<AssistantChatReply> {
  return request<AssistantChatReply>('/assistant/chat', { method: 'POST', body: JSON.stringify({ messages }), signal }, true)
}

/** 帖子简讯（B05/B06 使用）。 */
export async function digestPost(postId: string, signal?: AbortSignal): Promise<AssistantDigestReply> {
  return request<AssistantDigestReply>('/assistant/digest', { method: 'POST', body: JSON.stringify({ postId }), signal }, true)
}