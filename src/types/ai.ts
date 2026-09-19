// AI request/response types for Claude-backed routes and drafting.

// ---------------------------------------------------------------------------
// Pattern analysis types (Recursive Learning Agent - AGENTS.md Agent 10).
// Stored in proven_narratives.success_patterns (migration 017).
// ---------------------------------------------------------------------------

/** A single effective or ineffective language pattern identified by analysis. */
export interface SuccessPatternEntry {
  description: string;
  example: string;
}

/** Structured output from the pattern analyzer - stored as JSONB. */
export interface SuccessPatternAnalysis {
  winning_patterns: SuccessPatternEntry[];
  losing_patterns: SuccessPatternEntry[];
  recommendations: string[];
}

export type DraftTemplateType =
  | "grant_narrative"
  | "donation_request_letter"
  | "budget_narrative"
  | "impact_statement"
  | "letter_of_inquiry"
  | "full_proposal";

/** A single Knowledge Base / proven-narrative / intelligence-library source cited in a draft. */
export interface KnowledgeSource {
  id: string;
  kind:
    | "knowledge_base"
    | "proven_narrative"
    | "intelligence_library"
    | "knowledge_engine";
  title: string;
}

/** Lifecycle of a draft through the humanization agent (mirrors the DB enum). */
export type HumanizationStatus =
  | "not_humanized"
  | "pending"
  | "humanized"
  | "failed";

export interface DraftRequest {
  opportunityId: string;
  templateType: DraftTemplateType;
}

/** Metadata for the draft_versions row auto-saved when a draft is generated. */
export interface SavedDraftVersion {
  id: string;
  versionNumber: number;
  humanizationStatus: HumanizationStatus;
  createdAt: string;
}

/** A single dimension from a scoring rubric (from intelligence_scoring_rubrics). */
export interface RubricDimension {
  /** Human-readable scoring criterion name, e.g. "Need Statement Quality". */
  name: string;
  /** Point value for this dimension (raw, not normalized). */
  points: number;
  /** What earns full marks on this dimension. */
  description: string;
}

/**
 * Program logic model attached to a generated draft. Carries the five logic-model
 * stages inline plus the resolution metadata. Structurally matches the server's
 * GeneratedLogicModel (lib/intelligence/logic-model-generator) and the
 * LogicModelView component's LogicModelData, so it can be rendered directly.
 */
export interface DraftLogicModel {
  inputs: string[];
  activities: string[];
  outputs: string[];
  outcomes: string[];
  impact: string[];
  /** Funder/program category the model was resolved for. */
  category: string;
  /** True when sourced from an intelligence-library template; false when AI-generated. */
  templateBased: boolean;
  /** Source template id when templateBased. */
  templateId?: string;
}

/** Single item in a compliance checklist produced during draft generation. */
export interface DraftComplianceItem {
  requirementId: string;
  requirementName: string;
  status: 'pass' | 'fail' | 'warning' | 'unknown';
  severity: 'required' | 'recommended';
  message: string;
  citation: string;
}

/** Aggregate compliance check result attached to every generated draft. */
export interface DraftComplianceChecklist {
  overallStatus: 'pass' | 'fail' | 'warning';
  passCount: number;
  failCount: number;
  warningCount: number;
  unknownCount: number;
  items: DraftComplianceItem[];
}

export interface DraftResult {
  content: string;
  /** AI confidence 0-100. Below 70 must show a review warning. */
  confidenceScore: number;
  sources: KnowledgeSource[];
  /**
   * The version persisted to draft_versions on generation. Always present on
   * a 200 response (WGR-129) - a save failure makes the whole request fail
   * (5xx), it is never reported as a successful draft with no saved row.
   */
  savedVersion: SavedDraftVersion;
  /** Scoring rubric dimensions retrieved from the intelligence library (if available). */
  rubric?: RubricDimension[] | null;
  /** True when the rubric was inferred from the opportunity description rather than matched from the database. */
  rubricInferred?: boolean;
  /**
   * Program logic model used to ground the program-design section. Present only
   * for templates that need one (full_proposal, or opportunities mentioning a
   * logic model / theory of change). Null/absent otherwise.
   */
  logicModel?: DraftLogicModel | null;
  /**
   * Compliance checklist produced for every draft. Required items with status
   * 'fail' or 'warning' reduce the confidence score. Null only when the check
   * itself failed (non-blocking).
   */
  complianceChecklist?: DraftComplianceChecklist | null;
  /**
   * AR-17.6: true when the organization had no substantive profile/
   * knowledge-base data to draft from. `content` is an explicit
   * incomplete-draft notice naming what's missing, not model-generated
   * prose. Callers (UI) should render this distinctly from a normal draft,
   * even a low-confidence one.
   */
  incomplete?: boolean;
  /** Populated only when `incomplete` is true. */
  missingFacts?: string[];
  /**
   * AR-17.6: figure/number claims Claude returned that could not be traced
   * to the organization's stored data or the funder's opportunity data.
   * Each was replaced with a [NEEDS INPUT] marker in `content` before
   * saving. Empty array (not absent) when the check ran and found nothing.
   */
  scrubbedFigures?: string[];
}

/** Result of the Humanizer pass (/api/ai/humanize). */
export interface HumanizeResult {
  /** The humanized draft, after the anti-detection rewrite + enforcement. */
  content: string;
  /**
   * Confidence 0-100, recomputed to reflect humanization: it blends grounding
   * (KB/proven coverage, unresolved gaps) with how human the rewrite reads.
   */
  confidenceScore: number;
  /** Always "humanized" on success; the saved version carries the same status. */
  humanizationStatus: HumanizationStatus;
  sources: KnowledgeSource[];
  /** The new humanized version appended to draft_versions (best-effort save). */
  savedVersion?: SavedDraftVersion | null;
  /** 0-100 "reads human" quality score from the humanization metrics. */
  humanizationScore: number;
}

// ---------------------------------------------------------------------------
// Prompt construction context (Agent 05 - Narrative Drafting).
// These shapes carry the verified, organization-scoped data the prompt
// builders weave into a draft. Per BEHAVIORAL_CONTRACTS §9 the AI uses ONLY
// this data - it never fabricates organizational facts.
// ---------------------------------------------------------------------------

/** Verified organization profile facts (from the organizations row). */
export interface DraftOrgContext {
  name: string;
  dba: string | null;
  ein: string | null;
  taxStatus: string | null;
  missionStatement: string | null;
  visionStatement: string | null;
  serviceArea: string | null;
  targetPopulation: string | null;
  founderName: string | null;
  annualBudget: number | null;
}

/** The opportunity the draft is written for. */
export interface DraftOpportunityContext {
  name: string;
  category: string;
  description: string | null;
  funderName: string | null;
  eligibilityRequirements: string | null;
  amountMin: number | null;
  amountMax: number | null;
  requiredDocuments: string[] | null;
}

/** A reusable Knowledge Base entry loaded for the draft. */
export interface DraftKnowledgeEntry {
  id: string;
  title: string;
  category: string;
  content: string;
}

/** A proven narrative - previously funded content, weighted heavily. */
export interface DraftProvenNarrative {
  id: string;
  sectionType: string | null;
  funderCategory: string | null;
  effectivenessScore: number | null;
  narrativeText: string;
}

/** Everything a prompt builder needs to assemble a grounded draft. */
export interface DraftPromptContext {
  organization: DraftOrgContext | null;
  opportunity: DraftOpportunityContext;
  knowledgeEntries: DraftKnowledgeEntry[];
  provenNarratives: DraftProvenNarrative[];
  /** Top winning language patterns for this funder category (from success_patterns). */
  successPatterns?: SuccessPatternEntry[];
}

/** A built prompt: system persona + rules, and the user-turn task. */
export interface DraftPrompt {
  system: string;
  prompt: string;
}

// ---------------------------------------------------------------------------
// Budget Builder types (Agent 06 - /api/ai/budget).
// ---------------------------------------------------------------------------

/** One line item in a structured grant budget. */
export interface BudgetTableItem {
  category: string;
  amount: number | null;
  /** One-sentence tie of this cost to program activities. */
  justification: string;
  /** amount / total_requested * 100, or null when total is unknown. */
  percentage: number | null;
}

/** Response shape from POST /api/ai/budget. */
export interface BudgetApiResult {
  budget_table: BudgetTableItem[];
  total_requested: number | null;
  /** Prose narrative justifying the budget as a whole, humanized. */
  budget_narrative: string;
  /** AI confidence 0-100 (BEHAVIORAL_CONTRACTS §9). */
  confidence_score: number;
  sources: KnowledgeSource[];
  savedVersion: SavedDraftVersion | null;
  belowThreshold: boolean;
}
