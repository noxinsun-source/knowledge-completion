import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import test from "node:test";

test("agent CLI emits a machine-readable graph for a non-Transformer note", async () => {
  const output = await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [
      "--experimental-strip-types",
      "packages/knowledge-agent/src/cli.ts",
      "build",
      "--note", "fixtures/demo/coffee-extraction.md",
      "--goal", "理解手冲咖啡萃取并诊断风味",
      "--granularity", "4",
      "--provider", "heuristic",
    ], { cwd: process.cwd(), stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", (code) => code === 0 ? resolve(stdout) : reject(new Error(stderr || `CLI exited ${code}`)));
  });
  const result = JSON.parse(String(output));
  assert.equal(result.graph.scope, "理解手冲咖啡萃取并诊断风味");
  assert.ok(result.metrics.conceptCount >= 10);
  assert.equal(result.selectedProjection.granularity, 4);
});
