import { beforeEach, expect, it, vi } from 'vitest'
const client = vi.hoisted(() => ({ dataMode: 'api', request: vi.fn() }))
vi.mock('../src/services/api/client', () => client)
import { assistantApi } from '../src/services/api/assistant'
beforeEach(() => { client.dataMode = 'api'; client.request.mockReset() })
it('助手请求复用现有客户端，路径不重复 API 前缀，传递取消信号', async () => {
  const controller = new AbortController(), input = { messages: [{ role: 'user' as const, content: '你好' }] }
  await assistantApi.config(controller.signal); await assistantApi.chat(input, controller.signal)
  expect(client.request).toHaveBeenNthCalledWith(1, '/assistant/config', { signal: controller.signal })
  expect(client.request).toHaveBeenNthCalledWith(2, '/assistant/chat', { method: 'POST', body: JSON.stringify(input), signal: controller.signal })
})
it('演示模式不伪造模型回答，也不向后端发起问答', async () => {
  client.dataMode = 'mock'
  await expect(assistantApi.chat({ messages: [{ role: 'user', content: '你好' }] })).rejects.toThrow('问答暂未接通')
  expect(client.request).not.toHaveBeenCalled()
})
