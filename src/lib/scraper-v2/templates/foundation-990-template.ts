// IRS 990 foundation enrichment — pre-configured universal-scraper-v2 job
// template (UNIVERSAL_SCRAPER_PRD.md §4).
//
// "IRS 990 index discovery ... becomes one template": the custom discovery
// source here is buildEinIndex()/tryIrs990() imported unchanged from
// src/lib/scraper/foundation-scraper.ts — the exact batch-ZIP EIN->filing
// lookup fixed tonight (commit 52dd3ce: raw fetchRaw/fetchRawBuffer against
// apps.irs.gov's batch ZIP archives, not the dead S3 fallback or a
// browser-rendered XML viewer). This is real, proven engineering; per the
// PRD this is re-hosted, not rebuilt.
//
// Deliberate deviation from routing extraction through extractStructured()
// (extractor.ts, the Claude/Readability-based generality mechanism the rest
// of the universal pipeline uses): 990 e-file XML is already rigidly
// structured with known tag names (WebsiteAddressTxt, PhoneNum), and
// IRS990Source.parseXml() (src/lib/enrichment/sources/irs990.ts) extracts
// those fields deterministically. Readability/JSDOM is built to find an
// "article" in HTML-shaped content; run against raw government XML it finds
// no article, falls back to raw body.textContent, and strips every tag name
// in the process -- leaving Claude a soup of untagged values with no way to
// know which number is a phone and which is a EIN or ZIP. That would be
// **strictly worse** than the proven parser, directly contradicting this
// task's explicit success criterion ("equivalent or better results ...
// verified against a real batch"). So: discovery is re-hosted from
// foundation-scraper.ts (as instructed), and extraction stays on the
// existing deterministic parseXml() (already invoked inside tryIrs990()) --
// only the *job/result bookkeeping* moves to the new generic
// scrape_jobs/scrape_results model (job-store.ts), which is what actually
// makes this "on top of the universal-scraper-v2 pipeline": a schema-scoped
// job/result row per foundation, same as every other template, rather than
// a bespoke checkpoint file.
//
// Real production writes: in addition to scrape_jobs/scrape_results, this
// also writes straight to `foundation_directory` (COALESCE-style, only when
// the existing column is null -- identical write behavior to
// runFoundationScraper()) so a real batch run is directly verifiable against
// the actual target table, not just the generic job-store shadow copy.

import unzipper from "unzipper";

import { createAdminClient } from "@/lib/supabase/admin";
import { StealthEngine } from "@/lib/scraper/stealth-engine";
import { IRS990Source } from "@/lib/enrichment/sources/irs990";
import {
  EnginePool,
  buildEinIndex,
  tryIrs990,
  type EinIndexEntry,
  type FoundationRow,
} from "@/lib/scraper/foundation-scraper";
import { createScrapeJob, writeScrapeResult, finalizeScrapeJob } from "../job-store";
import type { ExtractionSchema } from "../extractor";

const OUTPUT_SCHEMA: ExtractionSchema = { website: "string", phone: "string" };

function log(message: string): void {
  console.log(`[${new Date().toISOString()}] [foundation-990-template] ${message}`);
}

function resolveSourceUrl(ein: string | null, einIndex: Map<string, EinIndexEntry>): string {
  const normalizedEin = String(ein ?? "").replace(/\D/g, "");
  const entry = normalizedEin ? einIndex.get(normalizedEin) : undefined;
  if (entry?.directUrl) return entry.directUrl;
  if (entry?.batchZipUrl && entry.objectId) return `${entry.batchZipUrl}#${entry.objectId}_public.xml`;
  return `irs990:ein:${normalizedEin || "unknown"}`;
}

export interface Foundation990TemplateResult {
  jobId: string;
  mocked: boolean;
  candidateCount: number;
  einIndexMatched: number;
  processed: number;
  enriched: number;
}

/**
 * Runs the IRS 990 foundation-enrichment template against up to `limit`
 * foundation_directory rows currently missing a website. Returns run totals
 * for verification; the caller (CLI script) is expected to re-query
 * foundation_directory directly afterward per this task's success criterion
 * rather than trusting these totals alone.
 */
export async function runFoundation990Template(limit = 25): Promise<Foundation990TemplateResult> {
  const supabase = createAdminClient();

  const job = await createScrapeJob(supabase, {
    keyword: "IRS 990 foundation enrichment (website + phone from e-file XML, batch-ZIP index lookup)",
    targetDomain: "apps.irs.gov",
    outputSchema: OUTPUT_SCHEMA,
  });

  const engine = new StealthEngine();
  await engine.init();
  const pool = new EnginePool([{ engine, lastRequestAt: 0 }]);
  const irs990Source = new IRS990Source();
  const batchZipCache = new Map<string, Promise<unzipper.CentralDirectory | null>>();

  let processed = 0;
  let enriched = 0;
  let candidateCount = 0;
  let einIndex = new Map<string, EinIndexEntry>();

  try {
    einIndex = await buildEinIndex(pool, supabase);
    log(`EIN index matched ${einIndex.size} filing(s) for foundations currently missing a website`);

    const { data, error } = await supabase
      .from("foundation_directory")
      .select("id, ein, name, city, state, website, email, phone")
      .is("website", null)
      .not("name", "ilike", "%FAMILY FOUNDATION%")
      .order("id", { ascending: true })
      .limit(limit);

    if (error) {
      throw new Error(`foundation_directory query failed: ${error.message}`);
    }

    const rows = (data ?? []) as FoundationRow[];
    candidateCount = rows.length;
    log(`Processing ${rows.length} candidate foundation(s) (limit=${limit})`);

    for (const row of rows) {
      processed++;
      const sourceUrl = resolveSourceUrl(row.ein, einIndex);

      const pooled = await pool.acquire();
      let found: { website?: string; phone?: string } | null = null;
      let stepError: string | null = null;
      try {
        found = await tryIrs990(row, einIndex, pooled, irs990Source, batchZipCache);
      } catch (err) {
        stepError = err instanceof Error ? err.message : String(err);
        log(`WARN [${row.id}] tryIrs990 failed: ${stepError}`);
      } finally {
        pool.release(pooled);
      }

      const extractedData: Record<string, string | null> = {
        website: found?.website ?? null,
        phone: found?.phone ?? null,
      };
      const nonNullCount = Object.values(extractedData).filter((v) => v !== null).length;
      const confidence = nonNullCount === 2 ? "high" : nonNullCount > 0 ? "medium" : "low";

      await writeScrapeResult(
        supabase,
        job,
        sourceUrl,
        extractedData,
        confidence,
        stepError ?? (found ? null : "no matching IRS 990 filing found for this EIN"),
      );

      if (found && (found.website || found.phone)) {
        const update: Record<string, unknown> = { enriched_web_at: new Date().toISOString() };
        if (found.website && !row.website) {
          update["website"] = found.website;
          update["website_discovered_via"] = "irs_990_xml";
        }
        if (found.phone && !row.phone) update["phone"] = found.phone;

        const { error: updateError } = await supabase.from("foundation_directory").update(update).eq("id", row.id);
        if (updateError) {
          log(`WARN [${row.id}] failed to write foundation_directory enrichment: ${updateError.message}`);
        } else {
          enriched++;
        }
      }
    }
  } finally {
    await pool.closeAll();
  }

  await finalizeScrapeJob(supabase, job, {
    urls_discovered: einIndex.size,
    urls_processed: processed,
    results_found: enriched,
  });

  log(`Done. candidates=${candidateCount} einIndexMatched=${einIndex.size} processed=${processed} enriched=${enriched}`);

  return {
    jobId: job.id,
    mocked: job.mocked,
    candidateCount,
    einIndexMatched: einIndex.size,
    processed,
    enriched,
  };
}
