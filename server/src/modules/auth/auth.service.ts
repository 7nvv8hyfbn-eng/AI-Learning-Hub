import { loadBadgeContext } from '../community/user-badges'
import { BadRequestException, ConflictException, ForbiddenException, HttpException, Injectable, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { JwtService } from '@nestjs/jwt'
import { compare } from 'bcryptjs'
import { createHash, randomBytes } from 'node:crypto'
import { WechatMiniappService } from '../../integrations/wechat/wechat-miniapp.service'
import { PrismaService } from '../../prisma/prisma.service'
import type { AuthUser } from './auth.types'
import { durationMs } from './auth-ttl'
import { Prisma, type User } from '@prisma/client'
import { authUserDto, authUserInclude } from './auth.mapper'
import { actionEvent, lockUser, rateLimit } from '../../common/persistence'
import { isEmail } from 'class-validator'
import { availableAccount } from '../community/governance-policy'
import { generate, generateSecret, generateURI, verify } from 'otplib'
import type { DeviceSessionDto, MfaChallengeDto, ReauthenticateInput, SessionClient } from '@ai-learning-hub/contracts'
import { decryptMfa, encryptMfa } from './mfa-crypto'
import { assertAdminNetwork } from '../../common/deployment-security'
import { assertNotBanned, assertNotReplaced } from './session-revocation'

const hashToken = (token: string) => createHash('sha256').update(token).digest('hex')
type SessionOptions = { client?: SessionClient; mfaVerified?: boolean; device?: string; sessionId?: string }
export function deviceLabel(agent = '') {
  const platform = /Android/i.test(agent) ? 'Android' : /iPhone|iPad/i.test(agent) ? 'iOS' : /Windows/i.test(agent) ? 'Windows' : /Macintosh/i.test(agent) ? 'macOS' : /Linux/i.test(agent) ? 'Linux' : '未知系统'
  const browser = /Edg\//.test(agent) ? 'Edge' : /Firefox\//.test(agent) ? 'Firefox' : /Chrome\//.test(agent) ? 'Chrome' : /Safari\//.test(agent) ? 'Safari' : '浏览器或客户端'
  return platform + ' · ' + browser
}
@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly wechat: WechatMiniappService,
  ) {}

  async recoverySession(identifier: string, password: string, ip: string) {
    if (Buffer.byteLength(password, 'utf8') > 72) throw new BadRequestException('密码不能超过72字节（中文通常每字占3字节）')
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
      const payload = await this.jwt.verifyAsync<{ sub: string; purpose: string; sessionVersion: number }>(token, { secret: this.config.getOrThrow('JWT_SECRET'), audience: 'community-recovery', algorithms: ['HS256'] })
      if (payload.purpose !== 'community_recovery' || !payload.sub) throw new Error()
      const user = await this.prisma.user.findUnique({ where: { id: payload.sub }, select: { sessionVersion: true } })
      if (!user || user.sessionVersion !== payload.sessionVersion) throw new Error()
      return payload.sub
    } catch { throw new UnauthorizedException('恢复凭据已失效，请重新验证账号') }
  }
  async login(identifier: string, password: string, clientKey: string, ip: string, client: SessionClient = 'student', device = '未知设备', existingToken?: string) {
    if (client === 'admin') assertAdminNetwork(this.config, ip)
    if (Buffer.byteLength(password, 'utf8') > 72) throw new BadRequestException('密码不能超过72个UTF-8字节（汉字通常占3字节）')
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
      await this.prisma.loginLog.create({ data: { userId: user?.id, identifier: hashToken(normalizedIdentifier), ipHash: hashToken(ip), result: 'failed' } })
      throw new UnauthorizedException('账号或密码错误')
    }
    await this.prisma.loginThrottle.deleteMany({ where: { identityKey } })
    return this.prisma.$transaction(async (tx) => {
      await lockUser(tx, user.id)
      const locked = await tx.user.findUniqueOrThrow({ where: { id: user.id } })
      if (locked.status !== 'active' || locked.passwordHash !== user.passwordHash) throw new UnauthorizedException('账号凭证已变化，请重新登录')
      const fresh = await tx.user.update({ where: { id: user.id, status: 'active' }, data: { lastLoginAt: new Date() }, include: authUserInclude })
      await tx.loginLog.create({ data: { userId: user.id, identifier: hashToken(normalizedIdentifier), ipHash: hashToken(ip), result: client === 'admin' ? 'mfa_pending' : 'success' } })
      await actionEvent(tx, user.id, 'user_logged_in', 'user', user.id)
      const profile = authUserDto(fresh, await loadBadgeContext(tx))
      if (client === 'admin') {
        if (!profile.permissions.length) throw new ForbiddenException('该账号没有管理后台权限')
        return this.beginMfa(fresh, tx)
      }
      if (!profile.roles.includes('student')) throw new ForbiddenException('请使用管理后台登录入口')
      const existing = existingToken ? await tx.refreshToken.findFirst({ where: { userId: user.id, client, tokenHash: hashToken(existingToken), revokedAt: null, expiresAt: { gt: new Date() } } }) : null
      return { user: profile, ...(await this.createSession(profile, tx, { client, device, sessionId: existing?.id })) }
    })
  }

  async createSession(user: AuthUser, tx: Prisma.TransactionClient = this.prisma, options: SessionOptions = {}): Promise<{ accessToken: string; refreshToken: string; expiresIn: number }> {
    if (tx === this.prisma) return this.prisma.$transaction((inner) => this.createSession(user, inner, options))
    await lockUser(tx, user.id)
    const current = await tx.user.findUniqueOrThrow({ where: { id: user.id }, include: authUserInclude })
    if (current.status !== 'active' || current.sessionVersion !== (user.sessionVersion || 0)) throw new UnauthorizedException('账号会话已变化，请重新登录')
    await assertNotBanned(tx, user.id)
    user = authUserDto(current)
    const client = options.client || 'student'
    if (client === 'student' && user.permissions.length) throw new ForbiddenException('管理账号请使用管理后台完成 MFA')
    if (client === 'admin' && (!options.mfaVerified || !current.mfaEnabledAt || !user.permissions.length)) throw new ForbiddenException('管理员需要完成 MFA')
    if (options.sessionId) {
      const session = await tx.refreshToken.findUnique({ where: { id: options.sessionId } })
      if (session?.userId === user.id && session.client === client) assertNotReplaced(session)
      if (!session || session.userId !== user.id || session.client !== client || session.revokedAt || session.expiresAt <= new Date()) throw new UnauthorizedException('刷新凭据已失效')
    } else {
      await tx.refreshToken.updateMany({
        where: { userId: user.id, client, revokedAt: null, expiresAt: { gt: new Date() } },
        data: { revokedAt: new Date(), revocationReason: 'replaced_by_login' },
      })
    }
    const accessTtl = this.config.get<string>('ACCESS_TOKEN_TTL') || '15m'
    const refreshToken = randomBytes(48).toString('base64url')
    const ttl = this.config.get('REFRESH_TOKEN_TTL') || `${this.config.get('REFRESH_TOKEN_DAYS') || '7'}d`
    const sessionData = {
        userId: user.id,
        tokenHash: hashToken(refreshToken),
        expiresAt: new Date(Date.now() + durationMs(ttl, '7d')),
        client, mfaVerified: options.mfaVerified === true, device: options.device || '未知设备', lastUsedAt: new Date(),
    }
    const session = options.sessionId
      ? await tx.refreshToken.update({ where: { id: options.sessionId, userId: user.id, revokedAt: null }, data: sessionData })
      : await tx.refreshToken.create({ data: sessionData })
    const accessToken = await this.jwt.signAsync({ id: user.id, sessionVersion: user.sessionVersion, sessionId: session.id, sessionClient: client, mfaVerified: session.mfaVerified }, {
      secret: this.config.getOrThrow('JWT_SECRET'), algorithm: 'HS256', expiresIn: Math.floor(durationMs(accessTtl, '15m') / 1000),
    })
    return { accessToken, refreshToken, expiresIn: Math.floor(durationMs(accessTtl, '15m') / 1000) }
  }

  async refresh(refreshToken: string, client: SessionClient = 'student', ip?: string, bearer?: string) {
    if (client === 'admin') assertAdminNetwork(this.config, ip)
    const stored = await this.prisma.refreshToken.findUnique({
      where: { tokenHash: hashToken(refreshToken) },
      include: {
        user: {
          include: authUserInclude,
        },
      },
    })
    if (!stored || stored.client !== client) {
      throw new UnauthorizedException('刷新凭据已失效')
    }
    let previousVersion: number | undefined
    if (bearer) {
      try {
        // 过期 Access Token 仅证明旧标签所属设备，不能代替有效刷新 Cookie。
        const previous = await this.jwt.verifyAsync<AuthUser>(bearer, { secret: this.config.getOrThrow('JWT_SECRET'), algorithms: ['HS256'], ignoreExpiration: true })
        if (previous.id !== stored.userId || previous.sessionId !== stored.id || previous.sessionClient !== client) throw new Error()
        previousVersion = previous.sessionVersion || 0
      } catch { throw new UnauthorizedException('浏览器登录账号或设备已变化，请重新登录') }
    }
    await assertNotBanned(this.prisma, stored.userId)
    assertNotReplaced(stored)
    if (stored.revokedAt || stored.expiresAt <= new Date() || stored.user.status !== 'active') throw new UnauthorizedException('刷新凭据已失效')
    if (bearer && previousVersion !== stored.user.sessionVersion) throw new UnauthorizedException('浏览器登录账号或设备已变化，请重新登录')
    return this.prisma.$transaction(async (tx) => {
      await lockUser(tx, stored.userId)
      const current = await tx.refreshToken.findUnique({ where: { id: stored.id }, include: { user: { include: authUserInclude } } })
      if (current?.client === client) assertNotReplaced(current)
      if (!current || current.tokenHash !== hashToken(refreshToken) || current.client !== client || current.revokedAt || current.expiresAt <= new Date() || current.user.status !== 'active') throw new UnauthorizedException('刷新凭据已失效')
      return this.createSession(authUserDto(current.user), tx, { client, mfaVerified: current.mfaVerified, device: current.device, sessionId: current.id })
    })
  }

  async logout(refreshToken?: string, client: SessionClient = 'student', bearer?: string) {
    let sessionId: string | undefined
    if (bearer) {
      try {
        const payload = await this.jwt.verifyAsync<AuthUser>(bearer, { secret: this.config.getOrThrow('JWT_SECRET'), algorithms: ['HS256'], ignoreExpiration: true })
        if (payload.sessionClient !== client || !payload.sessionId) throw new Error()
        sessionId = payload.sessionId
      } catch { throw new UnauthorizedException('退出凭据无效，请重新确认当前登录账号') }
    }
    if (!sessionId && !refreshToken) return true
    // 多标签切换账号后 Cookie 可能已属于另一个账号；以当前 Bearer 会话为准。
    const row = await this.prisma.refreshToken.findFirst({ where: { client, ...(sessionId ? { id: sessionId } : { tokenHash: hashToken(refreshToken!) }) } })
    if (!row) return !bearer
    await this.prisma.$transaction(async (tx) => {
      await lockUser(tx, row.userId)
      await tx.refreshToken.updateMany({ where: { id: row.id, client, revokedAt: null }, data: { revokedAt: new Date(), revocationReason: 'manual_logout' } })
    })
    return !refreshToken || row.tokenHash === hashToken(refreshToken)
  }

  private async beginMfa(user: User, tx: Prisma.TransactionClient): Promise<MfaChallengeDto> {
    if (!this.config.get('MFA_DATA_KEY')) throw new ServiceUnavailableException('管理员 MFA 尚未配置，请联系部署管理员')
    const secret = user.mfaEnabledAt ? undefined : generateSecret()
    const challenge = await this.jwt.signAsync({ id: user.id, version: user.sessionVersion, purpose: 'admin-mfa', nonce: randomBytes(24).toString('base64url') }, { secret: this.config.getOrThrow('JWT_SECRET'), algorithm: 'HS256', expiresIn: 300 })
    await tx.user.update({ where: { id: user.id }, data: { mfaChallengeHash: hashToken(challenge), ...(secret ? { mfaSecretEncrypted: encryptMfa(secret, this.config.get('MFA_DATA_KEY'), user.id) } : {}) } })
    return { mfaRequired: true, challenge, enrollment: !user.mfaEnabledAt, ...(this.config.get('DEPLOYMENT_PROFILE') === 'experience' ? { experienceHint: true } : {}), ...(secret ? { secret, uri: generateURI({ issuer: 'AI Learning Hub', label: user.username, secret }) } : {}) }
  }

  async mfaHint(challenge: string, ip: string) {
    assertAdminNetwork(this.config, ip)
    if (this.config.get('DEPLOYMENT_PROFILE') !== 'experience') throw new ForbiddenException('当前环境不提供验证码提示')
    await rateLimit(this.prisma, ip, 'mfa-hint:ip', 120, 5 * 60000)
    const payload = await this.readMfaChallenge(challenge)
    const user = await this.prisma.user.findUnique({ where: { id: payload.id, AND: [availableAccount()] }, include: authUserInclude })
    if (!user || user.status !== 'active' || user.sessionVersion !== payload.version || user.mfaChallengeHash !== hashToken(challenge) || !user.mfaSecretEncrypted || !authUserDto(user).permissions.length) throw new UnauthorizedException('MFA 登录请求已失效，请重新登录')
    const epoch = Math.floor(Date.now() / 1000)
    const step = Math.floor(epoch / 30)
    const code = user.mfaLastTimeStep !== null && user.mfaLastTimeStep >= step ? null : await generate({ secret: decryptMfa(user.mfaSecretEncrypted, this.config.get('MFA_DATA_KEY'), user.id), epoch })
    return { code, expiresAt: (step + 1) * 30000 }
  }

  private async readMfaChallenge(challenge: string) {
    try {
      const payload = await this.jwt.verifyAsync<{ id: string; version: number; purpose: string }>(challenge, { secret: this.config.getOrThrow('JWT_SECRET'), algorithms: ['HS256'] })
      if (payload.purpose !== 'admin-mfa' || !payload.id) throw new Error()
      return payload
    } catch { throw new UnauthorizedException('MFA 登录请求已失效，请重新登录') }
  }

  private async checkMfa(user: User, code: string, tx: Prisma.TransactionClient) {
    if (!user.mfaSecretEncrypted) throw new UnauthorizedException('MFA 尚未绑定')
    const normalized = code.trim().replace(/[-\s]/g, '')
    if (user.mfaEnabledAt && /^[a-f0-9]{32}$/i.test(normalized)) {
      const digest = hashToken(normalized.toLowerCase())
      if (!user.mfaRecoveryHashes.includes(digest)) throw new UnauthorizedException('验证码或恢复码无效')
      await tx.user.update({ where: { id: user.id }, data: { mfaRecoveryHashes: user.mfaRecoveryHashes.filter((item) => item !== digest) } })
      return
    }
    if (!/^\d{6}$/.test(normalized)) throw new UnauthorizedException('验证码或恢复码无效')
    const result = await verify({ secret: decryptMfa(user.mfaSecretEncrypted, this.config.get('MFA_DATA_KEY'), user.id), token: normalized, epochTolerance: 30, ...(user.mfaLastTimeStep === null ? {} : { afterTimeStep: user.mfaLastTimeStep }) })
    if (!result.valid || !('timeStep' in result)) throw new UnauthorizedException('验证码无效或已使用，请等待下一组验证码')
    await tx.user.update({ where: { id: user.id }, data: { mfaLastTimeStep: result.timeStep } })
  }

  async verifyMfa(challenge: string, code: string, ip: string, device: string, existingToken?: string) {
    assertAdminNetwork(this.config, ip)
    await rateLimit(this.prisma, ip, 'mfa:ip', 60, 15 * 60000)
    const payload = await this.readMfaChallenge(challenge)
    await rateLimit(this.prisma, payload.id, 'mfa:account', 10, 5 * 60000)
    return this.prisma.$transaction(async (tx) => {
      await lockUser(tx, payload.id)
      const user = await tx.user.findUniqueOrThrow({ where: { id: payload.id }, include: authUserInclude })
      if (user.status !== 'active' || user.sessionVersion !== payload.version || user.mfaChallengeHash !== hashToken(challenge) || !authUserDto(user).permissions.length) throw new UnauthorizedException('MFA 登录请求已失效')
      await this.checkMfa(user, code, tx)
      const recoveryCodes = user.mfaEnabledAt ? undefined : Array.from({ length: 10 }, () => randomBytes(16).toString('hex'))
      await tx.user.update({ where: { id: user.id }, data: { mfaChallengeHash: null, mfaEnabledAt: user.mfaEnabledAt || new Date(), ...(recoveryCodes ? { mfaRecoveryHashes: recoveryCodes.map(hashToken) } : {}) } })
      await actionEvent(tx, user.id, 'admin_mfa_verified', 'user', user.id)
      const existing = existingToken ? await tx.refreshToken.findFirst({ where: { userId: user.id, client: 'admin', tokenHash: hashToken(existingToken), revokedAt: null, expiresAt: { gt: new Date() } } }) : null
      return { user: authUserDto(user, await loadBadgeContext(tx)), ...await this.createSession(authUserDto(user), tx, { client: 'admin', mfaVerified: true, device, sessionId: existing?.id }), ...(recoveryCodes ? { recoveryCodes } : {}) }
    })
  }

  async reauthenticate(userId: string, input: ReauthenticateInput, tx: Prisma.TransactionClient) {
    await lockUser(tx, userId)
    const user = await tx.user.findUniqueOrThrow({ where: { id: userId } })
    if (user.status !== 'active' || !user.passwordHash || Buffer.byteLength(input.currentPassword, 'utf8') > 72 || !await compare(input.currentPassword, user.passwordHash)) throw new UnauthorizedException('身份确认失败，请检查当前密码')
    if (user.mfaEnabledAt) await this.checkMfa(user, input.mfaCode || '', tx)
    return user
  }

  async sessions(user: AuthUser): Promise<DeviceSessionDto[]> {
    const rows = await this.prisma.refreshToken.findMany({ where: { userId: user.id, revokedAt: null, expiresAt: { gt: new Date() } }, orderBy: { lastUsedAt: 'desc' }, take: 100 })
    return rows.map((row) => ({ id: row.id, client: row.client as SessionClient, device: row.device, createdAt: row.createdAt.toISOString(), lastUsedAt: row.lastUsedAt.toISOString(), expiresAt: row.expiresAt.toISOString(), current: row.id === user.sessionId }))
  }

  async revokeSession(user: AuthUser, id: string) {
    return this.prisma.$transaction(async (tx) => {
      await lockUser(tx, user.id)
      if (id === 'all') {
        await tx.user.update({ where: { id: user.id }, data: { sessionVersion: { increment: 1 }, mfaChallengeHash: null } })
        await tx.refreshToken.updateMany({ where: { userId: user.id, revokedAt: null }, data: { revokedAt: new Date() } })
      } else if (!(await tx.refreshToken.updateMany({ where: { id, userId: user.id, revokedAt: null }, data: { revokedAt: new Date() } })).count) throw new BadRequestException('会话不存在或已撤销')
      return { revoked: true }
    })
  }

  async regenerateRecoveryCodes(user: AuthUser, input: ReauthenticateInput) {
    await rateLimit(this.prisma, user.id, 'account:reauth', 10, 15 * 60000)
    return this.prisma.$transaction(async (tx) => {
      const row = await this.reauthenticate(user.id, input, tx)
      if (!row.mfaEnabledAt) throw new BadRequestException('尚未绑定 MFA')
      const recoveryCodes = Array.from({ length: 10 }, () => randomBytes(16).toString('hex'))
      await tx.user.update({ where: { id: user.id }, data: { mfaRecoveryHashes: recoveryCodes.map(hashToken) } })
      await actionEvent(tx, user.id, 'mfa_recovery_codes_rotated', 'user', user.id)
      return { recoveryCodes }
    })
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
      const profile = authUserDto(identity.user, await loadBadgeContext(this.prisma))
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
    const profile = authUserDto(user, await loadBadgeContext(this.prisma))
    return { user: profile, ...(await this.createSession(profile)) }
  }

  async bindWechat(userId: string, code: string, input: ReauthenticateInput) {
    await rateLimit(this.prisma, userId, 'account:reauth', 10, 15 * 60000, '身份确认过于频繁，请稍后重试')
    const external = await this.wechat.exchange(code)
    const existing = await this.prisma.authIdentity.findUnique({
      where: { provider_providerUid: { provider: 'wechat_miniapp', providerUid: external.providerUid } },
    })
    if (existing && existing.userId !== userId) throw new ConflictException('该微信身份已绑定其他账号')
    return this.prisma.$transaction(async (tx) => {
    await this.reauthenticate(userId, input, tx)
    return tx.authIdentity.upsert({
      where: { userId_provider: { userId, provider: 'wechat_miniapp' } },
      update: { providerUid: external.providerUid, metadata: external.unionid ? { unionid: external.unionid } : {} },
      create: { userId, provider: 'wechat_miniapp', providerUid: external.providerUid, metadata: external.unionid ? { unionid: external.unionid } : {} },
      select: { id: true, provider: true, createdAt: true },
    })
    })
  }
}
