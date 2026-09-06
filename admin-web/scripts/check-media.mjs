import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { runInNewContext } from 'node:vm'
import { setImmediate } from 'node:timers/promises'
import ts from 'typescript'
import { parse, compileScript } from '@vue/compiler-sfc'
import * as Vue from 'vue'

// 无网络、无DOM、无应用服务：使用内存Vue renderer验证真实组件setup与资源生命周期。
const root = fileURLToPath(new URL('../', import.meta.url)), require = createRequire(import.meta.url)
const source = (path) => readFileSync(`${root}${path}`, 'utf8')
const evaluate = (code, modules = {}, globals = {}) => {
  const exports = {}, module = { exports }
  const js = ts.transpileModule(code, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true } }).outputText
  runInNewContext(js, { exports, module, require: (name) => modules[name] || (name.endsWith('.vue') ? { render: () => null } : require(name)), console, Error, AbortController, URL, URLSearchParams, FormData, ...globals })
  return module.exports
}
const component = (path, modules, globals) => evaluate(compileScript(parse(source(path)).descriptor, { id: path }).content, modules, globals).default
const renderer = Vue.createRenderer({ createElement: () => ({}), createText: () => ({}), createComment: () => ({}), setText() {}, setElementText() {}, parentNode: () => null, nextSibling: () => null, insert() {}, remove() {}, patchProp() {} })
const mount = (definition, values = {}) => {
  const props = Vue.reactive(values), view = { ...definition, render: () => null }
  const app = renderer.createApp({ render: () => Vue.h(view, props) }), vm = app.mount({})
  return { props, state: () => vm.$.subTree.component.setupState, unmount: () => app.unmount() }
}
const flush = async () => { await Vue.nextTick(); await setImmediate(); await Vue.nextTick() }
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b }); return { promise, resolve, reject } }
let checks = 0
const check = (name, job) => Promise.resolve().then(job).then(() => { checks++; console.log(`通过：${name}`) })

await check('预览请求携带Bearer、共享刷新且保留AbortSignal', async () => {
  const tokens = new Map([['admin-access-token', 'old-test-token']]), calls = []
  const refreshGate = deferred()
  const api = evaluate(source('src/services/api.ts').replace("import.meta.env.VITE_API_BASE_URL || '/api/v1'", "'/api/v1'"), {}, {
    sessionStorage: { getItem: (key) => tokens.get(key), setItem: (key, value) => tokens.set(key, value) },
    fetch: async (url, init) => {
      calls.push({ url, init })
      if (url.endsWith('/denied')) return Response.json({ code: 403, message: '拒绝预览' }, { status: 403 })
      if (url.endsWith('/auth/refresh')) { await refreshGate.promise; return Response.json({ code: 0, data: { accessToken: 'fresh-test-token' } }) }
      return init.headers.authorization === 'Bearer fresh-test-token' ? new Response(new Blob(['image-bytes'], { type: 'image/webp' })) : new Response('', { status: 401 })
    },
  })
  const abort = new AbortController(), pending = [api.apiBlob('/admin/media-assets/a/preview', abort.signal), api.apiBlob('/admin/media-assets/b/preview')]
  await flush(); refreshGate.resolve()
  const blobs = await Promise.all(pending)
  assert.equal(calls.filter((call) => call.url.endsWith('/auth/refresh')).length, 1)
  assert.equal(await blobs[0].text(), 'image-bytes')
  assert.equal(calls.filter((call) => call.url.endsWith('/a/preview')).at(-1).init.signal, abort.signal)
  assert.ok(calls.every((call) => call.init.credentials === 'include'))
  await assert.rejects(api.api('/test-denied'), /请求失败/)
  await assert.rejects(api.apiBlob('/denied'), /拒绝预览/)
})

await check('预览切换取消旧请求、拒绝迟到结果、卸载回收blob', async () => {
  const pending = [], revoked = [], allocated = []
  const definition = component('src/components/MediaAssetPreview.vue', { '../services/api': { apiBlob: (path, signal) => { const job = deferred(); pending.push({ ...job, path, signal }); return job.promise } } }, {
    URL: { createObjectURL: () => { const url = `blob:test-${allocated.length}`; allocated.push(url); return url }, revokeObjectURL: (url) => revoked.push(url) },
  })
  const view = mount(definition, { assetId: 'old' })
  view.props.assetId = 'new'; await flush()
  assert.equal(pending[0].signal.aborted, true)
  pending[0].resolve(new Blob(['old'])); await flush(); assert.equal(allocated.length, 0)
  pending[1].resolve(new Blob(['new'])); await flush(); assert.equal(view.state().url, 'blob:test-0')
  view.props.assetId = 'third'; await flush(); assert.deepEqual(revoked, ['blob:test-0'])
  pending[2].resolve(new Blob(['third'])); await flush()
  view.unmount(); assert.deepEqual(revoked, ['blob:test-0', 'blob:test-1'])
})

await check('旧legacy移除立即显示默认，发出显式null，切换内容后重置', async () => {
  const emitted = [], fallback = { id: 'default', url: '/api/v1/public/media/default', source: 'type_default', alt: '默认图', focalPoint: { x: .5, y: .5 } }
  let reads = 0
  const definition = component('src/components/MediaAssetPicker.vue', {
    '../services/api': { api: async () => { reads++; return fallback } },
    '../composables/usePermissionAction': { usePermissionAction: () => Vue.ref(true) },
    '../services/media': { categoryKeyFor: (_type, category) => category || 'generic' },
  })
  const view = mount(definition, { contentType: 'course', modelValue: null, current: { coverSource: 'legacy', cover: '/old.webp' }, 'onUpdate:modelValue': (value) => emitted.push(value) })
  await flush(); assert.equal(view.state().error, ''); assert.equal(view.state().legacy, '/old.webp')
  view.state().remove(); await flush()
  assert.equal(view.state().legacy, undefined); assert.equal(view.state().fallback.id, 'default'); assert.deepEqual(emitted, [null])
  view.props.current = { coverAssetId: null, coverSource: 'type_default', cover: fallback.url }; await flush()
  assert.equal(view.state().legacy, undefined)
  view.props.current = { coverSource: 'legacy', cover: '/another-content.webp' }; await flush()
  assert.equal(view.state().legacy, '/another-content.webp')
  const before = reads; view.state().dialog = true; await flush(); assert.equal(reads, before)
  view.state().dialog = false; await flush(); assert.equal(reads, before + 1)
  view.unmount()
})

await check('删除确认固定目标，409刷新重新读取素材修订与默认规则', async () => {
  const confirmation = deferred(), calls = [], revisions = { value: 1 }, asset = (id) => ({ id, name: id, kind: 'cover', contentType: 'course', categoryKey: 'generic', altText: '', focalX: .5, focalY: .5, status: 'active', revision: revisions.value })
  const api = async (path, init = {}) => {
    calls.push({ path, init })
    if (init.method === 'PATCH') throw new Error('配置已变化，请刷新')
    if (path === '/admin/media-defaults' || path.endsWith('/usage')) return []
    if (path.includes('?')) return { items: [asset('a'), asset('b')], page: 1, pageSize: 12, total: 2 }
    return asset(path.split('/').at(-1))
  }
  const definition = component('src/components/MediaAssetLibrary.vue', {
    '../services/api': { api }, 'element-plus': { ElMessage: { success() {} }, ElMessageBox: { confirm: () => confirmation.promise } },
    '../composables/usePermissionAction': { usePermissionAction: () => Vue.ref(true) },
    '../stores/session': { useSessionStore: () => ({ user: { roles: ['admin'] } }) },
    '../services/media': { mediaCategories: () => [], mediaKindLabels: {}, mediaSourceLabels: {}, mediaTypeLabels: {} },
  })
  const view = mount(definition); await flush()
  await view.state().choose(asset('a'))
  await view.state().save(); assert.match(view.state().error, /刷新/)
  revisions.value = 2; await view.state().reload(); assert.equal(view.state().selected.revision, 2)
  const removal = view.state().remove()
  assert.equal(view.state().busy, true)
  view.state().selected = asset('b') // 即便状态被外部刷新替换，也不能改变已确认目标。
  confirmation.resolve(); await removal
  assert.equal(calls.find((call) => call.init.method === 'DELETE').path, '/admin/media-assets/a')
  assert.ok(calls.filter((call) => call.path === '/admin/media-defaults').length >= 2)
  view.unmount()
})

await check('六页写入ID不写URL、资源附件独立、课程连续编辑刷新草稿ID', () => {
  for (const [name, type] of [['Theme', 'theme'], ['Course', 'course'], ['Lab', 'lab'], ['Resource', 'resource'], ['Article', 'article'], ['Challenge', 'challenge']]) {
    const text = source(`src/views/management/${name}ManagementView.vue`)
    assert.ok(text.includes(`content-type="${type}"`)); assert.ok(text.includes('coverAssetId'))
    assert.ok(text.includes('@remove="drafts.removeDraft')); assert.ok(text.includes(':data-origin="dataOrigin"'))
    assert.ok(!text.includes('fields.cover'))
  }
  const shell = source('src/components/DomainPageShell.vue')
  assert.ok(shell.includes('coverDirty ? { coverAssetId: coverId } : {}'))
  assert.ok(source('src/views/management/ResourceManagementView.vue').includes("'/admin/files/upload'"))
  const course = source('src/views/management/CourseManagementView.vue')
  for (const name of ['updateChapter', 'updateLesson']) assert.match(course.slice(course.indexOf(`const ${name}`)).split('\n}')[0], /await refreshDetail\(\)/)
})

await check('独立媒体菜单权限、公共Hero专用设置与未知图标告警', async () => {
  const navigation = evaluate(source('src/navigation.ts'))
  assert.equal(navigation.visibleAdminNavigation(['media.read'])[0].items[0][2], '/media')
  assert.ok(!navigation.visibleAdminNavigation(['resource.write']).some((group) => group.items.some((item) => item[2] === '/media')))
  assert.ok(source('src/router.ts').includes('return landing'))
  assert.ok(source('src/views/SettingsView.vue').includes("'media.default.manage'"))
  assert.ok(source('src/views/SettingsView.vue').includes("'/admin/page-visuals'"))
  assert.ok(source('src/components/AdminIcon.vue').includes('console.warn'))
  assert.ok(source('src/components/AdminIcon.vue').includes('getIconHref'))
  assert.ok(source('src/components/AdminIcon.vue').includes('Object.hasOwn(iconRegistry, name)'))
  const { iconRegistry, getIconHref } = evaluate(source('../packages/catalog-assets/icons/registry.ts')), warnings = []
  const view = mount(component('src/components/AdminIcon.vue', { '../../../packages/catalog-assets/icons/registry': { iconRegistry, getIconHref } }, { console: { warn: (message) => warnings.push(message) } }), { name: '__proto__' })
  assert.equal(view.state().href, `#icon-${iconRegistry.missing}`)
  view.props.name = 'constructor'; await flush(); assert.equal(view.state().href, `#icon-${iconRegistry.missing}`)
  view.props.name = 'course'; await flush(); assert.equal(view.state().href, `#icon-${iconRegistry.course}`)
  assert.equal(warnings.length, 2)
  view.unmount()
})
console.log(`媒体前端内存单元门禁通过：${checks}组；不替代真实浏览器或服务器验收。`)
