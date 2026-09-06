const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const sharp = require('../../server/node_modules/sharp')
const { catalogAssets, getCatalogAsset, getDefaultAssetKeys, normalizeCategoryKey } = require('./dist/manifest')
const { iconRegistry, getIconHref } = require('./dist/icons/registry')

async function verify() {
  assert.equal(catalogAssets.length, 118)
  assert.equal(new Set(catalogAssets.map((asset) => asset.assetKey)).size, catalogAssets.length)
  assert.equal(new Set(catalogAssets.map((asset) => asset.file)).size, catalogAssets.length)
  for (const [contentType, count] of Object.entries({ course: 24, lab: 13, resource: 24, article: 15, challenge: 5 })) {
    assert.equal(catalogAssets.filter((asset) => asset.contentType === contentType && asset.contentSlug && asset.kind === 'cover').length, count, contentType)
  }
  assert.equal(catalogAssets.filter((asset) => asset.assetKey.startsWith('default--')).length, 31)
  assert.equal(catalogAssets.filter((asset) => asset.kind === 'hero').length, 6)
  assert.equal(normalizeCategoryKey('resource', '提示词模板'), 'prompt-template')
  assert.equal(normalizeCategoryKey('article', '模型部署'), 'generic')
  assert.deepEqual(getDefaultAssetKeys('course', 'llm'), ['default--course--llm', 'default--course--generic', 'default--global--generic'])
  assert.deepEqual(getDefaultAssetKeys('theme', 'security'), ['default--course--security', 'default--course--generic', 'default--global--generic'])
  assert.deepEqual(getDefaultAssetKeys('resource', '不存在的分类'), ['default--resource--generic', 'default--global--generic'])
  assert.deepEqual(getDefaultAssetKeys('page_hero', 'topics'), ['hero--topics', 'default--global--generic'])
  assert.equal(getCatalogAsset('不存在的素材'), undefined)
  const defaultPairs = catalogAssets.flatMap((asset) => (asset.defaultFor || []).map((rule) => `${rule.contentType}:${rule.categoryKey}`))
  assert.equal(new Set(defaultPairs).size, defaultPairs.length)
  const missing = []
  const hashes = []
  let totalBytes = 0
  for (const asset of catalogAssets) {
    assert.ok(asset.altText.trim())
    assert.equal(asset.source, 'image2_seed')
    assert.equal(asset.width, asset.kind === 'hero' ? 1600 : 1200)
    assert.equal(asset.height, asset.kind === 'hero' ? 800 : 675)
    assert.match(asset.file, /^images\/[a-z]+\/[a-z0-9-]+\.webp$/)
    assert.ok(asset.focalX >= 0 && asset.focalX <= 1 && asset.focalY >= 0 && asset.focalY <= 1)
    const file = path.join(__dirname, asset.file)
    if (!fs.existsSync(file)) {
      missing.push(asset.assetKey)
      continue
    }
    const buffer = fs.readFileSync(file)
    const image = sharp(buffer)
    const metadata = await image.metadata()
    assert.equal(metadata.format, 'webp', asset.assetKey)
    assert.equal(metadata.width, asset.width, asset.assetKey)
    assert.equal(metadata.height, asset.height, asset.assetKey)
    const stats = await image.stats()
    assert.equal(stats.isOpaque, true, `${asset.assetKey}: 存在透明像素`)
    assert.equal(metadata.hasAlpha ? stats.channels.at(-1).min : 255, 255, `${asset.assetKey}: alpha最小值必须为255`)
    const limit = (asset.kind === 'hero' ? 400 : asset.contentType === 'lab' ? 300 : asset.contentType === 'resource' ? 240 : 280) * 1024
    assert.ok(buffer.length <= limit, `${asset.assetKey}: 超过体积上限`)
    hashes.push(crypto.createHash('sha256').update(buffer).digest('hex'))
    totalBytes += buffer.length
  }
  assert.equal(new Set(hashes).size, hashes.length, '不同独立资产不得使用完全相同的图片二进制')
  const achievements = ['first-course', 'seven-day-streak', 'first-lab', 'deployment-starter', 'agent-builder', 'command-runner', 'hardware-maker', 'first-assessment', 'high-score', 'resource-curator', 'project-maker', 'learning-star']
  for (const name of [...achievements, 'brain', 'network', 'rag', 'database', 'workflow', 'memory', 'api', 'container', 'gpu', 'sensor', 'edge', 'crop', 'template', 'download', 'pulse', 'scale', 'graduation', 'missing']) assert.ok(iconRegistry[name], name)
  const iconfont = fs.readFileSync(path.join(__dirname, 'icons', 'iconfont.js'), 'utf8')
  assert.equal((iconfont.match(/<symbol /g) || []).length, 140)
  assert.equal((iconfont.match(/fill="currentColor"/g) || []).length, 140)
  assert.doesNotMatch(iconfont, /fill="#000000"/)
  for (const [name, symbol] of Object.entries(iconRegistry)) {
    assert.match(symbol, /^[A-Za-z0-9_-]+$/, name)
    assert.ok(iconfont.includes(`id="icon-${symbol}"`), `${name}: ${symbol}`)
    assert.equal(getIconHref(name), `#icon-${symbol}`)
  }
  assert.equal(getIconHref('unknown-key'), getIconHref('missing'))
  console.log(JSON.stringify({ status: missing.length ? 'IN_PROGRESS' : 'PASS', expected: catalogAssets.length, present: hashes.length, missing, totalBytes, icons: Object.keys(iconRegistry).length }, null, 2))
  if (!process.argv.includes('--allow-pending')) assert.equal(missing.length, 0, '全部正式素材完成前禁止通过完整门禁')
}

verify().catch((error) => {
  console.error(error.message)
  process.exitCode = 1
})
