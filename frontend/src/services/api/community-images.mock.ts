// 演示图片与视频一样只在当前页面会话内保留。
export const demoImages = new Map<string, File>()
const coverUrls = new Map<string, string>()

export const mockCoverUrl = (id?: string) => {
  if (!id || !demoImages.has(id)) return null
  if (!coverUrls.has(id)) coverUrls.set(id, URL.createObjectURL(demoImages.get(id)!))
  return coverUrls.get(id)!
}

export const resetMockImages = () => {
  for (const url of coverUrls.values()) URL.revokeObjectURL(url)
  coverUrls.clear()
  demoImages.clear()
}
