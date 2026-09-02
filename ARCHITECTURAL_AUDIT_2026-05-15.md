# TARRITRIX ARCHITECTURAL AUDIT 2026-05-15

**Auditor:** Claude (Tarritrix 5.0 session)
**Authorization:** Reid Whitesides, operator, 2026-05-15
**Scope:** Search all Tarritrix chat threads 1.0 → 5.0 for architectural decisions made and verify against current canonical files
**Method:** `conversation_search` across project history + cross-reference with current `BLUEPRINT.md`, `BEHAVIORAL_CONTRACTS.md`, `STATE_OF_THE_BUILD.md`, `SCHEMA_REGISTRY.md`

---

## EXECUTIVE SUMMARY

Tarritrix's canonical architecture documentation has drifted significantly from the cumulative architectural decisions made across Tarritrix 1.0 through 5.0. Migrations between sessions caused approved Phase 1 commitments to be silently downgraded, deferred, or omitted. The customer-facing Client Portal — explicitly approved as Phase 1 scope in Tarritrix 3.0 — is entirely missing from current BLUEPRINT.md. Per-page analytics infrastructure (PostHog wiring, page_metrics rollup, performance-aware A-10/A-11 feedback loop, Contract 34) was approved as Phase 1 but currently exists only as Phase 2 (A-29) and Phase 1 schema tables without consuming agents.

This audit identifies 19 distinct gaps across 8 architectural domains. Eight are critical Phase 1 blockers. Six are Phase 1.5 gaps. Five are Phase 2+ tracking failures. All have direct evidence from prior chat sessions quoted in the findings.

The pattern that produced these gaps is the same pattern that killed 10 prior build attempts: architectural decisions discussed in chat but never durably written into canonical files, then lost when a new chat session began.

**Recovery requires:** A single comprehensive governance commit re-integrating lost specifications, followed by re-sequencing the build order to ensure customer-facing surfaces (Client Portal) ship before or alongside generation agents.

---

## METHOD AND EVIDENCE STANDARD

Every finding in this document includes:
1. The architectural decision as originally made (with chat source URL and date)
2. The current state in canonical files
3. The gap classification (Lost / Downgraded / Under-specified / Deferred Without Tracking)
4. The recommended recovery action

Decisions you explicitly rejected during my prior mentorship recommendations are honored as rejected and not re-proposed. Per your authorization: "if you advised it was a bad idea, I conceded your mentorship."

---

## SECTION 1: CUSTOMER-FACING SURFACES

### 1.1 Client Portal (Surface 6) — MISSING FROM CURRENT ARCHITECTURE

**Status: CRITICAL GAP — Approved Phase 1, currently unspecified**

**Original decision (Tarritrix 1.0, 2026-05-05):**
> "Surface 6: Client Portal — `/portal`. Different sidebar, RLS-filtered views, billing display, lead log with TCPA masking. Substantial build."
> Sidebar nav: Overview, My Pages, Activity, Lead Log, Billing, Account, Logout
> Source: chat 7c69c9f2

**Reinforced (Tarritrix 3.0, 2026-05-08):**
> "Client Portal: per-page analytics surface — My Pages shows per-page performance, RLS-filtered to client only"
> Operator confirmed: "I absolutely love your idea and input... I approve of everything. Let's do it"
> Source: chat 44dc2f09

**Current state in BLUEPRINT.md:**
Mentioned only as "U1 Client Portal Analytics Dashboard" in Wave 6 of build sequence. No specification of:
- Auth model (client login vs operator login)
- Information architecture
- Routes and pages
- Multi-user-per-client (owner + staff)
- Notification system (email digests, SMS alerts)
- Permissions model
- Lead delivery mechanism
- Drip schedule visibility
- Page-level performance display

**Gap classification:** LOST (decision approved but never durably documented)

**Recovery action:** Write full Client Portal specification into BLUEPRINT.md with same depth as A-02 spec. Re-sequence build order to ensure portal ships in Wave 5 alongside A-08 (Indexation Tracker) and A-09 (Conversion Handler), not Wave 6.

### 1.2 Client Portal Login (Surface 5) — UNDOCUMENTED

**Status: GAP — Trivial but missing**

**Original decision (Tarritrix 1.0):**
> "/portal/login. Trivial — copy of operator login."

**Current state:** Not mentioned in any current canonical file.

**Recovery action:** Include in Client Portal specification (Section 1.1 recovery).

### 1.3 Marketing Site / Live State

**Status: COMPLETE — currently functional at tarritrix.com**

This is the only customer-facing surface that exists and works today. Includes:
- Hero with two-dashboard preview
- Five sections (Compare, Storm Intelligence, Pricing, Demo Form, Footer)
- Google Calendar OAuth integration
- Six legal policy pages
- Lighthouse 99/96/100/100 desktop

No recovery action required.

---

## SECTION 2: OPERATOR-FACING SURFACES

### 2.1 Operator Command Center (Surface 3) — PARTIAL BUILD

**Status: SPECIFIED, partial implementation in production at tarritrix.com/dashboard**

**Specification source:** Tarritrix 1.0 BLUEPRINT Part 8 Section 8.6, reinforced multiple times.

**4-Zone layout fully specified:**
- Zone 1: 6-card stat strip (Active Clients, Pages Published Today, LLM Cost Today, MRR, Pending Operator Actions, Active Alerts)
- Zone 2: Real-time activity feed (60% width, polls agent_events every 30s)
- Zone 3: 3 stacked panels — Next Best Actions, Tenant Health, Advisory Signals
- Zone 4: 2 charts — Publishing Velocity (30 days), LLM Cost vs Cap (30 days)
- Sidebar nav with 9 items
- Header with avatar, role badge, notifications bell

**Current state:** Live at /dashboard, with at least Zone 1 functional per STATE_OF_THE_BUILD.md.

**Gap:** Zones 2, 3, 4 + sidebar + header completion status unclear from current docs.

**Recovery action:** Verify completion state of all 4 zones via repo grep; mark complete or carry forward as build unit.

### 2.2 Client Management (Surface 4) — UNDER-SPECIFIED AS BUILD UNIT

**Status: SPECIFIED in Tarritrix 1.0, build status unclear**

**Specification source:** Tarritrix 1.0, reinforced in Tarritrix 3.0.

**Routes specified:**
- `/dashboard/clients` — sortable table, filterable by tier/status
- `/dashboard/clients/new` — 8-step wizard
- `/dashboard/clients/[id]` — tabbed detail (Overview, Pages, Profile Data, Activity, Billing, Integrations)
- `/dashboard/clients/[id]/flagged` — flagged pages queue
- `/dashboard/clients/[id]/pages/[pageId]` — page detail with quality scores

**8-Step Wizard fully specified:**
1. Business Information
2. Service Area
3. Cities × Services Selection
4. Evidence Upload
5. Consent Collection (TCPA, ToS, DPA, GBP auth, Call Tracking)
6. Google Authorization (per-client GCP project)
7. Payment & Signature (Stripe + DocuSign)
8. Integration Setup (ServiceTitan/Jobber/HousecallPro/FieldRoutes/Zapier/Manual)

**Current state:** Not built. Wizard is the critical operator-facing build unit for client onboarding.

**Gap classification:** UNDER-SPECIFIED IN BUILD ORDER. Spec exists in Tarritrix 1.0; verification needed that current BLUEPRINT.md preserves all 8 steps with field-level detail.

**Recovery action:** Audit BLUEPRINT.md for full 8-step wizard spec presence. Restore if missing.

---

## SECTION 3: AGENT INVENTORY GAPS

### 3.1 A-29 Performance Learning Engine — PHASE DOWNGRADED

**Status: CRITICAL — Approved Phase 1, currently Phase 2**

**Original decision (Tarritrix 3.0, 2026-05-08):**

Three sub-features approved as Phase 1:
- Sub-feature 1: Per-page analytics tracking (PostHog wiring + page_metrics rollup) — APPROVED Phase 1
- Sub-feature 2: Per-page analytics dashboards (operator AND client portal, minimum-viable v1) — APPROVED Phase 1
- Sub-feature 2.5: Performance-aware content generation (A-10/A-11 feedback loop) — APPROVED Phase 1

Operator quote: "I absolutely love your idea and input about the agent learning from the conversion rate and not repeating the same page... I approve of everything. Let's do it"

**Current state:** A-29 documented as Phase 2 agent. Schema tables (`page_performance_daily`, `page_structural_variants`) added to Migration 005 as "Phase 1 data prep" with no Phase 1 agent consuming them.

**Gap classification:** DOWNGRADED (Phase 1 → Phase 2 without operator authorization)

**Recovery action:** Restore A-29 to Phase 1 scope. Document the A-10/A-11 performance feedback loop in BLUEPRINT.md A-10 and A-11 sections. Schema tables already exist; consuming agent must be built before customer #1.

### 3.2 A-21 through A-27 — DOCUMENTED BUT PHASE PLACEMENT UNCLEAR

**Status: TRACKED, verification needed**

Agents documented in Tarritrix 3.0 / 4.0:
- A-20 Authority Builder (Phase 2)
- A-21 Hyperlocal Geographic Engine (PROMOTED to Phase 1.5 in Tarritrix 3.0)
- A-22 GBP Optimization Engine (Phase 1.5)
- A-23 Reputation Intelligence (Phase 2)
- A-24 Competitive Intelligence (Phase 2)
- A-25 AI Surface Optimizer / AEO (Phase 3, 11 sub-modules)
- A-26 AI Citation Authority Engine (Phase 3)
- A-27 Voice Search Optimization Engine (Phase 1.5)

**Current state in BLUEPRINT.md:** Listed in user memory but verification needed against current canonical doc.

**Note:** Current memory also references "A-30 Claim Recovery Workflow" and "A-31 Lead Download Engine" as scoped but not built. These need to be reconciled with the A-20 through A-27 inventory above.

**Recovery action:** Reconcile complete A-20 through A-31 inventory in BLUEPRINT.md with explicit phase placement for each.

### 3.3 A-14 Review Velocity Engine + A-18 Job Evidence Ingestion

**Status: RESOLVED in commit `de3ba5e` (2026-05-15)**

Both agents now have full Phase 1.5 specifications per today's documentation commit. No additional recovery needed beyond verifying the existing schema can support them.

### 3.4 A-19 Universal Integration Hub

**Status: ORIGINALLY PHASE 1, current status unclear**

**Original decision (Tarritrix 1.0):** A-19 Universal Integration Hub listed as Phase 1 agent. Handles ServiceTitan/Jobber/HousecallPro/FieldRoutes/Zapier/Manual integration for job completion events feeding A-18.

**Current state:** Not visible in current architecture document's Phase 1 agent list.

**Recovery action:** Verify A-19 is in Phase 1 build plan. If absent, restore. Critical because field service integration is the primary mechanism for automated evidence ingestion (A-18 depends on it).

---

## SECTION 4: BEHAVIORAL CONTRACTS GAPS

### 4.1 Contracts 32, 33, 34 — RECONSTRUCTION STATUS UNCLEAR

**Status: APPROVED Phase 1, reconstructed in Tarritrix 4.0 with caveat**

**Original creation (Tarritrix 3.0):**
- Contract 32 — Prompt Completion Discipline (no mid-prompt pivots, complete each prompt as a unit)
- Contract 33 — Credential Handling Discipline (no stdin pipes, --value flags only, Read-Host -AsSecureString for secrets)
- Contract 34 — Performance Feedback Loop Discipline (max 70% bias toward winners, minimum 30% exploration)

**Tarritrix 4.0 reconstruction (2026-05-13):**
Per chat 68374b26: "Contracts 31–34 reconstructed from handoff references... I'll mark these as 'RECONSTRUCTED FROM HANDOFF' since I don't have authoritative source"

**Current state:** Recent commits added Contracts 38-44. Whether Contracts 31-34 actually exist in current BEHAVIORAL_CONTRACTS.md, or were skipped during the renumbering, is unverified.

**Gap classification:** UNVERIFIED — likely LOST during the Tarritrix 4.0 → 5.0 contract renumbering

**Recovery action:** Audit BEHAVIORAL_CONTRACTS.md for presence of Contracts 31, 32, 33, 34. Restore from prior chat evidence if missing.

### 4.2 Contract 31 — Personalized Demo Engine Protection

**Status: APPROVED Phase 1, currently UNVERIFIED**

**Original creation (Tarritrix 2.0):**
> "Contract 31: Demo Personalization Protection — Personalized Demo Engine is NOT optional. Tier 1 ships in Phase 1 (Prompts 7-10). Tiers 2-4 are explicitly named in the roadmap with dependencies and entry conditions documented. Any session that proposes deferring, descoping, removing, or eliminating any of the four tiers without explicit written operator approval is in violation of this contract."

**Current state:** Memory references Personalized Demo Engine. Whether Contract 31 is in current BEHAVIORAL_CONTRACTS.md is unverified.

**Recovery action:** Verify Contract 31 exists. Restore if missing.

---

## SECTION 5: SCHEMA AND DATA FLOW GAPS

### 5.1 Three-Stage Evidence Unlocking — APPROVED, IMPLEMENTATION STATUS UNCLEAR

**Status: APPROVED Phase 1**

**Original decision (Tarritrix 3.0):**

> Three stages per tier:
> - Stage 1 (Starter Library): Tier minimum (5 photos + 1 case study + 3 claimed facts) → 30% of tier max
> - Stage 2 (Core Library): 50% of full evidence threshold → 70% of tier max
> - Stage 3 (Full Library): Full evidence threshold → 100% of tier max

> Concrete examples:
> - Starter (30 pages): Stage 1 unlocks 9, Stage 2 unlocks 21, Stage 3 unlocks 30
> - Growth (100 pages): Stage 1 unlocks 30, Stage 2 unlocks 70, Stage 3 unlocks 100
> - Authority (210 pages): Stage 1 unlocks 63, Stage 2 unlocks 147, Stage 3 unlocks 210

> A-05 Gate 8 — Evidence Sufficiency: A-02 still drafts pages even when locked. A-05 Gate 8 sets pages.status = 'evidence_locked' if threshold not met. CRON-01 ignores evidence_locked pages.

**Schema additions (from PENDING_PHASE_B_DECISIONS):**
- New column: `pages.evidence_lock_status` (enum: 'unlocked', 'locked_stage_2', 'locked_stage_3')
- New table: `client_evidence_progress`

**Current state in BLUEPRINT.md:** Unverified. Schema additions don't appear in SCHEMA_REGISTRY.md table list (no `client_evidence_progress` table visible). Tier sizing in current memory says "Dominance 500 pages" but Tarritrix 3.0 approved 30/100/210 (no Dominance — that came later in Tarritrix 4.0 four-tier expansion).

**Gap classification:** LIKELY LOST in migration to Tarritrix 5.0 architecture document

**Recovery action:**
1. Verify three-stage unlock mechanism is in BLUEPRINT.md
2. Verify A-05 Gate 8 (Evidence Sufficiency) is documented
3. Verify `client_evidence_progress` table exists in SCHEMA_REGISTRY.md
4. Verify `pages.evidence_lock_status` column exists
5. If any missing, create recovery migration

### 5.2 Geo-Grid Visualization Layers — APPROVED, STATUS UNCLEAR

**Status: APPROVED Phase 1**

**Original decision (Tarritrix 3.0):**
- Layer 1a: EXIF evidence density (heatmap of photo evidence across service area)
- Layer 1b: Page performance (side-by-side with Layer 1a)
- Layer 2 (Google rankings): Deferred to Phase 1.5

**Current state:** Not visible in current canonical files. Memory mentions "geo-grid Layers 1a/1b" in passing.

**Recovery action:** Verify presence in BLUEPRINT.md operator dashboard section. Restore if missing.

### 5.3 EXIF Photo Validation Pipeline — APPROVED, STATUS UNCLEAR

**Status: APPROVED Phase 1**

**Original decision (Tarritrix 3.0):**
- A-18 enhanced: EXIF extraction + validation (GPS vs service area cross-check, timestamp sanity, anomaly flagging)
- EXIF-verified photos count toward evidence stage threshold
- Mobile photo upload flow in client portal preserving EXIF

**Current state in BLUEPRINT.md:** A-18 spec from today's commit `de3ba5e` mentions photo capture but does NOT specify EXIF extraction/validation. This is a gap.

**Recovery action:** Augment A-18 spec to include EXIF pipeline.

---

## SECTION 6: TIER STRUCTURE AND PRICING

### 6.1 Four-Tier Structure (Starter / Growth / Authority / Dominance)

**Status: LOCKED via Tarritrix 4.0 four-tier expansion**

**Current state:** Live pricing matches: $497 / $997 / $1,997 / $3,497 monthly with corresponding setup fees, prepay cadences, Xactimate rewrite allocations.

**Verification needed:**
- Page counts per tier: current memory says "Dominance 500 pages" but Tarritrix 3.0 originally approved 30/100/210 for three tiers. The four-tier expansion in Tarritrix 4.0 set 30/100/210+30 bonus=240/400+100 bonus=500. Verify BLUEPRINT.md reflects these correctly.
- Drip rates: Phase 1 caps at 1/4/8/15 pages/day per tier. Phase 3 at 3/9/18/40. Verify.

**Recovery action:** Verify tier-by-tier specs in BLUEPRINT.md. No structural changes; this is verification work.

### 6.2 Conservative Drip Rates from Tarritrix 3.0 vs Tarritrix 4.0

**Status: TWO COMPETING DRIP RATE TABLES — DRIFT**

**Tarritrix 3.0 (2026-05-08, approved):**
- Starter Phase 1: 3/day, Phase 2: 5/day, Phase 3: 7/day
- Growth Phase 1: 5/day, Phase 2: 8/day, Phase 3: 12/day
- Authority Phase 1: 6/day, Phase 2: 11/day, Phase 3: 16/day

**Tarritrix 4.0 (TierComparisonTable.tsx, deployed):**
- Starter Phase 1: 1/day, Phase 2: 2/day, Phase 3: 3/day
- Growth Phase 1: 4/day, Phase 2: 6/day, Phase 3: 9/day
- Authority Phase 1: 8/day, Phase 2: 12/day, Phase 3: 18/day
- Dominance Phase 1: 15/day, Phase 2: 25/day, Phase 3: 40/day

**Gap classification:** DRIFT (two sources of truth differ)

**Recovery action:** Operator decision required: which drip rate table is canonical? Once chosen, reconcile across BLUEPRINT.md, marketing site code, and CRON-01 implementation when built.

---

## SECTION 7: STORM INTELLIGENCE ENGINE GAPS

### 7.1 VSIE / MVSIE → Storm Intelligence Engine Rename

**Status: RESOLVED per Tarritrix 4.0**

VSIE and MVSIE acronyms officially retired. Current branding "Proprietary Storm Intelligence Engine" or "Storm Intelligence Engine."

No recovery action.

### 7.2 NOAA 10-Year Backfill — REQUIRED, BUILD STATUS UNCLEAR

**Status: REQUIRED Phase 1 prerequisite**

**Original decision:** Storm Intelligence Engine requires 10 years of NOAA storm event data backfilled into `storm_events` table.

**Current state:** Migration 005 added `storm_events` table but data ingestion not yet run.

**Recovery action:** This is build work, not spec work. Listed in current memory as "D1 Storm Backfill (8-12 hr autonomous job)" pending in Wave 2.

### 7.3 Storm Intelligence Coverage Geography

**Status: SPECIFIED**

**Tarritrix 4.0:** Storm Intelligence Engine covers hail/wind/storm impact zones triggered by NOAA + Iowa Mesonet ingestion. Five-state coverage initial focus (Tornado Alley + Texas hail corridors).

No recovery action.

---

## SECTION 8: PERSONALIZED DEMO ENGINE GAPS

### 8.1 Tier 1 (city pre-population) — Phase 1 commitment

**Status: APPROVED Phase 1, verification needed**

**Original decision (Tarritrix 2.0):**
- Tier 1: Static prospect-aware demo with city pre-population from demo_requests.zip + primary_city
- Reuses SignalGeography component from marketing hero
- Build during Prompts 7-10 (Operator Command Center work)

**Current state:** Demo request form captures ZIP + primary_city. Whether the "Demos" sidebar and "Demo Prep" surface are specified in BLUEPRINT.md is unverified.

**Recovery action:** Verify Demo Prep surface specification exists for Operator Command Center.

### 8.2 Tiers 2, 3, 4 — Phase 1.5, Phase 2, Phase 2+

**Status: APPROVED with phase placement**

No recovery action beyond ensuring Contract 31 (protection) is present.

### 8.3 SignalGeography Component Reusability — Phase 1 commitment

**Status: APPROVED via Contract 31**

**Original requirement:** SignalGeography component MUST be built reusable for both marketing hero AND demo prep tool. Built in Prompt 4-T2 (marketing hero).

**Current state:** Component exists in src/app/_components/marketing/Hero.tsx. Whether it's been extracted to a shared location for reuse in the operator dashboard is unverified.

**Recovery action:** Track as build-time consideration when building Demo Prep surface.

---

## SECTION 9: RECOMMENDATIONS ENGINE GAPS

### 9.1 Recommendations Engine (Distinct Edge Function)

**Status: APPROVED Phase 1, build status unclear**

**Original decision (Tarritrix 1.0):**

> Edge Function: recommendations-engine
> Triggered: pg_cron every 5 minutes
> Reads: clients, pages, page_quality_scores, llm_calls, conversions, gbp_profiles, agent_events, dsar_requests, billing_events
> Writes: tenant_signals (with priority, type, message, recommended_action, target_url, dismissed flag)

> 8 Recommendation Categories: Quality, Cost, Lifecycle, Compliance, Integration, Onboarding, Performance, Billing

**Current state:** `tenant_signals` table exists. Recommendations Engine Edge Function not visible in current build plan.

**Gap classification:** LIKELY MISSING from current Wave plan

**Recovery action:** Verify Recommendations Engine is in build plan. Restore if missing. Critical for Operator Command Center Zone 3 (Next Best Actions panel).

### 9.2 Advisory Signals System

**Status: APPROVED Phase 1, build status unclear**

**Original decision (Tarritrix 1.0):**
- Per-tenant warning system with severity tagging (P0-P3)
- Generation sources: A-01 validation, A-05 quality gate failures, A-09 webhook failures, LLM cost guard, Stripe webhooks, Recommendations Engine
- Display: Operator Command Center Zone 3

**Current state:** `tenant_signals` table exists. Generation logic for signals not specified in any visible agent.

**Recovery action:** Verify signal generation logic is specified across A-01, A-05, A-09, etc. Restore if missing.

### 9.3 Tenant Health Scoring

**Status: APPROVED Phase 1**

**Original decision (Tarritrix 1.0):**

> Composite Score (0-100):
> - LLM Cost Adherence (25%)
> - Page Quality Average (25%)
> - Indexation Rate (25%)
> - GBP Completeness (25%, Phase 1.5+, defaults to 100 in Phase 1)

> Endpoint: /api/clients/[id]/health
> Cached 5 minutes per client
> Displayed in Command Center Tenant Health Panel + Client Detail Overview

**Current state:** Unverified.

**Recovery action:** Verify presence in BLUEPRINT.md. Restore if missing.

---

## SECTION 10: REAL-TIME POLLING ARCHITECTURE

### 10.1 30-Second Polling Pattern

**Status: APPROVED Phase 1**

**Original decision (Tarritrix 1.0):**

> Frontend polls dashboard endpoints every 30 seconds
> React Query with refetchInterval: 30000
> WebSocket NOT used — polling is sufficient
>
> Endpoints polled:
> - /api/dashboard/stats (Zone 1 stat strip)
> - /api/dashboard/activity-feed (Zone 2 feed)
> - /api/dashboard/health (Zone 3 tenant health)
> - /api/dashboard/signals (Zone 3 advisory signals)
> - /api/dashboard/recommendations (Zone 3 next best actions)

**Current state:** Operator Command Center has polling per STATE_OF_THE_BUILD.md. Whether spec is in BLUEPRINT.md is unverified.

**Recovery action:** Document in BLUEPRINT.md as a canonical pattern (not just a Surface 3 implementation detail).

---

## SECTION 11: CRON JOBS

### 11.1 CRON-01 Drip Publisher

**Status: PHASE 1, build pending**

**Specification:** Publishes validated pages on velocity throttle. Respects evidence_locked status. Runs daily.

**Recovery action:** No spec recovery needed; build work.

### 11.2 CRON-02 Indexation Runner

**Status: PHASE 1, build pending**

**Specification:** Daily indexation health check via GSC API. Includes cross-tenant leak detection (P0 alarm if any leak detected).

**Recovery action:** No spec recovery needed; build work.

---

## SECTION 12: NOTIFICATIONS AND ALERT PATHS

### 12.1 Operator Notifications

**Status: PARTIALLY SPECIFIED**

**Specified:**
- Operator Command Center notifications bell (count of unread alerts) — Tarritrix 1.0
- Recommendations Engine → tenant_signals → Next Best Actions panel — Tarritrix 1.0

**Not specified:**
- Email notifications to operator for P0 events (cross-tenant leak, payment failure)
- SMS notifications for critical alerts
- Slack integration for operator alerts (if any)

**Recovery action:** Specify operator notification preferences and channels in BLUEPRINT.md Operator Command Center section.

### 12.2 Client Notifications

**Status: NOT SPECIFIED**

This is downstream of the Client Portal gap (Section 1.1). Without the portal spec, no notification system exists.

**Recovery action:** Include in Client Portal recovery (Section 1.1).

---

## SECTION 13: GENERATION PIPELINE END-TO-END TRACE

The full pipeline from client onboarding to lead capture:

```
[Marketing Site] → demo_requests captured
       ↓
[Operator manually onboards via 8-step wizard] (Surface 4)
       ↓
A-01 Intake Processor validates wizard data
       ↓
A-21 Site Ingestion (if Phase 1.5) extracts client's existing brand
       ↓
A-10 Content Profile Builder builds 4-layer differentiation + heatmap
       ↓
A-02 Page Generator creates pages with module library
       ↓
A-05 Page Validator runs 15 gates (including new Gate 8 Evidence Sufficiency)
       ↓
A-03 Schema Generator produces JSON-LD per page
       ↓
A-04 Map Embed Generator produces iframe per page
       ↓
A-06 Internal Link Builder creates link graph
       ↓
A-07 Sitemap Generator produces XML sitemap, submits to GSC
       ↓
A-20 Multi-Tenant Hosting deploys to clientdomain.com/locations/{city}/{service}
       ↓
CRON-01 Drip Publisher releases pages on velocity throttle
       ↓
[Pages live, Google crawls and indexes]
       ↓
A-08 Indexation Tracker monitors GSC for indexed status
       ↓
A-09 Conversion Handler captures form submissions and phone clicks
       ↓
[Page performance data accumulates in page_performance_daily]
       ↓
A-29 Performance Learning Engine correlates structure variants to outcomes
       ↓
A-11 Content Refresh Engine refreshes underperforming pages
       ↓
[Loop back to A-02 with performance-informed bias]
       ↓
A-14 Review Request Workflow drives review velocity
       ↓
A-18 Job Evidence Upload captures completed jobs for Pool C content
       ↓
[Surface 6 Client Portal displays all of this to the client]
```

**Gaps in this pipeline (from prior sections):**
1. Client Portal (terminal display) — MISSING (Section 1.1)
2. A-29 Performance Learning — DOWNGRADED to Phase 2 (Section 3.1)
3. A-21 Site Ingestion phase placement — VERIFY (Section 3.2)
4. A-19 Universal Integration Hub — VERIFY (Section 3.4)
5. Recommendations Engine — VERIFY (Section 9.1)
6. EXIF pipeline in A-18 — MISSING (Section 5.3)

---

## SECTION 14: DECISIONS DISCUSSED BUT NOT DOCUMENTED — INVENTORY

This section lists every architectural commitment found in chat history that requires verification or documentation:

### CRITICAL (Phase 1 blockers)

1. Client Portal full specification (Section 1.1)
2. A-29 Performance Learning restored to Phase 1 (Section 3.1)
3. Per-page analytics tracking infrastructure — PostHog wiring, page_metrics rollup (Sections 3.1, 9)
4. A-10 / A-11 performance feedback loop (Section 3.1)
5. Three-stage evidence unlocking + A-05 Gate 8 (Section 5.1)
6. EXIF photo validation pipeline in A-18 (Section 5.3)
7. Recommendations Engine Edge Function (Section 9.1)
8. Contracts 31, 32, 33, 34 verification (Section 4)

### IMPORTANT (Phase 1.5)

9. A-21 Hyperlocal Geographic Engine Phase 1.5 placement (Section 3.2)
10. A-22 GBP Optimization Engine Phase 1.5 (Section 3.2)
11. A-27 Voice Search Optimization Engine Phase 1.5 (Section 3.2)
12. Geo-grid Layers 1a/1b visualization (Section 5.2)
13. Personalized Demo Engine Tier 1 build (Section 8.1)

### TRACKING

14. Drip rate canonical source decision (Section 6.2)
15. Tenant Health Scoring formula (Section 9.3)
16. Real-time polling pattern documentation (Section 10)
17. Operator notification channels (Section 12.1)
18. A-19 Universal Integration Hub Phase 1 status (Section 3.4)
19. A-20 through A-31 complete inventory reconciliation (Section 3.2)

---

## SECTION 15: WHY THESE GAPS HAPPENED

The pattern is consistent across all 19 gaps:

**Pattern A: Decisions made in chat, never committed to BLUEPRINT.md**
A new session would read the canonical files, not see the decision, and proceed without it. Tarritrix 3.0's per-page analytics approval is the clearest example — operator quote: "I approve of everything. Let's do it" → never landed in BLUEPRINT.md → invisible to Tarritrix 4.0 and 5.0 sessions.

**Pattern B: Architecture document rewrites lose prior decisions**
When yesterday's TARRITRIX_ARCHITECTURE_2026-05-14.md was authored, it pulled forward a subset of prior decisions but not all. A-29 became Phase 2 instead of Phase 1. Client Portal became a Wave 6 stub. Contracts 31-34 were skipped during renumbering to 38-44.

**Pattern C: PENDING_PHASE_B_DECISIONS.md transient doc deleted before reconciliation**
Tarritrix 3.0 created PENDING_PHASE_B_DECISIONS.md as a bridge document to capture all approved decisions. The plan was: integrate this into permanent governance, then delete. The bridge document got deleted (commit `e935bc2`) but full integration into permanent governance is questionable. Several decisions in that bridge document don't appear in current canonical files.

**Pattern D: Memory drift across chat sessions**
My memory across sessions has been imperfect. Decisions I logged via memory_user_edits don't substitute for committed governance files. A new chat reads BLUEPRINT.md, not my memory.

**Root cause:** No enforcement mechanism that every architectural decision in chat MUST be committed to BLUEPRINT.md as part of the same session. The discipline was inconsistent.

---

## SECTION 16: RECOVERY PLAN

The recovery is one comprehensive governance commit followed by build-order re-sequencing.

### Recovery Phase A: Verification (do first)

Run grep checks against current canonical files to confirm what's actually present vs missing. This determines the size of the recovery commit.

```powershell
cd C:\Users\manag\Documents\Tarritrix

# Section 1.1 - Client Portal
Select-String -Pattern "Client Portal|Surface 6|/portal" BLUEPRINT.md

# Section 3.1 - A-29 phase placement
Select-String -Pattern "A-29|Performance Learning|page_metrics" BLUEPRINT.md

# Section 4 - Contracts 31-34
Select-String -Pattern "Contract 31|Contract 32|Contract 33|Contract 34" BEHAVIORAL_CONTRACTS.md

# Section 5.1 - Evidence unlocking
Select-String -Pattern "evidence_lock|Gate 8|Stage 1|client_evidence_progress" BLUEPRINT.md SCHEMA_REGISTRY.md

# Section 5.3 - EXIF validation
Select-String -Pattern "EXIF|GPS validation" BLUEPRINT.md

# Section 9 - Recommendations Engine
Select-String -Pattern "Recommendations Engine|tenant_signals|Next Best Actions" BLUEPRINT.md

# Section 3.4 - A-19
Select-String -Pattern "A-19|Universal Integration Hub" BLUEPRINT.md
```

For each query, paste results. Anything that returns zero matches is confirmed missing.

### Recovery Phase B: Specification Authoring

Based on verification results, author specifications for missing pieces. Single document, single commit. Sections to write (in priority order):

1. **Client Portal Full Specification** (Section 1.1)
   - Auth model with role='client'
   - 8 route specifications
   - Information architecture for each route
   - Multi-user-per-client model (owner + 5 staff max)
   - Notification preferences (email digest weekly, daily optional, SMS for high-priority)
   - Permissions and edit boundaries
   - Lead delivery mechanism (in-portal + email + SMS)
   - Pricing transparency boundaries
   - Phase 1 MVP scope vs Phase 1.5 enhancements vs Phase 2 advanced

2. **A-29 Phase 1 Restoration** (Section 3.1)
   - Restore from Tarritrix 3.0 approved scope: Sub-features 1, 2, 2.5
   - PostHog wiring spec (Prompt 9.5 equivalent)
   - page_metrics rollup table verification
   - A-10 performance-aware generation
   - A-11 underperforming page refresh prioritization

3. **Contracts 31, 32, 33, 34 Restoration**

4. **Three-Stage Evidence Unlocking** (Section 5.1)
   - Mechanism spec
   - A-05 Gate 8 spec
   - Schema additions

5. **EXIF Pipeline in A-18** (Section 5.3)
   - GPS vs service area cross-check
   - Timestamp sanity
   - Anomaly flagging

6. **Recommendations Engine Edge Function** (Section 9.1)

7. **Tenant Health Scoring** (Section 9.3)

8. **A-19 Universal Integration Hub Phase 1 spec restoration**

### Recovery Phase C: Build-Order Re-sequencing

Current Wave 1-6 sequence does not account for Client Portal as Phase 1. Proposed adjustment:

**Revised Wave Order:**
- Wave 1: Foundation (B1, B2, B3, B4, B5, B6) — IN PROGRESS, B1 and B2 done
- Wave 2: Data prep (D1 Storm backfill, D2 CRONs, D3 Brand seeds, I1 A-20 hosting, I2 Vercel domains)
- Wave 3: Onboarding pipeline (A-21 Site Ingestion, A-01 Intake, A-19 Integration Hub, I3 DNS, I4 Sitemap)
- Wave 4: Module library (D4 modules — biggest piece)
- Wave 5: Generation (A-10, A-02, A-05, A-03, A-04)
- Wave 6: Distribution (A-06, A-07, CRON-01, A-08, A-09)
- Wave 7: Performance feedback (A-29 with PostHog + page_metrics) — PROMOTED FROM PHASE 2
- **Wave 8: Customer-facing surfaces (Surface 5 Client Portal Login, Surface 6 Client Portal, Surface 4 Client Management + 8-step Wizard, Demo Prep surface)** — NEW WAVE
- Wave 9: Operator dashboards completion + Recommendations Engine

Rationale: Pages without a customer-facing portal are invisible to the customer. Without the portal, customer cannot see the work being done. The portal must ship before customer #1 onboards.

### Recovery Phase D: Discipline Enforcement

Add to BEHAVIORAL_CONTRACTS.md:

**Contract 46 — Architectural Decision Durability**
Every architectural decision approved in operator-Claude chat must be committed to BLUEPRINT.md within the same session. No decision is considered ratified until it appears in a committed BLUEPRINT.md version. Chat memory and operator memory are not substitutes for canonical file commits. Sessions that approve architectural decisions and proceed to other work without the commit are in violation of this contract.

This is the discipline that prevents this audit from being needed again.

---

## SECTION 17: WHAT THIS AUDIT DID NOT COVER

For honesty, several things this audit did NOT verify:

1. **Existing code vs spec drift** — whether deployed code matches BLUEPRINT.md specs. This audit was specification-vs-prior-decisions only.

2. **Database vs SCHEMA_REGISTRY.md drift** — whether the live 82 tables match documented schema exactly.

3. **Marketing site copy vs current memory** — whether tarritrix.com still reflects current architectural decisions accurately.

4. **Test coverage gaps** — whether existing tests cover the approved Phase 1 scope.

5. **Cost model accuracy** — whether tier LLM cost caps are calibrated to actual costs from Phase 1 development.

6. **Five Moats marketing positioning vs current architecture** — Tarritrix 1.0 specified Five Moats. Some marketing copy may reference moats that have evolved since.

7. **DEMO_TALKING_POINTS.md current accuracy** — referenced in memory as "battle-ready prospect framing" but not verified.

8. **Cursor agent work and CC autonomous decisions** — work that was committed without Claude-operator architectural discussion was not in scope.

These are next-pass audits if needed.

---

## SECTION 18: OPERATOR DECISIONS REQUIRED

Before recovery commit can be authored, operator decisions on:

1. **Drip rate canonical source** (Section 6.2): Tarritrix 3.0 conservative rates OR Tarritrix 4.0 aggressive rates with Dominance?
2. **Client Portal scope split**: What ships in Phase 1 MVP vs Phase 1.5 enhancement vs Phase 2 advanced?
3. **Multi-user client portal**: Owner + staff (with what permissions)?
4. **Notification channels**: Email + SMS + in-portal, or subset?
5. **Recovery commit strategy**: Single comprehensive commit OR multiple focused commits?
6. **Build order**: Accept proposed Wave 7 (A-29 Phase 1 promotion) and Wave 8 (Customer-facing surfaces) re-sequencing?

---

## SECTION 19: CONCLUSION

The architectural specifications for Tarritrix are spread across:
- Current canonical files (BLUEPRINT.md, BEHAVIORAL_CONTRACTS.md, SCHEMA_REGISTRY.md, etc.)
- Tarritrix 1.0-5.0 chat history
- Claude memory (memory_user_edits)
- Operator memory

The current canonical files capture an incomplete subset of the cumulative architectural intent. This audit identifies 19 specific gaps with direct chat-history evidence.

The architecture itself is sound. The differentiation engine, module library, storm intelligence engine, multi-tenant hosting, per-page performance learning, and customer-facing portal — together they describe a programmatic SEO platform with genuine moats. None of the gaps are architectural failures. They are documentation failures.

Recovery is achievable in one substantial governance commit (estimated 1500-2500 lines added to BLUEPRINT.md, plus 4 contract additions, plus 1 schema verification migration) followed by Wave-order adjustments. After recovery, Contract 46 (Architectural Decision Durability) prevents recurrence.

The 10 prior build attempts failed in part because architectural commitments evaporated between sessions. Tarritrix succeeds when every commitment is durably written into canonical files in the same session it was made.

This audit is the foundation for not becoming attempt #11.

---

**END OF AUDIT**

Generated by Claude, 2026-05-15, operator session.
