#!/usr/bin/env node
import { execFileSync } from 'node:child_process'
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { apps, checkVersions, nextVersion, read, root, versionFiles } from './version.mjs'

const zero = '0'.repeat(40)
const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
const attempt = (...args) => { try { return git(...args) } catch { return '' } }
const at = ref => path => git('show', `${ref}:${path}`)
const refVersion = ref => checkVersions(at(ref), apps, true)
const remoteRefs = remote => new Map(git('ls-remote', remote, 'refs/heads/main', 'refs/tags/v*').split('\n').filter(Boolean).map(line => { const [sha, ref] = line.split(/\s+/); return [ref, sha] }))

function install() {
  const hooks = attempt('config', '--get', 'core.hooksPath')
  if (hooks && hooks !== '.githooks') throw new Error('已有自定义 hooksPath，请先整合现有钩子，未覆盖配置')
  const oldHook = git('rev-parse', '--git-path', 'hooks/pre-push')
  if (!hooks && existsSync(resolve(root, oldHook))) throw new Error('已有 pre-push 钩子，请先整合，未覆盖原钩子')
  chmodSync(resolve(root, '.githooks/pre-push'), 0o755)
  git('config', '--local', 'core.hooksPath', '.githooks')
}

function checkHistory(candidate, previous) {
  const previousDocument = attempt('show', `${previous}:version.md`)
  const document = at(candidate)('version.md')
  for (const row of previousDocument.split('\n').filter(line => /^\| v\d/.test(line))) {
    if (!document.split('\n').includes(row)) throw new Error('不能删除或改写既有版本记录')
  }
}

function validateRelease(candidate, previous) {
  if (!previous || previous === zero) throw new Error('远端 main 基线不存在')
  git('merge-base', '--is-ancestor', previous, candidate)
  const version = checkVersions(at(candidate))
  if (version !== nextVersion(refVersion(previous))) throw new Error('每批 main 推送必须且只能递增一个补丁版本')
  checkHistory(candidate, previous)
  const tag = `refs/tags/v${version}`
  if (attempt('cat-file', '-t', tag) !== 'tag' || attempt('rev-parse', `${tag}^{commit}`) !== candidate) throw new Error(`缺少指向发布提交的附注标签 v${version}`)
  return { version, tag }
}

function prePush(remote, input) {
  const updates = input.trim().split('\n').filter(Boolean).map(line => {
    const [localRef, localSha, remoteRef, remoteSha] = line.split(/\s+/)
    return { localRef, localSha, remoteRef, remoteSha }
  })
  const main = updates.find(update => update.remoteRef === 'refs/heads/main')
  if (!main) return
  if (main.localSha === zero) throw new Error('发布流程不允许删除 main')
  const { tag } = validateRelease(main.localSha, main.remoteSha)
  const tagSha = git('rev-parse', tag)
  const pendingTag = updates.find(update => update.remoteRef === tag)
  if (pendingTag && (pendingTag.localSha !== tagSha || (pendingTag.remoteSha !== zero && pendingTag.remoteSha !== tagSha))) throw new Error('版本标签更新冲突')
  if (!pendingTag && remoteRefs(remote).get(tag) !== tagSha) throw new Error('main 必须与版本标签一起推送；请使用 node scripts/release.mjs publish --summary "更新摘要"')
}

function publish(summary) {
  install()
  if (git('branch', '--show-current') !== 'main') throw new Error('先将功能提交合并到 main，再发布')
  if (git('status', '--porcelain')) throw new Error('发布要求干净工作树；先精确提交本批改动，保留无关工作')
  const lock = resolve(root, git('rev-parse', '--git-common-dir'), 'app-release.lock')
  try { mkdirSync(lock) } catch { throw new Error('已有本地发布运行中；确认进程结束后才能移除 app-release.lock') }
  try {
    git('fetch', '--no-tags', 'origin', 'refs/heads/main')
    const previous = git('rev-parse', 'FETCH_HEAD')
    let candidate = git('rev-parse', 'HEAD')
    git('merge-base', '--is-ancestor', previous, candidate)
    let version = checkVersions()
    let refs = remoteRefs('origin')
    if (refs.get('refs/heads/main') !== previous) throw new Error('远端 main 在检查期间变化，请同步后重试')
    if (candidate === previous) {
      if (refs.get(`refs/tags/v${version}^{}`) !== candidate) throw new Error('没有待发布功能提交，或远端缺少当前版本标签')
      console.log(`v${version} 已发布，无需递增：${candidate}`)
      return
    }
    const oldVersion = refVersion(previous)
    checkHistory(candidate, previous)
    if (version === oldVersion) {
      if (!summary?.trim()) throw new Error('请使用 --summary 提供本批更新摘要')
      version = nextVersion(version)
      const tag = `refs/tags/v${version}`
      if (refs.has(tag) || attempt('rev-parse', '--verify', tag)) throw new Error(`版本标签 v${version} 已存在，未修改文件`)
      const document = read('version.md')
      const row = `| v${version} | ${new Date().toISOString().slice(0, 10)} | ${summary.trim().replace(/[\r\n]+/g, ' ').replace(/\|/g, '｜')} |`
      if (!document.includes('| --- | --- | --- |\n')) throw new Error('version.md 更新记录表头无效')
      writeFileSync(resolve(root, 'version.md'), document.replace(`当前版本：v${oldVersion}`, `当前版本：v${version}`).replace('| --- | --- | --- |\n', `| --- | --- | --- |\n${row}\n`))
      for (const app of apps) {
        for (const name of ['package.json', 'package-lock.json']) {
          const path = `${app}/${name}`, data = JSON.parse(read(path))
          data.version = version
          if (name === 'package-lock.json') data.packages[''].version = version
          writeFileSync(resolve(root, path), JSON.stringify(data, null, 2) + '\n')
        }
      }
      if (checkVersions() !== version) throw new Error('更新后版本核验失败')
      git('add', '--', ...versionFiles)
      git('commit', '-m', `chore(release): v${version}`)
      candidate = git('rev-parse', 'HEAD')
    } else if (version !== nextVersion(oldVersion)) {
      throw new Error('本地版本不符合远端补丁递增规则；未改写既有提交')
    }
    const tag = `refs/tags/v${version}`
    // 网络失败、进程中断或标签创建失败后，只补齐当前版本，不再递增。
    if (!attempt('rev-parse', '--verify', tag)) git('tag', '-a', `v${version}`, '-m', `发布 v${version}`, candidate)
    validateRelease(candidate, previous)
    refs = remoteRefs('origin')
    if (refs.get('refs/heads/main') !== previous) throw new Error('远端 main 已变化；保留本地版本，合并远端后重新核验')
    if (refs.has(tag) && refs.get(tag) !== git('rev-parse', tag)) throw new Error('远端版本标签冲突；未覆盖标签')
    execFileSync('git', ['push', '--atomic', 'origin', `${candidate}:refs/heads/main`, tag], { cwd: root, stdio: 'inherit' })
    refs = remoteRefs('origin')
    if (refs.get('refs/heads/main') !== candidate || refs.get(`${tag}^{}`) !== candidate || refs.get(tag) !== git('rev-parse', tag)) throw new Error('推送后的远端版本核验失败，请先检查远端，勿再次递增')
    console.log(`发布完成：v${version} ${candidate}`)
  } finally { rmSync(lock, { recursive: true }) }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const [command, ...args] = process.argv.slice(2)
    if (command === 'install' && !args.length) { install(); console.log('已安装本仓库版本推送检查') }
    else if (command === 'check' && !args.length) console.log(`版本一致：v${checkVersions()}`)
    else if (command === 'pre-push' && args.length === 2) prePush(args[1], readFileSync(0, 'utf8'))
    else if (command === 'publish' && (!args.length || (args.length === 2 && args[0] === '--summary'))) publish(args[1])
    else throw new Error('用法：node scripts/release.mjs install | check | publish --summary "更新摘要"')
  } catch (error) { console.error(`发布未完成：${error.message}${error.stderr ? `\n${error.stderr}` : ''}`); process.exitCode = 1 }
}
