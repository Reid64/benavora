// Shared query/filter logic for the Grant Intelligence Library
// (intelligence_funded_proposals — supabase/migrations/048_grant_intelligence.sql).
//
// migration 106_intelligence_library_schema_upgrade.sql adds funder_category/
// ntee_major/geographic_scope/source_type/persuasive_elements/winning_phrases/
// full_text_search_vector etc, but has NOT been applied to production as of
// 2026-07-21 (verified live this session: SELECT of those columns returns
// 42703 "column does not exist"; the Management API PAT in BLUEPRINT_v2.md
// §8.3 also returns 401, so this session could not apply it either — see
// memory benavora-management-api-pat-rejected). Everything below is built
// against the columns confirmed live: id, source, source_url, funder_name,
// funder_type, grant_program, award_amount, award_year, category (text[]),
// full_text, metadata (jsonb), created_at. ntee_code/success_factors/keywords/
// organization live inside metadata jsonb, not as dedicated columns, per the
// convention scripts/seed-intelligence-library.ts established.
//
// funder_type as stored is inconsistent -- for federal-agency sources (NIH,
// USDA, HUD, DOJ_OJP) it holds the specific sub-agency/program name, not a
// clean bucket. deriveFunderBucket() below normalizes it using `source`
// (always clean) plus the handful of clean funder_type values the seed/manual
// paths write ("Private Foundation", "Corporate Foundation", "Federal
// Government"). This is a computed classification, not a stored column.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/types/database";
import { selectAllPages } from "@/lib/supabase/select-all-pages";

export type ProposalsClient = SupabaseClient<Database>;

export const FEDERAL_SOURCES = [
  "NIH",
  "NIH_NIAID",
  "NIH_REPORTER",
  "NSF_AWARDS",
  "FEDERAL_REGISTER",
  "USASPENDING",
  "USDA",
  "HUD",
  "DOJ_OJP",
] as const;

export type FunderBucket =
  | "federal"
  | "private_foundation"
  | "corporate_foundation"
  | "community_foundation"
  | "public_charity";

export const FUNDER_BUCKET_OPTIONS: { value: FunderBucket; label: string }[] = [
  { value: "federal", label: "Federal Government" },
  { value: "private_foundation", label: "Private Foundation" },
  { value: "corporate_foundation", label: "Corporate Foundation" },
  { value: "community_foundation", label: "Community Foundation" },
  { value: "public_charity", label: "Public Charity" },
];

// Real NTEE major-group codes present (or plausible) in `category[0]`.
// Grouped per the requested UI taxonomy, with Environment/Animal Welfare kept
// distinct (C vs D per the actual NTEE standard, not conflated).
export const NTEE_GROUPS: { value: string; label: string; codes: string[] }[] = [
  { value: "E,F", label: "Health (E, F)", codes: ["E", "F"] },
  { value: "B", label: "Education (B)", codes: ["B"] },
  { value: "P", label: "Human Services (P)", codes: ["P"] },
  { value: "L", label: "Housing & Shelter (L)", codes: ["L"] },
  { value: "A", label: "Arts & Culture (A)", codes: ["A"] },
  { value: "C", label: "Environment (C)", codes: ["C"] },
  { value: "D", label: "Animal Welfare (D)", codes: ["D"] },
  { value: "S", label: "Community Development (S)", codes: ["S"] },
  { value: "W", label: "Veterans & Military (W)", codes: ["W"] },
  { value: "O", label: "Youth Development (O)", codes: ["O"] },
  { value: "T,U,V,X,Y,Z", label: "Public Benefit (T, U, V, X, Y, Z)", codes: ["T", "U", "V", "X", "Y", "Z"] },
];

export const DATA_SOURCE_OPTIONS: { value: string; label: string }[] = [
  { value: "federal_api", label: "Federal API" },
  { value: "PROPUBLICA_990", label: "ProPublica 990" },
  { value: "MANUAL_ENTRY", label: "Manual Entry" },
  { value: "INTELLIGENCE_LIBRARY_SEED", label: "Platform Library" },
];

export interface ProposalRow {
  id: string;
  source: string;
  source_url: string | null;
  funder_name: string | null;
  funder_type: string | null;
  grant_program: string | null;
  award_amount: number | null;
  award_year: number | null;
  category: string[] | null;
  full_text: string | null;
  metadata: Json | null;
  created_at: string;
}

export const PROPOSAL_SELECT_COLUMNS =
  "id, source, source_url, funder_name, funder_type, grant_program, award_amount, award_year, category, full_text, metadata, created_at";

export function deriveFunderBucket(source: string, funderType: string | null): FunderBucket | null {
  if (funderType === "Private Foundation") return "private_foundation";
  if (funderType === "Corporate Foundation") return "corporate_foundation";
  if (funderType === "Federal Government" || (FEDERAL_SOURCES as readonly string[]).includes(source)) {
    return "federal";
  }
  if (source === "PROPUBLICA_990") return "public_charity";
  return null;
}

interface FilterableQuery {
  or: (filter: string) => FilterableQuery;
  eq: (column: string, value: string) => FilterableQuery;
  in: (column: string, values: string[]) => FilterableQuery;
}

export function applyFunderBucketFilter<T extends FilterableQuery>(
  query: T,
  bucket: FunderBucket,
): T {
  switch (bucket) {
    case "federal":
      return query.or(
        `funder_type.eq.Federal Government,source.in.(${FEDERAL_SOURCES.join(",")})`,
      ) as T;
    case "private_foundation":
      return query.eq("funder_type", "Private Foundation") as T;
    case "corporate_foundation":
      return query.eq("funder_type", "Corporate Foundation") as T;
    case "public_charity":
      return query.eq("source", "PROPUBLICA_990") as T;
    case "community_foundation":
      // No live records classify this way yet (no community-foundation source
      // or funder_type value has ever been ingested) -- filter to an
      // impossible value so this returns an honest empty result rather than
      // silently ignoring the filter.
      return query.eq("funder_type", "__no_community_foundation_data__") as T;
    default:
      return query;
  }
}

export function applyDataSourceFilter<T extends FilterableQuery>(query: T, value: string): T {
  if (value === "federal_api") return query.in("source", [...FEDERAL_SOURCES]) as T;
  return query.eq("source", value) as T;
}

export function readMetadataField(metadata: Json | null, field: string): unknown {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return null;
  return (metadata as Record<string, unknown>)[field];
}

export function readMetaString(metadata: Json | null, field: string): string | null {
  const value = readMetadataField(metadata, field);
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

export function readMetaStringArray(metadata: Json | null, field: string): string[] {
  const value = readMetadataField(metadata, field);
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === "string");
}

export interface ProposalCard {
  id: string;
  source: string;
  sourceUrl: string | null;
  funderName: string | null;
  funderType: string | null;
  funderBucket: FunderBucket | null;
  title: string | null;
  awardAmount: number | null;
  awardYear: number | null;
  category: string[];
  nteeCode: string | null;
  organizationName: string | null;
  fullText: string | null;
  successFactors: string[];
  keywords: string[];
  // Not live yet (migration 106) -- always empty until that migration is
  // applied and scripts/backfill-intelligence-library-columns.ts runs.
  winningPhrases: string[];
  persuasiveElements: { element_type: string; why_it_works: string }[];
  recordKind: string | null;
  createdAt: string;
}

export function mapProposalRow(row: ProposalRow): ProposalCard {
  const nteeFromMetadata = readMetaString(row.metadata, "ntee_code");
  const nteeFromCategory = (row.category ?? []).find((c) => /^[A-Z]{1,3}[0-9]*$/.test(c)) ?? null;
  return {
    id: row.id,
    source: row.source,
    sourceUrl: row.source_url,
    funderName: row.funder_name,
    funderType: row.funder_type,
    funderBucket: deriveFunderBucket(row.source, row.funder_type),
    title: row.grant_program,
    awardAmount: row.award_amount,
    awardYear: row.award_year,
    category: row.category ?? [],
    nteeCode: nteeFromMetadata ?? nteeFromCategory,
    organizationName: readMetaString(row.metadata, "organization"),
    fullText: row.full_text,
    successFactors: readMetaStringArray(row.metadata, "success_factors"),
    keywords: readMetaStringArray(row.metadata, "keywords"),
    winningPhrases: [],
    persuasiveElements: [],
    recordKind: readMetaString(row.metadata, "record_kind"),
    createdAt: row.created_at,
  };
}

export interface ProposalFilters {
  q: string | null;
  ntee: string[] | null;
  funderBucket: FunderBucket | null;
  dataSource: string | null;
  funderName: string | null;
  minAmount: number | null;
  maxAmount: number | null;
  year: number | null;
  yearEarlier: boolean;
}

export function parseFiltersFromSearchParams(searchParams: URLSearchParams): ProposalFilters {
  const q = (searchParams.get("q") ?? searchParams.get("search"))?.trim().slice(0, 200) || null;

  const nteeParam = searchParams.get("ntee")?.trim().toUpperCase() || null;
  const ntee = nteeParam ? nteeParam.split(",").filter(Boolean) : null;

  const funderBucketParam = searchParams.get("funderBucket")?.trim() as FunderBucket | null;
  const funderBucket = FUNDER_BUCKET_OPTIONS.some((o) => o.value === funderBucketParam)
    ? (funderBucketParam as FunderBucket)
    : null;

  const dataSource = searchParams.get("source")?.trim() || null;
  const funderName = searchParams.get("funderName")?.trim() || null;

  const minAmountParam = searchParams.get("minAmount");
  const maxAmountParam = searchParams.get("maxAmount");
  const minAmount = minAmountParam !== null && minAmountParam !== "" ? Number(minAmountParam) : null;
  const maxAmount = maxAmountParam !== null && maxAmountParam !== "" ? Number(maxAmountParam) : null;

  const yearParam = searchParams.get("year");
  const yearEarlier = yearParam === "earlier";
  const year = yearParam && !yearEarlier ? parseInt(yearParam, 10) : null;

  return {
    q,
    ntee,
    funderBucket,
    dataSource,
    funderName,
    minAmount: minAmount !== null && Number.isFinite(minAmount) ? minAmount : null,
    maxAmount: maxAmount !== null && Number.isFinite(maxAmount) ? maxAmount : null,
    year: year !== null && Number.isFinite(year) ? year : null,
    yearEarlier,
  };
}

// PostgREST's .or()/.contains() filters use commas/parens/% as syntax --
// strip them so a search term can't break the filter expression.
export function sanitizeIlikeTerm(term: string): string {
  return term.replace(/[,()%]/g, "").trim();
}

export function applyProposalFilters(query: any, filters: ProposalFilters) {
  let q = query;
  if (filters.dataSource) {
    q = applyDataSourceFilter(q, filters.dataSource);
  }
  if (filters.funderBucket) {
    q = applyFunderBucketFilter(q, filters.funderBucket);
  }
  if (filters.ntee && filters.ntee.length > 0) {
    q = q.overlaps("category", filters.ntee);
  }
  if (filters.funderName) {
    q = q.eq("funder_name", filters.funderName);
  }
  if (filters.minAmount !== null) {
    q = q.gte("award_amount", filters.minAmount);
  }
  if (filters.maxAmount !== null) {
    q = q.lte("award_amount", filters.maxAmount);
  }
  if (filters.year !== null) {
    q = q.eq("award_year", filters.year);
  }
  if (filters.yearEarlier) {
    q = q.lt("award_year", 2020);
  }
  if (filters.q) {
    const term = sanitizeIlikeTerm(filters.q);
    if (term) {
      q = q.or(`grant_program.ilike.%${term}%,funder_name.ilike.%${term}%,full_text.ilike.%${term}%`);
    }
  }
  return q;
}

export interface FilteredStats {
  totalNarratives: number;
  avgAwardAmount: number | null;
  federalCount: number;
  foundationCount: number;
  corporateCount: number;
}

// Corpus is small (low thousands at most for the foreseeable term) -- compute
// filtered stats by pulling the classification-relevant columns for every
// matching row rather than standing up Postgres-side aggregate RPCs against a
// schema that's already one migration behind. Paginated, not a single
// `.limit(5000)` — see WGR-031 in test-evidence/_register/
// WIRING_GAP_REGISTER.md: PostgREST silently re-caps any request at
// db.max_rows (1000) regardless of the app's own higher `.limit()`, so this
// was live-reproduced computing avgAwardAmount from an arbitrary first-1000
// slice of 3,489 real rows -- a ~37x understatement of the real average.
export async function computeFilteredStats(
  supabase: ProposalsClient,
  filters: ProposalFilters,
): Promise<FilteredStats> {
  type StatsRow = { source: string; funder_type: string | null; award_amount: number | null };
  const rows = await selectAllPages<StatsRow>((from, to) => {
    let query = supabase
      .from("intelligence_funded_proposals")
      .select("source, funder_type, award_amount")
      .order("id", { ascending: true });
    query = applyProposalFilters(query, filters);
    return query.range(from, to) as unknown as PromiseLike<{ data: StatsRow[] | null; error: unknown }>;
  });
  let sum = 0;
  let amountCount = 0;
  let federalCount = 0;
  let foundationCount = 0;
  let corporateCount = 0;

  for (const row of rows) {
    const bucket = deriveFunderBucket(row.source, row.funder_type);
    if (bucket === "federal") federalCount++;
    if (bucket === "private_foundation" || bucket === "community_foundation") foundationCount++;
    if (bucket === "corporate_foundation") corporateCount++;
    if (row.award_amount !== null) {
      sum += row.award_amount;
      amountCount++;
    }
  }

  return {
    totalNarratives: rows.length,
    avgAwardAmount: amountCount > 0 ? sum / amountCount : null,
    federalCount,
    foundationCount,
    corporateCount,
  };
}
