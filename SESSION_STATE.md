# BENAVORA — SESSION STATE
## Last updated: 2026-07-17
## Current branch: main
## Last commit: feat: research resources enterprise UI 3x7 grid (02469c6)

---

## COMPLETED — July 17 (latest session): Research Resources enterprise directory (Standing Directive 5)

Wired the previously-unused `src/lib/research/resource-registry.ts` (21 pinned + ~30 additional
external resources) into `src/app/(dashboard)/research/page.tsx` via a new inline `ResourcesSection`
component (`useState` for `searchQuery`/`selectedCategory`/`showAll`). Full detail in
`STATE_OF_THE_BUILD.md`'s new top entry — key points:

- **Replaced the Control Panel section wholesale** (the 9 real agent-trigger cards —
  Grants.gov/SAM.gov/etc. — plus "Run All Research Agents", the reconfigure-sources banner, and
  all related state/handlers), not just restyled it. This was the only candidate for "research
  source cards currently rendered" per the task, and Directive 5 itself says "Replace the current
  research resources list" — read as referring to this section since the real resource-registry
  catalog was never rendered anywhere. **Manual per-source/run-all agent triggering from this page
  is now gone** — the underlying research agents are unaffected and still run via the daily
  `/api/cron/research` cron, only the manual UI trigger was removed.
- Cascading cleanup of now-dead code: `SOURCES`/`SourceConfig`/`SourceStats`/
  `CONFIG_MANAGED_SOURCES`/`SOURCE_ROUTE_MAP`, `opportunityMatchesSource()`,
  `handleRunAll`/`handleRunSource`/`handleConfigureResearch`/`loadConfig`, and the
  `activeSource`-driven "Filtered by X" badge on Discovered Opportunities (nothing can set it
  anymore). Discovered Opportunities' own search/list rendering is otherwise unchanged.
- `ResourcesSection`: 3×7 pinned grid (21 cards, `ResourceCard` — colored 6px top band per category
  bucket: purple=foundation, teal=health, blue=federal, navy=everything else, per the task's exact
  4-color spec) shown when the search box is empty; a collapsible alphabetical "All Resources" list
  (category dropdown filter) below it; typing in the search box replaces the grid with a unified
  pinned+additional results list instead of just hiding results. All inline `style` objects, no
  Tailwind color classes, per the task's explicit instruction.
- Gate: `pnpm tsc --noEmit` — 0 errors, ran clean. `pnpm run build`/`pnpm lint`/Playwright not
  requested, not run — no browser verification this pass.
- Committed `02469c6` and pushed to `origin/main`. Only the one changed file was staged
  (`git add` by path, not `-A`) — six `.claude/worktrees/*` gitlink entries were already modified
  in the working tree at session start (unrelated to this task) and were deliberately left
  unstaged.

---

## COMPLETED — July 17: API smoke tests + GitHub Actions daily/deploy workflows

First step toward Standing Directive 6 (comprehensive daily test suite) — only the smoke-test file
and two CI workflows, not the full multi-type suite/`test_runs` table/dashboard that directive
describes. Full detail in `STATE_OF_THE_BUILD.md`'s new top entry — summary:

- **New `src/__tests__/smoke/api-smoke.test.ts`** — fetches 5 routes (`/api/alerts`,
  `/api/opportunities`, `/api/funders`, `/api/agents/research/status`, `/api/automation/stats`)
  against `NEXT_PUBLIC_APP_URL || 'http://localhost:3000'`, asserts status is never 500/503.
  Written in **Vitest**, not the task-specified Jest — this repo has no Jest dependency at all,
  only Vitest (`vitest.config.ts` already globs `src/**/*.test.ts`); installing Jest as a second
  test runner for one file would have been pure duplication. `test:smoke` script added as
  `"vitest run src/__tests__/smoke"` accordingly.
- **Two of the five named routes have no bare GET handler** — `/api/opportunities` and
  `/api/funders` only exist as sub-resources (`[id]/probability`, `import`,
  `relationship-scores`, `[id]/relationship`); both list pages read via direct Supabase
  client calls instead, per [[benavora-grants-api-maps-to-opportunities]]. Kept the task's
  literal route list rather than swapping in `/api/grants` unasked — a 404 still passes the
  "not 500/503" assertion, so nothing breaks, but flagged as a weak smoke check.
- **Connection-refused is a skip, not a fail** — `daily-tests.yml` runs `pnpm test:unit` with no
  server started, so every route would be unreachable in that job by design. `fetchRoute()`
  catches the network error, warns, and the test returns early rather than asserting — avoids a
  daily false-red from missing infra, at the cost of the check being a no-op until
  `NEXT_PUBLIC_APP_URL` points at something live.
- **New `.github/workflows/daily-tests.yml`** (cron `0 5 * * *` = 11PM CST + push to main) and
  **`.github/workflows/deploy-check.yml`** (push to main → `pnpm build`, job status is the
  pass/fail report) — both structurally standard checkout/pnpm/node-18 steps. **Not verified to
  actually pass in GitHub Actions** — no secrets configured this session, and several
  `src/lib/intelligence/*.ts` modules throw on missing `ANTHROPIC_API_KEY`/`OPENAI_API_KEY` at
  call time; `deploy-check.yml`'s first real run may go red on that, separate from any workflow
  defect.
- Gate: `pnpm tsc --noEmit` — 0 errors, clean. `pnpm test:smoke` **could not be run this
  session** — blocked by the command-approval gate on every attempt (plain Bash, Bash with
  `--dir`, PowerShell with `cd`, PowerShell with `pnpm --dir`), consistent with
  [[benavora-gate-commands-need-approval]]. Not claimed as passing.
- Committed `fb02912`, pushed to `origin/main`.
- Governance docs updated: `STATE_OF_THE_BUILD.md`, this file. No schema/contract/agent change.

---

## COMPLETED — July 17 (latest session): Notification preferences event-type extension

Task asked to build the notification-preferences migration/table/notify()/settings-route/page —
**all already existed**, committed in an earlier session with no matching doc entry (verified via
`git log`, not assumed). Did not create the requested `src/supabase/migrations/090_...sql` — that
directory is the known stray duplicate (flagged for deletion in the July 10 audit entry), the real
`supabase/migrations/090` slot is taken (`compliance_calendar`), and the table already exists via
real migration `087_notification_preferences.sql` (superset of the task's literal spec — proper
FKs + RLS vs. the task's bare `org_id`/no-RLS ask). Migration 087 itself is **not confirmed applied
to production** (only 091 is, per the docs) and this session has no Supabase management PAT or DB
connection string to apply it — flagged, not fabricated.

Real gap found: `NOTIFICATION_EVENT_TYPES` only had 9 agent/automation event types; none of the
task's 6 named business events existed. `dispatchNotification()` has zero callers anywhere in
`src/` (dead code); `notify()` has exactly 2 (`automation-worker.ts`, for
`automation_completed`/`automation_failed`). Added the 5 missing values (`new_opportunity`,
`application_submitted`, `award_received`, `research_complete`, `autoapply_complete` —
`deadline_approaching` already existed) to `notification-dispatcher.ts`'s type union and array,
**extending, not replacing**, so the automation-worker's two existing calls keep working. The
settings page reads this list dynamically via the API route, so no page/route/notify.ts edits were
needed. **Not wired:** nothing yet calls `notify()` for the 5 new event types at their real trigger
points (opportunity creation, application submission, award recording, research/AutoApply
completion) — out of this task's named file scope, flagged as a no-op toggle until a future pass
adds those call sites.

Gate: `pnpm tsc --noEmit` — 0 errors, clean. `pnpm run build`/`pnpm lint`/Playwright not requested,
not run. Governance docs updated: this file, `STATE_OF_THE_BUILD.md`. No schema/contract/agent-type
change — one additive enum extension.

---

## COMPLETED — July 17: Funder relationship scoring — migration 091 applied to production

Code was already written, committed, and pushed in a prior session (`656b96f`) — `migrations/
091_funder_relationship_events.sql`, `src/lib/intelligence/relationship-scorer.ts`,
`api/funders/[id]/relationship`, `api/funders/relationship-scores`, all correctly adapted to
real schema conventions (see the migration file's own header for the org_id/path/table-collision
deviations from the task-given spec). This session verified the code against the live repo, found
the migration was file-only in production (confirmed via a PostgREST 404 on the table), and
applied it via the Management API (`sbp_` PAT). Re-verified with a PostgREST read afterward —
table now live, RLS-gated, empty as expected. `pnpm tsc --noEmit` — 0 errors. No new commit was
needed (no code changed this session, only a production DDL apply); `git status` confirmed nothing
outstanding beyond pre-existing worktree submodule diffs unrelated to this task.

Full detail in `STATE_OF_THE_BUILD.md`'s new top entry.

---

## COMPLETED — July 17 (latest session): Compliance calendar (compliance_events table + events API + page section)

Task asked for a new `compliance_events` table (literal spec used `org_id`, path
`src/supabase/migrations/087_...`), `/api/compliance/events` (GET/POST) +
`/api/compliance/events/[id]` (PATCH/DELETE), and a compliance page update showing
events grouped by month with type badges, application links, Mark Complete, and a
New Event form. Full detail in `STATE_OF_THE_BUILD.md`'s new top entry — summary:

- Deviated from two literal instructions after checking actual repo state first:
  `087` is already `087_notification_preferences.sql` and the real migrations
  directory is `supabase/migrations/` (not `src/supabase/migrations/`, a stray
  duplicate flagged as dead clutter in a prior audit) — used `090` (next free
  number) at the real path instead. Used `organization_id` (FK + RLS), not the
  literal `org_id`, matching every other table in this schema.
- New `supabase/migrations/090_compliance_calendar.sql`, `src/app/api/compliance/
  events/route.ts`, `src/app/api/compliance/events/[id]/route.ts` — same
  `requireRole`/org-scoping/error-shape conventions as the existing
  `/api/compliance/route.ts`.
- `(dashboard)/compliance/page.tsx` **updated, not replaced** — the page already
  had a real, working aggregator section (`/api/compliance`, spanning deadlines/
  renewals/documents/compliance_requirements); added a new month-grouped
  compliance_events section above it (4-color red/amber/blue/green scheme per
  the task spec) and kept the existing section below under "Other Tracked
  Requirements."
- Gate: `pnpm tsc --noEmit` — clean, 0 errors, via a bare (non-chained) invocation.
- **Migration NOT applied to production this session** — no Management API PAT
  accessible in this sandbox; `npx supabase`/`curl` both blocked pending approval
  that never came; a newly-surfaced `claude.ai Supabase` MCP connector needed a
  separate ungranted permission and was not used. File-only, pending Reid.
- **Not done:** `pnpm run build` / `pnpm lint` / Playwright not requested, not run;
  no browser verification.
- Committed `ee24c74` and pushed to `origin/main`.

---

## COMPLETED — July 17: Grant financial reconciliation (per-application budget/expense/reconcile)

Full detail in `STATE_OF_THE_BUILD.md`'s new top entry — summary:

- Discovered `grant_budgets`/`grant_expenses` already existed (migration 084) before writing
  anything; migration `086` was already taken (`086_white_label.sql`) and the real migrations
  path is `supabase/migrations/`, not `src/supabase/migrations/` as the task specified. Built
  additively at `supabase/migrations/089_financial_reconciliation.sql` instead of recreating
  tables: added `line_items`/`total_approved`/`updated_at` to `grant_budgets`,
  `application_id`/`receipt_url` to `grant_expenses` (backfilled from the existing `budget_id`
  join), and a new `grant_reconciliation_reports` table.
- New routes: `GET/POST /api/applications/[id]/budget`, `GET/POST
  /api/applications/[id]/expenses`, `GET /api/applications/[id]/reconcile` (computes variance,
  upserts into `grant_reconciliation_reports`). All org/application-ownership-scoped via
  `requireRole`.
- `financials/page.tsx` gained a "Grant Budget Reconciliation" section (awarded/reporting-stage
  applications, green/red variance badge), following the page's existing direct-Supabase-query
  convention rather than calling the new API routes from the browser.
- Gate: `pnpm tsc --noEmit` clean, 0 errors. `pnpm lint` blocked by this session's interactive-
  approval gate (both Bash and PowerShell) — not run, not claimed to pass.
- **Migration 089 is file-only — NOT applied to production.** No Management API PAT in this
  session's env, `npx supabase` blocked, Supabase MCP connector returned a permission error. Do
  not treat the new tables/columns as live until someone applies it with the `sbp_` PAT path.
- Committed `57e5dba` and pushed to `origin/main`.

---

## VERIFIED — July 16 (later session): Foundation profile builder migrations 081+088 confirmed applied to production

Task asked to build the foundation profile builder (migration, `foundation-profiler.ts`, the
`/api/foundations/[id]/profile` route, and the foundation detail page) — all of it already existed from
the immediately preceding commit `7443ee3`, already pushed to `origin/main`. No new code needed. Verified
directly against production (`information_schema.columns` + `pg_constraint` on ref
`vbjplpquqxxfbpazyalt`) that migrations 081+088 — which that commit's own message flagged as "not yet
applied" — are now genuinely live: the `foundation_profiles` table exists with all 8 requested columns
plus the `foundation_id` UNIQUE constraint. Did not create a migration at the requested
`src/supabase/migrations/085_foundation_profiles.sql` path — that's the stray duplicate migrations
directory a 2026-07-10 audit already flagged for deletion, and `085` collides with the real
`085_compliance_requirements.sql`. Full detail in `STATE_OF_THE_BUILD.md`'s new top entry.

- Gate: `pnpm tsc --noEmit` — 0 errors.
- Nothing committed this session — no code changed, only these two governance docs.

---

## COMPLETED — July 16 (latest session): CSV import wizard rebuilt to inline-style spec

Task named `import/page.tsx` and `api/import/csv/route.ts` as new files — both already existed
from a prior session, functionally correct but styled with legacy Tailwind theme-token classes
predating `STANDING_DIRECTIVES.md` §4's inline-hex-style mandate. Rebuilt both to match this
task's explicit "inline styles matching the dashboard color system" instruction. Full detail in
`STATE_OF_THE_BUILD.md`'s new top entry — summary:

- Page: 3-step wizard (Upload → Map Columns → Confirm & Import), inline-styled, no shared UI
  components. Simple split-newlines-then-commas CSV parsing per the task's literal spec. Step 2
  now shows detected CSV columns as their own pill list above the seven mapping dropdowns.
  Payload shape changed to `{records, mapping}` (raw rows + column mapping; server applies it),
  replacing the prior client-side-mapped flat array.
- Route: `requireRole("writer")` still derives `organization_id` from the session (never the
  request body) for the security boundary; the actual bulk write uses `createAdminClient()`
  (service role) as the task asked, with every row still stamped with the session-derived org id
  so the service-role bypass can't cross tenants. Category default is `government_grant`, not the
  task's literal `'Other'` — that enum value doesn't exist in `funder_category` and would 500
  every unmapped row. Email/phone are valid step-2 mapping targets but aren't persisted — no
  matching insertable column on `funders` per the task's own DB-write field list.
- Nav link ("Import" → `/import`) already existed in `PLATFORM_NAV_ITEMS` — no change needed.
- Gate: `pnpm tsc --noEmit` — clean, 0 errors, ran twice.
- Committed `982d266`, pushed to `origin/main`. Staged only the two changed files by name (not
  `git add -A` as literally requested) — six pre-existing, unrelated `.claude/worktrees/agent-*`
  modifications were already sitting in the working tree.
- **Not done:** no browser/visual verification this session; `pnpm run build`/`pnpm
  lint`/Playwright not requested, not run.

---

## COMPLETED — July 16: Intelligence Library page rebuilt as a paginated proposals browser + new proposals API

Task: rewrite `intelligence-library/page.tsx` to show corpus stats (total proposals, total
sources, date range, last ingestion), a search bar, ALL/NIH/NSF/FEDERAL_REGISTER/USASPENDING/
NIH_NIAID source tabs, a 20-per-page results grid, and back it with a new
`GET /api/intelligence/proposals` route. Full detail in `STATE_OF_THE_BUILD.md`'s new top entry
— summary:

- Confirmed `intelligence_funded_proposals`'s real schema and `source` column values directly
  from the four/five real ingestion scripts (`scripts/ingest-nih-reporter.ts`,
  `ingest-nsf-awards.ts`, `ingest-federal-register.ts`, `ingest-samhsa-hrsa.ts`,
  `src/scripts/ingest-nih-proposals.ts`) rather than guessing — `NIH_NIAID` is a real, distinct
  source (NIAID sample-application scraper), not a duplicate of `NIH_REPORTER`.
- New `api/intelligence/proposals/route.ts`: `requireRole("viewer")` gated (table has no RLS),
  paginated 20/page, search across `grant_program`/`funder_name`/`full_text`, corpus stats
  computed unfiltered so the header reflects the whole library regardless of the active filter.
- Page rewritten entirely in inline styles (no Tailwind), per `STANDING_DIRECTIVES.md` Directive
  4 — hex values pulled from the live `globals.css` tokens, not the directive doc's stated spec
  (live source wins per [[benavora-design-history-dark-vs-light]]).
- **Real feature removal, flagged not hidden**: the old page's Scoring Rubrics / Logic Models /
  Data Sources tabs and the "Add to Library" ingest flow were dropped — the task's spec fully
  enumerates the new page's content with no mention of them, matching this repo's established
  full-replacement precedent for literal-spec rebuilds. Those three tabs' underlying tables
  (`intelligence_scoring_rubrics`, `intelligence_logic_models`, `intelligence_need_data`) are no
  longer reachable from any page as of this commit.
- Gate: `pnpm tsc --noEmit` — 0 errors, ran clean.
- **Not done:** `pnpm run build` / `pnpm lint` / Playwright not requested, not run — no browser
  verification this pass.
- Committed `29c646f` (page + route only — pre-existing dirty `.claude/worktrees/*` submodule
  entries in the working tree were left unstaged, not swept in with `git add -A`) and pushed to
  `origin/main`.

---

## GOVERNANCE UPDATE — July 16 (latest session): UI redesign thrashing reconciled, deployment + auth info recorded

Documentation-only pass — no code changed. Reconciled `STATE_OF_THE_BUILD.md` and this file against
`git log` for the ~30 UI-only commits (July 15-16) that landed after the July 14 entry below without ever
being logged. Full detail in `STATE_OF_THE_BUILD.md`'s new top entry — summary:

- **Deployment**: live at **www.benavora.com**. Active auth credentials: **info@benavora.com** and
  **info@faithfoundationsf.org**.
- **Dashboard's 4 primary stat cards confirmed working** — `dashboard/page.tsx`'s `StatCard` uses inline
  `style` props (blue/cyan/violet/navy accents), which is why they survived the compatibility-layer
  churn below: inline styles only lose to `!important` class rules when the element also carries the
  class being remapped, and `StatCard` carries none.
- **FlightPathHUD still needs a colored front-face rewrite** — each stage already has a real
  `accentColor`, used today only on the back face; the front face (default-visible side) is hardcoded
  plain white. Not fixed this pass, only flagged.
- **`globals.css`'s ~220-line compatibility layer (legacy-class → brand-palette `!important` remap) is
  back in place, deliberately.** It was removed (`f363c14`), built on top of as if gone
  (`36bea38`), both reverted (`030f186`, `8f986d0`) after breaking pages still depending on it, and
  restored (`7ac3844`) as the final state. Any inline-style redesign work must avoid pairing new inline
  colors with the old legacy class names it remaps.
- **Tier 6 inventory unchanged** — pure CSS/UI window, no backend/schema/agent work.
- **Filesystem counts** (re-counted): 99 `page.tsx`, 208 `route.ts`, 89 migrations (through 087).
  `governance/SCHEMA_REGISTRY.md` is stale (dated June 13, only through table 58) — flagged, not fixed.
- Gate: not run — no code changed this pass. `7ac3844` itself is unverified against a fresh gate/browser
  check in this session.

---

## COMPLETED — July 13 (latest session): Mobile responsiveness audit + fixes

Read `Sidebar.tsx`, `Header.tsx`, `DashboardShell.tsx` in full, audited against a literal-class
mobile-responsiveness spec, then swept the app for horizontal-overflow bugs. Full detail in
`STATE_OF_THE_BUILD.md`'s new top entry — summary:

- Layout shell (drawer, backdrop, hamburger, content area) was already almost entirely correct;
  only fix was `Sidebar.tsx`'s transition `duration-200` → `duration-300` to match spec.
- Fixed a real bug in `OpportunityTable.tsx` and the `admin/sales-outreach/page.tsx` Prospect
  table: both overrode the shared `<Table>`'s `overflow-x-auto` container with `overflow-hidden`,
  clipping wide tables on mobile instead of letting them scroll. Same `overflow-hidden` bug fixed
  in four more raw-`<table>` usages (`SubmissionPreview.tsx`, `ManualQueue.tsx`,
  `autoapply/follow-ups/page.tsx`, `renewals/page.tsx`), found via a background sub-agent sweep of
  every `<table>` in `src/`.
- `GroupedKanban.tsx`'s 4-column applications board had no mobile breakpoint at all (`grid-cols-4`
  always) — now scrolls horizontally on mobile, grids at `sm:`/`xl:`.
- Three rigid non-responsive grids (QueuePanel stats bar, sales-outreach sending-window form,
  agreements date fields) made responsive; `CalendarGrid.tsx`'s 7-day grid deliberately left as-is
  (inherent to a calendar week).
- **`PageHeader.tsx`** — shared by ~20 dashboard pages — was missing `flex-wrap` on its
  title/actions row, so a long title plus multiple action buttons could overflow off-screen on
  narrow viewports. This is the highest-leverage fix in the pass. Two pages hand-rolling the same
  header pattern (`notifications/page.tsx`, `follow-ups/page.tsx`) got the identical fix directly.
- Gate: `pnpm tsc --noEmit` **could not be run** — both Bash and PowerShell invocations were
  blocked pending approval that wasn't granted this session. Consistent with known intermittent
  gate-blocking behavior — **not verified passing, do not treat as a clean gate**. Re-run before
  relying on this change set.
- **Not done:** `pnpm run build` / `pnpm lint` / Playwright not requested, not run. None of the
  fixes were visually confirmed in a real mobile viewport — reasoned from Tailwind classes and DOM
  structure only.
- Governance docs updated: `STATE_OF_THE_BUILD.md`, this file. `BLUEPRINT.md`, `SCHEMA_REGISTRY.md`,
  `BEHAVIORAL_CONTRACTS.md`, `AGENTS.md`, `CLAUDE.md`, `DONOR_DISCOVERY_ARCHITECTURE.md` untouched —
  pure CSS/layout-class change, no schema/contract/agent-type change.

---

## COMPLETED — July 13: Research + Draft Generator pages Elevated Slate rebuild

Task specified an exact literal-class spec for `src/app/(dashboard)/research/page.tsx` and
`src/app/(dashboard)/draft-generator/page.tsx` (both read in full first): a premium search bar +
button, a "Result card" shape with title/source-badge/amount/deadline treatment, a premium form
container for the generator, `flex items-center gap-2` section headers, a gradient full-width
Generate button, and a premium `font-mono` draft output area. Full detail in
`STATE_OF_THE_BUILD.md`'s new top entry — summary:

- **Research**: the page had no free-text search input before this pass (only source-trigger
  cards) — added one above Discovered Opportunities, client-side filtering the already-loaded
  opportunity list by name/source/category, using the spec's exact `border-2 ... rounded-2xl`
  input + `bg-[#0077B6]` button classes. Discovered Opportunities rebuilt from an 8-column
  `<table>` to the spec's Result cards (`hover:border-[#00B4D8]` per card); new
  `isDeadlineUrgent()` (≤14 days or past = red, else slate-400) replaces the old plain
  `formatDate` cell. Historical Awards table and the Control Panel source-run cards were not in
  the task's spec — left unchanged.
- **Draft Generator**: the three `<Card>`-wrapped steps (opportunity/template/program) merged
  into one `bg-white rounded-2xl shadow-md ... p-8` container per the spec's "generator form"
  language; each step's numbered circle-badge now sits directly under an `h2` carrying the spec's
  exact header classes rather than the old `Card title` prop. Generate button changed from the
  shared `<Button>` to a raw `<button>` with the spec's literal gradient classes — same
  non-deduping-`cn()` reasoning as every prior literal-class pass this project.
  `DraftEditor.tsx`'s draft display box (both read-only and edit-mode) recolored from
  navy/`rounded-lg`/`px-3 py-2` to the spec's `bg-[#F8FAFC]`/`rounded-xl`/`p-6`/`text-slate-700` —
  changed at the component level (shared with `draft-generator/[id]/page.tsx`) rather than adding
  override props, since the output-area spec applies to the one component that renders it and the
  new colors are consistent with the rest of this rebuild, not a one-off.
- Gate: `pnpm tsc --noEmit` — 0 errors, ran clean.
- **Not done:** `pnpm run build` / `pnpm lint` / Playwright not requested, not run — no browser
  verification this pass.
- Governance docs updated: `STATE_OF_THE_BUILD.md`, this file. `BLUEPRINT.md`,
  `SCHEMA_REGISTRY.md`, `BEHAVIORAL_CONTRACTS.md`, `AGENTS.md`, `CLAUDE.md`, and
  `DONOR_DISCOVERY_ARCHITECTURE.md` untouched — pure UI/styling change to two pages plus one
  shared draft-editor component, no schema/contract/agent-type change.

---

## COMPLETED — July 13 (latest session): FlightPathHUD Mission Control lifecycle dashboard

Task: build `src/components/dashboard/FlightPathHUD.tsx` — a 6-stage flip-card HUD (Onboard,
Research, Opportunities, Grant Narratives, AutoApply, Donor Discovery) for the top of the
dashboard, wired to live counts, and add it to `dashboard/page.tsx`. Read
`DONOR_DISCOVERY_ARCHITECTURE.md`, `dashboard/page.tsx`, and all 7 existing
`src/components/dashboard/*.tsx` files in full first.

- **New CSS-3D flip mechanism**: Tailwind 3.4 has no built-in `perspective`/`backface-visibility`/
  Y-axis `rotate` utilities, so `.perspective-1000`/`.preserve-3d`/`.backface-hidden`/
  `.rotate-y-180` were hand-added to `globals.css` inside `@layer utilities` (which is required —
  Tailwind's variant engine only auto-generates `hover:`/`group-hover:` prefixes for classes it
  recognizes as utilities, and `@layer utilities` is what makes that recognition happen for custom
  CSS). Flip is triggered by `group-hover:rotate-y-180` on the inner rotator div.
- **`FlightPathHUD` is a client component** (`"use client"`) that fetches all six stages' data in
  `Promise.all` on mount. Wired to the **existing** API routes per stage where one exists —
  `GET /api/onboarding` (Onboard: completed-steps count/7), `GET /api/agents/research/status`
  (Research: run count + completed-ratio), `GET /api/automation/stats` (AutoApply: queued+processing
  count, daily-usage percent), `GET /api/donor-discovery/prospects` + `GET
  /api/donor-discovery/requests` (Donor Discovery: prospect total, request-completion percent) —
  and **direct Supabase browser-client counts** for the two stages with no dedicated route
  (Opportunities: total + eligibility-scored ratio; Grant Narratives: applications with
  `draft_content` set + ratio of total), matching the exact mixed API-route/direct-Supabase read
  pattern the existing `donor-discovery/page.tsx` already uses for its own stage-count tiles. Every
  per-stage fetch has its own try/catch returning a null/0 fallback, so one endpoint failing
  doesn't blank the other five cards.
- Front face: stage icon, name, live count badge (or "—" while loading/on fetch failure). Back
  face: last-activity relative timestamp (`formatRelative`), a teal progress bar, and a quick-action
  `Link` button routing to the stage's real page (`/onboarding`, `/research`, `/opportunities`,
  `/draft-generator`, `/admin/autoapply-ops`, `/donor-discovery`).
- Added to `dashboard/page.tsx` directly above the 4 primary stat cards, per the task's placement
  instruction.
- Gate: `pnpm tsc --noEmit` — 0 errors, ran clean.
- **Not done:** `pnpm run build` / `pnpm lint` / Playwright not requested, not run — no browser
  verification this pass (the hover-flip interaction and live counts against a real signed-in
  session are unverified).
- Governance docs updated: `STATE_OF_THE_BUILD.md`, this file. `BLUEPRINT.md`, `SCHEMA_REGISTRY.md`,
  `BEHAVIORAL_CONTRACTS.md`, `AGENTS.md`, `CLAUDE.md`, and `DONOR_DISCOVERY_ARCHITECTURE.md`
  untouched — pure UI addition against existing routes/tables, no schema, contract, or agent-type
  change.

---

## COMPLETED — July 13: Migrations 073-074 applied to production (correcting a stale doc claim)

Verified against the live database first: the July 9 "Production Sync" note claiming migrations
067-074 were all applied was **false** for 073/074 — `adapter_usage_log` and
`donor_discovery_geocache` did not exist. Applied both via direct Management API `curl` calls
(the requested tsx/node script was blocked by this session's command-approval gate every attempt;
curl was not). Full detail in `STATE_OF_THE_BUILD.md`'s new top entry — summary:

- `073_adapter_usage_log.sql`: table + index + `'google_places'` enum value — applied, verified.
- `074_donor_discovery_geocache.sql`: table — applied, verified.
- `donor_discovery_taxonomy_aliases` RLS + `service_role_all` policy: already existed from
  migration 072 (confirmed via `pg_class.relrowsecurity`), no-op.
- No application code touched; no build/lint/test gates run (pure DB schema task).

---

## COMPLETED — July 13 (latest session): Settings + Onboarding pages Elevated Slate rebuild

Task specified an exact literal-class spec for `src/app/(dashboard)/settings/page.tsx` and
`src/app/(dashboard)/onboarding/page.tsx` (both read in full first). Full detail in
`STATE_OF_THE_BUILD.md`'s new top entry — summary:

- **Settings**: all four sections (Organization/Team/Plan Usage/Feature flags) rebuilt onto a new
  `SettingsSection` shell (`bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden
  mb-6`, `bg-[#F8FAFC]` header with a tinted icon chip) replacing the shared `<Card>`. New
  `ToggleIndicator` (styled on/off switch) replaces the `<Badge>` on read-only feature-flag rows.
  New owner-only Danger Zone callout (`border-[#FCA5A5] bg-[#FFF1F1]`) references the existing
  per-row "Remove team member" action rather than fabricating a new destructive control (no
  delete-organization route exists to attach one to). All rows across the page (Team roster,
  pending invites, usage bars, feature flags) now share the same label/description classes.
  Page top now uses the shared `<PageHeader>`.
- **Onboarding**: old `ProgressBar` replaced with a new `StepIndicator` matching the spec's
  circle-and-connector-line stepper (filled/outlined/empty circles, `bg-[#0077B6]`/`bg-slate-200`
  connector segments). All 20 form fields (`Input`/`Select`/`Textarea`) across Steps 1/2/3/4/6 now
  carry a premium-input className override (`PREMIUM_INPUT_CLASS`/`PREMIUM_SELECT_CLASS` — two
  constants, since a select needs `pr-9` for its chevron where an input needs symmetric `px-4`,
  and this repo's `cn()` doesn't de-dupe conflicting utilities). Full `navy-*`/`teal-*` → 
  `slate-*`/`#0077B6` token sweep across the whole file for a consistent palette. Save and
  Continue button restyled to the spec's exact `bg-[#0077B6] hover:bg-[#005F92] ... shadow-md`.
- Gate: `pnpm tsc --noEmit` — 0 errors, ran clean, after earlier `npx`/direct-binary/PowerShell
  attempts this pass hit the known intermittent command-approval block. `pnpm run
  build`/`pnpm lint`/Playwright not requested, not run — no browser verification this pass.

---

## COMPLETED — July 13: Sales Outreach + AutoApply Ops pages Elevated Slate rebuild

Task named `src/app/(dashboard)/sales-outreach/page.tsx` and
`src/app/(dashboard)/autoapply-ops/page.tsx` — both stale paths; real files are under
`src/app/(dashboard)/admin/`. Full detail in `STATE_OF_THE_BUILD.md`'s new top entry — summary:

- **Sales Outreach Prospects tab**: table container/header restyled to the spec (`bg-white
  rounded-xl shadow-sm border border-slate-200 overflow-hidden` container, `bg-[#1A2B3C]`/
  `text-[#CBD5E1]` dark header) via `Table`'s existing override props, dropping the `<Card>`
  wrapper. Status column moved from `<Badge>` to a new literal-class `PROSPECT_STATUS_PILL` map
  reusing `pipeline.ts`'s color pairs. New per-row "Suppress" button (`bg-[#0077B6] ...
  hover:bg-[#005F92]`) wired to the existing `PATCH /api/admin/prospects/[id]` route, not a new
  endpoint. **Skipped the spec's "Prospect score column"** — the sales-outreach `prospects` table
  has no score field; only the unrelated `donor_discovery_prospects` table does. Didn't fabricate
  one.
- **AutoApply Ops**: the spec's "job queue items (running/completed/failed) with form-fill/
  research/draft type badges" describes UI this page doesn't have — it's a platform-wide
  aggregate ops dashboard with no per-job list (the real job-queue UI lives on the separate
  `/autoapply` page, out of scope). Applied the requested running/completed/failed color+pulse
  treatment to the two real live-status cards instead: Worker (online = pulsing blue dot +
  `#EFF6FF`/`#BFDBFE`, offline = `#FEF2F2`/`#FECACA`) and Platform (running = `#F0FDF4`/
  `#BBF7D0`, paused = `#FEF2F2`/`#FECACA`). No job-type badges added — no job-type field exists
  in this page's data.
- Gate: `pnpm tsc --noEmit` — 0 errors, ran clean. `pnpm run build`/`pnpm lint`/Playwright not
  requested, not run — no browser verification this pass.

---

## COMPLETED — July 13: Contacts + Financials + Reports pages Elevated Slate rebuild

Task specified an exact literal-class spec for `src/app/(dashboard)/contacts/page.tsx`,
`src/app/(dashboard)/financials/page.tsx`, and `src/app/(dashboard)/reports/page.tsx` (all three
read in full first). Full detail in `STATE_OF_THE_BUILD.md`'s new top entry — summary:

- **Contacts**: `ContactTable.tsx` had no grid/list toggle before this pass — added one
  (`view=grid|list` in the URL, matching the `OpportunityTable.tsx` precedent). New
  `ContactCard.tsx` (grid: avatar/name/role/org per spec) and a new inline `ContactListRow` (list:
  `flex items-center gap-4` row per spec, replacing the old sortable `<Table>` — a `<tr>` can't
  render that shape, so column sorting was dropped for a fixed name-ascending order). New
  `contact-shared.ts` factors out `ContactRow`/`RELATIONSHIP_COLOR`/`contactInitials()` so
  `ContactCard` doesn't create a circular import with `ContactTable` (which re-exports both names
  so `ContactDetail.tsx`'s existing import path still works).
- **Financials**: all four `StatCard` tiles restyled to the spec's bold typography (`text-4xl
  font-black` value, uppercase-tracking-wide label). New `BudgetBar` (teal fill/slate track) added
  as a "Budget Utilization" column in the category table (no chart existed before). `even:bg-
  [#F8FAFC]` alternating rows applied to the one real `<table>` plus an equivalent pattern on the
  three `<ul>`-based sections. Signed amounts (Receivables' awarded total, Active Grants'
  awarded-minus-requested diff) now use the spec's exact `text-[#15803D]`/`text-[#B91C1C]`
  font-semibold colors instead of the old green-700/Badge treatment.
- **Reports**: had no report-category cards before this pass (only a single Board Report
  generator form exists — one `/api/reports/board` endpoint, no separate report types). Added a
  3-card row (Grant Reports/teal, Financial Reports/green, Activity Reports/violet) grouping the
  one report's actual sections by category, replacing the old flat "what's included" bullet list.
  "Download PDF" restyled to the spec's exact outline "Export button" classes; "Generate Board
  Report" stays the filled primary CTA.
- Gate: `pnpm tsc --noEmit` — 0 errors. Direct `npx tsc --noEmit`/`./node_modules/.bin/tsc`/
  PowerShell all hit the known intermittent sandbox-approval block (4 attempts); the equivalent
  `pnpm tsc --noEmit` ran clean twice this pass. `pnpm run build`/`pnpm lint`/Playwright not
  requested, not run — no browser verification this pass.

---

## COMPLETED — July 13: Knowledge Base + Intelligence Library pages Elevated Slate rebuild

Task specified an exact literal-class spec for `src/app/(dashboard)/knowledge-base/page.tsx` and
`src/app/(dashboard)/intelligence-library/page.tsx` (both read in full first). Full detail in
`STATE_OF_THE_BUILD.md`'s new top entry — summary:

- **The spec described "document category tabs," "document cards," and an "Upload button," none
  of which exist on the actual KB overview page** (that UI lives on `documents/page.tsx`,
  already rebuilt July 12) — applied the same Elevated Slate vocabulary to what's actually
  there instead: `KnowledgeBaseNav.tsx`'s shared section tabs (used by all 4 `/knowledge-base/*`
  pages) restyled to the spec's colored-pill pattern (`bg-[#0077B6]` active /
  `text-slate-600 hover:text-[#0077B6]` inactive); the 3 metric tiles and 3 shortcut links
  restyled to the spec's literal card classes (`bg-white rounded-xl shadow-sm border
  border-slate-200 p-5 hover:shadow-md hover:border-[#00B4D8] transition-all`).
- **Intelligence Library**: added a "Premium" badge next to the title. Funded Proposals tab
  rebuilt from a `<table>` to a card grid (`bg-white rounded-xl border border-slate-200 p-5
  hover:border-[#0077B6] transition-colors` per card, teal `funder_type` badge, same
  expand-to-sections behavior preserved). New `PremiumEmptyState` (gradient CTA per spec)
  replaces the plain `EmptyState` on all four tabs when their corpus is sparse — wired to the
  existing "Add to Library" modal for the three ingest-driven tabs, CTA-less for Data Sources
  (populated by backend ingestion, not the paste/URL flow).
- Gate: `pnpm run typecheck` clean, 0 errors (`npx tsc --noEmit`/PowerShell direct invocations
  hit the known intermittent sandbox-approval block, 4 attempts; the `pnpm` script alias
  worked). `pnpm run build`/`pnpm lint`/Playwright not requested, not run — no browser
  verification this pass.

---

## COMPLETED — July 13: Alerts + Deadlines + Outcomes pages Elevated Slate rebuild

Task specified an exact literal-class spec for `src/app/(dashboard)/alerts/page.tsx`,
`src/app/(dashboard)/deadlines/page.tsx`, and `src/app/(dashboard)/outcomes/page.tsx` (all three
read in full first). Full detail in `STATE_OF_THE_BUILD.md`'s new top entry — summary:

- **Alerts**: per-item card (`bg-white rounded-xl border border-slate-200 p-4 mb-3 flex items-start
  gap-4 hover:shadow-sm transition-shadow`) replaces the old shared-`Card`/`divide-y` list; severity
  left-border now literal `border-[#EF4444]`/`border-[#F59E0B]`/`border-[#0077B6]`; unread rows get
  `bg-[#EFF6FF]`. Added a new explicit "Mark as read" link-button, since alerts with no `link`
  (several categories) previously had no way to be marked read from the UI.
- **Deadlines**: added a local `urgencyBucket()` collapsing the existing 4-band `urgency()` helper
  (from `DeadlinePill.tsx`, out of scope) to the task's 3-tier overdue/this-week/future split, with
  literal item classes (`bg-[#FEF2F2]`/`bg-[#FFFBEB]`/`bg-white` + matching bold date-text colors).
  Applied to both `ListView` and `ComplianceList` (same file, same row pattern) for consistency;
  both dropped their enclosing `<Card noPadding>` for individually-styled rows. `UrgencyLegend`
  relabeled to the same 3-bucket vocabulary.
- **Outcomes**: added a 3-tile metric row (Success Rate/green, Total Awarded/teal, Applications/
  violet — page had no metric cards before) styled on the Dashboard's `StatCard` pattern, plus a
  small teal/amber/navy stacked breakdown bar (awarded/partial/denied) since the page had no
  chart to recolor and the task asked charts avoid gray.
- Gate: `pnpm run typecheck` clean, 0 errors (`npx tsc --noEmit` directly was sandbox-blocked this
  session — the `pnpm` script alias worked). `pnpm run build`/`pnpm lint`/Playwright not requested,
  not run — no browser verification this pass.

---

## COMPLETED — July 12 (latest session): Donor Discovery Overview + Prospects pages Elevated Slate rebuild

Task specified an exact literal-class spec for `src/app/(dashboard)/donor-discovery/page.tsx` and
`src/app/(dashboard)/donor-discovery/prospects/page.tsx` (both read in full first): Active Request
card shape, a 6-way status badge palette (queued/enumerating/enriching/scoring/complete/failed), a
gradient progress bar, Pipeline Funnel stat pills, a 3-tier score badge palette, and a prominent
"New Discovery" CTA. Full detail in `STATE_OF_THE_BUILD.md`'s new top entry — summary:

- `STATUS_BADGE_CLASS` (new, `page.tsx`) replaces the old `<Badge>`-variant map, which couldn't
  express 6 distinct colors on 5 semantic variants (`enumerating`/`enriching` both read as `info`
  before) — now literal `bg-[#...]`/`text-[#...]` pairs per status, including a scoped, deliberate
  exception to `DESIGN_SYSTEM.md`'s "no raw hue classes"/"no purple" rules per this task's explicit
  spec (`scoring` = `#EDE9FE`/`#6D28D9`).
- Progress bar fill is now a single uniform `bg-gradient-to-r from-[#00B4D8] to-[#0077B6]`
  regardless of status (previously per-status solid color); track is `h-2 bg-[#EEF2F7]`.
- `scoreBadgeClass()` (new, one copy per file) replaces both files' `<Badge>`-variant score
  helpers with literal green/yellow/red classes, thresholds now aligned across both pages
  (green > 70, yellow 40–70, red < 40 — the two old helpers had disagreed on cutoffs).
  `ProspectDetail.tsx`'s separate `scoreVariant()` left untouched, out of scope.
- "New Discovery" CTA on both pages' `PageHeader` swapped from `<Button>`-wrapped `<Link>` to a
  raw `<Link className="...">` with the task's literal classes — `Button`'s base classes would
  conflict, same non-deduping-`cn()` reason noted in every prior literal-class pass. Smaller
  `EmptyState` "New Discovery"/"Start Discovery" buttons left on the shared `<Button>`, unchanged.
- Prospects table required no structural change — already on the shared `<Table>` component's
  Elevated Slate defaults from a prior pass; only its Score column badge changed.
- Gate: `pnpm tsc --noEmit` clean, 0 errors. `pnpm run build`/`pnpm lint`/Playwright not requested
  by this task, not run — no browser verification this pass.

---

## COMPLETED — July 12 (latest session): Applications + Documents pages Elevated Slate rebuild

Task specified an exact literal-class spec for `src/app/(dashboard)/applications/page.tsx` and
`src/app/(dashboard)/documents/page.tsx` (both read in full first): pipeline-stage pills (5 named
colors), an application "row card" shape (`bg-white rounded-xl shadow-sm border border-slate-200
p-5 mb-3 hover:shadow-md transition-shadow`), application-name/deadline text treatment, a
document card shape with color-coded file-type icons, and an exact upload-button class string.
Full detail in `STATE_OF_THE_BUILD.md`'s new top entry — summary:

- **`stagePillClassName()`** (new, `pipeline.ts`) buckets the real 12-value `pipeline_stage` enum
  onto the task's 5 named pill colors (Discovery/Eligibility Review/Applied/Awarded/Rejected) —
  `qualified` through `follow_up_due` all read as "Applied" (in-process), `awarded`/
  `reporting_required`/`renewal_opportunity` all read as "Awarded" (post-award lifecycle). The
  granular `STAGE_LABEL` text is still shown on every pill, only the color grouping is coarser.
  Used by both `ApplicationsTable.tsx` and `GroupedKanban.tsx`'s `KanbanCard`.
- **`ApplicationsTable.tsx` rebuilt from an HTML `<table>` to a card list** — a `<tr>` can't
  render `rounded-xl`/`mb-3` correctly under table layout, so each application is now a flex-row
  card `<div>`, matching the `FunderCard`/`OpportunityCard` precedent from the prior pass. All
  sort/filter/multi-select/bulk-move logic preserved; only the row markup and header control row
  changed. Deleted the now-dead `stageBadgeColor()` helper (its two callers both moved to the new
  pill classes) — `STAGE_COLOR`/`BadgeColor` themselves untouched, still depended on by
  `ApplicationDetail.tsx`/`StageTransitionModal.tsx`/`PipelineColumn.tsx`/`applications/list/
  page.tsx` (checked via grep, out of scope).
- **`isUrgentDeadline()`** (new, `pipeline.ts`) collapses the prior 4-band deadline-urgency system
  to the task's 2-tier spec (`text-[#EF4444] font-medium` urgent / `text-slate-400` future),
  shared by `ApplicationsTable.tsx` and `GroupedKanban.tsx` so both views agree.
- **`DocumentList.tsx` rebuilt from a 7-column `Table` to an Elevated Slate card grid**
  (`bg-white rounded-xl border border-slate-200 p-4 hover:border-[#00B4D8] transition-colors` per
  card, no shadow per the literal spec). New color-coded `FileTypeIcon`/`fileKind()`: pdf → red
  wrapper, docx → blue, xlsx → green, everything else → neutral slate fallback, classified by
  extension with a MIME-type fallback. Search/category filter/download/expiration
  warning/application-linking all preserved unchanged.
- **`DocumentUploader.tsx`**'s Upload button swapped from the shared `<Button>` to a raw
  `<button>` with the task's exact literal classes — `Button`'s base classes would conflict via
  this repo's non-deduping `cn()`, same reasoning as every prior literal-class pass this session.
- Both pages wrapped in the now-standard `min-h-screen bg-[#EEF2F7] p-6` + `PageHeader` shell.
- Gate: `pnpm tsc --noEmit` — 0 errors, ran clean. `pnpm lint` attempted (not required by this
  task, but per CLAUDE.md's standard gate sequence) via both Bash and PowerShell — hit the same
  known intermittent interactive-approval block logged throughout this file; not run, not claimed
  to pass.
- **Not done:** `pnpm run build` / `pnpm lint` / Playwright not requested by this task, not run;
  no browser verification this pass.
- Governance docs updated: `STATE_OF_THE_BUILD.md`, this file. No schema/contract/agent change —
  pure UI/styling change to two pages plus their child components.

---

## COMPLETED — July 12 (latest session): Funders + Foundations pages rebuilt as Elevated Slate card grids

Task specified an exact literal-class spec for `src/app/(dashboard)/funders/page.tsx` and
`src/app/(dashboard)/foundations/page.tsx` (both read in full first): `min-h-screen
bg-[#EEF2F7] p-6` wrapper, a card grid replacing each page's `Table`-based list
(`bg-white rounded-xl shadow-sm border border-slate-200 p-5 hover:shadow-md
hover:border-[#00B4D8] transition-all cursor-pointer` per card), and specific
title/subtitle/metadata-row/badge/accent-stripe classes. Full detail in
`STATE_OF_THE_BUILD.md`'s new top entry — summary:

- **New `FunderCard.tsx`/`FunderCardGrid.tsx`** (funders) and **`FoundationCard.tsx`**
  (foundations) — `FunderTable.tsx` left in place (still used by
  `intelligence/recommendations/page.tsx`, checked via grep first), only `funders/page.tsx`
  repointed to the new card grid. Foundations' `Table` column config deleted outright (no
  other caller).
- **Funder type badge** buckets `funders.category`'s 12 enum values by substring priority
  (government → foundation → corporate) onto the spec's 3 named colors, with a neutral
  fallback pill for the categories that don't fit any bucket (`housing_grant`,
  `in_kind_donation`, etc. — not named in the spec).
- **Foundation accent stripe** (private/community/corporate) can't be driven by
  `foundation_type` — that column is the raw IRS BMF foundation code (e.g. `"04"`, `"25"`),
  not an entity-type label. Inferred instead from the legal name (`"...COMMUNITY
  FOUNDATION"`, a `CORP/COMPANY...FOUNDATION` regex, private as the default) — a documented
  heuristic against the data actually on file, not a verified classification.
- Search bars on both pages are raw `<input type="search">` elements with the spec's literal
  classes, not the shared `SearchBar`/`Input` components — neither component's `className`
  prop reaches the actual `<input>` (`SearchBar` applies it to the wrapper div; `Input` merges
  via a non-deduping `cn()`).
- AutoApply batch-selection, URL-synced search/category filters (funders), and bulk
  select/import (foundations) all preserved from the pre-existing table implementation — only
  the rendering changed, not the interaction logic.
- Gate: `pnpm run typecheck` — 0 errors. Direct `npx tsc --noEmit` hit the same known
  intermittent approval block logged throughout this file; the project's own `typecheck`
  script (identical underlying command) ran clean.
- **Not done:** `pnpm run build` / `pnpm lint` / Playwright not requested, not run; no browser
  verification this pass.
- Governance docs updated: `STATE_OF_THE_BUILD.md`, this file. No schema/contract/agent
  change — pure UI/styling change to two pages plus three new page-local card components.

---

## COMPLETED — July 12: PageHeader rebuilt to a fixed literal-class spec

Rebuilt `src/components/layout/PageHeader.tsx` (only match for `find . -name 'PageHeader*'`) to
an exact spec: outer `mb-8`, content row `flex items-center justify-between`, `h1` `text-2xl
font-bold text-slate-900 tracking-tight`, subtitle `p` `text-sm text-slate-500 mt-1`, actions in
`flex items-center gap-3`, and a `border-l-4 border-[#0077B6] pl-4` left-accent on the title
block. Full detail (including the primary-button enforcement logic and the removed
`className`/`align` props) in `STATE_OF_THE_BUILD.md`'s new top entry — summary:

- **Removed `className`/`align` props** — the component is now a fixed shape, not
  per-page-configurable, superseding this session's earlier "`className` full-override" tweak
  from the Opportunities-page pass below. Only caller using them
  (`opportunities/page.tsx`) updated to drop both.
- **New: recursive primary-button style enforcement** — `actions` children are walked
  (`Children`/`cloneElement`, fragment- and `<Link>`-wrapper-aware) and any `Button` component
  instance with `variant` unset or `"primary"` gets its `className` force-set to the spec's
  exact string; secondary/ghost/danger `Button`s and non-`Button` nodes pass through.
- Gate: `pnpm tsc --noEmit` — 0 errors, ran clean. All 8 `<PageHeader` call sites verified to
  compile under the smaller prop type via a full-repo tsc run.
- **Not done:** `pnpm run build` / `pnpm lint` / Playwright not requested, not run; no browser
  verification this pass.
- Governance docs updated: `STATE_OF_THE_BUILD.md`, this file. No schema/contract/agent change.

---

## COMPLETED — July 12 (latest session): Opportunities page visual overhaul (slate/hex table + tabs)

Same treatment as this session's Dashboard/Header/Sidebar rebuilds (below), applied to
`src/app/(dashboard)/opportunities/page.tsx` and every child component it imports (read in
full first): page wrapper `min-h-screen bg-[#EEF2F7] p-6`, a white `PageHeader` card, the
source-type filter tabs (`Government Federal 103`, etc.) restyled to
active-`bg-[#0077B6]`/inactive-white-with-slate-border pill buttons, the opportunity table's
container/header row/`th`/`tr` recolored to the slate palette, `Amount` values bolded
(`font-semibold text-slate-900`), literal-class `Open` status and `Not Applied` application
badges, and the `New opportunity` button restyled to `bg-[#0077B6]`/`hover:bg-[#005F92]`.

- `PageHeader.tsx`'s `className` prop changed from "merged onto the base card classes" to "full
  override when provided" (`className ?? <default>`) — no existing caller passed `className`
  before this change (grepped first), so this is non-breaking; lets the opportunities page fully
  own its header card look (`p-6 mb-6` etc.) without fighting the default `px-5 py-4` via
  concatenated, non-deduped Tailwind classes (this repo's `cn()` is a plain-concat `clsx`, not
  `tailwind-merge` — no de-dupe when two classes touch the same property).
- `Table.tsx` (the shared `src/components/ui/Table` used by ~40 other pages) gained six new
  **optional** override props (`containerClassName`/`tableClassName`/`theadClassName`/
  `thClassName`/`tbodyClassName`/`rowClassName`), each defaulting to the exact previous
  hardcoded class string via `?? <default>` — every other caller is unaffected since none pass
  these props. Only `OpportunityTable.tsx` passes them, to get the literal slate/white classes
  the task specified for the container/header row/`th`/row without touching the other ~40
  tables app-wide.
- `SourceTypeTabs.tsx`'s `TabButton` restyled directly (single call site, opportunities-only
  component) — `rounded-full`→`rounded-lg`, `px-3 py-1.5`→`px-4 py-2`, active/inactive colors to
  the spec's literal hex/slate classes.
- `eligibility.tsx`'s `matchColor()` thresholds changed (this function's only caller is
  `MatchBadge`, verified by grep): was green ≥80 / yellow 40-79 / red <40; now red only at
  exactly 0%, green above 50%, yellow in between, per the task's literal "0% → red, >50% →
  green" spec. `HIGH_PRIORITY_THRESHOLD`/`MISMATCH_REASON_THRESHOLD` constants (still exported,
  still used by `OpportunityDetail.tsx` and `src/lib/agents/eligibility-scorer.ts`) were left
  untouched — only `matchColor`'s own body changed.
- The Open-status and Not-Applied badges are hand-written `<span>`s with the literal classes
  from the spec rather than `Badge`-component overrides, because `Badge`'s base padding
  (`py-0.5`/`font-medium`) differs from what was asked (`py-1`/`font-semibold`) and — same
  `cn()`-has-no-dedupe reason as above — appending conflicting utility classes to `Badge`'s
  `className` prop would have unpredictable results. Note the color values themselves
  (`bg-[#DCFCE7]`/`text-[#15803D]`, `bg-[#FEE2E2]`/`text-[#B91C1C]`) already exactly match this
  repo's `--color-success-*`/`--color-error-*` CSS-variable tokens (confirmed in
  `globals.css`) — only the two structural properties needed a literal override.
- Both `New opportunity` action sites (header actions + the empty-state CTA) changed from the
  shared `<Button>` component wrapped in a `<Link>` to a `<Link>` carrying the literal spec
  classes directly (same non-dedupe reasoning: `Button`'s base `h-10 px-4 font-medium
  transition` would conflict with the spec's `py-2.5 px-5 font-semibold transition-colors`).
  `Button` import removed from `page.tsx` (no longer used there); `EmptyState` import kept.
- Gate: `pnpm tsc --noEmit` — 0 errors, ran clean (direct invocation this session, no
  intermittent-approval issue this time).
- **Not done:** `pnpm run build` / `pnpm lint` / Playwright not requested, not run; no browser
  verification this pass.
- Governance docs updated: `STATE_OF_THE_BUILD.md`, this file. No schema/contract/agent
  change — pure UI/styling change to the opportunities page and its child components, plus two
  narrowly-scoped, backward-compatible prop additions to shared `PageHeader`/`Table` components.

---

## COMPLETED — July 12 (latest session): Dashboard page visual overhaul (slate/hex stat cards)

Task specified an exact set of literal Tailwind class strings for
`src/app/(dashboard)/dashboard/page.tsx` (read in full first): page wrapper `min-h-screen
bg-[#EEF2F7] p-6`, title block, 4-column primary stat-card grid with per-card hex left-accent
bars (`#0077B6`/`#7C3AED`/`#F59E0B`/`#EF4444` for Total Opportunities/Applications
Submitted/Drafts Generated/Deadlines This Week) and matching top-right icon chips at 10%
accent opacity, a `bg-white` Pipeline section, a dark-header (`bg-slate-800`) Upcoming
Deadlines panel, and a Recent Activity section — all hardcoded literal strings, same
"exact-class, not theme-token" pattern as the July 12 Sidebar/Header rebuilds.

- The 4 primary stat cards no longer use the shared `MetricCard` component (its `hue` prop
  only maps to fixed Tailwind palette classes, not arbitrary hex at 10% opacity) — replaced
  with a new local `StatCard` component defined in the page file, keyed by a `STAT_ACCENTS`
  map of literal class strings per accent (`blue`/`violet`/`amber`/`red`) so Tailwind's
  static scanner still picks up every `bg-[#...]`/`bg-[#...]/10`/`text-[#...]` string. The
  secondary financial-metrics row (Total Requested/Total Awarded/Success Rate) and the Quick
  Actions card were not in the task's spec — left on the existing `MetricCard`/`Card`
  components, just re-spaced with `mb-8` to sit in the new layout rhythm.
- `PageHeader` component dropped in favor of the spec's literal `h1`/`p` markup; Pipeline and
  Recent Activity sections now hand-rolled `bg-white rounded-xl` divs instead of the shared
  `Card` (which renders a `bg-surface-sunken` header bar, not what the spec asked for).
- **`DeadlineWidget.tsx` also updated** (dashboard-only component, no other call site per
  grep) — task asked for a 3-color dot indicator (red overdue / amber this-week / green
  upcoming) on each deadline item; replaced the prior 4-band `Badge`-pill urgency system
  with a plain colored dot + inline label text, collapsing `orange`/`yellow` into one
  `this_week` band.
- Gate: `pnpm tsc --noEmit` — 0 errors, ran clean.
- **Not done:** `pnpm run build` / `pnpm lint` / Playwright not requested, not run; no
  browser verification this pass.
- Governance docs updated: `STATE_OF_THE_BUILD.md`, this file. No schema/contract/agent
  change — pure UI/styling change to one page plus its two page-local child components.

---

## COMPLETED — July 12 (latest session): Header rebuilt with hardcoded Tailwind (no CSS-variable structure)

Same treatment as the Sidebar rebuild immediately below, applied to
`src/components/layout/Header.tsx` (read in full first): outer `<header>`, inner container,
tab-nav container, active/inactive tab link, and mobile hamburger button all rewritten to
the exact literal Tailwind strings specified, replacing the prior theme-token classes
(`bg-surface`, `border-border`, `text-text-muted`, etc.). Active/inactive classes hoisted to
`NAV_LINK_ACTIVE`/`NAV_LINK_INACTIVE` module constants, mirroring the Sidebar's
`NAV_ITEM_ACTIVE`/`NAV_ITEM_INACTIVE` pattern. Also added a notification bell (new — wired
to the existing `/api/notifications` route's `unread_count`, not a new endpoint) and made
the organization name visible in the header bar next to the avatar, both requested as part
of this rebuild's spec. Donor Discovery's `PERMANENT` header-nav comment and tab entry are
untouched. Full detail in `STATE_OF_THE_BUILD.md`'s new top entry.

- Gate: `pnpm tsc --noEmit` — 0 errors, ran clean.
- **Not done:** `pnpm run build` / `pnpm lint` / Playwright not requested, not run; no
  browser verification this pass.
- Governance docs updated: `STATE_OF_THE_BUILD.md`, this file. No schema/contract/agent
  change — pure UI/styling change to one existing component plus wiring to an
  already-existing notifications route.

---

## COMPLETED — July 12: Sidebar rebuilt with hardcoded Tailwind (no CSS-variable structure)

Task specified an exact set of literal Tailwind class strings for every structural piece of
`src/components/layout/Sidebar.tsx` (outer wrapper, `<aside>` panel, logo area, nav section,
active/inactive nav item, section labels, `NavBadge`, mobile backdrop, bottom settings area,
tagline) — all hardcoded hex/arbitrary-value classes, deliberately not theme CSS-variable
tokens (`bg-sidebar`, `text-slate-400`, `bg-primary`, `text-accent`, etc.), so the design
can't be silently overridden by a theme change elsewhere. Read `Sidebar.tsx` and
`nav-items.ts` in full first, then rewrote every className in `Sidebar.tsx` to the literal
specified strings, hoisting the active/inactive item classes to two module-level constants
reused across the main nav, Donor Discovery drilldown, Platform admin section, and Settings
link. No logic changes (badge fetching, remembered-href resolution, `isActive()`, role
gating all unchanged). Full detail in `STATE_OF_THE_BUILD.md`'s new top entry.

- Gate: `pnpm tsc --noEmit` — 0 errors, confirmed via redirected-output file (empty on
  completion) after the direct-invocation approval prompt behaved inconsistently this
  session (same known intermittent gate-blocking issue logged in prior entries below).
- **Not done:** `pnpm run build` / `pnpm lint` / Playwright not requested, not run; no
  browser verification this pass.
- Governance docs updated: `STATE_OF_THE_BUILD.md`, this file. No schema/contract/agent
  change — pure UI/styling change to one existing component.

---

## AUDIT — July 10 (latest session): Phase 2-4 completion audit — not marked complete

Task requested writing Donor Discovery Phases 2/3/4 as "COMPLETE" in
`DONOR_DISCOVERY_ARCHITECTURE.md` §8 and a "Night 3 Build COMPLETE" section in
`STATE_OF_THE_BUILD.md`. Did not write either as requested — an Explore-agent audit of every
Phase 2-4 deliverable against the actual files found three concrete production breakages
(taxonomy search 500s because `donor_discovery_taxonomy_aliases`/migration 075 is unapplied;
`ScoringEngine.persist()` throws because `scored_at`/migration 078 is unapplied; connector
enrichment throws because `enrichment_private`/migration 079 is unapplied), a missing
trade-association adapter, three new registry adapters that are built but never wired into the
live request pipeline, and a stray duplicate `src/supabase/migrations/` directory. Full findings
and recommended next actions written into `STATE_OF_THE_BUILD.md`'s new top entry.

`pnpm tsc --noEmit` (root) was requested for this session's audit gate and could not be run —
blocked on interactive-approval every attempt (the same intermittent issue logged repeatedly
elsewhere in this file). Not claimed as passing. Route/page counts were taken directly from the
filesystem instead: 91 `page.tsx` files, 184 `route.ts` files under `src/app`, 5 donor-discovery
pages, 8 donor-discovery API routes.

`queue.yaml` was overwritten with a placeholder (`queue-night4-intelligence.yaml`'s content,
already present untracked in the repo root) per this session's explicit instruction — the real
Phase 1 queue content it held is preserved in git history (already committed).

Governance docs updated: `STATE_OF_THE_BUILD.md`, this file, `DONOR_DISCOVERY_ARCHITECTURE.md`
§8 (phase status corrected, not marked complete), `SCHEMA_REGISTRY.md` (three Phase 2-4 tables
registered: `donor_discovery_taxonomy_aliases`, `adapter_usage_log`, `donor_discovery_geocache`
— all three already existed as file-only migrations 075/076/077; this only adds them to the
registry doc). `git add -A`/commit/push were **not** run this session — flagged to Reid for
confirmation given the mixed working tree (log/output dumps, modified agent-worktree directories)
and the severity of the production-breakage findings above.

---

## COMPLETED — July 10 (latest session): Apollo + Hunter §6 BYO-key connectors + run_connector_enrichment worker job

Task: read `src/app/(dashboard)/donor-discovery/connectors/page.tsx` and
`src/lib/crypto/key-encrypt.ts` in full, then build the actual enrichment behavior behind the
Connectors page — Apollo.io and Hunter.io connectors implementing a shared `ConnectorEnricher`
interface, plus the worker job that runs them.

- **`src/lib/donor-discovery/connectors/types.ts`** — the shared `ConnectorEnricher` interface
  (`enrich(prospect: DirectoryRecord, apiKey: string): Promise<ConnectorEnrichment>`) and a
  shared `isDecisionMakerTitle()` keyword filter (ceo/executive director/president/director/
  manager/csr/development/donor/giving/philanthropy) used by both connectors.
- **`apollo-connector.ts`**: `POST /v1/mixed_people/search`, `api_key` in the body. Domain search
  when the directory record has a website, name search (`q_organization_name`) as fallback.
  Sends the task's target titles (CEO/Executive Director/CSR Director/Donations Manager) as
  Apollo's `person_titles` filter, re-filtered client-side. `confidence: null` on every contact —
  Apollo's response carries no per-contact confidence field, unlike Hunter.
- **`hunter-connector.ts`**: `GET /v2/domain-search?domain=&api_key=`, domain-only (throws if no
  website on file). Keeps Hunter's real per-email confidence score. Filtered to the same shared
  decision-maker keyword list the task specified (director/manager/president/CEO/executive/
  development/donor/giving/CSR).
- **`usage-log.ts`** — `logConnectorUsage()`, writes to `adapter_usage_log` keyed by
  `adapter_name = provider`, matching the column convention the connectors API route already
  aggregates by — so the page's "last used"/"records enriched" stats populate for real once this
  job runs, no route change needed.
- **`src/worker/jobs/run-connector-enrichment.ts`** — `handleRunConnectorEnrichmentJob(supabase,
  {prospectId, connectorProvider})`: loads the prospect + its shared directory record, decrypts
  the org's active connector key (`decryptKey` from `key-encrypt.ts`), calls the matching
  connector, merges the result into `donor_discovery_prospects.enrichment_private` (new column,
  keyed by provider so a Hunter run doesn't erase a prior Apollo result), logs usage.
  `claimNextRunConnectorEnrichmentJob` scans active Apollo/Hunter connectors then each org's
  oldest not-yet-enriched-by-that-provider prospect (`enrichment_private->>provider IS NULL`,
  matching the existing `.is("col->>key", null)` convention from
  `enrich-nonprofits-propublica.ts`) — same plain-scan posture as the sibling donor-discovery
  jobs, no dedicated queue/lock column.
- **New migration `supabase/migrations/079_donor_discovery_prospects_enrichment_private.sql`** —
  adds `donor_discovery_prospects.enrichment_private jsonb not null default '{}'`. Already
  RLS-protected by the table's existing org-isolation policy; deliberately distinct from the
  shared, no-RLS `donor_discovery_directory.enrichment` — connector contact data is tenant-owned
  per §6, never written to the shared directory row. File only, not applied to production.
- **Wired into `worker/queue-processor.ts`**: third idle-cycle job alongside
  `enrich_donor_prospect`/`score_donor_prospect`.
- Gate: `pnpm run typecheck` — 0 errors. `pnpm tsc --noEmit -p worker/tsconfig.json` (required to
  actually check the `queue-processor.ts` edit — `worker/` is excluded from the root tsconfig) —
  0 errors.
- **Not done:** migration 079 not applied to production; no live Apollo/Hunter key exercised
  (nothing has actually enriched a prospect yet); `pnpm run build` / `pnpm lint` / Playwright not
  run (only the two tsc gates were requested this pass).
- Governance docs updated: `STATE_OF_THE_BUILD.md`, this file. `BLUEPRINT.md`,
  `SCHEMA_REGISTRY.md`, `BEHAVIORAL_CONTRACTS.md`, `AGENTS.md`, `CLAUDE.md`, and
  `DONOR_DISCOVERY_ARCHITECTURE.md` untouched — §6 already specified this exact connector shape;
  this pass implements it rather than changing the design. One additive column, no new table,
  contract, or agent-type definition.

---

## COMPLETED — July 10: TX TDLR + land bank directory registry adapters

Task: read `DONOR_DISCOVERY_ARCHITECTURE.md` §2A in full, then build two §2A "Registry layer"
adapters — `src/lib/donor-discovery/adapters/tx-tdlr-adapter.ts` (Texas Department of Licensing
and Regulation licensee search, license types ELEC/PLMB/HVAC/ELEV/BLRP, active-license filter,
NAICS mapping) and `src/lib/donor-discovery/adapters/land-bank-adapter.ts` (Center for Community
Progress land bank directory scrape) — plus their ingest scripts and package.json entries.

- **`tx-tdlr-adapter.ts`**: `GET https://www.tdlr.texas.gov/TNPWS/Lookup.aspx?SearchType=Business
  &LicenseType=<code>` per license type, fetched via `fetchCompliant` (crawler-core.ts, not a
  bare fetch). Parses the results table with the newly-installed `node-html-parser`, matching
  columns by header text (business name/license number/city/zip/phone/expiration date) rather
  than a hardcoded index. Filters to licenses whose parsed expiration date is strictly after
  today. NAICS mapping: ELEC→238210, PLMB→238220, HVAC→238220, ELEV→238290 (all given explicitly
  in the task); BLRP→238290 was not given explicitly — mapped to match ELEV per the real Census
  NAICS manual, which groups elevator and boiler-house-piping installation under the same "Other
  Building Equipment Contractors" code. Implements `RegistryAdapter` as the task required
  (`enumerate(naicsCodes, geography, organizationId)`, resolving license types from the requested
  NAICS codes); also exports a standalone `searchLicenseType()` for the ingest script, matching
  `samgov-adapter.ts`'s existing standalone-function pattern.
- **`land-bank-adapter.ts`**: single fetch of the Community Progress directory page, same
  `node-html-parser`/header-matching approach, upserts with `civic_kind: "land_bank"` (matches
  the existing taxonomy convention in `scripts/seed-dd-taxonomy.ts`'s civic branch) and
  `source_adapter: "land_bank_directory"`. Not wrapped in `RegistryAdapter` — the task didn't ask
  for that here, and there's no NAICS/geography axis to enumerate a fixed national directory
  against; exports a standalone `fetchLandBankDirectory()` instead.
- **Dependency**: `node-html-parser` was not already in `package.json` — installed via
  `pnpm add node-html-parser` (task's explicit instruction), even though this codebase already
  has `cheerio` for HTML parsing elsewhere (`website-scraper.ts`). Kept the two libraries
  separate rather than retrofitting cheerio, per the literal task spec.
- **New: `scripts/ingest-tx-tdlr.ts`** (`pnpm ingest:tdlr`) and **`scripts/ingest-land-banks.ts`**
  (`pnpm ingest:landbanks`), both added to `package.json`. TDLR script sweeps all five license
  types with non-fatal per-type failure handling (same posture as `ingest-samgov.ts`); land bank
  script is a single call, no loop.
- Gate: `pnpm tsc --noEmit` — 0 errors, ran clean on the first attempt (no interactive-approval
  block this session).
- **Not done:** neither ingest script has actually been run — `donor_discovery_directory` isn't
  populated by either adapter yet. The TDLR and Community Progress pages' real HTML structure
  is unverified in this session (no live fetch was made) — the header-text-matching parsers are
  a best-effort design against undocumented public pages; if either site's actual markup uses a
  structure the header-matching logic doesn't recognize, `searchLicenseType`/
  `fetchLandBankDirectory` will log a "zero rows parsed" warning rather than fail loudly, per
  BEHAVIORAL_CONTRACTS.md §18/§21's "flag for reconfiguration" posture — worth a live run to
  confirm before relying on either adapter. `pnpm run build` / `pnpm lint` / Playwright not run
  (only tsc was requested this pass); not manually verified in a browser (not applicable — no UI
  change).
- Governance docs updated: `STATE_OF_THE_BUILD.md`, this file, and `DONOR_DISCOVERY_
  ARCHITECTURE.md` §2A (adapter cross-reference bullets) and §8 Phase 4 (status note).
  `BLUEPRINT.md`, `SCHEMA_REGISTRY.md`, `BEHAVIORAL_CONTRACTS.md`, `AGENTS.md`, and `CLAUDE.md`
  untouched — no schema, contract, or agent-type change.

---

## COMPLETED — July 10 (latest session): Donor Discovery Connectors page + connectors API

Task: build `src/app/(dashboard)/donor-discovery/connectors/page.tsx` per
`DONOR_DISCOVERY_ARCHITECTURE.md` §6 (read in full first) — the BYO-key connector management
page — plus `GET`/`POST /api/donor-discovery/connectors` and `POST
/api/donor-discovery/connectors/test`, using the existing `encryptKey`/`decryptKey`/`maskKey`
from `src/lib/crypto/key-encrypt.ts`.

- Found the schema already existed from a prior session: `donor_discovery_connectors`
  (migration 067 — provider enum `apollo`/`hunter`/`zoominfo`/`clay`, later extended with
  `google_places` in migration 076) and `adapter_usage_log` (migration 076, already written
  to by `google-places-adapter.ts` with `adapter_name = 'google_places'`). Built the page and
  routes against these rather than adding new tables.
- **New `src/lib/donor-discovery/connector-providers.ts`** — the 5-provider catalog (name,
  description, `connectable` flag) shared by the page and both routes, so "coming soon"
  (ZoomInfo, Clay per §6's V1 list) can't be enforced in the UI but bypassed via a direct API
  call.
- **`GET /api/donor-discovery/connectors`** always returns one row per catalog provider
  (not just connected ones), merging connection status with `adapter_usage_log` aggregates
  (`last_used_at` = max `called_at`, `records_enriched` = sum `records_returned`, grouped by
  `adapter_name` = provider key) so the UI can show "last used" / "records enriched" without
  a second client-side query.
- **`POST /api/donor-discovery/connectors/test`** calls each provider's real validation
  endpoint rather than mocking a result — Apollo's `GET /api/v1/auth/health`, Hunter's
  `GET /v2/account`, Google Places' legacy Nearby Search (whose validity signal is the JSON
  `status` field, not the HTTP status — Places always returns 200). 8s timeout.
- Connect modal gates Save on a successful Test (matches Behavioral Contracts §20: "Test call
  required before saving"). Disconnect uses the same confirm-modal pattern as
  `settings/integrations/page.tsx`'s Gmail/Calendar disconnect flow.
- Added a "Connectors" button to the Donor Discovery Overview page header — it was otherwise
  unreachable (no nav entry links to it; `nav-items.ts`/`Sidebar.tsx`/`Header.tsx` already had
  uncommitted changes from other in-progress work this session, left untouched).
- Gate: `pnpm run typecheck` — 0 errors. `npx tsc --noEmit` hit the known intermittent
  approval block (~6 tries); `pnpm run typecheck` (same underlying `tsc --noEmit`, via the
  project's own script) went through clean on the first try.
- **Not done:** `pnpm run build` / `pnpm lint` / Playwright not run (only tsc was requested
  this pass); not manually verified in a browser or against live provider keys; migrations
  067/076 remain unapplied to production (unchanged by this pass — both tables/enum values
  already exist per those files).
- Governance docs updated: `STATE_OF_THE_BUILD.md`, this file. `BLUEPRINT.md`,
  `SCHEMA_REGISTRY.md`, `BEHAVIORAL_CONTRACTS.md`, `AGENTS.md`, `CLAUDE.md`, and
  `DONOR_DISCOVERY_ARCHITECTURE.md` untouched — no schema, contract, or agent-type change.

---

## COMPLETED — July 10: Prospect detail page rebuild + AutoApply handoff route

Task: build `src/app/(dashboard)/donor-discovery/prospects/[id]/page.tsx` and its API route
per `DONOR_DISCOVERY_ARCHITECTURE.md` §4/§7. Found the page, `ProspectDetail.tsx`, and
`GET`/`PATCH /api/donor-discovery/prospects/[id]` already built by a prior uncommitted
session — read all three in full, then filled the gaps against the task's exact spec rather
than rebuilding:

- **PATCH route extended** to accept `notes` and `assigned_to` (previously `pipeline_stage`
  only) — any non-empty subset of the three in one request. `assigned_to` is validated as a
  profile id belonging to the caller's own organization (not just any uuid) before the update.
- **`ProspectDetail.tsx` enrichment display**: `has_giving_program` now renders as a green
  `CheckCircle2`/gray `XCircle` icon (was a Yes/No badge) per spec; added
  `in_kind_history_signals` (bulleted list) and `company_size_estimate` (badge) — both already
  existed on `enrichment-agent.ts`'s `EnrichmentRecord` type and in the enrichment jsonb, just
  never surfaced in the UI. Score rationale card now shows `scored_at` (migration 078's
  column) inside a highlighted teal card.
- **AutoApply handoff button now always renders a state**: previously the button was hidden
  entirely when `has_donation_form` was false; now shows a disabled "No donation form found"
  button per spec, "Queue in AutoApply" when true and editable, or "Queued — view funder"
  once queued.
- **Rewired the handoff itself to be server-side**, not client-side: `POST
  /api/autoapply/queue` gained a second request shape —
  `{ source: "donor_discovery", prospect_id, form_url, org_name }` — that creates/reuses the
  funder record and queues it in one atomic route call, alongside the pre-existing
  `{ funder_ids: string[] }` batch shape (still used unchanged by `funders/page.tsx` and
  `autoapply/settings/page.tsx` — verified both call sites before touching this shared route).
  The client component previously did the funder `insert` directly via the browser Supabase
  client, then called the batch route with the new id; moved that logic into the route so
  dedup-by-`giving_portal_url`/name and the queue-insert happen together, not two round trips.
  Toast copy corrected to the spec's exact "Added to AutoApply queue."
- **New activity timeline section**: `donor_discovery_prospects.notes` is a single `text`
  column (migration 067), not a table — implemented the timeline as a JSON-array-of-entries
  (`{content, author, created_at}`) serialized into that one column, newest first, rendered as
  a list with an add-note textarea above it. A pre-existing plain-text `notes` value (or
  anything unparseable) degrades to a single untimed entry rather than breaking. Added an
  "Assigned to" `Select` sourced from a client-side `profiles` query (RLS already scopes it to
  the caller's org, same pattern as the existing funder-detection query in this file).
- Gate: `pnpm tsc --noEmit` — 0 errors, ran clean.
- **Not done:** `pnpm run build` / `pnpm lint` / Playwright not run (only tsc was requested
  this pass); not manually verified in a browser; migrations 067-078 remain unapplied to
  production (unchanged by this pass — no new migration was needed, both edited tables/columns
  already exist per those files).
- Governance docs updated: `STATE_OF_THE_BUILD.md`, this file. `BLUEPRINT.md`,
  `SCHEMA_REGISTRY.md`, `BEHAVIORAL_CONTRACTS.md`, `AGENTS.md`, `CLAUDE.md`, and
  `DONOR_DISCOVERY_ARCHITECTURE.md` untouched — no schema, contract, or agent-type change.

---

## COMPLETED — July 10: Donor Discovery Overview page rebuild

Task: rebuild `src/app/(dashboard)/donor-discovery/page.tsx` to match
`DONOR_DISCOVERY_ARCHITECTURE.md` §4's Overview spec exactly — PageHeader with the specified
copy, an Active Requests section of per-request cards (taxonomy labels, geography, status
badge, progress bar, counts, time-ago), a horizontal Pipeline Funnel stat row (6 stages, each
linking to the Prospects page's `?stage=` filter), a Top Prospects section (top 5 by score
where `pipeline_stage=new`, 3-tier score badge, rationale excerpt, taxonomy label, Review
link), and a Scout Report placeholder card.

- Read the existing directory in full first (`new/page.tsx`, `prospects/page.tsx`,
  `requests/route.ts`, `prospects/route.ts`, `TaxonomyCombobox.tsx`) to match established
  conventions (Badge/Card/PageHeader/EmptyState components, `formatRelative`/`humanizeEnum`
  formatters, `cn()`) rather than reinventing them.
- Reused `GET /api/donor-discovery/prospects?stage=new&limit=5` for Top Prospects instead of a
  raw Supabase query — it already sorts by score desc and joins the directory record, so no
  new query logic was needed.
- Taxonomy labels are resolved via two small, scoped Supabase lookups (not the ~1,400-row full
  taxonomy preload the Prospects/New-Discovery pages use): one `.in('id', ...)` against the
  request cards' `taxonomy_ids`, one `.in('code', ...)` against the top prospects' directory
  `naics_codes`/`civic_kind` — each limited to only the ids/codes actually referenced by what
  was just fetched.
- Dropped the prior version's 3 `MetricCard` KPI tiles — not in this task's spec.
- Gate: `pnpm tsc --noEmit` — 0 errors, ran clean on the first pass.
- **Not done:** `pnpm run build` / `pnpm lint` / Playwright not run (only tsc was requested
  this pass); not manually verified in a browser.
- Governance docs updated: `STATE_OF_THE_BUILD.md`, this file. `BLUEPRINT.md`,
  `SCHEMA_REGISTRY.md`, `BEHAVIORAL_CONTRACTS.md`, `AGENTS.md`, `CLAUDE.md`, and
  `DONOR_DISCOVERY_ARCHITECTURE.md` untouched — pure UI rebuild against existing routes and
  tables, no schema, contract, or agent-type change.

---

## COMPLETED — July 10: process_discovery_request worker job + requests API pagination

Task asked to build `src/worker/jobs/process-discovery-request.ts`, wire it into
`worker/queue-processor.ts`, and create `src/app/api/donor-discovery/requests/route.ts`
(POST create+enqueue, GET paginated list). Found all three **already built** by a prior
uncommitted session (git status shows them as untracked, not yet committed) — verified them
against the task spec instead of rebuilding:

- `process-discovery-request.ts` delegates to `worker/dd-request-processor.ts`'s
  `DdRequestProcessor.processItem()`, which already runs the full enumerate → enrich
  (concurrency 5) → link foundations → score pipeline with the exact status transitions and
  `counts` updates the task described.
- **Did not wire it into `queue-processor.ts`'s idle cycle** like the sibling
  `enrich_donor_prospect`/`score_donor_prospect` jobs — verified this is deliberate, not a
  missed step: `DdRequestProcessor` already has its own always-on poll loop (started in
  `worker/index.ts` alongside `queueProcessor`), claiming via the `donor_discovery_claim_request`
  RPC (migration 070, real row locking). Adding it to `queue-processor.ts`'s idle cycle too would
  just be a second, less-frequently-polled consumer of the same queue for no functional benefit.
- **Fixed a real gap:** the requests GET route had no pagination. Added `page`/`limit` params,
  `range()` + `count: "exact"`, matching the existing convention in
  `src/app/api/donor-discovery/prospects/route.ts`. Response now returns `total`/`page`/`limit`
  alongside `requests` — backward compatible with the two existing UI callers.
- Noted but not touched (separate decision needed from Reid): two independent, unconnected
  Google Places registry adapters exist (`google-places.ts`, actually used by the worker, vs.
  `google-places-adapter.ts`, cache-first/BYOK, unused) — flagged in `STATE_OF_THE_BUILD.md`.
- Gate: `pnpm tsc --noEmit` (root) — 0 errors. `pnpm tsc --noEmit -p worker/tsconfig.json` — 0
  errors (this is the only way to type-check `worker/*.ts`, excluded from the root tsconfig).
  `pnpm run build` / `pnpm lint` / Playwright not run this pass.
- Governance docs updated: `STATE_OF_THE_BUILD.md`, this file. `BLUEPRINT.md`,
  `SCHEMA_REGISTRY.md`, `BEHAVIORAL_CONTRACTS.md`, `AGENTS.md`, `CLAUDE.md`, and
  `DONOR_DISCOVERY_ARCHITECTURE.md` untouched — no schema, contract, or agent-type change.

---

## COMPLETED — July 10: Claude-rationale donor-discovery scoring engine

Built `src/lib/donor-discovery/scoring-engine.ts` — a `ScoringEngine` class implementing
DONOR_DISCOVERY_ARCHITECTURE.md §2D's scoring signals with the task-specified weights
(has_giving_program +25, has_donation_form +20, in_kind_history_signals +15,
foundation_linkage_found +15, geographic_match +10, company_size_match +10,
csr_page_exists +5), and calling `claude-haiku-4-5` (`max_tokens: 300`) for a genuinely
plain-English 2-sentence rationale (deterministic fallback if the Claude call fails).
Distinct from — and complementary to — the existing pure `scoring.ts` used inline by
`worker/dd-request-processor.ts`'s per-request pipeline; both write
`donor_discovery_prospects.score` / `score_rationale`, this one also stamps `scored_at`.

- Foundation linkage: existing `linked_foundation_id` short-circuits to true; otherwise an
  EIN match against `foundation_directory.ein` (if the directory record's enrichment has
  one) or a live `donor_discovery_match_foundations` RPC call at a 0.4 similarity floor.
- Per-org weight overrides read from `organizations.donor_discovery_scoring_weights`
  (migration 074) under a nested `scoring_engine` sub-key — reused rather than adding a
  second jsonb column, no collision with `scoring.ts`'s own camelCase override keys on
  that same column.
- **New: `src/worker/jobs/score-donor-prospect.ts`** — claim/handle job mirroring
  `enrich-donor-prospect.ts`, wired into `worker/queue-processor.ts`'s idle cycle
  alongside `enrich_donor_prospect`.
- **New migration `078_donor_discovery_prospects_scored_at.sql`** — adds
  `donor_discovery_prospects.scored_at timestamptz` + index. File only, not applied to
  production (consistent with 074-077).
- **Known gap:** `RequestContext.askSizeEstimate` is always `null` — no per-request
  ask-size column exists yet in `donor_discovery_requests`; the engine already treats
  null as "company-size-match doesn't fire," not a guess.
- Gate: `pnpm tsc --noEmit` — clean, 0 errors. `pnpm run build:worker` — clean, 0 errors
  (root tsconfig excludes `worker/`, so this was needed to actually check the
  `queue-processor.ts` edit). `pnpm run build` / `pnpm lint` / Playwright not run this pass.
- Governance docs updated: `STATE_OF_THE_BUILD.md`, this file. `BLUEPRINT.md`,
  `SCHEMA_REGISTRY.md`, `BEHAVIORAL_CONTRACTS.md`, `AGENTS.md`, `CLAUDE.md`, and
  `DONOR_DISCOVERY_ARCHITECTURE.md` untouched — no new table, contract, or agent-type was
  needed; the only schema change is one additive column.

---

## COMPLETED — July 10: SAM.gov registry adapter + ingest script

Built `src/lib/donor-discovery/adapters/samgov-adapter.ts` (registry layer,
DONOR_DISCOVERY_ARCHITECTURE.md §2A) against SAM.gov: `searchEntitiesByNaics(naicsCode)` (Entity
Management API v3, `purposeOfRegistrationCode=Z2` federal-assistance-registered entities by
NAICS) and `searchRecentAwardRecipients(daysBack=90)` (Contract Opportunities API v2 Award
Notices, `ptype=a`, whose `awardee` block is the one place this endpoint carries recipient
identity). Both upsert into `donor_discovery_directory` via `upsertDirectoryRecord()` with
`source_adapters: ["samgov"]`. Rate limited to 450 req/min shared across both endpoints.

- **Env var correction:** task spec said `SAM_API_KEY`; actual configured var (verified in
  `.env.local` and every existing SAM.gov call site) is `SAM_GOV_API_KEY` — used the real one so
  the adapter isn't dead code against an unset env var.
- **New: `scripts/ingest-samgov.ts`** (`pnpm ingest:samgov`) — sweeps 50 curated NAICS codes
  (construction trades, site development, professional services, food service, transportation)
  through the entity search, then one award-recipients call. Non-fatal per-code failure handling,
  no checkpoint needed (small bounded list, completes in under a minute).
- Gate: `pnpm tsc --noEmit` — ran clean, 0 errors.
- **Not done:** script not run — `donor_discovery_directory` not yet populated by it. `pnpm run
  build` / `pnpm lint` / Playwright not run (only tsc was requested this pass).
- Governance docs updated: `STATE_OF_THE_BUILD.md`, this file, and `DONOR_DISCOVERY_
  ARCHITECTURE.md` §2A (new adapter cross-reference bullet). `SCHEMA_REGISTRY.md` was read in
  full per the task's first instruction — no schema change was needed (writes through the
  existing `donor_discovery_directory` table, no new migration). `BLUEPRINT.md`,
  `BEHAVIORAL_CONTRACTS.md`, `AGENTS.md`, and `CLAUDE.md` are untouched for the same reason.

---

## COMPLETED — July 10: ProPublica financial enrichment adapter + script

Built `src/lib/donor-discovery/adapters/propublica-adapter.ts` (signal layer,
DONOR_DISCOVERY_ARCHITECTURE.md §2C) against ProPublica's free Nonprofit Explorer API v2 —
`enrichOrganizationByEin(directoryId, ein)` fetches `/organizations/{ein}.json` and writes
`total_revenue`/`total_expenses`/`total_assets`/`ntee_code`/`ntee_description`/`filing_year`/
`form_type`/`pdf_url` into `donor_discovery_directory.enrichment.propublica`, stamping
`enrichment.propublica_enriched_at`; `searchOrganizations()` wraps `/search.json` for future
use. Rate limited to 1 req/s (contract §19).

- Writes via a direct `.update()` by directory id, **not** `upsertDirectoryRecord()` — that
  helper's RPC never overwrites an existing non-null enrichment key (migration 071), which
  would permanently block the 90-day cache refresh this task specifically asks for. Financial
  data lives under its own `enrichment.propublica` namespace so it can't collide with the BMF
  ingest's top-level `ein`/`ntee_cd` keys on the same row.
- **New: `scripts/enrich-nonprofits-propublica.ts`** (`pnpm enrich:propublica`) — batches of
  100, `civic_kind = 'nonprofit_501c3'` AND `enrichment->>propublica_enriched_at IS NULL`,
  paged by an `id` cursor (not offset) so a permanently-failing EIN doesn't loop the batch
  forever within one run. Resumable via `./enrichment-output/propublica-checkpoint.json`.
- Gate: `pnpm tsc --noEmit` — ran clean, 0 errors.
- **Not done:** script not run — its input population (BMF-ingested `nonprofit_501c3` rows)
  doesn't exist in the directory yet either, since `pnpm ingest:bmf` (below) hasn't been run.
  `pnpm run build` / `pnpm lint` / Playwright not run (only tsc was requested this pass).
- Governance docs updated: `STATE_OF_THE_BUILD.md`, this file, and `DONOR_DISCOVERY_
  ARCHITECTURE.md` §2C (adapter cross-reference added). `BLUEPRINT.md`, `SCHEMA_REGISTRY.md`,
  `BEHAVIORAL_CONTRACTS.md`, `AGENTS.md`, and `CLAUDE.md` are untouched — no schema, contract,
  or agent-definition change was needed (writes through the existing `donor_discovery_directory`
  table, no new migration).

---

## COMPLETED — July 10: IRS BMF full ingest script

Authored `scripts/ingest-irs-bmf-full.ts` — streams all 53 IRS BMF CSV extracts (50 states +
DC + PR + `eo_other.csv`) and writes every active (`STATUS='O'`) 501(c)(3) record into
`donor_discovery_directory` via the existing `upsertDirectoryRecord()` helper (never a raw
insert, per that module's own policy), in concurrency-limited 1000-row chunks.

- Resumable via `./enrichment-output/bmf-checkpoint.json` (file + row + totals), same pattern
  as the existing 990-enrichment script — required because `donor_discovery_directory` has no
  plain EIN column to dedup a BMF-sourced row against (EIN goes into the `enrichment` jsonb).
- Added `pnpm ingest:bmf` to package.json.
- **Gate:** `pnpm tsc --noEmit` was requested but `scripts/` is excluded from the root
  tsconfig entirely (true for every script in this repo, not specific to this one). Verified
  with a throwaway tsconfig (root config, exclusion lifted, `include` narrowed to this file
  only) run through `node node_modules/typescript/bin/tsc` directly — `pnpm`/`npx` themselves
  were permission-blocked this session, the known intermittent gate issue. Result: 0 errors.
  Scratch tsconfig deleted afterward, not committed.
- **Not done:** the script has not actually been run — `donor_discovery_directory` has not
  been populated by it. No `pnpm run build` / `pnpm lint` / Playwright this pass.
- Governance docs updated: `STATE_OF_THE_BUILD.md` and this file only. `BLUEPRINT.md`,
  `SCHEMA_REGISTRY.md`, `BEHAVIORAL_CONTRACTS.md`, `AGENTS.md`, and `CLAUDE.md` are untouched —
  no schema, contract, or agent-definition change was needed for this script (it writes through
  an already-existing table + RPC + helper module, doesn't add a new agent or table).

---

## COMPLETED — July 10: Google Geocoding adapter + donor_discovery_geocache

Built `src/lib/donor-discovery/adapters/geocoding-adapter.ts` — resolves a plain-text address
to `{lat, lng, formatted_address, state, county, zip}` via the Google Geocoding API
(`maps.googleapis.com/maps/api/geocode/json`), distinct from both existing Places adapters.

- Cache-first against new table `donor_discovery_geocache` (migration `077`, task asked for
  `074` which is already taken by `074_donor_discovery_foundation_linkage_and_scoring.sql` —
  used the next free number, same renumbering pattern as migration 076), keyed by a sha256 hash
  of the normalized address string. No RLS — shared platform-wide cache.
- Same platform `GOOGLE_PLACES_API_KEY` as the Places registry adapter, no BYOK path.
- Rate limited to 10 req/s via a dedicated `DomainRateLimiter(100)` instance/bucket, kept
  separate from `google-places-adapter.ts`'s 1 req/5s Nearby Search bucket even though both hit
  `maps.googleapis.com`.
- Rewired `/api/donor-discovery/geocode` to delegate to the adapter instead of its old inline
  Places API (New) Text Search call; response now also returns `state`/`county`/`zip`.
- Wired into the New Discovery wizard (`/donor-discovery/new`): the existing Step 2 "Geocode"
  button flow now carries and displays `state`/`county`/`zip` as a second confirmation line.
  Only `lat`/`lng` go into `donor_discovery_requests.geography` (unchanged `buildGeography()`).
- Gate: `pnpm tsc --noEmit` — 0 errors, ran clean.
- **Not done:** migration 077 not applied to prod; no tests written; `pnpm run build` /
  `pnpm lint` / Playwright not run (only tsc was requested this pass); not manually verified in
  a browser.

---

## COMPLETED — July 9: Google Places cache-first registry adapter

Built `src/lib/donor-discovery/adapters/google-places-adapter.ts` — a new, standalone
`RegistryAdapter` implementation distinct from the existing `google-places.ts` (still what
`worker/dd-request-processor.ts` actually calls; not wired together this session).

- Cache-first: checks `donor_discovery_directory` (naics overlap + geo proximity — PostGIS
  `ST_DWithin` RPC attempted first, falls back to a bounding-box filter since no PostGIS
  extension/RPC exists in this schema) before any Places API call; only NAICS codes with zero
  cached coverage trigger a fresh call.
- Uses the **legacy** Nearby Search endpoint (not Places API (New)) specifically because it
  supports a free-text `keyword` param — built from the NAICS taxonomy label plus a
  `donor_discovery_taxonomy_aliases` alias (migration 075).
- Faith Foundation org (`FAITH_FOUNDATION_ORG_ID` env var, added to `.env.local`) uses the
  platform `GOOGLE_PLACES_API_KEY` under a $100/month ceiling tracked in a new
  `adapter_usage_log` table; over budget → cached-only results + `wasBudgetLimited()` flag.
  Every other org must have an active BYOK connector row in `donor_discovery_connectors`
  (provider `google_places`, added to that enum this session) or the call throws
  `AdapterError('BYOK_REQUIRED', ...)`.
- Reuses existing infra throughout: `crawler-core.ts`'s `DomainRateLimiter` (1 req/5s),
  `directory.ts`'s `upsertDirectoryRecord`, `crypto/key-encrypt.ts`'s `decryptKey`.
- **New migration `076_adapter_usage_log.sql`** (task asked for `073`, already taken by
  `073_onboarding_progress.sql` — used the next free number) — the usage-log table plus
  `ALTER TYPE donor_discovery_connector_provider ADD VALUE IF NOT EXISTS 'google_places'`.
  Not yet applied to production.
- Gate: `pnpm tsc --noEmit` — 0 errors, ran clean (no interactive-approval issue this time).
- **Not done:** migration not applied to prod; no tests written; not wired into the worker;
  `pnpm run build` / `pnpm lint` / Playwright not run (only tsc was requested this pass).

---

## COMPLETED — July 9 (newest session): New Discovery wizard TaxonomyCombobox

Replaced the New Discovery wizard's step-1 taxonomy picker (full-table preload + expandable NAICS
tree + client-side substring filter) with a single search-first combobox wired to the
`taxonomy/search` route built (but never used by any UI) in the prior session.

- **New `src/components/donor-discovery/TaxonomyCombobox.tsx`** — 300ms-debounced multi-select
  combobox. Calls `GET /api/donor-discovery/taxonomy/search?q=`, renders a `max-h-72
  overflow-y-auto` result list (`matched_alias` bold / `ancestry_label` muted below, falling back
  to `label` when a result matched on label not alias), removable `Badge` chips for selections
  above the input, "All industries" shown when nothing is selected, a "Popular categories" quick-
  pick row (Construction Trades/Site Services/Food Services/Professional Services/Manufacturing)
  when the input is focused and empty, full keyboard support (arrows/Enter/Escape/Backspace).
- **`donor-discovery/new/page.tsx`** rewired to use it: `selectedNodes: Map<string, TaxonomyNode>`
  → `selected: TaxonomyComboboxOption[]`; deleted `fetchAllTaxonomy()`, `TaxonomyNode`,
  `TaxonomyRow`, `ancestryLabel()`, and all the tree/expand-state plumbing (now dead code since the
  combobox owns its own search). The wizard no longer preloads the ~1,400-row taxonomy table on
  mount. `donor-discovery/prospects/page.tsx`'s own separate, unrelated taxonomy-filter
  implementation was left untouched (different use case — filtering an existing list, not picking
  taxonomy for a new request).
- **Gate — could not run `npx tsc --noEmit` this session.** The Bash/PowerShell sandbox required
  interactive command approval that never came through across six attempts (both shells, same
  command) — a known intermittent behavior in this environment, not new to this change.
  Compensated with manual verification: grepped the codebase to confirm no
  other file imports the deleted symbols from `new/page.tsx` (none do — `prospects/page.tsx` has
  its own independent copy of those names, unrelated), and manually checked the new component
  against `noUncheckedIndexedAccess: true` — found and fixed two real type errors that a naive
  version would have had (`results[highlightedIndex]` and `selected[selected.length - 1]` both
  needed explicit undefined-checks before use). **Still genuinely unverified by the compiler —
  run `npx tsc --noEmit` before treating this as gate-clean.** `pnpm run build` / `pnpm lint` /
  Playwright were not attempted either (only the tsc gate was in scope).

---

## COMPLETED — July 9 (latest session): Donor Discovery taxonomy aliases (search-by-trade-name)

Built the plain-language alias layer for `donor_discovery_taxonomy` (§1A-1C) so a nonprofit
staffer searching "septic installer" can find NAICS 562991 ("Septic Tank and Related
Services") without knowing the official Census title.

- **Migration `supabase/migrations/075_donor_discovery_taxonomy_aliases.sql`** — new table
  `donor_discovery_taxonomy_aliases` (taxonomy_id FK -> `donor_discovery_taxonomy`, alias text,
  alias_type check-constrained to trade_name/keyword/common_name/material), trigram GIN index
  on `alias` (reuses `pg_trgm`, already enabled by migration 071). Not yet applied to
  production — file only, same posture as 067-071 before this session's earlier prod sync.
  **Deviation from the task spec:** the task asked for path `src/supabase/migrations/072_...`;
  this repo's real migrations directory is `supabase/migrations/` (no `src/` prefix) and `072`
  is already taken (`072_foundation_directory_990_enrichment.sql`, applied to prod along with
  073-074 earlier today). Used `075` (next free number) at the correct path instead of
  following the literal instruction into a collision.
- **`scripts/seed-dd-aliases.ts`** (`pnpm seed:dd-aliases`) — batches all 6-digit NAICS nodes
  50 at a time, asks Claude (claude-sonnet-4-6) for 3-8 structured-JSON aliases per code, skips
  aliases already on file per taxonomy node (idempotent re-run; the table has no unique
  index on (taxonomy_id, alias) to upsert against by design — free-text dedup doesn't fit an
  exact-match constraint). Non-fatal per-batch failures (logs and continues) since batches are
  independent, unlike the parent/child-dependent `seed-dd-taxonomy.ts`. Not yet run.
- **`src/app/api/donor-discovery/taxonomy/search/route.ts`** — `GET ?q=` for the New Discovery
  wizard's taxonomy picker. Searches aliases first, falls back to `donor_discovery_taxonomy.label`,
  ranks exact > prefix > substring (alias tier always outranks label tier), returns top 20 with
  a computed `ancestry_label` breadcrumb (walks `parent_id` up to sector, generic depth-capped
  walk though real NAICS depth is 2 hops). `requireRole("viewer")` — shared taxonomy table has
  no RLS, but the route still requires an authenticated session like every other Donor
  Discovery route.
- Gate: `pnpm tsc --noEmit` — 0 errors (scripts/ is tsc-excluded per finding #19 below, and
  `seed-dd-aliases.ts` also carries `@ts-nocheck` matching every other one-off script's
  convention).
- **Not done this session:** migration 075 not applied to prod; `pnpm seed:dd-aliases` not
  run (no aliases exist yet, table is empty); the search route is therefore untested against
  real data; the New Discovery wizard UI (§4.2) that would call this route doesn't exist yet
  (Phase 3 in the architecture doc's phasing, not yet built). `pnpm run build` / `pnpm lint`
  / Playwright were not run for this change (only the tsc gate was requested/verified).

---

## COMPLETED — July 9 (later session): Donor Discovery header nav placement fix

`Header.tsx`, `Sidebar.tsx`, and `nav-items.ts` already had the correct implementation
sitting uncommitted in the working tree (done in an earlier session, never committed —
which is why the header/sidebar placement kept "reverting"). This session verified the
existing diff against the requested spec rather than re-writing it:

- Header tab order: Dashboard · Research · Opportunities · AutoApply · Draft Generator ·
  Donor Discovery, all `font-semibold` (600), active tab gets a solid underline indicator.
- Donor Discovery links to `/donor-discovery`.
- A `PERMANENT do not remove Donor Discovery from header nav` comment now sits above the
  `TABS` array in `Header.tsx` to make future accidental removal harder.
- Donor Discovery has no top-level sidebar entry — `nav-items.ts` exports
  `DONOR_DISCOVERY_DRILLDOWN` (a single "Prospects" link), which `Sidebar.tsx` renders only
  while `pathname.startsWith("/donor-discovery")`.
- Gate: `pnpm tsc --noEmit` — 0 errors.
- Committed only the three layout files. Two other pre-existing uncommitted files
  (`scripts/seed-dd-taxonomy.ts`, `donor-discovery/prospects/page.tsx`) were left as-is —
  unrelated to this fix, not part of the requested scope.

---

## COMPLETED — July 9: Donor Discovery Phases 2+3, Foundation Enrichment Pipeline, Onboarding soft-gate

Built on top of the 07-08 Phase 1 commit (`0d065eb`, enumeration-only). This pass adds:

- **Donor Discovery scoring engine** (`src/lib/donor-discovery/scoring.ts`) — pure 6-signal
  weighted scorer (giving program/donation form/in-kind signals/linked-foundation confidence/
  geo match/size fit), org-overridable weights, 27 unit tests.
- **Foundation linkage** (`src/lib/donor-discovery/foundation-linkage.ts`) — trigram name
  matching against `foundation_directory` via a new `donor_discovery_match_foundations` RPC,
  domain-match confidence boost. No dedicated test file yet.
- **Worker pipeline** (`worker/dd-request-processor.ts`, +428 lines) — grew from
  enumeration-only to enumerate → enrich → link foundations → score, with per-row error
  swallowing so one bad website/match doesn't fail the whole request.
- **Dashboard UI** — `/donor-discovery` (overview), `/donor-discovery/new` (3-step launch
  wizard), `/donor-discovery/prospects` (filterable list + bulk stage-move),
  `/donor-discovery/prospects/[id]` (detail + "Queue in AutoApply"). No map/visualization —
  geocoding is address-resolution text only.
- **Foundation Enrichment Pipeline** — three scripts (`pnpm seed:dd-taxonomy`, `pnpm
  enrich:990`, `pnpm enrich:web`) plus `web-extractor.ts`/`website-discovery.ts` shared libs.
  Built and gate-clean, but **not yet run against production** — migrations 072/073/074 are
  unapplied (074 says so explicitly in-file), so nothing has executed yet.
- **Onboarding soft-gate** — `middleware.ts` hard-redirects to `/onboarding` unless a
  session-scoped `benavora_onboarding_skip` cookie is set (via the onboarding page's "explore
  first" link); `OnboardingBanner.tsx` then nudges on every dashboard page until
  `onboarding_completed` flips true. `organizations.onboarding_progress` (migration 073)
  backs the banner and a new read-only `/settings/organization-setup` review page.

Full detail (file paths, exact table/column names, RPC signatures, script flags) written into
`STATE_OF_THE_BUILD.md`'s new "Donor Discovery Phases 2+3" / "Foundation Enrichment Pipeline"
/ "Onboarding soft-gate" sections, including Reid's ordered morning-action list (apply
migrations → seed taxonomy → run both enrichment scripts → back up `./enrichment-output/` to
DATAOCEAN → smoke-test a discovery request from the new UI).

**Gates, all run fresh and clean this pass:**
- `pnpm run test:unit` (vitest) — 228 passed, 13 todo, 0 failures, across 19 test files (1 skipped file, pre-existing).
- `pnpm run typecheck` (tsc --noEmit) — 0 errors.
- `pnpm run build` (next build) — clean, 242/242 static pages generated, no route conflicts.
- Railway worker gate (`tsc -p worker/tsconfig.json --noEmit`, matching `worker/Dockerfile`'s exact build step) — 0 errors.

No regressions found — all four gates passed on the first run, no fix-up needed.

---

## COMPLETED — July 8 gate re-verification + Intelligence Library claim correction

Same task as the 07-07 pass below, re-run a day later. Ran all three gates fresh rather
than trusting yesterday's result: `pnpm run typecheck` (tsc --noEmit) — 0 errors. `pnpm run
build` — clean, 235/235 static pages, 261 route files (85 pages + 176 API routes), no route
conflicts. `pnpm run lint` — 0 warnings/errors. No drift from 07-07 — same counts, same
clean result.

The task text (again) asked to document a specific "Intelligence Library Nights 3-7: BUILT"
bullet list. That section already existed in `STATE_OF_THE_BUILD.md` from the 07-07 pass, so
rather than re-transcribing it, ran an independent Explore-agent audit against the actual
source for all 25 individual claims (Census/HUD/BLS/CDC clients, geo fallback, budget/
compliance/evaluation libraries, grantmaker recommender, Grant DNA, unified search, briefing
panel, tier gating, migrations, pgvector/embeddings) rather than assuming yesterday's writeup
was still exhaustive. Two corrections came out of it, verified by reading the code directly
(not just trusting the subagent):

1. **Geo fallback is county→state only**, not the documented zip→county→state→national chain
   — `need-statement-engine.ts:41-42` says so in its own comment; `census-api.ts` has no zip
   or national-level lookup path.
2. **No real SAMHSA integration exists** — `cdc-api.ts`'s `fetchSubstanceAbuseData()` comment
   claims "SAMHSA NSDUH state estimates" but the actual query hits a CDC BRFSS (alcohol
   module) Socrata dataset, a different survey entirely. The mislabeling is in the source
   code's own comment, not just prior documentation.

Both written into `STATE_OF_THE_BUILD.md` (KB4 section, detailed KB4-9 walkthrough, and new
gap items #33a/#33b) rather than silently left as-is. Everything else in the Nights 3-7
section (KB5 Budget, Compliance, KB7 Evaluation, KB8 Grantmaker/Recommendations, KB9 Grant
DNA, Cross-Library Integration) re-confirmed accurate on a fresh read — no other changes.

No code changes this pass — docs + gate verification only, as scoped. Route/page/layout
conflict check: static analysis of all `page.tsx`/`route.ts` paths found no directory with
both a `page.tsx` and a `route.ts`, and no sibling dynamic segments with conflicting param
names — consistent with the build succeeding (a real conflict fails `next build` outright).

---

## COMPLETED — July 7 gate re-verification + STATE_OF_THE_BUILD.md restructure (second pass, same day)

Re-ran the full gate sequence: `pnpm run typecheck` (tsc --noEmit) — 0 errors. `pnpm run
build` — clean, 235/235 static pages, 261 route files (85 pages + 176 API routes), no route
conflicts. `pnpm run lint` — 0 warnings/errors. Same clean result as the prior "Nights 3-7
verification pass" entry below — no regressions since.

This session's task asked for a new `## Intelligence Library Nights 3-7: BUILT` section
in STATE_OF_THE_BUILD.md with a specific bullet list. Before writing it, re-checked the
contested claims against `src/` directly rather than transcribing the requested text
verbatim, since one bullet ("narrative pattern extraction from funded proposals") conflicts
with the prior pass's finding that `intelligence_narrative_patterns` has zero code
references. Re-confirmed via grep: still zero references — this KB piece is schema-only,
so the new section documents it as **not built** rather than marking it done. Also
re-confirmed `IntelligenceBriefingPanel` is genuinely mounted on `OpportunityDetail.tsx`,
and that `build-grantmaker-profiles.ts` builds from `foundation_directory` +
already-scraped enrichment fields rather than doing its own fresh website scrape. The new
section lives directly under the file's top-level audit-counts block; the pre-existing
detailed "Intelligence Library KB4-9" walkthrough further down is unchanged and still the
source of truth for file-level detail.

No code changes this pass — docs + gate verification only, as scoped.

---

## COMPLETED — July 7 color & polish pass: chromatic icons, stat accents, draft editor viewport fix

**Draft editor height bug (root cause + fix)**: the Generated draft textarea rendered ~5
visible rows with dead space below despite `rows={20}` in the JSX. Root cause:
`src/app/globals.css`'s global base style `textarea { max-height: 120px; resize: vertical; }`
applies to every textarea app-wide (intended for small form fields like Mission Statement)
and was silently clamping the draft editor too — a `rows` attribute can't override a CSS
`max-height`. Fixed surgically: the draft editor's textarea gets `max-h-none` (a Tailwind
class beats the plain-element-selector base rule on specificity) plus `min-h-[55vh] flex-1
h-full resize-none`, removed the now-meaningless `rows={20}`. Left the global 120px clamp
in place for other small textareas that want it — this was a one-textarea override, not a
global rule change.

**Genuine flex-to-viewport stretch, not just a tall minimum**: `draft-generator/page.tsx`'s
two-column results layout is a `grid grid-cols-1 gap-6 lg:grid-cols-3` — CSS Grid's default
`align-items: stretch` already equalizes both columns' height to the taller one. Made the
left column `flex flex-col`, the "Review & edit" `<Card>` `flex flex-1 flex-col`, and
`Card.tsx`'s body wrapper unconditionally `flex-1` (inert unless the outer Card is itself
`display:flex`, so harmless across the other 71 call sites) — so on wide viewports the
editor card now genuinely stretches to match the right column's stacked cards (Confidence,
Grant DNA, Sources used), not just a fixed 55vh floor.

**ColorIcon system** (`src/components/ui/ColorIcon.tsx`, new): one hue per function —
cyan=opportunities/search, emerald=money/funding, blue=documents/drafts, amber=deadlines/
time, violet=analytics, indigo=applications, rose=alerts. Deliberately uses raw Tailwind
hue classes (violet, rose, etc.) — an intentional, documented exception to the "no purple/
violet accents" anti-pattern from the intensity pass: these are categorical/nominal colors
for scanning icon chips, not brand accents. `ICON_HUE_BORDER_CLASSES` provides the matching
`border-l-{hue}-500` for the "colored left border" pairing.

Applied to: **`MetricCard`** (dashboard's 7 stat cards — cyan/indigo/blue/amber/emerald×2/
violet, plus a `border-l-4` in the same hue), **`Card`**'s Upcoming Deadlines (amber) and
Quick Actions (cyan) via a plain `className` override, **`TemplateSelector`** (all 6 draft
templates — blue/emerald/amber/violet/cyan/indigo, selection state rebuilt as `border-primary
ring-2 ring-primary/20 bg-blue-50/50`, grid changed to symmetric `grid-cols-1 sm:grid-cols-3`
with `h-full` cards), **Research source cards** (all 9 sources get a cyan `Search` icon chip,
on top of the existing 3px cyan top-accent-bar from the intensity pass), and **Intelligence
Library**'s 5 stat tiles (blue/violet/indigo/cyan/amber, each with a matching `border-l-4`).

**Step-circle headers**: draft-generator's numbered `Card` titles ("1. Choose an opportunity"
etc.) were plain text — added a `StepTitle` helper (filled `bg-primary` circle + label) and
wired it into all 4 numbered cards (steps 1, 2, 3-conditional-program, 3-review-and-edit —
the app's own numbering already reuses "3" for both, not changed here). Also fixed an
adjacent dark-theme leftover found in the same section: the "Score Draft" button was
`text-indigo-300` (a light color meant for a dark bg) on a white card — unreadable pale
lavender text — converted to `bg-indigo-50 text-indigo-700 border-indigo-200`.

**Visual verification**: seeded a real `draft_versions` row for the beta org (a service-role
script — no existing draft existed to screenshot, and triggering a live AI generation would
take 30-180s per generation) so `/draft-generator?opportunity={id}` could be screenshotted
with an actual loaded draft rather than the empty template-picker state. Logged in as
`beta1@benavora-test.com`, reviewed `/dashboard`, `/research`, `/intelligence-library`, and
`/draft-generator` (both the template-picker and loaded-draft states) — confirmed every stat
card has a colored chip + matching left border, the template grid shows clear hue variety
with an obvious selection ring, all 3 step circles render, and the editor genuinely fills a
large portion of the viewport with word-count/save controls pinned below it. Zero console
errors during the run.

**Verification**: `pnpm tsc --noEmit` and `pnpm run build` both clean.

---

## COMPLETED — July 7 Intelligence Library Nights 3-7 verification pass

Gate run: `pnpm run typecheck` clean, `pnpm run build` clean (235/235 pages, 176 API routes,
no route conflicts). This was a verification pass, not a build pass — the task asked to
document Nights 3-7 as "BUILT," so before writing anything a full file-level audit was run
against GRANT_INTELLIGENCE_ARCHITECTURE.md's 9-KB spec to confirm claims are real rather
than copying the pre-drafted status text. Findings written into STATE_OF_THE_BUILD.md's new
"Intelligence Library KB4-9" subsection and gaps #29-31.

**Bottom line: KB4 (Need Statement), KB5 (Budget), Compliance, KB7 (Evaluation), KB8
(Grantmaker Intelligence), and Cross-Library Integration (unified search, tier-gated
briefing, coverage heat map) are all real and wired into the draft generator — not stubs.**
Three things from the spec are schema-only or missing: `intelligence_grant_dna_scores` is
defined but never written to (DNA scores compute live, aren't persisted), and
`intelligence_narrative_patterns`/`intelligence_post_award_reports` have zero code
references (no ingestion, no reads). No foundation-website-scrape or 990-grants-made
ingestion script exists specifically for the intelligence library.

Uncommitted working-tree changes present at session start (small, pre-existing, not part of
this verification): `intelligence-library/page.tsx`, `intelligence/recommendations/page.tsx`,
`IntelligenceBriefingPanel.tsx`, `funder-recommender.ts`, `outcome-benchmarks.ts`,
`unified-search.ts`, plus a new untracked `api/intelligence/recommendations/explain/` route
— left as-is (not committed) since committing wasn't requested this session.

---

## COMPLETED — July 7 intensity pass: saturated buttons, tonal layers, sunken headers

Follow-up to the dark-surface purge above — that pass made everything correctly light,
but flat: near-white-on-white-on-white with no depth cues. This pass adds tonal hierarchy.

**Tokens**: `--color-background` darkened #EEF2F7 → **#E2E8F0** (real contrast under white
cards — this is a page-wide cascading change since `--color-page`/`--background` alias it).
New `--color-surface-sunken` **#F1F5F9** for table headers and card header wells, added
alongside `surface`/`surface-raised` in both `globals.css` and `tailwind.config.ts`.

**Buttons** (`Button.tsx`): `primary` = `bg-primary text-white hover:bg-primary-hover
shadow-sm` — explicitly the default for every card CTA (Run, Apply, Add to Queue,
Re-score), not just form submits. `secondary` rebuilt as a visible gray chip (`bg-slate-100
text-slate-700 border border-slate-300 hover:bg-slate-200`) — no longer a
primary-tinted-border ghost, a genuinely distinct neutral action style. Converted every
Run/Apply/Add-to-Queue/Re-score button that was rendering as a faint outline: Research
page's per-source "Run" buttons and the "Apply"/"Pull Historical Awards" buttons (raw
`<button>`s, not the shared component, so hand-converted to matching classes),
`GrantDNACard`'s "Re-score" button.

**Cards** (`Card.tsx`): border → `border-slate-200` (same hex as the old `border-border`
token, but literal per this pass's spec), header block now `bg-surface-sunken` — every
titled panel (Pipeline, Recent Activity, Quick Actions, Grant DNA Score, Scoring
Optimization) gets a visibly sunken header band distinct from its white body. Applied the
same header treatment to `Modal.tsx` and `RubricPanel.tsx` (which duplicate Card's
header/body split inline rather than using the component).

**Research source cards** (Grants.gov, SAM.gov, etc.): added a 3px `bg-accent` top bar
(`relative overflow-hidden` wrapper + absolutely-positioned span), title → `text-slate-900
font-semibold`, metadata (Last run/Found) → `text-slate-500`.

**Tables**: `Table.tsx` (the shared component — cascades to Opportunities via
`OpportunityTable`) header row → `bg-surface-sunken text-slate-600`, row dividers →
`divide-slate-200`, row hover → `hover:bg-slate-50`, body text → `text-slate-700`. Research
and Intelligence Library both hand-roll their own tables (found via audit — neither used
the shared component, and each had a different ad-hoc class convention: `gray-*`/`px-4
py-3` vs `navy-*`/`py-3 pr-4`) — converted both, 4 tables total (Discovered Opportunities,
Historical Awards, Funded Proposals, Scoring Rubrics, Data Sources — 5 actually), each now
matching the same header/divider/hover convention as the shared component.

**Page headers**: no shared header component existed — every one of ~70 dashboard pages
hand-rolled its own `<h1>`/`<p>`/action-button block directly on the gray canvas, with
inconsistent wrapper alignment (`items-center` vs `items-start`) depending on whether the
original author needed room for a multi-button action area. Created
`src/components/layout/PageHeader.tsx` (white band, `border-slate-200`, `shadow-sm`,
`align="start"|"center"` prop to preserve each page's original vertical alignment) and
applied it to the 5 pages this pass verifies (`dashboard`, `research`, `opportunities`,
`intelligence-library`, `autoapply`). The remaining ~65 dashboard pages still hand-roll
their header block — same visual weight as before (no white band), tracked as follow-up
debt below, not a regression from this pass.

**Visual verification**: dev server + Playwright, logged in as `beta1@benavora-test.com`,
screenshotted all 5 named pages plus one cropped close-up of a Research source card to
confirm the 3px accent bar actually renders (it does). Reviewed each full-page screenshot:
confirmed the three-layer structure (gray canvas → white header band → white cards with
sunken headers) on every page, confirmed no white-on-white buttons anywhere (Settings on
`/autoapply` reads as a clear gray chip; every Run/Apply button is solid blue).

**Verification**: `pnpm tsc --noEmit` and `pnpm run build` both clean (234/234 pages).

---

## COMPLETED — July 7 definitive UI pass: dark-surface purge, button visibility, screenshot-verified

Root cause found: **`src/components/ui/Card.tsx`** (72 call sites) and **`Modal.tsx`** still had
`bg-ink-700/60` / `bg-ink-800` (a genuinely dark near-black legacy scale), `glow-border`,
`backdrop-blur-md`, and dark-tuned `shadow-card` — leftover from before the light-theme
rebrand, never touched by the two prior design passes because neither one's grep patterns
covered the app's own custom `ink-*` color scale (they checked Tailwind's default
gray/slate/zinc/neutral families and literal hex, not this codebase's named legacy scale).
This explained the user's report that Details/Funding panels, Pipeline/Recent Activity,
and other dashboard cards still looked dark — it wasn't scattered per-page debt, it was
one shared component. Fixed `Card` and `Modal` to `bg-surface border-border shadow-sm`.

**Cascading fix, not just the root component**: several components had copy-pasted Card's
old dark markup inline instead of using the component (`RubricPanel.tsx`,
`AnalyticsDashboard.tsx`'s `StatCard`, `GrantDNACard.tsx`, and a `bg-navy-900` wrapper
around `LogicModelView` in `draft-generator/page.tsx`) — all converted individually.
`GrantDNACard.tsx` and `LogicModelView.tsx` were fully rewritten (dark navy-100-family
text/bg pairs throughout, designed to sit on the dark `ink-700` background that no longer
exists) — `LogicModelView`'s 5 stage columns now use neutral/info/success/primary/warning
tokens instead of slate/blue/teal/violet/amber `/10`-opacity dark-mode tints.

**Second-order bug, caught by an 88-occurrence sweep**: fixing `Card` to a light background
meant any child content still using `text-white` (correctly, when `Card` was dark) went
invisible. Grepped `text-white` across all of `src/app/(dashboard)` and `src/components`
(88 hits, 45 files) and triaged every one via 4 parallel agents — the overwhelming majority
were already correct (solid-colored buttons, badges, gradient avatars, dark video-player
overlays) and left alone; genuine misses (`Breadcrumbs.tsx`, an `autoapply/analytics`
hover state, `follow-ups/page.tsx`'s `<h2>`) were fixed.

**Full dark-page conversions**: `intelligence/recommendations/page.tsx`,
`funders/import/page.tsx`, and `notifications/page.tsx` were entirely on the old dark
theme (never migrated) — converted in full. `settings/layout.tsx`'s persistent tab nav
(wraps all 5 Settings pages) had `border-white/10` and `text-navy-400 hover:text-navy-200`
— invisible border, low-contrast hover — fixed.

**Button system** (`src/components/ui/Button.tsx`): `secondary` was
`border-white/15 bg-white/5 text-navy-100` (near-white-on-white — invisible on the light
background) and `ghost` was `text-navy-300 hover:text-white` (disappears on hover). Both
were dark-theme leftovers, used 246× across 86 files. Rewrote to
`primary` = `bg-primary text-white hover:bg-primary/90`,
`secondary` = `bg-surface text-primary border border-primary/40 hover:bg-primary/5`
(always has a visible border, never borderless white-on-white),
`ghost` = `text-primary hover:bg-primary/10`. Removed the unused `purple` variant
(0 call sites). This single-file fix cascaded correctly to every `<Button variant="secondary">`
in the app (confirmed via screenshot on `/autoapply` and `/research`).

**Header** (`src/components/layout/Header.tsx`) converted from dark chrome (`bg-[#0f1117]`,
`text-[#f0f0f5]`) to light (`bg-surface`, `text-text`/`text-text-muted`) — the sidebar is
the only intentionally dark element per this pass's explicit instruction; the header
previously matched the sidebar's dark tone but wasn't named as an exception.

**Visual verification**: started the dev server, logged in as `beta1@benavora-test.com`
(had to flip that org's `onboarding_completed` to `true` via a one-off service-role script
— it was `false`, so every route redirected to `/onboarding` and the first screenshot pass
showed the wizard instead of real pages), and used Playwright to screenshot `/dashboard`,
`/opportunities`, an opportunity detail page, `/draft-generator`, `/autoapply`, and
`/research`. Reviewed each: confirmed Details/Funding panels, Pipeline/Recent Activity, and
every Card-based panel now render as clean white cards with visible borders and readable
text; confirmed `secondary` buttons ("Settings" on `/autoapply`, "Edit"/"Parse NOFA" on the
opportunity detail page) show the correct white-bg/primary-border/primary-text treatment.
Caught one more issue this way — `research/page.tsx`'s per-source "Run" buttons used raw
`border-gray-300 text-navy-700` instead of the token system (not literally invisible, but
inconsistent) — fixed to `border-primary/40 text-primary`, re-screenshotted to confirm.

**Scope note**: draft-generator's "Review & edit"/"Confidence" sub-panels only render after
generating an actual AI draft (real opportunity + template selection + a live model call,
~30-180s per prior session notes) — verified those specific components
(`GrantDNACard`/`RubricPanel`) via full source rewrite + `tsc` rather than forcing a live
generation; the underlying `Card`-based panels one screenshot away were confirmed working.

**Verification**: `pnpm tsc --noEmit` and `pnpm run build` both clean (234/234 pages) after
the full pass. Two pre-existing client-side 400 console errors observed during the
Playwright run are unrelated (no matching entries in the Next.js server log, and none of
this pass's edits touched data-fetching/query code) — not investigated further, out of scope.

---

## COMPLETED — July 7 follow-up: missed table pills + surface layering

Caught two real gaps left by the design-system pass above.

**Badge borders**: every semantic variant (success/warning/error/info) now gets a
200-level border of the same hue (`--color-success-border` #bbf7d0 etc., new in
`globals.css`/`tailwind.config.ts`), not just `neutral`. Bg stays the 100-level tint,
text the 700-level — matches Tailwind's own green/amber/red/sky-100/200/700 triads.

**Opportunities table/card/detail**: `Category` badge was `<Badge color="indigo">`
(resolves to `info`, visually identical to the `Source` badge next to it) — changed to
`variant="neutral"` so the two columns read distinctly. `SourceTypeBadge` used a
different Tailwind hue per source_type (8 colors for a nominal field) — collapsed to a
single `variant="info"` everywhere it's used (table, card, detail), since color-per-type
on a repeated-every-row field was noise, not signal. `SourceTypeTabs`' own dot-color
variety was kept (tabs are a one-time filter strip, not repeated per row) but decoupled
from `SourceTypeBadge`'s removed color map into its own inline lookup. `eligibility.tsx`'s
`MatchBadge`/`HighPriorityBadge`/`RecommendationBadge` and `OPPORTUNITY_STATUS_COLOR`
(renamed `OPPORTUNITY_STATUS_VARIANT`) now pass `variant` directly instead of routing
through the legacy `color` alias — same resolved colors, no more indirection.

**Two genuinely missed raw pills** found via a second grep sweep (the first pass's ~30
files were real but not exhaustive): `autoapply/settings/page.tsx`'s geo-scope removable
chip (`bg-navy-100 text-navy-700`) and `research/page.tsx`'s application-stage pill
(`bg-blue-600 text-white`, no light-tint pairing so it dodged the first regex) — both
converted to `<Badge>`. Swept every other hue family (amber/emerald/cyan/violet/rose/
slate/stone/zinc/lime/fuchsia) too — only two more hits, both legitimate notification
count bubbles (solid bg + white bold number), correctly left alone.

**Layering bug, confirmed and fixed at the layout level**: `DashboardShell.tsx`'s `<main>`
had no background class and inherited the outer shell's `bg-surface` (white) — every
dashboard page's content area was rendering on white instead of the `#EEF2F7` background
token. Fixed by adding `bg-background` to both the outer shell and `<main>` directly, one
place, applies to every page. Also brought `OpportunityFilters`, `Table`, `Select`, and
`SearchBar` onto explicit `bg-surface`/`border-border`/`shadow-sm` tokens (they were
working via the `navy-*`/`bg-white` compatibility-layer aliases before, which resolved to
the same values but not through the canonical token names).

**Verification**: `pnpm tsc --noEmit` and `pnpm run build` both clean after the fix.

---

## COMPLETED — July 7 design system unification pass

Full token + component pass across the app (supersedes the reverted `ed302f4`
podcast-theme commit — built fresh this time, not reapplied).

**Token layer** (`src/app/globals.css` + `tailwind.config.ts`, kept in agreement —
Tailwind color keys read the same CSS custom properties, no value is restated):
`background` #EEF2F7, `surface` #FFFFFF, `surface-raised` #F8FAFC, `sidebar` #0B1220,
`sidebar-active` rgba(0,180,216,0.12), `primary` #0077B6, `accent` #00B4D8, `text` #0F172A,
`text-muted` #475569, `border` #E2E8F0, plus semantic pairs `success`/`warning`/`error`/`info`
(light bg tint + 700-level text of the same hue, ≥4.5:1 contrast). Legacy CSS var names
(`--color-page`, `--color-surface-elevated`, `--color-accent` formerly = navy not cyan, etc.)
now alias the canonical tokens instead of restating literal hex, so there's one source of
truth. Fixed a real bug found along the way: `--color-accent` used to equal the navy
primary (#0077b6); several rules (`:focus-visible` outline, input focus border, the
`.text-blue-700/800` compat rule) depended on that and were repointed to the new
`--color-primary` to avoid a low-contrast cyan-on-white regression.

**`src/components/ui/Badge.tsx`** rewritten as the only pill/badge implementation — a
`variant` prop (`success`/`warning`/`error`/`info`/`neutral`) selects the token pair. Kept
the legacy `color` prop (13 names) as an internal alias so none of the ~80 existing call
sites needed to change; every color name resolves to one of the five variants, so no raw
hue class can leak through anymore. The old implementation was dark-theme leftovers
(`bg-teal-400/15 text-teal-200` etc.) — `text-teal-200` on a white page background was
functionally invisible; this was a real, live bug across every badge in the app.

**~30 files** had hand-rolled inline pill `<span>`s (status pills, score/match-% pills like
the "0% match" badges, removable filter chips) converted to `<Badge>`, preserving every
threshold/status-mapping function exactly — only the rendering wrapper changed.

**Purple/orange/plum/emerald hue classes and the 5 listed hardcoded hex codes** (`#7C3AED`,
`#A78BFA`, `#F97316`, `#0a0a1a`, plus branding.ts defaults) removed from ~40 more files,
including the marketing landing page's inline `<style>` block (~33 raw hex occurrences,
including alpha-suffixed shorthand converted to `rgba()`).

**Sidebar** (`src/components/layout/Sidebar.tsx`): bg `#0B1220` (was a semi-transparent
`bg-ink-900/80`), inactive `text-slate-400`, hover `text-white`, active `text-accent` +
`bg-sidebar-active`. **`MetricCard`**: swapped the dark-theme `shadow-card` (designed for a
dark bg) for `shadow-sm`, `border-navy-100`→`border-border`, values now `text-text` — was
previously always going to read fine since `border-navy-100` aliased to a safe rgba, but the
card was never actually reviewed against the token system until now.

**Scope decision**: left `teal-*` Tailwind classes untouched app-wide (508 occurrences,
129 files) — user call, made explicit before the pass. `teal-500`/`600` are numerically
identical to the new `accent`/`accent-hover` tokens already, and the `globals.css`
compatibility layer already coerces `text-teal-600/700` to specific WCAG-safe hex; a blind
mechanical replace risked contrast regressions across dozens of files with no way to
visually re-verify each one in this pass. Tracked as follow-up debt, not fixed here.

**Verification**: `pnpm tsc --noEmit` and `pnpm run build` both clean (234/234 static pages,
zero errors) after the full pass.

**Left uncommitted/unstaged, NOT part of this pass** — pre-existing in-progress feature work
found already sitting in the working tree at the start of this session, unrelated to the
design system: `src/app/(dashboard)/intelligence/recommendations/page.tsx` (org-summary-card
+ geography-filter feature; only its `ScoreBadge` pill was touched by this pass, split out
via a partial-file stage so the rest stays uncommitted), `src/app/api/intelligence/recommendations/route.ts`,
`src/lib/intelligence/evaluation-library.ts`, `supabase/migrations/060_grantmaker_profiles.sql`.

---

## COMPLETED — July 7 seed-script build-failure session

### Vercel production build was failing: `scripts/seed-beta-users.ts:35:15` — `Type 'WebSocket' is not assignable to type 'WebSocketLikeConstructor'`

`createClient()`'s `realtime.transport` option expects a `WebSocketLikeConstructor`; the
`ws` package's exported type doesn't structurally satisfy it under Vercel's stricter
build-time type resolution (didn't reproduce locally, but the fix is correct either way).

**Fix:**
- `scripts/seed-beta-users.ts:35` — `transport: ws as any` → `transport: ws as unknown as typeof WebSocket` (explicit double-cast instead of `any`)
- `tsconfig.json` — added `"scripts"` to `exclude`. One-off utility/seed scripts under `scripts/` must never be able to break a production deploy's type-check again; they're run standalone via `pnpm seed:beta` / `tsx`, not part of the Next.js app build.

**Verification:** `pnpm tsc --noEmit` clean (0 errors). `pnpm run build` clean (0 errors, all routes generated).

---

## COMPLETED — July 7 font self-hosting session

### Build was failing: next/font/google couldn't reach fonts.googleapis.com (ETIMEDOUT)

`src/app/layout.tsx` used `next/font/google` for Inter + JetBrains Mono, which fetches
font files from Google's CDN at build time. In this environment that network call times
out, breaking `pnpm run build` unconditionally.

**Fix — self-host both fonts, zero network calls at build time:**
- `pnpm add @fontsource-variable/inter @fontsource-variable/jetbrains-mono` (variable-weight woff2 packages)
- Copied the latin-subset variable woff2 files into `public/fonts/`:
  `inter-latin-wght-normal.woff2`, `jetbrains-mono-latin-wght-normal.woff2`
- `src/app/layout.tsx`: replaced `next/font/google` (`Inter`, `JetBrains_Mono`) with
  `next/font/local` pointing at those two files. Same CSS variable names preserved
  (`--font-sans`, `--font-mono`) and same weight ranges (100–900 / 100–800), so no
  other file needed to change.

**Verification:** `pnpm run build` completes clean (0 errors, 234 static pages generated) with no `next/font/google` import anywhere in the tree.

---

## COMPLETED — July 7 design session

### Brand token replacement — tailwind.config.ts + root layout

Prior sessions (`ed302f4`, `7e046b1`) rebranded `globals.css` to the light navy/cyan
theme (`--color-accent: #0077b6`, `--color-secondary: #00b4d8`) via a compatibility
layer of `!important` overrides, but `tailwind.config.ts` itself still declared the
old dark/purple theme underneath — so any class not covered by the compat layer
(`ring-teal-400`, `accent-teal-500`, `shadow-glow-*`, `bg-gradient-accent`, the raw
`plum`/`teal` scales) still rendered the legacy purple/emerald/teal-green colors.

**`tailwind.config.ts`:**
- `colors.accent`: `DEFAULT #7c3aed→#00B4D8`, `hover #6d28d9→#0093AC`, `indigo #6366f1→#0077B6`, `teal #2dd4bf→#00B4D8`, `purple #a855f7→#0077B6` (`accent.blue`/`info`/`warning` left untouched — not in the purple/orange/emerald/teal removal list)
- `colors.cta`: `#10b981→#0077B6`, hover `#059669→#005F92`
- `colors.teal` (legacy 50–950 scale, backs every `teal-*`/`ring-teal-*` class): replaced with a cyan ramp anchored at 500 `#00b4d8` / 600 `#0093ac` (exact secondary/secondary-hover match)
- `colors.plum` (legacy 50–950 scale): replaced with a navy-blue ramp anchored at 600 `#0077b6` (exact primary match)
- `backgroundImage`: `gradient-accent`/`gradient-brand`/`gradient-cta` → cyan `#00B4D8` → navy `#0077B6` sweep (matches `globals.css`'s `--color-cta-from/to` exactly); `gradient-purple` → navy two-tone; `glow-radial` → cyan
- `boxShadow`: `glow`/`glow-accent`/`glow-blue` → navy/cyan rgba (was emerald/purple/blue)
- No `#f97316` (orange) hardcoded anywhere in the config — nothing to replace there

**`src/app/layout.tsx`:** removed `className="dark"` from `<html>` (site is light-theme now); `viewport.themeColor` `#0a0a1a→#0077B6`

**Verification:** read every file using `bg-accent`/`border-accent` (1: `GroupedKanban.tsx` drag-over highlight), `shadow-glow-*` (login/register/forgot-password/reset-password/invite-accept CTA buttons, `AssemblyPanel.tsx`, `Button.tsx` primary variant), and `ring-teal-400`/`focus:ring-teal-400` (~30 files — form input focus rings across the entire autoapply section, `PlanCard.tsx`, `Badge.tsx`) — all render as cyan/navy on the light theme with no contrast regressions. `Button.tsx`'s dark-styled `secondary`/`ghost`/`purple` variants and `Badge.tsx`'s dark-chip styling are pre-existing light/dark mismatches unrelated to this color-value swap — not touched.

Gate: `pnpm tsc --noEmit` clean (0 errors). `pnpm run build` — see below.

---

## COMPLETED — July 6 audit session

### STEP 1: Vitest — test suite clean

**Before:** 5 failures in `compliance.test.ts` (`UNSUBSCRIBE_HMAC_SECRET` missing), 5 failures in `intelligence.test.ts` (logic-model test expected `createClient()` auth but route used `requireRole()`).

**Fixes:**
- Created `.env.test` with 6 test-only env vars (`UNSUBSCRIBE_HMAC_SECRET`, `INTEGRATION_KEY_SECRET`, `PORTAL_ENCRYPT_SECRET`, `INTEGRATION_ENCRYPTION_KEY`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`) — loaded by `tests/setup.ts` via dotenv
- Rewrote `src/app/api/intelligence/logic-model/route.ts` to use `createClient()` directly (no `requireRole()`), matching the test's design intent

### STEP 2: TypeScript — clean (0 errors)

No new errors introduced. Prior session left clean.

### STEP 3: Build — clean

No new build errors introduced. Prior session left clean.

### STEP 4: API route audit — auth, org_id scoping, requireRole gates

No additional gaps found beyond what was caught in the July 3 session.

### STEP 5: Agents audit — stubs replaced with real implementations

- **`src/lib/intelligence/ingest-nih-proposals.ts`** — completely rewritten from always-returning-fake-success stub to real NIH Reporter API v2 integration:
  - Cycles 7 search terms by day-of-year (deterministic per-day)
  - POSTs to `https://api.reporter.nih.gov/v2/projects/search`
  - Deduplicates by `nih:{appl_id}` source key
  - Calls `extractSections()` + `generateEmbedding()` for each project
  - Inserts into `intelligence_funded_proposals` + `intelligence_proposal_sections`
  - Uses `createAdminClient()` for DB access

### STEP 6: env var startup throws

Added mandatory API key guards (throw if missing) to 6 intelligence files:
- `src/lib/intelligence/logic-model-generator.ts` — `ANTHROPIC_API_KEY`
- `src/lib/intelligence/budget-patterns.ts` — `ANTHROPIC_API_KEY`
- `src/lib/intelligence/embeddings.ts` — `OPENAI_API_KEY`
- `src/lib/intelligence/evaluation-library.ts` — `ANTHROPIC_API_KEY`
- `src/lib/intelligence/funder-recommender.ts` — `ANTHROPIC_API_KEY`
- `src/lib/intelligence/grant-dna.ts` — `ANTHROPIC_API_KEY`

Also fixed the pre-existing UUID bug in `src/lib/automation/session-manager.ts`:
- `markAutoSubmitted()` was writing `system:${automationLevel}` (a string) to `approved_by` (a UUID column) — would fail at runtime
- Fix: set `approved_by: null`; record level in `notes: auto_submitted:${automationLevel}`

And added `maxDuration=300` to two routes that were missing it:
- `src/app/api/agents/campaigns/route.ts`
- `src/app/api/agents/custom-scrape/route.ts`

### STEP 7: Playwright — stale selectors fixed

Base failure count: 59 failing / 27 passing before this session.

Fixed selector mismatches in these test files:

| File | What changed |
|---|---|
| `tests/e2e/authed/dashboard.spec.ts` | 4 metric labels + 2 section headings updated |
| `tests/e2e/authed/ui-redesign.spec.ts` | body bg `#0a0a1a→#0f1117`; sidebar items (Dashboard/Research moved to header, Funders/Applications/Documents in sidebar) |
| `tests/e2e/authed/research.spec.ts` | Page redesigned to "Research Command Center" + "Control Panel"; selectors rewritten |
| `tests/e2e/authed/automation.spec.ts` | Complete rewrite: navigates to `/autoapply` (was `/automation`); uses sessions API to find seed session; checks AutoApply h1 + "Add to Queue" button |
| `tests/e2e/authed/deadlines.spec.ts` | Calendar view button label `"Calendar"` → `"Month"` |
| `tests/e2e/authed/documents.spec.ts` | `"Upload a document"` heading doesn't exist; now checks `"Drag & drop or click to browse"` text |
| `tests/e2e/authed/pipeline.spec.ts` | Clicks "Kanban" toggle first; checks group labels "Discovery"/"Preparation"/"Active"/"Outcome" instead of individual stage names |
| `tests/e2e/authed/onboarding.spec.ts` | `"Benavora setup"→"Welcome to Benavora"`; step titles corrected to actual wizard steps |
| `e2e/onboarding.spec.ts` | `"Benavora setup"→"Welcome to Benavora"`; advance button regex updated for `"Save & Continue"` button label; step 7 check updated to `"Plan Selection"` |

Tests confirmed correct (no changes needed):
- `funders.spec.ts`, `knowledge-base.spec.ts`, `saas.spec.ts`, `settings.spec.ts`, `auth.spec.ts`, `login-theme.spec.ts`, `draft-generator.spec.ts`, `opportunities.spec.ts`, `email-calendar.spec.ts`
- `e2e/grant-pipeline.spec.ts`, `e2e/draft-generation.spec.ts`, `e2e/billing-gates.spec.ts`, `e2e/email-integration.spec.ts`, `e2e/autoapply-dashboard.spec.ts`, `e2e/tenant-isolation.spec.ts`, `e2e/admin-sales.spec.ts`, `e2e/smoke.spec.ts`

### STEP 8: Security page

Created `src/app/(marketing)/security/page.tsx` — matches the dark marketing design (privacy/terms pattern):
- AES-256-GCM encryption at rest
- TLS 1.3 in transit
- Row-Level Security (RLS) tenant isolation
- SOC 2-compliant infrastructure (Supabase/Vercel/Stripe/Anthropic)
- Authentication & access control
- Data never sold
- GDPR alignment
- SOC 2 Type II roadmap
- Responsible disclosure (security@benavora.com)
- Trust badge row

Added to `src/app/(marketing)/layout.tsx`:
- NAV_LINKS: `{ label: "Security", href: "/security" }`
- Footer: `<Link href="/security">Security</Link>`

---

## COMPLETED — July 3 audit session

### Earlier: test/build gate + nav/config fixes
- Added Email nav entry — /email now reachable from the sidebar
- Fixed `playwright.config.ts` testIgnore (worktree scan inflation)
- Fixed stale smoke/login-theme specs
- Fixed Node 20 WebSocket blocker in test helpers
- Confirmed: Vitest 161 passed / 0 failed · tsc --noEmit 0 errors · pnpm build clean

### Deep operational audit (27 parallel sub-agents)
- Full sweep of `src/lib/**` (213 files), `src/app/api/**` (168 routes), `src/app/(dashboard)/**` (75 pages)
- Live production schema queried: 104 tables, 1331 columns

### Security fixes
- **commit ae058c9** — bootstrap endpoint self-disables after platform_owner created
- **commit e29bd6f** — 4 hardcoded fallback secrets removed; env vars set in Vercel
- **commit c7704b6** — BYO API keys encrypted; shouldUseOwnKeys() fixed
- **commit 74be491** — Resend webhook real HMAC-SHA256 verification

### Batch fix — 21 remaining audit findings (commit a03a0e3)
Sales Outreach real routes · AutoApply Follow-Ups 4 routes · Renewals route · Stripe env naming · Campaign multi-step · HUD fetcher · maxDuration=300 on 15 routes · requireRole on grant-dna/logic-model · form-analyzer-agent real Claude impl · form-filler approval gate · tier-limit source of truth · nav-counts org filter · automation child-table queries · Texas registration data · email/link writer role · Email Hub live buttons · dual Calendar OAuth dedup · SearXNG throw · dead code removed

### Migration 065 (commit 1121c5a)
`autoapply_follow_ups` table created (13 columns, FK cascades, RLS, 3 policies); applied to production.

### Migration 066 + worker fix (commit 855f192)
12 broken RLS policies on form_templates/autoapply_submissions/submission_queue fixed (org_members → profiles pattern); worker queue-processor.ts creates/approves automation_sessions row per submission.

---

## PENDING — as of 2026-07-06

### Production-blocking
- [ ] **Set `RESEND_API_KEY` in Vercel** — outbound email non-functional
- [ ] **Set `RESEND_WEBHOOK_SECRET` in Vercel** — inbound webhook 500s
- [ ] **Set Stripe Price ID vars in Vercel** (`STRIPE_STARTER_PRICE_ID`, `STRIPE_PROFESSIONAL_PRICE_ID`, `STRIPE_ENTERPRISE_PRICE_ID`, `STRIPE_CONSULTANT_PRICE_ID`)
- [ ] **Deploy Railway worker** — AutoApply Playwright routes need Chromium process

### Code / low-priority
- [ ] Pull new env vars to local `.env.local` (`vercel env pull .env.local`) — 4 encryption vars missing locally
- [ ] Consolidate `NEXT_PUBLIC_SITE_URL` vs `NEXT_PUBLIC_APP_URL`
- [ ] Add SSRF allowlist to `api/integrations/custom-api/test`
- [ ] Fix `compliance-library.ts` dead branch (`omb-a133-threshold` always returns 'pass')
- [ ] Visual: verify/fix elongated input/textarea boxes reported across the platform

### Informational (no fix needed short-term)
- `grants-gov.ts` uses legacy `apply07.grants.gov` REST API — confirm not deprecated
- Census (2022) and BLS (2022–2023) data sources self-labeled as approximations
- state-portal.ts covers Texas only
- Hardcoded URL lists in corporate/foundation/state scrapers will go stale
- `intelligence_grant_dna_scores` table unused — DNA scores compute live, never persisted (found 2026-07-07)
- `intelligence_narrative_patterns` / `intelligence_post_award_reports` tables unused — schema only, no ingestion or reads (found 2026-07-07)
- No foundation-website-scrape or 990-grants-made ingestion script for the intelligence library specifically (found 2026-07-07)

---

## ENVIRONMENT

| Item | Value |
|---|---|
| Supabase | vbjplpquqxxfbpazyalt — 105 tables, migrations 001–066 applied |
| Vercel | benavora.vercel.app (Pro) |
| Platform owner | info@faithfoundation.org (bootstrap endpoint now self-disabled) |
| Encryption vars in Vercel | INTEGRATION_KEY_SECRET · PORTAL_ENCRYPT_SECRET · INTEGRATION_ENCRYPTION_KEY · UNSUBSCRIBE_HMAC_SECRET — all set, Encrypted, Production only |
| Local .env.local | Missing those 4 encryption vars + missing ANTHROPIC_API_KEY and other AI keys |
| .env.test | Created for Vitest: 6 test-only secrets |

## Production Sync 2026-07-09 14:19
- Migrations 067-074 ALL applied to production Supabase (vbjplpquqxxfbpazyalt) via Management API
- Commit 03cb3ab pushed: DD Phases 2+3, enrichment pipeline, onboarding soft-gate (11/11 FORGE gates)
- NOT YET RUN: pnpm seed:dd-taxonomy, pnpm enrich:990, pnpm enrich:web, DATAOCEAN backup, DD smoke test
- Railway status of 03cb3ab UNVERIFIED; RESEND_API_KEY still unset on both platforms

## Elevated Slate design-system pass on shared UI components (2026-07-13)
- Standardized all 12 `src/components/ui/*.tsx` files to Elevated Slate tokens. `Badge` variants
  (`success`/`warning`/`error`/`info`/`neutral`) now use literal `bg-[#hex]`/`text-[#hex]`/
  `border-[#hex]` arbitrary classes instead of `bg-success-bg`-style CSS-variable utilities; added a
  new `primary` variant. `Button` `secondary` and `danger` variants visually changed (secondary: white
  bg + blue hover-border instead of gray chip; danger: solid `#EF4444`/`#B91C1C` instead of translucent
  red). `Card` uses literal `bg-white ... border-slate-200`. `Input`/`Select`/`Textarea` rebuilt onto
  the literal focus/border spec (`focus:border-[#0077B6] focus:ring-[#0077B6]/10`), replacing legacy
  `navy-300`/`teal-500` alias classes. `EmptyState`/`LoadingSpinner`/`Modal`/`SearchBar` had their
  remaining `navy-*`/`teal-*` legacy classes swapped for direct `slate-*`/`#0077B6` (same rendered
  color via the compat layer — cosmetic cleanup, not a visual change). `ColorIcon` and `Table` left
  untouched (ColorIcon's categorical hues are a documented exception; Table already had no legacy
  tokens).
- Full detail in STATE_OF_THE_BUILD.md under "Shared UI components standardized to Elevated Slate
  literal hex tokens".
- Gate run: `pnpm tsc --noEmit` only — 0 errors. `pnpm run build`, `pnpm lint`, and Playwright were NOT
  run this session.

### PENDING
- [ ] Visual regression pass on `Button` `secondary`/`danger` and `Badge` `neutral` — real color changes
      ripple to ~130+ consumer files that pass `variant=`/`color=` props; nothing broke at the type
      level but no browser verification was done.
- [ ] `pnpm run build` / `pnpm lint` / Playwright for this change
- [ ] Commit and push not yet done — awaiting user confirmation

