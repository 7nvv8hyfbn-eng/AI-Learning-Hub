<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type { CommunityDraftDto } from '@ai-learning-hub/contracts'
import { communityApi } from '../services/api/community'
import { useCommunityDraft } from './composables/useCommunityDraft'
import { useCommunityStore } from '../stores/community'
import { postLabels } from './labels'
import CommunitySkeleton from './CommunitySkeleton.vue'
import { useAuthStore } from '../stores/auth'
const drafts = ref<CommunityDraftDto[]>([]), loading = ref(true), error = ref(''), editor = useCommunityDraft(), store = useCommunityStore(), auth = useAuthStore()
const copies = ref<ReturnType<typeof editor.localCopies>>([])
let request = 0
const load = async () => {
  const id = ++request, epoch = store.epoch, owner = auth.user?.id
  const current = () => request === id && epoch === store.epoch && owner === auth.user?.id
  copies.value = editor.localCopies(); loading.value = true; error.value = ''
  try { const rows = await communityApi.drafts(); if (current()) drafts.value = rows }
  catch (cause) { if (current()) error.value = cause instanceof Error ? cause.message : '草稿读取失败' }
  finally { if (current()) loading.value = false }
}
const restore = (row: CommunityDraftDto) => editor.restore(row)
const remove = async (id: string) => { if (!confirm('删除这条草稿？')) return; try { await communityApi.deleteDraft(id); await load() } catch (cause) { error.value = cause instanceof Error ? cause.message : '删除失败' } }
const summary = (row: Pick<CommunityDraftDto, 'input'>) => row.input.title || row.input.contentBlocks.map((b) => b.type === 'image' ? b.alt : b.type === 'list' ? b.items.join(' ') : b.type === 'code' ? b.code : b.type === 'rich_text' ? new DOMParser().parseFromString(b.text, 'text/html').body.textContent : b.text).join(' ').slice(0, 100) || '尚未填写正文'
onMounted(load)
watch(() => useCommunityStore().composerOpen, (open) => { if (!open) void load() })
watch(() => store.epoch, () => { request++; drafts.value = []; copies.value = [] })
onBeforeUnmount(() => { request++ })
</script>
<template><section><header class="community-page-heading"><div><h1>草稿箱</h1><p>保存想法，准备好后再分享。</p></div><button class="button secondary" @click="load">刷新草稿</button></header><section v-if="copies.length" aria-label="本地恢复副本"><h2>本地恢复副本</h2><p>仅保存在当前浏览器，公开帖子的修改不会自动覆盖服务器版本。</p><article v-for="row in copies" :key="row.key" class="community-post-card"><h3>{{ summary(row) }}</h3><button class="button secondary small" @click="editor.restoreLocal(row.key)">恢复此副本</button></article></section><CommunitySkeleton v-if="loading" /><p v-else-if="error" class="community-error" role="alert">{{ error }} <button @click="load">重试</button></p><article v-for="row in drafts" v-else :key="row.id" class="community-post-card"><small>{{ postLabels[row.input.type] }} · {{ new Date(row.updatedAt).toLocaleString('zh-CN') }}</small><h2>{{ summary(row) }}</h2><p>{{ row.input.bindings.length }} 个学习关联</p><div class="composer-actions"><button class="button primary small" @click="restore(row)">继续编辑</button><button class="button secondary small" @click="remove(row.id)">删除草稿</button></div></article><div v-if="!loading && !error && !drafts.length && !copies.length" class="community-empty"><h2>还没有草稿</h2><p>开始记录一个学习发现，编辑内容会自动保存。</p><RouterLink class="button primary" to="/community">去社区发布</RouterLink></div></section></template>
