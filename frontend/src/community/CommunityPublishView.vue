<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import CommunityQuickComposer from './CommunityQuickComposer.vue'
import { useCommunityStore } from '../stores/community'
import { useCommunityDraft } from './composables/useCommunityDraft'

const route = useRoute(), router = useRouter(), store = useCommunityStore(), editor = useCommunityDraft()
const topicsLoading = ref(false), mounted = ref(false)
const toggleTopic = (id: string) => {
  const ids = editor.form.topicIds
  editor.form.topicIds = ids.includes(id) ? ids.filter((value) => value !== id) : ids.length < 3 ? [...ids, id] : ids
}
const publish = () => { void editor.save() }
watch(() => store.composerOpen, (open) => { if (!open && mounted.value && route.path === '/community/publish') router.push('/resources') })
onMounted(async () => {
  store.openComposer({ type: 'frontier_discussion', title: '', contentBlocks: [], bindings: [], topicIds: [], visibility: 'public', status: 'published' })
  store.composerInline = true
  mounted.value = true
  topicsLoading.value = true
  try { await editor.loadTopics() } catch { /* 话题读取失败时面板展示空态。 */ }
  topicsLoading.value = false
})
onBeforeUnmount(() => { store.composerOpen = false })
</script>
<template>
  <section class="community-publish-page">
    <header class="community-page-heading"><div><h1>发布图文</h1><p>标题 + 富文本正文，支持 Markdown 导入，发布后同步到学习社区</p></div></header>
    <div class="community-publish-layout">
      <div class="community-publish-editor"><CommunityQuickComposer /></div>
      <aside class="community-publish-meta">
        <section><h2>话题 <small>选填 · 最多 3 个</small></h2><p v-if="topicsLoading" class="muted">正在读取话题…</p><div v-else class="community-publish-topics"><button v-for="topic in editor.topics" :key="topic.id" type="button" :class="{ active: editor.form.topicIds.includes(topic.id) }" @click="toggleTopic(topic.id)"># {{ topic.name }}</button></div><p v-if="!topicsLoading && !editor.topics.length" class="muted">暂无可用话题</p></section>
        <section><h2>可见范围</h2><label><input v-model="editor.form.visibility" type="radio" value="public" /><span><strong>公开</strong><small>平台内所有人可见</small></span></label><label><input v-model="editor.form.visibility" type="radio" value="school" /><span><strong>同校</strong><small>仅本校师生可见</small></span></label></section>
        <section><h2>编辑提示</h2><ul><li>工具栏支持标题、加粗、列表、引用、表格与代码</li><li>拖放 / 粘贴图片或 .md 文件直接导入</li><li>中途关闭会自动保存到草稿箱</li></ul></section>
      </aside>
    </div>
    <footer class="community-publish-actions"><button class="text-link" type="button" @click="router.push('/resources')">取消</button><button class="button primary" type="button" :disabled="editor.saving" @click="publish">{{ editor.saving ? '发布中…' : '发布图文' }}</button></footer>
  </section>
</template>
