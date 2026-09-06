<script setup lang="ts">
import CommunityAvatar from '../components/base/CommunityAvatar.vue'
import AppIcon from '../components/base/AppIcon.vue'
import CommunityEmptyState from './CommunityEmptyState.vue'
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import type { CommunitySearchResultDto, CommunitySearchType } from '@ai-learning-hub/contracts'
import { communityApi } from '../services/api/community'
import CommunityPostCard from './CommunityPostCard.vue'
import CommunitySkeleton from './CommunitySkeleton.vue'
import { useAuthStore } from '../stores/auth'
import { useCommunityStore } from '../stores/community'
const route = useRoute(), router = useRouter(), keyword = ref(String(route.query.q || '')), loading = ref(false), error = ref(''), result = ref<CommunitySearchResultDto>()
const auth = useAuthStore(), store = useCommunityStore(), searchInput = ref<HTMLInputElement>(), recent = ref<string[]>([])
const historyKey = () => `community-search:${auth.user?.id || 'anonymous'}`
const labels: Record<CommunitySearchType, string> = { all: '综合', posts: '动态', users: '用户', topics: '话题', courses: '课程', labs: '实训', resources: '资源', articles: 'AI 前沿' }
const type = computed<CommunitySearchType>(() => String(route.query.type || '') in labels ? route.query.type as CommunitySearchType : 'all')
const kinds = ['courses', 'labs', 'resources', 'articles'] as const
let epoch = 0
const load = async (more = false) => {
  const current = ++epoch; loading.value = true; error.value = ''
  try {
    const next = route.query.bindingId ? { posts: await communityApi.list('posts', '', new URLSearchParams({ bindingId: String(route.query.bindingId) }).toString()), users: [], topics: [], courses: [], labs: [], resources: [], articles: [], nextCursor: null } : await communityApi.search(String(route.query.q || ''), type.value, more ? result.value?.nextCursor || undefined : undefined)
    if (!route.query.q && !route.query.bindingId) {
      if (type.value === 'topics') next.topics = await communityApi.topics()
    }
    if (current !== epoch) return
    if (more && result.value) for (const key of ['posts', 'users', 'topics', ...kinds] as const) Object.assign(next, { [key]: [...result.value[key], ...next[key]] })
    result.value = next
  } catch (cause) { if (current === epoch) error.value = cause instanceof Error ? cause.message : '搜索失败' } finally { if (current === epoch) loading.value = false }
}
const selectType = (value: CommunitySearchType) => {
  const q = keyword.value.trim()
  if (q) { recent.value = [q, ...recent.value.filter((item) => item !== q)].slice(0, 8); try { localStorage.setItem(historyKey(), JSON.stringify(recent.value)) } catch { /* 不要求用户开启本地存储。 */ } }
  return router.push({ path: '/community/search', query: { q, type: value } })
}
const clear = () => { keyword.value = ''; void selectType(type.value); searchInput.value?.focus({ preventScroll: true }) }
const escape = () => { if (keyword.value) clear(); else void router.push(store.lastFeedLocation) }
const link = (kind: typeof kinds[number], id: string) => kind === 'courses' ? `/courses/${id}` : kind === 'labs' ? `/labs/${id}` : kind === 'resources' ? `/resources?preview=${id}` : `/frontier?article=${id}`
const record = (kind: typeof kinds[number], id: string) => { const targetType = ({ courses: 'course', labs: 'lab', resources: 'resource', articles: 'article' } as const)[kind]; void communityApi.signals({ eventType: `community_search_to_${targetType}`, targetType, targetId: id }).catch(() => undefined) }
const empty = computed(() => result.value && !['posts', 'users', 'topics', ...kinds].some((key) => result.value![key as Exclude<keyof CommunitySearchResultDto, 'nextCursor'>].length))
watch(() => route.fullPath, () => { keyword.value = String(route.query.q || ''); void load() }, { immediate: true })
onMounted(() => { try { const values: unknown = JSON.parse(localStorage.getItem(historyKey()) || '[]'); recent.value = Array.isArray(values) ? values.filter((value): value is string => typeof value === 'string').slice(0, 8) : [] } catch { recent.value = [] }; searchInput.value?.focus({ preventScroll: true }) })
onBeforeUnmount(() => { epoch++ })
</script>
<template><section><header class="community-page-heading"><div><h1>{{ route.query.bindingId ? '相关学习讨论' : '搜索学习社区' }}</h1><p>让内容、同行者和学习资源连在一起。</p></div></header><form class="community-search" @submit.prevent="selectType(type)" @keydown.esc.prevent="escape"><input ref="searchInput" v-model="keyword" placeholder="搜索动态、用户、话题与学习内容" aria-label="搜索关键词" maxlength="120" /><button v-if="keyword" class="icon-button" type="button" aria-label="清除搜索" @click="clear"><AppIcon name="close" :size="17" /></button><button class="button primary small">搜索</button></form><div v-if="recent.length && !keyword" class="community-recent-search"><small>最近搜索</small><button v-for="item in recent" :key="item" class="community-chip" @click="keyword = item; selectType(type)">{{ item }}</button></div><nav v-if="!route.query.bindingId" class="community-feed-tabs search-tabs"><button v-for="(label, value) in labels" :key="value" :aria-selected="type === value" @click="selectType(value)">{{ label }}</button></nav><CommunitySkeleton v-if="loading && !result" /><p v-if="error" class="community-error" role="alert">{{ error }} <button @click="load()">重新搜索</button></p><template v-if="result"><section v-if="result.posts.length"><header class="search-section-heading"><h2>动态</h2><button v-if="type === 'all'" class="text-link" @click="selectType('posts')">查看全部动态</button></header><CommunityPostCard v-for="post in result.posts" :key="post.id" :post="post" @changed="load()" @hidden="load()" /></section><section v-for="key in (['users', 'topics'] as const)" :key="key"><header v-if="result[key].length" class="search-section-heading"><h2>{{ labels[key] }}</h2><button v-if="type === 'all'" class="text-link" @click="selectType(key)">查看全部{{ labels[key] }}</button></header><RouterLink v-for="row in result[key]" :key="row.id" class="community-binding" :to="'username' in row ? `/community/user/${row.username}` : `/community/topic/${row.slug}`"><CommunityAvatar v-if="'username' in row" :src="row.avatar" :username="row.username" :name="row.displayName" size="sm" />{{ 'displayName' in row ? row.displayName : `# ${row.name}` }}</RouterLink></section><section v-for="kind in kinds" :key="kind"><header v-if="result[kind].length" class="search-section-heading"><h2>{{ labels[kind] }}</h2><button v-if="type === 'all'" class="text-link" @click="selectType(kind)">查看全部{{ labels[kind] }}</button></header><RouterLink v-for="row in result[kind]" :key="row.id" class="community-binding search-learning-result" :to="link(kind, row.id)" @click="record(kind, row.id)"><strong>{{ row.title }}</strong><p>{{ row.summary }}</p><small>进入{{ labels[kind] }} <AppIcon name="arrow-up-right" :size="14" /></small></RouterLink></section><button v-if="result.nextCursor" class="button secondary" :disabled="loading" @click="load(true)">加载更多</button><CommunityEmptyState v-if="empty && !loading" :title="keyword || route.query.bindingId ? '没有找到相关结果' : '从一个关键词开始'" description="试试课程名、学习方向或用户名。"><RouterLink class="button secondary" to="/community">返回社区发现</RouterLink></CommunityEmptyState></template></section></template>
