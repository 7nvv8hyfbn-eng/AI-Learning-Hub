import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { reactive } from 'vue'
import type { IDomEditor, IEditorConfig } from '@wangeditor/editor'
import type { CommunityContentBlock } from '@ai-learning-hub/contracts'
import BaseRichEditor from '../src/community/coop/BaseRichEditor.vue'
import { setupComponent, flushRender } from '../src/community/test-renderer'
import { communityApi } from '../src/services/api/community'

const draft = reactive({ richBlocks: [] as CommunityContentBlock[], richError: '', error: '', saving: false, registerUpload: () => () => {} })
vi.mock('../src/community/composables/useCommunityDraft', () => ({ useCommunityDraft: () => draft }))
vi.mock('../src/stores/community', () => ({ useCommunityStore: () => ({ composerOpen: true, composerSession: 1, epoch: 1 }) }))
vi.mock('../src/stores/auth', () => ({ useAuthStore: () => ({ user: { id: 'owner' } }) }))
vi.mock('../src/community/composables/useCommunityAccess', () => ({ useCommunityAccess: () => ({ requireWrite: () => true }) }))
vi.mock('../src/services/api/community', () => ({ communityApi: { image: vi.fn(), upload: vi.fn() } }))
vi.mock('@wangeditor/editor', () => ({ DomEditor: {}, SlateEditor: {}, SlateElement: {}, SlateNode: {}, SlateRange: {}, SlateTransforms: {} }))
vi.mock('@wangeditor/editor-for-vue', () => ({ Editor: {}, Toolbar: {} }))
vi.mock('../src/community/coop/sanitize', () => ({ sanitizeRichHtml: (html: string) => html }))
vi.mock('../src/community/coop/rich-blocks', () => ({
  blocksToRichHtml: (blocks: CommunityContentBlock[]) => JSON.stringify(blocks),
  richHtmlToBlocks: (html: string) => { if (html.includes('external')) throw new Error('外部图片不可用'); return [{ type: 'rich_text', text: html }] },
}))
type State = {
  handleCreated: (editor: IDomEditor) => void
  replaceWithHtml: (html: string) => void
  customPaste: (editor: IDomEditor, event: ClipboardEvent, done: (allowed: boolean) => void) => void
  editorConfig: IEditorConfig
}
let unmount: (() => void) | undefined
beforeEach(() => { vi.resetAllMocks(); Object.assign(draft, { richBlocks: [{ type: 'rich_text', text: '<p><strong>原稿</strong></p>' }], richError: '', error: '', saving: false }) })
afterEach(() => { unmount?.(); vi.restoreAllMocks() })
it('无光标时恢复与导入整篇正文，不使用光标插入接口', async () => {
  const mounted = setupComponent<State>(BaseRichEditor); unmount = mounted.unmount
  const editor = { setHtml: vi.fn(), getHtml: () => '<p>导入</p>', enable: vi.fn(), disable: vi.fn(), destroy: vi.fn() } as unknown as IDomEditor
  mounted.state.handleCreated(editor)
  await flushRender()
  expect(editor.setHtml).toHaveBeenCalledWith(JSON.stringify(draft.richBlocks))
  mounted.state.replaceWithHtml('<p>导入</p>')
  expect(editor.setHtml).toHaveBeenLastCalledWith('<p>导入</p>')
  expect(draft.richBlocks).toEqual([{ type: 'rich_text', text: '<p>导入</p>' }])
  const callback = vi.fn()
  mounted.state.customPaste(editor, { clipboardData: { getData: () => 'external' } } as unknown as ClipboardEvent, callback)
  expect(callback).toHaveBeenCalledWith(false)
  expect(mounted.state.editorConfig.customPaste).toBeUndefined()
})
it('图片上传完成才插入预览；失败保留正文并释放保存锁', async () => {
  const mounted = setupComponent<State>(BaseRichEditor); unmount = mounted.unmount
  const insert = vi.fn(), original = JSON.stringify(draft.richBlocks)
  vi.mocked(communityApi.upload).mockRejectedValueOnce(new Error('上传失败')).mockResolvedValueOnce({ id: 'owned-file' } as Awaited<ReturnType<typeof communityApi.upload>>)
  vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:owned-preview')
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
  const upload = mounted.state.editorConfig.MENU_CONF.uploadImage.customUpload
  await upload(new File(['fixture'], 'fixture.png'), insert)
  expect(insert).not.toHaveBeenCalled()
  expect(JSON.stringify(draft.richBlocks)).toBe(original)
  expect(draft.saving).toBe(false)
  await upload(new File(['fixture'], 'fixture.png'), insert)
  expect(insert).toHaveBeenCalledWith('blob:owned-preview', 'fixture.png')
  expect(draft.saving).toBe(false)
})
