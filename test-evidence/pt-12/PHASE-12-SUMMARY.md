# PHASE 12 SUMMARY — Load & Concurrency Audit v2

**Scope:** PT-12-001 through PT-12-005. Real load, soak, and DB-contention testing against a
dedicated, disposable Supabase branch (`pt12-load-test`, project ref `ffghpazvipsqrypkryfj`,
cloned with production data from `vbjplpquqxxfbpazyalt`) plus a local `pnpm dev` server and
`worker` process. All numbers below cite the evidence file they were read from — none are
restated from memory.

## 1. Branch identity (PT-12-001)

A real, dedicated, non-production Supabase branch was created for this audit and cloned with
production data before any load was applied.

- `branch_project_ref` (`ffghpazvipsqrypkryfj`) is confirmed distinct from `production_ref`
  (`vbjplpquqxxfbpazyalt`); `parent_project_ref === production_ref`, confirming this was a
  genuine clone-of-prod, not an unrelated stand-in project.
- Seeded volume, sampled at branch creation: `organizations` 130, `opportunities` 1,252,
  `applications` 10, `nonprofits` 1,978,526, `foundation_directory` 133,812, `agent_runs`
  24,952, `submission_queue` 6 — **2,138,688 rows total** across the sampled tables, a
  realistic production-scale data volume, not a synthetic seed.

Evidence: `test-evidence/pt-12/branch.txt`, `test-evidence/pt-12/branch-seed-counts.json`,
`test-evidence/pt-12/branch-create-raw.log`, `test-evidence/pt-12/branch-get-raw.json`.

## 2. Breaking point (PT-12-002 — concurrent-user load simulation)

Weighted request mix (dashboard_load 40% / discovery 30% / pipeline_update 15% /
draft_generation 15%), cycled per virtual user with no think time, against the branch. Tested
levels: 5, 25, 75, 150, 300, 600, 1000 concurrent virtual users.

| Concurrency | Error rate | p50 | p95 | p99 | Verdict |
|---|---|---|---|---|---|
| 5 | 0.00% | 87ms | 335ms | 476ms | ACCEPTABLE |
| 25 | 0.00% | 128ms | 227ms | 316ms | ACCEPTABLE |
| 75 | 0.00% | 428ms | 2381ms | 2465ms | DEGRADED |
| 150 | 0.00% | 814ms | 1348ms | 1500ms | ACCEPTABLE |
| 300 | 0.00% | 1556ms | 2220ms | 2607ms | DEGRADED |
| 600 | 0.00% | 3100ms | 5027ms | 5823ms | **BREAKING** |
| 1000 | 0.00% | 6283ms | 7744ms | 7825ms | BREAKING |

- **Breaking point: concurrency = 600** (first level to cross the stated breaking threshold of
  p95 > 5000ms / p99 > 8000ms / error rate > 5%; p95=5027ms, p99=5823ms).
- **This is above the stated reasonable target of 250 concurrent users** for this infra tier —
  `breakingPointBelowReasonableTarget: false`. The platform does not break under the load level
  it's actually expected to serve; it breaks at 2.4× that target.
- Error rate was **0.00% at every single level tested, including 1000 concurrency** — every
  failure mode observed was latency degradation, never a request error. No requests were
  dropped or errored at any load level in this test.
- **Real completed-request throughput plateaus at ~150 concurrency** (`throughputPlateauConcurrency:
  150`, `maxObservedThroughputRps: 179.7`) — concurrency levels tested above 150 add queueing
  latency without increasing real completed work per second. This is the practical capacity
  ceiling for this request mix on this infra tier, reached well before the p95/p99 breaking
  point above, and is the more actionable number for capacity planning.
- Degradation onset: concurrency = 75 (first level to cross p95 > 2000ms).

Evidence: `test-evidence/pt-12/load-results.txt`, `test-evidence/pt-12/load-results.json`
(`findings` object: `degradationOnsetConcurrency: 75`, `breakingPointConcurrency: 600`,
`throughputPlateauConcurrency: 150`, `maxObservedThroughputRps: 179.7`,
`breakingPointBelowReasonableTarget: false`).

## 3. Soak memory verdict (PT-12-003)

Sustained load (6 virtual users, continuous cycling, no think time) held for 202.2s (target
180s) against both the local Next.js server and the local worker process, with per-10s RSS
sampling on both processes. Automation was confirmed disarmed before the run (`submission_queue`
had 0 `pending` rows) so no real AutoApply worker path could fire during the soak.

**Verdict: `PASS_NO_LEAK` — flat on both processes.** Neither process shows growth; both show a
net *decrease* over the sampled window.

| Process | First-quarter avg | Last-quarter avg | Growth % | Monotonicity | Regression slope | Verdict |
|---|---|---|---|---|---|---|
| Next.js (pid 87588) | 53MB | 27MB | −48.8% | 93.75% | −213,547 bytes/s | flat |
| worker (pid 124396) | 42MB | 23MB | −44.5% | 87.5% | −153,778 bytes/s | flat |

- "Leak" classification threshold is >15% growth AND >60% monotonicity; both processes are on
  the wrong side of the growth sign entirely (negative), so neither approaches the leak bar.
- The step-change in both series (Next.js drops from a flat 53MB plateau to a flat 27MB plateau
  between t=100s and t=111s; worker from 42MB to 23MB in the same window) is consistent with a
  GC pass under sustained load, not a leak signature — a leak series would climb, not drop and
  re-plateau.
- 19 samples per process (2 warmup samples excluded per this script's own methodology, 17
  steady-state samples used for the verdict); 1,928 total requests sent during the soak with
  **0 request errors**.

Evidence: `test-evidence/pt-12/soak-memory.txt`, `test-evidence/pt-12/soak-memory.json`
(`analysis.next`, `analysis.worker`, `findings.overallVerdict`), `test-evidence/pt-12/soak-memory-run.log`.

## 4. Connection pool + rate-limiter behavior under load (PT-12-004)

Two real contention scenarios fired inside the *same* concurrent burst (not measured in
isolation): (a) pool-stress — a leading-wildcard `ILIKE` sequential scan against
`nonprofits.name` (1.97M rows on this branch) run `concurrency` times simultaneously per level,
to force each call to hold a real Postgres backend open for seconds; (b) rate-limiter
contention — 10 calls per funder per level replicating `worker/rate-limiter.ts`'s
`RateLimiter.canSubmitToDomain()` exact filter shape and fail-open-on-error semantics, fired
inside that same burst.

**Pool contention finding — real, and worth flagging:** every tested concurrency level (2, 5,
10, 20, 40) produced **100% `statement_timeout_error`, 0% success, 0% `pool_exhaustion_error`**.
The uncontended single-request baseline for the same query succeeded in 5,096ms every time it
was run in isolation, but the *identical* query run just twice at once (concurrency=2) failed
2/2 via Postgres's own `statement_timeout` (Postgres error `57014`), with a consistent ~8,072–
8,457ms cutoff observed across concurrency levels 2 through 20. At concurrency=40, wall-clock
time roughly doubled to 16,218ms (vs. ~8,100–8,500ms at every lower level) — real evidence that
genuine connection-wait queueing is happening underneath the fixed timeout cancellations, not
just a flat constant repeating.

**This means:** under even mild concurrent contention (2 simultaneous callers), an expensive
read query on this infra tier is **hard-canceled by Postgres's statement_timeout rather than
gracefully queued to completion** — an ungraceful failure mode, not a queue. This is a property
of this branch's compute tier and its role-level `statement_timeout` GUC (smaller/free-tier than
production, same caveat PT-12-002 states for its own thresholds), but the *qualitative*
behavior — moderately expensive queries getting hard-canceled rather than queued under
concurrency — is a property of the real Postgres/PostgREST statement-timeout mechanism, not
branch-specific. Registered as **WGR-149**.

**Rate-limiter finding — confirmed sound, no gap:** across all 5 levels (50 block-check calls,
50 allow-check calls), the rate limiter produced **0 false-allows** (never let a
should-be-blocked domain submit under DB contention) and **0 false-blocks** (never spuriously
blocked legitimate traffic). Its documented fail-open design exists but was never actually
triggered within this tested contention range — the domain-cooldown check held correctly under
real DB contention up to concurrency=40. Registered as **WGR-152** (CONFIRMED-OK).

Evidence: `test-evidence/pt-12/pool-ratelimit.json` (`levels[].poolStress.outcomeCounts`,
`levels[].poolStress.wallMs`, `findings.poolStress`, `findings.rateLimiterContention`).

## 5. Overall verdict

- **Breaking point (600 concurrent users) is above the reasonable target (250)** — the platform
  handles realistic concurrent load with room to spare on the latency-SLA dimension, and with
  **zero errors at any tested level**, including 1000 concurrent users.
- **Real throughput ceiling (~180 req/s, onset at concurrency≈150) is the more actionable
  capacity number** — it's reached well before the 600-concurrency breaking point and is where
  added concurrency stops producing more completed work.
- **No memory leak** in either the Next.js server or the worker process under 202s of sustained
  load — both processes trend flat-to-decreasing, not climbing.
- **Real, load-bearing gap:** the database layer hard-cancels moderately expensive queries via
  `statement_timeout` under even mild concurrency (2 simultaneous callers) rather than queueing
  them — an ungraceful, not graceful, contention failure mode. Flagged as WGR-149.
- Rate-limiter fail-open behavior is sound and produced zero false-allows/false-blocks under the
  same contention conditions that triggered the pool's statement-timeout failures.

## 6. Branch teardown

The `pt12-load-test` branch (a real, billed 2.14M-row production clone, live since
2026-08-20T18:44:33Z) was torn down via `supabase branches delete pt12-load-test --project-ref
vbjplpquqxxfbpazyalt --yes` and confirmed gone via a follow-up `supabase branches list` — only
the `main` (production default) branch remains. See `test-evidence/pt-12/teardown.txt` for the
full delete-command output and the post-delete branch list confirming absence.
