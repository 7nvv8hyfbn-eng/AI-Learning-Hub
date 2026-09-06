export const demoResourceHubCategories = [
  { id: 'resource-category-ai-foundation', code: 'ai-foundation', name: 'AI 基础', description: '从概念、提示词到模型原理', icon: 'book', sortOrder: 10 },
  { id: 'resource-category-lab-demo', code: 'lab-demo', name: '实训演示', description: '可复核的实训过程与结果', icon: 'lab', sortOrder: 20 },
  { id: 'resource-category-model-deployment', code: 'model-deployment', name: '模型部署', description: '模型服务、运维与排障', icon: 'server', sortOrder: 30 },
  { id: 'resource-category-agent-practice', code: 'agent-practice', name: 'Agent 实战', description: '智能体与工作流实践', icon: 'workflow', sortOrder: 40 },
  { id: 'resource-category-tool-tutorial', code: 'tool-tutorial', name: '工具教程', description: 'AI 工具与效率方法', icon: 'tool', sortOrder: 50 },
  { id: 'resource-category-creator-share', code: 'creator-share', name: '创作者分享', description: '师生作品与创作复盘', icon: 'users', sortOrder: 60 },
  { id: 'resource-category-uncategorized', code: 'uncategorized', name: '其他分享', description: '等待进一步整理的资源', icon: 'folder', sortOrder: 999 },
] as const

export type DemoResourceHubContribution = {
  id: string; title: string; summary: string; kind: 'video' | 'article' | 'document'; categoryCode: string; author: string
  coverType: 'course' | 'lab' | 'resource'; coverSlug: string; coverUrl: string; bannerUrl?: string; videoUrl?: string; attachmentUrl?: string; tags: string[]; durationSeconds?: number
  views: number; likes: number; comments: number; bookmarks: number; publishedAt: string
  featured?: boolean; liveReplay?: boolean; banner?: boolean; demo: true; coverSource: 'imagegen'
}

export const demoResourceHubContributions: DemoResourceHubContribution[] = [
  ['resource-demo-ai-literacy', '15 分钟建立生成式 AI 基础概念', '从模型、训练、推理到提示词，用一张知识地图理清关键概念。', 'video', 'ai-foundation', 'campus-guide-1', 'course', 'ai-literacy', ['AI基础', '生成式AI'], 935, 12640, 684, 92, 531, '2026-08-29T08:00:00.000Z', true, false, true],
  ['resource-demo-campus-agent', '校园问答 Agent 的完整搭建过程', '从资料切分、检索到工具调用，复盘一个可追溯校园助手的实现。', 'video', 'agent-practice', 'student', 'lab', 'campus-agent', ['Agent', 'RAG'], 1280, 10980, 731, 118, 612, '2026-08-28T09:30:00.000Z', true, false, true],
  ['resource-demo-model-service', '把模型服务部署到可验证环境', '完整演示容器启动、健康检查、日志定位和回滚验证。', 'video', 'model-deployment', 'campus-guide-1', 'lab', 'model-service', ['模型部署', 'Docker'], 1106, 9850, 503, 76, 449, '2026-08-27T11:00:00.000Z', true, false, true],
  ['resource-demo-prompt-map', '提示词结构化设计：从目标到验收', '用目标、上下文、约束和示例四步法提升输出的稳定性。', 'article', 'ai-foundation', 'student', 'course', 'prompt-map', ['提示词', '学习方法'], 0, 8420, 492, 65, 706, '2026-08-26T14:00:00.000Z'],
  ['resource-demo-transformer', 'Transformer 注意力机制可视化讲解', '结合矩阵流向和注意力权重，理解编码器中的信息交互。', 'video', 'ai-foundation', 'campus-guide-1', 'course', 'transformer', ['Transformer', '模型原理'], 1460, 7980, 541, 84, 588, '2026-08-25T08:40:00.000Z'],
  ['resource-demo-llm-handbook', '大模型入门学习手册（可下载）', '整理核心术语、学习顺序、实验建议和自检问题。', 'document', 'ai-foundation', 'campus-guide-1', 'resource', 'llm-handbook', ['学习手册', 'LLM'], 0, 7540, 368, 31, 882, '2026-08-24T10:20:00.000Z'],
  ['resource-demo-rag-lab', 'RAG 知识库从切分到评估的实训记录', '展示分块、召回、回答引用和失败样本的逐步验证。', 'video', 'lab-demo', 'student', 'lab', 'rag-lab', ['RAG', '实训'], 1325, 7130, 462, 88, 516, '2026-08-23T13:10:00.000Z'],
  ['resource-demo-image-web', '图像分类 Web 应用课堂展示', '从模型调用到结果解释，演示一个可访问的图像分类页面。', 'video', 'lab-demo', 'student', 'lab', 'image-web', ['图像分类', 'Web'], 1018, 6560, 389, 73, 340, '2026-08-22T15:30:00.000Z'],
  ['resource-demo-monitor', '一次模型服务告警排查演练', '根据健康状态、日志和指标定位故障，并验证恢复是否有效。', 'video', 'lab-demo', 'campus-guide-1', 'lab', 'monitor', ['监控', '排障'], 887, 5940, 318, 56, 297, '2026-08-21T09:15:00.000Z'],
  ['resource-demo-git', 'Git 分支协作的课堂操作演示', '通过安全示例理解分支、提交、冲突和可追溯协作。', 'video', 'lab-demo', 'student', 'lab', 'git', ['Git', '协作'], 760, 5480, 276, 48, 301, '2026-08-20T16:00:00.000Z', false, true],
  ['resource-demo-docker', 'Docker 模型容器化的最小实践', '建立可重复镜像、只读配置和健康检查的基础流程。', 'video', 'model-deployment', 'campus-guide-1', 'course', 'docker', ['Docker', '容器'], 1190, 7240, 421, 62, 477, '2026-08-19T08:20:00.000Z'],
  ['resource-demo-fastapi', '用 FastAPI 发布一个受控推理接口', '补齐参数校验、超时、错误边界和健康检查。', 'article', 'model-deployment', 'student', 'course', 'fastapi', ['FastAPI', 'API'], 0, 6030, 352, 52, 438, '2026-08-18T12:00:00.000Z'],
  ['resource-demo-vllm', 'vLLM 吞吐与显存权衡的测试方法', '用固定请求样本观察批处理、KV Cache 与显存占用。', 'video', 'model-deployment', 'campus-guide-1', 'course', 'vllm', ['vLLM', '性能'], 1522, 5160, 337, 49, 382, '2026-08-17T10:30:00.000Z'],
  ['resource-demo-linux', 'Linux 模型部署命令速查', '常用文件、进程、网络、日志和权限检查命令。', 'document', 'model-deployment', 'campus-guide-1', 'resource', 'linux', ['Linux', '命令'], 0, 4870, 228, 25, 609, '2026-08-16T09:00:00.000Z'],
  ['resource-demo-first-agent', '第一个 AI Agent：规划、工具与反馈', '逐步实现能调用受控工具并解释结果的校园任务助手。', 'video', 'agent-practice', 'student', 'course', 'first-agent', ['Agent', '工具调用'], 1376, 8320, 608, 101, 570, '2026-08-15T14:40:00.000Z'],
  ['resource-demo-function', 'Function Calling 参数契约检查清单', '整理工具描述、参数校验、权限边界和失败反馈。', 'document', 'agent-practice', 'campus-guide-1', 'resource', 'function', ['Function Calling', '清单'], 0, 5290, 302, 37, 472, '2026-08-14T13:00:00.000Z'],
  ['resource-demo-memory', 'Agent 记忆如何避免上下文污染', '区分会话状态、长期知识与检索记忆，并给出清理边界。', 'article', 'agent-practice', 'student', 'course', 'memory', ['Agent记忆', '上下文'], 0, 4610, 315, 61, 403, '2026-08-13T11:20:00.000Z'],
  ['resource-demo-multi-agent', '多智能体协作的角色与消息设计', '展示任务拆分、单写者约束和失败恢复的最小实现。', 'video', 'agent-practice', 'campus-guide-1', 'course', 'multi-agent', ['多智能体', '工作流'], 1684, 4290, 298, 72, 348, '2026-08-12T15:10:00.000Z', false, true],
  ['resource-demo-comfyui', 'ComfyUI 节点工作流的入门方法', '从模型加载到采样与保存，建立可复用的基础工作流。', 'video', 'tool-tutorial', 'student', 'course', 'comfyui', ['ComfyUI', '图像生成'], 1244, 6920, 487, 97, 526, '2026-08-11T09:45:00.000Z'],
  ['resource-demo-terminal', '终端日志阅读与问题定位', '用时间、级别和调用链索引快速缩小错误范围。', 'article', 'tool-tutorial', 'campus-guide-1', 'course', 'terminal', ['终端', '日志'], 0, 3970, 219, 34, 318, '2026-08-10T10:00:00.000Z'],
  ['resource-demo-energy', '宿舍用电分析原型作品复盘', '从模拟传感数据中发现趋势，形成可解释的节能建议。', 'video', 'creator-share', 'student', 'lab', 'energy', ['AIoT', '作品复盘'], 905, 3680, 281, 68, 242, '2026-08-09T14:30:00.000Z', false, true],
  ['resource-demo-edge', '边缘 AI 的设备约束与取舍', '围绕算力、内存、功耗和离线能力复盘模型选择。', 'video', 'creator-share', 'campus-guide-1', 'course', 'edge', ['边缘AI', '硬件'], 1162, 3420, 226, 41, 278, '2026-08-08T08:30:00.000Z'],
  ['resource-demo-privacy', '学生 AI 项目的隐私检查方法', '用最小收集、访问控制和留存期限检查项目风险。', 'article', 'creator-share', 'student', 'course', 'privacy', ['隐私', '数据治理'], 0, 3250, 252, 45, 311, '2026-08-07T11:00:00.000Z'],
  ['resource-demo-live-class', '校园知识助手成果答辩回放', '演示项目目标、检索依据、权限边界和现场问答。', 'video', 'creator-share', 'campus-guide-1', 'lab', 'live-class', ['答辩', '校园助手'], 1820, 3010, 238, 83, 219, '2026-08-06T15:00:00.000Z', false, true],
].map(([id, title, summary, kind, categoryCode, author, coverType, coverSlug, tags, durationSeconds, views, likes, comments, bookmarks, publishedAt, featured, liveReplay, banner], index) => ({
  id, title, summary, kind, categoryCode, author, coverType, coverSlug,
  coverUrl: `/demo/resource-hub/covers/${coverSlug}.jpg`,
  bannerUrl: banner ? `/demo/resource-hub/banners/banner-${index + 1}.jpg` : undefined,
  videoUrl: kind === 'video' ? `/demo/resource-hub/videos/${coverSlug}.mp4` : undefined,
  attachmentUrl: kind === 'document' ? `/demo/resource-hub/attachments/${coverSlug}.txt` : undefined,
  tags, durationSeconds: kind === 'video' ? 8 : undefined,
  views, likes, comments: Math.min(Number(comments), 1), bookmarks, publishedAt, featured: !!featured, liveReplay: !!liveReplay, banner: !!banner,
  demo: true as const, coverSource: 'imagegen' as const,
})) as DemoResourceHubContribution[]
