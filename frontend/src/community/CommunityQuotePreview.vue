<script setup lang="ts">
import CommunityUserBadges from './CommunityUserBadges.vue'
import { onBeforeUnmount, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import type { CommunityQuotedPostDto } from '@ai-learning-hub/contracts'
import { communityApi } from '../services/api/community'
import { useCommunityStore } from '../stores/community'
import CommunityAvatar from '../components/base/CommunityAvatar.vue'
import CommunityBlocks from './CommunityBlocks.vue'
import { relativeTime } from './labels'
const props = defineProps<{ post?: CommunityQuotedPostDto | null; id?: string | null }>()
const store = useCommunityStore(), router = useRouter(), shown = ref<CommunityQuotedPostDto>(), image = ref('')
let version = 0
const clearImage = () => { if (image.value) URL.revokeObjectURL(image.value); image.value = '' }
watch(() => [props.post, props.id, store.epoch], async () => {
  const current = ++version; clearImage(); shown.value = props.post || undefined
  try {
    if (!props.post && props.id) {
      const post = await communityApi.post(props.id)
      if (current !== version) return
      shown.value = post.status === 'published' && post.visibility === 'public' ? { id: post.id, available: true, author: post.author, publishedAt: post.publishedAt, title: post.title, contentBlocks: post.contentBlocks.filter((block) => block.type !== 'image'), inlineReferences: post.inlineReferences || [], thumbnailFileId: post.contentBlocks.find((block) => block.type === 'image')?.fileId } : { id: props.id, available: false }
    }
    const target = shown.value
    if (target?.available && target.thumbnailFileId) { const url = await communityApi.image(target.thumbnailFileId); if (current === version) image.value = url; else URL.revokeObjectURL(url) }
  } catch { if (current === version && !props.post && props.id) shown.value = { id: props.id, available: false } }
}, { immediate: true })
const open = (event: Event) => { event.stopPropagation(); if (!(event.target as HTMLElement).closest('a') && shown.value?.available) void router.push(`/community/post/${shown.value.id}`) }
onBeforeUnmount(() => { version++; clearImage() })
</script>
<template><div class="community-quote-preview" :class="{ available: shown?.available }" :role="shown?.available ? 'link' : undefined" :tabindex="shown?.available ? 0 : undefined" @click="open" @keydown.enter.prevent.stop="open"><template v-if="shown?.available"><header><CommunityAvatar :src="shown.author.avatar" :name="shown.author.displayName" :username="shown.author.username" size="sm" /><strong>{{ shown.author.displayName }}</strong><CommunityUserBadges :badges="shown.author.badges" :verified-type="shown.author.verifiedType" /><small>{{ relativeTime(shown.publishedAt) }}</small></header><img v-if="image" :src="image" alt="原帖缩略图" /><strong v-if="shown.title">{{ shown.title }}</strong><CommunityBlocks :blocks="shown.contentBlocks" :references="shown.inlineReferences" compact post /></template><span v-else>{{ shown ? '原内容已不可用' : '正在读取引用原帖…' }}</span></div></template>
<style scoped>
.community-quote-preview { border: 1px solid var(--amc-border); border-radius: 10px; padding: 12px; margin: 10px 0; overflow: hidden; color: var(--amc-text-secondary); }
.available { cursor: pointer; } header { display: flex; align-items: center; gap: 8px; margin-bottom: 6px; } small { margin-left: auto; font-size: 11px; } img { width: 76px; height: 64px; object-fit: cover; float: right; margin-left: 8px; border-radius: 6px; }
.community-quote-preview :deep(.community-text-blocks) { max-height: 4.8em; overflow: hidden; font-size: 13px; }.community-quote-preview :deep(p) { margin: 4px 0; }
</style>
