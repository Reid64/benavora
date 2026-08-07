// Shared Knowledge Base completeness primitives.
//
// Extracted from AG-11 (Knowledge Gap Agent, knowledge-gap-agent.ts) so its
// org-wide weekly sweep and the per-opportunity Narrative Gap Analysis
// (src/lib/intelligence/narrative-gap-analysis.ts, row #144) check
// completeness the same way instead of two independently-drifting queries.
//
// knowledge_base.category is a strict Postgres enum with exactly 11 real
// values (src/types/database.ts). Excluding 'custom' (a catch-all, not a
// standard category with a completeness expectation) leaves the 10 real
// values below.

import type { SupabaseClient } from "@supabase/supabase-js";

import type { Enums } from "@/types/database";

export type KnowledgeBaseCategory = Enums<"knowledge_base_category">;

/** The 10 real, non-'custom' knowledge_base_category enum values. */
export const STANDARD_KB_CATEGORIES: KnowledgeBaseCategory[] = [
  "mission",
  "vision",
  "need_statement",
  "program_description",
  "impact",
  "capacity",
  "sustainability",
  "partnerships",
  "budget_justification",
  "organizational_history",
];

/**
 * Returns the subset of `categories` (defaults to all 10 standard
 * categories) that have at least one knowledge_base row for this org.
 */
export async function getPresentKbCategories(
  supabase: SupabaseClient,
  orgId: string,
  categories: KnowledgeBaseCategory[] = STANDARD_KB_CATEGORIES,
): Promise<Set<KnowledgeBaseCategory>> {
  const { data, error } = await supabase
    .from("knowledge_base")
    .select("category")
    .eq("organization_id", orgId)
    .in("category", categories);

  if (error) {
    throw new Error(`Failed to load knowledge base: ${error.message}`);
  }

  return new Set((data ?? []).map((r) => r.category as KnowledgeBaseCategory));
}
