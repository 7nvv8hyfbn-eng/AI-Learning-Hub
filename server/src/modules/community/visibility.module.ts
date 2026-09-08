import { Module } from '@nestjs/common'
import { CommunityUploadGuard, CommunityVisibilityPolicyService } from './visibility.service'
import { ContentDetectionService } from './content-detection.service'
import { CommunityNotificationService } from './notification.service'
import { SignalsModule } from '../signals/signals.module'
import { CommunityGovernanceService } from './governance.service'
@Module({ imports: [SignalsModule], providers: [CommunityVisibilityPolicyService, CommunityUploadGuard, ContentDetectionService, CommunityNotificationService, CommunityGovernanceService], exports: [CommunityVisibilityPolicyService, CommunityUploadGuard, ContentDetectionService, CommunityNotificationService, CommunityGovernanceService] })
export class CommunityVisibilityModule {}
