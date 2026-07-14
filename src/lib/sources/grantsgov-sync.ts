// Persistence layer for the Grants.gov client (`./grantsgov-client`): resolves
// which keywords to search for an organization, dedupes hits against existing
// `opportunities` rows, and upserts. Shared by the on-demand route
// (`/api/sources/grantsgov`), the daily cron sweep (`/api/cron/grantsgov`),
// and the manual CLI script (`scripts/poll-grantsgov.ts`) so all three stay in
// sync with a single implementation instead of copies drifting apart.

import type { SupabaseClient } from "@supabase/supabase-js";

import {
  searchGrantsGovOpportunities,
  type GrantsGovNormalizedOpportunity,
} from "@/lib/sources/grantsgov-client";

export interface GrantsGovSyncResult {
  newCount: number;
  updatedCount: number;
  keywordsSearched: number;
}

interface SearchProfileRow {
  keywords: string[] | null;
}

interface ExistingOpportunityRow {
  id: string;
  url: string | null;
}

function externalUrl(externalId: string): string {
  return `https://www.grants.gov/search-grants?opp=${externalId}`;
}

function extractExternalId(url: string | null): string {
  if (!url) return "";
  const m = /[?&]opp=([^&]+)/.exec(url);
  return m && m[1] ? decodeURIComponent(m[1]) : "";
}

/**
 * Distinct organization_ids with at least one active search profile — the
 * sweep population for the daily cron and the manual CLI script.
 */
export async function listActiveGrantsGovOrgIds(
  admin: SupabaseClient,
): Promise<string[]> {
  const { data, error } = await admin
    .from("search_profiles")
    .select("organization_id")
    .eq("is_active", true);
  if (error) return [];
  return Array.from(
    new Set(
      (data ?? []).map((r) => r.organization_id as string).filter(Boolean),
    ),
  );
}

/**
 * Resolves keywords (explicit override, else the org's active search_profiles
 * keywords), searches Grants.gov for each, and upserts hits into
 * `opportunities` — deduping by the Grants.gov external id encoded in `url`
 * (Contracts §17; `opportunities` has no dedicated external_id column).
 */
export async function syncGrantsGovForOrg(
  admin: SupabaseClient,
  organizationId: string,
  explicitKeywords?: string[],
): Promise<GrantsGovSyncResult> {
  let keywords = (explicitKeywords ?? []).map((k) => k.trim()).filter(Boolean);

  if (keywords.length === 0) {
    const { data: profileRows, error: profileError } = await admin
      .from("search_profiles")
      .select("keywords")
      .eq("organization_id", organizationId)
      .eq("is_active", true);

    if (profileError) {
      throw new Error("Could not load search profiles.");
    }

    const seen = new Set<string>();
    for (const row of (profileRows ?? []) as SearchProfileRow[]) {
      for (const kw of row.keywords ?? []) {
        const trimmed = kw.trim();
        if (trimmed) seen.add(trimmed);
      }
    }
    keywords = Array.from(seen);
  }

  if (keywords.length === 0) {
    return { newCount: 0, updatedCount: 0, keywordsSearched: 0 };
  }

  // Search each keyword and dedupe hits by externalId across all searches
  // before touching the database.
  const byExternalId = new Map<string, GrantsGovNormalizedOpportunity>();
  for (const keyword of keywords) {
    const hits = await searchGrantsGovOpportunities(keyword);
    for (const hit of hits) {
      if (!byExternalId.has(hit.externalId)) {
        byExternalId.set(hit.externalId, hit);
      }
    }
  }

  // Load this org's existing grants_gov opportunities so external ids can be
  // matched to existing rows for update-vs-insert.
  const { data: existingRows, error: existingError } = await admin
    .from("opportunities")
    .select("id, url")
    .eq("organization_id", organizationId)
    .eq("source", "grants_gov");

  if (existingError) {
    throw new Error("Could not load existing opportunities.");
  }

  const existingByExternalId = new Map<string, string>();
  for (const row of (existingRows ?? []) as ExistingOpportunityRow[]) {
    const externalId = extractExternalId(row.url);
    if (externalId) existingByExternalId.set(externalId, row.id);
  }

  let newCount = 0;
  let updatedCount = 0;

  for (const opp of byExternalId.values()) {
    const existingId = existingByExternalId.get(opp.externalId);

    const patch: Record<string, unknown> = {
      name: opp.name,
      description: opp.description,
      amount_max: opp.amount,
      deadline: opp.deadline,
      source: "grants_gov",
      source_type: "government_federal" as const,
      url: externalUrl(opp.externalId),
    };

    if (existingId) {
      const { error } = await admin
        .from("opportunities")
        .update(patch)
        .eq("id", existingId)
        .eq("organization_id", organizationId);
      if (!error) updatedCount++;
    } else {
      const { error } = await admin.from("opportunities").insert({
        ...patch,
        organization_id: organizationId,
        category: "government_grant" as const,
        status: "open" as const,
      });
      if (!error) newCount++;
    }
  }

  return { newCount, updatedCount, keywordsSearched: keywords.length };
}
