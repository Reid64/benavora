// Foundation directory enrichment agent — STANDING_DIRECTIVES.md Directive 1,
// enrichment waterfall sources #1 (IRS 990 XML), #5 (foundation website
// scraper), and the "web enrichment never run at scale" gap it calls out.
//
// Enriches `foundation_directory` (SCHEMA_REGISTRY_v2.md real live columns,
// confirmed against migration 046/058/072 and scripts/enrich-foundations-990.ts:
// id, ein, name, city, state, website, email, phone, enrichment jsonb,
// enriched_990_at, enriched_web_at, website_discovered_via) using three
// waterfall strategies per record, all routed through StealthEngine so every
// request — including the IRS index/XML downloads — carries the same
// browser-level fingerprint used by the rest of the scraper stack:
//
//   1. IRS 990 e-file index — match EIN to a filing, pull WebsiteAddressTxt /
//      PhoneNum out of the XML (reuses IRS990Source.parseXml, the same field
//      extraction scripts/enrich-foundations-990.ts already relies on).
//   2. Google search fallback — for foundations Strategy 1 didn't resolve.
//   3. Contact-page extraction — once a website is known (from Strategy 1,
//      Strategy 2, or already on file), crawl its contact/about page for
//      emails and a phone number.
//
// Deviation from the task-given write targets, documented per project
// convention (see benavora-task-migration-specs-collide memory note): the
// task also asked for a write-back to `donor_discovery_prospects`. That table
// (migration 067) has no email/phone/website columns — it's a pipeline-stage
// row (score, pipeline_stage, notes) keyed to `donor_discovery_directory`,
// not to `foundation_directory`, and there is no FK linking the two tables to
// join through. There is nothing there to write. This agent writes only to
// `foundation_directory`.
//
// Resumable: writes ./enrichment-output/scraper-checkpoint.json every 100
// processed records (and on completion/early exit). A re-run with no
// argument resumes from that checkpoint; passing `startOffset` explicitly
// always starts a fresh run at that row offset.

import fs from "node:fs";
import path from "node:path";
import * as cheerio from "cheerio";
import pLimit from "p-limit";

import { createAdminClient } from "@/lib/supabase/admin";
import { StealthEngine } from "@/lib/scraper/stealth-engine";
import { IRS990Source } from "@/lib/enrichment/sources/irs990";

// --- config ------------------------------------------------------------------

const BATCH_SIZE = 20;
const CONCURRENCY = 3;
const CHECKPOINT_EVERY = 100;
const MIN_REQUEST_DELAY_MS = 200;

const IRS_990_YEAR = process.env["IRS_990_YEAR"] ? Number(process.env["IRS_990_YEAR"]) : new Date().getFullYear();
const IRS_990_INDEX_URL =
  process.env["IRS_990_INDEX_URL"] ?? `https://apps.irs.gov/pub/epostcard/990/xml/${IRS_990_YEAR}/index_${IRS_990_YEAR}.csv`;

const OUTPUT_DIR = path.resolve("./enrichment-output");
const CHECKPOINT_FILE = path.join(OUTPUT_DIR, "scraper-checkpoint.json");

const EXCLUDED_SEARCH_HOSTS = [
  "linkedin.com",
  "facebook.com",
  "instagram.com",
  "youtube.com",
  "twitter.com",
  "x.com",
  "google.com",
];

// --- small helpers -------------------------------------------------------------

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function log(message: string): void {
  console.log(`[${new Date().toISOString()}] ${message}`);
}

// --- checkpoint ----------------------------------------------------------------

interface StrategyCounts {
  irs990: number;
  google: number;
  contactPage: number;
}

interface Checkpoint {
  offset: number;
  processed: number;
  enriched: number;
  strategyCounts: StrategyCounts;
  startedAt: string;
  updatedAt: string;
}

function freshCheckpoint(offset: number): Checkpoint {
  const now = new Date().toISOString();
  return {
    offset,
    processed: 0,
    enriched: 0,
    strategyCounts: { irs990: 0, google: 0, contactPage: 0 },
    startedAt: now,
    updatedAt: now,
  };
}

function loadCheckpoint(startOffset?: number): Checkpoint {
  if (startOffset !== undefined) return freshCheckpoint(startOffset);

  if (fs.existsSync(CHECKPOINT_FILE)) {
    try {
      return JSON.parse(fs.readFileSync(CHECKPOINT_FILE, "utf-8")) as Checkpoint;
    } catch (err) {
      log(`WARN could not parse existing checkpoint, starting fresh: ${(err as Error).message}`);
    }
  }
  return freshCheckpoint(0);
}

function saveCheckpoint(cp: Checkpoint): void {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  cp.updatedAt = new Date().toISOString();
  fs.writeFileSync(CHECKPOINT_FILE, JSON.stringify(cp, null, 2));
}

// --- engine pool: N persistent StealthEngine instances = N browser contexts ----

interface PooledEngine {
  engine: StealthEngine;
  lastRequestAt: number;
}

class EnginePool {
  private readonly all: PooledEngine[];
  private idle: PooledEngine[];
  private waiters: Array<(pooled: PooledEngine) => void> = [];

  constructor(engines: PooledEngine[]) {
    this.all = engines;
    this.idle = [...engines];
  }

  async acquire(): Promise<PooledEngine> {
    const next = this.idle.shift();
    if (next) return next;
    return new Promise((resolve) => this.waiters.push(resolve));
  }

  release(pooled: PooledEngine): void {
    const waiter = this.waiters.shift();
    if (waiter) {
      waiter(pooled);
    } else {
      this.idle.push(pooled);
    }
  }

  async closeAll(): Promise<void> {
    await Promise.all(this.all.map((p) => p.engine.close().catch(() => {})));
  }
}

/** Enforces the 200ms-minimum-per-context gap before any network call on `pooled`. */
async function throttle(pooled: PooledEngine): Promise<void> {
  const elapsed = Date.now() - pooled.lastRequestAt;
  if (elapsed < MIN_REQUEST_DELAY_MS) await sleep(MIN_REQUEST_DELAY_MS - elapsed);
  pooled.lastRequestAt = Date.now();
}

async function throttledFetch(pooled: PooledEngine, url: string): Promise<string | null> {
  await throttle(pooled);
  return pooled.engine.fetchPage(url);
}

async function throttledFindContactPage(pooled: PooledEngine, baseUrl: string): Promise<string | null> {
  await throttle(pooled);
  return pooled.engine.findContactPage(baseUrl);
}

// --- Strategy 1: IRS 990 XML index --------------------------------------------

// Fallback positional indices for the IRS 990 index CSV when header-name
// lookup fails (trailing CR on header names) — same fallback set
// scripts/enrich-foundations-990.ts uses against the same file.
const EIN_FALLBACK_IDX = 1;
const OBJECT_ID_FALLBACK_IDX = 7;
const XML_BATCH_ID_FALLBACK_IDX = 8;

/**
 * StealthEngine.fetchPage() returns the rendered page HTML, not a raw HTTP
 * body — Chromium wraps a text/csv response in a plain-text viewer. Unwrap
 * back to the underlying text before line-splitting.
 */
function extractRawText(rendered: string): string {
  const trimmed = rendered.trim();
  if (!trimmed.startsWith("<")) return rendered;
  const $ = cheerio.load(rendered);
  const pre = $("pre").text();
  if (pre.trim().length > 0) return pre;
  return $("body").text();
}

function parseIndexCsv(text: string, neededEins: Set<string>): Map<string, string> {
  const map = new Map<string, string>();
  let headers: string[] | null = null;

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    const cols = line.split(",").map((c) => c.trim().replace(/^"|"$/g, ""));

    if (!headers) {
      headers = cols.map((h) => h.toLowerCase());
      continue;
    }

    let einIdx = headers.indexOf("ein");
    if (einIdx < 0) einIdx = EIN_FALLBACK_IDX;
    const ein = (cols[einIdx] ?? "").replace(/\D/g, "");
    if (!ein || !neededEins.has(ein)) continue;

    const urlIdx = headers.indexOf("url");
    let objectIdIdx = headers.indexOf("object_id");
    if (objectIdIdx < 0) objectIdIdx = OBJECT_ID_FALLBACK_IDX;
    let xmlBatchIdIdx = headers.indexOf("xml_batch_id");
    if (xmlBatchIdIdx < 0) xmlBatchIdIdx = XML_BATCH_ID_FALLBACK_IDX;

    const objectId = (cols[objectIdIdx] ?? "").trim();
    const xmlBatchId = (cols[xmlBatchIdIdx] ?? "").trim();
    let xmlUrl = urlIdx >= 0 ? (cols[urlIdx] ?? "").trim() : "";
    if (!xmlUrl && objectId) xmlUrl = `https://s3.amazonaws.com/irs-form-990/${objectId}_public.xml`;
    if (!xmlUrl && xmlBatchId) xmlUrl = `https://s3.amazonaws.com/irs-form-990/${xmlBatchId}_public.xml`;
    if (!xmlUrl) continue;

    map.set(ein, xmlUrl);
  }

  return map;
}

async function loadEinsMissingWebsite(supabase: ReturnType<typeof createAdminClient>): Promise<Set<string>> {
  const set = new Set<string>();
  const PAGE = 5000;
  let from = 0;

  for (;;) {
    const { data, error } = await supabase
      .from("foundation_directory")
      .select("ein")
      .is("website", null)
      .range(from, from + PAGE - 1);

    if (error) {
      log(`WARN could not load foundation_directory EINs for index matching: ${error.message}`);
      break;
    }
    if (!data || data.length === 0) break;

    for (const row of data as Array<{ ein: string | null }>) {
      const ein = String(row.ein ?? "").replace(/\D/g, "");
      if (ein) set.add(ein);
    }

    if (data.length < PAGE) break;
    from += PAGE;
  }

  return set;
}

/** Downloads + parses the IRS 990 index once, scoped to EINs currently missing a website. */
async function buildEinIndex(
  pool: EnginePool,
  supabase: ReturnType<typeof createAdminClient>,
): Promise<Map<string, string>> {
  const neededEins = await loadEinsMissingWebsite(supabase);
  if (neededEins.size === 0) return new Map();

  const pooled = await pool.acquire();
  try {
    log(`Strategy 1: downloading IRS 990 index (${IRS_990_INDEX_URL}) for ${neededEins.size} foundation(s) missing a website`);
    const rendered = await throttledFetch(pooled, IRS_990_INDEX_URL);
    if (!rendered) {
      log("WARN Strategy 1: could not download IRS 990 index this run — continuing with Strategy 2/3 only");
      return new Map();
    }
    const map = parseIndexCsv(extractRawText(rendered), neededEins);
    log(`Strategy 1: matched ${map.size} EIN(s) to an XML filing in the index`);
    return map;
  } catch (err) {
    log(`WARN Strategy 1: index download/parse failed (${(err as Error).message}) — continuing with Strategy 2/3 only`);
    return new Map();
  } finally {
    pool.release(pooled);
  }
}

async function tryIrs990(
  row: FoundationRow,
  einIndex: Map<string, string>,
  pooled: PooledEngine,
  irs990Source: IRS990Source,
): Promise<{ website?: string; phone?: string } | null> {
  const ein = String(row.ein ?? "").replace(/\D/g, "");
  const xmlUrl = ein ? einIndex.get(ein) : undefined;
  if (!xmlUrl) return null;

  const xml = await throttledFetch(pooled, xmlUrl);
  if (!xml) return null;

  const parsed = irs990Source.parseXml(ein, xml, xmlUrl);
  if (!parsed) return null;

  const update: { website?: string; phone?: string } = {};
  if (!row.website && parsed.website) update.website = parsed.website;
  if (!row.phone && parsed.phones.length > 0) update.phone = parsed.phones[0] as string;
  return Object.keys(update).length > 0 ? update : null;
}

// --- Strategy 2: Google search fallback ---------------------------------------

function isExcludedSearchHost(url: string): boolean {
  try {
    const host = new URL(url).hostname.replace(/^www\./, "");
    return EXCLUDED_SEARCH_HOSTS.some((excluded) => host === excluded || host.endsWith(`.${excluded}`));
  } catch {
    return true;
  }
}

function extractSearchResultLinks(html: string): string[] {
  const $ = cheerio.load(html);
  const links: string[] = [];
  $("a[href]").each((_i, el) => {
    const href = $(el).attr("href") ?? "";
    let candidate: string | null = null;
    if (href.startsWith("/url?q=") || href.includes("/url?q=")) {
      const match = /[?&]q=([^&]+)/.exec(href);
      if (match?.[1]) {
        try {
          candidate = decodeURIComponent(match[1]);
        } catch {
          candidate = null;
        }
      }
    } else if (href.startsWith("http")) {
      candidate = href;
    }
    if (candidate) links.push(candidate);
  });
  return links;
}

async function validateUrl(url: string): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8_000);
    try {
      const res = await fetch(url, { method: "GET", redirect: "follow", signal: controller.signal });
      return res.ok;
    } finally {
      clearTimeout(timeout);
    }
  } catch {
    return false;
  }
}

async function tryGoogleFallback(row: FoundationRow, pooled: PooledEngine): Promise<string | null> {
  const location = [row.city, row.state].filter(Boolean).join(" ");
  const query = `"${row.name}" ${location} foundation site:*`;
  const searchUrl = `https://www.google.com/search?q=${encodeURIComponent(query)}&num=10`;

  const html = await throttledFetch(pooled, searchUrl);
  if (!html) return null;

  for (const link of extractSearchResultLinks(html)) {
    if (isExcludedSearchHost(link)) continue;
    if (await validateUrl(link)) return link;
  }
  return null;
}

// --- Strategy 3: contact-page extraction --------------------------------------

async function tryContactPage(
  website: string,
  pooled: PooledEngine,
): Promise<{ emails: string[]; phone: string | null }> {
  const contactUrl = (await throttledFindContactPage(pooled, website)) ?? website;
  const html = await throttledFetch(pooled, contactUrl);
  if (!html) return { emails: [], phone: null };

  const emails = await pooled.engine.extractEmails(html);
  const phone = await pooled.engine.extractPhone(html);
  return { emails, phone };
}

// --- per-foundation waterfall --------------------------------------------------

interface FoundationRow {
  id: string;
  ein: string | null;
  name: string;
  city: string | null;
  state: string | null;
  website: string | null;
  email: string | null;
  phone: string | null;
}

type Strategy = "irs990" | "google" | "contactPage" | "none";

interface ProcessResult {
  enriched: boolean;
  strategy: Strategy;
}

async function processFoundation(
  row: FoundationRow,
  einIndex: Map<string, string>,
  pool: EnginePool,
  irs990Source: IRS990Source,
  supabase: ReturnType<typeof createAdminClient>,
): Promise<ProcessResult> {
  if (row.website && row.email && row.phone) {
    return { enriched: false, strategy: "none" };
  }

  const pooled = await pool.acquire();
  try {
    const update: Record<string, unknown> = {};
    let strategy: Strategy = "none";
    let website = row.website;

    if (!website) {
      try {
        const found = await tryIrs990(row, einIndex, pooled, irs990Source);
        if (found?.website) {
          update["website"] = found.website;
          update["website_discovered_via"] = "irs_990_xml";
          website = found.website;
          strategy = "irs990";
        }
        if (found?.phone && !row.phone) update["phone"] = found.phone;
      } catch (err) {
        log(`WARN [${row.id}] Strategy 1 (IRS 990) failed: ${(err as Error).message}`);
      }
    }

    if (!website) {
      try {
        const found = await tryGoogleFallback(row, pooled);
        if (found) {
          update["website"] = found;
          update["website_discovered_via"] = "google_search";
          website = found;
          strategy = "google";
        }
      } catch (err) {
        log(`WARN [${row.id}] Strategy 2 (Google fallback) failed: ${(err as Error).message}`);
      }
    }

    if (website && (!row.email || !row.phone)) {
      try {
        const { emails, phone } = await tryContactPage(website, pooled);
        if (emails.length > 0 && !row.email) update["email"] = emails[0];
        if (phone && !row.phone && !update["phone"]) update["phone"] = phone;
        if (emails.length > 0 || phone) {
          // Precedent: scripts/enrich-foundations-websites.ts deliberately
          // writes contact-page findings into enrichment.* rather than the
          // dedicated contact_emails/contact_phones array columns (migration
          // 058) to avoid two independent writers racing on the same arrays.
          update["enrichment"] = {
            contact_emails: emails,
            contact_phones: phone ? [phone] : [],
            contact_scraped_at: new Date().toISOString(),
          };
          if (strategy === "none") strategy = "contactPage";
        }
      } catch (err) {
        log(`WARN [${row.id}] Strategy 3 (contact page) failed: ${(err as Error).message}`);
      }
    }

    if (Object.keys(update).length === 0) {
      return { enriched: false, strategy: "none" };
    }

    update["enriched_web_at"] = new Date().toISOString();

    const { error } = await supabase.from("foundation_directory").update(update).eq("id", row.id);
    if (error) {
      log(`WARN [${row.id}] failed to write enrichment: ${error.message}`);
      return { enriched: false, strategy: "none" };
    }

    return { enriched: true, strategy };
  } catch (err) {
    log(`WARN [${row.id}] unrecoverable error, skipping: ${(err as Error).message}`);
    return { enriched: false, strategy: "none" };
  } finally {
    pool.release(pooled);
  }
}

// --- main ----------------------------------------------------------------------

/**
 * @param startOffset row offset into foundation_directory to start at. Passing
 *   any value (including 0) starts a fresh checkpoint, discarding prior
 *   processed/enriched counts — see loadCheckpoint(). Omit to resume from the
 *   existing checkpoint file.
 * @param maxToProcess stops the run once this many rows have been processed
 *   *in this call* (not cumulative across prior runs), saving the checkpoint
 *   so a later call can resume from where this one stopped. Omit to run
 *   until foundation_directory is exhausted.
 */
export async function runFoundationScraper(startOffset?: number, maxToProcess?: number): Promise<void> {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  const supabase = createAdminClient();
  const checkpoint = loadCheckpoint(startOffset);
  const processedAtRunStart = checkpoint.processed;
  const irs990Source = new IRS990Source();

  const engines: PooledEngine[] = [];
  for (let i = 0; i < CONCURRENCY; i++) {
    const engine = new StealthEngine();
    await engine.init();
    engines.push({ engine, lastRequestAt: 0 });
  }
  const pool = new EnginePool(engines);
  const limit = pLimit(CONCURRENCY);

  log(`Starting foundation scraper at offset ${checkpoint.offset} (processed so far: ${checkpoint.processed}, enriched so far: ${checkpoint.enriched})`);

  try {
    const einIndex = await buildEinIndex(pool, supabase);
    let offset = checkpoint.offset;

    for (;;) {
      const { data, error } = await supabase
        .from("foundation_directory")
        .select("id, ein, name, city, state, website, email, phone")
        .order("id", { ascending: true })
        .range(offset, offset + BATCH_SIZE - 1);

      if (error) {
        log(`WARN batch fetch failed at offset ${offset}: ${error.message} — stopping`);
        break;
      }
      if (!data || data.length === 0) break;

      const rows = data as FoundationRow[];
      const batchCounts: StrategyCounts = { irs990: 0, google: 0, contactPage: 0 };
      let batchEnriched = 0;

      const results = await Promise.all(
        rows.map((row) => limit(() => processFoundation(row, einIndex, pool, irs990Source, supabase))),
      );

      for (const result of results) {
        checkpoint.processed++;
        if (result.enriched) {
          checkpoint.enriched++;
          batchEnriched++;
          if (result.strategy === "irs990") {
            checkpoint.strategyCounts.irs990++;
            batchCounts.irs990++;
          } else if (result.strategy === "google") {
            checkpoint.strategyCounts.google++;
            batchCounts.google++;
          } else if (result.strategy === "contactPage") {
            checkpoint.strategyCounts.contactPage++;
            batchCounts.contactPage++;
          }
        }
      }

      offset += rows.length;
      checkpoint.offset = offset;

      log(
        `processed=${checkpoint.processed} enriched=${checkpoint.enriched} ` +
          `batchEnriched=${batchEnriched}/${rows.length} ` +
          `strategies(irs990=${batchCounts.irs990}, google=${batchCounts.google}, contactPage=${batchCounts.contactPage})`,
      );

      if (checkpoint.processed % CHECKPOINT_EVERY === 0) {
        saveCheckpoint(checkpoint);
      }

      if (maxToProcess !== undefined && checkpoint.processed - processedAtRunStart >= maxToProcess) {
        log(`Reached batch limit of ${maxToProcess} for this run — stopping (resume at offset ${checkpoint.offset}).`);
        break;
      }

      if (rows.length < BATCH_SIZE) break;
    }

    saveCheckpoint(checkpoint);
    log(
      `Done. processed=${checkpoint.processed} enriched=${checkpoint.enriched} ` +
        `strategies(irs990=${checkpoint.strategyCounts.irs990}, google=${checkpoint.strategyCounts.google}, contactPage=${checkpoint.strategyCounts.contactPage})`,
    );
  } finally {
    await pool.closeAll();
  }
}
