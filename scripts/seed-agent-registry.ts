// ============================================================================
// BENAVORA — real agent_registry seed (Pillar 17, FEATURE_REGISTRY_v2.md row
// #157 "Registry Seed Data")
//
// Replaces src/lib/agents/agent-registry-seed.ts (a 17-entry array that is
// NEVER imported by GET /api/agents/registry or anything else — confirmed by
// grep before writing this script; it is dead code, not a working fallback,
// despite its own header comment claiming otherwise). That array is also
// wrong on at least one entry: its `ag-28` row is labeled "Impact Simulation
// Agent," which was renumbered off AG-28 to AG-41 on 2026-08-02
// (AGENTS_v2.md §1.4) — AG-28 is now permanently "Follow-Up Generator Agent"
// (`agentId: "ag-28-followup"`). This script does not import or reuse that
// array at all.
//
// Roster source: AGENTS_v2.md's AG-01 through AG-42 canonical sections
// (Section 3 master table, Section 4 real-vs-canonical cross-reference,
// Section 5 per-agent specs, and the Phase 2-5 addendum for AG-29 through
// AG-40), cross-checked against live code this session — `grep -rn 'super(
// orgId, "'` / `super(SYSTEM_ORG_ID, "'` across src/lib/agents/*.ts and
// src/lib/intelligence/*.ts for every real `agentId` literal, plus a read of
// worker/scheduler.ts's `jobs` array for real cron cadences. Several agents
// documented as PLANNED/NOT-BUILT in the AGENTS_v2.md snapshot carried in
// this session's context are, as of this repo's actual current state, real
// and wired: AG-10 (grant-dna-agent.ts), AG-26 (funding-forecast-agent.ts),
// AG-27 (board-packet-agent.ts), AG-29-canonical (knowledge-indexer-agent.ts,
// continuous poll via worker/knowledge-indexer-processor.ts), AG-36
// (learning-network-aggregator-agent.ts, now scheduled Sunday 6AM CST — no
// longer orphaned), AG-41 (impact-simulation-agent.ts), AG-42
// (change-monitor-agent.ts, scheduled daily 5AM CST). Code wins over the
// stale doc snapshot, per this project's own established practice.
//
// `agent_id` values deliberately mix real on-disk `agentId`/`agentType`
// literals (preferred wherever a real AutonomousAgent/BaseAgent subclass
// logs one to `agent_runs`, so a future Agent Log Viewer — FEATURE_REGISTRY
// row #160 / q27-003 — can join `agent_registry.agent_id` against real
// `agent_runs.agent_type` rows) and synthetic `ag-XX-slug` values for agents
// that are plain functions or multi-source API routes with no single logged
// agent_type. Synthetic-slug rows will correctly show zero run history in
// any future Log Viewer — that is an honest empty state, not a bug (the
// underlying capability may still run live, it just isn't individually
// audit-logged today).
//
// Known numbering collisions, each handled explicitly rather than silently
// picked one way (see AGENTS_v2.md §1.4 for the general pattern):
//   - AG-23 (Relationship Mapper, RA-01) IS AG-32 (Relationship Graph
//     Builder) — AGENTS_v2.md states this outright, and the real code
//     (relationship-graph-builder-agent.ts, agentId "ag-32-relationship-
//     graph") is now genuinely scheduled (daily incremental, 5:30 AM CST).
//     Seeded once, under agent_id "ag-32-relationship-graph", name credits
//     both numbers.
//   - AG-25 is a permanent, deliberate dual-use number: the canonical
//     Disaster Response Agent (plain functions, no agent_type, manual API
//     route only) and the unrelated on-disk `DeadlinePredictionAgent`
//     (agentId "ag-25-deadline-prediction", nightly-scheduled, enum-fixed
//     and confirmed live 2026-08-02) are both real. Seeded as two distinct
//     rows.
//   - AG-29 and AG-30 each name two distinct real agents under the same
//     canonical number (AG-29: Knowledge Engine Indexer vs. Fundability
//     Scorer; AG-30: Donor Intent Monitor is the sole permanent occupant
//     per AGENTS_v2.md §1.4, no live collision remains). Both AG-29 agents
//     seeded as distinct rows with their own real agentId literals.
//
// Not seeded — zero real code found anywhere for these three canonical
// slots (confirmed by grep of src/lib/agents/ and src/lib/intelligence/):
// AG-31 (National Forecast Agent), AG-33 (Partnership Discovery Agent),
// AG-34 (Personalization Engine). All three are still genuinely PLANNED per
// AGENTS_v2.md's Phase 2-5 addendum, with no file, class, or route under any
// name. Full reasoning restated in this script's session write-up per the
// task's explicit request to name anything not confidently seedable.
//
// Idempotent: upserts on `agent_id` (the real PK per migration 094), so
// re-running this script is always safe and never duplicates rows.
//
//   pnpm seed:agent-registry
// ============================================================================

import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import { createAdminClient } from "@/lib/supabase/admin";

type PlanRequirement = "starter" | "professional" | "enterprise";
type TriggerType = "scheduled" | "event" | "manual";

interface RegistrySeedRow {
  agent_id: string;
  name: string;
  description: string;
  plan_requirement: PlanRequirement;
  trigger_type: TriggerType;
  schedule_cron: string | null;
}

const ROSTER: RegistrySeedRow[] = [
  {
    agent_id: "grant_summary",
    name: "AG-01 — Grant Summary Agent",
    description:
      "Summarizes a raw opportunity (scraped/imported text) into structured fields: name, category, amount range, deadline, eligibility requirements. Invoked as a subroutine of research/import flows, not independently scheduled.",
    plan_requirement: "starter",
    trigger_type: "event",
    schedule_cron: null,
  },
  {
    agent_id: "eligibility_scoring",
    name: "AG-02 — Eligibility Scoring Agent",
    description:
      "Scores 0-100 org fit for an opportunity and sets a recommendation (apply/skip/review) with reasoning. Runs nightly for unscored opportunities and on-demand via the agent queue.",
    plan_requirement: "starter",
    trigger_type: "scheduled",
    schedule_cron: "0 2 * * *",
  },
  {
    agent_id: "deadline_extraction",
    name: "AG-03 — Deadline Extraction Agent",
    description:
      "Creates deadline records (application deadline plus 7/14/30-day reminders) from an opportunity's raw deadline field, with reporting/renewal inference. Reachable on-demand via the agent queue.",
    plan_requirement: "starter",
    trigger_type: "event",
    schedule_cron: null,
  },
  {
    agent_id: "ag-04-fit-analysis",
    name: "AG-04 — Fit Analysis Agent",
    description:
      "Deep 'should we actually apply' pass beyond eligibility scoring — ROI, effort estimate, and competitive positioning for opportunities that already qualify. Live today via a manual API route (/api/ai/fit-analysis); the structured autonomous version exists as real code but is not yet wired into the nightly sweep.",
    plan_requirement: "starter",
    trigger_type: "manual",
    schedule_cron: null,
  },
  {
    agent_id: "ag-05-research",
    name: "AG-05 — Research Agent",
    description:
      "User-initiated multi-source parallel discovery of new grant opportunities (Grants.gov, SAM.gov, ProPublica, custom connectors), run in parallel per source.",
    plan_requirement: "starter",
    trigger_type: "manual",
    schedule_cron: null,
  },
  {
    agent_id: "ag-06-draft-generator",
    name: "AG-06 — Draft Generator Agent",
    description:
      "Generates a complete grant narrative draft from the Knowledge Base, proven narratives, and opportunity/org context. Runs nightly for qualifying opportunities (capped per org per night), via chain, and on manual request. Every autonomously created draft is unconditionally flagged pending_review.",
    plan_requirement: "starter",
    trigger_type: "scheduled",
    schedule_cron: "0 2 * * *",
  },
  {
    agent_id: "recursive_learning",
    name: "AG-07 — Learning Agent",
    description:
      "Analyzes awarded/denied outcomes, extracts proven narrative patterns, and updates knowledge_base.is_proven / proven_count. Fires on every outcomes table insert.",
    plan_requirement: "starter",
    trigger_type: "event",
    schedule_cron: null,
  },
  {
    agent_id: "ag-08-nofa-parser",
    name: "AG-08 — NOFA Parser Agent",
    description:
      "Parses Notice of Funding Availability documents from federal sources into structured opportunity fields. Invoked as a subroutine of the research/import pipeline when a NOFA document URL is present.",
    plan_requirement: "professional",
    trigger_type: "event",
    schedule_cron: null,
  },
  {
    agent_id: "email_parser",
    name: "AG-09 — Email Parser Agent",
    description:
      "Parses incoming grant-related emails, extracts deadlines and action items. Fires on inbound email received via the platform's email ingestion route.",
    plan_requirement: "professional",
    trigger_type: "event",
    schedule_cron: null,
  },
  {
    agent_id: "ag-10-grant-dna",
    name: "AG-10 — Grant DNA Analysis Agent",
    description:
      "Analyzes grant requirements and outcomes per funder to produce a structured DNA profile of what that funder tends to require and reward (requirement_patterns from opportunity structure, reward_patterns from outcome/eligibility text via Claude). Writes to funder_dna_profiles.",
    plan_requirement: "enterprise",
    trigger_type: "scheduled",
    schedule_cron: "0 3 * * 0",
  },
  {
    agent_id: "cold_outreach",
    name: "AG-11 — Cold Outreach Agent",
    description:
      "Extracts contacts from companies without a public giving page and generates personalized cold-outreach sequences. User-initiated from the Sales Outreach / Donor Discovery UI; every generated message is reviewed before send.",
    plan_requirement: "starter",
    trigger_type: "manual",
    schedule_cron: null,
  },
  {
    agent_id: "ag-12-autoapply",
    name: "AG-12 — AutoApply Agent",
    description:
      "Stealth browser automation for grant-portal form detection, filling, and submission, with a mandatory human approval checkpoint before final submit. Driven by a continuous submission_queue poll plus a daily Vercel cron.",
    plan_requirement: "professional",
    trigger_type: "scheduled",
    schedule_cron: "0 2 * * *",
  },
  {
    agent_id: "ag-13-foundation-enrichment",
    name: "AG-13 — Foundation Enrichment Agent",
    description:
      "Enriches foundation_directory records from ProPublica 990 data and a stealth website scraper waterfall (homepage, contact-page discovery, extraction). Weekly scheduled run, gated behind ENABLE_SCRAPER.",
    plan_requirement: "professional",
    trigger_type: "scheduled",
    schedule_cron: "0 3 * * 0",
  },
  {
    agent_id: "ag-14-donor-discovery",
    name: "AG-14 — Donor Discovery Agent",
    description:
      "Discovers and scores corporate donor prospects via a Google Places + enrichment pipeline, per user-submitted discovery request. Continuously polls donor_discovery_requests.",
    plan_requirement: "professional",
    trigger_type: "event",
    schedule_cron: null,
  },
  {
    agent_id: "ag-15-probability",
    name: "AG-15 — Grant Probability Agent",
    description:
      "Computes an 11-factor probability score (0-100) for an opportunity, with confidence, factor breakdown, and recommendation, then chains into Draft Generation above the org's auto-draft threshold. The underlying deterministic scoring engine also runs via manual/batch call sites outside this agent wrapper.",
    plan_requirement: "professional",
    trigger_type: "event",
    schedule_cron: null,
  },
  {
    agent_id: "ag-16-digital-twin",
    name: "AG-16 — Digital Twin Builder Agent",
    description:
      "Constructs and maintains an AI model of the organization (mission, programs, financial profile, board, proven narrative patterns) from the Knowledge Base, outcomes, and org profile. Event-driven: rebuilds on Knowledge Base save, at onboarding completion, and on manual request.",
    plan_requirement: "professional",
    trigger_type: "event",
    schedule_cron: null,
  },
  {
    agent_id: "ag-17-discovery",
    name: "AG-17 — Opportunity Discovery Agent",
    description:
      "Autonomous nightly discovery of new funding opportunities across Grants.gov, SAM.gov, and Federal Register, scoped to the org's active search profiles. Chains qualifying discoveries into eligibility scoring.",
    plan_requirement: "professional",
    trigger_type: "scheduled",
    schedule_cron: "0 2 * * *",
  },
  {
    agent_id: "ag-18-reputation",
    name: "AG-18 — Reputation Intelligence Agent",
    description:
      "Monitors funders for legal issues, leadership changes, and financial distress signals via external search and Claude classification. Designed for a nightly sampled sweep; critical/high-severity signals escalate to an immediate alert.",
    plan_requirement: "professional",
    trigger_type: "scheduled",
    schedule_cron: "0 2 * * *",
  },
  {
    agent_id: "ag-19-relationship",
    name: "AG-19 — Relationship Builder Agent",
    description:
      "Nightly synthesis of funder relationship signals (relationship_memory recency/volume, momentum) into a specific Claude-written engagement recommendation, plus multi-hop warm-introduction pathfinding over the relationship graph. Designed as a nightly per-funder pass; a simpler deterministic event-delta scorer (funder_relationship) currently covers the live nightly path instead.",
    plan_requirement: "professional",
    trigger_type: "scheduled",
    schedule_cron: "0 2 * * *",
  },
  {
    agent_id: "ea01_giving_detector",
    name: "AG-20 — Corporate Giving Detector Agent (EA-01)",
    description:
      "Analyzes a company's website for a corporate giving program and donation forms, extracting giving-portal URL and known donation types. Runs as part of the sequential EA-01..EA-10 corporate enrichment pipeline, on-demand rather than continuous worker boot.",
    plan_requirement: "professional",
    trigger_type: "event",
    schedule_cron: null,
  },
  {
    agent_id: "ea08_executive_biography_analyzer",
    name: "AG-21 — Executive Biography Analyzer Agent (EA-08)",
    description:
      "Extracts decision-maker names, titles, and board members from a company's leadership pages. Runs as part of the sequential corporate enrichment pipeline.",
    plan_requirement: "professional",
    trigger_type: "event",
    schedule_cron: null,
  },
  {
    agent_id: "ag22_propensity_scoring",
    name: "AG-22 — Propensity Scoring Agent",
    description:
      "Computes 10 donation-propensity scores (PS-01 through PS-10) per corporate prospect from composed EA-01..EA-10 enrichment data. Runs as the score-engine step of the corporate enrichment pipeline.",
    plan_requirement: "professional",
    trigger_type: "event",
    schedule_cron: null,
  },
  {
    agent_id: "ag-32-relationship-graph",
    name: "AG-23 / AG-32 — Relationship Mapper / Graph Builder Agent",
    description:
      "Discovers relationships between businesses, foundations, board members, and nonprofits (board overlaps, alumni networks, shared executives) into the Philanthropic Intelligence Graph (pig_nodes / pig_edges). AGENTS_v2.md documents this as one agent under two numbers (AG-23 canonical name, built as AG-32) — seeded once. Scheduled daily, incremental (only board members with no graph node yet, or updated since their last one).",
    plan_requirement: "enterprise",
    trigger_type: "scheduled",
    schedule_cron: "30 5 * * *",
  },
  {
    agent_id: "ag-24-outreach-generator",
    name: "AG-24 — Personalized Outreach Generator Agent",
    description:
      "Generates an AI-individualized outreach email for a corporate prospect, referencing specific known facts (industry, location, mission alignment). Live via a manual API route wired into the Donor Discovery outreach composer.",
    plan_requirement: "professional",
    trigger_type: "manual",
    schedule_cron: null,
  },
  {
    agent_id: "ag-25-disaster-response",
    name: "AG-25 — Disaster Response Agent",
    description:
      "Polls FEMA disaster declarations and deploys a coordinated response: matches affected orgs to emergency funding programs and nearby corporate donors. Reachable only via a manual API route today — no automatic polling schedule is wired.",
    plan_requirement: "professional",
    trigger_type: "manual",
    schedule_cron: null,
  },
  {
    agent_id: "ag-25-deadline-prediction",
    name: "AG-25 (on-disk) — Deadline Prediction Agent",
    description:
      "Predicts a funder's next opportunity cycle deadline from that funder's own historical deadline pattern, and creates a projected opportunity record. Unrelated to the canonical AG-25 Disaster Response Agent above — a documented permanent dual-use of the number 25 (AGENTS_v2.md §1.4). Runs nightly, gated per-org.",
    plan_requirement: "professional",
    trigger_type: "scheduled",
    schedule_cron: "0 2 * * *",
  },
  {
    agent_id: "ag-26-forecast",
    name: "AG-26 — Funding Forecast Agent",
    description:
      "Generates 90-day and 12-month probability-weighted funding forecasts per org from open-pipeline probability scores and historical win rate, with a Claude-written risk/opportunity narrative. Monthly, 1st of the month.",
    plan_requirement: "enterprise",
    trigger_type: "scheduled",
    schedule_cron: "0 4 1 * *",
  },
  {
    agent_id: "ag-27-board-packet",
    name: "AG-27 — Board Meeting Packet Agent",
    description:
      "Generates a complete board meeting packet (pipeline summary, outcomes since last meeting, financial snapshot, grounded discussion items) roughly 48 hours before every scheduled board meeting. Daily scope check plus an event trigger for short-notice meetings.",
    plan_requirement: "enterprise",
    trigger_type: "scheduled",
    schedule_cron: "0 2 * * *",
  },
  {
    agent_id: "ag-28-followup",
    name: "AG-28 — Follow-Up Generator Agent",
    description:
      "Generates and schedules stage-appropriate follow-up correspondence (check-in, thank-you, feedback-request) the moment an application transitions to submitted, awarded, or denied. Drafted for human review only — never sent automatically.",
    plan_requirement: "professional",
    trigger_type: "event",
    schedule_cron: null,
  },
  {
    agent_id: "ag-29-knowledge-indexer",
    name: "AG-29 — Knowledge Engine Indexer Agent",
    description:
      "Generates and stores pgvector embeddings for intelligence_proposal_sections, outcomes, and foundation_directory records with real text content and no embedding yet, and aggregates knowledge_patterns on a 24-hour cadence. Platform-wide (not org-scoped); event-triggered per insert plus a continuous background catch-up poll.",
    plan_requirement: "professional",
    trigger_type: "event",
    schedule_cron: null,
  },
  {
    agent_id: "ag-29-fundability",
    name: "AG-29 (on-disk collision) — Fundability Scorer Agent",
    description:
      "Decomposes a below-threshold grant probability score into the specific deficiency behind it (weak mission-fit language, incomplete budget history, missing logic model, Digital Twin gaps). Unrelated to the canonical AG-29 Knowledge Engine Indexer above, a documented on-disk numbering collision (AGENTS_v2.md §1.4/§4). Manual/on-demand via the opportunity detail panel.",
    plan_requirement: "professional",
    trigger_type: "manual",
    schedule_cron: null,
  },
  {
    agent_id: "ag-30-donor-intent",
    name: "AG-30 — Donor Intent Monitor",
    description:
      "Monitors press releases, CSR/ESG reports, hiring trends, and facility-expansion signals for corporate prospects, scoring the probability each entity announces a giving initiative soon, grounded in live web search. Manual/on-demand today; production signal volume is limited by the still-missing corporate_prospects table.",
    plan_requirement: "professional",
    trigger_type: "manual",
    schedule_cron: null,
  },
  {
    agent_id: "ag-31-national-forecast",
    name: "AG-31 — National Forecast Agent",
    description:
      "Macro-level extension of the org-level Funding Forecast Agent: ingests congressional appropriations, FEMA spending patterns, and HUD/USDA/state budget cycles to project category-level national funding trend direction and magnitude 12 months out. Documented in AGENTS_v2.md as PLANNED; no implementation file exists in this repo as of this seed.",
    plan_requirement: "professional",
    trigger_type: "scheduled",
    schedule_cron: null,
  },
  {
    agent_id: "ag-35-community-need",
    name: "AG-35 — Community Need Predictor",
    description:
      "Forecasts service demand from housing/eviction/employment/weather signals, grounded in live web search rather than training-data recall. Manual/on-demand via the community-need intelligence panel.",
    plan_requirement: "professional",
    trigger_type: "manual",
    schedule_cron: null,
  },
  {
    agent_id: "ag-36-learning-network",
    name: "AG-36 — Learning Network Aggregator",
    description:
      "Anonymizes and aggregates successful grant patterns across every subscriber org into platform_learning_patterns, which the Draft Generator reads pre-draft to boost confidence on matched patterns. Platform-wide; scheduled weekly (self-gates to Sunday).",
    plan_requirement: "enterprise",
    trigger_type: "scheduled",
    schedule_cron: "0 6 * * 0",
  },
  {
    agent_id: "ag-37-simulation",
    name: "AG-37 — Simulation Agent",
    description:
      "Multi-scenario what-if modeling — projects revenue, capacity, probability, and ROI per scenario so a board can compare strategic options. Manual/on-demand via /reports/simulate; deliberately not wired into the nightly sweep.",
    plan_requirement: "enterprise",
    trigger_type: "manual",
    schedule_cron: null,
  },
  {
    agent_id: "ag-38-self-improvement",
    name: "AG-38 — Self-Improvement Agent",
    description:
      "Nightly meta-agent reviewing every other agent's agent_runs outcomes, identifying underperformers and high-performing patterns, and proposing prompt/logic improvements staged for human approval. Never self-deploys a change.",
    plan_requirement: "enterprise",
    trigger_type: "scheduled",
    schedule_cron: "0 4 * * *",
  },
  {
    agent_id: "ag-39-roi-optimizer",
    name: "AG-39 — ROI Optimizer",
    description:
      "Tracks submission variables (prompt version, attachment type, submission day, wording, contact person) against outcome to find correlations with higher award rates. Real-time telemetry is captured on every application stage transition; the monthly correlation-analysis pass runs as part of the nightly orchestrator wiring.",
    plan_requirement: "enterprise",
    trigger_type: "scheduled",
    schedule_cron: "0 2 * * *",
  },
  {
    agent_id: "ag-40-strategic-advisor",
    name: "AG-40 — Strategic Advisor",
    description:
      "Capstone synthesis agent — reads seven other intelligence tables (forecasts, relationship recommendations, reputation alerts, deadlines, learning patterns, and more) to produce a single prioritized list of proactive strategic recommendations. Recommends only, never acts. Wired into the nightly 2AM sweep and reachable manually.",
    plan_requirement: "enterprise",
    trigger_type: "scheduled",
    schedule_cron: "0 2 * * *",
  },
  {
    agent_id: "ag-41-impact-simulation",
    name: "AG-41 — Impact Simulation Agent",
    description:
      "Models what-if strategic scenarios (lose/gain a funder, program expansion, budget cut) against real baseline forecast and outcome data, with a Claude-written narrative. Deliberately manual-only — a hypothetical scenario only has meaning in response to a specific question a human is asking; no schedule or event trigger by design.",
    plan_requirement: "enterprise",
    trigger_type: "manual",
    schedule_cron: null,
  },
  {
    agent_id: "ag-42-change-monitor",
    name: "AG-42 — Change Monitor Agent (CM-01)",
    description:
      "Detects changes in monitored entities (website reachability, leadership/status drift in foundation_directory, and corporate_prospects once that table exists) and chain-queues out-of-cycle re-enrichment. Platform-wide; scheduled daily, capped per run.",
    plan_requirement: "enterprise",
    trigger_type: "scheduled",
    schedule_cron: "0 5 * * *",
  },
  {
    agent_id: "ag-06-budget-builder",
    name: "Autonomous Budget Builder Agent (queue-wired, not part of AG-01-42 canonical numbering)",
    description:
      "Generates a line-item budget for human review, event-driven on an application entering the drafting stage. Real, distinct agent wired into the agent queue; its on-disk agentId happens to reuse the digit 6, unrelated to canonical AG-06 Draft Generator Agent — included here because it is real and live, not because it has its own canonical AGENTS_v2.md slot.",
    plan_requirement: "professional",
    trigger_type: "event",
    schedule_cron: null,
  },
  {
    agent_id: "ag-07-compliance-check",
    name: "Autonomous Compliance Check Agent (queue-wired, not part of AG-01-42 canonical numbering)",
    description:
      "Blocks non-compliant applications from progressing, event-driven when an application enters ready_for_review. Real, distinct agent wired into the agent queue; its on-disk agentId happens to reuse the digit 7, unrelated to canonical AG-07 Learning Agent — included here because it is real and live, not because it has its own canonical AGENTS_v2.md slot.",
    plan_requirement: "professional",
    trigger_type: "event",
    schedule_cron: null,
  },
];

// AG-33 (Partnership Discovery Agent) and AG-34 (Personalization Engine) are
// intentionally absent from ROSTER above — zero implementation file exists
// anywhere in src/lib/agents/ or src/lib/intelligence/ for either concept,
// confirmed by grep this session. AG-31 (National Forecast Agent) is
// included above even though it is also genuinely PLANNED with no code,
// because a real, non-fabricated purpose description exists in
// AGENTS_v2.md's Phase 2-5 addendum and it directly extends AG-26 (which is
// real and scheduled) — worth surfacing as "documented, not yet built"
// rather than omitted outright. AG-33/AG-34's descriptions would be equally
// real/non-fabricated too, but were left out of this pass rather than
// mechanically included alongside AG-31 — see this script's session
// write-up in SESSION_STATE.md; a future pass can add them the same way.

async function main() {
  const admin = createAdminClient();

  console.log("=".repeat(78));
  console.log(`Seeding agent_registry — ${ROSTER.length} rows`);
  console.log("=".repeat(78));

  const agentIds = ROSTER.map((r) => r.agent_id);
  const duplicates = agentIds.filter((id, i) => agentIds.indexOf(id) !== i);
  if (duplicates.length > 0) {
    console.error(`\nFATAL: duplicate agent_id in ROSTER: ${duplicates.join(", ")}`);
    process.exit(1);
  }

  const rows = ROSTER.map((r) => ({
    agent_id: r.agent_id,
    name: r.name,
    description: r.description,
    plan_requirement: r.plan_requirement,
    trigger_type: r.trigger_type,
    schedule_cron: r.schedule_cron,
    active: true,
  }));

  const { data, error } = await admin
    .from("agent_registry")
    .upsert(rows, { onConflict: "agent_id" })
    .select("agent_id");

  if (error) {
    console.error(`\nFATAL: upsert failed: ${error.message}`);
    process.exit(1);
  }

  console.log(`Upserted ${data?.length ?? 0} rows.`);

  const { count, error: countError } = await admin
    .from("agent_registry")
    .select("agent_id", { count: "exact", head: true });
  if (countError) {
    console.error(`\nWARNING: post-seed count check failed: ${countError.message}`);
  } else {
    console.log(`Total agent_registry rows now: ${count}`);
  }

  const { data: sample, error: sampleError } = await admin
    .from("agent_registry")
    .select("agent_id, name")
    .order("agent_id", { ascending: true });
  if (sampleError) {
    console.error(`\nWARNING: post-seed sample query failed: ${sampleError.message}`);
  } else {
    console.log("\nagent_id -> name:");
    for (const row of sample ?? []) {
      console.log(`  ${row.agent_id} -> ${row.name}`);
    }
  }

  console.log("\n" + "=".repeat(78));
  console.log("Done.");
  console.log("=".repeat(78));
}

main().catch((error) => {
  console.error(`\nFATAL: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
