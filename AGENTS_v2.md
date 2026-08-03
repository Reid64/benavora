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

> **RESOLVED, 2026-08-02.** All 12 "MISSING" literals in the table below (plus 3 more found in the
> same follow-up: `ag-30-donor-intent`, `ag-38-self-improvement`, `autonomous_orchestrator` — 15
> total) were added to the live `agent_type` enum via `fix-agent-type-enum-gap.sql`, applied
> directly to production through the `DATABASE_URL`/psql path (`STANDING_DIRECTIVES.md`
> DIRECTIVE-017), and confirmed live via the PostgREST OpenAPI schema. 6 of the affected agents
> (AG-15's wrapper, AG-17, AG-19, and the real agents behind AG-25/AG-28/AG-30's on-disk literals)
> were individually re-run live to confirm they no longer fail at `startRun()`. Full evidence in
> `AGENT_VERIFICATION_LOG.md`'s enum-gap entries. **The table and "Fix required... out of scope"
> framing below are the original diagnosis, kept for history — do not read them as current status.**
> Two literals used by other real agents were *not* part of that fix and remain genuinely missing
> today: `ag-18-reputation` (orphaned `ReputationIntelligenceAgent`) and `ag-32-relationship-graph`
> (the real AG-23/RA-01 capability, see AG-23's spec in Section 5).

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
| AG-25 — Disaster Response Agent | `ag-25-deadline-prediction` = **Deadline Prediction Agent** (unrelated, and — as of 2026-08-02 — also confirmed live/working; this is a permanent both-real dual-use number, not a collision to fix) |

**AG-28 resolved, 2026-08-02 — no longer a collision, do not re-add a row for it.** The phantom
"Impact Simulation Agent" that used to occupy AG-28 (zero real code, ever) was renumbered to AG-41.
AG-28 is now permanently and unambiguously the real, live `FollowupGeneratorAgent`
(`agentId: "ag-28-followup"`) — see its full spec at AG-28 in Section 5 below, replacing the old
Impact Simulation spec at that position. AG-30 had the same class of problem in a different shape
(two separate `### AG-30:` headers in this same document, not an on-disk-literal mismatch) —
resolved the same day the same way: the phantom "Change Monitor Agent (CM-01)" was renumbered to
AG-42, leaving the existing `### AG-30: Donor Intent Monitor` section (Phase 2-5 section below) as
this document's sole AG-30.

**AG-25 deliberately NOT resolved this way.** Unlike AG-28/AG-30, `ag-25-deadline-prediction`'s
canonical counterpart (Disaster Response Agent, this row above) is real, working code — not a
phantom spec — and its own source files (`disaster-response-agent.ts`,
`api/agents/disaster/route.ts`) explicitly self-identify as "AGENTS_v2.md AG-25" in their header
comments. Renumbering the canonical spec here would desync those files' own self-description from
this document without touching code, which this pass was explicitly scoped to avoid. As of
2026-08-02 the on-disk side (`DeadlinePredictionAgent`) is also confirmed live and working (the
enum gap that used to block it is fixed) — so AG-25 now names two different, both-real, both-live
agents, permanently, by deliberate decision. AG-25 remains a genuine dual-identity number by
design, not an oversight — see the strengthened numbering note under AG-25 in Section 5 for the
full explanation.

This document keeps the original 30 canonical `AG-XX` names/purposes (Section 5) because that is
the taxonomy the product/business side already knows — except AG-28 and AG-30 as of 2026-08-02,
which now permanently point at their real live agents instead of the phantom concepts that used to
sit there (renumbered to AG-41/AG-42 respectively; never to be reused for anything else). Every
per-agent spec below states its real on-disk `agent_type`/`agent_id` literal explicitly so the two
schemes never get silently conflated.

### 1.5 Files in `src/lib/agents/` with no corresponding spec anywhere in this document

Cross-checking the full `src/lib/agents/` directory listing (76 entries as of July 19, 2026) against
every file path named anywhere in this document (Sections 1, 4, 5, 8, and the Phase 2-5 section)
turns up 21 files never mentioned. None of these were audited as part of this pass — this is a
"these exist and are undocumented" list, not a claim about whether they're wired, dead, or built
correctly. A future edit of this document should give each one a real spec (or fold it explicitly
into an existing agent's spec as a helper/adapter, the way `research/*.ts` was folded into AG-05).

| File | Lines | Likely relates to (unverified — name-based guess only) |
|---|---|---|
| `application-cloner.ts` | 226 | Application Cloning, `FEATURE_REGISTRY_v2.md` #72 BUILT — not in the AG-01–40 roster anywhere |
| `automation-worker.ts` | 449 | Possibly AutoApply (AG-12) internals — not named in the AG-12 spec (Section 5) |
| `budget-agent.ts` | 468 | A **third** budget-related file — distinct from `budget-builder.ts` (live, Gen-1) and `budget-builder-agent.ts` (dead, Gen-2 `ag-06-budget-builder`), neither of which this document identifies as related to this file |
| `competitor-intel.ts` | 302 | Competitor Intelligence, `FEATURE_REGISTRY_v2.md` #70 BUILT — not in the AG-01–40 roster |
| `consensus-validator.ts` | 378 | Multi-Model Consensus, `FEATURE_REGISTRY_v2.md` #29 BUILT — not in the AG-01–40 roster |
| `email-campaign.ts` | 573 | Email campaign sending (Behavioral Contracts §28/32) — not in the AG-01–40 roster |
| `final-assembly.ts` | 344 | Document Assembly Engine, `FEATURE_REGISTRY_v2.md` #31/#115 BUILT — not in the AG-01–40 roster |
| `foundation-finder.ts` | 188 | Possibly overlaps AG-13 (Foundation Enrichment) — not named in the AG-13 spec |
| `funder-intel.ts` | 284 | Funder Intelligence, `FEATURE_REGISTRY_v2.md` #32 BUILT — not in the AG-01–40 roster |
| `giving-history.ts` | 204 | 990-PF Giving History, `FEATURE_REGISTRY_v2.md` #66 PLANNED — not in the AG-01–40 roster |
| `housing-specific-scrapers.ts` | 201 | Faith Foundation-specific (housing/TDHCA domain) — not in the AG-01–40 roster |
| `hud-monitor.ts` | 239 | HUD program monitoring — not in the AG-01–40 roster |
| `humanizer-agent.ts` | 630 | AI Humanizer Agent, `FEATURE_REGISTRY_v2.md` #22 BUILT, referenced by name in Behavioral Contracts §28 ("processed through Humanizer") — not in the AG-01–40 roster |
| `review-agent.ts` | 255 | Possibly `/api/ai/review` — not in the AG-01–40 roster |
| `scheduler.ts` | 213 | **Naming collision risk:** distinct from `worker/scheduler.ts` (Section 4/7, the real nightly cron scheduler) — this is a different file under `src/lib/agents/`, unaudited |
| `semantic-matching.ts` | 271 | Possibly overlaps Semantic Funder Matching, `FEATURE_REGISTRY_v2.md` #73 BUILT (registry cross-ref table, Section 4, credits `src/lib/intelligence/semantic-matcher.ts` instead — a different path) |
| `simpler-grants.ts` | 234 | Likely a Simpler Grants API source adapter, sibling to `grants-gov.ts`/`sam-gov.ts` under AG-05 — not listed among AG-05's real implementation files |
| `state-scrapers.ts` | 255 | Likely sibling to `state-portal.ts` (listed under AG-05) — not itself named |
| `success-probability.ts` | 335 | Success Probability Scoring, `FEATURE_REGISTRY_v2.md` #68 BUILT — not in the AG-01–40 roster |
| `tdhca-scraper.ts` | 193 | Texas Dept. of Housing scraper (Faith Foundation domain-specific) — not in the AG-01–40 roster |
| `usaspending.ts` | 156 | USASpending API source adapter — not in the AG-01–40 roster |

Not counted as "missing" above: `agent-registry-seed.ts` (Section 6, registry metadata, not an
agent), `autonomous-base.ts`/`base-agent.ts` (Section 2, base classes), the `research/` subdirectory
(Section 5 AG-05, source adapters), and the 14 files covered in Section 8 and the Phase 2-5 section
above.

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
| AG-28 | Follow-Up Generator Agent (renumbered here 2026-08-02, was phantom "Impact Simulation" — see AG-41) | AI (Claude) | ENABLED (event) | event (`agent_queue`, stage transition) | none |
| AG-29 | Knowledge Engine Indexer Agent | Embedding model | PLANNED | — | none |
| AG-30 | Donor Intent Monitor (renumbered here 2026-08-02, was phantom "Change Monitor" — see AG-42; full spec still in Phase 2-5 addendum) | AI (Claude) + web search | ENABLED (manual/on-demand) | manual API route only | none |
| AG-41 | Impact Simulation Agent | AI (Claude) | PLANNED | — | none |
| AG-42 | Change Monitor Agent (CM-01) | AI (Claude) | PLANNED | — | none |

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
| AG-28 | `followup-generator-agent.ts` (renumbered onto AG-28 2026-08-02 — real, was previously documented only via the on-disk-literal collision note) | `FollowupGeneratorAgent` | `ag-28-followup` |
| AG-29 | not found (schema exists: `knowledge_patterns`, `intelligence_funded_proposals.embedding`) | — | — |
| AG-30 | `donor-intent-monitor-agent.ts` (renumbered onto AG-30 2026-08-02 — real, full spec in Phase 2-5 addendum) | `DonorIntentMonitorAgent` | `ag-30-donor-intent` |
| AG-41 | not found (schema exists: `impact_simulations`) — formerly AG-28, renumbered 2026-08-02 | — | — |
| AG-42 | not found — formerly AG-30, renumbered 2026-08-02 | — | — |

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

**Enterprise build spec, written 2026-08-03.** Canonical purpose unchanged from the original scope
(`AGENTS_v2.md`, `FEATURE_REGISTRY_v2.md`): "analyzes grant requirements and produces a structured
DNA profile of what a funder tends to require/reward." This spec does not expand that purpose —
it specifies the engineering depth needed to build it correctly. No implementation exists yet
(confirmed by grep, `src/lib/agents/`, zero matches). Output table `funder_dna_profiles` did not
exist either; created live 2026-08-03 (`src/supabase/migrations/106_funder_dna_profiles.sql`,
applied via `DATABASE_URL`/psql, RLS included) specifically to give this spec a real, grounded
output contract rather than an invented/hypothetical one.

> **Numbering note (unchanged):** the on-disk string `"ag-10-document-expiry"` does **not** belong
> to this agent — it is `DocumentExpiryAgent`'s `agentId` (a currently-live, nightly, unrelated
> agent, built and enum-valid since migration 082). See §1.4. `FEATURE_REGISTRY_v2.md` row #210
> ("AG-10 Document Expiry Monitor") is that unrelated agent, not this one — do not conflate when
> scheduling or auditing "AG-10" activity.

#### Trigger design

**Two triggers, deliberately different cadences, because this agent tracks two different kinds of
signal that move at different speeds:**

1. **Event-chained (primary)** — fired via `agent_queue` (`trigger_source: "event"`, same
   convention as AG-07 `RecursiveLearningAgent`'s existing per-outcome-insert wiring) whenever a
   new `outcomes` row is inserted for an application whose opportunity has a non-null `funder_id`.
   **Rationale:** an `outcomes` row (award/denial/partial, `funder_feedback`, `denial_reason`) is
   ground truth about what a funder actually rewarded — the single strongest signal this agent
   has, and genuinely rare (a typical org logs single-digit-to-low-double-digit outcomes per year
   per funder). Recomputing the moment one arrives is cheap (bounded to one funder) and avoids the
   profile ever being stale relative to the most recent real result.
2. **Weekly schedule (secondary)** — `worker/scheduler.ts`, Sunday 3:00 AM CST (off-peak, matching
   the existing weekly-cadence convention already used for `foundation-enrichment-weekly`). Scans
   for funders with ≥1 new `opportunities` row since `funder_dna_profiles.last_analyzed_at` (or no
   profile row at all). **Rationale:** requirement patterns (`eligibility_requirements`,
   `required_documents`, `amount_min`/`amount_max`) are visible on `opportunities` the moment
   they're posted, independent of whether an outcome has happened yet — but a single new posting
   isn't worth an immediate recompute (opportunity volume per funder is typically a handful of
   cycles per year; nightly would be near-total no-op churn). Weekly balances freshness against
   wasted runs.

Both paths call the same `run()` entry point with a `funderIds: string[]` scope resolved before
`startRun()` — the event path scopes to the one funder from the triggering outcome; the schedule
path scopes to every funder with new opportunities since last analysis, capped at
`MAX_FUNDERS_PER_SCHEDULED_RUN = 25` per run (mirrors `MAX_PER_RUN`-style caps already used in
`probability-scoring-agent.ts`) to keep a single scheduled run bounded regardless of platform
growth — remaining funders roll to the next week's run rather than growing one run unboundedly.

#### Input contract

| Source | Columns read | Shape notes |
|---|---|---|
| `outcomes` | `id, organization_id, application_id, result, awarded_amount, requested_amount, funder_feedback, denial_reason, funder_category, opportunity_category, recorded_at` | `result` is a real enum-like text column (`awarded`/`denied`/`partial` per existing usage elsewhere in this codebase). Joined to `opportunities` via `application_id → applications.opportunity_id → opportunities.funder_id` (2-hop; `outcomes` itself carries no direct `funder_id`, confirmed live). |
| `opportunities` | `id, organization_id, funder_id, category, eligibility_requirements, required_documents, amount_min, amount_max, deadline, status, recurrence` | `eligibility_requirements` is free `text` (not structured — parsed by Claude, not a rule engine); `required_documents` is a real `text[]` array; `category` is the real `public.funder_category` enum. |
| `funders` | `id, organization_id, name, category, annual_giving_budget, geographic_focus` | Confirms the funder still exists and is still owned by the same org before writing (defense against a funder deleted mid-run). |
| `funder_dna_profiles` (self, read-before-write) | `id, sample_size, requirement_patterns, reward_patterns, confidence` | Read once per funder at the start of each funder's processing to support incremental merge (see Idempotency below) — this agent never fully recomputes from zero if a prior profile exists, it updates it. |

#### Process (numbered, with real branch logic)

For each `funderId` in scope (processed sequentially within a run, not concurrently — see Cost
budget below for why):

1. **Load evidence.** Fetch all `opportunities` for this `funder_id` (any org — see the
   cross-org design note below) and all `outcomes` joined through them, plus the existing
   `funder_dna_profiles` row for this `(organization_id, funder_id)` pair if one exists.
2. **Branch on evidence volume:**
   - **Zero opportunities found** (funder has no posted opportunities on file at all): skip this
     funder entirely, no row written, no decision logged — there is nothing to analyze. Counts
     toward `itemsFound` but not `itemsProcessed`.
   - **Opportunities exist, zero outcomes** (`sample_size` for reward_patterns stays 0): compute
     `requirement_patterns` only (deterministic — see step 3) from the opportunity fields
     directly, no Claude call needed. `reward_patterns` is written as `{}` and `confidence` as
     `null` (explicitly "not enough data to say what gets rewarded," not a fabricated guess).
   - **Opportunities and outcomes both exist**: full analysis, both `requirement_patterns` (step
     3) and `reward_patterns` (step 4, Claude-assisted) computed.
3. **Compute `requirement_patterns` (deterministic, no Claude call — this is the one place a rule
   engine is strictly better than a language model, since the inputs are already structured):**
   union of `required_documents` across all opportunities for this funder (frequency count per
   document type), min/max/median of `amount_min`/`amount_max`, and the deadline-recurrence
   distribution (`recurrence` value counts). Written as-is to `requirement_patterns` jsonb — no
   interpretation needed, these are direct aggregates over real structured columns.
4. **Compute `reward_patterns` (Claude-assisted — `eligibility_requirements`/`funder_feedback`/
   `denial_reason` are free text, genuinely need language understanding, not just aggregation):**
   build one prompt per funder containing every outcome's `result`, `awarded_amount` vs
   `requested_amount` ratio, `funder_feedback`, and `denial_reason`, plus every opportunity's
   `eligibility_requirements` text. Ask Claude to extract: (a) recurring themes across awarded
   applications' stated eligibility that denied ones lacked, (b) whether award size correlates
   with any observable factor mentioned in feedback (e.g. "prioritizes first-time applicants,"
   "favors capital projects over general operating"), (c) a 0-100 confidence score for how
   strongly the sample supports these patterns. **Threshold:** if `sample_size < 3` outcomes,
   Claude is still called (there's no reason not to extract what little signal exists) but the
   agent forces `confidence` to be capped at `min(claudeReportedConfidence, 40)` regardless of
   what Claude reports — a small sample cannot honestly support high confidence, and this cap is
   enforced in code, not left to the model's self-assessment.
5. **Merge with existing profile, if one exists** (see Idempotency below), then upsert
   `funder_dna_profiles` on `(organization_id, funder_id)`.
6. **Log a decision** (`decisionType: "funder_dna_updated"`) with the new `sample_size` and
   `confidence`, `actionPayload` containing the specific new patterns found this run (not the
   full profile — just the delta, so a human reviewing decisions can see what changed without
   re-deriving it from the stored jsonb).
7. **Error isolation per funder:** each funder's steps 1-6 run inside its own `try/catch`; a
   failure on funder N (Claude error, malformed data) is pushed to `errors[]` and the loop
   continues to funder N+1 — one bad funder's data never aborts the whole run, matching the
   per-item isolation pattern already established in `ProbabilityScoringAgent`/
   `RelationshipBuilderAgent`.

**Design note on cross-org scope (a real product decision, stated explicitly rather than left
implicit):** `opportunities`/`outcomes` evidence for a given `funder_id` is read across **all**
organizations that have that funder on file, not just the calling org — a funder's actual
behavior (what it requires/rewards) is an objective fact about the funder, not something that
differs by which org is asking, so pooling evidence produces a materially better-sampled profile
than any single org could produce alone. The **output row** is still written per-org
(`funder_dna_profiles.organization_id`), because different orgs may have different `funders.id`
rows for what is nominally "the same" real-world funder (this platform has no cross-org funder
identity resolution — confirmed, `funders` has no dedup/canonical-entity column) — so cross-org
pooling happens at read time by matching on `funders.name` (best-effort text match, logged as a
`matchedByName` count in the decision's `actionPayload` so a human can see how much of the sample
came from name-matching vs. this exact org's own `funder_id`), not by a real foreign key. This is
an explicit, documented trade-off — not a bug — for a future session to revisit if funder identity
resolution is ever built.

#### Output contract

`funder_dna_profiles` (migration 106, applied live):

| Column | Type | Written by this agent as |
|---|---|---|
| `organization_id` | uuid | the org that owns the `funders` row being profiled |
| `funder_id` | uuid | FK to `funders.id` |
| `requirement_patterns` | jsonb | `{ commonDocuments: [{type, frequency}], awardRange: {min, max, median}, recurrenceDistribution: {...} }` |
| `reward_patterns` | jsonb | `{ themes: string[], sizeCorrelation: string \| null, matchedByName: number }` |
| `typical_award_range_min`/`_max` | numeric | flattened out of `requirement_patterns.awardRange` for fast, index-friendly querying without unpacking jsonb |
| `common_eligibility_themes` | text[] | flattened out of `reward_patterns.themes`, same reason |
| `common_required_documents` | text[] | flattened out of `requirement_patterns.commonDocuments` |
| `sample_size` | integer | count of outcomes actually used this run (not opportunities) |
| `confidence` | numeric | 0-100, capped per step 4's rule |
| `last_analyzed_at` | timestamptz | stamped every run, including zero-outcome runs (so the weekly scheduler's "new since last_analyzed_at" scope check is accurate) |

#### Error handling and failure modes

- **Transient failure (Claude API error, timeout):** retry up to 3 attempts with exponential
  backoff (`1s, 2s, 4s` — the exact pattern already proven in `src/lib/intelligence/embeddings.ts`,
  reused rather than inventing a new one), then treat as a permanent failure for this funder only.
- **Permanent failure for one funder:** caught per-funder (process step 7), pushed to `errors[]`,
  loop continues — never fails the whole run.
- **Total run failure** (e.g. the initial funder-scope query itself fails): the outer `try/catch`
  around the whole `run()` body calls `failRun()`, matching every other `AutonomousAgent` in this
  codebase — a real `agent_runs` row with `status: 'failed'` and the real error message, not a
  silent exit.
- **Dead-letter / skip, not alert:** a permanently-failed funder is simply skipped for this run;
  it will be retried automatically on the next scheduled run or the next outcome event for that
  funder, whichever comes first — no separate dead-letter table needed, since re-attempt is
  already built into the trigger design (unlike, say, a one-shot ingestion job).

#### Idempotency

Re-running this agent twice on the same input must not double-count evidence or corrupt the
profile. Guaranteed by: (1) `requirement_patterns`/`reward_patterns` are always **recomputed from
the full current evidence set**, not incrementally appended to — every run reads all
`opportunities`/`outcomes` for the funder fresh and overwrites the jsonb columns with a complete
new aggregate, so running twice with no new data produces byte-identical output (aggregation over
an unchanged input set is deterministic for `requirement_patterns`; `reward_patterns` uses Claude,
which is not perfectly deterministic token-for-token, but the underlying `sample_size`/
`confidence`/`typical_award_range` numeric fields are recomputed from the same deterministic
aggregation and will match). (2) The upsert targets `(organization_id, funder_id)`'s `UNIQUE`
constraint (migration 106) — a second run for the same pair updates the same row, never inserts a
duplicate. (3) `last_analyzed_at` is stamped on every run regardless of whether new data existed,
so a re-run immediately after a successful run correctly finds nothing new to do on its next
scheduled pass (no infinite reprocessing loop).

#### Observability

- `agent_runs`: `items_found` = funders considered, `items_processed` = funders that got a real
  profile write (excludes the "zero opportunities" skip case), `output_summary` = JSON
  `{funderIds: [...], newProfiles: N, updatedProfiles: N, skipped: N}`.
- `agent_decisions`: one `funder_dna_updated` row per funder actually updated (not per run), with
  `entityType: "funder"`, `entityId: funder.id`, `actionPayload` containing the specific new
  patterns found (step 6) — a human debugging "why did this funder's profile change" reads this
  row, not the source code.
- A failed funder's specific error text lands in `errors[]`, which is part of `output_summary` —
  visible without a database console, from the same `agent_runs` row the rest of this agent's
  activity is already recorded in.

#### Cost / token budget

- Deterministic `requirement_patterns` step: $0, no API call.
- `reward_patterns` Claude call: one call per funder with outcomes, model `claude-sonnet-4-6`
  (`DEFAULT_MODEL`, already the project-wide default for structured-extraction agent tasks of
  comparable complexity — see Model selection below). Estimated prompt size: ~500 tokens of
  instructions + up to ~150 tokens per outcome (feedback/denial text, typically short) + ~100
  tokens per opportunity's `eligibility_requirements`. For a funder with 10 outcomes and 15
  opportunities on file (a generous real-world ceiling for a single funder on this platform today):
  ~500 + 1,500 + 1,500 ≈ 3,500 input tokens, ~400 output tokens (structured JSON response).
- **Per-run cost** (weekly scheduled run, worst case `MAX_FUNDERS_PER_SCHEDULED_RUN = 25` funders
  all needing the Claude step): 25 × (3,500 in + 400 out) ≈ 87,500 input + 10,000 output tokens.
  At Sonnet's published per-million-token pricing (~$3/$15 as of this spec's writing — re-verify
  against current Anthropic pricing before relying on this number long-term, prices change), that's
  roughly **$0.26 + $0.15 ≈ $0.41 per scheduled run**.
- **Per-run cost** (event-chained, single funder): ≈ $0.02.
- **Monthly estimate at expected volume:** 4 weekly runs (~$1.64) + event-chained runs bounded by
  real outcome volume (a platform-wide handful to low hundreds of outcomes/month across all orgs,
  each a ~$0.02 call) — **well under $10/month total at current platform scale**, growing
  linearly with outcome volume, not funder count (the expensive step only fires when there's a
  real outcome to analyze).

#### Model selection

`claude-sonnet-4-6` (`DEFAULT_MODEL`), not a cheaper/faster tier. **Justification:** this task is
free-text pattern extraction across multiple documents (`funder_feedback`, `denial_reason`,
`eligibility_requirements`) requiring genuine synthesis ("what do these 10 denial reasons have in
common that the 6 awards don't") — not a classification or extraction task simple enough for a
lighter model, and not a task where extended multi-step reasoning (a "thinking"-tier model) is
needed either, since it's a single-pass synthesis over a bounded, already-fetched context window,
not an open-ended research task. Sonnet is the same tier already used platform-wide for comparable
structured-synthesis agent tasks (`ProbabilityScoringAgent`, `RelationshipBuilderAgent`'s Phase A).

#### Autonomy level: full autonomy, no human-approval gate

**This agent never takes an external action or writes anything a human would need to approve
before it's acted on** — it only computes and stores an analytical profile that other
agents/humans *read* later when deciding what to do (e.g. informing a draft-generation prompt or
an eligibility score). Per the global hard limits (Section 0), human review is reserved for
external actions (submissions, emails) and financial/pipeline-data writes — this agent does
neither. **Self-healing:** per-funder failures are retried automatically by the next trigger
(event or weekly schedule), not by the agent retrying itself in-process beyond the 3-attempt
Claude backoff in step-level error handling. **Runaway governance:** bounded by
`MAX_FUNDERS_PER_SCHEDULED_RUN = 25` per scheduled run and by the event trigger firing at most
once per real `outcomes` insert (a genuinely rare, human-paced event, not a loop this agent
controls the frequency of) — there is no code path by which this agent can trigger itself
repeatedly or spend without a new, real, human-generated data point arriving first.

**Autonomous Mode**
- **Status:** PLANNED (spec complete, awaiting build — see `queue-13.yaml`)
- **Trigger Type:** event (`agent_queue`, on `outcomes` insert) + schedule (weekly, Sunday 3:00 AM CST)
- **Trigger Condition:** new `outcomes` row with a resolvable `funder_id`, or ≥1 new `opportunities` row since last analysis
- **Decision Log:** `funder_dna_updated`, per funder actually updated
- **Chain Output:** none — this agent is a pure information producer, nothing downstream is auto-triggered by it (other agents read `funder_dna_profiles` on their own schedule, not via a chain)
- **Hard Limits:** the global hard limits (Section 0) apply; additionally never writes financial/pipeline data, only an analytical read-model
- **Human Review Required:** no — see Autonomy level above

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

**Enterprise build spec, written 2026-08-03 — with a load-bearing correction before anything
else.** Per `BLUEPRINT_v2.md`'s own Phase 3 design ("Corporate Relationship Graph... extends
`pig_nodes` and `pig_edges`... AG-23 (Relationship Mapper) is the sole writer of these edge
types") and `AUTONOMOUS_PLATFORM_VISION.md` §7 ("this feature has no new agent number — it is an
extension of AG-23"), **this capability is not unbuilt.** It is fully implemented as `AG-32`
(`src/lib/agents/relationship-graph-builder-agent.ts`, `RelationshipGraphBuilderAgent`) — built
under a different on-disk label during construction, but the same real, working code this spec
would otherwise ask someone to build from scratch. Writing a second, competing implementation
under a literal `AG-23`/`RA-01` label would create exactly the kind of duplicate-agent mess this
project's `AGENT_VERIFICATION_LOG.md` has spent multiple sessions untangling for other numbers —
**do not build new code for this spec.** What follows documents AG-32's real, already-implemented
behavior at full engineering depth (since that's genuinely valuable and this spec's job either
way), and specifies exactly what real, additional, non-duplicative work remains.

- **Purpose (unchanged from canonical scope):** Discovers relationships between businesses,
  foundations, board members, and nonprofits; populates `pig_nodes`/`pig_edges`.
- **Type:** AI (Claude, `callClaudeWithWebSearch`).
- **Tier Gate:** enterprise.
- **Real implementation:** `AG-32` (Section 5 below) — see that entry for the full, corrected,
  live-verified status as of 2026-08-03.

#### What real work remains (the actual build task for `queue-14.yaml`)

**1. Wiring — the only code gap that's genuinely this spec's to close.** AG-32 has zero schedule
or queue wiring today (confirmed live, `worker/scheduler.ts`/`worker/autonomous-orchestrator.ts`
grep). `BLUEPRINT_v2.md`'s nightly pipeline table specifies **"5:30 AM — AG-23: Relationship
Mapper (incremental)"** — daily, incremental, not the weekly full-rebuild `AUTONOMOUS_PLATFORM_
VISION.md`'s older Phase 3 table separately describes. **This spec adopts the daily-incremental
design as canonical**, for a stated reason: `BLUEPRINT_v2.md` is this project's later, more
authoritative source (per this document's own "Authority order," `AGENT_VERIFICATION_LOG.md` >
direct code > `AGENTS_v2.md`'s own July 19 audit — `BLUEPRINT_v2.md` sits above the older Phase 3
vision doc in the same hierarchy), and a daily-incremental sweep is the operationally correct
design regardless: a full weekly rebuild re-processes every board member's web-search Claude call
every week even when nothing about that person changed, while an incremental daily pass (scoped to
board members added/updated since the agent's own `pig_nodes.updated_at` for their node, or with
zero existing edges yet) does real work only where there's real new signal to find — materially
cheaper at platform scale and fresher (a new board member's connections surface within a day, not
up to a week later).

**Trigger, precisely specified (AG-32's `run()` needs a scope parameter it doesn't currently take
— see Chain Output below):** `worker/scheduler.ts`, daily, 5:30 AM CST. Scope query: board members
where `is_active = true` AND (no `pig_nodes` row exists yet for `entity_table='board_members',
entity_id=board_member.id`, OR the board member's `updated_at` is newer than their existing
`pig_nodes.updated_at`). This is the "incremental" half of the design — a board member who was
already fully processed and hasn't changed is never re-billed for a fresh Claude+web-search call.

**2. The `corporate_prospects` blocker is explicitly NOT this spec's to fix.** AG-32 (and thus
AG-23) cannot find prospect-side connections until that table exists — already the shared,
well-documented blocker for AG-20/21/22/24/30 (migrations 107/108). `queue-14.yaml`'s
live-verification step should confirm the agent reaches and fails cleanly at exactly this point
(the same way AG-32's own re-verification did 2026-08-03) — reaching this specific, known,
already-diagnosed failure point **is** the correct, successful outcome for this build task, not a
bug to chase. Board-member-to-**funder** connections (which don't depend on `corporate_prospects`
at all — `funders` is real and populated) should be fully exercised and should genuinely complete.

#### Input contract (AG-32's real, live-confirmed sources — restated here for this spec's own completeness)

| Source | Columns read | Notes |
|---|---|---|
| `board_members` | `id, organization_id, name, title, bio, is_active` | Real columns as of the 2026-08-03 fix — corrected from an earlier, wrong column set (`role`/`expertise`/`org_id`/`active`) that never existed live. |
| `funders` | `id, name, website` | Not org-filtered in AG-32's current code (loads up to `MAX_FUNDERS_IN_PROMPT` across the board — a scope-tightening opportunity, not a correctness bug, since the prompt still only searches for connections to the funders actually passed in). |
| `corporate_prospects` | `id, legal_name, website` | Confirmed still missing live — the blocker. |

#### Output contract

`pig_nodes` (now live, migration 077): `id, node_type, entity_id, entity_table, label, metadata,
created_at, updated_at` — one node per board member (`entity_table: 'board_members'`) and per
matched funder/prospect, upserted on `UNIQUE(entity_table, entity_id)`.
`pig_edges` (now live): `id, source_node_id, target_node_id, relationship_type ('board_overlap'|
'shared_executive'|'alumni_network'|'family_foundation_tie'), weight, evidence, verified, metadata,
discovered_at` — `UNIQUE(source_node_id, target_node_id, relationship_type)`, so re-discovering the
same edge on a later incremental run upserts rather than duplicates (see Idempotency).

#### Process, error handling, idempotency, observability, cost, model selection, autonomy level

**All identical to AG-32's real, already-implemented, already-live-verified behavior** — restating
them under a second heading here would either duplicate Section 5's AG-32 entry verbatim (and
risk drifting out of sync with it over time, the exact failure mode this whole renumbering effort
has been fixing all week) or invite a future session to "improve" this copy independently and
create two different descriptions of one real agent. **Authoritative source: the AG-32 entry,
Section 5.** The one dimension worth stating here explicitly, since it doesn't exist in the current
code and is this spec's own addition: **idempotency of the new daily-incremental trigger** — the
scope query itself (step 1 above) is the idempotency guarantee for *triggering* correctly (a board
member with an up-to-date `pig_nodes` row is never re-selected), layered on top of AG-32's own
existing `UNIQUE(entity_table, entity_id)` / `UNIQUE(source_node_id, target_node_id,
relationship_type)` upsert guarantees for the *writes* themselves.

#### Autonomy level: full autonomy, no human-approval gate

Same reasoning as AG-32's own design (informational graph-building, no external action, no
financial/pipeline write) — this spec's only addition is the daily schedule itself, which is
inherently self-governing in cost via the incremental scope query (a board member roster changes
rarely; most days' scope is empty or near-empty).

**Autonomous Mode**
- **Status:** the underlying capability is BUILT (as AG-32) — this spec's own scope (daily
  incremental wiring) is PLANNED, awaiting build (`queue-14.yaml`)
- **Trigger Type:** schedule — daily, 5:30 AM CST, incremental scope (see above)
- **Trigger Condition:** board member with no `pig_nodes` row yet, or updated since their existing node
- **Decision Log:** inherits AG-32's existing `agent_decisions` behavior, unchanged
- **Chain Output:** none — `run()` needs a new optional scope parameter (board member ID list) so
  the scheduler can pass the incremental scope instead of always processing every active board
  member; this is the one real, small code change this spec asks for beyond wiring
- **Hard Limits:** inherits AG-32's existing hard limits (Section 0; never asserts an edge without evidence)
- **Human Review Required:** no — see Autonomy level above

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

> **Numbering note — AG-25 is a permanent dual-use number, by deliberate decision, not a bug to
> fix.** Two completely unrelated real things both answer to "AG-25" in this codebase, and that is
> accepted, known, permanent state:
>
> 1. **This spec** — the real, deployed Disaster Response Agent above
>    (`disaster-response-agent.ts`, `api/agents/disaster/route.ts`), whose own source files
>    self-identify as "AGENTS_v2.md AG-25" in their header comments.
> 2. **The on-disk literal `"ag-25-deadline-prediction"`** — `DeadlinePredictionAgent`'s `agentId`,
>    a completely unrelated deadline-forecasting agent. **Corrected 2026-08-02: this agent is no
>    longer unreachable.** The `agent_type` enum gap that used to block it was fixed live in
>    production, and it was independently re-run and confirmed working (`status: completed`, zero
>    errors, real output) — see `AGENT_VERIFICATION_LOG.md`'s enum-gap entries. So both halves of
>    this collision are now real, live, and working — not one real agent and one dead one.
>
> A human searching "AG-25" in `agent_runs`/`agent_queue` data will find deadline-prediction rows,
> never disaster declarations (this spec's agent writes no `agent_type`/`agent_runs` row at all —
> see "Real implementation" above). **Deliberately NOT resolved by renumbering**, unlike AG-28/AG-30
> (see 1.4): unlike those two, which collided with a *phantom* never-built spec and were safely
> renumbered off the phantom side with nothing to break, AG-25's canonical side (this spec) is real
> working code whose own comments already claim "AG-25" — renumbering it here without touching that
> code would desync the doc from the code instead of fixing anything. See 1.4 for the full
> reasoning.

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

**Enterprise build spec, written 2026-08-03.** Canonical purpose unchanged: "generates 90-day and
12-month probability-weighted funding forecasts." No implementation exists (confirmed by grep).
Output table `funding_forecasts` existed only as an unapplied migration
(`src/supabase/migrations/078_forecast_board.sql`) — applied live 2026-08-03 via `DATABASE_URL`/
psql (with RLS added, migration 105), so this spec is grounded against the real live schema, not a
hypothetical one. **A real downstream consumer already exists and has been silently reading an
empty table**: `strategic-advisor-agent.ts` (AG-40) reads `funding_forecasts` defensively as one
of its 7 input sources — building this agent lights up an already-deployed feature with real data
for the first time, not just adding a new isolated capability.

#### Trigger design

**Schedule only — monthly, 1st of month, 4:00 AM CST** (`agent-registry-seed.ts` already carries
this exact cron as decorative Marketplace metadata; this spec makes it real). **Rationale:** a
90-day/12-month forecast is, by construction, a slow-moving number — the underlying inputs
(open-opportunity pipeline, historical win rate) don't meaningfully shift day-to-day, and a monthly
cadence matches how a development team actually consumes a forecast (a planning input reviewed
periodically, not a live dashboard number). No event trigger: unlike AG-10's per-outcome
event-chaining (where a single new data point materially changes one funder's profile), a single
new opportunity or outcome moves a portfolio-level forecast by a negligible amount — event-firing
here would be pure overhead with no meaningful freshness gain, correctly deferred to the monthly
schedule.

#### Input contract

| Source | Columns read | Notes |
|---|---|---|
| `opportunities` | `id, organization_id, funder_id, amount_min, amount_max, deadline, status, category` | Filtered to `status = 'open'` and `deadline` within the forecast window (90 days or 365 days from `forecast_date`). |
| `opportunity_probability_scores` | `opportunity_id, organization_id, overall_score, confidence` | AG-15's real, live output — this agent is a direct, real downstream consumer of AG-15, not a duplicate scoring pass. An open opportunity with no score row yet (AG-15 hasn't reached it) is treated as `overall_score: null` — see step 2's branch logic, not silently dropped or guessed at. |
| `outcomes` | `organization_id, result, awarded_amount, recorded_at` | Trailing-12-month win rate and average award-to-request ratio, used to calibrate the probability-weighted projection against this org's actual real-world conversion history rather than trusting AG-15's scores in isolation. |
| `organizations` | `id, annual_budget` | Context only — surfaced in `factors` so a human reading the forecast can judge scale (e.g. "$40K forecast against a $75K annual budget" reads very differently from the same number against a $2M budget). |

#### Process (numbered, with real branch logic)

Per org, once per scheduled run, for **each** of the two forecast periods (`'90_day'`, `'12_month'`
— two separate rows written, not one row with two fields, matching `forecast_period text NOT NULL`
being a single value per row):

1. **Load open opportunities** within the period window (`deadline <= forecast_date + 90 days` or
   `+ 365 days`), joined to their `opportunity_probability_scores` row if one exists.
2. **Branch on scoring coverage:**
   - **Zero open opportunities in window:** write a forecast row with
     `projected_min/max/most_likely: 0`, `confidence: null`, `methodology` explaining "no open
     opportunities in this window" — an explicit, honest zero, not a skipped row (a development
     team asking "what's our 90-day forecast" deserves "$0, here's why" over silence).
   - **Opportunities exist but none have an `overall_score` yet** (AG-15 hasn't caught up): still
     produce a forecast using a neutral 0.5 probability weight for every unscored opportunity
     (matching `computeGrantProbability()`'s own documented neutral-fallback convention for
     missing signal — reusing an established platform convention rather than inventing a new
     default), and set `confidence` no higher than 30 regardless of sample size, since the
     forecast is leaning on a fallback, not real scores. `methodology` states explicitly how many
     of N opportunities were score-backed vs. neutral-defaulted.
   - **Normal case (some or all opportunities scored):** proceed to step 3.
3. **Compute the probability-weighted projection (deterministic — no Claude call needed for the
   core math, matching AG-10's design principle that structured numeric aggregation doesn't need
   a language model):** for each opportunity, `expectedValue = midpoint(amount_min, amount_max) ×
   (overall_score ?? 50) / 100 × (org's trailing-12-month win rate, or platform-neutral 0.3 if this
   org has fewer than 3 recorded outcomes — same small-sample-neutral-default convention as
   step 2). `projected_most_likely` = sum of all `expectedValue`s in the window.
   `projected_min`/`projected_max` = the same sum computed at the 25th/75th percentile of each
   opportunity's score distribution (a simple ±1 confidence-band widening, not a full Monte Carlo
   simulation — proportionate to this agent's actual precision, not false precision).
4. **One Claude call per org per run (not per opportunity — bounded, cheap):** given the
   computed numbers plus the list of open opportunities/scores/recent outcomes, ask Claude to
   write `key_risks` (e.g. "60% of projected value depends on 2 opportunities with sub-40
   probability scores"), `key_opportunities` (e.g. "a historically reliable funder has 3 open
   cycles this quarter"), and `recommended_actions` (e.g. "prioritize drafting for the two
   highest-EV opportunities before their deadlines") — genuinely a synthesis/narrative task
   suited to a language model, layered on top of deterministic math it does not get to override.
5. **Upsert `funding_forecasts`** on `(org_id, forecast_date, forecast_period)` — see Idempotency.
6. **Log a decision** (`decisionType: "forecast_generated"`) per org per period, with
   `actionPayload` containing the headline number and the score-coverage ratio from step 2, so a
   human can immediately tell how much to trust a given forecast without opening the jsonb.
7. **Error isolation per org:** each org's steps 1-6 run in its own `try/catch`, matching every
   other multi-org-scoped agent in this codebase — one org's bad data never blocks another's
   forecast in the same monthly run.

#### Output contract

`funding_forecasts` (migration 078, live 2026-08-03):

| Column | Written as |
|---|---|
| `org_id` | the organization this forecast is for |
| `forecast_date` | the date this run executed (not the window end date) |
| `forecast_period` | `'90_day'` or `'12_month'`, one row each |
| `projected_min`/`_max`/`_most_likely` | step 3's computed values |
| `confidence` | 0-100, capped per step 2's branch rules |
| `methodology` | plain-text one-liner stating which branch (2a/2b/normal) produced this row and the score-coverage ratio |
| `factors` | jsonb: `{orgAnnualBudget, openOpportunityCount, scoredCount, trailingWinRate, sampleSize}` |
| `key_risks`/`key_opportunities`/`recommended_actions` | text[], from step 4's Claude call |

#### Error handling and failure modes

- **Transient (Claude API):** 3 attempts, exponential backoff (1s/2s/4s, the `embeddings.ts`
  pattern reused). On exhaustion, the forecast row is still written using the deterministic
  numbers from steps 1-3 with `key_risks`/`key_opportunities`/`recommended_actions` left as empty
  arrays and `methodology` appended with "(narrative synthesis unavailable this run)" — a Claude
  outage degrades the qualitative layer, never blocks the quantitative one, since the numeric
  projection is the load-bearing part AG-40 actually consumes.
- **Permanent failure for one org:** caught per-org (step 7), pushed to `errors[]`, loop continues.
- **Total run failure:** outer `try/catch` → `failRun()`, real `agent_runs` row, `status: 'failed'`.
- **Dead-letter / retry:** no separate dead-letter table — a failed org simply gets no forecast row
  this month and is naturally retried next month's scheduled run; a stale/missing forecast is a
  safe failure mode for an advisory number (unlike, say, a missed submission deadline).

#### Idempotency

Re-running twice for the same org+period on the same day must not create duplicate rows or corrupt
existing ones. Guaranteed by an upsert on `UNIQUE(org_id, forecast_date, forecast_period)` — this
constraint does not exist yet on the table as created by migration 078 and **must be added as part
of this agent's own build task** (a small `ALTER TABLE funding_forecasts ADD CONSTRAINT ...`,
explicitly called out here rather than silently assumed). Without it, `forecast_date` naturally
changes day-to-day anyway (it's stamped at run time), so even without the constraint a second
manual/retry run on the *same calendar day* is the only real double-write risk — the constraint
closes that specific gap.

#### Observability

- `agent_runs`: `items_found` = orgs with ≥1 open opportunity, `items_processed` = orgs that got
  both forecast rows written, `output_summary` = `{orgsProcessed, totalRowsWritten, orgsFailed}`.
- `agent_decisions`: one `forecast_generated` row per org per period (two per org per run), with
  the headline number and score-coverage ratio in `actionPayload` — a human debugging "why does
  this org's forecast look off" reads this row before opening `funding_forecasts` directly.
- Claude-outage degradation (per Error handling) is visible directly in `methodology`'s text, not
  just in logs — a human reading the forecast itself sees why the qualitative fields are empty.

#### Cost / token budget

One Claude call per org per run (not per opportunity, not per period — the step-4 call covers both
periods' context in one prompt to avoid doubling cost for two numbers that share the same input
data). Estimated ~1,000 input tokens (opportunity list + scores + recent outcomes, bounded by a
typical org's open-pipeline size) + ~300 output tokens (three short lists). At Sonnet's
~$3/$15-per-million pricing (re-verify current pricing before relying on this long-term): roughly
**$0.008 per org per month**. At an assumed near-term platform scale of dozens to low hundreds of
active orgs, **well under $5/month total** — this is one of the cheapest agents in this batch by
design (monthly cadence, one call per org, no per-opportunity Claude fan-out).

#### Model selection

`claude-sonnet-4-6`. Justification: the quantitative core (steps 1-3) is pure deterministic
arithmetic, needing no model at all — the one Claude call is narrow, bounded-context narrative
synthesis over already-computed numbers (risks/opportunities/recommended actions), the same
complexity tier as AG-10's `reward_patterns` step and AG-26's sibling agents in this batch. No
justification for a cheaper or a reasoning-tier model exists here: the task is neither trivial
extraction nor open-ended multi-step research.

#### Autonomy level: full autonomy, no human-approval gate

Same reasoning as AG-10: this agent only writes an advisory analytical projection that a human
(or AG-40 downstream) reads later — it takes no external action and touches no financial/pipeline
record directly (it reads `opportunities`/`outcomes`, never writes to them). **Self-healing:** a
failed org simply retries on next month's schedule, no in-agent retry loop beyond the 3-attempt
Claude backoff. **Runaway governance:** bounded by the monthly cadence itself (this agent cannot
be triggered more than once per month per org by design — no event path exists to fire it more
often) and by one bounded Claude call per org per run, with no per-opportunity fan-out that could
scale unboundedly with pipeline growth.

**Autonomous Mode**
- **Status:** PLANNED (spec complete, awaiting build — see `queue-15.yaml`)
- **Trigger Type:** schedule — monthly, 1st of month, 4:00 AM CST
- **Trigger Condition:** all orgs, unconditionally (a zero-opportunity org still gets an honest $0 forecast, per step 2)
- **Decision Log:** `forecast_generated`, per org per period
- **Chain Output:** none — AG-40 (Strategic Advisor) already reads this table on its own schedule; no chain needed
- **Hard Limits:** the global hard limits (Section 0) apply; never writes to `opportunities`/`outcomes`, read-only against pipeline data
- **Human Review Required:** no — see Autonomy level above

---

### AG-27: Board Meeting Packet Agent

**Enterprise build spec, written 2026-08-03.** Canonical purpose unchanged: "generates a complete
board meeting packet 48 hours before every scheduled meeting." No implementation exists (confirmed
by grep). Output/input tables (`board_meetings`, `board_meeting_packets`) existed only as an
unapplied migration — applied live 2026-08-03 (migration 078, RLS added in migration 105).
`board_members` was already real and live (confirmed via the AG-32 fix work the same day). This
spec deliberately does **not** attempt `FEATURE_REGISTRY_v2.md` row #139 ("Plain Language
Financials") — that is its own separate, still-PLANNED capability; this agent's financial section
is a lightweight, real-data summary only, explicitly scoped below, not a claim to have built #139.

#### Trigger design

**Two triggers, because "48 hours before a future, arbitrarily-scheduled date" cannot be served
by either mechanism alone:**

1. **Daily schedule (primary and sufficient on its own)** — `worker/scheduler.ts`, daily, 2:00 AM
   CST. Scope query: `board_meetings` where `status = 'scheduled'` AND `meeting_date` falls between
   `now() + 47 hours` and `now() + 49 hours` (a 2-hour window around the 48-hour mark, not an exact
   instant — a daily cron cannot land on an exact timestamp, and generating the packet anywhere in
   a 47-49 hour lead time is functionally identical for a human reading it) AND no
   `board_meeting_packets` row exists yet for this `meeting_id`. **Rationale:** this is the correct
   primary trigger because it's the only one that reliably fires regardless of *when* the meeting
   was originally scheduled — a meeting created a month in advance and a meeting created yesterday
   both get caught by the same daily window check, with no dependency on catching an insert event
   at the right moment.
2. **Event-chained safety net (`agent_queue`, `trigger_source: "event"`)** — fired when a
   `board_meetings` row is inserted or its `meeting_date` is updated to fall **within 48 hours of
   right now** (i.e., someone schedules or reschedules a meeting with short notice). Without this,
   a same-week emergency board meeting would silently miss its packet entirely, since the daily
   schedule's next run might land after the 48-hour window has already closed. **This is not a
   duplicate of the schedule trigger** — it only fires for the specific short-notice case the
   schedule cannot reach, and its own idempotency guard (a real `board_meeting_packets` row check
   before generating) means if both somehow overlap on the same meeting, only one packet is ever
   produced (see Idempotency).

#### Input contract

| Source | Columns read | Notes |
|---|---|---|
| `board_meetings` | `id, org_id, meeting_date, meeting_type, agenda, status` | The triggering row. |
| `board_members` | `id, organization_id, name, title, bio, is_active` | Recipient roster — `viewed_by` (output) is seeded empty and filled in later by the UI when each member actually opens the packet, not by this agent. |
| `opportunities` | `id, organization_id, funder_id, name, amount_min, amount_max, deadline, status` | Filtered to `status = 'open'` with `deadline` in the next 90 days — the pipeline section. |
| `outcomes` | `organization_id, result, awarded_amount, recorded_at` | Filtered to the period since the previous board meeting (or the trailing 90 days if this is the org's first packet) — "what happened since we last met." |
| `organizations` | `annual_budget, total_staff, total_volunteers` | The lightweight financial-context section (see scope note above — not the full #139 feature). |

#### Process (numbered, with real branch logic)

1. **Resolve scope** (per trigger design above), then per matching meeting:
2. **Branch on data availability, per section, independently — a packet with one thin section is
   still a real, useful packet, not a failed run:**
   - **Pipeline section:** if zero open opportunities in the 90-day window, write
     `pipeline_summary: { count: 0, note: "No opportunities currently in the 90-day pipeline." }`
     rather than omitting the section — a board should be told "nothing's in motion" as plainly as
     "here's what's in motion."
   - **Outcomes-since-last-meeting section:** if this is genuinely the org's first tracked meeting
     (no prior `board_meeting_packets` row exists for this org), state that explicitly in the
     section rather than silently defaulting to a 90-day lookback and implying it's "since last
     meeting" when there wasn't one.
   - **Financial section:** if `organizations.annual_budget` is null (not yet filled in during
     onboarding), the section states "financial data not yet on file" rather than showing a blank
     or a zero that could be misread as a real $0 budget.
3. **One Claude call per meeting** (bounded — never per-opportunity or per-member fan-out):
   given the assembled pipeline/outcomes/financial sections plus the meeting's own `agenda` text,
   ask Claude for `recommended_discussion_items` — 3-5 board-relevant discussion prompts genuinely
   grounded in what's in the packet (e.g. "Opportunity X's deadline falls before the next
   scheduled meeting — does the board want to discuss go/no-go tonight?"), not generic
   boilerplate. Every recommended item must cite the specific real fact from the packet it's
   grounded in (`{item, groundedIn: "opportunities[3]"}` shape in the jsonb) — genuinely
   verifiable against the same packet a reader already has, not an unfalsifiable AI summary.
4. **Assemble and write `packet_content`** (see Output contract) to `board_meeting_packets`.
5. **Log a decision** (`decisionType: "board_packet_generated"`), `entityType: "board_meeting"`,
   `entityId: meeting.id`, `actionPayload`: which sections had real data vs. the "nothing to
   report" fallback (step 2), so a human (or the board chair) can see at a glance how substantive
   this packet actually is before opening it.
6. **Notify** via `createNotification()` (the existing `AutonomousAgent` helper, writes to
   `alerts`) — a real, useful in-app notice ("Board packet ready for the March 15 meeting"), not
   an email (this agent never sends anything itself — see Autonomy level).
7. **Error isolation per meeting:** each meeting's steps 2-6 run in its own `try/catch` — a run
   scoped to multiple meetings across multiple orgs (the daily schedule can catch several
   organizations' meetings in the same 48-hour window) never lets one org's bad data block
   another's packet.

#### Output contract

`board_meeting_packets` (migration 078, live 2026-08-03):

| Column | Written as |
|---|---|
| `org_id` | the meeting's org |
| `meeting_id` | FK to the triggering `board_meetings` row |
| `packet_content` | jsonb: `{ agenda, pipelineSummary: {count, opportunities: [...]}, outcomesSinceLastMeeting: {...}, financialSnapshot: {...}, recommendedDiscussionItems: [{item, groundedIn}], generatedFor: meetingDate }` |
| `generated_at` | stamped at write time |
| `viewed_by` | seeded `[]` — populated later by the packet-viewing UI (a small, obvious follow-on API route this spec flags but does not build — out of this agent's own scope, which is generation, not the read-tracking UI) |

#### Error handling and failure modes

- **Transient (Claude API):** 3 attempts, exponential backoff (1s/2s/4s). On exhaustion, the
  packet is still written with all deterministic sections (pipeline/outcomes/financial) populated
  and `recommendedDiscussionItems: []` plus a note — same degrade-gracefully-not-block pattern as
  AG-26, since the deterministic sections are the load-bearing content a board actually needs.
- **Permanent failure for one meeting:** caught per-meeting (step 7), pushed to `errors[]`, loop continues.
- **Total run failure:** outer `try/catch` → `failRun()`.
- **Dead-letter / retry:** none needed beyond the trigger's own idempotency check — a meeting that
  failed today is still in-window tomorrow (the daily schedule's query naturally re-catches it
  until either a packet exists or the meeting date passes), so retry is inherent to the trigger
  design, not a separate mechanism.

#### Idempotency

The core guarantee is the scope query itself (step 1): "no `board_meeting_packets` row exists yet
for this `meeting_id`" excludes any meeting that's already been packeted, so the daily schedule and
the event-chained safety net can never both generate a packet for the same meeting — whichever
fires first wins, the second is a no-op by construction (the meeting simply won't appear in its
scope query anymore). No upsert-on-conflict is needed at the database level because the trigger
logic itself prevents the double-write from ever being attempted — this is a stronger guarantee
than relying on a unique constraint to reject a duplicate after the fact, though a
`UNIQUE(meeting_id)` constraint should still be added as defense-in-depth (explicitly flagged as
part of this agent's own build task, same as AG-26's forecast uniqueness constraint).

#### Observability

- `agent_runs`: `items_found` = meetings in scope, `items_processed` = packets actually written,
  `output_summary` = `{meetingIds: [...], sectionsWithRealData: N, sectionsFallback: N}`.
- `agent_decisions`: one `board_packet_generated` row per meeting, with the per-section
  data-availability breakdown from step 2/5 — a human asking "why does this packet look thin" reads
  this row, not the jsonb content itself.
- A `createNotification()` alert per successful packet (step 6) is itself an observability signal
  visible in-app, not just in `agent_runs`.

#### Cost / token budget

One Claude call per meeting (step 3), ~800-1,200 input tokens (pipeline + outcomes + financial
context, bounded by a typical org's near-term pipeline size) + ~300 output tokens (3-5 short,
grounded discussion items). At Sonnet's ~$3/$15-per-million pricing: roughly **$0.007 per packet**.
Board meetings are inherently infrequent (monthly-to-quarterly per org, per this feature's own
premise) — **well under $1/month total even at platform-wide scale in the near term**, the
cheapest agent in this batch by trigger frequency alone.

#### Model selection

`claude-sonnet-4-6`. Justification: identical complexity tier to AG-26's step 4 — bounded-context
narrative synthesis grounded in already-assembled real data, not open-ended generation and not
simple classification. No case for a cheaper or reasoning-tier model.

#### Autonomy level: full autonomy for generation, explicitly no submit/send capability at all

**This agent never sends anything to anyone** — it writes a packet a human opens in-app and an
in-app notification that a packet is ready. Per the original spec's own implication ("notify-only,
not submit-capable," carried forward from this section's prior PLANNED entry) and the global hard
limit `NEVER_SEND_EMAIL_WITHOUT_APPROVAL`, there is no code path in this design where the agent
emails the packet to board members directly — `viewed_by`/distribution is deliberately left to a
human-driven UI flow, not this agent. **Self-healing:** a failed meeting retries automatically via
the next daily schedule run (per Idempotency's trigger-level retry). **Runaway governance:** bounded
by real board-meeting cadence (a fundamentally infrequent, human-scheduled event this agent has no
ability to create or accelerate) and by one bounded Claude call per meeting with no fan-out.

**Autonomous Mode**
- **Status:** PLANNED (spec complete, awaiting build — see `queue-16.yaml`)
- **Trigger Type:** schedule (daily, 2:00 AM CST, 48h-window scope) + event (short-notice meeting creation/reschedule)
- **Trigger Condition:** see Trigger design above
- **Decision Log:** `board_packet_generated`, per meeting
- **Chain Output:** none
- **Hard Limits:** the global hard limits (Section 0) apply; explicitly never sends/distributes the packet itself, generation only
- **Human Review Required:** no approval gate on generation (nothing external happens); distribution/viewing is entirely human-driven by design, not an approval gate on this agent's own output

---

### AG-28: Follow-Up Generator Agent

> **Renumbering note, 2026-08-02:** AG-28 previously named a phantom "Impact Simulation Agent" spec
> with zero real code, ever (`FEATURE_REGISTRY_v2.md` #140–142, PLANNED). That spec has been moved
> to **AG-41** (Section 5, after AG-40) — it was never built and this renumbering doesn't change
> that. AG-28 is now permanently the real, live agent below, matching what the on-disk
> `agent_type` literal `"ag-28-followup"` has actually meant all along. **AG-28 must never be
> reassigned to anything else again** — see `AGENT_VERIFICATION_LOG.md`'s enum-gap entries and
> `NOT_BUILT_MASTER_INVENTORY.md` for the verification history behind this decision.

- **Purpose:** Generates and schedules stage-appropriate follow-up correspondence (check-in,
  thank-you, or feedback-request) the moment an application transitions to `submitted`, `awarded`,
  or `denied` — drafted for a human to review and send, never sent automatically.
- **Type:** AI (Claude, `DEFAULT_MODEL`) for the drafted email body; deterministic scheduling logic
  (14-day check-in after submission, 3-day thank-you after award) around it.
- **Tier Gate:** not separately gated beyond standard autonomous-agent access.
- **Real implementation:** `src/lib/agents/followup-generator-agent.ts`, class
  `FollowupGeneratorAgent extends AutonomousAgent`, `agentId: "ag-28-followup"` (matches the
  `agent_type` enum value, fixed live 2026-08-02). Writes one row per follow-up to
  `application_followups` (migration 081) — deliberately not the pre-existing, incompatible
  `follow_up_sequences` table (a template+enrollment pair with a different shape). Distinct from
  an older, unrelated agent of a similar name, `src/lib/agents/follow-up-generator.ts`
  (`FollowUpGeneratorAgent`, `BaseAgent` pattern, manually/chain-triggered, generates one fixed
  3-step sequence and stores it as an application note) — do not conflate the two files.
- **Live-verified 2026-08-02** (`AGENT_VERIFICATION_LOG.md`): completes a real run with zero enum
  errors. When no `agent_queue` item is actively `processing` for this org/agent, it completes
  immediately via its own documented no-op path (`"No valid follow-up trigger payload found..."`)
  rather than erroring — a full trigger-driven run (real `applicationId`/stage-transition payload)
  has not yet been exercised live in this log.

**Autonomous Mode**
- **Status:** ENABLED (event-driven)
- **Trigger Type:** event — fired by a pipeline stage transition, not a schedule or manual button.
- **Trigger Condition:** `POST /api/autonomous/followup-trigger` enqueues an `agent_queue` row
  (`agent_id: "ag-28-followup"`, `input_payload: { applicationId, newStage, previousStage }`) when
  an application moves to `submitted`, `awarded`, or `denied`; routed from the queue by
  `worker/autonomous-orchestrator.ts`'s `routeQueueItem()`.
- **Decision Log:** yes — logs a `agent_decisions` row per follow-up scheduled (`decisionType:
  "followup_scheduled"`, confidence 90 — routine, low-risk scheduling only).
- **Chain Output:** none.
- **Hard Limits:** file-level hard limit stated in its own header comment — schedules follow-ups
  only, every record created has `status: 'scheduled'`, this agent never sends an email itself.
- **Human Review Required:** yes — every drafted follow-up is queued for a human to review and
  send, per the global "never send email without approval" hard limit.

---

### AG-29: Knowledge Engine Indexer Agent

**Enterprise build spec, written 2026-08-03.** Canonical purpose unchanged: "continuously generates
and stores pgvector embeddings for `intelligence_funded_proposals`, `outcomes`, and
`foundation_directory` records, and aggregates `knowledge_patterns`." No dedicated agent class
exists (confirmed by grep — `src/lib/agents/`, zero matches for indexer/knowledge-engine/embed).
**Unlike every other agent in this batch, the hard part is already built and proven**:
`src/lib/intelligence/embeddings.ts`'s `generateEmbedding()`/`generateEmbeddingsBatch()` (OpenAI
`text-embedding-3-small`, real retry/backoff, real batching) is live-verified — a direct production
query found 105/105 `intelligence_proposal_sections` rows with genuine, non-null, content-varying
1536-dimension vectors. **This spec is about wrapping proven code in a real trigger, not building
new embedding logic.**

#### Scope correction, stated explicitly

The original spec's claimed embedding column, `intelligence_funded_proposals.embedding`, does not
exist (confirmed live) — the real column is `intelligence_proposal_sections.embedding`
(migration 048), already proven. `outcomes.embedding` and `foundation_directory.embedding` never
existed on either table at all — added live 2026-08-03 (migration 107,
`extensions.vector(1536)`, matching the exact type already proven on `intelligence_proposal_
sections`) specifically so this spec's full 3-source scope is buildable against real schema, not
two-thirds hypothetical.

#### Trigger design: genuine 24/7 autonomous operation — this agent's own purpose statement says "continuously," and the design should honor that literally

**This is the one agent in this batch built for true continuous/event-driven background
operation, not a periodic schedule.** Embedding generation has no meaningful "batch window" the
way a monthly forecast or a nightly enrichment sweep does — a new `intelligence_proposal_sections`/
`outcomes`/`foundation_directory` row with real text content and no embedding yet is immediately
useful to embed, since every consumer of these vectors (RAG retrieval, semantic search) benefits
from the freshest possible index with no reason to intentionally delay.

- **Primary trigger — event, per-insert.** Every write path that inserts a row into any of the 3
  source tables with non-null text content and a null `embedding` enqueues an `agent_queue` item
  (`trigger_source: "event"`), the same infrastructure `FollowupGeneratorAgent` (AG-28) already
  uses for its own event-driven design — reused, not reinvented.
- **Secondary trigger — continuous catch-up poll, not a fixed schedule.** `worker/index.ts` starts
  this agent's own poll loop at boot (the same pattern `queueProcessor.start()`/
  `ddRequestProcessor.start()` already establish for `worker/queue-processor.ts`/`worker/
  dd-request-processor.ts` — a `while(!shuttingDown)` loop with a short sleep between empty
  passes, not a cron entry), scanning for any row across the 3 tables with real content and a
  still-null `embedding` that the event trigger might have missed (a write path added later that
  forgets to enqueue, a queue item that failed and needs picking back up). Poll interval: 60
  seconds when the last pass found nothing (matching `queue-processor.ts`'s own `SLEEP_MS`
  convention), 0 seconds (immediately re-poll) when the last pass found and processed a full
  batch — genuinely continuous under real load, not artificially throttled.
- **Why not a nightly/weekly schedule, unlike most of this batch:** every other agent in this batch
  produces an advisory analytical artifact where staleness of hours-to-days is harmless. A search
  index is different — the entire value of "RAG retrieval pulls from the Knowledge Engine" (per
  `BLUEPRINT_v2.md`'s stated future integration) degrades the longer new content sits unembedded,
  and unlike the other agents, there is no natural "this doesn't need to be fresher than X" argument
  to justify batching it.

#### Input contract

| Source | Columns read | Notes |
|---|---|---|
| `intelligence_proposal_sections` | `id, proposal_id, section_type, section_text, embedding` | Scope: `embedding IS NULL AND section_text IS NOT NULL`. |
| `outcomes` | `id, organization_id, narrative_snapshot, funder_feedback, denial_reason, embedding` | Scope: `embedding IS NULL AND (narrative_snapshot IS NOT NULL OR funder_feedback IS NOT NULL)` — an outcome with neither field populated has no real text to embed and is correctly never selected, not an error case. |
| `foundation_directory` | `id, name, programs, enrichment, embedding` | Scope: `embedding IS NULL AND (programs IS NOT NULL OR enrichment->>'mission' IS NOT NULL)`. |
| `knowledge_patterns` (aggregation target, read for merge) | `pattern_type, category, sample_count, confidence` | Read before the aggregation step (below) to merge into, not overwrite. |

#### Process (numbered, with real branch logic)

1. **Claim a batch** (poll or event-triggered — same downstream logic either way): up to
   `EMBEDDING_BATCH_SIZE = 100` rows across the 3 source tables combined (matching
   `generateEmbeddingsBatch()`'s own existing 100-per-request design, reused not reinvented),
   prioritized event-triggered rows first, then oldest-pending catch-up rows.
2. **Branch on text availability, per row** (already scoped out at the query level in step 1's
   `WHERE`, but restated as an explicit branch since a race is possible — a row could be updated
   to null out its text between the scope query and processing): if the row's real text field is
   now empty/null, skip it silently, no error — not a failure, just no longer eligible.
3. **Chunk long text** (`chunkText()`, already real and proven in `embeddings.ts`, default
   500 tokens/chunk with 50-token overlap) — for `foundation_directory`, `programs` (jsonb array)
   is flattened to plain text first; for `outcomes`, `narrative_snapshot` +
   `funder_feedback`/`denial_reason` are concatenated with clear section labels so the resulting
   embedding represents the whole outcome, not just one field arbitrarily.
4. **Call `generateEmbeddingsBatch()`** (real, unmodified — this agent does not reimplement
   embedding generation, it calls the existing library function directly) on the batch's chunked
   texts.
5. **Write embeddings back.** For a chunked row (text exceeded one chunk), only the **first
   chunk's** embedding is stored in that row's single `embedding` column — this is a real,
   deliberate simplification stated plainly, not hidden: true multi-chunk-per-row embedding
   storage would need a join table (matching the pattern `intelligence_proposal_sections` itself
   already uses — one row per section, not one row per document), which is out of this spec's
   scope for `outcomes`/`foundation_directory` specifically since neither table is naturally
   pre-split into sections the way proposal text already is. Flagged as a known precision
   trade-off for a future session, not silently glossed over.
6. **Knowledge pattern aggregation** (the purpose statement's second half, distinct from
   embedding): runs as a **separate, lower-frequency pass** within the same agent — every 24
   hours (tracked via a `last_pattern_aggregation_at` value in `org_autonomous_config` or a
   dedicated small state row, whichever this agent's own build task finds cleaner — explicitly
   left as a build-time implementation choice, not over-specified here since it doesn't change
   behavior). Aggregates newly-embedded `outcomes` by `funder_category`/`opportunity_category`
   into `knowledge_patterns`, incrementing `sample_count` and recomputing `success_rate`/
   `confidence` — **merges into existing pattern rows (`WHERE pattern_type = X AND category = Y`),
   never overwrites wholesale**, consistent with `knowledge_patterns` being genuinely
   cross-session cumulative data.
7. **Log a decision only for the aggregation pass** (`decisionType: "patterns_aggregated"`,
   once/day) — **not per embedding batch**, since embedding generation is a high-frequency,
   low-individual-significance operation (per-batch decision logging at this volume would flood
   `agent_decisions` with noise no human would ever read) — `agent_runs` itself is the correct,
   sufficient audit trail for routine embedding activity (see Observability).
8. **Error isolation per row within a batch:** a single row's embedding failure (rare — mostly
   malformed/empty text after chunking) is caught, logged to `errors[]`, and that row is left with
   `embedding: null` for the next pass to retry — the rest of the batch proceeds unaffected.

#### Output contract

| Column | Table | Written as |
|---|---|---|
| `embedding` | `intelligence_proposal_sections` | `extensions.vector(1536)`, real OpenAI output |
| `embedding` | `outcomes` (new, migration 107) | same |
| `embedding` | `foundation_directory` (new, migration 107) | same |
| `knowledge_patterns` rows | (existing table) | merged/upserted, never replaced wholesale (step 6) |

#### Error handling and failure modes

- **Transient (OpenAI API):** the existing `generateEmbedding()` retry (3 attempts, exponential
  backoff `Math.pow(2, attempt) * 1000` — 1s/2s/4s, the real, already-proven implementation, not
  a new one this agent adds) is reused as-is via `generateEmbeddingsBatch()`.
- **Permanent failure for one row:** caught per-row (step 8) within the batch, `embedding` stays
  null, naturally retried by the next poll pass (the row is still selected by the same `WHERE
  embedding IS NULL` scope query) — no separate dead-letter table needed, retry is inherent to the
  continuous-poll design itself.
- **Total run failure** (e.g. OpenAI fully down, all 3 retries exhausted for the whole batch): the
  poll loop's own outer error boundary logs and sleeps the standard interval before trying again —
  matching `queue-processor.ts`'s own established crash-resilience pattern (a single bad pass
  doesn't kill the whole worker process), not a new pattern.

#### Idempotency

Re-processing is structurally prevented, not just handled gracefully: the scope query itself
(`embedding IS NULL`) excludes any row that already has a real embedding, so a row can never be
embedded twice by this agent's normal operation. The only way to force re-embedding is an explicit
`embedding = NULL` reset by a human/migration — which is the correct behavior (embeddings should be
stable once computed from unchanged text) and requires no special-casing in this agent's own logic.
Pattern aggregation (step 6) is idempotent by construction via its merge-not-replace upsert.

#### Observability

- `agent_runs`: **one row per batch processed**, not per individual embedding (at potentially
  hundreds of embeddings/day under real load, a per-item `agent_runs` row would be excessive
  volume for no diagnostic benefit) — `items_found`/`items_processed` = batch size,
  `output_summary` = `{sourceBreakdown: {sections: N, outcomes: N, foundations: N}, failed: N}`.
- `agent_decisions`: only the daily `patterns_aggregated` entry (step 7) — a human debugging
  "why is search quality degrading" checks recent `agent_runs` rows' `failed` counts and
  `errors[]` text directly, without needing to read source code to understand what happened.
- `worker_status` heartbeat (the existing platform-wide worker health table) reflects this agent's
  poll loop the same way `queue-processor.ts`'s loop already does — a stalled indexer is visible
  in the same place a stalled submission queue already would be, not a new monitoring surface.

#### Cost / token budget

OpenAI `text-embedding-3-small` pricing (not Claude — this is the one agent in this batch that
uses a different model family entirely, per its own original spec): approximately $0.02 per
million tokens as of this spec's writing (re-verify current pricing before relying on this
long-term). At `EMBEDDING_BATCH_SIZE = 100` rows/batch, ~200 tokens/row average (post-chunking):
~20,000 tokens/batch ≈ **$0.0004/batch**. At a sustained real-world rate of a few hundred new
rows/day across all 3 sources combined (a generous estimate at current platform content-creation
volume): **a few cents per day, well under $5/month** — by far the cheapest agent in this batch
per unit of real work done, since embedding models are priced roughly two orders of magnitude
below a comparable-volume Claude workload.

#### Model selection

`text-embedding-3-small` (OpenAI, not Claude) — **unchanged from the original spec, and correct
as originally scoped.** Justification: embedding generation is a fundamentally different task
class from every other agent in this batch (numeric vector representation, not text generation or
synthesis) — no Claude model tier is the right tool for this job at all, and substituting one
would be strictly worse on both cost and fitness-for-purpose. This is the one agent in this batch
where "which Claude model" is the wrong question entirely, stated explicitly rather than defaulting
to `DEFAULT_MODEL` out of pattern-matching habit.

#### Autonomy level: full autonomy, 24/7, no human-approval gate — this batch's clearest case for it

**No external action, no financial/pipeline write, no content generation a human would need to
review** — this agent transforms existing, already-approved text into a numeric index of that same
text. There is no meaningful sense in which a human could "approve" an embedding vector. **This is
the correct default-to-full-autonomy case the other agents in this batch had to individually
justify against; this one needs no such justification — it is definitionally advisory
infrastructure, one layer more removed from action than even AG-10's analytical profile.**
**Self-healing:** the continuous poll loop retries any row that failed on its own, every pass,
indefinitely, with no manual intervention ever required for a transient failure. **Rate/cost
governance so it cannot runaway-spend:** hard-capped at `EMBEDDING_BATCH_SIZE = 100`/poll pass, the
poll loop sleeps 60s between empty passes (bounding worst-case polling frequency even under a bug
that somehow made every pass "empty" instantly), and cost is inherently self-limiting since it can
only ever process rows that genuinely exist with genuinely null embeddings — there is no code path
by which this agent could process the same content twice or spend against synthetic/looped input.

**Autonomous Mode**
- **Status:** PLANNED (spec complete, awaiting build — see `queue-19.yaml`)
- **Trigger Type:** event (per-insert, all 3 source tables) + continuous background poll (not a fixed schedule)
- **Trigger Condition:** any row across the 3 sources with real text content and `embedding IS NULL`
- **Decision Log:** `patterns_aggregated`, once/day only (embedding activity itself is not
  individually decision-logged, per Observability's stated reasoning)
- **Chain Output:** none
- **Hard Limits:** the global hard limits (Section 0) apply
- **Human Review Required:** no — see Autonomy level above

---

> **AG-30 renumbered, 2026-08-02.** This document used to have two separate `### AG-30:` sections —
> a phantom "Change Monitor Agent (CM-01)" here (zero real code, ever;
> `FEATURE_REGISTRY_v2.md` #96, PLANNED) and the real, live `### AG-30: Donor Intent Monitor`
> section further below in the Phase 2-5 addendum. That was the actual collision: not an
> on-disk-literal mismatch like AG-28's, but this single document contradicting itself about what
> "AG-30" means. Resolved by moving the phantom Change Monitor spec to **AG-42** (Section 5, after
> AG-41) — see it there; it was never built and this renumbering doesn't change that. **AG-30 is
> now permanently and unambiguously Donor Intent Monitor** (`agentId: "ag-30-donor-intent"`,
> matches the `agent_type` enum value, fixed live 2026-08-02, live-verified working the same day —
> see `AGENT_VERIFICATION_LOG.md`). Its full spec is unchanged and still lives at the Phase 2-5
> `### AG-30: Donor Intent Monitor` section — not duplicated here to avoid two copies drifting
> apart. **AG-30 must never be reassigned to anything else again.**

---

### AG-41: Impact Simulation Agent

> **Renumbered from AG-28, 2026-08-02.** Content below is a full enterprise spec written
> 2026-08-03 — purpose unchanged from the original never-built AG-28 spec, only the number moved
> (to free AG-28 for the real, live `FollowupGeneratorAgent`) and the engineering depth added.

**Purpose (unchanged):** Models what-if strategic scenarios (financial, capacity, beneficiary
impact) before a decision is made. No implementation exists (confirmed by grep). Output table
`impact_simulations` existed only as an unapplied migration — applied live 2026-08-03 (migration
078, RLS added migration 105).

#### Trigger design: manual only — deliberately no schedule or event trigger

**This is the one agent in this batch where autonomous/background triggering would be actively
wrong, not just unnecessary.** A what-if scenario only has meaning in response to a specific
question a human is actually asking ("what happens if we lose our top funder," "what if we cut the
housing program's budget 20%") — there is no natural cadence or data event that should cause this
agent to spontaneously generate a hypothetical nobody asked for. **Trigger:** a real API route
(`POST /api/agents/simulate`, this spec's own small addition, mirroring the existing
`requireRole("writer")` + server-derived `organizationId` pattern every other write-triggering
route in this codebase already uses) called directly from a UI form where a human selects a
scenario type and its parameters. `trigger_source: "manual"` on every `agent_runs` row this agent
ever produces — there is no other value that row should ever take for this specific agent.

#### Input contract

| Source | Columns read | Notes |
|---|---|---|
| `organizations` | `annual_budget, total_staff, total_volunteers` | Baseline scale, for every scenario type. |
| `funders` | `id, name, annual_giving_budget` | For `lose_funder`/`gain_funder` scenarios. |
| `outcomes` | `organization_id, result, awarded_amount, recorded_at` | Historical realized revenue, filtered to trailing 12 months, for baseline calibration. |
| `opportunities` | `organization_id, funder_id, amount_min, amount_max, status, deadline` | Open pipeline, for scenarios that ask "what if a funder's opportunities disappeared/appeared." |
| `funding_forecasts` | `org_id, forecast_period, projected_most_likely, factors` | **Real cross-agent input** — this agent's baseline-case number for `lose_funder`/`gain_funder`/`budget_cut` scenarios is AG-26's most recent `'12_month'` forecast, not a number this agent recomputes independently. If no forecast row exists yet (AG-26 hasn't run for this org), the agent computes a minimal fallback baseline directly from `outcomes`' trailing-12-month sum and states in `simulation_result.methodology` that it used the fallback, not AG-26's real forecast. |

#### Process (numbered, with real branch logic)

1. **Validate `scenario_type`** against a fixed, supported set — **not arbitrary free text**, since
   an unbounded scenario space cannot get grounded deterministic math (step 2) and would push this
   entire agent into pure, ungrounded Claude speculation, which is exactly the failure mode a
   "what would embarrass a senior engineer" spec must not permit. Four supported types, chosen to
   cover the realistic strategic questions this feature's own purpose statement names (financial,
   capacity, beneficiary impact): `'lose_funder'`, `'gain_funder'`, `'program_expansion'`,
   `'budget_cut'`. An unsupported `scenario_type` is rejected at the API layer (400, before
   `startRun()` is ever called) — not a failure this agent's own error handling needs to absorb.
2. **Load the real baseline** (organizations + trailing-12-month outcomes + the most recent
   `funding_forecasts` row per the input contract's fallback rule).
3. **Branch on `scenario_type`, each with real deterministic math first:**
   - **`lose_funder`** (`scenario_params: {funderId}`): sum that funder's trailing-12-month
     `outcomes.awarded_amount` plus the `amount_min`/`amount_max` midpoint of their still-open
     `opportunities`; compute this as a % of the baseline forecast. If this funder has zero
     historical outcomes and zero open opportunities (a funder on file that's never actually
     produced anything), the deterministic impact is genuinely $0 — the agent states this plainly
     rather than inventing a hypothetical loss for a funder that was never contributing.
   - **`gain_funder`** (`scenario_params: {estimatedAnnualAmount}`): the human-supplied estimate
     is added directly to the baseline — this scenario type is explicitly speculative by its own
     input (there's no real funder to derive numbers from), so `confidence` is capped at 50
     regardless of anything else, and `simulation_result` states plainly that this projection
     depends entirely on the accuracy of the human-supplied estimate, not platform data.
   - **`program_expansion`** (`scenario_params: {newProgramAnnualBudget, additionalStaffCount}`):
     computes the ratio of the new cost against `organizations.annual_budget` and flags (not
     blocks — this agent never blocks a real decision) if the addition would exceed a
     configurable threshold of current budget (default 25%) as a `key_risks` entry.
   - **`budget_cut`** (`scenario_params: {cutPercentage}`): applies the cut against the baseline
     forecast and — this is the "beneficiary impact" half of the purpose statement — cross-
     references `organizations`' program data (via `knowledge_base` category `program_description`
     rows, already real and populated per this project's own history) to name which real, on-file
     programs would be most exposed, rather than a generic "services may be reduced" non-answer.
4. **One Claude call per simulation** (never per-scenario-branch fan-out — one simulation is one
   call): given the deterministic baseline and branch-specific numbers from step 3, ask Claude to
   write `key_risks`, `key_opportunities` (mitigating factors, e.g. "3 other funders in the
   pipeline could offset part of this"), and a plain-language narrative summary — the same
   grounded-synthesis-over-real-numbers pattern as AG-26/AG-27, not free-floating speculation.
5. **Write `impact_simulations`** (see Output contract).
6. **Log a decision** (`decisionType: "simulation_completed"`), `actionPayload` containing the
   scenario type and headline number.
7. **This agent processes exactly one scenario per `run()` call** (unlike every other agent in
   this batch, which loop over multiple orgs/funders/meetings) — there is no batch/loop error
   isolation to design, since a manual, single-scenario trigger has nothing to isolate a failure
   from. The outer `try/catch` around `run()`'s body is the only error boundary needed.

#### Output contract

`impact_simulations` (migration 078, live 2026-08-03):

| Column | Written as |
|---|---|
| `org_id` | the requesting org |
| `scenario_type` | one of the 4 supported values (step 1) |
| `scenario_params` | the human-supplied input, stored verbatim for audit/reproducibility |
| `simulation_result` | jsonb: `{baselineUsed: 'forecast'\|'fallback', deterministicImpact: {min,max,mostLikely}, keyRisks: [...], keyOpportunities: [...], narrative: string, exposedPrograms: [...] (budget_cut only)}` |
| `confidence` | text (not numeric — deliberately coarser than the other agents' 0-100 scores, since a hypothetical scenario's "confidence" is inherently a judgment call, not a measurable statistic): `'high'` (real funder/forecast data used throughout), `'medium'` (fallback baseline used), `'low'` (`gain_funder`, inherently speculative input) |
| `created_by` | the requesting user's profile id (real, since this is always a manual, human-initiated action) |

#### Error handling and failure modes

- **Transient (Claude API):** 3 attempts, exponential backoff (1s/2s/4s). On exhaustion, the
  simulation still writes with the full deterministic `deterministicImpact` numbers (step 3) and
  empty `keyRisks`/`keyOpportunities`/`narrative`, `confidence` unchanged — the numeric projection
  is real and useful even without the narrative layer.
- **Permanent failure:** since this agent processes one scenario per call with no internal loop
  (step 7), a permanent failure fails the whole (single-item) run — correctly calls `failRun()`,
  and the API route surfaces a real error to the human who requested it (this is a synchronous,
  human-waiting-for-a-response action, unlike every other agent in this batch — the human gets an
  immediate, real answer, not a silent background retry).
- **Dead-letter:** not applicable — a failed simulation is simply re-requested by the human if they
  still want an answer, exactly like any other synchronous API action failing.

#### Idempotency

**Re-running the same scenario twice is expected, normal behavior, not a bug to prevent** — a human
comparing "what if we cut 10%" against "what if we cut 20%" runs this agent multiple times with
different `scenario_params` by design, and running the *exact same* params twice should simply
produce a second, independent `impact_simulations` row (no upsert, no uniqueness constraint) —
unlike every other agent in this batch, idempotency here means "each simulation is its own
immutable historical record," not "never double-write." This is a deliberate, stated design choice:
a board later asking "what scenario did we actually run before making this decision" needs the
real historical record of every simulation requested, not a single mutable row that the next
request would silently overwrite.

#### Observability

- `agent_runs`: one row per simulation request, `items_found`/`items_processed`: 1/1 (or 1/0 on
  failure) — this agent's `agent_runs` history is itself a complete audit trail of every "what if"
  ever asked, by whom (`triggered_by`), and when.
- `agent_decisions`: one `simulation_completed` row per run, `entityType: "organization"`, headline
  number in `actionPayload`.
- Because this is a synchronous, human-waiting action, the primary observability channel is the
  API response itself, not a human needing to check `agent_runs` after the fact — logging still
  happens for the same audit-trail reason every other agent in this codebase logs.

#### Cost / token budget

One Claude call per simulation, ~600-900 input tokens (baseline + branch-specific numbers,
bounded) + ~400 output tokens (narrative + risk/opportunity lists). At Sonnet's ~$3/$15-per-million
pricing: roughly **$0.008 per simulation**. Volume is inherently human-paced (nobody runs hundreds
of what-ifs per day) — realistically **a few dollars a month at most even under heavy strategic-
planning-season usage**, not a cost concern at any plausible scale.

#### Model selection

`claude-sonnet-4-6`. Justification: same bounded-synthesis-over-real-numbers tier as AG-26/AG-27.
Explicitly **not** a reasoning/extended-thinking tier model, despite "strategic scenario modeling"
sounding like it might warrant one — the actual hard part (the deterministic math per scenario
type) is already done in code before Claude is ever called; the model's job is narrative synthesis
over a small, already-computed number set, not multi-step reasoning from scratch.

#### Autonomy level: human-triggered by design, not a gate on an otherwise-autonomous agent

This is not "autonomy with an approval gate bolted on" — it's a fundamentally on-demand tool, the
same category as a calculator or a report generator, not a background monitor with a human check
before it acts. It never runs unless a human asks a specific question (Trigger design above), and
its output is read-only advisory data no other process acts on automatically (`Hard Limits`,
carried forward unchanged: "never overwrites live financial/pipeline data — a simulation is a
read-only projection by definition"). **Self-healing/runaway governance are structurally
inapplicable** — there is no autonomous loop to heal or govern; volume is bounded by real human
request rate, which needs no code-level rate limit beyond the standard per-org `agent_runs` quota
already enforced platform-wide for every agent route.

**Autonomous Mode**
- **Status:** PLANNED (spec complete, awaiting build — see `queue-17.yaml`)
- **Trigger Type:** manual only (`POST /api/agents/simulate`)
- **Trigger Condition:** a human submits a valid `scenario_type` + `scenario_params`
- **Decision Log:** `simulation_completed`, one per run
- **Chain Output:** none
- **Hard Limits:** the global hard limits (Section 0) apply; never overwrites live
  financial/pipeline data — a simulation is a read-only projection by definition
- **Human Review Required:** no approval gate needed (nothing external happens, output is
  read-only advisory data) — but note this is different from "fully autonomous": the entire
  action only exists *because* a human triggered it, every time

---

### AG-42: Change Monitor Agent (CM-01)

> **Renumbered from AG-30, 2026-08-02.** Content below is a full enterprise spec written
> 2026-08-03 — purpose unchanged from the original never-built AG-30/CM-01 spec, only the number
> moved (to leave AG-30 permanently the real, live Donor Intent Monitor) and the engineering depth
> added.

**Purpose (unchanged):** Detects changes in monitored corporate entities (website, leadership, IRS
BMF status) and triggers re-enrichment. No implementation exists (confirmed by grep). Output table
`corporate_monitoring_events` existed only as an unapplied migration (`src/supabase/migrations/
077_intelligence_graph.sql`) — applied live 2026-08-03 (RLS added migration 105).

#### Scope correction, stated explicitly rather than silently narrowed

The canonical purpose names "corporate entities" and the real, already-designed output table is
keyed by `prospect_id` (→ `corporate_prospects`) — but `corporate_prospects` **does not exist in
production** (confirmed live, 404, the same shared blocker as AG-20/21/22/24/32). Building this
agent scoped *only* to a table that doesn't exist would make it permanently untestable and
permanently non-functional, which fails this spec's own live-verification requirement before it's
even built. **This spec extends the monitored-entity scope to also cover `foundation_directory`**
— real, populated (133,000+ rows), and a legitimate match for the canonical purpose's own named
signal ("IRS BMF status" is literally a `foundation_directory` field:
`foundation_type`/`subsection_code`/`status`, sourced from the IRS Business Master File). This is
not scope invention beyond the agent's stated purpose — "IRS BMF status" was already named in the
purpose statement before this spec existed; it simply had no buildable/testable home under the
`corporate_prospects`-only design. The `corporate_prospects` half of this agent is still fully
specified below and will activate automatically once that table exists (see step 1's graceful
degradation) — nothing about it is removed, only made non-blocking.

#### Trigger design

**Schedule only — daily, 5:00 AM CST** (ahead of the `foundation-enrichment-weekly` job already in
`worker/scheduler.ts`, so a detected change can be re-enrichment-queued and picked up by that same
run later the same week rather than waiting a further week). **Rationale:** "did this entity's
website/leadership/status change" is a slow-moving, non-urgent signal — nothing about it warrants
event-driven immediacy, and a daily sweep bounded by a per-run cap (below) keeps the platform's
full monitored set cycled through on a predictable, cost-governed cadence rather than either
checking everything nightly (wasteful — most entities don't change day to day) or waiting for a
human to notice and manually re-trigger (defeats the entire point of a change *monitor*).

#### Input contract

| Source | Columns read | Notes |
|---|---|---|
| `corporate_prospects` | (schema not live — see Scope correction; once it exists, expected shape per its own design intent: `id, legal_name, website, enrichment` — this agent reads it defensively, exactly like every other agent in this codebase already does for this same table, and simply finds zero rows today) | |
| `foundation_directory` | `id, name, website, officers, foundation_type, subsection_code, status, enrichment, enriched_web_at` | The real, working half of this agent's scope. `officers` is real jsonb (populated by the existing 990/web enrichment pipeline). |
| `corporate_monitoring_events` (self, read-before-write) | `prospect_id, change_detected, created_at` | Most recent prior snapshot per prospect, for diffing (see Idempotency). |

#### Process (numbered, with real branch logic)

1. **Build scope, capped per run** (`MAX_ENTITIES_PER_RUN = 200` — a deliberately bounded daily
   sweep, not a full-table scan; see Cost budget for why):
   - `corporate_prospects`, ordered by last-checked ascending — **query wrapped in the same
     try/catch-and-treat-as-empty pattern already established for this exact table elsewhere in
     this codebase** (e.g. `DonorIntentMonitorAgent`'s own handling), so a missing table degrades
     to "zero prospects in scope" rather than failing the whole run.
   - `foundation_directory`, ordered by `enriched_web_at ASC NULLS FIRST` (never-checked rows
     first, then oldest-checked), filtered to rows enriched at least once already (a
     never-enriched row has no baseline to diff against — that's this agent's own enrichment
     agent's job, not this one's, per Core Data Principle of not duplicating another agent's
     responsibility).
2. **Per entity, fetch current state:**
   - **Website check:** a lightweight HTTP HEAD/GET against the on-file `website` URL (reusing
     `StealthEngine.fetchPage()`, the same fetcher every other web-touching agent in this codebase
     already uses — not a new HTTP client). A changed final-redirect URL, or a 404/timeout where
     the site previously resolved, is itself a real, loggable change signal, not just a fetch
     failure to swallow silently.
   - **Leadership/status check (foundation_directory only — no live web fetch needed):** compares
     the row's current `officers` jsonb and `foundation_type`/`subsection_code`/`status` against
     the last snapshot stored in that row's own `enrichment.change_monitor_snapshot` key (see
     Output contract) — this is a pure diff against already-enriched data, catching drift produced
     by *other* agents' enrichment runs since this agent last looked, not a fresh Claude
     extraction. This deliberately reuses data other agents already gathered rather than
     re-deriving it.
3. **Branch on diff result:**
   - **No change:** update the last-checked timestamp only (`foundation_directory.enriched_web_at`
     is intentionally *not* touched here — that column means "the web-enrichment agent last ran,"
     a different fact than "the change monitor last checked"; this agent's own check timestamp
     lives in `enrichment.change_monitor_last_checked_at`, a new key in the same real jsonb
     column, not a new top-level column). No event row, no Claude call — the common case is cheap
     by design.
   - **A real change detected** (website URL changed, an officer name present in the old snapshot
     is absent from the new one, or `status`/`foundation_type` differs): **one Claude call** (see
     step 4) to characterize the change in plain language, then write the event/update (Output
     contract) and **chain-queue re-enrichment** — `queueChainedAgent('foundation-990-enrichment',
     priority: 50, {foundationId})` for a `foundation_directory` change (routing to the existing,
     already-real weekly enrichment pipeline, run out-of-cycle for just this one entity rather than
     waiting for the next full weekly sweep), or the equivalent prospect-enrichment chain target
     once `corporate_prospects`/its enrichment agents exist.
4. **Claude call (only on a detected change, never on the common no-change case — see Cost
   budget):** given the old snapshot and new snapshot, ask for a one-sentence plain-language
   description of what changed and a `severity` classification (`'minor'` — e.g. a title update on
   an unchanged website; `'notable'` — a leadership change or site redesign; `'material'` — a
   status/foundation-type change, which can affect eligibility scoring elsewhere in the platform).
5. **Log a decision** (`decisionType: "entity_change_detected"`) only for `'notable'`/`'material'`
   severity — a `'minor'` change is recorded in the event/enrichment write (step 3) but does not
   also generate a decision-log entry, keeping `agent_decisions` reserved for changes a human would
   actually want surfaced, not every trivial diff.
6. **Error isolation per entity:** each entity's steps 2-5 run in its own `try/catch` — one
   unreachable website or malformed jsonb never blocks the rest of the day's 200-entity sweep.

#### Output contract

**`corporate_monitoring_events`** (migration 077, live 2026-08-03) — used once `corporate_prospects`
exists: `id, prospect_id, event_type ('website_changed'|'status_changed'), description,
change_detected (jsonb: {field, oldValue, newValue, severity}), created_at`.

**`foundation_directory.enrichment`** (existing real jsonb column, extended with new keys under
this agent's own namespace to avoid colliding with the existing `propublica`/other enrichment
sources already stored there): `enrichment.change_monitor_snapshot` (the current officers/status/
website snapshot, for next run's diff), `enrichment.change_monitor_last_checked_at`,
`enrichment.change_monitor_last_change` (`{description, severity, detectedAt}`, only present when
a change was ever found — absent, not null, when no change has ever been detected, so its mere
presence is itself a meaningful signal).

#### Error handling and failure modes

- **Transient (website fetch timeout, Claude API):** 3 attempts, exponential backoff (1s/2s/4s).
  On website-fetch exhaustion specifically, the failure to reach a previously-reachable site *is
  itself* logged as a `'notable'`-severity change (a site going unreachable is real signal, not
  noise to discard) rather than silently retried forever.
- **Permanent failure for one entity:** caught per-entity (step 6), pushed to `errors[]`, loop continues.
- **Total run failure:** outer `try/catch` → `failRun()`.
- **`corporate_prospects` missing entirely:** not a failure at all (per step 1's graceful
  degradation) — `itemsFound` for that half of the scope is simply 0, and `output_summary` states
  this plainly rather than the run failing or silently pretending that half of its job doesn't
  exist.

#### Idempotency

Re-running twice on the same day (e.g. a manual re-trigger) is safe because every write is either
(a) a genuinely new, timestamped `corporate_monitoring_events` row — a second run finding the exact
same change again would write a second event, which is correct, not a bug: an unresolved change
that's still present on a later check is real information ("still broken as of today"), not a
duplicate to suppress — or (b) an overwrite of `foundation_directory.enrichment`'s
`change_monitor_snapshot`/`_last_checked_at` keys, which are always replaced wholesale with the
current state, never appended to — running twice with no real change in between produces the exact
same final jsonb value both times (true idempotence for the directory-scoped half), while the
event-log half is intentionally append-only (idempotence at the "correctness" level — never
corrupts or double-counts — not at the "identical output" level, which is the correct distinction
for an event log vs. a snapshot).

#### Observability

- `agent_runs`: `items_found` = entities in scope (both halves combined), `items_processed` =
  entities actually checked (excludes any skipped by transient failure), `output_summary` =
  `{corporateProspectsChecked, foundationDirectoryChecked, changesDetected, corporateProspectsTableMissing: bool}`.
- `agent_decisions`: one `entity_change_detected` row per `'notable'`/`'material'` change (step 5) —
  a human debugging "why did this foundation get re-enriched out of cycle" reads this row first.
- The chained re-enrichment queue item itself (step 3) is independently visible in `agent_queue`,
  giving a second, cross-checkable trail from "change detected" to "re-enrichment actually ran."

#### Cost / token budget

Claude is called **only on a detected change** (step 4), not per entity in scope — the common case
(no change) costs one lightweight HTTP fetch and zero tokens. Estimated real change rate: low
single-digit percent of entities per daily check (organizational websites/leadership don't churn
often). At `MAX_ENTITIES_PER_RUN = 200`/day and a generous 5% daily change rate: ~10 Claude calls/
day, ~300 input + ~100 output tokens each (a tightly bounded single-sentence classification task).
At Sonnet's ~$3/$15-per-million pricing: **roughly $0.01/day, well under $1/month** — this agent's
real cost driver is the 200 daily website fetches (infrastructure cost, not token cost), not Claude
usage.

#### Model selection

`claude-sonnet-4-6`. Justification: this is the lightest-weight Claude task in this entire batch —
a single-sentence classification over a small, pre-computed diff, not synthesis or extraction from
raw text. Sonnet is used for consistency with every other agent in this batch and the platform's
established default (`DEFAULT_MODEL`) rather than because this specific call demands that tier —
a cheaper/faster model would likely suffice here if the platform ever introduces one as a distinct
tier; noting this honestly rather than over-justifying a choice made mainly for consistency.

#### Autonomy level: full autonomy, no human-approval gate — with an explicit escalation path for material changes

**This agent never takes an external action itself** — the "re-enrichment" it triggers is itself
another agent's existing, already-autonomous, already-approved pipeline (the weekly foundation
enrichment job), not a new capability this agent invents authority to invoke. Per the global hard
limits, human review is reserved for external actions and financial/pipeline writes; this agent
does neither. **Self-healing:** per-entity failures retry automatically on the next daily sweep
(entities aren't removed from scope on failure, they simply reappear in tomorrow's ordered-by-
last-checked query). **Runaway governance:** hard-capped at `MAX_ENTITIES_PER_RUN = 200`/day
regardless of platform growth (excess entities roll to the next day, exactly like AG-10's
`MAX_FUNDERS_PER_SCHEDULED_RUN` design), and Claude is invoked only on an actual detected change,
not per entity scanned — cost scales with real-world change events, not with monitored-set size.
**Material-severity changes still don't require approval before this agent acts** (queueing
re-enrichment is a safe, read-only-triggering action) but are the one output this agent produces
that's specifically flagged (`agent_decisions`, step 5) for a human to *notice*, even though none
is required to *approve* it first — the right design for a detector whose job is surfacing signal,
not gatekeeping a decision.

**Autonomous Mode**
- **Status:** PLANNED (spec complete, awaiting build — see `queue-18.yaml`)
- **Trigger Type:** schedule — daily, 5:00 AM CST
- **Trigger Condition:** unconditional daily sweep, capped at 200 entities/run, oldest-checked first
- **Decision Log:** `entity_change_detected`, notable/material severity only
- **Chain Output:** `foundation-990-enrichment` (real, existing) on a detected `foundation_directory`
  change; the equivalent prospect-enrichment chain once `corporate_prospects` exists
- **Hard Limits:** the global hard limits (Section 0) apply
- **Human Review Required:** no — see Autonomy level above

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

## 8. Fully Agentic Agents

A requested list of six agents said to implement "a perception-decision-execution loop with
self-calibration," each with a specific characterization of its branching/learning logic. Per this
document's audit methodology, each claim below was checked against the actual file rather than
accepted as given. Two agents match their stated description closely; four don't, either because
the described capability isn't present in the named file, or because the description actually
matches a *different* file than the one the requested AG-number implies (this codebase's AG-number
collisions, cataloged in Sections 1.4 and the Phase 2-5 Numbering note above, strike again here).
Real class names and `agentId` literals are used as the source of truth, not the requested AG-XX
numbers, which don't align with either this document's canonical numbering (Section 3/5) or the
on-disk `agent_type` literals (Section 1.4).

| Requested label | File | Verified against code |
|---|---|---|
| AG-02 OpportunityDiscovery | `opportunity-discovery-agent.ts` (`ag-17-discovery`, this doc's canonical AG-17) | **Partially confirmed.** Real decision logic found: `queueChainedAgent("ag-15-probability", 7, {opportunityIds})` fires only `if (config.auto_score_enabled && newOpportunityIds.length > 0)` (line 434-435) — a genuine conditional branch, not unconditional chaining. Dedup checks both `url` and `name` against existing `opportunities` before insert (lines 219-242), a documented workaround for `opportunities` having no `source_url` column. **Not confirmed:** "strategy branching based on historical performance" — no code path was found that reads `agent_runs`/`outcomes` history to alter discovery strategy. The branching that exists is a single boolean config gate, not a performance-driven strategy switch. |
| AG-03 ProbabilityScoring | `probability-scoring-agent.ts` (`ag-15-probability`, this doc's canonical AG-15) | **Partially confirmed.** Genuine chain logic: `queueChainedAgent("ag-05-draft", 8, {...})` fires only if `result.score >= config.auto_draft_threshold && config.auto_draft_enabled` (lines 202-206) — a two-part gate. **Not confirmed:** "self-calibrating against actual outcomes" — this file has no Claude call and no `.insert`/`.upsert` of its own; it delegates scoring to `computeGrantProbability()` in `src/lib/intelligence/grant-probability-engine.ts`, which was not audited as part of this pass. Whether *that* function self-calibrates against `outcomes` was not verified. Also note (Section 5, AG-15 spec): **this class is never imported anywhere in the repo** outside its own file — the orchestrator wires in a different class, `SuccessProbabilityAgent`, instead. |
| AG-05 DraftGeneration | `draft-generation-agent.ts` (`ag-05-draft`) | **Confirmed, closest match of the six.** Real multi-phase flow with two hard gates: (1) daily-cap gate — counts today's `auto_generated=true` applications, skips entirely if `>= max_auto_drafts_per_night` (lines 379-416); (2) Digital-Twin-completeness check — below-threshold completeness fires a deduped notification but still proceeds; (3) context assembly from KB + proven narratives + Twin + `platform_learning_patterns`; (4) the Claude drafting call itself (`maxTokens: 4000`, line 657); (5) confidence computed then reduced by a twin-completeness penalty (`(100 - completeness) * 0.3`, lines 667-679) before the application is inserted with `pending_review=true` unconditionally. Five distinguishable phases, and phase (1) is a genuine compliance-style gate. Caveat: this class is only imported by its own unit test — production code calls a different function, `generateDraft()`, instead (Section 5, AG-06 spec). |
| AG-06 RelationshipBuilder | `relationship-builder-agent.ts` (`ag-19-relationship`, this doc's canonical AG-19) | **Not confirmed as described.** Verified logic is a per-funder loop computing `relationship_score`/`momentum` from `relationship_memory` + `outcomes`, upserting a score, then conditionally generating a Claude recommendation with a dedup check against existing `relationship_recommendations`. No graph traversal of any kind — this file never touches `pig_nodes`/`pig_edges`. "Multi-hop network traversal" instead accurately describes a **different** agent: `relationship-graph-builder-agent.ts` (AG-32, `FEATURE_REGISTRY_v2.md` #220, BUILT), which reads/writes `pig_nodes`/`pig_edges` and ships a Graph Analytics panel with cross-rule pattern detection. Also note: `relationship-builder-agent.ts` is never imported anywhere outside its own file — the orchestrator wires in `FunderRelationshipAgent` (`funder-relationship.ts`) instead. |
| AG-07 DeadlinePrediction | `deadline-prediction-agent.ts` (`ag-25-deadline-prediction`) | **Not confirmed as described, and orphaned.** Verified logic: for each funder, computes a predicted next-cycle deadline from that funder's own historical `opportunities.deadline` pattern (single source — `opportunities` — not multiple sources), skips if an open opportunity already exists for that funder, else inserts a synthetic predicted `opportunities` row citing a confidence % and cycle count. This is pattern detection over one table, not "multi-source." More importantly: **this exact file is never imported anywhere** — repo-wide grep confirms both the API route (`/api/agents/deadline-prediction`) and `worker/autonomous-orchestrator.ts` import a same-named-but-different class from `deadline-prediction.ts` instead (Section 5, AG-25 spec has full detail on this collision). Feature #201's "AG-25 Autonomous Deadline Prediction: BUILT" refers to whichever class is actually wired — not this file. |
| Digest Agent | `autonomous-digest-agent.ts` (`ag-digest`) | **Partially confirmed.** Real decision gate: if all 7 overnight-activity counters sum to zero, the run completes immediately with `"No overnight activity -- digest skipped"` and **never calls Claude** (lines 115-130) — a genuine "don't waste a call on nothing to say" gate, which is a defensible reading of "intelligent priority curation." **Not confirmed:** "adaptive learning" — no code path reads historical digest performance or user engagement to adjust future digests; the summarization call (`maxTokens: 400`, lines 138-144) is a straightforward one-shot summary of the current night's counters. Genuinely wired into `worker/autonomous-orchestrator.ts:801-805`'s `runDigestPipeline()`. |

---

## Phase 2-5 Agent Specifications

**Status as of July 19, 2026 (re-audited from `src/lib/agents/`, `worker/autonomous-orchestrator.ts`,
and repo-wide import grep — supersedes the July 19, 2026 "none of these agents exist" edition of this
section):** eight of the twelve agents below now have real files with real logic ??? AG-29, AG-30,
AG-35, AG-36, AG-37, AG-38, AG-39, AG-40. Each is marked **BUILT** below. "BUILT" here means the class
exists, extends the correct base class (or documents why it doesn't), calls Claude with real
parameters, and writes to real tables ??? it does **not** automatically mean "wired into the nightly
2AM sweep." Per this document's standing methodology (Section 1: "PLANNED means PLANNED... nothing
should be read as wired until an actual audit says so"), the same rigor is applied here: each BUILT
spec below states its actual, grep-verified call site. Three of the eight are genuinely orphaned ???
never imported anywhere outside their own file (`learning-network-aggregator-agent.ts`,
`probability-scoring-agent.ts`, `relationship-builder-agent.ts` under different names elsewhere in
this document) ??? and are marked as such rather than glossed over. AG-31 through AG-34 remain
**PLANNED** ??? no file found in `src/lib/agents/` for any of them; their specs below are unchanged
design commitments, not live call sites.

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
| AG-37 | Simulation Agent | No new number ??? "Extends AG-28" (Impact Simulation Agent, renumbered to **AG-41** 2026-08-02 — AG-28 is now Follow-Up Generator, see Section 5); the vision doc's own **AG-37** is Multi-Agent Negotiation, not this |
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
- **Status:** BUILT
- **Real implementation:** `src/lib/agents/fundability-scorer-agent.ts` (612 lines). Class
  `FundabilityScorerAgent` (line 345), extends `AutonomousAgent`, `agentId: "ag-29-fundability"`
  (note: collides with this document's own canonical AG-29 = Knowledge Engine Indexer Agent, Section
  5 ??? see the Numbering note above; do not treat this as the same agent).
- **Purpose:** Extends the Grant Probability Engine's bare 0-100 score into a diagnostic tool by
  decomposing any below-threshold score into the specific deficiency behind it (weak mission-fit
  language, incomplete budget history, missing logic model, Digital Twin gaps). Self-guards against
  re-scoring an opportunity already scored within a freshness window (checked via
  `fundability_scores.generated_at`, lines 385-391) and combines two other agents' outputs ???
  `opportunity_probability_scores` and `organizational_digital_twins` ??? into the Claude scoring
  prompt rather than scoring from scratch.
- **Type:** analysis
- **Claude call:** `model: DEFAULT_MODEL`, `maxTokens: 1500` (lines 516-521). No `temperature` set.
- **Tables written:** `fundability_scores` (`.insert`, lines 528-529) only. Reads `agent_queue`,
  `opportunities`, `organizations`, `opportunity_probability_scores`,
  `organizational_digital_twins`, `knowledge_base`.
- **Trigger (actual):** manual/on-demand only. Real call site is `src/app/api/intelligence/
  fundability/route.ts:4` (GET/POST). **Not wired into `worker/autonomous-orchestrator.ts`** ???
  there is no nightly or chain-triggered invocation; a user or the opportunity detail UI must call
  the API route.
- **Chains to:** none in code ??? no `queueChainedAgent()` call found. (The design spec below still
  describes an intended AG-06 narrow-mode chain that was never implemented.)
- **Hard limits:** never auto-publishes a generated KB entry ??? every `fundability_autofix_runs` row
  is `status = 'pending'` until a human approves it; never overrides a `structural` deficiency
  (funder/geography/mission mismatch) as if it were fixable ??? those are reported, not auto-fixed.
  (Note: `fundability_autofix_runs` is the design doc's intended output table; the live code writes
  to `fundability_scores` instead ??? verify which table actually exists in prod before building
  against either name.)
- **FORGE queue:** not yet scoped into a `queue.yaml`. Original design blueprint in
  `AUTONOMOUS_PLATFORM_VISION.md` ??7 ("Fundability Intelligence Score" row, Phase 2 table) described
  `opportunity_probability_scores.deficiencies` + `fundability_autofix_runs` and an AG-06 narrow-mode
  chain ??? the shipped implementation diverged: a standalone `fundability_scores` table, API-route-only
  trigger, no chain output.

---

### AG-30: Donor Intent Monitor

- **Phase:** 2
- **Status:** BUILT
- **Real implementation:** `src/lib/agents/donor-intent-monitor-agent.ts` (524 lines). Class
  `DonorIntentMonitorAgent` (line 247), extends `AutonomousAgent`, `agentId: "ag-30-donor-intent"`.
- **Purpose:** Monitors press releases, CSR/ESG reports, SEC filings, hiring-trend deltas, and
  facility-expansion signals for corporate prospects, scoring the probability each entity announces
  a giving initiative soon. Moves Reputation Intelligence (AG-18) from reactive to predictive.
- **Type:** monitoring
- **Claude call:** `callClaudeWithWebSearch({ system, prompt, maxTokens: 1400, maxSearches:
  MAX_SEARCHES_PER_PROSPECT })` (lines 386-391) ??? live web search grounds the signal evidence rather
  than relying on training-data recall. No explicit `model` or `temperature` override.
- **Tables written:** `corporate_intent_signals` (`.insert`, lines 419-420) ??? not
  `donor_intent_scores` as originally designed. Reads `organizations`, `corporate_prospects`.
- **Trigger (actual):** manual/on-demand only. Real call sites: `src/app/api/intelligence/
  donor-intent/route.ts:4` and `src/app/(dashboard)/intelligence/donor-intent/page.tsx`. The file's
  own header comment (lines 23-29) states per-org nightly-sweep wiring was explicitly out of scope
  for the session that built it ??? it operates on `this.orgId` only when called, and is **not**
  registered in `worker/autonomous-orchestrator.ts`.
- **Chains to:** none in code.
- **Hard limits:** `AUTONOMOUS_HARD_LIMITS.NEVER_SEND_EMAIL_WITHOUT_APPROVAL` ??? a predicted-intent
  signal is informational only, never a trigger for automatic outreach; every signal carries
  `evidence`/`source_url` from the live web search rather than an unsupported assertion.
- **FORGE queue:** not yet scoped into a `queue.yaml`. Original design blueprint in
  `AUTONOMOUS_PLATFORM_VISION.md` ??7 described a `donor_intent_scores` table and a nightly
  `runCorporateEnrichmentBatch()` step ??? the shipped implementation diverged: table is named
  `corporate_intent_signals`, trigger is API-route-only, and it was built without the EA-series
  hiring-trend/SEC-EDGAR/facility-permit sub-agents the original design assumed as prerequisites
  (those remain not found in `src/lib/agents/`, per AG-20/AG-21 Section 5).

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

> **Status corrected 2026-08-03 — this section was stale.** It previously said "Status: PLANNED...
> Real implementation: none found" — that has not been true for some time. This is a real, built,
> `AutonomousAgent` class, live-tested twice in `AGENT_VERIFICATION_LOG.md`'s AG-32 entries
> (2026-08-02/03): the `agent_type` enum gap was fixed and confirmed live; a real `board_members`
> column-mismatch bug was found and fixed; the agent now genuinely completes real work
> (`boardMembersAnalyzed`, real board member data loaded and processed) up to the point where it
> hits the still-open `corporate_prospects` missing-table blocker (shared with AG-20/21/22/24/30).

- **Phase:** 3
- **Status:** BUILT — BLOCKED (verified live 2026-08-02/03)
- **Purpose:** Discovers and maps relationship edges between corporate entities, foundations, board
  members, and nonprofits — board overlaps, alumni networks, shared past employers, family
  foundation ties — into `pig_nodes`/`pig_edges`, surfacing warm introduction pathways in place of
  cold outreach.
- **Type:** analysis
- **Model:** claude-sonnet-4-6, via `callClaudeWithWebSearch` (real web search grounding per board
  member, not training-data recall)
- **Real implementation:** `src/lib/agents/relationship-graph-builder-agent.ts`, class
  `RelationshipGraphBuilderAgent extends AutonomousAgent`, `agentId: "ag-32-relationship-graph"`.
- **Tier gate:** enterprise.
- **Trigger (actual):** manual only — no schedule, no queue wiring exists in
  `worker/scheduler.ts`/`worker/autonomous-orchestrator.ts` today, despite
  `AUTONOMOUS_PLATFORM_VISION.md` describing a weekly full-graph rebuild. This is the exact wiring
  gap AG-23's spec (Section 5, above) exists to close — see that spec for the full schedule design
  and rationale (5:30 AM CST daily incremental, not weekly, per `BLUEPRINT_v2.md`'s own nightly
  pipeline table).
- **Input sources (real, live-confirmed 2026-08-03, corrected from this section's prior claims):**
  `board_members` (`organization_id`, `name`, `title`, `bio`, `is_active` — corrected 2026-08-03,
  see `AGENT_VERIFICATION_LOG.md`), `funders` (`id`, `name`, `website`), `corporate_prospects`
  (**confirmed still missing live, 404 PGRST205, as of 2026-08-03** — this is the blocker).
  `corporate_relationships`/`corporate_relationship_people` (this section's prior claimed input
  sources) do not exist anywhere in either migration tree — not real, never were.
- **Output:** `pig_nodes`/`pig_edges` — **now live** (migration `077_intelligence_graph.sql`,
  applied 2026-08-03 via `DATABASE_URL`/psql; previously undiscovered that this table was never
  applied either, despite being referenced as real throughout multiple prior `AGENT_VERIFICATION_LOG.md`
  entries for AG-19/AG-32 — corrected the same day).
- **Chains to:** none designed.
- **Hard limits:** never asserts an edge without `evidence`; `verified boolean` defaults false and
  is never silently flipped true without a documented source.
- **Remaining blocker:** `corporate_prospects` table (migrations 107/108, already documented
  elsewhere as the shared blocker for AG-20/21/22/24/30) — once that exists, this agent is
  otherwise fully functional end-to-end.

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
- **Status:** BUILT
- **Real implementation:** `src/lib/agents/community-need-predictor-agent.ts` (410 lines). Class
  `CommunityNeedPredictorAgent` (line 198), extends `AutonomousAgent`,
  `agentId: "ag-35-community-need"`.
- **Purpose:** Forecasts service demand from housing/eviction/employment/weather signals, grounded
  in live web search rather than training-data recall (header comment, lines 23-28, explains the
  web-search requirement exists specifically to avoid fabricating statistics). Directly extends the
  Faith Foundation pilot use case.
- **Type:** analysis
- **Claude call:** `callClaudeWithWebSearch({ prompt, maxTokens: 3000, maxSearches: 8 })`
  (lines 264-268). No `model` or `temperature` override.
- **Tables written:** `community_need_signals` (`.insert`, lines 318-319). Reads `organizations`,
  `knowledge_base`.
- **Severity-gated branching:** a `SEVERITY_CONFIDENCE` map (critical:90, high:70, medium:45, low:25)
  sets the logged confidence; an `agent_decisions` row is written only for `severity IN ('critical',
  'high')` (line 346), and a notification fires only for `severity = 'critical'` (lines 362-368) ???
  medium/low signals are persisted but produce no alert.
- **Trigger (actual):** manual/on-demand only. Real call sites: `src/app/api/intelligence/
  community-need/route.ts:4` and `src/app/(dashboard)/intelligence/community-need/page.tsx`. Header
  comment (lines 37-43) confirms `org_autonomous_config` has no toggle for this agent ??? it is
  **not** registered in `worker/autonomous-orchestrator.ts` for a nightly/monthly sweep.
- **Chains to:** none in code.
- **Hard limits:** never asserts a need forecast without citing contributing signals and their
  recency (enforced via the live web-search requirement); never auto-generates a grant application
  from a predicted need ??? surfaces only, structurally analogous to AG-25 (Disaster Response)'s
  "surfaces, never submits" pattern.
- **FORGE queue:** not yet scoped into a `queue.yaml`. Original design assumed dedicated ingestion
  adapters per data source (census, housing, eviction, weather, school enrollment, migration) ??? the
  shipped implementation instead uses Claude's web-search tool as a single grounding mechanism across
  all of them, with no separate per-source ingestion scripts built.

---

### AG-36: Learning Network Aggregator

- **Phase:** 4
- **Status:** BUILT ??? orphaned (never imported outside its own file)
- **Real implementation:** `src/lib/agents/learning-network-aggregator-agent.ts` (905 lines). Class
  `LearningNetworkAggregatorAgent` (line 424), extends `AutonomousAgent`,
  `agentId: "ag-36-learning-network"`. Uniquely among every agent in this document, its constructor
  takes only `(supabase)` (line 425), not `(orgId, supabase)` ??? it is built around a synthetic
  `SYSTEM_ORG_ID` row it self-creates in `organizations` (`.insert`, line 440) to satisfy FK
  constraints, since it aggregates cross-org patterns rather than acting for one org (header comment,
  lines 12-25).
- **Purpose:** Anonymizes and aggregates successful grant patterns across every subscriber org into
  `platform_learning_patterns` (not `knowledge_patterns` as originally designed).
- **Type:** analysis
- **Claude call:** `callClaude({ prompt, maxTokens: 500, temperature: 0.2 })` (line 395). No
  explicit `model`.
- **Tables written:** `organizations` (bootstrap insert of the system org row, line 440),
  `platform_learning_patterns` (`.update` line 508-509, `.insert` line 532-533),
  `org_learning_contributions` (`.insert`, line 568-569). Reads `applications`, `organizations`,
  `opportunities`, `application_documents`, `documents`, `outcomes`.
- **Trigger (actual): none.** Repo-wide grep found zero import or instantiation of this class
  anywhere outside `learning-network-aggregator-agent.ts` itself ??? not in any API route, not in
  `worker/autonomous-orchestrator.ts`, not in a script. It is real, compiling code that has never
  been invoked in production. Per `FEATURE_REGISTRY_v2.md` #223, `draft-generation-agent.ts` reads
  `platform_learning_patterns` at draft time, so the *table* is consumed downstream ??? but nothing in
  the repo currently *writes* to it via this agent.
- **Chains to:** none. A code comment at line 67 states `queueChainedAgent()` is intentionally never
  called ??? confirmed, no call present.
- **Hard limits:** aggregate tables are service-role-only with no `org_id` in client-facing
  responses; this agent must never expose an org-identifiable pattern back to a different org.
- **FORGE queue:** not yet scoped into a `queue.yaml`. No cron entry, no `agent_job_queue` handler,
  no manual-trigger route exists for this class ??? someone must add a call site (scheduled job or
  API route) before it does anything in production.

---

### AG-37: Simulation Agent

- **Phase:** 4
- **Status:** BUILT
- **Real implementation:** `src/lib/agents/simulation-agent.ts` (506 lines). Class `SimulationAgent`
  (line 158), extends `AutonomousAgent`, `agentId: "ag-37-simulation"` (collides with the vision
  doc's own AG-37 = Autonomous Multi-Agent Negotiation ??? see the Numbering note above, unrelated
  agent).
- **Purpose:** Multi-scenario what-if modeling ??? projects revenue, capacity, probability, and ROI
  per scenario so a board can compare options.
- **Type:** analysis
- **Claude call:** `model: DEFAULT_MODEL`, `maxTokens: 1200`, `temperature: 0.3` (lines 393-399).
- **Tables written:** `simulation_scenarios` (`.insert`, lines 408-409) ??? not
  `impact_simulations.scenario_comparison_id` as originally designed; this is a standalone table.
  Reads `agent_queue`, `organizations`, `board_members`, `organizational_digital_twins`, `outcomes`,
  `platform_learning_patterns`.
- **Trigger (actual):** manual, via `src/app/api/reports/simulate/route.ts:4` and
  `src/app/(dashboard)/reports/simulate/page.tsx`. Because `AutonomousAgent.run()` takes no
  direct-input parameter, this agent reads its scenario spec out of the `agent_queue.input_payload`
  row the queue processor marked "processing" (header comment, lines 7-9, documents this as the same
  `loadChainScope()` convention `probability-scoring-agent.ts` established).
- **Chains to:** none in code.
- **Hard limits:** explicitly read-only ??? header comment states it "never writes to live
  financial/pipeline data"; only inserts into the `simulation_scenarios` projection table.
- **FORGE queue:** not yet scoped into a `queue.yaml`. Original design extended `impact_simulations`
  with a `scenario_comparison_id` column; the shipped implementation instead uses a dedicated
  `simulation_scenarios` table, independent of the (still-unbuilt, Section 5) Impact
  Simulation Agent it was originally meant to extend — renumbered from AG-28 to **AG-41** 2026-08-02
  (AG-28 is now permanently Follow-Up Generator Agent, see Section 5).

---

### AG-38: Self-Improvement Agent

- **Phase:** 4
- **Status:** BUILT
- **Real implementation:** `src/lib/agents/self-improvement-agent.ts` (777 lines). Class
  `SelfImprovementAgent` (line 231) ??? **does not extend `AutonomousAgent`** (header comment, lines
  17-22, states it keeps its own minimal `startRun`/`completeRun`/`failRun` instead). Identifier
  `AGENT_ID = "ag-38-self-improvement"` (line 58) is written manually into `agent_runs.agent_type`
  (line 246) rather than via a `super()` call. (Collides with the vision doc's own AG-38 = Community
  Resource Graph, and with this doc's Numbering note which maps the vision doc's Continuous
  Improvement Engine to AG-36 ??? see the Numbering note above; three different things share
  overlapping numbers here, use the class name to disambiguate.)
- **Purpose:** Nightly meta-agent reviewing every other agent's `agent_runs` outcomes and proposing
  prompt/logic improvements, staged for human approval.
- **Type:** optimization
- **Claude call:** `model: DEFAULT_MODEL`, `maxTokens: 1500` (lines 638-643). No `temperature`.
- **Tables written:** `agent_runs` (own run tracking, lines 244/272/288),
  `agent_performance_metrics` (`.upsert`, lines 415-416), `improvement_proposals` (`.insert`, line
  663 ??? not `agent_improvement_proposals` as originally designed), `alerts` (`.upsert`, line 720).
  Reads `agent_runs`, `agent_decisions`, `agent_performance_metrics`, `profiles`.
- **Self-calibration logic (verified in code):** `identifyUnderperformers()` (line 492) compares
  each `agent_type`'s trailing-window stats against `MIN_AVG_CONFIDENCE = 65` plus success-rate and
  human-review-ratio thresholds (lines 508-509, 627); separately mines `HighPerformingPattern`s from
  `agent_decisions` with `confidence_score >= 85` (line 545). Both feed a Claude prompt, and only
  proposals scoring `confidence_score >= 75` (`MIN_CONFIDENCE_TO_PROPOSE`, line 659) are persisted.
- **Trigger (actual):** schedule ??? genuinely wired into `worker/autonomous-orchestrator.ts:832-836`
  via dynamic import, instantiated `new SelfImprovementAgent(supabase)` inside
  `runSelfImprovementPipeline()`, run with trigger `'schedule'`. This is one of the two Phase 2-5
  agents actually reachable from the nightly pipeline (the other is AG-40).
- **Chains to:** none in code (header comment, line 19, notes `queueChainedAgent()` doesn't apply
  since this class doesn't extend `AutonomousAgent`).
- **Hard limits:** `AUTONOMOUS_HARD_LIMITS.NEVER_MODIFY_GOVERNANCE_FILES` applies literally ??? this
  agent proposes changes to *other agents' prompts*, never to a governance `.md` file; every proposal
  requires human approval before deployment ??? it never self-deploys a change.
- **FORGE queue:** not yet scoped into a `queue.yaml`. Table name diverged from the original design
  (`improvement_proposals` vs. designed `agent_improvement_proposals`) ??? verify actual table name
  before building the `/admin/monitor` approval-queue UI or `/api/admin/agent-improvements` route
  against it.

---

### AG-39: ROI Optimizer

- **Phase:** 5
- **Status:** BUILT ??? partially wired (telemetry path live, correlation path never called)
- **Real implementation:** `src/lib/agents/roi-optimizer-agent.ts` (404 lines). Class
  `RoiOptimizerAgent` (line 88), extends `AutonomousAgent`, `agentId: "ag-39-roi-optimizer"`.
- **Purpose:** Tracks submission variables (prompt version, attachment type, submission day, wording,
  contact person) against outcome to find correlations with higher award rates.
- **Type:** optimization
- **Claude calls (two, deliberately different code paths ??? header comment lines 5-19 documents
  this explicitly):** (a) `trackSubmissionVariables()` ??? a readability sub-score call,
  `maxTokens: 10, temperature: 0` (lines 151-155), fired synchronously off application stage
  transitions, best-effort and **not** logged to `agent_runs`; (b) `run()` ??? the monthly
  correlation-analysis call, `maxTokens: 1000` (lines 288-293), fully `agent_runs`/`agent_decisions`
  logged.
- **Tables written:** `submission_variables` (`.insert`, lines 167-168 ??? from
  `trackSubmissionVariables()`), `roi_insights` (`.insert`, lines 329-330 ??? from `run()`, not
  `submission_variable_outcomes` as originally designed). Reads `applications`, `opportunities`,
  `application_documents`, `submission_variables`, `outcomes`.
- **Trigger (actual, split):** `trackSubmissionVariables()` is called from
  `src/app/api/autonomous/track-submission/route.ts:3,36` and does run in production. The full
  `run()` method ??? the Claude-calling monthly correlation pass that writes `roi_insights` ??? **has
  no production call site**; it is not invoked by that route, by any other route, or by the
  orchestrator. The telemetry half of this agent is live; the analysis half is orphaned.
- **Chains to:** none in code.
- **Hard limits:** never adjusts a live submission's variables mid-flight based on its own findings;
  correlation output is informational only.
- **FORGE queue:** not yet scoped into a `queue.yaml`. Before building `/api/admin/roi-optimization`
  or an ROI dashboard against this agent, note the analysis path (`run()`) needs a scheduled or
  manual call site added ??? it currently never executes.

---

### AG-40: Strategic Advisor

- **Phase:** 5
- **Status:** BUILT
- **Real implementation:** `src/lib/agents/strategic-advisor-agent.ts` (760 lines). Class
  `StrategicAdvisorAgent` (line 222), extends `AutonomousAgent`,
  `agentId: "ag-40-strategic-advisor"`.
- **Purpose:** The capstone agent ??? synthesizes a single prioritized action list of proactive
  strategic recommendations from every other intelligence table it can read.
- **Type:** analysis
- **Claude call:** `model: DEFAULT_MODEL`, `maxTokens: 2000`, `temperature: 0.4` (lines 598-604).
- **Tables written:** `strategic_recommendations` (`.insert`, lines 657-658). Reads 7 sources:
  `applications`, `outcomes` (x2 queries), `funding_forecasts`, `relationship_recommendations`,
  `reputation_alerts`, `deadlines`, `platform_learning_patterns`. Header comment (lines 13-24)
  states three of the originally-designed inputs ??? `donor_intent_scores`/`corporate_intent_signals`,
  `community_need_signals`, `roi_insights` ??? are loaded defensively: "a missing table degrades to
  an empty signal, it never throws," so this agent tolerates the schema drift documented in the
  AG-29/AG-30/AG-35/AG-39 specs above rather than failing on it.
- **Dedup logic:** before inserting a recommendation, checks for an existing `pending` row in the
  same `recommendation_category` within a 30-day window (lines 630-654) and skips if found.
- **Trigger (actual):** schedule ??? genuinely wired into `worker/autonomous-orchestrator.ts:634-638`
  via dynamic import, instantiated `new StrategicAdvisorAgent(orgId, supabase)`, run with trigger
  `'schedule'`. Orchestrator comment (lines 36-43) notes it's folded into the main 2AM nightly sweep
  rather than a separate cron slot the original design assumed. Also reachable manually via
  `src/app/api/intelligence/strategic-advisor/route.ts:5` and
  `src/app/(dashboard)/intelligence/strategic-advisor/page.tsx`. This is one of the two Phase 2-5
  agents actually reachable from the nightly pipeline (the other is AG-38).
- **Chains to:** none ??? terminal synthesis agent.
- **Hard limits:** `AUTONOMOUS_HARD_LIMITS.NEVER_SUBMIT_EXTERNALLY` /
  `NEVER_SEND_EMAIL_WITHOUT_APPROVAL` apply ??? it recommends, it never acts.
- **FORGE queue:** not yet scoped into a `queue.yaml`. Live and wired, but its three richest signal
  sources (donor intent, community need, ROI) are currently thin or empty in practice because their
  own upstream agents are either API-route-only (AG-30, AG-35) or never invoked (AG-39's `run()`) ???
  see those specs above.

---

*Phase 2-5 Agent Specifications section added July 19, 2026, originally from a read of
`AUTONOMOUS_PLATFORM_VISION.md` (full) and `FEATURE_REGISTRY_v2.md` features 217-228 with no code
audit. Re-audited July 19, 2026 (later same day) directly against `src/lib/agents/`, grep of every
import/instantiation site in `src/` and `worker/`, and `worker/autonomous-orchestrator.ts`: eight of
twelve (AG-29, AG-30, AG-35, AG-36, AG-37, AG-38, AG-39, AG-40) now have real files and are marked
BUILT above, each with its actual trigger, chain, Claude params, and tables written stated inline.
Two of the eight (AG-38, AG-40) are genuinely wired into the nightly `worker/autonomous-orchestrator.ts`
sweep. Three (AG-29, AG-30, AG-35) are reachable only via a manual API route, not the nightly
pipeline. One (AG-36) and half of another (AG-39's `run()` method) are orphaned ??? real code that no
production call site ever invokes. AG-31 through AG-34 remain PLANNED with no file found ??? treat
their specs above as unchanged design commitments, not live call sites. Re-verify against
`src/lib/agents/` and `worker/` before trusting any status here past this date.*
