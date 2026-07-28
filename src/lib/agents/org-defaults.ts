// Shared default-parameter resolution for connector "Run Now" triggers
// (Settings → Integrations). These routes are invoked with an empty body from
// the settings page — the card has no keyword/state/query input — so each
// route needs a sensible default derived from real org data instead of
// requiring params the UI never collects.
//
// Keyword fallback mirrors the pattern already established in
// src/app/api/agents/research/route.ts's multi-source flow: pull keywords
// from the org's active search_profiles, falling back to a generic default
// list when no profile has any keywords set.

import type { SupabaseClient } from "@supabase/supabase-js";

const DEFAULT_KEYWORDS = ["grant", "nonprofit", "community"];
const MAX_PROFILES = 5;
const MAX_KEYWORDS = 10;

export async function getDefaultResearchKeywords(
  supabase: SupabaseClient,
  organizationId: string,
): Promise<string[]> {
  const { data: profileRows } = await supabase
    .from("search_profiles")
    .select("keywords")
    .eq("organization_id", organizationId)
    .eq("is_active", true)
    .limit(MAX_PROFILES);

  const keywords = (profileRows ?? [])
    .flatMap((row) =>
      Array.isArray(row.keywords) ? (row.keywords as string[]) : [],
    )
    .filter(Boolean)
    .slice(0, MAX_KEYWORDS);

  return keywords.length > 0 ? keywords : DEFAULT_KEYWORDS;
}

export interface OrgProfileBasics {
  name: string | null;
  state: string | null;
}

export async function getOrgProfileBasics(
  supabase: SupabaseClient,
  organizationId: string,
): Promise<OrgProfileBasics> {
  const { data } = await supabase
    .from("organizations")
    .select("name, state")
    .eq("id", organizationId)
    .maybeSingle();

  return {
    name: (data?.name as string | null) ?? null,
    state: (data?.state as string | null) ?? null,
  };
}
