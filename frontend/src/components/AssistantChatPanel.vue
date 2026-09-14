<script setup lang="ts">
import { nextTick, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import AppIcon from './base/AppIcon.vue'
import idleArt from '../assets/assistant/idle.webp'
import { chatAssistant, digestPost, type AssistantMessage } from '../services/api/assistant'
import type { AssistantDigestRequest } from '../community/assistantDigest'

const props = defineProps<{
  open: boolean
  name?: string
  welcome?: string
  configNotice?: string
  digestRequest?: AssistantDigestRequest | null
}>()
const emit = defineEmits<{ close: [] }>()
const router = useRouter()

const SUGGESTIONS = ['你能帮我做什么？', '帮我规划一条AI学习路线', '学习紧张时怎么提问？']
const SUGGEST_ICONS = ['sparkles', 'target', 'question']

interface ChatItem {
  id: number
  role: 'user' | 'assistant'
  content: string
  error?: boolean
  retryText?: string
}

interface DigestView {
  postId: string
  title: string
  phase: 'organizing' | 'done' | 'error'
  summary?: string
  keywords: string[]
  error?: string
}

const started = ref(false)
const items = ref<ChatItem[]>([])
const history = ref<AssistantMessage[]>([])
const input = ref('')
const busy = ref(false)
const listEl = ref<HTMLElement | null>(null)
const sendBtn = ref<HTMLButtonElement | null>(null)
const digestMode = ref(false)
const digest = ref<DigestView | null>(null)
let nextId = 1
let requestEpoch = 0
let activeController: AbortController | null = null
let digestEpoch = 0
let digestController: AbortController | null = null

const scrollToBottom = () => {
  void nextTick(() => {
    const el = listEl.value
    if (el) el.scrollTop = el.scrollHeight
  })
}

watch(items, scrollToBottom, { deep: true })

watch(() => props.open, (isOpen) => {
  if (isOpen) {
    scrollToBottom()
    void nextTick(() => {
      if (input.value.trim()) sendBtn.value?.focus()
    })
  }
})

const replaceItem = (id: number, patch: Partial<ChatItem>) => {
  const target = items.value.find((item) => item.id === id)
  if (target) Object.assign(target, patch)
}

const askText = async (text: string) => {
  const epoch = ++requestEpoch
  activeController?.abort()
  const controller = new AbortController()
  activeController = controller
  const pendingId = nextId++
  items.value.push({ id: pendingId, role: 'assistant', content: '正在回答…' })
  busy.value = true
  try {
    const result = await chatAssistant(history.value.slice(-20), controller.signal)
    if (epoch !== requestEpoch) return
    history.value.push({ role: 'assistant', content: result.reply })
    replaceItem(pendingId, { role: 'assistant', content: result.reply })
  } catch (error) {
    if (epoch !== requestEpoch) return
    if (error instanceof DOMException && error.name === 'AbortError') return
    const message = error instanceof Error ? error.message : '请求失败，请重试'
    replaceItem(pendingId, { role: 'assistant', content: message, error: true, retryText: text })
  } finally {
    if (epoch === requestEpoch) busy.value = false
  }
}

const send = (raw?: string) => {
  const text = String(raw ?? input.value).trim()
  if (!text || busy.value) return
  if (digestMode.value) ordinaryChat()
  started.value = true
  history.value.push({ role: 'user', content: text })
  items.value.push({ id: nextId++, role: 'user', content: text })
  input.value = ''
  void askText(text)
}

const retry = (text: string) => {
  void askText(text)
}

const startDigest = async (request: AssistantDigestRequest) => {
  const { postId, title } = request
  digestMode.value = true
  digest.value = { postId, title, phase: 'organizing', keywords: [] }
  const epoch = ++digestEpoch
  digestController?.abort()
  const controller = new AbortController()
  digestController = controller
  try {
    const result = await digestPost(postId, controller.signal)
    if (epoch !== digestEpoch) return
    if (result.postId !== postId) return
    digest.value = { postId, title, phase: 'done', summary: result.summary, keywords: result.keywords }
  } catch (error) {
    if (epoch !== digestEpoch) return
    if (error instanceof DOMException && error.name === 'AbortError') return
    digest.value = { postId, title, phase: 'error', keywords: [], error: error instanceof Error ? error.message : '简讯生成失败，请重试' }
  }
}

const ordinaryChat = () => {
  digestController?.abort()
  digestEpoch++
  digestMode.value = false
  digest.value = null
}

const viewPost = (postId: string) => {
  close()
  void router.push(`/community/post/${postId}`)
}

watch(() => props.digestRequest, (request) => {
  if (request) void startDigest(request)
})

const close = () => {
  activeController?.abort()
  requestEpoch++
  digestController?.abort()
  digestEpoch++
  busy.value = false
  emit('close')
}
</script>

<template>
  <section v-show="open" class="snow-chat" role="dialog" aria-label="小雪助手">
    <header class="snow-chat-head">
      <img :src="idleArt" alt="" width="41" height="41" />
      <div class="snow-chat-title">
        <strong>{{ name || '小雪助手' }}</strong>
        <small>你的AI学习伙伴</small>
      </div>
      <button class="icon-button snow-chat-close" type="button" aria-label="关闭小雪" @click="close"><AppIcon name="close" :size="17" /></button>
    </header>
    <div ref="listEl" class="snow-chat-messages" aria-live="polite">
      <div v-if="digestMode && digest" class="snow-chat-digest">
        <div class="snow-chat-pill">小雪简讯</div>
        <h4>{{ digest.title }}</h4>
        <p v-if="digest.phase === 'organizing'">正在整理《{{ digest.title }}》…</p>
        <template v-else-if="digest.phase === 'done'">
          <p>{{ digest.summary }}</p>
          <div v-if="digest.keywords.length" class="snow-chat-keywords"><span v-for="kw in digest.keywords" :key="kw">{{ kw }}</span></div>
          <button type="button" class="snow-chat-viewpost" @click="viewPost(digest.postId)"><AppIcon name="arrow-up-right" :size="13" />查看原帖</button>
        </template>
        <template v-else>
          <p class="snow-chat-digest-error">{{ digest.error }}</p>
          <button type="button" class="snow-chat-retry" @click="startDigest({ postId: digest.postId, title: digest.title, nonce: Date.now() })"><AppIcon name="refresh" :size="13" />重试</button>
        </template>
        <small>基于当前可读内容生成，请对照原文</small>
      </div>
      <template v-else>
        <div v-if="!started" class="snow-chat-welcome">
          <div class="snow-chat-eyebrow">YOUR LEARNING COMPANION</div>
          <h3>今天想探索什么？</h3>
          <p>{{ welcome || '我是小雪，你的AI学习伙伴。可以问我关于课程、路线和练习的问题。' }}</p>
          <p v-if="configNotice" class="snow-chat-config-error" role="status">{{ configNotice }}</p>
          <div class="snow-chat-suggests">
            <button v-for="(q, index) in SUGGESTIONS" :key="q" type="button" @click="send(q)">
              <AppIcon :name="SUGGEST_ICONS[index]" :size="16" /><span>{{ q }}</span>
            </button>
          </div>
        </div>
        <div v-for="item in items" :key="item.id" class="snow-chat-bubble" :class="[`snow-chat-${item.role}`, { 'snow-chat-error': item.error }]">
          <p>{{ item.content }}</p>
          <button v-if="item.error && item.retryText" type="button" class="snow-chat-retry" @click="retry(item.retryText)"><AppIcon name="refresh" :size="13" />重试</button>
        </div>
      </template>
    </div>
    <form class="snow-chat-composer" @submit.prevent="send()">
      <div class="snow-chat-mode">
        <button type="button" class="snow-chat-mode-btn" :class="{ 'snow-chat-mode-active': digestMode }" @click="ordinaryChat">普通问答</button>
      </div>
      <div class="snow-chat-inputrow">
        <textarea v-model="input" maxlength="2000" placeholder="向小雪助手提问…" aria-label="提问输入" @keydown.enter.exact.prevent="send()"></textarea>
        <button ref="sendBtn" class="snow-chat-send" type="submit" aria-label="发送" :disabled="busy || !input.trim()">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m12 20 0-16M5 11l7-7 7 7" /></svg>
        </button>
      </div>
      <div class="snow-chat-foot"><span>需要信息可打开原帖或资源</span><span>Enter发送</span></div>
    </form>
  </section>
</template>

<style scoped>
.snow-chat {
  position: fixed;
  right: 32px;
  bottom: 160px;
  z-index: 1001;
  display: flex;
  flex-direction: column;
  width: min(400px, calc(100vw - 24px));
  height: min(500px, calc(100dvh - 200px));
  overflow: hidden;
  border: 1px solid var(--amc-border);
  border-radius: var(--amc-radius-large);
  background: var(--amc-surface-warm);
  box-shadow: var(--amc-shadow-float);
}
.snow-chat-head {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 12px 14px;
  border-bottom: 1px solid var(--amc-border);
  background: var(--amc-surface);
}
.snow-chat-head img {
  width: 41px;
  height: 41px;
  object-fit: contain;
}
.snow-chat-title {
  min-width: 0;
  line-height: 1.3;
}
.snow-chat-title strong {
  display: block;
  font-size: 14px;
  color: var(--amc-text-primary);
}
.snow-chat-title small {
  display: block;
  font-size: 10px;
  color: var(--amc-text-muted);
}
.snow-chat-close {
  margin-left: auto;
  min-width: 34px;
  min-height: 34px;
  border: 0;
  background: transparent;
}
.snow-chat-messages {
  flex: 1;
  min-height: 0;
  padding: 16px 16px 8px;
  overflow-y: auto;
  scroll-behavior: smooth;
}
.snow-chat-eyebrow {
  font-size: 10px;
  letter-spacing: 2px;
  color: var(--amc-orange);
}
.snow-chat-welcome h3 {
  margin: 10px 0 6px;
  font-size: 24px;
  line-height: 1.25;
  color: var(--amc-text-primary);
}
.snow-chat-welcome p {
  margin: 0;
  font-size: 13px;
  line-height: 1.8;
  color: var(--amc-text-secondary);
  white-space: pre-line;
}
.snow-chat-config-error {
  margin-top: 8px !important;
  font-size: 11px;
  color: var(--amc-orange-hover);
}
.snow-chat-suggests {
  display: grid;
  gap: 9px;
  margin-top: 18px;
}
.snow-chat-suggests button {
  display: flex;
  align-items: center;
  gap: 9px;
  padding: 11px;
  border: 1px solid var(--amc-border);
  border-radius: var(--amc-radius-control);
  background: var(--amc-surface);
  text-align: left;
  font-size: 12px;
  color: var(--amc-text-body);
  cursor: pointer;
  transition: border-color 160ms var(--amc-ease);
}
.snow-chat-suggests button:hover {
  border-color: var(--amc-orange-border);
}
.snow-chat-suggests .app-icon {
  flex-shrink: 0;
  color: var(--amc-orange);
}
.snow-chat-bubble {
  margin: 10px 0;
  padding: 12px 14px;
  border-radius: 12px;
  font-size: 13px;
  line-height: 1.85;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  background: #f4f0e9;
  color: var(--amc-text-body);
}
.snow-chat-bubble p {
  margin: 0;
}
.snow-chat-user {
  margin-left: 40px;
  background: var(--amc-orange-soft);
}
.snow-chat-error {
  background: var(--amc-surface-peach);
  color: var(--amc-text-body);
}
.snow-chat-retry {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  margin-top: 8px;
  padding: 4px 10px;
  border: 1px solid var(--amc-orange-border);
  border-radius: var(--amc-radius-pill);
  background: var(--amc-surface);
  color: var(--amc-orange-hover);
  font-size: 11px;
  cursor: pointer;
}
.snow-chat-digest {
  margin: 10px 0;
  padding: 13px 14px;
  border: 1px solid var(--amc-orange-border);
  border-radius: var(--amc-radius-control);
  background: var(--amc-surface);
}
.snow-chat-pill {
  display: inline-block;
  padding: 3px 8px;
  border-radius: var(--amc-radius-pill);
  background: var(--amc-orange-soft);
  color: var(--amc-orange-hover);
  font-size: 11px;
  font-weight: 600;
}
.snow-chat-digest h4 {
  margin: 9px 0 6px;
  font-size: 14px;
  line-height: 1.5;
  color: var(--amc-text-primary);
}
.snow-chat-digest p {
  margin: 0;
  font-size: 13px;
  line-height: 1.85;
  color: var(--amc-text-body);
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
.snow-chat-digest > small {
  display: block;
  margin-top: 9px;
  font-size: 10px;
  color: var(--amc-text-muted);
}
.snow-chat-digest-error {
  color: var(--amc-orange-hover);
}
.snow-chat-keywords {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 9px;
}
.snow-chat-keywords span {
  padding: 3px 8px;
  border-radius: var(--amc-radius-pill);
  background: var(--amc-bg-page);
  color: var(--amc-text-secondary);
  font-size: 11px;
}
.snow-chat-viewpost {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  margin-top: 9px;
  padding: 4px 10px;
  border: 0;
  border-radius: var(--amc-radius-pill);
  background: var(--amc-orange);
  color: var(--amc-surface);
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
}
.snow-chat-mode-btn.snow-chat-mode-active {
  background: var(--amc-orange-soft);
  color: var(--amc-orange-hover);
}
.snow-chat-composer {
  padding: 10px 14px 12px;
  border-top: 1px solid var(--amc-border);
  background: var(--amc-surface);
}
.snow-chat-mode {
  display: flex;
  gap: 8px;
  margin-bottom: 8px;
}
.snow-chat-mode-btn {
  padding: 3px 9px;
  border: 0;
  border-radius: 7px;
  background: var(--amc-bg-page);
  color: var(--amc-text-secondary);
  font-size: 10px;
}
.snow-chat-inputrow {
  display: flex;
  align-items: flex-end;
  gap: 8px;
}
.snow-chat-inputrow textarea {
  width: 100%;
  height: 54px;
  max-height: 100px;
  min-height: 42px;
  resize: vertical;
  border: 1px solid var(--amc-border);
  padding: 8px 10px;
  border-radius: var(--amc-radius-control);
  background: var(--amc-surface);
  font-size: 13px;
  color: var(--amc-text-body);
}
.snow-chat-inputrow textarea::placeholder {
  color: var(--amc-text-placeholder);
}
.snow-chat-send {
  display: grid;
  place-items: center;
  width: 36px;
  height: 36px;
  flex-shrink: 0;
  border: 0;
  border-radius: var(--amc-radius-control);
  background: var(--amc-orange);
  color: var(--amc-surface);
  cursor: pointer;
}
.snow-chat-send:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.snow-chat-send svg {
  width: 18px;
  height: 18px;
}
.snow-chat-foot {
  display: flex;
  justify-content: space-between;
  margin-top: 6px;
  font-size: 9px;
  color: var(--amc-text-muted);
}
@media (max-width: 650px) {
  .snow-chat {
    right: 12px;
    bottom: 116px;
    left: 12px;
    width: auto;
  }
}
</style>