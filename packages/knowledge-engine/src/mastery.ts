import type {
  ConceptMastery,
  MasteryEvidenceRecord,
  MasteryLevel,
} from "../../contracts/src/index.ts";

const EVIDENCE_WEIGHT = { saved: 0.15, quiz: 0.55, explanation: 0.75, project: 1 } as const;
const HALF_LIFE_DAYS = { saved: 21, quiz: 45, explanation: 90, project: 180 } as const;

export function calculateConceptMastery(
  conceptId: string,
  evidence: MasteryEvidenceRecord[],
  now = new Date(),
): ConceptMastery {
  const relevant = evidence.filter((item) => item.conceptId === conceptId).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const decayed = relevant.map((item) => {
    const ageDays = Math.max(0, (now.getTime() - new Date(item.createdAt).getTime()) / 86_400_000);
    const decay = Math.pow(0.5, ageDays / HALF_LIFE_DAYS[item.evidenceType]);
    return { item, value: item.score * EVIDENCE_WEIGHT[item.evidenceType] * decay };
  });
  const strongest = decayed.sort((a, b) => b.value - a.value)[0];
  const breadthBonus = Math.min(0.15, new Set(relevant.map((item) => item.evidenceType)).size * 0.04);
  const score = Number(Math.min(1, (strongest?.value ?? 0) + breadthBonus).toFixed(3));
  const hasProject = relevant.some((item) => item.evidenceType === "project" && item.score >= 0.7);
  const hasUnderstanding = relevant.some((item) => ["quiz", "explanation", "project"].includes(item.evidenceType) && item.score >= 0.65);
  let level: MasteryLevel = "unknown";
  if (relevant.length) level = "seen";
  if (hasUnderstanding && score >= 0.42) level = "understood";
  if (hasProject && score >= 0.7) level = "applied";
  const lastVerifiedAt = relevant.find((item) => item.evidenceType !== "saved")?.createdAt ?? relevant[0]?.createdAt;
  const reviewDays = level === "applied" ? 90 : level === "understood" ? 30 : level === "seen" ? 7 : 1;
  const nextReviewDate = lastVerifiedAt ? new Date(new Date(lastVerifiedAt).getTime() + reviewDays * 86_400_000) : undefined;
  return {
    conceptId,
    level,
    score,
    evidenceCount: relevant.length,
    lastVerifiedAt,
    nextReviewAt: nextReviewDate?.toISOString(),
    needsReverification: Boolean(nextReviewDate && nextReviewDate <= now),
    strongestEvidenceType: strongest?.item.evidenceType,
    evidence: relevant,
  };
}
