<script setup lang="ts">
import type { ResourceHubItemDto } from '@ai-learning-hub/contracts'
import { computed } from 'vue'
import AppIcon from './base/AppIcon.vue'
import CommunityAvatar from './base/CommunityAvatar.vue'
import { relativeTime } from '../community/labels'

const props = withDefaults(defineProps<{ item: ResourceHubItemDto; variant?: 'standard' | 'featured' | 'compact'; showWatchLater?: boolean }>(), { variant: 'standard', showWatchLater: false })
defineEmits<{ watchLater: [postId: string] }>()
const duration = computed(() => {
  if (!props.item.durationSeconds) return ''
  const minutes = Math.floor(props.item.durationSeconds / 60)
  return `${minutes}:${String(props.item.durationSeconds % 60).padStart(2, '0')}`
})
</script>

<template>
  <article class="resource-hub-card" :class="`is-${variant}`">
    <RouterLink class="resource-hub-cover" :to="item.route">
      <img v-if="item.coverUrl" :src="item.coverUrl" :alt="`${item.title}封面`" loading="lazy" />
      <span v-else class="resource-hub-cover-empty"><AppIcon name="resource" :size="30" /></span>
      <span v-if="item.category" class="resource-hub-category">{{ item.category.name }}</span>
      <span v-if="duration" class="resource-hub-duration">{{ duration }}</span>
      <span v-else class="resource-hub-kind">{{ item.kind === 'article' ? '图文教程' : '学习资料' }}</span>
    </RouterLink>
    <div class="resource-hub-card-body">
      <RouterLink class="resource-hub-card-title" :to="item.route">{{ item.title }}</RouterLink>
      <p v-if="variant === 'featured'">{{ item.summary }}</p>
      <footer>
        <RouterLink v-if="item.author" class="resource-hub-author" :to="`/community/user/${item.author.username}`">
          <CommunityAvatar :src="item.author.avatar" :username="item.author.username" :name="item.author.displayName" size="xs" />
          <span>{{ item.author.displayName }}</span>
        </RouterLink>
        <span v-else>平台资源</span>
        <small><AppIcon name="play" :size="14" />{{ item.stats.views.toLocaleString() }} · {{ relativeTime(item.publishedAt) }}</small>
        <button v-if="item.postId && showWatchLater" type="button" title="稍后再看" aria-label="加入稍后再看" @click="$emit('watchLater', item.postId)"><AppIcon name="bookmark" :size="16" /></button>
      </footer>
    </div>
  </article>
</template>
