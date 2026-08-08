import type {
  KnowledgeAgentRunError,
  KnowledgeAgentRunList,
  KnowledgeAgentRunRecord,
  KnowledgeAgentRunStatus,
  KnowledgeAgentRunSummary,
  MapGranularity,
} from "../../../packages/contracts/src/index.ts";
import type {
  AgentGraphDraft,
  KnowledgeAgentRun,
} from "../../../packages/knowledge-agent/src/index.ts";

export type StoredKnowledgeAgentRun = KnowledgeAgentRunRecord<KnowledgeAgentRun, AgentGraphDraft>;

const CREATE_RUNS_TABLE_SQL = `CREATE TABLE IF NOT EXISTS knowledge_agent_runs (
  id TEXT PRIMARY KEY NOT NULL,
  parent_run_id TEXT,
  attempt INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL,
  provider TEXT NOT NULL,
  goal TEXT NOT NULL,
  audience TEXT,
  granularity INTEGER,
  note_count INTEGER NOT NULL,
  input_json TEXT NOT NULL,
  result_json TEXT,
  error_code TEXT,
  error_message TEXT,
  error_retryable INTEGER,
  concept_count INTEGER,
  relation_count INTEGER,
  evidence_count INTEGER,
  duration_ms INTEGER,
  created_at TEXT NOT NULL,
  started_at TEXT,
  completed_at TEXT,
  updated_at TEXT NOT NULL
)`;

const INITIALIZE_RUNS_SQL = [
  CREATE_RUNS_TABLE_SQL,
  `CREATE INDEX IF NOT EXISTS idx_knowledge_agent_runs_created_at
   ON knowledge_agent_runs(created_at)`,
  `CREATE INDEX IF NOT EXISTS idx_knowledge_agent_runs_status_created_at
   ON knowledge_agent_runs(status, created_at)`,
  `CREATE INDEX IF NOT EXISTS idx_knowledge_agent_runs_parent
   ON knowledge_agent_runs(parent_run_id)`,
] as const;

type RunRow = {
  id: string;
  parent_run_id: string | null;
  attempt: number;
  status: KnowledgeAgentRunStatus;
  provider: string;
  input_json: string;
  result_json: string | null;
  error_code: KnowledgeAgentRunError["code"] | null;
  error_message: string | null;
  error_retryable: number | null;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
  updated_at: string;
};

type RunSummaryRow = {
  id: string;
  parent_run_id: string | null;
  attempt: number;
  status: KnowledgeAgentRunStatus;
  provider: string;
  goal: string;
  audience: string | null;
  granularity: number | null;
  note_count: number;
  concept_count: number | null;
  relation_count: number | null;
  evidence_count: number | null;
  duration_ms: number | null;
  created_at: string;
  completed_at: string | null;
  updated_at: string;
};

function toRunRecord(row: RunRow): StoredKnowledgeAgentRun {
  const error = row.error_code && row.error_message
    ? {
        code: row.error_code,
        message: row.error_message,
        retryable: row.error_retryable === 1,
      }
    : undefined;
  return {
    runId: row.id,
    status: row.status,
    parentRunId: row.parent_run_id ?? undefined,
    attempt: row.attempt,
    provider: row.provider,
    input: JSON.parse(row.input_json) as StoredKnowledgeAgentRun["input"],
    result: row.result_json ? JSON.parse(row.result_json) as KnowledgeAgentRun : undefined,
    error,
    createdAt: row.created_at,
    startedAt: row.started_at ?? undefined,
    completedAt: row.completed_at ?? undefined,
    updatedAt: row.updated_at,
  };
}

function toRunSummary(row: RunSummaryRow): KnowledgeAgentRunSummary {
  return {
    runId: row.id,
    status: row.status,
    parentRunId: row.parent_run_id ?? undefined,
    attempt: row.attempt,
    provider: row.provider,
    goal: row.goal,
    audience: row.audience ?? undefined,
    selectedGranularity: row.granularity as MapGranularity | undefined,
    noteCount: row.note_count,
    conceptCount: row.concept_count ?? undefined,
    relationCount: row.relation_count ?? undefined,
    evidenceCount: row.evidence_count ?? undefined,
    durationMs: row.duration_ms ?? undefined,
    createdAt: row.created_at,
    completedAt: row.completed_at ?? undefined,
    updatedAt: row.updated_at,
  };
}

function encodeCursor(row: RunSummaryRow) {
  return `${row.created_at}|${row.id}`;
}

function decodeCursor(cursor?: string) {
  if (!cursor) return undefined;
  const separator = cursor.lastIndexOf("|");
  if (separator < 1 || separator === cursor.length - 1) {
    throw new TypeError("Invalid run list cursor.");
  }
  const createdAt = cursor.slice(0, separator);
  const id = cursor.slice(separator + 1);
  if (Number.isNaN(Date.parse(createdAt)) || !/^agent_run_[a-zA-Z0-9]+$/.test(id)) {
    throw new TypeError("Invalid run list cursor.");
  }
  return { createdAt, id };
}

export interface KnowledgeAgentRunStore {
  create(record: StoredKnowledgeAgentRun): Promise<StoredKnowledgeAgentRun>;
  complete(runId: string, result: KnowledgeAgentRun, completedAt: string): Promise<StoredKnowledgeAgentRun>;
  fail(runId: string, error: KnowledgeAgentRunError, completedAt: string): Promise<StoredKnowledgeAgentRun>;
  get(runId: string): Promise<StoredKnowledgeAgentRun | null>;
}

export class D1KnowledgeAgentRunRepository implements KnowledgeAgentRunStore {
  private readonly database: D1Database;

  constructor(database: D1Database) {
    this.database = database;
  }

  async initialize() {
    await this.database.batch(INITIALIZE_RUNS_SQL.map((statement) => this.database.prepare(statement)));
    await this.database.prepare("PRAGMA optimize").run();
  }

  async create(record: StoredKnowledgeAgentRun) {
    const noteCount = record.input.notes?.length ?? (record.input.note ? 1 : 0);
    await this.database.prepare(
      `INSERT INTO knowledge_agent_runs (
        id, parent_run_id, attempt, status, provider, goal, audience,
        granularity, note_count, input_json, result_json, error_code,
        error_message, error_retryable, concept_count, relation_count,
        evidence_count, duration_ms, created_at, started_at, completed_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, ?, ?, NULL, ?)`,
    ).bind(
      record.runId,
      record.parentRunId ?? null,
      record.attempt,
      record.status,
      record.provider,
      record.input.goal,
      record.input.audience ?? null,
      record.input.granularity ?? null,
      noteCount,
      JSON.stringify(record.input),
      record.createdAt,
      record.startedAt ?? null,
      record.updatedAt,
    ).run();
    return record;
  }

  async complete(runId: string, result: KnowledgeAgentRun, completedAt: string) {
    await this.database.prepare(
      `UPDATE knowledge_agent_runs SET
        status = ?, provider = ?, granularity = ?, result_json = ?,
        error_code = NULL, error_message = NULL, error_retryable = NULL,
        concept_count = ?, relation_count = ?, evidence_count = ?, duration_ms = ?,
        completed_at = ?, updated_at = ?
       WHERE id = ? AND status IN ('queued', 'running')`,
    ).bind(
      result.status,
      result.provider,
      result.mapSpec.granularity,
      JSON.stringify(result),
      result.metrics.conceptCount,
      result.metrics.relationCount,
      result.metrics.evidenceCount,
      result.metrics.durationMs,
      completedAt,
      completedAt,
      runId,
    ).run();
    const record = await this.get(runId);
    if (!record) throw new Error("Agent run disappeared while its result was being persisted.");
    return record;
  }

  async fail(runId: string, error: KnowledgeAgentRunError, completedAt: string) {
    await this.database.prepare(
      `UPDATE knowledge_agent_runs SET
        status = 'failed', error_code = ?, error_message = ?, error_retryable = ?,
        completed_at = ?, updated_at = ?
       WHERE id = ? AND status IN ('queued', 'running')`,
    ).bind(error.code, error.message, error.retryable ? 1 : 0, completedAt, completedAt, runId).run();
    const record = await this.get(runId);
    if (!record) throw new Error("Agent run disappeared while its failure was being persisted.");
    return record;
  }

  async get(runId: string) {
    const row = await this.database.prepare(
      `SELECT id, parent_run_id, attempt, status, provider, input_json,
        result_json, error_code, error_message, error_retryable,
        created_at, started_at, completed_at, updated_at
       FROM knowledge_agent_runs WHERE id = ? LIMIT 1`,
    ).bind(runId).first<RunRow>();
    return row ? toRunRecord(row) : null;
  }

  async list(options: {
    limit?: number;
    cursor?: string;
    status?: KnowledgeAgentRunStatus;
  } = {}): Promise<KnowledgeAgentRunList> {
    const limit = Math.min(100, Math.max(1, Math.trunc(options.limit ?? 20)));
    const cursor = decodeCursor(options.cursor);
    const conditions: string[] = [];
    const bindings: unknown[] = [];
    if (options.status) {
      conditions.push("status = ?");
      bindings.push(options.status);
    }
    if (cursor) {
      conditions.push("(created_at < ? OR (created_at = ? AND id < ?))");
      bindings.push(cursor.createdAt, cursor.createdAt, cursor.id);
    }
    const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
    const result = await this.database.prepare(
      `SELECT id, parent_run_id, attempt, status, provider, goal, audience,
        granularity, note_count, concept_count, relation_count, evidence_count,
        duration_ms, created_at, completed_at, updated_at
       FROM knowledge_agent_runs ${where}
       ORDER BY created_at DESC, id DESC LIMIT ?`,
    ).bind(...bindings, limit + 1).all<RunSummaryRow>();
    const hasNextPage = result.results.length > limit;
    const page = result.results.slice(0, limit);
    return {
      runs: page.map(toRunSummary),
      nextCursor: hasNextPage && page.length ? encodeCursor(page.at(-1)!) : undefined,
    };
  }
}
