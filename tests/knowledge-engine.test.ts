import assert from "node:assert/strict";
import test from "node:test";
import { DEMO_NOTES } from "../fixtures/demo/transformer-notes.ts";
import {
  analyzeKnowledgeNetwork,
  buildDynamicMap,
  calculateConceptMastery,
  compareMapVersions,
  generateTutorLesson,
  resolveConceptName,
  suggestMapSpec,
  validateMapSpec,
} from "../packages/knowledge-engine/src/index.ts";

test("analysis links illuminated concepts back to note evidence", () => {
  const analysis = analyzeKnowledgeNetwork(DEMO_NOTES);
  const attention = analysis.nodes.find((node) => node.id === "attention");

  assert.equal(analysis.summary.noteCount, DEMO_NOTES.length);
  assert.ok(attention);
  assert.ok(attention.evidence.length > 0);
  assert.match(attention.evidence[0].noteId, /^demo-/);
  assert.ok(analysis.summary.weightedCoverage > 0);
  assert.ok(analysis.recommendedNext.length > 0);
});

test("analysis id is stable for the same repository", () => {
  const first = analyzeKnowledgeNetwork(DEMO_NOTES);
  const second = analyzeKnowledgeNetwork([...DEMO_NOTES].reverse());
  assert.equal(first.id, second.id);
});

test("MapSpec is inferred from the goal and remains inside product boundaries", () => {
  const suggestion = suggestMapSpec("从源码和公式深入推导 Transformer 推理性能", "工程师");
  assert.equal(suggestion.spec.granularity, 5);
  assert.ok(suggestion.spec.expansionRadius >= 2);
  assert.ok(suggestion.spec.maxNodes <= 60);
  assert.equal(suggestion.inferredFrom, "goal-heuristic");
});

test("MapSpec replaces non-finite numeric input with bounded defaults", () => {
  const spec = validateMapSpec({
    goal: "理解一个领域",
    granularity: Number.NaN as 3,
    expansionRadius: Number.POSITIVE_INFINITY as 2,
    maxNodes: Number.NaN,
    confidenceThreshold: Number.NEGATIVE_INFINITY,
  });
  assert.deepEqual(
    { granularity: spec.granularity, expansionRadius: spec.expansionRadius, maxNodes: spec.maxNodes, confidenceThreshold: spec.confidenceThreshold },
    { granularity: 3, expansionRadius: 2, maxNodes: 24, confidenceThreshold: 0.58 },
  );
});

test("dynamic map respects granularity, hop and node limits", () => {
  const analysis = analyzeKnowledgeNetwork(DEMO_NOTES);
  const map = buildDynamicMap({
    spec: {
      goal: "理解注意力机制和 Transformer Block",
      audience: "工程师",
      granularity: 3,
      expansionRadius: 1,
      maxNodes: 10,
      confidenceThreshold: 0.58,
    },
    repositoryAnalysis: analysis,
    seedNoteId: DEMO_NOTES[0].id,
  });
  assert.ok(map.analysis.nodes.length <= 10);
  assert.equal(map.mapSpec.expansionRadius, 1);
  assert.ok(map.rounds.length === 2);
  assert.ok(map.goalConceptIds.length > 0);
});

test("map version comparison reports topology and coverage changes", () => {
  const analysis = analyzeKnowledgeNetwork(DEMO_NOTES);
  const base = buildDynamicMap({
    id: "map-base",
    spec: { goal: "理解注意力", audience: "学习者", granularity: 2, expansionRadius: 1, maxNodes: 8, confidenceThreshold: 0.5 },
    repositoryAnalysis: analysis,
  });
  const next = buildDynamicMap({
    id: "map-next",
    parentMapId: base.id,
    version: 2,
    spec: { goal: "系统理解 Transformer 推理", audience: "学习者", granularity: 5, expansionRadius: 3, maxNodes: 40, confidenceThreshold: 0.5 },
    repositoryAnalysis: analysis,
  });
  const diff = compareMapVersions(base, next);
  assert.ok(diff.addedNodeIds.length > 0);
  assert.ok(diff.specChanges.granularity);
  assert.equal(diff.fromMapId, base.id);
});

test("mastery distinguishes saved, understood and applied with decay", () => {
  const now = new Date("2026-08-08T00:00:00.000Z");
  const saved = calculateConceptMastery("attention", [{ id: "e1", mapId: "m1", conceptId: "attention", evidenceType: "saved", score: 1, createdAt: now.toISOString() }], now);
  assert.equal(saved.level, "seen");
  const applied = calculateConceptMastery("attention", [
    { id: "e2", mapId: "m1", conceptId: "attention", evidenceType: "explanation", score: 0.9, createdAt: now.toISOString() },
    { id: "e3", mapId: "m1", conceptId: "attention", evidenceType: "project", score: 0.9, createdAt: now.toISOString() },
  ], now);
  assert.equal(applied.level, "applied");
  assert.ok(applied.nextReviewAt);
  const stale = calculateConceptMastery("attention", [{ id: "e4", mapId: "m1", conceptId: "attention", evidenceType: "quiz", score: 0.9, createdAt: "2025-01-01T00:00:00.000Z" }], now);
  assert.equal(stale.needsReverification, true);
});

test("gap lesson includes a check and an evidence-producing activity", () => {
  const node = analyzeKnowledgeNetwork([]).nodes.find((item) => item.id === "attention");
  assert.ok(node);
  const lesson = generateTutorLesson(node);
  assert.equal(lesson.provider, "local-teaching-agent");
  assert.equal(lesson.check.answerIndex, 1);
  assert.ok(lesson.steps.some((step) => /复述|证据|实现/.test(step.task)));
});

test("aliases resolve to one canonical concept before human correction", () => {
  const resolution = resolveConceptName("SelfAttention");
  assert.equal(resolution.canonicalId, "self-attention");
  assert.equal(resolution.ambiguous, false);
  assert.equal(resolution.confidence, 1);
});
