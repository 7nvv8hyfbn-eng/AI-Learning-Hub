# 内容媒体素材清单

## 范围与生成门禁

当前清单包含 166 张正式位图：81 张独立内容封面、48 张课程教学插画、31 张分类/全局默认封面及 6 张页面头图。24 门通识课程使用小雪手绘系列，封面和教学插画均为 1200×900；其他封面保持原尺寸，Hero 为 1600×800。课程/文章每图不超过 280 KiB，实训 300 KiB，资源 240 KiB，Hero 400 KiB。

每张课程图片独立调用内置图片工具生成，逐张检查后转换为 WebP。角色保持奶白雪豹幼崽、棕色眼睛、灰褐斑点与橙红围巾；用暖白纸张、水彩和彩铅表现知识场景，不使用外链、拼图裁切或通用图重复充数。旧课程封面保留供历史数据引用。

`manifest.json` 是素材、默认规则和中文分类别名的唯一映射源；`manifest.ts` 只提供类型与读取函数。通识正文与图片版本契约见 [通识课程内容与插图](curriculum.md)。

## 中文分类归一化

不根据标题私自推断类别。下表仅归一化分类语义；没有准确对应分类的已有扩展类别明确进入generic，独立内容仍拥有独立封面。

| 类型 | 当前分类 | categoryKey |
| --- | --- | --- |
| resource | 学习手册 | handbook |
| resource | 知识图解 | handbook |
| resource | 提示词模板 | prompt-template |
| resource | 操作指南 | handbook |
| resource | 检查清单 | generic |
| resource | 命令速查 | command-reference |
| resource | 部署指南 | deployment-guide |
| resource | 配置手册 | handbook |
| resource | 硬件资料 | hardware-material |
| resource | 安全清单 | generic |
| resource | 案例包 | generic |
| resource | 学习模板 | handbook |
| resource | 治理模板 | generic |
| resource | 接口工具 | generic |
| resource | 工作流 | generic |
| resource | 数据集 | generic |
| resource | 参考表 | generic |
| resource | 评审工具 | generic |
| resource | 安全案例 | generic |
| resource | 代码模板 | generic |
| resource | 案例集 | generic |
| resource | Agent 案例 | agent-case |
| article | Agent | agent |
| article | 大模型 | llm |
| article | 多模态 | multimodal |
| article | 机器人 | robotics |
| article | AI 安全 | security |
| article | 模型部署 | generic |
| article | 智能硬件 | generic |
| article | AI 伦理 | security |

回退固定：显式资产→类型+分类默认→类型generic→global/generic。theme默认规则与course共用同一assetKey。page_hero使用六个页面键的默认规则。

## 位图完整清单

完整资产、知识点、alt、焦点和文件路径统一查看 [manifest.json](../packages/catalog-assets/manifest.json)，避免在文档中另维护一份容易失效的图片映射。运行 `node packages/catalog-assets/verify.cjs` 可核验物理文件与清单一致性。

## 图标扫描与补全

扫描AppIcon调用共114处。原实现支持64键（含共享造型别名，不计无名fallback）；fixture使用38键；最终registry共86键，包含中性missing。

- fixture键：api、bot、brain、card、chart、check、chip、code、container、crop、data、database、diagram、edge、energy、file、git、gpu、graduation、image、layers、lock、memory、message、network、note、pulse、scale、search、sensor、server、shield、sliders、template、terminal、tool、users、workflow。
- AppIcon明确字面量及动态分支结果：achievement、arrow-left、arrow-right、arrow-up-right、bookmark、check、close、container、file、graduation、growth、heart、image、layers、lock、menu、message、more-circle、play、plus、refresh、search、shield、terminal、tool、trophy；导航数据另有edit，基础卡片默认值为AI。
- 原实现缺失（含用户指定download及12成就）：AI、agent-builder、brain、command-runner、data、deployment-starter、diagram、download、edit、first-assessment、first-course、first-lab、hardware-maker、high-score、layers、learning-star、network、project-maker、resource-curator、seven-day-streak、sliders；另提供中性missing。
- 扫描已排除三项正则误报：icon是属性名，assessment和project是条件比较值而非图标名。AI显式兼容brain造型，unknown不复用任意业务图标。
- 全部coverVariant：agent、command、deployment、hardware、image、llm、security。
- 成就code：first-course、seven-day-streak、first-lab、deployment-starter、agent-builder、command-runner、hardware-maker、first-assessment、high-score、resource-curator、project-maker、learning-star。
- 原AppIcon将workflow/memory与bot、api/pulse与server、sensor/edge与chip、scale与shield、crop与image、database/rag与search混用造型；本轮分别绘制明确语义SVG。
- AssessmentsView.vue:133直接渲染achievement.icon，属于页面worker整改范围；这里提供全部12个对应SVG。
- CSS扫描未发现以emoji或可见content字符串新增正式图标；empty content仅承担布局装饰。完整114处调用原文另存扫描证据，变量由对应fixture、导航及分类函数统一解析。

最终图标仅path/circle/rect/polyline等矢量元素，viewBox=0 0 24 24、圆端圆角、stroke-width=1.8。未知key使用中性missing，开发警告由AppIcon集成方实现。图标源码与registry由同一矢量路径源产生，不嵌入位图/Base64/外部href。

| 参考assetKey | 用途 | 状态 | 输出 |
| --- | --- | --- | --- |
| icon-reference--catalog | catalog造型参考，独立生成 | 已归档 | UI 图标已统一迁移到 `icons/iconfont.js` Symbol 源 |
| icon-reference--achievements | 成就徽章造型参考，独立生成 | 已归档 | 成就图标已统一迁移到 `icons/iconfont.js` Symbol 源 |
