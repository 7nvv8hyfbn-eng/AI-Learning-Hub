import { Injectable, Logger } from '@nestjs/common'
import { Prisma } from '@prisma/client'
import { PrismaService } from '../../prisma/prisma.service'

export type AchievementRule =
  | { type: 'event_count'; event: string; threshold: number }
  | { type: 'points'; threshold: number }
  | { type: 'streak'; days: number }
  | { type: 'lab_complete'; threshold: number }
  | { type: 'lesson_complete'; threshold: number }
  | { type: 'assessment_pass'; threshold: number }

/** 社区行为积分：事件类型 → 分值与每日计分事件数上限（无上限不限次） */
export const communityPointRules: Record<string, { points: number; dailyEvents?: number }> = {
  community_post_publish: { points: 5, dailyEvents: 3 },
  community_comment_create: { points: 2, dailyEvents: 5 },
  answer_accepted: { points: 10 },
  community_useful_add: { points: 2, dailyEvents: 5 },
}

interface RuleEvaluation { passed: boolean; current: number; target: number; key: string }
type ProgressSnapshot = {
  eventCounts: Record<string, number>
  points: number
  streakDays: number
  labs: number
  lessons: number
  assessments: number
}

@Injectable()
export class GrowthService {
  private readonly logger = new Logger(GrowthService.name)
  constructor(private readonly prisma: PrismaService) {}

  /** 事务内发放社区行为积分：reference 唯一约束幂等，每日按已计分事件数限流；返回实际记入分值 */
  async award(tx: Prisma.TransactionClient, userId: string, eventType: string, reference: string): Promise<number> {
    const rule = communityPointRules[eventType]
    if (!rule) return 0
    if (rule.dailyEvents) {
      const dayStart = new Date()
      dayStart.setHours(0, 0, 0, 0)
      const scored = await tx.growthPoint.count({ where: { userId, eventType, points: { gt: 0 }, createdAt: { gte: dayStart } } })
      if (scored >= rule.dailyEvents) return 0
    }
    try {
      const row = await tx.growthPoint.upsert({
        where: { userId_eventType_reference: { userId, eventType, reference } },
        update: {},
        create: { userId, eventType, points: rule.points, reference },
      })
      return row.points
    } catch {
      return 0
    }
  }

  /** 内容删除回滚：前缀命中的计分流水清零，防止“刷分即删” */
  async rollbackContent(tx: Prisma.TransactionClient, prefixes: string[]) {
    for (const prefix of prefixes) {
      await tx.growthPoint.updateMany({ where: { reference: { startsWith: prefix }, points: { gt: 0 } }, data: { points: 0 } })
    }
  }

  private async progressSnapshot(userId: string): Promise<ProgressSnapshot> {
    const [eventGroups, points, labs, lessons, assessments, views] = await Promise.all([
      this.prisma.activityEvent.groupBy({ by: ['eventType'], where: { userId }, _count: { eventType: true } }),
      this.prisma.growthPoint.aggregate({ where: { userId }, _sum: { points: true } }),
      this.prisma.labRun.findMany({ where: { userId, status: 'submitted' }, select: { labId: true }, distinct: ['labId'] }),
      this.prisma.lessonProgress.count({ where: { userId, completedAt: { not: null } } }),
      this.prisma.growthPoint.count({ where: { userId, eventType: 'assessment_pass', points: { gt: 0 } } }),
      this.prisma.activityEvent.findMany({ where: { userId, eventType: 'view' }, select: { occurredAt: true }, orderBy: { occurredAt: 'desc' } }),
    ])
    const days = new Set(views.map((row) => row.occurredAt.toISOString().slice(0, 10)))
    let streakDays = 0
    const cursor = new Date()
    if (!days.has(cursor.toISOString().slice(0, 10))) cursor.setDate(cursor.getDate() - 1)
    while (days.has(cursor.toISOString().slice(0, 10))) {
      streakDays++
      cursor.setDate(cursor.getDate() - 1)
    }
    const eventCounts: Record<string, number> = {}
    for (const group of eventGroups) eventCounts[group.eventType] = group._count.eventType
    return { eventCounts, points: points._sum.points || 0, streakDays, labs: labs.length, lessons, assessments }
  }

  private evaluate(rule: unknown, snapshot: ProgressSnapshot): RuleEvaluation | null {
    if (!rule || typeof rule !== 'object') return null
    const config = rule as Record<string, unknown>
    const threshold = typeof config.threshold === 'number' && config.threshold > 0 ? config.threshold : null
    const days = typeof config.days === 'number' && config.days > 0 ? config.days : null
    switch (config.type) {
      case 'event_count': {
        if (typeof config.event !== 'string' || !config.event || !threshold) return null
        const current = snapshot.eventCounts[config.event] || 0
        return { passed: current >= threshold, current, target: threshold, key: config.event }
      }
      case 'points':
        if (!threshold) return null
        return { passed: snapshot.points >= threshold, current: snapshot.points, target: threshold, key: 'points' }
      case 'streak':
        if (!days) return null
        return { passed: snapshot.streakDays >= days, current: snapshot.streakDays, target: days, key: 'streak' }
      case 'lab_complete':
        if (!threshold) return null
        return { passed: snapshot.labs >= threshold, current: snapshot.labs, target: threshold, key: 'lab_complete' }
      case 'lesson_complete':
        if (!threshold) return null
        return { passed: snapshot.lessons >= threshold, current: snapshot.lessons, target: threshold, key: 'lesson_complete' }
      case 'assessment_pass':
        if (!threshold) return null
        return { passed: snapshot.assessments >= threshold, current: snapshot.assessments, target: threshold, key: 'assessment_pass' }
      default:
        return null
    }
  }

  /** 成就解锁引擎：对未解锁成就按规则求值，达标即落库并发通知；返回本次新解锁列表 */
  async checkAchievements(userId: string) {
    const [achievements, owned] = await Promise.all([
      this.prisma.achievement.findMany({ where: { enabled: true } }),
      this.prisma.userAchievement.findMany({ where: { userId }, select: { achievementId: true } }),
    ])
    const ownedIds = new Set(owned.map((row) => row.achievementId))
    const pending = achievements.filter((row) => !ownedIds.has(row.id))
    if (!pending.length) return []
    const snapshot = await this.progressSnapshot(userId)
    const creations: Prisma.UserAchievementCreateManyInput[] = []
    const unlocked: Array<{ code: string; name: string; description: string }> = []
    for (const achievement of pending) {
      const evaluation = this.evaluate(achievement.rule, snapshot)
      if (!evaluation?.passed) continue
      creations.push({
        userId,
        achievementId: achievement.id,
        awardedAt: new Date(),
        evidence: { [evaluation.key]: evaluation.current, checkedAt: new Date().toISOString(), rule: achievement.rule as Prisma.InputJsonObject },
      })
      unlocked.push({ code: achievement.code, name: achievement.name, description: achievement.description })
    }
    if (!creations.length) return []
    await this.prisma.userAchievement.createMany({ data: creations, skipDuplicates: true })
    for (const item of unlocked) await this.notifyUnlock(userId, item)
    return unlocked
  }

  private async notifyUnlock(userId: string, item: { code: string; name: string; description: string }) {
    try {
      await this.prisma.userNotification.create({
        data: {
          recipientId: userId,
          notificationType: 'official',
          entityType: 'achievement',
          entityId: item.code,
          dedupeKey: `${userId}:achievement:${item.code}`,
          payload: { name: item.name, description: item.description },
        },
      })
    } catch (cause) {
      this.logger.warn(`成就通知写入失败：${item.code} ${cause instanceof Error ? cause.message : ''}`)
    }
  }

  /** 学生端成就目录：含解锁状态与实时进度，未知规则不下发（不给假数据） */
  async studentAchievements(userId: string) {
    const [rows, owned] = await Promise.all([
      this.prisma.achievement.findMany({ where: { enabled: true }, orderBy: [{ code: 'asc' }], include: { _count: { select: { users: true } } } }),
      this.prisma.userAchievement.findMany({ where: { userId }, select: { achievementId: true, awardedAt: true } }),
    ])
    const ownedMap = new Map(owned.map((row) => [row.achievementId, row.awardedAt]))
    const snapshot = await this.progressSnapshot(userId)
    const items = []
    for (const row of rows) {
      const evaluation = this.evaluate(row.rule, snapshot)
      if (!evaluation) continue
      const unlockedAt = ownedMap.get(row.id)
      items.push({
        code: row.code,
        name: row.name,
        description: row.description,
        rule: row.rule,
        earnerCount: row._count.users,
        unlocked: !!unlockedAt,
        unlockedAt: unlockedAt?.toISOString() || null,
        progress: { current: evaluation.current, target: evaluation.target },
      })
    }
    return { items }
  }
}
