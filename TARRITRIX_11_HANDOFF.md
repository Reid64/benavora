# TARRITRIX 11.0 — SESSION HANDOFF PROMPT

## CRITICAL: Read this entire document before responding to anything

---

## CURRENT GIT STATE
- Repo: github.com/Reid64/tarritrix (private), local at C:\Users\manag\Documents\Tarritrix
- HEAD: 9bcf54c — fix: resolve merge conflict in dashboard clients overview route
- Branch: master, clean, synced with origin
- Supabase project ref: jhiplicikizdpdsguimg
- Production: tarritrix.com (Vercel)

## WHAT IS BUILT (VERIFIED ON DISK)

### Agents — All 15 Phase 1 agents shipped with full implementations:
- A-44 Knowledge Ingestion Engine (304 lines) — committed 33f42ec
- A-01 Intake Processor
- A-02 Page Generator (206 lines) — Contract 73 enforced, P9 tel: check
- A-03 Schema Generator
- A-04 Map Embed Generator
- A-05 Page Validator (211 lines) — 16 gates
- A-06 Internal Link Builder
- A-07 Sitemap Generator
- A-08 Indexation Tracker
- A-09 Conversion Handler — Contract 6 TCPA enforced
- A-10 Content Profile Builder (170 lines)
- A-11 Content Refresh Engine
- A-14 Review Velocity Engine
- A-18 Job Evidence Ingestion — Contract 18 enforced
- A-19 Universal Integration Hub (113 lines)
All agent trigger routes exist at src/app/api/agents/*/trigger/route.ts

### CRONs:
- CRON-01 Drip Publisher — drip rate governance-locked per BEHAVIORAL_CONTRACTS.md
- CRON-02 Indexation Runner — wired to A-08
- CRON-03 Quarterly Refresh — wired to A-44

### Dashboard — CLEAN SLATE, partial rebuild in progress:
- src/app/dashboard/_components/ — EMPTY (all old components demolished)
- src/app/dashboard/page.tsx — 3-line placeholder
- src/app/dashboard/layout.tsx — exists, needs audit
- src/styles/dashboard-tokens.css — CSS design tokens committed
- docs/design/DASHBOARD_DESIGN_SPEC.md — LOCKED design spec committed

### Dashboard APIs built so far (d1-001 through d1-004):
- src/app/api/dashboard/stats/route.ts — platform pulse, activity, costs, risk
- src/app/api/dashboard/action-queue/route.ts — three-lane priority queue
- src/app/api/dashboard/clients/[id]/overview/route.ts — per-client data (220 lines, schema-correct)

### Portal — rebuilt with weekly client summary view
### Design spec — locked at docs/design/DASHBOARD_DESIGN_SPEC.md

---

## WHAT IS NOT BUILT (REMAINING WORK)

### Dashboard components (d1-006 through d1-019):
These need to be built per DASHBOARD_DESIGN_SPEC.md:
- DashboardLayout shell (top nav 56px, left sidebar 220px, fluid canvas)
- PlatformPulseBar
- ClientSelector
- IndexHealthGauge (custom SVG arc gauge — NOT a donut chart)
- PriorityCommandSurface (Critical/Attention/Informational lanes)
- ActivityStream
- IntelligenceRow (Storm Pulse, Indexation Velocity, Revenue Signal)
- RiskCommandPanel with throttle controls
- ClientCommandView (campaign header, page inventory accordion, dual timeline, GBP panel)
- LLMCostModal
- StormPulseIndicator
- RiskBadge
- PageDetailPanel (slide-in, preview + analytics + 16 gate results)

### Pass 2 (not yet started):
- SEO Risk Engine (22 signals → Index Health Score)
- GBP API OAuth connection
- Lighthouse automation
- Real GSC analytics data

### Pass 3 (not yet started):
- Heat map with pulsing job location dots
- Storm proximity matching and auto-page-trigger

### Agent taxonomy manual page builder dropdown — not built
### Marketing page honesty pass — not done

---

## THE CORE PROBLEM BEING SOLVED IN THIS SESSION

**FORGE orchestrator situation:**
- forge.ps1 (FORGE 1.0) — CORRUPTED AND ABANDONED. 4000+ lines with 7 duplicate function definitions from repeated patch attempts. Do not use.
- FORGE 2.0 — The correct orchestrator at C:\Users\manag\Documents\forge-2\. Has 5 known bugs that have been preventing successful operation.

**FORGE 2.0 known bugs (verified from source code audit):**
1. parseQueueYaml requires flat top-level array — current queues have governance:/project:/prompts: wrapper keys → 0 prompts parsed → falls back to generating its own queue → builds wrong thing every time
2. Queue location: FORGE 2.0 reads from C:\Users\manag\Documents\Tarritrix\queue.yaml (repo root), NOT from FORGE projects folder
3. npx spawn crash at 86% in retrofit scan — npx not in PowerShell PATH
4. No substance gate — stubs pass silently (9-line components pass compile+file_exists gates)
5. Governance doc path resolution — looks in projects folder, not repo

**These 5 bugs must be fixed in FORGE 2.0 TypeScript source before any build runs.**

---

## DESIGN DECISIONS LOCKED

From DASHBOARD_DESIGN_SPEC.md (committed at docs/design/):
- Color palette: --bg-base #1c2030, --bg-surface #242b3d, --bg-elevated #2d3650, --accent-cyan #06b6d4, --accent-green #10b981, --accent-amber #f59e0b, --accent-red #ef4444, --accent-purple #8b5cf6
- Layout: 56px fixed top nav, 220px left sidebar, fluid canvas
- Client selector in top nav — master view shrinks to 280px when client selected, client detail expands alongside
- Three-lane Priority Command Surface: Critical (24h escalation) / Attention (12h escalation) / Informational
- IndexHealthGauge: custom SVG arc, 200 degrees, color-coded 0-50 red / 50-70 amber / 70-90 green / 90-100 cyan
- MonthlyGrowthTimeline in src/app/portal/ — PRESERVED, never modify
- /portal is client-facing (no agent names, no LLM costs, no kill switches)
- /dashboard is admin/operator only

---

## GOVERNANCE FILES (mandatory read before any build action)
- BLUEPRINT.md
- AGENTS.md
- SCHEMA_REGISTRY.md
- BEHAVIORAL_CONTRACTS.md
- STATE_OF_THE_BUILD.md
- MASTER_BUILD_SPEC.md
- docs/design/DASHBOARD_DESIGN_SPEC.md

---

## IMMEDIATE NEXT ACTIONS (in order)

1. Fix FORGE 2.0 — the 5 bugs listed above, in the TypeScript source at C:\Users\manag\Documents\forge-2\src\
2. Write corrected queue.yaml in flat array format, place in C:\Users\manag\Documents\Tarritrix\queue.yaml
3. Launch FORGE 2.0: node C:\Users\manag\Documents\forge-2\dist\cli\index.js build . --use-existing-queue
4. Build dashboard components d1-006 through d1-019 per design spec
5. Deploy and verify tarritrix.com/dashboard

---

## KEY TECHNICAL CONSTRAINTS

- pnpm only (never npm or yarn)
- Supabase schema changes via migration files only (never manual SQL in browser)
- Vercel via CLI only
- All git commits use --no-verify for automated FORGE commits
- UTF-8 without BOM on all text files
- Real schema columns: clients.tier (not subscription_tier), clients.industry (not primary_trade), pages.service_id/city_id (joined against services/cities tables), NOT pages.service/city/state
- Drip rate: governed by BEHAVIORAL_CONTRACTS.md — do not hardcode a number
- FORGE 2.0 launch command: node C:\Users\manag\Documents\forge-2\dist\cli\index.js build . --use-existing-queue

---

## OPERATOR INFO
- master_admin UUID: 41a02568-3ddc-44b2-a8aa-98f4966f3743
- Demo client E4 Construction: UUID e4ee4ee4-0000-0000-0000-000000000001, is_demo_seed=true
- Setup: Windows, 4-monitor Mouse Without Borders, PowerShell

## INFRASTRUCTURE BUG (ongoing)
- Claude.ai file uploads arrive as 0 bytes server-side since July 3
- Workaround: gh gist create for files, plain text for short content
- Support ticket should be filed at support.claude.ai

