# 前后台字段与页面映射

| 管理端 | 学生端 | 数据/API |
| --- | --- | --- |
| 社区运营 | `/community`、动态/话题/用户详情、`/bookmarks`、`/notifications` | 统一社区 DTO、可见性门禁、真实学习对象绑定与不透明推荐游标 |
| 门户首页（原 `/homepage`） | 未登录 `/`、`/welcome` | 已发布整页快照、允许的 `moduleKey`、`resolvedItems` |
| 通识基础 | `/topics` | 主题详情、学习路径、稳定 `stageKey` |
| 课程内容 | `/courses/:courseId` | 课程版本、章节、课时、内容块、课时完成聚合 |
| 实训项目 | `/labs`、`/labs/:labId` | 已发布步骤、活动运行、动作事件、服务端评分 |
| 教程中心 | `/resources` | 资源元数据、文件绑定、显式浏览事件 |
| AI 前沿 | `/frontier` | 文章内容块、受控推荐位、独立定时发布 |
| 挑战测评 | `/assessments` | 题库、知识点、五题型判分、最好成绩和排行 |
| 用户成长 | `/profile` | 服务端成长快照、积分、学习/实训/测评记录 |

通用映射：

- 既有内容列表 `id` 使用稳定 `slug`；社区动态和关系使用独立稳定 ID，学习绑定同时携带公开路由与可选 slug，不能将他人的私人 LabRun ID 暴露给普通用户。
- 前端 `description` 对应服务端 `summary`。
- 领域扩展数据位于 `data`，不得覆盖 `id`、`slug`、状态和时间字段。
- 状态值使用英文枚举，中文标签由界面映射。
- 后台编辑保存草稿；公开接口只读已发布快照，不承担浏览统计或定时发布写入。
- 首页管理预览与学生端共用 `HOMEPAGE_MODULE_KEYS` 和 `PublicHomepageDto` 渲染契约；推荐项通过真实内容选择器关联并可排序。
- 六个领域分别使用 `*.read / *.write / *.publish` 权限；课程结构/关联/预览、五类实训面板、五题型组卷和资源版本恢复均使用专用接口。

关键字段颗粒度：

| 后台字段 | 数据库存储 | 公开 DTO | 学生端位置 |
| --- | --- | --- | --- |
| 课程封面/分类视觉 | `Course.payload.cover/coverVariant` | `CourseData.cover/coverVariant` | 课程卡、课程详情 Hero |
| 课程难度/时长/讲师 | `Course.payload.level/hours/instructor` | `CourseData` 同名字段 | 列表元信息、详情教师信息 |
| 课程章节与课时 | `CourseVersion → Chapter → Lesson → Block` | `CourseDetailDto.chapters` | 左侧目录、中间内容、右侧下一节 |
| 实训时长/步骤/完成率 | `Lab.payload` 与 `LabStep` | `LabData`、`LabDetailDto.steps` | 实训卡、工作台任务区 |
| 资源格式/下载量 | `Resource.format/downloadCount` | `ResourceSummaryDto.format/downloads` | 资源卡、热门下载 |
| 资讯封面/阅读量 | `Article.payload.coverVariant`、`viewCount` | `ArticleData.coverVariant`、`views` | 焦点资讯、文章列表 |
| 挑战题量/时长/奖励 | `Challenge.payload`、`rewardPoints` | `ChallengeData`、`rewardPoints` | 本周挑战、模拟测评 |
| 首页标题/视觉/显示数量 | `HomepageModule.config` | `PublicHomepageModuleDto.config` | 12 个领域模块 |
| 首页推荐关系 | `HomepageItem` | `resolvedItems` | 课程、实训、资源等领域卡片 |
