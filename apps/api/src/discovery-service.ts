import type {
  ExternalKnowledgeSource,
  SourceDiscoveryResult,
} from "@/packages/contracts/src";
import { KNOWLEDGE_NODES } from "@/packages/knowledge-engine/src";
import { D1PlatformRepository } from "./platform-repository";

type Provider = ExternalKnowledgeSource["provider"];
type ProviderResult = { provider: Provider; sources: ExternalKnowledgeSource[]; latencyMs: number; error?: string };

const USER_AGENT = "KnowledgeCompletion/2.0 (evidence discovery; https://github.com/noxinsun-source/knowledge-completion)";
const CRAWL_HOSTS = ["arxiv.org", "export.arxiv.org", "europepmc.org", "www.ebi.ac.uk", "crossref.org", "www.crossref.org", "wikipedia.org"];

function normalizeTitle(value: string) {
  return value.normalize("NFKC").toLocaleLowerCase("en-US").replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

function cleanMarkup(value?: string) {
  return value?.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

function stableId(value: string) {
  let hash = 2166136261;
  for (const character of value) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16);
}

function matchedConceptIds(title: string, abstract = "") {
  const text = `${title} ${abstract}`.normalize("NFKC").toLocaleLowerCase("zh-CN");
  return KNOWLEDGE_NODES.filter((node) => node.kind !== "domain" && [
    node.label, node.labelEn, ...node.keywords, ...(node.aliases ?? []),
  ].some((keyword) => keyword && text.includes(keyword.toLocaleLowerCase("zh-CN"))))
    .map((node) => node.id)
    .slice(0, 8);
}

function providerQuery(query: string) {
  const normalized = query.normalize("NFKC").toLocaleLowerCase("zh-CN");
  const asciiTerms = query.match(/[A-Za-z][A-Za-z0-9-]*/g) ?? [];
  const conceptTerms = KNOWLEDGE_NODES.filter((node) => node.kind !== "domain" && [
    node.label, ...node.keywords, ...(node.aliases ?? []),
  ].some((keyword) => keyword && normalized.includes(keyword.toLocaleLowerCase("zh-CN"))))
    .flatMap((node) => [node.labelEn, ...node.keywords.filter((keyword) => /^[\x20-\x7E]+$/.test(keyword))]);
  const terms = [...new Set([...asciiTerms, ...conceptTerms].map((term) => term.trim()).filter(Boolean))];
  return terms.length ? terms.slice(0, 8).join(" ") : query;
}

function relevanceScore(query: string, source: ExternalKnowledgeSource) {
  const normalize = (value: string) => value.normalize("NFKC").toLocaleLowerCase("zh-CN").replace(/[^\p{L}\p{N}]+/gu, " ").trim();
  const normalizedQuery = normalize(query);
  const title = normalize(source.title);
  const body = normalize(`${source.abstract ?? ""} ${source.fetchedContent ?? ""}`);
  const tokens = [...new Set(normalizedQuery.split(/\s+/).filter((token) => token.length > 1))];
  const titleMatches = tokens.filter((token) => title.includes(token)).length;
  const bodyMatches = tokens.filter((token) => body.includes(token)).length;
  const denominator = Math.max(1, tokens.length);
  const exactTitle = normalizedQuery && title.includes(normalizedQuery) ? 0.55 : 0;
  return exactTitle + (titleMatches / denominator) * 0.9 + (bodyMatches / denominator) * 0.35 + source.trustScore * 0.28;
}

function trust(provider: Provider, options: { doi?: string; citations?: number; year?: number; crossListed?: number }) {
  const base = { crossref: 0.72, "europe-pmc": 0.78, arxiv: 0.63, openalex: 0.74, wikipedia: 0.68, bing: 0.7 }[provider];
  const signals = [`${provider} 结构化元数据`];
  let score = base;
  if (options.doi) { score += 0.08; signals.push("具有 DOI"); }
  if ((options.citations ?? 0) > 0) {
    score += Math.min(0.1, Math.log10((options.citations ?? 0) + 1) * 0.035);
    signals.push(`引用计数 ${options.citations}`);
  }
  if ((options.year ?? 0) >= new Date().getUTCFullYear() - 3) { score += 0.025; signals.push("近三年来源"); }
  if ((options.crossListed ?? 0) > 1) { score += 0.07; signals.push("跨来源一致"); }
  return { score: Number(Math.min(0.98, score).toFixed(3)), signals };
}

async function fetchJson(url: string) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);
  try {
    const response = await fetch(url, { headers: { "user-agent": USER_AGENT, accept: "application/json" }, signal: controller.signal });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.json() as Record<string, unknown>;
  } finally {
    clearTimeout(timeout);
  }
}

async function crossref(query: string, limit: number): Promise<ExternalKnowledgeSource[]> {
  const url = new URL("https://api.crossref.org/works");
  url.searchParams.set("query.bibliographic", query);
  url.searchParams.set("rows", String(limit));
  url.searchParams.set("select", "DOI,title,URL,published,is-referenced-by-count,type,author,publisher,abstract");
  const payload = await fetchJson(url.toString()) as { message?: { items?: Array<Record<string, unknown>> } };
  return (payload.message?.items ?? []).flatMap((item) => {
    const title = cleanMarkup(Array.isArray(item.title) ? String(item.title[0] ?? "") : "") ?? "";
    if (!title) return [];
    const doi = typeof item.DOI === "string" ? item.DOI.toLocaleLowerCase("en-US") : undefined;
    const dateParts = (item.published as { "date-parts"?: number[][] } | undefined)?.["date-parts"]?.[0];
    const publishedYear = dateParts?.[0];
    const citedByCount = Number(item["is-referenced-by-count"] ?? 0);
    const authors = Array.isArray(item.author) ? item.author.map((author) => {
      const value = author as { given?: string; family?: string };
      return [value.given, value.family].filter(Boolean).join(" ");
    }).filter(Boolean) : [];
    const abstract = cleanMarkup(typeof item.abstract === "string" ? item.abstract : undefined);
    const rating = trust("crossref", { doi, citations: citedByCount, year: publishedYear });
    const canonicalUrl = doi ? `https://doi.org/${doi}` : String(item.URL ?? "");
    return [{
      id: `source_crossref_${stableId(doi ?? normalizeTitle(title))}`,
      provider: "crossref" as const, title, url: canonicalUrl, canonicalUrl, doi,
      abstract, authors, publishedYear, citedByCount,
      sourceType: item.type === "book" ? "book" as const : "paper" as const,
      trustScore: rating.score, trustSignals: rating.signals,
      matchedConceptIds: matchedConceptIds(title, abstract), duplicateProviders: [],
    }];
  });
}

async function europePmc(query: string, limit: number): Promise<ExternalKnowledgeSource[]> {
  const url = new URL("https://www.ebi.ac.uk/europepmc/webservices/rest/search");
  url.searchParams.set("query", query);
  url.searchParams.set("format", "json");
  url.searchParams.set("resultType", "core");
  url.searchParams.set("pageSize", String(limit));
  const payload = await fetchJson(url.toString()) as { resultList?: { result?: Array<Record<string, unknown>> } };
  return (payload.resultList?.result ?? []).flatMap((item) => {
    const title = cleanMarkup(typeof item.title === "string" ? item.title : "") ?? "";
    if (!title) return [];
    const doi = typeof item.doi === "string" ? item.doi.toLocaleLowerCase("en-US") : undefined;
    const id = String(item.pmcid ?? item.pmid ?? item.id ?? "");
    const publishedYear = Number(item.pubYear) || undefined;
    const citedByCount = Number(item.citedByCount ?? 0);
    const abstract = cleanMarkup(typeof item.abstractText === "string" ? item.abstractText : undefined);
    const authors = typeof item.authorString === "string" ? item.authorString.split(/,\s*/).slice(0, 10) : [];
    const canonicalUrl = id ? `https://europepmc.org/article/${String(item.source ?? "MED")}/${id}` : doi ? `https://doi.org/${doi}` : "https://europepmc.org";
    const rating = trust("europe-pmc", { doi, citations: citedByCount, year: publishedYear });
    return [{
      id: `source_epmc_${stableId(doi ?? id ?? normalizeTitle(title))}`,
      provider: "europe-pmc" as const, title, url: canonicalUrl, canonicalUrl, doi,
      abstract, authors, publishedYear, citedByCount, sourceType: "paper" as const,
      trustScore: rating.score, trustSignals: rating.signals,
      matchedConceptIds: matchedConceptIds(title, abstract), duplicateProviders: [],
    }];
  });
}

function xmlText(entry: string, tag: string) {
  const match = entry.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i"));
  return match?.[1]?.replace(/<!\[CDATA\[|\]\]>/g, "").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();
}

async function arxiv(query: string, limit: number): Promise<ExternalKnowledgeSource[]> {
  const url = new URL("https://export.arxiv.org/api/query");
  url.searchParams.set("search_query", `all:${query.replace(/\s+/g, " AND all:")}`);
  url.searchParams.set("start", "0");
  url.searchParams.set("max_results", String(limit));
  url.searchParams.set("sortBy", "relevance");
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);
  let text: string;
  try {
    const response = await fetch(url, { headers: { "user-agent": USER_AGENT }, signal: controller.signal });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    text = await response.text();
  } finally { clearTimeout(timeout); }
  return [...text.matchAll(/<entry>([\s\S]*?)<\/entry>/gi)].flatMap((match) => {
    const entry = match[1];
    const title = cleanMarkup(xmlText(entry, "title")) ?? "";
    const canonicalUrl = xmlText(entry, "id")?.replace("http://", "https://") ?? "";
    if (!title || !canonicalUrl) return [];
    const abstract = xmlText(entry, "summary");
    const year = Number(xmlText(entry, "published")?.slice(0, 4)) || undefined;
    const authors = [...entry.matchAll(/<author>[\s\S]*?<name>([\s\S]*?)<\/name>[\s\S]*?<\/author>/gi)].map((author) => author[1].trim());
    const rating = trust("arxiv", { year });
    return [{
      id: `source_arxiv_${stableId(canonicalUrl)}`, provider: "arxiv" as const,
      title, url: canonicalUrl, canonicalUrl, abstract, authors, publishedYear: year,
      sourceType: "preprint" as const, trustScore: rating.score, trustSignals: rating.signals,
      matchedConceptIds: matchedConceptIds(title, abstract), duplicateProviders: [],
    }];
  });
}

async function wikipedia(query: string, limit: number): Promise<ExternalKnowledgeSource[]> {
  const language = /[\u3400-\u9fff]/u.test(query) ? "zh" : "en";
  const url = new URL(`https://${language}.wikipedia.org/w/api.php`);
  url.searchParams.set("action", "query");
  url.searchParams.set("list", "search");
  url.searchParams.set("srsearch", query);
  url.searchParams.set("srlimit", String(limit));
  url.searchParams.set("utf8", "1");
  url.searchParams.set("format", "json");
  url.searchParams.set("origin", "*");
  const payload = await fetchJson(url.toString()) as { query?: { search?: Array<Record<string, unknown>> } };
  return (payload.query?.search ?? []).flatMap((item) => {
    const title = cleanMarkup(typeof item.title === "string" ? item.title : "") ?? "";
    if (!title) return [];
    const abstract = cleanMarkup(typeof item.snippet === "string" ? item.snippet : undefined);
    const canonicalUrl = `https://${language}.wikipedia.org/wiki/${encodeURIComponent(title.replaceAll(" ", "_"))}`;
    const rating = trust("wikipedia", {});
    return [{
      id: `source_wikipedia_${stableId(canonicalUrl)}`,
      provider: "wikipedia" as const,
      title,
      url: canonicalUrl,
      canonicalUrl,
      abstract,
      authors: [],
      sourceType: "other" as const,
      trustScore: rating.score,
      trustSignals: [...rating.signals, `${language.toUpperCase()} Wikipedia 条目`],
      matchedConceptIds: matchedConceptIds(title, abstract),
      duplicateProviders: [],
    }];
  });
}

async function runProvider(provider: Provider, operation: () => Promise<ExternalKnowledgeSource[]>): Promise<ProviderResult> {
  const started = Date.now();
  try { return { provider, sources: await operation(), latencyMs: Date.now() - started }; }
  catch (error) { return { provider, sources: [], latencyMs: Date.now() - started, error: error instanceof Error ? error.message : "Unknown provider error" }; }
}

/** Bing Web Search API：真实网页搜索。需要 BING_WEB_SEARCH_API_KEY（Azure Bing Search v7）。 */
async function bing(query: string, limit: number, apiKey: string): Promise<ExternalKnowledgeSource[]> {
  const url = new URL("https://api.bing.microsoft.com/v7.0/search");
  url.searchParams.set("q", query);
  url.searchParams.set("count", String(limit));
  url.searchParams.set("mkt", /[\u3400-\u9fff]/u.test(query) ? "zh-CN" : "en-US");
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20_000);
  let payload: Record<string, unknown>;
  try {
    const response = await fetch(url.toString(), {
      headers: { "user-agent": USER_AGENT, "Ocp-Apim-Subscription-Key": apiKey, accept: "application/json" },
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    payload = await response.json() as Record<string, unknown>;
  } finally { clearTimeout(timeout); }
  const webPages = payload.webPages as { value?: Array<Record<string, unknown>> } | undefined;
  return (webPages?.value ?? []).flatMap((item) => {
    const title = cleanMarkup(typeof item.name === "string" ? item.name : undefined) ?? "";
    const canonicalUrl = typeof item.url === "string" ? item.url : "";
    if (!title || !canonicalUrl) return [];
    const abstract = cleanMarkup(typeof item.snippet === "string" ? item.snippet : undefined);
    const displayUrl = typeof item.displayUrl === "string" ? item.displayUrl : undefined;
    const rating = trust("bing", {});
    return [{
      id: `source_bing_${stableId(canonicalUrl)}`,
      provider: "bing" as const,
      title,
      url: canonicalUrl,
      canonicalUrl,
      abstract,
      authors: displayUrl ? [displayUrl] : [],
      sourceType: "other" as const,
      trustScore: rating.score,
      trustSignals: [...rating.signals, "Bing 网页搜索"],
      matchedConceptIds: matchedConceptIds(title, abstract),
      duplicateProviders: [],
    }];
  });
}

export function deduplicateSources(sources: ExternalKnowledgeSource[]) {
  const merged = new Map<string, ExternalKnowledgeSource>();
  for (const source of sources) {
    const key = source.doi ? `doi:${source.doi}` : `title:${normalizeTitle(source.title)}`;
    const existing = merged.get(key);
    if (!existing) { merged.set(key, source); continue; }
    const providers = [...new Set([existing.provider, source.provider, ...existing.duplicateProviders])];
    const preferred = source.trustScore > existing.trustScore ? source : existing;
    const rating = trust(preferred.provider, {
      doi: preferred.doi, citations: Math.max(existing.citedByCount ?? 0, source.citedByCount ?? 0),
      year: preferred.publishedYear, crossListed: providers.length,
    });
    merged.set(key, {
      ...preferred,
      abstract: preferred.abstract ?? existing.abstract ?? source.abstract,
      authors: [...new Set([...existing.authors, ...source.authors])].slice(0, 12),
      citedByCount: Math.max(existing.citedByCount ?? 0, source.citedByCount ?? 0),
      matchedConceptIds: [...new Set([...existing.matchedConceptIds, ...source.matchedConceptIds])],
      duplicateProviders: providers.filter((provider) => provider !== preferred.provider),
      trustScore: rating.score,
      trustSignals: [...new Set([...preferred.trustSignals, ...rating.signals])],
    });
  }
  return [...merged.values()];
}

export async function fetchTrustedSourcePage(source: ExternalKnowledgeSource) {
  const url = new URL(source.canonicalUrl);
  if (url.protocol !== "https:" || !CRAWL_HOSTS.some((host) => url.hostname === host || url.hostname.endsWith(`.${host}`))) {
    throw new Error("Source host is outside the crawler allowlist.");
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 6_000);
  try {
    const requestOptions = { headers: { "user-agent": USER_AGENT, accept: "text/html,text/plain" }, redirect: "manual" as const, signal: controller.signal };
    let response = await fetch(url, requestOptions);
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location) throw new Error("Redirect did not provide a target.");
      const target = new URL(location, url);
      if (target.protocol !== "https:" || !CRAWL_HOSTS.some((host) => target.hostname === host || target.hostname.endsWith(`.${host}`))) {
        throw new Error("Redirect left the crawler allowlist.");
      }
      response = await fetch(target, requestOptions);
    }
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const finalUrl = new URL(response.url);
    if (!CRAWL_HOSTS.some((host) => finalUrl.hostname === host || finalUrl.hostname.endsWith(`.${host}`))) throw new Error("Redirect left the crawler allowlist.");
    const contentType = response.headers.get("content-type") ?? "";
    if (!/text\/(html|plain)|application\/xhtml\+xml/.test(contentType)) throw new Error("Unsupported content type.");
    if (!response.body) throw new Error("Source returned an empty body.");
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let received = 0;
    while (received < 300_000) {
      const chunk = await reader.read();
      if (chunk.done) break;
      const remaining = 300_000 - received;
      chunks.push(chunk.value.slice(0, remaining));
      received += Math.min(chunk.value.byteLength, remaining);
      if (chunk.value.byteLength > remaining) break;
    }
    await reader.cancel().catch(() => undefined);
    const bytes = new Uint8Array(received);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    const text = new TextDecoder().decode(bytes).replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 8_000);
    return { ...source, fetchedContent: text, fetchedAt: new Date().toISOString() };
  } finally { clearTimeout(timeout); }
}

async function cacheKey(query: string, limit: number, crawlTop: number) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${normalizeTitle(query)}:${limit}:${crawlTop}:v6`));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function discoverSources(database: D1Database, queryInput: string, options?: { limitPerProvider?: number; crawlTop?: number; bingApiKey?: string }) {
  const query = queryInput.trim().slice(0, 300);
  if (!query) throw new TypeError("query must be a non-empty string.");
  const limit = Math.min(10, Math.max(1, Math.round(options?.limitPerProvider ?? 5)));
  const repository = new D1PlatformRepository(database);
  await repository.initialize();
  const crawlTop = Math.min(3, Math.max(0, Math.round(options?.crawlTop ?? 0)));
  const key = await cacheKey(query, limit, crawlTop);
  const cached = await repository.getDiscoveryCache(key);
  if (cached) return { ...cached, cache: "hit" as const };
  const externalQuery = providerQuery(query);
  const providers: Array<Promise<ProviderResult>> = [
    runProvider("crossref", () => crossref(externalQuery, limit)),
    runProvider("europe-pmc", () => europePmc(externalQuery, limit)),
    runProvider("arxiv", () => arxiv(externalQuery, limit)),
    runProvider("wikipedia", () => wikipedia(query, limit)),
  ];
  // 真实网页搜索：配置 BING_WEB_SEARCH_API_KEY 时启用 Bing Web Search；未配置则跳过，不影响其它来源。
  const bingApiKey = options?.bingApiKey?.trim();
  if (bingApiKey) {
    providers.push(runProvider("bing", () => bing(query, limit, bingApiKey)));
  }
  const results = await Promise.all(providers);
  const raw = results.flatMap((result) => result.sources);
  let sources = deduplicateSources(raw).sort((a, b) => relevanceScore(query, b) - relevanceScore(query, a));
  if (crawlTop) {
    const candidates = [...sources]
      .sort((a, b) => Number(["arxiv", "wikipedia"].includes(b.provider)) - Number(["arxiv", "wikipedia"].includes(a.provider)) || relevanceScore(query, b) - relevanceScore(query, a))
      .slice(0, Math.min(sources.length, crawlTop * 3));
    const crawled = await Promise.all(candidates.map(async (source) => {
      try { return await fetchTrustedSourcePage(source); } catch { return source; }
    }));
    const successful = new Map(crawled.filter((source) => source.fetchedContent).slice(0, crawlTop).map((source) => [source.id, source]));
    sources = sources.map((source) => successful.get(source.id) ?? source);
  }
  const response: SourceDiscoveryResult = {
    query,
    providers: results.map((result) => ({ provider: result.provider, ok: !result.error, count: result.sources.length, latencyMs: result.latencyMs, error: result.error })),
    sources,
    rawCount: raw.length,
    duplicateCount: raw.length - sources.length,
    generatedAt: new Date().toISOString(),
  };
  await repository.putDiscoveryCache(key, query, response);
  return { ...response, cache: "miss" as const };
}
