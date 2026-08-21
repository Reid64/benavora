import { createAdminClient } from "@/lib/supabase/admin";
import { upsertDirectoryRecord, type DirectoryRecord } from "@/lib/donor-discovery/directory";
import type { DonorDirectoryUpsertShape, EnumerateResult } from "@/lib/donor-discovery/adapters/google-places";

/**
 * BMF (IRS Business Master File / `foundation_directory`) registry adapter
 * (WGR-158/WGR-159). Enumerates directly from the platform's own already-
 * ingested `foundation_directory` reference table -- no external API call,
 * no cost, no rate limit -- for the two geography modes the Google Places
 * adapter explicitly does not support: `{states:[...]}` and
 * `{national:true}` (google-places.ts's `requireRadiusGeography()` throws
 * for both). `{center, radius_mi}` stays on Places -- `foundation_directory`
 * has no lat/lng column to filter by, only state/city text, so a radius
 * search isn't meaningful here either. See dispatchGeography() in
 * dd-request-processor.ts for the routing rule this mirrors.
 *
 * Returns the same `EnumerateResult` shape google-places.ts's `enumerate()`
 * does, so the request worker can call either adapter through one uniform
 * interface.
 */

export interface StatesGeography {
  states: string[];
  /** Minimum foundation_directory.asset_amount, inclusive. Omit for no floor. */
  min_assets?: number;
  /** Cap on rows enumerated, ordered by assets desc. Defaults to DEFAULT_LIMIT. */
  limit?: number;
}

export interface NationalGeography {
  national: true;
  min_assets?: number;
  limit?: number;
}

export type BmfGeography = StatesGeography | NationalGeography;

export interface EnumerateBmfParams {
  /** Single-letter NTEE major group codes, e.g. ["P", "X", "L"]. */
  nteeMajorGroups: string[];
  geography: BmfGeography;
}

export const DEFAULT_LIMIT = 200;
export const MAX_LIMIT = 1000;

function isStatesGeography(g: BmfGeography): g is StatesGeography {
  return "states" in g;
}

/** Same shape google-places.ts's requireRadiusGeography() uses for its own rejection. */
export function requireBmfGeography(geography: unknown): BmfGeography {
  if (geography && typeof geography === "object") {
    const g = geography as Record<string, unknown>;
    if (Array.isArray(g.states) && g.states.every((s) => typeof s === "string")) {
      return { states: g.states, min_assets: numberOrUndefined(g.min_assets), limit: numberOrUndefined(g.limit) };
    }
    if (g.national === true) {
      return { national: true, min_assets: numberOrUndefined(g.min_assets), limit: numberOrUndefined(g.limit) };
    }
  }
  throw new Error(
    "bmf-directory adapter requires a states or national geography ({states:[...]} or {national:true}); " +
      "center/radius geography stays on the google-places adapter.",
  );
}

function numberOrUndefined(v: unknown): number | undefined {
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}

function clampLimit(limit: number | undefined): number {
  const requested = limit ?? DEFAULT_LIMIT;
  return Math.max(1, Math.min(requested, MAX_LIMIT));
}

function hqAddress(city: string | null, state: string | null): string | null {
  if (city && state) return `${city}, ${state}`;
  return city ?? state ?? null;
}

interface FoundationRow {
  id: string;
  name: string;
  city: string | null;
  state: string | null;
  ein: string;
  website: string | null;
  phone: string | null;
  asset_amount: number | null;
  giving_total: number | null;
  ntee_code: string | null;
}

/**
 * Enumerates `foundation_directory` rows matching the given NTEE major
 * groups + geography + asset floor, ordered by `asset_amount` descending,
 * capped at `geography.limit` (default 200, hard cap 1000). Each match is
 * merge-upserted into the shared `donor_discovery_directory` via the same
 * `upsertDirectoryRecord()` every other adapter uses, then linked back to
 * its source `foundation_directory` row with `linkage_confidence: 1` (exact
 * link -- the directory record IS this foundation_directory row, not a
 * fuzzy match), matching the pattern `scripts/seed-foundation-prospects.ts`
 * used -- but filtered, not a full-table dump (WGR-156's root cause).
 */
export async function enumerate(params: EnumerateBmfParams): Promise<EnumerateResult> {
  if (params.nteeMajorGroups.length === 0) {
    throw new Error("bmf-directory adapter requires at least one NTEE major group code.");
  }
  const invalid = params.nteeMajorGroups.filter((c) => !/^[A-Z]$/.test(c));
  if (invalid.length > 0) {
    throw new Error(`bmf-directory adapter: invalid NTEE major group code(s): ${invalid.join(", ")}`);
  }

  const geography = params.geography;
  const limit = clampLimit(geography.limit);
  const minAssets = geography.min_assets;

  const supabase = createAdminClient();

  // ntee_code's first character is the major group letter (e.g. "P20" -> "P").
  // PostgREST has no native "first char of column" filter, so an
  // `.or()` of one `ilike` per requested letter does the equivalent of
  // `LEFT(ntee_code, 1) IN (...)` without a raw SQL fragment.
  const nteeOr = params.nteeMajorGroups.map((code) => `ntee_code.ilike.${code}%`).join(",");

  let query = supabase
    .from("foundation_directory")
    .select("id, name, city, state, ein, website, phone, asset_amount, giving_total, ntee_code")
    .or(nteeOr)
    .order("asset_amount", { ascending: false, nullsFirst: false })
    .limit(limit);

  if (isStatesGeography(geography)) {
    if (geography.states.length === 0) {
      throw new Error("bmf-directory adapter: states geography requires at least one state.");
    }
    query = query.in("state", geography.states);
  }
  // national: no state filter.

  if (minAssets !== undefined) {
    query = query.gte("asset_amount", minAssets);
  }

  const { data, error } = await query;
  if (error) {
    throw new Error(`bmf_directory_query_failed: ${error.message}`);
  }

  const rows = (data ?? []) as FoundationRow[];

  const prospects: DonorDirectoryUpsertShape[] = [];
  const directoryIds: string[] = [];

  for (const row of rows) {
    const upserted: DonorDirectoryUpsertShape = {
      legal_name: row.name,
      website: row.website,
      hq_address: hqAddress(row.city, row.state),
      geo: null, // foundation_directory has no lat/lng column
      phone: row.phone,
      naics_codes: [],
      source_adapters: ["bmf_directory"],
    };

    let directoryRecord: DirectoryRecord;
    try {
      directoryRecord = await upsertDirectoryRecord({
        legal_name: upserted.legal_name,
        website: upserted.website,
        hq_address: upserted.hq_address,
        phone: upserted.phone,
        source_adapter: "bmf_directory",
        enrichment: {
          ein: row.ein,
          ntee_code: row.ntee_code,
          asset_amount: row.asset_amount,
          giving_total: row.giving_total,
        },
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.warn(`[bmf-directory] Directory upsert failed for "${row.name}": ${message}`);
      continue;
    }

    // Exact linkage -- this directory record IS foundation_directory row
    // row.id, not a fuzzy match. Only sets it when not already linked
    // (matches scripts/seed-foundation-prospects.ts's own guard), so a
    // record another adapter already linked (unlikely, since linkage keys
    // off legal_name/website dedup, but not impossible) is never overwritten.
    const { error: linkError } = await supabase
      .from("donor_discovery_directory")
      .update({ linked_foundation_id: row.id, linkage_confidence: 1 })
      .eq("id", directoryRecord.id)
      .is("linked_foundation_id", null);

    if (linkError) {
      console.warn(`[bmf-directory] Foundation linkage failed for directory ${directoryRecord.id}: ${linkError.message}`);
    }

    prospects.push(upserted);
    directoryIds.push(directoryRecord.id);
  }

  console.log(
    `[bmf-directory] Enumerated ${rows.length} foundation_directory row(s) ` +
      `(NTEE ${params.nteeMajorGroups.join("/")}, ${isStatesGeography(geography) ? geography.states.join(",") : "national"}` +
      `${minAssets !== undefined ? `, assets>=${minAssets}` : ""}, limit ${limit}) -> ${directoryIds.length} directory record(s) linked`,
  );

  return {
    prospects,
    directoryIds,
    requestsMade: 0, // no external/paid API calls -- reads the platform's own DB
    estCostUsd: 0,
  };
}
