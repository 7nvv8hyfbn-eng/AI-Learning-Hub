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

## 开发验证

```bash
(cd server && npm ci && npm run check)
(cd admin-web && npm ci && npm run check)
(cd frontend && npm ci && VITE_DATA_MODE=api npm run check)
```

正式启动依次执行迁移与 `bootstrap`，不加载演示数据。初始管理员由环境变量设置；首次开放注册前，需在后台配置并发布至少三个学习方向。社区写入使用事务、幂等键和修订号；用户、草稿、互动及文件元数据以 PostgreSQL 为准。

数据库迁移、环境变量和部署命令见：

- [Docker Compose 快速部署](docs/deployment/quick-deploy.md)
- [基本架构](docs/architecture.md)
- [服务部署方案](docs/deployment/service-deployment.md)
- [API 模块](docs/api/module-api.md)
- [数据库模型](docs/database/schema.md)
- [资源中心共创](docs/resource-co-creation.md)
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
