// Opportunity de-duplication for the research pipeline (BEHAVIORAL_CONTRACTS
// §17: "Deduplication required before creating any opportunity: check URL exact
// match, then fuzzy name+funder").
//
// Two passes, in priority order:
//   1. Exact URL match — the strongest signal that we have already discovered
//      this opportunity.
//   2. Fuzzy name match, optionally gated on the funder also matching — catches
//      the same opportunity surfaced from a different URL (e.g. a listing page
//      vs. the funder's own page).
//
// All queries are scoped by organization_id so a tenant can never see, or
// collide with, another tenant's opportunities (Contracts §2).

import type { SupabaseClient } from "@supabase/supabase-js";

export type DuplicateMatchType = "url" | "name" | "none";

export interface DuplicateCheckResult {
  isDuplicate: boolean;
  /** The id of the existing opportunity, when a match was found. */
  existingId?: string;
  matchType: DuplicateMatchType;
}

export interface DeduplicateOptions {
  client: SupabaseClient;
  organizationId: string;
  /** The candidate opportunity's source URL, if any. */
  url?: string | null;
  /** The candidate opportunity's name (used for fuzzy matching). */
  name?: string | null;
  /** The candidate's funder name; when given, a name match must also agree. */
  funderName?: string | null;
}

/** Token-overlap (Jaccard) threshold above which two names are "the same". */
const NAME_SIMILARITY_THRESHOLD = 0.8;

interface OpportunityRow {
  id: string;
  name: string;
  funder_id: string | null;
}

interface FunderRow {
  id: string;
  name: string;
}

/**
 * Determine whether an opportunity already exists for this organization. Never
 * throws — a query failure resolves to "not a duplicate" so a transient error
 * never silently blocks discovery (the caller still gets a usable answer).
 */
export async function checkDuplicate(
  options: DeduplicateOptions,
): Promise<DuplicateCheckResult> {
  const { client, organizationId } = options;
  const url = (options.url ?? "").trim();
  const name = (options.name ?? "").trim();

  // Pass 1: exact URL match.
  if (url !== "") {
    try {
      const { data } = await client
        .from("opportunities")
        .select("id")
        .eq("organization_id", organizationId)
        .eq("url", url)
        .limit(1)
        .maybeSingle();
      const row = data as { id: string } | null;
      if (row?.id) {
        return { isDuplicate: true, existingId: row.id, matchType: "url" };
      }
    } catch (err) {
      console.error("[deduplicator] URL match query failed:", err);
    }
  }

  // Pass 2: fuzzy name (+ funder) match.
  if (name !== "") {
    try {
      const { data } = await client
        .from("opportunities")
        .select("id, name, funder_id")
        .eq("organization_id", organizationId);
      const rows = (data ?? []) as OpportunityRow[];

      const candidates = rows.filter((r) => namesMatch(name, r.name));
      const firstCandidate = candidates[0];
      if (firstCandidate) {
        const funderName = (options.funderName ?? "").trim();
        // Without a funder to corroborate, a strong name match alone suffices.
        if (funderName === "") {
          return {
            isDuplicate: true,
            existingId: firstCandidate.id,
            matchType: "name",
          };
        }

        const funderNames = await loadFunderNames(
          client,
          organizationId,
          candidates,
        );
        const confirmed = candidates.find((c) => {
          const existing = c.funder_id ? funderNames.get(c.funder_id) : null;
          return existing != null && namesMatch(funderName, existing);
        });
        if (confirmed) {
          return {
            isDuplicate: true,
            existingId: confirmed.id,
            matchType: "name",
          };
        }
      }
    } catch (err) {
      console.error("[deduplicator] name match query failed:", err);
    }
  }

  return { isDuplicate: false, matchType: "none" };
}

// --- helpers -----------------------------------------------------------------

/** Map funder_id → funder name for the candidate set (org-scoped). */
async function loadFunderNames(
  client: SupabaseClient,
  organizationId: string,
  candidates: OpportunityRow[],
): Promise<Map<string, string>> {
  const ids = Array.from(
    new Set(candidates.map((c) => c.funder_id).filter((id): id is string => !!id)),
  );
  const map = new Map<string, string>();
  if (ids.length === 0) return map;

  const { data } = await client
    .from("funders")
    .select("id, name")
    .eq("organization_id", organizationId)
    .in("id", ids);

  for (const f of (data ?? []) as FunderRow[]) {
    map.set(f.id, f.name);
  }
  return map;
}

/** Lowercase, strip punctuation, collapse whitespace — for stable comparison. */
function normalize(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * True if two names are the same after normalization, or share enough tokens
 * (Jaccard similarity ≥ threshold) to be considered the same opportunity.
 */
function namesMatch(a: string, b: string): boolean {
  const na = normalize(a);
  const nb = normalize(b);
  if (na === "" || nb === "") return false;
  if (na === nb) return true;

  const ta = new Set(na.split(" "));
  const tb = new Set(nb.split(" "));
  let intersection = 0;
  for (const t of ta) if (tb.has(t)) intersection++;
  const union = new Set([...ta, ...tb]).size;
  return union > 0 && intersection / union >= NAME_SIMILARITY_THRESHOLD;
}
