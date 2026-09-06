import { LANDING_DEFAULT_CONFIG, type PublicHomepageDto } from '@ai-learning-hub/contracts'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { HomepageService } from '../src/modules/homepage/homepage.service'

const resolved = (id: string) => ({ targetType: 'community_post' as const, slug: id, title: `帖子${id}`, summary: '公开帖子', data: { route: `/community/post/${id}` } })
const module = (ids: string[]) => ({
  moduleKey: 'landing_hero',
  name: '首屏设置',
  moduleType: 'community_landing_v1',
  enabled: true,
  sortOrder: 0,
  config: LANDING_DEFAULT_CONFIG.landing_hero,
  items: ids.map((targetId, sortOrder) => ({ targetType: 'community_post', targetId, sortOrder, enabled: true })),
})

describe('落地页首屏槽位解析', () => {
  let fallbackId: string | null
  let service: HomepageService

  beforeEach(() => {
    fallbackId = 'p6'
    const prisma = {
      communityPost: { findFirst: vi.fn(async () => fallbackId ? { id: fallbackId } : null) },
      user: { count: vi.fn(async () => 29) },
    }
    const references = { resolvePublicCommunity: vi.fn(async (_type: string, id: string) => id === 'invalid' ? null : resolved(id)) }
    service = new HomepageService(prisma as never, {} as never, {} as never, {} as never, {} as never, {} as never, {} as never, references as never)
  })

  const render = (ids: string[]) => (service as unknown as {
    render: (modules: unknown[], updatedAt: Date, version: number) => Promise<PublicHomepageDto>
  }).render([module(ids)], new Date('2026-09-04T00:00:00Z'), 1)

  it('五个有效关联保持五个固定槽位', async () => {
    const items = (await render(['p1', 'p2', 'p3', 'p4', 'p5'])).modules[0].items
    expect(items.map((item) => item.slot)).toEqual([0, 1, 2, 3, 4])
    expect(items.map((item) => item.slug)).toEqual(['p1', 'p2', 'p3', 'p4', 'p5'])
  })

  it('第5关联失效后使用确定性候选补位，且不与前4帖子重复', async () => {
    const items = (await render(['p1', 'p2', 'p3', 'p4', 'invalid'])).modules[0].items
    expect(items.map((item) => item.slug)).toEqual(['p1', 'p2', 'p3', 'p4', 'p6'])
    expect(items[4]).toMatchObject({ slot: 4, targetType: 'community_post' })
  })

  it('没有可用帖子时只保留空的第5槽语义', async () => {
    fallbackId = null
    const items = (await render(['p1', 'p2', 'p3', 'p4', 'invalid'])).modules[0].items
    expect(items.map((item) => item.slot)).toEqual([0, 1, 2, 3])
  })

  it('任一前置关联失效不会推动后项或套错槽位', async () => {
    const items = (await render(['p1', 'invalid', 'p3', 'p4', 'p5'])).modules[0].items
    expect(items.map((item) => [item.slot, item.slug])).toEqual([[0, 'p1'], [2, 'p3'], [3, 'p4'], [4, 'p5']])
  })
})
