export {
  analyzeKnowledgeNetwork,
  analyzeNoteEvidence,
  composeKnowledgeAnalysis,
  type NoteEvidenceContribution,
} from "./analyze.ts";
export { buildDynamicMap, compareMapVersions, nodeGranularity } from "./dynamic-map.ts";
export { resolveConceptName } from "./concept-resolution.ts";
export { generateTutorLesson } from "./lesson.ts";
export { calculateConceptMastery } from "./mastery.ts";
export { suggestMapSpec, validateMapSpec } from "./map-spec.ts";
export {
  ATLAS_SCOPE,
  ATLAS_SCOPE_VERSION,
  KNOWLEDGE_EDGES,
  KNOWLEDGE_NODES,
  getKnowledgeNode,
} from "./catalog.ts";
