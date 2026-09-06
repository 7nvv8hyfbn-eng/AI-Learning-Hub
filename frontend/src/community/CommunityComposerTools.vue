<script setup lang="ts">
import { watch } from 'vue'
import AppIcon from '../components/base/AppIcon.vue'
import { storeToRefs } from 'pinia'
import { useCommunityDraft } from './composables/useCommunityDraft'
const props = defineProps<{ panel: 'images' | 'binding' | 'topics' }>()
const editor = useCommunityDraft()
const { images, saving, form, topics, topicsLoading, advanced, bindingType, source, bindingSearch, bindingLoading, bindingId, bindingOptions, bindingTitles } = storeToRefs(editor)
watch(() => props.panel, (panel) => { if (panel === 'topics') void editor.loadTopics(); if (panel === 'binding') void editor.loadOptions() }, { immediate: true })
</script>
<template>
  <div class="composer-tool-panel">
    <template v-if="panel === 'images'">
      <label>学习图片（最多 4 张，每张 5MB）<input type="file" multiple accept="image/png,image/jpeg,image/webp" :disabled="saving" @change="editor.upload" /></label>
      <div v-for="(image, index) in images" :key="image.fileId" class="composer-row"><input v-model="image.alt" aria-label="图片说明" maxlength="200" /><button class="text-link" type="button" @click="images.splice(index, 1)">移除</button></div>
    </template>
    <template v-else-if="panel === 'binding'">
      <p class="muted">查找已发布学习内容，最多关联 {{ advanced ? 8 : 1 }} 项。</p>
      <div class="composer-row"><select v-model="bindingType" aria-label="关联类型" @change="editor.loadOptions"><option v-for="(label, type) in { theme: '学习主题', course: '课程', lesson: '课时', lab: '实训', resource: '资源', article: '文章', challenge: '挑战', lab_run: '已提交实训记录' }" :key="type" :value="type">{{ label }}</option></select><template v-if="source"><input v-model="bindingSearch" placeholder="按标题查找" aria-label="查找关联学习内容" @keydown.enter.prevent="editor.loadOptions" /><button class="button secondary small" type="button" :disabled="bindingLoading" @click="editor.loadOptions">查找</button></template></div>
      <div class="composer-row"><select v-if="source" v-model="bindingId" aria-label="关联学习内容" :disabled="bindingLoading"><option value="">{{ bindingLoading ? '读取中…' : '请选择学习内容' }}</option><option v-for="item in bindingOptions" :key="item.id" :value="item.id">{{ item.title }}</option></select><input v-else v-model="bindingId" placeholder="从本人学习记录取得的标识" aria-label="关联内容标识" /><button class="button secondary small" type="button" :disabled="!bindingId" @click="editor.addBinding">关联</button></div>
      <div class="community-topic-list"><button v-for="(binding, index) in form.bindings" :key="`${binding.type}:${binding.id}`" type="button" class="community-chip" @click="form.bindings.splice(index, 1)">{{ bindingTitles[`${binding.type}:${binding.id}`] || binding.id }} <AppIcon name="close" :size="13" /></button></div>
    </template>
    <template v-else>
      <p>学习话题（最多 {{ advanced ? 5 : 3 }} 项）</p><p v-if="topicsLoading" role="status">正在读取话题…</p>
      <div class="composer-topics"><label v-for="topic in topics" :key="topic.id"><input v-model="form.topicIds" type="checkbox" :value="topic.id" :disabled="form.topicIds.length >= (advanced ? 5 : 3) && !form.topicIds.includes(topic.id)" />{{ topic.name }}</label></div>
      <button v-if="!topics.length && !topicsLoading" class="text-link" type="button" @click="editor.loadTopics">重新读取话题</button>
    </template>
  </div>
</template>
