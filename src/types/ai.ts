// AI request/response types for Claude-backed routes and drafting.

export type DraftTemplateType =
  | "grant_narrative"
  | "donation_request_letter"
  | "budget_narrative"
  | "impact_statement"
  | "letter_of_inquiry"
  | "full_proposal";

/** A single Knowledge Base / proven-narrative source cited in a draft. */
export interface KnowledgeSource {
  id: string;
  kind: "knowledge_base" | "proven_narrative";
  title: string;
}

export interface DraftRequest {
  opportunityId: string;
  templateType: DraftTemplateType;
}

export interface DraftResult {
  content: string;
  /** AI confidence 0-100. Below 70 must show a review warning. */
  confidenceScore: number;
  sources: KnowledgeSource[];
}

// ---------------------------------------------------------------------------
// Prompt construction context (Agent 05 — Narrative Drafting).
// These shapes carry the verified, organization-scoped data the prompt
// builders weave into a draft. Per BEHAVIORAL_CONTRACTS §9 the AI uses ONLY
// this data — it never fabricates organizational facts.
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

/** A proven narrative — previously funded content, weighted heavily. */
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
}

/** A built prompt: system persona + rules, and the user-turn task. */
export interface DraftPrompt {
  system: string;
  prompt: string;
}
