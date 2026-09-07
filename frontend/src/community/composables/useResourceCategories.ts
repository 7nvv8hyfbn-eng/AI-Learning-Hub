import { ref } from 'vue'
import type { ResourceHubCategoryDto } from '@ai-learning-hub/contracts'
import { resourceHubApi } from '../../services/api/resourceHub'

const categories = ref<ResourceHubCategoryDto[]>([])
const loading = ref(false)
let pending: Promise<void> | null = null

export const useResourceCategories = () => {
  const load = () => pending ||= (async () => {
    loading.value = true
    try { categories.value = await resourceHubApi.categories() } catch (cause) { pending = null; throw cause } finally { loading.value = false }
  })()
  return { categories, loading, load }
}
