import type {
  ConceptCorrection,
  ConceptCorrectionInput,
  DiscoveryMap,
  MasteryEvidenceInput,
  MasteryEvidenceRecord,
  MapVersionSummary,
  SourceDiscoveryResult,
} from "@/packages/contracts/src";
import type { NoteEvidenceContribution } from "@/packages/knowledge-engine/src";

const STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS knowledge_maps (
    id TEXT PRIMARY KEY NOT NULL, parent_map_id TEXT, version INTEGER NOT NULL,
    status TEXT NOT NULL, goal TEXT NOT NULL, audience TEXT NOT NULL,
    granularity INTEGER NOT NULL, expansion_radius INTEGER NOT NULL,
    max_nodes INTEGER NOT NULL, confidence_threshold REAL NOT NULL,
    seed_note_id TEXT, revision_reason TEXT, snapshot_json TEXT NOT NULL,
    scope_version TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
    frozen_at TEXT
  )`,
  `CREATE INDEX IF NOT EXISTS idx_knowledge_maps_created_at ON knowledge_maps(created_at)`,
  `CREATE INDEX IF NOT EXISTS idx_knowledge_maps_parent_version ON knowledge_maps(parent_map_id, version)`,
  `CREATE INDEX IF NOT EXISTS idx_knowledge_maps_status ON knowledge_maps(status)`,
  `CREATE TABLE IF NOT EXISTS note_analysis_cache (
    note_id TEXT PRIMARY KEY NOT NULL, content_hash TEXT NOT NULL,
    analyzer_version TEXT NOT NULL, evidence_json TEXT NOT NULL, updated_at TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_note_analysis_cache_hash_version ON note_analysis_cache(content_hash, analyzer_version)`,
  `CREATE TABLE IF NOT EXISTS discovery_cache (
    cache_key TEXT PRIMARY KEY NOT NULL, query TEXT NOT NULL,
    response_json TEXT NOT NULL, fetched_at TEXT NOT NULL, expires_at TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_discovery_cache_expires_at ON discovery_cache(expires_at)`,
  `CREATE TABLE IF NOT EXISTS concept_corrections (
    id TEXT PRIMARY KEY NOT NULL, map_id TEXT NOT NULL, concept_id TEXT NOT NULL,
    action TEXT NOT NULL, proposed_value TEXT, reason TEXT, status TEXT NOT NULL,
    created_at TEXT NOT NULL, resolved_at TEXT
  )`,
  `CREATE INDEX IF NOT EXISTS idx_concept_corrections_map_status ON concept_corrections(map_id, status)`,
  `CREATE INDEX IF NOT EXISTS idx_concept_corrections_concept ON concept_corrections(concept_id)`,
  `CREATE TABLE IF NOT EXISTS mastery_evidence (
    id TEXT PRIMARY KEY NOT NULL, map_id TEXT NOT NULL, concept_id TEXT NOT NULL,
    evidence_type TEXT NOT NULL, score REAL NOT NULL, note TEXT, created_at TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_mastery_evidence_map_concept ON mastery_evidence(map_id, concept_id)`,
  `CREATE INDEX IF NOT EXISTS idx_mastery_evidence_created_at ON mastery_evidence(created_at)`,
] as const;

type CacheRow = { note_id: string; content_hash: string; analyzer_version: string; evidence_json: string };
type MapRow = { snapshot_json: string };
type MapSummaryRow = {
  id: string; version: number; status: "draft" | "frozen"; goal: string;
  parent_map_id: string | null; created_at: string; frozen_at: string | null; snapshot_json: string;
};
type CorrectionRow = {
  id: string; map_id: string; concept_id: string; action: "rename" | "merge" | "reject";
  proposed_value: string | null; reason: string | null; status: "pending" | "accepted" | "rejected";
  created_at: string; resolved_at: string | null;
};
type MasteryRow = {
  id: string; map_id: string; concept_id: string;
  evidence_type: "saved" | "quiz" | "explanation" | "project";
  score: number; note: string | null; created_at: string;
};

export type CachedNoteAnalysis = {
  noteId: string;
  contentHash: string;
  analyzerVersion: string;
  contribution: NoteEvidenceContribution;
};

export class D1PlatformRepository {
  constructor(private readonly database: D1Database) {}

  async initialize() {
    await this.database.batch(STATEMENTS.map((statement) => this.database.prepare(statement)));
    await this.database.prepare("PRAGMA optimize").run();
  }

  async listAnalysisCache(noteIds: string[]): Promise<CachedNoteAnalysis[]> {
    if (!noteIds.length) return [];
    const placeholders = noteIds.map(() => "?").join(",");
    const result = await this.database.prepare(
      `SELECT note_id, content_hash, analyzer_version, evidence_json
       FROM note_analysis_cache WHERE note_id IN (${placeholders})`,
    ).bind(...noteIds).all<CacheRow>();
    return result.results.map((row) => ({
      noteId: row.note_id,
      contentHash: row.content_hash,
      analyzerVersion: row.analyzer_version,
      contribution: JSON.parse(row.evidence_json) as NoteEvidenceContribution,
    }));
  }

  async upsertAnalysisCache(entries: CachedNoteAnalysis[]) {
    if (!entries.length) return;
    const now = new Date().toISOString();
    await this.database.batch(entries.map((entry) => this.database.prepare(
      `INSERT INTO note_analysis_cache (note_id, content_hash, analyzer_version, evidence_json, updated_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(note_id) DO UPDATE SET content_hash = excluded.content_hash,
       analyzer_version = excluded.analyzer_version, evidence_json = excluded.evidence_json,
       updated_at = excluded.updated_at`,
    ).bind(entry.noteId, entry.contentHash, entry.analyzerVersion, JSON.stringify(entry.contribution), now)));
  }

  async saveMap(map: DiscoveryMap) {
    const now = new Date().toISOString();
    await this.database.prepare(
      `INSERT INTO knowledge_maps (
        id, parent_map_id, version, status, goal, audience, granularity,
        expansion_radius, max_nodes, confidence_threshold, seed_note_id,
        revision_reason, snapshot_json, scope_version, created_at, updated_at, frozen_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET status = excluded.status,
        snapshot_json = excluded.snapshot_json, updated_at = excluded.updated_at,
        frozen_at = excluded.frozen_at`,
    ).bind(
      map.id, map.parentMapId ?? null, map.version, map.status, map.mapSpec.goal,
      map.mapSpec.audience, map.mapSpec.granularity, map.mapSpec.expansionRadius,
      map.mapSpec.maxNodes, map.mapSpec.confidenceThreshold, map.seedNoteId,
      map.revisionReason ?? null, JSON.stringify(map), map.analysis.scopeVersion,
      map.createdAt, now, map.frozenAt ?? null,
    ).run();
    return map;
  }

  async getMap(id: string): Promise<DiscoveryMap | null> {
    const row = await this.database.prepare(
      "SELECT snapshot_json FROM knowledge_maps WHERE id = ? LIMIT 1",
    ).bind(id).first<MapRow>();
    return row ? JSON.parse(row.snapshot_json) as DiscoveryMap : null;
  }

  async listMaps(): Promise<MapVersionSummary[]> {
    const result = await this.database.prepare(
      `SELECT id, version, status, goal, parent_map_id, created_at, frozen_at, snapshot_json
       FROM knowledge_maps ORDER BY created_at DESC LIMIT 100`,
    ).all<MapSummaryRow>();
    return result.results.map((row) => {
      const map = JSON.parse(row.snapshot_json) as DiscoveryMap;
      return {
        id: row.id,
        version: row.version,
        status: row.status,
        goal: row.goal,
        parentMapId: row.parent_map_id ?? undefined,
        createdAt: row.created_at,
        frozenAt: row.frozen_at ?? undefined,
        nodeCount: map.analysis.nodes.length,
        coveredCount: map.analysis.summary.coveredCount,
      };
    });
  }

  async createCorrection(input: ConceptCorrectionInput): Promise<ConceptCorrection> {
    const correction: ConceptCorrection = {
      ...input,
      id: `correction_${crypto.randomUUID().replaceAll("-", "")}`,
      status: "pending",
      createdAt: new Date().toISOString(),
    };
    await this.database.prepare(
      `INSERT INTO concept_corrections (
        id, map_id, concept_id, action, proposed_value, reason, status, created_at, resolved_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
    ).bind(
      correction.id, correction.mapId, correction.conceptId, correction.action,
      correction.proposedValue ?? null, correction.reason ?? null,
      correction.status, correction.createdAt,
    ).run();
    return correction;
  }

  async listCorrections(mapId?: string): Promise<ConceptCorrection[]> {
    const statement = mapId
      ? this.database.prepare(`SELECT * FROM concept_corrections WHERE map_id = ? ORDER BY created_at DESC`).bind(mapId)
      : this.database.prepare(`SELECT * FROM concept_corrections ORDER BY created_at DESC LIMIT 100`);
    const result = await statement.all<CorrectionRow>();
    return result.results.map((row) => ({
      id: row.id, mapId: row.map_id, conceptId: row.concept_id, action: row.action,
      proposedValue: row.proposed_value ?? undefined, reason: row.reason ?? undefined,
      status: row.status, createdAt: row.created_at, resolvedAt: row.resolved_at ?? undefined,
    }));
  }

  async resolveCorrection(id: string, status: "accepted" | "rejected") {
    const resolvedAt = new Date().toISOString();
    await this.database.prepare(
      `UPDATE concept_corrections SET status = ?, resolved_at = ? WHERE id = ?`,
    ).bind(status, resolvedAt, id).run();
    const row = await this.database.prepare(`SELECT * FROM concept_corrections WHERE id = ? LIMIT 1`).bind(id).first<CorrectionRow>();
    if (!row) throw new Error("Correction not found.");
    return (await this.listCorrections(row.map_id)).find((item) => item.id === id)!;
  }

  async addMasteryEvidence(input: MasteryEvidenceInput): Promise<MasteryEvidenceRecord> {
    const record: MasteryEvidenceRecord = {
      ...input,
      id: `evidence_${crypto.randomUUID().replaceAll("-", "")}`,
      createdAt: new Date().toISOString(),
    };
    await this.database.prepare(
      `INSERT INTO mastery_evidence (id, map_id, concept_id, evidence_type, score, note, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).bind(record.id, record.mapId, record.conceptId, record.evidenceType, record.score, record.note ?? null, record.createdAt).run();
    return record;
  }

  async listMasteryEvidence(mapId: string): Promise<MasteryEvidenceRecord[]> {
    const result = await this.database.prepare(
      `SELECT * FROM mastery_evidence WHERE map_id = ? ORDER BY created_at DESC`,
    ).bind(mapId).all<MasteryRow>();
    return result.results.map((row) => ({
      id: row.id, mapId: row.map_id, conceptId: row.concept_id,
      evidenceType: row.evidence_type, score: row.score,
      note: row.note ?? undefined, createdAt: row.created_at,
    }));
  }

  async cloneMasteryEvidence(records: MasteryEvidenceRecord[], targetMapId: string) {
    if (!records.length) return;
    await this.database.batch(records.map((record) => this.database.prepare(
      `INSERT INTO mastery_evidence (id, map_id, concept_id, evidence_type, score, note, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      `evidence_${crypto.randomUUID().replaceAll("-", "")}`,
      targetMapId,
      record.conceptId,
      record.evidenceType,
      record.score,
      record.note ?? null,
      record.createdAt,
    )));
  }

  async getDiscoveryCache(key: string): Promise<SourceDiscoveryResult | null> {
    const row = await this.database.prepare(
      `SELECT response_json FROM discovery_cache WHERE cache_key = ? AND expires_at > ? LIMIT 1`,
    ).bind(key, new Date().toISOString()).first<{ response_json: string }>();
    return row ? JSON.parse(row.response_json) as SourceDiscoveryResult : null;
  }

  async putDiscoveryCache(key: string, query: string, response: SourceDiscoveryResult, ttlHours = 12) {
    const fetchedAt = new Date().toISOString();
    const expiresAt = new Date(Date.now() + ttlHours * 3_600_000).toISOString();
    await this.database.prepare(
      `INSERT INTO discovery_cache (cache_key, query, response_json, fetched_at, expires_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(cache_key) DO UPDATE SET response_json = excluded.response_json,
       fetched_at = excluded.fetched_at, expires_at = excluded.expires_at`,
    ).bind(key, query, JSON.stringify(response), fetchedAt, expiresAt).run();
  }
}
