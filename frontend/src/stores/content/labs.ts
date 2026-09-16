import type { LabDetailDto, LabSummaryDto, PageResult } from '@ai-learning-hub/contracts'
import { defineStore } from 'pinia'
import { labs as mockLabs } from '../../data/mock'
import { dataMode, request } from '../../services/api/client'
import type { Lab } from '../../types'
import { apiCatalogCover } from '../../media/catalog'
import { localPage, normalizePageQuery, pageKey, pageUrl, type ContentPageQuery } from './paging'

const mapLab = (item: LabSummaryDto): Lab => ({
  id: item.slug,
  title: item.title,
  description: item.summary,
  category: String(item.data.category || item.labType) as Lab['category'],
  level: String(item.data.level || '尚未配置') as Lab['level'],
  minutes: typeof item.data.durationMinutes === 'number' ? item.data.durationMinutes : undefined,
  steps: typeof item.data.steps === 'number' ? item.data.steps : undefined,
  completion: undefined,
  learners: undefined,
  ...apiCatalogCover(item.data),
  coverVariant: item.labType,
  icon: typeof item.data.icon === 'string' ? item.data.icon : undefined,
})

export const useLabsStore = defineStore('content-labs', {
  state: () => ({
    items: [] as Lab[],
    selected: null as LabDetailDto | null,
    page: 1,
    pageSize: 12,
    total: 0,
    keyword: '',
    cache: {} as Record<string, PageResult<Lab>>,
    loading: false,
    error: '',
  }),
  actions: {
    async load(input: ContentPageQuery = {}, force = false) {
      const query = normalizePageQuery(input, this)
      const key = pageKey(query)
      const cached = this.cache[key]
      if (cached && !force) {
        Object.assign(this, cached, { keyword: query.keyword })
        return
      }
      if (dataMode === 'mock') {
        const result = localPage(mockLabs.map((item) => ({ ...item })), query)
        this.cache[key] = result
        Object.assign(this, result, { keyword: query.keyword })
        return
      }
      this.loading = true
      this.error = ''
      try {
        const page = await request<PageResult<LabSummaryDto>>(pageUrl('/labs', query))
        const result = { ...page, items: page.items.map(mapLab) }
        this.cache[key] = result
        Object.assign(this, result, { keyword: query.keyword })
      }
      catch (error) { this.error = error instanceof Error ? error.message : '实训加载失败'; throw error }
      finally { this.loading = false }
    },
    async detail(slug: string) {
      if (dataMode !== 'api') return null
      this.selected = await request<LabDetailDto>(`/labs/${encodeURIComponent(slug)}`)
      return this.selected
    },
  },
})
