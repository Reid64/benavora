// ============================================================================
// BENAVORA — IRS 990 XML ZIP bulk enrichment (tier 1) for the nonprofits table
//
// Reads IRS TEOS 990 XML ZIP bundles from a local folder
// (C:\Users\manag\Downloads\Recent Downloads\irs-990-zips\, processed in
// filename order), extracts each bundle's XML filings with 'unzipper', parses
// each with fast-xml-parser, matches by EIN to the nonprofits table
// (migration 098/099), and upserts extracted fields.
//
// nonprofits column list (from supabase/migrations/098_nonprofits_bmf.sql +
// 099_nonprofits_enrichment.sql — the live DB was not queried directly this
// session: the sandboxed shell here blocks arbitrary RPC calls against
// production, so this is the migration-file source of truth, not a verified
// `information_schema.columns` dump; re-verify live before relying on it for
// a new column the enrichment logic below doesn't already reference):
//   id uuid, ein text, name text, city text, state text, zip text,
//   ntee_code text, subsection_code text, foundation_type text,
//   ruling_date text, revenue_amount numeric, asset_amount numeric,
//   income_amount numeric, status text, created_at timestamptz,
//   updated_at timestamptz, website text, phone text, mission text,
//   employee_count integer, officer_name text, officer_title text,
//   officer_email text, contact_emails text, staff_contacts text,
//   linkedin_url text, facebook_url text, twitter_url text,
//   instagram_url text, enrichment_tier smallint, last_enriched_at timestamptz
//
// Upsert semantics: every field this script writes (officer_name,
// officer_title, employee_count, mission, revenue_amount, asset_amount,
// website) is COALESCE-style — only written when the existing row's column
// is NULL, so a later run (or a differently-sourced enrichment pass) never
// clobbers a previously-populated value. This is done via the parameterized
// query builder (fetch existing → conditionally .update()) rather than a
// raw `INSERT ... ON CONFLICT ... COALESCE(...)` string, because the values
// being written come from untrusted filer-supplied XML content (mission
// text, officer names) — interpolating those into a raw SQL string for the
// exec_sql RPC would be a SQL-injection vector. The query-builder approach
// gets the same never-overwrite-non-null guarantee with parameterized
// values instead.
//
// Disk-checkpointed rather than DB-checkpointed (contrast
// scripts/enrich-nonprofits-bmf-propublica.ts, which resumes off
// last_enriched_at): a single ZIP holds thousands of filings processed as one
// unit, so completion is tracked per-ZIP in progress.json — a killed run
// resumes from the next unprocessed ZIP, not from 01A.
//
//   pnpm enrich:990xml
// ============================================================================

import dotenv from "dotenv";

dotenv.config({ path: ".env.local" });

import fs from "fs";
import path from "path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import ws from "ws";
import { XMLParser } from "fast-xml-parser";
import unzipper from "unzipper";

const LOCAL_ZIP_DIR = "C:\\Users\\manag\\Downloads\\Recent Downloads\\irs-990-zips";
const WORK_DIR = "C:\\Users\\manag\\AppData\\Local\\Temp\\irs-990";
const PROGRESS_FILE = path.join(WORK_DIR, "progress.json");
const MAX_MISSION_LENGTH = 500;

function fail(step: string, error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`  ✗ ${step}: ${message}`);
}

function fatal(message: string): never {
  console.error(`\nFATAL: ${message}`);
  process.exit(1);
}

interface ZipTarget {
  name: string;
  path: string;
}

interface NonprofitRow {
  ein: string;
  revenue_amount: number | null;
  asset_amount: number | null;
  website: string | null;
  officer_name: string | null;
  officer_title: string | null;
  employee_count: number | null;
  mission: string | null;
}

interface ExtractedFields {
  ein: string | null;
  name: string | null;
  website: string | null;
  officer_name: string | null;
  officer_title: string | null;
  revenue: number | null;
  assets: number | null;
  employee_count: number | null;
  mission: string | null;
}

interface Progress {
  completed: string[];
  lastProcessedZip: string | null;
  totalProcessed: number;
  lastRun: string | null;
}

function loadProgress(): Progress {
  if (!fs.existsSync(PROGRESS_FILE)) {
    return { completed: [], lastProcessedZip: null, totalProcessed: 0, lastRun: null };
  }
  try {
    const raw = fs.readFileSync(PROGRESS_FILE, "utf-8");
    const parsed = JSON.parse(raw);
    return {
      completed: Array.isArray(parsed.completed) ? parsed.completed : [],
      lastProcessedZip: typeof parsed.lastProcessedZip === "string" ? parsed.lastProcessedZip : null,
      totalProcessed: typeof parsed.totalProcessed === "number" ? parsed.totalProcessed : 0,
      lastRun: typeof parsed.lastRun === "string" ? parsed.lastRun : null,
    };
  } catch {
    return { completed: [], lastProcessedZip: null, totalProcessed: 0, lastRun: null };
  }
}

function saveProgress(progress: Progress) {
  fs.writeFileSync(PROGRESS_FILE, JSON.stringify(progress, null, 2));
}

function buildZipTargets(): ZipTarget[] {
  if (!fs.existsSync(LOCAL_ZIP_DIR)) {
    fatal(`Local ZIP folder not found: ${LOCAL_ZIP_DIR}`);
  }

  const zipFiles = fs
    .readdirSync(LOCAL_ZIP_DIR)
    .filter((file) => file.toLowerCase().endsWith(".zip"))
    .sort((a, b) => a.localeCompare(b));

  return zipFiles.map((file) => ({
    name: path.basename(file, path.extname(file)),
    path: path.join(LOCAL_ZIP_DIR, file),
  }));
}

function asString(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  const str = String(value).trim();
  return str.length > 0 ? str : null;
}

function asNumber(value: unknown): number | null {
  if (value === undefined || value === null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function firstOf<T>(value: T | T[] | undefined | null): T | undefined {
  if (Array.isArray(value)) return value[0];
  return value ?? undefined;
}

// IRS 990 XML filings format EIN as "XX-XXXXXXX" in some fields and
// "XXXXXXXXX" in others; the nonprofits table (populated by
// scripts/ingest-nonprofit-bmf.ts from the raw, undashed BMF EIN column)
// always stores the undashed 9-digit form, so normalize to that before
// matching or EINs silently fail to join.
function normalizeEin(raw: string | null): string | null {
  if (!raw) return null;
  const digits = raw.replace(/-/g, "").trim();
  if (!/^\d+$/.test(digits)) return null;
  return digits.padStart(9, "0").slice(-9);
}

// Reject anything that isn't a real, publicly reachable site URL before it
// ever reaches the DB: 990 XML website fields are free text and routinely
// contain "N/A", "SEE SCHEDULE O", bare domains, or the filer's .gov agency
// contact page rather than the org's own site.
function sanitizeWebsite(raw: string | null): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed || /\s/.test(trimmed)) return null;
  if (!/^https?:\/\//i.test(trimmed)) return null;

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return null;
  }

  if (url.hostname.toLowerCase().endsWith(".gov")) return null;

  return url.toString().replace(/\/+$/, "");
}

const xmlParser = new XMLParser({ ignoreAttributes: false });

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function extractFields(parsed: any): ExtractedFields {
  const returnHeader = parsed?.Return?.ReturnHeader;
  const returnData = parsed?.Return?.ReturnData;
  const irs990 = returnData?.IRS990;

  const ein = normalizeEin(asString(returnHeader?.Filer?.EIN));
  const name = asString(returnHeader?.Filer?.BusinessName?.BusinessNameLine1Txt);
  const website = sanitizeWebsite(asString(returnHeader?.Filer?.WebsiteAddressTxt));

  const officerGrp = firstOf(irs990?.OfficerDirectorTrusteeKeyEmployeeGrp);
  const officer_name = asString(officerGrp?.PersonNm);
  const officer_title = asString(officerGrp?.TitleTxt);

  const revenue = asNumber(irs990?.CYTotalRevenueAmt);
  const assets = asNumber(irs990?.TotalAssetsEOYAmt);
  const employee_count = asNumber(irs990?.TotalEmployeeCnt);

  const rawMission = asString(irs990?.ActivityOrMissionDesc);
  const mission = rawMission ? rawMission.slice(0, MAX_MISSION_LENGTH) : null;

  return { ein, name, website, officer_name, officer_title, revenue, assets, employee_count, mission };
}

async function extractZip(zipPath: string, extractDir: string): Promise<string[]> {
  fs.mkdirSync(extractDir, { recursive: true });
  const directory = await unzipper.Open.file(zipPath);
  const xmlFiles: string[] = [];

  for (const entry of directory.files) {
    if (entry.type !== "File" || !entry.path.toLowerCase().endsWith(".xml")) continue;
    const destPath = path.join(extractDir, path.basename(entry.path));
    await new Promise<void>((resolve, reject) => {
      entry
        .stream()
        .pipe(fs.createWriteStream(destPath))
        .on("finish", () => resolve())
        .on("error", reject);
    });
    xmlFiles.push(destPath);
  }

  return xmlFiles;
}

async function fetchExistingRows(
  admin: SupabaseClient,
  eins: string[],
): Promise<Map<string, NonprofitRow>> {
  const map = new Map<string, NonprofitRow>();
  const CHUNK = 500;

  for (let i = 0; i < eins.length; i += CHUNK) {
    const chunk = eins.slice(i, i + CHUNK);
    const { data, error } = await admin
      .from("nonprofits")
      .select("ein, revenue_amount, asset_amount, website, officer_name, officer_title, employee_count, mission")
      .in("ein", chunk);

    if (error) {
      fatal(`could not query nonprofits: ${error.message}`);
    }

    for (const row of (data ?? []) as NonprofitRow[]) {
      map.set(row.ein, row);
    }
  }

  return map;
}

async function processZip(
  admin: SupabaseClient,
  target: ZipTarget,
): Promise<{ parsed: number; matched: number; updated: number; skipped: number }> {
  const zipPath = target.path;
  const extractDir = path.join(WORK_DIR, target.name);

  let parsed = 0;
  let matched = 0;
  let updated = 0;
  let updateFailed = 0;
  let skipped = 0;
  let xmlFiles: string[] = [];

  try {
    xmlFiles = await extractZip(zipPath, extractDir);
    console.log(`  [${target.name}] extracted ${xmlFiles.length} XML files`);

    const extractedByEin = new Map<string, ExtractedFields>();

    for (const xmlPath of xmlFiles) {
      try {
        const xml = fs.readFileSync(xmlPath, "utf-8");
        const parsedXml = xmlParser.parse(xml);
        const fields = extractFields(parsedXml);
        parsed++;

        if (!fields.ein) continue;
        extractedByEin.set(fields.ein, fields);
      } catch (err) {
        fail(`parse ${path.basename(xmlPath)}`, err);
      }
    }

    console.log(
      `  [${target.name}] parsed ${parsed} filings, ${extractedByEin.size} distinct EINs extracted`,
    );

    const eins = Array.from(extractedByEin.keys());
    const existingRows = await fetchExistingRows(admin, eins);

    for (const [ein, fields] of extractedByEin) {
      const existing = existingRows.get(ein);
      if (!existing) continue;
      matched++;

      // COALESCE semantics via parameterized query builder, not a raw
      // ON CONFLICT ... COALESCE(...) string — see file header. Only NULL
      // columns on the existing row are ever written.
      const update: Record<string, unknown> = {};
      if (existing.officer_name === null && fields.officer_name !== null) {
        update.officer_name = fields.officer_name;
      }
      if (existing.officer_title === null && fields.officer_title !== null) {
        update.officer_title = fields.officer_title;
      }
      if (existing.employee_count === null && fields.employee_count !== null) {
        update.employee_count = fields.employee_count;
      }
      if (existing.mission === null && fields.mission !== null) {
        update.mission = fields.mission;
      }
      if (existing.revenue_amount === null && fields.revenue !== null) {
        update.revenue_amount = fields.revenue;
      }
      if (existing.asset_amount === null && fields.assets !== null) {
        update.asset_amount = fields.assets;
      }
      if (existing.website === null && fields.website !== null) {
        update.website = fields.website;
      }

      if (Object.keys(update).length === 0) {
        // Every enrichable column on this row is already non-null —
        // nothing new to write, and no need to churn last_enriched_at.
        skipped++;
        continue;
      }

      update.enrichment_tier = 1;
      update.last_enriched_at = new Date().toISOString();

      const { error: updateError } = await admin.from("nonprofits").update(update).eq("ein", ein);

      if (updateError) {
        fail(`update EIN ${ein}`, updateError);
        updateFailed++;
      } else {
        updated++;
      }
    }

    console.log(
      `  ${target.name} | ${xmlFiles.length} | ${parsed} | ${matched} | ${updated} | ${skipped}` +
        `${updateFailed > 0 ? ` (${updateFailed} update failures)` : ""}`,
    );
  } finally {
    for (const xmlPath of xmlFiles) {
      try {
        fs.unlinkSync(xmlPath);
      } catch {
        // best-effort cleanup
      }
    }
    try {
      if (fs.existsSync(extractDir)) fs.rmSync(extractDir, { recursive: true, force: true });
    } catch {
      // best-effort cleanup
    }
  }

  return { parsed, matched, updated, skipped };
}

async function main() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) {
    fatal("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  }

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    // ws's WebSocket type isn't structurally identical to realtime-js's
    // WebSocketLikeConstructor (event handler signatures differ); runtime
    // behavior is unaffected. Same pattern as scripts/batch-score-opportunities.ts.
    realtime: { transport: ws as any },
  });

  fs.mkdirSync(WORK_DIR, { recursive: true });

  console.log(`IRS 990 XML ZIP bulk enrichment — nonprofits table (tier 1)`);
  console.log(`Source dir: ${LOCAL_ZIP_DIR}`);
  console.log(`Work dir: ${WORK_DIR}\n`);

  const progress = loadProgress();
  const targets = buildZipTargets().filter((t) => !progress.completed.includes(t.name));

  if (targets.length === 0) {
    console.log("All ZIPs already completed per progress.json. Nothing to do.");
    return;
  }

  console.log(`${targets.length}/${buildZipTargets().length} ZIPs remaining\n`);
  console.log("  ZIP name | Files extracted | XMLs parsed | EINs matched | Records updated | Records skipped (already enriched)");

  let totalParsed = 0;
  let totalMatched = 0;
  let totalUpdated = 0;
  let totalSkipped = 0;

  for (const target of targets) {
    try {
      const { parsed, matched, updated, skipped } = await processZip(admin, target);
      totalParsed += parsed;
      totalMatched += matched;
      totalUpdated += updated;
      totalSkipped += skipped;

      progress.completed.push(target.name);
      progress.lastProcessedZip = target.name;
      progress.totalProcessed += parsed;
      progress.lastRun = new Date().toISOString();
      saveProgress(progress);
    } catch (err) {
      fail(`process ${target.name}`, err);
      console.error(`  Stopping — rerun 'pnpm enrich:990xml' to resume from ${target.name}.`);
      break;
    }
  }

  console.log("\nDone.");
  console.log(`  ZIPs completed this run: ${progress.completed.length}/${buildZipTargets().length} total`);
  console.log(`  Records parsed:          ${totalParsed}`);
  console.log(`  Records matched:         ${totalMatched}`);
  console.log(`  Records updated:         ${totalUpdated}`);
  console.log(`  Records skipped:         ${totalSkipped} (already enriched)`);
}

main().catch((error) => {
  fatal(error instanceof Error ? error.message : String(error));
});
