<script lang="ts">
const warned = new Set<string>()
</script>
<script setup lang="ts">
import { computed, watch } from 'vue'
import { getIconHref, iconRegistry } from '../../../packages/catalog-assets/icons/registry'
const props = defineProps<{ name?: string; size?: number }>()
const href = computed(() => getIconHref(props.name))
watch(() => props.name, (name) => {
  if (name && !Object.hasOwn(iconRegistry, name) && !warned.has(name)) { warned.add(name); console.warn('[AdminIcon] 未注册图标：' + name) }
}, { immediate: true })
</script>

<template>
  <svg class="admin-icon" :width="size || 20" :height="size || 20" viewBox="0 0 1024 1024" aria-hidden="true" focusable="false"><use :href="href" /></svg>
</template>
