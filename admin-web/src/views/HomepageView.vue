<script setup lang="ts">
import { LANDING_IMAGE_KEYS, landingConfigIssues, landingItemLimit, landingTargetTypes, type LandingModuleKey, type PublicHomepageDto } from '@ai-learning-hub/contracts'
import { ElMessage } from 'element-plus'
import { computed, onMounted, reactive, ref, watch } from 'vue'
import AdminKpiCard from '../components/AdminKpiCard.vue'
import AdminDialog from '../components/AdminDialog.vue'
import AdminPageHeader from '../components/AdminPageHeader.vue'
import AdminStatusTag from '../components/AdminStatusTag.vue'
import HomepagePreviewRenderer from '../components/HomepagePreviewRenderer.vue'
import LandingRegionEditor from '../components/homepage-editors/LandingRegionEditor.vue'
import { usePermissionAction } from '../composables/usePermissionAction'
import { api } from '../services/api'

interface HomepageModule {
  id: string; moduleKey: LandingModuleKey; name: string; enabled: boolean; sortOrder: number; status: string;
  config: Record<string, unknown>; items: Array<{ id: string; targetType: string; targetId: string; titleOverride?: string; summaryOverride?: string; coverOverride?: string; relationValid?: boolean }>
}
const modules = ref<HomepageModule[]>([])
const previewData = ref<PublicHomepageDto | null>(null)
const publishedVersion = ref(0)
const selected = ref<HomepageModule | null>(null)
const loading = ref(false)
const itemOpen = ref(false)
const canWrite = usePermissionAction('homepage.write')
const canPublish = usePermissionAction('homepage.publish')
const contentOptions = ref<Array<{ id: string; title: string; status: string }>>([])
const contentLoading = ref(false)
const itemForm = reactive({ targetType: 'community_post', targetId: '', titleOverride: '', summaryOverride: '', coverOverride: '' })
const editingItemId = ref('')
const allowedTypes = computed(() => selected.value ? landingTargetTypes(selected.value.moduleKey) : [])
const canAddItem = computed(() => selected.value && selected.value.items.length < landingItemLimit(selected.value.moduleKey))
const moduleReadiness = (item: HomepageModule) => {
  const issues = landingConfigIssues(item.moduleKey, item.config)
  return { ready: issues.length === 0, issues }
}
const selectedReadiness = computed(() => selected.value ? moduleReadiness(selected.value) : { ready: false, issues: ['未选择模块'] })
const kpis = computed(() => ({
  total: modules.value.length,
  enabled: modules.value.filter((item) => item.enabled).length,
  recommendations: modules.value.reduce((sum, item) => sum + item.items.length, 0),
  published: modules.value.filter((item) => item.status === 'published').length,
}))
const livePreview = computed(() => previewData.value ? {
  ...previewData.value,
  modules: modules.value.filter((module) => module.enabled).map((module) => ({
    id: module.id, moduleKey: module.moduleKey, name: module.name, sortOrder: module.sortOrder, config: module.config,
    items: previewData.value!.modules.find((item) => item.moduleKey === module.moduleKey)?.items || [],
  })),
} : null)
const load = async () => {
  modules.value = await api('/admin/homepage/modules')
  previewData.value = await api<PublicHomepageDto>('/admin/homepage/preview')
  publishedVersion.value = (await api<PublicHomepageDto>('/public/homepage')).version
  selected.value = modules.value.find((item) => item.id === selected.value?.id) || modules.value[0] || null
}
onMounted(load)
const save = async () => {
  if (!selected.value) return
  loading.value = true
  try {
    await api(`/admin/homepage/modules/${selected.value.id}`, { method: 'PATCH', body: JSON.stringify({ enabled: selected.value.enabled, sortOrder: selected.value.sortOrder, config: selected.value.config }) })
    await load()
    ElMessage.success('落地页区域草稿已保存')
  } finally { loading.value = false }
}
const publish = async () => {
  const incomplete = modules.value.filter((item) => item.enabled && !moduleReadiness(item).ready)
  if (incomplete.length) {
    ElMessage.error(`存在 ${incomplete.length} 个配置未完成模块，暂不能发布`)
    return
  }
  try {
    await api('/admin/homepage/publish', { method: 'POST' })
    await load()
    ElMessage.success('门户落地页已发布')
  } catch (cause) {
    ElMessage.error(cause instanceof Error ? cause.message : '门户落地页发布失败')
  }
}
const loadContentOptions = async () => {
  contentLoading.value = true
  if (!editingItemId.value) itemForm.targetId = ''
  try {
    contentOptions.value = await api(`/admin/homepage/content-options?type=${itemForm.targetType}`)
  } finally {
    contentLoading.value = false
  }
}
watch(itemOpen, (open) => { if (open) void loadContentOptions() })
watch(() => itemForm.targetType, () => { if (itemOpen.value) void loadContentOptions() })
const addItem = async () => {
  if (!selected.value) return
  await api(`/admin/homepage/modules/${selected.value.id}/items${editingItemId.value ? `/${editingItemId.value}` : ''}`, { method: editingItemId.value ? 'PATCH' : 'POST', body: JSON.stringify({ ...itemForm, sortOrder: editingItemId.value ? selected.value.items.findIndex((item) => item.id === editingItemId.value) : selected.value.items.length }) })
  itemOpen.value = false
  editingItemId.value = ''
  await load()
  ElMessage.success('推荐内容草稿已保存')
}
const openItem = (item?: HomepageModule['items'][number]) => {
  editingItemId.value = item?.id || ''
  Object.assign(itemForm, { targetType: item?.targetType || allowedTypes.value[0], targetId: item?.targetId || '', titleOverride: item?.titleOverride || '', summaryOverride: item?.summaryOverride || '', coverOverride: item?.coverOverride || '' })
  itemOpen.value = true
}
const moveItem = async (index: number, offset: number) => {
  if (!selected.value) return
  const next = index + offset
  if (next < 0 || next >= selected.value.items.length) return
  const reordered = [...selected.value.items]
  ;[reordered[index], reordered[next]] = [reordered[next], reordered[index]]
  const moduleId = selected.value.id
  modules.value = await api(`/admin/homepage/modules/${moduleId}/items/reorder`, {
    method: 'PUT',
    body: JSON.stringify({ items: reordered.map((item, sortOrder) => ({ id: item.id, sortOrder })) }),
  })
  selected.value = modules.value.find((item) => item.id === moduleId) || null
  previewData.value = await api<PublicHomepageDto>('/admin/homepage/preview')
}
const removeItem = async (itemId: string) => {
  if (!selected.value) return
  await api(`/admin/homepage/modules/${selected.value.id}/items/${itemId}`, { method: 'DELETE' })
  await load()
  ElMessage.success('推荐内容已移除')
}
const preview = async () => {
  previewData.value = await api<PublicHomepageDto>('/admin/homepage/preview')
  ElMessage.success('预览已按当前服务端草稿刷新')
}
const archive = async () => {
  if (!selected.value) return
  selected.value.enabled = false
  await save()
  ElMessage.success('模块已下架，发布后学生端不再展示')
}
const saveAndPublish = async () => { await save(); await publish() }
</script>

<template>
  <AdminPageHeader title="门户落地页" description="管理公开落地页的品牌文案、社区内容、图片与发布状态。">
    <template #actions><button class="admin-secondary" type="button" :disabled="!canWrite" @click="save">保存草稿</button><button class="admin-primary" type="button" :disabled="!canPublish" @click="publish">发布更新</button></template>
  </AdminPageHeader>
  <div class="kpi-grid">
    <AdminKpiCard icon="homepage" label="模块数量" :value="kpis.total" color="#ff4d1f" />
    <AdminKpiCard icon="check" label="已启用模块" :value="kpis.enabled" color="#7c4dff" />
    <AdminKpiCard icon="publish" label="推荐内容" :value="kpis.recommendations" color="#22b66c" />
    <AdminKpiCard icon="dashboard" label="已发布模块" :value="kpis.published" color="#3478f6" />
  </div>
  <section class="homepage-editor panel">
    <div class="module-list">
      <div class="panel-heading"><h2>固定五个区域</h2></div>
      <div v-for="(item, index) in modules" :key="item.id" :class="['module-row', { selected: selected?.id === item.id }]">
        <button type="button" @click="selected = item"><span>{{ String(index + 1).padStart(2, '0') }}</span><strong>{{ item.name }}</strong><AdminStatusTag :status="moduleReadiness(item).ready ? item.status : '配置未完成'" /><small>排序 {{ item.sortOrder }}</small></button>
      </div>
      <p class="drag-hint">页面区域顺序固定；旧首页内容与发布历史保留归档。当前发布 v{{ publishedVersion }}。</p>
    </div>
    <div class="homepage-preview">
      <div class="preview-title"><h2>落地页草稿预览（桌面端）</h2><button class="text-link" type="button" @click="preview">刷新预览</button></div>
      <HomepagePreviewRenderer :homepage="livePreview" />
    </div>
    <aside v-if="selected" class="module-settings">
      <div><h2>模块设置</h2><AdminStatusTag :status="selected.status" /></div>
      <fieldset class="domain-permission-scope" :disabled="!canWrite">
      <label>模块名称<input v-model="selected.name" disabled /></label>
      <label>模块标识<input v-model="selected.moduleKey" disabled /><small>系统内部标识，不可修改</small></label>
      <div v-if="!selectedReadiness.ready" class="homepage-readiness"><strong>配置未完成</strong><span v-for="issue in selectedReadiness.issues" :key="issue">{{ issue }}</span></div>
      <LandingRegionEditor :module-key="selected.moduleKey" v-model:config="selected.config" />
      <section v-if="allowedTypes.length" class="domain-section"><h3>推荐内容 <button class="text-link" type="button" :disabled="!canAddItem" @click="openItem()">添加</button></h3><small>最多 {{ landingItemLimit(selected.moduleKey) }} 项；话题最多五项，创作者最多四项。</small><ul><li v-for="(item, index) in selected.items" :key="item.id">{{ item.targetType }} · {{ item.titleOverride || item.targetId }} · {{ item.relationValid === false ? '关联失效' : '关联有效' }} <button class="text-link" type="button" @click="openItem(item)">编辑</button><button class="text-link" type="button" :disabled="index === 0" @click="moveItem(index, -1)">上移</button><button class="text-link" type="button" :disabled="index === selected.items.length - 1" @click="moveItem(index, 1)">下移</button><button class="text-link" type="button" @click="removeItem(item.id)">移除</button></li></ul><p v-if="!selected.items.length">暂无推荐内容；公开页面显示空态。</p></section>
      <label class="toggle-row">区域启用<el-switch v-model="selected.enabled" :disabled="['landing_hero','landing_bottom_cta'].includes(selected.moduleKey)" /></label>
      <div class="module-action-row"><button v-if="!['landing_hero','landing_bottom_cta'].includes(selected.moduleKey)" class="admin-danger" type="button" @click="archive">停用</button><button class="admin-primary" type="button" :disabled="loading || !canPublish" @click="saveAndPublish">保存并发布</button></div>
      </fieldset>
      <button class="admin-secondary" type="button" @click="preview">预览该模块</button>
    </aside>
  </section>
  <AdminDialog v-model="itemOpen" title="配置推荐内容"><form class="admin-form" @submit.prevent="addItem"><label>内容类型<select v-model="itemForm.targetType" :disabled="!!editingItemId"><option v-for="type in allowedTypes" :key="type">{{ type }}</option></select></label><label>选择公开内容<select v-model="itemForm.targetId" required :disabled="contentLoading || !!editingItemId"><option value="">{{ contentLoading ? '正在加载…' : '请选择已存在内容' }}</option><option v-for="item in contentOptions" :key="item.id" :value="item.id">{{ item.title }}</option></select></label><label>显示标题（可选）<input v-model="itemForm.titleOverride" maxlength="120" /></label><label>摘要覆盖（可选）<textarea v-model="itemForm.summaryOverride" maxlength="240" rows="3" /></label><label>封面覆盖<select v-model="itemForm.coverOverride"><option value="">使用内容封面</option><option v-for="key in LANDING_IMAGE_KEYS" :key="key" :value="key">{{ key }}</option></select></label><button class="admin-primary" type="submit" :disabled="contentLoading || !itemForm.targetId || !canWrite">保存推荐草稿</button></form></AdminDialog>
</template>
