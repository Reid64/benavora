# PT-11 Review Pack — read this one, not the raw evidence, unless you want the raw evidence

For the full suite-by-suite table and how every number was produced, see `PHASE-11-SUMMARY.md` in
this same directory. This doc is the short version: does this project's test tooling actually run,
what does it find when it does, and what to do next.

## The question you actually care about: is the test suite real, or is it aspirational like the agent
registry turned out to be?

**Mostly real, and more thoroughly exercised than it was before this phase — but a real chunk of it
had genuinely never been run to completion even once before today.** Of the 19 suite categories this
project's test tooling defines, **10 had zero discoverable evidence anywhere in the repo of ever
completing a run** before PT-11 started. This phase actually ran 7 of those 10 for the first time
today (`unit-src`, `unit-tests-dir`, `smoke-vitest-api`, `smoke-playwright-public`,
`smoke-playwright-e2e-root`, `smoke-platform-script`, `visual-regression`) and found real, currently-
reproducing failures in 3 of them. The other 3 (`tests/e2e/authed/*` — 16 files, `tests/e2e/public/*`
— 2 files, and 12 `e2e/*.spec.ts` files outside the two named specs) remain untouched and unrun as of
this phase — flagged, not silently dropped.

## The verdict, suite by suite

| Category | Suites | Real result today |
|---|---|---|
| Never run before, now run, clean | `unit-tests-dir`, `smoke-vitest-api`, `smoke-playwright-e2e-root` | 9/9, 5/5, 3/3 — all clean. |
| Never run before, now run, real failure found | `unit-src`, `smoke-playwright-public`, `visual-regression` | 132/133 (1 real regression-test drift); 0/1 (1 real stale-copy assertion); 6/7 both comparison runs (1 real, persisting masking gap). |
| Never run before, now run, expected/documented failure | `smoke-platform-script` | 26 PASS / 2 WARN / 1 FAIL — the 1 FAIL is a table the script's own header comment already says will never exist; not a surprise. |
| Prior stale claim, re-run today, claim did NOT reproduce | `lib-tests` | 73/73 clean — a 2026-07-06 claim of a `compliance.test.ts` env-var failure did not reproduce today. |
| Prior stale claim, re-run today, claim reconfirmed | `api-tests`, `migration-idempotency`, `cross-browser` | 128/128; static-analysis + live spot-check both clean (exit 0); cross-browser's known WebKit race reproduced exactly, 0/5 both runs. |
| Prior claim superseded by a materially different result | `soak-autoapply-queue-processor` | 2026-08-13: 0/50 reached terminal (hit a 130-min time cap). Today: **50/50 reached terminal, 0 genuine failures**, full clean drain — same rate-limiter behavior confirmed both times, different outcome because today's run had zero pre-existing queue contention and enough wall-clock budget. |
| Deliberately not re-run, evidence is 1 day old | `smoke-pt-audit-suite` | Real, dated 464-route evidence from 2026-08-19 — re-running a 30s/route × 464-route sweep was judged disproportionate given evidence this fresh already exists. |
| **Still zero evidence of ever running, untouched by this phase** | `tests/e2e/authed/*` (16), `tests/e2e/public/*` (2), 12 other `e2e/*.spec.ts` files, `src/__tests__/integration/*` (13, partial) | **Unknown.** Not in PT-11-002's or PT-11-003's scope. |

## The four persisting failures — real, reproducible, cited to a raw log

1. **`regressions.test.ts`** expects a URL without a trailing slash; the real code now returns one
   with a trailing slash. Test-vs-code drift, single run, not re-checked for persistence.
2. **`tests/smoke.spec.ts`** asserts an H1 that describes a homepage that no longer exists in that
   form. The real homepage's copy has changed; this spec was never updated. Single run.
3. **`e2e/visual-regression.spec.ts`** fails the AutoApply page against its own, same-session, freshly
   generated baseline — **in both of 2 independent comparison runs**, different pixel counts each
   time. Not a real UI regression (the other 4 pages passed cleanly both times) — the AutoApply
   page's live WebSocket status indicator isn't covered by this spec's own masking helper. A gap in
   the test suite's own coverage, not the application.
4. **`e2e/critical-paths.spec.ts` on WebKit** — 0/5 in both runs, every failure the identical
   post-login navigation timeout, exactly matching a defect first documented over a week ago
   (2026-08-13) and still completely unfixed today. **This is the single most user-facing finding in
   this entire phase**: it means Safari users (desktop and mobile) cannot reliably reach the
   dashboard after logging in, against the real, live application, reproduced 10/10 times across two
   independent test runs.

A fifth, related failure — the "creating an application... adds a row to `/applications/list`" test
— also reproduced on chromium+firefox in both runs, matching 2026-08-13 exactly. And a sixth, purely
incidental finding surfaced itself during the soak test's own log-monitoring, unrelated to anything
this phase was testing for: a real, live, currently-firing production bug in AG-38's scheduled
platform-level run (`organization_id` NOT NULL violation), caught only because this session happened
to be watching Railway's error logs during its window.

## Can you trust "this suite passes" from a prior document without a fresh run? Plainly: not without checking

The same lesson PT-09 taught about the agent registry applies here to the test suite itself: a
governance-doc claim that a suite "passed" is only as good as the date it was written and the exact
scope it covered. Two concrete examples from this phase alone: `lib-tests`' 2026-07-06 failure claim
turned out to be stale (it doesn't reproduce today) — a false negative that would have wasted a future
session's time investigating a non-issue. The soak test's 2026-08-13 "0/50" result was real and
accurate *for that run*, but reading it without today's context would wrongly suggest AutoApply's
queue processor can't complete a real drain at all — it can, and did, cleanly, this session.

**Going forward, trust a suite's status only as far as its most recent raw log** — every claim in
`PHASE-11-SUMMARY.md` cites one, and every one of those logs is committed under
`test-evidence/pt-11/logs/`.

## Recommendation

**Highest priority, real user-facing impact: the WebKit login/dashboard navigation race (WGR-099).**
It has now been independently confirmed on two separate audit dates (2026-08-13 and 2026-08-20),
10/10 WebKit test executions failing identically both times, against the real, live application. This
is not a test-suite artifact — it blocks a real, common browser engine's users from completing the
single most basic authenticated flow this platform has.

**Second priority: the chromium/firefox application-creation-flow failure (WGR-100)** — same
persistence profile, narrower blast radius (one specific action, two of three engines, not the whole
post-login flow).

**Third priority, real but contained: AG-38's platform-level scheduled run (WGR-095).** A background
job silently failing on its own schedule in production — worth a one-line fix (ensure
`organization_id` is supplied, or make the platform-level path genuinely org-less if that's the
actual design) before it accumulates more silent failures.

**Lower priority, test-suite-only defects, no user impact:** the visual-regression masking gap
(WGR-098) and the two stale test assertions (WGR-096, WGR-097) — all three make the test suite less
trustworthy over time but don't affect the real application. Worth a cheap fix pass (update the
masking helper, update the two assertions) so future runs of these suites produce a signal instead of
expected noise.

**Not yet audited at all: `tests/e2e/authed/*`, `tests/e2e/public/*`, the remaining 12
`e2e/*.spec.ts` files, and a full single-run pass of `src/__tests__/integration/*`.** That's the
natural next PT-11 follow-up scope — 30+ files with genuinely zero evidence either way.
