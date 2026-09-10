<script setup lang="ts">
import AdminCloseIcon from './AdminCloseIcon.vue'
withDefaults(defineProps<{ modelValue: boolean; title: string; width?: string }>(), { width: '520px' })
defineEmits<{ 'update:modelValue': [value: boolean] }>()
</script>

<template>
  <el-dialog :model-value="modelValue" :title="title" :width="width" :close-icon="AdminCloseIcon" align-center destroy-on-close @update:model-value="$emit('update:modelValue', $event)">
    <slot />
  </el-dialog>
</template>
