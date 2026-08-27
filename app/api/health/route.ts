import { env } from "cloudflare:workers";
import { D1NoteRepository } from "@/apps/api/src/note-repository";

function modelProviderStatus() {
  const runtimeEnv: Record<string, string | undefined> =
    typeof process !== "undefined" && process.env ? process.env : {};
  const bindings: Record<string, unknown> = { ...env };
  const baseUrl = (typeof bindings.KNOWLEDGE_AGENT_BASE_URL === "string" ? bindings.KNOWLEDGE_AGENT_BASE_URL : runtimeEnv.KNOWLEDGE_AGENT_BASE_URL)?.trim();
  const model = (typeof bindings.KNOWLEDGE_AGENT_MODEL === "string" ? bindings.KNOWLEDGE_AGENT_MODEL : runtimeEnv.KNOWLEDGE_AGENT_MODEL)?.trim();
  if (baseUrl && model) return { modelProvider: "openai-compatible", baseUrl, model };
  return { modelProvider: "heuristic-offline", baseUrl: null, model: null };
}

export async function GET() {
  try {
    const repository = new D1NoteRepository(env.DB);
    await repository.initialize();
    const notes = await repository.list();
    return Response.json({
      ok: true,
      service: "knowledge-completion-api",
      runApiVersion: "v1",
      storage: "cloudflare-d1",
      storedNotes: notes.length,
      ...modelProviderStatus(),
    });
  } catch (error) {
    return Response.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Health check failed.",
      },
      { status: 503 },
    );
  }
}
