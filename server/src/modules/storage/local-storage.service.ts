import { Injectable, NotFoundException } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { constants, createReadStream, type Dir } from 'node:fs'
import { access, chmod, copyFile, mkdir, opendir, rename, rm, stat, writeFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import * as path from 'node:path'
import { PrismaService } from '../../prisma/prisma.service'
import { StorageQuotaService } from './storage-quota.service'
import { StorageBase } from './storage.base'
import type { UploadedFile, UploadedPathFile } from './storage.types'

@Injectable()
export class LocalStorageAdapter extends StorageBase {
  private readonly root: string
  private orphanDirectory?: Dir

  constructor(prisma: PrismaService, config: ConfigService, quota = new StorageQuotaService(prisma, config)) {
    super(prisma, 'local', config, quota)
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

  protected async cleanupAbandonedObjects() {
    await mkdir(this.root, { recursive: true, mode: 0o750 })
    this.orphanDirectory ||= await opendir(this.root, { recursive: true })
    for (let checked = 0; checked < 200; checked++) {
      const entry = await this.orphanDirectory.read()
      if (!entry) { await this.orphanDirectory.close(); this.orphanDirectory = undefined; return }
      if (!entry.isFile()) continue
      const key = path.relative(this.root, path.join(entry.parentPath, entry.name))
      const reserved = key.match(/^reserved\/([a-zA-Z0-9-]{8,100})\/[a-f0-9-]{36}\.[a-z0-9]+(?:\.[a-f0-9-]{36}\.pending)?$/)
      const legacy = /^(?:catalog\/[a-f0-9]{64}-|\d{4}-\d{2}-\d{2}\/)[a-f0-9-]{36}\.[a-z0-9]+(?:\.[a-f0-9-]{36}\.pending)?$/.test(key)
      if (!reserved && !legacy) continue
      if (reserved) {
        const reservation = await this.prisma.storageReservation.findUnique({ where: { id: reserved[1] } })
        if (reservation && reservation.state !== 'released') continue
      }
      if (Date.now() - (await stat(this.target(key))).mtimeMs < (reserved ? 180_000 : 86400000)) continue
      if (!await this.prisma.fileRecord.count({ where: { storageDriver: this.driver, objectKey: key } })) await this.removeObject(key)
    }
  }

  async onModuleDestroy() {
    await super.onModuleDestroy()
    await this.orphanDirectory?.close()
    this.orphanDirectory = undefined
  }

  protected async objectExists(objectKey: string) {
    try {
      await access(this.target(objectKey))
      return true
    } catch {
      return false
    }
  }

  protected async openObject(objectKey: string, start?: number, end?: number) {
    const target = this.target(objectKey)
    try { await access(target) } catch { throw new NotFoundException('文件不存在') }
    return createReadStream(target, start === undefined ? undefined : { start, end })
  }

}
