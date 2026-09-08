import { DeleteObjectCommand, HeadObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3'
import { GetObjectCommand } from '@aws-sdk/client-s3'
import { ConfigService } from '@nestjs/config'
import { createReadStream } from 'node:fs'
import type { Readable } from 'node:stream'
import { PrismaService } from '../../prisma/prisma.service'
import { StorageQuotaService } from './storage-quota.service'
import { StorageBase } from './storage.base'
import type { UploadedFile, UploadedPathFile } from './storage.types'

export class S3StorageAdapter extends StorageBase {
  protected readonly client: S3Client
  protected readonly bucket: string

  constructor(prisma: PrismaService, config: ConfigService, driver = 's3', quota = new StorageQuotaService(prisma, config)) {
    super(prisma, driver, config, quota)
    this.bucket = config.getOrThrow('STORAGE_BUCKET')
    this.client = new S3Client({
      region: config.get('STORAGE_REGION') || 'us-east-1',
      endpoint: config.get('STORAGE_ENDPOINT') || undefined,
      forcePathStyle: driver === 'minio',
      requestHandler: { connectionTimeout: 5000, requestTimeout: 120_000 },
      credentials: {
        accessKeyId: config.getOrThrow('STORAGE_ACCESS_KEY'),
        secretAccessKey: config.getOrThrow('STORAGE_SECRET_KEY'),
      },
    })
  }

  protected async putObject(objectKey: string, file: UploadedFile) {
    await this.client.send(new PutObjectCommand({ Bucket: this.bucket, Key: objectKey, Body: file.buffer, ContentType: file.mimetype }))
  }

  protected async putPath(objectKey: string, file: UploadedPathFile) {
    const stream = createReadStream(file.path)
    try { await this.client.send(new PutObjectCommand({ Bucket: this.bucket, Key: objectKey, Body: stream, ContentLength: file.size, ContentType: file.mimetype }), { abortSignal: AbortSignal.timeout(120_000) }) }
    finally { stream.destroy() }
  }

  protected async removeObject(objectKey: string) {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: objectKey }))
  }

  protected async objectExists(objectKey: string) {
    try {
      await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: objectKey }))
      return true
    } catch {
      return false
    }
  }

  protected async openObject(objectKey: string, start?: number, end?: number, signal?: AbortSignal) {
    const response = await this.client.send(new GetObjectCommand({
      Bucket: this.bucket,
      Key: objectKey,
      ...(start === undefined ? {} : { Range: `bytes=${start}-${end ?? ''}` }),
    }), { abortSignal: signal || AbortSignal.timeout(120_000) })
    if (!response.Body) throw new Error('对象存储未返回文件流')
    return response.Body as unknown as Readable
  }

}

export class MinioStorageAdapter extends S3StorageAdapter {
  constructor(prisma: PrismaService, config: ConfigService, quota = new StorageQuotaService(prisma, config)) {
    super(prisma, config, 'minio', quota)
  }
}
