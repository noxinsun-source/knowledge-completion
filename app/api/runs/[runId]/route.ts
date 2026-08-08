import { env } from "cloudflare:workers";
import {
  getKnowledgeAgentRun,
  KnowledgeAgentRunNotFoundError,
} from "@/apps/api/src/agent-run-service";

type RouteContext = { params: Promise<{ runId: string }> };

export async function GET(_request: Request, context: RouteContext) {
  try {
    const { runId } = await context.params;
    return Response.json(
      { run: await getKnowledgeAgentRun(env.DB, runId) },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (error) {
    const status = error instanceof KnowledgeAgentRunNotFoundError
      ? 404
      : error instanceof TypeError
        ? 400
        : 500;
    return Response.json(
      { error: error instanceof Error ? error.message : "Agent run could not be read." },
      { status, headers: { "cache-control": "no-store" } },
    );
  }
}
