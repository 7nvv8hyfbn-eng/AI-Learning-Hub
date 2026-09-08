<script setup lang="ts">
import type { PublicHomepageModuleDto } from '@ai-learning-hub/contracts'
import AppIcon from '../../components/base/AppIcon.vue'
import CategoryCover from '../../components/base/CategoryCover.vue'
import { configText, itemNumber, itemPath, itemText, itemCover } from '../module-utils'
defineProps<{ module: PublicHomepageModuleDto }>()
</script>
<template>
  <section class="homepage-module resource-tools-module">
    <div class="section-heading"><div><span class="eyebrow">{{ configText(module, 'eyebrow', '知识工具箱') }}</span><h2>{{ configText(module, 'title', module.name) }}</h2><p>{{ configText(module, 'subtitle') }}</p></div><RouterLink to="/resources">进入教程中心 <AppIcon name="arrow-right" :size="15" /></RouterLink></div>
    <div class="resource-strip">
      <RouterLink v-for="item in module.items.slice(0, 6)" :key="item.slug" :to="itemPath(item)">
        <CategoryCover :title="item.title" :media="itemCover(item)" />
        <span class="format"><AppIcon :name="itemText(item, 'icon')" :size="22" /></span><strong>{{ item.title }}</strong><small>{{ itemText(item, 'format') }} · {{ itemNumber(item, 'downloads').toLocaleString() }} 次下载</small>
      </RouterLink>
    </div>
  </section>
</template>
