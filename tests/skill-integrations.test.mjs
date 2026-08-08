import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

async function read(relativePath) {
  return readFile(resolve(root, relativePath), "utf8");
}

test("portable Agent Skill adapters point to one vendor-neutral source", async () => {
  const canonical = await read("skills/knowledge-completion/SKILL.md");
  const schema = await read("skills/knowledge-completion/references/agent-schema.md");
  const dashboardApi = await read("skills/knowledge-completion/references/dashboard-api.md");
  const pluginSkill = await read("plugins/knowledge-completion/skills/knowledge-completion/SKILL.md");
  const codex = await read(".agents/skills/knowledge-completion/SKILL.md");
  const claude = await read(".claude/skills/knowledge-completion/SKILL.md");
  const cursor = await read(".cursor/rules/knowledge-completion-agent.mdc");
  const agents = await read("AGENTS.md");

  assert.match(canonical, /^---\nname: knowledge-completion\ndescription: [^\n]+\n---/);
  assert.match(canonical, /references\/agent-schema\.md/);
  assert.match(schema, /"concepts"/);
  assert.match(dashboardApi, /GET \/api\/runs\/:runId/);
  assert.match(pluginSkill, /GET \/api\/runs\/:runId/);
  assert.match(pluginSkill, /--allow-remote-upload/);
  assert.match(codex, /skills\/knowledge-completion\/SKILL\.md/);
  assert.match(claude, /skills\/knowledge-completion\/SKILL\.md/);
  assert.match(cursor, /^---[\s\S]*description:[\s\S]*alwaysApply: false[\s\S]*---/);
  assert.match(agents, /skills\/knowledge-completion\/SKILL\.md/);
});

test("all host adapter files are present in the repository", async () => {
  for (const relativePath of [
    "skills/knowledge-completion/SKILL.md",
    "skills/knowledge-completion/references/agent-schema.md",
    "skills/knowledge-completion/references/dashboard-api.md",
    "plugins/knowledge-completion/skills/knowledge-completion/scripts/submit-run.mjs",
    ".agents/skills/knowledge-completion/SKILL.md",
    ".claude/skills/knowledge-completion/SKILL.md",
    ".cursor/rules/knowledge-completion-agent.mdc",
    "AGENTS.md",
  ]) {
    await access(resolve(root, relativePath));
  }
});
