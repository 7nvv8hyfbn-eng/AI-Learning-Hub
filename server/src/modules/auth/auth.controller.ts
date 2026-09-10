import { loadBadgeContext } from '../community/user-badges'
import { Body, ConflictException, Controller, Delete, Get, Headers, Ip, Param, Patch, Post, Req, Res, UnauthorizedException, UseGuards } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import type { Request, Response } from 'express'
import { PrismaService } from '../../prisma/prisma.service'
import { AuthGuard } from './auth.guard'
import { AuthService, deviceLabel } from './auth.service'
import { CurrentUser } from './current-user.decorator'
import { BindWechatDto, ChangeEmailDto, ChangePasswordDto, ForgotPasswordDto, LoginDto, MfaChallengeInputDto, MfaVerifyDto, ReauthenticateDto, RegisterDto, ResetPasswordDto, UpdateProfileDto, VerificationDto, WechatCodeDto } from './auth.dto'
import { RegistrationService } from './registration.service'
import type { AuthUser } from './auth.types'
import { durationMs } from './auth-ttl'
import { actionEvent, lockFileReferences } from '../../common/persistence'
import { ContentDetectionService } from '../community/content-detection.service'
import { authUserDto, authUserInclude } from './auth.mapper'
import { CommunityVisibilityPolicyService } from '../community/visibility.service'
import { secureCookie } from '../../common/deployment-security'
import type { SessionClient } from '@ai-learning-hub/contracts'

const clientOf = (request: Request): SessionClient => request.path.toLowerCase().startsWith('/api/v1/admin-auth/') ? 'admin' : 'student'
const cookiePath = (client: SessionClient) => client === 'admin' ? '/api/v1/admin-auth' : '/api/v1/auth'
@Controller()
export class AuthController {
  constructor(private readonly auth: AuthService, private readonly config: ConfigService, private readonly registration: RegistrationService) {}

  @Get('auth/registration-config') registrationConfig() { return this.registration.configuration() }
  @Post('auth/register')
  async register(@Body() input: RegisterDto, @Ip() ip: string, @Res({ passthrough: true }) response: Response, @Headers('idempotency-key') key?: string) {
    const result = await this.registration.register(input, ip, key)
    this.setRefreshCookie(response, result.refreshToken)
    return { user: result.user, accessToken: result.accessToken, expiresIn: result.expiresIn, notice: result.notice }
  }
  @Post('auth/password/forgot') forgot(@Body() input: ForgotPasswordDto, @Ip() ip: string) { return this.registration.forgot(input.email, ip) }
  @Post('auth/password/reset') reset(@Body() input: ResetPasswordDto, @Ip() ip: string) { return this.registration.reset(input.token, input.password, ip) }
  @Post('auth/email/verify') verify(@Body() input: VerificationDto, @Ip() ip: string) { return this.registration.verifyEmail(input.token, ip) }
  @Post('auth/email/resend') resend(@Body() input: ForgotPasswordDto, @Ip() ip: string) { return this.registration.resendVerification(input.email, ip) }

  private setRefreshCookie(response: Response, token: string, remember = true, client: SessionClient = 'student') {
    response.setHeader('Cache-Control', 'no-store')
    response.cookie(client + '_refresh', token, {
      httpOnly: true,
      secure: secureCookie(this.config),
      sameSite: 'lax',
      path: cookiePath(client),
      maxAge: remember ? durationMs(
        this.config.get<string>('REFRESH_TOKEN_TTL') || `${this.config.get('REFRESH_TOKEN_DAYS') || '7'}d`,
        '7d',
      ) : undefined,
    })
    response.cookie(client + '_remember', remember ? 'yes' : 'no', { httpOnly: true, secure: secureCookie(this.config), sameSite: 'lax', path: cookiePath(client), ...(remember ? { maxAge: durationMs(this.config.get<string>('REFRESH_TOKEN_TTL') || '7d', '7d') } : {}) })
  }

  @Post(['auth/login', 'admin-auth/login'])
  async login(@Body() input: LoginDto, @Ip() ip: string, @Res({ passthrough: true }) response: Response, @Req() request: Request) {
    const client = clientOf(request)
    const result = await this.auth.login(input.identifier, input.password, ip + ':' + input.identifier.toLowerCase(), ip, client, deviceLabel(request.get('user-agent')), request.cookies?.[client + '_refresh'])
    response.setHeader('Cache-Control', 'no-store')
    if ('mfaRequired' in result) return result
    this.setRefreshCookie(response, result.refreshToken, input.remember, client)
    return { user: result.user, accessToken: result.accessToken, expiresIn: result.expiresIn }
  }

  @Post('admin-auth/mfa')
  async mfa(@Body() input: MfaVerifyDto, @Ip() ip: string, @Req() request: Request, @Res({ passthrough: true }) response: Response) {
    const result = await this.auth.verifyMfa(input.challenge, input.code, ip, deviceLabel(request.get('user-agent')), request.cookies?.admin_refresh)
    this.setRefreshCookie(response, result.refreshToken, input.remember, 'admin')
    return { user: result.user, accessToken: result.accessToken, expiresIn: result.expiresIn, recoveryCodes: result.recoveryCodes }
  }

  @Post('admin-auth/mfa-hint')
  mfaHint(@Body() input: MfaChallengeInputDto, @Ip() ip: string, @Res({ passthrough: true }) response: Response) {
    response.setHeader('Cache-Control', 'no-store')
    return this.auth.mfaHint(input.challenge, ip)
  }

  @Post('auth/wechat/miniapp')
  async wechat(@Body() input: WechatCodeDto, @Res({ passthrough: true }) response: Response) {
    const result = await this.auth.wechatLogin(input.code)
    this.setRefreshCookie(response, result.refreshToken)
    return { user: result.user, accessToken: result.accessToken, expiresIn: result.expiresIn }
  }

  @Post(['auth/refresh', 'admin-auth/refresh'])
  async refresh(@Req() request: Request, @Res({ passthrough: true }) response: Response) {
    const client = clientOf(request), token = request.cookies?.[client + '_refresh'] as string | undefined
    if (!token) throw new UnauthorizedException('缺少刷新凭据')
    const result = await this.auth.refresh(token, client, request.ip, request.headers.authorization?.match(/^Bearer (.+)$/)?.[1])
    this.setRefreshCookie(response, result.refreshToken, request.cookies?.[client + '_remember'] !== 'no', client)
    return { accessToken: result.accessToken, expiresIn: result.expiresIn }
  }

  @Post(['auth/logout', 'admin-auth/logout'])
  async logout(@Req() request: Request, @Res({ passthrough: true }) response: Response) {
    const client = clientOf(request)
    const clearCookie = await this.auth.logout(request.cookies?.[client + '_refresh'] as string | undefined, client, request.headers.authorization?.match(/^Bearer (.+)$/)?.[1])
    if (!clearCookie) return { loggedOut: true }
    response.clearCookie(client + '_refresh', {
      httpOnly: true,
      secure: secureCookie(this.config),
      sameSite: 'lax',
      path: cookiePath(client),
    })
    response.clearCookie(client + '_remember', { path: cookiePath(client), httpOnly: true, secure: secureCookie(this.config), sameSite: 'lax' })
    return { loggedOut: true }
  }
}

@Controller()
@UseGuards(AuthGuard)
export class MeController {
  constructor(private readonly prisma: PrismaService, private readonly auth: AuthService, private readonly visibility: CommunityVisibilityPolicyService, private readonly detection: ContentDetectionService, private readonly registration: RegistrationService) {}

  @Get('me/security') security(@CurrentUser() user: AuthUser) { return this.registration.accountSecurity(user) }
  @Post('me/password') password(@CurrentUser() user: AuthUser, @Body() input: ChangePasswordDto) { return this.registration.changePassword(user, input) }
  @Post('me/email') email(@CurrentUser() user: AuthUser, @Body() input: ChangeEmailDto) { return this.registration.changeEmail(user, input) }
  @Get('me/sessions') sessions(@CurrentUser() user: AuthUser) { return this.auth.sessions(user) }
  @Delete('me/sessions/:id') revoke(@CurrentUser() user: AuthUser, @Param('id') id: string) { return this.auth.revokeSession(user, id) }
  @Post('me/mfa/recovery-codes') recovery(@CurrentUser() user: AuthUser, @Body() input: ReauthenticateDto) { return this.auth.regenerateRecoveryCodes(user, input) }

  @Get('me')
  me(@CurrentUser() user: AuthUser) {
    return user
  }

  @Patch('me')
  async update(@CurrentUser() user: AuthUser, @Body() input: UpdateProfileDto) {
    await this.visibility.assertOperation(user.id, 'profile')
    return this.prisma.$transaction(async (tx) => {
      await lockFileReferences(tx)
      if (!(await tx.user.updateMany({ where: { id: user.id, revision: input.expectedRevision }, data: { revision: { increment: 1 } } })).count) throw new ConflictException('资料已变化，请重新读取')
      const contentDetection = await this.detection.saveProfile(tx, user.id, { displayName: input.displayName })
      const row = await tx.user.findUniqueOrThrow({ where: { id: user.id }, include: authUserInclude })
      await actionEvent(tx, user.id, 'profile_updated', 'user', user.id)
      return { ...authUserDto(row, await loadBadgeContext(tx)), contentDetection }
    })
  }

  @Get('me/identities')
  identities(@CurrentUser() user: AuthUser) {
    return this.prisma.authIdentity.findMany({ where: { userId: user.id }, select: { id: true, provider: true, createdAt: true } })
  }

  @Post('me/identities/wechat/miniapp')
  bindWechat(@CurrentUser() user: AuthUser, @Body() input: BindWechatDto) {
    return this.auth.bindWechat(user.id, input.code, input)
  }
}
