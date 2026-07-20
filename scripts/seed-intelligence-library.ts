// ============================================================================
// BENAVORA — Intelligence Library platform-wide seed (pnpm seed:library)
//
// Seeds intelligence_funded_proposals (supabase/migrations/048_grant_intelligence.sql)
// from three sources:
//   A. ProPublica Nonprofit Explorer search.json + organizations/{ein}.json --
//      real IRS Form 990 filing data. NOTE on deviation from the task spec: the
//      real ProPublica v2 API has no `income_amount` field on search results
//      (verified against src/lib/agents/propublica.ts, the only other consumer
//      of this API in the repo) -- income only exists per-filing on the detail
//      endpoint (`totrevenue`). This script fetches detail for each search hit
//      and filters on that field. ProPublica orgs are nonprofits themselves,
//      not funders, so these rows are stored as organizational revenue
//      benchmark data (clearly labeled as such in full_text and metadata),
//      not as "awarded grant narratives" -- Source B below is the actual
//      narrative corpus.
//   B. scripts/lib/seed-intelligence-library-data.ts -- 80 hand-authored
//      synthetic-but-realistic records spanning 10 NTEE categories (see that
//      file's header for why 80, not the task's headline "100").
//   C. platform_learning_patterns (src/supabase/migrations/083) WHERE
//      success_rate >= 0.55 AND sample_count >= 2 -- converted to proposal-
//      shaped rows so the Draft Generation Agent's library lookup (Task 3)
//      surfaces platform-learned patterns alongside hand-authored narratives.
//
// Schema note: intelligence_funded_proposals has no ntee_code/success_factors/
// keywords columns, and DDL against the live prod project is unavailable this
// session (Management API PAT still 401 as of 2026-07-20; no MCP access to
// project vbjplpquqxxfbpazyalt). ntee_code, success_factors, and keywords are
// carried inside the existing `metadata` jsonb column instead -- see
// scripts/lib/seed-intelligence-library-data.ts's header for the full
// rationale. `category` (text[], already live) carries the NTEE major letter,
// a real funder_category enum value, and free-text topic tags.
//
// Idempotent: every row this script writes carries metadata.seed_batch, and a
// second run skips any source_url already present in the table.
//
//   pnpm seed:library
// ============================================================================

import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import ws from "ws";

import { ALL_LIBRARY_RECORDS, buildNarrative } from "./lib/seed-intelligence-library-data";

const PROPUBLICA_BASE = "https://projects.propublica.org/nonprofits/api/v2";
const PROPUBLICA_QUERIES: { q: string; state?: string }[] = [
  { q: "awarded grant", state: "CA" },
  { q: "awarded grant", state: "TX" },
  { q: "awarded grant", state: "NY" },
  { q: "awarded grant", state: "FL" },
  { q: "foundation grant recipient" },
  { q: "community development grant" },
  { q: "federal grant nonprofit" },
];
const MAX_RESULTS_PER_QUERY = 10;
const MIN_INCOME_FOR_INCLUSION = 50_000;
const PROPUBLICA_INTER_REQUEST_DELAY_MS = 350;

const SEED_BATCH_B = "ntee-library-v1";
const SEED_BATCH_C = "platform-learning-patterns-v1";
const SEED_BATCH_A = "propublica-990-v1";

interface RawSearchOrg {
  ein?: unknown;
  name?: unknown;
}
interface RawSearchResponse {
  organizations?: unknown[];
  total_results?: unknown;
}
interface RawFiling {
  tax_prd_yr?: unknown;
  totrevenue?: unknown;
}
interface RawOrgDetail {
  name?: unknown;
  city?: unknown;
  state?: unknown;
  ntee_code?: unknown;
  subsection_code?: unknown;
}
interface RawOrgResponse {
  organization?: RawOrgDetail;
  filings_with_data?: unknown[];
}

interface ProposalInsertRow {
  source: string;
  source_url: string | null;
  funder_name: string | null;
  funder_type: string | null;
  grant_program: string | null;
  award_amount: number | null;
  award_year: number | null;
  category: string[];
  full_text: string | null;
  reviewer_comments: string | null;
  metadata: Record<string, unknown>;
}

function toStr(val: unknown): string | null {
  if (typeof val === "string") return val.trim() || null;
  if (val === null || val === undefined) return null;
  return String(val).trim() || null;
}
function toNum(val: unknown): number | null {
  if (val === null || val === undefined || val === "") return null;
  const n = Number(val);
  return Number.isFinite(n) ? n : null;
}
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
function fatal(message: string): never {
  console.error(`\nFATAL: ${message}`);
  process.exit(1);
}

/** NTEE major letter -> human label, for the final report only. */
const NTEE_LABELS: Record<string, string> = {
  A: "Arts, Culture & Humanities",
  B: "Education",
  C: "Environment",
  D: "Animal-Related",
  E: "Health Care",
  F: "Mental Health & Crisis Intervention",
  L: "Housing & Shelter",
  O: "Youth Development",
  P: "Human Services",
  S: "Community Improvement & Capacity Building",
  W: "Public & Societal Benefit — Veterans",
  X: "Religion-Related",
  UNKNOWN: "Uncategorized",
};

function nteeMajorLetter(nteeCode: string | null): string {
  if (!nteeCode) return "UNKNOWN";
  const letter = nteeCode.trim().charAt(0).toUpperCase();
  return /[A-Z]/.test(letter) ? letter : "UNKNOWN";
}

// ---- Source A: ProPublica -------------------------------------------------

async function propublicaSearch(q: string, state?: string): Promise<{ ein: string; name: string }[]> {
  const params = new URLSearchParams({ q });
  if (state) params.set("state[id]", state);
  const url = `${PROPUBLICA_BASE}/search.json?${params.toString()}`;

  try {
    const res = await fetch(url, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(15_000),
    });
    // ProPublica's search.json returns HTTP 404 even for a *successful*
    // zero-result query (verified live: `?q=awarded+grant&state[id]=CA` comes
    // back 404 with a well-formed `{"total_results":0,"organizations":[]}`
    // body) -- so status alone can't gate success here. Only a non-JSON body
    // (network failure, 5xx HTML error page) is a real failure.
    const contentType = res.headers.get("content-type") ?? "";
    if (!contentType.includes("application/json")) {
      console.warn(`  ProPublica search HTTP ${res.status} (non-JSON) for "${q}"${state ? ` (${state})` : ""}`);
      return [];
    }
    const body = (await res.json()) as RawSearchResponse;
    const orgs = (body?.organizations ?? []) as RawSearchOrg[];
    if (orgs.length === 0) {
      console.log(`    0 results for "${q}"${state ? ` (${state})` : ""} (name-search API -- expected for phrase-style queries)`);
    }
    return orgs
      .slice(0, MAX_RESULTS_PER_QUERY)
      .map((o) => ({ ein: toStr(o.ein), name: toStr(o.name) }))
      .filter((o): o is { ein: string; name: string } => o.ein !== null && o.name !== null);
  } catch (err) {
    console.warn(`  ProPublica search failed for "${q}": ${err instanceof Error ? err.message : err}`);
    return [];
  }
}

async function propublicaOrgDetail(ein: string): Promise<{
  name: string;
  city: string | null;
  state: string | null;
  nteeCode: string | null;
  latestYear: number | null;
  latestRevenue: number | null;
} | null> {
  const url = `${PROPUBLICA_BASE}/organizations/${ein.replace(/\D/g, "")}.json`;
  try {
    const res = await fetch(url, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) return null;
    const body = (await res.json()) as RawOrgResponse;
    const org = body?.organization;
    const name = toStr(org?.name);
    if (!name) return null;

    const filings = ((body?.filings_with_data ?? []) as RawFiling[])
      .map((f) => ({ year: toNum(f.tax_prd_yr), revenue: toNum(f.totrevenue) }))
      .filter((f): f is { year: number; revenue: number | null } => f.year !== null)
      .sort((a, b) => b.year - a.year);

    const latest = filings[0];
    return {
      name,
      city: toStr(org?.city),
      state: toStr(org?.state),
      nteeCode: toStr(org?.ntee_code),
      latestYear: latest?.year ?? null,
      latestRevenue: latest?.revenue ?? null,
    };
  } catch {
    return null;
  }
}

async function buildPropublicaRows(): Promise<ProposalInsertRow[]> {
  const rows: ProposalInsertRow[] = [];
  const seenEins = new Set<string>();

  for (const { q, state } of PROPUBLICA_QUERIES) {
    console.log(`  Searching ProPublica: "${q}"${state ? ` (${state})` : ""}...`);
    const hits = await propublicaSearch(q, state);
    await sleep(PROPUBLICA_INTER_REQUEST_DELAY_MS);

    for (const hit of hits) {
      if (seenEins.has(hit.ein)) continue;
      seenEins.add(hit.ein);

      const detail = await propublicaOrgDetail(hit.ein);
      await sleep(PROPUBLICA_INTER_REQUEST_DELAY_MS);
      if (!detail || detail.latestRevenue === null || detail.latestRevenue <= MIN_INCOME_FOR_INCLUSION) {
        continue;
      }

      const nteeLetter = nteeMajorLetter(detail.nteeCode);
      const nteeLabel = NTEE_LABELS[nteeLetter] ?? NTEE_LABELS.UNKNOWN;
      const locationText = [detail.city, detail.state].filter(Boolean).join(", ") || "location not on file";

      rows.push({
        source: "PROPUBLICA_990",
        source_url: `https://projects.propublica.org/nonprofits/organizations/${hit.ein.replace(/\D/g, "")}`,
        funder_name: "N/A — IRS Form 990 filing (self-reported, not an awarded grant)",
        funder_type: "Self-Reported Filing",
        grant_program: `${detail.name} — Annual Operating Revenue Profile`,
        award_amount: detail.latestRevenue,
        award_year: detail.latestYear,
        category: [nteeLetter, "benchmark_data"],
        full_text:
          `${detail.name}, based in ${locationText}, reported total revenue of ` +
          `$${detail.latestRevenue.toLocaleString("en-US")} for tax year ${detail.latestYear ?? "unknown"} ` +
          `per its most recent IRS Form 990 filing (via ProPublica Nonprofit Explorer). NTEE code: ` +
          `${detail.nteeCode ?? "not on file"} (${nteeLabel}). This is an organizational revenue benchmark ` +
          `derived from public IRS filing data, not an awarded grant narrative -- included in the Intelligence ` +
          `Library as sector-sizing context, distinct from the hand-authored funded-proposal narratives in this corpus.`,
        reviewer_comments: null,
        metadata: {
          seed_batch: SEED_BATCH_A,
          ein: hit.ein,
          ntee_code: detail.nteeCode,
          city: detail.city,
          state: detail.state,
          record_kind: "propublica_990_benchmark",
        },
      });
    }
  }

  return rows;
}

// ---- Source B: hardcoded NTEE-spanning narratives --------------------------

function buildLibraryRows(): ProposalInsertRow[] {
  return ALL_LIBRARY_RECORDS.map((r, i) => ({
    source: "INTELLIGENCE_LIBRARY_SEED",
    source_url: `seed://intelligence-library/v1/${i}`,
    funder_name: r.funderName,
    funder_type: r.funderType,
    grant_program: r.grantProgram,
    award_amount: r.awardAmount,
    award_year: r.awardYear,
    category: [r.nteeCode, r.funderCategoryTag, ...r.topicTags],
    full_text: buildNarrative(r),
    reviewer_comments: null,
    metadata: {
      seed_batch: SEED_BATCH_B,
      organization: r.orgName,
      ntee_code: r.nteeCode,
      ntee_label: r.nteeLabel,
      success_factors: r.successFactors,
      keywords: r.keywords,
      record_kind: "hand_authored_narrative",
    },
  }));
}

// ---- Source C: platform_learning_patterns -----------------------------------

interface PlatformLearningPatternRow {
  id: string;
  pattern_type: string;
  funder_category: string | null;
  ntee_code: string | null;
  pattern_content: string;
  success_rate: number | null;
  sample_count: number;
  avg_award_amount: number | null;
  confidence: string | null;
}

async function buildPlatformPatternRows(supabase: SupabaseClient): Promise<ProposalInsertRow[]> {
  const { data, error } = await supabase
    .from("platform_learning_patterns")
    .select(
      "id, pattern_type, funder_category, ntee_code, pattern_content, success_rate, sample_count, avg_award_amount, confidence",
    )
    .gte("success_rate", 0.55)
    .gte("sample_count", 2);

  if (error) {
    console.warn(`  platform_learning_patterns query failed (non-fatal): ${error.message}`);
    return [];
  }

  const patterns = (data ?? []) as PlatformLearningPatternRow[];
  return patterns.map((p) => {
    const nteeLetter = nteeMajorLetter(p.ntee_code);
    const nteeLabel = NTEE_LABELS[nteeLetter] ?? NTEE_LABELS.UNKNOWN;
    const successPct = p.success_rate !== null ? Math.round(p.success_rate * 100) : null;

    return {
      source: "PLATFORM_LEARNING_PATTERN",
      source_url: `seed://platform-learning-pattern/${p.id}`,
      funder_name: p.funder_category ? `Platform-wide pattern — ${p.funder_category}` : "Platform-wide pattern",
      funder_type: "Aggregated Cross-Org Pattern",
      grant_program: `${p.pattern_type} pattern (${p.sample_count} corroborating outcome${p.sample_count === 1 ? "" : "s"})`,
      award_amount: p.avg_award_amount,
      award_year: null,
      category: [nteeLetter, p.funder_category, p.pattern_type].filter(
        (v): v is string => typeof v === "string" && v.length > 0,
      ),
      full_text:
        `This platform-learned pattern is corroborated by ${p.sample_count} anonymized outcome` +
        `${p.sample_count === 1 ? "" : "s"} across Benavora's Global Learning Network, with a ` +
        `${successPct ?? "unknown"}% associated success rate (confidence: ${p.confidence ?? "low"}). ` +
        `Pattern (${p.pattern_type}, ${nteeLabel}): ${p.pattern_content}`,
      reviewer_comments: null,
      metadata: {
        seed_batch: SEED_BATCH_C,
        source_pattern_id: p.id,
        ntee_code: p.ntee_code,
        success_rate: p.success_rate,
        sample_count: p.sample_count,
        confidence: p.confidence,
        record_kind: "platform_learning_pattern",
      },
    };
  });
}

// ---- Main --------------------------------------------------------------------

async function insertRows(
  supabase: SupabaseClient,
  rows: ProposalInsertRow[],
  existingUrls: Set<string>,
  label: string,
): Promise<number> {
  const toInsert = rows.filter((r) => r.source_url === null || !existingUrls.has(r.source_url));
  if (toInsert.length === 0) {
    console.log(`  ${label}: 0 new rows (all ${rows.length} already seeded)`);
    return 0;
  }

  const BATCH = 25;
  let inserted = 0;
  for (let i = 0; i < toInsert.length; i += BATCH) {
    const chunk = toInsert.slice(i, i + BATCH);
    const { error } = await supabase.from("intelligence_funded_proposals").insert(chunk);
    if (error) {
      console.error(`  ${label}: insert batch failed: ${error.message}`);
      continue;
    }
    inserted += chunk.length;
    for (const r of chunk) {
      if (r.source_url) existingUrls.add(r.source_url);
    }
  }
  console.log(`  ${label}: inserted ${inserted} new row(s) (${rows.length - toInsert.length} already existed)`);
  return inserted;
}

async function main() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) {
    fatal("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    realtime: { transport: ws as any },
  });

  console.log("Loading existing source_url set for idempotency check...");
  const { data: existingRows, error: existingErr } = await supabase
    .from("intelligence_funded_proposals")
    .select("source_url")
    .not("source_url", "is", null);
  if (existingErr) fatal(`Failed to load existing rows: ${existingErr.message}`);
  const existingUrls = new Set(
    (existingRows ?? []).map((r) => (r as { source_url: string }).source_url).filter(Boolean),
  );
  console.log(`  ${existingUrls.size} existing source_url(s) on file.\n`);

  console.log("SOURCE B — hand-authored NTEE-spanning narratives...");
  const libraryRows = buildLibraryRows();
  const insertedB = await insertRows(supabase, libraryRows, existingUrls, "Source B");

  console.log("\nSOURCE C — platform_learning_patterns conversion...");
  const patternRows = await buildPlatformPatternRows(supabase);
  const insertedC = await insertRows(supabase, patternRows, existingUrls, "Source C");

  console.log("\nSOURCE A — ProPublica Nonprofit Explorer sweep (this can take ~1-2 minutes)...");
  const propublicaRows = await buildPropublicaRows();
  const insertedA = await insertRows(supabase, propublicaRows, existingUrls, "Source A");

  const totalInserted = insertedA + insertedB + insertedC;
  console.log(`\nTotal new rows inserted this run: ${totalInserted}`);
  console.log(`  Source A (ProPublica):              ${insertedA}`);
  console.log(`  Source B (hand-authored narratives): ${insertedB}`);
  console.log(`  Source C (platform learning patterns): ${insertedC}`);

  // Final NTEE breakdown across the whole table (not just this run).
  const { count: totalCount } = await supabase
    .from("intelligence_funded_proposals")
    .select("id", { count: "exact", head: true });

  const { data: allCategoryRows } = await supabase
    .from("intelligence_funded_proposals")
    .select("category")
    .limit(10_000);

  const nteeCounts: Record<string, number> = {};
  for (const row of allCategoryRows ?? []) {
    const cats = (row as { category: string[] | null }).category ?? [];
    const letter = cats.find((c) => c.length === 1 && /[A-Z]/.test(c));
    const key = letter ?? "(no NTEE tag)";
    nteeCounts[key] = (nteeCounts[key] ?? 0) + 1;
  }

  console.log(`\nFinal total intelligence_funded_proposals count: ${totalCount}`);
  console.log("NTEE breakdown (all rows, not just this run):");
  for (const [letter, count] of Object.entries(nteeCounts).sort((a, b) => b[1] - a[1])) {
    const label = NTEE_LABELS[letter] ?? "";
    console.log(`  ${letter}${label ? ` (${label})` : ""}: ${count}`);
  }
}

main().catch((error) => {
  fatal(error instanceof Error ? error.stack ?? error.message : String(error));
});
