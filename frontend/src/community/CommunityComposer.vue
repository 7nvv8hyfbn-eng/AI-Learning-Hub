<script setup lang="ts">
import { defineAsyncComponent, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
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
const RichEditPanel = defineAsyncComponent(() => import('./coop/RichEditPanel.vue'))
const CommunityImageEditor = defineAsyncComponent(() => import('./CommunityImageEditor.vue'))
const scrollRoot = useCommunityScrollRoot()
const pastQuarter = () => !!scrollRoot.value && scrollRoot.value.scrollTop > (scrollRoot.value.scrollHeight - scrollRoot.value.clientHeight) / 4
const showBackToTop = ref(pastQuarter())
const updateBackToTop = () => { showBackToTop.value = pastQuarter() }
const bindScrollRoot = () => { const root = typeof document === 'undefined' ? scrollRoot.value : document.querySelector<HTMLElement>('.community-main'); scrollRoot.value?.removeEventListener('scroll', updateBackToTop); scrollRoot.value = root; root?.addEventListener('scroll', updateBackToTop, { passive: true }); updateBackToTop() }
const backToTop = () => scrollRoot.value?.scrollTo({ top: 0, behavior: 'smooth' })
const leave = (event: BeforeUnloadEvent) => { if (store.composerOpen && editor.hasWork) { event.preventDefault(); event.returnValue = '' } }
let continuation: (() => void) | null = null
watch(() => store.composerRequest, (request) => { if (request) continuation = null }, { flush: 'sync' })
const removeGuard = router.beforeEach((to, from) => {
  if (!store.composerOpen || to.path === from.path) return
  store.composerRequest = null
  if (!editor.hasWork) { editor.close(); return }
  continuation = () => { void router.push(to.fullPath) }; editor.close(); return false
})
const removeAfter = router.afterEach((to, _, failure) => {
  if (store.composerOpen && router.currentRoute.value.path !== '/community') store.composerInline = false
  if (store.composerOpen && to.path === '/community/drafts' && isNavigationFailure(failure, NavigationFailureType.duplicated)) editor.close()
  void nextTick(bindScrollRoot)
})
const finish = async (save: boolean) => {
  if (editor.saving) return
  if (save) await editor.saveAndClose(); else editor.discard()
  if (!editor.closePrompt && !store.composerOpen) {
    const request = store.composerRequest, next = continuation; continuation = null
    if (request) store.applyComposerRequest(request)
    else next?.()
  }
}
const cancel = () => { editor.closePrompt = false; store.composerRequest = null; continuation = null; if (router.currentRoute.value.path !== '/community') store.composerInline = false }
onMounted(() => { window.addEventListener('beforeunload', leave); bindScrollRoot() })
onBeforeUnmount(() => { removeGuard(); removeAfter(); window.removeEventListener('beforeunload', leave); scrollRoot.value?.removeEventListener('scroll', updateBackToTop) })
</script>
<template>
<div v-if="store.publishNotice" class="toast" role="status"><span>{{ store.publishNotice.text }}</span><br /><RouterLink class="text-link" :to="`/community/post/${store.publishNotice.id}`">查看投稿</RouterLink> · <button type="button" class="text-link" @click="store.publishNotice = null">关闭</button></div>
<div v-else-if="showBackToTop" class="community-publish-feedback" role="status" aria-live="polite"><button type="button" aria-label="返回社区顶部" @click="backToTop"><AppIcon name="arrow-right" :size="16" /><span class="community-publish-avatars" aria-hidden="true"><CommunityAvatar v-for="user in (store.context?.suggestedUsers || []).slice(0, 3)" :key="user.id" :src="user.avatar" :username="user.username" :name="user.displayName" size="xs" /></span><strong>已发布</strong></button></div>
<RichEditPanel v-if="store.composerOpen && store.composerMode === 'rich'" :key="store.composerSession" />
<CommunityImageEditor v-if="store.composerOpen && editor.activeImage" :key="editor.activeImage.id" :item="editor.activeImage" />
<AppDialog :model-value="store.composerOpen && !store.composerInline && store.composerMode !== 'rich'" :title="store.composerMode === 'advanced' ? '高级编辑' : '分享学习收获'" class="community-composer" @update:model-value="editor.close()"><template v-if="store.composerOpen && !store.composerInline && store.composerMode !== 'rich'"><CommunityAdvancedComposer v-if="store.composerMode === 'advanced'" :key="store.composerSession" /><CommunityQuickComposer v-else :key="store.composerSession" dialog /></template></AppDialog>
<AppDialog :model-value="editor.closePrompt" title="保留未完成的内容" @update:model-value="cancel"><p>还有正在编辑的内容，你希望怎样继续？</p><p v-if="editor.pendingImages || editor.pendingUploads" class="community-notice">文字和已上传的文件可以保留；继续后会取消未完成的上传，尚未保存的本地图片需要重新选择。</p><p v-if="store.editingId && !editor.draftId" class="community-notice">已公开帖子的修改仅保留本地副本，不改变公开版本。</p><p v-if="editor.error" role="alert" class="community-error">{{ editor.error }}</p><div class="composer-actions"><button class="button primary" :disabled="editor.saving" @click="finish(true)">保存草稿并继续</button><button class="button secondary" :disabled="editor.saving" @click="finish(false)">放弃修改并继续</button><button class="back-button" @click="cancel" aria-label="返回当前编辑" title="返回当前编辑"><AppIcon name="back" /></button></div></AppDialog>
</template>
