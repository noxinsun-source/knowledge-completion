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
  AnalyzedKnowledgeNode,
  DiscoveryMap,
  ExternalKnowledgeSource,
  KnowledgeAnalysis,
  MapSpec,
  MapVersionDiff,
  SourceDiscoveryResult,
  SourceNote,
  TutorLesson,
} from "@/packages/contracts/src";
import "./knowledge-network.css";

type NodeType = "concept" | "gap" | "note" | "web";

type NetworkNode = {
  id: string;
  type: NodeType;
  label: string;
  eyebrow: string;
  summary: string;
  parentId: string;
  depth: 1 | 2;
  x: number;
  y: number;
  concept?: AnalyzedKnowledgeNode;
  note?: SourceNote;
  url?: string;
  domain?: string;
  trustScore?: number;
  coverageState: "covered" | "uncovered" | "evidence";
};

type SearchTarget = {
  id: string;
  query: string;
  context: string;
  coverageState: NetworkNode["coverageState"];
};

type NetworkEdge = {
  id: string;
  sourceId: string;
  targetId: string;
  depth: 1 | 2;
  path: string;
  length: number;
};

type NetworkModel = {
  nodes: NetworkNode[];
  edges: NetworkEdge[];
  concepts: AnalyzedKnowledgeNode[];
};

const WORLD = { width: 1080, height: 760, centerX: 540, centerY: 380 };
const SPRING_LENGTH = 174;
const EDGE_MIN = SPRING_LENGTH * 0.8;
const EDGE_MAX = SPRING_LENGTH * 1.3;
const HOVER_OPEN_MS = 220;
const HOVER_CLOSE_MS = 170;

const GRANULARITY_LABELS: Record<MapSpec["granularity"], string> = {
  1: "领域范围",
  2: "主题模块",
  3: "核心概念",
  4: "机制与方法",
  5: "公式、实现与例子",
};

const WEB_SOURCES = [
  {
    id: "web-google-transformer",
    title: "Attention Is All You Need",
    domain: "Google Research",
    url: "https://research.google/pubs/attention-is-all-you-need/",
    summary: "Transformer 原始论文的研究发布页与正式摘要。",
    conceptIds: ["attention", "self-attention", "multi-head-attention", "positional-encoding", "transformer-block"],
  },
  {
    id: "web-neurips-transformer",
    title: "Transformer 原始论文 PDF",
    domain: "NeurIPS Proceedings",
    url: "https://papers.neurips.cc/paper/2017/file/3f5ee243547dee91fbd053c1c4a845aa-Paper.pdf",
    summary: "包含缩放点积注意力、多头注意力与完整架构实验。",
    conceptIds: ["attention", "self-attention", "multi-head-attention", "softmax", "transformer-block"],
  },
  {
    id: "web-hf-transformers",
    title: "Transformer Architectures",
    domain: "Hugging Face Course",
    url: "https://huggingface.co/docs/course/main/en/chapter1/6",
    summary: "从编码器、解码器到注意力变体的课程式说明。",
    conceptIds: ["nlp", "attention", "pretraining", "fine-tuning", "transformer-block"],
  },
  {
    id: "web-stanford-transformers",
    title: "CS224N · Transformers",
    domain: "Stanford University",
    url: "https://web.stanford.edu/class/cs224n/slides/cs224n-spr2024-lecture08-transformers.pdf",
    summary: "从 RNN 瓶颈到自注意力、FFN、残差与位置表示。",
    conceptIds: ["sequence-models", "self-attention", "ffn", "residual", "positional-encoding"],
  },
  {
    id: "web-pytorch-attention",
    title: "PyTorch scaled_dot_product_attention",
    domain: "PyTorch Documentation",
    url: "https://pytorch.org/docs/stable/generated/torch.nn.functional.scaled_dot_product_attention.html",
    summary: "可运行的缩放点积注意力 API、掩码和后端实现说明。",
    conceptIds: ["attention", "self-attention", "softmax", "transformer-block"],
  },
  {
    id: "web-flash-attention",
    title: "FlashAttention: Fast and Memory-Efficient Exact Attention",
    domain: "NeurIPS Proceedings",
    url: "https://arxiv.org/abs/2205.14135",
    summary: "从 IO-aware 角度解释注意力显存访问与推理性能。",
    conceptIds: ["attention", "self-attention", "kv-cache", "quantization"],
  },
  {
    id: "web-lora-paper",
    title: "LoRA: Low-Rank Adaptation of Large Language Models",
    domain: "arXiv",
    url: "https://arxiv.org/abs/2106.09685",
    summary: "参数高效微调的原始论文与低秩适配矩阵解释。",
    conceptIds: ["fine-tuning", "pretraining", "neural-networks"],
  },
  {
    id: "web-vllm-paged-attention",
    title: "vLLM PagedAttention",
    domain: "vLLM Documentation",
    url: "https://docs.vllm.ai/en/latest/design/kernel/paged_attention.html",
    summary: "KV Cache 分页管理与大模型服务吞吐优化的工程资料。",
    conceptIds: ["kv-cache", "self-attention", "transformer-block"],
  },
] as const;

function hashText(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return Math.abs(hash >>> 0);
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function sourceKind(note: SourceNote) {
  return note.id.startsWith("demo-")
    ? { label: "演示样本", className: "is-sample" }
    : { label: "D1 笔记", className: "is-local" };
}

function forceLayout(
  candidates: Array<Omit<NetworkNode, "x" | "y">>,
): NetworkNode[] {
  const positions = new Map<string, { x: number; y: number; vx: number; vy: number }>();
  const firstHop = candidates.filter((node) => node.depth === 1);

  firstHop.forEach((node, index) => {
    const angle = -Math.PI / 2 + (Math.PI * 2 * index) / Math.max(1, firstHop.length);
    const jitter = (hashText(node.id) % 21) - 10;
    positions.set(node.id, {
      x: WORLD.centerX + Math.cos(angle) * (SPRING_LENGTH + jitter),
      y: WORLD.centerY + Math.sin(angle) * (SPRING_LENGTH + jitter),
      vx: 0,
      vy: 0,
    });
  });

  const childrenByParent = new Map<string, Array<Omit<NetworkNode, "x" | "y">>>();
  candidates.filter((node) => node.depth === 2).forEach((node) => {
    const children = childrenByParent.get(node.parentId) ?? [];
    children.push(node);
    childrenByParent.set(node.parentId, children);
  });
  childrenByParent.forEach((children, parentId) => {
    const parent = positions.get(parentId) ?? {
      x: WORLD.centerX,
      y: WORLD.centerY,
      vx: 0,
      vy: 0,
    };
    const baseAngle = Math.atan2(parent.y - WORLD.centerY, parent.x - WORLD.centerX);
    children.forEach((node, index) => {
      const offset = (index - (children.length - 1) / 2) * 0.72;
      const angle = baseAngle + offset;
      const jitter = (hashText(node.id) % 25) - 12;
      positions.set(node.id, {
        x: parent.x + Math.cos(angle) * (SPRING_LENGTH + jitter),
        y: parent.y + Math.sin(angle) * (SPRING_LENGTH + jitter),
        vx: 0,
        vy: 0,
      });
    });
  });

  const positionList = candidates.map((node) => ({ node, position: positions.get(node.id)! }));
  for (let iteration = 0; iteration < 150; iteration += 1) {
    for (let left = 0; left < positionList.length; left += 1) {
      for (let right = left + 1; right < positionList.length; right += 1) {
        const a = positionList[left].position;
        const b = positionList[right].position;
        let dx = a.x - b.x;
        let dy = a.y - b.y;
        if (dx === 0 && dy === 0) dx = 0.01;
        const distanceSquared = Math.max(144, dx * dx + dy * dy);
        const distance = Math.sqrt(distanceSquared);
        const force = 4_400 / distanceSquared;
        dx /= distance;
        dy /= distance;
        a.vx += dx * force;
        a.vy += dy * force;
        b.vx -= dx * force;
        b.vy -= dy * force;
      }
    }

    positionList.forEach(({ node, position }) => {
      const parent =
        node.parentId === "seed"
          ? { x: WORLD.centerX, y: WORLD.centerY }
          : positions.get(node.parentId) ?? { x: WORLD.centerX, y: WORLD.centerY };
      const dx = parent.x - position.x;
      const dy = parent.y - position.y;
      const distance = Math.max(1, Math.hypot(dx, dy));
      const springForce = (distance - SPRING_LENGTH) * 0.024;
      position.vx += (dx / distance) * springForce;
      position.vy += (dy / distance) * springForce;

      const centerDx = position.x - WORLD.centerX;
      const centerDy = position.y - WORLD.centerY;
      const radius = Math.max(1, Math.hypot(centerDx, centerDy));
      const desiredRadius = node.depth * SPRING_LENGTH;
      const radialForce = (desiredRadius - radius) * 0.008;
      position.vx += (centerDx / radius) * radialForce;
      position.vy += (centerDy / radius) * radialForce;
    });

    positionList.forEach(({ position }) => {
      position.vx *= 0.76;
      position.vy *= 0.76;
      position.x = clamp(position.x + position.vx, 56, WORLD.width - 56);
      position.y = clamp(position.y + position.vy, 50, WORLD.height - 50);
    });
  }

  [...candidates]
    .sort((left, right) => left.depth - right.depth)
    .forEach((node) => {
      const position = positions.get(node.id)!;
      const parent =
        node.parentId === "seed"
          ? { x: WORLD.centerX, y: WORLD.centerY }
          : positions.get(node.parentId) ?? { x: WORLD.centerX, y: WORLD.centerY };
      const dx = position.x - parent.x;
      const dy = position.y - parent.y;
      const distance = Math.max(1, Math.hypot(dx, dy));
      const bounded = clamp(distance, EDGE_MIN, EDGE_MAX);
      position.x = parent.x + (dx / distance) * bounded;
      position.y = parent.y + (dy / distance) * bounded;
    });

  return candidates.map((node) => {
    const position = positions.get(node.id)!;
    return { ...node, x: position.x, y: position.y };
  });
}

function curveBetween(
  source: { x: number; y: number },
  target: { x: number; y: number },
  seed: string,
) {
  const dx = target.x - source.x;
  const dy = target.y - source.y;
  const length = Math.max(1, Math.hypot(dx, dy));
  const bend = 8 + (hashText(seed) % 13);
  const direction = hashText(`${seed}:direction`) % 2 === 0 ? 1 : -1;
  const controlX = (source.x + target.x) / 2 + (-dy / length) * bend * direction;
  const controlY = (source.y + target.y) / 2 + (dx / length) * bend * direction;
  return `M ${source.x} ${source.y} Q ${controlX} ${controlY} ${target.x} ${target.y}`;
}

function displayGranularity(node: AnalyzedKnowledgeNode): MapSpec["granularity"] {
  if (node.granularity) return node.granularity;
  const byGroup: Record<string, MapSpec["granularity"]> = {
    基础: 1,
    表示: 2,
    核心机制: 3,
    架构: 4,
    训练与推理: 5,
    应用: 5,
  };
  return byGroup[node.group] ?? 3;
}

function takeBucket<T>(items: T[], count: number) {
  return items.slice(0, Math.max(0, count));
}

function buildNetwork(
  analysis: KnowledgeAnalysis,
  seedNote: SourceNote,
  externalSources: ExternalKnowledgeSource[] = [],
  view: Pick<MapSpec, "granularity" | "maxNodes" | "expansionRadius"> = {
    granularity: 5,
    maxNodes: 34,
    expansionRadius: 2,
  },
): NetworkModel {
  const directConcepts = analysis.nodes
    .filter(
      (node) =>
        node.kind !== "domain" &&
        displayGranularity(node) <= view.granularity &&
        node.evidence.some((evidence) => evidence.noteId === seedNote.id),
    )
    .sort((left, right) => right.score - left.score)
    .slice(0, 18);
  const directIds = new Set(directConcepts.map((node) => node.id));
  const adjacentConcepts = analysis.nodes
    .filter(
      (node) =>
        node.kind !== "domain" &&
        !directIds.has(node.id) &&
        displayGranularity(node) <= view.granularity &&
        analysis.edges.some(
          (edge) =>
            (edge.source === node.id && directIds.has(edge.target)) ||
            (edge.target === node.id && directIds.has(edge.source)),
        ),
    )
    .sort((left, right) => right.priority - left.priority || right.score - left.score)
    .slice(0, 18);
  const concepts = [...directConcepts, ...adjacentConcepts];
  const conceptIds = new Set(concepts.map((concept) => concept.id));
  const candidates: Array<Omit<NetworkNode, "x" | "y">> = directConcepts.map((concept) => ({
    id: `concept:${concept.id}`,
    type: "concept",
    label: concept.label,
    eyebrow: `本笔记已覆盖 · ${Math.round(concept.score * 100)}% 证据`,
    summary: concept.description,
    parentId: "seed",
    depth: 1,
    concept,
    coverageState: "covered",
  }));

  if (view.expansionRadius >= 2) {
    adjacentConcepts.forEach((concept) => {
      const parent = analysis.edges.find(
        (edge) =>
          (edge.source === concept.id && directIds.has(edge.target)) ||
          (edge.target === concept.id && directIds.has(edge.source)),
      );
      const parentConceptId = parent
        ? parent.source === concept.id
          ? parent.target
          : parent.source
        : directConcepts[0]?.id;
      candidates.push({
        id: `concept:${concept.id}`,
        type: "concept",
        label: concept.label,
        eyebrow: `邻近概念 · 本笔记未覆盖`,
        summary: concept.description,
        parentId: parentConceptId ? `concept:${parentConceptId}` : "seed",
        depth: parentConceptId ? 2 : 1,
        concept,
        coverageState: "uncovered",
      });
    });
  }

  const relatedScores = new Map<string, { score: number; parentId: string }>();
  concepts.forEach((concept) => {
    concept.evidence.forEach((evidence) => {
      if (evidence.noteId === seedNote.id) return;
      const current = relatedScores.get(evidence.noteId);
      if (!current || evidence.score > current.score) {
        relatedScores.set(evidence.noteId, {
          score: evidence.score,
          parentId: `concept:${concept.id}`,
        });
      }
    });
  });
  [...relatedScores.entries()]
    .sort((left, right) => right[1].score - left[1].score)
    .slice(0, view.expansionRadius >= 2 ? 10 : 0)
    .forEach(([noteId, relation]) => {
      const note = analysis.notes.find((item) => item.id === noteId);
      if (!note) return;
      const kind = sourceKind(note);
      candidates.push({
        id: `note:${note.id}`,
        type: "note",
        label: note.title,
        eyebrow: `${kind.label} · 关联笔记`,
        summary: note.content,
        parentId: relation.parentId,
        depth: 2,
        note,
        coverageState: "evidence",
      });
    });

  const webSources = externalSources.length
    ? externalSources.map((source) => ({
        id: source.id,
        title: source.title,
        domain: new URL(source.canonicalUrl).hostname,
        url: source.canonicalUrl,
        summary: source.abstract || source.fetchedContent || source.trustSignals.join(" · "),
        conceptIds: source.matchedConceptIds,
        trustScore: source.trustScore,
      }))
    : WEB_SOURCES.map((source) => ({ ...source, trustScore: 0.9 }));
  webSources.filter((source) =>
    source.conceptIds.some((conceptId) => conceptIds.has(conceptId)),
  )
    .slice(0, 8)
    .forEach((source) => {
      const parentConcept = source.conceptIds.find((conceptId) => conceptIds.has(conceptId));
      candidates.push({
        id: `web:${source.id}`,
        type: "web",
        label: source.title,
        eyebrow: "权威网页 · 已核验",
        summary: source.summary,
        parentId: parentConcept ? `concept:${parentConcept}` : "seed",
        depth: parentConcept ? 2 : 1,
        url: source.url,
        domain: source.domain,
        trustScore: source.trustScore,
        coverageState: "evidence",
      });
    });

  const gapIds = new Set<string>();
  analysis.edges.forEach((edge) => {
    if (conceptIds.has(edge.source)) gapIds.add(edge.target);
    if (conceptIds.has(edge.target)) gapIds.add(edge.source);
  });
  [...gapIds]
    .map((id) => analysis.nodes.find((node) => node.id === id))
    .filter(
      (node): node is AnalyzedKnowledgeNode =>
        Boolean(
          node &&
            !conceptIds.has(node.id) &&
            (node.status === "missing" || node.status === "partial"),
        ),
    )
    .sort((left, right) => right.priority - left.priority)
    .slice(0, 10)
    .forEach((concept) => {
      const parent = analysis.edges.find(
        (edge) =>
          (edge.source === concept.id && conceptIds.has(edge.target)) ||
          (edge.target === concept.id && conceptIds.has(edge.source)),
      );
      const parentId = parent
        ? `concept:${parent.source === concept.id ? parent.target : parent.source}`
        : "seed";
      candidates.push({
        id: `gap:${concept.id}`,
        type: "gap",
        label: concept.label,
        eyebrow: "相邻缺口 · 待补充",
        summary: concept.gapReason ?? concept.whyItMatters,
        parentId,
        depth: parentId === "seed" ? 1 : 2,
        concept,
        coverageState: "uncovered",
      });
    });

  const conceptBudget = Math.max(4, Math.round(view.maxNodes * 0.5));
  const noteBudget = Math.max(2, Math.round(view.maxNodes * 0.2));
  const webBudget = Math.max(1, Math.round(view.maxNodes * 0.15));
  const gapBudget = Math.max(1, view.maxNodes - conceptBudget - noteBudget - webBudget);
  const limitedCandidates = [
    ...takeBucket(candidates.filter((candidate) => candidate.type === "concept"), conceptBudget),
    ...takeBucket(candidates.filter((candidate) => candidate.type === "note"), noteBudget),
    ...(view.expansionRadius >= 2
      ? takeBucket(candidates.filter((candidate) => candidate.type === "web"), webBudget)
      : []),
    ...(view.expansionRadius >= 2
      ? takeBucket(candidates.filter((candidate) => candidate.type === "gap"), gapBudget)
      : []),
  ];
  const limitedIds = new Set(limitedCandidates.map((candidate) => candidate.id));
  const normalizedCandidates = limitedCandidates.map((candidate) => {
    if (candidate.parentId !== "seed" && !limitedIds.has(candidate.parentId)) {
      return { ...candidate, parentId: "seed", depth: 1 as const };
    }
    return candidate;
  });
  const nodes = forceLayout(normalizedCandidates);
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const edges = nodes.map((node) => {
    const source =
      node.parentId === "seed"
        ? { x: WORLD.centerX, y: WORLD.centerY }
        : nodeById.get(node.parentId) ?? { x: WORLD.centerX, y: WORLD.centerY };
    return {
      id: `${node.parentId}->${node.id}`,
      sourceId: node.parentId,
      targetId: node.id,
      depth: node.depth,
      path: curveBetween(source, node, `${seedNote.id}:${node.id}`),
      length: Math.hypot(node.x - source.x, node.y - source.y),
    };
  });
  return { nodes, edges, concepts };
}

function MiniCard({
  eyebrow,
  title,
  summary,
}: {
  eyebrow: string;
  title: string;
  summary: string;
}) {
  return (
    <aside className="node-mini-card">
      <small>{eyebrow}</small>
      <strong>{title}</strong>
      <p>{summary}</p>
      <span>点击查看完整详情</span>
    </aside>
  );
}

const PROVIDER_LABELS: Record<ExternalKnowledgeSource["provider"], string> = {
  crossref: "Crossref",
  "europe-pmc": "Europe PMC",
  arxiv: "arXiv",
  openalex: "OpenAlex",
  wikipedia: "Wikipedia",
  bing: "Bing 搜索",
};

function sourceHostname(source: ExternalKnowledgeSource) {
  try { return new URL(source.canonicalUrl).hostname.replace(/^www\./, ""); }
  catch { return source.provider; }
}

function searchQueryForTitle(title: string) {
  return title.replace(/[《》]/g, "").replace(/(?:精读卡|学习笔记|实践记录|原型复盘|最短解释)$/u, "").trim();
}

function readableFetchedContent(source: ExternalKnowledgeSource) {
  const content = source.fetchedContent?.trim();
  if (!content || /requires javascript|sign in\s*\|\s*create an account/i.test(content)) return "";
  return content;
}

function KnowledgeSearchDrawer({ target, onClose }: { target: SearchTarget; onClose: () => void }) {
  const [query, setQuery] = useState(target.query);
  const [result, setResult] = useState<SourceDiscoveryResult | null>(null);
  const [selectedSource, setSelectedSource] = useState<ExternalKnowledgeSource | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [message, setMessage] = useState("正在并行检索 Wikipedia、Crossref、Europe PMC 与 arXiv…");
  const requestIdRef = useRef(0);

  async function runSearch(nextQuery: string) {
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
      if (!response.ok) throw new Error(payload.error ?? "联网检索失败");
      if (requestId !== requestIdRef.current) return;
      setResult(payload);
      setStatus("ready");
      setMessage(payload.sources.length ? `找到 ${payload.sources.length} 个去重结果` : "没有找到匹配资料，可以尝试更换关键词。");
    } catch (error) {
      if (requestId !== requestIdRef.current) return;
      setStatus("error");
      setMessage(error instanceof Error ? error.message : "联网检索失败");
    }
  }

  useEffect(() => {
    const requestId = ++requestIdRef.current;
    let active = true;
    void fetch("/api/discovery/search", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ query: target.query, limitPerProvider: 5, crawlTop: 2 }),
    }).then(async (response) => ({ response, payload: await response.json() as SourceDiscoveryResult & { error?: string } }))
      .then(({ response, payload }) => {
        if (!active || requestId !== requestIdRef.current) return;
        if (!response.ok) throw new Error(payload.error ?? "联网检索失败");
        setResult(payload);
        setStatus("ready");
        setMessage(payload.sources.length ? `找到 ${payload.sources.length} 个去重结果` : "没有找到匹配资料，可以尝试更换关键词。");
      })
      .catch((error: unknown) => {
        if (!active || requestId !== requestIdRef.current) return;
        setStatus("error");
        setMessage(error instanceof Error ? error.message : "联网检索失败");
      });
    return () => { active = false; requestIdRef.current += 1; };
  }, [target.id, target.query]);

  return (
    <aside aria-label="联网搜索侧边栏" className="knowledge-search-drawer">
      <header className="search-drawer-header">
        <div>
          <small>WEB DISCOVERY</small>
          <b>联网搜索知识点</b>
        </div>
        <button aria-label="关闭联网搜索" onClick={onClose} type="button">×</button>
      </header>

      <form className="knowledge-search-form" onSubmit={(event) => { event.preventDefault(); void runSearch(query); }}>
        <input aria-label="搜索知识点" onChange={(event) => setQuery(event.currentTarget.value)} value={query} />
        <button disabled={status === "loading"} type="submit">搜索</button>
      </form>

      <div className={`search-context is-${target.coverageState}`}>
        <i />
        <span><b>{target.coverageState === "covered" ? "本笔记已覆盖" : target.coverageState === "uncovered" ? "本笔记未覆盖" : "外部证据节点"}</b><small>{target.context}</small></span>
      </div>

      {selectedSource ? (
        <article className="search-reader">
          <button className="search-back" onClick={() => setSelectedSource(null)} type="button">← 返回搜索结果</button>
          <small>{PROVIDER_LABELS[selectedSource.provider]} · {sourceHostname(selectedSource)}</small>
          <h2>{selectedSource.title}</h2>
          <div className="reader-metadata">
            <span>可信度 {Math.round(selectedSource.trustScore * 100)}%</span>
            {selectedSource.publishedYear ? <span>{selectedSource.publishedYear}</span> : null}
            {typeof selectedSource.citedByCount === "number" ? <span>引用 {selectedSource.citedByCount}</span> : null}
          </div>
          {selectedSource.authors.length ? <p className="reader-authors">{selectedSource.authors.join(" · ")}</p> : null}
          <p className="reader-content">{selectedSource.abstract || readableFetchedContent(selectedSource) || selectedSource.trustSignals.join("。")}</p>
          {selectedSource.abstract && readableFetchedContent(selectedSource) ? (
            <details className="reader-extract"><summary>查看抓取到的网页正文摘录</summary><p>{readableFetchedContent(selectedSource)}</p></details>
          ) : null}
          <div className="reader-signals">{selectedSource.trustSignals.map((signal) => <span key={signal}>{signal}</span>)}</div>
          <a href={selectedSource.canonicalUrl} rel="noreferrer" target="_blank">在原网页中打开 ↗</a>
        </article>
      ) : (
        <div className="search-results-view">
          <div className="search-summary" aria-live="polite">
            <span className={status}>{status === "loading" ? "◌" : status === "error" ? "!" : "✓"}</span>
            <p><b>{message}</b><small>{result ? `${result.rawCount} 条原始记录 · 合并 ${result.duplicateCount} 条重复来源` : "检索仅用于发现资料，不会自动标记为已掌握。"}</small></p>
          </div>
          {result?.providers.length ? (
            <div className="search-providers">
              {result.providers.map((provider) => <span className={provider.ok ? "is-ok" : "is-error"} key={provider.provider}>{PROVIDER_LABELS[provider.provider]} {provider.count}</span>)}
            </div>
          ) : null}
          <div className="search-results">
            {result?.sources.map((source, index) => (
              <button key={source.id} onClick={() => setSelectedSource(source)} type="button">
                <small>{index + 1} · {sourceHostname(source)} · {PROVIDER_LABELS[source.provider]}</small>
                <strong>{source.title}</strong>
                <p>{source.abstract || source.fetchedContent || source.trustSignals.join(" · ")}</p>
                <footer><span>可信度 {Math.round(source.trustScore * 100)}%</span><span>阅读网页 →</span></footer>
              </button>
            ))}
          </div>
        </div>
      )}
    </aside>
  );
}

function DetailPanel({
  node,
  seedNote,
  seedConcepts,
  onClose,
  onKeepOpen,
  onRecenter,
  mapId,
  onMapUpdated,
  onSearch,
}: {
  node: NetworkNode | null;
  seedNote: SourceNote;
  seedConcepts: AnalyzedKnowledgeNode[];
  onClose: () => void;
  onKeepOpen: () => void;
  onRecenter: (noteId: string) => void;
  mapId?: string;
  onMapUpdated: (map: DiscoveryMap) => void;
  onSearch: (target: SearchTarget) => void;
}) {
  const [lesson, setLesson] = useState<TutorLesson | null>(null);
  const [actionStatus, setActionStatus] = useState("");
  const [correctionOpen, setCorrectionOpen] = useState(false);
  const [correctionAction, setCorrectionAction] = useState<"rename" | "merge" | "reject">("rename");
  const [correctionValue, setCorrectionValue] = useState("");
  const note = node?.note ?? (node ? null : seedNote);
  const concept = node?.concept;
  const title = note?.title ?? node?.label ?? seedNote.title;
  const eyebrow = note
    ? `${sourceKind(note).label} · 完整笔记`
    : node?.eyebrow ?? "中心笔记";
  const body = note?.content ?? node?.summary ?? seedNote.content;
  const relatedConcepts = note
    ? seedConcepts.filter((item) =>
        item.evidence.some((evidence) => evidence.noteId === note.id),
      )
    : concept
      ? [concept]
      : seedConcepts;

  const loadLesson = async () => {
    if (!mapId || !concept) return;
    setActionStatus("正在生成微课程…");
    const response = await fetch("/api/lessons", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ mapId, conceptId: concept.id }),
    });
    const payload = await response.json() as { lesson?: TutorLesson; error?: string };
    if (!response.ok || !payload.lesson) { setActionStatus(payload.error ?? "微课程生成失败"); return; }
    setLesson(payload.lesson);
    setActionStatus("");
  };
  const recordEvidence = async (
    evidenceType: "saved" | "quiz" | "explanation" | "project",
    score: number,
    evidenceNote: string,
  ) => {
    if (!mapId || !concept) return;
    setActionStatus("正在保存证据并重算地图…");
    const response = await fetch("/api/mastery", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ mapId, conceptId: concept.id, evidenceType, score, note: evidenceNote }),
    });
    const payload = await response.json() as { map?: DiscoveryMap; error?: string };
    if (!response.ok || !payload.map) { setActionStatus(payload.error ?? "证据保存失败"); return; }
    onMapUpdated(payload.map);
    setActionStatus("证据已保存，地图已自动重算");
  };
  const submitCorrection = async () => {
    if (!mapId || !concept) return;
    setActionStatus("正在进入人工纠错队列…");
    const response = await fetch("/api/corrections", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        mapId,
        conceptId: concept.id,
        action: correctionAction,
        proposedValue: correctionAction === "reject" ? undefined : correctionValue,
        reason: "由知识网络详情页提交",
      }),
    });
    const payload = await response.json() as { correction?: { id: string }; error?: string };
    setActionStatus(response.ok ? `已进入纠错队列：${payload.correction?.id}` : payload.error ?? "提交失败");
  };

  return (
    <div className="detail-backdrop">
      <div
        aria-modal="true"
        className={`detail-panel type-${node?.type ?? "note"}`}
        onPointerEnter={onKeepOpen}
        onPointerLeave={onClose}
        role="dialog"
        tabIndex={-1}
      >
        <header>
          <div><i /><span>{eyebrow}</span></div>
          <button aria-label="关闭详情" onClick={onClose} type="button">×</button>
        </header>
        <div className="detail-grid">
          <aside>
            <span>DETAIL VIEW</span>
            <h1>{title}</h1>
            <p>{note?.source ?? node?.domain ?? concept?.categoryPath.join(" / ")}</p>
            {concept ? (
              <dl>
                <div><dt>覆盖</dt><dd>{Math.round(concept.score * 100)}%</dd></div>
                <div><dt>状态</dt><dd>{concept.status}</dd></div>
                <div><dt>证据</dt><dd>{concept.evidence.length}</dd></div>
                <div><dt>掌握</dt><dd>{concept.mastery?.level ?? "unknown"}</dd></div>
                <div><dt>需复验</dt><dd>{concept.mastery?.needsReverification ? "是" : "否"}</dd></div>
              </dl>
            ) : null}
            <div className="detail-tags">
              {relatedConcepts.slice(0, 7).map((item) => (
                <span key={item.id}>{item.label}</span>
              ))}
            </div>
            <button
              className="web-search-action"
              onClick={() => onSearch({
                id: node?.id ?? `seed:${seedNote.id}`,
                query: searchQueryForTitle(title),
                context: concept?.categoryPath.join(" / ") ?? note?.source ?? node?.domain ?? "中心笔记",
                coverageState: node?.coverageState ?? "covered",
              })}
              type="button"
            >
              <span>联网搜索这个知识点</span><i>↗</i>
            </button>
            {node?.url ? (
              <a href={node.url} rel="noreferrer" target="_blank">打开权威原文 ↗</a>
            ) : null}
            {node?.note ? (
              <button onClick={() => onRecenter(node.note!.id)} type="button">
                设为中心并重新生长
              </button>
            ) : null}
            {concept && mapId ? (
              <div className="learning-actions">
                <button onClick={() => void loadLesson()} type="button">生成缺口微课程</button>
                <button onClick={() => void recordEvidence("saved", 1, "已阅读并保存相关材料") } type="button">标记已看</button>
                <button onClick={() => void recordEvidence("explanation", 0.82, "已完成脱稿复述与反例说明") } type="button">提交复述证据</button>
                <button onClick={() => void recordEvidence("project", 0.84, "已在项目中完成最小实现并验证") } type="button">提交项目证据</button>
                <button className="quiet" onClick={() => setCorrectionOpen((value) => !value)} type="button">概念有误？提交纠错</button>
                {correctionOpen ? (
                  <div className="correction-form">
                    <select value={correctionAction} onChange={(event) => setCorrectionAction(event.target.value as typeof correctionAction)}>
                      <option value="rename">改名</option><option value="merge">合并</option><option value="reject">移除</option>
                    </select>
                    {correctionAction !== "reject" ? <input aria-label="纠正后的名称或目标 ID" onChange={(event) => setCorrectionValue(event.target.value)} placeholder="新名称 / 合并目标 ID" value={correctionValue} /> : null}
                    <button onClick={() => void submitCorrection()} type="button">进入审核队列</button>
                  </div>
                ) : null}
                {actionStatus ? <small className="action-status">{actionStatus}</small> : null}
              </div>
            ) : null}
          </aside>
          <section>
            <small>{note ? "笔记正文" : concept ? "知识详情" : "内容详情"}</small>
            {body.split(/\n{2,}|\n/).filter(Boolean).map((paragraph, index) => (
              <p key={`${paragraph.slice(0, 24)}-${index}`}>{paragraph}</p>
            ))}
            {concept?.whyItMatters ? (
              <blockquote><b>为什么重要</b>{concept.whyItMatters}</blockquote>
            ) : null}
            {concept?.evidence.length ? (
              <div className="detail-evidence">
                <b>仓库证据</b>
                {concept.evidence.slice(0, 4).map((evidence) => (
                  <article key={evidence.noteId}>
                    <strong>{evidence.noteTitle}</strong>
                    <p>{evidence.excerpt}</p>
                  </article>
                ))}
              </div>
            ) : null}
            {lesson ? (
              <article className="lesson-panel">
                <small>{lesson.duration} · {lesson.provider}</small>
                <h2>{lesson.title}</h2>
                <p>{lesson.hook}</p>
                <blockquote><b>核心解释</b>{lesson.explanation}</blockquote>
                <ol>{lesson.steps.map((step) => <li key={step.title}><b>{step.title} · {step.minutes} 分钟</b><span>{step.task}</span></li>)}</ol>
                <div className="lesson-check">
                  <b>{lesson.check.question}</b>
                  {lesson.check.options.map((option, index) => (
                    <button key={option} onClick={() => void recordEvidence("quiz", index === lesson.check.answerIndex ? 1 : 0.25, `微课程测验：${option}`)} type="button">{option}</button>
                  ))}
                </div>
              </article>
            ) : null}
          </section>
        </div>
      </div>
    </div>
  );
}

export function KnowledgeNetworkApp({ initialAnalysis }: { initialAnalysis: KnowledgeAnalysis }) {
  const [analysis, setAnalysis] = useState(initialAnalysis);
  const [counts, setCounts] = useState({ sample: initialAnalysis.notes.length, user: 0, total: initialAnalysis.notes.length });
  const [selectedNoteId, setSelectedNoteId] = useState(initialAnalysis.notes[0]?.id ?? "");
  const [expanded, setExpanded] = useState(false);
  const [burstVersion, setBurstVersion] = useState(0);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [searchTarget, setSearchTarget] = useState<SearchTarget | null>(null);
  const [dataStatus, setDataStatus] = useState<"loading" | "ready" | "error">("loading");
  const [filters, setFilters] = useState<Record<NodeType, boolean>>({ concept: true, note: true, web: true, gap: true });
  const [scale, setScale] = useState(0.94);
  const [pan, setPan] = useState({ x: 0, y: 6 });
  const [currentMap, setCurrentMap] = useState<DiscoveryMap | null>(null);
  const [mapHistory, setMapHistory] = useState<Array<{ id: string; version: number; status: string; goal: string }>>([]);
  const [builderOpen, setBuilderOpen] = useState(false);
  const [mapBusy, setMapBusy] = useState(false);
  const [mapNotice, setMapNotice] = useState("先描述目标，再由系统建议 MapSpec；所有参数仍可人工调整。");
  const [lastDiff, setLastDiff] = useState<MapVersionDiff | null>(null);
  const [mapSpec, setMapSpec] = useState<MapSpec>({
    goal: "系统理解 Transformer，并能够解释推理性能瓶颈",
    audience: "有深度学习基础的产品与工程学习者",
    granularity: 5,
    expansionRadius: 2,
    maxNodes: 34,
    confidenceThreshold: 0.58,
  });
  const hoverOpenRef = useRef<number | null>(null);
  const hoverCloseRef = useRef<number | null>(null);
  const detailCloseRef = useRef<number | null>(null);
  const dragRef = useRef<{ pointerId: number; startX: number; startY: number; originX: number; originY: number } | null>(null);

  useEffect(() => {
    let active = true;
    void fetch("/api/atlas/notes")
      .then(async (response) => {
        const payload = (await response.json()) as {
          analysis?: KnowledgeAnalysis;
          counts?: { sample: number; user: number; total: number };
          error?: string;
        };
        if (!response.ok || !payload.analysis || !payload.counts) {
          throw new Error(payload.error || "知识仓库读取失败");
        }
        if (!active) return;
        setAnalysis(payload.analysis);
        setCounts(payload.counts);
        setSelectedNoteId((current) =>
          payload.analysis!.notes.some((note) => note.id === current)
            ? current
            : payload.analysis!.notes[0]?.id ?? "",
        );
        setDataStatus("ready");
      })
      .catch(() => {
        if (active) setDataStatus("error");
      });
    return () => {
      active = false;
      [hoverOpenRef, hoverCloseRef, detailCloseRef].forEach((ref) => {
        if (ref.current) window.clearTimeout(ref.current);
      });
    };
  }, []);

  const refreshMapHistory = async () => {
    const response = await fetch("/api/maps");
    const payload = await response.json() as { maps?: typeof mapHistory };
    if (response.ok && payload.maps) setMapHistory(payload.maps);
  };

  useEffect(() => {
    let active = true;
    void fetch("/api/maps")
      .then(async (response) => (await response.json()) as { maps?: typeof mapHistory })
      .then((payload: { maps?: typeof mapHistory }) => {
        if (active && payload.maps) setMapHistory(payload.maps);
      });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setDetailId(null);
        setHoveredId(null);
        setSearchTarget(null);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  const selectedNote = analysis.notes.find((note) => note.id === selectedNoteId) ?? analysis.notes[0];
  const network = useMemo(
    () => (selectedNote
      ? buildNetwork(analysis, selectedNote, currentMap?.externalSources, {
          granularity: mapSpec.granularity,
          maxNodes: mapSpec.maxNodes,
          expansionRadius: mapSpec.expansionRadius,
        })
      : { nodes: [], edges: [], concepts: [] }),
    [analysis, selectedNote, currentMap?.externalSources, mapSpec.granularity, mapSpec.maxNodes, mapSpec.expansionRadius],
  );
  const visibleNodes = network.nodes.filter((node) => filters[node.type]);
  const visibleIds = new Set(visibleNodes.map((node) => node.id));
  const visibleEdges = network.edges.filter(
    (edge) => visibleIds.has(edge.targetId) && (edge.sourceId === "seed" || visibleIds.has(edge.sourceId)),
  );
  const granularityStats = {
    conceptCount: network.concepts.length,
    nodeCount: network.nodes.length,
    coveredCount: network.concepts.filter((concept) => concept.status === "covered" || concept.status === "mastered").length,
  };
  const granularityCoverage = granularityStats.conceptCount
    ? Math.round((granularityStats.coveredCount / granularityStats.conceptCount) * 100)
    : 0;
  const edgeRange = visibleEdges.length
    ? {
        min: Math.round(Math.min(...visibleEdges.map((edge) => edge.length))),
        max: Math.round(Math.max(...visibleEdges.map((edge) => edge.length))),
      }
    : { min: 0, max: 0 };
  const detailNode = detailId && detailId !== "seed" ? network.nodes.find((node) => node.id === detailId) ?? null : null;

  if (!selectedNote) return <main className="knowledge-network-app">知识仓库中还没有笔记。</main>;

  const clearHoverTimers = () => {
    if (hoverOpenRef.current) window.clearTimeout(hoverOpenRef.current);
    if (hoverCloseRef.current) window.clearTimeout(hoverCloseRef.current);
  };
  const beginHover = (id: string) => {
    clearHoverTimers();
    hoverOpenRef.current = window.setTimeout(() => setHoveredId(id), HOVER_OPEN_MS);
  };
  const endHover = () => {
    if (hoverOpenRef.current) window.clearTimeout(hoverOpenRef.current);
    hoverCloseRef.current = window.setTimeout(() => setHoveredId(null), HOVER_CLOSE_MS);
  };
  const keepDetailOpen = () => {
    if (detailCloseRef.current) window.clearTimeout(detailCloseRef.current);
  };
  const closeDetailSoon = () => {
    keepDetailOpen();
    detailCloseRef.current = window.setTimeout(() => setDetailId(null), 260);
  };
  const openDetail = (id: string) => {
    keepDetailOpen();
    setSearchTarget(null);
    setDetailId(id);
    setHoveredId(null);
  };
  const openSearch = (target: SearchTarget) => {
    setDetailId(null);
    setHoveredId(null);
    setSearchTarget(target);
  };
  const applyMap = (map: DiscoveryMap) => {
    setCurrentMap(map);
    setAnalysis(map.analysis);
    setSelectedNoteId((current) => map.analysis.notes.some((note) => note.id === current) ? current : map.analysis.notes[0]?.id ?? "");
    setExpanded(false);
    setBurstVersion((version) => version + 1);
    window.setTimeout(() => setExpanded(true), 180);
  };
  const suggestSpec = async () => {
    setMapBusy(true);
    setMapNotice("正在从目标推断粒度与边界…");
    try {
      const response = await fetch("/api/maps/spec", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ goal: mapSpec.goal, audience: mapSpec.audience }) });
      const payload = await response.json() as { spec?: MapSpec; rationale?: string[]; error?: string };
      if (!response.ok || !payload.spec) throw new Error(payload.error ?? "MapSpec 生成失败");
      setMapSpec(payload.spec);
      setMapNotice(payload.rationale?.join(" ") ?? "MapSpec 已生成，可继续人工调整。");
    } catch (error) { setMapNotice(error instanceof Error ? error.message : "MapSpec 生成失败"); }
    finally { setMapBusy(false); }
  };
  const generateMap = async () => {
    setMapBusy(true);
    setMapNotice("正在增量分析仓库，并行检索多来源证据…");
    try {
      const response = await fetch("/api/maps", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ goal: mapSpec.goal, audience: mapSpec.audience, spec: mapSpec, seedNoteId: selectedNote.id, discover: true }),
      });
      const payload = await response.json() as { map?: DiscoveryMap; error?: string };
      if (!response.ok || !payload.map) throw new Error(payload.error ?? "地图生成失败");
      applyMap(payload.map);
      setMapNotice(`v${payload.map.version} 已生成：${payload.map.analysis.nodes.length} 个概念节点，${payload.map.externalSources?.length ?? 0} 个外部来源。`);
      await refreshMapHistory();
    } catch (error) { setMapNotice(error instanceof Error ? error.message : "地图生成失败"); }
    finally { setMapBusy(false); }
  };
  const freezeMap = async () => {
    if (!currentMap) return;
    setMapBusy(true);
    const response = await fetch("/api/maps/version", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "freeze", mapId: currentMap.id }) });
    const payload = await response.json() as { map?: DiscoveryMap; error?: string };
    if (payload.map) { applyMap(payload.map); setMapNotice(`v${payload.map.version} 已冻结，后续变更将创建新版本。`); await refreshMapHistory(); }
    else setMapNotice(payload.error ?? "冻结失败");
    setMapBusy(false);
  };
  const migrateMap = async () => {
    if (!currentMap) return;
    setMapBusy(true);
    const response = await fetch("/api/maps/version", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "migrate", mapId: currentMap.id, spec: mapSpec, reason: "用户调整 MapSpec" }) });
    const payload = await response.json() as { map?: DiscoveryMap; diff?: MapVersionDiff; error?: string };
    if (payload.map) { applyMap(payload.map); setLastDiff(payload.diff ?? null); setMapNotice(`已迁移到 v${payload.map.version}，保留旧快照。`); await refreshMapHistory(); }
    else setMapNotice(payload.error ?? "迁移失败");
    setMapBusy(false);
  };
  const loadMap = async (id: string) => {
    if (!id) return;
    const response = await fetch(`/api/maps?id=${encodeURIComponent(id)}`);
    const payload = await response.json() as { map?: DiscoveryMap; error?: string };
    if (payload.map) { applyMap(payload.map); setMapSpec(payload.map.mapSpec); setMapNotice(`已载入 v${payload.map.version} ${payload.map.status === "frozen" ? "冻结快照" : "草稿"}。`); }
    else setMapNotice(payload.error ?? "地图读取失败");
  };
  const chooseCenterNote = (noteId: string, regrow = false) => {
    setSelectedNoteId(noteId);
    setExpanded(false);
    setHoveredId(null);
    setDetailId(null);
    setSearchTarget(null);
    setBurstVersion((current) => current + 1);
    if (regrow) window.setTimeout(() => setExpanded(true), 180);
  };
  const openSeed = () => {
    if (!expanded) {
      setExpanded(true);
      setBurstVersion((current) => current + 1);
    }
    openDetail("seed");
  };

  const handlePointerDown = (event: ReactPointerEvent<HTMLElement>) => {
    if ((event.target as HTMLElement).closest("button, a, article, aside")) return;
    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      originX: pan.x,
      originY: pan.y,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const handlePointerMove = (event: ReactPointerEvent<HTMLElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    setPan({ x: drag.originX + event.clientX - drag.startX, y: drag.originY + event.clientY - drag.startY });
  };
  const handlePointerUp = (event: ReactPointerEvent<HTMLElement>) => {
    if (dragRef.current?.pointerId !== event.pointerId) return;
    dragRef.current = null;
    event.currentTarget.releasePointerCapture(event.pointerId);
  };
  const handleWheel = (event: ReactWheelEvent<HTMLElement>) => {
    event.preventDefault();
    setScale((current) => clamp(current + (event.deltaY > 0 ? -0.07 : 0.07), 0.52, 1.42));
  };

  return (
    <main className="knowledge-network-app">
      <header className="network-topbar">
        <Link className="network-brand" href="/"><span><i /><i /><i /><i /></span><div><b>知识网络</b><small>KNOWLEDGE NETWORK</small></div></Link>
        <div className="network-status">
          <i className={dataStatus} />
          <b>{dataStatus === "ready" ? "D1 知识仓库已连接" : dataStatus === "error" ? "当前显示演示样本" : "正在读取知识仓库"}</b>
          <small>{currentMap ? `Map v${currentMap.version} · ${currentMap.status} · ${currentMap.incremental?.cacheHits ?? 0} 缓存命中` : "2D 力导向 · 边长 0.8–1.3× · 逐跳扩散"}</small>
        </div>
        <nav><Link className="is-active" href="/">知识网络</Link><a href="/report.html" target="_blank">落地报告</a><a href="/api/health" target="_blank">API 状态</a><a href="/api/atlas/notes" target="_blank">数据接口</a></nav>
      </header>

      <section className="network-stage" onPointerDown={handlePointerDown} onPointerMove={handlePointerMove} onPointerUp={handlePointerUp} onWheel={handleWheel}>
        <div className="network-ambient" aria-hidden="true"><i /><i /><i /><i /><i /></div>

        <aside className="note-switcher">
          <header><span>中心笔记</span><small>{counts.total} 张</small></header>
          <div>
            {analysis.notes.map((note) => {
              const kind = sourceKind(note);
              return (
                <button className={note.id === selectedNote.id ? "is-active" : ""} key={note.id} onClick={() => chooseCenterNote(note.id)} type="button">
                  <i className={kind.className} /><span><b>{note.title}</b><small>{kind.label}</small></span>
                </button>
              );
            })}
          </div>
          <footer><span>演示 {counts.sample}</span><span>D1 {counts.user}</span></footer>
        </aside>

        <div className="network-toolbar">
          {([ ["concept", "概念"], ["note", "笔记"], ["web", "网页"], ["gap", "缺口"] ] as const).map(([key, label]) => (
            <button aria-pressed={filters[key]} className={`type-${key}`} key={key} onClick={() => setFilters((current) => ({ ...current, [key]: !current[key] }))} type="button"><i />{label}</button>
          ))}
          <span />
          <button onClick={() => setScale((current) => clamp(current - 0.1, 0.52, 1.42))} type="button">−</button>
          <b>{Math.round(scale * 100)}%</b>
          <button onClick={() => setScale((current) => clamp(current + 0.1, 0.52, 1.42))} type="button">＋</button>
          <button onClick={() => { setScale(0.94); setPan({ x: 0, y: 6 }); }} type="button">复位</button>
          <span />
          <button className="map-toggle" onClick={() => setBuilderOpen((value) => !value)} type="button">MapSpec</button>
        </div>

        {builderOpen ? (
          <aside className="map-builder" onPointerDown={(event) => event.stopPropagation()}>
            <header><div><small>DYNAMIC MAP</small><b>从目标生成地图</b></div><button aria-label="收起 MapSpec" onClick={() => setBuilderOpen(false)} type="button">×</button></header>
            <label>学习目标<textarea onChange={(event) => { const goal = event.currentTarget.value; setMapSpec((current) => ({ ...current, goal })); }} value={mapSpec.goal} /></label>
            <label>面向谁<input onChange={(event) => { const audience = event.currentTarget.value; setMapSpec((current) => ({ ...current, audience })); }} value={mapSpec.audience} /></label>
            <div className="spec-control"><span>概念粒度</span><b>{mapSpec.granularity}/5</b><input aria-label="概念粒度" max="5" min="1" onChange={(event) => { const granularity = Number(event.currentTarget.value) as MapSpec["granularity"]; setMapSpec((current) => ({ ...current, granularity })); }} type="range" value={mapSpec.granularity} /></div>
            <div className="spec-control"><span>扩散跳数</span><b>{mapSpec.expansionRadius} 跳</b><input max="3" min="1" onChange={(event) => { const expansionRadius = Number(event.currentTarget.value) as MapSpec["expansionRadius"]; setMapSpec((current) => ({ ...current, expansionRadius })); }} type="range" value={mapSpec.expansionRadius} /></div>
            <div className="spec-control"><span>最大节点</span><b>{mapSpec.maxNodes}</b><input max="60" min="8" onChange={(event) => { const maxNodes = Number(event.currentTarget.value); setMapSpec((current) => ({ ...current, maxNodes })); }} step="2" type="range" value={mapSpec.maxNodes} /></div>
            <div className="spec-control"><span>可信阈值</span><b>{Math.round(mapSpec.confidenceThreshold * 100)}%</b><input max="0.95" min="0.3" onChange={(event) => { const confidenceThreshold = Number(event.currentTarget.value); setMapSpec((current) => ({ ...current, confidenceThreshold })); }} step="0.01" type="range" value={mapSpec.confidenceThreshold} /></div>
            <div className="granularity-status" aria-live="polite">
              <span>当前视图：{GRANULARITY_LABELS[mapSpec.granularity]}</span>
              <span>{granularityStats.conceptCount} 个概念 · {granularityStats.nodeCount} 个网络节点</span>
              <span>仓库证据覆盖 {granularityCoverage}%</span>
            </div>
            <div className="map-builder-actions">
              <button disabled={mapBusy} onClick={() => void suggestSpec()} type="button">AI 建议参数</button>
              <button className="primary" disabled={mapBusy} onClick={() => void generateMap()} type="button">生成动态地图</button>
              {currentMap ? <button disabled={mapBusy || currentMap.status === "frozen"} onClick={() => void freezeMap()} type="button">冻结 v{currentMap.version}</button> : null}
              {currentMap ? <button disabled={mapBusy} onClick={() => void migrateMap()} type="button">迁移为新版本</button> : null}
            </div>
            {mapHistory.length ? <label>版本历史<select onChange={(event) => void loadMap(event.target.value)} value={currentMap?.id ?? ""}><option value="">选择版本</option>{mapHistory.map((map) => <option key={map.id} value={map.id}>v{map.version} · {map.status} · {map.goal.slice(0, 22)}</option>)}</select></label> : null}
            <p className="map-notice">{mapBusy ? "◌ " : ""}{mapNotice}</p>
            {lastDiff ? <div className="map-diff"><b>版本差异</b><span>+{lastDiff.addedNodeIds.length} / −{lastDiff.removedNodeIds.length} 节点</span><span>覆盖变化 {lastDiff.coverageDelta >= 0 ? "+" : ""}{Math.round(lastDiff.coverageDelta * 100)}%</span></div> : null}
          </aside>
        ) : null}

        <div className={`network-world${expanded ? " is-expanded" : ""}`} key={`${selectedNote.id}:${burstVersion}`} style={{ transform: `translate(-50%, -50%) translate(${pan.x}px, ${pan.y}px) scale(${scale})` }}>
          <svg className="network-edges" viewBox={`0 0 ${WORLD.width} ${WORLD.height}`}>
            {expanded ? visibleEdges.map((edge, index) => (
              <path className={`depth-${edge.depth}`} d={edge.path} key={edge.id} pathLength="1" style={{ "--edge-delay": `${edge.depth === 1 ? 100 + index * 45 : 650 + index * 36}ms` } as CSSProperties} />
            )) : null}
          </svg>

          {expanded ? visibleNodes.map((node, index) => {
            const parent = node.parentId === "seed" ? { x: WORLD.centerX, y: WORLD.centerY } : network.nodes.find((item) => item.id === node.parentId) ?? { x: WORLD.centerX, y: WORLD.centerY };
            const delay = node.depth === 1 ? 180 + index * 52 : 720 + index * 42;
            const style = {
              left: `${node.x}px`,
              top: `${node.y}px`,
              "--from-x": `${parent.x - node.x}px`,
              "--from-y": `${parent.y - node.y}px`,
              "--node-delay": `${delay}ms`,
            } as CSSProperties;
            return (
              <div className={`network-entity type-${node.type} depth-${node.depth} is-${node.coverageState}`} key={node.id} onPointerEnter={() => beginHover(node.id)} onPointerLeave={endHover} style={style}>
                <span className="entity-label">{node.label}</span>
                <button aria-label={`查看 ${node.label}，${node.coverageState === "covered" ? "本笔记已覆盖" : node.coverageState === "uncovered" ? "本笔记未覆盖" : "外部证据"}`} className="entity-dot" onClick={() => openDetail(node.id)} type="button"><i /></button>
                {hoveredId === node.id ? <MiniCard eyebrow={node.eyebrow} title={node.label} summary={node.summary} /> : null}
              </div>
            );
          }) : null}

          <div className="seed-entity" onPointerEnter={() => beginHover("seed")} onPointerLeave={endHover} style={{ left: WORLD.centerX, top: WORLD.centerY }}>
            <span className="entity-label">{selectedNote.title}</span>
            <button aria-label="展开知识网络并查看中心笔记" className="seed-dot" onClick={openSeed} type="button"><i /><i /></button>
            {hoveredId === "seed" ? <MiniCard eyebrow={`${sourceKind(selectedNote).label} · 中心笔记`} title={selectedNote.title} summary={selectedNote.content} /> : null}
          </div>
        </div>

        <div className="network-hint">
          <span>{expanded ? "亮点=本笔记已覆盖 · 灰点=地图存在但本笔记未覆盖 · 点击查看与联网搜索" : "将鼠标停在中心点约 0.2 秒，点击后逐跳扩散"}</span>
          <b>{expanded ? `${visibleNodes.length} 个点 · 边长 ${edgeRange.min}–${edgeRange.max}` : "等待扩散"}</b>
          {expanded ? <button onClick={() => { setExpanded(false); setHoveredId(null); setDetailId(null); }} type="button">收拢网络</button> : null}
        </div>
      </section>

      {detailId ? (
        <DetailPanel mapId={currentMap?.id} node={detailNode} onClose={closeDetailSoon} onKeepOpen={keepDetailOpen} onMapUpdated={(map) => { applyMap(map); setMapNotice("学习行动完成，掌握状态与地图已自动重算。"); }} onRecenter={(noteId) => chooseCenterNote(noteId, true)} onSearch={openSearch} seedConcepts={network.concepts} seedNote={selectedNote} />
      ) : null}
      {searchTarget ? <KnowledgeSearchDrawer key={searchTarget.id} onClose={() => setSearchTarget(null)} target={searchTarget} /> : null}
    </main>
  );
}
