import { api } from './api'

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

export interface AdminAssistantConfig extends AssistantConfig {
  revision: number
  modelConfigured: boolean
  modelName?: string
  modelBaseUrl?: string
}

export interface TestConnectionResult {
  ok: boolean
  message?: string
}

export async function adminAssistantConfig() {
  return api<AdminAssistantConfig>('/admin/assistant/config')
}

export async function saveAdminAssistantConfig(input: AssistantConfig & { expectedRevision: number }) {
  return api<{ revision: number }>('/admin/assistant/config', { method: 'PATCH', body: JSON.stringify(input) })
}

export async function testAssistantConnection() {
  return api<TestConnectionResult>('/admin/assistant/test-connection', { method: 'POST' })
}