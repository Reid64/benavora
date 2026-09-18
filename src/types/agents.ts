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
  | "sam_gov_research"
  // Tier 6 Phase A - ProPublica 990 Mining Agent (AGENTS.md Agent 17, BEHAVIORAL_CONTRACTS §19).
  // Queries ProPublica Nonprofit Explorer API for IRS 990/990-PF filing data.
  // No API key required; extracts revenue, expenses, assets, grants paid per fiscal year.
  | "propublica_mining"
  // Tier 6 Phase A - State Portal Research Agent (AGENTS.md Agent 18, BEHAVIORAL_CONTRACTS §21).
  // Fetches HTML from state grant portals and uses Claude to extract structured opportunity data.
  // Tier-gated: Starter=1 state, Pro=5 states, Enterprise/Consultant=all states.
  | "state_portal"
  // Tier 6 Phase C - Giving History Extractor (AGENTS.md Agent 21, BEHAVIORAL_CONTRACTS §19).
  // Queries ProPublica Nonprofit Explorer for IRS 990-PF filing data by EIN.
  // Extracts per-year grants paid, revenue, assets; calculates giving trend.
  // No API key required; stores results in funder_intelligence.recent_grants.
  | "giving_history_extractor"
  // Predicts future deadlines from historical opportunity deadline patterns.
  // Identifies annual, quarterly, or irregular cycles; auto-creates opportunity
  // rows for high-confidence predictions.
  | "deadline_prediction"
  // Application Cloning Agent (AGENTS.md Agent 26, BEHAVIORAL_CONTRACTS §26).
  // Clones an existing application to a new target opportunity, adapts the draft
  // via Claude, copies linked documents, and creates a pipeline_history entry.
  | "application_cloning"
  // Semantic Matching Agent - uses Claude to score semantic alignment between
  // the org profile and each funder, returning a ranked list with reasoning.
  | "semantic_matching"
  // Follow-Up Generator Agent (AGENTS.md Agent 28, BEHAVIORAL_CONTRACTS §28).
  // Generates a 3-step humanized follow-up email sequence after a grant
  // application is submitted; stores results as a note on the application.
  | "follow_up_generator"
  // Simpler Grants Research Agent — polls the public Simpler.Grants.gov v1
  // search API (no auth required) for federal opportunities matching keywords.
  | "simpler_grants_research"
  // HUD Monitor Agent — fetches HUD funding opportunities page and uses Claude
  // to extract structured opportunity data; maps to housing_grant category.
  | "hud_monitor"
  // AutoApply Form Analysis Engine — visits a funder's giving portal URL via
  // Playwright, extracts form structure via Claude, stores field mapping in
  // form_templates for use by the AutoApply worker.
  | "form_analyzer"
  // AutoApply Form Fill Engine — fills and submits a corporate giving form using
  // a stored form_template via Playwright. Creates autoapply_submissions records
  // with screenshots and confirmation numbers.
  | "form_filler"
  // Corporate Intelligence Engine (CORPORATE_INTELLIGENCE_ARCHITECTURE.md §2B/§6,
  // Agent EA-01..EA-05). Enrich corporate_prospects.enrichment jsonb.
  // Migration 107 adds these to the DB agent_type enum.
  | "ea01_giving_detector"
  | "ea02_community_outreach_detector"
  | "ea03_sponsorship_detector"
  | "ea04_foundation_detector"
  | "ea05_career_page_analyzer"
  // Migration 108 adds these to the DB agent_type enum.
  | "ea06_press_release_analyzer"
  | "ea07_esg_analyzer"
  | "ea08_executive_biography_analyzer"
  | "ea09_contact_extractor"
  | "ea10_social_media_analyzer"
  // Corporate Intelligence Engine (CORPORATE_INTELLIGENCE_ARCHITECTURE.md §3,
  // AGENTS_v2.md AG-22). Computes PS-01..PS-10 propensity scores into
  // corporate_prospects.scores jsonb. Migration 109 adds this to the DB
  // agent_type enum.
  | "ag22_propensity_scoring"
  // Grant Probability Scoring Agent (PLATFORM_VISION_ARCHITECTURE.md Pillar 5,
  // AGENTS_v2.md AG-15). agentId is literally "ag-15-probability" (not renamed
  // to the more conventional ag15_* form) because opportunity-discovery-agent.ts
  // chains into this agent via queueChainedAgent using that exact literal.
  // Migration 178 adds this to the DB agent_type enum.
  | "ag-15-probability"
  // p5a-002 (2026-09-15) — DB-level agent_type collision cleanup. These 8
  // values already existed in the live DB enum (added by an earlier,
  // never-committed DDL pass) but were never wired into the code that should
  // use them; the shadow-duplicate files below silently wrote their working
  // sibling's bucket instead. Wiring them here only changes which DB row a
  // given agent's run is attributed to — no agent's runtime behavior changes.
  // See AGENTS_v2.md's "Canonical implementation per AG-NN slot" table.
  | "government_research_housing_scrapers" // housing-specific-scrapers.ts (was government_research)
  | "government_research_nofa_parser" // nofa-parser.ts (was government_research)
  | "government_research_usaspending" // usaspending.ts (was government_research)
  | "foundation_research_finder" // foundation-finder.ts (was foundation_research)
  | "custom_scrape_research" // custom-scrape.ts (was custom_api_research)
  | "state_portal_housing_scrapers" // state-scrapers.ts (was state_portal)
  | "state_portal_tdhca" // tdhca-scraper.ts (was state_portal)
  // budget-builder.ts (was budget_builder). Phase 5.4 (2026-09-15) wired
  // case 'budget_builder' into worker/autonomous-orchestrator.ts's
  // routeQueueItem() — no longer dormant/zero-importers as of that fix.
  | "budget_builder_worker"
  // Phase 5.5 (2026-09-15) — documentation-only addition, not a schema
  // change: both values below already existed in the live agent_type enum
  // (same never-committed-DDL-pass pattern as the p5a-002 block above) but
  // were absent from this union. Neither learning-network-aggregator-
  // agent.ts (AG-36) nor change-monitor-agent.ts (AG-42) type their
  // agentId against AgentType (both extend AutonomousAgent, whose agentId
  // is a plain string), so this addition doesn't fix a compile error — it
  // makes this union an accurate catalog of every real agent_type value.
  | "ag-36-learning-network" // learning-network-aggregator-agent.ts
  | "ag-42-change-monitor" // change-monitor-agent.ts
  // AR-1.2 (2026-09-17) — AutoApply agent identity. The 40-module AutoApply
  // pipeline under src/lib/autoapply/** (called directly from
  // worker/queue-processor.ts, not via BaseAgent — see run-logger.ts) wrote
  // no agent_type and logged nothing to agent_runs, so no AutoApply execution
  // was ever attributable. These values are new and do not alias the
  // pre-existing "form_analyzer"/"form_filler" values, which belong to the
  // separate BaseAgent-driven src/lib/agents/form-analyzer.ts and
  // src/lib/agents/form-filler.ts (the Vercel API route implementations —
  // see those files' own header comments for why the logic is duplicated
  // rather than shared).
  | "autoapply_form_analyzer" // src/lib/autoapply/form-analyzer-agent.ts
  | "autoapply_form_filler" // src/lib/autoapply/form-filler-agent.ts
  | "autoapply_registration" // src/lib/autoapply/registration-agent.ts
  | "autoapply_submission_validator" // src/lib/autoapply/submission-validator.ts
  | "autoapply_receipt" // src/lib/autoapply/receipt-generator.ts
  | "autoapply_risk_engine" // src/lib/autoapply/risk-engine.ts
  | "autoapply_pitch_personalizer" // src/lib/autoapply/pitch-personalizer.ts
  | "autoapply_captcha_solver" // src/lib/autoapply/captcha-solver.ts
  | "autoapply_confirmation_parser" // src/lib/autoapply/confirmation-parser.ts
  | "autoapply_queue_processor"; // worker/queue-processor.ts

export type AgentRunStatus = "pending" | "running" | "completed" | "failed" | "skipped";

export interface AgentRunResult {
  status: AgentRunStatus;
  itemsFound: number;
  itemsProcessed: number;
  outputSummary: string;
  tokensUsed?: number;
  errorMessage?: string;
}
