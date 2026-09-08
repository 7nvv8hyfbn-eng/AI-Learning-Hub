import { fileQuotaStub } from './storage.fixture'
import 'reflect-metadata'
import { describe, expect, it, vi } from 'vitest'
import { BadRequestException, HttpException } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { actionEvent, idempotency, lockFileReferences, rateLimit, reserveIdempotency } from '../src/common/persistence'
import { StorageBase } from '../src/modules/storage/storage.base'
import type { UploadedPathFile } from '../src/modules/storage/storage.types'
import { PersistenceService } from '../src/modules/persistence/persistence.service'
import type { PrismaService } from '../src/prisma/prisma.service'
import { AuthService } from '../src/modules/auth/auth.service'

describe('持久化原子职责', () => {
  it('规范化幂等请求键顺序、拒绝同键异内容、过期记录可更新', async () => {
    let stored: any = null
    const tx: any = { $queryRaw: vi.fn(), requestIdempotency: { findUnique: vi.fn(async () => stored), upsert: vi.fn(async ({ create }: any) => { stored = create }) } }
    const first = await idempotency(tx, 'user-a', 'post:new', 'retry-key-1', { b: 2, a: 1 })
    await first.complete('post-1')
    expect((await idempotency(tx, 'user-a', 'post:new', 'retry-key-1', { a: 1, b: 2 })).resourceId).toBe('post-1')
    await expect(idempotency(tx, 'user-a', 'post:new', 'retry-key-1', { a: 2 })).rejects.toThrow()
    stored.expiresAt = new Date(0)
    expect((await idempotency(tx, 'user-a', 'post:new', 'retry-key-1', { a: 2 })).resourceId).toBeNull()
    await expect(idempotency(tx, 'user-a', 'post:new', 'bad', {})).rejects.toThrow()
    expect(tx.$queryRaw.mock.calls.every(([sql]: [TemplateStringsArray]) => sql.join('?').endsWith('::text'))).toBe(true)
  })
  it('大文件请求先占用幂等键，并发重试不会重复写入', async () => {
    let stored: any = null
    const tx: any = {
      $queryRaw: vi.fn(),
      requestIdempotency: {
        findUnique: vi.fn(async () => stored),
        upsert: vi.fn(async ({ create, update }: any) => { stored = stored ? { ...stored, ...update } : create }),
        updateMany: vi.fn(async ({ where, data }: any) => {
          if (!stored || stored.requestHash !== where.requestHash || stored.status !== where.status) return { count: 0 }
          stored = { ...stored, ...data }; return { count: 1 }
        }),
        deleteMany: vi.fn(async () => ({ count: 1 })),
      },
    }
    const client: any = { $transaction: vi.fn(async (callback: (value: typeof tx) => Promise<unknown>) => callback(tx)) }
    const first = await reserveIdempotency(client, 'student', 'media-upload', 'upload-retry-1', { checksum: 'same' })
    expect(first.resourceId).toBeNull()
    await expect(reserveIdempotency(client, 'student', 'media-upload', 'upload-retry-1', { checksum: 'same' })).rejects.toThrow('正在处理中')
    await first.complete(tx, 'file-1')
    expect((await reserveIdempotency(client, 'student', 'media-upload', 'upload-retry-1', { checksum: 'same' })).resourceId).toBe('file-1')
    await expect(reserveIdempotency(client, 'student', 'media-upload', 'upload-retry-1', { checksum: 'other' })).rejects.toThrow('不能用于不同内容')
  })
  it('数据库限流返回结构化可用时间和 Retry-After 秒数', async () => {
    const expiresAt = new Date(Date.now() + 20_000)
    const tx: any = { $queryRaw: vi.fn().mockResolvedValue([{ attempts: 2, expires_at: expiresAt, retry_after: 20 }]) }
    await expect(rateLimit(tx, 'student', 'community:post:account', 1, 60_000, '发帖过于频繁', 'COMMUNITY_RATE_LIMITED')).rejects.toSatisfy((error: HttpException) => {
      const response = error.getResponse() as Record<string, unknown>
      return error.getStatus() === 429 && response.errorCode === 'COMMUNITY_RATE_LIMITED' && response.availableAt === expiresAt.toISOString() && response.retryAfter === 20
    })
  })
  it('JSON文件引用锁使用可解码投影，仍调用事务级咨询锁', async () => {
    const tx: any = { $queryRaw: vi.fn() }
    await lockFileReferences(tx)
    expect(tx.$queryRaw).toHaveBeenCalledOnce()
    expect(tx.$queryRaw.mock.calls[0][0].join('?')).toBe("SELECT pg_advisory_xact_lock(hashtextextended('file-references', 0))::text")
  })
  it('登录以账号为主、IP为辅且组合失败键独立，原生计数显式维护必填时间', async () => {
    const db: any = { $queryRaw: vi.fn().mockResolvedValue([{ attempts: 1 }]), $executeRaw: vi.fn(), loginThrottle: { findUnique: vi.fn().mockResolvedValue(null) }, user: { findFirst: vi.fn().mockResolvedValue(null) }, loginLog: { create: vi.fn() } }
    const auth = new AuthService(db, {} as never, new ConfigService(), {} as never)
    await expect(auth.login('missing@example.invalid', 'Wrong123', 'ip-a:missing@example.invalid', 'ip-a')).rejects.toThrow('账号或密码错误')
    await expect(auth.login('missing@example.invalid', 'Wrong123', 'ip-b:missing@example.invalid', 'ip-b')).rejects.toThrow('账号或密码错误')
    const rateKeys = db.$queryRaw.mock.calls.map((call: unknown[]) => call[1])
    expect(rateKeys[0]).toBe(rateKeys[2]); expect(rateKeys[1]).not.toBe(rateKeys[3])
    const combinationKeys = db.loginThrottle.findUnique.mock.calls.map(([input]: [{ where: { identityKey: string } }]) => input.where.identityKey)
    expect(combinationKeys[0]).not.toBe(combinationKeys[1])
    const sql = db.$executeRaw.mock.calls[0][0].join('?')
    expect(sql).toContain('INSERT INTO login_throttles(identity_key,failures,expires_at,updated_at)')
    expect(sql).toMatch(/VALUES\([\s\S]*NOW\(\)\)/)
    expect(sql).toContain('updated_at=NOW()')
    expect(db.loginLog.create).toHaveBeenCalledTimes(2)
  })
  it('一个行为只写一条既有事件，保留规范事件与实体身份', async () => {
    const tx: any = { activityEvent: { create: vi.fn() } }
    await actionEvent(tx, 'actor', 'student_register', 'user', 'new-user')
    expect(tx.activityEvent.create).toHaveBeenCalledOnce()
    expect(tx.activityEvent.create).toHaveBeenCalledWith({ data: expect.objectContaining({ eventType: 'student_register', actionType: 'user_registered', entityType: 'user', entityId: 'new-user', source: 'student-web', eventKey: expect.any(String) }) })
  })
  it('文件伪装在写入之前被拒绝，数据库写失败清理新增对象', async () => {
    class MemoryStorage extends StorageBase {
      putObject = vi.fn(async () => {})
      putPath = vi.fn(async (_key: string, _file: UploadedPathFile) => {})
      removeObject = vi.fn(async () => {})
      objectExists = vi.fn(async () => true)
      objectUrl = vi.fn(async () => '/local')
    }
    const db = { fileRecord: { create: vi.fn().mockRejectedValue(new Error('db write failed')) } } as unknown as PrismaService
    const storage = new MemoryStorage(db, 'local', new ConfigService({}), fileQuotaStub(db)), options = { uploadedBy: 'owner', visibility: 'private' as const }
    await expect(storage.upload({ originalname: 'fake.png', mimetype: 'image/png', size: 4, buffer: Buffer.from('fake') }, options)).rejects.toThrow()
    expect(storage.putObject).not.toHaveBeenCalled()
    await expect(storage.upload({ originalname: 'safe.txt', mimetype: 'text/plain', size: 4, buffer: Buffer.from('safe') }, options)).rejects.toThrow('db write failed')
    expect(storage.removeObject).toHaveBeenCalledOnce()
  })
  it('GC第一批均引用仍返回稳定续游标，后续孤儿不会饥饿', async () => {
    const early = Array.from({ length: 50 }, (_, i) => ({ id: `reference-${i}`, createdAt: new Date(0) })), orphan = { id: 'orphan', createdAt: new Date(1) }
    const findMany = vi.fn().mockResolvedValueOnce(early).mockResolvedValueOnce([orphan])
    const prisma = { fileRecord: { findMany }, auditLog: { create: vi.fn() } } as unknown as PrismaService
    const storage: any = { delete: vi.fn(async (id: string) => { if (id !== 'orphan') throw new BadRequestException('referenced') }) }
    const service = new PersistenceService(prisma, new ConfigService({ STORAGE_DRIVER: 'local' }), storage)
    const first = await service.maintain('admin', 'unused-files', '验证文件清理游标')
    expect(first).toMatchObject({ count: 0, nextCursor: expect.any(String) })
    const second = await service.maintain('admin', 'unused-files', '验证文件清理游标', 'nextCursor' in first ? first.nextCursor! : undefined)
    expect(second).toMatchObject({ count: 1, nextCursor: null })
    expect(findMany.mock.calls[1][0].where.OR).toEqual([{ createdAt: { gt: new Date(0) } }, { createdAt: new Date(0), id: { gt: 'reference-49' } }])
  })
})
