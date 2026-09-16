# SCHEDULING INFRASTRUCTURE AUDIT (2026-09-15)

Phase 0 audit deliverable 3 of 5.

## Premise correction

The task brief asked to read `src/jobs/*.ts`, `src/workers/*.ts`, and `src/app/api/crons/*.ts`.
None of these paths exist. Real locations: repo-root `worker/` (a separately-deployed Railway
process, not under `src/`), and `src/app/api/cron/` (singular, not `crons`).

## 1. The 6 Vercel crons — all real, none are stubs

| Cron path | Schedule | Handler(s) | Source file |
|---|---|---|---|
| `/api/cron/research` | daily 06:00 | `CorporateGivingResearchAgent`, `FoundationGrantsResearchAgent`, `GovernmentGrantsResearchAgent`, `LocalSponsorshipResearchAgent`, `DraftQueueEngine` | `src/app/api/cron/research/route.ts` |
| `/api/cron/grantsgov` | daily 07:00 | admin client + grants.gov ingest (inline) | `src/app/api/cron/grantsgov/route.ts` |
| `/api/cron/reminders` | daily 08:00 | `ReminderEngine` (`src/lib/calendar/reminder-engine.ts`) | `src/app/api/cron/reminders/route.ts` |
| `/api/cron/autoapply` | daily 02:00 | `populateQueue()` (`src/lib/autoapply/auto-queue-populator.ts`), `sendAutoapplyDigest()` (`src/lib/autoapply/digest-email.ts`) | `src/app/api/cron/autoapply/route.ts` |
| `/api/cron/autoapply-retry` | hourly | `runRetrySweep()` (`src/lib/autoapply/submission-retry.ts`) | `src/app/api/cron/autoapply-retry/route.ts` |
| `/api/cron/domain-warmup` | daily 06:00 | `WarmupEngine` (`src/lib/admin/warmup-engine.ts`) | `src/app/api/cron/domain-warmup/route.ts` |

Note: `runRetrySweep()` is unscoped (per prior session record — it was already run once directly
against production data). Still live-wired as-is; flagged, not a new finding.

## 2. The worker's 13 scheduled jobs — real, non-trivial, `setInterval`-based (not node-cron)

`worker/scheduler.ts` runs a single `setInterval` checking America/Chicago wall-clock time once a
minute against 13 hardcoded jobs. This confirms prior project memory that `WORKER_ARCHITECTURE_v2.md`'s
documented "node-cron" architecture is stale/inaccurate — it's genuinely `setInterval` plus a
self-guard against double-firing the same calendar day.

| Job | Schedule | Handler | Delegates to |
|---|---|---|---|
| Nightly autonomous pipeline | 02:00 daily | `runAutonomousPipeline` | `worker/autonomous-orchestrator.ts`, + AG-28 followups sweep (`processFollowups`) |
| Morning digest | 07:00 daily | `runDigestPipeline` | autonomous-orchestrator.ts |
| Self-improvement (AG-38) | 04:00 daily | `runSelfImprovementPipeline` | autonomous-orchestrator.ts — **scheduled but 0 executions in 30 days, see LEGACY_AGENT_STATUS.md** |
| AutoApply overnight | 03:00 daily | `runAutonomousAutoApply` | `worker/autoapply-autonomous-orchestrator.ts` |
| Learning network aggregator (AG-36) | 06:00, self-gates Sunday | `runLearningNetworkPipeline` | autonomous-orchestrator.ts — **also runs via the nightly pipeline above, double-scheduled** |
| Grant DNA weekly (AG-10) | 03:00, self-gates Sunday | `runGrantDnaWeeklyPipeline` | autonomous-orchestrator.ts |
| Change monitor daily (AG-42) | 05:00 daily | `runChangeMonitorDailyPipeline` | autonomous-orchestrator.ts |
| Disaster response (AG-25) | 05:45 daily | `runDisasterResponsePipeline` | autonomous-orchestrator.ts (plain functions, don't log to `agent_runs` — see AGENT_INVENTORY_COMPLETE.md §1) |
| Foundation enrichment weekly | 03:00 Sunday, gated on `ENABLE_SCRAPER` | `runFoundationScraper()` | inline |
| Relationship graph incremental (AG-23/32) | 05:30 daily | `runRelationshipGraphIncrementalPipeline` | autonomous-orchestrator.ts |
| Funding forecast monthly (AG-26) | 04:00, 1st-of-month | `runFundingForecastMonthlyPipeline` | autonomous-orchestrator.ts |
| Board packet daily (AG-27) | 02:00 daily | `runBoardPacketDailyPipeline` | autonomous-orchestrator.ts — **0 executions in 30 days despite this schedule** |
| Nonprofit enrichment weekly | 04:00 Sunday, gated on `ENABLE_SCRAPER` | `runNonprofitScraper()` | inline |

Separately, `worker/index.ts` runs a continuous `processAgentQueue()` DB-poll loop (claims the
highest-priority row from `agent_queue`, sleeps 30s when empty) — a queue-driven execution path
independent of the time-based schedule above.

## 3. Outbound-comms cron routes — 6 orphaned, not 5

`src/app/api/cron/` has 12 subdirectories; only 6 are registered in `vercel.json` (§1). The other
6 exist as real, non-stub code, reachable only via a manually-supplied `CRON_SECRET` (they're
listed in `middleware.ts`'s cron-auth allowlist), but **nothing in the codebase calls any of them
automatically** — no `vercel.json` entry, no `worker/scheduler.ts` entry:

| Orphaned route | Real handler |
|---|---|
| `sales-sends` | `SalesCampaignEngine.processQueuedSends()` |
| `email-sequences` | `sequenceEngine.processScheduledSends()` |
| `follow-ups` | `processFollowUps()` (`autoapply/follow-up-scheduler`) |
| `draft-automation` | `DraftAutoGenerator` + `DraftQueueEngine` |
| `draft-queue-check` | `DraftQueueEngine` |
| `campaigns` | `EmailCampaignAgent` — retired from `vercel.json` in commit `5f1c7b5` ("zero orgs have cold_outreach_email enabled"); route file still live |

A prior session's notes claimed `sales-sends`/`email-sequences` were registered in `vercel.json`
on 2026-09-08. `git log -S"sales-sends" --all -- vercel.json` (and same for `"email-sequences"`)
both return **zero commits ever** — that change did not land on `main`. Treat as not done.

`RESEND_API_KEY` / `RESEND_WEBHOOK_SECRET` are absent from `.env.local`; Vercel Production env
cannot be checked from this sandbox — this remains the real blocker on any of the 6 routes above
actually sending real outbound email, independent of the cron-wiring question.

## 4. Dependency chain

Every cron/worker job listed above writes to `agent_runs` (directly or via the agent class it
calls). **Nothing in the codebase reads another job's `agent_runs` output to trigger itself** — no
job-to-job chaining happens by polling `agent_runs`. Where chaining exists, it's via dedicated
queue tables (`agent_queue`, PIL's `pil_delegated_tasks`) or direct function calls within one
pipeline run, not by watching this table. Practical implication: a downstream consumer that wanted
to react to an agent's output (e.g., alert on AG-29's failures) would have to be built new — there
is no existing hook to attach to.

## 5. Railway process health

Cannot be verified from this sandbox (no Railway API/CLI access here). `railway.json` at repo root
only configures build/deploy settings, no runtime health data. Flagged as a manual-check item —
same caveat as Vercel Production env vars above.
