# Implementation status

| 能力 | 状态 | 真实数据/逻辑来源 |
| --- | --- | --- |
| 中心笔记逐跳 360° 动画扩散 | 已实现 | 一跳/二跳分段延迟，曲线与点从父节点生长 |
| 全节点悬停/点击/离开交互 | 已实现 | 190ms 悬停小卡片、点击 70% 详情窗、离开 220ms 自动收起 |
| 2D 互斥布局与边长约束 | 已实现 | 确定性力导向，实际边长限制在基准值的 0.8–1.3 倍 |
| 拖拽、缩放、筛选、重新定心 | 已实现 | 浏览器真实交互 |
| 70% 屏幕笔记正文阅读器 | 已实现 | API 返回的完整笔记正文 |
| 概念覆盖与缺口计算 | 已实现 | `packages/knowledge-engine` 确定性分析 |
| 中心笔记覆盖明暗标识 | 已实现 | 当前笔记有可回链证据的概念点亮，地图存在但本笔记无证据的概念置灰 |
| 证据回链到笔记 | 已实现 | 每个点亮概念包含 `NodeEvidence` |
| 用户笔记持久化 | 已实现 | Cloudflare D1 `atlas_notes` |
| 重复笔记折叠 | 已实现 | SHA-256 内容哈希 + 唯一索引 |
| 权威网页节点 | 已实现（动态 + 策展回退） | Wikipedia、Crossref、Europe PMC、arXiv 实时结果；无动态地图时使用固定链接 |
| 节点联网搜索与站内阅读 | 已实现 | 任意节点详情页发起检索；右侧滚动结果、来源状态、可信度、阅读视图和原网页跳转 |
| 多来源搜索与受限抓取 | 已实现 | 四来源并行、8 秒超时；白名单 HTTPS 页面抓取，正文上限 8,000 字符 |
| 引用去重与可信度 | 已实现（启发式） | DOI 优先、规范化标题回退；来源、DOI、引用、新鲜度、跨源一致性组成评分 |
| MapSpec 动态地图 | 已实现 | 目标启发式建议 + 粒度/跳数/节点/阈值人工控制 |
| 地图冻结、迁移与 Diff | 已实现 | D1 快照；冻结不可原地学习更新，自动派生草稿版本 |
| 别名与概念消歧 | 已实现（确定性） | 规范名/英文名/别名/关键词候选评分；接近同分标记歧义 |
| 人工纠错队列 | 已实现 | 改名/合并/移除，pending/accepted/rejected 审核状态，接受后改写草稿地图 |
| 大仓库增量分析 | 已实现（逐笔记） | noteId + contentHash + analyzerVersion 缓存独立证据贡献 |
| 用户掌握度测验闭环 | 已实现 | saved/quiz/explanation/project 证据与 unknown/seen/understood/applied 状态 |
| 掌握衰减与复验 | 已实现 | 按证据类型半衰期衰减，计算 nextReviewAt 与 needsReverification |
| 缺口微课程 | 已实现（本地教学代理） | 确定性四步课程、检查题、笔记模板；不冒充 LLM 在线生成 |
| 学习后自动重算 | 已实现 | 证据持久化后重新组合当前地图；冻结地图先派生版本 |
| 任意文本/Markdown Agent | 已实现 | `packages/knowledge-agent`；不依赖 Transformer 固定目录 |
| 五级知识图谱投影 | 已实现 | canonical graph 确定性聚合为粒度 1–5 |
| 离线 Agent CLI | 已实现 | `npm run agent`，无需 API Key，严格限制为笔记内证据 |
| OpenAI-compatible 模型扩散 | 已实现 | 可配置 Base URL、模型、Key；1–3 轮 frontier 扩散与停止条件 |
| Agent 证据真实性防线 | 已实现 | Run API 对原文逐字校验；伪造、错引或未知 note ID 直接拒绝，无来源候选保持 boundary |
| Agent 输入与拓扑防线 | 已实现 | 50 篇/500k 字符同步上限、候选预算、循环父子关系修复 |
| Codex Plugin | 已实现 | 正式 manifest + marketplace + 自包含 Skill/helper；POST 后 GET 回读确认持久化 |
| Codex Skill | 已实现 | `.agents/skills/knowledge-completion`，支持 Codex-native draft + Run API 严格编译 |
| 宿主无关 Skill 源文件 | 已实现 | `skills/knowledge-completion`，不绑定任意一家模型或客户端 |
| Claude Code 适配器 | 已实现 | `.claude/skills/knowledge-completion`，转发到通用源文件 |
| Cursor 适配器 | 已实现 | `.cursor/rules/knowledge-completion-agent.mdc` + 根 `AGENTS.md` |
| Agent Run HTTP API | 已实现（heuristic + host draft） | Create/List/Get/SSE/Recompute；每次调用返回唯一 `runId` 与可视化页面 |
| 动态 Run 产品页 | 已实现 | `/runs/:runId` 只读取持久化结果；中心笔记完整正文、五级即时投影、亮/灰节点与搜索侧栏 |
| 演示笔记 | 仅 Demo | 所有样例输入和人工草稿明确隔离在 `fixtures/demo/` |

## 仍未实现

- Web 文件上传、PDF/DOCX 解析与 Agent 进度界面；
- Agent frontier 与现有多来源搜索/网页证据服务的自动闭环；
- Embedding 向量召回和大规模实体消歧；
- Agent Run 后台任务持久化、暂停/恢复和并发调度；
- 多用户认证、租户隔离和权限；
- 后台作业、分片和百万笔记级调度；
- 企业级 SLA、追踪、告警与灾备。

任何新增功能都应在此表中标明“真实实现”“策展数据”或“仅演示”，避免产品演示越过技术事实。
