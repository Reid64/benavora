// Community Resource Matcher — row #226 "Community Resource Graph" MVP,
// scoped down per the queue-37 preflight (SESSION_STATE.md): AG-35's real
// output (community_need_signals, migration 090) has no lat/lng and no
// structured location join, and pig_nodes/pig_edges is a *different*,
// unrelated graph (AG-32/AG-23's people/org relationship graph, not
// need/resource data) — so this is a keyword + geographic-text-overlap
// ranked list against this org's own real funders/opportunities/programs,
// not a graph-traversal pathfinder.
//
// Scoring reuses the exact Jaccard-similarity-of-tokenized-text pattern
// already proven in semantic-matcher.ts (matchFunders), plus a geographic
// text-overlap bonus in place of that function's exact-state-match bonus,
// since none of funders.geographic_focus / opportunities.geographic_restrictions
// / community_need_signals.geographic_area are structured (all free text).

import type { SupabaseClient } from "@supabase/supabase-js";

export interface CommunityNeedSignalInput {
  signal_source: string;
  signal_category: string;
  signal_description: string;
  geographic_area: string | null;
}

export type ResourceType = "funder" | "opportunity" | "program";

export interface ResourceMatch {
  type: ResourceType;
  id: string;
  name: string;
  score: number;
  matchReasons: string[];
  meta: Record<string, unknown>;
}

const STOPWORDS = new Set([
  "the",
  "a",
  "an",
  "of",
  "for",
  "to",
  "in",
  "and",
  "or",
  "is",
  "on",
  "with",
  "this",
  "that",
  "are",
  "by",
]);

const GEO_MATCH_BONUS = 0.25;
const MAX_MATCHES = 10;
const RESOURCE_ROW_LIMIT = 500;

function tokenize(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((word) => word.length > 2 && !STOPWORDS.has(word)),
  );
}

function jaccardSimilarity(
  a: Set<string>,
  b: Set<string>,
): { score: number; shared: string[] } {
  const shared = [...a].filter((word) => b.has(word));
  const unionSize = a.size + b.size - shared.length;
  return { score: unionSize === 0 ? 0 : shared.length / unionSize, shared };
}

function geoOverlap(signalArea: string | null, resourceArea: string | null): boolean {
  if (!signalArea || !resourceArea) return false;
  const signalTokens = tokenize(signalArea);
  const resourceTokens = tokenize(resourceArea);
  for (const word of signalTokens) {
    if (resourceTokens.has(word)) return true;
  }
  return false;
}

function buildMatchReasons(
  sharedWords: string[],
  geoMatch: boolean,
  geoText: string | null,
): string[] {
  const reasons: string[] = [];
  const keywordSlots = geoMatch ? 2 : 3;

  for (const word of sharedWords.slice(0, keywordSlots)) {
    reasons.push(`Shares "${word}" with this need`);
  }
  if (geoMatch && geoText) {
    reasons.push(`Serves the same area: ${geoText}`);
  }
  if (reasons.length === 0) {
    reasons.push("Limited keyword overlap with this need");
  }

  return reasons.slice(0, 3);
}

function humanizeEnum(value: string | null | undefined): string {
  return (value ?? "").replace(/_/g, " ");
}

interface FunderRow {
  id: string;
  name: string;
  category: string | null;
  description: string | null;
  geographic_focus: string | null;
}

interface OpportunityRow {
  id: string;
  name: string;
  category: string | null;
  description: string | null;
  geographic_restrictions: string | null;
  amount_min: number | null;
  amount_max: number | null;
  deadline: string | null;
}

interface ProgramRow {
  id: string;
  name: string;
  description: string | null;
  status: string | null;
}

/**
 * Ranks this org's real funders, open opportunities, and active programs
 * against a single community need signal by keyword + geographic-text
 * overlap. Returns only resources with a real, nonzero match — never pads
 * the list with unrelated resources to hit a target count.
 */
export async function matchResourcesForSignal(
  supabase: SupabaseClient,
  organizationId: string,
  signal: CommunityNeedSignalInput,
): Promise<ResourceMatch[]> {
  const queryText = [
    humanizeEnum(signal.signal_source),
    signal.signal_category,
    signal.signal_description,
  ].join(" ");
  const queryTokens = tokenize(queryText);

  const [fundersRes, opportunitiesRes, programsRes] = await Promise.all([
    supabase
      .from("funders")
      .select("id, name, category, description, geographic_focus")
      .eq("organization_id", organizationId)
      .limit(RESOURCE_ROW_LIMIT),
    supabase
      .from("opportunities")
      .select(
        "id, name, category, description, geographic_restrictions, amount_min, amount_max, deadline",
      )
      .eq("organization_id", organizationId)
      .eq("status", "open")
      .limit(RESOURCE_ROW_LIMIT),
    supabase
      .from("programs")
      .select("id, name, description, status")
      .eq("organization_id", organizationId)
      .eq("status", "active")
      .limit(RESOURCE_ROW_LIMIT),
  ]);

  const matches: ResourceMatch[] = [];

  for (const f of (fundersRes.data ?? []) as FunderRow[]) {
    const corpus = tokenize(
      [humanizeEnum(f.category), f.name, f.description ?? ""].join(" "),
    );
    const { score: keywordScore, shared } = jaccardSimilarity(queryTokens, corpus);
    const geoMatch = geoOverlap(signal.geographic_area, f.geographic_focus);
    const score = Math.min(1, keywordScore + (geoMatch ? GEO_MATCH_BONUS : 0));
    if (score <= 0) continue;

    matches.push({
      type: "funder",
      id: f.id,
      name: f.name,
      score,
      matchReasons: buildMatchReasons(shared, geoMatch, f.geographic_focus),
      meta: { category: f.category },
    });
  }

  for (const o of (opportunitiesRes.data ?? []) as OpportunityRow[]) {
    const corpus = tokenize(
      [humanizeEnum(o.category), o.name, o.description ?? ""].join(" "),
    );
    const { score: keywordScore, shared } = jaccardSimilarity(queryTokens, corpus);
    const geoMatch = geoOverlap(signal.geographic_area, o.geographic_restrictions);
    const score = Math.min(1, keywordScore + (geoMatch ? GEO_MATCH_BONUS : 0));
    if (score <= 0) continue;

    matches.push({
      type: "opportunity",
      id: o.id,
      name: o.name,
      score,
      matchReasons: buildMatchReasons(shared, geoMatch, o.geographic_restrictions),
      meta: {
        category: o.category,
        amount_min: o.amount_min,
        amount_max: o.amount_max,
        deadline: o.deadline,
      },
    });
  }

  for (const p of (programsRes.data ?? []) as ProgramRow[]) {
    // programs has no geographic column at all — score is keyword-only.
    const corpus = tokenize([p.name, p.description ?? ""].join(" "));
    const { score, shared } = jaccardSimilarity(queryTokens, corpus);
    if (score <= 0) continue;

    matches.push({
      type: "program",
      id: p.id,
      name: p.name,
      score,
      matchReasons: buildMatchReasons(shared, false, null),
      meta: {},
    });
  }

  return matches.sort((a, b) => b.score - a.score).slice(0, MAX_MATCHES);
}
