// Persistence layer for the CA Grants Portal client
// (./ca-grants-portal-client.ts): resolves which organizations to sync,
// dedupes hits against existing `opportunities` rows, and inserts. Mirrors
// the shape of src/lib/sources/grantsgov-sync.ts and
// src/lib/sources/federal-grants-poller.ts (dedup by `url`, since
// `opportunities` has no dedicated external_id column — same established
// convention, not a new one introduced here) so this new source stays
// consistent with how every other opportunities-table ingestion in this repo
// already works.
//
// Per STATE_PORTAL_SCOPING_2026-08-13.md item 5: this is a standalone
// addition. It does not import from or modify portal-scraper.ts,
// portal-config.ts, state-portal.ts, state-scrapers.ts, or
// tdhca-scraper.ts — reconciling those four is explicitly deferred.

import type { SupabaseClient } from "@supabase/supabase-js";

import {
  fetchCaGrantsPortalFeed,
  fetchNonprofitEligibleUrls,
  type CaGrantsPortalNormalizedOpportunity,
} from "@/lib/sources/state-portals/ca-grants-portal-client";

export const CA_GRANTS_PORTAL_SOURCE = "ca_grants_portal";

const HOUSING_KEYWORDS = ["housing", "homeless", "shelter"];
const EDUCATION_KEYWORDS = ["education", "school", "student", "literacy"];

export interface CaGrantsPortalSyncResult {
  fetched: number;
  newCount: number;
  skippedDuplicate: number;
  failed: number;
}

/**
 * Distinct organization_ids with at least one active search profile — same
 * sweep-population convention as grantsgov-sync.ts's
 * listActiveGrantsGovOrgIds, reproduced locally rather than imported since
 * this is a source-agnostic query, not Grants.gov-specific logic.
 */
export async function listActiveCaGrantsPortalOrgIds(
  admin: SupabaseClient,
): Promise<string[]> {
  const { data, error } = await admin
    .from("search_profiles")
    .select("organization_id")
    .eq("is_active", true);
  if (error) return [];
  return Array.from(
    new Set((data ?? []).map((r) => r.organization_id as string).filter(Boolean)),
  );
}

function inferCategory(opp: CaGrantsPortalNormalizedOpportunity): string {
  const haystack = `${opp.agency ?? ""} ${opp.name} ${opp.description ?? ""}`.toLowerCase();
  if (HOUSING_KEYWORDS.some((kw) => haystack.includes(kw))) return "housing_grant";
  if (EDUCATION_KEYWORDS.some((kw) => haystack.includes(kw))) return "education_grant";
  return "government_grant";
}

function buildEligibilityText(opp: CaGrantsPortalNormalizedOpportunity): string | null {
  const parts: string[] = [];
  if (opp.agency) parts.push(`Agency: ${opp.agency}`);
  if (opp.nonprofitEligible === true) {
    parts.push("Nonprofit organizations confirmed eligible (California Grants Portal applicant-type tag).");
  } else {
    parts.push("Nonprofit eligibility not confirmed from source data — verify on the funder's page before applying.");
  }
  return parts.length > 0 ? parts.join(" ") : null;
}

/**
 * Syncs the shared, statewide CA Grants Portal feed into `organizationId`'s
 * `opportunities`. `opportunities` (rows) is the already-fetched, already
 * nonprofit-cross-referenced feed — callers loop over multiple orgs against
 * one shared fetch rather than re-fetching the feed per org.
 */
export async function syncCaGrantsPortalForOrg(
  admin: SupabaseClient,
  organizationId: string,
  opportunities: CaGrantsPortalNormalizedOpportunity[],
): Promise<CaGrantsPortalSyncResult> {
  if (opportunities.length === 0) {
    return { fetched: 0, newCount: 0, skippedDuplicate: 0, failed: 0 };
  }

  const { data: existingRows, error: existingError } = await admin
    .from("opportunities")
    .select("url")
    .eq("organization_id", organizationId)
    .eq("source", CA_GRANTS_PORTAL_SOURCE);

  if (existingError) {
    throw new Error(`Could not load existing ${CA_GRANTS_PORTAL_SOURCE} opportunities.`);
  }

  const existingUrls = new Set(
    ((existingRows ?? []) as { url: string | null }[])
      .map((r) => r.url)
      .filter((u): u is string => Boolean(u)),
  );

  let newCount = 0;
  let skippedDuplicate = 0;
  let failed = 0;

  for (const opp of opportunities) {
    if (existingUrls.has(opp.externalUrl)) {
      skippedDuplicate++;
      continue;
    }

    const row: Record<string, unknown> = {
      organization_id: organizationId,
      name: opp.name,
      category: inferCategory(opp),
      description: opp.description,
      source: CA_GRANTS_PORTAL_SOURCE,
      source_type: "government_state" as const,
      url: opp.externalUrl,
      status: "open" as const,
      eligibility_requirements: buildEligibilityText(opp),
    };
    if (opp.deadline) row.deadline = opp.deadline;

    const { error } = await admin.from("opportunities").insert(row);
    if (error) {
      failed++;
    } else {
      newCount++;
      existingUrls.add(opp.externalUrl);
    }
  }

  return { fetched: opportunities.length, newCount, skippedDuplicate, failed };
}

/**
 * Fetches the CA Grants Portal feed once and cross-references the nonprofit
 * `applicant_type-nonprofit` signal (see ca-grants-portal-client.ts header for
 * why this requires a second, batched request rather than a per-grant fetch).
 * Shared by the CLI script so every org synced in one run uses the same
 * fetch instead of re-hitting the feed per org.
 */
export async function fetchAndTagCaGrantsPortalFeed(): Promise<
  CaGrantsPortalNormalizedOpportunity[]
> {
  const opportunities = await fetchCaGrantsPortalFeed();

  // Contracts §21: 5s same-domain delay before the next request batch
  // (fetchNonprofitEligibleUrls itself delays between its own page fetches).
  await new Promise((resolve) => setTimeout(resolve, 5_000));

  const eligibleUrls = await fetchNonprofitEligibleUrls();

  return opportunities.map((opp) => ({
    ...opp,
    nonprofitEligible: eligibleUrls.has(opp.externalUrl) ? true : null,
  }));
}
