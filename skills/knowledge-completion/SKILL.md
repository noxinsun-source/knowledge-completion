---
name: knowledge-completion
description: Build an evidence-backed, multi-granularity knowledge graph from notes, persist it as an Agent Run, and open the interactive dashboard. Use for concepts, adjacent knowledge, gaps, 1-5 projections, visual knowledge networks, or the Knowledge Completion CLI and Run API.
---

# Knowledge Completion

Build a goal-relative knowledge graph from one or more notes. Keep note evidence, model proposals, and external evidence distinguishable. Never present an unsupported adjacent concept as learned or verified.

## Locate the runtime

Work from the repository root containing `packages/knowledge-agent/src/cli.ts` and a `package.json` whose name is `knowledge-completion`. Do not install dependencies for a normal run.

Read [references/dashboard-api.md](references/dashboard-api.md) before submitting a run. Read [references/agent-schema.md](references/agent-schema.md) before authoring a draft or interpreting relation direction. Input IDs are deterministic: repeated `--note` arguments map to `note_1`, `note_2`, and so on in command-line order; `--text` or `--stdin` receives the next number. Use those exact IDs in draft evidence.

## Choose a mode

Use the first applicable mode:

1. **Host-native model draft**: when adjacent knowledge or gaps are requested, use the current host model to author an `AgentGraphDraft`, then submit it with `--draft`. Concepts outside the notes must have `evidence: []` and confidence no higher than `0.78`.
2. **Strict offline evidence graph**: when the user requests only extraction, omit the draft. State that `heuristic-offline-v1` extracts only concepts and relations supported by the input text.

The repository CLI separately supports configured OpenAI-compatible endpoints, but do not imply that the HTTP Run service calls such an endpoint. A visual semantic-expansion Run needs a host-authored `initialDraft` in the current release.

## Create a persistent visual run

Prefer the Run API so every invocation has a durable `runId` and a directly accessible product page. From the repository root, run:

```bash
node plugins/knowledge-completion/skills/knowledge-completion/scripts/submit-run.mjs \
  --note path/to/note.md \
  --goal "user learning goal" \
  --audience "target learner" \
  --granularity 4 \
  --hops 2 \
  --max-nodes 36
```

The helper checks the service identity, calls `POST /api/runs`, then performs `GET /api/runs/:runId` and compares the stored result before printing `runId` and `dashboardUrl`. It opens `/runs/:runId` by default. Require both values before reporting success. Use `KNOWLEDGE_COMPLETION_BASE_URL` only for a trusted service; a non-local endpoint additionally requires explicit `--allow-remote-upload` because it receives complete note text.

If the runtime is unavailable, do not run an install silently. After the user approves the dependency download, rerun with `--install-dependencies`, or ask them to start `npm run dev` in the verified repository root. The plugin declares no MCP server or public SaaS.

## CLI fallback

Use the CLI only when the product service cannot be started and the user accepts a JSON result without a dashboard page:

```bash
npm run agent -- build \
  --note path/to/note.md \
  --goal "user learning goal" \
  --audience "target learner" \
  --granularity 4 \
  --hops 2 \
  --max-nodes 36 \
  --provider auto \
  --output artifacts/agent-runs/result.json
```

For a host-authored draft:

1. Read every input note completely.
2. Define the root scope relative to the user's goal.
3. Quote exact excerpts for note-backed concepts and relations.
4. Add only goal-relevant adjacent concepts.
5. Keep unsupported concepts evidence-free and mark them as boundary candidates.
6. Save the JSON under `artifacts/agent-runs/` and run the same command with `--draft <path>`.

When using the persistent dashboard helper, pass that same draft with `--draft <path>`. If the user requests adjacent knowledge or gaps and no configured model endpoint exists, do not silently fall back to a note-only heuristic graph: author the bounded draft first so the compiler can preserve evidence-free concepts as gray boundary/missing nodes. Keep their confidence at or below `0.78`.

## Quality gates

Before reporting success:

- Confirm every relation endpoint exists.
- Confirm every note evidence excerpt occurs verbatim in its source note.
- Confirm projection node counts are monotonic from granularity 1 through 5.
- Confirm the selected projection matches the requested granularity.
- Inspect `trace[].stopReason`, `warnings`, and `status`.
- Distinguish note-backed knowledge from model-proposed boundary knowledge.
- Run `npm run test:agent` after changing the Agent or this workflow.

## Report

Return the result path, provider, graph counts, projection counts, stop reason, warnings, and unresolved boundary concepts. State whether the run was offline, host-native, or model-backed.
