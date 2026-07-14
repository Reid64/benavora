// ProPublica Nonprofit Explorer organization-detail client — thin fetch +
// extract layer over the free, no-auth /organizations/{ein}.json endpoint.
//
// This is intentionally narrow: given an EIN it returns the two financial
// fields the foundation_directory sync route needs (total revenue, total
// assets) from the org's most recent filing. Callers own persistence.

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
