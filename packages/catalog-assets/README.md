# Catalog 素材源

本目录是课程、实训、资源、文章、挑战、分类默认封面和页面头图的唯一二进制源，包含118张正式WebP及86个真SVG。完整分类清单见 `docs/catalog-media-plan.md`；缺少任何正式文件时，完整校验失败。

## 清单与接口

`manifest.json` 集中保存 `assets`、`defaultFor` 与 `categoryAliases`。每条资源包含稳定 `assetKey`、相对文件路径、用途、分类、尺寸、中文名称、alt、焦点和生成来源。数据库导入通过该清单建立文件、媒体和默认规则；前端 Mock 通过同一清单构建本地 URL。

`manifest.ts` 只提供类型和清单读取，不包含 Node、Vite、存储地址或第二份映射：

- `catalogAssets` / `catalogManifest`：清单数据。
- `getCatalogAsset(assetKey)`：按稳定键读取素材。
- `normalizeCategoryKey(contentType, categoryKey)`：中文分类别名归一。
- `getDefaultAssetKeys(contentType, categoryKey)`：按分类、类型 generic、平台 generic 返回有序候选键。

主题与课程分类默认规则共享同一个素材文件。未匹配的扩展分类使用类型 generic，不从标题猜测分类。

## 构建与校验

在仓库根目录执行：

```sh
./server/node_modules/.bin/tsc -p packages/catalog-assets/tsconfig.json
node packages/catalog-assets/verify.cjs
```

CommonJS 运行入口为 `dist/manifest.js`，声明入口为 `dist/manifest.d.ts`。三端构建须先编译此共享包。`dist` 是构建产物，不是手工维护的数据源。

生成进行中可使用 `node packages/catalog-assets/verify.cjs --allow-pending` 检查已有文件；返回 `IN_PROGRESS` 仅表示部分检查，不代表完整通过。

校验覆盖唯一键/文件、默认规则、分类归一、WebP 格式、尺寸、体积、全像素不透明、重复二进制和 SVG 安全/一致性。

## 图标

`icons/iconfont.js` 是项目唯一 UI 图标源，使用阿里 iconfont Symbol 模式；所有路径统一为 `currentColor`。`icons/registry.ts` 只维护既有业务名称到 Symbol ID 的映射，学生端和管理端均通过现有图标组件渲染 `<use>`。

未知名称返回中性 `missing` 图标；开发环境警告由页面 `AppIcon` 统一处理。正式 SVG 不含位图、Base64、脚本或外部引用。

## 生成来源

图片均通过内置 `image_gen` 按素材独立生成，选定后仅执行尺寸与 WebP 生产转换。图标使用两张独立生成造型参考，再由代码重绘为真正 SVG。提示词、原图位置、选择记录与源/正式哈希保存在仓库外审查证据，不依赖这些证据目录运行。
