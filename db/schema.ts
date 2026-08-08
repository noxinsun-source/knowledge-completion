import { index, integer, real, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const atlasNotes = sqliteTable(
  "atlas_notes",
  {
    id: text("id").primaryKey(),
    title: text("title").notNull(),
    content: text("content").notNull(),
    source: text("source").notNull(),
    capturedAt: text("captured_at").notNull(),
    confidence: real("confidence").notNull().default(0.8),
    contentHash: text("content_hash").notNull(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("idx_atlas_notes_content_hash").on(table.contentHash),
    index("idx_atlas_notes_captured_at").on(table.capturedAt),
  ],
);

export const knowledgeMaps = sqliteTable(
  "knowledge_maps",
  {
    id: text("id").primaryKey(),
    parentMapId: text("parent_map_id"),
    version: integer("version").notNull(),
    status: text("status", { enum: ["draft", "frozen"] }).notNull(),
    goal: text("goal").notNull(),
    audience: text("audience").notNull(),
    granularity: integer("granularity").notNull(),
    expansionRadius: integer("expansion_radius").notNull(),
    maxNodes: integer("max_nodes").notNull(),
    confidenceThreshold: real("confidence_threshold").notNull(),
    seedNoteId: text("seed_note_id"),
    revisionReason: text("revision_reason"),
    snapshotJson: text("snapshot_json").notNull(),
    scopeVersion: text("scope_version").notNull(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
    frozenAt: text("frozen_at"),
  },
  (table) => [
    index("idx_knowledge_maps_created_at").on(table.createdAt),
    index("idx_knowledge_maps_parent_version").on(table.parentMapId, table.version),
    index("idx_knowledge_maps_status").on(table.status),
  ],
);

export const noteAnalysisCache = sqliteTable(
  "note_analysis_cache",
  {
    noteId: text("note_id").primaryKey(),
    contentHash: text("content_hash").notNull(),
    analyzerVersion: text("analyzer_version").notNull(),
    evidenceJson: text("evidence_json").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [index("idx_note_analysis_cache_hash_version").on(table.contentHash, table.analyzerVersion)],
);

export const discoveryCache = sqliteTable(
  "discovery_cache",
  {
    cacheKey: text("cache_key").primaryKey(),
    query: text("query").notNull(),
    responseJson: text("response_json").notNull(),
    fetchedAt: text("fetched_at").notNull(),
    expiresAt: text("expires_at").notNull(),
  },
  (table) => [index("idx_discovery_cache_expires_at").on(table.expiresAt)],
);

export const conceptCorrections = sqliteTable(
  "concept_corrections",
  {
    id: text("id").primaryKey(),
    mapId: text("map_id").notNull(),
    conceptId: text("concept_id").notNull(),
    action: text("action", { enum: ["rename", "merge", "reject"] }).notNull(),
    proposedValue: text("proposed_value"),
    reason: text("reason"),
    status: text("status", { enum: ["pending", "accepted", "rejected"] }).notNull(),
    createdAt: text("created_at").notNull(),
    resolvedAt: text("resolved_at"),
  },
  (table) => [
    index("idx_concept_corrections_map_status").on(table.mapId, table.status),
    index("idx_concept_corrections_concept").on(table.conceptId),
  ],
);

export const masteryEvidence = sqliteTable(
  "mastery_evidence",
  {
    id: text("id").primaryKey(),
    mapId: text("map_id").notNull(),
    conceptId: text("concept_id").notNull(),
    evidenceType: text("evidence_type", { enum: ["saved", "quiz", "explanation", "project"] }).notNull(),
    score: real("score").notNull(),
    note: text("note"),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    index("idx_mastery_evidence_map_concept").on(table.mapId, table.conceptId),
    index("idx_mastery_evidence_created_at").on(table.createdAt),
  ],
);

export const knowledgeAgentRuns = sqliteTable(
  "knowledge_agent_runs",
  {
    id: text("id").primaryKey(),
    parentRunId: text("parent_run_id"),
    attempt: integer("attempt").notNull().default(1),
    status: text("status", {
      enum: ["queued", "running", "completed", "partial", "failed"],
    }).notNull(),
    provider: text("provider").notNull(),
    goal: text("goal").notNull(),
    audience: text("audience"),
    granularity: integer("granularity"),
    noteCount: integer("note_count").notNull(),
    inputJson: text("input_json").notNull(),
    resultJson: text("result_json"),
    errorCode: text("error_code"),
    errorMessage: text("error_message"),
    errorRetryable: integer("error_retryable", { mode: "boolean" }),
    conceptCount: integer("concept_count"),
    relationCount: integer("relation_count"),
    evidenceCount: integer("evidence_count"),
    durationMs: integer("duration_ms"),
    createdAt: text("created_at").notNull(),
    startedAt: text("started_at"),
    completedAt: text("completed_at"),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    index("idx_knowledge_agent_runs_created_at").on(table.createdAt),
    index("idx_knowledge_agent_runs_status_created_at").on(table.status, table.createdAt),
    index("idx_knowledge_agent_runs_parent").on(table.parentRunId),
  ],
);
