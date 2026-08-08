import { env } from "cloudflare:workers";
import {
  readKnowledgeRepository,
  storeKnowledgeNote,
} from "@/apps/api/src/knowledge-service";
import type { AtlasNoteInput } from "@/packages/contracts/src";

function json(body: unknown, status = 200) {
  return Response.json(body, {
    status,
    headers: { "cache-control": "no-store" },
  });
}

export async function GET() {
  try {
    return json(await readKnowledgeRepository(env.DB));
  } catch (error) {
    return json(
      { error: error instanceof Error ? error.message : "Knowledge repository failed." },
      500,
    );
  }
}

export async function POST(request: Request) {
  try {
    const input = (await request.json()) as AtlasNoteInput;
    const note = await storeKnowledgeNote(env.DB, input);
    return json({ note }, 201);
  } catch (error) {
    const status = error instanceof TypeError || error instanceof RangeError ? 400 : 500;
    return json(
      { error: error instanceof Error ? error.message : "The note could not be stored." },
      status,
    );
  }
}
