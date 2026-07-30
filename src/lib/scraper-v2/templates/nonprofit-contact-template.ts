// Nonprofit contact extraction — pre-configured universal-scraper-v2 job
// template (UNIVERSAL_SCRAPER_PRD.md §4).
//
// Unlike the foundation-990 template, this one is a direct, unmodified use
// of all three universal-scraper-v2 layers exactly as designed:
//   1. discoverUrls() (discovery.ts, §3.1) — sitemap fast path, then rotating
//      search, then bounded same-domain crawl, scoped to each nonprofit's
//      own website via `targetDomain`.
//   2. UniversalFetcher.fetchPage() (universal-fetcher.ts, §3.2) — the same
//      stealth fetch layer, shared across all candidate URLs for one
//      nonprofit so the SessionPool/cookie state carries over between the
//      homepage and a discovered contact page.
//   3. extractStructured() (extractor.ts, §3.3) — Claude/Readability-based
//      schema extraction. This genuinely fits: nonprofit "contact us" pages
//      are free-form HTML with no reliable tag convention (unlike 990 XML),
//      exactly the brittle-regex failure mode the PRD's §1/§2 built this
//      layer to replace. The old sibling (src/lib/scraper/nonprofit-scraper.ts)
//      used a fixed EMAIL_REGEX/PHONE_REGEX pair via StealthEngine.extractEmails/
//      extractPhone; this template replaces that with the schema-flexible
//      extractor, which is the actual upgrade the PRD is describing for this
//      target type.
//
// Same target population as the old scraper (see nonprofit-scraper.ts's
// header for the AUDIT_FILTER_FEASIBILITY.md reasoning behind the $750k
// revenue cutoff and the contact_emails/officer_email/phone COALESCE write
// convention): nonprofits WHERE website IS NOT NULL AND contact_emails IS
// NULL AND revenue_amount >= 750000.
//
// Real production writes: in addition to scrape_jobs/scrape_results, this
// writes straight to `nonprofits` (COALESCE-style, only when the existing
// column is still null) so a real batch run is directly verifiable against
// the actual target table.

import { createAdminClient } from "@/lib/supabase/admin";
import { discoverUrls } from "../discovery";
import { UniversalFetcher } from "../universal-fetcher";
import { extractStructured } from "../extractor";
import { createScrapeJob, writeScrapeResult, finalizeScrapeJob } from "../job-store";
import type { ExtractionSchema } from "../extractor";

const OUTPUT_SCHEMA: ExtractionSchema = { email: "string", phone: "string", contact_name: "string" };
const MAX_CANDIDATE_URLS_PER_NONPROFIT = 3;
const MIN_REVENUE_FOR_CANDIDACY = 750_000;

function log(message: string): void {
  console.log(`[${new Date().toISOString()}] [nonprofit-contact-template] ${message}`);
}

interface NonprofitRow {
  id: string;
  ein: string | null;
  name: string;
  website: string;
  contact_emails: string | null;
  officer_email: string | null;
  phone: string | null;
}

export interface NonprofitContactTemplateResult {
  jobId: string;
  mocked: boolean;
  candidateCount: number;
  processed: number;
  urlsDiscovered: number;
  updated: number;
}

/**
 * Runs the nonprofit contact-extraction template against up to `limit`
 * nonprofits rows currently missing contact_emails. Returns run totals for
 * verification; the caller (CLI script) is expected to re-query `nonprofits`
 * directly afterward per this task's success criterion rather than trusting
 * these totals alone.
 */
export async function runNonprofitContactTemplate(limit = 25): Promise<NonprofitContactTemplateResult> {
  const supabase = createAdminClient();

  const job = await createScrapeJob(supabase, {
    keyword: "nonprofit contact information (email + phone)",
    outputSchema: OUTPUT_SCHEMA,
  });

  // No .order("id") here: found live 2026-07-30 that ordering this filtered
  // query by id against the 1.97M-row nonprofits table times out in
  // production (statement timeout) -- the planner walks the id index
  // filtering row-by-row instead of using the filters directly. Dropping the
  // order clause lets Postgres pick an efficient plan for the same 25 rows
  // (verified <1s vs. timeout). limit() alone is sufficient; determinism
  // across repeated runs isn't required here.
  const { data, error } = await supabase
    .from("nonprofits")
    .select("id, ein, name, website, contact_emails, officer_email, phone")
    .not("website", "is", null)
    .is("contact_emails", null)
    .gte("revenue_amount", MIN_REVENUE_FOR_CANDIDACY)
    .limit(limit);

  if (error) {
    throw new Error(`nonprofits query failed: ${error.message}`);
  }

  const rows = (data ?? []) as NonprofitRow[];
  log(`Processing ${rows.length} candidate nonprofit(s) (limit=${limit})`);

  const fetcher = new UniversalFetcher({ headless: true, maxRetries: 2 });
  await fetcher.init();

  let processed = 0;
  let updated = 0;
  let urlsDiscovered = 0;

  try {
    for (const row of rows) {
      processed++;
      log(`[${row.id}] ${row.name} -- ${row.website}`);

      let discovered = await discoverUrls(`${row.name} contact information phone email`, row.website, {
        fetcher,
        maxResults: MAX_CANDIDATE_URLS_PER_NONPROFIT,
      });
      // discoverUrls() can legitimately return zero candidates for a site
      // with no sitemap, no indexable search presence, and a crawl that
      // never resolves (e.g. the homepage itself is down this run) -- fall
      // back to the known homepage URL directly rather than skipping the
      // nonprofit outright, since that URL is real and already on file.
      if (discovered.length === 0) discovered = [{ url: row.website, source: "crawl" }];
      urlsDiscovered += discovered.length;

      let bestEmail: string | null = null;
      let bestPhone: string | null = null;
      let bestContactName: string | null = null;

      for (const { url } of discovered) {
        const fetchResult = await fetcher.fetchPage(url);

        if (!fetchResult.success || !fetchResult.html) {
          const nullData: Record<string, null> = { email: null, phone: null, contact_name: null };
          await writeScrapeResult(supabase, job, url, nullData, "none", fetchResult.fetchError);
          continue;
        }

        const extracted = await extractStructured(fetchResult.html, `${row.name} contact information`, OUTPUT_SCHEMA, url);
        const nonNullCount = Object.values(extracted.data).filter((v) => v !== null).length;
        const confidence = nonNullCount === Object.keys(OUTPUT_SCHEMA).length ? "high" : nonNullCount > 0 ? "medium" : "low";
        await writeScrapeResult(supabase, job, url, extracted.data, confidence, null);

        if (!bestEmail && typeof extracted.data.email === "string") bestEmail = extracted.data.email;
        if (!bestPhone && typeof extracted.data.phone === "string") bestPhone = extracted.data.phone;
        if (!bestContactName && typeof extracted.data.contact_name === "string") bestContactName = extracted.data.contact_name;

        if (bestEmail && bestPhone) break;
      }

      const update: Record<string, string> = {};
      if (row.contact_emails === null && bestEmail) update["contact_emails"] = bestEmail;
      if (row.officer_email === null && bestEmail) update["officer_email"] = bestEmail;
      if (row.phone === null && bestPhone) update["phone"] = bestPhone;
      void bestContactName; // captured in scrape_results.extracted_data; nonprofits has no dedicated contact-name column to COALESCE into

      if (Object.keys(update).length > 0) {
        const { error: updateError } = await supabase.from("nonprofits").update(update).eq("id", row.id);
        if (updateError) {
          log(`WARN [${row.id}] failed to write nonprofits update: ${updateError.message}`);
        } else {
          updated++;
        }
      }
    }
  } finally {
    await fetcher.close();
  }

  await finalizeScrapeJob(supabase, job, {
    urls_discovered: urlsDiscovered,
    urls_processed: processed,
    results_found: updated,
  });

  log(`Done. candidates=${rows.length} processed=${processed} urlsDiscovered=${urlsDiscovered} updated=${updated}`);

  return {
    jobId: job.id,
    mocked: job.mocked,
    candidateCount: rows.length,
    processed,
    urlsDiscovered,
    updated,
  };
}
