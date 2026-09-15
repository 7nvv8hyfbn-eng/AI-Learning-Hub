# 平台基本架构

## 组件

| 组件 | 技术 | 职责 |
| --- | --- | --- |
| 学生端 `frontend/` | Vue 3、Pinia、Vue Router | 读取已发布内容，回写学习、收藏、实训、测评和成长行为 |
| 管理端 `admin-web/` | Vue 3、Element Plus、AntV G2 | 内容编辑、发布、撤回、运营配置及业务数据查询 |
| 服务端 `server/` | NestJS、Prisma | 认证、领域级 RBAC、发布、内容、行为、SSE、文件和外部适配 |
| 数据库 | PostgreSQL | 内容、版本、用户、行为、统计与审计的唯一正式数据源 |
| 文件存储 | 本地、MinIO 或 S3 | 文件实体；数据库只保存元数据 |
| 公共契约 `packages/contracts/` | TypeScript | 状态枚举、响应信封、分页和跨端 DTO |

## 数据流

```text
管理端创建/编辑草稿
  → NestJS 校验与 RBAC
  → PostgreSQL 保存草稿、不可变快照并记录审计
  → 发布指针原子切换后公开 API 返回新快照
  → 学生端 API 模式读取
  → 学习行为写回 PostgreSQL
  → 管理端读取同一用户与行为记录
```

学生端默认 `api`；普通生产构建必须显式设置 `VITE_DATA_MODE=api`，Mock 仅由独立演示命令进入并显示标识。API 失败不回退 Mock。课程、实训、资讯、题目及首页采用草稿/已发布双指针或发布快照，发布前修改不会污染学生端。

## 登录后学习社区

未登录的 `/` 与 `/welcome` 使用独立 LandingLayout，登录默认进入 `/community`，安全的站内 `redirect` 优先。教程中心 `/resources` 允许访客浏览已发布公开内容的标题和封面；教程正文、视频、附件、合集及社区、课程、实训、资讯、测评与个人页面需登录。条款、隐私、验证邮箱和密码恢复使用公共布局。

落地页首屏五张卡片使用代码中的固定内容与本地图片，不随数据库推荐或构建变化。其余区域沿用 HomepageModule、HomepageItem、草稿与发布快照；`/__homepage-preview` 与正式入口共用 LandingRenderer。动态引用仍检查公开可见性，历史配置与发布版本保留。

邮箱注册在同一事务创建学生角色关系、社区资料、协议记录、活动与会话；首次引导复用学习主题和话题关注。快捷／高级发布器共用草稿状态及原发布服务，草稿使用同一动态模型。统一搜索只检索可见动态、用户、话题与已发布学习快照。新迁移仅增量补充账号字段及哈希令牌、限流表，不重建既有学习数据。

社区使用现有 User、School、RBAC、文件存储与学习对象，不建立平行账号、课程或实训系统。`ContentReferenceService` 批量解析已发布内容；私人笔记和本人已提交的 LabRun 只能主动分享。允许自动生成成就草稿的设置默认关闭，即使开启也不会自动发布。

推荐管线依次执行八类有界召回、批量特征补齐、集中规则打分、可见性过滤及多样性混排。策略集中在 `server/src/modules/feed/feed-policy.ts`；加密游标绑定用户、模式、类型和策略快照。一小时会话内排序固定，后续页仍重新检查可见性；排序故障退回执行相同门禁的时间流。普通 DTO 不返回内部打分、举报人或其他人的私人实训记录。

ActivityEvent 是行为事实源，UserFeedSignalSnapshot 按创建时间增量聚合最近 90 天事件；历史补录、窗口过期或版本变化时完整重建。学习行动、有效互动和强负反馈均参与推荐。社区通知与平台公告保持不同数据源，在通知页合并展示。

注册、发帖、草稿和评论使用数据库事务及 RequestIdempotency；同键重放返回原记录，不重记事件。帖子保存不可变 CommunityPostRevision，编辑携带 `expectedRevision`，旧版本返回 409。浏览器只保留未同步恢复副本；未确认响应先重放原键，再把后续编辑写入同一记录。

UsersModule 管理账号资料、状态、会话与审计；成长模块继续负责学习数据。认证变更与会话签发按用户行锁串行，停用、锁定、密码重置和强制退出使旧 Access/Refresh 会话失效。可见性与批量内容映射集中复用；运营不能读取从未发布的草稿，包括已软删除稿件。

## 关键边界

- 服务端为模块化单体，不引入微服务、Kubernetes 或 Redis。
- Refresh Token 可撤销；管理接口由服务端 RBAC 校验。
- 主题、课程、实训、资源、文章、挑战、题库、成长、首页和设置为独立 NestJS 模块；共享内容层只提供分页、序列化、校验、审计等窄能力。
- 六个内容领域使用草稿与已发布版本指针；公开接口只读取已发布快照，资源历史恢复会生成新草稿版本。
- 实训只接受结构化白名单动作，不执行任意 Shell、代码或硬件指令。
- 公开题目接口不返回标准答案；测评成绩由服务端计算。
- 《题盒》适配位于 `server/src/integrations/quiz-box/`，当前提供连通性检查、外部答卷读取和同步接收记录；未配置时返回不可用，不代表已完成外部题库及成绩全面同步。
- 微信小程序只通过服务端适配器执行 `code` 换取身份；未配置真实应用密钥时明确返回不可用，不伪造登录成功。
- 通知、登录日志、操作日志和审计日志均持久化；敏感字段不进入公开响应或日志。

## 本地开发

先从 `server/.env.example` 创建未入库的 `server/.env`，填写目标开发库、JWT、初始管理员、存储与 CORS 配置，保持 `LOAD_DEMO_DATA=false`。数据库就绪后执行：

```bash
cd server
npm ci
npx prisma migrate deploy
npm run build
npm run bootstrap
npm run content:sync
npm run content:verify
npm run start:dev
```

分别在两个终端的仓库根目录启动双端，每个终端只执行对应一行：

```bash
cd frontend && npm ci && VITE_DATA_MODE=api VITE_API_BASE_URL=http://127.0.0.1:3000/api/v1 npm run dev
cd admin-web && npm ci && VITE_API_BASE_URL=http://127.0.0.1:3000/api/v1 npm run dev
```

默认开发入口为学生端 `:5173`、管理端 `:5174`、API `:3000`。启动前将 `server/.env` 的开发 URL 配置为：

```dotenv
CORS_ORIGINS=http://127.0.0.1:5173,http://127.0.0.1:5174
FRONTEND_URL=http://127.0.0.1:5173
ADMIN_WEB_URL=http://127.0.0.1:5174
```

端口有变化时同步调整以上配置，API 模式不得回退 Mock。

`bootstrap` 只补基础配置与管理员；课程、社区帖子和教程由[正式内容同步](../deploy/PROJECT_CONTENT.md)导入，不需要演示账号或 Seed。后台发布至少三个学习方向后再开放首次引导。

正式环境拓扑、备份、扩缩容及发布策略见 [服务部署方案](deployment/service-deployment.md)。
