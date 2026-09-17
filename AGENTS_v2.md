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

**Per-agent timeout policy (AR-2.1, 2026-09-17):** `BaseAgent`'s own default run
timeout (`AGENT_TIMEOUT_MS`, `src/lib/agents/base-agent.ts`) is 60s — correct
for deterministic, non-Claude agents, but too short for any agent that calls
Claude. Live `agent_runs` showed `review` (4/4 runs, never succeeded),
`budget_builder`, `foundation_research`, `government_research`, and
`local_sponsorship` all failing with `"Agent timed out after 60s."`. Every
`BaseAgent` subclass that imports `@/lib/ai/claude` or `@anthropic-ai/sdk` now
overrides `timeoutMs` in its constructor: **300000ms (300s)** for
research/scraping/drafting agents, **180000ms (180s)** for scoring/review/
classification agents. `src/__tests__/unit/agent-timeouts.test.ts` statically
enforces this — it fails any `BaseAgent` subclass that calls Claude without a
`timeoutMs` override above 60000. (`narrative_drafting`, the other agent type
seen orphaning in `agent_runs`, is not a `BaseAgent` subclass — it's called
directly from `src/app/api/ai/draft/route.ts` and two other routes, which
already set `export const maxDuration = 300` at the route level.)

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

## Single cost ledger: `ai_usage_log` (AR-5.1, 2026-09-17)

Every agent that spends money — `AgentRunner.useTool()` and `AgentRunner.finalizeRun()` in
`src/lib/pil/agent-runner.ts`, called by every PIL agent (AG-31+ / BEN-* families) that reports
token usage or calls a priced tool — now records that spend into `ai_usage_log`, not
`pil_cost_ledger`. `pil_cost_ledger` is superseded and read-only as of migrations 185-186; nothing
in `src/` or `worker/` inserts into it anymore. `recordCost()` (`src/lib/pil/cost.ts`) is the single
writer; route every new priced action through `useTool()` rather than calling it directly, same rule
as before — that's what keeps tool calls attributable to `context.tools` in the first place.

New columns on `ai_usage_log` relevant to agent authors: `cost_usd` (numeric, real dollars — use
this, not the old `estimated_cost_cents`), `pil_agent_run_id` (PIL run attribution;
`agent_run_id` is reserved for the core, non-PIL `agent_runs` pipeline — AG-01 through AG-30's
nightly batch jobs, not PIL agents), and `billing_path` (`'api'` for anything calling the real
Anthropic API — which is every PIL agent — vs `'subscription'` for FORGE's own `claude` CLI build
runs). Full defect list and live verification in `STATE_OF_THE_BUILD.md`'s "AR-5.1" section and
`SCHEMA_REGISTRY_v2.md`'s "Cost Ledger Consolidation" section.

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
