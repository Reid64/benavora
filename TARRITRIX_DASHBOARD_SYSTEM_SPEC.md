# TARRITRIX DASHBOARD SYSTEM — COMPREHENSIVE DESIGN SPEC
**Version 2.0 — supersedes DASHBOARD_DESIGN_SPEC.md where noted below, extends it everywhere else**
**Status: DESIGN ONLY — no code, no schema, no build queue until operator sign-off**

---

## 0. What this document is and isn't

This is a conceptual and functional spec for three distinct dashboard surfaces, each grounded in what Tarritrix's agents actually do — not generic SaaS dashboard tropes. Nothing here has been built. This does not replace the already-shipped operator dashboard IA (Platform Pulse Bar, Risk Command Panel, Priority Command Surface, SplitView) — it extends that IA with the modules and second/third surface this document specifies.

**Visual language** (carried from the two reference concepts you provided and the locked DASHBOARD_DESIGN_SPEC.md, unified across all three surfaces so they feel like one product):
- Base: `#1c2030` slate, cards on a slightly lighter `#242938` surface
- Accent: `#06b6d4` cyan (primary actions, active states, growth indicators)
- Status colors: green (healthy/on-track), amber (attention), red (critical) — reused consistently across all three dashboards so an operator moving between Client Portal, Command Center, and Master Console never has to relearn color meaning
- Custom SVG arc gauges for score metrics (Index Health, SEO Health) — never donut charts, per existing lock
- Card-based grid, not dense tables, for anything client-facing
- Left sidebar navigation, fixed top bar with context switcher (client selector / company switcher depending on surface)

**Three surfaces, three audiences, three permission models:**

| Surface | Audience | Interaction model | Tenant scope |
|---|---|---|---|
| Client Portal | Paying client (roofing/PDR contractor) | Read-only observation | Their own tenant only |
| Operator Command Center | Senior admins, VAs, master_admin | Full read/write, multi-tenant | All client tenants, one at a time via selector |
| Master Admin Console | You (master_admin) only | Full read/write, platform-wide | Your own companies (Tarritrix, AFS, ground-truth tenants) + aggregate view across the entire client portfolio |

---

## 1. Agent-to-Dashboard-Module Mapping

Every module below traces to a real agent's actual output, not an assumed feature. This is the exercise you asked for — reviewing agent functionality and extrapolating dashboard modules from it, not the reverse.

| Agent(s) | What it actually produces | Dashboard module | Surface(s) |
|---|---|---|---|
| A-01 Intake Processor | Client record, locality confidence, crawlability pre-check | Onboarding Status card | Operator, Master |
| A-44 Client Knowledge Ingestion | Brand voice model, ingested assets, keyword gap analysis | Ingestion Health panel | Operator, Master |
| A-02 Page Generator + A-32 Content Seed Variation | Generated city/service pages, linguistic variation manifest | Production Timeline (page count vs. goal) | Client, Operator, Master |
| A-03 Schema Generator + A-26 Entity Schema + A-33 Schema Scrambler | JSON-LD schema per page, entity verification, varied markup footprint | Schema Coverage panel | Operator, Master |
| A-04 Map Embed Generator + A-21 Hyperlocal Geographic Engine | Map embeds, storm-density heatmaps, geo-grid ranking data | Local Visibility / Geo-Grid Map | Client, Operator, Master |
| A-05 Page Validator (16 gates) | Pass/fail per gate per page (duplicate content, AI-style repetitiveness, layout similarity, hub completeness, etc.) | Page Quality Score + violation drill-down | Operator, Master (aggregate-only summary surfaces to Client as "SEO Health") |
| A-06 Internal Link Builder + A-36 Internal Link Shuffler | Internal link graph, topic-cluster reinforcement, authority sculpting | Internal Linking panel | Operator, Master |
| A-07 Sitemap Generator + A-08 Indexation Tracker | Sitemap state, per-page indexed/not-indexed/error status | Index Coverage donut + trend | Client (simplified), Operator, Master |
| A-09 Conversion Handler | Calls, form submissions, conversion events per page | Leads & Conversions panel | Client, Operator, Master |
| A-10 Content Profile Builder + A-11 Content Refresh Engine | Content heatmap, staleness scoring, refresh scheduling | Content Freshness / Refresh Queue | Operator, Master |
| A-14 Review Velocity Engine | Review request cadence, FTC-compliant review flow status | Reputation panel | Client, Operator, Master |
| A-18 Job Evidence Ingestion | Photos, job records, authenticity evidence per page | Evidence / Proof-of-Work gallery | Client, Operator, Master |
| A-19 Universal Integration Hub | Third-party connection status (CRM, phone tracking, etc.) | Integrations panel | Operator, Master |
| A-25 AEO Atomic Fact Engine + A-27 Voice Search Optimization | Restructured pages for AI/voice answer extraction, Speakable schema, voice keyword targets | AI & Voice Optimization panel | Operator, Master (client sees only the outcome, in "AI Overview Impressions") |
| A-47 LLM Citation Tracker | Citation events across ChatGPT/Perplexity/Claude/AI Overviews, displacement alerts | AI Overview Citations panel | Client (simplified trend), Operator, Master |
| A-46 Directory Registration | Directory submission status by tier (A/B/C) | Citations & Directories panel | Operator, Master |
| A-45 Backlink Intelligence *(Phase 2, not built)* | Backlink quality scores, toxic link detection, gap analysis | Backlinks panel (dates + source) | Client, Operator, Master |
| A-48 GBP Control Center *(not built — confirmed missing this session)* | GBP posts, Q&A, insights | Google Business Profile panel | Client, Operator, Master |
| A-49 GSC Intelligence Engine | Search Console queries, impressions, CTR, position | Organic Search Performance panel | Client (simplified), Operator, Master |
| A-34 Image Metadata Randomizer, A-35 Component Variation Engine, A-37 Publish Cadence Jitter, A-38 HTTP Fingerprint Diffusion | Anti-detection / penalty-mitigation telemetry — the platform's core moat | **Penalty Mitigation Shield** — operator/master only, never client-facing | Operator, Master |
| SPDI: risk-classifier, evidence-gate, policy-enforcer, audit-logger | Risk scores, approval queue, policy violations, audit trail | Risk Command Panel + Governance/Approvals queue | Operator, Master |
| Contract 41 (LLM Cost Governance), Contract 91 (RLS migration sweep) | Per-client LLM spend vs. tier cap, RLS migration progress | Platform Health panel | **Master only** |

**Deliberate exclusion, stated explicitly:** anti-detection/penalty-mitigation agent output (A-34, A-35, A-37, A-38) and internal cost/agent-name telemetry never reach the Client Portal. This isn't an oversight — it's already a confirmed contract (client-facing agent-name/LLM-cost leaks were checked and confirmed absent in the last audit). Showing a client "your pages are being fingerprint-diffused to avoid Google detection" would be actively harmful to the sales narrative and arguably to trust. Client sees outcomes (rankings, traffic, leads), never the defensive machinery producing them.

---

## 2. Client Portal (Read-Only)

**Interaction model:** observe only. No buttons that mutate state — no "regenerate," no "approve," no editable fields. Every element on this dashboard is either a metric, a chart, or a link that opens a live page in a new tab. This is a deliberate constraint, not a limitation to work around — clients should never be able to trigger agent runs, edit content, or touch anything that could affect page-validation gates or penalty-mitigation timing.

### Layout
Fixed top bar: Tarritrix logo, client company name + logo, date range picker, "Download Report" action (PDF export only — the one non-observational action, and it's a read operation, not a mutation).

Left sidebar: Overview / Performance / Content Progress / Map Stacking / Backlinks / Reviews / Leads / Site Audit Summary — mirrors the structure from your reference concept (image 1) but every section below is grounded in a real agent output, not assumed.

### Modules

**Performance Summary strip** (top row, 5-6 metric cards): Pages Published (A-02), Indexed Pages (A-08), Organic Sessions (A-49/GSC), Keyword Rankings (A-49), Leads 30-day (A-09).

**Overall SEO Health arc gauge**: aggregate score rolled up from A-05's 16 validation gates + A-08 indexation rate + A-49 ranking trend. Client sees one number and a component breakdown (Technical SEO, Content Quality, On-Page SEO, Local SEO, Backlinks) — never the raw gate names or violation detail, which stays operator-side.

**Map Stacking Progress — this is the module you specifically asked for, built out in full:**
- Dual-timeline visualization, side by side, sharing a time axis:
  - **Timeline A — Production**: total page-count goal (set at onboarding tier) vs. pages actually created to date, plotted as a cumulative area chart. Draws from A-02's output count against the client's tier target (Starter/Growth/Authority/Dominance page-count commitments).
  - **Timeline B — Drip Cadence**: assigned publish rate for the current week (from A-37 Publish Cadence Jitter's per-client schedule) plotted alongside a projected-increase curve showing anticipated cadence ramp over the coming weeks. This is the client-safe surface of A-37 — they see "your publish rate" and "where it's headed," never the jitter/fingerprint-diffusion mechanics underneath it (that stays in the Penalty Mitigation Shield, operator-only).
- **Page inventory table with dropdown filter** by city or hyper-local target area, exactly as requested — selecting a city filters the table to that city's pages; each row is clickable and opens the live published URL in a new tab (this is literally "clickable to open that page for viewing," per your spec).
- **Differentiating features column** per page — pulled from A-02/A-32's variation manifest, surfaced as a short human-readable tag list (e.g., "storm-response angle, adjuster-communication block, 3 unique photos") rather than raw variation-engine internals.
- **Backlinks panel** with creation dates and source — this is the Phase 1.5 portal feature you already had logged as deferred pending a new data source; A-45 Backlink Intelligence (Phase 2, not yet built) is the eventual real source. Until A-45 ships, this panel either stays hidden or shows a manually-curated placeholder — do not fabricate backlink data to fill the UI.

**Local Visibility**: map pack visibility trend + top locations by visibility, drawing from A-04/A-21's geo-grid data — same visual language as your reference image 1's map panel.

**Reviews**: A-14's review velocity output, FTC-compliant framing (no incentivized-review language ever surfaces here per Contract 45).

**Google Business Profile panel**: gated on A-48 actually being built (confirmed missing — see open item below). Once it exists, this is where live GBP performance (views, calls, direction requests, post engagement) surfaces to the client, pulled via the Google Business Profile API.

**Recent Activity feed**: plain-language, client-safe descriptions only ("New location pages published," "Schema markup updated," "Storm event detected — response pages created") — never an agent name, model name, or cost figure. This constraint is already enforced platform-wide per the last audit; this feed inherits it.

---

## 3. Operator Command Center (Multi-Tenant)

This extends — does not replace — the already-shipped IA (Platform Pulse Bar, Risk Command Panel, three-lane Priority Command Surface, SplitView master-detail, IndexHealthGauge). The existing shell stays. The additions below are new rows/tabs layered into it, populated by agents that don't yet have dashboard surfaces.

### Client selector (already built, confirmed working)
Search bar + dropdown, exactly as you specified — ClientSelector/ClientContext already ships this. Selecting a client collapses the aggregate view into SplitView's per-client detail pane. Every module below has an "all clients" aggregate state and a "selected client" detail state.

### New modules layered into the existing shell

**Ingestion Health** (A-44): per-client scrape status, last successful ingestion date, next scheduled refresh, failure/backoff state, manual "Force Re-scrape" trigger (master_admin/senior_admin only per the existing permission matrix — not exposed to VAs).

**Penalty Mitigation Shield** — this is the platform's actual competitive moat (A-34, A-35, A-37, A-38) and it deserves to be the most visually distinct panel in the operator dashboard, not buried. Shows per-client: current publish cadence vs. the 15/day compliance ceiling (2026 Google scaled-content-abuse rule — flagged earlier this session as needing spec revision for the Dominance tier), fingerprint diffusion health, component/schema variation coverage across the client's page set. This panel is the visual proof, for you and any future team member, that the anti-penalty architecture is actually running — not just specified in a governance doc.

**AI & Voice Optimization** (A-25, A-27, A-47): AEO restructuring coverage, voice-query optimization completeness, LLM citation trend with competitor-displacement alerts — this is the direct analog to your reference image 3's "AI Overview Impressions" panel, grounded in A-47's actual citation-tracking output rather than a generic metric.

**Content Pipeline Kanban**: Plan / In Progress / Review / Scheduled / Published — matches the visual pattern from your reference image 2, but the columns are populated by real A-02/A-05/A-11 pipeline states, filterable to "all clients" or the selected client.

**Governance & Approvals**: SPDI's approval queue (risk-classifier output, evidence-gate holds, policy-enforcer flags) surfaced as an actionable list — senior_admin/master_admin approve or reject directly from this panel. This is where the SPDI work from earlier this session actually becomes usable instead of just existing as backend routes.

**Directories & Citations** (A-46): submission status by directory tier, pending/completed/failed registrations.

---

## 4. Master Admin Console (New Surface — Unique to You)

This is the one that doesn't exist anywhere in the reference images because it's not a generic SaaS pattern — it's specific to your dual role as platform operator and operator-of-your-own-companies.

### Company Switcher — distinct from the Client Selector
A separate top-level toggle, not a dropdown item mixed in with paying clients: **"My Companies"** vs. **"Client Portfolio."**

- **My Companies**: Tarritrix (as its own ground-truth tenant), Architectural Flashing Supply, E4 Construction & Roofing (demo/ground-truth tenant), and any future company you operate. Selecting one of these drops you into a view that looks like the Operator Command Center's per-client detail — but with master_admin-only actions unlocked that wouldn't make sense for a paying client's account (direct schema override, manual cost-cap adjustment, etc.)
- **Client Portfolio**: the full paying-client roster — functionally the same view as the Operator Command Center's aggregate mode, but this is where portfolio-level business metrics live that a senior_admin/VA shouldn't see (see below).

### Master-only modules

**Platform Health**: aggregate agent success rate across every tenant (not just one client) — this is the practical answer to today's whole session: a live panel would have shown you immediately that production was 44 commits behind, rather than that surfacing accidentally through an RLS bug three layers deep. Includes: Vercel production commit vs. `main` HEAD drift indicator (red if mismatched — directly prevents today's failure from recurring silently), FORGE queue status, last deployment timestamp.

**Governance Sweep Tracker**: live progress on Contract 91 (Pattern C → Pattern A RLS migration — currently 4 of 61 tables migrated, 57 remaining across 3 batches), plus any other cross-cutting governance debt tracked in BEHAVIORAL_CONTRACTS.md. This turns a document you have to remember to reread into a dashboard you glance at.

**Revenue & Tier Distribution**: client count by tier (Starter/Growth/Authority/Dominance), aggregate MRR, tier-upgrade opportunities flagged by A-30 Claim Recovery Workflow's ROI data where applicable. This is business-facing data that has no reason to be visible to a VA or even most senior_admins.

**LLM Cost Governance** (Contract 41): real-time spend per client against tier caps ($20/$50/$100/$200 monthly caps referenced in A-47's spec, and the equivalent caps across every other LLM-calling agent), aggregated platform-wide spend, and an alert if any client is approaching cap.

**Cross-Tenant Agent Health**: the same per-agent success-rate/error-count view the Operator Command Center will eventually get for a single client, but rolled up across all tenants simultaneously — the fastest way for you specifically to spot a systemic agent failure (like the A-03/A-04 legacy-vs-new implementation split found in today's audit) before it's been silently running wrong for weeks.

---

## 5. Explicitly Out of Scope for This Design Pass

Naming these so they don't get silently assumed into a build queue:

- GBP API integration itself (OAuth flow, insights endpoint mapping) — this document assumes A-48 will eventually exist and designs the panel that consumes it, but building A-48 is separate agent work, not dashboard work, and was already flagged as unbuilt.
- A-45 Backlink Intelligence — same treatment. The Client Portal's Backlinks panel is designed to receive real data from it, but the panel should not fabricate or hardcode backlink data in the meantime.
- Any code, component, or migration. This is a spec artifact only.

## 6. Open Item Carried Over From Earlier This Session

The A-03/A-04 legacy-vs-new implementation question (parallel `src/agents/` vs `src/lib/agents/` classes) is still unresolved and unrelated to this design pass — it needs a decision before any dashboard build queue touches Schema Coverage or Local Visibility panels, since both depend on knowing which implementation is actually authoritative.
