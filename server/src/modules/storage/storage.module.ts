import { Module } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { PrismaService } from '../../prisma/prisma.service'
import { AuthModule } from '../auth/auth.module'
import { LocalStorageAdapter } from './local-storage.service'
import { MinioStorageAdapter, S3StorageAdapter } from './s3-storage.service'
import { LocalFileController, StorageController } from './storage.controller'
import { STORAGE_SERVICE } from './storage.types'
import { CommunityVisibilityModule } from '../community/visibility.module'
import { StorageQuotaService } from './storage-quota.service'
import { FileAccessService } from './file-access.service'

export function createStorageAdapter(prisma: PrismaService, config: ConfigService, quota = new StorageQuotaService(prisma, config)) {
  const driver = config.get('STORAGE_DRIVER') || 'local'
  if (driver === 's3') return new S3StorageAdapter(prisma, config, 's3', quota)
  if (driver === 'minio') return new MinioStorageAdapter(prisma, config, quota)
  if (driver !== 'local') throw new Error('STORAGE_DRIVER 只允许 local、minio 或 s3')
  return new LocalStorageAdapter(prisma, config, quota)
}

@Module({
  imports: [AuthModule, CommunityVisibilityModule],
  controllers: [StorageController, LocalFileController],
  providers: [StorageQuotaService, FileAccessService, {
    provide: STORAGE_SERVICE,
    inject: [PrismaService, ConfigService, StorageQuotaService],
    useFactory: createStorageAdapter,
  }],
  exports: [STORAGE_SERVICE, FileAccessService, StorageQuotaService],
})
export class StorageModule {}
