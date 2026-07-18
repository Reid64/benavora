// ============================================================================
// BENAVORA — IRS Business Master File (BMF) nonprofit import
//
// Downloads every state's IRS Exempt Organizations BMF extract
// (https://www.irs.gov/pub/irs-soi/eo_XX.csv for each state abbreviation
// plus DC) and upserts every record into the dedicated `nonprofits` table
// (migration 098) — a prospecting database separate from foundation_directory
// per STANDING_DIRECTIVES.md Directive 2, Phase A.
//
// Column layout verified live against a downloaded eo_dc.csv (2026-07-17):
// these files ship WITH a header row, not headerless as originally assumed —
// row 1 is always skipped. Real 28-column layout:
//   0 EIN            8  SUBSECTION       16 STATUS          24 INCOME_AMT
//   1 NAME            9  AFFILIATION      17 TAX_PERIOD       25 REVENUE_AMT
//   2 ICO            10 CLASSIFICATION   18 ASSET_CD         26 NTEE_CD
//   3 STREET          11 RULING           19 INCOME_CD         27 SORT_NAME
//   4 CITY            12 DEDUCTIBILITY    20 FILING_REQ_CD
//   5 STATE           13 FOUNDATION       21 PF_FILING_REQ_CD
//   6 ZIP             14 ACTIVITY         22 ACCT_PD
//   7 GROUP           15 ORGANIZATION     23 ASSET_AMT
// Only EIN, NAME, CITY, STATE, ZIP, SUBSECTION, FOUNDATION, STATUS, RULING,
// ASSET_AMT, INCOME_AMT, REVENUE_AMT, and NTEE_CD are used below.
//
// Upserts by EIN (unique constraint on nonprofits.ein), 500 rows per batch.
// Rows with an empty or non-numeric EIN are skipped. Status is stored as-is
// from the BMF STATUS code — this table is a raw prospecting mirror, not a
// filtered "currently active" view.
//
//   pnpm ingest:nonprofits
// ============================================================================

import dotenv from "dotenv";
import readline from "node:readline";
import { Readable } from "node:stream";

dotenv.config({ path: ".env.local" });

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import ws from "ws";

const STATES = [
  "AL", "AK", "AZ", "AR", "CA", "CO", "CT", "DE", "FL", "GA",
  "HI", "ID", "IL", "IN", "IA", "KS", "KY", "LA", "ME", "MD",
  "MA", "MI", "MN", "MS", "MO", "MT", "NE", "NV", "NH", "NJ",
  "NM", "NY", "NC", "ND", "OH", "OK", "OR", "PA", "RI", "SC",
  "SD", "TN", "TX", "UT", "VT", "VA", "WA", "WV", "WI", "WY",
  "DC",
] as const;

const BMF_BASE_URL = "https://www.irs.gov/pub/irs-soi";
const BATCH_SIZE = 500;
const PROGRESS_INTERVAL = 10000;

interface NonprofitRecord {
  ein: string;
  name: string;
  city: string | null;
  state: string | null;
  zip: string | null;
  ntee_code: string | null;
  subsection_code: string | null;
  foundation_type: string | null;
  ruling_date: string | null;
  revenue_amount: number | null;
  asset_amount: number | null;
  income_amount: number | null;
  status: string | null;
}

function ok(step: string, detail: string) {
  console.log(`  ✓ ${step}: ${detail}`);
}

function fail(step: string, error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`  ✗ ${step}: ${message}`);
}

// ----------------------------------------------------------------------------
// CSV line parsing — quote-aware (BMF names/addresses can contain commas
// wrapped in double quotes).
// ----------------------------------------------------------------------------
function parseCsvLine(line: string): string[] {
  const fields: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQuotes) {
      if (c === '"') {
        if (line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        current += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ",") {
      fields.push(current);
      current = "";
    } else {
      current += c;
    }
  }
  fields.push(current);
  return fields;
}

function col(cols: string[], i: number): string {
  return (cols[i] ?? "").trim();
}

function numOrNull(value: string): number | null {
  if (!value) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function rowToNonprofit(cols: string[]): NonprofitRecord | null {
  const ein = col(cols, 0);
  const name = col(cols, 1);
  if (!ein || !/^\d+$/.test(ein) || !name) return null;

  return {
    ein,
    name,
    city: col(cols, 4) || null,
    state: col(cols, 5) || null,
    zip: col(cols, 6) || null,
    subsection_code: col(cols, 8) || null,
    foundation_type: col(cols, 13) || null,
    status: col(cols, 16) || null,
    ruling_date: col(cols, 11) || null,
    asset_amount: numOrNull(col(cols, 23)),
    income_amount: numOrNull(col(cols, 24)),
    revenue_amount: numOrNull(col(cols, 25)),
    ntee_code: col(cols, 26) || null,
  };
}

// ----------------------------------------------------------------------------
// Batch upsert
// ----------------------------------------------------------------------------
async function upsertBatch(
  supabase: SupabaseClient,
  batch: NonprofitRecord[],
): Promise<{ inserted: number; failed: number }> {
  if (batch.length === 0) return { inserted: 0, failed: 0 };

  const { error } = await supabase.from("nonprofits").upsert(batch, { onConflict: "ein" });
  if (error) {
    fail("batch upsert", error);
    return { inserted: 0, failed: batch.length };
  }
  return { inserted: batch.length, failed: 0 };
}

// ----------------------------------------------------------------------------
// Per-state streaming
// ----------------------------------------------------------------------------
async function processState(
  supabase: SupabaseClient,
  state: string,
  totals: { scanned: number; inserted: number; skipped: number; failed: number },
): Promise<void> {
  const url = `${BMF_BASE_URL}/eo_${state.toLowerCase()}.csv`;
  console.log(`\n[${state}] ${url}`);

  const res = await fetch(url);
  if (!res.ok || !res.body) {
    fail(state, `HTTP ${res.status}`);
    return;
  }

  const rl = readline.createInterface({
    input: Readable.fromWeb(res.body as import("node:stream/web").ReadableStream),
    crlfDelay: Infinity,
  });

  let batch: NonprofitRecord[] = [];
  let stateScanned = 0;
  let stateInserted = 0;
  let stateSkipped = 0;
  let rowNum = 0;

  for await (const line of rl) {
    rowNum++;
    if (rowNum === 1) continue; // header row: EIN,NAME,ICO,STREET,CITY,STATE,ZIP,...
    if (!line.trim()) continue;

    totals.scanned++;
    stateScanned++;

    const cols = parseCsvLine(line);
    const record = rowToNonprofit(cols);
    if (!record) {
      totals.skipped++;
      stateSkipped++;
      continue;
    }

    batch.push(record);

    if (batch.length >= BATCH_SIZE) {
      const result = await upsertBatch(supabase, batch);
      totals.inserted += result.inserted;
      totals.failed += result.failed;
      stateInserted += result.inserted;
      batch = [];
    }

    if (totals.scanned % PROGRESS_INTERVAL === 0) {
      console.log(
        `  … scanned ${totals.scanned}, inserted ${totals.inserted}, skipped ${totals.skipped}, failed ${totals.failed}`,
      );
    }
  }

  const result = await upsertBatch(supabase, batch);
  totals.inserted += result.inserted;
  totals.failed += result.failed;
  stateInserted += result.inserted;

  ok(state, `scanned ${stateScanned}, inserted ${stateInserted}, skipped ${stateSkipped}`);
}

// ----------------------------------------------------------------------------
// Main
// ----------------------------------------------------------------------------
function fatal(message: string): never {
  console.error(`\nFATAL: ${message}`);
  process.exit(1);
}

async function main() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) {
    fatal("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    // ws's WebSocket type isn't structurally identical to realtime-js's
    // WebSocketLikeConstructor (event handler signatures differ); runtime
    // behavior is unaffected. Same pattern as scripts/batch-score-opportunities.ts.
    realtime: { transport: ws as any },
  });

  console.log("IRS BMF nonprofit import — nonprofits table");
  console.log(`States: ${STATES.length} (${STATES.join(", ")})`);

  const totals = { scanned: 0, inserted: 0, skipped: 0, failed: 0 };

  for (const state of STATES) {
    await processState(supabase, state, totals);
  }

  console.log("\nDone.");
  console.log(`  States processed:  ${STATES.length}`);
  console.log(`  Records scanned:   ${totals.scanned}`);
  console.log(`  Records inserted:  ${totals.inserted}`);
  console.log(`  Records skipped:   ${totals.skipped}`);
  console.log(`  Failed upserts:    ${totals.failed}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
