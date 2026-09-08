import { Module } from '@nestjs/common'
import { AuthModule } from '../auth/auth.module'
import { StorageModule } from '../storage/storage.module'
import { AdminMediaController, MediaFileController, PublicMediaController } from './media.controller'
import { MediaService } from './media.service'
import { MediaResolverService } from './media-resolver.service'
import { CommunityVisibilityModule } from '../community/visibility.module'
@Module({ imports: [AuthModule, StorageModule, CommunityVisibilityModule], providers: [MediaService, MediaResolverService], controllers: [AdminMediaController, MediaFileController, PublicMediaController], exports: [MediaService, MediaResolverService] })
export class MediaModule {}
