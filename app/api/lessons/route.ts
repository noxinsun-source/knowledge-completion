import { env } from "cloudflare:workers";
import { getKnowledgeMap } from "@/apps/api/src/map-service";
import { generateTutorLesson } from "@/packages/knowledge-engine/src";

export async function POST(request: Request) {
  try {
    const input = await request.json() as { mapId?: string; conceptId?: string };
    if (!input.mapId || !input.conceptId) throw new TypeError("mapId and conceptId are required.");
    const map = await getKnowledgeMap(env.DB, input.mapId);
    const node = map.analysis.nodes.find((candidate) => candidate.id === input.conceptId);
    if (!node) throw new Error("Concept is not part of this map.");
    return Response.json({ lesson: generateTutorLesson(node) });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Lesson could not be generated." }, { status: 400 });
  }
}
