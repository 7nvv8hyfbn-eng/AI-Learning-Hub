import { computed } from 'vue'
import type { CommunityEligibilityDecisionDto, CommunityOperation } from '@ai-learning-hub/contracts'
import { useAuthStore } from '../../stores/auth'
import { useCommunityStore } from '../../stores/community'

export function useCommunityAccess() {
  const auth = useAuthStore()
  const community = useCommunityStore()
  const fallback = (operation: CommunityOperation): CommunityEligibilityDecisionDto => operation === 'read' || auth.user?.communityWriteEnabled === true
    ? { allowed: true, reasonCode: null, message: null, availableAt: null, nextAction: null }
    : { allowed: false, reasonCode: 'COMMUNITY_VERIFICATION_REQUIRED', message: auth.user?.identityVerificationStatus === 'pending' ? '认证资料审核中，审核通过后即可参与社区公开操作。' : auth.user?.identityVerificationStatus === 'rejected' ? '认证未通过，请查看审核意见并重新提交。' : auth.user?.identityVerificationStatus === 'revoked' ? '认证已撤销，请重新提交资料。' : '完成校园实名认证后即可参与社区公开操作。', availableAt: null, nextAction: { label: '前往认证', route: '/community/verification' } }
  const decision = (operation: CommunityOperation = 'post') => community.eligibility?.operations[operation] ?? fallback(operation)
  const canPost = computed(() => decision('post').allowed)
  const canComment = computed(() => decision('comment').allowed)
  const availability = (operation: CommunityOperation = 'post') => {
    const value = decision(operation).availableAt
    return value ? `预计 ${new Date(value).toLocaleString('zh-CN')} 解除` : ''
  }
  const requireWrite = (operation: CommunityOperation = 'post') => {
    const current = decision(operation)
    if (current.allowed) return true
    community.accessNotice = current
    return false
  }
  const message = computed(() => decision('post').message || '')
  const nextAction = computed(() => decision('post').nextAction)
  return { canPost, canComment, decision, requireWrite, availability, message, nextAction }
}
