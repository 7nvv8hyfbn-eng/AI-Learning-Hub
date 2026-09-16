import { ForbiddenException } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { BlockList, isIP } from 'node:net'
import type { NextFunction, Request, Response } from 'express'

export const csv = (value: unknown) => String(value || '').split(',').map((item) => item.trim()).filter(Boolean)
export const studentOrigins = (config: ConfigService) => [config.get<string>('FRONTEND_URL'), config.get<string>('SECONDARY_FRONTEND_URL')].filter((value): value is string => !!value)
export const production = (config: ConfigService) => (config.get('DEPLOYMENT_PROFILE') || (config.get('NODE_ENV') === 'production' ? 'production' : 'experience')) === 'production'
export const secureCookie = (config: ConfigService) => config.get('COOKIE_SECURE') !== 'false'
export class DeploymentPreflightError extends Error {}

export function networkList(value: unknown) {
  const list = new BlockList()
  for (const cidr of csv(value)) {
    const [address, prefix, extra] = cidr.split('/')
    const version = isIP(address)
    if (!version || extra !== undefined || (prefix !== undefined && !/^\d+$/.test(prefix))) throw new Error('网段必须使用明确的 IPv4/IPv6 地址或 CIDR')
    const type = version === 4 ? 'ipv4' : 'ipv6'
    if (prefix === undefined) list.addAddress(address, type)
    else {
      const bits = Number(prefix)
      if (bits < 1 || bits > (version === 4 ? 32 : 128)) throw new Error('不允许全网段或无效 CIDR')
      list.addSubnet(address, bits, type)
    }
  }
  return list
}

export function inNetwork(ip: string | undefined, value: unknown) {
  if (!ip) return false
  const address = ip.startsWith('::ffff:') ? ip.slice(7) : ip
  const version = isIP(address)
  return !!version && networkList(value).check(address, version === 4 ? 'ipv4' : 'ipv6')
}

export function assertAdminNetwork(config: ConfigService, ip?: string) {
  if (!inNetwork(ip, config.get('ADMIN_NETWORK_CIDRS') || '127.0.0.1/32,::1/128')) throw new ForbiddenException('管理功能仅允许管理网段或校方 VPN 访问')
}

export function validateDeployment(config: ConfigService) {
  const failures: string[] = []
  const check = (ok: boolean, message: string) => { if (!ok) failures.push(message) }
  const origins = csv(config.get('CORS_ORIGINS'))
  const sites = ['FRONTEND_URL', 'ADMIN_WEB_URL', ...(config.get('SECONDARY_FRONTEND_URL') ? ['SECONDARY_FRONTEND_URL'] : [])].map((name) => {
    const value = String(config.get(name) || '')
    try {
      const url = new URL(value)
      check(['http:', 'https:'].includes(url.protocol) && url.origin === value && !url.username && !url.password, name + ' 必须是无路径的完整站点 Origin')
      if (production(config)) check(url.protocol === 'https:' && !isIP(url.hostname) && url.hostname !== 'localhost' && !/\.(invalid|example)$/.test(url.hostname), name + ' 必须使用校内 DNS 和可信 HTTPS')
    } catch { failures.push(name + ' 未配置有效外部地址') }
    return value
  })
  check(new Set(sites).size === sites.length, '学生端和管理端 Origin 必须各不相同')
  check(origins.length === sites.length && new Set(origins).size === origins.length && origins.every((origin) => sites.includes(origin)) && sites.every((site) => origins.includes(site)), 'CORS_ORIGINS 必须精确等于学生端和管理端 Origin，禁止通配或多余来源')
  check(['experience', 'production'].includes(config.get('DEPLOYMENT_PROFILE') || (production(config) ? 'production' : 'experience')), 'DEPLOYMENT_PROFILE 仅支持 experience 或 production')
  for (const name of ['TRUSTED_PROXY_CIDRS', 'EXTERNAL_PROXY_CIDRS', 'ADMIN_NETWORK_CIDRS']) {
    try { networkList(config.get(name)) } catch { failures.push(name + ' 含无效或全网段 CIDR') }
  }
  for (const name of ['COOKIE_SECURE', 'LOAD_DEMO_DATA', 'SWAGGER_ENABLED', 'SMTP_ALLOW_INSECURE']) {
    const value = config.get(name)
    check(value === undefined || value === 'true' || value === 'false', name + ' 仅支持 true 或 false')
  }
  if (production(config)) {
    check(config.get('LOAD_DEMO_DATA') === 'false', 'LOAD_DEMO_DATA 必须显式为 false')
    check(config.get('COOKIE_SECURE') !== 'false', '正式环境 COOKIE_SECURE 必须为 true')
    check(config.get('VITE_DATA_MODE') === 'api', '正式环境 VITE_DATA_MODE 必须为 api')
    check(!!config.get('TRUSTED_PROXY_CIDRS'), '必须明确配置 TRUSTED_PROXY_CIDRS，只包含内层 Nginx 地址')
    check(!!config.get('ADMIN_NETWORK_CIDRS'), '必须明确配置 ADMIN_NETWORK_CIDRS')
    check(config.get('SWAGGER_ENABLED') !== 'true', '正式环境 SWAGGER_ENABLED 必须为 false')
    check(config.get('SMTP_ALLOW_INSECURE') !== 'true', '正式环境 SMTP_ALLOW_INSECURE 必须为 false')
    const proxies = csv(config.get('TRUSTED_PROXY_CIDRS'))
    const expectedProxies = [config.get('STUDENT_PROXY_IP') || '172.30.80.10', config.get('ADMIN_PROXY_IP') || '172.30.80.11', ...(config.get('SECONDARY_FRONTEND_URL') ? [config.get('SECONDARY_STUDENT_PROXY_IP') || '172.30.80.12'] : [])].map(ip => ip + '/32')
    check(proxies.length === expectedProxies.length && new Set(proxies).size === expectedProxies.length && expectedProxies.every(ip => proxies.includes(ip)), 'TRUSTED_PROXY_CIDRS 必须精确对应 Compose 启用的 Nginx 固定 IP /32')
    const secretNames = ['JWT_SECRET', 'MFA_DATA_KEY', 'IDENTITY_DATA_KEY', 'VIDEO_PLAYBACK_SECRET']
    const values = secretNames.map((name) => String(config.get(name) || ''))
    secretNames.forEach((name, i) => check(name.endsWith('_SECRET') ? values[i].length >= 48 && !/change|example|password|secret/i.test(values[i]) && new Set(values[i]).size >= 16 : /^[a-f0-9]{64}$/i.test(values[i]) && new Set(values[i]).size >= 8, name + ' 必须是独立随机密钥；签名密钥至少48字符，加密密钥64位十六进制'))
    check(new Set(values).size === values.length, 'JWT、媒体、MFA 和实名加密密钥不得复用')
    const databasePassword = String(config.get('POSTGRES_PASSWORD') || '')
    check(databasePassword.length >= 24 && !/change|example|password/i.test(databasePassword) && new Set(databasePassword).size >= 8, 'POSTGRES_PASSWORD 必须是至少24字符的随机密码')
    try {
      const database = new URL(String(config.get('DATABASE_URL') || ''))
      check(database.hostname === 'postgres' && decodeURIComponent(database.password) === databasePassword, 'DATABASE_URL 必须使用内部 postgres 服务和正确数据库密码')
    } catch { failures.push('DATABASE_URL 格式无效') }
  }
  if (failures.length) throw new DeploymentPreflightError('部署预检失败：\n- ' + failures.join('\n- '))
}

/** 同站不同端口也是不同 Origin；仅 CORS 不会阻止 Cookie 请求造成副作用。 */
export function browserBoundary(config: ConfigService) {
  const allowed = csv(config.get('CORS_ORIGINS'))
  return (request: Request, response: Response, next: NextFunction) => {
    const path = request.path.toLowerCase()
    if (production(config) && !/^\/api\/v1\/health(?:\/(?:live|ready))?$/.test(path) && !request.secure) {
      response.status(403).json({ code: 40301, message: '正式环境仅接受可信代理转发的 HTTPS 请求', data: null }); return
    }
    if (/^\/api\/(?:v1\/)?(?:admin(?:\/|-auth(?:\/|$))|docs)/i.test(path)) {
      try { assertAdminNetwork(config, request.ip) } catch {
        response.status(403).json({ code: 40301, message: '管理功能仅允许管理网段或校方 VPN 访问', data: null }); return
      }
    }
    if (/^\/api\/v1\/(?:auth|admin-auth)(?:\/|$)/.test(path)) response.setHeader('Cache-Control', 'no-store')
    if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(request.method)) {
      const origin = request.get('origin')
      const cookieEndpoint = /^\/api\/v1\/(?:auth|admin-auth)(?:\/|$)/.test(path)
      const hasCookies = !!request.get('cookie')
      if ((origin && !allowed.includes(origin)) || ((!origin || request.get('sec-fetch-site') === 'cross-site') && (cookieEndpoint || hasCookies))) {
        response.status(403).json({ code: 40301, message: '请求来源校验失败，请从正确的站点重新操作', data: null }); return
      }
      if (cookieEndpoint && !request.is('application/json')) {
        response.status(415).json({ code: 41501, message: '认证接口仅接受 application/json', data: null }); return
      }
      const expected = path.startsWith('/api/v1/admin-auth/') ? [config.get<string>('ADMIN_WEB_URL')] : path.startsWith('/api/v1/auth/') ? studentOrigins(config) : undefined
      if (expected && !expected.includes(origin)) {
        response.status(403).json({ code: 40301, message: '请使用对应的登录入口', data: null }); return
      }
    }
    next()
  }
}
