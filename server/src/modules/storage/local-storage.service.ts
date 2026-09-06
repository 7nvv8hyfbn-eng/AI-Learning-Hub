import { Injectable, NotFoundException } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { constants, createReadStream } from 'node:fs'
import { access, chmod, copyFile, mkdir, rename, rm, writeFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import * as path from 'node:path'
import { PrismaService } from '../../prisma/prisma.service'
import { StorageBase } from './storage.base'
import type { UploadedFile, UploadedPathFile } from './storage.types'

@Injectable()
export class LocalStorageAdapter extends StorageBase {
  private readonly root: string

  constructor(prisma: PrismaService, config: ConfigService) {
    super(prisma, 'local')
    this.root = path.resolve(config.get('STORAGE_LOCAL_PATH') || './var/uploads')
  }

  private target(key: string) {
    const target = path.resolve(this.root, key)
    if (!target.startsWith(`${this.root}${path.sep}`)) throw new Error('非法对象路径')
    return target
  }

  protected async putObject(objectKey: string, file: UploadedFile) {
    const target = this.target(objectKey)
    await mkdir(path.dirname(target), { recursive: true, mode: 0o750 })
    const staging = `${target}.${randomUUID()}.pending`
    try {
      await writeFile(staging, file.buffer, { mode: 0o640, flag: 'wx' })
      await rename(staging, target)
    } finally { await rm(staging, { force: true }) }
  }

  protected async putPath(objectKey: string, file: UploadedPathFile) {
    const target = this.target(objectKey)
    await mkdir(path.dirname(target), { recursive: true, mode: 0o750 })
    const staging = `${target}.${randomUUID()}.pending`
    try {
      await copyFile(file.path, staging, constants.COPYFILE_EXCL)
      await chmod(staging, 0o640)
      await rename(staging, target)
    } finally { await rm(staging, { force: true }) }
  }

  protected async removeObject(objectKey: string) {
    await rm(this.target(objectKey), { force: true })
  }

  protected async objectExists(objectKey: string) {
    try {
      await access(this.target(objectKey))
      return true
    } catch {
      return false
    }
  }

  protected async objectUrl(objectKey: string) {
    return `/api/v1/files/local/${encodeURIComponent(objectKey)}`
  }

  protected async openObject(objectKey: string, start?: number, end?: number) {
    return createReadStream(this.target(objectKey), start === undefined ? undefined : { start, end })
  }

  async getSignedUrl(fileId: string, _expiresIn = 300) {
    const file = await this.prisma.fileRecord.findUnique({ where: { id: fileId } })
    if (!file || file.storageDriver !== 'local') throw new NotFoundException('文件不存在')
    return `/api/v1/files/${encodeURIComponent(file.id)}/download`
  }
}
