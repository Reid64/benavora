# BENAVORA — Testing Strategy v2.0
## Supersedes: TESTING.md v1.0 + TESTING-GUIDE.md
## Rewritten: July 29, 2026 — prior version described a Jest-based stack that never existed in this repo. This version is verified against the real `vitest.config.ts`, `playwright.config.ts`, `package.json`, and a full file listing of `src/__tests__/`, `tests/`, and `e2e/` as of this date.
## Status: CANONICAL — reflects what is actually on disk, not an aspirational stack.

---

## Testing Philosophy

**Rule 1:** No feature ships without at least one unit test, one integration test, and one E2E path. *(Aspirational — not consistently enforced today; see gaps noted throughout this document.)*
**Rule 2:** Every previously fixed bug gets a regression test before the fix is merged. *(Aspirational — no dedicated regression-test file exists in this repo; see Section 6.)*
**Rule 3:** FORGE validates compile gates only — all runtime behavior is validated by this test suite.
**Rule 4:** Visual regression tests are the source of truth for UI quality — not human memory. *(Aspirational — no visual regression tooling exists in this repo; see Section 7.)*
**Rule 5:** Test coverage of AI routes must mock the Anthropic API — never call the real API in tests. *(True today — `tests/setup.ts` mocks `@anthropic-ai/sdk` via Vitest's `vi.mock`, loaded as Vitest's global `setupFiles` entry. E2E tests under `tests/e2e/`/`e2e/` run against the real dev server and real Supabase project per their own file-header comments — Rule 5 applies to the Vitest suite, not E2E.)*

---

## Test Stack (real)

| Type | Tool | Config | Command |
|---|---|---|---|
| Unit / integration (Vitest) | Vitest 2.x + `@vitest/coverage-v8` | `vitest.config.ts` | `pnpm test:unit` |
| E2E | Playwright (`@playwright/test`) | `playwright.config.ts` | `pnpm test:e2e` |
| Smoke (Vitest, API status codes) | Vitest | `vitest.config.ts` | `pnpm test:smoke` |
| Smoke (Playwright, real browser) | Playwright | `playwright.config.ts` (project `public`, file `tests/smoke.spec.ts`; project `critical-paths`, file `e2e/smoke.spec.ts`) | part of `pnpm test:e2e` / `pnpm test` |

There is no Jest anywhere in this repo — no `jest.config.ts`, no `ts-jest`, no `jest` dependency in `package.json`. There is no separate "integration" or "API" test *tool* distinct from Vitest — API-route tests (`tests/api/`) are plain Vitest test files that mock Supabase and Anthropic, not a Supertest-against-a-live-server setup.

**Vitest config (`vitest.config.ts`, verbatim structure):**
- `environment: "node"`
- `include`: `src/**/*.test.ts`, `src/**/*.spec.ts`, `tests/**/*.test.ts`
- `exclude`: `node_modules`, `.next`, `tests/e2e/**`
- `passWithNoTests: true`
- `setupFiles: ["tests/setup.ts"]` — mocks `@supabase/ssr`, `next/headers`, and `@anthropic-ai/sdk` globally for every Vitest run
- `testTimeout: 30000`
- `coverage`: provider `v8`, threshold `lines: 60`
- alias: `@` → `./src`

Because `exclude` only excludes `tests/e2e/**` and `include` only matches `.test.ts`/`.spec.ts` files under `src/` and `tests/`, the root-level `e2e/*.spec.ts` files are **not** picked up by Vitest at all — they exist entirely outside the Vitest include pattern and are Playwright-only.

**Playwright config (`playwright.config.ts`, verbatim structure):**
- `testDir: "."` (project root) — both `tests/` and `e2e/` are resolved from here; `testIgnore` excludes `.claude/**` and `node_modules/**` so nested worktree checkouts don't multiply the suite.
- Four projects:
  - `setup` — runs `tests/e2e/auth.setup.ts`, authenticates the dedicated test owner, seeds a minimal real dataset, saves browser storage state.
  - `public` — unauthenticated flows: `tests/smoke.spec.ts` + `tests/e2e/public/**/*.spec.ts`. No session.
  - `authed` — everything under `tests/e2e/authed/**/*.spec.ts`. Depends on `setup`, reuses its saved storage state (`tests/e2e/.auth/owner.json`).
  - `critical-paths` — the root-level `e2e/**/*.spec.ts` files. Depends on `setup`; these specs perform their own login (`PLAYWRIGHT_TEST_EMAIL`/`PLAYWRIGHT_TEST_PASSWORD` env vars, falling back to the dedicated test account in `tests/e2e/helpers.ts`).
- `webServer`: runs `pnpm dev` automatically, reuses an existing server outside CI.
- `globalSetup: "./tests/e2e/global-setup.ts"` — ensures the Chromium binary is installed before any project launches a browser.
- E2E tests run against the **real** Supabase project and a **real** dev server (no mocks) — this is explicit in `tests/e2e/helpers.ts`'s own header comment, citing CLAUDE.md Iron Law #8.

---

## Package.json Scripts (real, verbatim from `package.json`)

Only test-relevant scripts are shown here (the file also has ~60 non-test scripts for scraping/ingestion/enrichment CLIs, out of scope for this document):

```json
{
  "lint": "next lint",
  "typecheck": "tsc --noEmit",
  "test": "playwright test --reporter=list",
  "test:unit": "vitest run",
  "test:all": "vitest run && playwright test --reporter=list",
  "test:watch": "vitest",
  "test:coverage": "vitest run --coverage",
  "test:smoke": "vitest run src/__tests__/smoke",
  "test:e2e": "playwright test",
  "test:e2e:ui": "playwright test --ui"
}
```

Notes on what this actually means:
- **`pnpm test` runs Playwright, not Vitest.** This is easy to misread — the bare `test` script is the full E2E suite (`playwright test --reporter=list`), covering all four Playwright projects above. Unit tests must be invoked explicitly via `pnpm test:unit`.
- **`test:smoke` is a Vitest run**, not a Playwright run — it runs only `src/__tests__/smoke/` (see Section 2 below). The separate Playwright smoke specs (`tests/smoke.spec.ts`, `e2e/smoke.spec.ts`) run as part of `test:e2e`/`test`, not `test:smoke`.
- **`test:all` runs both suites back to back** (Vitest, then the full Playwright suite).

**Scripts referenced by the prior version of this document that do not exist in `package.json` and are NOT yet implemented:** `test:integration`, `test:api`, `test:migrations`, `test:visual`, `test:a11y`, `test:cross-browser`, `test:soak`. If any of these are wanted, they need to be added — do not assume they exist because a prior doc described them.

---

## Section 1: Real File Inventory

This is the complete, verified file list under `src/__tests__/`, `tests/`, and `e2e/` as of July 29, 2026 (via a recursive file listing of all three directories) — not a curated subset.

### 1.1 `src/__tests__/` — Vitest (picked up by `include: "src/**/*.test.ts"`)

| File | Covers |
|---|---|
| `src/__tests__/smoke/api-smoke.test.ts` | API smoke checks — the file Vitest runs via `pnpm test:smoke` |
| `src/__tests__/unit/board-report.test.ts` | `generateBoardReport()` |
| `src/__tests__/unit/semantic-matcher.test.ts` | `matchFunders()` |
| `src/__tests__/unit/success-probability.test.ts` | `computeSuccessProbability()` |

Note: the prior version of this document named a file `board-report-generator.test.ts` — the real file is `board-report.test.ts`. It also listed unit test files for `grant-probability-engine`, `digital-twin-builder`, `deadline-predictor`, `relationship-scorer`, `knowledge-engine`, `outcome-analyzer`, `propublica-client`, `samgov-client`, and `naics-labels` — **none of these exist**. Only the four files above are real.

### 1.2 `tests/api/` — Vitest, API route logic (mocked Supabase/Anthropic, not a live server)

| File | Covers (from real `describe()` blocks) |
|---|---|
| `tests/api/admin-sales.test.ts` | Admin route 403 gating for non-admins; `POST /api/admin/domains`; `POST /api/admin/prospects` (CSV import); `POST /api/admin/campaigns`; `SalesCampaignEngine.processQueuedSends` suppression check and daily budget enforcement |
| `tests/api/analytics.test.ts` | `GET /api/analytics/summary`, `/funnel`, `/financials` |
| `tests/api/auth.test.ts` | `GET /api/auth/callback`, `POST /api/auth/log-event` |
| `tests/api/autoapply.test.ts` | `POST /api/autoapply/queue`; `GET`/`POST`/`DELETE /api/autoapply/controls` |
| `tests/api/calendar.test.ts` | `POST /api/calendar/sync` |
| `tests/api/donor-discovery-requests.test.ts` | `POST`/`GET /api/donor-discovery/requests`, `GET /api/donor-discovery/requests/[id]` |
| `tests/api/email.test.ts` | `GET /api/email/auth`, `POST /api/email/sync`, `/link`, `/send` |
| `tests/api/grants.test.ts` | `GET /api/grants`, `PATCH /api/grants/[id]`, `GET /api/grants/[id]` |
| `tests/api/intelligence.test.ts` | `POST /api/intelligence/ingest`, `POST /api/intelligence/logic-model` |
| `tests/api/research.test.ts` | `POST /api/agents/research` |

### 1.3 `tests/lib/` — Vitest, library/service-layer unit tests

| File | Covers |
|---|---|
| `tests/lib/compliance.test.ts` | `EmailComplianceEngine.enforceCompliance`, unsubscribe token handling |
| `tests/lib/crawler-core.test.ts` | `DomainRateLimiter`, `normalizeDomain` |
| `tests/lib/directory.test.ts` | `upsertDirectoryRecord`, `findOrCreateProspect` (donor-discovery directory) |
| `tests/lib/encryption.test.ts` | `encryptToken` / `decryptToken` |
| `tests/lib/google-places.test.ts` | Google Places adapter `enumerate()` budget guard |
| `tests/lib/rubric-extractor.test.ts` | `extractRubricFromText`, `extractRubricFromOpportunity` |
| `tests/lib/template-engine.test.ts` | `EmailTemplateEngine.renderTemplate`, `.validateTemplate` |
| `tests/lib/unsubscribe-agent.test.ts` | `UnsubscribeAgent.classifyReply`, `.processIncomingReply` (unsubscribe suppression, positive-reply sequence pause) |
| `tests/lib/warmup-engine.test.ts` | `WarmupEngine.advanceWarmup`, `.getDailyBudget` |

### 1.4 `tests/unit/` — Vitest

| File | Covers |
|---|---|
| `tests/unit/autonomous-base.test.ts` | `AUTONOMOUS_HARD_LIMITS`, `AutonomousAgent#logDecision`/`#startRun`/`#completeRun` |
| `tests/unit/draft-generation.test.ts` | `DraftGenerationAgent` hard limits |

### 1.5 `tests/` support files (not test files themselves — shared fixtures/mocks used by the files above)

| File | Purpose |
|---|---|
| `tests/setup.ts` | Vitest global `setupFiles` entry — mocks `@supabase/ssr`, `next/headers`, `@anthropic-ai/sdk` (see Test Stack section above) |
| `tests/factories/index.ts` | Mock data factories (`createMockOrganization`, etc.) typed against `Tables<...>` from `@/types/database` |
| `tests/helpers/supabase-mock.ts` | Shared Supabase client mock helper |
| `tests/.gitkeep` | Empty placeholder, not a test |

### 1.6 `tests/e2e/` — Playwright support + specs (excluded from Vitest by `vitest.config.ts`'s `exclude`)

| File | Purpose |
|---|---|
| `tests/e2e/auth.setup.ts` | Playwright `setup` project — authenticates the real test owner account, seeds minimal real data, saves storage state |
| `tests/e2e/global-setup.ts` | Ensures Chromium is installed before any project runs |
| `tests/e2e/helpers.ts` | `loadEnv()`, `TEST_USER`/`ONBOARDING_USER`/`ADMIN_NON_OWNER_USER` real test-account definitions (real emails: `owner.e2e@benavora-test.dev`, `onboarding.e2e@benavora-test.dev`, `admin-non-owner.e2e@benavora-test.dev` — **not** the `beta1/2/3@benavora-test.com` accounts a prior version of this document described), seed helpers. Includes a `globalThis.WebSocket` polyfill for Node 20 (required by `@supabase/realtime-js`). |
| `tests/e2e/.auth/owner.json`, `tests/e2e/.auth/onboarding.json` | Saved Playwright storage-state files produced by `auth.setup.ts` |
| `tests/e2e/public/auth.spec.ts` | Unauthenticated auth flows |
| `tests/e2e/public/login-theme.spec.ts` | Login page visual/theme checks |
| `tests/e2e/authed/*.spec.ts` (15 files: `automation`, `dashboard`, `deadlines`, `documents`, `draft-generator`, `email-calendar`, `funders`, `knowledge-base`, `onboarding-progress`, `onboarding`, `opportunities`, `pipeline`, `research`, `saas`, `settings`, `ui-redesign`) | Authenticated dashboard flows, one spec file per feature area, run under the `authed` Playwright project with the saved owner storage state |

### 1.7 `tests/smoke.spec.ts` — Playwright, `public` project

Baseline landing-page smoke test (asserts the hero H1 and nav logo render). Exists specifically so `playwright test` has at least one spec in the `public` project — Playwright exits non-zero on "No tests found" otherwise.

### 1.8 `e2e/` (project root) — Playwright, `critical-paths` project

| File | Purpose |
|---|---|
| `e2e/admin-owner-gate.spec.ts` | Owner-only admin route gating |
| `e2e/admin-sales.spec.ts` | Admin sales outreach flows |
| `e2e/autoapply-dashboard.spec.ts` | AutoApply dashboard |
| `e2e/billing-gates.spec.ts` | Billing/subscription gating |
| `e2e/dashboard.spec.ts` | Dashboard page |
| `e2e/donor-discovery-prospects.spec.ts` | Donor discovery prospects flow |
| `e2e/draft-generation.spec.ts` | Draft generator flow |
| `e2e/email-integration.spec.ts` | Email integration |
| `e2e/grant-pipeline.spec.ts` | Application pipeline |
| `e2e/onboarding.spec.ts` | Onboarding wizard |
| `e2e/smoke.spec.ts` | Full logged-in critical-page smoke sweep — logs in once, then visits `/dashboard`, `/funders`, `/contacts`, `/opportunities`, `/applications`, `/draft-generator`, `/documents`, `/knowledge-base`, `/deadlines`, `/analytics` (falls back to `/outcomes/analytics`), `/autoapply`, `/intelligence-library`, `/email`, `/settings`, `/settings/integrations` — asserts non-error status and a visible `<main>` on each, using soft assertions so one failing page doesn't abort the rest |
| `e2e/tenant-isolation.spec.ts` | Cross-org RLS/tenant isolation checks (real browser-driven, not the DB-level RLS unit tests the prior doc described) |

---

## Section 2: What the prior version of this document got wrong (for anyone diffing against it)

- **Tool:** claimed Jest + ts-jest + Supertest + axe-playwright. Reality: Vitest for unit/integration/API-mock tests, Playwright for everything E2E (including smoke, and including what the prior doc called "visual regression," "accessibility," and "cross-browser" — none of which have any real implementation in this repo; see Section 7).
- **Directory structure:** claimed `src/__tests__/unit/`, `src/__tests__/integration/`, `src/__tests__/api/`, `src/__tests__/smoke/`, `src/__tests__/migrations/`, plus `e2e/visual/`, `e2e/a11y/`. Reality: only `src/__tests__/smoke/` and `src/__tests__/unit/` exist under `src/__tests__/`, each with far fewer files than claimed; API and lib-level tests actually live under `tests/api/` and `tests/lib/`, a directory the prior doc never mentioned; there is no `integration/`, `migrations/`, `visual/`, or `a11y/` directory anywhere in the repo.
- **Scripts:** claimed `test:integration`, `test:api`, `test:migrations`, `test:visual`, `test:a11y`, `test:cross-browser`, `test:soak` all exist in `package.json`. None do.
- **Test accounts:** claimed `beta1@benavora-test.com` / `beta2@...` / `beta3@...`. Reality: `owner.e2e@benavora-test.dev`, `onboarding.e2e@benavora-test.dev`, `admin-non-owner.e2e@benavora-test.dev`, defined in `tests/e2e/helpers.ts`.
- **Mock library:** claimed Jest mocks (`jest.mock(...)`) for the Anthropic SDK. Reality: Vitest mocks (`vi.mock(...)`) in `tests/setup.ts`, applied globally via `setupFiles`, not per-test-file.

---

## Section 3: CI/CD Pipeline (real, verbatim)

Two workflow files exist in `.github/workflows/`. There is no third workflow — no `e2e.yml` exists anywhere in this repo.

**File: `.github/workflows/daily-tests.yml`** (verbatim):
```yaml
name: Daily Test Suite

on:
  schedule:
    - cron: '0 5 * * *'
  workflow_dispatch:

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: pnpm/action-setup@v4

      - uses: actions/setup-node@v4
        with:
          node-version: 18
          cache: pnpm

      - run: pnpm install --frozen-lockfile

      - run: pnpm test:unit
```

Real behavior, corrected from the prior version of this document:
- **No `push` trigger.** This runs on a nightly schedule (5AM UTC = 11PM CST, matching the intended cadence) and on manual `workflow_dispatch` — it does **not** also run on every push to `main`, contrary to what the prior doc claimed.
- **Single step: `pnpm test:unit`.** That's the entire test job — `pnpm install` then `vitest run`. There is no `test:smoke`, `test:api`, or `test:migrations` step, because none of those scripts exist (see Section 2). This workflow does not run Playwright at all.

**File: `.github/workflows/deploy-check.yml`** (verbatim):
```yaml
name: Deploy Check

on:
  workflow_dispatch:

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: pnpm/action-setup@v4

      - uses: actions/setup-node@v4
        with:
          node-version: 18
          cache: pnpm

      - run: pnpm install --frozen-lockfile

      - name: Build
        run: pnpm build

      - name: Report build result
        if: always()
        run: |
          if [ "${{ job.status }}" = "success" ]; then
            echo "✅ Build succeeded"
          else
            echo "❌ Build failed"
          fi
```

Real behavior, corrected from the prior version of this document: this is manual-dispatch only (no `push` trigger either), and it only runs `pnpm build` — it does not run Playwright or upload any artifact.

**E2E in CI: planned, not yet implemented.** No workflow currently runs `pnpm test:e2e` or `playwright test` in CI. The full E2E suite (`tests/e2e/`, `e2e/`) currently only runs when invoked locally (`pnpm test` or `pnpm test:e2e`), against a locally-started dev server per `playwright.config.ts`'s `webServer` block. If CI-driven E2E is wanted, a new workflow needs to be authored (installing Playwright browsers via `pnpm exec playwright install --with-deps`, providing real Supabase test-project credentials, and running against either the local dev server or a deployed preview URL) — do not assume one exists.

**Test Results Dashboard (`/platform/test-results`), `test_runs` table:** not verified as part of this rewrite — out of scope for reconciling the test-tooling claims above. Do not assume it exists without checking `src/app/(dashboard)/platform/test-results/` and a migration defining `test_runs` directly.

---

## Section 4: Coverage

`pnpm test:coverage` runs `vitest run --coverage` using the `v8` provider with a `lines: 60` threshold (from `vitest.config.ts`). There is no per-directory or per-file coverage breakdown configured beyond this single global lines threshold — no `branches`/`functions`/`statements` thresholds are set.

---

## Section 5: Test Data Management

### Real test accounts (`tests/e2e/helpers.ts`)
- `TEST_USER` — email `owner.e2e@benavora-test.dev`, the primary owner-role account used by the `authed` Playwright project's saved storage state (`tests/e2e/.auth/owner.json`).
- `ONBOARDING_USER` — email `onboarding.e2e@benavora-test.dev`, a fresh account for onboarding-flow tests (`tests/e2e/.auth/onboarding.json`).
- `ADMIN_NON_OWNER_USER` — email `admin-non-owner.e2e@benavora-test.dev`, used for admin-vs-owner role-gating tests.

### Vitest mock strategy (`tests/setup.ts`)
`@supabase/ssr`, `next/headers`, and `@anthropic-ai/sdk` are mocked globally for every Vitest test via `setupFiles` — individual test files do not need their own `vi.mock` calls for these unless they need custom return values. The Anthropic mock returns a fixed `"Mock Claude response"` string; tests asserting on specific AI output content need a per-test override.

### Playwright / E2E data strategy
E2E tests run against the **real** Supabase project, not a mocked one — `tests/e2e/helpers.ts`'s own header comment states this explicitly, citing CLAUDE.md Iron Law #8 ("never use mocks or placeholder data in production code"). `auth.setup.ts` seeds a small, representative real dataset before the `authed` project's specs run.

---

## Section 6: Regression Tests

**Rule (aspirational, per Testing Philosophy Rule 2):** every bug fixed in production should get a regression test before the fix merges. **Reality:** no dedicated `regressions.test.ts` file (or equivalent) exists anywhere in this repo. If this practice is wanted going forward, a home for these tests needs to be created — do not assume one already exists.

---

## Section 7: Not Yet Implemented

The following test categories were described as existing in the prior version of this document. None have any real implementation (no config, no spec files, no `package.json` script) in this repo as of this rewrite. Treat all of them as **planned, not built**:

- **Visual regression testing** — no `e2e/visual/` directory, no baseline snapshots, no `test:visual` script, no snapshot-diff tooling configured in `playwright.config.ts`.
- **Accessibility testing** — no `e2e/a11y/` directory, no `@axe-core/playwright` dependency in `package.json`, no `test:a11y` script.
- **Cross-browser testing** — `playwright.config.ts`'s four projects all use `devices["Desktop Chrome"]` only; there is no firefox/webkit project configured, and no `test:cross-browser` script.
- **Soak / sustained-load testing** — no `scripts/test-soak.ts` file exists, no `test:soak` script.
- **Dedicated migration idempotency tests** — no `test:migrations` script, no test file exercising migration SQL directly.
- **Dedicated DB-level RLS integration tests** — `e2e/tenant-isolation.spec.ts` covers tenant isolation at the browser/E2E level (see Section 1.8), but there is no Vitest-level suite hitting a real test Supabase instance and asserting on RLS policies directly, contrary to what the prior document's "Section 2.2" described.
- **CI-run E2E** — see Section 3 above; the Playwright suite is not wired into any GitHub Actions workflow yet.

---

## Section 8: Pre-Deploy Checklist (revised to match real scripts)

Before every production deploy (manual or automated):

- [ ] `pnpm typecheck` (`tsc --noEmit`) passes with zero errors
- [ ] `pnpm build` passes
- [ ] `pnpm test:unit` passes (Vitest — covers `src/__tests__/`, `tests/api/`, `tests/lib/`, `tests/unit/`)
- [ ] `pnpm test:e2e` passes locally if UI/flow-affecting changes were made (Playwright — not currently gated in CI, see Section 3)
- [ ] `npx vercel deploy --prod` run manually (GitHub auto-deploy is broken per BLUEPRINT_v2.md §8.1)
- [ ] Hard refresh on production URL confirms changes are live
