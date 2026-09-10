<script setup lang="ts">
import type { MediaAssetDto, MediaContentType, MediaDefaultRuleDto, MediaUsageDto, PageResult } from '@ai-learning-hub/contracts'
import { ElMessage, ElMessageBox } from 'element-plus'
import AdminCloseIcon from './AdminCloseIcon.vue'
import { computed, onBeforeUnmount, onMounted, reactive, ref } from 'vue'
import { usePermissionAction } from '../composables/usePermissionAction'
import { useSessionStore } from '../stores/session'
import { api } from '../services/api'
import { mediaCategories, mediaKindLabels, mediaSourceLabels, mediaTypeLabels } from '../services/media'
import AdminPagination from './AdminPagination.vue'
import MediaAssetPreview from './MediaAssetPreview.vue'

const props = withDefaults(defineProps<{ selectable?: boolean; kind?: 'cover' | 'hero'; contentType?: MediaContentType; categoryKey?: string }>(), { selectable: false })
const emit = defineEmits<{ select: [asset: MediaAssetDto] }>()
const canRead = usePermissionAction('media.read'), canWrite = usePermissionAction('media.write'), canDelete = usePermissionAction('media.delete'), canDefault = usePermissionAction('media.default.manage')
const session = useSessionStore()
const trustedSvg = computed(() => session.user?.roles.some((role) => ['admin', 'super_admin'].includes(role)))
const filters = reactive({ keyword: '', kind: props.kind || '', contentType: props.contentType || '', categoryKey: props.categoryKey || '', source: '', status: props.selectable ? 'active' : '', onlyUnused: false })
const result = ref<PageResult<MediaAssetDto>>({ items: [], page: 1, pageSize: 12, total: 0 })
const selected = ref<MediaAssetDto | null>(null), usage = ref<MediaUsageDto[]>([]), defaults = ref<MediaDefaultRuleDto[]>([])
const error = ref(''), loading = ref(false), busy = ref(false), uploading = ref(false), usageLoading = ref(false), usageFailed = ref(false)
const edit = reactive({ name: '', altText: '', focalX: .5, focalY: .5 })
const uploadForm = reactive({ name: '', altText: '', kind: props.kind || 'cover' as MediaAssetDto['kind'], contentType: props.contentType || 'global' as MediaContentType, categoryKey: props.categoryKey || 'generic' })
const defaultTarget = reactive({ contentType: props.contentType || 'course' as MediaContentType, categoryKey: props.categoryKey || 'generic' })
const usageLabels = { draft: '当前草稿', published: '已发布版本', history: '历史版本', default: '默认规则', setting: '页面视觉设置' }
let loadEpoch = 0, detailEpoch = 0
const load = async (page = 1) => {
  if (!canRead.value) return
  const epoch = ++loadEpoch
  loading.value = true; error.value = ''
  try {
    const query = new URLSearchParams({ page: String(page), pageSize: '12' })
    for (const [key, value] of Object.entries(filters)) if (value) query.set(key, String(value))
    const value = await api<PageResult<MediaAssetDto>>(`/admin/media-assets?${query}`)
    if (epoch === loadEpoch) result.value = value
  } catch (cause) { if (epoch === loadEpoch) error.value = cause instanceof Error ? cause.message : '素材读取失败' }
  finally { if (epoch === loadEpoch) loading.value = false }
}
const choose = async (asset: MediaAssetDto) => {
  const epoch = ++detailEpoch
  selected.value = asset; usage.value = []; usageLoading.value = true; usageFailed.value = false
  Object.assign(edit, { name: asset.name, altText: asset.altText, focalX: asset.focalX, focalY: asset.focalY })
  Object.assign(defaultTarget, { contentType: asset.kind === 'hero' ? 'page_hero' : asset.contentType, categoryKey: asset.categoryKey })
  try { const value = await api<MediaUsageDto[]>(`/admin/media-assets/${asset.id}/usage`); if (epoch === detailEpoch) usage.value = value }
  catch (cause) { if (epoch === detailEpoch) { usageFailed.value = true; error.value = cause instanceof Error ? cause.message : '引用读取失败' } }
  finally { if (epoch === detailEpoch) usageLoading.value = false }
}
const refreshDefaults = async () => { defaults.value = await api<MediaDefaultRuleDto[]>('/admin/media-defaults') }
const reload = async () => {
  if (busy.value) return
  busy.value = true
  const id = selected.value?.id
  try {
    const [fresh] = await Promise.all([id ? api<MediaAssetDto>(`/admin/media-assets/${id}`) : Promise.resolve(null), refreshDefaults(), load(result.value.page)])
    if (fresh) await choose(fresh)
  } catch (cause) { error.value = cause instanceof Error ? cause.message : '素材刷新失败' }
  finally { busy.value = false }
}
const action = async (job: () => Promise<unknown>) => {
  if (busy.value) return
  busy.value = true; error.value = ''
  try { await job() } catch (cause) { error.value = cause instanceof Error ? cause.message : '操作失败，请重试' }
  finally { busy.value = false }
}
const save = () => action(async () => {
  if (!selected.value || !canWrite.value) return
  const asset = await api<MediaAssetDto>(`/admin/media-assets/${selected.value.id}`, { method: 'PATCH', body: JSON.stringify({ ...edit, expectedRevision: selected.value.revision }) })
  await choose(asset); await load(result.value.page); ElMessage.success('素材信息已保存')
})
const archive = () => action(async () => {
  if (!selected.value || !canWrite.value) return
  const asset = await api<MediaAssetDto>(`/admin/media-assets/${selected.value.id}`, { method: 'PATCH', body: JSON.stringify({ status: selected.value.status === 'active' ? 'archived' : 'active', expectedRevision: selected.value.revision }) })
  await choose(asset); await load(result.value.page)
})
const remove = async () => {
  if (!selected.value || !canDelete.value || busy.value) return
  const targetId = selected.value.id
  busy.value = true
  try { await ElMessageBox.confirm('删除只标记素材，不删除内容。仍有草稿、发布、历史或默认引用的素材不能删除。', '删除素材', { type: 'warning', closeIcon: AdminCloseIcon, confirmButtonText: '确认删除', cancelButtonText: '取消' }) } catch { return }
  finally { busy.value = false }
  await action(async () => {
    await api(`/admin/media-assets/${targetId}`, { method: 'DELETE' })
    detailEpoch++; selected.value = null; usage.value = []; await load()
    ElMessage.success('素材已软删除；二进制由受控保留期清理')
  })
}
const setDefault = () => action(async () => {
  if (!selected.value || !canDefault.value) return
  const current = defaults.value.find((rule) => rule.contentType === defaultTarget.contentType && rule.categoryKey === defaultTarget.categoryKey)
  await api(`/admin/media-defaults/${defaultTarget.contentType}/${encodeURIComponent(defaultTarget.categoryKey)}`, { method: 'PUT', body: JSON.stringify({ assetId: selected.value.id, expectedRevision: current?.revision }) })
  await refreshDefaults(); await choose(selected.value); ElMessage.success('默认封面已更新')
})
const upload = async (event: Event) => {
  const input = event.target as HTMLInputElement, file = input.files?.[0]
  input.value = ''
  if (!file || !canWrite.value) return
  if (file.size > 5 * 1024 * 1024) { error.value = '图片不能超过5MB'; return }
  uploading.value = true
  await action(async () => {
    const body = new FormData()
    body.append('file', file)
    for (const [key, value] of Object.entries({ ...uploadForm, name: uploadForm.name.trim() || file.name })) body.append(key, value)
    const asset = await api<MediaAssetDto>('/admin/media-assets/upload', { method: 'POST', body })
    await load(); await choose(asset); ElMessage.success('图片已校验并入库，可选择用于当前内容')
  })
  uploading.value = false
}
onMounted(async () => { if (canRead.value) await Promise.all([load(), refreshDefaults().catch((cause) => { error.value = cause instanceof Error ? cause.message : '默认规则读取失败' })]) })
onBeforeUnmount(() => { loadEpoch++; detailEpoch++ })
</script>

<template>
  <p v-if="!canRead" class="settings-note">当前账号没有素材读取权限，请联系管理员授予 media.read。</p>
  <section v-else class="media-library">
    <form class="media-filters" @submit.prevent="load()">
      <label>名称或关键词<input v-model="filters.keyword" maxlength="120" placeholder="搜索素材名称" /></label>
      <label>素材类型<select v-model="filters.kind" :disabled="!!kind"><option value="">全部</option><option v-for="(label, value) in mediaKindLabels" :key="value" :value="value">{{ label }}</option></select></label>
      <label>内容类型<select v-model="filters.contentType" @change="filters.categoryKey = ''"><option value="">全部</option><option v-for="(label, value) in mediaTypeLabels" :key="value" :value="value">{{ label }}</option></select></label>
      <label>分类<select v-model="filters.categoryKey"><option value="">全部分类</option><option v-for="key in mediaCategories(filters.contentType)" :key="key">{{ key }}</option></select></label>
      <label>来源<select v-model="filters.source"><option value="">全部来源</option><option v-for="(label, value) in mediaSourceLabels" :key="value" :value="value">{{ label }}</option></select></label>
      <label>状态<select v-model="filters.status" :disabled="selectable"><option value="">全部状态</option><option value="active">可用</option><option value="archived">已归档</option></select></label>
      <label class="media-checkbox"><input v-model="filters.onlyUnused" type="checkbox" />仅未使用</label>
      <button class="admin-secondary" type="submit" :disabled="loading || busy">查询</button>
      <button class="text-link" type="button" :disabled="busy" @click="Object.assign(filters, { keyword: '', contentType: '', categoryKey: '', source: '', onlyUnused: false }); load()">清除筛选</button>
    </form>
    <p v-if="error" class="error-banner" role="alert">{{ error }} <button type="button" :disabled="busy" @click="reload">重新读取素材与默认规则</button></p>
    <details v-if="canWrite" class="media-upload">
      <summary>上传新图片</summary>
      <div class="media-filters">
        <label>素材名称<input v-model="uploadForm.name" maxlength="120" placeholder="默认使用文件名" /></label>
        <label>图片说明（alt）<input v-model="uploadForm.altText" maxlength="240" /></label>
        <label>用途<select v-model="uploadForm.kind" :disabled="!!kind"><option v-for="(label, value) in mediaKindLabels" :key="value" :value="value">{{ label }}</option></select></label>
        <label>内容类型<select v-model="uploadForm.contentType"><option v-for="(label, value) in mediaTypeLabels" :key="value" :value="value">{{ label }}</option></select></label>
        <label>分类 key<input v-model="uploadForm.categoryKey" pattern="[a-z0-9-]{1,80}" maxlength="80" /></label>
        <label class="media-file-input">选择文件<input type="file" :accept="trustedSvg ? 'image/jpeg,image/png,image/webp,image/svg+xml' : 'image/jpeg,image/png,image/webp'" :disabled="busy" @change="upload" /></label>
      </div>
      <p class="settings-note">最大5MB，支持PNG、JPEG、WebP{{ trustedSvg ? '及安全静态SVG' : '' }}。服务端校验真实格式、解码、尺寸与安全内容；重复图片复用现有素材。</p>
      <progress v-if="uploading" aria-label="正在上传并校验图片" />
    </details>
    <p v-if="loading" role="status">正在读取素材…</p>
    <div class="media-grid">
      <button v-for="asset in result.items" :key="asset.id" type="button" class="media-tile" :disabled="busy" :class="{ selected: selected?.id === asset.id }" :aria-pressed="selected?.id === asset.id" @click="choose(asset)">
        <MediaAssetPreview :asset-id="asset.id" :alt="asset.altText || asset.name" :focal-x="asset.focalX" :focal-y="asset.focalY" :revision="asset.revision" />
        <strong>{{ asset.name }}</strong><small>{{ mediaTypeLabels[asset.contentType] }} · {{ asset.width }}×{{ asset.height }} · {{ (asset.file.size / 1024).toFixed(1) }}KB</small>
        <small>{{ mediaSourceLabels[asset.source] }} · {{ asset.status === 'active' ? '可用' : '已归档' }}</small>
      </button>
    </div>
    <p v-if="!loading && !result.items.length" class="admin-empty">没有符合筛选条件的素材，可清除筛选或上传新图片。</p>
    <AdminPagination :page="result.page" :page-size="result.pageSize" :total="result.total" :disabled="busy" @change="load" />
    <section v-if="selected" class="media-detail">
      <div><MediaAssetPreview :asset-id="selected.id" :alt="edit.altText || selected.name" :focal-x="edit.focalX" :focal-y="edit.focalY" :revision="selected.revision" /><p class="settings-note">{{ selected.file.mimeType }} · {{ selected.assetKey }}</p></div>
      <div>
        <h3>素材详情与引用</h3>
        <label>名称<input v-model="edit.name" maxlength="120" :disabled="!canWrite || busy" /></label>
        <label>图片说明（alt）<input v-model="edit.altText" maxlength="240" :disabled="!canWrite || busy" /></label>
        <label>水平焦点 {{ edit.focalX.toFixed(2) }}<input v-model.number="edit.focalX" type="range" min="0" max="1" step=".01" :disabled="!canWrite || busy" /></label>
        <label>垂直焦点 {{ edit.focalY.toFixed(2) }}<input v-model.number="edit.focalY" type="range" min="0" max="1" step=".01" :disabled="!canWrite || busy" /></label>
        <div class="media-actions">
          <button v-if="selectable" class="admin-primary" type="button" :disabled="selected.status !== 'active' || busy || (!!kind && selected.kind !== kind)" @click="emit('select', selected)">使用此图片</button>
          <button v-if="canWrite" class="admin-secondary" type="button" :disabled="busy || !edit.name.trim()" @click="save">保存素材信息</button>
          <button v-if="canWrite" class="text-link" type="button" :disabled="busy" @click="archive">{{ selected.status === 'active' ? '归档素材' : '恢复素材' }}</button>
          <button v-if="canDelete" class="admin-danger" type="button" :disabled="busy || usageLoading || usageFailed || !!usage.length" @click="remove">删除素材</button>
        </div>
        <p class="settings-note">移除内容封面不会删除素材。归档后公开内容回退默认图；默认规则正在使用的素材不能归档。</p>
        <ul v-if="usage.length" class="media-usage"><li v-for="(item, index) in usage" :key="`${item.type}-${item.id}-${index}`">{{ usageLabels[item.usage] }} · {{ item.title }} <small>{{ mediaTypeLabels[item.type as MediaContentType] || item.type }}</small></li></ul>
        <p v-else class="settings-note">{{ usageLoading ? '正在读取引用…' : usageFailed ? '引用读取失败，暂不能删除。' : '未发现内容、历史、默认或页面设置引用。' }}</p>
        <div v-if="canDefault && ['cover', 'hero'].includes(selected.kind)" class="media-default-form">
          <h4>设为默认封面</h4>
          <label>内容类型<select v-model="defaultTarget.contentType" :disabled="busy"><option v-for="(label, value) in mediaTypeLabels" :key="value" :value="value" :disabled="selected.kind === 'hero' ? value !== 'page_hero' : value === 'page_hero'">{{ label }}</option></select></label>
          <label>分类 key<input v-model="defaultTarget.categoryKey" :disabled="busy" list="media-default-categories" pattern="[a-z0-9-]{1,80}" maxlength="80" /><datalist id="media-default-categories"><option v-for="key in mediaCategories(defaultTarget.contentType)" :key="key">{{ key }}</option></datalist></label>
          <button class="admin-secondary" type="button" :disabled="busy || selected.status !== 'active' || !/^[a-z0-9-]{1,80}$/.test(defaultTarget.categoryKey)" @click="setDefault">保存默认规则</button>
        </div>
      </div>
    </section>
    <details v-if="!selectable" class="media-default-list"><summary>当前默认规则（{{ defaults.length }}）</summary><ul><li v-for="rule in defaults" :key="rule.id">{{ mediaTypeLabels[rule.contentType] }} / {{ rule.categoryKey }}：{{ rule.asset.name }} · {{ rule.active ? '启用' : '停用' }}</li></ul></details>
  </section>
</template>

<style scoped>
.media-library, .media-library :is(div, section, button, label) { min-width: 0; }
.media-filters { display: flex; align-items: end; flex-wrap: wrap; gap: 12px; margin-bottom: 16px; }
.media-filters label:not(.media-checkbox) { display: grid; gap: 6px; flex: 1 1 125px; font-size: 12px; color: #69635d; }
.media-filters input:not([type="checkbox"]), .media-filters select, .media-detail input, .media-detail select { width: 100%; min-width: 0; min-height: 34px; border: 1px solid #e5e0da; border-radius: 7px; padding: 7px 9px; background: #fff; }
.media-filters .media-checkbox { flex: 0 0 auto; padding-bottom: 8px; }
.media-upload { padding: 14px; margin: 16px 0; border: 1px solid #e7e2dc; border-radius: 12px; background: #faf9f7; }
.media-upload summary, .media-default-list summary { cursor: pointer; margin-bottom: 12px; }
.media-grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 14px; }
.media-tile { display: flex; flex-direction: column; gap: 7px; padding: 8px; text-align: left; border: 1px solid #e8e4de; border-radius: 13px; background: #fff; color: #332f2b; cursor: pointer; }
.media-tile.selected { outline: 2px solid #ff4d1f; outline-offset: 1px; }
.media-tile strong { display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; min-height: 2.8em; overflow: hidden; overflow-wrap: anywhere; font-size: 13px; line-height: 1.4; }
.media-tile small, .media-detail .settings-note { color: #817970; font-size: 11px; overflow-wrap: anywhere; }
.media-detail { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1.1fr); gap: 24px; padding-top: 22px; border-top: 1px solid #e7e2dc; }
.media-detail label { display: grid; gap: 5px; margin: 10px 0; font-size: 12px; }
.media-actions { display: flex; flex-wrap: wrap; gap: 10px; margin: 16px 0; }
.media-usage { max-height: 180px; overflow: auto; padding-left: 20px; font-size: 12px; line-height: 1.8; overflow-wrap: anywhere; }
.media-default-form, .media-default-list { margin-top: 18px; padding-top: 14px; border-top: 1px solid #e7e2dc; }
.media-default-list li { margin: 8px 0; font-size: 12px; overflow-wrap: anywhere; }
@media (max-width: 900px) { .media-grid { grid-template-columns: repeat(3, minmax(0, 1fr)); } }
@media (max-width: 640px) { .media-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); } .media-detail { grid-template-columns: minmax(0, 1fr); } }
</style>
