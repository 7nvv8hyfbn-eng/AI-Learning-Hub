# 校园部署

保留单体 API、PostgreSQL、现有文件卷和 Compose。学生入口与管理入口分开；数据库和 API 不映射宿主机端口。

## 选择配置

- `.env.production.example`：正式环境。校内 DNS、可信 HTTPS、精确 Origin、Secure Cookie、管理员 MFA、管理网/VPN 和随机密钥均为必要条件。
- `.env.experience.example`：受控局域网 HTTP 体验，显式设置 `COOKIE_SECURE=false`。仍使用真实 API、关闭 Demo Seed、保留 MFA 和后台网络限制。此配置不等于正式验收通过。

全新空库可生成随机密钥，目标文件已存在时拒绝覆盖：

```sh
node deploy/compose/init-env.mjs production .env.production
# 或：node deploy/compose/init-env.mjs experience .env.experience
```

填写实际 `FRONTEND_URL`、`ADMIN_WEB_URL`，`CORS_ORIGINS` 精确包含这两个 Origin，不带尾斜杠。填写初始管理员邮箱、符合共享密码策略的初始密码，以及真实管理电脑 /32 或 VPN 网段。管理员仅在空库缺少管理员时创建；既有账号不会覆盖。

**升级既有部署不得重新生成数据库密码、IDENTITY_DATA_KEY 或 MFA_DATA_KEY。** 保留原环境文件和卷，仅补充缺失配置。密钥与数据库备份分别保管；MFA 密文绑定账号，替换密钥会导致预检失败。

```sh
export ENV_FILE="$(pwd)/.env.production"
export APP_COMMIT_SHA="$(git rev-parse HEAD)"
export APP_IMAGE_TAG="$APP_COMMIT_SHA"
docker compose --env-file "$ENV_FILE" -f deploy/compose/docker-compose.yml build
bash deploy/compose/release.sh
```

预检失败列出具体配置项，并阻止迁移和 API 启动。配置预检不能证明外部 DNS、证书、浏览器或校方代理已经正确。

两种配置均使用[项目内容同步](../PROJECT_CONTENT.md)：100 篇社区帖子与 200 条回复、24 门通识课程、24 条教程及媒体和公共播放列表、13 项模拟实训与 90 个步骤，以及 4 个社区话题和 3 个无凭据、无管理权限的官方展示主页。项目内容统一署名“平台内容”，不导入测试账号；新部署与增量发布都必须同步，并保留人工修改、删除和业务数据。

进程和就绪探针 `/api/v1/health/live`、`/api/v1/health/ready` 允许内部 HTTP，仅返回状态；运维详情仍受管理网、MFA 和权限限制。已有备份部署须同时合并 `deploy/operations/compose.operations.yml`，保留原运维目录和配置；备份容器通过内部 `data` 网络连接数据库，通过 `edge` 网络访问独立备份仓库。

## 代理和网络

推荐校方反向代理终止 HTTPS，再转发到本项目两个 HTTP 入口。使用校内 DNS 与浏览器信任的证书；禁止忽略证书错误验收。同机代理保持 `BIND_ADDRESS`、`ADMIN_BIND_ADDRESS` 为回环；远端代理时绑定专用内网地址，并以宿主机防火墙只允许该代理访问入口端口。

`EXTERNAL_PROXY_CIDRS` 只填写内层 Nginx 实际看到的校方代理出口地址。`ADMIN_NETWORK_CIDRS` 填写真实客户端管理网或 VPN 网段，不能为了放行代理而把整个学生网加入管理范围。默认空值拒绝非回环客户端。

校方边缘代理必须覆盖客户端传入的转发头，例如在已配置可信证书的 HTTPS `server` 内：

```nginx
location / {
    proxy_pass http://校园应用专用地址:8080;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $remote_addr;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header Forwarded "";
}
```

管理域名转发到管理入口，并在校方代理再次限制管理网/VPN。内层 Nginx 仅从明确代理恢复客户端地址与协议，再覆盖转发给 API 的头。API 只信任 Compose 中两个固定 Nginx IP；改 `PROXY_SUBNET` 或代理 IP 时必须同步 `TRUSTED_PROXY_CIDRS`，不能信任整个 Docker 网段。

学生 Nginx 拒绝管理 API、后台认证和 Swagger。API 同时检查管理网段、有效设备会话、MFA 与权限，管理令牌经普通业务端点使用时也检查网络边界。生产 Swagger 默认关闭。

未来演示只映射学生入口。匿名门户仅展示仍满足可见性条件且作者明确授权的摘要、署名和公开简介；社区内 `public` 不代表同意匿名展示。

## 账号与会话

- 管理账号首登使用认证器绑定 TOTP；服务端使用 otplib 验证，AES-256-GCM 保存密钥，恢复码仅保存 SHA-256 哈希，明文只显示一次。每组 TOTP 和恢复码不可重放。普通学生不强制 MFA。
- 保存恢复码后再进入后台；丢失认证器可用恢复码登录并在“账号安全”重新生成恢复码。恢复码也遗失时没有绕过 MFA 的网页入口，需校方核验身份后制定定向恢复操作。
- 新密码至少12位，含字母数字，拒绝常见弱口令和账号衍生口令，最多72个 UTF-8 字节。旧 bcrypt 密码仍可登录；改密使用统一策略。
- 改密、换邮箱、绑定微信和生成恢复码需要当前密码；已绑定 MFA 的账号还需要第二因素。换邮箱确认邮件发送到新地址，确认前原邮箱不变；确认后撤销全部会话，校园认证需重新核验。
- 配置 SMTP 后启用邮件变更。未配置或发送失败时返回明确错误，不会直接修改邮箱。校方真实 SMTP 送达另行验收；正式配置禁止关闭传输安全。
- 单设备注销/撤销立即使该设备 Access Token 与 Refresh Token 失效；其他设备保留。撤销全部、改密和确认新邮箱提升 `sessionVersion`，全部旧会话失效。刷新轮换保持设备 ID，并拒绝并发重放。
- 视频、图片和附件的签名链接绑定设备会话；每次读取重新检查会话、内容可见性及管理员网络范围。注销、撤销设备后，旧链接和后续 Range 请求拒绝访问；已经下载的文件和正在传输的响应无法收回。
- 学生和后台刷新 Cookie 使用不同名称、路径，无 Domain；Cookie 不按端口隔离。后端按入口校验 Origin、JSON 与会话类型；两端不能互用刷新 Cookie。
- 旧标签刷新时携带原设备身份；Cookie 已切换账号或设备时拒绝自动续期，不重试原写请求。旧标签退出只撤销原设备，保留其他账号当前的 Cookie，包括旧 Access Token 已过期的情况。

## 升级与验收

增量 Migration `20260908180000_campus_security` 添加 MFA、设备会话、邮箱变更字段和默认关闭的门户授权，不修改旧 `public` 枚举。旧刷新会话统一撤销，旧 Access Token 因缺少设备绑定而拒绝；发布后用户需重新登录。

既有库先备份数据库、文件卷及私有环境文件，在隔离克隆验证全部旧行与文件、迁移第二次无变化和关键业务，再停止旧 API 写入、执行迁移并切换已验证源码。不得执行完整 Demo Seed。新会话结构上线后不能只回退旧镜像恢复弱会话边界；产生新业务数据后禁止用旧备份覆盖。

Nginx 访问日志只记录请求 ID、方法、状态、大小和耗时，不记录 URL、查询、Cookie、邮箱或媒体 token。原始请求错误日志禁用，使用状态码和请求 ID 排查。API 操作日志只记录路由模板、主体 ID 和结果；异常不输出请求体、凭据或原始数据库异常。

现场验收必须包含：真实域名与可信证书；两层代理下真实客户端地址和 HTTPS；学生网伪造转发头仍无法访问后台；DB/API 端口不可达；浏览器跨账号与跨端口 Cookie 隔离；注销/撤销后旧令牌失效；未授权投稿匿名不可见，授权后可展示，撤回立即隐藏。HTTP 局域网测试不得标为 HTTPS 正式验收。

`server/test/campus-security.e2e.spec.ts` 包含真实数据库、HTTP、TOTP、隔离 SMTP、门户授权和媒体设备用例，只允许指定的隔离验收库。`server/test/campus-upgrade.sql` 只允许恢复备份的 `campus_security_upgrade` 库，比较迁移前后的旧行与旧列；不得在业务库执行。它们通过前不能发布。
