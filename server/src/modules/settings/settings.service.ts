import { BadRequestException, ConflictException, Injectable } from '@nestjs/common'
import { Prisma } from '@prisma/client'
import { PrismaService } from '../../prisma/prisma.service'
import type { BatchSettingsDto, UpdateSettingDto } from './settings.dto'

@Injectable()
export class SettingsService {
  constructor(private readonly prisma: PrismaService) {}

  async list() {
    const settings = await this.prisma.systemSetting.findMany({ orderBy: { key: 'asc' } })
    return settings.map((item) => ({
      key: item.key,
      value: item.sensitive ? null : item.value,
      sensitive: item.sensitive,
      updatedAt: item.updatedAt,
      revision: item.revision,
    }))
  }

  private validate(input: UpdateSettingDto) {
    if (input.key === 'assistant_config') throw new BadRequestException('助手设置请使用小雪助手专用接口')
    if (input.key === 'registration') throw new BadRequestException('注册设置请使用专用注册管理接口')
    if (input.key === 'public_page_visuals') throw new BadRequestException('页面视觉资源请使用独立媒体权限与专用接口')
    const stringKeys = ['platform_name', 'platform_subtitle']
    const numberKeys = ['upload_max_mb', 'session_minutes']
    const arrayKeys = ['allowed_file_types', 'allowed_login_domains']
    if (stringKeys.includes(input.key) && typeof input.value !== 'string') throw new BadRequestException(`${input.key} 必须是字符串`)
    if (numberKeys.includes(input.key) && (typeof input.value !== 'number' || !Number.isFinite(input.value))) throw new BadRequestException(`${input.key} 必须是数字`)
    if (arrayKeys.includes(input.key) && (!Array.isArray(input.value) || input.value.some((item) => typeof item !== 'string'))) throw new BadRequestException(`${input.key} 必须是字符串数组`)
    if (input.key === 'notification_enabled' && typeof input.value !== 'boolean') throw new BadRequestException('notification_enabled 必须是布尔值')
  }

  async update(input: UpdateSettingDto) {
    this.validate(input)
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended('settings-version',0))::text`
      const current = await tx.systemSetting.findUnique({ where: { key: input.key } })
      if (current && current.revision !== input.expectedRevision) throw new ConflictException('设置版本已变化，请刷新后重试')
      const updated = await tx.systemSetting.upsert({ where: { key: input.key }, create: { key: input.key, value: input.value as Prisma.InputJsonValue }, update: { value: input.value as Prisma.InputJsonValue, revision: { increment: 1 } } })
      const version = await tx.systemSetting.findUnique({ where: { key: 'settings_version' } })
      await tx.systemSetting.upsert({ where: { key: 'settings_version' }, create: { key: 'settings_version', value: 1 }, update: { value: Number(version?.value || 0) + 1, revision: { increment: 1 } } })
      return updated
    })
  }

  batch(input: BatchSettingsDto) {
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended('settings-version',0))::text`
      const current = await tx.systemSetting.findUnique({ where: { key: 'settings_version' } })
      const currentVersion = Number(current?.value || 0)
      if (input.version !== currentVersion + 1) throw new ConflictException('设置版本已变化，请刷新后重试')
      for (const item of input.items) {
        this.validate(item)
        await tx.systemSetting.upsert({
          where: { key: item.key },
          update: { value: item.value as Prisma.InputJsonValue, revision: { increment: 1 } },
          create: { key: item.key, value: item.value as Prisma.InputJsonValue, sensitive: false },
        })
      }
      await tx.systemSetting.upsert({
        where: { key: 'settings_version' },
        update: { value: input.version },
        create: { key: 'settings_version', value: input.version, sensitive: false },
      })
      return { version: input.version, updated: input.items.length }
    })
  }
}
