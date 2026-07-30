# BENAVORA — Feature Registry v2.0
## Supersedes: Feature_Registry.md v1.0
## Date: July 30, 2026 (last update — agent verification consolidation)
## Status: CANONICAL — Updated after every FORGE run and CC session.
## Build tool: FORGE 1.x | Repo: Reid64/benavora | Production: www.benavora.com

**July 30, 2026 update:** every AG-15 through AG-30 row (and the Post-Launch Vision rows that
directly collide with or extend those numbers) has been re-stated using the agent-verification
tiers below, consolidating the live-verification findings recorded across `AGENT_VERIFICATION_LOG.md`'s
q6-q9 passes. Several previously-unqualified "BUILT" claims for autonomous agents were found to be
false or misleading once tested live against production — most commonly, an agent's code is real
and compiles but its first database write fails on a strict `agent_type` enum that was never
extended for it (`AGENTS_v2.md` §1.2), a pattern reproduced live, not inferred, for AG-15, AG-17,
AG-19 (moot — never called), the "AG-30" Donor Intent Monitor, and AG-38. Where a row's real status
turned out to be better than documented (AG-15's deterministic engine, AG-16's Digital Twin builder,
AG-25's Disaster Response agent matching its own spec exactly), that is stated too — this pass is not
one-directional bad news.

---

## Status Key

| Status | Meaning |
|---|---|
| BUILT | Fully implemented, compile-verified, deployed to production |
| PARTIAL | Core functionality built, gaps documented below |
| IN BUILD | Currently in active FORGE queue or overnight run |
| PLANNED | Scoped and architected, not yet in a queue |
| DEFERRED | Explicitly postponed to a future phase |

**Agent-verification tiers (added July 30, 2026, after `AGENT_VERIFICATION_LOG.md`'s q6-q9 live
verification passes on AG-15 through AG-30):** "BUILT" alone means compile-clean and deployed — it
does not mean anyone confirmed the code actually runs or produces correct output. For every agent
row that log covers, the plain BUILT/PLANNED status below is replaced with one of these three:

| Tier | Meaning |
|---|---|
| BUILT — VERIFIED | Real code, real call site, and its actual runtime behavior against real production data was directly observed this session (live DB read/write, reproduced insert, or hand-checked output) — not just read from source. |
| BUILT — UNVERIFIED | Real code exists, compiles, and has a real call site, but its actual runtime output was not confirmed against live data this session (commonly because a live blocker — missing table, invalid API key, tool-permission denial — prevented it, or because no test was attempted). Treat as "probably does something," not "confirmed correct." |
| BUILT — BLOCKED (VERIFIED) | Real code exists, but a live reproduction this session confirmed it **cannot execute at all** in production today (e.g. an `agent_type` enum insert fails, a required table 404s) — this is stronger than "unverified": the failure itself was directly observed, not inferred. |
| NOT-BUILT | No implementation found anywhere in the repo for this concept, confirmed by direct grep/search this session (or a prior session whose finding was independently re-confirmed) — functionally equivalent to PLANNED, stated explicitly for clarity. |

---

## Phase 1 — Core MVP (Features 1–18) — ALL BUILT

| # | Feature | Description | Status |
|---|---|---|---|
| 1 | Authentication | Email/password login and registration via Supabase Auth. Creates org + profile on signup. Onboarding gate via middleware. | BUILT |
| 2 | Dashboard v2 | Hero banner (Your Task Management Area), FlightPathHUD 6-stage lifecycle cards, Today's Action Items widget, Pipeline, Deadlines, Quick Actions. Two-column layout. | BUILT |
| 3 | Funder CRM | Searchable/sortable funder database. 12 category types. Detail pages with tabs: Overview, Contacts, Opportunities, Applications, Notes. Relationship score display. | BUILT |
| 4 | Contact CRM | Contacts linked to funders. Relationship status (cold/warm/active/champion). Activity log. | BUILT |
| 5 | Opportunities | Opportunity records with eligibility score, probability score, recommendation, keyword tags. Filter by category, deadline, amount, status, probability. | BUILT |
| 6 | Keyword Search | Full-text keyword search across opportunities via opportunity_keywords table. Add/remove tags per opportunity. | BUILT |
| 7 | Application Pipeline | 12-stage kanban board with drag-and-drop. Stage transition rules enforced. Pipeline history logged. Days-in-stage tracking. | BUILT |
| 8 | Document Repository | Drag-and-drop file upload to Supabase Storage. 8 document categories. Expiration warnings. Link docs to applications. | BUILT |
| 9 | Knowledge Base | Organization profile editor, reusable narrative blocks with category tags, standard Q&A answers. Proven narrative badges. | BUILT |
| 10 | AI Draft Generator | Select opportunity + template type. Claude generates draft using KB + proven narratives. Confidence scoring 0-100. Warning banner below 70. | BUILT |
| 11 | Deadline System | Calendar and list views. Color-coded urgency. Auto-created from opportunities. Completion tracking. Predicted deadlines section. | BUILT |
| 12 | Notes System | Polymorphic notes on funders, opportunities, and applications. Timeline display. Author tracking. | BUILT |
| 13 | Outcome Tracking | Record awarded/denied/partial per application. Funder feedback. Narrative snapshot frozen at submission. | BUILT |
| 14 | Recursive Learning | Analyzes awarded applications. Extracts proven narratives. Updates effectiveness scores. Flags winning patterns for reuse. | BUILT |
| 15 | Cold Outreach | Extract contacts from companies without giving pages. Outreach contact table. Convert to funder. | BUILT |
| 16 | Search Profiles | Saved keyword configurations for automated searches. Keywords, categories, geographic scope, amount range, active/paused toggle. | BUILT |
| 17 | Settings | Organization settings. User management with role assignment. Feature flag display. Notification preferences. Agent Marketplace link. | BUILT |
| 18 | RLS Isolation | Row Level Security on all org-scoped tables. Every query scoped by organization_id. Complete tenant data isolation. | BUILT |

---

## Phase 2 — Tier 1-3 Enhancements (Features 19–39) — ALL BUILT

| # | Feature | Tier | Status |
|---|---|---|---|
| 19 | Draft Persistence + Version History | Tier 1 | BUILT |
| 20 | Nav State Preservation | Tier 1 | BUILT |
| 21 | KB Detail Views | Tier 1 | BUILT |
| 22 | AI Humanizer Agent | Tier 1 | BUILT |
| 23 | Grant Source Categorization | Tier 2 | BUILT |
| 24 | Parallel Research Agents | Tier 2 | BUILT |
| 25 | Search Profile Config | Tier 2 | BUILT |
| 26 | Analytics Dashboard | Tier 2 | BUILT |
| 27 | Enhanced Eligibility Scoring | Tier 2 | BUILT |
| 28 | Alerts & Notifications | Tier 2 | BUILT |
| 29 | Multi-Model Consensus | Tier 2 | BUILT |
| 30 | Budget Narrative Generator | Tier 3 | BUILT |
| 31 | Document Assembly Engine | Tier 3 | BUILT |
| 32 | Funder Intelligence | Tier 3 | BUILT |
| 33 | Renewal Tracker | Tier 3 | BUILT |
| 34 | Success Pattern Learning | Tier 3 | BUILT |
| 35 | Compliance Pre-Check | Tier 3 | BUILT |
| 36 | Cold Outreach Sequences | Tier 3 | BUILT |
| 37 | Grant Calendar View | Tier 3 | BUILT |
| 38 | Email Parsing Agent | Tier 3 | BUILT |
| 39 | Board Report Generator | Tier 3 | BUILT |

---

## Phase 3 — Browser Automation (Features 40–46) — ALL BUILT

| # | Feature | Status | Notes |
|---|---|---|---|
| 40 | Form Detection | BUILT | Playwright navigates to giving portal URLs. AI identifies form fields. |
| 41 | Auto-Fill Engine | BUILT | humanType() character-by-character field filling. Field confidence scoring. |
| 42 | Challenge Detection | BUILT | CAPTCHAs, MFA, account creation detected. Pauses for human intervention. |
| 43 | Approval Checkpoint | BUILT | Human approval before final submission. Screenshot review. Audit logged. |
| 44 | Portal Credentials | BUILT | Credential vault per funder. Auto-login before form filling. |
| 45 | Submission Verification | BUILT | Captures confirmation page/number. Screenshots in Supabase Storage. |
| 46 | Automation Dashboard | BUILT | Session history, status, diagnostics, retry controls, screenshot review. |

---

## Phase 4 — SaaS Layer (Features 47–52) — ALL BUILT

| # | Feature | Status | Notes |
|---|---|---|---|
| 47 | Stripe Billing | BUILT | 3-tier subscriptions. Checkout, portal, webhooks. Status enforcement. |
| 48 | Usage Limits | BUILT | Per-tier caps enforced at API level. |
| 49 | Onboarding Wizard | BUILT | 7-step guided setup. Progress saved per step. |
| 50 | Audit Logs | BUILT | All user actions tracked. Searchable log viewer. |
| 51 | User Invitations | BUILT | Invite by email with role assignment. Acceptance flow. |
| 52 | UI Theme | BUILT | Elevated Slate design system. FlightPathHUD colored cards. |

---

## Tier 6 — Full Autonomous Operation (Features 53–78)

| # | Feature | Status | Notes |
|---|---|---|---|
| 53 | Grants.gov Client | BUILT | Daily poll via POST API. Auto-creates opportunities with dedup. |
| 54 | SAM.gov Client | BUILT | Weekly poll. src/lib/sources/samgov-client.ts + API route. |
| 55 | ProPublica 990 Mining | BUILT | src/lib/sources/propublica-990-client.ts + batch script. Never run at scale. |
| 56 | State Portal Framework | PARTIAL | Scraper exists, stub only. No real HTML parsing implemented. |
| 57 | Integration Settings UI | BUILT | /settings/integrations connector cards (Grants.gov, ProPublica, State Portals, SAM.gov "Run Now") now default their required params (keywords/state/ein/query) from real org data instead of posting an empty body that always 400'd. SAM.gov also now reads the org's own encrypted key (integration_keys) before falling back to process.env, per Behavioral Contracts §18. Commit 0232358, July 28 2026. |
| 58 | CSV Import Wizard | BUILT | 3-step wizard at /import. Column mapping. Preview. POST to /api/import/csv. |
| 59 | Custom API Connector | PLANNED | Not built. |
| 60 | Custom Scraping Targets | PLANNED | Not built. |
| 61 | Automation Queue | BUILT | Worker exists (worker/queue-processor.ts). Priority scoring in worker/batch-scorer.ts, re-run on idle→active transitions: timing, funder match, historical win rate, amount alignment, portal health, deadline proximity (nearest open opportunity per funder), probability score (opportunity_probability_scores, Feature #102, if scored), and organization tier. Lower submission_queue.priority = processed first. |
| 62 | Semi/Autonomous Modes | BUILT | Both modes implemented in AutoApply. |
| 63 | 2Captcha Integration | BUILT | captcha-solver.ts wired into src/lib/autoapply/form-filler-agent.ts — detect/solve/inject for recaptcha v2/v3, hcaptcha, turnstile. Audit logging, screenshot capture, graceful degradation when 2Captcha key is missing. Commit 3e7400b, July 22 2026. |
| 64 | Automation Monitor | BUILT | Real-time queue status. Failure categorization. Screenshot review. |
| 65 | Notification Preferences | BUILT | Per-user event type preferences. In-app + email toggles. |
| 66 | 990-PF Giving History | PLANNED | Not built separately. Foundation profiler exists but not giving history extractor. |
| 67 | Foundation Profile Builder | BUILT | src/lib/intelligence/foundation-profiler.ts + API route. |
| 68 | Success Probability Scoring | BUILT | src/lib/intelligence/success-probability.ts + /api/opportunities/[id]/probability. |
| 69 | Funder Relationship Score | BUILT | src/lib/intelligence/relationship-scorer.ts + API routes. |
| 70 | Competitor Intelligence | BUILT | Agent exists and integrated. |
| 71 | Deadline Prediction | BUILT | src/lib/intelligence/deadline-predictor.ts + API route + UI section. |
| 72 | Application Cloning | BUILT | /api/applications/[id]/clone — AI-adapted narrative for new opportunity. |
| 73 | Semantic Funder Matching | BUILT | src/lib/intelligence/semantic-matcher.ts + /research/match page. |
| 74 | Follow-Up Sequences | BUILT | Table + page + src/worker/jobs/process-followups.ts (276 lines, verified) fully implemented. Commit 2f822b1, July 22 2026. |
| 75 | Financial Reconciliation | BUILT | Budgets, expenses, reconciliation reports. API routes. Financials page. |
| 76 | Compliance Calendar | BUILT | compliance_events table + page + API routes. |
| 77 | Multi-Channel Outreach | PARTIAL | Templates page and send route exist. LinkedIn/phone/physical mail not implemented. |
| 78 | White-Label Portal | BUILT | Consultant client access. /settings/white-label. Grant/revoke API. |

---

## Platform Vision — 18 Pillars (Features 79–114+)

### Pillar 1: Philanthropic Intelligence Graph
| # | Feature | Status | Notes |
|---|---|---|---|
| 79 | Graph Database Schema | IN BUILD | pig_nodes, pig_edges tables. Migration 094 tonight. |
| 80 | Relationship Discovery Engine | NOT-BUILT | Agent RA-01 = AG-23 (Relationship Mapper Agent), confirmed the same concept under two labels per `AGENT_VERIFICATION_LOG.md` "AG-23" (July 30 2026). No file, class, or route implements RA-01/AG-23 under either name — confirmed by repo-wide grep this session, not just re-reading the doc. The one real, substantive implementation of this concept in the repo is filed under a *different* agent number, AG-32 (`relationship-graph-builder-agent.ts`, see row #220) — that file's own header explicitly identifies itself as "the same agent as AG-23, not a distinct agent." Cross-reference #220, not this row, for real build status. |
| 81 | Relationship Explorer UI | PLANNED | /research/graph. Force-directed visualization. Phase 3 build. |
| 82 | Path Finder | PLANNED | Shortest path between any two entities. Phase 3 build. |

### Pillar 2: AI Opportunity Discovery Engine
| # | Feature | Status | Notes |
|---|---|---|---|
| 83 | Discovery Agent Core (AG-17) | BUILT — BLOCKED (VERIFIED) | Per `AGENT_VERIFICATION_LOG.md` "AG-17" (July 30 2026): `src/lib/agents/opportunity-discovery-agent.ts` is considerably more built than "IN BUILD" suggests — a full perceive/decide/execute/observe loop with five strategy branches, not a stub. But it cannot run in production today: reproduced live against the real DB, `startRun()`'s `agent_runs` insert with `agent_type: "ag-17-discovery"` fails with `22P02 invalid input value for enum agent_type`, on every trigger path. A fix migration (`src/supabase/migrations/101_orchestrator_enterprise_hardening.sql`) already exists in the repo but is confirmed **not applied** to the live database. Separately, a previously-undocumented live bug was found: `perceiveState()` queries `opportunity_probability_scores` with the wrong column (`org_id` instead of `organization_id`), which silently zeroes the average-probability baseline and permanently disables the `federal_shift` decision branch and the probability-chain quality gate — confirmed by a live side-by-side query (wrong column: `42703` error; right column: 169 real rows). Chain-routing (§1.3's `routeQueueItem()` gap) is fixed, confirmed by grep. |
| 84 | Morning Digest | BUILT — UNVERIFIED | src/lib/agents/morning-digest.ts (Generation-1 plain function, wired into the 7AM digest pipeline per row #198's "Autonomous Morning Digest," which is BUILT — that row covers the live `AutonomousDigestAgent`/digest pipeline that actually runs). Not independently re-verified in this pass — no entry for this specific file in `AGENT_VERIFICATION_LOG.md`. |
| 85 | Personalized Match Feed | PLANNED | Per-org scoring against Digital Twin. Phase 2 build. |
| 86 | Discovery Preferences | PLANNED | User-configurable source and category filters. Phase 2 build. |

### Pillar 3: Corporate Giving Intelligence
| # | Feature | Status | Notes |
|---|---|---|---|
| 87 | Corporate Prospects Table | BUILT (unverified live) | Correction, July 28 2026: no migration in the 076-084 range actually creates corporate_prospects — the real creating file is `supabase/migrations/107_corporate_prospects.sql`, added this session (post-dates MIGRATION_AUDIT.md's 108-file/106-highest-numbered pass, so it wasn't covered by that audit). Whether 107 has been applied to production is unconfirmed; a direct REST check on 2026-07-20 found this table absent (404/PGRST205). Treat as schema-defined, not confirmed live, until re-checked. |
| 88 | NAICS Consumer UI | BUILT | /donor-discovery/discover + NAICS labels. naics-labels.ts. |
| 89 | Google Places Adapter | BUILT | Existing donor discovery pipeline. |
| 90 | Corporate Enrichment Agents EA-01 to EA-10 (AG-20/AG-21 + 8 more) | BUILT — BLOCKED (VERIFIED) | Per `AGENT_VERIFICATION_LOG.md` "AG-20"/"AG-21"/"Full Pipeline Handoff" (July 30 2026), live-testing EA-01 (AG-20, Corporate Giving Detector) and EA-08 (AG-21, Executive Biography Analyzer) end-to-end: (1) **Total blocker, reconfirmed live**: `corporate_prospects` still 404s (`PGRST205`) against production — migration 107 has not been applied. Every EA-0X agent's one real call site depends on this table. (2) **Total blocker this session**: the local `ANTHROPIC_API_KEY` returns `401` from the real Anthropic API — no live Claude completion could be obtained for any EA-0X extraction step. (3) **Independent of both blockers, a confirmed design defect**: both EA-01's and EA-08's hardcoded candidate-path lists missed real, well-documented content for 2-3 of 3 real test companies (Target/Salesforce/Starbucks) — EA-01 scored 1/9 real hits, EA-08 scored 0/6 — because `StealthEngine.isPlausibleResponse()` does not distinguish a company's own large, well-formed branded 404 page from real content, and because real giving/leadership pages often live on a different subdomain (`corporate.target.com`, `investor.starbucks.com`) or path than the 2-3 guesses each agent tries. (4) **EA-01 and EA-08 both have an unguarded `callClaude()`** — if the Claude call throws (as it does today, universally, per blocker 2), no enrichment patch is written at all, silently leaving fields absent, contradicting EA-08's own header comment describing this agent as always writing a patch. Not tested this pass: EA-02 through EA-07, EA-09, EA-10 — treat as BUILT — UNVERIFIED (same table/key blockers apply structurally, since `worker/enrichment-processor.ts` runs all 10 in the same sequence, but their individual fetch logic was not independently exercised). **Caveat unchanged**: this orchestrator is not called from `worker/index.ts`'s boot sequence — on-demand only. |
| 91 | Propensity Scoring PS-01 to PS-10 (AG-22) | BUILT — VERIFIED (aggregation math only; blocked end-to-end) | Per `AGENT_VERIFICATION_LOG.md` "Full Pipeline Handoff" (July 30 2026): the merge mechanic (`mergeEnrichmentPatch()`) that composes EA-01's and EA-08's output into one `enrichment` jsonb is confirmed sound — ran live, both patch shapes compose with zero key collision. AG-22's own aggregation math (`computeOverallLikelihood()`/`clampScore()`, transcribed verbatim and run against two contrasting real profiles) is confirmed to genuinely discriminate by input — a rich Salesforce-like profile scored 74, an empty/thin profile scored 15, a 59-point real difference, not a fixed or fabricated number. **However**: (a) the same two total blockers as row #90 apply (missing `corporate_prospects` table, invalid Claude key — AG-22's own 9 rubric calls could not be live-tested, the scores above are a verbatim-code hand-run, not a live Claude completion); (b) a new chain-level defect was found: `enrichProspect()` stamps `enrichment_completed_at` **unconditionally**, regardless of how many EA-0X agents inside the loop failed — and that timestamp is AG-22's *only* gate, so AG-22 will score prospects whose enrichment never actually happened, with nothing in the schema distinguishing "genuinely low propensity" from "enrichment never found anything." Combined with row #90's fetch-layer miss rate, this is a compounding false-negative risk once the two blockers clear. |
| 92 | Corporate Giving DNA | PLANNED | Profile per company. Phase 2 build. |
| 93 | AutoApply Routing | BUILT | /api/donor-discovery/prospects/[id]/route-to-autoapply |
| 94 | Email Campaign Routing | BUILT | /api/donor-discovery/prospects/[id]/route-to-email |
| 95 | Relationship Mapper RA-01 (AG-23) | NOT-BUILT | Same finding as row #80 — RA-01 and AG-23 are one concept, confirmed by grep to have zero dedicated implementation under either label. `FEATURE_REGISTRY_v2.md` internal inconsistency found and flagged in `AGENT_VERIFICATION_LOG.md` "AG-23": this row and #80 stayed PLANNED while row #220 (Post-Launch Vision) separately and correctly marks the real, substantive implementation of this same concept BUILT under the number AG-32. Cross-reference #220 for actual build status; this row/#80 should not be read as "nothing exists for this capability," only "nothing exists under the AG-23/RA-01 label specifically." |
| 96 | Change Monitor CM-01 (AG-30, canonical) | NOT-BUILT | Per `AGENT_VERIFICATION_LOG.md` "AG-30" (July 30 2026): confirmed zero code exists anywhere — no file, no class, no route, no registry entry, for the canonical AG-30/CM-01 concept (change detection triggering re-enrichment). Do not confuse with the *different* agent also labeled "AG-30" in `AGENTS_v2.md`'s Phase 2-5 section (Donor Intent Monitor, `agentId: "ag-30-donor-intent"` — see row #218), which is real, built code under the same number for an unrelated purpose. |
| 97 | Corporate Marketplace | PLANNED | Prospect search UI + filter engine. Phase 2. |

### Pillar 4: Autonomous Relationship Builder
| # | Feature | Status | Notes |
|---|---|---|---|
| 98 | Relationship Memory | IN BUILD | relationship_memory table. Migration 093 tonight. |
| 99 | Signal Monitoring | PLANNED | LinkedIn + news + 990 watching. Phase 2 build. |
| 100 | Relationship Builder | BUILT (unwired) | Naming correction, July 30 2026 (see AGENT_VERIFICATION_LOG.md "AG-19"): this row's prior name "Recommendation Engine" and status "designed" are both stale. AGENTS_v2.md's canonical name (`RelationshipBuilderAgent`, `agentId: "ag-19-relationship"`, src/lib/agents/relationship-builder-agent.ts) is the accurate one, verified against real code — it is far more than a recommendation engine: Phase A (deterministic relationship scoring + one Claude-written engagement recommendation into relationship_recommendations, matching this row's original scope) plus a substantial, previously-undocumented Phase B (multi-hop warm-introduction pathfinding over pig_nodes/pig_edges, bounded funder-officer web-search research, priority-ranked action queue, 14-day follow-up deadlines). Its agent_type enum value was added by migration 096 (src/supabase/migrations/), closing the AGENTS_v2.md §1.2 enum gap for this agent specifically — but that migration exists only in the src/supabase/migrations tree, not the parallel root supabase/migrations tree (see project memory `benavora-two-parallel-migrations-directories`), so whether it is actually live in production is unconfirmed. Regardless of the enum, the class itself is never imported or instantiated anywhere outside its own file — worker/autonomous-orchestrator.ts's own header comment explicitly substitutes the unrelated Gen-1 `FunderRelationshipAgent` (event-delta scorer, agent_type `funder_relationship`) wherever a "RelationshipBuilderAgent" was requested. Same orphaned-code pattern as AG-36 (Learning Network Aggregator). |
| 101 | Relationship Builder UI | PLANNED | /funders/[id]/relationship view. Phase 2 build. |

### Pillar 5: Grant Probability Engine
| # | Feature | Status | Notes |
|---|---|---|---|
| 102 | Probability Scoring Engine (AG-15, deterministic engine) | BUILT — VERIFIED | Per `AGENT_VERIFICATION_LOG.md` "AG-15" (July 30 2026): stale "IN BUILD/Tonight" wording corrected. `computeGrantProbability()` (`src/lib/intelligence/grant-probability-engine.ts`) compiles clean and was run live, unmodified, against two real, contrasting opportunities in the real production Faith Foundation org — both scores hand-checked factor-by-factor against the function's own weighting and matched exactly, and both persisted for real via its own upsert into `opportunity_probability_scores` (confirmed by reading the row back). This is the real engine behind the manual/batch call sites; it is **not** the same thing as the blocked autonomous wrapper (see row #196). A genuine, previously-undocumented defect was found in `buildKeyRisks()`: for an opportunity whose deadline has already passed, the risk message reads "Deadline is under 15 days away" instead of "Deadline has already passed," because `days < 15` is checked before `days < 0` — dead-code bounds-check ordering bug, confirmed against a real lapsed-deadline row (CEVSS) in the live database. Does not affect the numeric score (separately-correct in `scoreDeadlineProximity()`), only the user-facing risk text. |
| 103 | Probability API Route | BUILT — VERIFIED | `src/app/api/intelligence/grant-probability/route.ts` confirmed to import and call the real `computeGrantProbability()` directly (not a stub), per `AGENT_VERIFICATION_LOG.md` "AG-15." |
| 104 | Batch Score Runner | BUILT — VERIFIED | `scripts/batch-score-opportunities.ts` confirmed to import and call the real engine directly, per `AGENT_VERIFICATION_LOG.md` "AG-15." |
| 105 | Probability Badges on Opportunities | BUILT — UNVERIFIED | `src/app/(dashboard)/opportunities/page.tsx` confirmed by direct read to reference `opportunity_probability_scores`/`overall_score` — wired to real data, not a placeholder. Read-verified only; no browser/screenshot check was performed this session (per `AGENT_VERIFICATION_LOG.md` "AG-15," explicitly flagged as not visually confirmed). |
| 106 | Factor Breakdown UI | PLANNED | Expandable score explanation per opportunity. Not covered by this session's verification pass — status unchanged. |

### Pillar 6: Organizational Digital Twin
| # | Feature | Status | Notes |
|---|---|---|---|
| 107 | Digital Twin Builder (AG-16) | BUILT — VERIFIED | Per `AGENT_VERIFICATION_LOG.md` "AG-16" (July 30 2026): stale "IN BUILD/Tonight" and stale `AGENTS_v2.md` "PLANNED, none live" framing both corrected — `buildDigitalTwin()` (`src/lib/intelligence/digital-twin-builder.ts`) compiles clean, every column it queries was cross-checked against the real migration DDL (no fabricated schema), and a live read of `organizational_digital_twins` for the real Faith Foundation org confirmed a genuine, data-rich, already-built twin (`twin_completeness_score: 70`, real mission statement, real board members with real bios) — not a stub or seed row. Event-driven (KB save, onboarding, manual API), not schedule-driven — the one real gap is no nightly-sweep entry in `worker/autonomous-orchestrator.ts` (confirmed absent by grep). |
| 108 | Digital Twin API | BUILT — VERIFIED | `/api/intelligence/digital-twin` plus two additional real call sites confirmed this session: `src/app/api/knowledge-base/route.ts` (rebuilds twin on KB write) and `src/app/api/onboarding/complete-setup/route.ts` (builds at onboarding). |
| 109 | Digital Twin Profile Page | BUILT — UNVERIFIED | `/intelligence/twin` — page file exists (per row #110's description of what it shows); not visually/browser-verified this session. |
| 110 | Twin-Powered Draft Generation | BUILT | AG-05 draft-generation-agent.ts reads organizational_digital_twins (migration 094) before generating; applications.twin_powered/twin_completeness recorded per draft. /intelligence/twin shows completeness score + section breakdown; /draft-generator/autonomous shows Twin-Powered badge + low-completeness warning. Not independently re-verified this pass — status unchanged from prior session. |
| 111 | Twin Completeness Score | BUILT — VERIFIED | Confirmed live: the real Faith Foundation org's `organizational_digital_twins` row carries a genuine, non-placeholder `twin_completeness_score: 70`, consistent with `buildKeyStrengths()`'s logic run against this org's real counts. |

### Pillar 7: Autonomous Proposal Factory
| # | Feature | Status | Notes |
|---|---|---|---|
| 112 | Narrative Generator | BUILT | Draft Generator existing feature. |
| 113 | Budget Generator | BUILT | Budget Narrative Generator existing feature. |
| 114 | Logic Model Builder | BUILT | Existing feature. |
| 115 | Document Assembly | BUILT | Document Assembly Engine existing feature. |
| 116 | One-Click Proposal Package | PLANNED | Full package (narrative + budget + logic model + timeline) in one click. Phase 2. |
| 117 | AutoApply Integration | BUILT | Completed proposals route to AutoApply queue. |

### Pillar 8: Corporate Outreach Factory
| # | Feature | Status | Notes |
|---|---|---|---|
| 118 | Personalized Outreach Generator (AG-24) | BUILT — UNVERIFIED | Per `AGENT_VERIFICATION_LOG.md` "AG-24" (July 30 2026): `AGENTS_v2.md`'s "none found, closest analog is AG-11" claim is wrong, not just stale — real implementation exists at `src/app/api/intelligence/outreach/generate/route.ts` (149 lines), genuinely wired into `/donor-discovery/outreach`'s composer UI. It fell through prior audits because they only grepped `src/lib/agents/`, and this is an API route. Structurally, the personalization is genuine (distinct per-prospect industry/location facts and per-org mission/impact KB content are assembled into the Claude prompt, not a name-templated form letter). **Cannot run end-to-end today**: its first query is against `corporate_prospects`, confirmed still 404ing in production (same blocker as row #90). Actual generated output quality was **not** verified — the local `ANTHROPIC_API_KEY` is invalid (`401`), so no live Claude completion was obtained for this route either. |
| 119 | Outreach Sequence Builder | BUILT | Email campaign builder existing feature. |
| 120 | Corporate Outreach UI | PLANNED | One-click campaign generation per prospect. Phase 2. |

### Pillar 9: Donation Recommendation Marketplace
| # | Feature | Status | Notes |
|---|---|---|---|
| 121 | Marketplace Schema | PLANNED | marketplace_listings + marketplace_matches tables. Phase 3. |
| 122 | Donor Listing UI | PLANNED | Companies list available donations. Phase 3. |
| 123 | AI Match Engine | PLANNED | Nonprofit needs matched to available donations. Phase 3. |
| 124 | Request + Approval Flow | PLANNED | One-click request, donor approve/decline. Phase 3. |
| 125 | Donation Receipt Generator | PLANNED | IRS-compliant receipt on completion. Phase 3. |

### Pillar 10: National Disaster Response Engine
| # | Feature | Status | Notes |
|---|---|---|---|
| 126 | FEMA Integration | BUILT — VERIFIED | Per `AGENT_VERIFICATION_LOG.md` "AG-25" (July 30 2026): `pollFEMADeclarations()` confirmed real — fetches FEMA's live declarations API, dedupes against `disaster_declarations` before insert. Stale "IN BUILD/Tonight" wording corrected; this is the rare case where `AGENTS_v2.md`'s own characterization matched the code exactly, no drift found. |
| 127 | Emergency Fund Database | BUILT — VERIFIED | `disaster_emergency_funds`, matched by `deployDisasterResponse()` against declaration/incident type — confirmed by direct read. |
| 128 | Disaster Response Agent (AG-25) | BUILT — VERIFIED (manual-trigger only, no schedule) | `src/lib/agents/disaster-response-agent.ts` confirmed to exactly match its spec: two plain functions, no class, no `agent_runs`/`agent_decisions` row. Reachable only via the manual `src/app/api/agents/disaster/route.ts` (viewer-role GET, writer-role POST, org_id derived server-side). **Confirmed by grep of `worker/index.ts`, `worker/scheduler.ts`, `worker/autonomous-orchestrator.ts`, and `vercel.json`'s cron array: zero wiring exists for the "poll every 6 hours" schedule `BLUEPRINT_v2.md` §6 and `agent-registry-seed.ts` both describe** — that schedule is decorative/aspirational only, nothing executes it unattended. Also confirmed: the on-disk literal `"ag-25-deadline-prediction"` belongs to a completely different, unrelated agent (`DeadlinePredictionAgent`) — do not confuse the two when searching `agent_runs`/`agent_queue` for "AG-25" activity. |
| 129 | Disaster Response Dashboard | BUILT — UNVERIFIED | `/intelligence/disaster` page confirmed to exist at the expected path; not independently verified whether it calls the route correctly beyond file existence. |
| 130 | Auto-Deploy Response | PLANNED | Automatic campaign deployment on declaration. Phase 2. |

### Pillar 11: Predictive Funding Forecast
| # | Feature | Status | Notes |
|---|---|---|---|
| 131 | Forecast Schema | BUILT — VERIFIED (schema only, no producer) | Per `AGENT_VERIFICATION_LOG.md` "AG-26" (July 30 2026): `funding_forecasts` table confirmed real, created by `src/supabase/migrations/078_forecast_board.sql` (not migration "095" as this row previously claimed — a pre-existing doc-vs-reality drift, corrected here). Table has exactly one consumer confirmed by grep — `strategic-advisor-agent.ts` (AG-40) reads it defensively as one of its 7 input sources — but zero producers; nothing in the repo ever inserts/upserts into it, so it will always read empty in production until AG-26 (row #132) is built. |
| 132 | Forecast Agent (AG-26) | NOT-BUILT | Per `AGENT_VERIFICATION_LOG.md` "AG-26": confirmed zero agent code exists — no file, no class resembling `FundingForecastAgent`/`ForecastAgent` anywhere in `src/lib/agents/`. No API route or UI page exists either (unlike AG-25, which at least has a route+page despite no schedule). `agent-registry-seed.ts`'s `ag-26` cron entry is decorative Marketplace metadata only, never read by `worker/scheduler.ts`. Building this agent would light up an already-deployed downstream consumer (AG-40) with real data, per that agent's defensive read path. |
| 133 | Forecast Dashboard | NOT-BUILT | `/reports/forecast` confirmed absent — searched `src/app` for any `forecast`-named route/page, zero results. Consistent with PLANNED, restated as NOT-BUILT for clarity. |
| 134 | Market Trend Intelligence | PLANNED | Federal budget + foundation trend analysis. Phase 3. |

### Pillar 12: AI Board Advisor
| # | Feature | Status | Notes |
|---|---|---|---|
| 135 | Board Members Schema | IN BUILD | board_members + board_meetings tables. Tonight. |
| 136 | Meeting Packets Schema | IN BUILD | board_meeting_packets table. Tonight. |
| 137 | Board Packet Agent | PLANNED | Agent AG-27. 48-hour pre-meeting generation. Phase 2. |
| 138 | Board Member Portal | PLANNED | Per-member dashboard at /board/[id]. Phase 3. |
| 139 | Plain Language Financials | PLANNED | Jargon-free financial summary for board. Phase 3. |

### Pillar 13: Community Impact Simulator
| # | Feature | Status | Notes |
|---|---|---|---|
| 140 | Simulation Schema | IN BUILD | impact_simulations table. Tonight. |
| 141 | Simulation Agent | PLANNED | Agent AG-28. What-if modeling. Phase 4. |
| 142 | Simulator UI | PLANNED | /intelligence/simulate. Scenario builder. Phase 4. |

### Pillar 14: Funding Gap Analyzer
| # | Feature | Status | Notes |
|---|---|---|---|
| 143 | Eligibility Gap Detection | BUILT | Eligibility scoring existing feature. |
| 144 | Narrative Gap Analysis | PLANNED | KB completeness scoring vs funder requirements. Phase 2. |
| 145 | Geographic Gap Detection | PLANNED | Funder portfolio geographic analysis. Phase 2. |
| 146 | Gap Recommendations | PLANNED | Specific improvement actions per gap. Phase 2. |

### Pillar 15: Reputation Intelligence
| # | Feature | Status | Notes |
|---|---|---|---|
| 147 | Reputation Signal Schema | BUILT — VERIFIED | `reputation_signals` + `reputation_alerts` confirmed real and actively written by the live nightly path, per `AGENT_VERIFICATION_LOG.md` "AG-18" (July 30 2026). |
| 148 | Reputation Agent (AG-18) | BUILT — VERIFIED (plain-function path only) | Per `AGENT_VERIFICATION_LOG.md` "AG-18": the plain function `checkEntityReputation()` (`src/lib/intelligence/reputation-agent.ts`) is confirmed live and unchanged — nightly `runReputationStep()` (sampled to 5 funders/night) inserts `reputation_alerts` and escalates critical/high severity to an immediate alert; no `agent_decisions`/`relationship_memory` write on this path. **A second, undocumented implementation was found in the same file**: `ReputationIntelligenceAgent extends AutonomousAgent` (`agentId: "ag-18-reputation"`), which does log decisions and writes `relationship_memory` for HIGH/CRITICAL signals — but repo-wide grep confirms it is never instantiated anywhere, real but orphaned code (see row #199 for the registry-row correction this caused). Also confirmed: the manual `agent_queue` case `'reputation'` produces materially different, weaker behavior (no alert row, no notification, no org-scoping) than the nightly sweep — same function, different downstream effect depending on trigger path. |
| 149 | Reputation API | BUILT — VERIFIED | `/api/intelligence/reputation` confirmed as one of exactly three real call sites of `checkEntityReputation()`. |
| 150 | Reputation Monitor UI | BUILT — UNVERIFIED | `/intelligence/reputation` page — not independently visually verified this session. |
| 151 | Auto-Monitor on Add | PLANNED | Auto-enroll new funders in monitoring. Phase 2. |

### Pillar 16: Executive Command Center
| # | Feature | Status | Notes |
|---|---|---|---|
| 152 | Command Center Page | IN BUILD | /command-center. Owner/admin only. Tonight. |
| 153 | Real-Time Panel Updates | PLANNED | Supabase Realtime subscriptions. Phase 2. |
| 154 | Configurable Panel Layout | PLANNED | Drag-and-drop panel configuration. Phase 3. |
| 155 | TV/Projector Mode | PLANNED | Full-screen mode for board meetings. Phase 3. |

### Pillar 17: Agent Marketplace
| # | Feature | Status | Notes |
|---|---|---|---|
| 156 | Agent Registry Schema | IN BUILD | agent_registry + agent_configurations tables. Tonight. |
| 157 | Registry Seed Data | IN BUILD | 16 agents seeded. Tonight. |
| 158 | Registry API | IN BUILD | /api/agents/registry. Tonight. |
| 159 | Agent Marketplace UI | IN BUILD | /settings/agents. Enable/disable per agent. Tonight. |
| 160 | Agent Log Viewer | PLANNED | Per-agent run history and output. Phase 2. |

### Pillar 18: Funding Knowledge Engine
| # | Feature | Status | Notes |
|---|---|---|---|
| 161 | pgvector Extension | IN BUILD | Migration 097. Tonight. |
| 162 | Knowledge Patterns Table | IN BUILD | knowledge_patterns. Tonight. |
| 163 | Knowledge Engine Core | IN BUILD | src/lib/intelligence/knowledge-engine.ts. Tonight. |
| 164 | Knowledge Query API | IN BUILD | /api/intelligence/knowledge-query. Tonight. |
| 165 | Knowledge Engine UI | IN BUILD | /intelligence/knowledge. Tonight. |
| 166 | NIH RePORTER Ingestion | BUILT | scripts/ingest-nih-reporter.ts. Script exists, never run at scale. |
| 167 | NSF Awards Ingestion | BUILT | scripts/ingest-nsf-awards.ts. Script exists, never run at scale. |
| 168 | Federal Register Ingestion | BUILT | scripts/ingest-federal-register.ts. Script exists, never run at scale. |
| 169 | SAMHSA/HRSA Ingestion | BUILT | scripts/ingest-samhsa-hrsa.ts. Script exists, never run at scale. |
| 170 | Embedding Indexer Agent (AG-29, canonical) | NOT-BUILT (autonomous agent) — underlying capability BUILT-VERIFIED | Per `AGENT_VERIFICATION_LOG.md` "AG-29 (Knowledge Engine Indexer Agent)" (July 30 2026): no dedicated indexer *agent* exists — confirmed by grep, zero files matching `indexer`/`knowledge-engine`/`embed` in `src/lib/agents/`, not even a decorative `agent-registry-seed.ts` row. **Do not confuse with the differently-scoped "AG-29" in the Post-Launch Vision section (Fundability Scorer, row #217) — that is a real, built, unrelated Claude-text-analysis agent that happens to collide on the same number.** However, the underlying embedding capability this agent was meant to wrap is real and proven: `src/lib/intelligence/embeddings.ts`'s `generateEmbedding()`/`generateEmbeddingsBatch()` (OpenAI `text-embedding-3-small`) is live-verified — a direct production query of all 105 `intelligence_proposal_sections` rows found 105/105 with a real, non-null, 1536-dimension, content-varying embedding vector (not a placeholder). It is triggered only by manual CLI ingestion scripts and one manual API route (`/api/intelligence/ingest`), never a schedule or queue. The doc's claimed embedding location was also wrong: `intelligence_funded_proposals` has no `embedding` column at all (verified live); the real column is `intelligence_proposal_sections.embedding`. Building AG-29 as designed means wrapping this already-proven library in an `AutonomousAgent` subclass with a real call site — the embedding generation itself needs no further work. |
| 171 | RAG Integration in Draft Generator | PLANNED | Draft Generator pulls from Knowledge Engine before generating. Not directly covered by this session's verification pass — status unchanged. |

---

### Autonomous Agent Infrastructure
| # | Feature | Status | Notes |
|---|---|---|---|
| 187 | Autonomous Infrastructure Schema | BUILT | autonomous_triggers, agent_queue, agent_decisions, org_autonomous_config. Migration this session. |
| 188 | AutonomousAgent Base Class | BUILT | src/lib/agents/autonomous-base.ts. AUTONOMOUS_HARD_LIMITS. Decision logging. Chain support. |
| 189 | Autonomous Orchestrator (Railway) | BUILT | worker/autonomous-orchestrator.ts. 2AM nightly per-org pipeline. |
| 190 | Agent Queue Processor | BUILT | Continuous poll. Priority ordering. Retry logic with max_retries. |
| 191 | Autonomous Config API | BUILT | GET/PATCH /api/autonomous/config |
| 192 | Decision Log API | BUILT | GET/PATCH /api/autonomous/decisions |
| 193 | Queue Management API | BUILT | GET/DELETE /api/autonomous/queue |
| 194 | Manual Trigger API | BUILT | POST /api/autonomous/trigger |

### Autonomous Agents (18 agents upgraded)
| # | Feature | Status | Notes |
|---|---|---|---|
| 195 | AG-17 Autonomous Discovery | BUILT — BLOCKED (VERIFIED) | Corrected July 30 2026, see `AGENT_VERIFICATION_LOG.md` "AG-17" and row #83. The full perceive/decide/execute/observe implementation is real, but every trigger path fails live at `startRun()`'s `agent_runs` insert (`agent_type` enum rejects `"ag-17-discovery"`) — reproduced against production, not inferred. The described chain to AG-15 has never executed once in production; the fix migration exists in the repo but is not applied live. |
| 196 | AG-15 Autonomous Probability Scoring | BUILT — BLOCKED (VERIFIED) | Corrected July 30 2026, see `AGENT_VERIFICATION_LOG.md` "AG-15" and row #102. This unqualified "BUILT ... Threshold gate chains to AG-05" claim is false: `ProbabilityScoringAgent` (`agent_type: "ag-15-probability"`) fails on the first line of every `run()` — reproduced live against production (`22P02 invalid input value for enum agent_type`), confirmed current, not stale. Every trigger path (schedule, chain from AG-17/AG-02/AG-25, manual, queue) is blocked identically. The chain-routing gap documented elsewhere for this agent has since been fixed (`routeQueueItem()` now has a live case); the `agent_type` enum gap is the sole remaining, confirmed blocker. Do not confuse with the deterministic engine `computeGrantProbability()` (row #102), which is genuinely BUILT — VERIFIED and unaffected by this block. |
| 197 | AG-05 Autonomous Draft Generation | BUILT | Auto-drafts above threshold. pending_review=true. Never submits. |
| 198 | Autonomous Morning Digest | BUILT | 7AM AI briefing of overnight activity. |
| 199 | AG-18 Autonomous Reputation Intelligence | BUILT | Severity classification. Instant CRITICAL alerts. Correction, July 30 2026 (see AGENT_VERIFICATION_LOG.md "AG-18"): "Auto memory entries" does not describe the live path. That behavior (writing relationship_memory rows for HIGH/CRITICAL signals) exists only in a separate, undocumented `ReputationIntelligenceAgent` class (src/lib/intelligence/reputation-agent.ts, `agentId: "ag-18-reputation"`) that is never imported or instantiated anywhere outside its own file — the actual nightly path (worker/autonomous-orchestrator.ts's `runReputationStep()`) calls the plain `checkEntityReputation()` function directly and writes only reputation_signals + reputation_alerts + a critical-severity `alerts` row, with no relationship_memory write. Severity classification and instant CRITICAL alerts are accurate for the live path. |
| 200 | AG-19 Autonomous Relationship Builder | BUILT — BLOCKED (never wired) | Corrected July 30 2026, see `AGENT_VERIFICATION_LOG.md` "AG-19" and row #100. The real `RelationshipBuilderAgent` (Phase A scoring/recommendations + a substantial, previously-undocumented Phase B multi-hop warm-introduction pathfinder over `pig_nodes`/`pig_edges`) is real, 1,174 lines, far more built than "nightly scoring + momentum" describes — but repo-wide grep confirms it is never imported or instantiated anywhere outside its own file. `worker/autonomous-orchestrator.ts`'s own header comment confirms this is deliberate: it substitutes the unrelated, simpler Generation-1 `FunderRelationshipAgent` wherever "the relationship builder" is needed. What actually runs nightly (the event-delta scorer) does the scoring/momentum this row describes; the AI recommendation engine and warm-intro pathfinding described elsewhere do not run at all. A migration adding this agent's missing `agent_type` enum value exists (`096_ag19_relationship_builder_enum.sql`) but its live-in-production status is unconfirmed (session's live-DB probe was blocked by a tool-permission gate) — moot regardless, since nothing calls the class. |
| 201 | AG-25 Autonomous Deadline Prediction | BUILT | Pattern detection. Auto-creates projected opportunities at 90-day horizon. **Naming-collision warning** (per `AGENT_VERIFICATION_LOG.md` "AG-25"): this row's on-disk `agent_type` literal `"ag-25-deadline-prediction"` belongs to `DeadlinePredictionAgent`, an unrelated deadline-forecasting class — NOT the Disaster Response Agent also numbered AG-25 elsewhere in this document (see row #128, which was independently verified this session and found to exactly match its own spec, with no autonomous/nightly wiring at all). Searching `agent_runs`/`agent_queue` for "AG-25" surfaces this row's deadline-prediction activity, never disaster declarations. Not independently re-verified this pass beyond confirming the naming collision. |
| 202 | AG-28 Autonomous Follow-Up Generator | BUILT | Event-driven on stage transitions. Never sends directly. |
| 203 | AG-02 Autonomous Eligibility Scoring | BUILT | Auto-scores new discoveries. Chains qualified opps to AG-15. |
| 204 | AG-03 Autonomous Deadline Extraction | BUILT | Creates deadline records for all new opportunities. |
| 205 | AG-07 Autonomous Compliance Check | BUILT | Event-driven on ready_for_review. Blocks non-compliant applications. |
| 206 | AG-04 Autonomous Fit Analysis | BUILT | Fires at eligibility >= 70. Creates discovered-stage application. |
| 207 | AG-06 Autonomous Budget Builder | BUILT | Event-driven on drafting stage. Generates budget for human review. |
| 208 | AG-08 Renewal Tracker | BUILT | Monthly. Auto-creates renewal opportunity records for recurring grants. |
| 209 | AG-09 Outcome Analyzer | BUILT | Weekly + event-driven. Updates analytics and proven narrative status. |
| 210 | AG-10 Document Expiry Monitor | BUILT | Nightly. 30-day expiry notifications. |
| 211 | AG-11 Knowledge Gap Detector | BUILT | Weekly. Identifies missing KB categories with specific fill-in prompts. |
| 212 | AG-12 Search Profile Optimizer | BUILT | Monthly. Performance analysis and keyword improvement suggestions. |

### Autonomous UI
| # | Feature | Status | Notes |
|---|---|---|---|
| 213 | Autonomous Settings Panel | BUILT | /settings/agents — per-org toggle controls + threshold slider. |
| 214 | Decision Log UI | BUILT | Timeline view, approve/reject interface, pagination. |
| 215 | Dashboard 24h Activity Feed | BUILT | Live autonomous activity panel on main dashboard. |
| 216 | Autonomous Draft Review Page | BUILT | /draft-generator/autonomous — pending review queue. |

### Post-Launch Vision (Phases 2-5)
| # | Feature | Status | Notes |
|---|---|---|---|
| 217 | Fundability Intelligence Score | BUILT — UNVERIFIED | Phase 2. `FundabilityScorerAgent` (`agentId: "ag-29-fundability"`), `/api/intelligence/fundability`, opportunity detail panel. **Numbering-collision note, confirmed per `AGENT_VERIFICATION_LOG.md` "AG-29"**: this agent's `ag-29-fundability` literal collides with, but is a completely different agent from, the canonical AG-29 = Knowledge Engine Indexer Agent (row #170, embeddings/pgvector). Do not conflate the two when auditing "is AG-29 built" — this row's agent does real Claude text analysis; row #170's does not exist as an autonomous agent at all. Not independently re-verified for functional correctness this pass. |
| 218 | AI Donor Intent Engine | BUILT — BLOCKED (VERIFIED) | `donor-intent-monitor-agent.ts` (`agentId: "ag-30-donor-intent"`) + `/api/intelligence/donor-intent` + page. Per `AGENT_VERIFICATION_LOG.md` "AG-30" (July 30 2026): confirmed live and current — the exact `agent_runs` insert this agent's `startRun()` performs was reproduced against production and fails with `22P02 invalid input value for enum agent_type: "ag-30-donor-intent"`. Zero rows exist, ever, in `agent_runs` for this agent_type or in its real output table `corporate_intent_signals` — not "hasn't run since the Railway outage," but has never once completed a run. A migration adding the missing enum value exists only in `src/supabase/migrations/093_donor_intent_engine.sql`, unconfirmed live. **Do not confuse with the canonical AG-30 = "Change Monitor Agent (CM-01)"** (row #96), a completely different, still wholly unbuilt concept that happens to share the AG-30 number. |
| 219 | AutoApply Full Autonomous Mode | BUILT | Phase 2. Nightly batch queuer (migration 092, worker/autoapply-autonomous-orchestrator.ts) + /autoapply/controls Autonomous Mode panel + /autoapply Autonomous Queue section. |
| 220 | Corporate Relationship Graph | BUILT — BLOCKED (VERIFIED) | Phase 3. AG-32 (src/lib/agents/relationship-graph-builder-agent.ts) + /api/intelligence/relationship-graph + /intelligence/relationship-graph UI. Reads pig_nodes/pig_edges, not a corporate_relationships table (none exists — see agent file header). Discovery run blocked at runtime by the agent_type enum gap (AGENTS_v2.md §1.2) until a migration adds 'ag-32-relationship-graph' — confirmed by direct read of the file's own header, not independently re-probed live this pass (see `AGENT_VERIFICATION_LOG.md` "AG-23," which cross-checked this file's header and identity claim but did not re-run the enum-insert reproduction). PIG Phase 2: /api/intelligence/relationship-graph/analytics + Graph Analytics panel. **Confirmed per `AGENT_VERIFICATION_LOG.md` "AG-23" (July 30 2026): this is the real, substantive implementation of the RA-01/AG-23 "Relationship Mapper" concept** (rows #80, #95), built under a different number by explicit design choice — the file's own header states this outright, and `AGENTS_v2.md`'s own Phase 2-5 section independently corroborates it as "an AG-23 full weekly rebuild," matching the weekly Sunday cron in `agent-registry-seed.ts`'s decorative metadata (not `BLUEPRINT_v2.md` §6's "nightly incremental" framing, which does not correspond to any code and should be corrected in a future BLUEPRINT_v2.md pass). Rows #80/#95 should cross-reference this row rather than stand alone as PLANNED/NOT-BUILT. |
| 221 | Donor Personalization Engine | PLANNED | Phase 3. Adaptive content by visitor type. |
| 222 | Community Need Prediction | BUILT | Phase 3. AG-35 agent + /api/intelligence/community-need + /intelligence/community-need UI. |
| 223 | Global Learning Network | BUILT | AG-36 aggregator writes platform_learning_patterns (migration 083); draft-generation-agent.ts now queries it pre-draft, injects matched patterns into the Claude prompt, tracks applications.platform_patterns_applied (migration 084), and boosts confidence up to +20 for high-confidence patterns. /intelligence/learning-network dashboard (stats + pattern table) reads it via GET /api/intelligence/learning-network. Org-side NTEE matching not possible yet -- organizations has no ntee_code column, so matching is funder_category + platform-wide (ntee_code IS NULL) patterns only. AG-36 itself (src/lib/agents/learning-network-aggregator-agent.ts, 905 lines, class LearningNetworkAggregatorAgent) is real code but is never imported or called anywhere in src/ or worker/ -- confirmed by repo-wide grep July 19, 2026, see AGENTS_v2.md AG-36 spec. The write path this row describes has no live trigger; platform_learning_patterns is currently populated only by whatever seeded it previously, not by this agent running. |
| 224 | Predictive Fundraising Simulator | BUILT | Phase 4. Scenario builder + 3-year projection UI at /reports/simulate, backed by /api/reports/simulate (AG-37 SimulationAgent). |
| 225 | Autonomous Continuous Improvement Engine | BUILT — BLOCKED (VERIFIED) | Phase 4. AG-38 (src/lib/agents/self-improvement-agent.ts) + /admin/improvements review UI + agent_performance_metrics dashboard. Noted here for consistency because it was directly tested alongside AG-30 in `AGENT_VERIFICATION_LOG.md` "AG-30" (July 30 2026), even though AG-38 falls outside this session's core AG-15–AG-30 scope: the exact `agent_runs` insert this agent performs was reproduced live against production and fails identically (`22P02`, `agent_type: "ag-38-self-improvement"` not a valid enum value). Zero rows exist, ever, in `agent_runs`, `improvement_proposals`, or `agent_performance_metrics` for this agent — confirmed via `Prefer: count=exact`, not an empty-page artifact. The missing enum value's migration (`088_self_improvement_agent.sql`) exists only in `src/supabase/migrations/`, unconfirmed live. The now-resolved Railway worker billing outage is not the cause and did not fix this — the failure is at the database layer, before the worker's own logic runs. |
| 226 | Community Resource Graph | PLANNED | Phase 4. Need-to-resource pathfinding. |
| 227 | ROI Optimization Engine | BUILT | Phase 5. /reports/roi dashboard + /api/reports/roi ??? AG-39 roi_insights + submission_variables aggregation. Only the telemetry half is live: RoiOptimizerAgent.trackSubmissionVariables() is called from /api/autonomous/track-submission/route.ts and does write submission_variables. Its run() method -- the Claude-calling monthly correlation pass that writes roi_insights -- has no production call site (confirmed by repo-wide grep July 19, 2026, see AGENTS_v2.md AG-39 spec); the /reports/roi dashboard reads a table that nothing currently populates. |
| 228 | AI Strategic Advisor | BUILT | Phase 5. Command center at /intelligence/strategic-advisor, backed by /api/intelligence/strategic-advisor (AG-40 StrategicAdvisorAgent). Dashboard widget + nav badge wired. |

---

## Data Pipeline Features (Separate from UI Features)

| # | Feature | Status | Notes |
|---|---|---|---|
| D1 | IRS BMF Full Import | BUILT | pnpm ingest:bmf. nonprofits table has 1,978,526 records live (verified via check-enrichment-detailed.ts, July 22 2026). |
| D2 | IRS 990 Stream Parser | PARTIAL | Script exists. EIN column bug confirmed. Fix in last FORGE queue. |
| D3 | ProPublica Batch Enrichment | BUILT | Script exists. Never run against full 133K foundation records. |
| D4 | 298K Prospect CSV Import | PLANNED | Source: D:\dataocean. scripts/import-prospects.ts exists. Never run. |
| D5 | Intelligence Library Corpus | PARTIAL | 11 NIH proposals loaded. Nights 2-7 never run. Dedup fix applied. |
| D6 | Foundation Website Scraper | BUILT | Superseded by S1/S2 below (StealthEngine + foundation-scraper.ts), not the older 54K-URL-list concept this row originally described. As of July 28 2026: the IRS 990 XML fetch bug (dead S3 fallback + browser-rendered XML viewer instead of a raw fetch, commit 52dd3ce) is fixed, and a real run tonight is confirmed parsing at an 8/10 success rate. Still not run at the full 133,812-record foundation_directory scale — see Directive 1 in STANDING_DIRECTIVES.md. |
| D7 | DATAOCEAN Backup | CRITICAL | enrichment-output/ NEVER backed up to D:\. Reruns overwrite. |

---

## Scraper Features (Directive 1 — Stealth Enrichment Engine)

| # | Feature | Description | Status |
|---|---|---|---|
| S1 | Stealth Engine Core | src/lib/scraper/stealth-engine.ts — shared Playwright/Chromium engine used by both scrapers below: header consistency (realistic per-request header sets), cookie jar persistence across navigations, honeypot-field avoidance, and response verification (confirms the page actually returned the expected content before treating a fetch as successful). | BUILT |
| S2 | Foundation Enrichment Scraper | src/lib/scraper/foundation-scraper.ts — StealthEngine-based waterfall (homepage fetch -> contact-page discovery -> extraction) against foundation_directory. Wired into worker/scheduler.ts's `foundation-enrichment-weekly` job (Sunday 3AM CST, gated behind `ENABLE_SCRAPER=true`) and surfaced on the dashboard via S5. | BUILT |
| S3 | Nonprofit Contact Scraper | src/lib/scraper/nonprofit-scraper.ts — StealthEngine sibling to foundation-scraper.ts, targeting `nonprofits WHERE website IS NOT NULL AND contact_emails IS NULL` (~6,066 rows as of 2026-07-27). Writes contact_emails/officer_email/phone, COALESCE-style so it never clobbers other enrichment passes. **Updated July 28 2026:** now also wired into worker/scheduler.ts as `nonprofit-enrichment-weekly` (Sunday 4AM CST, staggered 1hr after foundation-enrichment-weekly, same `ENABLE_SCRAPER` gate), commit 899567f — no longer CLI-only, though `scripts/run-nonprofit-scraper.ts` remains available for manual runs too. | BUILT |
| S4 | Scraper Railway Worker Job | worker/scheduler.ts — two weekly jobs, both gated behind `ENABLE_SCRAPER`: `foundation-enrichment-weekly` (Sunday 3AM CST, Foundation Enrichment Scraper / S2) and `nonprofit-enrichment-weekly` (Sunday 4AM CST, Nonprofit Contact Scraper / S3, added July 28 2026 per commit 899567f). Both scrapers now have scheduler integration. | BUILT |
| S5 | Scraper Status API | /api/scraper/status — GET route (viewer-role gated) reporting live `foundation_directory` enrichment counts/rate computed from the DB, plus best-effort last-run stats from a local `enrichment-output/scraper-stats.json` file (null when unavailable) and the next scheduled Sunday-3AM-CST run time. Foundation-directory-scoped only, matching S2/S4. | BUILT |

---

## Universal Scraper (UNIVERSAL_SCRAPER_PRD.md, build steps uscraper-001 through 007 — July 28 2026)

Ground-up replacement architecture per `UNIVERSAL_SCRAPER_PRD.md`: keyword + schema in, structured JSON out, regardless of source format. Distinct from the Directive-1 scrapers above (S1-S5), which remain in place as-is (not superseded). Status calls below are strict about what "verified against real data" actually covered this session — see `STATE_OF_THE_BUILD.md`'s uscraper session entries for full detail per step.

| # | Feature | Description | Status |
|---|---|---|---|
| US1 | scrape_jobs/scrape_results schema | `supabase/migrations/110_scrape_jobs_universal_scraper.sql` (commit a3378c5) — generic job/result tables per PRD §3.4, service-role-only RLS, no `organization_id` (platform infra, not per-org). File committed; **not confirmed applied to production** — same DDL-credential gap as migrations 051/052/107 (Management API PAT still 401, no other DDL path found). | PARTIAL — file only, DB apply pending Reid's manual SQL Editor access |
| US2 | Elite stealth stack install + smoke test | Installed `camoufox-js`, `rebrowser-patches`, `fingerprint-generator`, `ghost-cursor` per PRD §3.2 (commit edad095). `camoufox-js` **confirmed non-functional on this machine**: segfaults inside its unconditional `sampleWebGL()` call, root-caused to `better-sqlite3`'s native binary crashing on `new Database()` under Node 20.20.2 (camoufox-js declares `node >=22`). `rebrowser-patches` + `ghost-cursor` layered on the existing Playwright `stealth-engine.ts` confirmed working as the real fallback stack — this is what US3 actually built on. | PARTIAL — primary engine (camoufox-js) blocked/non-functional; working fallback stack identified and used downstream |
| US3 | UniversalFetcher browser layer | `src/lib/scraper-v2/universal-fetcher.ts` (commit f4a455c) — Playwright/Chromium + puppeteer-extra-plugin-stealth + fingerprint-generator + ghost-cursor + Crawlee SessionPool (the US2 fallback stack, not camoufox-js). **Verified live** against 3 real, varied targets (apnews.com, kingarthurbaking.com, irs.gov) via `scripts/test-universal-fetcher.ts` — all 3 fetched successfully, real content lengths 153K-2.3M chars, no cherry-picking. `pnpm tsc --noEmit` — 0 errors. | BUILT — verified against real fetches |
| US4 | Schema-flexible extraction layer | `src/lib/scraper-v2/extractor.ts` + `src/lib/scraper-v2/discovery.ts` (commit 0916efd) — Readability/jsdom strips page chrome, Claude forced via `tool_choice` to report only fields it can genuinely find in the caller's schema, missing fields explicitly nulled rather than fabricated. **Verified live** against 2 real pages (kingarthurbaking.com, crema-coffee.com found via `discoverUrls()`) with a business_name/phone/address schema — every non-null field returned was grepped back against the raw fetched HTML and confirmed present verbatim; absent fields came back null. jsdom pinned to 25.0.1 (30.x crashes on Node 20). | BUILT — verified against real pages, real HTML cross-check |
| US5 | Full pipeline wiring + CLI | `scripts/run-universal-scraper.ts` (commit 03a49cb, `pnpm scrape:universal`) wires discovery -> fetch -> extract into a CLI writing to scrape_jobs/scrape_results. **Verified end-to-end**: `--keyword "vegan bakeries Austin" --schema '{"name":"string","address":"string","website":"string"}' --limit 5` — 5 real URLs discovered via DuckDuckGo (Google/Bing blocked that run), 3 fetched+extracted with genuine non-null fields, 2 blocked (Yelp 403). Since migration 110 (US1) isn't live yet, all 6 records (1 job + 5 results) were written as mock JSON under `scrape-output/` (gitignored, confirmed present on disk) rather than the DB — the script logs this loudly on every mock write, never silently. Real DB writes start automatically once US1 is applied, no code change needed. | BUILT — verified end-to-end, DB writes pending US1 |
| US6 | Foundation-990 job template | `src/lib/scraper-v2/templates/foundation-990-template.ts` + `src/lib/scraper-v2/job-store.ts` (shared job/result persistence, generalized out of US5's CLI) + `scripts/run-foundation-990-template.ts` (`pnpm scrape:foundations-v2`). Re-hosts the proven batch-ZIP EIN->filing lookup from `foundation-scraper.ts` (now-exported `buildEinIndex`/`tryIrs990`/`EnginePool`, zero behavior change to the existing standalone scraper) as a custom discovery source; deliberately keeps the existing deterministic `IRS990Source.parseXml()` for extraction instead of routing through US4's Claude/Readability extractor, since 990 e-file XML is already rigidly tagged and Readability would strip those tags and make results worse, not better (reasoning documented in-file). `pnpm tsc --noEmit` — 0 errors. **Not yet run**: these files are untracked/uncommitted, and no `scrape-output/` record or `foundation_directory` write matching this template's job keyword exists — the only nearby checkpoint files (`enrichment-output/scraper-checkpoint.json`/`scraper-stats.json`, processed 60/enriched 14) predate this template's files by over an hour and are leftover state from the pre-existing standalone `pnpm scrape:foundations` CLI, not this template. | PARTIAL — code complete and type-checks clean, zero real-data verification yet, uncommitted |
| US7 | Nonprofit-contact job template | `src/lib/scraper-v2/templates/nonprofit-contact-template.ts` + `scripts/run-nonprofit-contact-template.ts` (`pnpm scrape:nonprofits-v2`). Unlike US6, uses all three universal layers unmodified — `discoverUrls()` scoped per-nonprofit via `targetDomain`, `UniversalFetcher.fetchPage()`, `extractStructured()` — replacing the old sibling `nonprofit-scraper.ts`'s fixed regex email/phone extraction with genuine schema-flexible extraction, the actual upgrade this target type calls for. Targets `nonprofits WHERE website IS NOT NULL AND contact_emails IS NULL AND revenue_amount >= 750000`, COALESCE-style writes. `pnpm tsc --noEmit` — 0 errors. **Not yet run**: untracked/uncommitted, no `scrape-output/` record or `nonprofits` write matching this template exists. | PARTIAL — code complete and type-checks clean, zero real-data verification yet, uncommitted |

**Net status:** the 3 general-purpose pipeline layers (US3/US4/US5 — fetch, extract, end-to-end CLI) are genuinely proven against real, varied live targets this session, not just compile-verified. The 2 pre-configured templates meant to replace/extend the Directive-1 scrapers under this architecture (US6/US7) are written and type-check but have never been executed — do not treat them as equivalent-to or better-than the existing S2/S3 scrapers until a real batch run against `foundation_directory`/`nonprofits` is captured. The schema they all depend on for real (non-mock) persistence (US1) is not yet live in production.

---

## Testing Features

| # | Feature | Status | Notes |
|---|---|---|---|
| T1 | Jest Unit Tests | BUILT | src/__tests__/unit/ — success probability, semantic matcher, board report. |
| T2 | Smoke Tests | BUILT | src/__tests__/smoke/ — 5 critical API routes. |
| T3 | GitHub Actions Daily Workflow | BUILT | .github/workflows/daily-tests.yml — 11PM CST (5AM UTC). |
| T4 | E2E Tests | PLANNED | Playwright — login, create opportunity, generate draft. |
| T5 | Visual Regression Tests | PLANNED | Playwright screenshot vs baseline. |
| T6 | DB Migration Tests | PLANNED | Idempotency verification per migration. |
| T7 | Soak Tests | PLANNED | Enrichment engine under sustained load. |
| T8 | Cross-Browser Tests | PLANNED | Chrome, Firefox, Safari (webkit). |

---

## UI Redesign Status

| Page/Component | Status | Notes |
|---|---|---|
| Dashboard | IN PROGRESS | Hero banner, HUD, Action Items working. Layout complete. Illustration positioning needs refinement. |
| FlightPathHUD | BUILT | 6 colored cards, flip animation, stage accent colors. |
| Sidebar | PARTIAL | Deep navy #1A2B3C. Active state needs confirmation. |
| Opportunities page | PLANNED | Probability badges + sort by score. Tonight's queue. |
| All other pages | PLANNED | One component per CC session. Post-dashboard queue. |

**The One UI Rule:** All colors, backgrounds, shadows, borders must use inline `style={{}}` with hardcoded hex values. Never CSS variables or Tailwind color classes.

---

## Summary

| Category | Total | Built | Partial | In Build | Planned |
|---|---|---|---|---|---|
| Phase 1 MVP | 18 | 18 | 0 | 0 | 0 |
| Tier 1-3 Enhancements | 21 | 21 | 0 | 0 | 0 |
| Tier 4 Browser Automation | 7 | 7 | 0 | 0 | 0 |
| Tier 5 SaaS Layer | 6 | 6 | 0 | 0 | 0 |
| Tier 6 Full Autonomous | 26 | 20 | 2 | 0 | 4 |
| Platform Vision Pillars | 93 | 11 | 2 | 34 | 46 |
| Data Pipeline | 7 | 3 | 2 | 0 | 2 |
| Scraper (Directive 1) | 5 | 5 | 0 | 0 | 0 |
| Universal Scraper (uscraper-001-007) | 7 | 3 | 4 | 0 | 0 |
| Testing | 8 | 3 | 0 | 0 | 5 |
| **TOTAL** | **198** | **97** | **10** | **34** | **57** |

**Note on the July 30, 2026 agent-verification update:** the AG-15–AG-30 rows above (and their
Post-Launch Vision cross-references, #217/#218/#220/#225) now use the finer-grained BUILT — VERIFIED
/ BUILT — UNVERIFIED / BUILT — BLOCKED (VERIFIED) / NOT-BUILT tiers defined in the Status Key rather
than the plain five-category scheme this Summary table counts against. The integer counts below
were not recomputed against those finer tiers (doing so precisely would require re-auditing every
row in every table, not just the ~25 rows this pass touched) — treat this Summary table as
approximate for the Platform Vision Pillars / Autonomous Agents / Post-Launch Vision sections until a
full recount is done. The row-level detail above is the authoritative, current source for AG-15
through AG-30's real status; this table is not.

**Infrastructure:**
- Database tables: 67 (097 migrations applied or queued)
- AI Agents: 30 designed (7 Phase 1, 7 Phase 2, 16 Phase 3 new)
- API routes: 208+
- Pages: 99+
- FORGE prompts executed: 130+
