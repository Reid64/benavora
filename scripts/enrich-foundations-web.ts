// @ts-nocheck
// ============================================================================
// BENAVORA — foundation_directory web enrichment
//
// Fills in foundation_directory.enrichment (jsonb) from each foundation's own
// website: discovers a website when one is missing
// (src/lib/enrichment/website-discovery.ts, SearXNG-backed), then extracts a
// structured "foundation" record from the site with Claude
// (src/lib/enrichment/web-extractor.ts). Complements
// scripts/enrich-foundations-990.ts, which sources the same jsonb column from
// IRS 990 filings.
//
// Requires migration 072 (enrichment jsonb, enriched_web_at,
// website_discovered_via on foundation_directory).
//
// Selects rows with enriched_web_at IS NULL, ordered by asset_amount desc
// (nulls last) so the largest foundations get enriched first, with optional
// --ntee <code> and --limit <n> (default 500) filters. Runs up to 8 rows
// concurrently via a small in-process semaphore (no new dependency).
//
// Resumable: because the row selection itself excludes anything already
// marked enriched_web_at, re-running after a crash naturally skips completed
// rows without any extra bookkeeping. This script additionally persists
// ./enrichment-output/web-checkpoint.json with running lifetime counters
// (including an approximate Claude-call count) after every batch, and appends
// each successful extraction to ./enrichment-output/web-extract.csv.
//
//   pnpm enrich:web
//   pnpm enrich:web -- --ntee B --limit 200
// ============================================================================

import { createClient } from "@supabase/supabase-js";
import fs from "node:fs";
import path from "node:path";
import dotenv from "dotenv";
import ws from "ws";
import { discoverWebsite } from "../src/lib/enrichment/website-discovery";
import { extractFromWebsite } from "../src/lib/enrichment/web-extractor";

dotenv.config({ path: ".env.local" });

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !serviceRoleKey) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

const admin = createClient(url, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
  realtime: { transport: ws as unknown as typeof WebSocket },
});

function ok(step: string, detail: string) {
  console.log(`  ✓ ${step}: ${detail}`);
}

function fail(step: string, error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`  ✗ ${step}: ${message}`);
}

function fatal(message: string): never {
  console.error(`\nFATAL: ${message}`);
  process.exit(1);
}

// ----------------------------------------------------------------------------
// CLI args
// ----------------------------------------------------------------------------
function parseArgs(argv: string[]): { ntee: string | null; limit: number } {
  let ntee: string | null = null;
  let limit = 500;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--ntee" && argv[i + 1]) {
      ntee = argv[++i];
    } else if (argv[i] === "--limit" && argv[i + 1]) {
      const n = Number(argv[++i]);
      if (Number.isFinite(n) && n > 0) limit = n;
    }
  }
  return { ntee, limit };
}

const { ntee: NTEE_FILTER, limit: LIMIT } = parseArgs(process.argv.slice(2));

const CONCURRENCY = 8;
const OUTPUT_DIR = path.resolve("./enrichment-output");
const CHECKPOINT_FILE = path.join(OUTPUT_DIR, "web-checkpoint.json");
const CSV_FILE = path.join(OUTPUT_DIR, "web-extract.csv");
const CSV_HEADER =
  "ein,name,website_url,website_discovered_via,discovery_confidence,giving_focus_areas,application_url,accepts_unsolicited,contact_email,contact_phone,geographic_focus,claude_calls,processed_at\n";
const PROGRESS_BATCH_SIZE = 20;

// ----------------------------------------------------------------------------
// Checkpoint — lifetime counters. Correctness of "resume" comes from the
// enriched_web_at IS NULL filter in loadCandidates(), not from this file; this
// just preserves running totals across separate invocations.
// ----------------------------------------------------------------------------
interface Checkpoint {
  scanned: number;
  discovered: number;
  extracted: number;
  failed: number;
  claudeCalls: number;
  startedAt: string;
}

function loadCheckpoint(): Checkpoint | null {
  if (!fs.existsSync(CHECKPOINT_FILE)) return null;
  try {
    return JSON.parse(fs.readFileSync(CHECKPOINT_FILE, "utf-8")) as Checkpoint;
  } catch (error) {
    fail("read checkpoint", error);
    return null;
  }
}

function saveCheckpoint(cp: Checkpoint) {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  fs.writeFileSync(CHECKPOINT_FILE, JSON.stringify(cp, null, 2));
}

// ----------------------------------------------------------------------------
// CSV extract output
// ----------------------------------------------------------------------------
function csvEscape(value: string | number | undefined | null): string {
  if (value === undefined || value === null) return "";
  const str = String(value);
  return /[",\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
}

function appendCsvRows(rows: string[][]) {
  if (rows.length === 0) return;
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  if (!fs.existsSync(CSV_FILE)) fs.writeFileSync(CSV_FILE, CSV_HEADER);
  const body = rows.map((fields) => fields.map(csvEscape).join(",")).join("\n") + "\n";
  fs.appendFileSync(CSV_FILE, body);
}

// ----------------------------------------------------------------------------
// Simple counting semaphore — caps concurrency at CONCURRENCY without a
// dependency on p-limit or similar.
// ----------------------------------------------------------------------------
class Semaphore {
  private available: number;
  private readonly queue: Array<() => void> = [];

  constructor(concurrency: number) {
    this.available = concurrency;
  }

  async acquire(): Promise<() => void> {
    if (this.available > 0) {
      this.available--;
      return () => this.release();
    }
    await new Promise<void>((resolve) => this.queue.push(resolve));
    this.available--;
    return () => this.release();
  }

  private release() {
    this.available++;
    const next = this.queue.shift();
    if (next) next();
  }
}

// ----------------------------------------------------------------------------
// Row selection
// ----------------------------------------------------------------------------
interface CandidateRow {
  id: string;
  ein: string;
  name: string;
  city: string | null;
  state: string | null;
  website: string | null;
  enrichment: Record<string, unknown> | null;
}

async function loadCandidates(): Promise<CandidateRow[]> {
  let q = admin
    .from("foundation_directory")
    .select("id, ein, name, city, state, website, enrichment")
    .is("enriched_web_at", null);

  if (NTEE_FILTER) {
    q = q.ilike("ntee_code", `${NTEE_FILTER}%`);
  }

  const { data, error } = await q
    .order("asset_amount", { ascending: false, nullsFirst: false })
    .limit(LIMIT);

  if (error) fatal(`could not load candidate rows: ${error.message}`);
  return (data ?? []) as CandidateRow[];
}

// ----------------------------------------------------------------------------
// Enrichment jsonb merge — a fresh non-empty value always wins; a fresh
// null/empty value only fills a gap, it never clobbers existing data.
// ----------------------------------------------------------------------------
function mergeEnrichment(
  existing: Record<string, unknown> | null,
  fresh: Record<string, unknown>,
): Record<string, unknown> {
  const merged: Record<string, unknown> = { ...(existing ?? {}) };
  for (const [key, value] of Object.entries(fresh)) {
    const isEmpty = value === null || value === undefined || (Array.isArray(value) && value.length === 0);
    if (isEmpty && merged[key] !== undefined && merged[key] !== null) continue;
    merged[key] = value;
  }
  return merged;
}

// ----------------------------------------------------------------------------
// Per-row enrichment
// ----------------------------------------------------------------------------
interface RowOutcome {
  ok: boolean;
  discovered: boolean;
  claudeCalls: number;
  csvRow?: string[];
}

async function processRow(row: CandidateRow): Promise<RowOutcome> {
  let websiteUrl = row.website;
  let discoveredVia: string | undefined;
  let discoveryConfidence: number | undefined;
  const discovered = !websiteUrl;

  if (!websiteUrl) {
    const discovery = await discoverWebsite(row.name, row.city, row.state);
    if (!discovery) {
      return { ok: false, discovered: false, claudeCalls: 0 };
    }
    websiteUrl = discovery.url;
    discoveredVia = "web_search";
    discoveryConfidence = discovery.confidence;
  }

  // extractFromWebsite makes at most one Claude call per invocation; count it
  // as attempted here since there's no finer-grained hook into the call.
  const extraction = await extractFromWebsite(websiteUrl, "foundation");
  const claudeCalls = 1;

  if (!extraction.ok || !extraction.data) {
    fail(`extract ${row.ein}`, extraction.error ?? "no data");
    return { ok: false, discovered, claudeCalls };
  }

  const nowIso = new Date().toISOString();
  const fresh: Record<string, unknown> = {
    ...extraction.data,
    extracted_at: nowIso,
  };
  if (discoveryConfidence !== undefined) {
    fresh.website_discovery_confidence = discoveryConfidence;
  }

  const enrichment = mergeEnrichment(row.enrichment, fresh);

  const updateRow: Record<string, unknown> = {
    enrichment,
    enriched_web_at: nowIso,
  };
  if (discovered) {
    updateRow.website = websiteUrl;
    updateRow.website_discovered_via = discoveredVia;
  }

  const { error } = await admin.from("foundation_directory").update(updateRow).eq("id", row.id);
  if (error) {
    fail(`update ${row.ein}`, error);
    return { ok: false, discovered, claudeCalls };
  }

  return {
    ok: true,
    discovered,
    claudeCalls,
    csvRow: [
      row.ein,
      row.name,
      websiteUrl,
      discoveredVia ?? "",
      discoveryConfidence !== undefined ? discoveryConfidence.toFixed(2) : "",
      extraction.data.giving_focus_areas.join("; "),
      extraction.data.application_url ?? "",
      extraction.data.accepts_unsolicited === null ? "" : String(extraction.data.accepts_unsolicited),
      extraction.data.contact_email ?? "",
      extraction.data.contact_phone ?? "",
      extraction.data.geographic_focus ?? "",
      String(claudeCalls),
      nowIso,
    ],
  };
}

// ----------------------------------------------------------------------------
// Main
// ----------------------------------------------------------------------------
async function main() {
  console.log("Enriching foundation_directory from foundation websites");
  if (NTEE_FILTER) console.log(`NTEE filter: ${NTEE_FILTER}`);
  console.log(`Limit: ${LIMIT}, concurrency: ${CONCURRENCY}\n`);

  const candidates = await loadCandidates();
  ok("load candidates", `${candidates.length} row(s) with no web enrichment yet`);

  const resumeFrom = loadCheckpoint();
  const cp: Checkpoint = resumeFrom ?? {
    scanned: 0,
    discovered: 0,
    extracted: 0,
    failed: 0,
    claudeCalls: 0,
    startedAt: new Date().toISOString(),
  };
  if (resumeFrom) {
    console.log(
      `Resuming lifetime counters: ${resumeFrom.extracted} extracted, ${resumeFrom.failed} failed so far.\n`,
    );
  }

  const semaphore = new Semaphore(CONCURRENCY);
  let csvBuffer: string[][] = [];
  let completed = 0;

  async function runOne(row: CandidateRow) {
    const release = await semaphore.acquire();
    try {
      const outcome = await processRow(row);
      cp.scanned++;
      cp.claudeCalls += outcome.claudeCalls;
      if (outcome.discovered) cp.discovered++;
      if (outcome.ok && outcome.csvRow) {
        cp.extracted++;
        csvBuffer.push(outcome.csvRow);
      } else {
        cp.failed++;
      }
    } finally {
      completed++;
      if (completed % PROGRESS_BATCH_SIZE === 0 || completed === candidates.length) {
        appendCsvRows(csvBuffer);
        csvBuffer = [];
        saveCheckpoint(cp);
        console.log(
          `  … ${completed}/${candidates.length} processed — extracted ${cp.extracted}, discovered ${cp.discovered}, failed ${cp.failed}, Claude calls ${cp.claudeCalls}`,
        );
      }
      release();
    }
  }

  await Promise.all(candidates.map((row) => runOne(row)));

  console.log("\nDone.");
  console.log(`  Rows scanned:        ${cp.scanned}`);
  console.log(`  Websites discovered: ${cp.discovered}`);
  console.log(`  Extractions saved:   ${cp.extracted}`);
  console.log(`  Failed:              ${cp.failed}`);
  console.log(`  Claude calls:        ${cp.claudeCalls}`);
  console.log(`\n  Raw extract: ${CSV_FILE}`);
  console.log(`  Checkpoint:  ${CHECKPOINT_FILE}`);
}

main();
