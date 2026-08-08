import type { SourceNote } from "@/packages/contracts/src";

type NoteRow = {
  id: string;
  title: string;
  content: string;
  source: string;
  captured_at: string;
  confidence: number;
};

export type StoredNoteInput = Omit<SourceNote, "id"> & {
  contentHash: string;
};

const CREATE_TABLE_SQL = `CREATE TABLE IF NOT EXISTS atlas_notes (
  id TEXT PRIMARY KEY NOT NULL,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  source TEXT NOT NULL,
  captured_at TEXT NOT NULL,
  confidence REAL NOT NULL DEFAULT 0.8,
  content_hash TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
)`;

const CREATE_HASH_INDEX_SQL = `CREATE UNIQUE INDEX IF NOT EXISTS idx_atlas_notes_content_hash
ON atlas_notes(content_hash)`;

const CREATE_CAPTURED_AT_INDEX_SQL = `CREATE INDEX IF NOT EXISTS idx_atlas_notes_captured_at
ON atlas_notes(captured_at)`;

function toSourceNote(row: NoteRow): SourceNote {
  return {
    id: row.id,
    title: row.title,
    content: row.content,
    source: row.source,
    capturedAt: row.captured_at,
    confidence: row.confidence,
  };
}

export class D1NoteRepository {
  constructor(private readonly database: D1Database) {}

  async initialize() {
    await this.database.batch([
      this.database.prepare(CREATE_TABLE_SQL),
      this.database.prepare(CREATE_HASH_INDEX_SQL),
      this.database.prepare(CREATE_CAPTURED_AT_INDEX_SQL),
    ]);
    await this.database.prepare("PRAGMA optimize").run();
  }

  async list(): Promise<SourceNote[]> {
    const result = await this.database
      .prepare(
        `SELECT id, title, content, source, captured_at, confidence
         FROM atlas_notes
         ORDER BY captured_at DESC, created_at DESC`,
      )
      .all<NoteRow>();
    return result.results.map(toSourceNote);
  }

  async upsert(input: StoredNoteInput): Promise<SourceNote> {
    const id = `note_${crypto.randomUUID().replaceAll("-", "")}`;
    const now = new Date().toISOString();
    await this.database
      .prepare(
        `INSERT INTO atlas_notes (
           id, title, content, source, captured_at, confidence,
           content_hash, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(content_hash) DO UPDATE SET
           title = excluded.title,
           source = excluded.source,
           captured_at = excluded.captured_at,
           confidence = excluded.confidence,
           updated_at = excluded.updated_at`,
      )
      .bind(
        id,
        input.title,
        input.content,
        input.source,
        input.capturedAt,
        input.confidence,
        input.contentHash,
        now,
        now,
      )
      .run();

    const row = await this.database
      .prepare(
        `SELECT id, title, content, source, captured_at, confidence
         FROM atlas_notes WHERE content_hash = ? LIMIT 1`,
      )
      .bind(input.contentHash)
      .first<NoteRow>();
    if (!row) throw new Error("The note was stored but could not be read back.");
    return toSourceNote(row);
  }
}
