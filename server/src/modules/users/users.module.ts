import { Module } from '@nestjs/common'
import { AuthModule } from '../auth/auth.module'
import { CampusVerificationController, UsersController } from './users.controller'
import { UsersService } from './users.service'
import { CommunityVisibilityModule } from '../community/visibility.module'
@Module({ imports: [AuthModule, CommunityVisibilityModule], controllers: [UsersController, CampusVerificationController], providers: [UsersService], exports: [UsersService] })
export class UsersModule {}
