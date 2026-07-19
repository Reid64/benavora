# BENAVORA — Agent Definitions v2.0 (Autonomous Mode Edition)
## Supersedes: AGENTS_v2.md (July 17, 2026 edition)
## Date: July 19, 2026
## Status: CANONICAL — rewritten from a live audit of `src/lib/agents/`, `src/lib/agents/autonomous-base.ts`,
## `worker/autonomous-orchestrator.ts`, `worker/scheduler.ts`, `worker/index.ts`, and the applied Supabase
## migrations (`src/supabase/migrations/`), not from aspiration. Every "ENABLED" claim below was verified
## against an actual call site; every "PLANNED" or "dead code" claim was verified by confirming the class or
## function is never instantiated/called anywhere in the repo.

---

## 0. AUTONOMOUS_HARD_LIMITS

These are not aspirational. They are the literal exported constant in
`src/lib/agents/autonomous-base.ts` that every `AutonomousAgent` subclass inherits, plus the
behavior enforced in `logDecision()`. No agent — built or planned — may override them.

```typescript
export const AUTONOMOUS_HARD_LIMITS = {
  NEVER_SUBMIT_EXTERNALLY: true,          // no agent calls AutoApply's final submit step
  NEVER_SEND_EMAIL_WITHOUT_APPROVAL: true, // outreach/follow-up content is drafted, never sent
  NEVER_DELETE_USER_DATA: true,
  NEVER_MODIFY_GOVERNANCE_FILES: true,
  MAX_DRAFTS_PER_NIGHT_DEFAULT: 10,        // org_autonomous_config.max_auto_drafts_per_night
  MIN_CONFIDENCE_TO_ACT: 60,
} as const;
```

**Enforcement mechanics (from `AutonomousAgent.logDecision()`):** any decision logged with
`confidenceScore < 60` has `required_human_review` forced to `true` regardless of what the
calling agent requested. A caller can request `requiredHumanReview: true` unconditionally (several
agents do, for anything touching money, submission-adjacent state, or external contact) — it can
never request `false` below the 60 floor.

**Agents that hard-code `requiredHumanReview: true` unconditionally** (never gated on confidence):
Draft Generation (every autonomous draft), Budget Builder (every generated budget), Deadline
Prediction (every projected opportunity). See each agent's spec below.

**No agent in this codebase — built or planned — ever**: calls a funder's external portal,
sends an email/SMS without a human clicking send, deletes a document/application/funder record,
or writes to a `.md` governance file. AutoApply (AG-12) is the one agent that touches an external
system at all, and even it stops at a human approval checkpoint before the final submit click
(`WORKER_ARCHITECTURE_v2.md` §5, "Human Approval Gate").

---

## 1. KNOWN GAPS — read this before trusting any "ENABLED" row

This section exists because the previous edition of this document described a coherent, fully-wired
30-agent autonomous system. The real codebase has two overlapping generations of agent code, an
`agent_type` enum that was never fully extended to match the newer generation, and a chain-routing
table that doesn't recognize the newer generation's own chain targets. All three are real, currently
live gaps — not historical ones already fixed.

### 1.1 Two generations of agent code

- **Generation 1 ("BaseAgent" pattern, `src/lib/agents/base-agent.ts`):** older, predates
  `agent_decisions`/`agent_queue`/`org_autonomous_config` (migration 080). No per-decision audit
  trail, no confidence-gated human review, no `queueChainedAgent()`. This is the code that is
  **actually wired** into `worker/autonomous-orchestrator.ts`'s nightly steps and its `agent_queue`
  router for most of what runs today: `EligibilityScorer`, `DeadlineExtractor`, `ComplianceChecker`,
  `BudgetBuilderAgent` (in `budget-builder.ts`), `SuccessProbabilityAgent`, `FunderRelationshipAgent`,
  `DeadlinePredictionAgent` (in `deadline-prediction.ts`), `FollowUpGeneratorAgent` (in
  `follow-up-generator.ts`), plus the plain functions `generateDraft()`, `checkEntityReputation()`,
  `sendMorningDigest()`, `runOpportunityDiscovery()` (a thin wrapper, see 1.3).
- **Generation 2 ("AutonomousAgent" pattern, `src/lib/agents/autonomous-base.ts`):** newer, built
  across several sessions (commits `69a1117`, `1416a05`, and the `ag-0X` eligibility/discovery/
  probability/draft agents). Full `agent_decisions` audit trail, confidence-gated human review,
  `queueChainedAgent()` chaining. **Of the 17 classes extending `AutonomousAgent`, only 6 are ever
  instantiated anywhere in the codebase**: `RenewalTrackerAgent`, `OutcomeAnalyzerAgent`,
  `DocumentExpiryAgent`, `KnowledgeGapAgent`, `SearchProfileOptimizerAgent` (all wired into
  `runOrgPipeline()`'s nightly sweep), and `AutonomousDigestAgent` (wired into the 7 AM digest
  pipeline). The other 11 — `EligibilityScoringAgent`, `DeadlineExtractionAgent`,
  `FitAnalysisAgent`, `DraftGenerationAgent`, `BudgetBuilderAgent` (in `budget-builder-agent.ts`,
  a same-name second class), `ComplianceCheckAgent`, `ProbabilityScoringAgent`,
  `OpportunityDiscoveryAgent` (wired but see 1.3), `RelationshipBuilderAgent`,
  `DeadlinePredictionAgent` (in `deadline-prediction-agent.ts`, a same-name second class), and
  `FollowupGeneratorAgent` (wired, see 1.3) — are either never `new`'d anywhere outside their own
  file, or are `new`'d but blocked by 1.2.

### 1.2 `agent_type` enum gap — blocks 12 of the 17 Generation-2 classes at the database layer

`agent_runs.agent_type` is a strict Postgres enum (`CREATE TYPE agent_type`, migration 001),
extended piecemeal via `ALTER TYPE ... ADD VALUE` across the migration history.
`AutonomousAgent.startRun()` inserts `agent_type = this.agentId` **directly and unconditionally**,
**before** the `try` block in every `run()` method — so if the literal string isn't a valid enum
member, the insert throws and the run fails immediately, before any real work happens.

Migration `082_ag08_ag12_autonomous_agents.sql` added exactly 5 values (and says so in its own
header comment, which additionally flags 2 more as known-but-out-of-scope). Auditing every
`super(orgId, "...", supabase)` call against every `ALTER TYPE agent_type ADD VALUE` in
`src/supabase/migrations/` turns up **12 IDs that were never added**, not 2:

| agent_type literal | Class | Enum-valid? |
|---|---|---|
| `ag-08-renewal-tracker` | RenewalTrackerAgent | (added in 082) |
| `ag-09-outcome-analyzer` | OutcomeAnalyzerAgent | (added in 082) |
| `ag-10-document-expiry` | DocumentExpiryAgent | (added in 082) |
| `ag-11-knowledge-gap` | KnowledgeGapAgent | (added in 082) |
| `ag-12-search-optimizer` | SearchProfileOptimizerAgent | (added in 082) |
| `ag-02` | EligibilityScoringAgent | MISSING |
| `ag-03-deadline-extraction` | DeadlineExtractionAgent | MISSING |
| `ag-04-fit-analysis` | FitAnalysisAgent | MISSING |
| `ag-05-draft` | DraftGenerationAgent | MISSING |
| `ag-06-budget-builder` | BudgetBuilderAgent (autonomous version) | MISSING |
| `ag-07-compliance-check` | ComplianceCheckAgent | MISSING |
| `ag-15-probability` | ProbabilityScoringAgent | MISSING |
| `ag-17-discovery` | OpportunityDiscoveryAgent | MISSING |
| `ag-19-relationship` | RelationshipBuilderAgent | MISSING |
| `ag-25-deadline-prediction` | DeadlinePredictionAgent (autonomous version) | MISSING |
| `ag-28-followup` | FollowupGeneratorAgent | MISSING |
| `ag-digest` | AutonomousDigestAgent | MISSING |
| `autonomous_orchestrator` | (literal insert in `runOrgPipeline()`) | MISSING |

**Practical effect:** `OpportunityDiscoveryAgent` (AG-17) and `AutonomousDigestAgent` and
`FollowupGeneratorAgent` (AG-28's on-disk collision, see 1.4) *are* wired into live call paths
(nightly sweep / queue / API route — see 1.3) and *will actually be invoked* — and every single
invocation currently fails at `startRun()`'s `agent_runs` insert, before any discovery/digest/
follow-up logic runs. The failure is caught by the caller's own `try/catch` and logged as a string
in the step's `log[]` array or the `agent_queue` row's `error_message` — it does not crash the
nightly pipeline, but it also means **none of these three agents has ever successfully completed a
run against the live schema.** `runOrgPipeline()` itself inserts
`agent_type: 'autonomous_orchestrator'` for its own wrapper row — also invalid — so even the
top-level per-org tracking row fails to insert.

**Fix required:** one migration adding all 12 missing values via `ALTER TYPE agent_type ADD VALUE
IF NOT EXISTS`. Out of scope for this document; flagged here so nobody assumes "wired" means
"working."

### 1.3 Chain-routing gap — the discovery → probability → draft chain is fully broken

Three Generation-2 agents were explicitly designed to chain into each other via
`queueChainedAgent()`, and their file headers say so:

```
OpportunityDiscoveryAgent (ag-17-discovery)
  --auto_score_enabled--> queues agent_id "ag-15-probability"
       |
       v
ProbabilityScoringAgent (ag-15-probability)
  --score >= auto_draft_threshold && auto_draft_enabled--> queues agent_id "ag-05-draft"
       |
       v
DraftGenerationAgent (ag-05-draft)
```

`EligibilityScoringAgent` (ag-02) independently also queues `"ag-15-probability"` when
`auto_score_enabled` and it finds qualified opportunities.

The problem: `worker/autonomous-orchestrator.ts`'s `routeQueueItem()` — the function that claims a
row off `agent_queue` and dispatches it — is a `switch` on `item.agent_id` with cases for
`'opportunity_discovery'`, `'eligibility_scoring'`, `'success_probability'`, `'draft_generation'`,
etc. (the Generation-1, snake_case, human-readable names). **It has no case for `'ag-15-probability'`
or `'ag-05-draft'`** — the literal strings the Generation-2 chain producers actually enqueue. Any
row landing in `agent_queue` with one of those two `agent_id` values falls through to the `default:`
branch, throws `Unknown agent_queue agent_id`, retries up to `max_retries` (3), and is marked
`failed`. `ProbabilityScoringAgent` and `DraftGenerationAgent` are therefore unreachable via the
queue even on the rare chance the enum gap above didn't also block them.

`FollowupGeneratorAgent`'s chain target (`'ag-28-followup'`) is the one Generation-2 chain ID that
*is* recognized by `routeQueueItem()` — it has an explicit case. It is still blocked by the enum gap
in 1.2.

### 1.4 Agent-ID numbering collisions between this document and the live `agent_type` values

Five of the Generation-2 agent IDs reuse an `AG-XX` number this document assigns to a *completely
different* canonical agent (Section 5 below). This was a deliberate scoping choice made mid-build
(each affected file's header says so explicitly) rather than an accident, but it means the number
alone is not a reliable identifier across code and docs:

| This doc's AG-XX slot (canonical name) | Code's `ag-XX` literal actually means |
|---|---|
| AG-05 — Research Agent | `ag-05-draft` = **Draft Generation Agent** (this doc's AG-06 concept) |
| AG-08 — NOFA Parser Agent | `ag-08-renewal-tracker` = **Renewal Tracker Agent** (unrelated) |
| AG-09 — Email Parser Agent | `ag-09-outcome-analyzer` = **Outcome Analyzer Agent** (unrelated) |
| AG-10 — Grant DNA Analysis Agent | `ag-10-document-expiry` = **Document Expiry Agent** (unrelated) |
| AG-11 — Cold Outreach Agent | `ag-11-knowledge-gap` = **Knowledge Gap Agent** (unrelated) |
| AG-12 — AutoApply Agent | `ag-12-search-optimizer` = **Search Profile Optimizer Agent** (unrelated) |
| AG-25 — Disaster Response Agent | `ag-25-deadline-prediction` = **Deadline Prediction Agent** (unrelated) |
| AG-28 — Impact Simulation Agent | `ag-28-followup` = **Follow-Up Generator Agent** (unrelated) |

This document keeps the original 30 canonical `AG-XX` names/purposes (Section 5) because that is
the taxonomy the product/business side already knows. Every per-agent spec below states its real
on-disk `agent_type`/`agent_id` literal explicitly so the two schemes never get silently conflated.

---

## 2. Agent Architecture (unchanged from prior edition)

All Generation-1 agents inherit from `BaseAgent` (`src/lib/agents/base-agent.ts`): structured
logging to `agent_runs`, token usage tracking, org-scoped service-role data access, execution time
measurement. No `agent_decisions` audit trail.

All Generation-2 agents inherit from `AutonomousAgent` (`src/lib/agents/autonomous-base.ts`,
migration 080): everything `BaseAgent` has, plus `agent_decisions` (reasoning + confidence +
`required_human_review` per decision), `agent_queue` (priority queue, `queueChainedAgent()`),
`org_autonomous_config` (per-org toggle + threshold reads via `getOrgConfig()`), and `alerts`
writes via `createNotification()` (this schema has no dedicated `notifications` table).

**Model:** `claude-sonnet-4-6` for all agents that call Claude. **Timeout:** AI-calling API routes
require `export const maxDuration = 300` (`vercel.json` + route-level).

---

## 3. Master Agent Table

| Agent ID | Name | Type | Autonomous Status | Trigger | Chains To |
|---|---|---|---|---|---|
| AG-01 | Grant Summary Agent | AI (Claude) | NOT_APPLICABLE | chain (internal subroutine) | none |
| AG-02 | Eligibility Scoring Agent | AI (Claude) | ENABLED | schedule + event | AG-15 (designed, unreachable — 1.3) |
| AG-03 | Deadline Extraction Agent | Deterministic | ENABLED | event (agent_queue) | none |
| AG-04 | Fit Analysis Agent | AI (Claude) | PLANNED | event (designed: eligibility_score ≥ 70) | none |
| AG-05 | Research Agent | AI (Claude) | NOT_APPLICABLE | manual-only | none |
| AG-06 | Draft Generator Agent | AI (Claude) | ENABLED | schedule + chain + manual | none |
| AG-07 | Learning Agent | Deterministic | ENABLED | event (outcome insert) | none |
| AG-08 | NOFA Parser Agent | AI (Claude) | NOT_APPLICABLE | chain (internal, research pipeline) | none |
| AG-09 | Email Parser Agent | AI (Claude) | ENABLED | event (inbound email) | none |
| AG-10 | Grant DNA Analysis Agent | — | PLANNED | — | none |
| AG-11 | Cold Outreach Agent | AI (Claude) | NOT_APPLICABLE | manual-only | none |
| AG-12 | AutoApply Agent | AI + Browser automation | ENABLED | schedule (cron) + queue | none (terminates at human approval) |
| AG-13 | Foundation Enrichment Agent | AI (Claude) | PLANNED | manual CLI script only | none |
| AG-14 | Donor Discovery Agent | Deterministic + AI | ENABLED | event (request row insert) | none |
| AG-15 | Grant Probability Agent | AI (Claude) | PLANNED | designed: chain + schedule | AG-06 (designed, unreachable — 1.3) |
| AG-16 | Digital Twin Builder Agent | AI (Claude) | PLANNED | designed: schedule (monthly) + event | none |
| AG-17 | Opportunity Discovery Agent | Deterministic + external APIs | ENABLED (blocked — 1.2) | schedule (nightly) + manual | AG-15 (designed, unreachable — 1.3) |
| AG-18 | Reputation Intelligence Agent | AI (Claude) | ENABLED | schedule (nightly, sampled) | none |
| AG-19 | Relationship Builder Agent | AI (Claude) | PLANNED | designed: schedule (nightly) | none |
| AG-20 | Corporate Giving Detector (EA-01) | AI (Claude) | PLANNED | — | none |
| AG-21 | Executive Biography Analyzer (EA-08) | AI (Claude) | PLANNED | — | none |
| AG-22 | Propensity Scoring Agent | AI (Claude) | PLANNED | — | none |
| AG-23 | Relationship Mapper Agent (RA-01) | AI (Claude) | PLANNED | — | none |
| AG-24 | Personalized Outreach Generator | AI (Claude) | PLANNED | — | none |
| AG-25 | Disaster Response Agent | Deterministic + AI | PLANNED | manual API route only (no cron) | none |
| AG-26 | Funding Forecast Agent | AI (Claude) | PLANNED | — | none |
| AG-27 | Board Meeting Packet Agent | AI (Claude) | PLANNED | — | none |
| AG-28 | Impact Simulation Agent | AI (Claude) | PLANNED | — | none |
| AG-29 | Knowledge Engine Indexer Agent | Embedding model | PLANNED | — | none |
| AG-30 | Change Monitor Agent (CM-01) | AI (Claude) | PLANNED | — | none |

---

## 4. Real vs. Canonical — quick cross-reference

Use this table to jump from a canonical `AG-XX` to the actual file(s) implementing it.

| AG-XX | Real file(s) | Real class/function | Live `agent_type`/`agent_id` |
|---|---|---|---|
| AG-01 | `grant-summary.ts` | `GrantSummaryAgent` | `grant_summary` |
| AG-02 | `eligibility-scorer.ts` (live) / `eligibility-scoring-agent.ts` (dead) | `EligibilityScorer` / `EligibilityScoringAgent` | `eligibility_scoring` / `ag-02` |
| AG-03 | `deadline-extractor.ts` (live) / `deadline-extraction-agent.ts` (dead) | `DeadlineExtractor` / `DeadlineExtractionAgent` | `deadline_extraction` / `ag-03-deadline-extraction` |
| AG-04 | `src/app/api/ai/fit-analysis/route.ts` (live, manual) / `fit-analysis-agent.ts` (dead) | — / `FitAnalysisAgent` | `fit_analysis` / `ag-04-fit-analysis` |
| AG-05 | `src/app/api/agents/research/route.ts` | (route-level, multiple source adapters) | `grants_gov_research` / `sam_gov_research` / etc. |
| AG-06 | `src/lib/drafts/generator.ts` (live) / `draft-generation-agent.ts` (dead) | `generateDraft()` / `DraftGenerationAgent` | none logged / `ag-05-draft` |
| AG-07 | `recursive-learning.ts` | `RecursiveLearningAgent` (BaseAgent) | `recursive_learning` |
| AG-08 | `nofa-parser.ts` | `NofaParserAgent` (BaseAgent) | `government_research` |
| AG-09 | `email-parser.ts` | `EmailParserAgent` (BaseAgent) | `email_parser` |
| AG-10 | not found | — | — |
| AG-11 | `cold-outreach.ts` | `ColdOutreachAgent` (BaseAgent) | `cold_outreach` |
| AG-12 | `browser-automation.ts`, `form-analyzer.ts`, `form-filler.ts`, `playwright-agent.ts`, `worker/queue-processor.ts` | `BrowserAutomationAgent` / `FormAnalyzerAgent` / `FormFillerAgent` | `browser_automation` / `form_analyzer` / `form_filler` |
| AG-13 | `propublica.ts`, `scripts/enrich-foundations-990.ts`, `scripts/enrich-propublica-batch.ts` | `PropublicaAgent` (BaseAgent) + CLI scripts | `propublica_mining` |
| AG-14 | `worker/dd-request-processor.ts` | (processor loop, not a BaseAgent/AutonomousAgent class) | n/a |
| AG-15 | `grant-probability-engine.ts` (live function) / `probability-scoring-agent.ts` (dead wrapper) | `computeGrantProbability()` / `ProbabilityScoringAgent` | none logged / `ag-15-probability` |
| AG-16 | `digital-twin-builder.ts` | `buildDigitalTwin()` | not wired into worker |
| AG-17 | `opportunity-discovery-agent.ts` | `OpportunityDiscoveryAgent` (+ `runOpportunityDiscovery()` wrapper) | `ag-17-discovery` |
| AG-18 | `src/lib/intelligence/reputation-agent.ts` | `checkEntityReputation()` | none logged (plain function) |
| AG-19 | `funder-relationship.ts` (live, event-delta only) / `relationship-builder-agent.ts` (dead) | `FunderRelationshipAgent` / `RelationshipBuilderAgent` | `funder_relationship` / `ag-19-relationship` |
| AG-20/21 | not found | — | — |
| AG-22 | `worker/batch-scorer.ts` (exists, not wired into `worker/index.ts`) | — | — |
| AG-23 | not found | — | — |
| AG-24 | not found (closest live analog: AG-11 Cold Outreach) | — | — |
| AG-25 | `disaster-response-agent.ts` | `pollFEMADeclarations()` / `deployDisasterResponse()` | none logged (plain functions) |
| AG-26 | not found | — | — |
| AG-27 | not found (schema exists: `board_members`, `board_meetings`, `board_meeting_packets`) | — | — |
| AG-28 | not found (schema exists: `impact_simulations`) — do not confuse with live `ag-28-followup` | — | `ag-28-followup` belongs to Follow-Up Generator, not this agent |
| AG-29 | not found (schema exists: `knowledge_patterns`, `intelligence_funded_proposals.embedding`) | — | — |
| AG-30 | not found | — | — |

---

## 5. Agent Specifications

### AG-01: Grant Summary Agent

- **Purpose:** Summarizes a raw opportunity (scraped/imported text) into structured fields
  (name, category, amount range, deadline, eligibility requirements).
- **Type:** AI (Claude), BaseAgent pattern.
- **Model:** claude-sonnet-4-6.
- **Tokens:** ~1,500 input / 500 output.
- **Tier Gate:** starter.
- **Real implementation:** `src/lib/agents/grant-summary.ts`, `agentType: "grant_summary"`.

**Autonomous Mode**
- **Status:** NOT_APPLICABLE
- **Trigger Type:** chain (invoked synchronously as a subroutine of research/import flows; never
  independently scheduled or queued)
- **Trigger Condition:** n/a — has no standalone entry point
- **Decision Log:** none (BaseAgent pattern; no `agent_decisions` row)
- **Chain Output:** none — this agent is always a callee, never a chain producer
- **Hard Limits:** none beyond the global hard limits (Section 0); it only transforms text, never
  writes application/submission state
- **Human Review Required:** no (its output feeds fields a human or another agent later acts on)

---

### AG-02: Eligibility Scoring Agent

- **Purpose:** Scores 0–100 org fit for an opportunity; sets `recommendation`
  (apply/skip/review) and `recommendation_reasoning`.
- **Type:** AI (Claude).
- **Model:** claude-sonnet-4-6.
- **Tokens:** 500 max output tokens (verified: `MAX_TOKENS = 500` in
  `eligibility-scoring-agent.ts`).
- **Tier Gate:** starter.
- **Real implementation — two parallel classes, only one live:**
  - **Live:** `src/lib/agents/eligibility-scorer.ts`, `EligibilityScorer` (BaseAgent,
    `agentType: "eligibility_scoring"`, enum-valid since migration 001). Wired into
    `worker/autonomous-orchestrator.ts`'s nightly `runEligibilityScoringStep()` (gated on
    `auto_score_enabled`, scores up to 10 unscored opportunities/night) and `agent_queue` case
    `'eligibility_scoring'`.
  - **Dead:** `src/lib/agents/eligibility-scoring-agent.ts`, `EligibilityScoringAgent`
    (AutonomousAgent, `agentId: "ag-02"`). Never instantiated anywhere in the repo. `agent_type`
    `"ag-02"` is also not a valid enum value (1.2). Its chain target
    `queueChainedAgent("ag-15-probability", ...)` would also fail even if reachable (1.3).

**Autonomous Mode**
- **Status:** ENABLED (via the live `EligibilityScorer` path only)
- **Trigger Type:** schedule + event
- **Trigger Condition:** nightly, when `org_autonomous_config.auto_score_enabled = true`, for up
  to 10 opportunities/night with `eligibility_score IS NULL`; also on-demand via `agent_queue`
  item `agent_id = 'eligibility_scoring'` with `input_payload.opportunityId`.
- **Decision Log:** none on the live path — `EligibilityScorer` predates `agent_decisions` and
  writes only an `agent_runs` summary row plus the `opportunities.eligibility_score` /
  `recommendation` / `recommendation_reasoning` update. (The dead Generation-2 twin, if it ever
  ran, would log `eligibility_qualified` / `eligibility_disqualified` / `eligibility_needs_review`
  decisions with the numeric score as `confidence_score`.)
- **Chain Output:** none on the live path.
- **Hard Limits:** never writes `eligibility_score` without a `recommendation_reasoning` string;
  never changes `status`/`stage` on any application; scores only, never decides.
- **Human Review Required:** no — score and recommendation are surfaced for a human to act on,
  never auto-applied.

---

### AG-03: Deadline Extraction Agent

- **Purpose:** Creates `deadlines` records (application deadline + 14/30-day reminders) from an
  opportunity's raw `deadline`.
- **Type:** Deterministic (no AI call on either implementation).
- **Model:** n/a.
- **Tokens:** n/a.
- **Tier Gate:** starter.
- **Real implementation — two parallel classes, only one live:**
  - **Live:** `src/lib/agents/deadline-extractor.ts`, `DeadlineExtractor` (BaseAgent,
    `agentType: "deadline_extraction"`, enum-valid since migration 001). Wired into `agent_queue`
    case `'deadline_extraction'`, single-`opportunityId` input, 7/14/30-day offsets plus
    reporting/renewal inference.
  - **Dead:** `src/lib/agents/deadline-extraction-agent.ts`, `DeadlineExtractionAgent`
    (AutonomousAgent, `agentId: "ag-03-deadline-extraction"`). Never instantiated anywhere.
    `agent_type` `"ag-03-deadline-extraction"` is not a valid enum value (1.2). Array-input version
    (14/30-day offsets only, no reporting/renewal inference).

**Autonomous Mode**
- **Status:** ENABLED (via `DeadlineExtractor`)
- **Trigger Type:** event
- **Trigger Condition:** `agent_queue` item `agent_id = 'deadline_extraction'`,
  `input_payload.opportunityId` set. (No code path in this repo currently enqueues this
  automatically on opportunity creation — it is reachable, not self-triggering; treat as
  callable-on-demand rather than a nightly sweep member.)
- **Decision Log:** none (BaseAgent pattern).
- **Chain Output:** none.
- **Hard Limits:** never overwrites an existing deadline row with the same title (idempotent
  insert-if-absent, verified in both implementations); never invents a deadline when
  `opportunities.deadline IS NULL`.
- **Human Review Required:** no.

---

### AG-04: Fit Analysis Agent

- **Purpose:** Deep "should we actually apply?" pass beyond eligibility scoring — ROI, effort
  estimate, competitive positioning — for opportunities that already qualify.
- **Type:** AI (Claude).
- **Model:** claude-sonnet-4-6.
- **Tokens:** 600 max output tokens (verified: `MAX_TOKENS = 600` in `fit-analysis-agent.ts`).
- **Tier Gate:** starter.
- **Real implementation — two parallel paths, both non-autonomous today:**
  - **Live, manual:** `src/app/api/ai/fit-analysis/route.ts` +
    `src/lib/ai/prompts/fit-analysis.ts`, prose output, persisted as a note only. User-triggered
    from the opportunity/application UI.
  - **Built, unwired:** `src/lib/agents/fit-analysis-agent.ts`, `FitAnalysisAgent`
    (AutonomousAgent, `agentId: "ag-04-fit-analysis"`), structured JSON recommendation
    (`strong_apply`/`apply`/`conditional_apply`/`pass`), designed to fire when
    `eligibility_score >= 70` and, on any non-`pass` verdict, create the application in the
    `discovered` stage with `fit_analysis` populated. `worker/autonomous-orchestrator.ts`'s own
    header comment states plainly it exists but wiring it in "is out of scope" for the session
    that last touched the file — it is never instantiated. `agent_type` `"ag-04-fit-analysis"` is
    also not a valid enum value (1.2).

**Autonomous Mode**
- **Status:** PLANNED
- **Trigger Type:** event (designed) — `eligibility_score` reaching 70, via `agent_queue` item
  `agent_id = 'ag-04-fit-analysis'`, `input_payload.opportunityId`.
- **Trigger Condition (as designed, not live):** `opportunities.eligibility_score >= 70`.
- **Decision Log (as designed):** `decisionType` = the verdict string
  (`strong_apply`/`apply`/`conditional_apply`/`pass`); on non-`pass`, `actionTaken` creates the
  `discovered`-stage application.
- **Chain Output:** none designed.
- **Hard Limits (as designed):** minimum 3 historical outcomes required before computing a
  category success rate (`MIN_OUTCOMES_FOR_RATE = 3`, its own literal threshold, distinct from the
  live manual route's default of 5); never fabricates an ROI figure with fewer than 3 outcomes on
  file — falls back to a stated "insufficient data" framing instead.
- **Human Review Required:** yes for any non-`pass` verdict (creates a `discovered`-stage
  application rather than progressing it further).

---

### AG-05: Research Agent

- **Purpose:** Discovers new grant opportunities from configured sources on demand (multi-source
  parallel search: Grants.gov, SAM.gov, ProPublica, custom connectors).
- **Type:** AI (Claude) + external API adapters.
- **Model:** claude-sonnet-4-6.
- **Tokens:** varies by source count.
- **Tier Gate:** starter.
- **Real implementation:** `src/app/api/agents/research/route.ts`, backed by
  `grants-gov.ts`, `sam-gov.ts`, `propublica.ts`, `custom-api.ts`, `custom-scrape.ts`,
  `state-portal.ts`, and the `src/lib/agents/research/` adapters (`foundation-grants.ts`,
  `government-grants.ts`, `corporate-giving.ts`, `local-sponsorship.ts`) run in parallel.

> **Numbering note:** the on-disk string `"ag-05-draft"` does **not** belong to this agent — it is
> `DraftGenerationAgent`'s `agentId` (see AG-06). This AG-05 slot has no `"ag-05"`-prefixed code at
> all. See 1.4.

**Autonomous Mode**
- **Status:** NOT_APPLICABLE
- **Trigger Type:** manual-only — this route is always user-initiated (Tier 2 "Parallel Research
  Agents" feature). The autonomous, nightly-scheduled counterpart covering similar ground is
  AG-17 (Opportunity Discovery Agent), a materially different implementation scoped to active
  `search_profiles` plus Grants.gov/SAM.gov/Federal Register only.
- **Trigger Condition:** n/a
- **Decision Log:** varies per source adapter's own `agent_type` (`grants_gov_research`,
  `sam_gov_research`, `propublica_mining`, etc.) — `agent_runs` only, no `agent_decisions`.
- **Chain Output:** none.
- **Hard Limits:** dedup by `oppNumber`/source URL per source contract
  (`BEHAVIORAL_CONTRACTS.md` §17–21); never creates a duplicate opportunity row.
- **Human Review Required:** no (surfaces candidates for a human to review and add).

---

### AG-06: Draft Generator Agent

- **Purpose:** Generates a complete grant narrative draft from the Knowledge Base, proven
  narratives, and opportunity/org context.
- **Type:** AI (Claude).
- **Model:** claude-sonnet-4-6.
- **Tokens:** 4,000 max output tokens (verified: `maxTokens: 4000` in
  `draft-generation-agent.ts`; the live `generateDraft()` pipeline uses a larger RAG-assembled
  prompt with its own budget).
- **Tier Gate:** starter.
- **Real implementation — two parallel paths, one live:**
  - **Live:** `src/lib/drafts/generator.ts`, `generateDraft()` — a plain function (not a
    `BaseAgent`/`AutonomousAgent` class; **writes no `agent_runs` or `agent_decisions` row at
    all**). Used interactively by the manual draft UI, and autonomously by
    `worker/autonomous-orchestrator.ts`'s `runDraftGenerationStep()` (gated on
    `auto_draft_enabled`) and `agent_queue` case `'draft_generation'`.
  - **Dead:** `src/lib/agents/draft-generation-agent.ts`, `DraftGenerationAgent`
    (AutonomousAgent, `agentId: "ag-05-draft"`) — fully built, decision-logged, its own narrower
    single-Claude-call pipeline (org profile + KB + proven narratives, no RAG/logic-model/budget
    integration), designed as the terminal link of the AG-17→AG-15→AG-06 chain. Never
    instantiated by anything; `agent_type` `"ag-05-draft"` is not a valid enum value (1.2); its
    intended chain producers (`ProbabilityScoringAgent`, `EligibilityScoringAgent`) enqueue
    `"ag-05-draft"` as an `agent_id`, but `routeQueueItem()` has no case for that literal (1.3) —
    doubly unreachable.

**Autonomous Mode**
- **Status:** ENABLED (via the live `generateDraft()` path)
- **Trigger Type:** schedule + chain + manual
- **Trigger Condition:** nightly, when `org_autonomous_config.auto_draft_enabled = true`, for
  open opportunities with `eligibility_score >= auto_draft_threshold` that don't already have an
  application, capped by `max_auto_drafts_per_night`; also via `agent_queue` item
  `agent_id = 'draft_generation'`.
- **Decision Log:** **none on the live path** — `generateDraft()` predates `agent_decisions` and
  is not wrapped by any `AutonomousAgent`. The only audit trail for an autonomous draft is the
  `applications` row itself (`auto_generated = true`, `pending_review = true`,
  `draft_source = 'autonomous'`) and, if `notify_on_auto_draft` is on, a `draft_review` alert. (The
  dead Generation-2 twin, if reachable, would log a `draft_generated` decision with the computed
  confidence score.)
- **Chain Output:** none on the live path (the dead twin has no further chain target either — it
  is the terminal agent in the AG-17→AG-15→AG-06 design).
- **Hard Limits:** `AUTONOMOUS_HARD_LIMITS.MAX_DRAFTS_PER_NIGHT_DEFAULT` enforced via
  `org_autonomous_config.max_auto_drafts_per_night` (checked against today's `auto_generated=true`
  application count before drafting); **every** autonomously created application is
  unconditionally `pending_review = true` and `auto_generated = true` regardless of confidence
  score; never sets `submitted_at`; never calls AutoApply.
- **Human Review Required:** **yes, always** — `pending_review = true` is set unconditionally on
  every autonomously created application, not gated on confidence. Reviewable at
  `/draft-generator/autonomous`.

---

### AG-07: Learning Agent

- **Purpose:** Analyzes awarded/denied outcomes, extracts proven narrative patterns, sets
  `knowledge_base.is_proven` / `proven_count`.
- **Type:** Deterministic pattern extraction (BaseAgent pattern; may use Claude for narrative
  extraction — see file for exact split).
- **Model:** claude-sonnet-4-6 (partial).
- **Tokens:** varies.
- **Tier Gate:** starter.
- **Real implementation:** `src/lib/agents/recursive-learning.ts`, `agentType:
  "recursive_learning"`. Confirmed (via `outcome-analyzer-agent.ts`'s own header, which
  deliberately avoids duplicating this write) to run automatically on every `outcomes` insert.

**Autonomous Mode**
- **Status:** ENABLED
- **Trigger Type:** event
- **Trigger Condition:** fires on every `outcomes` table insert (award/denial recorded).
- **Decision Log:** none (BaseAgent pattern) — writes directly to
  `knowledge_base.is_proven` / `proven_count` at `PROVEN_NARRATIVE_THRESHOLD = 2`
  (`src/lib/utils/constants.ts`).
- **Chain Output:** none.
- **Hard Limits:** sole writer of `knowledge_base.is_proven`/`proven_count` — no other agent may
  write these columns (Behavioral Contracts §8/§10; a manual toggle in the KB UI can also flip
  `is_proven` by design, which intentionally overrides this agent — see project memory
  `benavora-manual-proven-toggle-overrides-agent`).
- **Human Review Required:** no.

---

### AG-08: NOFA Parser Agent

- **Purpose:** Parses Notice of Funding Availability documents from federal sources into
  structured opportunity fields.
- **Type:** AI (Claude), BaseAgent pattern.
- **Model:** claude-sonnet-4-6.
- **Tokens:** varies by document length.
- **Tier Gate:** professional.
- **Real implementation:** `src/lib/agents/nofa-parser.ts`, `agentType: "government_research"`
  (shares its `agent_type` with other research scrapers rather than having its own).

> **Numbering note:** the on-disk string `"ag-08-renewal-tracker"` does **not** belong to this
> agent — it is `RenewalTrackerAgent`'s `agentId`, a completely unrelated, currently-live monthly
> renewal-detection agent. See 1.4.

**Autonomous Mode**
- **Status:** NOT_APPLICABLE
- **Trigger Type:** chain (internal to the research/import pipeline; invoked when a NOFA document
  URL is part of a discovered opportunity, not independently scheduled)
- **Trigger Condition:** n/a
- **Decision Log:** none (BaseAgent pattern)
- **Chain Output:** none — feeds structured fields back to the calling research flow
- **Hard Limits:** never fabricates a field it can't extract from the document; leaves it null
  rather than guessing.
- **Human Review Required:** no.

---

### AG-09: Email Parser Agent

- **Purpose:** Parses incoming grant-related emails, extracts deadlines and action items.
- **Type:** AI (Claude), BaseAgent pattern.
- **Model:** claude-sonnet-4-6.
- **Tokens:** varies.
- **Tier Gate:** professional.
- **Real implementation:** `src/lib/agents/email-parser.ts`, `agentType: "email_parser"`. Tier 3
  "Email Parsing Agent" — BUILT per `FEATURE_REGISTRY_v2.md` #38.

> **Numbering note:** the on-disk string `"ag-09-outcome-analyzer"` does **not** belong to this
> agent — it is `OutcomeAnalyzerAgent`'s `agentId` (a currently-live, weekly, unrelated agent).
> See 1.4.

**Autonomous Mode**
- **Status:** ENABLED
- **Trigger Type:** event
- **Trigger Condition:** fires on inbound email received (via the platform's email ingestion
  route — see `src/app/api/agents/email-parser/route.ts`).
- **Decision Log:** none (BaseAgent pattern).
- **Chain Output:** none confirmed.
- **Hard Limits:** never auto-creates a deadline without a parseable date in the email body;
  flags ambiguous dates for human confirmation rather than guessing.
- **Human Review Required:** no for extraction; yes implicitly for any deadline it creates
  (surfaced on the deadlines page, not auto-completed).

---

### AG-10: Grant DNA Analysis Agent

- **Purpose:** Analyzes grant requirements and produces a structured "DNA profile" of what a
  funder tends to require/reward.
- **Type:** not determined — no matching file found.
- **Model:** n/a.
- **Tokens:** n/a.
- **Tier Gate:** professional (as originally scoped).
- **Real implementation:** none found in `src/lib/agents/`. Not listed as BUILT/PARTIAL/IN BUILD
  in `FEATURE_REGISTRY_v2.md` either — appears to have never been started.

> **Numbering note:** the on-disk string `"ag-10-document-expiry"` does **not** belong to this
> agent — it is `DocumentExpiryAgent`'s `agentId` (a currently-live, nightly, unrelated agent).
> See 1.4.

**Autonomous Mode**
- **Status:** PLANNED
- **Trigger Type:** — (not designed yet)
- **Trigger Condition:** —
- **Decision Log:** —
- **Chain Output:** —
- **Hard Limits:** the global hard limits (Section 0) would apply to any future implementation.
- **Human Review Required:** undetermined.

---

### AG-11: Cold Outreach Agent

- **Purpose:** Extracts contacts from companies without a public giving page; generates
  personalized cold-outreach sequences.
- **Type:** AI (Claude), BaseAgent pattern.
- **Model:** claude-sonnet-4-6.
- **Tokens:** varies.
- **Tier Gate:** starter.
- **Real implementation:** `src/lib/agents/cold-outreach.ts`, `agentType: "cold_outreach"`. Phase
  1 "Cold Outreach" — BUILT per `FEATURE_REGISTRY_v2.md` #15.

> **Numbering note:** the on-disk string `"ag-11-knowledge-gap"` does **not** belong to this
> agent — it is `KnowledgeGapAgent`'s `agentId` (a currently-live, weekly, unrelated agent). See
> 1.4.

**Autonomous Mode**
- **Status:** NOT_APPLICABLE
- **Trigger Type:** manual-only — user-initiated from the Sales Outreach / Donor Discovery UI.
- **Trigger Condition:** n/a
- **Decision Log:** none (BaseAgent pattern).
- **Chain Output:** none.
- **Hard Limits:** `AUTONOMOUS_HARD_LIMITS.NEVER_SEND_EMAIL_WITHOUT_APPROVAL` — generates draft
  outreach only; sending is a separate, explicit user action.
- **Human Review Required:** yes (every generated message is reviewed/edited before send).

---

### AG-12: AutoApply Agent

- **Purpose:** Stealth browser automation for grant-portal form detection, filling, and
  submission, with a mandatory human approval checkpoint before final submit.
- **Type:** AI (Claude, for form field mapping) + Playwright browser automation.
- **Model:** claude-sonnet-4-6.
- **Tokens:** varies.
- **Tier Gate:** professional.
- **Real implementation:** `src/lib/agents/browser-automation.ts`
  (`agentType: "browser_automation"`), `form-analyzer.ts` (`"form_analyzer"`),
  `form-filler.ts` (`"form_filler"`), `playwright-agent.ts` (`"browser_automation"`), driven by
  `worker/queue-processor.ts` polling `submission_queue`, plus the daily
  `/api/cron/autoapply` Vercel cron (`vercel.json`: `0 2 * * *`).

**Autonomous Mode**
- **Status:** ENABLED
- **Trigger Type:** schedule + queue
- **Trigger Condition:** `submission_queue` rows with `status = 'pending'`, polled continuously by
  `worker/queue-processor.ts`; also seeded daily by `/api/cron/autoapply`.
- **Decision Log:** none (BaseAgent pattern; per-session state lives in `submission_queue`, not
  `agent_decisions`).
- **Chain Output:** none.
- **Hard Limits:** `AUTONOMOUS_HARD_LIMITS.NEVER_SUBMIT_EXTERNALLY` is enforced structurally —
  every session that reaches the final submit step sets `requires_human_approval = true` and
  `status = 'needs_review'`, pausing until `PATCH /api/agents/automation/[sessionId]/approve` is
  called by a human (`WORKER_ARCHITECTURE_v2.md` §5). CAPTCHAs resembling security challenges
  (account lockout warnings, unusual patterns) are never auto-solved even if a solver is
  configured (`BEHAVIORAL_CONTRACTS.md` §24).
- **Human Review Required:** yes, always, before the final submission click — this is the one
  point in the entire agent system where a human gate is structurally mandatory rather than
  confidence-gated.

---

### AG-13: Foundation Enrichment Agent

- **Purpose:** Enriches `foundation_directory` records (133K+) from ProPublica 990 data and other
  sources.
- **Type:** AI (Claude) + external API (ProPublica), BaseAgent pattern.
- **Model:** claude-sonnet-4-6.
- **Tokens:** varies.
- **Tier Gate:** professional.
- **Real implementation:** `src/lib/agents/propublica.ts` (`agentType: "propublica_mining"`) plus
  `scripts/enrich-foundations-990.ts` and `scripts/enrich-propublica-batch.ts`. Confirmed BUILT
  but, per `FEATURE_REGISTRY_v2.md` #55/D3, **never run against the full foundation set** — CLI
  scripts only. `WORKER_ARCHITECTURE_v2.md` describes a continuous `worker/enrichment-processor.ts`
  poll loop for this; that file does not exist anywhere in `worker/` — confirmed absent from the
  directory listing and from `worker/index.ts`'s imports.

**Autonomous Mode**
- **Status:** PLANNED
- **Trigger Type:** manual CLI script only (`pnpm tsx scripts/enrich-foundations-990.ts`, run by a
  human, not by any scheduler or queue processor)
- **Trigger Condition:** none — no autonomous trigger exists
- **Decision Log:** none (BaseAgent pattern; CLI scripts don't even create `agent_runs` rows in
  every case — verify per script before relying on run history)
- **Chain Output:** none.
- **Hard Limits:** the documented `350ms` ProPublica rate limit (`WORKER_ARCHITECTURE_v2.md` §10)
  applies whenever the script is run; never overwrites existing `enrichment` jsonb fields, merges
  only.
- **Human Review Required:** no (enrichment data, not a decision).

---

### AG-14: Donor Discovery Agent

- **Purpose:** Discovers and scores corporate donor prospects via Google Places + enrichment
  pipeline, per user-submitted discovery request.
- **Type:** Deterministic (Google Places adapter) + AI (Claude, scoring).
- **Model:** claude-sonnet-4-6.
- **Tokens:** varies.
- **Tier Gate:** professional.
- **Real implementation:** `worker/dd-request-processor.ts`, started unconditionally in
  `worker/index.ts` (`ddRequestProcessor.start(supabase)`), polling `donor_discovery_requests`.

**Autonomous Mode**
- **Status:** ENABLED
- **Trigger Type:** event
- **Trigger Condition:** a new `donor_discovery_requests` row (user submits a discovery search
  via `/donor-discovery/discover`), continuously polled by the live worker process.
- **Decision Log:** none — this is a processor loop, not a `BaseAgent`/`AutonomousAgent` subclass;
  progress is tracked on the `donor_discovery_requests` row itself (`status`,
  `prospects_found`).
- **Chain Output:** none.
- **Hard Limits:** respects the NAICS-code-to-search-query mapping in
  `src/lib/donor-discovery/naics-labels.ts` (see project memory
  `benavora-acquireFromGooglePlaces-ignores-custom-query` for a known scoping gap on unmapped
  codes); never contacts a discovered prospect directly — discovery only.
- **Human Review Required:** no (prospects are surfaced for a human to review/route to
  AutoApply or email campaign).

---

### AG-15: Grant Probability Agent

- **Purpose:** Computes an 11-factor probability score (0–100) for every opportunity, with
  confidence, factor breakdown, and recommendation.
- **Type:** AI (Claude).
- **Model:** claude-sonnet-4-6.
- **Tokens:** ~3,000 input / 1,500 output (per original spec; not independently re-verified for
  the live function).
- **Tier Gate:** professional.
- **Real implementation — a live scoring function with no live autonomous wrapper:**
  - **Live:** `src/lib/intelligence/grant-probability-engine.ts`, `computeGrantProbability()` —
    a plain function that itself upserts `opportunity_probability_scores`. Used by the manual
    `/api/intelligence/grant-probability` route and the CLI script
    `scripts/batch-score-opportunities.ts`. Writes no `agent_runs`/`agent_decisions` row.
  - **Dead:** `src/lib/agents/probability-scoring-agent.ts`, `ProbabilityScoringAgent`
    (AutonomousAgent, `agentId: "ag-15-probability"`) — the only code that would call
    `computeGrantProbability()` autonomously (nightly for stale/unscored opportunities, or on a
    chained batch from AG-17/AG-02), then chain into AG-06 above the org's `auto_draft_threshold`.
    Never instantiated by anything; `agent_type` `"ag-15-probability"` is not a valid enum value
    (1.2); and even if it were queued by AG-17 or AG-02, `routeQueueItem()` has no case for
    `'ag-15-probability'` (1.3) — it is unreachable by every available path.

**Autonomous Mode**
- **Status:** PLANNED
- **Trigger Type:** designed as chain (from AG-17/AG-02) + schedule (nightly, stale-score sweep);
  none of these paths currently reach the code.
- **Trigger Condition (as designed, not live):** chain — `agent_queue` item
  `agent_id = 'ag-15-probability'`, `input_payload.opportunityIds`; schedule — any open
  opportunity with no score row or one older than 7 days (`STALE_AFTER_DAYS = 7`).
- **Decision Log (as designed):** `probability_scored`, `confidence_score` = the computed 0–100
  score.
- **Chain Output (as designed):** `ag-05-draft` (DraftGenerationAgent) when
  `score >= org_autonomous_config.auto_draft_threshold` and `auto_draft_enabled` — itself
  unreachable (1.3).
- **Hard Limits (as designed):** none beyond the global hard limits — this agent only scores and
  chains, never creates an application itself.
- **Human Review Required:** no (scoring only; the chained draft, if it ever fired, would carry
  its own mandatory review gate — see AG-06).

---

### AG-16: Digital Twin Builder Agent

- **Purpose:** Constructs and maintains an AI model of the organization (mission, programs,
  financial profile, board, proven narrative patterns) from Knowledge Base + outcomes + org
  profile.
- **Type:** AI (Claude).
- **Model:** claude-sonnet-4-6.
- **Tokens:** ~8,000 input / 4,000 output (per original spec).
- **Tier Gate:** professional.
- **Real implementation:** `src/lib/intelligence/digital-twin-builder.ts` (per
  `FEATURE_REGISTRY_v2.md` #107, "IN BUILD"). Not imported anywhere in `worker/` — no scheduler
  entry, no queue case. `agent-registry-seed.ts` lists `ag-16` with `schedule_cron: "0 2 1 * *"`
  (monthly), but that is Agent Marketplace *metadata only* — `worker/scheduler.ts` has exactly 2
  fixed jobs (nightly pipeline at 2 AM, digest at 7 AM) and does not read `agent_registry` cron
  expressions at all.

**Autonomous Mode**
- **Status:** PLANNED
- **Trigger Type:** none live; `agent_registry` metadata claims monthly schedule, unenforced.
- **Trigger Condition:** none live.
- **Decision Log:** none.
- **Chain Output:** none.
- **Hard Limits:** would need to respect `AUTONOMOUS_HARD_LIMITS.NEVER_MODIFY_GOVERNANCE_FILES` —
  n/a, this agent only writes `organizational_digital_twins`.
- **Human Review Required:** no (profile synthesis, not a decision).

---

### AG-17: Opportunity Discovery Agent

- **Purpose:** Autonomous nightly discovery of new funding opportunities across Grants.gov,
  SAM.gov, and Federal Register, scoped to the org's active `search_profiles`.
- **Type:** Deterministic API polling + AutonomousAgent decision logging.
- **Model:** none directly (no Claude call in the discovery path itself).
- **Tokens:** n/a.
- **Tier Gate:** professional.
- **Real implementation:** `src/lib/agents/opportunity-discovery-agent.ts`,
  `OpportunityDiscoveryAgent` (AutonomousAgent, `agentId: "ag-17-discovery"`), plus a thin
  functional wrapper `runOpportunityDiscovery()` at the bottom of the same file
  ("preserving the pre-existing call site" per its own comment). **Wired into two live call
  sites:** `worker/autonomous-orchestrator.ts`'s nightly `runDiscoveryStep()` (gated on
  `auto_research_enabled`) and `agent_queue` case `'opportunity_discovery'`.

**Autonomous Mode**
- **Status:** ENABLED — **BLOCKED at runtime, see 1.2.** Every invocation calls `startRun()`,
  which inserts `agent_type = 'ag-17-discovery'`; that value is not in the `agent_type` enum, so
  the insert throws before any Grants.gov/SAM.gov/Federal-Register call is made. The exception is
  caught by the calling step's own `try/catch` and logged as a failure string — it does not crash
  the nightly pipeline, but this agent has never successfully completed a run against the live
  schema.
- **Trigger Type:** schedule + manual
- **Trigger Condition:** nightly, when `org_autonomous_config.auto_research_enabled = true`, for
  every active `search_profiles` row; also on-demand via `agent_queue` item
  `agent_id = 'opportunity_discovery'` or the manual `/api/agents/discovery/route.ts` route.
- **Decision Log:** `opportunity_discovered` per new opportunity inserted (`confidenceScore: 85`
  hardcoded — this agent does not compute a real confidence value, it always logs 85). **Never
  actually written today** — blocked before this line by the `startRun()` failure above.
- **Chain Output:** `ag-15-probability` (ProbabilityScoringAgent) when
  `auto_score_enabled = true` and new opportunities were found. Unreachable even if this agent's
  own enum block were fixed — see 1.3.
- **Hard Limits:** dedup by exact opportunity name + URL before insert (`existsInOpportunities()`)
  — never creates a duplicate opportunity row.
- **Human Review Required:** no (discovered opportunities are surfaced, not auto-applied to).

---

### AG-18: Reputation Intelligence Agent

- **Purpose:** Monitors funders for legal issues, leadership changes, and financial distress
  signals.
- **Type:** AI (Claude) + external news search.
- **Model:** claude-sonnet-4-6.
- **Tokens:** ~2,000 input / 1,000 output per entity (per original spec).
- **Tier Gate:** professional.
- **Real implementation:** `src/lib/intelligence/reputation-agent.ts`, `checkEntityReputation()`
  — a plain function, writes no `agent_runs`/`agent_decisions` row. Wired into
  `worker/autonomous-orchestrator.ts`'s nightly `runReputationStep()`.

**Autonomous Mode**
- **Status:** ENABLED
- **Trigger Type:** schedule
- **Trigger Condition:** nightly, when `org_autonomous_config.auto_reputation_enabled = true`,
  sampled to `REPUTATION_SAMPLE_SIZE = 5` funders/night (external-search + Claude per entity is
  the single most expensive nightly step, hence the small sample — orchestrator's own comment).
- **Decision Log:** none (plain function) — writes directly to `reputation_signals` and
  `reputation_alerts`; a `critical`/`high` severity signal also raises an immediate `alerts` row.
- **Chain Output:** none.
- **Hard Limits:** never contacts the funder directly; read-only signal detection from public
  search results.
- **Human Review Required:** no (signals are surfaced as alerts; `critical`/`high` severity is
  escalated to an immediate notification rather than waiting for the morning digest).

---

### AG-19: Relationship Builder Agent

- **Purpose:** Nightly synthesis of funder relationship signals into a specific, Claude-written
  engagement recommendation ("what to do and when").
- **Type:** AI (Claude).
- **Model:** claude-sonnet-4-6.
- **Tokens:** varies.
- **Tier Gate:** professional.
- **Real implementation — two agents doing related but distinct work, only the simpler one is
  live:**
  - **Live (simpler):** `src/lib/agents/funder-relationship.ts`, `FunderRelationshipAgent`
    (BaseAgent, `agentType: "funder_relationship"`, enum-valid since migration 033/039) — a
    deterministic event-delta scorer per `BEHAVIORAL_CONTRACTS.md` §26 (award/response/
    denial/etc. each apply a fixed point delta to `funder_relationship_scores`). Wired into
    `agent_queue` case `'funder_relationship'`; explicitly **not** run blind on a nightly sweep
    (orchestrator's own comment: "deterministic score delta for one specific event against one
    funder — no meaningful blind nightly call").
  - **Dead (richer):** `src/lib/agents/relationship-builder-agent.ts`, `RelationshipBuilderAgent`
    (AutonomousAgent, `agentId: "ag-19-relationship"`) — the actual AG-19 concept: a nightly,
    per-funder pass that recomputes score from `relationship_memory` recency/volume, derives
    momentum, and asks Claude for one specific written engagement recommendation, logged as an
    `agent_decisions` row. Never instantiated anywhere. `agent_type` `"ag-19-relationship"` is
    not a valid enum value (1.2).

**Autonomous Mode**
- **Status:** PLANNED (the recommendation-writing agent this document describes). The simpler
  event-delta scorer (`FunderRelationshipAgent`) is separately live under a different class and
  `agent_type` — see AG-19's real-implementation note above; do not conflate the two when
  auditing "is AG-19 running."
- **Trigger Type (as designed):** schedule (nightly, per funder in the org's CRM).
- **Trigger Condition (as designed):** every funder in `funders` for the org, every night.
- **Decision Log (as designed):** one decision per funder with a written recommendation +
  urgency + suggested timing.
- **Chain Output:** none designed.
- **Hard Limits (as designed):** `AUTONOMOUS_HARD_LIMITS.NEVER_SEND_EMAIL_WITHOUT_APPROVAL` —
  recommendations are surfaced text, never sent.
- **Human Review Required:** yes (every recommendation requires a human to act on it; this agent
  never contacts a funder itself).

---

### AG-20: Corporate Giving Detector Agent (EA-01)

- **Purpose:** Analyzes a company website for giving programs and donation forms.
- **Type:** AI (Claude) + web fetch.
- **Model:** claude-sonnet-4-6.
- **Tier Gate:** professional.
- **Real implementation:** none found. `FEATURE_REGISTRY_v2.md` #90 lists "Corporate Enrichment
  Agents EA-01 to EA-10" as PLANNED. `corporate-scraper.ts` exists but implements general
  corporate research (`agentType: "corporate_research"`), not this specific giving-program
  detection task.

**Autonomous Mode**
- **Status:** PLANNED
- **Trigger Type / Condition / Decision Log / Chain Output:** not designed in code.
- **Hard Limits:** the global hard limits (Section 0) would apply.
- **Human Review Required:** undetermined.

---

### AG-21: Executive Biography Analyzer Agent (EA-08)

- **Purpose:** Extracts decision-maker names/titles from a company's leadership page.
- **Type:** AI (Claude) + web fetch.
- **Model:** claude-sonnet-4-6.
- **Tier Gate:** professional.
- **Real implementation:** none found. `FEATURE_REGISTRY_v2.md` #90, same PLANNED bucket as AG-20.

**Autonomous Mode**
- **Status:** PLANNED
- **Trigger Type / Condition / Decision Log / Chain Output:** not designed in code.
- **Hard Limits:** the global hard limits (Section 0) would apply.
- **Human Review Required:** undetermined.

---

### AG-22: Propensity Scoring Agent

- **Purpose:** Computes 10 donation-propensity scores (PS-01–PS-10) per corporate prospect.
- **Type:** AI (Claude).
- **Model:** claude-sonnet-4-6.
- **Tier Gate:** professional.
- **Real implementation:** `worker/batch-scorer.ts` exists in the worker directory but is **not
  imported anywhere in `worker/index.ts`** — it is not part of the live worker boot sequence.
  `FEATURE_REGISTRY_v2.md` #91 lists "Propensity Scoring PS-01 to PS-10" as IN BUILD.
  `agent-registry-seed.ts` lists `ag-22` (`Corporate Propensity Agent`) with
  `schedule_cron: "0 3 * * *"` — Agent Marketplace metadata only, same caveat as AG-16.

**Autonomous Mode**
- **Status:** PLANNED
- **Trigger Type:** none live; registry metadata claims nightly schedule, unenforced (see AG-16's
  note on `agent_registry` cron expressions being decorative, not wired).
- **Trigger Condition:** none live.
- **Decision Log:** unknown — `batch-scorer.ts` not audited as part of this rewrite since it has
  no live call site.
- **Chain Output:** none confirmed.
- **Hard Limits:** the global hard limits (Section 0) would apply.
- **Human Review Required:** no (scoring only, per original spec).

---

### AG-23: Relationship Mapper Agent (RA-01)

- **Purpose:** Discovers relationships between businesses, foundations, board members, and
  nonprofits; populates `pig_nodes`/`pig_edges`.
- **Type:** AI (Claude).
- **Tier Gate:** enterprise.
- **Real implementation:** none found. `FEATURE_REGISTRY_v2.md` #80 lists this as PLANNED (Phase
  3). `agent-registry-seed.ts` lists `ag-23` with a weekly Sunday cron — metadata only.

**Autonomous Mode**
- **Status:** PLANNED
- **Trigger Type / Condition / Decision Log / Chain Output:** not designed in code.
- **Hard Limits:** the global hard limits (Section 0) would apply.
- **Human Review Required:** undetermined.

---

### AG-24: Personalized Outreach Generator Agent

- **Purpose:** Generates AI-individualized outreach emails for corporate prospects, referencing
  specific known facts about each company.
- **Type:** AI (Claude).
- **Tier Gate:** professional.
- **Real implementation:** none found under this exact scope. The closest live analog is AG-11
  (Cold Outreach Agent, `cold-outreach.ts`), which already generates personalized outreach
  sequences for prospects without a giving page — likely the intended eventual merge point for
  this concept, but not verified as the same code path.

**Autonomous Mode**
- **Status:** PLANNED
- **Trigger Type / Condition / Decision Log / Chain Output:** not designed as a distinct agent in
  code.
- **Hard Limits:** `AUTONOMOUS_HARD_LIMITS.NEVER_SEND_EMAIL_WITHOUT_APPROVAL` — per its own
  original spec: "Never send automatically — always queue for human review first."
- **Human Review Required:** yes, always (per original spec, would apply to any implementation).

---

### AG-25: Disaster Response Agent

- **Purpose:** Polls FEMA disaster declarations; deploys coordinated response (matches affected
  orgs to emergency funding + nearby corporate donors).
- **Type:** Deterministic (FEMA API poll) + AI (Claude, for response deployment).
- **Model:** claude-sonnet-4-6.
- **Tier Gate:** professional.
- **Real implementation:** `src/lib/agents/disaster-response-agent.ts` — two plain functions,
  `pollFEMADeclarations()` and `deployDisasterResponse()`, matching the `sendMorningDigest()`
  pattern (no `agent_type` enum value, no `agent_runs` row, nothing logged). Reachable **only**
  via the manual `/api/agents/disaster/route.ts` API route. No cron entry in `vercel.json`, no
  reference anywhere in `worker/` — despite `WORKER_ARCHITECTURE_v2.md` §4 and the original
  AGENTS_v2.md describing a "poll every 6 hours" schedule and `agent-registry-seed.ts` listing
  `schedule_cron: "0 */6 * * *"` for `ag-25`, none of that is wired into any running process.

> **Numbering note:** the on-disk string `"ag-25-deadline-prediction"` does **not** belong to
> this agent — it is `DeadlinePredictionAgent`'s `agentId` (a completely unrelated, currently
> unreachable, deadline-forecasting agent). This is the single most confusing collision in the
> codebase: a human searching for "AG-25" in `agent_runs`/`agent_queue` data will find
> deadline-prediction rows, not disaster declarations. See 1.4.

**Autonomous Mode**
- **Status:** PLANNED
- **Trigger Type:** manual API route only — no schedule, no queue, no worker wiring exists despite
  being documented elsewhere as a 6-hour poll.
- **Trigger Condition:** none live; a human or external system must call
  `POST /api/agents/disaster/route.ts` for anything to happen.
- **Decision Log:** none (plain functions, no `agent_runs`/`agent_decisions`).
- **Chain Output:** none.
- **Hard Limits:** never auto-submits an emergency application; only surfaces matched funding
  programs and a deployment alert.
- **Human Review Required:** yes (deployment is a summarizing alert for a human to act on, not an
  autonomous submission).

---

### AG-26: Funding Forecast Agent

- **Purpose:** Generates 90-day and 12-month probability-weighted funding forecasts.
- **Type:** AI (Claude).
- **Tier Gate:** professional.
- **Real implementation:** none found. `FEATURE_REGISTRY_v2.md` #131–134 lists this as PLANNED
  (schema `funding_forecasts` IN BUILD). `agent-registry-seed.ts` lists `ag-26` with a monthly
  cron — metadata only.

**Autonomous Mode**
- **Status:** PLANNED
- **Trigger Type / Condition / Decision Log / Chain Output:** not designed in code.
- **Hard Limits:** the global hard limits (Section 0) would apply.
- **Human Review Required:** undetermined.

---

### AG-27: Board Meeting Packet Agent

- **Purpose:** Generates a complete board meeting packet 48 hours before every scheduled meeting.
- **Type:** AI (Claude).
- **Tier Gate:** professional.
- **Real implementation:** none found. `FEATURE_REGISTRY_v2.md` #135–139 lists this as PLANNED;
  schema (`board_members`, `board_meetings`, `board_meeting_packets`) is IN BUILD.
  `agent-registry-seed.ts` lists `ag-27` as event-triggered — metadata only, no code.

**Autonomous Mode**
- **Status:** PLANNED
- **Trigger Type / Condition / Decision Log / Chain Output:** not designed in code.
- **Hard Limits:** the global hard limits (Section 0) would apply.
- **Human Review Required:** undetermined (original spec implies notify-only, not submit-capable).

---

### AG-28: Impact Simulation Agent

- **Purpose:** Models what-if strategic scenarios (financial, capacity, beneficiary impact) before
  a decision is made.
- **Type:** AI (Claude).
- **Tier Gate:** enterprise.
- **Real implementation:** none found. `FEATURE_REGISTRY_v2.md` #140–142 lists this as PLANNED;
  schema (`impact_simulations`) is IN BUILD.

> **Numbering note:** the on-disk string `"ag-28-followup"` does **not** belong to this agent —
> it is `FollowupGeneratorAgent`'s `agentId` (a currently-live, event-driven, unrelated
> follow-up-scheduling agent — see its real spec in the cross-reference table, Section 4, and
> 1.4). Do not confuse the two when auditing `agent_queue`/`agent_runs` data for "AG-28 activity."

**Autonomous Mode**
- **Status:** PLANNED
- **Trigger Type / Condition / Decision Log / Chain Output:** not designed in code.
- **Hard Limits:** the global hard limits (Section 0) would apply; never overwrites live
  financial/pipeline data — a simulation is a read-only projection by definition.
- **Human Review Required:** no (a simulation result is inherently advisory).

---

### AG-29: Knowledge Engine Indexer Agent

- **Purpose:** Continuously generates and stores pgvector embeddings for
  `intelligence_funded_proposals`, `outcomes`, and `foundation_directory` records, and aggregates
  `knowledge_patterns`.
- **Type:** Embedding model (not Claude — `text-embedding-3-small` or equivalent per original
  spec).
- **Tier Gate:** professional.
- **Real implementation:** none found. `FEATURE_REGISTRY_v2.md` #170 lists this as PLANNED;
  schema (`knowledge_patterns`, `intelligence_funded_proposals.embedding`) is IN BUILD. Not
  referenced anywhere in `worker/`.

**Autonomous Mode**
- **Status:** PLANNED
- **Trigger Type / Condition / Decision Log / Chain Output:** not designed in code.
- **Hard Limits:** the global hard limits (Section 0) would apply.
- **Human Review Required:** no (indexing only).

---

### AG-30: Change Monitor Agent (CM-01)

- **Purpose:** Detects changes in monitored corporate entities (website, leadership, IRS BMF
  status) and triggers re-enrichment.
- **Type:** AI (Claude) + web diff.
- **Tier Gate:** enterprise.
- **Real implementation:** none found. `FEATURE_REGISTRY_v2.md` #96 lists this as PLANNED.

**Autonomous Mode**
- **Status:** PLANNED
- **Trigger Type / Condition / Decision Log / Chain Output:** not designed in code.
- **Hard Limits:** the global hard limits (Section 0) would apply.
- **Human Review Required:** undetermined.

---

## 6. Agent Registry Schema (unchanged — still the applied schema)

```sql
CREATE TABLE agent_registry (
  agent_id text PRIMARY KEY,
  name text NOT NULL,
  description text NOT NULL,
  version text DEFAULT '1.0',
  plan_requirement text NOT NULL,
  trigger_type text NOT NULL,
  schedule_cron text,
  avg_runtime_seconds integer,
  avg_tokens_per_run integer,
  active boolean DEFAULT true,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE agent_configurations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL,
  agent_id text REFERENCES agent_registry(agent_id),
  enabled boolean DEFAULT false,
  config jsonb DEFAULT '{}',
  last_run_at timestamptz,
  run_count integer DEFAULT 0,
  total_tokens_consumed integer DEFAULT 0,
  created_at timestamptz DEFAULT now(),
  UNIQUE(org_id, agent_id)
);
```

**Note:** `agent_registry.agent_id` (Agent Marketplace, `ag-01`…`ag-28` per
`agent-registry-seed.ts`) is a *third*, mostly-decorative numbering surface — its
`schedule_cron` values are display metadata for the Settings → Agent Marketplace UI and are
**not read by `worker/scheduler.ts`**, which has exactly two fixed cron jobs (nightly pipeline,
morning digest). Toggling an agent "on" in the Marketplace UI writes `agent_configurations.enabled`
but does not, by itself, cause anything to run on the claimed schedule unless that agent is also
one of the six live Generation-2 classes wired into `runOrgPipeline()`, or a Generation-1 agent
wired into a real cron/queue path described in Section 5 above.

The real, load-bearing autonomy toggles are `org_autonomous_config`'s seven `auto_*_enabled`
booleans (migration 080) plus `auto_draft_threshold` and `max_auto_drafts_per_night`, editable at
`/settings` → autonomous settings panel, not `agent_configurations`.

## 7. Autonomous Trigger Infrastructure — where it actually runs

```
worker/index.ts (Railway worker process)
  |-- scheduler.start(supabase)              -- 2 fixed jobs, America/Chicago:
  |     |-- 02:00  runAutonomousPipeline()    -- worker/autonomous-orchestrator.ts
  |     |           for each active org (onboarding_completed=true AND
  |     |           subscriptions.status IN ('active','trialing')):
  |     |             if auto_research_enabled:           AG-17 (blocked, 1.2)
  |     |             if auto_score_enabled:               AG-02, then success_probability
  |     |                                                  (application-keyed -- NOT the same
  |     |                                                  engine as AG-15's opportunity-keyed one)
  |     |             if auto_draft_enabled:               AG-06 (live)
  |     |             if auto_reputation_enabled:           AG-18 (live)
  |     |             if auto_deadline_prediction_enabled: Deadline Prediction (Gen-1, live,
  |     |                                                  NOT AG-25/AG-26 -- see AG-25's note)
  |     |             unconditionally:                     Document Expiry (nightly)
  |     |             on 1st of month (America/Chicago):   Renewal Tracker, Search Profile Optimizer
  |     |             on Sunday (America/Chicago):         Outcome Analyzer, Knowledge Gap
  |     `-- 07:00  runDigestPipeline()        -- AutonomousDigestAgent per active org (blocked, 1.2)
  |-- processAgentQueue(supabase)             -- continuous poll of `agent_queue`
  |     claimNextQueueItem() -> routeQueueItem() switch on agent_id:
  |       'opportunity_discovery' | 'eligibility_scoring' | 'success_probability' |
  |       'deadline_extraction' | 'compliance_check' | 'budget_builder' |
  |       'follow_up_generator' | 'funder_relationship' | 'deadline_prediction' |
  |       'draft_generation' | 'reputation' | 'morning_digest' | 'ag-28-followup'
  |       -- NOT recognized: 'ag-15-probability', 'ag-05-draft' (1.3)
  |-- queueProcessor.start(...)               -- `submission_queue` (AutoApply, AG-12), unrelated system
  `-- ddRequestProcessor.start(supabase)      -- `donor_discovery_requests` (AG-14)
```

`POST /api/autonomous/trigger` lets a user manually enqueue any `agent_id` string into
`agent_queue` at priority 9 — this includes agent IDs that `routeQueueItem()` doesn't recognize,
which will queue, claim, fail, retry 3x, and land in `failed` with a visible
`Unknown agent_queue agent_id` error message, visible on `/settings` autonomous decision log
(`/api/autonomous/decisions`, `/api/autonomous/queue`).

---

## Phase 2-5 Agent Specifications (Planned)

Every agent below is scoped in `AUTONOMOUS_PLATFORM_VISION.md` (Phases 2-5) and/or
`FEATURE_REGISTRY_v2.md` features 217-228. **None of these agents exist in `src/lib/agents/` today**
??? no file, no class, no `agent_type`/`agent_id` literal, no migration beyond what Section 6's schema
tables already define for the handful that reuse Phase 1 tables (`impact_simulations`,
`board_meeting_packets`). Every field below is a design commitment carried over from
`AUTONOMOUS_PLATFORM_VISION.md` ??7's FORGE queue blueprint table, not a live call site. Treat this
section the same way Section 5 treats AG-10/AG-20/AG-21/AG-23/AG-26/AG-27/AG-29/AG-30: PLANNED means
PLANNED, and nothing here should be read as "wired" until a future edition of this document says so
from an actual audit of `src/lib/agents/` and `worker/`.

**Numbering note ??? read before cross-referencing against `AUTONOMOUS_PLATFORM_VISION.md`:** the
task that produced this section numbered the twelve agents below AG-29 through AG-40 sequentially in
request order. `AUTONOMOUS_PLATFORM_VISION.md` ??7's own blueprint tables independently assign new
agent numbers to roughly the same feature set, and the two schemes disagree on five of twelve:

| This section | Feature | `AUTONOMOUS_PLATFORM_VISION.md` ??7 calls it |
|---|---|---|
| AG-29 | Fundability Scorer | No new number ??? "Extend AG-15; new narrow-mode AG-06 invocation" |
| AG-30 | Donor Intent Monitor | **AG-31** (Donor Intent Agent) |
| AG-31 | National Forecast Agent | **AG-32** (National Forecast Agent) |
| AG-32 | Relationship Graph Builder | No new number ??? "Extends AG-23 (Relationship Mapper)" |
| AG-36 | Learning Network Aggregator | No new number ??? "Extends AG-29" (Knowledge Engine Indexer) |
| AG-37 | Simulation Agent | No new number ??? "Extends AG-28" (Impact Simulation Agent); the vision doc's own **AG-37** is Multi-Agent Negotiation, not this |
| AG-38 | Self-Improvement Agent | Vision doc calls this **AG-36** (Autonomous Continuous Improvement Engine); the vision doc's own **AG-38** is Community Resource Graph, not this |

**AG-29 is additionally a hard collision, not just a cross-doc mismatch:** Section 5 of this same
document already defines **AG-29 as the Knowledge Engine Indexer Agent** (embedding model, pgvector,
`text-embedding-3-small`, PLANNED, Pillar 18). This section's AG-29 (Fundability Scorer) is a
completely different agent that happens to reuse the same number because it was next-free in this
task's sequential numbering rather than checked against Section 5's existing roster. Do not write
`agent_type = 'ag-29'` into any future schema or code for either agent without first resolving this
collision ??? follow the precedent of Section 1.4/4 above (real code wins, doc numbering is
descriptive, not authoritative) and renumber one of the two before implementation.

The specs below use the task-assigned AG-29???AG-40 numbers as headers for traceability to the request
that produced them; each spec's Dependencies line states the correct source agent(s) per
`AUTONOMOUS_PLATFORM_VISION.md` ??7 so the collision above doesn't propagate into a wrong build.

---

### AG-29: Fundability Scorer

- **Phase:** 2
- **Status:** PLANNED
- **Purpose:** Extends the Grant Probability Engine's bare 0-100 score into a diagnostic tool by
  decomposing any below-threshold score into the specific deficiency behind it (weak mission-fit
  language, incomplete budget history, missing logic model, Digital Twin gaps). Where the
  deficiency is a KB/Twin completeness gap rather than a structural mismatch, it offers a one-click
  auto-fix that queues a targeted KB entry for human approval rather than auto-publishing it.
- **Type:** analysis
- **Model:** claude-sonnet-4-6
- **Estimated tokens per run:** ~3,500 input (opportunity + existing 11-factor breakdown + KB
  index) / ~1,200 output (deficiency array + remediation text) per opportunity scored.
- **Tier gate:** professional (extends AG-15, itself professional-gated).
- **Trigger:** chain ??? fires whenever `grant-probability-engine.ts` computes a score below the
  org's `auto_draft_threshold` / apply recommendation cutoff; also callable on-demand from the
  opportunity detail page's factor breakdown UI.
- **Input sources:** `opportunity_probability_scores` (existing 11-factor breakdown),
  `organizational_digital_twins`, `knowledge_base_entries`, `applications.compliance_check_result`.
- **Output:** `opportunity_probability_scores.deficiencies` (jsonb array of
  `{factor_name, current_value, target_value, fix_type, auto_fixable}`); for `kb_gap`-type
  deficiencies, a `fundability_autofix_runs` row with `generated_content` awaiting approval.
- **Chains to:** AG-06 (Draft Generator Agent) in narrow mode, to draft the missing KB entry only
  ??? never to draft the application narrative itself.
- **Hard limits:** never auto-publishes a generated KB entry ??? every `fundability_autofix_runs` row
  is `status = 'pending'` until a human approves it; never overrides a `structural` deficiency
  (funder/geography/mission mismatch) as if it were fixable ??? those are reported, not auto-fixed.
- **Dependencies:** requires AG-15 (Grant Probability Agent) actually reachable in production first
  ??? currently blocked by the `agent_type` enum gap (??1.2) and the `routeQueueItem()` chain gap
  (??1.3). Building AG-29 against a AG-15 that has never successfully completed a run would have no
  real score to decompose.
- **FORGE queue:** not yet scoped into a `queue.yaml`. Blueprint only exists in
  `AUTONOMOUS_PLATFORM_VISION.md` ??7 ("Fundability Intelligence Score" row, Phase 2 table):
  schema migration (alter `opportunity_probability_scores`, add `fundability_autofix_runs`),
  `/api/intelligence/grant-probability/auto-fix` route, opportunity detail UI badge.

---

### AG-30: Donor Intent Monitor

- **Phase:** 2
- **Status:** PLANNED
- **Purpose:** Continuously monitors press releases, CSR/ESG reports, SEC filings, hiring-trend
  deltas, and facility-expansion signals for corporate prospects and foundations, and scores the
  probability that each entity announces a giving initiative in the next 30-90 days. Moves
  Reputation Intelligence (AG-18) and the Relationship Builder concept (AG-19) from reactive
  (detecting a scandal after it's public) to predictive (detecting intent before an announcement).
- **Type:** monitoring
- **Model:** claude-sonnet-4-6
- **Estimated tokens per run:** ~2,000 input / ~800 output per entity (per
  `AUTONOMOUS_PLATFORM_VISION.md`'s own estimate for the reputation-agent pattern it extends);
  batch-processed nightly, not per-org.
- **Tier gate:** professional (extends AG-18/AG-20/AG-21, all professional-gated corporate
  intelligence agents).
- **Trigger:** schedule ??? nightly, as a new step in `worker/enrichment-processor.ts`'s
  `runCorporateEnrichmentBatch()`.
- **Input sources:** `corporate_prospects.enrichment`, `reputation_signals`,
  `corporate_monitoring_events`, plus new signal feeds not yet built (hiring-trend feed, SEC EDGAR
  full-text search, facility-permit monitoring) ??? see Dependencies.
- **Output:** `donor_intent_scores` (new table: `intent_score` 0-100, `predicted_window`,
  `signal_basis` jsonb array of `{signal_type, weight, evidence, source_url}`, `confidence`).
- **Chains to:** none designed ??? surfaces on the Corporate Intelligence monitoring feed as a
  "Predicted Intent" badge for a human to act on (e.g., route to AG-24/Cold Outreach).
- **Hard limits:** `AUTONOMOUS_HARD_LIMITS.NEVER_SEND_EMAIL_WITHOUT_APPROVAL` ??? a predicted-intent
  badge is a signal, never a trigger for automatic outreach; never asserts intent as fact ??? every
  score carries `confidence` and cites `evidence`/`source_url` per signal.
- **Dependencies:** requires new EA-series enrichment sub-agents (hiring-trend feed, SEC EDGAR
  search, facility-permit monitoring) that don't exist yet ??? AG-20 (Corporate Giving Detector) and
  AG-21 (Executive Biography Analyzer) are themselves still PLANNED with no file found (Section 5).
  AG-30 cannot be built before at least one of its named signal sources exists.
- **FORGE queue:** not yet scoped into a `queue.yaml`. Blueprint in
  `AUTONOMOUS_PLATFORM_VISION.md` ??7 ("AI Donor Intent Engine" row, Phase 2 table): new
  `donor_intent_scores` table, `donor-intent-scorer.ts` module, `/api/intelligence/donor-intent/[prospectId]`
  route, monitoring feed UI badge.

---

### AG-31: National Forecast Agent

- **Phase:** 2
- **Status:** PLANNED
- **Purpose:** Extends the org-level Predictive Funding Forecast (Pillar 11, `funding_forecasts`)
  with a macro-level layer: ingests congressional appropriations bills, FEMA spending patterns, and
  HUD/USDA/state budget cycles to project category-level funding trend direction and magnitude 12
  months out. Surfaces as a leading indicator (e.g. "Texas housing grants projected to increase 18%
  next year") before individual opportunities post to Grants.gov/SAM.gov.
- **Type:** analysis
- **Model:** claude-sonnet-4-6
- **Estimated tokens per run:** ~4,000 input (bill text summaries + historical appropriations
  data per category) / ~1,500 output (trend direction + magnitude + evidence), per category per
  monthly run.
- **Tier gate:** professional (extends AG-26, itself professional-gated).
- **Trigger:** schedule ??? monthly, alongside the existing `runFundingForecast()` slot in
  `worker/scheduler.ts`.
- **Input sources:** Congress.gov bill-tracking API, historical appropriations data per funding
  category, `funding_forecasts` (org-level, for cross-reference).
- **Output:** `market_forecasts` (new table: `category`, `geography`, `forecast_period`,
  `trend_direction`, `trend_magnitude`, `evidence text[]`) ??? distinct from the existing org-scoped
  `funding_forecasts` table.
- **Chains to:** none designed.
- **Hard limits:** never presents a projection as certainty ??? every row carries `evidence` citing
  the specific bill/budget document driving the projection; never advises an org to apply/skip
  based on this alone ??? it is macro context, not a substitute for AG-15's opportunity-level score.
- **Dependencies:** `market_forecasts` is specified in `PLATFORM_VISION_ARCHITECTURE.md` Pillar 11
  but, per `AUTONOMOUS_PLATFORM_VISION.md` ??7 itself, is **not yet present** in
  `SCHEMA_REGISTRY_v2.md` ??? the migration must first reconcile the two documents before this agent
  can write anywhere. AG-26 (Funding Forecast Agent) it extends is itself still PLANNED with no file
  found (Section 5).
- **FORGE queue:** not yet scoped into a `queue.yaml`. Blueprint in
  `AUTONOMOUS_PLATFORM_VISION.md` ??7 ("Predictive National Opportunity Forecasting" row, Phase 2
  table): new `market_forecasts` table, `national-forecast-agent.ts`, monthly scheduler entry,
  `/api/intelligence/market-forecast` route, `/reports/forecast` market-trend panel.

---

### AG-32: Relationship Graph Builder

- **Phase:** 3
- **Status:** PLANNED
- **Purpose:** Discovers and maps relationship edges between corporate entities, foundations, board
  members, and nonprofits ??? board overlaps, alumni networks, shared past employers, family
  foundation ties ??? into `pig_nodes`/`pig_edges`, surfacing warm introduction pathways in place of
  cold outreach. Full build-out of Pillar 1 (Philanthropic Intelligence Graph), including the
  force-directed `/research/graph` explorer and shortest-path finder specified but not yet built.
- **Type:** analysis
- **Model:** claude-sonnet-4-6
- **Estimated tokens per run:** ~2,500 input / ~1,000 output per entity pair evaluated; run as a
  weekly full-graph rebuild rather than per-entity, per `AUTONOMOUS_PLATFORM_VISION.md`'s own
  Phase 3 blueprint ("AG-23 full weekly rebuild").
- **Tier gate:** enterprise (Pillar 1 / PIG is the same enterprise-gated feature AG-23 already
  targets, per `PRD_v2.md` ??12 pricing table).
- **Trigger:** schedule ??? weekly full-graph rebuild.
- **Input sources:** `corporate_relationships`, `corporate_relationship_people`, `funders`,
  `contacts`, `foundation_directory`, `board_members` (org's own board, for self-referencing edges).
- **Output:** `pig_nodes` / `pig_edges` rows (relationship_type values extended beyond the current
  set to cover board-overlap/alumni/family-foundation edges); indexes for graph-query performance.
- **Chains to:** none designed.
- **Hard limits:** never asserts an edge without `evidence`; `verified boolean` defaults false and
  is never silently flipped true without a documented source.
- **Dependencies:** this is explicitly the same agent as AG-23 (Relationship Mapper Agent,
  Section 5), which is itself PLANNED with no file found. `pig_nodes`/`pig_edges` exist (migration
  094, per Section 6 table 59-60) but are unpopulated. Per `AUTONOMOUS_PLATFORM_VISION.md` ??7,
  this feature has **no new agent number** ??? it is an extension of AG-23, not a distinct agent;
  see the Numbering note above before assigning `AG-32` in any schema.
- **FORGE queue:** not yet scoped into a `queue.yaml`. Blueprint in
  `AUTONOMOUS_PLATFORM_VISION.md` ??7, Phase 3 table, two rows: "Corporate Relationship Graph"
  (extends `pig_edges` with new `relationship_type` values, `/api/intelligence/relationship-paths`,
  `/research/graph` node expansion panel) and "Philanthropic Intelligence Graph (full)" (graph-query
  indexes, `/api/intelligence/graph/shortest-path`, `/research/graph` force-directed explorer + PDF
  export).

---

### AG-33: Partnership Discovery Agent

- **Phase:** 3
- **Status:** PLANNED
- **Purpose:** Identifies coalition grant opportunities between nonprofits with complementary
  missions ??? funders that favor multi-org applications, or two orgs whose service areas and
  program types combine to meet a funder's stated priorities. Surfaces potential partner orgs from
  both the Benavora subscriber base and `foundation_directory`/BMF data.
- **Type:** analysis
- **Model:** claude-sonnet-4-6
- **Estimated tokens per run:** ~3,000 input (both orgs' Digital Twins + candidate opportunity) /
  ~1,000 output (match rationale + suggested coalition structure) per candidate pair.
- **Tier gate:** enterprise (net-new Phase 3 relationship-intelligence feature, same tier band as
  AG-32/Pillar 1).
- **Trigger:** schedule ??? designed as a periodic sweep against active `search_profiles` and
  co-located/complementary-mission orgs; exact cadence not specified in
  `AUTONOMOUS_PLATFORM_VISION.md`.
- **Input sources:** `organizational_digital_twins` (own + candidate partner org), `opportunities`
  (coalition-friendly funders), `foundation_directory`, other subscriber orgs' anonymized mission/
  program metadata.
- **Output:** `partnership_matches` (new table, per `AUTONOMOUS_PLATFORM_VISION.md` ??7's Phase 3
  blueprint table).
- **Chains to:** none designed ??? surfaces on `/intelligence/twin` as a partnership suggestions
  panel for a human to initiate contact.
- **Hard limits:** `AUTONOMOUS_HARD_LIMITS.NEVER_SEND_EMAIL_WITHOUT_APPROVAL` ??? never contacts a
  candidate partner org directly; never exposes one subscriber org's non-public Digital Twin detail
  to another org beyond what's needed for a match rationale (cross-org data leakage boundary per
  `PRD_v2.md` ??"Security": "No cross-org data leakage except anonymized aggregate patterns").
- **Dependencies:** requires the Philanthropic Intelligence Graph (AG-32/AG-23) populated first ???
  partnership discovery is described in `AUTONOMOUS_PLATFORM_VISION.md` Phase 3 as building on the
  same relationship-graph substrate. Also requires cross-org anonymization architecture that Phase 5
  (Moat 4) describes as not yet built (`benchmark_aggregates` is explicitly "not yet active").
- **FORGE queue:** not yet scoped into a `queue.yaml`. Blueprint in
  `AUTONOMOUS_PLATFORM_VISION.md` ??7, Phase 3 table: new `partnership_matches` table, new AG-33,
  `/api/intelligence/partnerships` route, partnership suggestions panel on `/intelligence/twin`.

---

### AG-34: Personalization Engine

- **Phase:** 3
- **Status:** PLANNED
- **Purpose:** Adapts the public marketing site and outbound communications by detected visitor/
  donor type ??? corporate executive, church donor, family foundation, government reviewer ??? using
  the same Digital Twin and Corporate Giving DNA data already computed for corporate prospects.
  Not org-scoped in the usual sense: this operates on Benavora's own marketing surface and,
  per-org, on each subscriber's public-facing content.
- **Type:** generation
- **Model:** claude-sonnet-4-6
- **Estimated tokens per run:** ~1,500 input (visitor signal + persona candidates) / ~2,000 output
  (content variant) per persona per page, cached rather than regenerated per visit.
- **Tier gate:** professional (content personalization is a lighter-weight generation feature than
  the enterprise-gated relationship/graph agents in this phase).
- **Trigger:** event ??? fires on detected visitor-type signal (referral source, UTM parameters,
  self-identification in a form) rather than on a schedule.
- **Input sources:** `visitor_personas` (new table, public marketing site, not org-scoped),
  `organizational_digital_twins`, `corporate_prospects.giving_dna` (for corporate-visitor variants).
- **Output:** persona-specific content variants served by the public site's component layer.
- **Chains to:** none designed.
- **Hard limits:** never fabricates a claim about the visiting org/person it hasn't verified; never
  stores personally identifying visitor data beyond what's needed for persona classification
  (privacy boundary implied by `PRD_v2.md` ??"Security" but not explicitly stated for this feature ???
  flag for legal review before build, per this document's own precedent of not guessing on
  ambiguity, CLAUDE.md ??"AUTONOMOUS OPERATION RULES").
- **Dependencies:** `visitor_personas` table does not exist. Corporate Giving DNA
  (`corporate_prospects.giving_dna` jsonb column exists per Section 6 table 36, but per Pillar 3's
  own PLANNED status in `FEATURE_REGISTRY_v2.md` #92, is not yet populated for any real prospect.
- **FORGE queue:** not yet scoped into a `queue.yaml`. Blueprint in
  `AUTONOMOUS_PLATFORM_VISION.md` ??7, Phase 3 table: new `visitor_personas` table, new AG-34,
  `/api/marketing/personalize` route, public site component variants by detected persona.

---

### AG-35: Community Need Predictor

- **Phase:** 3
- **Status:** PLANNED
- **Purpose:** Ingests census data, housing prices, employment trends, eviction filings, weather
  patterns, school enrollment, and migration data to forecast service demand before it materializes.
  Directly extends the Faith Foundation pilot use case (rural Texas emergency/transitional housing)
  ??? anticipating need spikes ahead of a funding cycle rather than reacting to them.
- **Type:** analysis
- **Model:** claude-sonnet-4-6
- **Estimated tokens per run:** ~3,000 input (multi-source signal digest per service area) /
  ~1,200 output (need forecast + confidence + contributing signals) per monitored service area.
- **Tier gate:** enterprise (net-new Phase 3 predictive feature, same tier band as
  AG-32/AG-33/Pillar 1).
- **Trigger:** schedule ??? designed as a periodic (monthly, unconfirmed cadence) sweep per org's
  `service_areas` (from `organizations.service_areas`).
- **Input sources:** census data, housing-price indices, employment-trend data, eviction-filing
  records, weather/disaster data (overlaps `disaster_declarations`), school enrollment data,
  migration data ??? none of these external feeds are currently wired into any ingestion script.
- **Output:** `community_need_signals` (new table, per `AUTONOMOUS_PLATFORM_VISION.md` ??7's Phase 3
  blueprint table).
- **Chains to:** none designed ??? surfaces as a needs-forecast card on the `/intelligence` hub.
- **Hard limits:** never asserts a need forecast without citing its contributing signals and their
  recency; never auto-generates a grant application from a predicted need ??? this is intelligence
  for a human to act on, structurally analogous to AG-25 (Disaster Response)'s "surfaces, never
  submits" pattern.
- **Dependencies:** every listed input source (census, housing, employment, eviction, weather,
  school enrollment, migration) requires a new ingestion adapter ??? none exist today. This is the
  most infrastructure-heavy agent in this section; realistically gated behind building at least 2-3
  of those seven feeds first.
- **FORGE queue:** not yet scoped into a `queue.yaml`. Blueprint in
  `AUTONOMOUS_PLATFORM_VISION.md` ??7, Phase 3 table: new `community_need_signals` table, new AG-35,
  `/api/intelligence/community-need` route, needs forecast card on `/intelligence` hub.

---

### AG-36: Learning Network Aggregator

- **Phase:** 4
- **Status:** PLANNED
- **Purpose:** Anonymizes and aggregates successful grant patterns (language, budget structure,
  narrative, keywords, timing) across every Benavora subscriber org, feeding the results back into
  `knowledge_patterns` so every org's Knowledge Engine (Pillar 18) benefits from outcomes it never
  personally generated. This is Moat 1's compounding mechanism made concrete.
- **Type:** analysis
- **Model:** none directly for the aggregation pass (per `AUTONOMOUS_PLATFORM_VISION.md`'s own
  description of AG-29/Knowledge Engine Indexer using an embedding model, not Claude, for its core
  function) ??? claude-sonnet-4-6 is used only for the pattern-description text written into
  `knowledge_patterns.pattern_description`.
- **Estimated tokens per run:** ~500 output tokens per newly detected pattern (description text
  only); embedding/aggregation cost is not a Claude token cost.
- **Tier gate:** platform-internal ??? this agent writes to the shared `knowledge_patterns` table
  that benefits all tiers indirectly (per Pillar 18's `FKE-05`: "the knowledge engine improves
  automatically as more data is ingested"); it has no standalone org-facing UI or tier gate of its
  own.
- **Trigger:** schedule ??? designed as a nightly aggregation pass, extending AG-29's (Knowledge
  Engine Indexer) existing embedding-population responsibility.
- **Input sources:** `outcomes` (award/denial results across all orgs), `drafts` (content),
  `intelligence_funded_proposals`, `organizational_digital_twins` (structural metadata only, never
  narrative content that could re-identify a specific org).
- **Output:** `knowledge_patterns` rows with `sample_count`/`confidence` incremented as more
  cross-org data accumulates; no client-facing route of its own ??? results surface through the
  existing `/api/intelligence/knowledge-query` and `/intelligence/knowledge` UI.
- **Chains to:** none designed.
- **Hard limits:** `AUTONOMOUS_HARD_LIMITS.NEVER_MODIFY_GOVERNANCE_FILES` (n/a, doesn't touch
  governance files) plus a feature-specific hard limit stated explicitly in
  `AUTONOMOUS_PLATFORM_VISION.md`'s Phase 5 benchmarking design: aggregate tables are
  service-role-only with **no `org_id` in client-facing responses** ??? this agent must never expose
  an org-identifiable pattern back to a different org.
- **Dependencies:** requires AG-29 (Knowledge Engine Indexer Agent, Section 5) built and running
  first ??? that agent is itself PLANNED with no file found, and `intelligence_funded_proposals` has
  only 11 records against a 2,000+ target (per `FEATURE_REGISTRY_v2.md` #166-169 and this document's
  Moat 1 analysis). Per `AUTONOMOUS_PLATFORM_VISION.md` ??7, this feature has **no new agent
  number** ??? it is explicitly "Extends AG-29," not a distinct agent; see the Numbering note above.
- **FORGE queue:** not yet scoped into a `queue.yaml`. Blueprint in
  `AUTONOMOUS_PLATFORM_VISION.md` ??7, Phase 4 table ("Global Learning Network" row): extends
  `knowledge_patterns` with a cross-org aggregation flag, extends AG-29, internal only ??? no
  client-facing route.

---

### AG-37: Simulation Agent

- **Phase:** 4
- **Status:** PLANNED
- **Purpose:** Extends the single-scenario Impact Simulator (AG-28, Section 5) into comparative
  multi-scenario modeling ??? running several what-if scenarios (receive/lose a grant, open a
  location, hire staff, serve more beneficiaries) side by side and projecting revenue, capacity,
  probability, and ROI for each so a board can compare options rather than evaluate one at a time.
- **Type:** analysis
- **Model:** claude-sonnet-4-6
- **Estimated tokens per run:** ~4,000 input (org financial profile + N scenario parameter sets) /
  ~2,500 output (comparative projection table + risk assessment per scenario), scaling with
  scenario count.
- **Tier gate:** enterprise (extends AG-28, itself enterprise-gated per Section 5).
- **Trigger:** manual ??? user-initiated scenario comparison request from `/intelligence/simulate`.
- **Input sources:** `organizational_digital_twins` (financial_profile), `impact_simulations`
  (individual scenario results already computed by AG-28), user-specified scenario parameter sets.
- **Output:** `impact_simulations.scenario_comparison_id` groups multiple individual simulation
  rows into one comparison set; a synthesized comparative summary.
- **Chains to:** none designed.
- **Hard limits:** the global hard limits (Section 0) apply; a simulation is read-only by
  definition ??? never writes to live financial/pipeline data, matching AG-28's own hard limit.
- **Dependencies:** requires AG-28 (Impact Simulation Agent) built first ??? it is itself PLANNED
  with no file found (Section 5), though its schema (`impact_simulations`) exists (migration,
  Section 6 table 67). Per `AUTONOMOUS_PLATFORM_VISION.md` ??7, this feature has **no new agent
  number** ??? it is explicitly "Extends AG-28," not a distinct agent. Note also that the vision
  doc's own **AG-37** names a completely different agent (Autonomous Multi-Agent Negotiation,
  extending AG-12/AutoApply) ??? see the Numbering note above before using "AG-37" in any schema.
- **FORGE queue:** not yet scoped into a `queue.yaml`. Blueprint in
  `AUTONOMOUS_PLATFORM_VISION.md` ??7, Phase 4 table ("Predictive Fundraising Simulator" row):
  extends `impact_simulations` with `scenario_comparison_id`, extends AG-28,
  `/api/intelligence/simulate/compare` route, multi-scenario comparison view on
  `/intelligence/simulate`.

---

### AG-38: Self-Improvement Agent

- **Phase:** 4
- **Status:** PLANNED
- **Purpose:** Nightly meta-agent that reviews every other agent's `agent_runs` outcomes ??? what
  worked, what failed, which agents underperformed, which prompts improved results ??? and proposes
  enhancements. Validates proposals in staging and A/B tests before presenting high-confidence
  improvements for human approval; the first agent in the roster permitted to propose changes to
  other agents' prompts.
- **Type:** optimization
- **Model:** claude-sonnet-4-6
- **Estimated tokens per run:** large ??? reads `agent_runs` output across the full roster nightly;
  estimated 15,000+ input tokens per run (no independent estimate given in source docs; scaled from
  the scope of "every agent in the roster" against typical `agent_runs` row volume).
- **Tier gate:** platform-internal ??? this is an admin/platform-owner tool (`/admin/monitor`
  approval queue per its blueprint), not an org-facing agent with a subscription tier gate.
- **Trigger:** schedule ??? nightly self-assessment pass.
- **Input sources:** `agent_runs` (all agents, all orgs, aggregated), `agent_decisions`,
  `outcomes` (to correlate agent behavior with actual award/denial results).
- **Output:** `agent_improvement_proposals` (new table) ??? a proposed prompt/logic change with
  supporting evidence, staged for validation before any live agent is modified.
- **Chains to:** AG-39 (ROI Optimizer) ??? per `AUTONOMOUS_PLATFORM_VISION.md` Phase 4: "ROI
  Optimization Engine ??? feeds directly into the Continuous Improvement Engine above," i.e. the
  data flow is bidirectional between the two.
  **Numbering note:** the vision doc's own agent numbered **AG-36** is this exact agent
  (Autonomous Continuous Improvement Engine); its own **AG-38** is a different, unrelated agent
  (Community Resource Graph). See the Numbering note above before using "AG-38" in any schema.
- **Hard limits:** `AUTONOMOUS_HARD_LIMITS.NEVER_MODIFY_GOVERNANCE_FILES` applies literally ??? this
  agent proposes changes to *other agents' prompts*, never to CLAUDE.md/BLUEPRINT_v2.md/
  SCHEMA_REGISTRY_v2.md/BEHAVIORAL_CONTRACTS.md/STATE_OF_THE_BUILD.md/SESSION_STATE.md; every
  proposal requires human approval before deployment ??? "validates in staging, A/B tests, and
  presents high-confidence improvements for human approval" is explicit in its own design, it does
  not self-deploy.
- **Dependencies:** requires a meaningful volume of `agent_runs`/`agent_decisions` history across
  multiple agents in live production use ??? per `AUTONOMOUS_PLATFORM_VISION.md`'s own Phase 1
  gating note, "no later phase should be scheduled until Phase 1's discovery???probability???draft
  loop is running unattended for real subscriber orgs." This agent is the least buildable of the
  twelve until that data exists.
- **FORGE queue:** not yet scoped into a `queue.yaml`. Blueprint in
  `AUTONOMOUS_PLATFORM_VISION.md` ??7, Phase 4 table ("Autonomous Continuous Improvement Engine"
  row): new `agent_improvement_proposals` table, new agent (numbered AG-36 in the source doc,
  reads `agent_runs`), `/api/admin/agent-improvements` route, approval queue on `/admin/monitor`.

---

### AG-39: ROI Optimizer

- **Phase:** 5
- **Status:** PLANNED
- **Purpose:** Tracks every submission variable ??? prompt version, attachment type, submission day,
  wording choices, contact person ??? against outcome, running a continuous optimization loop that
  identifies which variable combinations correlate with higher award rates.
- **Type:** optimization
- **Model:** claude-sonnet-4-6
- **Estimated tokens per run:** ~2,000 input / ~800 output per variable-outcome correlation batch;
  run continuously against new `outcomes` rows rather than on a fixed schedule.
- **Tier gate:** enterprise.
- **Trigger:** event ??? fires on new `outcomes` inserts, correlating the outcome back to the
  submission variables recorded for that application.
- **Input sources:** `submission_variable_outcomes` (new table), `outcomes`, `applications`
  (draft_source, auto_generated), `submission_queue` (submission day/time, portal_trust_score).
- **Output:** `submission_variable_outcomes` rows with correlation strength per variable;
  aggregate ROI trend data.
- **Chains to:** AG-38 (Self-Improvement Agent) ??? "feeds AG-36" per
  `AUTONOMOUS_PLATFORM_VISION.md` ??7's own Phase 4 table entry (using the vision doc's numbering
  for the Self-Improvement Agent; see the Numbering note above).
- **Hard limits:** the global hard limits (Section 0) apply; never adjusts a live submission's
  variables mid-flight based on its own findings ??? optimization recommendations feed the
  Self-Improvement Agent's human-approved proposal pipeline, they don't self-apply.
- **Dependencies:** requires AutoApply Full Autonomous Mode (Phase 2, extends AG-12) shipped first
  so there's submission volume to analyze ??? at 400+ overnight submissions per
  `AUTONOMOUS_PLATFORM_VISION.md` Phase 2 ??4, this agent has a real signal; at today's manual/
  semi-autonomous submission volume it would have too little data to correlate meaningfully.
- **FORGE queue:** not yet scoped into a `queue.yaml`. Blueprint in
  `AUTONOMOUS_PLATFORM_VISION.md` ??7, Phase 4 table ("ROI Optimization Engine" row): new
  `submission_variable_outcomes` table, new AG-39 (feeds AG-36), `/api/admin/roi-optimization`
  route, ROI trend dashboard on `/admin/monitor`.

---

### AG-40: Strategic Advisor

- **Phase:** 5
- **Status:** PLANNED
- **Purpose:** The capstone agent ??? reads the output of every other agent in the roster (AG-01
  through AG-39) and synthesizes a single prioritized action list of proactive, unsolicited
  strategic recommendations: "Apply for these 12 grants next month," "Postpone this application,"
  "This foundation funded exactly your profile 3 times in the last 2 years."
- **Type:** analysis
- **Model:** claude-sonnet-4-6
- **Estimated tokens per run:** large ??? synthesizes across the full agent roster's recent output
  per org; no independent token estimate given in source docs, expected to be the single most
  expensive per-org nightly step once built, comparable in scale to AG-18's "single most expensive
  nightly step" caveat today but across far more input sources.
- **Tier gate:** enterprise.
- **Trigger:** schedule ??? designed as a nightly per-org synthesis pass, surfaced on next login.
- **Input sources:** `agent_runs`, `agent_decisions`, `opportunity_probability_scores`,
  `donor_intent_scores`, `market_forecasts`, `reputation_signals`, `relationship_recommendations`,
  `funding_forecasts`, `community_need_signals` ??? effectively every intelligence table this
  document and its two predecessor phases define.
- **Output:** `strategic_recommendations` (new table) ??? a prioritized, human-readable action list
  with rationale per item.
- **Chains to:** none ??? this is the terminal synthesis agent; nothing chains from it.
- **Hard limits:** `AUTONOMOUS_HARD_LIMITS.NEVER_SUBMIT_EXTERNALLY` /
  `NEVER_SEND_EMAIL_WITHOUT_APPROVAL` apply to every recommendation it might otherwise be tempted to
  auto-execute ??? it recommends, it never acts; never asserts a recommendation without traceable
  provenance back to the specific upstream agent output that produced it (a "black box" priority
  list would be a governance regression from every other agent's decision-logging standard).
- **Dependencies:** by design, this agent depends on nearly everything else in this document ???
  it is explicitly the last agent built, per Phase 5's position as "Month 49+" in
  `AUTONOMOUS_PLATFORM_VISION.md`. Realistically gated behind AG-15/AG-17/AG-18/AG-19 first reaching
  ENABLED-and-actually-running status (currently blocked per ??1.2/??1.3), plus at least the Phase 2
  agents (AG-29 through AG-31) shipping so there's more than the Phase 1 signal set to synthesize.
- **FORGE queue:** not yet scoped into a `queue.yaml`. Blueprint in
  `AUTONOMOUS_PLATFORM_VISION.md` ??7, Phase 5 table ("AI Strategic Advisor" row): new
  `strategic_recommendations` table, new AG-40 (reads output of AG-01 through AG-39),
  `/api/intelligence/strategic-advisor` route, dashboard "Today's Priorities" hero panel.

---

*Phase 2-5 Agent Specifications section added July 19, 2026, from a read of
`AUTONOMOUS_PLATFORM_VISION.md` (full) and `FEATURE_REGISTRY_v2.md` features 217-228 ??? no code
audit was performed for this section since none of these twelve agents have any code to audit yet.
Re-verify against `src/lib/agents/` before treating any status above as anything but PLANNED.*
