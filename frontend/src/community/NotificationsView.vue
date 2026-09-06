<script setup lang="ts">
import CommunityAvatar from '../components/base/CommunityAvatar.vue'
import AppIcon from '../components/base/AppIcon.vue'
import CommunityEmptyState from './CommunityEmptyState.vue'
import { computed, onMounted, ref } from 'vue'
import type { CommunityNotificationDto } from '@ai-learning-hub/contracts'
import { communityApi } from '../services/api/community'
import { useCommunityStore } from '../stores/community'
import CommunitySkeleton from './CommunitySkeleton.vue'
const store = useCommunityStore(), items = ref<CommunityNotificationDto[]>([]), tab = ref('interaction'), error = ref(''), loading = ref(false)
const visible = computed(() => items.value.filter((item) => tab.value === 'follow' ? item.type === 'follow' : tab.value === 'system' ? ['official', 'moderation'].includes(item.type) : !['follow', 'official', 'moderation'].includes(item.type)))
const load = async () => { const epoch = store.epoch; loading.value = true; error.value = ''; try { const result = await communityApi.notifications(); if (epoch !== store.epoch) return; items.value = result; store.unread = items.value.filter((n) => !n.readAt).length } catch (cause) { error.value = cause instanceof Error ? cause.message : '消息读取失败' } finally { loading.value = false } }
const read = async (id?: string) => { try { await communityApi.read(id); await load() } catch (cause) { error.value = cause instanceof Error ? cause.message : '标记失败' } }
onMounted(load)
</script>
<template><section><header class="community-page-heading"><div><span class="eyebrow">每一次回应，都是成长</span><h1>消息通知</h1><p>{{ store.unread }} 条未读</p></div><button class="button secondary small" @click="load">刷新</button><button class="text-link" @click="read()">全部已读</button></header>
  <div class="community-feed-tabs"><button v-for="[value, label] in [['interaction', '互动'], ['follow', '关注'], ['system', '系统']]" :key="value" :aria-selected="tab === value" @click="tab = value">{{ label }}</button></div>
  <p v-if="error" class="community-error" role="alert">{{ error }} <button @click="load">重试</button></p><CommunitySkeleton v-if="loading" :rows="3" />
  <article v-for="item in visible" v-else :key="item.id" class="community-notification" :class="{ unread: !item.readAt }"><CommunityAvatar :src="item.actor?.avatar" :username="item.actor?.username" :name="item.actor?.displayName || '平台通知'" :avatar-key="item.actor ? undefined : 'ai-learning-assistant'" /><div><strong>{{ item.count > 1 ? '' : item.actor?.displayName }} {{ item.text }}</strong><small>{{ new Date(item.createdAt).toLocaleString('zh-CN') }} · {{ item.source === 'platform' ? '平台公告' : '社区通知' }}</small><RouterLink v-if="item.entityType === 'post' && item.type !== 'moderation'" :to="`/community/post/${item.entityId}`" @click="read(item.id)">查看讨论 <AppIcon name="arrow-up-right" :size="14" /></RouterLink><RouterLink v-if="item.type === 'follow' && item.actor" :to="`/community/user/${item.actor.username}`">查看主页</RouterLink></div><button v-if="!item.readAt" class="text-link" @click="read(item.id)">标为已读</button></article>
  <CommunityEmptyState v-if="!visible.length && !loading && !error" title="暂时没有新消息" description="好的问题和有帮助的回答，会带来新的连接。"><RouterLink class="button secondary" to="/community">探索社区讨论</RouterLink></CommunityEmptyState>
</section></template>
