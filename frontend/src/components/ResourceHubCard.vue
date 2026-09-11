<script setup lang="ts">
import CommunityUserBadges from '../community/CommunityUserBadges.vue'
import type { ResourceHubItemDto } from '@ai-learning-hub/contracts'
import { computed, ref } from 'vue'
import CommunityPostMenu from '../community/CommunityPostMenu.vue'
import CommunityModerationMenuItems from '../community/CommunityModerationMenuItems.vue'
import { moderatorActionsFor } from '../community/moderation'
import { useAuthStore } from '../stores/auth'
import AppIcon from './base/AppIcon.vue'
import CommunityAvatar from './base/CommunityAvatar.vue'
import { relativeTime } from '../community/labels'

const props = withDefaults(defineProps<{ item: ResourceHubItemDto; variant?: 'standard' | 'featured' | 'compact'; showWatchLater?: boolean }>(), { variant: 'standard', showWatchLater: false })
const emit = defineEmits<{ watchLater: [postId: string]; changed: [] }>()
const auth = useAuthStore(), hidden = ref(false)
const canModerate = computed(() => props.item.postId && props.item.author && moderatorActionsFor(auth.user, 'tutorials', props.item.author.id).length)
const moderated = (action: string) => { if (action === 'takedown' || action === 'ban') hidden.value = true; emit('changed') }
const duration = computed(() => {
  if (!props.item.durationSeconds) return ''
  const minutes = Math.floor(props.item.durationSeconds / 60)
  return `${minutes}:${String(props.item.durationSeconds % 60).padStart(2, '0')}`
})
</script>

<template>
  <article v-if="!hidden" class="resource-hub-card" :class="[`is-${variant}`, { 'is-video': item.kind === 'video' }]">
    <RouterLink class="resource-hub-cover" :to="item.route">
      <img v-if="item.coverUrl" :src="item.coverUrl" :alt="`${item.title}封面`" loading="lazy" />
      <span v-else class="resource-hub-cover-empty"><AppIcon name="resource" :size="30" /></span>
      <span v-if="item.category" class="resource-hub-category">{{ item.category.name }}</span>
      <span v-if="duration" class="resource-hub-duration">{{ duration }}</span>
      <span v-else class="resource-hub-kind">{{ item.kind === 'article' ? '图文教程' : '学习资料' }}</span>
    </RouterLink>
    <div class="resource-hub-card-body">
      <RouterLink class="resource-hub-card-title" :to="item.route">{{ item.title }}</RouterLink>
      <p v-if="variant === 'featured' && item.kind !== 'video'">{{ item.summary }}</p>
      <footer>
        <RouterLink v-if="item.author" class="resource-hub-author" :to="`/community/user/${item.author.username}`">
          <CommunityAvatar :src="item.author.avatar" :username="item.author.username" :name="item.author.displayName" size="xs" />
          <span class="resource-hub-author-name">{{ item.author.displayName }}</span><CommunityUserBadges :badges="item.author.badges" :verified-type="item.author.verifiedType" />
        </RouterLink>
        <span v-else class="resource-hub-author">平台资源</span>
        <div class="resource-hub-actions">
          <small :title="item.kind === 'video' ? '有效播放次数' : '浏览次数'"><span><AppIcon :name="item.kind === 'video' ? 'play' : 'eye'" :size="14" />{{ item.stats.views.toLocaleString() }}</span><time :datetime="item.publishedAt">{{ relativeTime(item.publishedAt) }}</time></small>
          <button v-if="item.postId && showWatchLater" type="button" title="稍后再看" aria-label="加入稍后再看" @click="$emit('watchLater', item.postId)"><AppIcon name="bookmark" :size="16" /></button>
          <CommunityPostMenu v-if="canModerate" label="教程管理操作"><CommunityModerationMenuItems target-type="resource" :target-id="item.postId!" :author-id="item.author!.id" scope="tutorials" @decided="moderated" /></CommunityPostMenu>
        </div>
      </footer>
    </div>
  </article>
</template>
