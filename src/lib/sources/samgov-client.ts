// SAM.gov opportunity search client — lightweight polling client for the
// v2 opportunities search endpoint (api-key gated, free tier).
//
// This is intentionally a thin fetch + map layer, mirroring
// `./grantsgov-client.ts`: it returns opportunities normalised toward the
// `opportunities` table shape. Callers (route handlers) own persistence and
// dedup.
//
// The API key is read from `SAM_GOV_API_KEY` (server-only env var) — never
// hardcode it in source, it's a live credential.

import { decodeHtmlEntities } from "@/lib/utils/formatters";

const SAM_GOV_SEARCH_URL = "https://api.sam.gov/opportunities/v2/search";

const DEFAULT_LIMIT = 100;

export interface SamGovNormalizedOpportunity {
  /** SAM.gov noticeId — the natural external identifier for dedup. */
  externalId: string;
  name: string;
  description: string | null;
  /** Award amount, mapped toward `opportunities.amount_max`. */
  amount: number | null;
  /** ISO-8601 (YYYY-MM-DD) response deadline, or null when not published. */
  deadline: string | null;
  category: "Government Federal";
  source: "sam_gov";
}

interface RawOppHit {
  noticeId?: unknown;
  title?: unknown;
  description?: unknown;
  responseDeadLine?: unknown;
  awardAmount?: unknown;
}

interface SamGovSearchResponse {
  opportunitiesData?: RawOppHit[];
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

// SAM.gov deadlines arrive as ISO datetimes with an offset
// ("2026-09-01T23:59:00-05:00"); normalise to the date portion (YYYY-MM-DD).
function toIsoDate(val: unknown): string | null {
  const raw = toStr(val);
  if (!raw) return null;

  const match = /^(\d{4}-\d{2}-\d{2})/.exec(raw);
  if (match?.[1]) return match[1];

  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString().slice(0, 10);
}

function mapHit(hit: RawOppHit): SamGovNormalizedOpportunity | null {
  const externalId = toStr(hit.noticeId);
  const name = decodeHtmlEntities(toStr(hit.title));
  if (!externalId || !name) return null;

  return {
    externalId,
    name,
    description: toStr(hit.description) || null,
    amount: toAmount(hit.awardAmount),
    deadline: toIsoDate(hit.responseDeadLine),
    category: "Government Federal",
    source: "sam_gov",
  };
}

/**
 * Searches the SAM.gov v2 opportunities search API for open solicitations
 * (`ptype=o`) and returns opportunities mapped toward the `opportunities`
 * table shape. Returns an empty array when `SAM_GOV_API_KEY` is unset or on
 * any HTTP/parse failure (non-fatal — callers should not treat an empty
 * result as fatal).
 */
export async function searchSamGovOpportunities(): Promise<
  SamGovNormalizedOpportunity[]
> {
  const apiKey = process.env.SAM_GOV_API_KEY;
  if (!apiKey) return [];

  const params = new URLSearchParams({
    api_key: apiKey,
    ptype: "o",
    limit: String(DEFAULT_LIMIT),
  });

  let response: Response;
  try {
    response = await fetch(`${SAM_GOV_SEARCH_URL}?${params.toString()}`, {
      method: "GET",
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(30_000),
    });
  } catch {
    return [];
  }

  if (!response.ok) return [];

  let body: SamGovSearchResponse;
  try {
    body = (await response.json()) as SamGovSearchResponse;
  } catch {
    return [];
  }

  const hits = Array.isArray(body.opportunitiesData) ? body.opportunitiesData : [];
  const mapped: SamGovNormalizedOpportunity[] = [];
  for (const hit of hits) {
    const opp = mapHit(hit);
    if (opp) mapped.push(opp);
  }
  return mapped;
}
