#!/usr/bin/env node

import { spawn } from "node:child_process";
import { access, mkdir, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, extname, join, parse, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const DEFAULT_BASE_URL = "http://localhost:4318";
const RUNTIME_VERSION = "1.0.1";
const RUNTIME_GIT_URL = "https://github.com/noxinsun-source/knowledge-completion.git";
const EXPECTED_HEALTH = Object.freeze({
  ok: true,
  service: "knowledge-completion-api",
  runApiVersion: "v1",
});
const TERMINAL_STATUSES = new Set(["completed", "partial"]);
const SCRIPT_PATH = fileURLToPath(import.meta.url);

function help() {
  return `Knowledge Completion dashboard client

Usage:
  node submit-run.mjs --note <file> --goal <goal> [options]
  node submit-run.mjs --text <content> --title <title> --goal <goal> [options]
  printf '%s' '<content>' | node submit-run.mjs --stdin --title <title> --goal <goal> [options]

Options:
  --note <path>             UTF-8 Markdown or text note; repeatable
  --text <content>          Analyze pasted text
  --stdin                   Read one note body from standard input
  --title <title>           Title for --text or --stdin
  --goal <goal>             Learning or research goal
  --audience <audience>     Intended learner
  --granularity <1-5>       Selected graph projection, default 3
  --hops <1-3>              Expansion radius, default 2
  --max-nodes <8-60>        Canonical graph node budget, default 24
  --confidence <0.3-0.95>   Acceptance threshold, default 0.58
  --draft <path>            Optional AgentGraphDraft JSON
  --base-url <url>          Product origin; defaults to KNOWLEDGE_COMPLETION_BASE_URL or ${DEFAULT_BASE_URL}
  --allow-remote-upload     Explicitly allow note text to leave this machine
  --runtime-root <path>     Full knowledge-completion checkout to start when needed
  --bootstrap-runtime      Clone the pinned v${RUNTIME_VERSION} runtime when no checkout exists
  --install-dependencies    Run npm install in a detected runtime when dependencies are absent
  --no-start                Do not start a detected local runtime
  --no-open                 Return the dashboard URL without opening a browser
  --wait-seconds <5-120>    Local startup timeout, default 45
  --help                    Show this help
`;
}

function requireValue(argv, index, option) {
  const value = argv[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`${option} requires a value.`);
  return value;
}

function numberInRange(raw, option, minimum, maximum, { integer = false } = {}) {
  const value = Number(raw);
  if (!Number.isFinite(value) || value < minimum || value > maximum) {
    throw new RangeError(`${option} must be between ${minimum} and ${maximum}.`);
  }
  if (integer && !Number.isInteger(value)) {
    throw new TypeError(`${option} must be an integer.`);
  }
  return value;
}

function parseArgs(argv) {
  const options = {
    notePaths: [],
    baseUrl: process.env.KNOWLEDGE_COMPLETION_BASE_URL || DEFAULT_BASE_URL,
    shouldStart: true,
    shouldOpen: true,
    installDependencies: false,
    waitSeconds: 45,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "run") continue;
    if (argument === "--help") { options.help = true; continue; }
    if (argument === "--note") { options.notePaths.push(requireValue(argv, index, argument)); index += 1; continue; }
    if (argument === "--text") { options.text = requireValue(argv, index, argument); index += 1; continue; }
    if (argument === "--stdin") { options.stdin = true; continue; }
    if (argument === "--title") { options.title = requireValue(argv, index, argument); index += 1; continue; }
    if (argument === "--goal") { options.goal = requireValue(argv, index, argument); index += 1; continue; }
    if (argument === "--audience") { options.audience = requireValue(argv, index, argument); index += 1; continue; }
    if (argument === "--granularity") { options.granularity = numberInRange(requireValue(argv, index, argument), argument, 1, 5, { integer: true }); index += 1; continue; }
    if (argument === "--hops") { options.expansionRadius = numberInRange(requireValue(argv, index, argument), argument, 1, 3, { integer: true }); index += 1; continue; }
    if (argument === "--max-nodes") { options.maxNodes = numberInRange(requireValue(argv, index, argument), argument, 8, 60, { integer: true }); index += 1; continue; }
    if (argument === "--confidence") { options.confidenceThreshold = numberInRange(requireValue(argv, index, argument), argument, 0.3, 0.95); index += 1; continue; }
    if (argument === "--draft") { options.draftPath = requireValue(argv, index, argument); index += 1; continue; }
    if (argument === "--base-url") { options.baseUrl = requireValue(argv, index, argument); index += 1; continue; }
    if (argument === "--allow-remote-upload") { options.allowRemoteUpload = true; continue; }
    if (argument === "--runtime-root") { options.runtimeRoot = requireValue(argv, index, argument); index += 1; continue; }
    if (argument === "--bootstrap-runtime") { options.bootstrapRuntime = true; continue; }
    if (argument === "--wait-seconds") { options.waitSeconds = numberInRange(requireValue(argv, index, argument), argument, 5, 120, { integer: true }); index += 1; continue; }
    if (argument === "--install-dependencies") { options.installDependencies = true; continue; }
    if (argument === "--no-start") { options.shouldStart = false; continue; }
    if (argument === "--no-open") { options.shouldOpen = false; continue; }
    throw new Error(`Unknown argument: ${argument}`);
  }
  if (options.text !== undefined && options.stdin) {
    throw new Error("Use either --text or --stdin, not both.");
  }
  return options;
}

function normalizeBaseUrl(value) {
  const url = new URL(value);
  if (!new Set(["http:", "https:"]).has(url.protocol)) throw new Error("--base-url must use http or https.");
  if (url.username || url.password) throw new Error("--base-url must not contain credentials.");
  url.pathname = url.pathname.replace(/\/+$/, "");
  url.search = "";
  url.hash = "";
  return url;
}

function isLocalUrl(baseUrl) {
  const host = baseUrl.hostname.replace(/^\[|\]$/g, "").replace(/\.$/, "").toLowerCase();
  return new Set(["localhost", "127.0.0.1", "::1"]).has(host);
}

function inferTitle(path, content) {
  return content.match(/^#\s+(.+)$/m)?.[1]?.trim() || basename(path, extname(path)).replace(/[-_]+/g, " ");
}

async function loadNotes(options) {
  const capturedAt = new Date().toISOString();
  const notes = await Promise.all(options.notePaths.map(async (inputPath, index) => {
    const path = resolve(inputPath);
    const content = await readFile(path, "utf8");
    return {
      id: `note_${index + 1}`,
      title: inferTitle(path, content),
      content,
      source: basename(path),
      capturedAt,
      confidence: 0.9,
    };
  }));
  if (options.text) {
    notes.push({
      id: `note_${notes.length + 1}`,
      title: options.title?.trim() || "内联笔记",
      content: options.text,
      source: "inline.txt",
      capturedAt,
      confidence: 0.85,
    });
  }
  if (options.stdin) {
    let content = "";
    for await (const chunk of process.stdin) content += chunk;
    if (!content.trim()) throw new Error("--stdin received an empty note body.");
    notes.push({
      id: `note_${notes.length + 1}`,
      title: options.title?.trim() || "标准输入笔记",
      content,
      source: "stdin.txt",
      capturedAt,
      confidence: 0.85,
    });
  }
  if (!notes.length) throw new Error("Provide at least one --note file, --text value, or --stdin body.");
  return notes;
}

async function fileExists(path) {
  try { await access(path); return true; } catch { return false; }
}

async function isRuntimeRoot(path) {
  try {
    const manifest = JSON.parse(await readFile(join(path, "package.json"), "utf8"));
    const plugin = JSON.parse(await readFile(join(path, "plugins", "knowledge-completion", ".codex-plugin", "plugin.json"), "utf8"));
    return manifest.name === "knowledge-completion"
      && plugin.name === "knowledge-completion"
      && await fileExists(join(path, "packages", "knowledge-agent", "src", "cli.ts"))
      && await fileExists(join(path, "plugins", "knowledge-completion", "skills", "knowledge-completion", "scripts", "submit-run.mjs"));
  } catch { return false; }
}

function ancestorPaths(seed) {
  const paths = [];
  let current = resolve(seed);
  const root = parse(current).root;
  while (true) {
    paths.push(current);
    if (current === root) return paths;
    current = dirname(current);
  }
}

function defaultBootstrapRoot() {
  return join(homedir(), ".local", "share", "knowledge-completion", "runtime", RUNTIME_VERSION);
}

async function bootstrapRuntime() {
  const target = defaultBootstrapRoot();
  if (await fileExists(target)) {
    if (!await isRuntimeRoot(target)) {
      throw new Error(`Bootstrap destination ${target} already exists but is not a verified Knowledge Completion runtime. Move it aside or set --runtime-root to a trusted checkout; the helper will not overwrite it.`);
    }
    return target;
  }
  await mkdir(dirname(target), { recursive: true });
  process.stderr.write(`Cloning pinned Knowledge Completion runtime v${RUNTIME_VERSION} into ${target}...\n`);
  await runProcess("git", [
    "clone",
    "--depth", "1",
    "--branch", `v${RUNTIME_VERSION}`,
    "--single-branch",
    RUNTIME_GIT_URL,
    target,
  ], { stdio: "inherit", env: process.env });
  if (!await isRuntimeRoot(target)) {
    throw new Error(`The cloned runtime at ${target} failed package and plugin identity verification.`);
  }
  return target;
}

async function findRuntimeRoot(explicitRoot, allowBootstrap) {
  const configuredRoot = explicitRoot || process.env.KNOWLEDGE_COMPLETION_ROOT;
  if (configuredRoot) {
    const candidate = resolve(configuredRoot);
    if (!await isRuntimeRoot(candidate)) {
      throw new Error(`Configured runtime root ${candidate} is not a verified Knowledge Completion checkout (package and plugin manifests must both identify knowledge-completion).`);
    }
    return candidate;
  }
  for (const candidate of ancestorPaths(dirname(SCRIPT_PATH))) {
    if (await isRuntimeRoot(candidate)) return candidate;
  }
  if (allowBootstrap) return bootstrapRuntime();
  return undefined;
}

function isLocalRuntimeUrl(baseUrl) {
  return isLocalUrl(baseUrl) && (!baseUrl.port || baseUrl.port === "4318");
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function probeService(baseUrl) {
  const endpoint = new URL("/api/health", baseUrl);
  try {
    const response = await fetch(endpoint, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(2_000) });
    const raw = await response.text();
    let body;
    try { body = raw ? JSON.parse(raw) : undefined; } catch {
      return { state: "incompatible", detail: `${endpoint} returned non-JSON data (HTTP ${response.status}).` };
    }
    if (!response.ok) {
      return { state: "incompatible", detail: `${endpoint} is unhealthy (HTTP ${response.status}).` };
    }
    if (!isRecord(body)
      || body.ok !== EXPECTED_HEALTH.ok
      || body.service !== EXPECTED_HEALTH.service
      || body.runApiVersion !== EXPECTED_HEALTH.runApiVersion) {
      return {
        state: "incompatible",
        detail: `${endpoint} is not Knowledge Completion Run API v1; expected {ok:true, service:"${EXPECTED_HEALTH.service}", runApiVersion:"${EXPECTED_HEALTH.runApiVersion}"}.`,
      };
    }
    return { state: "ready" };
  } catch (error) {
    return { state: "unavailable", detail: error instanceof Error ? error.message : String(error) };
  }
}

function runProcess(command, args, options) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, options);
    child.once("error", reject);
    child.once("exit", (code, signal) => code === 0 ? resolvePromise() : reject(new Error(`${command} exited with ${code ?? signal}.`)));
  });
}

async function ensureDependencies(runtimeRoot, allowInstall) {
  const executable = process.platform === "win32" ? "vinext.cmd" : "vinext";
  if (await fileExists(join(runtimeRoot, "node_modules", ".bin", executable))) return;
  if (!allowInstall) {
    throw new Error(`Knowledge Completion runtime found at ${runtimeRoot}, but dependencies are absent. After approving the dependency download, rerun with --install-dependencies, or run npm install in that exact directory.`);
  }
  process.stderr.write(`Installing Knowledge Completion runtime dependencies in ${runtimeRoot}...\n`);
  await runProcess(process.platform === "win32" ? "npm.cmd" : "npm", ["install", "--no-audit", "--no-fund"], { cwd: runtimeRoot, stdio: "inherit", env: process.env });
}

function startRuntime(runtimeRoot) {
  const child = spawn(process.platform === "win32" ? "npm.cmd" : "npm", ["run", "dev"], { cwd: runtimeRoot, detached: true, stdio: "ignore", env: process.env });
  child.once("error", () => {});
  child.unref();
}

async function waitForRuntime(baseUrl, waitSeconds) {
  const deadline = Date.now() + waitSeconds * 1_000;
  while (Date.now() < deadline) {
    const probe = await probeService(baseUrl);
    if (probe.state === "ready") return true;
    if (probe.state === "incompatible") throw new Error(probe.detail);
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 500));
  }
  return false;
}

async function ensureService(options, baseUrl) {
  const probe = await probeService(baseUrl);
  if (probe.state === "ready") return { started: false };
  if (probe.state === "incompatible") throw new Error(probe.detail);
  if (!options.shouldStart) throw new Error(`Knowledge Completion API is unavailable at ${baseUrl.origin}. Start the product runtime or remove --no-start.`);
  if (!isLocalRuntimeUrl(baseUrl)) throw new Error(`Cannot automatically start non-local service ${baseUrl.origin}. Verify KNOWLEDGE_COMPLETION_BASE_URL and start that trusted deployment.`);
  const runtimeRoot = await findRuntimeRoot(options.runtimeRoot, options.bootstrapRuntime);
  if (!runtimeRoot) throw new Error("Knowledge Completion API is unavailable and no verified runtime was found. After approving a pinned Git clone and dependency download, rerun with --bootstrap-runtime --install-dependencies; alternatively clone the repository yourself and set KNOWLEDGE_COMPLETION_ROOT.");
  await ensureDependencies(runtimeRoot, options.installDependencies);
  process.stderr.write(`Starting Knowledge Completion runtime from ${runtimeRoot}...\n`);
  startRuntime(runtimeRoot);
  if (!await waitForRuntime(baseUrl, options.waitSeconds)) throw new Error(`Runtime did not become healthy at ${baseUrl.origin} within ${options.waitSeconds} seconds. Run npm run dev in ${runtimeRoot} and inspect its terminal output.`);
  return { started: true, runtimeRoot };
}

function requireSameOriginHttpUrl(value, label, baseUrl) {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${label} must be a non-empty URL.`);
  let url;
  try { url = new URL(value, baseUrl); } catch { throw new Error(`${label} must be a valid URL.`); }
  if (!new Set(["http:", "https:"]).has(url.protocol)) throw new Error(`${label} must use http or https.`);
  if (url.origin !== baseUrl.origin) throw new Error(`${label} must have the same origin as ${baseUrl.origin}.`);
  return url.toString();
}

function requireFormalRun(value, label) {
  if (!isRecord(value)) throw new Error(`${label} must be an object.`);
  if (typeof value.runId !== "string" || !/^agent_run_[a-zA-Z0-9]+$/.test(value.runId)) {
    throw new Error(`${label}.runId is not a valid persisted Agent Run id.`);
  }
  if (typeof value.status !== "string" || !TERMINAL_STATUSES.has(value.status)) {
    throw new Error(`${label}.status must be completed or partial.`);
  }
  if (!isRecord(value.result)) throw new Error(`${label}.result must be an Agent result object.`);
  if (value.result.runId !== value.runId) throw new Error(`${label}.result.runId must match ${label}.runId.`);
  if (value.result.status !== value.status) throw new Error(`${label}.result.status must match ${label}.status.`);
  return value;
}

function parseJsonResponse(raw, endpoint, status) {
  try { return raw ? JSON.parse(raw) : {}; } catch {
    throw new Error(`${endpoint} returned non-JSON data (HTTP ${status}).`);
  }
}

async function readPersistedRun(baseUrl, runId, postedRun) {
  const endpoint = new URL(`/api/runs/${encodeURIComponent(runId)}`, baseUrl);
  const response = await fetch(endpoint, {
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(30_000),
  });
  const body = parseJsonResponse(await response.text(), endpoint, response.status);
  if (!response.ok) throw new Error(`GET ${endpoint} failed while confirming persistence (HTTP ${response.status}).`);
  if (!isRecord(body) || !("run" in body)) throw new Error(`GET ${endpoint} did not return {run}.`);
  const persistedRun = requireFormalRun(body.run, "GET /api/runs/:runId response.run");
  if (persistedRun.runId !== runId || persistedRun.status !== postedRun.status) {
    throw new Error("Persisted Agent Run does not match the POST response.");
  }
  if (JSON.stringify(persistedRun.result) !== JSON.stringify(postedRun.result)) {
    throw new Error("Persisted Agent result does not match the POST response.");
  }
  return { run: persistedRun, endpoint: endpoint.toString() };
}

async function createRun(baseUrl, payload) {
  const endpoint = new URL("/api/runs", baseUrl);
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { accept: "application/json", "content-type": "application/json" },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(120_000),
  });
  const body = parseJsonResponse(await response.text(), endpoint, response.status);
  if (!response.ok) {
    const detail = body.error?.message ?? body.error ?? body.message ?? `HTTP ${response.status}`;
    throw new Error(`Knowledge Completion run failed: ${detail}`);
  }
  if (response.status !== 201) throw new Error(`POST ${endpoint} must return HTTP 201, received ${response.status}.`);
  if (!isRecord(body) || !("run" in body)) throw new Error("POST /api/runs did not return {run, dashboardUrl, eventsUrl}.");
  const postedRun = requireFormalRun(body.run, "POST /api/runs response.run");
  const dashboardUrl = requireSameOriginHttpUrl(body.dashboardUrl, "dashboardUrl", baseUrl);
  const eventsUrl = requireSameOriginHttpUrl(body.eventsUrl, "eventsUrl", baseUrl);
  const persisted = await readPersistedRun(baseUrl, postedRun.runId, postedRun);
  return {
    run: persisted.run,
    runId: persisted.run.runId,
    dashboardUrl,
    eventsUrl,
    endpoint: endpoint.toString(),
    persistedRunUrl: persisted.endpoint,
  };
}

function openDashboard(url) {
  const command = process.platform === "darwin" ? "open" : process.platform === "win32" ? "rundll32.exe" : "xdg-open";
  const args = process.platform === "win32" ? ["url.dll,FileProtocolHandler", url] : [url];
  const child = spawn(command, args, { detached: true, stdio: "ignore" });
  child.once("error", () => {});
  child.unref();
}

function summarizeResult(result) {
  const projections = isRecord(result.projections) ? result.projections : {};
  const projectionCounts = Object.fromEntries([1, 2, 3, 4, 5].map((granularity) => {
    const projection = projections[granularity];
    return [granularity, isRecord(projection) && Array.isArray(projection.nodes) ? projection.nodes.length : 0];
  }));
  const concepts = isRecord(result.graph) && Array.isArray(result.graph.concepts)
    ? result.graph.concepts
    : [];
  const boundaryConcepts = concepts
    .filter((concept) => isRecord(concept) && (concept.discoveryState === "boundary" || concept.coverage === "missing"))
    .map((concept) => ({
      id: typeof concept.id === "string" ? concept.id : null,
      name: typeof concept.name === "string" ? concept.name : null,
      granularity: typeof concept.granularity === "number" ? concept.granularity : null,
      coverage: typeof concept.coverage === "string" ? concept.coverage : null,
    }));
  const trace = Array.isArray(result.trace) ? result.trace : [];
  const stopReason = [...trace].reverse().find((round) => isRecord(round) && typeof round.stopReason === "string")?.stopReason ?? null;
  return {
    metrics: isRecord(result.metrics) ? result.metrics : null,
    warnings: Array.isArray(result.warnings) ? result.warnings : [],
    projectionCounts,
    boundaryConcepts,
    stopReason,
  };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) { process.stdout.write(help()); return; }
  const baseUrl = normalizeBaseUrl(options.baseUrl);
  if (!isLocalUrl(baseUrl) && !options.allowRemoteUpload) {
    throw new Error(`Refusing to upload note text to non-local origin ${baseUrl.origin}. Re-run with --allow-remote-upload only after verifying and trusting that service.`);
  }
  const notes = await loadNotes(options);
  const initialDraft = options.draftPath ? JSON.parse(await readFile(resolve(options.draftPath), "utf8")) : undefined;
  const service = await ensureService(options, baseUrl);
  const created = await createRun(baseUrl, {
    notes,
    goal: options.goal?.trim() || `系统理解${notes[0].title}`,
    audience: options.audience,
    granularity: options.granularity,
    expansionRadius: options.expansionRadius,
    maxNodes: options.maxNodes,
    confidenceThreshold: options.confidenceThreshold,
    initialDraft,
  });
  if (options.shouldOpen) openDashboard(created.dashboardUrl);
  const result = created.run.result;
  const summary = summarizeResult(result);
  process.stdout.write(`${JSON.stringify({
    runId: created.runId,
    status: created.run.status,
    provider: result.provider,
    dashboardUrl: created.dashboardUrl,
    eventsUrl: created.eventsUrl,
    apiUrl: created.endpoint,
    persistedRunUrl: created.persistedRunUrl,
    ...summary,
    runtimeStarted: service.started,
    runtimeRoot: service.runtimeRoot,
    browserOpenRequested: options.shouldOpen,
  }, null, 2)}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
