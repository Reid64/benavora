// ============================================================================
// BENAVORA — IRS Business Master File (BMF) full ingest
//
// Downloads every state's IRS Exempt Organizations BMF extract
// (https://www.irs.gov/pub/irs-soi/eo_XX.csv for each state abbreviation,
// plus eo_other.csv for the territories/possessions bucket the IRS ships
// separately) and writes every active 501(c)(3) record into the Donor
// Discovery shared directory (donor_discovery_directory, migration 067,
// DONOR_DISCOVERY_ARCHITECTURE.md §3 "compounding moat").
//
// BMF files are headerless CSV, 28 columns, 0-indexed:
//   0  NAME               10 CLASSIFICATION     20 FILING_REQ_CD
//   1  ICO                11 RULING              21 PF_FILING_REQ_CD
//   2  EIN                12 DEDUCTIBILITY        22 ACCT_PD
//   3  (unused col 3)     13 FOUNDATION            23 ASSET_AMT
//   4  STREET             14 ACTIVITY               24 INCOME_AMT
//   5  CITY               15 ORGANIZATION             25 REVENUE_AMT
//   6  STATE              16 STATUS                     26 NTEE_CD
//   7  ZIP                17 TAX_PERIOD                   27 SORT_NAME
//   8  SUBSECTION         18 ASSET_CD
//   9  AFFILIATION        19 INCOME_CD
// Only NAME, EIN, STREET/CITY/STATE/ZIP, STATUS, and NTEE_CD are used below —
// the rest isn't needed for a directory seed row and can be pulled from a
// fresh BMF re-download later if a future enrichment pass wants it.
//
// Writes go through src/lib/donor-discovery/directory.ts's
// upsertDirectoryRecord() — the module's own header says every acquisition
// path should, "never raw inserts" — via the donor_discovery_upsert_
// directory_record RPC (migration 071). Worth noting explicitly: BMF gives
// no website and no lat/lng, so neither of that RPC's two dedup branches
// (exact domain match, fuzzy name+geo match) can ever fire for a row this
// script produces — every call bottoms out in the RPC's plain insert branch.
// Going through the RPC still costs nothing behaviorally different from a
// raw insert *for this dataset*, and keeps this script from becoming a
// second, divergent write path the day a later phase adds a new dedup
// branch. Concurrency (20 in-flight RPC calls per 1000-row chunk) is what
// keeps ~1.8M individual network round trips from turning this into a
// multi-day job.
//
// Resumable: writes ./enrichment-output/bmf-checkpoint.json after every
// 1000-row chunk (file index + line number within that file + running
// totals). Re-running picks up exactly where it left off instead of
// re-scanning completed files or re-inserting rows already written — with
// no plain EIN column on donor_discovery_directory to upsert against (EIN
// lives inside the enrichment jsonb blob), a crash-and-restart without this
// checkpoint would duplicate every row already committed before the crash.
// A file that fails all of its download retries halts the whole run rather
// than being silently skipped (FORGE governance: halt on unrecoverable
// error, don't guess) — the checkpoint already reflects the last
// successfully flushed chunk, so fixing the underlying problem and
// re-running resumes cleanly at the failed file.
//
//   pnpm ingest:bmf
// ============================================================================

import dotenv from "dotenv";
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { Readable } from "node:stream";

dotenv.config({ path: ".env.local" });

import { upsertDirectoryRecord, type DirectoryRecordInput } from "../src/lib/donor-discovery/directory";

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
// Config
// ----------------------------------------------------------------------------
const STATE_ABBRS = [
  "al", "ak", "az", "ar", "ca", "co", "ct", "de", "fl", "ga",
  "hi", "id", "il", "in", "ia", "ks", "ky", "la", "me", "md",
  "ma", "mi", "mn", "ms", "mo", "mt", "ne", "nv", "nh", "nj",
  "nm", "ny", "nc", "nd", "oh", "ok", "or", "pa", "ri", "sc",
  "sd", "tn", "tx", "ut", "vt", "va", "wa", "wv", "wi", "wy",
  "dc", "pr",
] as const;

const STATE_FILES: string[] = [...STATE_ABBRS, "other"];

const BMF_BASE_URL = "https://www.irs.gov/pub/irs-soi";
const CHUNK_SIZE = 1000;
const CONCURRENCY = 20;
const PROGRESS_INTERVAL = 10000;
const RETRY_DELAYS_MS = [5000, 15000, 45000];
const ACTIVE_STATUS = "O";
const BMF_COLUMN_COUNT = 28;

const OUTPUT_DIR = path.resolve("./enrichment-output");
const CHECKPOINT_FILE = path.join(OUTPUT_DIR, "bmf-checkpoint.json");

// ----------------------------------------------------------------------------
// Checkpoint
// ----------------------------------------------------------------------------
interface CheckpointTotals {
  scanned: number;
  inserted: number;
  skippedInactive: number;
  skippedInvalid: number;
  failed: number;
}

interface Checkpoint {
  fileIndex: number;
  rowIndex: number;
  totals: CheckpointTotals;
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
// CSV line parsing — quote-aware (BMF names/addresses can contain commas
// wrapped in double quotes, e.g. `"SMITH, JOHN FOUNDATION"`).
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

function buildHqAddress(street: string, city: string, state: string, zip: string): string | null {
  const cityStateZip = [city, [state, zip].filter(Boolean).join(" ")].filter(Boolean).join(", ");
  const parts = [street, cityStateZip].filter(Boolean);
  return parts.length ? parts.join(", ") : null;
}

function rowToDirectoryInput(cols: string[]): DirectoryRecordInput | null {
  const name = col(cols, 0);
  const ein = col(cols, 2);
  if (!name || !ein) return null;

  const street = col(cols, 4);
  const city = col(cols, 5);
  const state = col(cols, 6);
  const zip = col(cols, 7);
  const nteeCd = col(cols, 26);

  return {
    legal_name: name,
    website: null,
    hq_address: buildHqAddress(street, city, state, zip),
    naics_codes: [],
    civic_kind: "nonprofit_501c3",
    source_adapter: "irs_bmf",
    enrichment: { ein, ntee_cd: nteeCd || null },
  };
}

// ----------------------------------------------------------------------------
// Download with retry — exponential backoff, matches the Grants.gov
// integration contract's 5s/15s/45s pattern (BEHAVIORAL_CONTRACTS.md §17).
// ----------------------------------------------------------------------------
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchWithRetry(url: string): Promise<Response> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
    try {
      const res = await fetch(url);
      if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
      return res;
    } catch (error) {
      lastError = error;
      const delay = RETRY_DELAYS_MS[attempt];
      if (delay === undefined) break;
      fail(`fetch ${url} (attempt ${attempt + 1}/${RETRY_DELAYS_MS.length + 1})`, error);
      await sleep(delay);
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

// ----------------------------------------------------------------------------
// Concurrency-limited chunk flush
// ----------------------------------------------------------------------------
async function flushChunk(chunk: DirectoryRecordInput[], cp: Checkpoint): Promise<void> {
  if (chunk.length === 0) return;

  let next = 0;
  async function worker() {
    for (;;) {
      const i = next++;
      const record = chunk[i];
      if (record === undefined) return;
      try {
        await upsertDirectoryRecord(record);
        cp.totals.inserted++;
      } catch (error) {
        cp.totals.failed++;
        if (cp.totals.failed <= 20 || cp.totals.failed % 500 === 0) {
          fail(`upsert ${record.legal_name}`, error);
        }
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, chunk.length) }, () => worker()));
}

function logProgress(cp: Checkpoint) {
  console.log(
    `  … scanned ${cp.totals.scanned}, inserted ${cp.totals.inserted}, ` +
      `inactive-skipped ${cp.totals.skippedInactive}, invalid-skipped ${cp.totals.skippedInvalid}, ` +
      `failed ${cp.totals.failed}`,
  );
}

// ----------------------------------------------------------------------------
// Per-file streaming — line-by-line over the remote CSV, never buffered
// whole (some state files run into the hundreds of thousands of rows).
// ----------------------------------------------------------------------------
async function processFile(abbr: string, fileIndex: number, resumeRow: number, cp: Checkpoint): Promise<void> {
  const url = `${BMF_BASE_URL}/eo_${abbr}.csv`;
  console.log(`\n[${fileIndex + 1}/${STATE_FILES.length}] ${abbr} — ${url}`);
  if (resumeRow > 0) console.log(`  resuming from row ${resumeRow}`);

  const res = await fetchWithRetry(url);
  const rl = readline.createInterface({
    input: Readable.fromWeb(res.body as import("node:stream/web").ReadableStream),
    crlfDelay: Infinity,
  });

  let rowNum = 0;
  let chunk: DirectoryRecordInput[] = [];
  let fileScanned = 0;
  let fileInactive = 0;
  let fileInvalid = 0;

  for await (const line of rl) {
    rowNum++;
    if (rowNum <= resumeRow) continue;
    if (!line.trim()) continue;

    cp.totals.scanned++;
    fileScanned++;

    const cols = parseCsvLine(line);
    if (cols.length < BMF_COLUMN_COUNT) {
      cp.totals.skippedInvalid++;
      fileInvalid++;
      cp.rowIndex = rowNum;
      continue;
    }

    if (col(cols, 16).toUpperCase() !== ACTIVE_STATUS) {
      cp.totals.skippedInactive++;
      fileInactive++;
      cp.rowIndex = rowNum;
      continue;
    }

    const record = rowToDirectoryInput(cols);
    if (!record) {
      cp.totals.skippedInvalid++;
      fileInvalid++;
      cp.rowIndex = rowNum;
      continue;
    }

    chunk.push(record);
    cp.rowIndex = rowNum;

    if (chunk.length >= CHUNK_SIZE) {
      await flushChunk(chunk, cp);
      chunk = [];
      saveCheckpoint(cp);
    }

    if (cp.totals.scanned % PROGRESS_INTERVAL === 0) {
      logProgress(cp);
    }
  }

  await flushChunk(chunk, cp);
  saveCheckpoint(cp);

  ok(abbr, `scanned ${fileScanned}, inactive ${fileInactive}, invalid ${fileInvalid}`);
}

// ----------------------------------------------------------------------------
// Main
// ----------------------------------------------------------------------------
async function main() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) {
    fatal("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  }

  console.log("IRS BMF full ingest — donor_discovery_directory");
  console.log(`Files: ${STATE_FILES.length} (${STATE_FILES.join(", ")})`);

  const resumeFrom = loadCheckpoint();
  const cp: Checkpoint = resumeFrom ?? {
    fileIndex: 0,
    rowIndex: 0,
    totals: { scanned: 0, inserted: 0, skippedInactive: 0, skippedInvalid: 0, failed: 0 },
    startedAt: new Date().toISOString(),
  };
  if (resumeFrom) {
    console.log(
      `\nResuming from checkpoint: file ${cp.fileIndex + 1}/${STATE_FILES.length}, row ${cp.rowIndex}, ` +
        `${cp.totals.inserted} already inserted.`,
    );
  }

  for (let fi = cp.fileIndex; fi < STATE_FILES.length; fi++) {
    const abbr = STATE_FILES[fi];
    if (!abbr) continue;
    const resumeRow = fi === cp.fileIndex ? cp.rowIndex : 0;

    await processFile(abbr, fi, resumeRow, cp);

    cp.fileIndex = fi + 1;
    cp.rowIndex = 0;
    saveCheckpoint(cp);
  }

  console.log("\nDone.");
  console.log(`  Files processed:      ${STATE_FILES.length}`);
  console.log(`  Records scanned:      ${cp.totals.scanned}`);
  console.log(`  Records inserted:     ${cp.totals.inserted}`);
  console.log(`  Skipped (inactive):   ${cp.totals.skippedInactive}`);
  console.log(`  Skipped (invalid):    ${cp.totals.skippedInvalid}`);
  console.log(`  Failed upserts:       ${cp.totals.failed}`);
  console.log(`\n  Checkpoint: ${CHECKPOINT_FILE}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
