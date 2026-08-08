"use client";

import Link from "next/link";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type WheelEvent as ReactWheelEvent,
} from "react";
import type {
  ExternalKnowledgeSource,
  KnowledgeAgentRunRecord,
  KnowledgeAgentRunStatus,
  MapGranularity,
  SourceDiscoveryResult,
} from "@/packages/contracts/src";
import type {
  AgentConcept,
  AgentEvidence,
  AgentRelation,
  GranularityProjection,
  KnowledgeAgentRun,
  ProjectionEdge,
  ProjectionNode,
} from "@/packages/knowledge-agent/src/types";
import "./agent-run-network.css";

type PersistedAgentRun = KnowledgeAgentRunRecord<KnowledgeAgentRun>;

type PositionedNode = ProjectionNode & {
  x: number;
  y: number;
  ring: number;
  visualState: "covered" | "evidence" | "boundary";
};

type PositionedEdge = AgentRelation & {
  path: string;
};

type Viewport = {
  scale: number;
  x: number;
  y: number;
};

const WORLD = { width: 1_500, height: 980, centerX: 750, centerY: 490 };
const GRANULARITIES: MapGranularity[] = [1, 2, 3, 4, 5];
const GRANULARITY_LABELS: Record<MapGranularity, string> = {
  1: "领域",
  2: "主题",
  3: "概念",
  4: "机制",
  5: "实现",
};
const RELATION_LABELS: Record<AgentRelation["relation"], string> = {
  contains: "包含",
  prerequisite: "前置于",
  enables: "支撑",
  applied_in: "应用于",
  part_of: "属于",
  contrasts_with: "对比",
  related_to: "相关",
};
const SOURCE_PROVIDER_LABELS: Record<ExternalKnowledgeSource["provider"], string> = {
  crossref: "Crossref",
  "europe-pmc": "Europe PMC",
  arxiv: "arXiv",
  openalex: "OpenAlex",
  wikipedia: "Wikipedia",
};

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value));
}

function stableHash(value: string) {
  let hash = 2_166_136_261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return Math.abs(hash >>> 0);
}

function visualState(node: ProjectionNode): PositionedNode["visualState"] {
  if (node.discoveryState === "boundary" || !node.evidenceIds.length) return "boundary";
  if (node.coverage === "covered") return "covered";
  return "evidence";
}

function statusLabel(status: KnowledgeAgentRunStatus) {
  if (status === "queued") return "等待执行";
  if (status === "running") return "正在生成知识网络";
  if (status === "completed") return "完整生成";
  if (status === "partial") return "部分生成";
  return "生成失败";
}

function parseRunRecord(payload: unknown): PersistedAgentRun {
  if (!payload || typeof payload !== "object") throw new Error("服务返回了无法识别的数据。");
  const envelope = payload as Record<string, unknown>;
  const candidate = envelope.run as Record<string, unknown> | undefined;
  const statuses: KnowledgeAgentRunStatus[] = ["queued", "running", "completed", "partial", "failed"];
  if (
    !candidate ||
    typeof candidate !== "object" ||
    typeof candidate.runId !== "string" ||
    !statuses.includes(candidate.status as KnowledgeAgentRunStatus)
  ) {
    throw new Error(typeof envelope.error === "string" ? envelope.error : "服务没有返回有效的 Agent Run。");
  }
  return candidate as unknown as PersistedAgentRun;
}

function curveBetween(
  source: { x: number; y: number },
  target: { x: number; y: number },
  seed: string,
) {
  const dx = target.x - source.x;
  const dy = target.y - source.y;
  const distance = Math.max(1, Math.hypot(dx, dy));
  const direction = stableHash(`${seed}:bend`) % 2 === 0 ? 1 : -1;
  const bend = 10 + (stableHash(seed) % 18);
  const controlX = (source.x + target.x) / 2 + (-dy / distance) * bend * direction;
  const controlY = (source.y + target.y) / 2 + (dx / distance) * bend * direction;
  return `M ${source.x} ${source.y} Q ${controlX} ${controlY} ${target.x} ${target.y}`;
}

function graphRings(projection: GranularityProjection, rootNodeId: string) {
  const adjacency = new Map<string, string[]>();
  projection.nodes.forEach((node) => adjacency.set(node.id, []));
  projection.edges.forEach((edge) => {
    if (!adjacency.has(edge.sourceId) || !adjacency.has(edge.targetId)) return;
    adjacency.get(edge.sourceId)!.push(edge.targetId);
    adjacency.get(edge.targetId)!.push(edge.sourceId);
  });
  const rings = new Map<string, number>([[rootNodeId, 0]]);
  const queue = [rootNodeId];
  while (queue.length) {
    const current = queue.shift()!;
    const currentRing = rings.get(current) ?? 0;
    for (const adjacent of adjacency.get(current) ?? []) {
      if (rings.has(adjacent)) continue;
      rings.set(adjacent, currentRing + 1);
      queue.push(adjacent);
    }
  }
  projection.nodes.forEach((node) => {
    if (!rings.has(node.id)) rings.set(node.id, clamp(node.depth || 2, 1, 4));
  });
  return rings;
}

function layoutProjection(projection: GranularityProjection, rootNodeId: string) {
  const rings = graphRings(projection, rootNodeId);
  const nodesByRing = new Map<number, ProjectionNode[]>();
  projection.nodes.forEach((node) => {
    const ring = rings.get(node.id) ?? 1;
    const items = nodesByRing.get(ring) ?? [];
    items.push(node);
    nodesByRing.set(ring, items);
  });
  nodesByRing.forEach((nodes) => nodes.sort((left, right) => stableHash(left.id) - stableHash(right.id)));

  const positions = new Map<string, { x: number; y: number; vx: number; vy: number; ring: number }>();
  projection.nodes.forEach((node) => {
    const ring = rings.get(node.id) ?? 1;
    if (node.id === rootNodeId) {
      positions.set(node.id, { x: WORLD.centerX, y: WORLD.centerY, vx: 0, vy: 0, ring: 0 });
      return;
    }
    const peers = nodesByRing.get(ring) ?? [node];
    const peerIndex = peers.findIndex((peer) => peer.id === node.id);
    const angle = -Math.PI / 2 + (Math.PI * 2 * peerIndex) / Math.max(1, peers.length) + ((stableHash(node.id) % 19) - 9) * 0.012;
    const radius = Math.min(405, 154 + (ring - 1) * 116) + ((stableHash(`${node.id}:radius`) % 23) - 11);
    positions.set(node.id, {
      x: WORLD.centerX + Math.cos(angle) * radius,
      y: WORLD.centerY + Math.sin(angle) * radius,
      vx: 0,
      vy: 0,
      ring,
    });
  });

  const validEdges = projection.edges.filter(
    (edge) => positions.has(edge.sourceId) && positions.has(edge.targetId),
  );
  const positioned = [...positions.entries()].filter(([id]) => id !== rootNodeId);

  for (let iteration = 0; iteration < 190; iteration += 1) {
    for (let leftIndex = 0; leftIndex < positioned.length; leftIndex += 1) {
      const left = positioned[leftIndex][1];
      for (let rightIndex = leftIndex + 1; rightIndex < positioned.length; rightIndex += 1) {
        const right = positioned[rightIndex][1];
        let dx = left.x - right.x;
        let dy = left.y - right.y;
        if (dx === 0 && dy === 0) dx = 0.01;
        const squaredDistance = Math.max(225, dx * dx + dy * dy);
        const distance = Math.sqrt(squaredDistance);
        const force = 8_500 / squaredDistance;
        dx /= distance;
        dy /= distance;
        left.vx += dx * force;
        left.vy += dy * force;
        right.vx -= dx * force;
        right.vy -= dy * force;
      }
    }

    for (const edge of validEdges) {
      const source = positions.get(edge.sourceId)!;
      const target = positions.get(edge.targetId)!;
      const dx = target.x - source.x;
      const dy = target.y - source.y;
      const distance = Math.max(1, Math.hypot(dx, dy));
      const targetLength = 155 + Math.min(38, Math.abs(target.ring - source.ring) * 20);
      const spring = (distance - targetLength) * 0.012;
      if (edge.sourceId !== rootNodeId) {
        source.vx += (dx / distance) * spring;
        source.vy += (dy / distance) * spring;
      }
      if (edge.targetId !== rootNodeId) {
        target.vx -= (dx / distance) * spring;
        target.vy -= (dy / distance) * spring;
      }
    }

    for (const [, position] of positioned) {
      const dx = position.x - WORLD.centerX;
      const dy = position.y - WORLD.centerY;
      const distance = Math.max(1, Math.hypot(dx, dy));
      const targetRadius = Math.min(405, 154 + (position.ring - 1) * 116);
      const radialForce = (targetRadius - distance) * 0.006;
      position.vx += (dx / distance) * radialForce;
      position.vy += (dy / distance) * radialForce;
      position.vx *= 0.78;
      position.vy *= 0.78;
      position.x = clamp(position.x + position.vx, 70, WORLD.width - 70);
      position.y = clamp(position.y + position.vy, 60, WORLD.height - 60);
    }
  }

  const nodes: PositionedNode[] = projection.nodes.map((node) => {
    const position = positions.get(node.id) ?? {
      x: WORLD.centerX,
      y: WORLD.centerY,
      ring: 0,
    };
    return {
      ...node,
      x: position.x,
      y: position.y,
      ring: position.ring,
      visualState: visualState(node),
    };
  });
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const edges: PositionedEdge[] = validEdges.map((edge) => ({
    ...edge,
    path: curveBetween(nodeById.get(edge.sourceId)!, nodeById.get(edge.targetId)!, edge.id),
  }));
  return { nodes, edges };
}

function shortRunId(runId: string) {
  if (runId.length <= 22) return runId;
  return `${runId.slice(0, 12)}…${runId.slice(-7)}`;
}

function formatTime(value?: string) {
  if (!value) return "—";
  const time = new Date(value);
  if (Number.isNaN(time.getTime())) return value;
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(time);
}

function sourceHost(source: ExternalKnowledgeSource) {
  try {
    return new URL(source.canonicalUrl).hostname.replace(/^www\./, "");
  } catch {
    return source.provider;
  }
}

function readableSourceContent(source: ExternalKnowledgeSource) {
  const content = source.fetchedContent?.trim();
  if (!content || /requires javascript|sign in\s*\|\s*create an account/i.test(content)) return "";
  return content;
}

function evidenceFor(node: AgentConcept, evidence: AgentEvidence[]) {
  const ids = new Set(node.evidenceIds);
  return evidence.filter((item) => ids.has(item.id));
}

function summarizeNote(content: string, maximumLength = 160) {
  const normalized = content.replace(/\s+/g, " ").trim();
  if (!normalized) return "这篇笔记暂无正文内容。";
  if (normalized.length <= maximumLength) return normalized;
  return `${normalized.slice(0, maximumLength).trimEnd()}…`;
}

function RunStatePage({
  kind,
  title,
  message,
  onRetry,
}: {
  kind: "loading" | "failed";
  title: string;
  message: string;
  onRetry?: () => void;
}) {
  return (
    <main className={`agent-run-state is-${kind}`}>
      <Link className="run-state-brand" href="/">
        <span><i /><i /><i /></span>
        <b>知识补全项目</b>
      </Link>
      <section>
        <div className="run-state-orbit" aria-hidden="true"><i /><i /><i /></div>
        <small>{kind === "loading" ? "PERSISTED AGENT RUN" : "RUN UNAVAILABLE"}</small>
        <h1>{title}</h1>
        <p>{message}</p>
        {onRetry ? <button onClick={onRetry} type="button">重新读取</button> : null}
        <Link href="/">返回知识网络首页</Link>
      </section>
    </main>
  );
}

function RunNodePreview({ node }: { node: PositionedNode }) {
  return (
    <aside className={`run-node-preview is-${node.visualState}`}>
      <small>{node.visualState === "boundary" ? "待补知识" : node.visualState === "covered" ? "笔记已覆盖" : "已有证据"}</small>
      <strong>{node.name}</strong>
      <p>{node.description}</p>
      <footer>
        <span>粒度 {node.granularity}</span>
        <span>{node.aggregateMemberIds.length ? `聚合 ${node.aggregateMemberIds.length + 1} 项` : "点击查看详情"}</span>
      </footer>
    </aside>
  );
}

function RunStartingNotePreview({ run }: { run: KnowledgeAgentRun }) {
  const firstNote = run.notes[0];
  return (
    <aside className="run-node-preview is-covered is-starting-note">
      <small>STARTING NOTE · 起始笔记</small>
      <strong>{firstNote?.title || "未命名起始笔记"}</strong>
      <p>{firstNote ? summarizeNote(firstNote.content) : "Agent Run 没有保存可展示的起始笔记。"}</p>
      <footer>
        <span>共 {run.notes.length} 篇输入笔记</span>
        <span>点击阅读完整正文</span>
      </footer>
    </aside>
  );
}

function RunStartingNoteDetail({
  run,
  onClose,
}: {
  run: KnowledgeAgentRun;
  onClose: () => void;
}) {
  const closeTimerRef = useRef<number | null>(null);
  const firstNote = run.notes[0];
  const totalCharacters = run.notes.reduce((total, note) => total + note.content.length, 0);

  const keepOpen = () => {
    if (closeTimerRef.current) window.clearTimeout(closeTimerRef.current);
    closeTimerRef.current = null;
  };
  const closeSoon = () => {
    keepOpen();
    closeTimerRef.current = window.setTimeout(onClose, 220);
  };
  useEffect(() => () => keepOpen(), []);

  return (
    <div className="run-detail-backdrop">
      <article
        aria-labelledby="run-starting-note-title"
        aria-modal="true"
        className="run-detail-panel is-starting-note"
        onPointerEnter={keepOpen}
        onPointerLeave={closeSoon}
        role="dialog"
      >
        <header>
          <div><i /><span>STARTING NOTE · 起始笔记</span></div>
          <button aria-label="关闭起始笔记详情" onClick={onClose} type="button">×</button>
        </header>
        <div className="run-detail-grid is-starting-note">
          <aside>
            <span>知识网络原点 · {run.notes.length} 篇输入</span>
            <h1 id="run-starting-note-title">{firstNote?.title || "未命名起始笔记"}</h1>
            <p>{firstNote ? summarizeNote(firstNote.content, 220) : "这次 Agent Run 没有保存可展示的笔记正文。"}</p>
            <dl>
              <div><dt>输入笔记</dt><dd>{run.notes.length} 篇</dd></div>
              <div><dt>正文字符</dt><dd>{totalCharacters.toLocaleString("zh-CN")} 字</dd></div>
              <div><dt>首篇来源</dt><dd>{firstNote?.source || "用户输入"}</dd></div>
              <div><dt>捕获时间</dt><dd>{formatTime(firstNote?.capturedAt)}</dd></div>
              <div><dt>图谱概念</dt><dd>{run.metrics.conceptCount} 个</dd></div>
            </dl>
            <p className="run-starting-note-explainer">从这些原始笔记出发，Agent 提取有证据的概念，再向外扩展尚未覆盖的知识边界。</p>
          </aside>
          <section className="run-starting-note-reader">
            <small>NOTE CONTENT · 完整笔记正文</small>
            <div className="run-starting-note-sections">
              {run.notes.length ? run.notes.map((note, index) => (
                <article key={note.id}>
                  <header>
                    <span>笔记 {index + 1} / {run.notes.length}</span>
                    <h2>{note.title}</h2>
                    <p>{note.source || "用户输入"} · {formatTime(note.capturedAt)}</p>
                  </header>
                  <div>{note.content || "这篇笔记暂无正文内容。"}</div>
                </article>
              )) : <p className="run-detail-empty">没有可展示的笔记正文。</p>}
            </div>
          </section>
        </div>
      </article>
    </div>
  );
}

function RunNodeDetail({
  node,
  projection,
  run,
  onClose,
  onSearch,
}: {
  node: PositionedNode;
  projection: GranularityProjection;
  run: KnowledgeAgentRun;
  onClose: () => void;
  onSearch: (node: PositionedNode) => void;
}) {
  const closeTimerRef = useRef<number | null>(null);
  const evidence = evidenceFor(node, run.graph.evidence);
  const related = projection.edges
    .filter((edge) => edge.sourceId === node.id || edge.targetId === node.id)
    .map((edge) => {
      const adjacentId = edge.sourceId === node.id ? edge.targetId : edge.sourceId;
      return {
        edge,
        node: projection.nodes.find((candidate) => candidate.id === adjacentId),
      };
    })
    .filter((item): item is { edge: ProjectionEdge; node: ProjectionNode } => Boolean(item.node));

  const keepOpen = () => {
    if (closeTimerRef.current) window.clearTimeout(closeTimerRef.current);
    closeTimerRef.current = null;
  };
  const closeSoon = () => {
    keepOpen();
    closeTimerRef.current = window.setTimeout(onClose, 220);
  };
  useEffect(() => () => keepOpen(), []);

  return (
    <div className="run-detail-backdrop">
      <article
        aria-labelledby="run-detail-title"
        aria-modal="true"
        className={`run-detail-panel is-${node.visualState}`}
        onPointerEnter={keepOpen}
        onPointerLeave={closeSoon}
        role="dialog"
      >
        <header>
          <div><i /><span>{node.visualState === "boundary" ? "KNOWLEDGE GAP" : "EVIDENCE NODE"}</span></div>
          <button aria-label="关闭详情" onClick={onClose} type="button">×</button>
        </header>
        <div className="run-detail-grid">
          <aside>
            <span>{node.semanticType} · 粒度 {node.granularity}</span>
            <h1 id="run-detail-title">{node.name}</h1>
            <p>{node.aliases.length ? `别名：${node.aliases.join("、")}` : "当前没有登记别名"}</p>
            <dl>
              <div><dt>知识状态</dt><dd>{node.coverage === "covered" ? "已覆盖" : node.coverage === "partial" ? "部分覆盖" : "尚未覆盖"}</dd></div>
              <div><dt>发现阶段</dt><dd>{node.discoveryState === "seed" ? "种子提取" : node.discoveryState === "expanded" ? "相邻扩展" : "边界候选"}</dd></div>
              <div><dt>可信度</dt><dd>{Math.round(node.confidence * 100)}%</dd></div>
              <div><dt>原始证据</dt><dd>{evidence.length} 条</dd></div>
              <div><dt>折叠概念</dt><dd>{node.aggregateMemberIds.length} 个</dd></div>
            </dl>
            <button className="run-web-search-action" onClick={() => onSearch(node)} type="button">联网搜索这个概念 <span>→</span></button>
          </aside>
          <section>
            <small>概念说明</small>
            <p>{node.description}</p>
            {node.whyItMatters ? <blockquote><b>为什么重要</b>{node.whyItMatters}</blockquote> : null}

            <div className="run-detail-section">
              <b>与当前投影的关系</b>
              {related.length ? related.map(({ edge, node: adjacent }) => (
                <article key={edge.id}>
                  <span>{RELATION_LABELS[edge.relation]}</span>
                  <strong>{adjacent.name}</strong>
                  <p>{edge.statement}</p>
                </article>
              )) : <p className="run-detail-empty">当前粒度下没有显式关系。</p>}
            </div>

            <div className="run-detail-section evidence-list">
              <b>可追溯证据</b>
              {evidence.length ? evidence.map((item) => (
                <article key={item.id}>
                  <span>{item.sourceType === "note" ? "笔记原文" : item.sourceType === "web" ? "网页来源" : "模型建议"} · {Math.round(item.confidence * 100)}%</span>
                  <strong>{item.sourceTitle}</strong>
                  <p>{item.excerpt}</p>
                  {item.url ? <a href={item.url} rel="noreferrer" target="_blank">查看来源 ↗</a> : null}
                </article>
              )) : <p className="run-detail-empty">这是地图边界中的待补节点，目前没有被笔记证据覆盖。</p>}
            </div>
          </section>
        </div>
      </article>
    </div>
  );
}

function RunKnowledgeSearchDrawer({
  node,
  onClose,
}: {
  node: PositionedNode;
  onClose: () => void;
}) {
  const initialQuery = node.aliases.find((alias) => /[A-Za-z]/.test(alias)) || node.name;
  const [query, setQuery] = useState(initialQuery);
  const [result, setResult] = useState<SourceDiscoveryResult | null>(null);
  const [selectedSource, setSelectedSource] = useState<ExternalKnowledgeSource | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [message, setMessage] = useState("正在并行检索多来源资料…");
  const requestIdRef = useRef(0);

  const runSearch = async (nextQuery: string) => {
    const normalized = nextQuery.trim();
    if (!normalized) return;
    const requestId = ++requestIdRef.current;
    setStatus("loading");
    setMessage("正在并行检索 Wikipedia、Crossref、Europe PMC 与 arXiv…");
    setSelectedSource(null);
    try {
      const response = await fetch("/api/discovery/search", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ query: normalized, limitPerProvider: 5, crawlTop: 2 }),
      });
      const payload = await response.json() as SourceDiscoveryResult & { error?: string };
      if (!response.ok) throw new Error(payload.error || "联网检索失败。");
      if (requestId !== requestIdRef.current) return;
      setResult(payload);
      setStatus("ready");
      setMessage(payload.sources.length ? `找到 ${payload.sources.length} 个去重结果` : "没有找到匹配资料，可以调整关键词重试。");
    } catch (error) {
      if (requestId !== requestIdRef.current) return;
      setStatus("error");
      setMessage(error instanceof Error ? error.message : "联网检索失败。");
    }
  };

  useEffect(() => {
    const requestId = ++requestIdRef.current;
    let active = true;
    void fetch("/api/discovery/search", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ query: initialQuery, limitPerProvider: 5, crawlTop: 2 }),
    }).then(async (response) => ({
      response,
      payload: await response.json() as SourceDiscoveryResult & { error?: string },
    })).then(({ response, payload }) => {
      if (!active || requestId !== requestIdRef.current) return;
      if (!response.ok) throw new Error(payload.error || "联网检索失败。");
      setResult(payload);
      setStatus("ready");
      setMessage(payload.sources.length ? `找到 ${payload.sources.length} 个去重结果` : "没有找到匹配资料，可以调整关键词重试。");
    }).catch((error: unknown) => {
      if (!active || requestId !== requestIdRef.current) return;
      setStatus("error");
      setMessage(error instanceof Error ? error.message : "联网检索失败。");
    });
    return () => {
      active = false;
      requestIdRef.current += 1;
    };
  }, [initialQuery, node.id]);

  return (
    <aside aria-label="联网搜索知识点" className="run-search-drawer">
      <header>
        <div><small>WEB DISCOVERY</small><b>补全「{node.name}」</b></div>
        <button aria-label="关闭联网搜索" onClick={onClose} type="button">×</button>
      </header>
      <form onSubmit={(event) => {
        event.preventDefault();
        void runSearch(query);
      }}>
        <input aria-label="搜索关键词" onChange={(event) => setQuery(event.currentTarget.value)} value={query} />
        <button disabled={status === "loading"} type="submit">搜索</button>
      </form>
      <div className={`run-search-context is-${node.visualState}`}>
        <i />
        <span><b>{node.visualState === "boundary" ? "当前笔记未覆盖" : "当前节点已有证据"}</b><small>搜索资料不会自动把节点标记为已掌握</small></span>
      </div>

      {selectedSource ? (
        <article className="run-search-reader">
          <button onClick={() => setSelectedSource(null)} type="button">← 返回搜索结果</button>
          <small>{SOURCE_PROVIDER_LABELS[selectedSource.provider]} · {sourceHost(selectedSource)}</small>
          <h2>{selectedSource.title}</h2>
          <div><span>可信度 {Math.round(selectedSource.trustScore * 100)}%</span>{selectedSource.publishedYear ? <span>{selectedSource.publishedYear}</span> : null}</div>
          {selectedSource.authors.length ? <p className="run-search-authors">{selectedSource.authors.join(" · ")}</p> : null}
          <p>{selectedSource.abstract || readableSourceContent(selectedSource) || selectedSource.trustSignals.join("。")}</p>
          {selectedSource.abstract && readableSourceContent(selectedSource) ? <details><summary>查看抓取到的正文摘录</summary><p>{readableSourceContent(selectedSource)}</p></details> : null}
          <footer>{selectedSource.trustSignals.map((signal) => <span key={signal}>{signal}</span>)}</footer>
          <a href={selectedSource.canonicalUrl} rel="noreferrer" target="_blank">在原网页中打开 ↗</a>
        </article>
      ) : (
        <div className="run-search-results-view">
          <div className="run-search-status" aria-live="polite">
            <i className={status}>{status === "loading" ? "◌" : status === "error" ? "!" : "✓"}</i>
            <span><b>{message}</b><small>{result ? `${result.rawCount} 条原始记录 · 合并 ${result.duplicateCount} 条重复来源` : "结果将按来源质量与相关性排序。"}</small></span>
          </div>
          {result?.providers.length ? <div className="run-search-providers">{result.providers.map((provider) => <span className={provider.ok ? "is-ok" : "is-error"} key={provider.provider}>{SOURCE_PROVIDER_LABELS[provider.provider]} {provider.count}</span>)}</div> : null}
          <div className="run-search-results">
            {result?.sources.map((source, index) => (
              <button key={source.id} onClick={() => setSelectedSource(source)} type="button">
                <small>{index + 1} · {sourceHost(source)} · {SOURCE_PROVIDER_LABELS[source.provider]}</small>
                <strong>{source.title}</strong>
                <p>{source.abstract || source.fetchedContent || source.trustSignals.join(" · ")}</p>
                <footer><span>可信度 {Math.round(source.trustScore * 100)}%</span><span>站内阅读 →</span></footer>
              </button>
            ))}
          </div>
        </div>
      )}
    </aside>
  );
}

export function AgentRunNetworkApp({ runId }: { runId: string }) {
  const [record, setRecord] = useState<PersistedAgentRun | null>(null);
  const [loadError, setLoadError] = useState("");
  const [reloadKey, setReloadKey] = useState(0);
  const [granularity, setGranularity] = useState<MapGranularity>(3);
  const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [searchNode, setSearchNode] = useState<PositionedNode | null>(null);
  const [viewport, setViewport] = useState<Viewport>({ scale: 0.88, x: 0, y: 12 });
  const initializedRunIdRef = useRef("");
  const hoverOpenRef = useRef<number | null>(null);
  const hoverCloseRef = useRef<number | null>(null);
  const dragRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    originX: number;
    originY: number;
  } | null>(null);

  useEffect(() => {
    let active = true;
    let pollTimer: number | null = null;
    const controller = new AbortController();

    const load = async () => {
      try {
        const response = await fetch(`/api/runs/${encodeURIComponent(runId)}`, {
          cache: "no-store",
          headers: { accept: "application/json" },
          signal: controller.signal,
        });
        const payload: unknown = await response.json();
        if (!response.ok) {
          const error = payload && typeof payload === "object" && "error" in payload
            ? String((payload as { error: unknown }).error)
            : `读取失败（HTTP ${response.status}）`;
          throw new Error(error);
        }
        const nextRecord = parseRunRecord(payload);
        if (!active) return;
        setRecord(nextRecord);
        setLoadError("");
        if (nextRecord.status === "queued" || nextRecord.status === "running") {
          pollTimer = window.setTimeout(load, 1_200);
        }
      } catch (error) {
        if (!active || controller.signal.aborted) return;
        setLoadError(error instanceof Error ? error.message : "读取 Agent Run 失败。");
      }
    };

    void load();
    return () => {
      active = false;
      controller.abort();
      if (pollTimer) window.clearTimeout(pollTimer);
    };
  }, [reloadKey, runId]);

  const result = record?.result ?? null;
  useEffect(() => {
    if (!result || initializedRunIdRef.current === result.runId) return;
    initializedRunIdRef.current = result.runId;
    setGranularity(result.mapSpec.granularity);
    setViewport({ scale: 0.88, x: 0, y: 12 });
  }, [result]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setSelectedNodeId(null);
        setSearchNode(null);
        setHoveredNodeId(null);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      if (hoverOpenRef.current) window.clearTimeout(hoverOpenRef.current);
      if (hoverCloseRef.current) window.clearTimeout(hoverCloseRef.current);
    };
  }, []);

  const projection = result?.projections[granularity] ?? null;
  const network = useMemo(
    () => projection && result
      ? layoutProjection(projection, result.graph.rootNodeId)
      : { nodes: [] as PositionedNode[], edges: [] as PositionedEdge[] },
    [projection, result],
  );
  const selectedNode = selectedNodeId
    ? network.nodes.find((node) => node.id === selectedNodeId) ?? null
    : null;
  const coveredCount = network.nodes.filter((node) => node.visualState === "covered").length;
  const evidenceCount = network.nodes.filter((node) => node.visualState === "evidence").length;
  const boundaryCount = network.nodes.filter((node) => node.visualState === "boundary").length;

  const beginHover = (nodeId: string) => {
    if (hoverCloseRef.current) window.clearTimeout(hoverCloseRef.current);
    if (hoverOpenRef.current) window.clearTimeout(hoverOpenRef.current);
    hoverOpenRef.current = window.setTimeout(() => setHoveredNodeId(nodeId), 190);
  };
  const endHover = () => {
    if (hoverOpenRef.current) window.clearTimeout(hoverOpenRef.current);
    hoverCloseRef.current = window.setTimeout(() => setHoveredNodeId(null), 150);
  };
  const resetViewport = () => setViewport({ scale: 0.88, x: 0, y: 12 });
  const changeScale = (change: number) => setViewport((current) => ({
    ...current,
    scale: clamp(current.scale + change, 0.45, 1.55),
  }));
  const onPointerDown = (event: ReactPointerEvent<HTMLElement>) => {
    if ((event.target as HTMLElement).closest("button, a, article, aside")) return;
    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      originX: viewport.x,
      originY: viewport.y,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const onPointerMove = (event: ReactPointerEvent<HTMLElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    setViewport((current) => ({
      ...current,
      x: drag.originX + event.clientX - drag.startX,
      y: drag.originY + event.clientY - drag.startY,
    }));
  };
  const onPointerUp = (event: ReactPointerEvent<HTMLElement>) => {
    if (dragRef.current?.pointerId !== event.pointerId) return;
    dragRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };
  const onWheel = (event: ReactWheelEvent<HTMLElement>) => {
    event.preventDefault();
    changeScale(event.deltaY > 0 ? -0.065 : 0.065);
  };

  if (!record && !loadError) {
    return <RunStatePage kind="loading" message={`正在读取 ${shortRunId(runId)} 的持久化图谱…`} title="正在连接 Agent Run" />;
  }
  if (loadError && !record) {
    return <RunStatePage kind="failed" message={loadError} onRetry={() => setReloadKey((value) => value + 1)} title="无法打开这次知识补全" />;
  }
  if (!record) return null;
  if (record.status === "failed" && !result) {
    return <RunStatePage kind="failed" message={record.error?.message || "Agent 没有生成可展示的知识图谱。"} onRetry={() => setReloadKey((value) => value + 1)} title="这次运行失败了" />;
  }
  if (!result) {
    return <RunStatePage kind="loading" message={`${statusLabel(record.status)}。页面会在持久化完成后自动更新。`} title="Agent 正在扩展相邻知识" />;
  }

  const effectiveStatus: KnowledgeAgentRunStatus = result.status === "partial" ? "partial" : record.status;

  return (
    <main className="agent-run-network">
      <header className="agent-run-topbar">
        <Link className="agent-run-brand" href="/">
          <span><i /><i /><i /><i /></span>
          <div><b>知识补全项目</b><small>AGENT RUN NETWORK</small></div>
        </Link>
        <div className={`agent-run-status is-${effectiveStatus}`}>
          <i />
          <span><b>{statusLabel(effectiveStatus)}</b><small>{shortRunId(result.runId)} · 已持久化</small></span>
        </div>
        <nav>
          <Link href="/">← 返回产品首页</Link>
          <a href={`/api/runs/${encodeURIComponent(runId)}`} rel="noreferrer" target="_blank">查看 Run JSON</a>
        </nav>
      </header>

      <section className="agent-run-stage" onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp} onWheel={onWheel}>
        <div aria-hidden="true" className="agent-run-ambient"><i /><i /><i /><i /><i /><i /></div>

        <aside className="agent-run-summary">
          <header><small>RUN SCOPE</small><b>{result.graph.scope}</b></header>
          <p>{result.graph.scopeDescription || result.mapSpec.goal}</p>
          <dl>
            <div><dt>生成方式</dt><dd>{result.provider}</dd></div>
            <div><dt>生成时间</dt><dd>{formatTime(result.generatedAt)}</dd></div>
            <div><dt>模型调用</dt><dd>{result.metrics.modelCalls}</dd></div>
            <div><dt>运行耗时</dt><dd>{result.metrics.durationMs} ms</dd></div>
          </dl>
          <div className="agent-run-goal"><small>用户目标</small><p>{result.mapSpec.goal}</p><span>{result.mapSpec.audience}</span></div>
          <div className="agent-run-legend">
            <span><i className="covered" />笔记已覆盖 <b>{coveredCount}</b></span>
            <span><i className="evidence" />存在部分证据 <b>{evidenceCount}</b></span>
            <span><i className="boundary" />待补边界 <b>{boundaryCount}</b></span>
          </div>
          {result.warnings.length ? (
            <details className="agent-run-warnings">
              <summary>{result.warnings.length} 条运行说明</summary>
              {result.warnings.map((warning) => <p key={warning}>{warning}</p>)}
            </details>
          ) : null}
        </aside>

        <div className="agent-run-granularity" aria-label="知识粒度">
          <span><small>KNOWLEDGE SCALE</small><b>粒度 {granularity} · {GRANULARITY_LABELS[granularity]}</b></span>
          <div>
            {GRANULARITIES.map((level) => (
              <button
                aria-label={`切换到粒度 ${level}：${GRANULARITY_LABELS[level]}`}
                aria-pressed={granularity === level}
                disabled={!result.projections[level]}
                key={level}
                onClick={() => {
                  setGranularity(level);
                  setHoveredNodeId(null);
                  setSelectedNodeId(null);
                  setSearchNode(null);
                }}
                type="button"
              >
                <b>{level}</b><small>{GRANULARITY_LABELS[level]}</small>
              </button>
            ))}
          </div>
          <p><strong>{network.nodes.length}</strong> 个可见节点 · 隐藏 {projection?.hiddenNodeCount ?? 0} 个 · 覆盖 {Math.round((projection?.coverage ?? 0) * 100)}%</p>
        </div>

        <div className="agent-run-controls">
          <button aria-label="缩小知识网络" onClick={() => changeScale(-0.1)} type="button">−</button>
          <b>{Math.round(viewport.scale * 100)}%</b>
          <button aria-label="放大知识网络" onClick={() => changeScale(0.1)} type="button">＋</button>
          <span />
          <button onClick={resetViewport} type="button">复位</button>
        </div>

        <div
          className="agent-run-world"
          style={{ transform: `translate(-50%, -50%) translate(${viewport.x}px, ${viewport.y}px) scale(${viewport.scale})` }}
        >
          <svg aria-hidden="true" className="agent-run-edges" viewBox={`0 0 ${WORLD.width} ${WORLD.height}`}>
            {network.edges.map((edge, index) => (
              <path
                className={edge.reviewState === "needs-review" ? "needs-review" : ""}
                d={edge.path}
                key={edge.id}
                pathLength="1"
                style={{ "--edge-delay": `${Math.min(680, index * 24)}ms` } as CSSProperties}
              />
            ))}
          </svg>

          {network.nodes.map((node, index) => {
            const isRoot = node.id === result.graph.rootNodeId;
            const displayName = isRoot ? result.notes[0]?.title || "起始笔记" : node.name;
            return (
              <div
                className={`agent-run-node is-${node.visualState}${isRoot ? " is-root is-starting-note" : ""}`}
                key={node.id}
                onPointerEnter={() => beginHover(node.id)}
                onPointerLeave={endHover}
                style={{
                  left: `${node.x}px`,
                  top: `${node.y}px`,
                  "--node-delay": `${Math.min(760, node.ring * 140 + index * 20)}ms`,
                } as CSSProperties}
              >
                <span className="agent-run-node-label">{displayName}</span>
                <button
                  aria-label={isRoot
                    ? `打开起始笔记：${displayName}`
                    : `查看 ${node.name}：${node.visualState === "boundary" ? "待补知识" : "已有证据"}`}
                  className="agent-run-dot"
                  onClick={() => {
                    setSelectedNodeId(node.id);
                    setHoveredNodeId(null);
                  }}
                  type="button"
                ><i /><i /></button>
                {hoveredNodeId === node.id
                  ? isRoot
                    ? <RunStartingNotePreview run={result} />
                    : <RunNodePreview node={node} />
                  : null}
              </div>
            );
          })}
        </div>

        <footer className="agent-run-hint">
          <span>滚轮缩放 · 拖动画布 · 悬停预览 · 点击节点查看证据</span>
          <b>亮点来自真实证据，灰点是 Agent 发现但尚未覆盖的知识边界</b>
        </footer>
      </section>

      {selectedNode && projection
        ? selectedNode.id === result.graph.rootNodeId
          ? <RunStartingNoteDetail onClose={() => setSelectedNodeId(null)} run={result} />
          : (
            <RunNodeDetail
              node={selectedNode}
              onClose={() => setSelectedNodeId(null)}
              onSearch={(node) => {
                setSelectedNodeId(null);
                setSearchNode(node);
              }}
              projection={projection}
              run={result}
            />
          )
        : null}
      {searchNode ? <RunKnowledgeSearchDrawer key={searchNode.id} node={searchNode} onClose={() => setSearchNode(null)} /> : null}
    </main>
  );
}
