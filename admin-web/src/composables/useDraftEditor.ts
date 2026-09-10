import type {
  AdminDomainCreateInputMap,
  AdminDomainDtoMap,
  AdminDomainUpdateInputMap,
} from '@ai-learning-hub/contracts'
import { api } from '../services/api'
import { ElMessage, ElMessageBox } from 'element-plus'
import AdminCloseIcon from '../components/AdminCloseIcon.vue'

export const useDraftEditor = <K extends keyof AdminDomainDtoMap>(kind: K) => ({
  createDraft: (value: AdminDomainCreateInputMap[K]) =>
    api<AdminDomainDtoMap[K]>(`/admin/${kind}`, { method: 'POST', body: JSON.stringify(value) }),
  saveDraft: (item: AdminDomainDtoMap[K], value: AdminDomainUpdateInputMap[K]) =>
    api<AdminDomainDtoMap[K]>(`/admin/${kind}/${item.databaseId}`, { method: 'PATCH', body: JSON.stringify(value) }),
  removeDraft: async (item: AdminDomainDtoMap[K] | null, reload: () => Promise<void>) => {
    if (!item) return
    try { await ElMessageBox.confirm(`删除“${item.title}”后不会在启动时自动恢复，封面素材不会随内容删除。`, '确认删除内容', { type: 'warning', closeIcon: AdminCloseIcon, confirmButtonText: '删除内容', cancelButtonText: '取消' }) } catch { return }
    try {
      await api(`/admin/${kind}/${item.databaseId}`, { method: 'DELETE' })
      await reload()
      ElMessage.success('内容已删除，素材保持独立')
    } catch (cause) { ElMessage.error(cause instanceof Error ? cause.message : '删除失败') }
  },
})
