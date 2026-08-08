# 贡献指南

感谢你帮助知识补全项目（Knowledge Completion）变得更可靠。本项目欢迎产品、交互、知识建模、算法、后端、测试和文档方面的贡献。

## 贡献前先理解三条原则

1. **证据优先**：点亮的概念必须能回链到来源；不能用不可解释的分数替代证据。
2. **事实分层**：真实实现、策展数据、Demo 数据和 Roadmap 必须分别标记。
3. **边界清晰**：Contracts、Engine、API、UI 各自负责一层，不允许为了方便跨层读取内部状态。

## 开发环境

```bash
git clone https://github.com/noxinsun-source/knowledge-completion.git
cd knowledge-completion
npm install
npm run db:generate
npm run dev
```

Node.js 版本必须为 `>=22.13.0`。本地产品地址为 <http://localhost:4318>。

## 选择正确的修改位置

| 修改内容 | 主要目录 |
| --- | --- |
| 交互、动画、布局、可访问性 | `apps/web/` |
| 输入校验、业务编排、持久化 | `apps/api/` |
| 证据、评分、覆盖率、缺口算法 | `packages/knowledge-engine/` |
| 跨层字段与领域对象 | `packages/contracts/` |
| 页面与 HTTP 运行时接入 | `app/`、`worker/` |
| 表结构与索引 | `db/`、`drizzle/` |
| 明确标记的演示数据 | `fixtures/demo/` |

跨层数据结构变化必须先更新 `packages/contracts`，再修改生产者与消费者。

## 分支与提交

建议使用短生命周期分支：

```text
feat/graph-keyboard-navigation
fix/d1-content-hash-upsert
docs/coverage-semantics
```

提交信息采用 Conventional Commits：

```text
feat(web): add graph keyboard navigation
feat(engine): score alias matches separately
fix(api): preserve note id during retry
test(engine): cover partial evidence threshold
docs: explain scope versioning
```

每个提交应只表达一个逻辑变化。不要把格式化、重构和功能修改混在同一提交中。

## 本地质量门禁

提交 PR 前必须运行：

```bash
npm run lint
npm test
```

如果修改了数据库：

```bash
npm run db:generate
```

并检查生成的 SQL 与快照是否符合预期。

## 不同类型修改的额外要求

### 知识算法

- 说明评分语义变化，而不只说明代码变化；
- 给出修改前后的具体笔记示例；
- 保证每个点亮节点仍能回链到证据；
- 新阈值必须进入测试；
- 如果覆盖率不可跨版本比较，必须提升 `scopeVersion`。

### 前端交互

- 同时检查鼠标、键盘和窄屏行为；
- 动画必须尊重 `prefers-reduced-motion`；
- 不得用大面积卡片破坏“点 + 名称”的默认信息密度；
- 详情窗必须能关闭，并处理焦点与 Esc；
- 新节点类型必须同步过滤器、图例和领域类型。

### API 与数据库

- 使用 prepared statements；
- 对字符串长度、必填字段和枚举进行服务端校验；
- 写操作必须考虑重试和幂等；
- Schema 修改必须附迁移；
- 不得把凭据、用户正文或本地 D1 文件提交到 Git。

### Demo 数据与文档

- Demo 笔记 ID 必须以 `demo-` 开头；
- 文档不得把策展网页描述成实时搜索结果；
- Roadmap 能力不能写成“已实现”；
- 修改 README 中的 Mermaid 图后，需要重新生成 `docs/diagrams/01-system-architecture.png`。

## Pull Request 说明

PR 应至少回答：

1. 用户问题是什么？
2. 为什么选择这个方案？
3. 修改发生在哪些架构层？
4. 如何验证？
5. 是否改变覆盖率、数据来源或产品边界？
6. 有哪些未解决风险？

保持 PR 可审查。大型功能应拆为领域协议、核心逻辑、API 和 UI 等可独立验证的步骤。

## 许可证

本项目采用 [MIT License](LICENSE)。提交贡献即表示你有权提交这些内容，并同意按照该许可证分发你的贡献。
