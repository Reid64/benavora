// ============================================================================
// BENAVORA — SAMHSA / HRSA (HHS) USASpending.gov intelligence ingestion
//
// Sweeps the USASpending.gov Award Search API (v2, no key required) for HHS
// assistance awards (block grants / formula grants / project grants /
// cooperative agreements) matching a community-health/behavioral-health/
// housing keyword set, mapping hits into intelligence_funded_proposals
// (supabase/migrations/048_grant_intelligence.sql) as narrative source
// material for the Grant Intelligence library — the SAMHSA/HRSA lane called
// for in STANDING_DIRECTIVES.md Directive 3.
//
// intelligence_funded_proposals has no title/organization columns — the
// award's Description (truncated to 200 chars) becomes grant_program (the
// table's "title" stand-in per the existing NIH/NSF ingestion scripts'
// convention), the full Description is kept in full_text, and Recipient
// Name is kept in metadata since there's no dedicated organization column.
// Awarding Sub Agency (e.g. SAMHSA, HRSA, CDC) drives funder_name per this
// task's explicit mapping; the top-level Awarding Agency ("Department of
// Health and Human Services") is kept in funder_type since it's constant
// across every row otherwise.
//
// USASpending's award/<Award ID> page is keyed by the Award ID string
// (piid/fain) returned by spending_by_award, so that drives source_url.
//
//   pnpm ingest:samhsa-hrsa
// ============================================================================

import dotenv from "dotenv";

dotenv.config({ path: ".env.local" });

import { createAdminClient } from "../src/lib/supabase/admin";

const USASPENDING_API = "https://api.usaspending.gov/api/v2/search/spending_by_award/";

const AWARDING_AGENCY = "Department of Health and Human Services";
const AWARD_TYPE_CODES = ["02", "03", "04", "05"];
const DATE_RANGE = { start_date: "2023-01-01", end_date: "2024-12-31" };
const KEYWORDS = ["community health", "substance abuse", "mental health", "housing", "homeless"];
const PAGE_SIZE = 100;
const FIRST_PAGE = 1;
const LAST_PAGE = 10;

const FIELDS = [
  "Award ID",
  "Recipient Name",
  "Award Amount",
  "Description",
  "Awarding Agency",
  "Awarding Sub Agency",
  "Period of Performance Start Date",
];

interface UsaSpendingAward {
  "Award ID"?: string | null;
  "Recipient Name"?: string | null;
  "Award Amount"?: number | null;
  Description?: string | null;
  "Awarding Agency"?: string | null;
  "Awarding Sub Agency"?: string | null;
  "Period of Performance Start Date"?: string | null;
}

interface UsaSpendingResponse {
  results?: UsaSpendingAward[];
  page_metadata?: { page?: number; hasNext?: boolean };
}

interface ProposalRow {
  source: string;
  source_url: string;
  funder_name: string;
  funder_type: string | null;
  grant_program: string | null;
  award_amount: number | null;
  award_year: number | null;
  category: string[];
  full_text: string;
  metadata: Record<string, unknown>;
}

function ok(step: string, detail: string) {
  console.log(`  ✓ ${step}: ${detail}`);
}

function fail(step: string, error: unknown) {
  // Supabase's PostgrestError isn't an Error instance — String(error) renders "[object Object]"
  // and hides the real cause. Prefer .message when present, fall back to a JSON dump.
  const message =
    error instanceof Error
      ? error.message
      : error && typeof error === "object" && "message" in error
        ? String((error as { message: unknown }).message)
        : (() => {
            try {
              return JSON.stringify(error);
            } catch {
              return String(error);
            }
          })();
  console.error(`  ✗ ${step}: ${message}`);
}

function fatal(message: string): never {
  console.error(`\nFATAL: ${message}`);
  process.exit(1);
}

async function fetchPage(page: number): Promise<UsaSpendingAward[]> {
  const response = await fetch(USASPENDING_API, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      filters: {
        agencies: [{ type: "awarding", tier: "toptier", name: AWARDING_AGENCY }],
        award_type_codes: AWARD_TYPE_CODES,
        date_type: "action_date",
        date_range: DATE_RANGE,
        keywords: KEYWORDS,
      },
      fields: FIELDS,
      limit: PAGE_SIZE,
      page,
      sort: "Award Amount",
      order: "desc",
    }),
    signal: AbortSignal.timeout(30_000),
  });

  if (!response.ok) {
    throw new Error(`USASpending API returned HTTP ${response.status} at page ${page}`);
  }

  const body = (await response.json()) as UsaSpendingResponse;
  return body.results ?? [];
}

function parseAwardYear(startDate: string | null | undefined): number | null {
  if (!startDate) return null;
  const year = parseInt(startDate.slice(0, 4), 10);
  return Number.isFinite(year) ? year : null;
}

function toRow(award: UsaSpendingAward): ProposalRow | null {
  const awardId = award["Award ID"];
  if (!awardId) return null; // no stable identifier to dedup/link on — skip rather than guess

  const description = award.Description?.trim() || null;
  if (!description) return null; // nothing worth ingesting

  const funderName = award["Awarding Sub Agency"]?.trim() || award["Awarding Agency"]?.trim() || "HHS";
  const rawAmount = award["Award Amount"];
  // award_amount is numeric(12,2) (migration 048_grant_intelligence.sql) — max ~$9.99B. Large
  // Medicaid/entitlement awards routinely exceed that; null the amount rather than fail the row/batch.
  const AWARD_AMOUNT_COLUMN_MAX = 9_999_999_999.99;
  const amount =
    typeof rawAmount === "number" && Number.isFinite(rawAmount) && Math.abs(rawAmount) <= AWARD_AMOUNT_COLUMN_MAX
      ? rawAmount
      : null;

  return {
    source: "USASPENDING",
    source_url: `https://www.usaspending.gov/award/${encodeURIComponent(awardId)}`,
    funder_name: funderName,
    funder_type: award["Awarding Agency"]?.trim() || null,
    grant_program: description.slice(0, 200),
    award_amount: amount,
    award_year: parseAwardYear(award["Period of Performance Start Date"]),
    category: ["health", "housing", "community"],
    full_text: description.slice(0, 100_000),
    metadata: {
      award_id: awardId,
      organization: award["Recipient Name"]?.trim() || null,
      awarding_agency: award["Awarding Agency"] ?? null,
      awarding_sub_agency: award["Awarding Sub Agency"] ?? null,
      period_of_performance_start_date: award["Period of Performance Start Date"] ?? null,
    },
  };
}

async function main() {
  let supabase: ReturnType<typeof createAdminClient>;
  try {
    supabase = createAdminClient();
  } catch (error) {
    fatal(error instanceof Error ? error.message : String(error));
  }

  console.log(
    `Sweeping USASpending.gov for ${AWARDING_AGENCY} assistance awards (${DATE_RANGE.start_date}–${DATE_RANGE.end_date}, keywords: ${KEYWORDS.join(", ")}) ...\n`,
  );

  let totalFetched = 0;
  let totalInserted = 0;
  let totalSkipped = 0;
  let totalFailed = 0;

  for (let page = FIRST_PAGE; page <= LAST_PAGE; page++) {
    let awards: UsaSpendingAward[];
    try {
      awards = await fetchPage(page);
    } catch (error) {
      fail(`page ${page}`, error);
      totalFailed++;
      break; // API-level failure — stop rather than hammer a broken endpoint
    }

    if (awards.length === 0) {
      ok(`page ${page}`, "no more results — ending sweep");
      break;
    }

    totalFetched += awards.length;

    const rows = awards.map(toRow).filter((r): r is ProposalRow => r !== null);
    const skippedNoText = awards.length - rows.length;

    if (rows.length > 0) {
      const sourceUrls = rows.map((r) => r.source_url);
      const grantPrograms = rows.map((r) => r.grant_program).filter((p): p is string => !!p);

      const [{ data: existingByUrl, error: existingUrlError }, { data: existingByTitle, error: existingTitleError }] =
        await Promise.all([
          supabase.from("intelligence_funded_proposals").select("source_url").in("source_url", sourceUrls),
          grantPrograms.length > 0
            ? supabase
                .from("intelligence_funded_proposals")
                .select("grant_program")
                .eq("source", "USASPENDING")
                .in("grant_program", grantPrograms)
            : Promise.resolve({ data: [], error: null }),
        ]);

      const existingError = existingUrlError ?? existingTitleError;

      if (existingError) {
        fail(`page ${page} dedup check`, existingError);
        totalFailed += rows.length;
        totalSkipped += skippedNoText;
      } else {
        const existingUrls = new Set((existingByUrl ?? []).map((e: { source_url: string }) => e.source_url));
        const existingTitles = new Set(
          (existingByTitle ?? []).map((e: { grant_program: string | null }) => e.grant_program),
        );
        const newRows = rows.filter(
          (r) => !existingUrls.has(r.source_url) && !(r.grant_program && existingTitles.has(r.grant_program)),
        );
        const duplicateCount = rows.length - newRows.length;
        totalSkipped += skippedNoText + duplicateCount;

        if (newRows.length > 0) {
          const { error: insertError } = await supabase
            .from("intelligence_funded_proposals")
            .insert(newRows as never);

          if (insertError) {
            fail(`page ${page} insert`, insertError);
            totalFailed += newRows.length;
          } else {
            totalInserted += newRows.length;
            ok(
              `page ${page}`,
              `${newRows.length} inserted, ${duplicateCount} already ingested, ${skippedNoText} skipped (no text) — running total ${totalInserted}`,
            );
          }
        } else {
          ok(`page ${page}`, `0 new (${duplicateCount} already ingested, ${skippedNoText} skipped)`);
        }
      }
    } else {
      totalSkipped += skippedNoText;
      ok(`page ${page}`, `0 new (${skippedNoText} skipped — no usable text)`);
    }

    if (awards.length < PAGE_SIZE) {
      ok(`page ${page}`, "final page reached (partial page returned)");
      break;
    }
  }

  console.log(
    `\nDone. ${totalInserted} inserted, ${totalSkipped} skipped/duplicate, ${totalFailed} failed across ${totalFetched} award(s) fetched over pages ${FIRST_PAGE}-${LAST_PAGE}.`,
  );
}

main().catch((error) => {
  fatal(error instanceof Error ? error.message : String(error));
});
