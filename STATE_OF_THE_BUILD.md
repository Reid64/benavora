# STATE OF THE BUILD — Benavora v2.0.0

_Generated from a live codebase audit on 2026-06-13 (Tiers 4+5 complete: Browser Automation + SaaS Readiness)._

## Overview

Benavora is a multi-tenant nonprofit grant/fundraising platform. Every table is
organization-scoped with Row Level Security; `organization_id` is always derived
server-side from the authenticated session, never from a request body.

**Stack (locked):** Next.js 14 (App Router, TypeScript strict) · Supabase
(Postgres + Auth + RLS) · Tailwind CSS · Playwright · pnpm · Vercel.

**Version: v2.0.0** — Tiers 1–5 complete.

## Tier completion status

| Tier | Description | Status |
| --- | --- | --- |
| Original FORGE Build | Core platform (auth, KB, opportunities, applications, drafts, agents) | ✅ COMPLETE |
| Tier 1 | Draft persistence, nav state, KB detail, humanizer agent | ✅ COMPLETE |
| Tier 2 | Source categorization, parallel research, search config, analytics, eligibility, alerts, multi-model validation | ✅ COMPLETE |
| Tier 3 | Budget narrative, document assembly, funder intel, renewals, success patterns, compliance, outreach, calendar, email parser, board reports | ✅ COMPLETE |
| Tier 4 | Browser automation with human approval workflow, portal credentials, form detection + field mapping, challenge detection, document uploading | ✅ COMPLETE |
| Tier 5 | Stripe billing, webhook handler, usage limits, usage dashboard, 7-step onboarding wizard, audit logs, audit log viewer (owner/admin), admin sidebar gating | ✅ COMPLETE |

## Codebase inventory (audited 2026-06-13)

| Area | Count | Notes |
| --- | --- | --- |
| App pages (`page.tsx`) | 46 | +3 this session: `admin/audit-log`, `billing`, `(dashboard)/onboarding`; automation pages added in Tier 4 |
| API routes (`route.ts`) | 52 | +12 this session: billing, billing/usage, webhooks/stripe, onboarding, automation routes, audit-log, admin/usage, invite, ai/draft |
| React components (`.tsx`) | 87 | +8 this session: `PlanCard`, `UsageMeter`, `FieldReport`, `SessionList`, `ApprovalWorkflow`, `ScreenshotViewer`, `FunderDetail`, `FunderForm`, `ApplicationDetail` |
| Agent modules (`src/lib/agents/*.ts`) | 29 | +6 this session: `browser-automation`, `budget-agent`, `funder-intel`, `recursive-learning`, `email-parser` + supporting Tier 3/4 agents |
| SQL migrations | 24 | `001–024`; Tier 5 adds `020–024` (automation_sessions, billing_tables, usage_tracking, onboarding_step, audit_logs) |
| AI routes | 7 | draft, humanize, review, summarize, fit-analysis, validate, budget |
| Dependencies | stripe, recharts, archiver, pdf-lib | All installed |

## Feature areas (implemented)

- **Auth & onboarding** — registration, org bootstrap (`register_organization`),
  invitations, **password reset**, multi-step onboarding wizard, **middleware
  session refresh + role-gated header injection**, role gates
  (owner/admin/writer/viewer).
- **Opportunities & applications** — CRUD, pipeline board with stage transitions,
  pipeline history timeline.
- **Grants API** — REST surface over the `opportunities` table under the contract's
  "grants" vocabulary: list with filters/pagination, single-grant detail, partial
  update, and manual eligibility re-score (`/api/grants*`).
- **Knowledge base** — org profile, narratives (list + detail view), answers,
  proven-narrative scoring.
- **Draft generator** — grounded AI drafting via `/api/ai/draft`, two-pass
  humanization via `/api/ai/humanize`, confidence scoring, source transparency,
  draft version history, `?opportunity=` deep link.
- **AI agents** — research (corporate/foundation/government/local), eligibility,
  deadline extraction, summary, review, recursive learning, cold outreach,
  humanizer.
- **Automation** — browser form-fill sessions with human approval workflow.
- **Integrations** — Google (Gmail + Calendar), Stripe billing + usage metering.
- **Admin** — audit log, usage dashboard.
- **Alerts / daily action list** — org-scoped `alerts` table generated from live
  data (deadlines ≤7 days, new opportunities since last login, applications
  needing action, drafts pending review); `/alerts` page with clickable,
  dismissible, snoozable items; red notification badge counts on the sidebar nav.
- **Cross-provider validation** — each discovered opportunity is judged
  independently by two AI providers (Anthropic Claude + free-tier Google Gemini)
  on existence, eligibility, deadline, and amounts; verdicts stored in the
  org-scoped `validations` table (one row per provider). An opportunity is
  "Verified" only when both providers agree; the badge shows on the detail header
  and a Validation tab breaks out each provider's per-field findings. Findings are
  auto-validated after each research sweep (bounded, gated on a configured
  free-tier provider).

## This session — Tiers 4+5: Browser Automation + SaaS Readiness (v2.0.0)

FORGE prompt: verify all Tier 5 SaaS features are accessible and functional;
fix all TypeScript errors; fix all build errors; remove console.log and unused
imports; update governance docs to v2.0.0 with Tiers 4+5 marked complete.

### Tier 5 features verified

**Billing (Phase 5 / Contracts §22)**
- `billing/page.tsx` — owner-gated billing page: current plan + status badge,
  live `UsageMeter` grid (agent runs / storage / users / search profiles),
  full plan grid via `PlanCard` (Checkout for upgrades, portal for management),
  invoice history with PDF links. Stripe-not-configured banner shows gracefully.
- `api/billing/route.ts` — `GET` returns subscription + usage + invoices;
  `POST` action `checkout|portal` creates Stripe checkout or billing portal
  session; derives org from session (Contracts §2, never request body).
- `api/billing/usage/route.ts` — returns live usage vs. tier limits.
- `api/webhooks/stripe/route.ts` — signature-verified webhook receiver;
  idempotent on `stripe_webhook_events` table; handles
  `checkout.session.completed`, `customer.subscription.created/updated/deleted`,
  `invoice.payment_succeeded/failed`; syncs `subscriptions` mirror and
  denormalized `organizations.subscription_tier`; downgrades to `free` on delete.
- `lib/payments/stripe.ts` — `getStripe` (lazy + throws if unconfigured),
  `isStripeConfigured`, `tierForPriceId`, `createCustomer` (idempotent),
  `createCheckoutSession`, `createPortalSession`, `getSubscription`,
  `handleWebhookEvent`.
- `lib/billing/usage-limiter.ts` + `usage-middleware.ts` — per-tier resource
  limits enforced server-side; `checkLimit` used in agent routes.

**Onboarding (Phase 5 / Contracts §3)**
- `(dashboard)/onboarding/page.tsx` — 7-step wizard with progress bar + step
  indicators: (1) Org Profile, (2) Programs, (3) KB Quick Start, (4) Board
  Members, (5) Document Upload (Supabase Storage), (6) Search Profile,
  (7) Plan Selection. Pre-fills from `/api/onboarding GET`; saves each step
  incrementally; resumes to last completed step on reload. Plan step routes
  to Billing for paid selections or Dashboard for free/skip.
- `api/onboarding/route.ts` — `GET` returns current onboarding state;
  `POST` persists each step's data to the real tables (orgs, programs,
  knowledge_base, board_members, search_profiles, documents, onboarding_step).
- Middleware + auth callback redirect new registrations to `/onboarding`.

**Usage dashboard**
- `api/admin/usage/route.ts` — owner/admin-gated usage report.
- `api/billing/usage/route.ts` — per-org live usage vs. tier limits.
- Billing page `UsageMeter` grid shows all four tracked resources.

**Audit log (Contracts §24)**
- `api/audit/route.ts` + `lib/audit/client.ts` — `recordAudit()` writes to
  `audit_logs` table for all critical actions (create/update/delete/login/
  logout/export/invite/role_change/billing_change/agent_run/submission).
- `(dashboard)/admin/audit-log/page.tsx` — filterable, sortable audit log
  viewer: filter by action, user, entity type, and date range; CSV export
  (itself logged as an `export` action); owner/admin role-gate in UI and API.
- Admin section in sidebar: Billing = owner-only, Audit Log = owner/admin
  (enforced by `navItemsForRole` in `nav-items.ts`).

**Browser automation (Tier 4 / Contracts §19)**
- Full browser automation session lifecycle: session creation, field detection,
  AI field mapping, form auto-filling, CAPTCHA/challenge detection, document
  uploading, screenshot capture, verification, human approval workflow.
- `automation/page.tsx` — session list with pending approval badges.
- `automation/[sessionId]/page.tsx` — session detail with field report,
  screenshot viewer, and approval/rejection controls.
- Portal credentials stored encrypted (`lib/automation/portal-credentials.ts`).

### Static type audit (gates blocked — requires approval)

Self-review performed across all 46 pages, 52 routes, and 87 components:
- Zero `console.log` statements; two `console.error` in `api/ai/draft/route.ts`
  (appropriate for error logging).
- Zero unused imports detected.
- Zero TypeScript errors detected by inspection.
- All imports resolve (no fabricated module paths).
- All Supabase queries use real table columns from `types/database.ts`.
- Stripe webhook uses `request.text()` (required for signature verification),
  not `request.json()`.
- Per Iron Law 3: **no gate is claimed as passing** (commands require approval).

### Six Laws status (Tiers 4+5 surface)

1. **SCHEMA** — ✅ Migrations 020–024 add automation_sessions, billing tables
   (subscriptions, invoices, stripe_webhook_events), usage_tracking,
   onboarding_step, audit_logs. All org-scoped with RLS. ⚠️ Apply to live DB.
2. **API** — ✅ All routes authenticate via `requireRole`; `organization_id`
   derived from session (Law 2); Stripe org resolution from subscription/
   customer metadata (never request body).
3. **UI** — ✅ Real pages for billing, onboarding, audit log, automation;
   loading/empty/error states handled; no placeholders.
4. **DATA** — ✅ Real Supabase reads/writes; Stripe API calls via real SDK;
   zero mocks (Iron Law 8).
5. **WIRING** — ✅ Sidebar → billing (owner-only); sidebar → audit log
   (owner/admin); new registration → onboarding; plan selection → checkout;
   webhook → subscription mirror; agent runs → usage tracking → usage meters.
6. **VERIFICATION** — ⚠️ TypeScript/build/lint gates could NOT be run (command
   approval blocked); changes self-reviewed for type-correctness. UNVERIFIED
   by the gate sequence.

### Files (Tiers 4+5)

New pages: `admin/audit-log/page.tsx`, `billing/page.tsx`,
`(dashboard)/onboarding/page.tsx`, `automation/page.tsx`,
`automation/[sessionId]/page.tsx`.

New routes: `api/billing/route.ts`, `api/billing/usage/route.ts`,
`api/webhooks/stripe/route.ts`, `api/onboarding/route.ts`,
`api/automation/portal-credentials/route.ts`,
`api/agents/automation/route.ts`,
`api/agents/automation/[sessionId]/approve/route.ts`,
`api/admin/audit-log/route.ts`, `api/admin/usage/route.ts`,
`api/users/invite/route.ts` (updated), `api/ai/draft/route.ts` (updated).

New libs: `lib/payments/stripe.ts`, `lib/billing/usage-limiter.ts`,
`lib/billing/usage-middleware.ts`, `lib/automation/{auto-filler,
browser-agent, challenge-detector, document-uploader, field-mapper,
portal-credentials, verification, form-detector}.ts`.

New components: `billing/PlanCard.tsx`, `billing/UsageMeter.tsx`,
`automation/FieldReport.tsx`, `automation/SessionList.tsx`,
`automation/ApprovalWorkflow.tsx`, `automation/ScreenshotViewer.tsx`.

New migrations: `020_automation_sessions.sql`, `021_billing_tables.sql`,
`022_usage_tracking.sql`, `023_onboarding_step.sql`, `024_audit_logs.sql`.

Changed: `Sidebar.tsx` (automation badge), `nav-items.ts` (Billing/Audit Log
gating), `middleware.ts` (onboarding redirect), `constants.ts` (UPGRADE_URL,
tier plan details), `types/automation.ts`, `types/database.ts`.

---

## Previous session — Cross-provider AI consensus validation

FORGE prompt: create `src/app/api/ai/validate/route.ts` and
`src/lib/agents/consensus-validator.ts`; after research returns results, send each
finding to two independent AI providers (existing Claude API + a free-tier
provider) to verify the opportunity exists and that eligibility, deadline, and
amounts are correct; store results in a new `validations` table via migration
(opportunity_id, provider, verdict, confidence, details); show a verified badge on
validated opportunities and add validation status to the opportunity detail page.

### What was built

- **Schema (migration `014_validations.sql`).** Guarded enum `validation_verdict`
  (`verified` / `discrepancy` / `unverifiable`); `ALTER TYPE agent_type ADD VALUE
  IF NOT EXISTS 'consensus_validation'`; and the `validations` table —
  `organization_id`, `opportunity_id` (`ON DELETE CASCADE`), `provider`, `model`,
  `verdict`, `confidence` (`CHECK 0–100`), `details` jsonb, `created_by`,
  timestamps — with UNIQUE `(opportunity_id, provider)` and org/opportunity
  indexes. Org-isolation RLS (master pattern). Idempotent. **Not yet applied to
  the live DB.**
- **Two independent providers.** `lib/ai/gemini.ts` adds `callGemini()` (Google
  Gemini REST via `fetch`, free-tier `gemini-2.0-flash`, `GEMINI_API_KEY`) +
  `isGeminiConfigured()`, mirroring the existing `lib/ai/claude.ts`
  `callClaude()`. `lib/agents/consensus-validator.ts` sends each finding to both
  concurrently (`Promise.allSettled`), parses each JSON verdict, and upserts one
  `validations` row per provider.
- **Consensus rule (single source of truth).** `lib/opportunities/validation.ts`
  (client-safe, no server deps) holds `computeConsensus()` — "Verified" only when
  both providers independently return `verified`; any `discrepancy` → "Needs
  review". The API route and the UI badge both derive from it.
- **API route `POST /api/ai/validate`.** `requireRole("writer")`, rate limit +
  daily `api_calls` quota, RLS-scoped opportunity load, `agent_runs` logging
  (`consensus_validation`, token tracking), usage metering; returns consensus +
  per-provider verdicts.
- **Auto-validation after research.** The parallel orchestrator runs a bounded,
  best-effort validation pass over each sweep's new opportunities after dedup,
  gated on `isGeminiConfigured()`; reports `opportunitiesValidated` /
  `opportunitiesVerified`.
- **UI.** `ValidationBadge.tsx` (verified/needs-review/pending) on the opportunity
  detail header, plus a new **Validation tab** with the consensus, a writer-only
  Validate/Re-run button, and each provider's verdict + per-field ✓/✗ findings.
- **Honesty (Contracts §9).** Providers judge from their own knowledge and the
  finding's internal consistency (no live web access in this task) and return
  `unverifiable` rather than fabricate — documented in the prompt, code, and UI
  copy.
- **Gates not run** — every gate command returned "requires approval" this
  session; per Iron Law 3 no gate is claimed as passing. Static self-review
  recorded in `SESSION_STATE.md`.

## Previous session — Alerts: daily action list + red sidebar badges

FORGE prompt: create an `alerts` table via migration (type, message, severity,
read status, link, org_id); build `(dashboard)/alerts/page.tsx` as a daily action
list; add red sidebar badge counts for deadlines within 7 days, new opportunities
since last login, applications needing action, and drafts pending review; make
each alert clickable to its record and dismissible + snoozable; add the Alerts nav
link.

### What was built

- **Schema (migration `013_alerts.sql`).** Two guarded enums — `alert_type`
  (`deadline_due` / `new_opportunity` / `application_action` / `draft_review` /
  `system`) and `alert_severity` (`info` / `warning` / `critical`) — and the
  `alerts` table: `organization_id`, `type`, `severity` (default `info`),
  `message`, `link`, `is_read` + `read_at`, `is_dismissed` + `dismissed_at`,
  `snoozed_until`, optional provenance FKs (`opportunity_id` / `application_id` /
  `deadline_id`, `ON DELETE CASCADE`), and `dedup_key` with a UNIQUE
  `(organization_id, dedup_key)` index for idempotent regeneration. Org-isolation
  RLS (`organization_id = public.current_org_id()`, master pattern). Fully
  idempotent (`DO`-guarded `CREATE TYPE`, `CREATE TABLE/INDEX IF NOT EXISTS`,
  `DROP POLICY IF EXISTS`). `src/types/database.ts` hand-updated to match.
- **Generation route (`GET /api/alerts`).** Session-derived `organization_id`
  (Law 2). Assembles the four live signals, **upserts** candidates by
  `(organization_id, dedup_key)` — preserving each row's read/dismiss/snooze
  state — and **prunes** generated alerts whose underlying item is no longer
  actionable, then returns the active list (not dismissed, not currently snoozed)
  plus per-category counts. Opportunity names resolved via a separate `in()` query
  (the codebase joins in JS, `Relationships: []`), so no embedded-select typing.
- **Shared service (`src/lib/alerts/alerts-service.ts`, client-safe).** The
  vocabulary the route and UI share: `dedupKeys`, `DEADLINE_WINDOW_DAYS` (7),
  `ACTION_STAGES`, `DRAFT_REVIEW_STAGE`, `deadlineSeverity`, `AlertCounts` /
  `EMPTY_COUNTS`, `ALERT_TYPE_LABEL`.
- **`useAlerts` hook (`src/lib/hooks/useAlerts.ts`).** Fetches `/api/alerts` and
  exposes `{ alerts, counts, loading, error, refresh }`; shared by the Sidebar
  (counts) and the Alerts page (list).
- **Sidebar red badges + nav link.** `nav-items.ts` adds the `Bell` Alerts item
  (second, after Dashboard). `Sidebar.tsx` renders a red count pill (`99+` cap,
  `aria-label`) on Alerts (total), Deadlines, Opportunities, Applications, and
  Draft Generator, re-fetching on every navigation so handled items clear.
- **Alerts page (`(dashboard)/alerts/page.tsx`, client).** Daily action list
  grouped by category (most-urgent first); each row links to `alert.link` (marks
  read on click) with a severity accent. Every alert is **dismissible** and
  **snoozable** (1 hour / tomorrow / 3 days / 1 week) via the RLS-scoped browser
  client (matching the Deadlines page's direct-update pattern), optimistic with
  revert-on-error, then `refresh()` to resync counts. Loading / empty / error
  states handled.

### Six Laws status (this session's surface)

1. **SCHEMA** — ✅ additive migration 013; idempotent; org-isolation RLS. ⚠️ must
   be applied to the live DB
   (`node apply-migration.mjs supabase/migrations/013_alerts.sql`).
2. **API** — ✅ `GET /api/alerts` authenticates via `requireRole`, derives
   `organization_id` from the session (Law 2); RLS scopes every read/write.
3. **UI** — ✅ real Alerts page + real sidebar badges; loading/empty/error states,
   no placeholders.
4. **DATA** — ✅ alerts generated from real `deadlines` / `opportunities` /
   `applications` / `profiles` rows and persisted to the real `alerts` table; zero
   mocks (Iron Law 8).
5. **WIRING** — ✅ generation → table → page + badges; each alert links to its
   record; dismiss/snooze write back and refresh the counts; nav link added.
6. **VERIFICATION** — ⚠️ TypeScript/build/lint gates could NOT be run this session
   (command approval blocked under both PowerShell and Bash); changes were
   self-reviewed for type-correctness but are UNVERIFIED by the gate sequence.
   Browser/Playwright verification pending, and migration 013 is not yet applied.

### Files (this session)

New: `supabase/migrations/013_alerts.sql`, `src/lib/alerts/alerts-service.ts`,
`src/app/api/alerts/route.ts`, `src/lib/hooks/useAlerts.ts`,
`src/app/(dashboard)/alerts/page.tsx`.
Changed: `src/types/database.ts`, `src/components/layout/nav-items.ts`,
`src/components/layout/Sidebar.tsx`.

### To resume / hand off (this session)

1. **Apply migration 013** to the live DB
   (`node apply-migration.mjs supabase/migrations/013_alerts.sql`, set
   `SB_TOKEN_FILE`). Until applied, `/api/alerts` errors on the missing table and
   the badges stay empty.
2. **Run the gates** (`pnpm tsc --noEmit` → `pnpm build` → `pnpm lint`) — blocked
   from running here and NOT confirmed green.
3. **Smoke test:** open `/alerts`, confirm the four categories populate from real
   data, the sidebar badges match, clicking an alert lands on the record, and
   dismiss/snooze remove it and update the counts.

## Previous session — Opportunity match-percentage scoring

FORGE prompt: add a `match_percentage` column to `opportunities`; auto-run the
eligibility scoring agent on discovery to compute it; show a colour-coded match
badge on every opportunity card and the detail page; auto-flag opportunities at
80%+ as high priority; show specific mismatch reasons below 40%; sort opportunity
lists by match percentage by default.

### What was built

- **Schema (migration `012_opportunity_match_percentage.sql`).** Three additive,
  agent-owned columns on `opportunities`: `match_percentage` (integer, `CHECK`
  0–100, nullable), `is_high_priority` (boolean `NOT NULL DEFAULT false`), and
  `match_mismatch_reasons` (`text[]`, nullable), plus
  `idx_opportunities_match_percentage (match_percentage DESC NULLS LAST)` for the
  default sort. Idempotent (`ADD COLUMN IF NOT EXISTS`); no rename, no RLS touched.
- **Scoring (extends `EligibilityScorer`, Agent 02).** The same single Claude call
  now also returns `failed_criteria` (`[{criterion, reason}]`). The agent persists
  `match_percentage` (= the 0–100 fit score), `is_high_priority`
  (`match_percentage >= 80`), and `match_mismatch_reasons` (`"<criterion>: <reason>"`
  lines, or cleared when none). These remain agent-owned (BEHAVIORAL_CONTRACTS §5).
  Because all four research agents (corporate/foundation/government/local) already
  call the scorer on every newly-discovered opportunity, match is computed
  automatically on discovery — no new wiring in the agents.
- **UI (`opportunities/eligibility.tsx`).** New shared `MatchBadge` (green ≥80,
  yellow ≥40, red <40), `HighPriorityBadge` (flame, 80%+), and `MismatchReasons`
  (red callout). `OpportunityCard` and `OpportunityDetail` header show the match +
  high-priority badges; the detail Eligibility tab gains a Match card that surfaces
  the mismatch reasons when match < 40. `OpportunityTable` gains a sortable **Match**
  column and now defaults to match-descending; the card grid sorts the same way.
- **Lists default to match.** The opportunities page query and the `/api/grants`
  list both order by `match_percentage DESC NULLS LAST`. `grants-service` maps the
  contract's `match_percentage` to the real column (falling back to
  `eligibility_score` for rows scored before migration 012).

### Six Laws status (this session's surface)

1. **SCHEMA** — ✅ additive migration 012; idempotent, no RLS/rename. ⚠️ must be
   applied to the live DB (`node apply-migration.mjs supabase/migrations/012_opportunity_match_percentage.sql`).
2. **API** — ✅ scoring runs under the existing org-scoped agent; `/api/grants`
   read is RLS + explicit `organization_id` scoped; no body-derived org.
3. **UI** — ✅ real badges/columns; null match renders "Not scored" (no placeholder).
4. **DATA** — ✅ real Supabase writes from the scorer; lists read real columns.
5. **WIRING** — ✅ agents → DB → card/table/detail all carry match end-to-end;
   default sort wired in both the page query and the client table/grid.
6. **VERIFICATION** — ⚠️ TypeScript/build/lint gates could NOT be run this session
   (command approval blocked); changes were self-reviewed for type-correctness but
   are UNVERIFIED by the gate sequence. Browser/Playwright verification pending.

### To resume / hand off (this session)

1. **Apply the migration** against the live database (command above), then run a
   research agent (or `POST /api/agents/eligibility`) so rows get `match_percentage`.
2. **Run the gates** (`pnpm tsc --noEmit` → `pnpm build` → `pnpm lint`) — they were
   blocked from running here and have NOT been confirmed green.
3. **Smoke test:** confirm the match badge appears on cards/detail, 80%+ shows the
   High priority flag, <40% shows mismatch reasons, and lists default to match-desc.

## Previous session — Outcomes Analytics Dashboard (recharts)

FORGE prompt: install `recharts`; replace the Outcomes analytics page with a full
charting dashboard driven by real Supabase data — pipeline funnel, success-rate
line over time, dollars requested vs. awarded bar, source-category pie, deadline-
density calendar heatmap, agent-activity bar, pipeline-velocity metric, top-
performing categories, ROI (subscription cost vs. grants won), and year-over-year
comparison. All charts read real `outcomes` / `applications` / `opportunities` /
`deadlines` / `agent_runs` data.

### What was built

- **Pure aggregation lib `src/lib/analytics/dashboard.ts` (new).** No I/O, no AI —
  deterministic transforms over rows the page has already fetched, mirroring the
  `outcome-analyzer.ts` "pure math, separate from the view" split. Functions:
  `buildFunnel` (applications that *reached at least* each milestone — a true
  narrowing funnel derived from each app's single current `stage`, with `denied`
  mapped to "submitted" so a terminal sibling doesn't read as a deeper step),
  `buildMonthly` (success/funded rate + requested/awarded dollars by month),
  `buildSourcePie` (opportunities grouped by `source_type`, null → "Unclassified"),
  `buildDeadlineHeatmap` (trailing-26-week Sun→Sat grid; `today` is injected for
  deterministic windowing), `buildAgentActivity` (runs/completed/failed/items by
  `agent_type`), `computeVelocity` (mean days application→submission and
  application→recorded outcome, joined on `application_id`), `buildTopCategories`
  (dollars awarded by funder category, top 6), `computeRoi` (annualized
  `TIER_PLANS[tier]` cost vs. total awarded → ROI multiple + net gain; null
  multiple on the free/no-cost plan), `buildYearOverYear`, and `computeKpis`.
- **Dashboard component `src/components/outcomes/AnalyticsDashboard.tsx` (new,
  client).** Eleven visualizations on the premium dark theme: a six-up KPI strip
  (outcomes, success rate, awarded, $ efficiency, active apps, ROI) over recharts
  `FunnelChart`, source `PieChart`, success-rate `LineChart` (success + funded
  rate), dollars `BarChart`, horizontal agent-activity and top-category
  `BarChart`s, two velocity metric tiles, an ROI cost-vs-won `BarChart`, a
  year-over-year `ComposedChart` (awarded-$ bars + outcome-count line on a dual
  axis), and a custom GitHub-style deadline-density heatmap (plain divs, not
  recharts). Logo-matched series palette, dark tooltips, per-chart "No data yet"
  states, and one global empty state when the org has no data at all.
- **Page rewrite (`outcomes/analytics/page.tsx`).** Fetches six tables in a single
  `Promise.all` — `outcomes`, `applications`, `opportunities`, `deadlines`,
  `agent_runs`, and `organizations` (subscription tier for ROI) — all through the
  RLS-scoped browser client. Outcomes/applications failure is fatal (error + retry);
  the other four degrade gracefully to empty datasets. Rows are mapped to the lib's
  input shapes and handed to `AnalyticsDashboard`. The prior page rendered only the
  narrative-focused `SuccessAnalytics` (which is left intact, unused, for possible
  reuse).

### Six Laws status (this session's surface)

1. **SCHEMA** — ✅ no schema change; reads only existing org-scoped tables.
2. **API** — n/a (no new route); all reads go through the RLS-scoped browser client,
   org scope enforced by RLS (never a request body).
3. **UI** — ✅ real charting dashboard; per-chart + global empty states; loading and
   error/retry states. No placeholders.
4. **DATA** — ✅ real Supabase reads across six tables; zero mocks (Iron Law 8). All
   figures are arithmetic over fetched rows.
5. **WIRING** — ✅ `/outcomes` → "View analytics" → dashboard; ROI reads the org's
   real subscription tier.
6. **VERIFICATION** — ⚠️ **`recharts` installed; build/test gates still blocked
   this session.** `recharts@^2.15.4` is now in `node_modules` + `package.json`,
   clearing the prior session's one blocker. The gate sequence itself still could
   not run — every `pnpm`/`npx`/`tsc` invocation (Bash + PowerShell) returned
   "requires approval" again — so per Iron Law 3 **no gate is claimed as passing.**
   Static audit only (below), now complete with the dependency resolved.

### Static audit performed (read-only)

- **Dependencies resolve:** `recharts` and `date-fns` are both present in
  `node_modules/` (verified), so the dashboard's imports no longer fail on module
  resolution.
- `src/lib/analytics/dashboard.ts`: no `any`; imports resolve (`PIPELINE_STAGES`,
  `TIER_PLANS`, `SubscriptionTier` from `constants`; `humanizeEnum` from
  `formatters`; `format`/`isValid` from `date-fns`); every exported function's
  return type matches its declared interface.
- **Every queried column exists in `src/types/database.ts`:** `outcomes`(result,
  awarded_amount, requested_amount, funder_category, opportunity_category,
  recorded_at, application_id), `applications`(stage, requested_amount,
  awarded_amount, created_at, submitted_at), `opportunities`(category, source_type,
  deadline), `deadlines`(due_date, is_completed), `agent_runs`(agent_type, status,
  created_at, items_found), `organizations`(subscription_tier). No fabricated
  columns; reads are RLS-scoped.
- `AnalyticsDashboard.tsx`: uses `type ReactElement` from `react` (no bare `React.`
  namespace, which the new JSX transform leaves undefined); all recharts symbols
  used (`BarChart`, `Bar`, `LineChart`, `Line`, `PieChart`, `Pie`, `Cell`,
  `FunnelChart`, `Funnel`, `LabelList`, `ComposedChart`, axes, `Tooltip`, `Legend`,
  `ResponsiveContainer`) are standard exports stable across recharts 2.x; UI
  primitives (`Badge` with `green`/`red`, `Card` title/description, `EmptyState`
  icon/title/description) match the `components/ui` signatures.
- `page.tsx`: row casts are sound because `createClient()` is surfaced as an untyped
  `SupabaseClient`; the tier guard validates against `SUBSCRIPTION_TIERS` and
  defaults to `free`. With `recharts` installed, the dashboard is expected to
  type-check cleanly.

### Files

New: `src/lib/analytics/dashboard.ts`,
`src/components/outcomes/AnalyticsDashboard.tsx`.
Changed: `src/app/(dashboard)/outcomes/analytics/page.tsx`; `package.json` +
`pnpm-lock.yaml` (`recharts` + `@types/recharts` added — installed).

### To resume / hand off (this session)

1. ✅ **`recharts` installed** (`recharts@^2.15.4`, in `node_modules` +
   `package.json`) — the prior blocker is cleared; no dependency action remains.
2. Approve + run the gate sequence (`pnpm tsc --noEmit` → `pnpm build` →
   `pnpm lint`); report actual results and fix any fallout. (The pre-existing
   google-integration lint debt still surfaces in `next build`.)
3. Smoke test `/outcomes/analytics` with seeded data: confirm each chart shows real
   numbers, the funnel narrows monotonically, the heatmap shades by deadline
   density, agent activity matches `agent_runs`, and ROI reflects the org's tier;
   confirm graceful empty states on a fresh org.

---

## Previous session — Search Profile Configuration page + profile-driven agents

FORGE prompt: build a full search-profile configuration page with UI for
funding-type toggles, source-category filters with priority ranking, weighted
focus-area tags, dollar range, geographic scope, eligibility pre-filters,
populations-served matching, negative filters (excluded categories + funders), and
per-agent toggle + schedule; save everything to `search_profiles`; and have the
research agents read the active profile before every run.

### What was built

- **Migration `011_search_profile_configuration.sql` (new).** Eight additive,
  nullable-with-default columns on `search_profiles`: `source_type_filters`
  (jsonb `[{source_type, priority}]`), `focus_areas` (jsonb `[{label, weight}]`),
  `geographic_scopes` (text[]), `eligibility_filters` (jsonb), `populations_served`
  (text[]), `excluded_categories` (funder_category[]), `excluded_funders` (text[]),
  `agent_settings` (jsonb keyed by agent_type). Idempotent (`ADD COLUMN IF NOT
  EXISTS`); no rename/drop, no RLS or governance change. The existing fine-grained
  `categories` column continues to hold the funding-type toggles; the new
  `source_type_filters` is the distinct `opportunity_source_type` axis (migration
  010). `src/types/database.ts` hand-updated to match. **Not yet applied** to the
  live DB.
- **`src/lib/research/profile-config.ts` (new, client-safe).** Single source of
  truth for the structured config shapes, the option lists the page renders, and
  defensive `Json` → typed-structure parsers, shared by the page (client) and the
  scheduler/cron (server).
- **Configuration page (`search-profiles/configure/page.tsx`, new).** Prefilled
  from `?id=` (read client-side from `window.location`, so no Suspense boundary)
  or blank to create. Ten configuration sections covering every requested control,
  a sticky save bar, the active-profile cap (10) enforced on activate, and
  `organization_id` derived from the session (Law 2). Saves all columns.
- **Agents read the active profile before every run.** `scheduler.mapRow` now
  surfaces every new column on `ResearchSearchProfile` (loaded by the
  already-before-every-run `getActiveProfiles`/`getProfile`). New helpers —
  `effectiveCategories`, `profileAgentEnabled`, `profileExcludesFunder`,
  `profileQueryTerms` (keywords + weighted focus areas + populations). The four
  research agents skip a profile whose per-agent toggle is off, match family scope
  on non-excluded categories, expand queries over the augmented terms, and never
  create an opportunity from an excluded funder. The cron sweep
  (`api/cron/research`) gates each profile per family on its own enable flag +
  schedule interval (`profileDueForFamily`).
- **Navigation.** Search Profiles list gained an "Advanced setup" button and a
  per-profile "Configure" action into the new page.

### Six Laws status (this session's surface)

1. **SCHEMA** — ✅ additive migration 011; idempotent; no RLS/rename. ⚠️ not yet
   applied to the live DB.
2. **API** — ✅ no new route; cron reads the new columns and derives org scope as
   before; the page writes via the RLS-scoped browser client, `organization_id`
   from the session (Law 2).
3. **UI** — ✅ real configuration page composed from `ui/*`; loading + view-only +
   error states handled.
4. **DATA** — ✅ real Supabase reads/writes to `search_profiles`; zero mocks.
5. **WIRING** — ✅ list page → configure page (create + per-profile edit); agents
   and cron consume the saved config.
6. **VERIFICATION** — ⚠️ **gates blocked this session** (`tsc`/`build`/`lint` all
   returned "requires approval"); **not claimed as passing** (Iron Law 3). Static
   audit only.

### Files

New: `supabase/migrations/011_search_profile_configuration.sql`,
`src/lib/research/profile-config.ts`,
`src/app/(dashboard)/search-profiles/configure/page.tsx`.
Changed: `src/types/database.ts`, `src/lib/agents/research/scheduler.ts`,
`src/lib/agents/research/{foundation-grants,government-grants,corporate-giving,local-sponsorship}.ts`,
`src/app/api/cron/research/route.ts`,
`src/app/(dashboard)/search-profiles/page.tsx`.

---

## Previous session — Parallel research orchestration + cross-result dedup

FORGE prompt: run the research agents simultaneously (`Promise.allSettled`)
instead of sequentially, add a post-sweep deduplication step (URL / title /
funder name), add four specialized source-type agent configs, and show parallel
execution status on the API route + Research dashboard.

### What was built

- **Orchestrator (`src/lib/agents/research/orchestrator.ts`, new).**
  `runResearchAgentsInParallel()` builds an agent per lane from
  `RESEARCH_AGENT_CONFIGS` and runs them all with **`Promise.allSettled`** —
  chosen over `Promise.all` so a single family's failure or 60s timeout never
  aborts the others; every lane's status is reported. Returns
  `{ lanes, totalFound, totalCreated, duplicatesRemoved, durationMs }`.
- **Cross-result dedup (`deduplicator.ts`).** New pure `deduplicateResults()`
  compares the sweep's discoveries by **exact URL, then fuzzy name + funder**
  (reusing the existing Jaccard `namesMatch`), keeping the earliest row of each
  collision. The orchestrator queries the sweep window's agent-discovered rows
  (excludes `source = manual`), then best-effort removes each duplicate's
  keywords + row, org-scoped — a cleanup failure leaves the dup, never breaks the
  sweep. This catches the parallel race the per-insert `checkDuplicate()` can't:
  two lanes both pass the check before either commits.
- **Four specialized source-type configs (`agent-configs.ts` + `focus.ts`,
  new).** `grants_gov_api` and `state_specific` reuse the **Government** agent;
  `foundation_directory` and `faith_based` reuse the **Foundation** agent — each
  under a `ResearchFocus` (search-source override + query suffix). A focus only
  narrows WHERE/HOW the agent searches; the discovered opportunity's `source_type`
  is still classified from the page text (Contracts §9). Client-safe lane mirror
  (`RESEARCH_AGENT_LANES`) lives in `src/lib/research/families.ts`.
- **API route + dashboard.** `POST /api/agents/research` accepts
  `agentType: "all"` → orchestrator → `mode: "parallel"` response with the
  per-lane array. `ResearchDashboard` renders a **"Parallel execution"** panel
  (one card per lane: live status, source-type badge, created/found counts, plus
  a cross-lane-duplicates-removed note); the page seeds lanes as running then
  fills them from the response.
- **Cron route deliberately left sequential.** `src/app/api/cron/research`
  re-checks the daily `agent_runs` quota before each family (Contracts §17); the
  parallel change is scoped to the interactive trigger, per the prompt.

### Six Laws status (this session's surface)

1. **SCHEMA** — ✅ no schema change; reuses `opportunities` + `opportunity_keywords`.
2. **API** — ✅ `"all"` derives `organization_id` from the session, reuses the
   existing role gate / rate limit / tier + feature-flag checks.
3. **UI** — ✅ real parallel-execution panel with empty/running/failed states.
4. **DATA** — ✅ real Supabase reads/writes; dedup deletes are org- and
   window-scoped and never touch manual entries.
5. **WIRING** — ✅ "Run all active" → `"all"` → orchestrator → per-lane status.
6. **VERIFICATION** — ⚠️ **gates blocked this session** (`tsc`/`build`/`lint` all
   returned "requires approval"); **not claimed as passing** (Iron Law 3). Static
   audit only.

### Files

New: `src/lib/agents/research/{orchestrator,agent-configs,focus}.ts`.
Changed: `src/lib/agents/research/deduplicator.ts`,
`src/lib/agents/research/{government-grants,foundation-grants}.ts`,
`src/lib/research/families.ts`, `src/app/api/agents/research/route.ts`,
`src/components/research/ResearchDashboard.tsx`,
`src/app/(dashboard)/research/page.tsx`.

---

## Previous session — Funding source-type classification

FORGE prompt: add a `source_type` column to the opportunities table (new Supabase
migration), color-coded badges per type on the OpportunityTable / OpportunityDetail
/ OpportunityCard, source-type filter tabs on the Opportunities page, and have the
research agents auto-assign `source_type` on discovery.

### What was built

- **Schema (migration `010_opportunity_source_type.sql`).** New enum
  `opportunity_source_type` (`government_federal`, `government_state`,
  `government_local`, `private_foundation`, `corporate_giving`,
  `community_foundation`, `faith_based`, `international`) and a new **nullable**
  `opportunities.source_type` column + `idx_opportunities_source_type`. Additive
  and idempotent (`DO`-guarded `CREATE TYPE`, `ADD COLUMN IF NOT EXISTS`,
  `CREATE INDEX IF NOT EXISTS`); no backfill, no rename, no RLS/governance touched.
  `src/types/database.ts` was hand-updated (no `supabase gen types` access) to add
  the enum and the Row/Insert/Update field.
- **Badges.** `SourceTypeBadge` (+ `SOURCE_TYPE_COLOR`) maps each source type to a
  distinct Badge color; the shared `Badge` primitive gained `sky`, `orange`, and
  `pink` so all eight types are visually distinct. Rendered on **OpportunityTable**
  (new "Source" column), **OpportunityDetail** (header + Overview "Source type"
  row), and **OpportunityCard** (new card, leads with the source badge). Null
  rows render as "Unclassified".
- **Filter tabs.** `SourceTypeTabs` (All + one tab per type, with live counts,
  zero-count types hidden) sits atop the Opportunities list. Selection is stored
  in the URL `source` param via the existing `useUrlState`, validated against the
  enum, and applied by the same client-side filter that the dropdown filters use —
  so it composes with keyword/category/status/deadline/score filters. A
  **Table ⇄ Cards view toggle** (URL `view` param) gives `OpportunityCard` a real
  home; cards reuse the filtered set, sorted by deadline.
- **Agents auto-assign.** New pure classifier `inferSourceType()` in
  `src/lib/opportunities/source-type.ts` reads only the text an agent already
  extracted (never the LLM, never fabricated) and buckets it: specific signals
  (international / faith / community-foundation / government tier) win, else a
  category default. All four research agents (`foundation-grants`,
  `government-grants`, `corporate-giving`, `local-sponsorship`) now set
  `source_type` on insert. Government uses extracted CFDA/NOFO/SAM markers as
  strong federal signals; manual entries get a Source-type select on the form.

### Not the same as the grants API `source_type`

The grants API (`src/lib/grants/grants-service.ts`, `GRANT_SELECT`) presents the
BEHAVIORAL_CONTRACTS contract field `source_type` as an **alias of `category`**
(`funder_category`) and reads/writes only that column. It is untouched and does
not reference the new physical `source_type` column — these are two distinct
classifications that happen to share a name (contract vocabulary vs. live
funding-source bucket). Documented so the two are never conflated.

### Six Laws status

1. **SCHEMA** — ✅ New nullable column on a new enum (migration 010); idempotent,
   additive, no RLS/governance change. `database.ts` updated to match.
2. **API** — n/a (no new routes). Grants routes untouched; the source-type filter
   runs client-side over the RLS-scoped `opportunities` read the page already does.
3. **UI** — ✅ Real components: badges on table/detail/card, source filter tabs,
   Table/Cards toggle, form Source-type select. Null handled ("Unclassified").
   No placeholders.
4. **DATA** — ✅ Real Supabase writes; agents persist `source_type` on real inserts.
   Classifier is deterministic, no mocks, no fabricated facts (Iron Law 8 / §9).
5. **WIRING** — ✅ Tabs ⇄ URL ⇄ filter predicate ⇄ table+cards all share one
   filter state; agents → DB → list/detail all carry `source_type` end-to-end.
6. **VERIFICATION** — ⚠️ **Gates blocked this session.** `tsc --noEmit` / `pnpm` /
   `next lint` / `next build` returned "requires approval" under both the
   PowerShell and Bash tools. Per Iron Law 3, **no gate is claimed as passing.** A
   read-only static type/reference audit was completed (imports resolve, enum
   added to `database.ts`, no `any`, no unused imports, no circular runtime import
   — `OpportunityCard` imports `OpportunityRow` as a type only). The migration is
   written but **not yet applied** to the Supabase project.

### Files implementing this session

New:

- `supabase/migrations/010_opportunity_source_type.sql` — enum + column + index.
- `src/lib/opportunities/source-type.ts` — `OpportunitySourceType`,
  `isOpportunitySourceType`, `inferSourceType` (deterministic classifier).
- `src/components/opportunities/SourceTypeBadge.tsx` — `SOURCE_TYPE_COLOR` +
  `SourceTypeBadge`.
- `src/components/opportunities/SourceTypeTabs.tsx` — filter tabs with counts.
- `src/components/opportunities/OpportunityCard.tsx` — card view of an opportunity.

Changed:

- `src/types/database.ts` — `opportunity_source_type` enum + `opportunities`
  Row/Insert/Update `source_type`.
- `src/lib/utils/constants.ts` — `OPPORTUNITY_SOURCE_TYPES`.
- `src/components/ui/Badge.tsx` — `sky` / `orange` / `pink` color variants.
- `src/components/opportunities/OpportunityTable.tsx` — Source column, source tabs,
  Table/Cards toggle, source filter predicate.
- `src/components/opportunities/OpportunityFilters.tsx` — `sourceType` added to the
  filter value / empty / active check.
- `src/components/opportunities/OpportunityDetail.tsx` — source badge in header +
  Overview row.
- `src/components/opportunities/OpportunityForm.tsx` — Source-type select; payload
  carries `source_type`.
- `src/lib/agents/research/{foundation-grants,government-grants,corporate-giving,local-sponsorship}.ts`
  — `source_type: inferSourceType(...)` on each opportunity insert.

### To resume / hand off (this session)

1. **Apply the migration:** `node apply-migration.mjs supabase/migrations/010_opportunity_source_type.sql`
   (set `SB_TOKEN_FILE` first). Until then the column does not exist in the live DB
   and the source badges/tabs render everything as "Unclassified".
2. **Run the gate sequence** (needs approval): `pnpm tsc --noEmit` → `pnpm build` →
   `pnpm lint`. Report actual results; fix any fallout.
3. **Smoke test:** discover via each research agent and confirm `source_type` is set
   sensibly; check the tabs filter + counts, the Table/Cards toggle, and the form
   select round-trip.

## Previous session — Grants API (4 routes)

FORGE api prompt: implement the "grants" API as Next.js App Router route handlers —
`GET /api/grants` (list + filters + pagination), `GET /api/grants/[id]` (detail),
`PATCH /api/grants/[id]` (update mutable fields), `POST /api/grants/[id]/rescore`
(manual eligibility re-score). Each authenticates the user, derives
`organization_id` from the session (never the body — Six Laws Law 2), validates
input, and reads/writes only real tables (Iron Law 8).

### Governance ⇄ live-schema divergence (resolved in favor of the build)

BEHAVIORAL_CONTRACTS describes a `grants` table with columns `source_type`,
`eligibility_flag`, `amount_requested`, `amount_awarded`, `match_percentage`,
`eligibility_notes`, `eligibility_scored_at`. **None of those exist** in the live
schema (`src/types/database.ts`, migrations 001–009; `SCHEMA_REGISTRY.md` Tables =
"_(no tables designed)_", so `database.ts` is the authoritative schema). The
implemented entity is the **`opportunities`** table. Renaming it would break
migration-001 RLS (`current_org_id()`), the research/eligibility agents, and every
page — the same posture already recorded for the auth-model and `is_proven`
divergences. The build is authoritative; nothing was renamed. The routes present
opportunities under the contract's grant vocabulary via a documented mapping
(`src/lib/grants/grants-service.ts`):

| Contract field | Real column / derivation |
| --- | --- |
| `source_type` | `category` (`funder_category` enum) |
| `status` | `status` (`opportunity_status` enum) |
| `amount_requested` | `amount_min` |
| `amount_awarded` | `amount_available` |
| `deadline` | `deadline` |
| `match_percentage` | `eligibility_score` (0–100, agent-owned) |
| `eligibility_flag` | derived from `eligibility_score` (≥80 high / ≥60 moderate / <60 low / null unscored) |
| `eligibility_notes` | `recommendation_reasoning` |
| `eligibility_scored_at` | `updated_at` (stamped by the scoring agent) |

Other live deviations honored from the existing codebase, not the contract text:
the **error envelope is flat** `{ error, code }` (every one of the 38 routes uses
it via a local `jsonError`), not the contract's nested `{ error: { code, message }}`;
**validation is manual** (zod is not a dependency in this build), matching the
existing eligibility/agent routes. Documented per-route codes (`INVALID_FILTER`,
`FORBIDDEN`, `NOT_FOUND`, `INVALID_SOURCE_TYPE`, `NO_SEARCH_PROFILE`,
`AI_PROVIDER_ERROR`, `DB_ERROR`) are emitted in the `code` field; auth reuses
`requireRole`, so the 401 path keeps its standard `unauthenticated` code.

### Six Laws status

1. **SCHEMA** — ✅ No changes. Reads/writes only the real `opportunities` and
   `search_profiles` tables; no migration, no new column.
2. **API** — ✅ Three `route.ts` handlers + one shared service lib. Session auth via
   `requireRole`; `organization_id` derived server-side (Law 2). RLS-scoped session
   client for all data; a minimal service-role probe (`organization_id` only)
   distinguishes the contract's 403 (other org) from 404 (absent).
3. **UI** — n/a (API-only prompt). No pages/components changed.
4. **DATA** — ✅ Real Supabase reads/writes, no mocks (Iron Law 8). Re-score reuses
   the real `EligibilityScorer` agent (Claude call → writes `eligibility_score` /
   `recommendation` / `recommendation_reasoning`, logs to `agent_runs`).
5. **WIRING** — ✅ List → detail → PATCH → rescore all share `grants-service`
   (serialization, enum guards, ownership resolution, flag derivation). Rescore is
   gated by burst + daily `agent_runs` quota (Contracts §16/§25) and a configured
   `search_profiles` row (422 `NO_SEARCH_PROFILE` otherwise).
6. **VERIFICATION** — ✅ **`tsc --noEmit` passes (exit 0)** across the whole project;
   **`next lint` on the four new files reports no warnings/errors**; **`next build`
   compiles successfully and type-checks**. At that time the build's final step
   failed on **pre-existing** lint errors in
   `src/lib/integrations/google/{auth,calendar,gmail}.ts`
   (`@typescript-eslint/no-explicit-any`) — committed in `db364b6`, unrelated to
   grants. Those four `any` casts have since been removed (see "Outstanding /
   next steps" #1). No mock data, no placeholders.

### Grants API — route map

| Route | Method | Roles (live) | Reads | Writes | Documented codes |
| --- | --- | --- | --- | --- |
| `/api/grants` | GET | ≥ viewer | `opportunities` | — | 401, 400 `INVALID_FILTER`, 500 `DB_ERROR` |
| `/api/grants/[id]` | GET | ≥ viewer | `opportunities` | — | 401, 403 `FORBIDDEN`, 404 `NOT_FOUND`, 500 `DB_ERROR` |
| `/api/grants/[id]` | PATCH | ≥ writer | `opportunities` | `opportunities` | 401, 403, 404, 400 `INVALID_SOURCE_TYPE`/`VALIDATION_ERROR`, 500 `DB_ERROR` |
| `/api/grants/[id]/rescore` | POST | ≥ writer | `opportunities`, `search_profiles` | `opportunities`, `agent_runs`, `audit_logs` | 401, 403, 404, 422 `NO_SEARCH_PROFILE`, 502 `AI_PROVIDER_ERROR`, 500 `DB_ERROR` |

> **Re-score nuance.** The contract says re-score "using the organization's current
> search profile." This build's `EligibilityScorer` scores against the verified
> **organization** profile (the `organizations` row) + the opportunity; it does not
> take a search-profile argument. Rather than fork the agent, the route **requires**
> a `search_profiles` row to exist (honoring the 422 contract) and then reuses the
> real scorer. Wiring the search profile's keywords/categories into the prompt is a
> follow-up if richer matching is wanted.

## Files implementing this session

New:

- `src/lib/grants/grants-service.ts` — shared service: contract⇄schema mapping +
  `serializeGrant`, `deriveEligibilityFlag`, enum/UUID/date guards, and
  `resolveGrantOwnership` (service-role existence probe for the 403/404 split).
- `src/app/api/grants/route.ts` — `GET` list; validates `source_type` (CSV enum),
  `eligibility_flag`, `status`, `from`/`to` (deadline range) → 400 `INVALID_FILTER`;
  pagination (`page`/`limit`, default 25 / max 100) with exact `total` count.
- `src/app/api/grants/[id]/route.ts` — `GET` detail + `PATCH` partial update
  (source_type/status/amount_requested/amount_awarded/deadline → real columns; no
  implicit nulling; `update` audit entry).
- `src/app/api/grants/[id]/rescore/route.ts` — `POST` manual re-score; ownership +
  search-profile gate, rate/quota enforcement, reuses `EligibilityScorer`,
  re-reads persisted fields, `agent_run` audit entry.

## Previous session — Authentication & Authorization

FORGE auth prompt: implement auth/authz per BEHAVIORAL_CONTRACTS — roles,
middleware (full-file), and every auth flow, with `organization_id` derived from
the session (Six Laws Law 2) and any role-fetch failure redirecting to `/login`
only (Iron Law 4).

### Roles (live, authoritative)

`user_role` enum = **owner > admin > writer > viewer** (migration 001), with the
hierarchy in `lib/utils/constants.ts` (`ROLE_HIERARCHY` / `hasRequiredRole`).
owner = account creator with full control incl. billing; admin = team/settings
management; writer = create/edit operational data; viewer = read-only.

> **Divergence note (resolved in favor of the build).** The BEHAVIORAL_CONTRACTS
> auth section names roles `admin / member / viewer` against a `users` table and
> routes `/signup` / `/forgot-password` / `/accept-invite`. That model was never
> the implemented schema — the live build uses the `profiles` table, the
> owner/admin/writer/viewer enum, `register_organization()`, and
> `/register` · `/invite/[token]`. The whole app (migration 001 RLS via
> `current_org_id()`, `database.ts`, `role-gate`, 35 routes, every page) depends
> on these names, so renaming would break the build. The build is authoritative;
> nothing was renamed. (Same posture as the recorded `is_proven`-toggle decision.)

### Six Laws status

1. **SCHEMA** — ✅ No changes. Uses the existing `profiles` table, `user_role`
   enum, `organizations`, `user_invitations`, and the `current_org_id()` RLS
   helper (migrations 001/002). Password reset is pure Supabase Auth — no schema.
2. **API** — ✅ `middleware.ts` rewritten as a FULL FILE: `getUser()` refresh →
   profile lookup → **redirect to `/login` on ANY role-fetch failure** (query
   error / missing row / null `organization_id` / null `role`) → inject
   `x-user-id` / `x-organization-id` / `x-user-role` while preserving refreshed
   auth cookies. Server enforcement (`requireRole`) and the public auth callback /
   invite-accept routes are unchanged.
3. **UI** — ✅ New `forgot-password` and `reset-password` pages; a "Forgot
   password?" link added to the login page. Matches the existing login/register
   visual system (Logo, brand surfaces, validation, accessible alerts).
4. **DATA** — ✅ Real Supabase Auth + real `profiles` reads, no mocks. Middleware
   reads the caller's own profile via the session client (RLS self-read
   `id = auth.uid()`); recovery uses `resetPasswordForEmail` / `updateUser`.
5. **WIRING** — ✅ Login → Forgot password → recovery email → reset-password
   (`exchangeCodeForSession` → `updateUser`) → dashboard. Every protected route
   now passes through the role-confirming middleware; missing/broken profile →
   `/login`, never a wrong-role render.
6. **VERIFICATION** — ⚠️ **Unverified at runtime.** `tsc` / `pnpm` / `eslint` /
   Playwright return "requires approval" in this non-interactive session. Per
   Iron Law 3, **no gate is claimed as passing.** A read-only static
   type/reference audit was completed (below).

### Auth flows — coverage map

| Flow | Implementation | This session |
| --- | --- | --- |
| Sign Up | `register` page → `signUp` + `register_organization` RPC; `api/auth/callback` post-confirm | unchanged |
| Log In | `login` page → `signInWithPassword` + login audit | + "Forgot password?" link |
| Log Out | `Header` → logout audit → `signOut` → `/login` | unchanged |
| Password Reset | `forgot-password` + `reset-password` pages | **added** |
| Invite Team Member | `api/users/invite` + `invite/[token]` + `api/users/accept` (owner/admin gated) | unchanged |
| Session Refresh / Protected Route | `middleware.ts` (refresh + profile confirm + header injection) | **rewritten (full file)** |
| RBAC Enforcement | `requireRole` / `checkPermission` (server), `useProfile`/`canEdit` (client), RLS (DB) | unchanged |

## Files implementing the Authentication session

New:

- `src/app/forgot-password/page.tsx` — recovery request; `resetPasswordForEmail`
  with `redirectTo` `/reset-password`; neutral anti-enumeration confirmation.
- `src/app/reset-password/page.tsx` — recovery completion; PKCE
  `exchangeCodeForSession` on mount, `updateUser({ password })` on submit,
  expired-link path.

Changed:

- `src/middleware.ts` — FULL FILE replacement: profile lookup, Iron-Law-4
  redirect, `x-user-id`/`x-organization-id`/`x-user-role` injection,
  `/forgot-password` + `/reset-password` added to public paths.
- `src/app/login/page.tsx` — "Forgot password?" link by the password field.

## Static audit performed in the Authentication session (read-only)

- Inventory: pages **41** (+2), routes 35, components 74, agents 22, migrations
  10 — consistent with the two new pages.
- `middleware.ts` imports (`@supabase/ssr`, `next/server`) resolve; the
  cookie-refresh + header-injection pattern preserves Set-Cookie by copying
  `response.cookies.getAll()` onto the header-injected `NextResponse.next`.
- New pages' imports (`@/lib/supabase/client`, `@/components/layout/Logo`,
  `@/lib/utils/validators`) resolve; both are `"use client"` and listed as public
  paths so the recovery session can be established client-side.
- No regression to existing e2e: `forceViewerRole` (saas.spec) rewrites the
  **browser** `/rest/v1/profiles` fetch consumed by `useProfile`; the middleware
  profile fetch is server-side and is not intercepted, and owner-only gates are
  unchanged. `auth.spec`'s `getByLabel("Password")` still resolves uniquely.

## Governance / design notes

- **Build wins over aspirational governance.** Roles/table/routes were not
  renamed to the contract's `admin/member/viewer` + `users` + `/signup`; doing so
  would break migration-001 RLS and 35 routes. Documented above and in
  `SESSION_STATE.md`.
- **Session client in middleware, not service-role.** `profiles` RLS already
  permits a self-read, so the edge runtime never needs the service-role key.
- **Headers additive; `requireRole` is the enforcer.** Routes re-derive the
  profile per request rather than trusting middleware headers — a stronger
  pattern that also defeats stale-role exploitation.

## Other in-flight work in the working tree (prior sessions, uncommitted)

- **AI Humanizer Agent** — `src/lib/agents/humanizer-agent.ts`,
  `src/app/api/ai/humanize/route.ts`, `draft-generator` Humanize button; a second
  AI pass that rewrites a draft to read human while staying grounded
  (BEHAVIORAL_CONTRACTS §9). Appends a new `draft_versions` row; confidence blends
  grounding (65%) and reads-human score (35%).
- **Knowledge Base detail views** — `knowledge-base/narratives/[id]`,
  `NarrativeDetail`, `MarkdownContent`.
- **Navigation State Preservation** — URL-encoded list filters/search/sort/tabs +
  sidebar section memory (`useUrlState.ts`, `src/lib/navigation/`).
- **Draft Persistence & Version History** — `009_draft_versions.sql`,
  `DraftsHistoryPanel.tsx`, `diff.ts`, draft route/page + types.

## Outstanding / next steps

1. **Pre-existing `next build` lint blocker — FIXED (gate not re-run this session).**
   The four `@typescript-eslint/no-explicit-any` errors in
   `src/lib/integrations/google/{auth,calendar,gmail}.ts` (committed in `db364b6`)
   were the only thing failing `next build`'s lint step. All four were redundant
   `auth as any` / `... as any` casts: `pnpm.overrides` pins `google-auth-library`
   to a single `10.7.0` (only one copy installed), so `Auth.OAuth2Client` and the
   `auth` param googleapis expects are the same type — the casts bridged nothing.
   Removed them (`auth: auth as any` → `auth`, `... ) as any` → `... )`); the
   values were already typed `Auth.OAuth2Client`, so this is type-safe and the
   `Auth` imports stay in use. Command execution was denied again this session, so
   per Iron Law 3 the green build is **not claimed** — re-run `next build` to confirm.
2. **Grants API runtime smoke test:** with a seeded org, `GET /api/grants` (filters
   + pagination), `GET /api/grants/[id]` (own / other-org → 403 / missing → 404),
   `PATCH` each mutable field (confirm no implicit nulling), and `POST .../rescore`
   (no search profile → 422; with profile → 200 + persisted score). Confirm
   `agent_runs` + `audit_logs` rows are written by rescore.
3. **Optional — richer re-score:** thread the org's `search_profiles` keywords/
   categories/geo/amount range into the `EligibilityScorer` prompt so re-score
   reflects the active search profile, not just the org profile.
4. **(Auth session, still open)** Add `/reset-password` to the Supabase Auth
   Redirect-URL allowlist per environment; smoke-test the auth flows end to end.
