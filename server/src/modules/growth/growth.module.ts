import { Module } from '@nestjs/common'
import { AuthModule } from '../auth/auth.module'
import { GrowthController } from './growth.controller'
import { GrowthService } from './growth.service'

@Module({
  imports: [AuthModule],
  controllers: [GrowthController],
  providers: [GrowthService],
  exports: [GrowthService],
})
export class GrowthModule {}
