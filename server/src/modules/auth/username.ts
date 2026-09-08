import { BadRequestException } from '@nestjs/common'

export const USERNAME_PATTERN = /^(?!_)(?!.*__)[a-z0-9_]{4,24}(?<!_)$/
export const RESERVED_USERNAMES = ['admin', 'administrator', 'root', 'system', 'official', 'moderator', 'support', 'api', 'www']

export function normalizeUsername(value: string) {
  const username = value.trim().toLowerCase()
  if (!USERNAME_PATTERN.test(username)) throw new BadRequestException('账号须为4～24位英文字母、数字或下划线，且下划线不能位于首尾或连续出现')
  if (RESERVED_USERNAMES.includes(username)) throw new BadRequestException('该账号名称不可使用')
  return username
}
