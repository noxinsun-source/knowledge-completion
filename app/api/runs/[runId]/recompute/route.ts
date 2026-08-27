import { env } from "cloudflare:workers";
import {
  KnowledgeAgentRunConflictError,
  KnowledgeAgentRunNotFoundError,
  providerFromBindings,
  recomputeKnowledgeAgentRun,
} from "@/apps/api/src/agent-run-service";

/** 合并 Worker bindings 与 Node 环境变量，作为模型 provider 配置来源。 */
function runProviderBindings() {
  const runtimeEnv: Record<string, string | undefined> =
    typeof process !== "undefined" && process.env ? process.env : {};
  const bindings: Record<string, unknown> = { ...env };
  const flat: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(bindings)) {
    if (typeof value === "string") flat[key] = value;
  }
  return { ...runtimeEnv, ...flat };
}

type RouteContext = { params: Promise<{ runId: string }> };

export async function POST(request: Request, context: RouteContext) {
  try {
    const { runId } = await context.params;
    const input = await request.json();
    const run = await recomputeKnowledgeAgentRun(env.DB, runId, input, {
      provider: providerFromBindings(runProviderBindings()),
    });
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
