import { createHash } from 'node:crypto'
import { Prisma, PrismaClient } from '@prisma/client'
import { lczCuratedPosts, type LczCuratedPost } from '@ai-learning-hub/demo-fixtures'

const plainText = (post: LczCuratedPost) => post.adaptedBlocks.map((block) => block.type === 'code' ? block.code : block.type === 'image' ? block.alt || '' : block.text).join('\n')

export function validateLczCuratedPosts(posts: LczCuratedPost[] = lczCuratedPosts) {
  const expected: Record<LczCuratedPost['category'], number> = { llm: 5, agent: 5, media: 5, hardware: 5 }
  const unique = (values: string[], label: string) => {
    if (new Set(values).size !== values.length) throw new Error(`${label}存在重复`)
  }
  if (posts.length !== 20) throw new Error('外部社区精选必须恰好包含 20 篇')
  unique(posts.map((post) => post.sourceKey), 'sourceKey')
  unique(posts.map((post) => post.sourceUrl), '来源地址')
  unique(posts.map((post) => post.adaptedTitle), '编辑标题')
  for (const post of posts) {
    const topicId = post.sourceKey.slice(4)
    if (post.sourceUrl !== `https://lcz.me/topic/${topicId}`) throw new Error(`${post.sourceKey} 与来源地址不一致`)
    if (!Number.isFinite(Date.parse(post.sourcePublishedAt))) throw new Error(`${post.sourceKey} 来源时间无效`)
    if (post.adaptedTitle.length > 160 || plainText(post).length > 20000) throw new Error(`${post.sourceKey} 超出社区内容长度限制`)
    if (!post.topics.length || post.topics.length > 5 || new Set(post.topics).size !== post.topics.length) throw new Error(`${post.sourceKey} 话题配置无效`)
    if (post.imageSources.length) throw new Error(`${post.sourceKey} 当前批次没有获得可复用图片授权`)
    const footer = post.adaptedBlocks.at(-1)
    if (footer?.type !== 'paragraph' || !footer.text.includes(`原作者：${post.sourceAuthor}`) || !footer.text.includes(`原帖：${post.sourceUrl}`)) throw new Error(`${post.sourceKey} 缺少来源说明`)
    expected[post.category]--
  }
  if (Object.values(expected).some((count) => count !== 0)) throw new Error('四个精选方向必须各 5 篇')
}

export async function importLczCuratedPosts(prisma: PrismaClient) {
  validateLczCuratedPosts()
  const officials = await prisma.user.findMany({
    where: {
      status: 'active',
      communityProfile: { is: { verifiedType: 'official' } },
      userRoles: { some: { role: { code: 'community_official' } } },
    },
    select: { id: true, username: true, displayName: true, schoolId: true },
    orderBy: { id: 'asc' },
  })
  const author = officials.find((user) => user.displayName === '社区编辑部')
    || officials.find((user) => user.displayName === 'AI 学习助手')
    || officials[0]
  if (!author) throw new Error('未找到有效的社区官方账号，请先配置“社区编辑部”或其他官方账号')

  const topicIds = [...new Set(lczCuratedPosts.flatMap((post) => post.topics))]
  const topics = await prisma.communityTopic.findMany({ where: { id: { in: topicIds }, status: 'active' }, select: { id: true } })
  if (topics.length !== topicIds.length) {
    const found = new Set(topics.map((topic) => topic.id))
    throw new Error(`社区话题不存在或已关闭：${topicIds.filter((id) => !found.has(id)).join('、')}`)
  }
  const themeSlugs = [...new Set(lczCuratedPosts.map((post) => post.themeSlug))]
  const themes = await prisma.theme.findMany({ where: { slug: { in: themeSlugs }, status: 'published', deletedAt: null }, select: { id: true, slug: true, title: true } })
  if (themes.length !== themeSlugs.length) {
    const found = new Set(themes.map((theme) => theme.slug))
    throw new Error(`学习主题不存在或未发布：${themeSlugs.filter((slug) => !found.has(slug)).join('、')}`)
  }
  const themeBySlug = new Map(themes.map((theme) => [theme.slug, theme]))

  const items: Array<{ sourceKey: string; id: string; status: 'created' | 'skipped'; imageCount: number }> = []
  for (const post of lczCuratedPosts) {
    const id = `community-${post.sourceKey.replace(':', '-')}`
    const status = await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`community-curation:${post.sourceKey}`}, 0))::text`
      if (await tx.communityPost.findUnique({ where: { id }, select: { id: true } })) return 'skipped' as const
      const text = plainText(post)
      const theme = themeBySlug.get(post.themeSlug)!
      await tx.communityPost.create({
        data: {
          id,
          authorId: author.id,
          postType: post.postType,
          status: 'draft',
          visibility: 'public',
          schoolId: author.schoolId,
          title: post.adaptedTitle,
          body: text,
          plainText: text,
          contentBlocks: post.adaptedBlocks as Prisma.InputJsonValue,
          contentHash: createHash('sha256').update(text.replace(/\s+/g, '').toLowerCase()).digest('hex'),
          labels: ['外部社区精选', '待审核', post.sourceKey],
          bindings: { create: [{ targetType: 'theme', targetId: theme.id, titleSnapshot: theme.title, sortOrder: 0 }] },
          topics: { create: post.topics.map((topicId) => ({ topicId })) },
        },
      })
      await tx.communityPostRevision.create({
        data: {
          postId: id,
          revisionNo: 1,
          editorId: author.id,
          editorType: 'import',
          titleSnapshot: post.adaptedTitle,
          contentBlocksSnapshot: post.adaptedBlocks as Prisma.InputJsonValue,
          bindingsSnapshot: [{ type: 'theme', id: theme.id }],
          topicIdsSnapshot: post.topics,
          visibilitySnapshot: 'public',
          statusSnapshot: 'draft',
          reason: '外部社区精选首次导入，等待后台审核',
        },
      })
      return 'created' as const
    })
    items.push({ sourceKey: post.sourceKey, id, status, imageCount: post.imageSources.length })
  }
  return {
    author: { id: author.id, username: author.username, displayName: author.displayName },
    created: items.filter((item) => item.status === 'created').length,
    skipped: items.filter((item) => item.status === 'skipped').length,
    items,
  }
}

if (require.main === module) {
  const prisma = new PrismaClient()
  void importLczCuratedPosts(prisma)
    .then((result) => console.log(JSON.stringify(result, null, 2)))
    .catch((error: unknown) => {
      console.error(error instanceof Error ? error.message : '外部社区精选导入失败')
      process.exitCode = 1
    })
    .finally(() => prisma.$disconnect())
}
