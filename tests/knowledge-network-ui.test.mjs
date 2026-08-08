import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const component = await readFile(new URL("../apps/web/src/components/KnowledgeNetworkApp.tsx", import.meta.url), "utf8");
const runComponent = await readFile(new URL("../apps/web/src/components/AgentRunNetworkApp.tsx", import.meta.url), "utf8");
const runStyles = await readFile(new URL("../apps/web/src/components/agent-run-network.css", import.meta.url), "utf8");

test("MapSpec range handlers capture values before React state updates", () => {
  assert.doesNotMatch(component, /onInput=\{\(event\).*currentTarget\.value/);
  assert.match(component, /const granularity = Number\(event\.currentTarget\.value\)/);
  assert.match(component, /const expansionRadius = Number\(event\.currentTarget\.value\)/);
  assert.match(component, /const maxNodes = Number\(event\.currentTarget\.value\)/);
  assert.match(component, /const confidenceThreshold = Number\(event\.currentTarget\.value\)/);
});

test("MapSpec renders measurable granularity feedback", () => {
  assert.match(component, /当前视图：\{GRANULARITY_LABELS\[mapSpec\.granularity\]\}/);
  assert.match(component, /仓库证据覆盖 \{granularityCoverage\}%/);
});

test("knowledge nodes expose note-relative coverage and live web discovery", () => {
  assert.match(component, /coverageState: "covered"/);
  assert.match(component, /coverageState: "uncovered"/);
  assert.match(component, /本笔记已覆盖/);
  assert.match(component, /本笔记未覆盖/);
  assert.match(component, /联网搜索这个知识点/);
  assert.match(component, /fetch\("\/api\/discovery\/search"/);
  assert.match(component, /在原网页中打开/);
});

test("persisted run accepts only the formal { run } response envelope", () => {
  assert.match(runComponent, /const candidate = envelope\.run/);
  assert.doesNotMatch(runComponent, /envelope\.(?:result|data|record)/);
  assert.doesNotMatch(runComponent, /payload\?\.run\s*\?\?/);
});

test("the center point is the starting note while concept nodes remain unchanged", () => {
  assert.match(runComponent, /const displayName = isRoot \? result\.notes\[0\]\?\.title \|\| "起始笔记" : node\.name/);
  assert.match(runComponent, /<RunStartingNotePreview run=\{result\} \/>/);
  assert.match(runComponent, /<RunNodePreview node=\{node\} \/>/);
  assert.match(runComponent, /共 \{run\.notes\.length\} 篇输入笔记/);
  assert.match(runComponent, /点击阅读完整正文/);
});

test("the starting-note dialog renders every persisted note body and keeps the 70 percent panel", () => {
  assert.match(runComponent, /run\.notes\.map\(\(note, index\) =>/);
  assert.match(runComponent, /\{note\.content \|\| "这篇笔记暂无正文内容。"\}/);
  assert.match(runComponent, /window\.setTimeout\(onClose, 220\)/);
  assert.match(runStyles, /\.run-detail-panel \{[^}]*width: 70vw;/);
  assert.match(runStyles, /\.run-starting-note-sections > article > div \{[^}]*white-space: pre-wrap;/);
});

test("web discovery stays attached to ordinary concept details", () => {
  const startingNoteDetail = runComponent.slice(
    runComponent.indexOf("function RunStartingNoteDetail"),
    runComponent.indexOf("function RunNodeDetail"),
  );
  assert.match(runComponent, /function RunNodeDetail\([\s\S]*联网搜索这个概念/);
  assert.match(runComponent, /<RunKnowledgeSearchDrawer key=\{searchNode\.id\}/);
  assert.match(runComponent, /const initialQuery = node\.aliases\.find/);
  assert.match(runComponent, /query: initialQuery/);
  assert.doesNotMatch(startingNoteDetail, /run-web-search-action/);
});
