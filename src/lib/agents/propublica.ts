// ProPublica 990 Mining Agent — AGENTS.md Agent 17.
//
// Queries the ProPublica Nonprofit Explorer API (no auth required) to mine
// IRS 990 and 990-PF filing data for nonprofits. Supports lookup by EIN or
// free-text organization name search.
//
// Per-run behaviour:
//   1. If an EIN is supplied: fetches the organization record directly from the
//      /organizations/{ein}.json endpoint.
//   2. If a query is supplied: searches ProPublica for matching orgs (up to 5),
//      then fetches details for each with a 1-second inter-request delay.
//   3. Extracts financial data from filings_with_data: revenue, expenses,
//      assets, grants paid, and filing year for up to 3 fiscal years
//      (BEHAVIORAL_CONTRACTS §19).
//   4. Returns structured filing data for the caller.
//
// Rate limit: self-imposed 1 request/second (BEHAVIORAL_CONTRACTS §19).
// No API key or authentication required.

import {
  AgentError,
  BaseAgent,
  type AgentExecution,
} from "@/lib/agents/base-agent";
import type { AgentType } from "@/types/agents";

const PROPUBLICA_BASE = "https://projects.propublica.org/nonprofits/api/v2";
const MAX_FILING_YEARS = 3;
const MAX_ORG_RESULTS = 5;

export interface ProPublicaInput {
  /** IRS EIN (with or without dashes). Takes precedence over query. */
  ein?: string;
  /** Free-text search — organization name or keyword. */
  query?: string;
  /** Two-letter US state code to narrow search results. */
  state?: string;
}

export interface ProPublicaFiling {
  year: number;
  total_revenue: number | null;
  total_expenses: number | null;
  total_assets: number | null;
  grants_paid: number | null;
  filing_url: string | null;
}

export interface ProPublicaOrg {
  ein: string;
  name: string;
  city: string | null;
  state: string | null;
  ntee_code: string | null;
  filings: ProPublicaFiling[];
}

export interface ProPublicaResult {
  organizations: ProPublicaOrg[];
  organizations_found: number;
}

// --- Raw API response shapes (all fields optional — API may omit any) -------

interface RawFiling {
  tax_prd_yr?: unknown;
  totrevenue?: unknown;
  totexpns?: unknown;
  totnetassets?: unknown;
  totgrnts?: unknown;
  pdf_url?: unknown;
}

interface RawOrgDetail {
  ein?: unknown;
  name?: unknown;
  city?: unknown;
  state?: unknown;
  ntee_code?: unknown;
}

interface RawOrgResponse {
  organization?: RawOrgDetail;
  filings_with_data?: unknown[];
}

interface RawSearchOrg {
  ein?: unknown;
  name?: unknown;
}

interface RawSearchResponse {
  organizations?: unknown[];
}

// --- Helpers -----------------------------------------------------------------

function toNum(val: unknown): number | null {
  if (val === null || val === undefined || val === "") return null;
  const n = Number(val);
  return isFinite(n) ? n : null;
}

function toStr(val: unknown): string | null {
  if (typeof val === "string") return val.trim() || null;
  if (val === null || val === undefined) return null;
  return String(val).trim() || null;
}

function toInt(val: unknown): number | null {
  const n = toNum(val);
  return n !== null ? Math.floor(n) : null;
}

/** 1-second pause — honours the ProPublica self-imposed rate limit. */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeFiling(raw: unknown): ProPublicaFiling | null {
  const r = raw as RawFiling;
  const year = toInt(r?.tax_prd_yr);
  if (year === null) return null;
  return {
    year,
    total_revenue: toNum(r?.totrevenue),
    total_expenses: toNum(r?.totexpns),
    total_assets: toNum(r?.totnetassets),
    grants_paid: toNum(r?.totgrnts),
    filing_url: toStr(r?.pdf_url),
  };
}

// --- Agent ------------------------------------------------------------------

export class ProPublicaMiningAgent extends BaseAgent<
  ProPublicaInput,
  ProPublicaResult
> {
  readonly agentType: AgentType = "propublica_mining";

  protected async execute(
    input: ProPublicaInput,
  ): Promise<AgentExecution<ProPublicaResult>> {
    if (!input.ein && !input.query) {
      throw new AgentError(
        "Either ein or query is required.",
        "missing_input",
        400,
      );
    }

    const organizations: ProPublicaOrg[] = [];

    if (input.ein) {
      const org = await this.fetchByEin(input.ein);
      if (org) organizations.push(org);
    } else if (input.query) {
      const eins = await this.searchEins(input.query, input.state);
      for (const ein of eins) {
        await sleep(1_000);
        const org = await this.fetchByEin(ein);
        if (org) organizations.push(org);
      }
    }

    return {
      data: { organizations, organizations_found: organizations.length },
      outputSummary: `ProPublica mining returned ${organizations.length} organization(s) with IRS filing data.`,
      itemsFound: organizations.length,
      itemsProcessed: organizations.length,
      tokensUsed: 0,
    };
  }

  private async fetchByEin(ein: string): Promise<ProPublicaOrg | null> {
    const cleanEin = ein.replace(/\D/g, "");
    const url = `${PROPUBLICA_BASE}/organizations/${cleanEin}.json`;

    let response: Response;
    try {
      response = await fetch(url, {
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(15_000),
      });
    } catch (err) {
      throw new AgentError(
        `ProPublica request failed: ${err instanceof Error ? err.message : "network error"}`,
        "fetch_failed",
        502,
      );
    }

    if (response.status === 404) return null;
    if (!response.ok) {
      throw new AgentError(
        `ProPublica API returned HTTP ${response.status}.`,
        "api_error",
        502,
      );
    }

    const raw = (await response.json()) as RawOrgResponse;
    const org = raw?.organization;
    if (!org) return null;

    const name = toStr(org?.name);
    if (!name) return null;

    const rawFilings = (raw?.filings_with_data ?? []) as unknown[];
    const filings: ProPublicaFiling[] = rawFilings
      .slice(0, MAX_FILING_YEARS)
      .map(normalizeFiling)
      .filter((f): f is ProPublicaFiling => f !== null);

    return {
      ein: toStr(org?.ein) ?? cleanEin,
      name,
      city: toStr(org?.city),
      state: toStr(org?.state),
      ntee_code: toStr(org?.ntee_code),
      filings,
    };
  }

  private async searchEins(
    query: string,
    state?: string,
  ): Promise<string[]> {
    const params = new URLSearchParams({ q: query });
    if (state) params.set("state", state);
    const url = `${PROPUBLICA_BASE}/search.json?${params.toString()}`;

    let response: Response;
    try {
      response = await fetch(url, {
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(15_000),
      });
    } catch (err) {
      throw new AgentError(
        `ProPublica search failed: ${err instanceof Error ? err.message : "network error"}`,
        "fetch_failed",
        502,
      );
    }

    if (!response.ok) {
      throw new AgentError(
        `ProPublica search API returned HTTP ${response.status}.`,
        "api_error",
        502,
      );
    }

    const body = (await response.json()) as RawSearchResponse;
    const orgs = (body?.organizations ?? []) as unknown[];

    return orgs
      .slice(0, MAX_ORG_RESULTS)
      .map((o) => toStr((o as RawSearchOrg)?.ein))
      .filter((ein): ein is string => ein !== null && ein.length > 0);
  }
}
