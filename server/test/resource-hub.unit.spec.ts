import { EventEmitter } from 'node:events'
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { copyFile, mkdtemp, open, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import * as path from 'node:path'
import { Readable } from 'node:stream'
import { demoResourceHubContributions } from '@ai-learning-hub/demo-fixtures'
import { ConfigService } from '@nestjs/config'
import { plainToInstance } from 'class-transformer'
import { validate } from 'class-validator'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ResourceHubMediaController } from '../src/modules/resources/resource-hub.controller'
import { CollectionReorderDto, ResourceHubQueryDto, WatchProgressDto } from '../src/modules/resources/resource-hub.dto'
import { parseSingleRange, ResourceHubService } from '../src/modules/resources/resource-hub.service'
import { VideoProcessingService, runMediaCommand } from '../src/modules/resources/video-processing.service'
import { LocalStorageAdapter } from '../src/modules/storage/local-storage.service'
import { CommunityPostService } from '../src/modules/community/post.service'

type ProcessedProbe = {
  streams?: Array<{
    codec_type?: string
    codec_name?: string
    pix_fmt?: string
    width?: number
    height?: number
  }>
}

const roots: string[] = []
const mediaToolsAvailable = spawnSync(process.env.FFMPEG_PATH || 'ffmpeg', ['-version'], { stdio: 'ignore' }).status === 0 &&
  spawnSync(process.env.FFPROBE_PATH || 'ffprobe', ['-version'], { stdio: 'ignore' }).status === 0
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
  vi.restoreAllMocks()
})

const hub = (prisma: object = {}, visibility: object = {}) => new ResourceHubService(
  prisma as never,
  new ConfigService({ JWT_SECRET: 'resource-test-secret-with-enough-entropy' }),
  {} as never,
  visibility as never,
  {} as never,
  {} as never,
  {} as never,
  {} as never,
)

describe('资源播放交付', () => {
  it('正确解析完整、开放、后缀和越界单范围并拒绝多范围', () => {
    expect(parseSingleRange(undefined, 1000)).toBeNull()
    expect(parseSingleRange('bytes=100-199', 1000)).toEqual({ start: 100, end: 199 })
    expect(parseSingleRange('bytes=900-', 1000)).toEqual({ start: 900, end: 999 })
    expect(parseSingleRange('bytes=-100', 1000)).toEqual({ start: 900, end: 999 })
    expect(() => parseSingleRange('bytes=1000-', 1000)).toThrow(RangeError)
    expect(() => parseSingleRange('bytes=0-1,4-5', 1000)).toThrow('单范围')
  })

  it.each([
    ['GET', 'bytes=10-19', 206, 2],
    ['HEAD', undefined, 200, 1],
    ['GET', 'bytes=100-120', 416, 1],
  ] as const)('%s %s 返回正确状态并按范围重新打开流', async (method, range, status, calls) => {
    const streams: Readable[] = []
    const playbackFile = vi.fn(async (_id: string, _token: string, start?: number, end?: number) => {
      const stream = Readable.from(Buffer.from('01234567890123456789').subarray(start || 0, end === undefined ? undefined : end + 1))
      streams.push(stream)
      return { stream, size: 20, mimeType: 'video/mp4', originalName: 'demo.mp4' }
    })
    const controller = new ResourceHubMediaController({ playbackFile } as never)
    const response = Object.assign(new EventEmitter(), {
      req: { method },
      status: vi.fn().mockReturnThis(),
      set: vi.fn().mockReturnThis(),
    })
    await controller.play('asset-1', 'token', range, response as never)
    expect(response.status).toHaveBeenCalledWith(status)
    expect(playbackFile).toHaveBeenCalledTimes(calls)
    if (status === 206) {
      expect(playbackFile.mock.calls[1].slice(2)).toEqual([10, 19])
      expect(response.set).toHaveBeenCalledWith(expect.objectContaining({ 'Content-Range': 'bytes 10-19/20', 'Content-Length': '10', 'Accept-Ranges': 'bytes' }))
    }
    if (status === 416) expect(response.set).toHaveBeenCalledWith(expect.objectContaining({ 'Content-Range': 'bytes */20' }))
    if (method === 'GET' && status !== 416) {
      expect(streams.at(-1)?.destroyed).toBe(false)
      response.emit('close')
    }
    expect(streams.at(-1)?.destroyed).toBe(true)
  })

  it('播放凭据限制用途、目标和有效期', () => {
    const service = hub() as unknown as {
      sign: (purpose: string, targetId: string, userId: string, expires: number) => string
      verify: (purpose: string, targetId: string, token: string) => string
    }
    const token = service.sign('play', 'video-a', 'student-a', Math.floor(Date.now() / 1000) + 60)
    expect(service.verify('play', 'video-a', token)).toBe('student-a')
    expect(() => service.verify('attachment', 'video-a', token)).toThrow()
    expect(() => service.verify('play', 'video-b', token)).toThrow()
    const expired = service.sign('play', 'video-a', 'student-a', Math.floor(Date.now() / 1000) - 1)
    expect(() => service.verify('play', 'video-a', expired)).toThrow()
  })

  it('媒体命令使用参数数组，不把参数当作 Shell 指令执行', async () => {
    expect(await runMediaCommand(process.execPath, ['-e', 'process.stdout.write(process.argv[1])', 'value;echo unsafe'])).toBe('value;echo unsafe')
  })
})

describe('资源持久化边界', () => {
  it.runIf(mediaToolsAvailable)('真实处理兼容 MP4、竖屏 WebM 和带方向元数据的 MOV', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'resource-video-processing-'))
    roots.push(root)
    const ffmpeg = process.env.FFMPEG_PATH || 'ffmpeg'
    const ffprobe = process.env.FFPROBE_PATH || 'ffprobe'
    const compatible = path.join(root, 'compatible.mp4')
    const portrait = path.join(root, 'portrait.webm')
    const rotationBase = path.join(root, 'rotation-base.mov')
    const rotated = path.join(root, 'rotated.mov')
    await runMediaCommand(ffmpeg, ['-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=size=160x90:rate=15:duration=1', '-f', 'lavfi', '-i', 'sine=frequency=800:duration=1', '-shortest', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', compatible])
    await runMediaCommand(ffmpeg, ['-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=size=90x160:rate=15:duration=1', '-f', 'lavfi', '-i', 'sine=frequency=900:duration=1', '-shortest', '-c:v', 'libvpx-vp9', '-b:v', '200k', '-c:a', 'libopus', portrait])
    await runMediaCommand(ffmpeg, ['-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=size=160x90:rate=15:duration=1', '-c:v', 'mpeg4', rotationBase])
    await runMediaCommand(ffmpeg, ['-loglevel', 'error', '-y', '-display_rotation', '90', '-i', rotationBase, '-c', 'copy', rotated])

    for (const [index, source] of [compatible, portrait, rotated].entries()) {
      const asset = {
        id: `video-${index}`,
        uploaderId: 'student-a',
        sourceFileId: `source-${index}`,
        originalName: path.basename(source),
        originalMimeType: index === 0 ? 'video/mp4' : index === 1 ? 'video/webm' : 'video/quicktime',
        status: 'uploaded',
        attempts: 0,
        createdAt: new Date(index),
      }
      const stored = new Map<string, string>([[asset.sourceFileId, source]])
      const storage = {
        copyToPath: vi.fn(async (id: string, target: string) => copyFile(stored.get(id)!, target)),
        uploadPath: vi.fn(async (file: { path: string; originalname: string; mimetype: string; size: number }) => {
          const id = `${file.mimetype.startsWith('video/') ? 'playable' : 'poster'}-${index}`
          const target = path.join(root, `${id}${path.extname(file.originalname)}`)
          await copyFile(file.path, target)
          stored.set(id, target)
          return { id, originalName: file.originalname, mimeType: file.mimetype, size: file.size, checksum: id }
        }),
        delete: vi.fn(),
      }
      const prisma = {
        videoAsset: {
          findFirst: vi.fn(async () => asset.status === 'uploaded' ? asset : null),
          updateMany: vi.fn(async ({ data }: { data: { status: string; attempts: { increment: number } } }) => {
            Object.assign(asset, { ...data, attempts: asset.attempts + data.attempts.increment })
            return { count: 1 }
          }),
          findUniqueOrThrow: vi.fn(async () => ({ ...asset, sourceFile: { id: asset.sourceFileId } })),
          update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => Object.assign(asset, data)),
        },
      }
      const processor = new VideoProcessingService(prisma as never, new ConfigService({ NODE_ENV: 'test', FFMPEG_PATH: ffmpeg, FFPROBE_PATH: ffprobe }), storage as never)
      await processor.processNext()
      expect(asset.status).toBe('ready')
      expect(stored.has(`playable-${index}`)).toBe(true)
      expect(stored.has(`poster-${index}`)).toBe(true)
      const probe = JSON.parse(await runMediaCommand(ffprobe, ['-v', 'error', '-show_streams', '-of', 'json', stored.get(`playable-${index}`)!])) as ProcessedProbe
      const video = probe.streams?.find((stream) => stream.codec_type === 'video')
      const audio = probe.streams?.find((stream) => stream.codec_type === 'audio')
      expect(video).toMatchObject({ codec_name: 'h264', pix_fmt: 'yuv420p' })
      if (index < 2) expect(audio?.codec_name).toBe('aac')
      if (index === 1 || index === 2) expect(video!.height).toBeGreaterThan(video!.width!)
    }
  }, 30_000)

  it('视频处理状态只按上传者读取，并返回真实失败原因', async () => {
    const now = new Date('2026-09-06T00:00:00.000Z')
    const asset = { id: 'video-a', uploaderId: 'student-a', status: 'failed', originalName: 'demo.webm', originalMimeType: 'video/webm', durationSeconds: null, width: null, height: null, rotation: 0, attempts: 2, lastError: 'FFmpeg unavailable', posterFileId: null, createdAt: now, updatedAt: now }
    const prisma = { videoAsset: { findFirst: vi.fn(async () => asset) } }
    const visibility = { viewer: vi.fn() }
    expect(await hub(prisma, visibility).video('student-a', 'video-a')).toMatchObject({ id: 'video-a', status: 'failed', attempts: 2, lastError: 'FFmpeg unavailable' })
    expect(prisma.videoAsset.findFirst).toHaveBeenCalledWith({ where: { id: 'video-a', uploaderId: 'student-a' } })
    expect(visibility.viewer).toHaveBeenCalledWith('student-a')
  })

  it('首页 Banner 配置拒绝非公开、作者失效或视频未就绪的作品', async () => {
    const prisma = {
      resourceContribution: { count: vi.fn(async () => 0) },
      resourceCategory: { count: vi.fn(async () => 1) },
    }
    await expect(hub(prisma).updateConfig({ revision: 0, bannerPostIds: ['post-a'], sectionCategoryCodes: ['ai-foundation'] })).rejects.toThrow('必须公开、已发布、作者有效且视频已处理完成')
    expect(prisma.resourceContribution.count).toHaveBeenCalledWith({ where: {
      postId: { in: ['post-a'] },
      post: { status: 'published', visibility: 'public', deletedAt: null, author: { status: 'active' } },
      OR: [{ kind: { not: 'video' } }, { videoAsset: { is: { status: 'ready' } } }],
    } })
  })

  it('作者下架已发布资源时保留草稿并同步计数、置顶和审计状态', async () => {
    const stored = { id: 'post-a', authorId: 'student-a', status: 'published', deletedAt: null, publishedAt: new Date(), revision: 3, title: '资源作品', contentBlocks: [], visibility: 'public', bindings: [], topics: [{ topicId: 'topic-a' }] }
    const tx = {
      $queryRaw: vi.fn(),
      communityPost: {
        findUniqueOrThrow: vi.fn(async () => stored),
        updateMany: vi.fn(async ({ data }: { data: { status: 'draft'; publishedAt: null } }) => {
          Object.assign(stored, data, { revision: stored.revision + 1 })
          return { count: 1 }
        }),
        count: vi.fn(async () => 0),
      },
      communityPostRevision: { createMany: vi.fn() },
      communityProfile: { updateMany: vi.fn() },
      communityPostTopic: { findMany: vi.fn(async () => [{ topicId: 'topic-a' }]), count: vi.fn(async () => 0) },
      communityTopic: { update: vi.fn() },
      activityEvent: { create: vi.fn() },
    }
    const prisma = {
      communityPost: { findUnique: vi.fn(async () => stored) },
      $transaction: vi.fn(async (operation: (client: typeof tx) => Promise<unknown>) => operation(tx)),
    }
    const visibility = { viewer: vi.fn() }
    const service = new CommunityPostService(prisma as never, {} as never, visibility as never, {} as never)
    expect(await service.unpublish('student-a', 'post-a')).toEqual({ unpublished: true })
    expect(tx.communityPost.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'post-a', authorId: 'student-a', status: 'published', deletedAt: null }, data: expect.objectContaining({ status: 'draft', publishedAt: null }) }))
    expect(tx.communityProfile.updateMany).toHaveBeenCalledWith({ where: { pinnedPostId: 'post-a' }, data: { pinnedPostId: null, revision: { increment: 1 } } })
    expect(tx.activityEvent.create).toHaveBeenCalledWith({ data: expect.objectContaining({ eventType: 'post_unpublished', targetId: 'post-a' }) })
  })

  it('固定演示数据引用的封面、视频和附件全部存在', () => {
    for (const item of demoResourceHubContributions) {
      for (const url of [item.coverUrl, item.bannerUrl, item.videoUrl, item.attachmentUrl].filter(Boolean) as string[]) {
        expect(existsSync(path.resolve(__dirname, `../../frontend/public${url}`)), url).toBe(true)
      }
    }
  })

  it('观看秒数只增不减、完成阈值真实，且有效观看事件按窗口幂等写入', async () => {
    let current: { positionSeconds: number; watchedSeconds: number; completedAt: Date | null } | null = null
    const createMany = vi.fn()
    const tx = {
      $queryRaw: vi.fn(),
      resourceWatchProgress: {
        findUnique: vi.fn(async () => current),
        upsert: vi.fn(async ({ create, update }: { create: typeof current; update: Partial<NonNullable<typeof current>> }) => {
          current = current ? { ...current, ...update } : create
          return current
        }),
      },
      activityEvent: { createMany },
    }
    const prisma = { $transaction: vi.fn(async (operation: (client: typeof tx) => Promise<unknown>) => operation(tx)) }
    const service = hub(prisma)
    Object.defineProperty(service, 'visibleAsset', { value: vi.fn(async () => ({ durationSeconds: 100, contribution: { postId: 'post-a' } })) })
    expect(await service.progress('student-a', 'video-a', { positionSeconds: 40, watchedSeconds: 35, completed: false, eventKey: 'watch-event-1' })).toEqual({ positionSeconds: 40, watchedSeconds: 35, completed: false })
    expect(await service.progress('student-a', 'video-a', { positionSeconds: 95, watchedSeconds: 12, completed: true, eventKey: 'watch-event-2' })).toEqual({ positionSeconds: 95, watchedSeconds: 35, completed: true })
    expect(createMany).toHaveBeenCalledTimes(2)
    expect(createMany.mock.calls[0][0]).toMatchObject({ skipDuplicates: true, data: [{ eventKey: expect.stringMatching(/^resource-watch:student-a:video-a:/) }] })
  })

  it('路径上传通过本地流式适配器落盘并支持局部读取', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'resource-storage-'))
    roots.push(root)
    const source = path.join(root, 'source.txt')
    const bytes = Buffer.from('0123456789'.repeat(200_000))
    await writeFile(source, bytes)
    let record: Record<string, unknown> | null = null
    const prisma = {
      fileRecord: {
        create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => (record = { id: 'file-a', ...data })),
        findUnique: vi.fn(async () => record),
      },
    }
    const storage = new LocalStorageAdapter(prisma as never, new ConfigService({ STORAGE_LOCAL_PATH: path.join(root, 'objects') }))
    const saved = await storage.uploadPath({ path: source, originalname: 'source.txt', mimetype: 'text/plain', size: bytes.length }, { uploadedBy: 'student-a', visibility: 'private', maxBytes: bytes.length })
    const opened = await storage.open(saved.id, 10, 19)
    const chunks: Buffer[] = []
    for await (const chunk of opened.stream) chunks.push(Buffer.from(chunk))
    expect(Buffer.concat(chunks).toString()).toBe('0123456789')
    expect(saved.checksum).toMatch(/^[a-f0-9]{64}$/)
  })

  it('50MB 路径上传不把文件整体读入进程内存', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'resource-storage-large-'))
    roots.push(root)
    const source = path.join(root, 'large-video.mp4')
    const size = 50 * 1024 * 1024
    const sourceHandle = await open(source, 'w')
    await sourceHandle.truncate(size)
    await sourceHandle.write(Buffer.from([0, 0, 0, 24, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d]), 0, 12, 0)
    await sourceHandle.close()
    const prisma = {
      fileRecord: {
        create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({ id: 'file-large', ...data })),
        findUnique: vi.fn(),
      },
    }
    const storage = new LocalStorageAdapter(prisma as never, new ConfigService({ STORAGE_LOCAL_PATH: path.join(root, 'objects') }))
    const baseline = process.memoryUsage()
    let peakRss = baseline.rss, peakHeap = baseline.heapUsed
    const sample = setInterval(() => {
      const usage = process.memoryUsage()
      peakRss = Math.max(peakRss, usage.rss)
      peakHeap = Math.max(peakHeap, usage.heapUsed)
    }, 1)
    try {
      const saved = await storage.uploadPath({ path: source, originalname: 'large-video.mp4', mimetype: 'video/mp4', size }, { uploadedBy: 'student-a', visibility: 'private', maxBytes: size })
      expect(saved.size).toBe(size)
    } finally { clearInterval(sample) }
    expect(peakRss - baseline.rss).toBeLessThan(32 * 1024 * 1024)
    expect(peakHeap - baseline.heapUsed).toBeLessThan(16 * 1024 * 1024)
  })

  it('并发路径上传生成不同对象键且两份文件均完整落盘', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'resource-storage-concurrent-'))
    roots.push(root)
    const paths = [path.join(root, 'first.mp4'), path.join(root, 'second.mp4')]
    for (const [index, source] of paths.entries()) {
      const handle = await open(source, 'w')
      await handle.truncate(1024 * 1024)
      await handle.write(Buffer.from([0, 0, 0, 24, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d, index]), 0, 13, 0)
      await handle.close()
    }
    const records: Array<Record<string, unknown>> = []
    const prisma = { fileRecord: { create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
      records.push(data)
      return { id: `file-${records.length}`, ...data }
    }) } }
    const storageRoot = path.join(root, 'objects')
    const storage = new LocalStorageAdapter(prisma as never, new ConfigService({ STORAGE_LOCAL_PATH: storageRoot }))
    await Promise.all(paths.map((source, index) => storage.uploadPath(
      { path: source, originalname: `video-${index}.mp4`, mimetype: 'video/mp4', size: 1024 * 1024 },
      { uploadedBy: 'student-a', visibility: 'private', maxBytes: 1024 * 1024 },
    )))
    expect(new Set(records.map((record) => record.objectKey)).size).toBe(2)
    expect(records.every((record) => existsSync(path.join(storageRoot, String(record.objectKey))))).toBe(true)
  })

  it('资料路径上传在既有存储边界拒绝未允许类型和伪造 PDF 文件头', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'resource-document-'))
    roots.push(root)
    const fakePdf = path.join(root, 'fake.pdf')
    await writeFile(fakePdf, Buffer.from('MZ executable'))
    const prisma = { fileRecord: { create: vi.fn() } }
    const storage = new LocalStorageAdapter(prisma as never, new ConfigService({ STORAGE_LOCAL_PATH: path.join(root, 'objects') }))
    await expect(storage.uploadPath({ path: fakePdf, originalname: 'malware.exe', mimetype: 'application/octet-stream', size: 13 }, { uploadedBy: 'student-a', visibility: 'private' })).rejects.toThrow('扩展名或 MIME')
    await expect(storage.uploadPath({ path: fakePdf, originalname: 'notes.pdf', mimetype: 'application/pdf', size: 13 }, { uploadedBy: 'student-a', visibility: 'private' })).rejects.toThrow('内容与文件类型不匹配')
    expect(prisma.fileRecord.create).not.toHaveBeenCalled()
  })

  it('孤立视频仅清理过期且非处理中的资产，删除失败进入既有 GC 队列', async () => {
    const candidates = [{ id: 'old-a', sourceFileId: 'source-a', playableFileId: 'play-a', posterFileId: 'poster-a' }]
    const prisma = {
      videoAsset: { findMany: vi.fn(async () => candidates), deleteMany: vi.fn(async () => ({ count: 1 })) },
      mediaGcJob: { upsert: vi.fn() },
      auditLog: { create: vi.fn() },
    }
    const storage = { delete: vi.fn(async (id: string) => { if (id === 'poster-a') throw new Error('disk unavailable') }) }
    const service = new VideoProcessingService(prisma as never, new ConfigService({ VIDEO_ORPHAN_RETENTION_HOURS: 168, NODE_ENV: 'test' }), storage as never)
    expect(await service.cleanupOrphans('admin-a')).toEqual({ retentionHours: 168, removedAssets: 1, queuedFiles: ['poster-a'] })
    expect(prisma.videoAsset.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { contribution: null, status: { not: 'processing' }, updatedAt: { lt: expect.any(Date) } }, take: 20 }))
    expect(prisma.mediaGcJob.upsert).toHaveBeenCalledWith({ where: { fileId: 'poster-a' }, create: { fileId: 'poster-a' }, update: {} })
  })

  it('DTO 拒绝超量分页、重复排序项和不完整观看事件', async () => {
    const query = plainToInstance(ResourceHubQueryDto, { limit: 49, kind: 'audio' })
    const order = plainToInstance(CollectionReorderDto, { expectedRevision: 0, itemIds: ['same', 'same'] })
    const progress = plainToInstance(WatchProgressDto, { positionSeconds: 1, watchedSeconds: 1, completed: false, eventKey: 'short' })
    expect(await validate(query)).toHaveLength(2)
    expect((await validate(order)).length).toBeGreaterThanOrEqual(2)
    expect(await validate(progress)).toHaveLength(1)
  })
})
