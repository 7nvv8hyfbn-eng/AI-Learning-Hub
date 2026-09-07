import { Body, Controller, Delete, Get, Headers, NotFoundException, Param, Patch, Post, Put, Sse, UseGuards } from '@nestjs/common'
import { from, mergeMap, of, switchMap, timer, type Observable } from 'rxjs'
import { RawResponse } from '../../common/raw-response.decorator'
import { PrismaService } from '../../prisma/prisma.service'
import { AuthGuard } from '../auth/auth.guard'
import { CurrentUser } from '../auth/current-user.decorator'
import { Permissions } from '../auth/permissions.decorator'
import { PermissionsGuard } from '../auth/permissions.guard'
import type { AuthUser } from '../auth/auth.types'
import { BehaviorService } from './behavior.service'
import { GrowthService } from '../growth/growth.service'
import { CreatePlanDto, FavoriteDto, LabActionDto, LessonProgressDto, NoteDto, SubmitAssessmentDto, UpdatePlanDto, ViewEventDto } from './behavior.dto'

@Controller()
@UseGuards(AuthGuard)
export class BehaviorController {
  constructor(private readonly behavior: BehaviorService, private readonly prisma: PrismaService, private readonly growthEngine: GrowthService) {}

  @Get('me/achievements')
  achievements(@CurrentUser() user: AuthUser) {
    return this.growthEngine.studentAchievements(user.id)
  }

  @Post('courses/:courseId/enroll')
  async enroll(@CurrentUser() user: AuthUser, @Param('courseId') courseId: string) {
    const course = await this.prisma.course.findFirst({ where: { OR: [{ id: courseId }, { slug: courseId }], status: 'published' } })
    if (!course) return { enrolled: false }
    await this.prisma.activityEvent.create({ data: { userId: user.id, eventType: 'course_enroll', targetType: 'course', targetId: course.id } })
    return { enrolled: true, courseId: course.id }
  }

  @Put('courses/:courseId/note')
  courseNote(@CurrentUser() user: AuthUser, @Param('courseId') courseId: string, @Body() input: NoteDto) {
    return this.behavior.saveCourseNote(user.id, courseId, input.content)
  }

  @Put('lessons/:lessonId/progress')
  progress(@CurrentUser() user: AuthUser, @Param('lessonId') lessonId: string, @Body() input: LessonProgressDto) {
    return this.behavior.setProgress(user.id, lessonId, input.completed, input.positionSeconds)
  }

  @Put('lessons/:lessonId/note')
  note(@CurrentUser() user: AuthUser, @Param('lessonId') lessonId: string, @Body() input: NoteDto) {
    return this.behavior.saveNote(user.id, lessonId, input.content)
  }

  @Get('me/progress')
  progressList(@CurrentUser() user: AuthUser) {
    return this.prisma.lessonProgress.findMany({ where: { userId: user.id }, orderBy: { updatedAt: 'desc' } })
  }

  @Get('me/courses')
  courses(@CurrentUser() user: AuthUser) {
    return this.prisma.lessonProgress.findMany({
      where: { userId: user.id },
      distinct: ['courseId'],
      orderBy: { updatedAt: 'desc' },
      include: { course: { select: { id: true, slug: true, title: true, summary: true, status: true } } },
    })
  }

  @Get('me/notes')
  notes(@CurrentUser() user: AuthUser) {
    return this.prisma.learningNote.findMany({ where: { userId: user.id }, orderBy: { updatedAt: 'desc' } })
  }

  @Post('labs/:labId/runs')
  startLab(@CurrentUser() user: AuthUser, @Param('labId') labId: string) {
    return this.behavior.startLab(user.id, labId)
  }

  @Get('labs/:labId/my-active-run')
  async activeRun(@CurrentUser() user: AuthUser, @Param('labId') labId: string) {
    const lab = await this.prisma.lab.findFirst({ where: { OR: [{ id: labId }, { slug: labId }], status: 'published' } })
    if (!lab) throw new NotFoundException('实训不存在')
    return this.prisma.labRun.findFirst({
      where: { userId: user.id, labId: lab.id, status: { in: ['ready', 'running'] } },
      include: { events: { orderBy: { sequence: 'asc' } } },
      orderBy: { startedAt: 'desc' },
    })
  }

  @Get('lab-runs/:runId')
  run(@CurrentUser() user: AuthUser, @Param('runId') runId: string) {
    return this.prisma.labRun.findFirst({ where: { id: runId, userId: user.id }, include: { events: { orderBy: { sequence: 'asc' } } } })
  }

  @Post('lab-runs/:runId/actions')
  action(@CurrentUser() user: AuthUser, @Param('runId') runId: string, @Body() input: LabActionDto) {
    return this.behavior.actOnLab(user.id, runId, input)
  }

  @Post('lab-runs/:runId/submit')
  submitLab(@CurrentUser() user: AuthUser, @Param('runId') runId: string) {
    return this.behavior.submitLab(user.id, runId)
  }

  @Sse('lab-runs/:runId/events')
  @RawResponse()
  async events(@CurrentUser() user: AuthUser, @Param('runId') runId: string): Promise<Observable<MessageEvent>> {
    const run = await this.prisma.labRun.findFirst({ where: { id: runId, userId: user.id }, select: { id: true } })
    if (!run) throw new NotFoundException('实训运行不存在')
    let lastSequence = 0
    let heartbeatSequence = 0
    return timer(0, 3000).pipe(
      switchMap(() => from(this.prisma.labRunEvent.findMany({
        where: { runId, sequence: { gt: lastSequence } },
        orderBy: { sequence: 'asc' },
      }))),
      mergeMap((events) => {
        if (!events.length) {
          heartbeatSequence += 1
          return of({ data: { type: 'heartbeat', sequence: heartbeatSequence, runId, timestamp: new Date().toISOString() } } as MessageEvent)
        }
        lastSequence = events.at(-1)?.sequence || lastSequence
        return from(events.map((event) => ({
          data: {
            type: event.type,
            sequence: event.sequence,
            step: event.step,
            message: event.message,
            timestamp: event.createdAt.toISOString(),
          },
        }) as MessageEvent))
      }),
    )
  }

  @Post('favorites')
  favorite(@CurrentUser() user: AuthUser, @Body() input: FavoriteDto) {
    return this.prisma.favorite.upsert({
      where: { userId_targetType_targetId: { userId: user.id, targetType: input.targetType, targetId: input.targetId } },
      update: {},
      create: { userId: user.id, targetType: input.targetType, targetId: input.targetId },
    })
  }

  @Post('events/view')
  view(@CurrentUser() user: AuthUser, @Body() input: ViewEventDto) {
    return this.behavior.recordView(user.id, input.targetType, input.targetSlug)
  }

  @Delete('favorites/:targetType/:targetId')
  unfavorite(@CurrentUser() user: AuthUser, @Param('targetType') targetType: any, @Param('targetId') targetId: string) {
    return this.prisma.favorite.deleteMany({ where: { userId: user.id, targetType, targetId } })
  }

  @Get('me/favorites')
  favorites(@CurrentUser() user: AuthUser) {
    return this.prisma.favorite.findMany({ where: { userId: user.id }, orderBy: { createdAt: 'desc' } })
  }

  @Get('me/growth')
  async growth(@CurrentUser() user: AuthUser) {
    const [points, progress, notes, labs, attempts, plans, favorites, achievements, certificates, knowledgeStats] = await this.prisma.$transaction([
      this.prisma.growthPoint.aggregate({ where: { userId: user.id }, _sum: { points: true } }),
      this.prisma.lessonProgress.findMany({
        where: { userId: user.id },
        include: { course: { select: { id: true, slug: true, publishedVersionId: true } } },
      }),
      this.prisma.learningNote.findMany({ where: { userId: user.id }, include: { course: { select: { slug: true } } } }),
      this.prisma.labRun.findMany({ where: { userId: user.id }, include: { lab: { select: { slug: true } } }, orderBy: { startedAt: 'desc' }, take: 20 }),
      this.prisma.assessmentAttempt.findMany({ where: { userId: user.id }, orderBy: { submittedAt: 'desc' }, take: 20 }),
      this.prisma.learningPlan.findMany({ where: { userId: user.id }, orderBy: { createdAt: 'desc' } }),
      this.prisma.favorite.findMany({ where: { userId: user.id }, orderBy: { createdAt: 'desc' } }),
      this.prisma.userAchievement.findMany({ where: { userId: user.id }, include: { achievement: true } }),
      this.prisma.userCertificate.findMany({ where: { userId: user.id }, include: { certificate: true } }),
      this.prisma.userKnowledgeStat.findMany({ where: { userId: user.id } }),
    ])
    const courseGroups = new Map<string, typeof progress>()
    for (const item of progress) courseGroups.set(item.courseId, [...(courseGroups.get(item.courseId) || []), item])
    const courseProgress = await Promise.all([...courseGroups.values()].map(async (items) => {
      const course = items[0].course
      const total = course.publishedVersionId
        ? await this.prisma.courseLesson.count({ where: { chapter: { courseVersionId: course.publishedVersionId } } })
        : 0
      const completed = items.filter((item) => item.completedAt).length
      return {
        course: { slug: course.slug },
        completedLessons: completed,
        totalLessons: total,
        progress: total ? Math.round((completed / total) * 100) : 0,
        updatedAt: items.reduce((latest, item) => item.updatedAt > latest ? item.updatedAt : latest, items[0].updatedAt),
      }
    }))
    return { points: points._sum.points || 0, courseProgress, notes, labRuns: labs, assessmentAttempts: attempts, plans, favorites, achievements, certificates, knowledgeStats }
  }

  @Get('me/learning-plans')
  plans(@CurrentUser() user: AuthUser) {
    return this.prisma.learningPlan.findMany({ where: { userId: user.id }, orderBy: { createdAt: 'desc' } })
  }

  @Get('me/notifications')
  async notifications(@CurrentUser() user: AuthUser) {
    const notifications = await this.prisma.notification.findMany({
      where: {
        status: 'published',
        OR: [{ audience: 'all' }, { audience: `user:${user.id}` }],
      },
      include: { reads: { where: { userId: user.id }, select: { readAt: true } } },
      orderBy: { publishedAt: 'desc' },
      take: 50,
    })
    return notifications.map((item) => ({ ...item, readAt: item.reads[0]?.readAt || null, reads: undefined }))
  }

  @Post('me/notifications/:id/read')
  readNotification(@CurrentUser() user: AuthUser, @Param('id') notificationId: string) {
    return this.prisma.notificationRead.upsert({
      where: { notificationId_userId: { notificationId, userId: user.id } },
      update: { readAt: new Date() },
      create: { notificationId, userId: user.id },
    })
  }

  @Post('me/learning-plans')
  createPlan(@CurrentUser() user: AuthUser, @Body() input: CreatePlanDto) {
    return this.prisma.learningPlan.create({ data: { userId: user.id, title: input.title, startDate: new Date(), targetDate: new Date(input.targetDate) } })
  }

  @Patch('me/learning-plans/:id')
  updatePlan(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() input: UpdatePlanDto) {
    return this.prisma.learningPlan.update({ where: { id, userId: user.id }, data: input })
  }

  @Get('challenges/:slug/questions')
  questions(@Param('slug') slug: string) { return this.behavior.challengeQuestions(slug) }

  @Post('challenges/:slug/submit')
  assessment(@CurrentUser() user: AuthUser, @Param('slug') slug: string, @Body() input: SubmitAssessmentDto, @Headers('idempotency-key') key?: string) {
    return this.behavior.submitAssessment(user.id, slug, input, key)
  }

  @Get('challenges/:slug/ranking')
  async ranking(@Param('slug') slug: string) {
    const challenge = await this.prisma.challenge.findFirst({ where: { slug, status: 'published' } })
    if (!challenge) return []
    const rows = await this.prisma.challengeBestScore.findMany({
      where: { challengeId: challenge.id },
      include: { user: { select: { displayName: true } } },
      orderBy: [{ score: 'desc' }, { updatedAt: 'asc' }],
      take: 100,
    })
    return rows.map((item, index) => ({
      rank: index + 1,
      userId: item.userId,
      displayName: item.user.displayName,
      score: item.score,
    }))
  }
}

@Controller('admin/users')
@UseGuards(AuthGuard, PermissionsGuard)
@Permissions('growth.read')
export class AdminGrowthController {
  constructor(private readonly prisma: PrismaService) {}

  @Get(':id/growth')
  async growth(@Param('id') userId: string) {
    const [user, points, progress, runs, attempts, favorites, plans, achievements, certificates, knowledgeStats, wrongQuestions] = await this.prisma.$transaction([
      this.prisma.user.findUnique({ where: { id: userId }, select: { id: true, displayName: true, email: true, status: true, userType: true, school: true, department: true, profile: true } }),
      this.prisma.growthPoint.aggregate({ where: { userId }, _sum: { points: true } }),
      this.prisma.lessonProgress.findMany({ where: { userId } }),
      this.prisma.labRun.findMany({ where: { userId }, orderBy: { startedAt: 'desc' }, take: 20 }),
      this.prisma.assessmentAttempt.findMany({ where: { userId }, orderBy: { submittedAt: 'desc' }, take: 20 }),
      this.prisma.favorite.findMany({ where: { userId } }),
      this.prisma.learningPlan.findMany({ where: { userId } }),
      this.prisma.userAchievement.findMany({ where: { userId }, include: { achievement: true } }),
      this.prisma.userCertificate.findMany({ where: { userId }, include: { certificate: true } }),
      this.prisma.userKnowledgeStat.findMany({ where: { userId } }),
      this.prisma.wrongQuestion.findMany({ where: { userId, resolvedAt: null }, select: { id: true, questionId: true, updatedAt: true } }),
    ])
    return { user, points: points._sum.points || 0, progress, runs, attempts, favorites, plans, achievements, certificates, knowledgeStats, wrongQuestions }
  }
}
