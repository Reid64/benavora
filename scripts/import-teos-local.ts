// ============================================================================
// BENAVORA — local IRS TEOS 990 XML batch import (foundation_directory +
// nonprofits), reading already-downloaded ZIP bundles from disk. No network
// calls to the IRS at all — this is the local counterpart to
// src/lib/scraper/foundation-scraper.ts's Strategy 1 (tryIrs990()), which
// downloads the same batch ZIPs live from apps.irs.gov on every run.
//
// Path correction: the task that requested this script named
// C:\Users\manag\Documents\Downloads\Recent Downloads\irs-990-zips\ (the same
// wrong path already hardcoded in scripts/enrich-990-xml.ts). That directory
// does not exist on this machine. The real local TEOS collection — confirmed
// by directory listing — lives at:
//   C:\Users\manag\Documents\BENAVORA SaaS\irs-990-zips\
// 12 ZIPs, 2023_TEOS_XML_01A.zip .. 12A.zip, ~4.2GB total, each containing
// several thousand to ~21,500 "{object_id}_public.xml" filings.
//
// Field extraction: reuses IRS990Source.parseXml() (src/lib/enrichment/
// sources/irs990.ts) unchanged — the exact same regex-based field extraction
// foundation-scraper.ts's tryIrs990() calls on every XML filing it downloads.
// Not reimplemented here. This script's only original logic is: (a) reading
// *_public.xml entries out of a local ZIP instead of a remote batch ZIP, (b)
// extracting each filing's own EIN (tryIrs990() doesn't need to do this — it
// already knows the EIN from the DB row it's resolving; here we're scanning
// every filing in a ZIP, so the EIN has to come out of the XML itself), and
// (c) the dual foundation_directory + nonprofits matching/write logic below.
//
// Write semantics — same fill-only-missing pattern as tryIrs990() itself
// (`if (!row.website && parsed.website) ...`), extended to the three fields
// the task asked for (website, phone, address = city/state/zip): a matched
// row is only ever written to on columns that are currently NULL. Nothing
// already on file is ever overwritten. `city`/`state`/`zip` are already
// populated for nearly every row from the original BMF bulk import, so in
// practice this mostly fills website/phone — the address columns are handled
// defensively for the rare row where they're genuinely null, not because
// that's expected to be the common case.
//
// Provenance tagging: foundation_directory.enrichment_source and
// .website_discovered_via are stamped "irs_990_xml_local" (not the network
// scraper's existing "irs_990_xml" value) so a later audit can tell which
// pipeline actually produced a given row's data — same underlying source
// (IRS 990 XML), different acquisition path (local disk vs. live download).
//
// Unmatched EINs (a filing whose EIN is in neither foundation_directory nor
// nonprofits) are NOT silently dropped — every one is appended to
// ./enrichment-output/teos-local-unmatched-eins.csv (ein, business name from
// the filing, source zip, source entry path) for a later decision on whether
// any of them are worth importing as new rows rather than just enrichment
// targets.
//
// Checkpointed the same way as scripts/enrich-990-xml.ts and conceptually
// like foundation-scraper.ts's scraper-checkpoint.json (offset/counts/
// startedAt/updatedAt shape) — but NOT the same file. Writing into the live
// network scraper's own scraper-checkpoint.json would corrupt an unrelated,
// separately-running process's resume state. This script's checkpoint is
// ./enrichment-output/teos-local-checkpoint.json, and — because a single ZIP
// here holds thousands of filings processed as one unit, the same reasoning
// scripts/enrich-990-xml.ts documents — resumption is per-ZIP: a killed run
// picks back up at the next not-yet-completed ZIP, not mid-ZIP.
//
// Usage:
//   pnpm import:teos-local                  # all ZIPs, resumable
//   pnpm import:teos-local --zip=2023_TEOS_XML_01A   # exactly one ZIP (test run)
// ============================================================================

import dotenv from "dotenv";

dotenv.config({ path: ".env.local" });

import fs from "node:fs";
import path from "node:path";
import unzipper from "unzipper";
import pLimit from "p-limit";
import type { SupabaseClient } from "@supabase/supabase-js";

import { createAdminClient } from "@/lib/supabase/admin";
import { IRS990Source } from "@/lib/enrichment/sources/irs990";
import type { EnrichmentResult } from "@/lib/enrichment/types";

// --- config ------------------------------------------------------------------

const ZIP_DIR = "C:\\Users\\manag\\Documents\\BENAVORA SaaS\\irs-990-zips";
const OUTPUT_DIR = path.resolve("./enrichment-output");
const CHECKPOINT_FILE = path.join(OUTPUT_DIR, "teos-local-checkpoint.json");
const UNMATCHED_LOG_FILE = path.join(OUTPUT_DIR, "teos-local-unmatched-eins.csv");
const EIN_QUERY_CHUNK = 500;
const XML_READ_CONCURRENCY = 16;

function log(message: string): void {
  console.log(`[${new Date().toISOString()}] ${message}`);
}

function fail(step: string, error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`  WARN ${step}: ${message}`);
}

function fatal(message: string): never {
  console.error(`\nFATAL: ${message}`);
  process.exit(1);
}

// --- checkpoint ----------------------------------------------------------------

interface Checkpoint {
  completedZips: string[];
  filingsParsed: number;
  parseFailed: number;
  einsExtracted: number;
  matchedFoundation: number;
  updatedFoundation: number;
  matchedNonprofits: number;
  updatedNonprofits: number;
  unmatched: number;
  startedAt: string;
  updatedAt: string;
}

function freshCheckpoint(): Checkpoint {
  const now = new Date().toISOString();
  return {
    completedZips: [],
    filingsParsed: 0,
    parseFailed: 0,
    einsExtracted: 0,
    matchedFoundation: 0,
    updatedFoundation: 0,
    matchedNonprofits: 0,
    updatedNonprofits: 0,
    unmatched: 0,
    startedAt: now,
    updatedAt: now,
  };
}

function loadCheckpoint(): { checkpoint: Checkpoint; isFresh: boolean } {
  if (!fs.existsSync(CHECKPOINT_FILE)) {
    return { checkpoint: freshCheckpoint(), isFresh: true };
  }
  try {
    const raw = JSON.parse(fs.readFileSync(CHECKPOINT_FILE, "utf-8"));
    const checkpoint: Checkpoint = {
      completedZips: Array.isArray(raw.completedZips) ? raw.completedZips : [],
      filingsParsed: typeof raw.filingsParsed === "number" ? raw.filingsParsed : 0,
      parseFailed: typeof raw.parseFailed === "number" ? raw.parseFailed : 0,
      einsExtracted: typeof raw.einsExtracted === "number" ? raw.einsExtracted : 0,
      matchedFoundation: typeof raw.matchedFoundation === "number" ? raw.matchedFoundation : 0,
      updatedFoundation: typeof raw.updatedFoundation === "number" ? raw.updatedFoundation : 0,
      matchedNonprofits: typeof raw.matchedNonprofits === "number" ? raw.matchedNonprofits : 0,
      updatedNonprofits: typeof raw.updatedNonprofits === "number" ? raw.updatedNonprofits : 0,
      unmatched: typeof raw.unmatched === "number" ? raw.unmatched : 0,
      startedAt: typeof raw.startedAt === "string" ? raw.startedAt : new Date().toISOString(),
      updatedAt: typeof raw.updatedAt === "string" ? raw.updatedAt : new Date().toISOString(),
    };
    return { checkpoint, isFresh: false };
  } catch (err) {
    log(`WARN could not parse existing checkpoint, starting fresh: ${(err as Error).message}`);
    return { checkpoint: freshCheckpoint(), isFresh: true };
  }
}

function saveCheckpoint(cp: Checkpoint): void {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  cp.updatedAt = new Date().toISOString();
  fs.writeFileSync(CHECKPOINT_FILE, JSON.stringify(cp, null, 2));
}

// --- unmatched-EIN log ----------------------------------------------------------

function csvField(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}

function openUnmatchedLog(isFresh: boolean): fs.WriteStream {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  if (isFresh || !fs.existsSync(UNMATCHED_LOG_FILE)) {
    fs.writeFileSync(UNMATCHED_LOG_FILE, "ein,business_name,source_zip,source_entry\n");
  }
  return fs.createWriteStream(UNMATCHED_LOG_FILE, { flags: "a" });
}

// --- ZIP / XML handling -----------------------------------------------------

interface ZipTarget {
  name: string;
  path: string;
}

function buildZipTargets(): ZipTarget[] {
  if (!fs.existsSync(ZIP_DIR)) {
    fatal(`Local TEOS ZIP folder not found: ${ZIP_DIR}`);
  }
  return fs
    .readdirSync(ZIP_DIR)
    .filter((file) => file.toLowerCase().endsWith(".zip"))
    .sort((a, b) => a.localeCompare(b))
    .map((file) => ({
      name: path.basename(file, path.extname(file)),
      path: path.join(ZIP_DIR, file),
    }));
}

// IRS 990 XML always renders the filer's own EIN as a bare <EIN>123456789</EIN>
// element directly under ReturnHeader/Filer. Distinct from <PreparerFirmEIN>,
// which never matches this pattern (its opening tag isn't literally "<EIN").
function extractEin(xml: string): string | null {
  const m = /<EIN[^>]*>([^<]*)<\/EIN>/.exec(xml);
  const digits = m?.[1]?.replace(/\D/g, "");
  if (!digits) return null;
  return digits.padStart(9, "0").slice(-9);
}

// Diagnostic-only label for the unmatched-EIN log — not part of the reused
// field-extraction logic (IRS990Source.parseXml already covers the real
// extraction; this just makes the CSV log human-readable).
function extractBusinessNameForLog(xml: string): string {
  const m = /<BusinessNameLine1Txt[^>]*>([^<]*)<\/BusinessNameLine1Txt>/.exec(xml);
  return m?.[1]?.trim() || "(name not found)";
}

interface ExtractedFiling {
  result: EnrichmentResult;
  entryPath: string;
  businessName: string;
}

async function extractZipFilings(
  zipPath: string,
  zipName: string,
  irs990Source: IRS990Source,
): Promise<{ extracted: Map<string, ExtractedFiling>; parsed: number; parseFailed: number }> {
  const directory = await unzipper.Open.file(zipPath);
  const xmlEntries = directory.files.filter(
    (f) => f.type === "File" && f.path.toLowerCase().endsWith("_public.xml"),
  );

  log(`  [${zipName}] ${xmlEntries.length} filing(s) found in ZIP`);

  const extracted = new Map<string, ExtractedFiling>();
  let parsed = 0;
  let parseFailed = 0;
  const limit = pLimit(XML_READ_CONCURRENCY);

  await Promise.all(
    xmlEntries.map((entry) =>
      limit(async () => {
        let xml: string;
        try {
          const buffer = await entry.buffer();
          xml = buffer.toString("utf-8");
        } catch (err) {
          fail(`read ${entry.path}`, err);
          return;
        }

        const ein = extractEin(xml);
        if (!ein) {
          parseFailed++;
          return;
        }

        // Same field-extraction call tryIrs990() makes — not reimplemented.
        const result = irs990Source.parseXml(ein, xml, `${zipName}#${entry.path}`);
        parsed++;
        if (!result) {
          parseFailed++;
          return;
        }

        extracted.set(ein, {
          result,
          entryPath: entry.path,
          businessName: extractBusinessNameForLog(xml),
        });
      }),
    ),
  );

  return { extracted, parsed, parseFailed };
}

// --- DB matching / writes -----------------------------------------------------

interface MatchRow {
  id: string;
  ein: string;
  website: string | null;
  phone: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
}

async function fetchExistingRows(
  admin: SupabaseClient,
  table: "foundation_directory" | "nonprofits",
  eins: string[],
): Promise<Map<string, MatchRow>> {
  const map = new Map<string, MatchRow>();

  for (let i = 0; i < eins.length; i += EIN_QUERY_CHUNK) {
    const chunk = eins.slice(i, i + EIN_QUERY_CHUNK);
    const { data, error } = await admin
      .from(table)
      .select("id, ein, website, phone, city, state, zip")
      .in("ein", chunk);

    if (error) {
      fatal(`could not query ${table}: ${error.message}`);
    }
    for (const row of (data ?? []) as MatchRow[]) {
      map.set(row.ein, row);
    }
  }

  return map;
}

// Fill-only-missing — mirrors tryIrs990()'s `if (!row.website && parsed.website)`
// guard exactly, extended to phone (also in tryIrs990()) and address (not in
// tryIrs990(), added per this task's explicit "website/phone/address" scope).
function buildFillUpdate(existing: MatchRow, result: EnrichmentResult): Record<string, unknown> {
  const update: Record<string, unknown> = {};
  if (!existing.website && result.website) update.website = result.website;
  if (!existing.phone && result.phones.length > 0) update.phone = result.phones[0];
  if (!existing.city && result.address?.city) update.city = result.address.city;
  if (!existing.state && result.address?.state) update.state = result.address.state;
  if (!existing.zip && result.address?.zip) update.zip = result.address.zip;
  return update;
}

interface ZipRunStats {
  parsed: number;
  parseFailed: number;
  einsExtracted: number;
  matchedFoundation: number;
  updatedFoundation: number;
  matchedNonprofits: number;
  updatedNonprofits: number;
  unmatched: number;
}

async function processZip(
  admin: SupabaseClient,
  irs990Source: IRS990Source,
  target: ZipTarget,
  unmatchedLog: fs.WriteStream,
): Promise<ZipRunStats> {
  const { extracted, parsed, parseFailed } = await extractZipFilings(target.path, target.name, irs990Source);
  const eins = Array.from(extracted.keys());

  log(`  [${target.name}] parsed ${parsed} filings (${parseFailed} unparseable), ${eins.length} distinct EIN(s)`);

  const [foundationMap, nonprofitMap] = await Promise.all([
    fetchExistingRows(admin, "foundation_directory", eins),
    fetchExistingRows(admin, "nonprofits", eins),
  ]);

  let matchedFoundation = 0;
  let updatedFoundation = 0;
  let matchedNonprofits = 0;
  let updatedNonprofits = 0;
  let unmatched = 0;

  for (const [ein, filing] of extracted) {
    const fRow = foundationMap.get(ein);
    const nRow = nonprofitMap.get(ein);

    if (!fRow && !nRow) {
      unmatched++;
      unmatchedLog.write(
        `${ein},${csvField(filing.businessName)},${target.name},${csvField(filing.entryPath)}\n`,
      );
      continue;
    }

    if (fRow) {
      matchedFoundation++;
      const update = buildFillUpdate(fRow, filing.result);
      if (Object.keys(update).length > 0) {
        update.enriched_990_at = new Date().toISOString();
        update.enrichment_source = "irs_990_xml_local";
        if (update.website) update.website_discovered_via = "irs_990_xml_local";

        const { error } = await admin.from("foundation_directory").update(update).eq("id", fRow.id);
        if (error) {
          fail(`foundation_directory update EIN ${ein}`, error);
        } else {
          updatedFoundation++;
        }
      }
    }

    if (nRow) {
      matchedNonprofits++;
      const update = buildFillUpdate(nRow, filing.result);
      if (Object.keys(update).length > 0) {
        update.last_enriched_at = new Date().toISOString();
        update.enrichment_tier = 1;

        const { error } = await admin.from("nonprofits").update(update).eq("id", nRow.id);
        if (error) {
          fail(`nonprofits update EIN ${ein}`, error);
        } else {
          updatedNonprofits++;
        }
      }
    }
  }

  log(
    `  [${target.name}] matchedFoundation=${matchedFoundation} updatedFoundation=${updatedFoundation} ` +
      `matchedNonprofits=${matchedNonprofits} updatedNonprofits=${updatedNonprofits} unmatched=${unmatched}`,
  );

  return {
    parsed,
    parseFailed,
    einsExtracted: eins.length,
    matchedFoundation,
    updatedFoundation,
    matchedNonprofits,
    updatedNonprofits,
    unmatched,
  };
}

// --- main ----------------------------------------------------------------------

async function main(): Promise<void> {
  const zipArg = process.argv.find((a) => a.startsWith("--zip="));
  const onlyZip = zipArg ? zipArg.slice("--zip=".length) : null;

  const admin = createAdminClient();
  const irs990Source = new IRS990Source();
  const { checkpoint, isFresh } = loadCheckpoint();
  const unmatchedLog = openUnmatchedLog(isFresh);

  const allTargets = buildZipTargets();
  let targets = allTargets.filter((t) => !checkpoint.completedZips.includes(t.name));

  if (onlyZip) {
    const match = allTargets.find((t) => t.name === onlyZip);
    if (!match) {
      fatal(`--zip=${onlyZip} not found among: ${allTargets.map((t) => t.name).join(", ")}`);
    }
    targets = [match as ZipTarget];
    log(`Single-ZIP mode: processing only ${onlyZip} (ignoring checkpoint completion for this run's target selection)`);
  }

  log(`Local TEOS 990 XML batch import — foundation_directory + nonprofits`);
  log(`Source dir: ${ZIP_DIR}`);
  log(`${targets.length}/${allTargets.length} ZIP(s) to process this run\n`);

  if (targets.length === 0) {
    log("All ZIPs already completed per checkpoint. Nothing to do.");
    return;
  }

  for (const target of targets) {
    try {
      const stats = await processZip(admin, irs990Source, target, unmatchedLog);

      checkpoint.filingsParsed += stats.parsed;
      checkpoint.parseFailed += stats.parseFailed;
      checkpoint.einsExtracted += stats.einsExtracted;
      checkpoint.matchedFoundation += stats.matchedFoundation;
      checkpoint.updatedFoundation += stats.updatedFoundation;
      checkpoint.matchedNonprofits += stats.matchedNonprofits;
      checkpoint.updatedNonprofits += stats.updatedNonprofits;
      checkpoint.unmatched += stats.unmatched;

      // Only mark complete (and thus skippable on resume) if this wasn't a
      // one-off --zip test re-run of an already-completed ZIP.
      if (!checkpoint.completedZips.includes(target.name)) {
        checkpoint.completedZips.push(target.name);
      }
      saveCheckpoint(checkpoint);
    } catch (err) {
      fail(`process ${target.name}`, err);
      console.error(`  Stopping — rerun 'pnpm import:teos-local' to resume from ${target.name}.`);
      break;
    }
  }

  unmatchedLog.end();

  log("\nDone.");
  log(`  ZIPs completed (cumulative): ${checkpoint.completedZips.length}/${allTargets.length}`);
  log(`  Filings parsed (cumulative): ${checkpoint.filingsParsed} (${checkpoint.parseFailed} unparseable)`);
  log(`  Distinct EINs extracted:     ${checkpoint.einsExtracted}`);
  log(`  foundation_directory:        matched=${checkpoint.matchedFoundation} updated=${checkpoint.updatedFoundation}`);
  log(`  nonprofits:                  matched=${checkpoint.matchedNonprofits} updated=${checkpoint.updatedNonprofits}`);
  log(`  Unmatched EINs (in neither table): ${checkpoint.unmatched} — see ${UNMATCHED_LOG_FILE}`);
}

main().catch((error) => {
  fatal(error instanceof Error ? error.message : String(error));
});
