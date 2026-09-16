// 只允许明确授权主机上的本任务隔离库；不运行 Seed，不删除用户，不写业务库。
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')
const { PrismaClient } = require('@prisma/client')
const { syncProjectContent } = require('../dist/modules/project-content/sync')
const { assertContentReady, readBundle, sha, digest } = require('../dist/modules/project-content/bundle')
assert.equal(process.env.PROJECT_CONTENT_ISOLATED, 'true')
assert.match(new URL(process.env.DATABASE_URL).pathname, /^\/project_content_(fresh|legacy)$/)
const prisma = new PrismaClient(), mode = process.argv[2] || 'fresh'
const checks = [], mark = name => { checks.push(name); console.log('PASS ' + name) }
const personalTables = ['users', 'user_roles', 'roles', 'role_permissions', 'permissions', 'community_profiles', 'refresh_tokens', 'lesson_progress', 'learning_notes', 'community_user_follows', 'community_topic_follows', 'community_bookmarks', 'resource_watch_progress', 'activity_events', 'lab_runs', 'lab_run_snapshots', 'lab_run_events', 'lab_reports']
let existingUserIds
async function personal() {
  const tables = await prisma.$queryRawUnsafe("SELECT tablename FROM pg_tables WHERE schemaname='public'")
  const result = {}
  for (const { tablename } of tables.filter(t => personalTables.includes(t.tablename) || /mfa|verification|session|identity|credential|collection.*reference/.test(t.tablename))) {
    assert.match(tablename, /^[a-z_]+$/)
    const userColumn = { users: 'id', user_roles: 'user_id', community_profiles: 'user_id' }[tablename]
    result[tablename] = await prisma.$queryRawUnsafe('SELECT md5(coalesce(string_agg(row_hash,\'\' ORDER BY row_hash),\'\')) AS hash, count(*)::int AS count FROM (SELECT md5(to_jsonb(t)::text) row_hash FROM "' + tablename + '" t' + (userColumn ? ' WHERE "' + userColumn + '" = ANY($1::text[])' : '') + ') s', ...(userColumn ? [existingUserIds] : []))
  }
  return result
}
async function contentCounts() {
  return { users: await prisma.user.count(), topics: await prisma.communityTopic.findMany({ orderBy: { slug: 'asc' } }), topicLinks: await prisma.communityPostTopic.count(), labs: await prisma.lab.count(), steps: await prisma.labStep.count(), labVersions: await prisma.labVersion.count(), files: await prisma.fileRecord.count(), posts: await prisma.communityPost.count(), replies: await prisma.communityComment.count(), courses: await prisma.course.count(), versions: await prisma.courseVersion.count(), audits: await prisma.auditLog.count(), registry: await prisma.systemSetting.findMany({ where: { key: { startsWith: 'project_content:' } }, orderBy: { key: 'asc' } }) }
}
async function main() {
  existingUserIds = (await prisma.user.findMany({ select: { id: true } })).map(u => u.id)
  const before = await personal(), counts = await contentCounts()
  await assert.rejects(assertContentReady(prisma), /尚未完成同步/)
  const preview = await syncProjectContent(prisma, { preview: true })
  assert.equal(preview.status, 'preview'); assert.deepEqual(await contentCounts(), counts); mark('预览无写入、未同步时启动检查失败')
  let retryFiles
  if (mode === 'fresh') {
    await prisma.$executeRawUnsafe("CREATE FUNCTION isolated_fail_content() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.id = 'aix01-post-050' THEN RAISE EXCEPTION 'isolated-content-failure'; END IF; RETURN NEW; END $$")
    await prisma.$executeRawUnsafe('CREATE TRIGGER isolated_fail_content BEFORE INSERT ON community_posts FOR EACH ROW EXECUTE FUNCTION isolated_fail_content()')
    await assert.rejects(syncProjectContent(prisma), /isolated-content-failure/)
    assert.equal(await prisma.communityPost.count(), counts.posts)
    assert.equal(await prisma.communityComment.count(), counts.replies)
    await assert.rejects(assertContentReady(prisma), /尚未完成同步/)
    await prisma.$executeRawUnsafe('DROP TRIGGER isolated_fail_content ON community_posts')
    await prisma.$executeRawUnsafe('DROP FUNCTION isolated_fail_content()')
    retryFiles = await prisma.fileRecord.count()
    assert(retryFiles > 0); mark('写入中途失败事务回滚且未记录完成')
  }
  const first = await syncProjectContent(prisma)
  if (retryFiles !== undefined) assert.equal(await prisma.fileRecord.count(), retryFiles)
  assert.deepEqual(await personal(), before); await assertContentReady(prisma); mark('首次同步完成且原有账号、凭据、权限和个人记录不变')
  const showcases = await prisma.user.findMany({ where: { registrationSource: 'project_content_showcase' }, include: { identities: true, refreshTokens: true, moderatorGrants: true, communityProfile: true, userRoles: { include: { role: { include: { permissions: true } } } } } })
  assert.equal(showcases.length, 3)
  for (const user of showcases) {
    assert.equal(user.passwordHash, null); assert.equal(user.mfaSecretEncrypted, null); assert.equal(user.identities.length + user.refreshTokens.length + user.moderatorGrants.length, 0)
    assert.equal(user.communityProfile.verifiedType, 'official'); assert.deepEqual(user.userRoles.map(r => r.role.code), ['community_official']); assert.equal(user.userRoles[0].role.permissions.length, 0)
  }
  const labs = await prisma.lab.findMany({ where: { dataOrigin: 'project_content' }, include: { publishedVersion: true, steps: true } })
  assert.equal(labs.length, 13); assert.equal(labs.reduce((n, l) => n + l.steps.length, 0), 90)
  for (const lab of labs) { assert.equal(lab.status, 'published'); assert.equal(lab.publishedVersion.snapshot.steps.length, lab.steps.length); assert.equal(lab.steps.reduce((n, s) => n + s.score, 0), 100); assert(!('participants' in lab.payload)); assert(!('completionRate' in lab.payload)) }
  for (const topic of await prisma.communityTopic.findMany({ where: { recommended: true } })) assert.equal(topic.postCount, await prisma.communityPostTopic.count({ where: { topicId: topic.id, post: { status: 'published', deletedAt: null } } }))
  mark('13项90步实训、真实话题关联、3个无凭据无管理权限官方主页')
  const after = await contentCounts(), repeated = await syncProjectContent(prisma)
  assert.equal(repeated.counts.created, 0); assert.equal(repeated.counts.updated, 0); assert.deepEqual(await contentCounts(), after); mark('第二次零新增、零上传、零改写')
  const [a, b] = await Promise.all([syncProjectContent(prisma), syncProjectContent(prisma)])
  assert.equal(a.counts.created + b.counts.created, 0); assert.deepEqual(await contentCounts(), after); mark('并发同步串行化且不重复')
  const courses = await prisma.course.findMany({ where: { dataOrigin: 'project_content' }, include: { publishedVersion: { include: { chapters: { include: { lessons: true } } } } } })
  for (const c of courses) assert.equal(c.publishedVersion.chapters.reduce((n, ch) => n + ch.lessons.length, 0), 6)
  if (mode === 'fresh') { assert.equal(first.counts.created + first.counts.updated, 376); assert.equal(courses.length, 24); assert.equal(await prisma.user.count(), 4); assert.equal(await prisma.communityPost.count({ where: { sourceType: 'project_content' } }), 124); assert.equal(await prisma.communityComment.count({ where: { sourceType: 'project_content' } }), 200) }
  mark('完整课程课时与项目内容数量')
  const { bundle } = await readBundle()
  const admin = await prisma.user.findFirst({ where: { userRoles: { some: { role: { code: 'super_admin' } } } } })
  const post = bundle.community[0], deletedReply = bundle.community[1].replies[1]
  await prisma.communityPost.update({ where: { id: post.id }, data: { body: '现场人工修改，不能覆盖', likeCount: { increment: 7 }, bookmarkCount: { increment: 3 } } })
  await prisma.communityComment.delete({ where: { id: deletedReply.id } })
  await prisma.communityPost.create({ data: { id: 'isolated-human-same-title', authorId: admin.id, title: bundle.community[2].title, body: '同名用户原创内容', plainText: '同名用户原创内容', contentHash: sha('同名用户原创内容'), contentBlocks: [], postType: 'general', status: 'published' } })
  const edited = await prisma.communityPost.findUnique({ where: { id: post.id } })
  const protectedReport = await syncProjectContent(prisma)
  assert.equal((await prisma.communityPost.findUnique({ where: { id: post.id } })).body, edited.body)
  assert.equal(await prisma.communityComment.count({ where: { id: deletedReply.id } }), 0)
  assert.equal((await prisma.communityPost.findUnique({ where: { id: 'isolated-human-same-title' } })).body, '同名用户原创内容')
  assert.equal((await prisma.communityPost.findUnique({ where: { id: post.id } })).likeCount, edited.likeCount)
  assert(protectedReport.entries.some(e => e.key === deletedReply.id && e.action === 'protected')); mark('人工修改、删除、同名用户内容和真实互动保留')
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'project-content-test-'))
  try {
    const updated = structuredClone(bundle); updated.release++; updated.versions.community++; updated.versions.courses++; updated.versions.labs++
    updated.community[2].body += '\n隔离版本升级验收内容。'
    updated.courses[0].chapters[0].lessons[0].summary += ' 隔离升级'
    updated.labs[0].steps[0].description += ' 隔离升级'
    const raw = JSON.stringify(updated)
    await fs.writeFile(path.join(temp, 'content.json'), raw)
    await fs.writeFile(path.join(temp, 'manifest.json'), JSON.stringify({ release: updated.release, sha256: 'invalid' }))
    const preFailure = await contentCounts()
    await assert.rejects(syncProjectContent(prisma, { root: temp }), /摘要/)
    assert.deepEqual(await contentCounts(), preFailure)
    await fs.writeFile(path.join(temp, 'manifest.json'), JSON.stringify({ release: updated.release, sha256: sha(raw) }))
    const oldVersions = await prisma.courseVersion.count(), oldFiles = await prisma.fileRecord.count()
    const oldLabVersions = await prisma.labVersion.findMany({ orderBy: { id: 'asc' } })
    const upgrade = await syncProjectContent(prisma, { root: temp })
    assert(upgrade.counts.updated >= 2); assert.equal(await prisma.courseVersion.count(), oldVersions + 1); assert.equal(await prisma.fileRecord.count(), oldFiles)
    assert.equal(await prisma.labVersion.count(), oldLabVersions.length + 1)
    assert.deepEqual(await prisma.labVersion.findMany({ where: { id: { in: oldLabVersions.map(v => v.id) } }, orderBy: { id: 'asc' } }), oldLabVersions)
    assert.equal((await prisma.communityPost.findUnique({ where: { id: post.id } })).body, edited.body)
    await assert.rejects(syncProjectContent(prisma), /旧版本/)
    await assertContentReady(prisma, temp)
    assert.deepEqual(await personal(), before); mark('摘要失败不记完成、安全重试、版本升级保留历史、禁止降级')
    if (mode === 'fresh') await require('./project-content-http.cjs')(prisma, updated)
    await prisma.lab.update({ where: { slug: bundle.labs[1].slug }, data: { status: 'archived' } })
    await prisma.lab.update({ where: { slug: bundle.labs[2].slug }, data: { deletedAt: new Date() } })
    await prisma.communityTopic.update({ where: { slug: bundle.topics[0].slug }, data: { description: '人工话题说明' } })
    await prisma.communityProfile.update({ where: { userId: 'platform-ai-assistant' }, data: { bio: '人工主页说明' } })
    const protectedExtras = await syncProjectContent(prisma, { root: temp })
    for (const key of [bundle.labs[1].slug, bundle.labs[2].slug, bundle.topics[0].slug, 'ai-assistant']) assert(protectedExtras.entries.some(e => e.key === key && e.action === 'protected'))
    assert.equal(await prisma.lab.count({ where: { slug: bundle.labs[2].slug, deletedAt: null } }), 0)
    mark('实训下架和删除、话题编辑、官方主页人工修改均受保护')
  } finally { await fs.rm(temp, { recursive: true, force: true }) }
  console.log(JSON.stringify({ passed: true, mode, first, checks, personalFingerprint: digest(before) }))
}
main().catch(error => { console.error(error); process.exitCode = 1 }).finally(() => prisma.$disconnect())
