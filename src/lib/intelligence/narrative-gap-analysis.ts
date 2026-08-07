// Per-opportunity Narrative Gap Analysis (FEATURE_REGISTRY_v2.md row #144:
// "Narrative Gap Analysis - KB completeness scoring vs funder requirements").
//
// AG-11 (Knowledge Gap Agent, src/lib/agents/knowledge-gap-agent.ts) already
// does real, live, weekly org-wide KB completeness scoring - it checks the
// org's knowledge_base rows against all 10 standard categories and flags
// whichever are missing, regardless of what any particular funder actually
// asks for. This module is the half AG-11 doesn't do: score completeness
// against what a SPECIFIC opportunity's own listed requirements draw on,
// not the org's KB in the abstract.
//
// opportunities has no structured field describing which narrative sections
// a given funder requires (checked src/types/database.ts directly:
// required_documents is a free-text string[] of document names like
// "Letters of Support" or "Budget Narrative", not a set of
// knowledge_base_category values; eligibility_requirements is free text).
// There is no real per-opportunity requirement schema to key off of, so
// this is an honest best-effort heuristic, not a lookup against a real
// mapping: it keyword-matches required_documents/eligibility_requirements
// against a small phrase list per category, and narrows relevantCategories
// to only the categories a match was found for. When nothing matches (the
// common case - most opportunities on file don't have explicit narrative-
// section wording), it falls back to "assume all 10 standard categories are
// relevant," the same set AG-11 checks org-wide. This fallback is stated
// explicitly in the returned `methodology` field rather than left implicit,
// so a caller can tell a narrowed, funder-specific read apart from the
// generic fallback.
//
// This is a request-scoped read, not a new scheduled agent: no agent_runs/
// agent_decisions rows are written here, matching the "opportunity/
// application detail view" use case this was built for (e.g. "how ready is
// my content for this specific grant") rather than AG-11's autonomous
// weekly sweep. It reuses AG-11's own KB-presence query via
// knowledge-base-completeness.ts rather than re-querying knowledge_base
// independently.

import type { SupabaseClient } from "@supabase/supabase-js";

import {
  STANDARD_KB_CATEGORIES,
  getPresentKbCategories,
  type KnowledgeBaseCategory,
} from "@/lib/agents/knowledge-base-completeness";

/**
 * Best-effort phrase list per category, matched case-insensitively as a
 * substring against `required_documents` (joined) and
 * `eligibility_requirements`. Not a real schema - a heuristic over free
 * text, documented as such in this file's header. Only used to *narrow*
 * relevantCategories (never to add categories beyond the standard 10).
 */
const CATEGORY_KEYWORDS: Record<KnowledgeBaseCategory, string[]> = {
  mission: ["mission statement", "mission narrative"],
  vision: ["vision statement", "vision narrative"],
  need_statement: [
    "statement of need",
    "needs statement",
    "need statement",
    "problem statement",
  ],
  program_description: [
    "program description",
    "program narrative",
    "project description",
    "project narrative",
    "logic model",
  ],
  impact: [
    "impact statement",
    "impact narrative",
    "outcomes report",
    "outcome measures",
    "evaluation plan",
  ],
  capacity: [
    "organizational capacity",
    "capacity statement",
    "staff capacity",
  ],
  sustainability: ["sustainability plan", "sustainability narrative"],
  partnerships: [
    "letters of support",
    "letter of support",
    "partnership agreement",
    "collaboration letter",
    "mou",
  ],
  budget_justification: ["budget justification", "budget narrative"],
  organizational_history: [
    "organizational history",
    "organization history",
    "history of the organization",
  ],
  // 'custom' is deliberately excluded from CATEGORY_KEYWORDS as well as from
  // STANDARD_KB_CATEGORIES - it's a catch-all bucket, not a standard
  // category a funder would ever explicitly name a requirement for.
  custom: [],
};

export interface NarrativeGapAnalysisResult {
  opportunityId: string;
  opportunityName: string;
  relevantCategories: KnowledgeBaseCategory[];
  presentCategories: KnowledgeBaseCategory[];
  missingCategories: KnowledgeBaseCategory[];
  completenessScore: number;
  narrowedByRequirements: boolean;
  methodology: string;
}

function findRelevantCategories(
  requiredDocuments: string[] | null,
  eligibilityRequirements: string | null,
): KnowledgeBaseCategory[] {
  const haystack = [
    ...(requiredDocuments ?? []),
    eligibilityRequirements ?? "",
  ]
    .join(" \n ")
    .toLowerCase();

  if (!haystack.trim()) return [];

  return STANDARD_KB_CATEGORIES.filter((category) =>
    CATEGORY_KEYWORDS[category].some((phrase) => haystack.includes(phrase)),
  );
}

/**
 * Scores this org's Knowledge Base completeness against what one specific
 * opportunity's listed requirements actually draw on (falling back to the
 * same 10 standard categories AG-11 checks org-wide when the opportunity's
 * text doesn't explicitly narrow it).
 */
export async function computeNarrativeGapAnalysis(
  supabase: SupabaseClient,
  organizationId: string,
  opportunityId: string,
): Promise<NarrativeGapAnalysisResult> {
  const { data: opportunity, error: oppError } = await supabase
    .from("opportunities")
    .select("id, name, required_documents, eligibility_requirements")
    .eq("id", opportunityId)
    .eq("organization_id", organizationId)
    .maybeSingle();

  if (oppError) {
    throw new Error(`Failed to load opportunity: ${oppError.message}`);
  }
  if (!opportunity) {
    throw new Error("Opportunity not found.");
  }

  const narrowed = findRelevantCategories(
    opportunity.required_documents,
    opportunity.eligibility_requirements,
  );
  const relevantCategories =
    narrowed.length > 0 ? narrowed : STANDARD_KB_CATEGORIES;

  const present = await getPresentKbCategories(
    supabase,
    organizationId,
    relevantCategories,
  );

  const presentCategories = relevantCategories.filter((c) => present.has(c));
  const missingCategories = relevantCategories.filter((c) => !present.has(c));
  const completenessScore = Math.round(
    (presentCategories.length / relevantCategories.length) * 100,
  );

  const methodology =
    narrowed.length > 0
      ? `Scored against ${relevantCategories.length} of 10 standard categories, narrowed from this opportunity's required_documents/eligibility_requirements text (keyword match, best-effort - not a real per-funder requirement schema).`
      : `This opportunity's required_documents/eligibility_requirements didn't explicitly name any standard category, so all 10 standard categories were assumed relevant (same set AG-11's org-wide sweep checks).`;

  return {
    opportunityId: opportunity.id,
    opportunityName: opportunity.name,
    relevantCategories,
    presentCategories,
    missingCategories,
    completenessScore,
    narrowedByRequirements: narrowed.length > 0,
    methodology,
  };
}
