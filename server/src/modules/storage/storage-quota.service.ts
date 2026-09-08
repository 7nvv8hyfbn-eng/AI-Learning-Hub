import { BadRequestException, ConflictException, Injectable, Logger, OnModuleDestroy, OnModuleInit, ServiceUnavailableException } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import type { Prisma } from '@prisma/client'
import type { StorageCapacityDto } from '@ai-learning-hub/contracts'
import { AsyncLocalStorage } from 'node:async_hooks'
import { randomUUID } from 'node:crypto'
import { mkdir, opendir, rm, stat, statfs } from 'node:fs/promises'
import * as path from 'node:path'
import { lockFileReferences } from '../../common/persistence'
import { PrismaService } from '../../prisma/prisma.service'
import type { StorageReservationHandle } from './storage.types'

export type StorageUploadKind = 'image' | 'document' | 'video' | 'processing'
const MiB = 1024 * 1024, GiB = 1024 * MiB
export const UPLOAD_LEASE_MS = 90_000
export const PROCESSING_LEASE_MS = 90_000
export const POSTER_LIMIT_BYTES = 10 * MiB
export const SCAN_TEMP_LIMIT_BYTES = 2 * GiB

function limit(config: ConfigService, key: string, fallback: number, min: number, max: number) {
  const raw = config.get<string>(key)
  if (raw === undefined || raw === '') return fallback
  const value = Number(raw)
  if (!Number.isSafeInteger(value) || value < min || value > max) throw new Error(`${key} 必须是${min}至${max}之间的整数`)
  return value
}

@Injectable()
export class StorageQuotaService implements OnModuleInit, OnModuleDestroy {
  readonly driver: string
  readonly storageRoot: string
  readonly temporaryRoot: string
  readonly userLimit: number
  readonly capacityLimit: number
  readonly minimumFree: number
  readonly parallelLimit: number
  readonly parallelSiteLimit: number
  readonly queueLimit: number
  readonly queueSiteLimit: number
  readonly videoLimit: number
  readonly documentLimit: number
  private readonly context = new AsyncLocalStorage<StorageReservationHandle>()
  private timer?: NodeJS.Timeout
  private maintenance?: Promise<void>

  constructor(private readonly prisma: PrismaService, private readonly config: ConfigService) {
    this.driver = config.get('STORAGE_DRIVER') || 'local'
    this.storageRoot = path.resolve(config.get('STORAGE_LOCAL_PATH') || './var/uploads')
    this.temporaryRoot = path.resolve(config.get('MEDIA_TEMP_PATH') || path.join(this.storageRoot, '.media-tmp'))
    this.userLimit = limit(config, 'STORAGE_USER_QUOTA_BYTES', 10 * GiB, MiB, Number.MAX_SAFE_INTEGER)
    this.capacityLimit = limit(config, 'STORAGE_CAPACITY_BYTES', 0, 0, Number.MAX_SAFE_INTEGER)
    this.minimumFree = limit(config, 'STORAGE_MIN_FREE_BYTES', 2 * GiB, MiB, Number.MAX_SAFE_INTEGER)
    this.parallelLimit = limit(config, 'STORAGE_PARALLEL_UPLOADS_PER_USER', 2, 1, 8)
    this.parallelSiteLimit = limit(config, 'STORAGE_PARALLEL_UPLOADS_TOTAL', 16, 1, 64)
    this.queueLimit = limit(config, 'VIDEO_QUEUED_PER_USER', 3, 1, 20)
    this.queueSiteLimit = limit(config, 'VIDEO_QUEUED_TOTAL', 50, 1, 500)
    this.videoLimit = limit(config, 'VIDEO_UPLOAD_MAX_MB', 1024, 1, 1024) * MiB
    this.documentLimit = limit(config, 'RESOURCE_ATTACHMENT_MAX_MB', 100, 1, 500) * MiB
  }

  current() { return this.context.getStore() }
  onModuleInit() {
    if (this.config.get('NODE_ENV') === 'test') return
    const tick = () => {
      if (this.maintenance) return
      this.maintenance = this.reapExpiredUploads().then(() => this.cleanupWorkspaces()).then(() => undefined).catch(() => { Logger.error('上传租约或临时目录回收失败，将在下一轮重试', 'StorageQuota') }).finally(() => { this.maintenance = undefined })
    }
    this.timer = setInterval(tick, 30_000)
    tick()
  }
  async onModuleDestroy() { if (this.timer) clearInterval(this.timer); await this.maintenance }
  within<T>(reservation: StorageReservationHandle, work: () => T) { return this.context.run(reservation, work) }
  workspace(id: string, part = 'upload') {
    if (!/^[a-zA-Z0-9-]{8,100}$/.test(id) || !/^[a-zA-Z0-9-]{1,100}$/.test(part)) throw new Error('非法媒体临时目录')
    return path.join(this.temporaryRoot, id, part)
  }

  async capacity(userId?: string, tx: Prisma.TransactionClient = this.prisma): Promise<StorageCapacityDto> {
    if (this.driver === 'local') await mkdir(this.storageRoot, { recursive: true, mode: 0o750 })
    await mkdir(this.temporaryRoot, { recursive: true, mode: 0o700 })
    const disk = await statfs(this.temporaryRoot)
    const localDisk = this.driver === 'local' ? await statfs(this.storageRoot) : null
    const where = { storageDriver: this.driver }
    const [allFiles, userFiles, held] = await Promise.all([
      tx.fileRecord.aggregate({ where, _sum: { size: true } }),
      userId ? tx.fileRecord.aggregate({ where: { ...where, uploadedBy: userId }, _sum: { size: true } }) : null,
      tx.storageReservation.findMany({ where: { ...where, state: { not: 'released' } }, select: { userId: true, state: true, kind: true, remainingBytes: true, temporaryBytes: true } }),
    ])
    const sum = (rows: typeof held, key: 'remainingBytes' | 'temporaryBytes') => rows.reduce((value, row) => value + Number(row[key]), 0)
    const own = userId ? held.filter((row) => row.userId === userId) : held
    const usedBytes = userFiles?._sum.size || (userId ? 0 : allFiles._sum.size || 0)
    const reservedBytes = sum(own, 'remainingBytes'), temporaryReservedBytes = sum(own, 'temporaryBytes')
    const allUsed = allFiles._sum.size || 0, allReserved = sum(held, 'remainingBytes'), allTemporary = sum(held, 'temporaryBytes')
    const capacityBytes = this.capacityLimit || (localDisk ? localDisk.blocks * localDisk.bsize : null)
    const sharedDisk = !!localDisk && (await stat(this.storageRoot)).dev === (await stat(this.temporaryRoot)).dev
    const temporaryFreeBytes = Math.max(0, disk.bavail * disk.bsize - allTemporary - this.minimumFree - (sharedDisk ? allReserved : 0))
    const objectFree = capacityBytes === null ? 0 : capacityBytes - allUsed - allReserved - (sharedDisk ? allTemporary : 0)
    const localFree = localDisk ? localDisk.bavail * localDisk.bsize - allReserved - this.minimumFree : Number.MAX_SAFE_INTEGER
    const availableBytes = Math.max(0, Math.min(objectFree, localFree - (sharedDisk ? allTemporary : 0)))
    const queued = (rows: typeof held) => rows.filter((row) => ['video', 'processing'].includes(row.kind)).length
    return {
      driver: this.driver, usedBytes, reservedBytes, temporaryReservedBytes, quotaBytes: this.userLimit,
      remainingBytes: Math.max(0, this.userLimit - usedBytes - reservedBytes - temporaryReservedBytes),
      activeUploads: own.filter((row) => row.state === 'uploading').length, parallelUploadLimit: this.parallelLimit,
      queuedTasks: queued(own), queueLimit: this.queueLimit,
      site: { usedBytes: allUsed, reservedBytes: allReserved, temporaryReservedBytes: allTemporary, capacityBytes, availableBytes, temporaryFreeBytes, minimumFreeBytes: this.minimumFree, activeUploads: held.filter((row) => row.state === 'uploading').length, queuedTasks: queued(held) },
      unavailableReason: capacityBytes === null ? '对象存储需配置STORAGE_CAPACITY_BYTES后才能接收新上传' : null,
    }
  }

  async reserve(userId: string, kind: StorageUploadKind, sourceBytes: number, transaction?: Prisma.TransactionClient) {
    if (!Number.isSafeInteger(sourceBytes) || sourceBytes <= 0) throw new BadRequestException('文件预留大小不合法')
    const video = kind === 'video' || kind === 'processing'
    const playable = video ? this.videoLimit : 0
    const remaining = (kind === 'processing' ? 0 : sourceBytes) + playable + (video ? POSTER_LIMIT_BYTES : 0)
    const temporary = sourceBytes + playable + (video ? POSTER_LIMIT_BYTES : 0) + (this.config.get('MEDIA_CLAMSCAN_PATH') ? SCAN_TEMP_LIMIT_BYTES : 0)
    const allocate = async (tx: Prisma.TransactionClient) => {
      await lockFileReferences(tx)
      const usage = await this.capacity(userId, tx)
      if (usage.unavailableReason) throw new ServiceUnavailableException(usage.unavailableReason)
      if (remaining + temporary > usage.remainingBytes) throw new BadRequestException('个人存储容量不足，包含进行中上传和临时处理预留')
      const sharedDisk = this.driver === 'local' && (await stat(this.storageRoot)).dev === (await stat(this.temporaryRoot)).dev
      if (remaining > usage.site.availableBytes || temporary > usage.site.temporaryFreeBytes || sharedDisk && remaining + temporary > Math.min(usage.site.availableBytes, usage.site.temporaryFreeBytes)) throw new ServiceUnavailableException('存储剩余空间不足，暂不能上传或处理文件')
      if (kind !== 'processing' && (usage.activeUploads >= this.parallelLimit || usage.site.activeUploads >= this.parallelSiteLimit)) throw new ConflictException('并行上传数量已达上限，请等待当前上传完成')
      if (video && (usage.queuedTasks >= this.queueLimit || usage.site.queuedTasks >= this.queueSiteLimit)) throw new ConflictException('视频排队数量已达上限，请等待处理完成')
      return tx.storageReservation.create({ data: {
        userId, storageDriver: this.driver, kind, state: kind === 'processing' ? 'queued' : 'uploading',
        sourceLimit: BigInt(sourceBytes), playableLimit: BigInt(playable), remainingBytes: BigInt(remaining), temporaryBytes: BigInt(temporary),
        claimToken: randomUUID(), expiresAt: new Date(Date.now() + (kind === 'processing' ? 24 * 60 * 60_000 : UPLOAD_LEASE_MS)),
      } })
    }
    return transaction ? allocate(transaction) : this.prisma.$transaction(allocate, { timeout: 15000 })
  }

  async settleFile(tx: Prisma.TransactionClient, reservation: StorageReservationHandle, uploadedBy: string, size: number) {
    await lockFileReferences(tx)
    const result = await tx.storageReservation.updateMany({
      where: { id: reservation.id, claimToken: reservation.claimToken, userId: uploadedBy, storageDriver: this.driver, state: { in: ['uploading', 'processing'] }, expiresAt: { gt: new Date() }, remainingBytes: { gte: BigInt(size) } },
      data: { remainingBytes: { decrement: BigInt(size) } },
    })
    if (!result.count) throw new ConflictException('上传或处理预留已失效，文件未结算')
  }

  async renew(reservation: StorageReservationHandle, state: 'uploading' | 'processing') {
    const result = await this.prisma.storageReservation.updateMany({ where: { id: reservation.id, claimToken: reservation.claimToken, state, expiresAt: { gt: new Date() } }, data: { expiresAt: new Date(Date.now() + UPLOAD_LEASE_MS) } })
    if (!result.count) throw new ConflictException('媒体任务租约已失效')
  }

  async queue(tx: Prisma.TransactionClient, reservation: StorageReservationHandle) {
    const result = await tx.storageReservation.updateMany({ where: { id: reservation.id, claimToken: reservation.claimToken, state: 'uploading', expiresAt: { gt: new Date() } }, data: { state: 'queued', expiresAt: new Date(Date.now() + 24 * 60 * 60_000) } })
    if (!result.count) throw new ConflictException('上传预留已失效，视频未进入队列')
  }

  async release(reservation: StorageReservationHandle, uploadingOnly = false) {
    await this.prisma.storageReservation.updateMany({
      where: { id: reservation.id, claimToken: reservation.claimToken, ...(uploadingOnly ? { state: 'uploading' } : {}) },
      data: { state: 'released', remainingBytes: 0n, temporaryBytes: 0n, expiresAt: new Date() },
    })
  }

  async reapExpiredUploads() {
    const rows = await this.prisma.storageReservation.findMany({ where: { state: { in: ['uploading', 'queued'] }, expiresAt: { lte: new Date() } }, take: 20, orderBy: { expiresAt: 'asc' } })
    for (const row of rows) {
      const result = await this.prisma.$transaction(async (tx) => {
        await lockFileReferences(tx)
        const updated = await tx.storageReservation.updateMany({ where: { id: row.id, claimToken: row.claimToken, state: row.state, expiresAt: { lte: new Date() } }, data: { state: 'released', remainingBytes: 0n, temporaryBytes: 0n } })
        if (updated.count && row.state === 'queued') await tx.videoAsset.updateMany({ where: { reservationId: row.id, status: 'uploaded' }, data: { status: 'failed', lastError: '排队超过24小时，预留已释放，可重新申请处理' } })
        return updated
      })
      if (!result.count) continue
      await rm(path.dirname(this.workspace(row.id)), { recursive: true, force: true })
      for (const file of await this.prisma.fileRecord.findMany({ where: { reservationId: row.id }, select: { id: true } })) await this.prisma.mediaGcJob.upsert({ where: { fileId: file.id }, create: { fileId: file.id }, update: {} })
    }
    return rows.length
  }

  /** 只清理已失去租约的本系统目录；活跃处理目录始终保留。 */
  async cleanupWorkspaces() {
    await mkdir(this.temporaryRoot, { recursive: true, mode: 0o700 })
    let removed = 0
    const directory = await opendir(this.temporaryRoot)
    for await (const entry of directory) {
      if (removed >= 20) break
      if (!entry.isDirectory() || !/^[a-zA-Z0-9-]{8,100}$/.test(entry.name)) continue
      const reservation = await this.prisma.storageReservation.findUnique({ where: { id: entry.name } })
      if (reservation && reservation.state !== 'released') continue
      const folder = path.dirname(this.workspace(entry.name))
      if (Date.now() - (await stat(folder)).mtimeMs < UPLOAD_LEASE_MS * 2) continue
      await rm(folder, { recursive: true, force: true })
      removed++
    }
    return removed
  }
}
