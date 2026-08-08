import { env } from "cloudflare:workers";
import { D1NoteRepository } from "@/apps/api/src/note-repository";

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
