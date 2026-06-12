# SESSION STATE — Benavora

_Last updated: 2026-06-12 (cross-provider AI consensus validation session)._

## This session: Cross-provider AI consensus validation

**Goal (FORGE prompt):** Create `src/app/api/ai/validate/route.ts` and
`src/lib/agents/consensus-validator.ts`. After research agents return results,
send each finding to two independent AI providers to verify the opportunity
exists and that the eligibility requirements, deadline, and amounts are correct.
Use the existing Claude API plus a free-tier provider. Store validation results
in a new `validations` table via migration (opportunity_id, provider, verdict,
confidence, details). Display a verified badge on validated opportunities; add
validation status to the opportunity detail page. Update the state docs from a
live audit.

### Status: implemented; gates blocked this session (no claim of passing)

- **Migration `014_validations.sql` (new).** Guarded enum `validation_verdict`
  (`verified` / `discrepancy` / `unverifiable`); `ALTER TYPE agent_type ADD VALUE
  IF NOT EXISTS 'consensus_validation'` (mirrors 005/006); and the `validations`
  table: `organization_id`, `opportunity_id` (`ON DELETE CASCADE`), `provider`,
  `model`, `verdict`, `confidence` (`CHECK 0–100`), `details` jsonb, `created_by`,
  timestamps. UNIQUE `(opportunity_id, provider)` (one current verdict per
  provider → drives the upsert) + org/opportunity indexes. Org-isolation RLS
  (master pattern). Idempotent. **Not yet applied to the live DB** — run
  `node apply-migration.mjs supabase/migrations/014_validations.sql` (set
  `SB_TOKEN_FILE`).
- **`src/types/database.ts` hand-updated** — added the `validations` Row/Insert/
  Update, the `validation_verdict` enum, and the `consensus_validation`
  `agent_type` value.
- **Free-tier provider `src/lib/ai/gemini.ts` (new, server-only).** `callGemini()`
  wraps Google Gemini's REST `generateContent` via `fetch` (no SDK dependency
  added), reads `GEMINI_API_KEY` (fallback `GOOGLE_GENERATIVE_AI_API_KEY`),
  returns text + token usage to mirror `callClaude`, and exposes
  `isGeminiConfigured()`. Defaults to `gemini-2.0-flash` (free tier).
- **`src/lib/agents/consensus-validator.ts` (new, server orchestration).** Sends a
  finding to Claude and Gemini **independently and concurrently**
  (`Promise.allSettled` — one provider failing/unconfigured never aborts the
  other), parses each provider's JSON verdict (existence / eligibility / deadline
  / amounts + confidence + summary), and upserts one `validations` row per
  provider. **Honesty:** the prompt is explicit that providers reason from their
  own knowledge + the finding's internal consistency (no live web access here),
  and return `unverifiable` rather than fabricate (Contracts §9). Logs to
  `agent_runs` (token tracking) via the route.
- **Client-safe core `src/lib/opportunities/validation.ts` (new).** Holds the
  shared verdict/consensus types, the provider/field constants, and the pure
  `computeConsensus()` rule — **"Verified" only when BOTH providers independently
  agree**, any single `discrepancy` → "Needs review". No server deps, so the
  badge and the API route derive the badge from the same one function.
- **API route `POST /api/ai/validate` (new).** `requireRole("writer")`, per-org
  rate limit + daily `api_calls` quota, loads the RLS-scoped opportunity + funder
  name, logs an `agent_runs` row (`agent_type: consensus_validation`), runs
  `validateOpportunity`, fails only if neither provider responded, meters usage,
  returns consensus + per-provider verdicts.
- **Auto-validation after research (`orchestrator.ts`).** After the parallel
  sweep + dedup, a bounded best-effort pass (`validateSweepFindings`) validates
  this sweep's new opportunities through both providers — **gated on
  `isGeminiConfigured()`** (no point spending tokens when consensus is
  unreachable), capped (`maxValidations`, default 5), never fails the sweep.
  Result/route now report `opportunitiesValidated` / `opportunitiesVerified`.
- **Verified badge + detail status.** `ValidationBadge.tsx` (new) renders the
  consensus badge (green "Verified" / red "Needs review" / muted pending). The
  opportunity **detail header** shows it (hidden until validated), and a new
  **Validation tab** shows the consensus, a writer-only "Validate / Re-run"
  button (POSTs `/api/ai/validate`), and each provider's verdict, confidence, and
  per-field ✓/✗ findings.
- **Gates not run** — every `pnpm`/`npx`/`tsc` invocation (Bash + PowerShell)
  returned "requires approval" this session, so per Iron Law 3 **no gate is
  claimed as passing.** Static self-review: client/server split keeps the
  Anthropic SDK + env out of the browser bundle (UI imports only the pure
  `lib/opportunities/validation`); new `validations` Row/Insert exist in
  `database.ts`; lucide icons (`ShieldCheck`, `ShieldAlert`, `ShieldQuestion`,
  `CheckCircle2`, `XCircle`) are valid; the opportunities e2e spec asserts no tab
  set, so the added tab is non-breaking.

### Files (this session)

New: `supabase/migrations/014_validations.sql`, `src/lib/ai/gemini.ts`,
`src/lib/agents/consensus-validator.ts`, `src/lib/opportunities/validation.ts`,
`src/app/api/ai/validate/route.ts`,
`src/components/opportunities/ValidationBadge.tsx`.

Changed: `src/types/database.ts`,
`src/components/opportunities/OpportunityDetail.tsx`,
`src/lib/agents/research/orchestrator.ts`,
`src/app/api/agents/research/route.ts`.

### To resume / hand off

1. Apply migration 014 to the live DB
   (`node apply-migration.mjs supabase/migrations/014_validations.sql`, set
   `SB_TOKEN_FILE`). Until applied, `/api/ai/validate` and the detail Validation
   tab error on the missing table.
2. Set `GEMINI_API_KEY` (free tier) in the env so the second provider is reachable
   — without it, validation records only Claude's verdict and consensus stays
   "pending" (never "Verified"), and the post-research auto-pass is skipped.
3. Approve + run the gate sequence (`pnpm tsc --noEmit` → `pnpm build` →
   `pnpm lint`); report actual results and fix any fallout.
4. Smoke test: open an opportunity → Validation tab → "Validate"; confirm two
   provider cards appear, the header badge flips to "Verified" when both agree,
   and `validations` has one row per provider.

## Previous session: Alerts — daily action list + red sidebar badges

**Goal (FORGE prompt):** Create an `alerts` table in Supabase via migration (type,
message, severity, read status, link, org_id). Build `src/app/(dashboard)/alerts/page.tsx`
as a daily action list. Add red notification badge counts to the sidebar nav for
deadlines within 7 days, new opportunities since last login, applications needing
action, and drafts pending review. Each alert clickable → relevant record; alerts
dismissible and snoozable; add the Alerts link to the sidebar nav. Update the state
docs from a live audit.

### Status: implemented; gates blocked this session (no claim of passing)

- **Migration `013_alerts.sql` (new).** Two guarded enums — `alert_type`
  (`deadline_due` / `new_opportunity` / `application_action` / `draft_review` /
  `system`) and `alert_severity` (`info` / `warning` / `critical`) — plus the
  `alerts` table: `organization_id`, `type`, `severity` (default `info`),
  `message`, `link`, `is_read` + `read_at`, `is_dismissed` + `dismissed_at`,
  `snoozed_until`, optional provenance FKs (`opportunity_id` / `application_id` /
  `deadline_id`, all `ON DELETE CASCADE`), and a `dedup_key` with a UNIQUE
  `(organization_id, dedup_key)` index for idempotent regeneration. Org-isolation
  RLS (`organization_id = public.current_org_id()`, master pattern). Idempotent
  (`DO $$…$$` enum guards, `CREATE TABLE/INDEX IF NOT EXISTS`, `DROP POLICY IF
  EXISTS`). **Not yet applied to the live DB** — run
  `node apply-migration.mjs supabase/migrations/013_alerts.sql` (set `SB_TOKEN_FILE`).
- **`src/types/database.ts` hand-updated** — added the `alerts` table Row/Insert/
  Update and the `alert_type` / `alert_severity` enums (no `supabase gen types`
  access this session).
- **Shared service `src/lib/alerts/alerts-service.ts` (new, client-safe).** Single
  source of truth for the vocabulary both the route and UI agree on: the
  `dedupKeys` builders, `DEADLINE_WINDOW_DAYS` (7), `ACTION_STAGES`
  (`awaiting_documents` / `follow_up_due` / `reporting_required`),
  `DRAFT_REVIEW_STAGE` (`ready_for_review`), `deadlineSeverity()`,
  `AlertCounts` / `EMPTY_COUNTS`, and `ALERT_TYPE_LABEL`.
- **Generation route `GET /api/alerts/route.ts` (new).** Derives `organization_id`
  from the session (Law 2), assembles the four live signals (deadlines due ≤7 days
  or overdue & not completed; opportunities `created_at >` the profile's
  `last_login_at`; applications in action stages; applications in
  `ready_for_review`), then **upserts** candidates by `(organization_id,
  dedup_key)` — preserving each row's read/dismiss/snooze state — and **prunes**
  generated alerts whose underlying item is no longer actionable. Returns the
  active list (not dismissed, not currently snoozed) plus per-category counts.
  Opportunity names are resolved in a separate `in()` query (the codebase joins in
  JS rather than embedding — `Relationships: []`), so no embedded-select typing.
- **`useAlerts` hook (`src/lib/hooks/useAlerts.ts`, new).** Fetches `/api/alerts`
  (no-store) and exposes `{ alerts, counts, loading, error, refresh }`. Shared by
  the Sidebar (counts) and the Alerts page (list).
- **Sidebar red badges (`src/components/layout/Sidebar.tsx`).** Renders a red pill
  (`99+` cap, `aria-label`) on Alerts (total), Deadlines (`deadline_due`),
  Opportunities (`new_opportunity`), Applications (`application_action`), and Draft
  Generator (`draft_review`). Re-fetches on every navigation (pathname effect, with
  a first-run guard so the hook's own mount fetch isn't doubled) so acting on items
  elsewhere clears the badges.
- **Alerts nav item (`src/components/layout/nav-items.ts`).** New `Bell` item at
  `/alerts`, placed second (after Dashboard).
- **Alerts page (`src/app/(dashboard)/alerts/page.tsx`, new, client).** Daily
  action list grouped by category (most-urgent first), each row a `Link` to
  `alert.link` (marks read on click), with a severity accent/dot. Every alert is
  **dismissible** (`is_dismissed` + `dismissed_at`) and **snoozable** (1 hour /
  tomorrow / 3 days / 1 week → `snoozed_until`) via the RLS-scoped browser client
  (matching the Deadlines page's direct-update pattern), optimistic removal with
  revert-on-error, then `refresh()` to resync counts. Loading / empty / error
  states handled.
- **Gates not run** — every `pnpm`/`npx`/`tsc` invocation (Bash + PowerShell)
  returned "requires approval" this session, so per Iron Law 3 **no gate is claimed
  as passing.** Static self-review: new imports resolve; `alerts` Row/Insert exist
  in `database.ts`; the route avoids embedded selects and the heterogeneous
  `Promise.all` branch was refactored out; lucide icons (`Bell`, `AlarmClock`,
  `BellOff`, `CalendarClock`, `KanbanSquare`, `Wand2`, `Search`, `ChevronRight`,
  `X`) are valid; no unused exports. (Pre-existing google-integration lint debt that
  `next build` surfaces is unrelated.)

### Files (this session)

New: `supabase/migrations/013_alerts.sql`, `src/lib/alerts/alerts-service.ts`,
`src/app/api/alerts/route.ts`, `src/lib/hooks/useAlerts.ts`,
`src/app/(dashboard)/alerts/page.tsx`.

Changed: `src/types/database.ts`, `src/components/layout/nav-items.ts`,
`src/components/layout/Sidebar.tsx`.

### To resume / hand off

1. Apply migration 013 to the live DB
   (`node apply-migration.mjs supabase/migrations/013_alerts.sql`, set
   `SB_TOKEN_FILE`). Until applied, `/api/alerts` errors on the missing table.
2. Approve + run the gate sequence (`pnpm tsc --noEmit` → `pnpm build` →
   `pnpm lint`); report actual results and fix any fallout.
3. Smoke test: visit `/alerts`, confirm the four categories populate from real
   data, the sidebar badges match the counts, clicking an alert lands on the
   record, and dismiss/snooze remove it and update the badges.

## Previous session: Opportunity match-percentage scoring

**Goal (FORGE prompt):** Add a `match_percentage` integer column to `opportunities`
via migration. When research agents discover opportunities, auto-run the
eligibility scoring agent to calculate the match percentage. Display a colour-coded
match badge on every opportunity card and the detail page. Auto-flag opportunities
above 80% as high priority. Show specific mismatch reasons below 40% explaining
which eligibility criteria failed. Sort opportunity lists by match percentage by
default. Update the state docs from a live audit.

### Status: implemented; gates blocked this session (no claim of passing)

- **Migration `012_opportunity_match_percentage.sql` (new).** Adds three additive,
  agent-owned columns to `opportunities`: `match_percentage` (integer, `CHECK`
  0–100, nullable), `is_high_priority` (boolean `NOT NULL DEFAULT false`), and
  `match_mismatch_reasons` (`text[]`), plus
  `idx_opportunities_match_percentage (match_percentage DESC NULLS LAST)`.
  Idempotent (`ADD COLUMN IF NOT EXISTS`); no rename, no RLS touched. **Not yet
  applied to the live DB** — run `node apply-migration.mjs supabase/migrations/012_opportunity_match_percentage.sql`.
- **`EligibilityScorer` extended (`src/lib/agents/eligibility-scorer.ts`).** The
  prompt now also asks for `failed_criteria` (`[{criterion, reason}]`); the parser
  reads them tolerantly. The agent persists `match_percentage` (= the 0–100 fit
  score it already computes), `is_high_priority` (`>= 80`), and
  `match_mismatch_reasons` (`"<criterion>: <reason>"` lines, else `null`). Still a
  single Claude call. Fields are agent-owned per BEHAVIORAL_CONTRACTS §5. Exposes
  `HIGH_PRIORITY_THRESHOLD` (80) / `MISMATCH_REASON_THRESHOLD` (40).
- **Auto-run on discovery — no new agent wiring.** All four research agents
  (`corporate-giving`, `foundation-grants`, `government-grants`, `local-sponsorship`)
  already instantiate and run `EligibilityScorer` on each newly-inserted
  opportunity, so extending the scorer means match is computed automatically at
  discovery.
- **Shared UI helpers (`src/components/opportunities/eligibility.tsx`).** New
  `matchColor` (green ≥80 / yellow ≥40 / red <40), `MatchBadge` ("NN% match" pill,
  "Not scored" when null), `HighPriorityBadge` (flame), and `MismatchReasons` (red
  callout listing the failed criteria). Mirrors the eligibility-scorer thresholds
  (server-only module, so the constants are duplicated, not imported).
- **Card / detail / table wiring.** `OpportunityCard` and the `OpportunityDetail`
  header lead with the match + high-priority badges. The detail Eligibility tab
  gains a "Match" card that surfaces the mismatch reasons when match < 40.
  `OpportunityTable` adds a sortable **Match** column and defaults to
  match-descending; the card grid sorts the same way.
- **Lists default to match.** `opportunities/page.tsx` orders by
  `match_percentage DESC NULLS LAST`; `/api/grants` list does the same, and
  `grants-service` now maps the contract `match_percentage` onto the real column
  (falling back to `eligibility_score` for pre-012 rows). The manual
  `OpportunityForm` does NOT write any of the agent-owned match fields.
- **Gates not run** — `pnpm`/`npx`/`tsc` invocations (Bash + PowerShell) all
  returned "requires approval" this session, so per Iron Law 3 **no gate is claimed
  as passing.** Changes were self-reviewed for type-correctness: the new columns
  exist in `src/types/database.ts` Row/Insert/Update, every component reads fields
  that exist on `Tables<"opportunities">`, and the new lucide icons (`Target`,
  `Flame`, `AlertTriangle`) are valid imports.

### Files (this session)

New: `supabase/migrations/012_opportunity_match_percentage.sql`.

Changed: `src/lib/agents/eligibility-scorer.ts`,
`src/components/opportunities/eligibility.tsx`,
`src/components/opportunities/OpportunityCard.tsx`,
`src/components/opportunities/OpportunityDetail.tsx`,
`src/components/opportunities/OpportunityTable.tsx`,
`src/app/(dashboard)/opportunities/page.tsx`,
`src/app/api/grants/route.ts`, `src/lib/grants/grants-service.ts`,
`src/types/database.ts`.

### To resume / hand off

1. Apply migration 012 to the live DB, then run a research agent (or
   `POST /api/agents/eligibility`) so existing rows get a `match_percentage`.
2. Run the gate sequence (`pnpm tsc --noEmit` → `pnpm build` → `pnpm lint`) —
   blocked from running here, so NOT confirmed green.
3. Smoke test the match badge, high-priority flag (80%+), mismatch reasons (<40%),
   and the match-descending default sort on the Opportunities list.

## Previous session: Outcomes Analytics Dashboard (recharts)

**Goal (FORGE prompt):** Install `recharts`. Replace the Outcomes analytics page
(`src/app/(dashboard)/outcomes/analytics/page.tsx`) with a full charting dashboard
driven by real Supabase data: pipeline funnel, success-rate line over time, dollars
requested vs. awarded bar, source-category pie, deadline-density calendar heatmap,
agent-activity bar, pipeline-velocity metric, top-performing categories, ROI
(subscription cost vs. grants won), and year-over-year comparison. Update the state
docs from a live audit.

### Status: implemented; `recharts` installed; build/test gates blocked this session (no claim of passing)

- **`recharts` dependency — INSTALLED.** `recharts@^2.15.4` is now in
  `package.json` (`dependencies`) and present in `node_modules/` (verified by
  audit); `@types/recharts@^2.0.1` is also listed (a harmless stub — recharts 2.x
  ships its own types). This clears the prior session's one true blocker: the
  dashboard's `recharts` imports now resolve, so the page no longer fails on module
  resolution. `date-fns` (used by the aggregation lib) is likewise installed.
- **Pure aggregation lib `src/lib/analytics/dashboard.ts` (new, no I/O / no AI).**
  Deterministic transforms over raw rows — `buildFunnel` (apps that *reached* each
  milestone, a true narrowing funnel from each app's single current stage),
  `buildMonthly` (success/funded rate + requested/awarded $ by month),
  `buildSourcePie` (opportunities by `source_type`), `buildDeadlineHeatmap`
  (GitHub-style trailing-26-week grid, today injected for determinism),
  `buildAgentActivity` (runs/completed/failed/items by `agent_type`),
  `computeVelocity` (avg days created→submitted and created→outcome),
  `buildTopCategories` ($ awarded by funder category), `computeRoi`
  (`TIER_PLANS[tier]` annual cost vs. total awarded → ROI multiple / net),
  `buildYearOverYear`, and `computeKpis`. Mirrors the existing
  `outcome-analyzer.ts` split (pure math separate from the view).
- **Dashboard component `src/components/outcomes/AnalyticsDashboard.tsx` (new,
  client).** Eleven visualizations on the dark theme: a 6-up KPI strip, then
  recharts `FunnelChart`, `PieChart`, success-rate `LineChart`, dollars `BarChart`,
  horizontal agent + top-category `BarChart`s, velocity metric tiles, an ROI
  cost-vs-won `BarChart`, a year-over-year `ComposedChart` (bars + line, dual
  axis), and a custom (non-recharts) deadline-density heatmap grid. Logo-matched
  palette, dark tooltips, per-chart empty states, and a global empty state when no
  data exists at all.
- **Page rewrite (`outcomes/analytics/page.tsx`).** Now fetches six tables in one
  `Promise.all` — `outcomes`, `applications`, `opportunities`, `deadlines`,
  `agent_runs`, and `organizations` (for the subscription tier) — all RLS-scoped
  via the browser client. Outcomes/applications errors are fatal (retry button);
  the rest degrade to empty datasets. Maps rows to the lib's input shapes and
  renders `AnalyticsDashboard`. No mocks, no server roundtrip (Iron Law 8).
- **Replaces the prior narrative-only analytics view.** The previous page rendered
  only `SuccessAnalytics` (CSS-bar success rates + proven-narrative ranking) over
  `outcomes` + `proven_narratives`. That component is untouched and still used by
  nothing else; it can be folded back in as a section later if the narrative panel
  is wanted alongside the charts.
- **Gates not run** — every `pnpm`/`npx`/`tsc` invocation (Bash + PowerShell)
  returned "requires approval" again this session, so per Iron Law 3 **no gate is
  claimed as passing.** Static audit only, now complete with deps installed:
  `recharts` + `date-fns` resolve in `node_modules`; the analytics lib has no `any`
  and its imports resolve (`PIPELINE_STAGES`/`TIER_PLANS`/`SubscriptionTier` from
  constants, `humanizeEnum` from formatters); every column the page queries exists
  in `src/types/database.ts` — `outcomes`(result, awarded_amount, requested_amount,
  funder_category, opportunity_category, recorded_at, application_id),
  `applications`(stage, requested_amount, awarded_amount, created_at, submitted_at),
  `opportunities`(category, source_type, deadline), `deadlines`(due_date,
  is_completed), `agent_runs`(agent_type, status, created_at, items_found),
  `organizations`(subscription_tier); the component uses `type ReactElement` (no
  bare `React.` namespace under the new JSX transform); the page's row casts are
  sound because the browser Supabase client is surfaced untyped. With `recharts`
  now installed, the dashboard is expected to compile cleanly.

### Files (this session)

New: `src/lib/analytics/dashboard.ts`,
`src/components/outcomes/AnalyticsDashboard.tsx`.

Changed: `src/app/(dashboard)/outcomes/analytics/page.tsx`, `package.json` +
`pnpm-lock.yaml` (`recharts` + `@types/recharts` added — now installed).

### To resume / hand off

1. ✅ **`recharts` installed** — the prior blocker is cleared (`recharts@^2.15.4`
   in `package.json` + `node_modules`). No further dependency action needed.
2. Approve + run the gate sequence (`pnpm tsc --noEmit` → `pnpm build` →
   `pnpm lint`); report actual results and fix any fallout. (Note the pre-existing
   google-integration lint debt that `next build` surfaces.)
3. Smoke test: open `/outcomes` → "View analytics". With recorded outcomes +
   applications + deadlines + agent runs, confirm every chart renders real numbers,
   the funnel narrows, the heatmap shades by deadline density, and ROI reflects the
   org's subscription tier. Confirm graceful empty states on a fresh org.

---

## Previous session: Search Profile Configuration page + profile-driven agents

**Goal (FORGE prompt):** Build a full search-profile configuration page
(`src/app/(dashboard)/search-profiles/configure/page.tsx`) with UI for funding-type
toggles, source-category filters with priority ranking, weighted focus-area tags,
dollar range, geographic scope, eligibility pre-filters, populations-served
matching, negative filters (excluded categories + funders), and per-agent toggle +
schedule config. Save everything to `search_profiles`. Research agents must read
the active profile before every run. Update the state docs from a live audit.

### Status: implemented; gates blocked (no claim of passing)

- **Migration `011_search_profile_configuration.sql` (new).** Additive,
  idempotent (`ADD COLUMN IF NOT EXISTS`) — eight new columns on `search_profiles`:
  `source_type_filters` (jsonb `[{source_type, priority}]`), `focus_areas` (jsonb
  `[{label, weight}]`), `geographic_scopes` (text[]), `eligibility_filters` (jsonb),
  `populations_served` (text[]), `excluded_categories` (funder_category[]),
  `excluded_funders` (text[]), `agent_settings` (jsonb keyed by agent_type). No
  rename/drop, no RLS change. `src/types/database.ts` hand-updated to match (no
  `supabase gen types` access). **Migration written but NOT yet applied** to the
  live DB.
- **Shared config module `src/lib/research/profile-config.ts` (new, client-safe).**
  Single source of truth for the structured shapes (`SourceTypeFilter`,
  `FocusArea`, `AgentSetting`/`AgentSettings`, `EligibilityFilters`), the option
  lists the page renders (eligibility pre-filters, population/geographic presets,
  schedule cadences, focus-weight range), and defensive parsers that coerce an
  untyped `Json` value into a typed structure (`parseSourceTypeFilters`,
  `parseFocusAreas`, `parseEligibilityFilters`, `parseAgentSettings`). Pure data +
  functions so BOTH the page (client) and the scheduler/cron (server) import it.
- **Configuration page (new).** One client page, prefilled from `?id=<profile>`
  (read from `window.location` on mount — no Suspense boundary, matching the
  reset-password pattern) or blank for create. Sections: Basics (name, keywords,
  active), Funding types (category toggles), Source categories & priority
  (ordered list with up/down + add), Focus areas (label + weight slider), Award
  size & recurrence, Geographic scope (tag input + presets), Eligibility
  pre-filters (toggles + min org age), Populations served (tag input + presets),
  Negative filters (excluded categories + excluded-funder tags), Agents & schedule
  (per-family enable + cadence select). Sticky save bar. Saves all columns;
  `organization_id` derived from the session (never a field, §2); active-profile
  cap (10) enforced on activate.
- **Agents read the active profile before every run.** The scheduler's `mapRow`
  now surfaces every new column on `ResearchSearchProfile`, so `getActiveProfiles`
  / `getProfile` (already called before each run) load the full configuration.
  New scheduler helpers — `effectiveCategories` (categories minus exclusions),
  `profileAgentEnabled`, `profileExcludesFunder`, `queryAugmentTerms` /
  `profileQueryTerms` (keywords + weighted focus areas + populations). The four
  research agents now: skip a profile when its per-agent toggle is off; match
  family scope on effective (non-excluded) categories; expand queries over
  keywords + focus areas + populations; and never create an opportunity from an
  excluded funder.
- **Cron sweep honors the config.** `api/cron/research` selects the new columns
  and gates each profile per family with `profileDueForFamily()` — the family must
  be enabled for the profile, and `last_run_at` must be past the profile's own
  schedule interval (falling back to the family default), matched on effective
  categories. So the per-agent toggle + schedule are genuinely enforced on the
  scheduled path, not just persisted.
- **Navigation wired.** The Search Profiles list page gained an "Advanced setup"
  header button (→ `/search-profiles/configure`) and a per-profile "Configure"
  action (→ `…/configure?id=<id>`).
- **`tsc` / `build` / `lint` could not be run** — every invocation
  (`npx`/`pnpm`, PowerShell + Bash) returned "requires approval" this session. Per
  Iron Law 3, **no gate is claimed as passing.** Static audit only: new imports
  resolve; no `any`; the Supabase browser client is untyped (insert/update
  payloads aren't strictly checked); jsonb payloads (arrays/records of
  string/number/boolean) are structurally assignable to `Json`; the removed
  `profileAgentIntervalMs` left no caller; cron's `DEFAULT_AGENT_INTERVAL_HOURS`
  import was dropped after it became unused.

### Files (this session)

New: `supabase/migrations/011_search_profile_configuration.sql`,
`src/lib/research/profile-config.ts`,
`src/app/(dashboard)/search-profiles/configure/page.tsx`.

Changed: `src/types/database.ts`,
`src/lib/agents/research/scheduler.ts`,
`src/lib/agents/research/{foundation-grants,government-grants,corporate-giving,local-sponsorship}.ts`,
`src/app/api/cron/research/route.ts`,
`src/app/(dashboard)/search-profiles/page.tsx`.

### To resume / hand off

1. Apply the migration:
   `node apply-migration.mjs supabase/migrations/011_search_profile_configuration.sql`
   (set `SB_TOKEN_FILE`). Until applied, the new columns are absent in the live DB
   and the page's saves of those fields will error.
2. Approve + run the gate sequence (`pnpm tsc --noEmit` → `pnpm build` →
   `pnpm lint`); report actual results and fix any fallout. (Note the pre-existing
   google-integration lint debt that `next build` surfaces.)
3. Smoke test: open `/search-profiles` → "Advanced setup", fill each section, save,
   reopen via "Configure" and confirm round-trip. Then with
   `feature.research_agents = true`, disable a family for a profile and confirm a
   run skips it; add an excluded funder and confirm it's never created.

---

## Previous session: Parallel research orchestration + cross-result dedup

**Goal (FORGE prompt):** Make the research agents run simultaneously
(`Promise.allSettled`) instead of sequentially, add a post-sweep deduplication
step (compare by URL, title, funder name), add four specialized source-type agent
configs (`grants_gov_api`, `state_specific`, `foundation_directory`,
`faith_based`), and surface parallel execution status on the API route +
Research dashboard. Update the state docs from a live audit.

### Status: implemented; gates blocked (no claim of passing)

- **Orchestrator (`src/lib/agents/research/orchestrator.ts`, new).**
  `runResearchAgentsInParallel()` launches every lane in `RESEARCH_AGENT_CONFIGS`
  at once via **`Promise.allSettled`** (not `Promise.all`, so one family's
  failure/timeout never aborts the rest) and reports per-lane status. After all
  lanes settle it runs the cross-result dedup pass and returns
  `{ lanes, totalFound, totalCreated, duplicatesRemoved, durationMs }`.
- **Cross-result dedup (`deduplicator.ts`).** New pure `deduplicateResults()`
  folds the sweep's discoveries by **exact URL, then fuzzy name + funder**
  (reuses the existing `namesMatch` Jaccard logic), keeping the earliest-created
  row. The orchestrator queries the sweep window's agent-discovered rows (never
  `source = manual`), removes each duplicate's keywords then the row, org-scoped
  and best-effort (a cleanup failure leaves the dup, never breaks the sweep).
- **Four specialized configs (`agent-configs.ts`, new + `focus.ts`, new).** Each
  config maps a lane to an agent class plus a `ResearchFocus` (source override +
  query suffix). `grants_gov_api` and `state_specific` reuse the **Government**
  agent; `foundation_directory` and `faith_based` reuse the **Foundation** agent.
  A `focus` only narrows WHERE/HOW the agent searches — classification stays
  page-text-driven (§9, never fabricated). Client-safe lane mirror in
  `src/lib/research/families.ts` (`RESEARCH_AGENT_LANES`) drives the UI.
- **API route.** `POST /api/agents/research` now accepts `agentType: "all"`,
  which runs the orchestrator and responds with `mode: "parallel"` + the per-lane
  array. The single-family path is unchanged.
- **Dashboard.** `ResearchDashboard` gained a **"Parallel execution"** panel:
  one card per lane with a live status glyph/badge (running → done/failed),
  source-type badge, and created/found counts, plus a "N cross-lane duplicates
  removed" note. `handleRunAll` seeds all lanes as running, POSTs `"all"`, then
  fills results from the response.
- **Cron route left sequential — deliberate.** `src/app/api/cron/research`
  re-checks the daily `agent_runs` quota before each family so one org never
  floods its sources mid-sweep (Contracts §17); converting it to parallel would
  break that per-agent gating. The parallel change is scoped to the interactive
  orchestrator/route, as the prompt specifies.
- **`tsc` / `build` / `lint` could not be run** — every invocation
  (`npx`/`pnpm`/direct binary, PowerShell + Bash) returned "requires approval"
  this session. Per Iron Law 3, **no gate is claimed as passing.** Static audit
  only: new imports resolve, no `any`, focus presets are declared before the
  config array (no TDZ), the `ResearchAgent` structural shape matches the one the
  existing route already compiled against.

### Files (this session)

New: `src/lib/agents/research/orchestrator.ts`,
`src/lib/agents/research/agent-configs.ts`,
`src/lib/agents/research/focus.ts`.

Changed: `src/lib/agents/research/deduplicator.ts` (`deduplicateResults`),
`src/lib/agents/research/{government-grants,foundation-grants}.ts` (optional
`focus`), `src/lib/research/families.ts` (`RESEARCH_AGENT_LANES`),
`src/app/api/agents/research/route.ts` (`"all"` mode),
`src/components/research/ResearchDashboard.tsx` (parallel panel),
`src/app/(dashboard)/research/page.tsx` (parallel wiring).

### To resume / hand off

1. Approve + run the gate sequence (`pnpm tsc --noEmit` → `pnpm build` →
   `pnpm lint`); report actual results and fix any fallout.
2. Smoke test: with `feature.research_agents = true`, click **Run all active**
   and confirm the eight lanes show live status, counts populate, and any
   cross-lane duplicates are removed.
3. Consider deduping the overlapping government/foundation lanes (base family vs.
   specialized passes share profiles) if API spend matters — the dedup pass
   cleans the rows, but the redundant fetches still cost tokens.

---

## Previous session: Funding source-type classification

**Goal (FORGE prompt):** Add a `source_type` column to the opportunities table
(new Supabase migration), create color-coded badges per type and show them on
OpportunityTable / OpportunityDetail / OpportunityCard, add source-type filter
tabs to the Opportunities page, and have the research agents auto-assign
`source_type` when discovering opportunities. Update the state docs from a live
audit.

### Status: implemented; gates blocked (no claim of passing)

- New enum `opportunity_source_type` + nullable `opportunities.source_type` +
  index via **migration `010_opportunity_source_type.sql`** (idempotent, additive,
  no rename/RLS change). `src/types/database.ts` hand-updated to match (no
  `supabase gen types` access this session).
- `SourceTypeBadge` (+ `SOURCE_TYPE_COLOR`) with eight distinct colors; the shared
  `Badge` primitive gained `sky` / `orange` / `pink`. Badges render on the table
  (new Source column), detail (header + Overview row), and the new
  `OpportunityCard`. Null → "Unclassified".
- `SourceTypeTabs` (All + per-type tabs with live counts, zero-count hidden) on the
  list, backed by the URL `source` param; a **Table ⇄ Cards view toggle** (URL
  `view`) gives the card a real home. Source filtering composes with the existing
  keyword/category/status/deadline/score filters (one shared client-side predicate).
- New pure classifier **`inferSourceType()`** (`src/lib/opportunities/source-type.ts`)
  used by all four research agents on insert; deterministic, reads only
  already-extracted text (never the LLM / never fabricated, §9). Government uses
  CFDA/NOFO/SAM markers as federal signals. Manual entries get a form select.
- **`tsc` / `build` / `lint` could not be run** — every invocation returned
  "requires approval" under both PowerShell and Bash. Per Iron Law 3, **no gate is
  claimed as passing.** Static audit only (imports resolve, enum present, no `any`,
  no unused imports, `OpportunityCard`→`OpportunityRow` is a type-only import so no
  runtime cycle). **Migration is written but not yet applied** to the live DB.
- **Build-unblock (recovery pass):** removed the four pre-existing
  `@typescript-eslint/no-explicit-any` casts in
  `src/lib/integrations/google/{auth,calendar,gmail}.ts` that were failing
  `next build`'s lint step (the grants session's open blocker, below). They were
  redundant — `pnpm.overrides` pins `google-auth-library` to one `10.7.0`, so the
  `Auth.OAuth2Client` values were already assignable to googleapis' `auth` param;
  the casts bridged nothing. Type-safe removal; `Auth` imports remain used. Gate
  still blocked this session, so the green build is not claimed.

### Key distinction — not the grants API `source_type`

The grants API aliases the BEHAVIORAL_CONTRACTS contract field `source_type` onto
`category` (`GRANT_SELECT` reads only `category`); it is untouched and does not use
the new physical column. The two share a name but are different classifications —
documented in both state docs so they're never conflated. (Consistent with the
recorded "grants API maps to opportunities" decision.)

### Files (this session)

New: `supabase/migrations/010_opportunity_source_type.sql`,
`src/lib/opportunities/source-type.ts`,
`src/components/opportunities/SourceTypeBadge.tsx`,
`src/components/opportunities/SourceTypeTabs.tsx`,
`src/components/opportunities/OpportunityCard.tsx`.

Changed: `src/types/database.ts`, `src/lib/utils/constants.ts`,
`src/components/ui/Badge.tsx`,
`src/components/opportunities/{OpportunityTable,OpportunityFilters,OpportunityDetail,OpportunityForm}.tsx`,
`src/lib/agents/research/{foundation-grants,government-grants,corporate-giving,local-sponsorship}.ts`.

### To resume / hand off

1. Apply the migration:
   `node apply-migration.mjs supabase/migrations/010_opportunity_source_type.sql`
   (set `SB_TOKEN_FILE`). Until applied, the column is absent in the live DB.
2. Approve + run the gate sequence (`pnpm tsc --noEmit` → `pnpm build` →
   `pnpm lint`); report actual results and fix any fallout.
3. Smoke test: run each research agent and confirm sensible `source_type`; verify
   the tabs + counts, the Table/Cards toggle, and the form select round-trip.

---

## Previous session: Grants API (4 routes)

**Goal (FORGE api prompt):** Implement the "grants" API as Next.js App Router route
handlers — `GET /api/grants` (list + filters + pagination), `GET /api/grants/[id]`
(detail), `PATCH /api/grants/[id]` (update mutable fields), and
`POST /api/grants/[id]/rescore` (manual eligibility re-score). Each authenticates
the user, derives `organization_id` from the session (never the body — Six Laws
Law 2), validates input, returns the contract response shape, and reads/writes
only real tables (Iron Law 8).

### Status: implemented and verified (tsc ✓ · lint-on-new-files ✓ · build compiles ✓)

- **`tsc --noEmit` passes, exit 0** across the whole project (the typecheck gate
  DID run this session — unlike the prior auth session where command execution was
  denied).
- **`next lint` on the four new files: no warnings or errors.**
- **`next build` compiles successfully and type-checks.** Its final lint step fails
  on **pre-existing** `@typescript-eslint/no-explicit-any` errors in
  `src/lib/integrations/google/{auth,calendar,gmail}.ts` (committed in `db364b6`,
  untouched this session, unrelated to grants). Reported honestly; not claimed green.
- No mock data, no placeholders — real Supabase reads/writes; rescore reuses the
  real `EligibilityScorer` (real Claude call).

### Key finding — the contract's `grants` table does not exist (built on `opportunities`)

BEHAVIORAL_CONTRACTS names a `grants` table with `source_type`, `eligibility_flag`,
`amount_requested`, `amount_awarded`, `match_percentage`, `eligibility_notes`,
`eligibility_scored_at`. **None exist** in the live schema; `SCHEMA_REGISTRY.md`
Tables = "_(no tables designed)_", so `src/types/database.ts` is authoritative, and
its real entity is **`opportunities`** (+ `search_profiles`, which does exist). Per
Iron Law 8 and the recorded build-wins posture (auth, `is_proven`), the routes
operate on the real tables and present them under the contract's grant vocabulary
via a documented mapping in `src/lib/grants/grants-service.ts`:

| Contract field | Real column / derivation |
| --- | --- |
| `source_type` | `category` (`funder_category` enum) |
| `status` | `status` (`opportunity_status` enum) |
| `amount_requested` / `amount_awarded` | `amount_min` / `amount_available` |
| `deadline` | `deadline` |
| `match_percentage` | `eligibility_score` |
| `eligibility_flag` | derived from `eligibility_score` (≥80/≥60/<60/null) |
| `eligibility_notes` | `recommendation_reasoning` |
| `eligibility_scored_at` | `updated_at` |

Also honored from the live codebase over the contract text: flat `{ error, code }`
error envelope (all 38 routes), and manual validation (zod is not a dependency).

### Files (this session)

New:

- **`src/lib/grants/grants-service.ts`** — contract⇄schema mapping; `serializeGrant`,
  `deriveEligibilityFlag`, `GRANT_SELECT`, enum/UUID/date guards, and
  `resolveGrantOwnership` (a service-role probe reading only `organization_id`, so
  the contract's 403 "other org" can be told apart from 404 "absent" — RLS hides
  cross-tenant rows from the session client).
- **`src/app/api/grants/route.ts`** — `GET` list. Validates `source_type` (CSV enum),
  `eligibility_flag`, `status`, and `from`/`to` deadline range → 400 `INVALID_FILTER`;
  `eligibility_flag` is translated to `eligibility_score` predicates; pagination
  (`page`/`limit`, default 25 / max 100) returns an exact `total`.
- **`src/app/api/grants/[id]/route.ts`** — `GET` detail + `PATCH` partial update.
  Mutable fields map to real columns; omitted fields untouched (no implicit nulling);
  ownership checked before write (403/404); `update` audit entry.
- **`src/app/api/grants/[id]/rescore/route.ts`** — `POST` manual re-score. Ownership +
  `search_profiles` gate (422 `NO_SEARCH_PROFILE`), burst + daily `agent_runs`
  enforcement, reuses `EligibilityScorer`, re-reads persisted fields, maps AI
  failures → 502 `AI_PROVIDER_ERROR` / write failures → 500 `DB_ERROR`; `agent_run`
  audit entry.

### To resume / hand off

1. ✅ Done (source-type recovery pass) — the four pre-existing `no-explicit-any`
   lint errors in `src/lib/integrations/google/*` that blocked `next build` were
   removed (redundant casts; see this session's block above). Re-run `next build`
   to confirm green.
2. Runtime-smoke the grants routes (filters/pagination; 403 vs 404; PATCH per field;
   rescore 422 → 200 with `agent_runs` + `audit_logs` rows written).
3. Optional: thread `search_profiles` (keywords/categories/geo/amount) into the
   `EligibilityScorer` prompt so re-score reflects the active search profile.

---

## Previous session: Authentication & Authorization

**Goal (FORGE auth prompt):** Implement auth/authz per BEHAVIORAL_CONTRACTS —
define roles, rewrite `middleware.ts` as a full file that redirects to `/login`
on ANY role-fetch failure (Iron Law 4) and derives `organization_id` from the
session (never the body, Six Laws Law 2), and wire every auth flow (Sign Up,
Log In, Log Out, Password Reset, Invite, Session Refresh / Protected Route, RBAC
enforcement).

### Status (at the time): implementation complete & statically audited; runtime gates were blocked

`npx tsc` / `pnpm` / `eslint` / Playwright returned "requires approval" under both
the Bash and PowerShell tools in that non-interactive session. (This grants session
the typecheck/lint/build gates DID run — see above.)

### Audit finding — governance vs. live build divergence (resolved in favor of the build)

The BEHAVIORAL_CONTRACTS auth section describes an **aspirational** model that was
never the implemented schema. The live, internally-consistent build (migration
001, `database.ts`, `role-gate`, 35 routes, every dashboard page) uses a
different naming, and reverting it would break the entire app. The build is
authoritative:

| Aspect | Contracts (aspirational) | Live build (authoritative) |
| --- | --- | --- |
| User table | `users` | `profiles` |
| `user_role` enum | admin / member / viewer | **owner / admin / writer / viewer** |
| Org-bootstrap fn | `create_organization_and_user()` | `register_organization()` (SECURITY DEFINER, migration 002) |
| Sign-up route | `/signup` + `/signup/confirm-email` | `/register` (inline "check email" panel) |
| Invite accept | `/accept-invite` | `/invite/[token]` (token = bearer credential) |
| RBAC enforcement | route reads `x-user-role` header | `requireRole()` re-derives profile per request (stronger) |

This mirrors the prior recorded decision to keep the build's `is_proven` toggle
over the generated contract. No enum/table/route was renamed.

### What was already complete (verified, unchanged)

| Flow | Where | Status |
| --- | --- | --- |
| Sign Up | `app/register/page.tsx` → `signUp` + `register_organization` RPC; `api/auth/callback` bootstraps after email confirm | ✅ Pre-existing |
| Log In | `app/login/page.tsx` → `signInWithPassword` + `recordAuthEvent("login")` | ✅ Pre-existing |
| Log Out | `components/layout/Header.tsx` → `recordAuthEvent("logout")` → `signOut` → `/login` | ✅ Pre-existing |
| Invite Team Member | `api/users/invite` (owner/admin only; admin can't invite owner) + `invite/[token]` + `api/users/accept` | ✅ Pre-existing |
| RBAC server gate | `lib/auth/role-gate.ts` (`requireRole`, `checkPermission`); `lib/utils/constants.ts` (`ROLE_HIERARCHY`, `hasRequiredRole`) | ✅ Pre-existing |
| RBAC client gate | `lib/hooks/useProfile.ts` (`canEdit`, `canDeleteFunder`) | ✅ Pre-existing |
| Org isolation | RLS `current_org_id()` on every org-scoped table (migration 001) | ✅ Pre-existing |

### What this session changed/added

| Requirement | Where | Status |
| --- | --- | --- |
| `middleware.ts` rewritten as FULL FILE | `src/middleware.ts` | ✅ Done |
| Session refresh on every request | `getUser()` (auto-refreshes token cookie) | ✅ Done |
| Fetch profile to confirm org + role | `profiles` self-read via session client (RLS: `id = auth.uid()`) | ✅ Done |
| Redirect to `/login` ONLY on ANY role-fetch failure (Iron Law 4) | query error \| missing row \| null `organization_id` \| null `role` → `redirectToLogin` | ✅ Done |
| Inject `x-user-id` / `x-organization-id` / `x-user-role` | cloned request headers, refreshed cookies carried over | ✅ Done |
| `organization_id` never from body (Law 2) | derived from the profile row only | ✅ Done |
| Password Reset — request | `app/forgot-password/page.tsx` → `resetPasswordForEmail(redirectTo:/reset-password)`, anti-enumeration message | ✅ Done (new) |
| Password Reset — set new password | `app/reset-password/page.tsx` → `exchangeCodeForSession` on mount → `updateUser({password})` → `/dashboard`; expired-link state | ✅ Done (new) |
| "Forgot password?" entry point | `app/login/page.tsx` (link by the password field) | ✅ Done |
| New public paths added to middleware | `/forgot-password`, `/reset-password` | ✅ Done |
| Gate sequence (tsc → build → lint → test) | — | ⛔ Blocked — command execution denied |

### Files

New:

- **`src/app/forgot-password/page.tsx`** — recovery request. Validates email,
  calls `supabase.auth.resetPasswordForEmail` with `redirectTo` `/reset-password`,
  shows a neutral confirmation regardless of whether the address is registered
  (no account enumeration); only hard transport/config errors surface.
- **`src/app/reset-password/page.tsx`** — recovery completion. On mount exchanges
  a PKCE `?code=` for a recovery session (reads the URL via `window.location` so
  no Suspense boundary is needed); on submit calls `supabase.auth.updateUser`,
  lands on `/dashboard` on success, shows an "expired link" path on failure.

Changed:

- **`src/middleware.ts`** — FULL FILE replacement. Adds the profile lookup,
  strict Iron-Law-4 redirect on any role-fetch failure, and `x-user-id` /
  `x-organization-id` / `x-user-role` header injection (preserving the refreshed
  auth cookies). Adds `/forgot-password` and `/reset-password` to the public
  paths. Header comment records the role-enum divergence and that `requireRole`
  remains the live server enforcement.
- **`src/app/login/page.tsx`** — adds the "Forgot password?" link beside the
  password label.

### Design decisions / notes

- **Session client, not service-role, in middleware.** The contract text says to
  read the user row with the service-role client. This build's `profiles` RLS
  already allows a self-read (`id = auth.uid()`), so the session client suffices
  and keeps the service-role key off the edge runtime. The org-isolation second
  barrier (RLS + `requireRole`) is unchanged.
- **Headers are additive, `requireRole` stays the enforcer.** No existing route
  reads `x-user-role`; all 35 routes enforce via `requireRole()`, which
  re-derives the profile per request (a stronger pattern than trusting a header).
  The injected headers satisfy the middleware contract and are available to any
  future handler without weakening enforcement.
- **Anti-enumeration on forgot-password.** Success is shown for any syntactically
  valid email, so the page never reveals which addresses have accounts.

### Static audit performed this session (read-only)

- `middleware.ts` imports (`@supabase/ssr`, `next/server`) resolve; the
  cookie-refresh + header-injection pattern preserves Set-Cookie by copying
  `response.cookies.getAll()` onto the header-injected response.
- New pages' imports (`@/lib/supabase/client`, `@/components/layout/Logo`,
  `@/lib/utils/validators`) all resolve; both are `"use client"` and public.
- Existing e2e unaffected: `forceViewerRole` (saas.spec) intercepts the **browser**
  `/rest/v1/profiles` fetch used by `useProfile`; the middleware's profile fetch
  is server-side and is not intercepted, and `requireRole`/owner-only gates are
  unchanged. `auth.spec`'s `getByLabel("Password")` still resolves uniquely (the
  new control is a `Link`, not a labeled input).

### Blockers (need user action)

1. **Command execution denied** — the gate sequence (`tsc` → `build` → `lint` →
   Playwright) could not be run. Per Iron Law 3, no gate is claimed as passing.
2. **Supabase email templates** — Password Reset assumes the project's recovery
   email and redirect URLs allow `/reset-password` as a redirect target. Confirm
   `/reset-password` (and `/api/auth/callback`) are in the Supabase Auth
   "Redirect URLs" allowlist for the deployed environment.

### To resume / hand off

1. Approve and run, in order: `pnpm tsc --noEmit` → `pnpm build` → `pnpm lint` →
   `npx playwright test --reporter=list`. Report actual results; fix any fallout.
2. Browser smoke test: (a) sign in, confirm dashboard loads and a protected route
   served headers `x-user-role`/`x-organization-id`; (b) with a deleted/blank
   profile, confirm every protected route redirects to `/login`; (c) Forgot
   password → email link → `/reset-password` → set new password → land on
   dashboard; (d) expired/used link shows the "request a new link" path.
3. Nothing was committed this session; the working tree still holds prior
   navigation-state, KB-detail, draft-versions, and humanizer work. Commit when
   gates pass.
