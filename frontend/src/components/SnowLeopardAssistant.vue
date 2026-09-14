<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import AssistantChatPanel from './AssistantChatPanel.vue'
import idleArt from '../assets/assistant/idle.webp'
import jumpArt from '../assets/assistant/jump.webp'
import walkArt from '../assets/assistant/walk.webp'
import waveArt from '../assets/assistant/wave.webp'
import winkArt from '../assets/assistant/wink.webp'
import { SNOW_LEOPARD_CLIP_PATHS, type SnowLeopardPose } from './snow-leopard-shapes'
import { DEFAULT_ASSISTANT_CONFIG, studentConfig, type AssistantConfig } from '../services/api/assistant'
import { assistantDigestRequest } from '../community/assistantDigest'

const ACTION_POSES: Exclude<SnowLeopardPose, 'idle'>[] = ['wave', 'walk', 'jump', 'wink']
const ACTION_ART: Record<Exclude<SnowLeopardPose, 'idle'>, string> = {
  wave: waveArt,
  walk: walkArt,
  jump: jumpArt,
  wink: winkArt,
}
const ACTION_CLASS: Record<Exclude<SnowLeopardPose, 'idle'>, string> = {
  wave: 'snow-pet-wave',
  walk: 'snow-pet-walk',
  jump: 'snow-pet-jump',
  wink: 'snow-pet-wink',
}
const ACTION_RESET_MS = 850

const open = ref(false)
const pose = ref<SnowLeopardPose>('idle')
const pet = ref<HTMLButtonElement | null>(null)
const config = ref<AssistantConfig>({ ...DEFAULT_ASSISTANT_CONFIG })
const configNotice = ref('')
let actionTimer: number | undefined
let lastAction: Exclude<SnowLeopardPose, 'idle'> | undefined

const enabled = computed(() => config.value.enabled)
const assistantName = computed(() => config.value.name)
const welcome = computed(() => config.value.welcome)

const loadConfig = async () => {
  try {
    config.value = await studentConfig()
    configNotice.value = ''
  } catch (error) {
    config.value = { ...DEFAULT_ASSISTANT_CONFIG }
    configNotice.value = `助手配置暂不可用：${error instanceof Error ? error.message : '获取失败'}`
  }
}

onMounted(loadConfig)

watch(assistantDigestRequest, (request) => {
  if (request) open.value = true
})

const artFor = (p: SnowLeopardPose): string => (p === 'idle' ? idleArt : ACTION_ART[p])

const playAction = () => {
  const candidates = ACTION_POSES.filter((name) => name !== lastAction)
  const name = candidates[Math.floor(Math.random() * candidates.length)]
  lastAction = name
  pose.value = name
  const el = pet.value
  if (!el) return
  el.classList.remove(...Object.values(ACTION_CLASS))
  void el.offsetWidth
  el.classList.add(ACTION_CLASS[name])
  window.clearTimeout(actionTimer)
  actionTimer = window.setTimeout(() => {
    el.classList.remove(ACTION_CLASS[name])
    pose.value = 'idle'
  }, ACTION_RESET_MS)
}

const handleClick = () => {
  playAction()
  open.value = !open.value
}

const closePanel = () => {
  open.value = false
  void nextTick(() => pet.value?.focus())
}

onBeforeUnmount(() => window.clearTimeout(actionTimer))
</script>

<template>
  <button
    v-if="enabled"
    ref="pet"
    type="button"
    class="snow-pet"
    aria-label="小雪助手"
    aria-haspopup="dialog"
    :aria-expanded="open"
    :style="{ clipPath: `polygon(${SNOW_LEOPARD_CLIP_PATHS[pose]})` }"
    @click="handleClick"
  >
    <img :src="artFor(pose)" alt="" width="112" height="112" />
  </button>
  <span v-if="enabled" class="snow-pet-label" aria-hidden="true">小雪</span>
  <AssistantChatPanel v-if="enabled" :open="open" :name="assistantName" :welcome="welcome" :config-notice="configNotice" :digest-request="assistantDigestRequest" @close="closePanel" />
</template>

<style scoped>
.snow-pet {
  position: fixed;
  right: 24px;
  bottom: 24px;
  width: 112px;
  height: 112px;
  padding: 0;
  border: 0;
  background: transparent;
  cursor: pointer;
  z-index: 1000;
  filter: drop-shadow(0 6px 4px rgba(65, 49, 34, 0.09));
  transition: transform 0.18s ease;
  -webkit-tap-highlight-color: transparent;
}
.snow-pet img {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: contain;
  pointer-events: none;
}
.snow-pet:hover {
  transform: translateY(-4px);
}
.snow-pet:focus-visible {
  outline: 3px solid var(--blue, #2f6fed);
  outline-offset: 3px;
  border-radius: 12px;
}
.snow-pet-wave {
  animation: snow-pet-wave 0.7s ease;
}
.snow-pet-walk {
  animation: snow-pet-walk 0.85s ease;
}
.snow-pet-jump {
  animation: snow-pet-jump 0.75s ease;
}
.snow-pet-wink {
  animation: snow-pet-wink 0.7s ease;
}
@keyframes snow-pet-jump {
  45% {
    transform: translateY(-22px) scale(1.03);
  }
  75% {
    transform: scale(1.03, 0.96);
  }
}
@keyframes snow-pet-wave {
  30% {
    transform: rotate(-8deg);
  }
  60% {
    transform: rotate(7deg);
  }
}
@keyframes snow-pet-walk {
  30% {
    transform: translateX(-9px) rotate(-3deg);
  }
  65% {
    transform: translateX(9px) rotate(3deg);
  }
}
@keyframes snow-pet-wink {
  50% {
    transform: scale(0.95);
  }
}
@media (prefers-reduced-motion: reduce) {
  .snow-pet-wave,
  .snow-pet-walk,
  .snow-pet-jump,
  .snow-pet-wink {
    animation: none;
  }
}
.snow-pet-label {
  position: fixed;
  right: 26px;
  bottom: 25px;
  z-index: 999;
  font-size: 10px;
  line-height: 1;
  color: #ac806a;
  pointer-events: none;
}
@media (max-width: 650px) {
  .snow-pet {
    right: 12px;
    bottom: 12px;
    width: 88px;
    height: 88px;
  }
  .snow-pet-label {
    right: 15px;
    bottom: 13px;
  }
}
</style>