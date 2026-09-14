import { ref } from 'vue'

export interface AssistantDigestRequest {
  postId: string
  title: string
  nonce: number
}

/** 帖子"小雪简讯"请求：CommunityPostCard 写入，SnowLeopardAssistant 监听并打开浮窗。 */
export const assistantDigestRequest = ref<AssistantDigestRequest | null>(null)

export const requestDigest = (postId: string, title: string) => {
  assistantDigestRequest.value = { postId, title, nonce: Date.now() }
}