import { BadRequestException, ForbiddenException, Inject, Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { spawn } from 'node:child_process'
import { mkdtemp, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import * as path from 'node:path'
import { PrismaService } from '../../prisma/prisma.service'
import { STORAGE_SERVICE, type StorageService } from '../storage/storage.types'

type Probe = {
  format?: { duration?: string }
  streams?: Array<{ codec_type?: string; codec_name?: string; pix_fmt?: string; width?: number; height?: number; tags?: { rotate?: string }; side_data_list?: Array<{ rotation?: number }> }>
}

export function runMediaCommand(command: string, args: string[]) {
  return new Promise<string>((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = '', stderr = ''
    child.stdout.on('data', (chunk) => { stdout += String(chunk) })
    child.stderr.on('data', (chunk) => { stderr = `${stderr}${String(chunk)}`.slice(-8000) })
    child.once('error', (error) => reject(new Error(`${command} 无法启动：${error.message}`)))
    child.once('close', (code) => code === 0 ? resolve(stdout) : reject(new Error(`${command} 处理失败（${code ?? 'signal'}）：${stderr.trim() || '没有错误输出'}`)))
  })
}

@Injectable()
export class VideoProcessingService implements OnModuleInit, OnModuleDestroy {
  private timer?: NodeJS.Timeout
  private running = false
  private readonly maxAttempts: number
  private readonly ffmpeg: string
  private readonly ffprobe: string

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    @Inject(STORAGE_SERVICE) private readonly storage: StorageService,
  ) {
    this.maxAttempts = Math.max(1, Math.min(5, Number(config.get('VIDEO_PROCESSING_MAX_ATTEMPTS') || 3)))
    this.ffmpeg = config.get('FFMPEG_PATH') || 'ffmpeg'
    this.ffprobe = config.get('FFPROBE_PATH') || 'ffprobe'
  }

  async onModuleInit() {
    if (this.config.get('NODE_ENV') === 'test' || this.config.get('VIDEO_PROCESSING_ENABLED') === 'false') return
    await this.prisma.videoAsset.updateMany({
      where: { status: 'processing', claimedAt: { lt: new Date(Date.now() - 15 * 60_000) } },
      data: { status: 'uploaded', claimedAt: null, lastError: '服务重启后重新进入处理队列' },
    })
    this.timer = setInterval(() => { void this.processNext() }, 5000)
    void this.processNext()
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer)
  }

  async retry(userId: string, id: string, administrative = false) {
    const asset = await this.prisma.videoAsset.findUnique({ where: { id } })
    if (!asset) throw new BadRequestException('视频不存在')
    if (!administrative && asset.uploaderId !== userId) throw new ForbiddenException('只能重试自己上传的视频')
    if (asset.status !== 'failed') throw new BadRequestException('只有处理失败的视频可以重试')
    if (asset.attempts >= this.maxAttempts) throw new BadRequestException(`视频处理最多重试 ${this.maxAttempts} 次`)
    await this.prisma.videoAsset.update({ where: { id }, data: { status: 'uploaded', claimedAt: null, lastError: null } })
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
      const deleted = await this.prisma.videoAsset.deleteMany({ where: { id: candidate.id, contribution: null, status: { not: 'processing' }, updatedAt: { lt: before } } })
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
    if (this.running) return
    this.running = true
    try {
      const candidate = await this.prisma.videoAsset.findFirst({ where: { status: 'uploaded', attempts: { lt: this.maxAttempts } }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] })
      if (!candidate) return
      const claimed = await this.prisma.videoAsset.updateMany({
        where: { id: candidate.id, status: 'uploaded', attempts: candidate.attempts },
        data: { status: 'processing', attempts: { increment: 1 }, claimedAt: new Date(), startedAt: new Date(), lastError: null },
      })
      if (!claimed.count) return
      await this.process(candidate.id)
    } finally {
      this.running = false
    }
  }

  private async process(id: string) {
    const asset = await this.prisma.videoAsset.findUniqueOrThrow({ where: { id }, include: { sourceFile: true } })
    const workspace = await mkdtemp(path.join(tmpdir(), 'aihub-video-'))
    let playableFileId = '', posterFileId = ''
    try {
      const extension = path.extname(asset.originalName).toLowerCase()
      const source = path.join(workspace, `source${['.mp4', '.mov', '.webm'].includes(extension) ? extension : '.media'}`)
      const output = path.join(workspace, 'playable.mp4')
      const poster = path.join(workspace, 'poster.jpg')
      await this.storage.copyToPath(asset.sourceFileId, source)
      const probe = JSON.parse(await runMediaCommand(this.ffprobe, ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', source])) as Probe
      const video = probe.streams?.find((stream) => stream.codec_type === 'video')
      const audio = probe.streams?.find((stream) => stream.codec_type === 'audio')
      const duration = Math.max(0, Math.round(Number(probe.format?.duration || 0)))
      if (!video || !duration || !video.width || !video.height) throw new Error('ffprobe 未识别到有效视频轨和时长')
      const compatible = extension === '.mp4' && video.codec_name === 'h264' && video.pix_fmt === 'yuv420p' && (!audio || audio.codec_name === 'aac')
      const common = ['-y', '-i', source, '-map', '0:v:0', '-map', '0:a?']
      await runMediaCommand(this.ffmpeg, compatible
        ? [...common, '-c', 'copy', '-movflags', '+faststart', output]
        : [...common, '-vf', "scale=w='min(1920,iw)':h='min(1080,ih)':force_original_aspect_ratio=decrease:force_divisible_by=2", '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-preset', 'veryfast', '-crf', '22', '-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart', output])
      await runMediaCommand(this.ffmpeg, ['-y', '-ss', String(Math.min(2, Math.max(0, duration / 3))), '-i', output, '-frames:v', '1', '-vf', 'scale=960:-2', '-q:v', '3', poster])
      const playableSize = (await stat(output)).size
      const posterSize = (await stat(poster)).size
      const playable = await this.storage.uploadPath({ path: output, originalname: 'playable.mp4', mimetype: 'video/mp4', size: playableSize }, { uploadedBy: asset.uploaderId, visibility: 'private', maxBytes: 1024 * 1024 * 1024 })
      playableFileId = playable.id
      const posterFile = await this.storage.uploadPath({ path: poster, originalname: 'poster.jpg', mimetype: 'image/jpeg', size: posterSize }, { uploadedBy: asset.uploaderId, visibility: 'private', maxBytes: 10 * 1024 * 1024 })
      posterFileId = posterFile.id
      const rotation = video.side_data_list?.find((item) => typeof item.rotation === 'number')?.rotation || Number(video.tags?.rotate || 0)
      await this.prisma.videoAsset.update({
        where: { id },
        data: {
          status: 'ready',
          playableFileId,
          posterFileId,
          durationSeconds: duration,
          width: video.width,
          height: video.height,
          rotation,
          videoCodec: video.codec_name || null,
          audioCodec: audio?.codec_name || null,
          claimedAt: null,
          finishedAt: new Date(),
          lastError: null,
        },
      })
    } catch (error) {
      if (playableFileId) await this.storage.delete(playableFileId).catch(() => undefined)
      if (posterFileId) await this.storage.delete(posterFileId).catch(() => undefined)
      await this.prisma.videoAsset.update({
        where: { id },
        data: { status: 'failed', claimedAt: null, finishedAt: new Date(), lastError: (error instanceof Error ? error.message : '未知媒体处理错误').slice(0, 1000) },
      })
    } finally {
      await rm(workspace, { recursive: true, force: true })
    }
  }
}
