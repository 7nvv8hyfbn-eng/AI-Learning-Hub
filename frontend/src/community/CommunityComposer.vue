<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import { isNavigationFailure, NavigationFailureType, useRouter } from 'vue-router'
import AppDialog from '../components/base/AppDialog.vue'
import AppIcon from '../components/base/AppIcon.vue'
import CommunityAvatar from '../components/base/CommunityAvatar.vue'
import { useCommunityStore } from '../stores/community'
import { useCommunityDraft } from './composables/useCommunityDraft'
import { useCommunityScrollRoot } from './composables/useCommunityScrollRoot'
import CommunityAdvancedComposer from './CommunityAdvancedComposer.vue'
import CommunityQuickComposer from './CommunityQuickComposer.vue'
const store = useCommunityStore(), editor = useCommunityDraft(), router = useRouter()
const scrollRoot = useCommunityScrollRoot()
const pastQuarter = () => !!scrollRoot.value && scrollRoot.value.scrollTop > (scrollRoot.value.scrollHeight - scrollRoot.value.clientHeight) / 4
const showBackToTop = ref(pastQuarter())
const updateBackToTop = () => { showBackToTop.value = pastQuarter() }
const bindScrollRoot = () => { const root = typeof document === 'undefined' ? scrollRoot.value : document.querySelector<HTMLElement>('.community-main'); scrollRoot.value?.removeEventListener('scroll', updateBackToTop); scrollRoot.value = root; root?.addEventListener('scroll', updateBackToTop, { passive: true }); updateBackToTop() }
const backToTop = () => scrollRoot.value?.scrollTo({ top: 0, behavior: 'smooth' })
const leave = (event: BeforeUnloadEvent) => { if (store.composerOpen && editor.dirty) { event.preventDefault(); event.returnValue = '' } }
let continuation: (() => void) | null = null
const removeGuard = router.beforeEach((to) => { if (!store.composerOpen || !editor.dirty) return; continuation = () => { void router.push(to.fullPath) }; editor.close(); return false })
const removeAfter = router.afterEach((to, _from, failure) => { if (store.composerOpen && to.path === '/community/drafts' && (!failure || isNavigationFailure(failure, NavigationFailureType.duplicated))) editor.close(); void nextTick(bindScrollRoot) })
const finish = async (save: boolean) => { if (save) await editor.saveAndClose(); else editor.discard(); if (!editor.closePrompt) { const next = continuation; continuation = null; next?.() } }
const cancel = () => { editor.closePrompt = false; continuation = null }
onMounted(() => { window.addEventListener('beforeunload', leave); bindScrollRoot() })
onBeforeUnmount(() => { removeGuard(); removeAfter(); window.removeEventListener('beforeunload', leave); scrollRoot.value?.removeEventListener('scroll', updateBackToTop) })
</script>
<template>
<div v-if="showBackToTop" class="community-publish-feedback" role="status" aria-live="polite"><button type="button" :aria-label="`${store.publishNotice?.text || '已发布'}，返回社区顶部`" @click="backToTop"><AppIcon name="arrow-right" :size="16" /><span class="community-publish-avatars" aria-hidden="true"><CommunityAvatar v-for="user in (store.context?.suggestedUsers || []).slice(0, 3)" :key="user.id" :src="user.avatar" :username="user.username" :name="user.displayName" size="xs" /></span><strong>已发布</strong></button></div>
<AppDialog :model-value="store.composerOpen && !store.composerInline" :title="store.composerMode === 'advanced' ? '高级编辑' : '分享学习收获'" class="community-composer" @update:model-value="editor.close()"><template v-if="store.composerOpen && !store.composerInline"><CommunityAdvancedComposer v-if="store.composerMode === 'advanced'" /><CommunityQuickComposer v-else dialog /></template></AppDialog>
<AppDialog :model-value="editor.closePrompt" title="保留未完成的内容" @update:model-value="cancel"><p>还有正在编辑的内容，你希望怎样离开？</p><div class="composer-actions"><button class="button primary" :disabled="editor.saving" @click="finish(true)">{{ store.editingId && !editor.draftId ? '保留本地副本' : '保存服务器草稿' }}</button><button class="button secondary" @click="finish(false)">放弃修改</button><button class="button secondary" @click="cancel">继续编辑</button></div></AppDialog>
</template>
