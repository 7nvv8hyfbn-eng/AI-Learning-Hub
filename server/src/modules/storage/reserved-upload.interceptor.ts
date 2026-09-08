import { BadRequestException, CallHandler, ExecutionContext, Injectable, Logger, mixin, NestInterceptor, PayloadTooLargeException, type Type } from '@nestjs/common'
import multer, { diskStorage, memoryStorage } from 'multer'
import { mkdir, rm } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import type { Request, Response } from 'express'
import { lastValueFrom, of } from 'rxjs'
import { StorageQuotaService, type StorageUploadKind } from './storage-quota.service'

/** 保留单文件multipart协议；在读取文件内容前取得跨请求配额。 */
export function ReservedUpload(kind: Exclude<StorageUploadKind, 'processing'>, maxBytes?: number): Type<NestInterceptor> {
  @Injectable()
  class UploadInterceptor implements NestInterceptor {
    constructor(private readonly quota: StorageQuotaService) {}

    async intercept(context: ExecutionContext, next: CallHandler) {
      const request = context.switchToHttp().getRequest<Request & { user: { id: string } }>()
      const response = context.switchToHttp().getResponse<Response>()
      const maximum = maxBytes ?? (kind === 'video' ? this.quota.videoLimit : this.quota.documentLimit)
      const reservation = await this.quota.reserve(request.user.id, kind, maximum)
      const controller = new AbortController()
      const workspace = this.quota.workspace(reservation.id)
      let cancelled = false, renewing = false
      let rejectAbort: (error: Error) => void = () => undefined
      const aborted = new Promise<never>((_, reject) => { rejectAbort = reject })
      // 即使请求在解析启动前中断，也不会产生未处理拒绝。
      void aborted.catch(() => undefined)
      const abort = () => { cancelled = true; controller.abort(); rejectAbort(new BadRequestException('上传已中断')); void this.quota.release(reservation, true).catch(() => Logger.error('中断上传预留释放失败，将由租约回收', 'StorageUpload')) }
      const closed = () => { if (!response.writableFinished) abort() }
      request.once('aborted', abort)
      response.once('close', closed)
      const timeout = setTimeout(abort, 30 * 60_000)
      const timer = setInterval(() => {
        if (renewing || cancelled) return
        renewing = true
        void this.quota.renew(reservation, 'uploading').catch(abort).finally(() => { renewing = false })
      }, 30_000)
      try {
        if (request.aborted) abort()
        await mkdir(workspace, { recursive: true, mode: 0o700 })
        const upload = multer({
          storage: kind === 'image' ? memoryStorage() : diskStorage({ destination: workspace, filename: (_req, _file, done) => done(null, randomUUID()) }),
          limits: { fileSize: maximum, files: 1, fields: 5, fieldSize: 16 * 1024, parts: 6 },
          fileFilter: (_req, file, done) => { request.once('aborted', () => file.stream?.destroy()); done(null, true) },
        }).single('file')
        await Promise.race([aborted, new Promise<void>((resolve, reject) => upload(request, response, (error: unknown) => error ? reject(error instanceof multer.MulterError && error.code === 'LIMIT_FILE_SIZE' ? new PayloadTooLargeException('文件超过单文件限制') : new BadRequestException('上传文件格式或表单不合法')) : resolve()))])
        if (cancelled || !request.file) throw new BadRequestException('请选择完整的文件')
        const result = await this.quota.within({ id: reservation.id, claimToken: reservation.claimToken, signal: controller.signal }, () => Promise.race([aborted, lastValueFrom(next.handle())]))
        return of(result)
      } finally {
        clearInterval(timer); clearTimeout(timeout)
        request.removeListener('aborted', abort); response.removeListener('close', closed)
        try { await rm(workspace, { recursive: true, force: true }) }
        finally { await this.quota.release(reservation, true) }
      }
    }
  }
  return mixin(UploadInterceptor)
}
