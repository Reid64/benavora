// Read-path mission-relevance filtering for the Opportunities dashboard
// (src/app/(dashboard)/opportunities/page.tsx via src/app/api/opportunities/route.ts).
//
// Root cause this fixes: the dashboard previously read every row of an org's
// `opportunities` table with zero relevance filtering - RLS scopes rows to
// the org, but nothing scoped them to the org's actual mission. This reuses
// the exact embedding-based KB relevance mechanism the government-grants
// research agent already uses to reject discoveries at ingestion time
// (buildKbScorer/buildOrgFocusText, src/lib/agents/research/kb-relevance.ts;
// KB_REJECT_THRESHOLD=15 in government-grants.ts) so opportunities that never
// went through that filter (direct feeds: grants.gov, federal_register,
// ca_grants_portal, hud.gov, land_bank, etc.) get the same treatment on read.

import type { SupabaseClient } from "@supabase/supabase-js";

import { buildKbScorer } from "@/lib/agents/research/kb-relevance";

/** Same reject threshold GovernmentGrantsResearchAgent already uses at
 * ingestion time (government-grants.ts KB_REJECT_THRESHOLD) - kept identical
 * so the read-path gate and the write-path gate agree on what "relevant"
 * means. */
export const MISSION_RELEVANCE_REJECT_THRESHOLD = 15;

/** Bounds how many never-scored opportunities one page load will pay the
 * embedding cost for. Remaining rows stay unscored and are reported via
 * `pendingCount`, not silently dropped or silently shown. */
export const MAX_SCORED_PER_REQUEST = 200;

export interface RelevanceCandidate {
  id: string;
  name: string;
  description: string | null;
  mission_relevance_score: number | null;
}

export interface RelevanceScanResult {
  /** id -> newly computed score, for candidates scored during this call. */
  scores: Map<string, number>;
  /** Previously-unscored candidates left unscored after this call's cap. */
  pendingCount: number;
  /** False when there is no scorer to build (no OPENAI_API_KEY, or the org
   * has no active search_profiles and no knowledge_base rows to focus
   * against) - callers must not treat "can't judge" as "show everything
   * unfiltered" AND must not treat it as "reject everything"; the UI's
   * visible relevance toggle is the safety net for this state. */
  filterActive: boolean;
}

/**
 * Scores previously-unscored candidates (mission_relevance_score === null)
 * against the org's real configured focus and persists the result, up to
 * MAX_SCORED_PER_REQUEST per call. Never fabricates a score for a row it
 * doesn't actually score.
 */
export async function scanUnscoredRelevance(
  client: SupabaseClient,
  organizationId: string,
  candidates: RelevanceCandidate[],
): Promise<RelevanceScanResult> {
  const unscored = candidates.filter((c) => c.mission_relevance_score === null);
  if (unscored.length === 0) {
    return { scores: new Map(), pendingCount: 0, filterActive: true };
  }

  const scorer = await buildKbScorer({ client, organizationId });
  if (!scorer) {
    return { scores: new Map(), pendingCount: unscored.length, filterActive: false };
  }

  const toScore = unscored.slice(0, MAX_SCORED_PER_REQUEST);
  const scores = new Map<string, number>();
  for (const c of toScore) {
    const score = await scorer.score(`${c.name} ${c.description ?? ""}`);
    scores.set(c.id, score);
  }

  await Promise.all(
    Array.from(scores.entries()).map(([id, score]) =>
      client
        .from("opportunities")
        .update({
          mission_relevance_score: score,
          mission_relevance_scored_at: new Date().toISOString(),
        })
        .eq("id", id),
    ),
  );

  return {
    scores,
    pendingCount: unscored.length - toScore.length,
    filterActive: true,
  };
}

/**
 * The default relevance gate applied at read time. `includeUnscored` is the
 * visible override the Opportunities page exposes (a permanent safety net,
 * not a replacement for scoring) - when true, never-scored rows are shown
 * (clearly labeled by the caller) rather than silently hidden forever.
 */
export function passesRelevanceFilter(
  score: number | null,
  minRelevance: number,
  includeUnscored: boolean,
): boolean {
  if (score === null) return includeUnscored;
  return score >= minRelevance;
}
