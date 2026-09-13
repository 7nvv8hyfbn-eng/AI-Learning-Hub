> 此目录为历史内容源与隔离测试夹具。正式部署只使用[去除账号信息的项目内容清单](../../../deploy/PROJECT_CONTENT.md)，不再执行本页旧账号导入流程。

# 社区初始化资源

`ai-discussions-v1` 包含 100 篇原创图文主帖、30 份托管账号资料、200 条两层回复和 20 张原创 WebP 配图。四类话题各 25 篇，单图用于 5 篇相关讨论；帖子不绑定课程、实训或学习主题。选题线索记录于 `sources.json`，资源路径、尺寸和 SHA-256 位于 `manifest.json`。

## 初始化

生产与体验配置模板默认启用：

```dotenv
COMMUNITY_STARTER_PACK=ai-discussions-v1
LOAD_DEMO_DATA=false
```

迁移后的 `npm run bootstrap` 先补基础元数据，再导入内容。设为 `none` 可关闭；已有环境没有此变量时也不追加内容。独立校验和导入命令：

```sh
npm run community:check-resources
npm run community:import-starter
```

使用 Compose 时通过一次性 `bootstrap` 服务执行，确保挂载同一 `uploads_data` 与私有 `initialization_data` 卷。文件经过现有存储配额、类型检查和已配置的扫描流程；未配置扫描时保留“未扫描”状态，不标为扫描通过。

## 账号与凭据

账号使用普通 `student` 权限，简介标明“社区演示账号”，不代表独立真实用户。姓名、学号、实名审批和邮箱验证不被伪造；后续参与社区仍遵守现有认证规则。

首次导入随机生成各账号独立密码。数据库只存 bcrypt 哈希，明文清单仅保存在 `COMMUNITY_STARTER_CREDENTIALS_FILE` 指向的 0600 文件中。Compose 固定为 `/workspace/server/var/initialization/community-accounts.json`，该目录仅挂载给一次性初始化服务；不进入 API 文件卷、镜像、日志或 Git。运维人员应通过受保护终端提取至密码管理器，并将初始化卷纳入独立受控备份。

## 重复执行与升级

- 所有资源预检通过后再写入；全批次数据库操作由事务及PostgreSQL advisory lock串行保护，失败回滚账号和帖子，新增未引用图片按现有回收逻辑补偿。
- 完成标记记录版本和内容摘要。重复执行跳过，不重置密码、不重写编辑内容、不复活已删除或下架帖子。
- 旧批次 `ai-posts-01a08549` 通过既有完整导入审计和所有者标记接管，仅增加完成标记与接管审计。标识冲突或未完成的旧导入会停止，不能自动覆盖人工数据。
- 新环境仅在推荐设置不存在时增加偏重新内容的初始策略；已有推荐策略不变。排序随时间和真实用户行为变化，并非永久置顶。
- 该包不使用完整 Demo Seed。回滚应用不删除已导入内容；如需撤下内容，使用现有后台下架流程。数据库和媒体丢失应通过备份恢复，不通过重播初始化修补。

修改已发布资源须使用显式版本升级流程；不要原地更改已有批次的内容摘要。

## 验证

构建后运行资源检查与 `test/community-starter.unit.spec.ts`。真实数据库验收使用 `npm run test:community-starter -- fresh` 或 `-- legacy`，要求专属 `community_starter_fresh` / `community_starter_legacy` 数据库、`COMMUNITY_STARTER_ISOLATED_TEST=true`、私有凭据路径、上传目录和 `COMMUNITY_STARTER_TEST_OUTPUT` 输出目录。`verify` 模式用于同一隔离库重启后复验；脚本拒绝现行业务库名称，不清空数据库。
