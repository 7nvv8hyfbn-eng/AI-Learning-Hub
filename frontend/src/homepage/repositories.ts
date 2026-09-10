import {
  LANDING_DEFAULT_CONFIG,
  LANDING_MODULE_KEYS,
  LANDING_MODULE_LABELS,
  type LandingPublicAuthor,
  type HomepageResolvedItemDto,
  type PublicHomepageDto,
  type PublicHomepageModuleDto,
} from '@ai-learning-hub/contracts'
import {
  createCommunityFixtures,
  demoArticles,
  demoChallenges,
  demoCourses,
  demoLabs,
  demoResources,
  demoThemes,
  demoStudents,
} from '@ai-learning-hub/demo-fixtures'
import { request } from '../services/api/client'
import { mockFixtureCover } from '../media/catalog'

const itemsByType = {
  theme: new Map(demoThemes.map((item) => [item.slug, item])),
  course: new Map(demoCourses.map((item) => [item.slug, item])),
  lab: new Map(demoLabs.map((item) => [item.slug, item])),
  resource: new Map(demoResources.map((item) => [item.slug, item])),
  article: new Map(demoArticles.map((item) => [item.slug, item])),
  challenge: new Map(demoChallenges.map((item) => [item.slug, item])),
}

const resolve = (type: string, slug: string): HomepageResolvedItemDto | null => {
  if (!(type in itemsByType)) return null
  const value = itemsByType[type as keyof typeof itemsByType].get(slug)
  if (!value) return null
  return {
    targetType: type as HomepageResolvedItemDto['targetType'],
    slug,
    title: value.title,
    summary: value.summary,
    data: { ...value, ...mockFixtureCover(type as keyof typeof itemsByType, value) },
  }
}

export interface HomepageRepository {
  load(): Promise<PublicHomepageDto>
}

export const homepageRepository = (mode: 'mock' | 'api') => mode === 'api' ? ApiHomepageRepository : MockHomepageRepository

export const MockHomepageRepository: HomepageRepository = {
  async load() {
    const fixture = createCommunityFixtures({ courses: demoCourses, labs: demoLabs, articles: demoArticles, themes: demoThemes, students: demoStudents }, new Date('2026-08-31T00:00:00Z'))
    const creators: LandingPublicAuthor[] = fixture.users.slice(0, 4).map((user) => ({ id: user.username, username: user.username, displayName: user.displayName, verifiedType: user.verifiedType, badges: user.verifiedType === 'none' ? [] : [{ code: user.verifiedType, label: ({ official: '官方', teacher: '认证教师', mentor: '学习导师' })[user.verifiedType], tone: user.verifiedType === 'official' ? 'orange' : 'blue' }], headline: `${user.major} · 学习与实践`, followerCount: fixture.follows.filter((follow) => follow.followee === user.username).length }))
    const post = fixture.posts.find((item) => item.type === 'note')!
    const postAuthor = fixture.users.find((user) => user.username === post.author)!
    const note: HomepageResolvedItemDto = { targetType: 'community_post', slug: post.id, title: post.title, summary: post.blocks.filter((block) => block.type === 'paragraph').map((block) => 'text' in block ? block.text : '').join('').slice(0, 160), data: { author: { username: postAuthor.username, displayName: postAuthor.displayName }, commentCount: fixture.comments.filter((comment) => comment.postId === post.id).length, likeCount: fixture.reactions.filter((reaction) => reaction.postId === post.id && reaction.type === 'like').length, cover: 'aiWorkspace' } }
    const experiments = demoLabs.slice(0, 2).map((lab) => resolve('lab', lab.slug)!)
    const modules = LANDING_MODULE_KEYS.map((key, sortOrder): PublicHomepageModuleDto => ({
      id: `mock-homepage-${key}`, moduleKey: key, name: LANDING_MODULE_LABELS[key], sortOrder,
      config: structuredClone(LANDING_DEFAULT_CONFIG[key]) as unknown as Record<string, unknown>,
      items: key === 'landing_hero' ? [note, ...experiments, resolve('resource', demoResources[0].slug)!]
        : key === 'landing_featured' ? [...experiments, note]
          : key === 'landing_community_overview' ? [
            ...fixture.topics.slice(0, 5).map((topic): HomepageResolvedItemDto => ({ targetType: 'community_topic', slug: topic.slug, title: topic.name, summary: topic.description, data: { id: topic.id, postCount: fixture.posts.filter((item) => item.topics.includes(topic.slug)).length, followerCount: 0, recommended: topic.recommended } })),
            ...creators.map((creator): HomepageResolvedItemDto => ({ targetType: 'community_user', slug: creator.username, title: creator.displayName, summary: creator.headline, data: { ...creator } })),
          ] : [],
    }))
    return { pageMode: 'community_landing_v1', community: { members: fixture.users.length, creators }, version: 1, updatedAt: '2026-08-31T00:00:00.000Z', modules }
  },
}

export const ApiHomepageRepository: HomepageRepository = {
  load: () => request<PublicHomepageDto>('/public/homepage'),
}
