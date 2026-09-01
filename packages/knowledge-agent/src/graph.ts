import type { MapGranularity, MapSpec, SourceNote } from "../../contracts/src/index.ts";
import type {
  AgentConcept,
  AgentEvidence,
  AgentGraphDraft,
  AgentRelation,
  CanonicalAgentGraph,
  DraftConcept,
  DraftRelation,
  GranularityProjection,
  ProjectionEdge,
  ProjectionNode,
} from "./types.ts";

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

export function normalizeConceptName(value: string) {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase("zh-CN")
    .replace(/[\s·•—–_\-/:：，。,（）()【】[\]「」『』“”"']/g, "");
}

function stableHash(value: string) {
  let hash = 2166136261;
  for (const character of value) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16);
}

function conceptId(name: string) {
  const normalized = normalizeConceptName(name);
  const ascii = name
    .normalize("NFKD")
    .toLocaleLowerCase("en-US")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32);
  const fingerprint = stableHash(normalized).padStart(8, "0").slice(0, 8);
  return `concept_${ascii ? `${ascii}-${fingerprint}` : fingerprint}`;
}

function evidenceId(sourceId: string, excerpt: string) {
  return `evidence_${stableHash(`${sourceId}:${excerpt}`)}`;
}

function noteContainsExcerpt(note: SourceNote | undefined, excerpt: string) {
  if (!note) return false;
  const core = excerpt.replace(/^…+|…+$/g, "").trim();
  return core.length > 0 && note.content.includes(core);
}

const MAX_UNVERIFIED_CONFIDENCE = 0.78;

function verifiedEvidenceCount(
  items: DraftConcept["evidence"] | DraftRelation["evidence"],
  noteById: Map<string, SourceNote>,
) {
  return (items ?? []).filter((item) =>
    typeof item.excerpt === "string" &&
    noteContainsExcerpt(noteById.get(item.sourceNoteId ?? ""), item.excerpt),
  ).length;
}

function evidenceBoundedConfidence(
  value: number,
  items: DraftConcept["evidence"] | DraftRelation["evidence"],
  noteById: Map<string, SourceNote>,
) {
  const normalized = clamp(Number.isFinite(value) ? value : 0, 0, 1);
  return verifiedEvidenceCount(items, noteById)
    ? normalized
    : Math.min(normalized, MAX_UNVERIFIED_CONFIDENCE);
}

function mergeConcept(left: DraftConcept, right: DraftConcept): DraftConcept {
  const evidence = [...(left.evidence ?? []), ...(right.evidence ?? [])];
  const uniqueEvidence = new Map(
    evidence.map((item) => [`${item.sourceNoteId ?? "model"}:${item.excerpt}`, item]),
  );
  return {
    ...left,
    aliases: [...new Set([...(left.aliases ?? []), ...(right.aliases ?? []), right.name])],
    semanticType:
      left.semanticType === "domain" || right.semanticType !== "domain"
        ? left.semanticType
        : right.semanticType,
    granularity: Math.min(left.granularity, right.granularity) as MapGranularity,
    description: left.description.length >= right.description.length ? left.description : right.description,
    whyItMatters: left.whyItMatters ?? right.whyItMatters,
    parentNames: [...new Set([...(left.parentNames ?? []), ...(right.parentNames ?? [])])],
    evidence: [...uniqueEvidence.values()],
    confidence: Math.max(left.confidence, right.confidence),
    expandable: left.expandable !== false || right.expandable !== false,
  };
}

function relationKey(relation: DraftRelation) {
  return `${normalizeConceptName(relation.sourceName)}:${relation.relation}:${normalizeConceptName(relation.targetName)}`;
}

export function mergeAgentDrafts(base: AgentGraphDraft, addition: AgentGraphDraft): AgentGraphDraft {
  const concepts = new Map<string, DraftConcept>();
  for (const concept of [...base.concepts, ...addition.concepts]) {
    const key = normalizeConceptName(concept.name);
    if (!key) continue;
    const existing = concepts.get(key);
    concepts.set(key, existing ? mergeConcept(existing, concept) : concept);
  }
  const relations = new Map<string, DraftRelation>();
  for (const relation of [...base.relations, ...addition.relations]) {
    const key = relationKey(relation);
    const existing = relations.get(key);
    relations.set(key, existing && existing.confidence >= relation.confidence ? existing : relation);
  }
  return {
    scope: base.scope || addition.scope,
    scopeDescription: base.scopeDescription || addition.scopeDescription,
    concepts: [...concepts.values()],
    relations: [...relations.values()],
  };
}

export function compileAgentGraph(
  draft: AgentGraphDraft,
  notes: SourceNote[],
  confidenceThreshold: number,
  maxNodes = 60,
): CanonicalAgentGraph {
  const noteById = new Map(notes.map((note) => [note.id, note]));
  const mergedConcepts = new Map<string, DraftConcept>();
  for (const concept of draft.concepts) {
    const key = normalizeConceptName(concept.name);
    if (!key) continue;
    const cleaned: DraftConcept = {
      ...concept,
      name: concept.name.trim().slice(0, 120),
      aliases: (concept.aliases ?? []).map((alias) => alias.trim()).filter(Boolean).slice(0, 12),
      description: concept.description.trim().slice(0, 800),
      whyItMatters: concept.whyItMatters?.trim().slice(0, 500),
      parentNames: (concept.parentNames ?? []).map((parent) => parent.trim()).filter(Boolean).slice(0, 6),
      confidence: evidenceBoundedConfidence(Number(concept.confidence), concept.evidence, noteById),
      granularity: clamp(Math.round(Number(concept.granularity)), 1, 5) as MapGranularity,
    };
    const existing = mergedConcepts.get(key);
    mergedConcepts.set(key, existing ? mergeConcept(existing, cleaned) : cleaned);
  }

  if (!mergedConcepts.size) {
    const fallbackName = notes[0]?.title || draft.scope || "未命名知识域";
    mergedConcepts.set(normalizeConceptName(fallbackName), {
      name: fallbackName,
      semanticType: "domain",
      granularity: 1,
      description: draft.scopeDescription || `围绕“${fallbackName}”构建的知识范围。`,
      confidence: 1,
      evidence: notes[0]
        ? [{ sourceNoteId: notes[0].id, excerpt: notes[0].content.slice(0, 240), confidence: 1 }]
        : [],
    });
  }

  const domainKey =
    [...mergedConcepts.entries()].find(([, concept]) => concept.semanticType === "domain")?.[0] ??
    [...mergedConcepts.keys()][0];
  const domain = mergedConcepts.get(domainKey)!;
  domain.semanticType = "domain";
  domain.granularity = 1;

  const rankedConcepts = [...mergedConcepts.entries()]
    .sort(([leftKey, left], [rightKey, right]) => {
      if (leftKey === domainKey) return -1;
      if (rightKey === domainKey) return 1;
      const leftEvidence = verifiedEvidenceCount(left.evidence, noteById);
      const rightEvidence = verifiedEvidenceCount(right.evidence, noteById);
      return rightEvidence - leftEvidence || right.confidence - left.confidence || left.granularity - right.granularity;
    })
    .filter(([key, concept]) =>
      key === domainKey ||
      verifiedEvidenceCount(concept.evidence, noteById) > 0 ||
      concept.confidence >= Math.max(0.45, confidenceThreshold - 0.12),
    )
    .slice(0, maxNodes);
  const selectedKeys = new Set(rankedConcepts.map(([key]) => key));
  const idByKey = new Map(rankedConcepts.map(([key, concept]) => [key, conceptId(concept.name)]));
  const evidence = new Map<string, AgentEvidence>();

  const concepts: AgentConcept[] = rankedConcepts.map(([key, concept]) => {
    const evidenceIds = (concept.evidence ?? []).flatMap((item) => {
      const sourceId = item.sourceNoteId ?? "model-proposal";
      const sourceNote = noteById.get(sourceId);
      const excerpt = item.excerpt.trim().slice(0, 800);
      if (!excerpt) return [];
      const verifiedAgainstNote = noteContainsExcerpt(sourceNote, excerpt);
      const id = evidenceId(sourceId, excerpt);
      evidence.set(id, {
        id,
        sourceType: verifiedAgainstNote ? "note" : "model",
        sourceId,
        sourceTitle: verifiedAgainstNote ? sourceNote!.title : "未验证模型候选",
        excerpt,
        confidence: clamp(Number(item.confidence ?? concept.confidence), 0, 1),
      });
      return id;
    });
    const verifiedEvidenceCount = evidenceIds.filter(
      (id) => evidence.get(id)?.sourceType === "note" || evidence.get(id)?.sourceType === "web",
    ).length;
    const ownId = idByKey.get(key)!;
    const parentIds = (concept.parentNames ?? [])
      .map((parent) => idByKey.get(normalizeConceptName(parent)))
      .filter((id): id is string => Boolean(id) && id !== ownId);
    if (key !== domainKey && !parentIds.length) parentIds.push(idByKey.get(domainKey)!);
    return {
      id: ownId,
      name: concept.name,
      aliases: [...new Set(concept.aliases ?? [])],
      semanticType: concept.semanticType,
      granularity: concept.granularity,
      description: concept.description,
      whyItMatters: concept.whyItMatters || `它是“${draft.scope}”知识结构中的一个组成部分。`,
      parentIds: [...new Set(parentIds)],
      childIds: [],
      evidenceIds,
      confidence: concept.confidence,
      coverage: verifiedEvidenceCount >= 2 ? "covered" : verifiedEvidenceCount ? "partial" : "missing",
      discoveryState: verifiedEvidenceCount ? "seed" : "boundary",
      expandable: concept.expandable !== false,
      depth: key === domainKey ? 0 : 1,
    };
  });

  const conceptById = new Map(concepts.map((concept) => [concept.id, concept]));
  for (const concept of concepts) {
    for (const parentId of concept.parentIds) {
      const parent = conceptById.get(parentId);
      if (parent && !parent.childIds.includes(concept.id)) parent.childIds.push(concept.id);
    }
  }

  const rootId = idByKey.get(domainKey)!;
  for (const concept of concepts) concept.depth = concept.id === rootId ? 0 : Number.POSITIVE_INFINITY;
  const queue = [rootId];
  while (queue.length) {
    const parentId = queue.shift()!;
    const parent = conceptById.get(parentId)!;
    for (const childId of parent.childIds) {
      const child = conceptById.get(childId);
      if (!child || child.depth <= parent.depth + 1) continue;
      child.depth = parent.depth + 1;
      queue.push(childId);
    }
  }
  for (const concept of concepts) {
    if (!Number.isFinite(concept.depth)) {
      concept.parentIds = [rootId];
      concept.depth = 1;
      const root = conceptById.get(rootId)!;
      if (!root.childIds.includes(concept.id)) root.childIds.push(concept.id);
    }
    concept.granularity = Math.max(
      concept.granularity,
      Math.min(5, concept.depth + 1),
    ) as MapGranularity;
  }

  const relationDrafts: DraftRelation[] = [...draft.relations];
  for (const concept of concepts) {
    for (const parentId of concept.parentIds) {
      const parent = conceptById.get(parentId);
      if (!parent) continue;
      relationDrafts.push({
        sourceName: concept.name,
        targetName: parent.name,
        relation: "part_of",
        statement: `${concept.name}属于${parent.name}`, confidence: Math.min(concept.confidence, parent.confidence),
      });
    }
  }

  const relations = new Map<string, AgentRelation>();
  for (const relation of relationDrafts) {
    const sourceKey = normalizeConceptName(relation.sourceName);
    const targetKey = normalizeConceptName(relation.targetName);
    if (!selectedKeys.has(sourceKey) || !selectedKeys.has(targetKey)) continue;
    const sourceId = idByKey.get(sourceKey)!;
    const targetId = idByKey.get(targetKey)!;
    if (sourceId === targetId) continue;
    const confidence = evidenceBoundedConfidence(Number(relation.confidence), relation.evidence, noteById);
    if (confidence < Math.max(0.35, confidenceThreshold - 0.22)) continue;
    const relationEvidenceIds = (relation.evidence ?? []).flatMap((item) => {
      const sourceNoteId = item.sourceNoteId ?? "model-proposal";
      const sourceNote = noteById.get(sourceNoteId);
      const excerpt = item.excerpt.trim().slice(0, 800);
      if (!excerpt) return [];
      const verifiedAgainstNote = noteContainsExcerpt(sourceNote, excerpt);
      const id = evidenceId(sourceNoteId, excerpt);
      evidence.set(id, {
        id,
        sourceType: verifiedAgainstNote ? "note" : "model",
        sourceId: sourceNoteId,
        sourceTitle: verifiedAgainstNote ? sourceNote!.title : "未验证模型候选",
        excerpt,
        confidence: clamp(Number(item.confidence ?? confidence), 0, 1),
      });
      return id;
    });
    const key = `${sourceId}:${relation.relation}:${targetId}`;
    const candidate: AgentRelation = {
      id: `relation_${stableHash(key)}`,
      sourceId,
      targetId,
      relation: relation.relation,
      statement: relation.statement.trim().slice(0, 500),
      evidenceIds: relationEvidenceIds,
      confidence,
      reviewState: relationEvidenceIds.some((id) => evidence.get(id)?.sourceType === "note" || evidence.get(id)?.sourceType === "web") && confidence >= confidenceThreshold
        ? "accepted"
        : "needs-review",
    };
    const existing = relations.get(key);
    if (!existing || candidate.confidence > existing.confidence) relations.set(key, candidate);
  }

  return {
    scope: draft.scope.trim().slice(0, 240) || domain.name,
    scopeDescription: draft.scopeDescription.trim().slice(0, 1_200) || domain.description,
    rootNodeId: idByKey.get(domainKey)!,
    concepts,
    relations: [...relations.values()],
    evidence: [...evidence.values()],
  };
}

function projectionRepresentative(
  concept: AgentConcept,
  visibleIds: Set<string>,
  conceptById: Map<string, AgentConcept>,
) {
  if (visibleIds.has(concept.id)) return concept.id;
  const queue = [...concept.parentIds];
  const visited = new Set<string>();
  while (queue.length) {
    const id = queue.shift()!;
    if (visited.has(id)) continue;
    visited.add(id);
    if (visibleIds.has(id)) return id;
    queue.push(...(conceptById.get(id)?.parentIds ?? []));
  }
  return undefined;
}

export function projectAgentGraph(
  graph: CanonicalAgentGraph,
  granularity: MapGranularity,
  spec?: Pick<MapSpec, "maxNodes">,
): GranularityProjection {
  const root = graph.concepts.find((concept) => concept.id === graph.rootNodeId);
  const eligible = graph.concepts
    .filter((concept) => concept.id === graph.rootNodeId || concept.granularity <= granularity)
    .sort((left, right) =>
      Number(right.id === graph.rootNodeId) - Number(left.id === graph.rootNodeId) ||
      right.evidenceIds.length - left.evidenceIds.length ||
      right.confidence - left.confidence,
    )
    .slice(0, spec?.maxNodes ?? graph.concepts.length);
  if (root && !eligible.some((concept) => concept.id === root.id)) eligible.unshift(root);
  const visibleIds = new Set(eligible.map((concept) => concept.id));
  const conceptById = new Map(graph.concepts.map((concept) => [concept.id, concept]));
  const representative = new Map<string, string>();
  for (const concept of graph.concepts) {
    const id = projectionRepresentative(concept, visibleIds, conceptById);
    if (id) representative.set(concept.id, id);
  }
  const members = new Map<string, string[]>();
  for (const [conceptId, representativeId] of representative) {
    if (conceptId === representativeId) continue;
    const list = members.get(representativeId) ?? [];
    list.push(conceptId);
    members.set(representativeId, list);
  }
  const nodes: ProjectionNode[] = eligible.map((concept) => {
    const aggregateMemberIds = members.get(concept.id) ?? [];
    const aggregateConcepts = [concept, ...aggregateMemberIds.map((id) => conceptById.get(id)).filter((item): item is AgentConcept => Boolean(item))];
    const aggregateCoverage = aggregateConcepts.reduce((sum, item) => sum + (item.coverage === "covered" ? 1 : item.coverage === "partial" ? 0.5 : 0), 0) / aggregateConcepts.length;
    return { ...concept, aggregateMemberIds, collapsed: aggregateMemberIds.length > 0, aggregateCoverage: Number(aggregateCoverage.toFixed(3)) };
  });
  const edges = new Map<string, ProjectionEdge>();
  for (const relation of graph.relations) {
    const sourceId = representative.get(relation.sourceId);
    const targetId = representative.get(relation.targetId);
    if (!sourceId || !targetId || sourceId === targetId) continue;
    const key = `${sourceId}:${relation.relation}:${targetId}`;
    const existing = edges.get(key);
    if (existing) {
      existing.aggregateRelationIds.push(relation.id);
      existing.confidence = Math.max(existing.confidence, relation.confidence);
      existing.evidenceIds = [...new Set([...existing.evidenceIds, ...relation.evidenceIds])];
    } else {
      edges.set(key, { ...relation, id: `projection_${stableHash(key)}`, sourceId, targetId, aggregateRelationIds: [relation.id] });
    }
  }
  const coverage = nodes.length
    ? nodes.reduce((sum, node) => sum + node.aggregateCoverage, 0) / nodes.length
    : 0;
  return {
    granularity,
    nodes,
    edges: [...edges.values()],
    hiddenNodeCount: Math.max(0, graph.concepts.length - nodes.length),
    coverage: Number(coverage.toFixed(3)),
  };
}
