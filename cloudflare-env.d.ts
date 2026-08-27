/// <reference types="@cloudflare/workers-types" />

declare namespace Cloudflare {
  interface Env {
    DB: D1Database;
    BING_WEB_SEARCH_API_KEY?: string;
    KNOWLEDGE_AGENT_BASE_URL?: string;
    KNOWLEDGE_AGENT_MODEL?: string;
    KNOWLEDGE_AGENT_API_KEY?: string;
  }
}
