<script setup lang="ts">
import { nextTick, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { assistantArt } from '../assets/assistant/art'
import AppIcon from '../components/base/AppIcon.vue'
import { assistantState as state, closeAssistant, sendAssistantQuestion, requestAssistantDigest, showAssistantChat } from './assistantState'
const router = useRouter()
const draft = ref(''), input = ref<HTMLTextAreaElement>(), messages = ref<HTMLElement>(), panel = ref<HTMLElement>()
const questions = ['你能帮我做什么？', '帮我规划一条AI入门路线', '遇到问题时该怎么提问？']
function send() {
  if (!draft.value.trim() || state.busy) return
  const text = draft.value; draft.value = ''; void sendAssistantQuestion(text)
}
function keydown(event: KeyboardEvent) {
  if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) { event.preventDefault(); send() }
}
function openOriginal() {
  if (!state.digest) return
  const postId = state.digest.postId
  closeAssistant()
  void router.push(`/community/post/${encodeURIComponent(postId)}`)
}
const focusPanel = () => (input.value || panel.value)?.focus()
onMounted(focusPanel)
watch(() => state.view, async () => { await nextTick(); focusPanel() })
watch(() => state.messages.map(m => m.content + m.state).join(''), async () => { await nextTick(); messages.value?.scrollTo({ top: messages.value.scrollHeight }) })
</script>
<template>
  <section id="assistant-panel" ref="panel" class="assistant-panel" :class="`is-${state.config.position}`" role="dialog" tabindex="-1" aria-labelledby="assistant-title" @keydown.esc.stop.prevent="closeAssistant">
    <header><img :src="assistantArt.idle" alt="" width="44" height="44"><div><h2 id="assistant-title">{{ state.config.name }}</h2><span>陪你探索 AI 的学习伙伴</span></div><button class="icon-button" type="button" aria-label="关闭助手" @click="closeAssistant"><AppIcon name="close" :size="20" /></button></header>
    <div v-if="state.view === 'digest'" class="assistant-messages assistant-digest" aria-live="polite" :aria-busy="state.busy">
      <span class="assistant-digest-badge"><AppIcon name="sparkles" :size="15" />小雪简讯</span>
      <p v-if="state.busy" role="status">正在整理{{ state.digestTitle ? `《${state.digestTitle}》` : '这篇帖子' }}…</p>
      <template v-else-if="state.digest">
        <h3>{{ state.digest.title || '未命名帖子' }}</h3>
        <p>{{ state.digest.summary }}</p>
        <ul v-if="state.config.keywords && state.digest.keywords.length" class="assistant-digest-keywords" aria-label="关键词"><li v-for="keyword in state.digest.keywords" :key="keyword">{{ keyword }}</li></ul>
        <button class="text-link assistant-original" type="button" @click="openOriginal">查看原帖<AppIcon name="arrow-right" :size="16" /></button>
        <small>基于当前可读正文生成，请核对原文</small>
      </template>
      <template v-else-if="state.digestError">
        <p class="assistant-digest-error" role="alert">{{ state.digestError }}</p>
        <button class="button" type="button" @click="requestAssistantDigest(state.digestPostId, state.digestTitle)">重试简讯</button>
      </template>
    </div>
    <div v-else ref="messages" class="assistant-messages" aria-live="polite" :aria-busy="state.busy">
      <div class="assistant-welcome"><small>学习，从一个问题开始</small><h3>今天想探索什么？</h3><p>{{ state.config.welcome }}</p></div>
      <div class="assistant-questions"><button v-for="question in questions" :key="question" type="button" :disabled="state.busy" @click="sendAssistantQuestion(question)">{{ question }}</button></div>
      <article v-for="message in state.messages" :key="message.id" class="assistant-message" :class="[`is-${message.role}`, { 'is-error': message.state === 'error' }]">
        <span class="assistant-speaker">{{ message.role === 'user' ? '我' : state.config.name }}</span>
        <p>{{ message.state === 'pending' ? '正在思考，请稍候…' : message.content }}</p>
        <button v-if="message.state === 'error'" type="button" :disabled="state.busy" @click="sendAssistantQuestion(message.question!, message.id)">重试这个问题</button>
      </article>
    </div>
    <footer v-if="state.view === 'digest'" class="assistant-digest-footer"><button class="button" type="button" @click="showAssistantChat">普通问答</button></footer>
    <form v-else @submit.prevent="send"><label for="assistant-input">向{{ state.config.name }}提问</label><div class="assistant-compose"><textarea id="assistant-input" ref="input" v-model="draft" rows="2" maxlength="2000" placeholder="输入你的问题…" @keydown="keydown" /><button class="button primary" type="submit" :disabled="state.busy || !draft.trim()">{{ state.busy ? '回答中' : '发送' }}</button></div><small>Enter 发送 · Shift+Enter 换行 · AI 回答请结合资料核对</small></form>
  </section>
</template>
<style scoped>
.assistant-panel { position: fixed; bottom: 152px; z-index: 121; display: flex; flex-direction: column; width: min(390px, calc(100vw - 24px)); max-height: min(600px, calc(100dvh - 176px)); overflow: hidden; border: 1px solid var(--amc-border); border-radius: var(--amc-radius-large); background: var(--amc-surface); box-shadow: var(--amc-shadow-float); color: var(--amc-text-body); font-size: 14px; }
.is-right { right: 28px; } .is-left { left: 28px; }
header { display: flex; align-items: center; gap: 10px; padding: 16px; border-bottom: 1px solid var(--amc-border); flex-shrink: 0; }
header div { flex: 1; min-width: 0; } header h2 { margin: 0; font-size: 17px; color: var(--amc-text-primary); overflow-wrap: anywhere; } header span, small { font-size: 12px; color: var(--amc-text-secondary); }
.icon-button { width: 32px; height: 32px; display: grid; place-items: center; border: 0; background: transparent; border-radius: var(--amc-radius-control); cursor: pointer; }
.assistant-messages { min-height: 0; overflow-y: auto; overscroll-behavior: contain; padding: 18px; }
.assistant-digest-badge { display: inline-flex; align-items: center; gap: 5px; border-radius: 20px; padding: 5px 10px; background: var(--amc-purple-soft); color: var(--amc-purple); font-size: 12px; }
.assistant-digest h3 { margin: 14px 0 8px; color: var(--amc-text-primary); font-size: 17px; overflow-wrap: anywhere; }
.assistant-digest-keywords { display: flex; flex-wrap: wrap; gap: 8px; list-style: none; padding: 0; margin: 16px 0; }
.assistant-digest-keywords li { border-radius: var(--amc-radius-xs); padding: 4px 8px; background: var(--amc-purple-soft); color: var(--amc-purple); font-size: 12px; overflow-wrap: anywhere; }
.assistant-original { display: flex; align-items: center; gap: 6px; margin: 16px 0 10px; }
.assistant-digest small { display: block; line-height: 1.6; }
.assistant-digest-error { color: var(--amc-error); margin-bottom: 14px; }
.assistant-digest-footer { flex-shrink: 0; padding: 14px; border-top: 1px solid var(--amc-border); }
.assistant-welcome h3 { margin: 8px 0; color: var(--amc-text-primary); font-size: 20px; } p { margin: 8px 0 0; line-height: 1.7; white-space: pre-wrap; overflow-wrap: anywhere; }
.assistant-questions { display: grid; gap: 8px; margin: 16px 0; }
.assistant-questions button, .assistant-message button { text-align: left; border: 1px solid var(--amc-border); border-radius: var(--amc-radius-control); background: var(--amc-bg-soft); color: var(--amc-text-body); padding: 9px 12px; font-size: 14px; cursor: pointer; }
.assistant-message { margin-top: 14px; padding: 12px; border-radius: var(--amc-radius-card); background: var(--amc-bg-soft); } .assistant-message.is-user { margin-left: 28px; background: var(--amc-orange-soft); } .assistant-speaker { font-size: 12px; font-weight: 600; } .is-error p { color: var(--amc-error); } .assistant-message button { margin-top: 10px; }
form { flex-shrink: 0; padding: 14px; border-top: 1px solid var(--amc-border); } form label { display: block; margin-bottom: 7px; font-size: 12px; } .assistant-compose { display: flex; align-items: end; gap: 8px; margin-bottom: 8px; }
textarea { width: 100%; min-width: 0; resize: none; padding: 9px; border: 1px solid var(--amc-border); border-radius: var(--amc-radius-control); background: var(--amc-surface); color: var(--amc-text-body); font: inherit; } .assistant-compose button { flex-shrink: 0; }
button:disabled { opacity: .55; cursor: default; } button:focus-visible, textarea:focus-visible { outline: 2px solid var(--amc-purple); outline-offset: 2px; }
@media (max-width: 767px) { .assistant-panel { bottom: calc(196px + env(safe-area-inset-bottom)); max-height: calc(100dvh - 220px - env(safe-area-inset-bottom)); width: auto; left: 12px; right: 12px; } }
@media (max-height: 580px) { .assistant-panel { top: 12px; bottom: 12px; max-height: none; } }
</style>
