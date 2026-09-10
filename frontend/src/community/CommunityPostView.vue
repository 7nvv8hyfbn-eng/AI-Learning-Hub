<script setup lang="ts">
import CommunityUserBadges from './CommunityUserBadges.vue'
import CommunityAvatar from '../components/base/CommunityAvatar.vue'
import AppIcon from '../components/base/AppIcon.vue'
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import type { CommunityCommentDto, CommunityCommentPageDto, CommunityOperation, CommunityPostDetailDto } from '@ai-learning-hub/contracts'
import { communityApi } from '../services/api/community'
import { useAuthStore } from '../stores/auth'
import { useCommunityStore } from '../stores/community'
import CommunityPostCard from './CommunityPostCard.vue'
import CommunityBlocks from './CommunityBlocks.vue'
import CommunityReportDialog from './CommunityReportDialog.vue'
import CommunityPostMenu from './CommunityPostMenu.vue'
import CommunityModerationMenuItems from './CommunityModerationMenuItems.vue'
import { moderatorActionsFor } from './moderation'
import { contentDetectionNotice } from './labels'
import { useCommunityAccess } from './composables/useCommunityAccess'
const route = useRoute(), auth = useAuthStore(), store = useCommunityStore()
const { canComment, decision, requireWrite } = useCommunityAccess()
const commentDecision = computed(() => decision('comment'))
const props = withDefaults(defineProps<{ postId?: string; discussionOnly?: boolean }>(), { discussionOnly: false })
const post = ref<CommunityPostDetailDto | null>(null), roots = ref<CommunityCommentDto[]>([]), body = ref(''), replyTo = ref<CommunityCommentDto | null>(null), editId = ref(''), error = ref(''), pending = ref(false)
const nextCursor = ref<string | null>(null), replies = ref<Record<string, CommunityCommentPageDto>>({}), loadingComments = ref(false), loadingReplies = ref<Record<string, boolean>>({})
const comments = computed(() => roots.value.flatMap((root) => [root, ...(replies.value[root.id]?.items || [])]))
let loadEpoch = 0
const notice = ref(''), reportOpen = ref(false), reportId = ref('')
const mergeComments = (current: CommunityCommentDto[], incoming: CommunityCommentDto[]) => [...new Map([...current, ...incoming].map((comment) => [comment.id, comment])).values()].sort((a, b) => a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
const load = async () => {
  const epoch = ++loadEpoch
  roots.value = []; replies.value = {}; nextCursor.value = null; loadingComments.value = false; loadingReplies.value = {}; error.value = ''
  try {
    const loaded = await communityApi.post(props.postId || String(route.params.postId))
    const page = ['draft', 'pending_review'].includes(loaded.status) ? { items: [], nextCursor: null } : await communityApi.comments(loaded.id)
    if (epoch !== loadEpoch) return
    post.value = loaded; roots.value = page.items; nextCursor.value = page.nextCursor
    store.syncAuthors([loaded.author, ...page.items.map(comment => comment.author)])
    const focusId = route.hash.startsWith('#comment-') ? route.hash.slice(9) : loaded.question?.acceptedCommentId
    if (focusId && !comments.value.some((c) => c.id === focusId)) {
      try {
        const focused = await communityApi.commentDetail(loaded.id, focusId)
        const parent = focused.parentId ? await communityApi.commentDetail(loaded.id, focused.parentId) : focused
        if (epoch !== loadEpoch) return
        roots.value = mergeComments(roots.value, [parent])
        if (focused.parentId) replies.value[parent.id] = { items: [focused], nextCursor: null }
      } catch { /* 目标已不可见时继续显示可读讨论。 */ }
    }
    await nextTick()
    if (epoch === loadEpoch && route.hash) document.getElementById(route.hash.slice(1))?.scrollIntoView({ block: 'center' })
  } catch (cause) { if (epoch === loadEpoch) { post.value = null; error.value = cause instanceof Error ? cause.message : '动态读取失败' } }
}
const loadComments = async (parentId?: string) => {
  if (!post.value || (parentId ? loadingReplies.value[parentId] : loadingComments.value)) return
  const epoch = loadEpoch, id = post.value.id
  if (parentId) loadingReplies.value[parentId] = true
  else loadingComments.value = true
  try {
    const cursor = parentId ? replies.value[parentId]?.nextCursor : nextCursor.value
    const page = await communityApi.comments(id, { parentId, ...(cursor ? { cursor } : {}) })
    if (epoch !== loadEpoch) return
    store.syncAuthors(page.items.map(comment => comment.author))
    if (parentId) replies.value[parentId] = { ...page, items: mergeComments(replies.value[parentId]?.items || [], page.items) }
    else { roots.value = mergeComments(roots.value, page.items); nextCursor.value = page.nextCursor }
  } catch (cause) { if (epoch === loadEpoch) error.value = cause instanceof Error ? cause.message : '评论读取失败' }
  finally { if (epoch === loadEpoch) { if (parentId) loadingReplies.value[parentId] = false; else loadingComments.value = false } }
}
const act = async (action: () => Promise<unknown>, operation: CommunityOperation = 'comment', comment?: CommunityCommentDto) => {
  if (!requireWrite(operation) || !post.value || pending.value) return
  const epoch = loadEpoch, postId = post.value.id
  pending.value = true; notice.value = ''
  try {
    await action()
    const updated = comment ? await communityApi.commentDetail(postId, comment.id) : null
    const loaded = await communityApi.post(postId)
    if (epoch !== loadEpoch) return
    post.value = loaded
    if (updated) {
      if (updated.parentId) replies.value[updated.parentId].items = mergeComments(replies.value[updated.parentId].items, [updated])
      else roots.value = mergeComments(roots.value, [updated])
    }
    for (const row of comments.value) row.accepted = !row.deleted && row.id === loaded.question?.acceptedCommentId
    error.value = ''
  } catch (cause) { if (epoch === loadEpoch) error.value = cause instanceof Error ? cause.message : '操作失败' }
  finally { pending.value = false }
}
const edit = (comment: CommunityCommentDto) => { if (!requireWrite('comment')) return; editId.value = comment.id; body.value = comment.contentBlocks.filter((block) => block.type === 'paragraph').map((block) => block.text).join('\n'); replyTo.value = null }
const reply = (comment: CommunityCommentDto) => { if (!requireWrite('comment')) return; replyTo.value = comment; editId.value = ''; body.value = '' }
const submit = () => act(async () => {
  const epoch = loadEpoch
  const retainedBlocks = comments.value.find((comment) => comment.id === editId.value)?.contentBlocks.filter((block) => block.type !== 'paragraph') || []
  const saved = await communityApi.comment(post.value!.id, { expectedRevision: comments.value.find((c) => c.id === editId.value)?.revision, contentBlocks: [{ type: 'paragraph', text: body.value }, ...retainedBlocks], ...(replyTo.value ? { parentId: replyTo.value.id } : {}) }, editId.value || undefined)
  if (epoch !== loadEpoch) return
  if (saved.parentId) {
    const page = replies.value[saved.parentId]
    replies.value[saved.parentId] = { items: mergeComments(page?.items || [], [saved]), nextCursor: page?.nextCursor || null }
    const parent = roots.value.find((c) => c.id === saved.parentId)
    if (parent && !editId.value) parent.replyCount = (parent.replyCount || 0) + 1
  } else roots.value = mergeComments(roots.value, [saved])
  notice.value = contentDetectionNotice(saved.detection) || (saved.status === 'pending_review' ? '评论已保存，等待人工复核，尚未公开。' : '评论已保存。')
  body.value = ''; editId.value = ''; replyTo.value = null
})
watch(() => props.postId || route.fullPath, () => { notice.value = ''; void load() }, { immediate: true })
onBeforeUnmount(() => { loadEpoch++ })
</script>
<template><section><header v-if="!discussionOnly" class="community-page-heading"><RouterLink :to="store.lastFeedLocation"><AppIcon name="arrow-left" :size="15" />返回社区</RouterLink><h1>学习讨论</h1></header><p v-if="error" class="community-error" role="alert">{{ error }} <button @click="load">重试</button></p><CommunityPostCard v-if="post && !discussionOnly" :post="post" detail @changed="load" @hidden="post = null" />
  <p v-if="notice" class="community-notice" role="status">{{ notice }}</p>
  <section v-if="post && !['draft', 'pending_review'].includes(post.status)" class="community-discussion"><h2>{{ post.type === 'question' ? '回答与交流' : '学习讨论' }} · {{ post.stats.comments }}</h2><div v-if="post.question?.acceptedCommentId" class="accepted-notice"><AppIcon name="check" :size="15" />已采纳回答：{{ comments.find((c) => c.id === post?.question?.acceptedCommentId)?.body }}</div>
    <article v-for="comment in comments" :id="`comment-${comment.id}`" :key="comment.id" class="community-comment" :class="{ reply: comment.parentId, accepted: comment.accepted }"><header><CommunityAvatar :src="comment.author.avatar" :username="comment.author.username" :name="comment.author.displayName" size="sm" /><strong>{{ comment.author.displayName }}</strong><CommunityUserBadges :badges="comment.author.badges" :verified-type="comment.author.verifiedType" /><span v-if="comment.accepted" class="community-badge">已采纳</span><CommunityPostMenu v-if="!comment.deleted && moderatorActionsFor(auth.user, post.contribution ? 'tutorials' : 'community', comment.author.id).length" label="评论管理操作"><CommunityModerationMenuItems target-type="comment" :target-id="comment.id" :author-id="comment.author.id" :scope="post.contribution ? 'tutorials' : 'community'" @decided="load" /></CommunityPostMenu></header><p v-if="comment.deleted" class="muted">{{ comment.body }}</p><CommunityBlocks v-else :blocks="comment.contentBlocks" /><p v-if="contentDetectionNotice(comment.detection)" class="community-notice" role="status">{{ contentDetectionNotice(comment.detection) }}</p><footer v-if="!comment.deleted"><template v-if="comment.status !== 'pending_review'"><button v-if="!comment.parentId" class="text-link" @click="reply(comment)">回复</button><button class="text-link" @click="act(() => communityApi.commentLike(comment.id, !comment.liked), comment.liked ? 'read' : 'interaction', comment)">{{ comment.liked ? '已赞' : '赞' }} {{ comment.likes || '' }}</button><button v-if="post.type === 'question' && post.author.id === auth.user?.id && !comment.accepted" class="text-link" @click="act(() => communityApi.accept(post!.id, comment.id), 'comment', comment)">采纳回答</button></template><template v-if="comment.author.id === auth.user?.id"><button class="text-link" @click="edit(comment)">编辑</button><button class="text-link" @click="act(() => communityApi.removeComment(comment.id), 'read', comment)">删除</button></template><button v-else class="text-link" @click="requireWrite('report') && (reportId = comment.id, reportOpen = true)">举报</button></footer><button v-if="!comment.parentId && comment.replyCount && (replies[comment.id]?.nextCursor || (replies[comment.id]?.items.length || 0) < comment.replyCount)" class="text-link" :disabled="loadingReplies[comment.id]" @click="loadComments(comment.id)">{{ loadingReplies[comment.id] ? '正在读取…' : replies[comment.id] ? '加载更多回复' : `查看 ${comment.replyCount} 条回复` }}</button></article>
    <button v-if="nextCursor" class="button small" :disabled="loadingComments" @click="loadComments()">{{ loadingComments ? '正在读取…' : '加载更多评论' }}</button>
    <form v-if="canComment" class="dialog-form community-reply-form" @submit.prevent="submit"><h3>{{ editId ? '编辑评论' : replyTo ? `回复 ${replyTo.author.displayName}` : post.type === 'question' ? '写下你的回答' : '参与讨论' }}</h3><button v-if="editId || replyTo" type="button" class="text-link" @click="editId = ''; replyTo = null; body = ''">取消编辑或回复</button><textarea v-model="body" rows="4" minlength="5" maxlength="6000" required placeholder="带上适用条件和验证方法，让回答更有帮助。" /><button class="button primary" :disabled="pending || post.status !== 'published'">{{ pending ? '正在提交…' : editId ? '保存评论' : '发布回答或评论' }}</button></form>
    <div v-else class="community-notice"><p>{{ commentDecision.message }}</p><RouterLink v-if="commentDecision.nextAction" class="button primary small" :to="commentDecision.nextAction.route">{{ commentDecision.nextAction.label }}</RouterLink></div>
  </section>
<CommunityReportDialog v-model="reportOpen" target-type="comment" :target-id="reportId" @submitted="notice = '举报已提交，可在处理与申诉查看进度。'" /></section></template>
