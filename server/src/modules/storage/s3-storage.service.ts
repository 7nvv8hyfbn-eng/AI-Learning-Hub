import { DeleteObjectCommand, HeadObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { GetObjectCommand } from '@aws-sdk/client-s3'
import { ConfigService } from '@nestjs/config'
import { createReadStream } from 'node:fs'
import type { Readable } from 'node:stream'
import { PrismaService } from '../../prisma/prisma.service'
import { StorageBase } from './storage.base'
import type { UploadedFile, UploadedPathFile } from './storage.types'

export class S3StorageAdapter extends StorageBase {
  protected readonly client: S3Client
  protected readonly bucket: string

  constructor(prisma: PrismaService, config: ConfigService, driver = 's3') {
    super(prisma, driver)
    this.bucket = config.getOrThrow('STORAGE_BUCKET')
    this.client = new S3Client({
      region: config.get('STORAGE_REGION') || 'us-east-1',
      endpoint: config.get('STORAGE_ENDPOINT') || undefined,
      forcePathStyle: driver === 'minio',
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
    await this.client.send(new PutObjectCommand({ Bucket: this.bucket, Key: objectKey, Body: createReadStream(file.path), ContentLength: file.size, ContentType: file.mimetype }))
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

  protected objectUrl(objectKey: string) {
    return getSignedUrl(this.client, new GetObjectCommand({ Bucket: this.bucket, Key: objectKey }), { expiresIn: 300 })
  }

  protected async openObject(objectKey: string, start?: number, end?: number) {
    const response = await this.client.send(new GetObjectCommand({
      Bucket: this.bucket,
      Key: objectKey,
      ...(start === undefined ? {} : { Range: `bytes=${start}-${end ?? ''}` }),
    }))
    if (!response.Body) throw new Error('对象存储未返回文件流')
    return response.Body as unknown as Readable
  }

  async getSignedUrl(fileId: string, expiresIn = 300) {
    const file = await this.prisma.fileRecord.findUnique({ where: { id: fileId } })
    if (!file || file.storageDriver !== this.driver) throw new Error('文件不存在或存储驱动不可用')
    return getSignedUrl(this.client, new GetObjectCommand({ Bucket: this.bucket, Key: file.objectKey }), { expiresIn })
  }
}

export class MinioStorageAdapter extends S3StorageAdapter {
  constructor(prisma: PrismaService, config: ConfigService) {
    super(prisma, config, 'minio')
  }
}
