// ============================================================================
// BENAVORA — nonprofit website discovery via Bing/Yahoo HTML search
//
// For nonprofits with no known website, searches Bing's HTML search results
// ("{name} {city} {state} nonprofit") and takes the first organic result
// that isn't a social network, search engine, or nonprofit-directory site
// (those are about the org, not the org's own site). Falls back to Yahoo
// search if Bing returns nothing usable.
//
// NO API key required. Pure HTTP + cheerio against
// https://www.bing.com/search and https://search.yahoo.com/search.
//
// Idempotent: only ever writes nonprofits.website (currently NULL). A miss
// is left untouched so it's picked back up on the next run — pagination
// therefore walks forward by id (keyset cursor) rather than re-querying
// "website IS NULL" from the top each batch, otherwise a run of all-misses
// would loop forever on the same 500 rows.
// State-partitioned: pass --states=TX,CA,FL to run multiple windows
// concurrently against disjoint partitions, same convention as
// scripts/enrich-propublica-contacts.ts. Args are read directly off
// process.argv (not node:util's parseArgs) so this survives pnpm's "--"
// argument-forwarding quirk.
//
//   pnpm discover:websites
//   npx tsx scripts/discover-websites.ts --states=TX,CA,FL
// ============================================================================

import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import * as cheerio from "cheerio";
import ws from "ws";

// ---- Config -----------------------------------------------------------------
const BING_URL = "https://www.bing.com/search";
const YAHOO_URL = "https://search.yahoo.com/search";
const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
const BATCH_SIZE = 500;
const DELAY_MS = 800;
const FETCH_TIMEOUT_MS = 6000;
const LOG_EVERY = 100;

const EXCLUDED_DOMAINS = [
  "duckduckgo.com",
  "bing.com",
  "yahoo.com",
  "facebook.com",
  "linkedin.com",
  "twitter.com",
  "x.com",
  "guidestar.org",
  "charitynavigator.org",
];

// ---- Helpers ----------------------------------------------------------------
function log(msg: string) {
  console.log(`[${new Date().toISOString()}] ${msg}`);
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// Reads process.argv directly instead of node:util's parseArgs — pnpm forwards
// a literal extra "--" ahead of user args on this setup, which made parseArgs
// (without allowPositionals) throw and silently fall back to no filter.
// Scanning the whole argv array for a "--states=" token sidesteps that.
function parseStatesArg(): string[] | null {
  const statesArg = process.argv.find((a) => a.startsWith("--states="));
  return statesArg ? statesArg.replace("--states=", "").split(/[,\s]+/).filter(Boolean) : null;
}

interface NonprofitRow {
  id: string;
  ein: string;
  name: string;
  city: string | null;
  state: string | null;
}

function isExcludedDomain(hostname: string): boolean {
  const h = hostname.replace(/^www\./i, "").toLowerCase();
  return EXCLUDED_DOMAINS.some((d) => h === d || h.endsWith(`.${d}`));
}

// Drop query string and fragment — this is the "strip tracking params" step;
// anything past the path (utm_*, fbclid, session ids, ...) is noise for a
// bare organization homepage URL.
function cleanUrl(raw: string): string | null {
  try {
    const url = new URL(raw);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    url.search = "";
    url.hash = "";
    return url.toString();
  } catch {
    return null;
  }
}

// Bing/Yahoo's displayed-URL text is breadcrumb-style (e.g. "example.org ›
// about-us") — the homepage is the first segment before the separator.
function displayTextToUrl(text: string): string | null {
  const firstSegment = text.split(/[›»]/)[0]?.trim();
  if (!firstSegment) return null;
  const withProtocol = /^https?:\/\//i.test(firstSegment) ? firstSegment : `https://${firstSegment}`;
  return cleanUrl(withProtocol);
}

function firstAllowedUrl(candidates: string[]): string | null {
  for (const candidate of candidates) {
    try {
      if (!isExcludedDomain(new URL(candidate).hostname)) return candidate;
    } catch {
      continue;
    }
  }
  return null;
}

function extractBingUrls($: cheerio.CheerioAPI): string[] {
  const urls: string[] = [];

  $(".b_algo").each((_, el) => {
    const href = $(el).find("h2 a").attr("href");
    if (href) {
      const cleaned = cleanUrl(href);
      if (cleaned) urls.push(cleaned);
    }
    const citeText = $(el).find("cite, .b_attribution cite").first().text().trim();
    if (citeText) {
      const cleaned = displayTextToUrl(citeText);
      if (cleaned) urls.push(cleaned);
    }
  });

  return urls;
}

function extractYahooUrls($: cheerio.CheerioAPI): string[] {
  const urls: string[] = [];

  $(".algo-sr .compTitle a").each((_, el) => {
    const href = $(el).attr("href");
    if (href) {
      const cleaned = cleanUrl(href);
      if (cleaned) urls.push(cleaned);
    }
  });

  $("dd.d span").each((_, el) => {
    const text = $(el).text().trim();
    if (text) {
      const cleaned = displayTextToUrl(text);
      if (cleaned) urls.push(cleaned);
    }
  });

  return urls;
}

// TEMP DEBUG: log status + whether any candidate URLs were found (pre-filter)
// for the first N requests across both engines combined, then stop.
let debugRequestCount = 0;
const DEBUG_REQUEST_LIMIT = 5;

async function fetchSearchHtml(url: string, engine: "bing" | "yahoo"): Promise<string | null> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    const res = await fetch(url, {
      headers: { "User-Agent": USER_AGENT },
      signal: controller.signal,
    });
    clearTimeout(timer);
    const html = await res.text();

    if (debugRequestCount < DEBUG_REQUEST_LIMIT) {
      debugRequestCount++;
      const $ = cheerio.load(html);
      const urlsFound = (engine === "bing" ? extractBingUrls($) : extractYahooUrls($)).length > 0;
      log(`DEBUG [${engine}]: status=${res.status} urlsFoundBeforeFilter=${urlsFound}`);
    }

    if (!res.ok) return null;
    return html;
  } catch {
    return null;
  }
}

async function searchBing(query: string): Promise<string | null> {
  const url = `${BING_URL}?q=${encodeURIComponent(query)}&count=5`;
  const html = await fetchSearchHtml(url, "bing");
  if (!html) return null;
  const $ = cheerio.load(html);
  return firstAllowedUrl(extractBingUrls($));
}

async function searchYahoo(query: string): Promise<string | null> {
  const url = `${YAHOO_URL}?p=${encodeURIComponent(query)}`;
  const html = await fetchSearchHtml(url, "yahoo");
  if (!html) return null;
  const $ = cheerio.load(html);
  return firstAllowedUrl(extractYahooUrls($));
}

async function searchWeb(query: string): Promise<string | null> {
  const bingResult = await searchBing(query);
  if (bingResult) return bingResult;
  return searchYahoo(query);
}

async function discoverBatch(
  db: SupabaseClient,
  rows: NonprofitRow[],
  stats: { processed: number; found: number; skipped: number; failed: number }
) {
  for (const row of rows) {
    stats.processed++;

    const locality = [row.city, row.state].filter(Boolean).join(" ");
    const query = `${row.name} ${locality} nonprofit`.replace(/\s+/g, " ").trim();

    let website: string | null = null;
    try {
      website = await searchWeb(query);
    } catch {
      website = null;
    }
    await sleep(DELAY_MS);

    if (!website) {
      stats.skipped++;
    } else {
      const { error } = await db.from("nonprofits").update({ website }).eq("id", row.id);
      if (error) {
        stats.failed++;
        if (stats.failed % 50 === 0) log(`WARN: ${stats.failed} update failures so far`);
      } else {
        stats.found++;
        log(`Found: ${row.name} -> ${website}`);
      }
    }

    if (stats.processed % LOG_EVERY === 0) {
      log(
        `Progress: ${stats.processed} processed | ${stats.found} found | ${stats.skipped} skipped | ${stats.failed} failed`
      );
    }
  }
}

// ws's constructor overloads (some accept `address: null` for lazy-connect)
// aren't structurally assignable to realtime-js's WebSocketLikeConstructor
// as-is; ws is otherwise a drop-in WebSocketLike implementation, so re-type
// it through `unknown` rather than widen with `any`.
type WsTransport = new (address: string | URL, subprotocols?: string | string[]) => WebSocket;

async function main() {
  const states = parseStatesArg();

  const db = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { global: { headers: {} }, realtime: { transport: ws as unknown as WsTransport } }
  );

  const stateLabel = states ? states.join(",") : "ALL";
  log(`Website discovery starting — states: ${stateLabel}`);

  const stats = { processed: 0, found: 0, skipped: 0, failed: 0 };
  let batchNum = 0;
  let cursor: string | null = null;

  while (true) {
    batchNum++;

    let query = db
      .from("nonprofits")
      .select("id, ein, name, city, state")
      .is("website", null)
      .not("ein", "is", null)
      .order("id", { ascending: true })
      .limit(BATCH_SIZE);

    if (cursor) {
      query = query.gt("id", cursor);
    }
    if (states && states.length > 0) {
      query = query.in("state", states);
    }

    const { data: rows, error } = await query as { data: NonprofitRow[] | null; error: unknown };

    if (error) {
      log(`FATAL: DB query failed — ${JSON.stringify(error)}`);
      break;
    }

    if (!rows || rows.length === 0) {
      log(
        `All candidates exhausted. Total processed: ${stats.processed} | Found: ${stats.found} | Skipped: ${stats.skipped} | Failed: ${stats.failed}`
      );
      break;
    }

    cursor = rows[rows.length - 1]!.id;
    log(`Batch ${batchNum}: ${rows.length} candidates`);

    await discoverBatch(db, rows, stats);
  }

  log(
    `COMPLETE — ${stats.processed} processed | ${stats.found} found | ${stats.skipped} skipped | ${stats.failed} failed`
  );
}

main().catch((err) => {
  console.error("FATAL:", err);
  process.exit(1);
});
