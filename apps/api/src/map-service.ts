import type {
  ConceptCorrectionInput,
  MapSpec,
  MasteryEvidenceInput,
} from "@/packages/contracts/src";
import {
  buildDynamicMap,
  calculateConceptMastery,
  compareMapVersions,
  resolveConceptName,
  suggestMapSpec,
  validateMapSpec,
} from "@/packages/knowledge-engine/src";
import { readKnowledgeRepository } from "./knowledge-service";
import { D1PlatformRepository } from "./platform-repository";
import { discoverSources } from "./discovery-service";

export async function createKnowledgeMap(database: D1Database, input: {
  goal: string;
  audience?: string;
  spec?: Partial<MapSpec>;
  seedNoteId?: string;
  discover?: boolean;
}) {
  const suggestion = suggestMapSpec(input.goal, input.audience);
  const spec = validateMapSpec({ ...suggestion.spec, ...input.spec, goal: input.goal, audience: input.audience ?? suggestion.spec.audience });
  const repositoryData = await readKnowledgeRepository(database);
  const map = buildDynamicMap({
    spec,
    seedNoteId: input.seedNoteId,
    repositoryAnalysis: repositoryData.analysis,
  });
  map.incremental = repositoryData.incremental;
  if (input.discover) {
    const discovery = await discoverSources(database, spec.goal, { limitPerProvider: 4, crawlTop: 1 });
    map.externalSources = discovery.sources
      .filter((source) => source.trustScore >= spec.confidenceThreshold)
      .slice(0, Math.min(12, Math.max(3, Math.floor(spec.maxNodes / 3))));
    map.sources = map.externalSources.map((source) => ({
      id: source.id,
      title: source.title,
      sourceType: source.sourceType === "book" ? "handbook" : "paper",
      authority: source.trustScore,
      conceptIds: source.matchedConceptIds,
    }));
  }
  const repository = new D1PlatformRepository(database);
  await repository.initialize();
  await repository.saveMap(map);
  return { map, suggestion, repositoryCounts: repositoryData.counts };
}

export async function listKnowledgeMaps(database: D1Database) {
  const repository = new D1PlatformRepository(database);
  await repository.initialize();
  return repository.listMaps();
}

export async function getKnowledgeMap(database: D1Database, id: string) {
  const repository = new D1PlatformRepository(database);
  await repository.initialize();
  const map = await repository.getMap(id);
  if (!map) throw new Error("Map not found.");
  return map;
}

export async function freezeKnowledgeMap(database: D1Database, id: string) {
  const repository = new D1PlatformRepository(database);
  await repository.initialize();
  const map = await repository.getMap(id);
  if (!map) throw new Error("Map not found.");
  if (map.status === "frozen") return map;
  const frozen = { ...map, status: "frozen" as const, frozenAt: new Date().toISOString() };
  await repository.saveMap(frozen);
  return frozen;
}

export async function migrateKnowledgeMap(database: D1Database, id: string, input?: {
  spec?: Partial<MapSpec>;
  reason?: string;
}) {
  const repository = new D1PlatformRepository(database);
  await repository.initialize();
  const previous = await repository.getMap(id);
  if (!previous) throw new Error("Map not found.");
  const repositoryData = await readKnowledgeRepository(database);
  const spec = validateMapSpec({ ...previous.mapSpec, ...input?.spec, goal: input?.spec?.goal ?? previous.mapSpec.goal });
  const evidence = await repository.listMasteryEvidence(previous.id);
  const conceptIds = [...new Set(evidence.map((item) => item.conceptId))];
  const mastery = conceptIds.map((conceptId) => calculateConceptMastery(conceptId, evidence));
  const migrated = buildDynamicMap({
    spec,
    seedNoteId: previous.seedNoteId,
    repositoryAnalysis: repositoryData.analysis,
    mastery,
    version: previous.version + 1,
    parentMapId: previous.id,
    revisionReason: input?.reason?.trim().slice(0, 300) || "知识目录或 MapSpec 发生变化",
  });
  migrated.incremental = repositoryData.incremental;
  migrated.externalSources = previous.externalSources;
  migrated.sources = previous.sources;
  await repository.saveMap(migrated);
  await repository.cloneMasteryEvidence(evidence, migrated.id);
  return { map: migrated, diff: compareMapVersions(previous, migrated) };
}

export async function compareKnowledgeMaps(database: D1Database, fromId: string, toId: string) {
  const repository = new D1PlatformRepository(database);
  await repository.initialize();
  const [from, to] = await Promise.all([repository.getMap(fromId), repository.getMap(toId)]);
  if (!from || !to) throw new Error("One or both maps were not found.");
  return compareMapVersions(from, to);
}

export async function recordMasteryEvidence(database: D1Database, input: MasteryEvidenceInput) {
  if (!Number.isFinite(input.score) || input.score < 0 || input.score > 1) throw new RangeError("score must be between 0 and 1.");
  const repository = new D1PlatformRepository(database);
  await repository.initialize();
  let map = await repository.getMap(input.mapId);
  if (!map) throw new Error("Map not found.");
  if (!map.analysis.nodes.some((node) => node.id === input.conceptId)) throw new Error("Concept is not part of this map.");
  if (map.status === "frozen") {
    const migrated = await migrateKnowledgeMap(database, map.id, { reason: "学习证据更新：从冻结版本创建新草稿" });
    map = migrated.map;
  }
  const record = await repository.addMasteryEvidence({ ...input, mapId: map.id, note: input.note?.trim().slice(0, 2_000) });
  const evidence = await repository.listMasteryEvidence(map.id);
  const conceptIds = [...new Set(evidence.map((item) => item.conceptId))];
  const mastery = conceptIds.map((conceptId) => calculateConceptMastery(conceptId, evidence));
  const repositoryData = await readKnowledgeRepository(database);
  const recomputed = buildDynamicMap({
    id: map.id,
    version: map.version,
    parentMapId: map.parentMapId,
    revisionReason: map.revisionReason,
    status: "draft",
    spec: map.mapSpec,
    seedNoteId: map.seedNoteId,
    repositoryAnalysis: repositoryData.analysis,
    mastery,
    createdAt: map.createdAt,
  });
  recomputed.externalSources = map.externalSources;
  recomputed.sources = map.sources;
  recomputed.incremental = repositoryData.incremental;
  await repository.saveMap(recomputed);
  return {
    evidence: record,
    mastery: mastery.find((item) => item.conceptId === input.conceptId)!,
    map: recomputed,
  };
}

export async function queueConceptCorrection(database: D1Database, input: ConceptCorrectionInput) {
  if (!input.mapId || !input.conceptId) throw new TypeError("mapId and conceptId are required.");
  if ((input.action === "rename" || input.action === "merge") && !input.proposedValue?.trim()) {
    throw new TypeError("proposedValue is required for rename or merge.");
  }
  const repository = new D1PlatformRepository(database);
  await repository.initialize();
  const map = await repository.getMap(input.mapId);
  if (!map) throw new Error("Map not found.");
  if (!map.analysis.nodes.some((node) => node.id === input.conceptId)) throw new Error("Concept is not part of this map.");
  return repository.createCorrection({
    ...input,
    proposedValue: input.proposedValue?.trim().slice(0, 160),
    reason: input.reason?.trim().slice(0, 1_000),
  });
}

export async function resolveConceptCorrection(database: D1Database, id: string, status: "accepted" | "rejected") {
  const repository = new D1PlatformRepository(database);
  await repository.initialize();
  const correction = await repository.resolveCorrection(id, status);
  if (status === "rejected") return { correction };
  let map = await repository.getMap(correction.mapId);
  if (!map) throw new Error("Map not found.");
  if (map.status === "frozen") map = (await migrateKnowledgeMap(database, map.id, { reason: `接受人工纠错 ${id}` })).map;
  const nodes = map.analysis.nodes.map((node) => {
    if (node.id !== correction.conceptId || correction.action !== "rename") return node;
    return { ...node, aliases: [...new Set([...(node.aliases ?? []), node.label])], label: correction.proposedValue! };
  }).filter((node) => !(node.id === correction.conceptId && correction.action === "reject"));
  let edges = map.analysis.edges.filter((edge) => nodes.some((node) => node.id === edge.source) && nodes.some((node) => node.id === edge.target));
  if (correction.action === "merge" && correction.proposedValue) {
    const resolution = resolveConceptName(correction.proposedValue);
    const target = nodes.find((node) => node.id === correction.proposedValue || node.label === correction.proposedValue || node.id === resolution.canonicalId);
    if (!target) throw new Error("Merge target is not part of this map.");
    const removedId = correction.conceptId;
    const dedup = new Map<string, (typeof edges)[number]>();
    edges.forEach((edge) => {
      const source = edge.source === removedId ? target.id : edge.source;
      const targetId = edge.target === removedId ? target.id : edge.target;
      if (source !== targetId) dedup.set(`${source}->${targetId}:${edge.relation}`, { ...edge, id: `${source}->${targetId}`, source, target: targetId });
    });
    edges = [...dedup.values()];
    map.analysis.nodes = nodes.filter((node) => node.id !== removedId);
  } else {
    map.analysis.nodes = nodes;
  }
  map.analysis.edges = edges;
  map.canonicalMerges = map.analysis.nodes.filter((node) => node.aliases?.length).map((node) => ({ canonicalId: node.id, canonicalName: node.label, aliases: node.aliases ?? [], confidence: 1 }));
  await repository.saveMap(map);
  return { correction, map };
}
