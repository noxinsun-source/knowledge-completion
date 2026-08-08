import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  createHeuristicKnowledgeModel,
  createOpenAICompatibleKnowledgeModel,
  runKnowledgeAgent,
} from "../packages/knowledge-agent/src/index.ts";
import type { AgentGraphDraft } from "../packages/knowledge-agent/src/types.ts";

const coffeePath = new URL("../fixtures/demo/coffee-extraction.md", import.meta.url);

async function coffeeNote() {
  return {
    id: "coffee-note",
    title: "手冲咖啡萃取",
    content: await readFile(coffeePath, "utf8"),
    source: "fixture",
    capturedAt: "2026-08-08",
    confidence: 0.9,
  };
}

test("offline agent builds an arbitrary-domain evidence graph and five projections", async () => {
  const result = await runKnowledgeAgent({
    notes: [await coffeeNote()],
    goal: "理解手冲咖啡萃取变量并能诊断风味问题",
    audience: "咖啡初学者",
    granularity: 4,
    expansionRadius: 2,
    maxNodes: 36,
    provider: createHeuristicKnowledgeModel(),
  });
  const names = new Set(result.graph.concepts.map((concept) => concept.name));
  assert.ok(names.has("手冲咖啡萃取"));
  assert.ok(names.has("研磨度"));
  assert.ok(names.has("水温"));
  assert.ok(names.has("通道效应"));
  assert.ok(result.graph.relations.some((relation) => relation.relation === "prerequisite"));
  assert.ok(result.projections[1].nodes.length < result.projections[3].nodes.length);
  assert.ok(result.projections[3].nodes.length < result.projections[4].nodes.length);
  assert.ok(result.projections[4].nodes.length < result.projections[5].nodes.length);
  assert.equal(Object.keys(result.projections).length, 5);
  assert.equal(result.provider, "heuristic-offline-v1");
  assert.equal(result.status, "partial");
  assert.equal(result.trace.at(-1)?.stopReason, "provider-does-not-support-semantic-expansion");
  const ids = new Set(result.graph.concepts.map((concept) => concept.id));
  assert.ok(result.graph.relations.every((relation) => ids.has(relation.sourceId) && ids.has(relation.targetId)));
});

test("concept ids remain unique when multilingual names share the same ASCII slug", async () => {
  const result = await runKnowledgeAgent({
    notes: [{
      id: "rag-note",
      title: "RAG 检索笔记",
      content: "# RAG 系统\n## 检索\n- 向量检索：通过嵌入寻找相关文档。",
      source: "test",
      capturedAt: "2026-08-08",
      confidence: 0.9,
    }],
    goal: "理解 RAG 检索",
    provider: createHeuristicKnowledgeModel(),
  });
  const ragConcepts = result.graph.concepts.filter((concept) => concept.name.startsWith("RAG"));
  assert.ok(ragConcepts.length >= 2);
  assert.equal(new Set(ragConcepts.map((concept) => concept.id)).size, ragConcepts.length);
  assert.ok(result.graph.relations.every((relation) => relation.sourceId !== relation.targetId));
});

test("Codex-authored draft can add evidence-labelled adjacent knowledge without an API key", async () => {
  const note = await coffeeNote();
  const draft: AgentGraphDraft = {
    scope: "手冲咖啡萃取",
    scopeDescription: "从冲煮变量到流体机制的学习地图。",
    concepts: [
      { name: "手冲咖啡萃取", semanticType: "domain", granularity: 1, description: "目标领域", confidence: 1, evidence: [{ sourceNoteId: note.id, excerpt: "这份笔记记录如何稳定控制手冲咖啡的萃取" }] },
      { name: "研磨度", semanticType: "concept", granularity: 3, description: "颗粒尺寸", parentNames: ["手冲咖啡萃取"], confidence: 0.9, evidence: [{ sourceNoteId: note.id, excerpt: "研磨度：颗粒越细" }] },
      { name: "流体动力学", semanticType: "topic", granularity: 2, description: "解释水流通过粉床的相邻基础知识", parentNames: ["手冲咖啡萃取"], confidence: 0.7, evidence: [] },
    ],
    relations: [
      { sourceName: "流体动力学", targetName: "研磨度", relation: "enables", statement: "流体动力学帮助解释研磨度如何影响流速", confidence: 0.7 },
    ],
  };
  const result = await runKnowledgeAgent({ notes: [note], goal: "理解手冲咖啡萃取", provider: createHeuristicKnowledgeModel(), initialDraft: draft });
  const adjacent = result.graph.concepts.find((concept) => concept.name === "流体动力学");
  assert.ok(adjacent);
  assert.equal(adjacent.coverage, "missing");
  assert.equal(adjacent.discoveryState, "boundary");
});

test("compiler rejects fabricated note evidence and repairs cyclic hierarchy depth", async () => {
  const note = await coffeeNote();
  const draft: AgentGraphDraft = {
    scope: "手冲咖啡萃取",
    scopeDescription: "验证证据与层级安全边界。",
    concepts: [
      { name: "手冲咖啡萃取", semanticType: "domain", granularity: 1, description: "目标领域", confidence: 1 },
      { name: "循环甲", semanticType: "concept", granularity: 2, description: "循环节点", parentNames: ["循环乙"], confidence: 0.8, evidence: [{ sourceNoteId: note.id, excerpt: "原文中并不存在的模型杜撰句子" }] },
      { name: "循环乙", semanticType: "concept", granularity: 2, description: "循环节点", parentNames: ["循环甲"], confidence: 0.8 },
    ],
    relations: [],
  };
  const result = await runKnowledgeAgent({ notes: [note], goal: "验证安全边界", provider: createHeuristicKnowledgeModel(), initialDraft: draft });
  const fabricated = result.graph.concepts.find((concept) => concept.name === "循环甲");
  assert.ok(fabricated);
  assert.equal(fabricated.coverage, "missing");
  assert.equal(fabricated.discoveryState, "boundary");
  assert.equal(result.graph.evidence.find((item) => fabricated.evidenceIds.includes(item.id))?.sourceType, "model");
  assert.ok(result.graph.concepts.every((concept) => Number.isFinite(concept.depth)));
  assert.ok(result.graph.concepts.every((concept) => concept.depth <= 5));
});

test("OpenAI-compatible adapter parses structured drafts without an SDK dependency", async () => {
  const responseDraft: AgentGraphDraft = {
    scope: "测试领域",
    scopeDescription: "测试",
    concepts: [{ name: "测试领域", semanticType: "domain", granularity: 1, description: "测试", confidence: 1 }],
    relations: [],
  };
  const provider = createOpenAICompatibleKnowledgeModel({
    baseUrl: "http://local.test/v1",
    model: "local-model",
    fetcher: async (input, init) => {
      assert.equal(String(input), "http://local.test/v1/chat/completions");
      assert.equal(init?.method, "POST");
      return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(responseDraft) } }] }), { status: 200, headers: { "content-type": "application/json" } });
    },
  });
  const draft = await provider.analyze({ notes: [await coffeeNote()], spec: { goal: "测试", audience: "测试者", granularity: 3, expansionRadius: 2, maxNodes: 20, confidenceThreshold: 0.58 } });
  assert.equal(draft.scope, "测试领域");
  assert.equal(draft.concepts[0].semanticType, "domain");
});
