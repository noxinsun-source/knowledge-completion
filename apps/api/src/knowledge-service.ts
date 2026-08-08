import { DEMO_NOTES } from "@/fixtures/demo/transformer-notes";
import {
  analyzeNoteEvidence,
  composeKnowledgeAnalysis,
  type NoteEvidenceContribution,
} from "@/packages/knowledge-engine/src";
import type { AtlasNoteInput, SourceNote } from "@/packages/contracts/src";
import { D1NoteRepository } from "./note-repository";
import { D1PlatformRepository } from "./platform-repository";

export const ANALYZER_VERSION = "evidence-v3-aliases";

function cleanRequired(value: unknown, field: string, maxLength: number) {
  if (typeof value !== "string" || !value.trim()) {
    throw new TypeError(`${field} must be a non-empty string.`);
  }
  const cleaned = value.trim();
  if (cleaned.length > maxLength) {
    throw new RangeError(`${field} must be at most ${maxLength} characters.`);
  }
  return cleaned;
}

async function sha256(value: string) {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

async function noteHash(note: SourceNote) {
  return sha256(`${note.title}\u0000${note.content}\u0000${note.source}\u0000${note.confidence}`);
}

export async function normalizeNoteInput(input: AtlasNoteInput) {
  const title = cleanRequired(input.title, "title", 240);
  const content = cleanRequired(input.content, "content", 50_000);
  const source =
    typeof input.source === "string" && input.source.trim()
      ? input.source.trim().slice(0, 240)
      : "手动录入";
  const capturedAt =
    typeof input.capturedAt === "string" && /^\d{4}-\d{2}-\d{2}$/.test(input.capturedAt)
      ? input.capturedAt
      : new Date().toISOString().slice(0, 10);
  const confidence = Math.min(1, Math.max(0, Number(input.confidence ?? 0.8)));
  return {
    title,
    content,
    source,
    capturedAt,
    confidence,
    contentHash: await sha256(`${title}\u0000${content}`),
  };
}

export async function readKnowledgeRepository(database: D1Database) {
  const repository = new D1NoteRepository(database);
  const platform = new D1PlatformRepository(database);
  await Promise.all([repository.initialize(), platform.initialize()]);
  const userNotes = await repository.list();
  const notes: SourceNote[] = [...DEMO_NOTES, ...userNotes];
  const hashes = new Map(await Promise.all(notes.map(async (note) => [note.id, await noteHash(note)] as const)));
  const cached = await platform.listAnalysisCache(notes.map((note) => note.id));
  const cacheByNote = new Map(cached.map((entry) => [entry.noteId, entry]));
  const contributions: NoteEvidenceContribution[] = [];
  const changed = [];
  let cacheHits = 0;
  for (const note of notes) {
    const existing = cacheByNote.get(note.id);
    if (existing && existing.contentHash === hashes.get(note.id) && existing.analyzerVersion === ANALYZER_VERSION) {
      contributions.push(existing.contribution);
      cacheHits += 1;
    } else {
      const contribution = analyzeNoteEvidence(note);
      contributions.push(contribution);
      changed.push({
        noteId: note.id,
        contentHash: hashes.get(note.id)!,
        analyzerVersion: ANALYZER_VERSION,
        contribution,
      });
    }
  }
  await platform.upsertAnalysisCache(changed);
  const analysis = composeKnowledgeAnalysis(notes, contributions);
  analysis.pipeline.unshift({
    name: "增量分析",
    detail: `${cacheHits} 篇命中缓存，${changed.length} 篇重新计算`,
    count: changed.length,
  });
  return {
    analysis,
    counts: {
      sample: DEMO_NOTES.length,
      user: userNotes.length,
      total: notes.length,
    },
    provenance: {
      sample: "fixtures/demo 中的明确演示数据",
      user: "Cloudflare D1 持久化笔记",
    },
    incremental: {
      analyzerVersion: ANALYZER_VERSION,
      cacheHits,
      recomputedNotes: changed.length,
      ignoredCachedNotes: Math.max(0, cached.length - notes.length),
    },
  };
}

export async function storeKnowledgeNote(
  database: D1Database,
  input: AtlasNoteInput,
) {
  const repository = new D1NoteRepository(database);
  await repository.initialize();
  return repository.upsert(await normalizeNoteInput(input));
}
