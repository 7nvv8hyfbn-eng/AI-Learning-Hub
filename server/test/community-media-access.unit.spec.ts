import 'reflect-metadata'
import { describe, expect, it, vi } from 'vitest'
import { NotFoundException, StreamableFile } from '@nestjs/common'
import { GUARDS_METADATA } from '@nestjs/common/constants'
import { Readable } from 'node:stream'
import { ConfigService } from '@nestjs/config'
import { CommunityController } from '../src/modules/community/community.controller'
import { CommunityAdminController } from '../src/modules/community/admin.controller'
import { LocalFileController, StorageController } from '../src/modules/storage/storage.controller'
import { AuthGuard } from '../src/modules/auth/auth.guard'
import { LocalStorageAdapter } from '../src/modules/storage/local-storage.service'
import { ResourceHubMediaController } from '../src/modules/resources/resource-hub.controller'

describe('社区媒体地址不能绕过后续内容复核', () => {
  it('资源图片也禁止缓存，连接关闭时回收文件流', async () => {
    const stream = Readable.from(Buffer.from([1, 2, 3]))
    const hub = { mediaFile: vi.fn(async () => ({ stream, mimeType: 'image/png', size: 3, originalName: '合成图片.png' })) }
    const response = { set: vi.fn(), once: vi.fn() }
    await new ResourceHubMediaController(hub as never).media('synthetic-file', 'synthetic-token', response as never)
    expect(response.set).toHaveBeenCalledWith(expect.objectContaining({ 'Cache-Control': 'private, no-store' }))
    expect(response.once).toHaveBeenCalledWith('close', expect.any(Function))
    response.once.mock.calls[0][1]()
    expect(stream.destroyed).toBe(true)
  })
  it.each(['local', 's3', 'minio'])('%s的学生、社区审核与文件管理入口只返回受鉴权地址', async (storageDriver) => {
    const id = 'synthetic-image', user = { id: 'synthetic-viewer' }
    const files = { assert: vi.fn(async () => ({ id, storageDriver, mimeType: 'image/png' })) }
    const storage = { getSignedUrl: vi.fn(async () => 'https://example.invalid/synthetic-object-signature') }
    const student = { files, storage }
    const url = `/api/v1/files/${id}/download`
    expect(await CommunityController.prototype.media.call(student as never, user as never, id)).toEqual({ url })
    const visibility = { adminWhere: vi.fn(async () => ({ status: { not: 'draft' } })), auditAdminRead: vi.fn() }
    const admin = { storage, visibility, prisma: { communityPost: { count: vi.fn(async () => 1) } } }
    expect(await CommunityAdminController.prototype.media.call(admin as never, user as never, id)).toEqual({ url })
    expect(visibility.auditAdminRead).toHaveBeenCalledWith(user.id, 'file', id)
    expect(await new StorageController(storage as never, files as never, {} as never).url(user as never, id)).toEqual({ url, expiresIn: 0 })
    expect(storage.getSignedUrl).not.toHaveBeenCalled()
  })

  it.each(['local', 's3', 'minio'])('%s复用存储流、禁止缓存，旧应用地址每次重新验证权限', async (storageDriver) => {
    const file = { id: 'synthetic-file', objectKey: 'synthetic/image.png', storageDriver, mimeType: 'image/png', size: 3, originalName: '合成图片.png' }
    const fileAccess = { assert: vi.fn(async () => file) }
    const stream = Readable.from(Buffer.from([1, 2, 3]))
    const storage = { open: vi.fn(async () => ({ ...file, stream })), getSignedUrl: vi.fn() }
    const prisma = { resource: { findMany: vi.fn(async () => []) } }
    const response = { set: vi.fn(), once: vi.fn(), redirect: vi.fn() }
    const controller = new LocalFileController(prisma as never, fileAccess as never, storage as never, {} as never)
    const result = await controller.download({ id: 'synthetic-viewer' } as never, file.id, response as never)
    expect(result).toBeInstanceOf(StreamableFile)
    const chunks: Buffer[] = []
    for await (const chunk of result.getStream()) chunks.push(Buffer.from(chunk))
    expect(Buffer.concat(chunks)).toEqual(Buffer.from([1, 2, 3]))
    expect(storage.open).toHaveBeenCalledWith(file.id)
    expect(response.set).toHaveBeenCalledWith(expect.objectContaining({ 'Content-Length': '3', 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' }))
    expect(response.redirect).not.toHaveBeenCalled()
    expect(storage.getSignedUrl).not.toHaveBeenCalled()
    fileAccess.assert.mockRejectedValueOnce(new NotFoundException('文件不存在或无权访问'))
    await expect(controller.download({ id: 'synthetic-viewer' } as never, file.id, response as never)).rejects.toThrow('无权访问')
    expect(fileAccess.assert).toHaveBeenCalledTimes(2)
    expect(storage.open).toHaveBeenCalledTimes(1)
    expect(prisma.resource.findMany).toHaveBeenCalledTimes(1)
    expect(Reflect.getMetadata(GUARDS_METADATA, controller.download)).toContain(AuthGuard)
  })

  it('底层文件不可用时不登记下载成功，也不回退到外部签名', async () => {
    const storage = { open: vi.fn(async () => { throw new NotFoundException('文件不存在') }), getSignedUrl: vi.fn() }
    const prisma = { resource: { findMany: vi.fn() } }
    const fileAccess = { assert: vi.fn(async () => ({ id: 'synthetic-file', storageDriver: 's3' })) }
    const controller = new LocalFileController(prisma as never, fileAccess as never, storage as never, {} as never)
    await expect(controller.download({ id: 'synthetic-viewer' } as never, 'synthetic-file', { set: vi.fn() } as never)).rejects.toThrow('文件不存在')
    expect(storage.open).toHaveBeenCalledOnce()
    expect(prisma.resource.findMany).not.toHaveBeenCalled()
    expect(storage.getSignedUrl).not.toHaveBeenCalled()
  })

  it('本地文件缺失仍在响应前返回404，不把不存在文件交给下载流', async () => {
    const prisma = { fileRecord: { findUnique: vi.fn(async () => ({ id: 'synthetic-file', storageDriver: 'local', objectKey: 'synthetic/missing.png' })) } }
    const storage = new LocalStorageAdapter(prisma as never, new ConfigService({ STORAGE_LOCAL_PATH: '/private/tmp/aihub-content-detection-missing-file' }))
    await expect(storage.open('synthetic-file')).rejects.toBeInstanceOf(NotFoundException)
  })

  it('下载计数查询失败时关闭已打开的流，不留下对象存储连接', async () => {
    const stream = Readable.from(Buffer.from([1, 2, 3]))
    const storage = { open: vi.fn(async () => ({ stream })) }
    const prisma = { resource: { findMany: vi.fn(async () => { throw new Error('合成数据库失败') }) } }
    const controller = new LocalFileController(prisma as never, { assert: vi.fn() } as never, storage as never, {} as never)
    await expect(controller.download({ id: 'synthetic-viewer' } as never, 'synthetic-file', { set: vi.fn() } as never)).rejects.toThrow('合成数据库失败')
    expect(stream.destroyed).toBe(true)
  })
})
