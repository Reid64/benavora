// Shared web-fetch infrastructure for the research agents (AGENTS.md Agents
// 12-15, BEHAVIORAL_CONTRACTS §17).
//
// Every research agent reaches the open web through this module so the
// cross-cutting rules live in exactly one place:
//   - Native `fetch` only — no external scraping libraries (task constraint).
//   - 15s per-request timeout via AbortController.
//   - Retry with exponential backoff (1 initial attempt + up to 3 retries) on
//     network errors, 5xx, and 429. 4xx (other than 429) is not retried.
//   - Per-domain rate limit: at most 10 requests per minute (Contracts §17).
//   - Identifies itself with a fixed User-Agent: "Benavora Research Bot 1.0".
//   - 24h response caching in the research_cache table, scoped by
//     organization_id (Contracts §17: never re-fetch a URL within the window).
//   - Never throws: every failure is logged and surfaced as a result object so
//     a single bad URL never halts a research run (Contracts §17).
//
// Two entry points: `fetchRaw` (raw body, no cache — used by search-engine to
// read result listings and JSON APIs) and `fetchPage` (cached + HTML→text —
// used to read the content pages the result-parser consumes).

import type { SupabaseClient } from "@supabase/supabase-js";

/** Tenant + client bundle every cached fetch needs. */
export interface ResearchContext {
  /** Service-role client for scheduled runs, session client for manual ones. */
  client: SupabaseClient;
  /** Tenant scope. The cache row and every query is filtered by this. */
  organizationId: string;
}

/** Sent on every request so funders can identify the crawler (task spec). */
export const USER_AGENT = "Benavora Research Bot 1.0";

/** Per-request timeout (Contracts §17). */
export const FETCH_TIMEOUT_MS = 15_000;

/** Retries after the first attempt (Contracts §17: "3 retries"). */
export const MAX_RETRIES = 3;

/** Per-domain rate limit window and ceiling (Contracts §17). */
export const RATE_LIMIT = 10;
export const RATE_WINDOW_MS = 60_000;

/** Cache TTL for fetched pages (Contracts §17: 24h). */
export const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

/** Base backoff; doubles each retry, capped to keep within the run budget. */
const BACKOFF_BASE_MS = 500;
const BACKOFF_CAP_MS = 8_000;

/** Cap how much of a fetched page text is kept, to bound downstream tokens. */
const MAX_TEXT_CHARS = 16_000;

// --- per-domain rate limiter -------------------------------------------------
//
// In-memory sliding window. Adequate for a single instance; a shared store
// (Redis) is the production fix for multi-instance deployments, mirroring the
// note on the agent-route limiters.
const domainHits = new Map<string, number[]>();

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function domainOf(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return "";
  }
}

/**
 * Block until this domain is under its per-minute ceiling, then record the hit.
 * Waits at most one window (60s) — long enough to free a slot, bounded so the
 * limiter can never hang a run indefinitely.
 */
async function acquireRateSlot(domain: string): Promise<void> {
  const now = Date.now();
  let times = (domainHits.get(domain) ?? []).filter(
    (t) => now - t < RATE_WINDOW_MS,
  );

  if (times.length >= RATE_LIMIT) {
    const oldest = times[0] ?? now;
    const wait = Math.min(RATE_WINDOW_MS, RATE_WINDOW_MS - (now - oldest));
    if (wait > 0) await sleep(wait);
    const after = Date.now();
    times = times.filter((t) => after - t < RATE_WINDOW_MS);
  }

  times.push(Date.now());
  domainHits.set(domain, times);
}

// --- raw fetch ---------------------------------------------------------------

export interface FetchRawOptions {
  url: string;
  method?: "GET" | "POST";
  /** Extra request headers (merged over the default UA/Accept). */
  headers?: Record<string, string>;
  /** Request body for POST (e.g. a JSON string for an API). */
  body?: string;
  /** Accept header; defaults to HTML. */
  accept?: string;
  timeoutMs?: number;
  /** Retries after the first attempt. Defaults to {@link MAX_RETRIES}. */
  maxRetries?: number;
}

export interface FetchRawResult {
  ok: boolean;
  url: string;
  /** HTTP status of the last attempt, or null if no response was received. */
  statusCode: number | null;
  /** Raw response body, or null on failure. */
  body: string | null;
  /** Human-readable failure reason, or null on success. */
  error: string | null;
}

/** Exponential backoff for retry attempt N (1-based), capped. */
function backoffMs(attempt: number): number {
  return Math.min(BACKOFF_CAP_MS, BACKOFF_BASE_MS * 2 ** (attempt - 1));
}

/**
 * Fetch a URL with timeout, retry/backoff, and per-domain rate limiting. Returns
 * the raw body without caching or HTML processing. Never throws.
 */
export async function fetchRaw(
  options: FetchRawOptions,
): Promise<FetchRawResult> {
  const { url } = options;
  const domain = domainOf(url);
  if (domain === "") {
    return { ok: false, url, statusCode: null, body: null, error: "invalid_url" };
  }

  const method = options.method ?? "GET";
  const timeoutMs = options.timeoutMs ?? FETCH_TIMEOUT_MS;
  const maxRetries = options.maxRetries ?? MAX_RETRIES;
  const headers: Record<string, string> = {
    "user-agent": USER_AGENT,
    accept: options.accept ?? "text/html,application/xhtml+xml",
    ...(options.headers ?? {}),
  };

  let lastError = "fetch_failed";
  let statusCode: number | null = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    if (attempt > 0) await sleep(backoffMs(attempt));
    await acquireRateSlot(domain);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, {
        method,
        headers,
        ...(options.body !== undefined ? { body: options.body } : {}),
        signal: controller.signal,
        redirect: "follow",
      });
      statusCode = res.status;
      const text = await res.text();

      if (res.ok) {
        return { ok: true, url, statusCode, body: text, error: null };
      }

      lastError = `http_${res.status}`;
      // 4xx (except 429) is a client error — retrying will not help.
      if (res.status >= 400 && res.status < 500 && res.status !== 429) {
        return { ok: false, url, statusCode, body: text, error: lastError };
      }
      // 5xx / 429 fall through to the next retry.
    } catch (err) {
      lastError =
        err instanceof Error && err.name === "AbortError"
          ? "timeout"
          : err instanceof Error
            ? err.message
            : "fetch_failed";
    } finally {
      clearTimeout(timer);
    }
  }

  console.error(`[web-fetcher] ${url} failed after retries: ${lastError}`);
  return { ok: false, url, statusCode, body: null, error: lastError };
}

// --- HTML → text -------------------------------------------------------------

/** Named entities common in funder pages; numeric refs are handled separately. */
const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  mdash: "—",
  ndash: "–",
  hellip: "…",
  rsquo: "’",
  lsquo: "‘",
  rdquo: "”",
  ldquo: "“",
};

/** Decode the HTML entities that survive tag stripping. */
function decodeEntities(text: string): string {
  return text
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) =>
      safeFromCodePoint(parseInt(hex, 16)),
    )
    .replace(/&#(\d+);/g, (_, dec) => safeFromCodePoint(parseInt(dec, 10)))
    .replace(/&([a-zA-Z]+);/g, (match, name) => NAMED_ENTITIES[name] ?? match);
}

function safeFromCodePoint(code: number): string {
  if (!Number.isFinite(code) || code < 0 || code > 0x10ffff) return "";
  try {
    return String.fromCodePoint(code);
  } catch {
    return "";
  }
}

/**
 * Reduce HTML to readable text: drop script/style blocks and all tags, decode
 * entities, and collapse whitespace. Basic regex only — no parser dependency.
 */
export function htmlToText(html: string): string {
  return decodeEntities(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
      .replace(/<!--[\s\S]*?-->/g, " ")
      .replace(/<[^>]+>/g, " "),
  )
    .replace(/\s+/g, " ")
    .trim();
}

// --- cached page fetch -------------------------------------------------------

export interface FetchPageResult {
  ok: boolean;
  url: string;
  statusCode: number | null;
  /** Tag-stripped, entity-decoded page text, or null on failure. */
  text: string | null;
  /** True when served from research_cache rather than the network. */
  fromCache: boolean;
  error: string | null;
}

export interface FetchPageOptions {
  url: string;
  /** Read/write research_cache. Defaults to true. */
  useCache?: boolean;
  /** Cache lifetime. Defaults to {@link CACHE_TTL_MS}. */
  cacheTtlMs?: number;
  timeoutMs?: number;
  maxRetries?: number;
}

interface CacheRow {
  content: string | null;
  status_code: number | null;
  expires_at: string;
}

/** Return fresh cached text for this org+url, or null on miss/expiry/error. */
async function readCache(
  ctx: ResearchContext,
  url: string,
): Promise<{ content: string; statusCode: number | null } | null> {
  try {
    const { data } = await ctx.client
      .from("research_cache")
      .select("content, status_code, expires_at")
      .eq("organization_id", ctx.organizationId)
      .eq("url", url)
      .maybeSingle();

    const row = data as CacheRow | null;
    if (!row || row.content == null) return null;
    if (Date.parse(row.expires_at) <= Date.now()) return null;
    return { content: row.content, statusCode: row.status_code };
  } catch (err) {
    console.error(`[web-fetcher] cache read failed for ${url}:`, err);
    return null;
  }
}

/** Upsert fetched text into research_cache. Best-effort; never throws. */
async function writeCache(
  ctx: ResearchContext,
  url: string,
  content: string,
  statusCode: number | null,
  ttlMs: number,
): Promise<void> {
  try {
    const nowMs = Date.now();
    await ctx.client.from("research_cache").upsert(
      {
        organization_id: ctx.organizationId,
        url,
        content,
        status_code: statusCode,
        fetched_at: new Date(nowMs).toISOString(),
        expires_at: new Date(nowMs + ttlMs).toISOString(),
      },
      { onConflict: "organization_id,url" },
    );
  } catch (err) {
    console.error(`[web-fetcher] cache write failed for ${url}:`, err);
  }
}

/**
 * Fetch a page as readable text, served from the 24h cache when available.
 * Caches the extracted text (not raw HTML) so re-runs reuse the parse-ready
 * form. Never throws — failures come back as `{ ok: false, error }`.
 */
export async function fetchPage(
  ctx: ResearchContext,
  options: FetchPageOptions,
): Promise<FetchPageResult> {
  const { url } = options;
  if (domainOf(url) === "") {
    return {
      ok: false,
      url,
      statusCode: null,
      text: null,
      fromCache: false,
      error: "invalid_url",
    };
  }

  const useCache = options.useCache ?? true;
  if (useCache) {
    const cached = await readCache(ctx, url);
    if (cached) {
      return {
        ok: true,
        url,
        statusCode: cached.statusCode,
        text: cached.content,
        fromCache: true,
        error: null,
      };
    }
  }

  const raw = await fetchRaw({
    url,
    timeoutMs: options.timeoutMs,
    maxRetries: options.maxRetries,
    accept: "text/html,application/xhtml+xml",
  });

  if (!raw.ok || raw.body == null) {
    return {
      ok: false,
      url,
      statusCode: raw.statusCode,
      text: null,
      fromCache: false,
      error: raw.error,
    };
  }

  const text = htmlToText(raw.body).slice(0, MAX_TEXT_CHARS);
  if (useCache) {
    await writeCache(ctx, url, text, raw.statusCode, options.cacheTtlMs ?? CACHE_TTL_MS);
  }

  return {
    ok: true,
    url,
    statusCode: raw.statusCode,
    text,
    fromCache: false,
    error: null,
  };
}
