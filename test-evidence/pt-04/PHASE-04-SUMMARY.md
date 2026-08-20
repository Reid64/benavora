# PT-04 — Phase 04 Summary (Business Logic Verification)

Consolidated numbers for the PT-04 phase, across three evidence artifacts (grant-probability
hand-verification, budget/deadline live-API verification, draft/AutoApply/match scoring
pure-function verification) plus one raw production-query artifact (candidates-raw.json). Every
number below cites the evidence artifact it came from — re-run the cited verifier or read the
cited file directly to reproduce it; nothing here is asserted from memory.

## The question this phase answers

PT-00 through PT-03 answered "does the app render, wire up, expose a working API layer, and let a
real user complete a full workflow." This phase answers a narrower, more exacting question:
**for every computed number this app shows a user or acts on internally — a match/fit probability
score, a draft-confidence score, an AutoApply readiness score, a budget-reconciliation total, a
deadline-reminder threshold — does the code that computes it actually implement its own documented
formula correctly, and does the number a real user actually sees match what that formula should
currently produce?** These are two different questions and this phase checked both: PT-04-003
checked whether each function's *internal arithmetic* is correct (call the real function with known
inputs, hand-compute the expected output from the documented formula, diff); PT-04-001/PT-04-002
checked whether the *persisted/displayed* number a real user actually sees matches what that same
formula should produce *right now*, given the real, current underlying data.

## Headline result: every function's own arithmetic is correct; one function's *persisted output* is stale and currently wrong for real users

**Read this first.** Five of six things checked in this phase came back clean: draft-narrative
confidence scoring, AutoApply organizational-readiness scoring, the match/fit probability engine's
own internal arithmetic, budget reconciliation, and deadline-reminder-offset logic all produced
exactly the hand-computed expected value across 21 total scenarios (4 + 3 + 4 pure-function
scenarios, plus budget reconciliation and 6 deadline scenarios) — no wrong threshold, no inverted
boolean, no mis-weighted factor, no off-by-one boundary comparator found anywhere.

**But the sixth thing found a real, live, currently-reproducing bug**: `computeGrantProbability()`'s
persisted `opportunity_probability_scores` rows are never recomputed when the real data they're
built from changes. A real opportunity's `eligibility_score` column was populated (72) 17 days
*after* its probability score was computed — and the persisted score still shows the pre-existing
neutral-fallback value (0.5) for that factor, producing a stored `overall_score` of 42 when the
documented formula, applied to the opportunity's *current* real data, produces 47. This is the exact
row `src/app/(dashboard)/opportunities/page.tsx`'s own header comment confirms the UI reads verbatim
and never recomputes — so this 5-point discrepancy is what a real user sees today, not a
theoretical edge case. A live query of 9 real production rows found the same pattern on 3 of 9
(33%), all belonging to the same org, all computed before that org's eligibility-scoring pass ran.
**WGR-135, P1.**

## Method

Four evidence artifacts, three with their own gate script plus one raw supporting-data artifact:

1. **Grant-probability hand-verification** (`test-evidence/pt-04/grant-probability.json`,
   `candidates-raw.json`) — pulled 9 real `opportunity_probability_scores` rows from production
   (`pt04-001-fetch-data.mjs`, a read-only query joining `opportunities`/
   `organizational_digital_twins`/`outcomes`), chose one (Texas CDBG Housing, org
   `b1ab7402-dfc2-4712-869f-70ea3566cc1d`) for a full deep-dive independent reimplementation of the
   documented formula in `src/lib/intelligence/grant-probability-engine.ts` against that
   opportunity's *current* real data (`pt04-001-grant-probability.mjs`), then diffed the
   hand-computed expected result against the system's actual persisted/returned row, per factor and
   overall. Verified: `node scripts/audit/verify-pt04-001.mjs` (exit 0).
2. **Budget reconciliation + deadline reminders** (`test-evidence/pt-04/budget-deadline.json`) —
   real writes via the live, authenticated Next.js API (local dev server against the real production
   database, dedicated E2E test org, all rows cleaned up afterward — residue check confirmed 0
   remaining): 4 real budget line items + 3 real expenses created via `POST
   /api/applications/[id]/budget`/expenses, then compared against `GET
   /api/applications/[id]/reconcile`'s own computed report; 5 freshly-seeded deadlines (distinct
   `deadline_type` values, distinct due-date offsets, one with reminder flags pre-set to exercise
   the never-re-fire rule) plus the E2E org's one pre-existing real deadline, all processed by `GET
   /api/deadlines/check` in a single real run, diffed against independently hand-computed expected
   reminder sets (`date-fns`'s `differenceInCalendarDays` directly, not the route's own code).
   Verified: `node scripts/audit/verify-pt04-002.mjs` (exit 0).
3. **Draft/AutoApply/match scoring pure-function verification** (`test-evidence/pt-04/scoring.json`)
   — imported and called the real, unmodified exported functions
   (`computeConfidence()` from `src/lib/drafts/generator.ts`,
   `SubmissionValidator.checkOrgReadiness()` from `src/lib/autoapply/submission-validator.ts`,
   `computeGrantProbability()` from `src/lib/intelligence/grant-probability-engine.ts`) directly
   with chosen, known synthetic inputs — not a live database read, not a reimplementation — via a
   minimal mock Supabase query-builder returning an exact known row set per scenario. Every expected
   value was independently hand-computed from each function's own documented formula, kept
   structurally separate from the calls to the real functions. Verified: `node
   scripts/audit/verify-pt04-003.mjs` (exit 0).

## Results by artifact

### Grant-probability hand-verification — 1 real, live mismatch found (WGR-135)

Full detail: `test-evidence/pt-04/grant-probability.json`.

| Field | Documented-formula expected (current real data) | System's actual persisted/returned value | Delta |
|---|---|---|---|
| `eligibility_score` factor value | 0.72 (raw `eligibility_score`=72) | 0.5 (neutral fallback) | 0.22 |
| `eligibility_score` contribution | 21.6 | 15 | 6.6 |
| `overall_score` | 47 | 42 | **5** |
| `recommendation` | consider | consider | unchanged in this instance |
| `confidence` | medium | medium | unchanged in this instance |

**Check A (internal consistency of the stored row) passed**: given the exact factor values the
system actually persisted, `overall_score = round(sum(weight_i * value_i * 100))` reconstructs to
42, matching the stored value exactly (`match: true`). This isolates the bug precisely — the
*arithmetic* on the stored inputs is correct; the *inputs themselves* are stale.

**Root cause, confirmed independently two ways**: (1) `opportunities.eligibility_score` was
populated (72, non-null) at `2026-08-19T07:01:27Z` — 17 days after
`opportunity_probability_scores.computed_at` (`2026-08-02T20:06:03Z`) — and no code path anywhere
(DB trigger, on-write hook from the eligibility-scoring agent, cron sweep) re-invokes
`computeGrantProbability()` when the underlying data changes. (2) The stored row's own `key_risks`
array still contains `"No eligibility score computed for this opportunity yet."` — a string
`buildKeyRisks()` only emits when `eligibility_score IS NULL` — directly contradicting the column's
current non-null value of 72. Both point at the same conclusion independently.

**Not an isolated example**: `candidates-raw.json` holds 9 real `opportunity_probability_scores`
rows pulled live from production, each already satisfying the engine's own real-data precondition
(current `eligibility_score IS NOT NULL`). Re-checking all 9 against the same pattern:

| Opportunity (short id) | Org (short id) | `computed_at` | Current `eligibility_score` | Stored factor value | Expected value if fresh | Stale? |
|---|---|---|---|---|---|---|
| af4620eb | b1ab7402 | 2026-08-02 | 18 | 0.5 | 0.18 | **yes** |
| 8851652c | b1ab7402 | 2026-08-02 | 72 | 0.5 | 0.72 | **yes** (the deep-dived row) |
| a3e45cc5 | b1ab7402 | 2026-07-30 | 5 | 0.5 | 0.05 | **yes** |
| b98c13d4 | bed3e621 | 2026-07-18 | 12 | 0.12 | 0.12 | no |
| a42efa0d | bed3e621 | 2026-07-18 | 95 | 0.95 | 0.95 | no |
| a397bc08 | bed3e621 | 2026-07-18 | 69 | 0.69 | 0.69 | no |
| 5cb4b465 | bed3e621 | 2026-07-18 | 74 | 0.74 | 0.74 | no |
| 5a595b76 | bed3e621 | 2026-07-18 | 88 | 0.88 | 0.88 | no |
| 15edbda7 | bed3e621 | 2026-07-18 | 81 | 0.81 | 0.81 | no |

**3 of 9 (33%) real sampled rows are stale, all three belonging to the same org
(`b1ab7402-dfc2-4712-869f-70ea3566cc1d`, the Faith Foundation demo/test org used throughout this
audit program).** The other org's 6 rows show no drift at all — their stored factor value already
matches the current column exactly, consistent with that org's `eligibility_score` not having
changed since the row was computed, not with the recompute mechanism working. This is exactly the
signature a "compute once, never revisit" design produces: any org whose data changes after its
opportunities are first scored accumulates stale rows; an org whose data never changes never
surfaces the bug. **Finding registered as WGR-135, severity P1** — confirmed broken, live, on real
production data reaching a real page, but scoped: the confirmed instance's `recommendation`
category did not flip (both "consider"), so this is a wrong number, not (yet, in the confirmed
case) a wrong action-oriented recommendation. Nothing in the formula prevents a larger real-world
drift from crossing the apply/consider/skip thresholds for other, unsampled opportunities.

### Budget reconciliation + deadline reminders — 0 mismatches (WGR-137, CONFIRMED-OK)

Full detail: `test-evidence/pt-04/budget-deadline.json` (`overall_mismatch_found: false`).

**Budget**: 4 real line items totaling $26,500 + 3 real expenses totaling $7,000.75, hand-summed
independently, matched the live `GET /api/applications/[id]/reconcile` report exactly on every
field — `total_budget`, `total_spent`, `variance`, and `compliance_status` all delta 0.

**Deadlines**: 6 real scenarios (none-crossed at 45 days; exact-30-day boundary; two thresholds
simultaneously at 10 days; due-today with all 5 thresholds firing at once; overdue with 3 already
partially fired and correctly never re-fired; one pre-existing real production deadline) all
matched their independently hand-computed expected reminder sets exactly — 6/6, including the
idempotency rule (`reminder_{n}d_sent` flags are one-way, per Contracts §11).

### Draft/AutoApply/match scoring — 0 mismatches across 11 scenarios (WGR-136, CONFIRMED-OK)

Full detail: `test-evidence/pt-04/scoring.json` (`all_functions_verified: true`).

| Function | Source file | Scenarios | Result |
|---|---|---|---|
| `computeConfidence()` | `src/lib/drafts/generator.ts` | 4 (zero-KB branch, dual-penalty stacking, no-penalty base case, negative-clamp stress test) | 4/4 match |
| `SubmissionValidator.checkOrgReadiness()` | `src/lib/autoapply/submission-validator.ts` | 3 (fully-ready org, multi-gap dual-blocker, profile-only-gap with suppressed second blocker) | 3/3 match |
| `computeGrantProbability()` (pure-function arithmetic, not the persisted-row question above) | `src/lib/intelligence/grant-probability-engine.ts` | 4 (mid-range 'consider', all-null neutral-fallback floor, medium-confidence 'skip', exact score=70 apply/consider boundary) | 4/4 match |

The exact-70 boundary scenario specifically confirms the recommendation comparator is `score>=70`
(not `score>70`) — a real off-by-one class of bug this scenario was designed to catch, and did not
find. The all-null-inputs scenario (score=28) independently corroborates a prior, unrelated
production observation already on file (`STATE_OF_THE_BUILD.md`'s 2026-08-18 note that "11 of 15
listed opportunities carry the score floor of 28" for real orgs with no eligibility/outcomes/
deadline/twin data) — two independent methods landing on the same number is a further confidence
signal, not a new finding.

## Register additions this phase

| ID | Severity | Scope Tag | One-line |
|---|---|---|---|
| WGR-135 | P1 | CONFIRMED-BROKEN | `computeGrantProbability()` persisted rows never recompute on data change; live on real production data, 3/9 sampled rows stale. |
| WGR-136 | P3 | CONFIRMED-OK | Draft confidence / AutoApply eligibility / match-probability pure-function arithmetic all hand-verified correct, 11/11 scenarios. |
| WGR-137 | P3 | CONFIRMED-OK | Budget reconciliation and deadline-reminder-offset logic both hand-verified correct against real live API calls, 0 mismatches. |

Register verified to contain PT-03's own last row (`WGR-134`) plus all three of this phase's rows —
see `node scripts/audit/verify-pt04-004.mjs`.
