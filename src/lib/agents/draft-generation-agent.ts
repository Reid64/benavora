// Draft Generation Agent — AGENTS_v2.md's Phase 1 list calls this
// "AG-06: Draft Generator Agent (Already implemented)", but the literal
// agent_id already wired into agent_queue chaining is "ag-05-draft" (see
// src/lib/agents/probability-scoring-agent.ts's queueChainedAgent call when
// auto_draft_enabled and score >= auto_draft_threshold). This file keeps
// that id so the existing chain actually fires.
//
// Extends AutonomousAgent (migration 080 infrastructure: autonomous_triggers,
// agent_queue, agent_decisions, org_autonomous_config — see
// src/lib/agents/autonomous-base.ts).
//
// FULL AGENTIC UPGRADE (this session) — five-phase pipeline (intelligence
// gathering -> narrative strategy -> per-section drafting -> compliance
// check -> confidence scoring) replacing the single-shot Claude call this
// file previously used. Deviations from the task-given spec, following this
// project's established practice of checking real schema/docs state before
// applying a literal spec verbatim (see opportunity-discovery-agent.ts's
// header for a prior instance of this same pattern):
//   - governance/BEHAVIORAL_CONTRACTS.md only numbers sections 17-33 (v2.0
//     Tier 6 additions). Its own text says "sections 1-16 remain as defined
//     in BEHAVIORAL_CONTRACTS.md v1.0," but no v1.0 file exists anywhere in
//     this repo (confirmed absent) — so section 16 has no content to read at
//     all, and section 17 is Grants.gov integration (poll frequency, oppNumber
//     dedup), unrelated to draft generation. No source-specific contract
//     constrains this agent.
//   - There is no `knowledge_base_profiles` table. The org profile lives on
//     `organizations` (mission_statement, vision_statement, service_area,
//     target_population, founder_name, annual_budget) — the same columns
//     src/lib/drafts/generator.ts already reads for the interactive draft
//     route.
//   - `getSubmissionRecommendations` (src/lib/agents/roi-optimizer-agent.ts)
//     does not exist — confirmed by reading that entire file: it exports only
//     `trackSubmissionVariables()` (per-submission telemetry write) and
//     `run()` (a monthly correlation pass that writes `roi_insights` rows).
//     There is no exported function of that name anywhere in the repo. This
//     agent reads `roi_insights` directly instead (org-scoped, ordered by
//     confidence), mirroring the defensive optional-table-load pattern
//     strategic-advisor-agent.ts already uses for the same table.
//   - The task spec's "query nonprofits table for funder details" has no
//     table to query — `nonprofits` does not exist in this schema or its
//     migrations (confirmed absent). Funder intelligence instead comes from
//     this org's own `funders` row (annual_giving_budget, geographic_focus,
//     preferred_application_method, notes) plus this org's own `outcomes`
//     history against that funder's opportunities — real per-funder award/
//     denial history rather than a fabricated external lookup.
//   - `fundability_scores` (migration 091) and `community_need_signals`
//     (migration 090) DO exist in this schema, despite AGENTS_v2.md's
//     Phase 2-5 section describing the agents that own them (AG-29
//     Fundability Scorer, AG-35 Community Need Predictor) as PLANNED/
//     not-yet-built. This agent only reads them (read-only, defensive — a
//     missing row degrades to "no data available" text, it never blocks or
//     throws); it does not compute or own either table.
//   - Confidence scoring is rewritten to the task's specified multiplicative
//     model (base_confidence * twin_multiplier * pattern_multiplier, capped
//     at 95), replacing this file's previous subtractive
//     applyTwinCompletenessPenalty approach.
//   - `applications` has no `funder_id` column (confirmed absent from every
//     migration and src/types/database.ts) — only `opportunity_id` is set
//     on the created application; the funder is reachable via
//     opportunities.funder_id.
//   - AutonomousAgent#run() takes only triggerSource, not free-form input
//     params, so both "chain" and "manual" triggers read their target
//     opportunity from the same place any queue-driven agent already reads
//     its payload from: the agent_queue row this run is processing
//     (status='processing', this org + agent_id) — mirrors
//     ProbabilityScoringAgent.loadChainScope. If no payload is found (e.g. a
//     bare manual trigger with no opportunityId queued), the run logs
//     nothing to act on and exits with zero items rather than guessing.
//
// This agent uses its own lightweight Claude calls rather than the full
// src/lib/drafts/generator.ts pipeline (RAG retrieval, rubric inference,
// logic models, budget patterns) — per the task spec, it is a narrower,
// autonomous-only path: org profile + KB + proven narratives + Twin +
// platform learning patterns + ROI recommendations + fundability diagnostics
// + funder history in, a strategy-guided, section-by-section draft out,
// always gated behind pending_review.

import type { SupabaseClient } from "@supabase/supabase-js";

import {
  AutonomousAgent,
  type AutonomousAgentResult,
} from "@/lib/agents/autonomous-base";
import { callClaude, DEFAULT_MODEL } from "@/lib/ai/claude";
import type { Enums } from "@/types/database";
import { sendEmail } from "@/lib/email/resend-client";
import { draftReadyEmail } from "@/lib/email/templates/draft-ready";
import {
  humanizeNarrative,
  type OrgProfile as HumanizerOrgProfile,
  type OpportunityContext as HumanizerOpportunityContext,
  type HumanizationScoreBreakdown,
} from "@/lib/intelligence/narrative-humanizer";
import {
  enforceStyleGuide,
  deriveFunderType,
  type StyleGuideResult,
} from "@/lib/intelligence/grant-style-guide";
import {
  extractGrantPatterns,
  type GrantPatternIntelligence,
} from "@/lib/intelligence/pattern-extractor";
import {
  queryKnowledgeEngine,
  type KnowledgeEngineResult,
} from "@/lib/intelligence/knowledge-engine";

type TriggerSource = "autonomous" | "manual" | "chain" | "schedule";
type FunderCategory = Enums<"funder_category">;

interface TriggerPayload {
  opportunityId: string;
  score: number | null;
  title: string | null;
  funderId: string | null;
}

interface KnowledgeBaseEntry {
  title: string;
  category: string;
  content: string;
}

interface ProvenNarrativeRow {
  narrative_text: string;
  section_type: string | null;
  effectiveness_score: number | null;
}

interface OpportunityRow {
  id: string;
  name: string;
  category: string;
  description: string | null;
  amount_min: number | null;
  amount_max: number | null;
  deadline: string | null;
  eligibility_requirements: string | null;
  funder_id: string | null;
}

interface OrgProfileRow {
  name: string | null;
  mission_statement: string | null;
  vision_statement: string | null;
  service_area: string | null;
  target_population: string | null;
  founder_name: string | null;
  annual_budget: number | null;
}

// platform_learning_patterns (migration 083) has no generated types yet --
// same manual-cast convention as learning-network-aggregator-agent.ts.
// funder_category/ntee_code are plain `text` columns at the DB level (not
// FK/enum-typed), narrowed to FunderCategory here for readability only.
interface PlatformLearningPatternRow {
  id: string;
  pattern_type: string;
  funder_category: FunderCategory | null;
  ntee_code: string | null;
  pattern_content: string;
  success_rate: number | null;
  sample_count: number;
}

// organizational_digital_twins (migration 094). Column shape matches exactly
// what src/lib/intelligence/digital-twin-builder.ts populates via upsert;
// `vision` and `known_weaknesses` are additionally selected here even though
// the builder doesn't populate them yet (forward-compatible, per that
// migration's header).
interface DigitalTwinRow {
  mission: string | null;
  vision: string | null;
  service_areas: string[] | null;
  programs: { title: string; description: string }[] | null;
  financial_profile: Record<string, number> | null;
  board_composition:
    | { name: string; title: string | null; bio: string | null }[]
    | null;
  proven_narrative_patterns: string[] | null;
  key_strengths: string[] | null;
  known_weaknesses: string[] | null;
}

// The 7 sections the task spec names (mission_data/programs_data/
// financial_data/leadership_data/impact_data/geographic_data/capacity_data),
// each rendered to a prompt-ready string or null when the underlying twin
// column(s) have no data. Completeness = count of non-null sections / 7.
interface TwinContextSections {
  mission_data: string | null;
  programs_data: string | null;
  financial_data: string | null;
  leadership_data: string | null;
  impact_data: string | null;
  geographic_data: string | null;
  capacity_data: string | null;
}

interface TwinContext {
  sections: TwinContextSections;
  completeness: number;
  promptBlock: string | null;
}

// roi_insights (migration 089). See header note: getSubmissionRecommendations
// does not exist anywhere in the repo — this is the real table it would have
// read from, per roi-optimizer-agent.ts's run() (the only writer of this
// table).
interface RoiRecommendationRow {
  insight_type: string;
  insight_description: string;
  winning_pattern: string | null;
  recommended_action: string | null;
  confidence: number | null;
  sample_size: number | null;
}

// fundability_scores (migration 091, AG-29 Fundability Scorer). Read-only
// here — this agent does not compute deficiencies, only injects the most
// recent row for this opportunity when one exists.
interface FundabilityDeficiency {
  factor: string;
  fix_type?: string | null;
}
interface FundabilityRow {
  overall_score: number | null;
  probability_without_fixes: number | null;
  probability_with_fixes: number | null;
  deficiencies: FundabilityDeficiency[] | null;
  recommendation: string | null;
}

// community_need_signals (migration 090, AG-35 Community Need Predictor).
// Read-only here — grounds the Problem Statement section in real local-need
// data instead of fabricated statistics when data exists for this org.
interface CommunityNeedSignalRow {
  signal_category: string;
  signal_description: string;
  geographic_area: string | null;
  severity: string | null;
}

interface FunderRow {
  name: string;
  annual_giving_budget: number | null;
  geographic_focus: string | null;
  preferred_application_method: string | null;
  notes: string | null;
}

// Intelligence Library matching/synthesis (previously a simple category+
// keyword lookup here) now lives in src/lib/intelligence/pattern-extractor.ts
// (extractGrantPatterns) -- multi-factor scored matching against
// intelligence_funded_proposals plus a Claude synthesis pass producing
// winning phrases, success factors, budget structure, evaluation approach,
// theory of change, funder preferences, and patterns to avoid.

interface FunderIntelligence {
  name: string | null;
  annualGivingBudget: number | null;
  geographicFocus: string | null;
  preferredApplicationMethod: string | null;
  notes: string | null;
  pastAwardCount: number;
  pastAwardTotal: number;
  pastDenialCount: number;
}

const EMPTY_FUNDER_INTELLIGENCE: FunderIntelligence = {
  name: null,
  annualGivingBudget: null,
  geographicFocus: null,
  preferredApplicationMethod: null,
  notes: null,
  pastAwardCount: 0,
  pastAwardTotal: 0,
  pastDenialCount: 0,
};

// The six sections Phase 3 drafts independently, per the task spec.
type SectionKey =
  | "executiveSummary"
  | "problemStatement"
  | "programDescription"
  | "budgetNarrative"
  | "evaluationPlan"
  | "orgCapacity";

const SECTION_TITLES: Record<SectionKey, string> = {
  executiveSummary: "Executive Summary",
  problemStatement: "Problem Statement",
  programDescription: "Program Description",
  budgetNarrative: "Budget Narrative",
  evaluationPlan: "Evaluation Plan",
  orgCapacity: "Organizational Capacity",
};

// Per-section max_tokens, exactly as specified in the task.
const STRATEGY_MAX_TOKENS = 300;
const SECTION_MAX_TOKENS: Record<SectionKey, number> = {
  executiveSummary: 500,
  problemStatement: 600,
  programDescription: 800,
  budgetNarrative: 400,
  evaluationPlan: 400,
  orgCapacity: 300,
};

interface DraftComplianceCheckResult {
  passed: boolean;
  wordCount: number;
  wordLimit: number | null;
  withinWordLimit: boolean | null;
  missingOrThinSections: string[];
  prohibitedLanguageFound: string[];
  budgetSectionReferencesAmount: boolean;
  warnings: string[];
  checkedAt: string;
}

// The insert shape this agent writes to `applications`. Kept as a local
// interface (this file's established convention — see OpportunityRow,
// DigitalTwinRow above — rather than the generated Tables<"applications">
// type, which is stale: it is missing platform_patterns_applied/twin_powered/
// twin_completeness, added by migrations 084/094 after the types were last
// regenerated — see database-ts-stale-migration-080 precedent).
interface DraftApplicationPayload {
  organization_id: string;
  opportunity_id: string;
  stage: string;
  draft_content: string;
  draft_confidence_score: number;
  auto_generated: boolean;
  pending_review: boolean;
  draft_source: string;
  platform_patterns_applied: number;
  // knowledge_patterns.id values (src/lib/intelligence/knowledge-engine.ts,
  // migration 096) actually injected into this draft's prompt, so a
  // cross-org pattern match stays attributable after the fact — distinct
  // from platform_patterns_applied above, which counts a different table
  // (platform_learning_patterns). See migration 123.
  knowledge_patterns_applied: string[];
  twin_powered: boolean;
  twin_completeness: number;
  compliance_check_result: Record<string, unknown>;
  // applications.metadata (src/supabase/migrations/103_narrative_humanizer.sql /
  // supabase/migrations/105_applications_metadata_column.sql) — did not
  // exist on this table before this session, added specifically to hold
  // the narrative humanizer's score per draft.
  metadata: Record<string, unknown>;
  notes?: string;
  // Never set by this agent — present only so enforceHardLimits can assert
  // that fact in code, not just in a comment.
  submitted_at?: string;
}

const TWIN_SECTION_COUNT = 7;
const TWIN_COMPLETENESS_NOTIFY_THRESHOLD = 40;

// Knowledge Base categories a populated twin section supersedes, per the
// task spec's "Twin data takes priority over KB data when both exist."
// Categories not listed here (need_statement, sustainability, partnerships,
// organizational_history, budget_justification) have no twin-column
// equivalent and are always included from the Knowledge Base as before.
const TWIN_SECTION_KB_OVERRIDES: Record<
  keyof Pick<
    TwinContextSections,
    "mission_data" | "programs_data" | "impact_data" | "capacity_data"
  >,
  string[]
> = {
  mission_data: ["mission", "vision"],
  programs_data: ["program_description"],
  impact_data: ["impact"],
  capacity_data: ["capacity"],
};

function buildTwinContext(twin: DigitalTwinRow | null): TwinContext {
  const financial = twin?.financial_profile ?? {};

  const missionVal = twin?.mission ?? null;
  const visionVal = twin?.vision ?? null;
  const mission_data =
    missionVal || visionVal
      ? [missionVal, visionVal].filter(Boolean).join(" ")
      : null;

  const programs_data =
    twin?.programs && twin.programs.length > 0
      ? twin.programs.map((p) => `${p.title}: ${p.description}`).join("\n")
      : null;

  const financial_data =
    financial.annual_budget != null
      ? `Annual budget: $${financial.annual_budget.toLocaleString()}`
      : null;

  const leadership_data =
    twin?.board_composition && twin.board_composition.length > 0
      ? twin.board_composition
          .map((b) => (b.title ? `${b.name} (${b.title})` : b.name))
          .join(", ")
      : null;

  const impactParts = [
    ...(twin?.proven_narrative_patterns ?? []),
    ...(twin?.key_strengths ?? []),
  ];
  const impact_data = impactParts.length > 0 ? impactParts.join("\n") : null;

  const geographic_data =
    twin?.service_areas && twin.service_areas.length > 0
      ? twin.service_areas.join(", ")
      : null;

  const capacityParts: string[] = [];
  if (financial.total_staff != null) {
    capacityParts.push(`${financial.total_staff} staff`);
  }
  if (financial.total_volunteers != null) {
    capacityParts.push(`${financial.total_volunteers} volunteers`);
  }
  let capacity_data = capacityParts.length > 0 ? capacityParts.join(", ") : null;
  if (twin?.known_weaknesses && twin.known_weaknesses.length > 0) {
    const gaps = `Known capacity gaps: ${twin.known_weaknesses.join("; ")}`;
    capacity_data = capacity_data ? `${capacity_data}. ${gaps}` : gaps;
  }

  const sections: TwinContextSections = {
    mission_data,
    programs_data,
    financial_data,
    leadership_data,
    impact_data,
    geographic_data,
    capacity_data,
  };

  const populatedCount = Object.values(sections).filter(
    (v) => v !== null,
  ).length;
  const completeness = Math.round(
    (populatedCount / TWIN_SECTION_COUNT) * 100,
  );

  const sectionLabels: Record<keyof TwinContextSections, string> = {
    mission_data: "Mission & Vision",
    programs_data: "Programs",
    financial_data: "Financial Profile",
    leadership_data: "Board Leadership",
    impact_data: "Proven Impact & Strengths",
    geographic_data: "Geographic Service Areas",
    capacity_data: "Organizational Capacity",
  };

  const blockLines = (
    Object.keys(sections) as (keyof TwinContextSections)[]
  )
    .filter((key) => sections[key] !== null)
    .map((key) => `${sectionLabels[key]}: ${sections[key]}`);

  const promptBlock =
    blockLines.length > 0
      ? `ORGANIZATIONAL CONTEXT FROM DIGITAL TWIN (twin completeness: ${completeness}%):\n${blockLines.join("\n")}`
      : null;

  return { sections, completeness, promptBlock };
}

// Knowledge Base categories that feed a grant narrative draft — mirrors
// TEMPLATE_KB_CATEGORIES.grant_narrative in src/lib/drafts/generator.ts.
const GRANT_NARRATIVE_KB_CATEGORIES = [
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
];

// Platform Learning Network (AG-36 / migration 083) tuning constants.
const PLATFORM_PATTERN_LIMIT = 10;
// success_rate on platform_learning_patterns is a corroboration-confidence
// proxy in [0,1] (see learning-network-aggregator-agent.ts's
// computeConfidenceProxy) -- 0.7+ means at least ~14 independent awarded
// outcomes have corroborated the pattern; used only for descriptive logging
// now (see Phase 5 note below on why it no longer drives confidence math).
const HIGH_CONFIDENCE_SUCCESS_RATE = 0.7;

const ROI_RECOMMENDATION_LIMIT = 3;
const COMMUNITY_NEED_SIGNAL_LIMIT = 3;
const MIN_SECTION_LENGTH_CHARS = 40;

// Phase 4 compliance check tuning.
const GOVERNMENT_ADJACENT_CATEGORIES = new Set<string>(["government_grant"]);
const GOVERNMENT_PROHIBITED_LANGUAGE_TERMS = [
  "faith-based",
  "faith based",
  "religious",
  "prayer",
  "ministry",
  "gospel",
  "church-led",
  "biblical",
  "christian organization",
  "evangelize",
  "evangelism",
];

// Phase 5 confidence-scoring tuning. Task spec:
//   Final confidence = base_confidence * twin_multiplier * pattern_multiplier
//   twin_multiplier: completeness >= 80 ? 1.1 : completeness >= 60 ? 1.0 : 0.85
//   pattern_multiplier: patterns_applied >= 2 ? 1.05 : 1.0
//   Cap at 95.
// This supersedes the file's previous subtractive twin-completeness-penalty
// approach — the two models disagree on direction (subtract vs. multiply)
// and cannot both apply, so the task's explicit formula wins.
const TWIN_MULTIPLIER_HIGH_THRESHOLD = 80;
const TWIN_MULTIPLIER_MED_THRESHOLD = 60;
const TWIN_MULTIPLIER_HIGH = 1.1;
const TWIN_MULTIPLIER_MED = 1.0;
const TWIN_MULTIPLIER_LOW = 0.85;
const PATTERN_MULTIPLIER_THRESHOLD = 2;
const PATTERN_MULTIPLIER_BOOSTED = 1.05;
const PATTERN_MULTIPLIER_BASE = 1.0;
const MAX_CONFIDENCE = 95;

function countNeedsInput(draftText: string): number {
  return (draftText.match(/\[NEEDS INPUT/gi) ?? []).length;
}

function countWords(text: string): number {
  const trimmed = text.trim();
  return trimmed.length === 0 ? 0 : trimmed.split(/\s+/).length;
}

/** Looks for a funder-stated word limit inside opportunity.eligibility_requirements
 * (e.g. "narrative limited to 1,500 words"). Returns null when none is stated —
 * the compliance check then reports withinWordLimit as null (not applicable)
 * rather than fabricating a limit that was never published. */
function parseWordLimit(requirementsText: string | null): number | null {
  if (!requirementsText) return null;
  const match = requirementsText.match(/([\d,]{3,7})\s*-?\s*words?\b/i);
  if (!match || match[1] === undefined) return null;
  const digits = match[1].replace(/,/g, "");
  const parsed = parseInt(digits, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function findProhibitedLanguage(draftText: string, category: string): string[] {
  if (!GOVERNMENT_ADJACENT_CATEGORIES.has(category)) return [];
  const lowerText = draftText.toLowerCase();
  const found = new Set<string>();
  for (const term of GOVERNMENT_PROHIBITED_LANGUAGE_TERMS) {
    if (lowerText.includes(term)) found.add(term);
  }
  return Array.from(found);
}

/** Phase 4 — deterministic, no Claude call, mirrors the checklist style of
 * ComplianceCheckAgent (ag-07-compliance-check) but scoped to narrative
 * content rather than attached-document matching, since at draft time there
 * are no attached documents yet. Never blocks draft creation — every failure
 * becomes a warning surfaced to the human reviewer via compliance_check_result
 * and, when non-empty, the application's notes field (task spec: "do not
 * block draft but flag in pending_review notes"). "Budget totals balance" is
 * intentionally a narrative sanity check here (does the Budget Narrative
 * section reference a concrete dollar figure), not a structured line-item
 * sum — this narrow single-Claude-call pipeline produces prose, not
 * structured budget_data; true line-item balance validation belongs to the
 * Budget Builder / full ComplianceCheckAgent, which operate on structured
 * budget rows this agent never creates. */
function runComplianceCheck(
  sections: Record<SectionKey, string>,
  fullDraftText: string,
  opportunity: OpportunityRow,
): DraftComplianceCheckResult {
  const wordCount = countWords(fullDraftText);
  const wordLimit = parseWordLimit(opportunity.eligibility_requirements);
  const withinWordLimit = wordLimit !== null ? wordCount <= wordLimit : null;

  const missingOrThinSections = (Object.keys(sections) as SectionKey[]).filter(
    (key) => sections[key].trim().length < MIN_SECTION_LENGTH_CHARS,
  );

  const prohibitedLanguageFound = findProhibitedLanguage(
    fullDraftText,
    opportunity.category,
  );

  const budgetSectionReferencesAmount = /\$[\d,]/.test(sections.budgetNarrative);

  const warnings: string[] = [];
  if (withinWordLimit === false) {
    warnings.push(
      `Draft is ${wordCount} words, over the funder's stated ${wordLimit}-word limit.`,
    );
  }
  if (missingOrThinSections.length > 0) {
    warnings.push(
      `Section(s) too thin or missing: ${missingOrThinSections
        .map((key) => SECTION_TITLES[key])
        .join(", ")}.`,
    );
  }
  if (prohibitedLanguageFound.length > 0) {
    warnings.push(
      `Government funder — possible faith-preference language found: ${prohibitedLanguageFound.join(", ")}. Review before submission.`,
    );
  }
  if (!budgetSectionReferencesAmount) {
    warnings.push(
      "Budget narrative does not reference a specific dollar figure — verify totals manually before submission.",
    );
  }

  return {
    passed: warnings.length === 0,
    wordCount,
    wordLimit,
    withinWordLimit,
    missingOrThinSections,
    prohibitedLanguageFound,
    budgetSectionReferencesAmount,
    warnings,
    checkedAt: new Date().toISOString(),
  };
}

function assembleDraftText(sections: Record<SectionKey, string>): string {
  return (Object.keys(SECTION_TITLES) as SectionKey[])
    .map((key) => `## ${SECTION_TITLES[key]}\n\n${sections[key]}`)
    .join("\n\n");
}

/** The task-specified "INTELLIGENCE LIBRARY PATTERN ANALYSIS" block --
 * reference grants analyzed, winning phrases, success factors, funder
 * preference signals, recommended budget structure, recommended sections,
 * patterns to avoid, and the theory of change template. */
function buildIntelligencePatternBlock(intelligence: GrantPatternIntelligence): string {
  const referencedGrants = intelligence.referenceNarratives
    .map((n) => {
      const amount = n.awardAmount != null ? `$${n.awardAmount.toLocaleString()}` : "unspecified amount";
      return `${n.funderName ?? "Unknown funder"} (${n.grantProgram ?? "Unspecified program"}, ${amount})`;
    })
    .join("; ");

  const budget = intelligence.budgetStructureRecommendation;

  return [
    "INTELLIGENCE LIBRARY PATTERN ANALYSIS:",
    `Reference grants analyzed: ${referencedGrants || "none"}`,
    intelligence.winningPhrases.length > 0
      ? `Winning phrases to incorporate (adapt, not copy): ${intelligence.winningPhrases.join("; ")}`
      : null,
    intelligence.successFactors.length > 0
      ? `Success factors present in matching grants: ${intelligence.successFactors.join("; ")}`
      : null,
    intelligence.persuasiveElements.length > 0
      ? `Persuasive techniques observed: ${intelligence.persuasiveElements
          .map((p) => `${p.elementType} -- ${p.whyItWorks}`)
          .join("; ")}`
      : null,
    intelligence.funderPreferences.length > 0
      ? `Funder preference signals: ${intelligence.funderPreferences.join("; ")}`
      : null,
    `Recommended budget structure: Personnel ${budget.personnelPercent}%, Programs ${budget.programPercent}%, ` +
      `Admin ${budget.adminPercent}%, Other ${budget.otherPercent}% -- ${budget.narrative}`,
    `Recommended evaluation approach: ${intelligence.evaluationApproachRecommendation}`,
    `Theory of change template: ${intelligence.theoryOfChangeTemplate}`,
    `Recommended sections: ${intelligence.recommendedSections.join(", ")}`,
    `Recommended total word count: ~${intelligence.recommendedWordCount}`,
    intelligence.avoidPatterns.length > 0
      ? `Patterns to avoid: ${intelligence.avoidPatterns.join("; ")}`
      : null,
  ]
    .filter((line): line is string => Boolean(line))
    .join("\n");
}

function buildIntelligenceLibrarySection(intelligence: GrantPatternIntelligence): string {
  if (intelligence.referenceNarratives.length === 0) {
    return "No reference narratives available in the Intelligence Library yet.";
  }

  const header =
    "The following are real awarded grants from the Benavora Intelligence Library, matched to this " +
    "opportunity and organization by funder category, funder type, award amount range, and topic " +
    "overlap. Use these as style, structure, and language reference when drafting. Do not copy verbatim.";

  const entries = intelligence.referenceNarratives.map((n) => {
    const amount = n.awardAmount != null ? `$${n.awardAmount.toLocaleString()}` : "unspecified";
    const successFactors = n.successFactors.join(", ") || "not recorded";
    return (
      `[Funder: ${n.funderName ?? "Unknown"} | Program: ${n.grantProgram ?? "Unspecified"} | ` +
      `Amount: ${amount} | Success Factors: ${successFactors}]\n${n.fullText}`
    );
  });

  return [header, "", ...entries, "", buildIntelligencePatternBlock(intelligence)].join("\n\n");
}

/** Knowledge Engine (src/lib/intelligence/knowledge-engine.ts, migration
 * 096) — cross-org knowledge_patterns matches, previously never surfaced in
 * this agent's prompt (FEATURE_REGISTRY_v2.md row #171's documented gap).
 * Only the patterns half of the query result is rendered here:
 * intelligence_funded_proposals matches are already covered, more richly
 * (Claude-synthesized winning phrases/success factors/budget structure), by
 * extractGrantPatterns's own INTELLIGENCE LIBRARY section above — reusing
 * queryKnowledgeEngine's proposals here too would duplicate that section
 * against the same table. Labeled and kept in its own block, separate from
 * every org-voice section (Knowledge Base, Proven Narratives, Digital Twin),
 * so a human fact-checking the draft can tell whether a claim came from this
 * org's own records or from a cross-org pattern match. Returns null (section
 * omitted from the prompt) when nothing matched. */
function buildKnowledgeEnginePatternBlock(
  result: KnowledgeEngineResult,
): string | null {
  if (result.patterns.length === 0) return null;

  const lines = result.patterns.map((p) => {
    const funder = p.funder_name ? ` [${p.funder_name}]` : "";
    const rate =
      p.success_rate != null
        ? `${Math.round(p.success_rate * 100)}% success rate, ${p.sample_count ?? "unknown"} sample(s), `
        : "";
    return `- (id: ${p.id}) [${p.pattern_type}]${funder} ${p.pattern_description} (${rate}${p.confidence} confidence)`;
  });

  return lines.join("\n");
}

// Phase 5 — pure scoring functions, kept as free functions (this file's
// established convention — see countNeedsInput above) rather than methods.
function computeBaseConfidence(
  needsInputCount: number,
  provenNarrativesUsed: number,
): number {
  let confidence: number;
  if (needsInputCount === 0) confidence = 90;
  else if (needsInputCount <= 2) confidence = 75;
  else confidence = 60;

  if (provenNarrativesUsed === 0) confidence -= 10;

  return Math.max(0, Math.min(100, confidence));
}

function twinCompletenessMultiplier(twinCompleteness: number): number {
  if (twinCompleteness >= TWIN_MULTIPLIER_HIGH_THRESHOLD) return TWIN_MULTIPLIER_HIGH;
  if (twinCompleteness >= TWIN_MULTIPLIER_MED_THRESHOLD) return TWIN_MULTIPLIER_MED;
  return TWIN_MULTIPLIER_LOW;
}

function platformPatternMultiplier(patternsApplied: number): number {
  return patternsApplied >= PATTERN_MULTIPLIER_THRESHOLD
    ? PATTERN_MULTIPLIER_BOOSTED
    : PATTERN_MULTIPLIER_BASE;
}

function computeFinalConfidence(
  baseConfidence: number,
  twinCompleteness: number,
  patternsApplied: number,
): number {
  const raw =
    baseConfidence *
    twinCompletenessMultiplier(twinCompleteness) *
    platformPatternMultiplier(patternsApplied);
  return Math.max(0, Math.min(MAX_CONFIDENCE, Math.round(raw)));
}

export class DraftGenerationAgent extends AutonomousAgent {
  constructor(orgId: string, supabase: SupabaseClient) {
    super(orgId, "ag-05-draft", supabase);
  }

  /**
   * HARD LIMIT ENFORCEMENT — runs immediately before every INSERT into
   * applications. No exceptions. Throwing here (rather than silently fixing
   * the payload) is deliberate: a caller that reaches this point with a bad
   * payload has a bug that needs to surface as a failed run, not a silently
   * "corrected" draft.
   */
  private enforceHardLimits(draft: Partial<DraftApplicationPayload>): void {
    if (draft.submitted_at !== undefined) {
      throw new Error(
        "HARD_LIMIT: auto_generated drafts cannot have submitted_at",
      );
    }
    if (draft.pending_review !== true) {
      throw new Error(
        "HARD_LIMIT: auto_generated drafts must have pending_review=true",
      );
    }
    if (draft.auto_generated !== true) {
      throw new Error("HARD_LIMIT: must mark auto_generated=true");
    }
    if (draft.draft_source === "manual") {
      throw new Error("HARD_LIMIT: auto drafts cannot have manual source");
    }
  }

  /**
   * Reads the target opportunity (and the probability-scoring context that
   * chained into this run, when present) from the agent_queue row this run
   * is processing. Returns null when no queued payload has an
   * opportunityId — there is nothing to draft.
   */
  private async loadTriggerPayload(): Promise<TriggerPayload | null> {
    const { data: queueRow } = await this.supabase
      .from("agent_queue")
      .select("input_payload")
      .eq("org_id", this.orgId)
      .eq("agent_id", this.agentId)
      .eq("status", "processing")
      .order("started_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    const payload = (queueRow?.input_payload ?? {}) as Record<string, unknown>;
    const opportunityId = payload.opportunityId;
    if (typeof opportunityId !== "string" || opportunityId.trim() === "") {
      return null;
    }

    return {
      opportunityId,
      score: typeof payload.score === "number" ? payload.score : null,
      title: typeof payload.title === "string" ? payload.title : null,
      funderId:
        typeof payload.funderId === "string" ? payload.funderId : null,
    };
  }

  // ---- Phase 1: Intelligence gathering -----------------------------------

  private async loadPlatformPatterns(
    funderCategory: string,
  ): Promise<PlatformLearningPatternRow[]> {
    // `organizations` has no ntee_code column (confirmed absent from every
    // migration and src/types/database.ts -- the same gap
    // learning-network-aggregator-agent.ts already hit on the write side and
    // left null rather than guessing). With no org-side NTEE value to match
    // against, this only surfaces platform-wide patterns (ntee_code IS NULL)
    // instead of fabricating an NTEE match.
    const { data } = await this.supabase
      .from("platform_learning_patterns")
      .select(
        "id, pattern_type, funder_category, ntee_code, pattern_content, success_rate, sample_count",
      )
      .eq("funder_category", funderCategory)
      .is("ntee_code", null)
      .order("success_rate", { ascending: false, nullsFirst: false })
      .limit(PLATFORM_PATTERN_LIMIT);

    return (data ?? []) as PlatformLearningPatternRow[];
  }

  /** roi_insights (migration 089) — see file header: getSubmissionRecommendations
   * does not exist; this reads the same underlying table it would have. */
  private async loadRoiRecommendations(): Promise<RoiRecommendationRow[]> {
    try {
      const { data, error } = await this.supabase
        .from("roi_insights")
        .select(
          "insight_type, insight_description, winning_pattern, recommended_action, confidence, sample_size",
        )
        .eq("org_id", this.orgId)
        .order("confidence", { ascending: false, nullsFirst: false })
        .limit(ROI_RECOMMENDATION_LIMIT);

      if (error) return [];
      return (data ?? []) as RoiRecommendationRow[];
    } catch {
      // Defensive per the same convention strategic-advisor-agent.ts uses
      // for Phase 2-5 tables: a load failure here degrades to "no
      // recommendations" rather than blocking draft generation.
      return [];
    }
  }

  /** community_need_signals (migration 090) — grounds the Problem Statement
   * in real local data when available. Defensive for the same reason as
   * loadRoiRecommendations. */
  private async loadCommunityNeedSignals(): Promise<CommunityNeedSignalRow[]> {
    try {
      const { data, error } = await this.supabase
        .from("community_need_signals")
        .select("signal_category, signal_description, geographic_area, severity")
        .eq("org_id", this.orgId)
        .order("data_date", { ascending: false, nullsFirst: false })
        .limit(COMMUNITY_NEED_SIGNAL_LIMIT);

      if (error) return [];
      return (data ?? []) as CommunityNeedSignalRow[];
    } catch {
      return [];
    }
  }

  /** fundability_scores (migration 091) — most recent diagnostic for this
   * opportunity, if AG-29 has ever scored it. Defensive for the same reason
   * as loadRoiRecommendations. */
  private async loadFundabilityContext(
    opportunityId: string,
  ): Promise<FundabilityRow | null> {
    try {
      const { data, error } = await this.supabase
        .from("fundability_scores")
        .select(
          "overall_score, probability_without_fixes, probability_with_fixes, deficiencies, recommendation",
        )
        .eq("org_id", this.orgId)
        .eq("opportunity_id", opportunityId)
        .order("generated_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (error) return null;
      return (data as FundabilityRow | null) ?? null;
    } catch {
      return null;
    }
  }

  /** Funder intelligence: this org's own funders row plus this org's own
   * outcomes history against that funder's opportunities. See file header —
   * there is no `nonprofits` table to query for this. */
  private async loadFunderIntelligence(
    funderId: string | null,
  ): Promise<FunderIntelligence> {
    if (!funderId) return EMPTY_FUNDER_INTELLIGENCE;

    const { data: funderRow } = await this.supabase
      .from("funders")
      .select(
        "name, annual_giving_budget, geographic_focus, preferred_application_method, notes",
      )
      .eq("id", funderId)
      .maybeSingle();
    const funder = funderRow as FunderRow | null;

    const base: FunderIntelligence = {
      name: funder?.name ?? null,
      annualGivingBudget: funder?.annual_giving_budget ?? null,
      geographicFocus: funder?.geographic_focus ?? null,
      preferredApplicationMethod: funder?.preferred_application_method ?? null,
      notes: funder?.notes ?? null,
      pastAwardCount: 0,
      pastAwardTotal: 0,
      pastDenialCount: 0,
    };

    const { data: oppRows } = await this.supabase
      .from("opportunities")
      .select("id")
      .eq("organization_id", this.orgId)
      .eq("funder_id", funderId);
    const opportunityIds = ((oppRows ?? []) as { id: string }[]).map(
      (r) => r.id,
    );
    if (opportunityIds.length === 0) return base;

    const { data: appRows } = await this.supabase
      .from("applications")
      .select("id")
      .eq("organization_id", this.orgId)
      .in("opportunity_id", opportunityIds);
    const applicationIds = ((appRows ?? []) as { id: string }[]).map(
      (r) => r.id,
    );
    if (applicationIds.length === 0) return base;

    const { data: outcomeRows } = await this.supabase
      .from("outcomes")
      .select("result, awarded_amount")
      .eq("organization_id", this.orgId)
      .in("application_id", applicationIds);

    let pastAwardCount = 0;
    let pastAwardTotal = 0;
    let pastDenialCount = 0;
    for (const o of (outcomeRows ?? []) as {
      result: string;
      awarded_amount: number | null;
    }[]) {
      if (o.result === "awarded" || o.result === "partial") {
        pastAwardCount += 1;
        pastAwardTotal += o.awarded_amount ?? 0;
      } else if (o.result === "denied") {
        pastDenialCount += 1;
      }
    }

    return { ...base, pastAwardCount, pastAwardTotal, pastDenialCount };
  }

  /** Knowledge Engine (src/lib/intelligence/knowledge-engine.ts) — keyword/
   * ILIKE retrieval over knowledge_patterns + intelligence_funded_proposals,
   * previously never called from this agent (registry row #171). Defensive
   * for the same reason as loadRoiRecommendations: queryKnowledgeEngine
   * already tolerates its own query-level errors internally (returns empty
   * arrays), but a network/connection-level throw here degrades to "no
   * patterns retrieved" rather than blocking draft generation. */
  private async loadKnowledgeEnginePatterns(
    query: string,
  ): Promise<KnowledgeEngineResult> {
    try {
      return await queryKnowledgeEngine(query, this.orgId, this.supabase);
    } catch {
      return { patterns: [], proposals: [], insights: [] };
    }
  }

  private buildFunderIntelBlock(funderIntel: FunderIntelligence): string {
    const lines = [`Funder: ${funderIntel.name ?? "Unknown"}`];
    if (funderIntel.geographicFocus) {
      lines.push(`Funder geographic focus: ${funderIntel.geographicFocus}`);
    }
    if (funderIntel.preferredApplicationMethod) {
      lines.push(
        `Funder preferred application method: ${funderIntel.preferredApplicationMethod}`,
      );
    }
    if (funderIntel.annualGivingBudget != null) {
      lines.push(
        `Funder annual giving budget: $${funderIntel.annualGivingBudget.toLocaleString()}`,
      );
    }
    if (funderIntel.notes) {
      lines.push(`Funder notes: ${funderIntel.notes}`);
    }
    if (funderIntel.pastAwardCount > 0 || funderIntel.pastDenialCount > 0) {
      lines.push(
        `Prior history with this funder: ${funderIntel.pastAwardCount} award(s) totaling $${funderIntel.pastAwardTotal.toLocaleString()}, ${funderIntel.pastDenialCount} denial(s).`,
      );
    }
    return lines.join("\n");
  }

  private buildSharedContextBlock(params: {
    opportunity: OpportunityRow;
    orgName: string;
    orgProfile: OrgProfileRow | null;
    twinContext: TwinContext;
    kbSection: string;
    provenSection: string;
    patternsSection: string | null;
    roiSection: string | null;
    fundabilitySection: string | null;
    funderSection: string;
    intelligenceLibrarySection: string;
    knowledgeEnginePatternsSection: string | null;
  }): string {
    const {
      opportunity,
      orgName,
      orgProfile,
      twinContext,
      kbSection,
      provenSection,
      patternsSection,
      roiSection,
      fundabilitySection,
      funderSection,
      intelligenceLibrarySection,
      knowledgeEnginePatternsSection,
    } = params;

    return [
      `OPPORTUNITY: ${opportunity.name}`,
      funderSection,
      `Category: ${opportunity.category}`,
      `Amount range: ${opportunity.amount_min ?? "unspecified"} - ${opportunity.amount_max ?? "unspecified"}`,
      `Deadline: ${opportunity.deadline ?? "none published"}`,
      `Eligibility requirements: ${opportunity.eligibility_requirements ?? "none listed"}`,
      opportunity.description ? `Description: ${opportunity.description}` : "",
      "",
      "ORGANIZATION PROFILE:",
      `Name: ${orgName}`,
      `Mission: ${orgProfile?.mission_statement ?? "[NEEDS INPUT: mission statement]"}`,
      `Vision: ${orgProfile?.vision_statement ?? ""}`,
      `Service area: ${orgProfile?.service_area ?? "[NEEDS INPUT: service area]"}`,
      `Target population: ${orgProfile?.target_population ?? "[NEEDS INPUT: target population]"}`,
      `Founder: ${orgProfile?.founder_name ?? ""}`,
      `Annual budget: ${orgProfile?.annual_budget ?? "[NEEDS INPUT: annual budget]"}`,
      "",
      ...(twinContext.promptBlock
        ? [twinContext.promptBlock, ""]
        : [
            "ORGANIZATIONAL CONTEXT FROM DIGITAL TWIN: not yet available for this organization.",
            "",
          ]),
      "KNOWLEDGE BASE CONTENT:",
      kbSection,
      "",
      "PROVEN NARRATIVES (high-weight examples from previously successful applications):",
      provenSection,
      "",
      "INTELLIGENCE LIBRARY -- SUCCESSFUL GRANT REFERENCE NARRATIVES",
      intelligenceLibrarySection,
      "",
      ...(patternsSection
        ? [
            "PLATFORM LEARNING PATTERNS (from anonymized successful grants):",
            patternsSection,
            "",
          ]
        : []),
      ...(roiSection
        ? [
            "WINNING SUBMISSION PATTERNS FOR THIS ORG (from ROI analysis):",
            roiSection,
            "",
          ]
        : []),
      ...(fundabilitySection
        ? [
            "FUNDABILITY DIAGNOSTIC FOR THIS OPPORTUNITY:",
            fundabilitySection,
            "",
          ]
        : []),
      ...(knowledgeEnginePatternsSection
        ? [
            "RELEVANT KNOWLEDGE PATTERNS (retrieved, not authored by this organization -- verify before treating as fact):",
            knowledgeEnginePatternsSection,
            "",
          ]
        : []),
    ].join("\n");
  }

  // ---- Phase 2: Narrative strategy ---------------------------------------

  private async generateNarrativeStrategy(
    sharedContextBlock: string,
    orgName: string,
  ): Promise<{ text: string; tokensUsed: number }> {
    const system =
      "You are a senior grant writer. Based on the org profile and funder intelligence, define the " +
      "optimal narrative strategy for this application in 3 bullet points. Focus on: (1) strongest " +
      "alignment angle to lead with, (2) key proof points to emphasize, (3) risk factors to address " +
      "proactively.";

    const response = await callClaude({
      system,
      prompt: `${sharedContextBlock}\n\nDefine the narrative strategy for ${orgName}'s application.`,
      model: DEFAULT_MODEL,
      maxTokens: STRATEGY_MAX_TOKENS,
    });

    return { text: response.text.trim(), tokensUsed: response.usage.totalTokens };
  }

  // ---- Phase 3: Section drafting ------------------------------------------

  private async generateSection(
    system: string,
    prompt: string,
    maxTokens: number,
  ): Promise<{ text: string; tokensUsed: number }> {
    const response = await callClaude({
      system,
      prompt,
      model: DEFAULT_MODEL,
      maxTokens,
    });
    return { text: response.text.trim(), tokensUsed: response.usage.totalTokens };
  }

  private async draftAllSections(params: {
    sharedContextBlock: string;
    strategyText: string;
    orgName: string;
    communityNeedBlock: string;
    funderHistoryBlock: string;
  }): Promise<{ sections: Record<SectionKey, string>; tokensUsed: number }> {
    const { sharedContextBlock, strategyText, orgName, communityNeedBlock, funderHistoryBlock } =
      params;

    const sectionSystem =
      `You are an expert grant writer for ${orgName}. Use ONLY the provided organizational data. ` +
      "Never fabricate statistics, certifications, or financial figures not in the data. Flag missing " +
      "required data with [NEEDS INPUT: description]. Write only the section requested — no headers, " +
      "no preamble, no meta-commentary.";

    const strategyBlock = `NARRATIVE STRATEGY:\n${strategyText}`;

    const prompts: Record<SectionKey, string> = {
      executiveSummary: [
        sharedContextBlock,
        strategyBlock,
        "",
        "TASK: Write the Executive Summary section for this grant application (300-500 words). " +
          `Lead with the strongest alignment angle identified in the narrative strategy above — make ` +
          `the case for why ${orgName} is the right recipient for this specific opportunity.`,
      ].join("\n"),
      problemStatement: [
        sharedContextBlock,
        strategyBlock,
        "",
        "LOCAL NEED DATA:",
        communityNeedBlock,
        "",
        "TASK: Write the Problem Statement section (400-600 words). Cite the specific local need data " +
          "above when available. If no local need data is provided, ground the problem statement only " +
          "in the organization's documented service area and target population — do not fabricate " +
          "statistics.",
      ].join("\n"),
      programDescription: [
        sharedContextBlock,
        strategyBlock,
        "",
        `TASK: Write the Program Description section (500-800 words). Explicitly map ${orgName}'s ` +
          "programs to this funder's stated priorities and eligibility requirements.",
      ].join("\n"),
      budgetNarrative: [
        sharedContextBlock,
        strategyBlock,
        "",
        "TASK: Write the Budget Narrative section (250-400 words). Justify the requested amount against " +
          "the opportunity's stated amount range and the organization's annual budget. Reference major " +
          "cost categories in general terms (personnel, program materials, overhead) — do not invent a " +
          "specific line-item budget beyond what the organization profile supports.",
      ].join("\n"),
      evaluationPlan: [
        sharedContextBlock,
        strategyBlock,
        "",
        "TASK: Write the Evaluation Plan section (250-400 words). Propose outcome metrics that match " +
          "this funder's stated interests and the organization's proven impact data.",
      ].join("\n"),
      orgCapacity: [
        sharedContextBlock,
        strategyBlock,
        "",
        "FUNDER RELATIONSHIP HISTORY:",
        funderHistoryBlock,
        "",
        "TASK: Write the Organizational Capacity section (200-300 words). Lead with the track record " +
          "most relevant to this specific funder type — reference past award history with this funder " +
          "if provided above.",
      ].join("\n"),
    };

    const sectionKeys = Object.keys(SECTION_TITLES) as SectionKey[];
    const results = await Promise.all(
      sectionKeys.map((key) =>
        this.generateSection(sectionSystem, prompts[key], SECTION_MAX_TOKENS[key]),
      ),
    );

    const sections = {} as Record<SectionKey, string>;
    let tokensUsed = 0;
    sectionKeys.forEach((key, i) => {
      const result = results[i];
      if (!result) return;
      sections[key] = result.text;
      tokensUsed += result.tokensUsed;
    });

    return { sections, tokensUsed };
  }

  /** Emails the org's owner/admin users that a new autonomous draft is
   * waiting in pending_review — same admin/owner lookup pattern as
   * sendAutoapplyDigest (src/lib/autoapply/digest-email.ts). Best-effort:
   * a missing RESEND_API_KEY, no admin profiles, or a Resend failure all
   * degrade silently — the in-app alert (createNotification, already called)
   * is the notification of record. */
  private async sendDraftReadyNotificationEmail(params: {
    orgName: string;
    draftTitle: string;
    funderName: string;
    confidence: number;
  }): Promise<void> {
    const { data: admins } = await this.supabase
      .from("profiles")
      .select("email")
      .eq("organization_id", this.orgId)
      .in("role", ["owner", "admin"])
      .limit(5);

    const recipients = ((admins ?? []) as { email: string }[])
      .map((p) => p.email)
      .filter(Boolean);
    if (recipients.length === 0) return;

    const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "https://benavora.com";
    const { subject, html } = draftReadyEmail({
      orgName: params.orgName,
      draftTitle: params.draftTitle,
      opportunityName: params.draftTitle,
      funderName: params.funderName,
      confidenceScore: params.confidence,
      reviewUrl: `${appUrl}/draft-generator/autonomous`,
    });

    await sendEmail({ to: recipients, subject, html });
  }

  /** Builds the narrative humanizer's org-context input from data this run
   * already loaded in Phase 1 — no additional queries. Every field is
   * derived from real KB/twin/organizations data; nothing is fabricated,
   * matching this file's established convention (see loadFunderIntelligence,
   * buildTwinContext above). */
  private buildHumanizerOrgProfile(params: {
    orgName: string;
    orgProfile: OrgProfileRow | null;
    knowledgeEntries: KnowledgeBaseEntry[];
    twin: DigitalTwinRow | null;
  }): HumanizerOrgProfile {
    const { orgName, orgProfile, knowledgeEntries, twin } = params;

    const demographicParts = [
      orgProfile?.target_population,
      orgProfile?.service_area,
    ].filter((v): v is string => Boolean(v));
    const demographicDetail =
      demographicParts.length > 0 ? demographicParts.join(" in ") : null;

    const kbProgramNames = knowledgeEntries
      .filter((e) => e.category === "program_description")
      .map((e) => e.title);
    const twinProgramNames = (twin?.programs ?? []).map((p) => p.title);
    const programNames = Array.from(
      new Set([...twinProgramNames, ...kbProgramNames]),
    );

    const boardQualifications = (twin?.board_composition ?? [])
      .map((b) => (b.title ? `${b.name}, ${b.title}` : null))
      .filter((v): v is string => Boolean(v));
    const kbCapacityQualifications = knowledgeEntries
      .filter((e) => e.category === "capacity")
      .map((e) => e.content);
    const staffQualifications = [
      ...boardQualifications,
      ...kbCapacityQualifications,
    ];

    const kbImpactStats = knowledgeEntries
      .filter((e) => e.category === "impact")
      .map((e) => e.content);
    const twinImpactStats = [
      ...(twin?.proven_narrative_patterns ?? []),
      ...(twin?.key_strengths ?? []),
    ];
    const impactStats = [...twinImpactStats, ...kbImpactStats];

    return {
      name: orgName,
      missionStatement: orgProfile?.mission_statement ?? twin?.mission ?? null,
      serviceArea: orgProfile?.service_area ?? null,
      targetPopulation: orgProfile?.target_population ?? null,
      demographicDetail,
      programNames,
      staffQualifications,
      impactStats,
      // No schema source for a stated multi-year projection anywhere in
      // this codebase today — left null rather than fabricated.
      threeYearProjection: null,
    };
  }

  override async run(
    triggerSource: TriggerSource,
  ): Promise<AutonomousAgentResult> {
    const runId = await this.startRun(triggerSource);
    const errors: string[] = [];
    const decisions: string[] = [];
    let tokensUsed = 0;

    try {
      const config = await this.getOrgConfig();

      // HARD LIMIT: Never create more than max_auto_drafts_per_night per org per day.
      const todayStart = new Date();
      todayStart.setUTCHours(0, 0, 0, 0);

      const { count: draftsToday } = await this.supabase
        .from("applications")
        .select("id", { count: "exact", head: true })
        .eq("organization_id", this.orgId)
        .eq("auto_generated", true)
        .gte("created_at", todayStart.toISOString());

      if ((draftsToday ?? 0) >= config.max_auto_drafts_per_night) {
        const decisionId = await this.logDecision({
          decisionType: "draft_generation_skipped",
          agentRunId: runId,
          reasoning:
            `Daily auto-draft limit reached (${draftsToday}/` +
            `${config.max_auto_drafts_per_night}). Skipping this run.`,
          confidenceScore: 100,
          actionTaken: "skipped_daily_limit_reached",
        });
        decisions.push(decisionId);

        await this.completeRun(runId, {
          outputSummary: JSON.stringify({
            skipped: true,
            reason: "daily_limit_reached",
          }),
          itemsFound: 0,
          itemsProcessed: 0,
        });

        return {
          success: true,
          itemsFound: 0,
          itemsProcessed: 0,
          itemsQueued: 0,
          decisions,
          nextActions: [],
          errors,
        };
      }

      const payload = await this.loadTriggerPayload();
      if (!payload) {
        await this.completeRun(runId, {
          outputSummary: JSON.stringify({
            skipped: true,
            reason: "no_opportunity_in_payload",
          }),
          itemsFound: 0,
          itemsProcessed: 0,
        });

        return {
          success: true,
          itemsFound: 0,
          itemsProcessed: 0,
          itemsQueued: 0,
          decisions,
          nextActions: [],
          errors: [
            "No opportunityId available for this trigger; nothing to draft.",
          ],
        };
      }

      const { data: opportunityData, error: oppError } = await this.supabase
        .from("opportunities")
        .select(
          "id, name, category, description, amount_min, amount_max, deadline, eligibility_requirements, funder_id",
        )
        .eq("id", payload.opportunityId)
        .eq("organization_id", this.orgId)
        .single();

      if (oppError || !opportunityData) {
        throw new Error(
          `Opportunity ${payload.opportunityId} not found: ${oppError?.message ?? "no row returned"}`,
        );
      }
      const opportunity = opportunityData as OpportunityRow;
      const funderId = opportunity.funder_id ?? payload.funderId;

      const { data: orgProfileData } = await this.supabase
        .from("organizations")
        .select(
          "name, mission_statement, vision_statement, service_area, target_population, founder_name, annual_budget",
        )
        .eq("id", this.orgId)
        .single();
      const orgProfile = orgProfileData as OrgProfileRow | null;
      const orgName = orgProfile?.name ?? "the organization";

      // ---- PHASE 1: INTELLIGENCE GATHERING --------------------------------
      const [{ data: kbRows }, { data: provenRows }, { data: twinRow }] =
        await Promise.all([
          this.supabase
            .from("knowledge_base")
            .select("title, category, content")
            .eq("organization_id", this.orgId)
            .in("category", GRANT_NARRATIVE_KB_CATEGORIES)
            .order("is_proven", { ascending: false })
            .order("updated_at", { ascending: false }),
          this.supabase
            .from("proven_narratives")
            .select("narrative_text, section_type, effectiveness_score")
            .eq("organization_id", this.orgId)
            .eq("funder_category", opportunity.category)
            .order("effectiveness_score", {
              ascending: false,
              nullsFirst: false,
            })
            .limit(5),
          this.supabase
            .from("organizational_digital_twins")
            .select(
              "mission, vision, service_areas, programs, financial_profile, board_composition, proven_narrative_patterns, key_strengths, known_weaknesses",
            )
            .eq("organization_id", this.orgId)
            .maybeSingle(),
        ]);

      const knowledgeEntries = (kbRows ?? []) as KnowledgeBaseEntry[];
      const provenNarratives = (provenRows ?? []) as ProvenNarrativeRow[];
      const twin = (twinRow ?? null) as DigitalTwinRow | null;
      const twinContext = buildTwinContext(twin);

      const knowledgeEngineQueryText = [
        opportunity.category,
        opportunity.name,
        opportunity.description,
      ]
        .filter((v): v is string => Boolean(v))
        .join(" ")
        .slice(0, 300);

      const [
        platformPatterns,
        roiRecommendations,
        communityNeedSignals,
        fundability,
        funderIntel,
        knowledgeEngineResult,
      ] = await Promise.all([
        this.loadPlatformPatterns(opportunity.category),
        this.loadRoiRecommendations(),
        this.loadCommunityNeedSignals(),
        this.loadFundabilityContext(opportunity.id),
        this.loadFunderIntelligence(funderId),
        this.loadKnowledgeEnginePatterns(knowledgeEngineQueryText),
      ]);

      // Intelligence Library matching + Claude synthesis (extractGrantPatterns,
      // src/lib/intelligence/pattern-extractor.ts). Runs after funderIntel
      // resolves so the FUNDER MATCH tier can use the funder's real name.
      // Its internal Claude call's token usage is not surfaced back by
      // extractGrantPatterns's Promise<GrantPatternIntelligence> return type
      // (task-specified signature) -- not folded into this run's tokensUsed.
      const intelligence = await extractGrantPatterns(
        {
          name: orgName,
          missionStatement: orgProfile?.mission_statement ?? null,
          serviceArea: orgProfile?.service_area ?? null,
          targetPopulation: orgProfile?.target_population ?? null,
          annualBudget: orgProfile?.annual_budget ?? null,
        },
        {
          id: opportunity.id,
          name: opportunity.name,
          category: opportunity.category,
          description: opportunity.description,
          amountMin: opportunity.amount_min,
          amountMax: opportunity.amount_max,
          funderName: funderIntel.name,
        },
        this.supabase,
      );

      // "if twin_completeness < 40 create notification suggesting org
      // complete their digital twin before drafts can be optimal" — deduped
      // to once per org per day so a night with several drafts doesn't spam
      // the alerts feed with the same suggestion per opportunity.
      if (twinContext.completeness < TWIN_COMPLETENESS_NOTIFY_THRESHOLD) {
        const todayStartForNotify = new Date();
        todayStartForNotify.setUTCHours(0, 0, 0, 0);
        const dedupPrefix = `autonomous:${this.agentId}:twin_completeness_low:`;
        const { data: existingNotice } = await this.supabase
          .from("alerts")
          .select("id")
          .eq("organization_id", this.orgId)
          .like("dedup_key", `${dedupPrefix}%`)
          .gte("created_at", todayStartForNotify.toISOString())
          .limit(1)
          .maybeSingle();

        if (!existingNotice) {
          await this.createNotification(
            "twin_completeness_low",
            "Digital Twin Incomplete",
            `Your organizational digital twin is only ${twinContext.completeness}% complete. ` +
              `Complete it on /intelligence/twin for stronger, more specific AI-generated drafts.`,
          );
        }
      }

      const highConfidencePatternsApplied = platformPatterns.filter(
        (p) => (p.success_rate ?? 0) >= HIGH_CONFIDENCE_SUCCESS_RATE,
      ).length;

      // Twin data takes priority over KB data when both exist: KB categories
      // covered by a populated twin section are dropped from the prompt so
      // the richer, structurally-verified twin content isn't diluted or
      // contradicted by a possibly-stale KB entry for the same concept.
      const twinOverriddenCategories = new Set(
        (
          Object.entries(TWIN_SECTION_KB_OVERRIDES) as [
            keyof typeof TWIN_SECTION_KB_OVERRIDES,
            string[],
          ][]
        )
          .filter(([sectionKey]) => twinContext.sections[sectionKey] !== null)
          .flatMap(([, categories]) => categories),
      );
      const kbEntriesForPrompt = knowledgeEntries.filter(
        (e) => !twinOverriddenCategories.has(e.category),
      );

      const kbSection =
        kbEntriesForPrompt.length > 0
          ? kbEntriesForPrompt
              .map((e) => `[${e.category}] ${e.title}\n${e.content}`)
              .join("\n\n")
          : "No knowledge base entries available for this organization.";

      const provenSection =
        provenNarratives.length > 0
          ? provenNarratives
              .map(
                (p, i) =>
                  `[High-weight example ${i + 1} — effectiveness score ${p.effectiveness_score ?? "N/A"}, section: ${p.section_type ?? "general"}]\n${p.narrative_text}`,
              )
              .join("\n\n")
          : "No proven narratives available for this funder category yet.";

      const patternsSection =
        platformPatterns.length > 0
          ? platformPatterns
              .map((p) => {
                const rate =
                  p.success_rate != null
                    ? `${Math.round(p.success_rate * 100)}%`
                    : "N/A";
                return (
                  `[${p.pattern_type}] ${p.pattern_content} ` +
                  `(success rate: ${rate}, based on ${p.sample_count} ` +
                  `corroborating outcome${p.sample_count === 1 ? "" : "s"})`
                );
              })
              .join("\n")
          : null;

      const roiSection =
        roiRecommendations.length > 0
          ? roiRecommendations
              .map((r) => {
                const confidenceText =
                  r.confidence != null
                    ? `${Math.round(r.confidence * 100)}%`
                    : "N/A";
                const actionText = r.recommended_action
                  ? ` -> ${r.recommended_action}`
                  : "";
                return (
                  `[${r.insight_type}] ${r.insight_description}${actionText} ` +
                  `(confidence: ${confidenceText}, sample size: ${r.sample_size ?? "N/A"})`
                );
              })
              .join("\n")
          : null;

      const fundabilitySection = fundability
        ? [
            `Overall fundability score: ${fundability.overall_score ?? "N/A"}`,
            fundability.probability_without_fixes != null &&
            fundability.probability_with_fixes != null
              ? `Probability without fixes: ${fundability.probability_without_fixes}%, with fixes: ${fundability.probability_with_fixes}%`
              : null,
            fundability.recommendation
              ? `Recommendation: ${fundability.recommendation}`
              : null,
            ...(fundability.deficiencies ?? [])
              .slice(0, 3)
              .map(
                (d) =>
                  `Deficiency: ${d.factor}${d.fix_type ? ` (${d.fix_type})` : ""}`,
              ),
          ]
            .filter((line): line is string => Boolean(line))
            .join("\n")
        : null;

      const communityNeedBlock =
        communityNeedSignals.length > 0
          ? communityNeedSignals
              .map(
                (s) =>
                  `[${s.signal_category}] ${s.signal_description}` +
                  `${s.geographic_area ? ` (${s.geographic_area})` : ""}` +
                  `${s.severity ? ` — severity: ${s.severity}` : ""}`,
              )
              .join("\n")
          : "No community need signal data available for this organization's service area yet.";

      const funderSection = this.buildFunderIntelBlock(funderIntel);
      const intelligenceLibrarySection = buildIntelligenceLibrarySection(intelligence);
      const knowledgeEnginePatternsSection = buildKnowledgeEnginePatternBlock(
        knowledgeEngineResult,
      );

      const sharedContextBlock = this.buildSharedContextBlock({
        opportunity,
        orgName,
        orgProfile,
        twinContext,
        kbSection,
        provenSection,
        patternsSection,
        roiSection,
        fundabilitySection,
        funderSection,
        intelligenceLibrarySection,
        knowledgeEnginePatternsSection,
      });

      // ---- PHASE 2: NARRATIVE STRATEGY ------------------------------------
      const strategy = await this.generateNarrativeStrategy(
        sharedContextBlock,
        orgName,
      );
      tokensUsed += strategy.tokensUsed;

      const strategyDecisionId = await this.logDecision({
        decisionType: "narrative_strategy",
        agentRunId: runId,
        entityType: "opportunity",
        entityId: opportunity.id,
        reasoning: strategy.text,
        confidenceScore: 80,
        actionTaken: "defined_narrative_strategy",
        requiredHumanReview: false,
      });
      decisions.push(strategyDecisionId);

      // ---- PHASE 3: SECTION DRAFTING ---------------------------------------
      const { sections, tokensUsed: sectionTokensUsed } =
        await this.draftAllSections({
          sharedContextBlock,
          strategyText: strategy.text,
          orgName,
          communityNeedBlock,
          funderHistoryBlock: funderSection,
        });
      tokensUsed += sectionTokensUsed;

      const fullDraftText = assembleDraftText(sections);

      // ---- PHASE 4: COMPLIANCE CHECK ---------------------------------------
      const complianceResult = runComplianceCheck(
        sections,
        fullDraftText,
        opportunity,
      );

      // ---- HUMANIZATION PASS -------------------------------------------------
      // Runs on the fully assembled, compliance-checked draft, before the
      // applications row is created (task requirement: humanize after the
      // initial draft, before saving). Degrades to the pre-humanization
      // text on any failure rather than blocking draft creation, matching
      // this file's established defensive-load convention
      // (loadRoiRecommendations, loadFundabilityContext above).
      let finalDraftText = fullDraftText;
      let humanizationScore: number | null = null;
      let humanizationBreakdown: HumanizationScoreBreakdown | null = null;
      try {
        const humanizerOrgProfile = this.buildHumanizerOrgProfile({
          orgName,
          orgProfile,
          knowledgeEntries,
          twin,
        });
        const humanizerOpportunityContext: HumanizerOpportunityContext = {
          name: opportunity.name,
          category: opportunity.category,
          funderName: funderIntel.name,
        };
        const humanization = await humanizeNarrative(
          fullDraftText,
          humanizerOrgProfile,
          humanizerOpportunityContext,
        );
        finalDraftText = humanization.humanizedText;
        humanizationScore = humanization.humanizationScore;
        humanizationBreakdown = humanization.scoreBreakdown;
      } catch (err) {
        errors.push(
          `Narrative humanization failed, saving pre-humanization draft: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }

      // ---- STYLE GUIDE ENFORCEMENT ------------------------------------------
      // Runs on the humanized draft, before confidence scoring and the
      // applications INSERT. Deterministic (see grant-style-guide.ts header)
      // — a failure here degrades to "no style guide result" rather than
      // blocking draft creation, matching this file's established
      // defensive-load convention.
      let styleGuideResult: StyleGuideResult | null = null;
      try {
        const funderType = deriveFunderType(opportunity.category);
        styleGuideResult = enforceStyleGuide(finalDraftText, funderType, {
          opportunityDescription: opportunity.description,
          funderPriorities: funderIntel.notes,
          funderGeographicFocus: funderIntel.geographicFocus,
        });
        if (styleGuideResult.correctedText !== finalDraftText) {
          finalDraftText = styleGuideResult.correctedText;
        }
      } catch (err) {
        errors.push(
          `Style guide enforcement failed, saving draft without style corrections: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }

      const criticalStyleViolations =
        styleGuideResult?.violations.filter((v) => v.severity === "critical") ?? [];

      if (styleGuideResult && styleGuideResult.violations.length > 0) {
        const styleDecisionId = await this.logDecision({
          decisionType: "style_guide_violations",
          agentRunId: runId,
          entityType: "opportunity",
          entityId: opportunity.id,
          reasoning: styleGuideResult.violations
            .map(
              (v) =>
                `[${v.severity}] ${v.type}: ${v.suggestedReplacement || v.originalText}`,
            )
            .join("\n"),
          confidenceScore: criticalStyleViolations.length > 0 ? 40 : 70,
          actionTaken: "flagged_style_guide_violations",
          requiredHumanReview: criticalStyleViolations.length > 0,
        });
        decisions.push(styleDecisionId);
      }

      // ---- PHASE 5: CONFIDENCE SCORING -------------------------------------
      const needsInputCount = countNeedsInput(finalDraftText);
      const baseConfidence = computeBaseConfidence(
        needsInputCount,
        provenNarratives.length,
      );
      const confidence = computeFinalConfidence(
        baseConfidence,
        twinContext.completeness,
        platformPatterns.length,
      );
      const patternsApplied = platformPatterns.length;

      // HARD LIMIT: Never submit externally. Never call AutoApply. Never set submitted_at.
      // HARD LIMIT: Always set pending_review=true and auto_generated=true on created applications.
      const insertPayload: DraftApplicationPayload = {
        organization_id: this.orgId,
        opportunity_id: opportunity.id,
        stage: "drafting",
        draft_content: finalDraftText,
        draft_confidence_score: confidence,
        auto_generated: true,
        pending_review: true,
        draft_source: "autonomous",
        platform_patterns_applied: patternsApplied,
        knowledge_patterns_applied: knowledgeEngineResult.patterns.map(
          (p) => p.id,
        ),
        twin_powered: true,
        twin_completeness: twinContext.completeness,
        compliance_check_result: complianceResult as unknown as Record<
          string,
          unknown
        >,
        metadata: {
          humanization_score: humanizationScore,
          humanization_breakdown: humanizationBreakdown,
          style_guide_violations: styleGuideResult?.violations ?? [],
          style_guide_suggestions: styleGuideResult?.suggestions ?? [],
          // Read by the "Intelligence Used" section on
          // /draft-generator/autonomous (see that page for the render side).
          intelligence_pattern_analysis: {
            reference_narrative_count: intelligence.referenceNarratives.length,
            funder_types_matched: Array.from(
              new Set(
                intelligence.referenceNarratives
                  .map((n) => n.funderBucket)
                  .filter((b): b is NonNullable<typeof b> => Boolean(b)),
              ),
            ),
            winning_phrases_applied_count: intelligence.winningPhrases.length,
          },
          // Cross-org knowledge_patterns matches injected into the prompt
          // (see knowledge_patterns_applied column for the bare id list) --
          // kept here too, with the descriptive fields, so the same
          // "Intelligence Used" UI can render what each pattern actually
          // was without a separate join.
          knowledge_engine_patterns_applied: knowledgeEngineResult.patterns.map(
            (p) => ({
              id: p.id,
              pattern_type: p.pattern_type,
              category: p.category,
              funder_name: p.funder_name,
              pattern_description: p.pattern_description,
            }),
          ),
        },
        ...(() => {
          const noteLines: string[] = [];
          if (complianceResult.warnings.length > 0) {
            noteLines.push(
              "Autonomous compliance check flagged the following for reviewer attention:",
              ...complianceResult.warnings.map((w) => `- ${w}`),
            );
          }
          if (criticalStyleViolations.length > 0) {
            noteLines.push(
              "Style guide enforcement flagged critical issues:",
              ...criticalStyleViolations.map(
                (v) => `- [${v.type}] ${v.suggestedReplacement || v.originalText}`,
              ),
            );
          }
          return noteLines.length > 0 ? { notes: noteLines.join("\n") } : {};
        })(),
      };

      this.enforceHardLimits(insertPayload);

      const { data: newApp, error: insertError } = await this.supabase
        .from("applications")
        .insert(insertPayload)
        .select("id")
        .single();

      if (insertError || !newApp) {
        throw new Error(
          `Failed to create draft application: ${insertError?.message ?? "no row returned"}`,
        );
      }
      const newAppId = (newApp as { id: string }).id;

      const title = payload.title ?? opportunity.name;
      const score = payload.score;

      await this.sendDraftReadyNotificationEmail({
        orgName,
        draftTitle: title,
        funderName: funderIntel.name ?? "Unknown funder",
        confidence,
      });

      const decisionId = await this.logDecision({
        decisionType: "draft_generated",
        agentRunId: runId,
        entityType: "application",
        entityId: newAppId,
        reasoning:
          `Auto-generated draft for ${title} (probability: ${score ?? "N/A"}%). ` +
          `Confidence: ${confidence}% (base ${baseConfidence}%, twin completeness ` +
          `${twinContext.completeness}%). Platform learning patterns applied: ` +
          `${patternsApplied} (${highConfidencePatternsApplied} high-confidence). ` +
          `Intelligence Library: ${intelligence.referenceNarratives.length} reference narrative(s), ` +
          `${intelligence.winningPhrases.length} winning phrase(s) applied. ` +
          `Compliance check: ${complianceResult.passed ? "passed" : `${complianceResult.warnings.length} warning(s)`}. ` +
          `Humanization score: ${humanizationScore ?? "N/A"}. ` +
          `Style guide: ${styleGuideResult?.violations.length ?? 0} violation(s), ` +
          `${criticalStyleViolations.length} critical.`,
        confidenceScore: confidence,
        actionTaken: "created_draft_pending_review",
        requiredHumanReview: true,
      });
      decisions.push(decisionId);

      const notificationSuffix =
        complianceResult.warnings.length > 0
          ? ` Compliance check flagged ${complianceResult.warnings.length} item(s) for review.`
          : "";
      const styleSuffix =
        criticalStyleViolations.length > 0
          ? ` Style guide flagged ${criticalStyleViolations.length} critical issue(s): ${criticalStyleViolations
              .map((v) => v.type)
              .join(", ")}.`
          : "";
      await this.createNotification(
        "autonomous_draft_ready",
        "AI Draft Ready for Review",
        `${title} -- AI draft ready. Confidence: ${confidence}%. Click to review.${notificationSuffix}${styleSuffix}`,
        {
          applicationId: newAppId,
          opportunityId: opportunity.id,
          confidence,
          probabilityScore: score,
          styleGuideViolations: styleGuideResult?.violations.length ?? 0,
          criticalStyleViolations: criticalStyleViolations.length,
        },
      );

      await this.completeRun(runId, {
        outputSummary: JSON.stringify({
          draftCreated: true,
          applicationId: newAppId,
          confidence,
          requiresReview: true,
          patternsApplied,
          compliancePassed: complianceResult.passed,
          complianceWarnings: complianceResult.warnings.length,
          humanizationScore,
          styleGuideViolations: styleGuideResult?.violations.length ?? 0,
          criticalStyleViolations: criticalStyleViolations.length,
        }),
        itemsFound: 1,
        itemsProcessed: 1,
        tokensUsed,
        confidenceScore: confidence,
      });

      return {
        success: true,
        itemsFound: 1,
        itemsProcessed: 1,
        itemsQueued: 0,
        decisions,
        nextActions: [],
        errors,
      };
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Draft generation failed.";
      await this.failRun(runId, message);
      return {
        success: false,
        itemsFound: 0,
        itemsProcessed: 0,
        itemsQueued: 0,
        decisions,
        nextActions: [],
        errors: [...errors, message],
      };
    }
  }
}
