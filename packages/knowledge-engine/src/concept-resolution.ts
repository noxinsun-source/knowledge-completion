import type { ConceptResolution } from "../../contracts/src/index.ts";
import { KNOWLEDGE_NODES } from "./catalog.ts";

function normalize(value: string) {
  return value.normalize("NFKC").toLocaleLowerCase("zh-CN").replace(/[\s_-]+/g, "");
}

export function resolveConceptName(input: string): ConceptResolution {
  const term = normalize(input);
  const candidates = KNOWLEDGE_NODES.filter((node) => node.kind !== "domain").map((node) => {
    const names = [node.label, node.labelEn, ...(node.aliases ?? [])];
    const keywords = node.keywords;
    let score = 0;
    if (names.some((name) => normalize(name) === term)) score = 1;
    else if (keywords.some((keyword) => normalize(keyword) === term)) score = 0.92;
    else if (names.some((name) => normalize(name).includes(term) || term.includes(normalize(name)))) score = 0.72;
    else if (keywords.some((keyword) => normalize(keyword).includes(term) || term.includes(normalize(keyword)))) score = 0.62;
    return { id: node.id, label: node.label, score };
  }).filter((candidate) => candidate.score > 0).sort((a, b) => b.score - a.score);
  const top = candidates[0];
  const ambiguous = Boolean(top && candidates[1] && top.score - candidates[1].score < 0.08);
  return {
    input,
    canonicalId: ambiguous ? undefined : top?.id,
    canonicalName: ambiguous ? undefined : top?.label,
    confidence: top?.score ?? 0,
    ambiguous,
    candidates: candidates.slice(0, 5),
  };
}
