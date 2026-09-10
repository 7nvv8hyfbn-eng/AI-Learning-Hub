import { ConfigService } from '@nestjs/config'
import { Prisma } from '@prisma/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ResourceHubService } from '../src/modules/resources/resource-hub.service'
import { CollectionPageQueryDto, ResourceHubQueryDto } from '../src/modules/resources/resource-hub.dto'

const makeHub = (prisma: object, posts: object = {}, resources: object = {}) => new ResourceHubService(
  prisma as never, new ConfigService({ JWT_SECRET: 'synthetic-resource-query-test-secret' }), posts as never,
  { publicPostsSql: async () => Prisma.sql`p.author_id <> ${'blocked-author'}`, where: async () => ({ deletedAt: null }) } as never,
  resources as never, {} as never, {} as never, {} as never, {} as never, {} as never, {} as never,
)
afterEach(() => vi.useRealTimers())

describe('资源查询边界与分页', () => {
  it('混合来源只补齐当前页，游标携带来源、排序和固定时间并拒绝跨筛选复用', async () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-09-08T00:00:00Z'))
    const publishedAt = new Date('2026-09-01T00:00:00Z')
    const candidates = [
      { sourceType: 'legacy_resource', id: 'shared-id', databaseId: 'legacy-db-id', publishedAt, views: 3, featured: false },
      { sourceType: 'contribution', id: 'shared-id', databaseId: 'shared-id', publishedAt, views: 3, featured: false },
      { sourceType: 'contribution', id: 'next-post', databaseId: 'next-post', publishedAt, views: 2, featured: false },
    ]
    const prisma = { systemSetting: { findUnique: vi.fn(async () => null) }, $queryRaw: vi.fn().mockResolvedValueOnce(candidates).mockResolvedValue([]), communityPost: { findMany: vi.fn(async () => []) } }
    const resources = { list: vi.fn(async () => ({ items: [{ slug: 'shared-id', title: '已发布旧资源', summary: '', data: {}, views: 3, downloads: 0 }] })) }
    const service = makeHub(prisma, {}, resources)
    const query = { ...new ResourceHubQueryDto(), limit: 2, sort: 'popular' as const }
    const first = await service.list('viewer', query)
    expect(first.items).toHaveLength(1) // 两次读取之间撤下的投稿不会再次显示。
    expect(first.items[0]).toMatchObject({ id: 'shared-id', sourceType: 'legacy_resource' })
    expect(resources.list).toHaveBeenCalledWith({ page: 1, pageSize: 1, keyword: '' }, true, ['legacy-db-id'])
    expect(prisma.communityPost.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { id: { in: ['shared-id'] }, AND: [{ deletedAt: null }] }, take: 1 }))
    const cursor = JSON.parse(Buffer.from(first.nextCursor!, 'base64url').toString())
    expect(cursor).toMatchObject({ id: 'shared-id', sourceType: 'contribution', views: 3, asOf: '2026-09-08T00:00:00.000Z' })
    vi.setSystemTime(new Date('2026-09-09T00:00:00Z'))
    expect(await service.list('viewer', { ...query, cursor: first.nextCursor! })).toEqual({ items: [], nextCursor: null })
    const sql = prisma.$queryRaw.mock.calls[1][0] as Prisma.Sql
    expect(sql.sql).toContain('(views, published_at, id COLLATE "C", source_type COLLATE "C") <')
    expect(sql.values).toContainEqual(new Date(cursor.asOf))
    expect(sql.values.at(-1)).toBe(3)
    await expect(service.list('viewer', { ...query, cursor: first.nextCursor!, kind: 'video' })).rejects.toThrow('分页条件')
    await expect(service.list('another-viewer', { ...query, cursor: first.nextCursor! })).rejects.toThrow('分页条件')
    for (const invalid of [{ id: '' }, { asOf: 0 }, { publishedAt: false }, { views: -1 }, { sourceType: 'private' }]) {
      const malformed = Buffer.from(JSON.stringify({ ...cursor, ...invalid })).toString('base64url')
      await expect(service.list('viewer', { ...query, cursor: malformed })).rejects.toThrow('分页条件')
    }
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(2)
  })

  it('搜索文本只作为参数，最新排序无需聚合观看事件', async () => {
    const prisma = { systemSetting: { findUnique: vi.fn(async () => null) }, $queryRaw: vi.fn(async (_sql: Prisma.Sql) => []) }
    const keyword = "%' OR 1=1 -- 中文"
    await makeHub(prisma).list('viewer', { ...new ResourceHubQueryDto(), keyword })
    const sql = prisma.$queryRaw.mock.calls[0][0] as Prisma.Sql
    expect(sql.sql).not.toContain(keyword)
    expect(sql.values).toContain(keyword)
    expect(sql.sql).not.toContain('FROM activity_events')
    expect(sql.sql).not.toContain('FROM resource_views')
    expect(sql.values.at(-1)).toBe(19)
  })

  it('首页各入口限制读取数量，周期榜独立使用近7天与近30天窗口', async () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-09-08T00:00:00Z'))
    const prisma = { systemSetting: { findUnique: vi.fn(async () => null) }, $queryRaw: vi.fn(async (_sql: Prisma.Sql) => []) }
    const service = makeHub(prisma)
    Object.assign(service, {
      categories: async () => [{ code: 'ai', name: 'AI' }],
      hubConfig: async () => ({ bannerPostIds: ['p'], sectionCategoryCodes: ['ai'] }),
      collections: vi.fn(async () => ({ items: [], nextCursor: null })),
    })
    expect((await service.home('viewer')).rankings).toEqual({ week: [], month: [], all: [] })
    const sql = prisma.$queryRaw.mock.calls.map(([value]) => value as Prisma.Sql)
    expect(sql.map((value) => value.values.at(-1))).toEqual([6, 4, 7, 6, 6, 6, 5, 5])
    expect(sql[3].values).toContainEqual(new Date('2026-09-01T00:00:00Z'))
    expect(sql[4].values).toContainEqual(new Date('2026-08-09T00:00:00Z'))
    expect(sql[5].sql).not.toContain('created_at >=')
    expect(service.collections).toHaveBeenCalledWith('viewer', expect.objectContaining({ limit: 4 }))
  })

  it('合集摘要只读取数据库聚合结果，不载入合集的全部条目', async () => {
    const owner = { status: 'active', profile: {}, receivedModeration: [], identityVerification: null, id: 'viewer', userRoles: [], displayName: '合成作者' }
    const rows = ['first', 'empty'].map((id) => ({ id, ownerId: 'viewer', owner, updatedAt: new Date() }))
    const prisma = { systemSetting: { findUnique: vi.fn(async () => null) },
      learningCollection: { findMany: vi.fn(async () => rows) },
      $queryRaw: vi.fn(async (_sql: Prisma.Sql) => [{ id: 'first', itemCount: 12000, videoCount: 11000, durationSeconds: 660000 }]),
    }
    const result = await makeHub(prisma).collections('viewer', { ...new ResourceHubQueryDto(), limit: 4 })
    expect(result.items[0]).toMatchObject({ itemCount: 12000, videoCount: 11000, durationSeconds: 660000 })
    expect(result.items[1]).toMatchObject({ itemCount: 0, videoCount: 0, durationSeconds: 0 })
    expect(prisma.learningCollection.findMany).toHaveBeenCalledWith(expect.objectContaining({ take: 5, include: { owner: expect.anything() } }))
    const sql = prisma.$queryRaw.mock.calls[0][0]
    expect(sql.values).toEqual(['first', 'empty', 'blocked-author'])
    expect(sql.sql).toContain('GROUP BY item.collection_id')
  })

  it('合集从第521项定向读取，前后分页只补齐本页且保留总体统计', async () => {
    const slot = (index: number) => ({ id: `item-${index}`, sortOrder: index, contributionPostId: `post-${index}` })
    const meta = { id: 'collection', ownerId: 'viewer', owner: { status: 'active', profile: {}, receivedModeration: [], identityVerification: null, id: 'viewer', userRoles: [] }, updatedAt: new Date() }
    const prisma = { systemSetting: { findUnique: vi.fn(async () => null) },
      learningCollection: { findFirst: vi.fn(async () => meta) },
      learningCollectionItem: { findFirst: vi.fn().mockResolvedValueOnce(slot(521)).mockResolvedValueOnce(slot(520)), findMany: vi.fn().mockResolvedValueOnce([slot(521), slot(522), slot(523)]).mockResolvedValueOnce([slot(520), slot(519), slot(518)]) },
      communityPost: { findMany: vi.fn(async ({ where }: { where: { AND: Array<{ id?: { in: string[] } }> } }) => where.AND[1].id!.in.map((id) => ({ id }))) },
      $queryRaw: vi.fn(async () => [{ id: 'collection', itemCount: 1500, videoCount: 1000, durationSeconds: 120000 }]),
    }
    const service = makeHub(prisma, { mapMany: vi.fn(async () => []) })
    Object.assign(service, { detection: { result: vi.fn() }, mapContributions: vi.fn(async (_user: string, rows: Array<{ id: string }>) => rows.map((row) => ({ id: row.id, postId: row.id }))) })
    const page = await service.collection('viewer', 'collection', { ...new CollectionPageQueryDto(), limit: 2 }, 'post-521')
    expect(page).toMatchObject({ itemCount: 1500, nextCursor: 'item-522', previousCursor: 'item-521' })
    expect(page.items.map((entry) => entry.contribution.id)).toEqual(['post-521', 'post-522'])
    expect(prisma.communityPost.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { AND: [{ deletedAt: null }, { id: { in: ['post-521', 'post-522'] } }] }, take: 2 }))
    prisma.learningCollectionItem.findFirst.mockResolvedValueOnce(slot(521))
    const previous = await service.collection('viewer', 'collection', { ...new CollectionPageQueryDto(), cursor: 'item-521', direction: 'before', limit: 2 })
    expect(previous.items.map((entry) => entry.id)).toEqual(['item-519', 'item-520'])
    expect(previous.previousCursor).toBe('item-519')
    expect(prisma.learningCollectionItem.findMany).toHaveBeenLastCalledWith(expect.objectContaining({ take: 3, where: expect.objectContaining({ collectionId: 'collection', OR: [{ sortOrder: { lt: 521 } }, { sortOrder: 521, id: { lt: 'item-521' } }] }), orderBy: [{ sortOrder: 'desc' }, { id: 'desc' }] }))
    prisma.learningCollectionItem.findFirst.mockResolvedValueOnce(null)
    await expect(service.collection('viewer', 'collection', { ...new CollectionPageQueryDto(), cursor: 'foreign-item' })).rejects.toThrow('游标无效')
    expect(prisma.learningCollectionItem.findMany).toHaveBeenCalledTimes(2)
  })

  it('分页排序只写入所选条目的原位置，跨合集或陈旧修订均拒绝', async () => {
    const slots = [{ id: 'first', sortOrder: 20 }, { id: 'second', sortOrder: 900 }]
    const tx = { $queryRaw: vi.fn(), learningCollection: { findFirst: vi.fn(async () => ({ id: 'collection' })), update: vi.fn() }, learningCollectionItem: { findMany: vi.fn(async () => slots), update: vi.fn() } }
    const service = makeHub({ learningCollection: { findFirst: vi.fn(async () => ({ visibility: 'private' })) }, $transaction: async (operation: (client: typeof tx) => Promise<void>) => operation(tx) })
    Object.assign(service, { detectCollection: vi.fn(), collection: vi.fn() })
    await service.reorderCollection('viewer', 'collection', 4, ['second', 'first'])
    expect(tx.learningCollectionItem.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { collectionId: 'collection', id: { in: ['second', 'first'] } }, take: 2 }))
    expect(tx.learningCollectionItem.update.mock.calls).toEqual([[{ where: { id: 'second' }, data: { sortOrder: 20 } }], [{ where: { id: 'first' }, data: { sortOrder: 900 } }]])
    tx.learningCollectionItem.findMany.mockResolvedValueOnce([slots[0]])
    await expect(service.reorderCollection('viewer', 'collection', 4, ['first', 'foreign'])).rejects.toThrow('必须属于当前合集')
    expect(tx.learningCollectionItem.update).toHaveBeenCalledTimes(2)
    tx.learningCollection.findFirst.mockResolvedValueOnce(null as never)
    await expect(service.reorderCollection('viewer', 'collection', 3, ['second', 'first'])).rejects.toThrow('合集已变化')
  })
})
