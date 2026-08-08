import { env } from "cloudflare:workers";
import {
  createKnowledgeAgentRun,
  listKnowledgeAgentRuns,
  parseKnowledgeAgentRunStatus,
} from "@/apps/api/src/agent-run-service";

function json(body: unknown, status = 200, headers?: HeadersInit) {
  return Response.json(body, {
    status,
    headers: { "cache-control": "no-store", ...headers },
  });
}

function runUrls(request: Request, runId: string) {
  return {
    dashboardUrl: new URL(`/runs/${encodeURIComponent(runId)}`, request.url).toString(),
    eventsUrl: new URL(`/api/runs/${encodeURIComponent(runId)}/events`, request.url).toString(),
  };
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const limitValue = url.searchParams.get("limit");
    const limit = limitValue === null ? undefined : Number(limitValue);
    if (limit !== undefined && (!Number.isInteger(limit) || limit < 1 || limit > 100)) {
      throw new RangeError("limit must be an integer between 1 and 100.");
    }
    const result = await listKnowledgeAgentRuns(env.DB, {
      limit,
      cursor: url.searchParams.get("cursor") ?? undefined,
      status: parseKnowledgeAgentRunStatus(url.searchParams.get("status")),
    });
    return json(result);
  } catch (error) {
    const status = error instanceof TypeError || error instanceof RangeError ? 400 : 500;
    return json({ error: error instanceof Error ? error.message : "Agent runs could not be listed." }, status);
  }
}

export async function POST(request: Request) {
  try {
    const input = await request.json();
    const run = await createKnowledgeAgentRun(env.DB, input);
    const urls = runUrls(request, run.runId);
    if (run.status === "failed") {
      return json({ run, error: run.error, ...urls }, 422, { location: urls.dashboardUrl });
    }
    return json({ run, ...urls }, 201, { location: urls.dashboardUrl });
  } catch (error) {
    const status = error instanceof SyntaxError || error instanceof TypeError || error instanceof RangeError ? 400 : 500;
    return json({ error: error instanceof Error ? error.message : "Agent run could not be created." }, status);
  }
}
