<script setup lang="ts">
import { onBeforeUnmount, ref } from 'vue'
import { assistantArt, assistantShapes, type AssistantAction } from '../assets/assistant/art'
defineProps<{ name: string; position: 'left' | 'right'; open: boolean }>()
const emit = defineEmits<{ activate: [] }>()
const button = ref<HTMLButtonElement>(), action = ref<AssistantAction>('idle')
const actions: AssistantAction[] = ['wave', 'walk', 'jump', 'wink']
let last: AssistantAction = 'idle', timer: ReturnType<typeof setTimeout> | undefined
function activate() {
  clearTimeout(timer)
  if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    const choices = actions.filter(value => value !== last)
    action.value = last = choices[Math.floor(Math.random() * choices.length)]!
    timer = setTimeout(() => { action.value = 'idle' }, 850)
  } else action.value = 'idle'
  emit('activate')
}
defineExpose({ focus: () => button.value?.focus() })
onBeforeUnmount(() => clearTimeout(timer))
</script>
<template>
  <button ref="button" class="assistant-entry" :class="[`is-${position}`, `action-${action}`]" :style="{ clipPath: assistantShapes[action] }" type="button" :aria-label="`${open ? '关闭' : '打开'}${name}`" aria-haspopup="dialog" aria-controls="assistant-panel" :aria-expanded="open" @click="activate">
    <img :src="assistantArt[action]" alt="" width="112" height="112" draggable="false">
  </button>
</template>
<style scoped>
.assistant-entry { position: fixed; bottom: 28px; z-index: 120; width: 112px; height: 112px; padding: 0; border: 0; background: transparent; cursor: pointer; }
.is-right { right: 28px; } .is-left { left: 28px; }
.assistant-entry img { width: 100%; height: 100%; object-fit: contain; pointer-events: none; }
.assistant-entry:focus-visible { clip-path: none !important; outline: 3px solid var(--amc-purple); border-radius: var(--amc-radius-card); }
.action-wave { animation: wave 850ms ease; } .action-walk { animation: walk 850ms ease; } .action-jump { animation: jump 850ms ease; } .action-wink { animation: wink 850ms ease; }
@keyframes wave { 25%, 65% { transform: rotate(-8deg); } 45%, 85% { transform: rotate(6deg); } }
@keyframes walk { 30% { transform: translateX(-10px) rotate(-4deg); } 65% { transform: translateX(10px) rotate(4deg); } }
@keyframes jump { 40% { transform: translateY(-24px); } 70% { transform: translateY(0) scale(1.04,.96); } }
@keyframes wink { 45% { transform: rotate(-5deg) scale(1.06); } }
@media (max-width: 767px) { .assistant-entry { width: 96px; height: 96px; bottom: calc(90px + env(safe-area-inset-bottom)); } .is-right { right: 12px; } .is-left { left: 12px; } }
@media (prefers-reduced-motion: reduce) { .assistant-entry { animation: none; } }
</style>
