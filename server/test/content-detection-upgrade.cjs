const assert = require('node:assert/strict')
const { createHash } = require('node:crypto')
const { createRequire } = require('node:module')
const { execFileSync } = require('node:child_process')
const { PrismaClient } = createRequire(`${process.cwd()}/package.json`)('@prisma/client')

const url = new URL(process.env.DATABASE_URL || 'file:///missing')
assert.equal(url.hostname, '127.0.0.1')
assert.equal(url.port, '55439')
assert.equal(url.pathname, '/community_content_upgrade')
const db = new PrismaClient()
// 只保护本批迁移涉及的旧表，以及必须保留的人工配置和发布快照；不执行全量业务测试。
const tables = ['users', 'login_logs', 'community_profiles', 'community_posts', 'community_comments', 'resource_categories', 'files', 'system_settings', 'homepage_modules', 'homepage_module_versions', 'homepage_publications', 'course_versions', 'resource_versions']
const quoted = (name) => `"${name.replaceAll('"', '""')}"`
async function fingerprint(table, columns) {
  const current = await db.$queryRaw`SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name=${table} ORDER BY ordinal_position`
  columns ||= current.map((row) => row.column_name)
  const projection = columns.map((name) => table === 'login_logs' && name === 'email' && !current.some((row) => row.column_name === 'email') ? '"identifier" AS "email"' : quoted(name)).join(',')
  const rows = await db.$queryRawUnsafe(`SELECT row_to_json(t)::text AS content FROM (SELECT ${projection} FROM public.${quoted(table)}) t`)
  return { columns, hashes: rows.map(({ content }) => createHash('sha256').update(content).digest('hex')).sort() }
}
async function main() {
  const baseline = new Map()
  for (const table of tables) baseline.set(table, await fingerprint(table))
  const migrationsBefore = await db.$queryRaw`SELECT migration_name FROM _prisma_migrations WHERE finished_at IS NOT NULL ORDER BY migration_name`
  assert.equal(migrationsBefore.at(-1).migration_name, '20260901010000_persistence_productization')
  const migrate = (schema) => execFileSync('node', ['node_modules/prisma/build/index.js', 'migrate', 'deploy', '--schema', schema], { stdio: 'inherit', env: process.env })
  migrate('/checks/before/prisma/schema.prisma')
  // 只在隔离副本创建合成历史合集，验证新增content_status默认值，而非只验证空表DDL。
  await db.$executeRaw`INSERT INTO users (id,email,username,display_name,password_hash,updated_at) VALUES ('synthetic-content-upgrade-owner','synthetic-upgrade@example.invalid','synthetic_upgrade_owner','合成升级样本','not-a-login-password',CURRENT_TIMESTAMP)`
  await db.$executeRaw`INSERT INTO learning_collections (id,owner_id,name,description,visibility,updated_at) VALUES ('synthetic-content-upgrade-collection','synthetic-content-upgrade-owner','合成旧合集','合成升级前说明','community',CURRENT_TIMESTAMP)`
  const collection = await fingerprint('learning_collections')
  migrate('/checks/full/prisma/schema.prisma')
  const summary = []
  for (const [table, before] of baseline) {
    const after = await fingerprint(table, before.columns)
    const remaining = [...after.hashes]
    for (const hash of before.hashes) {
      const index = remaining.indexOf(hash)
      assert.notEqual(index, -1, `${table}旧行或旧字段改变`)
      remaining.splice(index, 1)
    }
    if (table === 'users') assert.equal(remaining.length, 1)
    else if (table === 'resource_categories') assert.ok(remaining.length <= 7)
    else assert.equal(remaining.length, 0, `${table}出现非预期新行`)
    summary.push({ table, preservedRows: before.hashes.length, addedRows: remaining.length })
  }
  assert.deepEqual((await fingerprint('learning_collections', collection.columns)).hashes, collection.hashes)
  assert.deepEqual(await db.$queryRaw`SELECT content_status FROM learning_collections WHERE id='synthetic-content-upgrade-collection'`, [{ content_status: 'published' }])
  assert.equal(Number((await db.$queryRaw`SELECT count(*) AS count FROM content_reviews`)[0].count), 0)
  const history = await fingerprint('_prisma_migrations')
  const repeatBaseline = new Map()
  for (const table of [...tables, 'learning_collections', 'content_reviews']) repeatBaseline.set(table, await fingerprint(table))
  migrate('/checks/full/prisma/schema.prisma')
  assert.deepEqual((await fingerprint('_prisma_migrations')).hashes, history.hashes)
  for (const [table, before] of repeatBaseline) assert.deepEqual((await fingerprint(table)).hashes, before.hashes, `${table}重复升级发生变更`)
  // 旧客户端使用email列；新迁移改名后不能把仅回退旧镜像当作安全回滚。
  await assert.rejects(db.loginLog.findMany({ take: 1 }), (error) => error.code === 'P2022')
  console.log(JSON.stringify({ check: 'content-detection-clone-upgrade', tables: summary, originalMigrations: migrationsBefore.length, finalMigrations: history.hashes.length, repeatUnchanged: true, existingCollectionDefault: 'published', oldLoginClientCompatible: false, rawPersonalDataLogged: false }))
}
main().catch((error) => { console.error(error.name === 'AssertionError' ? error.message : '升级演练失败，详见受限同机日志'); process.exitCode = 1 }).finally(() => db.$disconnect())
