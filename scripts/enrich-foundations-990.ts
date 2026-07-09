// @ts-nocheck
// ============================================================================
// BENAVORA — foundation_directory IRS 990 batch enrichment
//
// Streams the current year's IRS 990 e-file index, matches filers to
// foundation_directory by EIN, downloads and parses each match's 990 XML
// (reusing src/lib/enrichment/sources/irs990.ts — the same class the
// EnrichmentEngine uses for the interactive enrichment job), and fills in:
//   total_assets      -> foundation_directory.asset_amount
//   total_giving       -> foundation_directory.giving_total
//   phone               -> foundation_directory.phone
//   website_url          -> foundation_directory.website (+ website_discovered_via)
//   city/state/zip        -> foundation_directory.city/state/zip
//   grant_count, typical grant range (where Schedule I exists), fiscal_year,
//     street address, source filing -> foundation_directory.enrichment (jsonb)
//
// Requires migration 072 (enrichment jsonb, enriched_990_at, enriched_web_at,
// website_discovered_via on foundation_directory).
//
// Resumable: writes ./enrichment-output/990-checkpoint.json after every
// 500-record batch (rowIndex into the index stream + running counters); a
// re-run picks up from there instead of re-fetching XML already processed.
// Every checkpoint batch also appends the raw extracted rows to
// ./enrichment-output/990-extract.csv, so a full copy of what was pulled from
// the IRS exists outside the database too.
//
// The IRS publishes the e-file index as a per-year CSV/JSON of
// (EIN, DLN, ObjectId, FormType, URL, OrganizationName) rows — the same shape
// src/lib/enrichment/sources/irs990.ts already assumes for its local index
// lookup (see IRS990Source.enrichFromIndex). If the IRS has moved the file
// since this was written, override IRS_990_INDEX_URL rather than hand-editing
// the default template below.
//
//   pnpm enrich:990
// ============================================================================

import { createClient } from "@supabase/supabase-js";
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { Readable } from "node:stream";
import dotenv from "dotenv";
import ws from "ws";
import { IRS990Source } from "../src/lib/enrichment/sources/irs990";

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

const irs990 = new IRS990Source();

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
const YEAR = process.env.IRS_990_YEAR ? Number(process.env.IRS_990_YEAR) : new Date().getFullYear();
const INDEX_URL =
  process.env.IRS_990_INDEX_URL ?? `https://apps.irs.gov/pub/epostcard/990/xml/${YEAR}/index_${YEAR}.csv`;
const FORCE_REENRICH = process.env.IRS_990_FORCE === "1";

const OUTPUT_DIR = path.resolve("./enrichment-output");
const CHECKPOINT_FILE = path.join(OUTPUT_DIR, "990-checkpoint.json");
const CSV_FILE = path.join(OUTPUT_DIR, "990-extract.csv");
const CSV_HEADER =
  "ein,name,total_assets,total_giving,grant_count,grant_range_min,grant_range_max,phone,website_url,fiscal_year,street,city,state,zip,object_id,xml_url,processed_at\n";

const BATCH_SIZE = 500;
const PROGRESS_LOG_INTERVAL = 1000;

// ----------------------------------------------------------------------------
// Checkpoint
// ----------------------------------------------------------------------------
interface Checkpoint {
  rowIndex: number;
  scanned: number;
  matched: number;
  upserted: number;
  websiteGained: number;
  failed: number;
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
// Index streaming — line-by-line over the remote CSV, never buffered whole.
// ----------------------------------------------------------------------------
interface IndexRow {
  ein: string;
  objectId: string;
  xmlUrl: string;
  orgName: string;
}

async function* streamIndexRows(indexUrl: string): AsyncGenerator<IndexRow> {
  const res = await fetch(indexUrl);
  if (!res.ok || !res.body) {
    fatal(`could not download IRS 990 index from ${indexUrl}: HTTP ${res.status}`);
  }

  const rl = readline.createInterface({
    input: Readable.fromWeb(res.body as import("node:stream/web").ReadableStream),
    crlfDelay: Infinity,
  });

  let headers: string[] | null = null;
  for await (const line of rl) {
    if (!line.trim()) continue;
    const cols = line.split(",");

    if (!headers) {
      headers = cols.map((h) => h.trim().replace(/^"|"$/g, "").toLowerCase());
      continue;
    }

    const einIdx = headers.indexOf("ein");
    if (einIdx < 0) continue;
    const ein = (cols[einIdx] ?? "").replace(/\D/g, "");
    if (!ein) continue;

    const urlIdx = headers.indexOf("url");
    const objectIdIdx = headers.indexOf("objectid");
    const nameIdx = headers.indexOf("organizationname");

    const objectId = objectIdIdx >= 0 ? (cols[objectIdIdx] ?? "").trim().replace(/^"|"$/g, "") : "";
    let xmlUrl = urlIdx >= 0 ? (cols[urlIdx] ?? "").trim().replace(/^"|"$/g, "") : "";
    if (!xmlUrl && objectId) {
      xmlUrl = `https://s3.amazonaws.com/irs-form-990/${objectId}_public.xml`;
    }
    if (!xmlUrl) continue;

    const orgName = nameIdx >= 0 ? (cols[nameIdx] ?? "").trim().replace(/^"|"$/g, "") : "";
    yield { ein, objectId, xmlUrl, orgName };
  }
}

// ----------------------------------------------------------------------------
// foundation_directory EIN lookup — loaded once, kept in memory as a Set/Map.
// ----------------------------------------------------------------------------
interface FoundationRow {
  id: string;
  hasWebsite: boolean;
  alreadyEnriched: boolean;
}

async function loadFoundationDirectory(): Promise<Map<string, FoundationRow>> {
  const map = new Map<string, FoundationRow>();
  const PAGE = 1000;
  let from = 0;
  for (;;) {
    const { data, error } = await admin
      .from("foundation_directory")
      .select("id, ein, website, enriched_990_at")
      .range(from, from + PAGE - 1);
    if (error) fatal(`could not load foundation_directory: ${error.message}`);
    if (!data || data.length === 0) break;

    for (const row of data) {
      const ein = String(row.ein ?? "").replace(/\D/g, "");
      if (!ein) continue;
      map.set(ein, {
        id: row.id as string,
        hasWebsite: !!row.website,
        alreadyEnriched: !!row.enriched_990_at,
      });
    }

    if (data.length < PAGE) break;
    from += PAGE;
  }
  return map;
}

// ----------------------------------------------------------------------------
// Batch upsert — flushed every BATCH_SIZE matched+parsed records.
// ----------------------------------------------------------------------------
interface UpsertRow {
  ein: string;
  asset_amount?: number;
  giving_total?: number;
  phone?: string;
  website?: string;
  website_discovered_via?: string;
  city?: string;
  state?: string;
  zip?: string;
  enrichment: Record<string, unknown>;
  enriched_990_at: string;
}

async function flushBatch(batch: UpsertRow[]) {
  if (batch.length === 0) return;
  const { error } = await admin.from("foundation_directory").upsert(batch, { onConflict: "ein" });
  if (error) {
    fail("upsert batch", error);
    fatal(
      "upsert failed midway through a batch — foundation_directory may be partially updated for this batch. " +
        "Fix the error and re-run; the checkpoint will resume near where this batch started.",
    );
  }
}

// ----------------------------------------------------------------------------
// Main
// ----------------------------------------------------------------------------
async function main() {
  console.log(`Enriching foundation_directory from IRS 990 index (year ${YEAR})`);
  console.log(`Index source: ${INDEX_URL}\n`);

  const foundationMap = await loadFoundationDirectory();
  ok("load foundation_directory", `${foundationMap.size} EIN(s) known`);

  const resumeFrom = loadCheckpoint();
  const cp: Checkpoint = resumeFrom ?? {
    rowIndex: 0,
    scanned: 0,
    matched: 0,
    upserted: 0,
    websiteGained: 0,
    failed: 0,
    startedAt: new Date().toISOString(),
  };
  if (resumeFrom) {
    console.log(`Resuming from checkpoint: row ${resumeFrom.rowIndex}, ${resumeFrom.upserted} already upserted.\n`);
  }

  let batch: UpsertRow[] = [];
  let csvRows: string[][] = [];
  let rowIndex = 0;

  for await (const row of streamIndexRows(INDEX_URL)) {
    rowIndex++;

    // Fast-forward past rows already handled by a prior run.
    if (rowIndex <= cp.rowIndex) continue;

    cp.scanned++;

    const foundation = foundationMap.get(row.ein);
    if (!foundation) {
      cp.rowIndex = rowIndex;
      continue;
    }
    if (foundation.alreadyEnriched && !FORCE_REENRICH) {
      cp.rowIndex = rowIndex;
      continue;
    }

    cp.matched++;

    const remote = await irs990.enrichFromRemoteXml(row.ein, row.xmlUrl);
    cp.rowIndex = rowIndex;

    if (!remote) {
      cp.failed++;
      continue;
    }

    const { result, meta } = remote;
    const nowIso = new Date().toISOString();
    const gainedWebsite = !foundation.hasWebsite && !!result.website;

    const enrichment: Record<string, unknown> = {
      fiscal_year: meta.fiscalYear ?? null,
      grant_count: meta.grantCount ?? null,
      typical_grant_range:
        meta.grantRangeMin !== undefined && meta.grantRangeMax !== undefined
          ? { min: meta.grantRangeMin, max: meta.grantRangeMax }
          : null,
      street_address: result.address?.street || null,
      source_object_id: row.objectId || null,
      source_xml_url: row.xmlUrl,
      extracted_at: nowIso,
    };

    const upsertRow: UpsertRow = {
      ein: row.ein,
      enrichment,
      enriched_990_at: nowIso,
    };
    if (result.assets !== undefined) upsertRow.asset_amount = result.assets;
    if (result.giving !== undefined) upsertRow.giving_total = result.giving;
    if (result.phones.length > 0) upsertRow.phone = result.phones[0];
    if (result.website) {
      upsertRow.website = result.website;
      upsertRow.website_discovered_via = "irs_990_xml";
    }
    if (result.address?.city) upsertRow.city = result.address.city;
    if (result.address?.state) upsertRow.state = result.address.state;
    if (result.address?.zip) upsertRow.zip = result.address.zip;

    batch.push(upsertRow);
    csvRows.push([
      row.ein,
      row.orgName,
      result.assets ?? "",
      result.giving ?? "",
      meta.grantCount ?? "",
      meta.grantRangeMin ?? "",
      meta.grantRangeMax ?? "",
      result.phones[0] ?? "",
      result.website ?? "",
      meta.fiscalYear ?? "",
      result.address?.street ?? "",
      result.address?.city ?? "",
      result.address?.state ?? "",
      result.address?.zip ?? "",
      row.objectId,
      row.xmlUrl,
      nowIso,
    ]);

    if (gainedWebsite) cp.websiteGained++;
    foundation.hasWebsite = foundation.hasWebsite || !!result.website;
    foundation.alreadyEnriched = true;

    if (batch.length >= BATCH_SIZE) {
      await flushBatch(batch);
      cp.upserted += batch.length;
      appendCsvRows(csvRows);
      saveCheckpoint(cp);
      batch = [];
      csvRows = [];
    }

    if (cp.scanned % PROGRESS_LOG_INTERVAL === 0) {
      console.log(
        `  … scanned ${cp.scanned} index rows, matched ${cp.matched}, upserted ${cp.upserted}, ` +
          `website gained ${cp.websiteGained}, failed ${cp.failed} (row ${rowIndex})`,
      );
    }
  }

  // Final partial batch.
  await flushBatch(batch);
  cp.upserted += batch.length;
  appendCsvRows(csvRows);
  saveCheckpoint(cp);

  console.log("\nDone.");
  console.log(`  Index rows scanned:        ${cp.scanned}`);
  console.log(`  foundation_directory hits: ${cp.matched}`);
  console.log(`  Records upserted:          ${cp.upserted}`);
  console.log(`  Gained a website_url:      ${cp.websiteGained}`);
  console.log(`  Failed to fetch/parse:     ${cp.failed}`);
  console.log(`\n  Raw extract: ${CSV_FILE}`);
  console.log(`  Checkpoint:  ${CHECKPOINT_FILE}`);
  console.log(`\n  Remember to back up ./enrichment-output/ to the DATAOCEAN drive.`);
}

main();
