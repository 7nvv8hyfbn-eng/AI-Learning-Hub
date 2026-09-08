<script setup lang="ts">
import type { AdminCatalogItemDto, PageResult } from '@ai-learning-hub/contracts'
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import AdminPageHeader from '../components/AdminPageHeader.vue'
import AdminIcon from '../components/AdminIcon.vue'
import AdminStatusTag from '../components/AdminStatusTag.vue'
import { api } from '../services/api'
import { useSessionStore } from '../stores/session'

const route = useRoute()
const router = useRouter()
const session = useSessionStore()
const keyword = ref(String(route.query.q || ''))
const loading = ref(false)
const results = ref<Array<{ domain: string; path: string; item: AdminCatalogItemDto<object> }>>([])
const domains = [
  ['theme.read', '通识基础', 'themes'],
  ['course.read', '课程', 'courses'],
  ['lab.read', '实训', 'labs'],
  ['resource.read', '资源', 'resources'],
  ['article.read', '文章', 'articles'],
  ['challenge.read', '挑战', 'challenges'],
] as const
const accessible = computed(() => domains.filter(([permission]) => session.user?.permissions.includes(permission)))
const search = async () => {
  const value = keyword.value.trim()
  results.value = []
  if (!value) return
  loading.value = true
  try {
    const groups = await Promise.all(accessible.value.map(async ([, domain, path]) => {
      const page = await api<PageResult<AdminCatalogItemDto<object>>>(`/admin/${path}?page=1&pageSize=8&keyword=${encodeURIComponent(value)}`)
      return page.items.map((item) => ({ domain, path, item }))
    }))
    results.value = groups.flat()
    await router.replace({ query: { q: value } })
  } finally { loading.value = false }
}
watch(() => route.query.q, (value) => { keyword.value = String(value || '') })
onMounted(search)
</script>

<template>
  <AdminPageHeader title="全局搜索" description="在当前账号有权访问的业务领域中检索真实服务端数据" />
  <section class="panel">
    <form class="admin-form" role="search" @submit.prevent="search"><label>关键词<input v-model="keyword" autofocus placeholder="输入名称、摘要或稳定标识" /></label><button class="admin-primary" type="submit" :disabled="loading">搜索</button></form>
  </section>
  <section class="panel">
    <div class="panel-heading"><h2>搜索结果</h2><small>{{ loading ? '正在查询…' : `共 ${results.length} 条` }}</small></div>
    <div v-if="results.length" class="data-list"><button v-for="result in results" :key="`${result.path}:${result.item.databaseId}`" type="button" @click="router.push({ path: `/${result.path}`, query: { keyword } })"><span class="list-icon"><AdminIcon name="search" :size="19" /></span><div><strong>{{ result.item.title }}</strong><small>{{ result.domain }} · {{ result.item.summary }}</small><p><AdminStatusTag :status="result.item.status" /><span>{{ result.item.slug }}</span></p></div></button></div>
    <div v-else-if="!loading" class="admin-empty"><span><AdminIcon name="search" :size="24" /></span><strong>没有匹配内容</strong><small>请调整关键词或确认当前账号领域权限。</small></div>
  </section>
</template>
