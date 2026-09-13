<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { api } from '../services/api'
import { useSessionStore } from '../stores/session'
import AdminIcon from './AdminIcon.vue'
import { appVersion } from '../version'

const session = useSessionStore()
const router = useRouter()
const search = ref('')
const runtimeMode = import.meta.env.MODE
const notifications = ref<Array<{ id: string; title: string; status: string }>>([])
const canReadNotifications = computed(() => session.user?.permissions.includes('settings.read'))
const quickCreates = computed(() => [
  ['theme.write', '新建主题', '/themes'],
  ['course.write', '新建课程', '/courses'],
  ['lab.write', '新建实训', '/labs'],
  ['resource.write', '上传资源', '/resources'],
  ['article.write', '新建文章', '/articles'],
  ['challenge.write', '新建挑战', '/challenges'],
].filter(([permission]) => session.user?.permissions.includes(permission)))

const submit = () => {
  if (search.value.trim()) router.push({ path: '/search', query: { q: search.value.trim() } })
}
const logout = async () => {
  await session.logout()
  router.replace('/login')
}
onMounted(async () => {
  if (canReadNotifications.value) notifications.value = await api('/admin/notifications')
})
</script>

<template>
  <header class="admin-header">
    <form role="search" @submit.prevent="submit"><span><AdminIcon name="search" :size="18" /></span><input v-model="search" placeholder="搜索用户、课程、项目、资源等…" /></form>
    <div class="header-env"><b></b>{{ runtimeMode }}</div>
    <el-dropdown v-if="canReadNotifications">
      <button class="header-bell" type="button" aria-label="通知"><AdminIcon name="notification" :size="19" /><small>{{ notifications.filter((item) => item.status === 'published').length }}</small></button>
      <template #dropdown><el-dropdown-menu><el-dropdown-item v-for="item in notifications.slice(0, 8)" :key="item.id" @click="router.push('/settings')">{{ item.title }}</el-dropdown-item><el-dropdown-item v-if="!notifications.length">暂无通知</el-dropdown-item></el-dropdown-menu></template>
    </el-dropdown>
    <el-dropdown>
      <button class="admin-user" type="button"><span>{{ session.user?.displayName.slice(0, 1) }}</span><strong>{{ session.user?.displayName }}<small>{{ session.user?.roles.join('、') || '管理账号' }}</small></strong><AdminIcon name="chevron-down" :size="15" /></button>
      <template #dropdown><el-dropdown-menu><el-dropdown-item @click="router.push('/account/security')">账号安全</el-dropdown-item><el-dropdown-item @click="logout">退出登录</el-dropdown-item><li class="app-version account-version" role="presentation" aria-label="应用版本">{{ appVersion }}</li></el-dropdown-menu></template>
    </el-dropdown>
    <el-dropdown v-if="quickCreates.length">
      <button class="quick-create" type="button"><AdminIcon name="plus" :size="15" />快速创建<AdminIcon name="chevron-down" :size="14" /></button>
      <template #dropdown><el-dropdown-menu><el-dropdown-item v-for="[, label, path] in quickCreates" :key="path" @click="router.push(path)">{{ label }}</el-dropdown-item></el-dropdown-menu></template>
    </el-dropdown>
  </header>
</template>
