<script setup lang="ts">
import { computed, nextTick, ref } from 'vue'
import { useRouter } from 'vue-router'
import type { CommunityPostSummaryDto, CommunityBindingDto, CommunityOperation, CommunitySignalInput } from '@ai-learning-hub/contracts'
import { useAuthStore } from '../stores/auth'
import { useCommunityStore } from '../stores/community'
import { communityApi } from '../services/api/community'
import AppDialog from '../components/base/AppDialog.vue'
import AppIcon from '../components/base/AppIcon.vue'
import CommunityAvatar from '../components/base/CommunityAvatar.vue'
import CommunityBindingCard from './CommunityBindingCard.vue'
import CommunityQuotePreview from './CommunityQuotePreview.vue'
import CommunityBlocks from './CommunityBlocks.vue'
import CommunityPostMenu from './CommunityPostMenu.vue'
import CommunityModerationMenuItems from './CommunityModerationMenuItems.vue'
import CommunityReportDialog from './CommunityReportDialog.vue'
import { postLabels, badgeLabels, relativeTime, contentDetectionNotice } from './labels'
import { useCommunityAccess } from './composables/useCommunityAccess'
import { useCommunityScrollRoot } from './composables/useCommunityScrollRoot'
import { usePostImpression } from './composables/usePostImpression'
import { formatPostViews } from './postPreview'
const props = defineProps<{ post: CommunityPostSummaryDto; detail?: boolean; requestId?: string; showPin?: boolean; pinned?: boolean }>()
const emit = defineEmits<{ changed: []; hidden: [id: string]; pin: [id: string | null] }>()
const auth = useAuthStore(), store = useCommunityStore(), router = useRouter()
const cardRoot = ref<HTMLElement>(), impressionTarget = ref<HTMLElement>(), scrollRoot = useCommunityScrollRoot()
usePostImpression(impressionTarget, () => props.post, () => props.requestId)
const { requireWrite } = useCommunityAccess()
const moderatedHidden = ref(false)
const moderated = (action: string) => { if (action === 'takedown' || action === 'ban') { moderatedHidden.value = true; emit('hidden', props.post.id) }; emit('changed') }
const followingAuthor = computed(() => store.authorFollowing[props.post.author.id] ?? props.post.viewerState.followingAuthor)
const detectionNotice = computed(() => contentDetectionNotice(props.post.detection) || (props.post.status === 'pending_review' ? '投稿已保存，等待人工复核，尚未公开。' : ''))
const pending = ref(false), error = ref(''), reportOpen = ref(false), deleteOpen = ref(false), unpublishOpen = ref(false), expanded = ref(false), overflowed = ref(false)
const act = async (action: () => Promise<unknown>, refresh = true, operation: CommunityOperation = 'interaction') => { if (!requireWrite(operation)) return; pending.value = true; error.value = ''; try { await action(); if (refresh) emit('changed') } catch (cause) { error.value = cause instanceof Error ? cause.message : '操作失败' } finally { pending.value = false } }
const openAction = (target: 'report' | 'delete' | 'unpublish') => {
  if (!requireWrite(target === 'report' ? 'report' : 'read')) return
  if (target === 'report') reportOpen.value = true
  else if (target === 'delete') deleteOpen.value = true
  else unpublishOpen.value = true
}
const pin = () => { if (requireWrite(props.pinned ? 'read' : 'profile')) emit('pin', props.pinned ? null : props.post.id) }
const reaction = (kind: 'like' | 'bookmark') => {
  const active = kind === 'like' ? props.post.viewerState.liked : props.post.viewerState.bookmarked
  return act(() => store.react(props.post, kind), false, active ? 'read' : 'interaction')
}
const hide = (kind: 'hide' | 'not-interested' | 'mute' | 'block') => act(async () => { await communityApi.feedback(['mute', 'block'].includes(kind) ? props.post.author.id : props.post.id, kind); store.removePost(props.post.id, ['mute', 'block'].includes(kind) ? props.post.author.id : undefined); emit('hidden', props.post.id) }, false, 'read')
const remove = () => act(async () => { await communityApi.remove(props.post.id); deleteOpen.value = false; store.removePost(props.post.id); emit('hidden', props.post.id) }, false, 'read')
const unpublish = () => act(async () => { await communityApi.unpublish(props.post.id); unpublishOpen.value = false; store.removePost(props.post.id); emit('hidden', props.post.id) }, false, 'read')
const quotePost = () => { if (requireWrite('post')) store.openComposer({ quotedPostId: props.post.id }, undefined, { intent: 'quote' }) }
const edit = () => act(async () => { const post = await communityApi.post(props.post.id); store.openComposer({ expectedRevision: post.revision, type: post.type, title: post.title || '', coverFileId: post.coverFileId, contentBlocks: post.contentBlocks, bindings: post.bindings.filter((b) => b.status !== 'unavailable').map((b) => ({ type: b.type, id: b.id })), inlineReferences: post.inlineReferences?.map(({ kind, text, id }) => ({ kind, text, id })), quotedPostId: post.quotedPostId, topicIds: post.manualTopicIds || post.topics.map((t) => t.id), visibility: post.visibility, portalConsent: post.portalConsent === true, status: post.status === 'draft' ? 'draft' : 'published', contribution: post.contribution ? { kind: post.contribution.kind, categoryId: post.contribution.categoryId, tags: post.contribution.tags, teachingReuseConsent: post.contribution.teachingReuseConsent, sourceName: post.contribution.sourceName, sourceUrl: post.contribution.sourceUrl, videoAssetId: post.contribution.videoAssetId, attachmentFileId: post.contribution.attachmentFileId, coverFileId: post.contribution.coverFileId } : undefined }, post.id) }, true, 'read')
const openPost = () => { void communityApi.signals({ eventType: 'community_post_click', targetType: 'post', targetId: props.post.id, requestId: props.requestId }).catch(() => undefined) }
const bodyClick = (event: MouseEvent) => {
  if (props.detail || (event.target as HTMLElement).closest('a, button, input, textarea, select, pre, code') || window.getSelection()?.toString()) return
  openPost(); void router.push(`/community/post/${props.post.id}`)
}
const toggleExpanded = async () => {
  expanded.value = !expanded.value
  if (expanded.value) void communityApi.signals({ eventType: 'community_post_expand', targetType: 'post', targetId: props.post.id }).catch(() => undefined)
  else {
    await nextTick()
    const top = cardRoot.value?.getBoundingClientRect().top, rootTop = scrollRoot.value?.getBoundingClientRect().top || 0
    if (top !== undefined && top < rootTop) {
      if (scrollRoot.value) scrollRoot.value.scrollTop += top - rootTop
      else window.scrollBy({ top })
    }
  }
}
const bindingClick = (binding: CommunityBindingDto) => {
  const target = binding.type === 'lesson' ? 'course' : binding.type === 'lab_run' ? 'lab' : binding.type
  const eventType = ['course', 'lab', 'resource', 'article', 'challenge'].includes(target) ? `community_to_${target}` as CommunitySignalInput['eventType'] : 'community_binding_click'
  void communityApi.signals({ eventType, targetType: 'post', targetId: props.post.id, binding: { type: binding.type, id: binding.id }, requestId: props.requestId }).catch(() => undefined)
}
</script>
<template><article v-if="!moderatedHidden" ref="cardRoot" class="community-post" :class="{ 'post-detail': detail }" :data-post-id="post.id">
  <header class="community-post-header"><RouterLink class="author-avatar-link" :to="`/community/user/${post.author.username}`"><CommunityAvatar :src="post.author.avatar" :username="post.author.username" :name="post.author.displayName" /></RouterLink><div class="community-author"><RouterLink :to="`/community/user/${post.author.username}`"><strong>{{ post.author.displayName }}</strong><span v-if="post.author.verifiedType !== 'none'" class="community-badge">{{ badgeLabels[post.author.verifiedType] }}</span></RouterLink><small>{{ post.author.school || post.author.major || '学习社区' }} · <RouterLink class="community-post-time" :to="`/community/post/${post.id}`" :title="new Date(post.publishedAt).toLocaleString('zh-CN')" @click="openPost">{{ relativeTime(post.publishedAt) }}</RouterLink><span v-if="post.editedAt"> · 已编辑</span></small></div><span class="community-type" :class="post.type">{{ postLabels[post.type] }}</span><CommunityPostMenu><button v-if="post.author.id !== auth.user?.id" type="button" role="menuitem" :disabled="store.operations[`follow:user:${post.author.id}`]" @click="act(() => store.follow(post.author.id, false, !followingAuthor, undefined, post), false, followingAuthor ? 'read' : 'interaction')">{{ followingAuthor ? '取消关注' : '关注作者' }}</button><template v-if="post.author.id === auth.user?.id"><button v-if="showPin && post.status === 'published' && post.visibility === 'public'" type="button" role="menuitem" @click="pin">{{ pinned ? '取消置顶' : '置顶到个人主页' }}</button><button type="button" role="menuitem" @click="edit">编辑动态</button><button v-if="post.contribution && post.status === 'published'" type="button" role="menuitem" @click="openAction('unpublish')">下架为草稿</button><button type="button" role="menuitem" @click="openAction('delete')">删除动态</button></template><button type="button" role="menuitem" @click="hide('hide')">隐藏此内容</button><button type="button" role="menuitem" @click="hide('not-interested')">减少此类内容</button><template v-if="post.author.id !== auth.user?.id"><button type="button" role="menuitem" @click="hide('mute')">静音作者</button><button type="button" role="menuitem" @click="hide('block')">屏蔽作者</button></template><button type="button" role="menuitem" @click="openAction('report')">举报内容</button><CommunityModerationMenuItems :target-type="post.contribution ? 'resource' : 'post'" :target-id="post.id" :author-id="post.author.id" :scope="post.contribution ? 'tutorials' : 'community'" @decided="moderated" /></CommunityPostMenu></header>
  <div v-if="post.question" class="question-state"><span :class="{ solved: post.question.status === 'solved' }"><AppIcon v-if="post.question.status === 'solved'" name="check" :size="14" />{{ post.question.status === 'solved' ? '已解决' : '等待回答' }}</span><small v-if="post.question.teacherAnswered">认证教师参与回答</small></div>
  <h2 v-if="post.title" class="community-post-title"><RouterLink :to="`/community/post/${post.id}`" @click="openPost">{{ post.title }}</RouterLink></h2>
  <div class="community-post-preview" :class="{ 'community-post-body': !detail }" @click="bodyClick"><span ref="impressionTarget" class="community-view-target" aria-hidden="true" /><CommunityBlocks :blocks="post.contentBlocks" :references="post.inlineReferences" post :compact="!detail && !expanded" @overflow="overflowed = $event"><template #after-text><button v-if="!detail && (overflowed || expanded)" class="text-link post-expand" type="button" :aria-expanded="expanded" @click.stop="toggleExpanded">{{ expanded ? '收起' : '展开全文' }}</button></template></CommunityBlocks></div>
  <CommunityQuotePreview v-if="post.quotedPostId" :post="post.quotedPost || { id: post.quotedPostId, available: false }" />
  <div v-if="post.bindings.length" class="community-bindings"><CommunityBindingCard v-for="binding in post.bindings" :key="`${binding.type}:${binding.id}`" :binding="binding" @click="binding.route && bindingClick(binding)" /></div>
  <div v-if="post.topics.length || post.visibility === 'school' || post.status === 'draft'" class="community-topic-list"><RouterLink v-for="topic in post.topics" :key="topic.id" :to="`/community/topic/${topic.slug}`"># {{ topic.name }}</RouterLink><span v-if="post.visibility === 'school'" class="muted">仅同校可见</span><span v-if="post.status === 'draft'" class="muted">私人草稿</span></div>
  <p v-if="detectionNotice" class="community-notice" role="status">{{ detectionNotice }}</p>
  <p v-for="label in post.labels" :key="label" class="community-notice">{{ label }}</p><p v-if="post.recommendationReasons.length" class="recommendation-reason">{{ post.recommendationReasons.join(' · ') }}</p>
  <footer v-if="!['draft', 'pending_review'].includes(post.status)" class="community-interactions">
    <RouterLink :to="`/community/post/${post.id}`" :aria-label="`评论 ${post.stats.comments}`" @click="openPost"><AppIcon name="message" :size="18" /><span>{{ post.stats.comments || '评论' }}</span></RouterLink>
    <button :aria-label="`引用 ${post.stats.quotes || 0}`" :disabled="post.status !== 'published' || post.visibility !== 'public'" @click.stop="quotePost"><AppIcon name="lab-share" :size="18" /><span>{{ post.stats.quotes || '引用' }}</span></button>
    <button :class="{ selected: post.viewerState.liked }" :aria-pressed="post.viewerState.liked" :aria-label="`点赞 ${post.stats.likes}`" :disabled="store.operations[`${post.id}:like`]" @click="reaction('like')"><AppIcon name="heart" :size="18" /><span>{{ post.stats.likes || '点赞' }}</span></button>
    <span class="community-view-count" :aria-label="`浏览量 ${post.stats.views || 0}`" :title="`浏览量 ${post.stats.views || 0}（展示次数）`"><AppIcon name="post-views" :size="18" /><span>{{ formatPostViews(post.stats.views || 0) }}</span></span>
    <button :class="{ selected: post.viewerState.bookmarked }" :aria-pressed="post.viewerState.bookmarked" :aria-label="`收藏 ${post.stats.bookmarks}`" :disabled="store.operations[`${post.id}:bookmark`]" @click="reaction('bookmark')"><AppIcon name="bookmark" :size="18" /><span>{{ post.stats.bookmarks || '收藏' }}</span></button>
  </footer><RouterLink v-if="detail && post.stats.quotes" class="text-link" :to="`/community/post/${post.id}/quotes`">查看 {{ post.stats.quotes }} 条引用</RouterLink><p v-if="error" class="community-error" role="alert">{{ error }}</p>
  <CommunityReportDialog v-model="reportOpen" :target-type="post.contribution ? 'resource' : 'post'" :target-id="post.id" @submitted="emit('changed')" />
  <AppDialog v-model="unpublishOpen" title="下架自己的资源作品"><p>作品将从教程中心、社区、作者页和合集公开入口撤下，并保留为私人草稿，之后仍可编辑并重新发布。</p><button class="button primary" :disabled="pending" @click="unpublish">确认下架</button></AppDialog>
  <AppDialog v-model="deleteOpen" title="删除自己的动态"><p>动态将不再对社区显示，讨论记录保留用于审计。</p><button class="button primary" :disabled="pending" @click="remove">确认删除</button></AppDialog>
</article></template>
