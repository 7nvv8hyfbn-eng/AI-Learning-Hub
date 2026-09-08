import { BadRequestException, ConflictException, HttpException } from '@nestjs/common'
import { createHash, randomUUID } from 'node:crypto'
import { Prisma } from '@prisma/client'
import type { PrismaClient } from '@prisma/client'

export const digest = (value: string) => createHash('sha256').update(value).digest('hex')
export async function lockUser(tx: Prisma.TransactionClient, id: string) {
  // 会话与安全状态串行，但不阻塞关联事件的外键 KEY SHARE。
  await tx.$queryRaw`SELECT id FROM users WHERE id = ${id} FOR NO KEY UPDATE`
}
export async function lockFileReferences(tx: Prisma.TransactionClient) {
  // ponytail: JSON 引用用全局短事务锁；写入量增大后再细化到逐文件锁。
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended('file-references', 0))::text`
}
/** JSON 内容块没有外键；与写入共用事务锁，保守检查所有业务字段及历史快照。 */
export async function fileReferenced(tx: Prisma.TransactionClient, id: string) {
  for (const model of Prisma.dmmf.datamodel.models) {
    // 清理队列是失败重试凭据，不是业务引用；旧审计与所有版本仍参与保护。
    if (['FileRecord', 'MediaGcJob'].includes(model.name)) continue
    const fields = model.fields.filter((field) => field.kind === 'scalar' && ['String', 'Json'].includes(field.type) && !field.isId)
    if (!fields.length) continue
    const table = Prisma.raw(`"${model.dbName || model.name}"`)
    const conditions = fields.map((field) => Prisma.sql`${Prisma.raw(`"${field.dbName || field.name}"`)}::text LIKE ${`%${id.replace(/[%_\\]/g, '\\$&')}%`}`)
    const active = model.name === 'RequestIdempotency' ? Prisma.sql`expires_at > NOW() AND` : Prisma.empty
    const rows = await tx.$queryRaw<Array<{ found: boolean }>>(Prisma.sql`SELECT EXISTS(SELECT 1 FROM ${table} WHERE ${active} (${Prisma.join(conditions, ' OR ')})) AS found`)
    if (rows[0].found) return true
  }
  return false
}
const canonical = (value: unknown): string => JSON.stringify(value, (_, item: unknown) => item && typeof item === 'object' && !Array.isArray(item) ? Object.fromEntries(Object.entries(item).filter(([, v]) => v !== undefined).sort(([a], [b]) => a.localeCompare(b))) : item)

/** 跟业务共用事务；事务锁保证多个 API 实例之间同一键只执行一次。不存令牌或用户资料。 */
export async function idempotency(tx: Prisma.TransactionClient, principal: string, scope: string, key: string | undefined, input: unknown) {
  if (!key) return { resourceId: null, complete: async (_id: string) => {} }
  if (!/^[A-Za-z0-9:._-]{8,128}$/.test(key)) throw new BadRequestException('Idempotency-Key 必须为8～128位安全字符')
  const principalKey = digest(principal), requestHash = digest(canonical(input))
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`${principalKey}:${scope}:${key}`}, 0))::text`
  const where = { principalKey_scope_idempotencyKey: { principalKey, scope, idempotencyKey: key } }
  const existing = await tx.requestIdempotency.findUnique({ where })
  if (existing && existing.expiresAt > new Date() && existing.requestHash !== requestHash) throw new ConflictException('同一幂等键不能用于不同内容')
  return {
    resourceId: existing && existing.expiresAt > new Date() ? existing.resourceId : null,
    complete: async (resourceId: string) => {
      const data = { requestHash, resourceId, expiresAt: new Date(Date.now() + 86400000) }
      await tx.requestIdempotency.upsert({ where, create: { principalKey, scope, idempotencyKey: key, ...data }, update: data })
    },
  }
}

/** 大文件不能占用长事务：先短事务占位，同键并发只允许一个执行，完成后再与业务写入一并落账。 */
export async function reserveIdempotency(client: Pick<PrismaClient, '$transaction'>, principal: string, scope: string, key: string | undefined, input: unknown) {
  if (!key) return { resourceId: null, complete: async (_tx: Prisma.TransactionClient, _id: string) => {}, cancel: async () => {} }
  if (!/^[A-Za-z0-9:._-]{8,128}$/.test(key)) throw new BadRequestException('Idempotency-Key 必须为8～128位安全字符')
  const principalKey = digest(principal), requestHash = digest(canonical(input)), expiresAt = new Date(Date.now() + 86400000)
  const where = { principalKey_scope_idempotencyKey: { principalKey, scope, idempotencyKey: key } }
  const resourceId = await client.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`${principalKey}:${scope}:${key}`}, 0))::text`
    const existing = await tx.requestIdempotency.findUnique({ where })
    if (existing && existing.expiresAt > new Date() && existing.requestHash !== requestHash) throw new ConflictException('同一幂等键不能用于不同内容')
    if (existing && existing.expiresAt > new Date() && existing.status === 'completed') return existing.resourceId
    if (existing && existing.expiresAt > new Date()) throw new ConflictException({ message: '相同请求正在处理中，请稍后查询结果', errorCode: 'REQUEST_IN_PROGRESS' })
    await tx.requestIdempotency.upsert({ where, create: { principalKey, scope, idempotencyKey: key, requestHash, resourceId: '', status: 'processing', expiresAt }, update: { requestHash, resourceId: '', status: 'processing', expiresAt } })
    return null
  })
  return {
    resourceId,
    complete: async (tx: Prisma.TransactionClient, id: string) => {
      if (!(await tx.requestIdempotency.updateMany({ where: { principalKey, scope, idempotencyKey: key, requestHash, status: 'processing' }, data: { resourceId: id, status: 'completed', expiresAt } })).count) throw new ConflictException('请求状态已变化，请查询结果')
    },
    cancel: async () => { await client.$transaction((tx) => tx.requestIdempotency.deleteMany({ where: { principalKey, scope, idempotencyKey: key, requestHash, status: 'processing' } })) },
  }
}

/** 沿用既有事件名称供推荐兼容；actionType 是统一对外语义，同一事实只写一行。 */
export const actionTypes: Record<string, string> = {
  student_register: 'user_registered', community_post_publish: 'post_published',
  community_comment_create: 'comment_created', community_reply_create: 'comment_created',
  community_like_add: 'post_liked', community_useful_add: 'post_marked_useful',
  community_bookmark_add: 'post_bookmarked', community_user_follow: 'user_followed',
  community_topic_follow: 'topic_followed', community_report: 'content_reported',
  community_feed_impression: 'post_impression', community_dwell: 'post_dwell',
  community_post_click: 'post_clicked', community_binding_click: 'binding_clicked',
}
export function actionEvent(tx: Prisma.TransactionClient, actorId: string, eventType: string, entityType: string, entityId: string, metadata: Prisma.InputJsonObject = {}, source = 'student-web') {
  return tx.activityEvent.create({ data: { userId: actorId, eventType, actionType: actionTypes[eventType] || eventType, eventKey: randomUUID(), entityType, entityId, targetType: entityType, targetId: entityId, payload: metadata, source } })
}
export async function rateLimit(tx: Prisma.TransactionClient, principal: string, scope: string, limit: number, windowMs = 60000, message = '操作过于频繁，请稍后再试', errorCode = 'RATE_LIMITED') {
  const key = digest(`${scope}:${principal}`)
  const rows = await tx.$queryRaw<Array<{ attempts: number; expires_at: Date; retry_after: number }>>`
    INSERT INTO registration_throttles(identity_key,attempts,expires_at) VALUES (${key},1,NOW()+(${windowMs}*INTERVAL '1 millisecond'))
    ON CONFLICT(identity_key) DO UPDATE SET
    attempts=CASE WHEN registration_throttles.expires_at<NOW() THEN 1 ELSE registration_throttles.attempts+1 END,
    expires_at=CASE WHEN registration_throttles.expires_at<NOW() THEN NOW()+(${windowMs}*INTERVAL '1 millisecond') ELSE registration_throttles.expires_at END
    RETURNING attempts,expires_at,GREATEST(1,CEIL(EXTRACT(EPOCH FROM (expires_at-NOW()))))::INTEGER AS retry_after`
  if (rows[0].attempts > limit) {
    const availableAt = new Date(rows[0].expires_at), retryAfter = rows[0].retry_after
    throw new HttpException({ message, errorCode, retryAfter, availableAt: availableAt.toISOString(), nextAction: null }, 429)
  }
}
export async function postRevision(tx: Prisma.TransactionClient, postId: string, editorId: string, editorType = 'user', reason = '') {
  const post = await tx.communityPost.findUniqueOrThrow({ where: { id: postId }, include: { bindings: true, topics: true } })
  await tx.communityPostRevision.createMany({ skipDuplicates: true, data: [{
    postId, revisionNo: post.revision, editorId, editorType, reason,
    titleSnapshot: post.title, contentBlocksSnapshot: post.contentBlocks as Prisma.InputJsonValue, coverFileIdSnapshot: post.coverFileId,
    bindingsSnapshot: post.bindings.map((ref) => ({ type: ref.targetType, id: ref.targetId })),
    topicIdsSnapshot: post.topics.map((ref) => ref.topicId), visibilitySnapshot: post.visibility, statusSnapshot: post.status,
  }] })
}
