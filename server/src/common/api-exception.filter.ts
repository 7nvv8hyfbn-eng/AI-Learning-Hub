import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus } from '@nestjs/common'
import type { Response } from 'express'
import { Prisma } from '@prisma/client'
import { ContentDetectionError } from '@ai-learning-hub/contracts'

@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  catch(error: unknown, host: ArgumentsHost) {
    const response = host.switchToHttp().getResponse<Response>()
    const status = error instanceof HttpException ? error.getStatus() : error instanceof ContentDetectionError ? HttpStatus.BAD_REQUEST : error instanceof Prisma.PrismaClientKnownRequestError && ['P2002', 'P2025', 'P2034'].includes(error.code) ? HttpStatus.CONFLICT : error instanceof Prisma.PrismaClientInitializationError ? HttpStatus.SERVICE_UNAVAILABLE : HttpStatus.INTERNAL_SERVER_ERROR
    const raw = error instanceof HttpException ? error.getResponse() : error instanceof ContentDetectionError ? error.message : null
    const message = typeof raw === 'string'
      ? raw
      : raw && typeof raw === 'object' && 'message' in raw
        ? Array.isArray(raw.message) ? raw.message.join('；') : String(raw.message)
        : '服务暂时不可用'
    const errorCode = raw && typeof raw === 'object' && 'errorCode' in raw && typeof raw.errorCode === 'string' ? raw.errorCode : undefined
    const retryAfter = raw && typeof raw === 'object' && 'retryAfter' in raw && typeof raw.retryAfter === 'number' ? raw.retryAfter : undefined
    const availableAt = raw && typeof raw === 'object' && 'availableAt' in raw && typeof raw.availableAt === 'string' ? raw.availableAt : undefined
    const nextAction = raw && typeof raw === 'object' && 'nextAction' in raw && raw.nextAction && typeof raw.nextAction === 'object' ? raw.nextAction : undefined
    if (status === 429 && retryAfter) response.setHeader('Retry-After', String(retryAfter))
    response.status(status).json({
      code: status * 100 + 1,
      ...(errorCode ? { errorCode } : {}),
      ...(availableAt ? { availableAt } : {}),
      ...(nextAction ? { nextAction } : {}),
      message,
      details: {},
      data: null,
      requestId: response.locals.requestId,
    })
  }
}
