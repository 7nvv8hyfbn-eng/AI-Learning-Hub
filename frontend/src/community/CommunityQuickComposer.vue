<script setup lang="ts">
import { computed, nextTick, onMounted, onBeforeUnmount, ref, watch } from 'vue'
import { storeToRefs } from 'pinia'
import { useCommunityStore } from '../stores/community'
import { useAuthStore } from '../stores/auth'
import CommunityComposerTools from './CommunityComposerTools.vue'
import CommunityDraftConflict from './CommunityDraftConflict.vue'
import CommunityPostMenu from './CommunityPostMenu.vue'
import AppIcon from '../components/base/AppIcon.vue'
import CommunityAvatar from '../components/base/CommunityAvatar.vue'
import { communityArt } from '../assets/community/manifest'
import { useCommunityDraft } from './composables/useCommunityDraft'
import { useCommunityScrollRoot } from './composables/useCommunityScrollRoot'
import { postLabels } from './labels'
import type { CommunityPostType } from '@ai-learning-hub/contracts'
const props = defineProps<{ dialog?: boolean }>()
const store = useCommunityStore(), auth = useAuthStore(), editor = useCommunityDraft(), panel = ref<HTMLElement>()
const scrollRoot = useCommunityScrollRoot(), textarea = ref<HTMLTextAreaElement>()
const { form, body, images, saving, error, savedAt } = storeToRefs(editor)
const active = computed(() => store.composerOpen && store.composerMode === 'quick' && (props.dialog || store.composerInline))
const tool = ref<'images' | 'binding' | 'topics' | null>(null)
const types: Array<[CommunityPostType, string, string]> = [['question', '提出问题', 'question'], ['note', '发布笔记', 'note-edit'], ['lab_result', '分享实训', 'lab-share'], ['project', '展示项目', 'project-folder']]
const open = (type: CommunityPostType = 'general') => { if (active.value) form.value.type = type; else store.openComposer({ type }) }
const resize = () => { const node = textarea.value; if (!node) return; node.style.height = '84px'; node.style.height = `${Math.min(240, Math.max(84, node.scrollHeight))}px` }
const focus = () => {
  if (!active.value) return
  const rect = panel.value?.getBoundingClientRect(), viewport = scrollRoot.value?.getBoundingClientRect()
  if (rect && viewport && (rect.bottom <= viewport.top || rect.top >= viewport.bottom)) scrollRoot.value?.scrollTo({ top: scrollRoot.value.scrollTop + rect.top - viewport.top - 120, behavior: 'smooth' })
  panel.value?.querySelector('textarea')?.focus({ preventScroll: true })
  resize()
}
watch(active, async (open) => { tool.value = null; if (open) { await nextTick(); focus() } })
watch(body, async () => { await nextTick(); resize() })
const keydown = (event: KeyboardEvent) => {
  if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') { event.preventDefault(); void editor.save() }
  if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); if (tool.value) tool.value = null; else editor.close() }
}
const paste = (event: ClipboardEvent) => { const files = Array.from(event.clipboardData?.files || []); if (files.length) { event.preventDefault(); tool.value = 'images'; void editor.uploadFiles(files) } }
const drop = (event: DragEvent) => { event.preventDefault(); tool.value = 'images'; void editor.uploadFiles(Array.from(event.dataTransfer?.files || [])) }
const advanced = () => { store.composerMode = 'advanced'; store.composerInline = false }
onMounted(() => { window.addEventListener('community-composer-focus', focus); if (active.value) focus() })
onBeforeUnmount(() => window.removeEventListener('community-composer-focus', focus))
</script>
<template>
  <section :id="dialog ? undefined : 'community-quick-composer'" ref="panel" class="community-quick-composer" :class="{ 'quick-dialog': dialog, 'quick-active': active }">
    <template v-if="!active">
      <img v-bind="communityArt.composer" class="composer-decoration" alt="" fetchpriority="high" />
      <button class="quick-prompt" @click="open()"><CommunityAvatar :src="auth.user?.avatarUrl" :username="auth.user?.username" :name="auth.user?.displayName || '学习者'" /><span>分享你今天学到的 AI 知识……</span></button>
      <div class="quick-types"><button v-for="[type, label, icon] in types" :key="type" :class="`quick-type-${type}`" @click="open(type)"><AppIcon :name="icon" :size="21" />{{ label }}</button><CommunityPostMenu label="更多发布类型"><template #trigger><AppIcon name="more-circle" :size="21" />更多</template><button type="button" role="menuitem" @click="open('general')">普通交流</button><button type="button" role="menuitem" @click="open('frontier_discussion')">前沿讨论</button></CommunityPostMenu></div>
    </template>
    <form v-else class="quick-editor" @submit.prevent="editor.save()" @keydown="keydown" @paste="paste" @dragover.prevent @drop="drop">
      <CommunityDraftConflict />
      <header class="quick-editor-heading">
        <CommunityAvatar :src="auth.user?.avatarUrl" :username="auth.user?.username" :name="auth.user?.displayName || '学习者'" size="sm" />
        <span class="quick-type-select"><select v-model="form.type" aria-label="发布内容类型"><option v-for="(label, type) in postLabels" :key="type" :value="type">{{ label }}</option></select><AppIcon name="arrow-right" :size="15" /></span>
        <button class="icon-button" type="button" aria-label="收起快捷发布" @click="editor.close()"><AppIcon name="close" :size="18" /></button>
      </header>
      <label v-if="['question', 'project'].includes(form.type)">标题（必填）<input v-model="form.title" required maxlength="160" placeholder="用一句话说明问题或项目" /></label>
      <textarea ref="textarea" v-model="body" aria-label="正文" maxlength="15000" autofocus required placeholder="分享你今天学到的 AI 知识……" />
      <CommunityComposerTools v-if="tool" :panel="tool" />
      <p v-if="error" class="community-error" role="alert">{{ error }}</p>
      <footer class="quick-editor-actions"><button type="button" class="text-link" :aria-expanded="tool === 'images'" @click="tool = tool === 'images' ? null : 'images'"><AppIcon name="image" :size="18" />图片{{ images.length ? ` ${images.length}` : '' }}</button><button type="button" class="text-link" :aria-expanded="tool === 'binding'" @click="tool = tool === 'binding' ? null : 'binding'">关联{{ form.bindings.length ? ` ${form.bindings.length}` : '' }}</button><button type="button" class="text-link" :aria-expanded="tool === 'topics'" @click="tool = tool === 'topics' ? null : 'topics'">话题{{ form.topicIds.length ? ` ${form.topicIds.length}` : '' }}</button><button type="button" class="text-link" @click="advanced">高级编辑</button><button class="button primary small" type="submit" :disabled="saving">{{ saving ? '保存中…' : '发布' }}</button></footer>
      <div class="quick-save-state"><small role="status">{{ savedAt || 'Ctrl / ⌘ + Enter 发布' }}</small><RouterLink to="/community/drafts">草稿箱</RouterLink></div>
    </form>
  </section>
</template>
