// Shared helpers for the Corporate Intelligence enrichment agents
// (CORPORATE_INTELLIGENCE_ARCHITECTURE.md §2B/§2C, Agents EA-01..EA-05).
//
// All five EA-0X agents read one corporate_prospects row, merge new fields
// into its `enrichment` jsonb (canonical rule §12.2: "All enrichment writes
// to `enrichment` jsonb — never new columns per agent"), and never overwrite
// fields another agent already wrote (canonical rule §12.8: "Re-enrichment
// never overwrites manually verified fields" — enforced here by merging over
// the existing jsonb rather than replacing it).
//
// corporate_prospects has no organization_id (SCHEMA_REGISTRY_v2.md §4.4:
// shared, not org-scoped, like foundation_directory). BaseAgent still
// requires an organizationId for its own agent_runs audit trail — pass
// whichever org's request queued this enrichment (e.g. a Donor Discovery /
// Corporate Intelligence search). It is never used to filter or scope the
// corporate_prospects row itself.

import type { SupabaseClient } from "@supabase/supabase-js";

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export interface CorporateProspectRow {
  id: string;
  legal_name: string;
  website: string | null;
  ein: string | null;
  enrichment: Record<string, unknown> | null;
  enrichment_version: number | null;
}

/** Fetches the columns every EA-0X agent needs. Returns null if not found. */
export async function fetchProspect(
  client: SupabaseClient,
  prospectId: string,
): Promise<CorporateProspectRow | null> {
  const { data, error } = await client
    .from("corporate_prospects")
    .select("id, legal_name, website, ein, enrichment, enrichment_version")
    .eq("id", prospectId)
    .maybeSingle();

  if (error || !data) return null;
  return data as unknown as CorporateProspectRow;
}

/**
 * Merges `patch` into the prospect's existing `enrichment` jsonb (existing
 * keys not present in `patch` are preserved) and bumps enrichment_version.
 */
export async function mergeEnrichmentPatch(
  client: SupabaseClient,
  prospect: CorporateProspectRow,
  patch: Record<string, unknown>,
): Promise<void> {
  const merged = { ...(prospect.enrichment ?? {}), ...patch };
  const now = new Date().toISOString();

  await client
    .from("corporate_prospects")
    .update({
      enrichment: merged,
      enrichment_version: (prospect.enrichment_version ?? 0) + 1,
      enrichment_completed_at: now,
      last_verified_at: now,
    })
    .eq("id", prospect.id);
}

/** Resolves `{origin}{path}` candidate URLs from a prospect's website. Returns [] on an unparseable website. */
export function buildCandidateUrls(website: string, paths: readonly string[]): string[] {
  try {
    const origin = new URL(website).origin;
    return paths.map((p) => `${origin}${p}`);
  } catch {
    return [];
  }
}

/** Strips a ```json fence (if present) and parses the remainder as JSON. Returns `fallback` on any parse failure. */
export function parseClaudeJson<T>(text: string, fallback: T): T {
  const clean = text
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```\s*$/, "")
    .trim();
  try {
    return JSON.parse(clean) as T;
  } catch {
    return fallback;
  }
}

/** Truncates fetched HTML before handing it to Claude, matching corporate-scraper.ts's 80k-char budget. */
export function truncateForClaude(html: string, maxChars = 80_000): string {
  return html.length > maxChars ? html.slice(0, maxChars) : html;
}
