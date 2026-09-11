<script setup lang="ts">
import type { AdminCourseDetailDto, MediaAssetDto } from '@ai-learning-hub/contracts'
import { ElMessage } from 'element-plus'
import { onMounted, reactive, ref, watch } from 'vue'
import AdminKpiCard from '../../components/AdminKpiCard.vue'
import AdminDialog from '../../components/AdminDialog.vue'
import DomainPageShell from '../../components/DomainPageShell.vue'
import MediaAssetPicker from '../../components/MediaAssetPicker.vue'
import MediaAssetPreview from '../../components/MediaAssetPreview.vue'
import { useDraftEditor } from '../../composables/useDraftEditor'
import { usePagedList } from '../../composables/usePagedList'
import { usePermissionAction } from '../../composables/usePermissionAction'
import { usePublishAction } from '../../composables/usePublishAction'
import { api } from '../../services/api'

const list = usePagedList('courses')
const { result, keyword, status, dataOrigin, loading, error, selected } = list
const drafts = useDraftEditor('courses')
const publishing = usePublishAction('courses')
const canWrite = usePermissionAction('course.write')
const canPublish = usePermissionAction('course.publish')
const dialog = ref(false)
const detail = ref<AdminCourseDetailDto | null>(null)
const previewOpen = ref(false)
const resourceOptions = ref<Array<{ databaseId: string; title: string }>>([])
const labOptions = ref<Array<{ databaseId: string; title: string }>>([])
const relationIds = reactive({ resources: [] as string[], labs: [] as string[] })
const fields = reactive({ category: '', level: '', mode: '', hours: 0, instructorName: '', instructorTitle: '', certificate: '' })
const content = reactive({ chapterTitle: '', lessonTitle: '', blockType: 'paragraph', blockText: '' })
const contentSaving = ref(false)
const newImage = reactive({ assetId: null as string | null, alt: '', caption: '' })
const imageDialog = ref(false), imageSaving = ref(false), imageError = ref('')
const editingImage = reactive({ lessonId: '', blockId: '', assetId: null as string | null, fileId: undefined as string | undefined, alt: '', caption: '', width: 0, height: 0 })
const imageSelected = (asset: MediaAssetDto, editing = false) => {
  if (editing) Object.assign(editingImage, { assetId: asset.id, fileId: undefined, alt: asset.altText, width: asset.width, height: asset.height })
  else Object.assign(newImage, { assetId: asset.id, alt: asset.altText })
}
const openImage = (lessonId: string, block?: { id: string; content: Record<string, unknown> }) => {
  const value = block?.content || {}
  Object.assign(editingImage, { lessonId, blockId: block?.id || '', assetId: typeof value.assetId === 'string' ? value.assetId : null, fileId: typeof value.fileId === 'string' ? value.fileId : undefined, alt: String(value.alt || ''), caption: String(value.caption || ''), width: Number(value.width || 0), height: Number(value.height || 0) })
  imageError.value = ''; imageDialog.value = true
}
watch(list.selected, async (item) => {
  if (!item) return
  detail.value = await api<AdminCourseDetailDto>(`/admin/courses/${item.databaseId}`)
  Object.assign(fields, {
    category: String(item.data.category || ''),
    level: String(item.data.level || ''),
    mode: String(item.data.mode || ''),
    hours: Number(item.data.hours || 0),
    instructorName: String((item.data.instructor as Record<string, unknown> | undefined)?.name || ''),
    instructorTitle: String((item.data.instructor as Record<string, unknown> | undefined)?.title || ''),
    certificate: String(item.data.certificate || ''),
  })
  relationIds.resources = detail.value.relatedResources.map((entry) => entry.id).filter((id): id is string => Boolean(id))
  relationIds.labs = detail.value.relatedLabs.map((entry) => entry.id).filter((id): id is string => Boolean(id))
})
onMounted(async () => {
  await list.load(1)
  const [resources, labs] = await Promise.all([
    api<{ items: Array<{ databaseId: string; title: string }> }>('/admin/resources?page=1&pageSize=50'),
    api<{ items: Array<{ databaseId: string; title: string }> }>('/admin/labs?page=1&pageSize=50'),
  ])
  resourceOptions.value = resources.items
  labOptions.value = labs.items
})
const create = async (value: { slug: string; title: string; summary: string; coverAssetId: string | null }) => { await drafts.createDraft(value); dialog.value = false; await list.load(1); ElMessage.success('课程草稿已创建') }
const save = async (base: { title: string; summary: string; sortOrder: number; coverAssetId?: string | null }) => {
  if (!list.selected.value) return
  await drafts.saveDraft(list.selected.value, { ...base, ...fields })
  await list.load(); ElMessage.success('课程基础信息已保存')
}
const addContent = async () => {
  if (!canWrite.value || contentSaving.value || !list.selected.value || !content.chapterTitle.trim() || !content.lessonTitle.trim() || (content.blockType === 'image' ? !newImage.assetId || !newImage.alt.trim() : !content.blockText.trim())) return
  contentSaving.value = true
  let createdChapter = false
  try {
    const chapter = await api<{ id: string }>(`/admin/courses/${list.selected.value.databaseId}/chapters`, { method: 'POST', body: JSON.stringify({ title: content.chapterTitle, description: '', sortOrder: detail.value?.chapters.length || 0 }) })
    createdChapter = true
    const lesson = await api<{ id: string }>(`/admin/chapters/${chapter.id}/lessons`, { method: 'POST', body: JSON.stringify({ title: content.lessonTitle, summary: (content.blockType === 'image' ? newImage.caption : content.blockText).slice(0, 120), lessonType: 'article', durationMinutes: 10, sortOrder: 0 }) })
    const value = content.blockType === 'image' ? { ...newImage } : content.blockType === 'key_points' ? { items: content.blockText.split('\n').filter(Boolean) } : content.blockType === 'code' ? { language: 'text', code: content.blockText } : { text: content.blockText }
    await api(`/admin/lessons/${lesson.id}/blocks`, { method: 'POST', body: JSON.stringify({ blockType: content.blockType, sortOrder: 0, content: value }) })
    detail.value = await api<AdminCourseDetailDto>(`/admin/courses/${list.selected.value.databaseId}`)
    Object.assign(content, { chapterTitle: '', lessonTitle: '', blockText: '' })
    Object.assign(newImage, { assetId: null, alt: '', caption: '' })
    ElMessage.success('章节、课时与内容块已写入当前草稿')
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : '内容添加失败'
    ElMessage.error(message + (createdChapter ? '。新建章节已保留，可在课程结构中继续编辑。' : ''))
    if (createdChapter) await refreshDetail().catch(() => undefined)
  } finally { contentSaving.value = false }
}
const refreshDetail = async () => {
  if (list.selected.value) detail.value = await api<AdminCourseDetailDto>(`/admin/courses/${list.selected.value.databaseId}`)
}
const saveImage = async () => {
  if (!canWrite.value || imageSaving.value || !editingImage.assetId || !editingImage.alt.trim()) return
  imageSaving.value = true; imageError.value = ''
  try {
    const { lessonId, blockId, ...value } = editingImage
    const blocks = detail.value?.chapters.flatMap((chapter) => chapter.lessons).find((lesson) => lesson.id === lessonId)?.blocks || []
    const path = blockId ? `/admin/lesson-blocks/${blockId}` : `/admin/lessons/${lessonId}/blocks`
    await api(path, { method: blockId ? 'PATCH' : 'POST', body: JSON.stringify({ blockType: 'image', content: value, ...(!blockId ? { sortOrder: Math.max(-1, ...blocks.map((block) => block.sortOrder)) + 1 } : {}) }) })
    await refreshDetail(); imageDialog.value = false; ElMessage.success('课程图片已保存到草稿')
  } catch (cause) { imageError.value = cause instanceof Error ? cause.message : '图片保存失败，请重试' }
  finally { imageSaving.value = false }
}
const reorder = async (path: string, items: Array<{ id: string }>, index: number, offset: number) => {
  const next = index + offset
  if (next < 0 || next >= items.length) return
  const ordered = [...items]
  ;[ordered[index], ordered[next]] = [ordered[next], ordered[index]]
  await api(path, { method: 'PUT', body: JSON.stringify({ items: ordered.map((item, sortOrder) => ({ id: item.id, sortOrder })) }) })
  await refreshDetail()
}
const updateChapter = async (chapter: { id: string; title: string; description: string }) => {
  await api(`/admin/course-chapters/${chapter.id}`, { method: 'PATCH', body: JSON.stringify({ title: chapter.title, description: chapter.description }) })
  await refreshDetail()
  ElMessage.success('章节已更新')
}
const removeChapter = async (id: string) => {
  await api(`/admin/course-chapters/${id}`, { method: 'DELETE' })
  await refreshDetail()
}
const updateLesson = async (lesson: { id: string; title: string; summary: string; lessonType: string; durationMinutes: number }) => {
  await api(`/admin/course-lessons/${lesson.id}`, { method: 'PATCH', body: JSON.stringify({ title: lesson.title, summary: lesson.summary, lessonType: lesson.lessonType, durationMinutes: lesson.durationMinutes }) })
  await refreshDetail()
  ElMessage.success('课时已更新')
}
const removeLesson = async (id: string) => {
  await api(`/admin/course-lessons/${id}`, { method: 'DELETE' })
  await refreshDetail()
}
const removeBlock = async (id: string) => {
  await api(`/admin/lesson-blocks/${id}`, { method: 'DELETE' })
  await refreshDetail()
}
const saveRelations = async () => {
  if (!list.selected.value) return
  detail.value = await api(`/admin/courses/${list.selected.value.databaseId}/relations`, {
    method: 'PUT',
    body: JSON.stringify({ resourceIds: relationIds.resources, labIds: relationIds.labs }),
  })
  ElMessage.success('课程关联内容已保存')
}
const publish = async () => { if (list.selected.value) { await publishing.publish(list.selected.value); await list.load(); ElMessage.success('课程版本已发布') } }
const archive = async () => { if (list.selected.value) { await publishing.archive(list.selected.value); await list.load(); ElMessage.success('课程已下架') } }
</script>

<template>
  <DomainPageShell content-type="course" :category-key="fields.category" :data-origin="dataOrigin" @update:data-origin="list.dataOrigin.value = $event" @remove="drafts.removeDraft(selected, () => list.load())" v-model:dialog="dialog" title="课程内容管理" description="维护课程信息、章节、课时与结构化内容块" noun="课程" icon="course" :result="result" :selected="selected" :keyword="keyword" :status="status" :loading="loading" :error="error" :can-write="canWrite" :can-publish="canPublish" @update:keyword="list.keyword.value = $event" @update:status="list.status.value = $event" @select="list.select" @page="list.load" @retry="list.load()" @create="create" @save="save" @publish="publish" @archive="archive">
    <template #kpis><div class="kpi-grid"><AdminKpiCard icon="course" label="课程总数" :value="result.total" color="#ff4d1f" /><AdminKpiCard icon="check" label="已发布" :value="result.items.filter((item) => item.status === 'published').length" color="#22b66c" /><AdminKpiCard icon="theme" label="当前章节" :value="detail?.chapters.length || 0" color="#7c4dff" /><AdminKpiCard icon="clock" label="当前课时" :value="detail?.chapters.reduce((sum, item) => sum + item.lessons.length, 0) || 0" color="#3478f6" /></div></template>
    <template #detail><p>草稿章节 {{ detail?.chapters.length || 0 }} 个，发布操作会固化当前版本快照。</p></template>
    <template #editor>
      <fieldset class="domain-permission-scope" :disabled="!canWrite">
      <section class="domain-section"><h3>课程基础信息</h3><label>主题与分类<input v-model="fields.category" /></label><label>难度<select v-model="fields.level"><option value="">尚未配置</option><option>入门</option><option>初级</option><option>中级</option><option>高级</option></select></label><label>学习方式<select v-model="fields.mode"><option value="">尚未配置</option><option>视频</option><option>图文</option><option>实战项目</option><option>互动实验</option></select></label><label>预计时长（小时）<input v-model.number="fields.hours" type="number" min="0" step=".5" /></label><label>讲师姓名<input v-model="fields.instructorName" /></label><label>讲师说明<input v-model="fields.instructorTitle" /></label><label>证书名称<input v-model="fields.certificate" /></label></section>
      <section class="domain-section"><h3>新增结构化课程内容</h3><label>章节标题<input v-model="content.chapterTitle" /></label><label>课时标题<input v-model="content.lessonTitle" /></label><label>内容块类型<select v-model="content.blockType"><option v-for="type in ['heading','paragraph','image','video','code','diagram','key_points','quiz','resource','lab','note_entry','next_lesson']" :key="type">{{ type }}</option></select></label><template v-if="content.blockType === 'image'"><MediaAssetPicker v-model="newImage.assetId" content-type="course" kind="illustration" :category-key="fields.category" :disabled="!canWrite" @select="imageSelected($event)" /><label>图片说明（alt）<input v-model="newImage.alt" maxlength="240" required /></label><label>图注<textarea v-model="newImage.caption" maxlength="600" rows="2" /></label></template><label v-else>内容<textarea v-model="content.blockText" rows="4" /></label><button class="admin-secondary" type="button" :disabled="!canWrite || contentSaving" @click="addContent">加入当前草稿</button><ul><li v-for="chapter in detail?.chapters || []" :key="chapter.id">{{ chapter.title }}：{{ chapter.lessons.length }} 课时</li></ul></section>
      <section class="domain-section"><h3>课程结构编辑 <button class="text-link" type="button" @click="previewOpen = true">预览草稿</button></h3><div v-for="(chapter, chapterIndex) in detail?.chapters || []" :key="chapter.id" class="stage-editor"><label>章节标题<input v-model="chapter.title" /></label><label>章节说明<input v-model="chapter.description" /></label><div><button class="text-link" type="button" :disabled="chapterIndex === 0" @click="reorder(`/admin/courses/${selected?.databaseId}/chapters/reorder`, detail?.chapters || [], chapterIndex, -1)">上移</button><button class="text-link" type="button" :disabled="chapterIndex === (detail?.chapters.length || 0) - 1" @click="reorder(`/admin/courses/${selected?.databaseId}/chapters/reorder`, detail?.chapters || [], chapterIndex, 1)">下移</button><button class="text-link" type="button" @click="updateChapter(chapter)">保存章节</button><button class="admin-danger" type="button" @click="removeChapter(chapter.id)">删除章节</button></div><article v-for="(lesson, lessonIndex) in chapter.lessons" :key="lesson.id"><label>课时标题<input v-model="lesson.title" /></label><label>课时摘要<input v-model="lesson.summary" /></label><label>类型<input v-model="lesson.lessonType" /></label><label>分钟<input v-model.number="lesson.durationMinutes" type="number" min="1" /></label><button class="text-link" type="button" @click="updateLesson(lesson)">保存课时</button><button class="text-link" type="button" :disabled="lessonIndex === 0" @click="reorder(`/admin/chapters/${chapter.id}/lessons/reorder`, chapter.lessons, lessonIndex, -1)">上移</button><button class="text-link" type="button" :disabled="lessonIndex === chapter.lessons.length - 1" @click="reorder(`/admin/chapters/${chapter.id}/lessons/reorder`, chapter.lessons, lessonIndex, 1)">下移</button><button class="admin-danger" type="button" @click="removeLesson(lesson.id)">删除课时</button><button class="text-link" type="button" @click="openImage(lesson.id)">添加图片</button><ol class="course-block-list"><li v-for="(block, blockIndex) in lesson.blocks" :key="block.id"><template v-if="block.blockType === 'image'"><MediaAssetPreview :asset-id="String(block.content.assetId || '')" :file-id="typeof block.content.fileId === 'string' ? block.content.fileId : undefined" :alt="String(block.content.alt || '')" :aspect-ratio="String(block.content.aspectRatio || '4:3')" /><p>{{ block.content.caption }}</p><button class="text-link" type="button" @click="openImage(lesson.id, block)">编辑图片</button></template><span v-else>{{ block.blockType }} · {{ String(block.content.text || block.content.code || '结构化内容') }}</span><div><button class="text-link" type="button" :disabled="blockIndex === 0" @click="reorder(`/admin/lessons/${lesson.id}/blocks/reorder`, lesson.blocks, blockIndex, -1)">上移内容块</button><button class="text-link" type="button" :disabled="blockIndex === lesson.blocks.length - 1" @click="reorder(`/admin/lessons/${lesson.id}/blocks/reorder`, lesson.blocks, blockIndex, 1)">下移内容块</button><button class="text-link" type="button" @click="removeBlock(block.id)">删除内容块</button></div></li></ol></article></div></section>
      <section class="domain-section"><h3>关联资源与实训</h3><label>关联资源<select v-model="relationIds.resources" multiple><option v-for="item in resourceOptions" :key="item.databaseId" :value="item.databaseId">{{ item.title }}</option></select></label><label>关联实训<select v-model="relationIds.labs" multiple><option v-for="item in labOptions" :key="item.databaseId" :value="item.databaseId">{{ item.title }}</option></select></label><button class="admin-secondary" type="button" @click="saveRelations">保存关联</button></section>
      </fieldset>
    </template>
  </DomainPageShell>
  <AdminDialog v-model="previewOpen" title="课程草稿预览"><article v-for="chapter in detail?.chapters || []" :key="chapter.id"><h3>{{ chapter.title }}</h3><p>{{ chapter.description }}</p><section v-for="lesson in chapter.lessons" :key="lesson.id"><h4>{{ lesson.title }} · {{ lesson.durationMinutes }} 分钟</h4><p>{{ lesson.summary }}</p><div v-for="block in lesson.blocks" :key="block.id"><figure v-if="block.blockType === 'image'"><MediaAssetPreview :asset-id="String(block.content.assetId || '')" :file-id="typeof block.content.fileId === 'string' ? block.content.fileId : undefined" :alt="String(block.content.alt || '')" :aspect-ratio="String(block.content.aspectRatio || '4:3')" /><figcaption>{{ block.content.caption }}</figcaption></figure><p v-else>{{ block.blockType }}：{{ block.content.text || block.content.code || JSON.stringify(block.content) }}</p></div></section></article><p v-if="!detail?.chapters.length">当前草稿尚无课程结构。</p></AdminDialog>
  <AdminDialog v-model="imageDialog" :title="editingImage.blockId ? '编辑课程图片' : '添加课程图片'">
    <form class="admin-form" @submit.prevent="saveImage">
      <MediaAssetPicker v-model="editingImage.assetId" :file-id="editingImage.fileId" :aspect-ratio="editingImage.width && editingImage.height ? `${editingImage.width} / ${editingImage.height}` : undefined" content-type="course" kind="illustration" :category-key="fields.category" :disabled="imageSaving || !canWrite" @select="imageSelected($event, true)" />
      <label>图片说明（alt）<input v-model="editingImage.alt" required maxlength="240" :disabled="imageSaving" /></label>
      <label>图注<textarea v-model="editingImage.caption" maxlength="600" rows="3" :disabled="imageSaving" /></label>
      <p class="settings-note">图片随课程版本发布；修改草稿不会改变已发布的旧版本。</p>
      <p v-if="imageError" class="error-banner" role="alert">{{ imageError }}</p>
      <button class="admin-primary" :disabled="imageSaving || !canWrite || !editingImage.assetId">{{ imageSaving ? '正在保存…' : '保存图片到草稿' }}</button>
    </form>
  </AdminDialog>
</template>

<style scoped>
.course-block-list { padding-left: 20px; }
.course-block-list > li { margin-block: 14px; }
.course-block-list .media-preview { max-width: 360px; }
.course-block-list button { margin-right: 10px; }
</style>
