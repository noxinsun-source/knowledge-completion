import assert from "node:assert/strict";
import test from "node:test";
import type { KnowledgeAgentRunError } from "../packages/contracts/src/index.ts";
import type {
  AgentGraphDraft,
  KnowledgeAgentModel,
  KnowledgeAgentRun,
} from "../packages/knowledge-agent/src/index.ts";
import type {
  KnowledgeAgentRunStore,
  StoredKnowledgeAgentRun,
} from "../apps/api/src/agent-run-repository.ts";
import {
  buildKnowledgeAgentRunEvent,
  executeKnowledgeAgentRun,
  normalizeKnowledgeAgentRunRequest,
  recomputeKnowledgeAgentRunWithStore,
} from "../apps/api/src/agent-run-service.ts";

class MemoryRunStore implements KnowledgeAgentRunStore {
  readonly records = new Map<string, StoredKnowledgeAgentRun>();

  async create(record: StoredKnowledgeAgentRun) {
    if (this.records.has(record.runId)) throw new Error("duplicate run id");
    this.records.set(record.runId, record);
    return record;
  }

  async complete(runId: string, result: KnowledgeAgentRun, completedAt: string) {
    const current = this.records.get(runId);
    if (!current) throw new Error("run not found");
    const completed: StoredKnowledgeAgentRun = {
      ...current,
      status: result.status,
      provider: result.provider,
      result,
      completedAt,
      updatedAt: completedAt,
    };
    this.records.set(runId, completed);
    return completed;
  }

  async fail(runId: string, error: KnowledgeAgentRunError, completedAt: string) {
    const current = this.records.get(runId);
    if (!current) throw new Error("run not found");
    const failed: StoredKnowledgeAgentRun = {
      ...current,
      status: "failed",
      error,
      completedAt,
      updatedAt: completedAt,
    };
    this.records.set(runId, failed);
    return failed;
  }

  async get(runId: string) {
    return this.records.get(runId) ?? null;
  }
}

const note = {
  id: "note-run-test",
  title: "注意力机制",
  content: "# 注意力机制\n\n- 查询向量：用于匹配相关键。\n- 键向量：表示可检索信息。",
  source: "test",
  capturedAt: "2026-08-08",
  confidence: 0.9,
};

test("a synchronous API run keeps one durable run id from running to terminal result", async () => {
  const store = new MemoryRunStore();
  const run = await executeKnowledgeAgentRun(store, {
    note,
    goal: "理解注意力机制",
    granularity: 4,
  }, {
    runId: "agent_run_sync001",
    now: () => new Date("2026-08-08T12:00:00.000Z"),
  });

  assert.equal(store.records.size, 1);
  assert.equal(run.runId, "agent_run_sync001");
  assert.equal(run.result?.runId, run.runId);
  assert.equal(run.status, "partial");
  assert.equal(run.provider, "heuristic-offline-v1");
  assert.equal(run.input.notes?.length, 1);
  assert.ok(run.result?.graph.concepts.length);
  assert.ok(run.completedAt);
});

test("host-authored draft is labeled host-native instead of heuristic", async () => {
  const store = new MemoryRunStore();
  const initialDraft: AgentGraphDraft = {
    scope: "注意力机制",
    scopeDescription: "由宿主模型扩展后的草稿",
    concepts: [
      {
        name: "注意力机制",
        semanticType: "domain",
        granularity: 1,
        description: "目标领域",
        confidence: 1,
      },
      {
        name: "查询向量",
        semanticType: "concept",
        granularity: 3,
        description: "查询表示",
        parentNames: ["注意力机制"],
        confidence: 0.9,
        evidence: [{ sourceNoteId: note.id, excerpt: "查询向量：用于匹配相关键。" }],
      },
    ],
    relations: [],
  };
  const run = await executeKnowledgeAgentRun(store, {
    notes: [note],
    goal: "理解注意力机制",
    initialDraft,
  }, { runId: "agent_run_host001" });

  assert.equal(run.provider, "host-native-draft-v1");
  assert.equal(run.result?.provider, "host-native-draft-v1");
  assert.equal(run.status, "completed");
});

test("execution failures remain queryable with a structured persisted error", async () => {
  const store = new MemoryRunStore();
  const failingProvider: KnowledgeAgentModel = {
    name: "failing-test-provider",
    supportsSemanticExpansion: true,
    async analyze() {
      throw new Error("provider unavailable");
    },
    async expand() {
      throw new Error("not reached");
    },
  };
  const run = await executeKnowledgeAgentRun(store, {
    notes: [note],
    goal: "理解注意力机制",
  }, {
    provider: failingProvider,
    runId: "agent_run_failure001",
  });

  assert.equal(run.status, "failed");
  assert.equal(run.error?.code, "execution-failed");
  assert.equal(run.error?.retryable, true);
  assert.equal((await store.get(run.runId))?.error?.message, "provider unavailable");
});

test("recompute creates a new immutable run linked to its parent", async () => {
  const store = new MemoryRunStore();
  const original = await executeKnowledgeAgentRun(store, {
    notes: [note],
    goal: "理解注意力机制",
    granularity: 2,
  }, { runId: "agent_run_parent001" });
  const recomputed = await recomputeKnowledgeAgentRunWithStore(
    store,
    original.runId,
    { granularity: 5, maxNodes: 40 },
    { runId: "agent_run_child001" },
  );

  assert.equal(recomputed.parentRunId, original.runId);
  assert.equal(recomputed.attempt, 2);
  assert.equal(recomputed.runId, "agent_run_child001");
  assert.equal(recomputed.result?.mapSpec.granularity, 5);
  assert.equal((await store.get(original.runId))?.result?.mapSpec.granularity, 2);
  assert.equal(store.records.size, 2);
});

test("event snapshots expose an explicit terminal flag for finite SSE responses", async () => {
  const store = new MemoryRunStore();
  const run = await executeKnowledgeAgentRun(store, {
    notes: [note],
    goal: "理解注意力机制",
  }, { runId: "agent_run_event001" });
  const event = buildKnowledgeAgentRunEvent(run);

  assert.equal(event.type, "run.partial");
  assert.equal(event.terminal, true);
  assert.equal(event.run.runId, run.runId);
});

test("request normalization rejects ambiguous note and notes payloads", () => {
  assert.throws(
    () => normalizeKnowledgeAgentRunRequest({ note, notes: [note], goal: "测试" }),
    /either note or notes/,
  );
});

test("request normalization assigns deterministic note ids and rejects duplicates", () => {
  const normalized = normalizeKnowledgeAgentRunRequest({
    notes: [
      { title: "第一篇", content: "第一篇正文" },
      { title: "第二篇", content: "第二篇正文" },
    ],
    goal: "测试输入映射",
  });
  assert.deepEqual(normalized.notes?.map((item) => item.id), ["note_1", "note_2"]);
  assert.throws(
    () => normalizeKnowledgeAgentRunRequest({
      notes: [{ ...note, id: "same" }, { ...note, id: "same" }],
      goal: "测试重复 ID",
    }),
    /Duplicate input note id/,
  );
});

test("request normalization rejects out-of-contract MapSpec values instead of silently clamping", () => {
  for (const invalid of [
    { granularity: 2.5 },
    { granularity: 9 },
    { expansionRadius: 0 },
    { expansionRadius: 4 },
    { maxNodes: 7 },
    { maxNodes: 61 },
    { confidenceThreshold: 0.29 },
    { confidenceThreshold: 0.96 },
  ]) {
    assert.throws(
      () => normalizeKnowledgeAgentRunRequest({ notes: [note], goal: "测试严格参数", ...invalid }),
      /must be (?:an integer|between)/,
    );
  }
});

test("host draft evidence must name an input note and quote it verbatim", () => {
  const draft = {
    scope: "注意力机制",
    scopeDescription: "严格证据测试",
    concepts: [{
      name: "查询向量",
      semanticType: "concept",
      granularity: 3,
      description: "查询表示",
      confidence: 0.9,
      evidence: [{ sourceNoteId: "missing-note", excerpt: "查询向量：用于匹配相关键。" }],
    }],
    relations: [],
  };
  assert.throws(
    () => normalizeKnowledgeAgentRunRequest({ notes: [note], goal: "测试证据引用", initialDraft: draft }),
    /does not match an input note/,
  );
  draft.concepts[0].evidence[0].sourceNoteId = note.id;
  draft.concepts[0].evidence[0].excerpt = "这段文字并不存在于输入笔记";
  assert.throws(
    () => normalizeKnowledgeAgentRunRequest({ notes: [note], goal: "测试证据原文", initialDraft: draft }),
    /must occur verbatim/,
  );
});

test("host draft rejects unsupported enums and relation endpoints", () => {
  const concept = {
    name: "查询向量",
    semanticType: "concept",
    granularity: 3,
    description: "查询表示",
    confidence: 0.9,
    evidence: [{ sourceNoteId: note.id, excerpt: "查询向量：用于匹配相关键。" }],
  };
  assert.throws(
    () => normalizeKnowledgeAgentRunRequest({
      notes: [note],
      goal: "测试枚举",
      initialDraft: { scope: "注意力", scopeDescription: "测试", concepts: [{ ...concept, semanticType: "invalid" }], relations: [] },
    }),
    /semanticType is not supported/,
  );
  assert.throws(
    () => normalizeKnowledgeAgentRunRequest({
      notes: [note],
      goal: "测试端点",
      initialDraft: {
        scope: "注意力",
        scopeDescription: "测试",
        concepts: [concept],
        relations: [{
          sourceName: "查询向量",
          targetName: "不存在的概念",
          relation: "related_to",
          statement: "测试关系",
          confidence: 0.7,
          evidence: [],
        }],
      },
    }),
    /endpoints must reference concepts/,
  );
});
