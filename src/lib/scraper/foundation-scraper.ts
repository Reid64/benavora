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
//
// Not deleted per UNIVERSAL_SCRAPER_PRD.md §4 — this file's standalone CLI
// entry point (scripts/run-foundation-scraper.ts, `pnpm scrape:foundations`)
// remains in place. Its proven Strategy 1 batch-ZIP discovery logic
// (buildEinIndex/tryIrs990/EnginePool/PooledEngine below, all now exported)
// is separately reused unchanged — not rebuilt — as a custom discovery
// source by src/lib/scraper-v2/templates/foundation-990-template.ts, the
// pre-configured universal-scraper-v2 job template that re-hosts this same
// EIN->filing lookup under the new scrape_jobs/scrape_results job model.

import fs from "node:fs";
import path from "node:path";
import * as cheerio from "cheerio";
import pLimit from "p-limit";
import unzipper from "unzipper";

import { createAdminClient } from "@/lib/supabase/admin";
import { StealthEngine } from "@/lib/scraper/stealth-engine";
import { IRS990Source } from "@/lib/enrichment/sources/irs990";
import { enqueueKnowledgeIndexerTrigger } from "@/lib/agents/knowledge-indexer-agent";

// --- config ------------------------------------------------------------------

const BATCH_SIZE = 20;
const CONCURRENCY = 3;
const CHECKPOINT_EVERY = 100;
const MIN_REQUEST_DELAY_MS = 200;
// BEHAVIORAL_CONTRACTS.md §21: "Minimum 5-second delay between requests to
// the same domain." Scoped to Strategy 3 (the foundation's own website) —
// the actual "target being scraped" §21 means to protect — not to the IRS
// index/XML or Google search infrastructure calls, which are shared,
// one-time-per-run or high-volume lookups against non-target hosts.

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

export interface PooledEngine {
  engine: StealthEngine;
  lastRequestAt: number;
}

export class EnginePool {
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

// Per-domain politeness gate for Strategy 3 (§21). Module-level and shared
// across the whole EnginePool — not per-engine — since two different pooled
// engines could otherwise hit the same target domain concurrently (e.g. two
// related, non-family foundations on the same website) with no coordination.
const SAME_DOMAIN_DELAY_MS = 5000;
const domainLastRequestAt = new Map<string, number>();

function hostnameOf(url: string): string | null {
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}

async function throttleDomain(url: string): Promise<void> {
  const host = hostnameOf(url);
  if (!host) return;
  const elapsed = Date.now() - (domainLastRequestAt.get(host) ?? 0);
  if (elapsed < SAME_DOMAIN_DELAY_MS) await sleep(SAME_DOMAIN_DELAY_MS - elapsed);
  domainLastRequestAt.set(host, Date.now());
}

async function throttledFetch(pooled: PooledEngine, url: string): Promise<string | null> {
  await throttle(pooled);
  return pooled.engine.fetchPage(url);
}

/** Like throttledFetch(), but via StealthEngine.fetchRaw() — for responses (e.g. CSV) a browser treats as a file download rather than a page. */
async function throttledFetchRaw(pooled: PooledEngine, url: string): Promise<string | null> {
  await throttle(pooled);
  return pooled.engine.fetchRaw(url);
}

/** Like throttledFetchRaw(), but for binary content (a ZIP archive) — see StealthEngine.fetchRawBuffer(). */
async function throttledFetchRawBuffer(pooled: PooledEngine, url: string): Promise<Buffer | null> {
  await throttle(pooled);
  return pooled.engine.fetchRawBuffer(url);
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
 * The index is fetched via StealthEngine.fetchRaw() (see buildEinIndex), so
 * `rendered` is normally already the raw CSV text. This only unwraps the
 * HTML-viewer wrapping Chromium would add if fetchRaw() ever fell through to
 * an HTML error/interstitial response instead of the expected text/csv body.
 */
function extractRawText(rendered: string): string {
  const trimmed = rendered.trim();
  if (!trimmed.startsWith("<")) return rendered;
  const $ = cheerio.load(rendered);
  const pre = $("pre").text();
  if (pre.trim().length > 0) return pre;
  return $("body").text();
}

export interface EinIndexEntry {
  /** Direct per-filing XML URL — used only if the index CSV still has a `url` column (older format). */
  directUrl?: string;
  /**
   * Current (2026) index format has no per-filing URL at all: filings are
   * packaged into per-batch ZIP archives hosted on IRS's own site
   * (apps.irs.gov), not the individual-file layout this code originally
   * assumed. Each ZIP entry inside is named "{object_id}_public.xml" — the
   * same filename the old code tried to hit directly as a URL. Confirmed
   * 2026-07-28 against 3 real filings across false object_ids: the old
   * https://s3.amazonaws.com/irs-form-990/{object_id}_public.xml fallback
   * this used to construct is dead on every real object_id tested (404) —
   * that AWS Open Data bucket is no longer being served/updated. The real
   * batch archive lives at
   * https://apps.irs.gov/pub/epostcard/990/xml/{year}/{xml_batch_id}.zip.
   */
  objectId?: string;
  batchZipUrl?: string;
}

function parseIndexCsv(text: string, neededEins: Set<string>): Map<string, EinIndexEntry> {
  const map = new Map<string, EinIndexEntry>();
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

    const directUrl = urlIdx >= 0 ? (cols[urlIdx] ?? "").trim() : "";
    if (directUrl) {
      map.set(ein, { directUrl });
      continue;
    }

    const objectId = (cols[objectIdIdx] ?? "").trim();
    const xmlBatchId = (cols[xmlBatchIdIdx] ?? "").trim();
    if (objectId && xmlBatchId) {
      map.set(ein, {
        objectId,
        batchZipUrl: `https://apps.irs.gov/pub/epostcard/990/xml/${IRS_990_YEAR}/${xmlBatchId}.zip`,
      });
    }
  }

  return map;
}

// --- Strategy 1 batch-ZIP cache ------------------------------------------------
//
// Many matched EINs share the same batch (a batch holds ~12,000 filings), so
// each batch ZIP is downloaded and opened at most once per run, cached here
// keyed by URL. The cache stores the in-flight Promise (not just the
// resolved value) so concurrent callers awaiting the same batch don't each
// trigger their own download. No eviction: one run's candidate set is
// bounded (BATCH_LIMIT), so unbounded growth within one process is fine.
async function getOrFetchBatchZip(
  pooled: PooledEngine,
  batchZipUrl: string,
  cache: Map<string, Promise<unzipper.CentralDirectory | null>>,
): Promise<unzipper.CentralDirectory | null> {
  let pending = cache.get(batchZipUrl);
  if (!pending) {
    pending = (async () => {
      log(`Strategy 1: downloading IRS 990 batch ZIP: ${batchZipUrl}`);
      const buffer = await throttledFetchRawBuffer(pooled, batchZipUrl);
      if (!buffer) return null;
      try {
        return await unzipper.Open.buffer(buffer);
      } catch (err) {
        log(`WARN Strategy 1: could not open batch ZIP ${batchZipUrl}: ${(err as Error).message}`);
        return null;
      }
    })();
    cache.set(batchZipUrl, pending);
  }
  return pending;
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
      .order("id", { ascending: true })
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

    from += data.length;
  }

  return set;
}

/**
 * Downloads + parses the IRS 990 index once, scoped to EINs currently
 * missing a website. Exported per UNIVERSAL_SCRAPER_PRD.md §4: this is the
 * proven batch-ZIP discovery mechanism reused as-is (not rebuilt) by
 * src/lib/scraper-v2/templates/foundation-990-template.ts's custom
 * discovery source.
 */
export async function buildEinIndex(
  pool: EnginePool,
  supabase: ReturnType<typeof createAdminClient>,
): Promise<Map<string, EinIndexEntry>> {
  const neededEins = await loadEinsMissingWebsite(supabase);
  if (neededEins.size === 0) return new Map();

  const pooled = await pool.acquire();
  try {
    log(`Strategy 1: downloading IRS 990 index (${IRS_990_INDEX_URL}) for ${neededEins.size} foundation(s) missing a website`);
    // The index is a CSV served as a file download (Content-Disposition:
    // attachment), which page.goto()-based fetchPage() can't render — use
    // fetchRaw() (context.request.get(), same cookies/headers) instead.
    const rendered = await throttledFetchRaw(pooled, IRS_990_INDEX_URL);
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

// IRS 990 e-file's WebsiteAddressTxt is free text a filer typed by hand, not
// a validated field — real, common values include placeholders ("N/A",
// "NONE", "-") and bare domains with no scheme ("example.org"). Passed
// straight through to page.goto() (StealthEngine.fetchPage), both of those
// throw "Cannot navigate to invalid URL" and burn a full 3-attempt retry
// budget (plus a Strategy-2 Google CAPTCHA check on the same row) for
// nothing — found live, 2026-08-15, during a full-scale run: dozens of
// consecutive rows in the first minute alone hit this exact failure.
const WEBSITE_PLACEHOLDER_RE = /^(n\/?a\.?|none|not\s*applicable|n\.?a\.?|-+|tbd|unknown)$/i;

function normalizeWebsiteCandidate(raw: string | undefined | null): string | undefined {
  if (!raw) return undefined;
  const trimmed = raw.trim();
  if (!trimmed || WEBSITE_PLACEHOLDER_RE.test(trimmed)) return undefined;
  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  try {
    const url = new URL(withScheme);
    if (url.protocol !== "http:" && url.protocol !== "https:") return undefined;
    if (!url.hostname.includes(".")) return undefined;
    return url.toString();
  } catch {
    return undefined;
  }
}

/**
 * Resolves a single foundation row against the EIN index and returns any
 * website/phone found in its matched 990 filing. Exported per
 * UNIVERSAL_SCRAPER_PRD.md §4 — the "IRS 990 index discovery" logic reused
 * unchanged as the foundation-990-template.ts custom discovery source.
 */
export async function tryIrs990(
  row: FoundationRow,
  einIndex: Map<string, EinIndexEntry>,
  pooled: PooledEngine,
  irs990Source: IRS990Source,
  batchZipCache: Map<string, Promise<unzipper.CentralDirectory | null>>,
): Promise<{ website?: string; phone?: string } | null> {
  const ein = String(row.ein ?? "").replace(/\D/g, "");
  const entry = ein ? einIndex.get(ein) : undefined;
  if (!entry) return null;

  let xml: string | null = null;
  let sourceLabel: string;

  if (entry.directUrl) {
    // Legacy path, kept in case the index CSV ever restores a `url` column.
    // Uses fetchRaw() (context.request.get()), not fetchPage() (page.goto()):
    // this is a raw XML file, and Chromium's page.goto() renders it through
    // its own built-in XML-viewer DOM instead of returning the literal bytes
    // — parseXml()'s regex-based tag extraction can never match that
    // rendered output no matter what the filing actually contains. This is
    // the same reason buildEinIndex() already used fetchRaw() for the index
    // CSV; tryIrs990() just never got the same fix until now.
    sourceLabel = entry.directUrl;
    xml = await throttledFetchRaw(pooled, entry.directUrl);
  } else if (entry.objectId && entry.batchZipUrl) {
    const entryFileName = `${entry.objectId}_public.xml`;
    sourceLabel = `${entry.batchZipUrl}#${entryFileName}`;
    const directory = await getOrFetchBatchZip(pooled, entry.batchZipUrl, batchZipCache);
    if (!directory) return null;
    const fileEntry = directory.files.find((f) => f.type === "File" && f.path === entryFileName);
    if (!fileEntry) return null;
    const buffer = await fileEntry.buffer();
    xml = buffer.toString("utf-8");
  } else {
    return null;
  }

  if (!xml) return null;

  const parsed = irs990Source.parseXml(ein, xml, sourceLabel);
  if (!parsed) return null;

  const update: { website?: string; phone?: string } = {};
  if (!row.website && parsed.website) {
    const normalized = normalizeWebsiteCandidate(parsed.website);
    if (normalized) update.website = normalized;
  }
  if (!row.phone && parsed.phones.length > 0) update.phone = parsed.phones[0] as string;
  return Object.keys(update).length > 0 ? update : null;
}

// --- Strategy 2: Google search fallback ---------------------------------------
//
// Circuit breaker: Google can serve a recaptcha_v2 challenge on every search
// query, and with no TWOCAPTCHA_API_KEY configured StealthEngine can't solve
// it (nor should it try to bypass it). Once that's happening, every further
// Strategy 2 call burns a full fetchPage() retry budget just to fail the
// same way. After GOOGLE_CAPTCHA_BREAKER_THRESHOLD consecutive CAPTCHA
// blocks, trip the breaker and skip Strategy 2 for the rest of the run —
// foundations without a website by then fall through past Strategy 3 too,
// since Strategy 3 only runs once a website is known.

const GOOGLE_CAPTCHA_BREAKER_THRESHOLD = 5;

interface GoogleBreakerState {
  consecutiveCaptchaBlocks: number;
  tripped: boolean;
}

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

async function tryGoogleFallback(
  row: FoundationRow,
  pooled: PooledEngine,
  breaker: GoogleBreakerState,
): Promise<string | null> {
  const location = [row.city, row.state].filter(Boolean).join(" ");
  const query = `"${row.name}" ${location} foundation site:*`;
  const searchUrl = `https://www.google.com/search?q=${encodeURIComponent(query)}&num=10`;

  const html = await throttledFetch(pooled, searchUrl);

  if (pooled.engine.wasCaptchaBlocked()) {
    breaker.consecutiveCaptchaBlocks++;
    if (!breaker.tripped && breaker.consecutiveCaptchaBlocks >= GOOGLE_CAPTCHA_BREAKER_THRESHOLD) {
      breaker.tripped = true;
      log(
        `WARN Strategy 2: ${GOOGLE_CAPTCHA_BREAKER_THRESHOLD} consecutive Google CAPTCHA blocks (recaptcha_v2, no TWOCAPTCHA_API_KEY configured) — ` +
          `disabling Strategy 2 for the remainder of this run`,
      );
    }
  } else {
    breaker.consecutiveCaptchaBlocks = 0;
  }

  if (!html) return null;

  for (const link of extractSearchResultLinks(html)) {
    if (isExcludedSearchHost(link)) continue;
    await throttleDomain(link);
    if (await validateUrl(link)) return link;
  }
  return null;
}

// --- Strategy 3: contact-page extraction --------------------------------------

async function tryContactPage(
  website: string,
  pooled: PooledEngine,
): Promise<{ emails: string[]; phone: string | null }> {
  await throttleDomain(website);
  const contactUrl = (await throttledFindContactPage(pooled, website)) ?? website;
  await throttleDomain(contactUrl);
  const html = await throttledFetch(pooled, contactUrl);
  if (!html) return { emails: [], phone: null };

  const emails = await pooled.engine.extractEmails(html);
  const phone = await pooled.engine.extractPhone(html);
  return { emails, phone };
}

// --- per-foundation waterfall --------------------------------------------------

export interface FoundationRow {
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
  einIndex: Map<string, EinIndexEntry>,
  pool: EnginePool,
  irs990Source: IRS990Source,
  supabase: ReturnType<typeof createAdminClient>,
  googleBreaker: GoogleBreakerState,
  batchZipCache: Map<string, Promise<unzipper.CentralDirectory | null>>,
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
        const found = await tryIrs990(row, einIndex, pooled, irs990Source, batchZipCache);
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

    if (!website && !googleBreaker.tripped) {
      try {
        const found = await tryGoogleFallback(row, pooled, googleBreaker);
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

    // AG-29 Knowledge Engine Indexer event trigger: this update doesn't
    // itself write `programs`/`enrichment.mission` (the fields the indexer
    // embeds), but a future enrichment pass on this same row might have -
    // enqueueing here is a cheap, safe no-op via the indexer's own
    // embedding-IS-NULL / real-content check whenever it doesn't. Best
    // effort - never blocks or fails the scrape itself.
    await enqueueKnowledgeIndexerTrigger(supabase, "foundation_directory", row.id).catch(
      (queueErr: unknown) => {
        log(
          `WARN [${row.id}] failed to enqueue knowledge indexer trigger: ${queueErr instanceof Error ? queueErr.message : String(queueErr)}`,
        );
      },
    );

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
  const googleBreaker: GoogleBreakerState = { consecutiveCaptchaBlocks: 0, tripped: false };

  log(`Starting foundation scraper at offset ${checkpoint.offset} (processed so far: ${checkpoint.processed}, enriched so far: ${checkpoint.enriched})`);

  try {
    const einIndex = await buildEinIndex(pool, supabase);
    const batchZipCache = new Map<string, Promise<unzipper.CentralDirectory | null>>();
    let offset = checkpoint.offset;

    for (;;) {
      // Name-heuristic exclusion, not an authoritative IRS classification —
      // foundation_directory has no field distinguishing "family foundation"
      // from other private foundations (foundation_type/organization_type/
      // subsection_code are raw IRS BMF codes with no such concept). See
      // AUDIT_FILTER_FEASIBILITY.md §2.
      const { data, error } = await supabase
        .from("foundation_directory")
        .select("id, ein, name, city, state, website, email, phone")
        .not("name", "ilike", "%FAMILY FOUNDATION%")
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
        rows.map((row) =>
          limit(() => processFoundation(row, einIndex, pool, irs990Source, supabase, googleBreaker, batchZipCache)),
        ),
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

/**
 * Enriches exactly one foundation_directory row, out-of-cycle from the
 * weekly full-directory sweep above — this is AG-42 Change Monitor's
 * chain target (queueChainedAgent('foundation-990-enrichment', ...),
 * src/lib/agents/change-monitor-agent.ts) when a real change is detected
 * for a foundation between two nightly checks. Reuses processFoundation()/
 * buildEinIndex() unchanged rather than re-implementing the waterfall for
 * a single row, matching this file's own established precedent (see file
 * header re: foundation-990-template.ts's reuse of buildEinIndex/tryIrs990).
 *
 * A single short-lived StealthEngine is spun up and torn down per call
 * rather than reusing runFoundationScraper()'s multi-engine pool, since
 * this always processes exactly one row, not a batch.
 */
export async function enrichSingleFoundation(
  foundationId: string,
): Promise<{ enriched: boolean; strategy: string } | null> {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("foundation_directory")
    .select("id, ein, name, city, state, website, email, phone")
    .eq("id", foundationId)
    .maybeSingle();

  if (error || !data) return null;
  const row = data as FoundationRow;

  const engine = new StealthEngine();
  await engine.init();
  const pool = new EnginePool([{ engine, lastRequestAt: 0 }]);
  const irs990Source = new IRS990Source();
  const googleBreaker: GoogleBreakerState = { consecutiveCaptchaBlocks: 0, tripped: false };
  const batchZipCache = new Map<string, Promise<unzipper.CentralDirectory | null>>();

  try {
    const einIndex = row.website ? new Map<string, EinIndexEntry>() : await buildEinIndex(pool, supabase);
    return await processFoundation(
      row,
      einIndex,
      pool,
      irs990Source,
      supabase,
      googleBreaker,
      batchZipCache,
    );
  } finally {
    await pool.closeAll();
  }
}
