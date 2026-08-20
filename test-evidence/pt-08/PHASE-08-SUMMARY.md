# PT-08 — Phase 08 Summary (Background Jobs / Queues / Worker Audit)

Consolidated numbers for the PT-08 phase. Every number below cites the evidence artifact it came
from — re-run the cited verifier or read the cited file directly to reproduce it; nothing here is
asserted from memory.

## Scope

PT-00/01/02 audited the frontend (routes, nav, element wiring) and the Next.js API route layer
(auth, CRUD, pagination). PT-08 goes to the layer neither of those touches: the always-on Railway
worker process and everything it runs — which background processors actually start at boot (vs.
merely being defined/imported), which scheduled jobs are registered *and* actually fire in
production, and whether the job-queue state machine (`agent_queue`: claim → retry → terminal) is
semantically correct under both a normal success and a poison-job failure. This phase answers the
question PT-09 (agents) depends on: does the machinery that's supposed to run agent code
automatically actually run it, or does an agent only ever execute when someone hand-writes a
throwaway script and runs it manually?

Three steps, each producing its own evidence file under `test-evidence/pt-08/`:

1. **PT-08-001 — Worker boot inventory.** Static read of `worker/index.ts`'s entry point and every
   module it imports, reconciled against a real Railway production boot log and a live query
   against `worker_status`.
2. **PT-08-002 — Cron registration reconciliation.** Every place a cron/scheduled-trigger claim
   exists (in-file comments, governance docs) reconciled against `vercel.json`'s `crons` array and
   `worker/scheduler.ts`'s `jobs` array — the two real scheduling mechanisms in this codebase.
3. **PT-08-003 — `agent_queue` lifecycle exercise.** Claim/retry/terminal/completion/poison-job-
   isolation semantics exercised against a disposable local Postgres database, using the real,
   unmodified `routeQueueItem()` default-case throw as the poison-job runner.

## PT-08-001 — Worker boot inventory

**26 processors/consumers inventoried. 24 STARTED, 2 DEFINED-NOT-STARTED.**
(`test-evidence/pt-08/boot-inventory.json`, `summary.totalProcessorsInventoried: 26`,
`summary.started: 24`, `summary.definedNotStarted: 2`)

Reconciled against a real, live Railway deployment (`benavora-worker`, deployment
`9af8db54-805a-411c-bbc2-3e10df25957b`, status `Online`, container started
`2026-08-15T20:57:16.873306238Z`, still running continuously as of this audit) — not just a static
code read. The container's actual boot log
(`test-evidence/pt-08/railway-boot-window.json`) shows every claimed-STARTED processor's own
`"Starting"` line firing at real timestamps within a 4-second window, and a live query against the
production `worker_status` table (`test-evidence/pt-08/worker-status-live-query.txt`) independently
confirms the heartbeat processor (`started_at` and `last_heartbeat_at` both current, `items_processed:
2`).

**24 STARTED**, including: `StreamServer`, `heartbeat`, `queueProcessor` (AutoApply submission
queue — plus 3 job types embedded in its idle cycle: `enrich_donor_prospect`,
`score_donor_prospect`, `run_connector_enrichment`), `ddRequestProcessor` (donor discovery
requests), `knowledgeIndexerProcessor`, `confirmationMonitor` (Gmail AutoApply confirmation
monitor — genuinely ticking on schedule, but every cycle is a real no-op today because the
required OAuth credentials are unset, a documented, pre-existing gap per
`AUTOAPPLY_ARCHITECTURE_V2.md` §10A, not a registration gap), `scheduler` (the 60s-tick job
runner), `agentQueueProcessor`, and 13 individual `worker/scheduler.ts`-registered pipeline jobs
(AG-10, AG-23/32, AG-25, AG-26, AG-27, AG-36, AG-38, AG-42, the nightly autonomous pipeline + AG-28
follow-ups sweep, the morning digest pipeline, the AutoApply autonomous overnight orchestrator, and
both Directive-1 scraper jobs) — every one of these 13 confirmed **actually firing** in production
across a 5-day live log window (2026-08-15 through 2026-08-19), not just registered
(`test-evidence/pt-08/railway-scheduler-jobs-fired.json`).

**2 DEFINED-NOT-STARTED** — real `start()`/`stop()`/`waitForIdle()` processor code exists, but
nothing anywhere calls it:

| Processor | Module | Severity | Reachability |
|---|---|---|---|
| Corporate/EA-01..EA-10 enrichment + AG-22 propensity scoring | `worker/enrichment-processor.ts` | **WGR-033, P1** | Zero. Not imported by `worker/index.ts`, not dynamically imported anywhere, no CLI entry point in `scripts/`. `WORKER_ARCHITECTURE_v2.md`'s own documented boot sequence (line 92) claims step 6 starts this loop — the real code has no such call. The only 2 repo-wide references to the string `"enrichment-processor"` are the file's own definition and a comment-only mention in `ag-22-propensity-scoring.ts`. All 11 agent classes this file runs (EA-01 through EA-10, AG-22) are unreachable via any automatic OR on-demand production path today. |
| `process_discovery_request` job handler | `src/worker/jobs/process-discovery-request.ts` | **WGR-034, P3** | Zero, but not a functionality gap — the capability (processing a `donor_discovery_requests` row) is already fully covered by `ddRequestProcessor`, which is confirmed STARTED. Genuine orphaned dead code, distinguished deliberately from WGR-033. |

## PT-08-002 — Cron registration reconciliation

**11 real `/api/cron/*` route handlers exist. 5 registered in `vercel.json`. 13 real
`worker/scheduler.ts` jobs (a wholly separate mechanism, confirmed firing live by PT-08-001) exist
and are not HTTP routes at all. 6 of the 11 cron routes are registered nowhere.**
(`test-evidence/pt-08/cron-reconciliation.json`, `summary`)

| Set | Count | Detail |
|---|---|---|
| `/api/cron/*` route handlers | 11 | All real files under `src/app/api/cron/*/route.ts`. |
| Registered in `vercel.json` | 5 | `research`, `grantsgov`, `reminders`, `autoapply`, `domain-warmup` — all matched to a documented claim, all confirmed the target route file exists. |
| Invoked by `worker/scheduler.ts` | 0 | This mechanism never calls an `/api/cron/*` HTTP route — it directly imports and calls functions inside `worker/autonomous-orchestrator.ts`/`src/lib/scraper/*`. Wholly separate from `vercel.json`. |
| Unregistered anywhere | 6 | `campaigns`, `draft-automation`, `draft-queue-check`, `email-sequences`, `follow-ups`, `sales-sends` |
| Registered but undocumented | 0 | None — every registered/scheduled job has both an in-file comment and/or external doc citation. No "surprise" job found. |

**Of the 6 unregistered cron routes:**

1. **`/api/cron/campaigns` — intentionally retired**, not a gap. Deliberately removed from
   `vercel.json` on 2026-08-13 after confirming 0 orgs had the feature flag enabled
   (`SESSION_STATE.md`, `OUTREACH_CONSOLIDATION_AUDIT.md` Item 5). No WGR row — already fully
   documented elsewhere with rationale. The route's own header comment still falsely claims active
   registration — cosmetic drift only, no functional impact.
2. **`/api/cron/draft-queue-check` — WGR-039, P3, no functional gap.** Its entire body duplicates
   `DraftQueueEngine.processNewOpportunities()`, which the *registered* `/api/cron/research` cron
   already fire-and-forgets after every successful run. Orphaned duplicate entry point, logged so a
   future session doesn't re-flag it as P1.
3. **`/api/cron/draft-automation` — WGR-035, P1, real gap.** Deadline-approaching auto-queueing and
   bulk draft auto-generation never fire automatically. Its own header claims a daily Vercel Cron
   that doesn't exist. Only substitute is a manual, writer-gated route capped at 3 items/call.
4. **`/api/cron/sales-sends` — WGR-036, P1, highest-confidence finding in this set.** The producer
   side is confirmed live and interactive, not dormant: `PATCH /api/admin/campaigns/[id]
   {action:'schedule'}` really inserts `sales_sends` rows with `status:'queued'` today. Nothing in
   production ever reads and sends them — the only consumer is this unregistered route. An admin
   clicking "Schedule" on a real campaign produces rows that sit queued forever.
5. **`/api/cron/follow-ups` — WGR-037, P1, two-layer gap.** Consumer (`processFollowUps()`) is
   reachable only via this unregistered route; producer (`scheduleFollowUps()`) has zero call sites
   anywhere in `src/` — nothing ever creates a row for this route to process even if it were
   registered. The AutoApply 14/30/60-day donation follow-up system is fully inert end-to-end. (Not
   the same system as AG-28's `application_followups` sweep, which IS wired via
   `worker/scheduler.ts` — the near-identical function names are a real trap for future readers.)
6. **`/api/cron/email-sequences` — WGR-038, P1, already-known gap, now registered for the first
   time.** `sequenceEngine.processScheduledSends()` has no other call site. Previously documented in
   `WORKFLOW_PAGE_PLAN_2026-08-15.md` and `NOT_BUILT_MASTER_INVENTORY.md` but never had a WGR row or
   evidence file until this pass. Code state unchanged.

**The single highest-leverage open question this reconciliation surfaced is not one of the 6 gaps
above** — it's whether the **5 already-registered** `vercel.json` crons actually succeed in
production at all. See the WGR-023/WGR-003 disposition below.

## PT-08-003 — `agent_queue` lifecycle exercise

**4 scenarios exercised against a disposable local Postgres database (never production), using the
real, unmodified `routeQueueItem()` default-case throw as the poison-job runner (not a test-only
stand-in). `overallVerdict: ALL_SEMANTICS_CORRECT`. Zero broken assertions.**
(`test-evidence/pt-08/queue-semantics.json`, `overallVerdict`, `brokenAssertions: []`)

| Scenario | Result |
|---|---|
| A — full lifecycle success | `queued → processing (started_at set) → completed (completed_at set, output_payload written)`. All 6 assertions true. |
| B — retry then recovery | First attempt fails: row **requeued** (`status: queued`, not terminal), `retry_count` incremented, `error_message` recorded, `completed_at` stays null, row reclaimable. Second attempt succeeds and reaches `completed`. All 7 assertions true. |
| C — exhaust retries → terminal | A job that always fails (real `routeQueueItem()` default-case throw) is retried up to `max_retries=3`, then reaches a real terminal `failed` state (`completed_at` set) and a 4th claim attempt returns null — never reclaimed again. All 6 assertions true. |
| D — poison job does not block queue | A poison job queued strictly ahead of a good job (same priority, earlier `queued_at`) is claimed first on every attempt, exhausts its 3 retries and reaches terminal `failed`, and **only then** does the good job get claimed and reach `completed`. 3 poison-job attempts before the good job's first claim — exactly matches `max_retries=3`. All 5 assertions true. |

**One ancillary finding, filed UNVERIFIED (code-read observation, not a live-reproduced hang):**
**WGR-040, P1** — `processAgentQueue()`/`runQueueItem()` has no per-item timeout wrapper (grepped
for `timeout`/`Promise.race`/`setTimeout`: only the empty-poll `sleep()` backoff). The
claim/retry/terminal state machine itself is confirmed correct for a job that *throws* (scenarios C
and D above); a job whose work *hangs* (never resolves, never rejects) is not bounded by anything
visible at this layer and would block every other queued item indefinitely, since the poll loop
fully `await`s each claimed item before claiming the next. Not independently reproduced — a genuine
infinite hang would hang the test run itself.

## WGR-023 / WGR-003 disposition — can the background tier actually run in production?

This is the synthesis question this phase exists to answer, pulling together PT-08-001's live boot
evidence, PT-08-002's registration reconciliation, and the pre-existing WGR-023 (middleware blocks
unauthenticated callers) and WGR-003 (env-var/production discrepancy) findings from PT-02. **The
answer splits cleanly into two independent mechanisms with two different verdicts — conflating them
would be wrong in both directions.**

1. **`worker/scheduler.ts`'s 13 jobs — CONFIRMED OPERATIONAL IN PRODUCTION, independent of
   WGR-023/WGR-003 entirely.** These jobs run *inside* the long-running Railway `benavora-worker`
   process itself. They are not Next.js API routes, are never reached over HTTP, and are never
   subject to `src/middleware.ts` at all — WGR-023's finding (unauthenticated HTTP callers get
   redirected before a route's own auth check runs) structurally cannot apply to them, because
   there is no HTTP request in this path in the first place. This is confirmed by direct evidence,
   not inference: `test-evidence/pt-08/railway-scheduler-jobs-fired.json` shows all 13 jobs actually
   firing at their correct scheduled times across a real 5-day production window
   (2026-08-15–2026-08-19), including AG-10, AG-23/32, AG-25, AG-26, AG-27, AG-36, AG-38, AG-42, the
   nightly pipeline (+ AG-28 follow-ups), and the morning digest. This is the machinery PT-09
   (agents) needs — and it is genuinely running, right now, in production.
2. **`vercel.json`'s 5 registered crons (`research`, `grantsgov`, `reminders`, `autoapply`,
   `domain-warmup`) — UNRESOLVED, and this phase did not settle it.** These ARE Next.js HTTP routes
   invoked by Vercel Cron, and ARE subject to `src/middleware.ts`. PT-02's own local-dev-server
   sweep (re-confirmed by direct code read this phase, `test-evidence/pt-08/cron-reconciliation.json`
   `middlewareCrossCheck`) found `src/middleware.ts` redirects an unauthenticated caller to `/login`
   (`307`) for **all 11** `/api/cron/*` routes — including all 5 registered ones — before the
   route's own `CRON_SECRET` check ever runs. Vercel Cron's server-to-server invocation carries no
   session cookie, the same as an anonymous request. Reid separately reports production returns
   `401` (not a redirect) for an unauthenticated cron call — the opposite of the local-dev finding.
   Neither claim has been independently re-tested against the deployed Vercel URL by any audit pass
   to date; this phase's constraints were explicitly prod-safe/static-read-only, so it could not
   settle this itself. **Until a real unauthenticated `curl` against the live production URL is
   run, do not assume any of these 5 crons are succeeding in production** — but also do not assume
   they're failing; the honest state is unresolved, not broken.
3. **The other 6 `/api/cron/*` routes (`campaigns`, `draft-automation`, `draft-queue-check`,
   `email-sequences`, `follow-ups`, `sales-sends`) are moot on the middleware question entirely** —
   they're registered nowhere, so whether middleware would block them or not is irrelevant; they
   simply never fire, full stop (except `draft-queue-check`, whose capability is covered elsewhere,
   and `campaigns`, intentionally retired).

**Net disposition for PT-09:** the background tier that actually matters for whether agents run
automatically — the `worker/scheduler.ts` pipeline jobs — is live, confirmed, and running. The
disputed Vercel Cron question affects a narrower, separate set of 5 HTTP-triggered sync/reminder
jobs, not the agent pipeline machinery itself.

## Register coverage

All PT-08 findings are recorded in `test-evidence/_register/WIRING_GAP_REGISTER.md` as rows
**WGR-033 through WGR-040**, each with a real evidence path under `test-evidence/pt-08/` and a
reproduction command. WGR-023 (middleware, P0) and WGR-003 (env-var absence, P2) — both pre-existing
rows from PT-00/PT-02 — were cross-referenced and, for WGR-003 specifically, updated in place with
the live production-`SUPABASE_URL` confirmation this phase's boot-log evidence provides (not
duplicated as a new row). No PT-08 finding from this session exists outside the register.

## Verifier status

```
node scripts/audit/verify-pt08-001.mjs
  -> PASS: boot-inventory.json is valid. 26 processor(s) inventoried.
     State breakdown: {"STARTED":24,"DEFINED-NOT-STARTED":2}. 4 live-log evidence file(s)
     confirmed present and non-empty. 2 DEFINED-NOT-STARTED (dead-code class) finding(s).

node scripts/audit/verify-pt08-002.mjs
  -> PASS: cron-reconciliation.json is valid and internally consistent. setA (documented): 13
     entries. setB (vercel.json): 5 entries. setC (worker/scheduler.ts): 13 entries. cron API
     route handlers: 11. documented-but-unregistered: 6. registered-but-undocumented: 0.
     matched (registered + documented): 5. new WGR findings filed: WGR-035, WGR-036, WGR-037,
     WGR-038, WGR-039.

node scripts/audit/verify-pt08-003.mjs
  -> PT-08-003 PASS: queue-semantics.json records the real agent_queue lifecycle with
     before/after row state at each transition -- claim (scenario A), retry (scenario B),
     max-retries terminal state (scenario C), completion with output written (scenario A), and
     poison-job failure isolation (scenario D, 3 poison-job attempt(s) before the good job
     completed). overallVerdict: ALL_SEMANTICS_CORRECT. 1 ancillary finding(s) recorded.

node scripts/audit/verify-pt08-004.mjs   -> this phase's closing verifier (see REVIEW-PACK.md)
```
