<p align="center">
  <img src="./docs/assets/daily-ai-logo.webp" alt="DAILY-AI HUB Logo" width="75%" />
</p>

<h1 align="center">DAILY-AI HUB</h1>

<p align="center">
  <strong>破盒启智、交互赋能 数训筑基、共创未来。</strong>
</p>

<br />
<br />

<p align="center">
  <a href="#简介">简介</a> ·
  <a href="#架构">架构</a> ·
  <a href="#开发验证">开发验证</a> ·
  <a href="#首次部署与增量更新">部署</a> ·
  <a href="#许可">许可证</a> ·
  <a href="#作者">作者</a>
</p>

<br />

## 简介

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

## 首次部署与增量更新

**首次部署和每次从 GitHub 增量更新，都必须一并导入或同步社区帖子、通识基础和教程中心。** 当前正式内容包包含 100 篇社区帖子及 200 条配套回复、24 门通识课程（144 节课时、72 张图片）、24 条教程及封面、视频、附件、分类和项目公共播放列表。仅拉取代码、更新前端或重启容器不代表内容已更新到业务数据库。

内容来源是仓库内 `server/resources/project-content/content.json`、同目录的 `manifest.json` 及其引用素材，不需要迁移开发者本地数据库。校园服务器、飞牛及其他环境统一按 [项目内容与发布](deploy/PROJECT_CONTENT.md) 执行 `deploy/compose/release.sh`：备份 → 迁移 → `bootstrap` → 三类内容同步 → 校验 → 开放服务。首次导入在管理员初始化之后执行；增量更新保留原账号、业务数据和上传文件。始终保持 `LOAD_DEMO_DATA=false`，不执行 Seed 或导入测试账号；同步报告中的 `protected` 条目须说明保留原因，不能当作已更新。

`bootstrap` 同步 DAILY-AI HUB 品牌默认值，并分别升级门户发布快照与草稿中的旧品牌字段；历史版本不改写，自定义字段保留并列入报告，重复执行不创建重复版本。初始管理员由环境变量设置；首次开放注册前，需在后台配置并发布至少三个学习方向。社区写入使用事务、幂等键和修订号；用户、草稿、互动及文件元数据以 PostgreSQL 为准。

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
