import { computed, onScopeDispose, ref, watch } from 'vue'
import { defineStore } from 'pinia'
import type { CommunityBindingInput, CommunityContentBlock, CommunityDraftDto, CommunityPostInput, CommunityTopicDto, LearningContentType } from '@ai-learning-hub/contracts'
import { useCommunityStore } from '../../stores/community'
import { useAuthStore } from '../../stores/auth'
import { communityApi } from '../../services/api/community'
import { useCoursesStore } from '../../stores/content/courses'
import { useLabsStore } from '../../stores/content/labs'
import { useArticlesStore } from '../../stores/content/articles'
import { useResourcesStore } from '../../stores/content/resources'
import { useThemesStore } from '../../stores/content/themes'
import { useChallengesStore } from '../../stores/content/challenges'
import { ApiError } from '../../services/api/client'
import { randomId } from '../../services/api/random-id'
export const useCommunityDraft = defineStore('community-draft', () => {
  const store = useCommunityStore(), auth = useAuthStore()
  const form = ref<CommunityPostInput>({ type: 'general', title: '', contentBlocks: [], bindings: [], topicIds: [], visibility: 'public', status: 'published' })
  const body = ref(''), code = ref(''), language = ref('text'), quote = ref(''), images = ref<Array<{ fileId: string; alt: string }>>([])
  const topics = ref<CommunityTopicDto[]>([]), bindingType = ref<LearningContentType>('course'), bindingId = ref(''), bindingSearch = ref(''), bindingTitles = ref<Record<string, string>>({})
  const preview = ref(false), saving = ref(false), bindingLoading = ref(false), topicsLoading = ref(false), error = ref(''), savedAt = ref(''), closePrompt = ref(false), dirty = ref(false), draftId = ref<string>()
  const conflict = ref(false), draftUnavailable = ref(false)
  let requestKey = '', requestBody = ''
  let editorSession = 0
  type UnconfirmedWrite = { input: CommunityPostInput; asDraft: boolean; id?: string; key: string }
  let unconfirmed: UnconfirmedWrite | undefined
  const sources = { course: useCoursesStore(), lab: useLabsStore(), article: useArticlesStore(), resource: useResourcesStore(), theme: useThemesStore(), challenge: useChallengesStore() }
  const source = computed(() => bindingType.value in sources ? sources[bindingType.value as keyof typeof sources] : null)
  const bindingOptions = computed(() => source.value?.items.map((item) => ({ id: 'slug' in item ? String(item.slug) : item.id, title: item.title })) || [])
  const advanced = computed(() => store.composerMode === 'advanced')
  const blocks = computed<CommunityContentBlock[]>(() => [...(body.value.trim() ? [{ type: 'paragraph' as const, text: body.value.trim() }] : []), ...(quote.value.trim() ? [{ type: 'quote' as const, text: quote.value.trim() }] : []), ...(code.value.trim() ? [{ type: 'code' as const, language: language.value, code: code.value }] : []), ...images.value.map((image) => ({ type: 'image' as const, ...image }))])
  const input = () => ({ ...form.value, contentBlocks: blocks.value })
  const hasContent = () => !!(blocks.value.length || form.value.title?.trim() || form.value.bindings.length || form.value.topicIds.length || form.value.contribution)
  const key = () => `community-draft:${auth.dataMode}:${auth.user?.id || 'anonymous'}`
  let timer: ReturnType<typeof setTimeout> | undefined, remoteTimer: ReturnType<typeof setTimeout> | undefined, hydrating = false
  let pending: Promise<boolean> | null = null
  const loadOptions = async () => { bindingId.value = ''; if (!source.value) return; const owner = auth.user?.id, epoch = store.epoch; bindingLoading.value = true; try { await source.value.load({ page: 1, pageSize: 30, keyword: bindingSearch.value }) } catch (cause) { if (owner === auth.user?.id && epoch === store.epoch) error.value = cause instanceof Error ? cause.message : '学习内容读取失败' } finally { if (owner === auth.user?.id && epoch === store.epoch) bindingLoading.value = false } }
  const loadTopics = async () => {
    if (topicsLoading.value || topics.value.length) return
    const owner = auth.user?.id, epoch = store.epoch
    topicsLoading.value = true
    try { const rows = await communityApi.topics(); if (owner === auth.user?.id && epoch === store.epoch) topics.value = rows }
    catch (cause) { if (owner === auth.user?.id && epoch === store.epoch) error.value = cause instanceof Error ? cause.message : '话题读取失败' }
    finally { if (owner === auth.user?.id && epoch === store.epoch) topicsLoading.value = false }
  }
  const hydrate = (value: CommunityPostInput) => {
    hydrating = true
    form.value = JSON.parse(JSON.stringify(value)); preview.value = false; error.value = ''; savedAt.value = ''; dirty.value = false; conflict.value = false; draftUnavailable.value = false
    body.value = value.contentBlocks.filter((b) => b.type === 'paragraph').map((b) => b.text).join('\n\n')
    code.value = value.contentBlocks.filter((b) => b.type === 'code').map((b) => b.code).join('\n')
    quote.value = value.contentBlocks.filter((b) => b.type === 'quote').map((b) => b.text).join('\n')
    language.value = value.contentBlocks.find((b) => b.type === 'code')?.language || 'text'
    images.value = value.contentBlocks.filter((b) => b.type === 'image').map((b) => ({ fileId: b.fileId, alt: b.alt || '' }))
    queueMicrotask(() => { hydrating = false })
  }
  const restore = (row: CommunityDraftDto) => { store.openComposer(row.input, row.id) }
  watch(() => store.composerOpen, async (open) => {
    editorSession++
    if (!open || !store.draft) { clearTimeout(timer); clearTimeout(remoteTimer); return }
    const epoch = store.epoch, owner = auth.user?.id
    draftId.value = store.draft.status === 'draft' ? store.editingId : undefined
    let value = store.draft
    if (!store.editingId && !value.contentBlocks.length && !value.bindings.length) {
      try { const local = JSON.parse(localStorage.getItem(key()) || 'null') as (CommunityDraftDto & { editingId?: string; requestKey?: string; requestBody?: string; unconfirmed?: UnconfirmedWrite }) | null; if (local?.input) { value = local.input; draftId.value = local.id || undefined; store.editingId = local.editingId; requestKey = local.requestKey || ''; requestBody = local.requestBody || ''; unconfirmed = local.unconfirmed; if (local.editingId) { store.composerMode = 'advanced'; store.composerInline = false } } } catch { error.value = '本地草稿格式异常，可从草稿箱恢复' }
    }
    hydrate(value)
    if (value !== store.draft) { savedAt.value = '尚未同步到服务器'; dirty.value = true }
    try {
      for (const binding of value.bindings) { const context = await communityApi.bindingContext(binding); if (epoch !== store.epoch || owner !== auth.user?.id) return; bindingTitles.value[`${binding.type}:${binding.id}`] = context.binding.title; if (!form.value.topicIds.length) form.value.topicIds = context.topicIds }
    } catch (cause) { if (epoch === store.epoch && owner === auth.user?.id) error.value = cause instanceof Error ? cause.message : '学习上下文读取失败' }
  }, { flush: 'sync' })
  watch(bindingType, () => { bindingSearch.value = ''; bindingId.value = '' })
  const addBinding = async () => {
    if (!bindingId.value.trim() || form.value.bindings.length >= (advanced.value ? 8 : 1)) return
    const value: CommunityBindingInput = { type: bindingType.value, id: bindingId.value.trim() }
    const owner = auth.user?.id, epoch = store.epoch
    try { const context = await communityApi.bindingContext(value); if (owner !== auth.user?.id || epoch !== store.epoch) return; bindingTitles.value[`${value.type}:${value.id}`] = context.binding.title; if (!form.value.bindings.some((b) => b.type === value.type && b.id === value.id)) form.value.bindings.push(value); if (!form.value.topicIds.length) form.value.topicIds = context.topicIds; bindingId.value = '' }
    catch (cause) { if (owner === auth.user?.id && epoch === store.epoch) error.value = cause instanceof Error ? cause.message : '关联内容不可用' }
  }
  const uploadFiles = async (files: File[]) => {
    const epoch = store.epoch, owner = auth.user?.id
    if (saving.value) { error.value = '正在保存或上传，请完成后再添加图片'; return }
    if (files.length + images.value.length > 4) { error.value = '最多 4 张图片'; return }
    saving.value = true
    try { for (const file of files) { const row = await communityApi.upload(file); if (epoch !== store.epoch || owner !== auth.user?.id) return; images.value.push({ fileId: row.id, alt: file.name }) } } catch (cause) { if (epoch === store.epoch && owner === auth.user?.id) error.value = cause instanceof Error ? cause.message : '上传失败' } finally { if (epoch === store.epoch && owner === auth.user?.id) saving.value = false }
  }
  const upload = async (event: Event) => { const target = event.target as HTMLInputElement; await uploadFiles(Array.from(target.files || [])); target.value = '' }
  const clearLocal = () => { try { localStorage.removeItem(key()) } catch { /* 服务端保存不依赖浏览器存储。 */ } }
  const localSave = () => {
    try {
      localStorage.setItem(key(), JSON.stringify({ id: draftId.value || '', editingId: store.editingId, input: input(), updatedAt: new Date().toISOString(), requestKey, requestBody, unconfirmed }))
      savedAt.value = auth.dataMode === 'api' ? '尚未同步到服务器' : '本地演示草稿已保存'
    } catch { savedAt.value = '浏览器无法保存恢复副本，请同步到服务器' }
  }
  const save = (asDraft = false): Promise<boolean> => {
    if (pending) return pending
    if (saving.value) return Promise.resolve(false)
    const epoch = store.epoch, owner = auth.user?.id
    const operation = Promise.resolve().then(async () => {
      if (owner !== auth.user?.id || epoch !== store.epoch) return false
      saving.value = true; error.value = ''
      try {
        if (conflict.value || draftUnavailable.value) throw new Error(draftUnavailable.value ? '原草稿不可用，请保留当前副本后另存，或放弃修改' : '已有较新的服务端版本，请先读取服务器版本或保留当前副本')
        if (!asDraft && !blocks.value.length && (!form.value.contribution || form.value.contribution.kind === 'article')) throw new Error('请填写正文')
        if (!asDraft && form.value.contribution && !form.value.title?.trim()) throw new Error('资源作品需要标题')
        if (!asDraft && form.value.contribution?.kind === 'video' && !form.value.contribution.videoAssetId) throw new Error('请先上传视频并等待处理完成')
        if (!asDraft && form.value.contribution?.kind === 'document' && !form.value.contribution.attachmentFileId) throw new Error('请先上传资料文件')
        if (!asDraft && ['question', 'project'].includes(form.value.type) && !form.value.title?.trim()) throw new Error('问题和项目需要标题')
        if (!asDraft && !advanced.value && (form.value.bindings.length > 1 || form.value.topicIds.length > 3)) throw new Error('此草稿包含更多关联或话题，请切换高级编辑')
        if (asDraft && !hasContent() && !draftId.value && !store.editingId) { clearLocal(); dirty.value = false; savedAt.value = ''; return true }
        const send = (write: UnconfirmedWrite) => write.asDraft ? communityApi.saveDraft(write.input, write.id, write.key) : communityApi.save({ ...write.input, status: 'published' }, write.id, write.key)
        let replay: Awaited<ReturnType<typeof communityApi.save>> | undefined
        if (unconfirmed) {
          const previous = unconfirmed
          const acknowledged = await send(previous)
          if (epoch !== store.epoch || owner !== auth.user?.id) return false
          unconfirmed = undefined; requestKey = ''; requestBody = ''
          const unchanged = previous.asDraft === asDraft && JSON.stringify(previous.input) === JSON.stringify(input())
          if (unchanged) replay = acknowledged
          else {
            hydrating = true
            if (previous.asDraft) draftId.value = acknowledged.id
            else { store.editingId = acknowledged.id; draftId.value = undefined; store.composerMode = 'advanced' }
            form.value.expectedRevision = acknowledged.revision
            queueMicrotask(() => { hydrating = false })
          }
        }
        if (asDraft && store.editingId && !draftId.value && !replay) { localSave(); savedAt.value = '仅保留本地副本，尚未同步到服务器'; return true }
        const captured = JSON.stringify(input())
        const operationBody = `${asDraft ? 'draft' : 'publish'}:${captured}`
        if (requestBody !== operationBody) { requestBody = operationBody; requestKey = randomId() }
        if (!replay) unconfirmed = { input: JSON.parse(captured), asDraft, id: asDraft ? draftId.value : store.editingId || draftId.value, key: requestKey }
        localSave()
        const post = replay || await send(unconfirmed!)
        if (epoch !== store.epoch || owner !== auth.user?.id) return false
        unconfirmed = undefined
        const changed = captured !== JSON.stringify(input())
        if (asDraft) { draftId.value = post.id; hydrating = true; form.value.expectedRevision = post.revision; queueMicrotask(() => { hydrating = false }); requestKey = ''; requestBody = ''; localSave(); savedAt.value = changed ? '尚未同步到服务器' : auth.dataMode === 'api' ? '草稿已同步到服务器' : '本地演示草稿已保存'; dirty.value = changed }
        else {
          clearTimeout(timer); clearTimeout(remoteTimer); requestKey = ''; requestBody = ''; draftId.value = undefined; store.published(post, changed)
          if (changed) {
            hydrating = true; store.editingId = post.id; form.value.expectedRevision = post.revision; dirty.value = true
            localSave(); savedAt.value = '已发布提交版本，后续输入尚未同步'; queueMicrotask(() => { hydrating = false })
          } else { clearLocal(); hydrate({ type: 'general', title: '', contentBlocks: [], bindings: [], topicIds: [], visibility: 'public', status: 'published' }) }
        }
        return !changed
      } catch (cause) { if (epoch === store.epoch && owner === auth.user?.id) { error.value = cause instanceof Error ? cause.message : '保存失败'; if (cause instanceof ApiError) { conflict.value = cause.status === 409; draftUnavailable.value = !!draftId.value && (cause.status === 404 || (cause.status === 400 && cause.message === '草稿不存在或无权操作')); if (cause.status >= 400 && cause.status < 500) unconfirmed = undefined }; localSave() }; return false }
      finally { if (epoch === store.epoch && owner === auth.user?.id) saving.value = false; if (pending === operation) pending = null }
    })
    pending = operation
    return pending
  }
  watch([form, body, code, quote, language, images], () => {
    if (hydrating || !store.composerOpen) return
    dirty.value = dirty.value || hasContent() || !!draftId.value || !!store.editingId; clearTimeout(timer); clearTimeout(remoteTimer)
    if (!dirty.value) return
    const owner = auth.user?.id, epoch = store.epoch
    const current = () => !!owner && owner === auth.user?.id && epoch === store.epoch
    timer = setTimeout(() => { if (!current()) return; try { localSave() } catch { error.value = '浏览器存储空间不足，请保存服务端草稿' } }, 2000)
    remoteTimer = setTimeout(() => { if (current() && store.composerOpen && dirty.value && !conflict.value && !draftUnavailable.value) void save(true) }, 10000)
  }, { deep: true })
  watch([() => auth.user?.id, () => store.epoch], () => {
    clearTimeout(timer); clearTimeout(remoteTimer); hydrating = true
    body.value = ''; code.value = ''; quote.value = ''; images.value = []; topics.value = []; bindingTitles.value = {}; bindingLoading.value = false; topicsLoading.value = false; draftId.value = undefined; dirty.value = false; saving.value = false; error.value = ''; closePrompt.value = false; pending = null; requestKey = ''; requestBody = ''; conflict.value = false
    savedAt.value = ''; unconfirmed = undefined; draftUnavailable.value = false
    form.value = { type: 'general', title: '', contentBlocks: [], bindings: [], topicIds: [], visibility: 'public', status: 'published' }
    queueMicrotask(() => { hydrating = false })
  }, { flush: 'sync' })
  const close = () => { if (saving.value) { error.value = '正在保存或上传，请稍后再关闭'; return }; if (dirty.value) void saveAndClose(); else store.composerOpen = false }
  const discard = () => { if (saving.value) return; clearTimeout(timer); clearTimeout(remoteTimer); clearLocal(); requestKey = ''; requestBody = ''; unconfirmed = undefined; dirty.value = false; closePrompt.value = false; store.composerOpen = false }
  const saveAndClose = async () => { if (await save(true)) { closePrompt.value = false; store.composerOpen = false } }
  const readServer = async () => {
    const id = store.editingId || draftId.value
    if (!id) return
    const owner = auth.user?.id, epoch = store.epoch, session = editorSession
    const current = () => owner === auth.user?.id && epoch === store.epoch && session === editorSession && store.composerOpen && id === (store.editingId || draftId.value)
    try {
      const post = await communityApi.post(id)
      if (!current()) return
      hydrate({ type: post.type, title: post.title || '', contentBlocks: post.contentBlocks, bindings: post.bindings.filter((b) => b.status !== 'unavailable').map((b) => ({ type: b.type, id: b.id })), topicIds: post.topics.map((t) => t.id), visibility: post.visibility, status: post.status === 'draft' ? 'draft' : 'published', expectedRevision: post.revision, contribution: post.contribution ? { kind: post.contribution.kind, categoryId: post.contribution.categoryId, tags: post.contribution.tags, teachingReuseConsent: post.contribution.teachingReuseConsent, sourceName: post.contribution.sourceName, sourceUrl: post.contribution.sourceUrl, videoAssetId: post.contribution.videoAssetId, attachmentFileId: post.contribution.attachmentFileId, coverFileId: post.contribution.coverFileId } : undefined })
      requestKey = ''; requestBody = ''; unconfirmed = undefined; localSave(); savedAt.value = '已读取服务器版本'; dirty.value = false
    } catch (cause) { if (current()) { error.value = cause instanceof Error ? cause.message : '服务端版本读取失败'; if (cause instanceof ApiError && cause.status === 404 && draftId.value) draftUnavailable.value = true } }
  }
  const keepCopy = () => { store.editingId = undefined; draftId.value = undefined; form.value.expectedRevision = undefined; conflict.value = false; draftUnavailable.value = false; requestKey = ''; requestBody = ''; unconfirmed = undefined; error.value = ''; dirty.value = true; localSave() }
  onScopeDispose(() => { clearTimeout(timer); clearTimeout(remoteTimer) })
  return { form, body, code, language, quote, images, topics, bindingType, bindingId, bindingSearch, bindingTitles, bindingOptions, source, preview, saving, bindingLoading, topicsLoading, error, savedAt, closePrompt, dirty, draftId, blocks, advanced, conflict, draftUnavailable, readServer, keepCopy, loadTopics, loadOptions, addBinding, upload, uploadFiles, save, restore, close, discard, saveAndClose }
})
