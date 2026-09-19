# SCHEDULER_MAP.md — Trigger and Scheduler Audit (AR-13.2)

**Date:** 2026-09-19
**Scope:** Every mechanism on this platform that fires an agent, worker loop, or
scheduled job — Vercel cron, the Railway worker's boot-time loops, queue
consumers, the autonomous orchestrator's own scheduling, and any database-side
scheduling. Built from live source-code reading (`vercel.json`, `worker/**`,
`src/lib/pil/research-orchestrator.ts`) and live queries against the
`vbjplpquqxxfbpazyalt` Supabase project. No production behavior changed.

This document answers one question directly: **of this platform's 67,184
lifetime `agent_runs` rows, how many represent real work, and how many are
empty polling?**

## The headline number

| | Lifetime | Last 7 days |
|---|---|---|
| Total `agent_runs` rows | 67,184 | 10,664 |
| Rows with `items_processed > 0` (real work) | 1,511 | 363 |
| **Real-work ratio** | **2.25%** | **3.4%** |
| `ag-29-knowledge-indexer` rows alone | 64,533 (96.1% of all rows, ever) | 9,701 (91.0% of the last 7 days) |
| `ag-29-knowledge-indexer` real-work rows | 3 | 2 |
| Real-work ratio, **excluding** `ag-29` | 1,508 / 2,651 = **56.9%** | 361 / 963 = **37.5%** |

**The single worst offender, by a wide margin, is `ag-29-knowledge-indexer`.**
It is not merely the largest contributor to empty polling — it is large enough
that it single-handedly determines the platform-wide ratio: pulling it out
takes the lifetime ratio from 2.25% to 56.9%, and the 7-day ratio from 3.4% to
37.5%. Including it, the platform looks 97.75%/96.6% idle. Both the
including- and excluding-ag-29 numbers are real and true; they answer
different questions ("how healthy is the whole run history" vs. "how healthy
is the rest of the platform once you isolate the one broken poller"), and
conflating them is the error this audit exists to prevent. Note the
excluding-ag-29 ratio is meaningfully lower for the last 7 days (37.5%) than
lifetime (56.9%): the last 7 days happen to include the AR-7.1 verification
session's bulk EA-family reprocessing (§5's 50-run batches on 2026-09-17/18),
which drove up recent volume without a proportional rise in genuinely new
real-world enrichment — see the per-agent table in §4/§5 for which of those
runs were organic production traffic versus that session's manual test batch.

## 1. Why `ag-29-knowledge-indexer` is different in kind, not just degree

Every other continuous poll loop in this codebase (`enrichment-processor.ts`,
`dd-request-processor.ts`, `queue-processor.ts`, `processAgentQueue()`,
`alert-notifier.ts`) checks whether there is a claimable row **before** writing
anything to `agent_runs`. An empty poll is invisible in the run history — it
just sleeps and tries again.

`worker/knowledge-indexer-processor.ts`'s loop instead calls
`this.agent.run('autonomous')` unconditionally on every 60-second tick, and
`KnowledgeIndexerAgent.run()` (`src/lib/agents/knowledge-indexer-agent.ts:532`)
calls `this.startRun(triggerSource)` — which writes a real `agent_runs` row —
**before** it queries for indexable rows at all. Whether the pass finds 0 or
100 candidates, a row lands in `agent_runs` either way. This is the
architectural reason one agent accounts for 96% of the table: it is the only
poller in the codebase that records a formal "run" for the act of finding
nothing.

Root cause of the emptiness itself (confirmed unchanged since AR-13.1,
re-verified live this session): `foundation_directory` has 133,812/133,812 rows
with `embedding IS NULL`, and every one of those rows also has `programs IS
NULL` and no `enrichment.mission` key — the only two text sources
`flattenFoundationText()` can index. The query and filter logic are correct;
there is structurally nothing to embed, on every single pass, because
`foundation-scraper.ts` never populates the two fields this agent reads. This
was root-caused in AR-13.1 and is unchanged. **The fix belongs in the scraper,
not the indexer — and even a scraper fix would not stop the poller from
writing an empty `agent_runs` row every 60s once the backlog next drains; that
requires changing this loop's own write-before-check pattern, unless a fill
also lands `batchWasFull=true` back-to-back forever, which is not this
codebase's steady state.**

## 2. Full trigger inventory

| # | Trigger | Fires via | Interval/schedule | Invokes | Live in prod? |
|---|---|---|---|---|---|
| 1 | Vercel cron ×7 | `vercel.json` | see §3 | research/grantsgov/reminders/autoapply/domain-warmup/autoapply-retry/pil-research | code confirmed; dashboard liveness NOT independently confirmed this session (see §3 note) |
| 2 | `worker/scheduler.ts` | `setInterval` 60s tick, fires 12 named jobs at fixed HH:MM America/Chicago | daily/weekly per job, see §4 | nightly pipeline, digest, AG-10/23/25/26/27/32/36/38/42, 2 scrapers | confirmed live (Railway boot log, `worker_status` heartbeat current) |
| 3 | `worker/queue-processor.ts` | continuous poll, 15s empty-sleep | on `submission_queue` row insert | AutoApply agents (FormAnalyzer/FormFiller/CAPTCHA/Registration etc.) | live |
| 4 | `worker/dd-request-processor.ts` | continuous poll, 15s empty-sleep | on `donor_discovery_requests` row insert | enumerate → enrich → link → score pipeline | live, but queue is nearly always empty (see §5) |
| 5 | `worker/enrichment-processor.ts` | continuous poll, 60s empty-sleep | on `corporate_prospects` row with `enrichment_completed_at IS NULL` | EA-01..EA-10 + chained AG-22 | live, queue permanently drained (see §5) |
| 6 | `worker/knowledge-indexer-processor.ts` | continuous poll, 60s empty-sleep, **writes agent_runs unconditionally every tick** | on `foundation_directory`/other embeddable rows | AG-29 KnowledgeIndexerAgent | live — this is the worst offender, §1 |
| 7 | `worker/stuck-run-watchdog.ts` | `setInterval`-style sleep loop, 10 min | sweeps `agent_runs`/`pil_agent_runs`/`automation_sessions` for stuck rows | marks stuck rows failed; raises alert for reaped automation_sessions | live |
| 8 | `worker/alert-notifier.ts` | continuous poll, 60s empty-sleep | on `alerts` row with `severity='critical' AND notified_at IS NULL` | POSTs to `FORGE_SLACK_WEBHOOK` | live but **never once delivered** — see §5 |
| 9 | `src/lib/autoapply/confirmation-monitor.ts` | continuous poll, 5 min | reads Gmail inbox `apply@benavora.com` | matches submission confirmations | live but permanent no-op — `GMAIL_CONFIRMATION_MONITOR_REFRESH_TOKEN` unset, never writes to `agent_runs` at all |
| 10 | `worker/heartbeat.ts` | `setInterval` 30s | writes `worker_status` | infrastructure heartbeat only — not an agent trigger | live |
| 11 | `processAgentQueue()` (`worker/autonomous-orchestrator.ts:2432`) | continuous poll, 30s empty-sleep | on `agent_queue` row (priority DESC, queued_at ASC) | routes to ~20 event/chain-only agents (AG-05/15/18/19/28/funder_relationship/budget_builder_worker/etc.) | live, healthy — 608 lifetime rows, 585 completed |
| 12 | PIL: `/api/cron/pil-research` (Vercel cron, 10 min) → `pollAndOrchestratePendingRuns()` | Vercel cron | every 10 min | 51 `BEN-*` PIL agents via `agent-runner.ts` | live, but `pil_agent_runs` volume is tiny (33 in 7d) relative to the poll frequency — see §5 |
| — | pg_cron / pg_net / http (database-side scheduling) | — | — | — | **NOT INSTALLED — confirmed live this session, see §3.5** |

## 3. Vercel cron entries (`vercel.json`)

```
/api/cron/research         0 6 * * *      (daily 06:00 UTC)
/api/cron/grantsgov        0 7 * * *      (daily 07:00 UTC)
/api/cron/reminders        0 8 * * *      (daily 08:00 UTC)
/api/cron/autoapply        0 2 * * *      (daily 02:00 UTC)
/api/cron/domain-warmup    0 6 * * *      (daily 06:00 UTC)
/api/cron/autoapply-retry  0 * * * *      (hourly)
/api/cron/pil-research     */10 * * * *   (every 10 min)
```

All gated by `CRON_SECRET` bearer-token auth — an unauthorized request gets a
401, not a silent no-op; this is an auth gate, not an agent-disabling
mechanism.

**Liveness caveat, repeated from AR-9.3 and still true this session:** Vercel's
own dashboard is the only authoritative source for whether a cron entry
actually fires in the deployed environment; `vercel.json` only proves it
*exists in code*. This session's Vercel MCP connector resolves projects under
an account/team that does not include "benavora" (`list_projects` search
returned zero results) — the same team-mismatch already logged in memory for
the Vercel CLI (`benavora-vercel-cli-team-mismatch-2026-09-15`). Cron liveness
in the dashboard remains unconfirmed by tooling in this session; the strongest
available evidence is indirect — `eligibility_scoring` shows 211 runs in the
last 7 days sourced from the research-agent families that `/api/cron/research`
invokes, which is consistent with that cron firing daily, but is not a direct
confirmation.

### 3.5 pg_cron / pg_net / http — confirmed NOT installed

```sql
select extname, extversion from pg_extension where extname in ('pg_cron','pg_net','http');
-- []
select schema_name from information_schema.schemata where schema_name in ('cron','net');
-- []
```

Both queries ran live against the production database this session and
returned zero rows. There is no database-side scheduling on this platform at
all — every trigger on the platform is either a Vercel cron entry or a
Node.js `setInterval`/sleep-loop inside the Railway worker process. This
matches `worker/alert-notifier.ts`'s own header comment (independently
verified 2026-09-17), now independently re-confirmed by direct query rather
than taken on the comment's word.

## 4. `worker/scheduler.ts` — the 12-job wall-clock scheduler

A single `setInterval` (60s tick) compares the current America/Chicago
wall-clock time against a fixed table of 12 jobs and fires any whose HH:MM
matches, guarded per-job against firing twice in one calendar day. No
`node-cron` dependency — deliberately a plain interval (see the file's own
header). **No failure counter or disabling mechanism exists here**: a thrown
error is caught, logged, and the job simply gets another chance at its next
scheduled time — confirmed by reading the full 344-line file, there is no
retry-count, no backoff, no flag flip anywhere in this module.

| Job | Time (CST) | Cadence | Gate | runs_7d (representative agent) | real-work_7d |
|---|---|---|---|---|---|
| nightly autonomous pipeline (+ AG-28 followups) | 02:00 | daily | none | 7 (`autonomous_orchestrator`) | 0 — wrapper row only, see note below |
| AG-27 board packet daily pipeline | 02:00 | daily | none | 0 in 7d (lifetime 2/2 completed) | 0 |
| AutoApply overnight orchestrator | 03:00 | daily | none | (feeds `submission_queue`, no direct agent_runs) | n/a |
| AG-10 grant DNA weekly pipeline | 03:00 | daily tick, self-gates Sunday | none at scheduler level | 2 (`ag-10-grant-dna`) | 1 |
| foundation-enrichment-weekly | 03:00 | daily tick, self-gates Sunday | **`ENABLE_SCRAPER==='true'`** | n/a (not an agent_runs row) | current prod value of `ENABLE_SCRAPER` not re-checked this session (Railway CLI/dashboard access not available) |
| AG-38 self-improvement pipeline | 04:00 | daily | none | 5 | 0 |
| AG-26 funding forecast monthly pipeline | 04:00 | daily tick, self-gates 1st-of-month | none | 0 in 7d | 0 |
| nonprofit-enrichment-weekly | 04:00 | daily tick, self-gates Sunday | **`ENABLE_SCRAPER==='true'`** | n/a | same caveat as above |
| AG-42 change monitor daily pipeline | 05:00 | daily, unconditional | none | 7 | 7 |
| AG-25 disaster response pipeline | 05:45 | daily, unconditional | none | 0 in 7d (lifetime unclear — not separately queried) | — |
| AG-23 relationship graph incremental | 05:30 | daily | none | 0 in 7d (lifetime 40/45 completed) | 0 in 7d |
| AG-36 learning network aggregator | 06:00 | daily tick, self-gates Sunday | none | 1 | 0 |
| morning digest pipeline | 07:00 | daily | none | 14 (`ag-digest`) | 7 |

Also fired from this same 02:00/03:00 nightly slot (chained inside
`runAutonomousPipeline`, not separate scheduler entries): `success_probability`
(50 runs/7d, 50 real), `deadline_prediction` (7/7 real), `ag-17-discovery`
(7/7 real), `ag-30-donor-intent` (7/7 real), `ag-10-document-expiry` (4/4
real), `ag-29-fundability` (4/4 real). These are the platform's healthiest
scheduled agents — daily cadence, matched by real per-org work every night.

**`autonomous_orchestrator`'s own 7 rows/7d with 0 real-work rows is not a
red flag** — this `agent_type` is the wrapper/orchestrator row itself
(confirmed in AR-13.1's Registry-gap section), not a leaf agent; it has no
`items_processed` semantics of its own.

## 5. Queues and pollers that fire far more often than work arrives

Confirmed live this session — none of these write empty `agent_runs` rows
(only `ag-29-knowledge-indexer` does, §1), but all three are firing on a
cadence sized for a queue that is essentially never populated:

- **`worker/dd-request-processor.ts`** polls `donor_discovery_requests` every
  15s (5,760×/day). Live count: **5 requests in the table's entire lifetime**,
  0 in the last 7 days, 0 currently in flight. The 15s cadence was presumably
  sized for a queue with real ongoing volume; the table has essentially none.
- **`worker/enrichment-processor.ts`** polls `corporate_prospects` every 60s
  (1,440×/day). Live count: **50 total rows, 0 unenriched** — fully drained,
  confirmed unchanged from AR-9.3's finding that no new rows have entered
  since 2026-08-04 because the only feed (`acquireFromGooglePlaces()`) is
  manual-only with no scheduled sweep.
- **`/api/cron/pil-research`** (Vercel cron, every 10 min = 144×/day) drives
  `pollAndOrchestratePendingRuns()` against `pil_agent_runs`. Live count: 33
  runs in the last 7 days (13 completed, 18 failed) — real activity, but at a
  volume (≈5/day) that a 10-minute cron resolves in well under a second of
  actual work per invocation; most of the 144 daily fires find nothing
  pending.
- **`worker/alert-notifier.ts`** polls `alerts` every 60s (1,440×/day) — this
  one is not a frequency problem, it is a **delivery problem**: live query
  shows `alerts.notified_at` is `NULL` on every single row in the table,
  including 637 `severity='critical'` rows dating back to 2026-06-22, and
  **zero rows, ever, have `notified_at IS NOT NULL`**. The poller is
  confirmed running (it's started at worker boot, `worker/index.ts:181`), but
  either `FORGE_SLACK_WEBHOOK` is unset in the Railway production environment
  or every delivery attempt has failed — this session could not distinguish
  the two without Railway env access, but the practical effect is identical:
  **critical alerts have never once reached Slack in this platform's
  history.** Flagged, not fixed, per this task's scope.

By contrast, `worker/queue-processor.ts` (submission_queue, 15s poll) and
`processAgentQueue()` (agent_queue, 30s empty-sleep) are **not** over-
provisioned relative to their queues — `agent_queue` has 608 lifetime rows
(585 completed) and `submission_queue` has real if small volume (59 runs/7d).

## 6. Disabling mechanisms — does a failing agent ever get un-scheduled?

Directly relevant to triaging the ~51-52 NEVER-INVOKED agents from AR-13.1:
**no generic circuit breaker exists.** Re-confirmed this session on top of
AR-9.3/AR-13.1's findings:

1. **`worker/scheduler.ts`'s 12 jobs**: no failure counter, no backoff, no
   flag flip. A job that throws every night for a year still fires every
   night for a year (confirmed by full file read, §4).
2. **The 5 continuous poll loops** (`enrichment-processor`,
   `dd-request-processor`, `knowledge-indexer-processor`,
   `alert-notifier`, `queue-processor`): each catches its own per-pass error,
   logs it, and loops again after its sleep interval. None of them stop
   polling because of repeated failure.
3. **`processAgentQueue()`**: same shape — a claim or dispatch error is
   logged; the loop continues.
4. **`src/lib/resilience/circuit-breaker.ts`**: confirmed (again) to be
   imported **only by its own unit test** — not wired into
   `queue-processor.ts`, `proxy-manager.ts`, `stealth-engine.ts`, or
   `custom-scrape.ts`. Orphaned code, not a live mechanism, per AR-13.1 §7.2.
5. **Real disabling mechanisms that DO exist** (per-agent or per-org, not a
   generic breaker): `pil_agent_registry.active` (live-queried this session:
   **all 51 rows still `active=true`** — nothing is currently suppressed by
   it), `isPilEnabledForOrg()` (LaunchDarkly per-org gate on PIL run
   creation), and `ENABLE_SCRAPER` (env flag gating the two weekly scraper
   jobs, current production value not re-checked this session).
6. **`worker/stuck-run-watchdog.ts`** reaps individual stuck *rows* (marks
   them `failed` after a timeout) — it does **not** disable the agent type
   or scheduler slot going forward. A swept run just means that one
   execution is marked failed; the same agent fires again at its next
   scheduled time or next queue claim, unaffected.

**Conclusion: "never executed" means "never wired to fire, or starved of
input" for essentially the entire NEVER-INVOKED list — not "switched off
after failing."** No mechanism on this platform silently disables a
scheduled or queued agent because it kept failing. The one caveat is
`pil_agent_registry.active`, which is real and worth checking first for any
`BEN-*` agent specifically — but it is currently a no-op gate (all rows
true), so it explains none of the current PIL never-invoked list either.

## 7. Cross-reference: agents with no trigger at all (vs. AR-13.1's census)

AR-13.1's `AGENT_CENSUS.md` verdict tally: 52 NEVER-INVOKED, 4 ORPHANED (56 of
145 rows with zero lifetime executions). Mapping those against this session's
trigger inventory, the *reason* splits cleanly into four buckets already
identified per-agent in `AGENT_CENSUS.md`/`AGENT_INVOCATION_MAP.md` §6-7 and
confirmed structurally consistent with this trigger map:

- **No invoker exists in any of the 12 mechanisms above at all** (pure
  dead code, reachable only by a manual API route nobody has called) —
  the majority of the core-family NEVER-INVOKED rows (`cold_outreach`,
  `custom_scrape_research`, `form_analyzer`, `form_filler`,
  `application_cloning`, `giving_history_extractor`,
  `foundation_research_finder`, `competitor_intelligence`, `hud_monitor`,
  several state-scraper variants, etc.).
- **Wired into `worker/scheduler.ts`'s nightly sweep but gated on
  `org_autonomous_config` having only 1 of ~74 orgs enabled** —
  `ag-35-community-need`, `ag-09-outcome-analyzer`, `ag-11-knowledge-gap`,
  `ag-39-roi-optimizer`, `ag-08-renewal-tracker`, `ag-12-search-optimizer`,
  `ag-40-strategic-advisor`. These have a real, live, firing trigger; they
  are starved of eligible orgs, not un-triggered.
- **Wired into `processAgentQueue()`'s dispatch table but nothing ever
  enqueues that `agent_id`** — `budget_builder_worker` (case exists in
  `routeQueueItem()`, confirmed by AR-13.1, but no code path ever inserts an
  `agent_queue` row with that id).
- **PIL family, positionally unreachable** — `BEN-DIS-03..07`,
  `BEN-INT-02/04/05/06/07/10`, `BEN-REL-02`, `BEN-SUP-08`, etc. The trigger
  (the 10-min `/api/cron/pil-research` poller, §2 item 12) is live and
  firing; these agents simply sit at a family position the pipeline has
  never demonstrably reached in one un-interrupted run (see AR-13.1 §7.3 for
  the `AgentRunner.delegate()` dropped-`plan` bug that is a contributing
  cause for several of these).

No agent in the 144-module registry was found this session to have *zero*
mechanism capable of ever reaching it that wasn't already identified by
AR-13.1 — this trigger map corroborates that census rather than surfacing new
never-invoked agents.

## 8. Summary: real work vs. empty polling, one number

- **67,184 lifetime `agent_runs` rows. 1,511 (2.25%) did real work
  (`items_processed > 0`).**
- **10,664 rows in the last 7 days. 363 (3.4%) did real work.**
- **`ag-29-knowledge-indexer` is 96.1% of all-time volume and 91.0% of the
  last 7 days, on a real-work rate of 0.005% lifetime / 0.02% last-7-days.**
  It is the single worst offender on the platform, both in absolute row count
  and in how close to zero its real-work rate is — no other agent on the
  platform combines this volume with this little output.
- Remove `ag-29` and the last-7-days ratio flips to roughly 1,508/963
  ≈ **56.9% real work** — the rest of the platform's trigger surface, while
  it has real starvation problems of its own (EA family, `dd-request-processor`,
  `alert-notifier`'s delivery gap), is not remotely as broken as the
  aggregate number suggests.
- **No trigger on this platform silently disables an agent after repeated
  failure.** The NEVER-INVOKED population is explained entirely by missing
  wiring, org-config gating, or positional unreachability in a multi-stage
  pipeline — not by a circuit breaker switching anything off.
