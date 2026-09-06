<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, useId } from 'vue'
import AppIcon from '../components/base/AppIcon.vue'

withDefaults(defineProps<{ label?: string }>(), { label: '更多动态操作' })
const id = `community-menu-${useId()}`, trigger = ref<HTMLButtonElement>(), panel = ref<HTMLElement>()
const opened = ref(false), position = ref({ left: '0px', top: '0px' })
const close = () => { panel.value?.hidePopover(); opened.value = false }
const toggle = async () => {
  if (opened.value) { close(); return }
  const button = trigger.value, menu = panel.value
  if (!button || !menu) return
  menu.showPopover()
  await nextTick()
  const rect = button.getBoundingClientRect()
  position.value = {
    left: `${Math.max(8, Math.min(rect.right - menu.offsetWidth, window.innerWidth - menu.offsetWidth - 8))}px`,
    top: `${Math.max(8, rect.bottom + menu.offsetHeight + 8 <= window.innerHeight ? rect.bottom + 4 : rect.top - menu.offsetHeight - 4)}px`,
  }
  menu.querySelector<HTMLElement>('button:not(:disabled), a')?.focus({ preventScroll: true })
}
// 原生 auto popover 负责外点、Escape、焦点与同一时刻唯一展开的菜单。
const onToggle = (event: Event) => { opened.value = (event as ToggleEvent).newState === 'open' }
const scrollOptions = { capture: true, passive: true }
const onScroll = (event: Event) => { if (event.target !== panel.value) close() }
onMounted(() => { window.addEventListener('resize', close); window.addEventListener('scroll', onScroll, scrollOptions) })
onBeforeUnmount(() => { close(); window.removeEventListener('resize', close); window.removeEventListener('scroll', onScroll, scrollOptions) })
</script>
<template>
  <div class="community-post-menu">
    <button ref="trigger" type="button" class="community-menu-trigger" :aria-label="label" aria-haspopup="menu" :aria-expanded="opened" :aria-controls="id" @click="toggle"><slot name="trigger"><AppIcon name="more-circle" :size="18" /></slot></button>
    <Teleport to="body"><div :id="id" ref="panel" class="community-menu-panel" popover="auto" role="menu" :style="position" @toggle="onToggle" @click="close"><slot /></div></Teleport>
  </div>
</template>
