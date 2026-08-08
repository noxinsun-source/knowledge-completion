---
name: knowledge-completion
description: Create a persistent, evidence-backed, multi-granularity knowledge graph from Markdown, text notes, or pasted content and open its interactive Knowledge Completion dashboard. Use when a user asks Codex to complete knowledge, find adjacent concepts or gaps, vary graph granularity, submit a note to the product, create a runId, or visualize a note as a knowledge network.
---

# Knowledge Completion

Create one durable Agent Run per invocation. The finished artifact is not merely JSON: it is a `runId` plus an interactive `/runs/:runId` product page.

Keep note evidence, model proposals, and external evidence distinct. Never present an unsupported adjacent concept as covered, understood, or verified.

## Primary workflow

1. Read every requested note completely. Accept Markdown, plain text, or pasted text.
2. Infer a concise learning goal only when the user did not provide one. Preserve explicit audience, granularity, hop count, node budget, and confidence threshold.
3. Read [references/dashboard-api.md](references/dashboard-api.md). Read [references/agent-schema.md](references/agent-schema.md) before creating or supplying an `AgentGraphDraft`. Input IDs are deterministic: repeated `--note` arguments map to `note_1`, `note_2`, and so on in command-line order; `--text` or `--stdin` receives the next number. Use those exact IDs in draft evidence.
4. Choose graph generation mode:
   - If the user requests adjacent knowledge or gaps, use the host model to author an `AgentGraphDraft`. Quote note-backed evidence verbatim. Give concepts outside the notes `evidence: []` and confidence no higher than `0.78`; the compiler will keep them as unlit boundary/missing nodes. Never invent note evidence.
   - If the user requests only strict extraction, omit the draft and let the deterministic heuristic provider recognize note-backed concepts only. Explicitly state that this mode cannot discover external gaps.
5. Save a host-authored draft under `artifacts/agent-runs/` when used, then run the bundled helper from this skill directory:

```bash
node scripts/submit-run.mjs \
  --note path/to/note.md \
  --goal "user learning goal" \
  --audience "target learner" \
  --granularity 4 \
  --hops 2 \
  --max-nodes 36 \
  --draft artifacts/agent-runs/draft.json
```

Use `--text "..." --title "..."` for pasted content. Repeat `--note` for multiple notes. Use `--draft path/to/draft.json` only after applying the evidence rules in `agent-schema.md`.

The helper connects to `KNOWLEDGE_COMPLETION_BASE_URL`, defaulting to `http://localhost:4318`. It starts an already-installed local repository runtime when it can locate one. It never claims success unless the service identifies itself as Knowledge Completion Run API v1, `POST /api/runs` returns the formal response, and `GET /api/runs/:runId` returns the same persisted result. A non-local endpoint requires explicit `--allow-remote-upload` because it receives complete note text.

6. Parse the helper's JSON output. Require non-empty `runId` and `dashboardUrl`. The helper opens the page by default; if the host blocks browser launch, return `dashboardUrl` as a clickable link.
7. Report the run status, provider, graph counts, warnings, and dashboard URL. State whether the graph is offline/heuristic or host-drafted.

## Service recovery

If the helper says runtime dependencies are absent, tell the user which runtime root it found. Only after the user agrees to the dependency download, rerun with `--install-dependencies`; this executes `npm install --no-audit --no-fund` in that exact repository and then starts the service.

If no runtime can be found, ask the user to approve both the pinned Git clone and the npm dependency download. After approval, rerun the same command with `--bootstrap-runtime --install-dependencies`. The helper clones the Plugin-matched release tag into a versioned user-data directory, verifies both package identities, installs there, and starts it. It never overwrites an existing destination. Alternatively, connect to a trusted deployed instance by setting `KNOWLEDGE_COMPLETION_BASE_URL=https://...` and explicitly allow the remote text upload.

Do not imply that the plugin contains an MCP server or hosted SaaS endpoint. It currently packages a Skill and an HTTP client; the dashboard runtime is the repository application or a separately deployed instance.

## CLI fallback

Use the repository CLI only when the Run API cannot be made available and the user accepts that this fallback produces a local JSON artifact without a visual `/runs/:runId` page:

```bash
npm run agent -- build \
  --note path/to/note.md \
  --goal "user learning goal" \
  --granularity 4 \
  --hops 2 \
  --max-nodes 36 \
  --provider auto \
  --output artifacts/agent-runs/result.json
```

## Quality gates

- Confirm every relation endpoint exists.
- Confirm every note evidence excerpt occurs verbatim in its source note.
- Confirm projection node counts are monotonic from granularity 1 through 5.
- Keep proposed missing nodes visually and semantically distinct from note-backed nodes.
- Inspect stop reasons and warnings before calling a run complete.
- Never report a dashboard URL invented from a failed request.
