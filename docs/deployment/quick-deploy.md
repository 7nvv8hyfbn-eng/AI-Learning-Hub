# Docker Compose 快速部署

适用于本机快速体验，自动构建学生端、管理端、API 和 PostgreSQL。

## 启动

```bash
node deploy/compose/init-env.mjs experience deploy/compose/.env
# 填写初始管理员、真实地址和管理网段；既有部署保留原密钥。
docker compose --env-file deploy/compose/.env \
  -f deploy/compose/docker-compose.yml up -d --build
```

默认入口：

- 学生端：`http://127.0.0.1:8080`
- 管理端：`http://127.0.0.1:8081`
- Swagger 默认关闭，学生入口禁止访问管理 API。

检查与停止：

```bash
docker compose --env-file deploy/compose/.env \
  -f deploy/compose/docker-compose.yml ps
docker compose --env-file deploy/compose/.env \
  -f deploy/compose/docker-compose.yml down
```

数据库和上传文件保存在 Docker 命名卷中；初始管理员及密钥由私有 `.env` 配置，环境文件不进入 Git。升级保留原配置与持久卷。

显式配置 `DEPLOYMENT_PROFILE=experience` 时，管理员密码验证后显示当前可用的六位动态验证码，到期自动刷新；已使用的验证码会等待下一个时间窗。其他环境不提供提示码，仍需认证器完成 MFA。

访客可浏览教程中心的已发布公开资源标题和封面，正文、视频播放、附件及个人合集仍需登录。未发布、下架、校内可见或隔离的封面不通过公开入口提供。

## 注册与邮件

默认开放学生邮箱注册。正式发布先按 [版本流程](../../README.md#版本与发布) 提交并推送固定版本，再通过 `deploy/compose/release.sh` 依次核验制品版本、备份、迁移、`bootstrap`、同步三类项目内容、校验并启动服务。`bootstrap` 补必要角色、权限、设置和首个管理员，`SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD` 不覆盖已有账号；[项目内容同步](../../deploy/PROJECT_CONTENT.md) 不携带测试账号。首次开放注册前，管理员须创建并发布至少三个学习方向，供首次引导选择；注册设置在「系统设置」维护。

正式部署保持 `LOAD_DEMO_DATA=false`，不得对真实业务库重播演示数据。开发测试夹具与正式内容入口分离。

邮箱验证与找回密码需配置 `SMTP_HOST`、`SMTP_PORT`、`SMTP_FROM`、`FRONTEND_URL`，认证邮件服务另填 `SMTP_USER`、`SMTP_PASSWORD`。默认强制 TLS；`SMTP_ALLOW_INSECURE=true` 仅用于隔离邮件验收。注册邮件失败不会撤销已创建账号，可通过 `/auth/email/resend` 重发。找回邮件异步发送，发送期间进程重启需重新申请；不宣称邮件已送达。

邀请注册需在环境变量 `REGISTRATION_INVITE_HASHES` 填入邀请码的 SHA-256 十六进制摘要（逗号分隔）；不在数据库或公开设置保存明文邀请码。当前为可重复使用的邀请码，不包含配额管理。

API 默认不信任转发头。Compose 仅信任两个固定 Nginx 地址，Nginx 覆盖 `X-Forwarded-For`；调整网络时同步两个代理 IP 与 `TRUSTED_PROXY_CIDRS`，勿对外开放 API 容器或信任任意来源。

> 默认只监听 `127.0.0.1`。不要将此 Compose 直接暴露公网；正式部署请使用[校园部署配置](../../deploy/compose/README.md)，先通过生产 preflight，再验证校方 HTTPS 与完整代理链。
