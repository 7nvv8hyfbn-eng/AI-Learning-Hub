<script setup lang="ts">
import { useCommunityAccess } from '../../community/composables/useCommunityAccess'
const props = defineProps<{ active?: boolean; pending?: boolean; label?: string }>()
const emit = defineEmits<{ click: [] }>()
const { requireWrite } = useCommunityAccess()
const click = () => { if (requireWrite(props.active ? 'read' : 'interaction')) emit('click') }
</script>
<template><button class="follow-button" type="button" :aria-label="label" :aria-pressed="!!active" :disabled="pending" @click="click">{{ active ? '已关注' : '关注' }}</button></template>
