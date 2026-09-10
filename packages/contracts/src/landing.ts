export const LANDING_MODULE_KEYS = ['landing_hero', 'landing_capabilities', 'landing_featured', 'landing_community_overview', 'landing_bottom_cta'] as const
export type LandingModuleKey = typeof LANDING_MODULE_KEYS[number]
export const LANDING_MODULE_LABELS: Record<LandingModuleKey, string> = {
  landing_hero: '首屏设置', landing_capabilities: '社区能力', landing_featured: '精选内容',
  landing_community_overview: '话题与创作者', landing_bottom_cta: '底部行动区',
}
export const LANDING_ICON_KEYS = ['learningQuestion', 'noteSharing', 'labProject', 'challengeCompetition', 'followCommunity', 'growthAchievement'] as const
export const LANDING_IMAGE_KEYS = ['heroArms', 'robotCar', 'robotVision', 'aiWorkspace', 'ctaRobot'] as const
export type LandingTargetType = 'community_post' | 'community_topic' | 'community_user' | 'course' | 'lab' | 'article' | 'resource'
export interface LandingHeroConfig { brandName: string; brandSubtitle: string; eyebrow: string; titleFirst: string; titleSecond: string; description: string; primaryLabel: string; secondaryLabel: string; image: string; memberDisplay: 'count' | 'avatars' | 'hidden' }
export interface LandingCapabilityItem { title: string; description: string; icon: string }
export interface LandingCapabilitiesConfig { title: string; items: LandingCapabilityItem[] }
export interface LandingFeaturedConfig { title: string }
export interface LandingCommunityOverviewConfig { topicsTitle: string; creatorsTitle: string }
export interface LandingBottomCtaConfig { title: string; description: string; buttonLabel: string; image: string }
export interface LandingConfigMap {
  landing_hero: LandingHeroConfig
  landing_capabilities: LandingCapabilitiesConfig
  landing_featured: LandingFeaturedConfig
  landing_community_overview: LandingCommunityOverviewConfig
  landing_bottom_cta: LandingBottomCtaConfig
}
export interface LandingPublicAuthor { badges?: import('./community/badges').CommunityUserBadge[]; id: string; username: string; displayName: string; avatarUrl?: string; verifiedType: import('./community').CommunityVerifiedType; headline: string; followerCount: number }
export const LANDING_DEFAULT_CONFIG: LandingConfigMap = {
  landing_hero: { brandName: 'AI MAKER CAMPUS', brandSubtitle: '高校 AI 创客学习平台', eyebrow: '连接学习者，激发 AI 创造力', titleFirst: '加入 AI 创客社区', titleSecond: '一起学习 · 实践 · 成长', description: '和同学、学长、导师一起探索 AI 的边界，用项目实践想法，让学习真正发生。', primaryLabel: '登录 / 注册', secondaryLabel: '了解社区', image: 'heroArms', memberDisplay: 'count' },
  landing_capabilities: { title: '你可以在社区做什么', items: [
    { title: '学习与提问', description: '提出问题，获得同学与导师的解答建议', icon: 'learningQuestion' },
    { title: '笔记与分享', description: '记录学习笔记，分享知识与实战经验', icon: 'noteSharing' },
    { title: '实训与项目', description: '参与模型、Agent、命令行和硬件项目', icon: 'labProject' },
    { title: '挑战与竞赛', description: '参加社区挑战，检验和提升实践能力', icon: 'challengeCompetition' },
    { title: '关注与交流', description: '关注感兴趣的人、话题和学习方向', icon: 'followCommunity' },
    { title: '成长与成就', description: '积累学习轨迹、实践成果与社区成就', icon: 'growthAchievement' },
  ] },
  landing_featured: { title: '热门内容精选' },
  landing_community_overview: { topicsTitle: '本周热门话题', creatorsTitle: '优秀创作者' },
  landing_bottom_cta: { title: '现在就加入 AI 创客社区', description: '和更多学习者一起，开启你的 AI 创造之旅。', buttonLabel: '登录 / 注册', image: 'ctaRobot' },
}
export const isLandingModuleKey = (key: string): key is LandingModuleKey => (LANDING_MODULE_KEYS as readonly string[]).includes(key)
export const landingTargetTypes = (key: LandingModuleKey): readonly LandingTargetType[] =>
  key === 'landing_community_overview' ? ['community_topic', 'community_user']
    : key === 'landing_hero' || key === 'landing_featured' ? ['community_post', 'course', 'lab', 'article', 'resource'] : []
export const landingItemLimit = (key: LandingModuleKey) => key === 'landing_hero' ? 5 : key === 'landing_featured' ? 3 : key === 'landing_community_overview' ? 9 : 0
export const isLandingImage = (value: unknown) => typeof value === 'string' && (LANDING_IMAGE_KEYS as readonly string[]).includes(value)

/** 三端共用配置白名单；不接受HTML、任意SVG或不受控资源地址。 */
export function landingConfigIssues(key: LandingModuleKey, value: unknown): string[] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return ['配置必须为对象']
  const config = value as Record<string, unknown>
  const defaults = LANDING_DEFAULT_CONFIG[key]
  const issues: string[] = []
  if (Object.keys(config).some((field) => !Object.hasOwn(defaults, field))) issues.push('包含未支持字段')
  for (const field of Object.keys(defaults)) {
    if (field === 'items') continue
    if (typeof config[field] !== 'string' || !(config[field] as string).trim() || (config[field] as string).length > (field === 'description' ? 240 : 100)) issues.push(`${field}长度或类型不合法`)
  }
  if ('image' in defaults && !isLandingImage(config.image)) issues.push('图片必须为本地正式资源')
  if (key === 'landing_hero' && !['count', 'avatars', 'hidden'].includes(String(config.memberDisplay))) issues.push('成员展示方式不合法')
  if (key === 'landing_capabilities') {
    if (!Array.isArray(config.items) || config.items.length !== 6) issues.push('社区能力固定六项')
    else for (const item of config.items) {
      if (!item || typeof item !== 'object' || Object.keys(item).some((field) => !['title', 'description', 'icon'].includes(field))
        || typeof item.title !== 'string' || !item.title.trim() || item.title.length > 30
        || typeof item.description !== 'string' || !item.description.trim() || item.description.length > 80
        || !(LANDING_ICON_KEYS as readonly string[]).includes(item.icon)) issues.push('能力文案或SVG标识不合法')
    }
  }
  return [...new Set(issues)]
}
