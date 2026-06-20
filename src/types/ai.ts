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
  kind: "knowledge_base" | "proven_narrative" | "intelligence_library";
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

export interface DraftResult {
  content: string;
  /** AI confidence 0-100. Below 70 must show a review warning. */
  confidenceScore: number;
  sources: KnowledgeSource[];
  /**
   * The version auto-persisted to draft_versions on generation. Null only if
   * the (best-effort) save failed - generation itself still succeeds.
   */
  savedVersion?: SavedDraftVersion | null;
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
