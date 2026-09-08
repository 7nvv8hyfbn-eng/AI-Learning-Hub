import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { mkdir, rm, stat } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import * as path from 'node:path'
import { PrismaService } from '../../prisma/prisma.service'
import { STORAGE_SERVICE, type StorageService } from '../storage/storage.types'
import { runMediaCommand } from '../../common/media-process'
import { fileReferenced, lockFileReferences } from '../../common/persistence'
import { POSTER_LIMIT_BYTES, PROCESSING_LEASE_MS, StorageQuotaService } from '../storage/storage-quota.service'
export { runMediaCommand } from '../../common/media-process'

type Probe = {
  format?: { duration?: string; format_name?: string }
  streams?: Array<{ codec_type?: string; codec_name?: string; pix_fmt?: string; width?: number; height?: number; avg_frame_rate?: string; tags?: { rotate?: string }; side_data_list?: Array<{ rotation?: number }> }>
}

export function validateVideoProbe(probe: Probe) {
  const video = probe.streams?.find((stream) => stream.codec_type === 'video')
  const duration = Number(probe.format?.duration)
  const [numerator, denominator = '1'] = (video?.avg_frame_rate || '').split('/')
  const fps = Number(numerator) / Number(denominator)
  if (!probe.format?.format_name?.split(',').some((name) => ['mov', 'mp4', 'matroska', 'webm'].includes(name)) || !video || !Number.isFinite(duration) || duration <= 0 || duration > 4 * 3600 || !video.width || !video.height || video.width > 3840 || video.height > 3840 || video.width * video.height > 3840 * 2160 || !Number.isFinite(fps) || fps <= 0 || fps > 60 || duration * fps > 864000 || (probe.streams?.length || 0) > 8) throw new Error('视频格式、时长、分辨率或帧率超出处理范围（4小时、4K、60fps）')
  return { video, duration, audio: probe.streams?.find((stream) => stream.codec_type === 'audio') }
}

@Injectable()
export class VideoProcessingService implements OnModuleInit, OnModuleDestroy {
  private timer?: NodeJS.Timeout
  private running?: Promise<void>
  private checking = false
  private stopping = false
  private abort?: AbortController
  private readonly logger = new Logger(VideoProcessingService.name)
  private readonly maxAttempts: number
  private readonly ffmpeg: string
  private readonly ffprobe: string

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    @Inject(STORAGE_SERVICE) private readonly storage: StorageService,
    private readonly quota: StorageQuotaService,
  ) {
    this.maxAttempts = Math.max(1, Math.min(5, Number(config.get('VIDEO_PROCESSING_MAX_ATTEMPTS') || 3)))
    this.ffmpeg = config.get('FFMPEG_PATH') || 'ffmpeg'
    this.ffprobe = config.get('FFPROBE_PATH') || 'ffprobe'
  }

  async onModuleInit() {
    if (this.config.get('NODE_ENV') === 'test') return
    this.timer = setInterval(() => { void this.tick() }, 5000)
    void this.tick()
  }

  async onModuleDestroy() {
    this.stopping = true
    if (this.timer) clearInterval(this.timer)
    this.abort?.abort()
    await this.running
  }

  private async tick() {
    if (this.checking || this.stopping) return
    this.checking = true
    try { await this.recoverExpired(); void this.processNext() }
    catch (error) { this.logger.error(`媒体队列检查失败：${error instanceof Error ? error.message : '未知错误'}`) }
    finally { this.checking = false }
  }

  async recoverExpired() {
    const expired = await this.prisma.videoAsset.findMany({ where: { status: 'processing', OR: [{ leaseExpiresAt: null }, { leaseExpiresAt: { lte: new Date() } }] }, take: 20 })
    for (const asset of expired) await this.prisma.$transaction(async (tx) => {
      await lockFileReferences(tx)
      const updated = await tx.videoAsset.updateMany({ where: { id: asset.id, status: 'processing', claimToken: asset.claimToken, OR: [{ leaseExpiresAt: null }, { leaseExpiresAt: { lte: new Date() } }] }, data: { status: asset.attempts < this.maxAttempts ? 'uploaded' : 'failed', claimToken: null, claimedAt: null, leaseExpiresAt: null, lastError: '处理租约失效，任务已回收' } })
      if (!updated.count || !asset.reservationId) return
      await tx.storageReservation.updateMany({ where: { id: asset.reservationId, claimToken: asset.claimToken ?? undefined }, data: { state: 'released', remainingBytes: 0n, temporaryBytes: 0n } })
      for (const file of await tx.fileRecord.findMany({ where: { reservationId: asset.reservationId, id: { not: asset.sourceFileId } }, select: { id: true } })) await tx.mediaGcJob.upsert({ where: { fileId: file.id }, create: { fileId: file.id }, update: {} })
    })
    return expired.length
  }

  async retry(userId: string, id: string, administrative = false) {
    const asset = await this.prisma.videoAsset.findUnique({ where: { id } })
    if (!asset) throw new BadRequestException('视频不存在')
    if (!administrative && asset.uploaderId !== userId) throw new ForbiddenException('只能重试自己上传的视频')
    if (asset.status !== 'failed') throw new BadRequestException('只有处理失败的视频可以重试')
    if (asset.attempts >= this.maxAttempts) throw new BadRequestException(`视频处理最多重试 ${this.maxAttempts} 次`)
    await this.prisma.$transaction(async (tx) => {
      await lockFileReferences(tx)
      if (asset.reservationId) await tx.storageReservation.updateMany({ where: { id: asset.reservationId, state: { not: 'processing' } }, data: { state: 'released', remainingBytes: 0n, temporaryBytes: 0n } })
      const source = await tx.fileRecord.findUniqueOrThrow({ where: { id: asset.sourceFileId } })
      if (source.quarantinedAt) throw new BadRequestException('源文件已隔离，不能重试')
      const reservation = await this.quota.reserve(asset.uploaderId, 'processing', source.size, tx)
      const updated = await tx.videoAsset.updateMany({ where: { id, status: 'failed', attempts: asset.attempts }, data: { status: 'uploaded', claimedAt: null, claimToken: null, leaseExpiresAt: null, lastError: null, reservationId: reservation.id } })
      if (!updated.count) throw new ConflictException('视频已由其他请求处理')
      if (administrative) await tx.auditLog.create({ data: { actorId: userId, action: 'resource_video_retry', targetType: 'video_asset', targetId: id } })
    })
    void this.processNext()
    return this.prisma.videoAsset.findUniqueOrThrow({ where: { id } })
  }

  async cleanupOrphans(actorId: string) {
    const retentionHours = Math.max(24, Math.min(720, Number(this.config.get('VIDEO_ORPHAN_RETENTION_HOURS') || 168)))
    const before = new Date(Date.now() - retentionHours * 60 * 60 * 1000)
    const candidates = await this.prisma.videoAsset.findMany({
      where: { contribution: null, status: { not: 'processing' }, updatedAt: { lt: before } },
      select: { id: true, sourceFileId: true, playableFileId: true, posterFileId: true },
      orderBy: [{ updatedAt: 'asc' }, { id: 'asc' }],
      take: 20,
    })
    let removedAssets = 0
    const queuedFiles: string[] = []
    for (const candidate of candidates) {
      const deleted = await this.prisma.$transaction(async (tx) => {
        await lockFileReferences(tx)
        if (await fileReferenced(tx, candidate.id)) return { count: 0 }
        return tx.videoAsset.deleteMany({ where: { id: candidate.id, contribution: null, status: { in: ['ready', 'failed'] }, updatedAt: { lt: before } } })
      }, { timeout: 20000 })
      if (!deleted.count) continue
      removedAssets++
      for (const fileId of [...new Set([candidate.sourceFileId, candidate.playableFileId, candidate.posterFileId].filter((id): id is string => !!id))]) {
        try { await this.storage.delete(fileId) }
        catch {
          await this.prisma.mediaGcJob.upsert({ where: { fileId }, create: { fileId }, update: {} })
          queuedFiles.push(fileId)
        }
      }
    }
    if (removedAssets) await this.prisma.auditLog.create({
      data: { actorId, action: 'resource_video_orphan_cleanup', targetType: 'video_asset', targetId: 'batch', details: { retentionHours, removedAssets, queuedFiles: queuedFiles.length } },
    })
    return { retentionHours, removedAssets, queuedFiles }
  }

  async processNext() {
    if (this.running || this.stopping || this.config.get('VIDEO_PROCESSING_ENABLED') === 'false') return
    this.running = this.claimNext().then(async (asset) => { if (asset) await this.process(asset.id, asset.claimToken!) }).catch((error: unknown) => { this.logger.error(`媒体队列执行失败：${error instanceof Error ? error.message : '未知错误'}`) }).finally(() => { this.running = undefined })
    await this.running
  }

  async claimNext() {
    return this.prisma.$transaction(async (tx) => {
      await lockFileReferences(tx)
      const candidate = await tx.videoAsset.findFirst({ where: { status: 'uploaded', attempts: { lt: this.maxAttempts } }, include: { sourceFile: true, reservation: true }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] })
      if (!candidate) return null
      let reservation = candidate.reservation
      if (!reservation || reservation.state !== 'queued') {
        try { reservation = await this.quota.reserve(candidate.uploaderId, 'processing', candidate.sourceFile.size, tx) }
        catch (error) {
          await tx.videoAsset.update({ where: { id: candidate.id }, data: { status: 'failed', lastError: error instanceof Error ? error.message.slice(0, 1000) : '处理容量不足' } })
          return null
        }
      }
      const claimToken = randomUUID(), leaseExpiresAt = new Date(Date.now() + PROCESSING_LEASE_MS)
      await tx.storageReservation.update({ where: { id: reservation.id }, data: { state: 'processing', claimToken, expiresAt: leaseExpiresAt } })
      return tx.videoAsset.update({ where: { id: candidate.id }, data: { status: 'processing', attempts: { increment: 1 }, claimedAt: new Date(), startedAt: new Date(), claimToken, leaseExpiresAt, reservationId: reservation.id, lastError: null } })
    }, { timeout: 15000 })
  }

  async renewClaim(id: string, claimToken: string) {
    await this.prisma.$transaction(async (tx) => {
      const now = new Date(), expiresAt = new Date(Date.now() + PROCESSING_LEASE_MS)
      const updated = await tx.videoAsset.updateMany({ where: { id, status: 'processing', claimToken, leaseExpiresAt: { gt: now } }, data: { leaseExpiresAt: expiresAt } })
      if (!updated.count) throw new ConflictException('视频处理租约失效')
      const reserved = await tx.storageReservation.updateMany({ where: { videoAsset: { id }, state: 'processing', claimToken, expiresAt: { gt: now } }, data: { expiresAt } })
      if (!reserved.count) throw new ConflictException('视频容量租约失效')
    })
  }

  private async process(id: string, claimToken: string) {
    const asset = await this.prisma.videoAsset.findUniqueOrThrow({ where: { id }, include: { sourceFile: true, reservation: true } })
    if (asset.claimToken !== claimToken || !asset.reservation) return
    this.abort = new AbortController()
    const signal = this.abort.signal
    const reservation = { id: asset.reservation.id, claimToken, signal }
    const workspace = this.quota.workspace(reservation.id, claimToken)
    let renewing = false
    const renewal = setInterval(() => {
      if (renewing) return
      renewing = true
      void this.renewClaim(id, claimToken).catch(() => this.abort?.abort()).finally(() => { renewing = false })
    }, 30_000)
    let playableFileId = '', posterFileId = ''
    try {
      await mkdir(workspace, { recursive: true, mode: 0o700 })
      const extension = path.extname(asset.originalName).toLowerCase()
      const source = path.join(workspace, `source${['.mp4', '.mov', '.webm'].includes(extension) ? extension : '.media'}`)
      const output = path.join(workspace, 'playable.mp4')
      const poster = path.join(workspace, 'poster.jpg')
      await this.storage.copyToPath(asset.sourceFileId, source, signal)
      const probeArgs = ['-v', 'error', '-max_alloc', '268435456', '-protocol_whitelist', 'file,pipe', '-show_streams', '-show_format', '-of', 'json']
      const probe = JSON.parse(await runMediaCommand(this.ffprobe, [...probeArgs, source], { timeoutMs: 30_000, signal })) as Probe
      const { video, audio, duration } = validateVideoProbe(probe)
      const compatible = extension === '.mp4' && video.codec_name === 'h264' && video.pix_fmt === 'yuv420p' && (!audio || audio.codec_name === 'aac')
      const common = ['-y', '-nostdin', '-v', 'error', '-max_alloc', '268435456', '-threads', '2', '-filter_threads', '1', '-protocol_whitelist', 'file,pipe', '-i', source, '-map', '0:v:0', '-map', '0:a:0?', '-map_metadata', '-1', '-sn', '-dn', '-fs', String(asset.reservation.playableLimit)]
      await runMediaCommand(this.ffmpeg, compatible
        ? [...common, '-c', 'copy', '-movflags', '+faststart', output]
        : [...common, '-vf', "scale=w='min(1920,iw)':h='min(1080,ih)':force_original_aspect_ratio=decrease:force_divisible_by=2", '-c:v', 'libx264', '-threads', '2', '-pix_fmt', 'yuv420p', '-preset', 'veryfast', '-crf', '22', '-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart', output], { signal })
      const outputProbe = JSON.parse(await runMediaCommand(this.ffprobe, [...probeArgs, output], { timeoutMs: 30_000, signal })) as Probe
      if (Math.abs(Number(outputProbe.format?.duration) - duration) > Math.max(1, duration * 0.01)) throw new Error('播放版本不完整，可能超出输出容量限制')
      await runMediaCommand(this.ffmpeg, ['-y', '-nostdin', '-v', 'error', '-threads', '2', '-filter_threads', '1', '-protocol_whitelist', 'file,pipe', '-ss', String(Math.min(2, Math.max(0, duration / 3))), '-i', output, '-frames:v', '1', '-vf', 'scale=960:-2', '-threads', '2', '-fs', String(POSTER_LIMIT_BYTES), '-q:v', '3', poster], { timeoutMs: 60_000, signal })
      const playableSize = (await stat(output)).size
      const posterSize = (await stat(poster)).size
      await this.renewClaim(id, claimToken)
      const playable = await this.storage.uploadPath({ path: output, originalname: 'playable.mp4', mimetype: 'video/mp4', size: playableSize }, { uploadedBy: asset.uploaderId, visibility: 'private', maxBytes: Number(asset.reservation.playableLimit), reservation })
      playableFileId = playable.id
      const posterFile = await this.storage.uploadPath({ path: poster, originalname: 'poster.jpg', mimetype: 'image/jpeg', size: posterSize }, { uploadedBy: asset.uploaderId, visibility: 'private', maxBytes: POSTER_LIMIT_BYTES, reservation })
      posterFileId = posterFile.id
      const rotation = video.side_data_list?.find((item) => typeof item.rotation === 'number')?.rotation || Number(video.tags?.rotate || 0)
      if (playable.securityScan?.quarantined || posterFile.securityScan?.quarantined) throw new Error('处理结果扫描异常，已隔离')
      await this.prisma.$transaction(async (tx) => {
      const updated = await tx.videoAsset.updateMany({
        where: { id, status: 'processing', claimToken, leaseExpiresAt: { gt: new Date() } },
        data: {
          status: 'ready',
          playableFileId,
          posterFileId,
          durationSeconds: Math.ceil(duration),
          width: video.width,
          height: video.height,
          rotation,
          videoCodec: video.codec_name || null,
          audioCodec: audio?.codec_name || null,
          claimedAt: null,
          claimToken: null,
          leaseExpiresAt: null,
          finishedAt: new Date(),
          lastError: null,
        },
      })
      if (!updated.count) throw new ConflictException('旧处理任务不能覆盖当前结果')
      await tx.storageReservation.updateMany({ where: { id: reservation.id, claimToken }, data: { state: 'released', remainingBytes: 0n, temporaryBytes: 0n } })
      })
    } catch (error) {
      for (const fileId of [playableFileId, posterFileId].filter(Boolean)) await this.prisma.mediaGcJob.upsert({ where: { fileId }, create: { fileId }, update: {} })
      await this.prisma.videoAsset.updateMany({
        where: { id, status: 'processing', claimToken },
        data: { status: this.stopping && asset.attempts < this.maxAttempts ? 'uploaded' : 'failed', claimToken: null, leaseExpiresAt: null, claimedAt: null, finishedAt: new Date(), lastError: (error instanceof Error ? error.message : '未知媒体处理错误').slice(0, 1000) },
      })
      await this.quota.release(reservation)
    } finally {
      clearInterval(renewal)
      this.abort = undefined
      await rm(workspace, { recursive: true, force: true })
    }
  }
}
