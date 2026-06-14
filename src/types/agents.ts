// Agent type definitions. See AGENTS.md for the full agent catalog.

export type AgentType =
  | "corporate_research"
  | "foundation_research"
  | "government_research"
  | "local_sponsorship"
  | "eligibility_scoring"
  | "deadline_extraction"
  | "grant_summary"
  | "fit_analysis"
  | "narrative_drafting"
  | "budget_builder"
  | "compliance_check"
  | "review"
  | "final_assembly"
  | "recursive_learning"
  | "cold_outreach"
  // Phase 3 - Browser Automation Agent (AGENTS.md Agent 16). Added to the DB
  // `agent_type` enum by migration 005 so BrowserAutomationAgent can log to
  // agent_runs via BaseAgent like every other agent.
  | "browser_automation"
  // Phase 4 - Email Matching Agent (AGENTS.md Agent 17). Added to the DB
  // `agent_type` enum by migration 006 so EmailMatcherAgent can log to
  // agent_runs via BaseAgent like every other agent.
  | "email_matching"
  // Phase 4 - Email Campaign Agent (AGENTS.md Agent 18). Added to the DB
  // `agent_type` enum by migration 007 so EmailCampaignAgent can log to
  // agent_runs via BaseAgent like every other agent.
  | "email_campaign"
  // Migration 014 - Cross-provider consensus validation (Gemini + Claude).
  | "consensus_validation"
  // Migration 015 - Funder Intelligence Agent. Scrapes a funder's website and
  // extracts structured priorities, recent grants, board members, and tips.
  | "funder_intel"
  // Migration 018 - Email Parser Agent. Classifies inbound emails, extracts
  // funder/opportunity references, and logs to email_activity.
  | "email_parser"
  // Migration 033/034 - Custom API Research Agent (AGENTS.md Agent 19).
  // Polls client-configured REST API connections for grant opportunities.
  | "custom_api_research"
  // Migration 035 - Automation Worker Agent (AGENTS.md Agent 29, BEHAVIORAL_CONTRACTS §23).
  // Processes the next queued item from automation_queue via browser automation pipeline.
  | "automation_worker"
  // Migration 038 - Success Probability Agent (AGENTS.md Agent 22, BEHAVIORAL_CONTRACTS §25).
  // Calculates per-application funding probability from 6 factors; stores in success_probability_scores.
  | "success_probability"
  // Migration 039 - Funder Relationship Agent (AGENTS.md Agent 23).
  // Deterministic score updates from interaction events; stores in funder_relationship_scores.
  | "funder_relationship"
  // Migration 040 - Competitor Intelligence Agent (AGENTS.md Agent 24, BEHAVIORAL_CONTRACTS §27).
  // Identifies competitor organizations from 990-PF giving history; stores in competitor_tracking.
  // Enterprise and Consultant tiers only.
  | "competitor_intelligence"
  // Tier 6 Phase A - Grants.gov Research Agent (AGENTS.md Agent 15, BEHAVIORAL_CONTRACTS §17).
  // Polls the public Grants.gov search API for federal opportunities matching search profile keywords.
  // No API key required; Grants.gov search endpoint is public.
  | "grants_gov_research"
  // Tier 6 Phase A - SAM.gov Research Agent (AGENTS.md Agent 16, BEHAVIORAL_CONTRACTS §18).
  // Polls the SAM.gov federal opportunities API for grant-type records matching search profile keywords.
  // Requires client-supplied SAM.gov API key stored in integration_keys.
  | "sam_gov_research";

export type AgentRunStatus = "pending" | "running" | "completed" | "failed";

export interface AgentRunResult {
  status: AgentRunStatus;
  itemsFound: number;
  itemsProcessed: number;
  outputSummary: string;
  tokensUsed?: number;
  errorMessage?: string;
}
