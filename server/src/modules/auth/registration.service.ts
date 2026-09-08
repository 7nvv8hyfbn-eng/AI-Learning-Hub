import { BadRequestException, ConflictException, HttpException, Injectable, Logger, ServiceUnavailableException } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { Prisma } from '@prisma/client'
import { compare, hash } from 'bcryptjs'
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import { createTransport } from 'nodemailer'
import type { RegistrationConfigDto, RegistrationSettingsDto } from '@ai-learning-hub/contracts'
import { PrismaService } from '../../prisma/prisma.service'
import { AuthService } from './auth.service'
import { authUserDto, authUserInclude } from './auth.mapper'
import type { RegisterDto } from './auth.dto'
import { actionEvent, idempotency, lockFileReferences, lockUser } from '../../common/persistence'
import { ContentDetectionService } from '../community/content-detection.service'
import { normalizeUsername } from './username'

const digest = (value: string) => createHash('sha256').update(value).digest('hex')
const defaults: RegistrationSettingsDto = {
  mode: 'open', emailVerification: false, agreementVersion: '2026-08-30', passwordMinLength: 8, schoolRequired: false,
  registrationRateWindowMinutes: 15, registrationMaxAttemptsPerIp: 120, registrationMaxAttemptsPerIdentifier: 8, registrationMaxSuccessPerIp: 30,
}
@Injectable()
export class RegistrationService {
  private readonly logger = new Logger(RegistrationService.name)
  constructor(private readonly prisma: PrismaService, private readonly config: ConfigService, private readonly auth: AuthService, private readonly detection: ContentDetectionService) {}
  mailAvailable() { return !!(this.config.get('SMTP_HOST') && this.config.get('SMTP_FROM') && this.config.get('FRONTEND_URL')) }
  private inviteHashes() { return String(this.config.get('REGISTRATION_INVITE_HASHES') || '').split(',').filter((value) => /^[a-f0-9]{64}$/.test(value)) }
  async settings(tx: Prisma.TransactionClient = this.prisma): Promise<RegistrationSettingsDto> {
    const stored = await tx.systemSetting.findUnique({ where: { key: 'registration' } })
    const value = (stored?.value || {}) as Partial<RegistrationSettingsDto>
    return {
      revision: stored?.revision || 1,
      mode: ['open', 'invite', 'closed'].includes(value.mode || '') ? value.mode! : defaults.mode,
      emailVerification: value.emailVerification === true,
      agreementVersion: typeof value.agreementVersion === 'string' && value.agreementVersion.length >= 1 && value.agreementVersion.length <= 60 ? value.agreementVersion : defaults.agreementVersion,
      passwordMinLength: Number.isInteger(value.passwordMinLength) && value.passwordMinLength! >= 8 && value.passwordMinLength! <= 72 ? value.passwordMinLength! : defaults.passwordMinLength,
      schoolRequired: value.schoolRequired === true,
      registrationRateWindowMinutes: Number.isInteger(value.registrationRateWindowMinutes) && value.registrationRateWindowMinutes! >= 1 && value.registrationRateWindowMinutes! <= 1440 ? value.registrationRateWindowMinutes! : defaults.registrationRateWindowMinutes,
      registrationMaxAttemptsPerIp: Number.isInteger(value.registrationMaxAttemptsPerIp) && value.registrationMaxAttemptsPerIp! >= 10 && value.registrationMaxAttemptsPerIp! <= 10000 ? value.registrationMaxAttemptsPerIp! : defaults.registrationMaxAttemptsPerIp,
      registrationMaxAttemptsPerIdentifier: Number.isInteger(value.registrationMaxAttemptsPerIdentifier) && value.registrationMaxAttemptsPerIdentifier! >= 2 && value.registrationMaxAttemptsPerIdentifier! <= 100 ? value.registrationMaxAttemptsPerIdentifier! : defaults.registrationMaxAttemptsPerIdentifier,
      registrationMaxSuccessPerIp: Number.isInteger(value.registrationMaxSuccessPerIp) && value.registrationMaxSuccessPerIp! >= 5 && value.registrationMaxSuccessPerIp! <= 1000 ? value.registrationMaxSuccessPerIp! : defaults.registrationMaxSuccessPerIp,
    }
  }
  async configuration(): Promise<RegistrationConfigDto> {
    return { ...await this.settings(), mailAvailable: this.mailAvailable(), inviteAvailable: this.inviteHashes().length > 0 }
  }
  async updateSettings(input: RegistrationSettingsDto) {
    if (input.emailVerification && !this.mailAvailable()) throw new ServiceUnavailableException('尚未配置邮件通道，不能启用邮箱验证')
    if (input.mode === 'invite' && !this.inviteHashes().length) throw new ServiceUnavailableException('请先配置邀请码哈希')
    if (input.registrationMaxAttemptsPerIp < input.registrationMaxAttemptsPerIdentifier || input.registrationMaxSuccessPerIp > input.registrationMaxAttemptsPerIp) throw new BadRequestException('单 IP 尝试上限须不低于账号标识和成功注册上限')
    const { expectedRevision, revision: _revision, ...value } = input
    void _revision
    await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext('settings:registration'))::text`
      const old = await tx.systemSetting.findUnique({ where: { key: 'registration' } })
      if (old && expectedRevision !== old.revision) throw new ConflictException('注册配置已变化，请重新读取')
      await tx.systemSetting.upsert({ where: { key: 'registration' }, update: { value: { ...value }, revision: { increment: 1 } }, create: { key: 'registration', value: { ...value } } })
    })
    return this.configuration()
  }
  private async throttle(action: string, email: string, ip: string) {
    // 数据库原子计数适用于多实例；不在日志或限流键中保存原邮箱、IP。
    for (const [kind, value, limit] of [['ip', ip, 30], ['email', email, 5]] as const) {
      const key = digest(`${action}:${kind}:${value}`), expiresAt = new Date(Date.now() + 15 * 60_000)
      const rows = await this.prisma.$queryRaw<Array<{ attempts: number }>>`
        INSERT INTO registration_throttles (identity_key, attempts, expires_at) VALUES (${key}, 1, ${expiresAt})
        ON CONFLICT (identity_key) DO UPDATE SET
          attempts = CASE WHEN registration_throttles.expires_at < NOW() THEN 1 ELSE registration_throttles.attempts + 1 END,
          expires_at = CASE WHEN registration_throttles.expires_at < NOW() THEN ${expiresAt} ELSE registration_throttles.expires_at END
        RETURNING attempts`
      if (rows[0].attempts > limit) throw new HttpException('操作过于频繁，请稍后再试', 429)
    }
  }
  private throttleKey(scope: string, value: string) {
    return createHmac('sha256', this.config.getOrThrow<string>('JWT_SECRET')).update(`${scope}:${value}`).digest('hex')
  }
  private async consumeRegistrationLimit(tx: Prisma.TransactionClient | PrismaService, scope: string, value: string, limit: number, windowMinutes: number) {
    const key = this.throttleKey(scope, value), expiresAt = new Date(Date.now() + windowMinutes * 60_000)
    const rows = await tx.$queryRaw<Array<{ attempts: number; expires_at: Date }>>`
      INSERT INTO registration_throttles (identity_key, attempts, expires_at) VALUES (${key}, 1, ${expiresAt})
      ON CONFLICT (identity_key) DO UPDATE SET
        attempts = CASE WHEN registration_throttles.expires_at < NOW() THEN 1 ELSE registration_throttles.attempts + 1 END,
        expires_at = CASE WHEN registration_throttles.expires_at < NOW() THEN ${expiresAt} ELSE registration_throttles.expires_at END
      RETURNING attempts, expires_at`
    if (rows[0].attempts > limit) {
      const retryAfter = Math.max(1, Math.ceil((new Date(rows[0].expires_at).getTime() - Date.now()) / 1000))
      throw new HttpException({ message: '注册请求过于频繁，请稍后再试', errorCode: 'REGISTRATION_RATE_LIMITED', retryAfter }, 429)
    }
  }
  private async registrationAttempt(settings: RegistrationSettingsDto, username: string, email: string, ip: string) {
    const window = settings.registrationRateWindowMinutes
    await this.consumeRegistrationLimit(this.prisma, 'register:attempt:ip', ip, settings.registrationMaxAttemptsPerIp, window)
    await this.consumeRegistrationLimit(this.prisma, 'register:attempt:username', username, settings.registrationMaxAttemptsPerIdentifier, window)
    await this.consumeRegistrationLimit(this.prisma, 'register:attempt:email', email, settings.registrationMaxAttemptsPerIdentifier, window)
  }
  private async send(email: string, token: string, verify: boolean) {
    if (!this.mailAvailable()) throw new ServiceUnavailableException('邮件服务尚未配置，请联系管理员')
    const url = new URL(verify ? '/verify-email' : '/reset-password', this.config.getOrThrow<string>('FRONTEND_URL'))
    url.hash = new URLSearchParams({ token }).toString()
    const transport = createTransport({
      host: this.config.getOrThrow('SMTP_HOST'), port: Number(this.config.get('SMTP_PORT') || 587),
      secure: String(this.config.get('SMTP_PORT')) === '465',
      requireTLS: this.config.get('SMTP_ALLOW_INSECURE') !== 'true',
      ...(this.config.get('SMTP_USER') ? { auth: { user: this.config.get<string>('SMTP_USER'), pass: this.config.get<string>('SMTP_PASSWORD') } } : {}),
      connectionTimeout: 8000, socketTimeout: 10000, logger: false, debug: false,
    })
    try {
      await transport.sendMail({ from: this.config.getOrThrow<string>('SMTP_FROM'), to: email, subject: verify ? '验证学习账号邮箱' : '重置学习账号密码', text: `请打开以下链接${verify ? '验证邮箱' : '重置密码'}：\n${url.href}\n链接30分钟内有效且仅可使用一次。若非本人操作，请忽略。` })
    } catch { throw new ServiceUnavailableException('邮件通道暂不可用，请稍后再试') }
    finally { transport.close() }
  }
  async register(input: RegisterDto, ip: string, key?: string) {
    if (Buffer.byteLength(input.password, 'utf8') > 72) throw new BadRequestException('密码 UTF-8 长度不能超过72字节')
    const email = input.email.trim().toLowerCase(), username = normalizeUsername(input.username)
    const requestSettings = await this.settings()
    await this.registrationAttempt(requestSettings, username, email, ip)
    const passwordHash = await hash(input.password, 12)
    try {
      let mail: { token: string; email: string } | undefined
      const result = await this.prisma.$transaction(async (tx) => {
        await lockFileReferences(tx)
        const request = await idempotency(tx, email, 'register', key, { ...input, password: createHmac('sha256', this.config.getOrThrow<string>('JWT_SECRET')).update(input.password).digest('hex') })
        if (request.resourceId) {
          await lockUser(tx, request.resourceId)
          const user = await tx.user.findUniqueOrThrow({ where: { id: request.resourceId, status: 'active' }, include: authUserInclude })
          if (!user.passwordHash || !await compare(input.password, user.passwordHash)) throw new ConflictException('账号凭证已变化，请重新登录')
          const contentDetection = await this.detection.result('profile', user.id, user.communityProfile?.revision || 1)
          return { user: { ...authUserDto(user), contentDetection }, ...await this.auth.createSession(authUserDto(user), tx), contentDetection }
        }
        const settings = await this.settings(tx)
        if (settings.mode === 'closed') throw new BadRequestException('注册已关闭，请联系管理员')
        if (input.password.length < settings.passwordMinLength) throw new BadRequestException(`密码至少${settings.passwordMinLength}位`)
        if (input.agreementVersion !== settings.agreementVersion) throw new BadRequestException('请阅读并同意当前用户协议和隐私政策')
        if (settings.mode === 'invite' && !this.inviteHashes().some((value) => timingSafeEqual(Buffer.from(value, 'hex'), Buffer.from(digest(input.inviteCode || ''), 'hex')))) throw new BadRequestException('邀请码无效')
        await this.detection.assertUsernameAvailable(tx, username)
        const contentDetection = await this.detection.check(tx, { username, displayName: input.displayName })
        const existing = await tx.user.findFirst({ where: { OR: [{ email: { equals: email, mode: 'insensitive' } }, { username: { equals: username, mode: 'insensitive' } }] } })
        if (existing) throw new ConflictException('邮箱或账号已被使用')
        const role = await tx.role.findUnique({ where: { code: 'student' } })
        if (!role) throw new ServiceUnavailableException('学生角色尚未初始化')
        await this.consumeRegistrationLimit(tx, 'register:success:ip', ip, settings.registrationMaxSuccessPerIp, settings.registrationRateWindowMinutes)
        const user = await tx.user.create({
          data: {
            email, passwordHash, username: contentDetection.action === 'review' ? `member_${randomBytes(8).toString('hex')}` : username, displayName: contentDetection.action === 'review' ? '资料待复核' : input.displayName.trim(),
            userType: 'student', agreementVersion: settings.agreementVersion, agreementAcceptedAt: new Date(),
            registrationSource: settings.mode === 'invite' ? 'email_invite' : 'email',
            profile: { emailVerificationRequired: settings.emailVerification },
            userRoles: { create: { roleId: role.id } }, communityProfile: { create: {} },
          }, include: authUserInclude,
        })
        await this.detection.record(tx, { type: 'profile', id: user.id, revision: user.communityProfile?.revision || 1, authorId: user.id, submittedById: user.id }, contentDetection, { changes: { username, displayName: input.displayName.trim() }, userRevision: user.revision, initialUsername: true })
        await actionEvent(tx, user.id, 'student_register', 'user', user.id, { source: settings.mode })
        const dto = authUserDto(user), session = await this.auth.createSession(dto, tx)
        if (settings.emailVerification) {
          const token = randomBytes(48).toString('base64url')
          await tx.emailVerificationToken.create({ data: { userId: user.id, tokenHash: digest(token), expiresAt: new Date(Date.now() + 30 * 60_000) } })
          mail = { email, token }
        }
        await request.complete(user.id)
        return { user: { ...dto, contentDetection }, ...session, contentDetection }
      }, { timeout: 20000 })
      let notice: string | undefined
      if (mail) {
        try { await this.send(mail.email, mail.token, true) }
        catch { notice = '账号已创建，但验证邮件发送失败。请联系管理员恢复邮件通道后重新发送验证邮件。'; this.logger.warn('注册验证邮件发送失败，账号已保留') }
      }
      const contentNotice = result.contentDetection?.action === 'review' ? '公开资料已保存待复核，当前暂用中性资料。请先使用邮箱登录，审核通过后启用所选公开用户名。' : result.contentDetection?.action === 'warn' ? [...new Set(result.contentDetection.hits.filter((hit) => hit.action === 'warn').map((hit) => hit.explanation))].join('；') : ''
      return { ...result, notice: [notice, contentNotice].filter(Boolean).join('；') || undefined }
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') throw new ConflictException('邮箱或用户名已被使用，请重试')
      throw error
    }
  }
  async forgot(email: string, ip: string) {
    email = email.trim().toLowerCase()
    await this.throttle('forgot', email, ip)
    if (!this.mailAvailable()) throw new ServiceUnavailableException('邮件服务尚未配置，请联系管理员')
    const user = await this.prisma.user.findFirst({ where: { email: { equals: email, mode: 'insensitive' } } })
    if (user) {
      const token = randomBytes(48).toString('base64url')
      await this.prisma.$transaction(async (tx) => {
        await tx.passwordResetToken.updateMany({ where: { userId: user.id, usedAt: null }, data: { usedAt: new Date() } })
        await tx.passwordResetToken.create({ data: { userId: user.id, tokenHash: digest(token), expiresAt: new Date(Date.now() + 30 * 60_000) } })
      })
      // ponytail: 进程内发送不阻塞通用响应；进程重启时用户需重新申请，规模扩大后接入加密任务队列。
      void this.send(email, token, false).catch(() => { this.logger.warn('密码重置邮件发送失败；请检查邮件通道，用户可重新申请') })
    }
    return { message: '如果该邮箱对应有效账号，你将收到密码重置邮件。请同时检查垃圾邮件。' }
  }
  async resendVerification(email: string, ip: string) {
    await this.throttle('verify-resend', email.trim().toLowerCase(), ip)
    if (!this.mailAvailable()) throw new ServiceUnavailableException('邮件服务尚未配置，请联系管理员')
    const user = await this.prisma.user.findFirst({ where: { email: { equals: email.trim(), mode: 'insensitive' }, status: 'active', emailVerifiedAt: null } })
    if (user) {
      const token = randomBytes(48).toString('base64url')
      await this.prisma.$transaction(async (tx) => {
        await tx.emailVerificationToken.updateMany({ where: { userId: user.id, usedAt: null }, data: { usedAt: new Date() } })
        await tx.emailVerificationToken.create({ data: { userId: user.id, tokenHash: digest(token), expiresAt: new Date(Date.now() + 30 * 60_000) } })
      })
      void this.send(user.email, token, true).catch(() => { this.logger.warn('验证邮件重发失败；请检查邮件通道') })
    }
    return { message: '如果该账号需要验证，你将收到新的验证邮件。' }
  }
  async reset(token: string, password: string, ip: string) {
    if (Buffer.byteLength(password, 'utf8') > 72) throw new BadRequestException('密码 UTF-8 长度不能超过72字节')
    await this.throttle('reset', digest(token), ip)
    if (password.length < (await this.settings()).passwordMinLength) throw new BadRequestException('密码长度不符合平台要求')
    const passwordHash = await hash(password, 12)
    return this.prisma.$transaction(async (tx) => {
      const row = await tx.passwordResetToken.findUnique({ where: { tokenHash: digest(token) }, include: { user: true } })
      if (!row || row.usedAt || row.expiresAt <= new Date()) throw new BadRequestException('重置链接已失效')
      await lockUser(tx, row.userId)
      if (!await tx.user.count({ where: { id: row.userId } })) throw new BadRequestException('账号已失效')
      const claimed = await tx.passwordResetToken.updateMany({ where: { id: row.id, usedAt: null }, data: { usedAt: new Date() } })
      if (!claimed.count) throw new BadRequestException('重置链接已使用')
      await tx.user.update({ where: { id: row.userId }, data: { passwordHash, sessionVersion: { increment: 1 } } })
      await tx.refreshToken.updateMany({ where: { userId: row.userId, revokedAt: null }, data: { revokedAt: new Date() } })
      return { reset: true }
    })
  }
  async verifyEmail(token: string, ip: string) {
    await this.throttle('verify', digest(token), ip)
    return this.prisma.$transaction(async (tx) => {
      const row = await tx.emailVerificationToken.findUnique({ where: { tokenHash: digest(token) }, include: { user: true } })
      if (!row || row.usedAt || row.expiresAt <= new Date() || row.user.status !== 'active') throw new BadRequestException('验证链接已失效')
      if (!(await tx.emailVerificationToken.updateMany({ where: { id: row.id, usedAt: null }, data: { usedAt: new Date() } })).count) throw new BadRequestException('验证链接已使用')
      await tx.user.update({ where: { id: row.userId }, data: { emailVerifiedAt: new Date() } })
      return { verified: true }
    })
  }
}
