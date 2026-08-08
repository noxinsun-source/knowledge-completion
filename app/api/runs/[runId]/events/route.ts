import { env } from "cloudflare:workers";
import {
  buildKnowledgeAgentRunEvent,
  getKnowledgeAgentRun,
  KnowledgeAgentRunNotFoundError,
} from "@/apps/api/src/agent-run-service";

type RouteContext = { params: Promise<{ runId: string }> };

export async function GET(_request: Request, context: RouteContext) {
  try {
    const { runId } = await context.params;
    const event = buildKnowledgeAgentRunEvent(await getKnowledgeAgentRun(env.DB, runId));
    const payload = [
      "retry: 2000",
      `id: ${event.eventId}`,
      `event: ${event.type}`,
      `data: ${JSON.stringify(event)}`,
      "",
      "",
    ].join("\n");
    return new Response(payload, {
      headers: {
        "cache-control": "no-cache, no-store",
        "content-type": "text/event-stream; charset=utf-8",
        connection: "keep-alive",
        "x-knowledge-run-terminal": String(event.terminal),
      },
    });
  } catch (error) {
    const status = error instanceof KnowledgeAgentRunNotFoundError
      ? 404
      : error instanceof TypeError
        ? 400
        : 500;
    return Response.json(
      { error: error instanceof Error ? error.message : "Agent run event could not be read." },
      { status, headers: { "cache-control": "no-store" } },
    );
  }
}
