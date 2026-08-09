# 知识补全项目：评委评审与本地运行指南

> 本文是提交、答辩和现场演示的第一入口。评委不需要安装 Codex 或 Claude Code，也可以独立运行完整产品；安装 AI Plugin / Skill 是可选的第二种使用方式。

## 1. 一句话定义

知识补全是一个从用户笔记出发，由 AI 构建**证据可追溯、粒度可切换、缺口可行动**的知识网络产品；每次执行都会生成唯一 `runId`，把图谱持久化，并提供可直接打开的交互页面。

它不是一张写死的知识树，也不是只有界面的静态 Demo。仓库同时包含：

- Knowledge Agent 与确定性图谱编译器；
- 严格校验、持久化和重算 Run 的后端 API；
- `/runs/:runId` 动态 2D 知识网络前端；
- Cloudflare D1 / Drizzle 数据层与正式迁移；
- Codex Plugin；
- Claude Code、Cursor 和通用 Agent Skill 适配；
- 无模型密钥也能执行的离线模式；
- 单元测试、接口测试、UI 契约测试与构建验证。

## 2. 交付包是什么

评审 ZIP 是从 Git 已提交版本直接生成的**干净源码快照**，不是从工作目录随意压缩。因此它会包含真正需要交付的源文件，同时排除：

- `node_modules/`：约数百 MB，且与操作系统和 Node 版本相关，应由 `npm ci` 从锁文件重建；
- `.git/`：提交历史不影响运行，GitHub 仓库保留完整历史；
- `dist/`、`.next/`、`.vinext/`：可重复生成的构建缓存；
- `.wrangler/` 和本机 D1 数据：可能含评审者不需要的本地运行状态；
- `.env*`、密钥和本机凭证；
- 临时输出、运行日志和未提交实验文件。

交付包会保留 `package-lock.json`，因此 `npm ci` 能安装与本项目验证时一致的依赖版本。

## 3. 三种获取方式

### 方式 A：使用随评审材料提供的 ZIP

解压 `knowledge-completion-review-<commit>.zip`，进入其中的 `knowledge-completion/` 目录，然后执行第 4 节命令。

ZIP 同目录提供 `SHA256SUMS.txt`。可用以下方式确认文件没有在传输中损坏：

macOS / Linux：

```bash
shasum -a 256 knowledge-completion-review-<commit>.zip
```

Windows PowerShell：

```powershell
Get-FileHash .\knowledge-completion-review-<commit>.zip -Algorithm SHA256
```

### 方式 B：从 GitHub 克隆

```bash
git clone https://github.com/noxinsun-source/knowledge-completion.git
cd knowledge-completion
```

项目主页：<https://github.com/noxinsun-source/knowledge-completion>

### 方式 C：从 GitHub 下载源码 ZIP

打开项目主页，选择 `Code` → `Download ZIP`，解压后进入项目目录。

直接下载地址：

<https://github.com/noxinsun-source/knowledge-completion/archive/refs/heads/main.zip>

## 4. 八分钟跑通完整产品

### 4.1 环境要求

- Node.js `>= 22.13.0`；
- npm；
- 一个现代浏览器；
- 首次安装依赖时需要访问 npm registry。

检查版本：

```bash
node --version
npm --version
```

### 4.2 安装依赖

在项目根目录执行：

```bash
npm ci
```

如果评审环境修改过 `package-lock.json`，才使用 `npm install`；对于未修改的交付包，推荐使用确定性更强的 `npm ci`。

### 4.3 启动前后端一体化产品

```bash
npm run dev
```

保持该终端运行，然后打开：

<http://localhost:4318>

健康检查：

```bash
curl http://localhost:4318/api/health
```

预期能看到：

```json
{
  "ok": true,
  "service": "knowledge-completion-api",
  "runApiVersion": "v1",
  "storage": "cloudflare-d1"
}
```

这不是可双击打开的单 HTML。产品包含动态路由、API 和 D1 持久化，必须由开发服务器或正式部署运行。

## 5. 一条命令复现 README 中的密集知识网络

另开一个终端，仍在项目根目录执行：

```bash
node plugins/knowledge-completion/skills/knowledge-completion/scripts/submit-run.mjs \
  --note fixtures/demo/coffee-extraction.md \
  --draft artifacts/agent-runs/readme-dense-coffee-draft.json \
  --goal "系统掌握手冲咖啡萃取，并识别测量、流动与感官诊断中的下一步知识缺口" \
  --audience "希望用可验证方法改进冲煮的进阶学习者" \
  --granularity 5 \
  --hops 3 \
  --max-nodes 36 \
  --confidence 0.58
```

该命令会：

1. 完整读取样例笔记；
2. 按 `note_1` 的稳定映射提交结构化 Agent 草稿；
3. 由后端逐字段校验概念、关系和证据；
4. 验证每条“已有笔记覆盖”的摘录确实逐字存在于输入笔记；
5. 编译 canonical graph 和五级粒度投影；
6. 把输入、结果、状态和时间写入本地 D1；
7. 通过 `GET /api/runs/:runId` 回读确认持久化；
8. 输出并打开唯一的 `/runs/:runId` 产品页面。

当前复现实例的结构规模为：

| 指标 | 预期结果 |
|---|---:|
| canonical 概念 | 30 |
| canonical 关系 | 65 |
| 证据记录 | 19 |
| 粒度 1 可见节点 | 1 |
| 粒度 2 可见节点 | 5 |
| 粒度 3 可见节点 | 18 |
| 粒度 4 可见节点 | 28 |
| 粒度 5 可见节点 | 30 |

`runId`、生成时间和运行耗时每次不同，这是正常现象。概念、关系和投影规模应保持稳定。

如果不希望自动打开浏览器，在命令末尾增加：

```bash
--no-open
```

## 6. 评委建议验收路径

### 6.1 验证“不是静态 Demo”

1. 记下 helper 输出的 `runId`；
2. 打开 `/runs/<runId>`；
3. 刷新页面，图谱仍能从 D1 回读；
4. 打开 `/api/runs/<runId>`，查看持久化 JSON；
5. 停止并重新启动服务，再次打开同一 Run。

### 6.2 验证多粒度

依次点击粒度 1–5。中心图谱应立即在领域、主题、概念、机制和实现五个投影之间切换，而不是只修改标签。

### 6.3 验证证据边界

- 亮色节点：至少有一条经过原文逐字校验的笔记证据；
- 深色中心点：用户提交的起始笔记；
- 灰色节点：Agent 提出的相邻知识，但当前笔记尚未覆盖；
- 点击中心点：打开约 70% 屏幕占比的笔记正文；
- 点击普通节点：查看定义、关系、证据与置信度；
- 点击灰色节点的“联网搜索”：打开站内搜索侧栏，不会把缺口伪装成已掌握。

### 6.4 验证持久化 Run API

核心接口：

| 方法 | 路径 | 作用 |
|---|---|---|
| `POST` | `/api/runs` | 创建、执行并持久化一次 Run |
| `GET` | `/api/runs/:runId` | 读取指定 Run |
| `GET` | `/api/runs/:runId/events` | 获取可用于 SSE 的状态事件 |
| `POST` | `/api/runs/:runId/recompute` | 基于历史输入创建不可变的新 Run |
| `GET` | `/api/runs` | 分页列出历史 Run |

## 7. 运行自动化验证

```bash
npm run lint
npm test
```

`npm test` 包含：

- 知识引擎测试；
- Agent、证据与图谱编译测试；
- Run API 和持久化服务测试；
- Plugin helper 严格协议测试；
- Skill 多宿主适配测试；
- 前端交互契约测试；
- 生产构建；
- 服务端渲染结果检查。

GitHub Actions 也会在每次推送后执行同一套主要验证。CI 页面：

<https://github.com/noxinsun-source/knowledge-completion/actions>

## 8. 可选：安装为 Codex Plugin

完整产品不依赖 Codex 才能运行。安装 Plugin 的价值是让 Codex 能直接读取用户笔记、生成符合证据规则的草稿、调用 Run API 并打开可视化页面。

```bash
codex plugin marketplace add noxinsun-source/knowledge-completion --ref main
```

该命令负责添加并跟踪 marketplace。随后在 ChatGPT / Codex 桌面的 **Plugins Directory** 中选择该 marketplace，安装“知识补全项目”。新建 Codex 任务后可以输入：

```text
$knowledge-completion 请读取 /absolute/path/my-note.md，
以“能够把这个主题用于实际项目”为目标，生成粒度 4、扩展 2 跳的知识网络，
找出尚未覆盖的相邻知识并打开产品页面。
```

Plugin 是调用入口，不是完整前端运行时的替代品。可视化页面仍由本仓库服务或受信任部署提供。

## 9. 可选：Claude Code 与 Cursor

仓库提供同一份 vendor-neutral Skill 的宿主适配：

- Claude Code：`.claude/skills/knowledge-completion/`
- Cursor：`.cursor/skills/knowledge-completion/`
- 通用 Skill：`skills/knowledge-completion/`
- Codex Plugin 自包含 Skill：`plugins/knowledge-completion/skills/knowledge-completion/`

详细安装边界和命令见：[AI 宿主集成说明](docs/AI-INTEGRATIONS.md)。

## 10. 关键目录说明

```text
knowledge-completion/
├── app/                              # 产品路由和 Run API
│   ├── api/runs/                     # 创建、读取、事件、重算
│   └── runs/[runId]/                 # 动态产品页面入口
├── apps/
│   ├── api/src/                      # 后端服务、仓储和持久化编排
│   └── web/src/components/           # 真实 Run 知识网络前端
├── packages/
│   ├── contracts/                    # 前后端正式契约
│   ├── knowledge-agent/              # Agent、模型适配和图谱编译
│   └── knowledge-engine/             # MapSpec、覆盖率、掌握度等引擎
├── drizzle/                          # D1 数据库迁移
├── fixtures/demo/                    # 可运行样例笔记
├── artifacts/agent-runs/             # README 密集 Run 的可复现草稿
├── plugins/knowledge-completion/      # 可安装 Codex Plugin
├── skills/knowledge-completion/       # 通用 Skill
├── .claude/ 与 .cursor/               # 其他 AI 宿主适配
├── tests/                             # 自动化验证
├── public/                            # README 与产品视觉资源
└── README.md                          # 完整产品、技术与安装说明
```

## 11. 当前产品边界

当前版本适合本地单用户评审、产品验证和二次开发。它还不是公开 SaaS：

- 没有用户登录；
- 没有多租户隔离；
- 没有公网限流；
- Run API 会保存完整笔记正文；
- 远程部署前必须补充认证、授权、租户、配额和隐私策略。

因此评审时建议使用本地 `localhost:4318`。不要把未经安全加固的服务直接暴露到公网。

## 12. 常见问题

### 页面显示 `ERR_CONNECTION_REFUSED`

确认 `npm run dev` 的终端仍在运行，并访问 <http://localhost:4318>，不要打开 `file:///` 地址。

### 端口 4318 被占用

先停止占用该端口的旧实例，再重新执行 `npm run dev`。不要同时启动多个写入同一本地 D1 的实例。

### 为什么 ZIP 不包含 `node_modules`

它不是项目源码的一部分，而且体积大、平台相关。`package-lock.json` 才是可复现依赖的正式清单；执行 `npm ci` 会恢复依赖。

### 没有模型 API Key 能否演示

可以。仓库样例使用已经结构化的宿主草稿，后端仍会真实执行校验、编译、投影、持久化与页面回读。离线 heuristic 模式也能生成笔记内证据图，但不会虚构笔记外知识。

### GitHub 上有没有已经部署的公共网站

当前仓库提供可运行、可部署的完整代码，但没有承诺公共 SaaS 地址。评审请按本文本地启动，以避免把完整笔记发送给未知服务。

## 13. 提交前最终清单

- [ ] ZIP 文件名包含提交 commit 短哈希；
- [ ] `SHA256SUMS.txt` 与 ZIP 校验一致；
- [ ] ZIP 内第一层目录为 `knowledge-completion/`；
- [ ] 根目录包含本指南、README、LICENSE、package.json 和 package-lock.json；
- [ ] 不包含 `.env`、密钥、本机 D1、`node_modules` 或 `.git`；
- [ ] `npm ci`、`npm run dev` 和密集样例命令可执行；
- [ ] GitHub `main` 与 ZIP 来源 commit 一致；
- [ ] 对应 GitHub Actions CI 为绿色。

如评审时间有限，建议依次检查：**第 4 节启动 → 第 5 节生成 Run → 第 6 节验证真实链路**。
