import 'reflect-metadata'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { randomBytes, randomUUID } from 'node:crypto'
import { createRequire } from 'node:module'
import { mkdir, readFile, readdir, rm, stat, statfs, writeFile } from 'node:fs/promises'
import { request as httpRequest } from 'node:http'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { NestFactory, Reflector } from '@nestjs/core'
import type { INestApplication } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { PrismaClient } from '@prisma/client'
import { hash } from 'bcryptjs'
import cookieParser from 'cookie-parser'
import sharp from 'sharp'

const database = new URL(process.env.DATABASE_URL || 'file:///missing')
if (database.hostname !== '127.0.0.1' || database.port !== '55440' || database.pathname !== '/media_runtime') throw new Error('只允许飞牛专属隔离媒体验收库')
const runtime = createRequire(`${process.cwd()}/test/media-runtime.e2e.spec.ts`)
const { AppModule } = runtime('../dist/app.module.js')
const { PrismaService } = runtime('../dist/prisma/prisma.service.js')
const { StorageQuotaService } = runtime('../dist/modules/storage/storage-quota.service.js')
const { VideoProcessingService } = runtime('../dist/modules/resources/video-processing.service.js')
const { STORAGE_SERVICE } = runtime('../dist/modules/storage/storage.types.js')
const { FileAccessService } = runtime('../dist/modules/storage/file-access.service.js')
const { ResourceHubService } = runtime('../dist/modules/resources/resource-hub.service.js')
const { LocalStorageAdapter } = runtime('../dist/modules/storage/local-storage.service.js')
const { runMediaCommand } = runtime('../dist/common/media-process.js')
const { ApiExceptionFilter } = runtime('../dist/common/api-exception.filter.js')
const { ApiResponseInterceptor } = runtime('../dist/common/api-response.interceptor.js')
const { appValidationPipe } = runtime('../dist/common/validation.pipe.js')
const { bootstrapDatabase } = runtime('../dist/modules/persistence/bootstrap.js')
const db = new PrismaClient(), password = `Synthetic-${randomBytes(16).toString('hex')}`
const uploads = process.env.STORAGE_LOCAL_PATH || '/tmp/media-runtime-uploads'
let app: INestApplication, base: string, token: string, owner: string, viewer: string, admin: string
let quota: any, processor: any, storage: any, access: any, hub: any
const config = (extra: Record<string, string> = {}) => new ConfigService({ ...process.env, NODE_ENV: 'test', STORAGE_DRIVER: 'local', STORAGE_LOCAL_PATH: uploads, STORAGE_MIN_FREE_BYTES: '1048576', ...extra })
async function account(roleCode = 'student') {
  const id = randomUUID(), role = await db.role.findUniqueOrThrow({ where: { code: roleCode } })
  return db.user.create({ data: { username: `media_${id.replaceAll('-', '')}`, email: `${id}@example.invalid`, displayName: '合成媒体验收', passwordHash: await hash(password, 4), userRoles: { create: { roleId: role.id } }, communityProfile: { create: {} }, identityVerification: { create: { realNameEncrypted: 'synthetic', idNumberEncrypted: 'synthetic', idNumberFingerprint: id, idNumberLast4: '0000', className: '合成班', studentNo: id, status: 'approved' } } } })
}
async function api(path: string, method = 'GET', body?: unknown, credential = token) {
  const response = await fetch(`${base}${path}`, { method, headers: { ...(credential ? { authorization: `Bearer ${credential}` } : {}), ...(body instanceof FormData || body === undefined ? {} : { 'content-type': 'application/json' }) }, body: body === undefined ? undefined : body instanceof FormData ? body : JSON.stringify(body) })
  return { status: response.status, body: await response.json() }
}
async function upload(name = 'notes.txt', content = Buffer.from('合成安全资料')) {
  const form = new FormData(); form.set('file', new Blob([content], { type: 'text/plain' }), name)
  const result = await api('/resource-hub/uploads/document', 'POST', form)
  expect(result.status).toBe(201)
  return result.body.data
}
async function videoAsset() {
  const source = join(uploads, `synthetic-${randomUUID()}.mp4`)
  await runMediaCommand('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=size=160x90:rate=15:duration=1', '-c:v', 'libx264', '-threads', '1', '-pix_fmt', 'yuv420p', source], { timeoutMs: 10000 })
  const stored = await storage.uploadPath({ path: source, originalname: 'sample.mp4', mimetype: 'video/mp4', size: (await stat(source)).size }, { uploadedBy: owner, visibility: 'private' })
  await rm(source)
  return db.videoAsset.create({ data: { uploaderId: owner, sourceFileId: stored.id, originalName: 'sample.mp4', originalMimeType: 'video/mp4' } })
}
beforeAll(async () => {
  if (await db.user.count()) throw new Error('媒体验收须使用专属空库，禁止重播已有账号')
  Object.assign(process.env, { NODE_ENV: 'test', JWT_SECRET: randomBytes(32).toString('hex'), SEED_ADMIN_EMAIL: 'media-bootstrap@example.invalid', SEED_ADMIN_PASSWORD: password, STORAGE_LOCAL_PATH: uploads, STORAGE_MIN_FREE_BYTES: '1048576', VIDEO_UPLOAD_MAX_MB: '8', RESOURCE_ATTACHMENT_MAX_MB: '2', IDENTITY_DATA_KEY: randomBytes(32).toString('hex') })
  await mkdir(uploads, { recursive: true }); await bootstrapDatabase(db)
  const actor = await account(); owner = actor.id; viewer = (await account()).id; admin = (await account('super_admin')).id
  app = await NestFactory.create(AppModule, { logger: false }); app.setGlobalPrefix('api/v1'); app.use(cookieParser()); app.useGlobalPipes(appValidationPipe); app.useGlobalFilters(new ApiExceptionFilter()); app.useGlobalInterceptors(new ApiResponseInterceptor(app.get(Reflector)))
  await app.listen(0, '127.0.0.1'); base = `${await app.getUrl()}/api/v1`
  quota = app.get(StorageQuotaService); processor = app.get(VideoProcessingService); storage = app.get(STORAGE_SERVICE); access = app.get(FileAccessService); hub = app.get(ResourceHubService)
  const login = await api('/auth/login', 'POST', { identifier: actor.username, password }, ''); token = login.body.data.accessToken
}, 60000)
afterAll(async () => { await app?.close(); await db.$disconnect() })

describe('媒体长期运行真实HTTP / PostgreSQL', () => {
  it('并发上传不能绕过个人容量，失败不产生预留；结算计入真实文件', async () => {
    const actor = await account(), limited = new StorageQuotaService(app.get(PrismaService), config({ STORAGE_USER_QUOTA_BYTES: '1048576', STORAGE_PARALLEL_UPLOADS_PER_USER: '8' }))
    const results = await Promise.allSettled(Array.from({ length: 8 }, () => limited.reserve(actor.id, 'document', 300000)))
    expect(results.filter((row) => row.status === 'fulfilled')).toHaveLength(1)
    expect(await db.storageReservation.count({ where: { userId: actor.id, state: 'uploading' } })).toBe(1)
    for (const row of results) if (row.status === 'fulfilled') await limited.release(row.value)
    const file = await upload()
    expect(file.securityScan).toMatchObject({ status: 'unavailable', quarantined: false })
    const usage = (await api('/resource-hub/capacity')).body.data
    expect(usage.usedBytes).toBeGreaterThanOrEqual(file.size); expect(usage.activeUploads).toBe(0); expect(usage.reservedBytes).toBe(0)
  })

  it('空间不足和未配置对象存储容量时拒绝新预留', async () => {
    const limited = new StorageQuotaService(app.get(PrismaService), config({ STORAGE_MIN_FREE_BYTES: String(Number.MAX_SAFE_INTEGER) }))
    await expect(limited.reserve(owner, 'document', 100)).rejects.toThrow('空间不足')
    const assigned = new StorageQuotaService(app.get(PrismaService), config({ STORAGE_CAPACITY_BYTES: '1048576' }))
    await expect(assigned.reserve(owner, 'document', 600000)).rejects.toThrow('空间不足')
    const disk = await statfs('/media-small')
    expect(disk.bsize * disk.blocks).toBeLessThanOrEqual(4 * 1024 * 1024)
    const small = new StorageQuotaService(app.get(PrismaService), config({ STORAGE_LOCAL_PATH: '/media-small' }))
    await expect(small.reserve(owner, 'document', 2 * 1024 * 1024)).rejects.toThrow('空间不足')
    const objectQuota = new StorageQuotaService(app.get(PrismaService), config({ STORAGE_DRIVER: 's3', STORAGE_CAPACITY_BYTES: '0' }))
    await expect(objectQuota.reserve(owner, 'document', 100)).rejects.toThrow('STORAGE_CAPACITY_BYTES')
  })

  it('并行上传数和在途视频队列分别由数据库限制', async () => {
    const actor = await account(), quota = new StorageQuotaService(app.get(PrismaService), config({ VIDEO_QUEUED_PER_USER: '2', VIDEO_UPLOAD_MAX_MB: '1' }))
    const uploading = await Promise.allSettled(Array.from({ length: 3 }, () => quota.reserve(actor.id, 'document', 100)))
    expect(uploading.filter((row) => row.status === 'fulfilled')).toHaveLength(2)
    for (const row of uploading) if (row.status === 'fulfilled') await quota.release(row.value)
    const queued = await Promise.allSettled(Array.from({ length: 3 }, () => quota.reserve(actor.id, 'processing', 100)))
    expect(queued.filter((row) => row.status === 'fulfilled')).toHaveLength(2)
    for (const row of queued) if (row.status === 'fulfilled') await quota.release(row.value)
  })

  it('请求中断释放预留并删除已接收的临时文件', async () => {
    const boundary = `synthetic-${randomUUID()}`
    const request = httpRequest(`${base}/resource-hub/uploads/document`, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': `multipart/form-data; boundary=${boundary}` } })
    request.on('error', () => undefined)
    request.write(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="abort.txt"\r\nContent-Type: text/plain\r\n\r\n`)
    request.write(Buffer.alloc(65536, 65))
    let reservation
    for (let i = 0; i < 60; i++) { reservation = await db.storageReservation.findFirst({ where: { userId: owner, state: 'uploading' } }); if (reservation) break; await delay(50) }
    expect(reservation).toBeTruthy(); request.destroy()
    for (let i = 0; i < 60; i++) { if (!(await db.storageReservation.count({ where: { id: reservation!.id, state: 'uploading' } }))) break; await delay(50) }
    expect((await db.storageReservation.findUniqueOrThrow({ where: { id: reservation!.id } })).state).toBe('released')
    await delay(100)
    expect(await stat(quota.workspace(reservation!.id)).then(() => true, () => false)).toBe(false)
  })

  it('进程遗留上传租约到期后回收，排队过期可重新申请', async () => {
    const reservation = await quota.reserve(owner, 'document', 100)
    await mkdir(quota.workspace(reservation.id), { recursive: true }); await writeFile(join(quota.workspace(reservation.id), 'partial'), 'orphan')
    await db.storageReservation.update({ where: { id: reservation.id }, data: { expiresAt: new Date(0) } })
    await quota.reapExpiredUploads()
    expect(await stat(quota.workspace(reservation.id)).then(() => true, () => false)).toBe(false)
    expect((await db.storageReservation.findUniqueOrThrow({ where: { id: reservation.id } })).remainingBytes).toBe(0n)
  })

  it('多个处理者只能认领一次，续租延长期限，旧认领不能结算或覆盖结果', async () => {
    const asset = await videoAsset(), second = new VideoProcessingService(app.get(PrismaService), config(), storage, quota)
    const results = await Promise.all([processor.claimNext(), second.claimNext()])
    const claimed = results.filter(Boolean); expect(claimed).toHaveLength(1); expect(claimed[0].id).toBe(asset.id)
    const first = claimed[0], before = first.leaseExpiresAt
    await delay(30); await processor.renewClaim(asset.id, first.claimToken)
    expect((await db.videoAsset.findUniqueOrThrow({ where: { id: asset.id } })).leaseExpiresAt!.getTime()).toBeGreaterThan(before.getTime())
    await db.videoAsset.update({ where: { id: asset.id }, data: { leaseExpiresAt: new Date(0) } }); await processor.recoverExpired()
    const next = await second.claimNext(); expect(next.claimToken).not.toBe(first.claimToken)
    await expect(processor.renewClaim(asset.id, first.claimToken)).rejects.toThrow('租约失效')
    await expect(db.$transaction((tx) => quota.settleFile(tx, { id: first.reservationId, claimToken: first.claimToken }, owner, 1))).rejects.toThrow('预留已失效')
    await db.videoAsset.update({ where: { id: asset.id }, data: { leaseExpiresAt: new Date(0) } }); await second.recoverExpired()
    await processor.processNext()
    expect((await db.videoAsset.findUniqueOrThrow({ where: { id: asset.id } })).status).toBe('ready')
  })

  it('上传后真实处理完整视频，后台普通账号拒绝越权读取容量工作台', async () => {
    const asset = await videoAsset()
    await processor.processNext()
    const row = await db.videoAsset.findUniqueOrThrow({ where: { id: asset.id }, include: { sourceFile: true, playableFile: true, posterFile: true } })
    expect(row.status).toBe('ready'); expect(row.playableFile!.size).toBeGreaterThan(0); expect(row.posterFile!.size).toBeGreaterThan(0)
    expect((await api('/admin/resource-hub/media-runtime')).status).toBe(403)
    const usage = await hub.mediaRuntime(); expect(usage.capacity.site.usedBytes).toBeGreaterThanOrEqual(row.sourceFile.size + row.playableFile!.size + row.posterFile!.size)
  })

  it('旧播放、封面、附件与图片地址随下架、认证失效和封禁立即失效', async () => {
    const asset = await videoAsset(); await processor.processNext()
    const row = await db.videoAsset.findUniqueOrThrow({ where: { id: asset.id } }), attachment = await upload()
    const image = await sharp({ create: { width: 20, height: 20, channels: 3, background: 'white' } }).png().toBuffer()
    const storedImage = await storage.upload({ originalname: 'image.png', mimetype: 'image/png', size: image.length, buffer: image }, { uploadedBy: owner, visibility: 'private' })
    const post = await db.communityPost.create({ data: { authorId: owner, postType: 'note', status: 'published', publishedAt: new Date(), visibility: 'public', title: '合成媒体权限', body: '', plainText: '', contentHash: randomUUID(), contentBlocks: [{ type: 'image', fileId: storedImage.id }], contribution: { create: { kind: 'video', videoAssetId: row.id, attachmentFileId: attachment.id } } } })
    const expires = Math.floor(Date.now() / 1000) + 300
    const playToken = hub.sign('play', row.id, viewer, expires), posterToken = hub.sign('media', row.posterFileId, viewer, expires), attachmentToken = hub.sign('attachment', attachment.id, viewer, expires)
    const reads = [() => hub.playbackFile(row.id, playToken), () => hub.mediaFile(row.posterFileId, posterToken), () => hub.attachmentFile(attachment.id, attachmentToken), () => access.assert(viewer, storedImage.id)]
    for (const read of reads) { const file = await read(); file.stream?.destroy() }
    await db.communityPost.update({ where: { id: post.id }, data: { status: 'hidden' } })
    for (const read of reads) await expect(read()).rejects.toThrow()
    await db.communityPost.update({ where: { id: post.id }, data: { status: 'published' } })
    await db.campusIdentityVerification.update({ where: { userId: owner }, data: { status: 'rejected' } })
    for (const read of reads) await expect(read()).rejects.toThrow()
    await db.campusIdentityVerification.update({ where: { userId: owner }, data: { status: 'approved' } })
    await db.user.update({ where: { id: viewer }, data: { status: 'disabled' } })
    for (const read of reads) await expect(read()).rejects.toThrow()
    await db.user.update({ where: { id: viewer }, data: { status: 'active' } })
    await expect(hub.playbackFile(row.id, `${playToken}.extra`)).rejects.toThrow()
    await expect(hub.playbackFile(row.id, undefined)).rejects.toThrow()
  })

  it('草稿与课程历史引用阻止文件和视频清理', async () => {
    const file = await upload(), asset = await videoAsset()
    await db.communityPost.create({ data: { authorId: owner, postType: 'note', status: 'draft', visibility: 'public', title: '合成私人草稿', body: '', plainText: '', contentHash: randomUUID(), contentBlocks: [{ type: 'paragraph', text: `视频 ${asset.id}` }, { type: 'image', fileId: file.id }] } })
    await db.videoAsset.update({ where: { id: asset.id }, data: { status: 'failed', updatedAt: new Date(0) } })
    await expect(storage.delete(file.id)).rejects.toThrow('引用')
    await processor.cleanupOrphans(admin)
    expect(await db.videoAsset.findUnique({ where: { id: asset.id } })).toBeTruthy()
    const course = await db.course.create({ data: { slug: `media-${randomUUID()}`, title: '合成课程', summary: '合成测试' } })
    await db.courseVersion.create({ data: { courseId: course.id, versionNo: 1, snapshot: { fileId: file.id } } })
    await expect(storage.delete(file.id)).rejects.toThrow('引用')
  })

  it('配置的扫描器失败时隔离；被隔离文件不能读取', async () => {
    const guarded = new LocalStorageAdapter(app.get(PrismaService), config({ MEDIA_CLAMSCAN_PATH: '/missing/synthetic-clamscan' }), quota)
    const bytes = Buffer.from('合成待扫描资料'), file = await guarded.upload({ originalname: 'scan.txt', mimetype: 'text/plain', size: bytes.length, buffer: bytes }, { uploadedBy: owner, visibility: 'private' })
    expect(file.securityScan).toMatchObject({ status: 'error', quarantined: true })
    await expect(guarded.open(file.id)).rejects.toThrow()
    await expect(access.assert(owner, file.id)).rejects.toThrow()
  })

  it('仅过期幂等凭据不永久占用文件，有效凭据继续保护重复上传结果', async () => {
    const file = await upload()
    const request = await db.requestIdempotency.create({ data: { principalKey: randomUUID(), scope: 'synthetic-media', idempotencyKey: randomUUID(), requestHash: randomUUID(), resourceId: file.id, expiresAt: new Date(Date.now() + 60000) } })
    await expect(storage.delete(file.id)).rejects.toThrow('引用')
    await db.requestIdempotency.update({ where: { id: request.id }, data: { expiresAt: new Date(0) } })
    await storage.delete(file.id)
    expect(await db.fileRecord.count({ where: { id: file.id } })).toBe(0)
  })

  it('准备独立容器的两分钟处理中重启验收素材', async () => {
    const asset = await videoAsset()
    await writeFile(join(uploads, 'restart-case.json'), JSON.stringify({ assetId: asset.id, owner, preparedAt: new Date().toISOString() }))
    expect((await readdir(uploads)).includes('restart-case.json')).toBe(true)
    expect(JSON.parse(await readFile(join(uploads, 'restart-case.json'), 'utf8')).assetId).toBe(asset.id)
  })
})
