<script setup lang="ts">
import { storeToRefs } from 'pinia'
import { ref } from 'vue'
import type { CommunityPostType } from '@ai-learning-hub/contracts'
import { useCommunityStore } from '../stores/community'
import { useAuthStore } from '../stores/auth'
import { useCommunityDraft } from './composables/useCommunityDraft'
import CommunityBlocks from './CommunityBlocks.vue'
import CommunityComposerTools from './CommunityComposerTools.vue'
import CommunityDraftConflict from './CommunityDraftConflict.vue'
import { postLabels } from './labels'
import ResourceContributionFields from './ResourceContributionFields.vue'
import { useCommunityAccess } from './composables/useCommunityAccess'
const editor = useCommunityDraft(), store = useCommunityStore(), auth = useAuthStore()
const paste = (event: ClipboardEvent) => { const files = Array.from(event.clipboardData?.files || []); if (files.length) { event.preventDefault(); void editor.uploadFiles(files) } }
const drop = (event: DragEvent) => { event.preventDefault(); void editor.uploadFiles(Array.from(event.dataTransfer?.files || [])) }
const keydown = (event: KeyboardEvent) => { if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') { event.preventDefault(); void editor.save() }; if (event.key === 'Escape') { event.stopPropagation(); editor.close() } }
const { form, body, code, language, quote, preview, saving, error, blocks, advanced, savedAt } = storeToRefs(editor)
const { save } = editor
const { canPost, availability, message, nextAction } = useCommunityAccess()
const tools = ref({ binding: false, topics: false })
</script>
<template>
  <form class="dialog-form composer-form" @submit.prevent="save()" @keydown="keydown" @paste="paste" @dragover.prevent @drop="drop">
    <CommunityDraftConflict />
    <header class="composer-mobile-top"><button type="button" class="text-link" @click="editor.close()">取消</button><select v-model="form.type" aria-label="发布内容类型"><option v-for="(label, type) in postLabels" :key="type" :value="type">{{ label }}</option></select><button class="button primary small" type="submit" :disabled="saving || !canPost">{{ saving ? '保存中…' : '发布' }}</button></header>
    <div class="composer-row"><label>内容类型<select v-model="form.type"><option v-for="(label, type) in postLabels" :key="type" :value="type as CommunityPostType">{{ label }}</option></select></label><details><summary>可见范围：{{ form.visibility === 'school' ? '仅同校用户' : '登录社区用户' }}</summary><label>可见范围<select v-model="form.visibility"><option value="public">登录社区用户</option><option value="school">仅同校用户</option></select></label></details></div>
    <ResourceContributionFields v-if="form.contribution" />
    <label v-if="advanced || ['question', 'project'].includes(form.type)">标题{{ ['question', 'project'].includes(form.type) ? '（必填）' : '（选填）' }}<input v-model="form.title" maxlength="160" :required="['question', 'project'].includes(form.type)" placeholder="让同学更容易理解你的问题或收获" /></label>
    <template v-if="!preview"><label>正文<textarea v-model="body" rows="6" maxlength="15000" required placeholder="说明学习背景、尝试过的方法，以及你的发现……" /></label><details v-if="advanced"><summary>添加代码或引用</summary><label>代码语言<input v-model="language" maxlength="30" /></label><label>代码块（仅展示，不执行）<textarea v-model="code" rows="4" maxlength="12000" /></label><label>引用<textarea v-model="quote" rows="2" maxlength="2000" /></label></details><CommunityComposerTools panel="images" /></template>
    <CommunityBlocks v-else :blocks="blocks" />
    <details @toggle="tools.binding = ($event.target as HTMLDetailsElement).open"><summary>添加学习关联（{{ advanced ? 8 : 1 }} 项）</summary><CommunityComposerTools v-if="tools.binding" panel="binding" /></details>
    <details @toggle="tools.topics = ($event.target as HTMLDetailsElement).open"><summary>设置话题</summary><CommunityComposerTools v-if="tools.topics" panel="topics" /></details>
    <p v-if="auth.dataMode === 'mock'" class="community-notice">演示图片仅保存在当前浏览器会话，不代表真实上传。</p><p v-if="!canPost" class="community-notice">{{ message }}草稿仍可保存。<span v-if="availability()">{{ availability() }}</span><RouterLink v-if="nextAction" class="text-link" :to="nextAction.route">{{ nextAction.label }}</RouterLink></p><p class="composer-privacy">仅发布你确认分享的内容；请勿包含私密笔记、完整成绩、实训日志或密钥。成就草稿不会自动公开。</p><p v-if="error" role="alert" class="community-error">{{ error }}</p>
    <p v-if="savedAt" role="status" class="muted">{{ savedAt }}</p><div class="composer-actions"><button v-if="!advanced" class="text-link" type="button" @click="store.composerMode = 'advanced'; store.composerInline = false">高级编辑</button><RouterLink to="/community/drafts">草稿箱</RouterLink><button v-if="advanced" class="button secondary" type="button" @click="preview = !preview">{{ preview ? '继续编辑' : '发布预览' }}</button><button class="button secondary" type="button" :disabled="saving" @click="save(true)">保存草稿</button><button class="button primary" type="submit" :disabled="saving || !canPost">{{ saving ? '正在保存…' : '确认发布' }}</button></div>
  </form>
</template>
