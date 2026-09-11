import { catalogAssets, getDefaultAssetKeys } from '../../catalog-assets/manifest'
import { getCourseCurriculum } from './curriculum'
export { courseCurricula, curriculumVersion, getCourseCurriculum } from './curriculum'

function withCover<T extends { slug: string; coverAssetKey: string }>(type: string, items: Omit<T, 'coverAssetKey'>[]): T[] {
  return items.map((item) => {
    const coverAssetKey = type === 'theme' ? getDefaultAssetKeys(type, item.slug)[0] : catalogAssets.find((asset) => asset.kind === 'cover' && asset.contentType === type && asset.contentSlug === item.slug)?.assetKey
    if (!coverAssetKey) throw new Error(`演示内容缺少素材清单映射: ${type}/${item.slug}`)
    return { ...item, coverAssetKey } as T
  })
}

export interface DemoTheme {
  coverAssetKey: string
  slug: string
  title: string
  summary: string
  accent: string
  coverVariant: string
  icon: string
  learners: number
  courseCount: number
  hours: number
  path: Array<{ key: string; name: string; description: string; countLabel: string; hours: number; type: string }>
}

export interface DemoCourse {
  coverAssetKey: string
  slug: string
  title: string
  summary: string
  theme: string
  level: string
  hours: number
  durationMinutes: number
  learners: number
  rating: number
  chapters: number
  mode: string
  coverVariant: string
  icon: string
  instructor: string
  recommended: boolean
  progress: number
}

export interface DemoLab {
  coverAssetKey: string
  slug: string
  title: string
  summary: string
  labType: 'agent' | 'deployment' | 'command' | 'hardware' | 'project'
  level: string
  durationMinutes: number
  steps: number
  completionRate: number
  participants: number
  coverVariant: string
  icon: string
  result: string
  skills: string[]
}

export interface DemoResource {
  coverAssetKey: string
  slug: string
  title: string
  summary: string
  category: string
  format: string
  theme: string
  difficulty: string
  downloads: number
  views: number
  favorites: number
  coverVariant: string
  icon: string
  featured: boolean
  updatedAt: string
}

export interface DemoArticle {
  coverAssetKey: string
  slug: string
  title: string
  summary: string
  category: string
  readMinutes: number
  views: number
  favorites: number
  coverVariant: string
  icon: string
  publishedAt: string
  featured: boolean
  content: string[]
}

const themeFixtures = withCover<Omit<DemoTheme, 'courseCount' | 'hours' | 'path'>>('theme', [
  {
    slug: 'llm', title: '大模型 LLM', summary: '从通识、Transformer 到 RAG 与部署，建立大模型完整知识框架。',
    accent: '#6e5bff', coverVariant: 'llm', icon: 'layers', learners: 12600,
  },
  {
    slug: 'agent', title: 'AI Agent', summary: '学习工具调用、任务规划、记忆与多智能体协作。',
    accent: '#27b86b', coverVariant: 'agent', icon: 'bot', learners: 9800,
  },
  {
    slug: 'image', title: '图像生成', summary: '从提示词、构图到 Stable Diffusion 与 ComfyUI 工作流。',
    accent: '#a05cf6', coverVariant: 'image', icon: 'image', learners: 8800,
  },
  {
    slug: 'deployment', title: '模型部署', summary: '掌握 Linux、Docker、FastAPI、vLLM 与服务监控。',
    accent: '#3478f6', coverVariant: 'deployment', icon: 'server', learners: 7600,
  },
  {
    slug: 'hardware', title: '智能硬件', summary: '理解 GPU、开发板、传感器与边缘 AI 应用。',
    accent: '#e5a91d', coverVariant: 'hardware', icon: 'chip', learners: 6300,
  },
  {
    slug: 'security', title: 'AI 安全', summary: '学习提示词注入、隐私、权限与生成式 AI 伦理。',
    accent: '#16a67a', coverVariant: 'security', icon: 'shield', learners: 5100,
  },
])

export const demoCourses = withCover<DemoCourse>('course', [
  { slug: 'ai-literacy', title: '零基础认识人工智能', summary: '建立人工智能、机器学习与生成式 AI 的基本认知。', theme: 'llm', learners: 15680, rating: 4.9, coverVariant: 'llm', icon: 'brain', instructor: '林知远', recommended: true, progress: 72 },
  { slug: 'llm-zero', title: '从零理解大语言模型', summary: '理解 Transformer、训练与推理的核心逻辑。', theme: 'llm', learners: 12600, rating: 4.9, coverVariant: 'llm', icon: 'layers', instructor: '林知远', recommended: true, progress: 60 },
  { slug: 'transformer-core', title: 'Transformer 核心原理', summary: '从注意力机制到编码器结构，拆解现代大模型基础。', theme: 'llm', learners: 8920, rating: 4.8, coverVariant: 'llm', icon: 'network', instructor: '周思齐', recommended: true, progress: 34 },
  { slug: 'prompt-basics', title: '提示词设计入门', summary: '用目标、上下文、约束和示例提升输出质量。', theme: 'llm', learners: 11420, rating: 4.8, coverVariant: 'llm', icon: 'message', instructor: '赵清禾', recommended: true, progress: 48 },
  { slug: 'rag-practice', title: 'RAG 检索增强生成实战', summary: '用可信资料库提升模型回答准确性与可追溯性。', theme: 'llm', learners: 4900, rating: 4.9, coverVariant: 'llm', icon: 'search', instructor: '周思齐', recommended: true, progress: 18 },
  { slug: 'llm-finetune', title: '大模型微调基础', summary: '理解数据准备、参数高效微调和效果评估。', theme: 'llm', learners: 3680, rating: 4.7, coverVariant: 'llm', icon: 'sliders', instructor: '沈砚', recommended: false, progress: 0 },
  { slug: 'agent-first', title: '构建你的第一个 AI Agent', summary: '从任务规划到工具调用，完成可运行的智能助手。', theme: 'agent', learners: 9800, rating: 4.9, coverVariant: 'agent', icon: 'bot', instructor: '顾行舟', recommended: true, progress: 35 },
  { slug: 'function-calling', title: 'Agent 工具调用与 Function Calling', summary: '设计受控工具契约、参数校验与执行反馈。', theme: 'agent', learners: 6540, rating: 4.8, coverVariant: 'agent', icon: 'tool', instructor: '顾行舟', recommended: true, progress: 12 },
  { slug: 'agent-memory', title: 'Agent 记忆与上下文管理', summary: '区分会话状态、长期知识与检索记忆。', theme: 'agent', learners: 5320, rating: 4.8, coverVariant: 'agent', icon: 'memory', instructor: '顾行舟', recommended: true, progress: 0 },
  { slug: 'multi-agent', title: '多智能体协作系统', summary: '设计角色、消息、协调与可观测的协作流程。', theme: 'agent', learners: 3200, rating: 4.7, coverVariant: 'agent', icon: 'users', instructor: '程知微', recommended: true, progress: 0 },
  { slug: 'agent-evaluation', title: 'AI Agent 评测与可观测性', summary: '用轨迹、指标和人工复核评估智能体。', theme: 'agent', learners: 2760, rating: 4.7, coverVariant: 'agent', icon: 'chart', instructor: '程知微', recommended: false, progress: 0 },
  { slug: 'stable-diffusion', title: 'Stable Diffusion 入门', summary: '认识扩散模型、采样方法和常用生成参数。', theme: 'image', learners: 8600, rating: 4.8, coverVariant: 'image', icon: 'image', instructor: '苏映雪', recommended: true, progress: 20 },
  { slug: 'comfyui', title: 'ComfyUI 工作流基础', summary: '用节点组织可复用、可解释的图像生成流程。', theme: 'image', learners: 6250, rating: 4.8, coverVariant: 'image', icon: 'workflow', instructor: '苏映雪', recommended: true, progress: 0 },
  { slug: 'image-editing', title: '图像编辑与控制生成', summary: '理解局部重绘、结构控制与一致性表达。', theme: 'image', learners: 4380, rating: 4.7, coverVariant: 'image', icon: 'crop', instructor: '苏映雪', recommended: false, progress: 0 },
  { slug: 'generative-ethics', title: '生成式 AI 伦理与版权', summary: '识别训练数据、作品归属与内容风险。', theme: 'image', learners: 7120, rating: 4.9, coverVariant: 'image', icon: 'scale', instructor: '叶书宁', recommended: true, progress: 0 },
  { slug: 'linux-basics', title: 'Linux 命令行入门', summary: '掌握目录、文件、进程与日志的安全操作。', theme: 'deployment', learners: 10800, rating: 4.8, coverVariant: 'command', icon: 'terminal', instructor: '贺远', recommended: true, progress: 52 },
  { slug: 'docker-models', title: 'Docker 与模型容器化', summary: '构建可重复、可验证的模型运行环境。', theme: 'deployment', learners: 7200, rating: 4.8, coverVariant: 'deployment', icon: 'container', instructor: '贺远', recommended: true, progress: 15 },
  { slug: 'fastapi-inference', title: '使用 FastAPI 发布推理服务', summary: '为模型接口补齐校验、健康检查与错误边界。', theme: 'deployment', learners: 5980, rating: 4.7, coverVariant: 'deployment', icon: 'api', instructor: '贺远', recommended: true, progress: 0 },
  { slug: 'vllm-basics', title: 'vLLM 推理服务基础', summary: '理解批处理、KV Cache、吞吐与显存权衡。', theme: 'deployment', learners: 3860, rating: 4.8, coverVariant: 'deployment', icon: 'server', instructor: '沈砚', recommended: false, progress: 0 },
  { slug: 'gpu-memory', title: 'GPU 与显存基础', summary: '理解计算单元、显存容量与模型推理需求。', theme: 'hardware', learners: 7480, rating: 4.8, coverVariant: 'hardware', icon: 'gpu', instructor: '陆川', recommended: true, progress: 0 },
  { slug: 'aiot-basics', title: 'AIoT 智能硬件入门', summary: '连接传感器、控制器与轻量 AI 能力。', theme: 'hardware', learners: 6300, rating: 4.7, coverVariant: 'hardware', icon: 'chip', instructor: '陆川', recommended: true, progress: 0 },
  { slug: 'edge-ai', title: '边缘 AI 模型应用', summary: '理解轻量化、设备约束与离线推理流程。', theme: 'hardware', learners: 2840, rating: 4.7, coverVariant: 'hardware', icon: 'edge', instructor: '陆川', recommended: false, progress: 0 },
  { slug: 'prompt-injection', title: '提示词注入与模型安全', summary: '识别越权指令、数据泄露与工具滥用风险。', theme: 'security', learners: 5100, rating: 4.9, coverVariant: 'security', icon: 'shield', instructor: '叶书宁', recommended: true, progress: 0 },
  { slug: 'ai-privacy', title: 'AI 应用隐私与数据治理', summary: '建立最小收集、访问控制和数据留存意识。', theme: 'security', learners: 4120, rating: 4.8, coverVariant: 'security', icon: 'lock', instructor: '叶书宁', recommended: true, progress: 0 },
].map((course) => {
  const curriculum = getCourseCurriculum(course.slug)
  if (!curriculum) throw new Error(`演示课程缺少正文：${course.slug}`)
  const durationMinutes = curriculum.chapters.flatMap((chapter) => chapter.lessons).reduce((sum, lesson) => sum + lesson.durationMinutes, 0)
  return { ...course, level: '入门', mode: '图文', chapters: curriculum.chapters.length, durationMinutes, hours: durationMinutes / 60 }
}))

export const demoThemes: DemoTheme[] = themeFixtures.map((theme) => {
  const courses = demoCourses.filter((course) => course.theme === theme.slug)
  return { ...theme, courseCount: courses.length, hours: courses.reduce((sum, course) => sum + course.hours, 0),
    path: courses.map((course) => ({ key: course.slug, name: course.title, description: course.summary, countLabel: '1 门课程', hours: course.hours, type: 'learning' })),
  }
})

export const demoLabs = withCover<DemoLab>('lab', [
  { slug: 'model-service', title: '部署你的第一个 AI 模型', summary: '模拟模型服务启动、检查与验证。', labType: 'deployment', level: '中级', durationMinutes: 90, steps: 8, completionRate: 66, participants: 8932, coverVariant: 'deployment', icon: 'server', result: '可访问的模型健康检查与推理接口', skills: ['Linux', 'Docker', 'API'] },
  { slug: 'campus-agent', title: '构建校园问答 AI Agent', summary: '组合检索、工具调用和来源引用。', labType: 'agent', level: '中级', durationMinutes: 110, steps: 7, completionRate: 62, participants: 7521, coverVariant: 'agent', icon: 'bot', result: '可追溯回答的校园知识助手', skills: ['LLM', 'RAG', 'Agent'] },
  { slug: 'linux-command', title: 'Linux 文件与目录命令训练', summary: '使用白名单命令完成文件与目录任务。', labType: 'command', level: '入门', durationMinutes: 60, steps: 6, completionRate: 71, participants: 7921, coverVariant: 'command', icon: 'terminal', result: '可复核的命令操作记录', skills: ['Linux', 'Shell', '日志'] },
  { slug: 'service-health', title: '模型接口健康检查', summary: '读取状态、日志和指标判断服务可用性。', labType: 'deployment', level: '入门', durationMinutes: 55, steps: 6, completionRate: 74, participants: 6840, coverVariant: 'deployment', icon: 'pulse', result: '模型接口健康检查报告', skills: ['API', '监控', '排障'] },
  { slug: 'rag-lab', title: 'RAG 知识库搭建', summary: '完成资料切分、检索与引用验证。', labType: 'agent', level: '中级', durationMinutes: 95, steps: 7, completionRate: 58, participants: 6810, coverVariant: 'agent', icon: 'search', result: '带来源引用的知识问答流程', skills: ['RAG', '向量检索', '评估'] },
  { slug: 'multi-tool-agent', title: '多工具 Agent 开发', summary: '配置工具白名单、参数校验与失败反馈。', labType: 'agent', level: '进阶', durationMinutes: 125, steps: 8, completionRate: 49, participants: 5260, coverVariant: 'agent', icon: 'tool', result: '具备三类受控工具的智能体', skills: ['Agent', 'Function Calling', '安全'] },
  { slug: 'board-structure', title: 'AI 开发板结构认知', summary: '识别算力、存储、接口与供电模块。', labType: 'hardware', level: '入门', durationMinutes: 75, steps: 6, completionRate: 66, participants: 8214, coverVariant: 'hardware', icon: 'chip', result: '硬件模块标注与连接说明', skills: ['GPU', '开发板', '接口'] },
  { slug: 'sensor-data', title: '传感器数据采集模拟', summary: '观察温湿度数据并完成阈值判断。', labType: 'hardware', level: '中级', durationMinutes: 80, steps: 6, completionRate: 54, participants: 4980, coverVariant: 'hardware', icon: 'sensor', result: '传感器趋势与异常判断结果', skills: ['传感器', '数据', '阈值'] },
  { slug: 'image-web', title: '图像分类 Web 应用', summary: '组合模型调用、结果展示与安全说明。', labType: 'project', level: '中级', durationMinutes: 180, steps: 7, completionRate: 46, participants: 4210, coverVariant: 'image', icon: 'image', result: '可演示的图像分类 Web 页面', skills: ['模型部署', 'Web', '可视化'] },
  { slug: 'monitor', title: '模型服务监控演练', summary: '识别模拟告警并定位健康状态变化。', labType: 'deployment', level: '中级', durationMinutes: 70, steps: 8, completionRate: 38, participants: 4520, coverVariant: 'deployment', icon: 'chart', result: '服务告警诊断与恢复记录', skills: ['监控', '日志', '健康检查'] },
  { slug: 'git-cli', title: 'Git 命令行协作入门', summary: '用安全模拟命令理解分支与提交协作。', labType: 'command', level: '入门', durationMinutes: 55, steps: 6, completionRate: 53, participants: 6102, coverVariant: 'command', icon: 'git', result: '清晰可追溯的协作提交记录', skills: ['Git', '分支', '协作'] },
  { slug: 'campus-assistant', title: '校园知识助手综合项目', summary: '整合课程、资源与校园知识完成可用作品。', labType: 'project', level: '进阶', durationMinutes: 240, steps: 8, completionRate: 41, participants: 3560, coverVariant: 'agent', icon: 'graduation', result: '具备权限和来源说明的校园助手', skills: ['LLM', 'RAG', '前端'] },
  { slug: 'energy-analysis', title: '宿舍用电智能分析原型', summary: '从模拟传感数据发现趋势并提出节能建议。', labType: 'project', level: '中级', durationMinutes: 210, steps: 7, completionRate: 44, participants: 2980, coverVariant: 'hardware', icon: 'energy', result: '用电趋势看板与节能建议', skills: ['数据分析', '可视化', 'AIoT'] },
])

export const demoResources = withCover<DemoResource>('resource', [
  ['llm-handbook', '大模型入门学习手册', '梳理核心术语、学习路径和练习建议。', '学习手册', 'PDF', '大模型', '入门', 4280, 12600, 980, 'llm', 'file', true, '2026-08-28'],
  ['transformer-visual', 'Transformer 图解', '用结构图理解注意力与编码流程。', '知识图解', 'PDF', '大模型', '中级', 3910, 11200, 860, 'llm', 'diagram', true, '2026-08-27'],
  ['prompt-template', '提示词设计模板', '覆盖目标、上下文、约束和示例字段。', '提示词模板', 'DOCX', 'Agent', '入门', 3650, 9800, 720, 'agent', 'template', true, '2026-08-26'],
  ['function-guide', 'Function Calling 操作指南', '从工具描述到参数校验的完整清单。', '操作指南', 'PDF', 'Agent', '中级', 3340, 8700, 680, 'agent', 'tool', true, '2026-08-25'],
  ['rag-checklist', 'RAG 项目检查清单', '检查切分、召回、引用与评估质量。', '检查清单', 'XLSX', '大模型', '中级', 3120, 7800, 590, 'llm', 'check', true, '2026-08-24'],
  ['linux-cheatsheet', 'Linux 命令速查表', '常用文件、进程、网络和日志命令。', '命令速查', 'PDF', '模型部署', '入门', 2980, 7600, 540, 'command', 'terminal', true, '2026-08-23'],
  ['docker-guide', 'Docker 部署指南', '镜像、容器、卷和 Compose 入门。', '部署指南', 'PDF', '模型部署', '中级', 2760, 7100, 510, 'deployment', 'container', true, '2026-08-22'],
  ['vllm-config', 'vLLM 服务配置手册', '整理显存、批处理和服务参数。', '配置手册', 'YAML', '模型部署', '高级', 2210, 5900, 430, 'deployment', 'server', false, '2026-08-21'],
  ['hardware-interface', '智能硬件接口说明', '介绍 GPIO、I2C、SPI 与串口边界。', '硬件资料', 'PDF', '智能硬件', '入门', 2080, 5400, 390, 'hardware', 'chip', true, '2026-08-20'],
  ['ai-security-list', 'AI 安全实践清单', '检查密钥、权限、输入和输出风险。', '安全清单', 'PDF', 'AI 安全', '入门', 1960, 5200, 420, 'security', 'shield', true, '2026-08-19'],
  ['agent-workflow', 'Agent 工作流案例', '展示规划、工具、反馈和人工确认节点。', '案例包', 'ZIP', 'Agent', '中级', 1880, 4800, 360, 'agent', 'workflow', false, '2026-08-18'],
  ['course-note', '课程笔记结构模板', '帮助记录概念、问题、实践和复盘。', '学习模板', 'DOCX', '通用', '入门', 1760, 4600, 340, 'llm', 'note', false, '2026-08-17'],
  ['model-card', '模型卡撰写模板', '记录用途、数据、限制和评估结果。', '治理模板', 'DOCX', 'AI 安全', '中级', 1680, 4300, 320, 'security', 'card', false, '2026-08-16'],
  ['api-test', '推理 API 测试集合', '包含健康检查、成功和失败请求示例。', '接口工具', 'JSON', '模型部署', '中级', 1590, 4100, 300, 'deployment', 'api', false, '2026-08-15'],
  ['comfyui-workflow', 'ComfyUI 基础工作流', '可导入的文生图节点结构。', '工作流', 'JSON', '图像生成', '中级', 1520, 3900, 290, 'image', 'workflow', false, '2026-08-14'],
  ['image-prompt', '图像提示词词典', '按主体、镜头、材质和光线组织词汇。', '提示词模板', 'PDF', '图像生成', '入门', 1480, 3800, 280, 'image', 'image', false, '2026-08-13'],
  ['sensor-data', '传感器模拟数据集', '用于温湿度趋势与异常检测练习。', '数据集', 'CSV', '智能硬件', '中级', 1390, 3600, 260, 'hardware', 'data', false, '2026-08-12'],
  ['gpu-memory-table', 'GPU 显存需求对照表', '比较常见模型精度与显存需求。', '参考表', 'XLSX', '智能硬件', '中级', 1320, 3500, 250, 'hardware', 'gpu', false, '2026-08-11'],
  ['evaluation-rubric', 'AI 项目评审量表', '从价值、实现、证据与安全评价作品。', '评审工具', 'XLSX', '通用', '中级', 1250, 3300, 240, 'llm', 'chart', false, '2026-08-10'],
  ['agent-safety', 'Agent 权限设计示例', '对比高风险与最小权限工具配置。', '安全案例', 'PDF', 'AI 安全', '高级', 1180, 3100, 230, 'security', 'lock', false, '2026-08-09'],
  ['rag-sample', '校园知识库示例语料', '用于切分、检索和引用验证练习。', '数据集', 'ZIP', '大模型', '中级', 1120, 2900, 220, 'llm', 'database', false, '2026-08-08'],
  ['fastapi-template', 'FastAPI 推理服务模板', '包含校验、错误响应和健康接口。', '代码模板', 'ZIP', '模型部署', '中级', 1050, 2700, 210, 'deployment', 'code', false, '2026-08-07'],
  ['git-workflow', 'Git 协作流程图', '展示分支、提交、评审和合并流程。', '知识图解', 'PDF', '模型部署', '入门', 980, 2500, 190, 'command', 'git', false, '2026-08-06'],
  ['ethics-cases', '生成式 AI 伦理案例集', '讨论版权、偏差、隐私与责任边界。', '案例集', 'PDF', 'AI 安全', '入门', 920, 2400, 180, 'security', 'scale', false, '2026-08-05'],
].map(([slug, title, summary, category, format, theme, difficulty, downloads, views, favorites, coverVariant, icon, featured, updatedAt]) => ({
  slug, title, summary, category, format, theme, difficulty, downloads, views, favorites, coverVariant, icon, featured, updatedAt,
})) as Omit<DemoResource, 'coverAssetKey'>[])

export const demoArticles = withCover<DemoArticle>('article', [
  ['agent-tools', '从工具调用看 AI Agent 的工程边界', '理解规划、执行、反馈之间的关系，以及何时应该让人参与决策。', 'Agent', 8, 12600, 860, 'agent', 'tool', '2026-08-28', true],
  ['gpt5-campus', '新一代大模型如何进入校园学习场景', '从学习助教、实验反馈到教师协作，观察能力与边界。', '大模型', 9, 11800, 790, 'llm', 'layers', '2026-08-27', true],
  ['moe', 'MoE 为什么能让大模型更高效', '用直观方式理解专家混合架构与路由机制。', '大模型', 6, 9820, 620, 'llm', 'network', '2026-08-26', false],
  ['multimodal', '多模态模型如何对齐图像与语言', '从表示空间出发，拆解跨模态学习的基本流程。', '多模态', 9, 8750, 580, 'image', 'image', '2026-08-25', true],
  ['robot', '具身智能离校园实验还有多远', '盘点传感、规划和控制中的关键学习任务。', '机器人', 7, 7620, 510, 'hardware', 'bot', '2026-08-24', false],
  ['safety', '学生开发 AI 应用需要知道的安全边界', '从数据、权限和输出三方面建立安全意识。', 'AI 安全', 5, 7240, 540, 'security', 'shield', '2026-08-23', true],
  ['rag', 'RAG 的价值不只是让模型知道更多', '可追溯来源与知识更新同样是工程价值。', '大模型', 8, 6890, 470, 'llm', 'search', '2026-08-22', false],
  ['function-call', 'Function Calling 的最小心智模型', '模型负责选择工具，应用负责验证和执行。', 'Agent', 6, 6480, 440, 'agent', 'tool', '2026-08-21', false],
  ['alignment', '多模态对齐中的数据质量问题', '错误配对与偏差如何影响模型学习。', '多模态', 10, 5970, 390, 'image', 'data', '2026-08-20', false],
  ['small-model', '小模型为何重新受到关注', '在边缘设备、隐私与成本约束下理解模型选择。', '大模型', 7, 5520, 360, 'llm', 'chip', '2026-08-19', false],
  ['context-engineering', '从提示词走向上下文工程', '组织任务状态、知识和工具反馈成为新的关键能力。', 'Agent', 8, 5280, 350, 'agent', 'memory', '2026-08-18', true],
  ['vllm-throughput', 'vLLM 如何提升推理吞吐', '用连续批处理和 KV Cache 认识服务性能。', '模型部署', 9, 4860, 310, 'deployment', 'server', '2026-08-17', false],
  ['edge-ai', '边缘 AI 的模型与硬件权衡', '理解算力、功耗、延迟和隐私之间的关系。', '智能硬件', 8, 4520, 290, 'hardware', 'chip', '2026-08-16', false],
  ['prompt-injection', '提示词注入攻击的真实路径', '从越权指令到工具滥用建立防御意识。', 'AI 安全', 7, 4380, 330, 'security', 'lock', '2026-08-15', true],
  ['ai-copyright', '生成式 AI 作品中的版权判断', '从数据来源、创作贡献和发布责任理解边界。', 'AI 伦理', 9, 4120, 300, 'security', 'scale', '2026-08-14', false],
].map(([slug, title, summary, category, readMinutes, views, favorites, coverVariant, icon, publishedAt, featured]) => ({
  slug, title, summary, category, readMinutes, views, favorites, coverVariant, icon, publishedAt, featured,
  content: [`${summary}`, '通过概念、案例与可验证实践建立清晰判断，避免把模型能力等同于系统能力。', '课程建议结合相关资源和实训练习完成学习闭环。'],
})) as Omit<DemoArticle, 'coverAssetKey'>[])

export interface DemoChallenge {
  slug: string
  title: string
  summary: string
  type: string
  targetScore: number
  rewardPoints: number
  questions: number
  durationMinutes: number
  participants: number
  difficulty: string
  coverAssetKey: string
}
export const demoChallenges = withCover<DemoChallenge>('challenge', [
  { slug: 'weekly-ai', title: '本周 AI 能力挑战', summary: '覆盖模型基础、Agent、部署与安全边界。', type: 'weekly', targetScore: 80, rewardPoints: 300, questions: 30, durationMinutes: 20, participants: 6840, difficulty: '综合' },
  { slug: 'llm-assessment', title: '大模型基础模拟测评', summary: '检验 Transformer、提示词和 RAG 核心知识。', type: 'assessment', targetScore: 75, rewardPoints: 240, questions: 24, durationMinutes: 35, participants: 5290, difficulty: '中级' },
  { slug: 'agent-assessment', title: 'AI Agent 工程能力测评', summary: '检验工具、记忆、规划和安全设计。', type: 'assessment', targetScore: 78, rewardPoints: 260, questions: 20, durationMinutes: 30, participants: 4380, difficulty: '中级' },
  { slug: 'deployment-assessment', title: '模型部署基础测评', summary: '覆盖 Linux、Docker、API 和健康检查。', type: 'assessment', targetScore: 72, rewardPoints: 220, questions: 20, durationMinutes: 30, participants: 3960, difficulty: '初级' },
  { slug: 'security-sprint', title: 'AI 安全边界挑战赛', summary: '识别提示词注入、敏感信息和越权风险。', type: 'weekly', targetScore: 85, rewardPoints: 360, questions: 18, durationMinutes: 25, participants: 3280, difficulty: '进阶' },
])

export const demoKnowledgeConcepts = [
  ['ai-literacy', '人工智能基础', '用数据与算法完成感知、生成或决策任务'],
  ['attention', '注意力机制', '捕捉序列中不同位置之间的关联'],
  ['transformer', 'Transformer', '通过注意力与前馈网络建模序列'],
  ['prompt', '提示词设计', '明确目标、上下文、约束与输出格式'],
  ['rag', 'RAG', '检索可信资料并在回答中保留来源'],
  ['finetune', '参数高效微调', '用有限训练参数适配特定任务'],
  ['tool-calling', '工具调用', '由应用校验参数并执行受控动作'],
  ['agent-memory', 'Agent 记忆', '区分会话状态与长期知识'],
  ['multi-agent', '多智能体协作', '通过清晰角色和消息契约协作'],
  ['stable-diffusion', '扩散模型', '从噪声逐步生成符合条件的图像'],
  ['comfyui', 'ComfyUI', '用节点连接可复用的图像工作流'],
  ['linux', 'Linux 命令', '用明确路径和权限执行系统操作'],
  ['docker', 'Docker', '用镜像与容器提供可重复运行环境'],
  ['fastapi', 'FastAPI 推理服务', '为模型调用提供校验和健康接口'],
  ['vllm', 'vLLM', '通过连续批处理提升推理吞吐'],
  ['gpu', 'GPU 与显存', '根据模型规模与精度评估显存需求'],
  ['sensor', '传感器数据', '采集、校验并解释设备观测数据'],
  ['prompt-injection', '提示词注入', '识别越权指令并隔离不可信输入'],
  ['least-privilege', '最小权限', '只授予完成任务所需的最少能力'],
  ['ai-ethics', '生成式 AI 伦理', '审查数据、偏差、版权和责任边界'],
] as const

export const demoStudents = [
  ['student', '造梦少年', '20260001', '计算机科学与技术', '大二'],
  ['lin-yu', '林宇', '20260002', '人工智能', '大二'],
  ['zhou-nan', '周楠', '20260003', '软件工程', '大三'],
  ['chen-xi', '陈曦', '20260004', '数据科学', '大二'],
  ['yang-fan', '杨帆', '20260005', '自动化', '大三'],
  ['su-qing', '苏晴', '20260006', '数字媒体技术', '大一'],
  ['he-chuan', '贺川', '20260007', '计算机科学与技术', '大二'],
  ['zhao-yue', '赵玥', '20260008', '网络空间安全', '大三'],
  ['gu-an', '顾安', '20260009', '人工智能', '大一'],
  ['shen-yi', '沈一', '20260010', '电子信息工程', '大二'],
  ['lu-yao', '陆遥', '20260011', '物联网工程', '大三'],
  ['cheng-ning', '程宁', '20260012', '软件工程', '大二'],
  ['ye-lan', '叶岚', '20260013', '数据科学', '大一'],
  ['wu-tong', '吴桐', '20260014', '计算机科学与技术', '大三'],
].map(([username, displayName, studentNo, major, grade]) => ({ username, displayName, studentNo, major, grade }))

export const demoAchievements = [
  ['first-course', '学习启程', '完成第一门课程'],
  ['seven-day-streak', '七日坚持', '连续学习七天'],
  ['first-lab', '首次实践', '完成第一次受控实训'],
  ['deployment-starter', '部署新手', '完成模型部署实训'],
  ['agent-builder', 'Agent 构建者', '完成智能体实训'],
  ['command-runner', '命令行探索者', '完成 Linux 命令训练'],
  ['hardware-maker', '硬件创客', '完成智能硬件实验'],
  ['first-assessment', '初次挑战', '完成第一次统一测评'],
  ['high-score', '稳定发挥', '测评正确率达到 85%'],
  ['resource-curator', '资料整理者', '收藏六条学习资源'],
  ['project-maker', '创客作品', '完成一个综合项目'],
  ['learning-star', '本周之星', '进入本周排行榜前 20%'],
].map(([code, name, description]) => ({ code, name, description }))

export const demoCertificates = [
  ['ai-basics-pass', 'AI 基础能力证书', '完成 AI 基础课程并通过综合测评'],
  ['agent-practice', 'AI Agent 实践证书', '完成 Agent 学习路径与项目'],
  ['model-deployment', '模型部署实践证书', '完成模型服务部署与监控实训'],
  ['responsible-ai', '负责任 AI 学习证书', '完成安全、伦理与版权课程'],
].map(([code, name, description]) => ({ code, name, description }))

export const demoLearningPlans = [
  ['完成大模型基础学习路径', 68],
  ['掌握提示词与 RAG 方法', 45],
  ['完成第一个 AI Agent 项目', 36],
  ['完成 Linux 命令训练', 82],
  ['建立模型部署知识框架', 54],
  ['完成 AI 安全基础课程', 28],
  ['准备本周 AI 能力挑战', 76],
  ['整理个人 AI 项目作品集', 20],
].map(([title, progress], index) => ({ id: `demo-plan-${index + 1}`, title: String(title), progress: Number(progress) }))

export const demoActivities = [
  ['林宇', '完成模型部署实训', 'model-service', 120],
  ['周楠', '解锁 Agent 构建者徽章', 'agent-builder', 80],
  ['陈曦', '通过本周 AI 能力挑战', 'weekly-ai', 150],
  ['杨帆', '发布校园问答助手成果', 'campus-agent', 100],
  ['苏晴', '完成提示词设计入门课程', 'prompt-basics', 60],
  ['贺川', '完成 Linux 命令训练', 'linux-command', 90],
  ['赵玥', '收藏 AI 安全实践清单', 'ai-security-list', 20],
  ['顾安', '开始大模型基础学习路径', 'llm', 20],
  ['沈一', '完成传感器数据采集模拟', 'sensor-data', 110],
  ['陆遥', '解锁硬件创客徽章', 'hardware-maker', 80],
  ['程宁', '完成 Function Calling 课程', 'function-calling', 70],
  ['叶岚', '阅读多模态模型对齐文章', 'multimodal', 20],
  ['吴桐', '完成模型服务健康检查', 'service-health', 100],
  ['造梦少年', '提交 RAG 知识库实训', 'rag-lab', 120],
  ['林宇', '创建模型部署学习计划', 'demo-plan-5', 20],
  ['周楠', '完成 Agent 记忆课程', 'agent-memory', 70],
  ['陈曦', '收藏 Transformer 图解', 'transformer-visual', 20],
  ['杨帆', '进入本周排行榜前十', 'weekly-ai', 100],
  ['苏晴', '完成生成式 AI 伦理课程', 'generative-ethics', 60],
  ['贺川', '开始 Docker 与模型容器化课程', 'docker-models', 20],
].map(([student, action, reference, points]) => ({ student: String(student), action: String(action), reference: String(reference), points: Number(points) }))

export const demoHomepageModules = [
  {
    moduleKey: 'hero_banner', name: '首屏 Banner',
    config: {
      eyebrow: '面向高校学生的 AI 学习与实训平台',
      titleLines: ['学 AI，不止是听懂。', '还要亲手做出来。'],
      highlightWords: ['AI', '做出来'],
      subtitle: '从基础知识、前沿趋势，到模型部署、AI Agent、命令行与智能硬件实践。',
      primaryAction: { label: '开始学习', route: '/topics' },
      secondaryAction: { label: '查看实训项目', route: '/labs' },
      visualVariant: 'campus-maker',
      floatingLabels: ['Build', 'Learn', 'Explore'],
      stats: [{ label: 'AI 通识基础', value: '6' }, { label: '模拟实训项目', value: '12+' }, { label: '学习资源', value: '24+' }],
      layoutVariant: 'hero-split', displayLimit: 1,
    },
  },
  {
    moduleKey: 'ability_method', name: '一处学习，四种能力',
    config: {
      eyebrow: '学习方法', title: '一处学习，四种能力', subtitle: '学习、实践与验证形成可持续成长闭环。', layoutVariant: 'numbered-list', displayLimit: 4,
      items: [
        { number: '01', title: '理解', description: '建立 AI 概念与方法的结构化认知。', color: 'orange' },
        { number: '02', title: '探索', description: '跟踪前沿趋势与真实应用边界。', color: 'green' },
        { number: '03', title: '实践', description: '在受控环境完成操作与项目。', color: 'purple' },
        { number: '04', title: '验证', description: '通过测评和成果检查学习效果。', color: 'yellow' },
      ],
    },
  },
  { moduleKey: 'theme_direction', name: '找到你感兴趣的 AI 方向', config: { eyebrow: '主题导航', title: '找到你感兴趣的 AI 方向', subtitle: '六条主题路径覆盖认知、工具、项目和安全。', displayLimit: 6, layoutVariant: 'theme-bento', primaryItem: 'llm' } },
  { moduleKey: 'weekly_featured', name: '本周值得投入时间的内容', config: { eyebrow: '本周精选', title: '本周值得投入时间的内容', subtitle: '一门主课程与四门进阶内容。', displayLimit: 5, layoutVariant: 'one-plus-four', primaryItem: 'llm-zero' } },
  { moduleKey: 'featured_labs', name: '真正动手，而不仅仅是看视频', config: { eyebrow: '模拟实训', title: '真正动手，而不仅仅是看视频', subtitle: '在受控工作台中完成部署、Agent、命令和硬件任务。', displayLimit: 4, layoutVariant: 'numbered-four', primaryItem: 'model-service' } },
  { moduleKey: 'maker_projects', name: '把知识组合成一个作品', config: { eyebrow: '创客项目', title: '把知识组合成一个作品', subtitle: '把课程和实训组合成可展示的校园作品。', displayLimit: 3, layoutVariant: 'horizontal-three', primaryItem: 'campus-assistant' } },
  { moduleKey: 'frontier_news', name: 'AI 世界，本周更新', config: { eyebrow: 'AI 世界', title: 'AI 世界，本周更新', subtitle: '关注能力变化，也关注工程与安全边界。', displayLimit: 5, layoutVariant: 'magazine', primaryItem: 'agent-tools', topicTitle: '本周值得了解的 AI Agent 技术' } },
  { moduleKey: 'resource_tools', name: '工具、模板和资料，都放在这里', config: { eyebrow: '知识工具箱', title: '工具、模板和资料，都放在这里', subtitle: '可下载、可收藏、可用于实践的学习资料。', displayLimit: 6, layoutVariant: 'quick-tools', primaryItem: 'llm-handbook' } },
  { moduleKey: 'weekly_challenge', name: '本周 AI 能力挑战', config: { eyebrow: '能力验证', title: '本周 AI 能力挑战', subtitle: '30 道题 · 20 分钟 · 300 积分奖励', displayLimit: 1, layoutVariant: 'trophy', primaryItem: 'weekly-ai' } },
  { moduleKey: 'growth_summary', name: '用数字记录你的成长', config: { eyebrow: '学习成长', title: '用数字记录你的成长', subtitle: '演示账号：造梦少年', displayLimit: 5, layoutVariant: 'stats-radar', demoAccount: true, stats: [{ label: '累计学习时长', value: '128.6', unit: 'h' }, { label: '完成课程', value: '24', unit: '门' }, { label: '完成实验', value: '18', unit: '个' }, { label: '测评正确率', value: '86', unit: '%' }, { label: '获得徽章', value: '12', unit: '枚' }] } },
  { moduleKey: 'student_activity', name: '同学们正在完成这些事情', config: { eyebrow: '校园动态', title: '同学们正在完成这些事情', subtitle: '演示学习社区的近期活动。', displayLimit: 6, layoutVariant: 'activity-rail' } },
  { moduleKey: 'bottom_action', name: '从学会一个概念，到做出一个 AI 项目', config: { eyebrow: '开始行动', title: '从学会一个概念，到做出一个 AI 项目', subtitle: '今天开始，建立属于你的 AI 能力路径。', displayLimit: 1, layoutVariant: 'brand-cta', primaryAction: { label: '免费开始学习', route: '/topics' }, secondaryAction: { label: '浏览实训项目', route: '/labs' } } },
] as const

export type DemoHomepageModuleKey = typeof demoHomepageModules[number]['moduleKey']

export const demoHomepageRelations: Record<DemoHomepageModuleKey, Array<{ type: string; slug: string }>> = {
  hero_banner: [],
  ability_method: [],
  theme_direction: demoThemes.map((item) => ({ type: 'theme', slug: item.slug })),
  weekly_featured: ['llm-zero', 'prompt-basics', 'agent-first', 'docker-models', 'prompt-injection'].map((slug) => ({ type: 'course', slug })),
  featured_labs: ['model-service', 'campus-agent', 'linux-command', 'board-structure'].map((slug) => ({ type: 'lab', slug })),
  maker_projects: ['campus-assistant', 'energy-analysis', 'image-web'].map((slug) => ({ type: 'lab', slug })),
  frontier_news: ['agent-tools', 'gpt5-campus', 'moe', 'multimodal', 'prompt-injection'].map((slug) => ({ type: 'article', slug })),
  resource_tools: ['llm-handbook', 'prompt-template', 'linux-cheatsheet', 'docker-guide', 'function-guide', 'hardware-interface'].map((slug) => ({ type: 'resource', slug })),
  weekly_challenge: [{ type: 'challenge', slug: 'weekly-ai' }],
  growth_summary: [],
  student_activity: [],
  bottom_action: [],
}

export const fixtureMinimums = {
  themes: 6,
  courses: 24,
  labs: 12,
  makerProjects: 3,
  resources: 24,
  articles: 15,
  challenges: 5,
  questions: 80,
  students: 12,
  achievements: 12,
  certificates: 4,
  learningPlans: 8,
  activities: 20,
  dailyStatistics: 30,
} as const

export { createCommunityFixtures } from './community'
export { lczCuratedPosts, type LczCuratedPost } from './community/lcz-curated-posts'
export { demoResourceHubCategories, demoResourceHubContributions, type DemoResourceHubContribution } from './resource-hub'
