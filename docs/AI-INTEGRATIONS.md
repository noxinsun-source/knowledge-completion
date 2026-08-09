# AI 宿主集成与 Plugin 安装

Knowledge Completion 采用“可安装 Codex Plugin + 通用 Agent Skill + 真实 HTTP 客户端 + Agent/CLI 回退”的分层方式。Codex Plugin 负责发行，Skill 负责编排，`POST /api/runs` 负责生成并持久化图谱，`/runs/:runId` 是最终可视化产品页。

宿主约定以官方文档为准： [Claude Code Skills](https://code.claude.com/docs/en/skills)、[Cursor Rules](https://cursor.com/docs/rules) 和 [Codex Skills](https://developers.openai.com/codex/skills)。这些产品的发现目录不同，因此仓库保留适配器，但不复制 Agent 业务逻辑。

## 集成矩阵

| 宿主 | 仓库入口 | 直接调用方式 | 说明 |
| --- | --- | --- | --- |
| Codex Plugin | `plugins/knowledge-completion/` | `$knowledge-completion` | 可从本仓库 marketplace 安装；自包含 Skill、API 客户端和协议参考 |
| Codex 仓库 Skill | `.agents/skills/knowledge-completion/SKILL.md` | `$knowledge-completion` | 开发仓库内的薄适配器，转发到 `skills/` |
| Claude Code | `.claude/skills/knowledge-completion/SKILL.md` | `/knowledge-completion` 或自然语言 | Claude Code 的 Agent Skills 入口，内容转发到 `skills/` |
| Cursor | `.cursor/rules/knowledge-completion-agent.mdc` | `@knowledge-completion-agent` 或自然语言 | Cursor 的项目规则入口，同时适用于 `AGENTS.md` |
| 其他 Agent | `AGENTS.md` + `skills/knowledge-completion/SKILL.md` | 将 Skill 内容加入项目规则或系统提示 | 只要能读取 Markdown 并执行 shell，就能使用 |

## 从 GitHub 安装 Codex Plugin

本仓库以公开 marketplace 发行。在 Codex CLI 执行：

```bash
codex plugin marketplace add noxinsun-source/knowledge-completion --ref main
```

该命令添加并跟踪仓库 marketplace。随后在 ChatGPT / Codex 桌面的 **Plugins Directory** 中选择该 marketplace，安装 `.agents/plugins/marketplace.json` 中声明的 `knowledge-completion` Plugin。安装后新建 Codex 任务，调用：

```text
$knowledge-completion 请分析 notes/my-note.md，
以“系统掌握这个主题”为目标，生成粒度 4、扩展 2 跳的知识网络并打开面板。
```

Plugin 内的 `scripts/submit-run.mjs` 是真实可执行的 Node.js 客户端，不是示例提示词。它会：

1. 读取完整笔记并组装 `SourceNote`；
2. 检查 `KNOWLEDGE_COMPLETION_BASE_URL`（默认 `http://localhost:4318`）；
3. 必要时定位已安装的完整仓库 runtime 并启动 `npm run dev`；
4. 校验 `/api/health` 中的服务身份与 Run API 版本；
5. 真实调用 `POST /api/runs`；
6. 通过 `GET /api/runs/:runId` 回读并比较持久化结果；
7. 打印 `runId`、`dashboardUrl`、`eventsUrl`，并尝试打开 `/runs/:runId`。

Plugin 不声明 MCP 服务器，也不假装已经存在公网 SaaS。首次使用时，如果既没有服务也没有 runtime，helper 会明确报错。用户确认固定版本 Git 克隆和依赖下载后，宿主可使用 `--bootstrap-runtime --install-dependencies`：它只克隆与 Plugin 匹配的 release tag，验证 package/plugin 双重身份，不覆盖已有目录，然后安装并启动。如果面板已经部署，设置可信的 `KNOWLEDGE_COMPLETION_BASE_URL` 即可不启动本地 runtime；非本机地址还必须显式传入 `--allow-remote-upload`，因为请求包含完整笔记正文。

## Codex 仓库级 Skill

从仓库根目录打开 Codex，直接输入：

```text
$knowledge-completion 请读取 notes/my-note.md，
以“系统理解这个领域”为目标，生成五级知识地图并列出缺口。
```

Codex 发现的是 `.agents/skills` 适配器，适配器再读取 `skills/` 的通用源文件。该流程同样优先调用 Run API 和可视化页面。

## Claude Code

Claude Code 在仓库内读取 `.claude/skills`：

```text
/knowledge-completion
```

也可以直接说“从这张笔记构建知识地图”。Claude Code 的 `SKILL.md` 格式与本仓库通用源文件兼容；Claude Code 特有的调用控制不写入通用源文件，避免锁定宿主。

## Cursor

Cursor 项目规则位于 `.cursor/rules/*.mdc`。本仓库已提供 `knowledge-completion-agent.mdc`，可以：

```text
@knowledge-completion-agent 请分析 notes/my-note.md，
并输出粒度 1–5 的知识地图和未覆盖节点。
```

根目录的 `AGENTS.md` 作为更广泛的跨工具入口；如果某个版本的 Cursor 未自动加载 `.mdc`，直接在对话中引用 `AGENTS.md` 或 `skills/knowledge-completion/SKILL.md` 即可。

## 其他 AI 工具

如果宿主不支持 Agent Skills 标准，使用以下方式仍然可以完整运行：

1. 将 `skills/knowledge-completion/` 作为项目规则、工作流或系统提示的参考目录；
2. 让宿主先读取 `SKILL.md` 和 `references/agent-schema.md`；
3. 优先执行仓库的 Run API helper：

```bash
node plugins/knowledge-completion/skills/knowledge-completion/scripts/submit-run.mjs \
  --note path/to/note.md \
  --goal "你的目标" \
  --granularity 4 \
  --hops 2 \
  --max-nodes 36
```

4. 只在服务无法启动且用户接受“没有可视化页面”时执行统一 CLI：

```bash
npm run agent -- build \
  --note path/to/note.md \
  --goal "你的目标" \
  --granularity 4 \
  --hops 2 \
  --max-nodes 36 \
  --provider auto \
  --output artifacts/agent-runs/result.json
```

宿主只负责理解用户意图和选择模式，真正的节点预算、证据原文校验、关系端点校验、循环修复和五级投影仍由仓库代码执行。

## 复制到个人配置目录

仓库内的适配器适合项目级共享；个人级安装按宿主复制：

```bash
# Claude Code：复制自包含发行 Skill（含 references 与 helper）
mkdir -p ~/.claude/skills/knowledge-completion
cp -R plugins/knowledge-completion/skills/knowledge-completion/. ~/.claude/skills/knowledge-completion/

# Cursor：将 .cursor/rules/knowledge-completion-agent.mdc 复制到自己的项目 .cursor/rules/
```

个人级安装应复制 Plugin 内的自包含 Skill，以同时保留 `scripts/` 与 `references/`。不要只复制一段提示词，否则执行客户端、关系方向和证据规则都会丢失。产品 runtime 仍来自完整仓库；可以设置 `KNOWLEDGE_COMPLETION_ROOT` 指向它。

## 能力边界

- `heuristic`：无需模型，只承认输入笔记内证据；
- `openai-compatible`：连接本地或云端 `/v1/chat/completions` 服务，执行有界语义扩散；
- 宿主原生草稿：Codex、Claude Code 或 Cursor 可生成 `AgentGraphDraft`，再交给 CLI 编译；
- 任意宿主都不能绕过编译器把无证据候选直接标记为已覆盖或已理解。
