# 贡献指南

感谢你关注 AI 数智化学习平台。本项目面向高校学生，围绕 AI 学习、受控实训、挑战测评和创客社区构建完整闭环。欢迎提交问题、文档、测试、界面优化和代码改进。

## 开始之前

建议先阅读：

- [README.md](README.md)：项目定位与验证命令
- [平台基本架构](docs/architecture.md)：数据流、模块边界与本地开发
- [总体视觉标准](DESIGN.md)：学生端、社区和后台的设计约束
- [Catalog 素材说明](packages/catalog-assets/README.md)：封面、头图与 SVG 规范

较大的功能、数据模型或交互改动，请先通过 Issue 说明问题、目标和影响范围，避免重复实现或偏离现有架构。

## 贡献流程

1. Fork 仓库，或从最新 `main` 创建独立分支。
2. 一个分支只处理一个明确问题。
3. 完成修改并通过相关检查。
4. 提交 Pull Request，写明修改内容、验证结果和潜在影响。

推荐分支名：

```text
feat/community-search
fix/course-cover
refactor/media-resolver
docs/deployment-guide
```

## 项目结构

```text
frontend/                 学生端与学习社区
admin-web/                管理后台
server/                   NestJS API、Prisma 与业务规则
packages/contracts/       跨端 DTO、状态和分页契约
packages/demo-fixtures/   显式演示数据
packages/catalog-assets/  内容封面、页面头图与 SVG 的唯一素材源
deploy/compose/           Docker Compose 部署
```

## 本地开发

建议使用与容器一致的 Node.js 22，并准备 PostgreSQL；也可以使用 Docker Compose。

```bash
git clone https://github.com/7nvv8hyfbn-eng/AI-Learning-Hub.git
cd AI-Learning-Hub

cp server/.env.example server/.env

(cd server && npm ci)
(cd admin-web && npm ci)
(cd frontend && npm ci)
```

在 `server/.env` 中配置本地数据库、JWT、CORS 和初始化管理员信息，不要提交真实密钥。

初始化并启动服务端：

```bash
cd server
npx prisma migrate deploy
npm run build
npm run bootstrap
npm run start:dev
```

分别启动学生端和管理端：

```bash
cd frontend
VITE_DATA_MODE=api VITE_API_BASE_URL=http://127.0.0.1:3000/api/v1 npm run dev
```

```bash
cd admin-web
VITE_API_BASE_URL=http://127.0.0.1:3000/api/v1 npm run dev
```

Mock 仅用于独立界面演示：

```bash
cd frontend
npm run dev:mock
```

API 请求失败时不得静默回退 Mock，也不要把浏览器存储当作正式数据源。

## 开发原则

### 数据与服务端

- PostgreSQL 是账号、内容、社区互动、学习记录和审计数据的唯一正式数据源。
- 保持 NestJS 模块化单体，不为普通需求引入微服务、Redis、Kafka 或 Kubernetes。
- Controller 只负责鉴权、参数和响应；校验、事务和业务规则放在对应 Service。
- 管理接口必须经过服务端 RBAC，不能只依赖前端隐藏按钮。
- 社区发帖、草稿、评论等写入继续使用事务、幂等键和修订号。
- 公开接口只读取已发布快照，不得让草稿修改污染线上内容。
- 避免 N+1 查询；列表数据优先批量查询、批量映射和服务端分页。

### Prisma 与迁移

- 数据库结构变化必须新增增量 migration。
- 不修改已经提交的历史 migration。
- 不在共享库或生产库执行 `prisma migrate reset`、`TRUNCATE` 或破坏性重建。
- 新增字段应考虑旧数据、默认值、索引、唯一约束和回滚影响。
- 演示数据只能通过显式 Seed 导入，正常启动不得自动恢复已删除的演示内容。

本地创建迁移时使用独立开发数据库：

```bash
cd server
npx prisma migrate dev --name <migration-name>
npm run prisma:validate
```

### 共享契约

修改 API 字段、枚举、分页或状态时，应同步更新：

- `packages/contracts/`
- `server/`
- `frontend/`
- `admin-web/`

不要让三端各自维护同一业务字段的不同定义，也不要用无约束的 `any` 代替正式 DTO。

### 前端与视觉

- 遵循 [DESIGN.md](DESIGN.md)，保持暖白、品牌橙和现有版式体系。
- 优先复用现有组件、Store 和设计 Token，不复制近似组件。
- 学生端图标统一使用 `AppIcon`；后台优先复用现有 Element Plus 基础组件。
- 新样式使用既有命名空间和 `--amc-*` Token，避免在文件末尾堆叠临时覆盖。
- 中文应自然换行，禁止单字竖排；卡片标题、封面比例和操作区保持一致。
- 修改界面时同时检查桌面、窄桌面和平板或移动端，不得引入横向溢出。
- 保留键盘操作、可访问名称、图片 `alt` 和 `prefers-reduced-motion` 支持。

### 媒体与 SVG

- 课程、实训、资源、文章和挑战素材统一进入 `packages/catalog-assets/`。
- 新素材必须使用稳定 `assetKey`，同步更新 `manifest.json` 和相关说明。
- 禁止外链热图、Base64、带水印素材、图片内烘焙正文或无法确认授权的资源。
- SVG 不得包含脚本、位图、Base64 或外部引用。
- 资源附件与内容封面是不同对象，不能复用同一个业务字段。
- 图片二进制进入本地持久卷、MinIO 或 S3；数据库只保存文件和媒体元数据。

素材变更后执行：

```bash
./server/node_modules/.bin/tsc -p packages/catalog-assets/tsconfig.json
node packages/catalog-assets/verify.cjs
(cd admin-web && npm run test:media)
```

## 提交前检查

按改动范围运行以下命令：

```bash
(cd server && npm run check)
(cd admin-web && npm run check)
(cd frontend && VITE_DATA_MODE=api npm run check)
```

修改 API、认证、数据库、社区写入或发布流程时，再运行：

```bash
cd server
npm run test:e2e
```

修改 Prisma 或持久化链路时，应在独立测试库验证 migration、bootstrap、写入、读取和重启后的数据一致性。

## 提交信息

推荐使用简洁的 Conventional Commits 前缀，说明实际改动：

```text
feat: 增加用户账号筛选
fix: 修复草稿重复发布
refactor: 收敛媒体解析逻辑
test: 补充社区写入测试
docs: 更新部署说明
chore: 升级开发依赖
```

提交信息使用中文或清晰英文均可，不要使用“更新一下”“修复问题”等无法定位范围的描述。

## Pull Request 要求

PR 应尽量小而聚焦，并至少说明：

- 解决的问题和修改范围
- 关键实现方式
- 已执行的验证命令及结果
- 是否包含 API、契约、migration、Seed 或环境变量变化
- 是否存在兼容性、数据迁移或部署影响
- 界面改动前后的截图；涉及响应式时提供至少两个代表性视口

提交前确认：

- [ ] 修改未超出 PR 描述范围
- [ ] 相关 lint、类型检查、测试和构建均通过
- [ ] 没有提交 `.env`、密码、令牌、私钥或真实用户数据
- [ ] 新接口包含 DTO 校验、鉴权和必要的错误处理
- [ ] 数据库变更采用安全的增量 migration
- [ ] 前后端字段已通过共享契约同步
- [ ] 视觉修改符合 `DESIGN.md`
- [ ] 新素材已进入 Catalog 清单并通过完整校验
- [ ] 相关文档已同步更新

## AI 辅助贡献

可以使用 Codex 等工具辅助开发，但提交者必须理解并审核全部改动，对正确性、安全性、授权和测试结果负责。不要直接提交未经检查的生成代码、生成图片或大规模机械重写。

## 安全问题

请不要在公开 Issue 中披露密码、令牌、用户隐私、可利用漏洞或生产环境信息。安全问题应通过仓库所有者可用的私密渠道报告，并提供最小复现和影响说明。

## 行为准则

请保持尊重、聚焦事实，并对不同实现方案进行建设性讨论。骚扰、歧视、泄露隐私或恶意破坏不被接受。

## 许可

提交代码、文档或素材即表示你有权提供这些内容，并同意其按本项目的 [MIT License](LICENSE) 发布。
