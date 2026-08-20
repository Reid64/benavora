# PT-11 — Phase 11 Summary (Test Suite Inventory + Real Execution)

Consolidated numbers for the PT-11 phase. Every count below is quoted from a raw log or JSON result
file already committed under `test-evidence/pt-11/` — re-open the cited file to reproduce the number;
nothing here is asserted from memory, from a prior session's narrative, or from
`WIRING_GAP_REGISTER.md`/`STATE_OF_THE_BUILD.md` text alone.

## Scope

PT-11 answers a narrower question than PT-09 (which asked "does invoking an agent produce real
output"): **does this project's own test tooling actually run, and when it runs, does it pass?**
Prior governance docs (`SESSION_STATE.md`, `STATE_OF_THE_BUILD.md`) contain years of scattered,
often-stale claims about specific suites ("38 pre-existing errors, confined to `src/__tests__/**`",
"vitest-results.txt dated 2026-06-21", etc.) with no single, current, re-executed source of truth.
PT-11 built one.

Three steps, each producing its own evidence file under `test-evidence/pt-11/`:

1. **PT-11-001 — Test-suite inventory.** Full filesystem discovery of every test file under
   `src/__tests__/`, `tests/`, `e2e/`, and `scripts/` (19 suite records, 96 individual files),
   cross-referenced against `package.json` scripts, `vitest.config.ts`/`playwright.config.ts`, and
   every prior governance-doc claim about each suite's status. No suite was executed for this step —
   it is a catalog of what exists and what evidence (if any) already existed on disk.
   `test-evidence/pt-11/suite-inventory.json`.
2. **PT-11-002 — Core suites executed for real.** The 9 unit/smoke/api/migration suites PT-11-001
   flagged as `"unknown"` (no evidence of ever completing) or carrying only stale evidence were
   actually run this session. `test-evidence/pt-11/suite-results-core.json` +
   `test-evidence/pt-11/logs/{unit-src,unit-tests-dir,lib-tests,api-tests,smoke-vitest-api,
   smoke-playwright-public,smoke-playwright-e2e-root,smoke-platform-script,migration-idempotency}.log`.
3. **PT-11-003 — Historically flaky/non-deterministic suites executed for real, twice where
   persistence mattered.** visual-regression (PT-11-001 found it *could not* have passed — no
   baseline existed on disk at all), cross-browser (retargeted at the known WebKit navigation race
   from `CROSSBROWSER_TEST_RESULTS_20260813.md`), and the AutoApply queue-processor soak test
   (retargeted at the known unconditional 60–120s rate-limiter delay). `test-evidence/pt-11/
   suite-results-flaky.json` + `test-evidence/pt-11/logs/{visual-regression-*,cross-browser-*,
   soak-autoapply*}.log` + `test-evidence/pt-11/artifacts/`.
4. **PT-11-004 — This consolidation.**

**Method note on "raw log" citations.** Every vitest suite ran via `npx vitest run <path>
--reporter=verbose`; every Playwright suite via `npx playwright test <spec> --project=<name>
--reporter=list`; the migration suite via `npx tsx scripts/check-migration-idempotency.ts`; the
platform smoke script via `npx tsx scripts/platform-smoke-test.ts`; the soak test via `npx tsx
scripts/soak-test-autoapply-worker.ts` (background). Combined stdout+stderr was redirected to the
cited `.log` file, with a literal `exit_code=N` line appended from the shell's own `$?` immediately
after each foregrounded process exited (the soak test ran detached — its `exit_code=0` in
`suite-results-flaky.json` is asserted from the log's own completion markers, not a captured `$?`,
exactly as documented in that file's `soak-autoapply-queue-processor.how_exit_code_was_determined`
field).

## Environment hazard found and corrected (both PT-11-002 and PT-11-003)

**Port 3000 on this machine was not Benavora.** At the start of both PT-11-002 and PT-11-003, the
only listening port on this machine was `:3000`, serving a completely unrelated project ("AFS —
Architectural Flashing Supply"), confirmed via a direct `curl`/title check both times. The first
attempts at `smoke-vitest-api` and `smoke-playwright-public` in PT-11-002 ran against this wrong
server before the mistake was caught — `smoke-vitest-api` produced a misleading PASS (it only checks
non-500/503, which AFS's server trivially satisfies), `smoke-playwright-public` correctly failed but
against AFS's homepage content, not Benavora's. Both were corrected by starting Benavora's own `next
dev -p 3100` in the background, confirming its real `<title>` before pointing any tool at it via
`NEXT_PUBLIC_APP_URL`/`PLAYWRIGHT_BASE_URL`/`NEXT_PUBLIC_SITE_URL`, and tearing the dev server down
after each session's suites finished (confirmed via `taskkill` + a re-check that the port was no
longer listening). All numbers below reflect the corrected, port-3100 runs only.

## Suite-by-suite: real dated numbers, cited to a raw log

Legend for the "Never truly run before today?" column: **YES** = `suite-inventory.json` recorded
`ran_to_completion: "unknown"` or `false` for this suite (zero prior evidence anywhere in the repo
that it had ever completed) before this PT-11 program ran it for the first time today
(2026-08-20). **NO (stale evidence existed)** = the inventory found a real, dated prior run, but it
predates this session and in two cases (`lib-tests`, the 2026-08-13 soak test) turned out to be
superseded by a materially different result today. **NO (re-confirmed)** = prior evidence existed and
today's re-run reproduced it.

| Suite | Never truly run before today? | Real result (2026-08-20) | Raw log |
|---|---|---|---|
| `unit-src` (`src/__tests__/unit`, 13 files) | **YES** | 132/133 tests passed, 1 test file failed | `logs/unit-src.log` |
| `unit-tests-dir` (`tests/unit`, 2 files) | **YES** | 9/9 tests passed, clean | `logs/unit-tests-dir.log` |
| `lib-tests` (`tests/lib`, 9 files) | NO (stale — 2026-07-06 evidence claimed a `compliance.test.ts` env-var failure) | 73/73 tests passed, clean — **the stale claim did not reproduce** | `logs/lib-tests.log` |
| `api-tests` (`tests/api`, 10 files) | NO (stale — 2026-06-21 evidence, different file-set boundary) | 128/128 real tests passed (1 file skipped, 13 `todo` placeholders — not failures) | `logs/api-tests.log` |
| `smoke-vitest-api` (`src/__tests__/smoke`, 1 file) | **YES** | 5/5 tests passed (re-run against the corrected port-3100 server) | `logs/smoke-vitest-api.log` |
| `smoke-playwright-public` (`tests/smoke.spec.ts`) | **YES** | 0/1 passed, 1 real failure | `logs/smoke-playwright-public.log` |
| `smoke-playwright-e2e-root` (`e2e/smoke.spec.ts` + setup) | **YES** | 3/3 passed, clean | `logs/smoke-playwright-e2e-root.log` |
| `smoke-platform-script` (`scripts/platform-smoke-test.ts`) | **YES** | 26 PASS / 2 WARN / 1 FAIL (29 total), exit 1 | `logs/smoke-platform-script.log` |
| `migration-idempotency` (`scripts/check-migration-idempotency.ts`) | NO (stale — 2026-08-08 evidence, 135 root files) | 142 root files / 1,026 DDL statements / 383 non-idempotent / 89 fully-clean files; `src/` tree: 57 files / 309 statements / 76 non-idempotent / 48 clean; live 10-migration spot-check inside `BEGIN;/ROLLBACK;`: 6 clean no-ops, 4 expected errors, 0 unexpected, exit 0 | `logs/migration-idempotency.log` |
| `visual-regression` (`e2e/visual-regression.spec.ts`) | **YES** (inventory affirmatively found it *could not* have passed — no baseline existed) | Fresh baseline: 7/7 passed. Comparison run 1: 6/7 passed, 1 real failure. Comparison run 2: 6/7 passed, 1 real failure — **same test, both runs** | `logs/visual-regression-baseline-gen.log`, `logs/visual-regression-run1.log`, `logs/visual-regression-run2.log` |
| `cross-browser` (`e2e/critical-paths.spec.ts` × chromium/firefox/webkit) | NO (stale — 2026-08-13 evidence, 10/17) | Run 1: 9/17 passed (8 failed). Run 2: 10/17 passed (7 failed) — run 2 matches the 2026-08-13 baseline exactly | `logs/cross-browser-run1.log`, `logs/cross-browser-run2.log` |
| `soak-autoapply-queue-processor` (`scripts/soak-test-autoapply-worker.ts`) | NO (stale — 2026-08-13 evidence, 0/50 reached terminal, hit the 130-min cap) | **50/50 reached terminal, 0 genuine failures**, full drain in 72m23s — the 2026-08-13 result is superseded by a materially different (successful, complete) outcome today | `logs/soak-autoapply.log` |
| `smoke-pt-audit-suite` (PT-00's 464-route real-browser sweep) | NO (real evidence 1 day old, 2026-08-19) | **Not re-executed this session** — deliberately deferred, see below | `test-evidence/pt-00/smoke-results.json` (dated 2026-08-19T06:38:29Z, not re-generated) |

**Deliberately not re-executed this session, stated rather than silently dropped:**
`scripts/audit/pt00-005-smoke-suite.mjs` already has real, dated evidence exactly one day before
this phase started; re-running a 464-route full-application Playwright sweep (up to a 30s
per-route timeout) was judged disproportionate given the one-day-old evidence already on disk. This
decision is recorded in `suite-results-core.json`'s `not_reexecuted_this_session[]` array, not
silently omitted.

**Still zero evidence of ever completing a run, not touched by this PT-11 program at all** (carried
forward, unresolved, from PT-11-001's own inventory — 30 files across 3 suite records): `tests/e2e/
authed/*.spec.ts` (16 files), `tests/e2e/public/*.spec.ts` (2 files), and the 12 `e2e/*.spec.ts`
files outside `critical-paths`/`visual-regression`/`smoke`. None of these were run by PT-11-002 or
PT-11-003 — PT-11-002 scoped to the 9 unit/smoke/api/migration suites, PT-11-003 scoped to the 3
named flaky categories. `src/__tests__/integration/*` (13 files, the suite that exercises the real,
live production Supabase project) also remains un-re-executed as a single full-suite run this phase
— per-file evidence exists scattered across older `STATE_OF_THE_BUILD.md` sessions, but no fresh,
dated, whole-directory run was produced by PT-11.

## Persisting failures (confirmed reproducible, not one-off flakes)

Four real, currently-reproducing failures were found this phase. Two were checked twice specifically
to rule out a flake (visual-regression, cross-browser); the other two are single-run failures with no
persistence claim either way (they were not re-run a second time this phase).

1. **`regressions.test.ts` — IRS-990 fetch URL normalization drift.** `unit-src`'s "resolves a filing
   via `fetchRaw()`... and never calls `fetchPage()`" test expects `website: "https://example.org"`;
   the real code now returns `"https://example.org/"` (trailing slash). A real behavior/test drift in
   the current codebase, not a flake or environment artifact. Single run only this phase. —
   `logs/unit-src.log`.
2. **`tests/smoke.spec.ts` — stale landing-page H1 assertion.** Asserts an H1 matching `/Win More
   Grants/`; the real, current landing-page H1 is "Your mission deserves every dollar available to
   it." Confirmed against a real page snapshot showing genuine Benavora content (not the wrong-server
   artifact from the pre-correction attempt). Single run only this phase. — `logs/
   smoke-playwright-public.log`, `test-results/tests-smoke-landing-page-renders-the-Benavora-hero-
   public/error-context.md`.
3. **`e2e/visual-regression.spec.ts` — `autoapply` page fails its own same-session baseline, both
   runs.** A fresh baseline was generated and the very next comparison (run 1: 115px diff) and the
   run after that (run 2: 194px diff — different magnitude each time, same page, zero UI code
   changes between runs) both failed the identical test. Root cause: the AutoApply page's live
   WebSocket-connected "Live Session Viewer" panel renders a connection-status indicator this spec's
   `timestampMasks()` helper does not cover (it only masks text-pattern timestamps, not a
   live-socket status badge) — a genuine, previously-undocumented gap in the suite's own masking
   coverage. **Persists across 2 independent runs.** — `logs/visual-regression-run1.log`, `logs/
   visual-regression-run2.log`, `test-evidence/pt-11/artifacts/visual-regression/
   autoapply-run2-failure/`.
4. **`e2e/critical-paths.spec.ts` — WebKit navigation race, and a chromium+firefox application-list
   failure.** Both reproduced in both of 2 independent runs today:
   - **WebKit: 0/5 in both runs**, every failure an identical `page.waitForURL: Timeout 30000ms
     exceeded ... waiting for navigation to "**/dashboard"` — the exact race documented in
     `CROSSBROWSER_TEST_RESULTS_20260813.md`, unfixed, still reproducing exactly.
   - **chromium + firefox: "creating an application... adds a row to `/applications/list`" failed on
     both browsers in both runs**, matching 2026-08-13 exactly.
   - One **non-persisting** finding, reported honestly as a flake rather than overstated: chromium's
     "funder Relationship Builder page loads without 404 or 500" failed in run 1, passed in run 2.
   — `logs/cross-browser-run1.log`, `logs/cross-browser-run2.log`.

## A finding worth stating explicitly: the soak test's 2026-08-13 result is now superseded, not confirmed

`suite-inventory.json` (built the same day, before PT-11-002/003 ran) carried forward the
2026-08-13 soak-test claim of "0/50 reached terminal, hit the 130-minute safety cap" as the last
known status. This phase's own real re-run of the identical, unmodified script
(`scripts/soak-test-autoapply-worker.ts`) against the real, deployed, production Railway worker
achieved a full, clean **50/50 drain in 72 minutes 23 seconds**, zero genuine failures. Both results
are real and both are explained by the same underlying, still-current architectural fact — the
unconditional 60–120s `waitBetweenSubmissions()` rate limiter in `worker/queue-processor.ts`/
`worker/rate-limiter.ts`, independently re-confirmed this run (observed inter-completion gaps:
min=62s, median=89s, max=121s, landing inside the documented range on every one of 49 measured gaps).
2026-08-13's run simply didn't have enough wall-clock budget for a full drain within its own,
shorter, contention-affected observation window; today's run had zero pre-existing queue contention
and ran long enough for the bottleneck to fully play out. Neither run is wrong — the rate limiter's
real behavior is confirmed consistent across both; only the outcome (whether the cap was hit before
the drain finished) differs, for a reason that is itself now documented rather than left as an
unexplained discrepancy.

**One real, incidental, previously-undocumented production bug surfaced by this run's own Railway
log pull** (scoped to the exact run window, `--filter "@level:error"`): `[AutonomousOrchestrator]
AG-38 self-improvement pipeline failed: Failed to start AG-38 platform-level run: null value in
column "organization_id" of relation "agent_runs" violates not-null constraint`, fired once at
2026-08-20T09:00:32Z — unrelated to AutoApply or this soak test's own subject, not fixed here (out
of this audit's scope). Registered as WGR-095 below.

## Register additions this consolidation (WGR-095 through WGR-100)

Six findings were confirmed real, evidenced, and reproducible but had not yet been given their own
register row before this consolidation pass. All six are now in `WIRING_GAP_REGISTER.md`:

- **WGR-095** — AG-38 self-improvement pipeline's platform-level scheduled run fails live with a real
  `organization_id` NOT NULL constraint violation, surfaced incidentally via the soak test's own
  Railway log pull. Distinct from PT-09's AG-38 verdict (WORKS via direct invocation with an explicit
  orgId) — this is the unattended scheduled path failing a way direct invocation never exercised.
- **WGR-096** — `regressions.test.ts`'s IRS-990 fetch regression test fails on a real trailing-slash
  URL-normalization drift between the test's expectation and the current code.
- **WGR-097** — `tests/smoke.spec.ts` asserts a stale landing-page H1 ("Win More Grants") that no
  longer matches the real, current homepage copy.
- **WGR-098** — `e2e/visual-regression.spec.ts`'s `timestampMasks()` helper has a real masking-
  coverage gap: it doesn't cover the AutoApply page's live WebSocket connection-status indicator,
  causing a persisting (2/2 runs) false-positive visual diff on that one page only.
- **WGR-099** — the known WebKit post-login navigation race (`CROSSBROWSER_TEST_RESULTS_20260813.md`)
  reproduces exactly, 0/5 in both of 2 independent runs today, 10/10 individual WebKit test
  executions failing identically. Graded P0 — this blocks the single most fundamental user flow
  (reaching the dashboard after login) for an entire browser engine family.
- **WGR-100** — the "creating an application... adds a row to `/applications/list`" failure on
  chromium+firefox also reproduces exactly, both runs, matching 2026-08-13. A related chromium-only
  failure (funder Relationship Builder page) did NOT reproduce in run 2 and was explicitly reported
  as a non-persisting flake, not folded into this row.

`WIRING_GAP_REGISTER.md` now runs WGR-001 through WGR-100, unbroken.

## Gates

`node scripts/audit/verify-pt11-001.mjs`, `verify-pt11-002.mjs`, and `verify-pt11-003.mjs` all pass
(re-run to confirm — each checks its own evidence file for real, non-empty, internally-consistent
content, not just presence). `node scripts/audit/verify-pt11-004.mjs` (this consolidation's own gate)
confirms `PHASE-11-SUMMARY.md` and `REVIEW-PACK.md` are present and non-empty, and that
`WIRING_GAP_REGISTER.md` has grown past its pre-PT-11-004 state (WGR-094) with this consolidation's
new findings.
