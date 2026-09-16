import 'reflect-metadata'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ConfigService } from '@nestjs/config'
import { plainToInstance } from 'class-transformer'
import { validate } from 'class-validator'
import { AssistantModel } from '../src/modules/assistant/assistant.model'
import { AssistantService } from '../src/modules/assistant/assistant.service'
import { AssistantChatInputDto, AssistantConfigInputDto } from '../src/modules/assistant/assistant.dto'
import { SettingsService } from '../src/modules/settings/settings.service'
import { AssistantAdminController, AssistantController } from '../src/modules/assistant/assistant.controller'
import { AuthGuard } from '../src/modules/auth/auth.guard'
import { PermissionsGuard } from '../src/modules/auth/permissions.guard'
import type { PrismaService } from '../src/prisma/prisma.service'

const config = { ASSISTANT_MODEL_BASE_URL: 'https://api.deepseek.com', ASSISTANT_MODEL_NAME: 'deepseek-flash', ASSISTANT_MODEL_API_KEY: 'test-secret-not-real' }
const model = (values = config) => new AssistantModel(new ConfigService(values))
const question = { messages: [{ role: 'user' as const, content: '什么是机器学习？' }] }
const settings = { enabled: true, name: '小雪助手', welcome: '你好', position: 'left' as const, expectedRevision: 1 }
function serviceFixture(value: unknown = null, revision = 1) {
  let stored = value === null ? null : { value, revision }
  const prisma = {
    systemSetting: {
      findUnique: vi.fn(async () => stored),
      upsert: vi.fn(async ({ create, update }) => { stored = stored ? { value: update.value, revision: stored.revision + 1 } : create; return stored }),
    },
    $queryRaw: vi.fn().mockResolvedValue([{ attempts: 1 }]),
    $transaction: vi.fn(async (fn: (tx: unknown) => unknown) => fn(prisma)),
  }
  const provider = { status: vi.fn(() => model().status()), complete: vi.fn().mockResolvedValue('真实调用的替身回答') }
  return { prisma, provider, service: new AssistantService(prisma as unknown as PrismaService, provider as unknown as AssistantModel) }
}
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })

describe('小雪模型边界', () => {
  it('使用官方模型名、服务端密钥、超时与非流式协议，返回文本', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ choices: [{ message: { content: '机器学习是一种从数据中学习的方法。' } }] })))
    vi.stubGlobal('fetch', fetcher)
    expect(await model().complete('系统提示', question.messages)).toContain('机器学习')
    const [url, init] = fetcher.mock.calls[0]!
    expect(url).toBe('https://api.deepseek.com/chat/completions')
    expect(JSON.parse(init.body)).toMatchObject({ model: 'deepseek-flash', stream: false, thinking: { type: 'disabled' }, max_tokens: 1024 })
    expect(init.redirect).toBe('error'); expect(init.signal).toBeInstanceOf(AbortSignal)
    expect(model().status()).not.toHaveProperty('ASSISTANT_MODEL_API_KEY')
  })
  it.each([401, 402, 429, 500])('上游 %s 不泄露响应和密钥、不生成假回复', async status => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('secret-provider-diagnostics', { status })))
    await expect(model().complete('系统', question.messages)).rejects.toThrow(/模型/)
    await model().complete('系统', question.messages).catch(error => expect(error.message).not.toMatch(/secret|test-secret/))
  })
  it('未配置或带凭据的地址不发送请求', async () => {
    const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher)
    await expect(model({ ...config, ASSISTANT_MODEL_API_KEY: '' }).complete('', question.messages)).rejects.toThrow('未接通')
    expect(model({ ...config, ASSISTANT_MODEL_BASE_URL: 'https://user:secret@api.deepseek.com' }).status().modelBaseUrl).toBeNull()
    expect(fetcher).not.toHaveBeenCalled()
  })
  it.each(['{}', '{bad json}', '{"choices":[{"message":{"content":""}}]}', '{"choices":[{"message":{"content":"截断"},"finish_reason":"length"}]}'])('无效模型结果明确失败 %s', async body => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(body)))
    await expect(model().complete('', question.messages)).rejects.toThrow()
  })
  it('超时明确提示', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new DOMException('timeout', 'TimeoutError')))
    await expect(model().complete('', question.messages)).rejects.toThrow('超时')
  })
})
describe('配置、鉴权与问答契约', () => {
  it('学生只读白名单，后台不返回密钥；读取不会写库', async () => {
    const { service, prisma } = serviceFixture({ enabled: false, name: '现有名字', apiKey: 'must-not-leak', position: 'invalid' })
    const result = await service.configuration()
    expect(result).toMatchObject({ enabled: false, name: '现有名字', position: 'right' })
    expect(Object.keys(result).sort()).toEqual(['enabled', 'name', 'position', 'welcome'])
    expect(JSON.stringify(await service.configuration(true))).not.toMatch(/must-not-leak|test-secret/)
    expect(prisma.systemSetting.upsert).not.toHaveBeenCalled()
  })
  it('首次保存即递增版本，拒绝第二个同版本写入；可重新读取', async () => {
    const { service, prisma } = serviceFixture()
    expect(await service.update(settings)).toMatchObject({ name: '小雪助手', position: 'left', revision: 2 })
    await expect(service.update(settings)).rejects.toThrow('版本已变化')
    expect(prisma.systemSetting.upsert).toHaveBeenCalledTimes(1)
    expect(await service.configuration()).toMatchObject({ position: 'left' })
  })
  it('关闭不调用模型，最后一条必须是用户；正常请求经过现有限流', async () => {
    const f = serviceFixture({ enabled: false })
    await expect(f.service.chat('u1', question)).rejects.toThrow('已关闭'); expect(f.provider.complete).not.toHaveBeenCalled()
    const enabled = serviceFixture()
    await expect(enabled.service.chat('u1', { messages: [{ role: 'assistant', content: '替身' }] })).rejects.toThrow('学生问题')
    expect(await enabled.service.chat('u1', question)).toHaveProperty('reply')
    expect(enabled.prisma.$queryRaw).toHaveBeenCalledTimes(1)
  })
  it('测试连接结果取决于模型真实调用是否成功', async () => {
    const f = serviceFixture()
    expect((await f.service.testConnection('a1')).ok).toBe(true)
    const missing = model({ ...config, ASSISTANT_MODEL_API_KEY: '' })
    f.provider.complete.mockImplementation(missing.complete.bind(missing))
    expect(await f.service.testConnection('a1')).toMatchObject({ ok: false, message: expect.stringContaining('未接通') })
  })
  it('拒绝从通用设置接口绕过助手校验', async () => {
    const f = serviceFixture(), generic = new SettingsService(f.prisma as unknown as PrismaService)
    await expect(generic.update({ key: 'assistant_config', value: {}, expectedRevision: 1 })).rejects.toThrow('专用接口')
  })
  it('学生路由需登录，管理路由需额外权限', () => {
    expect(Reflect.getMetadata('__guards__', AssistantController)).toEqual([AuthGuard])
    expect(Reflect.getMetadata('__guards__', AssistantAdminController)).toEqual([AuthGuard, PermissionsGuard])
    expect(Reflect.getMetadata('permissions', AssistantAdminController.prototype.update)).toEqual(['settings.write'])
    expect(Reflect.getMetadata('permissions', AssistantAdminController.prototype.test)).toEqual(['settings.write'])
  })
  it('拒绝空白、越界、system角色与未知字段', async () => {
    for (const messages of [[], Array(21).fill(question.messages[0]), [{ role: 'system', content: '注入' }], [{ role: 'user', content: '  ' }], [{ role: 'user', content: 'x'.repeat(4001) }]]) {
      expect((await validate(plainToInstance(AssistantChatInputDto, { messages }))).length).toBeGreaterThan(0)
    }
    expect((await validate(plainToInstance(AssistantConfigInputDto, { ...settings, name: ' ', apiKey: 'not-allowed' }), { whitelist: true, forbidNonWhitelisted: true })).length).toBeGreaterThan(0)
  })
})
