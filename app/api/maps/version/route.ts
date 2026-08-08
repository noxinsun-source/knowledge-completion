import { env } from "cloudflare:workers";
import { compareKnowledgeMaps, freezeKnowledgeMap, migrateKnowledgeMap } from "@/apps/api/src/map-service";

export async function POST(request: Request) {
  try {
    const input = await request.json() as {
      action?: "freeze" | "migrate" | "compare";
      mapId?: string;
      fromMapId?: string;
      toMapId?: string;
      spec?: Record<string, unknown>;
      reason?: string;
    };
    if (input.action === "freeze" && input.mapId) return Response.json({ map: await freezeKnowledgeMap(env.DB, input.mapId) });
    if (input.action === "migrate" && input.mapId) return Response.json(await migrateKnowledgeMap(env.DB, input.mapId, { spec: input.spec, reason: input.reason }));
    if (input.action === "compare" && input.fromMapId && input.toMapId) return Response.json({ diff: await compareKnowledgeMaps(env.DB, input.fromMapId, input.toMapId) });
    throw new TypeError("Invalid version action or missing map identifiers.");
  } catch (error) {
    const status = error instanceof TypeError || error instanceof RangeError ? 400 : 500;
    return Response.json({ error: error instanceof Error ? error.message : "Version action failed." }, { status });
  }
}
