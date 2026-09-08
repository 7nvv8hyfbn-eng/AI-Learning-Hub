import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { JwtService } from '@nestjs/jwt'
import type { AuthRequest, AuthUser } from './auth.types'
import { PrismaService } from '../../prisma/prisma.service'
import { authUserDto, authUserInclude } from './auth.mapper'
import { availableAccount } from '../community/governance-policy'

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(private readonly jwt: JwtService, private readonly config: ConfigService, private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest<AuthRequest>()
    const token = request.headers.authorization?.match(/^Bearer (.+)$/)?.[1]
    if (!token) throw new UnauthorizedException('请先登录')
    let payload: AuthUser
    try {
      payload = await this.jwt.verifyAsync<AuthUser>(token, { secret: this.config.getOrThrow('JWT_SECRET') })
      if (!payload.id) throw new UnauthorizedException()
    } catch {
      throw new UnauthorizedException('登录状态已失效')
    }
    const user = await this.prisma.user.findUnique({ where: { id: payload.id, AND: [availableAccount()] }, include: authUserInclude })
    if (!user) throw new UnauthorizedException('登录状态已失效')
    if (user.status !== 'active') throw new UnauthorizedException('账号已禁用，请联系管理员')
    if ((payload.sessionVersion || 0) !== user.sessionVersion) throw new UnauthorizedException('会话已撤销，请重新登录')
    request.user = authUserDto(user)
    return true
  }
}
