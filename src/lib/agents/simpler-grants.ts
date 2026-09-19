// Simpler Grants Research Agent — polls the public Simpler.Grants.gov v1 API.
//
// Sends a POST search request for federal opportunities matching the supplied
// keywords. Deduplicates by name and url before inserting new records into the
// opportunities table.
//
// API KEY NOTE (corrected 2026-08-05): this file's original comment said "no
// API key required" -- that is no longer true. Confirmed live via a direct
// raw request: the real API now returns `401` with
// `WWW-Authenticate: ApiKey realm="Authentication Required"` -- a real API
// contract change (or this endpoint always required a key and the "no auth"
// assumption was wrong from the start; either way, it's required now). No
// `SIMPLER_GRANTS_API_KEY` value exists anywhere in this project -- this is
// not a dead/expired key, there was never a key configured at all. A real key
// needs to be obtained (register at https://simpler.grants.gov or wherever
// Simpler Grants issues API access) and set as `SIMPLER_GRANTS_API_KEY` in
// `.env.local`/Railway/Vercel before this agent can work again -- not
// fixable from code alone. The header name below (`X-Api-Key`) matches the
// `WWW-Authenticate: ApiKey` scheme's own naming but is UNVERIFIED against a
// real key (none was available to test with this session) -- confirm the
// exact expected header once a real key exists, adjust if wrong.
//
// Field mapping (task spec):
//   name           = opportunity_title
//   category       = government_grant
//   source         = simpler.grants.gov
//   source_type    = government_federal  (nearest valid DB enum value)
//
// WIRING NOTE (2026-08-04): NOT cron-scheduled — live-tested directly this
// session and it threw a real `401` from the Simpler.Grants.gov API despite
// this file's own header comment ("no API key required") and the public API's
// documented no-auth design. Root cause not diagnosed this session (out of
// scope — a live-test + wiring-decision pass, not a fix pass); flagging that
// the "no auth required" assumption above may be stale (API contract change)
// or something in the request is missing a now-required header. Do not add
// this to any cron schedule until the 401 is root-caused — an automated daily
// job that fails every single run is worse than manual-only.

import {
  AgentError,
  BaseAgent,
  type AgentExecution,
} from "@/lib/agents/base-agent";
import type { AgentType } from "@/types/agents";

const SIMPLER_GRANTS_URL =
  "https://api.simpler.grants.gov/v1/opportunities/search";

export interface SimplerGrantsInput {
  keywords: string[];
  pageSize?: number;
  pageOffset?: number;
}

export interface SimplerGrantsOpportunity {
  title: string;
  agency: string | null;
  opportunity_number: string | null;
  close_date: string | null;
  award_ceiling: number | null;
  award_floor: number | null;
  description: string | null;
  url: string | null;
  source: "simpler.grants.gov";
}

export interface SimplerGrantsResult {
  opportunities: SimplerGrantsOpportunity[];
  count: number;
  opportunitiesCreated: number;
}

// --- Raw API response shapes (all fields optional — API may omit any) --------

interface RawSummary {
  close_date?: unknown;
  award_ceiling?: unknown;
  award_floor?: unknown;
  summary_description?: unknown;
  opportunity_status?: unknown;
}

interface RawItem {
  opportunity_id?: unknown;
  opportunity_title?: unknown;
  opportunity_number?: unknown;
  agency_code?: unknown;
  agency_name?: unknown;
  summary?: RawSummary;
}

interface SimplerGrantsResponse {
  data?: unknown[];
  pagination_info?: { total_records?: unknown; total_pages?: unknown };
}

// --- Helpers -----------------------------------------------------------------

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

function truncate(val: unknown, maxLen: number): string | null {
  const s = toStr(val);
  if (!s) return null;
  return s.length > maxLen ? s.slice(0, maxLen) : s;
}

function normaliseDate(val: unknown): string | null {
  const s = toStr(val);
  if (!s) return null;
  // Accept YYYY-MM-DD and ISO timestamps
  const match = /^(\d{4}-\d{2}-\d{2})/.exec(s);
  return match ? (match[1] ?? null) : null;
}

function opportunityUrl(id: unknown): string | null {
  const idStr = toStr(id);
  if (!idStr) return null;
  return `https://simpler.grants.gov/opportunity/${idStr}`;
}

// --- Agent ------------------------------------------------------------------

export class SimplerGrantsResearchAgent extends BaseAgent<
  SimplerGrantsInput,
  SimplerGrantsResult
> {
  readonly agentType: AgentType = "simpler_grants_research";

  protected async execute(
    input: SimplerGrantsInput,
  ): Promise<AgentExecution<SimplerGrantsResult>> {
    const keywords = (input.keywords ?? []).map(String).filter(Boolean);
    if (keywords.length === 0) {
      throw new AgentError(
        "At least one keyword is required.",
        "no_keywords",
        400,
      );
    }

    const query = keywords.join(" ").trim();
    const pageSize = input.pageSize ?? 25;
    const pageOffset = input.pageOffset ?? 1;

    const requestBody = {
      query,
      filters: {
        opportunity_status: { one_of: ["posted", "forecasted"] },
      },
      pagination: { page_size: pageSize, page_offset: pageOffset },
    };

    const apiKey = process.env.SIMPLER_GRANTS_API_KEY;
    if (!apiKey) {
      throw new AgentError(
        "SIMPLER_GRANTS_API_KEY is not set — the Simpler Grants API now requires an API key (confirmed live 2026-08-05); no key has been obtained yet.",
        "missing_api_key",
        503,
      );
    }

    let rawBody: SimplerGrantsResponse;
    try {
      const response = await fetch(SIMPLER_GRANTS_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          "X-Api-Key": apiKey,
        },
        body: JSON.stringify(requestBody),
        signal: AbortSignal.timeout(30_000),
      });

      if (!response.ok) {
        throw new AgentError(
          `Simpler Grants API returned HTTP ${response.status}.`,
          "api_error",
          502,
        );
      }

      rawBody = (await response.json()) as SimplerGrantsResponse;
    } catch (err) {
      if (err instanceof AgentError) throw err;
      throw new AgentError(
        `Simpler Grants request failed: ${err instanceof Error ? err.message : "network error"}`,
        "fetch_failed",
        502,
      );
    }

    const items = Array.isArray(rawBody.data) ? rawBody.data : [];

    const opportunities: SimplerGrantsOpportunity[] = items.map((raw) => {
      const item = raw as RawItem;
      const summary: RawSummary = item.summary ?? {};
      return {
        title: toStr(item.opportunity_title),
        agency: toStr(item.agency_name || item.agency_code) || null,
        opportunity_number: toStr(item.opportunity_number) || null,
        close_date: normaliseDate(summary.close_date),
        award_ceiling: toNumber(summary.award_ceiling),
        award_floor: toNumber(summary.award_floor),
        description: truncate(summary.summary_description, 2000),
        url: opportunityUrl(item.opportunity_id),
        source: "simpler.grants.gov" as const,
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

      // Provenance requirement (AR-17.6): url is the only stored source this
      // agent has for any enriched field below.
      if (!opp.url) continue;

      const row: Record<string, unknown> = {
        organization_id: this.organizationId,
        name: opp.title,
        category: "government_grant",
        source: "simpler.grants.gov",
        source_type: "government_federal",
        status: "open",
        url: opp.url,
      };

      if (opp.description) row.description = opp.description;
      if (opp.close_date) row.deadline = opp.close_date;
      if (opp.award_ceiling !== null) row.amount_max = opp.award_ceiling;
      if (opp.award_floor !== null) row.amount_min = opp.award_floor;

      const { error } = await this.client.from("opportunities").insert(row);
      if (!error) opportunitiesCreated++;
    }

    return {
      data: { opportunities, count: opportunities.length, opportunitiesCreated },
      outputSummary: `Simpler Grants search for "${query}" found ${opportunities.length} opportunity(ies); ${opportunitiesCreated} new record(s) created.`,
      itemsFound: opportunities.length,
      itemsProcessed: opportunitiesCreated,
      tokensUsed: 0,
    };
  }
}
