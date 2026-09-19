// Core draft generation logic shared by the interactive /api/ai/draft route and
// the autonomous DraftAutoGenerator. Extracted so there is exactly one code path
// for all draft generation — manual and automatic.

import type { SupabaseClient } from "@supabase/supabase-js";

import {
  callClaude,
  DEFAULT_MAX_TOKENS,
  DEFAULT_MODEL,
} from "@/lib/ai/claude";
import { buildGrantNarrativePrompt } from "@/lib/ai/prompts/grant-narrative";
import { buildDonationRequestPrompt } from "@/lib/ai/prompts/donation-request";
import {
  retrieveIntelligence,
  retrieveRubric,
  retrieveLogicModel,
  type IntelligenceResult,
  type ScoringRubric,
  type LogicModel,
} from "@/lib/intelligence/rag-retrieval";
import {
  queryKnowledgeEngine,
  type KnowledgeEngineResult,
} from "@/lib/intelligence/knowledge-engine";
import { NeedStatementEngine } from "@/lib/intelligence/need-statement-engine";
import type { NeedDataPoint } from "@/lib/intelligence/sources/types";
import { draftCreated } from "@/lib/observability/metrics";
import {
  generateLogicModel,
  formatLogicModelAsText,
  type GeneratedLogicModel,
} from "@/lib/intelligence/logic-model-generator";
import { BudgetPatternLibrary, type BudgetTemplate } from "@/lib/intelligence/budget-patterns";
import { EvaluationLibrary, type KPI } from "@/lib/intelligence/evaluation-library";
import { ComplianceLibrary, type ComplianceCheckResult } from "@/lib/intelligence/compliance-library";
import { buildFactCorpus, scrubUnverifiedFigures } from "@/lib/drafts/fact-guard";
import type {
  DraftPromptContext,
  DraftTemplateType,
  KnowledgeSource,
  SavedDraftVersion,
  SuccessPatternAnalysis,
  SuccessPatternEntry,
} from "@/types/ai";
import type { Database, Enums, Json } from "@/types/database";

type KbCategory = Enums<"knowledge_base_category">;

export const VALID_TEMPLATE_TYPES: DraftTemplateType[] = [
  "grant_narrative",
  "donation_request_letter",
  "budget_narrative",
  "impact_statement",
  "letter_of_inquiry",
  "full_proposal",
];

// Which Knowledge Base categories feed each template type.
export const TEMPLATE_KB_CATEGORIES: Record<DraftTemplateType, KbCategory[]> = {
  grant_narrative: [
    "mission",
    "vision",
    "need_statement",
    "program_description",
    "impact",
    "capacity",
    "sustainability",
    "partnerships",
    "organizational_history",
    "budget_justification",
  ],
  donation_request_letter: [
    "mission",
    "need_statement",
    "impact",
    "program_description",
  ],
  budget_narrative: [
    "budget_justification",
    "program_description",
    "capacity",
    "sustainability",
  ],
  impact_statement: ["impact", "mission", "program_description"],
  letter_of_inquiry: [
    "mission",
    "need_statement",
    "program_description",
    "impact",
  ],
  full_proposal: [
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
  ],
};

// Which intelligence section types are most relevant per template.
export const TEMPLATE_SECTION_TYPES: Record<DraftTemplateType, string[]> = {
  grant_narrative: [
    "executive_summary",
    "need_statement",
    "problem_framing",
    "program_design",
    "outcomes",
    "methodology",
  ],
  donation_request_letter: ["executive_summary", "need_statement"],
  budget_narrative: ["budget_narrative"],
  impact_statement: ["outcomes", "evaluation_plan"],
  letter_of_inquiry: [
    "executive_summary",
    "need_statement",
    "program_design",
  ],
  full_proposal: [
    "executive_summary",
    "need_statement",
    "problem_framing",
    "program_design",
    "outcomes",
    "evaluation_plan",
    "sustainability",
    "budget_narrative",
    "methodology",
    "capacity",
    "partnerships",
  ],
};

/**
 * Pull the winning_patterns from the first proven_narrative row that has a
 * non-null success_patterns JSONB.
 */
export function extractTopPatterns(rawPatterns: unknown[]): SuccessPatternEntry[] {
  for (const raw of rawPatterns) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) continue;
    const analysis = raw as Partial<SuccessPatternAnalysis>;
    if (
      Array.isArray(analysis.winning_patterns) &&
      analysis.winning_patterns.length > 0
    ) {
      return analysis.winning_patterns
        .filter(
          (p): p is SuccessPatternEntry =>
            typeof p === "object" &&
            p !== null &&
            typeof (p as SuccessPatternEntry).description === "string",
        )
        .slice(0, 3);
    }
  }
  return [];
}

/**
 * Heuristic confidence score. Reflects how much of the draft is grounded in
 * verified data versus AI-generated content.
 */
export function computeConfidence(
  draftText: string,
  kbCount: number,
  provenCount: number,
): number {
  const needsInput = (draftText.match(/\[NEEDS INPUT/gi) ?? []).length;

  if (kbCount === 0) {
    return Math.max(55, 65 - needsInput * 3);
  }

  let score = 92;
  if (provenCount === 0) score -= 4;
  if (kbCount < 3) score -= 12;
  score -= needsInput * 3;

  return Math.max(0, Math.min(100, score));
}

/**
 * Parse rubric dimensions jsonb into a detailed prompt section and a
 * client-facing summary.
 */
export function buildDetailedRubricSection(rubric: ScoringRubric): {
  promptText: string;
  dimensionSummary: Array<{
    name: string;
    points: number | null;
    description: string | null;
  }>;
} {
  const dims = rubric.dimensions;
  const dimensionSummary: Array<{
    name: string;
    points: number | null;
    description: string | null;
  }> = [];
  const lines: string[] = [
    "SCORING OPTIMIZATION — This grant will be evaluated by reviewers using the following scoring dimensions.",
    "For each section you write, mentally score it against the relevant dimension. If a section would score below 80% of available points, rewrite it to be more specific and evidence-based.\n",
  ];

  const processDim = (name: string, val: unknown) => {
    if (!val || typeof val !== "object" || Array.isArray(val)) {
      const points = typeof val === "number" ? val : null;
      dimensionSummary.push({ name, points, description: null });
      lines.push(`• ${name}${points !== null ? ` (${points} pts)` : ""}`);
      return;
    }
    const d = val as Record<string, unknown>;
    const points = typeof d.points === "number" ? d.points : null;
    const description = typeof d.description === "string" ? d.description : null;
    const deductions = Array.isArray(d.common_deductions)
      ? (d.common_deductions as string[])
      : [];
    dimensionSummary.push({ name, points, description });
    lines.push(`• ${name}${points !== null ? ` (${points} pts)` : ""}`);
    if (description) lines.push(`  - Full marks: ${description}`);
    if (deductions.length > 0) lines.push(`  - Avoid: ${deductions.join("; ")}`);
  };

  if (Array.isArray(dims)) {
    for (const item of dims) {
      if (!item || typeof item !== "object" || Array.isArray(item)) continue;
      const d = item as Record<string, unknown>;
      const name = typeof d.name === "string" ? d.name : "Unnamed";
      processDim(name, {
        points: d.points,
        description: d.description,
        common_deductions: d.common_deductions,
      });
    }
  } else {
    for (const [name, val] of Object.entries(dims)) {
      processDim(name, val);
    }
  }

  return { promptText: lines.join("\n"), dimensionSummary };
}

// ---------------------------------------------------------------------------
// Public interface
// ---------------------------------------------------------------------------

export interface GenerateDraftParams {
  supabase: SupabaseClient<Database>;
  organizationId: string;
  opportunityId: string;
  templateType: DraftTemplateType;
  /** Profile ID of the user requesting the draft (null for automated runs). */
  createdByUserId?: string | null;
  /** Value for draft_versions.source. Defaults to "generated". */
  draftSource?: string;
}

export interface GenerateDraftOutput {
  content: string;
  confidenceScore: number;
  /** Count of [NEEDS INPUT] markers in the draft. */
  gapCount: number;
  /** Approximate word count of the draft. */
  wordCount: number;
  sources: KnowledgeSource[];
  /** The draft_versions row saved on generation. Always present — generateDraft() throws rather than returning with an unsaved draft (WGR-129). */
  savedVersion: SavedDraftVersion;
  tokensUsed: number;
  rubricDimensionSummary: Array<{
    name: string;
    points: number | null;
    description: string | null;
  }>;
  logicModel: GeneratedLogicModel | null;
  /** Compliance checklist (null when check itself failed). */
  complianceChecklist: ComplianceCheckResult | null;
  /**
   * AR-17.6: true when the organization had no substantive profile/
   * knowledge-base data to draft from -- `content` is an explicit
   * incomplete-draft notice naming what's missing, not model-generated
   * prose, and no Claude call was made. Callers should surface this
   * distinctly from a normal (even low-confidence) draft.
   */
  incomplete: boolean;
  /** Populated only when `incomplete` is true. */
  missingFacts: string[];
  /**
   * AR-17.6: figure/number claims (percentages, dollar amounts, year/unit/
   * FTE/beneficiary counts) that Claude's response contained but that could
   * not be traced to the organization's stored data or the funder's own
   * opportunity data. Each was replaced with a [NEEDS INPUT] marker in
   * `content` before saving -- this list is what got removed, so a
   * fabricated figure is verifiably absent from the saved draft, not just
   * asserted to be.
   */
  scrubbedFigures: string[];
}

/** Map opportunity source_type + category to a budget grantType string. */
function resolveGrantType(
  sourceType: string | null,
  category: string | null,
): string {
  const src = (sourceType ?? "").toLowerCase();
  const cat = (category ?? "").toLowerCase();
  if (["grants_gov", "sam_gov", "federal"].some((k) => src.includes(k))) return "federal";
  if (["state", "portal"].some((k) => src.includes(k))) return "state";
  if (["foundation", "propublica", "private"].some((k) => src.includes(k))) return "foundation";
  if (src.includes("corporate")) return "corporate";
  if (["federal", "government"].some((k) => cat.includes(k))) return "federal";
  if (cat.includes("state")) return "state";
  if (["foundation", "private"].some((k) => cat.includes(k))) return "foundation";
  return "federal";
}

/**
 * Core draft generation function. Loads org knowledge, queries the intelligence
 * library, constructs and augments the prompt, calls Claude, computes confidence,
 * and saves the draft_version row. Returns all artifacts needed by callers.
 *
 * Callers are responsible for auth enforcement, tier gating, billing metering,
 * audit logging, and agent_run lifecycle management.
 */
export async function generateDraft(
  params: GenerateDraftParams,
): Promise<GenerateDraftOutput> {
  const {
    supabase,
    organizationId,
    opportunityId,
    templateType,
    createdByUserId = null,
    draftSource = "generated",
  } = params;

  // Resolve platform config (model, token budget).
  const { data: configRows } = await supabase
    .from("platform_config")
    .select("key, value")
    .eq("organization_id", organizationId)
    .in("key", ["ai.model", "ai.max_tokens"]);
  const configMap = new Map<string, string>(
    (configRows ?? []).map((r) => [r.key as string, r.value as string]),
  );
  const model = configMap.get("ai.model") ?? DEFAULT_MODEL;
  const maxTokens =
    Number(configMap.get("ai.max_tokens")) || DEFAULT_MAX_TOKENS;

  // Opportunity (expected to be already verified by the caller).
  const { data: opportunity, error: oppError } = await supabase
    .from("opportunities")
    .select("*")
    .eq("id", opportunityId)
    .single();
  if (oppError || !opportunity) {
    throw new Error(`Opportunity ${opportunityId} not found.`);
  }

  // Parallel data load: org profile, KB (template categories), KB (custom),
  // proven narratives for funder category, and funder name.
  const [orgRes, kbResA, kbResB, provenRes, funderRes] = await Promise.all([
    supabase
      .from("organizations")
      .select(
        "name, dba, ein, tax_status, mission_statement, vision_statement, service_area, target_population, founder_name, annual_budget",
      )
      .eq("id", organizationId)
      .single(),
    supabase
      .from("knowledge_base")
      .select("id, title, category, content, is_proven, updated_at")
      .in("category", TEMPLATE_KB_CATEGORIES[templateType])
      .order("is_proven", { ascending: false })
      .order("updated_at", { ascending: false }),
    supabase
      .from("knowledge_base")
      .select("id, title, category, content, is_proven, updated_at")
      .eq("category", "custom")
      .order("is_proven", { ascending: false })
      .order("updated_at", { ascending: false }),
    supabase
      .from("proven_narratives")
      .select(
        "id, narrative_text, section_type, funder_category, effectiveness_score, success_patterns",
      )
      .eq("funder_category", opportunity.category)
      .order("effectiveness_score", { ascending: false, nullsFirst: false })
      .limit(5),
    opportunity.funder_id
      ? supabase
          .from("funders")
          .select("name")
          .eq("id", opportunity.funder_id)
          .single()
      : Promise.resolve({ data: null }),
  ]);

  const org = orgRes.data;

  // Merge template-category KB + custom KB; deduplicate by id; re-sort.
  const kbMerged = [...(kbResA.data ?? []), ...(kbResB.data ?? [])];
  const kbSeen = new Set<string>();
  const kbDeduped = kbMerged.filter((entry) => {
    const id = entry.id as string;
    if (kbSeen.has(id)) return false;
    kbSeen.add(id);
    return true;
  });
  kbDeduped.sort((a, b) => {
    const aProven = Boolean(a.is_proven);
    const bProven = Boolean(b.is_proven);
    if (aProven !== bProven) return bProven ? 1 : -1;
    const aDate = (a.updated_at as string) ?? "";
    const bDate = (b.updated_at as string) ?? "";
    return bDate.localeCompare(aDate);
  });
  const knowledgeEntries = kbDeduped.map((entry) => ({
    id: entry.id as string,
    title: entry.title as string,
    category: entry.category as string,
    content: entry.content as string,
  }));

  const provenNarratives = (provenRes.data ?? []).map((p) => ({
    id: p.id as string,
    sectionType: (p.section_type as string | null) ?? null,
    funderCategory: (p.funder_category as string | null) ?? null,
    effectivenessScore: (p.effectiveness_score as number | null) ?? null,
    narrativeText: p.narrative_text as string,
  }));

  const successPatterns = extractTopPatterns(
    (provenRes.data ?? []).map((p) => p.success_patterns),
  );

  // AR-17.6 (AR-17.4 Lead Finding #3): an organization with no substantive
  // profile or knowledge-base data still went through the same prompt as a
  // richly-documented one and got back confident, fully-invented prose (a
  // fabricated 94% retention rate, twelve years of operation, etc.) scored
  // as the second-highest-confidence draft on the platform. Specificity is
  // a hard requirement, not a scoring adjustment: when there is nothing
  // organization-specific to draft from, return an explicit incomplete
  // result naming what's missing instead of calling Claude at all -- there
  // is no prompt instruction that reliably prevents a model from writing
  // confident, specific-sounding prose when handed an empty profile.
  const missingFacts: string[] = [];
  if (!org?.mission_statement) missingFacts.push("mission statement");
  if (!org?.service_area) missingFacts.push("service area");
  if (!org?.target_population) missingFacts.push("target population");
  if (knowledgeEntries.length === 0) missingFacts.push("knowledge base entries");
  if (provenNarratives.length === 0) missingFacts.push("proven narrative examples");

  const hasSubstantiveOrgData =
    knowledgeEntries.length > 0 ||
    provenNarratives.length > 0 ||
    Boolean(org?.mission_statement) ||
    Boolean(org?.service_area) ||
    Boolean(org?.target_population);

  if (!hasSubstantiveOrgData) {
    const incompleteText =
      `[INCOMPLETE DRAFT] This organization has no stored mission statement, service area, ` +
      `target population, knowledge base entries, or proven narratives to draft from. A ` +
      `specific, funder-ready draft cannot be produced from an empty profile — generating one ` +
      `anyway would mean inventing the organization's history to fill the gap. ` +
      `Missing: ${missingFacts.join(", ")}. Add this information to the organization's profile ` +
      `and knowledge base, then regenerate.`;

    const { data: version, error: versionError } = await supabase
      .from("draft_versions")
      .insert({
        organization_id: organizationId,
        opportunity_id: opportunityId,
        template_type: templateType,
        content: incompleteText,
        confidence_score: 0,
        knowledge_sources: [] as unknown as Json,
        humanization_status: "not_humanized",
        source: draftSource,
        created_by: createdByUserId,
      })
      .select("id, version_number, humanization_status, created_at")
      .single();
    if (versionError || !version) {
      throw new Error(
        `Failed to save incomplete-draft record: ${versionError?.message ?? "no row returned"}`,
      );
    }

    return {
      content: incompleteText,
      confidenceScore: 0,
      gapCount: missingFacts.length,
      wordCount: incompleteText.trim().split(/\s+/).length,
      sources: [],
      savedVersion: {
        id: version.id as string,
        versionNumber: version.version_number as number,
        humanizationStatus:
          version.humanization_status as SavedDraftVersion["humanizationStatus"],
        createdAt: version.created_at as string,
      },
      tokensUsed: 0,
      rubricDimensionSummary: [],
      logicModel: null,
      complianceChecklist: null,
      incomplete: true,
      missingFacts,
      scrubbedFigures: [],
    };
  }

  const context: DraftPromptContext = {
    organization: org
      ? {
          name: org.name as string,
          dba: (org.dba as string | null) ?? null,
          ein: (org.ein as string | null) ?? null,
          taxStatus: (org.tax_status as string | null) ?? null,
          missionStatement: (org.mission_statement as string | null) ?? null,
          visionStatement: (org.vision_statement as string | null) ?? null,
          serviceArea: (org.service_area as string | null) ?? null,
          targetPopulation: (org.target_population as string | null) ?? null,
          founderName: (org.founder_name as string | null) ?? null,
          annualBudget: (org.annual_budget as number | null) ?? null,
        }
      : null,
    opportunity: {
      name: opportunity.name as string,
      category: opportunity.category as string,
      description: (opportunity.description as string | null) ?? null,
      funderName:
        (funderRes.data?.name as string | null | undefined) ?? null,
      eligibilityRequirements:
        (opportunity.eligibility_requirements as string | null) ?? null,
      amountMin: (opportunity.amount_min as number | null) ?? null,
      amountMax: (opportunity.amount_max as number | null) ?? null,
      requiredDocuments:
        (opportunity.required_documents as string[] | null) ?? null,
    },
    knowledgeEntries,
    provenNarratives,
    successPatterns: successPatterns.length > 0 ? successPatterns : undefined,
  };

  // ---------------------------------------------------------------------------
  // Intelligence Library RAG retrieval. Non-blocking: failures fall through.
  // ---------------------------------------------------------------------------
  let intelligenceSections: IntelligenceResult[] = [];
  let intelligenceRubric: ScoringRubric | null = null;
  let intelligenceLogicModel: LogicModel | null = null;
  let needDataPoints: NeedDataPoint[] = [];
  let knowledgeEngineResult: KnowledgeEngineResult = {
    patterns: [],
    proposals: [],
    insights: [],
  };

  const oppDescLower = (
    (opportunity.description as string | null) ?? ""
  ).toLowerCase();
  const oppEligLower = (
    (opportunity.eligibility_requirements as string | null) ?? ""
  ).toLowerCase();
  const LOGIC_MODEL_KEYWORDS = [
    "logic model",
    "theory of change",
    "program design",
  ];
  const needsLogicModel =
    templateType === "full_proposal" ||
    LOGIC_MODEL_KEYWORDS.some(
      (kw) => oppDescLower.includes(kw) || oppEligLower.includes(kw),
    );

  {
    const queryText = [
      opportunity.description,
      opportunity.name,
      opportunity.eligibility_requirements,
    ]
      .filter(Boolean)
      .join(" ");

    const sectionTypes = TEMPLATE_SECTION_TYPES[templateType];

    // Cross-org knowledge_patterns matches (Knowledge Engine, migration 096;
    // src/lib/intelligence/knowledge-engine.ts). Same query shape as
    // DraftGenerationAgent's loadKnowledgeEnginePatterns (category + name +
    // description, capped at 300 chars) so the live and autonomous draft
    // paths retrieve comparably. FEATURE_REGISTRY_v2.md row #171.
    const knowledgeEngineQueryText = [
      opportunity.category,
      opportunity.name,
      opportunity.description,
    ]
      .filter(Boolean)
      .join(" ")
      .slice(0, 300);

    // Templates that include a need statement benefit from live government data.
    const needsNeedData =
      templateType === "grant_narrative" ||
      templateType === "letter_of_inquiry" ||
      templateType === "full_proposal";

    try {
      [
        intelligenceSections,
        intelligenceRubric,
        intelligenceLogicModel,
        knowledgeEngineResult,
      ] = await Promise.all([
        retrieveIntelligence({ queryText, sectionTypes, limit: 5 }).catch(
          (e: unknown) => {
            console.error(
              "[INTELLIGENCE] retrieveIntelligence failed:",
              (e as Error).message,
            );
            return [] as IntelligenceResult[];
          },
        ),
        retrieveRubric({
          funderName: context.opportunity.funderName ?? undefined,
          category: context.opportunity.category,
        }).catch((e: unknown) => {
          console.error(
            "[INTELLIGENCE] retrieveRubric failed:",
            (e as Error).message,
          );
          return null;
        }),
        needsLogicModel
          ? retrieveLogicModel(context.opportunity.category).catch(
              (e: unknown) => {
                console.error(
                  "[INTELLIGENCE] retrieveLogicModel failed:",
                  (e as Error).message,
                );
                return null;
              },
            )
          : Promise.resolve(null),
        queryKnowledgeEngine(
          knowledgeEngineQueryText,
          organizationId,
          supabase,
        ).catch((e: unknown) => {
          console.error(
            "[INTELLIGENCE] queryKnowledgeEngine failed:",
            (e as Error).message,
          );
          return {
            patterns: [],
            proposals: [],
            insights: [],
          } as KnowledgeEngineResult;
        }),
      ]);

      // Gather need data for the org's service area when the template includes
      // a need statement section. Non-blocking: a failure returns empty array.
      if (needsNeedData && org?.service_area) {
        const serviceArea = (org.service_area as string).trim();
        // Derive state from a "City, ST" or "County, ST" or plain "ST" pattern
        const statePart = serviceArea.split(',').pop()?.trim() ?? serviceArea;
        if (statePart.length >= 2) {
          needDataPoints = await new NeedStatementEngine()
            .gatherNeedData(
              { state: statePart },
              [], // empty = all categories
            )
            .catch((e: unknown) => {
              console.error(
                "[INTELLIGENCE] gatherNeedData failed:",
                (e as Error).message,
              );
              return [] as NeedDataPoint[];
            });
        }
      }
    } catch (e: unknown) {
      console.error(
        "[INTELLIGENCE] RAG retrieval failed:",
        (e as Error).message,
      );
    }
  }

  // Rubric fallback: infer from opportunity details if library has no match.
  if (!intelligenceRubric) {
    const oppDesc = (
      (opportunity.description as string | null) ?? ""
    ).slice(0, 800);
    const oppName = opportunity.name as string;
    if (oppDesc || oppName) {
      try {
        const inferPrompt = [
          "You are an expert grant reviewer.",
          "Based on this grant opportunity, infer the most likely scoring dimensions reviewers will use.",
          "",
          `Grant: ${oppName}`,
          `Category: ${context.opportunity.category}`,
          `Description: ${oppDesc}`,
          "",
          "Return ONLY valid JSON (no markdown fences, no explanation):",
          '{"dimensions":{"Dimension Name":{"points":20,"description":"What earns full marks on this dimension","common_deductions":["vague language","missing data"]}}}',
          "",
          "Include 4-6 dimensions appropriate for this grant type and funder category.",
        ].join("\n");
        const inferResponse = await callClaude({
          system:
            "You are a grant scoring expert. Return only valid JSON, no markdown, no extra text.",
          prompt: inferPrompt,
          model,
          maxTokens: 600,
        });
        const jsonMatch = inferResponse.text.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          const parsed = JSON.parse(jsonMatch[0]) as {
            dimensions?: Record<string, unknown>;
          };
          if (
            parsed.dimensions &&
            typeof parsed.dimensions === "object" &&
            !Array.isArray(parsed.dimensions)
          ) {
            intelligenceRubric = {
              id: "inferred",
              source: "inferred",
              source_url: null,
              funder_name: context.opportunity.funderName,
              grant_program: oppName,
              category: [context.opportunity.category],
              dimensions: parsed.dimensions,
              full_text: null,
            };
            // Cache for future calls. Non-fatal if the insert fails.
            try {
              await supabase.from("intelligence_scoring_rubrics").insert({
                source: "inferred",
                grant_program: oppName,
                category: [context.opportunity.category],
                dimensions: parsed.dimensions as unknown as Json,
              });
            } catch (cacheErr: unknown) {
              console.error(
                "[INTELLIGENCE] Inferred rubric cache failed:",
                (cacheErr as Error).message,
              );
            }
          }
        }
      } catch (inferErr: unknown) {
        console.error(
          "[INTELLIGENCE] Rubric inference failed:",
          (inferErr as Error).message,
        );
      }
    }
  }

  // Logic model: prefer RAG result, fall back to AI generation when needed.
  let generatedLogicModel: GeneratedLogicModel | null = null;
  {
    const toStrArr = (v: unknown): string[] =>
      Array.isArray(v)
        ? v.filter((x): x is string => typeof x === "string")
        : [];
    if (intelligenceLogicModel) {
      generatedLogicModel = {
        inputs: toStrArr(intelligenceLogicModel.inputs),
        activities: toStrArr(intelligenceLogicModel.activities),
        outputs: toStrArr(intelligenceLogicModel.outputs),
        outcomes: toStrArr(intelligenceLogicModel.outcomes),
        impact: toStrArr(intelligenceLogicModel.impact),
        category: context.opportunity.category,
        templateBased: true,
      };
    } else if (needsLogicModel) {
      try {
        const programDescription =
          knowledgeEntries
            .filter((e) => e.category === "program_description")
            .map((e) => e.content)
            .join(" ") ||
          context.organization?.missionStatement ||
          "";
        generatedLogicModel = await generateLogicModel({
          category: context.opportunity.category,
          programDescription,
          organizationName: context.organization?.name ?? "",
          targetPopulation: context.organization?.targetPopulation ?? undefined,
          geography: context.organization?.serviceArea ?? undefined,
        });
      } catch (lmErr: unknown) {
        console.error(
          "[INTELLIGENCE] generateLogicModel failed:",
          (lmErr as Error).message,
        );
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Budget patterns, evaluation KPIs, and compliance intelligence
  // ---------------------------------------------------------------------------
  const grantType = resolveGrantType(
    opportunity.source_type as string | null,
    opportunity.category as string | null,
  );

  const needsBudgetPatterns =
    templateType === "budget_narrative" || templateType === "full_proposal";
  const needsEvaluationKPIs = TEMPLATE_SECTION_TYPES[templateType].includes("evaluation_plan");

  let budgetTemplate: BudgetTemplate | null = null;
  let evaluationKPIs: KPI[] = [];
  let complianceChecklist: ComplianceCheckResult | null = null;

  try {
    const budgetLib = new BudgetPatternLibrary();
    const evalLib = new EvaluationLibrary();

    const [budgetRes, evalRes] = await Promise.all([
      needsBudgetPatterns
        ? budgetLib
            .getTemplateByCategory(opportunity.category as string, grantType)
            .catch((e: unknown) => {
              console.error("[INTELLIGENCE] budget patterns failed:", (e as Error).message);
              return null;
            })
        : Promise.resolve(null),
      needsEvaluationKPIs
        ? evalLib.getKPIs(opportunity.category as string).catch((e: unknown) => {
            console.error("[INTELLIGENCE] evaluation KPIs failed:", (e as Error).message);
            return [] as KPI[];
          })
        : Promise.resolve([] as KPI[]),
    ]);

    budgetTemplate = budgetRes;
    evaluationKPIs = evalRes ?? [];

    // Compliance — always run for all template types.
    const complianceLib = new ComplianceLibrary();
    const complianceReqs = complianceLib.getRequirements(
      opportunity.category as string,
      (opportunity.source_type as string | null) ?? "",
    );
    complianceChecklist = complianceLib.checkCompliance(
      {
        documents: Array.isArray(opportunity.required_documents)
          ? (opportunity.required_documents as string[])
          : [],
      },
      complianceReqs,
    );
  } catch (e: unknown) {
    console.error("[INTELLIGENCE] budget/eval/compliance failed:", (e as Error).message);
  }

  // Build prompt.
  const built =
    templateType === "donation_request_letter"
      ? buildDonationRequestPrompt(context)
      : buildGrantNarrativePrompt(context, templateType);

  // Augment with intelligence context.
  let rubricDimensionSummary: Array<{
    name: string;
    points: number | null;
    description: string | null;
  }> = [];
  let enhancedPrompt = built.prompt;

  if (intelligenceSections.length > 0) {
    const excerpts = intelligenceSections
      .map(
        (s, i) =>
          `[Example ${i + 1}] Source: ${s.funder_name ?? "Unknown funder"} | Year: ${s.award_year ?? "N/A"} | Section: ${s.section_type} | Quality: ${s.quality_score ?? "N/A"}/10\n${s.section_text}`,
      )
      .join("\n\n---\n\n");
    enhancedPrompt +=
      "\n\nINTELLIGENCE CONTEXT — These are excerpts from funded proposals in similar categories. Use their structure, patterns, and level of specificity as guidance:\n\n" +
      excerpts;
  }

  if (intelligenceRubric) {
    const { promptText, dimensionSummary } =
      buildDetailedRubricSection(intelligenceRubric);
    rubricDimensionSummary = dimensionSummary;
    enhancedPrompt += "\n\n" + promptText;
  }

  // Kept in its own labeled block, separate from every org-voice section
  // (Knowledge Base, Proven Narratives, Intelligence Library), so a human
  // fact-checking the draft can tell a cross-org pattern match from this
  // org's own records — mirrors DraftGenerationAgent's
  // buildKnowledgeEnginePatternBlock placement.
  if (knowledgeEngineResult.patterns.length > 0) {
    const knowledgeEngineLines = knowledgeEngineResult.patterns.map((p) => {
      const funder = p.funder_name ? ` [${p.funder_name}]` : "";
      const rate =
        p.success_rate != null
          ? `${Math.round(p.success_rate * 100)}% success rate, ${p.sample_count ?? "unknown"} sample(s), `
          : "";
      return `- (id: ${p.id}) [${p.pattern_type}]${funder} ${p.pattern_description} (${rate}${p.confidence} confidence)`;
    });
    enhancedPrompt +=
      "\n\nKNOWLEDGE ENGINE PATTERNS — Cross-organization patterns matched by keyword to this opportunity. Use for structural, timing, and formatting guidance only, not as org-specific facts:\n\n" +
      knowledgeEngineLines.join("\n");
  }

  if (needDataPoints.length > 0) {
    const dataTable = needDataPoints
      .slice(0, 20) // cap to avoid bloating the context window
      .map(
        (d) =>
          `- ${d.metric}: ${d.value.toLocaleString()} (${d.geography}, ${d.year}) [Citation: ${d.citation}]`,
      )
      .join("\n");
    enhancedPrompt +=
      "\n\nNEED STATEMENT DATA — These statistics are sourced from authoritative government databases for the organization's service area. " +
      "When writing the need statement section, use these figures with the provided citations. " +
      "Do NOT fabricate statistics not present here. Include parenthetical citations (e.g., 'U.S. Census Bureau ACS, 2022') after each statistic.\n\n" +
      dataTable;
  }

  if (generatedLogicModel) {
    const formattedModel = formatLogicModelAsText(generatedLogicModel);
    enhancedPrompt +=
      "\n\nPROGRAM LOGIC MODEL — Use this as the structural backbone for the program design section:\n" +
      formattedModel;
  }

  if (budgetTemplate !== null) {
    const budgetLib = new BudgetPatternLibrary();
    const indirectGuidance = budgetLib.getIndirectCostRateGuidance(grantType);
    const lineItemsText = budgetTemplate.lineItems
      .map(
        (item) =>
          `- ${item.name} (${item.category}): typical ${item.typicalPctMin}–${item.typicalPctMax}% of budget.\n  Example: "${item.justificationExample}"`,
      )
      .join("\n");
    const costPrinciplesText = budgetTemplate.lineItems
      .map((item) => {
        const refs = budgetLib.getFederalCostPrinciples(item.category);
        return `${item.category}:\n${refs.map((r) => `  - ${r}`).join("\n")}`;
      })
      .join("\n");
    enhancedPrompt +=
      "\n\nBUDGET PATTERNS — Typical line items and justification language for this grant type:\n" +
      lineItemsText +
      "\n\nINDIRECT COST GUIDANCE:\n" +
      indirectGuidance +
      "\n\nFEDERAL COST PRINCIPLES:\n" +
      costPrinciplesText;
  }

  if (evaluationKPIs.length > 0) {
    const kpiText = evaluationKPIs
      .slice(0, 8)
      .map(
        (k) =>
          `- ${k.name}: ${k.definition} (Target: ${k.target_range}; Measured by: ${k.measurement_method}; Source: ${k.data_source}; Frequency: ${k.frequency})`,
      )
      .join("\n");
    enhancedPrompt +=
      "\n\nEVALUATION KPIs — Include these measurable outcomes in the evaluation plan section. " +
      "Use specific targets and measurement methods as shown:\n" +
      kpiText;
  }

  if (complianceChecklist !== null) {
    const actionItems = complianceChecklist.items
      .filter((i) => i.status === "fail" || i.status === "warning")
      .slice(0, 10)
      .map((i) => `- [${i.severity.toUpperCase()}] ${i.requirementName}: ${i.message} (${i.citation})`)
      .join("\n");
    if (actionItems) {
      enhancedPrompt +=
        "\n\nCOMPLIANCE REQUIREMENTS NEEDING ATTENTION — Flag these items explicitly in the draft " +
        "where relevant and note what the applicant must provide:\n" +
        actionItems;
    }
  }

  const response = await callClaude({
    system: built.system,
    prompt: enhancedPrompt,
    model,
    maxTokens,
  });

  let draftText = response.text;
  if (response.stopReason === "max_tokens") {
    console.error(
      `[DRAFT] Output truncated at ${maxTokens} tokens for org=${organizationId} opp=${opportunityId}`,
    );
    draftText +=
      "\n\n[Draft truncated — regenerate with a more specific template type for complete output]";
  }

  // AR-17.6: no figure, outcome, beneficiary count, or past-award claim may
  // appear in a draft unless it is present in the organization's stored
  // data (or the funder's own opportunity data). Prompt instructions alone
  // do not guarantee this (AR-17.4 found a fabricated phone number on every
  // twin-powered run and an invented operating history on a zero-KB org) --
  // scan what Claude actually returned and strip anything that can't be
  // traced to a stored source, before this text is saved as the draft.
  const factCorpus = buildFactCorpus([
    org?.name,
    org?.dba,
    org?.mission_statement,
    org?.vision_statement,
    org?.service_area,
    org?.target_population,
    org?.founder_name,
    org?.annual_budget,
    org?.ein,
    ...knowledgeEntries.map((e) => e.content),
    ...provenNarratives.map((p) => p.narrativeText),
    opportunity.name,
    opportunity.description as string | null,
    opportunity.amount_min as number | null,
    opportunity.amount_max as number | null,
    opportunity.amount_available as number | null,
  ]);
  const { text: scrubbedDraftText, removed: scrubbedFigures } =
    scrubUnverifiedFigures(draftText, factCorpus);
  draftText = scrubbedDraftText;

  let confidenceScore = computeConfidence(
    draftText,
    knowledgeEntries.length,
    provenNarratives.length,
  );

  // Compliance penalty: required failures cost 5 pts each, warnings cost 2.
  if (complianceChecklist !== null) {
    const penalty =
      complianceChecklist.failCount * 5 + complianceChecklist.warningCount * 2;
    confidenceScore = Math.max(0, Math.min(100, confidenceScore - penalty));
  }

  const gapCount = (draftText.match(/\[NEEDS INPUT/gi) ?? []).length;
  const wordCount = draftText.trim().split(/\s+/).length;

  // Transparency panel: every KB entry, proven narrative, and intelligence
  // library excerpt supplied to the model.
  const sources: KnowledgeSource[] = [
    ...knowledgeEntries.map((entry) => ({
      id: entry.id,
      kind: "knowledge_base" as const,
      title: entry.title,
    })),
    ...provenNarratives.map((p) => ({
      id: p.id,
      kind: "proven_narrative" as const,
      title: p.sectionType ? `Proven: ${p.sectionType}` : "Proven narrative",
    })),
    ...intelligenceSections.map((s) => ({
      id: s.id,
      kind: "intelligence_library" as const,
      title: `${s.section_type} — ${s.funder_name ?? "Funded proposal"} (${s.award_year ?? "N/A"})`,
    })),
    ...(intelligenceRubric
      ? [
          {
            id: intelligenceRubric.id,
            kind: "intelligence_library" as const,
            title: `Scoring rubric: ${intelligenceRubric.funder_name ?? intelligenceRubric.source}`,
          },
        ]
      : []),
    ...knowledgeEngineResult.patterns.map((p) => ({
      id: p.id,
      kind: "knowledge_engine" as const,
      title: p.funder_name
        ? `${p.pattern_type}: ${p.funder_name}`
        : `${p.pattern_type} pattern`,
    })),
  ];

  // Save the draft version. NOT best-effort (WGR-129): a generated draft the
  // caller can't retrieve later is equivalent to no draft at all, so a save
  // failure here must fail the whole generation loudly (throw), not be
  // swallowed into a 200 response with savedVersion:null. The caller
  // (POST /api/ai/draft) already has a correct catch block that surfaces a
  // 500 and marks the agent_run failed — this just stops bypassing it.
  let savedVersion: SavedDraftVersion;
  {
    const { data: version, error: versionError } = await supabase
      .from("draft_versions")
      .insert({
        organization_id: organizationId,
        opportunity_id: opportunityId,
        template_type: templateType,
        content: draftText,
        confidence_score: confidenceScore,
        knowledge_sources: sources as unknown as Json,
        humanization_status: "not_humanized",
        source: draftSource,
        created_by: createdByUserId,
      })
      .select("id, version_number, humanization_status, created_at")
      .single();
    if (versionError || !version) {
      throw new Error(
        `Failed to save draft version: ${versionError?.message ?? "no row returned"}`,
      );
    }
    savedVersion = {
      id: version.id as string,
      versionNumber: version.version_number as number,
      humanizationStatus:
        version.humanization_status as SavedDraftVersion["humanizationStatus"],
      createdAt: version.created_at as string,
    };
  }

  // Mirror the draft onto the most recent application for this opportunity.
  {
    const { data: existingApp } = await supabase
      .from("applications")
      .select("id")
      .eq("opportunity_id", opportunityId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (existingApp?.id) {
      const { error: appUpdateError } = await supabase
        .from("applications")
        .update({
          draft_content: draftText,
          draft_template_type: templateType,
          draft_confidence_score: confidenceScore,
          draft_knowledge_sources: sources as unknown as Json,
          knowledge_patterns_applied: knowledgeEngineResult.patterns.map(
            (p) => p.id,
          ),
          updated_at: new Date().toISOString(),
        })
        .eq("id", existingApp.id as string);
      if (appUpdateError) {
        console.error(
          "DRAFT APPLICATION SYNC ERROR:",
          appUpdateError.message,
        );
      }
    }
  }

  draftCreated.labels(templateType).inc();

  return {
    content: draftText,
    confidenceScore,
    gapCount,
    wordCount,
    sources,
    savedVersion,
    tokensUsed: response.usage.totalTokens,
    rubricDimensionSummary,
    logicModel: generatedLogicModel,
    complianceChecklist,
    incomplete: false,
    missingFacts: [],
    scrubbedFigures,
  };
}
