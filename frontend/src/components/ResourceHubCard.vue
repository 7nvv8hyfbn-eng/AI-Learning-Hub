<script setup lang="ts">
import type { ResourceHubItemDto } from '@ai-learning-hub/contracts'
import { computed, ref } from 'vue'
import AppIcon from './base/AppIcon.vue'
import CommunityAvatar from './base/CommunityAvatar.vue'
import { relativeTime } from '../community/labels'

const props = withDefaults(defineProps<{ item: ResourceHubItemDto; variant?: 'standard' | 'featured' | 'compact'; showWatchLater?: boolean }>(), { variant: 'standard', showWatchLater: false })
defineEmits<{ watchLater: [postId: string] }>()
const coverBroken = ref(false)
const duration = computed(() => {
  if (!props.item.durationSeconds) return ''
  const minutes = Math.floor(props.item.durationSeconds / 60)
  return `${minutes}:${String(props.item.durationSeconds % 60).padStart(2, '0')}`
})
</script>

<template>
  <article class="resource-hub-card" :class="`is-${variant}`">
    <div class="resource-hub-cover-wrap">
      <RouterLink class="resource-hub-cover" :to="item.route">
        <span class="resource-hub-cover-empty" aria-hidden="true"><AppIcon name="resource" :size="30" /></span>
        <img v-if="item.coverUrl && !coverBroken" :src="item.coverUrl" :alt="`${item.title}封面`" loading="lazy" @error="coverBroken = true" />
        <span v-if="item.category" class="resource-hub-category">{{ item.category.name }}</span>
        <span v-if="duration" class="resource-hub-duration">{{ duration }}</span>
        <span v-else class="resource-hub-kind">{{ item.kind === 'article' ? '图文教程' : '学习资料' }}</span>
      </RouterLink>
      <button v-if="item.postId && showWatchLater" class="resource-hub-quick-save" type="button" title="加入稍后再看" aria-label="加入稍后再看" @click="$emit('watchLater', item.postId)"><AppIcon name="bookmark" :size="16" /></button>
    </div>
    <div class="resource-hub-card-body">
      <RouterLink class="resource-hub-card-title" :to="item.route">{{ item.title }}</RouterLink>
      <p v-if="variant === 'featured'">{{ item.summary }}</p>
      <footer>
        <RouterLink v-if="item.author" class="resource-hub-author" :to="`/community/user/${item.author.username}`">
          <CommunityAvatar :src="item.author.avatar" :username="item.author.username" :name="item.author.displayName" size="xs" />
          <span>{{ item.author.displayName }}</span>
        </RouterLink>
        <span v-else>平台资源</span>
        <small class="resource-hub-card-stats"><span :title="`浏览 ${item.stats.views}`"><AppIcon name="play" :size="13" />{{ item.stats.views.toLocaleString() }}</span><span :title="`点赞 ${item.stats.likes}`"><AppIcon name="heart" :size="13" />{{ item.stats.likes.toLocaleString() }}</span><span :title="`收藏 ${item.stats.bookmarks}`"><AppIcon name="bookmark" :size="13" />{{ item.stats.bookmarks.toLocaleString() }}</span></small>
        <small class="resource-hub-card-time">{{ relativeTime(item.publishedAt) }}</small>
      </footer>
    </div>
  </article>
</template>
