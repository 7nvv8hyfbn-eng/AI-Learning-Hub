import { ConflictException, HttpException, Injectable, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { JwtService } from '@nestjs/jwt'
import { compare } from 'bcryptjs'
import { createHash, randomBytes } from 'node:crypto'
import { WechatMiniappService } from '../../integrations/wechat/wechat-miniapp.service'
import { PrismaService } from '../../prisma/prisma.service'
import type { AuthUser } from './auth.types'
import { durationMs } from './auth-ttl'
import { Prisma } from '@prisma/client'
import { authUserDto, authUserInclude } from './auth.mapper'
import { actionEvent, lockUser, rateLimit } from '../../common/persistence'
import { isEmail } from 'class-validator'
import { activeSanction } from '../community/governance-policy'

const hashToken = (token: string) => createHash('sha256').update(token).digest('hex')
@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly wechat: WechatMiniappService,
  ) {}

  async recoverySession(identifier: string, password: string, ip: string) {
    const normalized = identifier.trim().toLowerCase()
    await rateLimit(this.prisma, normalized, 'recovery:account', 5, 15 * 60000, '账号恢复验证过于频繁，请稍后重试')
    await rateLimit(this.prisma, ip, 'recovery:ip', 50, 15 * 60000, '当前网络验证过于频繁，请稍后重试')
    const user = await this.prisma.user.findFirst({ where: isEmail(normalized) ? { email: { equals: normalized, mode: 'insensitive' } } : { username: { equals: normalized, mode: 'insensitive' } } })
    if (!user?.passwordHash || !await compare(password, user.passwordHash)) throw new UnauthorizedException('账号或密码错误')
    // 使用现有密码验证，只签发申诉范围的短凭据；不恢复账号、不签发普通会话。
    const token = await this.jwt.signAsync({ sub: user.id, purpose: 'community_recovery', sessionVersion: user.sessionVersion }, { secret: this.config.getOrThrow('JWT_SECRET'), expiresIn: 600, audience: 'community-recovery' })
    await this.prisma.auditLog.create({ data: { actorId: user.id, action: 'account_recovery_verified', targetType: 'user', targetId: user.id } })
    return { token, expiresIn: 600 }
  }
  async recoveryIdentity(authorization?: string) {
    try {
      const token = authorization?.match(/^Bearer (.+)$/)?.[1]
      if (!token) throw new Error()
      const payload = await this.jwt.verifyAsync<{ sub: string; purpose: string; sessionVersion: number }>(token, { secret: this.config.getOrThrow('JWT_SECRET'), audience: 'community-recovery' })
      if (payload.purpose !== 'community_recovery' || !payload.sub) throw new Error()
      const user = await this.prisma.user.findUnique({ where: { id: payload.sub }, select: { sessionVersion: true } })
      if (!user || user.sessionVersion !== payload.sessionVersion) throw new Error()
      return payload.sub
    } catch { throw new UnauthorizedException('恢复凭据已失效，请重新验证账号') }
  }
  async login(identifier: string, password: string, clientKey: string, ip: string) {
    identifier = identifier.trim()
    const normalizedIdentifier = identifier.toLowerCase()
    const identityKey = hashToken(clientKey)
    await rateLimit(this.prisma, normalizedIdentifier, 'login:account', 20, 15 * 60000, '该账号登录尝试过于频繁，请稍后再试', 'LOGIN_RATE_LIMITED')
    await rateLimit(this.prisma, ip, 'login:ip', 300, 15 * 60000, '当前网络登录尝试过于频繁，请稍后再试', 'LOGIN_RATE_LIMITED')
    const current = await this.prisma.loginThrottle.findUnique({ where: { identityKey } })
    if (current?.blockedUntil && current.blockedUntil > new Date()) {
      const retryAfter = Math.max(1, Math.ceil((current.blockedUntil.getTime() - Date.now()) / 1000))
      throw new HttpException({ message: '登录失败次数过多，请稍后再试', errorCode: 'LOGIN_RATE_LIMITED', retryAfter, availableAt: current.blockedUntil.toISOString() }, 429)
    }
    const user = await this.prisma.user.findFirst({
      where: isEmail(identifier) ? { email: { equals: normalizedIdentifier, mode: 'insensitive' } } : { username: { equals: normalizedIdentifier, mode: 'insensitive' } },
      include: authUserInclude,
    })
    const passwordValid = !!user?.passwordHash && await compare(password, user.passwordHash)
    if (!user || !passwordValid || user.status !== 'active') {
      await this.prisma.$executeRaw`INSERT INTO login_throttles(identity_key,failures,expires_at,updated_at)
        VALUES(${identityKey},1,NOW()+INTERVAL '15 minutes',NOW())
        ON CONFLICT(identity_key) DO UPDATE SET
        failures=CASE WHEN login_throttles.expires_at<NOW() THEN 1 ELSE login_throttles.failures+1 END,
        blocked_until=CASE WHEN login_throttles.expires_at>=NOW() AND login_throttles.failures>=4 THEN NOW()+INTERVAL '1 minute' ELSE NULL END,
        expires_at=CASE WHEN login_throttles.expires_at<NOW() THEN NOW()+INTERVAL '15 minutes' ELSE login_throttles.expires_at END,
        updated_at=NOW()`
      await this.prisma.loginLog.create({ data: { userId: user?.id, identifier: normalizedIdentifier, ipHash: hashToken(ip), result: 'failed' } })
      throw new UnauthorizedException('账号或密码错误')
    }
    await this.prisma.loginThrottle.deleteMany({ where: { identityKey } })
    return this.prisma.$transaction(async (tx) => {
      await lockUser(tx, user.id)
      const locked = await tx.user.findUniqueOrThrow({ where: { id: user.id } })
      if (locked.status !== 'active' || locked.passwordHash !== user.passwordHash) throw new UnauthorizedException('账号凭证已变化，请重新登录')
      const fresh = await tx.user.update({ where: { id: user.id, status: 'active' }, data: { lastLoginAt: new Date() }, include: authUserInclude })
      await tx.loginLog.create({ data: { userId: user.id, identifier: normalizedIdentifier, ipHash: hashToken(ip), result: 'success' } })
      await actionEvent(tx, user.id, 'user_logged_in', 'user', user.id)
      const profile = authUserDto(fresh)
      return { user: profile, ...(await this.createSession(profile, tx)) }
    })
  }

  async createSession(user: AuthUser, tx: Prisma.TransactionClient = this.prisma): Promise<{ accessToken: string; refreshToken: string; expiresIn: number }> {
    if (tx === this.prisma) return this.prisma.$transaction((inner) => this.createSession(user, inner))
    await lockUser(tx, user.id)
    const current = await tx.user.findUniqueOrThrow({ where: { id: user.id }, include: authUserInclude })
    if (current.status !== 'active' || current.sessionVersion !== (user.sessionVersion || 0)) throw new UnauthorizedException('账号会话已变化，请重新登录')
    if (await tx.communityModerationAction.count({ where: { ...activeSanction('ban'), subjectId: user.id } })) throw new UnauthorizedException('账号被限制登录，请通过账号恢复与申诉入口查看处理决定')
    user = authUserDto(current)
    const accessTtl = this.config.get<string>('ACCESS_TOKEN_TTL') || '15m'
    const accessToken = await this.jwt.signAsync(user, {
      secret: this.config.getOrThrow('JWT_SECRET'),
      expiresIn: Math.floor(durationMs(accessTtl, '15m') / 1000),
    })
    const refreshToken = randomBytes(48).toString('base64url')
    const ttl = this.config.get('REFRESH_TOKEN_TTL') || `${this.config.get('REFRESH_TOKEN_DAYS') || '7'}d`
    await tx.refreshToken.create({
      data: {
        userId: user.id,
        tokenHash: hashToken(refreshToken),
        expiresAt: new Date(Date.now() + durationMs(ttl, '7d')),
      },
    })
    return { accessToken, refreshToken, expiresIn: Math.floor(durationMs(accessTtl, '15m') / 1000) }
  }

  async refresh(refreshToken: string) {
    const stored = await this.prisma.refreshToken.findUnique({
      where: { tokenHash: hashToken(refreshToken) },
      include: {
        user: {
          include: authUserInclude,
        },
      },
    })
    if (!stored || stored.revokedAt || stored.expiresAt <= new Date() || stored.user.status !== 'active') {
      throw new UnauthorizedException('刷新凭据已失效')
    }
    return this.prisma.$transaction(async (tx) => {
      await lockUser(tx, stored.userId)
      const current = await tx.refreshToken.findUnique({ where: { id: stored.id }, include: { user: { include: authUserInclude } } })
      if (!current || current.revokedAt || current.expiresAt <= new Date() || current.user.status !== 'active') throw new UnauthorizedException('刷新凭据已失效')
      const claimed = await tx.refreshToken.updateMany({ where: { id: stored.id, revokedAt: null }, data: { revokedAt: new Date() } })
      if (!claimed.count) throw new UnauthorizedException('刷新凭据已失效')
      return this.createSession(authUserDto(current.user), tx)
    })
  }

  async logout(refreshToken?: string) {
    if (!refreshToken) return
    await this.prisma.refreshToken.updateMany({ where: { tokenHash: hashToken(refreshToken), revokedAt: null }, data: { revokedAt: new Date() } })
  }

  async wechatLogin(code: string) {
    const external = await this.wechat.exchange(code)
    const identity = await this.prisma.authIdentity.findUnique({
      where: { provider_providerUid: { provider: 'wechat_miniapp', providerUid: external.providerUid } },
      include: {
        user: {
          include: authUserInclude,
        },
      },
    })
    if (identity) {
      if (identity.user.status !== 'active') throw new UnauthorizedException('账号已禁用')
      const profile = authUserDto(identity.user)
      return { user: profile, ...(await this.createSession(profile)) }
    }
    const role = await this.prisma.role.findUnique({ where: { code: 'student' } })
    if (!role) throw new ServiceUnavailableException('学生角色尚未初始化')
    const suffix = hashToken(external.providerUid).slice(0, 16)
    const user = await this.prisma.user.create({
      data: {
        username: `wx_${suffix}`,
        email: `${suffix}@wechat.local`,
        displayName: `微信用户${suffix.slice(0, 4)}`,
        passwordHash: null,
        identities: { create: { provider: 'wechat_miniapp', providerUid: external.providerUid, metadata: external.unionid ? { unionid: external.unionid } : {} } },
        userRoles: { create: { roleId: role.id } },
      },
      include: authUserInclude,
    })
    const profile = authUserDto(user)
    return { user: profile, ...(await this.createSession(profile)) }
  }

  async bindWechat(userId: string, code: string) {
    const external = await this.wechat.exchange(code)
    const existing = await this.prisma.authIdentity.findUnique({
      where: { provider_providerUid: { provider: 'wechat_miniapp', providerUid: external.providerUid } },
    })
    if (existing && existing.userId !== userId) throw new ConflictException('该微信身份已绑定其他账号')
    return this.prisma.authIdentity.upsert({
      where: { userId_provider: { userId, provider: 'wechat_miniapp' } },
      update: { providerUid: external.providerUid, metadata: external.unionid ? { unionid: external.unionid } : {} },
      create: { userId, provider: 'wechat_miniapp', providerUid: external.providerUid, metadata: external.unionid ? { unionid: external.unionid } : {} },
      select: { id: true, provider: true, createdAt: true },
    })
  }
}
