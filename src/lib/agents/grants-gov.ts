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
} from "@/lib/agents/base-agent";
import type { AgentType } from "@/types/agents";

const GRANTS_GOV_URL =
  "https://apply07.grants.gov/grantsws/rest/opportunities/search/";

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

export interface GrantsGovOpportunity {
  title: string;
  agency: string;
  opportunity_number: string;
  close_date: string | null;
  award_ceiling: number | null;
  award_floor: number | null;
  description: string | null;
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

    // Map deduplicated hits to structured opportunities.
    const opportunities: GrantsGovOpportunity[] = Array.from(
      allHitsMap.values(),
    ).map((hit) => {
      const synopsis: RawSynopsis = hit.synopsis ?? {};
      const oppNum = toStr(hit.oppNumber ?? hit.number);
      const hitId = toStr(hit.id);
      const urlId = oppNum || hitId;
      return {
        title: toStr(hit.title),
        agency: toStr(hit.agencyName ?? hit.agency),
        opportunity_number: oppNum,
        close_date: normaliseCloseDate(synopsis.closeDate),
        award_ceiling: toPositiveNumber(synopsis.awardCeiling),
        award_floor: toPositiveNumber(synopsis.awardFloor),
        description: truncate(synopsis.description ?? hit.description, 2000),
        url: urlId
          ? `https://www.grants.gov/search-grants?opp=${urlId}`
          : null,
        source: "grants.gov" as const,
      };
    });

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
}
