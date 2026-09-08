import { PrismaClient } from '@prisma/client'
import { createHash } from 'node:crypto'
import { createCommunityFixtures, demoArticles, demoCourses, demoLabs, demoStudents, demoThemes } from '@ai-learning-hub/demo-fixtures'

export async function seedCommunity(prisma: PrismaClient) {
  const fixtures = createCommunityFixtures({ courses: demoCourses, labs: demoLabs, articles: demoArticles, themes: demoThemes, students: demoStudents })
  const school = await prisma.school.findUniqueOrThrow({ where: { code: 'ai-campus' } })
  const department = await prisma.department.findFirstOrThrow({ where: { schoolId: school.id } })
  const codes = ['community.read', 'community.write', 'community.moderate', 'community.topic.manage', 'community.report.manage', 'community.official.publish', 'community.feed.manage']
  const roles = new Map<string, string>()
  for (const [code, name] of [['student', '学生'], ['teacher', '教师'], ['mentor', '导师'], ['community_official', '社区官方'], ['community_moderator', '社区审核员']]) {
    const role = await prisma.role.upsert({ where: { code }, update: {}, create: { code, name } })
    roles.set(code, role.id)
  }
  for (const code of codes) {
    const permission = await prisma.permission.upsert({ where: { code }, update: {}, create: { code, name: code } })
    const grants = await prisma.role.findMany({ where: { code: { in: ['admin', 'super_admin', ...(code !== 'community.official.publish' && code !== 'community.feed.manage' ? ['community_moderator'] : [])] } } })
    for (const role of grants) await prisma.rolePermission.upsert({ where: { roleId_permissionId: { roleId: role.id, permissionId: permission.id } }, create: { roleId: role.id, permissionId: permission.id }, update: {} })
  }
  const userIds = new Map<string, string>()
  for (const user of fixtures.users) {
    const row = await prisma.user.upsert({ where: { username: user.username }, update: {}, create: { username: user.username, displayName: user.displayName, email: `${user.username}@demo.invalid`, major: user.major, grade: user.grade, schoolId: school.id, departmentId: department.id, profile: { demo: true } } })
    userIds.set(user.username, row.id)
    await prisma.userRole.upsert({ where: { userId_roleId: { userId: row.id, roleId: roles.get('student')! } }, update: {}, create: { userId: row.id, roleId: roles.get('student')! } })
    await prisma.communityProfile.upsert({ where: { userId: row.id }, create: { userId: row.id, bio: '在学习、实训与讨论中一起成长。', verifiedType: user.verifiedType }, update: {} })
    if (user.verifiedType !== 'none') {
      const roleId = roles.get(user.verifiedType === 'official' ? 'community_official' : user.verifiedType)!
      await prisma.userRole.upsert({ where: { userId_roleId: { userId: row.id, roleId } }, update: {}, create: { userId: row.id, roleId } })
    }
  }
  const themes = await prisma.theme.findMany(), courses = await prisma.course.findMany(), labs = await prisma.lab.findMany(), articles = await prisma.article.findMany()
  for (const topic of fixtures.topics) await prisma.communityTopic.upsert({ where: { id: topic.id }, update: {}, create: { id: topic.id, slug: topic.slug, name: topic.name, description: topic.description, themeId: themes.find((row) => row.slug === topic.theme)?.id, accent: topic.accent, sortOrder: topic.sortOrder, recommended: topic.recommended } })
  for (const fixture of fixtures.posts) {
    const userId = userIds.get(fixture.author)!
    const body = fixture.blocks.map((block) => block.type === 'code' ? block.code : block.type === 'image' ? block.alt : block.type === 'list' ? block.items.join('\n') : block.text).join('\n')
    await prisma.communityPost.upsert({ where: { id: fixture.id }, update: {}, create: { id: fixture.id, authorId: userId, postType: fixture.type, title: fixture.title, body, plainText: body, contentBlocks: fixture.blocks, contentHash: createHash('sha256').update(body.replace(/\s+/g, '').toLowerCase()).digest('hex'), status: 'published', visibility: fixture.visibility, schoolId: school.id, publishedAt: new Date(fixture.publishedAt) } })
    for (const [sortOrder, binding] of fixture.bindings.entries()) {
      const content = binding.type === 'course' ? courses.find((row) => row.slug === binding.id) : binding.type === 'lab' ? labs.find((row) => row.slug === binding.id) : articles.find((row) => row.slug === binding.id)
      let targetId = content?.id, titleSnapshot = content?.title
      if (binding.type === 'lab_run') {
        const lab = labs.find((row) => row.slug === fixture.bindings.find((row) => row.type === 'lab')!.id)!
        const run = await prisma.labRun.upsert({ where: { id: binding.id }, update: {}, create: { id: binding.id, userId, labId: lab.id, labVersion: lab.version, labVersionId: lab.publishedVersionId, status: 'submitted', progress: 100, completedAt: new Date(fixture.publishedAt), submittedAt: new Date(fixture.publishedAt), result: { summary: '社区演示成果，由固定 fixtures 提供' } } })
        await prisma.labReport.upsert({ where: { runId: run.id }, update: {}, create: { runId: run.id, summary: { title: lab.title, source: 'demo-fixtures' } } })
        targetId = run.id; titleSnapshot = lab.title
      }
      if (!targetId || !titleSnapshot) throw new Error(`社区绑定不存在：${fixture.id}/${binding.type}/${binding.id}`)
      await prisma.communityPostBinding.upsert({ where: { postId_targetType_targetId: { postId: fixture.id, targetType: binding.type, targetId } }, update: {}, create: { postId: fixture.id, targetType: binding.type, targetId, titleSnapshot, sortOrder } })
    }
    for (const topicId of fixture.topics) await prisma.communityPostTopic.upsert({ where: { postId_topicId: { postId: fixture.id, topicId } }, update: {}, create: { postId: fixture.id, topicId } })
    if (fixture.type === 'question') await prisma.communityQuestionState.upsert({ where: { postId: fixture.id }, update: {}, create: { postId: fixture.id } })
  }
  for (const fixture of fixtures.comments) await prisma.communityComment.upsert({ where: { id: fixture.id }, update: {}, create: { id: fixture.id, postId: fixture.postId, authorId: userIds.get(fixture.author)!, parentId: fixture.parentId, rootId: fixture.parentId, body: fixture.body, contentBlocks: [{ type: 'paragraph', text: fixture.body }] } })
  for (const fixture of fixtures.reactions) await prisma.communityPostReaction.createMany({ data: [{ userId: userIds.get(fixture.username)!, postId: fixture.postId, reactionType: fixture.type }], skipDuplicates: true })
  for (const fixture of fixtures.bookmarks) await prisma.communityBookmark.createMany({ data: [{ userId: userIds.get(fixture.username)!, postId: fixture.postId }], skipDuplicates: true })
  for (const fixture of fixtures.follows) await prisma.communityUserFollow.createMany({ data: [{ followerId: userIds.get(fixture.follower)!, followeeId: userIds.get(fixture.followee)! }], skipDuplicates: true })
  for (const [index, fixture] of fixtures.impressions.entries()) {
    const userId = userIds.get(fixture.username)!, occurredAt = new Date(fixture.occurredAt)
    await prisma.communityFeedImpression.createMany({ data: [{ requestId: fixture.id, postId: fixture.postId, viewerId: userId, position: index, candidateSource: 'demo-fixtures', policyVersion: 'learning-v1', reasonCodes: ['exploration'], scoreBucket: 50, impressedAt: occurredAt, clickedAt: fixture.clicked ? occurredAt : null }], skipDuplicates: true })
    await prisma.activityEvent.upsert({ where: { id: fixture.id }, update: {}, create: { id: fixture.id, userId, eventType: fixture.clicked ? 'community_post_click' : 'community_feed_impression', targetType: 'post', targetId: fixture.postId, surface: 'community', occurredAt, createdAt: occurredAt } })
  }
  for (const notification of fixtures.notifications) await prisma.userNotification.upsert({ where: { dedupeKey: notification.id }, update: {}, create: { recipientId: userIds.get(notification.recipient)!, actorId: userIds.get(notification.actor), notificationType: notification.type, entityType: notification.entityType, entityId: notification.entityId, dedupeKey: notification.id, actorIds: [userIds.get(notification.actor)!], createdAt: new Date(notification.createdAt) } })
  for (const post of fixtures.posts) await prisma.communityPost.update({ where: { id: post.id }, data: {
    likeCount: await prisma.communityPostReaction.count({ where: { postId: post.id, reactionType: 'like' } }), usefulCount: await prisma.communityPostReaction.count({ where: { postId: post.id, reactionType: 'useful' } }),
    bookmarkCount: await prisma.communityBookmark.count({ where: { postId: post.id } }), commentCount: await prisma.communityComment.count({ where: { postId: post.id, deletedAt: null, status: 'published' } }), impressionCount: await prisma.communityFeedImpression.count({ where: { postId: post.id, impressedAt: { not: null } } }),
  } })
  for (const userId of userIds.values()) await prisma.communityProfile.update({ where: { userId }, data: { postCount: await prisma.communityPost.count({ where: { authorId: userId, status: 'published', deletedAt: null } }), followerCount: await prisma.communityUserFollow.count({ where: { followeeId: userId } }), followingCount: await prisma.communityUserFollow.count({ where: { followerId: userId } }) } })
  for (const topic of fixtures.topics) await prisma.communityTopic.update({ where: { id: topic.id }, data: { postCount: await prisma.communityPostTopic.count({ where: { topicId: topic.id, post: { status: 'published', deletedAt: null } } }), followerCount: await prisma.communityTopicFollow.count({ where: { topicId: topic.id } }) } })
}
