// 只加载编译模块，不创建Nest应用、不连接数据库或监听端口。
const assert = require('node:assert/strict')
const contracts = require('@ai-learning-hub/contracts')

async function check() {
  assert.match(require.resolve('@ai-learning-hub/contracts'), /[/\\]dist[/\\]index\.js$/)
  assert.equal(contracts.LANDING_MODULE_KEYS.length, 5)
  assert.equal(contracts.PublishStatus.PUBLISHED, 'published')
  assert.deepEqual((await import('@ai-learning-hub/contracts')).LANDING_MODULE_KEYS, contracts.LANDING_MODULE_KEYS)
  assert.equal(typeof require('../dist/modules/homepage/upgrade-landing.js').upgradeLanding, 'function')
  assert.equal(typeof require('../dist/modules/homepage/homepage.service.js').HomepageService, 'function')
  assert.equal(typeof require('../dist/app.module.js').AppModule, 'function')
  assert.equal(require('node:zlib').crc32(Buffer.from('123456789')), 0xcbf43926)
  assert.equal(typeof require('../dist/modules/media/import-catalog.js').importCatalogAssets, 'function')
  assert.equal(typeof require('../dist/modules/media/media-gc.js').collectArchivedMedia, 'function')
  assert.equal(typeof require('../dist/modules/persistence/bootstrap.js').bootstrapApplication, 'function')
  await require('../dist/modules/project-content/bundle.js').readBundle()
  console.log(JSON.stringify({ check: 'runtime-imports', node: process.version, contracts: 'compiled-commonjs', commonjs: true, esm: true, upgrade: true, appModule: true, networkStarted: false }))
}

check().catch((error) => { console.error(error); process.exitCode = 1 })
