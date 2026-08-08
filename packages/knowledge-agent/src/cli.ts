#!/usr/bin/env -S node --experimental-strip-types

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, dirname, extname, resolve } from "node:path";
import type { MapGranularity, SourceNote } from "../../contracts/src/index.ts";
import { runKnowledgeAgent } from "./agent.ts";
import { createHeuristicKnowledgeModel } from "./heuristic-provider.ts";
import { createOpenAICompatibleModelFromEnvironment } from "./openai-compatible-provider.ts";
import type { AgentGraphDraft, KnowledgeAgentModel } from "./types.ts";

type CliOptions = {
  command: "build" | "help";
  notePaths: string[];
  text?: string;
  title?: string;
  goal?: string;
  audience?: string;
  granularity?: MapGranularity;
  expansionRadius?: 1 | 2 | 3;
  maxNodes?: number;
  confidenceThreshold?: number;
  provider: "auto" | "heuristic" | "openai-compatible";
  draftPath?: string;
  outputPath?: string;
};

function help() {
  return `Knowledge Completion Agent

Usage:
  npm run agent -- build --note <file> --goal <goal> [options]
  npm run agent -- build --text <content> --title <title> --goal <goal> [options]

Options:
  --note <path>                 Add a UTF-8 Markdown or text note; repeatable
  --text <content>              Analyze inline text
  --title <title>               Title for inline text
  --goal <goal>                 Learning or research goal
  --audience <audience>         Intended user
  --granularity <1-5>           Selected projection, default 3
  --hops <1-3>                  Semantic expansion rounds, default 2
  --max-nodes <8-60>            Canonical graph node budget, default 24
  --confidence <0.3-0.95>       Automatic acceptance threshold, default 0.58
  --provider <name>             auto | heuristic | openai-compatible
  --draft <path>                Compile a Codex/model-authored AgentGraphDraft JSON
  --output <path>               Write JSON result instead of stdout
  --help                        Show this help

OpenAI-compatible environment:
  KNOWLEDGE_AGENT_BASE_URL      Example: http://127.0.0.1:11434/v1
  KNOWLEDGE_AGENT_MODEL         Model identifier exposed by the endpoint
  KNOWLEDGE_AGENT_API_KEY       Optional for local endpoints
`;
}

function requireValue(argv: string[], index: number, option: string) {
  const value = argv[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`${option} requires a value.`);
  return value;
}

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = { command: argv[0] === "help" || argv.includes("--help") ? "help" : "build", notePaths: [], provider: "auto" };
  const start = argv[0] === "build" || argv[0] === "help" ? 1 : 0;
  for (let index = start; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--help") { options.command = "help"; continue; }
    if (argument === "--note") { options.notePaths.push(requireValue(argv, index, argument)); index += 1; continue; }
    if (argument === "--text") { options.text = requireValue(argv, index, argument); index += 1; continue; }
    if (argument === "--title") { options.title = requireValue(argv, index, argument); index += 1; continue; }
    if (argument === "--goal") { options.goal = requireValue(argv, index, argument); index += 1; continue; }
    if (argument === "--audience") { options.audience = requireValue(argv, index, argument); index += 1; continue; }
    if (argument === "--granularity") { options.granularity = Number(requireValue(argv, index, argument)) as MapGranularity; index += 1; continue; }
    if (argument === "--hops") { options.expansionRadius = Number(requireValue(argv, index, argument)) as 1 | 2 | 3; index += 1; continue; }
    if (argument === "--max-nodes") { options.maxNodes = Number(requireValue(argv, index, argument)); index += 1; continue; }
    if (argument === "--confidence") { options.confidenceThreshold = Number(requireValue(argv, index, argument)); index += 1; continue; }
    if (argument === "--provider") {
      const provider = requireValue(argv, index, argument);
      if (!new Set(["auto", "heuristic", "openai-compatible"]).has(provider)) throw new Error(`Unknown provider: ${provider}`);
      options.provider = provider as CliOptions["provider"];
      index += 1;
      continue;
    }
    if (argument === "--draft") { options.draftPath = requireValue(argv, index, argument); index += 1; continue; }
    if (argument === "--output") { options.outputPath = requireValue(argv, index, argument); index += 1; continue; }
    if (argument === "build") continue;
    throw new Error(`Unknown argument: ${argument}`);
  }
  return options;
}

function inferTitle(path: string, content: string) {
  const heading = content.match(/^#\s+(.+)$/m)?.[1]?.trim();
  return heading || basename(path, extname(path)).replace(/[-_]+/g, " ");
}

async function loadNotes(options: CliOptions): Promise<SourceNote[]> {
  const today = new Date().toISOString().slice(0, 10);
  const notes = await Promise.all(options.notePaths.map(async (inputPath, index) => {
    const path = resolve(inputPath);
    const content = await readFile(path, "utf8");
    return {
      id: `note_${index + 1}`,
      title: inferTitle(path, content),
      content,
      source: path,
      capturedAt: today,
      confidence: 0.9,
    } satisfies SourceNote;
  }));
  if (options.text) {
    notes.push({
      id: `note_${notes.length + 1}`,
      title: options.title?.trim() || "内联笔记",
      content: options.text,
      source: "CLI 内联输入",
      capturedAt: today,
      confidence: 0.85,
    });
  }
  return notes;
}

function selectProvider(options: CliOptions): KnowledgeAgentModel {
  if (options.provider === "heuristic") return createHeuristicKnowledgeModel();
  if (options.provider === "openai-compatible") return createOpenAICompatibleModelFromEnvironment();
  if (process.env.KNOWLEDGE_AGENT_BASE_URL && process.env.KNOWLEDGE_AGENT_MODEL) {
    return createOpenAICompatibleModelFromEnvironment();
  }
  return createHeuristicKnowledgeModel();
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.command === "help") {
    process.stdout.write(help());
    return;
  }
  const notes = await loadNotes(options);
  if (!notes.length) throw new Error("Provide at least one --note file or --text value.");
  let initialDraft: AgentGraphDraft | undefined;
  if (options.draftPath) initialDraft = JSON.parse(await readFile(resolve(options.draftPath), "utf8")) as AgentGraphDraft;
  const result = await runKnowledgeAgent({
    notes,
    goal: options.goal?.trim() || `系统理解${notes[0].title}`,
    audience: options.audience,
    granularity: options.granularity,
    expansionRadius: options.expansionRadius,
    maxNodes: options.maxNodes,
    confidenceThreshold: options.confidenceThreshold,
    provider: selectProvider(options),
    initialDraft,
  });
  const output = `${JSON.stringify(result, null, 2)}\n`;
  if (options.outputPath) {
    const outputPath = resolve(options.outputPath);
    await mkdir(dirname(outputPath), { recursive: true });
    await writeFile(outputPath, output, "utf8");
    process.stderr.write(`Knowledge graph written to ${outputPath}\n`);
    process.stderr.write(`provider=${result.provider} concepts=${result.metrics.conceptCount} relations=${result.metrics.relationCount} evidence=${result.metrics.evidenceCount}\n`);
  } else {
    process.stdout.write(output);
  }
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
