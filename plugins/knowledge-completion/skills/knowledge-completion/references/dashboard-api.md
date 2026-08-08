# Dashboard Run API

Use this contract when submitting a knowledge-completion run. The default origin is `http://localhost:4318`; override it with `KNOWLEDGE_COMPLETION_BASE_URL` for a trusted deployed instance.

## Create and open a run

`POST /api/runs`

```json
{
  "notes": [
    {
      "id": "optional-stable-id",
      "title": "Note title",
      "content": "Complete note text",
      "source": "/absolute/or/logical/source",
      "capturedAt": "2026-08-08T12:00:00.000Z",
      "confidence": 0.9
    }
  ],
  "goal": "Learning goal",
  "audience": "Target learner",
  "granularity": 4,
  "expansionRadius": 2,
  "maxNodes": 36,
  "confidenceThreshold": 0.58
}
```

Successful response (`201`):

```json
{
  "run": {
    "runId": "agent_run_...",
    "status": "completed"
  },
  "dashboardUrl": "http://localhost:4318/runs/agent_run_...",
  "eventsUrl": "http://localhost:4318/api/runs/agent_run_.../events"
}
```

The full persisted record contains the validated Agent result, graph projections, trace, warnings, and timestamps. Treat the server response as authoritative; do not manufacture a run ID.

## Read, stream, and recompute

- `GET /api/runs/:runId` reads the durable record.
- `GET /api/runs/:runId/events` streams its current state as server-sent events.
- `POST /api/runs/:runId/recompute` creates a new run and returns a new `runId`; it does not mutate history in place.

Validation or Agent failures may return `422` with a persisted failed run and a `dashboardUrl`. Report the failure and its diagnostic URL; do not describe it as a completed graph.

## Trust boundary

Sending a note to a non-local `KNOWLEDGE_COMPLETION_BASE_URL` uploads its full text to that service. Confirm the endpoint is trusted before sending private notes. The bundled plugin declares no MCP server and stores no service credentials.
