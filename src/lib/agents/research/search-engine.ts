// Search-source layer for the research agents (AGENTS.md Agents 12-15).
//
// Turns a query string into candidate result URLs across several sources:
//   - Google ("google") - fetches the public results page and extracts the
//     organic result links.
//   - Grants.gov ("grants_gov") - calls the public REST search API and maps the
//     opportunity hits to their detail pages.
//   - Foundation Directory ("foundation_directory") - Foundation Directory
//     Online is subscription-gated, so we approximate it with a Google query
//     scoped to the major foundation databases and parse it the same way.
//
// All network access goes through web-fetcher, so timeouts, retries, the
// per-domain rate limit, and the Benavora User-Agent apply uniformly. Native
// fetch only - no scraping libraries (task constraint). Every function is
// best-effort and never throws; a dead source yields [].

import { fetchRaw } from "@/lib/agents/research/web-fetcher";

export type SearchSource = "google" | "grants_gov" | "foundation_directory";

export interface SearchHit {
  url: string;
  title: string;
  snippet: string;
  source: SearchSource;
}

export interface SearchOptions {
  query: string;
  /** Sources to query. Defaults to Google only. */
  sources?: SearchSource[];
  /** Max hits to keep per source. Defaults to 10. */
  limitPerSource?: number;
}

const DEFAULT_LIMIT_PER_SOURCE = 10;

/** Hosts to drop from organic results - search-engine chrome, not opportunities. */
const EXCLUDED_HOSTS = [
  "google.",
  "googleusercontent.",
  "gstatic.",
  "youtube.com",
  "youtu.be",
  "facebook.com",
  "twitter.com",
  "x.com",
  "instagram.com",
  "linkedin.com",
  "wikipedia.org",
];

/** Grants.gov public search API (task spec). */
const GRANTS_GOV_API = "https://www.grants.gov/grantsws/rest/opportunities/search";
/** Foundation databases the FDO-style query is scoped to. */
const FOUNDATION_SITES = ["candid.org", "foundationcenter.org", "grantspace.org"];

/**
 * Run a query across the requested sources and return de-duplicated hits.
 * Sources are queried in sequence (the rate limiter already throttles per
 * domain); a failure in one source never affects the others.
 */
export async function search(options: SearchOptions): Promise<SearchHit[]> {
  const query = options.query.trim();
  if (query === "") return [];
  const sources = options.sources ?? ["google"];
  const limit = options.limitPerSource ?? DEFAULT_LIMIT_PER_SOURCE;

  const all: SearchHit[] = [];
  for (const source of sources) {
    try {
      if (source === "google") all.push(...(await searchGoogle(query, limit)));
      else if (source === "grants_gov") all.push(...(await searchGrantsGov(query, limit)));
      else if (source === "foundation_directory") {
        all.push(...(await searchFoundationDirectory(query, limit)));
      }
    } catch (err) {
      console.error(`[search-engine] source "${source}" failed:`, err);
    }
  }

  return dedupeByUrl(all);
}

// --- URL construction --------------------------------------------------------

/**
 * Build the search URL for a source (the Grants.gov POST body is constructed
 * separately in {@link searchGrantsGov}). Exposed for callers that want to log
 * or inspect the target without fetching.
 */
export function buildSearchUrl(source: SearchSource, query: string): string {
  const q = encodeURIComponent(query.trim());
  switch (source) {
    case "google":
      return `https://www.google.com/search?q=${q}&num=20`;
    case "grants_gov":
      return GRANTS_GOV_API;
    case "foundation_directory": {
      const sites = FOUNDATION_SITES.map((s) => `site:${s}`).join(" OR ");
      return `https://www.google.com/search?q=${encodeURIComponent(
        `${query.trim()} (${sites})`,
      )}&num=20`;
    }
  }
}

// --- Google ------------------------------------------------------------------

async function searchGoogle(query: string, limit: number): Promise<SearchHit[]> {
  const res = await fetchRaw({ url: buildSearchUrl("google", query) });
  if (!res.ok || !res.body) return [];
  return parseGoogleHtml(res.body, "google").slice(0, limit);
}

async function searchFoundationDirectory(
  query: string,
  limit: number,
): Promise<SearchHit[]> {
  const res = await fetchRaw({ url: buildSearchUrl("foundation_directory", query) });
  if (!res.ok || !res.body) return [];
  return parseGoogleHtml(res.body, "foundation_directory").slice(0, limit);
}

/**
 * Extract organic result links from a Google results page. Google's markup is
 * unstable and frequently bot-gated, so this is deliberately defensive: it pulls
 * `/url?q=` redirect targets (classic markup) and any bare external https links,
 * then drops search-engine chrome. Titles/snippets are best-effort.
 */
export function parseGoogleHtml(html: string, source: SearchSource): SearchHit[] {
  const urls = new Set<string>();

  // Classic Google result links: <a href="/url?q=ENCODED&...">
  const redirectRe = /\/url\?q=(https?:\/\/[^&"']+)/g;
  let m: RegExpExecArray | null;
  while ((m = redirectRe.exec(html)) !== null) {
    const captured = m[1];
    if (!captured) continue;
    const decoded = safeDecode(captured);
    if (decoded) urls.add(decoded);
  }

  // Fallback: direct external hrefs in result anchors.
  const directRe = /<a[^>]+href="(https?:\/\/[^"']+)"/g;
  while ((m = directRe.exec(html)) !== null) {
    if (m[1]) urls.add(m[1]);
  }

  const hits: SearchHit[] = [];
  for (const url of urls) {
    if (isExcludedHost(url)) continue;
    hits.push({ url, title: titleFromUrl(url), snippet: "", source });
  }
  return hits;
}

// --- Grants.gov --------------------------------------------------------------

interface GrantsGovHit {
  id?: number | string;
  number?: string;
  title?: string;
  agencyName?: string;
  agency?: string;
  oppStatus?: string;
  closeDate?: string;
}

async function searchGrantsGov(query: string, limit: number): Promise<SearchHit[]> {
  // The REST search endpoint takes a JSON body and returns JSON. Request
  // currently-open opportunities matching the keyword.
  const body = JSON.stringify({
    keyword: query,
    oppStatuses: "forecasted|posted",
    rows: Math.min(50, Math.max(limit, 10)),
    startRecordNum: 0,
  });

  const res = await fetchRaw({
    url: GRANTS_GOV_API,
    method: "POST",
    accept: "application/json",
    headers: { "content-type": "application/json" },
    body,
  });
  if (!res.ok || !res.body) return [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(res.body);
  } catch {
    console.error("[search-engine] grants.gov returned non-JSON");
    return [];
  }

  const hitsRaw = extractGrantsGovHits(parsed);
  const hits: SearchHit[] = [];
  for (const h of hitsRaw) {
    const id = h.id != null ? String(h.id) : "";
    if (id === "") continue;
    const agency = h.agencyName ?? h.agency ?? "";
    const status = h.oppStatus ? `Status: ${h.oppStatus}` : "";
    hits.push({
      url: `https://www.grants.gov/search-results-detail/${id}`,
      title: h.title?.trim() || h.number?.trim() || `Grants.gov opportunity ${id}`,
      snippet: [agency, status].filter(Boolean).join(" - "),
      source: "grants_gov",
    });
    if (hits.length >= limit) break;
  }
  return hits;
}

/** The hits array lives under `oppHits` (current API) or `data.oppHits`. */
function extractGrantsGovHits(parsed: unknown): GrantsGovHit[] {
  if (!parsed || typeof parsed !== "object") return [];
  const obj = parsed as Record<string, unknown>;
  const direct = obj.oppHits;
  if (Array.isArray(direct)) return direct as GrantsGovHit[];
  const data = obj.data;
  if (data && typeof data === "object") {
    const nested = (data as Record<string, unknown>).oppHits;
    if (Array.isArray(nested)) return nested as GrantsGovHit[];
  }
  return [];
}

// --- helpers -----------------------------------------------------------------

function safeDecode(value: string): string | null {
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
}

function isExcludedHost(url: string): boolean {
  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return true;
  }
  return EXCLUDED_HOSTS.some((h) => host.includes(h));
}

/** Derive a readable fallback title from a URL's host + last path segment. */
function titleFromUrl(url: string): string {
  try {
    const u = new URL(url);
    const segment = u.pathname
      .split("/")
      .filter(Boolean)
      .pop()
      ?.replace(/[-_]+/g, " ")
      .replace(/\.[a-z]+$/i, "")
      .trim();
    return segment ? `${u.hostname} - ${segment}` : u.hostname;
  } catch {
    return url;
  }
}

function dedupeByUrl(hits: SearchHit[]): SearchHit[] {
  const seen = new Set<string>();
  const out: SearchHit[] = [];
  for (const hit of hits) {
    if (seen.has(hit.url)) continue;
    seen.add(hit.url);
    out.push(hit);
  }
  return out;
}
