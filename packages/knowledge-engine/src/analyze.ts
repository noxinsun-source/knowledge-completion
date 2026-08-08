import {
  ATLAS_SCOPE,
  ATLAS_SCOPE_VERSION,
  KNOWLEDGE_EDGES,
  KNOWLEDGE_NODES,
} from "./catalog.ts";
import type {
  AnalyzedKnowledgeNode,
  CoverageStatus,
  KnowledgeAnalysis,
  NodeEvidence,
  SourceNote,
} from "../../contracts/src/index.ts";

function normalize(value: string) {
  return value.normalize("NFKC").toLocaleLowerCase("zh-CN");
}

function excerptAround(content: string, keyword: string) {
  const normalized = normalize(content);
  const index = normalized.indexOf(normalize(keyword));
  if (index < 0) return content.slice(0, 128);
  const start = Math.max(0, index - 42);
  const end = Math.min(content.length, index + keyword.length + 78);
  return `${start > 0 ? "…" : ""}${content.slice(start, end)}${
    end < content.length ? "…" : ""
  }`;
}

export function evidenceForNode(
  note: SourceNote,
  keywords: string[],
): NodeEvidence | null {
  const title = normalize(note.title);
  const content = normalize(note.content);
  const matchedKeywords = keywords.filter((keyword) => {
    const normalizedKeyword = normalize(keyword);
    return title.includes(normalizedKeyword) || content.includes(normalizedKeyword);
  });
  if (!matchedKeywords.length) return null;

  const titleBoost = matchedKeywords.some((keyword) =>
    title.includes(normalize(keyword)),
  )
    ? 0.16
    : 0;
  const depthSignals = /推导|公式|例子|实践|对比|实验|复盘|why|how/i.test(
    note.content,
  )
    ? 0.13
    : 0;
  const score = Math.min(
    1,
    0.3 + matchedKeywords.length * 0.17 + titleBoost + depthSignals,
  );

  return {
    noteId: note.id,
    noteTitle: note.title,
    source: note.source,
    excerpt: excerptAround(note.content, matchedKeywords[0]),
    matchedKeywords,
    score,
  };
}

function coverageStatus(score: number, evidenceCount: number): CoverageStatus {
  if (score >= 0.86 && evidenceCount >= 2) return "mastered";
  if (score >= 0.62) return "covered";
  if (evidenceCount > 0) return "partial";
  return "missing";
}

function stableAnalysisId(notes: SourceNote[]) {
  let hash = 2166136261;
  for (const character of notes.map((note) => note.id).sort().join("|")) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return `network-${(hash >>> 0).toString(16)}`;
}

export type NoteEvidenceContribution = {
  noteId: string;
  evidenceByNodeId: Record<string, NodeEvidence>;
};

export function analyzeNoteEvidence(note: SourceNote): NoteEvidenceContribution {
  const evidenceByNodeId: Record<string, NodeEvidence> = {};
  for (const definition of KNOWLEDGE_NODES) {
    if (definition.kind === "domain") continue;
    const keywords = [
      definition.label,
      definition.labelEn,
      ...definition.keywords,
      ...(definition.aliases ?? []),
    ].filter(Boolean);
    const evidence = evidenceForNode(note, keywords);
    if (evidence) evidenceByNodeId[definition.id] = evidence;
  }
  return { noteId: note.id, evidenceByNodeId };
}

export function composeKnowledgeAnalysis(
  notes: SourceNote[],
  contributions: NoteEvidenceContribution[],
): KnowledgeAnalysis {
  const contributionByNote = new Map(
    contributions.map((contribution) => [contribution.noteId, contribution]),
  );
  return buildAnalysis(notes, contributionByNote);
}

/**
 * Deterministic evidence analysis used by both the product route and the
 * standalone demo server. Every illuminated node must point back to a note.
 */
export function analyzeKnowledgeNetwork(
  notes: SourceNote[],
): KnowledgeAnalysis {
  return composeKnowledgeAnalysis(notes, notes.map(analyzeNoteEvidence));
}

/** Compose a complete repository analysis from independently cacheable notes. */
function buildAnalysis(
  notes: SourceNote[],
  contributionByNote: Map<string, NoteEvidenceContribution>,
): KnowledgeAnalysis {
  const nodes: AnalyzedKnowledgeNode[] = KNOWLEDGE_NODES.map((definition) => {
    if (definition.kind === "domain") {
      return {
        ...definition,
        score: 1,
        status: "covered",
        evidence: [],
        priority: 0,
      };
    }

    const evidence = notes
      .map((note) => contributionByNote.get(note.id)?.evidenceByNodeId[definition.id])
      .filter((item): item is NodeEvidence => Boolean(item))
      .sort((left, right) => right.score - left.score);
    const bestScore = evidence[0]?.score ?? 0;
    const breadthBonus = Math.min(0.18, Math.max(0, evidence.length - 1) * 0.06);
    const score = Math.min(1, bestScore + breadthBonus);
    const status = coverageStatus(score, evidence.length);
    const priority = Number(
      ((1 - score) * Math.max(0.5, definition.weight)).toFixed(3),
    );

    return {
      ...definition,
      score,
      status,
      evidence,
      priority,
      gapReason:
        status === "missing"
          ? `仓库中还没有能解释“${definition.label}”的直接证据。`
          : status === "partial"
            ? `已出现“${definition.label}”，但缺少推导、例子或交叉验证。`
            : undefined,
    };
  });

  const concepts = nodes.filter((node) => node.kind !== "domain");
  const covered = concepts.filter(
    (node) => node.status === "covered" || node.status === "mastered",
  );
  const missing = concepts.filter((node) => node.status === "missing");
  const totalWeight = concepts.reduce((sum, node) => sum + node.weight, 0);
  const weightedScore = concepts.reduce(
    (sum, node) => sum + node.score * node.weight,
    0,
  );
  const evidenceCount = concepts.reduce(
    (sum, node) => sum + node.evidence.length,
    0,
  );
  const recommendedNext = concepts
    .filter((node) => node.status === "missing" || node.status === "partial")
    .sort((left, right) => right.priority - left.priority)
    .slice(0, 5)
    .map((node) => node.id);

  return {
    id: stableAnalysisId(notes),
    scope: ATLAS_SCOPE,
    scopeVersion: ATLAS_SCOPE_VERSION,
    mode: "repository",
    focusNodeIds: nodes
      .filter((node) => node.evidence.length > 0)
      .map((node) => node.id),
    generatedAt: new Date().toISOString(),
    nodes,
    edges: KNOWLEDGE_EDGES,
    notes,
    summary: {
      noteCount: notes.length,
      conceptCount: concepts.length,
      coveredCount: covered.length,
      missingCount: missing.length,
      topicCoverage: concepts.length ? covered.length / concepts.length : 0,
      weightedCoverage: totalWeight ? weightedScore / totalWeight : 0,
      depthCoverage: concepts.length
        ? concepts.reduce((sum, node) => sum + node.score, 0) / concepts.length
        : 0,
      structuralCompleteness: concepts.length
        ? concepts.filter((node) => node.evidence.length > 0).length /
          concepts.length
        : 0,
    },
    recommendedNext,
    pipeline: [
      { name: "仓库读取", detail: "真实笔记进入统一结构", count: notes.length },
      { name: "概念对齐", detail: "关键词、别名与证据片段对齐", count: evidenceCount },
      { name: "缺口计算", detail: "按前置关系和证据深度排序", count: recommendedNext.length },
    ],
  };
}
