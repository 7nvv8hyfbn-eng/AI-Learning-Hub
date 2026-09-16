const assert = require('node:assert/strict')
const { randomBytes, randomUUID } = require('node:crypto')
const { hash } = require('bcryptjs')
const { NestFactory, Reflector } = require('@nestjs/core')
const { ConfigService } = require('@nestjs/config')
const { AppModule } = require('../dist/app.module')
const { appValidationPipe } = require('../dist/common/validation.pipe')
const { ApiExceptionFilter } = require('../dist/common/api-exception.filter')
const { ApiResponseInterceptor } = require('../dist/common/api-response.interceptor')
const { browserBoundary } = require('../dist/common/deployment-security')
const cookieParser = require('cookie-parser')

module.exports = async function verifyHttp(db, bundle) {
  assert.equal(process.env.PROJECT_CONTENT_ISOLATED, 'true')
  const password = randomBytes(24).toString('hex') + '!Aa9'
  const user = await db.user.create({ data: { username: 'content_http_' + randomUUID().slice(0, 8), displayName: '隔离阅读验收', email: randomUUID() + '@example.invalid', passwordHash: await hash(password, 4), emailVerifiedAt: new Date(), onboardingCompletedAt: new Date(), userRoles: { create: { role: { connect: { code: 'student' } } } }, communityProfile: { create: {} } } })
  const admin = await db.user.findFirst({ where: { userRoles: { some: { role: { code: 'super_admin' } } } } })
  const app = await NestFactory.create(AppModule, { logger: false, abortOnError: false })
  app.use(cookieParser()); app.use(browserBoundary(app.get(ConfigService))); app.setGlobalPrefix('api/v1')
  app.useGlobalPipes(appValidationPipe); app.useGlobalFilters(new ApiExceptionFilter()); app.useGlobalInterceptors(new ApiResponseInterceptor(app.get(Reflector)))
  try {
    await app.listen(0, '127.0.0.1')
    const origin = await app.getUrl(), base = origin + '/api/v1'
    let token
    const request = async (route, method = 'GET', body, anonymous = false) => {
      const response = await fetch(base + route, { method, headers: { origin: process.env.FRONTEND_URL, 'content-type': 'application/json', 'idempotency-key': randomUUID(), ...(!anonymous && token ? { authorization: 'Bearer ' + token } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) })
      const value = await response.json()
      return { status: response.status, ...value }
    }
    const login = await request('/auth/login', 'POST', { identifier: user.username, password }); assert.equal(login.status, 201, login.message); token = login.data.accessToken
    const safe = value => {
      const text = JSON.stringify(value)
      for (const forbidden of [admin.id, admin.username, admin.email, 'campus-guide-1', '造梦少年', 'passwordHash', 'realNameEncrypted']) assert(!text.includes(forbidden), '公开接口泄漏内部关联：' + forbidden)
    }
    const post = await request('/community/posts/' + bundle.community[4].id); assert.equal(post.status, 200, post.message); assert.equal(post.data.author.kind, 'platform'); safe(post.data)
    const feed = await request('/community/feed?limit=20'); assert.equal(feed.status, 200, feed.message); assert(feed.data.items.filter(item => item.type === 'post').length > 2, '平台内容不应被单一作者限额截断')
    const comments = await request('/community/posts/' + bundle.community[4].id + '/comments'); assert.equal(comments.status, 200, comments.message); safe(comments.data)
    const context = await request('/community/context'); assert.equal(context.status, 200, context.message); safe(context.data)
    assert.equal(context.data.trendingTopics.length, 4); assert.equal(context.data.suggestedUsers.length, 3)
    for (const topic of context.data.trendingTopics) {
      assert.equal(topic.postCount, 25)
      const posts = await request('/community/topics/' + topic.slug + '/posts?limit=30')
      assert.equal(posts.status, 200, posts.message); assert.equal(posts.data.length, 25)
    }
    for (const person of context.data.suggestedUsers) {
      assert.equal(person.verifiedType, 'official'); assert(person.badges.some(b => b.code === 'official'))
      const profile = await request('/community/users/' + person.id)
      assert.equal(profile.status, 200, profile.message); safe(profile.data)
      assert(profile.data.bio.includes('平台官方展示主页')); assert(!JSON.stringify(profile.data).includes('@example.invalid'))
      const denied = await request('/auth/login', 'POST', { identifier: person.username, password }, true)
      assert.equal(denied.status, 401)
    }
    const labList = await request('/labs?pageSize=100', 'GET', undefined, true)
    assert.equal(labList.status, 200, labList.message); assert.equal(labList.data.total, 13)
    for (const lab of bundle.labs) {
      const detail = await request('/labs/' + lab.slug, 'GET', undefined, true)
      assert.equal(detail.status, 200, detail.message); assert.equal(detail.data.steps.length, lab.steps.length)
      const cover = await fetch(new URL(detail.data.data.cover, origin)); assert.equal(cover.status, 200); assert((await cover.arrayBuffer()).byteLength > 100)
      const start = await request('/labs/' + lab.slug + '/runs', 'POST')
      assert.equal(start.status, 201, start.message)
      const runId = start.data.id
      const running = await request('/lab-runs/' + runId + '/actions', 'POST', { action: 'run' }); assert.equal(running.status, 201, running.message)
      for (const step of lab.steps) {
        const result = await request('/lab-runs/' + runId + '/actions', 'POST', { action: step.instruction.action })
        assert.equal(result.status, 201, result.message)
      }
      const result = await request('/lab-runs/' + runId)
      assert.equal(result.data.status, 'success'); assert.equal(result.data.progress, 100); assert.equal(result.data.score, 100)
      const submission = await request('/lab-runs/' + runId + '/submit', 'POST'); assert.equal(submission.status, 201, submission.message)
    }
    console.log('PASS 真实 HTTP：4个有帖话题、3个官方主页可访问且不能登录、13项实训90步全部完成并提交')
    for (const course of bundle.courses) {
      const result = await request('/courses/' + course.slug); assert.equal(result.status, 200, result.message); safe(result.data)
      assert.equal(result.data.chapters.reduce((n, ch) => n + ch.lessons.length, 0), 6)
      const images = result.data.chapters.flatMap(ch => ch.lessons.flatMap(l => l.blocks.filter(b => b.blockType === 'image')))
      for (const image of images) { const response = await fetch(new URL(image.content.url || image.content.src, origin)); assert.equal(response.status, 200); assert((await response.arrayBuffer()).byteLength > 100) }
    }
    const listing = await request('/resource-hub/public/items?limit=48', 'GET', undefined, true); assert.equal(listing.status, 200, listing.message); safe(listing.data)
    for (const tutorial of bundle.tutorials) {
      const result = await request('/resource-hub/contributions/' + tutorial.id); assert.equal(result.status, 200, result.message); assert.equal(result.data.post.author.kind, 'platform'); safe(result.data)
      const coverId = result.data.post.contribution.coverFileId
      const cover = await fetch(base + '/resource-hub/covers/' + coverId); assert.equal(cover.status, 200); assert((await cover.arrayBuffer()).byteLength > 100)
      if (tutorial.video) {
        assert(result.data.post.labels.includes('8秒演示片段'))
        const play = await request('/resource-hub/videos/' + result.data.post.contribution.videoAssetId + '/playback')
        assert.equal(play.status, 200, play.message)
        const response = await fetch(new URL(play.data.sources[0].src, origin), { headers: { range: 'bytes=0-1023' } }); assert.equal(response.status, 206); assert.equal(Buffer.from(await response.arrayBuffer()).toString('ascii', 4, 8), 'ftyp')
      }
      if (tutorial.attachment) { const response = await fetch(new URL(result.data.contribution.attachment.downloadUrl, origin), { headers: { authorization: 'Bearer ' + token } }); assert.equal(response.status, 200); assert((await response.arrayBuffer()).byteLength > 10) }
    }
    const collection = await request('/resource-hub/collections/' + bundle.playlist.id); assert.equal(collection.status, 200, collection.message); safe(collection.data); assert.equal(collection.data.owner.kind, 'platform')
    const fake = await request('/community/posts', 'POST', { type: 'general', title: '伪造测试', contentBlocks: [{ type: 'paragraph', text: '不能伪造平台身份' }], bindings: [], topicIds: [], status: 'published', visibility: 'public', sourceType: 'project_content' }); assert.equal(fake.status, 400)
    console.log('PASS 真实 HTTP：平台署名、公开封面、完整课时插图、视频 Range、附件与身份防伪')
  } finally { await app.close() }
}
