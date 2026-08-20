# PT-12 REVIEW PACK — Load & Concurrency Audit v2

**For:** PT-15 (whatever review/decision pass consumes this phase's output next).
**Source phase:** PT-12 v2, all sub-steps PT-12-001 through PT-12-005. Full detail and every
cited number: `test-evidence/pt-12/PHASE-12-SUMMARY.md`.

## Q1: Can the platform handle realistic concurrent load?

**Yes, with margin.** The stated reasonable target for this infra tier is 250 concurrent users.
Measured behavior at and around that target:

- At concurrency=150 (the highest level graded ACCEPTABLE by the test's own thresholds close to
  the 250 target): p95=1348ms, p99=1500ms, 0% error rate.
- At concurrency=300 (above target): DEGRADED (p95=2220ms) but still 0% error rate — slower, not
  broken.
- Zero request errors were observed at **every** tested concurrency level, from 5 all the way up
  to 1000 concurrent users. Every degradation mode observed in this test was latency, never
  dropped or failed requests.
- Real completed-request throughput plateaus at ~180 req/s starting around concurrency=150 —
  this, not the later breaking point, is the practical capacity ceiling for this infra tier and
  request mix, and is the number worth using for capacity planning.

Verdict: the platform serves its actual target load (250 concurrent users) well inside
acceptable latency, with zero errors, and doesn't reach even DEGRADED status until roughly the
target itself (onset at concurrency=75, well under 250, is worth noting — see caveat below).

## Q2: What is the breaking point?

**Concurrency = 600** (first level crossing p95 > 5000ms / p99 > 8000ms / error rate > 5% — actual
values at 600: p95=5027ms, p99=5823ms, errorRate=0.00%). This is **2.4× the reasonable target of
250** — the platform does not break under realistic load, only under load nearly two and a half
times what it's expected to serve.

Caveat, stated plainly: this was measured against a disposable Supabase branch on a
smaller/free-tier compute instance than production (same caveat both the load-simulation and the
pool-contention scripts state for their own thresholds). The qualitative shape of the result
(errors stay at 0% even under extreme load; latency is the only degradation mode; breaking point
comfortably clears the target) is meaningful, but the exact concurrency=600 number should not be
read as a guaranteed production ceiling without a comparable run against production-tier compute.

## Q3: Is there a memory leak?

**No.** Both the Next.js server and the worker process were held under sustained real load
(6 virtual users, continuous cycling, 202.2s, 1,928 requests, 0 errors) with automation confirmed
disarmed beforehand. Both processes' steady-state memory *decreased* over the sampled window
(Next.js: −48.8%, worker: −44.5%), the opposite direction a leak would move in. Verdict:
`PASS_NO_LEAK`, `flat` on both processes — well clear of the leak-classification bar (>15% growth
AND >60% monotonicity in the growing direction).

## Q4: Highest-severity finding this phase

**WGR-149 (P2, CONFIRMED-BROKEN)** — the database layer hard-cancels moderately expensive
queries via Postgres's `statement_timeout` under even mild real concurrency (2 simultaneous
callers), rather than gracefully queueing them to completion. A query that succeeds in ~5.1s run
alone fails 100% of the time via a hard `57014` cancellation once run concurrently with just one
other identical call, with a consistent ~8.1–8.5s cutoff observed up to concurrency=20, and real
evidence of underlying connection-wait queueing appearing only at concurrency=40 (wall-clock
roughly doubles to ~16.2s). `pool_exhaustion_error` was never observed — the pool itself never
refused a connection; the timeout GUC is what's firing.

This is graded P2, not P0/P1, because: (a) it was exercised via a deliberately worst-case query
shape (a leading-wildcard `ILIKE` sequential scan over 1.97M rows, chosen specifically to force a
long-running backend and make pool contention observable — not representative of this
application's typical indexed query patterns) and (b) it was measured on a smaller/free-tier
branch compute instance, not production. It is nonetheless a real property of the
Postgres/PostgREST statement-timeout mechanism this application runs on, not a branch-specific
artifact, and is worth a deliberate look at which real application query paths (if any) run
comparably expensive, non-indexed queries under real concurrent load — that determination was
out of scope for this load-and-concurrency phase.

**Everything else investigated this phase came back CONFIRMED-OK, not broken:** the breaking
point clears the reasonable target (WGR-150), no memory leak (WGR-151), and the AutoApply rate
limiter's fail-open design produced zero false-allows/false-blocks even while the pool-contention
failures above were actively firing in the same test burst (WGR-152) — i.e. the rate limiter
stayed correct under exactly the kind of DB contention that broke the pool-stress query.

## What PT-15 needs to know going in

1. The platform's real capacity ceiling for this request mix, on this infra tier, is ~180 req/s
   (onset ~150 concurrent users) — not the later 600-concurrency latency-breaking point. Use the
   throughput number for capacity planning, the breaking-point number for worst-case SLA risk.
2. Zero request errors were observed at any load level tested in this phase (5 through 1000
   concurrency) — every degradation mode found was latency only.
3. No memory leak in either the web server or the worker process under sustained real load.
4. One real, load-bearing gap: Postgres/PostgREST hard-cancels expensive queries under mild
   concurrency instead of queueing them (WGR-149). Worth a follow-up pass identifying whether any
   real, frequently-hit application query path shares this query's cost profile (long-running,
   non-indexed, leading-wildcard-style scan) — this phase deliberately used a worst-case synthetic
   query to make the behavior observable, not a real application code path, so that follow-up
   determination is explicitly NOT made here.
5. The `pt12-load-test` Supabase branch has been torn down (confirmed via
   `test-evidence/pt-12/teardown.txt`) — it is no longer billing and no longer available. Any
   follow-up load/soak/pool test against real production-scale seeded data needs a fresh branch
   created first (`supabase branches create <name> --project-ref vbjplpquqxxfbpazyalt --with-data
   --yes`), and must be torn down the same way when done.
