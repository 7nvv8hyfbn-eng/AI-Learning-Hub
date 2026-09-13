import { assertContentReady } from './modules/project-content/bundle'
import { PrismaService } from './prisma/prisma.service'
import 'reflect-metadata'
import { NestFactory } from '@nestjs/core'
import { ConfigService } from '@nestjs/config'
import { ConsoleLogger, ServiceUnavailableException } from '@nestjs/common'
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
import { browserBoundary, csv, DeploymentPreflightError, production, validateDeployment } from './common/deployment-security'

async function bootstrap() {
  // 容器依赖初始化错误可能包含数据库凭据，启动阶段只输出下方受控错误。
  const app = await NestFactory.create(AppModule, { logger: false, abortOnError: false })
  const config = app.get(ConfigService)
  app.enableShutdownHooks()
  validateDeployment(config)
  await app.get(PersistenceService).preflight()
  await assertContentReady(app.get(PrismaService))
  const trustedProxies = csv(config.get('TRUSTED_PROXY_CIDRS'))
  if (trustedProxies.length) app.getHttpAdapter().getInstance().set('trust proxy', trustedProxies)
  const origins = (config.get<string>('CORS_ORIGINS') || '').split(',').map((item) => item.trim()).filter(Boolean)
  if (!origins.length) throw new Error('CORS_ORIGINS 不能为空')

  app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }))
  app.use(cookieParser())
  app.use(browserBoundary(config))
  app.enableCors({ origin: origins, credentials: true, methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] })
  app.setGlobalPrefix('api/v1')
  app.useGlobalPipes(appValidationPipe)
  app.useGlobalFilters(new ApiExceptionFilter())
  app.useGlobalInterceptors(app.get(OperationLogInterceptor), new ApiResponseInterceptor(app.get(Reflector)))

  if (!production(config) && config.get('SWAGGER_ENABLED') === 'true') {
    const document = SwaggerModule.createDocument(app, new DocumentBuilder()
    .setTitle('AI 数智化学习平台 API')
    .setDescription('学生端、管理后台与《题盒》适配层的统一接口')
    .setVersion('1.0')
    .addBearerAuth()
    .build())
    SwaggerModule.setup('api/docs', app, document, { jsonDocumentUrl: 'api/docs-json' })
  }

  await app.listen(Number(config.get('PORT') || 3000), '0.0.0.0')
  app.useLogger(new ConsoleLogger())
}

void bootstrap().catch((error: unknown) => {
  console.error(error instanceof DeploymentPreflightError || error instanceof ServiceUnavailableException ? error.message : '服务启动失败，请核对部署预检、数据库连接及存储配置（原始异常已脱敏）')
  process.exit(1)
})
