import vinext from "vinext";
import { defineConfig, loadEnv } from "vite";
import { sites } from "./build/sites-vite-plugin";

const SITE_CREATOR_PLACEHOLDER_DATABASE_ID =
  "00000000-0000-4000-8000-000000000000";

// Keep the open-source checkout independent from any previous Sites project id.
// Local development uses a project-local D1 binding; deployers may replace this
// runtime configuration in their own infrastructure without committing secrets.
const d1 = "DB";
const r2: string | null = null;

// macOS Seatbelt blocks FSEvents, so Codex previews need polling for HMR.
const isCodexSeatbeltSandbox = process.env.CODEX_SANDBOX === "seatbelt";

// 配置 KNOWLEDGE_AGENT_BASE_URL / KNOWLEDGE_AGENT_MODEL / KNOWLEDGE_AGENT_API_KEY
// 后，Run API 会调用真实 OpenAI-compatible 模型做有界语义扩展；未配置时保持离线 heuristic。
const agentEnvironmentKeys = [
  "KNOWLEDGE_AGENT_BASE_URL",
  "KNOWLEDGE_AGENT_MODEL",
  "KNOWLEDGE_AGENT_API_KEY",
] as const;

function agentBindings(environment: Record<string, string | undefined>) {
  return Object.fromEntries(agentEnvironmentKeys.flatMap((key) => {
    const value = environment[key]?.trim();
    return value ? [[key, value]] : [];
  }));
}

const localBindingConfig = {
  main: "./worker/index.ts",
  compatibility_flags: ["nodejs_compat"],
  d1_databases: d1
    ? [
        {
          binding: d1,
          database_name: "site-creator-d1",
          database_id: SITE_CREATOR_PLACEHOLDER_DATABASE_ID,
        },
      ]
    : [],
  r2_buckets: r2
    ? [
        {
          binding: r2,
          bucket_name: "site-creator-r2",
        },
      ]
    : [],
};

export default defineConfig(async ({ mode }) => {
  // Keep Wrangler and Miniflare state project-local. These are non-secret tool
  // settings; application environment belongs in ignored `.env*` files.
  process.env.WRANGLER_WRITE_LOGS ??= "false";
  process.env.WRANGLER_LOG_PATH ??= ".wrangler/logs";
  process.env.MINIFLARE_REGISTRY_PATH ??= ".wrangler/registry";

  const fileEnvironment = loadEnv(mode, process.cwd(), "");
  const localBindingConfigWithAgent = {
    ...localBindingConfig,
    vars: agentBindings({ ...fileEnvironment, ...process.env }),
  };

  // Wrangler snapshots its log path while the Cloudflare plugin is imported.
  const { cloudflare } = await import("@cloudflare/vite-plugin");

  return {
    server: isCodexSeatbeltSandbox
      ? { watch: { useFsEvents: false, usePolling: true } }
      : undefined,
    plugins: [
      vinext(),
      sites(),
      cloudflare({
        viteEnvironment: { name: "rsc", childEnvironments: ["ssr"] },
        config: localBindingConfigWithAgent,
      }),
    ],
  };
});
