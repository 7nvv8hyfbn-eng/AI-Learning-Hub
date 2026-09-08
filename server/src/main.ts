import 'reflect-metadata'
import { NestFactory } from '@nestjs/core'
import { ConfigService } from '@nestjs/config'
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger'
import { Reflector } from '@nestjs/core'
import cookieParser from 'cookie-parser'
import helmet from 'helmet'
import { AppModule } from './app.module'
import { ApiExceptionFilter } from './common/api-exception.filter'
import { ApiResponseInterceptor } from './common/api-response.interceptor'
import { OperationLogInterceptor } from './common/operation-log.interceptor'
import { PersistenceService } from './modules/persistence/persistence.service'
import { appValidationPipe } from './common/validation.pipe'

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bufferLogs: true })
  const config = app.get(ConfigService)
  app.enableShutdownHooks()
  await app.get(PersistenceService).preflight()
  const trustedProxies = String(config.get('TRUSTED_PROXY_CIDRS') || '').split(',').map((value) => value.trim()).filter(Boolean)
  if (trustedProxies.length) app.getHttpAdapter().getInstance().set('trust proxy', trustedProxies)
  const origins = (config.get<string>('CORS_ORIGINS') || '').split(',').map((item) => item.trim()).filter(Boolean)
  if (!origins.length) throw new Error('CORS_ORIGINS 不能为空')

  app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }))
  app.use(cookieParser())
  app.enableCors({ origin: origins, credentials: true, methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] })
  app.setGlobalPrefix('api/v1')
  app.useGlobalPipes(appValidationPipe)
  app.useGlobalFilters(new ApiExceptionFilter())
  app.useGlobalInterceptors(app.get(OperationLogInterceptor), new ApiResponseInterceptor(app.get(Reflector)))

  const document = SwaggerModule.createDocument(app, new DocumentBuilder()
    .setTitle('AI 数智化学习平台 API')
    .setDescription('学生端、管理后台与《题盒》适配层的统一接口')
    .setVersion('1.0')
    .addBearerAuth()
    .build())
  SwaggerModule.setup('api/docs', app, document, { jsonDocumentUrl: 'api/docs-json' })

  await app.listen(Number(config.get('PORT') || 3000), '0.0.0.0')
}

void bootstrap().catch((error: unknown) => { console.error(error instanceof Error ? error.message : '服务启动失败'); process.exitCode = 1 })
