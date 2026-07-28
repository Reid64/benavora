// Nonprofit contact-enrichment agent — StealthEngine-based sibling to
// scripts/scrape-website-contacts.ts (CheerioCrawler, plain HTTP, no browser)
// and scripts/enrich-website-contacts.ts (Claude-powered extraction). Both
// existing scripts give up on any nonprofit site that requires JS execution
// or blocks non-browser requests; this agent routes every request through
// StealthEngine (real Chromium, stealth plugin, CAPTCHA solving, human
// behavior simulation) for that harder-to-reach subset, using the same
// waterfall shape as src/lib/scraper/foundation-scraper.ts (homepage fetch
// -> contact-page discovery -> extraction) against the `nonprofits` table
// instead of `foundation_directory`.
//
// Population: nonprofits WHERE website IS NOT NULL AND contact_emails IS
// NULL AND revenue_amount >= 750000 (6,066 rows before the revenue filter,
// 363 as of 2026-07-27 with it — see AUDIT_FILTER_FEASIBILITY.md for the
// feasibility numbers behind the $750k cutoff). Deviation from the task's literal
// "email IS NULL" / "SET email=...": nonprofits has no `email` column
// (supabase/migrations/098_nonprofits_bmf.sql + 099_nonprofits_enrichment.sql,
// confirmed against SCHEMA_REGISTRY_v2.md) — the real contact columns are
// `contact_emails` (text, comma-joined dedup set) and `officer_email` (text,
// first email found), the same convention scripts/scrape-website-contacts.ts
// already uses since a generic scrape can't distinguish a general inbox from
// an executive's personal address either. Both are written here, alongside
// `phone`, all COALESCE-style (only written when the existing column is
// still NULL, so this never clobbers tier-1/tier-2 enrichment from the other
// scripts against the same table).
//
// Also deviates from the task's requested donor_discovery_prospects
// write-back: that table (migration 067) has no ein/email/phone columns —
// its real columns are id, organization_id, directory_id, request_id, score,
// score_rationale, pipeline_stage, notes, assigned_to, created_at. The only
// table it FKs to, donor_discovery_directory (migration 071/068), has no ein
// or email column either — it's corporate prospects keyed by name/NAICS, not
// nonprofit EINs. There is no ein-keyed row anywhere but `nonprofits` itself
// to write to — the same conclusion src/lib/scraper/foundation-scraper.ts
// already documents for its own analogous ask against foundation_directory.
//
// Keyset-cursor pagination (order by id, cursor = last id seen), not an
// offset or a disk checkpoint file: nonprofits is a 1.8M-row table and the
// candidate filter shrinks as rows get enriched mid-run, so an OFFSET would
// skip or repeat rows as matches drop out from under it. The cursor always
// advances regardless of whether a given row was enriched, so a killed run
// just re-scans from the top on restart (idempotent, COALESCE writes)
// instead of depending on a stored checkpoint — the same idiom
// scripts/scrape-website-contacts.ts already uses against this same table.

import { createAdminClient } from "@/lib/supabase/admin";
import { StealthEngine } from "@/lib/scraper/stealth-engine";

const BATCH_SIZE = 10;
const CONCURRENCY = 2;
const MIN_REQUEST_DELAY_MS = 500;
const LOG_EVERY_BATCHES = 10;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function log(message: string): void {
  console.log(`[${new Date().toISOString()}] ${message}`);
}

interface NonprofitRow {
  id: string;
  ein: string | null;
  website: string;
  contact_emails: string | null;
  officer_email: string | null;
  phone: string | null;
}

// --- engine pool: N persistent StealthEngine instances = N browser contexts ----
// (identical shape to foundation-scraper.ts's EnginePool; not shared between
// the two files since it isn't exported there and is small enough to not be
// worth extracting for two call sites.)

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

/** Enforces the 500ms-minimum-per-context gap before any network call on `pooled`. */
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

interface ScrapeResult {
  emails: string[];
  phone: string | null;
}

/**
 * Steps 1-3 of the task's waterfall: load the homepage, discover the
 * contact/about page, then extract from whichever HTML was actually found
 * (falling back to the homepage when no distinct contact page turns up, or
 * when re-fetching it fails).
 */
async function scrapeContact(website: string, pooled: PooledEngine): Promise<ScrapeResult> {
  const homepageHtml = await throttledFetch(pooled, website);
  if (!homepageHtml) return { emails: [], phone: null };

  const contactUrl = (await throttledFindContactPage(pooled, website)) ?? website;
  const contactHtml =
    contactUrl === website ? homepageHtml : (await throttledFetch(pooled, contactUrl)) ?? homepageHtml;

  const emails = await pooled.engine.extractEmails(contactHtml);
  const phone = await pooled.engine.extractPhone(contactHtml);
  return { emails, phone };
}

interface RunStats {
  processed: number;
  updated: number;
  emailsFound: number;
  phonesFound: number;
  failed: number;
}

/** Step 4: write whatever was found back to nonprofits, COALESCE-style. */
async function processNonprofit(
  row: NonprofitRow,
  pool: EnginePool,
  supabase: ReturnType<typeof createAdminClient>,
  stats: RunStats,
): Promise<void> {
  stats.processed++;
  const pooled = await pool.acquire();

  try {
    const { emails, phone } = await scrapeContact(row.website, pooled);

    const update: Record<string, string> = {};
    if (row.contact_emails === null && emails.length > 0) {
      update["contact_emails"] = emails.join(",");
    }
    if (row.officer_email === null && emails.length > 0) {
      update["officer_email"] = emails[0] as string;
    }
    if (row.phone === null && phone) {
      update["phone"] = phone;
    }

    if (Object.keys(update).length === 0) return;

    const { error } = await supabase.from("nonprofits").update(update).eq("id", row.id);
    if (error) {
      stats.failed++;
      log(`WARN [${row.id}] failed to write nonprofits update: ${error.message}`);
      return;
    }

    stats.updated++;
    if (update["contact_emails"]) stats.emailsFound++;
    if (update["phone"]) stats.phonesFound++;
  } catch (err) {
    stats.failed++;
    log(`WARN [${row.id}] unrecoverable scrape error: ${(err as Error).message}`);
  } finally {
    pool.release(pooled);
  }
}

/**
 * Runs the nonprofit contact scraper to exhaustion against the current
 * candidate pool (nonprofits WHERE website IS NOT NULL AND contact_emails IS
 * NULL). Returns run totals; see the header comment for why this has no
 * startOffset/resume parameters (unlike runFoundationScraper()) — the
 * keyset-cursor + COALESCE-write combination makes any run safely
 * restartable from scratch without one.
 */
export async function runNonprofitScraper(): Promise<RunStats> {
  const supabase = createAdminClient();

  const engines: PooledEngine[] = [];
  for (let i = 0; i < CONCURRENCY; i++) {
    const engine = new StealthEngine();
    await engine.init();
    engines.push({ engine, lastRequestAt: 0 });
  }
  const pool = new EnginePool(engines);

  const stats: RunStats = { processed: 0, updated: 0, emailsFound: 0, phonesFound: 0, failed: 0 };
  let cursor: string | null = null;
  let batchNum = 0;

  log("Nonprofit contact scraper (StealthEngine) starting");
  log("Population: nonprofits WHERE website IS NOT NULL AND contact_emails IS NULL AND revenue_amount >= 750000");

  try {
    for (;;) {
      batchNum++;

      let query = supabase
        .from("nonprofits")
        .select("id, ein, website, contact_emails, officer_email, phone")
        .not("website", "is", null)
        .is("contact_emails", null)
        .gte("revenue_amount", 750000)
        .order("id", { ascending: true })
        .limit(BATCH_SIZE);

      if (cursor) {
        query = query.gt("id", cursor);
      }

      const { data, error } = await query;
      if (error) {
        log(`FATAL: batch query failed — ${error.message}`);
        break;
      }

      const rows = (data ?? []) as NonprofitRow[];
      if (rows.length === 0) {
        log("All candidates exhausted.");
        break;
      }

      cursor = rows[rows.length - 1]!.id;

      await Promise.all(rows.map((row) => processNonprofit(row, pool, supabase, stats)));

      if (batchNum % LOG_EVERY_BATCHES === 0) {
        log(
          `Batch ${batchNum}: processed=${stats.processed} updated=${stats.updated} ` +
            `emailsFound=${stats.emailsFound} phonesFound=${stats.phonesFound} failed=${stats.failed}`,
        );
      }
    }
  } finally {
    await pool.closeAll();
  }

  log(
    `Done. processed=${stats.processed} updated=${stats.updated} emailsFound=${stats.emailsFound} ` +
      `phonesFound=${stats.phonesFound} failed=${stats.failed}`,
  );

  return stats;
}
