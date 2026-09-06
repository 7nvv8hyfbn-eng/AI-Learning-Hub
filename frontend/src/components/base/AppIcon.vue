<script setup lang="ts">
import { computed, watch } from 'vue'
import { getIconHref, iconRegistry } from '@ai-learning-hub/catalog-assets/icons/registry'

const props = defineProps<{ name?: string; size?: number }>()
const href = computed(() => getIconHref(props.name))
watch(() => props.name, (name) => {
  if (import.meta.env.DEV && name && !Object.hasOwn(iconRegistry, name)) console.warn(`[AppIcon] 未知图标：${name}`)
}, { immediate: true })
</script>

<template>
  <svg class="app-icon" :width="size || 20" :height="size || 20" viewBox="0 0 1024 1024" aria-hidden="true" focusable="false"><use :href="href" /></svg>
</template>
