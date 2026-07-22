// ============================================================================
// BENAVORA — nonprofit website discovery via DuckDuckGo HTML search
//
// For nonprofits with no known website, searches DuckDuckGo's no-JS HTML
// endpoint ("{name} {city} {state} nonprofit") and takes the first organic
// result that isn't a social network or a nonprofit-directory site (those
// are about the org, not the org's own site).
//
// NO API key required. Pure HTTP + cheerio against
// https://html.duckduckgo.com/html/.
//
// Idempotent: only ever writes nonprofits.website (currently NULL). A miss
// is left untouched so it's picked back up on the next run — pagination
// therefore walks forward by id (keyset cursor) rather than re-querying
// "website IS NULL" from the top each batch, otherwise a run of all-misses
// would loop forever on the same 500 rows.
// State-partitioned: pass --states TX,CA,FL to run multiple windows
// concurrently against disjoint partitions, same convention as
// scripts/enrich-propublica-contacts.ts.
//
//   pnpm discover:websites
//   pnpm discover:websites -- --states TX,CA,FL
// ============================================================================

import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import { parseArgs } from "node:util";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import * as cheerio from "cheerio";
import ws from "ws";

// ---- Config -----------------------------------------------------------------
const DDG_HTML_URL = "https://html.duckduckgo.com/html/";
const USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36";
const BATCH_SIZE = 500;
const DELAY_MS = 1500;
const FETCH_TIMEOUT_MS = 10_000;
const LOG_EVERY = 100;

const EXCLUDED_DOMAINS = [
  "duckduckgo.com",
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

function parseStatesArg(): string[] | null {
  try {
    const { values } = parseArgs({ options: { states: { type: "string" } } });
    if (!values.states) return null;
    return values.states.split(/[,\s]+/).map((s) => s.trim().toUpperCase()).filter(Boolean);
  } catch {
    return null;
  }
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

// DDG's html endpoint wraps result links in a `/l/?uddg=<encoded-target>`
// redirect (protocol-relative href). Unwrap it to get the real target URL.
function resolveResultHref(href: string): string | null {
  try {
    const full = href.startsWith("//") ? `https:${href}` : href;
    const url = new URL(full, "https://duckduckgo.com");
    const uddg = url.searchParams.get("uddg");
    if (uddg) return decodeURIComponent(uddg);
    if (url.protocol === "http:" || url.protocol === "https:") return url.toString();
    return null;
  } catch {
    return null;
  }
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

function extractFirstResultUrl($: cheerio.CheerioAPI): string | null {
  const anchors = $(".result__a").toArray();
  for (const el of anchors) {
    const href = $(el).attr("href");
    if (!href) continue;
    const resolved = resolveResultHref(href);
    if (!resolved) continue;
    const cleaned = cleanUrl(resolved);
    if (!cleaned) continue;
    try {
      if (!isExcludedDomain(new URL(cleaned).hostname)) return cleaned;
    } catch {
      continue;
    }
  }

  // Fallback: the displayed-URL span, protocol-less text like "example.org/about"
  const urlSpans = $(".result__url").toArray();
  for (const el of urlSpans) {
    const text = $(el).text().trim();
    if (!text) continue;
    const withProtocol = /^https?:\/\//i.test(text) ? text : `https://${text}`;
    const cleaned = cleanUrl(withProtocol);
    if (!cleaned) continue;
    try {
      if (!isExcludedDomain(new URL(cleaned).hostname)) return cleaned;
    } catch {
      continue;
    }
  }

  return null;
}

async function searchDuckDuckGo(query: string): Promise<string | null> {
  const url = `${DDG_HTML_URL}?q=${encodeURIComponent(query)}`;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    const res = await fetch(url, {
      headers: { "User-Agent": USER_AGENT },
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (!res.ok) return null;
    const html = await res.text();
    const $ = cheerio.load(html);
    return extractFirstResultUrl($);
  } catch {
    return null;
  }
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
      website = await searchDuckDuckGo(query);
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
