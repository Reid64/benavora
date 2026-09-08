// ProPublica Nonprofit Explorer organization-detail client — thin fetch +
// extract layer over the free, no-auth /organizations/{ein}.json endpoint.
//
// Three exports live here:
//  - fetchProPublicaFinancials — narrow, returns only the two financial
//    fields src/app/api/sources/propublica/route.ts needs. Kept as-is.
//  - enrichFoundationFromProPublica — broader profile (org identity fields
//    + the latest filing's revenue/assets/expenses/period) used by
//    scripts/enrich-propublica-batch.ts's foundation_directory.enrichment
//    batch job. Callers own persistence and rate limiting for both.
//  - fetchLatestFilingGivingSignal — the actual "money given out" line items
//    (contrpdpbks / distribamt), used to verify a candidate foundation has
//    REAL recent grantmaking activity — revenue/asset size alone describes
//    wealth, not giving. Unlike the other two exports, this one goes through
//    fetchWithRetry (http-retry.ts) — exponential backoff on 429/5xx only,
//    never on a 4xx — since a transient ProPublica hiccup on this specific
//    path would otherwise silently drop a real foundation from a run instead
//    of just missing one enrichment field.
//
// None of these three endpoints expose grantee/recipient-level data — the
// live /organizations/{ein}.json response only carries aggregate 990-PF
// filing totals (contrpdpbks, distribamt, grscontrgifts, totrevenue, etc.),
// never an itemized list of organizations a foundation paid out to. Verified
// live against this exact endpoint for EIN 36-4336415 (Michael & Susan Dell
// Foundation) and EIN 20-5639919 (Wal-mart Foundation) on 2026-09-07 — see
// src/app/(dashboard)/intelligence/990-funding-pattern-explorer/page.tsx's
// header comment for the full account of what that means for this tool.

import { fetchWithRetry } from "@/lib/agents/research/http-retry";

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

// ── fetchLatestFilingGivingSignal ───────────────────────────────────────────

export interface ProPublicaGivingSignal {
  ein: string;
  /** The filing's tax year (tax_prd_yr), for a recency check. */
  taxYear: number | null;
  /** 0 = 990, 1 = 990-EZ, 2 = 990-PF. */
  formType: number | null;
  /** 990-PF "Contributions, gifts, grants, etc. paid" (contrpdpbks) — the
   * actual dollar amount this foundation distributed, not its revenue or
   * asset size. */
  contributionsPaidPerBooks: number | null;
  /** 990-PF qualifying distributions (distribamt) — a secondary giving
   * signal used when contrpdpbks is unavailable. */
  qualifyingDistributions: number | null;
  totalFunctionalExpenses: number | null;
}

interface RawGivingFiling {
  tax_prd_yr?: number | null;
  formtype?: number | null;
  contrpdpbks?: number | null;
  distribamt?: number | null;
  totfuncexpns?: number | null;
}

interface RawOrganizationDetailGiving {
  filings_with_data?: RawGivingFiling[];
}

/** Most recent filing by tax_prd_yr — filings_with_data isn't documented as
 * pre-sorted (mirrors the same defensive sort in propublica-adapter.ts). */
function latestGivingFiling(filings: RawGivingFiling[] | undefined): RawGivingFiling | null {
  if (!filings || filings.length === 0) return null;
  return [...filings].sort((a, b) => (b.tax_prd_yr ?? 0) - (a.tax_prd_yr ?? 0))[0] ?? null;
}

/**
 * Fetches the most recent filing's grant/contribution distribution fields
 * from ProPublica's /organizations/{ein}.json — the line items that actually
 * describe money given out (contrpdpbks / distribamt), as opposed to
 * revenue or asset totals, which describe wealth, not giving activity.
 * Returns null on any HTTP error, 404 (no ProPublica record for this EIN),
 * or parse failure — non-fatal; callers must skip the candidate rather than
 * assume or fabricate a giving amount.
 *
 * Rate limiting is the caller's responsibility (350ms between calls per
 * scripts/enrich-propublica-batch.ts) — this function makes exactly one
 * fetch and returns.
 */
export async function fetchLatestFilingGivingSignal(
  ein: string,
): Promise<ProPublicaGivingSignal | null> {
  const cleanEin = ein.replace(/\D/g, "");
  if (!cleanEin) return null;

  let response: Response;
  try {
    response = await fetchWithRetry(
      () =>
        fetch(`${API_BASE}/organizations/${cleanEin}.json`, {
          signal: AbortSignal.timeout(30_000),
        }),
      { attempts: 3, baseDelayMs: 500 },
    );
  } catch {
    return null;
  }

  if (!response.ok) return null;

  let body: RawOrganizationDetailGiving;
  try {
    body = (await response.json()) as RawOrganizationDetailGiving;
  } catch {
    return null;
  }

  const filing = latestGivingFiling(body.filings_with_data);
  if (!filing) {
    return {
      ein: cleanEin,
      taxYear: null,
      formType: null,
      contributionsPaidPerBooks: null,
      qualifyingDistributions: null,
      totalFunctionalExpenses: null,
    };
  }

  return {
    ein: cleanEin,
    taxYear: toNumberOrNull(filing.tax_prd_yr),
    formType: toNumberOrNull(filing.formtype),
    contributionsPaidPerBooks: toNumberOrNull(filing.contrpdpbks),
    qualifyingDistributions: toNumberOrNull(filing.distribamt),
    totalFunctionalExpenses: toNumberOrNull(filing.totfuncexpns),
  };
}
