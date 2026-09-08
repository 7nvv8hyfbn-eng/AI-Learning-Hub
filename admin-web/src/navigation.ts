export const adminNavigationGroups = [
  { label: '工作台', items: [['dashboard', '数据看板', '/dashboard', 'dashboard.read']] },
  { label: '社区运营', items: [['article', '社区运营', '/community', 'community.read']] },
  { label: '学习内容', items: [
    ['theme', '通识基础', '/themes', 'theme.read'], ['course', '课程内容', '/courses', 'course.read'],
    ['lab', '实训项目', '/labs', 'lab.read'], ['resource', '教程中心', '/resources', 'resource.read'],
    ['article', 'AI 前沿', '/articles', 'article.read'], ['challenge', '挑战测评', '/challenges', 'challenge.read'],
    ['media', '素材库', '/media', 'media.read'],
  ] },
  { label: '用户运营', items: [['users', '用户与账号', '/users', 'user.read'], ['growth-user', '用户成长', '/growth', 'growth.read']] },
  { label: '门户与系统', items: [['homepage', '门户落地页', '/homepage', 'homepage.read'], ['settings', '系统设置', '/settings', 'settings.read']] },
]
export const visibleAdminNavigation = (permissions: string[]) => adminNavigationGroups.map((group) => ({ ...group, items: group.items.filter((item) => permissions.includes(item[3])) })).filter((group) => group.items.length)
