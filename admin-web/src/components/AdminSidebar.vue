<script setup lang="ts">
import { BRAND_NAME, BRAND_MARK, BRAND_SLOGAN_LINES } from '@ai-learning-hub/contracts'
import { computed } from 'vue'
import { useSessionStore } from '../stores/session'
import AdminIcon from './AdminIcon.vue'
import { visibleAdminNavigation } from '../navigation'
import { appVersion } from '../version'

const session = useSessionStore()
const groups = computed(() => visibleAdminNavigation(session.user?.permissions || []))
</script>

<template>
  <aside class="admin-sidebar">
    <RouterLink class="admin-brand" to="/dashboard">
      <span>{{ BRAND_MARK }}</span>
      <strong>{{ BRAND_NAME }}<small class="brand-slogan-lines">{{ BRAND_SLOGAN_LINES.join('\n') }}</small></strong>
    </RouterLink>
    <nav aria-label="管理导航">
      <section v-for="group in groups" :key="group.label" class="admin-nav-group"><h2>{{ group.label }}</h2><RouterLink v-for="[icon, label, path] in group.items" :key="path" :to="path"><i><AdminIcon :name="icon" :size="19" /></i><span>{{ label }}</span></RouterLink></section>
    </nav>
    <div class="sidebar-note"><span><AdminIcon name="lab" :size="22" /></span><strong>平台持续演进</strong><small>统一数据，稳定发布</small></div>
    <p class="app-version sidebar-version" aria-label="应用版本">{{ appVersion }}</p>
  </aside>
</template>
<style scoped>.admin-nav-group h2 { font-size: 10px; font-weight: 500; color: #8e8a86; margin: 9px 12px 3px; }.admin-nav-group a { min-height: 39px; }</style>
