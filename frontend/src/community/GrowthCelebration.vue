<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import AppDialog from '../components/base/AppDialog.vue'
import AppIcon from '../components/base/AppIcon.vue'
import type { GrowthAchievementItem } from '../services/api/behavior'
import { behaviorApi } from '../services/api/behavior'
import { dataMode } from '../services/api/client'
import { useAuthStore } from '../stores/auth'
import { growthIcon, growthTier } from './growth'

const auth = useAuthStore()
const queue = ref<GrowthAchievementItem[]>([])
const current = computed(() => queue.value[0] || null)
const seenKey = (id: string) => `growth-celebrated:${id}`
const readSeen = (id: string): string[] => {
  try { return JSON.parse(localStorage.getItem(seenKey(id)) || '[]') as string[] } catch { return [] }
}
const writeSeen = (id: string, codes: string[]) => {
  try { localStorage.setItem(seenKey(id), JSON.stringify(codes)) } catch { /* 存储不可用时跳过追踪 */ }
}
const check = async () => {
  if (dataMode !== 'api' || !auth.user) return
  try {
    const { items } = await behaviorApi.achievements()
    const seen = new Set(readSeen(auth.user.id))
    const fresh = items.filter((item) => item.unlocked && !seen.has(item.code) && !queue.value.some((row) => row.code === item.code))
    if (fresh.length) queue.value = [...queue.value, ...fresh]
    writeSeen(auth.user.id, items.filter((item) => item.unlocked).map((item) => item.code))
  } catch { /* 成就检查失败不打扰用户 */ }
}
const close = () => { queue.value = queue.value.slice(1) }
onMounted(() => { void check(); window.addEventListener('growth-celebration-check', check) })
onBeforeUnmount(() => window.removeEventListener('growth-celebration-check', check))
</script>
<template>
  <AppDialog :model-value="!!current" :title="current ? `解锁成就「${current.name}」` : '成就解锁'" @update:model-value="close">
    <div v-if="current" class="growth-celebrate">
      <span class="badge-medal is-large" :class="growthTier(current.code).cover"><i class="badge-medal-core"><AppIcon :name="growthIcon(current.code)" :size="34" :style="{ color: growthTier(current.code).color }" /></i></span>
      <strong>{{ current.name }}</strong>
      <p>{{ current.description }}</p>
      <span class="growth-celebrate-note">太棒了，继续保持！</span>
    </div>
  </AppDialog>
</template>
