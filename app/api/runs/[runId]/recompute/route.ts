import { env } from "cloudflare:workers";
import {
  KnowledgeAgentRunConflictError,
  KnowledgeAgentRunNotFoundError,
  recomputeKnowledgeAgentRun,
} from "@/apps/api/src/agent-run-service";

type RouteContext = { params: Promise<{ runId: string }> };

export async function POST(request: Request, context: RouteContext) {
  try {
    const { runId } = await context.params;
    const input = await request.json();
    const run = await recomputeKnowledgeAgentRun(env.DB, runId, input);
    const dashboardUrl = new URL(`/runs/${encodeURIComponent(run.runId)}`, request.url).toString();
    const eventsUrl = new URL(`/api/runs/${encodeURIComponent(run.runId)}/events`, request.url).toString();
    const status = run.status === "failed" ? 422 : 201;
    return Response.json(
      { run, ...(run.error ? { error: run.error } : {}), dashboardUrl, eventsUrl },
      { status, headers: { "cache-control": "no-store", location: dashboardUrl } },
    );
  } catch (error) {
    const status = error instanceof KnowledgeAgentRunNotFoundError
      ? 404
      : error instanceof KnowledgeAgentRunConflictError
        ? 409
        : error instanceof SyntaxError || error instanceof TypeError || error instanceof RangeError
          ? 400
          : 500;
    return Response.json(
      { error: error instanceof Error ? error.message : "Agent run could not be recomputed." },
      { status, headers: { "cache-control": "no-store" } },
    );
  }
}
