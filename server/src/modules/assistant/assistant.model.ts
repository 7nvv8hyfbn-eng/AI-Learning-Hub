import { Injectable, ServiceUnavailableException } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import type { AssistantMessageDto } from '@ai-learning-hub/contracts'

@Injectable()
export class AssistantModel {
  constructor(private readonly config: ConfigService) {}

  status() {
    const modelName = this.config.get<string>('ASSISTANT_MODEL_NAME')?.trim() || null
    let modelBaseUrl: string | null = null
    try {
      const url = new URL(this.config.get<string>('ASSISTANT_MODEL_BASE_URL') || '')
      if (url.protocol === 'https:' && !url.username && !url.password && !url.search && !url.hash) modelBaseUrl = url.href.replace(/\/$/, '')
    } catch { /* 无效配置按未接通处理，不暴露原始配置。 */ }
    return { modelConfigured: !!(modelBaseUrl && modelName && this.config.get<string>('ASSISTANT_MODEL_API_KEY')?.trim()), modelName, modelBaseUrl }
  }

  async complete(system: string, messages: AssistantMessageDto[]): Promise<string> {
    const status = this.status()
    if (!status.modelConfigured) throw new ServiceUnavailableException('问答暂未接通：服务端还没有配置有效的模型地址、名称与密钥')
    try {
      const response = await fetch(`${status.modelBaseUrl}/chat/completions`, {
        method: 'POST', redirect: 'error', signal: AbortSignal.timeout(30_000),
        headers: { 'content-type': 'application/json', authorization: `Bearer ${this.config.get<string>('ASSISTANT_MODEL_API_KEY')!.trim()}` },
        body: JSON.stringify({ model: status.modelName, messages: [{ role: 'system', content: system }, ...messages], stream: false, max_tokens: 1024, thinking: { type: 'disabled' } }),
      })
      if (!response.ok) {
        const message = response.status === 401 || response.status === 403 ? '模型认证失败，请联系管理员检查服务端配置'
          : response.status === 402 ? '模型账户余额不足，请联系管理员'
            : response.status === 429 ? '模型请求繁忙，请稍后重试' : `模型服务暂时不可用（${response.status}），请稍后重试`
        throw new ServiceUnavailableException(message)
      }
      const result = await response.json() as { choices?: { message?: { content?: unknown }; finish_reason?: string }[] }
      const choice = result.choices?.[0], content = choice?.message?.content
      if (choice?.finish_reason === 'length') throw new ServiceUnavailableException('回答超出长度限制，请缩小问题范围后重试')
      if (typeof content !== 'string' || !content.trim() || content.length > 4000) throw new ServiceUnavailableException('模型没有返回有效回答，请重试')
      return content.trim()
    } catch (cause) {
      if (cause instanceof ServiceUnavailableException) throw cause
      if (cause instanceof Error && ['TimeoutError', 'AbortError'].includes(cause.name)) throw new ServiceUnavailableException('模型回答超时，请稍后重试')
      throw new ServiceUnavailableException('模型连接或响应异常，请稍后重试')
    }
  }
}
