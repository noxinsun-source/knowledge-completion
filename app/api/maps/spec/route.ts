import { suggestMapSpec } from "@/packages/knowledge-engine/src";

export async function POST(request: Request) {
  try {
    const input = await request.json() as { goal?: string; audience?: string };
    if (!input.goal?.trim()) throw new TypeError("goal is required.");
    return Response.json(suggestMapSpec(input.goal, input.audience), { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "MapSpec could not be generated." }, { status: 400 });
  }
}
