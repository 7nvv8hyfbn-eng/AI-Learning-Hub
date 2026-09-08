<script setup lang="ts">
import type { AdminThemeDetailDto } from '@ai-learning-hub/contracts'
import { ElMessage } from 'element-plus'
import { onMounted, reactive, ref, watch } from 'vue'
import AdminKpiCard from '../../components/AdminKpiCard.vue'
import DomainPageShell from '../../components/DomainPageShell.vue'
import { useDraftEditor } from '../../composables/useDraftEditor'
import { usePagedList } from '../../composables/usePagedList'
import { usePermissionAction } from '../../composables/usePermissionAction'
import { usePublishAction } from '../../composables/usePublishAction'
import { api } from '../../services/api'

interface Stage { stageKey: string; name: string; description: string; stageType: string; targetType: string; targetId: string }
const list = usePagedList('themes')
const { result, keyword, status, dataOrigin, loading, error, selected } = list
const drafts = useDraftEditor('themes')
const publishing = usePublishAction('themes')
const canWrite = usePermissionAction('theme.write')
const canPublish = usePermissionAction('theme.publish')
const dialog = ref(false)
const detail = ref<AdminThemeDetailDto | null>(null)
const fields = reactive({ subtitle: '', introduction: '', icon: '', accent: '', recommended: false, recommendedCourseIds: [] as string[], relatedLabIds: [] as string[], relatedResourceIds: [] as string[] })
const stages = ref<Stage[]>([])
const courseOptions = ref<Array<{ databaseId: string; title: string }>>([])
const labOptions = ref<Array<{ databaseId: string; title: string; labType: string }>>([])
const resourceOptions = ref<Array<{ databaseId: string; title: string }>>([])
const stageOptions = (type: string) => type === 'course'
  ? courseOptions.value
  : labOptions.value.filter((item) => type !== 'project' || item.labType === 'project')
watch(list.selected, async (item) => {
  if (!item) return
  detail.value = await api<AdminThemeDetailDto>(`/admin/themes/${item.databaseId}`)
  Object.assign(fields, {
    subtitle: String(item.data.subtitle || ''),
    introduction: String(item.data.introduction || ''),
    icon: String(item.data.icon || ''),
    accent: String(item.data.accent || ''),
    recommended: Boolean(item.data.recommended),
    recommendedCourseIds: Array.isArray(item.data.recommendedCourseIds) ? item.data.recommendedCourseIds.map(String) : [],
    relatedLabIds: Array.isArray(item.data.relatedLabIds) ? item.data.relatedLabIds.map(String) : [],
    relatedResourceIds: Array.isArray(item.data.relatedResourceIds) ? item.data.relatedResourceIds.map(String) : [],
  })
  stages.value = detail.value?.paths?.[0]?.stages.map((stage) => {
    const content = stage.contents[0]
    return {
      stageKey: stage.stageKey,
      name: stage.name,
      description: stage.description,
      stageType: stage.stageType,
      targetType: content?.targetType || '',
      targetId: content?.targetId || '',
    }
  }) || []
})
onMounted(async () => {
  await list.load(1)
  const [courses, labs, resources] = await Promise.all([
    api<{ items: Array<{ databaseId: string; title: string }> }>('/admin/courses?page=1&pageSize=50'),
    api<{ items: Array<{ databaseId: string; title: string; labType: string }> }>('/admin/labs?page=1&pageSize=50'),
    api<{ items: Array<{ databaseId: string; title: string }> }>('/admin/resources?page=1&pageSize=50'),
  ])
  courseOptions.value = courses.items
  labOptions.value = labs.items
  resourceOptions.value = resources.items
})
const create = async (value: { slug: string; title: string; summary: string; coverAssetId: string | null }) => {
  await drafts.createDraft(value); dialog.value = false; await list.load(1); ElMessage.success('主题草稿已创建')
}
const save = async (base: { title: string; summary: string; sortOrder: number; coverAssetId?: string | null }) => {
  if (!list.selected.value) return
  await drafts.saveDraft(list.selected.value, { ...base, ...fields })
  if (stages.value.length) {
    await api(`/admin/themes/${list.selected.value.databaseId}/path`, {
      method: 'PUT',
      body: JSON.stringify({
        name: `${base.title}学习路径`,
        description: fields.introduction || base.summary,
        stages: stages.value.map((stage) => ({ ...stage, unlockRule: {}, targetType: stage.targetType || undefined, targetId: stage.targetId || undefined })),
      }),
    })
  }
  await list.load(); ElMessage.success('主题与可视化学习路径已保存')
}
const publish = async () => { if (list.selected.value) { await publishing.publish(list.selected.value); await list.load(); ElMessage.success('主题已发布') } }
const archive = async () => { if (list.selected.value) { await publishing.archive(list.selected.value); await list.load(); ElMessage.success('主题已下架') } }
const addStage = () => stages.value.push({ stageKey: `stage-${stages.value.length + 1}`, name: '', description: '', stageType: 'learning', targetType: '', targetId: '' })
</script>

<template>
  <DomainPageShell content-type="theme" :category-key="selected?.slug || 'generic'" :data-origin="dataOrigin" @update:data-origin="list.dataOrigin.value = $event" @remove="drafts.removeDraft(selected, () => list.load())" v-model:dialog="dialog" title="通识基础管理" description="管理主题视觉、学习路径与阶段内容" noun="主题" icon="theme" :result="result" :selected="selected" :keyword="keyword" :status="status" :loading="loading" :error="error" :can-write="canWrite" :can-publish="canPublish" @update:keyword="list.keyword.value = $event" @update:status="list.status.value = $event" @select="list.select" @page="list.load" @retry="list.load()" @create="create" @save="save" @publish="publish" @archive="archive">
    <template #kpis><div class="kpi-grid"><AdminKpiCard icon="theme" label="主题总数" :value="result.total" color="#ff4d1f" /><AdminKpiCard icon="check" label="已发布" :value="result.items.filter((item) => item.status === 'published').length" color="#22b66c" /><AdminKpiCard icon="growth" label="路径阶段" :value="stages.length" color="#7c4dff" /><AdminKpiCard icon="publish" label="推荐主题" :value="result.items.filter((item) => item.data.recommended).length" color="#3478f6" /></div></template>
    <template #detail><p>{{ detail?.paths?.length || 0 }} 条学习路径 · {{ stages.length }} 个阶段</p></template>
    <template #editor>
      <fieldset class="domain-permission-scope" :disabled="!canWrite">
      <section class="domain-section"><h3>主题视觉与介绍</h3><label>副标题<input v-model="fields.subtitle" /></label><label>主题介绍<textarea v-model="fields.introduction" rows="3" /></label><label>图标<input v-model="fields.icon" placeholder="图标 key（如 brain）" /></label><label>主题色<input v-model="fields.accent" type="color" /></label><label class="toggle-row">首页推荐<el-switch v-model="fields.recommended" /></label><label>推荐课程<select v-model="fields.recommendedCourseIds" multiple><option v-for="item in courseOptions" :key="item.databaseId" :value="item.databaseId">{{ item.title }}</option></select></label><label>关联实训<select v-model="fields.relatedLabIds" multiple><option v-for="item in labOptions" :key="item.databaseId" :value="item.databaseId">{{ item.title }}</option></select></label><label>关联资源<select v-model="fields.relatedResourceIds" multiple><option v-for="item in resourceOptions" :key="item.databaseId" :value="item.databaseId">{{ item.title }}</option></select></label></section>
      <section class="domain-section"><h3>学习路径阶段 <button class="text-link" type="button" @click="addStage">添加阶段</button></h3><div v-for="(stage, index) in stages" :key="`${stage.stageKey}-${index}`" class="stage-editor"><label>stageKey<input v-model="stage.stageKey" required /></label><label>阶段名称<input v-model="stage.name" required /></label><label>说明<input v-model="stage.description" /></label><label>性质<select v-model="stage.stageType"><option>learning</option><option>practice</option><option>project</option></select></label><label>关联类型<select v-model="stage.targetType" @change="stage.targetId = ''"><option value="">不关联</option><option>course</option><option>lab</option><option>project</option></select></label><label>关联内容<select v-model="stage.targetId" :disabled="!stage.targetType"><option value="">请选择</option><option v-for="item in stageOptions(stage.targetType)" :key="item.databaseId" :value="item.databaseId">{{ item.title }}</option></select></label><button class="admin-danger" type="button" @click="stages.splice(index, 1)">移除</button></div></section>
      </fieldset>
    </template>
  </DomainPageShell>
</template>
