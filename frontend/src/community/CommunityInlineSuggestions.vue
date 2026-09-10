<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { communityInlineAtCaret, topicMarkerName, type CommunityInlineCandidateDto } from '@ai-learning-hub/contracts'
import { communityApi } from '../services/api/community'
import { useCommunityStore } from '../stores/community'
import { useCommunityDraft } from './composables/useCommunityDraft'
import CommunityAvatar from '../components/base/CommunityAvatar.vue'
import type { InlineEditorAdapter } from './inlineEditor'
const props = defineProps<{ target?: HTMLElement | null; adapter?: InlineEditorAdapter }>()
const store = useCommunityStore(), draft = useCommunityDraft(), items = ref<CommunityInlineCandidateDto[]>([]), index = ref(0), position = ref({ left: '0px', top: '0px', maxHeight: '180px' })
let timer: ReturnType<typeof setTimeout>, version = 0, composing = false
const close = () => { clearTimeout(timer); version++; items.value = [] }
const context = () => {
  if (props.adapter) return props.adapter.read()
  const node = props.target
  if (!(node instanceof HTMLTextAreaElement) || node.selectionStart !== node.selectionEnd) return null
  const mirror = document.createElement('div'), style = getComputedStyle(node), rect = node.getBoundingClientRect()
  for (const key of ['font', 'lineHeight', 'letterSpacing', 'padding', 'border', 'boxSizing', 'wordBreak', 'overflowWrap'] as const) mirror.style[key] = style[key]
  Object.assign(mirror.style, { position: 'fixed', visibility: 'hidden', whiteSpace: 'pre-wrap', width: `${rect.width}px`, left: `${rect.left}px`, top: `${rect.top - node.scrollTop}px` })
  mirror.textContent = node.value.slice(0, node.selectionStart)
  const caret = document.createElement('span'); caret.textContent = '\u200b'; mirror.append(caret); document.body.append(mirror)
  const point = caret.getBoundingClientRect(); mirror.remove()
  return { text: node.value, caret: node.selectionStart, rect: point }
}
const choose = (candidate: CommunityInlineCandidateDto) => {
  const current = context(), token = current && communityInlineAtCaret(current.text, current.caret)
  if (!token || token.kind !== candidate.kind || composing) return close()
  const text = candidate.kind === 'topic' ? `#${topicMarkerName(candidate.name)}` : `@${candidate.username}`
  const end = token.end + (current!.text[token.end] === ' ' ? 1 : 0)
  close()
  // 候选只绑定 ID；服务端仍核验正文、账号和历史关系。
  draft.form.inlineReferences = [...(draft.form.inlineReferences || []).filter((ref) => ref.kind !== candidate.kind || ref.text.toLowerCase() !== text.toLowerCase()), { kind: candidate.kind, text, id: candidate.id }].slice(-13)
  if (props.adapter) props.adapter.replace(token.start, end, `${text} `)
  else if (props.target instanceof HTMLTextAreaElement) {
    const node = props.target; node.focus({ preventScroll: true }); node.setSelectionRange(token.start, end)
    if (typeof document.execCommand !== 'function' || !document.execCommand('insertText', false, `${text} `)) { node.setRangeText(`${text} `, token.start, end, 'end'); node.dispatchEvent(new Event('input', { bubbles: true })) }
  }
}
const update = () => {
  close()
  if (composing || !store.composerOpen) return
  const current = context(), token = current && communityInlineAtCaret(current.text, current.caret)
  if (!current || !token) return
  const snapshot = version, epoch = store.epoch, session = store.composerSession
  timer = setTimeout(async () => {
    try {
      const result = await communityApi.suggestions(token.kind, token.text.slice(1))
      if (snapshot !== version || epoch !== store.epoch || session !== store.composerSession || !store.composerOpen || composing) return
      items.value = result.slice(0, 8); index.value = 0
      const view = window.visualViewport, top = view?.offsetTop || 0, bottom = top + (view?.height || innerHeight), width = Math.min(280, innerWidth - 16)
      const scope = props.target?.closest('form, dialog')
      const buttons = [...(scope?.querySelectorAll('button[type="submit"], .rich-edit-actions .button.primary') || [])].map(node => node.getBoundingClientRect()).filter(rect => rect.width && rect.height)
      let height = Math.min(180, result.length * 54, bottom - top - 16)
      let left = Math.max(8, Math.min(current.rect.left, innerWidth - width - 8)), y = Math.max(top + 8, current.rect.top - height - 8)
      const candidates = [current.rect.bottom + 4, current.rect.top - height - 8, ...buttons.map(rect => rect.bottom + 8)]
      const point = candidates.flatMap(y => [left, 8, innerWidth - width - 8].map(x => ({ x, y }))).find(p => p.y >= top + 8 && p.y + height <= bottom - 8 && buttons.every(rect => p.x + width <= rect.left || p.x >= rect.right || p.y + height <= rect.top || p.y >= rect.bottom))
      if (point) { left = point.x; y = point.y }
      else { y = top + 8; height = Math.max(48, Math.min(height, current.rect.top - y - 8)) }
      position.value = { left: `${left}px`, top: `${y}px`, maxHeight: `${height}px` }

    } catch { if (snapshot === version) items.value = [] }
  }, 200)
}
const input = () => queueMicrotask(update)
const keydown = (event: KeyboardEvent) => {
  if (composing || event.isComposing || event.keyCode === 229) return
  if (!items.value.length || event.ctrlKey || event.metaKey) return
  if (!['ArrowUp', 'ArrowDown', 'Enter', 'Tab', 'Escape'].includes(event.key)) return
  event.preventDefault(); event.stopPropagation()
  if (event.key === 'Escape') close()
  else if (event.key === 'Enter' || event.key === 'Tab') choose(items.value[index.value]!)
  else index.value = (index.value + (event.key === 'ArrowDown' ? 1 : -1) + items.value.length) % items.value.length
}
const keyup = (event: KeyboardEvent) => { if (!['ArrowUp', 'ArrowDown', 'Enter', 'Tab', 'Escape'].includes(event.key)) input() }
const compositionStart = () => { composing = true; close() }, compositionEnd = () => { composing = false; update() }
const outside = (event: PointerEvent) => { if (!(event.target as HTMLElement).closest('.inline-suggestions') && !props.target?.contains(event.target as Node)) close() }
watch(() => props.target, (target, previous) => {
  const bind = (node: HTMLElement | null | undefined, method: 'addEventListener' | 'removeEventListener') => {
    node?.[method]('input', input, true); node?.[method]('click', update); node?.[method]('keydown', keydown as (event: Event) => void, true); node?.[method]('keyup', keyup as (event: Event) => void, true)
    node?.[method]('compositionstart', compositionStart); node?.[method]('compositionend', compositionEnd)
  }
  bind(previous, 'removeEventListener'); bind(target, 'addEventListener'); close()
}, { immediate: true })
watch(() => [store.epoch, store.composerSession, store.composerOpen], close)
onMounted(() => document.addEventListener('pointerdown', outside))
onBeforeUnmount(() => { close(); document.removeEventListener('pointerdown', outside); props.target?.removeEventListener('input', input, true); props.target?.removeEventListener('click', update); props.target?.removeEventListener('keydown', keydown as (event: Event) => void, true); props.target?.removeEventListener('keyup', keyup as (event: Event) => void, true); props.target?.removeEventListener('compositionstart', compositionStart); props.target?.removeEventListener('compositionend', compositionEnd) })
</script>
<template><Teleport :to="target?.closest('dialog') || 'body'"><div v-if="items.length" class="inline-suggestions" role="listbox" aria-label="正文补全建议" :style="position"><button v-for="(item, i) in items" :key="item.id" type="button" role="option" :aria-selected="i === index" :class="{ selected: i === index }" @pointerdown.prevent @click.prevent.stop="choose(item)"><CommunityAvatar v-if="item.kind === 'mention'" :src="item.avatar" :name="item.name" :username="item.username" size="sm" /><span><strong>{{ item.name }}</strong><small>{{ item.kind === 'topic' ? `${item.postCount || 0} 篇帖子` : `@${item.username}` }}{{ item.verifiedType && item.verifiedType !== 'none' ? ' · 已认证' : '' }}</small></span></button></div></Teleport></template>
<style scoped>
.inline-suggestions { position: fixed; z-index: 10050; width: min(280px, calc(100vw - 16px)); max-height: 180px; overflow: auto; background: var(--amc-surface, #fff); border: 1px solid var(--amc-border, #e6e0d8); border-radius: 10px; box-shadow: 0 6px 24px #32251926; }
button { display: flex; align-items: center; gap: 8px; width: 100%; padding: 7px 12px; text-align: left; min-height: 48px; border: 0; background: transparent; }
button.selected, button:hover { background: #fff0e8; } strong, small { display: block; } small { color: #817a70; } strong { color: #39332c; }
</style>
