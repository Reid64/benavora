// SAM.gov Research Agent — AGENTS.md Agent 16.
//
// Polls the SAM.gov federal opportunities API for grant-type records matching
// search profile keywords (BEHAVIORAL_CONTRACTS §18).
//
// Per-run behaviour:
//   1. Builds a GET request to the SAM.gov v2/search endpoint using the
//      caller-supplied API key (retrieved from integration_keys by the route).
//   2. Filters results to grant-type opportunities (ptype=g) and post-filters
//      the response to drop pure contract records.
//   3. Deduplicates against existing opportunities by name + source before
//      inserting new records into the opportunities table.
//   4. Returns the full list of discovered opportunities plus creation counts.
//
// Key contract (BEHAVIORAL_CONTRACTS §18): missing or invalid API key skips
// the run with a log message rather than surfacing an error to end users.

import {
  AgentError,
  BaseAgent,
  type AgentExecution,
} from "@/lib/agents/base-agent";
import type { AgentType } from "@/types/agents";

const SAM_GOV_URL =
  "https://api.sam.gov/prod/opportunities/v2/search";

// Opportunity types that are grant-related (not pure contracts).
const GRANT_TYPES = new Set(["g", "k", "s", "i"]);

export interface SamGovInput {
  /** Plaintext (already-decrypted) SAM.gov API key. */
  apiKey: string;
  keywords: string[];
  postedFrom?: string;
  postedTo?: string;
}

export interface SamGovOpportunity {
  title: string;
  agency: string;
  solicitation_number: string;
  type: string;
  posted_date: string | null;
  response_deadline: string | null;
  description_url: string | null;
  source: "sam_gov";
}

export interface SamGovResult {
  opportunities: SamGovOpportunity[];
  count: number;
  opportunitiesCreated: number;
}

interface RawOpportunity {
  title?: unknown;
  solicitationNumber?: unknown;
  noticeId?: unknown;
  type?: unknown;
  baseType?: unknown;
  postedDate?: unknown;
  responseDeadLine?: unknown;
  description?: unknown;
  fullParentPathName?: unknown;
  organizationHierarchy?: unknown;
}

interface SamGovResponse {
  totalRecords?: unknown;
  opportunitiesData?: RawOpportunity[];
  data?: RawOpportunity[];
}

function toStr(val: unknown): string {
  if (typeof val === "string") return val.trim();
  if (val === null || val === undefined) return "";
  return String(val).trim();
}

// SAM.gov dates arrive as ISO strings ("2025-03-01T23:59:00-05:00") or
// "YYYY-MM-DD". Extract the date portion only.
function normaliseDate(val: unknown): string | null {
  const raw = toStr(val);
  if (!raw) return null;
  const match = /^(\d{4}-\d{2}-\d{2})/.exec(raw);
  return match?.[1] ?? null;
}

function extractAgency(hit: RawOpportunity): string {
  const path = toStr(hit.fullParentPathName);
  if (path) {
    // Path format: "GRANDPARENT.PARENT.AGENCY" — take the last segment.
    const parts = path.split(".");
    return parts[parts.length - 1]?.trim() ?? path;
  }
  if (Array.isArray(hit.organizationHierarchy)) {
    const orgs = hit.organizationHierarchy as Array<{ name?: unknown }>;
    const last = orgs[orgs.length - 1];
    return toStr(last?.name);
  }
  return "";
}

function extractHits(body: SamGovResponse): RawOpportunity[] {
  if (Array.isArray(body.opportunitiesData)) return body.opportunitiesData;
  if (Array.isArray(body.data)) return body.data;
  return [];
}

export class SamGovResearchAgent extends BaseAgent<SamGovInput, SamGovResult> {
  readonly agentType: AgentType = "sam_gov_research";

  protected async execute(
    input: SamGovInput,
  ): Promise<AgentExecution<SamGovResult>> {
    const keyword = input.keywords.filter(Boolean).join(" ").trim();
    if (!keyword) {
      throw new AgentError(
        "At least one keyword is required.",
        "no_keywords",
        400,
      );
    }

    if (!input.apiKey) {
      throw new AgentError(
        "SAM.gov API key is required.",
        "key_missing",
        400,
      );
    }

    const params = new URLSearchParams({
      api_key: input.apiKey,
      keyword,
      limit: "25",
      ptype: "g", // grant opportunities only (server-side filter)
    });
    if (input.postedFrom) params.set("postedFrom", input.postedFrom);
    if (input.postedTo) params.set("postedTo", input.postedTo);

    let rawBody: SamGovResponse;
    try {
      const response = await fetch(`${SAM_GOV_URL}?${params.toString()}`, {
        method: "GET",
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(30_000),
      });

      if (response.status === 403 || response.status === 401) {
        throw new AgentError(
          "SAM.gov API key is invalid or expired.",
          "key_invalid",
          401,
        );
      }

      if (!response.ok) {
        throw new AgentError(
          `SAM.gov API returned HTTP ${response.status}.`,
          "api_error",
          502,
        );
      }

      rawBody = (await response.json()) as SamGovResponse;
    } catch (err) {
      if (err instanceof AgentError) throw err;
      throw new AgentError(
        `SAM.gov request failed: ${err instanceof Error ? err.message : "network error"}`,
        "fetch_failed",
        502,
      );
    }

    const hits = extractHits(rawBody);

    // Post-filter: keep only grant-type entries in case ptype param is ignored.
    const grantHits = hits.filter((h) => {
      const t = toStr(h.type ?? h.baseType).toLowerCase();
      return !t || GRANT_TYPES.has(t);
    });

    const opportunities: SamGovOpportunity[] = grantHits.map((hit) => ({
      title: toStr(hit.title),
      agency: extractAgency(hit),
      solicitation_number: toStr(hit.solicitationNumber ?? hit.noticeId),
      type: toStr(hit.type ?? hit.baseType),
      posted_date: normaliseDate(hit.postedDate),
      response_deadline: normaliseDate(hit.responseDeadLine),
      description_url: toStr(hit.description) || null,
      source: "sam_gov" as const,
    }));

    let opportunitiesCreated = 0;

    for (const opp of opportunities) {
      if (!opp.title) continue;

      // Dedup: skip if this org already has an opportunity with the same name
      // from sam_gov (AGENTS.md Agent 16 deduplication rule).
      const { data: existing } = await this.client
        .from("opportunities")
        .select("id")
        .eq("organization_id", this.organizationId)
        .eq("name", opp.title)
        .eq("source", "sam_gov")
        .maybeSingle();

      if (existing) continue;

      const row: Record<string, unknown> = {
        organization_id: this.organizationId,
        name: opp.title,
        category: "government_grant",
        source: "sam_gov",
        source_type: "government_federal",
        status: "open",
      };

      if (opp.response_deadline) row.deadline = opp.response_deadline;
      if (opp.description_url) row.description = opp.description_url;

      const { error } = await this.client.from("opportunities").insert(row);

      if (!error) opportunitiesCreated++;
    }

    return {
      data: { opportunities, count: opportunities.length, opportunitiesCreated },
      outputSummary: `SAM.gov search for "${keyword}" found ${opportunities.length} grant opportunity(ies); ${opportunitiesCreated} new record(s) created.`,
      itemsFound: opportunities.length,
      itemsProcessed: opportunitiesCreated,
      tokensUsed: 0,
    };
  }
}
