// @ts-nocheck
// ============================================================================
// BENAVORA — Donor Discovery taxonomy seed script
//
// Seeds donor_discovery_taxonomy (migration 067, DONOR_DISCOVERY_ARCHITECTURE.md
// §1A-1C): the shared, no-org_id classification spine for the Donor Discovery
// engine. Two branches:
//
//   1. NAICS (kind='naics') — every official 2022 NAICS 6-digit code, each
//      linked to its 4-digit industry group parent, each linked in turn to
//      its 2-digit sector parent (three-digit subsector and 5-digit industry
//      levels are intentionally not materialized as separate nodes — see
//      §1C, which only calls out 2-digit sector and 4-digit industry group
//      as parent levels).
//
//   2. Civic (kind='civic') — the five non-NAICS entity types from §1B:
//      land_bank, community_foundation, corporate_foundation,
//      municipal_surplus, trade_association. Flat, no parent hierarchy.
//
// Source of truth: the official Census Bureau 2022 NAICS code list
// (census.gov). This script downloads it live and refuses to seed anything
// if the download fails or looks truncated — a partial/fabricated NAICS
// list would silently corrupt every subscriber's taxonomy tree, so there is
// no "fall back to a hardcoded subset" path here.
//
// Idempotent: upserts on the (kind, code) unique index, so re-running is safe.
//
//   pnpm seed:dd-taxonomy
// ============================================================================

import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";
import ws from "ws";

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
  console.error("Refusing to seed a partial or fabricated NAICS taxonomy.");
  process.exit(1);
}

// ----------------------------------------------------------------------------
// Download: official Census 2022 NAICS code list
//
// Census publishes the full 2-through-6-digit 2022 NAICS structure (code,
// title, and for the descriptions file, a long description) as a flat,
// delimited text file covering every digit level in one list. The canonical
// path below is the one Census has used for prior vintages (see
// https://www.census.gov/naics/?58967 for the current reference-files page);
// if Census has since moved it, update NAICS_SOURCE_CANDIDATES — do not
// substitute a hand-typed or partial code list.
// ----------------------------------------------------------------------------
const NAICS_SOURCE_CANDIDATES = [
  "https://www.census.gov/naics/2022NAICS/2022_NAICS_Descriptions.txt",
  "https://www.census.gov/naics/2022NAICS/2022_NAICS_Descriptions.csv",
  "https://www.census.gov/naics/2022NAICS/2-6%20digit_2022_Codes.csv",
];

const MIN_SIX_DIGIT_CODES = 900; // official list is ~1,057; well below that = bad/partial download

async function downloadNaicsSource(): Promise<string> {
  for (const candidate of NAICS_SOURCE_CANDIDATES) {
    try {
      const res = await fetch(candidate);
      if (!res.ok) {
        console.error(`  ✗ ${candidate}: HTTP ${res.status}`);
        continue;
      }
      const text = await res.text();
      const looksLikeHtml = /<!doctype html|<html/i.test(text.slice(0, 500));
      if (looksLikeHtml) {
        console.error(`  ✗ ${candidate}: response looks like an HTML page, not the code list`);
        continue;
      }
      if (text.length < 10_000) {
        console.error(`  ✗ ${candidate}: response too small (${text.length} bytes), likely not the real file`);
        continue;
      }
      ok("download NAICS source", `${candidate} (${text.length} bytes)`);
      return text;
    } catch (error) {
      fail(`download ${candidate}`, error);
    }
  }
  fatal(
    "could not download the official Census NAICS 2022 code list from any known URL. " +
      "Update NAICS_SOURCE_CANDIDATES in this script with the current URL from " +
      "https://www.census.gov/naics/?58967 and retry."
  );
}

// ----------------------------------------------------------------------------
// Parse: the source file lists every NAICS digit level (2, 3, 4, 5, 6) as one
// row per code, plus combined-sector range rows (e.g. "31-33") for the three
// sectors that span multiple 2-digit codes (Manufacturing, Retail Trade,
// Transportation and Warehousing). We only need the 2-digit sector, 4-digit
// industry group, and 6-digit national industry levels (per §1C).
//
// Format is not guaranteed byte-for-byte (Census has used pipe-delimited
// "Code|Title|Description" for this file historically); parse pipe-delimited
// first, and fall back to RFC4180-style CSV if that yields too few six-digit
// codes. Either way we only read the first two columns (code, title) — a
// description column that wraps across lines just produces rows that fail
// the code-shape check below and get skipped, so it can't corrupt already
//-parsed entries.
// ----------------------------------------------------------------------------
interface NaicsRow {
  code: string;
  title: string;
}

interface SectorRange {
  range: string;
  codes: string[];
  title: string;
}

interface ParsedNaics {
  byCode: Map<string, NaicsRow>;
  sectorRanges: SectorRange[];
}

function splitCsvLine(line: string): string[] {
  const fields: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        cur += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      fields.push(cur);
      cur = "";
    } else {
      cur += ch;
    }
  }
  fields.push(cur);
  return fields;
}

function parseLines(raw: string, splitLine: (line: string) => string[]): ParsedNaics {
  const byCode = new Map<string, NaicsRow>();
  const sectorRanges: SectorRange[] = [];

  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    const parts = splitLine(trimmed);
    if (parts.length < 2) continue;

    const rawCode = parts[0].replace(/"/g, "").trim();
    const title = parts[1].replace(/"/g, "").trim();
    if (!rawCode || !title || /^code$/i.test(rawCode)) continue; // header row

    if (/^\d{2}-\d{2}$/.test(rawCode)) {
      const [start, end] = rawCode.split("-").map(Number);
      const codes: string[] = [];
      for (let n = start; n <= end; n++) codes.push(String(n).padStart(2, "0"));
      sectorRanges.push({ range: rawCode, codes, title });
      continue;
    }

    if (!/^\d{2,6}$/.test(rawCode)) continue; // free-text continuation of a wrapped description
    byCode.set(rawCode, { code: rawCode, title });
  }

  return { byCode, sectorRanges };
}

function countByLength(byCode: Map<string, NaicsRow>, length: number): number {
  let count = 0;
  for (const code of byCode.keys()) if (code.length === length) count++;
  return count;
}

function parseNaicsSource(raw: string): ParsedNaics {
  let parsed = parseLines(raw, (line) => line.split("|"));
  if (countByLength(parsed.byCode, 6) < MIN_SIX_DIGIT_CODES) {
    console.error("  pipe-delimited parse yielded too few six-digit codes, retrying as CSV ...");
    parsed = parseLines(raw, splitCsvLine);
  }
  return parsed;
}

function resolveSector(
  prefix2: string,
  sectorRanges: SectorRange[],
  byCode: Map<string, NaicsRow>
): { code: string; title: string } | null {
  const combined = sectorRanges.find((r) => r.codes.includes(prefix2));
  if (combined) return { code: combined.range, title: combined.title };
  const solo = byCode.get(prefix2);
  if (solo) return { code: prefix2, title: solo.title };
  return null;
}

// ----------------------------------------------------------------------------
// Upsert helpers
// ----------------------------------------------------------------------------
async function upsertTaxonomyBatch(
  rows: { kind: string; code: string; label: string; parent_id: string | null }[]
) {
  const BATCH = 500;
  for (let i = 0; i < rows.length; i += BATCH) {
    const chunk = rows.slice(i, i + BATCH);
    const { error } = await admin
      .from("donor_discovery_taxonomy")
      .upsert(chunk, { onConflict: "kind,code" });
    if (error) {
      fail(`upsert taxonomy batch [${i}, ${i + chunk.length})`, error);
      fatal("upsert failed midway through seeding — taxonomy may be partially seeded. Fix the error and re-run (upserts are idempotent).");
    }
  }
}

async function fetchAllNaicsNodeIds(): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  const PAGE = 1000;
  let from = 0;
  for (;;) {
    const { data, error } = await admin
      .from("donor_discovery_taxonomy")
      .select("id, code")
      .eq("kind", "naics")
      .range(from, from + PAGE - 1);
    if (error) {
      fail("fetch taxonomy nodes", error);
      fatal("could not read back seeded taxonomy nodes to resolve parent linkage.");
    }
    if (!data || data.length === 0) break;
    for (const row of data) map.set(row.code, row.id);
    if (data.length < PAGE) break;
    from += PAGE;
  }
  return map;
}

// ----------------------------------------------------------------------------
// Civic branch (§1B) — flat, no parent hierarchy
// ----------------------------------------------------------------------------
const CIVIC_ENTRIES = [
  { code: "land_bank", label: "Land Bank" },
  { code: "community_foundation", label: "Community Foundation" },
  { code: "corporate_foundation", label: "Corporate Foundation" },
  { code: "municipal_surplus", label: "Municipal Surplus-Property Program" },
  { code: "trade_association", label: "Trade Association" },
];

async function seedCivicBranch() {
  const rows = CIVIC_ENTRIES.map((e) => ({
    kind: "civic",
    code: e.code,
    label: e.label,
    parent_id: null as string | null,
  }));
  await upsertTaxonomyBatch(rows);
  ok("civic branch", `${rows.length} entries upserted`);
}

// ----------------------------------------------------------------------------
// Main
// ----------------------------------------------------------------------------
async function main() {
  console.log("Downloading official Census 2022 NAICS code list ...");
  const raw = await downloadNaicsSource();
  const { byCode, sectorRanges } = parseNaicsSource(raw);

  const sixDigit = [...byCode.values()].filter((r) => r.code.length === 6);
  if (sixDigit.length < MIN_SIX_DIGIT_CODES) {
    fatal(
      `parsed only ${sixDigit.length} six-digit NAICS codes (expected ~1,057). ` +
        "The downloaded file is likely truncated, malformed, or not the real NAICS list."
    );
  }
  const fourDigit = [...byCode.values()].filter((r) => r.code.length === 4);
  console.log(`Parsed ${sixDigit.length} six-digit codes and ${fourDigit.length} four-digit industry groups.`);

  const sectorPrefixes = new Set(fourDigit.map((r) => r.code.slice(0, 2)));
  const sectorNodes = new Map<string, string>(); // sector code (may be a "31-33" range) -> title
  for (const prefix of sectorPrefixes) {
    const sector = resolveSector(prefix, sectorRanges, byCode);
    if (!sector) {
      fatal(`no sector title found for 2-digit prefix "${prefix}" (needed by a 4-digit industry group).`);
    }
    sectorNodes.set(sector.code, sector.title);
  }

  console.log(`\nSeeding NAICS sectors (2-digit) ...`);
  await upsertTaxonomyBatch(
    [...sectorNodes.entries()].map(([code, label]) => ({ kind: "naics", code, label, parent_id: null }))
  );
  ok("sectors", `${sectorNodes.size} upserted`);

  let idMap = await fetchAllNaicsNodeIds();

  console.log(`Seeding NAICS industry groups (4-digit) ...`);
  const groupRows = fourDigit.map((r) => {
    const sector = resolveSector(r.code.slice(0, 2), sectorRanges, byCode)!;
    const parentId = idMap.get(sector.code);
    if (!parentId) fatal(`sector "${sector.code}" was not found after upsert — cannot link industry group ${r.code}.`);
    return { kind: "naics", code: r.code, label: r.title, parent_id: parentId };
  });
  await upsertTaxonomyBatch(groupRows);
  ok("industry groups", `${groupRows.length} upserted`);

  idMap = await fetchAllNaicsNodeIds();

  console.log(`Seeding NAICS national industries (6-digit) ...`);
  const industryRows = sixDigit.map((r) => {
    const groupCode = r.code.slice(0, 4);
    const parentId = idMap.get(groupCode);
    if (!parentId) fatal(`industry group "${groupCode}" was not found after upsert — cannot link national industry ${r.code}.`);
    return { kind: "naics", code: r.code, label: r.title, parent_id: parentId };
  });
  await upsertTaxonomyBatch(industryRows);
  ok("national industries (6-digit)", `${industryRows.length} upserted`);

  console.log(`\nSeeding civic branch ...`);
  await seedCivicBranch();

  console.log("\nDone.");
}

main();
