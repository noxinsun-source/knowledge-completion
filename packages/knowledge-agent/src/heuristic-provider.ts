import type { MapGranularity, SourceNote } from "../../contracts/src/index.ts";
import type {
  AgentGraphDraft,
  AgentRelationType,
  DraftConcept,
  DraftRelation,
  KnowledgeAgentModel,
} from "./types.ts";
import { normalizeConceptName } from "./graph.ts";

function clampGranularity(value: number) {
  return Math.min(5, Math.max(1, Math.round(value))) as MapGranularity;
}

function cleanTerm(value: string) {
  return value
    .replace(/^[#>*\-+\d.、\s]+/, "")
    .replace(/[*_`「」『』“”"']/g, "")
    .replace(/^(所谓|其中|此外|同时|因此|因为|如果|通过|对于)/, "")
    .replace(/[，。；：:！？!?][\s\S]*$/, "")
    .trim()
    .slice(0, 80);
}

function looksLikeConcept(value: string) {
  const cleaned = cleanTerm(value);
  return cleaned.length >= 2 && cleaned.length <= 48 && !/^(本文|文章|内容|问题|情况|这个|一种|一些|可以|需要)$/.test(cleaned);
}

function sentenceExcerpt(content: string, term: string) {
  const index = content.toLocaleLowerCase("zh-CN").indexOf(term.toLocaleLowerCase("zh-CN"));
  if (index < 0) return content.slice(0, 260);
  const start = Math.max(0, index - 72);
  const end = Math.min(content.length, index + term.length + 150);
  return `${start ? "…" : ""}${content.slice(start, end)}${end < content.length ? "…" : ""}`;
}

function semanticType(granularity: MapGranularity): DraftConcept["semanticType"] {
  return ({ 1: "domain", 2: "topic", 3: "concept", 4: "mechanism", 5: "example" } as const)[granularity];
}

function addConcept(
  concepts: Map<string, DraftConcept>,
  input: Omit<DraftConcept, "confidence"> & { confidence?: number },
) {
  const name = cleanTerm(input.name);
  if (!looksLikeConcept(name)) return;
  const key = normalizeConceptName(name);
  const candidate: DraftConcept = {
    ...input,
    name,
    description: input.description.trim().slice(0, 800) || `笔记中出现了“${name}”。`,
    confidence: input.confidence ?? 0.72,
  };
  const current = concepts.get(key);
  if (!current) {
    concepts.set(key, candidate);
    return;
  }
  concepts.set(key, {
    ...current,
    aliases: [...new Set([...(current.aliases ?? []), ...(candidate.aliases ?? [])])],
    parentNames: [...new Set([...(current.parentNames ?? []), ...(candidate.parentNames ?? [])])],
    evidence: [...(current.evidence ?? []), ...(candidate.evidence ?? [])],
    confidence: Math.max(current.confidence, candidate.confidence),
    granularity: Math.min(current.granularity, candidate.granularity) as MapGranularity,
    description: current.description.length >= candidate.description.length ? current.description : candidate.description,
  });
}

function addRelation(relations: Map<string, DraftRelation>, relation: DraftRelation) {
  const source = cleanTerm(relation.sourceName);
  const target = cleanTerm(relation.targetName);
  if (!looksLikeConcept(source) || !looksLikeConcept(target) || normalizeConceptName(source) === normalizeConceptName(target)) return;
  const key = `${normalizeConceptName(source)}:${relation.relation}:${normalizeConceptName(target)}`;
  const candidate = { ...relation, sourceName: source, targetName: target };
  const current = relations.get(key);
  if (!current || candidate.confidence > current.confidence) relations.set(key, candidate);
}

function splitMembers(value: string) {
  return value
    .split(/[、，,；;]|以及|和|与/)
    .map(cleanTerm)
    .filter(looksLikeConcept)
    .slice(0, 12);
}

function inferExplicitRelations(
  note: SourceNote,
  concepts: Map<string, DraftConcept>,
  relations: Map<string, DraftRelation>,
  rootName: string,
) {
  const sentences = note.content.split(/[。！？!?\n]+/).map((sentence) => sentence.trim()).filter(Boolean);
  for (const sentence of sentences) {
    const includes = sentence.match(/^(.{2,32}?)(?:包括|包含|由)(.{2,100}?)(?:组成|构成)?$/);
    if (includes) {
      const parent = cleanTerm(includes[1]);
      const members = splitMembers(includes[2]);
      addConcept(concepts, { name: parent, semanticType: "concept", granularity: 3, description: sentence, parentNames: [rootName], evidence: [{ sourceNoteId: note.id, excerpt: sentence, confidence: 0.86 }], confidence: 0.86 });
      for (const member of members) {
        addConcept(concepts, { name: member, semanticType: "mechanism", granularity: 4, description: sentence, parentNames: [parent], evidence: [{ sourceNoteId: note.id, excerpt: sentence, confidence: 0.84 }], confidence: 0.84 });
        addRelation(relations, { sourceName: member, targetName: parent, relation: "part_of", statement: `${member}是${parent}的一部分`, evidence: [{ sourceNoteId: note.id, excerpt: sentence, confidence: 0.84 }], confidence: 0.84 });
      }
    }

    const dependency = sentence.match(/^(.{2,36}?)(?:依赖|需要先理解|建立在)(.{2,50})$/);
    if (dependency) {
      const target = cleanTerm(dependency[1]);
      for (const prerequisite of splitMembers(dependency[2])) {
        addConcept(concepts, { name: prerequisite, semanticType: "concept", granularity: 3, description: sentence, parentNames: [rootName], evidence: [{ sourceNoteId: note.id, excerpt: sentence, confidence: 0.8 }], confidence: 0.8 });
        addConcept(concepts, { name: target, semanticType: "concept", granularity: 3, description: sentence, parentNames: [rootName], evidence: [{ sourceNoteId: note.id, excerpt: sentence, confidence: 0.8 }], confidence: 0.8 });
        addRelation(relations, { sourceName: prerequisite, targetName: target, relation: "prerequisite", statement: `理解${target}前需要掌握${prerequisite}`, evidence: [{ sourceNoteId: note.id, excerpt: sentence, confidence: 0.8 }], confidence: 0.8 });
      }
    }

    const affects = sentence.match(/^(.{2,30}?)(?:影响|决定)(.{2,42})$/);
    if (affects) {
      const source = cleanTerm(affects[1]);
      const target = cleanTerm(affects[2]);
      addConcept(concepts, { name: source, semanticType: "concept", granularity: 3, description: sentence, parentNames: [rootName], evidence: [{ sourceNoteId: note.id, excerpt: sentence, confidence: 0.78 }], confidence: 0.78 });
      addConcept(concepts, { name: target, semanticType: "concept", granularity: 3, description: sentence, parentNames: [rootName], evidence: [{ sourceNoteId: note.id, excerpt: sentence, confidence: 0.78 }], confidence: 0.78 });
      addRelation(relations, { sourceName: source, targetName: target, relation: "enables", statement: sentence, evidence: [{ sourceNoteId: note.id, excerpt: sentence, confidence: 0.74 }], confidence: 0.74 });
    }

    const contrast = sentence.match(/^(.{2,30}?)(?:相比|不同于|区别于)(.{2,36})$/);
    if (contrast) {
      const source = cleanTerm(contrast[1]);
      const target = cleanTerm(contrast[2]);
      addConcept(concepts, { name: source, semanticType: "concept", granularity: 3, description: sentence, parentNames: [rootName], evidence: [{ sourceNoteId: note.id, excerpt: sentence, confidence: 0.75 }], confidence: 0.75 });
      addConcept(concepts, { name: target, semanticType: "concept", granularity: 3, description: sentence, parentNames: [rootName], evidence: [{ sourceNoteId: note.id, excerpt: sentence, confidence: 0.75 }], confidence: 0.75 });
      addRelation(relations, { sourceName: source, targetName: target, relation: "contrasts_with", statement: sentence, evidence: [{ sourceNoteId: note.id, excerpt: sentence, confidence: 0.75 }], confidence: 0.75 });
    }
  }
}

function analyzeNotes(notes: SourceNote[], goal: string): AgentGraphDraft {
  const rootName = cleanTerm(notes[0]?.title || goal || "知识地图");
  const concepts = new Map<string, DraftConcept>();
  const relations = new Map<string, DraftRelation>();
  addConcept(concepts, {
    name: rootName,
    semanticType: "domain",
    granularity: 1,
    description: `围绕“${goal}”建立的知识范围，以用户笔记为第一层证据。`,
    whyItMatters: "它定义本次地图的边界和覆盖率分母。",
    evidence: notes.map((note) => ({ sourceNoteId: note.id, excerpt: note.content.slice(0, 260), confidence: note.confidence })),
    confidence: 1,
  });

  for (const note of notes) {
    const headingStack: Array<{ level: number; name: string }> = [{ level: 0, name: rootName }];
    for (const rawLine of note.content.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line) continue;
      const heading = line.match(/^(#{1,5})\s+(.+)$/);
      if (heading) {
        const level = heading[1].length;
        const name = cleanTerm(heading[2]);
        while (headingStack.length && headingStack[headingStack.length - 1].level >= level) headingStack.pop();
        const parent = headingStack.at(-1)?.name ?? rootName;
        const granularity = clampGranularity(level === 1 ? 2 : level);
        addConcept(concepts, { name, semanticType: semanticType(granularity), granularity, description: sentenceExcerpt(note.content, name), parentNames: [parent], evidence: [{ sourceNoteId: note.id, excerpt: sentenceExcerpt(note.content, name), confidence: 0.9 }], confidence: 0.9 });
        addRelation(relations, { sourceName: name, targetName: parent, relation: "part_of", statement: `${name}属于${parent}`, evidence: [{ sourceNoteId: note.id, excerpt: rawLine, confidence: 0.9 }], confidence: 0.9 });
        headingStack.push({ level, name });
        continue;
      }

      const bullet = line.match(/^[-*+]\s+(?:\*\*)?([^：:*]{2,48})(?:\*\*)?[：:]\s*(.+)$/);
      if (bullet) {
        const name = cleanTerm(bullet[1]);
        const parent = headingStack.at(-1)?.name ?? rootName;
        const parentGranularity = concepts.get(normalizeConceptName(parent))?.granularity ?? 2;
        const granularity = clampGranularity(parentGranularity + 1);
        addConcept(concepts, { name, semanticType: semanticType(granularity), granularity, description: bullet[2], parentNames: [parent], evidence: [{ sourceNoteId: note.id, excerpt: line, confidence: 0.9 }], confidence: 0.9 });
        addRelation(relations, { sourceName: name, targetName: parent, relation: "part_of", statement: `${name}属于${parent}`, evidence: [{ sourceNoteId: note.id, excerpt: line, confidence: 0.9 }], confidence: 0.9 });
      }

      for (const match of line.matchAll(/\*\*([^*]{2,48})\*\*/g)) {
        const name = cleanTerm(match[1]);
        const parent = headingStack.at(-1)?.name ?? rootName;
        const parentGranularity = concepts.get(normalizeConceptName(parent))?.granularity ?? 2;
        const granularity = clampGranularity(parentGranularity + 1);
        addConcept(concepts, { name, semanticType: semanticType(granularity), granularity, description: sentenceExcerpt(note.content, name), parentNames: [parent], evidence: [{ sourceNoteId: note.id, excerpt: line, confidence: 0.86 }], confidence: 0.86 });
      }
    }
    inferExplicitRelations(note, concepts, relations, rootName);
  }
  return {
    scope: goal || rootName,
    scopeDescription: `由 ${notes.length} 篇笔记抽取的证据图；离线模式只保留文本中能够追溯的概念与关系。`,
    concepts: [...concepts.values()],
    relations: [...relations.values()],
  };
}

export function createHeuristicKnowledgeModel(): KnowledgeAgentModel {
  return {
    name: "heuristic-offline-v1",
    supportsSemanticExpansion: false,
    async analyze({ notes, spec }) {
      return analyzeNotes(notes, spec.goal);
    },
    async expand({ graph }) {
      return {
        scope: graph.scope,
        scopeDescription: graph.scopeDescription,
        concepts: [],
        relations: [],
      };
    },
  };
}

export const HEURISTIC_RELATION_TYPES: AgentRelationType[] = [
  "contains", "prerequisite", "enables", "applied_in", "part_of", "contrasts_with", "related_to",
];
