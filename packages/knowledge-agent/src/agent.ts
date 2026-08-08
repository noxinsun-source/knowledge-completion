import type { MapGranularity, MapSpec, SourceNote } from "../../contracts/src/index.ts";
import { validateMapSpec } from "../../knowledge-engine/src/map-spec.ts";
import { compileAgentGraph, mergeAgentDrafts, normalizeConceptName, projectAgentGraph } from "./graph.ts";
import type {
  AgentGraphDraft,
  AgentRoundTrace,
  CanonicalAgentGraph,
  KnowledgeAgentOptions,
  KnowledgeAgentRun,
} from "./types.ts";

function validateNotes(notes: SourceNote[]) {
  if (!Array.isArray(notes) || !notes.length) throw new TypeError("At least one note is required.");
  if (notes.length > 50) throw new RangeError("At most 50 notes are allowed in one synchronous run.");
  const normalized = notes.map((note, index) => {
    const title = note.title?.trim();
    const content = note.content?.trim();
    if (!title) throw new TypeError(`notes[${index}].title must be a non-empty string.`);
    if (!content) throw new TypeError(`notes[${index}].content must be a non-empty string.`);
    if (content.length > 120_000) throw new RangeError(`notes[${index}].content must be at most 120000 characters.`);
    const confidence = Number(note.confidence ?? 0.8);
    if (!Number.isFinite(confidence)) throw new TypeError(`notes[${index}].confidence must be a finite number.`);
    return {
      id: note.id?.trim() || `note_${crypto.randomUUID().replaceAll("-", "")}`,
      title: title.slice(0, 240),
      content,
      source: note.source?.trim().slice(0, 240) || "本地输入",
      capturedAt: /^\d{4}-\d{2}-\d{2}$/.test(note.capturedAt) ? note.capturedAt : new Date().toISOString().slice(0, 10),
      confidence: Math.min(1, Math.max(0, confidence)),
    } satisfies SourceNote;
  });
  const totalCharacters = normalized.reduce((sum, note) => sum + note.content.length, 0);
  if (totalCharacters > 500_000) {
    throw new RangeError("The combined note content must be at most 500000 characters per synchronous run.");
  }
  return normalized;
}

function validateDraft(draft: AgentGraphDraft, label: string) {
  if (!draft || typeof draft !== "object" || !Array.isArray(draft.concepts) || !Array.isArray(draft.relations)) {
    throw new TypeError(`${label} must contain concepts and relations arrays.`);
  }
  if (draft.concepts.length > 500) throw new RangeError(`${label} must contain at most 500 concept candidates.`);
  if (draft.relations.length > 2_000) throw new RangeError(`${label} must contain at most 2000 relation candidates.`);
  return draft;
}

function emptyDraft(scope: string): AgentGraphDraft {
  return { scope, scopeDescription: "", concepts: [], relations: [] };
}

function frontierForRound(graph: CanonicalAgentGraph, previousNewIds: string[], round: number) {
  const previous = new Set(previousNewIds);
  return graph.concepts
    .filter((concept) =>
      concept.expandable &&
      concept.id !== graph.rootNodeId &&
      (previous.size ? previous.has(concept.id) : concept.discoveryState === "seed") &&
      concept.depth <= round + 1,
    )
    .sort((left, right) =>
      right.evidenceIds.length - left.evidenceIds.length ||
      right.confidence - left.confidence ||
      left.granularity - right.granularity,
    )
    .slice(0, 8);
}

export async function runKnowledgeAgent(options: KnowledgeAgentOptions): Promise<KnowledgeAgentRun> {
  const started = Date.now();
  const notes = validateNotes(options.notes);
  const mapSpec: MapSpec = validateMapSpec({
    goal: options.goal,
    audience: options.audience,
    granularity: options.granularity,
    expansionRadius: options.expansionRadius,
    maxNodes: options.maxNodes,
    confidenceThreshold: options.confidenceThreshold,
  });
  const trace: AgentRoundTrace[] = [];
  const warnings: string[] = [];
  let modelCalls = 0;
  let cumulativeDraft = options.initialDraft
    ? validateDraft(options.initialDraft, "initialDraft")
    : emptyDraft(mapSpec.goal);
  if (!options.initialDraft) {
    const extracted = validateDraft(await options.provider.analyze({ notes, spec: mapSpec }), "provider analysis");
    modelCalls += 1;
    cumulativeDraft = mergeAgentDrafts(cumulativeDraft, extracted);
  }
  let graph = compileAgentGraph(cumulativeDraft, notes, mapSpec.confidenceThreshold, mapSpec.maxNodes);
  trace.push({
    round: 0,
    frontierIds: graph.concepts.filter((concept) => concept.discoveryState === "seed").map((concept) => concept.id),
    proposedConcepts: cumulativeDraft.concepts.length,
    acceptedConcepts: graph.concepts.length,
    mergedConcepts: Math.max(0, cumulativeDraft.concepts.length - graph.concepts.length),
    rejectedConcepts: Math.max(0, cumulativeDraft.concepts.length - graph.concepts.length),
    noveltyRatio: graph.concepts.length ? 1 : 0,
  });

  let previousNewIds = graph.concepts.filter((concept) => concept.discoveryState === "seed").map((concept) => concept.id);
  if (!options.provider.supportsSemanticExpansion) {
    warnings.push("当前提供器只构建笔记内可追溯的证据图；配置 OpenAI-compatible 模型或由 Codex 提供结构化草稿后才能发现笔记外相邻知识。");
    trace.push({ round: 1, frontierIds: previousNewIds, proposedConcepts: 0, acceptedConcepts: 0, mergedConcepts: 0, rejectedConcepts: 0, noveltyRatio: 0, stopReason: "provider-does-not-support-semantic-expansion" });
  } else {
    for (let round = 1; round <= mapSpec.expansionRadius; round += 1) {
      if (graph.concepts.length >= mapSpec.maxNodes) {
        trace.push({ round, frontierIds: [], proposedConcepts: 0, acceptedConcepts: 0, mergedConcepts: 0, rejectedConcepts: 0, noveltyRatio: 0, stopReason: "max-nodes-reached" });
        break;
      }
      const frontier = frontierForRound(graph, previousNewIds, round);
      if (!frontier.length) {
        trace.push({ round, frontierIds: [], proposedConcepts: 0, acceptedConcepts: 0, mergedConcepts: 0, rejectedConcepts: 0, noveltyRatio: 0, stopReason: "frontier-empty" });
        break;
      }
      const beforeIds = new Set(graph.concepts.map((concept) => concept.id));
      const beforeDraftKeys = new Set(cumulativeDraft.concepts.map((concept) => normalizeConceptName(concept.name)));
      const addition = validateDraft(
        await options.provider.expand({ graph, frontier, notes, spec: mapSpec, round }),
        `provider expansion round ${round}`,
      );
      modelCalls += 1;
      cumulativeDraft = mergeAgentDrafts(cumulativeDraft, addition);
      graph = compileAgentGraph(cumulativeDraft, notes, mapSpec.confidenceThreshold, mapSpec.maxNodes);
      previousNewIds = graph.concepts.filter((concept) => !beforeIds.has(concept.id)).map((concept) => concept.id);
      const proposedUnique = new Set(addition.concepts.map((concept) => normalizeConceptName(concept.name)).filter(Boolean));
      const mergedConcepts = [...proposedUnique].filter((key) => beforeDraftKeys.has(key)).length;
      const acceptedConcepts = previousNewIds.length;
      const rejectedConcepts = Math.max(0, proposedUnique.size - mergedConcepts - acceptedConcepts);
      const noveltyRatio = proposedUnique.size ? acceptedConcepts / proposedUnique.size : 0;
      const roundTrace: AgentRoundTrace = {
        round,
        frontierIds: frontier.map((concept) => concept.id),
        proposedConcepts: proposedUnique.size,
        acceptedConcepts,
        mergedConcepts,
        rejectedConcepts,
        noveltyRatio: Number(noveltyRatio.toFixed(3)),
      };
      if (!proposedUnique.size) roundTrace.stopReason = "provider-returned-no-candidates";
      else if (round >= 2 && noveltyRatio < 0.1) roundTrace.stopReason = "novelty-below-threshold";
      trace.push(roundTrace);
      if (roundTrace.stopReason) break;
    }
  }

  const granularities: MapGranularity[] = [1, 2, 3, 4, 5];
  const projections = Object.fromEntries(
    granularities.map((granularity) => [granularity, projectAgentGraph(graph, granularity, mapSpec)]),
  ) as Record<MapGranularity, ReturnType<typeof projectAgentGraph>>;
  const generatedAt = (options.now ?? new Date()).toISOString();
  return {
    runId: `agent_run_${crypto.randomUUID().replaceAll("-", "")}`,
    status: warnings.length ? "partial" : "completed",
    provider: options.provider.name,
    generatedAt,
    mapSpec,
    notes,
    graph,
    projections,
    selectedProjection: projections[mapSpec.granularity],
    trace,
    warnings,
    metrics: {
      durationMs: Date.now() - started,
      modelCalls,
      conceptCount: graph.concepts.length,
      relationCount: graph.relations.length,
      evidenceCount: graph.evidence.length,
    },
  };
}
