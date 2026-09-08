import { BadRequestException, Body, Controller, Delete, Get, Inject, NotFoundException, Param, Patch, Post, Put, Query, Res, StreamableFile, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common'
import { ReservedUpload } from '../storage/reserved-upload.interceptor'
import { CommunityVisibilityPolicyService } from '../community/visibility.service'
import type { Response } from 'express'
import type { MediaContentType } from '@ai-learning-hub/contracts'
import { RawResponse } from '../../common/raw-response.decorator'
import { AuthGuard } from '../auth/auth.guard'
import { PermissionsGuard } from '../auth/permissions.guard'
import { Permissions } from '../auth/permissions.decorator'
import { CurrentUser } from '../auth/current-user.decorator'
import type { AuthUser } from '../auth/auth.types'
import { STORAGE_SERVICE, type StorageService } from '../storage/storage.types'
import { MediaService } from './media.service'
import { MediaResolverService } from './media-resolver.service'
import { MediaDefaultDto, MediaQueryDto, MediaResolveDto, MediaUpdateDto, MediaUploadDto, PageVisualsDto } from './media.dto'

@Controller()
export class MediaFileController {
  constructor(private readonly media: MediaService, private readonly visibility: CommunityVisibilityPolicyService, @Inject(STORAGE_SERVICE) private readonly storage: StorageService) {}
  private async send(id: string, publicOnly: boolean, response: Response, actorId?: string) {
    const asset = await this.media.record(id)
    if (publicOnly && (asset.status !== 'active' || asset.deletedAt || asset.file.visibility !== 'public')) throw new NotFoundException('素材不存在')
    const file = asset.file
    await this.visibility.assertMediaEligibility(file.uploadedBy)
    if (actorId) { await this.visibility.assertMediaEligibility(actorId); await this.visibility.auditAdminRead(actorId, 'media_asset', id) }
    response.set({ 'Content-Type': file.mimeType, 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'private, no-store', 'Content-Security-Policy': "default-src 'none'; sandbox", 'Cross-Origin-Resource-Policy': 'same-origin' })
    const opened = await this.storage.open(file.id)
    response.set('Content-Length', String(file.size))
    response.once('close', () => opened.stream.destroy())
    return new StreamableFile(opened.stream)
  }
  @Get('public/media/:id') @RawResponse()
  publicFile(@Param('id') id: string, @Res({ passthrough: true }) response: Response) { return this.send(id, true, response) }
  @Get('admin/media-assets/:id/preview') @UseGuards(AuthGuard, PermissionsGuard) @Permissions('media.read') @RawResponse()
  preview(@Param('id') id: string, @Res({ passthrough: true }) response: Response, @CurrentUser() user: AuthUser) { return this.send(id, false, response, user.id) }
}

@Controller('admin')
@UseGuards(AuthGuard, PermissionsGuard)
export class AdminMediaController {
  constructor(private readonly media: MediaService, private readonly resolver: MediaResolverService) {}
  @Get('media-assets') @Permissions('media.read') list(@Query() query: MediaQueryDto) { return this.media.list(query) }
  @Get('media-assets/resolve') @Permissions('media.read')
  resolve(@Query() query: MediaResolveDto) { return this.resolver.resolve({ ...query, contentType: query.contentType as MediaContentType }) }
  @Post('media-assets/upload') @Permissions('media.write')
  @UseInterceptors(ReservedUpload('image', 5 * 1024 * 1024))
  upload(@UploadedFile() file: Express.Multer.File, @Body() input: MediaUploadDto, @CurrentUser() user: AuthUser) {
    if (!file) throw new BadRequestException('请选择图片')
    return this.media.upload(file, input, user)
  }
  @Get('media-assets/:id') @Permissions('media.read') detail(@Param('id') id: string) { return this.media.detail(id) }
  @Get('media-assets/:id/url') @Permissions('media.read')
  async url(@Param('id') id: string) { const asset = await this.media.detail(id); return { url: asset.url, expiresIn: 0 } }
  @Get('media-assets/:id/usage') @Permissions('media.read') usage(@Param('id') id: string) { return this.media.usage(id) }
  @Patch('media-assets/:id') @Permissions('media.write')
  update(@Param('id') id: string, @Body() input: MediaUpdateDto, @CurrentUser() user: AuthUser) { return this.media.update(id, input, user.id) }
  @Delete('media-assets/:id') @Permissions('media.delete')
  remove(@Param('id') id: string, @CurrentUser() user: AuthUser) { return this.media.remove(id, user.id) }
  @Get('media-defaults') @Permissions('media.read') defaults() { return this.media.defaults() }
  @Put('media-defaults/:contentType/:categoryKey') @Permissions('media.default.manage')
  setDefault(@Param('contentType') type: string, @Param('categoryKey') category: string, @Body() input: MediaDefaultDto, @CurrentUser() user: AuthUser) { return this.media.setDefault(type, category, input, user.id) }
  @Get('page-visuals') @Permissions('media.read') visuals() { return this.media.pageVisualConfig() }
  @Put('page-visuals') @Permissions('media.default.manage')
  saveVisuals(@Body() input: PageVisualsDto, @CurrentUser() user: AuthUser) { return this.media.setPageVisuals(input.value, input.expectedRevision, user.id) }
}

@Controller('public')
export class PublicMediaController {
  constructor(private readonly media: MediaService) {}
  @Get('page-visuals') visuals() { return this.media.pageVisuals() }
}
