import { LANDING_DEFAULT_CONFIG, landingTargetTypes, type PublicHomepageDto } from '@ai-learning-hub/contracts'
import { describe, expect, it, vi } from 'vitest'
import { HomepageService } from '../src/modules/homepage/homepage.service'

const module = (key: 'landing_hero' | 'landing_featured', ids: string[]) => ({
  moduleKey: key, name: key, enabled: true, sortOrder: 0, config: LANDING_DEFAULT_CONFIG[key],
  items: ids.map((targetId, sortOrder) => ({ targetType: 'community_post', targetId, sortOrder, enabled: true })),
})

describe('落地页固定首屏与动态精选边界', () => {
  it('首屏不解析旧帖子或寻找候选；其他精选仍读取真实内容', async () => {
    const fallback = vi.fn(), resolve = vi.fn(async (_type: string, id: string) => ({ targetType: 'community_post', slug: id, title: id, summary: '公开内容', data: {} }))
    const prisma = { communityPost: { findFirst: fallback }, user: { count: vi.fn(async () => 29) } }
    const service = new HomepageService(prisma as never, {} as never, {} as never, {} as never, {} as never, {} as never, {} as never, { resolvePublicCommunity: resolve } as never)
    const render = (modules: unknown[]) => (service as unknown as { render: (modules: unknown[], date: Date, version: number) => Promise<PublicHomepageDto> }).render(modules, new Date('2026-09-14'), 1)
    for (const ids of [[], ['已删除旧帖', '已撤回授权'], ['最新帖子']]) {
      const page = await render([module('landing_hero', ids), module('landing_featured', ['精选帖子'])])
      expect(page.modules[0].items).toEqual([])
      expect(page.modules[1].items[0].slug).toBe('精选帖子')
    }
    expect(resolve.mock.calls.every(([, id]) => id === '精选帖子')).toBe(true)
    expect(fallback).not.toHaveBeenCalled()
    expect(landingTargetTypes('landing_hero')).toEqual([])
    expect(landingTargetTypes('landing_featured')).toContain('community_post')
  })
})
