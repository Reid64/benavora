// Grants.gov Research Agent — AGENTS.md Agent 15.
//
// Polls the public Grants.gov API (no auth required) for federal grant
// opportunities matching search profile keywords (BEHAVIORAL_CONTRACTS §17).
//
// Per-run behaviour:
//   1. Runs multiple keyword searches (housing-focused phrases + any caller-
//      supplied keywords) to maximise coverage — typically 150+ results vs
//      the old single-query 25.
//   2. Deduplicates by oppNumber in memory across all searches before touching
//      the database.
//   3. Parses synopsis.awardCeiling/Floor and synopsis.closeDate (MMDDYYYY)
//      from the nested synopsis object where the API actually puts them.
//   4. Deduplicates against existing opportunities by name OR url before
//      inserting new records into the opportunities table.
//   5. Returns the full list of discovered opportunities and a count of newly
//      created rows so callers can poll without fetching the whole table.
//
// Error handling: per-query HTTP failures are skipped (non-fatal). A total
// fetch failure wraps in AgentError so BaseAgent can log status="failed".

import {
  AgentError,
  BaseAgent,
  type AgentExecution,
  type BaseAgentOptions,
} from "@/lib/agents/base-agent";
import type { AgentType } from "@/types/agents";

const GRANTS_GOV_URL =
  "https://apply07.grants.gov/grantsws/rest/opportunities/search/";

// Second pass: the per-opportunity detail endpoint returns a fuller object than
// the listing (full description, eligibility, geographic scope, documents).
const GRANTS_GOV_DETAIL_URL =
  "https://apply07.grants.gov/grantsws/rest/opportunity/details";
// Cap detail fetches per run. A wall-clock budget also stops the pass early so
// the agent stays within BaseAgent's hard run timeout even if a fetch is slow.
const MAX_DETAIL_FETCHES = 50;
const DETAIL_DELAY_MS = 500;
// With the agent's 270s timeout, 50 fetches (~1s each incl. delay) finish well
// inside this budget; it remains a safety net against unusually slow responses.
const DETAIL_TIME_BUDGET_MS = 220_000;

// Six housing-focused keyword phrases run as separate searches to maximise
// coverage. Each returns up to 25 hits, giving ~150 candidates before dedup.
const HOUSING_KEYWORD_QUERIES = [
  "affordable housing rural Texas",
  "transitional housing reentry recovery",
  "homelessness prevention emergency shelter",
  "community development block grant housing",
  "veterans housing rural",
  "down payment assistance first time homebuyer",
];

export interface GrantsGovInput {
  keywords: string[];
  categories?: string[];
  dateRange?: { from?: string; to?: string };
}

export interface OpportunityDocument {
  title: string;
  url: string;
}

export interface GrantsGovOpportunity {
  title: string;
  agency: string;
  opportunity_number: string;
  close_date: string | null;
  award_ceiling: number | null;
  award_floor: number | null;
  description: string | null;
  eligibility_requirements: string | null;
  geographic_restrictions: string | null;
  opportunity_documents: OpportunityDocument[];
  url: string | null;
  source: "grants.gov";
}

export interface GrantsGovResult {
  opportunities: GrantsGovOpportunity[];
  count: number;
  opportunitiesCreated: number;
}

// The API nests financial and date fields inside synopsis.
interface RawSynopsis {
  awardCeiling?: unknown;
  awardFloor?: unknown;
  closeDate?: unknown;
  postDate?: unknown;
  archiveDate?: unknown;
  description?: unknown;
}

interface RawHit {
  title?: unknown;
  id?: unknown;
  agency?: unknown;
  agencyName?: unknown;
  number?: unknown;
  oppNumber?: unknown;
  synopsis?: RawSynopsis;
  description?: unknown;
}

interface GrantsGovResponse {
  oppHits?: RawHit[];
  opportunities?: RawHit[];
  items?: RawHit[];
}

// Shape of the per-opportunity detail response (parsed defensively).
interface RawDetailSynopsis {
  description?: unknown;
  eligibilityDesc?: unknown;
  applicantTypes?: unknown;
  awardCeiling?: unknown;
  awardFloor?: unknown;
  closeDate?: unknown;
  postDate?: unknown;
  archiveDate?: unknown;
  cfda?: unknown;
  costSharing?: unknown;
}

interface RawDetailDocument {
  title?: unknown;
  fileName?: unknown;
  url?: unknown;
  link?: unknown;
}

interface RawDetail {
  synopsis?: RawDetailSynopsis;
  geographicScope?: unknown;
  documents?: RawDetailDocument[];
  opportunityDocuments?: RawDetailDocument[];
}

/** Merged values from the detail endpoint, used to enrich the listing data. */
interface DetailData {
  description: string | null;
  eligibility: string | null;
  geographic: string | null;
  awardCeiling: number | null;
  awardFloor: number | null;
  closeDate: string | null;
  documents: OpportunityDocument[];
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Parse "MM/DD/YYYY" or compact "MMDDYYYY" dates to ISO-8601 (YYYY-MM-DD).
// The Grants.gov synopsis.closeDate field uses the compact 8-digit form.
function parseMDYDate(raw: string): string | null {
  const trimmed = raw.trim();

  // "MM/DD/YYYY" with slashes
  const slash = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(trimmed);
  if (slash) {
    const month = slash[1] ?? "01";
    const day = slash[2] ?? "01";
    const year = slash[3] ?? "1970";
    return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
  }

  // "MMDDYYYY" compact (Grants.gov synopsis.closeDate)
  const compact = /^(\d{2})(\d{2})(\d{4})$/.exec(trimmed);
  if (compact) {
    const month = compact[1] ?? "01";
    const day = compact[2] ?? "01";
    const year = compact[3] ?? "1970";
    return `${year}-${month}-${day}`;
  }

  return null;
}

function toStr(val: unknown): string {
  if (typeof val === "string") return val.trim();
  if (val === null || val === undefined) return "";
  return String(val).trim();
}

function toNumber(val: unknown): number | null {
  if (val === null || val === undefined || val === "") return null;
  const n = Number(val);
  return isFinite(n) ? n : null;
}

// Convert 0 or non-positive amounts to null (0 means "not specified").
function toPositiveNumber(val: unknown): number | null {
  const n = toNumber(val);
  return n !== null && n > 0 ? n : null;
}

function truncate(val: unknown, maxLen: number): string | null {
  const s = toStr(val);
  if (!s) return null;
  return s.length > maxLen ? s.slice(0, maxLen) : s;
}

function normaliseCloseDate(val: unknown): string | null {
  const raw = toStr(val);
  if (!raw) return null;
  const mdy = parseMDYDate(raw);
  if (mdy) return mdy;
  if (/^\d{4}-\d{2}-\d{2}/.test(raw)) return raw.slice(0, 10);
  return null;
}

function extractHits(body: GrantsGovResponse): RawHit[] {
  if (Array.isArray(body.oppHits)) return body.oppHits;
  if (Array.isArray(body.opportunities)) return body.opportunities;
  if (Array.isArray(body.items)) return body.items;
  return [];
}

function isHudAgency(agencyName: string): boolean {
  const lower = agencyName.toLowerCase();
  return lower.includes("hud") || lower.includes("housing and urban development");
}

function hitKey(hit: RawHit): string {
  const oppNum = toStr(hit.oppNumber ?? hit.number);
  if (oppNum) return `num:${oppNum}`;
  const title = toStr(hit.title);
  return title ? `title:${title}` : "";
}

export class GrantsGovResearchAgent extends BaseAgent<
  GrantsGovInput,
  GrantsGovResult
> {
  readonly agentType: AgentType = "grants_gov_research";

  constructor(options: BaseAgentOptions) {
    // The two-pass detail fetch needs far more than the 60s default. Cap at 270s
    // to leave a 30s buffer under the 300s Vercel function limit.
    super({ ...options, timeoutMs: options.timeoutMs ?? 270_000 });
  }

  protected async execute(
    input: GrantsGovInput,
  ): Promise<AgentExecution<GrantsGovResult>> {
    // Build query list: always run all housing-focused phrases; append the
    // caller's keywords as one extra search if they differ from the defaults.
    const userQuery = input.keywords.filter(Boolean).join(" ").trim();
    const queries: string[] = [...HOUSING_KEYWORD_QUERIES];
    if (
      userQuery &&
      !HOUSING_KEYWORD_QUERIES.some((q) =>
        q.toLowerCase().includes(userQuery.toLowerCase()),
      )
    ) {
      queries.push(userQuery);
    }

    // Require at least one query.
    const effectiveQueries = queries.filter(Boolean);
    if (effectiveQueries.length === 0) {
      throw new AgentError(
        "At least one keyword is required.",
        "no_keywords",
        400,
      );
    }

    // Run each query and collect hits, deduplicating by oppNumber in memory.
    const allHitsMap = new Map<string, RawHit>();

    for (const keyword of effectiveQueries) {
      const requestBody: Record<string, unknown> = {
        keyword,
        oppStatuses: "forecasted|posted",
        rows: 25,
        startRecordNum: 0,
      };

      if (input.categories?.length) {
        requestBody.fundingCategories = input.categories.join("|");
      }
      if (input.dateRange?.from) {
        requestBody.postDateFrom = input.dateRange.from;
      }
      if (input.dateRange?.to) {
        requestBody.postDateTo = input.dateRange.to;
      }

      try {
        const response = await fetch(GRANTS_GOV_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(requestBody),
          signal: AbortSignal.timeout(30_000),
        });

        if (!response.ok) continue;

        const rawBody = (await response.json()) as GrantsGovResponse;
        for (const hit of extractHits(rawBody)) {
          const key = hitKey(hit);
          if (key && !allHitsMap.has(key)) {
            allHitsMap.set(key, hit);
          }
        }
      } catch {
        // Non-fatal: skip this keyword on network/parse errors.
      }
    }

    // Second pass: enrich each unique hit with the fuller detail object before
    // inserting. Rate-limited (500ms between fetches), capped at 50 fetches and
    // a wall-clock budget so the agent stays within its run timeout.
    const uniqueHits = Array.from(allHitsMap.values());
    const opportunities: GrantsGovOpportunity[] = [];
    let detailFetches = 0;
    const detailStart = Date.now();

    for (const hit of uniqueHits) {
      const synopsis: RawSynopsis = hit.synopsis ?? {};
      const oppNum = toStr(hit.oppNumber ?? hit.number);
      const hitId = toStr(hit.id);
      const urlId = oppNum || hitId;

      // Listing-derived values (the fallback when no detail is fetched).
      let description = truncate(synopsis.description ?? hit.description, 2000);
      let awardCeiling = toPositiveNumber(synopsis.awardCeiling);
      let awardFloor = toPositiveNumber(synopsis.awardFloor);
      let closeDate = normaliseCloseDate(synopsis.closeDate);
      let eligibility: string | null = null;
      let geographic: string | null = null;
      let documents: OpportunityDocument[] = [];

      const withinBudget =
        detailFetches < MAX_DETAIL_FETCHES &&
        Date.now() - detailStart < DETAIL_TIME_BUDGET_MS;

      if (hitId && withinBudget) {
        const detail = await this.fetchDetail(hitId);
        detailFetches++;
        if (detail) {
          // Use the detail description if it is longer than the listing one.
          if (
            detail.description &&
            (!description || detail.description.length > description.length)
          ) {
            description = truncate(detail.description, 4000);
          }
          // Use detail amounts when the listing did not specify them (0/null).
          if (awardCeiling === null && detail.awardCeiling !== null) {
            awardCeiling = detail.awardCeiling;
          }
          if (awardFloor === null && detail.awardFloor !== null) {
            awardFloor = detail.awardFloor;
          }
          if (!closeDate && detail.closeDate) closeDate = detail.closeDate;
          if (detail.eligibility) eligibility = detail.eligibility;
          if (detail.geographic) geographic = detail.geographic;
          if (detail.documents.length > 0) documents = detail.documents;
        }
        // 500ms between detail fetches to avoid rate limiting.
        await delay(DETAIL_DELAY_MS);
      }

      opportunities.push({
        title: toStr(hit.title),
        agency: toStr(hit.agencyName ?? hit.agency),
        opportunity_number: oppNum,
        close_date: closeDate,
        award_ceiling: awardCeiling,
        award_floor: awardFloor,
        description,
        eligibility_requirements: eligibility,
        geographic_restrictions: geographic,
        opportunity_documents: documents,
        url: urlId
          ? `https://www.grants.gov/search-grants?opp=${urlId}`
          : null,
        source: "grants.gov" as const,
      });
    }

    let opportunitiesCreated = 0;

    for (const opp of opportunities) {
      if (!opp.title) continue;

      // Dedup by name
      const { data: byName } = await this.client
        .from("opportunities")
        .select("id")
        .eq("organization_id", this.organizationId)
        .eq("name", opp.title)
        .maybeSingle();
      if (byName) continue;

      // Dedup by url
      if (opp.url) {
        const { data: byUrl } = await this.client
          .from("opportunities")
          .select("id")
          .eq("organization_id", this.organizationId)
          .eq("url", opp.url)
          .maybeSingle();
        if (byUrl) continue;
      }

      const category = isHudAgency(opp.agency)
        ? ("housing_grant" as const)
        : ("government_grant" as const);

      const row: Record<string, unknown> = {
        organization_id: this.organizationId,
        name: opp.title,
        category,
        source: "grants.gov",
        source_type: "government_federal",
        status: "open",
      };

      if (opp.description) row.description = opp.description;
      if (opp.close_date) row.deadline = opp.close_date;
      if (opp.award_ceiling !== null) row.amount_max = opp.award_ceiling;
      if (opp.award_floor !== null) row.amount_min = opp.award_floor;
      if (opp.url) row.url = opp.url;
      if (opp.eligibility_requirements) {
        row.eligibility_requirements = opp.eligibility_requirements;
      }
      if (opp.geographic_restrictions) {
        row.geographic_restrictions = opp.geographic_restrictions;
      }
      if (opp.opportunity_documents.length > 0) {
        row.opportunity_documents = opp.opportunity_documents;
      }

      const { error } = await this.client
        .from("opportunities")
        .insert(row);

      if (!error) opportunitiesCreated++;
    }

    const queryLabel =
      effectiveQueries.length === 1
        ? `"${effectiveQueries[0]}"`
        : `${effectiveQueries.length} keyword queries`;

    return {
      data: { opportunities, count: opportunities.length, opportunitiesCreated },
      outputSummary: `Grants.gov search across ${queryLabel} found ${opportunities.length} unique opportunity(ies); ${opportunitiesCreated} new record(s) created.`,
      itemsFound: opportunities.length,
      itemsProcessed: opportunitiesCreated,
      tokensUsed: 0,
    };
  }

  /**
   * Fetch the per-opportunity detail object and extract the fuller fields.
   * Returns null on any failure (non-fatal - the listing data is used instead).
   */
  private async fetchDetail(oppId: string): Promise<DetailData | null> {
    try {
      const response = await fetch(
        `${GRANTS_GOV_DETAIL_URL}?oppId=${encodeURIComponent(oppId)}`,
        {
          method: "GET",
          headers: { Accept: "application/json" },
          signal: AbortSignal.timeout(15_000),
        },
      );
      if (!response.ok) return null;

      const body = (await response.json()) as RawDetail;
      const synopsis: RawDetailSynopsis = body.synopsis ?? {};
      const rawDocs = Array.isArray(body.documents)
        ? body.documents
        : Array.isArray(body.opportunityDocuments)
          ? body.opportunityDocuments
          : [];
      const documents: OpportunityDocument[] = rawDocs
        .map((d) => ({
          title: toStr(d?.title ?? d?.fileName),
          url: toStr(d?.url ?? d?.link),
        }))
        .filter((d) => d.url !== "");

      return {
        description: toStr(synopsis.description) || null,
        eligibility: toStr(synopsis.eligibilityDesc) || null,
        geographic: toStr(body.geographicScope) || null,
        awardCeiling: toPositiveNumber(synopsis.awardCeiling),
        awardFloor: toPositiveNumber(synopsis.awardFloor),
        closeDate: normaliseCloseDate(synopsis.closeDate),
        documents,
      };
    } catch {
      return null;
    }
  }
}
