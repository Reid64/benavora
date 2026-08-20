// Grants.gov opportunity search client — lightweight polling client for the
// public v2 search endpoint (no auth required).
//
// This is intentionally a thin fetch + map layer: given a search term it
// returns opportunities normalised toward the `opportunities` table shape.
// Callers (route handlers, worker jobs) own persistence and dedup.

import { decodeHtmlEntities } from "@/lib/utils/formatters";

const GRANTS_GOV_SEARCH_URL = "https://api.grants.gov/v1/api/search2";

const DEFAULT_ROWS = 100;

export interface GrantsGovNormalizedOpportunity {
  /** Grants.gov opportunity id — the natural external identifier for dedup. */
  externalId: string;
  name: string;
  description: string | null;
  /** Award ceiling, mapped toward `opportunities.amount_max`. */
  amount: number | null;
  /** ISO-8601 (YYYY-MM-DD) close date, or null when not published. */
  deadline: string | null;
  category: "Government Federal";
  source: "grants_gov";
}

interface RawOppHit {
  id?: unknown;
  title?: unknown;
  closeDate?: unknown;
}

// The real v1/api/search2 response wraps hits under `data.oppHits`, not a
// top-level `oppHits` field. Hits carry only summary fields (id, title,
// dates) — no synopsis/description or award amount is available from this
// search endpoint at all.
interface GrantsGovSearchResponse {
  data?: {
    oppHits?: RawOppHit[];
  };
}

function toStr(val: unknown): string {
  if (typeof val === "string") return val.trim();
  if (val === null || val === undefined) return "";
  return String(val).trim();
}

function toAmount(val: unknown): number | null {
  if (val === null || val === undefined || val === "") return null;
  const n = Number(val);
  return Number.isFinite(n) && n > 0 ? n : null;
}

// Grants.gov close dates arrive as "MM/DD/YYYY"; normalise to ISO (YYYY-MM-DD).
function toIsoDate(val: unknown): string | null {
  const raw = toStr(val);
  if (!raw) return null;

  const slash = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(raw);
  if (slash) {
    const [, month, day, year] = slash;
    return `${year}-${(month ?? "").padStart(2, "0")}-${(day ?? "").padStart(2, "0")}`;
  }

  if (/^\d{4}-\d{2}-\d{2}/.test(raw)) return raw.slice(0, 10);

  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString().slice(0, 10);
}

function mapHit(hit: RawOppHit): GrantsGovNormalizedOpportunity | null {
  const externalId = toStr(hit.id);
  const name = decodeHtmlEntities(toStr(hit.title));
  if (!externalId || !name) return null;

  return {
    externalId,
    name,
    // search2 hits carry no synopsis/award-ceiling field — not available
    // without a separate per-opportunity detail call.
    description: null,
    amount: null,
    deadline: toIsoDate(hit.closeDate),
    category: "Government Federal",
    source: "grants_gov",
  };
}

/**
 * Searches the public Grants.gov v2 opportunity search API for `searchTerm`
 * and returns opportunities mapped toward the `opportunities` table shape.
 * Returns an empty array on any HTTP or parse failure (non-fatal — callers
 * typically loop over several search terms and should not abort the whole
 * poll because one keyword's request failed).
 */
export async function searchGrantsGovOpportunities(
  searchTerm: string,
): Promise<GrantsGovNormalizedOpportunity[]> {
  const keyword = searchTerm.trim();
  if (!keyword) return [];

  let response: Response;
  try {
    response = await fetch(GRANTS_GOV_SEARCH_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        keyword,
        oppStatuses: "posted",
        rows: DEFAULT_ROWS,
        startRecordNum: 0,
      }),
      signal: AbortSignal.timeout(30_000),
    });
  } catch {
    return [];
  }

  if (!response.ok) return [];

  let body: GrantsGovSearchResponse;
  try {
    body = (await response.json()) as GrantsGovSearchResponse;
  } catch {
    return [];
  }

  const hits = Array.isArray(body.data?.oppHits) ? body.data.oppHits : [];
  const mapped: GrantsGovNormalizedOpportunity[] = [];
  for (const hit of hits) {
    const opp = mapHit(hit);
    if (opp) mapped.push(opp);
  }
  return mapped;
}
