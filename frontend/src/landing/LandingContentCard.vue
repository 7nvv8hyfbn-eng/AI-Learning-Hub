<script setup lang="ts">
import { computed } from 'vue'
import type { HomepageResolvedItemDto, LandingPublicAuthor } from '@ai-learning-hub/contracts'
import CommunityAvatar from '../components/base/CommunityAvatar.vue'
import AppIcon from '../components/base/AppIcon.vue'
import { landingAsset, type LandingAssetKey } from '../assets/landing/manifest'
import CategoryCover from '../components/base/CategoryCover.vue'
import { itemCover } from '../homepage/module-utils'
const props = withDefaults(defineProps<{ item: HomepageResolvedItemDto; variant?: 'featured' | 'note' | 'visual' | 'code' | 'resource'; cover?: LandingAssetKey }>(), { variant: 'featured', cover: 'robotCar' })
defineEmits<{ open: [item: HomepageResolvedItemDto] }>()
const author = computed(() => props.item.data.author && typeof props.item.data.author === 'object' ? props.item.data.author as LandingPublicAuthor : null)
const label = computed(() => ({ community_post: '社区精选', lab: '实训项目', course: '课程学习', article: 'AI 前沿', resource: '学习资源', community_topic: '话题讨论', community_user: '社区创作者', theme: '通识基础', challenge: '挑战测评' })[props.item.targetType])
const hasImage = computed(() => ['featured', 'visual', 'code'].includes(props.variant))
const isCatalog = computed(() => ['theme', 'course', 'lab', 'resource', 'article', 'challenge'].includes(props.item.targetType))
</script>
<template>
  <button type="button" class="landing-content-card" :class="`landing-card-${variant}`" @click="$emit('open', item)">
    <CategoryCover v-if="hasImage && isCatalog" class="landing-cover" :title="item.title" :media="itemCover(item)" />
    <img v-else-if="hasImage" class="landing-cover" :src="landingAsset(String(item.data.cover || ''), cover)" :alt="`${item.title}主题示意图`" width="960" height="540" :loading="variant === 'featured' ? 'lazy' : 'eager'" decoding="async" />
    <div class="landing-card-copy">
      <div v-if="variant === 'note' && author" class="landing-author"><CommunityAvatar :name="author.displayName" :username="author.username" :src="author.avatarUrl" size="sm" /><span>{{ author.displayName }}<small>{{ label }}</small></span></div>
      <span v-else class="landing-tag">{{ label }}</span>
      <h3>{{ item.title }}</h3><p v-if="variant !== 'visual'">{{ item.summary }}</p>
      <div v-if="variant === 'featured' || variant === 'note'" class="landing-card-meta">
        <span v-if="author" class="landing-author"><CommunityAvatar :name="author.displayName" :username="author.username" :src="author.avatarUrl" size="xs" />{{ author.displayName }}</span>
        <span v-if="typeof item.data.likeCount === 'number'"><AppIcon name="heart" :size="14" />{{ item.data.likeCount }}</span>
        <span v-if="typeof item.data.commentCount === 'number'"><AppIcon name="message" :size="14" />{{ item.data.commentCount }}</span>
        <span v-if="!author" class="landing-card-link">查看内容 <AppIcon name="arrow-right" :size="14" /></span>
      </div>
    </div>
  </button>
</template>
