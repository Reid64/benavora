# benavora — ARCHITECTURE (FORGE Phase 1B)

- **Generated:** 2026-06-12T18:24:54.126Z
- **Mode:** greenfield
- **Model:** claude-sonnet-4-6
- **Design system:** generated → C:\Users\manag\Documents\benavora\governance\DESIGN_SYSTEM.md (injected into UI prompts)
- **⚠️ Fallback artifacts:** database (could not be generated — complete or re-run before approval)

> Gate 2: the build HALTS here until a human approves this architecture (Contract 2).

---

# Database Architecture (FALLBACK SKELETON)

> ⚠️ FORGE Phase 1B could not generate this artifact (non-JSON model output). This is an empty
> skeleton — a human must complete it, or re-run Phase 1B once the Anthropic API is
> reachable. The build is HALTED at Gate 2 regardless.

---

# API Architecture

## Overview

Benavora's API layer is built on **Next.js 14 App Router Route Handlers** (`/app/api/...`) backed by **Supabase Postgres** with Row-Level Security. Every route derives `organization_id` exclusively from the authenticated Supabase session — it is never accepted from request bodies or query parameters. All multi-tenant tables enforce RLS policies keyed on `organization_id`.

---

## Authentication & Authorization

- Authentication: Supabase Auth JWT, verified via `supabase.auth.getUser()` on every request.
- Authorization: Three roles — `grants_manager`, `executive_director`, `grant_researcher`. Role is stored in the `users` table and checked after session validation.
- `organization_id` is read from the verified session user record only.
- Unauthenticated requests receive HTTP 401 `UNAUTHORIZED`.
- Cross-organization access attempts receive HTTP 403 `FORBIDDEN` (enforced at both RLS and application layer).

---

## Response Envelope

All successful responses:
```json
{ "data": <T> }
```
All error responses:
```json
{ "error": { "code": "STRING_CODE", "message": "Human readable", "fields": { "fieldName": "error" } } }
```

---

## Routes

### Grants

#### `GET /api/grants`
**Purpose:** List grants for the authenticated organization.

**Auth:** Required. Roles: `grants_manager`, `executive_director`, `grant_researcher`.

**Query Params:**
| Param | Type | Description |
|---|---|---|
| source_type | string | Comma-separated enum values to filter by |
| eligibility_flag | string | One of: high_match, moderate_match, low_match, unscored |
| status | string | Pipeline status stage |
| from | ISO date | Start of date range filter |
| to | ISO date | End of date range filter |
| page | number | Page number (default: 1) |
| limit | number | Results per page (default: 25, max: 100) |

**DB Reads:** `grants`

**Errors:** 401 UNAUTHORIZED, 400 INVALID_FILTER, 500 DB_ERROR

---

#### `GET /api/grants/[id]`
**Purpose:** Fetch full detail for a single grant.

**Auth:** Required. Roles: all.

**Path Params:** `id` (UUID)

**DB Reads:** `grants`

**Errors:** 401, 403 FORBIDDEN, 404 NOT_FOUND, 500 DB_ERROR

---

#### `PATCH /api/grants/[id]`
**Purpose:** Update mutable grant fields including `source_type`.

**Auth:** Required. Roles: `grants_manager`, `grant_researcher`.

**Request Body (partial):**
```ts
{
  source_type?: 'federal_government' | 'state_government' | 'local_government' |
                'private_foundation' | 'corporate_foundation' | 'community_foundation' |
                'international' | 'faith_based' | 'individual_donor' | 'other',
  status?: string,
  amount_requested?: number,  // cents
  amount_awarded?: number,    // cents
  deadline?: string           // ISO date
}
```

**DB Reads:** `grants` (ownership check)
**DB Writes:** `grants`

**Errors:** 401, 403, 404, 400 INVALID_SOURCE_TYPE, 500 DB_ERROR

---

#### `POST /api/grants/[id]/rescore`
**Purpose:** Trigger manual eligibility re-score via Anthropic Claude.

**Auth:** Required. Roles: `grants_manager`, `grant_researcher`.

**Behavior:**
1. Fetches grant and organization's `search_profiles.eligibility_filters`.
2. Constructs AI prompt; calls Anthropic Claude.
3. Parses `{ score, rationale }` from response.
4. Updates `match_percentage`, `eligibility_flag`, `eligibility_notes`, `eligibility_scored_at`.
5. Flag thresholds: ≥80 → `high_match`; 50–79 → `moderate_match`; <50 → `low_match`.

**DB Reads:** `grants`, `search_profiles`
**DB Writes:** `grants`

**Errors:** 401, 403, 404, 422 NO_SEARCH_PROFILE, 502 AI_PROVIDER_ERROR, 500 DB_ERROR

---

### Research

#### `POST /api/research/run`
**Purpose:** Initiate a parallel research run across all active agents.

**Auth:** Required. Roles: `grants_manager`, `grant_researcher`.

**Request Body:**
```ts
{ search_profile_id?: string }  // optional UUID override
```

**Behavior:**
1. Checks for existing `research_runs` row with `status='running'` for org → 409 if found.
2. INSERTs `research_runs` row (`status='running'`, `started_at=now()`).
3. INSERTs one `research_run_agents` row per active agent (`status='pending'`).
4. Responds immediately with `{ research_run_id, status: 'running', agent_count }`.
5. Asynchronously: runs all agent tasks via `Promise.allSettled`; updates `research_run_agents` rows as each settles; runs deduplication pipeline; INSERTs unique grants; triggers eligibility scoring jobs; updates `research_runs.status` and `deduplication_stats`.

**Deduplication Pipeline:**
- Normalize URLs (strip UTM params, trailing slashes, lowercase).
- Group by normalized URL; keep first occurrence.
- For URL-less entries: fuzzy match on `(funder_name, program_name)` with Levenshtein ≤ 3.
- Merge metadata (union tags, highest confidence score).
- Cross-check against existing `grants` rows for org; skip if already tracked.

**Agent Timeouts:** 90s per agent via `Promise.race` with `AbortController`.
**Rate Limit Retry:** Single retry after 5s on HTTP 429.

**DB Reads:** `research_runs`, `agents`, `search_profiles`
**DB Writes:** `research_runs`, `research_run_agents`

**Errors:** 401, 409 RUN_IN_PROGRESS, 422 NO_ACTIVE_AGENTS, 500 DB_ERROR

---

#### `GET /api/research/runs`
**Purpose:** List past research runs with summary stats.

**Auth:** Required. Roles: all.

**Query Params:** `page`, `limit`

**DB Reads:** `research_runs`

**Errors:** 401, 500 DB_ERROR

---

#### `GET /api/research/runs/[id]`
**Purpose:** Fetch a single research run with per-agent statuses and deduplication stats.

**Auth:** Required. Roles: all.

**Response includes:** `deduplication_stats: { total_found, duplicates_removed, unique_saved, already_tracked }`

**DB Reads:** `research_runs`, `research_run_agents`

**Errors:** 401, 403, 404, 500 DB_ERROR

---

### Search Profiles

#### `GET /api/search-profiles`
**Purpose:** Fetch the organization's search profile. Returns 404 if none exists; frontend applies hardcoded defaults.

**Auth:** Required. Roles: all.

**DB Reads:** `search_profiles`

**Errors:** 401, 404 NOT_FOUND, 500 DB_ERROR

---

#### `POST /api/search-profiles`
**Purpose:** Create or update (upsert by `organization_id`) the search profile.

**Auth:** Required. Roles: `grants_manager`, `grant_researcher`.

**Request Body:**
```ts
{
  funding_types: string[],                  // min 1 required
  source_type_filters: string[],
  focus_area_weights: Record<string, number>, // 0–100 per area
  amount_min: number,                        // cents
  amount_max: number | null,                 // null = unlimited
  geographic_scope: {
    type: 'national' | 'regional' | 'state' | 'local' | 'international',
    states?: string[]                        // required if type='state'
  },
  eligibility_filters: {
    is_501c3: boolean,
    min_years_operation: number,
    budget_min: number | null,
    budget_max: number | null,
    staff_size_min: number | null,
    staff_size_max: number | null,
    served_populations: string[]
  },
  negative_filters: string[]                 // exclusion tags
}
```

**Validation Rules:**
- `amount_min` must be ≤ `amount_max` (when max is not null).
- `funding_types` must have at least one entry.
- If `geographic_scope.type === 'state'`, `states` array must be non-empty.
- `amount_max = 0` is coerced to `null` (unlimited).

**DB Reads:** `search_profiles` (upsert check)
**DB Writes:** `search_profiles`

**Errors:** 401, 400 VALIDATION_ERROR, 500 DB_ERROR

---

### Analytics

All analytics routes are read-only, require authentication, support all three roles, and accept optional `from`/`to` ISO date query params (defaulting to last 30 days when omitted). All queries are SQL aggregations executed server-side for performance; target response time <2s for datasets up to 10,000 grants.

#### `GET /api/analytics/summary`
Returns: `{ total_grants, total_requested, total_awarded, success_rate, previous_success_rate, amounts_incomplete_pct }`

**DB Reads:** `grants`

---

#### `GET /api/analytics/funnel`
Returns: `{ stage, count, drop_off_pct }[]` for stages: Discovered → Researching → Eligible → Applied → Under Review → Awarded/Rejected.

**DB Reads:** `grants`

---

#### `GET /api/analytics/financials`
Returns: `{ month (YYYY-MM), total_requested, total_awarded }[]` grouped by calendar month.

**DB Reads:** `grants`

---

#### `GET /api/analytics/by-source`
Returns: `{ source_type, count, total_amount }[]` — powers the source category pie chart.

**DB Reads:** `grants`

---

#### `GET /api/analytics/deadlines`
Returns: `{ date (ISO), count }[]` for grants with deadlines in the next 90 days from today.

**DB Reads:** `grants`

---

#### `GET /api/analytics/agent-activity`
Returns: `{ date (ISO), runs, grants_found, duplicates_removed }[]`.

**DB Reads:** `research_runs`

---

### Alerts

#### `GET /api/alerts`
**Purpose:** List alerts for the organization.

**Query Params:** `unread_only?: boolean`, `page`, `limit`

**Response:** `{ data: Alert[], total, unread_count }`

**DB Reads:** `alerts`

**Errors:** 401, 500 DB_ERROR

---

#### `POST /api/alerts/[id]/read`
**Purpose:** Mark a single alert as read.

**DB Reads:** `alerts` (ownership check)
**DB Writes:** `alerts`

**Errors:** 401, 403, 404, 500 DB_ERROR

---

#### `POST /api/alerts/read-all`
**Purpose:** Mark all unread alerts as read for the organization.

**DB Reads:** `alerts`
**DB Writes:** `alerts`

**Response:** `{ data: { updated_count: number } }`

**Errors:** 401, 500 DB_ERROR

---

### Consensus Validation

#### `POST /api/consensus/validate`
**Purpose:** Run multi-model consensus validation on a grant using Anthropic Claude + OpenAI GPT-4o in parallel.

**Auth:** Required. Roles: `grants_manager`, `grant_researcher`.

**Request Body:**
```ts
{ grant_id: string }
```

**Behavior:**
1. Fetches grant details and org search profile.
2. Runs both AI model calls in parallel via `Promise.allSettled`.
3. Each model returns `{ verdict: string, rationale: string, score: number }`.
4. Consensus logic: if both models agree → `validated` or `rejected`; if they disagree → `disputed`.
5. Confidence = average of both model scores.
6. Writes result to `consensus_validations` table and updates `grants.consensus_status`.

**DB Reads:** `grants`, `search_profiles`
**DB Writes:** `grants`, `consensus_validations`

**Errors:** 401, 403, 404, 502 AI_PROVIDER_ERROR, 500 DB_ERROR

---

#### `GET /api/consensus/[grant_id]`
**Purpose:** Fetch the latest consensus validation result for a grant.

**DB Reads:** `consensus_validations`, `grants`

**Errors:** 401, 403, 404, 500 DB_ERROR

---

## Background & Cron Jobs

### Stale Run Cleanup — `GET /api/cron/cleanup-stale-runs`
- **Schedule:** Every 10 minutes via Vercel Cron.
- **Action:** Marks any `research_runs` row with `status='running'` and `started_at < now() - interval '10 minutes'` as `status='failed'`.
- **Auth:** Vercel Cron secret header `Authorization: Bearer $CRON_SECRET`.

### Eligibility Scoring (Async)
- Triggered internally after grant INSERT during research run completion.
- Calls Anthropic Claude; updates `grants.match_percentage`, `eligibility_flag`, `eligibility_notes`, `eligibility_scored_at`.
- If `eligibility_flag='high_match'` and grant age <24h, INSERTs into `alerts` with `alert_type='high_match_grant'`.

### AR-13.2 full trigger & scheduler inventory (2026-09-19)

The two entries above are one Vercel cron and one internal side-effect —
neither is the complete picture. Full inventory, built and live-verified for
`test-evidence/SCHEDULER_MAP.md`:

- **7 Vercel cron entries** (`vercel.json`): `/api/cron/research` (daily
  06:00 UTC), `/api/cron/grantsgov` (daily 07:00), `/api/cron/reminders`
  (daily 08:00), `/api/cron/autoapply` (daily 02:00), `/api/cron/domain-warmup`
  (daily 06:00), `/api/cron/autoapply-retry` (hourly), `/api/cron/pil-research`
  (every 10 min). All `CRON_SECRET`-gated.
- **`worker/scheduler.ts`**: a single `setInterval` 60s wall-clock tick
  (no `node-cron` dependency) firing 12 named jobs at fixed America/Chicago
  HH:MM — the nightly autonomous pipeline, morning digest, and 10 AG-family
  pipelines (AG-10/23/25/26/27/32/36/38/42 plus 2 scraper jobs gated behind
  `ENABLE_SCRAPER`). No failure counter exists — a job that throws every
  night still fires every night.
- **5 continuous poll loops started at Railway worker boot**
  (`worker/index.ts`): `queue-processor.ts` (`submission_queue`, 15s),
  `dd-request-processor.ts` (`donor_discovery_requests`, 15s),
  `enrichment-processor.ts` (`corporate_prospects`, 60s),
  `knowledge-indexer-processor.ts` (AG-29, 60s), `alert-notifier.ts`
  (`alerts`, 60s) — plus `stuck-run-watchdog.ts` (10 min sweep, marks stuck
  rows failed but never un-schedules an agent type) and
  `processAgentQueue()` (`agent_queue`, 30s empty-sleep).
- **Database-side scheduling: none.** `pg_cron`, `pg_net`, and `http` are
  **not installed** on this project — confirmed live 2026-09-19 via
  `pg_extension` and `information_schema.schemata` queries returning zero
  rows for all three. Every trigger on this platform is either a Vercel
  cron entry or a Node.js interval/poll loop inside the Railway worker.
- **`ag-29-knowledge-indexer` is architecturally different from every other
  poller**: its loop calls `KnowledgeIndexerAgent.run()`, which writes a
  formal `agent_runs` row via `startRun()` **before** checking whether any
  indexable row exists. Every other poller checks for work first and stays
  silent when there is none. This is why one agent accounts for 96% of all
  `agent_runs` rows ever written (67,184 lifetime; 64,533 are this one
  agent type; real-work platform-wide is 2.25% lifetime, 56.9% lifetime
  once this one agent is excluded). See `SCHEDULER_MAP.md` for the full
  real-work ratio breakdown.
- **No generic circuit breaker exists anywhere in this trigger surface.**
  `src/lib/resilience/circuit-breaker.ts` is imported only by its own unit
  test. A failing scheduled job, poll pass, or queue claim is logged and
  retried at its next natural interval — it is never disabled. The only
  real per-agent kill switches are `pil_agent_registry.active` (all 51 PIL
  agents currently `true`) and the `ENABLE_SCRAPER` env flag (gates the 2
  weekly scraper jobs only).

Full per-trigger detail, live run counts, and the never-invoked-agent
cross-reference: `test-evidence/SCHEDULER_MAP.md`.

---

## Routing Conventions

- `GET /outcomes` → permanent 301 redirect to `/analytics` (Next.js `next.config.js` redirects, not an API route).
- All Recharts components wrapped in `dynamic(() => import(...), { ssr: false })`.

---

## Error Code Reference

| Code | HTTP | Description |
|---|---|---|
| UNAUTHORIZED | 401 | Missing or invalid session |
| FORBIDDEN | 403 | Session valid but resource belongs to different org |
| NOT_FOUND | 404 | Resource does not exist |
| INVALID_FILTER | 400 | Invalid enum filter value |
| INVALID_SOURCE_TYPE | 400 | source_type not in enum |
| INVALID_DATE_RANGE | 400 | Malformed date param |
| VALIDATION_ERROR | 400 | Zod schema validation failure with field-level details |
| RUN_IN_PROGRESS | 409 | Concurrent research run exists |
| NO_ACTIVE_AGENTS | 422 | No agents configured for org |
| NO_SEARCH_PROFILE | 422 | Scoring requires search profile |
| AI_PROVIDER_ERROR | 502 | Upstream AI provider failure |
| DB_ERROR | 500 | Supabase database error |

---

# Frontend Architecture — benavora Tier 2

## Overview

Benavora is an AI-powered nonprofit funding discovery and management platform. This document describes the complete frontend architecture for the Tier 2 feature set, covering all pages, components, layouts, design tokens, and responsive strategy.

The stack is **Next.js 14 (App Router)**, **TypeScript strict**, **Supabase** (Postgres + Auth + RLS), deployed on **Vercel**, managed with **pnpm**.

---

## Design System Conformance

All UI strictly uses the benavora design system:

- **Primary:** `#7C3AED` (violet/purple)
- **CTA/Accent:** `#F97316` (orange)
- **Background:** `#FAF5FF`
- **Text:** `#4C1D95`
- **Heading Font:** Cormorant Garamond
- **Body Font:** Libre Baskerville
- Google Fonts CDN import included in root `layout.tsx`
- All interactive elements: `cursor-pointer`, transitions 150–300ms, visible focus states
- No emojis as icons — Lucide React SVG icons throughout
- Minimum 4.5:1 contrast ratio on all text
- `prefers-reduced-motion` respected via CSS media query

---

## Layouts

### PublicLayout
Applies to: `/`, `/login`, `/signup`

Sticky NavBar (64px) → full-width main content → FooterSection. Background `#FAF5FF`. No sidebar.

### AppLayout
Applies to all authenticated routes.

Fixed left sidebar (240px, background `#7C3AED`, white icons/text) containing:
- Benavora logo
- Nav links: Dashboard, Grants, Research, Analytics, Alerts (with red unread badge), Settings sections
- User avatar at bottom

Top header bar (64px, white, shadow-sm) with breadcrumb and user menu.

Main content: `margin-left: 240px`, `padding: 32px`, background `#FAF5FF`.

Responsive collapse: icon-only sidebar at 768–1023px; off-canvas drawer below 768px.

### DashboardLayout
Extends AppLayout with a 12-column CSS grid at 1440px, scaling to single column at 375px.

### AnalyticsLayout
Extends AppLayout. Top row: DateRangePicker + SuccessRateCard. Chart grid (2×3) at desktop. FilterableGrantTable below full-width. All chart cards fixed 400px height.

### SettingsLayout
Extends AppLayout. Left secondary nav (200px) with Settings sections. Active state: `#F97316` left border 3px. Collapses to tab bar on mobile.

---

## Pages

### `/` — LandingPage
Public marketing page. Section order: Hero → Pricing Cards (3 tiers, middle card highlighted) → Feature Comparison Table → FAQ Accordion → Final CTA Banner → Footer. Implements pricing-focused landing pattern per design system.

### `/login` — LoginPage
Centered AuthCard. Email + Password inputs. Submit triggers Supabase Auth `signInWithPassword`. Redirect to `/dashboard` on success.

### `/signup` — SignUpPage
Centered AuthCard. Org name + Email + Password + Role select. Creates Supabase Auth user and organization record.

### `/dashboard` — DashboardPage
**Auth required. Roles: all.**

API calls: `GET /api/grants`, `GET /api/alerts`, `GET /api/analytics/summary`, `POST /api/research/run`, `GET /api/research/runs`

Key components:
- **PipelineSummaryCards**: 4 metric cards (Total Grants, High Match, Applications This Month, Success Rate)
- **RecentGrantsList**: 5 most recent grants with SourceTypeBadge + EligibilityFlagBadge
- **UpcomingDeadlinesList**: Grants due within 30 days; red text if ≤7 days
- **RunResearchButton**: Disabled with tooltip if run in progress (HTTP 409 check)
- **ResearchRunProgressPanel**: Supabase Realtime subscription for live agent status
- **AlertBadge**: Unread count badge on sidebar icon

Empty state: "Your dashboard is ready. Run your first research session to discover grants."

### `/grants` — GrantsListPage
**Auth required. Roles: all.**

API calls: `GET /api/grants` (with filter params)

- **GrantsFilterPanel**: Source type, eligibility flag, status, date range; URL-param driven
- **GrantsTable**: Paginated, sortable; SourceTypeBadge and EligibilityFlagBadge inline
- **ActiveFilterChips**: Dismissible active filter display
- Empty state when no grants match filters

### `/grants/[id]` — GrantDetailPage
**Auth required. Roles: grants_manager, grant_researcher.**

API calls: `GET /api/grants/[id]`, `PATCH /api/grants/[id]`, `POST /api/grants/[id]/rescore`, `GET /api/consensus/[grant_id]`, `POST /api/consensus/validate`

- **GrantDetailHeader**: Name, funder, badges, deadline, status select
- **SourceTypeSelect**: Dropdown PATCH with optimistic update and rollback
- **EligibilityScorePanel**: Accordion — circular score, AI rationale, ResScoreButton
- **ConsensusValidationPanel**: Dual-model results (Claude + GPT-4o), consensus outcome
- **GrantMetaFields**: Full description, amounts, URL, tags

Error states: permission denied toast, network failure rollback.

### `/research` — ResearchPage
**Auth required. Roles: grants_manager, grant_researcher.**

API calls: `POST /api/research/run`, `GET /api/research/runs`, `GET /api/research/runs/[id]`

- **RunResearchButton**: Primary action, disabled on active run
- **ResearchRunProgressPanel**: Real-time per-agent status cards via Supabase Realtime
- **DeduplicationStatsBanner**: Post-run summary (Found N, removed M, saved K)
- **ResearchRunHistoryTable**: Historical runs with stats

Edge cases: concurrent run prevention (HTTP 409), partial failure warning toast, all-failed error toast.

### `/analytics` — AnalyticsDashboardPage
**Auth required. Roles: all.**

API calls: `GET /api/analytics/summary`, `GET /api/analytics/funnel`, `GET /api/analytics/financials`, `GET /api/analytics/by-source`, `GET /api/analytics/deadlines`, `GET /api/analytics/agent-activity`, `GET /api/grants`

**Note:** `/outcomes` redirects to `/analytics` via HTTP 301.

All Recharts components wrapped in `ChartWrapper` with `dynamic(() => import(...), { ssr: false })` to prevent SSR hydration mismatch.

- **DateRangePicker**: Last 30d / 90d / 12mo / All Time; URL-param driven
- **PipelineFunnelChart**: Stages with drop-off percentages
- **SuccessRateCard**: awarded/applied %, trend vs prior period
- **FinancialsBarChart**: Monthly requested vs awarded grouped bars
- **SourceCategoryPieChart**: Source type breakdown; click-to-filter
- **DeadlineHeatmap**: 90-day calendar; color intensity by deadline count; click-to-filter
- **AgentActivityLineChart**: Runs + discoveries over time
- **FilterableGrantTable**: Reacts to chart click filters via shared React context

Org with zero grants shows page-level empty state message.

### `/alerts` — AlertsPage
**Auth required. Roles: all.**

API calls: `GET /api/alerts`, `POST /api/alerts/[id]/read`, `POST /api/alerts/read-all`

- **AlertsList**: Grouped by date (Today / Yesterday / Earlier)
- **AlertItemCard**: Type badge, message, timestamp, optional 'View Grant' link; click marks read
- **MarkAllReadButton**: Disabled when no unread alerts

Alert types: `high_match_grant` (green), `deadline_warning` (orange), `run_complete` (purple), `consensus_flag` (red)

### `/settings/search-profile` — SearchProfilePage
**Auth required. Roles: grants_manager, grant_researcher.**

API calls: `GET /api/search-profiles`, `POST /api/search-profiles` (upsert)

- **FundingTypeToggles**: Grants, Fellowships, Contracts, Loans, In-Kind, Other; at least one required
- **SourceTypeFilterChecklist**: Source type enum multi-select
- **FocusAreaWeightSliders**: 12 areas, 0–100 each, running sum display
- **DollarRangeInputs**: Min ≤ max validation; max=0 → NULL (no upper limit)
- **GeographicScopeSelector**: National/Regional/State-specific/Local/International; reveals StateMultiSelect conditionally
- **EligibilityPrefilterFields**: 501(c)(3), years, budget, staff, populations
- **NegativeFiltersTagInput**: Dismissible chips, duplicate detection, >100 warning
- **ConfirmResetModal**: Confirmation before reset to defaults

### `/settings/organization` — OrganizationSettingsPage
**Auth required. Roles: grants_manager.**

Org name, contact, website, mission statement, logo upload to Supabase Storage.

### `/settings/team` — TeamSettingsPage
**Auth required. Roles: grants_manager.**

Team member management, invite by email, role assignment (grants_manager / executive_director / grant_researcher), revoke access.

---

## Component Catalog Summary

| Component | Type | Key Purpose |
|---|---|---|
| NavBar | Layout | Public top nav with auth CTAs |
| AppLayout | Layout | Authenticated sidebar + header shell |
| SourceTypeBadge | Display | Color-coded source type pill (10 variants) |
| EligibilityFlagBadge | Display | High/Moderate/Low/Unscored match indicator |
| AlertBadge | Display | Unread count overlay on Bell icon |
| RunResearchButton | Interactive | Launch parallel research run |
| ResearchRunProgressPanel | Interactive | Realtime per-agent status |
| DeduplicationStatsBanner | Display | Post-run dedup stats |
| ChartWrapper | Container | SSR-safe dynamic import for all Recharts |
| PipelineFunnelChart | Chart | Grant pipeline stages |
| SuccessRateCard | Display | awarded/applied % with trend |
| FinancialsBarChart | Chart | Monthly requested vs awarded |
| SourceCategoryPieChart | Chart | Source type breakdown with filter |
| DeadlineHeatmap | Chart | 90-day deadline density calendar |
| AgentActivityLineChart | Chart | Research run + discovery trends |
| FilterableGrantTable | Display | Chart-driven filtered grant list |
| EligibilityScorePanel | Display | AI score + rationale accordion |
| ConsensusValidationPanel | Display | Dual-model consensus results |
| SearchProfileForm | Form | Full search profile editor |
| NegativeFiltersTagInput | Interactive | Exclusion tag management |
| ToastNotification | Feedback | Slide-in typed notifications |
| EmptyStatePlaceholder | Display | Reusable empty state with CTA |
| LoadingSkeleton | Display | Shimmer loading placeholders |

---

## Responsive Strategy

Mobile-first with 4 breakpoints:
- **375px** (mobile): Single column, off-canvas sidebar drawer, stacked forms
- **768px** (tablet): 2-column grids, icon-only sidebar, tab bar for settings
- **1024px** (laptop): Full sidebar, 3-column grids, desktop tables
- **1440px** (desktop): Maximum 12-column grid, full chart layouts

All Recharts charts use `<ResponsiveContainer width="100%">`. Tables become card-stack below 768px. Touch targets minimum 44px. No horizontal scroll on body.

---

## Multi-Tenancy & Security

- All API calls are organization-scoped: Supabase RLS policies enforce `organization_id` isolation
- Auth state managed via Supabase Auth; protected routes redirect to `/login` if no session
- Role-based route access enforced at both middleware (Next.js) and API route levels
- Optimistic updates always include rollback on API error to prevent stale UI state

---

## Key Anti-Patterns Avoided

- No SSR for Recharts (all wrapped in `dynamic` with `ssr: false`)
- No emojis as icons (Lucide SVG throughout)
- No layout-shifting hover transforms (only translateY(-2px) on cards, contained)
- No missing focus states (all inputs, buttons, links have visible `:focus-visible` outlines)
- No instant state changes (all transitions 150–300ms)
- No content hidden behind fixed navbars (main content has correct padding-top)

---

# Interaction Maps

## Overview

This document defines all interactive elements across Benavora Tier 2 features. Every user-facing and system-triggered interaction is mapped to its frontend reaction, API call, backend processing, database write, side effects, and analytics event. All routes reference the established API surface and all database writes target tenant-scoped tables with RLS enforced.

---

## Feature 1 – Grant Source Categorization

### 1.1 Source Type Dropdown (Grant Detail Page)

| Field | Value |
|---|---|
| **Element** | `<Select>` dropdown labeled "Source Type" on `/grants/[id]` |
| **User Action** | User opens dropdown and selects a source type value |
| **Frontend Reaction** | Optimistic update: badge color and label update immediately; `<SourceTypeBadge>` re-renders with new value using Tailwind deterministic color map |
| **API Call** | `PATCH /api/grants/[id]` with `{ source_type: selectedValue }` |
| **Backend Processing** | Validates `source_type` against enum (`federal_government`, `state_government`, `local_government`, `private_foundation`, `corporate_foundation`, `community_foundation`, `international`, `faith_based`, `individual_donor`, `other`); verifies `organization_id` via RLS; updates `grants` row |
| **DB Write** | `grants` |
| **Side Effects** | Toast: "Source type updated."; optimistic rollback + toast "Failed to save. Check your connection." on network error; toast "You don't have permission to edit this grant." on 403; toast "Invalid source type selected. Please try again." on 400 |
| **Success Response** | HTTP 200 with updated grant object |
| **Error Response** | HTTP 400 (invalid), HTTP 403 (permission), HTTP 500 (server) |
| **Tracking Event** | `grant_source_type_updated` |

### 1.2 SourceTypeBadge Component (Grant List Rows)

| Field | Value |
|---|---|
| **Element** | `<SourceTypeBadge source_type={...} />` pill badge in all grant list rows |
| **User Action** | User views any grant list |
| **Frontend Reaction** | Renders color-coded pill badge per color map: federal=blue, state=indigo, local=violet, private_foundation=emerald, corporate=teal, community=cyan, international=amber, faith=orange, individual=pink, other=gray; NULL renders "Uncategorized" gray badge |
| **API Call** | `GET /api/grants` |
| **Backend Processing** | Returns grant rows with `source_type` field; RLS scopes to `organization_id` |
| **DB Write** | none |
| **Side Effects** | None |
| **Success Response** | Grant list with `source_type` per row |
| **Error Response** | Toast: "Failed to load grants. Please refresh." |
| **Tracking Event** | `grant_list_viewed` |

### 1.3 Source Type Filter Panel (Grant List Views)

| Field | Value |
|---|---|
| **Element** | Multi-select filter panel with source type checkboxes |
| **User Action** | User selects one or more source types |
| **Frontend Reaction** | Updates URL query params (`?source_type=federal_government,private_foundation`); shows active filter chips above list; refetches grant list |
| **API Call** | `GET /api/grants` with `?source_type=...` |
| **Backend Processing** | `.in('source_type', [...])` filter scoped by `organization_id` |
| **DB Write** | none |
| **Side Effects** | Empty state: "No grants match the selected source types. Try adjusting your filters."; toast on fetch error |
| **Success Response** | HTTP 200 filtered grants array |
| **Error Response** | HTTP 500; toast shown |
| **Tracking Event** | `grant_list_filtered_by_source_type` |

### 1.4 AI Auto-Assignment During Research

| Field | Value |
|---|---|
| **Element** | System-automated classification (no direct UI element) |
| **User Action** | Automated when Research Agent saves a discovered grant |
| **Frontend Reaction** | No immediate feedback; `source_type` badge visible when user views results |
| **API Call** | `POST /api/research/run` (internal call chain) |
| **Backend Processing** | AI prompt classifies each grant into `source_type` enum; maps returned string to enum; falls back to `other` and logs warning on unrecognized value |
| **DB Write** | `grants` |
| **Side Effects** | Server console warning logged on fallback |
| **Success Response** | Grant INSERTed with `source_type` set |
| **Error Response** | Defaults to `other` on any classification failure |
| **Tracking Event** | `grant_source_type_auto_assigned` |

---

## Feature 2 – Research Agent Parallel Execution

### 2.1 Run Research Button

| Field | Value |
|---|---|
| **Element** | "Run Research" primary button on `/research` and `/dashboard` |
| **User Action** | User clicks the button |
| **Frontend Reaction** | Calls `POST /api/research/run`; renders per-agent status panel; button disabled while run is in progress; establishes Supabase Realtime subscription on `research_run_agents` |
| **API Call** | `POST /api/research/run` with `{ organization_id, search_profile_id }` |
| **Backend Processing** | Fetches active agent configs for org; INSERTs `research_runs` row (`status='running'`, `started_at=now()`); INSERTs `research_run_agents` rows (`status='pending'`); spawns all agents via `Promise.allSettled` |
| **DB Write** | `research_runs` |
| **Side Effects** | `research_run_agents` INSERTed per agent; Realtime subscription established; HTTP 409 if run already in progress |
| **Success Response** | HTTP 200 with `research_run_id` and initial status |
| **Error Response** | HTTP 409: toast "A research run is already in progress. Please wait for it to complete." |
| **Tracking Event** | `research_run_started` |

### 2.2 Per-Agent Status Cards

| Field | Value |
|---|---|
| **Element** | Agent status cards in research progress panel |
| **User Action** | Automated during active run |
| **Frontend Reaction** | Supabase Realtime pushes `research_run_agents` updates; card badge transitions Queued → Running → Completed (green checkmark) or Failed (red X) |
| **API Call** | `GET /api/research/runs/[id]` |
| **Backend Processing** | Per resolved/rejected Promise: updates `research_run_agents.status`, sets `completed_at`, stores `raw_results` JSONB |
| **DB Write** | `research_run_agents` |
| **Side Effects** | Realtime event triggers frontend badge update |
| **Success Response** | `research_run_agents` row updated |
| **Error Response** | Agent marked `failed` with `error='timeout'` (90s) or `error='rate_limited'` (2× 429) |
| **Tracking Event** | `research_agent_status_updated` |

### 2.3 Deduplication Summary Banner

| Field | Value |
|---|---|
| **Element** | Summary banner displayed after run completion |
| **User Action** | Automated after all agents complete |
| **Frontend Reaction** | Dismisses loading; refreshes grant list; shows banner: "Research complete. Found [N] opportunities, removed [M] duplicates, saved [K] unique grants." |
| **API Call** | `GET /api/research/runs/[id]` |
| **Backend Processing** | Normalizes URLs; deduplicates by URL then fuzzy funder+program (Levenshtein ≤3); merges metadata; INSERTs unique grants; updates `research_runs.deduplication_stats` JSONB; updates `research_runs.status` |
| **DB Write** | `grants` |
| **Side Effects** | `research_runs.deduplication_stats` and `research_runs.status` updated; toast variants for all-success, partial failure, all-failed |
| **Success Response** | `research_runs` updated with `completed` status and deduplication stats |
| **Error Response** | Cron job marks stuck runs `failed` after 10 minutes |
| **Tracking Event** | `research_run_completed` |

### 2.4 Concurrent Run Prevention

| Field | Value |
|---|---|
| **Element** | Disabled "Run Research" button with tooltip |
| **User Action** | User clicks button while run is in progress |
| **Frontend Reaction** | Button disabled with tooltip "A research run is already in progress."; catches 409 and shows toast |
| **API Call** | `POST /api/research/run` |
| **Backend Processing** | Checks `research_runs` for `status='running'` scoped to `organization_id`; returns HTTP 409 |
| **DB Write** | none |
| **Side Effects** | Toast: "A research run is already in progress. Please wait for it to complete." |
| **Success Response** | N/A |
| **Error Response** | HTTP 409 Conflict |
| **Tracking Event** | `research_run_concurrent_blocked` |

---

## Feature 3 – Search Profile Configuration

### 3.1 Page Load and Profile Fetch

| Field | Value |
|---|---|
| **Element** | `/settings/search-profile` page initial load |
| **User Action** | User navigates to page |
| **Frontend Reaction** | Fetches profile; renders loading skeleton; populates form with existing values or system defaults on 404 |
| **API Call** | `GET /api/search-profiles` |
| **Backend Processing** | Returns `search_profiles` row for `organization_id`; 404 if none |
| **DB Write** | none |
| **Side Effects** | None |
| **Success Response** | HTTP 200 with profile or HTTP 404 |
| **Error Response** | Toast: "Failed to load search profile. Please refresh." |
| **Tracking Event** | `search_profile_page_viewed` |

### 3.2 Funding Type Toggles

| Field | Value |
|---|---|
| **Element** | Toggle switches for Grants, Fellowships, Contracts, Loans, In-Kind, Other |
| **User Action** | User toggles on/off |
| **Frontend Reaction** | Local form state updates; toggle animates with 200ms CSS transition |
| **API Call** | none (persisted on Save) |
| **Backend Processing** | Stored on save into `search_profiles.funding_types` text array |
| **DB Write** | none (local only until save) |
| **Side Effects** | Save blocked with "At least one funding type must be selected." if all deselected |
| **Success Response** | Local state updated |
| **Error Response** | Validation error on save |
| **Tracking Event** | `search_profile_funding_type_toggled` |

### 3.3 Source Type Filter Checkboxes

| Field | Value |
|---|---|
| **Element** | Multi-select checkbox list for source type categories |
| **User Action** | User checks/unchecks source type categories |
| **Frontend Reaction** | Local form state updates immediately |
| **API Call** | none (persisted on Save) |
| **Backend Processing** | Stored on save into `search_profiles.source_type_filters` text array |
| **DB Write** | none |
| **Side Effects** | None |
| **Success Response** | Local state updated |
| **Error Response** | none |
| **Tracking Event** | `search_profile_source_filter_changed` |

### 3.4 Focus Area Weight Sliders

| Field | Value |
|---|---|
| **Element** | Sliders/number inputs for 12 focus areas |
| **User Action** | User drags slider or inputs numeric weight 0–100 |
| **Frontend Reaction** | Running total updates in real-time; does not enforce sum to 100 |
| **API Call** | none (persisted on Save) |
| **Backend Processing** | Stored on save into `search_profiles.focus_area_weights` JSONB |
| **DB Write** | none |
| **Side Effects** | None |
| **Success Response** | Local state updated |
| **Error Response** | none |
| **Tracking Event** | `search_profile_focus_area_weight_changed` |

### 3.5 Dollar Range Min/Max Inputs

| Field | Value |
|---|---|
| **Element** | Two number inputs or range slider for min/max grant amounts |
| **User Action** | User sets minimum and maximum award amounts |
| **Frontend Reaction** | Validates min ≤ max inline; formats as currency; max=0 treated as no upper limit |
| **API Call** | none (persisted on Save) |
| **Backend Processing** | `amount_min` stored as integer cents; `amount_max` as integer cents or NULL |
| **DB Write** | none |
| **Side Effects** | Inline error: "Minimum amount cannot exceed maximum amount." |
| **Success Response** | Local state updated with valid range display |
| **Error Response** | Inline validation error |
| **Tracking Event** | `search_profile_amount_range_changed` |

### 3.6 Geographic Scope Selector

| Field | Value |
|---|---|
| **Element** | Scope selector + conditional 50-state multi-select dropdown |
| **User Action** | User selects scope; optionally selects specific states |
| **Frontend Reaction** | Conditional state picker renders; selected states shown as dismissible chips |
| **API Call** | none (persisted on Save) |
| **Backend Processing** | Stored on save into `search_profiles.geographic_scope` JSONB `{type, states[]}` |
| **DB Write** | none |
| **Side Effects** | Save blocked: "Please select at least one state for state-specific scope." if applicable |
| **Success Response** | Local state updated |
| **Error Response** | Validation error on save |
| **Tracking Event** | `search_profile_geographic_scope_changed` |

### 3.7 Eligibility Pre-filter Form

| Field | Value |
|---|---|
| **Element** | Structured form section: 501(c)(3) toggle, years, budget range, staff size, population tags |
| **User Action** | User configures eligibility attributes |
| **Frontend Reaction** | Local form state updates immediately |
| **API Call** | none (persisted on Save) |
| **Backend Processing** | Stored on save into `search_profiles.eligibility_filters` JSONB |
| **DB Write** | none |
| **Side Effects** | None |
| **Success Response** | Local state updated |
| **Error Response** | none |
| **Tracking Event** | `search_profile_eligibility_filter_changed` |

### 3.8 Negative Filters Tag-Input

| Field | Value |
|---|---|
| **Element** | Tag-input field for exclusion keywords/funders/regions |
| **User Action** | User types exclusion and presses Enter or comma |
| **Frontend Reaction** | Tag rendered as dismissible chip; duplicate highlighted briefly and blocked; warning if >100 tags |
| **API Call** | none (persisted on Save) |
| **Backend Processing** | Stored on save into `search_profiles.negative_filters` text array |
| **DB Write** | none |
| **Side Effects** | Warning: "You have [N] exclusions. Very long lists may slow research." if >100 tags |
| **Success Response** | Tag added as chip in local state |
| **Error Response** | Duplicate tag rejected with brief highlight |
| **Tracking Event** | `search_profile_negative_filter_added` |

### 3.9 Save Search Profile Button

| Field | Value |
|---|---|
| **Element** | "Save Search Profile" primary button |
| **User Action** | User clicks Save |
| **Frontend Reaction** | Validates form; calls `POST /api/search-profiles`; shows loading spinner on button |
| **API Call** | `POST /api/search-profiles` |
| **Backend Processing** | UPSERTs `search_profiles` by `organization_id`; sets `updated_at=now()`; RLS enforces scoping |
| **DB Write** | `search_profiles` |
| **Side Effects** | Toast: "Search profile saved. Your next research run will use these settings."; toast on network error; inline errors on validation failures |
| **Success Response** | HTTP 200 with upserted `search_profiles` object |
| **Error Response** | HTTP 400 validation; HTTP 500 server error |
| **Tracking Event** | `search_profile_saved` |

### 3.10 Reset to Defaults Link

| Field | Value |
|---|---|
| **Element** | "Reset to Defaults" secondary link |
| **User Action** | User clicks link |
| **Frontend Reaction** | Opens confirmation modal with backdrop blur; on confirm, resets local form state to hardcoded defaults with 200ms transition; does not persist until Save |
| **API Call** | none (until Save after reset) |
| **Backend Processing** | On subsequent Save: POST /api/search-profiles with default values |
| **DB Write** | none (local only until save) |
| **Side Effects** | Modal with confirm/cancel; form resets on confirm |
| **Success Response** | Local form state reset to defaults |
| **Error Response** | none |
| **Tracking Event** | `search_profile_reset_to_defaults` |

---

## Feature 4 – Analytics Dashboard

### 4.1 Page Load and Date Range Selector

| Field | Value |
|---|---|
| **Element** | `/analytics` page with date range preset selector |
| **User Action** | User navigates to page; selects date range |
| **Frontend Reaction** | Fetches summary; renders loading skeletons; updates URL params for shareability; HTTP 301 redirect from `/outcomes` |
| **API Call** | `GET /api/analytics/summary` |
| **Backend Processing** | Aggregation queries on `grants` and `research_runs` scoped by `organization_id` and date range |
| **DB Write** | none |
| **Side Effects** | `/outcomes` redirects to `/analytics` with HTTP 301 |
| **Success Response** | HTTP 200 with analytics summary |
| **Error Response** | Toast: "Failed to load analytics. Please refresh." |
| **Tracking Event** | `analytics_dashboard_viewed` |

### 4.2 Pipeline Funnel Chart

| Field | Value |
|---|---|
| **Element** | Recharts `FunnelChart` panel (dynamic import, `ssr:false`) |
| **User Action** | User views the chart |
| **Frontend Reaction** | Renders funnel with stages and percentage drop-off labels; empty state if no grants |
| **API Call** | `GET /api/analytics/funnel` |
| **Backend Processing** | Returns counts per `grants.status` value scoped by org and date range |
| **DB Write** | none |
| **Side Effects** | None |
| **Success Response** | HTTP 200 with `{stage, count}[]` |
| **Error Response** | Chart panel shows error state with retry |
| **Tracking Event** | `analytics_funnel_viewed` |

### 4.3 Success Rate Metric Card

| Field | Value |
|---|---|
| **Element** | Large metric card: "XX% Success Rate" with trend arrow |
| **User Action** | User views the card |
| **Frontend Reaction** | Displays `awarded/applied*100`%; green ↑ or red ↓ trend vs prior period; "—" if no applications |
| **API Call** | `GET /api/analytics/summary` |
| **Backend Processing** | Returns `{awarded, applied, previous_awarded, previous_applied}` from `grants` counts |
| **DB Write** | none |
| **Side Effects** | None |
| **Success Response** | HTTP 200 with metric values |
| **Error Response** | Shows "—" with unavailability note |
| **Tracking Event** | `analytics_success_rate_viewed` |

### 4.4 Dollars Requested vs Awarded Bar Chart

| Field | Value |
|---|---|
| **Element** | Recharts `BarChart` with grouped bars (dynamic import, `ssr:false`) |
| **User Action** | User views the chart |
| **Frontend Reaction** | Renders grouped bars per month; dollar-formatted Y-axis; hover tooltip with exact values; note if >20% amounts missing |
| **API Call** | `GET /api/analytics/financials` |
| **Backend Processing** | `SUM(amount_requested)` and `SUM(amount_awarded)` grouped by month; skips NULLs; scoped by org |
| **DB Write** | none |
| **Side Effects** | Note "(some amounts not recorded)" if >20% grants lack amounts |
| **Success Response** | HTTP 200 with `{month, total_requested, total_awarded}[]` |
| **Error Response** | Empty state placeholder bars at zero |
| **Tracking Event** | `analytics_financials_viewed` |

### 4.5 Source Category Pie Chart

| Field | Value |
|---|---|
| **Element** | Recharts `PieChart` (dynamic import, `ssr:false`) with slice click filtering |
| **User Action** | User views chart; clicks a slice |
| **Frontend Reaction** | Renders slices using SourceTypeBadge color palette; clicking slice updates shared filter state; grant table re-fetches |
| **API Call** | `GET /api/analytics/by-source` |
| **Backend Processing** | Returns `{source_type, count, total_amount}[]` scoped by org and date range |
| **DB Write** | none |
| **Side Effects** | Grant table below filters on slice click |
| **Success Response** | HTTP 200 with source breakdown |
| **Error Response** | Chart panel shows error state |
| **Tracking Event** | `analytics_source_pie_viewed` |

### 4.6 Deadline Heatmap

| Field | Value |
|---|---|
| **Element** | Calendar heatmap grid (Recharts `ScatterChart`, dynamic import `ssr:false`) |
| **User Action** | User views heatmap; clicks day cell |
| **Frontend Reaction** | Renders 90-day grid with density coloring; clicking day filters grant table; empty state if no upcoming deadlines |
| **API Call** | `GET /api/analytics/deadlines` |
| **Backend Processing** | Returns `{date, count}[]` for grants with `deadline` in next 90 days scoped by org |
| **DB Write** | none |
| **Side Effects** | Grant table filters to clicked date |
| **Success Response** | HTTP 200 with deadline density array |
| **Error Response** | Empty grid with error message |
| **Tracking Event** | `analytics_deadline_heatmap_viewed` |

### 4.7 Agent Activity Line Chart

| Field | Value |
|---|---|
| **Element** | Recharts `LineChart` (dynamic import, `ssr:false`) multi-line chart |
| **User Action** | User views the panel |
| **Frontend Reaction** | Renders runs-per-day and grants-discovered lines with legend; hover tooltip; empty state if no runs |
| **API Call** | `GET /api/analytics/agent-activity` |
| **Backend Processing** | Returns `{date, runs, grants_found, duplicates_removed}[]` scoped by org and date range |
| **DB Write** | none |
| **Side Effects** | None |
| **Success Response** | HTTP 200 with time series data |
| **Error Response** | Empty state: "Run your first research session to see agent activity here." |
| **Tracking Event** | `analytics_agent_activity_viewed` |

### 4.8 Filterable Grant Table Below Charts

| Field | Value |
|---|---|
| **Element** | Grant table below analytics charts |
| **User Action** | User interacts with pie slice or heatmap day cell |
| **Frontend Reaction** | Shared filter state updated; table re-fetches; active filter chip displayed |
| **API Call** | `GET /api/grants` |
| **Backend Processing** | Standard grants query with filter params scoped by `organization_id` via RLS |
| **DB Write** | none |
| **Side Effects** | None |
| **Success Response** | HTTP 200 with filtered grants |
| **Error Response** | Toast: "Failed to load grants. Please refresh." |
| **Tracking Event** | `analytics_grant_table_filtered` |

---

## Feature 5 – Automated Eligibility Enhancement

### 5.1 Eligibility Badge on Grant List and Detail

| Field | Value |
|---|---|
| **Element** | Inline eligibility badge on all grant list rows and grant detail header |
| **User Action** | User views grant list or detail page |
| **Frontend Reaction** | `high_match` → green "High Match" badge; `moderate_match` → yellow badge; `low_match` → no badge (gray in verbose mode); `unscored` → "Scoring..." spinner or "Unscored" gray chip |
| **API Call** | `GET /api/grants` |
| **Backend Processing** | Returns `match_percentage`, `eligibility_flag`, `eligibility_notes` with each grant |
| **DB Write** | none |
| **Side Effects** | None |
| **Success Response** | HTTP 200 with grants including eligibility fields |
| **Error Response** | Badge shows "Unscored" on error |
| **Tracking Event** | `grant_eligibility_badge_viewed` |

### 5.2 Eligibility Score Detail Panel

| Field | Value |
|---|---|
| **Element** | Inline accordion panel on `/grants/[id]` |
| **User Action** | User clicks match percentage badge or "View Eligibility Details" link |
| **Frontend Reaction** | Accordion expands with 200ms animation; shows circular score indicator, AI rationale text, scoring timestamp, Re-score button |
| **API Call** | `GET /api/grants/[id]` |
| **Backend Processing** | Returns full grant including `match_percentage`, `eligibility_flag`, `eligibility_notes`, `eligibility_scored_at` |
| **DB Write** | none |
| **Side Effects** | None |
| **Success Response** | HTTP 200 with full grant detail |
| **Error Response** | Panel shows "Eligibility details unavailable" |
| **Tracking Event** | `grant_eligibility_detail_viewed` |

### 5.3 Re-score Button

| Field | Value |
|---|---|
| **Element** | "Re-score" button inside eligibility detail panel |
| **User Action** | User clicks Re-score |
| **Frontend Reaction** | Button disabled with spinner; score and rationale update on success with 200ms transition |
| **API Call** | `POST /api/grants/[id]/rescore` |
| **Backend Processing** | Fetches `search_profiles.eligibility_filters` + grant description; calls Anthropic Claude; parses `{score, rationale}`; updates `match_percentage`, `eligibility_flag`, `eligibility_notes`, `eligibility_scored_at`; sets flag (≥80=high_match, 50-79=moderate_match, <50=low_match) |
| **DB Write** | `grants` |
| **Side Effects** | Toast: "Eligibility re-scored."; toast error on failure; Realtime pushes update to open sessions |
| **Success Response** | HTTP 200 with updated eligibility fields |
| **Error Response** | HTTP 500; button re-enabled; toast error |
| **Tracking Event** | `grant_eligibility_rescored` |

### 5.4 Eligibility Flag Filter on Grant List

| Field | Value |
|---|---|
| **Element** | Eligibility filter selector on grant list: All / High Match / Moderate / Low / Unscored |
| **User Action** | User selects a filter |
| **Frontend Reaction** | URL param updated; grant list re-fetches; active filter chip shown |
| **API Call** | `GET /api/grants` with `?eligibility_flag=...` |
| **Backend Processing** | Filters by `eligibility_flag` column scoped by `organization_id` via RLS |
| **DB Write** | none |
| **Side Effects** | None |
| **Success Response** | HTTP 200 with filtered grants |
| **Error Response** | Toast: "Failed to load grants. Please refresh." |
| **Tracking Event** | `grant_list_filtered_by_eligibility` |

### 5.5 Automated Eligibility Scoring on Discovery

| Field | Value |
|---|---|
| **Element** | Background scoring job (no direct UI element) |
| **User Action** | Automated — triggers after research agent INSERTs new grant |
| **Frontend Reaction** | No immediate UI feedback; grant card updates via Supabase Realtime or on next refresh |
| **API Call** | `POST /api/grants/[id]/rescore` (internal async trigger) |
| **Backend Processing** | Fetches `search_profiles.eligibility_filters`; constructs AI prompt (score 0–100 + 2-3 sentence rationale); calls Anthropic Claude; updates `match_percentage`, `eligibility_flag`, `eligibility_notes`; if `high_match` and grant <24h old, INSERTs into `alerts` with `alert_type='high_match_grant'`; skips and sets `unscored` if no profile configured |
| **DB Write** | `grants` |
| **Side Effects** | `alerts` row INSERTed for new high match grants; sidebar badge count increments via Realtime |
| **Success Response** | `grants` updated with eligibility fields |
| **Error Response** | `eligibility_flag` remains `unscored`; error logged to server console |
| **Tracking Event** | `grant_eligibility_auto_scored` |

### 5.6 Sidebar Alert Badge for New High Match Grants

| Field | Value |
|---|---|
| **Element** | Red badge count on sidebar "Alerts" nav icon |
| **User Action** | Automated — triggered after `eligibility_flag='high_match'` set on newly discovered grant |
| **Frontend Reaction** | Supabase Realtime pushes `alerts` INSERT; sidebar badge count increments in real-time |
| **API Call** | `GET /api/alerts` |
| **Backend Processing** | `alerts` row INSERTed with `alert_type='high_match_grant'`, `organization_id`, `grant_id`, `created_at`; Realtime broadcasts to subscribed clients |
| **DB Write** | `alerts` |
| **Side Effects** | Badge count updates in real-time via Supabase Realtime subscription |
| **Success Response** | Alert INSERTed; Realtime event broadcast |
| **Error Response** | Badge count stale until next refresh if Realtime drops |
| **Tracking Event** | `high_match_alert_created` |

---

## Design System Compliance Notes

All interactive elements in this document conform to the benavora design system:

- **Colors:** Primary `#7C3AED`, CTA/Accent `#F97316`, Background `#FAF5FF`, Text `#4C1D95`
- **Typography:** Cormorant Garamond (headings), Libre Baskerville (body)
- **Buttons:** `.btn-primary` uses `#F97316` background; `.btn-secondary` uses `#7C3AED` border/text
- **Cards:** `border-radius: 12px`, `box-shadow: var(--shadow-md)`, hover lifts with `var(--shadow-lg)`
- **Inputs:** `border-radius: 8px`, focus ring `#7C3AED20` with `border-color: #7C3AED`
- **Modals:** `backdrop-filter: blur(4px)`, `border-radius: 16px`, `box-shadow: var(--shadow-xl)`
- **Transitions:** All state changes use 150–300ms ease transitions
- **Icons:** Heroicons/Lucide SVG only — no emoji icons
- **Accessibility:** All clickable elements have `cursor: pointer`; focus states visible; 4.5:1 contrast minimum
- **Recharts:** All chart components use `dynamic(() => import(...), { ssr: false })` to prevent hydration mismatch
- **Anti-patterns avoided:** No layout-shifting hovers, no instant state changes, no low-contrast text, no invisible focus states

---

# Auth Architecture

## Overview

Benavora uses Supabase Auth (email/password) as the identity provider, integrated with Next.js 14 App Router via `@supabase/auth-helpers-nextjs`. Authentication state is managed through Supabase session cookies. Authorization is enforced through a two-layer model: (1) Next.js middleware injects verified role and organization context into request headers, and (2) Supabase Row-Level Security policies enforce organization-scoped data isolation at the database layer.

All users belong to exactly one organization. The organization_id is the tenant identifier throughout the system.

---

## Roles

### `admin`
Full access to all features within the organization. Can manage team members, organization settings, and all grant/research/analytics data. Created automatically for the organization founder; granted to invited users when role='admin' is specified.

**Key permissions:** All CRUD on grants, research runs, search profiles, agents, alerts, consensus validation. Full team and organization settings management.

### `member`
Operational access for day-to-day grant work. Can create, read, and update grants, run research, configure search profiles, view analytics, and manage alerts. Cannot manage team membership or organization settings.

**Key permissions:** All grant and research operations. Read/write search profiles. Full analytics and alerts access. No team management.

### `viewer`
Read-only stakeholder access. Intended for board members or executives who need visibility without operational access. Can view all organization data but cannot create, update, or delete any records (except marking their own alerts as read).

**Key permissions:** READ-only on all data. Mark own alerts read. No mutations.

---

## Auth Flows

### Sign Up
1. User submits email, password, organization name, and full name at `/signup`.
2. Frontend calls `supabase.auth.signUp()` with user metadata.
3. Supabase Auth creates `auth.users` row and sends confirmation email.
4. A Supabase DB trigger (`create_organization_and_user()`) fires on `auth.users` INSERT:
   - INSERTs a new row into `organizations` with `name=organization_name`, `plan='free'`.
   - INSERTs a new row into `users` with `id=auth.uid()`, `organization_id=new_org.id`, `role='admin'`.
5. User confirms email; session established; redirect to `/dashboard`.

### Log In
1. User submits credentials at `/login`.
2. `supabase.auth.signInWithPassword()` called.
3. On success: Supabase sets session cookie with JWT.
4. Middleware validates session, fetches user row, injects context headers.
5. Redirect to `/dashboard`.
6. On failure: toast "Invalid email or password. Please try again."

### Log Out
1. User clicks "Sign Out".
2. `supabase.auth.signOut()` called; session cookie cleared.
3. Next request: middleware finds no session, redirects to `/login`.

### Password Reset
1. User submits email at `/forgot-password`.
2. `supabase.auth.resetPasswordForEmail()` called with `redirectTo: '/reset-password'`.
3. User clicks emailed link, lands on `/reset-password`.
4. `supabase.auth.updateUser({ password })` called.
5. On success: toast + redirect to `/dashboard`.

### Invite Team Member (admin only)
1. Admin submits invitee email and role at `/settings/team`.
2. `POST /api/invitations` called; backend verifies caller role='admin'.
3. `supabase.auth.admin.inviteUserByEmail()` called with `organization_id` and `role` in metadata.
4. Invitee clicks email link, lands on `/accept-invite`.
5. DB trigger fires: INSERTs `users` row with `organization_id` and `role` from metadata.
6. Redirect to `/dashboard`.

### Session Refresh and Protected Route Access
1. User navigates to any protected route.
2. Middleware intercepts; calls `supabase.auth.getSession()`.
3. **If no session or error → redirect to `/login` immediately (Iron Law 4).**
4. If session expired: Supabase auto-refreshes using `refresh_token` cookie.
5. **If refresh fails → redirect to `/login` immediately.**
6. If session valid: middleware queries `users` table (service-role client, bypasses RLS) for user row.
7. **If query errors or returns zero rows → redirect to `/login` immediately — never render default or wrong-role page (Iron Law 4).**
8. If user row valid: middleware sets `x-user-id`, `x-organization-id`, `x-user-role` on request headers.
9. Request proceeds to page or API handler.

---

## Middleware (`/middleware.ts`)

```
Matcher: all routes EXCEPT:
  /_next/static/**
  /_next/image/**
  /favicon.ico
  /api/auth/**
  /login
  /signup
  /forgot-password
  /reset-password
  /accept-invite
```

**Execution order (strict):**
1. Create Supabase middleware client with `createMiddlewareClient({ req, res })`.
2. Call `supabase.auth.getSession()`. On null/error → `redirect('/login')`.
3. If JWT expired → Supabase auto-refreshes. On refresh failure → `redirect('/login')`.
4. Query `users` table via service-role client for `id = session.user.id`.
5. On query error or empty result → `redirect('/login')`.
6. Clone request headers; set `x-user-id`, `x-organization-id`, `x-user-role`.
7. Return `NextResponse.next()` with mutated headers and response.

**Iron Law 4 enforcement:** On ANY role-fetch failure at step 4–5, redirect to `/login` only — never render a default role, never render the requested page with degraded permissions.

**Role data is never cached** in cookies or session storage. Every request re-validates role from the database.

---

## Permissions Model

Benavora uses a **flat three-tier RBAC model** (`admin > member > viewer`) enforced at two independent layers.

### Layer 1: API Route Role Checks (middleware-injected headers)
- All API routes read `x-user-role` from headers (set by middleware, never from client-supplied body).
- Admin-only endpoints (team invitations, organization settings, agent management) return HTTP 403 if `x-user-role !== 'admin'`.
- Viewer write-blocking: all mutating routes (POST/PATCH/PUT/DELETE) check `x-user-role === 'viewer'` and return HTTP 403 with `{ error: 'Viewers have read-only access.' }` before any DB operation.
- `x-organization-id` header is the authoritative tenant scope — client-supplied `organization_id` values in request bodies are **never** used for query scoping.

### Layer 2: Supabase Row-Level Security

RLS is enabled on all organization-scoped tables. The standard policy pattern:

**SELECT policy:**
```sql
USING (
  organization_id = (
    SELECT organization_id FROM users WHERE id = auth.uid()
  )
)
```

**INSERT policy:**
```sql
WITH CHECK (
  organization_id = (
    SELECT organization_id FROM users WHERE id = auth.uid()
  )
)
```

**UPDATE/DELETE policy:**
```sql
USING (
  organization_id = (
    SELECT organization_id FROM users WHERE id = auth.uid()
  )
)
```

**`users` table special policies:**
- Non-admin users: `SELECT WHERE id = auth.uid()` (own row only).
- Admin users: `SELECT WHERE organization_id = (SELECT organization_id FROM users WHERE id = auth.uid())`.

### Tables with RLS Enabled and `organization_id` column
- `organizations` (tenant root; RLS on id match via users join)
- `users` (organization_id)
- `grants` (organization_id)
- `research_runs` (organization_id)
- `research_run_agents` (organization_id, via research_run join enforced in policy)
- `search_profiles` (organization_id)
- `agents` (organization_id)
- `alerts` (organization_id)
- `consensus_results` (organization_id)
- `eligibility_scores` (organization_id, if stored separately from grants)

### Permission Matrix Summary

| Operation | admin | member | viewer |
|---|---|---|---|
| Read grants | ✅ | ✅ | ✅ |
| Create/update/delete grants | ✅ | ✅ | ❌ |
| Run research | ✅ | ✅ | ❌ |
| Configure search profiles | ✅ | ✅ | ❌ |
| View analytics | ✅ | ✅ | ✅ |
| View alerts | ✅ | ✅ | ✅ |
| Mark alerts read | ✅ | ✅ | ✅ (own only) |
| Consensus validate | ✅ | ✅ | ❌ |
| Manage team/invitations | ✅ | ❌ | ❌ |
| Update organization settings | ✅ | ❌ | ❌ |
| Manage agent configuration | ✅ | ❌ | ❌ |

---

## Public Routes (No Auth Required)

- `/login`
- `/signup`
- `/forgot-password`
- `/reset-password`
- `/accept-invite`
- `/api/auth/**` (Supabase Auth webhook callbacks)

All other routes require a valid authenticated session with a resolvable `users` row.

---

# Agent Architecture

## Overview

Benavora's AI capabilities are implemented as four discrete agents, each with a single responsibility, deterministic I/O contracts, and explicit failure modes. Agents are orchestrated by Next.js API routes and Supabase Edge Functions; no dedicated orchestration framework is required at Tier 2 scale.

**AI Providers:**
- **Primary:** Anthropic Claude (claude-opus-4-5) — ResearchAgent, EligibilityScoringAgent
- **Secondary:** OpenAI GPT-4o — ConsensusValidationAgent (second-opinion validation per PRD requirement)
- **Utility:** Anthropic Claude Haiku (claude-haiku-4-5) — AlertGenerationAgent (low-latency, low-cost text generation)

---

## Agent 1: ResearchAgent

**Purpose:** Discover grant opportunities by querying the primary AI provider with organization context and search profile parameters. Classifies each discovered grant by `source_type`.

**Model:** `claude-opus-4-5` | **Token Budget:** 4,096

**Trigger:** Spawned N-times in parallel (one per active agent configuration) via `Promise.allSettled` when `POST /api/research/run` is called.

**Input Contract:**
```typescript
{
  organization_id: string;
  agent_config_id: string;
  search_profile: {
    funding_types: string[];
    source_type_filters: string[];
    focus_area_weights: Record<string, number>;
    amount_min: number | null;
    amount_max: number | null;
    geographic_scope: { type: string; states?: string[] };
    eligibility_filters: object;
    negative_filters: string[];
  };
  agent_instructions: string;
  run_id: string;
}
```

**Output Contract:**
```typescript
{
  agent_config_id: string;
  run_id: string;
  status: 'completed' | 'failed';
  error?: string;
  grants: Array<{
    title: string;
    funder_name: string;
    program_name: string;
    description: string;
    url: string | null;
    amount_min: number | null; // integer cents
    amount_max: number | null; // integer cents
    deadline: string | null;   // ISO 8601
    source_type: SourceTypeEnum;
    confidence_score: number;  // 0.0–1.0
    tags: string[];
  }>;
}
```

**Timeout:** 90 seconds. On timeout, `research_run_agents.status` set to `failed`, `error='timeout'`.
**Retry:** One retry on HTTP 429 after 5-second delay; second failure sets `error='rate_limited'`.

---

## Agent 2: EligibilityScoringAgent

**Purpose:** Score a single grant's eligibility match against the organization's search profile. Assigns a 0–100 score, an `eligibility_flag` enum value, and a 2–3 sentence rationale.

**Model:** `claude-opus-4-5` | **Token Budget:** 1,024

**Trigger:**
1. Asynchronously after each grant INSERT following research run deduplication.
2. Synchronously on-demand via `POST /api/grants/[id]/rescore`.

**Input Contract:**
```typescript
{
  grant_id: string;
  organization_id: string;
  grant: {
    title: string;
    funder_name: string;
    program_name: string;
    description: string;
    source_type: string;
    amount_min: number | null;
    amount_max: number | null;
    deadline: string | null;
    tags: string[];
  };
  eligibility_filters: {
    is_501c3: boolean;
    years_in_operation_min: number | null;
    annual_budget_min: number | null;
    annual_budget_max: number | null;
    staff_size_min: number | null;
    staff_size_max: number | null;
    served_population_tags: string[];
  };
  focus_area_weights: Record<string, number>;
  amount_min: number | null;
  amount_max: number | null;
  geographic_scope: object;
}
```

**Output Contract:**
```typescript
{
  grant_id: string;
  score: number;                    // integer 0–100
  eligibility_flag: 'high_match' | 'moderate_match' | 'low_match' | 'unscored';
  rationale: string;
  scored_at: string;                // ISO 8601
}
```

**Flag Thresholds:** score ≥ 80 → `high_match`; 50–79 → `moderate_match`; < 50 → `low_match`.
**Guard:** If no search profile exists for the organization, agent is skipped; grant set to `eligibility_flag='unscored'` with note: "Configure a Search Profile to enable eligibility scoring."
**Post-action:** If result is `high_match` and grant is < 24 hours old, AlertGenerationAgent is triggered with `trigger_type='high_match_found'`.

---

## Agent 3: ConsensusValidationAgent

**Purpose:** Provide an independent second-opinion assessment of a grant opportunity using OpenAI GPT-4o, enabling cross-model consensus scoring and discrepancy detection.

**Model:** `gpt-4o` | **Token Budget:** 1,024

**Trigger:**
1. Automatically for grants where ResearchAgent returned `confidence_score < 0.7`.
2. Manually via `POST /api/consensus/validate` from the Grant Detail page UI.

**Input Contract:**
```typescript
{
  grant_id: string;
  organization_id: string;
  grant: {
    title: string;
    funder_name: string;
    program_name: string;
    description: string;
    url: string | null;
    source_type: string;
    amount_min: number | null;
    amount_max: number | null;
    deadline: string | null;
    tags: string[];
  };
  primary_assessment: {
    source_type: string;
    confidence_score: number;
    eligibility_flag: string;
    eligibility_notes: string;
  };
}
```

**Output Contract:**
```typescript
{
  grant_id: string;
  secondary_model: string;               // 'gpt-4o'
  secondary_source_type: SourceTypeEnum;
  secondary_confidence_score: number;    // 0.0–1.0
  secondary_eligibility_score: number;   // 0–100
  secondary_rationale: string;
  consensus_score: number;               // avg of primary + secondary confidence
  source_type_agreement: boolean;
  eligibility_agreement: boolean;
  discrepancy_flag: boolean;             // true if |primary - secondary eligibility| > 20
  discrepancy_notes: string | null;
  validated_at: string;                  // ISO 8601
}
```

**Consensus Computation (orchestrator-side):**
- `consensus_score = (primary_confidence_score + secondary_confidence_score) / 2`
- `source_type_agreement = primary_source_type === secondary_source_type`
- `eligibility_agreement = Math.abs(primary_eligibility_score - secondary_eligibility_score) <= 20`
- `discrepancy_flag = !eligibility_agreement`
- Results written to `consensus_validations` table; `grants.consensus_validated = true`.

---

## Agent 4: AlertGenerationAgent

**Purpose:** Generate human-readable, actionable alert titles and body text for research run completions, high-match grant discoveries, approaching deadlines, and agent errors.

**Model:** `claude-haiku-4-5` | **Token Budget:** 512

**Trigger:**
1. After `research_runs.status` transitions to `completed` or `partial` (`trigger_type='run_completed'`).
2. After EligibilityScoringAgent scores a grant as `high_match` and grant age < 24 hours (`trigger_type='high_match_found'`).
3. Daily cron job for grants with `deadline` within 7 or 30 days (`trigger_type='deadline_approaching'`).

**Input Contract:**
```typescript
{
  organization_id: string;
  run_id: string;
  trigger_type: 'run_completed' | 'high_match_found' | 'deadline_approaching';
  run_summary?: {
    total_found: number;
    duplicates_removed: number;
    unique_saved: number;
    agents_succeeded: number;
    agents_failed: number;
  };
  new_high_match_grants?: Array<{
    grant_id: string;
    title: string;
    funder_name: string;
    match_percentage: number;
    deadline: string | null;
  }>;
  approaching_deadline_grants?: Array<{
    grant_id: string;
    title: string;
    funder_name: string;
    deadline: string;
    days_until_deadline: number;
  }>;
}
```

**Output Contract:**
```typescript
{
  alerts_created: Array<{
    alert_type: 'run_completed' | 'high_match_grant' | 'deadline_approaching' | 'agent_error';
    organization_id: string;
    title: string;       // max 80 chars
    body: string;        // max 200 chars
    priority: 'high' | 'medium' | 'low';
    grant_id: string | null;
    run_id: string | null;
    metadata: object;
  }>;
}
```

**Priority Rules:**
- `high`: deadline ≤ 7 days OR match_percentage ≥ 90
- `medium`: deadline 8–30 days OR match_percentage 70–89
- `low`: informational (run completions, low-urgency events)

---

## Orchestration Flow

### Research Run Orchestration (Primary Flow)

```
User: POST /api/research/run
  │
  ├─ [Guard] Check research_runs for status='running' → 409 if found
  ├─ INSERT research_runs (status='running')
  ├─ INSERT research_run_agents (one per active agent, status='pending')
  │
  ├─ Promise.allSettled([
  │     ResearchAgent(config1),   ← updates research_run_agents row in real-time
  │     ResearchAgent(config2),   ← Supabase Realtime pushes to frontend
  │     ResearchAgent(config3),
  │  ])
  │
  ├─ Deduplication Pipeline
  │     1. Normalize URLs (strip UTM, trailing slash, lowercase)
  │     2. Group by normalized URL, keep first occurrence
  │     3. Fuzzy match by (funder_name, program_name) — Levenshtein ≤ 3
  │     4. Merge metadata (union tags, highest confidence_score)
  │     5. Check existing grants table for org — skip if already tracked
  │     6. Write research_runs.deduplication_stats
  │
  ├─ INSERT unique grants into grants table
  │
  ├─ UPDATE research_runs.status → 'completed'|'partial'
  │
  ├─ [Async, non-blocking] EligibilityScoringAgent for each new grant
  │     └─ On high_match + age < 24h → AlertGenerationAgent(high_match_found)
  │
  ├─ AlertGenerationAgent(run_completed)
  │
  └─ [Auto] ConsensusValidationAgent for grants with confidence_score < 0.7
```

### Manual Rescore Flow
```
User: POST /api/grants/[id]/rescore
  └─ EligibilityScoringAgent (synchronous, 30s timeout)
        └─ UPDATE grants row
```

### Consensus Validation Flow
```
User: POST /api/consensus/validate  (or auto-triggered)
  └─ ConsensusValidationAgent (GPT-4o, independent assessment)
        └─ Orchestrator computes consensus_score, discrepancy_flag
              └─ INSERT consensus_validations row
                    └─ UPDATE grants.consensus_validated = true
```

---

## Error Handling Summary

| Agent | Timeout | Retry | Failure Mode |
|---|---|---|---|
| ResearchAgent | 90s | 1x on 429 (5s delay) | Agent marked `failed`; run continues with other agents |
| EligibilityScoringAgent | 30s | None | Grant saved with `eligibility_flag='unscored'` |
| ConsensusValidationAgent | 30s | None | `consensus_validations` row skipped; grant remains without consensus |
| AlertGenerationAgent | 15s | None | Alerts skipped; logged to server console |

**Stale Run Recovery:** Vercel cron (every 10 minutes) marks `research_runs` with `status='running'` and `started_at < now() - interval '10 minutes'` as `failed`.

---

## Database Tables Supporting Agents

| Table | Purpose | Tenant-Scoped |
|---|---|---|
| `research_runs` | One row per run; tracks status, timing, dedup stats | Yes (`organization_id`) |
| `research_run_agents` | One row per agent per run; tracks per-agent status and raw results | Yes (via `research_runs.organization_id`) |
| `grants` | Persisted grant opportunities with `source_type`, `match_percentage`, `eligibility_flag`, `eligibility_notes`, `eligibility_scored_at`, `consensus_validated` | Yes (`organization_id`) |
| `consensus_validations` | Stores ConsensusValidationAgent output per grant | Yes (`organization_id`) |
| `alerts` | Stores AlertGenerationAgent output; read by `/api/alerts` | Yes (`organization_id`) |
| `search_profiles` | Organization search profile consumed by ResearchAgent and EligibilityScoringAgent | Yes (`organization_id`) |

All tables have RLS enabled with `organization_id`-scoped policies enforcing tenant isolation.

---

# Infrastructure & Deployment Architecture

## Overview

Benavora is deployed on **Vercel** (Next.js 14 App Router, TypeScript strict, pnpm) backed by **Supabase** (Postgres + Auth + RLS + Realtime). This document specifies the three environment tiers, all environment variable names, deployment pipeline, monitoring/telemetry stack, and measurable performance budgets.

---

## Environments

### 1. Development

Local developer machines running `pnpm dev` (Next.js dev server on port 3000) connected to either a local Supabase CLI instance (`supabase start`) or a shared dev Supabase project.

**Purpose:** Feature development, unit/integration testing, local debugging of AI agent flows.

**AI Keys:** Sandbox/test API keys for Anthropic and OpenAI with reduced spend caps.

**Environment Variables:**

| Variable | Purpose |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project REST/Realtime URL (public) |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase anon JWT for client-side RLS queries |
| `SUPABASE_SERVICE_ROLE_KEY` | Service role key for server-side admin operations |
| `SUPABASE_DB_URL` | Direct Postgres connection string for migrations |
| `ANTHROPIC_API_KEY` | Anthropic Claude API key (ResearchAgent, EligibilityScoringAgent) |
| `OPENAI_API_KEY` | OpenAI GPT-4o key (ConsensusValidationAgent) |
| `NEXT_PUBLIC_APP_URL` | Base URL for constructing absolute links |
| `CRON_SECRET` | Bearer token protecting cron API routes from unauthorized calls |
| `RESEND_API_KEY` | Resend transactional email key (alert digests) |
| `NEXT_PUBLIC_POSTHOG_KEY` | PostHog project API key (client-side analytics) |
| `NEXT_PUBLIC_POSTHOG_HOST` | PostHog ingest host URL |
| `SENTRY_DSN` | Sentry DSN for error capture |
| `SENTRY_ORG` | Sentry organization slug |
| `SENTRY_PROJECT` | Sentry project slug |
| `AGENT_TIMEOUT_MS` | Per-agent execution timeout in milliseconds (default: 90000) |
| `AGENT_RETRY_DELAY_MS` | Delay before agent retry after rate-limit (default: 5000) |
| `MAX_CONCURRENT_AGENTS` | Maximum parallel agents per research run (default: 10) |
| `ELIGIBILITY_SCORE_HIGH_THRESHOLD` | Score threshold for high_match flag (default: 80) |
| `ELIGIBILITY_SCORE_MODERATE_THRESHOLD` | Score threshold for moderate_match flag (default: 50) |
| `LOG_LEVEL` | Pino log level: debug / info / warn / error |

---

### 2. Preview

Vercel preview deployments automatically created for every pull request. Each preview gets a unique ephemeral URL (`benavora-git-{branch}-{team}.vercel.app`). Connected to a dedicated Supabase **staging** project with seeded test organizations, grants, and research runs.

**Purpose:** QA testing, design review, stakeholder demos, integration testing before merge.

**Environment Variables:** All development variables plus:

| Variable | Purpose |
|---|---|
| `VERCEL_ENV` | Set by Vercel: `preview` |
| `VERCEL_URL` | Ephemeral deployment URL injected by Vercel |

---

### 3. Production

Vercel production deployment triggered by merges to the `main` branch. Connected to the production Supabase project with PgBouncer connection pooling, full RLS enforcement, and Supabase Realtime enabled on `research_run_agents` and `alerts` tables.

**Purpose:** Live application serving real nonprofit organizations.

**Environment Variables:** All preview variables plus:

| Variable | Purpose |
|---|---|
| `SENTRY_AUTH_TOKEN` | Token for uploading source maps to Sentry during build |

---

## Deployment Pipeline

### CI/CD Flow

```
GitHub PR opened
  → GitHub Actions: pnpm install → TypeScript check → ESLint → unit tests
  → Supabase: supabase db push (staging)
  → Vercel: preview deployment created
  → GitHub PR merged to main
  → GitHub Actions: pnpm install → TypeScript check → ESLint → unit tests
  → Supabase: supabase db push (production)
  → Vercel: production deployment promoted
```

### Build Configuration

- **Build command:** `pnpm build` (runs `next build` with strict TypeScript and ESLint)
- **Install command:** `pnpm install --frozen-lockfile`
- **Output:** `.next` (standard Next.js build output)
- **Node.js version:** 20.x LTS
- **Framework preset:** Next.js (Vercel auto-detected)

### Serverless Function Configuration

AI-heavy API routes require extended execution time and are configured in `next.config.ts`:

| Route | maxDuration | Reason |
|---|---|---|
| `POST /api/research/run` | 300s | Parallel multi-agent AI execution |
| `POST /api/grants/[id]/rescore` | 30s | Single AI eligibility scoring |
| `POST /api/consensus/validate` | 60s | Parallel dual-model consensus |
| `GET /api/analytics/summary` | 30s | Heavy aggregation query |
| All other routes | 10s (default) | Standard CRUD operations |

Primary deployment region: `iad1` (US East, Virginia) — closest to Supabase default region.

### Cron Jobs (`vercel.json`)

| Path | Schedule | Purpose |
|---|---|---|
| `GET /api/cron/stale-runs` | `*/10 * * * *` (every 10 min) | Marks `research_runs` with `status='running'` and `started_at > 10 min ago` as `failed`. Prevents indefinitely stuck runs from blocking new research. |
| `GET /api/cron/alert-digest` | `0 8 * * *` (daily 08:00 UTC) | Triggers daily alert digest emails via Resend for organizations with unread alerts. |

All cron routes validate the `Authorization: Bearer {CRON_SECRET}` header and return 401 for unauthorized requests.

### Security Headers (`next.config.ts`)

Applied globally via `headers()` configuration:

```
X-Frame-Options: DENY
X-Content-Type-Options: nosniff
Referrer-Policy: strict-origin-when-cross-origin
Permissions-Policy: camera=(), microphone=(), geolocation=()
Content-Security-Policy:
  default-src 'self';
  script-src 'self' 'nonce-{nonce}' https://cdn.posthog.com;
  connect-src 'self' https://*.supabase.co wss://*.supabase.co
    https://api.anthropic.com https://api.openai.com https://app.posthog.com;
  frame-ancestors 'none';
```

### Supabase Realtime Channels

Two Realtime subscriptions active in production:

1. **`research_run_agents` table** — subscribed during active research runs; filter: `organization_id=eq.{org_id}`. Drives per-agent status card updates (Queued → Running → Completed/Failed).
2. **`alerts` table** — subscribed globally while authenticated; filter: `organization_id=eq.{org_id}`. Drives sidebar alert badge count and real-time alert panel updates.

Row-level filter on Realtime channels prevents cross-tenant data exposure.

---

## Monitoring & Telemetry

### Error Tracking: Sentry

- **SDK:** `@sentry/nextjs`
- **Coverage:** Client-side React errors, server-side API route exceptions, Edge Function errors
- **Source maps:** Uploaded at build time via `SENTRY_AUTH_TOKEN`
- **Performance tracing:** Enabled at 10% sample rate in production
- **Custom spans:** All AI provider calls instrument spans: `agent_execution`, `deduplication`, `eligibility_scoring`, `consensus_validation`, `db_insert`
- **Alert rules:**
  - Error rate spike > 1% over 5 minutes → immediate notification
  - New unhandled exception type → immediate notification
  - All agents failing in a single research run → P0 alert
  - Supabase connection pool exhausted → P0 alert

### Product Analytics: PostHog

- **Client SDK:** `posthog-js` initialized in root layout
- **Server SDK:** `posthog-node` for server-side event capture
- **PII policy:** `organization_id` is hashed before transmission; no personally identifiable user data in event properties

**Tracked Events:**

| Event | Key Properties |
|---|---|
| `research_run_started` | `agent_count`, `search_profile_configured` |
| `research_run_completed` | `total_found`, `duplicates_removed`, `unique_saved`, `duration_ms`, `partial_failure` |
| `grant_eligibility_scored` | `score`, `flag`, `rescore_manual` |
| `consensus_validation_requested` | `grant_id`, `models_used` |
| `alert_viewed` | `alert_type`, `alert_age_hours` |
| `alert_dismissed` | `alert_type` |
| `alert_read_all` | `count` |
| `search_profile_saved` | `funding_types_count`, `negative_filters_count`, `geographic_scope_type` |
| `analytics_dashboard_viewed` | `date_range` |
| `source_type_manually_set` | `source_type` |

### Structured Logging: Pino

- **Format:** JSON, streamed to Vercel Log Drains → Vercel built-in observability dashboard
- **Log fields:** `level`, `timestamp`, `organization_id` (hashed), `route`, `duration_ms`, `ai_provider`, `agent_id`, `error_code`, `request_id`
- **Log levels by environment:** `debug` (development), `info` (preview), `warn` (production default), overridable via `LOG_LEVEL`

### AI Usage Logging

All calls to Anthropic and OpenAI are wrapped by a `withAILogging()` middleware that records to the `ai_usage_logs` table:

| Column | Type | Description |
|---|---|---|
| `id` | uuid | Primary key |
| `organization_id` | uuid | Tenant scope |
| `provider` | text | `anthropic` or `openai` |
| `model` | text | e.g., `claude-3-5-sonnet-20241022` |
| `agent_type` | text | `research`, `eligibility`, `consensus`, `alert` |
| `prompt_tokens` | integer | Tokens in prompt |
| `completion_tokens` | integer | Tokens in response |
| `latency_ms` | integer | Provider round-trip time |
| `success` | boolean | Whether call succeeded |
| `error_code` | text | Provider error code if failed |
| `created_at` | timestamptz | Log timestamp |

This enables per-organization cost attribution and proactive rate-limit monitoring.

### Uptime Monitoring

- **Endpoint:** `GET /api/health` — returns `{ status: 'ok', supabase: 'connected', timestamp: ISO8601 }` with HTTP 200
- **Vercel checks:** Automatic uptime checks on `/` and `/api/health` with alerting on 2 consecutive failures

### Database Performance Monitoring

- **Tool:** Supabase Dashboard → Query Performance panel
- **Slow query threshold:** 500ms (logged and alerted)
- **Monitored indexes:**
  - `grants(organization_id, source_type)`
  - `grants(organization_id, eligibility_flag)`
  - `grants(organization_id, deadline)`
  - `grants(organization_id, status, created_at)`
  - `research_runs(organization_id, status, started_at)`
  - `alerts(organization_id, is_read, created_at)`
  - `ai_usage_logs(organization_id, created_at)`

---

## Performance Budgets

| Metric | Target |
|---|---|
| **Largest Contentful Paint (LCP)** — Dashboard page | ≤ 2.5s (p75, Vercel Speed Insights) |
| **Interaction to Next Paint (INP)** | ≤ 200ms (p75) |
| **Cumulative Layout Shift (CLS)** | ≤ 0.1 (all pages) |
| **Time to First Byte (TTFB)** — server-rendered pages | ≤ 600ms (p95) |
| **GET /api/grants** (paginated, ≤ 100 rows) | ≤ 300ms (p95) |
| **GET /api/analytics/summary** (up to 10,000 grants) | ≤ 2,000ms (p95) |
| **Individual analytics sub-endpoints** (funnel, financials, by-source, deadlines, agent-activity) | ≤ 800ms each (p95) |
| **POST /api/research/run** — full parallel run (5 agents) | ≤ 120s end-to-end; 90s per-agent hard timeout |
| **POST /api/grants/[id]/rescore** — single eligibility score | ≤ 15s (p95) |
| **POST /api/consensus/validate** — dual-model consensus | ≤ 30s (p95) |
| **Initial JS bundle** (gzipped, first-load chunks) | ≤ 250 KB |
| **Analytics chart render** (after data load) | ≤ 500ms |
| **Supabase Realtime update propagation** (DB write → client event) | ≤ 1,000ms (p95) |
| **GET /api/alerts** — unread count + list | ≤ 200ms (p95) |
| **Core Web Vitals pass rate** | ≥ 90% of page loads pass all three CWV thresholds |

---

## Architectural Notes

### Recharts SSR Safety

All Recharts chart components in `/analytics` are loaded via:
```typescript
const PipelineFunnelChart = dynamic(() => import('@/components/charts/PipelineFunnelChart'), { ssr: false });
```
This prevents hydration mismatch errors since Recharts relies on browser DOM APIs unavailable during SSR.

### Connection Pooling

Production Supabase connections use PgBouncer (transaction mode) via the `SUPABASE_DB_URL` pooler endpoint. Direct connections (session mode) reserved for migrations only via a separate `SUPABASE_DIRECT_URL` variable used exclusively in `supabase db push` CI steps.

### Multi-Tenant Isolation in Realtime

Supabase Realtime channel subscriptions include row-filter clauses (`organization_id=eq.{currentOrgId}`) to ensure tenants only receive their own real-time events. This is enforced at both the channel subscription level (client) and via RLS policies on the underlying tables (server).

### Cost Controls

- `ANTHROPIC_API_KEY` and `OPENAI_API_KEY` have spend limits configured at the provider dashboard level
- `MAX_CONCURRENT_AGENTS` environment variable caps parallel AI calls per research run to prevent runaway costs from misconfiguration
- `ai_usage_logs` table enables monthly cost attribution reports per organization for future billing features

---

# Testing Strategy

## Overview

This testing strategy covers the full Benavora Tier 2 feature set across Playwright end-to-end specs, API integration tests, and a Six Laws verification plan. All tests target the FORGE default stack: Next.js 14 App Router, Supabase (Postgres + Auth + RLS), Vercel, pnpm, TypeScript strict.

---

## Playwright End-to-End Specifications

All specs live in `e2e/` and run via `pnpm exec playwright test` against the Vercel preview deployment on every pull request.

### Spec 1 – Grant Source Type Badge and Filter Flow
**File:** `e2e/grant-source-type.spec.ts`

Covers Feature 1 (Grant Source Categorization) end-to-end:
- Badge color class rendering per source type
- Filter-by-source-type URL param behavior
- Manual source type update via PATCH with optimistic UI and toast feedback
- Persistence after page reload

### Spec 2 – Research Run Parallel Execution and Deduplication
**File:** `e2e/research-run.spec.ts`

Covers Feature 2 (Parallel Research Execution):
- Agent progress panel real-time state transitions via Supabase Realtime
- Completion toast variants (success / partial / all-failed)
- Deduplication stats summary banner
- Concurrent run prevention (409 enforcement + disabled button)

### Spec 3 – Search Profile Configuration Full Flow
**File:** `e2e/search-profile.spec.ts`

Covers Feature 3 (Search Profile Configuration):
- All form sections: funding types, source filters, focus areas, dollar range, geographic scope, eligibility filters, negative filters
- Validation errors (empty funding types, min > max, state-specific with no states)
- Duplicate tag prevention
- Save, persist, and reset-to-defaults flows

### Spec 4 – Analytics Dashboard Charts Render and Filter
**File:** `e2e/analytics-dashboard.spec.ts`

Covers Feature 4 (Analytics Dashboard):
- All six chart panels render without error
- Date range selection updates URL params
- Pie chart slice click filters grant table below
- Deadline heatmap cell click filters grant table
- /outcomes → /analytics redirect (HTTP 301)

### Spec 5 – Eligibility Scoring and High Match Badge
**File:** `e2e/eligibility-scoring.spec.ts`

Covers Feature 5 (Automated Eligibility Enhancement):
- Badge variants per eligibility_flag value
- Filter-by-eligibility-flag flow
- Eligibility detail panel expand/collapse
- Manual re-score button with spinner and toast feedback

### Spec 6 – Alerts Center Read and Mark All Read
**File:** `e2e/alerts.spec.ts`

Covers the Alerts feature:
- Sidebar badge unread count
- Individual alert mark-read
- Bulk mark-all-read
- Empty state rendering

### Spec 7 – Consensus Validation Request and Result Display
**File:** `e2e/consensus-validation.spec.ts`

Covers the Consensus Validation feature:
- Validate button triggers POST /api/consensus/validate
- Result panel shows Claude score, GPT-4o score, consensus score, agreement badge
- Result persists on page reload (GET /api/consensus/[grant_id])

### Spec 8 – Role-Based Access Control Enforcement
**File:** `e2e/rbac.spec.ts`

Covers auth roles [admin, member, viewer]:
- Viewer cannot edit source type, rescore, or configure search profile
- Member cannot manage team settings but can run research
- UI controls hidden/disabled per role

### Spec 9 – Multi-Tenant Data Isolation
**File:** `e2e/tenant-isolation.spec.ts`

Covers Six Laws Law 1:
- Cross-organization grant access returns 404
- Cross-organization PATCH returns 403/404
- Grant list never contains another organization's grants

### Spec 10 – Concurrent Research Run Prevention
**File:** `e2e/concurrent-research.spec.ts`

Covers Feature 2.5:
- Button disabled state during active run
- 409 response handling
- Button re-enables after run completes

---

## API Test Specifications

All API tests use Vitest + supertest against a locally running Next.js server (or Vercel preview in CI). Each route is tested for authentication, tenant isolation, valid inputs, and error cases.

| Route | Key Cases |
|---|---|
| `GET /api/grants` | Auth, tenant scope, source_type filter, eligibility_flag filter, pagination |
| `GET /api/grants/[id]` | Auth, own-org 200, other-org 404 |
| `PATCH /api/grants/[id]` | Auth, valid enum, invalid enum 400, cross-tenant 403/404, viewer 403 |
| `POST /api/grants/[id]/rescore` | Auth, success with score fields, no profile 400, viewer 403 |
| `POST /api/research/run` | Auth, 201 creates run, 409 on concurrent, viewer 403, no agents 400 |
| `GET /api/research/runs` | Auth, tenant scope, deduplication_stats present |
| `GET /api/research/runs/[id]` | Auth, includes agents array, cross-tenant 404 |
| `GET /api/search-profiles` | Auth, 200 with all fields, 404 when none exists |
| `POST /api/search-profiles` | Auth, upsert, empty funding_types 400, min>max 400, state scope validation |
| `GET /api/analytics/summary` | Auth, date range params, zero-value metrics for empty org |
| `GET /api/analytics/funnel` | Auth, all stages returned with 0 counts when empty |
| `GET /api/analytics/financials` | Auth, NULL amount handling, monthly buckets |
| `GET /api/analytics/by-source` | Auth, NULL source_type → 'other', tenant scope |
| `GET /api/analytics/deadlines` | Auth, future dates only, empty array not error |
| `GET /api/analytics/agent-activity` | Auth, duplicates_removed included, empty array |
| `GET /api/alerts` | Auth, sorted by read/created_at, tenant scope, unread_count metadata |
| `POST /api/alerts/[id]/read` | Auth, cross-tenant 404, idempotent |
| `POST /api/alerts/read-all` | Auth, only own-org alerts, affected_count=0 safe |
| `POST /api/consensus/validate` | Auth, response fields, cross-tenant 404, viewer 403 |
| `GET /api/consensus/[grant_id]` | Auth, cross-tenant 404, 404 when none exists, all result fields |

Full case details are enumerated in the `apiTests` array above.

---

## Six Laws Verification Plan

### Law 1 – Schema Integrity (Automated)
**Verification:** Jest/Vitest database tests connect to the Supabase test instance and assert:
- `organization_id` column exists on every multi-tenant table: `grants`, `research_runs`, `research_run_agents`, `search_profiles`, `alerts`, `consensus_validations`, `agents`
- RLS is enabled (`relrowsecurity=true`) on each of these tables
- At least one RLS policy exists per table
- A cross-tenant SELECT (JWT from Org B querying Org A data) returns zero rows

Runs on every pull request in CI.

### Law 2 – API Contract Integrity (Automated)
**Verification:** Vitest + supertest integration tests cover:
- Every route returns 401 without auth token
- Every mutating route returns 403/404 for cross-tenant resource access
- Viewer role JWT blocked from all admin/member-only routes
- All HTTP status codes match specification (409 concurrent, 400 validation, 404 not-found)

Runs on every pull request in CI.

### Law 3 – UI Integrity (Automated)
**Verification:**
- `page.on('console', ...)` catches hydration errors in all Playwright specs
- axe-playwright accessibility scan on all 13 page routes (zero critical/serious violations)
- Empty state and error state verified by intercepting APIs to return 200/[] and 500 respectively
- `next build` TypeScript strict mode must succeed (zero errors) in CI
- Static analysis grep confirms all Recharts components use `dynamic(..., { ssr: false })`

### Law 4 – Data Integrity (Automated)
**Verification:**
- Zod schema unit tests for every API route request body
- Database constraint tests: invalid enum INSERT, NULL organization_id INSERT, orphaned FK INSERT
- Deduplication logic unit test: URL normalization, Levenshtein fuzzy match, metadata merge
- Cron job test: research_runs rows >10 min old with status=running are marked failed
- Default value tests: existing grants show `source_type='other'` and `eligibility_flag='unscored'` after migration

### Law 5 – Wiring Integrity (Automated)
**Verification:**
- Playwright network intercept assertions: every form submit calls correct API route with correct payload
- Supabase Realtime test: direct DB write to `research_run_agents` triggers UI card update within 5 seconds
- Agent integration tests with mocked AI providers: assert correct prompts, correct provider calls (Claude for primary, GPT-4o for consensus), correct DB writes after each agent
- Optimistic update rollback test: delayed + failed PATCH causes badge revert

### Law 6 – Human Verification (Manual, Required for Production Deploy)
**Verification:** QA Engineer + Product Owner sign-off required:
1. Full Playwright suite pass on Vercel preview
2. Manual walkthrough of all 7 PRD features against interaction maps
3. Badge color verification against exact Tailwind classes from PRD
4. Cross-browser Recharts rendering check (Chrome, Firefox, Safari)
5. /outcomes → /analytics redirect confirmed
6. Manual tenant isolation check with two test organizations
7. Empty/error/loading states confirmed on all dashboard panels
8. Sign-offs recorded in deployment checklist before production deploy

---

## CI Pipeline Integration

```
# .github/workflows/ci.yml (summary)
jobs:
  type-check:     next build (TypeScript strict)
  unit-tests:     vitest run (schema, validation, deduplication, agents)
  api-tests:      vitest run --config vitest.api.config.ts (supertest)
  db-tests:       vitest run --config vitest.db.config.ts (RLS, constraints)
  e2e-tests:      playwright test (all 10 specs against preview URL)
  accessibility:  axe-playwright scan on all page routes
```

All jobs must pass before merge to main. Production deploy additionally requires Law 6 human sign-off.

---

## Test Data Management

- **Seed script:** `scripts/seed-test-data.ts` creates two isolated test organizations (Org A, Org B) with:
  - 50 grants each with varied source_types, eligibility_flags, statuses, and amounts
  - 3 completed research_runs with deduplication_stats
  - 1 search_profile per org
  - 10 alerts each (5 read, 5 unread)
  - 5 consensus_validations
- **Cleanup:** Each Playwright spec uses `test.beforeEach` to reset to a known seed state via `POST /api/test/reset` (only available in `NODE_ENV=test`)
- **AI mocking:** All AI provider calls are mocked via `vi.mock('@anthropic-ai/sdk')` and `vi.mock('openai')` in unit/integration tests; real providers only called in manual QA runs

---

## Cross-Validation (45 issue(s))
- ❌ **api_unknown_table** [schema_api] (GET /api/grants) — API route references table 'grants', which is not defined in DatabaseArchitecture.
- ❌ **api_unknown_table** [schema_api] (GET /api/grants/[id]) — API route references table 'grants', which is not defined in DatabaseArchitecture.
- ❌ **api_unknown_table** [schema_api] (PATCH /api/grants/[id]) — API route references table 'grants', which is not defined in DatabaseArchitecture.
- ❌ **api_unknown_table** [schema_api] (PATCH /api/grants/[id]) — API route references table 'grants', which is not defined in DatabaseArchitecture.
- ❌ **api_unknown_table** [schema_api] (POST /api/grants/[id]/rescore) — API route references table 'grants', which is not defined in DatabaseArchitecture.
- ❌ **api_unknown_table** [schema_api] (POST /api/grants/[id]/rescore) — API route references table 'search_profiles', which is not defined in DatabaseArchitecture.
- ❌ **api_unknown_table** [schema_api] (POST /api/grants/[id]/rescore) — API route references table 'grants', which is not defined in DatabaseArchitecture.
- ❌ **api_unknown_table** [schema_api] (POST /api/research/run) — API route references table 'research_runs', which is not defined in DatabaseArchitecture.
- ❌ **api_unknown_table** [schema_api] (POST /api/research/run) — API route references table 'agents', which is not defined in DatabaseArchitecture.
- ❌ **api_unknown_table** [schema_api] (POST /api/research/run) — API route references table 'search_profiles', which is not defined in DatabaseArchitecture.
- ❌ **api_unknown_table** [schema_api] (POST /api/research/run) — API route references table 'research_runs', which is not defined in DatabaseArchitecture.
- ❌ **api_unknown_table** [schema_api] (POST /api/research/run) — API route references table 'research_run_agents', which is not defined in DatabaseArchitecture.
- ❌ **api_unknown_table** [schema_api] (GET /api/research/runs) — API route references table 'research_runs', which is not defined in DatabaseArchitecture.
- ❌ **api_unknown_table** [schema_api] (GET /api/research/runs/[id]) — API route references table 'research_runs', which is not defined in DatabaseArchitecture.
- ❌ **api_unknown_table** [schema_api] (GET /api/research/runs/[id]) — API route references table 'research_run_agents', which is not defined in DatabaseArchitecture.
- ❌ **api_unknown_table** [schema_api] (GET /api/search-profiles) — API route references table 'search_profiles', which is not defined in DatabaseArchitecture.
- ❌ **api_unknown_table** [schema_api] (POST /api/search-profiles) — API route references table 'search_profiles', which is not defined in DatabaseArchitecture.
- ❌ **api_unknown_table** [schema_api] (POST /api/search-profiles) — API route references table 'search_profiles', which is not defined in DatabaseArchitecture.
- ❌ **api_unknown_table** [schema_api] (GET /api/analytics/summary) — API route references table 'grants', which is not defined in DatabaseArchitecture.
- ❌ **api_unknown_table** [schema_api] (GET /api/analytics/funnel) — API route references table 'grants', which is not defined in DatabaseArchitecture.
- ❌ **api_unknown_table** [schema_api] (GET /api/analytics/financials) — API route references table 'grants', which is not defined in DatabaseArchitecture.
- ❌ **api_unknown_table** [schema_api] (GET /api/analytics/by-source) — API route references table 'grants', which is not defined in DatabaseArchitecture.
- ❌ **api_unknown_table** [schema_api] (GET /api/analytics/deadlines) — API route references table 'grants', which is not defined in DatabaseArchitecture.
- ❌ **api_unknown_table** [schema_api] (GET /api/analytics/agent-activity) — API route references table 'research_runs', which is not defined in DatabaseArchitecture.
- ❌ **api_unknown_table** [schema_api] (GET /api/alerts) — API route references table 'alerts', which is not defined in DatabaseArchitecture.
- ❌ **api_unknown_table** [schema_api] (POST /api/alerts/[id]/read) — API route references table 'alerts', which is not defined in DatabaseArchitecture.
- ❌ **api_unknown_table** [schema_api] (POST /api/alerts/[id]/read) — API route references table 'alerts', which is not defined in DatabaseArchitecture.
- ❌ **api_unknown_table** [schema_api] (POST /api/alerts/read-all) — API route references table 'alerts', which is not defined in DatabaseArchitecture.
- ❌ **api_unknown_table** [schema_api] (POST /api/alerts/read-all) — API route references table 'alerts', which is not defined in DatabaseArchitecture.
- ❌ **api_unknown_table** [schema_api] (POST /api/consensus/validate) — API route references table 'grants', which is not defined in DatabaseArchitecture.
- ❌ **api_unknown_table** [schema_api] (POST /api/consensus/validate) — API route references table 'search_profiles', which is not defined in DatabaseArchitecture.
- ❌ **api_unknown_table** [schema_api] (POST /api/consensus/validate) — API route references table 'grants', which is not defined in DatabaseArchitecture.
- ❌ **api_unknown_table** [schema_api] (POST /api/consensus/validate) — API route references table 'consensus_validations', which is not defined in DatabaseArchitecture.
- ❌ **api_unknown_table** [schema_api] (GET /api/consensus/[grant_id]) — API route references table 'consensus_validations', which is not defined in DatabaseArchitecture.
- ❌ **api_unknown_table** [schema_api] (GET /api/consensus/[grant_id]) — API route references table 'grants', which is not defined in DatabaseArchitecture.
- ❌ **empty_database** [completeness] (DatabaseArchitecture) — No tables were designed.
- ❌ **interaction_unknown_table** [interaction_schema] (Feature 1 – Grant Source Categorization / Source Type Dropdown on Grant Detail Page) — Interaction map writes table 'grants', which is not defined in DatabaseArchitecture.
- ❌ **interaction_unknown_table** [interaction_schema] (Feature 1 – Grant Source Categorization / AI Auto-Assignment of source_type During Research Run) — Interaction map writes table 'grants', which is not defined in DatabaseArchitecture.
- ❌ **interaction_unknown_table** [interaction_schema] (Feature 2 – Research Agent Parallel Execution / Run Research Button on Research/Dashboard Page) — Interaction map writes table 'research_runs', which is not defined in DatabaseArchitecture.
- ❌ **interaction_unknown_table** [interaction_schema] (Feature 2 – Research Agent Parallel Execution / Per-Agent Status Cards in Research Progress Panel) — Interaction map writes table 'research_run_agents', which is not defined in DatabaseArchitecture.
- ❌ **interaction_unknown_table** [interaction_schema] (Feature 2 – Research Agent Parallel Execution / Deduplication Summary Banner After Run Completion) — Interaction map writes table 'grants', which is not defined in DatabaseArchitecture.
- ❌ **interaction_unknown_table** [interaction_schema] (Feature 3 – Search Profile Configuration / Save Search Profile Button) — Interaction map writes table 'search_profiles', which is not defined in DatabaseArchitecture.
- ❌ **interaction_unknown_table** [interaction_schema] (Feature 5 – Automated Eligibility Enhancement / Re-score Button in Eligibility Detail Panel) — Interaction map writes table 'grants', which is not defined in DatabaseArchitecture.
- ❌ **interaction_unknown_table** [interaction_schema] (Feature 5 – Automated Eligibility Enhancement / Automated Eligibility Scoring on Grant Discovery) — Interaction map writes table 'grants', which is not defined in DatabaseArchitecture.
- ❌ **interaction_unknown_table** [interaction_schema] (Feature 5 – Automated Eligibility Enhancement / Sidebar Alert Badge for New High Match Grants) — Interaction map writes table 'alerts', which is not defined in DatabaseArchitecture.

## Warnings
- 1/8 DatabaseArchitecture: model output was not a JSON object; used a fallback skeleton.
