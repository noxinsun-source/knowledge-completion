import type { Metadata } from "next";
import { AgentRunNetworkApp } from "@/apps/web/src/components/AgentRunNetworkApp";

export const metadata: Metadata = {
  title: "Agent Run · 知识补全项目",
  description: "查看由知识补全 Agent 生成并持久化的多粒度知识网络。",
};

export default async function AgentRunPage({
  params,
}: {
  params: Promise<{ runId: string }>;
}) {
  const { runId } = await params;

  return <AgentRunNetworkApp runId={runId} />;
}
