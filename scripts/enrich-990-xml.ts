// ============================================================================
// BENAVORA — IRS 990 XML bulk enrichment (tier 1) for the nonprofits table
//
// Downloads each year's IRS e-Postcard/990 XML index
// (https://apps.irs.gov/pub/epostcard/990/xml/YEAR/index_YEAR.json), fetches
// every available 990-family filing's XML, and extracts website, phone,
// mission, employee count, and the first listed officer into the
// nonprofits table (migration 099). Concurrency-limited with p-limit;
// progress logged every 1000 records with a processed/min rate.
//
//   pnpm enrich:990xml
// ============================================================================

import dotenv from "dotenv";

dotenv.config({ path: ".env.local" });

import { createClient } from "@supabase/supabase-js";
import ws from "ws";
import { XMLParser } from "fast-xml-parser";
import pLimit from "p-limit";

const INDEX_YEARS = [2023, 2022, 2021, 2020];
const CONCURRENCY = 10;
const FETCH_TIMEOUT_MS = 15_000;
const LOG_EVERY = 1000;
const MAX_MISSION_LENGTH = 500;

function fatal(message: string): never {
  console.error(`\nFATAL: ${message}`);
  process.exit(1);
}

function fail(step: string, error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`  ✗ ${step}: ${message}`);
}

interface IndexFiling {
  ein: string;
  formType: string;
  url: string;
  isAvailable: boolean;
}

interface ExtractedFields {
  ein: string;
  website: string | null;
  phone: string | null;
  mission: string | null;
  employee_count: number | null;
  officer_name: string | null;
  officer_title: string | null;
}

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  parseTagValue: true,
});

function firstOf<T>(value: T | T[] | undefined | null): T | undefined {
  if (Array.isArray(value)) return value[0];
  return value ?? undefined;
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

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function extractFields(ein: string, parsed: any): ExtractedFields {
  const returnData = parsed?.Return?.ReturnData;
  const returnHeader = parsed?.Return?.ReturnHeader;
  const irs990 = returnData?.IRS990;

  const website = asString(irs990?.WebsiteAddressTxt);
  const phone = asString(returnHeader?.Filer?.USAddress?.PhoneNum);

  const rawMission = asString(irs990?.ActivityOrMissionDesc);
  const mission = rawMission ? rawMission.slice(0, MAX_MISSION_LENGTH) : null;

  const employee_count = asNumber(irs990?.TotalEmployeeCnt);

  const officerGrp = firstOf(irs990?.Form990PartVIISectionAGrp);
  const officer_name = asString(officerGrp?.PersonNm);
  const officer_title = asString(officerGrp?.TitleTxt);

  return { ein, website, phone, mission, employee_count, officer_name, officer_title };
}

async function fetchIndex(year: number): Promise<IndexFiling[]> {
  const url = `https://apps.irs.gov/pub/epostcard/990/xml/${year}/index_${year}.csv`;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    if (!res.ok) {
      fail(`fetch index ${year}`, `HTTP ${res.status}`);
      return [];
    }
    const csv = await res.text();
    const lines = csv.split("\n");
    const filings: IndexFiling[] = [];

    // Column layout (positional, no header lookup):
    //   0 ObjectId          5 OrganizationName
    //   1 IsElectronic       6 FormType
    //   2 EIN                7 ObjectId (duplicate)
    //   3 TaxPeriod (YYYYMM) 8 LastUpdated
    //   4 Year               9 URL (unused — constructed from ObjectId/Year instead)
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;

      const cols = line.split(",");
      const objectId = (cols[0] ?? "").trim();
      const isAvailable = (cols[1] ?? "").trim() === "EFILE";
      const ein = (cols[2] ?? "").trim();
      const rowYear = (cols[4] ?? "").trim();
      const formType = (cols[6] ?? "").trim();

      if (!formType.startsWith("990")) continue;
      if (!isAvailable) continue;

      filings.push({
        ein,
        formType,
        url: `https://apps.irs.gov/pub/epostcard/990/xml/${rowYear}/${objectId}_public.xml`,
        isAvailable,
      });
    }

    return filings;
  } catch (err) {
    fail(`fetch index ${year}`, err);
    return [];
  }
}

async function fetchAndExtract(filing: IndexFiling): Promise<ExtractedFields> {
  const ein = filing.ein.trim();

  const res = await fetch(filing.url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}`);
  }
  const xml = await res.text();
  const parsed = xmlParser.parse(xml);
  return extractFields(ein, parsed);
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

  console.log("IRS 990 XML bulk enrichment — nonprofits table (tier 1)");
  console.log(`Years: ${INDEX_YEARS.join(", ")}, concurrency: ${CONCURRENCY}\n`);

  const startedAt = Date.now();
  let processed = 0;
  let enriched = 0;
  let failed = 0;

  const limit = pLimit(CONCURRENCY);

  for (const year of INDEX_YEARS) {
    console.log(`\n[${year}] fetching index…`);
    const eligible = await fetchIndex(year);
    console.log(`[${year}] ${eligible.length} available 990-family filings`);

    await Promise.all(
      eligible.map((filing) =>
        limit(async () => {
          try {
            const extracted = await fetchAndExtract(filing);

            const { error } = await supabase
              .from("nonprofits")
              .update({
                website: extracted.website,
                phone: extracted.phone,
                mission: extracted.mission,
                employee_count: extracted.employee_count,
                officer_name: extracted.officer_name,
                officer_title: extracted.officer_title,
                enrichment_tier: 1,
                last_enriched_at: new Date().toISOString(),
              })
              .eq("ein", extracted.ein);

            if (error) {
              failed++;
              fail(`update EIN ${extracted.ein}`, error);
            } else {
              enriched++;
            }
          } catch (err) {
            failed++;
            fail(`filing EIN ${filing.ein}`, err);
          }

          processed++;
          if (processed % LOG_EVERY === 0) {
            const elapsedMin = (Date.now() - startedAt) / 60_000;
            const rate = elapsedMin > 0 ? Math.round(processed / elapsedMin) : 0;
            console.log(
              `  … processed ${processed}, enriched ${enriched}, failed ${failed}, rate ${rate}/min`,
            );
          }
        }),
      ),
    );
  }

  console.log("\nDone.");
  console.log(`  Records processed: ${processed}`);
  console.log(`  Enriched:          ${enriched}`);
  console.log(`  Failed:            ${failed}`);
}

main().catch((error) => {
  fatal(error instanceof Error ? error.message : String(error));
});
