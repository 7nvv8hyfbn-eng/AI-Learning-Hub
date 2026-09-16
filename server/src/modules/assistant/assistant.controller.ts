import { Body, Controller, Get, Patch, Post, UseGuards } from '@nestjs/common'
import { AuthGuard } from '../auth/auth.guard'
import { CurrentUser } from '../auth/current-user.decorator'
import type { AuthUser } from '../auth/auth.types'
import { Permissions } from '../auth/permissions.decorator'
import { PermissionsGuard } from '../auth/permissions.guard'
import { AssistantChatInputDto, AssistantConfigInputDto } from './assistant.dto'
import { AssistantService } from './assistant.service'

@Controller('assistant')
@UseGuards(AuthGuard)
export class AssistantController {
  constructor(private readonly assistant: AssistantService) {}
  @Get('config') config() { return this.assistant.configuration() }
  @Post('chat') chat(@CurrentUser() user: AuthUser, @Body() input: AssistantChatInputDto) { return this.assistant.chat(user.id, input) }
}
@Controller('admin/assistant')
@UseGuards(AuthGuard, PermissionsGuard)
export class AssistantAdminController {
  constructor(private readonly assistant: AssistantService) {}
  @Get('config') @Permissions('settings.read') config() { return this.assistant.configuration(true) }
  @Patch('config') @Permissions('settings.write') update(@Body() input: AssistantConfigInputDto) { return this.assistant.update(input) }
  @Post('test') @Permissions('settings.write') test(@CurrentUser() user: AuthUser) { return this.assistant.testConnection(user.id) }
}
