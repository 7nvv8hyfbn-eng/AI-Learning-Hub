import { BadRequestException, Body, Controller, Delete, Get, Inject, NotFoundException, Param, Post, Res, StreamableFile, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { FileInterceptor } from '@nestjs/platform-express'
import { createReadStream } from 'node:fs'
import { access } from 'node:fs/promises'
import * as path from 'node:path'
import type { Response } from 'express'
import { RawResponse } from '../../common/raw-response.decorator'
import { PrismaService } from '../../prisma/prisma.service'
import { AuthGuard } from '../auth/auth.guard'
import { CurrentUser } from '../auth/current-user.decorator'
import { Permissions } from '../auth/permissions.decorator'
import { PermissionsGuard } from '../auth/permissions.guard'
import type { AuthUser } from '../auth/auth.types'
import { STORAGE_SERVICE, type StorageService, type UploadedFile as StoredUpload } from './storage.types'
import { FileAccessService } from './file-access.service'

@Controller('admin/files')
@UseGuards(AuthGuard, PermissionsGuard)
@Permissions('resource.write')
export class StorageController {
  constructor(@Inject(STORAGE_SERVICE) private readonly storage: StorageService, private readonly fileAccess: FileAccessService) {}

  @Post('upload')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 20 * 1024 * 1024, files: 1 } }))
  upload(@CurrentUser() user: AuthUser, @UploadedFile() file: Express.Multer.File, @Body('visibility') visibility = 'private') {
    if (!file) throw new BadRequestException('请选择文件')
    if (!['public', 'private'].includes(visibility)) throw new BadRequestException('文件可见性不合法')
    return this.storage.upload(file as StoredUpload, { uploadedBy: user.id, visibility: visibility as 'public' | 'private' })
  }

  @Get(':id/url')
  async url(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    await this.fileAccess.assert(user.id, id)
    return { url: await this.storage.getSignedUrl(id), expiresIn: 300 }
  }

  @Delete(':id')
  async delete(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    await this.fileAccess.assert(user.id, id)
    await this.storage.delete(id)
    return { deleted: true }
  }
}

@Controller('files')
export class LocalFileController {
  private readonly root: string

  constructor(
    private readonly prisma: PrismaService,
    config: ConfigService,
    private readonly fileAccess: FileAccessService,
    @Inject(STORAGE_SERVICE) private readonly storage: StorageService,
  ) {
    this.root = path.resolve(config.get('STORAGE_LOCAL_PATH') || './var/uploads')
  }

  @Get('profile/:id')
  @RawResponse()
  async profileImage(@Param('id') id: string, @Res({ passthrough: true }) response: Response) {
    const file = await this.prisma.fileRecord.findFirst({
      where: {
        id,
        visibility: 'public',
        OR: [
          { profileAvatars: { some: { user: { status: 'active' } } } },
          { profileBanners: { some: { user: { status: 'active' } } } },
        ],
      },
    })
    if (!file) throw new NotFoundException('文件不存在')
    if (file.storageDriver !== 'local') {
      response.redirect(await this.storage.getSignedUrl(id))
      return
    }
    const target = path.resolve(this.root, file.objectKey)
    if (!target.startsWith(`${this.root}${path.sep}`)) throw new NotFoundException('文件不存在')
    try { await access(target) } catch { throw new NotFoundException('文件不存在') }
    response.set({
      'Content-Type': file.mimeType,
      'Content-Length': String(file.size),
      'Content-Disposition': `inline; filename*=UTF-8''${encodeURIComponent(file.originalName)}`,
      'Cache-Control': 'public, max-age=300',
      'X-Content-Type-Options': 'nosniff',
    })
    return new StreamableFile(createReadStream(target))
  }

  @Get(':id/download')
  @RawResponse()
  @UseGuards(AuthGuard)
  async download(@CurrentUser() user: AuthUser, @Param('id') id: string, @Res({ passthrough: true }) response: Response) {
    const file = await this.fileAccess.assert(user.id, id)
    if (!file || file.storageDriver !== 'local') throw new NotFoundException('文件不存在')
    const target = path.resolve(this.root, file.objectKey)
    if (!target.startsWith(`${this.root}${path.sep}`)) throw new NotFoundException('文件不存在')
    try {
      await access(target)
    } catch {
      throw new NotFoundException('文件不存在')
    }
    const resources = await this.prisma.resource.findMany({ where: { status: 'published', deletedAt: null, publishedVersion: { is: { snapshot: { path: ['fileId'], equals: id } } } }, select: { id: true } })
    if (resources.length) {
      await this.prisma.$transaction(resources.flatMap((resource) => [
        this.prisma.resource.update({ where: { id: resource.id }, data: { downloadCount: { increment: 1 } } }),
        this.prisma.resourceDownload.create({ data: { resourceId: resource.id, userId: user.id } }),
      ]))
    }
    response.set({
      'Content-Type': file.mimeType,
      'Content-Length': String(file.size),
      'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(file.originalName)}`,
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
    })
    return new StreamableFile(createReadStream(target))
  }
}
