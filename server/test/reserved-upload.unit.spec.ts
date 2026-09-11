import 'reflect-metadata'
import { describe, expect, it, vi } from 'vitest'
import type { CallHandler, ExecutionContext, NestInterceptor } from '@nestjs/common'
import { EventEmitter } from 'node:events'
import { Readable } from 'node:stream'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { randomUUID } from 'node:crypto'
import { lastValueFrom, of } from 'rxjs'
import { ReservedUpload } from '../src/modules/storage/reserved-upload.interceptor'

describe('目录图片完整 multipart 表单边界', () => {
  it.each([5, 6])('%i 个元数据字段与一个文件按约定接受或拒绝，均释放预留', async (fields) => {
    const form = new FormData()
    form.append('file', new Blob(['image bytes'], { type: 'image/webp' }), 'illustration.webp')
    const values = { name: '课程插图', kind: 'illustration', contentType: 'course', categoryKey: 'llm', altText: '小雪拆分文字', extra: '拒绝额外字段' }
    for (const [key, value] of Object.entries(values).slice(0, fields)) form.append(key, value)
    const source = new Request('http://unit.invalid', { method: 'POST', body: form })
    const bytes = Buffer.from(await source.arrayBuffer())
    const request = Object.assign(Readable.from([bytes]), { method: 'POST', headers: { 'content-type': source.headers.get('content-type'), 'content-length': String(bytes.length) }, user: { id: 'synthetic' }, body: undefined, file: undefined })
    const response = Object.assign(new EventEmitter(), { writableFinished: false })
    const reservation = { id: randomUUID(), claimToken: 'synthetic' }
    const quota = { reserve: vi.fn(async () => reservation), workspace: () => join(tmpdir(), 'aihub-upload-unit-' + reservation.id), release: vi.fn(async () => undefined), renew: vi.fn(), within: vi.fn(async (_context, job: () => unknown) => job()) }
    const Interceptor = ReservedUpload('image', 1024) as unknown as new (value: typeof quota) => NestInterceptor
    const context = { switchToHttp: () => ({ getRequest: () => request, getResponse: () => response }) } as ExecutionContext
    const handler: CallHandler = { handle: () => of({ fields: request.body, file: request.file }) }
    const operation = new Interceptor(quota).intercept(context, handler)
    if (fields === 5) {
      const result = await lastValueFrom(await operation)
      expect(result.fields).toEqual(Object.fromEntries(Object.entries(values).slice(0, 5)))
      expect(result.file).toMatchObject({ originalname: 'illustration.webp', size: bytes.length > 0 ? 11 : 0 })
    } else await expect(operation).rejects.toMatchObject({ status: 400 })
    expect(quota.release).toHaveBeenCalledWith(reservation, true)
  })
})
