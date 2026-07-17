// ============================================================================
// BENAVORA — Federal Register NOFA/NOFO intelligence ingestion
//
// Sweeps the Federal Register API (v1) for NOTICE-type documents from HUD,
// HHS, and DOJ, filters to funding-opportunity announcements (title contains
// "Notice of Funding"/"Grant Opportunity"/"NOFA"/"NOFO"), and maps hits into
// intelligence_funded_proposals (supabase/migrations/048_grant_intelligence.sql)
// as narrative source material for the Grant Intelligence library.
//
// intelligence_funded_proposals has no title/abstract/fiscal_year columns —
// following the same convention as scripts/ingest-nsf-awards.ts, title+abstract
// combine into full_text, grant_program holds the title alone, and the raw
// abstract/agencies list is kept in metadata since the table has no dedicated
// column for either. fiscal_year is derived from publication_date's year and
// stored in award_year, the closest existing column.
//
//   pnpm ingest:federal-register
// ============================================================================

import dotenv from "dotenv";

dotenv.config({ path: ".env.local" });

import { createAdminClient } from "../src/lib/supabase/admin";

const FEDERAL_REGISTER_API = "https://www.federalregister.gov/api/v1/documents.json";

const AGENCIES = [
  "department-of-housing-and-urban-development",
  "department-of-health-and-human-services",
  "department-of-justice",
];

const PER_PAGE = 100;
const MAX_PAGES = 10;

const NOFA_KEYWORDS = ["Notice of Funding", "Grant Opportunity", "NOFA", "NOFO"];

interface FederalRegisterAgency {
  name?: string;
}

interface FederalRegisterDocument {
  title?: string;
  abstract?: string;
  publication_date?: string;
  agencies?: FederalRegisterAgency[];
  html_url?: string;
  action?: string;
}

interface FederalRegisterSearchResponse {
  results?: FederalRegisterDocument[];
  total_pages?: number;
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

function buildParams(page: number): URLSearchParams {
  const params = new URLSearchParams();
  params.append("conditions[type][]", "NOTICE");
  for (const agency of AGENCIES) {
    params.append("conditions[agencies][]", agency);
  }
  params.append("per_page", String(PER_PAGE));
  params.append("page", String(page));
  for (const field of ["title", "abstract", "publication_date", "agencies", "html_url", "action"]) {
    params.append("fields[]", field);
  }
  params.append("order", "newest");
  return params;
}

async function fetchPage(page: number): Promise<FederalRegisterSearchResponse> {
  const params = buildParams(page);

  const response = await fetch(`${FEDERAL_REGISTER_API}?${params.toString()}`, {
    method: "GET",
    signal: AbortSignal.timeout(30_000),
  });

  if (!response.ok) {
    throw new Error(`Federal Register API returned HTTP ${response.status} on page ${page}`);
  }

  return (await response.json()) as FederalRegisterSearchResponse;
}

function isNofaTitle(title: string): boolean {
  return NOFA_KEYWORDS.some((keyword) => title.includes(keyword));
}

function parseFiscalYear(publicationDate: string | undefined): number | null {
  if (!publicationDate) return null;
  const year = parseInt(publicationDate.slice(0, 4), 10);
  return Number.isFinite(year) ? year : null;
}

function toRow(doc: FederalRegisterDocument): ProposalRow | null {
  if (!doc.html_url) return null; // no stable identifier to dedup/link on — skip rather than guess
  const title = doc.title?.trim() || null;
  if (!title || !isNofaTitle(title)) return null;

  const abstract = doc.abstract?.trim() || null;
  const fullText = [title, abstract].filter(Boolean).join("\n\n");
  if (!fullText) return null; // nothing worth ingesting

  const funderName = doc.agencies?.[0]?.name?.trim() || "Federal Register";

  return {
    source: "FEDERAL_REGISTER",
    source_url: doc.html_url,
    funder_name: funderName,
    funder_type: "government_grant",
    grant_program: title,
    award_amount: null,
    award_year: parseFiscalYear(doc.publication_date),
    category: ["federal", "nofa"],
    full_text: fullText.slice(0, 100_000),
    metadata: {
      abstract,
      agencies: doc.agencies ?? null,
      publication_date: doc.publication_date ?? null,
      action: doc.action ?? null,
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
    `Sweeping Federal Register for NOFA/NOFO notices from ${AGENCIES.join(", ")} (pages 1-${MAX_PAGES}) ...\n`,
  );

  let totalFetched = 0;
  let totalInserted = 0;
  let totalSkipped = 0;
  let totalFailed = 0;

  for (let page = 1; page <= MAX_PAGES; page++) {
    let body: FederalRegisterSearchResponse;
    try {
      body = await fetchPage(page);
    } catch (error) {
      fail(`page ${page}`, error);
      totalFailed++;
      break; // API-level failure — stop rather than hammer a broken endpoint
    }

    const documents = body.results ?? [];
    if (documents.length === 0) {
      ok(`page ${page}`, "no more results — ending sweep");
      break;
    }

    totalFetched += documents.length;

    const rows = documents.map(toRow).filter((r): r is ProposalRow => r !== null);
    const skippedNonNofa = documents.length - rows.length;

    if (rows.length > 0) {
      const sourceUrls = rows.map((r) => r.source_url);

      const { data: existingByUrl, error: existingUrlError } = await supabase
        .from("intelligence_funded_proposals")
        .select("source_url")
        .in("source_url", sourceUrls);

      if (existingUrlError) {
        fail(`page ${page} dedup check`, existingUrlError);
        totalFailed += rows.length;
        totalSkipped += skippedNonNofa;
      } else {
        const existingUrls = new Set((existingByUrl ?? []).map((e: { source_url: string }) => e.source_url));
        const newRows = rows.filter((r) => !existingUrls.has(r.source_url));
        const duplicateCount = rows.length - newRows.length;
        totalSkipped += skippedNonNofa + duplicateCount;

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
              `${newRows.length} inserted, ${duplicateCount} already ingested, ${skippedNonNofa} skipped (not a NOFA) — running total ${totalInserted}`,
            );
          }
        } else {
          ok(`page ${page}`, `0 new (${duplicateCount} already ingested, ${skippedNonNofa} skipped)`);
        }
      }
    } else {
      totalSkipped += skippedNonNofa;
      ok(`page ${page}`, `0 new (${skippedNonNofa} skipped — not a NOFA)`);
    }

    const totalPages = body.total_pages;
    if (totalPages && page >= totalPages) {
      ok(`page ${page}`, "final page reached (total_pages exhausted)");
      break;
    }
    if (documents.length < PER_PAGE) {
      ok(`page ${page}`, "final page reached (partial page returned)");
      break;
    }
  }

  console.log(
    `\nDone. ${totalInserted} inserted, ${totalSkipped} skipped/duplicate, ${totalFailed} failed across ${totalFetched} document(s) fetched.`,
  );
}

main().catch((error) => {
  fatal(error instanceof Error ? error.message : String(error));
});
