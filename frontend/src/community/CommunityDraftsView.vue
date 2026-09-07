<script setup lang="ts">
import { onMounted, ref } from 'vue'
import type { CommunityDraftDto } from '@ai-learning-hub/contracts'
import { communityHtmlToText } from '@ai-learning-hub/contracts'
import { communityApi } from '../services/api/community'
import { useCommunityDraft } from './composables/useCommunityDraft'
import { postLabels } from './labels'
import CommunitySkeleton from './CommunitySkeleton.vue'
const drafts = ref<CommunityDraftDto[]>([]), loading = ref(true), error = ref(''), editor = useCommunityDraft()
const load = async () => { loading.value = true; error.value = ''; try { drafts.value = await communityApi.drafts() } catch (cause) { error.value = cause instanceof Error ? cause.message : '草稿读取失败' } finally { loading.value = false } }
const remove = async (id: string) => { if (!confirm('删除这条草稿？')) return; try { await communityApi.deleteDraft(id); await load() } catch (cause) { error.value = cause instanceof Error ? cause.message : '删除失败' } }
const summary = (row: CommunityDraftDto) => row.input.title || row.input.contentBlocks.map((b) => b.type === 'paragraph' ? b.text : b.type === 'code' ? b.code : b.type === 'quote' ? b.text : b.type === 'html' ? communityHtmlToText(b.html) : b.alt).join(' ').slice(0, 100) || '尚未填写正文'
onMounted(load)
</script>
<template><section><header class="community-page-heading"><div><h1>草稿箱</h1><p>保存想法，准备好后再分享。</p></div><button class="button secondary" @click="load">刷新草稿</button></header><CommunitySkeleton v-if="loading" /><p v-else-if="error" class="community-error" role="alert">{{ error }} <button @click="load">重试</button></p><article v-for="row in drafts" v-else :key="row.id" class="community-post-card"><small>{{ postLabels[row.input.type] }} · {{ new Date(row.updatedAt).toLocaleString('zh-CN') }}</small><h2>{{ summary(row) }}</h2><p>{{ row.input.bindings.length }} 个学习关联</p><div class="composer-actions"><button class="button primary small" @click="editor.restore(row)">继续编辑</button><button class="button secondary small" @click="remove(row.id)">删除草稿</button></div></article><div v-if="!loading && !error && !drafts.length" class="community-empty"><h2>还没有草稿</h2><p>开始记录一个学习发现，编辑内容会自动保存。</p><RouterLink class="button primary" to="/community">去社区发布</RouterLink></div></section></template>
