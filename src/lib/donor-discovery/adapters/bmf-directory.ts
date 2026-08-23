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
 *
 * ## Grantmaker mode (default) vs operating_nonprofits mode
 *
 * `foundation_directory`'s 133,812 rows are IRS-registered private
 * foundations (`foundation_type` in ('03','04') covers 133,498 of them
 * -- effectively the whole table, since this table is BMF-filtered to PF
 * status at ingestion time already). That column alone can't separate a
 * genuine *grantmaker* (writes checks to other orgs) from a *private
 * operating foundation* that runs its own direct-service programs (IRS still
 * calls it a "private foundation" for tax purposes, but it isn't a funding
 * prospect for another nonprofit -- it's a peer/competitor for the same
 * grants). Two structural signals combine to identify a genuine grantmaker:
 *   - `foundation_type` in ('03','04') -- private-foundation legal code (excludes '02', see GRANTMAKER_FOUNDATION_TYPES)
 *   - `ntee_code` starting 'T2' or 'T3' -- NTEE's own "Private Grantmaking
 *     Foundations" (T2x) / "Public Foundations" (T3x) classification, i.e.
 *     the org's *primary* IRS activity code is literally "grantmaking."
 * The original 2026-08-21 run (`f4870e28-...`) filtered directly on the
 * *cause* NTEE codes (P/X/L) as if they were the entity's own type -- that
 * finds orgs whose primary IRS classification IS housing/human-services/
 * religion delivery, i.e. operating charities that happen to be legally
 * structured as a private foundation, not funders of those causes. This mode
 * fixes that: the structural filter above narrows to genuine grantmaking
 * entities first, then the requested cause codes (P/X/L, ...) are matched
 * against *what the foundation funds*, not what IRS thinks the foundation
 * itself is.
 *
 * Cause matching, in priority order (recorded per-prospect as `match_basis`):
 *   1. `990pf_grants_data` -- would use itemized 990-PF Part XV grants-paid
 *      recipient data (grantee name/NTEE) if it existed. **It does not** --
 *      no dedicated 990-PF grants-paid/officers/application-procedures table
 *      exists in this schema (verified 2026-08-22; only summary revenue/
 *      asset/NTEE index fields are ingested, in
 *      `foundation_directory.enrichment->propublica`). This tier is
 *      documented, never silently skipped, so a future session that DOES
 *      ingest 990-PF Schedule I/Part XV data has an obvious place to wire it
 *      in ahead of the two fallbacks below.
 *   2. `ntee_code_direct` -- the foundation's own `ntee_code` already starts
 *      with one of the requested cause letters (e.g. a foundation coded
 *      "P20" when the request asked for cause "P"). A real, if imperfect,
 *      signal: many single-cause family foundations get NTEE-coded by the
 *      cause they fund rather than "T" (pure philanthropy).
 *   3. `name_keyword_match` -- keyword match against the foundation's legal
 *      `name` for the requested cause(s) (CAUSE_KEYWORDS below), used only
 *      when the foundation is genuinely cause-agnostic in its own NTEE code
 *      (T-coded, or NTEE missing) -- the task's specified fallback for "no
 *      990-PF grant-recipient data."
 * A foundation matching neither (1), (2), nor (3) for any requested cause is
 * excluded from grantmaker-mode results.
 *
 * Setting `operating_nonprofits: true` on the geography restores the exact
 * pre-2026-08-22 behavior: no structural grantmaker filter, cause codes
 * matched directly against `ntee_code` (the org's own primary
 * classification), `match_basis` always `"operating_nonprofit_mode"`.
 */

export interface StatesGeography {
  states: string[];
  /** Minimum foundation_directory.asset_amount, inclusive. Omit for no floor. */
  min_assets?: number;
  /** Cap on rows enumerated, ordered by assets desc. Defaults to DEFAULT_LIMIT. */
  limit?: number;
  /** false/omitted (default) = grantmaker mode (see module doc). true = pre-2026-08-22 behavior. */
  operating_nonprofits?: boolean;
}

export interface NationalGeography {
  national: true;
  min_assets?: number;
  limit?: number;
  operating_nonprofits?: boolean;
}

export type BmfGeography = StatesGeography | NationalGeography;

export interface EnumerateBmfParams {
  /** Single-letter NTEE major group codes, e.g. ["P", "X", "L"] -- cause codes in grantmaker mode, entity-type codes in operating_nonprofits mode. */
  nteeMajorGroups: string[];
  geography: BmfGeography;
}

export const DEFAULT_LIMIT = 200;
export const MAX_LIMIT = 1000;

// Grantmaker-mode fetches a wider candidate pool than `limit` before applying
// in-application cause matching (SQL can filter the structural grantmaker
// signal and geography/assets, but not a keyword scan over `name`), so a
// state with few T2/T3-coded or cause-NTEE-coded foundations doesn't come up
// short of `limit` just because low-asset non-matches were fetched first.
const CANDIDATE_FETCH_MULTIPLIER = 5;
const MAX_CANDIDATE_FETCH = 5000;

export type MatchBasis = "990pf_grants_data" | "ntee_code_direct" | "name_keyword_match" | "operating_nonprofit_mode";

// Cause keyword fallback (match_basis: name_keyword_match) -- used only when
// a foundation's own ntee_code doesn't already start with the requested
// cause letter (i.e. it's T-coded or uncoded), per the module doc's tier 3.
// Keyed by NTEE major group letter; extend as new cause codes are requested.
// "family" is deliberately excluded from every list below despite being a
// very common word in foundation cause descriptions -- "X Family Foundation"
// is the single most common private-foundation naming convention in the IRS
// BMF regardless of what the foundation actually funds, so including it as a
// bare keyword false-positive-matched nearly every family-named foundation
// to cause "P" (live-verified 2026-08-22: the initial keyword list produced
// a top-15 that was 15/15 "X Family Foundation"-pattern names with no other
// signal). Only genuinely cause-specific terms are listed.
const CAUSE_KEYWORDS: Record<string, string[]> = {
  P: ["human service", "family service", "social service", "community service", "children", "youth"],
  X: ["church", "ministry", "ministries", "faith", "christian", "catholic", "jewish", "baptist", "ymca", "religious"],
  L: ["housing", "shelter", "homeless", "habitat"],
  T: ["charitable trust", "philanthrop", "community foundation"],
  B: ["education", "school", "scholarship", "university", "college"],
  E: ["health", "hospital", "medical", "clinic"],
  N: ["recreation", "sports", "youth development"],
  O: ["youth development", "boy scout", "girl scout", "4-h"],
};

function isStatesGeography(g: BmfGeography): g is StatesGeography {
  return "states" in g;
}

/** Same shape google-places.ts's requireRadiusGeography() uses for its own rejection. */
export function requireBmfGeography(geography: unknown): BmfGeography {
  if (geography && typeof geography === "object") {
    const g = geography as Record<string, unknown>;
    if (Array.isArray(g.states) && g.states.every((s) => typeof s === "string")) {
      return {
        states: g.states,
        min_assets: numberOrUndefined(g.min_assets),
        limit: numberOrUndefined(g.limit),
        operating_nonprofits: g.operating_nonprofits === true,
      };
    }
    if (g.national === true) {
      return {
        national: true,
        min_assets: numberOrUndefined(g.min_assets),
        limit: numberOrUndefined(g.limit),
        operating_nonprofits: g.operating_nonprofits === true,
      };
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

// Includes zip when available so the scoring layer's address-derived state
// match (extractStateFromAddress()'s "City, ST 12345"-shaped regex) actually
// fires for BMF-sourced records -- previously omitted, which silently
// disabled the geoMatch scoring signal for every BMF prospect ever enumerated
// (see DONOR_DISCOVERY_ARCHITECTURE.md's scoring rubric section).
function hqAddress(city: string | null, state: string | null, zip: string | null): string | null {
  const cityState = city && state ? `${city}, ${state}` : (city ?? state ?? null);
  if (!cityState) return null;
  const zip5 = zip?.trim().slice(0, 5);
  if (state && zip5 && /^\d{5}$/.test(zip5)) return `${cityState} ${zip5}`;
  return cityState;
}

function nteeMajorGroup(ntee: string | null): string | null {
  if (!ntee) return null;
  const letter = ntee.trim().charAt(0).toUpperCase();
  return /^[A-Z]$/.test(letter) ? letter : null;
}

function isGrantmakerNteeCode(ntee: string | null): boolean {
  const code = ntee?.trim().toUpperCase() ?? "";
  return code.startsWith("T2") || code.startsWith("T3");
}

// Per the task spec: '03' (4942(j)(3) operating foundation, non-exempt) and
// '04' (private non-operating foundation -- the classic grantmaking type).
// '02' (4942(j)(3) OPERATING foundation, exempt from excise tax) is
// deliberately excluded even though it's also "private foundation" legal
// status -- live-verified 2026-08-22: HENDRICK HOME FOR CHILDREN
// (foundation_type='02') is a residential children's home that directly
// operates its own programs, not a grantmaker, and was a false positive in
// this filter's first draft before '02' was removed.
const GRANTMAKER_FOUNDATION_TYPES = new Set(["03", "04"]);

function isGrantmakerFoundationType(foundationType: string | null): boolean {
  return foundationType !== null && GRANTMAKER_FOUNDATION_TYPES.has(foundationType.trim());
}

/**
 * Cause-match one row against the requested cause codes in grantmaker mode.
 * Returns the matched cause code and match_basis, or null if no requested
 * cause matches by any tier. Tier 1 (990pf_grants_data) is structurally
 * unavailable -- see module doc -- and intentionally never returned here.
 */
function matchCause(
  row: FoundationRow,
  requestedCauses: string[],
): { cause: string; matchBasis: MatchBasis } | null {
  const rowMajorGroup = nteeMajorGroup(row.ntee_code);

  // Tier 2: the foundation's own primary NTEE classification already is one
  // of the requested causes.
  if (rowMajorGroup && requestedCauses.includes(rowMajorGroup)) {
    return { cause: rowMajorGroup, matchBasis: "ntee_code_direct" };
  }

  // Tier 3: keyword match on name, for foundations whose own NTEE code
  // carries no cause signal (T-coded "pure philanthropy" or missing).
  const haystack = row.name.toLowerCase();
  for (const cause of requestedCauses) {
    const keywords = CAUSE_KEYWORDS[cause];
    if (!keywords) continue;
    if (keywords.some((kw) => haystack.includes(kw))) {
      return { cause, matchBasis: "name_keyword_match" };
    }
  }

  return null;
}

interface FoundationRow {
  id: string;
  name: string;
  city: string | null;
  state: string | null;
  zip: string | null;
  ein: string;
  website: string | null;
  phone: string | null;
  asset_amount: number | null;
  giving_total: number | null;
  ntee_code: string | null;
  foundation_type: string | null;
}

/**
 * Enumerates `foundation_directory` rows matching the given cause codes +
 * geography + asset floor, ordered by `asset_amount` descending, capped at
 * `geography.limit` (default 200, hard cap 1000). Each match is
 * merge-upserted into the shared `donor_discovery_directory` via the same
 * `upsertDirectoryRecord()` every other adapter uses, then linked back to
 * its source `foundation_directory` row with `linkage_confidence: 1` (exact
 * link -- the directory record IS this foundation_directory row, not a
 * fuzzy match), matching the pattern `scripts/seed-foundation-prospects.ts`
 * used -- but filtered, not a full-table dump (WGR-156's root cause).
 *
 * See module doc for grantmaker-mode vs operating_nonprofits-mode behavior.
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
  const operatingNonprofits = geography.operating_nonprofits === true;

  const supabase = createAdminClient();

  const selectCols = "id, name, city, state, zip, ein, website, phone, asset_amount, giving_total, ntee_code, foundation_type";

  let query;

  if (operatingNonprofits) {
    // Pre-2026-08-22 behavior: cause codes matched directly against
    // ntee_code (the org's own primary classification), no structural
    // grantmaker filter. SQL can express this filter directly, so no
    // over-fetch is needed.
    const nteeOr = params.nteeMajorGroups.map((code) => `ntee_code.ilike.${code}%`).join(",");
    query = supabase.from("foundation_directory").select(selectCols).or(nteeOr).order("asset_amount", {
      ascending: false,
      nullsFirst: false,
    }).limit(limit);
  } else {
    // Grantmaker mode: structural filter only in SQL (foundation_type in (03,04) OR ntee T2%/T3%); cause matching happens in application
    // code below since it needs the name-keyword fallback SQL can't express.
    const grantmakerOr = "foundation_type.in.(03,04),ntee_code.ilike.T2%,ntee_code.ilike.T3%";
    query = supabase
      .from("foundation_directory")
      .select(selectCols)
      .or(grantmakerOr)
      .order("asset_amount", { ascending: false, nullsFirst: false })
      .limit(Math.min(limit * CANDIDATE_FETCH_MULTIPLIER, MAX_CANDIDATE_FETCH));
  }

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

  let rows = (data ?? []) as FoundationRow[];
  let droppedByCauseMismatch = 0;

  const matchByRowId = new Map<string, { cause: string; matchBasis: MatchBasis }>();

  if (!operatingNonprofits) {
    const matched: FoundationRow[] = [];
    for (const row of rows) {
      const match = matchCause(row, params.nteeMajorGroups);
      if (match) {
        matchByRowId.set(row.id, match);
        matched.push(row);
      }
    }
    droppedByCauseMismatch = rows.length - matched.length;
    rows = matched.slice(0, limit);
  }

  const prospects: DonorDirectoryUpsertShape[] = [];
  const directoryIds: string[] = [];

  for (const row of rows) {
    const matchBasis: MatchBasis = operatingNonprofits
      ? "operating_nonprofit_mode"
      : (matchByRowId.get(row.id)?.matchBasis ?? "operating_nonprofit_mode");

    const upserted: DonorDirectoryUpsertShape = {
      legal_name: row.name,
      website: row.website,
      hq_address: hqAddress(row.city, row.state, row.zip),
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
          foundation_type: row.foundation_type,
          asset_amount: row.asset_amount,
          giving_total: row.giving_total,
          match_basis: matchBasis,
          grantmaker_mode: !operatingNonprofits,
          is_grantmaker_ntee: isGrantmakerNteeCode(row.ntee_code),
          is_grantmaker_foundation_type: isGrantmakerFoundationType(row.foundation_type),
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
      `(mode=${operatingNonprofits ? "operating_nonprofits" : "grantmaker"}, cause ${params.nteeMajorGroups.join("/")}, ` +
      `${isStatesGeography(geography) ? geography.states.join(",") : "national"}` +
      `${minAssets !== undefined ? `, assets>=${minAssets}` : ""}, limit ${limit}` +
      `${!operatingNonprofits ? `, ${droppedByCauseMismatch} dropped by cause mismatch` : ""}) -> ` +
      `${directoryIds.length} directory record(s) linked`,
  );

  return {
    prospects,
    directoryIds,
    requestsMade: 0, // no external/paid API calls -- reads the platform's own DB
    estCostUsd: 0,
  };
}
