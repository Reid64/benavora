// GET /api/donor-discovery/taxonomy/search?q=... — typeahead lookup for the
// New Discovery wizard's taxonomy picker (DONOR_DISCOVERY_ARCHITECTURE.md
// §1, §4.2). donor_discovery_taxonomy is shared reference data with no RLS,
// but the route still requires an authenticated session like every other
// Donor Discovery route.
//
// Matches on donor_discovery_taxonomy_aliases.alias first (the plain-language
// trade names from scripts/seed-dd-aliases.ts — "septic installer" for NAICS
// 562991), then falls back to donor_discovery_taxonomy.label for anything an
// alias didn't cover. Returns the top 20 ranked by match quality (exact alias
// > alias prefix > alias substring > label prefix > label substring).

import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";

import { requireRole } from "@/lib/auth/role-gate";

export const runtime = "nodejs";

const RESULT_LIMIT = 20;
const CANDIDATE_LIMIT = 200;

interface TaxonomyRow {
  id: string;
  code: string;
  label: string;
  kind: string;
  parent_id: string | null;
}

interface RankedMatch {
  node: TaxonomyRow;
  rank: number;
  matchedAlias: string | null;
}

function jsonError(message: string, code: string, status: number) {
  return NextResponse.json({ error: message, code }, { status });
}

/** Escapes PostgREST ilike wildcards so user input is matched literally. */
function escapeIlike(value: string): string {
  return value.replace(/[\\%_]/g, (c) => `\\${c}`);
}

function rankOf(haystack: string, needle: string): number | null {
  const h = haystack.toLowerCase();
  const n = needle.toLowerCase();
  if (h === n) return 0;
  if (h.startsWith(n)) return 1;
  if (h.includes(n)) return 2;
  return null;
}

export async function GET(request: Request) {
  const gate = await requireRole("viewer");
  if ("error" in gate) return gate.error;
  const { supabase } = gate;

  const url = new URL(request.url);
  const q = (url.searchParams.get("q") ?? "").trim();
  if (!q) {
    return jsonError("q is required.", "MISSING_QUERY", 400);
  }

  const pattern = `%${escapeIlike(q)}%`;

  const [aliasResult, labelResult] = await Promise.all([
    supabase
      .from("donor_discovery_taxonomy_aliases")
      .select("alias, donor_discovery_taxonomy(id, code, label, kind, parent_id)")
      .ilike("alias", pattern)
      .limit(CANDIDATE_LIMIT),
    supabase
      .from("donor_discovery_taxonomy")
      .select("id, code, label, kind, parent_id")
      .ilike("label", pattern)
      .limit(CANDIDATE_LIMIT),
  ]);

  if (aliasResult.error || labelResult.error) {
    return jsonError("Failed to search taxonomy.", "SEARCH_FAILED", 500);
  }

  const bestByNode = new Map<string, RankedMatch>();

  const considerAlias = (node: TaxonomyRow | null | undefined, alias: string) => {
    if (!node) return;
    const rank = rankOf(alias, q);
    if (rank === null) return;
    const existing = bestByNode.get(node.id);
    if (!existing || rank < existing.rank) {
      bestByNode.set(node.id, { node, rank, matchedAlias: alias });
    }
  };

  const considerLabel = (node: TaxonomyRow) => {
    const rank = rankOf(node.label, q);
    if (rank === null) return;
    // Label matches rank below alias matches of the same tier (0/1/2 -> 3/4/5),
    // so an alias hit always outranks a label hit at the same string-match tier.
    const labelRank = rank + 3;
    const existing = bestByNode.get(node.id);
    if (!existing || labelRank < existing.rank) {
      bestByNode.set(node.id, { node, rank: labelRank, matchedAlias: existing?.matchedAlias ?? null });
    }
  };

  for (const row of (aliasResult.data ?? []) as Array<{
    alias: string;
    donor_discovery_taxonomy: TaxonomyRow | TaxonomyRow[] | null;
  }>) {
    const node = Array.isArray(row.donor_discovery_taxonomy)
      ? row.donor_discovery_taxonomy[0]
      : row.donor_discovery_taxonomy;
    considerAlias(node, row.alias);
  }

  for (const node of (labelResult.data ?? []) as TaxonomyRow[]) {
    considerLabel(node);
  }

  const ranked = [...bestByNode.values()].sort((a, b) => {
    if (a.rank !== b.rank) return a.rank - b.rank;
    return a.node.label.localeCompare(b.node.label);
  });
  const top = ranked.slice(0, RESULT_LIMIT);

  const ancestryLabels = await buildAncestryLabels(
    supabase,
    top.map((m) => m.node),
  );

  const results = top.map((m) => ({
    id: m.node.id,
    code: m.node.code,
    label: m.node.label,
    kind: m.node.kind,
    ancestry_label: ancestryLabels.get(m.node.id) ?? null,
    matched_alias: m.matchedAlias,
  }));

  return NextResponse.json({ results });
}

/**
 * Resolves each node's ancestor chain (e.g. sector -> industry group, for a
 * 6-digit NAICS leaf) into a single "Sector > Industry Group" breadcrumb.
 * NAICS depth is capped at 3 levels (§1A: 2-digit sector, 4-digit group,
 * 6-digit national industry) so two hops upward always suffices, but the
 * walk is written generically in case a deeper tree is added later.
 */
async function buildAncestryLabels(
  supabase: SupabaseClient,
  nodes: TaxonomyRow[],
): Promise<Map<string, string>> {
  const known = new Map<string, { label: string; parent_id: string | null }>();
  for (const n of nodes) known.set(n.id, { label: n.label, parent_id: n.parent_id });

  let frontier = new Set<string>();
  for (const n of nodes) {
    if (n.parent_id && !known.has(n.parent_id)) frontier.add(n.parent_id);
  }

  const MAX_HOPS = 5; // real NAICS depth is 2; this is a generous safety cap
  for (let hop = 0; hop < MAX_HOPS && frontier.size > 0; hop++) {
    const ids = [...frontier];
    const { data, error } = await supabase
      .from("donor_discovery_taxonomy")
      .select("id, label, parent_id")
      .in("id", ids);
    if (error || !data) break;

    frontier = new Set<string>();
    for (const row of data as Array<{ id: string; label: string; parent_id: string | null }>) {
      known.set(row.id, { label: row.label, parent_id: row.parent_id });
      if (row.parent_id && !known.has(row.parent_id)) frontier.add(row.parent_id);
    }
  }

  const ancestryLabels = new Map<string, string>();
  for (const n of nodes) {
    const chain: string[] = [];
    let cursor = n.parent_id;
    let guard = 0;
    while (cursor && guard < MAX_HOPS) {
      const ancestor = known.get(cursor);
      if (!ancestor) break;
      chain.unshift(ancestor.label);
      cursor = ancestor.parent_id;
      guard++;
    }
    if (chain.length > 0) ancestryLabels.set(n.id, chain.join(" > "));
  }

  return ancestryLabels;
}
