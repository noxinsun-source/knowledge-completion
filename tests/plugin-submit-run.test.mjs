import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const helper = resolve(
  root,
  "plugins/knowledge-completion/skills/knowledge-completion/scripts/submit-run.mjs",
);

function runHelper(args) {
  return new Promise((resolveRun, reject) => {
    const child = spawn(process.execPath, [helper, ...args], {
      cwd: root,
      env: { ...process.env, KNOWLEDGE_COMPLETION_BASE_URL: "" },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.once("error", reject);
    child.once("exit", (code) => resolveRun({ code, stdout, stderr }));
  });
}

async function withServer(handler, callback) {
  const server = createServer(handler);
  await new Promise((resolveListen) => server.listen(0, "127.0.0.1", resolveListen));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("test server did not expose a TCP port");
  try {
    return await callback(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise((resolveClose, reject) => server.close((error) => error ? reject(error) : resolveClose()));
  }
}

function json(response, status, body) {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(body));
}

function formalRun(runId = "agent_run_plugin001") {
  const result = {
    runId,
    status: "partial",
    provider: "host-native-draft-v1",
    graph: { concepts: [], relations: [], evidence: [] },
    projections: {},
    trace: [{ stopReason: "frontier-exhausted" }],
    warnings: ["test warning"],
    metrics: { conceptCount: 0, relationCount: 0, evidenceCount: 0, durationMs: 2 },
  };
  return { runId, status: "partial", result };
}

test("plugin helper rejects fractional integer options before contacting a service", async () => {
  const response = await runHelper([
    "--text", "# 测试笔记",
    "--goal", "测试参数",
    "--granularity", "2.5",
    "--no-start",
    "--no-open",
  ]);
  assert.equal(response.code, 1);
  assert.match(response.stderr, /--granularity must be an integer/);
});

test("plugin helper exposes only an explicit version-pinned runtime bootstrap", async () => {
  const response = await runHelper(["--help"]);
  const source = await readFile(helper, "utf8");
  assert.equal(response.code, 0);
  assert.match(response.stdout, /--bootstrap-runtime/);
  assert.match(source, /const RUNTIME_VERSION = "1\.0\.1"/);
  assert.match(source, /"--branch", `v\$\{RUNTIME_VERSION\}`/);
  assert.match(source, /already exists but is not a verified Knowledge Completion runtime/);
  assert.doesNotMatch(source, /\.codex\/.+marketplace/);
});

test("plugin helper verifies the service identity instead of trusting any healthy endpoint", async () => {
  let postCount = 0;
  await withServer((request, response) => {
    if (request.url === "/api/health") return json(response, 200, { ok: true });
    postCount += 1;
    return json(response, 500, { error: "must not be called" });
  }, async (baseUrl) => {
    const result = await runHelper([
      "--text", "# 测试笔记",
      "--goal", "测试服务身份",
      "--base-url", baseUrl,
      "--no-start",
      "--no-open",
    ]);
    assert.equal(result.code, 1);
    assert.match(result.stderr, /not Knowledge Completion Run API v1/);
    assert.equal(postCount, 0);
  });
});

test("plugin helper accepts only a persisted canonical run and reports its dashboard", async () => {
  const run = formalRun();
  let postedPayload;
  let getCount = 0;
  await withServer((request, response) => {
    if (request.url === "/api/health") {
      return json(response, 200, { ok: true, service: "knowledge-completion-api", runApiVersion: "v1" });
    }
    if (request.method === "POST" && request.url === "/api/runs") {
      let body = "";
      request.on("data", (chunk) => { body += chunk; });
      request.on("end", () => {
        postedPayload = JSON.parse(body);
        const origin = `http://${request.headers.host}`;
        json(response, 201, {
          run,
          dashboardUrl: `${origin}/runs/${run.runId}`,
          eventsUrl: `${origin}/api/runs/${run.runId}/events`,
        });
      });
      return;
    }
    if (request.method === "GET" && request.url === `/api/runs/${run.runId}`) {
      getCount += 1;
      return json(response, 200, { run });
    }
    return json(response, 404, { error: "not found" });
  }, async (baseUrl) => {
    const response = await runHelper([
      "--text", "# 测试笔记\n\n这是正文。",
      "--title", "测试笔记",
      "--goal", "生成持久化图谱",
      "--base-url", baseUrl,
      "--no-start",
      "--no-open",
    ]);
    assert.equal(response.code, 0, response.stderr);
    const output = JSON.parse(response.stdout);
    assert.equal(output.runId, run.runId);
    assert.equal(output.status, "partial");
    assert.equal(output.persistedRunUrl, `${baseUrl}/api/runs/${run.runId}`);
    assert.equal(output.dashboardUrl, `${baseUrl}/runs/${run.runId}`);
    assert.deepEqual(output.warnings, ["test warning"]);
    assert.equal(output.stopReason, "frontier-exhausted");
    assert.equal(getCount, 1);
    assert.equal(postedPayload.notes[0].id, "note_1");
    assert.equal(postedPayload.notes[0].source, "inline.txt");
  });
});

test("plugin helper refuses to announce success when the run cannot be read back", async () => {
  const run = formalRun("agent_run_unpersisted001");
  await withServer((request, response) => {
    if (request.url === "/api/health") {
      return json(response, 200, { ok: true, service: "knowledge-completion-api", runApiVersion: "v1" });
    }
    if (request.method === "POST" && request.url === "/api/runs") {
      const origin = `http://${request.headers.host}`;
      return json(response, 201, {
        run,
        dashboardUrl: `${origin}/runs/${run.runId}`,
        eventsUrl: `${origin}/api/runs/${run.runId}/events`,
      });
    }
    return json(response, 404, { error: "not persisted" });
  }, async (baseUrl) => {
    const response = await runHelper([
      "--text", "# 测试笔记",
      "--goal", "验证持久化",
      "--base-url", baseUrl,
      "--no-start",
      "--no-open",
    ]);
    assert.equal(response.code, 1);
    assert.match(response.stderr, /confirming persistence/);
  });
});

test("plugin helper blocks note upload to a remote origin without explicit consent", async () => {
  const response = await runHelper([
    "--text", "私有笔记正文",
    "--goal", "隐私边界",
    "--base-url", "https://example.invalid",
    "--no-start",
    "--no-open",
  ]);
  assert.equal(response.code, 1);
  assert.match(response.stderr, /Refusing to upload note text to non-local origin/);
});
