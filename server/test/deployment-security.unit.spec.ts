import { describe, expect, it, vi } from 'vitest'
import { ConfigService } from '@nestjs/config'
import { createHash, randomBytes } from 'node:crypto'
import type { NextFunction, Request, Response } from 'express'
import { browserBoundary, inNetwork, networkList, secureCookie, validateDeployment } from '../src/common/deployment-security'
import { decryptMfa, encryptMfa } from '../src/modules/auth/mfa-crypto'
import { passwordProblem } from '@ai-learning-hub/contracts'
import { RequestIdMiddleware } from '../src/common/request-id.middleware'
import { PermissionsGuard } from '../src/modules/auth/permissions.guard'
import type { ExecutionContext } from '@nestjs/common'
import type { Reflector } from '@nestjs/core'
import { AuthController } from '../src/modules/auth/auth.controller'
import { AuthService } from '../src/modules/auth/auth.service'
import { JwtService } from '@nestjs/jwt'

const settings = () => ({
  DEPLOYMENT_PROFILE: 'production', LOAD_DEMO_DATA: 'false', VITE_DATA_MODE: 'api', COOKIE_SECURE: 'true',
  FRONTEND_URL: 'https://learn.campus.edu.cn', ADMIN_WEB_URL: 'https://admin.campus.edu.cn',
  CORS_ORIGINS: 'https://learn.campus.edu.cn,https://admin.campus.edu.cn',
  TRUSTED_PROXY_CIDRS: '172.30.80.10/32,172.30.80.11/32', ADMIN_NETWORK_CIDRS: '10.50.1.0/24',
  JWT_SECRET: randomBytes(48).toString('base64url'), MFA_DATA_KEY: randomBytes(32).toString('hex'),
  IDENTITY_DATA_KEY: randomBytes(32).toString('hex'), VIDEO_PLAYBACK_SECRET: randomBytes(48).toString('base64url'),
  POSTGRES_PASSWORD: '17dd199a291373d808808a6860755be333a49',
  DATABASE_URL: 'postgresql://ai_hub:17dd199a291373d808808a6860755be333a49@postgres:5432/ai_learning_hub',
})
function boundary(path: string, headers: Record<string, string> = {}, patch: Record<string, unknown> = {}, config = new ConfigService(settings())) {
  const next = vi.fn(), response = { status: vi.fn().mockReturnThis(), json: vi.fn(), setHeader: vi.fn() }
  const request = { path, method: 'POST', ip: '10.50.1.2', secure: true, get: (name: string) => headers[name], is: (value: string) => headers['content-type'] === value, ...patch }
  browserBoundary(config)(request as unknown as Request, response as unknown as Response, next as NextFunction)
  return { next, response }
}
describe('正式部署硬条件', () => {
  it('可选第二学生端必须有独立 Origin 和精确对应的第三代理', () => {
    const values = { ...settings(), SECONDARY_FRONTEND_URL: 'https://snow.campus.edu.cn', CORS_ORIGINS: settings().CORS_ORIGINS + ',https://snow.campus.edu.cn', TRUSTED_PROXY_CIDRS: settings().TRUSTED_PROXY_CIDRS + ',172.30.80.12/32' }
    expect(() => validateDeployment(new ConfigService(values))).not.toThrow()
    expect(() => validateDeployment(new ConfigService({ ...values, TRUSTED_PROXY_CIDRS: settings().TRUSTED_PROXY_CIDRS }))).toThrow('TRUSTED_PROXY_CIDRS')
    expect(() => validateDeployment(new ConfigService({ ...values, SECONDARY_FRONTEND_URL: values.FRONTEND_URL }))).toThrow('Origin')
    expect(() => validateDeployment(new ConfigService({ ...values, SECONDARY_FRONTEND_URL: 'https://snow.campus.edu.cn/path' }))).toThrow('Origin')
    expect(() => validateDeployment(new ConfigService({ ...values, CORS_ORIGINS: values.CORS_ORIGINS + ',https://other.campus.edu.cn' }))).toThrow('CORS_ORIGINS')
  })
  it('完整正式配置通过，Secure Cookie 缺省仍安全', () => {
    expect(() => validateDeployment(new ConfigService(settings()))).not.toThrow()
    expect(secureCookie(new ConfigService())).toBe(true)
    for (const path of ['/api/v1/health', '/api/v1/health/live', '/api/v1/health/ready']) expect(boundary(path, {}, { method: 'GET', secure: false }).next).toHaveBeenCalledOnce()
    expect(boundary('/api/v1/version', {}, { method: 'GET', secure: false }).response.status).toHaveBeenCalledWith(403)
    expect(() => validateDeployment(new ConfigService({ ...settings(), TRUSTED_PROXY_CIDRS: '172.30.80.10/32,172.30.80.10/32' }))).toThrow('TRUSTED_PROXY_CIDRS')
  })
  it.each([
    ['LOAD_DEMO_DATA', 'true'], ['VITE_DATA_MODE', 'mock'], ['COOKIE_SECURE', 'false'], ['COOKIE_SECURE', 'yes'],
    ['SWAGGER_ENABLED', 'true'], ['SMTP_ALLOW_INSECURE', 'true'], ['JWT_SECRET', 'change-me'],
    ['MFA_DATA_KEY', ''], ['IDENTITY_DATA_KEY', '0'.repeat(64)], ['VIDEO_PLAYBACK_SECRET', ''],
    ['FRONTEND_URL', 'http://learn.campus.edu.cn'], ['ADMIN_WEB_URL', 'https://192.168.1.2'],
    ['FRONTEND_URL', 'https://campus.example'], ['CORS_ORIGINS', '*'], ['ADMIN_NETWORK_CIDRS', '0.0.0.0/0'],
    ['TRUSTED_PROXY_CIDRS', '172.16.0.0/12'], ['EXTERNAL_PROXY_CIDRS', '::/0'], ['POSTGRES_PASSWORD', 'change-me'],
  ])('拒绝 %s 的不安全值，不在错误中输出值', (key, value) => {
    expect(() => validateDeployment(new ConfigService({ ...settings(), [key]: value }))).toThrow(key)
  })
  it('拒绝复用加密密钥及带账号/路径的 Origin', () => {
    const value = settings(); value.IDENTITY_DATA_KEY = value.MFA_DATA_KEY
    expect(() => validateDeployment(new ConfigService(value))).toThrow('不得复用')
    expect(() => validateDeployment(new ConfigService({ ...settings(), FRONTEND_URL: 'https://user:pass@learn.campus.edu.cn/' }))).toThrow('Origin')
  })
  it('只匹配明确网段，处理 IPv4 映射地址和错误 CIDR', () => {
    expect(inNetwork('::ffff:10.50.1.2', '10.50.1.0/24')).toBe(true)
    expect(inNetwork('10.50.2.2', '10.50.1.0/24')).toBe(false)
    for (const value of ['0.0.0.0/0', '::/0', '127.0.0.1/32/junk', 'true', '10.0.0.1/33']) expect(() => networkList(value)).toThrow()
  })
})
describe('Cookie、后台网络与请求来源', () => {
  it('过期旧标签不能使用另一账号的 Cookie 续期，退出只撤旧设备且保留另一账号 Cookie', async () => {
    const secret = randomBytes(48).toString('base64url'), jwt = new JwtService({ secret })
    const expired = await jwt.signAsync({ id: 'account-a', sessionId: 'device-a', sessionClient: 'student', sessionVersion: 0 }, { expiresIn: -1 })
    const revoked = vi.fn(), tx = { $queryRaw: vi.fn(), refreshToken: { updateMany: revoked } }
    const database = {
      refreshToken: {
        findUnique: vi.fn(async () => ({ id: 'device-b', userId: 'account-b', client: 'student', expiresAt: new Date(Date.now() + 60000), user: { status: 'active', sessionVersion: 0 } })),
        findFirst: vi.fn(async () => ({ id: 'device-a', userId: 'account-a', tokenHash: createHash('sha256').update('cookie-a').digest('hex') })),
      },
      $transaction: vi.fn(async (operation: (value: typeof tx) => Promise<void>) => operation(tx)),
    }
    const auth = new AuthService(database as never, jwt, new ConfigService({ JWT_SECRET: secret }), {} as never)
    await expect(auth.refresh('cookie-b', 'student', '127.0.0.1', expired)).rejects.toThrow('账号或设备已变化')
    expect(database.$transaction).not.toHaveBeenCalled()
    await expect(auth.logout('cookie-b', 'student', expired)).resolves.toBe(false)
    expect(revoked).toHaveBeenCalledWith({ where: { id: 'device-a', client: 'student', revokedAt: null }, data: { revokedAt: expect.any(Date), revocationReason: 'manual_logout' } })
    revoked.mockClear()
    await expect(auth.logout('cookie-b', 'student', expired + 'tampered')).rejects.toThrow('退出凭据无效')
    expect(revoked).not.toHaveBeenCalled()
  })

  const student = { origin: 'https://learn.campus.edu.cn', 'content-type': 'application/json' }
  const admin = { origin: 'https://admin.campus.edu.cn', 'content-type': 'application/json' }
  it('两个学生 Origin 可认证，均不能调用管理认证；第三方来源继续拒绝', () => {
    const secondary = 'https://snow.campus.edu.cn'
    const config = new ConfigService({ ...settings(), SECONDARY_FRONTEND_URL: secondary, CORS_ORIGINS: settings().CORS_ORIGINS + ',' + secondary })
    for (const origin of [student.origin, secondary]) {
      for (const action of ['login', 'refresh', 'logout']) expect(boundary('/api/v1/auth/' + action, { ...student, origin }, {}, config).next).toHaveBeenCalledOnce()
      expect(boundary('/api/v1/admin-auth/login', { ...student, origin }, {}, config).response.status).toHaveBeenCalledWith(403)
    }
    expect(boundary('/api/v1/auth/refresh', admin, {}, config).response.status).toHaveBeenCalledWith(403)
    expect(boundary('/api/v1/auth/refresh', { ...student, origin: 'https://other.campus.edu.cn' }, {}, config).response.status).toHaveBeenCalledWith(403)
  })
  it.each([undefined, 'true', 'false'])('真实认证控制器使用明确 Cookie 策略 %s，两个入口互不覆盖', async secure => {
    const auth = { login: vi.fn().mockResolvedValue({ user: {}, accessToken: 'access', refreshToken: 'refresh', expiresIn: 900 }), logout: vi.fn() }
    const controller = new AuthController(auth as never, new ConfigService({ COOKIE_SECURE: secure }), {} as never)
    for (const client of ['student', 'admin']) {
      const response = { cookie: vi.fn(), clearCookie: vi.fn(), setHeader: vi.fn() }
      const request = { path: '/api/v1/' + (client === 'student' ? 'auth' : 'admin-auth') + '/login', get: vi.fn() }
      await controller.login({ identifier: 'account', password: 'existing-password', remember: true }, '127.0.0.1', response as never, request as never)
      expect(response.cookie).toHaveBeenCalledWith(client + '_refresh', 'refresh', expect.objectContaining({
        secure: secure !== 'false', httpOnly: true, sameSite: 'lax', path: client === 'student' ? '/api/v1/auth' : '/api/v1/admin-auth',
      }))
      expect(response.cookie.mock.calls[0][2].domain).toBeUndefined()
    }
  })
  it('认证路由大小写变化也不能绕过来源检查', () => {
    expect(boundary('/api/v1/AUTH/LOGIN').response.status).toHaveBeenCalledWith(403)
    expect(boundary('/api/v1/ADMIN-AUTH/LOGIN', student).response.status).toHaveBeenCalledWith(403)
  })
  it.each(['login', 'refresh', 'logout', 'password/forgot'])('学生 %s 只接受正确 Origin 和 JSON', action => {
    const path = '/api/v1/auth/' + action
    expect(boundary(path, student).next).toHaveBeenCalledOnce()
    for (const headers of [{}, admin, { ...student, origin: 'https://evil.test' }, { ...student, 'sec-fetch-site': 'cross-site' }]) expect(boundary(path, headers).response.status).toHaveBeenCalledWith(403)
    expect(boundary(path, { origin: student.origin, 'content-type': 'text/plain' }).response.status).toHaveBeenCalledWith(415)
  })
  it.each(['/api/v1/admin/users', '/api/v1/admin-auth/login', '/api/docs', '/api/docs-json'])('后台 %s 无法通过学生网伪造头进入', path => {
    const result = boundary(path, { ...admin, 'x-forwarded-for': '10.50.1.2', 'x-forwarded-proto': 'https' }, { ip: '10.20.1.9' })
    expect(result.response.status).toHaveBeenCalledWith(403)
    expect(result.next).not.toHaveBeenCalled()
  })
  it('后台 Cookie 接口拒绝学生 Origin；HTTPS 状态由可信代理链决定', () => {
    expect(boundary('/api/v1/admin-auth/login', student).response.status).toHaveBeenCalledWith(403)
    expect(boundary('/api/v1/admin-auth/login', admin).next).toHaveBeenCalledOnce()
    expect(boundary('/api/v1/auth/login', student, { secure: false }).response.status).toHaveBeenCalledWith(403)
    expect(boundary('/api/v1/health', {}, { method: 'GET', secure: false }).next).toHaveBeenCalledOnce()
  })
  it('普通 Cookie 写请求也需要 Origin，纯 Bearer API 客户端允许无 Origin', () => {
    expect(boundary('/api/v1/me/password', { cookie: 'student_refresh=secret' }).response.status).toHaveBeenCalledWith(403)
    expect(boundary('/api/v1/me/password', { authorization: 'Bearer opaque' }).next).toHaveBeenCalledOnce()
  })
  it('仅权限数组不能冒充已完成 MFA 的后台会话', () => {
    const guard = new PermissionsGuard({ getAllAndOverride: () => ['user.read'] } as unknown as Reflector)
    for (const user of [{ permissions: ['user.read'] }, { permissions: ['user.read'], sessionClient: 'student', mfaVerified: true }, { permissions: ['user.read'], sessionClient: 'admin', mfaVerified: false }]) {
      const context = { getHandler: vi.fn(), getClass: vi.fn(), switchToHttp: () => ({ getRequest: () => ({ user }) }) } as unknown as ExecutionContext
      expect(() => guard.canActivate(context)).toThrow('MFA')
    }
  })
  it('请求ID不接受邮箱、Cookie 或凭据并绑定日志上下文', () => {
    const request = { headers: { 'x-request-id': 'email@example.test;password=private' } } as unknown as Request & { id?: string }
    const response = { locals: {}, setHeader: vi.fn(), once: vi.fn() }
    new RequestIdMiddleware().use(request, response as unknown as Response, vi.fn())
    expect(request.id).toMatch(/^[a-f0-9-]{36}$/)
    expect(JSON.stringify(response)).not.toContain('private')
  })
})
describe('MFA 密文与统一口令策略', () => {
  it('密文随机，绑定账号，拒绝错密钥、篡改与交换账号', () => {
    const key = randomBytes(32).toString('hex'), secret = 'TESTTOTPSECRET'
    const encrypted = encryptMfa(secret, key, 'u1')
    expect(encrypted).not.toContain(secret)
    expect(encryptMfa(secret, key, 'u1')).not.toBe(encrypted)
    expect(decryptMfa(encrypted, key, 'u1')).toBe(secret)
    expect(() => decryptMfa(encrypted, key, 'u2')).toThrow()
    expect(() => decryptMfa(encrypted, randomBytes(32).toString('hex'), 'u1')).toThrow()
    expect(() => decryptMfa(encrypted + 'AAAA', key, 'u1')).toThrow()
  })
  it('72 UTF-8字节边界兼容 bcrypt，弱口令和账号衍生口令被拒绝', () => {
    expect(passwordProblem('学'.repeat(23) + 'a1B')).toBeNull()
    expect(passwordProblem('学'.repeat(24) + 'a1B')).toContain('72')
    for (const password of ['Password123456', 'qwerty12345678', 'Ab1Ab1Ab1Ab1', 'onlyletterslong', '123456789012']) expect(passwordProblem(password)).toBeTruthy()
    expect(passwordProblem('xiaoming20260908', ['xiaoming@campus.edu.cn'])).toBeTruthy()
    expect(passwordProblem('GoodCampus789!')).toBeNull()
  })
})
