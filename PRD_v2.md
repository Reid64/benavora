# BENAVORA — Product Requirements Document v2.0
## Supersedes: PRD v1.0
## Date: July 17, 2026
## Status: CANONICAL — All features below are approved build targets.
## Authority: Founder directive. This document governs all FORGE build queues.

---

## Product Vision v2.0

Benavora is an AI-powered nonprofit intelligence operating system. It does not merely help nonprofits manage grants — it actively discovers, pursues, wins, and learns from every funding opportunity across grants, corporate donations, in-kind gifts, and disaster relief. The system operates autonomously between sessions, delivering actionable intelligence every morning and executing outreach campaigns while the nonprofit sleeps.

**Core promise:** A solo nonprofit operator with Benavora outperforms a 10-person development team without it.

---

## Platform Pillars (18 total)

### PILLAR 1: Philanthropic Intelligence Graph
A living graph of all relationships between businesses, foundations, government agencies, board members, nonprofits, universities, and community organizations. Every node is an entity. Every edge is a verified relationship. Used by all other pillars as the relationship layer.

**User Stories:**
- PIG-01: As a user, I can search the relationship graph for any entity and see all connected relationships
- PIG-02: As a user, I can find the shortest path between my org and any target funder
- PIG-03: As a user, I can see when new relationships are discovered involving my watched entities
- PIG-04: As a user, I can export a relationship map as a visual PDF for board presentations
- PIG-05: As an admin, the system continuously discovers new edges nightly without my involvement

### PILLAR 2: AI Opportunity Discovery Engine
Benavora wakes up every morning and delivers discovered opportunities. Users rarely need to search.

**User Stories:**
- OD-01: As a user, I see a morning digest of new opportunities found overnight, pre-scored by probability
- OD-02: As a user, opportunities are personalized to my mission, geography, and historical success patterns
- OD-03: As a user, I can one-click add any discovered opportunity to my pipeline
- OD-04: As a user, I can dismiss opportunities with a reason that improves future personalization
- OD-05: As a user, I receive alerts when known funders post new RFPs
- OD-06: As a user, I receive alerts when FEMA declares disasters in my service area
- OD-07: As a user, I receive alerts when legislation affecting my funding category is introduced
- OD-08: As a user, inactive users receive a weekly email digest of top discoveries

### PILLAR 3: Corporate Giving Intelligence (from Corporate Intelligence Engine v1.0)
Full corporate donor acquisition, enrichment, scoring, and outreach. See CORPORATE_INTELLIGENCE_ARCHITECTURE.md.

### PILLAR 4: Autonomous Relationship Builder
AI development director that maintains relationship memory and recommends exactly when and how to engage each funder.

**User Stories:**
- ARB-01: As a user, the system monitors all my funders for signal events automatically
- ARB-02: As a user, I receive specific engagement recommendations with timing rationale
- ARB-03: As a user, the system remembers every interaction with every funder
- ARB-04: As a user, I can log calls and meetings that become part of relationship memory
- ARB-05: As a user, I see a relationship health score for every funder in my portfolio

### PILLAR 5: Grant Probability Engine
Every opportunity is scored before it appears anywhere. No alphabetical lists. Everything ranked by likelihood of success.

**User Stories:**
- GPE-01: As a user, every opportunity shows a probability score badge (0-100)
- GPE-02: As a user, opportunities default to sort by probability descending
- GPE-03: As a user, I can filter opportunities by minimum probability threshold
- GPE-04: As a user, I can see the full factor breakdown explaining any probability score
- GPE-05: As a user, I see specific improvement suggestions to increase my probability score
- GPE-06: As a user, each opportunity shows estimated ROI and time-to-complete
- GPE-07: As a user, the system recommends apply/consider/skip on every opportunity

### PILLAR 6: Organizational Digital Twin
A structured AI model of my organization that learns and grows. The AI knows us before writing anything.

**User Stories:**
- ODT-01: As a user, the system builds my Digital Twin from my Knowledge Base and 990 filings automatically
- ODT-02: As a user, I can view and edit my Digital Twin profile at any time
- ODT-03: As a user, grant drafts are automatically personalized using my Twin data — no re-entering org info
- ODT-04: As a user, my Twin includes proven narrative patterns from my successful grants
- ODT-05: As a user, my Twin includes board member profiles, program descriptions, and impact metrics
- ODT-06: As a user, the Twin completeness score tells me what's missing and why it matters

### PILLAR 7: Autonomous Proposal Factory (expands existing Draft Generator)
Not just AI writing — full proposal production including budgets, logic models, attachments, and AutoApply submission.

**User Stories:**
- APF-01: As a user, I can generate a complete proposal package (narrative + budget + logic model + timeline) in one click
- APF-02: As a user, generated budgets use my actual financial data from the Digital Twin
- APF-03: As a user, generated logic models follow the W.K. Kellogg Foundation format
- APF-04: As a user, letters of support are drafted using contact data from my CRM
- APF-05: As a user, compliance checklists are auto-generated per funder requirements
- APF-06: As a user, completed proposals route to AutoApply for submission

### PILLAR 8: Corporate Outreach Factory
One click generates a full personalized outreach sequence for any corporate prospect.

**User Stories:**
- COF-01: As a user, I can select any corporate prospect and generate a full outreach sequence
- COF-02: As a user, every email is individualized using the prospect's enrichment data — no templates
- COF-03: As a user, sequences include: initial outreach, follow-up, thank you, stewardship report
- COF-04: As a user, I can review and edit any generated email before sending
- COF-05: As a user, sent emails are tracked and responses trigger follow-up recommendations
- COF-06: As a user, meeting requests include a personalized agenda based on the prospect's giving DNA

### PILLAR 9: Donation Recommendation Marketplace
Amazon-style marketplace where companies list available donations and nonprofits receive AI-matched recommendations.

**User Stories:**
- DRM-01: As a corporate donor, I can list available goods/services/people with category, quantity, and geographic radius
- DRM-02: As a nonprofit, I receive automatic AI-matched donation recommendations weekly
- DRM-03: As a nonprofit, I can one-click request any listed donation
- DRM-04: As a corporate donor, I can approve/decline requests with one click
- DRM-05: As a nonprofit, I can search the marketplace by category and location
- DRM-06: As a user, the system generates an IRS-compliant donation receipt upon completion

### PILLAR 10: National Disaster Response Engine
When FEMA declares a disaster, Benavora automatically deploys a coordinated response within hours.

**User Stories:**
- DRE-01: As a user, I receive instant alerts when FEMA declares disasters in or near my service area
- DRE-02: As a user, relevant emergency funding opportunities are automatically surfaced within 1 hour of a declaration
- DRE-03: As a user, a pre-populated emergency grant application is generated for applicable programs
- DRE-04: As a user, corporate donors with disaster response capability near the affected area are identified automatically
- DRE-05: As a user, a coordinated outreach campaign to corporate disaster responders is launched with one click
- DRE-06: As a user, I see a real-time disaster response dashboard showing all active declarations

### PILLAR 11: Predictive Funding Forecast
Forward-looking funding intelligence. Forecast the future, not just report the past.

**User Stories:**
- PFF-01: As a user, I see a 90-day projected funding range for my pipeline
- PFF-02: As a user, I receive market trend alerts for my primary funding categories
- PFF-03: As a user, I see risk flags when my portfolio has concentration risk or expiring relationships
- PFF-04: As a user, I can generate a 12-month funding forecast for board presentations
- PFF-05: As a user, I see national funding trend data by category (housing, health, education, etc.)

### PILLAR 12: AI Board Advisor
Every board member gets a personal AI assistant for board responsibilities.

**User Stories:**
- ABA-01: As a board member, I receive an auto-generated meeting packet 48 hours before every board meeting
- ABA-02: As a board member, I see financial summaries in plain language — no jargon
- ABA-03: As a board member, I receive voting recommendations with rationale for agenda items
- ABA-04: As a board member, I receive compliance alerts specific to my fiduciary role
- ABA-05: As a board chair, I can see which board members have viewed the meeting packet
- ABA-06: As an ED, I can configure what each board member sees based on their committee role

### PILLAR 13: Community Impact Simulator
What-if modeling for strategic decisions before they're made.

**User Stories:**
- CIS-01: As a user, I can run any what-if scenario and see projected financial, capacity, and impact outcomes
- CIS-02: As a user, scenarios include: receiving/losing grants, opening locations, hiring staff, serving more beneficiaries
- CIS-03: As a user, simulation results include a risk assessment and recommended prerequisites
- CIS-04: As a user, I can save and compare multiple scenarios side-by-side
- CIS-05: As a user, I can share simulation results as a PDF for board or grant narrative use

### PILLAR 14: Funding Gap Analyzer (expands existing eligibility scoring)
AI identifies weaknesses in the org's funding position and recommends fixes.

**User Stories:**
- FGA-01: As a user, I see a funding gap report identifying my weakest narrative areas
- FGA-02: As a user, I see geographic gaps in my funder portfolio
- FGA-03: As a user, I see compliance issues that may be reducing my eligibility scores
- FGA-04: As a user, I receive specific recommendations to close each identified gap
- FGA-05: As a user, gap analysis runs automatically monthly and alerts me to new gaps

### PILLAR 15: Reputation Intelligence
Continuous monitoring of every funder and donor. Warn nonprofits before pursuing problematic relationships.

**User Stories:**
- RI-01: As a user, I am alerted when any funder in my CRM has negative news coverage
- RI-02: As a user, I am alerted when any funder faces regulatory or legal action
- RI-03: As a user, I am alerted when leadership changes at key funders
- RI-04: As a user, I can set monitoring on any funder or corporate prospect
- RI-05: As a user, reputation alerts are color-coded by severity (red/orange/yellow/blue/green)
- RI-06: As a user, I can dismiss alerts with a reason that improves future filtering

### PILLAR 16: Executive Command Center
Palantir-style large-format dashboard for the ED/CEO/Development Director.

**User Stories:**
- ECC-01: As an ED, I can see my entire funding operation on one screen in real time
- ECC-02: As an ED, I can switch to full-screen TV mode for board meetings
- ECC-03: As an ED, I can configure which panels appear and in what layout
- ECC-04: As an ED, I see live AI recommendations for my top 5 priority actions today
- ECC-05: As an ED, I see a donor heat map showing geographic concentration of my funding
- ECC-06: As an ED, panels update in real time via WebSocket — no page refresh needed

### PILLAR 17: Agent Marketplace
Configurable roster of specialized AI agents. Organizations enable only what they need.

**User Stories:**
- AM-01: As a user, I can browse all available agents with descriptions and plan requirements
- AM-02: As a user, I can enable/disable any agent I have access to on my plan
- AM-03: As a user, I can see the last run time, run count, and output summary for each enabled agent
- AM-04: As a user, I can view the full log for any agent run
- AM-05: As a user, I can configure parameters for agents that have configurable settings
- AM-06: As an owner, I can see aggregate agent usage across my organization

### PILLAR 18: Funding Knowledge Engine
The defining competitive advantage. AI trained on millions of historical funding relationships.

**User Stories:**
- FKE-01: As a user, I receive funder-specific intelligence about what gets funded and why
- FKE-02: As a user, I receive narrative pattern recommendations based on successful proposals
- FKE-03: As a user, I receive timing intelligence about when to submit for maximum success
- FKE-04: As a user, I receive competitive intelligence about who else competes for my target grants
- FKE-05: As a user, the knowledge engine improves automatically as more data is ingested
- FKE-06: As a user, I can query the knowledge engine directly: "What narrative elements most often win HRSA grants?"

---

## Post-Launch Platform Evolution — Phases 2 through 5

The 18 pillars above define the launch product (Phase 1 — see `AUTONOMOUS_PLATFORM_VISION.md`). The capabilities below are the approved post-launch roadmap: they extend Phase 1 infrastructure that must already be running unattended for real subscriber orgs (the discovery → probability → draft chain, `organizational_digital_twins`, `agent_registry`/`agent_configurations`, the nightly Railway scheduler) rather than standing up anything parallel. No later phase should enter a FORGE queue until Phase 1's core loop has real win/loss outcome history to build on. Every schema, agent, and route referenced below is scoped exactly as specified in `AUTONOMOUS_PLATFORM_VISION.md`; do not invent alternate table names or agent IDs when building against this section.

### PHASE 2 — Intelligence Amplification (Months 7–18)

#### 1. Fundability Intelligence Score

**Executive Summary:** Extends the Grant Probability Engine (Pillar 5) from a bare 0–100 score into a diagnostic tool. For every opportunity below the "apply" threshold, the score decomposes into the specific deficiency — weak mission-fit language, incomplete budget history, missing logic model, Digital Twin gaps — and, where the deficiency is a KB/Twin completeness gap rather than a structural mismatch, offers a one-click auto-fix that queues a targeted KB entry for human approval. This matters because a bare score tells a user *that* they're unlikely to win, not *why* or *what to do about it* — turning the probability engine from a filter into a coaching tool.

**User Stories:**
- FIS-01: As a user, I see a specific deficiency breakdown for any opportunity scoring below the apply threshold, not just a number
- FIS-02: As a user, I can distinguish a fixable gap (missing KB content) from a structural mismatch (wrong geography, wrong funder priorities) at a glance
- FIS-03: As a user, I can click "Auto-Fix" on a KB-gap deficiency and have a draft KB entry generated for my review
- FIS-04: As a user, I never have an auto-fix silently published to my Knowledge Base without my approval
- FIS-05: As an owner, I can see which deficiency types recur most often across my pipeline to prioritize KB investment

**Acceptance Criteria:**
1. Every `opportunity_probability_scores` row includes a non-empty `deficiencies` array whenever `overall_score` is below the org's apply threshold
2. Each deficiency entry specifies `factor_name`, `current_value`, `target_value`, `fix_type` (`kb_gap`/`twin_gap`/`structural`), and `auto_fixable`
3. The opportunity detail page's factor breakdown UI (Feature #106) renders an "Auto-Fix Available" badge only on `auto_fixable = true` deficiencies
4. `POST /api/intelligence/grant-probability/auto-fix` invokes AG-06 in narrow mode and writes to `fundability_autofix_runs` with `status = 'pending'`
5. No `fundability_autofix_runs` row is ever auto-promoted to `knowledge_base_entries` without an explicit human approval action
6. `structural` deficiencies never show an Auto-Fix badge — the UI must distinguish fixable from unfixable at render time, not just at data time
7. Deficiency computation adds no more than 20% to the existing probability-scoring route's response time
8. A deficiency's `target_value` is always populated with a concrete, actionable value (e.g. "3+ documented outcomes"), never a vague label

**Data Requirements:**
- Alter `opportunity_probability_scores`: add `deficiencies jsonb DEFAULT '[]'`
- New table `fundability_autofix_runs` (`id`, `org_id`, `opportunity_id`, `deficiency_key`, `generated_content`, `status`, `created_at`)
- Reads from `organizational_digital_twins.twin_completeness_score` and `knowledge_base_entries` to detect KB-gap vs. Twin-gap deficiencies

**Agent Dependencies:**
- AG-15 (Grant Probability Agent) must be live and computing `overall_score`/`factors` before deficiency decomposition can be added
- AG-06 (Proposal/Draft Generator Agent) must support a narrow-mode invocation limited to a single KB entry
- AG-16 (Digital Twin Builder) must be populating `twin_completeness_score` for Twin-gap detection

**Success Metrics:**
- % of sub-threshold opportunities with at least one `auto_fixable` deficiency that convert to apply-eligible within 30 days of the KB fix being approved
- Auto-fix approval rate (approved / (approved + rejected) on `fundability_autofix_runs`)
- Reduction in average days-to-KB-completeness for orgs using Auto-Fix vs. orgs that are not

---

#### 2. AI Donor Intent Engine

**Executive Summary:** Moves reputation/relationship monitoring (Pillars 4 and 15) from reactive ("this funder had a scandal") to predictive. Continuously monitors press releases, CSR reports, ESG disclosures, SEC filings, hiring trends, facility expansions, and disaster declarations for corporate prospects and foundations, and scores the probability that each entity will announce a giving initiative in the next 30–90 days — before it's public. This matters because the nonprofit that reaches out first, before a giving program is publicly announced and flooded with applicants, has a structural advantage no amount of proposal quality can replicate later.

**User Stories:**
- ADI-01: As a user, I see a predicted-intent score (0–100) and predicted window (30/60/90-day) for corporate prospects and foundations in my CRM
- ADI-02: As a user, I can see the specific signals behind any intent score (hiring trend, facility expansion, SEC filing, prior giving-cycle timing)
- ADI-03: As a user, high-intent entities are surfaced on the Corporate Intelligence monitoring feed with a "Predicted Intent" badge distinct from reactive change-detection events
- ADI-04: As a user, I am not alerted on every entity — only those crossing a confidence threshold, to avoid alert fatigue
- ADI-05: As an owner, I can see the historical accuracy of past predictions (predicted vs. actually announced) to calibrate my trust in the score

**Acceptance Criteria:**
1. `donor_intent_scores.intent_score` is computed for every actively monitored `corporate_prospects` record on a nightly cycle
2. `signal_basis` is a non-empty jsonb array citing `signal_type`, `weight`, `evidence`, and `source_url` for every non-zero score
3. `predicted_window` is one of `30_day`/`60_day`/`90_day` and `confidence` is one of `low`/`medium`/`high`
4. The monitoring feed UI renders a "Predicted Intent" badge only for scores above the org-configurable alert threshold
5. Intent scoring runs as part of the existing nightly `runCorporateEnrichmentBatch()` step — no new standalone cron job
6. A calibration report (predicted-intent-then-announced vs. predicted-then-not-announced) is queryable for any 90-day trailing window
7. No signal source contacts the monitored entity directly — this is read-only public-signal monitoring, never outreach
8. Scoring never fabricates a signal source URL — every `evidence` entry traces to a real, fetched source

**Data Requirements:**
- New table `donor_intent_scores` (`id`, `prospect_id` FK → `corporate_prospects`, `intent_score`, `predicted_window`, `signal_basis jsonb`, `confidence`, `computed_at`)
- Index `idx_donor_intent_prospect` on `prospect_id`
- Reads from `corporate_prospects.enrichment`, `reputation_signals`, `corporate_monitoring_events`
- New enrichment sub-agent feeds required: hiring-trend feed, SEC EDGAR full-text search, facility-permit monitoring (none of these exist yet — must be built as new EA-series agents, not assumed present)

**Agent Dependencies:**
- New AG-31 (Donor Intent Agent)
- Extends AG-18 (Reputation Intelligence Agent) for signal ingestion patterns
- Extends AG-20/AG-21 (EA-01/EA-08 enrichment agents) — currently PLANNED with no code (Section 4 of `AGENTS_v2.md`), must be built before this feature, not assumed to exist
- Extends AG-30 (Change Monitor Agent) — also currently PLANNED with no code

**Success Metrics:**
- Prediction calibration accuracy (% of high-confidence predictions that result in an actual giving announcement within the predicted window)
- Time-to-first-outreach delta between Benavora orgs acting on a predicted-intent alert vs. reactive discovery of the same opportunity
- False-positive rate (alerts fired with no announcement in window) held below a defined ceiling

---

#### 3. Twin-Powered Draft Generation

**Executive Summary:** Closes the loop Pillar 6 already specifies but Feature #110 has not yet wired: every draft generation reads `organizational_digital_twins` first, fills any gap from `knowledge_base_entries`, and only then generates — never generic filler. Includes a pre-generation completeness gate that blocks generation below a configurable Twin completeness threshold and instead routes the user to a targeted KB prompt. This matters because the current live draft path (`generateDraft()`) can silently generate against an incomplete or empty Twin today, producing generic narrative that undersells the org — this feature makes that failure mode structurally impossible rather than relying on the user noticing.

**User Stories:**
- TPD-01: As a user, every draft I generate is demonstrably built from my organization's actual Digital Twin data, not generic template filler
- TPD-02: As a user, if my Twin is too incomplete to generate a strong draft, I am blocked and shown exactly which fields to fill in first
- TPD-03: As a user, each missing field on the completeness gate links directly to the KB entry editor for that field
- TPD-04: As an owner, I can configure the minimum Twin completeness threshold required before generation is allowed
- TPD-05: As a user, I can see whether a previously generated draft's award outcome correlates with the Twin completeness score at the time it was generated

**Acceptance Criteria:**
1. The draft generation path fetches `organizational_digital_twins` by `org_id` before constructing any Claude prompt
2. Generation is blocked (not merely warned) when `twin_completeness_score` is below the configured threshold
3. The block state surfaces the specific missing Twin fields, not a generic "incomplete" message
4. Each missing field links directly to the corresponding KB entry editor route
5. No new tables are required for the core wiring — this is a modification of the existing draft generation route, not a parallel system
6. `applications.twin_completeness_at_generation` (optional) is populated at generation time when present, to support later outcome correlation
7. The completeness gate applies identically whether generation is manual or autonomous (AG-06 nightly path)
8. Existing drafts generated before this feature ships are not retroactively invalidated or blocked from being viewed

**Data Requirements:**
- No new tables required
- Optional: `ALTER TABLE applications ADD COLUMN IF NOT EXISTS twin_completeness_at_generation integer`
- Reads `organizational_digital_twins` (all columns) and `knowledge_base_entries` (for gap-fill)

**Agent Dependencies:**
- AG-06 (Proposal/Draft Generator Agent) — the live `generateDraft()` path must be modified directly
- AG-16 (Digital Twin Builder Agent) must already be producing a populated `twin_completeness_score`; currently PLANNED with no worker wiring (Section 5, `AGENTS_v2.md`) — must be operational before this feature can gate on it

**Success Metrics:**
- % of autonomous drafts blocked by the completeness gate vs. generated (should trend down over time as orgs complete their Twins)
- Correlation coefficient between `twin_completeness_at_generation` and award rate
- Reduction in "generic-sounding draft" user-reported feedback after rollout

---

#### 4. AutoApply Full Autonomous Mode

**Executive Summary:** Extends the existing semi/autonomous AutoApply modes (Feature #62, BUILT) to a true overnight queue capable of 400+ corporate portal submissions with zero human touch for standard forms — reserving the human approval checkpoint (Feature #43) only for non-standard forms, high-dollar requests above a configurable threshold, or portals AG-12 has not previously submitted to successfully. This matters because the current mandatory-review-on-every-submission model doesn't scale past a handful of nightly submissions per org — full autonomy on proven, low-risk portal templates is what makes "400+ overnight submissions" operationally possible without a human reviewing each one.

**User Stories:**
- AFA-01: As a user, standard-form submissions to portals AG-12 has succeeded on before complete overnight with no review required
- AFA-02: As a user, any submission above my configured dollar threshold always stops at human review regardless of portal trust history
- AFA-03: As a user, any submission to a portal AG-12 hasn't previously succeeded on stops at human review
- AFA-04: As a user, I receive one nightly summary notification ("412 completed autonomously, 8 held for review") instead of a per-submission alert
- AFA-05: As an Enterprise/Consultant-tier user, my concurrent-processing cap scales with my org's accumulated `portal_trust_score` volume rather than a fixed cap of 3

**Acceptance Criteria:**
1. `submission_queue` items are classified as `standard_form` or `requires_review` before processing begins
2. Classification requires both: prior successful submission on this exact portal template, and requested amount below the configured threshold
3. `form_analyses.portal_trust_score` and `successful_submissions` increment only after a confirmed successful submission, never on a queued/pending attempt
4. `AUTONOMOUS_HARD_LIMITS.NEVER_SUBMIT_EXTERNALLY` is never violated — even `standard_form` items still stop at the existing final-submit human approval gate per the hard limit; "full autonomous mode" governs form-filling and queuing depth, not the submit click itself, unless a future governance change explicitly revises this hard limit
5. The nightly digest is a single aggregated notification, not one per submission, respecting Behavioral Contract §32's digest option
6. Concurrent-processing cap increase applies only to Enterprise/Consultant tiers, gated by plan
7. `autonomy_classification` is recorded on every `submission_queue` row for audit purposes
8. A portal newly attempted for the first time is never classified `standard_form` on its first pass, regardless of amount

**Data Requirements:**
- Alter `form_analyses`: add `portal_trust_score integer DEFAULT 0`, `successful_submissions integer DEFAULT 0`
- Alter `submission_queue`: add `autonomy_classification text DEFAULT 'requires_review'`

**Agent Dependencies:**
- AG-12 (AutoApply Agent) must already be ENABLED and logging submission outcomes reliably before trust scoring has any signal to compute from
- Deterministic classifier logic in `worker/queue-processor.ts` — not a new Claude-calling agent, an extension of existing worker code

**Success Metrics:**
- Ratio of `standard_form`-classified submissions to `requires_review` over time (should rise as portal trust accumulates)
- Zero incidents of `NEVER_SUBMIT_EXTERNALLY` being violated (hard gate — any incident is a Sev1)
- Average nightly submission volume per Enterprise org before vs. after rollout

---

#### 5. Predictive National Opportunity Forecasting

**Executive Summary:** Extends Pillar 11's Market Forecast model beyond org-level pipeline projection into macro-level prediction: congressional appropriations bills, FEMA spending patterns, HUD/USDA/state budget cycles, corporate profit trends, and industry giving cycles, surfaced as a leading indicator ("Texas housing grants projected to increase 18% next year") before individual opportunities post. This matters because org-level forecasting (Pillar 11) only ever projects from an org's existing pipeline — it cannot tell a user that an entire funding category is about to expand or contract before any specific opportunity exists to score.

**User Stories:**
- PNF-01: As a user, I see category-level 12-month trend direction and magnitude for the funding categories relevant to my mission
- PNF-02: As a user, I can distinguish this macro trend panel from my own org-specific 90-day/12-month pipeline forecast (Pillar 11)
- PNF-03: As a user, trend projections cite the underlying evidence (bill tracking, appropriations history, budget cycle data)
- PNF-04: As a board member, I can include a national trend arrow in a board presentation to contextualize my org's pipeline forecast
- PNF-05: As an owner, I am alerted when a category I'm active in is projected to decline significantly, so I can diversify proactively

**Acceptance Criteria:**
1. `market_forecasts` rows exist per `category`/`geography`/`forecast_period` combination relevant to active org categories
2. `trend_direction` is one of `rising`/`stable`/`declining` and `trend_magnitude` is a signed numeric value
3. `evidence` is a non-empty text array citing specific bill numbers, budget documents, or historical appropriations data — never an unsupported claim
4. The `/reports/forecast` market-trend panel is visually and functionally distinct from the existing org-specific `funding_forecasts` panel
5. Forecast computation runs monthly, scheduled alongside the existing `runFundingForecast()` slot — no ad hoc scheduling
6. A migration reconciles this table against any pre-existing `market_forecasts` definition in `PLATFORM_VISION_ARCHITECTURE.md` Pillar 11 before this feature ships, per the known naming-collision flagged in `AUTONOMOUS_PLATFORM_VISION.md`
7. Declining-trend alerts for a category the org is actively pursuing are surfaced as a distinct alert type, not buried in the general digest
8. No forecast is presented without a `confidence`/evidentiary basis — this is a leading indicator, not a guarantee, and the UI must not imply certainty

**Data Requirements:**
- New table `market_forecasts` (`id`, `category`, `geography`, `forecast_period`, `trend_direction`, `trend_magnitude`, `evidence text[]`, `created_at`)
- Index `idx_market_forecasts_category` on `(category, geography)`
- Ingests Congress.gov bill-tracking data and historical appropriations patterns per category

**Agent Dependencies:**
- New AG-32 (National Forecast Agent)
- Extends AG-26 (Funding Forecast Agent) — currently PLANNED with no code (Section 5, `AGENTS_v2.md`); AG-26 must exist and be operational at the org level before extending it to macro scope makes sense

**Success Metrics:**
- Directional accuracy of category trend predictions measured against realized appropriations/funding outcomes 12 months later
- User engagement with the `/reports/forecast` macro panel (views, board-report inclusions)
- Number of orgs who diversify into a rising category within 90 days of a trend alert

---

### PHASE 3 — Relationship Intelligence (Months 19–30)

#### 6. Corporate Relationship Graph

**Executive Summary:** Surfaces warm introduction pathways — board overlaps, alumni networks, shared executives, family foundation ties — between a nonprofit and its target corporate prospects, instead of defaulting every corporate outreach to cold contact. This matters because a warm introduction through a known board connection converts at meaningfully higher rates than cold outreach, and today's system has no way to surface that a connection even exists.

**User Stories:**
- CRG-01: As a user, I can see any known relationship path (board overlap, shared executive, prior grant history) between my org and a target corporate prospect
- CRG-02: As a user, discovered relationship paths are ranked by strength/confidence, not just listed
- CRG-03: As a user, I am notified when a new relationship path opens up (e.g. a board member joins a company I'm targeting)
- CRG-04: As a user, I can request a warm introduction workflow when a path exists, rather than defaulting to cold outreach
- CRG-05: As an admin, relationship discovery for corporate entities runs automatically without my manual research

**Acceptance Criteria:**
1. New `relationship_type` values specific to corporate connections are added to `pig_edges` without breaking existing edge types
2. Every discovered corporate relationship edge cites `evidence` and a `confidence` weight, never an unverified assertion
3. `/api/intelligence/relationship-paths` returns the shortest verified path between an org's PIG node and a target corporate prospect's PIG node
4. The `/research/graph` node-expansion panel visually distinguishes corporate relationship edges from other PIG edge types
5. New relationship discoveries involving a user's watched entities generate an alert (extends PIG-03)
6. No relationship is encoded outside `pig_edges` — per Data Architecture Principle #4, never as a new foreign key
7. Relationship confidence scores update (not just append) when new corroborating or contradicting evidence is found for an existing edge
8. Duplicate edges for the same source/target/relationship_type triple are prevented at the database level

**Data Requirements:**
- Extends `pig_edges` with new `relationship_type` values (e.g. `board_overlap`, `shared_executive`, `alumni_network`, `family_foundation_tie`)
- Reads `corporate_relationship_people`, `corporate_relationships` (existing Corporate Intelligence Engine tables)
- Requires `pig_nodes`/`pig_edges` (migration 094) to be live in production — flagged in project memory as designed but not yet confirmed applied

**Agent Dependencies:**
- Extends AG-23 (Relationship Mapper Agent, RA-01) — currently PLANNED with no code (Section 4, `AGENTS_v2.md`); must be built before this feature, not assumed to exist
- Depends on Corporate Intelligence Engine (Pillar 3) enrichment agents for source data

**Success Metrics:**
- Number of verified warm-introduction paths surfaced per org per month
- Conversion rate of warm-path outreach vs. cold corporate outreach (COF pillar) for otherwise comparable prospects
- Alert-to-action rate when a new relationship path opens

---

#### 7. Philanthropic Intelligence Graph (Full Build)

**Executive Summary:** Completes Pillar 1's full vision beyond the graph schema alone: cross-org funder behavior patterns, giving-cycle intelligence, the force-directed `/research/graph` explorer, and the shortest-path finder between any two entities. This matters because `pig_nodes`/`pig_edges` (migration 094) is architected but, per Section 4 of `AUTONOMOUS_PLATFORM_VISION.md`, not yet data-dense — this phase is what turns the schema into an actually useful relationship-discovery product rather than an empty graph.

**User Stories:**
- PIGF-01: As a user, I can visually explore the full relationship graph via a force-directed UI, not just query it via API
- PIGF-02: As a user, I can find the shortest verified path between my org and any funder, foundation, or corporate entity in the graph
- PIGF-03: As a user, I can export any relationship map view as a PDF for board presentations (fulfills PIG-04)
- PIGF-04: As an admin, the graph continuously discovers new edges on a weekly full-rebuild cadence without my involvement (fulfills PIG-05)
- PIGF-05: As a user, I can filter the graph explorer by entity type (business/foundation/government/person/nonprofit) to reduce visual noise

**Acceptance Criteria:**
1. `/research/graph` renders a force-directed visualization sourced live from `pig_nodes`/`pig_edges`, not a static mock
2. `/api/intelligence/graph/shortest-path` returns a real computed path (not a placeholder) between any two valid `pig_nodes` entity IDs, weighted by edge `weight`/confidence
3. Graph-query performance meets the PRD's stated technical requirement of under 5 seconds for 3-hop traversals at production data density
4. PDF export preserves the visual layout and node/edge labels shown on screen at export time
5. AG-23's weekly full-rebuild adds new edges without duplicating or orphaning existing verified edges
6. Entity-type filtering in the UI correctly hides/shows nodes without breaking path-finding across filtered-out intermediate nodes (path-finding operates on the full graph regardless of display filter)
7. No cross-org data leakage occurs through the graph — an org can see relationship paths involving shared entities (foundations, corporations) but never another org's private CRM data
8. Query-index performance is validated against the target scale of 10M+ nodes / 50M+ edges (Section 4.4/`SCHEMA_REGISTRY_v2.md` data volume estimates), not just current sparse data

**Data Requirements:**
- `pig_nodes`/`pig_edges` (migration 094) — add graph-query-specific indexes beyond the existing uniqueness constraints
- No new core tables; this phase is UI + query-layer + weekly-rebuild-agent completion of existing schema

**Agent Dependencies:**
- AG-23 (Relationship Mapper Agent) performing full weekly rebuilds, not just incremental corporate-relationship additions (see Feature 6 above)
- Depends on Feature 6 (Corporate Relationship Graph) and the underlying discovery agents across Pillars 1/3/4 having already been populating `pig_edges` for meaningful graph density to exist

**Success Metrics:**
- Graph density growth rate (edges per node) month over month
- Shortest-path query p95 latency at production scale
- Number of PDF relationship-map exports generated for board use

---

#### 8. Autonomous Partnership Discovery

**Executive Summary:** Identifies coalition grant opportunities, complementary missions, and shared application potential between two or more Benavora subscriber orgs, or between a subscriber and a known nonprofit in the `foundation_directory`/BMF data. This matters because many large grants explicitly favor or require multi-org coalition applications, and no org currently has visibility into which other nonprofits in its space would make a strong coalition partner.

**User Stories:**
- APD-01: As a user, I am shown potential coalition partners whose mission and service area complement mine for opportunities that favor joint applications
- APD-02: As a user, I can see the specific basis for a suggested partnership match (shared geography, complementary programs, prior joint-funding history)
- APD-03: As a user, I can initiate contact with a suggested partner org directly from the match suggestion
- APD-04: As an owner, partnership suggestions never expose another org's private CRM, financial, or pipeline data — only what that org has made discoverable
- APD-05: As a user, I can dismiss a partnership suggestion with a reason that improves future matching

**Acceptance Criteria:**
1. `partnership_matches` rows include a `match_basis` explaining the specific complementary factors, not just a bare score
2. Matching considers both Benavora subscriber orgs and `foundation_directory`/BMF-sourced external nonprofits as candidate partners
3. No match suggestion ever surfaces another subscriber org's private data (financials, pipeline, applications) — only fields that org has explicitly made shareable
4. The partnership suggestions panel on `/intelligence/twin` shows match basis, confidence, and a direct contact-initiation action
5. Dismissal with a reason is logged and demonstrably reduces similar future suggestions for that org
6. Matching only fires for opportunities/categories that explicitly favor or require coalition applications, not indiscriminately for every opportunity
7. A suggested partnership never auto-initiates contact on the org's behalf — contact initiation is always an explicit user action
8. Matches are recomputed on a defined cadence (not one-time) as new orgs and opportunities enter the system

**Data Requirements:**
- New table `partnership_matches` (fields per the FORGE blueprint: match participants, `match_basis`, confidence, status)
- Reads `organizational_digital_twins`, `foundation_directory`, and opportunity records with coalition-favoring eligibility language

**Agent Dependencies:**
- New AG-33
- Depends on Digital Twin (AG-16) completeness across candidate orgs to compute meaningful complementary-mission matches
- Depends on Feature 7 (full Philanthropic Intelligence Graph) for cross-org relationship context where available

**Success Metrics:**
- Number of partnership matches that result in an actual joint application submission
- User-reported relevance rate of suggested matches (dismissed-with-reason vs. acted-on)
- Award rate of coalition applications formed through this feature vs. solo applications in the same category

---

#### 9. Donor Personalization Engine

**Executive Summary:** Adapts the public marketing site and donor-facing communications automatically by visitor type — corporate exec vs. church donor vs. family foundation vs. government reviewer — driven by the same Digital Twin and Giving DNA data already computed for corporate prospects. This matters because a single generic marketing message underperforms against an audience as varied as Benavora's own target market spans, and the data needed to personalize already exists elsewhere in the platform.

**User Stories:**
- DPE-01: As a visitor to the public marketing site, I see messaging and case studies relevant to my apparent visitor type
- DPE-02: As a marketing admin, I can see which visitor personas are detected and how site content varies per persona
- DPE-03: As a marketing admin, persona detection never requires the visitor to log in or self-identify explicitly — it infers from available signals
- DPE-04: As a marketing admin, I can override or disable persona-based variation for specific pages
- DPE-05: As a compliance-minded admin, I can confirm persona detection does not collect or store personally identifiable visitor data beyond what's needed for the session

**Acceptance Criteria:**
1. `visitor_personas` records are scoped to the public marketing site only — this table is explicitly not org-scoped per its own schema note
2. Persona detection produces one of a defined, finite set of persona types, never an open-ended free-text classification
3. `/api/marketing/personalize` returns content variant selections within acceptable page-load latency (Technical Requirements: under 2 seconds)
4. Public site components render distinct variants per detected persona without duplicating the underlying page route
5. No persistent PII is stored on `visitor_personas` beyond what's necessary for in-session personalization
6. Marketing admins can view a dashboard of persona distribution across site traffic
7. A page-level override/disable flag is respected and takes precedence over persona-based variation
8. Personalization degrades gracefully to a sensible default when no persona signal is confidently detected

**Data Requirements:**
- New table `visitor_personas` (public marketing site, explicitly not org-scoped per the FORGE blueprint)
- No RLS org-isolation policy applies to this table since it is not tenant data

**Agent Dependencies:**
- New AG-34
- Draws on Corporate Giving DNA profiles (Pillar 3) and Digital Twin patterns (Pillar 6) as reference data for what distinguishes each persona's messaging, even though this feature itself is public-site-facing rather than org-scoped

**Success Metrics:**
- Conversion rate lift (visitor → signup) for personalized variants vs. control/generic page
- Persona detection confidence distribution (% of traffic confidently classified vs. defaulted)
- Marketing admin adoption of persona-specific content authoring

---

#### 10. Community Need Prediction

**Executive Summary:** Feeds census data, housing prices, employment trends, eviction filings, weather patterns, school enrollment, and migration data into a needs-forecasting layer that anticipates service demand before it materializes — directly extending the Faith Foundation use case of rural Texas emergency/transitional housing. This matters because a nonprofit that can show a funder "we anticipate a 20% increase in need in our service area based on X, Y, Z leading indicators" makes a fundamentally stronger case than one relying only on past-year statistics.

**User Stories:**
- CNP-01: As a user, I see a needs forecast for my service area based on leading community indicators, not just historical caseload data
- CNP-02: As a user, I can see which specific indicators (eviction filings, employment trends, weather patterns) are driving a forecast
- CNP-03: As a user, I can include a needs forecast card directly in a grant narrative or board report
- CNP-04: As a user, I am alerted when a significant leading indicator shift is detected in my specific service area
- CNP-05: As an ED, I can compare my org's anticipated capacity against the forecasted need to identify a gap early

**Acceptance Criteria:**
1. `community_need_signals` records cite specific public data sources (census, HUD, BLS, NWS, school district enrollment, eviction court records) per signal
2. Forecasts are scoped to the org's actual `service_area`/`service_areas`, not a generic national or state-level figure
3. The needs forecast card on `/intelligence` hub surfaces the top contributing indicators alongside the headline projection
4. A significant shift in a leading indicator for the org's service area generates an alert distinct from the routine forecast refresh
5. Forecast data is presented as a projection with a stated confidence level, never as a certainty
6. No signal source requires paid/proprietary data the platform hasn't licensed — sources must be public APIs already scoped in Integration Requirements or clearly newly justified
7. Forecast recomputation runs on a defined schedule (not one-time) as new public data becomes available
8. Capacity-vs-need gap comparison correctly reads the org's own capacity data (staff, budget, program capacity) from `organizations`/`organizational_digital_twins`

**Data Requirements:**
- New table `community_need_signals`
- External sources: Census data, housing price indices, employment trend data (BLS), eviction filing records, NWS weather pattern data, school enrollment data, migration data — several of these are not in the current Integration Requirements list and must be explicitly scoped/licensed before this feature can ship
- Reads `organizations.service_area`/`service_areas` for geographic scoping

**Agent Dependencies:**
- New AG-35
- No dependency on other post-launch agents, but benefits from Digital Twin (AG-16) for capacity-vs-need comparison context

**Success Metrics:**
- Forecast accuracy validated against realized service-demand changes in subsequent periods
- Number of grant narratives/board reports that include a needs forecast card
- Lead time between an indicator-shift alert and the org taking a documented capacity-adjustment action

---

### PHASE 4 — Autonomous Operations (Months 31–48)

#### 11. Global Learning Network

**Executive Summary:** Every successful grant (anonymized) teaches the platform language, budget structure, narrative patterns, and winning keywords across the entire subscriber base. This matters because it is explicitly the proprietary moat competitors cannot replicate without an equivalent multi-year data history (Moat 1 in the Competitive Moat Analysis) — the gap widens with every additional org, application, and outcome recorded, compounding rather than merely persisting.

**User Stories:**
- GLN-01: As a user, my Knowledge Engine query results improve automatically as more orgs across the platform record outcomes, even if I've never applied to that funder myself
- GLN-02: As a user, I never see another org's identifiable data surfaced through cross-org learning — only anonymized aggregate patterns
- GLN-03: As a platform owner, I can see `knowledge_patterns.confidence` improve from low to medium to high as sample count grows across the subscriber base
- GLN-04: As a user, narrative pattern recommendations cite the aggregate pattern basis, not a specific identifiable proposal from another org
- GLN-05: As a compliance-minded owner, I can confirm the anonymization approach meets the platform's stated no-cross-org-leakage security requirement

**Acceptance Criteria:**
1. `knowledge_patterns` gains a cross-org aggregation flag distinguishing platform-wide patterns from single-org-derived patterns
2. `confidence` on any cross-org-aggregated pattern only increases with `sample_count`, per the existing low/medium/high confidence model
3. No cross-org-aggregated pattern is ever traceable back to a specific originating org or application through the API or UI
4. Aggregation runs as an extension of the existing AG-29 (Knowledge Engine Indexer) — no new client-facing route is introduced
5. Knowledge Engine query results (existing `/api/intelligence/knowledge-query`) transparently blend cross-org and org-specific patterns without the user needing to know the difference
6. The Security requirement "no cross-org data leakage (except anonymized aggregate patterns)" (Technical Requirements) is satisfied by design, not by policy alone — verified via a data-flow audit before launch
7. Opt-out is available for any org that does not want its outcome data contributing to cross-org aggregation
8. Aggregation excludes any org that has opted out, verified at the query layer, not just at ingestion

**Data Requirements:**
- Extends `knowledge_patterns` with a cross-org aggregation flag
- Reads anonymized `outcomes`, `applications`, and `drafts` data across all participating orgs (service-role only, never client-exposed at the row level)

**Agent Dependencies:**
- Extends AG-29 (Knowledge Engine Indexer Agent) — currently PLANNED with no code (Section 5, `AGENTS_v2.md`); must be built and operational at the single-org level (Pillar 18) before cross-org aggregation can be layered on top
- Depends on Phase 1's discovery → probability → draft chain having run long enough across enough orgs to generate meaningful outcome-labeled training data

**Success Metrics:**
- Cross-org pattern confidence distribution (% of patterns reaching "high" confidence) over time
- Draft quality/award-rate lift attributable to cross-org-informed narrative recommendations vs. single-org-only baseline
- Zero confirmed incidents of org-identifiable data leaking through aggregated patterns

---

#### 12. Predictive Fundraising Simulator

**Executive Summary:** Extends Pillar 13's Impact Simulator from single-scenario to comparative multi-scenario modeling: increase board members, hire staff, expand geography, launch a program — AI projects revenue, probability, cost, ROI, and staffing needs across scenarios side by side. This matters because strategic decisions are rarely made against a single what-if in isolation; leadership needs to compare tradeoffs across several live options before committing.

**User Stories:**
- PFS-01: As a user, I can run multiple what-if scenarios and compare their projected outcomes side by side, not just one at a time
- PFS-02: As a user, comparative results show revenue, cost, ROI, probability, and staffing implications for each scenario
- PFS-03: As a board member, I can review a multi-scenario comparison as part of a board meeting packet
- PFS-04: As a user, I can save a scenario comparison set and revisit it later as assumptions change
- PFS-05: As a user, each scenario in a comparison carries its own risk assessment, not a single blended risk figure

**Acceptance Criteria:**
1. `impact_simulations` supports a `scenario_comparison_id` linking multiple scenario runs into a single comparison set
2. The comparison view on `/intelligence/simulate` renders all linked scenarios side by side with aligned metrics (revenue, cost, ROI, probability, staffing)
3. Each scenario retains its own independent risk assessment and recommended prerequisites (per existing CIS-03), not a merged one
4. Saved comparison sets are retrievable and re-viewable without recomputation unless the user explicitly requests a refresh
5. `/api/intelligence/simulate/compare` returns results for all scenarios in a set within acceptable latency for an interactive UI (no long blocking wait per scenario)
6. Comparison results can be exported as a single PDF for board packet inclusion (extends CIS-05)
7. Simulations remain strictly read-only projections — no comparison ever writes to live financial or pipeline data
8. A comparison set can include 2 or more scenarios; the UI degrades sensibly if only one scenario is present (falls back to the existing single-scenario view)

**Data Requirements:**
- Extends `impact_simulations` with `scenario_comparison_id`
- No other new tables required — this is a modeling/UI extension of Pillar 13's existing schema

**Agent Dependencies:**
- Extends AG-28 (Impact Simulation Agent) — currently PLANNED with no code found anywhere in the repo (Section 5, `AGENTS_v2.md`); AG-28 must be built for single-scenario modeling first, per Pillar 13, before comparative modeling can be layered on
- Do not confuse this AG-28 with the on-disk `ag-28-followup` literal, which belongs to the unrelated Follow-Up Generator Agent (see `AGENTS_v2.md` §1.4)

**Success Metrics:**
- Number of scenario comparison sets created and included in board packets
- User-reported decision confidence before/after using multi-scenario comparison (survey-based)
- Correlation between simulator-recommended prerequisites being met and actual scenario outcomes when a decision is later executed

---

#### 13. Autonomous Continuous Improvement Engine

**Executive Summary:** A nightly self-assessment agent reviewing `agent_runs` outcomes: what worked, what failed, which agents underperformed, which prompts improved results. Proposes enhancements, validates in staging, A/B tests, and presents high-confidence improvements for human approval before deployment. This matters because it is the first agent in the roster permitted to propose changes to other agents' prompts — a meaningful escalation in autonomy that must be built with correspondingly stronger human-approval guardrails.

**User Stories:**
- ACI-01: As a platform owner, I receive proposed agent-prompt improvements backed by concrete evidence from `agent_runs` history
- ACI-02: As a platform owner, no proposed improvement is ever deployed without my explicit approval
- ACI-03: As a platform owner, I can see the A/B test results and staging validation behind any proposed improvement before approving it
- ACI-04: As a platform owner, I can reject a proposed improvement with a reason, and that reasoning informs future proposals
- ACI-05: As a platform owner, I can see a running history of which improvements were approved, rejected, or modified over time

**Acceptance Criteria:**
1. `agent_improvement_proposals` rows cite specific `agent_runs` evidence (failure patterns, underperformance metrics) backing each proposal
2. No proposal is ever auto-deployed — every proposal requires an explicit approval action on the `/admin/monitor` approval queue
3. Proposals include staging validation and A/B test results before being surfaced for approval, not just a hypothesis
4. Rejected proposals are logged with the rejection reason and are queryable for pattern analysis
5. This agent (AG-36) never modifies another agent's live prompt directly — it only proposes; deployment of an approved change is a separate, explicit step
6. `AUTONOMOUS_HARD_LIMITS.NEVER_MODIFY_GOVERNANCE_FILES` is respected — AG-36 never proposes changes to CLAUDE.md, BLUEPRINT_v2.md, SCHEMA_REGISTRY_v2.md, BEHAVIORAL_CONTRACTS.md, STATE_OF_THE_BUILD.md, or SESSION_STATE.md
7. Proposal generation runs nightly, reading `agent_runs` across the org(s) it's scoped to
8. An approved improvement's actual post-deployment performance is tracked and feeds back into future proposal evidence (closing the loop)

**Data Requirements:**
- New table `agent_improvement_proposals`
- Reads `agent_runs` (all agents, all orgs it's scoped to review) for evidence of failure patterns and underperformance

**Agent Dependencies:**
- New AG-36 (meta-agent, reads `agent_runs`)
- Requires substantial `agent_runs` history across many agents and orgs to have meaningful evidence to work from — this is explicitly a Phase 4 capability that depends on Phase 1–3 agents having run in production for an extended period
- Feeds AG-39 (ROI Optimization Engine, Feature 15) as a downstream consumer

**Success Metrics:**
- Approval rate of proposed improvements (approved / total proposed)
- Measured performance lift (confidence score, award-rate correlation, or task-specific KPI) for approved-and-deployed improvements vs. baseline
- Zero incidents of any proposal touching a governance file or deploying without approval

---

#### 14. Community Resource Graph

**Executive Summary:** Maps donors, housing providers, churches, government agencies, volunteers, contractors, property owners, employers, and transportation as PIG node/edge types, computing the shortest path from a specific client need to the combination of resources that meets it — the Faith Foundation model. This matters because it directly extends the platform's founding use case (rural Texas emergency/transitional housing) from funding intelligence into operational service-coordination intelligence.

**User Stories:**
- CORG-01: As a caseworker, I can enter a specific client need and see the shortest path of available community resources that could meet it
- CORG-02: As a caseworker, resource matches include real, current contact/availability information, not stale directory data
- CORG-03: As an ED, I can see which resource types are scarce or bottlenecked in my service area based on graph connectivity
- CORG-04: As a nonprofit partner, I can list my organization's available resources (beds, transportation, job placements) as a node in the graph
- CORG-05: As a platform owner, this capability launches scoped to the Faith Foundation pilot org before any broader rollout

**Acceptance Criteria:**
1. New PIG node types are added for housing providers, volunteers, contractors, property owners, employers, and transportation without breaking existing node types (business/foundation/government/person/nonprofit)
2. `/api/intelligence/resource-path` returns a real computed shortest path from a stated need to a combination of available resource nodes
3. Resource availability data is refreshed on a defined cadence — matches never surface a resource that's confirmed no longer available past a staleness threshold
4. The resource-matching UI is scoped explicitly to the Faith Foundation pilot org first, gated behind a feature flag before wider rollout, per the explicit pilot-first sequencing in `AUTONOMOUS_PLATFORM_VISION.md`
5. Nonprofit partners can self-list available resources without requiring platform engineering involvement per listing
6. Scarcity/bottleneck detection surfaces which resource types have the fewest available paths in a given service area
7. No client-identifiable need data is exposed to a listing partner beyond what's necessary to fulfill the specific match request
8. Path-finding correctly handles a need with no viable path (returns a clear "no path found" result, not a false match)

**Data Requirements:**
- Extends `pig_nodes`/`pig_edges` with new node types (housing_provider, volunteer, contractor, property_owner, employer, transportation)
- No separate table — extension of existing PIG schema per Data Architecture Principle #4 (relationships in `pig_edges`, never new foreign keys)

**Agent Dependencies:**
- New AG-38
- Depends on Feature 7 (Philanthropic Intelligence Graph full build) being operational, since this feature is a domain-specific extension of the same PIG infrastructure
- Depends on Feature 6/AG-23 patterns for relationship/edge discovery mechanics, applied to a new domain (service coordination rather than fundraising relationships)

**Success Metrics:**
- Number of successful need-to-resource matches fulfilled for the Faith Foundation pilot
- Average path length (fewer hops = tighter local resource network) over time as the graph densifies
- Resource scarcity signals correctly predicting reported service gaps in the pilot org's actual caseload

---

#### 15. ROI Optimization Engine

**Executive Summary:** Tracks every submission variable — prompt version, attachment type, submission day, wording choices, contact person — against outcome, running a continuous optimization loop that feeds directly into the Continuous Improvement Engine (Feature 13). This matters because it turns "what worked" from an intuition into a measured, continuously-refined variable-level dataset that compounds in value the longer the platform operates.

**User Stories:**
- ROE-01: As a platform owner, I can see which submission variables (day of week, attachment type, wording pattern, contact person) correlate most strongly with award outcomes
- ROE-02: As a user, I receive a recommendation for the highest-ROI submission approach for my next application, backed by tracked variable data
- ROE-03: As a platform owner, I can view an ROI trend dashboard showing which variables are gaining or losing predictive value over time
- ROE-04: As a platform owner, this engine's findings feed the Continuous Improvement Engine's proposals rather than operating in isolation
- ROE-05: As a user, variable-level recommendations never override my own submission choices — they are suggestions, not automatic actions

**Acceptance Criteria:**
1. `submission_variable_outcomes` records every tracked variable (prompt version, attachment type, submission day, wording pattern, contact person) alongside the eventual outcome for that submission
2. The ROI trend dashboard on `/admin/monitor` visualizes variable-outcome correlation trends over time, not just a static snapshot
3. No variable-level recommendation is ever auto-applied to a submission — it is surfaced for the user to accept or ignore
4. AG-39's findings are consumable by AG-36 (Continuous Improvement Engine) as structured evidence, not just human-readable text
5. Variable tracking captures data automatically as part of the existing submission flow — it does not require separate manual data entry per submission
6. Correlation analysis accounts for confounding factors (e.g. funder category, amount requested) rather than treating all submissions as directly comparable
7. The dashboard clearly distinguishes statistically meaningful patterns (sufficient sample size) from noise (too few data points to trust)
8. No optimization recommendation is presented without its supporting sample size and confidence level shown alongside it

**Data Requirements:**
- New table `submission_variable_outcomes`
- Reads `submission_queue`, `applications`, `outcomes`, `drafts` (for prompt version and wording pattern tracking)

**Agent Dependencies:**
- New AG-39; feeds AG-36 (Autonomous Continuous Improvement Engine, Feature 13)
- Depends on AG-12 (AutoApply Agent) and the draft/application pipeline having enough submission volume and recorded outcomes to produce statistically meaningful correlations

**Success Metrics:**
- Statistical confidence (sample size, significance) of top-ranked variable correlations over time
- Award-rate lift for applications that followed a high-confidence ROI recommendation vs. those that didn't
- Number of AG-36 improvement proposals citing AG-39 evidence as their basis

---

### PHASE 5 — Network Effects (Month 49+)

#### 16. AI Strategic Advisor

**Executive Summary:** The capstone agent — reads the output of every other agent in the roster and synthesizes a single prioritized action list, proactively surfacing unsolicited recommendations before the user asks: "Apply for these 12 grants next month." "Postpone this application." "This foundation funded exactly your profile 3 times in the last 2 years." This matters because it is the culmination of every other pillar and phase — the point at which the platform stops being a collection of tools the user must still synthesize themselves and becomes a single coherent strategic voice.

**User Stories:**
- ASA-01: As an ED, I see a single prioritized "Today's Priorities" list on my dashboard synthesized from every active agent's output, not 18 separate panels I have to reconcile myself
- ASA-02: As an ED, I receive proactive recommendations I didn't ask for when the evidence is strong enough to warrant surfacing them unsolicited
- ASA-03: As an ED, every recommendation cites its supporting evidence and which underlying agent(s) contributed to it
- ASA-04: As an ED, I can dismiss or deprioritize a recommendation, and that feedback improves future prioritization
- ASA-05: As an ED, this advisor never takes an action on my behalf — every recommendation stops at a human decision point, consistent with every hard limit in the roster

**Acceptance Criteria:**
1. `strategic_recommendations` rows synthesize input from multiple underlying agents (AG-01 through AG-39), citing which agents/evidence contributed to each recommendation
2. The dashboard "Today's Priorities" hero panel renders a single ranked list, not a re-display of each source agent's raw output
3. Recommendations are ranked by a defined priority scoring method (e.g. urgency × confidence × potential value), not simple recency
4. No recommendation ever triggers an autonomous action — `AUTONOMOUS_HARD_LIMITS` apply in full; this agent is synthesis-and-surface only
5. Dismissal/deprioritization feedback measurably changes future recommendation ranking for that org
6. The advisor can synthesize across agent domains that are otherwise siloed today (discovery, relationship, reputation, forecast, probability) into a single cross-cutting recommendation
7. `/api/intelligence/strategic-advisor` responds within the platform's stated AI-response performance target (Technical Requirements: under 30 seconds)
8. Every recommendation is traceable back to specific underlying data (an opportunity ID, a funder ID, a decision log entry) — never a vague, unsupported suggestion

**Data Requirements:**
- New table `strategic_recommendations`
- Reads output from every other agent's tables: `agent_decisions`, `agent_runs`, `opportunity_probability_scores`, `reputation_alerts`, `relationship_recommendations`, `funding_forecasts`, `market_forecasts`, and others as they come online

**Agent Dependencies:**
- New AG-40 (reads output of AG-01 through AG-39)
- Depends on the full agent roster being operational — this is explicitly the last capability built, since it has nothing to synthesize until the agents feeding it exist and are producing real output

**Success Metrics:**
- % of surfaced recommendations acted on (applied to pipeline, application postponed, etc.) within 7 days
- User-reported trust/reliance on the "Today's Priorities" panel as primary daily workflow entry point vs. navigating individual pillar pages
- Reduction in time-to-decision for prioritization tasks that previously required manually cross-referencing multiple pillar dashboards

---

#### 17. Cross-Organization Anonymous Benchmarking

**Executive Summary:** Computes "Your win rate is in the 73rd percentile of orgs with a similar mission and budget size" from anonymized aggregate outcome data across all Benavora subscribers. This matters because it is the one moat (Moat 4 in the Competitive Moat Analysis) with genuinely non-linear value growth — every new subscriber org improves every existing subscriber's benchmarking context, which improves retention, which grows the base further, a flywheel a competitor entering later cannot access without first building the same subscriber base.

**User Stories:**
- COB-01: As an ED, I can see how my org's win rate, average award size, and pipeline velocity compare to similar orgs on the platform
- COB-02: As an ED, similarity is computed on mission category and budget size, not an arbitrary or overly broad peer group
- COB-03: As an ED, I never see another specific org's identifiable data through a benchmark — only my own percentile position
- COB-04: As a platform owner, benchmark computation never exposes `org_id` in any client-facing response
- COB-05: As an ED, I can see benchmarks for multiple metrics (win rate, average award, time-to-award) side by side

**Acceptance Criteria:**
1. `benchmark_aggregates` is service-role-only with no `org_id` ever present in a client-facing API response, per its explicit design note in `AUTONOMOUS_PLATFORM_VISION.md`
2. Peer grouping is computed from mission category and budget size similarity, not a flat platform-wide average
3. Percentile calculations require a minimum peer-group sample size before being surfaced, to avoid effectively de-anonymizing a tiny peer group
4. Benchmark percentiles are shown on `/reports` as badges alongside the org's own metrics, not as a separate disconnected page
5. No benchmark computation path allows reconstructing which specific peer orgs contributed to a given percentile
6. Benchmarks refresh on a defined cadence, not one-time at account creation
7. An org can opt out of contributing to and/or viewing benchmarks; opt-out is honored at both the ingestion and display layer
8. The minimum-sample-size safeguard is tested explicitly against small peer groups (e.g. a rare mission category with few orgs) to confirm it correctly suppresses display rather than showing a misleadingly precise percentile

**Data Requirements:**
- New table `benchmark_aggregates` (service-role only, no `org_id` exposure in client responses)
- Reads anonymized `outcomes`, `applications` data across all participating, non-opted-out orgs

**Agent Dependencies:**
- Extends AG-29 (Knowledge Engine Indexer Agent)
- Depends on Feature 11 (Global Learning Network) having established the anonymization and opt-out infrastructure this feature reuses
- Depends on a sufficiently large, long-tenured subscriber base existing — per the Competitive Moat Analysis, this moat "cannot be bought," it requires the base itself

**Success Metrics:**
- Number of mission-category/budget-size peer groups large enough to support statistically meaningful benchmarking
- User engagement with benchmark badges on `/reports` (views, time spent)
- Retention lift for orgs actively viewing benchmarks vs. orgs that have opted out or never engaged

---

#### 18. Autonomous Multi-Agent Negotiation

**Executive Summary:** AI-to-AI communication with corporate giving portals for documentation alternatives and requirement clarification, extending AutoApply beyond form-filling into structured back-and-forth where a portal's own chatbot or API accepts programmatic queries. This matters because some portals require clarifying dialogue (e.g. "can we substitute document X for Y") that today stops AutoApply cold and forces a human to intervene manually — this feature is scoped narrowly to structured, non-adversarial clarification, not open-ended negotiation of terms.

**User Stories:**
- AMN-01: As a user, when a portal supports programmatic clarification (chatbot or API), AutoApply can resolve simple documentation-substitution questions without stopping for human input
- AMN-02: As a user, I can review the full transcript of any AI-to-AI negotiation session after the fact
- AMN-03: As a user, any negotiation outcome that changes the substance of my application (not just a document format) still stops at human approval
- AMN-04: As a user, negotiation sessions never proceed to final submission without passing through the existing mandatory human approval checkpoint (AG-12's structural gate)
- AMN-05: As a platform owner, I can disable multi-agent negotiation per-portal if a specific portal's automated responses prove unreliable

**Acceptance Criteria:**
1. `portal_negotiation_sessions` records the full transcript of every AI-to-AI exchange for a given submission
2. Negotiation scope is restricted to pre-defined clarification categories (document substitution, format questions, field clarification) — never open-ended terms negotiation
3. `AUTONOMOUS_HARD_LIMITS.NEVER_SUBMIT_EXTERNALLY` still applies in full — a negotiation session resolving cleanly does not bypass the existing human approval checkpoint before final submit
4. The negotiation transcript viewer on the automation session detail page renders the full back-and-forth, not just a summary
5. Any negotiation outcome that would materially change requested amount, narrative content, or eligibility basis automatically escalates to `requires_review` rather than being resolved autonomously
6. Per-portal enable/disable toggle is respected — a disabled portal falls back to the existing human-escalation behavior with no negotiation attempted
7. Negotiation sessions have a bounded retry/exchange limit — a session that doesn't resolve within a defined number of exchanges escalates to human review rather than looping indefinitely
8. No negotiation session ever represents itself to a portal's chatbot/API as a human operator in a way that would violate that portal's terms of service — scope this explicitly during implementation, not as an afterthought

**Data Requirements:**
- New table `portal_negotiation_sessions`
- Extends `submission_queue`/`form_analyses` context for the specific submission being negotiated

**Agent Dependencies:**
- New AG-37; extends AG-12 (AutoApply Agent)
- Depends on Feature 4 (AutoApply Full Autonomous Mode) being operational first, since negotiation is an extension of the autonomous submission pipeline, not a standalone capability

**Success Metrics:**
- % of documentation-clarification stops resolved autonomously vs. requiring human escalation, before and after rollout
- Zero incidents of a negotiation session bypassing the mandatory human approval checkpoint before final submission
- Per-portal reliability rate (successful, correctly-scoped negotiations vs. sessions that had to be disabled or escalated)

---

## Technical Requirements

### Performance
- All page loads under 2 seconds
- AI agent responses under 30 seconds (with streaming where applicable)
- Real-time dashboard updates under 500ms latency
- Graph queries under 5 seconds for 3-hop traversals

### Scale
- Support 10,000+ concurrent organizations
- Handle 1M+ corporate prospect records without degradation
- Process 10,000+ enrichment jobs per overnight run
- Store and query 2,000+ funded proposals in Intelligence Library

### Security
- All org data RLS-protected at database level
- No cross-org data leakage (except anonymized aggregate patterns in Knowledge Engine)
- All AI calls use server-side keys only — never exposed to client
- All file uploads virus-scanned before storage

### AI Model Requirements
- All Claude calls use claude-sonnet-4-6
- All routes with AI calls require maxDuration = 300 in Vercel config
- All AI responses include confidence indicators
- No AI fabrication — all generated content sourced from org data or verified external sources

### Integration Requirements
- Supabase: primary database, auth, storage, realtime
- Railway: worker service for long-running jobs and enrichment pipelines
- Vercel: deployment, edge functions
- Resend: transactional email, campaign email
- Stripe: billing and subscription management
- Google Places API: business discovery
- Anthropic API: all AI features
- FEMA API: disaster declarations
- IRS APIs: BMF, 990 data
- SAM.gov API: federal opportunities
- Grants.gov API: federal grants
- Federal Register API: NOFAs
- NIH RePORTER API: health research grants
- NSF Award Search API: science grants
- USASpending API: federal award data
- Congress.gov API: legislative monitoring

---

## Data Architecture Principles

1. Every entity has a single source of truth table — never duplicate across tables
2. All enrichment data stored as jsonb — never add columns per enrichment field
3. All scoring data stored as jsonb — never add columns per score type
4. All relationship data in the pig_edges table — never encode relationships as foreign keys
5. All AI outputs include: model used, tokens consumed, confidence score, generated_at timestamp
6. All background jobs log to agent_runs table with full input/output
7. All financial data in USD cents (integer) — never floating point for money

---

## Pricing & Plan Gates

**Pricing (corrected):**

| Tier | Monthly | Annual (per month, billed yearly) |
|---|---|---|
| Starter | $397/mo | $317/mo |
| Professional | $897/mo | $717/mo |
| Enterprise | $2,497/mo | $1,997/mo |
| Consultant (post-launch, PLANNED) | $4,997 base + $497/client/mo | — |

| Feature | Starter ($397/mo) | Professional ($897/mo) | Enterprise ($2,497/mo) |
|---|---|---|---|
| Grant Research Agent | ✓ | ✓ | ✓ |
| Draft Generator | ✓ | ✓ | ✓ |
| Impact Measurement Agent | ✓ | ✓ | ✓ |
| Opportunities (max) | 100 | Unlimited | Unlimited |
| AI Opportunity Discovery | — | ✓ | ✓ |
| Grant Probability Engine | — | ✓ | ✓ |
| Corporate Giving Intelligence | — | ✓ | ✓ |
| Reputation Intelligence | — | ✓ | ✓ |
| Board Advisor | — | ✓ | ✓ |
| Forecast Agent | — | ✓ | ✓ |
| Compliance Agent | — | ✓ | ✓ |
| Email Intelligence Agent | — | ✓ | ✓ |
| Relationship Builder | — | ✓ | ✓ |
| Philanthropic Intelligence Graph | — | — | ✓ |
| Executive Command Center | — | — | ✓ |
| Disaster Response Engine | — | ✓ | ✓ |
| Donation Marketplace | — | — | ✓ |
| Impact Simulator | — | — | ✓ |
| Volunteer Agent | — | — | ✓ |
| Legal Intelligence Agent | — | — | ✓ |
| White-label (consultant) | — | — | ✓ |
| Orgs per account | 1 | 1 | Unlimited |
| API access | — | — | ✓ |

**Consultant tier (post-launch, PLANNED):** $4,997 base platform fee plus $497/client/month. White-label multi-org management for grant consultants and fiscal sponsors managing multiple nonprofit clients under one account. Not yet built — scope against Section 3 (White-Label Portal, Feature #78, BUILT for single-client access) before extending to true multi-client billing.
