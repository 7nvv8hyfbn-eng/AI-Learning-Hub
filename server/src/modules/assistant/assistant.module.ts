import { Module } from '@nestjs/common'
import { AuthModule } from '../auth/auth.module'
import { CommunityVisibilityModule } from '../community/visibility.module'
import { AdminAssistantController, StudentAssistantController } from './assistant.controller'
import { AssistantService } from './assistant.service'

@Module({
  imports: [AuthModule, CommunityVisibilityModule],
  controllers: [AdminAssistantController, StudentAssistantController],
  providers: [AssistantService],
  exports: [AssistantService],
})
export class AssistantModule {}