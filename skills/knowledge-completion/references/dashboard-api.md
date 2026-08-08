# Dashboard Run API

The default trusted origin is `http://localhost:4318`. Override it with `KNOWLEDGE_COMPLETION_BASE_URL` only for a service the user trusts with the complete note text.

## Create

`POST /api/runs`

```json
{
  "notes": [{
    "id": "note_1",
    "title": "Note title",
    "content": "Complete note text",
    "source": "note.md",
    "capturedAt": "2026-08-08T12:00:00.000Z",
    "confidence": 0.9
  }],
  "goal": "Learning goal",
  "audience": "Target learner",
  "granularity": 4,
  "expansionRadius": 2,
  "maxNodes": 36,
  "confidenceThreshold": 0.58,
  "initialDraft": {
    "scope": "Goal-relative scope",
    "scopeDescription": "What this map includes and excludes",
    "concepts": [],
    "relations": []
  }
}
```

Successful response is HTTP `201` and exactly uses the formal envelope:

```json
{
  "run": {
    "runId": "agent_run_...",
    "status": "completed",
    "result": {}
  },
  "dashboardUrl": "http://localhost:4318/runs/agent_run_...",
  "eventsUrl": "http://localhost:4318/api/runs/agent_run_.../events"
}
```

Do not accept legacy `record`, `data`, `id`, or synthesized URL fallbacks. The bundled helper performs `GET /api/runs/:runId` after POST and compares the persisted result before reporting success.

## Read and recompute

- `GET /api/runs/:runId` returns `{ "run": { ... } }`.
- `GET /api/runs/:runId/events` returns a finite server-sent terminal state snapshot.
- `POST /api/runs/:runId/recompute` creates a new immutable run with a new `runId`, `parentRunId`, and incremented `attempt`.

## Trust boundary

- The API record includes complete note content.
- The current service is local single-user software and has no authentication or tenant isolation.
- Never expose it directly to the public internet.
- The helper refuses a non-local origin unless `--allow-remote-upload` is explicit.
- Successful `dashboardUrl` and `eventsUrl` values must be HTTP(S) and same-origin with the API.
