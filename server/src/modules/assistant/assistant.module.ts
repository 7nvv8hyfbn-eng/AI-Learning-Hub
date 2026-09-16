import { Module } from '@nestjs/common'
import { AuthModule } from '../auth/auth.module'
import { CommunityModule } from '../community/community.module'
import { AssistantAdminController, AssistantController } from './assistant.controller'
import { AssistantModel } from './assistant.model'
import { AssistantService } from './assistant.service'

@Module({ imports: [AuthModule, CommunityModule], controllers: [AssistantController, AssistantAdminController], providers: [AssistantModel, AssistantService] })
export class AssistantModule {}
