import { loadBadgeContext } from '../community/user-badges'
import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { JwtService } from '@nestjs/jwt'
import type { AuthRequest, AuthUser } from './auth.types'
import { PrismaService } from '../../prisma/prisma.service'
import { authUserDto, authUserInclude } from './auth.mapper'
import { availableAccount } from '../community/governance-policy'
import { assertAdminNetwork } from '../../common/deployment-security'
import { assertNotBanned, assertNotReplaced } from './session-revocation'

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(private readonly jwt: JwtService, private readonly config: ConfigService, private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest<AuthRequest>()
    const token = request.headers.authorization?.match(/^Bearer (.+)$/)?.[1]
    if (!token) throw new UnauthorizedException('请先登录')
    let payload: AuthUser & { exp?: number }
    try {
      payload = await this.jwt.verifyAsync<AuthUser>(token, { secret: this.config.getOrThrow('JWT_SECRET'), algorithms: ['HS256'], ignoreExpiration: true })
      if (!payload.id || !payload.sessionId || !['student', 'admin'].includes(payload.sessionClient || '')) throw new UnauthorizedException()
    } catch {
      throw new UnauthorizedException('登录状态已失效')
    }
    const user = await this.prisma.user.findUnique({ where: { id: payload.id, AND: [availableAccount()] }, include: authUserInclude })
    if (!user) { await assertNotBanned(this.prisma, payload.id); throw new UnauthorizedException('登录状态已失效') }
    if (user.status !== 'active') throw new UnauthorizedException('账号已禁用，请联系管理员')
    if ((payload.sessionVersion || 0) !== user.sessionVersion) throw new UnauthorizedException('会话已撤销，请重新登录')
    if (payload.sessionClient === 'student' && authUserDto(user).permissions.length) throw new UnauthorizedException('权限已变化，请通过管理后台完成 MFA')
    const session = await this.prisma.refreshToken.findUnique({ where: { id: payload.sessionId } })
    if (session?.userId === user.id && session.client === payload.sessionClient) assertNotReplaced(session)
    if (!payload.exp || payload.exp <= Date.now() / 1000) throw new UnauthorizedException('登录状态已失效')
    if (!session || session.userId !== user.id || session.client !== payload.sessionClient || session.revokedAt || session.expiresAt <= new Date()) throw new UnauthorizedException('设备会话已撤销，请重新登录')
    if (session.client === 'admin') {
      assertAdminNetwork(this.config, request.ip)
      if (!session.mfaVerified || !payload.mfaVerified || !user.mfaEnabledAt) throw new UnauthorizedException('管理员需要重新完成 MFA')
    }
    request.user = { ...authUserDto(user, await loadBadgeContext(this.prisma)), sessionId: session.id, sessionClient: payload.sessionClient, mfaVerified: session.mfaVerified }
    return true
  }
}
