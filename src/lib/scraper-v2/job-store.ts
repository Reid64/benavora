// Shared scrape_jobs/scrape_results persistence (UNIVERSAL_SCRAPER_PRD.md
// §3.4) for the pre-configured job templates in ./templates/*.
//
// Generalized out of scripts/run-universal-scraper.ts's createJob/
// writeResult/finalizeJob functions — same behavior, not rebuilt: a real
// insert is always attempted first, and only on the two error shapes a
// genuinely-missing table produces (Postgres 42P01 / PostgREST PGRST205 —
// migration 110 is NOT CONFIRMED APPLIED to production, see that migration's
// header) does this fall back to a local JSON file under scrape-output/,
// loudly logging that this is a MOCK WRITE and why. Any other error is a
// real failure and is thrown, never silently downgraded.
//
// Both foundation-990-template.ts and nonprofit-contact-template.ts import
// this instead of duplicating the pattern a third time.

import fs from "fs";
import path from "path";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ExtractionSchema } from "./extractor";

export interface ScrapeJobHandle {
  /** Real DB row id once scrape_jobs exists, or a locally-generated id when mocked. */
  id: string;
  /** False once scrape_jobs/scrape_results turn out to be genuinely reachable. */
  mocked: boolean;
}

/** True only for the two error shapes a genuinely-missing table produces via supabase-js/PostgREST -- Postgres 42P01 (undefined_table) or PostgREST's own PGRST205 ("Could not find the table"). Any other error is a real failure and must not be silently downgraded to a mock write. */
function isMissingTableError(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  if (error.code === "42P01" || error.code === "PGRST205") return true;
  return typeof error.message === "string" && /could not find the table|relation .* does not exist/i.test(error.message);
}

const MOCK_OUTPUT_DIR = path.join(process.cwd(), "scrape-output");

function writeMockJson(filename: string, data: unknown): string {
  fs.mkdirSync(MOCK_OUTPUT_DIR, { recursive: true });
  const filePath = path.join(MOCK_OUTPUT_DIR, filename);
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf-8");
  return filePath;
}

export interface CreateScrapeJobParams {
  keyword: string;
  targetDomain?: string;
  outputSchema: ExtractionSchema;
}

export async function createScrapeJob(
  supabase: SupabaseClient | null,
  params: CreateScrapeJobParams,
): Promise<ScrapeJobHandle> {
  const { keyword, targetDomain, outputSchema } = params;

  if (supabase) {
    const { data, error } = await supabase
      .from("scrape_jobs")
      .insert({ keyword, target_domain: targetDomain ?? null, output_schema: outputSchema, status: "running" })
      .select("id")
      .single();

    if (!error && data) {
      console.log(`[job-store] scrape_jobs row created (REAL DB WRITE): id=${data.id}`);
      return { id: data.id as string, mocked: false };
    }

    if (!isMissingTableError(error)) {
      throw new Error(`scrape_jobs insert failed with an unexpected error (not a missing-table condition): ${error?.message ?? "unknown error"} (code=${error?.code ?? "none"})`);
    }

    console.error(`[job-store] *** MOCK WRITE *** scrape_jobs table not found in production (${error?.code ?? "no code"}: ${error?.message}). Migration 110 (supabase/migrations/110_scrape_jobs_universal_scraper.sql) has not been applied yet -- writing this job to a local JSON file instead of the database. This is NOT a silent no-op: see scrape-output/ for the mock record, and re-run this template once 110 is applied to get real DB writes with zero code changes.`);
  } else {
    console.error("[job-store] *** MOCK WRITE *** no Supabase admin client available -- writing this job to a local JSON file instead of the database.");
  }

  const mockId = `mock-job-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const filePath = writeMockJson(`${mockId}.job.json`, {
    id: mockId,
    keyword,
    target_domain: targetDomain ?? null,
    output_schema: outputSchema,
    status: "running",
    urls_discovered: 0,
    urls_processed: 0,
    results_found: 0,
    created_at: new Date().toISOString(),
    completed_at: null,
    _mock: true,
    _mock_reason: "scrape_jobs table unreachable (migration 110 not applied or Supabase env vars missing)",
  });
  console.error(`[job-store] mock job written to ${filePath}`);
  return { id: mockId, mocked: true };
}

export async function writeScrapeResult(
  supabase: SupabaseClient | null,
  job: ScrapeJobHandle,
  sourceUrl: string,
  extractedData: Record<string, unknown>,
  confidence: string,
  fetchError: string | null,
): Promise<void> {
  if (supabase && !job.mocked) {
    const { error } = await supabase.from("scrape_results").insert({
      job_id: job.id,
      source_url: sourceUrl,
      extracted_data: extractedData,
      confidence,
      fetch_error: fetchError,
    });

    if (!error) {
      console.log(`[job-store] scrape_results row created (REAL DB WRITE) for ${sourceUrl}`);
      return;
    }

    if (!isMissingTableError(error)) {
      throw new Error(`scrape_results insert failed with an unexpected error (not a missing-table condition): ${error.message} (code=${error.code ?? "none"})`);
    }

    console.error(`[job-store] *** MOCK WRITE *** scrape_results table not found in production (${error.code ?? "no code"}: ${error.message}) -- falling back to local JSON for this result.`);
  }

  const mockId = `${job.id}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const filePath = writeMockJson(`${mockId}.result.json`, {
    id: mockId,
    job_id: job.id,
    source_url: sourceUrl,
    extracted_data: extractedData,
    confidence,
    fetched_at: new Date().toISOString(),
    fetch_error: fetchError,
    _mock: true,
    _mock_reason: "scrape_results table unreachable (migration 110 not applied or Supabase env vars missing)",
  });
  console.error(`[job-store] mock result written to ${filePath}`);
}

export interface FinalizeScrapeJobCounts {
  urls_discovered: number;
  urls_processed: number;
  results_found: number;
}

export async function finalizeScrapeJob(
  supabase: SupabaseClient | null,
  job: ScrapeJobHandle,
  counts: FinalizeScrapeJobCounts,
): Promise<void> {
  if (supabase && !job.mocked) {
    const { error } = await supabase
      .from("scrape_jobs")
      .update({ status: "completed", completed_at: new Date().toISOString(), ...counts })
      .eq("id", job.id);
    if (error) {
      console.error(`[job-store] failed to finalize scrape_jobs row ${job.id}: ${error.message}`);
    } else {
      console.log(`[job-store] scrape_jobs row ${job.id} marked completed (REAL DB WRITE): ${JSON.stringify(counts)}`);
    }
    return;
  }

  const filePath = writeMockJson(`${job.id}.job.json`, {
    id: job.id,
    status: "completed",
    completed_at: new Date().toISOString(),
    ...counts,
    _mock: true,
  });
  console.error(`[job-store] mock job finalized at ${filePath}`);
}
