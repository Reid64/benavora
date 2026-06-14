// Grants.gov Research Agent — AGENTS.md Agent 15.
//
// Polls the public Grants.gov API (no auth required) for federal grant
// opportunities matching search profile keywords (BEHAVIORAL_CONTRACTS §17).
//
// Per-run behaviour:
//   1. Builds a POST request to the Grants.gov search endpoint with keyword,
//      optional funding categories, and an optional posted-date range.
//   2. Parses the response array of hits into structured GrantsGovOpportunity
//      objects, normalising the MM/DD/YYYY close dates to ISO-8601.
//   3. Deduplicates against existing opportunities by name + source before
//      inserting new records into the opportunities table.
//   4. Returns the full list of discovered opportunities and a count of newly
//      created rows so callers can poll without fetching the whole table.
//
// Error handling: HTTP failures and fetch timeouts are wrapped in AgentError so
// BaseAgent can log status="failed" and surface a typed error to route handlers.

import {
  AgentError,
  BaseAgent,
  type AgentExecution,
} from "@/lib/agents/base-agent";
import type { AgentType } from "@/types/agents";

const GRANTS_GOV_URL =
  "https://www.grants.gov/grantsws/rest/opportunities/search/";

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
  source: "grants_gov";
}

export interface GrantsGovResult {
  opportunities: GrantsGovOpportunity[];
  count: number;
  opportunitiesCreated: number;
}

interface RawHit {
  title?: unknown;
  agency?: unknown;
  agencyName?: unknown;
  number?: unknown;
  oppNumber?: unknown;
  closeDate?: unknown;
  closeDateStr?: unknown;
  awardCeiling?: unknown;
  awardFloor?: unknown;
  synopsis?: unknown;
  description?: unknown;
}

interface GrantsGovResponse {
  oppHits?: RawHit[];
  opportunities?: RawHit[];
  items?: RawHit[];
}

// Parse "MM/DD/YYYY" dates from the Grants.gov API to ISO-8601 (YYYY-MM-DD).
// Explicitly defaults match groups to prevent passing undefined to string ops.
function parseMDYDate(raw: string): string | null {
  const match = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(raw.trim());
  if (!match) return null;
  const month = match[1] ?? "01";
  const day = match[2] ?? "01";
  const year = match[3] ?? "1970";
  return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
}

function toNumber(val: unknown): number | null {
  if (val === null || val === undefined || val === "") return null;
  const n = Number(val);
  return isFinite(n) ? n : null;
}

function toStr(val: unknown): string {
  if (typeof val === "string") return val.trim();
  if (val === null || val === undefined) return "";
  return String(val).trim();
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

export class GrantsGovResearchAgent extends BaseAgent<
  GrantsGovInput,
  GrantsGovResult
> {
  readonly agentType: AgentType = "grants_gov_research";

  protected async execute(
    input: GrantsGovInput,
  ): Promise<AgentExecution<GrantsGovResult>> {
    const keyword = input.keywords.filter(Boolean).join(" ").trim();
    if (!keyword) {
      throw new AgentError(
        "At least one keyword is required.",
        "no_keywords",
        400,
      );
    }

    const requestBody: Record<string, unknown> = {
      keyword,
      oppStatuses: "forecasted|posted",
      rows: 25,
      startRecord: 0,
      sortBy: "openDate|desc",
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

    let rawBody: GrantsGovResponse;
    try {
      const response = await fetch(GRANTS_GOV_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestBody),
        signal: AbortSignal.timeout(30_000),
      });

      if (!response.ok) {
        throw new AgentError(
          `Grants.gov API returned HTTP ${response.status}.`,
          "api_error",
          502,
        );
      }

      rawBody = (await response.json()) as GrantsGovResponse;
    } catch (err) {
      if (err instanceof AgentError) throw err;
      throw new AgentError(
        `Grants.gov request failed: ${err instanceof Error ? err.message : "network error"}`,
        "fetch_failed",
        502,
      );
    }

    const hits = extractHits(rawBody);

    const opportunities: GrantsGovOpportunity[] = hits.map((hit) => ({
      title: toStr(hit.title),
      agency: toStr(hit.agencyName ?? hit.agency),
      opportunity_number: toStr(hit.number ?? hit.oppNumber),
      close_date: normaliseCloseDate(hit.closeDate ?? hit.closeDateStr),
      award_ceiling: toNumber(hit.awardCeiling),
      award_floor: toNumber(hit.awardFloor),
      description: toStr(hit.synopsis ?? hit.description) || null,
      source: "grants_gov" as const,
    }));

    let opportunitiesCreated = 0;

    for (const opp of opportunities) {
      if (!opp.title) continue;

      // Dedup: skip if this org already has an opportunity with the same name
      // from grants_gov (AGENTS.md Agent 15 deduplication rule).
      const { data: existing } = await this.client
        .from("opportunities")
        .select("id")
        .eq("organization_id", this.organizationId)
        .eq("name", opp.title)
        .eq("source", "grants_gov")
        .maybeSingle();

      if (existing) continue;

      const row: Record<string, unknown> = {
        organization_id: this.organizationId,
        name: opp.title,
        category: "government_grant",
        source: "grants_gov",
        source_type: "government_federal",
        status: "open",
      };

      if (opp.description) row.description = opp.description;
      if (opp.close_date) row.deadline = opp.close_date;
      if (opp.award_ceiling !== null) row.amount_max = opp.award_ceiling;
      if (opp.award_floor !== null) row.amount_min = opp.award_floor;

      const { error } = await this.client
        .from("opportunities")
        .insert(row);

      if (!error) opportunitiesCreated++;
    }

    return {
      data: { opportunities, count: opportunities.length, opportunitiesCreated },
      outputSummary: `Grants.gov search for "${keyword}" found ${opportunities.length} opportunity(ies); ${opportunitiesCreated} new record(s) created.`,
      itemsFound: opportunities.length,
      itemsProcessed: opportunitiesCreated,
      tokensUsed: 0,
    };
  }
}
