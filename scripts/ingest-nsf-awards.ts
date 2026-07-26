// ============================================================================
// BENAVORA — NSF Award Search intelligence ingestion
//
// Sweeps the NSF Award Search API (v1) for funded NSF awards matching a
// nonprofit/community-health/housing/education keyword set, mapping hits
// into intelligence_funded_proposals
// (supabase/migrations/048_grant_intelligence.sql) as narrative source
// material for the Grant Intelligence library.
//
// intelligence_funded_proposals has no title/abstract/organization columns
// — title+abstract combine into full_text, grant_program holds the title
// alone, and awardeeName (the recipient organization) is kept in metadata
// since the table has no dedicated organization column. award_year is
// derived from startDate since the column exists and the source field is
// otherwise unused.
//
// api.nsf.gov's showAward page is keyed by the numeric award id, so that
// drives source_url; the human-readable primaryProgram list is kept in
// metadata.
//
//   pnpm ingest:nsf
// ============================================================================

import dotenv from "dotenv";

dotenv.config({ path: ".env.local" });

import { createAdminClient } from "../src/lib/supabase/admin";

const NSF_AWARDS_API = "https://api.nsf.gov/services/v1/awards.json";

const KEYWORD = "nonprofit community health housing education";
const DATE_START = "01/01/2023";
const DATE_END = "12/31/2024";
const AGENCY = "NSF";
const PAGE_SIZE = 25; // NSF Award Search API max rpp
const TARGET_INSERTED = 300;
const MAX_PAGES = 60; // safety cap: 60 * 25 = 1,500 fetched — well past TARGET_INSERTED

const PRINT_FIELDS = [
  "id",
  "title",
  "abstractText",
  "startDate",
  "expDate",
  "awardeeName",
  "fundsObligatedAmt",
  "primaryProgram",
];

interface NsfAward {
  id?: string;
  title?: string;
  abstractText?: string;
  startDate?: string;
  expDate?: string;
  awardeeName?: string;
  fundsObligatedAmt?: string;
  primaryProgram?: string[];
}

interface NsfSearchResponse {
  response?: {
    award?: NsfAward[];
  };
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
  const message = error instanceof Error ? error.message : String(error);
  console.error(`  ✗ ${step}: ${message}`);
}

function fatal(message: string): never {
  console.error(`\nFATAL: ${message}`);
  process.exit(1);
}

// Supabase's gateway rejects an overlong `.in()` query string (verified: 400
// Bad Request against a ~500-value list). Chunking keeps every request's
// query string well under any gateway limit — see ingest-nih-reporter.ts.
const IN_CHUNK_SIZE = 100;

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) chunks.push(items.slice(i, i + size));
  return chunks;
}

async function fetchPage(offset: number): Promise<NsfAward[]> {
  const params = new URLSearchParams({
    keyword: KEYWORD,
    dateStart: DATE_START,
    dateEnd: DATE_END,
    agency: AGENCY,
    rpp: String(PAGE_SIZE),
    offset: String(offset),
    printFields: PRINT_FIELDS.join(","),
  });

  const response = await fetch(`${NSF_AWARDS_API}?${params.toString()}`, {
    method: "GET",
    signal: AbortSignal.timeout(30_000),
  });

  if (!response.ok) {
    throw new Error(`NSF Award Search API returned HTTP ${response.status} at offset ${offset}`);
  }

  const body = (await response.json()) as NsfSearchResponse;
  return body.response?.award ?? [];
}

function parseAwardYear(startDate: string | undefined): number | null {
  if (!startDate) return null;
  const parts = startDate.split("/");
  if (parts.length !== 3) return null;
  const year = parseInt(parts[2], 10);
  return Number.isFinite(year) ? year : null;
}

function toRow(award: NsfAward): ProposalRow | null {
  if (!award.id) return null; // no stable identifier to dedup/link on — skip rather than guess

  const title = award.title?.trim() || null;
  const abstract = award.abstractText?.trim() || null;
  const fullText = [title, abstract].filter(Boolean).join("\n\n");
  if (!fullText) return null; // nothing worth ingesting

  const amount = award.fundsObligatedAmt ? Number(award.fundsObligatedAmt) : null;

  return {
    source: "NSF_AWARDS",
    source_url: `https://www.nsf.gov/awardsearch/showAward?AWD_ID=${award.id}`,
    funder_name: "NSF",
    funder_type: null,
    grant_program: title,
    award_amount: amount !== null && Number.isFinite(amount) ? amount : null,
    award_year: parseAwardYear(award.startDate),
    category: ["education", "community"],
    full_text: fullText.slice(0, 100_000),
    metadata: {
      nsf_award_id: award.id,
      organization: award.awardeeName ?? null,
      primary_program: award.primaryProgram ?? null,
      start_date: award.startDate ?? null,
      exp_date: award.expDate ?? null,
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
    `Sweeping NSF Award Search for "${KEYWORD}" (${DATE_START}–${DATE_END}, target ${TARGET_INSERTED} records) ...\n`,
  );

  let offset = 0;
  let page = 0;
  let totalFetched = 0;
  let totalInserted = 0;
  let totalSkipped = 0;
  let totalFailed = 0;

  while (page < MAX_PAGES && totalInserted < TARGET_INSERTED) {
    page++;
    let awards: NsfAward[];
    try {
      awards = await fetchPage(offset);
    } catch (error) {
      fail(`page ${page} (offset ${offset})`, error);
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

      const urlChunkResults = await Promise.all(
        chunk(sourceUrls, IN_CHUNK_SIZE).map((group) =>
          supabase.from("intelligence_funded_proposals").select("source_url").in("source_url", group),
        ),
      );
      const titleChunkResults =
        grantPrograms.length > 0
          ? await Promise.all(
              chunk(grantPrograms, IN_CHUNK_SIZE).map((group) =>
                supabase
                  .from("intelligence_funded_proposals")
                  .select("grant_program")
                  .eq("funder_name", "NSF")
                  .in("grant_program", group),
              ),
            )
          : [];

      const existingError =
        urlChunkResults.find((r) => r.error)?.error ?? titleChunkResults.find((r) => r.error)?.error ?? null;

      if (existingError) {
        fail(`page ${page} dedup check`, existingError);
        totalFailed += rows.length;
        totalSkipped += skippedNoText;
      } else {
        const existingUrls = new Set(
          urlChunkResults.flatMap((r) => (r.data ?? []).map((e: { source_url: string }) => e.source_url)),
        );
        const existingTitles = new Set(
          titleChunkResults.flatMap((r) => (r.data ?? []).map((e: { grant_program: string | null }) => e.grant_program)),
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

    offset += PAGE_SIZE;
  }

  console.log(
    `\nDone. ${totalInserted} inserted, ${totalSkipped} skipped/duplicate, ${totalFailed} failed across ${totalFetched} award(s) fetched over ${page} page(s).`,
  );
  if (totalInserted < TARGET_INSERTED && page >= MAX_PAGES) {
    console.warn(
      `  Hit the ${MAX_PAGES}-page safety cap before reaching the ${TARGET_INSERTED} target — re-run to continue (dedup makes this idempotent).`,
    );
  }
}

main().catch((error) => {
  fatal(error instanceof Error ? error.message : String(error));
});
