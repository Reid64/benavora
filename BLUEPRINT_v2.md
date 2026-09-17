# BENAVORA — Master Blueprint v2.0
## Supersedes: BLUEPRINT.md v1.0
## Date: July 17, 2026
## Status: CANONICAL — This document is the single source of truth for all architecture decisions.
## Authority: Founder directive. All FORGE queues, CC sessions, and Claude Code runs execute against this document.

---

## 1. Product Vision

Benavora is an AI-powered nonprofit intelligence operating system. It does not merely help nonprofits manage grants — it actively discovers, pursues, wins, and learns from every funding opportunity across grants, corporate donations, in-kind gifts, and disaster relief. The system operates autonomously between user sessions, delivering actionable intelligence every morning and executing outreach campaigns while the nonprofit sleeps.

**Core promise:** A solo nonprofit operator with Benavora outperforms a 10-person development team without it.

**Primary tenant:** Faith Foundation (508(c)(1)(a)) — emergency/transitional housing, rural Texas. Operated by Reid Whitesides. Org ID: `b1ab7402-dfc2-4712-869f-70ea3566cc1d`.

**Secondary market:** Small nonprofits (1-10 staff), churches, faith-based organizations, community development orgs, housing and homelessness service providers.

---

## 2. Tech Stack — Locked, Non-Negotiable

| Layer | Technology | Version/Notes |
|---|---|---|
| Framework | Next.js | 14.x, App Router only |
| Language | TypeScript | Strict mode. Zero `any` except explicit casts |
| Database | Supabase | PostgreSQL 15, Auth, RLS, Realtime, Storage, pgvector |
| Hosting | Vercel | Pro plan. `maxDuration = 300` on all AI routes |
| Package Manager | pnpm | 9.x. Never npm or yarn |
| AI Engine | Anthropic | claude-sonnet-4-6 exclusively |
| Browser Automation | Playwright | Stealth browser via Railway worker |
| Background Jobs | Railway | Worker service ID: `bd9f0c6b-fe01-4f31-9ef7-5fe9d7d0b127` |
| Email | Resend | Transactional + campaign |
| Payments | Stripe | Subscription billing |
| File Storage | Supabase Storage | Per-org buckets |
| Shell | PowerShell 5 | Windows only. No `&&`. Use semicolons |
| Version Control | Git → GitHub | Repo: `Reid64/benavora` |

**Environment:**
- Repo: `C:\Users\manag\Documents\benavora`
- Production: `www.benavora.com` / `benavora.vercel.app`
- Vercel project: `prj_7pn7UmQQsiEjTIHH58cfUU84p6xc` / team: `team_LakHkpsa9gL4kTe1WZIHBJaR`
- Supabase ref: `vbjplpquqxxfbpazyalt`
- Downloads: `C:\Users\manag\Downloads\Recent Downloads\`

---

## 3. Application Architecture

### 3.1 Directory Structure

```
src/
├── app/
│   ├── layout.tsx                          # Root layout, font loading, auth provider
│   ├── page.tsx                            # Marketing/landing page
│   ├── globals.css                         # Design tokens, compatibility layer
│   ├── login/page.tsx
│   ├── register/page.tsx
│   ├── forgot-password/page.tsx
│   ├── reset-password/page.tsx
│   ├── invite/page.tsx                     # Team invitation acceptance
│   ├── onboarding/page.tsx                 # First-run wizard
│   ├── (dashboard)/
│   │   ├── layout.tsx                      # Authenticated shell: sidebar + header
│   │   ├── dashboard/page.tsx              # Mission Control: HUD + action items + pipeline
│   │   ├── command-center/page.tsx         # Executive Command Center (owner/admin)
│   │   ├── funders/
│   │   │   ├── page.tsx
│   │   │   ├── new/page.tsx
│   │   │   └── [id]/page.tsx
│   │   ├── foundations/
│   │   │   ├── page.tsx                    # Foundation directory (133K+ records)
│   │   │   └── [id]/page.tsx               # Foundation detail + profile
│   │   ├── contacts/
│   │   │   ├── page.tsx
│   │   │   └── [id]/page.tsx
│   │   ├── opportunities/
│   │   │   ├── page.tsx                    # List with probability scores, sort/filter
│   │   │   ├── new/page.tsx
│   │   │   └── [id]/page.tsx               # Detail with probability breakdown
│   │   ├── applications/
│   │   │   ├── page.tsx                    # 12-stage Kanban pipeline
│   │   │   ├── list/page.tsx
│   │   │   ├── new/page.tsx
│   │   │   └── [id]/page.tsx               # Full detail: timeline, drafts, budget, docs
│   │   ├── draft-generator/
│   │   │   ├── page.tsx
│   │   │   ├── queue/page.tsx
│   │   │   └── [id]/page.tsx
│   │   ├── research/
│   │   │   ├── page.tsx                    # Research hub with 3x7 resource grid
│   │   │   └── match/page.tsx              # Semantic funder matching
│   │   ├── intelligence/
│   │   │   ├── page.tsx                    # Intelligence Library
│   │   │   ├── twin/page.tsx               # Organizational Digital Twin
│   │   │   ├── knowledge/page.tsx          # Funding Knowledge Engine query
│   │   │   ├── reputation/page.tsx         # Reputation Intelligence monitor
│   │   │   └── disaster/page.tsx           # Disaster Response dashboard
│   │   ├── donor-discovery/
│   │   │   ├── page.tsx                    # Overview
│   │   │   ├── prospects/page.tsx          # Prospect list
│   │   │   ├── connectors/page.tsx         # Data source connectors
│   │   │   ├── discover/page.tsx           # NAICS consumer-friendly search
│   │   │   └── corporate/                  # Corporate Intelligence Engine
│   │   │       ├── page.tsx                # Main search + filter
│   │   │       ├── [id]/page.tsx           # Full company profile
│   │   │       ├── campaigns/page.tsx      # Outreach campaign management
│   │   │       ├── monitoring/page.tsx     # Change detection feed
│   │   │       └── relationships/page.tsx  # Relationship map visualization
│   │   ├── documents/page.tsx
│   │   ├── knowledge-base/
│   │   │   ├── page.tsx
│   │   │   ├── profile/page.tsx
│   │   │   ├── narratives/page.tsx
│   │   │   └── answers/page.tsx
│   │   ├── deadlines/page.tsx
│   │   ├── compliance/page.tsx             # Compliance calendar
│   │   ├── financials/page.tsx             # Grant financial reconciliation
│   │   ├── outcomes/
│   │   │   ├── page.tsx
│   │   │   └── analytics/page.tsx
│   │   ├── reports/page.tsx                # Board reports + funding forecast
│   │   ├── import/page.tsx                 # CSV import wizard
│   │   ├── alerts/page.tsx
│   │   ├── admin/
│   │   │   ├── page.tsx                    # Platform admin (owner only)
│   │   │   ├── autoapply-ops/page.tsx
│   │   │   ├── monitor/page.tsx
│   │   │   ├── audit-log/page.tsx
│   │   │   ├── sales-outreach/page.tsx
│   │   │   └── orgs/[id]/page.tsx          # Org detail for owner
│   │   └── settings/
│   │       ├── page.tsx
│   │       ├── integrations/page.tsx
│   │       ├── notifications/page.tsx
│   │       ├── agents/page.tsx             # Agent Marketplace
│   │       └── white-label/page.tsx
│   └── api/
│       ├── auth/callback/route.ts
│       ├── onboarding/route.ts
│       ├── agents/
│       │   ├── research/route.ts
│       │   ├── research/status/route.ts
│       │   ├── eligibility/route.ts
│       │   ├── email-parser/route.ts
│       │   ├── form-analyzer/route.ts
│       │   ├── form-filler/route.ts
│       │   ├── automation/route.ts
│       │   ├── automation/[sessionId]/route.ts
│       │   ├── automation/[sessionId]/approve/route.ts
│       │   ├── competitor-intel/route.ts
│       │   ├── corporate-research/route.ts
│       │   ├── custom-api/route.ts
│       │   ├── custom-scrape/route.ts
│       │   ├── deadline-prediction/route.ts
│       │   ├── follow-up/route.ts
│       │   ├── foundation-finder/route.ts
│       │   ├── funder-intel/route.ts
│       │   ├── funder-relationship/route.ts
│       │   ├── application-cloner/route.ts
│       │   ├── campaigns/route.ts
│       │   ├── campaigns/[campaignId]/route.ts
│       │   ├── registry/route.ts           # Agent marketplace registry
│       │   ├── discovery/route.ts          # Opportunity discovery
│       │   ├── morning-digest/route.ts     # Morning digest
│       │   └── disaster/route.ts           # Disaster response
│       ├── ai/
│       │   ├── draft/route.ts
│       │   ├── summarize/route.ts
│       │   ├── fit-analysis/route.ts
│       │   └── review/route.ts
│       ├── intelligence/
│       │   ├── grant-probability/route.ts
│       │   ├── digital-twin/route.ts
│       │   ├── knowledge-query/route.ts
│       │   ├── reputation/route.ts
│       │   ├── deadline-predictions/route.ts
│       │   └── proposals/route.ts
│       ├── funders/
│       │   ├── route.ts
│       │   ├── [id]/route.ts
│       │   ├── [id]/relationship/route.ts
│       │   └── relationship-scores/route.ts
│       ├── foundations/
│       │   ├── route.ts
│       │   └── [id]/profile/route.ts
│       ├── opportunities/
│       │   ├── route.ts
│       │   └── [id]/probability/route.ts
│       ├── applications/
│       │   ├── route.ts
│       │   ├── [id]/route.ts
│       │   ├── [id]/budget/route.ts
│       │   ├── [id]/expenses/route.ts
│       │   ├── [id]/reconcile/route.ts
│       │   └── [id]/clone/route.ts
│       ├── donor-discovery/
│       │   ├── prospects/route.ts
│       │   ├── requests/route.ts
│       │   ├── connectors/route.ts
│       │   ├── discover/route.ts
│       │   └── prospects/[id]/
│       │       ├── route-to-autoapply/route.ts
│       │       └── route-to-email/route.ts
│       ├── sources/
│       │   ├── samgov/route.ts
│       │   └── grantsgov/route.ts
│       ├── match/foundations/route.ts
│       ├── import/csv/route.ts
│       ├── reports/board-report/route.ts
│       ├── compliance/events/route.ts
│       ├── compliance/events/[id]/route.ts
│       ├── consultant/clients/route.ts
│       ├── settings/notifications/route.ts
│       ├── admin/
│       │   ├── platform-metrics/route.ts
│       │   └── orgs/[id]/suspend/route.ts
│       ├── automation/stats/route.ts
│       └── webhooks/
│           ├── stripe/route.ts
│           └── email-events/route.ts
├── components/
│   ├── ui/                                 # Shared primitives
│   ├── layout/
│   │   ├── Sidebar.tsx                     # Navy #1A2B3C sidebar with role-gated nav
│   │   └── Header.tsx
│   ├── dashboard/
│   │   ├── FlightPathHUD.tsx               # 6-stage lifecycle HUD (flip cards)
│   │   ├── MetricCard.tsx
│   │   ├── DeadlineWidget.tsx
│   │   ├── PipelineSummary.tsx
│   │   └── RecentActivityFeed.tsx
│   ├── applications/pipeline.ts            # Pipeline stage constants
│   └── [feature]/                          # Feature-specific components
├── lib/
│   ├── supabase/
│   │   ├── client.ts                       # Browser client
│   │   └── server.ts                       # Server client (SSR)
│   ├── auth/
│   │   └── role-gate.ts                    # requireRole() per-request enforcement
│   ├── utils/
│   │   ├── constants.ts                    # PIPELINE_STAGES, MIN_OUTCOMES_FOR_RATE
│   │   └── formatters.ts                   # formatCurrency, formatRelative
│   ├── ai/
│   │   └── learning/outcome-analyzer.ts    # analyzeOutcomes()
│   ├── sources/
│   │   ├── grantsgov-client.ts
│   │   └── samgov-client.ts
│   ├── intelligence/
│   │   ├── grant-probability-engine.ts     # computeGrantProbability()
│   │   ├── digital-twin-builder.ts         # buildDigitalTwin()
│   │   ├── semantic-matcher.ts             # matchFunders()
│   │   ├── foundation-profiler.ts          # computeFoundationProfile()
│   │   ├── success-probability.ts          # computeSuccessProbability()
│   │   ├── deadline-predictor.ts           # predictDeadlines()
│   │   ├── relationship-scorer.ts          # computeRelationshipScore()
│   │   ├── reputation-agent.ts             # checkEntityReputation()
│   │   ├── knowledge-engine.ts             # queryKnowledgeEngine()
│   │   └── board-report-generator.ts       # generateBoardReport()
│   ├── agents/
│   │   ├── agent-registry-seed.ts          # AGENT_REGISTRY_SEED constant
│   │   ├── opportunity-discovery-agent.ts  # runOpportunityDiscovery()
│   │   ├── morning-digest.ts               # sendMorningDigest()
│   │   └── disaster-response-agent.ts      # pollFEMADeclarations()
│   ├── donor-discovery/
│   │   └── naics-labels.ts                 # NAICS_FRIENDLY_LABELS
│   ├── notifications/
│   │   └── notify.ts                       # notify()
│   └── reports/
│       └── board-report-generator.ts
├── middleware.ts                            # Auth + onboarding gate
├── supabase/
│   └── migrations/                         # 001 through 097+ (see SCHEMA_REGISTRY)
└── scripts/                                # CLI enrichment and ingestion scripts
    ├── enrich-foundations-990.ts
    ├── enrich-propublica-batch.ts
    ├── ingest-nih-reporter.ts
    ├── ingest-nsf-awards.ts
    ├── ingest-federal-register.ts
    ├── ingest-samhsa-hrsa.ts
    ├── batch-score-opportunities.ts
    └── import-prospects.ts
```

### 3.2 Role System

| Role | Capabilities |
|---|---|
| `owner` | All capabilities including billing, platform admin, white-label, Command Center |
| `admin` | All CRUD. Cannot manage billing or delete org |
| `writer` | Create/edit drafts, applications, notes. Cannot delete funders or modify org settings |
| `viewer` | Read-only. Cannot create or edit |

Role is read from `profiles.role` on every request via middleware. Never trusted from cookies or client state. Second enforcement via `requireRole()` in `src/lib/auth/role-gate.ts`.

### 3.3 Navigation Structure (Current)

**Primary Nav (Sidebar — all authenticated users):**
- Dashboard
- Research (hub with resource grid + funder match)
- Funders
- Foundations
- Contacts
- Opportunities (with probability scores)
- Applications (12-stage pipeline)
- Draft Generator
- Documents
- Knowledge Base
- Intelligence Library
- Deadlines
- Compliance
- Outcomes & Analytics
- Financials
- Reports
- Donor Discovery
- Alerts
- Import
- Settings

**Intelligence Sub-Nav:**
- Intelligence Library
- Digital Twin
- Knowledge Engine
- Reputation Monitor
- Disaster Response

**Donor Discovery Sub-Nav:**
- Overview
- Prospects
- Corporate Intelligence
- NAICS Discover
- Connectors

**Admin Nav (owner only):**
- Platform Admin
- AutoApply Ops
- Monitor
- Audit Log
- Sales Outreach
- Command Center

**Settings Sub-Nav:**
- General
- Integrations
- Notifications
- Agent Marketplace
- White-Label

---

## 4. Data Architecture

### 4.1 Multi-Tenancy Model
All user data is org-scoped via `organization_id` foreign key. RLS policies enforce that users can only read/write their own org's data. The `service role` key bypasses RLS for admin operations and background jobs only — never exposed to the client.

### 4.2 Core Data Principles
1. Every entity has one source of truth table. Never duplicate across tables.
2. All enrichment data stored as `jsonb`. Never add columns per enrichment field.
3. All scoring data stored as `jsonb`. Never add columns per score type.
4. All relationship data in `pig_edges`. Never encode relationships as foreign keys.
5. All AI outputs include: model, tokens_consumed, confidence, generated_at.
6. All background jobs log to `agent_runs` with full input/output.
7. All money in USD cents (integer). Never floating point.
8. Migrations are sequential and idempotent. Use `IF NOT EXISTS` on all DDL.

### 4.3 Identity Chain
```
auth.users (Supabase Auth)
  └── profiles (id = auth.uid, organization_id, role)
        └── organizations (id, name, plan, stripe fields, onboarding_completed)
              └── [all user data tables] (organization_id FK)
```

### 4.4 Key External Tables (Shared, Not Org-Scoped)
- `foundation_directory` — 133,812+ foundation records (shared across all orgs)
- `corporate_prospects` — company intelligence records (shared)
- `intelligence_funded_proposals` — grant proposal corpus (shared)
- `knowledge_patterns` — funding pattern intelligence (shared)
- `pig_nodes` / `pig_edges` — philanthropic graph (shared)
- `disaster_declarations` — FEMA declarations (shared)

---

## 5. Platform Pillars (18 Total)

See `PLATFORM_VISION_ARCHITECTURE.md` for full specification of each pillar.

| # | Pillar | Status | Phase |
|---|---|---|---|
| 1 | Philanthropic Intelligence Graph | PLANNED | Phase 3 |
| 2 | AI Opportunity Discovery Engine | IN BUILD | Phase 1 |
| 3 | Corporate Giving Intelligence | IN BUILD | Phase 1 |
| 4 | Autonomous Relationship Builder | PLANNED | Phase 2 |
| 5 | Grant Probability Engine | IN BUILD | Phase 1 |
| 6 | Organizational Digital Twin | IN BUILD | Phase 1 |
| 7 | Autonomous Proposal Factory | PARTIAL | Phase 1 |
| 8 | Corporate Outreach Factory | IN BUILD | Phase 1 |
| 9 | Donation Recommendation Marketplace | PLANNED | Phase 3 |
| 10 | National Disaster Response Engine | IN BUILD | Phase 1 |
| 11 | Predictive Funding Forecast | PLANNED | Phase 2 |
| 12 | AI Board Advisor | PLANNED | Phase 3 |
| 13 | Community Impact Simulator | PLANNED | Phase 4 |
| 14 | Funding Gap Analyzer | PARTIAL | Phase 1 |
| 15 | Reputation Intelligence | IN BUILD | Phase 1 |
| 16 | Executive Command Center | IN BUILD | Phase 1 |
| 17 | Agent Marketplace | IN BUILD | Phase 1 |
| 18 | Funding Knowledge Engine | IN BUILD | Phase 1 |

---

## 6. Agent Architecture

See `AGENTS_v2.md` for full agent specifications (AG-01 through AG-30).

**Nightly Pipeline Execution Order (Railway worker, 2AM-7AM CST):**
```
2:00 AM — AG-17: Opportunity Discovery
2:30 AM — AG-15: Grant Probability (batch)
3:00 AM — AG-20/21: Corporate Enrichment (batch)
3:30 AM — AG-22: Propensity Scoring (batch)
4:00 AM — AG-18: Reputation Intelligence
4:30 AM — AG-19: Relationship Builder
5:00 AM — AG-25: Disaster Response (FEMA poll)
5:30 AM — AG-23: Relationship Mapper (incremental)
6:00 AM — AG-29: Knowledge Engine Indexer
7:00 AM — Morning digest notification sent
```

---

## 7. Design System

### 7.1 Color Palette (Locked)
```
Canvas background:    #C8D4DC  (medium blue-gray)
Sidebar:              #1A2B3C  (deep navy)
Primary accent:       #0077B6  (ocean blue)
Secondary accent:     #0096C7  (cyan)
Tertiary accent:      #00B4D8  (bright cyan)
Violet accent:        #6B48CC  (for Grant Narratives, Drafts)
Deep purple:          #4C3D8F  (for Donor Discovery)
Steel blue:           #023E8A  (for AutoApply)
Card surface:         #FFFFFF  (white)
Card tray:            #B8C4CC  (medium gray)
Text primary:         #0F172A
Text secondary:       #64748B
Border:               #B8C9D9
```

### 7.2 FlightPathHUD Stage Colors (Locked)
```
Onboard:          #1A2B3C  (deep navy)
Research:         #0077B6  (ocean blue)
Opportunities:    #0096C7  (cyan)
Grant Narratives: #6B48CC  (violet)
AutoApply:        #023E8A  (steel blue)
Donor Discovery:  #4C3D8F  (deep purple)
```

### 7.3 Typography
- Font: Plus Jakarta Sans (500, 600, 700, 800 weights via Google Fonts)
- Headings: 700-800 weight, -0.02em letter spacing
- Card labels: 11px, 700 weight, uppercase, 0.08em tracking
- Body: 14px, 400 weight
- Metric numbers: 40px (large), 24px (compact), 900 weight

### 7.4 Card Elevation System
```
Level 0: Canvas       #C8D4DC — page background
Level 1: Section Tray #B8C4CC — groups related cards, inset shadow
Level 2: Card         #FFFFFF — white, 16px radius, shadow 0 4px 20px rgba(0,0,0,0.12)
Level 3: Elevated     Colored top band (8px) on stat/metric cards
Level 4: Hero         Linear gradient navy-to-blue, 20px radius, strong shadow
```

### 7.5 The Only UI Rule That Works
**All colors, backgrounds, shadows, and borders must use inline `style={{}}` props with hardcoded hex values in JSX.**

Never use: CSS variables, Tailwind color tokens, global CSS for component colors.
Tailwind is permitted for: layout (flex, grid, gap, p-, m-, w-, h-), typography (text-sm, font-bold), and non-color utilities only.

Reason: `globals.css` contains a compatibility layer with `!important` rules that override Tailwind color classes. Inline styles have higher specificity and cannot be overridden.

---

## 8. Deployment Architecture

### 8.1 Vercel (Frontend + API Routes)
- Auto-deploys from `main` branch **BUT** GitHub auto-deploy is currently broken
- **Always run `npx vercel deploy --prod` after every git push to guarantee production updates**
- All AI routes: `export const maxDuration = 300`
- Force dynamic on all dashboard pages: `export const dynamic = 'force-dynamic'`
- Sensitive env vars: write-only in Vercel dashboard, use `[IO.File]::WriteAllText` + `cmd` stdin for injection

### 8.2 Railway (Worker Service)
- Worker ID: `bd9f0c6b-fe01-4f31-9ef7-5fe9d7d0b127`
- Handles: all long-running enrichment jobs, nightly agent pipeline, Playwright automation
- tsc-alias path fix committed `fbcc1d0`
- Monitor via Railway dashboard for failed deploys

### 8.3 Supabase
- Ref: `vbjplpquqxxfbpazyalt`
- Management API: `https://api.supabase.com/v1/projects/vbjplpquqxxfbpazyalt/database/query`
- Token: `sbp_a63596024b79b5964d2dc2971ac9d4cc77a112c1`
- 89+ migrations applied
- Management API rejects non-ASCII characters — always use ASCII in SQL
- Split large SQL into separate statements to avoid payload limits
- `list_migrations` and `execute_sql` MCP tools return permission errors — use REST API as fallback

---

## 9. FORGE Build System

### 9.1 FORGE 1.x (Primary Overnight Build Tool)
- Location: `C:\Users\manag\Documents\FORGE\forge.ps1`
- Queue: `C:\Users\manag\Documents\FORGE\projects\benavora\queue.yaml`
- Launch command:
```powershell
cd C:\Users\manag\Documents\FORGE; $env:NODE_OPTIONS="--max-old-space-size=8192"; $env:ANTHROPIC_API_KEY=$null; powershell -ExecutionPolicy Bypass -File .\forge.ps1 -project benavora -startFrom 0
```

### 9.2 FORGE Critical Rules
1. Queue file must be at exact path above before launch. No `-queue` parameter.
2. `$env:ANTHROPIC_API_KEY=$null` is mandatory — forces Max subscription usage, not API billing.
3. `dangerouslySkipPermissions`: run `claude config set -g dangerouslySkipPermissions true` once separately. Inline env var never works in PS5.
4. `phases:` key causes silent "Found 0 prompts" exit. Always use flat `prompts:` list.
5. Prompts over 200 words cause recovery agent to complete in seconds with no files created.
6. FORGE cannot create files with `[id]` in path on Windows. Pre-create these with `[IO.File]::WriteAllText()` using `-LiteralPath`.
7. FORGE validates compile gates only — not visual quality, data population, or runtime behavior.
8. Pre-install all npm/pnpm dependencies before FORGE runs. Never inside prompts.
9. After `git reset --hard` also run `git clean -fd` to remove untracked files.
10. Governance docs must be in `C:\Users\manag\Documents\FORGE\projects\benavora\` for FORGE to inject them.
11. After every FORGE run: manually run `npx vercel deploy --prod` — GitHub auto-deploy is broken.

### 9.3 Claude Code Rules
1. Read actual files completely before writing any code.
2. Verify exact export names, interfaces, function signatures before use.
3. Never guess — fabrication wastes significant time.
4. Always commit + push after every CC session.
5. CC does not auto-commit — always include explicit git commands in prompts.
6. UI changes: one component per CC session. Read → rewrite → verify visually → commit.

---

## 10. Known Bugs and Blockers

| Bug | Status | Fix |
|---|---|---|
| IRS 990 stream parser EIN column | QUEUED FIX | EIN at position 1 (zero-indexed), parser reads wrong column. Trim headers before lookup. |
| Duplicate Faith Foundation orgs | UNRESOLVED | Two records in organizations table. Manual dedup needed. |
| DATAOCEAN backup | CRITICAL RISK | `enrichment-output/` never backed up to `D:\`. Reruns overwrite. |
| `.claude/worktrees/` in git | KNOWN | Add to `.gitignore`. Appears in commits but non-fatal. |
| GitHub → Vercel auto-deploy | BROKEN | Always run `npx vercel deploy --prod` manually after every push. |
| Intelligence Library duplicates | FIXED IN queue | Dedup check added. Truncate NIH records before re-ingest. |
| Admin page 404 | FIXED | Built in last FORGE run. |
| Alerts API 500 | FIXED IN queue | Route corrected in last FORGE run. |
| AutoApply could report a submission it never made | FIXED (AR-3.1, 2026-09-17) | Browser silently refuses an HTML5-`required` submit with no exception/navigation; `FormFillerAgent` couldn't tell that apart from success. Fixed: real field_mapping adapter, pre-submit required-field gate, verified-signal submit, new `submit_unverified` status. See `STATE_OF_THE_BUILD.md` "AR-3.1" and `AUTOAPPLY_ARCHITECTURE_V2.md`. Migration 184 (status enum) applied live via Supabase MCP this session — confirmed by re-querying the constraint definition before and after. |

---

## 11. API Keys and Credentials

| Service | Key/ID | Notes |
|---|---|---|
| Supabase Management | `sbp_a63596024b79b5964d2dc2971ac9d4cc77a112c1` | Never expose to client |
| SAM.gov | `SAM-ca328c91-250e-4b51-a4cc-ab90ef5aab7a` | Federal opportunities |
| Google Places | `AIzaSyA3sJ1vkNp1AvPLfKY_5uaiJK0FBiwjlt0` | Business discovery |
| Vercel project | `prj_7pn7UmQQsiEjTIHH58cfUU84p6xc` | Deployment |
| Vercel team | `team_LakHkpsa9gL4kTe1WZIHBJaR` | Account scope |
| Railway worker | `bd9f0c6b-fe01-4f31-9ef7-5fe9d7d0b127` | Background jobs |
| Faith Foundation org ID | `b1ab7402-dfc2-4712-869f-70ea3566cc1d` | Primary test tenant |

---

## 12. Build Progress

### Completed (as of July 17, 2026)
- All Phase 1 MVP features (18 features)
- All Tier 1-5 enhancements (34 features)
- Tier 6 partial: SAM.gov client, ProPublica batch, CSV import, AutoApply modes, foundation profiler, success probability, competitor intel, semantic funder matching, outreach templates, follow-up sequences, grant financial reconciliation, compliance calendar, deadline prediction, application cloning, funder relationship scoring, white-label portal, notification preferences, board report generator
- Donor Discovery Phases 1-4: NAICS taxonomy, Google Places adapter, enrichment agent, scoring engine, worker handlers
- Platform Admin dashboard and metrics API
- Intelligence Library ingestion scripts (NIH Reporter, NSF, Federal Register, SAMHSA/HRSA)
- Research Resources enterprise data layer and UI

### In Progress (overnight builds)
- Grant Probability Engine (Pillar 5)
- Organizational Digital Twin (Pillar 6)
- Agent Marketplace (Pillar 17)
- Opportunity Discovery Engine (Pillar 2)
- Reputation Intelligence (Pillar 15)
- Disaster Response Engine (Pillar 10)
- Knowledge Engine foundation (Pillar 18)
- Executive Command Center (Pillar 16)

### Remaining (future FORGE runs)
- Philanthropic Intelligence Graph (Pillar 1)
- Autonomous Relationship Builder (Pillar 4)
- Predictive Funding Forecast (Pillar 11)
- AI Board Advisor (Pillar 12)
- Community Impact Simulator (Pillar 13)
- Donation Recommendation Marketplace (Pillar 9)
- Corporate Intelligence Engine Phase 2-5
- Full test suite
- UI redesign completion (all pages)
- IRS BMF 1.8M import
- 298K prospect CSV import
- Intelligence Library corpus (Nights 2-7)

---

## 13. PowerShell 5 Critical Patterns

```powershell
# CORRECT: File write with no encoding corruption
[IO.File]::WriteAllText($path, $content)

# CORRECT: Read file without trailing newline issues
[IO.File]::ReadAllText($path)

# CORRECT: Create file in path with brackets
[IO.File]::WriteAllText($full, "export {}")

# CORRECT: Test path with brackets
Test-Path -LiteralPath $full

# CORRECT: Copy file with spaces in path
Copy-Item "C:\path with spaces\file.txt" "C:\dest\file.txt"

# WRONG: && chaining (not supported in PS5)
git add . && git commit  # NEVER USE

# CORRECT: Semicolon chaining
git add .; git commit -m "msg"; git push

# WRONG: Sensitive env var via pipeline
"myvalue" | vercel env add KEY  # Appends newline, corrupts value

# CORRECT: Sensitive env var injection
[IO.File]::WriteAllText("C:\tmp\val.txt", "myvalue")
cmd /c "vercel env add KEY production < C:\tmp\val.txt"
```
