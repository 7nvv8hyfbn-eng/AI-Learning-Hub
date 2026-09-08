import { BadRequestException, Inject, Injectable, ServiceUnavailableException } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import type { PersistenceStatusDto } from '@ai-learning-hub/contracts'
import { PrismaService } from '../../prisma/prisma.service'
import { STORAGE_SERVICE, StorageService } from '../storage/storage.types'
import { requiredPermissions } from './bootstrap'
import { readdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { parseIdentityDataKey } from '../users/identity-data'

@Injectable()
export class PersistenceService {
  constructor(private readonly prisma: PrismaService, private readonly config: ConfigService, @Inject(STORAGE_SERVICE) private readonly storage: StorageService) {}
  async status(): Promise<PersistenceStatusDto> {
    const migrations = await this.prisma.$queryRaw<Array<{ migration_name: string; finished_at: Date | null }>>`SELECT migration_name,finished_at FROM _prisma_migrations WHERE rolled_back_at IS NULL ORDER BY started_at`
    const expected = (await readdir(resolve(__dirname, '../../../prisma/migrations'), { withFileTypes: true })).filter((entry) => entry.isDirectory()).map((entry) => entry.name)
    const [users, posts, drafts, comments, files, pendingReports, latest] = await this.prisma.$transaction([
      this.prisma.user.count(), this.prisma.communityPost.count({ where: { status: 'published', deletedAt: null } }),
      this.prisma.communityPost.count({ where: { status: 'draft', deletedAt: null } }), this.prisma.communityComment.count({ where: { status: 'published', deletedAt: null } }),
      this.prisma.fileRecord.count(), this.prisma.communityReport.count({ where: { status: { in: ['pending', 'reviewing'] } } }),
      this.prisma.activityEvent.findFirst({ orderBy: { createdAt: 'desc' }, select: { createdAt: true } }),
    ])
    const writes = await this.prisma.$queryRaw<Array<{ last_write: Date | null }>>`SELECT max(t) AS last_write FROM (SELECT max(updated_at) AS t FROM users UNION ALL SELECT max(updated_at) FROM community_posts UNION ALL SELECT max(updated_at) FROM community_comments UNION ALL SELECT max(created_at) FROM files UNION ALL SELECT max(updated_at) FROM system_settings UNION ALL SELECT max(created_at) FROM audit_logs) recent`
    const lastWrite = [latest?.createdAt, writes[0].last_write].filter((date): date is Date => !!date).sort((a, b) => b.getTime() - a.getTime())[0]
    return { database: { connected: true, type: 'PostgreSQL', ready: expected.length > 0 && expected.every((name) => migrations.some((m) => m.migration_name === name && m.finished_at)), migrations: expected.map((name) => ({ name, finishedAt: migrations.find((m) => m.migration_name === name)?.finished_at?.toISOString() || null })) }, storage: { driver: this.config.get('STORAGE_DRIVER') || 'local', writable: await this.storage.writable() }, counts: { users, posts, drafts, comments, files, pendingReports }, lastWriteAt: lastWrite?.toISOString() || null }
  }
  async preflight() {
    const status = await this.status()
    const [permissions, roles, identityRows] = await this.prisma.$transaction([this.prisma.permission.count({ where: { code: { in: requiredPermissions } } }), this.prisma.role.count({ where: { code: { in: ['student', 'super_admin'] } } }), this.prisma.campusIdentityVerification.count()])
    if (!status.database.ready || !status.storage.writable || permissions !== requiredPermissions.length || roles !== 2) throw new ServiceUnavailableException('数据库迁移、必要权限或文件存储检查未通过；请先运行 migrate 和 bootstrap')
    const configuredIdentityKey = this.config.get<string>('IDENTITY_DATA_KEY')
    if (identityRows || configuredIdentityKey) {
      try { parseIdentityDataKey(configuredIdentityKey) }
      catch { throw new ServiceUnavailableException('实名记录存在或实名能力已启用，但 IDENTITY_DATA_KEY 不是有效32字节密钥') }
    }
  }
  async maintain(actorId: string, action: string, reason: string, cursor?: string) {
    let count = 0
    let nextCursor: string | null = null
    if (action === 'recount') {
      await this.prisma.$transaction(async (tx) => {
        // 排他业务表锁只在管理员显式校准时使用，阻止并发关系写入覆盖校准结果。
        await tx.$executeRaw`LOCK TABLE community_posts,community_profiles,community_topics,community_post_reactions,community_bookmarks,community_comments,community_user_follows,community_topic_follows,community_post_topics IN SHARE ROW EXCLUSIVE MODE`
        await tx.$executeRaw`UPDATE community_posts p SET like_count=(SELECT count(*) FROM community_post_reactions r WHERE r.post_id=p.id AND r.reaction_type='like'), useful_count=(SELECT count(*) FROM community_post_reactions r WHERE r.post_id=p.id AND r.reaction_type='useful'), bookmark_count=(SELECT count(*) FROM community_bookmarks b WHERE b.post_id=p.id), comment_count=(SELECT count(*) FROM community_comments c WHERE c.post_id=p.id AND c.status='published' AND c.deleted_at IS NULL)`
        await tx.$executeRaw`UPDATE community_profiles p SET post_count=(SELECT count(*) FROM community_posts x WHERE x.author_id=p.user_id AND x.status='published' AND x.deleted_at IS NULL), following_count=(SELECT count(*) FROM community_user_follows x WHERE x.follower_id=p.user_id), follower_count=(SELECT count(*) FROM community_user_follows x WHERE x.followee_id=p.user_id)`
        await tx.$executeRaw`UPDATE community_topics t SET post_count=(SELECT count(*) FROM community_post_topics r JOIN community_posts p ON p.id=r.post_id WHERE r.topic_id=t.id AND p.status='published' AND p.deleted_at IS NULL), follower_count=(SELECT count(*) FROM community_topic_follows f WHERE f.topic_id=t.id)`
        await tx.auditLog.create({ data: { actorId, action: 'persistence_recount', targetType: 'maintenance', targetId: action, details: { reason } } })
      }, { timeout: 20000 })
      return { completed: true }
    }
    if (action === 'expire-idempotency') count = (await this.prisma.requestIdempotency.deleteMany({ where: { expiresAt: { lt: new Date() } } })).count
    else if (action === 'unused-files') {
      let after: { createdAt: string; id: string } | undefined
      if (cursor) {
        try { after = JSON.parse(Buffer.from(cursor, 'base64url').toString()); if (!after || typeof after.id !== 'string' || !/^[a-zA-Z0-9_-]{1,100}$/.test(after.id) || typeof after.createdAt !== 'string' || Number.isNaN(new Date(after.createdAt).getTime())) throw new Error() } catch { throw new BadRequestException('文件清理游标无效') }
      }
      const rows = await this.prisma.fileRecord.findMany({ where: { createdAt: { lt: new Date(Date.now() - 7 * 86400000) }, storageDriver: this.config.get('STORAGE_DRIVER') || 'local', ...(after ? { OR: [{ createdAt: { gt: new Date(after.createdAt) } }, { createdAt: new Date(after.createdAt), id: { gt: after.id } }] } : {}) }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], take: 50, select: { id: true, createdAt: true } })
      for (const row of rows) { try { await this.storage.delete(row.id); count++ } catch (error) { if (!(error instanceof BadRequestException)) throw error } }
      if (rows.length === 50) { const last = rows.at(-1)!; nextCursor = Buffer.from(JSON.stringify({ id: last.id, createdAt: last.createdAt.toISOString() })).toString('base64url') }
    } else throw new BadRequestException('维护操作不受支持')
    await this.prisma.auditLog.create({ data: { actorId, action: `persistence_${action}`, targetType: 'maintenance', targetId: action, details: { reason, count } } })
    return { completed: true, count, nextCursor }
  }
}
