import { beforeAll, describe, expect, it } from 'vitest'
import { PrismaClient, type CommunityPostStatus, type Prisma } from '@prisma/client'
import { execFileSync } from 'node:child_process'
import { resolve } from 'node:path'
import { LANDING_DEFAULT_CONFIG, LANDING_MODULE_KEYS, type PublicHomepageDto } from '@ai-learning-hub/contracts'
import { upgradeLanding } from '../src/modules/homepage/upgrade-landing'

const base = process.env.E2E_BASE_URL
const adminEmail = process.env.E2E_ADMIN_EMAIL
const adminPassword = process.env.E2E_ADMIN_PASSWORD
const studentEmail = process.env.E2E_STUDENT_EMAIL
const studentPassword = process.env.E2E_STUDENT_PASSWORD

if (!base || !adminEmail || !adminPassword || !studentEmail || !studentPassword) {
  throw new Error('E2E_BASE_URL 与 E2E_* 凭据必须通过环境变量提供')
}

interface Envelope<T> { code: number; message: string; data: T }
const call = async <T>(path: string, init: RequestInit = {}, token?: string) => {
  if (path === '/admin/settings' && init.method === 'PATCH' && typeof init.body === 'string') {
    const input = JSON.parse(init.body)
    const settings = await call<Array<{ key: string; revision: number }>>(path, {}, token)
    init = { ...init, body: JSON.stringify({ ...input, expectedRevision: settings.find((row) => row.key === input.key)?.revision }) }
  }
  const response = await fetch(`${base}${path}`, {
    ...init,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}), ...init.headers },
  })
  const body = await response.json() as Envelope<T>
  if (!response.ok || body.code !== 0) throw new Error(`${path}: ${body.message}`)
  return body.data
}
const login = (email: string, password: string) => call<{ accessToken: string; user: { id: string } }>('/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) })

describe('真实 PostgreSQL 数据闭环', () => {
  let adminToken = ''
  let studentToken = ''
  let studentId = ''
  let courseId = ''
  let lessonId = ''
  let themeId = ''
  let labId = ''
  let resourceId = ''
  let articleId = ''
  let fileId = ''
  let originalHeroTitle = ''
  let heroModuleId = ''
  let notificationId = ''
  const suffix = Date.now()
  const slug = `e2ecourse${suffix}`

  beforeAll(async () => {
    const admin = await login(adminEmail, adminPassword)
    const student = await login(studentEmail, studentPassword)
    adminToken = admin.accessToken
    studentToken = student.accessToken
    studentId = student.user.id
  })

  it('未认证和学生角色不能访问管理接口', async () => {
    expect((await fetch(`${base}/admin/courses`)).status).toBe(401)
    expect((await fetch(`${base}/admin/courses`, { headers: { authorization: `Bearer ${studentToken}` } })).status).toBe(403)
    const unsafeUpload = new FormData()
    unsafeUpload.append('file', new Blob(['echo unsafe'], { type: 'application/x-sh' }), 'unsafe.sh')
    expect((await fetch(`${base}/admin/files/upload`, {
      method: 'POST',
      headers: { authorization: `Bearer ${adminToken}` },
      body: unsafeUpload,
    })).status).toBe(400)
    const wechat = await fetch(`${base}/auth/wechat/miniapp`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ code: 'unconfigured-test-code' }),
    })
    expect(wechat.status).toBe(503)
    const quizBoxHealth = await fetch(`${base}/admin/integrations/quiz-box/health`, {
      headers: { authorization: `Bearer ${adminToken}` },
    })
    expect(quizBoxHealth.status).toBe(503)
    const quizBoxImport = await fetch(`${base}/admin/integrations/quiz-box/attempts/unconfigured-attempt/import`, {
      method: 'POST',
      headers: { authorization: `Bearer ${adminToken}` },
    })
    expect(quizBoxImport.status).toBe(503)
    const legacyPayload = await fetch(`${base}/admin/themes`, {
      method: 'POST',
      headers: { authorization: `Bearer ${adminToken}`, 'content-type': 'application/json' },
      body: JSON.stringify({ slug: `legacy-payload-${suffix}`, title: '旧写入契约', summary: '必须被显式领域 DTO 拒绝。', payload: { cover: 'legacy' } }),
    })
    expect(legacyPayload.status).toBe(400)
  })

  it('Refresh Cookie 按环境配置并完成轮换、撤销与注销', async () => {
    const session = await fetch(`${base}/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: adminEmail, password: adminPassword }),
    })
    const firstSetCookie = session.headers.get('set-cookie') || ''
    expect(firstSetCookie).toContain('refresh_token=')
    expect(firstSetCookie).toContain('HttpOnly')
    expect(firstSetCookie).toContain('SameSite=Lax')
    expect(firstSetCookie).toContain('Path=/api/v1/auth')
    expect(/;\s*Secure/i.test(firstSetCookie)).toBe(process.env.E2E_COOKIE_SECURE === 'true')
    const firstCookie = firstSetCookie.split(';')[0]

    const rotated = await fetch(`${base}/auth/refresh`, { method: 'POST', headers: { cookie: firstCookie } })
    expect(rotated.status).toBe(201)
    const secondSetCookie = rotated.headers.get('set-cookie') || ''
    const secondCookie = secondSetCookie.split(';')[0]
    expect(secondCookie).not.toBe(firstCookie)
    expect((await fetch(`${base}/auth/refresh`, { method: 'POST', headers: { cookie: firstCookie } })).status).toBe(401)

    const logout = await fetch(`${base}/auth/logout`, { method: 'POST', headers: { cookie: secondCookie } })
    expect(logout.status).toBe(201)
    expect(logout.headers.get('set-cookie')).toMatch(/refresh_token=;.*(Expires=Thu, 01 Jan 1970|Max-Age=0)/)
    expect((await fetch(`${base}/auth/refresh`, { method: 'POST', headers: { cookie: secondCookie } })).status).toBe(401)
  })

  it('学校院系和登录审计来自真实数据库', async () => {
    const schools = await call<Array<{ departments: unknown[] }>>('/admin/schools', {}, adminToken)
    expect(schools[0].departments.length).toBeGreaterThan(0)
    const users = await call<{ items: Array<{ id: string; school: { id: string } | null }> }>(`/admin/users?keyword=${encodeURIComponent(studentEmail)}`, {}, adminToken)
    expect(users.items.some((item) => item.id === studentId && item.school)).toBe(true)
    const loginLogs = await call<Array<{ result: string }>>('/admin/login-logs', {}, adminToken)
    expect(loginLogs.some((item) => item.result === 'success')).toBe(true)
  })

  it('管理端创建发布后学生公开接口读取同一记录', async () => {
    const created = await call<{ databaseId: string; id: string }>('/admin/courses', {
      method: 'POST',
      body: JSON.stringify({ slug, title: '端到端数据闭环课程', summary: '由管理端创建并由学生端读取。', category: '大模型 LLM', level: '入门', hours: 1, mode: '图文' }),
    }, adminToken)
    courseId = created.databaseId
    const chapter = await call<{ id: string }>(`/admin/courses/${courseId}/chapters`, {
      method: 'POST',
      body: JSON.stringify({ title: '端到端章节', description: '真实 PostgreSQL 章节', sortOrder: 1 }),
    }, adminToken)
    const lesson = await call<{ id: string }>(`/admin/chapters/${chapter.id}/lessons`, {
      method: 'POST',
      body: JSON.stringify({ title: '端到端课时', summary: '真实结构化课时', durationMinutes: 15, sortOrder: 1 }),
    }, adminToken)
    lessonId = lesson.id
    const block = await call<{ id: string }>(`/admin/lessons/${lesson.id}/blocks`, {
      method: 'POST',
      body: JSON.stringify({ blockType: 'paragraph', content: { text: '由后台写入的结构化内容块。' }, sortOrder: 1 }),
    }, adminToken)
    await call(`/admin/courses/${courseId}/chapters/reorder`, { method: 'PUT', body: JSON.stringify({ items: [{ id: chapter.id, sortOrder: 1 }] }) }, adminToken)
    await call(`/admin/lessons/${lesson.id}/blocks/reorder`, { method: 'PUT', body: JSON.stringify({ items: [{ id: block.id, sortOrder: 1 }] }) }, adminToken)
    await call(`/admin/courses/${courseId}/publish`, { method: 'POST' }, adminToken)
    const publicCourse = await call<{ slug: string; title: string; databaseId?: string; themeId?: string; currentDraftVersionId?: string; chapters: Array<{ lessons: Array<{ blocks: Array<{ content: { text: string } }> }> }>; relatedResources: unknown[]; relatedLabs: unknown[] }>(`/courses/${slug}`)
    expect(publicCourse).toMatchObject({ slug, title: '端到端数据闭环课程' })
    expect(publicCourse.databaseId).toBeUndefined()
    expect(publicCourse.themeId).toBeUndefined()
    expect(publicCourse.currentDraftVersionId).toBeUndefined()
    expect(publicCourse.relatedResources).toEqual([])
    expect(publicCourse.relatedLabs).toEqual([])
    expect(publicCourse.chapters[0].lessons[0].blocks[0].content.text).toBe('由后台写入的结构化内容块。')
    await call(`/admin/courses/${courseId}`, {
      method: 'PATCH',
      body: JSON.stringify({ title: '尚未发布的新标题' }),
    }, adminToken)
    expect((await call<{ title: string }>(`/courses/${slug}`)).title).toBe('端到端数据闭环课程')
    await call(`/admin/courses/${courseId}/publish`, { method: 'POST' }, adminToken)
    const republishedCourse = await call<{ title: string; chapters: Array<{ lessons: Array<{ id: string }> }> }>(`/courses/${slug}`)
    expect(republishedCourse.title).toBe('尚未发布的新标题')
    lessonId = republishedCourse.chapters[0].lessons[0].id
    const beforeGrowth = await call<{ points: number }>(`/admin/users/${studentId}/growth`, {}, adminToken)
    const firstProgress = await call<{ courseProgress: { percentage: number } }>(`/lessons/${lessonId}/progress`, { method: 'PUT', body: JSON.stringify({ completed: true, positionSeconds: 120 }) }, studentToken)
    await call(`/lessons/${lessonId}/progress`, { method: 'PUT', body: JSON.stringify({ completed: true, positionSeconds: 180 }) }, studentToken)
    const afterGrowth = await call<{ points: number }>(`/admin/users/${studentId}/growth`, {}, adminToken)
    expect(firstProgress.courseProgress.percentage).toBe(100)
    expect(afterGrowth.points - beforeGrowth.points).toBe(10)
    const myCourses = await call<Array<{ course: { slug: string } }>>('/me/courses', {}, studentToken)
    expect(myCourses.some((item) => item.course.slug === slug)).toBe(true)
  })

  it('主题路径与首页发布由学生公开接口读取', async () => {
    const theme = await call<{ databaseId: string }>('/admin/themes', {
      method: 'POST',
      body: JSON.stringify({ slug: `e2e-theme-${suffix}`, title: '端到端主题', summary: '统一主题路径。' }),
    }, adminToken)
    themeId = theme.databaseId
    await call(`/admin/themes/${themeId}/path`, {
      method: 'PUT',
      body: JSON.stringify({ name: '端到端路径', description: '可视化路径', stages: [{ stageKey: 'intro', name: '入门', description: '第一阶段', stageType: 'learning', unlockRule: {}, targetType: 'course', targetId: courseId }] }),
    }, adminToken)
    await call(`/admin/themes/${themeId}/publish`, { method: 'POST' }, adminToken)
    const publicTheme = await call<{ paths: Array<{ stages: Array<{ name: string }> }> }>(`/themes/e2e-theme-${suffix}`)
    expect(publicTheme.paths[0].stages[0].name).toBe('入门')
    await call(`/admin/themes/${themeId}`, { method: 'PATCH', body: JSON.stringify({ title: '主题未发布新标题' }) }, adminToken)
    expect((await call<{ title: string }>(`/themes/e2e-theme-${suffix}`)).title).toBe('端到端主题')
    await call(`/admin/themes/${themeId}/publish`, { method: 'POST' }, adminToken)
    expect((await call<{ title: string }>(`/themes/e2e-theme-${suffix}`)).title).toBe('主题未发布新标题')

    const modules = await call<Array<{ id: string; moduleKey: string; config: Record<string, unknown>; items: Array<{ id: string; targetType: string; targetId: string; titleOverride?: string; summaryOverride?: string; coverOverride?: string; sortOrder: number }> }>>('/admin/homepage/modules', {}, adminToken)
    const hero = modules.find((item) => item.moduleKey === 'landing_hero')
    expect(hero).toBeTruthy()
    originalHeroTitle = String(hero?.config.titleFirst || '')
    heroModuleId = String(hero?.id || '')
    await call(`/admin/homepage/modules/${hero?.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ config: { ...hero?.config, titleFirst: '端到端首页发布标题' } }),
    }, adminToken)
    await call('/admin/homepage/publish', { method: 'POST' }, adminToken)
    const homepage = await call<{ modules: Array<{ moduleKey: string; config: Record<string, unknown>; items: unknown[] }> }>('/public/homepage')
    const publicHero = homepage.modules.find((item) => item.moduleKey === 'landing_hero')
    expect(publicHero?.config.titleFirst).toBe('端到端首页发布标题')
    expect(publicHero?.items.length).toBeGreaterThan(0)
    await call(`/admin/homepage/modules/${heroModuleId}`, { method: 'PATCH', body: JSON.stringify({ config: { ...hero?.config, titleFirst: '尚未发布的首页标题' } }) }, adminToken)
    const unchanged = await call<{ modules: Array<{ moduleKey: string; config: Record<string, unknown> }> }>('/public/homepage')
    expect(unchanged.modules.find((item) => item.moduleKey === 'landing_hero')?.config.titleFirst).toBe('端到端首页发布标题')
    await call('/admin/homepage/publish', { method: 'POST' }, adminToken)
    const republished = await call<{ modules: Array<{ moduleKey: string; config: Record<string, unknown> }> }>('/public/homepage')
    expect(republished.modules.find((item) => item.moduleKey === 'landing_hero')?.config.titleFirst).toBe('尚未发布的首页标题')
  })

  it('实训步骤由后台发布并形成服务端运行记录', async () => {
    const lab = await call<{ databaseId: string }>('/admin/labs', {
      method: 'POST',
      body: JSON.stringify({ slug: `e2e-lab-${suffix}`, title: '端到端实训', summary: '受控实训数据闭环。', labType: 'deployment', category: '模型部署', typeConfig: { runtime: 'docker', port: 8080, healthPath: '/health' } }),
    }, adminToken)
    labId = lab.databaseId
    await call(`/admin/labs/${labId}/steps`, {
      method: 'POST',
      body: JSON.stringify({ stepKey: 'prepare', title: '准备环境', description: '只执行受控状态机。', sortOrder: 1, instruction: { action: 'confirm' }, validator: {}, score: 50 }),
    }, adminToken)
    await call(`/admin/labs/${labId}/tools`, {
      method: 'PUT',
      body: JSON.stringify({ tools: [{ name: '受控部署工具', toolType: 'deployment', description: '只暴露发布定义。', enabled: true }] }),
    }, adminToken)
    await call(`/admin/labs/${labId}/publish`, { method: 'POST' }, adminToken)
    const detail = await call<{ data: { typeConfig: { runtime: string } }; steps: Array<{ stepKey: string }>; tools: Array<{ id?: string; name: string }> }>(`/labs/e2e-lab-${suffix}`)
    expect(detail.steps[0].stepKey).toBe('prepare')
    expect(detail.data.typeConfig.runtime).toBe('docker')
    expect(detail.tools).toEqual([{ name: '受控部署工具', toolType: 'deployment', description: '只暴露发布定义。' }])
    await call(`/admin/labs/${labId}/steps`, {
      method: 'POST',
      body: JSON.stringify({ stepKey: 'draft-only', title: '草稿步骤', description: '发布前不可见。', sortOrder: 2, instruction: { action: 'confirm' }, validator: {}, score: 50 }),
    }, adminToken)
    expect((await call<{ steps: unknown[] }>(`/labs/e2e-lab-${suffix}`)).steps.length).toBe(1)
    await call(`/admin/labs/${labId}/publish`, { method: 'POST' }, adminToken)
    expect((await call<{ steps: unknown[] }>(`/labs/e2e-lab-${suffix}`)).steps.length).toBe(2)
    const run = await call<{ id: string }>(`/labs/e2e-lab-${suffix}/runs`, { method: 'POST' }, studentToken)
    const sameRun = await call<{ id: string }>(`/labs/e2e-lab-${suffix}/runs`, { method: 'POST' }, studentToken)
    expect(sameRun.id).toBe(run.id)
    await call(`/lab-runs/${run.id}/actions`, { method: 'POST', body: JSON.stringify({ action: 'run' }) }, studentToken)
    const stream = await fetch(`${base}/lab-runs/${run.id}/events`, {
      headers: { authorization: `Bearer ${studentToken}` },
      signal: AbortSignal.timeout(3000),
    })
    expect(stream.headers.get('content-type')).toContain('text/event-stream')
    const reader = stream.body?.getReader()
    let eventText = ''
    for (let index = 0; index < 5 && !eventText.includes('受控实训环境已准备'); index += 1) {
      const event = await reader?.read()
      eventText += new TextDecoder().decode(event?.value)
    }
    await reader?.cancel()
    expect(eventText).toContain('受控实训环境已准备')
    await call(`/lab-runs/${run.id}/actions`, { method: 'POST', body: JSON.stringify({ action: 'confirm' }) }, studentToken)
    const successful = await call<{ status: string; score: number }>(`/lab-runs/${run.id}/actions`, { method: 'POST', body: JSON.stringify({ action: 'confirm' }) }, studentToken)
    expect(successful).toMatchObject({ status: 'success', score: 100 })
    const submitted = await call<{ status: string }>(`/lab-runs/${run.id}/submit`, { method: 'POST' }, studentToken)
    expect(submitted.status).toBe('submitted')
    expect((await call<{ status: string }>(`/lab-runs/${run.id}/submit`, { method: 'POST' }, studentToken)).status).toBe('submitted')
    const runs = await call<Array<{ id: string }>>(`/admin/labs/${labId}/runs`, {}, adminToken)
    expect(runs.some((item) => item.id === run.id)).toBe(true)
  })

  it('文件上传、资源发布、下载和计数形成真实闭环', async () => {
    const form = new FormData()
    form.append('visibility', 'public')
    form.append('file', new Blob(['端到端资源内容'], { type: 'text/plain' }), 'e2e-resource.txt')
    const uploadResponse = await fetch(`${base}/admin/files/upload`, { method: 'POST', headers: { authorization: `Bearer ${adminToken}` }, body: form })
    const uploadBody = await uploadResponse.json() as Envelope<{ id: string }>
    expect(uploadResponse.status).toBe(201)
    fileId = uploadBody.data.id
    const resource = await call<{ databaseId: string }>('/admin/resources', {
      method: 'POST',
      body: JSON.stringify({
        slug: `e2e-resource-${suffix}`,
        title: '端到端资源',
        summary: '真实文件与资源元数据。',
        category: '学习手册',
        format: 'TXT',
        visibility: 'public',
        fileId,
      }),
    }, adminToken)
    resourceId = resource.databaseId
    const draft = await call<{ title: string; versions: Array<{ id: string }> }>(`/admin/resources/${resourceId}`, {}, adminToken)
    await call(`/admin/resources/${resourceId}`, { method: 'PATCH', body: JSON.stringify({ title: '资源待恢复标题' }) }, adminToken)
    const restored = await call<{ title: string; versions: unknown[] }>(`/admin/resources/${resourceId}/versions/${draft.versions.at(-1)?.id}/restore`, { method: 'POST' }, adminToken)
    expect(restored.title).toBe(draft.title)
    expect(restored.versions.length).toBeGreaterThan(draft.versions.length)
    await call(`/admin/resources/${resourceId}/publish`, { method: 'POST' }, adminToken)
    const detail = await call<{ file: { id: string }; views: number }>(`/resources/e2e-resource-${suffix}`)
    expect(detail.file.id).toBe(fileId)
    await call(`/admin/resources/${resourceId}`, { method: 'PATCH', body: JSON.stringify({ title: '资源未发布新标题' }) }, adminToken)
    expect((await call<{ title: string }>(`/resources/e2e-resource-${suffix}`)).title).toBe(draft.title)
    await call(`/admin/resources/${resourceId}/publish`, { method: 'POST' }, adminToken)
    expect((await call<{ title: string }>(`/resources/e2e-resource-${suffix}`)).title).toBe('资源未发布新标题')
    const unchanged = await call<{ views: number }>(`/resources/e2e-resource-${suffix}`)
    expect(unchanged.views).toBe(detail.views)
    expect((await call<{ counted: boolean }>('/events/view', { method: 'POST', body: JSON.stringify({ targetType: 'resource', targetSlug: `e2e-resource-${suffix}` }) }, studentToken)).counted).toBe(true)
    expect((await call<{ counted: boolean }>('/events/view', { method: 'POST', body: JSON.stringify({ targetType: 'resource', targetSlug: `e2e-resource-${suffix}` }) }, studentToken)).counted).toBe(false)
    expect((await call<{ views: number }>(`/resources/e2e-resource-${suffix}`)).views).toBe(detail.views + 1)
    const download = await fetch(`${base}/files/${fileId}/download`, { headers: { authorization: `Bearer ${studentToken}` } })
    expect(download.status).toBe(200)
    expect(await download.text()).toBe('端到端资源内容')
  })

  it('资讯发布与阅读计数写回 PostgreSQL', async () => {
    const article = await call<{ databaseId: string }>('/admin/articles', {
      method: 'POST',
      body: JSON.stringify({ slug: `e2e-article-${suffix}`, title: '端到端资讯', summary: '真实资讯阅读统计。', category: 'AI 安全', blocks: [{ type: 'paragraph', text: '正文' }] }),
    }, adminToken)
    articleId = article.databaseId
    await call(`/admin/articles/${articleId}/recommendations`, {
      method: 'PUT',
      body: JSON.stringify({ items: [{ positionKey: 'frontier_hero', sortOrder: 1, enabled: true }] }),
    }, adminToken)
    await call(`/admin/articles/${articleId}/publish`, { method: 'POST' }, adminToken)
    const first = await call<{ views: number }>(`/articles/e2e-article-${suffix}`)
    const second = await call<{ views: number; recommendations: unknown[] }>(`/articles/e2e-article-${suffix}`)
    expect(second.views).toBe(first.views)
    expect(second.recommendations.length).toBe(1)
    expect((await call<{ counted: boolean }>('/events/view', { method: 'POST', body: JSON.stringify({ targetType: 'article', targetSlug: `e2e-article-${suffix}` }) }, studentToken)).counted).toBe(true)
    expect((await call<{ views: number }>(`/articles/e2e-article-${suffix}`)).views).toBe(first.views + 1)
    await call(`/admin/articles/${articleId}`, { method: 'PATCH', body: JSON.stringify({ title: '资讯未发布新标题' }) }, adminToken)
    expect((await call<{ title: string }>(`/articles/e2e-article-${suffix}`)).title).toBe('端到端资讯')
    await call(`/admin/articles/${articleId}/publish`, { method: 'POST' }, adminToken)
    expect((await call<{ title: string }>(`/articles/e2e-article-${suffix}`)).title).toBe('资讯未发布新标题')
  })

  it('学生收藏回写后管理端读取同一用户成长数据', async () => {
    await call('/favorites', { method: 'POST', body: JSON.stringify({ targetType: 'course', targetId: slug }) }, studentToken)
    const growth = await call<{ favorites: Array<{ targetId: string }> }>(`/admin/users/${studentId}/growth`, {}, adminToken)
    expect(growth.favorites.some((item) => item.targetId === slug)).toBe(true)
  })

  it('实训运行与提交写入真实记录并累积成长积分', async () => {
    const definition = await call<{ steps: Array<{ instruction: { action?: string } }> }>('/labs/model-service')
    const run = await call<{ id: string }>('/labs/model-service/runs', { method: 'POST' }, studentToken)
    await call(`/lab-runs/${run.id}/actions`, { method: 'POST', body: JSON.stringify({ action: 'run' }) }, studentToken)
    for (const step of definition.steps) {
      await call(`/lab-runs/${run.id}/actions`, { method: 'POST', body: JSON.stringify({ action: step.instruction.action || 'confirm' }) }, studentToken)
    }
    const submitted = await call<{ status: string }>(`/lab-runs/${run.id}/submit`, { method: 'POST' }, studentToken)
    expect(submitted.status).toBe('submitted')
  })

  it('统一题库公开接口不含答案，服务端事务计算成绩', async () => {
    const challengeList = await call<{ items: Array<{ slug: string; targetScore: number; rewardPoints: number }> }>('/challenges?pageSize=100')
    expect(challengeList.items.find((item) => item.slug === 'weekly-ai')).toMatchObject({ targetScore: 80, rewardPoints: 300 })
    const challengePage = await call<{ items: Array<{ slug: string; databaseId: string }> }>('/admin/challenges?pageSize=100', {}, adminToken)
    const challenge = challengePage.items.find((item) => item.slug === 'weekly-ai')
    const banks = await call<Array<{ id: string }>>('/admin/question-banks', {}, adminToken)
    const bankQuestions = await call<Array<{ id: string; standardAnswer: unknown }>>(`/admin/questions?bankId=${banks[0].id}`, {}, adminToken)
    const paper = await call<{ id: string }>('/admin/papers', {
      method: 'POST',
      body: JSON.stringify({ name: `端到端试卷 ${suffix}`, description: '试卷与题库只保存关联。', durationMinutes: 20, totalScore: 100, passScore: 60 }),
    }, adminToken)
    await call(`/admin/papers/${paper.id}/questions`, {
      method: 'PUT',
      body: JSON.stringify({ items: bankQuestions.map((item, index) => ({ questionId: item.id, sortOrder: index + 1, score: 100 / bankQuestions.length })) }),
    }, adminToken)
    await call(`/admin/challenges/${challenge?.databaseId}/paper`, { method: 'PUT', body: JSON.stringify({ paperId: paper.id }) }, adminToken)
    await call(`/admin/challenges/${challenge?.databaseId}`, { method: 'PATCH', body: JSON.stringify({ targetScore: 90 }) }, adminToken)
    expect((await call<{ targetScore: number }>('/challenges/weekly-ai')).targetScore).toBe(80)
    await call(`/admin/challenges/${challenge?.databaseId}/publish`, { method: 'POST' }, adminToken)
    expect((await call<{ targetScore: number }>('/challenges/weekly-ai')).targetScore).toBe(90)
    const questions = await call<Array<Record<string, unknown>>>('/challenges/weekly-ai/questions', {}, studentToken)
    expect(questions.length).toBeGreaterThan(0)
    expect(questions.every((question) => !('standardAnswer' in question))).toBe(true)
    const originalStem = String(questions[0].stem)
    await call(`/admin/questions/${questions[0].id}`, { method: 'PATCH', body: JSON.stringify({ stem: '未发布题目新题干' }) }, adminToken)
    expect(String((await call<Array<Record<string, unknown>>>('/challenges/weekly-ai/questions', {}, studentToken))[0].stem)).toBe(originalStem)
    await call(`/admin/questions/${questions[0].id}`, { method: 'PATCH', body: JSON.stringify({ status: 'published' }) }, adminToken)
    expect(String((await call<Array<Record<string, unknown>>>('/challenges/weekly-ai/questions', {}, studentToken))[0].stem)).toBe('未发布题目新题干')
    const standardAnswers = new Map(bankQuestions.map((question) => [question.id, question.standardAnswer]))
    const answers = questions.map((question) => {
      const standard = standardAnswers.get(String(question.id))
      const answer = question.questionType === 'short_answer' && standard && typeof standard === 'object' && !Array.isArray(standard)
        ? (standard as { keywords?: unknown[] }).keywords?.join(' ')
        : standard
      return { questionId: question.id, answer }
    })
    const idempotencyKey = `e2e-${Date.now()}`
    const result = await call<{ challengeId: string; score: number; total: number; correct: number; passed: boolean }>('/challenges/weekly-ai/submit', {
      method: 'POST',
      headers: { 'idempotency-key': idempotencyKey },
      body: JSON.stringify({ answers }),
    }, studentToken)
    expect(result.total).toBe(questions.length)
    expect(result.score).toBe(100)
    const duplicate = await call<typeof result>('/challenges/weekly-ai/submit', {
      method: 'POST',
      headers: { 'idempotency-key': idempotencyKey },
      body: JSON.stringify({ answers }),
    }, studentToken)
    expect(duplicate).toEqual(result)
    const growth = await call<{ achievements: unknown[]; certificates: unknown[]; knowledgeStats: unknown[] }>(`/admin/users/${studentId}/growth`, {}, adminToken)
    expect(growth.achievements.length).toBeGreaterThan(0)
    expect(growth.certificates.length).toBeGreaterThan(0)
    expect(growth.knowledgeStats.length).toBeGreaterThan(0)
    const ranking = await call<Array<{ score: number }>>('/challenges/weekly-ai/ranking', {}, studentToken)
    expect(ranking[0].score).toBeGreaterThanOrEqual(0)
  })

  it('通知发布、学生已读与操作日志真实可查', async () => {
    await call('/admin/settings', { method: 'PATCH', body: JSON.stringify({ key: 'notification_enabled', value: false }) }, adminToken)
    await call('/admin/settings', { method: 'PATCH', body: JSON.stringify({ key: 'allowed_login_domains', value: ['example.edu'] }) }, adminToken)
    const settings = await call<Array<{ key: string; value: unknown }>>('/admin/settings', {}, adminToken)
    expect(settings.find((item) => item.key === 'notification_enabled')?.value).toBe(false)
    expect(settings.find((item) => item.key === 'allowed_login_domains')?.value).toEqual(['example.edu'])
    const notification = await call<{ id: string }>('/admin/notifications', {
      method: 'POST',
      body: JSON.stringify({ title: `端到端通知 ${suffix}`, content: '真实通知内容。', audience: 'all' }),
    }, adminToken)
    notificationId = notification.id
    await call(`/admin/notifications/${notificationId}/publish`, { method: 'POST' }, adminToken)
    const notifications = await call<Array<{ id: string; readAt: string | null }>>('/me/notifications', {}, studentToken)
    expect(notifications.find((item) => item.id === notificationId)?.readAt).toBeNull()
    await call(`/me/notifications/${notificationId}/read`, { method: 'POST' }, studentToken)
    const read = await call<Array<{ id: string; readAt: string | null }>>('/me/notifications', {}, studentToken)
    expect(read.find((item) => item.id === notificationId)?.readAt).toBeTruthy()
    const operations = await call<Array<{ result: string }>>('/admin/operation-logs', {}, adminToken)
    expect(operations.some((item) => item.result === 'success')).toBe(true)
  })

  it('清理创建内容并验证公开接口不再返回', async () => {
    const modules = await call<Array<{ id: string; moduleKey: string; config: Record<string, unknown> }>>('/admin/homepage/modules', {}, adminToken)
    const hero = modules.find((item) => item.moduleKey === 'landing_hero')
    await call(`/admin/homepage/modules/${hero?.id}`, { method: 'PATCH', body: JSON.stringify({ config: { ...hero?.config, titleFirst: originalHeroTitle } }) }, adminToken)
    await call('/admin/homepage/publish', { method: 'POST' }, adminToken)
    await call(`/admin/courses/${courseId}/archive`, { method: 'POST' }, adminToken)
    const homepage = await call<PublicHomepageDto>('/public/homepage')
    expect(homepage.modules.find((item) => item.moduleKey === 'landing_hero')?.items.some((item) => item.slug === slug)).toBe(false)
    await call(`/admin/themes/${themeId}/archive`, { method: 'POST' }, adminToken)
    await call(`/admin/labs/${labId}/archive`, { method: 'POST' }, adminToken)
    await call(`/admin/resources/${resourceId}/archive`, { method: 'POST' }, adminToken)
    await call(`/admin/articles/${articleId}/archive`, { method: 'POST' }, adminToken)
    await call(`/admin/notifications/${notificationId}/archive`, { method: 'POST' }, adminToken)
    const response = await fetch(`${base}/courses/${slug}`)
    expect(response.status).toBe(404)
    expect((await fetch(`${base}/resources/e2e-resource-${suffix}`)).status).toBe(404)
    const prisma = new PrismaClient()
    try {
      const versions = await prisma.resourceVersion.findMany({ where: { resourceId }, orderBy: { versionNo: 'asc' } })
      expect(versions.some((version) => (version.snapshot as Prisma.JsonObject).fileId === fileId)).toBe(true)
      const file = await prisma.fileRecord.findUniqueOrThrow({ where: { id: fileId } })
      const deletion = await fetch(`${base}/admin/files/${fileId}`, { method: 'DELETE', headers: { authorization: `Bearer ${adminToken}` } })
      expect(deletion.status).toBe(400)
      expect((await deletion.json() as Envelope<unknown>).message).toContain('历史版本引用')
      expect(await prisma.fileRecord.findUniqueOrThrow({ where: { id: fileId } })).toEqual(file)
      expect(await prisma.resourceVersion.findMany({ where: { resourceId }, orderBy: { versionNo: 'asc' } })).toEqual(versions)
      const retained = await fetch(`${base}/files/${fileId}/download`, { headers: { authorization: `Bearer ${adminToken}` } })
      expect(retained.status).toBe(200)
      expect(await retained.text()).toBe('端到端资源内容')
      // 历史引用文件随隔离测试库/上传卷统一清理，不绕过引用保护删除。
    } finally { await prisma.$disconnect() }
  })

  it('Seed 在既有高版本首页发布历史上只追加一次稳定快照', async () => {
    const prisma = new PrismaClient()
    const runSeed = () => execFileSync(resolve('node_modules/.bin/tsx'), ['prisma/seed.ts'], {
      env: {
        ...process.env,
        LOAD_DEMO_DATA: 'true',
        SEED_ADMIN_EMAIL: adminEmail,
        SEED_ADMIN_PASSWORD: adminPassword,
        SEED_STUDENT_EMAIL: studentEmail,
        SEED_STUDENT_PASSWORD: studentPassword,
      },
      stdio: 'pipe',
    })
    try {
      const latest = await prisma.homepagePublication.findFirst({ orderBy: { version: 'desc' } })
      const legacyVersion = (latest?.version || 0) + 100
      await prisma.homepagePublication.create({ data: { version: legacyVersion, snapshot: [] } })

      runSeed()
      const first = await prisma.homepagePublication.findFirst({ orderBy: { version: 'desc' } })
      const countAfterFirst = await prisma.homepagePublication.count()
      const firstPublic = await call<{ version: number; modules: unknown[] }>('/public/homepage')
      expect(first?.version).toBe(legacyVersion + 1)
      expect(Array.isArray(first?.snapshot) ? first.snapshot : []).toHaveLength(17)
      expect(firstPublic).toMatchObject({ version: legacyVersion + 1 })
      expect(firstPublic.modules).toHaveLength(5)

      runSeed()
      const second = await prisma.homepagePublication.findFirst({ orderBy: { version: 'desc' } })
      const secondPublic = await call<{ version: number; modules: unknown[] }>('/public/homepage')
      expect(second?.version).toBe(first?.version)
      expect(await prisma.homepagePublication.count()).toBe(countAfterFirst)
      expect(Array.isArray(second?.snapshot) ? second.snapshot : []).toHaveLength(17)
      expect(secondPublic).toMatchObject({ version: legacyVersion + 1 })
      expect(secondPublic.modules).toHaveLength(5)
    } finally {
      await prisma.$disconnect()
    }
  })

  it('落地页服务端固定五区域、六能力与推荐上限，拒绝旧自由搭建和外链', async () => {
    const modules = await call<Array<{ id: string; moduleKey: typeof LANDING_MODULE_KEYS[number]; config: Record<string, unknown>; items: unknown[] }>>('/admin/homepage/modules', {}, adminToken)
    expect(modules.map((item) => item.moduleKey)).toEqual(LANDING_MODULE_KEYS)
    const rejected = async (path: string, method: string, input: unknown) => (await fetch(`${base}${path}`, { method, headers: { authorization: `Bearer ${adminToken}`, 'content-type': 'application/json' }, body: JSON.stringify(input) })).status
    expect(await rejected('/admin/homepage/modules', 'POST', { moduleKey: 'hero_banner', moduleName: '旧自由模块' })).toBe(400)
    expect(await rejected('/admin/homepage/modules/reorder', 'PUT', { items: modules.map((item, index) => ({ id: item.id, sortOrder: 4 - index })) })).toBe(400)
    const hero = modules[0], abilities = modules[1]
    expect(await rejected(`/admin/homepage/modules/${hero.id}`, 'PATCH', { enabled: false })).toBe(400)
    expect(await rejected(`/admin/homepage/modules/${hero.id}`, 'PATCH', { config: { ...hero.config, image: 'https://unsafe.example/a.svg' } })).toBe(400)
    expect(await rejected(`/admin/homepage/modules/${hero.id}`, 'PATCH', { config: { ...hero.config, constructor: 'unexpected' } })).toBe(400)
    expect(await rejected(`/admin/homepage/modules/${abilities.id}`, 'PATCH', { config: { ...abilities.config, items: LANDING_DEFAULT_CONFIG.landing_capabilities.items.slice(0, 5) } })).toBe(400)
    expect(await rejected(`/admin/homepage/modules/${hero.id}/items`, 'POST', { targetType: 'theme', targetId: 'llm' })).toBe(400)
    expect(await rejected(`/admin/homepage/modules/${hero.id}/items`, 'POST', { targetType: 'course', targetId: 'llm-zero' })).toBe(400)
    const page = await call<PublicHomepageDto>('/public/homepage')
    expect(page.pageMode).toBe('community_landing_v1')
    expect(page.modules.map((item) => item.moduleKey)).toEqual(LANDING_MODULE_KEYS)
  })

  it('落地页公开关联实时过滤撤回内容、停用作者、私有资源，覆盖字段只随发布生效', async () => {
    const prisma = new PrismaClient()
    const modules = await call<Array<{ id: string; moduleKey: string; items: Array<{ id: string; targetType: string; targetId: string; sortOrder: number }> }>>('/admin/homepage/modules', {}, adminToken)
    const featured = modules.find((item) => item.moduleKey === 'landing_featured')!
    const postItem = featured.items.find((item) => item.targetType === 'community_post')!
    const row = await prisma.communityPost.findUniqueOrThrow({ where: { id: postItem.targetId } })
    const owner = await prisma.user.findUniqueOrThrow({ where: { id: row.authorId } })
    const schoolId = owner.schoolId || (await prisma.school.findFirstOrThrow()).id
    const containsPost = async () => (await call<PublicHomepageDto>('/public/homepage')).modules.flatMap((module) => module.items).some((item) => item.targetType === 'community_post' && item.slug === row.id)
    try {
      expect(await containsPost()).toBe(true)
      const raw = JSON.stringify(await call('/public/homepage'))
      for (const field of ['passwordHash', 'email', 'phone', 'userRoles', 'permissions', 'contentBlocks', 'schoolId']) expect(raw).not.toContain(`"${field}"`)
      const override = { targetType: postItem.targetType, targetId: postItem.targetId, sortOrder: postItem.sortOrder, titleOverride: '落地页覆盖标题', summaryOverride: '落地页覆盖摘要', coverOverride: 'robotCar' }
      await call(`/admin/homepage/modules/${featured.id}/items/${postItem.id}`, { method: 'PATCH', body: JSON.stringify(override) }, adminToken)
      expect(JSON.stringify(await call('/public/homepage'))).not.toContain('落地页覆盖标题')
      const preview = await call<PublicHomepageDto>('/admin/homepage/preview', {}, adminToken)
      expect(preview.modules.flatMap((module) => module.items).find((item) => item.slug === row.id && item.title === '落地页覆盖标题')).toMatchObject({ summary: '落地页覆盖摘要', data: { cover: 'robotCar' } })
      await call('/admin/homepage/publish', { method: 'POST' }, adminToken)
      expect(JSON.stringify(await call('/public/homepage'))).toContain('落地页覆盖标题')
      for (const mutation of [{ status: 'hidden' as const }, { status: 'published' as const, visibility: 'school' as const, schoolId }, { visibility: 'public' as const, deletedAt: new Date() }]) {
        await prisma.communityPost.update({ where: { id: row.id }, data: mutation })
        expect(await containsPost()).toBe(false)
        expect(JSON.stringify(await call('/public/homepage'))).not.toContain('落地页覆盖标题')
      }
      await prisma.communityPost.update({ where: { id: row.id }, data: { status: row.status, visibility: row.visibility, schoolId: row.schoolId, deletedAt: row.deletedAt } })
      await prisma.user.update({ where: { id: owner.id }, data: { status: 'disabled' } })
      expect(await containsPost()).toBe(false)
      const admin = await call<Array<{ items: Array<{ id: string; relationValid: boolean }> }>>('/admin/homepage/modules', {}, adminToken)
      expect(admin.flatMap((module) => module.items).find((item) => item.id === postItem.id)?.relationValid).toBe(false)
    } finally {
      await prisma.communityPost.update({ where: { id: row.id }, data: { status: row.status, visibility: row.visibility, schoolId: row.schoolId, deletedAt: row.deletedAt } })
      await prisma.user.update({ where: { id: owner.id }, data: { status: owner.status } })
      await prisma.$disconnect()
    }
    const db = new PrismaClient()
    const targetModule = featured, removable = targetModule.items.at(-1)!
    const resource = await db.resource.findFirstOrThrow({ where: { status: 'published', visibility: 'public', deletedAt: null, id: { notIn: targetModule.items.map((item) => item.targetId) }, slug: { notIn: targetModule.items.map((item) => item.targetId) } }, include: { publishedVersion: true } })
    await call(`/admin/homepage/modules/${targetModule.id}/items/${removable.id}`, { method: 'DELETE' }, adminToken)
    let relationId = '', privateVersionId = ''
    try {
      await db.resource.update({ where: { id: resource.id }, data: { visibility: 'authenticated' } })
      const request = () => fetch(`${base}/admin/homepage/modules/${targetModule.id}/items`, { method: 'POST', headers: { authorization: `Bearer ${adminToken}`, 'content-type': 'application/json' }, body: JSON.stringify({ targetType: 'resource', targetId: resource.id, sortOrder: removable.sortOrder }) })
      expect((await request()).status).toBe(400)
      await db.resource.update({ where: { id: resource.id }, data: { visibility: 'public' } })
      const added = await call<{ id: string }>(`/admin/homepage/modules/${targetModule.id}/items`, { method: 'POST', body: JSON.stringify({ targetType: 'resource', targetId: resource.id, sortOrder: removable.sortOrder }) }, adminToken)
      relationId = added.id
      await call('/admin/homepage/publish', { method: 'POST' }, adminToken)
      await db.resource.update({ where: { id: resource.id }, data: { visibility: 'authenticated' } })
      expect((await call<PublicHomepageDto>('/public/homepage')).modules.flatMap((module) => module.items).some((item) => item.targetType === 'resource' && item.slug === resource.slug)).toBe(false)
      const lastVersion = await db.resourceVersion.findFirstOrThrow({ where: { resourceId: resource.id }, orderBy: { versionNo: 'desc' } })
      const privateVersion = await db.resourceVersion.create({ data: { resourceId: resource.id, versionNo: lastVersion.versionNo + 1, snapshot: { ...(resource.publishedVersion!.snapshot as Prisma.InputJsonObject), visibility: 'authenticated' } } })
      privateVersionId = privateVersion.id
      await db.resource.update({ where: { id: resource.id }, data: { visibility: 'public', publishedVersionId: privateVersion.id } })
      expect((await request()).status).toBe(400)
      expect((await call<PublicHomepageDto>('/public/homepage')).modules.flatMap((module) => module.items).some((item) => item.targetType === 'resource' && item.slug === resource.slug)).toBe(false)
    } finally {
      await db.resource.update({ where: { id: resource.id }, data: { visibility: resource.visibility, publishedVersionId: resource.publishedVersionId } })
      if (privateVersionId) await db.resourceVersion.delete({ where: { id: privateVersionId } })
      if (relationId) await call(`/admin/homepage/modules/${targetModule.id}/items/${relationId}`, { method: 'DELETE' }, adminToken)
      await call(`/admin/homepage/modules/${targetModule.id}/items`, { method: 'POST', body: JSON.stringify({ targetType: removable.targetType, targetId: removable.targetId, sortOrder: removable.sortOrder }) }, adminToken)
      await db.$disconnect()
    }
  })

  it('首屏第5帖子失效时确定性补位且不推动其他槽位，无候选时保留空槽', async () => {
    const db = new PrismaClient()
    let hiddenIds: string[] = []
    const hero = await db.homepageModule.findUniqueOrThrow({ where: { moduleKey: 'landing_hero' }, include: { items: { orderBy: { sortOrder: 'asc' } } } })
    const fifth = hero.items.find((item) => item.sortOrder === 4)!
    const post = await db.communityPost.findUniqueOrThrow({ where: { id: fifth.targetId } })
    const earlierPostIds = hero.items.filter((item) => item.sortOrder < 4 && item.targetType === 'community_post').map((item) => item.targetId)
    const original = await call<PublicHomepageDto>('/public/homepage')
    const originalHero = original.modules.find((module) => module.moduleKey === 'landing_hero')!
    const firstFour = originalHero.items.filter((item) => (item.slot ?? 0) < 4).map((item) => ({ slot: item.slot, slug: item.slug, title: item.title }))
    try {
      await db.communityPost.update({ where: { id: post.id }, data: { status: 'hidden' } })
      const expected = await db.communityPost.findFirstOrThrow({
        where: { id: { notIn: earlierPostIds }, status: 'published', visibility: 'public', deletedAt: null, publishedAt: { not: null }, author: { status: 'active' } },
        orderBy: [{ publishedAt: 'desc' }, { id: 'desc' }],
      })
      for (const path of ['/public/homepage', '/admin/homepage/preview']) {
        const page = await call<PublicHomepageDto>(path, {}, path.startsWith('/admin') ? adminToken : undefined)
        const items = page.modules.find((module) => module.moduleKey === 'landing_hero')!.items
        expect(items.map((item) => item.slot)).toEqual([0, 1, 2, 3, 4])
        expect(items.filter((item) => (item.slot ?? 0) < 4).map((item) => ({ slot: item.slot, slug: item.slug, title: item.title }))).toEqual(firstFour)
        expect(items.find((item) => item.slot === 4)).toMatchObject({ targetType: 'community_post', slug: expected.id })
      }
      const rejected = await fetch(`${base}/admin/homepage/publish`, { method: 'POST', headers: { authorization: `Bearer ${adminToken}` } })
      expect(rejected.status).toBe(400)
      expect((await rejected.json()).message).toContain('社区帖子已隐藏')

      const eligible = await db.communityPost.findMany({
        where: { id: { notIn: earlierPostIds }, status: 'published', visibility: 'public', deletedAt: null, publishedAt: { not: null }, author: { status: 'active' } },
        select: { id: true, status: true },
      })
      hiddenIds = eligible.map((item) => item.id)
      await db.communityPost.updateMany({ where: { id: { in: eligible.map((item) => item.id) } }, data: { status: 'hidden' } })
      for (const path of ['/public/homepage', '/admin/homepage/preview']) {
        const page = await call<PublicHomepageDto>(path, {}, path.startsWith('/admin') ? adminToken : undefined)
        const items = page.modules.find((module) => module.moduleKey === 'landing_hero')!.items
        expect(items.map((item) => item.slot)).toEqual([0, 1, 2, 3])
        expect(items.map((item) => ({ slot: item.slot, slug: item.slug, title: item.title }))).toEqual(firstFour)
      }
    } finally {
      if (hiddenIds.length) await db.communityPost.updateMany({ where: { id: { in: hiddenIds } }, data: { status: 'published' } })
      await db.communityPost.update({ where: { id: post.id }, data: { status: post.status } })
      await db.$disconnect()
    }
  })

  it('窄升级只替换首屏第5帖子并新增一次发布，重复执行零写', async () => {
    const prisma = new PrismaClient()
    let originalPost: { id: string; status: CommunityPostStatus } | null = null
    try {
      const old = await prisma.homepageModule.findMany({ where: { moduleKey: { notIn: [...LANDING_MODULE_KEYS] } }, include: { items: true, versions: true }, orderBy: { id: 'asc' } })
      const hero = await prisma.homepageModule.findUniqueOrThrow({ where: { moduleKey: 'landing_hero' }, include: { items: { orderBy: { sortOrder: 'asc' } } } })
      const fifth = hero.items.find((item) => item.sortOrder === 4)!
      const post = await prisma.communityPost.findUniqueOrThrow({ where: { id: fifth.targetId } })
      originalPost = { id: post.id, status: post.status }
      const earlierPostIds = hero.items.filter((item) => item.sortOrder < 4 && item.targetType === 'community_post').map((item) => item.targetId)
      await prisma.communityPost.update({ where: { id: post.id }, data: { status: 'hidden' } })
      const expected = await prisma.communityPost.findFirstOrThrow({
        where: { id: { notIn: earlierPostIds }, status: 'published', visibility: 'public', deletedAt: null, publishedAt: { not: null }, author: { status: 'active' } },
        orderBy: [{ publishedAt: 'desc' }, { id: 'desc' }],
      })
      const before = await prisma.homepagePublication.count()
      const latestBefore = await prisma.homepagePublication.findFirstOrThrow({ orderBy: { version: 'desc' } })
      expect(await upgradeLanding(prisma)).toMatchObject({ changed: true, version: latestBefore.version + 1, repairedPostId: expected.id })
      const repaired = await prisma.homepageModule.findUniqueOrThrow({ where: { id: hero.id }, include: { items: { orderBy: { sortOrder: 'asc' } } } })
      expect(repaired.items.slice(0, 4)).toEqual(hero.items.slice(0, 4))
      expect(repaired.items.find((item) => item.sortOrder === 4)).toMatchObject({ targetType: 'community_post', targetId: expected.id, sortOrder: 4 })
      expect((await upgradeLanding(prisma)).changed).toBe(false)
      expect(await prisma.homepagePublication.count()).toBe(before + 1)
      expect(await prisma.homepageModule.findMany({ where: { moduleKey: { notIn: [...LANDING_MODULE_KEYS] } }, include: { items: true, versions: true }, orderBy: { id: 'asc' } })).toEqual(old)
      expect(old).toHaveLength(12)
      const latest = await prisma.homepagePublication.findFirstOrThrow({ orderBy: { version: 'desc' } })
      expect(latest.snapshot).toHaveLength(17)
    } finally {
      if (originalPost) await prisma.communityPost.update({ where: { id: originalPost.id }, data: { status: originalPost.status } })
      await prisma.$disconnect()
    }
  })

  it('话题停用与创作者禁用后公共投影即时消失，配置数量在服务端约束', async () => {
    const db = new PrismaClient()
    const modules = await call<Array<{ id: string; moduleKey: string; items: Array<{ id: string; targetType: string; targetId: string }> }>>('/admin/homepage/modules', {}, adminToken)
    const overview = modules.find((module) => module.moduleKey === 'landing_community_overview')!
    const topicItem = overview.items.find((item) => item.targetType === 'community_topic')!
    const creatorItem = overview.items.find((item) => item.targetType === 'community_user')!
    const topic = await db.communityTopic.findUniqueOrThrow({ where: { id: topicItem.targetId } })
    const user = await db.user.findUniqueOrThrow({ where: { id: creatorItem.targetId } })
    try {
      await call('/admin/homepage/publish', { method: 'POST' }, adminToken)
      await db.communityTopic.update({ where: { id: topic.id }, data: { status: 'disabled' } })
      await db.user.update({ where: { id: user.id }, data: { status: 'disabled' } })
      const page = await call<PublicHomepageDto>('/public/homepage')
      expect(page.modules.flatMap((module) => module.items).some((item) => item.targetType === 'community_topic' && item.slug === topic.slug)).toBe(false)
      expect(page.community?.creators.some((creator) => creator.id === user.id)).toBe(false)
      const states = await call<Array<{ items: Array<{ id: string; relationValid: boolean }> }>>('/admin/homepage/modules', {}, adminToken)
      expect(states.flatMap((module) => module.items).filter((item) => [topicItem.id, creatorItem.id].includes(item.id)).every((item) => item.relationValid === false)).toBe(true)
      const extraTopic = await db.communityTopic.findFirstOrThrow({ where: { status: 'active', id: { notIn: overview.items.map((item) => item.targetId) } } })
      const response = await fetch(`${base}/admin/homepage/modules/${overview.id}/items`, { method: 'POST', headers: { authorization: `Bearer ${adminToken}`, 'content-type': 'application/json' }, body: JSON.stringify({ targetType: 'community_topic', targetId: extraTopic.id }) })
      expect(response.status).toBe(400)
    } finally {
      await db.communityTopic.update({ where: { id: topic.id }, data: { status: topic.status } })
      await db.user.update({ where: { id: user.id }, data: { status: user.status } })
      await db.$disconnect()
    }
  })

  it('并发添加最后一个推荐位仅成功一次，草稿版本与发布原子一致', async () => {
    const db = new PrismaClient()
    const hero = await db.homepageModule.findUniqueOrThrow({ where: { moduleKey: 'landing_hero' }, include: { items: { orderBy: { sortOrder: 'asc' } } } })
    const displaced = hero.items.at(-1)!
    const candidates = await db.communityPost.findMany({
      where: { status: 'published', visibility: 'public', deletedAt: null, publishedAt: { not: null }, author: { status: 'active' }, id: { notIn: hero.items.filter((item) => item.targetType === 'community_post').map((item) => item.targetId) } },
      orderBy: [{ publishedAt: 'desc' }, { id: 'desc' }],
      take: 2,
    })
    expect(candidates).toHaveLength(2)
    const addedIds: string[] = []
    try {
      await call(`/admin/homepage/modules/${hero.id}/items/${displaced.id}`, { method: 'DELETE' }, adminToken)
      const versions = await db.homepageModuleVersion.count({ where: { moduleId: hero.id } })
      const responses = await Promise.all(candidates.map((post) => fetch(`${base}/admin/homepage/modules/${hero.id}/items`, { method: 'POST', headers: { authorization: `Bearer ${adminToken}`, 'content-type': 'application/json' }, body: JSON.stringify({ targetType: 'community_post', targetId: post.id, sortOrder: 4 }) })))
      for (const response of responses) if (response.ok) addedIds.push(((await response.json()) as Envelope<{ id: string }>).data.id)
      expect(responses.map((response) => response.status).sort()).toEqual([201, 400])
      expect(await db.homepageItem.count({ where: { moduleId: hero.id } })).toBe(5)
      expect(await db.homepageModuleVersion.count({ where: { moduleId: hero.id } })).toBe(versions)
      const latest = await db.homepageModule.findUniqueOrThrow({ where: { id: hero.id }, include: { currentDraftVersion: true } })
      expect((latest.currentDraftVersion!.snapshot as { items: unknown[] }).items).toHaveLength(5)
      expect(latest.currentDraftVersionId).not.toBe(latest.publishedVersionId)
      await call('/admin/homepage/publish', { method: 'POST' }, adminToken)
      expect((await call<PublicHomepageDto>('/public/homepage')).modules[0].items).toHaveLength(5)
    } finally {
      for (const id of addedIds) await call(`/admin/homepage/modules/${hero.id}/items/${id}`, { method: 'DELETE' }, adminToken)
      const { targetType, targetId, titleOverride, summaryOverride, coverOverride, sortOrder } = displaced
      await call(`/admin/homepage/modules/${hero.id}/items`, { method: 'POST', body: JSON.stringify(Object.fromEntries(Object.entries({ targetType, targetId, titleOverride, summaryOverride, coverOverride, sortOrder }).filter(([, value]) => value !== null))) }, adminToken)
      await call('/admin/homepage/publish', { method: 'POST' }, adminToken)
      await db.$disconnect()
    }
  })
})
