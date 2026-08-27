# 知识补全（知识扩散）· 评测体系

> 本文是功能B 的**可运行评测框架**：从「核心思想 → Agent 策略 → 技术机制」逐层拆解，再落到「可量化指标 → 成熟度阈值 → 实测结果」。评测脚本 `benchmark.mjs` 直接导入 `packages/` 的真实实现，用确定性 mock provider 验证"知识扩散"，离线可复现、不依赖任何 API Key。

## 一、核心思想（产品判断）

知识地图**没有唯一答案**。它是在某个目标、受众、粒度、扩展跳数、节点预算和证据阈值下，对当前输入笔记做的一次**可审计建模**：

1. **地图是目标相关的版本化假设**：`MapSpec` 固定当前地图的解释边界（`goal / audience / granularity / expansionRadius / maxNodes / confidenceThreshold`）。
2. **证据必须可追溯**：概念/关系的 `excerpt` 必须逐字出现在输入笔记；没有笔记证据的相邻知识只能作为灰色边界（boundary），不能假装"已知"。
3. **扩散必须有界**：1–3 跳、节点预算、frontier 按证据强弱排序、novelty 低于阈值即停止——绝不泛化成无边界的领域。
4. **覆盖 / 深度 / 掌握分离**：图上"亮点"只表示"当前 Run 存在来源证据"，不等于收藏、理解或应用。

## 二、Agent 策略（它到底怎么"扩散"）

一次 Run 的完整链路：

```text
输入笔记 + goal
  → validateMapSpec 固定解释边界（越界值被钳制）
  → provider.analyze  提取笔记内可追溯概念（heuristic / 真实模型）
  → mergeAgentDrafts  按 normalizeConceptName 规范化去重合并
  → compileAgentGraph 证据校验（excerpt 逐字命中）、depth 计算、覆盖三态、boundary 识别
  → 有界扩散循环（仅 supportsSemanticExpansion 的 provider）：
       每轮 frontierForRound 选 expandable 且 depth≤round+1 的节点，按证据数/置信度排序取前 8
       provider.expand 提出相邻概念
       编译后统计 novelty（新概念占比），< 0.1 或达 maxNodes 即停止
  → projectAgentGraph 生成 1–5 级确定性投影（不重新调用模型）
  → 持久化 runId + D1，页面回读展示
```

三种 provider 模式与证据边界：

| 模式 | provider | 能做什么 | 不能声称什么 |
|---|---|---|---|
| 离线提取 | `heuristic-offline-v1` | 从标题/列表/显式关系建笔记内图 | 不知道笔记外领域 |
| 宿主草稿 | `host-native-draft-v1` | 宿主 AI 提相邻概念，普通代码校验编译 | AI 提议不自动成为证据 |
| CLI/API 模型 | `openai-compatible` | 连接兼容接口做有界语义扩展 | 模型置信度 ≠ 事实真实性 |

## 三、评测指标与成熟度阈值

成熟度三级：

- **L1 基础**：能运行、能产出、无崩溃。
- **L2 正确**：证据逐字可追溯、有界、投影确定性、概念规范化。
- **L3 成熟**：缺口识别、覆盖三态、停止原因、真实 Provider 端到端。

| # | 指标 | 对应核心思想 | 成熟阈值 | 级别 |
|---|---|---|---|---|
| 1 | 证据逐字命中率 | 证据可追溯 | 带证据 excerpt 100% 逐字命中 | L2 |
| 2 | 伪造证据降级 | 证据可追溯 | 伪造 excerpt 不产生 note 级证据 | L2 |
| 3 | 知识扩散有界性 | 有界扩散 | 节点 ≤ maxNodes 且深度 ≤ radius+1 且有 trace | L2 |
| 4 | 边界节点识别 | 缺口识别 | seed 与 boundary 严格对应证据有无 | L3 |
| 5 | 五级投影确定性与单调性 | 五级投影 | 确定性 + 节点数随粒度单调不减 | L2 |
| 6 | 概念规范化去重 | 概念规范化 | 同语言变体合并 | L2 |
| 7 | MapSpec 越界钳制 | 版本化假设 | 越界值被钳制到边界 | L2 |
| 8 | 覆盖三态区分 | 覆盖/掌握分离 | covered/partial/missing 与证据数量一致 | L3 |
| 9 | Run 契约结构 | 持久化 | runId 格式 + 5 级投影 + metrics 一致 | L2 |

## 四、如何运行

```bash
node --experimental-strip-types evaluation/benchmark.mjs
```

输出 `evaluation/results.json` 与终端摘要。脚本**不调用外部 API**（知识扩散用确定性 mock provider 验证），保证离线可复现。

真实模型（DeepSeek `deepseek-chat`）端到端复现：

```bash
export KNOWLEDGE_AGENT_BASE_URL=https://api.deepseek.com
export KNOWLEDGE_AGENT_MODEL=deepseek-chat
export KNOWLEDGE_AGENT_API_KEY=sk-你的密钥
node plugins/knowledge-completion/skills/knowledge-completion/scripts/submit-run.mjs \
  --note fixtures/demo/coffee-extraction.md \
  --goal "系统理解手冲咖啡萃取并找到下一步知识缺口" \
  --granularity 4 --hops 2 --max-nodes 36 --no-open
```

实测结果记录在 `evaluation/results.json` 的 `realModel` 字段（24 概念 / 52 关系 / 23 证据，`provider: openai-compatible:deepseek-chat`）。

## 五、当前实测结论

**9/9 通过，成熟度 L3（成熟）。** 核心思想（证据可追溯、有界扩散、缺口识别、五级投影、覆盖三态）均有对应指标通过；真实 Provider 端到端可用（见 `evaluation/results.json` 与 README）。
