"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

const GRANULARITY_OPTIONS = [
  { value: 1, label: "1 · 领域范围（最粗）" },
  { value: 2, label: "2 · 主题模块" },
  { value: 3, label: "3 · 核心概念（默认）" },
  { value: 4, label: "4 · 机制与方法" },
  { value: 5, label: "5 · 公式 / 实现 / 例子（最细）" },
] as const;

const HOP_OPTIONS = [
  { value: 1, label: "1 跳 · 直接相邻知识" },
  { value: 2, label: "2 跳 · 中等扩散（默认）" },
  { value: 3, label: "3 跳 · 广域扩散" },
] as const;

export function RunCreatorForm() {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [goal, setGoal] = useState("");
  const [audience, setAudience] = useState("");
  const [granularity, setGranularity] = useState(3);
  const [hops, setHops] = useState(2);
  const [maxNodes, setMaxNodes] = useState(30);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [modelStatus, setModelStatus] = useState<"checking" | "live" | "offline">("checking");

  useEffect(() => {
    let active = true;
    fetch("/api/health").then((r) => r.json()).then((p) => {
      if (!active) return;
      const health = p as { modelProvider?: string };
      setModelStatus(health.modelProvider === "openai-compatible" ? "live" : "offline");
    }).catch(() => { if (active) setModelStatus("offline"); });
    return () => { active = false; };
  }, []);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!content.trim()) { setError("请先粘贴一段笔记正文或话题描述。"); return; }
    setSubmitting(true);
    setError("");
    try {
      const response = await fetch("/api/runs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          notes: [{
            id: "note_1",
            title: title.trim() || "我的笔记",
            content: content.trim(),
            source: "web-ui",
            capturedAt: new Date().toISOString().slice(0, 10),
            confidence: 0.9,
          }],
          goal: goal.trim() || "系统理解这篇笔记所在的知识领域",
          audience: audience.trim() || undefined,
          granularity,
          expansionRadius: hops,
          maxNodes,
          confidenceThreshold: 0.5,
        }),
      });
      const payload = await response.json().catch(() => ({})) as { error?: string; run?: { runId: string; error?: { message?: string } } };
      if (!response.ok) { setError(payload.error ?? payload.run?.error?.message ?? `创建失败（HTTP ${response.status}）`); return; }
      if (!payload.run?.runId) { setError("响应缺少 runId，请稍后重试。"); return; }
      router.push(`/runs/${payload.run.runId}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "网络错误");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form className="run-creator" onSubmit={onSubmit}>
      <div className="run-creator-head">
        <h2>输入笔记，让 Agent 生成知识网络</h2>
        <span className={`model-pill is-${modelStatus}`}>
          {modelStatus === "live" ? "● 真实模型已接入" : modelStatus === "offline" ? "○ 离线提取模式（未配置模型）" : "… 检测模型状态"}
        </span>
      </div>

      <div className="run-creator-grid">
        <label className="field wide">
          <span>笔记正文 / 话题（必填）</span>
          <textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            rows={6}
            placeholder={"粘贴任意笔记、文章片段，或直接写一个话题。例如：\n\nTransformer 由多头自注意力、位置编码与前馈网络堆叠而成；注意力分数 QK^T/√d 经 softmax 后加权 V……"}
          />
        </label>

        <label className="field">
          <span>笔记标题（可选）</span>
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="例如：Transformer 论文笔记" />
        </label>

        <label className="field">
          <span>学习目标（可选）</span>
          <input value={goal} onChange={(e) => setGoal(e.target.value)} placeholder="例如：系统理解 Transformer 并找到下一步知识缺口" />
        </label>

        <label className="field">
          <span>受众（可选）</span>
          <input value={audience} onChange={(e) => setAudience(e.target.value)} placeholder="例如：有机器学习基础的学习者" />
        </label>

        <label className="field">
          <span>知识颗粒度（层级）</span>
          <select value={granularity} onChange={(e) => setGranularity(Number(e.target.value))}>
            {GRANULARITY_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </label>

        <label className="field">
          <span>扩散跳数</span>
          <select value={hops} onChange={(e) => setHops(Number(e.target.value))}>
            {HOP_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </label>

        <label className="field">
          <span>节点预算</span>
          <select value={maxNodes} onChange={(e) => setMaxNodes(Number(e.target.value))}>
            {[16, 24, 30, 40, 50, 60].map((n) => <option key={n} value={n}>{n} 个节点</option>)}
          </select>
        </label>
      </div>

      {error ? <p className="run-creator-error">{error}</p> : null}

      <div className="run-creator-actions">
        <button type="submit" disabled={submitting}>
          {submitting ? "Agent 正在扩散与编译知识网络…（真实模型需几秒到几十秒）" : "生成知识网络 →"}
        </button>
        <p className="hint">
          配置 <code>KNOWLEDGE_AGENT_BASE_URL / MODEL / API_KEY</code> 后即调用真实模型做多跳扩散与五级粒度；未配置则用离线启发式提取（不扩散、不伪装）。
        </p>
      </div>
    </form>
  );
}
