// 仅由 drill.py 通过 stdin 在独立 API 容器中执行；不输出账号、令牌或媒体签名。
import assert from 'node:assert/strict'
import { PrismaClient } from '@prisma/client'
import { createHash, randomUUID } from 'node:crypto'
import { createRequire } from 'node:module'
import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
const prisma = new PrismaClient()
const load = createRequire(import.meta.url)
const securedAuth = existsSync(process.cwd() + '/dist/common/deployment-security.js')
const base = 'http://127.0.0.1:3000/api/v1'
const checks = []
let stage = 'readiness'
async function json(path, token, init = {}) {
  const response = await fetch(base + path, { ...init, headers: { 'content-type': 'application/json', origin: process.env[path.startsWith('/admin-auth/') ? 'ADMIN_WEB_URL' : 'FRONTEND_URL'] || 'http://127.0.0.1:3000', ...(token ? { authorization: `Bearer ${token}` } : {}), ...init.headers }, signal: AbortSignal.timeout(10000) })
  const body = await response.json()
  assert.equal(response.status, 200 + (init.method === 'POST' ? 1 : 0), '恢复接口 HTTP 状态异常')
  assert.equal(body.code, 0, '恢复接口业务状态异常')
  return body.data
}
try {
  const database = new URL(process.env.DATABASE_URL)
  assert(database.pathname === '/drill' && /^aihub-drill-[a-f0-9]{12}-db$/.test(database.hostname), '仅允许本次隔离恢复数据库')
  let ready = false
  for (let i = 0; i < 60; i++) {
    try { const response = await fetch(base + '/health', { signal: AbortSignal.timeout(2000) }); if (response.ok) { ready = true; break } } catch { /* 等待应用就绪 */ }
    await new Promise(resolve => setTimeout(resolve, 1000))
  }
  assert(ready, '恢复应用未就绪')
  checks.push('readiness')
  stage = 'student-admin-static-and-proxy'
  for (const origin of input.frontends) {
    let page
    for (let attempt = 0; attempt < 30; attempt++) {
      try { page = await fetch(origin, { signal: AbortSignal.timeout(2000) }); if (page.ok) break; await page.arrayBuffer() } catch { /* Nginx 入口仍在初始化 */ }
      await new Promise(resolve => setTimeout(resolve, 1000))
    }
    assert(page?.ok, '恢复前端未就绪')
    assert.equal(page.status, 200)
    const html = await page.text()
    assert.match(html, /<html/i)
    const assets = [...html.matchAll(/(?:src|href)="([^"]+\.(?:js|css))"/g)].map(match => match[1])
    assert(assets.length, '恢复前端缺少脚本或样式')
    for (const asset of assets) {
      const url = new URL(asset, origin)
      assert.equal(url.origin, origin)
      const resource = await fetch(url, { signal: AbortSignal.timeout(5000) })
      assert.equal(resource.status, 200)
      assert.match(resource.headers.get('content-type') || '', /javascript|css/)
      await resource.arrayBuffer()
    }
    const api = await fetch(origin + '/api/v1/health', { signal: AbortSignal.timeout(5000) })
    assert.equal(api.status, 200)
  }
  checks.push('student-admin-static-and-proxy')
  stage = 'existing-login'
  const login = async role => {
    const identifier = input.credentials[`${role}Identifier`]
    const result = await json(securedAuth && role === 'admin' ? '/admin-auth/login' : '/auth/login', '', { method: 'POST', body: JSON.stringify({ identifier, password: input.credentials[`${role}Password`], remember: false }) })
    if (!result.mfaRequired) return result
    const user = await prisma.user.findFirstOrThrow({ where: { OR: [{ username: { equals: identifier, mode: 'insensitive' } }, { email: { equals: identifier, mode: 'insensitive' } }] } })
    // 仅在无端口的恢复副本核对被备份的MFA密文及密钥；不改变线上管理员。
    const secret = result.secret || load(process.cwd() + '/dist/modules/auth/mfa-crypto.js').decryptMfa(user.mfaSecretEncrypted, process.env.MFA_DATA_KEY, user.id)
    const waitUntil = Date.now() + 35_000
    while (user.mfaLastTimeStep !== null && Math.floor(Date.now() / 30000) <= user.mfaLastTimeStep) {
      if (Date.now() >= waitUntil) throw new Error('恢复副本 MFA 时间步异常，请核对时钟')
      await new Promise(resolve => setTimeout(resolve, 1000))
    }
    const code = await load('otplib').generate({ secret })
    return json('/admin-auth/mfa', '', { method: 'POST', body: JSON.stringify({ challenge: result.challenge, code, remember: false }) })
  }
  const student = await login('student'), admin = await login('admin')
  assert(student.user.id && admin.user.id)
  checks.push('existing-student-and-admin-login')
  stage = 'admin-boundary'
  const anonymous = await fetch(base + '/admin/persistence', { signal: AbortSignal.timeout(5000) })
  assert.equal(anonymous.status, 401)
  const forbidden = await fetch(base + '/admin/persistence', { headers: { authorization: `Bearer ${student.accessToken}` }, signal: AbortSignal.timeout(5000) })
  assert.equal(forbidden.status, 403)
  await json('/admin/persistence', admin.accessToken)
  if (!input.previous) {
    const detail = await json('/admin/persistence/operations', admin.accessToken)
    assert(detail.checks.database.status === 'ok')
    const response = await fetch(base + '/admin/persistence/operations', { headers: { authorization: `Bearer ${student.accessToken}` } })
    assert.equal(response.status, 403)
  }
  checks.push('admin-boundary')
  stage = 'post-read'
  const posts = await json('/community/posts?limit=20', student.accessToken)
  assert(Array.isArray(posts) && posts.length, '恢复库没有可验证的可见帖子')
  await json(`/community/posts/${encodeURIComponent(posts[0].id)}`, student.accessToken)
  checks.push('post-read')
  stage = 'comment-read'
  let commentFound = false
  for (const post of posts.slice(0, 20)) {
    const page = await json(`/community/posts/${encodeURIComponent(post.id)}/comments`, student.accessToken)
    const comments = input.previous && Array.isArray(page) ? page : page.items
    assert(Array.isArray(comments), '评论返回格式不符合现有契约')
    if (!Array.isArray(page)) assert(page.nextCursor === null || typeof page.nextCursor === 'string', '评论分页游标格式无效')
    if (comments.length) { commentFound = true; break }
  }
  assert(commentFound, '恢复库抽样未覆盖评论，不得把空列表当作验证通过')
  checks.push('comment-read')
  stage = 'course-version-relations'
  const courses = await prisma.course.findMany({ where: { status: 'published', deletedAt: null, publishedVersionId: { not: null } }, include: { publishedVersion: true }, take: 10 })
  assert(courses.length, '恢复库没有可验证的发布课程')
  for (const course of courses) {
    assert.equal(course.publishedVersion.courseId, course.id)
    await json(`/courses/${encodeURIComponent(course.slug)}`, student.accessToken)
  }
  checks.push('course-version-relations')
  stage = 'file-download'
  const files = await prisma.fileRecord.findMany({ where: { visibility: 'public', quarantinedAt: null, objectKey: { startsWith: 'catalog/' } }, take: 1 })
  assert(files.length, '恢复库没有可验证的公共文件')
  const file = files[0]
  const download = await fetch(`${base}/files/${encodeURIComponent(file.id)}/download`, { headers: { authorization: `Bearer ${admin.accessToken}` }, signal: AbortSignal.timeout(10000) })
  assert.equal(download.status, 200)
  const bytes = Buffer.from(await download.arrayBuffer())
  assert.equal(bytes.length, file.size)
  assert.equal(createHash('sha256').update(bytes).digest('hex'), file.checksum)
  checks.push('file-authorized-download-and-hash')
  stage = 'video-range-and-decode'
  const hub = await json('/resource-hub/items?limit=48&kind=video', admin.accessToken)
  let playback, video
  for (const candidate of hub.items.filter(item => item.videoAssetId && item.mediaStatus === 'ready')) {
    const response = await fetch(`${base}/resource-hub/videos/${encodeURIComponent(candidate.videoAssetId)}/playback`, { headers: { authorization: `Bearer ${admin.accessToken}` }, signal: AbortSignal.timeout(10000) })
    // 旧内容的发布者仍受当前资格检查；必须找到一个获准播放的真实样本。
    if (response.status === 403) { await response.arrayBuffer(); continue }
    assert.equal(response.status, 200)
    const body = await response.json(); assert.equal(body.code, 0)
    playback = body.data; video = candidate; break
  }
  assert(playback && video, '恢复库没有获准播放的真实视频，不能声称播放通过')
  const eligibility = await json('/community/eligibility', student.accessToken)
  const expectedAccess = eligibility.operations.read.allowed
  const studentPlayback = await fetch(`${base}/resource-hub/videos/${encodeURIComponent(video.videoAssetId)}/playback`, { headers: { authorization: `Bearer ${student.accessToken}` }, signal: AbortSignal.timeout(10000) })
  if (input.previous && expectedAccess && studentPlayback.status === 403) {
    // 仅回滚读取演练兼容旧版把观看资格归入上传资格；候选版本必须按 read 放行。
    assert.equal(eligibility.operations.upload.allowed, false)
    assert.equal((await studentPlayback.json()).errorCode, 'COMMUNITY_VERIFICATION_REQUIRED')
  } else {
    assert.equal(studentPlayback.status, expectedAccess ? 200 : 403)
    await studentPlayback.arrayBuffer()
  }
  checks.push('media-eligibility-enforced')
  const playbackUrl = new URL(playback.sources[0].src, base)
  assert.equal(playbackUrl.origin, 'http://127.0.0.1:3000')
  const partial = await fetch(playbackUrl, { headers: { range: 'bytes=0-1023' }, signal: AbortSignal.timeout(10000) })
  assert.equal(partial.status, 206)
  assert.match(partial.headers.get('content-range') || '', /^bytes 0-1023\//)
  assert.equal((await partial.arrayBuffer()).byteLength, 1024)
  // 真正解码一秒媒体，不能只凭 Range 206 判定可播放。URL 不进入任何日志。
  execFileSync('ffmpeg', ['-v', 'error', '-i', playbackUrl.href, '-t', '1', '-f', 'null', '-'], { timeout: 20000, stdio: ['ignore', 'pipe', 'pipe'] })
  checks.push('video-range-and-decode')
  if (!input.previous) {
    stage = 'expiry-cleanup'
    const { cleanExpiredCredentials } = createRequire(import.meta.url)(process.cwd() + '/dist/modules/persistence/maintenance.js')
    const nonce = 'drill-' + randomUUID()
    const samples = []
    const protectedBefore = await Promise.all([prisma.user.count(), prisma.auditLog.count(), prisma.communityModerationAction.count()])
    try {
      for (const model of ['passwordResetToken', 'emailVerificationToken', 'refreshToken', 'requestIdempotency', 'registrationThrottle', 'loginThrottle']) {
        for (const expired of [true, false]) {
          const key = nonce + '-' + model + '-' + expired
          const expiresAt = new Date(expired ? 1 : Date.now() + 86400000)
          const data = model.endsWith('Throttle') ? { identityKey: key, expiresAt }
            : model === 'requestIdempotency' ? { principalKey: nonce, scope: 'operations-drill', idempotencyKey: key, requestHash: key, resourceId: nonce, expiresAt }
            : { userId: student.user.id, tokenHash: createHash('sha256').update(key).digest('hex'), expiresAt }
          const row = await prisma[model].create({ data })
          samples.push({ model, expired, where: model.endsWith('Throttle') ? { identityKey: row.identityKey } : { id: row.id } })
        }
      }
      const result = await cleanExpiredCredentials(prisma)
      assert.equal(result.skipped, false)
      assert(Object.values(result.deleted).every(count => count >= 1 && count <= 1000))
      for (const sample of samples) assert.equal(Boolean(await prisma[sample.model].findUnique({ where: sample.where })), !sample.expired)
      assert.deepEqual(await Promise.all([prisma.user.count(), prisma.auditLog.count(), prisma.communityModerationAction.count()]), protectedBefore)
      checks.push('expired-records-removed-valid-and-protected-data-retained')
    } finally {
      for (const sample of samples) await prisma[sample.model].deleteMany({ where: sample.where })
    }
  }
  console.log(JSON.stringify({ passed: true, checks }))
} catch (error) {
  console.log(JSON.stringify({ passed: false, checks, stage, reason: '恢复验证未覆盖全部要求或断言失败', errorType: error?.name, actual: typeof error?.actual === 'number' ? error.actual : undefined, expected: typeof error?.expected === 'number' ? error.expected : undefined }))
  process.exitCode = 1
} finally { await prisma.$disconnect() }
