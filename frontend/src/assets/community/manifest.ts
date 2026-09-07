import composerStudy from './composer/community-composer-study.webp'
import learningNotebook from './rail/learning-plan-notebook.webp'
import topicPlanet from './rail/topic-planet.webp'
import sidebarPlanet from './decoration/sidebar-planet.webp'
import bindingCubes from './decoration/course-binding-cubes.webp'
import emptyStudy from './empty/community-empty.webp'
import booksSorting from './decoration/books-sorting.svg'
import treasureChest from './decoration/treasure-chest.svg'
import officialTeacher from './avatars/official-teacher.webp'
import learningAssistant from './avatars/ai-learning-assistant.webp'
import studentMale01 from './avatars/student-male-01.webp'
import studentMale02 from './avatars/student-male-02.webp'
import studentMale03 from './avatars/student-male-03.webp'
import studentFemale01 from './avatars/student-female-01.webp'
import studentFemale02 from './avatars/student-female-02.webp'
import studentFemale03 from './avatars/student-female-03.webp'

export const communityArt = {
  composer: { src: composerStudy, width: 1200, height: 520 },
  notebook: { src: learningNotebook, width: 480, height: 240 },
  topicPlanet: { src: topicPlanet, width: 560, height: 260 },
  sidebarPlanet: { src: sidebarPlanet, width: 480, height: 360 },
  bindingCubes: { src: bindingCubes, width: 360, height: 220 },
  empty: { src: emptyStudy, width: 480, height: 360 },
} as const

export const booksSortingIcon = booksSorting

export const treasureChestIcon = treasureChest

export const communityAvatars: Record<string, string> = {
  'official-teacher': officialTeacher,
  'ai-learning-assistant': learningAssistant,
  'student-male-01': studentMale01,
  'student-male-02': studentMale02,
  'student-male-03': studentMale03,
  'student-female-01': studentFemale01,
  'student-female-02': studentFemale02,
  'student-female-03': studentFemale03,
}

const studentKeys = ['student-male-01', 'student-male-02', 'student-male-03', 'student-female-01', 'student-female-02', 'student-female-03']
const officialKeys: Record<string, string> = { 'campus-guide-1': 'ai-learning-assistant', 'campus-guide-2': 'official-teacher', 'community-teacher': 'official-teacher', 'community-mentor': 'official-teacher' }

/** 用户名稳定映射，不依赖列表顺序、刷新时间或随机数；无身份键时保留文字回退。 */
export function communityAvatarSource(username?: string, avatarKey?: string) {
  if (avatarKey && Object.hasOwn(communityAvatars, avatarKey)) return communityAvatars[avatarKey]
  const identity = username?.trim().toLowerCase()
  if (!identity) return undefined
  if (Object.hasOwn(officialKeys, identity)) return communityAvatars[officialKeys[identity]!]
  let hash = 2166136261
  for (const char of identity) hash = Math.imul(hash ^ char.codePointAt(0)!, 16777619) >>> 0
  return communityAvatars[studentKeys[hash % studentKeys.length]!]
}

export function avatarCandidates(src?: string | null, username?: string, avatarKey?: string) {
  const real = src?.trim()
  const safe = real && /^(https?:\/\/|\/(?!\/)|blob:)/.test(real) ? real : undefined
  return [...new Set([safe, communityAvatarSource(username, avatarKey)].filter((value): value is string => !!value))]
}
