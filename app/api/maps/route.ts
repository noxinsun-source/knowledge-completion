import { env } from "cloudflare:workers";
import { createKnowledgeMap, getKnowledgeMap, listKnowledgeMaps } from "@/apps/api/src/map-service";

function json(body: unknown, status = 200) {
  return Response.json(body, { status, headers: { "cache-control": "no-store" } });
}

export async function GET(request: Request) {
  try {
    const id = new URL(request.url).searchParams.get("id");
    return json(id ? { map: await getKnowledgeMap(env.DB, id) } : { maps: await listKnowledgeMaps(env.DB) });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "Maps could not be read." }, 404);
  }
}

export async function POST(request: Request) {
  try {
    return json(await createKnowledgeMap(env.DB, await request.json()), 201);
  } catch (error) {
    const status = error instanceof TypeError || error instanceof RangeError ? 400 : 500;
    return json({ error: error instanceof Error ? error.message : "Map could not be created." }, status);
  }
}
