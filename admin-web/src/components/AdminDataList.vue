<script setup lang="ts" generic="T extends AdminCatalogItemDto<object>">
import type { AdminCatalogItemDto } from '@ai-learning-hub/contracts'
import AdminStatusTag from './AdminStatusTag.vue'
import AdminIcon from './AdminIcon.vue'

defineProps<{ items: T[]; selected?: string; icon?: string; emptyText?: string }>()
defineEmits<{ select: [item: T] }>()
</script>

<template>
  <div v-if="items.length" class="data-list">
    <button v-for="item in items" :key="item.id" type="button" :class="{ selected: selected === item.id }" @click="$emit('select', item)">
      <span class="list-icon"><AdminIcon :name="icon || 'resource'" :size="19" /></span>
      <div><strong>{{ item.title }}</strong><small>{{ item.summary }}</small><p><AdminStatusTag :status="item.status" /><span>更新 {{ new Date(item.updatedAt).toLocaleDateString('zh-CN') }}</span></p></div>
      <i><AdminIcon name="more-circle" :size="18" /></i>
    </button>
  </div>
  <div v-else class="admin-empty"><span><AdminIcon name="resource" :size="24" /></span><strong>{{ emptyText || '暂无匹配内容' }}</strong><small>调整筛选条件或创建第一条内容。</small></div>
</template>
