import { describe, expect, it } from 'vitest'
import { plainToInstance } from 'class-transformer'
import { validate } from 'class-validator'
import { authorDto, type CommunityAuthor } from '../src/modules/community/community.mapper'
import { normalizeCustomBadges, trustedVerifiedType, userBadgeSettings, type BadgeUser } from '../src/modules/community/user-badges'
import { UserBadgeUpdateDto } from '../src/modules/users/users.dto'

const now = new Date('2026-09-10T08:00:00Z'), context = { now, agreementVersion: 'current' }
const fixture = () => ({
  id: 'synthetic', username: 'synthetic', displayName: '合成版主', status: 'active', profile: {}, emailVerifiedAt: now, agreementVersion: null,
  school: null, major: null, communityProfile: { verifiedType: 'none', customBadges: [], hiddenAutomaticBadges: [], revision: 1 },
  identityVerification: { status: 'approved' }, userRoles: [{ role: { code: 'student', _count: { permissions: 0 } } }], receivedModeration: [], communityRestrictions: [],
  moderatorGrants: ['community', 'tutorials'].map(scope => ({ scope, enabled: true, canDelete: true, canMute: false, canBan: false })),
}) as unknown as CommunityAuthor
const codes = (user: BadgeUser) => userBadgeSettings(user, context).badges.map(badge => badge.code)

describe('统一公开标签与真实资格', () => {
  it('旧的有效双范围授权自动得到一个版主标签，DTO 不含后台信息', () => {
    const dto = authorDto(fixture(), context)
    expect(dto.badges).toEqual([{ code: 'moderator', label: '版主', tone: 'purple', scopes: ['community', 'tutorials'] }])
    expect(JSON.stringify(dto)).not.toMatch(/grantedBy|canDelete|permissions|identityVerification|hiddenAutomatic/)
  })
  it('官方和版主并存，隐藏仅影响显示，不改变 verifiedType 或授权', () => {
    const user = fixture(); user.communityProfile!.verifiedType = 'official'; user.userRoles[0]!.role.code = 'community_official'
    expect(codes(user)).toEqual(['official', 'moderator'])
    const before = JSON.stringify(user.moderatorGrants)
    user.communityProfile!.hiddenAutomaticBadges = ['official', 'moderator']
    expect(codes(user)).toEqual([]); expect(trustedVerifiedType(user)).toBe('official')
    expect(authorDto(user, context).verifiedType).toBe('official'); expect(JSON.stringify(user.moderatorGrants)).toBe(before)
    expect(codes(structuredClone(user))).toEqual([])
  })
  it('撤销一个范围更新说明，撤销全部或没有动作则消失', () => {
    const user = fixture(); user.moderatorGrants[0]!.enabled = false
    expect(userBadgeSettings(user, context).badges[0]!.scopes).toEqual(['tutorials'])
    user.moderatorGrants[1]!.canDelete = false; expect(codes(user)).toEqual([])
  })
  it.each(['disabled', 'locked', 'unverified', 'email', 'agreement', 'restricted', 'admin', 'banned'])('%s 账号没有有效前台版主标签', kind => {
    const user = fixture()
    if (kind === 'disabled' || kind === 'locked') user.status = kind
    if (kind === 'unverified') user.identityVerification!.status = 'revoked'
    if (kind === 'email') { user.profile = { emailVerificationRequired: true }; user.emailVerifiedAt = null }
    if (kind === 'agreement') user.agreementVersion = 'obsolete'
    if (kind === 'restricted') user.communityRestrictions = [{ startsAt: new Date(now.getTime() - 1), endsAt: new Date(now.getTime() + 1000) }]
    if (kind === 'admin') user.userRoles[0]!.role._count.permissions = 1
    if (kind === 'banned') user.receivedModeration = [{ action: 'ban', targetType: 'profile', expiresAt: null }]
    expect(codes(user)).not.toContain('moderator')
  })
  it('到期限制恢复资格，隐藏覆盖仍保留；单纯刷新授权不能恢复显示', () => {
    const user = fixture(); user.communityRestrictions = [{ startsAt: new Date(now.getTime() - 100), endsAt: now }]
    expect(codes(user)).toEqual(['moderator']); user.communityProfile!.hiddenAutomaticBadges = ['moderator']
    user.moderatorGrants = fixture().moderatorGrants; expect(codes(user)).toEqual([])
  })
  it('资料下架时连普通标签也不公开，自动可信身份保持原业务验证', () => {
    const user = fixture(); user.communityProfile!.customBadges = [{ label: '优秀贡献者', tone: 'green' }]
    user.communityProfile!.verifiedType = 'teacher'; expect(trustedVerifiedType(user)).toBe('none')
    user.receivedModeration = [{ action: 'takedown', targetType: 'profile', expiresAt: null }]
    expect(authorDto(user, context)).toMatchObject({ displayName: '账号资料暂不可见', username: '', verifiedType: 'none', badges: [] })
    expect(userBadgeSettings(user, context).publicVisible).toBe(false)
  })
})
describe('普通标签输入边界', () => {
  it('规范化空白控制字符及大小写去重', () => expect(normalizeCustomBadges([{ label: ' 优秀\u0000贡献者 ', tone: 'green' }, { label: '优秀贡献者', tone: 'purple' }])).toEqual([{ label: '优秀贡献者', tone: 'green' }]))
  it.each(['官方', '版 主', '认证教师', '学习导师', 'ＯＦＦＩＣＩＡＬ', '<b>热心</b>', '这是一个超过十二个汉字的普通标签'])('拒绝身份冒充或非法文字 %s', label => expect(() => normalizeCustomBadges([{ label, tone: 'blue' }])).toThrow())
  it('拒绝任意 CSS、外部图标与超量输入', () => {
    for (const value of [[{ label: '热心', tone: 'red' }], [{ label: '热心', tone: 'blue', iconUrl: 'https://invalid.example' }], Array(4).fill({ label: '热心', tone: 'blue' })]) expect(() => normalizeCustomBadges(value)).toThrow()
  })
  it('请求必须有版本、有效原因和限定自动代码', async () => {
    const valid = { expectedRevision: 1, reason: '按公开展示规范调整', hiddenAutomaticBadges: ['moderator'], customBadges: [{ label: '热心同学', tone: 'green' }] }
    expect(await validate(plainToInstance(UserBadgeUpdateDto, valid))).toEqual([])
    for (const change of [{ expectedRevision: 0 }, { reason: '    ' }, { hiddenAutomaticBadges: ['admin'] }, { customBadges: [{ label: '热心', tone: 'red' }] }]) expect((await validate(plainToInstance(UserBadgeUpdateDto, { ...valid, ...change }))).length).toBeGreaterThan(0)
  })
})
