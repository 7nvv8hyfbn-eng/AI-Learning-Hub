import { Body, Controller, Get, Patch, Post, UseGuards } from '@nestjs/common'
import { AuthGuard } from '../auth/auth.guard'
import { CurrentUser } from '../auth/current-user.decorator'
import { Permissions } from '../auth/permissions.decorator'
import { PermissionsGuard } from '../auth/permissions.guard'
import type { AuthUser } from '../auth/auth.types'
import { AssistantService } from './assistant.service'
import { ChatAssistantDto, DigestAssistantDto, SaveAssistantConfigDto } from './assistant.dto'

@Controller('assistant')
export class StudentAssistantController {
  constructor(private readonly assistant: AssistantService) {}
  @Get('config') config() { return this.assistant.readPublic() }
  @Post('chat') @UseGuards(AuthGuard)
  chat(@CurrentUser() user: AuthUser, @Body() input: ChatAssistantDto) { return this.assistant.chat(input, user.id) }
  @Post('digest') @UseGuards(AuthGuard)
  digest(@CurrentUser() user: AuthUser, @Body() input: DigestAssistantDto) { return this.assistant.digest(input, user.id) }
}

@Controller('admin/assistant')
@UseGuards(AuthGuard, PermissionsGuard)
export class AdminAssistantController {
  constructor(private readonly assistant: AssistantService) {}
  @Get('config') @Permissions('settings.read') config() { return this.assistant.readAdmin() }
  @Patch('config') @Permissions('settings.write') save(@Body() input: SaveAssistantConfigDto) { return this.assistant.save(input) }
  @Post('test-connection') @Permissions('settings.read') test() { return this.assistant.testConnection() }
}