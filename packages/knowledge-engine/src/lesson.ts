import type { AnalyzedKnowledgeNode, TutorLesson } from "../../contracts/src/index.ts";

export function generateTutorLesson(node: AnalyzedKnowledgeNode): TutorLesson {
  const prerequisites = node.prerequisites.length ? node.prerequisites.join("、") : "当前知识域的基本问题";
  const firstKeyword = node.keywords[0] ?? node.label;
  return {
    nodeId: node.id,
    title: `微课程：${node.label}`,
    provider: "local-teaching-agent",
    duration: "12–18 分钟",
    hook: `先回答一个问题：如果拿掉“${node.label}”，整个系统最先失去什么能力？`,
    explanation: `${node.description} ${node.whyItMatters}`,
    analogy: `把“${node.label}”看成系统中的一个可验证零件：输入来自 ${prerequisites}，输出会支持 ${node.outcomes.join("、") || "后续实践"}。不要只记名称，要能说明输入、变换和输出。`,
    connections: [...node.prerequisites, ...node.outcomes].slice(0, 6),
    steps: [
      { title: "建立直觉", task: `用自己的话写一句“${node.label}是什么”，不得复用定义原句。`, minutes: 3 },
      { title: "连接上下游", task: `分别解释它与 ${prerequisites} 的关系，以及它支撑的后续概念。`, minutes: 4 },
      { title: "制作证据", task: `写一个包含“${firstKeyword}”的例子、推导或最小实现，并记录失败条件。`, minutes: 6 },
      { title: "延迟复述", task: "关闭资料，90 秒后重新复述；把遗漏点作为下一次复习线索。", minutes: 3 },
    ],
    check: {
      question: `哪一种行为最能证明你已经“理解”${node.label}，而不只是收藏？`,
      options: ["保存三篇文章", "能脱离原文解释机制并给出反例", "浏览定义一次", "给节点换一个颜色"],
      answerIndex: 1,
      explanation: "可脱离原文复述、连接上下游并识别失败条件，才形成可验证的理解证据。",
    },
    noteTemplate: [
      `一句话定义：${node.label} 是……`,
      "输入 / 前置：……",
      "核心过程：……",
      "输出 / 作用：……",
      "一个例子：……",
      "一个失败条件或反例：……",
    ],
  };
}
