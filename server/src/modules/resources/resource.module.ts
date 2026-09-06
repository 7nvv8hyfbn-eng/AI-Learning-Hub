import { Module } from '@nestjs/common'
import { ContentSupportModule } from '../../common/content/content-support.module'
import { AuthModule } from '../auth/auth.module'
import { CommunityModule } from '../community/community.module'
import { CommunityVisibilityModule } from '../community/visibility.module'
import { CourseModule } from '../courses/course.module'
import { StorageModule } from '../storage/storage.module'
import { AdminResourceController, PublicResourceController } from './resource.controller'
import { ResourceHubAdminController, ResourceHubController, ResourceHubMediaController } from './resource-hub.controller'
import { ResourceHubService } from './resource-hub.service'
import { ResourceService } from './resource.service'
import { VideoProcessingService } from './video-processing.service'

@Module({
  imports: [AuthModule, ContentSupportModule, StorageModule, CommunityModule, CommunityVisibilityModule, CourseModule],
  controllers: [AdminResourceController, PublicResourceController, ResourceHubController, ResourceHubAdminController, ResourceHubMediaController],
  providers: [ResourceService, ResourceHubService, VideoProcessingService],
  exports: [ResourceService],
})
export class ResourceModule {}
