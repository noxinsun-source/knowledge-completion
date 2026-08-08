export type CoverageStatus = "mastered" | "covered" | "partial" | "missing";

export type KnowledgeRelation =
  | "contains"
  | "prerequisite"
  | "enables"
  | "applies"
  | "part_of"
  | "contrasts";

export type MapGranularity = 1 | 2 | 3 | 4 | 5;
export type MapStatus = "draft" | "frozen";
export type MasteryLevel = "unknown" | "seen" | "understood" | "applied";

export interface SourceNote {
  id: string;
  title: string;
  content: string;
  source: string;
  capturedAt: string;
  confidence: number;
}

export interface KnowledgeNodeDefinition {
  id: string;
  label: string;
  labelEn: string;
  group: string;
  categoryPath: string[];
  description: string;
  whyItMatters: string;
  x: number;
  y: number;
  weight: number;
  keywords: string[];
  prerequisites: string[];
  outcomes: string[];
  kind?: "domain" | "concept";
  granularity?: MapGranularity;
  aliases?: string[];
  confidence?: number;
  sourceCount?: number;
  discoveryState?: "seed" | "expanded" | "boundary";
  isExpandable?: boolean;
}

export interface KnowledgeEdge {
  id: string;
  source: string;
  target: string;
  relation: KnowledgeRelation;
  confidence?: number;
  evidenceSourceIds?: string[];
  statement?: string;
}

export interface MasteryState {
  level: MasteryLevel;
  score: number;
  evidenceCount: number;
  lastVerifiedAt?: string;
  nextReviewAt?: string;
  needsReverification?: boolean;
  strongestEvidenceType?: MasteryEvidenceInput["evidenceType"];
}

export interface NodeEvidence {
  noteId: string;
  noteTitle: string;
  source: string;
  excerpt: string;
  matchedKeywords: string[];
  score: number;
}

export interface AnalyzedKnowledgeNode extends KnowledgeNodeDefinition {
  score: number;
  status: CoverageStatus;
  evidence: NodeEvidence[];
  gapReason?: string;
  priority: number;
  mastery?: MasteryState;
}

export interface CoverageSummary {
  noteCount: number;
  conceptCount: number;
  coveredCount: number;
  missingCount: number;
  topicCoverage: number;
  weightedCoverage: number;
  depthCoverage: number;
  structuralCompleteness: number;
}

export interface KnowledgeAnalysis {
  id: string;
  scope: string;
  scopeVersion: string;
  mode: "repository" | "single" | "discovery";
  focusNoteId?: string;
  focusNodeIds: string[];
  generatedAt: string;
  nodes: AnalyzedKnowledgeNode[];
  edges: KnowledgeEdge[];
  notes: SourceNote[];
  summary: CoverageSummary;
  recommendedNext: string[];
  pipeline: Array<{
    name: string;
    detail: string;
    count: number;
  }>;
}

export interface MapSpec {
  goal: string;
  audience: string;
  granularity: MapGranularity;
  expansionRadius: 1 | 2 | 3;
  maxNodes: number;
  confidenceThreshold: number;
}

export interface MapSpecSuggestion {
  spec: MapSpec;
  rationale: string[];
  inferredFrom: "goal-heuristic";
}

export interface ExternalKnowledgeSource {
  id: string;
  provider: "crossref" | "europe-pmc" | "arxiv" | "openalex" | "wikipedia";
  title: string;
  url: string;
  canonicalUrl: string;
  doi?: string;
  abstract?: string;
  authors: string[];
  publishedYear?: number;
  citedByCount?: number;
  sourceType: "paper" | "preprint" | "book" | "dataset" | "other";
  trustScore: number;
  trustSignals: string[];
  matchedConceptIds: string[];
  duplicateProviders: string[];
  fetchedContent?: string;
  fetchedAt?: string;
}

export interface SourceDiscoveryResult {
  query: string;
  providers: Array<{
    provider: ExternalKnowledgeSource["provider"];
    ok: boolean;
    count: number;
    latencyMs: number;
    error?: string;
  }>;
  sources: ExternalKnowledgeSource[];
  rawCount: number;
  duplicateCount: number;
  generatedAt: string;
}

export interface DiscoverySource {
  id: string;
  title: string;
  sourceType: "paper" | "course" | "handbook" | "glossary";
  authority: number;
  conceptIds: string[];
}

export interface DiscoveryRound {
  round: number;
  frontierIds: string[];
  newNodeIds: string[];
  rejectedByBoundary: number;
}

export interface CanonicalMerge {
  canonicalId: string;
  canonicalName: string;
  aliases: string[];
  confidence: number;
}

export interface ConceptResolution {
  input: string;
  canonicalId?: string;
  canonicalName?: string;
  confidence: number;
  ambiguous: boolean;
  candidates: Array<{ id: string; label: string; score: number }>;
}

export interface DiscoveryMap {
  id: string;
  status: MapStatus;
  version: number;
  mapSpec: MapSpec;
  seedNoteId: string;
  seedConceptIds: string[];
  goalConceptIds: string[];
  goalAlignment: number | null;
  analysis: KnowledgeAnalysis;
  sources: DiscoverySource[];
  externalSources?: ExternalKnowledgeSource[];
  rounds: DiscoveryRound[];
  convergence: number;
  canonicalMerges: CanonicalMerge[];
  boundaryNodeIds: string[];
  expandedNodeIds: string[];
  createdAt: string;
  frozenAt?: string;
  parentMapId?: string;
  revisionReason?: string;
  incremental?: IncrementalAnalysisSummary;
}

export interface IncrementalAnalysisSummary {
  analyzerVersion: string;
  cacheHits: number;
  recomputedNotes: number;
  ignoredCachedNotes: number;
}

export interface MapVersionSummary {
  id: string;
  version: number;
  status: MapStatus;
  goal: string;
  parentMapId?: string;
  createdAt: string;
  frozenAt?: string;
  nodeCount: number;
  coveredCount: number;
}

export interface MapVersionDiff {
  fromMapId: string;
  toMapId: string;
  addedNodeIds: string[];
  removedNodeIds: string[];
  statusChanges: Array<{
    nodeId: string;
    from: CoverageStatus;
    to: CoverageStatus;
  }>;
  coverageDelta: number;
  specChanges: Partial<Record<keyof MapSpec, { from: unknown; to: unknown }>>;
}

export interface MasteryEvidenceInput {
  mapId: string;
  conceptId: string;
  evidenceType: "saved" | "quiz" | "explanation" | "project";
  score: number;
  note?: string;
}

export interface MasteryEvidenceRecord extends MasteryEvidenceInput {
  id: string;
  createdAt: string;
}

export interface ConceptMastery extends MasteryState {
  conceptId: string;
  nextReviewAt?: string;
  needsReverification: boolean;
  strongestEvidenceType?: MasteryEvidenceInput["evidenceType"];
  evidence: MasteryEvidenceRecord[];
}

export interface MasteryUpdateResult {
  mastery: ConceptMastery;
  map: DiscoveryMap;
}

export interface AtlasNoteInput {
  title: string;
  content: string;
  source?: string;
  confidence?: number;
  capturedAt?: string;
}

export interface ConceptCorrectionInput {
  mapId: string;
  conceptId: string;
  action: "rename" | "merge" | "reject";
  proposedValue?: string;
  reason?: string;
}

export interface ConceptCorrection extends ConceptCorrectionInput {
  id: string;
  status: "pending" | "accepted" | "rejected";
  createdAt: string;
  resolvedAt?: string;
}

export interface TutorLesson {
  nodeId: string;
  title: string;
  provider: "local-teaching-agent";
  duration: string;
  hook: string;
  explanation: string;
  analogy: string;
  connections: string[];
  steps: Array<{ title: string; task: string; minutes: number }>;
  check: {
    question: string;
    options: string[];
    answerIndex: number;
    explanation: string;
  };
  noteTemplate: string[];
}

/**
 * A note accepted by the Agent Run HTTP API. Optional provenance fields are
 * normalized by the agent before they become part of a completed result.
 */
export interface KnowledgeAgentNoteInput {
  id?: string;
  title: string;
  content: string;
  source?: string;
  capturedAt?: string;
  confidence?: number;
}

/**
 * The persisted input for one knowledge-completion run. `TDraft` remains a
 * generic so the contracts package does not depend back on the agent package.
 */
export interface KnowledgeAgentRunRequest<TDraft = unknown> {
  note?: KnowledgeAgentNoteInput;
  notes?: KnowledgeAgentNoteInput[];
  goal: string;
  audience?: string;
  granularity?: MapGranularity;
  expansionRadius?: 1 | 2 | 3;
  maxNodes?: number;
  confidenceThreshold?: number;
  initialDraft?: TDraft;
}

export type KnowledgeAgentRunStatus =
  | "queued"
  | "running"
  | "completed"
  | "partial"
  | "failed";

export interface KnowledgeAgentRunError {
  code: "invalid-input" | "execution-failed";
  message: string;
  retryable: boolean;
}

/**
 * Durable envelope around an agent result. `TResult` is normally
 * `KnowledgeAgentRun` from packages/knowledge-agent, while remaining generic
 * keeps the dependency direction contracts -> agent acyclic.
 */
export interface KnowledgeAgentRunRecord<TResult = unknown, TDraft = unknown> {
  runId: string;
  status: KnowledgeAgentRunStatus;
  parentRunId?: string;
  attempt: number;
  provider: string;
  input: KnowledgeAgentRunRequest<TDraft>;
  result?: TResult;
  error?: KnowledgeAgentRunError;
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
  updatedAt: string;
}

export interface KnowledgeAgentRunSummary {
  runId: string;
  status: KnowledgeAgentRunStatus;
  parentRunId?: string;
  attempt: number;
  provider: string;
  goal: string;
  audience?: string;
  selectedGranularity?: MapGranularity;
  noteCount: number;
  conceptCount?: number;
  relationCount?: number;
  evidenceCount?: number;
  durationMs?: number;
  createdAt: string;
  completedAt?: string;
  updatedAt: string;
}

export interface KnowledgeAgentRunList {
  runs: KnowledgeAgentRunSummary[];
  nextCursor?: string;
}

export type KnowledgeAgentRunEventType =
  | "run.queued"
  | "run.running"
  | "run.completed"
  | "run.partial"
  | "run.failed";

/** A finite SSE snapshot today; the same contract supports asynchronous runs later. */
export interface KnowledgeAgentRunEvent<TResult = unknown, TDraft = unknown> {
  eventId: string;
  type: KnowledgeAgentRunEventType;
  runId: string;
  occurredAt: string;
  terminal: boolean;
  run: KnowledgeAgentRunRecord<TResult, TDraft>;
}
