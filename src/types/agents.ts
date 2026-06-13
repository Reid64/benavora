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
  // Phase 3 — Browser Automation Agent (AGENTS.md Agent 16). Added to the DB
  // `agent_type` enum by migration 005 so BrowserAutomationAgent can log to
  // agent_runs via BaseAgent like every other agent.
  | "browser_automation"
  // Phase 4 — Email Matching Agent (AGENTS.md Agent 17). Added to the DB
  // `agent_type` enum by migration 006 so EmailMatcherAgent can log to
  // agent_runs via BaseAgent like every other agent.
  | "email_matching"
  // Phase 4 — Email Campaign Agent (AGENTS.md Agent 18). Added to the DB
  // `agent_type` enum by migration 007 so EmailCampaignAgent can log to
  // agent_runs via BaseAgent like every other agent.
  | "email_campaign"
  // Migration 014 — Cross-provider consensus validation (Gemini + Claude).
  | "consensus_validation"
  // Migration 015 — Funder Intelligence Agent. Scrapes a funder's website and
  // extracts structured priorities, recent grants, board members, and tips.
  | "funder_intel"
  // Migration 018 — Email Parser Agent. Classifies inbound emails, extracts
  // funder/opportunity references, and logs to email_activity.
  | "email_parser";

export type AgentRunStatus = "pending" | "running" | "completed" | "failed";

export interface AgentRunResult {
  status: AgentRunStatus;
  itemsFound: number;
  itemsProcessed: number;
  outputSummary: string;
  tokensUsed?: number;
  errorMessage?: string;
}
