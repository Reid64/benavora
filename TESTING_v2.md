# BENAVORA — Testing Strategy v2.0
## Supersedes: TESTING.md v1.0 + TESTING-GUIDE.md
## Date: July 17, 2026
## Status: CANONICAL — All test types, schedules, and CI/CD requirements defined here.
## Automation: GitHub Actions runs full suite nightly at 11PM CST (5AM UTC).

---

## Testing Philosophy

**Rule 1:** No feature ships without at least one unit test, one integration test, and one E2E path.
**Rule 2:** Every previously fixed bug gets a regression test before the fix is merged.
**Rule 3:** FORGE validates compile gates only — all runtime behavior is validated by this test suite.
**Rule 4:** Visual regression tests are the source of truth for UI quality — not human memory.
**Rule 5:** Test coverage of AI routes must mock the Anthropic API — never call the real API in tests.

---

## Test Stack

| Type | Tool | Location | Command |
|---|---|---|---|
| Unit | Jest + ts-jest | `src/__tests__/unit/` | `pnpm test:unit` |
| Integration | Jest + Supabase | `src/__tests__/integration/` | `pnpm test:integration` |
| E2E | Playwright | `e2e/` | `pnpm test:e2e` |
| Visual Regression | Playwright | `e2e/visual/` | `pnpm test:visual` |
| Smoke | Jest | `src/__tests__/smoke/` | `pnpm test:smoke` |
| API | Jest + supertest | `src/__tests__/api/` | `pnpm test:api` |
| Accessibility | axe-playwright | `e2e/a11y/` | `pnpm test:a11y` |
| Cross-Browser | Playwright multi | `e2e/` | `pnpm test:cross-browser` |
| Performance/Soak | Custom CLI | `scripts/test-soak.ts` | `pnpm test:soak` |
| Migration | Custom | `src/__tests__/migrations/` | `pnpm test:migrations` |

**Jest config:** `jest.config.ts` — preset ts-jest, environment node, `@/` alias mapped to `src/`
**Playwright config:** `playwright.config.ts` — base URL from env, 3 browsers, screenshot on failure

---

## Package.json Scripts

```json
{
  "test": "jest",
  "test:unit": "jest src/__tests__/unit",
  "test:integration": "jest src/__tests__/integration",
  "test:smoke": "jest src/__tests__/smoke",
  "test:api": "jest src/__tests__/api",
  "test:migrations": "jest src/__tests__/migrations",
  "test:e2e": "playwright test e2e/",
  "test:visual": "playwright test e2e/visual/",
  "test:a11y": "playwright test e2e/a11y/",
  "test:cross-browser": "playwright test --project=chromium --project=firefox --project=webkit",
  "test:soak": "tsx scripts/test-soak.ts",
  "test:all": "pnpm test:unit && pnpm test:integration && pnpm test:smoke && pnpm test:api"
}
```

---

## Section 1: Unit Tests

Location: `src/__tests__/unit/`
Run time: < 30 seconds total
Mocks: All DB calls mocked. All Anthropic API calls mocked. No network calls.

### 1.1 Intelligence Engine Tests

**File:** `src/__tests__/unit/grant-probability-engine.test.ts`
- computeGrantProbability returns score between 0 and 100
- Score is 0 when deadline is past
- Confidence is 'high' when all 4 factors have real data
- Confidence is 'low' when 0 factors have real data
- Recommendation is 'apply' when score >= 70
- Recommendation is 'skip' when score < 40
- Recommendation is 'consider' when score is 40-69
- Returns valid object structure even when opportunity has no eligibility_score

**File:** `src/__tests__/unit/semantic-matcher.test.ts`
- matchFunders returns empty array when no foundations exist
- Score is between 0 and 1 for all results
- Results are sorted by score descending
- State filter correctly reduces results
- Tokenizer removes stop words correctly

**File:** `src/__tests__/unit/digital-twin-builder.test.ts`
- buildDigitalTwin returns valid twin object structure
- twin_completeness_score is 0 when org has no KB entries or outcomes
- twin_completeness_score is 100 when all 10 factors are present
- service_areas extracted from org.city + org.state when not explicitly set
- proven_narrative_patterns populated from awarded outcome KB categories

**File:** `src/__tests__/unit/success-probability.test.ts`
- computeSuccessProbability returns score 0-100
- Factor 2 (category win rate) defaults to 0.3 when no outcome history
- Factor 3 (deadline proximity) returns 0 when deadline is under 15 days
- Factor 4 (knowledge base) returns 0.2 when no KB entries

**File:** `src/__tests__/unit/deadline-predictor.test.ts`
- predictDeadlines returns array (may be empty)
- Predictions include confidence score between 0 and 1
- Predictions include basis string
- Historical patterns correctly calculate average day-of-year

**File:** `src/__tests__/unit/relationship-scorer.test.ts`
- computeRelationshipScore returns score 0-100
- Award event contributes +30
- Rejection event contributes -10
- Score is capped at 100 on overflow
- Score is floored at 0 on underflow
- Momentum is 'rising' when last 90 days score exceeds prior 90 days

**File:** `src/__tests__/unit/board-report-generator.test.ts`
- generateBoardReport returns all required fields
- Returns zero-value metrics when org has no data
- Date range correctly filters opportunities and applications
- Narrative summary is non-empty string

**File:** `src/__tests__/unit/knowledge-engine.test.ts`
- queryKnowledgeEngine returns {patterns, proposals, insights} structure
- Empty results return empty arrays not null
- Query logged to knowledge_queries table

**File:** `src/__tests__/unit/outcome-analyzer.test.ts`
- analyzeOutcomes returns successRate null when outcomes < MIN_OUTCOMES_FOR_RATE
- successRate calculated correctly for awarded/total ratio
- totalAwarded sums awarded_amount for result='awarded' only
- Empty array returns all null/zero values safely

### 1.2 Data Pipeline Tests

**File:** `src/__tests__/unit/propublica-client.test.ts`
- enrichFoundationFromProPublica returns null on 404
- enrichFoundationFromProPublica returns null on network error
- Returns structured object with correct field mapping on success
- Rate limit delay is enforced between calls

**File:** `src/__tests__/unit/samgov-client.test.ts`
- Correctly maps SAM.gov response fields to opportunity schema
- Deduplicates by external_id
- Returns empty array on API error

**File:** `src/__tests__/unit/naics-labels.test.ts`
- NAICS_FRIENDLY_LABELS contains entries for all major sectors
- NAICS_CATEGORIES groups codes correctly
- No duplicate NAICS codes across categories

---

## Section 2: Integration Tests

Location: `src/__tests__/integration/`
Run time: < 2 minutes
Uses: Real Supabase test instance (separate from production)
Test org: Created fresh per test run, deleted after

**Environment:** Requires `SUPABASE_URL_TEST` and `SUPABASE_SERVICE_ROLE_KEY_TEST` env vars.

### 2.1 Database Round-Trip Tests

**File:** `src/__tests__/integration/organizations.test.ts`
- Create organization — verify all required fields persisted
- RLS: org A cannot read org B's data with org A's JWT
- onboarding_completed defaults to false on creation
- subscription_tier defaults to 'free'

**File:** `src/__tests__/integration/opportunities.test.ts`
- Create opportunity — verify all fields persisted including probability_score null
- Update probability_score — verify opportunity_probability_scores upsert
- Filter by probability_score range returns correct subset
- Filter by status returns correct subset
- Soft delete (status='closed') removes from default query

**File:** `src/__tests__/integration/applications.test.ts`
- Stage transition writes application_stage_history record
- Clone writes new application with draft_content adapted
- Budget upsert merges line_items correctly
- Reconciliation reads budget and expenses, writes report

**File:** `src/__tests__/integration/agent-runs.test.ts`
- Insert agent_run with status='pending'
- Update to 'completed' with output_summary
- Query by agent_type returns correct subset
- Org scoping confirmed — other org's runs invisible

**File:** `src/__tests__/integration/foundation-directory.test.ts`
- Read foundation by EIN
- Upsert enrichment jsonb merges (does not overwrite) existing fields
- enrichment_completed_at updates correctly
- GIN index query on enrichment jsonb executes under 100ms for 133K records

**File:** `src/__tests__/integration/corporate-prospects.test.ts`
- Insert corporate_prospect — verify unique constraint on (legal_name, city, state)
- Upsert scores jsonb — verify all 10 scores present
- Upsert giving_dna jsonb — verify primary_style populated
- GIN index query on scores executes correctly

**File:** `src/__tests__/integration/digital-twins.test.ts`
- Upsert organizational_digital_twins — verify UNIQUE(org_id)
- twin_completeness_score persists correctly
- Rebuild (upsert) does not create duplicate records

**File:** `src/__tests__/integration/discovery-matches.test.ts`
- Insert discovery_match — verify org scoping
- Status update (pending → added) persists
- Dismissed matches excluded from pending count

### 2.2 RLS Policy Tests

**File:** `src/__tests__/integration/rls.test.ts`
- Every org-scoped table: cross-org SELECT returns 0 rows
- Every org-scoped table: cross-org INSERT returns RLS violation
- Every org-scoped table: cross-org UPDATE returns 0 rows affected
- Service role bypasses RLS correctly
- Shared tables (foundation_directory, corporate_prospects): readable by all orgs
- pig_nodes and pig_edges: readable by all, writable by service role only

---

## Section 3: API Tests

Location: `src/__tests__/api/`
Run time: < 3 minutes
Uses: Supertest against local Next.js dev server

### 3.1 Authentication Tests (all routes)

Every protected API route must be tested for:
- No auth token → 401
- Expired token → 401
- Valid token, wrong org → 403 or 404
- Viewer role on write endpoints → 403

### 3.2 Core API Route Tests

| Route | Test Cases |
|---|---|
| GET /api/opportunities | Auth, tenant scope, probability filter, status filter, sort by probability |
| POST /api/opportunities | Auth, required fields, opportunity_keywords created |
| PATCH /api/opportunities/[id] | Auth, valid fields, cross-tenant 404 |
| POST /api/intelligence/grant-probability | Auth, valid opportunity returns score object, missing opportunity 404 |
| GET /api/intelligence/digital-twin | Auth, returns twin or empty twin for new org |
| POST /api/intelligence/digital-twin | Auth, triggers rebuild, returns updated twin |
| POST /api/intelligence/knowledge-query | Auth, valid query returns {patterns, proposals, insights} |
| POST /api/intelligence/reputation | Auth, valid entity returns signals array |
| PATCH /api/intelligence/reputation | Auth, valid alertId updates status |
| GET /api/agents/registry | Auth, returns all agents with org-specific enabled status |
| POST /api/agents/registry/configure | Auth, upserts agent_configurations, viewer 403 |
| POST /api/agents/discovery | Auth, triggers discovery run, returns {matched, found, sources} |
| POST /api/agents/morning-digest | Auth, creates alert if matches exist |
| GET /api/agents/disaster | Auth, returns FEMA declarations array |
| POST /api/agents/disaster | Auth, creates disaster_response_campaigns record |
| POST /api/applications/[id]/clone | Auth, creates new application with adapted draft |
| POST /api/applications/[id]/budget | Auth, upserts grant_budgets |
| GET /api/applications/[id]/reconcile | Auth, returns reconciliation report |
| GET /api/foundations | Auth (shared data — all orgs can read), pagination |
| GET /api/foundations/[id]/profile | Auth, returns profile or triggers computation |
| POST /api/import/csv | Auth, valid mapping imports records, returns counts |
| GET /api/reports/board-report | Auth, date range required, returns all fields |
| POST /api/compliance/events | Auth, required fields, recurrence creates future events |
| GET /api/match/foundations | Auth, mission required, returns ranked array |
| POST /api/donor-discovery/discover | Auth, naicsCode required, returns prospects |
| POST /api/donor-discovery/prospects/[id]/route-to-autoapply | Auth, returns queued status |
| POST /api/donor-discovery/prospects/[id]/route-to-email | Auth, creates campaign record |
| GET /api/admin/platform-metrics | Owner role only, returns platform-wide metrics |
| POST /api/admin/orgs/[id]/suspend | Owner role only, updates org status |
| POST /api/consultant/clients | Owner role only, creates access record |

---

## Section 4: E2E Tests (Playwright)

Location: `e2e/`
Run time: < 10 minutes
Base URL: `process.env.BASE_URL` (local or Vercel preview)
Auth: Test account `beta1@benavora-test.com` / `BetaTest2026` (onboarding_completed=true)

### 4.1 Authentication Flow
**File:** `e2e/auth.spec.ts`
- Register new account → lands on onboarding
- Login with valid credentials → lands on dashboard
- Login with invalid credentials → shows error toast
- Session expiry → redirect to login
- Skip onboarding → lands on dashboard with all features accessible

### 4.2 Dashboard
**File:** `e2e/dashboard.spec.ts`
- FlightPathHUD renders 6 colored cards
- Each HUD card flip shows back face on hover
- Each HUD card click navigates to correct page
- Today's Action Items rows are clickable
- Upcoming Deadlines panel shows dark navy styling
- Quick Actions buttons navigate correctly

### 4.3 Opportunity Probability Engine
**File:** `e2e/probability.spec.ts`
- Opportunity list shows probability badges with correct colors
- Sort by Probability (High to Low) reorders list
- Filter by 70%+ shows only high-probability opportunities
- Run Scoring button triggers batch score and shows completion toast
- Clicking opportunity navigates to detail page

### 4.4 Application Pipeline
**File:** `e2e/pipeline.spec.ts`
- Kanban board renders all 12 stage columns
- Drag card between stages — card moves and toast shown
- Click card opens application detail
- Generate Draft button shows loading then draft content
- Clone button opens opportunity selector modal

### 4.5 Research Hub
**File:** `e2e/research.spec.ts`
- Research resources grid renders 21 pinned cards
- Search filters cards in real time
- Funder Match textarea + submit returns results
- Run Discovery button triggers discovery run and shows toast

### 4.6 Intelligence Hub
**File:** `e2e/intelligence.spec.ts`
- Digital Twin page loads with completeness score
- Rebuild Twin button triggers rebuild and updates score
- Knowledge Engine query returns results in 3 sections
- Reputation monitor shows alert cards with severity colors
- Disaster Response page shows FEMA declarations

### 4.7 Agent Marketplace
**File:** `e2e/agent-marketplace.spec.ts`
- /settings/agents renders all agent cards grouped by plan
- Toggle ON enables agent and shows success toast
- Toggle OFF disables agent and shows toast
- Locked agents show lock icon not toggle
- Click lock icon shows upgrade modal

### 4.8 Admin Dashboard
**File:** `e2e/admin.spec.ts`
- /admin loads for owner role
- /admin redirects viewer role to /dashboard
- Platform metrics show counts
- Org list table renders with click-through links

### 4.9 Donor Discovery
**File:** `e2e/donor-discovery.spec.ts`
- NAICS category cards render on /donor-discovery/discover
- Select category shows sub-types
- Search returns prospect cards
- Route to AutoApply shows queued confirmation
- Route to Email shows added confirmation

### 4.10 Import Wizard
**File:** `e2e/import.spec.ts`
- Drop CSV shows preview table (Step 1)
- Column mapping dropdowns populate (Step 2)
- Import executes and shows result counts (Step 3)
- Error CSV shows failed count with error list

### 4.11 Compliance Calendar
**File:** `e2e/compliance.spec.ts`
- /compliance renders event list grouped by month
- Add Event form submits and event appears
- Mark Complete updates event state
- Color coding: overdue=red, this week=amber, upcoming=blue

### 4.12 Financial Reconciliation
**File:** `e2e/financials.spec.ts`
- /financials renders applications with budget data
- Add budget line item updates total
- Reconcile button computes variance and shows compliance badge

---

## Section 5: Visual Regression Tests

Location: `e2e/visual/`
Tooling: Playwright screenshot comparison
Baseline: Committed PNG snapshots in `e2e/visual/snapshots/`
Threshold: Fail on > 2% pixel difference
Run: Nightly + on PR when UI files change

### Pages with Visual Baselines

| Page | Snapshot File | Key Elements |
|---|---|---|
| /dashboard | dashboard.png | HUD cards colors, hero banner, layout |
| /opportunities | opportunities.png | Probability badges, sort controls |
| /applications | applications.png | Kanban columns, card colors |
| /research | research.png | 3x7 resource grid |
| /intelligence/twin | twin.png | Completeness score circle |
| /intelligence/reputation | reputation.png | Alert severity color bands |
| /settings/agents | agents.png | Agent cards, plan badges, toggles |
| /command-center | command-center.png | Dark navy panels |
| /intelligence/disaster | disaster.png | Declaration cards, emergency funds |

### Visual Regression Rules
- Any change to `globals.css` triggers full visual regression suite
- Any change to `src/components/dashboard/` triggers dashboard snapshot update
- Snapshot updates require explicit `pnpm test:visual --update-snapshots` — never auto-update
- Failed visual tests block deployment until reviewed and approved

---

## Section 6: Smoke Tests

Location: `src/__tests__/smoke/`
Purpose: Verify critical routes respond before every deployment
Run time: < 15 seconds

**File:** `src/__tests__/smoke/api-smoke.test.ts`

Routes tested (expect non-500, accept 200 or 401):
- GET /api/alerts
- GET /api/opportunities
- GET /api/funders
- GET /api/agents/research/status
- GET /api/automation/stats
- GET /api/foundations
- GET /api/agents/registry
- GET /api/intelligence/digital-twin
- GET /api/admin/platform-metrics
- GET /api/donor-discovery/prospects

**Smoke test rule:** If any smoke test fails, deployment is blocked. No exceptions.

---

## Section 7: Database Migration Tests

Location: `src/__tests__/migrations/`
Purpose: Verify every migration is idempotent and non-destructive

**File:** `src/__tests__/migrations/idempotency.test.ts`
- Run each migration SQL twice — second run must not error
- All `CREATE TABLE IF NOT EXISTS` verified present
- All `CREATE INDEX IF NOT EXISTS` verified present
- All foreign key constraints verified present
- Column types match schema registry spec

**File:** `src/__tests__/migrations/data-integrity.test.ts`
- Insert with NULL organization_id fails with constraint violation
- Insert with invalid enum value fails with constraint violation
- Insert duplicate EIN in foundation_directory fails with unique violation
- Insert duplicate (legal_name, city, state) in corporate_prospects fails

---

## Section 8: Accessibility Tests

Location: `e2e/a11y/`
Tool: @axe-core/playwright
Standard: WCAG 2.1 AA
Violations allowed: 0 critical, 0 serious

**File:** `e2e/a11y/pages.spec.ts`

Pages scanned:
- /dashboard
- /opportunities
- /applications
- /research
- /intelligence
- /settings/agents
- /donor-discovery
- /compliance
- /reports
- /admin (owner session)

Each page: `await checkA11y(page, null, {runOnly: {type: 'tag', values: ['wcag2a', 'wcag2aa']}})`

---

## Section 9: Cross-Browser Tests

Playwright browsers: chromium, firefox, webkit (Safari)
Run: Nightly + before production deploy

Critical paths tested across all 3 browsers:
- Login → Dashboard render
- FlightPathHUD flip animation
- Opportunity list with probability badges
- Application kanban drag-and-drop
- Agent marketplace toggle

---

## Section 10: Soak Tests

Location: `scripts/test-soak.ts`
Purpose: Verify enrichment engine handles sustained load without memory leak or rate limit failures
Schedule: Weekly (Sunday 2AM CST)

**Soak scenario 1 — Foundation Enrichment:**
- Run enrichFoundationFromProPublica for 500 records
- Assert: no crashes, error rate < 5%, average response time < 2 seconds, no duplicate writes

**Soak scenario 2 — Probability Scoring:**
- Run computeGrantProbability for 1,000 opportunities across 10 orgs
- Assert: all scores between 0-100, no null scores, runtime < 30 minutes

**Soak scenario 3 — Discovery Agent:**
- Run runOpportunityDiscovery 50 consecutive times with 1 second delay
- Assert: no rate limit errors, dedup works correctly across runs, no duplicate discovery_matches

---

## Section 11: Regression Tests

**Rule:** Every bug fixed in production gets a regression test before the fix merges.

**File:** `src/__tests__/unit/regressions.test.ts`

Current regression tests:
- IRS 990 stream parser: EIN at position 1 (zero-indexed) returns non-null value
- IRS 990 stream parser: column headers trimmed before lookup (trailing carriage return handled)
- Chunked Supabase .in() query: batches of 100 UUIDs max (PostgREST 400 fix)
- FlightPathHUD: accentColor applied to front face backgroundColor (not back face only)
- PowerShell Set-Content with [id] path: use [IO.File]::WriteAllText instead

---

## Section 12: CI/CD Pipeline

### GitHub Actions Workflows

**File:** `.github/workflows/daily-tests.yml`
```yaml
name: Daily Test Suite
on:
  schedule:
    - cron: '0 5 * * *'  # 11PM CST = 5AM UTC
  push:
    branches: [main]
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '18'
      - run: npm install -g pnpm
      - run: pnpm install
      - run: pnpm test:unit
      - run: pnpm test:smoke
      - run: pnpm test:api
      - run: pnpm test:migrations
```

**File:** `.github/workflows/deploy-check.yml`
```yaml
name: Deploy Check
on:
  push:
    branches: [main]
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '18'
      - run: npm install -g pnpm
      - run: pnpm install
      - run: pnpm build
```

**File:** `.github/workflows/e2e.yml`
```yaml
name: E2E Tests
on:
  schedule:
    - cron: '30 5 * * *'  # 11:30PM CST
jobs:
  e2e:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '18'
      - run: npm install -g pnpm
      - run: pnpm install
      - run: pnpm exec playwright install --with-deps
      - run: pnpm test:e2e
      - uses: actions/upload-artifact@v4
        if: failure()
        with:
          name: playwright-report
          path: playwright-report/
```

### Test Results Dashboard

**Route:** `/platform/test-results` (owner/admin only)

Displays:
- Pass/fail count per test category (unit, integration, smoke, E2E, visual)
- Last run timestamp per category
- Trend chart: pass rate over last 30 days
- Failed test names with expandable error output
- Visual regression diff viewer for failed snapshots

**Schema:**
```sql
CREATE TABLE IF NOT EXISTS test_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_date timestamptz NOT NULL DEFAULT now(),
  test_type text NOT NULL,
  passed integer DEFAULT 0,
  failed integer DEFAULT 0,
  skipped integer DEFAULT 0,
  duration_seconds integer,
  error_summary jsonb DEFAULT '[]',
  triggered_by text DEFAULT 'github-actions'
);
CREATE INDEX IF NOT EXISTS idx_test_runs_date ON test_runs(run_date DESC);
```

---

## Section 13: Test Data Management

### Beta Test Accounts
- `beta1@benavora-test.com` / `BetaTest2026` — onboarding_completed=true, use for E2E tests
- `beta2@benavora-test.com` / `BetaTest2026` — fresh account for onboarding flow tests
- `beta3@benavora-test.com` / `BetaTest2026` — viewer role for RBAC tests

### Test Data Rules
- Never run seed scripts in production — only against test Supabase instance
- Seed script is NOT idempotent — truncate tables before re-seeding
- E2E tests must clean up after themselves — delete created records in afterEach
- Never hardcode production org IDs in test files — use env vars

### Mock Strategy for AI Routes
All Anthropic API calls in tests use Jest mocks:
```typescript
jest.mock('@anthropic-ai/sdk', () => ({
  Anthropic: jest.fn().mockImplementation(() => ({
    messages: {
      create: jest.fn().mockResolvedValue({
        content: [{ type: 'text', text: '{"score": 75, "confidence": "medium"}' }]
      })
    }
  }))
}));
```

Never call the real Anthropic API in any test. Token costs and rate limits make this impractical.

---

## Section 14: Pre-Deploy Checklist

Before every production deploy (manual or automated):

- [ ] `pnpm build` passes with zero TypeScript errors
- [ ] `pnpm test:smoke` passes — all critical routes return non-500
- [ ] `pnpm test:unit` passes — zero unit test failures
- [ ] `pnpm test:api` passes — zero API contract failures
- [ ] No visual regression failures on dashboard, opportunities, or agent marketplace
- [ ] `npx vercel deploy --prod` run manually (GitHub auto-deploy is broken)
- [ ] Hard refresh on production URL confirms changes are live
- [ ] FlightPathHUD stage colors verified in browser DevTools (inline styles rendering)

---

## Section 15: Test Gate Budget & Suite Split (AR-8.2, 2026-09-18)

**Canonical budget file:** `test-evidence/TEST_GATE_BUDGET.md` — measured
numbers live there and are re-measured on a trigger, not on a schedule.

### The lanes

| Lane | Command | Config | In FORGE gate? | Measured |
|---|---|---|---|---:|
| Unit / default gate | `pnpm test`, `pnpm test:unit` | `vitest.config.ts` | **yes** | **13-14s cold / 27s post-build** |
| Integration (live) | `pnpm test:integration` | `vitest.integration.config.ts` | no | **380s** |
| E2E | `pnpm test:e2e` | `playwright.config.ts` | no | separate lane |

**FORGE gate ceiling: 300s.** Default gate uses 9% of it. **Headroom: 91%.**

Measure the gate *after* a build, never in isolation: FORGE runs test
immediately after `pnpm run build`, which roughly doubles wall-clock
(14s → 27s). Cold numbers understate what the gate pays.

### Rule 6 (new)

**The default `pnpm test` suite must never contain a test requiring live
network, live DB credentials, or a real browser.** Those live in
`src/__tests__/integration/` and `src/__tests__/integration-live/`, are
excluded by glob from `vitest.config.ts`, and run only via
`pnpm test:integration`.

This is not a style preference. On 2026-09-17 the gate was killed at 300s
during AR-7.1 on correct work, because those files were still in the default
glob. Measured alone they take 380s — they exceed the gate ceiling unaided,
so the gate could not have passed regardless of code quality. A gate that
times out on healthy work is a false fail: the same defect class as a gate
that passes broken work.

### Known doc drift (not fixed here)

The **Test Stack** table above (line ~19) and **Section 2** still describe
**Jest + ts-jest** and a `jest.config.ts`. The repo has used **Vitest**
since before this measurement; there is no `jest.config.ts`. Several script
names in that table (`test:api`, `test:a11y`, `test:cross-browser`,
`test:soak`, `test:migrations`) do not exist in `package.json`. Flagged for a
human decision rather than silently rewritten, since correcting it touches
sections beyond AR-8.2 scope.
