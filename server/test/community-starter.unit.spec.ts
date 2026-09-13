import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { cp, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { bootstrapApplication } from '../src/modules/persistence/bootstrap'
import { readStarterBundle } from '../src/modules/community/import-starter'
let root: string
const source = path.resolve('resources/community-starter')
beforeAll(async () => { root = await mkdtemp(path.join(tmpdir(), 'community-starter-unit-')); await cp(source, root, { recursive: true }) })
afterAll(async () => { await rm(root, { recursive: true, force: true }) })
describe('旧社区账号夹具（仅显式隔离测试）', () => {
  it('核对实际100帖、30账号、200回复和20张图片的完整资源', async () => {
    const bundle = await readStarterBundle()
    expect(bundle.content.posts).toHaveLength(100)
    expect(bundle.content.profiles).toHaveLength(30)
    expect(bundle.content.posts.flatMap(p => p.replies)).toHaveLength(200)
    expect(bundle.images).toHaveLength(20)
  })
  it('资源正文被修改时拒绝导入', async () => {
    const file = path.join(root, 'content.json'), original = await readFile(file)
    await writeFile(file, Buffer.concat([original, Buffer.from(' ')]))
    await expect(readStarterBundle(root)).rejects.toThrow('摘要')
    await writeFile(file, original)
  })
  it('拒绝损坏图片及指向目录外的符号链接', async () => {
    const file = path.join(root, 'images/agents.webp'), original = await readFile(file)
    await writeFile(file, Buffer.from('invalid webp'))
    await expect(readStarterBundle(root)).rejects.toThrow('摘要')
    await rm(file); await symlink(path.join(source, 'images/agents.webp'), file)
    await expect(readStarterBundle(root)).rejects.toThrow('符号链接')
    await rm(file); await writeFile(file, original)
  })
  it('基础初始化不再选择旧账号内容导入器', async () => {
    const old = process.env.COMMUNITY_STARTER_PACK
    process.env.COMMUNITY_STARTER_PACK = 'unexpected'
    try {
      const tx = { role: { findMany: async () => [], upsert: async () => ({}) }, permission: { findMany: async () => [], upsert: async () => ({}) }, userRole: { count: async () => 1 }, systemSetting: { upsert: async () => ({}) } }
      const db = { ...tx, $transaction: async (fn: (value: unknown) => unknown) => fn(tx) }
      await expect(bootstrapApplication(db as never)).resolves.toEqual({ bootstrap: 'complete' })
    }
    finally { if (old === undefined) delete process.env.COMMUNITY_STARTER_PACK; else process.env.COMMUNITY_STARTER_PACK = old }
  })
})
