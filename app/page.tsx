import type { Metadata } from "next";
import { headers } from "next/headers";
import { KnowledgeNetworkApp } from "@/apps/web/src/components/KnowledgeNetworkApp";
import { RunCreatorForm } from "@/apps/web/src/components/RunCreatorForm";
import { DEMO_NOTES } from "@/fixtures/demo/transformer-notes";
import { analyzeKnowledgeNetwork } from "@/packages/knowledge-engine/src";

export async function generateMetadata(): Promise<Metadata> {
  const requestHeaders = await headers();
  const host =
    requestHeaders.get("x-forwarded-host") ??
    requestHeaders.get("host") ??
    "localhost:3000";
  const protocol =
    requestHeaders.get("x-forwarded-proto") ??
    (host.startsWith("localhost") ? "http" : "https");
  const imageUrl = `${protocol}://${host}/og-v2.png`;
  const title = "知识网络 · 从一张笔记向整个知识世界生长";
  const description =
    "把真实笔记、相关概念、权威网页与待补知识沿 360° 有机网络展开。";

  return {
    title,
    description,
    openGraph: {
      title,
      description,
      type: "website",
      images: [{ url: imageUrl, width: 1672, height: 941, alt: title }],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: [imageUrl],
    },
  };
}

export default function Home() {
  return (
    <>
      <RunCreatorForm />
      <section className="demo-section" aria-label="内置离线样例演示">
        <div className="demo-section-label">内置离线样例 · 不调用模型 · 仅演示 360° 有机布局</div>
        <KnowledgeNetworkApp
          initialAnalysis={analyzeKnowledgeNetwork(DEMO_NOTES)}
        />
      </section>
    </>
  );
}
