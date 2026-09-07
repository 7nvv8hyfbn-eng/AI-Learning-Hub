import { Module } from '@nestjs/common'
import { AuthModule } from '../auth/auth.module'
import { BehaviorController, AdminGrowthController } from './behavior.controller'
import { BehaviorService } from './behavior.service'
import { SignalsModule } from '../signals/signals.module'
import { GrowthModule } from '../growth/growth.module'

@Module({ imports: [AuthModule, SignalsModule, GrowthModule], controllers: [BehaviorController, AdminGrowthController], providers: [BehaviorService] })
export class BehaviorModule {}
