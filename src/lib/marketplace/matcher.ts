import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Rule-based matcher for the Donation Recommendation Marketplace MVP
 * (FEATURE_REGISTRY_v2.md rows #121-125, Pillar 9). This is explicitly NOT
 * the AI match engine row #123 describes — no Claude call, no numeric
 * confidence score. It compares a new listing against every OTHER org's
 * active search_profiles (migration 001, already-existing schema — not a
 * new table) on two plain criteria already available elsewhere in this
 * schema:
 *
 *   1. Category overlap: listing.category (funder_category) is one of the
 *      requesting org's search_profiles.categories (funder_category[]).
 *   2. Geographic overlap: listing.geographic_scope and the requesting
 *      org's search_profiles.geographic_scope are both non-null and one
 *      contains the other (case-insensitive substring), OR either side is
 *      a national scope ("nationwide"/"national"/"all"/"usa").
 *
 * A listing matches an org if EITHER criterion fires; the specific reason(s)
 * are recorded verbatim in marketplace_matches.match_reason so a human
 * reviewing a match can see exactly why it was suggested, not just a score.
 *
 * Must run on a service-role client: it reads and writes rows belonging to
 * orgs other than the listing's own org, which RLS (migration
 * 125_donation_marketplace.sql) does not permit for a session-bound client.
 */

export interface MarketplaceListingForMatch {
  id: string;
  organization_id: string;
  category: string;
  geographic_scope: string | null;
}

export interface MarketplaceMatchResult {
  organizationId: string;
  reasons: string[];
}

const NATIONAL_SCOPE_MARKERS = ["nationwide", "national", "all states", "usa", "united states"];

function isNationalScope(scope: string): boolean {
  const lower = scope.toLowerCase();
  return NATIONAL_SCOPE_MARKERS.some((marker) => lower.includes(marker));
}

function geographicOverlap(listingScope: string | null, profileScope: string | null): boolean {
  if (!listingScope || !profileScope) return false;
  const a = listingScope.trim().toLowerCase();
  const b = profileScope.trim().toLowerCase();
  if (!a || !b) return false;
  if (isNationalScope(a) || isNationalScope(b)) return true;
  return a.includes(b) || b.includes(a);
}

/**
 * Finds every other org with an active search profile whose criteria
 * overlap the given listing, and writes real marketplace_matches rows
 * (upsert on the (listing_id, organization_id) unique constraint, so
 * re-running against the same listing is idempotent rather than producing
 * duplicates or erroring).
 */
export async function runMarketplaceMatching(
  admin: SupabaseClient,
  listing: MarketplaceListingForMatch,
): Promise<MarketplaceMatchResult[]> {
  const { data: profiles, error } = await admin
    .from("search_profiles")
    .select("organization_id, categories, geographic_scope")
    .eq("is_active", true)
    .neq("organization_id", listing.organization_id);

  if (error || !profiles) {
    return [];
  }

  // One active search profile per org can already produce more than one
  // profile row for the same org (an org may save several named search
  // profiles) — merge to at most one match per requesting org, unioning the
  // reasons a profile fired for.
  const byOrg = new Map<string, Set<string>>();

  for (const profile of profiles) {
    const reasons: string[] = [];

    const categories = (profile.categories as string[] | null) ?? [];
    if (categories.includes(listing.category)) {
      reasons.push(`category_overlap:${listing.category}`);
    }

    if (geographicOverlap(listing.geographic_scope, profile.geographic_scope as string | null)) {
      reasons.push(
        `geographic_overlap:${listing.geographic_scope ?? ""}~${profile.geographic_scope ?? ""}`,
      );
    }

    if (reasons.length === 0) continue;

    const existing = byOrg.get(profile.organization_id as string) ?? new Set<string>();
    reasons.forEach((r) => existing.add(r));
    byOrg.set(profile.organization_id as string, existing);
  }

  const results: MarketplaceMatchResult[] = Array.from(byOrg.entries()).map(
    ([organizationId, reasons]) => ({ organizationId, reasons: Array.from(reasons) }),
  );

  if (results.length === 0) return results;

  const rows = results.map((r) => ({
    listing_id: listing.id,
    organization_id: r.organizationId,
    match_reason: r.reasons.join("; "),
    status: "suggested" as const,
  }));

  await admin
    .from("marketplace_matches")
    .upsert(rows, { onConflict: "listing_id,organization_id", ignoreDuplicates: false });

  return results;
}
