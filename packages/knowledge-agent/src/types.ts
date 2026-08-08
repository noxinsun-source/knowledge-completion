import type { MapGranularity, MapSpec, SourceNote } from "../../contracts/src/index.ts";

export type AgentSemanticType =
  | "domain"
  | "topic"
  | "concept"
  | "mechanism"
  | "method"
  | "tool"
  | "formula"
  | "example";

export type AgentRelationType =
  | "contains"
  | "prerequisite"
  | "enables"
  | "applied_in"
  | "part_of"
  | "contrasts_with"
  | "related_to";

export interface AgentEvidence {
  id: string;
  sourceType: "note" | "model" | "web";
  sourceId: string;
  sourceTitle: string;
  excerpt: string;
  url?: string;
  confidence: number;
}

export interface DraftConcept {
  name: string;
  aliases?: string[];
  semanticType: AgentSemanticType;
  granularity: MapGranularity;
  description: string;
  whyItMatters?: string;
  parentNames?: string[];
  evidence?: Array<{
    sourceNoteId?: string;
    excerpt: string;
    confidence?: number;
  }>;
  confidence: number;
  expandable?: boolean;
}

export interface DraftRelation {
  sourceName: string;
  targetName: string;
  relation: AgentRelationType;
  statement: string;
  evidence?: Array<{
    sourceNoteId?: string;
    excerpt: string;
    confidence?: number;
  }>;
  confidence: number;
}

export interface AgentGraphDraft {
  scope: string;
  scopeDescription: string;
  concepts: DraftConcept[];
  relations: DraftRelation[];
}

export interface AgentConcept {
  id: string;
  name: string;
  aliases: string[];
  semanticType: AgentSemanticType;
  granularity: MapGranularity;
  description: string;
  whyItMatters: string;
  parentIds: string[];
  childIds: string[];
  evidenceIds: string[];
  confidence: number;
  coverage: "missing" | "partial" | "covered";
  discoveryState: "seed" | "expanded" | "boundary";
  expandable: boolean;
  depth: number;
}

export interface AgentRelation {
  id: string;
  sourceId: string;
  targetId: string;
  relation: AgentRelationType;
  statement: string;
  evidenceIds: string[];
  confidence: number;
  reviewState: "accepted" | "needs-review";
}

export interface CanonicalAgentGraph {
  scope: string;
  scopeDescription: string;
  rootNodeId: string;
  concepts: AgentConcept[];
  relations: AgentRelation[];
  evidence: AgentEvidence[];
}

export interface ProjectionNode extends AgentConcept {
  aggregateMemberIds: string[];
  collapsed: boolean;
  aggregateCoverage: number;
}

export interface ProjectionEdge extends AgentRelation {
  aggregateRelationIds: string[];
}

export interface GranularityProjection {
  granularity: MapGranularity;
  nodes: ProjectionNode[];
  edges: ProjectionEdge[];
  hiddenNodeCount: number;
  coverage: number;
}

export interface AgentRoundTrace {
  round: number;
  frontierIds: string[];
  proposedConcepts: number;
  acceptedConcepts: number;
  mergedConcepts: number;
  rejectedConcepts: number;
  noveltyRatio: number;
  stopReason?: string;
}

export interface KnowledgeAgentRun {
  runId: string;
  status: "completed" | "partial";
  provider: string;
  generatedAt: string;
  mapSpec: MapSpec;
  notes: SourceNote[];
  graph: CanonicalAgentGraph;
  projections: Record<MapGranularity, GranularityProjection>;
  selectedProjection: GranularityProjection;
  trace: AgentRoundTrace[];
  warnings: string[];
  metrics: {
    durationMs: number;
    modelCalls: number;
    conceptCount: number;
    relationCount: number;
    evidenceCount: number;
  };
}

export interface KnowledgeAgentModel {
  readonly name: string;
  readonly supportsSemanticExpansion: boolean;
  analyze(input: {
    notes: SourceNote[];
    spec: MapSpec;
  }): Promise<AgentGraphDraft>;
  expand(input: {
    graph: CanonicalAgentGraph;
    frontier: AgentConcept[];
    notes: SourceNote[];
    spec: MapSpec;
    round: number;
  }): Promise<AgentGraphDraft>;
}

export interface KnowledgeAgentOptions {
  notes: SourceNote[];
  goal: string;
  audience?: string;
  granularity?: MapGranularity;
  expansionRadius?: 1 | 2 | 3;
  maxNodes?: number;
  confidenceThreshold?: number;
  provider: KnowledgeAgentModel;
  initialDraft?: AgentGraphDraft;
  now?: Date;
}
