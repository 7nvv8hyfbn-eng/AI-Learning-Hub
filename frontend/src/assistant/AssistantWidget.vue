<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import AssistantEntry from './AssistantEntry.vue'
import AssistantPanel from './AssistantPanel.vue'
import { assistantState as state, loadAssistantConfig, resetAssistant, toggleAssistant } from './assistantState'
const entry = ref<InstanceType<typeof AssistantEntry>>()
watch(() => state.open, async (open, previous) => { if (!open && previous) { await nextTick(); entry.value?.focus() } })
onMounted(() => { void loadAssistantConfig() })
onBeforeUnmount(resetAssistant)
</script>
<template>
  <template v-if="state.ready && state.config.enabled">
    <AssistantEntry ref="entry" :name="state.config.name" :position="state.config.position" :open="state.open" @activate="toggleAssistant" />
    <AssistantPanel v-if="state.open" />
  </template>
  <button v-else-if="state.configError" class="assistant-config-error" type="button" :title="state.configError" @click="loadAssistantConfig">助手暂不可用，点击重试</button>
</template>
<style scoped>
.assistant-config-error { position: fixed; right: 16px; bottom: 100px; z-index: 120; max-width: calc(100vw - 32px); padding: 10px; border: 1px solid var(--amc-border); border-radius: var(--amc-radius-control); background: var(--amc-surface); color: var(--amc-text-body); font-size: 12px; }
</style>
