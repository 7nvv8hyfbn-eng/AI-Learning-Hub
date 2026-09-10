<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import CommunityImageGallery from './CommunityImageGallery.vue'
import AppIcon from '../components/base/AppIcon.vue'
import { storeToRefs } from 'pinia'
import { useCommunityDraft } from './composables/useCommunityDraft'
import { useCommunityAccess } from './composables/useCommunityAccess'
const props = defineProps<{ panel: 'images' | 'binding' | 'topics' }>()
const editor = useCommunityDraft()
const { availability, decision, requireWrite } = useCommunityAccess()
const filePicker = ref<HTMLInputElement>()
const chooseImages = () => { if (requireWrite('upload')) filePicker.value?.click() }
const editImage = (fileId: string) => { if (requireWrite('upload')) editor.editImage(fileId) }
const uploadDecision = computed(() => decision('upload'))
const { images, saving, form, topics, topicsLoading, advanced, bindingType, source, bindingSearch, bindingLoading, bindingId, bindingOptions, bindingTitles } = storeToRefs(editor)
watch(() => props.panel, (panel) => { if (panel === 'topics') void editor.loadTopics(); if (panel === 'binding') void editor.loadOptions() }, { immediate: true })
</script>
<template>
  <div class="composer-tool-panel">
    <template v-if="panel === 'images'">
      <input ref="filePicker" hidden type="file" multiple accept="image/png,image/jpeg,image/webp" @change="editor.upload" />
      <button class="text-link" type="button" :disabled="saving" @click="chooseImages">添加学习图片（最多 4 张，每张 5MB）</button>
      <p v-if="!uploadDecision.allowed" class="community-notice">{{ uploadDecision.message }}<span v-if="availability('upload')">{{ availability('upload') }}</span><RouterLink v-if="uploadDecision.nextAction" class="text-link" :to="uploadDecision.nextAction.route">{{ uploadDecision.nextAction.label }}</RouterLink></p>
      <CommunityImageGallery v-if="images.length" :images="images" editable @edit="editImage" @remove="editor.removeImage" />
      <p v-if="editor.pendingImages" role="status">请先保存或取消待处理图片，再发布。未保存的本地图片无法跨刷新恢复。</p>
      <p v-if="editor.imageNotice" role="status">{{ editor.imageNotice }}</p>
    </template>
    <template v-else-if="panel === 'binding'">
      <p class="muted">查找已发布学习内容，最多关联 {{ advanced ? 8 : 1 }} 项。</p>
      <div class="composer-row"><select v-model="bindingType" aria-label="关联类型" @change="editor.loadOptions"><option v-for="(label, type) in { theme: '通识基础', course: '课程', lesson: '课时', lab: '实训', resource: '资源', article: '文章', challenge: '挑战', lab_run: '已提交实训记录' }" :key="type" :value="type">{{ label }}</option></select><template v-if="source"><input v-model="bindingSearch" placeholder="按标题查找" aria-label="查找关联学习内容" @keydown.enter.prevent="editor.loadOptions" /><button class="button secondary small" type="button" :disabled="bindingLoading" @click="editor.loadOptions">查找</button></template></div>
      <div class="composer-row"><select v-if="source" v-model="bindingId" aria-label="关联学习内容" :disabled="bindingLoading"><option value="">{{ bindingLoading ? '读取中…' : '请选择学习内容' }}</option><option v-for="item in bindingOptions" :key="item.id" :value="item.id">{{ item.title }}</option></select><input v-else v-model="bindingId" placeholder="从本人学习记录取得的标识" aria-label="关联内容标识" /><button class="button secondary small" type="button" :disabled="!bindingId" @click="editor.addBinding">关联</button></div>
      <div class="community-topic-list"><button v-for="(binding, index) in form.bindings" :key="`${binding.type}:${binding.id}`" type="button" class="community-chip" @click="form.bindings.splice(index, 1)">{{ bindingTitles[`${binding.type}:${binding.id}`] || binding.id }} <AppIcon name="close" :size="13" /></button></div>
    </template>
    <template v-else>
      <p>学习话题（最多 {{ advanced ? 5 : 3 }} 项）</p><p v-if="topicsLoading" role="status">正在读取话题…</p>
      <div class="composer-topics"><label v-for="topic in topics" :key="topic.id"><input v-model="form.topicIds" type="checkbox" :value="topic.id" :disabled="form.topicIds.length >= 5 && !form.topicIds.includes(topic.id)" />{{ topic.name }}</label></div>
      <button v-if="!topics.length && !topicsLoading" class="text-link" type="button" @click="editor.loadTopics">重新读取话题</button>
    </template>
  </div>
</template>
