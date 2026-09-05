<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'
import type { CommunityPostSummaryDto, CommunityBindingDto, CommunitySignalInput } from '@ai-learning-hub/contracts'
import { useAuthStore } from '../stores/auth'
import { useCommunityStore } from '../stores/community'
import { communityApi } from '../services/api/community'
import AppDialog from '../components/base/AppDialog.vue'
import AppIcon from '../components/base/AppIcon.vue'
import CommunityAvatar from '../components/base/CommunityAvatar.vue'
import CommunityBindingCard from './CommunityBindingCard.vue'
import CommunityBlocks from './CommunityBlocks.vue'
import CommunityPostMenu from './CommunityPostMenu.vue'
import { postLabels, badgeLabels, relativeTime } from './labels'
const props = defineProps<{ post: CommunityPostSummaryDto; detail?: boolean; requestId?: string; showPin?: boolean; pinned?: boolean }>()
const emit = defineEmits<{ changed: []; hidden: [id: string]; pin: [id: string | null] }>()
const auth = useAuthStore(), store = useCommunityStore(), router = useRouter()
const followingAuthor = computed(() => store.authorFollowing[props.post.author.id] ?? props.post.viewerState.followingAuthor)
const pending = ref(false), error = ref(''), reportOpen = ref(false), deleteOpen = ref(false), reason = ref('内容不准确'), description = ref(''), expanded = ref(false), overflowed = ref(false)
const act = async (action: () => Promise<unknown>, refresh = true) => { pending.value = true; error.value = ''; try { await action(); if (refresh) emit('changed') } catch (cause) { error.value = cause instanceof Error ? cause.message : '操作失败' } finally { pending.value = false } }
const reaction = (kind: 'like' | 'useful' | 'bookmark') => act(() => store.react(props.post, kind), false)
const hide = (kind: 'hide' | 'not-interested' | 'mute' | 'block') => act(async () => { await communityApi.feedback(['mute', 'block'].includes(kind) ? props.post.author.id : props.post.id, kind); store.removePost(props.post.id); emit('hidden', props.post.id) }, false)
const remove = () => act(async () => { await communityApi.remove(props.post.id); deleteOpen.value = false; store.removePost(props.post.id); emit('hidden', props.post.id) }, false)
const report = () => act(async () => { await communityApi.report(props.post.id, reason.value, description.value); reportOpen.value = false })
const edit = () => act(async () => { const post = await communityApi.post(props.post.id); store.openComposer({ expectedRevision: post.revision, type: post.type, title: post.title || '', contentBlocks: post.contentBlocks, bindings: post.bindings.filter((b) => b.status !== 'unavailable').map((b) => ({ type: b.type, id: b.id })), topicIds: post.topics.map((t) => t.id), visibility: post.visibility, status: post.status === 'draft' ? 'draft' : 'published' }, post.id) })
const openPost = () => { void communityApi.signals({ eventType: 'community_post_click', targetType: 'post', targetId: props.post.id, requestId: props.requestId }).catch(() => undefined) }
const bodyClick = (event: MouseEvent) => {
  if (props.detail || (event.target as HTMLElement).closest('a, button, input, textarea, select, pre, code') || window.getSelection()?.toString()) return
  openPost(); void router.push(`/community/post/${props.post.id}`)
}
const toggleExpanded = () => { expanded.value = !expanded.value; if (expanded.value) void communityApi.signals({ eventType: 'community_post_expand', targetType: 'post', targetId: props.post.id }).catch(() => undefined) }
const bindingClick = (binding: CommunityBindingDto) => {
  const target = binding.type === 'lesson' ? 'course' : binding.type === 'lab_run' ? 'lab' : binding.type
  const eventType = ['course', 'lab', 'resource', 'article', 'challenge'].includes(target) ? `community_to_${target}` as CommunitySignalInput['eventType'] : 'community_binding_click'
  void communityApi.signals({ eventType, targetType: 'post', targetId: props.post.id, binding: { type: binding.type, id: binding.id }, requestId: props.requestId }).catch(() => undefined)
}
</script>
<template><article class="community-post" :data-post-id="post.id">
  <header class="community-post-header"><RouterLink class="author-avatar-link" :to="`/community/user/${post.author.username}`"><CommunityAvatar :src="post.author.avatar" :username="post.author.username" :name="post.author.displayName" /></RouterLink><div class="community-author"><RouterLink :to="`/community/user/${post.author.username}`"><strong>{{ post.author.displayName }}</strong><span v-if="post.author.verifiedType !== 'none'" class="community-badge">{{ badgeLabels[post.author.verifiedType] }}</span></RouterLink><small>{{ post.author.school || post.author.major || '学习社区' }} · <RouterLink class="community-post-time" :to="`/community/post/${post.id}`" :title="new Date(post.publishedAt).toLocaleString('zh-CN')" @click="openPost">{{ relativeTime(post.publishedAt) }}</RouterLink><span v-if="post.editedAt"> · 已编辑</span></small></div><span class="community-type" :class="post.type">{{ postLabels[post.type] }}</span><CommunityPostMenu><button v-if="post.author.id !== auth.user?.id" type="button" role="menuitem" :disabled="store.operations[`follow:user:${post.author.id}`]" @click="act(() => store.follow(post.author.id, false, !followingAuthor, undefined, post), false)">{{ followingAuthor ? '取消关注' : '关注作者' }}</button><template v-if="post.author.id === auth.user?.id"><button v-if="showPin" type="button" role="menuitem" @click="$emit('pin', pinned ? null : post.id)">{{ pinned ? '取消置顶' : '置顶到个人主页' }}</button><button type="button" role="menuitem" @click="edit">编辑动态</button><button type="button" role="menuitem" @click="deleteOpen = true">删除动态</button></template><button type="button" role="menuitem" @click="hide('hide')">隐藏此内容</button><button type="button" role="menuitem" @click="hide('not-interested')">减少此类内容</button><template v-if="post.author.id !== auth.user?.id"><button type="button" role="menuitem" @click="hide('mute')">静音作者</button><button type="button" role="menuitem" @click="hide('block')">屏蔽作者</button></template><button type="button" role="menuitem" @click="reportOpen = true">举报内容</button></CommunityPostMenu></header>
  <div v-if="post.question" class="question-state"><span :class="{ solved: post.question.status === 'solved' }"><AppIcon v-if="post.question.status === 'solved'" name="check" :size="14" />{{ post.question.status === 'solved' ? '已解决' : '等待回答' }}</span><small v-if="post.question.teacherAnswered">认证教师参与回答</small></div>
  <h2 v-if="post.title" class="community-post-title"><RouterLink :to="`/community/post/${post.id}`" @click="openPost">{{ post.title }}</RouterLink></h2>
  <div :class="{ 'community-post-body': !detail }" @click="bodyClick"><CommunityBlocks :blocks="post.contentBlocks" :compact="!detail && !expanded" @overflow="overflowed = $event" /></div>
  <button v-if="!detail && (overflowed || expanded)" class="text-link" type="button" @click="toggleExpanded">{{ expanded ? '收起' : '展开全文' }}</button>
  <div class="community-bindings"><CommunityBindingCard v-for="binding in post.bindings" :key="`${binding.type}:${binding.id}`" :binding="binding" @click="binding.route && bindingClick(binding)" /></div>
  <div class="community-topic-list"><RouterLink v-for="topic in post.topics" :key="topic.id" :to="`/community/topic/${topic.slug}`"># {{ topic.name }}</RouterLink><span v-if="post.visibility === 'school'" class="muted">仅同校可见</span><span v-if="post.status === 'draft'" class="muted">私人草稿</span></div>
  <p v-for="label in post.labels" :key="label" class="community-notice">{{ label }}</p><p v-if="post.recommendationReasons.length" class="recommendation-reason">{{ post.recommendationReasons.join(' · ') }}</p>
  <footer class="community-interactions">
    <RouterLink :to="`/community/post/${post.id}`" :aria-label="`评论 ${post.stats.comments}`" @click="openPost"><AppIcon name="message" :size="18" /><span>{{ post.stats.comments || '评论' }}</span></RouterLink>
    <button :class="{ selected: post.viewerState.liked }" :aria-pressed="post.viewerState.liked" :aria-label="`点赞 ${post.stats.likes}`" :disabled="store.operations[`${post.id}:like`]" @click="reaction('like')"><AppIcon name="heart" :size="18" /><span>{{ post.stats.likes || '点赞' }}</span></button>
    <button :class="{ selected: post.viewerState.markedUseful }" :aria-pressed="post.viewerState.markedUseful" :aria-label="`有帮助 ${post.stats.useful}`" :disabled="store.operations[`${post.id}:useful`]" @click="reaction('useful')"><AppIcon name="check" :size="18" /><span>{{ post.stats.useful || '有帮助' }}</span></button>
    <button :class="{ selected: post.viewerState.bookmarked }" :aria-pressed="post.viewerState.bookmarked" :aria-label="`收藏 ${post.stats.bookmarks}`" :disabled="store.operations[`${post.id}:bookmark`]" @click="reaction('bookmark')"><AppIcon name="bookmark" :size="18" /><span>{{ post.stats.bookmarks || '收藏' }}</span></button>
  </footer><p v-if="error" class="community-error" role="alert">{{ error }}</p>
  <AppDialog v-model="reportOpen" title="举报内容"><form class="dialog-form" @submit.prevent="report"><label>举报原因<select v-model="reason"><option>内容不准确</option><option>不当内容或骚扰</option><option>泄露个人信息</option><option>垃圾广告</option><option>版权问题</option></select></label><label>补充说明<textarea v-model="description" maxlength="1000" rows="3" /></label><p>举报信息仅供有权限的审核人员处理，不向作者公开。</p><button class="button primary" :disabled="pending">提交举报</button></form></AppDialog>
  <AppDialog v-model="deleteOpen" title="删除自己的动态"><p>动态将不再对社区显示，讨论记录保留用于审计。</p><button class="button primary" :disabled="pending" @click="remove">确认删除</button></AppDialog>
</article></template>
