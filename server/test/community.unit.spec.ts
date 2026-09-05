import { describe, expect, it } from 'vitest'
import { CommunityPostType } from '@prisma/client'
import { communityPostTypes } from '@ai-learning-hub/contracts'
import { LearningFeedPipeline } from '../src/modules/feed/feed.service'
import { learningFeedPolicy } from '../src/modules/feed/feed-policy'
import type { CommunityContextDto } from '@ai-learning-hub/contracts'
import { plainToInstance } from 'class-transformer'
import { validate } from 'class-validator'
import { ProfileDto } from '../src/modules/community/community.dto'
import { profileMediaUrl } from '../src/modules/community/community.mapper'

const context: CommunityContextDto = { todayPlan: null, continueCourse: null, continueLab: null, currentChallenge: null, trendingTopics: [], suggestedUsers: [], needsInterests: false }
describe('社区统一策略与契约', () => {
  it('公开类型与生成数据库枚举一致', () => {
    expect([...communityPostTypes].sort()).toEqual(Object.values(CommunityPostType).sort())
    expect(Object.values(learningFeedPolicy.weights).reduce((sum, weight) => sum + weight, 0)).toBeCloseTo(1)
    expect(Object.keys(learningFeedPolicy.candidateLimits)).toHaveLength(8)
  })
  it('混排去重、同作者窗口与类型限制稳定且保留学习行动', () => {
    const pipeline = Object.create(LearningFeedPipeline.prototype) as LearningFeedPipeline
    const rows: Parameters<LearningFeedPipeline['assemble']>[0] = Array.from({ length: 80 }, (_, i) => ({ postId: `p${i}`, source: 'quality', reasonCodes: ['quality'], total: 1 - i / 100, dimensions: {}, authorId: `a${i % 20}`, postType: ['question', 'note', 'lab_result', 'project', 'general'][i % 5], official: i % 15 === 0, publishedAt: new Date(0).toISOString(), contentHash: `hash${i}` }))
    const result = pipeline.assemble(rows, learningFeedPolicy, { ...context, continueCourse: { id: 'course', type: 'course', title: '继续学习', route: '/courses/course' }, currentChallenge: { id: 'challenge', type: 'challenge', title: '挑战', route: '/assessments' } }, true)
    expect(pipeline.assemble(rows, learningFeedPolicy, { ...context, continueCourse: { id: 'course', type: 'course', title: '继续学习', route: '/courses/course' }, currentChallenge: { id: 'challenge', type: 'challenge', title: '挑战', route: '/assessments' } }, true)).toEqual(result)
    expect(result[4].type).toBe('continue_learning'); expect(result[9].type).toBe('challenge')
    const posts = result.filter((entry) => entry.type === 'post')
    for (let i = 0; i < posts.length; i++) {
      const window = posts.slice(Math.max(0, i - 9), i + 1)
      expect(window.filter((entry) => entry.score.authorId === posts[i].score.authorId).length).toBeLessThanOrEqual(2)
      expect(window.filter((entry) => entry.score.official).length).toBeLessThanOrEqual(1)
    }
    expect(new Set(result.map((entry) => entry.id)).size).toBe(result.length)
  })
  it('显式类型筛选不被跨类型多样性规则截断', () => {
    const pipeline = Object.create(LearningFeedPipeline.prototype) as LearningFeedPipeline
    const rows: Parameters<LearningFeedPipeline['assemble']>[0] = Array.from({ length: 30 }, (_, i) => ({ postId: `question${i}`, source: 'quality', reasonCodes: [], total: 1 - i / 100, dimensions: {}, authorId: `author${i % 15}`, postType: 'question', official: false, publishedAt: new Date(0).toISOString() }))
    expect(pipeline.assemble(rows, learningFeedPolicy, context, true, 'question')).toHaveLength(30)
  })
  it('社区资料字段拒绝HTML、控制字符、超长位置和非HTTP网站', async () => {
    const valid = { expectedUserRevision: 1, expectedProfileRevision: 1, displayName: '学习者', bio: '专注模型部署', headline: '持续实践', location: '嘉兴', websiteUrl: 'https://example.com', expertiseTopics: ['LLM'], allowAchievementDrafts: false }
    expect(await validate(plainToInstance(ProfileDto, valid))).toHaveLength(0)
    for (const patch of [{ bio: '<b>简介</b>' }, { headline: '非法\u0000字符' }, { location: '一'.repeat(61) }, { websiteUrl: 'javascript:alert(1)' }, { expertiseTopics: Array(11).fill('方向') }]) {
      expect((await validate(plainToInstance(ProfileDto, { ...valid, ...patch }))).length).toBeGreaterThan(0)
    }
  })
  it('资料图片地址只由当前FileRecord标识生成', () => {
    expect(profileMediaUrl(null)).toBeNull()
    expect(profileMediaUrl('file id')).toBe('/api/v1/files/profile/file%20id')
  })
})
