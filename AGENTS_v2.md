# BENAVORA — Agent Definitions v2.0
## Supersedes: AGENTS.md v1.0
## Date: July 17, 2026
## Status: CANONICAL

---

## Agent Architecture

All agents inherit from a `BaseAgent` class providing: structured logging to `agent_runs` table, token usage tracking, error handling with retry logic, organization-scoped data access via service role client, and execution time measurement.

Agents are triggered: manually (user action), on schedule (CRON via Railway), by event (signal detected), or by pipeline (output of one agent triggers another).

All agent outputs write to the database. Never to local files.

**Model:** claude-sonnet-4-6 for all agents unless specified.
**Timeout:** All agent API routes require `export const maxDuration = 300`.

**Per-agent-class timeout policy (AR-2.1 2026-09-17, calibrated + made
progress-aware by AR-11.4 2026-09-18):** `BaseAgent`
(`src/lib/agents/base-agent.ts`) exports three named, documented ceilings
instead of one global number — a Claude call with retries, a multi-page
browser crawl, and a single upsert do not belong under one ceiling:

| Class | Constant | Ceiling | Stall window | Who |
|---|---|---|---|---|
| DETERMINISTIC | `AGENT_TIMEOUT_MS` | 60s | none (same as ceiling) | No Claude/browser/network loop — pure DB/arithmetic (`success_probability`) |
| CLAUDE_CALL | `AGENT_TIMEOUT_CLAUDE_CALL_MS` | 180s | 60s | One or a few sequential Claude calls, short structured output (`eligibility_scoring`, `semantic-matching`, `compliance-checker`, `email-parser`) |
| MULTI_STEP | `AGENT_TIMEOUT_MULTI_STEP_MS` | 270s | 90s | Browser automation, multi-page crawling, or long-form generation (`review`, `budget_builder`, the `*_research` family, `ag-22`, the `ea-*` analyzers, scrapers) |

270s, not 300s, is deliberate: every route invoking a MULTI_STEP agent sets
`export const maxDuration = 300` — an in-process ceiling equal to that
platform limit lets the platform win the race, and a platform-killed
process records nothing at all (AR-11.4 found and fixed ~24 agents that
were hardcoded to exactly `300_000` for this reason). Every `BaseAgent`
subclass that imports `@/lib/ai/claude` or `@anthropic-ai/sdk` overrides
`timeoutMs` in its constructor with one of the two non-default constants
above (never a bare literal — the class and its rationale should stay
discoverable from the call site). `src/__tests__/unit/agent-timeouts.test.ts`
statically enforces this — it fails any `BaseAgent` subclass that calls
Claude without a `timeoutMs` override above 60000, resolving the named
constants to their real values. (`narrative_drafting`, the other agent type
seen orphaning in `agent_runs`, is not a `BaseAgent` subclass — it's called
directly from `src/app/api/ai/draft/route.ts` and two other routes, which
already set `export const maxDuration = 300` at the route level.)

**Progress vs. hung (AR-11.4, 2026-09-18):** once an agent has called
`setPhase()` at least once, `withTimeout()` also enforces a per-class stall
window (see table above) — a new phase must land within it or the run
fails early with a distinct `code: "stalled"` error, instead of only ever
timing out at the full ceiling. A long-running agent that keeps advancing
phases is never killed by this; only a phase that goes quiet is. Opt-in by
design: an agent that never calls `setPhase()` keeps the flat
ceiling-only behavior unchanged.

**Claude concurrency limit (AR-2.1, 2026-09-17):** `narrative_drafting` also
saw 7 production `429 rate_limit_error` failures ("Number of concurrent
connections has exceeded your rate limit") — nothing capped how many Claude
calls the platform fired at once. `src/lib/ai/claude-concurrency.ts` exports
a shared `withClaudeLimit()` (concurrency 4, via `p-limit`) that every
Anthropic call in `src/lib/agents/**` and `src/lib/intelligence/**` now routes
through (including indirectly, via `src/lib/ai/claude.ts`'s `callClaude*`
wrappers). `src/lib/autoapply/**` has its own separate instance,
`src/lib/autoapply/claude-concurrency.ts`, because that tree is compiled by
`worker/tsconfig.json`'s restricted `include` list, which does not cover
`src/lib/ai/**` — every autoapply Claude caller already instantiates its own
`Anthropic` client rather than importing `src/lib/ai/claude.ts` for exactly
that reason. `src/__tests__/unit/claude-concurrency.test.ts` proves the
limiter caps in-flight calls at 4 and that every call still resolves.

**Error contract for core agents (AR-7.3, 2026-09-17):** `agent_runs.error_message`
must never be a fixed human string that discards a real caught error. When a
subclass has a genuine Postgrest/pg error in scope (an `{ data, error }`
destructure, or a caught exception), it must build the message with
`withCause(humanMessage, err)` (`src/lib/agents/base-agent.ts`) — appends the
error's `code`/`constraint`/`message`/`details`/`hint` (or a plain `Error`'s
message) to the human-readable summary rather than replacing it, e.g.
`"Failed to save probability score. (code=23505 | constraint=... |
duplicate key value violates unique constraint)"`. Every writer of
`agent_runs.error_message` (`BaseAgent.run()`, `AutonomousAgent.failRun()`/
`completeRun()`, `AutomationWorkerAgent.logFailed()`, `withAgentRun()` in
`src/lib/autoapply/run-logger.ts`) redacts via **AR-6.2's `redactSecrets()`**
before persisting — a raw pg error can echo a connection string or key back
from the query, so this is centralized at the write boundary, not left to
each throw site to remember. A timeout's message names its configured limit
and the last phase a `protected setPhase(phase: string)` call reported
reaching (default `"start"` if a subclass never calls it) —
`` `Agent timed out after ${s}s (limit=${ms}ms, phase="${phase}").` `` — so
AR-6.3's timeout alert rule has real per-run content instead of the same
opaque string on every occurrence. Live evidence this fixed:
`success_probability` (100/144 failed runs, all reading the identical
diagnosis-free `"Failed to save probability score."`) and `review` (4/4
failed, both captured runs reading a bare `"Agent timed out after 60s."`
with no phase). `src/__tests__/unit/agent-error-fidelity.test.ts` is the
regression guard (fake-Supabase-client unit suite, no live DB dependency).
16 real-discard sites were fixed under this contract this session; a
broader `error || !data` "not found" conflation pattern (a real DB error
masquerading as a 404) still exists elsewhere and is a distinct,
lower-urgency follow-up, not covered by this contract's enforcement yet.

**Error-vs-empty contract (AR-11.2, 2026-09-18):** the follow-up named
above. `if (error || !data)` — or any variable-named equivalent — is
prohibited across `src/lib/agents`, `src/lib/pil`, `src/lib/autoapply`, and
both worker trees (`worker/`, `src/worker/jobs/`): a genuine query failure
and a legitimate empty result must never share a branch. A caught `error`
must always be logged with its real cause via `causeOf(err)`/`withCause(human,
err)` (the same AR-7.3 helpers — do not write new ones), and then, by
default, surfaced to the caller (`throw new AgentError(withCause(...),
"db_error")` inside a `BaseAgent` subclass; a plain `Error(withCause(...))`
otherwise) rather than silently reused as the same result an empty query
would have produced. The only accepted exception is a documented
best-effort/fail-open function (a periodic sweep, an optional-enhancement
lookup, an explicit fallback source in a waterfall) where a transient
failure genuinely means "try again next cycle, nothing wrong gets done as a
result" — even there, the error must still be logged distinctly before the
function falls through to its empty-case behavior; an error that reaches
neither a log nor a throw is never acceptable, regardless of which branch
shape a given site ends up with. 55 sites were fixed under this contract
this session (see `test-evidence/ERROR_CONFLATION_LEDGER.md` for the full
per-site table); 10 sites where `error` was discarded by omission — never
even checked, a worse case of the same underlying bug — were found but left
for a dedicated follow-up rather than fixed speculatively, also logged in
that ledger.

---

## Phase 1 Agents (MVP — Already Built)

### AG-01: Grant Summary Agent
Already implemented. Summarizes raw opportunities into structured fields.

### AG-02: Eligibility Scoring Agent
Already implemented. Scores 0-100 org fit for any opportunity.

### AG-03: Deadline Extraction Agent
Already implemented. Creates deadline records from opportunity data.

### AG-04: Fit Analysis Agent
Already implemented. Deep ROI analysis for qualified opportunities.

### AG-05: Research Agent
Already implemented. Discovers new opportunities from configured sources.

### AG-06: Draft Generator Agent
Already implemented. Generates full grant narrative drafts from Knowledge Base.

### AG-07: Learning Agent
Already implemented. Analyzes outcomes and extracts success patterns.

---

## Phase 2 Agents (Tier 6 — Built in Recent Sessions)

### AG-08: NOFA Parser Agent
Parses Notice of Funding Availability documents from federal sources.

### AG-09: Email Parser Agent
Parses incoming grant-related emails, extracts deadlines and action items.

### AG-10: Grant DNA Analysis Agent
Analyzes grant requirements and produces a structured DNA profile.

### AG-11: Cold Outreach Agent
Generates personalized cold outreach sequences for corporate prospects.

### AG-12: AutoApply Agent
Stealth browser automation for form detection, filling, and submission.

### AG-13: Foundation Enrichment Agent
Enriches foundation_directory records from multiple data sources.

### AG-14: Donor Discovery Agent
Discovers and scores corporate donors via Google Places and enrichment pipeline.

---

## Phase 3 Agents (New — Platform Vision v2.0)

### AG-15: Grant Probability Agent

**Purpose:** Computes a multi-factor probability score for every opportunity.
**Trigger:** On opportunity creation/update, nightly batch for all org opportunities.
**Input:** Opportunity record + org Digital Twin + historical outcomes.
**Process:**
1. Read opportunity: eligibility_score, category, geography, amount_range, deadline
2. Read Digital Twin: mission, service_area, programs, historical_win_rates
3. Compute 11 factors (weights as defined in PLATFORM_VISION_ARCHITECTURE.md §PILLAR 5)
4. Call Claude with structured scoring rubric and all factor inputs
5. Parse response: overall score 0-100, confidence, factors array, recommendation, key_risks, key_strengths
6. Upsert to opportunity_probability_scores table
7. Update opportunity record: probability_score field
**Output:** Probability score with full factor breakdown and actionable recommendations.
**Model:** claude-sonnet-4-6
**Tokens:** ~3,000 input / 1,500 output
**Schedule:** Nightly 3AM CST for all active opportunities

### AG-16: Digital Twin Builder Agent

**Purpose:** Constructs and maintains the Organizational Digital Twin from all available org data.
**Trigger:** On Knowledge Base update, on 990 upload, monthly full rebuild.
**Input:** All Knowledge Base entries, org profile, outcomes history, application history, uploaded documents.
**Process:**
1. Read all knowledge_base_entries for org
2. Read org profile from organizations table
3. Read outcomes history: success patterns, funder preferences, win rates by category
4. Read applications history: submitted, awarded, denied
5. Read board_members and programs from relevant tables
6. Call Claude with all data: "Synthesize this organizational data into a structured Digital Twin profile. Extract: mission statement, core programs (name, description, target population, outcomes), geographic service area, financial profile, board composition, proven narrative patterns, key strengths, known weaknesses. Return structured JSON."
7. Upsert to organizational_digital_twins table
8. Set twin_completeness_score (0-100) based on populated fields
**Output:** Fully structured Digital Twin record.
**Model:** claude-sonnet-4-6
**Tokens:** ~8,000 input / 4,000 output
**Schedule:** Monthly full rebuild + incremental on KB updates

### AG-17: Opportunity Discovery Agent

**Purpose:** Autonomous daily discovery of new funding opportunities across all configured sources.
**Trigger:** Nightly 2AM CST. Also on-demand via /api/agents/discovery/run.
**Input:** Org Digital Twin (mission, geography, categories) + configured discovery sources.
**Process:**
1. Read org Digital Twin for personalization context
2. Pull new opportunities from each source adapter:
   - Grants.gov: new postings since last run
   - SAM.gov: new opportunities since last run
   - Federal Register: new NOFAs since last run
   - Foundation websites: monitored RFP pages
   - FEMA: new disaster declarations
   - Congress.gov: new relevant legislation
3. For each discovered item, run Grant Probability Agent to compute score
4. Filter: only surface opportunities with probability_score >= 40 OR disaster declarations
5. Insert to discovery_matches table linked to org
6. Create in-app notification: "X new opportunities discovered"
7. Update discovery_runs table with run statistics
**Output:** Set of scored, personalized opportunity matches.
**Model:** claude-sonnet-4-6 for probability scoring; no model for source polling
**Schedule:** Nightly 2AM CST

### AG-18: Reputation Intelligence Agent

**Purpose:** Monitors all funders and corporate prospects for reputation signals.
**Trigger:** Nightly 4AM CST. Also on-demand per entity.
**Input:** List of funders (from org CRM) + corporate prospects (from org pipeline).
**Process:**
1. For each monitored entity:
   a. Search news API for entity name + [scandal, lawsuit, fraud, leadership change, acquisition]
   b. Check IRS for status changes (revocation, penalties)
   c. Check SEC EDGAR for enforcement actions (public companies)
   d. Call Claude: "Analyze these search results. Identify any reputational risks, leadership changes, financial distress signals, or positive giving signals. Return structured JSON: {signals: [{type, severity, headline, summary, source_url, signal_date}]}"
2. Insert new signals to reputation_signals table
3. Create reputation_alerts for orgs monitoring each entity
4. Send push notification for RED/ORANGE severity alerts immediately
**Output:** Reputation signals with severity classification.
**Model:** claude-sonnet-4-6
**Tokens:** ~2,000 input / 1,000 output per entity
**Schedule:** Nightly 4AM CST

### AG-19: Relationship Builder Agent

**Purpose:** Monitors funder signals and generates specific engagement recommendations.
**Trigger:** Nightly 5AM CST. Also on-demand per funder.
**Input:** Org's funder CRM list + relationship_memory table + reputation_signals.
**Process:**
1. For each funder in org CRM:
   a. Check reputation_signals for new events since last recommendation
   b. Check LinkedIn/news for leadership changes, announcements
   c. Check relationship_memory for last interaction date and type
   d. Check 990 data for giving trend changes
   e. Call Claude: "Given this funder's recent activity and our relationship history, what specific action should we take and when? Return: {action, timing, rationale, message_draft_opening}"
2. Insert recommendations to relationship_recommendations table
3. Surface top 5 recommendations on dashboard Action Items widget
**Output:** Prioritized engagement recommendations with timing.
**Model:** claude-sonnet-4-6
**Schedule:** Nightly 5AM CST

### AG-20: Corporate Giving Detector Agent (EA-01)

**Purpose:** Analyzes company website for giving programs and donation forms.
**Trigger:** On new corporate_prospect record creation. Also in nightly enrichment batch.
**Input:** Company website URL from corporate_prospects.
**Process:**
1. Fetch company website homepage via Playwright stealth browser
2. Search for and fetch: /giving, /community, /csr, /foundation, /donate pages
3. Call Claude: "Analyze this website content. Identify: has_giving_program (bool), giving_portal_url (string|null), known_donation_types (array: cash/in_kind/volunteer/equipment/sponsorship), csr_page_url (string|null), community_initiatives (array of strings). Return structured JSON."
4. Merge result into corporate_prospects.enrichment jsonb
5. Set enrichment.ea01_completed_at = now()
**Output:** Giving program detection fields in enrichment jsonb.
**Model:** claude-sonnet-4-6
**Tokens:** ~4,000 input / 1,000 output

### AG-21: Executive Biography Analyzer Agent (EA-08)

**Purpose:** Extracts decision-maker information from company leadership pages.
**Trigger:** After AG-20 completes. In nightly enrichment batch.
**Input:** Company website URL.
**Process:**
1. Fetch /leadership, /about/team, /about-us, /executives pages
2. Call Claude: "Extract all executives and board members listed. For each person return: name, title, linkedin_url (if listed), bio_summary (2 sentences). Also identify: decision_maker_names (CEO/President/VP/Director of Community/CSR/Foundation titles), board_members. Return structured JSON."
3. Merge into enrichment jsonb
4. Set enrichment.ea08_completed_at = now()
**Output:** Decision maker names and titles in enrichment jsonb.
**Model:** claude-sonnet-4-6
**Tokens:** ~3,000 input / 1,500 output

**AR-7.1 note (2026-09-17):** AG-20 (EA-01) and AG-21 (EA-08), plus the EA-02
(`ea02_community_outreach_detector`), EA-05 (`ea05_career_page_analyzer`), and EA-09
(`ea09_contact_extractor`) corporate enrichment agents (implemented in
`src/lib/agents/ea-0*.ts`; not individually specified elsewhere in this document) all fetch
pages through `StealthEngine` (`src/lib/scraper/stealth-engine.ts`). Production evidence
2026-09-17 showed all five failing 86-88% of runs with
`browserType.launch: Executable doesn't exist at /root/.cache/ms-playwright/...` —
`stealth-engine.ts` was 1 of 5 unfixed `chromium.launch()` call sites (of 6 total in the
repo) that didn't resolve the worker container's system Chromium binary. Fixed by routing
every call site through the new `src/lib/browser/launch-chromium.ts` helper — see
`STATE_OF_THE_BUILD.md`'s "AR-7.1" section.

**AR-9.3 update (2026-09-18): live-verified fixed, and the "Trigger" lines above are stale.**
The Railway worker has since redeployed (confirmed via `railway status`: running deployment
descends from commit `119139d`), and a live production run of all 10 EA agents (reset one
`corporate_prospects` row, called the real `runEnrichmentBatch()`) completed with zero errors —
see `STATE_OF_THE_BUILD.md`'s "AR-9.3" section for the full agent_runs table. **Also found while
tracing this:** the "Trigger: On new corporate_prospect record creation" line above (and AG-21's
identical claim) is not accurate to the live system — there is no on-create trigger anywhere in
the codebase. The only real trigger is `worker/enrichment-processor.ts`'s continuous poll loop
over `corporate_prospects.enrichment_completed_at IS NULL`, and the only feed for *new* rows into
that queue is two manual-only paths (`POST /api/prospects/acquire`, `pnpm acquire:prospects`) —
no cron or scheduler job populates `corporate_prospects` despite the acquisition route's own code
comment claiming a "nightly" sweep. No new rows have landed since 2026-08-04, so the EA family
will stay silent going forward until either that acquisition step is scheduled or someone runs it
manually — not because anything is broken, but because nothing is feeding the queue. Full
invocation trace: `test-evidence/AGENT_INVOCATION_MAP.md`.

### AG-22: Propensity Scoring Agent

**Purpose:** Computes all 10 donation propensity scores for each corporate prospect.
**Trigger:** After all EA agents complete for a prospect. Nightly batch for unscored records.
**Input:** Full enrichment record from corporate_prospects.
**Process:**
1. Read complete enrichment jsonb for prospect
2. For each of 10 scores (PS-01 through PS-10 per CORPORATE_INTELLIGENCE_ARCHITECTURE.md):
   a. Call Claude with prospect data + score-specific rubric
   b. Parse: score 0-100, rationale, top_factors
3. Write all 10 scores to corporate_prospects.scores jsonb
4. Compute Giving DNA profile from score patterns
5. Write giving_dna to corporate_prospects.giving_dna jsonb
6. Set scores_computed_at = now()
**Output:** 10 propensity scores + Giving DNA profile.
**Model:** claude-sonnet-4-6
**Tokens:** ~3,000 input / 2,000 output per prospect

### AG-23: Relationship Mapper Agent (RA-01)

**Purpose:** Discovers relationships between entities and populates the Philanthropic Intelligence Graph.
**Trigger:** After enrichment completes for a prospect. Weekly full graph rebuild.
**Input:** All enriched corporate_prospects + foundation_directory + organizations.
**Process:**
1. For each enriched entity:
   a. Cross-reference executive names against other entities' board_members
   b. Match foundation_ein against IRS BMF to find corporate foundations
   c. Check enrichment for parent company mentions
   d. Check press releases for partnership/supplier mentions
2. Call Claude: "Given this company's enrichment data, identify all relationship signals. Return: [{source_entity, target_entity, relationship_type, evidence, confidence}]"
3. Upsert to pig_nodes and pig_edges tables
4. Set confidence score per edge
**Output:** New graph nodes and edges.
**Model:** claude-sonnet-4-6
**Schedule:** Weekly full rebuild + incremental after each enrichment

### AG-24: Personalized Outreach Generator Agent

**Purpose:** Generates AI-individualized email outreach for each corporate prospect.
**Trigger:** User initiates outreach campaign for a set of prospects.
**Input:** Prospect enrichment record + Giving DNA + org Digital Twin + campaign type.
**Process:**
1. Read full prospect enrichment record
2. Read org Digital Twin for mission, programs, needs
3. Identify most relevant connection points (prospect giving DNA vs org needs)
4. Call Claude: "Write a personalized outreach email from [org name] to [prospect name]. Reference these specific known facts about the prospect: [enrichment highlights]. Connect their [giving_dna.primary_style] to our [specific program need]. Do not use generic language. Every sentence must reference something specific about this company. Return: {subject, body, personalization_elements_used}"
5. Store generated email in outreach_campaigns table
6. Never send automatically — always queue for human review first
**Output:** Personalized email ready for human review and sending.
**Model:** claude-sonnet-4-6
**Tokens:** ~5,000 input / 2,000 output per email

### AG-25: Disaster Response Agent

**Purpose:** Monitors FEMA API and deploys coordinated disaster response.
**Trigger:** Every 6 hours (polls FEMA API). Immediate on new declaration.
**Input:** FEMA disaster declarations API.
**Process:**
1. Poll https://www.fema.gov/api/open/v2/disasterDeclarationsSummaries?$filter=declarationDate ge [last_check]
2. On new declaration:
   a. Extract affected_states, affected_counties, disaster_type
   b. Find nonprofits where service_area overlaps affected area
   c. Surface emergency funding opportunities (pre-catalogued in disaster fund database)
   d. Find corporate prospects with disaster_response_capability=true within 200 miles
   e. Generate pre-populated emergency grant applications
   f. Insert to disaster_declarations and disaster_response_campaigns tables
   g. Send immediate notification to affected org users
**Output:** Disaster response campaign with pre-populated applications and corporate donor list.
**Model:** claude-sonnet-4-6 for application pre-population
**Schedule:** Every 6 hours

### AG-26: Funding Forecast Agent

**Purpose:** Generates 90-day and 12-month funding forecasts for each org.
**Trigger:** Monthly. Also on-demand.
**Input:** Org pipeline data + historical outcomes + market data.
**Process:**
1. Read org pipeline: opportunities by stage with probability scores
2. Compute probability-weighted pipeline value per stage
3. Read historical win rates by category and quarter
4. Read market forecast data (federal budget trends, foundation giving trends)
5. Call Claude: "Generate a 90-day and 12-month funding forecast for this organization. Use the probability-weighted pipeline value, historical win rates, and market trends. Return: {90_day: {min, max, most_likely, confidence}, 12_month: {min, max, most_likely, confidence}, key_risks, key_opportunities, recommended_actions}"
6. Upsert to funding_forecasts table
**Output:** Funding forecast with confidence ranges and recommendations.
**Model:** claude-sonnet-4-6
**Tokens:** ~5,000 input / 2,000 output
**Schedule:** Monthly + on-demand

### AG-27: Board Meeting Packet Agent

**Purpose:** Generates complete board meeting packets 48 hours before each meeting.
**Trigger:** 48 hours before any board_meetings record date. Also on-demand.
**Input:** Board meeting date + org Digital Twin + pipeline data + financial data.
**Process:**
1. Read org financial snapshot (budget vs actual from grant_budgets and outcomes)
2. Read grant pipeline status (opportunities, applications by stage)
3. Read upcoming deadlines (next 90 days)
4. Read recent agent activity (last 30 days of agent_runs)
5. Call Claude: "Generate a complete board meeting packet. Include: executive summary, financial dashboard in plain language, grant pipeline status, top 3 strategic decisions needed, compliance calendar, upcoming deadlines, AI-generated discussion questions, recommended voting items. Return structured JSON with all sections."
6. Upsert to board_meeting_packets table
7. Send notification to all board_members for this org
**Output:** Complete structured board meeting packet.
**Model:** claude-sonnet-4-6
**Tokens:** ~6,000 input / 4,000 output

### AG-28: Impact Simulation Agent

**Purpose:** Models outcomes of strategic what-if scenarios.
**Trigger:** User initiates a simulation via /donor-discovery or /reports pages.
**Input:** Scenario type + scenario parameters + org Digital Twin.
**Process:**
1. Read org Digital Twin (baseline state)
2. Read scenario params (e.g., "receive $500K grant", "lose largest funder", "hire 5 staff")
3. Call Claude: "Simulate the impact of this scenario on this organization over 12 months. Model: financial impact (revenue, expenses, reserves), capacity impact (staff hours, programs affected), beneficiary impact (families served, outcomes), grant eligibility changes (new funders unlocked, existing affected), risks, prerequisites, timeline. Be specific using the org's actual financial data. Return structured JSON."
4. Store in impact_simulations table
**Output:** Detailed scenario simulation with financial, capacity, and impact projections.
**Model:** claude-sonnet-4-6
**Tokens:** ~6,000 input / 3,000 output

### AG-29: Knowledge Engine Indexer Agent

**Purpose:** Continuously ingests and indexes funding data into the Funding Knowledge Engine.
**Trigger:** Nightly after all other agents complete. Also after each ingestion script runs.
**Input:** New records in intelligence_funded_proposals, outcomes, foundation_directory.
**Process:**
1. Find all intelligence_funded_proposals where embedding IS NULL
2. For each: generate text embedding via Anthropic or OpenAI embedding API
3. Store embedding in pgvector column
4. Find all outcomes where embedding IS NULL
5. For each: concatenate funder_name + category + result + denial_reason, generate embedding
6. Find new foundation_directory records with enrichment data — generate embeddings
7. Update knowledge_patterns table: aggregate success patterns by category/funder/narrative_type
**Output:** Updated vector embeddings for RAG retrieval.
**Model:** Embedding model (text-embedding-3-small or equivalent)
**Schedule:** Nightly 6AM CST

### AG-30: Change Monitor Agent (CM-01)

**Purpose:** Detects changes in monitored entities and triggers re-enrichment.
**Trigger:** Weekly for Priority tier (PS-01 > 70), Monthly for Active tier.
**Input:** List of corporate_prospects due for re-check.
**Process:**
1. For each prospect due for re-check:
   a. Fetch current website — diff against last_fetched_content
   b. Search news for company name in last 30 days
   c. Check LinkedIn for executive changes
   d. Check IRS BMF for status changes
2. If changes detected: insert to corporate_monitoring_events table
3. Re-run relevant enrichment agents (AG-20 if website changed, AG-21 if leadership changed)
4. Re-run AG-22 (propensity scoring) if enrichment changed
5. Create reputation signal if negative news detected
**Output:** Updated enrichment data + monitoring event log.
**Model:** claude-sonnet-4-6 for change analysis
**Schedule:** Weekly (Priority tier), Monthly (Active tier)

---

## Agent Execution Order (Per Org, Nightly Pipeline)

```
2:00 AM — AG-17: Opportunity Discovery Agent
2:30 AM — AG-15: Grant Probability Agent (batch, all active opportunities)
3:00 AM — AG-20/21: Corporate Enrichment Agents (batch, unenriched prospects)
3:30 AM — AG-22: Propensity Scoring (batch, newly enriched prospects)
4:00 AM — AG-18: Reputation Intelligence Agent
4:30 AM — AG-19: Relationship Builder Agent
5:00 AM — AG-25: Disaster Response Agent (poll FEMA)
5:30 AM — AG-23: Relationship Mapper (incremental graph updates)
6:00 AM — AG-29: Knowledge Engine Indexer
6:30 AM — AG-26: Funding Forecast (monthly only)
7:00 AM — Morning digest notification sent to users
```

---

## Canonical implementation per AG-NN slot / DB collision cleanup (p5a-002, 2026-09-15)

`AGENT_INVENTORY_COMPLETE.md` §3 (Phase 0 audit) found two distinct kinds of collision in
`src/lib/agents/` (104 files) that this doc's AG-01..AG-30 numbering never anticipated:

1. **AG-NN label collisions** — two unrelated files both informally called "AG-08" (etc.) in
   different places (`worker/scheduler.ts`'s comments vs `worker/autonomous-orchestrator.ts`'s).
   Re-verified this session by reading each file's actual `agent_id`/`agentType` literal: **every
   one of these 8 already writes a distinct DB value** (e.g. `ag-08-renewal-tracker` vs the
   `government_research` bucket) — this was purely a human-documentation-label collision, zero DB
   attribution risk. Recorded here so the label is never reused as if it meant "the same feature":

   | Slot (doc label only — not a DB value) | Canonical file | Other file(s) sharing the label |
   |---|---|---|
   | AG-08 | `renewal-tracker-agent.ts` (`ag-08-renewal-tracker`) | `housing-specific-scrapers.ts`, `nofa-parser.ts` — unrelated features, own DB values (see below) |
   | AG-09 | `outcome-analyzer-agent.ts` (`ag-09-outcome-analyzer`) | `email-parser.ts` (`email_parser`) |
   | AG-10 | `grant-dna-agent.ts` (`ag-10-grant-dna`) | `document-expiry-agent.ts` (`ag-10-document-expiry`) |
   | AG-11 | `knowledge-gap-agent.ts` (`ag-11-knowledge-gap`) | `cold-outreach.ts` |
   | AG-12 | `search-profile-optimizer-agent.ts` (`ag-12-search-optimizer`) | `research/corporate-giving.ts` / `corporate-scraper.ts` (`corporate_research`) |
   | AG-25 | `deadline-prediction-agent.ts` (`ag-25-deadline-prediction`) | `disaster-response-agent.ts` (plain function, never logs to `agent_runs`) |
   | AG-28 | `followup-generator-agent.ts` (`ag-28-followup`) | `impact-simulation-agent.ts` (`ag-41-impact-simulation` — this file's real number is AG-41; AG-28 was a seed-doc mislabel) |
   | AG-29 | `knowledge-indexer-agent.ts` (`ag-29-knowledge-indexer`) | `fundability-scorer-agent.ts` (`ag-29-fundability` — deliberately suffixed per its own header, see p5a-001) |

2. **DB-level `agent_type` string collisions** — the real attribution risk: multiple distinct
   classes writing the exact same `agent_runs.agent_type` value. The live DB enum already had
   distinct values provisioned for 7 of these 9 groups (added by an earlier, never-committed DDL
   pass — no matching migration file exists in this repo) but the code never used them. This
   session wired the code to use them:

   | Shared bucket (before) | Canonical (stays as-is) | Shadow file (renamed this session) | New DB value |
   |---|---|---|---|
   | `government_research` | `research/government-grants.ts` | `housing-specific-scrapers.ts` | `government_research_housing_scrapers` |
   | `government_research` | `research/government-grants.ts` | `nofa-parser.ts` | `government_research_nofa_parser` |
   | `government_research` | `research/government-grants.ts` | `usaspending.ts` | `government_research_usaspending` |
   | `foundation_research` | `research/foundation-grants.ts` | `foundation-finder.ts` | `foundation_research_finder` |
   | `custom_api_research` | `custom-api.ts` | `custom-scrape.ts` | `custom_scrape_research` |
   | `state_portal` | `state-portal.ts` | `state-scrapers.ts` | `state_portal_housing_scrapers` |
   | `state_portal` | `state-portal.ts` | `tdhca-scraper.ts` | `state_portal_tdhca` |
   | `budget_builder` | `budget-agent.ts` (live, `/api/ai/budget/route.ts`) | `budget-builder.ts` (live via `worker/autonomous-orchestrator.ts`'s `routeQueueItem()`, case `'budget_builder'` — a real `agent_queue`-dispatched implementation, not dormant; a `grep "from ..."`-only importer check misses this since it's a dynamic `await import(...)`) | `budget_builder_worker` |

   All 8 renames are attribution-only: no agent's runtime behavior changed, only which
   `agent_runs.agent_type` value its rows carry going forward. Historical rows under the old
   shared value are left as-is (not backfilled/relabeled).

   **2 groups intentionally left unresolved** — re-investigation found BOTH files in each pair are
   genuinely live and independently wired (not an accidental duplicate with a clear dormant side),
   and no pre-provisioned distinct DB value exists for either. Renaming either without a product
   decision on which should keep the canonical bucket risks silently dropping real runs out of
   existing dashboards/analytics that filter on the shared value — documented here rather than
   guessed, same principle as `UNUSED_AGENT_TRIAGE.md`'s "if in doubt, don't guess" standard:

   | Shared bucket | Writer A | Writer B | Status |
   |---|---|---|---|
   | `corporate_research` | `research/corporate-giving.ts` (cron + primary trigger) | `corporate-scraper.ts` (multi-source trigger, `/api/agents/research` `sources=` flow) | Both live — needs a product decision, not a guess |
   | `browser_automation` | `browser-automation.ts` (used by `automation-worker.ts`, approve routes) | `playwright-agent.ts` (`/api/agents/playwright`) | Both live — needs a product decision, not a guess |

   A regression test (`src/__tests__/unit/agent-type-collision-check.test.ts`) statically scans
   every file in `src/lib/agents/` for its declared `agent_type`/`agentId` and fails CI if any
   *new* collision appears outside this pair's grandfathered allowlist.

3. **Undocumented AG-32+ agents** — everything above AG-30 in the live codebase (AG-32 through
   AG-43, plus `ag-digest`, `ag22_propensity_scoring`, `ag-36-learning-network`, etc.) exists only
   as code/DB additions with **no spec in this document** — this file only ever covered AG-01
   through AG-30. Treat any AG-3x/AG-4x reference elsewhere as undocumented-but-real unless a
   future revision of this file adds a real spec section for it; do not assume absence from this
   doc means the agent doesn't exist (see `AGENT_INVENTORY_COMPLETE.md` for the live inventory).

   **Status update (AR-2.2, 2026-09-17):** `ag22_propensity_scoring` and `ag-32-relationship-graph`
   both depend on `corporate_prospects`, which is live in production (5 migrations already applied:
   107/108/109/111/179 — see `SCHEMA_REGISTRY_v2.md` §36). Both agent types have been completing
   successfully in `agent_runs` since 2026-09-11 16:17 UTC. `ag-05-draft` writes to
   `applications.knowledge_patterns_applied`, also confirmed live (backfilled into
   `supabase/migrations/183`); it hasn't run since 2026-08-08 so a post-fix success isn't directly
   confirmed, but the schema now matches its write path exactly.

---

## AutoApply agent identity (AR-1.2, 2026-09-17)

Distinct from the p5a-002 collision cleanup above: the 40-module AutoApply pipeline under
`src/lib/autoapply/**` (invoked directly from `worker/queue-processor.ts`, never through
`BaseAgent`) had declared **no** `agent_type` at all — not a collision, an absence. A live query of
`agent_runs` on 2026-09-17 returned 51 distinct `agent_type` values and none were AutoApply, so no
AutoApply execution was ever attributable.

10 new values were added (`src/types/agents.ts`, migration `182_autoapply_agent_identity.sql`):
`autoapply_form_analyzer`, `autoapply_form_filler`, `autoapply_registration`,
`autoapply_submission_validator`, `autoapply_receipt`, `autoapply_risk_engine`,
`autoapply_pitch_personalizer`, `autoapply_captcha_solver`, `autoapply_confirmation_parser`,
`autoapply_queue_processor` — one per real module/call-site, none aliasing the pre-existing
`form_analyzer`/`form_filler` values (those belong to the *separate*, `BaseAgent`-driven
`src/lib/agents/form-analyzer.ts`/`form-filler.ts` Vercel API route implementations).

Since `worker/tsconfig.json` doesn't include `src/lib/agents/` (so these modules can't import
`BaseAgent`), logging goes through a new standalone module, `src/lib/autoapply/run-logger.ts`
(`withAgentRun`), giving the same running → completed/failed `agent_runs` contract without the
dependency. A new test, `src/__tests__/unit/agent-type-uniqueness.test.ts`, extends the p5a-002
collision guard's pattern across both `src/lib/autoapply/**` and `src/lib/agents/**` so this
absence-of-identity problem and the collision problem can't recur in either direction. Full detail
in `STATE_OF_THE_BUILD.md`'s "AR-1.2" section.

---

## AutoApply submit integrity (AR-3.1, 2026-09-17)

`autoapply_form_filler` (`src/lib/autoapply/form-filler-agent.ts`, identity added above in AR-1.2)
could previously log a `completed` `agent_runs` row — and `worker/queue-processor.ts` could
previously persist `autoapply_submissions.status = 'submitted'` — for a submission that never
reached the funder's portal. A browser silently refusing an HTML5-`required` form submit throws
nothing and navigates nowhere, and `fillAndSubmit()` had no way to tell that apart from a real
success. Fixed by three changes to `FormFillerAgent` (adapter for `FormAnalyzerAgent`'s real
array-shaped `field_mapping`; a pre-submit required-field gate; a bounded verified-signal wait in
`submitForm()`) plus a discriminated `FillResult.outcome` that `worker/queue-processor.ts`'s new
`mapFillOutcomeToStatus()` maps honestly to `autoapply_submissions.status`, including a new
`'submit_unverified'` value (migration 184) for the ambiguous case. Full incident writeup in
`STATE_OF_THE_BUILD.md`'s "AR-3.1" section; contract detail in `AUTOAPPLY_ARCHITECTURE_V2.md`'s
"Submit-integrity note (AR-3.1)".

---

## Agent exercise harness (AR-4.1, 2026-09-17)

63 agents were wired but had never executed once; 27 of the 51 registered PIL agents specifically
had never executed. Neither "wired" nor "registered" means "proven" — nothing had ever actually
invoked them, so whether they work was unknown, not just undocumented. `scripts/audit/exercise-all-agents.ts`
converts that unknown into either "proven working" (a completed `agent_runs`/`pil_agent_runs` row,
or for the 3 agents with no DB write at all, a verified `alerts` side effect) or a concrete,
reproducible failure (`threw`/`timeout`) or a concrete no-op (`no_effect` — ran without error but
produced no verifiable result, e.g. blocked by policy, escalated at delegation depth 0, or gated on
missing upstream data). **Returning without throwing is never sufficient for "success"** — that
distinction is the entire point of the harness; see its own header comment.

`scripts/audit/agent-exercise-registry.ts` is the derived-from-source inventory this harness runs
against: **144 invocable agents** found by scanning `src/lib/agents/**` (83: 55 `BaseAgent`
subclasses + 25 `AutonomousAgent` subclasses + 3 plain functions with no `agent_type`/DB write),
`src/lib/pil/agents/**` (51, dispatched through `AgentRunner`/`loadAgentImpl`, not 44 —
`AGENT_FACTORIES` in `src/lib/pil/agents/index.ts` has 51 real entries despite the file's own
header comment and `PROSPECT_INTELLIGENCE_AGENTS.md`'s Fleet Summary both still saying 44),
`src/lib/autoapply/**` (9, one per real `AGENT_TYPE` module), and `src/lib/intelligence/**` (1,
`ag-18-reputation`). `src/lib/research/**` contributes **zero** — it's config/data only; the four
"research lane" agent classes it configures physically live under `src/lib/agents/research/**`
and are already counted in the 83 above. No file anywhere in the repo claims "154 agents" (checked
directly) — the two real, disagreeing totals already in circulation before this session were 44 vs
51 for PIL alone, plus an unreconciled ~50+ file count for the `ag-NN` core family. 144 is the real,
source-derived number; treat any other total (44, 48, 51-alone, 154) as describing a subset or a
stale doc, not the whole system.

`scripts/audit/seed-exercise-org.ts` idempotently seeds one clearly-tagged `EXERCISE-HARNESS-`
organization (org profile, knowledge_base, funder, opportunity, request_profile, application,
outcome, funder_giving_history, search_profile, corporate_prospect, an approved
automation_sessions row, and a pil_research_goals/pil_research_runs pair) so PIL agents have a
valid `research_run_id` to attach to. Browser-driven agents (`form-analyzer`, `form-filler`,
`browser-automation`, `playwright-agent`, `registration-agent`, autoapply's captcha/confirmation
modules) are pointed at a local fixture file
(`scripts/audit/fixtures/fixture-application-form.html`) via `StealthBrowser` — never at a live
funder portal; the harness hard-refuses to run against any organization whose name doesn't start
with `EXERCISE-HARNESS-` unless `--allow-real-org` is passed. Default `--max-agents=25` caps token
spend on a first run; `--family=`/`--agent=`/`--dry-run` narrow it further. The harness always
exits 0 (it's a measurement instrument, not a gate) and writes `AGENT_EXERCISE_REPORT.md` +
`scripts/audit/agent-exercise-results.json`.

**Phase 5 and every remediation phase after it are gated on this harness's first full report.**
Fixing an agent nobody has run is guesswork; this is what turns that guesswork into a punch list.
Run it with `pnpm tsx scripts/audit/exercise-all-agents.ts --dry-run` first (lists all 144 without
invoking anything), then in bounded `--family=`/`--max-agents=` slices for the real pass — not the
full 144 at once — given the Claude/browser/live-API cost each real invocation carries.

---

## Single cost ledger: `ai_usage_log` (AR-5.1, 2026-09-17; corrected by AR-9.2, 2026-09-18)

Every agent that spends money — `AgentRunner.useTool()` and `AgentRunner.finalizeRun()` in
`src/lib/pil/agent-runner.ts`, called by every PIL agent (AG-31+ / BEN-* families) that reports
token usage or calls a priced tool — records that spend into `ai_usage_log`, not
`pil_cost_ledger`. `pil_cost_ledger` is superseded and read-only as of migrations 185-186; nothing
in `src/` or `worker/` inserts into it anymore. `recordCost()` (`src/lib/pil/cost.ts`) is the single
*insert function*; route every new priced PIL action through `useTool()` rather than calling it
directly, same rule as before — that's what keeps tool calls attributable to `context.tools` in the
first place.

**This was not the whole platform.** AR-5.1's own writeup called `recordCost()` "the" writer of
`ai_usage_log` without checking whether the platform's actual highest-volume traffic — the ~91
`BaseAgent`/`AutonomousAgent` subclasses under `src/lib/agents/**` (AG-01 through AG-30's nightly
batch jobs, on-demand eligibility/research/draft agents, `ag-29-knowledge-indexer`'s 24/7 poll loop)
— ever called it. It didn't; those agents call Anthropic through the separate shared wrapper
`src/lib/ai/claude.ts`, which never recorded cost at all. Live-verified (AR-9.2): 184 real
`agent_runs` in 3 hours produced 0 new `ai_usage_log` rows. As of AR-9.2, `callClaude`/
`callClaudeConversation`/`callClaudeWithTools`/`callClaudeWithWebSearch` in `src/lib/ai/claude.ts`
also record cost, after every successful call, attributed via a new `AsyncLocalStorage` context
(`src/lib/ai/usage-context.ts`) set once at `BaseAgent.run()`/`AutonomousAgent.startRun()` — if you
are writing a new agent that extends either base class and calls `callClaude*`, cost recording is
automatic; you do not need to call `recordCost()` yourself. If you are writing a new PIL agent, keep
routing through `useTool()` as above. Full defect/fix writeup: `STATE_OF_THE_BUILD.md`'s AR-9.2
entry.

**Never write `new Anthropic(...)` directly.** As of the AR-9.2 recovery pass, the ~34 modules that
did (under `src/lib/autoapply/**`, `src/lib/intelligence/**`, `src/lib/donor-discovery/**`,
`src/lib/scraper-v2/**`, `src/lib/enrichment/**` and others) construct their client with
`createTrackedAnthropic(options, source, billingPath)` from `src/lib/ai/tracked-anthropic.ts`
instead — it returns a real `Anthropic` client whose `messages.create` records every successful call,
so instrumentation is inherited by construction rather than re-added at each call site. If you need a
raw client, use that factory; a bare `new Anthropic(...)` records nothing and is the one pattern that
re-opens this defect.

**Cost recording requires an active usage context.** `ai_usage_log.organization_id` is `NOT NULL`, so
a call outside any agent run boundary writes no row and instead raises a throttled `system_errors`
alert (`usage_log_no_context`) visible on `/admin/system`. If you write a code path that calls
Anthropic outside `BaseAgent`/`AutonomousAgent` (e.g. a worker helper or an operator script), wrap it
in `runWithUsageContext({ organizationId, agentType, agentRunId }, ...)` from
`src/lib/ai/usage-context.ts` or its spend will be reported as unattributed rather than captured.
Verify any change to this path with `pnpm verify:ai-usage`, which makes two real minimal Anthropic
calls against production and fails if either writes no row.

New columns on `ai_usage_log` relevant to agent authors: `cost_usd` (numeric, real dollars — use
this, not the old `estimated_cost_cents`), `pil_agent_run_id` (PIL run attribution;
`agent_run_id` is reserved for the core, non-PIL `agent_runs` pipeline — AG-01 through AG-30's
nightly batch jobs, not PIL agents), and `billing_path` (`'api'` for anything calling the real
Anthropic API — which is every PIL agent — vs `'subscription'` for FORGE's own `claude` CLI build
runs — these record real token counts with `cost_usd` deliberately `NULL`, since subscription tokens
carry no per-token dollar cost). Full defect list and live verification in
`STATE_OF_THE_BUILD.md`'s "AR-5.1" and "AR-9.2" sections and `SCHEMA_REGISTRY_v2.md`'s
"`ai_usage_log` writers, corrected" section.

**Do not assume this ledger reflects total platform spend.** Live-verified 2026-09-18: 52 rows,
`sum(cost_usd) = 0.377406`, 0 unpriced rows. Every Anthropic *call site* is instrumented, but captured
spend is bounded by attribution (see the usage-context note above), so the recorded total is a floor
on real usage, not a complete bill.

---

## Budget enforcement is now real: `cost_budgets` + spend accrual (AR-5.2, 2026-09-17)

Every `ai_usage_log` insert (i.e. every `recordCost()` call, which means every `useTool()`/
`finalizeRun()` call in `AgentRunner`) now automatically increments the inserting org's `'org'`-scope
`cost_budgets` row (renamed from `pil_cost_budgets`) via a DB trigger — agent code does not need to,
and must not try to, update `spent_usd` itself. `AgentRunner.run()` calls `checkBudget(context.orgId)`
once, before an agent starts; a `hard_stop=true` budget at its limit now genuinely throws
`BudgetExceededError` there. **This does not interrupt an agent already running** — there is no
mid-run cost polling in `AgentRunner`, so a budget exhausted by an agent's own spend blocks only the
*next* run for that org, not the current one. Keep routing every priced action through `useTool()`
rather than calling `recordCost()` directly — that's what keeps both attribution and budget accrual
correct.

`checkBudget()`'s signature is now `checkBudget(orgId, scopeType = "org", scopeId = orgId)` — the old
`checkBudget(orgId, costType)` form is gone (`costType` was already unused for enforcement, only for an
error string). `BEN-SUP-03.ts` and `BEN-SUP-04.ts` read `spent_usd` via `getBudgetSummary()` and their
own `isBudgetConstrained()`/`isConstrained()` helpers — unchanged by this migration, since neither
called `checkBudget()` or referenced the table name directly; their soft "constrained" signal (spend
above `alert_threshold_pct`) now reflects real, accruing spend rather than a frozen insert-time value.
A new `'orchestration'` scope exists on `cost_budgets` for a future orchestration-layer budget, but
nothing writes its `spent_usd` yet — only the `'org'` scope auto-accrues today. Full detail in
`SCHEMA_REGISTRY_v2.md`'s "Budget Enforcement" section.

---

## Orchestration alerts extend `public.alerts` — no second alert table (AR-6.1, 2026-09-17)

Any agent or orchestrator emitting an operational alert (a failed task, a budget overage, a schema
mismatch, state drift, a rate limit hit, a timeout, a rollback, or something needing human review)
writes to the existing `public.alerts` table (migration 013) using one of eight new `alert_type`
enum values added by migration 188: `task_failed`, `cost_overage`, `schema_mismatch`,
`state_drift`, `rate_limit`, `timeout`, `rollback`, `manual_review_required`. There is still exactly
one alerts table on this platform — do not create `orchestration_alerts` or any parallel table for
future orchestration/PIL work; extend `alert_type` and the `alerts` columns instead, the same way
this migration did.

Migration 189 added `alerts.orchestration_id` (nullable `uuid`, no FK yet — no single orchestration
registry table exists across PIL/AutoApply/agent-runner) so an orchestration-emitted alert can be
traced back to its run, and `alerts.notified_at` (delivery idempotency marker, for the outbound
notification dispatch work in prompt 6.4).

Dedup key builders for these eight types live in `dedupKeys` in
`src/lib/alerts/alerts-service.ts` (e.g. `dedupKeys.orchestrationTaskFailed(orchestrationId,
agentType)`) and are deliberately deterministic — no `crypto.randomUUID()` component — so repeated
occurrences of the same orchestration event collapse under `uq_alerts_org_dedup` instead of piling
up as duplicate rows. Any new agent writing an `alerts` row must use a `dedupKeys` builder, never a
random-suffixed key — see "Every `alerts.dedup_key` is deterministic" (AR-11.3) below for the
contract and the six sites that used to violate it. Full detail in `SCHEMA_REGISTRY_v2.md`'s
"Orchestration Alert Types" section.

---

## `orchestration_logs` gives every orchestrator step a falsifiable success claim (AR-6.2, 2026-09-17)

`worker/autonomous-orchestrator.ts` now writes one `public.orchestration_logs` row per step attempt
at 25 boundary points, covering 51 of 52 distinct step types in the file: the 16 nightly per-org
sweep steps, all 27 `agent_queue`-routed agent types (one shared wrapper around `routeQueueItem()`),
`AutonomousDigestAgent`, and 7 of the 8 standalone scheduler.ts pipelines (AG-10, AG-23, AG-26,
AG-27, AG-36, AG-42, disaster-response's auto-deploy branch). **Any new agent wired into this
orchestrator must call `runOrchestrationStep()` from `src/lib/orchestration/orchestration-log.ts` at
its call site** — do not add a raw `orchestration_logs` insert, and do not add a new dynamic-import
dispatch path that bypasses both `runOrgPipeline()`'s step list and `routeQueueItem()`.

`schema_validation_passed` and `reconciliation_passed` are booleans set by the caller, not derived
from `status` — a step can complete (`status='completed'`) with `schema_validation_passed=false` if
it produced output that didn't pass its own evidence check (the AutoApply
`status='submitted'`-with-no-confirmation-number defect from the 2026-09-16 agent audit is exactly
the failure mode this pair of columns exists to make visible). Nothing in this table's writer
infers these from `status` automatically — an agent that wants real evidence-validation tracking
must set `schemaValidationPassed`/`reconciliationPassed` explicitly via `toOutcome` when it calls
`runOrchestrationStep()`.

**Named gap:** `runSelfImprovementPipeline()` (AG-38's dedicated 4:00 AM CST cron entrypoint) does
not write to `orchestration_logs` — `SelfImprovementAgent` runs with `agent_runs.organization_id =
null` by design (migration 088), and this table's `organization_id` is `NOT NULL`. AG-38 is still
covered when it runs via `agent_queue` instead (`ag-38-self-improvement` case has a real `org_id`
from the queue row). Full boundary-by-boundary detail in `STATE_OF_THE_BUILD.md`'s "AR-6.2" section.

---

## Deterministic alert rules replace meta-agent monitoring in the hot path (AR-6.3, 2026-09-17)

Five Postgres triggers (migration 191) now raise `public.alerts` rows directly off
`orchestration_logs`/`cost_budgets` writes — **no agent, no LLM call, in this path.** A monitoring
agent that can itself fail is not monitoring; deterministic SQL cannot silently die the way six agent
types did on `AGENT_TIMEOUT_MS` before the 2026-09-16 audit. Any new agent wired into
`worker/autonomous-orchestrator.ts` that calls `runOrchestrationStep()` (per AR-6.2's convention
above) gets `task_failed`/`schema_mismatch`/`state_drift`/`timeout` coverage for free — no additional
agent-side alerting code needed. An agent with genuine retry logic (`agent_queue`'s
`retry_count`/`max_retries`) should pass `ctx.retryCount`/`ctx.maxRetries` to
`runOrchestrationStep()` so `task_failed` can tell a final failure from one that will retry; omitting
them means every failure from that call site reads as final (critical).

**`rate_limit`, `rollback`, `manual_review_required` are the three types no trigger can derive** —
raise them from application code via `src/lib/alerts/raise-orchestration-alert.ts`, not a raw
`alerts` insert (it shares the same `(organization_id, dedup_key)` dedup contract as the trigger
side, and swallows every failure the same way — an alerting call must never be able to fail the
work it's observing). `worker/queue-processor.ts` now does this in its `IncompleteSubmissionError`
catch branch: AutoApply's own deliberate refusal to submit a form with required fields still empty
(AR-3.1) previously fell into `classifyError()`'s generic `'failed'` bucket with no alert at all — a
correct refusal that produced silence, not an incident.

**`state_drift` is DB-reconciliation, not a markdown diff — do not build it toward the latter.** The
Orchestration spec's section 8 proposed snapshotting `STATE_OF_THE_BUILD.md` around each task; that
was rejected (a governance doc that build agents update as normal, legitimate work would trigger
"drift" on every real update). If a future agent's own logic wants stronger reconciliation than the
generic terminal-status/items-coherence check migration 191 does, pass
`reconciliationPassed`/`schemaValidationPassed` explicitly via `runOrchestrationStep()`'s
`toOutcome()` callback — do not add file-reading logic to any trigger, and do not add a second,
broader `items_processed <> items_expected` check to the trigger itself (a first draft of exactly
that was written, then rejected before ever reaching the live database, once a read of this file's
own call sites showed `items_processed < items_expected` is the ordinary healthy shape, not a
failure).

Full rule-by-rule detail, dedup key shapes, and the flagged-but-unfixed Rule 2 dedup gap (no
budget-period component): `SCHEMA_REGISTRY_v2.md`'s and `STATE_OF_THE_BUILD.md`'s "AR-6.3" sections.

---

## Critical alerts reach a human via the worker, not SQL (AR-6.4, 2026-09-17)

`worker/alert-notifier.ts` is the delivery leg AR-6.1's `alerts.notified_at` column and AR-6.3's
trigger-raised rows were both built toward. It is a poll loop, not an agent — no LLM call anywhere in
this path, matching AR-6.3's "no meta-agent in the hot path" precedent. Any new code that raises a
`critical` alert (a new trigger, or a new `raise_orchestration_alert()`/`raiseOrchestrationAlert()`
call site) gets Slack delivery for free with zero additional wiring — the notifier polls by
`severity`/`notified_at`, not by alert type or source.

**If you add a new critical alert type or source, you do not need to touch this file.** The one thing
that *would* require a change here: if a new alert type's `message` can legitimately contain a secret
shape `redactSecrets()` (`src/lib/orchestration/orchestration-log.ts`, AR-6.2) doesn't already cover —
extend that shared pattern list, not a local one in the notifier, so `orchestration_logs` and Slack
delivery stay covered by the same redaction guarantee rather than two that can drift apart.

**Do not remove the `organizationId` scoping option on `pollOnce()`.** It exists only for tests
(every production call site — the `AlertNotifier` class, `worker/index.ts` — calls it unscoped, which
is correct: the worker must service every org's pending alerts in one batch). It was added after
calling the unscoped function from a test against the live database delivered 39 real production
alerts to a fake test webhook and marked them `notified_at` — see `STATE_OF_THE_BUILD.md`'s "AR-6.4"
section for the full incident and revert. Any new test that exercises delivery against the live
database must pass this option; do not call the production-shaped unscoped query from a test again.

`public.model_cost_reference` (migration 192) is a plain reference table, not organization-scoped —
if you add a new model this codebase calls, add its row here with a live-verified rate and today's
date as `effective_from`, not a copied or recalled figure (this table exists specifically because the
originating spec's rate card was a year stale and would have shipped confidently wrong numbers). The
five dashboard views (migration 193) read cost from `ai_usage_log`, never `orchestration_logs` — that
table carries no cost columns by design (AR-6.2) — and are declared `security_invoker = true`; a new
view built the same way must repeat that declaration explicitly, since Postgres does not infer it from
sibling views.

Full detail: `SCHEMA_REGISTRY_v2.md`'s and `STATE_OF_THE_BUILD.md`'s "AR-6.4" sections.

---

## `automation_sessions` must reach a terminal status on every path, or it deadlocks AutoApply (AR-7.2, 2026-09-17)

The mutual-exclusion guard between the two AutoApply implementations —
what code comments (WGR-167, BEHAVIORAL_CONTRACTS §18) call "Agent 16"
(`/api/agents/automation`, `automation_sessions`, browser automation with
human approval — note this is NOT this registry's `AG-16` (Digital Twin
Builder); the "Agent 16" name is a pre-existing numbering collision, see
"Canonical implementation per AG-NN slot" above, not something this change
introduced or resolved) and the `submission_queue` pipeline
(`worker/queue-processor.ts`, the same one AR-1.2/AR-3.1 fixed) — is correct
in intent (one automation per org+funder at
a time, `SubmissionValidator.checkConcurrentAutomation()`) but was a live
deadlock in practice: a session created and then abandoned (crash, kill, or
simply left in `awaiting_approval` forever by an inattentive reviewer) blocks
that org+funder pair permanently, because nothing ever revisits a session
once its owning process exits. Production evidence: `autoapply_queue_processor`
had never once succeeded — 32/32 runs failed on `concurrent_automation_conflict`
— and AR-3.1's submit-integrity fix could not execute as a direct result.

**If you add a new code path that creates an `automation_sessions` row
(a third pipeline, or a new branch in either existing one), it must reach a
terminal status (`submitted`/`failed`/`cancelled`) — or, for the Agent-16
approval flow specifically, `awaiting_approval` — on every exit, including a
thrown error.** Prefer a `finally` over relying on a catch block that
happens not to re-throw; a future edit to that catch can silently reopen this
exact deadlock without anyone noticing, since the only symptom is a slow
accumulation of stuck rows, not an immediate error at the call site that
introduced it.

**Crashes and kills are not solvable in application code — that's what the
watchdog is for.** `worker/stuck-run-watchdog.ts`'s `reapStaleAutomationSessions()`
sweep (same 10-minute loop as the existing `agent_runs`/`pil_agent_runs`
sweeps) closes anything left non-terminal past a per-status threshold: 30
minutes for the three technical mid-flight statuses (`pending`/`in_progress`/
`approved`), 7 days for `awaiting_approval` specifically because that state
is a genuine human wait (session-manager.ts's PAUSE-FOR-APPROVAL INVARIANT),
not a bug — do not lower that threshold without re-reading the reasoning in
that file's header comment; live data showed real, still-plausibly-pending
approval requests aged up to 13 days before the 99-day outlier that finally
forced this fix.

**Not deployed this session.** The `finally`-block relocation and the
post-run guard on `processBrowserAutomationItem()` are code-only — the
Railway worker was not redeployed ("DO NOT DEPLOY"). The watchdog sweep and
the alerting it raises were still applied against production data this
session: once via a one-time migration (`195_reap_stuck_automation_sessions.sql`)
that closed the 7 rows already stuck, using the identical threshold logic the
watchdog will use once it does deploy. Full step-by-step, the reaped row ids,
and the three closing questions answered directly: `STATE_OF_THE_BUILD.md`'s
"AR-7.2" section.

**Deployment status update (AR-12.1, 2026-09-18, later the same day):**
this deadlock fix IS now live — `automation_sessions` holds 0 non-terminal
rows in production as of this session, confirmed by direct query, not
inference. `concurrent_automation_conflict` still appears frequently in
`agent_runs` (39 occurrences in the ~26h before AR-12.1) — **that is not a
regression of this deadlock.** It is `checkConcurrentAutomation()` correctly
declining a new run while another is genuinely in flight for the same
org+funder; the deadlock this section describes was specifically a session
never reaching a terminal status at all. Do not re-open an investigation
into this section on skip-count alone — check whether `automation_sessions`
actually holds non-terminal rows first.

**What replaced it as `autoapply_queue_processor`'s next blocker (AR-12.1):**
not a code bug in the mutual-exclusion check itself, but a data-integrity
gap one step downstream — `funders` had no delete-time awareness of
`submission_queue`. See the new "`funders` deletion must not orphan
`submission_queue` rows (AR-12.1, 2026-09-18)" section immediately below.

**What actually blocked the first completed run (AR-12.2, 2026-09-18):**
none of the above — `org_not_ready`/`no_funder_id`/`funder_not_found`/
`concurrent_automation_conflict` were all this repo's own integration
suite exercising `processItem()`'s guard branches on synthetic orgs, not a
real backlog. The two real blockers: (1) `checkCrossClientDedup()`
permanently blocking the one safe test target (`httpbin.org`) on orphaned
`cross_client_submissions` rows a test never cleaned up — fixed the test,
not the guard; (2) the actual bug — `FormAnalyzerAgent.analyzeAndStore()`
never navigates the page, and `queue-processor.ts` only called
`page.goto()` on the cached-template path, so every *first* analysis of a
funder read a blank browser page and cached a 0-field template. Fixed by
navigating once, unconditionally, before either branch. If you touch
`processItem()`'s analysis branch again: the page must already be on
`portalUrl` before `FormAnalyzerAgent.analyzeAndStore()` runs — that agent
will silently accept whatever is currently loaded rather than erroring on
a blank page. Full chain: `test-evidence/AUTOAPPLY_BLOCKER_CHAIN.md`.

---

## `funders` deletion must not orphan `submission_queue` rows (AR-12.1, 2026-09-18)

`src/components/funders/FunderDetail.tsx`'s delete button issues a plain
client-side `supabase.from("funders").delete().eq("id", ...)` with no query
against `submission_queue` first. `submission_queue_funder_id_fkey` is
`ON DELETE SET NULL`, not a block, so deleting a funder that still has a
`pending`/`processing` AutoApply queue item silently nulls the reference
instead of cancelling it — the item sits until the worker dequeues it,
discovers the funder is gone (`worker/queue-processor.ts`'s `processItem()`,
`funder_not_found`), and only then goes terminal. Production evidence: 1
occurrence, ever (2026-09-18 02:42:18 UTC) — real, but rare.

**If you add a new code path that deletes a `funders` row** (a bulk-cleanup
script, a future admin tool, a merge/dedup feature), you do not need to add
your own `submission_queue` check — `supabase/migrations/200_funder_delete_cancels_queue_items.sql`
installed a `BEFORE DELETE ON funders` trigger
(`cancel_queue_items_on_funder_delete()`) that cancels every non-terminal
dependent `submission_queue` row (marks it `'skipped'` with a
`funder_deleted: ...` reason) and raises a `manual_review_required` alert,
for **any** delete path, not just the UI button. It is wrapped in
`EXCEPTION WHEN OTHERS` (same blast-radius contract as migration 191's alert
rules) so a bug in this safety net can never block a legitimate deletion —
if you need to verify it actually fired for a given delete, check
`submission_queue.error_message ILIKE 'funder_deleted:%'` and the
`alerts` table, not just that the delete succeeded.

---

## Agent Registry Schema

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

---

## AR-10.1 — PIL agent cost instrumentation now traces to model_cost_reference (2026-09-18)

Every agent above that runs inside the PIL framework (`src/lib/pil/agents/**`
— the APP/DIS/INT/KNW/OPS/QLF/REL/STR/SUP families, i.e. the Prospect
Intelligence agents this doc's Phase 3 section describes) reports its token
usage through `AgentRunner.useTool(context, "T-MODEL", { costType:
"model_tokens", ... })`. That call previously priced every token at a flat,
undated, unsourced $0.00002 (`MODEL_TOKEN_UNIT_COST_USD`, defined
independently in 28 places) regardless of which model actually ran, and
`AgentRunner.finalizeRun()` wrote a second, duplicate `ai_usage_log` row for
the same tokens on top of that — every PIL-framework dollar figure was
~4.4x overstated. Both bugs are fixed: `useTool()` now resolves the rate from
`model_cost_reference` via `src/lib/pil/model-pricing.ts`'s
`pilBlendedTokenRateUsd()`, tags the row with the real model id
(`PIL_AGENT_MODEL = "claude-sonnet-4-6"` — the model this doc's "Model:
claude-sonnet-4-6 for all agents unless specified" line already names), and
`finalizeRun()` no longer double-writes. Full detail, exact file counts, and
the before/after dollar comparison: `STATE_OF_THE_BUILD.md`'s "AR-10.1"
section.

Every agent in Phase 1/2 (AG-01..AG-30, the `agent_runs`-table agents, not
the PIL framework) was already unaffected by this bug — those record through
`src/lib/ai/claude.ts`/`src/lib/ai/usage-recorder.ts`, fixed earlier the same
day by AR-9.2, and `src/lib/pil/model-pricing.ts` is a superset rename of
that fix's resolver (`src/lib/ai/pricing.ts`), not a second implementation.

---

## AR-11.1 — The Failing Twelve: cause grouping for chronically failing agent types (2026-09-18)

Live `agent_runs` counts (65,826 rows, 2026-06-11→2026-09-18): 62 distinct
`agent_type` values have ever executed, 12 fail strictly more often than
they succeed. Full ranked table, error-message groupings, and fixes:
`test-evidence/AGENT_FAILURE_LEDGER.md`; narrative summary:
`STATE_OF_THE_BUILD.md`'s "AR-11.1" section.

The 12 failing types collapse to 8 root causes — most of these agent
identities do not correspond 1:1 to a single named agent above; several
(`ea01_giving_detector` = AG-20/EA-01, `ea08_executive_biography_analyzer` =
AG-21/EA-08, etc.) are the `EA-0x` Corporate Intelligence sub-agents this
doc's Phase 3 section describes under AG-20/AG-21, not separately numbered
here — their `agent_type` strings in `agent_runs` are their own EA-code
names, not `AG-NN`.

| Cause | Agents affected | Status |
|---|---|---|
| 1. Missing Chromium binary (AR-7.1) | ea01, ea02, ea05, ea08, ea09 | Code fixed (`src/lib/browser/launch-chromium.ts`), prod pending worker redeploy |
| 2. `success_probability_scores` upsert conflict target (WGR-170) | success_probability | Fixed live 2026-09-11 (migration 149), confirmed |
| 3. Vercel 60s function timeout | foundation_research, local_sponsorship, review, budget_builder | Confirmed fixed live (`maxDuration=300` on all 4 routes) |
| 4. Hardcoded dated Claude model string (404) | budget_builder | Confirmed fixed live (centralized `DEFAULT_MODEL`) |
| 5. Missing `applications.knowledge_patterns_applied` column | ag-05-draft | Confirmed fixed live (migration 183) |
| 6. One-time stuck-run sweep artifact (AR-7.2) | review | Already covered by `worker/stuck-run-watchdog.ts`, no action |
| 7. Correctly-rejected out-of-order review call | review | Not a defect — `review-agent.ts`'s own precondition check working as intended |
| 8. Deliberate skips recorded as `agent_runs.status='failed'` | autoapply_queue_processor | **Fixed this session** — `src/lib/autoapply/run-logger.ts` |

Cause 8 is the only new defect this audit found: `worker/queue-processor.ts`
already had the right business logic (`SkipError` et al. correctly persist
`submission_queue.status='skipped'`, never `'failed'`) — the bug was one
layer up, in the shared `agent_runs` logging wrapper
(`src/lib/autoapply/run-logger.ts`, AR-1.2) that every agent_type in this
doc's "Agent Registry Schema" section relies on for its execution telemetry.
It had no way to represent "the agent correctly declined to act" as
anything other than "the agent failed" — now it can
(`agent_run_status` enum, migration 001, gains a fifth value: `'skipped'`,
via migration 199).

---

## AR-11.3 — Every `alerts.dedup_key` is deterministic; `uq_alerts_org_dedup` now actually suppresses noise (2026-09-18)

Six call sites built `dedup_key` by appending `crypto.randomUUID()` to an otherwise-sensible prefix
— `base-agent.ts`'s `checkSilentFailure()`, `autonomous-base.ts`'s `createNotification()`,
`deadline-prediction-agent.ts`'s red and amber tier alerts (two sites), `notify.ts`, and
`worker/autonomous-orchestrator.ts`'s `insertAlert()`. A random suffix makes every key unique, so
`uq_alerts_org_dedup` (`organization_id, dedup_key`, migration 013) never fires — those alerts never
deduped at all. Live counts (2026-09-18, un-mass-deleted history): 68 `agent-silent-failure:*` rows
collapse to 8 real events under the new key (60 would have been suppressed), 36
`autonomous:*` generic-notification rows collapse to 35 (1 suppressed), 4
`autonomous-orchestrator:*` rows were already all distinct (0 suppressed) — 61 noise rows out of 108
checked, measured via live SQL, not estimated.

**The contract going forward: derive `dedup_key` only from what makes two occurrences the same
real-world event, never from randomness.** Two shapes cover every case in this codebase:

- **A stable entity is enough on its own, no period needed** — `dedupKeys.deadlinePredictionTier(tier,
  opportunityId)` (same opportunity + same tier is one event; the tier itself already changes the key
  when a deadline moves bands, so a fresh alert isn't needed daily) and
  `dedupKeys.autonomousOrchestratorEntityAlert(type, entityId)` (same pattern for
  `worker/autonomous-orchestrator.ts`'s `draft_review` alerts, keyed on `applicationId` ??
  `opportunityId`).
- **No entity id is available — add a day bucket (`dateKey`, `new Date().toISOString().slice(0, 10)`)
  plus a content fingerprint.** `dedupKeys.agentSilentFailure(agentIdentifier, dateKey)` covers the
  silent-failure pattern on both base classes (same agent + same org + same UTC day is one event; a
  new day is deliberately a new event, so a chronically-broken agent keeps alerting instead of going
  silent after one dismissed row). `dedupKeys.autonomousNotification(agentId, type, dateKey,
  contentKey)`, `dedupKeys.userNotification(eventType, userId, dateKey, contentKey)`, and
  `dedupKeys.autonomousOrchestratorContentAlert(type, dateKey, contentKey)` cover the generic
  notification helpers that receive free-text `title`/`message` but no entity id — `contentKey` is
  `contentFingerprint(...)` (also exported from `alerts-service.ts`), a short FNV-1a hash of the
  type-specific content. This is what stops two different documents/funders/prospects notified the
  same day from colliding into one alert (a real regression a plain `type + dateKey` key would have
  caused), while a byte-identical repeat still dedups.

`contentFingerprint()` is deliberately not `node:crypto` — `alerts-service.ts` is shared with the
client UI (Alerts page, Sidebar badges; see file header), so it has to stay usable in a browser
bundle. Collisions are an accepted tradeoff (worst case, two distinct alerts merge under one key on
the same day — noise reduction, not data loss, and not a security property).

**Any new `alerts` insert must use one of the `dedupKeys` builders above — never
`` `${prefix}:${crypto.randomUUID()}` ``, and never a bare `type + dateKey` key if the call site's
message/title can vary per entity.** Regression coverage:
`src/__tests__/unit/dedup-key-determinism.test.ts` (byte-identical key for the same event, no
collision across genuinely different events, new key in a new period) and the FORGE gate
`scripts/audit/forge-gates/ar-11-error-and-dedup.mjs`, which greps `src` and `worker` for
`dedup_key.*randomUUID` on every run.

---

## AR-9.3 — AutoApply end-to-end proof; `autoapply_form_filler`'s KB-derived EIN/email/phone/address were dead code (2026-09-18)

Building the first full-chain proof for `autoapply_form_filler`
(`src/lib/autoapply/form-filler-agent.ts`, identity registered above in
AR-1.2) — a local fixture portal with real `required` fields, driven by real
Playwright + real Claude + the real production pipeline in the same order
`worker/queue-processor.ts`'s `processItem()` calls it (mutex guard →
`StealthBrowser` → `FormAnalyzerAgent` → `SubmissionValidator` →
`FormFillerAgent` → status mapping → `autoapply_submissions` insert →
session finalization) — surfaced a genuine bug in `buildFillData()`, the
private method that assembles the values `fillPageFields()` writes into the
form.

`buildFillData()` tried to source `organization.ein`,
`organization.contact_email`, `organization.phone`, and
`organization.address` by string-matching `knowledge_base.category` against
`'ein'`/`'contact_email'`/`'phone'`/`'address'`/etc. But
`knowledge_base_category` (migration 001) is a closed Postgres enum —
`mission | vision | need_statement | program_description | impact |
capacity | sustainability | partnerships | budget_justification |
organizational_history | custom` — with no member any of those checks can
ever match. Any funder form with a `required` EIN/email/phone/address
field — precisely the fields `FormAnalyzerAgent.mapLabel()` (the same file's
sibling agent) is built to recognize by label — was silently unfillable in
production, for every organization, regardless of how complete its profile
was: once `mapLabel()` classifies a field, `extractFieldMapping()` marks it
"mapped," which excludes it from `fillUnmappedFields()`'s Claude free-text
fallback too, so nothing downstream could ever fill it either.

**Fix:** `buildFillData()` now also reads `ein`, `contact_email`, `phone`,
and `address_line1` directly off the `organizations` row it already queries
for `.name` — the exact same columns
`SubmissionValidator.checkOrgReadiness()` (`submission-validator.ts`) already
reads for the identical purpose — as a fallback layer any future
`knowledge_base` entry (if the enum is ever extended) can still override.

Regression coverage: `src/__tests__/integration/autoapply-end-to-end.test.ts`
assertion 1 (happy path) fills a real required EIN field end to end via this
exact path; assertion 2 (incomplete) proves an org missing only its `ein`
column correctly produces `IncompleteSubmissionError` rather than silently
proceeding. The suite's own header documents what it does and does not
prove — it drives the named AR-3.1/AR-7.1/AR-7.2/AR-9.2 chain directly
(the same functions/classes/private methods `processItem()` calls, in the
same order), not `processItem()`'s outer orchestration wrapper, which gates
on `assertUrlSafe()` (blocks every local/loopback address, so a
no-external-host fixture portal can never reach it) plus roughly ten
unrelated business rules outside this chain's scope.

---

## AR-13.1 — Full Live Agent Census (2026-09-19)

`test-evidence/AGENT_CENSUS.md` + `agent-census.json` now hold one row per
agent module in the 144-item registry (`scripts/audit/agent-exercise-registry.ts`),
built from live Supabase queries + real source-code invoker tracing, not
from this document. Treat this document's per-agent descriptions above as
design intent; treat the census as ground truth for what actually runs.

**Verdict tally (145 rows: 144 registry modules + 1 supplementary
worker-level row):** 29 OPERATIONAL (20.0%), 52 NEVER-INVOKED (35.9%),
32 DEGRADED (22.1%), 18 NO-OP (12.4%), 10 BROKEN (6.9%), 4 ORPHANED (2.8%).

**Registry accuracy corrections found this pass** (see census §"Registry
corrections found" for detail): `ea-04-foundation-detector.ts` does not
call Claude despite this doc/the registry implying otherwise; 5 AG-*
agents call Claude despite the registry omitting `callsClaude`; ~25 of the
51 PIL `BEN-*` agents make zero Claude/tool calls despite `pilAgentDescriptor()`
hardcoding `callsClaude:true` for all 51; `BEN-STR-01/02/03` are never
invoked, bringing the true PIL never-invoked-or-orphaned count to 27
(not the ~24 previously assumed).

**Registry-gap agents** — real, executed, production `agent_type` values
with no module anywhere in the 144-item registry: `narrative_drafting`,
`ag22_propensity_scoring` (AG-22 PropensityScoringAgent — the Score Engine
chained after every EA enrichment pass, a high-value agent missing from
both this document's phase listings above under that exact name and the
registry), `autonomous_orchestrator`, `fit_analysis` (this document's own
AG-04), `ag-26-forecast` (this document's own AG-26, §"Agent Execution
Order" references it by name), and `ag-43-funder-signals` (undocumented
anywhere, including this file — highest AG number listed above is AG-42).

Full detail, per-agent invoker citations, and rubric scoring:
`test-evidence/AGENT_CENSUS.md`, `test-evidence/agent-census.json`,
`test-evidence/AGENT_INVOCATION_MAP.md` §7.

## AR-14.1 — AG-29's producer restored; empty passes finally reported honestly (2026-09-19)

AR-13.3 (`test-evidence/DATA_PIPELINE_AUDIT.md`) traced AG-29's ~64,600
lifetime runs (96%+ of every `agent_runs` row ever written) to a
producer/consumer field mismatch: `flattenFoundationText()` only read
`programs` and `enrichment.mission`, neither of which any writer in this
codebase has ever populated on `foundation_directory`'s 133,812 rows. The
field every real enrichment writer (`enrich-foundations-propublica.ts`,
`enrich-foundations-990.ts`) actually populates —
`enrichment.propublica` (name/city/state/ntee_code/subsection_code/
totrevenue/totassetsend/totfuncexpns) — was present on 133,811/133,812 rows
and never read.

**Fix (`src/lib/agents/knowledge-indexer-agent.ts`):**
`flattenFoundationText()` now falls back to a new `flattenPropublicaText()`
helper that synthesizes a plain-text Form 990 filing summary from
`enrichment.propublica` whenever `programs`/`enrichment.mission` are both
absent (the universal case). This is the producer fix, not a consumer
workaround — it makes real, already-populated content indexable for the
first time; nothing about AG-29's query/matching logic changed.

**Consumer honesty (`src/lib/agents/autonomous-base.ts` +
`knowledge-indexer-agent.ts`):** `completeRun()` now accepts
`status: "skipped"` (migration 199's enum value, already live) alongside
`"completed"`/`"failed"`. AG-29's `run()` reports `status: "skipped"` when
a pass finds 0 items and pattern aggregation wasn't due — an honest,
distinct signal from `"completed"`, which is now reserved for passes that
did real work (embedded rows and/or ran aggregation).

**Poll cadence (`worker/knowledge-indexer-processor.ts`):** the fixed 60s
sleep-on-empty is now an exponential backoff (60s → doubling → capped at
30 minutes), resetting to the base interval the instant a pass finds work
again. A full-batch pass — which the producer fix turns into ~1,338
consecutive full batches while the 133,812-row backlog drains — now
throttles to one batch every 3 seconds rather than firing with zero delay,
per RC-1's stated blast-radius concern (uncontrolled OpenAI embedding-API
burst).

**New test:** `src/__tests__/integration/knowledge-pipeline.test.ts` (run via
`pnpm test:integration`) — a mocked-client suite (loadPendingBatch() scans
ALL pending rows platform-wide with no org scoping, so a real live-Supabase
run would embed arbitrary production rows) asserting: (1) a
propublica-only foundation_directory row is found and embedded, (2) an
empty pass records `status='skipped'`, not `'completed'`, (3) the
already-working `intelligence_proposal_sections` path is unaffected.

Full detail, live before/after production numbers, and verification output:
`STATE_OF_THE_BUILD.md`'s "AR-14.1" section.

### AR-14.1 recovery note (2026-09-19) — AG-29 verified live, not just in the repo

The AR-14.1 entry above described behaviour that had been written but never
deployed: the commit was local-only, `origin/main` was one behind, and the
Railway worker was still running the pre-fix agent. After the push, with the
worker live at 10:46 UTC:

- AG-29 embedded `foundation_directory` rows **0 → 1,423 in 4.5 minutes**
  (~395 rows/min), the first real output in ~64,000 lifetime runs.
- **94%** of post-deploy runs record `items_processed > 0`, against **0 of
  355** in the 6 hours before.
- Run rate rose 59/hr → **213/hr**, because the producer fix converts 133,812
  rows to pending at once and every pass now fills a full batch (3s throttle)
  rather than sleeping 60s on empty. It will collapse to a few runs/hour once
  the ~5.6h backlog drains and the empty-pass backoff engages.
- `status='skipped'` is **not yet observable live** — no pass can find zero
  items while the backlog exists. Covered by
  `src/__tests__/integration/knowledge-pipeline.test.ts` checkpoint 2; re-query
  production after the drain rather than assuming it.

Event-triggered indexing is unaffected by the new backoff: events route through
`worker/autonomous-orchestrator.ts`'s `routeQueueItem()` `case
'ag-29-knowledge-indexer'`, which does not share the poll loop's sleep.
