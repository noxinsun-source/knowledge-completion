import type { MapGranularity, MapSpec, MapSpecSuggestion } from "../../contracts/src/index.ts";

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function finiteNumber(value: unknown, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function validateMapSpec(input: Partial<MapSpec> & Pick<MapSpec, "goal">): MapSpec {
  const goal = input.goal?.trim();
  if (!goal) throw new TypeError("goal must be a non-empty string.");
  if (goal.length > 300) throw new RangeError("goal must be at most 300 characters.");
  const granularity = clamp(Math.round(finiteNumber(input.granularity, 3)), 1, 5) as MapGranularity;
  const expansionRadius = clamp(Math.round(finiteNumber(input.expansionRadius, 2)), 1, 3) as 1 | 2 | 3;
  const maxNodes = clamp(Math.round(finiteNumber(input.maxNodes, 24)), 8, 60);
  const confidenceThreshold = Number(
    clamp(finiteNumber(input.confidenceThreshold, 0.58), 0.3, 0.95).toFixed(2),
  );
  return {
    goal,
    audience: input.audience?.trim().slice(0, 120) || "有基础、希望系统理解的学习者",
    granularity,
    expansionRadius,
    maxNodes,
    confidenceThreshold,
  };
}

export function suggestMapSpec(goalInput: string, audienceInput?: string): MapSpecSuggestion {
  const goal = goalInput.trim();
  const lower = goal.toLocaleLowerCase("zh-CN");
  let granularity: MapGranularity = 3;
  const rationale: string[] = [];
  if (/入门|概览|是什么|小白|快速了解/.test(lower)) {
    granularity = 2;
    rationale.push("目标偏入门或概览，先保留主干概念。 ");
  } else if (/推导|研究|论文|源码|实现|性能|工程|深入|系统/.test(lower)) {
    granularity = /推导|研究|源码/.test(lower) ? 5 : 4;
    rationale.push("目标包含深入、推导或工程信号，需要展开实现层概念。 ");
  } else {
    rationale.push("目标没有极端深浅信号，采用可学习的中等粒度。 ");
  }
  const expansionRadius = (/全景|系统|完整|知识树/.test(lower) ? 3 : /快速|重点/.test(lower) ? 1 : 2) as 1 | 2 | 3;
  const maxNodes = expansionRadius === 3 ? 42 : expansionRadius === 2 ? 26 : 14;
  rationale.push(`按目标广度选择 ${expansionRadius} 跳，节点上限 ${maxNodes}。`);
  return {
    spec: validateMapSpec({
      goal,
      audience: audienceInput,
      granularity,
      expansionRadius,
      maxNodes,
      confidenceThreshold: 0.58,
    }),
    rationale,
    inferredFrom: "goal-heuristic",
  };
}
