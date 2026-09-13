import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { apps, root, versionFiles } from './version.mjs'

const run = (cwd, command, ...args) => execFileSync(command, args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
const git = (cwd, ...args) => run(cwd, 'git', ...args)
const command = (cwd, ...args) => spawnSync(process.execPath, ['scripts/release.mjs', ...args], { cwd, encoding: 'utf8' })
function succeeds(result) { assert.equal(result.status, 0, result.stdout + result.stderr) }
function fails(result, pattern) { assert.notEqual(result.status, 0); assert.match(result.stdout + result.stderr, pattern) }
const version = cwd => JSON.parse(readFileSync(join(cwd, 'server/package.json'), 'utf8')).version
function commit(cwd, name) { writeFileSync(join(cwd, name), name); git(cwd, 'add', '--', name); git(cwd, 'commit', '-m', name) }

function setup(t) {
  const directory = mkdtempSync(join(tmpdir(), 'aihub-version-test-'))
  t.after(() => rmSync(directory, { recursive: true, force: true }))
  const remote = join(directory, 'remote.git'), repo = join(directory, 'repo')
  git(directory, 'init', '--bare', '--initial-branch=main', remote)
  git(directory, 'clone', remote, repo)
  git(repo, 'config', 'user.name', 'Release Test')
  git(repo, 'config', 'user.email', 'release@test.invalid')
  for (const app of apps) {
    mkdirSync(join(repo, app))
    writeFileSync(join(repo, app, 'package.json'), JSON.stringify({ name: app, version: '0.1.0' }, null, 2) + '\n')
    writeFileSync(join(repo, app, 'package-lock.json'), JSON.stringify({ name: app, version: '0.1.0', lockfileVersion: 3, packages: { '': { name: app, version: '0.1.0' } } }, null, 2) + '\n')
  }
  git(repo, 'add', '--', ...versionFiles.filter(path => path !== 'version.md'))
  git(repo, 'commit', '-m', 'legacy baseline')
  git(repo, 'push', 'origin', 'main')
  for (const path of ['scripts', '.githooks']) cpSync(join(root, path), join(repo, path), { recursive: true })
  const document = '# 发布版本\n\n当前版本：v0.1.0\n\n| 版本 | 发布日期（UTC） | 更新摘要 |\n| --- | --- | --- |\n| v0.1.0 | — | 基线 |\n'
  writeFileSync(join(repo, 'version.md'), document)
  git(repo, 'add', '--', 'scripts', '.githooks', 'version.md')
  git(repo, 'commit', '-m', 'release tooling')
  return { directory, remote, repo }
}

test('首次及下一批发布；多提交只加一次；重跑零变化；只提交版本文件', t => {
  const { repo, remote } = setup(t)
  commit(repo, 'feature-one'); commit(repo, 'feature-two')
  succeeds(command(repo, 'publish', '--summary', '第一批 | 完整更新'))
  assert.equal(version(repo), '0.1.1')
  const sha = git(repo, 'rev-parse', 'HEAD')
  assert.equal(git(remote, 'rev-parse', 'refs/heads/main'), sha)
  assert.equal(git(remote, 'rev-parse', 'refs/tags/v0.1.1^{}'), sha)
  assert.equal(git(repo, 'cat-file', '-t', 'v0.1.1'), 'tag')
  assert.deepEqual(git(repo, 'diff-tree', '--no-commit-id', '--name-only', '-r', 'HEAD').split('\n').sort(), [...versionFiles].sort())
  succeeds(command(repo, 'publish'))
  assert.equal(git(repo, 'rev-parse', 'HEAD'), sha)
  commit(repo, 'feature-three')
  succeeds(command(repo, 'publish', '--summary', '第二批'))
  assert.equal(version(repo), '0.1.2')
  assert.match(readFileSync(join(repo, 'version.md'), 'utf8'), /v0.1.1.*第一批 ｜ 完整更新/)
})

test('安装钩子后拦截直接 main 推送；功能分支推送不递增', t => {
  const { repo, remote } = setup(t)
  succeeds(command(repo, 'install'))
  const before = git(remote, 'rev-parse', 'main')
  assert.throws(() => git(repo, 'push', 'origin', 'main'), /递增/)
  assert.equal(git(remote, 'rev-parse', 'main'), before)
  git(repo, 'checkout', '-b', 'codex/test')
  git(repo, 'push', 'origin', 'codex/test')
  assert.equal(version(repo), '0.1.0')
  fails(command(repo, 'publish', '--summary', '禁止分支发布'), /合并到 main/)
})

test('失败保留版本；缺失标签可恢复；原子推送未留下半个发布', t => {
  const { repo, remote } = setup(t)
  const before = git(remote, 'rev-parse', 'main')
  const hook = join(remote, 'hooks/pre-receive')
  writeFileSync(hook, '#!/bin/sh\nexit 1\n', { mode: 0o755 })
  fails(command(repo, 'publish', '--summary', '网络重试样本'), /发布未完成/)
  assert.equal(version(repo), '0.1.1')
  const sha = git(repo, 'rev-parse', 'HEAD')
  assert.equal(git(remote, 'rev-parse', 'main'), before)
  assert.throws(() => git(remote, 'rev-parse', 'refs/tags/v0.1.1'))
  // Git 已解析 main 引用后，即使有本地标签，也不允许只推 main。
  assert.throws(() => git(repo, 'push', 'origin', 'main'), /一起推送/)
  rmSync(hook)
  git(repo, 'tag', '-d', 'v0.1.1')
  succeeds(command(repo, 'publish'))
  assert.equal(git(repo, 'rev-parse', 'HEAD'), sha)
  assert.equal(version(repo), '0.1.1')
})

test('远端 main 并发变化时停止；不改本地版本或覆盖远端', t => {
  const { directory, repo, remote } = setup(t)
  const other = join(directory, 'other')
  git(directory, 'clone', repo, other)
  git(other, 'remote', 'set-url', 'origin', remote)
  git(other, 'config', 'user.name', 'Other Test'); git(other, 'config', 'user.email', 'other@test.invalid')
  commit(other, 'concurrent-feature')
  succeeds(command(other, 'publish', '--summary', '并发发布'))
  const before = git(repo, 'rev-parse', 'HEAD')
  fails(command(repo, 'publish', '--summary', '落后分支'), /发布未完成/)
  assert.equal(git(repo, 'rev-parse', 'HEAD'), before)
  assert.equal(version(repo), '0.1.0')
})

test('已有冲突标签、脏工作树和自定义钩子均不被覆盖', t => {
  const { repo, remote } = setup(t)
  writeFileSync(join(repo, 'unrelated'), '用户文件')
  fails(command(repo, 'publish', '--summary', '更新'), /干净工作树/)
  assert.equal(readFileSync(join(repo, 'unrelated'), 'utf8'), '用户文件')
  rmSync(join(repo, 'unrelated'))
  git(remote, '-c', 'user.name=Tag Test', '-c', 'user.email=tag@test.invalid', 'tag', '-a', 'v0.1.1', '-m', 'existing', 'main')
  fails(command(repo, 'publish', '--summary', '更新'), /标签.*已存在/)
  assert.equal(version(repo), '0.1.0')
  git(repo, 'config', 'core.hooksPath', '.custom-hooks')
  fails(command(repo, 'install'), /已有自定义/)
  assert.equal(git(repo, 'config', '--get', 'core.hooksPath'), '.custom-hooks')
})

test('版本、锁文件及历史记录受校验；构建版本与代码版本一致', t => {
  const { repo } = setup(t)
  const lock = join(repo, 'frontend/package-lock.json'), before = readFileSync(lock, 'utf8')
  writeFileSync(lock, before.replaceAll('0.1.0', '0.2.0'))
  fails(command(repo, 'check'), /不一致/)
  writeFileSync(lock, before)
  mkdirSync(join(repo, 'frontend/dist'))
  run(repo, process.execPath, 'scripts/version.mjs', 'artifact', 'frontend')
  assert.equal(JSON.parse(readFileSync(join(repo, 'frontend/dist/version.json'), 'utf8')).version, '0.1.0')
  rmSync(join(repo, 'frontend/dist'), { recursive: true })
  succeeds(command(repo, 'publish', '--summary', '第一批'))
  const document = join(repo, 'version.md')
  writeFileSync(document, readFileSync(document, 'utf8').replace('| v0.1.0 | — | 基线 |', '| v0.1.0 | — | 修改历史 |'))
  git(repo, 'add', '--', 'version.md'); git(repo, 'commit', '-m', 'tamper history')
  fails(command(repo, 'publish', '--summary', '篡改版本记录'), /改写既有版本记录/)
})
