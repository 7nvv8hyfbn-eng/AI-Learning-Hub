import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common'
import { LabRunStatus, Prisma } from '@prisma/client'
import { randomUUID } from 'node:crypto'
import { PrismaService } from '../../prisma/prisma.service'
import { readChallengeSnapshot } from '../challenges/challenge-version'
import type { LabActionDto, SubmitAssessmentDto } from './behavior.dto'
import { evaluateAnswer } from './assessment-evaluator'
import { SignalsService } from '../signals/signals.service'
import { GrowthService } from '../growth/growth.service'

type VersionedQuestion = Prisma.QuestionGetPayload<{ include: { publishedVersion: true } }>
const publishedQuestion = (question: VersionedQuestion) => {
  const snapshot = question.publishedVersion?.snapshot && typeof question.publishedVersion.snapshot === 'object' && !Array.isArray(question.publishedVersion.snapshot)
    ? question.publishedVersion.snapshot as Record<string, unknown>
    : {}
  return {
    ...question,
    stem: String(snapshot.stem || question.stem),
    options: (snapshot.options || question.options) as Prisma.JsonValue,
    standardAnswer: (snapshot.standardAnswer ?? question.standardAnswer) as Prisma.JsonValue,
    analysis: String(snapshot.analysis || question.analysis),
  }
}

@Injectable()
export class BehaviorService {
  constructor(private readonly prisma: PrismaService, private readonly signals: SignalsService, private readonly growth: GrowthService) {}

  async recordView(userId: string, targetType: 'resource' | 'article', targetSlug: string) {
    const target = targetType === 'resource'
      ? await this.prisma.resource.findFirst({ where: { slug: targetSlug, status: 'published', deletedAt: null }, select: { id: true } })
      : await this.prisma.article.findFirst({ where: { slug: targetSlug, status: 'published', deletedAt: null }, select: { id: true } })
    if (!target) throw new NotFoundException('内容不存在')
    const windowStart = new Date(Date.now() - 60 * 60 * 1000)
    const existing = await this.prisma.activityEvent.findFirst({
      where: { userId, eventType: 'view', targetType, targetId: target.id, createdAt: { gte: windowStart } },
      select: { id: true },
    })
    if (existing) return { counted: false }
    await this.prisma.$transaction(async (tx) => {
      await tx.activityEvent.create({ data: { userId, eventType: 'view', targetType, targetId: target.id } })
      if (targetType === 'resource') {
        await tx.resource.update({ where: { id: target.id }, data: { viewCount: { increment: 1 } } })
        await tx.resourceView.create({ data: { resourceId: target.id, userId } })
      } else {
        await tx.article.update({ where: { id: target.id }, data: { viewCount: { increment: 1 } } })
        await tx.articleView.create({ data: { articleId: target.id, userId } })
      }
    })
    return { counted: true }
  }

  async setProgress(userId: string, lessonId: string, completed: boolean, positionSeconds: number) {
    const lesson = await this.prisma.courseLesson.findUnique({
      where: { id: lessonId },
      include: { chapter: { include: { version: { include: { course: true } } } } },
    })
    if (!lesson) throw new NotFoundException('课时不存在')
    const courseId = lesson.chapter.version.courseId
    if (lesson.chapter.version.course.publishedVersionId !== lesson.chapter.version.id) {
      throw new BadRequestException('只能更新已发布课时进度')
    }
    return this.prisma.$transaction(async (tx) => {
      const previous = await tx.lessonProgress.findUnique({
        where: { userId_courseId_lessonId: { userId, courseId, lessonId } },
      })
      const record = await tx.lessonProgress.upsert({
        where: { userId_courseId_lessonId: { userId, courseId, lessonId } },
        update: { progress: completed ? 100 : 0, positionSeconds, completedAt: completed ? previous?.completedAt || new Date() : null },
        create: { userId, courseId, lessonId, progress: completed ? 100 : 0, positionSeconds, completedAt: completed ? new Date() : null },
      })
      await tx.activityEvent.create({
        data: {
          userId,
          eventType: completed ? 'lesson_complete' : 'lesson_progress',
          targetType: 'lesson',
          targetId: lessonId,
          payload: { completed, positionSeconds },
        },
      })
      await this.signals.learningConversion(tx, userId, 'course', courseId)
      if (completed && !previous?.completedAt) {
        await tx.growthPoint.upsert({
          where: { userId_eventType_reference: { userId, eventType: 'lesson_complete', reference: lessonId } },
          update: {},
          create: { userId, eventType: 'lesson_complete', points: 10, reference: lessonId },
        })
      }
      const total = await tx.courseLesson.count({ where: { chapter: { courseVersionId: lesson.chapter.version.id } } })
      const completedLessons = await tx.lessonProgress.count({
        where: {
          userId,
          completedAt: { not: null },
          lesson: { chapter: { courseVersionId: lesson.chapter.version.id } },
        },
      })
      if (total > 0 && completedLessons === total) await this.signals.achievementDraft(tx, userId, 'course', courseId, courseId)
      return {
        lessonId: record.lessonId,
        completed: !!record.completedAt,
        positionSeconds: record.positionSeconds,
        courseProgress: {
          courseId,
          completedLessons,
          totalLessons: total,
          percentage: total ? Math.round((completedLessons / total) * 100) : 0,
        },
      }
    })
    if (completed) void this.growth.checkAchievements(userId).catch(() => undefined)
  }

  async saveNote(userId: string, lessonId: string, content: string) {
    const lesson = await this.prisma.courseLesson.findUnique({ where: { id: lessonId }, include: { chapter: { include: { version: true } } } })
    if (!lesson) throw new NotFoundException('课时不存在')
    return this.prisma.learningNote.upsert({
      where: { userId_courseId_scopeKey: { userId, courseId: lesson.chapter.version.courseId, scopeKey: lessonId } },
      update: { content },
      create: { userId, courseId: lesson.chapter.version.courseId, lessonId, scopeKey: lessonId, content },
    })
  }

  async saveCourseNote(userId: string, courseIdOrSlug: string, content: string) {
    const course = await this.prisma.course.findFirst({ where: { OR: [{ id: courseIdOrSlug }, { slug: courseIdOrSlug }], status: 'published' } })
    if (!course) throw new NotFoundException('课程不存在')
    return this.prisma.learningNote.upsert({
      where: { userId_courseId_scopeKey: { userId, courseId: course.id, scopeKey: 'course' } },
      update: { content },
      create: { userId, courseId: course.id, scopeKey: 'course', content },
    })
  }

  async startLab(userId: string, labIdOrSlug: string) {
    const lab = await this.prisma.lab.findFirst({
      where: { OR: [{ id: labIdOrSlug }, { slug: labIdOrSlug }], status: 'published', deletedAt: null },
      include: { publishedVersion: true },
    })
    if (!lab?.publishedVersionId || !lab.publishedVersion) throw new NotFoundException('实训不存在或未发布')
    const publishedVersionNo = lab.publishedVersion.versionNo
    const active = await this.prisma.labRun.findFirst({
      where: { userId, labId: lab.id, status: { in: [LabRunStatus.ready, LabRunStatus.running] } },
      orderBy: { startedAt: 'desc' },
    })
    if (active) return active
    return this.prisma.$transaction(async (tx) => {
      const run = await tx.labRun.create({
        data: {
          userId,
          labId: lab.id,
          labVersion: publishedVersionNo,
          labVersionId: lab.publishedVersionId,
          status: LabRunStatus.ready,
        },
      })
      await tx.labRunEvent.create({ data: { runId: run.id, sequence: 1, type: 'log', step: 'ready', message: '受控实训环境已准备' } })
      await tx.labRunSnapshot.create({ data: { runId: run.id, sequence: 1, state: JSON.parse(JSON.stringify(run)) as Prisma.InputJsonValue } })
      await tx.activityEvent.create({ data: { userId, eventType: 'lab_start', targetType: 'lab', targetId: lab.id } })
      await this.signals.learningConversion(tx, userId, 'lab', lab.id)
      return run
    })
  }

  async actOnLab(userId: string, runId: string, input: LabActionDto) {
    const run = await this.prisma.labRun.findFirst({ where: { id: runId, userId }, include: { version: true } })
    if (!run) throw new NotFoundException('实训运行不存在')
    if (!run.version?.snapshot || typeof run.version.snapshot !== 'object' || Array.isArray(run.version.snapshot)) {
      throw new BadRequestException('实训发布版本不可用')
    }
    const snapshot = run.version.snapshot as Record<string, unknown>
    const steps = Array.isArray(snapshot.steps) ? snapshot.steps as Array<Record<string, unknown>> : []
    if (!steps.length) throw new BadRequestException('实训尚未配置步骤')
    if (run.status === LabRunStatus.success || run.status === LabRunStatus.submitted) throw new BadRequestException('实训已经完成')
    let state: Prisma.LabRunUpdateInput
    let message = ''
    if (input.action === 'stop') {
      state = { status: LabRunStatus.stopped }
      message = '实训已安全停止'
    } else if (input.action === 'reset') {
      state = { status: LabRunStatus.ready, currentStep: 0, progress: 0, score: 0, completedAt: null, result: {} }
      message = '实训已重置'
    } else if (input.action === 'run' && run.status === LabRunStatus.ready) {
      state = { status: LabRunStatus.running }
      message = '实训已开始'
    } else {
      if (run.status !== LabRunStatus.running) throw new BadRequestException('请先启动实训')
      const step = steps[run.currentStep]
      if (!step) throw new BadRequestException('当前步骤不存在')
      const instruction = step.instruction && typeof step.instruction === 'object' && !Array.isArray(step.instruction)
        ? step.instruction as Record<string, unknown>
        : {}
      const validator = step.validator && typeof step.validator === 'object' && !Array.isArray(step.validator)
        ? step.validator as Record<string, unknown>
        : {}
      const expectedAction = typeof instruction.action === 'string' ? instruction.action : 'confirm'
      if (input.action !== expectedAction && !(expectedAction === 'confirm' && input.action === 'submit_step')) {
        throw new BadRequestException(`当前步骤只允许动作：${expectedAction}`)
      }
      if (validator.field && validator.expected !== undefined && input.payload?.[String(validator.field)] !== validator.expected) {
        throw new BadRequestException('步骤校验未通过')
      }
      const nextStep = run.currentStep + 1
      const completed = nextStep >= steps.length
      const earnedScore = steps.slice(0, nextStep).reduce((total, item) => total + Number(item.score || 0), 0)
      state = {
        status: completed ? LabRunStatus.success : LabRunStatus.running,
        currentStep: nextStep,
        progress: Math.round((nextStep / steps.length) * 100),
        score: Math.min(100, earnedScore),
        ...(completed ? { completedAt: new Date(), result: { passed: true } } : {}),
      }
      message = completed ? '全部步骤校验通过' : `步骤 ${String(step.title || run.currentStep + 1)} 已完成`
    }
    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.labRun.update({
        where: { id: run.id },
        data: { ...state, nextEventSequence: { increment: 1 } },
      })
      const sequence = updated.nextEventSequence
      await tx.labRunEvent.create({ data: { runId, sequence, type: 'state', step: input.action, message } })
      await tx.labRunSnapshot.create({ data: { runId, sequence, state: JSON.parse(JSON.stringify(updated)) as Prisma.InputJsonValue } })
      return updated
    })
  }

  async submitLab(userId: string, runId: string) {
    const run = await this.prisma.labRun.findFirst({ where: { id: runId, userId } })
    if (!run || (run.status !== LabRunStatus.success && run.status !== LabRunStatus.submitted)) throw new BadRequestException('实训完成后才能提交')
    if (run.status === LabRunStatus.submitted) return run
    const updated = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.labRun.update({ where: { id: run.id }, data: { status: LabRunStatus.submitted, submittedAt: new Date() } })
      const eventCount = await tx.labRunEvent.count({ where: { runId } })
      await tx.labReport.upsert({
        where: { runId },
        update: { summary: { passed: true, score: updated.score, eventCount } },
        create: { runId, summary: { passed: true, score: updated.score, eventCount } },
      })
      await tx.growthPoint.upsert({
        where: { userId_eventType_reference: { userId, eventType: 'lab_submit', reference: runId } },
        update: {},
        create: { userId, eventType: 'lab_submit', points: Math.max(0, updated.score), reference: runId },
      })
      await tx.activityEvent.create({ data: { userId, eventType: 'lab_complete', targetType: 'lab', targetId: run.labId } })
      await this.signals.achievementDraft(tx, userId, 'lab', run.labId, runId)
      const achievement = await tx.achievement.findUnique({ where: { code: 'first-lab' } })
      if (achievement?.enabled) {
        await tx.userAchievement.upsert({
          where: { userId_achievementId: { userId, achievementId: achievement.id } },
          update: {},
          create: { userId, achievementId: achievement.id, evidence: { runId } },
        })
      }
      return updated
    })
    void this.growth.checkAchievements(userId).catch(() => undefined)
    return updated
  }

  async challengeQuestions(challengeSlug: string) {
    const challenge = await this.prisma.challenge.findFirst({
      where: { OR: [{ id: challengeSlug }, { slug: challengeSlug }], status: 'published' },
      include: { publishedVersion: true },
    })
    if (!challenge) throw new NotFoundException('挑战不存在')
    const published = readChallengeSnapshot(challenge.publishedVersion?.snapshot)
    if (!published.questionBankId && !published.paperId) return []
    const questions = published.paperId
      ? (await this.prisma.paperQuestion.findMany({
          where: { paperId: published.paperId, question: { status: 'published' } },
          orderBy: { sortOrder: 'asc' },
          include: { question: { include: { publishedVersion: true } } },
        })).map((item) => publishedQuestion(item.question))
      : (await this.prisma.question.findMany({
          where: { bankId: published.questionBankId!, status: 'published' },
          include: { publishedVersion: true },
        })).map(publishedQuestion)
    return questions.map((question) => ({
      id: question.id,
      questionType: question.questionType,
      difficulty: question.difficulty,
      stem: question.stem,
      options: question.options,
    }))
  }

  async submitAssessment(userId: string, challengeSlug: string, input: SubmitAssessmentDto, idempotencyKey?: string) {
    if (!idempotencyKey) throw new BadRequestException('提交测评必须提供 Idempotency-Key')
    const challenge = await this.prisma.challenge.findFirst({
      where: { OR: [{ id: challengeSlug }, { slug: challengeSlug }], status: 'published' },
      include: { publishedVersion: true },
    })
    if (!challenge) throw new NotFoundException('挑战不存在')
    const published = readChallengeSnapshot(challenge.publishedVersion?.snapshot)
    const scope = `assessment:${userId}:${challenge.id}`
    const cached = await this.prisma.idempotencyKey.findUnique({ where: { scope_key: { scope, key: idempotencyKey } } })
    if (cached && cached.expiresAt > new Date()) return cached.response
    if (!published.questionBankId && !published.paperId) throw new BadRequestException('当前挑战尚未关联题库或试卷')
    const questions = published.paperId
      ? (await this.prisma.paperQuestion.findMany({
          where: { paperId: published.paperId, question: { status: 'published' } },
          orderBy: { sortOrder: 'asc' },
          include: { question: { include: { publishedVersion: true } } },
        })).map((item) => publishedQuestion(item.question))
      : (await this.prisma.question.findMany({ where: { bankId: published.questionBankId!, status: 'published' }, include: { publishedVersion: true } })).map(publishedQuestion)
    if (!questions.length) throw new BadRequestException('当前挑战尚未配置题目')
    if (questions.some((question) => !question.knowledgePointId)) throw new BadRequestException('题目尚未关联知识点')
    const answers = new Map(input.answers.map((item) => [item.questionId, item.answer]))
    const correct = questions.filter((question) => evaluateAnswer(question.questionType, answers.get(question.id), question.standardAnswer)).length
    const score = Math.round((correct / questions.length) * 100)
    const result = { challengeId: challenge.id, score, correct, total: questions.length, passed: score >= (published.targetScore ?? challenge.targetScore) }
    return this.prisma.$transaction(async (tx) => {
      const attempt = await tx.assessmentAttempt.create({ data: { userId, challengeId: challenge.id, score, answers: input.answers as unknown as Prisma.InputJsonValue } })
      for (const question of questions) {
        const answer = answers.get(question.id) ?? null
        const isCorrect = evaluateAnswer(question.questionType, answer, question.standardAnswer)
        await tx.assessmentAnswer.create({
          data: { attemptId: attempt.id, userId, questionId: question.id, answer: answer as Prisma.InputJsonValue, correct: isCorrect },
        })
        if (isCorrect) {
          await tx.wrongQuestion.deleteMany({ where: { userId, questionId: question.id } })
        } else {
          await tx.wrongQuestion.upsert({
            where: { userId_questionId: { userId, questionId: question.id } },
            update: { attemptId: attempt.id, answer: answer as Prisma.InputJsonValue, resolvedAt: null },
            create: { userId, questionId: question.id, attemptId: attempt.id, answer: answer as Prisma.InputJsonValue },
          })
        }
        const stat = await tx.userKnowledgeStat.upsert({
          where: { userId_knowledgePointId: { userId, knowledgePointId: question.knowledgePointId! } },
          update: { total: { increment: 1 }, correct: { increment: isCorrect ? 1 : 0 } },
          create: { userId, knowledgePointId: question.knowledgePointId!, total: 1, correct: isCorrect ? 1 : 0, accuracy: isCorrect ? 100 : 0 },
        })
        await tx.userKnowledgeStat.update({
          where: { id: stat.id },
          data: { accuracy: Math.round((stat.correct / stat.total) * 100) },
        })
      }
      await tx.activityEvent.create({ data: { userId, eventType: 'assessment_submit', targetType: 'challenge', targetId: challenge.id, payload: { score } } })
      await this.signals.achievementDraft(tx, userId, 'challenge', challenge.id, attempt.id)
      const previousBest = await tx.challengeBestScore.findUnique({ where: { userId_challengeId: { userId, challengeId: challenge.id } } })
      if (!previousBest || score > previousBest.score) {
        await tx.challengeBestScore.upsert({
          where: { userId_challengeId: { userId, challengeId: challenge.id } },
          update: { score, attemptId: attempt.id },
          create: { userId, challengeId: challenge.id, score, attemptId: attempt.id },
        })
      }
      const rewardPoints = published.rewardPoints ?? challenge.rewardPoints
      if (result.passed && rewardPoints > 0) {
        await tx.growthPoint.upsert({
          where: { userId_eventType_reference: { userId, eventType: 'assessment_pass', reference: challenge.id } },
          update: {},
          create: { userId, eventType: 'assessment_pass', points: rewardPoints, reference: challenge.id },
        })
      }
      const ruleConfig = Object.fromEntries(published.rules.map((rule) => [rule.ruleKey, rule.config])) as Record<string, unknown>
      const achievementCode = typeof ruleConfig.achievement === 'string' ? ruleConfig.achievement : null
      const achievement = achievementCode ? await tx.achievement.findUnique({ where: { code: achievementCode } }) : null
      if (achievement?.enabled) {
        await tx.userAchievement.upsert({
          where: { userId_achievementId: { userId, achievementId: achievement.id } },
          update: {},
          create: { userId, achievementId: achievement.id, evidence: { attemptId: attempt.id } },
        })
      }
      if (result.passed) {
        const certificateCode = typeof ruleConfig.certificate === 'string' ? ruleConfig.certificate : null
        const certificate = certificateCode ? await tx.certificate.findUnique({ where: { code: certificateCode } }) : null
        if (certificate?.enabled) {
          await tx.userCertificate.upsert({
            where: { userId_certificateId: { userId, certificateId: certificate.id } },
            update: { evidence: { attemptId: attempt.id, score } },
            create: { userId, certificateId: certificate.id, serialNo: `ALH-${randomUUID()}`, evidence: { attemptId: attempt.id, score } },
          })
        }
      }
      await tx.idempotencyKey.upsert({
        where: { scope_key: { scope, key: idempotencyKey } },
        update: { response: result, expiresAt: new Date(Date.now() + 86_400_000) },
        create: { key: idempotencyKey, scope, response: result, expiresAt: new Date(Date.now() + 86_400_000) },
      })
      return result
    })
    if (result.passed) void this.growth.checkAchievements(userId).catch(() => undefined)
    return result
  }
}
