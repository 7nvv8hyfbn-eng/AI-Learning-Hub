import { createCipheriv, createDecipheriv, createHmac, randomBytes } from 'node:crypto'

const purposeKey = (key: Buffer, purpose: string) => createHmac('sha256', key).update(`campus-identity:${purpose}:v1`).digest()

export function parseIdentityDataKey(value?: string) {
  const source = value?.trim() || ''
  const key = /^[a-f0-9]{64}$/i.test(source) ? Buffer.from(source, 'hex') : /^[A-Za-z0-9+/]{43}=$/.test(source) ? Buffer.from(source, 'base64') : Buffer.alloc(0)
  if (key.length !== 32) throw new Error('IDENTITY_DATA_KEY 必须是32字节密钥（64位十六进制或标准Base64）')
  return key
}

export function encryptIdentity(value: string, key: Buffer, purpose: 'real-name' | 'id-number') {
  const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', purposeKey(key, purpose), iv)
  cipher.setAAD(Buffer.from(`campus-identity:${purpose}:v1`))
  const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()])
  return `v1.${iv.toString('base64url')}.${cipher.getAuthTag().toString('base64url')}.${encrypted.toString('base64url')}`
}

export function decryptIdentity(value: string, key: Buffer, purpose: 'real-name' | 'id-number') {
  const [version, iv, tag, encrypted] = value.split('.')
  if (version !== 'v1' || !iv || !tag || encrypted === undefined) throw new Error('实名密文格式无效')
  const decipher = createDecipheriv('aes-256-gcm', purposeKey(key, purpose), Buffer.from(iv, 'base64url'))
  decipher.setAAD(Buffer.from(`campus-identity:${purpose}:v1`)); decipher.setAuthTag(Buffer.from(tag, 'base64url'))
  return Buffer.concat([decipher.update(Buffer.from(encrypted, 'base64url')), decipher.final()]).toString('utf8')
}

export const identityFingerprint = (idNumber: string, key: Buffer) => createHmac('sha256', purposeKey(key, 'fingerprint')).update(idNumber).digest('hex')
export const normalizeStudentNo = (value: string) => value.trim().replace(/\s+/g, '').toUpperCase()
export const maskRealName = (value: string) => value.length <= 1 ? '*' : `${value.slice(0, 1)}${'*'.repeat(Math.min(3, value.length - 1))}`
export const maskIdNumber = (value: string) => `${value.slice(0, 4)}${'*'.repeat(Math.max(0, value.length - 8))}${value.slice(-4)}`

export function normalizeIdNumber(value: string) {
  const id = value.trim().toUpperCase()
  if (!/^\d{17}[\dX]$/.test(id)) throw new Error('身份证号格式无效')
  const year = Number(id.slice(6, 10)), month = Number(id.slice(10, 12)), day = Number(id.slice(12, 14))
  const date = new Date(Date.UTC(year, month - 1, day))
  if (year < 1900 || year > new Date().getUTCFullYear() || date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) throw new Error('身份证出生日期无效')
  const weights = [7, 9, 10, 5, 8, 4, 2, 1, 6, 3, 7, 9, 10, 5, 8, 4, 2]
  const checks = '10X98765432'
  const expected = checks[weights.reduce((sum, weight, index) => sum + Number(id[index]) * weight, 0) % 11]
  if (id[17] !== expected) throw new Error('身份证校验位无效')
  return id
}
