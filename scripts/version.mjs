import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
export const apps = ['frontend', 'admin-web', 'server']
export const versionFiles = ['version.md', ...apps.flatMap(app => [`${app}/package.json`, `${app}/package-lock.json`])]
export const read = path => readFileSync(resolve(root, path), 'utf8')

export function parseVersion(document) {
  const matches = [...document.matchAll(/^当前版本：v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/gm)]
  if (matches.length !== 1) throw new Error('version.md 必须包含唯一的“当前版本：vX.Y.Z”')
  const version = matches[0].slice(1).join('.')
  if (!document.includes(`| v${version} | `)) throw new Error('version.md 缺少当前版本更新记录')
  return version
}

export function nextVersion(version) {
  const parts = version.split('.')
  return `${parts[0]}.${parts[1]}.${BigInt(parts[2]) + 1n}`
}

export function checkVersions(reader = read, selected = apps, allowLegacy = false) {
  let document
  try { document = reader('version.md') } catch (error) { if (!allowLegacy) throw error }
  const version = document === undefined ? JSON.parse(reader('server/package.json')).version : parseVersion(document)
  if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error('应用版本格式无效')
  for (const app of selected) {
    const pkg = JSON.parse(reader(`${app}/package.json`))
    const lock = JSON.parse(reader(`${app}/package-lock.json`))
    if ([pkg.version, lock.version, lock.packages?.['']?.version].some(value => value !== version)) {
      throw new Error(`${app} 应用版本、锁文件与 version.md 不一致`)
    }
  }
  return version
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const [command = 'check', app] = process.argv.slice(2)
    if (!['check', 'artifact'].includes(command) || (app && !apps.includes(app))) throw new Error('用法：node scripts/version.mjs check [应用] | artifact <应用>')
    const version = checkVersions(read, app ? [app] : apps)
    if (command === 'artifact') {
      if (!app) throw new Error('artifact 必须指定应用')
      const commit = process.env.APP_COMMIT_SHA || 'development'
      if (commit !== 'development' && !/^[a-f0-9]{40}$/.test(commit)) throw new Error('APP_COMMIT_SHA 必须为完整 Git SHA')
      writeFileSync(resolve(root, app, 'dist/version.json'), JSON.stringify({ version, commit }) + '\n')
    }
    console.log(`版本校验通过：v${version}${app ? ` (${app})` : ''}`)
  } catch (error) { console.error(error.message); process.exitCode = 1 }
}
