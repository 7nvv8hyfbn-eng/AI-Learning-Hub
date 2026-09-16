import { BadRequestException, ConflictException, Injectable, ServiceUnavailableException } from '@nestjs/common'
import { assistantConfigDefaults, type AssistantConfigDto, type AssistantConnectionDto } from '@ai-learning-hub/contracts'
import { PrismaService } from '../../prisma/prisma.service'
import { rateLimit } from '../../common/persistence'
import { AssistantModel } from './assistant.model'
import type { AssistantChatInputDto, AssistantConfigInputDto } from './assistant.dto'

@Injectable()
export class AssistantService {
  constructor(private readonly prisma: PrismaService, private readonly model: AssistantModel) {}

  private normalize(value: unknown): AssistantConfigDto {
    const v = (value && typeof value === 'object' && !Array.isArray(value) ? value : {}) as Partial<AssistantConfigDto>
    return {
      enabled: typeof v.enabled === 'boolean' ? v.enabled : assistantConfigDefaults.enabled,
      name: typeof v.name === 'string' && v.name.trim() && v.name.length <= 20 ? v.name : assistantConfigDefaults.name,
      welcome: typeof v.welcome === 'string' && v.welcome.trim() && v.welcome.length <= 200 ? v.welcome : assistantConfigDefaults.welcome,
      position: v.position === 'left' ? 'left' : 'right',
    }
  }
  async configuration(admin = false) {
    const stored = await this.prisma.systemSetting.findUnique({ where: { key: 'assistant_config' } })
    const value = this.normalize(stored?.value)
    return admin ? { ...value, revision: stored?.revision || 1, ...this.model.status() } : value
  }
  async update(input: AssistantConfigInputDto) {
    const { expectedRevision, enabled, name, welcome, position } = input
    await this.prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended('settings-version',0))::text`
      const current = await tx.systemSetting.findUnique({ where: { key: 'assistant_config' } })
      if ((current?.revision || 1) !== expectedRevision) throw new ConflictException('设置版本已变化，请重新读取后重试')
      await tx.systemSetting.upsert({
        where: { key: 'assistant_config' },
        create: { key: 'assistant_config', value: { enabled, name, welcome, position }, revision: 2 },
        update: { value: { enabled, name, welcome, position }, revision: { increment: 1 } },
      })
    })
    return this.configuration(true)
  }
  async chat(userId: string, input: AssistantChatInputDto) {
    if (input.messages.at(-1)?.role !== 'user') throw new BadRequestException('请以学生问题结束对话')
    const config = await this.configuration()
    if (!config.enabled) throw new ServiceUnavailableException('小雪助手已关闭，请稍后再试')
    await rateLimit(this.prisma, userId, 'assistant:model', 12)
    const reply = await this.model.complete('你是 DAILY-AI HUB 的小雪学习助手。用简体中文帮助学生理解 AI、规划学习和拆解问题。回答简明准确，控制在 800 字内。不确定时说明局限，不编造平台课程、链接或已执行的操作。', input.messages)
    return { reply }
  }
  async testConnection(userId: string): Promise<AssistantConnectionDto> {
    await rateLimit(this.prisma, userId, 'assistant:model', 12)
    try {
      await this.model.complete('这是学习助手连接测试，请简短回复。', [{ role: 'user', content: '请回复：连接正常' }])
      return { ok: true, message: '模型连接正常，已收到真实回答' }
    } catch (cause) {
      if (cause instanceof ServiceUnavailableException) return { ok: false, message: cause.message }
      throw cause
    }
  }
}
