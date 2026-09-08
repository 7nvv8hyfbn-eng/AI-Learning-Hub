import { visibleProfile } from '../community/governance-policy'
import { BadRequestException, Body, Controller, Delete, Get, Inject, NotFoundException, Param, Post, Res, StreamableFile, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common'
import { ReservedUpload } from '../storage/reserved-upload.interceptor'
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
import { CommunityVisibilityPolicyService } from '../community/visibility.service'

@Controller('admin/files')
@UseGuards(AuthGuard, PermissionsGuard)
@Permissions('resource.write')
export class StorageController {
  constructor(@Inject(STORAGE_SERVICE) private readonly storage: StorageService, private readonly fileAccess: FileAccessService, private readonly prisma: PrismaService) {}

  @Post('upload')
  @UseInterceptors(ReservedUpload('image', 20 * 1024 * 1024))
  upload(@CurrentUser() user: AuthUser, @UploadedFile() file: Express.Multer.File, @Body('visibility') visibility = 'private') {
    if (!file) throw new BadRequestException('请选择文件')
    if (!['public', 'private'].includes(visibility)) throw new BadRequestException('文件可见性不合法')
    return this.storage.upload(file as StoredUpload, { uploadedBy: user.id, visibility: visibility as 'public' | 'private' })
  }

  @Get(':id/url')
  async url(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    await this.fileAccess.assert(user.id, id)
    return { url: `/api/v1/files/${encodeURIComponent(id)}/download`, expiresIn: 0 }
  }

  @Delete(':id')
  async delete(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    await this.fileAccess.assert(user.id, id)
    await this.storage.delete(id)
    await this.prisma.auditLog.create({ data: { actorId: user.id, action: 'storage_file_delete', targetType: 'file', targetId: id } })
    return { deleted: true }
  }
}

@Controller('files')
export class LocalFileController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly fileAccess: FileAccessService,
    @Inject(STORAGE_SERVICE) private readonly storage: StorageService,
    private readonly visibility: CommunityVisibilityPolicyService,
  ) {}

  @Get('profile/:id')
  @RawResponse()
  async profileImage(@Param('id') id: string, @Res({ passthrough: true }) response: Response) {
    const file = await this.prisma.fileRecord.findFirst({
      where: {
        id,
        visibility: 'public',
        OR: [
          { profileAvatars: { some: { user: visibleProfile() } } },
          { profileBanners: { some: { user: visibleProfile() } } },
        ],
      },
    })
    if (!file) throw new NotFoundException('文件不存在')
    await this.visibility.assertMediaEligibility(file.uploadedBy)
    const opened = await this.storage.open(id)
    response.set({
      'Content-Type': file.mimeType,
      'Content-Length': String(file.size),
      'Content-Disposition': `inline; filename*=UTF-8''${encodeURIComponent(file.originalName)}`,
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
    })
    response.once('close', () => opened.stream.destroy())
    return new StreamableFile(opened.stream)
  }

  @Get(':id/download')
  @RawResponse()
  @UseGuards(AuthGuard)
  async download(@CurrentUser() user: AuthUser, @Param('id') id: string, @Res({ passthrough: true }) response: Response) {
    await this.fileAccess.assert(user.id, id)
    const file = await this.storage.open(id)
    try {
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
      response.once('close', () => file.stream.destroy())
      return new StreamableFile(file.stream)
    } catch (error) {
      file.stream.destroy()
      throw error
    }
  }
}
