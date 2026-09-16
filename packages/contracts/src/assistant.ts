export interface AssistantConfigDto {
  enabled: boolean
  name: string
  welcome: string
  position: 'left' | 'right'
}
export interface AssistantAdminConfigDto extends AssistantConfigDto {
  revision: number
  modelConfigured: boolean
  modelName: string | null
  modelBaseUrl: string | null
}
export interface AssistantConfigInput extends AssistantConfigDto { expectedRevision: number }
export interface AssistantMessageDto { role: 'user' | 'assistant'; content: string }
export interface AssistantChatInput { messages: AssistantMessageDto[] }
export interface AssistantChatDto { reply: string }
export interface AssistantConnectionDto { ok: boolean; message: string }
export const assistantConfigDefaults: AssistantConfigDto = {
  enabled: true,
  name: '小雪助手',
  welcome: '你好，我是小雪！可以陪你探索 AI 知识、规划学习路线，或一起拆解学习中的问题。',
  position: 'right',
}
