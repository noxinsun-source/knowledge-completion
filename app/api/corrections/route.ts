import { env } from "cloudflare:workers";
import { queueConceptCorrection, resolveConceptCorrection } from "@/apps/api/src/map-service";
import { D1PlatformRepository } from "@/apps/api/src/platform-repository";
import type { ConceptCorrectionInput } from "@/packages/contracts/src";
import { resolveConceptName } from "@/packages/knowledge-engine/src";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const term = url.searchParams.get("term");
  if (term) return Response.json({ resolution: resolveConceptName(term) });
  const repository = new D1PlatformRepository(env.DB);
  await repository.initialize();
  return Response.json({ corrections: await repository.listCorrections(url.searchParams.get("mapId") ?? undefined) });
}

export async function POST(request: Request) {
  try {
    return Response.json({ correction: await queueConceptCorrection(env.DB, await request.json() as ConceptCorrectionInput) }, { status: 201 });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Correction could not be queued." }, { status: 400 });
  }
}

export async function PATCH(request: Request) {
  try {
    const input = await request.json() as { id?: string; status?: "accepted" | "rejected" };
    if (!input.id || !input.status) throw new TypeError("id and status are required.");
    return Response.json(await resolveConceptCorrection(env.DB, input.id, input.status));
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Correction could not be resolved." }, { status: 400 });
  }
}
