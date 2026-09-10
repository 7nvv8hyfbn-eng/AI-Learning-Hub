import { Body, Controller, Get, Headers, Param, Patch, Post, Put, Query, UseGuards } from '@nestjs/common'
import { AuthGuard } from '../auth/auth.guard'
import { PermissionsGuard } from '../auth/permissions.guard'
import { Permissions } from '../auth/permissions.decorator'
import { CurrentUser } from '../auth/current-user.decorator'
import type { AuthUser } from '../auth/auth.types'
import { UsersService } from './users.service'
import { CampusIdentityVerificationInputDto, IdentityReviewDto, ModeratorGrantUpdateDto, UserBadgeUpdateDto, UserQuery, UserReasonDto, UserStatusUpdateDto, UserUpdateDto } from './users.dto'
import { PrismaService } from '../../prisma/prisma.service'

@Controller('admin/users')
@UseGuards(AuthGuard, PermissionsGuard)
@Permissions('user.read')
export class UsersController {
  constructor(private readonly users: UsersService, private readonly prisma: PrismaService) {}
  @Get() list(@CurrentUser() actor: AuthUser, @Query() query: UserQuery) { return this.users.list(query, actor.permissions.includes('user.identity.read')) }
  @Get('verifications') listVerifications(@CurrentUser() actor: AuthUser, @Query() query: UserQuery) { return this.users.list({ ...query, identityVerificationStatus: query.identityVerificationStatus || 'pending' }, actor.permissions.includes('user.identity.read')) }
  @Get('growth-list') @Permissions('growth.read') growthList(@Query() query: UserQuery) { return this.users.list({ ...query, role: 'student' }) }
  @Get('export') @Permissions('user.export')
  async export(@CurrentUser() actor: AuthUser, @Query() query: UserQuery) {
    // 逐页导出，明确返回 total；不把全库敏感资料一次性载入进程或浏览器。
    const result = await this.users.list(query)
    await this.prisma.auditLog.create({ data: { actorId: actor.id, action: 'user_export', targetType: 'user', targetId: 'page', details: { page: query.page, pageSize: query.pageSize, count: result.items.length } } })
    return result
  }
  @Get('options') options() { return this.prisma.$transaction([
    this.prisma.school.findMany({ where: { status: 'active' }, select: { id: true, name: true, departments: { select: { id: true, name: true } } } }),
    this.prisma.role.findMany({ select: { code: true, name: true } }),
  ]).then(([schools, roles]) => ({ schools, roles })) }
  @Get(':id') detail(@CurrentUser() actor: AuthUser, @Param('id') id: string) { return this.users.detail(id, actor.permissions.includes('user.identity.read')) }
  @Get(':id/verification') @Permissions('user.read', 'user.identity.read')
  verification(@CurrentUser() actor: AuthUser, @Param('id') id: string) { return this.users.identityDetail(actor.id, id) }
  @Post(':id/verification/approve') @Permissions('user.read', 'user.identity.review')
  approve(@CurrentUser() actor: AuthUser, @Param('id') id: string, @Body() input: IdentityReviewDto) { return this.users.reviewIdentity(actor, id, 'approve', input) }
  @Post(':id/verification/reject') @Permissions('user.read', 'user.identity.review')
  reject(@CurrentUser() actor: AuthUser, @Param('id') id: string, @Body() input: IdentityReviewDto) { return this.users.reviewIdentity(actor, id, 'reject', input) }
  @Post(':id/verification/revoke') @Permissions('user.read', 'user.identity.review')
  revokeIdentity(@CurrentUser() actor: AuthUser, @Param('id') id: string, @Body() input: IdentityReviewDto) { return this.users.reviewIdentity(actor, id, 'revoke', input) }
  @Put(':id/moderator-grants') @Permissions('user.moderator.manage')
  moderatorGrants(@CurrentUser() actor: AuthUser, @Param('id') id: string, @Body() input: ModeratorGrantUpdateDto, @Headers('idempotency-key') key?: string) { return this.users.updateModeratorGrants(actor, id, input, key) }
  @Get(':id/badges') @Permissions('user.read', 'user.badge.manage')
  badges(@CurrentUser() actor: AuthUser, @Param('id') id: string) { return this.users.badges(actor, id) }
  @Put(':id/badges') @Permissions('user.read', 'user.badge.manage')
  updateBadges(@CurrentUser() actor: AuthUser, @Param('id') id: string, @Body() input: UserBadgeUpdateDto) { return this.users.updateBadges(actor, id, input) }
  @Patch(':id') @Permissions('user.write')
  update(@CurrentUser() actor: AuthUser, @Param('id') id: string, @Body() input: UserUpdateDto) { return this.users.update(actor, id, input, actor.permissions.includes('user.identity.read')) }
  @Patch(':id/status') @Permissions('user.write')
  status(@CurrentUser() actor: AuthUser, @Param('id') id: string, @Body() input: UserStatusUpdateDto) { return this.users.status(actor, id, input) }
  @Post(':id/reset-onboarding') @Permissions('user.write')
  reset(@CurrentUser() actor: AuthUser, @Param('id') id: string, @Body() input: UserReasonDto) { return this.users.action(actor, id, 'reset_onboarding', input.reason) }
  @Post(':id/revoke-sessions') @Permissions('user.session.revoke')
  revoke(@CurrentUser() actor: AuthUser, @Param('id') id: string, @Body() input: UserReasonDto) { return this.users.action(actor, id, 'revoke_sessions', input.reason) }
  @Post(':id/reset-password') @Permissions('user.write')
  resetPassword(@CurrentUser() actor: AuthUser, @Param('id') id: string, @Body() input: UserReasonDto) { return this.users.resetPassword(actor, id, input.reason) }
}

@Controller('community/verification')
@UseGuards(AuthGuard)
export class CampusVerificationController {
  constructor(private readonly users: UsersService) {}
  @Get() get(@CurrentUser() user: AuthUser) { return this.users.verificationSummary(user.id) }
  @Put() submit(@CurrentUser() user: AuthUser, @Body() input: CampusIdentityVerificationInputDto) { return this.users.submitVerification(user.id, input) }
}
