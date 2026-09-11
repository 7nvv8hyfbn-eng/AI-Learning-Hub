# 内容媒体契约

## 数据与版本

`MediaAsset` 保存稳定 `assetKey`、`FileRecord` 引用、用途、分类、替代文字、焦点、来源和修订号。六类内容的 `coverAssetId` 与普通资源附件 `fileId` 完全独立。`dataOrigin` 区分 `demo_seed`、`admin_created` 和 `imported`，不授予演示记录特殊删除权。

编辑封面只修改内容行及当前草稿快照。已经发布的内容从发布快照读取封面；修改、移除或替换草稿封面不会提前改变发布版。发布沿用各内容领域的既有事务、版本指针和关系复制流程。

课程封面和正文插图进一步固定 `fileId`，素材换图不会改变历史课程版本。`illustration` 用途、后台维护和显式课程升级见 [通识课程内容与插图](curriculum.md)。

## 唯一解析顺序

新数据固定按以下顺序解析：

1. 有效且公开的显式 `coverAssetId`；
2. 内容类型与分类对应的有效默认规则；
3. 内容类型的 `generic` 规则；
4. 平台 `global/generic` 规则。

仅当旧快照**没有** `coverAssetId` 属性时，允许保留安全的旧 `cover`。该兼容值不能覆盖显式 ID；显式 `null` 表示管理员移除，直接进入默认链，旧 `cover` 不会复活。归档、软删除或非公开资产不作为公共封面。所有规则缺失时返回空值，不伪造资源。

旧 URL 只允许普通相对路径或无账号信息的 HTTP(S) 地址，拒绝 `data:`、`javascript:`、`blob:`、控制字符、反斜杠、临时签名及令牌参数。服务器不抓取远程旧 URL。新内容写入 DTO 不再接收任意 `cover` URL。

六类列表、社区内容引用及公共搜索共用批量解析：一次收集显式 ID、一次读取默认规则，循环不再查询数据库。Mock 与 API 共用 `packages/catalog-assets/manifest` 的资源映射及分类归一键。

## 访问、上传与权限

公共稳定入口是 `/api/v1/public/media/:id`，只允许有效公共媒体。原有私有文件、资源下载和社区附件入口不变。S3 可以在此稳定入口即时重定向，临时地址不得保存为内容封面。

后台详情、预览、引用、列表分别受 `media.read` 控制；上传和编辑使用 `media.write`；删除使用 `media.delete`；默认规则及公共 Hero 配置使用 `media.default.manage`。不得借用 `resource.write` 或社区权限。后台预览需携带认证信息获取 Blob，并释放对象 URL，不能直接给 `<img>` 一个需要 Bearer 的地址。

资源附件下载授权与下载计数使用已发布快照的 `fileId`，不读取当前草稿附件。发布快照缺失附件或可见性字段时不会退回草稿授权；原作者与资源编辑者的管理权限保持不变。

上传限制为 5 MB、16–8192 像素、最多 3200 万像素的静态 PNG/JPEG/WebP。实际字节长度、扩展名、MIME、封装完整性、PNG CRC 与完整像素解码均校验。PNG CRC 使用 Node 22.2 起提供的原生 `zlib.crc32`；镜像 Node 22.14 的构建门禁包含已知测试向量。

SVG 仅允许管理员上传基础静态矢量子集；拒绝脚本、外链、实体、处理指令、`foreignObject`、`image`、`use`、`style`、事件属性等主动内容。普通上传入口不因此放宽。

公共素材 checksum 去重仅查询 `catalog/` 下公共文件；相同私有文件绝不被转成公开文件。相同二进制不能被导入为不同语义 `assetKey`。新对象使用独占键，数据库写入失败时确认没有已提交记录后补偿删除，不会误删其他并发事务的文件。

上传或导入的第二阶段资产/审计事务失败时，再次加锁检查文件绑定，仅对未绑定文件排队补偿；已提交或共享资产不会被删除。删除暂时失败时保留持久化重试队列。归档资产可恢复；软删除资产在保留期内不可通过重复上传自动复活。

## 导入与演示内容

在已构建服务端目录执行：

```sh
npm run media:import
npm run media:import -- --bind-existing-demo
npm run seed:demo-media
npm run seed:demo
```

`media:import` 先验证整个正式清单和所有文件，拒绝路径越界及符号链接；随后按 `assetKey` 幂等导入。相同 checksum 且存储对象存在时零写入；默认规则只补缺失项，不覆盖人工选择。素材替换保留管理员编辑过的元数据、归档状态与历史文件审计。

`--bind-existing-demo` 是独立显式升级，不属于启动流程。仅匹配清单中的真实 slug 和原始标题，保留人工 ID、有效旧图片及显式移除。只补内容行的 `coverAssetId`、对应 payload 字段和 `dataOrigin`，以及当前草稿/发布指针所指快照的封面字段。标题、正文、关系、时间、发布指针及其他历史快照不变。上线前应在克隆库逐行比较允许字段外的投影。

`seed:demo` 显式设置 `LOAD_DEMO_DATA=true`。空库使用完整初始化 Seed；已初始化库只恢复 `dataOrigin=demo_seed` 的软删除内容，不重播全量业务 Seed。媒体导入不会创建业务内容。恢复保留的版本、章节和关系；正常启动不恢复删除内容。完整初始化仍需通过环境变量提供既有 Seed 账号配置，禁止在源码或日志保存凭据。

## 删除、归档与清理

移除内容封面仅写 `null`。删除内容仅软删除普通内容记录，保留资产和历史。资产删除先检查六类内容行、全部历史版本、默认规则及公共 Hero 配置；任何引用都阻止删除。默认资产应先替换规则，再归档或清理。

```sh
npm run demo:cleanup
DEMO_CLEANUP_CONFIRM=SOFT_DELETE_DEMO_ONLY npm run demo:cleanup -- --apply
npm run media:gc
MEDIA_GC_CONFIRM=ARCHIVED_UNREFERENCED npm run media:gc -- --apply
```

两类清理默认只预览。演示清理只软删除明确标记的演示内容，不删除账号、资产或历史。媒体 GC 仅处理归档超过 30 天、无所有引用且不是默认资源的资产。

PG 与文件系统/对象存储不是跨系统原子事务。媒体 GC 先事务写入 `MediaGcJob` 重试队列再解除资产，文件和记录成功删除后才移除队列；失败返回未完成队列，可复核后重试。未知数据库提交结果下宁可保留对象，不冒险删除。历史替换审计中仍引用的旧文件保留，不作为可回收对象。

## 后台操作

六类管理页共用素材选择器，支持选择、替换、移除和默认图预览。普通字段保存不会重写旧封面，选择或移除才提交 `coverAssetId`。素材库支持名称、用途、内容分类、来源、状态、未使用筛选，以及上传、说明和焦点编辑、引用检查、归档与默认规则维护。删除确认固定目标，写入期间锁定操作；并发修订冲突后可重新读取素材及默认规则。

系统设置的页面主视觉只编辑六个 typed Hero 字段，与普通系统配置隔离。素材预览请求共享会话刷新机制，切换与卸载时取消旧请求、释放 Blob URL。资源附件仍使用独立上传和版本恢复入口。

## 可重复验证

```sh
npm run prisma:validate
npm run prisma:generate
npm run lint
npm run typecheck
npm run test
npm run build
npm run check:seed-runtime
npm run test:e2e
```

单测覆盖解析、缺失与 null、查询数量、上传截断与恶意 SVG、checksum 去重、数据库失败补偿、清理队列、导入幂等、路径安全及演示数据保护。`check:seed-runtime` 仅校验缺少应用源码时两个 npm 前置生命周期和已编译模块，不实际执行 Seed。E2E 需要隔离 PostgreSQL 与项目测试环境；不得在普通业务库运行。资产生成原图、提示词和审核证据在仓库外保存，正式资源、清单、测试及契约进入 Git。本机静态检查不替代服务器运行验收与浏览器验收。

在 `admin-web` 运行 `npm run test:media`，使用无网络内存单元验证 Bearer 刷新、Blob 生命周期、固定删除目标、修订刷新及六类页面接线；另执行 `npm run check`。这些检查不启动应用服务，不替代真实界面操作与图片解码验收。
