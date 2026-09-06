# 内容媒体素材清单

## 范围与生成门禁

当前源码实测：主题6、课程24、实训13、资源24、文章15、挑战5、成就12。生成118张正式位图：81张独立内容封面、31张分类/全局默认封面、6张页面头图；另独立生成catalog和achievements造型参考各1张，参考只用于真SVG重绘。主题复用课程分类默认封面同一文件，不复制二进制。

生成状态按下表记录；“已生成”表示逐图审看并正式转换落盘，不代表全部页面验收完成。使用内置image_gen一素材一调用；逐图审看后生产转换为WebP。不得用拼图裁切、CSS、外链或复制万能图代替；全部正式素材完成前不修改卡片和页面代码。生成来源、最终提示词、源图及最终SHA-256保存在外部证据catalog-media/worker/assets。

最终独占分工：资源/文章素材agent负责60张（资源24、文章15、资源默认7、文章默认6、课程默认7、全局默认1）；素材协调agent负责42张（课程24、实训13、挑战5）及造型参考、清单、manifest、registry；父worker负责16张（Hero6、实训默认6、挑战默认4）。转交均在调用生成工具前确认，禁止重复生成或交叉写入。

统一暖白、品牌橙、低饱和淡紫/科技蓝/薄荷绿/暖黄，柔和3D科技编辑插画。图内无文字、代码、按钮、假UI、Logo和水印；独立内容采用不同主体和构图。封面1200×675；Hero1600×800，主体右侧、左侧标题安全区。课程/文章建议≤280KB，实训≤300KB，资源≤240KB，挑战≤280KB。

manifest.json是素材/默认规则/中文分类别名唯一映射源；manifest.ts只提供类型与读取helper。所有封面后台均可替换；默认素材归档/删除由后台引用规则约束。

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

| assetKey | 类型 / slug | 中文标题 | 用途 | 尺寸 | 分类色 | image2状态 | 文件名 | 默认/独立 | alt文本 | 后台替换 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| course--ai-literacy | course / ai-literacy | 零基础认识人工智能 | 内容封面 | 1200×675 | 淡紫 | 已生成 | images/courses/course--ai-literacy.webp | 独立 | 零基础认识人工智能主题科技插画 | 是 |
| course--llm-zero | course / llm-zero | 从零理解大语言模型 | 内容封面 | 1200×675 | 淡紫 | 已生成 | images/courses/course--llm-zero.webp | 独立 | 从零理解大语言模型主题科技插画 | 是 |
| course--transformer-core | course / transformer-core | Transformer 核心原理 | 内容封面 | 1200×675 | 淡紫 | 已生成 | images/courses/course--transformer-core.webp | 独立 | Transformer 核心原理主题科技插画 | 是 |
| course--prompt-basics | course / prompt-basics | 提示词设计入门 | 内容封面 | 1200×675 | 淡紫 | 已生成 | images/courses/course--prompt-basics.webp | 独立 | 提示词设计入门主题科技插画 | 是 |
| course--rag-practice | course / rag-practice | RAG 检索增强生成实战 | 内容封面 | 1200×675 | 淡紫 | 已生成 | images/courses/course--rag-practice.webp | 独立 | RAG 检索增强生成实战主题科技插画 | 是 |
| course--llm-finetune | course / llm-finetune | 大模型微调基础 | 内容封面 | 1200×675 | 淡紫 | 已生成 | images/courses/course--llm-finetune.webp | 独立 | 大模型微调基础主题科技插画 | 是 |
| course--agent-first | course / agent-first | 构建你的第一个 AI Agent | 内容封面 | 1200×675 | 薄荷绿 | 已生成 | images/courses/course--agent-first.webp | 独立 | 构建你的第一个 AI Agent主题科技插画 | 是 |
| course--function-calling | course / function-calling | Agent 工具调用与 Function Calling | 内容封面 | 1200×675 | 薄荷绿 | 已生成 | images/courses/course--function-calling.webp | 独立 | Agent 工具调用与 Function Calling主题科技插画 | 是 |
| course--agent-memory | course / agent-memory | Agent 记忆与上下文管理 | 内容封面 | 1200×675 | 薄荷绿 | 已生成 | images/courses/course--agent-memory.webp | 独立 | Agent 记忆与上下文管理主题科技插画 | 是 |
| course--multi-agent | course / multi-agent | 多智能体协作系统 | 内容封面 | 1200×675 | 薄荷绿 | 已生成 | images/courses/course--multi-agent.webp | 独立 | 多智能体协作系统主题科技插画 | 是 |
| course--agent-evaluation | course / agent-evaluation | AI Agent 评测与可观测性 | 内容封面 | 1200×675 | 薄荷绿 | 已生成 | images/courses/course--agent-evaluation.webp | 独立 | AI Agent 评测与可观测性主题科技插画 | 是 |
| course--stable-diffusion | course / stable-diffusion | Stable Diffusion 入门 | 内容封面 | 1200×675 | 淡紫粉 | 已生成 | images/courses/course--stable-diffusion.webp | 独立 | Stable Diffusion 入门主题科技插画 | 是 |
| course--comfyui | course / comfyui | ComfyUI 工作流基础 | 内容封面 | 1200×675 | 淡紫粉 | 已生成 | images/courses/course--comfyui.webp | 独立 | ComfyUI 工作流基础主题科技插画 | 是 |
| course--image-editing | course / image-editing | 图像编辑与控制生成 | 内容封面 | 1200×675 | 淡紫粉 | 已生成 | images/courses/course--image-editing.webp | 独立 | 图像编辑与控制生成主题科技插画 | 是 |
| course--generative-ethics | course / generative-ethics | 生成式 AI 伦理与版权 | 内容封面 | 1200×675 | 淡紫粉 | 已生成 | images/courses/course--generative-ethics.webp | 独立 | 生成式 AI 伦理与版权主题科技插画 | 是 |
| course--linux-basics | course / linux-basics | Linux 命令行入门 | 内容封面 | 1200×675 | 科技蓝 | 已生成 | images/courses/course--linux-basics.webp | 独立 | Linux 命令行入门主题科技插画 | 是 |
| course--docker-models | course / docker-models | Docker 与模型容器化 | 内容封面 | 1200×675 | 科技蓝 | 已生成 | images/courses/course--docker-models.webp | 独立 | Docker 与模型容器化主题科技插画 | 是 |
| course--fastapi-inference | course / fastapi-inference | 使用 FastAPI 发布推理服务 | 内容封面 | 1200×675 | 科技蓝 | 已生成 | images/courses/course--fastapi-inference.webp | 独立 | 使用 FastAPI 发布推理服务主题科技插画 | 是 |
| course--vllm-basics | course / vllm-basics | vLLM 推理服务基础 | 内容封面 | 1200×675 | 科技蓝 | 已生成 | images/courses/course--vllm-basics.webp | 独立 | vLLM 推理服务基础主题科技插画 | 是 |
| course--gpu-memory | course / gpu-memory | GPU 与显存基础 | 内容封面 | 1200×675 | 暖黄 | 已生成 | images/courses/course--gpu-memory.webp | 独立 | GPU 与显存基础主题科技插画 | 是 |
| course--aiot-basics | course / aiot-basics | AIoT 智能硬件入门 | 内容封面 | 1200×675 | 暖黄 | 已生成 | images/courses/course--aiot-basics.webp | 独立 | AIoT 智能硬件入门主题科技插画 | 是 |
| course--edge-ai | course / edge-ai | 边缘 AI 模型应用 | 内容封面 | 1200×675 | 暖黄 | 已生成 | images/courses/course--edge-ai.webp | 独立 | 边缘 AI 模型应用主题科技插画 | 是 |
| course--prompt-injection | course / prompt-injection | 提示词注入与模型安全 | 内容封面 | 1200×675 | 青绿 | 已生成 | images/courses/course--prompt-injection.webp | 独立 | 提示词注入与模型安全主题科技插画 | 是 |
| course--ai-privacy | course / ai-privacy | AI 应用隐私与数据治理 | 内容封面 | 1200×675 | 青绿 | 已生成 | images/courses/course--ai-privacy.webp | 独立 | AI 应用隐私与数据治理主题科技插画 | 是 |
| lab--model-service | lab / model-service | 部署你的第一个 AI 模型 | 内容封面 | 1200×675 | 科技蓝 | 已生成 | images/labs/lab--model-service.webp | 独立 | 部署你的第一个 AI 模型主题科技插画 | 是 |
| lab--campus-agent | lab / campus-agent | 构建校园问答 AI Agent | 内容封面 | 1200×675 | 薄荷绿 | 已生成 | images/labs/lab--campus-agent.webp | 独立 | 构建校园问答 AI Agent主题科技插画 | 是 |
| lab--linux-command | lab / linux-command | Linux 文件与目录命令训练 | 内容封面 | 1200×675 | 蓝灰 | 已生成 | images/labs/lab--linux-command.webp | 独立 | Linux 文件与目录命令训练主题科技插画 | 是 |
| lab--service-health | lab / service-health | 模型接口健康检查 | 内容封面 | 1200×675 | 科技蓝 | 已生成 | images/labs/lab--service-health.webp | 独立 | 模型接口健康检查主题科技插画 | 是 |
| lab--rag-lab | lab / rag-lab | RAG 知识库搭建 | 内容封面 | 1200×675 | 薄荷绿 | 已生成 | images/labs/lab--rag-lab.webp | 独立 | RAG 知识库搭建主题科技插画 | 是 |
| lab--multi-tool-agent | lab / multi-tool-agent | 多工具 Agent 开发 | 内容封面 | 1200×675 | 薄荷绿 | 已生成 | images/labs/lab--multi-tool-agent.webp | 独立 | 多工具 Agent 开发主题科技插画 | 是 |
| lab--board-structure | lab / board-structure | AI 开发板结构认知 | 内容封面 | 1200×675 | 暖黄 | 已生成 | images/labs/lab--board-structure.webp | 独立 | AI 开发板结构认知主题科技插画 | 是 |
| lab--sensor-data | lab / sensor-data | 传感器数据采集模拟 | 内容封面 | 1200×675 | 暖黄 | 已生成 | images/labs/lab--sensor-data.webp | 独立 | 传感器数据采集模拟主题科技插画 | 是 |
| lab--image-web | lab / image-web | 图像分类 Web 应用 | 内容封面 | 1200×675 | 品牌橙 | 已生成 | images/labs/lab--image-web.webp | 独立 | 图像分类 Web 应用主题科技插画 | 是 |
| lab--monitor | lab / monitor | 模型服务监控演练 | 内容封面 | 1200×675 | 科技蓝 | 已生成 | images/labs/lab--monitor.webp | 独立 | 模型服务监控演练主题科技插画 | 是 |
| lab--git-cli | lab / git-cli | Git 命令行协作入门 | 内容封面 | 1200×675 | 蓝灰 | 已生成 | images/labs/lab--git-cli.webp | 独立 | Git 命令行协作入门主题科技插画 | 是 |
| lab--campus-assistant | lab / campus-assistant | 校园知识助手综合项目 | 内容封面 | 1200×675 | 品牌橙 | 已生成 | images/labs/lab--campus-assistant.webp | 独立 | 校园知识助手综合项目主题科技插画 | 是 |
| lab--energy-analysis | lab / energy-analysis | 宿舍用电智能分析原型 | 内容封面 | 1200×675 | 品牌橙 | 已生成 | images/labs/lab--energy-analysis.webp | 独立 | 宿舍用电智能分析原型主题科技插画 | 是 |
| resource--llm-handbook | resource / llm-handbook | 大模型入门学习手册 | 内容封面 | 1200×675 | 淡紫 | 已生成 | images/resources/resource--llm-handbook.webp | 独立 | 大模型入门学习手册主题科技插画 | 是 |
| resource--transformer-visual | resource / transformer-visual | Transformer 图解 | 内容封面 | 1200×675 | 淡紫 | 已生成 | images/resources/resource--transformer-visual.webp | 独立 | Transformer 图解主题科技插画 | 是 |
| resource--prompt-template | resource / prompt-template | 提示词设计模板 | 内容封面 | 1200×675 | 薄荷绿 | 已生成 | images/resources/resource--prompt-template.webp | 独立 | 提示词设计模板主题科技插画 | 是 |
| resource--function-guide | resource / function-guide | Function Calling 操作指南 | 内容封面 | 1200×675 | 淡紫 | 已生成 | images/resources/resource--function-guide.webp | 独立 | Function Calling 操作指南主题科技插画 | 是 |
| resource--rag-checklist | resource / rag-checklist | RAG 项目检查清单 | 内容封面 | 1200×675 | 暖白与橙 | 已生成 | images/resources/resource--rag-checklist.webp | 独立 | RAG 项目检查清单主题科技插画 | 是 |
| resource--linux-cheatsheet | resource / linux-cheatsheet | Linux 命令速查表 | 内容封面 | 1200×675 | 蓝灰 | 已生成 | images/resources/resource--linux-cheatsheet.webp | 独立 | Linux 命令速查表主题科技插画 | 是 |
| resource--docker-guide | resource / docker-guide | Docker 部署指南 | 内容封面 | 1200×675 | 科技蓝 | 已生成 | images/resources/resource--docker-guide.webp | 独立 | Docker 部署指南主题科技插画 | 是 |
| resource--vllm-config | resource / vllm-config | vLLM 服务配置手册 | 内容封面 | 1200×675 | 淡紫 | 已生成 | images/resources/resource--vllm-config.webp | 独立 | vLLM 服务配置手册主题科技插画 | 是 |
| resource--hardware-interface | resource / hardware-interface | 智能硬件接口说明 | 内容封面 | 1200×675 | 暖黄 | 已生成 | images/resources/resource--hardware-interface.webp | 独立 | 智能硬件接口说明主题科技插画 | 是 |
| resource--ai-security-list | resource / ai-security-list | AI 安全实践清单 | 内容封面 | 1200×675 | 暖白与橙 | 已生成 | images/resources/resource--ai-security-list.webp | 独立 | AI 安全实践清单主题科技插画 | 是 |
| resource--agent-workflow | resource / agent-workflow | Agent 工作流案例 | 内容封面 | 1200×675 | 暖白与橙 | 已生成 | images/resources/resource--agent-workflow.webp | 独立 | Agent 工作流案例主题科技插画 | 是 |
| resource--course-note | resource / course-note | 课程笔记结构模板 | 内容封面 | 1200×675 | 淡紫 | 已生成 | images/resources/resource--course-note.webp | 独立 | 课程笔记结构模板主题科技插画 | 是 |
| resource--model-card | resource / model-card | 模型卡撰写模板 | 内容封面 | 1200×675 | 暖白与橙 | 已生成 | images/resources/resource--model-card.webp | 独立 | 模型卡撰写模板主题科技插画 | 是 |
| resource--api-test | resource / api-test | 推理 API 测试集合 | 内容封面 | 1200×675 | 暖白与橙 | 已生成 | images/resources/resource--api-test.webp | 独立 | 推理 API 测试集合主题科技插画 | 是 |
| resource--comfyui-workflow | resource / comfyui-workflow | ComfyUI 基础工作流 | 内容封面 | 1200×675 | 暖白与橙 | 已生成 | images/resources/resource--comfyui-workflow.webp | 独立 | ComfyUI 基础工作流主题科技插画 | 是 |
| resource--image-prompt | resource / image-prompt | 图像提示词词典 | 内容封面 | 1200×675 | 薄荷绿 | 已生成 | images/resources/resource--image-prompt.webp | 独立 | 图像提示词词典主题科技插画 | 是 |
| resource--sensor-data | resource / sensor-data | 传感器模拟数据集 | 内容封面 | 1200×675 | 暖白与橙 | 已生成 | images/resources/resource--sensor-data.webp | 独立 | 传感器模拟数据集主题科技插画 | 是 |
| resource--gpu-memory-table | resource / gpu-memory-table | GPU 显存需求对照表 | 内容封面 | 1200×675 | 暖白与橙 | 已生成 | images/resources/resource--gpu-memory-table.webp | 独立 | GPU 显存需求对照表主题科技插画 | 是 |
| resource--evaluation-rubric | resource / evaluation-rubric | AI 项目评审量表 | 内容封面 | 1200×675 | 暖白与橙 | 已生成 | images/resources/resource--evaluation-rubric.webp | 独立 | AI 项目评审量表主题科技插画 | 是 |
| resource--agent-safety | resource / agent-safety | Agent 权限设计示例 | 内容封面 | 1200×675 | 暖白与橙 | 已生成 | images/resources/resource--agent-safety.webp | 独立 | Agent 权限设计示例主题科技插画 | 是 |
| resource--rag-sample | resource / rag-sample | 校园知识库示例语料 | 内容封面 | 1200×675 | 暖白与橙 | 已生成 | images/resources/resource--rag-sample.webp | 独立 | 校园知识库示例语料主题科技插画 | 是 |
| resource--fastapi-template | resource / fastapi-template | FastAPI 推理服务模板 | 内容封面 | 1200×675 | 暖白与橙 | 已生成 | images/resources/resource--fastapi-template.webp | 独立 | FastAPI 推理服务模板主题科技插画 | 是 |
| resource--git-workflow | resource / git-workflow | Git 协作流程图 | 内容封面 | 1200×675 | 淡紫 | 已生成 | images/resources/resource--git-workflow.webp | 独立 | Git 协作流程图主题科技插画 | 是 |
| resource--ethics-cases | resource / ethics-cases | 生成式 AI 伦理案例集 | 内容封面 | 1200×675 | 暖白与橙 | 已生成 | images/resources/resource--ethics-cases.webp | 独立 | 生成式 AI 伦理案例集主题科技插画 | 是 |
| article--agent-tools | article / agent-tools | 从工具调用看 AI Agent 的工程边界 | 内容封面 | 1200×675 | 薄荷绿 | 已生成 | images/articles/article--agent-tools.webp | 独立 | 从工具调用看 AI Agent 的工程边界主题科技插画 | 是 |
| article--gpt5-campus | article / gpt5-campus | 新一代大模型如何进入校园学习场景 | 内容封面 | 1200×675 | 淡紫 | 已生成 | images/articles/article--gpt5-campus.webp | 独立 | 新一代大模型如何进入校园学习场景主题科技插画 | 是 |
| article--moe | article / moe | MoE 为什么能让大模型更高效 | 内容封面 | 1200×675 | 淡紫 | 已生成 | images/articles/article--moe.webp | 独立 | MoE 为什么能让大模型更高效主题科技插画 | 是 |
| article--multimodal | article / multimodal | 多模态模型如何对齐图像与语言 | 内容封面 | 1200×675 | 淡紫粉 | 已生成 | images/articles/article--multimodal.webp | 独立 | 多模态模型如何对齐图像与语言主题科技插画 | 是 |
| article--robot | article / robot | 具身智能离校园实验还有多远 | 内容封面 | 1200×675 | 暖黄 | 已生成 | images/articles/article--robot.webp | 独立 | 具身智能离校园实验还有多远主题科技插画 | 是 |
| article--safety | article / safety | 学生开发 AI 应用需要知道的安全边界 | 内容封面 | 1200×675 | 青绿 | 已生成 | images/articles/article--safety.webp | 独立 | 学生开发 AI 应用需要知道的安全边界主题科技插画 | 是 |
| article--rag | article / rag | RAG 的价值不只是让模型知道更多 | 内容封面 | 1200×675 | 淡紫 | 已生成 | images/articles/article--rag.webp | 独立 | RAG 的价值不只是让模型知道更多主题科技插画 | 是 |
| article--function-call | article / function-call | Function Calling 的最小心智模型 | 内容封面 | 1200×675 | 薄荷绿 | 已生成 | images/articles/article--function-call.webp | 独立 | Function Calling 的最小心智模型主题科技插画 | 是 |
| article--alignment | article / alignment | 多模态对齐中的数据质量问题 | 内容封面 | 1200×675 | 淡紫粉 | 已生成 | images/articles/article--alignment.webp | 独立 | 多模态对齐中的数据质量问题主题科技插画 | 是 |
| article--small-model | article / small-model | 小模型为何重新受到关注 | 内容封面 | 1200×675 | 淡紫 | 已生成 | images/articles/article--small-model.webp | 独立 | 小模型为何重新受到关注主题科技插画 | 是 |
| article--context-engineering | article / context-engineering | 从提示词走向上下文工程 | 内容封面 | 1200×675 | 薄荷绿 | 已生成 | images/articles/article--context-engineering.webp | 独立 | 从提示词走向上下文工程主题科技插画 | 是 |
| article--vllm-throughput | article / vllm-throughput | vLLM 如何提升推理吞吐 | 内容封面 | 1200×675 | 暖白与橙 | 已生成 | images/articles/article--vllm-throughput.webp | 独立 | vLLM 如何提升推理吞吐主题科技插画 | 是 |
| article--edge-ai | article / edge-ai | 边缘 AI 的模型与硬件权衡 | 内容封面 | 1200×675 | 暖白与橙 | 已生成 | images/articles/article--edge-ai.webp | 独立 | 边缘 AI 的模型与硬件权衡主题科技插画 | 是 |
| article--prompt-injection | article / prompt-injection | 提示词注入攻击的真实路径 | 内容封面 | 1200×675 | 青绿 | 已生成 | images/articles/article--prompt-injection.webp | 独立 | 提示词注入攻击的真实路径主题科技插画 | 是 |
| article--ai-copyright | article / ai-copyright | 生成式 AI 作品中的版权判断 | 内容封面 | 1200×675 | 青绿 | 已生成 | images/articles/article--ai-copyright.webp | 独立 | 生成式 AI 作品中的版权判断主题科技插画 | 是 |
| challenge--weekly-ai | challenge / weekly-ai | 本周 AI 能力挑战 | 内容封面 | 1200×675 | 橙黄 | 已生成 | images/challenges/challenge--weekly-ai.webp | 独立 | 本周 AI 能力挑战主题科技插画 | 是 |
| challenge--llm-assessment | challenge / llm-assessment | 大模型基础模拟测评 | 内容封面 | 1200×675 | 淡紫 | 已生成 | images/challenges/challenge--llm-assessment.webp | 独立 | 大模型基础模拟测评主题科技插画 | 是 |
| challenge--agent-assessment | challenge / agent-assessment | AI Agent 工程能力测评 | 内容封面 | 1200×675 | 淡紫 | 已生成 | images/challenges/challenge--agent-assessment.webp | 独立 | AI Agent 工程能力测评主题科技插画 | 是 |
| challenge--deployment-assessment | challenge / deployment-assessment | 模型部署基础测评 | 内容封面 | 1200×675 | 淡紫 | 已生成 | images/challenges/challenge--deployment-assessment.webp | 独立 | 模型部署基础测评主题科技插画 | 是 |
| challenge--security-sprint | challenge / security-sprint | AI 安全边界挑战赛 | 内容封面 | 1200×675 | 橙黄 | 已生成 | images/challenges/challenge--security-sprint.webp | 独立 | AI 安全边界挑战赛主题科技插画 | 是 |
| default--course--llm | course / — | 课程 llm 默认封面 | 内容封面 | 1200×675 | 淡紫 | 已生成 | images/defaults/default--course--llm.webp | 默认 | 课程llm分类的知识与科技场景插画 | 是 |
| default--course--agent | course / — | 课程 agent 默认封面 | 内容封面 | 1200×675 | 薄荷绿 | 已生成 | images/defaults/default--course--agent.webp | 默认 | 课程agent分类的知识与科技场景插画 | 是 |
| default--course--image | course / — | 课程 image 默认封面 | 内容封面 | 1200×675 | 淡紫粉 | 已生成 | images/defaults/default--course--image.webp | 默认 | 课程image分类的知识与科技场景插画 | 是 |
| default--course--deployment | course / — | 课程 deployment 默认封面 | 内容封面 | 1200×675 | 科技蓝 | 已生成 | images/defaults/default--course--deployment.webp | 默认 | 课程deployment分类的知识与科技场景插画 | 是 |
| default--course--hardware | course / — | 课程 hardware 默认封面 | 内容封面 | 1200×675 | 暖黄 | 已生成 | images/defaults/default--course--hardware.webp | 默认 | 课程hardware分类的知识与科技场景插画 | 是 |
| default--course--security | course / — | 课程 security 默认封面 | 内容封面 | 1200×675 | 青绿 | 已生成 | images/defaults/default--course--security.webp | 默认 | 课程security分类的知识与科技场景插画 | 是 |
| default--course--generic | course / — | 课程 generic 默认封面 | 内容封面 | 1200×675 | 暖白与橙 | 已生成 | images/defaults/default--course--generic.webp | 默认 | 课程generic分类的知识与科技场景插画 | 是 |
| default--lab--deployment | lab / — | 实训 deployment 默认封面 | 内容封面 | 1200×675 | 科技蓝 | 已生成 | images/defaults/default--lab--deployment.webp | 默认 | 实训deployment分类的知识与科技场景插画 | 是 |
| default--lab--agent | lab / — | 实训 agent 默认封面 | 内容封面 | 1200×675 | 薄荷绿 | 已生成 | images/defaults/default--lab--agent.webp | 默认 | 实训agent分类的知识与科技场景插画 | 是 |
| default--lab--command | lab / — | 实训 command 默认封面 | 内容封面 | 1200×675 | 蓝灰 | 已生成 | images/defaults/default--lab--command.webp | 默认 | 实训command分类的知识与科技场景插画 | 是 |
| default--lab--hardware | lab / — | 实训 hardware 默认封面 | 内容封面 | 1200×675 | 暖黄 | 已生成 | images/defaults/default--lab--hardware.webp | 默认 | 实训hardware分类的知识与科技场景插画 | 是 |
| default--lab--project | lab / — | 实训 project 默认封面 | 内容封面 | 1200×675 | 品牌橙 | 已生成 | images/defaults/default--lab--project.webp | 默认 | 实训project分类的知识与科技场景插画 | 是 |
| default--lab--generic | lab / — | 实训 generic 默认封面 | 内容封面 | 1200×675 | 暖白与橙 | 已生成 | images/defaults/default--lab--generic.webp | 默认 | 实训generic分类的知识与科技场景插画 | 是 |
| default--resource--handbook | resource / — | 资源 handbook 默认封面 | 内容封面 | 1200×675 | 淡紫 | 已生成 | images/defaults/default--resource--handbook.webp | 默认 | 资源handbook分类的知识与科技场景插画 | 是 |
| default--resource--prompt-template | resource / — | 资源 prompt-template 默认封面 | 内容封面 | 1200×675 | 薄荷绿 | 已生成 | images/defaults/default--resource--prompt-template.webp | 默认 | 资源prompt-template分类的知识与科技场景插画 | 是 |
| default--resource--deployment-guide | resource / — | 资源 deployment-guide 默认封面 | 内容封面 | 1200×675 | 科技蓝 | 已生成 | images/defaults/default--resource--deployment-guide.webp | 默认 | 资源deployment-guide分类的知识与科技场景插画 | 是 |
| default--resource--agent-case | resource / — | 资源 agent-case 默认封面 | 内容封面 | 1200×675 | 薄荷绿 | 已生成 | images/defaults/default--resource--agent-case.webp | 默认 | 资源agent-case分类的知识与科技场景插画 | 是 |
| default--resource--command-reference | resource / — | 资源 command-reference 默认封面 | 内容封面 | 1200×675 | 蓝灰 | 已生成 | images/defaults/default--resource--command-reference.webp | 默认 | 资源command-reference分类的知识与科技场景插画 | 是 |
| default--resource--hardware-material | resource / — | 资源 hardware-material 默认封面 | 内容封面 | 1200×675 | 暖黄 | 已生成 | images/defaults/default--resource--hardware-material.webp | 默认 | 资源hardware-material分类的知识与科技场景插画 | 是 |
| default--resource--generic | resource / — | 资源 generic 默认封面 | 内容封面 | 1200×675 | 暖白与橙 | 已生成 | images/defaults/default--resource--generic.webp | 默认 | 资源generic分类的知识与科技场景插画 | 是 |
| default--article--llm | article / — | 文章 llm 默认封面 | 内容封面 | 1200×675 | 淡紫 | 已生成 | images/defaults/default--article--llm.webp | 默认 | 文章llm分类的知识与科技场景插画 | 是 |
| default--article--agent | article / — | 文章 agent 默认封面 | 内容封面 | 1200×675 | 薄荷绿 | 已生成 | images/defaults/default--article--agent.webp | 默认 | 文章agent分类的知识与科技场景插画 | 是 |
| default--article--multimodal | article / — | 文章 multimodal 默认封面 | 内容封面 | 1200×675 | 淡紫粉 | 已生成 | images/defaults/default--article--multimodal.webp | 默认 | 文章multimodal分类的知识与科技场景插画 | 是 |
| default--article--robotics | article / — | 文章 robotics 默认封面 | 内容封面 | 1200×675 | 暖黄 | 已生成 | images/defaults/default--article--robotics.webp | 默认 | 文章robotics分类的知识与科技场景插画 | 是 |
| default--article--security | article / — | 文章 security 默认封面 | 内容封面 | 1200×675 | 青绿 | 已生成 | images/defaults/default--article--security.webp | 默认 | 文章security分类的知识与科技场景插画 | 是 |
| default--article--generic | article / — | 文章 generic 默认封面 | 内容封面 | 1200×675 | 暖白与橙 | 已生成 | images/defaults/default--article--generic.webp | 默认 | 文章generic分类的知识与科技场景插画 | 是 |
| default--challenge--weekly | challenge / — | 挑战 weekly 默认封面 | 内容封面 | 1200×675 | 橙黄 | 已生成 | images/defaults/default--challenge--weekly.webp | 默认 | 挑战weekly分类的知识与科技场景插画 | 是 |
| default--challenge--assessment | challenge / — | 挑战 assessment 默认封面 | 内容封面 | 1200×675 | 淡紫 | 已生成 | images/defaults/default--challenge--assessment.webp | 默认 | 挑战assessment分类的知识与科技场景插画 | 是 |
| default--challenge--practice | challenge / — | 挑战 practice 默认封面 | 内容封面 | 1200×675 | 薄荷绿 | 已生成 | images/defaults/default--challenge--practice.webp | 默认 | 挑战practice分类的知识与科技场景插画 | 是 |
| default--challenge--generic | challenge / — | 挑战 generic 默认封面 | 内容封面 | 1200×675 | 暖白与橙 | 已生成 | images/defaults/default--challenge--generic.webp | 默认 | 挑战generic分类的知识与科技场景插画 | 是 |
| default--global--generic | global / — | 平台 generic 默认封面 | 内容封面 | 1200×675 | 暖白与橙 | 已生成 | images/defaults/default--global--generic.webp | 默认 | 平台generic分类的知识与科技场景插画 | 是 |
| hero--topics | page_hero / topics | topics 页面头图 | 页面头图 | 1600×800 | 暖白与橙 | 已生成 | images/heroes/hero--topics.webp | 默认 | AI知识地图、课程节点、书本和数字模块的科技插画 | 是 |
| hero--labs | page_hero / labs | labs 页面头图 | 页面头图 | 1600×800 | 暖白与橙 | 已生成 | images/heroes/hero--labs.webp | 默认 | 笔记本电脑、模型服务立方体、开发板和智能体节点的科技插画 | 是 |
| hero--resources | page_hero / resources | resources 页面头图 | 页面头图 | 1600×800 | 暖白与橙 | 已生成 | images/heroes/hero--resources.webp | 默认 | 文档、知识卡片、文件夹、搜索与工具包的科技插画 | 是 |
| hero--frontier | page_hero / frontier | frontier 页面头图 | 页面头图 | 1600×800 | 暖白与橙 | 已生成 | images/heroes/hero--frontier.webp | 默认 | 研究雷达、模型节点、多模态信号的科技插画 | 是 |
| hero--assessments | page_hero / assessments | assessments 页面头图 | 页面头图 | 1600×800 | 暖白与橙 | 已生成 | images/heroes/hero--assessments.webp | 默认 | 奖杯、知识节点、能力图谱和测评任务的科技插画 | 是 |
| hero--profile | page_hero / profile | profile 页面头图 | 页面头图 | 1600×800 | 暖白与橙 | 已生成 | images/heroes/hero--profile.webp | 默认 | 成长路径、徽章、能力雷达与学习成果的科技插画 | 是 |

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
