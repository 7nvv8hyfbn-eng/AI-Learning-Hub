import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common'
import { ConfigModule } from '@nestjs/config'
import { AppController } from './app.controller'
import { RequestIdMiddleware } from './common/request-id.middleware'
import { PrismaModule } from './prisma/prisma.module'
import { AuthModule } from './modules/auth/auth.module'
import { BehaviorModule } from './modules/behavior/behavior.module'
import { StorageModule } from './modules/storage/storage.module'
import { QuizBoxModule } from './integrations/quiz-box/quiz-box.module'
import { OperationLogInterceptor } from './common/operation-log.interceptor'
import { DashboardModule } from './modules/dashboard/dashboard.module'
import { SettingsModule } from './modules/settings/settings.module'
import { ThemeModule } from './modules/themes/theme.module'
import { CourseModule } from './modules/courses/course.module'
import { LabModule } from './modules/labs/lab.module'
import { ResourceModule } from './modules/resources/resource.module'
import { ArticleModule } from './modules/articles/article.module'
import { ChallengeModule } from './modules/challenges/challenge.module'
import { HomepageModule } from './modules/homepage/homepage.module'
import { QuestionModule } from './modules/questions/question.module'
import { GrowthModule } from './modules/growth/growth.module'
import { CommunityModule } from './modules/community/community.module'
import { UsersModule } from './modules/users/users.module'
import { PersistenceModule } from './modules/persistence/persistence.module'
import { MediaModule } from './modules/media/media.module'
import { AssistantModule } from './modules/assistant/assistant.module'

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
    AuthModule,
    BehaviorModule,
    ThemeModule,
    CourseModule,
    LabModule,
    ResourceModule,
    ArticleModule,
    ChallengeModule,
    HomepageModule,
    QuestionModule,
    GrowthModule,
    DashboardModule,
    SettingsModule,
    StorageModule,
    QuizBoxModule,
    CommunityModule,
    UsersModule,
    PersistenceModule,
    MediaModule,
    AssistantModule,
  ],
  controllers: [AppController],
  providers: [OperationLogInterceptor],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(RequestIdMiddleware).forRoutes('*')
  }
}
