import { reactive } from 'vue'
import { assistantConfigDefaults, type AssistantMessageDto, type AssistantDigestDto } from '@ai-learning-hub/contracts'
import { assistantApi } from '../services/api/assistant'

interface Message extends AssistantMessageDto { id: number; state: 'pending' | 'done' | 'error'; question?: string }
export const assistantState = reactive({
  config: { ...assistantConfigDefaults }, ready: false, configError: '', open: false, busy: false,
  messages: [] as Message[],
  view: 'chat' as 'chat' | 'digest', digestPostId: '', digestTitle: '', digest: null as AssistantDigestDto | null, digestError: '',
})
let serial = 0, epoch = 0, session = 0
let requestController: AbortController | undefined, configController: AbortController | undefined
let configPromise: Promise<void> | undefined

export function loadAssistantConfig() {
  if (configPromise) return configPromise
  const current = session
  configController = new AbortController()
  assistantState.configError = ''
  configPromise = assistantApi.config(configController.signal).then(config => {
    if (current !== session) return
    assistantState.config = config
    assistantState.ready = true
    if (!config.enabled) closeAssistant()
    else if (!config.digestEnabled && assistantState.view === 'digest') showAssistantChat()
  }).catch(cause => {
    if (current === session) assistantState.configError = cause instanceof Error ? cause.message : '助手配置读取失败'
  }).finally(() => { if (current === session) configPromise = undefined })
  return configPromise
}
export function cancelAssistantRequest() {
  epoch++
  requestController?.abort()
  assistantState.busy = false
  for (const message of assistantState.messages) {
    if (message.state === 'pending') { message.state = 'error'; message.content = '回答已取消，可重新尝试' }
  }
}
export function showAssistantChat() {
  cancelAssistantRequest(); assistantState.view = 'chat'
  assistantState.digestPostId = ''; assistantState.digestTitle = ''; assistantState.digest = null; assistantState.digestError = ''
}
export function closeAssistant() { showAssistantChat(); assistantState.open = false }
export function toggleAssistant() {
  if (assistantState.open) closeAssistant()
  else if (assistantState.ready && assistantState.config.enabled) assistantState.open = true
}
export function resetAssistant() {
  closeAssistant(); session++; configController?.abort(); configPromise = undefined
  assistantState.messages = []; assistantState.ready = false; assistantState.configError = ''
  assistantState.config = { ...assistantConfigDefaults }
}
export async function sendAssistantQuestion(raw: string, retryId?: number) {
  const question = raw.trim()
  if (!question || question.length > 2000 || assistantState.busy || !assistantState.ready || !assistantState.config.enabled || assistantState.view !== 'chat') return
  let answer = retryId === undefined ? undefined : assistantState.messages.find(m => m.id === retryId && m.state === 'error')
  if (retryId !== undefined && !answer) return
  if (!answer) {
    assistantState.messages.push({ id: ++serial, role: 'user', content: question, state: 'done' })
    assistantState.messages.push({ id: ++serial, role: 'assistant', content: '', state: 'pending', question })
    answer = assistantState.messages.at(-1)!
  }
  answer.state = 'pending'; answer.content = ''; assistantState.busy = true
  const current = ++epoch
  requestController = new AbortController()
  const history = assistantState.messages.slice(0, assistantState.messages.indexOf(answer)).filter(m => m.state === 'done').slice(-20).map(({ role, content }) => ({ role, content }))
  try {
    const result = await assistantApi.chat({ messages: history }, requestController.signal)
    if (current !== epoch) return
    if (!result.reply?.trim()) throw new Error('模型没有返回有效回答，请重试')
    answer.content = result.reply; answer.state = 'done'
  } catch (cause) {
    if (current !== epoch) return
    answer.content = cause instanceof Error ? cause.message : '回答失败，请重试'; answer.state = 'error'
  } finally { if (current === epoch) assistantState.busy = false }
}
export async function requestAssistantDigest(postId: string, title = '') {
  if (!postId.trim() || !assistantState.ready || !assistantState.config.enabled || !assistantState.config.digestEnabled) return
  cancelAssistantRequest()
  assistantState.view = 'digest'; assistantState.open = true; assistantState.busy = true
  assistantState.digestPostId = postId; assistantState.digestTitle = title; assistantState.digest = null; assistantState.digestError = ''
  const current = ++epoch
  requestController = new AbortController()
  try {
    const digest = await assistantApi.digest({ postId }, requestController.signal)
    if (current !== epoch) return
    if (digest.postId !== postId) throw new Error('简讯与当前帖子不一致，请重试')
    if (typeof digest.title !== 'string' || typeof digest.summary !== 'string' || !digest.summary.trim() || !Array.isArray(digest.keywords) || digest.keywords.some(k => typeof k !== 'string')) throw new Error('简讯没有返回有效内容，请重试')
    assistantState.digest = digest; assistantState.digestTitle = digest.title
  } catch (cause) {
    if (current !== epoch) return
    assistantState.digestError = cause instanceof Error ? cause.message : '简讯生成失败，请重试'
  } finally { if (current === epoch) assistantState.busy = false }
}
