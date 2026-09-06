<script setup lang="ts">
import type { AdminResourceDetailDto, ResourceHubAdminConfigDto, ResourceHubCategoryDto, ResourceHubItemDto, UpdateResourceInput } from '@ai-learning-hub/contracts'
import { ElMessage } from 'element-plus'
import { onMounted, reactive, ref, watch } from 'vue'
import AdminKpiCard from '../../components/AdminKpiCard.vue'
import DomainPageShell from '../../components/DomainPageShell.vue'
import { useDraftEditor } from '../../composables/useDraftEditor'
import { usePagedList } from '../../composables/usePagedList'
import { usePermissionAction } from '../../composables/usePermissionAction'
import { usePublishAction } from '../../composables/usePublishAction'
import { api } from '../../services/api'

const list = usePagedList('resources')
const { result, keyword, status, dataOrigin, loading, error, selected } = list
const drafts = useDraftEditor('resources')
const publishing = usePublishAction('resources')
const canWrite = usePermissionAction('resource.write')
const canPublish = usePermissionAction('resource.publish')
const canCreateCourse = usePermissionAction('course.write')
const dialog = ref(false)
const detail = ref<AdminResourceDetailDto | null>(null)
const file = ref<File | null>(null)
type HubItem = ResourceHubItemDto & { status: string; visibility: string; reportCount: number; deletedAt: string | null; categoryId: string }
type HubCategory = ResourceHubCategoryDto & { active: boolean }
type HubCollection = { id: string; name: string; description: string; learningGoal: string; revision: number; owner: { id: string; username: string; displayName: string }; _count: { items: number; courseLinks: number }; courseLinks: Array<{ courseId: string; courseVersionId: string; sourceRevision: number }> }
const hubTab = ref<'legacy' | 'content' | 'home' | 'categories' | 'collections' | 'processing' | 'reports'>('legacy')
const hubItems = ref<HubItem[]>([])
const hubKeyword = ref('')
const hubKind = ref<'all' | 'video' | 'article' | 'document'>('all')
const hubCategory = ref('')
const hubExpanded = ref(false)
const hubCategories = ref<HubCategory[]>([])
const hubConfig = ref<ResourceHubAdminConfigDto>({ revision: 0, bannerPostIds: [], sectionCategoryCodes: [] })
const hubFailures = ref<Array<{ id: string; originalName: string; attempts: number; lastError: string | null; contribution: { postId: string; post: { title: string | null } } | null }>>([])
const hubReports = ref<Array<{ id: string; postId: string | null; reason: string; description: string; status: string; createdAt: string }>>([])
const hubCollections = ref<HubCollection[]>([])
const hubReason = ref('资源中心后台整理')
const newCategory = reactive({ code: '', name: '', description: '', icon: 'resource', sortOrder: 100, active: true })
const courseDrafts = reactive<Record<string, { title: string; slug: string }>>({})
const themeOptions = ref<Array<{ databaseId: string; title: string }>>([])
const courseOptions = ref<Array<{ databaseId: string; title: string }>>([])
const labOptions = ref<Array<{ databaseId: string; title: string }>>([])
const fields = reactive<{
  category: string
  format: string
  visibility: 'public' | 'authenticated' | 'private'
  difficulty: string
  tags: string
  downloadPermission: 'public' | 'authenticated' | 'restricted'
  themeId: string
  courseId: string
  labId: string
  fileId: string
}>({ category: '', format: '', visibility: 'public', difficulty: '', tags: '', downloadPermission: 'authenticated', themeId: '', courseId: '', labId: '', fileId: '' })
watch(list.selected, async (item) => {
  if (!item) return
  const loaded = await api<AdminResourceDetailDto>(`/admin/resources/${item.databaseId}`)
  detail.value = loaded
  Object.assign(fields, {
    category: loaded.category || '',
    format: loaded.format || '',
    visibility: loaded.visibility || 'public',
    difficulty: String(item.data.difficulty || ''),
    tags: Array.isArray(item.data.tags) ? item.data.tags.join(',') : '',
    downloadPermission: String(item.data.downloadPermission || 'authenticated'),
    themeId: String(item.data.themeId || ''),
    courseId: String(item.data.courseId || ''),
    labId: String(item.data.labId || ''),
    fileId: loaded.file?.id || '',
  })
})
onMounted(async () => {
  await list.load(1)
  const [themes, courses, labs] = await Promise.all([
    api<{ items: Array<{ databaseId: string; title: string }> }>('/admin/themes?page=1&pageSize=50'),
    api<{ items: Array<{ databaseId: string; title: string }> }>('/admin/courses?page=1&pageSize=50'),
    api<{ items: Array<{ databaseId: string; title: string }> }>('/admin/labs?page=1&pageSize=50'),
  ])
  themeOptions.value = themes.items
  courseOptions.value = courses.items
  labOptions.value = labs.items
  await loadHub()
})
const hubItemsPath = () => `/admin/resource-hub/items?${new URLSearchParams({ limit: hubExpanded.value ? '48' : '18', keyword: hubKeyword.value, kind: hubKind.value, category: hubCategory.value })}`
const loadHubItems = async () => {
  const items = await api<Omit<HubItem, 'categoryId'>[]>(hubItemsPath())
  hubItems.value = items.map((item) => ({ ...item, categoryId: item.category?.id || '' }))
}
watch(hubTab, async (tab) => {
  if (tab !== 'content' && tab !== 'home') return
  hubExpanded.value = tab === 'home'
  await loadHubItems()
})
const loadHub = async () => {
  const [items, categories, config, failures, reports, collections] = await Promise.all([
    api<Omit<HubItem, 'categoryId'>[]>(hubItemsPath()),
    api<HubCategory[]>('/admin/resource-hub/categories'),
    api<ResourceHubAdminConfigDto>('/admin/resource-hub/config'),
    api<typeof hubFailures.value>('/admin/resource-hub/processing-failures'),
    api<typeof hubReports.value>('/admin/resource-hub/reports').catch(() => []),
    api<HubCollection[]>('/admin/resource-hub/collections'),
  ])
  hubItems.value = items.map((item) => ({ ...item, categoryId: item.category?.id || '' })); hubCategories.value = categories; hubConfig.value = config; hubFailures.value = failures; hubReports.value = reports; hubCollections.value = collections
  for (const collection of collections) courseDrafts[collection.id] ||= { title: collection.name, slug: `collection-${collection.id.slice(-8).toLowerCase()}` }
}
const updateHubItem = async (item: HubItem) => {
  if (!item.postId || !item.categoryId) return
  await api(`/admin/resource-hub/items/${item.postId}`, { method: 'PATCH', body: JSON.stringify({ categoryId: item.categoryId, featured: item.featured, liveReplay: item.liveReplay, reason: hubReason.value }) })
  ElMessage.success('共创作品已更新'); await loadHub()
}
const saveHubConfig = async () => {
  hubConfig.value = await api<ResourceHubAdminConfigDto>('/admin/resource-hub/config', { method: 'PATCH', body: JSON.stringify(hubConfig.value) })
  ElMessage.success('资源中心首页配置已保存')
}
const createHubCategory = async () => {
  await api('/admin/resource-hub/categories', { method: 'POST', body: JSON.stringify(newCategory) })
  Object.assign(newCategory, { code: '', name: '', description: '', icon: 'resource', sortOrder: 100, active: true }); await loadHub()
}
const saveHubCategory = async (category: HubCategory) => {
  await api(`/admin/resource-hub/categories/${category.id}`, { method: 'PATCH', body: JSON.stringify(category) }); await loadHub()
}
const retryHubVideo = async (id: string) => { await api(`/admin/resource-hub/processing-failures/${id}/retry`, { method: 'POST' }); await loadHub() }
const cleanupHubVideos = async () => {
  const result = await api<{ removedAssets: number; queuedFiles: string[]; retentionHours: number }>('/admin/resource-hub/processing-orphans/cleanup', { method: 'POST' })
  ElMessage.success(`已清理 ${result.removedAssets} 个超过 ${result.retentionHours} 小时的孤立视频${result.queuedFiles.length ? `，${result.queuedFiles.length} 个文件进入安全重试队列` : ''}`)
  await loadHub()
}
const collectionToCourse = async (collection: HubCollection) => {
  const input = courseDrafts[collection.id]
  await api(`/admin/resource-hub/collections/${collection.id}/course`, { method: 'POST', body: JSON.stringify(input) })
  ElMessage.success('已生成课程草稿'); await loadHub()
}
const input = (): UpdateResourceInput => ({ ...fields, tags: fields.tags.split(',').map((item) => item.trim()).filter(Boolean) })
const create = async (value: { slug: string; title: string; summary: string; coverAssetId: string | null }) => { await drafts.createDraft({ ...value, category: '学习手册', format: 'PDF', visibility: 'authenticated' }); dialog.value = false; await list.load(1); ElMessage.success('资源草稿已创建') }
const save = async (base: { title: string; summary: string; sortOrder: number; coverAssetId?: string | null }) => {
  if (!list.selected.value) return
  await drafts.saveDraft(list.selected.value, { ...base, ...input() }); await list.load(); ElMessage.success('资源元数据已保存')
}
const uploadAndBind = async () => {
  if (!file.value || !list.selected.value) return
  const body = new FormData()
  body.set('file', file.value)
  body.set('visibility', fields.visibility)
  const uploaded = await api<{ id: string; originalName: string }>('/admin/files/upload', { method: 'POST', body })
  try {
    fields.fileId = uploaded.id
    fields.format ||= file.value.name.split('.').pop()?.toUpperCase() || ''
    await drafts.saveDraft(list.selected.value, { title: list.selected.value.title, summary: list.selected.value.summary, sortOrder: list.selected.value.sortOrder, ...input() })
  } catch (error) {
    fields.fileId = ''
    await api(`/admin/files/${uploaded.id}`, { method: 'DELETE' }).catch(() => undefined)
    throw error
  }
  detail.value = await api<AdminResourceDetailDto>(`/admin/resources/${list.selected.value.databaseId}`)
  file.value = null
  ElMessage.success('文件已上传并绑定到当前资源草稿')
}
const restoreVersion = async (versionId: string) => {
  if (!list.selected.value) return
  detail.value = await api<AdminResourceDetailDto>(`/admin/resources/${list.selected.value.databaseId}/versions/${versionId}/restore`, { method: 'POST' })
  await list.load(list.result.value.page)
  ElMessage.success('已从历史版本生成新的资源草稿版本')
}
const publish = async () => { if (list.selected.value) { await publishing.publish(list.selected.value); await list.load(); ElMessage.success('资源已发布') } }
const archive = async () => { if (list.selected.value) { await publishing.archive(list.selected.value); await list.load(); ElMessage.success('资源已下架') } }
</script>

<template><div class="resource-admin-page">
  <nav class="resource-admin-tabs" aria-label="资源中心管理工作区"><button v-for="item in ([['legacy','旧资源'],['content','共创内容'],['home','首页配置'],['categories','分类'],['collections','合集与课程'],['processing','处理异常'],['reports','举报']] as const)" :key="item[0]" :class="{ active: hubTab === item[0] }" @click="hubTab = item[0]">{{ item[1] }}</button></nav>
  <DomainPageShell v-if="hubTab === 'legacy'" content-type="resource" :category-key="fields.category" :data-origin="dataOrigin" @update:data-origin="list.dataOrigin.value = $event" @remove="drafts.removeDraft(selected, () => list.load())" v-model:dialog="dialog" title="资源中心管理" description="维护旧版资源文件、元数据、可见范围与关联内容" noun="资源" icon="resource" :result="result" :selected="selected" :keyword="keyword" :status="status" :loading="loading" :error="error" :can-write="canWrite" :can-publish="canPublish" @update:keyword="list.keyword.value = $event" @update:status="list.status.value = $event" @select="list.select" @page="list.load" @retry="list.load()" @create="create" @save="save" @publish="publish" @archive="archive">
    <template #kpis><div class="kpi-grid"><AdminKpiCard icon="resource" label="资源总数" :value="result.total" color="#ff4d1f" /><AdminKpiCard icon="check" label="已发布" :value="result.items.filter((item) => item.status === 'published').length" color="#22b66c" /><AdminKpiCard icon="download" label="当前下载" :value="detail?.downloads ?? '—'" color="#7c4dff" /><AdminKpiCard icon="chart" label="当前浏览" :value="detail?.views ?? '—'" color="#3478f6" /></div></template>
    <template #detail><p v-if="detail?.file">{{ detail.file.name }} · {{ (detail.file.size / 1024 / 1024).toFixed(2) }} MB · {{ detail.file.mimeType }} · 上传人 {{ detail.uploadedBy?.displayName || '—' }}</p><p v-else>尚未绑定文件。</p></template>
    <template #editor>
      <fieldset class="domain-permission-scope" :disabled="!canWrite">
      <section class="domain-section"><h3>资源元数据</h3><label>资源分类<select v-model="fields.category"><option v-for="name in ['学习手册','提示词模板','部署指南','Agent 案例','命令速查','硬件资料']" :key="name">{{ name }}</option></select></label><label>格式<input v-model="fields.format" /></label><label>难度<select v-model="fields.difficulty"><option value="">尚未配置</option><option>入门</option><option>中级</option><option>进阶</option></select></label><label>标签（逗号分隔）<input v-model="fields.tags" /></label><label>可见范围<select v-model="fields.visibility"><option>public</option><option>authenticated</option><option>private</option></select></label><label>下载权限<select v-model="fields.downloadPermission"><option>public</option><option>authenticated</option><option>restricted</option></select></label><label>关联主题<select v-model="fields.themeId"><option value="">不关联</option><option v-for="item in themeOptions" :key="item.databaseId" :value="item.databaseId">{{ item.title }}</option></select></label><label>关联课程<select v-model="fields.courseId"><option value="">不关联</option><option v-for="item in courseOptions" :key="item.databaseId" :value="item.databaseId">{{ item.title }}</option></select></label><label>关联实训<select v-model="fields.labId"><option value="">不关联</option><option v-for="item in labOptions" :key="item.databaseId" :value="item.databaseId">{{ item.title }}</option></select></label></section>
      <section class="domain-section"><h3>文件上传与绑定</h3><input type="file" @change="file = ($event.target as HTMLInputElement).files?.[0] || null" /><button class="admin-secondary" type="button" :disabled="!file || !canWrite" @click="uploadAndBind">上传并绑定当前草稿</button><p>文件上传与资源元数据分别记录，绑定成功后才进入发布版本。</p></section>
      <section class="domain-section"><h3>版本历史</h3><ul><li v-for="version in detail?.versions || []" :key="version.id">v{{ version.versionNo }} · {{ new Date(version.createdAt).toLocaleString('zh-CN') }} · {{ version.snapshot.title }} <button class="text-link" type="button" :disabled="!canWrite" @click="restoreVersion(version.id)">恢复为新草稿</button></li></ul><p v-if="!detail?.versions.length">暂无历史版本。</p></section>
      </fieldset>
    </template>
  </DomainPageShell>
  <section v-else class="resource-admin-workspace">
    <header><div><h1>{{ { content: '共创内容', home: '首页配置', categories: '资源分类', collections: '合集与课程引用', processing: '视频处理异常', reports: '资源举报' }[hubTab] }}</h1><p>复用现有资源权限、社区审核和课程版本机制。</p></div><button class="admin-secondary" @click="loadHub">刷新</button></header>

    <template v-if="hubTab === 'content'">
      <form class="resource-admin-filters" @submit.prevent="hubExpanded = false; loadHubItems()">
        <input v-model="hubKeyword" maxlength="120" placeholder="搜索标题或正文" />
        <select v-model="hubKind" @change="hubExpanded = false; loadHubItems()"><option value="all">全部形态</option><option value="video">视频</option><option value="article">图文</option><option value="document">资料</option></select>
        <select v-model="hubCategory" @change="hubExpanded = false; loadHubItems()"><option value="">全部分类</option><option v-for="category in hubCategories.filter((row) => row.active)" :key="category.id" :value="category.code">{{ category.name }}</option></select>
        <button class="admin-secondary" type="submit">搜索</button>
        <button class="text-link" type="button" @click="hubKeyword = ''; hubKind = 'all'; hubCategory = ''; hubExpanded = false; loadHubItems()">清空</button>
      </form>
      <label>操作理由<input v-model="hubReason" minlength="4" /></label>
      <div class="resource-admin-list"><article v-for="item in hubItems" :key="item.id"><div><strong>{{ item.title }}</strong><small>{{ item.author?.displayName || '未知作者' }} · {{ item.kind }} · {{ item.status }} · {{ item.mediaStatus || '无媒体处理' }} · {{ item.visibility }} · 举报 {{ item.reportCount }}</small></div><select v-model="item.categoryId"><option v-for="category in hubCategories.filter((row) => row.active)" :key="category.id" :value="category.id">{{ category.name }}</option></select><label><input v-model="item.featured" type="checkbox" />首页精选</label><label><input v-model="item.liveReplay" type="checkbox" />直播回放</label><RouterLink class="admin-secondary" :to="{ path: '/community', query: { postId: item.postId } }">进入治理</RouterLink><button class="admin-secondary" :disabled="!canWrite" @click="updateHubItem(item)">保存</button></article><p v-if="!hubItems.length">没有符合条件的共创内容。</p></div>
      <button v-if="!hubExpanded && hubItems.length === 18" class="admin-secondary" type="button" @click="hubExpanded = true; loadHubItems()">显示更多共创内容</button>
    </template>

    <template v-else-if="hubTab === 'home'">
      <section class="panel domain-section"><h2>主推荐 Banner</h2><p>最多选择 5 条公开、已发布且媒体就绪的共创作品，顺序即前台顺序。</p><label v-for="item in hubItems.filter((row) => row.status === 'published' && row.visibility === 'public' && (row.kind !== 'video' || row.mediaStatus === 'ready'))" :key="item.id"><input v-model="hubConfig.bannerPostIds" type="checkbox" :value="item.postId" :disabled="!hubConfig.bannerPostIds.includes(item.postId!) && hubConfig.bannerPostIds.length >= 5" />{{ item.title }}</label></section>
      <section class="panel domain-section"><h2>首页内容分区</h2><label v-for="category in hubCategories.filter((row) => row.active)" :key="category.id"><input v-model="hubConfig.sectionCategoryCodes" type="checkbox" :value="category.code" />{{ category.name }}</label></section>
      <button class="admin-primary" :disabled="!canWrite" @click="saveHubConfig">保存首页配置</button>
    </template>

    <template v-else-if="hubTab === 'categories'">
      <form class="resource-category-create" @submit.prevent="createHubCategory"><input v-model="newCategory.code" required pattern="[a-z0-9-]+" placeholder="稳定英文标识" /><input v-model="newCategory.name" required placeholder="分类名称" /><input v-model="newCategory.description" placeholder="简短说明" /><input v-model="newCategory.icon" required placeholder="图标语义名" /><input v-model.number="newCategory.sortOrder" type="number" min="0" /><button class="admin-primary" :disabled="!canWrite">新增分类</button></form>
      <div class="resource-admin-list"><article v-for="category in hubCategories" :key="category.id"><input v-model="category.name" /><input v-model="category.description" /><input v-model="category.icon" /><input v-model.number="category.sortOrder" type="number" min="0" /><label><input v-model="category.active" type="checkbox" />启用</label><button class="admin-secondary" :disabled="!canWrite" @click="saveHubCategory(category)">保存</button></article></div>
    </template>

    <template v-else-if="hubTab === 'collections'">
      <div class="resource-admin-list"><article v-for="collection in hubCollections" :key="collection.id"><div><strong>{{ collection.name }}</strong><small>{{ collection.owner.displayName }} · {{ collection._count.items }} 项 · 已引用 {{ collection._count.courseLinks }} 次</small><small v-if="collection.courseLinks.some((link) => link.sourceRevision !== collection.revision)" class="resource-source-change">合集已更新，已有课程草稿需要人工复核</small></div><input v-model="courseDrafts[collection.id].title" placeholder="课程标题" /><input v-model="courseDrafts[collection.id].slug" placeholder="课程标识" /><button class="admin-primary" :disabled="!canCreateCourse" @click="collectionToCourse(collection)">生成课程草稿</button></article></div><p v-if="!hubCollections.length">暂无公开合集。</p>
    </template>

    <template v-else-if="hubTab === 'processing'">
      <div><button class="admin-secondary" :disabled="!canWrite" @click="cleanupHubVideos">清理超过保留期的孤立上传</button></div>
      <div class="resource-admin-list"><article v-for="item in hubFailures" :key="item.id"><div><strong>{{ item.contribution?.post.title || item.originalName }}</strong><small>已尝试 {{ item.attempts }} 次 · {{ item.lastError }}</small></div><button class="admin-primary" :disabled="!canWrite" @click="retryHubVideo(item.id)">重试处理</button></article></div><p v-if="!hubFailures.length">当前没有处理失败的视频。</p>
    </template>

    <template v-else>
      <div class="resource-admin-list"><article v-for="report in hubReports" :key="report.id"><div><strong>{{ report.reason }}</strong><small>{{ report.status }} · {{ report.description }} · {{ new Date(report.createdAt).toLocaleString('zh-CN') }}</small></div><RouterLink v-if="report.postId" class="admin-secondary" :to="`/community?postId=${report.postId}`">进入社区审核</RouterLink></article></div><p v-if="!hubReports.length">当前没有资源举报。</p>
    </template>
  </section>
</div></template>

<style scoped>
.resource-admin-page { display: grid; gap: 16px; }
.resource-admin-tabs { display: flex; gap: 6px; overflow-x: auto; padding: 6px; border: 1px solid var(--el-border-color-light); border-radius: 12px; background: white; }
.resource-admin-tabs button { padding: 8px 14px; white-space: nowrap; border: 0; border-radius: 8px; background: transparent; cursor: pointer; }
.resource-admin-tabs button.active { color: var(--el-color-primary); background: var(--el-color-primary-light-9); }
.resource-admin-workspace { display: grid; gap: 16px; padding: 20px; border: 1px solid var(--el-border-color-light); border-radius: 14px; background: white; }
.resource-admin-workspace > header { display: flex; align-items: center; justify-content: space-between; gap: 16px; }
.resource-admin-workspace h1, .resource-admin-workspace p { margin: 0; }
.resource-admin-workspace header p, .resource-admin-list small { color: #7c8494; }
.resource-admin-list { display: grid; gap: 8px; }
.resource-admin-list article { display: flex; align-items: center; gap: 10px; min-width: 0; padding: 12px; border: 1px solid var(--el-border-color-light); border-radius: 10px; }
.resource-admin-list article > div { display: flex; flex: 1; flex-direction: column; min-width: 180px; }
.resource-admin-list article strong, .resource-admin-list article small { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.resource-admin-list .resource-source-change { color: var(--el-color-warning); }
.resource-admin-list :is(input, select), .resource-category-create input { min-width: 120px; height: 36px; }
.resource-admin-list label, .domain-section label { display: flex; align-items: center; gap: 6px; }
.resource-admin-list label input, .domain-section label input[type="checkbox"] { min-width: auto; height: auto; }
.resource-admin-filters { display: flex; flex-wrap: wrap; gap: 8px; }
.resource-admin-filters :is(input, select) { min-width: 150px; height: 36px; }
.resource-category-create { display: grid; grid-template-columns: repeat(5, minmax(120px, 1fr)) auto; gap: 8px; }
@media (max-width: 1100px) { .resource-admin-list article { align-items: stretch; flex-direction: column; } .resource-category-create { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
</style>
