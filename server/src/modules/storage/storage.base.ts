import { BadRequestException, NotFoundException } from '@nestjs/common'
import { createHash, randomUUID } from 'node:crypto'
import { createWriteStream } from 'node:fs'
import { open, stat } from 'node:fs/promises'
import type { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import * as path from 'node:path'
import { PrismaService } from '../../prisma/prisma.service'
import type { StoredFile, UploadedFile, UploadedPathFile, UploadOptions } from './storage.types'
import { StorageService } from './storage.types'
import { fileReferenced, lockFileReferences } from '../../common/persistence'
import { inspectMediaImage } from '../media/image-validation'

const allowed = new Map([
  ['.pdf', ['application/pdf']],
  ['.docx', ['application/vnd.openxmlformats-officedocument.wordprocessingml.document']],
  ['.pptx', ['application/vnd.openxmlformats-officedocument.presentationml.presentation']],
  ['.zip', ['application/zip', 'application/x-zip-compressed']],
  ['.txt', ['text/plain']],
  ['.png', ['image/png']],
  ['.jpg', ['image/jpeg']],
  ['.jpeg', ['image/jpeg']],
  ['.webp', ['image/webp']],
  ['.mp4', ['video/mp4']],
  ['.mov', ['video/quicktime']],
  ['.webm', ['video/webm']],
])

export abstract class StorageBase extends StorageService {
  constructor(protected readonly prisma: PrismaService, protected readonly driver: string) { super() }

  protected abstract putObject(objectKey: string, file: UploadedFile): Promise<void>
  protected abstract putPath(objectKey: string, file: UploadedPathFile): Promise<void>
  protected abstract removeObject(objectKey: string): Promise<void>
  protected abstract objectExists(objectKey: string): Promise<boolean>
  protected abstract objectUrl(objectKey: string): Promise<string>
  protected async openObject(_objectKey: string, _start?: number, _end?: number): Promise<Readable> {
    throw new BadRequestException('当前存储驱动不支持流式读取')
  }

  async upload(file: UploadedFile, options: UploadOptions): Promise<StoredFile> {
    const maxBytes = options.maxBytes || 20 * 1024 * 1024
    if (file.size <= 0 || file.size > maxBytes) throw new BadRequestException(`文件大小必须在 1 字节到 ${Math.floor(maxBytes / 1024 / 1024)}MB 之间`)
    const safeName = path.basename(file.originalname).replace(/[^\p{L}\p{N}._-]/gu, '_')
    const extension = path.extname(safeName).toLowerCase()
    if (options.catalogMedia) await inspectMediaImage(file, options.trustedSvg)
    if (!allowed.get(extension)?.includes(file.mimetype) && !(options.catalogMedia && options.trustedSvg && extension === '.svg')) throw new BadRequestException('文件扩展名或 MIME 类型不允许')
    const b = file.buffer
    const valid = extension === '.png' ? b.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
      : ['.jpg', '.jpeg'].includes(extension) ? b[0] === 255 && b[1] === 216 && b[2] === 255
      : extension === '.webp' ? b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP'
      : extension === '.pdf' ? b.toString('ascii', 0, 5) === '%PDF-'
      : ['.zip', '.docx', '.pptx'].includes(extension) ? b[0] === 80 && b[1] === 75 && [3, 5, 7].includes(b[2])
      : !b.includes(0)
    if (!valid || b.length !== file.size) throw new BadRequestException('文件内容与 MIME 或大小不匹配')
    const checksum = createHash('sha256').update(file.buffer).digest('hex')
    if (options.catalogMedia) {
      let ownedObject: string | null = null
      try { return await this.prisma.$transaction(async (tx) => {
        await lockFileReferences(tx)
        const existing = await tx.fileRecord.findFirst({ where: { checksum, storageDriver: this.driver, visibility: 'public', mimeType: file.mimetype, objectKey: { startsWith: 'catalog/' } } })
        if (existing) {
          if (!await this.objectExists(existing.objectKey)) await this.putObject(existing.objectKey, file)
          return { id: existing.id, originalName: existing.originalName, mimeType: existing.mimeType, size: existing.size, checksum }
        }
        // 每次新写独占对象键；checksum锁负责去重，失败补偿不碰其他成功事务。
        const objectKey = `catalog/${checksum}-${randomUUID()}${extension}`
        ownedObject = objectKey
        await this.putObject(objectKey, file)
        const record = await tx.fileRecord.create({ data: { storageDriver: this.driver, objectKey, originalName: safeName, extension, mimeType: file.mimetype, size: file.size, checksum, visibility: 'public', uploadedBy: options.uploadedBy } })
        return { id: record.id, originalName: record.originalName, mimeType: record.mimeType, size: record.size, checksum }
      }, { timeout: 30000 }) } catch (error) {
        // 提交结果不明时先核对元数据，不能把已成功提交的文件误删。
        if (ownedObject && !await this.prisma.fileRecord.count({ where: { objectKey: ownedObject } })) await this.removeObject(ownedObject)
        throw error
      }
    }
    const objectKey = `${new Date().toISOString().slice(0, 10)}/${randomUUID()}${extension}`
    await this.putObject(objectKey, file)
    const record = await this.prisma.fileRecord.create({
      data: {
        storageDriver: this.driver,
        objectKey,
        originalName: safeName,
        extension,
        mimeType: file.mimetype,
        size: file.size,
        checksum,
        visibility: options.visibility,
        uploadedBy: options.uploadedBy,
      },
    }).catch(async (error: unknown) => { await this.removeObject(objectKey); throw error })
    return { id: record.id, originalName: record.originalName, mimeType: record.mimeType, size: record.size, checksum: record.checksum }
  }

  async uploadPath(file: UploadedPathFile, options: UploadOptions): Promise<StoredFile> {
    const maxBytes = options.maxBytes || 1024 * 1024 * 1024
    if (file.size <= 0 || file.size > maxBytes) throw new BadRequestException(`文件大小必须在 1 字节到 ${Math.floor(maxBytes / 1024 / 1024)}MB 之间`)
    const safeName = path.basename(file.originalname).replace(/[^\p{L}\p{N}._-]/gu, '_')
    const extension = path.extname(safeName).toLowerCase()
    if (!allowed.get(extension)?.includes(file.mimetype)) throw new BadRequestException('文件扩展名或 MIME 类型不允许')
    const info = await stat(file.path)
    if (!info.isFile() || info.size !== file.size) throw new BadRequestException('上传文件大小不匹配')
    const handle = await open(file.path, 'r')
    const header = Buffer.alloc(Math.min(4096, file.size))
    try { await handle.read(header, 0, header.length, 0) } finally { await handle.close() }
    const valid = ['.mp4', '.mov'].includes(extension)
      ? header.toString('ascii', 4, 8) === 'ftyp'
      : extension === '.webm'
        ? header.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]))
        : extension === '.png'
          ? header.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
          : ['.jpg', '.jpeg'].includes(extension)
            ? header[0] === 255 && header[1] === 216 && header[2] === 255
            : extension === '.webp'
              ? header.toString('ascii', 0, 4) === 'RIFF' && header.toString('ascii', 8, 12) === 'WEBP'
              : extension === '.pdf'
                ? header.toString('ascii', 0, 5) === '%PDF-'
                : ['.zip', '.docx', '.pptx'].includes(extension)
                  ? header[0] === 80 && header[1] === 75 && [3, 5, 7].includes(header[2])
                  : extension === '.txt' && !header.includes(0)
    if (!valid) throw new BadRequestException('媒体内容与文件类型不匹配')
    const hash = createHash('sha256')
    const checksumHandle = await open(file.path, 'r')
    const chunk = Buffer.allocUnsafe(1024 * 1024)
    try {
      for (let position = 0; position < file.size;) {
        const { bytesRead } = await checksumHandle.read(chunk, 0, Math.min(chunk.length, file.size - position), position)
        if (!bytesRead) break
        hash.update(chunk.subarray(0, bytesRead))
        position += bytesRead
      }
    } finally { await checksumHandle.close() }
    const checksum = hash.digest('hex')
    const objectKey = `${new Date().toISOString().slice(0, 10)}/${randomUUID()}${extension}`
    await this.putPath(objectKey, file)
    const record = await this.prisma.fileRecord.create({
      data: {
        storageDriver: this.driver,
        objectKey,
        originalName: safeName,
        extension,
        mimeType: file.mimetype,
        size: file.size,
        checksum,
        visibility: options.visibility,
        uploadedBy: options.uploadedBy,
      },
    }).catch(async (error: unknown) => { await this.removeObject(objectKey); throw error })
    return { id: record.id, originalName: record.originalName, mimeType: record.mimeType, size: record.size, checksum }
  }

  async getSignedUrl(fileId: string, _expiresIn = 300) {
    const file = await this.prisma.fileRecord.findUnique({ where: { id: fileId } })
    if (!file || file.storageDriver !== this.driver) throw new NotFoundException('文件不存在或存储驱动不可用')
    return this.objectUrl(file.objectKey)
  }

  async copyToPath(fileId: string, target: string) {
    const file = await this.prisma.fileRecord.findUnique({ where: { id: fileId } })
    if (!file || file.storageDriver !== this.driver) throw new NotFoundException('文件不存在或存储驱动不可用')
    await pipeline(await this.openObject(file.objectKey), createWriteStream(target, { mode: 0o640, flags: 'wx' }))
  }

  async open(fileId: string, start?: number, end?: number) {
    const file = await this.prisma.fileRecord.findUnique({ where: { id: fileId } })
    if (!file || file.storageDriver !== this.driver) throw new NotFoundException('文件不存在或存储驱动不可用')
    return { stream: await this.openObject(file.objectKey, start, end), size: file.size, mimeType: file.mimeType, originalName: file.originalName }
  }

  async delete(fileId: string) {
    await this.prisma.$transaction(async (tx) => {
      await lockFileReferences(tx)
      const file = await tx.fileRecord.findUnique({ where: { id: fileId } })
      if (!file) return
      if (await fileReferenced(tx, fileId)) throw new BadRequestException('文件仍被业务内容或历史版本引用，不能清理')
      if (file.storageDriver !== this.driver) throw new BadRequestException('文件存储驱动与当前配置不一致')
      await this.removeObject(file.objectKey)
      await tx.fileRecord.delete({ where: { id: fileId } })
    }, { timeout: 20000 })
  }

  async writable() {
    const key = `_health/${randomUUID()}.txt`
    try { await this.putObject(key, { originalname: 'health.txt', mimetype: 'text/plain', size: 2, buffer: Buffer.from('ok') }); await this.removeObject(key); return true }
    catch { return false }
  }

  async exists(fileId: string) {
    const file = await this.prisma.fileRecord.findUnique({ where: { id: fileId } })
    return !!file && file.storageDriver === this.driver && this.objectExists(file.objectKey)
  }
}
