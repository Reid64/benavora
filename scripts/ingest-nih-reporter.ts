// ============================================================================
// BENAVORA — NIH RePORTER intelligence ingestion
//
// Sweeps the NIH RePORTER Project Search API (v2) for funded NIH grants
// across a fixed set of health-focused Institutes/Centers, mapping hits into
// intelligence_funded_proposals (supabase/migrations/048_grant_intelligence.sql)
// as narrative/eligibility source material for the Grant Intelligence library.
// Complements the day-of-year keyword sweep in
// src/lib/intelligence/ingest-nih-proposals.ts (cron-driven, 10/day) with a
// one-time/manual bulk backfill across five ICs and two fiscal years.
//
// Field notes verified live against api.reporter.nih.gov: appl_id,
// project_num, fiscal_year, and agency_ic_admin are NOT returned unless
// explicitly requested in include_fields, so they're added here on top of
// the caller-specified field list — required for dedup, award_year, and the
// agency/funder_type mapping. reporter.nih.gov's project-details page is
// keyed by appl_id (matching the existing convention in
// src/lib/intelligence/ingest-nih-proposals.ts), so appl_id drives the
// source_url while the human-readable project_num is kept in metadata.
//
// intelligence_funded_proposals has no title/abstract/agency/fiscal_year
// columns — title+abstract combine into full_text, grant_program holds the
// title alone, agency name maps to funder_type, and fiscal_year maps to the
// real award_year column.
//
//   pnpm ingest:nih-reporter
// ============================================================================

import dotenv from "dotenv";

dotenv.config({ path: ".env.local" });

import { createAdminClient } from "../src/lib/supabase/admin";

const NIH_REPORTER_API = "https://api.reporter.nih.gov/v2/projects/search";

const FISCAL_YEARS = [2023, 2024];
const AGENCIES = ["NIAID", "NIMH", "NIDA", "NCI", "NHLBI"];
const PAGE_SIZE = 500;
const TARGET_INSERTED = 2000;
const MAX_PAGES = 20; // safety cap: 20 * 500 = 10,000 fetched — well past TARGET_INSERTED

const REQUESTED_INCLUDE_FIELDS = [
  "ProjectTitle",
  "AbstractText",
  "ProjectStartDate",
  "ProjectEndDate",
  "AwardAmount",
  "PrincipalInvestigators",
  "Organization",
  "Terms",
  "FundingMechanism",
  "FullStudySection",
];

// Added beyond the task's field list — verified these are otherwise absent
// from the response even when other include_fields are requested.
const IDENTITY_INCLUDE_FIELDS = ["ApplId", "ProjectNum", "FiscalYear", "AgencyIcAdmin"];

interface NihAgencyIcAdmin {
  code?: string;
  abbreviation?: string;
  name?: string;
}

interface NihProject {
  appl_id?: number;
  project_num?: string;
  fiscal_year?: number;
  agency_ic_admin?: NihAgencyIcAdmin | null;
  project_title?: string;
  abstract_text?: string | null;
  project_start_date?: string | null;
  project_end_date?: string | null;
  award_amount?: number | null;
  principal_investigators?: Array<{ full_name?: string }> | null;
  organization?: { org_name?: string | null } | null;
  terms?: string | null;
  funding_mechanism?: string | null;
  full_study_section?: { name?: string } | null;
}

interface NihSearchResponse {
  meta?: { total?: number };
  results?: NihProject[];
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

// Supabase's gateway rejects the ~30KB query string a single `.in()` call
// with a full 500-row page of source_url values produces (verified: 400 Bad
// Request). Splitting into small chunks keeps each request's query string
// well under any gateway limit.
const IN_CHUNK_SIZE = 100;

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) chunks.push(items.slice(i, i + size));
  return chunks;
}

async function fetchPage(offset: number): Promise<NihProject[]> {
  const response = await fetch(NIH_REPORTER_API, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      criteria: {
        fiscal_years: FISCAL_YEARS,
        agencies: AGENCIES,
      },
      limit: PAGE_SIZE,
      offset,
      sort_field: "project_start_date",
      sort_order: "desc",
      include_fields: [...REQUESTED_INCLUDE_FIELDS, ...IDENTITY_INCLUDE_FIELDS],
    }),
    signal: AbortSignal.timeout(30_000),
  });

  if (!response.ok) {
    throw new Error(`NIH RePORTER API returned HTTP ${response.status} at offset ${offset}`);
  }

  const body = (await response.json()) as NihSearchResponse;
  return body.results ?? [];
}

function toRow(project: NihProject): ProposalRow | null {
  if (!project.appl_id) return null; // no stable identifier to dedup/link on — skip rather than guess

  const title = project.project_title?.trim() || null;
  const abstract = project.abstract_text?.trim() || null;
  const fullText = [title, abstract].filter(Boolean).join("\n\n");
  if (!fullText) return null; // nothing worth ingesting

  return {
    source: "NIH_REPORTER",
    source_url: `https://reporter.nih.gov/project-details/${project.appl_id}`,
    funder_name: "NIH",
    funder_type: project.agency_ic_admin?.name ?? project.agency_ic_admin?.abbreviation ?? null,
    grant_program: title,
    award_amount: project.award_amount ?? null,
    award_year: project.fiscal_year ?? null,
    category: ["health", "research"],
    full_text: fullText.slice(0, 100_000),
    metadata: {
      appl_id: project.appl_id,
      project_num: project.project_num ?? null,
      agency_code: project.agency_ic_admin?.abbreviation ?? project.agency_ic_admin?.code ?? null,
      funding_mechanism: project.funding_mechanism ?? null,
      full_study_section: project.full_study_section?.name ?? null,
      terms: project.terms ?? null,
      organization: project.organization?.org_name ?? null,
      principal_investigator: project.principal_investigators?.[0]?.full_name ?? null,
      project_start_date: project.project_start_date ?? null,
      project_end_date: project.project_end_date ?? null,
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
    `Sweeping NIH RePORTER for FY${FISCAL_YEARS.join("/")} across ${AGENCIES.join(", ")} (target ${TARGET_INSERTED} records) ...\n`,
  );

  let offset = 0;
  let page = 0;
  let totalFetched = 0;
  let totalInserted = 0;
  let totalSkipped = 0;
  let totalFailed = 0;

  while (page < MAX_PAGES && totalInserted < TARGET_INSERTED) {
    page++;
    let projects: NihProject[];
    try {
      projects = await fetchPage(offset);
    } catch (error) {
      fail(`page ${page} (offset ${offset})`, error);
      totalFailed++;
      break; // API-level failure — stop rather than hammer a broken endpoint
    }

    if (projects.length === 0) {
      ok(`page ${page}`, "no more results — ending sweep");
      break;
    }

    totalFetched += projects.length;

    const rows = projects.map(toRow).filter((r): r is ProposalRow => r !== null);
    const skippedNoText = projects.length - rows.length;

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
                  .eq("funder_name", "NIH")
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

    if (projects.length < PAGE_SIZE) {
      ok(`page ${page}`, "final page reached (partial page returned)");
      break;
    }

    offset += PAGE_SIZE;
  }

  console.log(
    `\nDone. ${totalInserted} inserted, ${totalSkipped} skipped/duplicate, ${totalFailed} failed across ${totalFetched} project(s) fetched over ${page} page(s).`,
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
