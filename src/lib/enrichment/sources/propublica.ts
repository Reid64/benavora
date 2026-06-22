// ProPublica Nonprofit Explorer enrichment source.
// No API key required. Self-imposed rate: 1 request per 500ms.
// Docs: https://projects.propublica.org/nonprofits/api/v2

import type { EnrichmentResult, FilingDetails } from "@/lib/enrichment/types";

const BASE = "https://projects.propublica.org/nonprofits/api/v2";

// --- Raw API shapes (all optional — API may omit any field) -----------------

interface RawFilingEntry {
  tax_prd_yr?: unknown;
  totrevenue?: unknown;
  totassetsend?: unknown;
  totgrnts?: unknown;
  progrev?: unknown;
  pdf_url?: unknown;
}

interface RawOrgDetail {
  ein?: unknown;
  name?: unknown;
  city?: unknown;
  state?: unknown;
  zip?: unknown;
  ntee_code?: unknown;
  ruling?: unknown;
  website?: unknown;
  address?: unknown;
}

interface RawOrgResponse {
  organization?: RawOrgDetail;
  filings_with_data?: unknown[];
}

interface RawSearchOrg {
  ein?: unknown;
  name?: unknown;
  city?: unknown;
  state?: unknown;
  ntee_code?: unknown;
}

interface RawSearchResponse {
  organizations?: unknown[];
  num_results?: unknown;
}

// --- Helpers ----------------------------------------------------------------

function toStr(v: unknown): string | undefined {
  if (typeof v === "string") return v.trim() || undefined;
  return undefined;
}

function toNum(v: unknown): number | undefined {
  if (v === null || v === undefined || v === "") return undefined;
  const n = Number(v);
  return isFinite(n) ? n : undefined;
}

function toInt(v: unknown): number | undefined {
  const n = toNum(v);
  return n !== undefined ? Math.floor(n) : undefined;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// ---------------------------------------------------------------------------

export class ProPublicaSource {
  /** Fetch org by EIN and return an EnrichmentResult, or null if not found. */
  async searchByEin(ein: string): Promise<EnrichmentResult | null> {
    const clean = ein.replace(/\D/g, "");
    const res = await this.get(`/organizations/${clean}.json`);
    if (res === null) return null;

    const raw = res as RawOrgResponse;
    const org = raw.organization;
    if (!org) return null;

    const name = toStr(org.name);
    if (!name) return null;

    const mostRecent = (raw.filings_with_data ?? []).slice(0, 1)[0] as
      | RawFilingEntry
      | undefined;

    const city = toStr(org.city);
    const state = toStr(org.state);
    const zip = toStr(org.zip);

    return {
      source: "propublica",
      website: toStr(org.website),
      emails: [],
      phones: [],
      officers: [],
      revenue: toNum(mostRecent?.totrevenue),
      assets: toNum(mostRecent?.totassetsend),
      giving: toNum(mostRecent?.totgrnts),
      address:
        city && state
          ? { street: toStr(org.address) ?? "", city, state, zip: zip ?? "" }
          : undefined,
      confidence: 0.9,
      raw: res,
    };
  }

  /**
   * Search by organization name (and optionally state).
   * Returns up to 5 results — caller picks best match by name similarity.
   * Rate: 1 request per 500ms.
   */
  async searchByName(
    name: string,
    state?: string,
  ): Promise<EnrichmentResult[]> {
    const params = new URLSearchParams({ q: name });
    if (state) params.set("state[id]", state);

    await sleep(500);
    const res = await this.get(`/search.json?${params.toString()}`);
    if (res === null) return [];

    const body = res as RawSearchResponse;
    const orgs = (body.organizations ?? []) as unknown[];

    return orgs.slice(0, 5).flatMap((o) => {
      const org = o as RawSearchOrg;
      const orgName = toStr(org.name);
      if (!orgName) return [];

      const city = toStr(org.city);
      const orgState = toStr(org.state);

      const result: EnrichmentResult = {
        source: "propublica",
        emails: [],
        phones: [],
        officers: [],
        address:
          city && orgState
            ? { street: "", city, state: orgState, zip: "" }
            : undefined,
        confidence: 0.6,
        raw: o,
      };
      return [result];
    });
  }

  /**
   * Fetch the most recent 990 filing details for an EIN.
   * Returns null if not found or no filings available.
   */
  async getFilingDetails(ein: string): Promise<FilingDetails | null> {
    const clean = ein.replace(/\D/g, "");
    await sleep(500);
    const res = await this.get(`/organizations/${clean}.json`);
    if (res === null) return null;

    const raw = res as RawOrgResponse;
    const filings = (raw.filings_with_data ?? []) as unknown[];
    const entry = filings[0] as RawFilingEntry | undefined;
    if (!entry) return null;

    const year = toInt(entry.tax_prd_yr);
    if (year === undefined) return null;

    return {
      year,
      total_revenue: toNum(entry.totrevenue),
      total_assets: toNum(entry.totassetsend),
      total_giving: toNum(entry.totgrnts),
      program_service_revenue: toNum(entry.progrev),
      filing_url: toStr(entry.pdf_url),
    };
  }

  // --- Internal fetch with 404 → null handling ----------------------------

  private async get(path: string): Promise<unknown> {
    const url = `${BASE}${path}`;
    const response = await fetch(url, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(15_000),
    });

    if (response.status === 404) return null;

    if (!response.ok) {
      throw new Error(
        `ProPublica API error: HTTP ${response.status} for ${url}`,
      );
    }

    return response.json();
  }
}
