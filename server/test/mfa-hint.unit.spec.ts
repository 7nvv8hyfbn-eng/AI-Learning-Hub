import { createHash } from 'node:crypto'
import { ConfigService } from '@nestjs/config'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { generate, generateSecret } from 'otplib'
import { AuthService } from '../src/modules/auth/auth.service'
import { encryptMfa } from '../src/modules/auth/mfa-crypto'

afterEach(() => vi.useRealTimers())
describe('体验环境验证码提示', () => {
  const setup = (profile?: string) => {
    const challenge = 'synthetic-challenge', secret = generateSecret(), key = 'a3'.repeat(32)
    const user = { id: 'admin', status: 'active', receivedModeration: [], sessionVersion: 1, mfaChallengeHash: createHash('sha256').update(challenge).digest('hex'), mfaLastTimeStep: null as number | null,
      mfaSecretEncrypted: encryptMfa(secret, key, 'admin'), userRoles: [{ role: { code: 'admin', permissions: [{ permission: { code: 'resource.read' } }] } }], profile: {} }
    const prisma = { user: { findUnique: vi.fn(async () => user) }, $queryRaw: vi.fn(async () => [{ attempts: 1 }]) }
    const jwt = { verifyAsync: vi.fn(async () => ({ id: 'admin', version: 1, purpose: 'admin-mfa' })) }
    const config = new ConfigService({ DEPLOYMENT_PROFILE: profile, MFA_DATA_KEY: key, JWT_SECRET: 'synthetic-only', ADMIN_NETWORK_CIDRS: '127.0.0.1/32' })
    return { user, secret, challenge, prisma, jwt, service: new AuthService(prisma as never, jwt as never, config, {} as never) }
  }
  it.each(['production', undefined])('未明确配置体验环境不返回提示：%s', async profile => {
    const { service, prisma, challenge } = setup(profile)
    await expect(service.mfaHint(challenge, '127.0.0.1')).rejects.toThrow('不提供验证码提示')
    expect(prisma.user.findUnique).not.toHaveBeenCalled()
  })
  it('提示匹配真实TOTP，当前步已使用则等待下一步', async () => {
    vi.useFakeTimers(); vi.setSystemTime(1800000000000)
    const { service, challenge, secret, user } = setup('experience')
    expect((await service.mfaHint(challenge, '127.0.0.1')).code).toBe(await generate({ secret }))
    user.mfaLastTimeStep = Math.floor(Date.now() / 30000)
    const used = await service.mfaHint(challenge, '127.0.0.1')
    expect(used.code).toBeNull()
    vi.setSystemTime(used.expiresAt)
    expect((await service.mfaHint(challenge, '127.0.0.1')).code).toMatch(/^\d{6}$/)
  })
  it('挑战撤销、会话版本变化和错误网络均拒绝', async () => {
    const { service, challenge, user } = setup('experience')
    await expect(service.mfaHint(challenge, '192.0.2.1')).rejects.toThrow('管理功能仅允许')
    user.sessionVersion++
    await expect(service.mfaHint(challenge, '127.0.0.1')).rejects.toThrow('已失效')
    user.sessionVersion--; user.mfaChallengeHash = 'revoked'
    await expect(service.mfaHint(challenge, '127.0.0.1')).rejects.toThrow('已失效')
  })
})
