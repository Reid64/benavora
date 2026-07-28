# BENAVORA — Feature Registry v2.0
## Supersedes: Feature_Registry.md v1.0
## Date: July 28, 2026 (last update)
## Status: CANONICAL — Updated after every FORGE run and CC session.
## Build tool: FORGE 1.x | Repo: Reid64/benavora | Production: www.benavora.com

---

## Status Key

| Status | Meaning |
|---|---|
| BUILT | Fully implemented, compile-verified, deployed to production |
| PARTIAL | Core functionality built, gaps documented below |
| IN BUILD | Currently in active FORGE queue or overnight run |
| PLANNED | Scoped and architected, not yet in a queue |
| DEFERRED | Explicitly postponed to a future phase |

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
| 80 | Relationship Discovery Engine | PLANNED | Agent RA-01. Nightly traversal. Phase 3 build. |
| 81 | Relationship Explorer UI | PLANNED | /research/graph. Force-directed visualization. Phase 3 build. |
| 82 | Path Finder | PLANNED | Shortest path between any two entities. Phase 3 build. |

### Pillar 2: AI Opportunity Discovery Engine
| # | Feature | Status | Notes |
|---|---|---|---|
| 83 | Discovery Agent Core | IN BUILD | src/lib/agents/opportunity-discovery-agent.ts. Tonight's queue. |
| 84 | Morning Digest | IN BUILD | src/lib/agents/morning-digest.ts. Tonight's queue. |
| 85 | Personalized Match Feed | PLANNED | Per-org scoring against Digital Twin. Phase 2 build. |
| 86 | Discovery Preferences | PLANNED | User-configurable source and category filters. Phase 2 build. |

### Pillar 3: Corporate Giving Intelligence
| # | Feature | Status | Notes |
|---|---|---|---|
| 87 | Corporate Prospects Table | BUILT (unverified live) | Correction, July 28 2026: no migration in the 076-084 range actually creates corporate_prospects — the real creating file is `supabase/migrations/107_corporate_prospects.sql`, added this session (post-dates MIGRATION_AUDIT.md's 108-file/106-highest-numbered pass, so it wasn't covered by that audit). Whether 107 has been applied to production is unconfirmed; a direct REST check on 2026-07-20 found this table absent (404/PGRST205). Treat as schema-defined, not confirmed live, until re-checked. |
| 88 | NAICS Consumer UI | BUILT | /donor-discovery/discover + NAICS labels. naics-labels.ts. |
| 89 | Google Places Adapter | BUILT | Existing donor discovery pipeline. |
| 90 | Corporate Enrichment Agents EA-01 to EA-10 | BUILT | All 10 real, substantive agents exist (src/lib/agents/ea-01-giving-detector.ts through ea-10-social-media-analyzer.ts, 136-179 lines each, commits 366b33d + a5a004b, July 28 2026) — correcting an earlier premise that only EA-01/EA-08/EA-09 were built; verified directly against the repo this session, all 10 exist and none are stubs. worker/enrichment-processor.ts (commit dfe1190) imports and runs all 10 sequentially per company per CORPORATE_INTELLIGENCE_ARCHITECTURE.md §2C, each self-gating on its documented dependency via the shared enrichment jsonb. **Caveat:** this orchestrator is not yet called from worker/index.ts's boot sequence — it runs standalone/on-demand only, not continuously in production yet. **Bigger caveat:** the target table, corporate_prospects, only gained a creating migration this session (107_corporate_prospects.sql) — whether it has actually been applied to production is unverified (same DDL-access blocker as migrations 051/052, see MIGRATION_AUDIT.md), and a direct REST check on 2026-07-20 found this table returned 404/PGRST205 (did not exist). Do not assume this pipeline can write anywhere in prod until 107 is confirmed applied. |
| 91 | Propensity Scoring PS-01 to PS-10 | BUILT | src/lib/agents/ag-22-propensity-scoring.ts (PropensityScoringAgent), commit bc39187, July 28 2026 — computes PS-01 through PS-10 per the canonical CORPORATE_INTELLIGENCE_ARCHITECTURE.md §3 formula into corporate_prospects.scores, refreshes the top-100 priority_prospects ranking. Wired as the enrichment pipeline's Score Engine call (triggerScoreEngine() in worker/enrichment-processor.ts), fired after enrichment_completed_at is stamped. Same two caveats as Feature #90 apply: not in worker/index.ts's boot loop, and the target table's live-in-prod status is unconfirmed. |
| 92 | Corporate Giving DNA | PLANNED | Profile per company. Phase 2 build. |
| 93 | AutoApply Routing | BUILT | /api/donor-discovery/prospects/[id]/route-to-autoapply |
| 94 | Email Campaign Routing | BUILT | /api/donor-discovery/prospects/[id]/route-to-email |
| 95 | Relationship Mapper RA-01 | PLANNED | pig_edges population agent. Phase 3. |
| 96 | Change Monitor CM-01 | PLANNED | Re-enrichment scheduler. Phase 5. |
| 97 | Corporate Marketplace | PLANNED | Prospect search UI + filter engine. Phase 2. |

### Pillar 4: Autonomous Relationship Builder
| # | Feature | Status | Notes |
|---|---|---|---|
| 98 | Relationship Memory | IN BUILD | relationship_memory table. Migration 093 tonight. |
| 99 | Signal Monitoring | PLANNED | LinkedIn + news + 990 watching. Phase 2 build. |
| 100 | Recommendation Engine | IN BUILD | relationship_recommendations table. Agent AG-19 designed. |
| 101 | Relationship Builder UI | PLANNED | /funders/[id]/relationship view. Phase 2 build. |

### Pillar 5: Grant Probability Engine
| # | Feature | Status | Notes |
|---|---|---|---|
| 102 | Probability Scoring Engine | IN BUILD | src/lib/intelligence/grant-probability-engine.ts. Tonight. |
| 103 | Probability API Route | IN BUILD | /api/intelligence/grant-probability. Tonight. |
| 104 | Batch Score Runner | IN BUILD | scripts/batch-score-opportunities.ts. Tonight. |
| 105 | Probability Badges on Opportunities | IN BUILD | Color-coded score display + sort/filter. Tonight. |
| 106 | Factor Breakdown UI | PLANNED | Expandable score explanation per opportunity. Phase 2. |

### Pillar 6: Organizational Digital Twin
| # | Feature | Status | Notes |
|---|---|---|---|
| 107 | Digital Twin Builder | IN BUILD | src/lib/intelligence/digital-twin-builder.ts. Tonight. |
| 108 | Digital Twin API | IN BUILD | /api/intelligence/digital-twin. Tonight. |
| 109 | Digital Twin Profile Page | IN BUILD | /intelligence/twin. Tonight. |
| 110 | Twin-Powered Draft Generation | BUILT | AG-05 draft-generation-agent.ts reads organizational_digital_twins (migration 094) before generating; applications.twin_powered/twin_completeness recorded per draft. /intelligence/twin shows completeness score + section breakdown; /draft-generator/autonomous shows Twin-Powered badge + low-completeness warning. |
| 111 | Twin Completeness Score | IN BUILD | 10-factor completeness indicator. Tonight. |

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
| 118 | Personalized Outreach Generator | PLANNED | Agent AG-24. AI-individualized per-company emails. Phase 2. |
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
| 126 | FEMA Integration | IN BUILD | disaster_declarations table + FEMA API polling. Tonight. |
| 127 | Emergency Fund Database | IN BUILD | disaster_emergency_funds table. Tonight. |
| 128 | Disaster Response Agent | IN BUILD | src/lib/agents/disaster-response-agent.ts. Tonight. |
| 129 | Disaster Response Dashboard | IN BUILD | /intelligence/disaster page. Tonight. |
| 130 | Auto-Deploy Response | PLANNED | Automatic campaign deployment on declaration. Phase 2. |

### Pillar 11: Predictive Funding Forecast
| # | Feature | Status | Notes |
|---|---|---|---|
| 131 | Forecast Schema | IN BUILD | funding_forecasts table. Migration 095 tonight. |
| 132 | Forecast Agent | PLANNED | Agent AG-26. Monthly computation. Phase 2. |
| 133 | Forecast Dashboard | PLANNED | /reports/forecast. 90-day + 12-month view. Phase 2. |
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
| 147 | Reputation Signal Schema | IN BUILD | reputation_signals + reputation_alerts tables. Tonight. |
| 148 | Reputation Agent | IN BUILD | src/lib/intelligence/reputation-agent.ts. Tonight. |
| 149 | Reputation API | IN BUILD | /api/intelligence/reputation. Tonight. |
| 150 | Reputation Monitor UI | IN BUILD | /intelligence/reputation page. Tonight. |
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
| 170 | Embedding Indexer Agent | PLANNED | Agent AG-29. Nightly pgvector embedding population. Phase 2. |
| 171 | RAG Integration in Draft Generator | PLANNED | Draft Generator pulls from Knowledge Engine before generating. Phase 2. |

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
| 195 | AG-17 Autonomous Discovery | BUILT | Nightly. Decision log. Chains to AG-15. |
| 196 | AG-15 Autonomous Probability Scoring | BUILT | Post-discovery or scheduled. Threshold gate chains to AG-05. |
| 197 | AG-05 Autonomous Draft Generation | BUILT | Auto-drafts above threshold. pending_review=true. Never submits. |
| 198 | Autonomous Morning Digest | BUILT | 7AM AI briefing of overnight activity. |
| 199 | AG-18 Autonomous Reputation Intelligence | BUILT | Severity classification. Instant CRITICAL alerts. Auto memory entries. |
| 200 | AG-19 Autonomous Relationship Builder | BUILT | Nightly scoring + momentum. AI recommendations when score >= 40. |
| 201 | AG-25 Autonomous Deadline Prediction | BUILT | Pattern detection. Auto-creates projected opportunities at 90-day horizon. |
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
| 217 | Fundability Intelligence Score | BUILT | Phase 2. AG-29 FundabilityScorerAgent, /api/intelligence/fundability, opportunity detail Fundability Intelligence panel. |
| 218 | AI Donor Intent Engine | BUILT | AG-30. src/lib/agents/donor-intent-monitor-agent.ts + /api/intelligence/donor-intent + /intelligence/donor-intent page. |
| 219 | AutoApply Full Autonomous Mode | BUILT | Phase 2. Nightly batch queuer (migration 092, worker/autoapply-autonomous-orchestrator.ts) + /autoapply/controls Autonomous Mode panel + /autoapply Autonomous Queue section. |
| 220 | Corporate Relationship Graph | BUILT | Phase 3. AG-32 (src/lib/agents/relationship-graph-builder-agent.ts) + /api/intelligence/relationship-graph + /intelligence/relationship-graph UI. Reads pig_nodes/pig_edges, not a corporate_relationships table (none exists — see agent file header). Discovery run blocked at runtime by the agent_type enum gap (AGENTS_v2.md §1.2) until a migration adds 'ag-32-relationship-graph'. PIG Phase 2: /api/intelligence/relationship-graph/analytics + Graph Analytics panel on the relationship-graph page (node/edge counts, top-connected nodes, top foundations by connection count, cross-rule pattern detection). Note: this task referenced "feature 221 / PIG full build" but #221 is Donor Personalization Engine (unrelated) — the real PIG feature is this row; left #221 untouched. |
| 221 | Donor Personalization Engine | PLANNED | Phase 3. Adaptive content by visitor type. |
| 222 | Community Need Prediction | BUILT | Phase 3. AG-35 agent + /api/intelligence/community-need + /intelligence/community-need UI. |
| 223 | Global Learning Network | BUILT | AG-36 aggregator writes platform_learning_patterns (migration 083); draft-generation-agent.ts now queries it pre-draft, injects matched patterns into the Claude prompt, tracks applications.platform_patterns_applied (migration 084), and boosts confidence up to +20 for high-confidence patterns. /intelligence/learning-network dashboard (stats + pattern table) reads it via GET /api/intelligence/learning-network. Org-side NTEE matching not possible yet -- organizations has no ntee_code column, so matching is funder_category + platform-wide (ntee_code IS NULL) patterns only. AG-36 itself (src/lib/agents/learning-network-aggregator-agent.ts, 905 lines, class LearningNetworkAggregatorAgent) is real code but is never imported or called anywhere in src/ or worker/ -- confirmed by repo-wide grep July 19, 2026, see AGENTS_v2.md AG-36 spec. The write path this row describes has no live trigger; platform_learning_patterns is currently populated only by whatever seeded it previously, not by this agent running. |
| 224 | Predictive Fundraising Simulator | BUILT | Phase 4. Scenario builder + 3-year projection UI at /reports/simulate, backed by /api/reports/simulate (AG-37 SimulationAgent). |
| 225 | Autonomous Continuous Improvement Engine | BUILT | Phase 4. AG-38 (src/lib/agents/self-improvement-agent.ts) + /admin/improvements review UI + agent_performance_metrics dashboard. |
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
| Testing | 8 | 3 | 0 | 0 | 5 |
| **TOTAL** | **191** | **94** | **6** | **34** | **57** |

**Infrastructure:**
- Database tables: 67 (097 migrations applied or queued)
- AI Agents: 30 designed (7 Phase 1, 7 Phase 2, 16 Phase 3 new)
- API routes: 208+
- Pages: 99+
- FORGE prompts executed: 130+
