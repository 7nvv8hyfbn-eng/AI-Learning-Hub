import { beforeAll, describe, expect, it, vi } from 'vitest'
import sharp from 'sharp'
import { StorageBase } from '../src/modules/storage/storage.base'
import type { PrismaService } from '../src/prisma/prisma.service'
import type { UploadedFile, UploadedPathFile } from '../src/modules/storage/storage.types'
import { collectArchivedMedia } from '../src/modules/media/media-gc'
import { MediaService } from '../src/modules/media/media.service'

class MemoryStorage extends StorageBase {
  objects = new Map<string, Buffer>()
  removed: string[] = []
  constructor(prisma: unknown) { super(prisma as PrismaService, 'local') }
  protected async putObject(key: string, file: UploadedFile) { this.objects.set(key, file.buffer) }
  protected async putPath(_key: string, _file: UploadedPathFile) { throw new Error('测试替身不处理路径上传') }
  protected async removeObject(key: string) { this.removed.push(key); this.objects.delete(key) }
  protected async objectExists(key: string) { return this.objects.has(key) }
  protected async objectUrl(key: string) { return key }
}
let file: UploadedFile
beforeAll(async () => {
  const buffer = await sharp({ create: { width: 32, height: 24, channels: 3, background: '#ddd' } }).webp().toBuffer()
  file = { originalname: 'cover.webp', mimetype: 'image/webp', size: buffer.length, buffer }
})
function database(options: { createFail?: boolean; commitFail?: boolean; committed?: boolean } = {}) {
  let record: Record<string, unknown> | null = null
  const tx = {
    $queryRaw: vi.fn(async () => []),
    fileRecord: {
      findFirst: vi.fn(async () => record),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        if (options.createFail) throw new Error('record failed')
        record = { id: 'file-1', ...data }
        return record
      }),
      count: vi.fn(async () => options.committed ? 1 : options.commitFail ? 0 : record ? 1 : 0),
    },
    $transaction: vi.fn(async (operation: (client: unknown) => Promise<unknown>) => {
      const result = await operation(tx)
      if (options.commitFail) throw new Error('commit failed')
      return result
    }),
  }
  return tx
}
describe('公共素材存储的去重与失败补偿', () => {
  it.each([true, false])('已软删除=%s的重复图片不复活，提示与真实恢复能力一致', async (deleted) => {
    const db = {
      $queryRaw: vi.fn(async () => []), mediaAsset: { findUnique: vi.fn(async () => ({ status: 'archived', deletedAt: deleted ? new Date() : null })), count: vi.fn(async () => 1) },
      $transaction: vi.fn(async (fn: (tx: unknown) => unknown) => fn(db)),
    }
    const storage = { upload: vi.fn(async () => ({ id: 'file1' })), delete: vi.fn() }
    await expect(new MediaService(db as never, {} as never, storage as never).upload(file, { name: '封面', kind: 'cover', contentType: 'course', categoryKey: 'generic', altText: '' }, { id: 'admin', roles: ['admin'] } as never)).rejects.toThrow(deleted ? '受控清理完成后重新导入' : '在素材库恢复后使用')
    expect(storage.delete).not.toHaveBeenCalled()
  })
  it.each(['asset', 'audit', 'commit'] as const)('第二阶段%s写入失败排队并补偿无绑定文件', async (failure) => {
    let calls = 0
    const db = {
      $queryRaw: vi.fn(async () => []),
      mediaAsset: { findUnique: vi.fn(async () => null), count: vi.fn(async () => 0), create: vi.fn(async () => { if (failure === 'asset') throw new Error('asset failed'); return { id: 'asset1' } }) },
      auditLog: { create: vi.fn(async () => { if (failure === 'audit') throw new Error('audit failed') }) },
      mediaGcJob: { upsert: vi.fn(async () => ({ id: 'job1' })), delete: vi.fn() },
      $transaction: vi.fn(async (fn: (tx: unknown) => unknown) => { calls++; const result = await fn(db); if (calls === 1 && failure === 'commit') throw new Error('commit failed'); return result }),
    }
    const storage = { upload: vi.fn(async () => ({ id: 'file1' })), delete: vi.fn() }
    const service = new MediaService(db as never, {} as never, storage as never)
    await expect(service.upload(file, { name: '封面', kind: 'cover', contentType: 'course', categoryKey: 'generic', altText: '' }, { id: 'admin', roles: ['admin'] } as never)).rejects.toThrow(`${failure} failed`)
    expect(db.mediaGcJob.upsert).toHaveBeenCalledWith({ where: { fileId: 'file1' }, create: { fileId: 'file1' }, update: {} })
    expect(storage.delete).toHaveBeenCalledWith('file1')
    expect(db.mediaGcJob.delete).toHaveBeenCalledWith({ where: { id: 'job1' } })
  })
  it('第二阶段提交结果不明但绑定已存在时不清共享文件；清理失败时保留队列', async () => {
    for (const committed of [true, false]) {
      let calls = 0
      const db = {
        $queryRaw: vi.fn(async () => []),
        mediaAsset: { findUnique: vi.fn(async () => null), count: vi.fn(async () => committed ? 1 : 0), create: vi.fn(async () => ({ id: 'asset1' })) },
        auditLog: { create: vi.fn() }, mediaGcJob: { upsert: vi.fn(async () => ({ id: 'job1' })), delete: vi.fn() },
        $transaction: vi.fn(async (fn: (tx: unknown) => unknown) => { calls++; const result = await fn(db); if (calls === 1) throw new Error('commit unknown'); return result }),
      }
      const storage = { upload: vi.fn(async () => ({ id: 'file1' })), delete: vi.fn(async () => { throw new Error('disk unavailable') }) }
      await expect(new MediaService(db as never, {} as never, storage as never).upload(file, { name: '封面', kind: 'cover', contentType: 'course', categoryKey: 'generic', altText: '' }, { id: 'admin', roles: ['admin'] } as never)).rejects.toThrow('commit unknown')
      expect(storage.delete).toHaveBeenCalledTimes(committed ? 0 : 1)
      expect(db.mediaGcJob.upsert).toHaveBeenCalledTimes(committed ? 0 : 1)
      expect(db.mediaGcJob.delete).not.toHaveBeenCalled()
    }
  })
  it('同checksum公共catalog文件仅存一份，绝不提升private文件可见性', async () => {
    const db = database(), storage = new MemoryStorage(db)
    const first = await storage.upload(file, { uploadedBy: 'admin', visibility: 'public', catalogMedia: true })
    const second = await storage.upload(file, { uploadedBy: 'admin', visibility: 'public', catalogMedia: true })
    expect(second.id).toBe(first.id)
    expect(storage.objects.size).toBe(1)
    expect(db.fileRecord.create).toHaveBeenCalledTimes(1)
    expect(db.fileRecord.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ visibility: 'public', objectKey: { startsWith: 'catalog/' } }) }))
  })
  it('对象成功但FileRecord写入失败，仅补偿本事务独占对象', async () => {
    const db = database({ createFail: true }), storage = new MemoryStorage(db)
    storage.objects.set('catalog/another-committed.webp', Buffer.from('retained'))
    await expect(storage.upload(file, { uploadedBy: 'admin', visibility: 'public', catalogMedia: true })).rejects.toThrow('record failed')
    expect([...storage.objects.keys()]).toEqual(['catalog/another-committed.webp'])
    expect(storage.removed).toHaveLength(1)
  })
  it('确认提交失败且无记录时清理，提交结果不明但记录已存在时保留', async () => {
    const failed = new MemoryStorage(database({ commitFail: true }))
    await expect(failed.upload(file, { uploadedBy: 'admin', visibility: 'public', catalogMedia: true })).rejects.toThrow()
    expect(failed.objects.size).toBe(0)
    const committed = new MemoryStorage(database({ commitFail: true, committed: true }))
    await expect(committed.upload(file, { uploadedBy: 'admin', visibility: 'public', catalogMedia: true })).rejects.toThrow()
    expect(committed.objects.size).toBe(1)
    expect(committed.removed).toHaveLength(0)
  })
  it('物理删除失败保留持久化重试队列，重试成功后才移除队列', async () => {
    let available = true, queued = false
    const db = {
      $queryRaw: vi.fn(async () => []),
      mediaDefaultRule: { findMany: vi.fn(async () => []) },
      systemSetting: { findMany: vi.fn(async () => []) },
      mediaAsset: { findMany: vi.fn(async () => available ? [{ id: 'archived', assetKey: 'old', fileId: 'f1' }] : []), count: vi.fn(async () => 1), delete: vi.fn(async () => { available = false }) },
      mediaGcJob: { upsert: vi.fn(async () => { queued = true }), findMany: vi.fn(async () => queued ? [{ id: 'job1', fileId: 'f1' }] : []), delete: vi.fn(async () => { queued = false }) },
      $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn(db)),
    }
    const storage = { delete: vi.fn().mockRejectedValueOnce(new Error('storage unavailable')).mockResolvedValue(undefined) }
    expect(await collectArchivedMedia(db as never, storage as never, true)).toMatchObject({ removed: 0, pending: ['job1'] })
    expect(queued).toBe(true)
    expect(await collectArchivedMedia(db as never, storage as never, true)).toMatchObject({ removed: 1, pending: [] })
    expect(queued).toBe(false)
  })
  it('清理默认dry-run且拒绝缩短安全保留期', async () => {
    await expect(collectArchivedMedia({} as never, {} as never, true, 1)).rejects.toThrow('不得少于30天')
  })
})
