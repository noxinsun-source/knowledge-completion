import type {
  AnalyzedKnowledgeNode,
  ConceptMastery,
  DiscoveryMap,
  DiscoveryRound,
  KnowledgeAnalysis,
  KnowledgeNodeDefinition,
  MapSpec,
  MapVersionDiff,
} from "../../contracts/src/index.ts";
import { KNOWLEDGE_EDGES } from "./catalog.ts";
import { validateMapSpec } from "./map-spec.ts";

function normalize(value: string) {
  return value.normalize("NFKC").toLocaleLowerCase("zh-CN");
}

export function nodeGranularity(node: KnowledgeNodeDefinition): 1 | 2 | 3 | 4 | 5 {
  if (node.granularity) return node.granularity;
  if (node.kind === "domain") return 1;
  const byGroup: Record<string, 1 | 2 | 3 | 4 | 5> = {
    基础: 1,
    表示: 2,
    核心机制: 3,
    架构: 4,
    训练与推理: 5,
    应用: 5,
  };
  return byGroup[node.group] ?? 3;
}

function goalScore(node: AnalyzedKnowledgeNode, goal: string) {
  const haystack = normalize([
    node.label,
    node.labelEn,
    node.group,
    node.description,
    node.categoryPath.join(" "),
    ...node.keywords,
    ...(node.aliases ?? []),
  ].join(" "));
  const tokens = normalize(goal).split(/[\s，。、“”：（）()\-_/]+/).filter((token) => token.length >= 2);
  return tokens.reduce((score, token) => score + (haystack.includes(token) ? 1 : 0), 0);
}

export function buildDynamicMap(options: {
  id?: string;
  version?: number;
  parentMapId?: string;
  revisionReason?: string;
  status?: "draft" | "frozen";
  frozenAt?: string;
  seedNoteId?: string;
  spec: MapSpec;
  repositoryAnalysis: KnowledgeAnalysis;
  mastery?: ConceptMastery[];
  createdAt?: string;
}): DiscoveryMap {
  const spec = validateMapSpec(options.spec);
  const analysis = options.repositoryAnalysis;
  const domain = analysis.nodes.find((node) => node.kind === "domain");
  const scored = analysis.nodes
    .filter((node) => node.kind !== "domain")
    .map((node) => ({ node, score: goalScore(node, spec.goal) }))
    .sort((a, b) => b.score - a.score || b.node.priority - a.node.priority);
  const goalConceptIds = scored.filter((item) => item.score > 0).slice(0, 5).map((item) => item.node.id);
  const seedConceptIds = analysis.nodes
    .filter((node) => node.evidence.some((evidence) => !options.seedNoteId || evidence.noteId === options.seedNoteId))
    .sort((a, b) => b.score - a.score)
    .slice(0, 6)
    .map((node) => node.id);
  const fallback = scored.slice(0, 3).map((item) => item.node.id);
  const frontier = [...new Set([...goalConceptIds, ...seedConceptIds, ...fallback])];
  const adjacency = new Map<string, Set<string>>();
  for (const edge of KNOWLEDGE_EDGES) {
    const source = adjacency.get(edge.source) ?? new Set<string>();
    const target = adjacency.get(edge.target) ?? new Set<string>();
    source.add(edge.target);
    target.add(edge.source);
    adjacency.set(edge.source, source);
    adjacency.set(edge.target, target);
  }

  const selected = new Set<string>(domain ? [domain.id] : []);
  let current = frontier;
  const rounds: DiscoveryRound[] = [];
  for (let round = 0; round <= spec.expansionRadius; round += 1) {
    const next = new Set<string>();
    const added: string[] = [];
    let rejectedByBoundary = 0;
    for (const id of current) {
      const node = analysis.nodes.find((candidate) => candidate.id === id);
      if (!node) continue;
      const isAnchor = frontier.includes(id);
      if (isAnchor || nodeGranularity(node) <= spec.granularity) {
        if (!selected.has(id) && selected.size < spec.maxNodes) added.push(id);
        if (selected.size < spec.maxNodes) selected.add(id);
      } else {
        rejectedByBoundary += 1;
      }
      for (const neighbor of adjacency.get(id) ?? []) {
        if (!selected.has(neighbor)) next.add(neighbor);
      }
    }
    rounds.push({ round, frontierIds: current, newNodeIds: added, rejectedByBoundary });
    current = [...next];
  }

  for (const item of scored) {
    if (selected.size >= spec.maxNodes) break;
    if (item.score > 0 && nodeGranularity(item.node) <= spec.granularity) selected.add(item.node.id);
  }

  const masteryByConcept = new Map((options.mastery ?? []).map((state) => [state.conceptId, state]));
  const nodes = analysis.nodes
    .filter((node) => selected.has(node.id))
    .map((node) => ({ ...node, granularity: nodeGranularity(node), mastery: masteryByConcept.get(node.id) }));
  const nodeIds = new Set(nodes.map((node) => node.id));
  const edges = analysis.edges.filter((edge) => nodeIds.has(edge.source) && nodeIds.has(edge.target));
  const concepts = nodes.filter((node) => node.kind !== "domain");
  const covered = concepts.filter((node) => node.status === "covered" || node.status === "mastered");
  const totalWeight = concepts.reduce((sum, node) => sum + node.weight, 0);
  const weighted = concepts.reduce((sum, node) => sum + node.weight * node.score, 0);
  const filteredAnalysis: KnowledgeAnalysis = {
    ...analysis,
    id: `${analysis.id}-g${spec.granularity}-r${spec.expansionRadius}-n${nodes.length}`,
    scope: spec.goal,
    mode: "discovery",
    nodes,
    edges,
    focusNoteId: options.seedNoteId,
    focusNodeIds: [...new Set([...goalConceptIds, ...seedConceptIds])].filter((id) => nodeIds.has(id)),
    recommendedNext: analysis.recommendedNext.filter((id) => nodeIds.has(id)),
    summary: {
      ...analysis.summary,
      conceptCount: concepts.length,
      coveredCount: covered.length,
      missingCount: concepts.filter((node) => node.status === "missing").length,
      topicCoverage: concepts.length ? covered.length / concepts.length : 0,
      weightedCoverage: totalWeight ? weighted / totalWeight : 0,
      depthCoverage: concepts.length ? concepts.reduce((sum, node) => sum + node.score, 0) / concepts.length : 0,
      structuralCompleteness: concepts.length ? concepts.filter((node) => node.evidence.length).length / concepts.length : 0,
    },
  };
  const now = options.createdAt ?? new Date().toISOString();
  return {
    id: options.id ?? `map_${crypto.randomUUID().replaceAll("-", "")}`,
    status: options.status ?? "draft",
    version: options.version ?? 1,
    mapSpec: spec,
    seedNoteId: options.seedNoteId ?? analysis.notes[0]?.id ?? "repository",
    seedConceptIds: seedConceptIds.filter((id) => nodeIds.has(id)),
    goalConceptIds: goalConceptIds.filter((id) => nodeIds.has(id)),
    goalAlignment: goalConceptIds.length ? goalConceptIds.filter((id) => nodeIds.has(id)).length / goalConceptIds.length : null,
    analysis: filteredAnalysis,
    sources: [],
    rounds,
    convergence: Number((1 - current.length / Math.max(1, analysis.nodes.length)).toFixed(3)),
    canonicalMerges: analysis.nodes.filter((node) => node.aliases?.length).map((node) => ({
      canonicalId: node.id,
      canonicalName: node.label,
      aliases: node.aliases ?? [],
      confidence: node.confidence ?? 0.9,
    })),
    boundaryNodeIds: current.filter((id) => !nodeIds.has(id)),
    expandedNodeIds: nodes.filter((node) => node.kind !== "domain").map((node) => node.id),
    createdAt: now,
    frozenAt: options.frozenAt,
    parentMapId: options.parentMapId,
    revisionReason: options.revisionReason,
  };
}

export function compareMapVersions(from: DiscoveryMap, to: DiscoveryMap): MapVersionDiff {
  const fromNodes = new Map(from.analysis.nodes.map((node) => [node.id, node]));
  const toNodes = new Map(to.analysis.nodes.map((node) => [node.id, node]));
  const specChanges: MapVersionDiff["specChanges"] = {};
  for (const key of Object.keys(from.mapSpec) as Array<keyof MapSpec>) {
    if (from.mapSpec[key] !== to.mapSpec[key]) specChanges[key] = { from: from.mapSpec[key], to: to.mapSpec[key] };
  }
  return {
    fromMapId: from.id,
    toMapId: to.id,
    addedNodeIds: [...toNodes.keys()].filter((id) => !fromNodes.has(id)),
    removedNodeIds: [...fromNodes.keys()].filter((id) => !toNodes.has(id)),
    statusChanges: [...toNodes.entries()].flatMap(([id, node]) => {
      const previous = fromNodes.get(id);
      return previous && previous.status !== node.status ? [{ nodeId: id, from: previous.status, to: node.status }] : [];
    }),
    coverageDelta: Number((to.analysis.summary.weightedCoverage - from.analysis.summary.weightedCoverage).toFixed(4)),
    specChanges,
  };
}
