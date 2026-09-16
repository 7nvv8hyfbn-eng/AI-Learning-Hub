# AI 数智化学习平台

面向高校学生的 AI 学习、受控实训与创客社区平台。学生可围绕课程、知识点、实训项目和学习成果共同提问、分享与讨论，并完成学习、收藏、实训和测评回写；管理后台统一维护内容和社区运营，NestJS 执行业务规则，PostgreSQL 提供统一数据源，《题盒》通过适配层接入统一题库与成绩。

## 架构

```text
学生端 Vue 3 ─┐
管理端 Vue 3 ─┼─ Nginx ─ NestJS /api/v1 ─ Prisma ─ PostgreSQL
《题盒》──────┘                         └─ 本地 / MinIO / S3
```

- `frontend/`：学生端默认真实 API；演示使用独立 `dev:mock` / `build:mock`。
- `admin-web/`：内容、社区运营、用户账号、成长数据与存储状态管理。
- `server/`：NestJS 模块化单体、Swagger、RBAC、SSE 与存储适配。
- `packages/contracts/`：跨端状态、分页及 DTO 契约。
- `deploy/compose/`：Docker Compose 快速部署。

## 开始使用

| 目标 | 入口 |
| --- | --- |
| 快速体验完整平台 | [Docker Compose 快速部署](docs/deployment/quick-deploy.md) |
| 从源码启动学生端、管理端与 API | [本地开发](docs/architecture.md#本地开发) |
| 提交问题、文档或代码改进 | [贡献指南](CONTRIBUTING.md) |

源码开发建议使用 Node.js 22，并准备 PostgreSQL；Compose 体验需要 Docker 和 Docker Compose，以及用于生成配置的 Node.js。开发验证命令与服务启动步骤分开说明，首次运行请先完成对应入口中的环境配置。

## 开发验证

```bash
node scripts/release.mjs install
node --test scripts/release.test.mjs
(cd server && npm ci && npm run check)
(cd admin-web && npm ci && npm run check)
(cd frontend && npm ci && VITE_DATA_MODE=api npm run check)
```

## 版本与发布

[version.md](version.md) 记录应用版本和更新摘要。每个新克隆先安装上述仓库级推送检查；已有自定义钩子需整合后再安装。

功能改动精确提交并合并到 `main`，工作树干净且检查通过后，使用统一入口：

```bash
node scripts/release.mjs publish --summary "本批更新摘要"
```

每批 `main` 发布只递增一次补丁版本，同步三端应用清单和锁文件，创建版本提交及附注标签，再原子推送并核验远端。普通分支推送、重复部署不递增。推送失败时原命令可重试；保留未发布提交和标签，不重复加号。远端变化或标签冲突须先检查并解决，禁止强制覆盖。钩子拦截缺少正确版本记录或标签的 `main` 推送；不要使用 `--no-verify` 绕过。

三端构建会检查版本一致性并生成 `dist/version.json`，固定提交构建通过 `APP_COMMIT_SHA` 注入完整 SHA。页面显示各自构建版本；`GET /api/v1/version` 返回服务端 `version`、`commit` 和 `environment`。应用版本与项目内容包版本独立，版本发布不改写用户数据。

正式发布通过 [统一入口](deploy/PROJECT_CONTENT.md) 依次备份、迁移、`bootstrap`、同步三类项目内容并校验，不加载演示账号。初始管理员由环境变量设置；首次开放注册前，需在后台配置并发布至少三个学习方向。社区写入使用事务、幂等键和修订号；用户、草稿、互动及文件元数据以 PostgreSQL 为准。

数据库迁移、环境变量和部署命令见：

- [Docker Compose 快速部署](docs/deployment/quick-deploy.md)
- [基本架构](docs/architecture.md)
- [服务部署方案](docs/deployment/service-deployment.md)
- [API 模块](docs/api/module-api.md)
- [数据库模型](docs/database/schema.md)
- [教程中心共创](docs/resource-co-creation.md)
- [需求覆盖矩阵](docs/mapping/requirements-coverage.md)

## 作者

<table>
  <tr>
    <td align="center">
      <a href="https://github.com/xiaoye1433223">
        <img src="https://github.com/xiaoye1433223.png?size=160" width="80" height="80" alt="xiaoye1433223 的 GitHub 头像" /><br />
        <sub><b>xiaoye1433223</b></sub>
      </a>
    </td>
    <td align="center">
      <a href="https://github.com/15759233">
        <img src="https://github.com/15759233.png?size=160" width="80" height="80" alt="15759233 的 GitHub 头像" /><br />
        <sub><b>15759233</b></sub>
      </a>
    </td>
    <td align="center">
      <a href="https://github.com/wangyun2006">
        <img src="https://github.com/wangyun2006.png?size=160" width="80" height="80" alt="wangyun2006 的 GitHub 头像" /><br />
        <sub><b>wangyun2006</b></sub>
      </a>
    </td>
  </tr>
  <tr>
    <td align="center">
      <a href="https://github.com/Zjw062315">
        <img src="https://github.com/Zjw062315.png?size=160" width="80" height="80" alt="Zjw062315 的 GitHub 头像" /><br />
        <sub><b>Zjw062315</b></sub>
      </a>
    </td>
    <td align="center">
      <a href="https://github.com/zhanglean76-gif">
        <img src="https://github.com/zhanglean76-gif.png?size=160" width="80" height="80" alt="zhanglean76-gif 的 GitHub 头像" /><br />
        <sub><b>zhanglean76-gif</b></sub>
      </a>
    </td>
    <td align="center">
      <a href="https://github.com/7nvv8hyfbn-eng">
        <img src="https://github.com/7nvv8hyfbn-eng.png?size=160" width="80" height="80" alt="7nvv8hyfbn-eng 的 GitHub 头像" /><br />
        <sub><b>7nvv8hyfbn-eng</b></sub>
      </a>
    </td>
  </tr>
</table>

## 许可

本项目采用 [MIT License](LICENSE)。
