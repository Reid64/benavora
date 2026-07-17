// ProPublica Nonprofit Explorer organization-detail client — thin fetch +
// extract layer over the free, no-auth /organizations/{ein}.json endpoint.
//
// Two exports live here:
//  - fetchProPublicaFinancials — narrow, returns only the two financial
//    fields src/app/api/sources/propublica/route.ts needs. Kept as-is.
//  - enrichFoundationFromProPublica — broader profile (org identity fields
//    + the latest filing's revenue/assets/expenses/period) used by
//    scripts/enrich-propublica-batch.ts's foundation_directory.enrichment
//    batch job. Callers own persistence and rate limiting for both.

const API_BASE = "https://projects.propublica.org/nonprofits/api/v2";

export interface ProPublicaFinancials {
  ein: string;
  totalRevenue: number | null;
  totalAssets: number | null;
}

interface RawFiling {
  totrevenue?: number | null;
  totassetsend?: number | null;
}

interface RawOrganizationDetail {
  organization?: {
    ein?: number | string;
  };
  filings_with_data?: RawFiling[];
}

/**
 * Fetches org detail from ProPublica's /organizations/{ein}.json endpoint
 * and extracts totrevenue and totassetsend from filings[0] (the most recent
 * filing). Returns null on any HTTP error, 404 (no ProPublica record for
 * this EIN), or parse failure — non-fatal, callers loop over many EINs and
 * should not abort a batch because one lookup failed.
 */
export async function fetchProPublicaFinancials(
  ein: string,
): Promise<ProPublicaFinancials | null> {
  const cleanEin = ein.replace(/\D/g, "");
  if (!cleanEin) return null;

  let response: Response;
  try {
    response = await fetch(`${API_BASE}/organizations/${cleanEin}.json`, {
      signal: AbortSignal.timeout(30_000),
    });
  } catch {
    return null;
  }

  if (!response.ok) return null;

  let body: RawOrganizationDetail;
  try {
    body = (await response.json()) as RawOrganizationDetail;
  } catch {
    return null;
  }

  const filing = body.filings_with_data?.[0];
  if (!filing) {
    return { ein: cleanEin, totalRevenue: null, totalAssets: null };
  }

  return {
    ein: cleanEin,
    totalRevenue: typeof filing.totrevenue === "number" ? filing.totrevenue : null,
    totalAssets: typeof filing.totassetsend === "number" ? filing.totassetsend : null,
  };
}

// ── enrichFoundationFromProPublica ──────────────────────────────────────────

export interface ProPublicaFoundationEnrichment {
  ein: string;
  name: string | null;
  ntee_code: string | null;
  state: string | null;
  city: string | null;
  subsection_code: number | string | null;
  totrevenue: number | null;
  totassetsend: number | null;
  totfuncexpns: number | null;
  fiscal_period: number | string | null;
}

interface RawOrganizationDetailFull {
  organization?: {
    name?: string | null;
    ntee_code?: string | null;
    state?: string | null;
    city?: string | null;
    subsection_code?: number | string | null;
  };
  filings_with_data?: Array<{
    totrevenue?: number | null;
    totassetsend?: number | null;
    totfuncexpns?: number | null;
    fiscal_period?: number | string | null;
    tax_prd_yr?: number | null;
  }>;
}

function toNumberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/**
 * Fetches org detail from ProPublica's /organizations/{ein}.json endpoint
 * and extracts identity fields (name/ntee_code/state/city/subsection_code)
 * plus the most recent filing's totrevenue/totassetsend/totfuncexpns and
 * fiscal period. Returns null on any HTTP error, 404 (no ProPublica record
 * for this EIN), or parse failure — non-fatal, callers loop over many EINs
 * and should not abort a batch because one lookup failed.
 *
 * ProPublica's org-detail schema doesn't literally name a `fiscal_period`
 * field on each filing (it uses `tax_prd_yr` for the filing year); this
 * reads `fiscal_period` first in case a filing carries it and falls back to
 * `tax_prd_yr` so the value isn't silently dropped when it's actually there
 * under its real field name.
 *
 * Rate limiting is the caller's responsibility (350ms between calls per
 * scripts/enrich-propublica-batch.ts) — this function makes exactly one
 * fetch and returns.
 */
export async function enrichFoundationFromProPublica(
  ein: string,
): Promise<ProPublicaFoundationEnrichment | null> {
  const cleanEin = ein.replace(/\D/g, "");
  if (!cleanEin) return null;

  let response: Response;
  try {
    response = await fetch(`${API_BASE}/organizations/${cleanEin}.json`, {
      signal: AbortSignal.timeout(30_000),
    });
  } catch {
    return null;
  }

  if (!response.ok) return null;

  let body: RawOrganizationDetailFull;
  try {
    body = (await response.json()) as RawOrganizationDetailFull;
  } catch {
    return null;
  }

  const org = body.organization ?? {};
  const filing = body.filings_with_data?.[0];

  return {
    ein: cleanEin,
    name: org.name ?? null,
    ntee_code: org.ntee_code ?? null,
    state: org.state ?? null,
    city: org.city ?? null,
    subsection_code: org.subsection_code ?? null,
    totrevenue: filing ? toNumberOrNull(filing.totrevenue) : null,
    totassetsend: filing ? toNumberOrNull(filing.totassetsend) : null,
    totfuncexpns: filing ? toNumberOrNull(filing.totfuncexpns) : null,
    fiscal_period: filing ? (filing.fiscal_period ?? filing.tax_prd_yr ?? null) : null,
  };
}
