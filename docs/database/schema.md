# 数据库模型

PostgreSQL 是 API 模式的唯一正式数据源，Prisma 模型位于 `server/prisma/schema.prisma`，不可变迁移位于 `server/prisma/migrations/`。

## 领域表

| 领域 | 核心表 |
| --- | --- |
| 用户、组织与权限 | `users`、`schools`、`departments`、`auth_identities`、`refresh_tokens`、`roles`、`permissions`、`user_roles`、`role_permissions`、`login_logs` |
| 注册与账号恢复 | `password_reset_tokens`、`email_verification_tokens`、`registration_throttles`；用户表补充邮箱验证、协议、注册来源、引导及用户名修改时间 |
| 首页运营 | `homepage_modules`、`homepage_module_versions`、`homepage_publications`、`homepage_items` |
| 主题与路径 | `learning_themes`、`learning_theme_versions`、`learning_paths`、`learning_path_stages`、`learning_path_contents` |
| 课程 | `courses`、`course_versions`、`course_instructors`、`course_resources`、`course_labs`、`course_chapters`、`course_lessons`、`lesson_blocks` |
| 学习记录 | `lesson_progress`、`learning_notes`、`favorites`、`learning_plans`、`learning_plan_items` |
| 实训 | `labs`、`lab_versions`、`lab_steps`、`lab_tools`、`lab_tool_bindings`、`lab_resources`、`lab_runs`、`lab_run_snapshots`、`lab_run_events`、`lab_reports` |
| 资源与文件 | `files`、`resources`、`resource_categories`、`resource_versions`、`tags`、`resource_tags`、`resource_views`、`resource_downloads`、`resource_contributions`、`video_assets` |
| 资源合集与进度 | `learning_collections`、`learning_collection_items`、`resource_watch_progress`、`collection_course_references` |
| AI 前沿 | `articles`、`article_versions`、`article_categories`、`article_tags`、`article_views`、`article_publications`、`article_recommendations` |
| 测评与题库 | `question_banks`、`questions`、`question_versions`、`question_options`、`knowledge_points`、`papers`、`paper_questions`、`challenges`、`challenge_rules`、`assessment_attempts`、`assessment_answers`、`wrong_questions`、`user_knowledge_stats`、`ranking_snapshots` |
| 成长与统计 | `growth_points`、`achievements`、`user_achievements`、`certificates`、`user_certificates`、`growth_module_settings`、`activity_events`、`daily_user_statistics`、`daily_content_statistics`、`user_recommendations` |
| 系统与集成 | `notifications`、`notification_reads`、`system_settings`、`audit_logs`、`operation_logs`、`external_mappings`、`sync_jobs`、`idempotency_keys` |
| 社区内容与关系 | `community_profiles`、`community_posts`、`community_post_bindings`、`community_question_states`、`community_comments`、`community_post_reactions`、`community_comment_reactions`、`community_bookmarks`、`community_user_follows`、`community_topics`、`community_post_topics`、`community_topic_follows` |
| 社区治理与推荐 | `community_feedback`、`community_reports`、`community_moderation_actions`、`community_feed_impressions`、`community_feed_sessions`、`user_notifications`、`user_feed_signal_snapshots` |
| 写入一致性 | `community_post_revisions`、`request_idempotency`；用户、社区资料、帖子、评论与设置维护修订号，用户维护会话版本 |

## 约束

- 路由内容使用稳定 `slug`；现有学生端标识在 seed 中保留。
- 内容采用 `draft / reviewing / published / archived` 状态，公开接口只读取已发布快照。
- 课程、实训、资讯和题目维护 `current_draft_version_id` 与 `published_version_id`；首页使用独立发布快照。撤回只改变公开可见性，不覆盖历史快照。
- 内容表包含排序、版本、发布时间、软删除和更新时间。
- 历史学习、实训和测评记录使用外键保护，不随内容下架删除。
- 测评提交、成长积分和行为事件在一个事务内写入。
- 文件仅保存元数据、摘要和对象键，不保存二进制。
- 社区互动复合唯一键保证重复请求幂等；计数与互动关系在同一事务更新，数据库同时约束非负计数、同校范围及举报单一目标。
- 社区帖子和评论软删除；父评论删除保留回复结构，采纳答案删除后问题恢复未解决。多态内容绑定由统一解析服务验证已发布状态和所有权。
- `community_posts.quoted_post_id` 为可空自关联，外键保护原帖且禁止自引用；`inline_references` 保存经服务端核验的话题及用户 ID，修订表保留对应快照。引用计数复用帖子关系，不另设转发内容表。
- `community_post_topics.manual` 区分手选与正文话题；`community_topics.normalized_name` 唯一约束规范名称。增量迁移 `20260910100000_community_inline_quotes` 保留历史重名话题的 ID 与关联，后续新投稿采用唯一规范入口。
- 资源共创以社区帖子为内容主表；视频处理状态、合集顺序、本人观看进度和课程引用分别落独立关系，公开读取同时检查帖子、作者和媒体状态。
- 注册相关账号、角色、资料、活动与会话原子写入；验证／重置令牌只保存 SHA-256 哈希、30分钟有效且一次使用。草稿复用 `community_posts.status=draft`，只允许作者管理。

## 迁移与初始化

```bash
cd server
DATABASE_URL='postgresql://...' npx prisma migrate deploy
npm run build
npm run bootstrap
```

`bootstrap` 只补必要元数据和首个管理员，不修改已有账号、内容、配置或授权。演示 Seed 与前端 Mock 共用 `packages/demo-fixtures`，仅在显式 `LOAD_DEMO_DATA=true` 时允许执行，不属于日常发布流程。

现有库先执行 `prisma migrate deploy`，再运行 `npm run homepage:upgrade`，无需重跑完整 Seed。事务锁内新增五个模块并追加一个发布版本，保留旧模块、人工草稿与历史快照；再次执行零写。检测到部分升级时停止自动操作。`homepage_items` 仅新增可空摘要和封面覆盖列，无数据重建。

新增模型创建新迁移，禁止修改已发布迁移。邮箱与用户名使用大小写不敏感唯一索引；升级前 `npm run persistence:audit` 检查冲突，存在冲突时人工处理，不自动合并或删账号。生产先备份，再执行一次性迁移与 bootstrap。

ActivityEvent 保留旧推荐事件名，`action_type/entity_type/entity_id` 提供规范行为语义；同一事实只写一行。文件清理与内容引用写入共用事务锁，检查全部业务与历史快照引用；维护按稳定游标每批最多扫描50个文件。
