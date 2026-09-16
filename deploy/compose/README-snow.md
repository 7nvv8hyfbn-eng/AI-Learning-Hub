# 固定旧学生端与小雪双入口

组合 `docker-compose.yml` 与 `docker-compose.snow.yml`。部署沿用同一个 Compose 项目、API、数据库和上传卷；不运行另一套 bootstrap 或全量 Seed。

- `LEGACY_STUDENT_IMAGE_TAG`：8080 的原始完整提交。本轮为 `7bd833d6388dffaddccbb99a411b88c2bf513b61`，镜像不重建。
- `APP_IMAGE_TAG`、`APP_COMMIT_SHA`：已提交的小雪兼容版本，供 API、后台和 `student-snow` 使用。
- `FRONTEND_URL` 继续指向 8080；`SECONDARY_FRONTEND_URL` 指向 7070；`ADMIN_WEB_URL` 继续指向 8081。`CORS_ORIGINS` 必须精确包含三者。
- `SECONDARY_STUDENT_PROXY_IP` 默认 `172.30.80.12`，`TRUSTED_PROXY_CIDRS` 加入该 `/32`，保留原两个代理。`SNOW_STUDENT_PORT` 默认 7070。
- `student-web` 挂载固定旧入口 Nginx 配置，拒绝 `/api/v1/assistant`；该配置不改变旧镜像的静态文件。
- 模型仍使用服务端 `ASSISTANT_MODEL_*` 私有环境变量，后台只显示状态和测试入口。

## 发布与回退

这是有意保留两个前端提交的部署，不能直接运行要求三端同提交的 `release.sh`。先分别核验三个新镜像的版本与提交，再核验旧学生镜像的版本、镜像 ID 和全部静态文件摘要。对现有数据副本运行双入口和认证验收，备份数据库、上传卷及旧私有配置后，仅更新 `server`、`admin-web`、`student-web` 和 `student-snow`；数据库不重建。

切换 API 后需重启或重载旧入口 Nginx，使其重新解析上游地址。保持 8080 与 8081 的端口和后台网段策略。验收失败时关闭 `student-snow`，恢复旧镜像、旧 Compose 配置与旧私有环境；不要自动恢复旧数据库覆盖新增业务数据。

## 登录行为

同主机不同端口共用学生 HttpOnly Cookie，管理 Cookie 仍使用独立路径。两个学生端沿用现有登录恢复和失效校验，不新增跨端口页面广播。

只有配置了第二学生入口时，单个 API 进程才对学生续期采用两秒同轮合并；新旧 Cookie 在窗口内复用同一结果，每次命中都复核数据库、账号状态和 Bearer 身份。窗口外旧 Cookie 失效，退出、封禁、密码变更和替换登录不能利用缓存恢复。管理员与单学生入口继续采用原来的一次性轮换。该内存协调方案仅用于单 API 进程，不能直接扩为多副本。
