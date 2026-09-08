import { Module } from '@nestjs/common'
import { AuthModule } from '../auth/auth.module'
import { StorageModule } from '../storage/storage.module'
import { SignalsModule } from '../signals/signals.module'
import { ContentReferenceModule } from '../../common/content-reference/content-reference.module'
import { CommunityVisibilityModule } from './visibility.module'
import { CommunityController } from './community.controller'
import { CommunityAdminController } from './admin.controller'
import { CommunityPostService } from './post.service'
import { CommunityCommentService } from './comment.service'
import { CommunityInteractionService } from './interaction.service'
import { CommunityContextService } from './context.service'
import { LearningFeedPipeline } from '../feed/feed.service'
import { CommunitySearchService } from './search.service'
import { ContentSupportModule } from '../../common/content/content-support.module'
import { CommunityAdminService } from './admin.service'
import { CommunityGovernanceController, CommunityGovernanceAdminController, CommunityRecoveryController } from './governance.controller'
@Module({
  imports: [AuthModule, StorageModule, SignalsModule, ContentReferenceModule, CommunityVisibilityModule, ContentSupportModule],
  controllers: [CommunityController, CommunityAdminController, CommunityGovernanceController, CommunityGovernanceAdminController, CommunityRecoveryController],
  providers: [CommunityPostService, CommunityCommentService, CommunityInteractionService, CommunityContextService, LearningFeedPipeline, CommunitySearchService, CommunityAdminService],
  exports: [CommunityPostService],
})
export class CommunityModule {}
