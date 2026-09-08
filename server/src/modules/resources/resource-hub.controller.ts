import { BadRequestException, Body, Controller, Delete, Get, Head, Headers, Param, Patch, Post, Put, Query, Res, StreamableFile, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common'
import { ReservedUpload } from '../storage/reserved-upload.interceptor'
import { rm } from 'node:fs/promises'
import type { Response } from 'express'
import { RawResponse } from '../../common/raw-response.decorator'
import { AuthGuard } from '../auth/auth.guard'
import { CurrentUser } from '../auth/current-user.decorator'
import type { AuthUser } from '../auth/auth.types'
import { CommunityUploadGuard } from '../community/visibility.service'
import { Permissions } from '../auth/permissions.decorator'
import { PermissionsGuard } from '../auth/permissions.guard'
import { CollectionCourseDto, CollectionInputDto, CollectionItemDto, CollectionReorderDto, ContributionAdminDto, ResourceCategoryInputDto, ResourceHubConfigDto, ResourceHubQueryDto, WatchProgressDto } from './resource-hub.dto'
import { parseSingleRange, ResourceHubService } from './resource-hub.service'

@Controller('resource-hub')
@UseGuards(AuthGuard)
export class ResourceHubController {
  constructor(private readonly hub: ResourceHubService) {}

  @Get('home') home(@CurrentUser() user: AuthUser) { return this.hub.home(user.id) }
  @Get('categories') categories() { return this.hub.categories() }
  @Get('items') list(@CurrentUser() user: AuthUser, @Query() query: ResourceHubQueryDto) { return this.hub.list(user.id, query) }
  @Get('studio') studio(@CurrentUser() user: AuthUser) { return this.hub.studio(user.id) }
  @Get('capacity') capacity(@CurrentUser() user: AuthUser) { return this.hub.capacity(user.id) }
  @Get('creators/:userId') creator(@CurrentUser() user: AuthUser, @Param('userId') userId: string) { return this.hub.creator(user.id, userId) }
  @Get('contributions/:postId') detail(@CurrentUser() user: AuthUser, @Param('postId') postId: string) { return this.hub.detail(user.id, postId) }

  @Post('uploads/video')
  @UseGuards(CommunityUploadGuard)
  @UseInterceptors(ReservedUpload('video'))
  async video(@CurrentUser() user: AuthUser, @UploadedFile() file: Express.Multer.File, @Headers('idempotency-key') key?: string) {
    if (!file?.path) throw new BadRequestException('请选择视频文件')
    try { return await this.hub.uploadVideo(user.id, file, key) }
    finally { await rm(file.path, { force: true }) }
  }

  @Post('uploads/document')
  @UseGuards(CommunityUploadGuard)
  @UseInterceptors(ReservedUpload('document'))
  async document(@CurrentUser() user: AuthUser, @UploadedFile() file: Express.Multer.File, @Headers('idempotency-key') key?: string) {
    if (!file?.path) throw new BadRequestException('请选择资料文件')
    try { return await this.hub.uploadDocument(user.id, file, key) }
    finally { await rm(file.path, { force: true }) }
  }

  @Get('videos/:id') videoStatus(@CurrentUser() user: AuthUser, @Param('id') id: string) { return this.hub.video(user.id, id) }
  @Post('videos/:id/retry') retry(@CurrentUser() user: AuthUser, @Param('id') id: string) { return this.hub.retryVideo(user.id, id) }
  @Get('videos/:id/playback') playback(@CurrentUser() user: AuthUser, @Param('id') id: string) { return this.hub.playback(user.id, id) }
  @Put('videos/:id/progress') progress(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() input: WatchProgressDto) { return this.hub.progress(user.id, id, input) }

  @Get('collections') collections(@CurrentUser() user: AuthUser) { return this.hub.collections(user.id) }
  @Post('collections') createCollection(@CurrentUser() user: AuthUser, @Body() input: CollectionInputDto, @Headers('idempotency-key') key?: string) { return this.hub.createCollection(user.id, input, key) }
  @Get('collections/:id') collection(@CurrentUser() user: AuthUser, @Param('id') id: string) { return this.hub.collection(user.id, id) }
  @Patch('collections/:id') updateCollection(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() input: CollectionInputDto) { return this.hub.updateCollection(user.id, id, input) }
  @Post('collections/:id/items') add(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() input: CollectionItemDto) { return this.hub.addToCollection(user.id, id, input.postId) }
  @Delete('collections/:id/items/:itemId') remove(@CurrentUser() user: AuthUser, @Param('id') id: string, @Param('itemId') itemId: string) { return this.hub.removeFromCollection(user.id, id, itemId) }
  @Put('collections/:id/order') reorder(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() input: CollectionReorderDto) { return this.hub.reorderCollection(user.id, id, input.expectedRevision, input.itemIds) }
}

@Controller('admin/resource-hub')
@UseGuards(AuthGuard, PermissionsGuard)
@Permissions('resource.read')
export class ResourceHubAdminController {
  constructor(private readonly hub: ResourceHubService) {}

  @Get('items') items(@CurrentUser() user: AuthUser, @Query() query: ResourceHubQueryDto) { return this.hub.adminItems(user.id, query) }
  @Patch('items/:postId') @Permissions('resource.write')
  update(@CurrentUser() user: AuthUser, @Param('postId') postId: string, @Body() input: ContributionAdminDto) { return this.hub.updateContribution(user.id, postId, input) }

  @Get('config') config() { return this.hub.configState() }
  @Patch('config') @Permissions('resource.write')
  updateConfig(@Body() input: ResourceHubConfigDto) { return this.hub.updateConfig(input) }

  @Get('categories') categories() { return this.hub.adminCategories() }
  @Post('categories') @Permissions('resource.write')
  createCategory(@CurrentUser() user: AuthUser, @Body() input: ResourceCategoryInputDto) { return this.hub.createCategory(user.id, input) }
  @Patch('categories/:id') @Permissions('resource.write')
  updateCategory(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() input: ResourceCategoryInputDto) { return this.hub.updateCategory(user.id, id, input) }

  @Get('processing-failures') failures() { return this.hub.processingFailures() }
  @Get('media-runtime') runtime() { return this.hub.mediaRuntime() }
  @Post('processing-failures/:id/retry') @Permissions('resource.write')
  retry(@CurrentUser() user: AuthUser, @Param('id') id: string) { return this.hub.retryVideo(user.id, id, true) }
  @Post('processing-orphans/cleanup') @Permissions('resource.write')
  cleanup(@CurrentUser() user: AuthUser) { return this.hub.cleanupVideoOrphans(user.id) }

  @Get('reports') @Permissions('community.report.manage')
  reports() { return this.hub.resourceReports() }
  @Get('collections') collections() { return this.hub.adminCollections() }
  @Post('collections/:id/course') @Permissions('course.write')
  toCourse(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() input: CollectionCourseDto) { return this.hub.collectionToCourse(user.id, id, input) }
}

@Controller('resource-hub')
export class ResourceHubMediaController {
  constructor(private readonly hub: ResourceHubService) {}

  @Get('play/:id')
  @Head('play/:id')
  @RawResponse()
  async play(@Param('id') id: string, @Query('token') token: string, @Headers('range') range: string | undefined, @Res({ passthrough: true }) response: Response) {
    const file = await this.hub.playbackFile(id, token)
    let selected: ReturnType<typeof parseSingleRange>
    try { selected = parseSingleRange(range, file.size) }
    catch {
      file.stream.destroy()
      response.status(416).set({ 'Content-Range': `bytes */${file.size}`, 'Accept-Ranges': 'bytes', 'Cache-Control': 'private, no-store' })
      return
    }
    response.status(selected ? 206 : 200).set({
      'Content-Type': file.mimeType,
      'Content-Length': String(selected ? selected.end - selected.start + 1 : file.size),
      ...(selected ? { 'Content-Range': `bytes ${selected.start}-${selected.end}/${file.size}` } : {}),
      'Accept-Ranges': 'bytes',
      'Content-Disposition': 'inline',
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
    })
    if (response.req.method === 'HEAD') { file.stream.destroy(); return }
    let stream = file.stream
    if (selected) {
      file.stream.destroy()
      stream = (await this.hub.playbackFile(id, token, selected.start, selected.end)).stream
    }
    response.once('close', () => stream.destroy())
    return new StreamableFile(stream)
  }

  @Get('media/:id')
  @RawResponse()
  async media(@Param('id') id: string, @Query('token') token: string, @Res({ passthrough: true }) response: Response) {
    const file = await this.hub.mediaFile(id, token)
    response.set({
      'Content-Type': file.mimeType,
      'Content-Length': String(file.size),
      'Content-Disposition': 'inline',
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
    })
    response.once('close', () => file.stream.destroy())
    return new StreamableFile(file.stream)
  }

  @Get('download/:id')
  @RawResponse()
  async download(@Param('id') id: string, @Query('token') token: string, @Res({ passthrough: true }) response: Response) {
    const file = await this.hub.attachmentFile(id, token)
    response.set({
      'Content-Type': file.mimeType,
      'Content-Length': String(file.size),
      'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(file.originalName)}`,
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
    })
    response.once('close', () => file.stream.destroy())
    return new StreamableFile(file.stream)
  }
}
