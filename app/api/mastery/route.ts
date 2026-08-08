import { env } from "cloudflare:workers";
import { recordMasteryEvidence } from "@/apps/api/src/map-service";
import { D1PlatformRepository } from "@/apps/api/src/platform-repository";
import { calculateConceptMastery } from "@/packages/knowledge-engine/src";
import type { MasteryEvidenceInput } from "@/packages/contracts/src";

export async function GET(request: Request) {
  try {
    const mapId = new URL(request.url).searchParams.get("mapId");
    if (!mapId) throw new TypeError("mapId is required.");
    const repository = new D1PlatformRepository(env.DB);
    await repository.initialize();
    const evidence = await repository.listMasteryEvidence(mapId);
    const mastery = [...new Set(evidence.map((item) => item.conceptId))].map((conceptId) => calculateConceptMastery(conceptId, evidence));
    return Response.json({ mastery, evidence });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Mastery could not be read." }, { status: 400 });
  }
}

export async function POST(request: Request) {
  try {
    return Response.json(await recordMasteryEvidence(env.DB, await request.json() as MasteryEvidenceInput), { status: 201 });
  } catch (error) {
    const status = error instanceof TypeError || error instanceof RangeError ? 400 : 500;
    return Response.json({ error: error instanceof Error ? error.message : "Mastery evidence could not be stored." }, { status });
  }
}
