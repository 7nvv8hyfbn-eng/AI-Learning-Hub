import { describe, expect, it } from 'vitest'
import type { PrismaClient } from '@prisma/client'
import { lczCuratedPosts } from '@ai-learning-hub/demo-fixtures'
import { importLczCuratedPosts, validateLczCuratedPosts } from '../prisma/import-lcz-curated-posts'
import { CommunityAdminService } from '../src/modules/community/admin.service'
import type { AdminCommunityQuery } from '../src/modules/community/admin-query.dto'

class FakePrisma {
  posts = new Map<string, unknown>()
  revisions: unknown[] = []
  user = {
    findMany: async () => [{ id: 'official-1', username: 'campus-guide-1', displayName: 'AI 学习助手', schoolId: 'school-1' }],
  }
  communityTopic = {
    findMany: async () => [...new Set(lczCuratedPosts.flatMap((post) => post.topics))].map((id) => ({ id })),
  }
  theme = {
    findMany: async () => [...new Set(lczCuratedPosts.map((post) => post.themeSlug))].map((slug) => ({ id: `theme-${slug}`, slug, title: slug })),
  }
  communityPost = {
    findUnique: async ({ where }: { where: { id: string } }) => this.posts.get(where.id) || null,
    create: async ({ data }: { data: { id: string } }) => {
      this.posts.set(data.id, data)
      return data
    },
  }
  communityPostRevision = {
    create: async ({ data }: { data: unknown }) => {
      this.revisions.push(data)
      return data
    },
  }
  $queryRaw = async () => []
  $transaction = async <T>(run: (tx: FakePrisma) => Promise<T>) => run(this)
}

describe('外部社区精选', () => {
  it('固定提供四类各五篇原创编辑稿，来源、标题与图片策略可审计', () => {
    expect(() => validateLczCuratedPosts()).not.toThrow()
    expect(lczCuratedPosts).toHaveLength(20)
    for (const category of ['llm', 'agent', 'media', 'hardware']) expect(lczCuratedPosts.filter((post) => post.category === category)).toHaveLength(5)
    expect(new Set(lczCuratedPosts.map((post) => post.sourceKey)).size).toBe(20)
    expect(new Set(lczCuratedPosts.map((post) => post.adaptedTitle)).size).toBe(20)
    expect(lczCuratedPosts.every((post) => post.imageSources.length === 0)).toBe(true)
    expect(lczCuratedPosts.every((post) => post.adaptedBlocks.some((block) => block.type === 'paragraph' && block.text.startsWith('核心结论｜')))).toBe(true)
  })

  it('重复执行不覆盖已存在、已编辑或软删除记录', async () => {
    const prisma = new FakePrisma()
    const first = await importLczCuratedPosts(prisma as unknown as PrismaClient)
    expect(first.created).toBe(20)
    expect(prisma.posts.size).toBe(20)
    expect(prisma.revisions).toHaveLength(20)
    const editedId = 'community-lcz-1356'
    prisma.posts.set(editedId, { id: editedId, title: '管理员已经修改', deletedAt: new Date() })
    const second = await importLczCuratedPosts(prisma as unknown as PrismaClient)
    expect(second).toMatchObject({ created: 0, skipped: 20 })
    expect(prisma.posts.get(editedId)).toMatchObject({ title: '管理员已经修改' })
    expect(prisma.revisions).toHaveLength(20)
  })

  it('后台只把官方精选草稿纳入审核，不开放普通私人草稿', async () => {
    const service = new CommunityAdminService(
      {} as never,
      {} as never,
      { adminWhere: () => ({ status: { in: ['published', 'limited', 'hidden', 'removed'] } }) } as never,
    )
    const draft = await service.postWhere({ status: 'draft' } as AdminCommunityQuery)
    expect(draft).toMatchObject({
      AND: [{
        id: { startsWith: 'community-lcz-' },
        status: 'draft',
        author: { communityProfile: { is: { verifiedType: 'official' } } },
      }],
    })
    const all = await service.postWhere({} as AdminCommunityQuery)
    expect(JSON.stringify(all)).toContain('community-lcz-')
    expect(JSON.stringify(draft)).not.toContain('私人草稿')
  })
})
