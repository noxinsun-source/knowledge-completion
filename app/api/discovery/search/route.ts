import { env } from "cloudflare:workers";
import { discoverSources } from "@/apps/api/src/discovery-service";

export async function POST(request: Request) {
  try {
    const input = await request.json() as { query?: string; limitPerProvider?: number; crawlTop?: number };
    return Response.json(await discoverSources(env.DB, input.query ?? "", input), { headers: { "cache-control": "no-store" } });
  } catch (error) {
    const status = error instanceof TypeError || error instanceof RangeError ? 400 : 502;
    return Response.json({ error: error instanceof Error ? error.message : "Source discovery failed." }, { status });
  }
}
