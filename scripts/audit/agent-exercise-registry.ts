// AR-4.1 Step 1 — typed registry of every invocable agent discovered by
// scanning src/lib/agents/**, src/lib/pil/agents/**, src/lib/autoapply/**,
// src/lib/intelligence/**, and src/lib/research/**. Every entry below was
// verified against the actual on-disk source (constructor/execute/run
// signatures, agent_type/agent_id literals, DB write paths) — not derived
// from AGENTS.md, AGENTS_v2.md, or PROSPECT_INTELLIGENCE_AGENTS.md, all of
// which disagree with the live code and with each other on the total count
// (44 vs 48 vs 51 for PIL alone; no file anywhere in the repo claims "154").
// See AGENT_EXERCISE_REPORT.md for the full reconciliation.
//
// Five shapes cover every agent found:
//   1. BaseAgent subclass       (src/lib/agents/**)        -> baseAgentDescriptor
//   2. AutonomousAgent subclass (src/lib/agents/**, intelligence/) -> autonomousAgentDescriptor
//   3. PIL Agent                (src/lib/pil/agents/**)     -> pilAgentDescriptor
//   4. autoapply module         (src/lib/autoapply/**)      -> bespoke, see AUTOAPPLY_AGENTS
//   5. plain function           (src/lib/agents/**)         -> bespoke, see PLAIN_FUNCTION_AGENTS
// src/lib/research/** contains zero invocable agents (config/data only —
// RESEARCH_FAMILY_AGENTS is intentionally empty; see notes at the bottom).
import path from "node:path";
import { pathToFileURL } from "node:url";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { SeededFixture } from "./seed-exercise-org";

export type AgentFamily = "core" | "pil" | "autoapply" | "intelligence" | "research" | "worker";

export interface InvokeContext {
  client: SupabaseClient;
  fixture: SeededFixture;
}

export interface AgentDescriptor {
  agentType: string;
  family: AgentFamily;
  modulePath: string;
  exportName: string;
  requiresBrowser: boolean;
  callsClaude: boolean;
  writesTable: "agent_runs" | "pil_agent_runs" | "none";
  notes?: string;
  invoke: (ctx: InvokeContext) => Promise<unknown>;
}

const REPO_ROOT = path.resolve(__dirname, "..", "..");

export async function loadModule(modulePath: string): Promise<Record<string, any>> {
  const abs = path.resolve(REPO_ROOT, modulePath);
  return import(pathToFileURL(abs).href);
}

// ---------------------------------------------------------------------------
// Local-fixture browser helper. Every requiresBrowser=true entry in this
// registry points a real Chromium session (via StealthBrowser) at the local
// scripts/audit/fixtures/fixture-application-form.html file — never at an
// external domain — per STEP 4's safety guard: the AutoApply chain may only
// be exercised against a local fixture, never a live funder portal.
// ---------------------------------------------------------------------------
export async function withFixturePage<T>(
  fixture: SeededFixture,
  fn: (page: any, session: any) => Promise<T>,
): Promise<T> {
  const { StealthBrowser } = await loadModule("src/lib/autoapply/stealth-browser.ts");
  const browser = new StealthBrowser({ headless: true });
  const session = await browser.launch();
  try {
    await session.page.goto(fixture.fixtureUrl);
    return await fn(session.page, session);
  } finally {
    await session.browser.close().catch(() => {});
  }
}

// ===========================================================================
// SHAPE 1 — BaseAgent subclasses (src/lib/agents/**)
//   new Ctor({ client, organizationId, triggeredBy: null }).run(input)
// ===========================================================================
interface BaseAgentSpec {
  agentType: string;
  modulePath: string;
  exportName: string;
  requiresBrowser?: boolean;
  callsClaude?: boolean;
  notes?: string;
  buildInput: (f: SeededFixture) => Record<string, unknown>;
}

function baseAgentDescriptor(spec: BaseAgentSpec): AgentDescriptor {
  return {
    agentType: spec.agentType,
    family: "core",
    modulePath: spec.modulePath,
    exportName: spec.exportName,
    requiresBrowser: spec.requiresBrowser ?? false,
    callsClaude: spec.callsClaude ?? false,
    writesTable: "agent_runs",
    notes: spec.notes,
    invoke: async ({ client, fixture }) => {
      const mod = await loadModule(spec.modulePath);
      const Ctor = mod[spec.exportName];
      const agent = new Ctor({ client, organizationId: fixture.orgId, triggeredBy: null });
      return agent.run(spec.buildInput(fixture));
    },
  };
}

const BASE_AGENT_SPECS: BaseAgentSpec[] = [
  {
    agentType: "cold_outreach",
    modulePath: "src/lib/agents/cold-outreach.ts",
    exportName: "ColdOutreachAgent",
    callsClaude: true,
    buildInput: () => ({ companyName: "EXERCISE-HARNESS Fixture Co" }),
  },
  {
    agentType: "budget_builder_worker",
    modulePath: "src/lib/agents/budget-builder.ts",
    exportName: "BudgetBuilderAgent",
    callsClaude: true,
    buildInput: (f) => ({ opportunityId: f.opportunityId, requestedAmount: 10000 }),
  },
  {
    agentType: "budget_builder",
    modulePath: "src/lib/agents/budget-agent.ts",
    exportName: "BudgetAgent",
    callsClaude: true,
    notes: "No programs row seeded (out of scope for STEP 2) — expected to throw/no-op on missing programId.",
    buildInput: (f) => ({ opportunityId: f.opportunityId, programId: "00000000-0000-0000-0000-000000000000" }),
  },
  {
    agentType: "ea01_giving_detector",
    modulePath: "src/lib/agents/ea-01-giving-detector.ts",
    exportName: "EA01GivingDetectorAgent",
    callsClaude: true,
    buildInput: (f) => ({ prospectId: f.corporateProspectId }),
  },
  {
    agentType: "ea02_community_outreach_detector",
    modulePath: "src/lib/agents/ea-02-community-outreach-detector.ts",
    exportName: "EA02CommunityOutreachDetectorAgent",
    callsClaude: true,
    buildInput: (f) => ({ prospectId: f.corporateProspectId }),
  },
  {
    agentType: "ea03_sponsorship_detector",
    modulePath: "src/lib/agents/ea-03-sponsorship-detector.ts",
    exportName: "EA03SponsorshipDetectorAgent",
    callsClaude: true,
    notes: "Gated on EA-01 having already set enrichment.has_giving_program on the same prospect; registry order runs EA-01 first in the same pass.",
    buildInput: (f) => ({ prospectId: f.corporateProspectId }),
  },
  {
    agentType: "ea04_foundation_detector",
    modulePath: "src/lib/agents/ea-04-foundation-detector.ts",
    exportName: "EA04FoundationDetectorAgent",
    callsClaude: true,
    buildInput: (f) => ({ prospectId: f.corporateProspectId }),
  },
  {
    agentType: "ea05_career_page_analyzer",
    modulePath: "src/lib/agents/ea-05-career-page-analyzer.ts",
    exportName: "EA05CareerPageAnalyzerAgent",
    callsClaude: true,
    buildInput: (f) => ({ prospectId: f.corporateProspectId }),
  },
  {
    agentType: "ea06_press_release_analyzer",
    modulePath: "src/lib/agents/ea-06-press-release-analyzer.ts",
    exportName: "EA06PressReleaseAnalyzerAgent",
    callsClaude: true,
    notes: "Gated on EA-02 having already run on the same prospect; registry order runs EA-02 first.",
    buildInput: (f) => ({ prospectId: f.corporateProspectId }),
  },
  {
    agentType: "ea07_esg_analyzer",
    modulePath: "src/lib/agents/ea-07-esg-analyzer.ts",
    exportName: "EA07EsgAnalyzerAgent",
    callsClaude: true,
    notes: "Gated on EA-02 having already run on the same prospect; registry order runs EA-02 first.",
    buildInput: (f) => ({ prospectId: f.corporateProspectId }),
  },
  {
    agentType: "ea08_executive_biography_analyzer",
    modulePath: "src/lib/agents/ea-08-executive-biography-analyzer.ts",
    exportName: "EA08ExecutiveBiographyAnalyzerAgent",
    callsClaude: true,
    buildInput: (f) => ({ prospectId: f.corporateProspectId }),
  },
  {
    agentType: "ea09_contact_extractor",
    modulePath: "src/lib/agents/ea-09-contact-extractor.ts",
    exportName: "EA09ContactExtractorAgent",
    callsClaude: true,
    buildInput: (f) => ({ prospectId: f.corporateProspectId }),
  },
  {
    agentType: "ea10_social_media_analyzer",
    modulePath: "src/lib/agents/ea-10-social-media-analyzer.ts",
    exportName: "EA10SocialMediaAnalyzerAgent",
    callsClaude: true,
    notes: "Gated on EA-08 having already run on the same prospect; registry order runs EA-08 first.",
    buildInput: (f) => ({ prospectId: f.corporateProspectId }),
  },
  {
    agentType: "corporate_research",
    modulePath: "src/lib/agents/corporate-scraper.ts",
    exportName: "CorporateScraperAgent",
    callsClaude: true,
    buildInput: () => ({}),
  },
  {
    agentType: "custom_api_research",
    modulePath: "src/lib/agents/custom-api.ts",
    exportName: "CustomApiResearchAgent",
    notes: "No active custom_api_connections row seeded — expected no-op.",
    buildInput: () => ({}),
  },
  {
    agentType: "browser_automation",
    modulePath: "src/lib/agents/browser-automation.ts",
    exportName: "BrowserAutomationAgent",
    requiresBrowser: true,
    buildInput: (f) => ({ applicationId: f.applicationId }),
  },
  {
    agentType: "browser_automation",
    modulePath: "src/lib/agents/playwright-agent.ts",
    exportName: "PlaywrightAgent",
    requiresBrowser: true,
    callsClaude: true,
    notes: "Shares the agent_type literal 'browser_automation' with browser-automation.ts by design (pre-existing collision, not a bug this harness should fix).",
    buildInput: (f) => ({ url: f.fixtureUrl, keywords: [], mode: "discover", templateData: {} }),
  },
  {
    agentType: "deadline_extraction",
    modulePath: "src/lib/agents/deadline-extractor.ts",
    exportName: "DeadlineExtractor",
    buildInput: (f) => ({ opportunityId: f.opportunityId }),
  },
  {
    agentType: "custom_scrape_research",
    modulePath: "src/lib/agents/custom-scrape.ts",
    exportName: "CustomScrapeResearchAgent",
    callsClaude: true,
    notes: "No active scraping_targets row seeded — expected no-op.",
    buildInput: () => ({}),
  },
  {
    agentType: "deadline_prediction",
    modulePath: "src/lib/agents/deadline-prediction.ts",
    exportName: "DeadlinePredictionAgent",
    notes: "Needs >=2 dated opportunities for the org; only one is seeded — expected 'insufficient data'.",
    buildInput: () => ({}),
  },
  {
    agentType: "application_cloning",
    modulePath: "src/lib/agents/application-cloner.ts",
    exportName: "ApplicationClonerAgent",
    callsClaude: true,
    buildInput: (f) => ({ sourceApplicationId: f.applicationId, targetOpportunityId: f.opportunityId }),
  },
  {
    agentType: "email_parser",
    modulePath: "src/lib/agents/email-parser.ts",
    exportName: "EmailParserAgent",
    callsClaude: true,
    buildInput: () => ({
      emails: [
        {
          from: "donor@example-exercise-harness.invalid",
          subject: "Re: EXERCISE-HARNESS grant",
          body: "Thanks for the update on our grant application.",
        },
      ],
    }),
  },
  {
    agentType: "eligibility_scoring",
    modulePath: "src/lib/agents/eligibility-scorer.ts",
    exportName: "EligibilityScorer",
    callsClaude: true,
    buildInput: (f) => ({ opportunityId: f.opportunityId }),
  },
  {
    agentType: "compliance_check",
    modulePath: "src/lib/agents/compliance-checker.ts",
    exportName: "ComplianceChecker",
    callsClaude: true,
    buildInput: (f) => ({ applicationId: f.applicationId }),
  },
  {
    agentType: "email_campaign",
    modulePath: "src/lib/agents/email-campaign.ts",
    exportName: "EmailCampaignAgent",
    notes: "No active email_campaigns row seeded — expected no-op.",
    buildInput: () => ({}),
  },
  {
    agentType: "form_analyzer",
    modulePath: "src/lib/agents/form-analyzer.ts",
    exportName: "FormAnalyzerAgent",
    requiresBrowser: true,
    callsClaude: true,
    buildInput: (f) => ({ funderId: f.funderId }),
  },
  {
    agentType: "form_filler",
    modulePath: "src/lib/agents/form-filler.ts",
    exportName: "FormFillerAgent",
    requiresBrowser: true,
    callsClaude: true,
    notes: "Needs a prior form_templates row for this funder; registry runs form-analyzer.ts first in the same pass so one may already exist.",
    buildInput: (f) => ({ funderId: f.funderId, requestAmount: 10000, requestDescription: "EXERCISE-HARNESS fixture request" }),
  },
  {
    agentType: "foundation_research_finder",
    modulePath: "src/lib/agents/foundation-finder.ts",
    exportName: "FoundationFinderAgent",
    callsClaude: true,
    buildInput: () => ({}),
  },
  {
    agentType: "final_assembly",
    modulePath: "src/lib/agents/final-assembly.ts",
    exportName: "FinalAssemblyAgent",
    callsClaude: true,
    buildInput: (f) => ({ applicationId: f.applicationId }),
  },
  {
    agentType: "funder_intel",
    modulePath: "src/lib/agents/funder-intel.ts",
    exportName: "FunderIntelAgent",
    callsClaude: true,
    buildInput: (f) => ({ funderId: f.funderId }),
  },
  {
    agentType: "competitor_intelligence",
    modulePath: "src/lib/agents/competitor-intel.ts",
    exportName: "CompetitorIntelAgent",
    callsClaude: true,
    buildInput: (f) => ({ funderId: f.funderId }),
  },
  {
    agentType: "follow_up_generator",
    modulePath: "src/lib/agents/follow-up-generator.ts",
    exportName: "FollowUpGeneratorAgent",
    callsClaude: true,
    buildInput: (f) => ({ applicationId: f.applicationId }),
  },
  {
    agentType: "funder_relationship",
    modulePath: "src/lib/agents/funder-relationship.ts",
    exportName: "FunderRelationshipAgent",
    buildInput: (f) => ({ funderId: f.funderId, event: "cold_outreach_sent" }),
  },
  {
    agentType: "grant_summary",
    modulePath: "src/lib/agents/grant-summary.ts",
    exportName: "GrantSummaryAgent",
    callsClaude: true,
    buildInput: (f) => ({
      opportunityId: f.opportunityId,
      rawText:
        "EXERCISE-HARNESS fixture grant: housing assistance for rural Texas families, deadline in 90 days, award range $5,000-$25,000.",
    }),
  },
  {
    agentType: "grants_gov_research",
    modulePath: "src/lib/agents/grants-gov.ts",
    exportName: "GrantsGovResearchAgent",
    notes: "Live public Grants.gov API call — free, no key required.",
    buildInput: () => ({ keywords: ["housing"] }),
  },
  {
    agentType: "giving_history_extractor",
    modulePath: "src/lib/agents/giving-history.ts",
    exportName: "GivingHistoryAgent",
    notes: "Live public ProPublica API call against a real EIN with known 990-PF data.",
    buildInput: (f) => ({ funderId: f.funderId, ein: "131624094" }),
  },
  {
    agentType: "hud_monitor",
    modulePath: "src/lib/agents/hud-monitor.ts",
    exportName: "HudMonitorAgent",
    callsClaude: true,
    notes: "Live external HUD page fetch.",
    buildInput: () => ({}),
  },
  {
    agentType: "government_research_housing_scrapers",
    modulePath: "src/lib/agents/housing-specific-scrapers.ts",
    exportName: "HousingSpecificScrapersAgent",
    callsClaude: true,
    notes: "Live external scrape of hardcoded state-agency URLs.",
    buildInput: () => ({}),
  },
  {
    agentType: "government_research_nofa_parser",
    modulePath: "src/lib/agents/nofa-parser.ts",
    exportName: "NofaParserAgent",
    callsClaude: true,
    notes: "opportunity_documents not seeded on the fixture opportunity — expected no-op (pdfsProcessed: 0).",
    buildInput: (f) => ({ opportunityId: f.opportunityId }),
  },
  {
    agentType: "review",
    modulePath: "src/lib/agents/review-agent.ts",
    exportName: "ReviewAgent",
    callsClaude: true,
    buildInput: (f) => ({ applicationId: f.applicationId }),
  },
  {
    agentType: "recursive_learning",
    modulePath: "src/lib/agents/recursive-learning.ts",
    exportName: "RecursiveLearningAgent",
    callsClaude: true,
    buildInput: (f) => ({ outcomeId: f.outcomeId }),
  },
  {
    agentType: "semantic_matching",
    modulePath: "src/lib/agents/semantic-matching.ts",
    exportName: "SemanticMatchingAgent",
    callsClaude: true,
    buildInput: () => ({}),
  },
  {
    agentType: "sam_gov_research",
    modulePath: "src/lib/agents/sam-gov.ts",
    exportName: "SamGovResearchAgent",
    notes: "No real SAM.gov API key available — expected to throw/fail authentication against the live API.",
    buildInput: () => ({ apiKey: "EXERCISE-HARNESS-no-real-key", keywords: ["housing"] }),
  },
  {
    agentType: "simpler_grants_research",
    modulePath: "src/lib/agents/simpler-grants.ts",
    exportName: "SimplerGrantsResearchAgent",
    notes: "Requires process.env.SIMPLER_GRANTS_API_KEY, unset in this project — expected to throw missing_api_key.",
    buildInput: () => ({ keywords: ["housing"] }),
  },
  {
    agentType: "propublica_mining",
    modulePath: "src/lib/agents/propublica.ts",
    exportName: "ProPublicaMiningAgent",
    notes: "Live public ProPublica API call. Does not write to the DB at all by design.",
    buildInput: () => ({ ein: "131624094" }),
  },
  {
    agentType: "state_portal_housing_scrapers",
    modulePath: "src/lib/agents/state-scrapers.ts",
    exportName: "StateScrapersAgent",
    callsClaude: true,
    notes: "Live external scrape of hardcoded state-agency URLs.",
    buildInput: () => ({}),
  },
  {
    agentType: "state_portal",
    modulePath: "src/lib/agents/state-portal.ts",
    exportName: "StatePortalResearchAgent",
    callsClaude: true,
    notes: "Live external fetch of the TX state portal registry entry.",
    buildInput: () => ({ state: "TX", keywords: ["housing"] }),
  },
  {
    agentType: "government_research_usaspending",
    modulePath: "src/lib/agents/usaspending.ts",
    exportName: "UsaspendingAgent",
    notes: "Live public USAspending API call.",
    buildInput: () => ({}),
  },
  {
    agentType: "success_probability",
    modulePath: "src/lib/agents/success-probability.ts",
    exportName: "SuccessProbabilityAgent",
    buildInput: (f) => ({ applicationId: f.applicationId }),
  },
  {
    agentType: "state_portal_tdhca",
    modulePath: "src/lib/agents/tdhca-scraper.ts",
    exportName: "TdhcaScraperAgent",
    callsClaude: true,
    notes: "Live external scrape of TDHCA URLs.",
    buildInput: () => ({}),
  },
  {
    agentType: "foundation_research",
    modulePath: "src/lib/agents/research/foundation-grants.ts",
    exportName: "FoundationGrantsResearchAgent",
    callsClaude: true,
    notes: "Seeded search_profiles row includes private_foundation/corporate_foundation categories.",
    buildInput: () => ({}),
  },
  {
    agentType: "local_sponsorship",
    modulePath: "src/lib/agents/research/local-sponsorship.ts",
    exportName: "LocalSponsorshipResearchAgent",
    callsClaude: true,
    notes: "Seeded search_profiles row includes local_community_grant/corporate_sponsorship categories.",
    buildInput: () => ({}),
  },
  {
    agentType: "government_research",
    modulePath: "src/lib/agents/research/government-grants.ts",
    exportName: "GovernmentGrantsResearchAgent",
    callsClaude: true,
    notes: "Seeded search_profiles row includes government_grant/housing_grant/education_grant categories.",
    buildInput: () => ({}),
  },
  {
    agentType: "corporate_research",
    modulePath: "src/lib/agents/research/corporate-giving.ts",
    exportName: "CorporateGivingResearchAgent",
    callsClaude: true,
    notes: "Shares the agent_type literal 'corporate_research' with corporate-scraper.ts by design. Seeded search_profiles row includes corporate_donation/corporate_sponsorship/corporate_foundation categories.",
    buildInput: () => ({}),
  },
];

// ===========================================================================
// SHAPE 2 — AutonomousAgent subclasses (src/lib/agents/**, src/lib/intelligence/**)
//   org mode:      new Ctor(orgId, supabase).run("manual")
//   platform mode: new Ctor(supabase).run("manual")   (ignores/lacks orgId)
// ===========================================================================
interface AutonomousAgentSpec {
  agentType: string;
  modulePath: string;
  exportName: string;
  family?: AgentFamily;
  mode: "org" | "platform";
  requiresBrowser?: boolean;
  callsClaude?: boolean;
  notes?: string;
  invokeOverride?: (ctx: InvokeContext, Ctor: any) => Promise<unknown>;
}

function autonomousAgentDescriptor(spec: AutonomousAgentSpec): AgentDescriptor {
  return {
    agentType: spec.agentType,
    family: spec.family ?? "core",
    modulePath: spec.modulePath,
    exportName: spec.exportName,
    requiresBrowser: spec.requiresBrowser ?? false,
    callsClaude: spec.callsClaude ?? false,
    writesTable: "agent_runs",
    notes: spec.notes,
    invoke: async (ctx) => {
      const mod = await loadModule(spec.modulePath);
      const Ctor = mod[spec.exportName];
      if (spec.invokeOverride) return spec.invokeOverride(ctx, Ctor);
      const agent = spec.mode === "platform" ? new Ctor(ctx.client) : new Ctor(ctx.fixture.orgId, ctx.client);
      return agent.run("manual");
    },
  };
}

const AUTONOMOUS_AGENT_SPECS: AutonomousAgentSpec[] = [
  {
    agentType: "ag-42-change-monitor",
    modulePath: "src/lib/agents/change-monitor-agent.ts",
    exportName: "ChangeMonitorAgent",
    mode: "platform",
    callsClaude: true,
    notes: "Platform-level: ignores any orgId, self-provisions a SYSTEM_ORG_ID row via ensureSystemOrg().",
  },
  {
    agentType: "ag-27-board-packet",
    modulePath: "src/lib/agents/board-packet-agent.ts",
    exportName: "BoardPacketAgent",
    mode: "org",
    callsClaude: true,
    notes: "No board_meetings rows seeded — expected 0-meeting no-op on 'manual' trigger.",
  },
  {
    agentType: "ag-30-donor-intent",
    modulePath: "src/lib/agents/donor-intent-monitor-agent.ts",
    exportName: "DonorIntentMonitorAgent",
    mode: "org",
  },
  {
    agentType: "ag-10-document-expiry",
    modulePath: "src/lib/agents/document-expiry-agent.ts",
    exportName: "DocumentExpiryAgent",
    mode: "org",
    notes: "No documents rows seeded — expected 0-item no-op.",
  },
  {
    agentType: "ag-25-deadline-prediction",
    modulePath: "src/lib/agents/deadline-prediction-agent.ts",
    exportName: "DeadlinePredictionAgent",
    mode: "org",
    callsClaude: true,
    notes: "Distinct class from deadline-prediction.ts's BaseAgent version of the same name.",
  },
  {
    agentType: "ag-35-community-need",
    modulePath: "src/lib/agents/community-need-predictor-agent.ts",
    exportName: "CommunityNeedPredictorAgent",
    mode: "org",
  },
  {
    agentType: "ag-05-draft",
    modulePath: "src/lib/agents/draft-generation-agent.ts",
    exportName: "DraftGenerationAgent",
    mode: "org",
    callsClaude: true,
    notes: "No processing agent_queue row seeded with input_payload.opportunityId — expected no-op via loadTriggerPayload() returning null.",
  },
  {
    agentType: "ag-28-followup",
    modulePath: "src/lib/agents/followup-generator-agent.ts",
    exportName: "FollowupGeneratorAgent",
    mode: "org",
    callsClaude: true,
    notes: "No processing agent_queue row seeded — expected no-op via loadTriggerPayload() returning null.",
  },
  {
    agentType: "ag-10-grant-dna",
    modulePath: "src/lib/agents/grant-dna-agent.ts",
    exportName: "GrantDnaAgent",
    mode: "org",
    callsClaude: true,
    notes: "AG-NN slot collides with ag-10-document-expiry (numbering only; agent_type strings differ, see AGENTS_v2.md's dedup table). 'manual' trigger runs a full per-org scan, no queue row needed.",
  },
  {
    agentType: "ag-digest",
    modulePath: "src/lib/agents/autonomous-digest-agent.ts",
    exportName: "AutonomousDigestAgent",
    mode: "org",
    callsClaude: true,
  },
  {
    agentType: "ag-36-learning-network",
    modulePath: "src/lib/agents/learning-network-aggregator-agent.ts",
    exportName: "LearningNetworkAggregatorAgent",
    mode: "platform",
    callsClaude: true,
    notes: "Platform-level: ignores any orgId, self-provisions a SYSTEM_ORG_ID row; reads cross-org platform_learning_patterns.",
  },
  {
    agentType: "ag-41-impact-simulation",
    modulePath: "src/lib/agents/impact-simulation-agent.ts",
    exportName: "ImpactSimulationAgent",
    mode: "org",
    callsClaude: true,
    notes: "run() signature is (triggerSource, scenarioType, scenarioParams, createdBy) — triggerSource is discarded internally and always logged as 'manual'.",
    invokeOverride: async ({ client, fixture }, Ctor) => {
      const agent = new Ctor(fixture.orgId, client);
      return agent.run("manual", "budget_cut", {}, null);
    },
  },
  {
    agentType: "ag-09-outcome-analyzer",
    modulePath: "src/lib/agents/outcome-analyzer-agent.ts",
    exportName: "OutcomeAnalyzerAgent",
    mode: "org",
  },
  {
    agentType: "ag-11-knowledge-gap",
    modulePath: "src/lib/agents/knowledge-gap-agent.ts",
    exportName: "KnowledgeGapAgent",
    mode: "org",
  },
  {
    agentType: "ag-17-discovery",
    modulePath: "src/lib/agents/opportunity-discovery-agent.ts",
    exportName: "OpportunityDiscoveryAgent",
    mode: "org",
    notes: "Seeded search_profiles row is active, so this can attempt real discovery.",
  },
  {
    agentType: "ag-29-knowledge-indexer",
    modulePath: "src/lib/agents/knowledge-indexer-agent.ts",
    exportName: "KnowledgeIndexerAgent",
    mode: "platform",
    notes: "Platform-level: ignores any orgId, self-provisions a SYSTEM_ORG_ID row; AG-NN slot collides with ag-29-fundability (numbering only; agent_type strings differ).",
  },
  {
    agentType: "ag-29-fundability",
    modulePath: "src/lib/agents/fundability-scorer-agent.ts",
    exportName: "FundabilityScorerAgent",
    mode: "org",
    callsClaude: true,
  },
  {
    agentType: "ag-15-probability",
    modulePath: "src/lib/agents/probability-scoring-agent.ts",
    exportName: "ProbabilityScoringAgent",
    mode: "org",
    callsClaude: true,
  },
  {
    agentType: "ag-32-relationship-graph",
    modulePath: "src/lib/agents/relationship-graph-builder-agent.ts",
    exportName: "RelationshipGraphBuilderAgent",
    mode: "org",
    notes: "No board_members rows seeded — expected 0-item no-op.",
  },
  {
    agentType: "ag-19-relationship",
    modulePath: "src/lib/agents/relationship-builder-agent.ts",
    exportName: "RelationshipBuilderAgent",
    mode: "org",
    callsClaude: true,
  },
  {
    agentType: "ag-39-roi-optimizer",
    modulePath: "src/lib/agents/roi-optimizer-agent.ts",
    exportName: "RoiOptimizerAgent",
    mode: "org",
    callsClaude: true,
  },
  {
    agentType: "ag-08-renewal-tracker",
    modulePath: "src/lib/agents/renewal-tracker-agent.ts",
    exportName: "RenewalTrackerAgent",
    mode: "org",
  },
  {
    agentType: "ag-12-search-optimizer",
    modulePath: "src/lib/agents/search-profile-optimizer-agent.ts",
    exportName: "SearchProfileOptimizerAgent",
    mode: "org",
    callsClaude: true,
  },
  {
    agentType: "ag-40-strategic-advisor",
    modulePath: "src/lib/agents/strategic-advisor-agent.ts",
    exportName: "StrategicAdvisorAgent",
    mode: "org",
    callsClaude: true,
  },
  {
    agentType: "ag-37-simulation",
    modulePath: "src/lib/agents/simulation-agent.ts",
    exportName: "SimulationAgent",
    mode: "org",
    callsClaude: true,
    notes: "No 'processing' agent_queue row seeded for this agent — loadScenarioInput() has no fallback and this is expected to throw, not no-op.",
  },
  {
    agentType: "ag-38-self-improvement",
    modulePath: "src/lib/agents/self-improvement-agent.ts",
    exportName: "SelfImprovementAgent",
    mode: "platform",
    callsClaude: true,
    notes: "Not actually an AutonomousAgent subclass — plain class, constructor(supabase) only, own hand-rolled agent_runs bookkeeping with organization_id: null. 'platform' mode's new Ctor(client) shape still matches its real constructor.",
  },
  {
    agentType: "ag-18-reputation",
    modulePath: "src/lib/intelligence/reputation-agent.ts",
    exportName: "ReputationIntelligenceAgent",
    family: "intelligence",
    mode: "org",
    callsClaude: true,
    notes: "Live external call to api.duckduckgo.com per funder name — no local-fixture switch exists for this one.",
  },
];

// ===========================================================================
// SHAPE 3 — PIL agents (src/lib/pil/agents/**)
//   new AgentRunner().run({ agentCode, orgId, prospectId: null, runId, goal, plan, tools, budget, depth })
//   AgentRunner dispatches internally via loadAgentImpl(agentCode) — the
//   registry's modulePath/exportName below are for reporting only.
// ===========================================================================
const PIL_TOOLS = ["web_crawl", "irs_990_lookup", "news_search", "web_search", "entity_lookup"];

interface PilAgentSpec {
  agentCode: string;
  modulePath: string;
  exportName: string;
}

function pilAgentDescriptor(spec: PilAgentSpec): AgentDescriptor {
  return {
    agentType: spec.agentCode,
    family: "pil",
    modulePath: spec.modulePath,
    exportName: spec.exportName,
    requiresBrowser: false,
    callsClaude: true,
    writesTable: "pil_agent_runs",
    invoke: async ({ fixture }) => {
      const { AgentRunner } = await loadModule("src/lib/pil/agent-runner.ts");
      const runner = new AgentRunner();
      return runner.run({
        agentCode: spec.agentCode,
        orgId: fixture.orgId,
        prospectId: null,
        runId: fixture.pilResearchRunId,
        goal: `EXERCISE-HARNESS exercise run for ${spec.agentCode}`,
        plan: {},
        tools: PIL_TOOLS,
        budget: 10000,
        depth: 0,
      });
    },
  };
}

const PIL_AGENT_SPECS: PilAgentSpec[] = [
  { agentCode: "BEN-SUP-01", modulePath: "src/lib/pil/agents/sup/BEN-SUP-01.ts", exportName: "ChiefProspectIntelligenceOrchestrator" },
  { agentCode: "BEN-SUP-02", modulePath: "src/lib/pil/agents/sup/BEN-SUP-02.ts", exportName: "ResearchStrategyArchitect" },
  { agentCode: "BEN-SUP-03", modulePath: "src/lib/pil/agents/sup/BEN-SUP-03.ts", exportName: "CrossAgentResearchPlanner" },
  { agentCode: "BEN-SUP-04", modulePath: "src/lib/pil/agents/sup/BEN-SUP-04.ts", exportName: "ResearchPortfolioAllocator" },
  { agentCode: "BEN-SUP-05", modulePath: "src/lib/pil/agents/sup/BEN-SUP-05.ts", exportName: "ProspectResearchCriticAgent" },
  { agentCode: "BEN-SUP-06", modulePath: "src/lib/pil/agents/sup/BEN-SUP-06.ts", exportName: "ResearchRecoveryInvestigatorAgent" },
  { agentCode: "BEN-SUP-07", modulePath: "src/lib/pil/agents/sup/BEN-SUP-07.ts", exportName: "AutonomyGovernorAgent" },
  { agentCode: "BEN-SUP-08", modulePath: "src/lib/pil/agents/sup/BEN-SUP-08.ts", exportName: "ExecutiveIntelligenceNarrativeAgent" },
  { agentCode: "BEN-DIS-01", modulePath: "src/lib/pil/agents/dis/BEN-DIS-01.ts", exportName: "IndividualProspectDiscoveryAgent" },
  { agentCode: "BEN-DIS-02", modulePath: "src/lib/pil/agents/dis/BEN-DIS-02.ts", exportName: "MajorDonorDiscoveryAgent" },
  { agentCode: "BEN-DIS-03", modulePath: "src/lib/pil/agents/dis/BEN-DIS-03.ts", exportName: "FoundationDiscoveryAgent" },
  { agentCode: "BEN-DIS-04", modulePath: "src/lib/pil/agents/dis/BEN-DIS-04.ts", exportName: "CorporateGivingDiscoveryAgent" },
  { agentCode: "BEN-DIS-05", modulePath: "src/lib/pil/agents/dis/BEN-DIS-05.ts", exportName: "ExecutiveProspectDiscoveryAgent" },
  { agentCode: "BEN-DIS-06", modulePath: "src/lib/pil/agents/dis/BEN-DIS-06.ts", exportName: "GeographicFundingDiscoveryAgent" },
  { agentCode: "BEN-DIS-07", modulePath: "src/lib/pil/agents/dis/BEN-DIS-07.ts", exportName: "CauseAlignedProspectDiscoveryAgent" },
  { agentCode: "BEN-DIS-08", modulePath: "src/lib/pil/agents/dis/BEN-DIS-08.ts", exportName: "HiddenProspectAndCrmRediscoveryAgent" },
  { agentCode: "BEN-INT-01", modulePath: "src/lib/pil/agents/int/BEN-INT-01.ts", exportName: "IndividualIntelligenceAgent" },
  { agentCode: "BEN-INT-02", modulePath: "src/lib/pil/agents/int/BEN-INT-02.ts", exportName: "EmploymentCareerIntelligenceAgent" },
  { agentCode: "BEN-INT-03", modulePath: "src/lib/pil/agents/int/BEN-INT-03.ts", exportName: "BusinessOwnershipIntelligenceAgent" },
  { agentCode: "BEN-INT-04", modulePath: "src/lib/pil/agents/int/BEN-INT-04.ts", exportName: "EducationAlumniIntelligenceAgent" },
  { agentCode: "BEN-INT-05", modulePath: "src/lib/pil/agents/int/BEN-INT-05.ts", exportName: "NonprofitBoardIntelligenceAgent" },
  { agentCode: "BEN-INT-06", modulePath: "src/lib/pil/agents/int/BEN-INT-06.ts", exportName: "FoundationIntelligenceAgent" },
  { agentCode: "BEN-INT-07", modulePath: "src/lib/pil/agents/int/BEN-INT-07.ts", exportName: "GivingHistoryIntelligenceAgent" },
  { agentCode: "BEN-INT-08", modulePath: "src/lib/pil/agents/int/BEN-INT-08.ts", exportName: "WealthCapacityIntelligenceAgent" },
  { agentCode: "BEN-INT-09", modulePath: "src/lib/pil/agents/int/BEN-INT-09.ts", exportName: "WealthOriginLiquidityEventAgent" },
  { agentCode: "BEN-INT-10", modulePath: "src/lib/pil/agents/int/BEN-INT-10.ts", exportName: "ContactIntelligenceAgent" },
  { agentCode: "BEN-REL-01", modulePath: "src/lib/pil/agents/rel/BEN-REL-01.ts", exportName: "RelationshipDiscoveryAgent" },
  { agentCode: "BEN-REL-02", modulePath: "src/lib/pil/agents/rel/BEN-REL-02.ts", exportName: "BoardRelationshipMappingAgent" },
  { agentCode: "BEN-REL-03", modulePath: "src/lib/pil/agents/rel/BEN-REL-03.ts", exportName: "CorporateRelationshipMappingAgent" },
  { agentCode: "BEN-REL-04", modulePath: "src/lib/pil/agents/rel/BEN-REL-04.ts", exportName: "OrganizationalOverlapAgent" },
  { agentCode: "BEN-REL-05", modulePath: "src/lib/pil/agents/rel/BEN-REL-05.ts", exportName: "WarmIntroductionPathfindingAgent" },
  { agentCode: "BEN-REL-06", modulePath: "src/lib/pil/agents/rel/BEN-REL-06.ts", exportName: "RelationshipStrengthAgent" },
  { agentCode: "BEN-REL-07", modulePath: "src/lib/pil/agents/rel/BEN-REL-07.ts", exportName: "FoundationRelationshipMappingAgent" },
  { agentCode: "BEN-REL-08", modulePath: "src/lib/pil/agents/rel/BEN-REL-08.ts", exportName: "ProfessionalConnectionMappingAgent" },
  { agentCode: "BEN-QLF-01", modulePath: "src/lib/pil/agents/qlf/BEN-QLF-01.ts", exportName: "MissionAffinityAgent" },
  { agentCode: "BEN-QLF-02", modulePath: "src/lib/pil/agents/qlf/BEN-QLF-02.ts", exportName: "FundingEligibilityAgent" },
  { agentCode: "BEN-QLF-03", modulePath: "src/lib/pil/agents/qlf/BEN-QLF-03.ts", exportName: "PhilanthropicCapacityPropensityAgent" },
  { agentCode: "BEN-QLF-04", modulePath: "src/lib/pil/agents/qlf/BEN-QLF-04.ts", exportName: "OpportunityQualificationAgent" },
  { agentCode: "BEN-QLF-05", modulePath: "src/lib/pil/agents/qlf/BEN-QLF-05.ts", exportName: "TimingReadinessAgent" },
  { agentCode: "BEN-KNW-01", modulePath: "src/lib/pil/agents/knw/BEN-KNW-01.ts", exportName: "ProspectDigitalTwinAgent" },
  { agentCode: "BEN-KNW-02", modulePath: "src/lib/pil/agents/knw/BEN-KNW-02.ts", exportName: "EntityResolutionAgent" },
  { agentCode: "BEN-KNW-03", modulePath: "src/lib/pil/agents/knw/BEN-KNW-03.ts", exportName: "EvidenceProvenanceAgent" },
  { agentCode: "BEN-KNW-04", modulePath: "src/lib/pil/agents/knw/BEN-KNW-04.ts", exportName: "ContradictionFreshnessInvestigatorAgent" },
  { agentCode: "BEN-STR-01", modulePath: "src/lib/pil/agents/str/BEN-STR-01.ts", exportName: "ProspectEngagementStrategyAgent" },
  { agentCode: "BEN-STR-02", modulePath: "src/lib/pil/agents/str/BEN-STR-02.ts", exportName: "BestFirstAskAgent" },
  { agentCode: "BEN-STR-03", modulePath: "src/lib/pil/agents/str/BEN-STR-03.ts", exportName: "CultivationStrategyAgent" },
  { agentCode: "BEN-STR-04", modulePath: "src/lib/pil/agents/str/BEN-STR-04.ts", exportName: "NextBestActionAgent" },
  { agentCode: "BEN-OPS-01", modulePath: "src/lib/pil/agents/ops/BEN-OPS-01.ts", exportName: "AgentFleetPerformanceAndLearningAgent" },
  { agentCode: "BEN-APP-01", modulePath: "src/lib/pil/agents/app/BEN-APP-01.ts", exportName: "ApplicationProfileOrchestratorAgent" },
  { agentCode: "BEN-APP-02", modulePath: "src/lib/pil/agents/app/BEN-APP-02.ts", exportName: "RecommendationPriorityScorerAgent" },
  { agentCode: "BEN-APP-03", modulePath: "src/lib/pil/agents/app/BEN-APP-03.ts", exportName: "SubmissionOrchestratorAgent" },
];

// ===========================================================================
// SHAPE 4 — autoapply modules (src/lib/autoapply/**). Each exports its own
// AGENT_TYPE constant and is normally run through withAgentRun() by
// worker/queue-processor.ts; this harness calls the underlying class/
// function directly and wraps it in the same withAgentRun() helper so a real
// agent_runs row is still produced. Every page-based one is pointed at the
// local fixture file, never a live funder portal (STEP 4 safety guard).
// ===========================================================================
const AUTOAPPLY_AGENTS: AgentDescriptor[] = [
  {
    agentType: "autoapply_captcha_solver",
    family: "autoapply",
    modulePath: "src/lib/autoapply/captcha-solver.ts",
    exportName: "CaptchaSolver",
    requiresBrowser: true,
    callsClaude: false,
    writesTable: "agent_runs",
    notes: "TWOCAPTCHA_API_KEY intentionally left unset so solveCaptcha() never makes a live 2Captcha call.",
    invoke: async ({ client, fixture }) => {
      const { withAgentRun } = await loadModule("src/lib/autoapply/run-logger.ts");
      const { CaptchaSolver } = await loadModule("src/lib/autoapply/captcha-solver.ts");
      return withAgentRun(
        { supabase: client, agentType: "autoapply_captcha_solver", organizationId: fixture.orgId },
        () => withFixturePage(fixture, (page) => new CaptchaSolver().detectCaptcha(page)),
      );
    },
  },
  {
    agentType: "autoapply_confirmation_parser",
    family: "autoapply",
    modulePath: "src/lib/autoapply/confirmation-parser.ts",
    exportName: "parseConfirmationPage",
    requiresBrowser: true,
    callsClaude: true,
    writesTable: "agent_runs",
    invoke: async ({ client, fixture }) => {
      const { withAgentRun } = await loadModule("src/lib/autoapply/run-logger.ts");
      const { parseConfirmationPage } = await loadModule("src/lib/autoapply/confirmation-parser.ts");
      return withAgentRun(
        { supabase: client, agentType: "autoapply_confirmation_parser", organizationId: fixture.orgId },
        () => withFixturePage(fixture, (page) => parseConfirmationPage(page)),
      );
    },
  },
  {
    agentType: "autoapply_form_analyzer",
    family: "autoapply",
    modulePath: "src/lib/autoapply/form-analyzer-agent.ts",
    exportName: "FormAnalyzerAgent",
    requiresBrowser: true,
    callsClaude: true,
    writesTable: "agent_runs",
    invoke: async ({ client, fixture }) => {
      const { withAgentRun } = await loadModule("src/lib/autoapply/run-logger.ts");
      const { FormAnalyzerAgent } = await loadModule("src/lib/autoapply/form-analyzer-agent.ts");
      return withAgentRun(
        { supabase: client, agentType: "autoapply_form_analyzer", organizationId: fixture.orgId },
        () =>
          withFixturePage(fixture, (page) =>
            new FormAnalyzerAgent(client).analyzeAndStore({
              page,
              portalUrl: fixture.fixtureUrl,
              funderId: fixture.funderId,
              organizationId: fixture.orgId,
            }),
          ),
      );
    },
  },
  {
    agentType: "autoapply_form_filler",
    family: "autoapply",
    modulePath: "src/lib/autoapply/form-filler-agent.ts",
    exportName: "FormFillerAgent",
    requiresBrowser: true,
    callsClaude: true,
    writesTable: "agent_runs",
    notes: "Gated on automation_sessions.status === 'approved' for this org — the seed fixture pre-creates an approved session so this can reach submitForm() against the local fixture.",
    invoke: async ({ client, fixture }) => {
      const { withAgentRun } = await loadModule("src/lib/autoapply/run-logger.ts");
      const { FormFillerAgent } = await loadModule("src/lib/autoapply/form-filler-agent.ts");
      const { StealthBrowser } = await loadModule("src/lib/autoapply/stealth-browser.ts");
      return withAgentRun(
        { supabase: client, agentType: "autoapply_form_filler", organizationId: fixture.orgId },
        () =>
          withFixturePage(fixture, (page) =>
            new FormFillerAgent(client, new StealthBrowser({ headless: true })).fillAndSubmit({
              page,
              template: {
                fields: [
                  { selector: "#org_name", field: "org_name", value_source: "org.name" },
                  { selector: "#contact_name", field: "contact_name", value_source: "fixed" },
                  { selector: "#contact_email", field: "contact_email", value_source: "org.email" },
                  { selector: "#project_description", field: "project_description", value_source: "generated" },
                ],
                submit_selector: "#submit-application",
              },
              organizationId: fixture.orgId,
              funderId: fixture.funderId,
              sessionId: fixture.automationSessionId,
            }),
          ),
      );
    },
  },
  {
    agentType: "autoapply_pitch_personalizer",
    family: "autoapply",
    modulePath: "src/lib/autoapply/pitch-personalizer.ts",
    exportName: "personalizePitch",
    requiresBrowser: false,
    callsClaude: true,
    writesTable: "agent_runs",
    invoke: async ({ client, fixture }) => {
      const { withAgentRun } = await loadModule("src/lib/autoapply/run-logger.ts");
      const { personalizePitch } = await loadModule("src/lib/autoapply/pitch-personalizer.ts");
      return withAgentRun(
        { supabase: client, agentType: "autoapply_pitch_personalizer", organizationId: fixture.orgId },
        () =>
          personalizePitch({
            orgMission: "Provide emergency and transitional housing support for rural Texas families.",
            orgPrograms: ["Transitional Housing"],
            orgName: "EXERCISE-HARNESS-Test Foundation",
            funderName: "EXERCISE-HARNESS-Fixture Foundation",
            funderPriorities: ["housing", "rural development"],
            organizationId: fixture.orgId,
            funderId: fixture.funderId,
            supabase: client,
          }),
      );
    },
  },
  {
    agentType: "autoapply_receipt",
    family: "autoapply",
    modulePath: "src/lib/autoapply/receipt-generator.ts",
    exportName: "generateReceipt",
    requiresBrowser: false,
    callsClaude: false,
    writesTable: "agent_runs",
    notes: "No autoapply_submissions row seeded (out of STEP 2 scope) — a plausible fabricated submission object is passed directly since generateReceipt takes the row as a value, not an id; the submission_receipts insert may fail its FK, which is legitimate empirical data.",
    invoke: async ({ client, fixture }) => {
      const { withAgentRun } = await loadModule("src/lib/autoapply/run-logger.ts");
      const { generateReceipt } = await loadModule("src/lib/autoapply/receipt-generator.ts");
      return withAgentRun(
        { supabase: client, agentType: "autoapply_receipt", organizationId: fixture.orgId },
        () =>
          generateReceipt({
            supabase: client,
            submission: {
              id: fixture.applicationId,
              organization_id: fixture.orgId,
              funder_id: fixture.funderId,
              application_id: fixture.applicationId,
              status: "submitted",
              confirmation_number: "EXERCISE-HARNESS-TEST",
              submitted_at: new Date().toISOString(),
            } as any,
            funderName: "EXERCISE-HARNESS-Fixture Foundation",
            orgName: "EXERCISE-HARNESS-Test Foundation",
          }),
      );
    },
  },
  {
    agentType: "autoapply_registration",
    family: "autoapply",
    modulePath: "src/lib/autoapply/registration-agent.ts",
    exportName: "RegistrationAgent",
    requiresBrowser: true,
    callsClaude: true,
    writesTable: "agent_runs",
    notes: "Fixture HTML has no registration/login form — expected null/no-op from detectRegistrationForm().",
    invoke: async ({ client, fixture }) => {
      const { withAgentRun } = await loadModule("src/lib/autoapply/run-logger.ts");
      const { RegistrationAgent } = await loadModule("src/lib/autoapply/registration-agent.ts");
      return withAgentRun(
        { supabase: client, agentType: "autoapply_registration", organizationId: fixture.orgId },
        () => withFixturePage(fixture, (page) => new RegistrationAgent().detectRegistrationForm(page)),
      );
    },
  },
  {
    agentType: "autoapply_risk_engine",
    family: "autoapply",
    modulePath: "src/lib/autoapply/risk-engine.ts",
    exportName: "assessSubmissionRisk",
    requiresBrowser: false,
    callsClaude: false,
    writesTable: "agent_runs",
    invoke: async ({ client, fixture }) => {
      const { withAgentRun } = await loadModule("src/lib/autoapply/run-logger.ts");
      const { assessSubmissionRisk } = await loadModule("src/lib/autoapply/risk-engine.ts");
      return withAgentRun(
        { supabase: client, agentType: "autoapply_risk_engine", organizationId: fixture.orgId },
        () =>
          assessSubmissionRisk({
            funder: { id: fixture.funderId, name: "EXERCISE-HARNESS-Fixture Foundation", automation_level: "supervised", giving_portal_url: fixture.fixtureUrl },
            requestProfile: { request_type: "grant", min_value: 5000, max_value: 25000 },
            formTemplate: { field_count: 8, has_file_uploads: true },
            orgReadiness: { ready: true, missing_required: [] },
            crossClientBlocked: false,
            supabase: client,
          }),
      );
    },
  },
  {
    agentType: "autoapply_submission_validator",
    family: "autoapply",
    modulePath: "src/lib/autoapply/submission-validator.ts",
    exportName: "SubmissionValidator",
    requiresBrowser: false,
    callsClaude: false,
    writesTable: "agent_runs",
    notes: "Exercises checkOrgReadiness(), the most substantive DB-scoped method; validateFormData/checkConcurrentAutomation/checkConcurrentSubmissionQueue/detectExistingSubmission exist on the same class but aren't separately invoked here.",
    invoke: async ({ client, fixture }) => {
      const { withAgentRun } = await loadModule("src/lib/autoapply/run-logger.ts");
      const { SubmissionValidator } = await loadModule("src/lib/autoapply/submission-validator.ts");
      return withAgentRun(
        { supabase: client, agentType: "autoapply_submission_validator", organizationId: fixture.orgId },
        () => new SubmissionValidator().checkOrgReadiness(fixture.orgId, client),
      );
    },
  },
];

// ===========================================================================
// SHAPE 5 — plain functions (src/lib/agents/**) with no agent_type / no
// agent_runs write, per their own file-header comments. Recorded with
// writesTable: "none" so the harness never scores them "success" just
// because they returned without throwing (STEP 3's core rule).
// ===========================================================================
const PLAIN_FUNCTION_AGENTS: AgentDescriptor[] = [
  {
    agentType: "morning_digest",
    family: "core",
    modulePath: "src/lib/agents/morning-digest.ts",
    exportName: "sendMorningDigest",
    requiresBrowser: false,
    callsClaude: false,
    writesTable: "none",
    notes: "No agent_type enum value, no Claude call, no agent_runs write per the file's own header comment. Only conditionally writes alerts if there's something to report.",
    invoke: async ({ client, fixture }) => {
      const { sendMorningDigest } = await loadModule("src/lib/agents/morning-digest.ts");
      return sendMorningDigest(fixture.orgId, client);
    },
  },
  {
    agentType: "disaster_response_deploy",
    family: "core",
    modulePath: "src/lib/agents/disaster-response-agent.ts",
    exportName: "deployDisasterResponse",
    requiresBrowser: false,
    callsClaude: false,
    writesTable: "none",
    notes: "No agent_type, never logs to agent_runs. No disaster_declarations row seeded — expected to throw 'Disaster declaration not found.'",
    invoke: async ({ client, fixture }) => {
      const { deployDisasterResponse } = await loadModule("src/lib/agents/disaster-response-agent.ts");
      return deployDisasterResponse("00000000-0000-0000-0000-000000000000", fixture.orgId, client);
    },
  },
  {
    agentType: "consensus_validation",
    family: "core",
    modulePath: "src/lib/agents/consensus-validator.ts",
    exportName: "validateOpportunity",
    requiresBrowser: false,
    callsClaude: true,
    writesTable: "none",
    notes: "Uses Claude (+ Gemini if configured), no agent_type/DB write of its own.",
    invoke: async ({ client, fixture }) => {
      const { validateOpportunity } = await loadModule("src/lib/agents/consensus-validator.ts");
      return validateOpportunity({
        client,
        organizationId: fixture.orgId,
        opportunityId: fixture.opportunityId,
        opportunity: {
          name: "EXERCISE-HARNESS-Fixture Housing Grant",
          category: "housing_grant",
          description: "Fixture opportunity for the agent exercise harness.",
          funderName: "EXERCISE-HARNESS-Fixture Foundation",
          url: fixture.fixtureUrl,
          eligibilityRequirements: "501(c)(3) organizations serving rural Texas housing needs.",
          deadline: null,
          amountMin: 5000,
          amountMax: 25000,
          amountAvailable: 25000,
          geographicRestrictions: "TX",
        },
      });
    },
  },
];

// ===========================================================================
// research family — src/lib/research/** contains zero invocable agents.
// Every file there (resource-registry.ts, families.ts, org-research-config.ts,
// profile-config.ts, keyword-expander.ts, data-quality.ts) is config/data or
// a utility consumed by the core-family research lane agents already listed
// above (research/foundation-grants.ts etc., which physically live under
// src/lib/agents/research/** and are counted in the "core" family here).
// Left intentionally empty rather than force-fitting a non-agent into this
// list.
// ===========================================================================
const RESEARCH_FAMILY_AGENTS: AgentDescriptor[] = [];

export const AGENT_REGISTRY: AgentDescriptor[] = [
  ...BASE_AGENT_SPECS.map(baseAgentDescriptor),
  ...AUTONOMOUS_AGENT_SPECS.map(autonomousAgentDescriptor),
  ...PIL_AGENT_SPECS.map(pilAgentDescriptor),
  ...AUTOAPPLY_AGENTS,
  ...PLAIN_FUNCTION_AGENTS,
  ...RESEARCH_FAMILY_AGENTS,
];

export function countByFamily(): Record<AgentFamily, number> {
  const counts: Record<AgentFamily, number> = { core: 0, pil: 0, autoapply: 0, intelligence: 0, research: 0, worker: 0 };
  for (const entry of AGENT_REGISTRY) counts[entry.family]++;
  return counts;
}
