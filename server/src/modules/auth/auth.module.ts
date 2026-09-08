import { Module } from '@nestjs/common'
import { JwtModule } from '@nestjs/jwt'
import { AuthController, MeController } from './auth.controller'
import { AuthGuard } from './auth.guard'
import { AuthService } from './auth.service'
import { RolesGuard } from './roles.guard'
import { PermissionsGuard } from './permissions.guard'
import { WechatModule } from '../../integrations/wechat/wechat.module'
import { RegistrationService } from './registration.service'
import { CommunityVisibilityModule } from '../community/visibility.module'

@Module({
  imports: [JwtModule.register({}), WechatModule, CommunityVisibilityModule],
  controllers: [AuthController, MeController],
  providers: [AuthService, AuthGuard, RolesGuard, PermissionsGuard, RegistrationService],
  exports: [JwtModule, AuthGuard, RolesGuard, PermissionsGuard, AuthService, RegistrationService],
})
export class AuthModule {}
