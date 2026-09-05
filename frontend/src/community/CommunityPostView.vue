<script setup lang="ts">
import CommunityAvatar from '../components/base/CommunityAvatar.vue'
import AppIcon from '../components/base/AppIcon.vue'
import { nextTick, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import type { CommunityCommentDto, CommunityPostDetailDto } from '@ai-learning-hub/contracts'
import { communityApi } from '../services/api/community'
import { useAuthStore } from '../stores/auth'
import { useCommunityStore } from '../stores/community'
import CommunityPostCard from './CommunityPostCard.vue'
import CommunityBlocks from './CommunityBlocks.vue'
import { badgeLabels } from './labels'
const route = useRoute(), auth = useAuthStore(), store = useCommunityStore()
const post = ref<CommunityPostDetailDto | null>(null), comments = ref<CommunityCommentDto[]>([]), body = ref(''), replyTo = ref<CommunityCommentDto | null>(null), editId = ref(''), error = ref(''), pending = ref(false)
const load = async () => { try { post.value = await communityApi.post(String(route.params.postId)); comments.value = await communityApi.comments(post.value.id); error.value = ''; await nextTick(); if (route.hash) document.getElementById(route.hash.slice(1))?.scrollIntoView({ block: 'center' }) } catch (cause) { post.value = null; error.value = cause instanceof Error ? cause.message : '动态读取失败' } }
const act = async (action: () => Promise<unknown>) => { pending.value = true; try { await action(); await load() } catch (cause) { error.value = cause instanceof Error ? cause.message : '操作失败' } finally { pending.value = false } }
const edit = (comment: CommunityCommentDto) => { editId.value = comment.id; body.value = comment.contentBlocks.filter((block) => block.type === 'paragraph').map((block) => block.text).join('\n'); replyTo.value = null }
const submit = () => act(async () => {
  const retainedBlocks = comments.value.find((comment) => comment.id === editId.value)?.contentBlocks.filter((block) => block.type !== 'paragraph') || []
  await communityApi.comment(post.value!.id, { expectedRevision: comments.value.find((c) => c.id === editId.value)?.revision, contentBlocks: [{ type: 'paragraph', text: body.value }, ...retainedBlocks], ...(replyTo.value ? { parentId: replyTo.value.id } : {}) }, editId.value || undefined)
  body.value = ''; editId.value = ''; replyTo.value = null
})
watch(() => route.fullPath, load, { immediate: true })
</script>
<template><section><header class="community-page-heading"><RouterLink :to="store.lastFeedLocation"><AppIcon name="arrow-left" :size="15" />返回社区</RouterLink><h1>学习讨论</h1></header><p v-if="error" class="community-error" role="alert">{{ error }} <button @click="load">重试</button></p><CommunityPostCard v-if="post" :post="post" detail @changed="load" @hidden="post = null" />
  <section v-if="post && post.status !== 'draft'" class="community-discussion"><h2>{{ post.type === 'question' ? '回答与交流' : '学习讨论' }} · {{ post.stats.comments }}</h2><div v-if="post.question?.acceptedCommentId" class="accepted-notice"><AppIcon name="check" :size="15" />已采纳回答：{{ comments.find((c) => c.id === post?.question?.acceptedCommentId)?.body }}</div>
    <article v-for="comment in comments" :id="`comment-${comment.id}`" :key="comment.id" class="community-comment" :class="{ reply: comment.parentId, accepted: comment.accepted }"><header><CommunityAvatar :src="comment.author.avatar" :username="comment.author.username" :name="comment.author.displayName" size="sm" /><strong>{{ comment.author.displayName }}</strong><small>{{ badgeLabels[comment.author.verifiedType] }}</small><span v-if="comment.accepted" class="community-badge">已采纳</span></header><p v-if="comment.deleted" class="muted">{{ comment.body }}</p><CommunityBlocks v-else :blocks="comment.contentBlocks" /><footer v-if="!comment.deleted"><button v-if="!comment.parentId" class="text-link" @click="replyTo = comment; editId = ''; body = ''">回复</button><button class="text-link" @click="act(() => communityApi.commentLike(comment.id, !comment.liked))">{{ comment.liked ? '已赞' : '赞' }} {{ comment.likes || '' }}</button><button v-if="post.type === 'question' && post.author.id === auth.user?.id && !comment.accepted" class="text-link" @click="act(() => communityApi.accept(post!.id, comment.id))">采纳回答</button><template v-if="comment.author.id === auth.user?.id"><button class="text-link" @click="edit(comment)">编辑</button><button class="text-link" @click="act(() => communityApi.removeComment(comment.id))">删除</button></template><button v-else class="text-link" @click="act(() => communityApi.report(comment.id, '不当评论', '请求人工复核讨论内容', true))">举报</button></footer></article>
    <form class="dialog-form community-reply-form" @submit.prevent="submit"><h3>{{ editId ? '编辑评论' : replyTo ? `回复 ${replyTo.author.displayName}` : post.type === 'question' ? '写下你的回答' : '参与讨论' }}</h3><button v-if="editId || replyTo" type="button" class="text-link" @click="editId = ''; replyTo = null; body = ''">取消编辑或回复</button><textarea v-model="body" rows="4" minlength="5" maxlength="6000" required placeholder="带上适用条件和验证方法，让回答更有帮助。" /><button class="button primary" :disabled="pending || post.status !== 'published'">{{ pending ? '正在提交…' : editId ? '保存评论' : '发布回答或评论' }}</button></form>
  </section>
</section></template>
