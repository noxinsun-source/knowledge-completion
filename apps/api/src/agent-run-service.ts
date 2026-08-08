import type {
  KnowledgeAgentNoteInput,
  KnowledgeAgentRunError,
  KnowledgeAgentRunEvent,
  KnowledgeAgentRunList,
  KnowledgeAgentRunRequest,
  KnowledgeAgentRunStatus,
  SourceNote,
} from "../../../packages/contracts/src/index.ts";
import {
  createHeuristicKnowledgeModel,
  normalizeConceptName,
  runKnowledgeAgent,
} from "../../../packages/knowledge-agent/src/index.ts";
import type {
  AgentGraphDraft,
  KnowledgeAgentModel,
} from "../../../packages/knowledge-agent/src/index.ts";
import {
  D1KnowledgeAgentRunRepository,
  type KnowledgeAgentRunStore,
  type StoredKnowledgeAgentRun,
} from "./agent-run-repository.ts";

const RUN_ID_PATTERN = /^agent_run_[a-zA-Z0-9]+$/;
const RUN_STATUSES = new Set<KnowledgeAgentRunStatus>([
  "queued",
  "running",
  "completed",
  "partial",
  "failed",
]);
const SEMANTIC_TYPES = new Set([
  "domain",
  "topic",
  "concept",
  "mechanism",
  "method",
  "tool",
  "formula",
  "example",
] as const);
const RELATION_TYPES = new Set([
  "contains",
  "prerequisite",
  "enables",
  "applied_in",
  "part_of",
  "contrasts_with",
  "related_to",
] as const);

export class KnowledgeAgentRunNotFoundError extends Error {
  constructor(runId: string) {
    super(`Knowledge agent run ${runId} was not found.`);
    this.name = "KnowledgeAgentRunNotFoundError";
  }
}

export class KnowledgeAgentRunConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "KnowledgeAgentRunConflictError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeNote(value: unknown, label: string): KnowledgeAgentNoteInput {
  if (!isRecord(value)) throw new TypeError(`${label} must be an object.`);
  if (typeof value.title !== "string" || !value.title.trim()) {
    throw new TypeError(`${label}.title must be a non-empty string.`);
  }
  if (typeof value.content !== "string" || !value.content.trim()) {
    throw new TypeError(`${label}.content must be a non-empty string.`);
  }
  if (value.content.trim().length > 120_000) {
    throw new RangeError(`${label}.content must be at most 120000 characters.`);
  }
  if (value.title.trim().length > 240) throw new RangeError(`${label}.title must be at most 240 characters.`);
  if (value.id !== undefined && (typeof value.id !== "string" || !value.id.trim())) {
    throw new TypeError(`${label}.id must be a non-empty string when provided.`);
  }
  if (typeof value.id === "string" && value.id.trim().length > 128) {
    throw new RangeError(`${label}.id must be at most 128 characters.`);
  }
  if (value.source !== undefined && typeof value.source !== "string") {
    throw new TypeError(`${label}.source must be a string when provided.`);
  }
  if (typeof value.source === "string" && value.source.trim().length > 1_024) {
    throw new RangeError(`${label}.source must be at most 1024 characters.`);
  }
  if (value.capturedAt !== undefined && typeof value.capturedAt !== "string") {
    throw new TypeError(`${label}.capturedAt must be a string when provided.`);
  }
  if (typeof value.capturedAt === "string" && value.capturedAt.trim().length > 64) {
    throw new RangeError(`${label}.capturedAt must be at most 64 characters.`);
  }
  if (value.confidence !== undefined) finiteNumberInRange(value.confidence, `${label}.confidence`, 0, 1);
  const note: KnowledgeAgentNoteInput = {
    title: value.title.trim(),
    content: value.content.trim(),
  };
  if (typeof value.id === "string" && value.id.trim()) note.id = value.id.trim();
  if (typeof value.source === "string" && value.source.trim()) note.source = value.source.trim();
  if (typeof value.capturedAt === "string" && value.capturedAt.trim()) note.capturedAt = value.capturedAt.trim();
  if (typeof value.confidence === "number") note.confidence = value.confidence;
  return note;
}

function finiteNumberInRange(value: unknown, label: string, minimum: number, maximum: number) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new TypeError(`${label} must be a finite number.`);
  }
  if (value < minimum || value > maximum) {
    throw new RangeError(`${label} must be between ${minimum} and ${maximum}.`);
  }
  return value;
}

function optionalFiniteNumberInRange(
  value: unknown,
  label: string,
  minimum: number,
  maximum: number,
) {
  return value === undefined ? undefined : finiteNumberInRange(value, label, minimum, maximum);
}

function optionalIntegerInRange(
  value: unknown,
  label: string,
  minimum: number,
  maximum: number,
) {
  if (value === undefined) return undefined;
  const number = finiteNumberInRange(value, label, minimum, maximum);
  if (!Number.isInteger(number)) throw new TypeError(`${label} must be an integer.`);
  return number;
}

function requiredString(value: unknown, label: string, maximumLength: number) {
  if (typeof value !== "string" || !value.trim()) {
    throw new TypeError(`${label} must be a non-empty string.`);
  }
  const normalized = value.trim();
  if (normalized.length > maximumLength) {
    throw new RangeError(`${label} must be at most ${maximumLength} characters.`);
  }
  return normalized;
}

function optionalString(value: unknown, label: string, maximumLength: number) {
  if (value === undefined) return undefined;
  if (typeof value !== "string") throw new TypeError(`${label} must be a string.`);
  const normalized = value.trim();
  if (normalized.length > maximumLength) {
    throw new RangeError(`${label} must be at most ${maximumLength} characters.`);
  }
  return normalized || undefined;
}

function stringArray(value: unknown, label: string, maximumItems: number, maximumLength: number) {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) throw new TypeError(`${label} must be an array.`);
  if (value.length > maximumItems) throw new RangeError(`${label} must contain at most ${maximumItems} items.`);
  return value.map((item, index) => requiredString(item, `${label}[${index}]`, maximumLength));
}

function normalizeDraftEvidence(
  value: unknown,
  label: string,
  notesById: Map<string, KnowledgeAgentNoteInput>,
) {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) throw new TypeError(`${label} must be an array.`);
  if (value.length > 100) throw new RangeError(`${label} must contain at most 100 items.`);
  return value.map((item, index) => {
    const itemLabel = `${label}[${index}]`;
    if (!isRecord(item)) throw new TypeError(`${itemLabel} must be an object.`);
    const sourceNoteId = requiredString(item.sourceNoteId, `${itemLabel}.sourceNoteId`, 128);
    const sourceNote = notesById.get(sourceNoteId);
    if (!sourceNote) throw new TypeError(`${itemLabel}.sourceNoteId does not match an input note.`);
    const excerpt = requiredString(item.excerpt, `${itemLabel}.excerpt`, 800);
    const excerptCore = excerpt.replace(/^…+|…+$/g, "").trim();
    if (!excerptCore || !sourceNote.content.includes(excerptCore)) {
      throw new TypeError(`${itemLabel}.excerpt must occur verbatim in ${sourceNoteId}.`);
    }
    return {
      sourceNoteId,
      excerpt,
      confidence: item.confidence === undefined
        ? undefined
        : finiteNumberInRange(item.confidence, `${itemLabel}.confidence`, 0, 1),
    };
  });
}

function normalizeAgentGraphDraft(
  value: unknown,
  notes: KnowledgeAgentNoteInput[],
): AgentGraphDraft {
  if (!isRecord(value)) throw new TypeError("initialDraft must be an object.");
  if (!Array.isArray(value.concepts) || !Array.isArray(value.relations)) {
    throw new TypeError("initialDraft must contain concepts and relations arrays.");
  }
  if (value.concepts.length > 500) throw new RangeError("initialDraft must contain at most 500 concept candidates.");
  if (value.relations.length > 2_000) throw new RangeError("initialDraft must contain at most 2000 relation candidates.");

  const notesById = new Map(notes.map((note) => [note.id ?? "", note]));
  const concepts = value.concepts.map((item, index) => {
    const label = `initialDraft.concepts[${index}]`;
    if (!isRecord(item)) throw new TypeError(`${label} must be an object.`);
    const semanticType = requiredString(item.semanticType, `${label}.semanticType`, 32);
    if (!SEMANTIC_TYPES.has(semanticType as never)) {
      throw new TypeError(`${label}.semanticType is not supported.`);
    }
    const granularity = optionalIntegerInRange(item.granularity, `${label}.granularity`, 1, 5);
    if (granularity === undefined) throw new TypeError(`${label}.granularity is required.`);
    if (item.expandable !== undefined && typeof item.expandable !== "boolean") {
      throw new TypeError(`${label}.expandable must be a boolean.`);
    }
    return {
      name: requiredString(item.name, `${label}.name`, 120),
      aliases: stringArray(item.aliases, `${label}.aliases`, 12, 120),
      semanticType: semanticType as AgentGraphDraft["concepts"][number]["semanticType"],
      granularity: granularity as AgentGraphDraft["concepts"][number]["granularity"],
      description: requiredString(item.description, `${label}.description`, 800),
      whyItMatters: optionalString(item.whyItMatters, `${label}.whyItMatters`, 500),
      parentNames: stringArray(item.parentNames, `${label}.parentNames`, 6, 120),
      evidence: normalizeDraftEvidence(item.evidence, `${label}.evidence`, notesById),
      confidence: finiteNumberInRange(item.confidence, `${label}.confidence`, 0, 1),
      expandable: item.expandable as boolean | undefined,
    };
  });
  const conceptKeys = new Set(concepts.map((concept) => normalizeConceptName(concept.name)));
  const relations = value.relations.map((item, index) => {
    const label = `initialDraft.relations[${index}]`;
    if (!isRecord(item)) throw new TypeError(`${label} must be an object.`);
    const sourceName = requiredString(item.sourceName, `${label}.sourceName`, 120);
    const targetName = requiredString(item.targetName, `${label}.targetName`, 120);
    const sourceKey = normalizeConceptName(sourceName);
    const targetKey = normalizeConceptName(targetName);
    if (!conceptKeys.has(sourceKey) || !conceptKeys.has(targetKey)) {
      throw new TypeError(`${label} endpoints must reference concepts in initialDraft.concepts.`);
    }
    if (sourceKey === targetKey) throw new TypeError(`${label} must connect two different concepts.`);
    const relation = requiredString(item.relation, `${label}.relation`, 32);
    if (!RELATION_TYPES.has(relation as never)) throw new TypeError(`${label}.relation is not supported.`);
    return {
      sourceName,
      targetName,
      relation: relation as AgentGraphDraft["relations"][number]["relation"],
      statement: requiredString(item.statement, `${label}.statement`, 500),
      evidence: normalizeDraftEvidence(item.evidence, `${label}.evidence`, notesById),
      confidence: finiteNumberInRange(item.confidence, `${label}.confidence`, 0, 1),
    };
  });
  return {
    scope: requiredString(value.scope, "initialDraft.scope", 240),
    scopeDescription: requiredString(value.scopeDescription, "initialDraft.scopeDescription", 1_200),
    concepts,
    relations,
  };
}

export function normalizeKnowledgeAgentRunRequest(
  value: unknown,
): KnowledgeAgentRunRequest<AgentGraphDraft> {
  if (!isRecord(value)) throw new TypeError("Agent run request must be a JSON object.");
  if (typeof value.goal !== "string" || !value.goal.trim()) {
    throw new TypeError("goal must be a non-empty string.");
  }
  if (value.goal.trim().length > 300) throw new RangeError("goal must be at most 300 characters.");
  if (value.note !== undefined && value.notes !== undefined) {
    throw new TypeError("Provide either note or notes, not both.");
  }
  const rawNotes = value.notes !== undefined
    ? value.notes
    : value.note !== undefined
      ? [value.note]
      : [];
  if (!Array.isArray(rawNotes) || rawNotes.length === 0) {
    throw new TypeError("At least one note is required.");
  }
  if (rawNotes.length > 50) throw new RangeError("At most 50 notes are allowed in one synchronous run.");
  const notes = rawNotes.map((note, index) => {
    const normalized = normalizeNote(note, `notes[${index}]`);
    return { ...normalized, id: normalized.id ?? `note_${index + 1}` };
  });
  const noteIds = new Set<string>();
  for (const note of notes) {
    if (noteIds.has(note.id)) throw new TypeError(`Duplicate input note id: ${note.id}.`);
    noteIds.add(note.id);
  }
  if (notes.reduce((sum, note) => sum + note.content.length, 0) > 500_000) {
    throw new RangeError("The combined note content must be at most 500000 characters per synchronous run.");
  }
  const request: KnowledgeAgentRunRequest<AgentGraphDraft> = {
    notes,
    goal: value.goal.trim(),
  };
  const audience = optionalString(value.audience, "audience", 120);
  if (audience) request.audience = audience;
  const granularity = optionalIntegerInRange(value.granularity, "granularity", 1, 5);
  const expansionRadius = optionalIntegerInRange(value.expansionRadius, "expansionRadius", 1, 3);
  const maxNodes = optionalIntegerInRange(value.maxNodes, "maxNodes", 8, 60);
  const confidenceThreshold = optionalFiniteNumberInRange(value.confidenceThreshold, "confidenceThreshold", 0.3, 0.95);
  if (granularity !== undefined) request.granularity = granularity as typeof request.granularity;
  if (expansionRadius !== undefined) request.expansionRadius = expansionRadius as typeof request.expansionRadius;
  if (maxNodes !== undefined) request.maxNodes = maxNodes;
  if (confidenceThreshold !== undefined) request.confidenceThreshold = confidenceThreshold;
  if (value.initialDraft !== undefined) {
    request.initialDraft = normalizeAgentGraphDraft(value.initialDraft, notes);
  }
  if (JSON.stringify(request).length > 2_000_000) {
    throw new RangeError("Agent run request must be at most 2000000 serialized characters.");
  }
  return request;
}

function sourceNotes(input: KnowledgeAgentRunRequest<AgentGraphDraft>): SourceNote[] {
  const notes = input.notes ?? (input.note ? [input.note] : []);
  return notes.map((note) => ({
    id: note.id ?? "",
    title: note.title,
    content: note.content,
    source: note.source ?? "",
    capturedAt: note.capturedAt ?? "",
    confidence: note.confidence ?? 0.8,
  }));
}

function failureFrom(error: unknown): KnowledgeAgentRunError {
  const invalidInput = error instanceof TypeError || error instanceof RangeError;
  return {
    code: invalidInput ? "invalid-input" : "execution-failed",
    message: error instanceof Error ? error.message : "Knowledge agent execution failed.",
    retryable: !invalidInput,
  };
}

export async function executeKnowledgeAgentRun(
  store: KnowledgeAgentRunStore,
  inputValue: unknown,
  options: {
    parentRunId?: string;
    attempt?: number;
    provider?: KnowledgeAgentModel;
    now?: () => Date;
    runId?: string;
  } = {},
): Promise<StoredKnowledgeAgentRun> {
  const input = normalizeKnowledgeAgentRunRequest(inputValue);
  const now = options.now ?? (() => new Date());
  const startedAt = now().toISOString();
  const runId = options.runId ?? `agent_run_${crypto.randomUUID().replaceAll("-", "")}`;
  assertKnowledgeAgentRunId(runId);
  const heuristicProvider = createHeuristicKnowledgeModel();
  const provider = options.provider ?? (input.initialDraft
    ? {
        ...heuristicProvider,
        name: "host-native-draft-v1",
        supportsSemanticExpansion: true,
      }
    : heuristicProvider);
  const running: StoredKnowledgeAgentRun = {
    runId,
    status: "running",
    parentRunId: options.parentRunId,
    attempt: options.attempt ?? 1,
    provider: provider.name,
    input,
    createdAt: startedAt,
    startedAt,
    updatedAt: startedAt,
  };
  await store.create(running);

  let result;
  try {
    result = await runKnowledgeAgent({
      notes: sourceNotes(input),
      goal: input.goal,
      audience: input.audience,
      granularity: input.granularity,
      expansionRadius: input.expansionRadius,
      maxNodes: input.maxNodes,
      confidenceThreshold: input.confidenceThreshold,
      provider,
      initialDraft: input.initialDraft,
      now: now(),
    });
  } catch (error) {
    return store.fail(runId, failureFrom(error), now().toISOString());
  }

  result = { ...result, runId };
  return store.complete(runId, result, now().toISOString());
}

function mergeRunRequest(
  previous: KnowledgeAgentRunRequest<AgentGraphDraft>,
  overridesValue: unknown,
) {
  if (!isRecord(overridesValue)) throw new TypeError("Recompute request must be a JSON object.");
  const merged: Record<string, unknown> = { ...previous };
  const accepted = [
    "note",
    "notes",
    "goal",
    "audience",
    "granularity",
    "expansionRadius",
    "maxNodes",
    "confidenceThreshold",
    "initialDraft",
  ] as const;
  for (const key of accepted) {
    if (overridesValue[key] !== undefined) merged[key] = overridesValue[key];
  }
  if (overridesValue.note !== undefined) delete merged.notes;
  if (overridesValue.notes !== undefined) delete merged.note;
  return normalizeKnowledgeAgentRunRequest(merged);
}

export function assertKnowledgeAgentRunId(runId: string) {
  if (!RUN_ID_PATTERN.test(runId)) throw new TypeError("Invalid knowledge agent run id.");
}

export function parseKnowledgeAgentRunStatus(value: string | null) {
  if (!value) return undefined;
  if (!RUN_STATUSES.has(value as KnowledgeAgentRunStatus)) throw new TypeError("Invalid run status filter.");
  return value as KnowledgeAgentRunStatus;
}

export function isTerminalKnowledgeAgentRun(status: KnowledgeAgentRunStatus) {
  return status === "completed" || status === "partial" || status === "failed";
}

export function buildKnowledgeAgentRunEvent(
  run: StoredKnowledgeAgentRun,
): KnowledgeAgentRunEvent<StoredKnowledgeAgentRun["result"], AgentGraphDraft> {
  return {
    eventId: `${run.runId}:${run.updatedAt}`,
    type: `run.${run.status}`,
    runId: run.runId,
    occurredAt: run.updatedAt,
    terminal: isTerminalKnowledgeAgentRun(run.status),
    run,
  };
}

export async function createKnowledgeAgentRun(database: D1Database, input: unknown) {
  const repository = new D1KnowledgeAgentRunRepository(database);
  await repository.initialize();
  return executeKnowledgeAgentRun(repository, input);
}

export async function getKnowledgeAgentRun(database: D1Database, runId: string) {
  assertKnowledgeAgentRunId(runId);
  const repository = new D1KnowledgeAgentRunRepository(database);
  await repository.initialize();
  const run = await repository.get(runId);
  if (!run) throw new KnowledgeAgentRunNotFoundError(runId);
  return run;
}

export async function listKnowledgeAgentRuns(database: D1Database, options: {
  limit?: number;
  cursor?: string;
  status?: KnowledgeAgentRunStatus;
} = {}): Promise<KnowledgeAgentRunList> {
  const repository = new D1KnowledgeAgentRunRepository(database);
  await repository.initialize();
  return repository.list(options);
}

export async function recomputeKnowledgeAgentRun(
  database: D1Database,
  runId: string,
  overrides: unknown,
) {
  const repository = new D1KnowledgeAgentRunRepository(database);
  await repository.initialize();
  return recomputeKnowledgeAgentRunWithStore(repository, runId, overrides);
}

export async function recomputeKnowledgeAgentRunWithStore(
  store: KnowledgeAgentRunStore,
  runId: string,
  overrides: unknown,
  options: {
    provider?: KnowledgeAgentModel;
    now?: () => Date;
    runId?: string;
  } = {},
) {
  assertKnowledgeAgentRunId(runId);
  const previous = await store.get(runId);
  if (!previous) throw new KnowledgeAgentRunNotFoundError(runId);
  if (!isTerminalKnowledgeAgentRun(previous.status)) {
    throw new KnowledgeAgentRunConflictError(`Run ${runId} is still ${previous.status} and cannot be recomputed.`);
  }
  const input = mergeRunRequest(previous.input, overrides);
  return executeKnowledgeAgentRun(store, input, {
    parentRunId: previous.runId,
    attempt: previous.attempt + 1,
    provider: options.provider,
    now: options.now,
    runId: options.runId,
  });
}
