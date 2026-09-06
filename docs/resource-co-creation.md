# 资源中心共创

资源共创以 `CommunityPost` 作为唯一内容与社交事实。资源首页、社区帖子、作者主页和后台管理均引用同一 `postId`，点赞、评论、收藏、关注、举报和上下架不复制数据。原有 `Resource`、下载、收藏和课程关系继续保留。

## 数据与状态

| 模型 | 用途 |
| --- | --- |
| `ResourceContribution` | 帖子的资源形态、分类、标签、封面、附件及教学复用授权 |
| `VideoAsset` | 原文件、可播放文件、海报和 `uploaded / processing / ready / failed` 处理状态 |
| `LearningCollection`、`LearningCollectionItem` | 私人或社区合集、稍后再看、稳定顺序和修订号 |
| `ResourceWatchProgress` | 本人私有的续播位置、有效观看时长和完成状态 |
| `CollectionCourseReference` | 合集到课程草稿版本的引用关系，不复制媒体文件 |

公开资源必须同时满足：帖子已发布、未删除、作者有效、资源贡献存在；视频还必须为 `ready`。上传成功、处理完成和帖子发布是三个独立状态，处理失败不会删除帖子草稿。课程引用还要求社区合集、公开资源和作者授予教学复用权限。

## 上游机制与许可边界

本轮只研究机制，没有复制上游源代码或引入其运行时。实际核对路径和本项目取舍如下：

| 上游 | 实际参考路径 | 许可证 | 本项目采用的最小机制 |
| --- | --- | --- | --- |
| MediaCMS | [`files/models`](https://github.com/mediacms-io/mediacms/tree/main/files/models)、[`files/tasks.py`](https://github.com/mediacms-io/mediacms/blob/main/files/tasks.py) | [AGPL-3.0](https://github.com/mediacms-io/mediacms/blob/main/LICENSE.txt) | 只借鉴“媒体状态持久化、异步处理与失败重试”的边界；未复制模型、任务代码或管理界面 |
| PeerTube | [`server/core/models/video/video.ts`](https://github.com/Chocobozzz/PeerTube/blob/develop/server/core/models/video/video.ts)、[`support/nginx/peertube`](https://github.com/Chocobozzz/PeerTube/blob/develop/support/nginx/peertube)、[`config/default.yaml`](https://github.com/Chocobozzz/PeerTube/blob/develop/config/default.yaml) | [AGPL-3.0](https://github.com/Chocobozzz/PeerTube/blob/develop/LICENSE) | 只借鉴“内容状态与视频技术状态分离、受控文件交付、代理层大文件配置”的机制 |
| Video.js | [`src/js/player.js`](https://github.com/videojs/video.js/blob/main/src/js/player.js) | [Apache-2.0](https://github.com/videojs/video.js/blob/main/LICENSE) | 详情页当前只需单路 MP4 的暂停、拖动、音量、倍速、全屏和画中画，原生 `<video controls>` 已覆盖，因此未增加播放器依赖 |

最终实现继续使用 Nest、Prisma、现有 `StorageService` 和 FFmpeg/ffprobe；没有引入 AGPL 代码，也没有建立独立媒体平台。

## 媒体运行

服务端接收单文件磁盘流，随后通过 `StorageService` 流式写入本地或 S3，避免把大文件整体读入内存。视频任务由持久状态驱动，服务重启后可回收超时任务；FFmpeg/ffprobe 使用参数数组执行，默认有限重试。容器运行镜像已安装 FFmpeg。

资料上传只允许 PDF、DOCX、PPTX、ZIP、TXT。服务端同时校验扩展名、MIME 和小段文件头；文件不会被执行或自动解压。

关键环境变量：

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `VIDEO_UPLOAD_MAX_MB` | `1024` | 视频上限，服务端限制为 1～1024MB |
| `RESOURCE_ATTACHMENT_MAX_MB` | `100` | 资料上限，服务端限制为 1～500MB |
| `VIDEO_PLAYBACK_SECRET` | 回退 `JWT_SECRET` | 播放、封面和下载短期签名密钥，正式环境应独立设置 |
| `VIDEO_ORPHAN_RETENTION_HOURS` | `168` | 无引用视频保留时间，限制为 24～720 小时 |
| `FFMPEG_PATH` | `ffmpeg` | FFmpeg 可执行文件路径 |
| `VIDEO_PROCESSING_MAX_ATTEMPTS` | `3` | 视频处理最大尝试次数，限制为 1～5 |

播放器只在详情页请求播放信息。播放地址带短期用途签名，支持 `GET`、`HEAD`、单段 `Range` 和 `416`；附件使用独立下载用途签名。首页仅加载封面，不预加载视频。

后台“资源中心管理”可查看处理失败、重试任务和清理孤立上传。清理操作按保留期和真实引用判断，并写审计日志；不得手工删除存储目录代替清理接口。

## 演示数据

固定演示数据位于 `packages/demo-fixtures/src/resource-hub.ts`，媒体位于 `frontend/public/demo/resource-hub/`，包括 24 张 16:9 封面、3 张 Banner、16 个 H.264/AAC 八秒演示片段和 3 份下载资料。Mock 与 API 使用相同契约；正式 API 不会回退到 Mock。

演示数据库只在明确指定时导入或清理：

```bash
cd server
npm run resource:import-demo
npm run resource:cleanup-demo
```

导入按稳定 ID 幂等写入，不属于 `bootstrap` 或正常启动流程。已有人工修改和非演示数据不得通过完整 Seed 覆盖。

## 接口与验证

学生端接口前缀为 `/api/v1/resource-hub`，包含首页、分类、完整结果搜索、详情、创作中心、作者作品、上传、播放、进度和合集。后台接口前缀为 `/api/v1/admin/resource-hub`，使用现有 `resource.read / resource.write`、`community.report.manage` 和 `course.write` 权限。

本地静态回归：

```bash
(cd frontend && npm run lint && npm test && npm run build:mock && VITE_DATA_MODE=api npm run build)
(cd server && npm run lint && npm run typecheck && npm test && npm run build)
(cd admin-web && npm run lint && npm run typecheck && npm run build)
```

### 二十项验收证据

| # | 验收项 | 当前证据与结论 |
| --- | --- | --- |
| 1 | 普通用户发布视频、图文、资料 | 同一高级编辑器、共享 DTO、固定 Mock 三种形态及构建通过；真实 PostgreSQL 端到端待新环境 |
| 2 | 新主题无课程也可投稿 | 资源贡献只要求资源分类，不要求课程或实训绑定；类型检查与 Mock 发布链通过 |
| 3 | 上传、处理、发布分离 | `VideoAsset.status` 与 `CommunityPost.status` 分离；上传后轮询持久状态，未 `ready` 时服务端拒绝发布 |
| 4 | 失败保留原稿、重启恢复 | 失败只更新视频资产；草稿仍在；持久任务认领、有限重试和超时任务回收已有服务端测试 |
| 5 | 不整文件 Buffer 上传或播放 | Multer 临时文件到 `uploadPath`，固定 1MB 缓冲区哈希后由存储驱动路径落盘，播放用范围流；50MB 路径上传的 RSS 与 JS heap 增量分别受 32MB、16MB 上限约束，并发落盘对象键互异 |
| 6 | Chrome、Safari 实际播放与拖动 | Codex 内置 Chromium 已实际播放，并检查原生播放器的暂停、拖动、音量、倍速、全屏和画中画入口；项目规则不允许擅自切换外部浏览器，Safari 尚未验收 |
| 7 | `Range`、无 `Range`、`HEAD`、超范围与取消 | GET/HEAD、开放范围、后缀范围、越界和多范围拒绝均有服务端单测；响应关闭会销毁当前文件流 |
| 8 | 上传和播放鉴权接入现有账号 | 上传接口继续使用现有 Bearer 认证；播放先经业务鉴权签发六小时用途受限凭据，文件端再次校验用途、目标、有效期和内容可见性 |
| 9 | 用户间作品、合集和观看记录隔离 | 视频状态只允许上传者读取，作者操作沿用 `authorId`，合集写操作校验 `ownerId`，观看记录使用 `userId + videoAssetId` 唯一键；真实 PostgreSQL 多用户端到端待新环境 |
| 10 | 社交互动复用社区数据 | 贡献内容继续使用 CommunityPost 的点赞、评论、收藏和用户关注关系，没有新增视频评论、点赞、关注表 |
| 11 | 四类入口指向同一作品 | 资源中心、社区、作者页和后台均使用同一 `postId`；作者下架与 Mock 公开入口移除测试通过，播放再次校验可见性 |
| 12 | 搜索分类作用于完整结果 | 服务端先合并完整来源再筛选排序分页；24 条固定数据筛选测试通过 |
| 13 | 稍后观看、合集排序、续播持久化 | Prisma 模型、修订冲突、去重排序和进度单调累计已有前后端测试 |
| 14 | 图文不依赖旧 Article | 图文直接保存为 `CommunityPost + ResourceContribution`，固定演示数据和契约测试通过 |
| 15 | 管理员下架后全入口同步 | 继续复用社区治理和同一 `postId`；可见性与播放守卫共用，真实数据库治理链待新环境 |
| 16 | 旧资源、链接、下载、收藏保留 | 旧 `Resource` 服务和路由未删除，三端类型检查与构建通过；生产数据回归待新环境 |
| 17 | 合集引用课程草稿且不复制文件 | 校验公开、作者有效、复用授权；幂等生成现有课程草稿块并保留源引用 |
| 18 | 课程版本与既有进度稳定 | 只写草稿版本，不覆盖已发布快照；合集修订变化会提示维护者人工复核 |
| 19 | 素材对应且视频可播放 | 24 张封面、3 张 Banner、16 个 H.264/AAC 演示片段均存在；真实 FFmpeg 链已验证兼容 MP4、竖屏 WebM、带旋转侧数据 MOV，ffprobe 与内置浏览器检查通过 |
| 20 | Mock/API 一致且正式模式不假成功 | 共用 contracts；API 模式构建通过，客户端严格按 `VITE_DATA_MODE` 选择，不在请求失败时回退 Mock |

真实环境还必须在迁移后的 PostgreSQL 上验证用户 A 投稿、用户 B 发现和互动、50MB 上传内存、并行文件、后台下架、服务重启恢复与课程草稿引用。本机 Mock、单测和构建不能替代该验收。

## 消融结论

固定样本为 24 条资源、16 个视频、同一演示账号与内置浏览器环境；每次只改变一个因素，并重复同一构建或页面测量。

| 因素 | 实际结果 | 结论 |
| --- | --- | --- |
| 单次 Banner 包装函数 | 内联后 5 项资源 Mock 测试和 Mock 构建通过 | 删除包装函数 |
| 投稿服务重复资料校验 | 删除后仍由既有 `StorageBase.uploadPath` 拒绝错误扩展名、MIME 和伪造文件头；资源定向测试通过 | 删除重复白名单和第二次文件头读取 |
| 卡片 `showWatchLater` 显隐 | 移除后个人作品页出现 11 个无处理器按钮；恢复后为 0 | 保留局部显隐属性 |
| 无合集详情单列规则 | 1440×900 下移除后播放器由 1034px 缩为 738px并空出 296px；恢复后为 1034px | 保留一条 `.single` 规则 |
| 首页聚合请求 | 固定 24 条数据运行 101 次：聚合 P25/P50/P75 为 0.3658/0.3742/0.4038ms、40,783B；三次拆分为 0.2827/0.2884/0.3018ms、21,414B | 本地 Mock 差异小；保留聚合接口以提供一致快照并避免真实网络三次请求 |

微基准只衡量本机内存 Mock，不代表真实数据库查询或网络性能。临时测试文件和实验开关均未保留。
