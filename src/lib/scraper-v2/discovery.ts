// discoverUrls — Discovery layer for the Universal Scraper (UNIVERSAL_SCRAPER_PRD.md §3.1).
//
// Given a keyword (and an optional domain to constrain to), returns a list of
// candidate URLs via three independent strategies, tried cheapest/fastest first:
//   1. Sitemap parsing — if targetDomain is given, check {domain}/sitemap.xml
//      first. Plain HTTP fetch (NOT UniversalFetcher/browser rendering) —
//      sitemaps are static, unprotected XML with no need for stealth, and
//      routing XML through Chromium's built-in XML viewer instead of reading
//      raw bytes is a known project bug (see STATE_OF_THE_BUILD.md's July 28
//      2026 "stealth scraper + IRS 990 fetch fix" entry: the prior IRS 990
//      fetch broke because it read a browser-rendered XML viewer instead of
//      raw XML). This is the PRD's "fast path."
//   2. Search engine query — reuses UniversalFetcher (the real stealth
//      fetch layer, §3.2) against Google/Bing/DuckDuckGo, rotating which
//      engine is tried first on each call to distribute load across all
//      three rather than hammering one and tripping its rate limiting.
//   3. Direct crawl fallback — bounded-depth/bounded-count same-domain link
//      following from a seed URL, only attempted when a targetDomain was
//      given and the above two strategies haven't filled maxResults.
//
// Extraction layer (§3.3, turning a fetched page into structured data) is out
// of scope here — this module only discovers URLs, it does not read them.

import { UniversalFetcher } from "./universal-fetcher";

export type UrlSource = "sitemap" | "search_google" | "search_bing" | "search_duckduckgo" | "crawl";

export interface DiscoveredUrl {
  url: string;
  source: UrlSource;
}

export interface DiscoverUrlsOptions {
  /** Max candidate URLs to return overall, across all strategies. Default 25. */
  maxResults?: number;
  /** Max link-follow depth for the direct-crawl fallback. Default 2. */
  maxCrawlDepth?: number;
  /** Max pages fetched during the direct-crawl fallback. Default 15. */
  maxCrawlPages?: number;
  /**
   * Reuse an already-initialized UniversalFetcher (e.g. across multiple
   * discoverUrls() calls) instead of launching/tearing down a fresh browser
   * per call. If omitted, discoverUrls() owns its own instance's lifecycle.
   */
  fetcher?: UniversalFetcher;
}

const DEFAULT_MAX_RESULTS = 25;
const DEFAULT_MAX_CRAWL_DEPTH = 2;
const DEFAULT_MAX_CRAWL_PAGES = 15;
const MAX_SITEMAP_INDEX_FOLLOW = 3;
const RAW_FETCH_TIMEOUT_MS = 10_000;
const RAW_FETCH_USER_AGENT = "Mozilla/5.0 (compatible; BenavoraUniversalScraper/1.0; +https://www.benavora.com)";

const SEARCH_ENGINES = ["google", "bing", "duckduckgo"] as const;
type SearchEngine = (typeof SEARCH_ENGINES)[number];

// Hosts that show up in search-result HTML but are never real destination
// results — the engine's own domain, ad networks, and static-asset CDNs.
const NON_RESULT_HOST_PATTERNS: RegExp[] = [
  /(^|\.)google\.[a-z.]+$/i,
  /(^|\.)bing\.com$/i,
  /(^|\.)microsoft\.com$/i,
  /(^|\.)duckduckgo\.com$/i,
  /(^|\.)doubleclick\.net$/i,
  /(^|\.)googleadservices\.com$/i,
  /(^|\.)googlesyndication\.com$/i,
  /(^|\.)gstatic\.com$/i,
  /(^|\.)ajax\.googleapis\.com$/i,
  /(^|\.)schema\.org$/i,
  /(^|\.)w3\.org$/i,
];

function isNonResultHost(hostname: string): boolean {
  return NON_RESULT_HOST_PATTERNS.some((pattern) => pattern.test(hostname));
}

/** Round-robins which search engine is tried first across calls, so repeated discoverUrls() calls spread load across all three instead of always hitting the same one first. */
let engineRotationCursor = 0;

function rotateEngines(): SearchEngine[] {
  const order = [0, 1, 2].map((offset) => SEARCH_ENGINES[(engineRotationCursor + offset) % SEARCH_ENGINES.length]!);
  engineRotationCursor = (engineRotationCursor + 1) % SEARCH_ENGINES.length;
  return order;
}

function buildSearchUrl(engine: SearchEngine, query: string): string {
  const q = encodeURIComponent(query);
  switch (engine) {
    case "google":
      return `https://www.google.com/search?q=${q}&num=30`;
    case "bing":
      return `https://www.bing.com/search?q=${q}&count=30`;
    case "duckduckgo":
      // The no-JS "html" endpoint — fully server-rendered result markup,
      // unlike duckduckgo.com's JS-driven UI.
      return `https://html.duckduckgo.com/html/?q=${q}`;
  }
}

/** Unwraps known search-engine result redirect wrappers (Google's /url?q=, DuckDuckGo's /l/?uddg=) down to the real destination URL. Returns the URL unchanged if it isn't a wrapper. */
function unwrapRedirect(url: URL): string | null {
  if (/(^|\.)google\.[a-z.]+$/i.test(url.hostname) && url.pathname === "/url") {
    return url.searchParams.get("q") ?? url.searchParams.get("url");
  }
  if (/(^|\.)duckduckgo\.com$/i.test(url.hostname) && url.pathname.startsWith("/l/")) {
    return url.searchParams.get("uddg");
  }
  return url.toString();
}

const HREF_REGEX = /href\s*=\s*["']([^"'#\s>]+)["']/gi;

/** Pulls every href out of raw HTML, resolves it against baseUrl, unwraps redirect wrappers, and drops non-result/tracking hosts. */
function extractLinksFromHtml(html: string, baseUrl: string): string[] {
  const out = new Set<string>();
  let match: RegExpExecArray | null;
  HREF_REGEX.lastIndex = 0;

  while ((match = HREF_REGEX.exec(html)) !== null) {
    const raw = match[1];
    if (!raw || raw.startsWith("javascript:") || raw.startsWith("mailto:") || raw.startsWith("tel:")) continue;

    let absolute: URL;
    try {
      absolute = new URL(raw, baseUrl);
    } catch {
      continue;
    }
    if (absolute.protocol !== "http:" && absolute.protocol !== "https:") continue;

    const unwrapped = unwrapRedirect(absolute);
    if (!unwrapped) continue;

    let final: URL;
    try {
      final = new URL(unwrapped);
    } catch {
      continue;
    }
    if (isNonResultHost(final.hostname)) continue;

    final.hash = "";
    out.add(final.toString());
  }

  return Array.from(out);
}

function normalizeUrl(raw: string): string | null {
  try {
    const u = new URL(raw);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    u.hash = "";
    return u.toString();
  } catch {
    return null;
  }
}

function hostnameMatchesDomain(hostname: string, domain: string): boolean {
  const normalizedHost = hostname.replace(/^www\./i, "").toLowerCase();
  const normalizedDomain = domain.replace(/^https?:\/\//i, "").replace(/^www\./i, "").replace(/\/.*$/, "").toLowerCase();
  return normalizedHost === normalizedDomain || normalizedHost.endsWith(`.${normalizedDomain}`);
}

/** Plain HTTP fetch — deliberately NOT UniversalFetcher. Sitemaps are static XML with no anti-bot protection, and routing them through Chromium's page.content() returns its rendered XML-viewer DOM rather than the raw XML text (a real bug hit earlier in this project on IRS 990 XML fetches). */
async function fetchRawText(url: string): Promise<string | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), RAW_FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { "User-Agent": RAW_FETCH_USER_AGENT },
    });
    if (!res.ok) return null;
    return await res.text();
  } catch (err) {
    console.error(`[discovery] raw fetch failed for ${url}: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

const LOC_REGEX = /<loc>\s*([^<\s]+)\s*<\/loc>/gi;

function extractSitemapLocs(xml: string): string[] {
  const out: string[] = [];
  let match: RegExpExecArray | null;
  LOC_REGEX.lastIndex = 0;
  while ((match = LOC_REGEX.exec(xml)) !== null) {
    const loc = match[1];
    if (loc) out.push(loc.trim());
  }
  return out;
}

async function discoverViaSitemap(targetDomain: string, limit: number): Promise<DiscoveredUrl[]> {
  const base = /^https?:\/\//i.test(targetDomain) ? targetDomain : `https://${targetDomain}`;
  const sitemapUrl = new URL("/sitemap.xml", base).toString();

  const xml = await fetchRawText(sitemapUrl);
  if (!xml) return [];

  const locs = extractSitemapLocs(xml);
  if (locs.length === 0) return [];

  const looksLikeIndex = /<sitemapindex/i.test(xml);
  if (!looksLikeIndex) {
    return locs.slice(0, limit).map((url) => ({ url, source: "sitemap" as const }));
  }

  // Sitemap index — follow a bounded number of sub-sitemaps to reach actual page URLs.
  const collected: string[] = [];
  for (const sub of locs.slice(0, MAX_SITEMAP_INDEX_FOLLOW)) {
    if (collected.length >= limit) break;
    const subXml = await fetchRawText(sub);
    if (subXml) collected.push(...extractSitemapLocs(subXml));
  }

  return collected.slice(0, limit).map((url) => ({ url, source: "sitemap" as const }));
}

async function discoverViaSearch(
  fetcher: UniversalFetcher,
  keyword: string,
  targetDomain: string | undefined,
  limit: number,
): Promise<DiscoveredUrl[]> {
  const query = targetDomain ? `${keyword} site:${targetDomain}` : keyword;
  const order = rotateEngines();

  for (const engine of order) {
    const searchUrl = buildSearchUrl(engine, query);
    const result = await fetcher.fetchPage(searchUrl);

    if (!result.success || !result.html) {
      console.error(`[discovery] search engine "${engine}" failed for "${query}": ${result.fetchError}`);
      continue;
    }

    let links = extractLinksFromHtml(result.html, searchUrl);
    if (targetDomain) {
      links = links.filter((link) => {
        try {
          return hostnameMatchesDomain(new URL(link).hostname, targetDomain);
        } catch {
          return false;
        }
      });
    }

    if (links.length > 0) {
      return links.slice(0, limit).map((url) => ({ url, source: `search_${engine}` as const }));
    }

    console.error(`[discovery] search engine "${engine}" returned no usable result links for "${query}", trying next engine`);
  }

  return [];
}

interface CrawlOptions {
  maxDepth: number;
  maxPages: number;
}

async function discoverViaCrawl(
  fetcher: UniversalFetcher,
  seedUrl: string,
  targetDomain: string,
  opts: CrawlOptions,
): Promise<DiscoveredUrl[]> {
  const visited = new Set<string>();
  const collected: string[] = [];
  const queue: Array<{ url: string; depth: number }> = [{ url: seedUrl, depth: 0 }];

  while (queue.length > 0 && collected.length < opts.maxPages) {
    const next = queue.shift();
    if (!next) break;
    const { url, depth } = next;
    if (visited.has(url)) continue;
    visited.add(url);

    const result = await fetcher.fetchPage(url);
    if (!result.success || !result.html) {
      console.error(`[discovery] crawl fetch failed for ${url}: ${result.fetchError}`);
      continue;
    }

    collected.push(url);
    if (collected.length >= opts.maxPages || depth >= opts.maxDepth) continue;

    const links = extractLinksFromHtml(result.html, url).filter((link) => {
      try {
        return hostnameMatchesDomain(new URL(link).hostname, targetDomain);
      } catch {
        return false;
      }
    });

    for (const link of links) {
      // Bound the queue itself, not just `collected`, so a page with hundreds
      // of same-domain links can't blow up memory before maxPages is checked.
      if (!visited.has(link) && queue.length + collected.length < opts.maxPages * 3) {
        queue.push({ url: link, depth: depth + 1 });
      }
    }
  }

  return collected.map((url) => ({ url, source: "crawl" as const }));
}

/**
 * Discovers candidate URLs for `keyword`, optionally constrained to `targetDomain`.
 * Tries, in order, until maxResults is reached: sitemap.xml (domain-scoped
 * fast path), rotating search-engine query, then bounded same-domain crawl
 * (domain-scoped fallback). Works keyword-only with no targetDomain — the
 * search-engine strategy is the only one that doesn't require a domain.
 */
export async function discoverUrls(
  keyword: string,
  targetDomain?: string,
  options: DiscoverUrlsOptions = {},
): Promise<DiscoveredUrl[]> {
  const maxResults = options.maxResults ?? DEFAULT_MAX_RESULTS;
  const maxCrawlDepth = options.maxCrawlDepth ?? DEFAULT_MAX_CRAWL_DEPTH;
  const maxCrawlPages = options.maxCrawlPages ?? DEFAULT_MAX_CRAWL_PAGES;

  const ownsFetcher = !options.fetcher;
  const fetcher = options.fetcher ?? new UniversalFetcher();
  if (ownsFetcher) await fetcher.init();

  const seen = new Set<string>();
  const results: DiscoveredUrl[] = [];
  const addResults = (found: DiscoveredUrl[]) => {
    for (const item of found) {
      if (results.length >= maxResults) break;
      const normalized = normalizeUrl(item.url);
      if (!normalized || seen.has(normalized)) continue;
      seen.add(normalized);
      results.push({ url: normalized, source: item.source });
    }
  };

  try {
    if (targetDomain) {
      addResults(await discoverViaSitemap(targetDomain, maxResults));
    }

    if (results.length < maxResults) {
      addResults(await discoverViaSearch(fetcher, keyword, targetDomain, maxResults - results.length));
    }

    if (targetDomain && results.length < maxResults) {
      const seedUrl = /^https?:\/\//i.test(targetDomain) ? targetDomain : `https://${targetDomain}`;
      addResults(
        await discoverViaCrawl(fetcher, seedUrl, targetDomain, {
          maxDepth: maxCrawlDepth,
          maxPages: maxCrawlPages,
        }),
      );
    }
  } finally {
    if (ownsFetcher) await fetcher.close();
  }

  return results.slice(0, maxResults);
}
