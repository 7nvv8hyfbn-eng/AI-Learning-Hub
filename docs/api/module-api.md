# API 模块

基础路径为 `/api/v1`。成功响应统一为：

```json
{ "code": 0, "message": "success", "data": {}, "requestId": "req_xxx" }
```

## 认证

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| POST | `/auth/login` | 返回短时 Access Token，并写入 HttpOnly Refresh Cookie |
| POST | `/auth/refresh` | 轮换并撤销旧 Refresh Token |
| POST | `/auth/logout` | 撤销 Refresh Token |
| POST | `/auth/wechat/miniapp` | 微信 `code` 换取身份；未配置时返回 503 |
| POST | `/auth/identities/wechat/bind` | 当前用户绑定微信身份 |
| GET/PATCH | `/me` | 当前用户资料 |
| GET | `/auth/registration-config` | 开放／邀请／关闭模式及邮件能力，不返回密钥 |
| POST | `/auth/register` | 邮箱规范化；同事务创建学生、社区资料、协议、注册事件和会话 |
| POST | `/auth/password/forgot`、`/auth/password/reset` | 通用找回提示；30分钟、一次性哈希令牌；重置后撤销刷新会话 |
| POST | `/auth/email/verify` | 验证注册邮箱；启用验证的账号验证后才能进入社区 |
| POST | `/auth/email/resend` | 限流重发验证邮件；不返回令牌 |

## 公开内容

`GET /public/homepage`、`/themes`、`/courses`、`/labs`、`/resources`、`/articles`、`/challenges` 及各自 `/:slug`。公开接口只返回已发布记录，题目接口不返回标准答案。

## 学习行为

| 模块 | 路径 |
| --- | --- |
| 课程 | `GET /me/courses`、`POST /courses/:id/enroll`、`PUT /courses/:id/progress`、`PUT /courses/:id/note` |
| 实训 | `POST /labs/:id/runs`、`POST /lab-runs/:id/actions`、`GET /lab-runs/:id/events`、`POST /lab-runs/:id/submit` |
| 收藏 | `POST /favorites`、`DELETE /favorites/:type/:id`、`GET /me/favorites` |
| 成长 | `GET /me/growth`、`GET/POST /me/learning-plans`、`PATCH /me/learning-plans/:id` |
| 测评 | `GET /challenges/:slug/questions`、`POST /challenges/:slug/submit` |
| 通知 | `GET /me/notifications`、`POST /me/notifications/:id/read` |

测评提交必须携带 `Idempotency-Key`。实训 SSE 只推送受控状态与日志。

## 学习社区

`GET /community/bindings/context?type=course&id=<id或slug>` 复用内容解析服务返回可见的关联卡片和建议话题；私人实训记录仍验证本人所有权。发布器的内容查找复用既有各领域公开列表，不创建平行内容源。

所有 `/community` 接口均要求有效登录。跨校内容、隐藏/屏蔽内容及非本人草稿统一按不可见处理。

| 能力 | 路径 |
| --- | --- |
| 三类信息流 | `GET /community/feed?mode=for_you|following|latest&type=all&cursor=…&limit=20` |
| 学习上下文与新内容提示 | `GET /community/context`、`GET /community/feed/updates?since=…&mode=…&type=…` |
| 动态与评论 | `/community/posts`、`/community/posts/:id`、`/community/posts/:id/comments`、`/community/comments/:id` |
| 回答采纳 | `POST /community/questions/:postId/accept/:commentId` |
| 幂等互动 | `PUT/DELETE /community/posts/:id/reactions/:type`、`/community/posts/:id/bookmark`、`/community/comments/:id/like` |
| 用户与话题 | `/community/users/:id`、`/community/users/:id/posts|answers|following`、`/community/topics`、`/community/topics/:slug/posts` |
| 幂等关注 | `PUT/DELETE /community/users/:id/follow`、`/community/topics/:id/follow` |
| 负反馈 | `POST /community/posts/:id/hide|not-interested|report`、`/community/users/:id/mute|block`、`/community/comments/:id/report` |
| 通知 | `GET /community/notifications`、`/community/notifications/unread-count`，`POST /community/notifications/:id/read`、`/community/notifications/read-all` |
| 行为 | `POST /community/signals`、`/community/feed/impressions`、`/community/feed/dwell`，曝光和停留支持批量提交 |
| 文件 | `POST /community/media`、`GET /community/media/:id/url`，最多四张、每张 5MB 的 PNG/JPEG/WebP |
| 引导与用户名 | `POST /community/onboarding`、`GET /community/onboarding/schools`、`PATCH /community/profile/username`（只能修改一次） |
| 草稿 | `GET/POST /community/drafts`、`PATCH/DELETE /community/drafts/:id`；复用动态模型且仅本人可见 |
| 搜索 | `GET /community/search?q=…&type=all|posts|users|topics|courses|labs|resources|articles&cursor=…` |

用户公开路由使用 `/community/user/:username`，资料入口为 `GET /community/users/by-username/:username`；关注等受保护写操作使用明确的内部用户 ID。快捷发布和高级编辑共用内容块、图片上传、学习关联及发布接口；每分钟最多新发布5条，草稿保存不计入，发布草稿不能绕过限制。

运营入口 `/admin/community` 使用独立 `community.read/write/moderate/topic.manage/report.manage/official.publish/feed.manage` 权限。官方账号发布、内容编辑、审核、认证和策略调整均记录理由。策略只接受命名参数及安全数值范围，禁止任意代码或公式。

注册、发帖、草稿、评论支持 `Idempotency-Key`（8～128字符，保留24小时）；同键异内容返回409。已有帖子、评论、资料及重要设置编辑必须携带读取时的 `expectedRevision`；首次引导另带 `expectedProfileRevision`。点赞、收藏和关注返回数据库最终状态与计数，不依赖浏览器自增。

`/admin/community/posts|comments|topics|reports|users` 与 `/admin/users` 返回 `{ items, total, page, pageSize }`，`pageSize` 为1～100。帖子支持状态、类型、作者、学校、话题、范围、媒体、举报、日期与稳定排序；用户支持账号关键词、状态、角色、学校、来源、引导、邮箱验证及日期。详情附历史修订、处理记录和可读文件信息；普通私人草稿和令牌不返回，显式导入的官方外部精选草稿可由运营后台审核并确认发布。

## 资源共创

资源作品仍是社区帖子，`ResourceContribution` 只补充视频、图文或资料的技术元数据。所有学生端资源接口要求登录；详情、播放和下载会再次校验帖子公开状态、作者和资源状态。

| 能力 | 路径 |
| --- | --- |
| 首页、分类与完整结果搜索 | `GET /resource-hub/home|categories|items` |
| 详情、作者与创作中心 | `GET /resource-hub/contributions/:postId|creators/:userId|studio` |
| 视频和资料上传 | `POST /resource-hub/uploads/video|document` |
| 播放、重试与进度 | `GET /resource-hub/videos/:id/playback`、`POST /resource-hub/videos/:id/retry`、`PUT /resource-hub/videos/:id/progress` |
| 合集 | `GET/POST /resource-hub/collections`、`GET/PATCH /resource-hub/collections/:id`、合集项增删和排序 |
| 签名媒体 | `GET/HEAD /resource-hub/play/:id`、`GET /resource-hub/media/:id|download/:id` |

后台 `/admin/resource-hub` 提供内容、首页配置、分类、失败处理、举报、合集转课程草稿和孤立上传清理；沿用 `resource.read/write`、`community.report.manage` 与 `course.write` 权限。运行、演示导入和消融证据见[资源中心共创](../resource-co-creation.md)。

## 管理端

- 组织与用户：`/admin/schools`、`/admin/departments`、`/admin/users`、`/admin/users/:id/identities`
- 内容：`/admin/themes|courses|labs|resources|articles|challenges`
- 内容结构：主题路径；课程章节、课时、内容块、关联与排序；实训五类配置、步骤、工具、资源和报告；文章推荐位；题库和试卷均有专用子资源接口
- 操作：内容发布、撤回、归档与排序；课程、实训、文章和题目发布原子切换快照指针
- 门户落地页：`GET /admin/homepage/modules`、`PATCH /admin/homepage/modules/:id`、`GET /admin/homepage/content-options?type=…`、推荐项增删改与排序、`POST /admin/homepage/publish`。固定五区，不允许新增或重新排序区域；能力六项、精选最多三项、话题最多五项、创作者最多四项。`/public/homepage` 返回 `pageMode: community_landing_v1`，预览与发布隔离。
- 数据：`GET /admin/dashboard`、用户成长、排行榜快照、内容统计
- 文件：`POST /admin/files/upload`；类型、大小、路径和可见性由服务端校验
- 设置：`GET/PATCH /admin/settings`，支持字符串、数字、布尔和字符串数组；通知发布、登录/操作/审计日志查询
- 注册：`GET/PATCH /admin/registration/settings`（`settings.read/write`）；禁止通过通用设置绕过注册校验
- 账号：`GET /admin/users/:id`、`PATCH /admin/users/:id`、`PATCH /admin/users/:id/status`、`POST /admin/users/:id/reset-onboarding|reset-password|revoke-sessions`；使用 `user.read/write/session.revoke/export`，修改必须附原因，禁止对当前管理员执行关键操作
- 持久化：`GET /admin/persistence`（`settings.read`）；`POST /admin/persistence/recount|expire-idempotency|unused-files`（`platform.manage`，附原因）。文件清理响应的 `nextCursor` 供下一批继续扫描
- 题盒：`GET /admin/integrations/quiz-box/health`

管理端接口要求 Bearer Token，并按领域校验 `read / write / publish` 权限；未认证返回 401，权限不足返回 403。OpenAPI 页面为 `/api/docs`，机器文档为 `/api/docs-json`。
