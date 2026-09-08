import { Body, Controller, Get, Headers, Ip, Param, Post, Query, UseGuards } from '@nestjs/common'
import type { AuthUser, GovernanceTarget } from '@ai-learning-hub/contracts'
import { AuthGuard } from '../auth/auth.guard'
import { CurrentUser } from '../auth/current-user.decorator'
import { Permissions } from '../auth/permissions.decorator'
import { PermissionsGuard } from '../auth/permissions.guard'
import { AuthService } from '../auth/auth.service'
import { LoginDto } from '../auth/auth.dto'
import { CommunityGovernanceService } from './governance.service'
import { GovernanceAppealDecisionDto, GovernanceAppealDto, GovernanceDecisionDto, GovernancePageDto, GovernanceQueryDto, GovernanceReportDto, GovernanceRevisionDto, GovernanceRevokeDto } from './governance.dto'

@Controller('community/governance')
@UseGuards(AuthGuard)
export class CommunityGovernanceController {
  constructor(private readonly governance: CommunityGovernanceService) {}
  @Get('mine') mine(@CurrentUser() user: AuthUser, @Query() query: GovernancePageDto) { return this.governance.mine(user.id, query.page) }
  @Post('reports') report(@CurrentUser() user: AuthUser, @Body() input: GovernanceReportDto, @Ip() ip: string) { return this.governance.report(user.id, input.targetType, input.targetId, input, ip) }
  @Post('appeals') appeal(@CurrentUser() user: AuthUser, @Body() input: GovernanceAppealDto, @Ip() ip: string) { return this.governance.appeal(user.id, input, ip) }
}
@Controller('community/recovery')
export class CommunityRecoveryController {
  constructor(private readonly auth: AuthService, private readonly governance: CommunityGovernanceService) {}
  @Post('session') session(@Body() input: LoginDto, @Ip() ip: string) { return this.auth.recoverySession(input.identifier, input.password, ip) }
  @Get('mine') async mine(@Query() query: GovernancePageDto, @Headers('authorization') authorization?: string) { return this.governance.mine(await this.auth.recoveryIdentity(authorization), query.page) }
  @Post('appeals') async appeal(@Body() input: GovernanceAppealDto, @Ip() ip: string, @Headers('authorization') authorization?: string) { return this.governance.appeal(await this.auth.recoveryIdentity(authorization), input, ip) }
}
@Controller('admin/community/governance')
@UseGuards(AuthGuard, PermissionsGuard)
@Permissions('community.moderate', 'community.report.manage')
export class CommunityGovernanceAdminController {
  constructor(private readonly governance: CommunityGovernanceService) {}
  @Get() queue(@CurrentUser() user: AuthUser, @Query() query: GovernanceQueryDto) { return this.governance.queue(user, query) }
  @Post(':kind/:id/claim') claim(@CurrentUser() user: AuthUser, @Param('kind') kind: string, @Param('id') id: string, @Body() input: GovernanceRevisionDto) { return this.governance.claim(user, kind, id, input.expectedRevision) }
  @Post(':kind/:id/release') release(@CurrentUser() user: AuthUser, @Param('kind') kind: string, @Param('id') id: string, @Body() input: GovernanceRevisionDto) { return this.governance.release(user, kind, id, input.expectedRevision) }
  @Get('targets/:type/:id') @Permissions('community.moderate')
  history(@CurrentUser() user: AuthUser, @Param('type') type: string, @Param('id') id: string) { return this.governance.history(user, type, id) }
  @Post('reports/:id/decision') decision(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() input: GovernanceDecisionDto) { return this.governance.decideReport(user, id, input) }
  @Get('appeals/:id') appeal(@CurrentUser() user: AuthUser, @Param('id') id: string) { return this.governance.appealDetail(user, id) }
  @Post('appeals/:id/decision') appealDecision(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() input: GovernanceAppealDecisionDto) { return this.governance.decideAppeal(user, id, input) }
  @Post('actions/:id/revoke') revoke(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() input: GovernanceRevokeDto) { return this.governance.revoke(user, id, input.expectedRevision, input.reason) }
  @Post('targets/:type/:id/decision') @Permissions('community.moderate')
  direct(@CurrentUser() user: AuthUser, @Param('type') type: GovernanceTarget, @Param('id') id: string, @Body() input: GovernanceDecisionDto, @Headers('idempotency-key') key?: string) { return this.governance.decideDirect(user, type, id, input, key) }
}
