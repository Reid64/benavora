// Universal Scraper CLI (UNIVERSAL_SCRAPER_PRD.md §3.5).
//
// Wires the three already-built layers into the end-to-end pipeline the PRD
// describes: discovery (§3.1, src/lib/scraper-v2/discovery.ts) -> fetch
// (§3.2, src/lib/scraper-v2/universal-fetcher.ts) -> extract (§3.3,
// src/lib/scraper-v2/extractor.ts) -> write to scrape_jobs/scrape_results
// (§3.4, migration 110).
//
// Migration 110 is NOT CONFIRMED APPLIED to production this session (see
// that migration file's header — no working DDL credential was available).
// This script does not assume either way: it attempts a real insert against
// scrape_jobs first, and if that fails with an undefined-table error
// (Postgres 42P01 / PostgREST PGRST205 — the two error shapes a missing
// table produces through supabase-js), it falls back to writing the same
// row shape to a local JSON file under scrape-output/, loudly logging that
// this is a MOCK WRITE and why, rather than silently no-op'ing. Once 110 is
// applied, this script starts writing to the real tables with no code
// change required.
//
// Usage (per PRD §3.5):
//   pnpm scrape:universal --keyword "veteran housing nonprofits Texas" \
//     --schema '{"org_name":"string","website":"string","email":"string","phone":"string"}' \
//     --limit 100

import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import fs from "fs";
import path from "path";
import ws from "ws";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { discoverUrls, type DiscoveredUrl } from "../src/lib/scraper-v2/discovery";
import { UniversalFetcher } from "../src/lib/scraper-v2/universal-fetcher";
import { extractStructured, type ExtractionSchema } from "../src/lib/scraper-v2/extractor";

interface CliArgs {
  keyword: string;
  schema: ExtractionSchema;
  limit: number;
  targetDomain?: string;
}

function parseArgs(argv: string[]): CliArgs {
  const get = (flag: string): string | undefined => {
    const i = argv.indexOf(flag);
    return i >= 0 ? argv[i + 1] : undefined;
  };

  const keyword = get("--keyword");
  const schemaRaw = get("--schema");
  const limitRaw = get("--limit");
  const targetDomain = get("--target-domain");

  if (!keyword) {
    throw new Error('Missing required --keyword "<text>"');
  }
  if (!schemaRaw) {
    throw new Error('Missing required --schema \'{"field":"string",...}\'');
  }

  let schema: ExtractionSchema;
  try {
    schema = JSON.parse(schemaRaw);
  } catch (err) {
    throw new Error(`--schema is not valid JSON: ${err instanceof Error ? err.message : String(err)}`);
  }
  if (typeof schema !== "object" || schema === null || Array.isArray(schema) || Object.keys(schema).length === 0) {
    throw new Error("--schema must be a non-empty JSON object of field:type pairs");
  }

  const limit = limitRaw ? parseInt(limitRaw, 10) : 25;
  if (!Number.isFinite(limit) || limit <= 0) {
    throw new Error(`--limit must be a positive integer, got: ${limitRaw}`);
  }

  return { keyword, schema, limit, targetDomain };
}

function getSupabaseAdmin(): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRoleKey) {
    console.error("[run-universal-scraper] Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY -- cannot reach the database at all this run.");
    return null;
  }
  return createClient(url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
    // Node 20 has no native WebSocket global that realtime-js accepts as-is;
    // ws is otherwise a drop-in WebSocketLike implementation (see
    // scripts/enrich-foundations-990.ts for the same pattern).
    realtime: { transport: ws as unknown as typeof WebSocket },
  });
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

interface JobHandle {
  /** Real DB row id once scrape_jobs exists, or a locally-generated id when mocked. */
  id: string;
  /** False once scrape_jobs/scrape_results turn out to be genuinely reachable. */
  mocked: boolean;
}

async function createJob(supabase: SupabaseClient | null, keyword: string, targetDomain: string | undefined, schema: ExtractionSchema): Promise<JobHandle> {
  if (supabase) {
    const { data, error } = await supabase
      .from("scrape_jobs")
      .insert({ keyword, target_domain: targetDomain ?? null, output_schema: schema, status: "running" })
      .select("id")
      .single();

    if (!error && data) {
      console.log(`[run-universal-scraper] scrape_jobs row created (REAL DB WRITE): id=${data.id}`);
      return { id: data.id as string, mocked: false };
    }

    if (!isMissingTableError(error)) {
      throw new Error(`scrape_jobs insert failed with an unexpected error (not a missing-table condition): ${error?.message ?? "unknown error"} (code=${error?.code ?? "none"})`);
    }

    console.error(`[run-universal-scraper] *** MOCK WRITE *** scrape_jobs table not found in production (${error?.code ?? "no code"}: ${error?.message}). Migration 110 (supabase/migrations/110_scrape_jobs_universal_scraper.sql) has not been applied yet -- writing this job to a local JSON file instead of the database. This is NOT a silent no-op: see scrape-output/ for the mock record, and re-run this script once 110 is applied to get real DB writes with zero code changes.`);
  } else {
    console.error("[run-universal-scraper] *** MOCK WRITE *** no Supabase admin client available (missing env vars) -- writing this job to a local JSON file instead of the database.");
  }

  const mockId = `mock-job-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const filePath = writeMockJson(`${mockId}.job.json`, {
    id: mockId,
    keyword,
    target_domain: targetDomain ?? null,
    output_schema: schema,
    status: "running",
    urls_discovered: 0,
    urls_processed: 0,
    results_found: 0,
    created_at: new Date().toISOString(),
    completed_at: null,
    _mock: true,
    _mock_reason: "scrape_jobs table unreachable (migration 110 not applied or Supabase env vars missing)",
  });
  console.error(`[run-universal-scraper] mock job written to ${filePath}`);
  return { id: mockId, mocked: true };
}

async function writeResult(
  supabase: SupabaseClient | null,
  job: JobHandle,
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
      console.log(`[run-universal-scraper] scrape_results row created (REAL DB WRITE) for ${sourceUrl}`);
      return;
    }

    if (!isMissingTableError(error)) {
      throw new Error(`scrape_results insert failed with an unexpected error (not a missing-table condition): ${error.message} (code=${error.code ?? "none"})`);
    }

    console.error(`[run-universal-scraper] *** MOCK WRITE *** scrape_results table not found in production (${error.code ?? "no code"}: ${error.message}) -- falling back to local JSON for this result.`);
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
  console.error(`[run-universal-scraper] mock result written to ${filePath}`);
}

async function finalizeJob(supabase: SupabaseClient | null, job: JobHandle, counts: { urls_discovered: number; urls_processed: number; results_found: number }): Promise<void> {
  if (supabase && !job.mocked) {
    const { error } = await supabase
      .from("scrape_jobs")
      .update({ status: "completed", completed_at: new Date().toISOString(), ...counts })
      .eq("id", job.id);
    if (error) {
      console.error(`[run-universal-scraper] failed to finalize scrape_jobs row ${job.id}: ${error.message}`);
    } else {
      console.log(`[run-universal-scraper] scrape_jobs row ${job.id} marked completed (REAL DB WRITE): ${JSON.stringify(counts)}`);
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
  console.error(`[run-universal-scraper] mock job finalized at ${filePath}`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  console.log(`\n=== Universal Scraper ===`);
  console.log(`keyword:       ${args.keyword}`);
  console.log(`schema:        ${JSON.stringify(args.schema)}`);
  console.log(`limit:         ${args.limit}`);
  console.log(`target-domain: ${args.targetDomain ?? "(none -- open search)"}\n`);

  const supabase = getSupabaseAdmin();
  const job = await createJob(supabase, args.keyword, args.targetDomain, args.schema);

  const fetcher = new UniversalFetcher({ headless: true, maxRetries: 3 });
  await fetcher.init();

  let discovered: DiscoveredUrl[] = [];
  let processed = 0;
  let resultsFound = 0;

  try {
    console.log(`[1/3] DISCOVERY -- searching for candidate URLs...`);
    discovered = await discoverUrls(args.keyword, args.targetDomain, { fetcher, maxResults: args.limit });
    console.log(`  discovered ${discovered.length} candidate URL(s):`);
    for (const d of discovered) console.log(`    [${d.source}] ${d.url}`);

    if (discovered.length === 0) {
      console.error(`[run-universal-scraper] discovery returned zero URLs for "${args.keyword}" -- nothing to fetch/extract this run.`);
    }

    console.log(`\n[2/3 + 3/3] FETCH + EXTRACT -- per discovered URL...`);
    for (const { url } of discovered) {
      console.log(`\n  --- ${url} ---`);
      const fetchResult = await fetcher.fetchPage(url);
      processed++;

      if (!fetchResult.success || !fetchResult.html) {
        console.log(`    FETCH FAILED: ${fetchResult.fetchError}`);
        const nullData: Record<string, null> = {};
        for (const field of Object.keys(args.schema)) nullData[field] = null;
        await writeResult(supabase, job, url, nullData, "none", fetchResult.fetchError);
        continue;
      }
      console.log(`    fetched ${fetchResult.contentLength} chars of HTML (${fetchResult.attempts} attempt(s))`);

      const extracted = await extractStructured(fetchResult.html, args.keyword, args.schema, url);
      const nonNullCount = Object.values(extracted.data).filter((v) => v !== null).length;
      console.log(`    EXTRACTED: ${JSON.stringify(extracted.data)}`);
      console.log(`    (${nonNullCount}/${Object.keys(args.schema).length} fields found, readabilityFallback=${extracted.readabilityFallback}, tokens in/out=${extracted.usage.inputTokens}/${extracted.usage.outputTokens})`);

      if (nonNullCount > 0) resultsFound++;
      const confidence = nonNullCount === Object.keys(args.schema).length ? "high" : nonNullCount > 0 ? "medium" : "low";
      await writeResult(supabase, job, url, extracted.data, confidence, null);
    }

    const counts = { urls_discovered: discovered.length, urls_processed: processed, results_found: resultsFound };
    await finalizeJob(supabase, job, counts);

    console.log(`\n=== SUMMARY ===`);
    console.log(`job id:          ${job.id}${job.mocked ? " (MOCK -- scrape_jobs unreachable, see scrape-output/)" : " (real DB row)"}`);
    console.log(`urls discovered: ${discovered.length}`);
    console.log(`urls processed:  ${processed}`);
    console.log(`results found:   ${resultsFound} (at least one non-null field)`);
  } finally {
    await fetcher.close();
  }
}

main().catch((err) => {
  console.error("\nUNIVERSAL SCRAPER RUN FAILED");
  console.error(err?.stack || err);
  process.exit(1);
});
