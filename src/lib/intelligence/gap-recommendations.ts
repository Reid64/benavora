// Gap Recommendations (FEATURE_REGISTRY_v2.md row #146: "Gap Recommendations
// - specific improvement actions per gap").
//
// This is a synthesis/display layer over two real, already-computed data
// sources - it is NOT a new autonomous agent (no agent_runs/agent_decisions
// row, no schedule, no queue trigger), per this task's own framing:
//   - src/lib/intelligence/narrative-gap-analysis.ts (row #144, already
//     built) - per-opportunity Knowledge Base completeness vs. that
//     opportunity's stated requirements.
//   - src/lib/intelligence/geographic-gap-analysis.ts (row #145, this same
//     build) - portfolio-wide funder/opportunity geographic text mismatch.
//
// For each flagged gap this produces one concrete, specific next action -
// mirroring AG-11's (knowledge-gap-agent.ts) own "concrete, not 'add more
// information'" suggestion style. Unlike AG-11, these tips are static/
// deterministic rather than Claude-generated: this is a request-scoped
// read for a UI view, not an autonomous decision that needs its own
// reasoning trail, so there is no need for (or value in) a Claude call here.

import type { SupabaseClient } from "@supabase/supabase-js";

import type { KnowledgeBaseCategory } from "@/lib/agents/knowledge-base-completeness";
import {
  computeNarrativeGapAnalysis,
  type NarrativeGapAnalysisResult,
} from "@/lib/intelligence/narrative-gap-analysis";
import {
  computeGeographicGapAnalysis,
  MAX_OPPORTUNITIES_FOR_GEOGRAPHIC_SCAN,
  type GeographicGapFinding,
} from "@/lib/intelligence/geographic-gap-analysis";

/** Narrative gap analysis re-queries the opportunity + KB per call, so the
 * portfolio sweep is capped tighter than the geographic scan (which is one
 * query per portfolio) to keep this route's total query count predictable.
 * Soonest-deadline-first, same ordering as the geographic scan. */
export const MAX_OPPORTUNITIES_FOR_NARRATIVE_SCAN = 15;

/** Concrete, category-specific tips - same 10 standard categories AG-11
 * checks org-wide (knowledge_base_category enum minus the 'custom' catch-all).
 * Phrased the same way AG-11's own Claude prompt asks for: a specific,
 * actionable sentence referencing what a strong entry in that category
 * typically contains, not a generic "add information about X." */
const CATEGORY_TIPS: Record<KnowledgeBaseCategory, string> = {
  mission:
    'Add a "mission" Knowledge Base entry — 1-2 sentences stating your organization\'s core purpose and who it serves.',
  vision:
    'Add a "vision" Knowledge Base entry — a forward-looking statement of the long-term change you\'re working toward.',
  need_statement:
    'Add a "need statement" Knowledge Base entry — cite specific data (rates, counts, service gaps) establishing the problem in your service area, not a general description.',
  program_description:
    'Add a "program description" Knowledge Base entry — name the specific program(s), activities, and target population, not just a mission-level summary.',
  impact:
    'Add an "impact" Knowledge Base entry — specific outcome numbers and beneficiary counts from past work, not vague claims of success.',
  capacity:
    'Add a "capacity" Knowledge Base entry — staff/board qualifications and organizational infrastructure that show you can deliver this program.',
  sustainability:
    'Add a "sustainability" Knowledge Base entry — how the program continues after this grant (other funding sources, revenue plan, community support).',
  partnerships:
    'Add a "partnerships" Knowledge Base entry — named collaborating organizations and what each one specifically contributes.',
  budget_justification:
    'Add a "budget justification" Knowledge Base entry — line-item cost rationale, not just totals.',
  organizational_history:
    'Add an "organizational history" Knowledge Base entry — founding year, milestones, and track record relevant to this kind of funding.',
  custom: "Review this custom Knowledge Base category for completeness.",
};

export interface GapRecommendation {
  type: "narrative" | "geographic";
  category?: KnowledgeBaseCategory;
  message: string;
}

export interface OpportunityGapSummary {
  opportunityId: string;
  opportunityName: string;
  narrativeCompletenessScore: number;
  missingCategories: KnowledgeBaseCategory[];
  narrowedByRequirements: boolean;
  geographicMismatch: GeographicGapFinding | null;
  recommendations: GapRecommendation[];
}

export interface PortfolioGapAnalysis {
  orgServiceArea: string | null;
  opportunitiesScanned: number;
  narrativeScanCapped: boolean;
  geographicMethodology: string;
  perOpportunity: OpportunityGapSummary[];
}

function buildRecommendations(
  narrative: NarrativeGapAnalysisResult,
  geoMismatch: GeographicGapFinding | null,
): GapRecommendation[] {
  const recs: GapRecommendation[] = narrative.missingCategories.map(
    (category) => ({
      type: "narrative" as const,
      category,
      message: CATEGORY_TIPS[category],
    }),
  );

  if (geoMismatch) {
    const sourceLabel =
      geoMismatch.source === "funder" && geoMismatch.funderName
        ? `${geoMismatch.funderName}'s stated geographic focus`
        : "this opportunity's stated geographic restriction";
    recs.push({
      type: "geographic",
      message:
        `${sourceLabel} ("${geoMismatch.geographicText}") doesn't appear to overlap your organization's service area — verify eligibility directly with the funder before applying, or don't route this one to AutoApply until confirmed.`,
    });
  }

  return recs;
}

/**
 * Portfolio-wide synthesis: runs the geographic scan once, then the
 * per-opportunity narrative gap check (row #144, already built) for the
 * soonest-deadline subset of that same open portfolio, and combines both
 * into a concrete, per-opportunity recommendation list.
 */
export async function computePortfolioGapAnalysis(
  supabase: SupabaseClient,
  organizationId: string,
): Promise<PortfolioGapAnalysis> {
  const geo = await computeGeographicGapAnalysis(supabase, organizationId);

  const geoByOpportunityId = new Map<string, GeographicGapFinding>(
    geo.mismatches.map((m) => [m.opportunityId, m]),
  );

  const { data: opportunities, error } = await supabase
    .from("opportunities")
    .select("id, name")
    .eq("organization_id", organizationId)
    .eq("status", "open")
    .order("deadline", { ascending: true, nullsFirst: false })
    .limit(MAX_OPPORTUNITIES_FOR_NARRATIVE_SCAN);

  if (error) {
    throw new Error(`Failed to load opportunities: ${error.message}`);
  }

  const opps = (opportunities ?? []) as { id: string; name: string }[];

  const perOpportunity: OpportunityGapSummary[] = [];
  for (const opp of opps) {
    const narrative = await computeNarrativeGapAnalysis(
      supabase,
      organizationId,
      opp.id,
    );
    const geoMismatch = geoByOpportunityId.get(opp.id) ?? null;

    perOpportunity.push({
      opportunityId: opp.id,
      opportunityName: opp.name,
      narrativeCompletenessScore: narrative.completenessScore,
      missingCategories: narrative.missingCategories,
      narrowedByRequirements: narrative.narrowedByRequirements,
      geographicMismatch: geoMismatch,
      recommendations: buildRecommendations(narrative, geoMismatch),
    });
  }

  return {
    orgServiceArea: geo.orgServiceArea,
    opportunitiesScanned: opps.length,
    narrativeScanCapped: opps.length === MAX_OPPORTUNITIES_FOR_NARRATIVE_SCAN,
    geographicMethodology: geo.methodology,
    perOpportunity,
  };
}

export { MAX_OPPORTUNITIES_FOR_GEOGRAPHIC_SCAN };
