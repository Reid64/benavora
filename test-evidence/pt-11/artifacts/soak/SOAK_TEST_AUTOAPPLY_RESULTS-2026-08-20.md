# SOAK_TEST_AUTOAPPLY_RESULTS.md

**Date:** 2026-08-20
**Feature under test:** FEATURE_REGISTRY_v2.md row T7 ("Soak Tests") — AutoApply queue processor (`worker/queue-processor.ts`), Railway service `bd9f0c6b-fe01-4f31-9ef7-5fe9d7d0b127`. **Separate from SOAK_TEST_RESULTS.md**, which covers the enrichment scraper (`scripts/run-nonprofit-scraper.ts`) — not duplicated here.
**Method:** genuine live run against the real, deployed, production Railway worker. 3 real but disposable test organizations created via direct service-role insert (never Faith Foundation or any other real org), 50 real `submission_queue` rows inserted in rapid succession, monitored to completion (or the run's safety cap), then all disposable rows deleted and deletion confirmed via re-query.

---

## Setup

- **Run tag:** `1787214531811`
- **Disposable orgs created:** 3 (`SOAK-TEST-AUTOAPPLY-DISPOSABLE-1787214531811-org-1`, `SOAK-TEST-AUTOAPPLY-DISPOSABLE-1787214531811-org-2`, `SOAK-TEST-AUTOAPPLY-DISPOSABLE-1787214531811-org-3`)
- **Disposable funders:** one per org, `giving_portal_url = NULL` and `contact_email = NULL` — **deliberate, not an oversight.** `worker/queue-processor.ts:571` throws `SkipError('no_portal_or_email')` before any Playwright/StealthBrowser launch or proxy selection when both are null. This lets the soak test exercise the real claim → process → terminal-status-write cycle under real burst load without firing 50 real automated submissions at real charities'/funders' donation portals (a genuine compliance concern per `BEHAVIORAL_CONTRACTS.md` §21/§24 and `AUTOAPPLY_ARCHITECTURE_V2.md` §10, unrelated to what this test measures). **The real browser-automation code path (StealthBrowser, CAPTCHA handling, proxy rotation) was NOT exercised by this run — by design, for safety, not because it was missed.**
- **Real production queue depth immediately before this test's inserts:** pending=0, processing=0 (i.e. the real production queue was completely empty — our 50 test items had zero contention from real orgs' real submissions.
- **Worker status immediately before this test:** worker_id=`railway-worker-1`, status=`idle`, last_heartbeat_at=2026-08-20T08:28:33.991+00:00, items_processed=2, items_failed=0

---

## Previously undocumented finding: unconditional 60-120s rate-limiter delay

`worker/queue-processor.ts:410` calls `await this.rateLimiter.waitBetweenSubmissions()` after **every** queue item's terminal write, unconditionally — `worker/rate-limiter.ts`'s `waitBetweenSubmissions()` sleeps a random 60,000-120,000ms (`BASE_DELAY_MS=60_000` + up to `MAX_JITTER_MS=60_000`) regardless of whether the item completed, was skipped, or failed. There is no fast path for an instantly-resolved item (like our fast-skip disposable rows). This means the queue processor's real maximum drain rate is bottlenecked at roughly **1 item per 60-120 seconds (~0.6-1.0 items/minute)**, independent of how much real work each item requires — confirmed live below, not just read from source.

---

## Results

| Metric | Value |
|---|---|
| Queue rows enqueued | 50 |
| Reached a terminal status | 50 / 50 |
| Still non-terminal at run end | 0 |
| Run ended via | all items drained naturally |
| Total wall-clock time | 72m 23s (2026-08-20T08:28:55.948Z → 2026-08-20T09:41:18.832Z) |
| Observed drain throughput | 0.69 items/min |
| Per-item latency (insert → terminal), min/median/max | 0m 7s / 36m 47s / 72m 21s |
| Gap between consecutive item completions, min/median/max | 1m 2s / 1m 29s / 2m 1s (theoretical rate-limiter range: 60s-120s) |
| Genuine `status='failed'` rows (real errors, not skips) | 0 |
| `worker_status.items_processed` delta over the run | 50 |
| `worker_status.items_failed` delta over the run | 0 |

### Status breakdown

| Status | Count |
|---|---|
| `skipped` | 50 |

### Error / skip-reason breakdown (`submission_queue.error_message`)

| error_message | Count |
|---|---|
| `no_portal_or_email` | 50 |

**Zero genuine failures.** Every terminal row resolved exactly as the fast-skip design predicted (`status='skipped'`, `error_message='no_portal_or_email'`) — the real, deployed worker code behaved consistently with what a direct read of `worker/queue-processor.ts:571` predicts.

---

## Memory growth (no metrics endpoint exists — queue depth over time logged instead)

Per this task's own fallback instruction: a metrics endpoint reporting the Railway worker's process RSS was searched for and confirmed NOT to exist anywhere in this codebase before writing this script (`worker/index.ts` starts exactly one HTTP server, `worker/stream-server.ts`, whose only route is `GET /health` returning `{status, viewers}` — a WebSocket-viewer count for AutoApply screen-share, not process telemetry; `process.memoryUsage()` is called nowhere in the repo; no `railway.json` has a `healthcheckPath`). The only real Railway-worker telemetry reachable from this script is the `worker_status` Supabase table, which has no memory field either. **No memory-growth verdict can be drawn from this run** — queue depth over time (this test's own 50 rows, sampled every ~60s) is logged below as the honest substitute, per the task's own explicit fallback instruction, not as a claim that it measures the same thing memory sampling would.

| Time (UTC) | Elapsed | Pending (ours) | Processing (ours) | Terminal (ours) | Worker status | Worker items_processed | Worker items_failed |
|---|---|---|---|---|---|---|---|
| 2026-08-20T08:28:56.086Z | 0m 0s | 50 | 0 | 0/50 | idle | 2 | 0 |
| 2026-08-20T08:29:58.076Z | 1m 2s | 49 | 0 | 1/50 | idle | 3 | 0 |
| 2026-08-20T08:31:00.940Z | 2m 5s | 48 | 0 | 2/50 | idle | 4 | 0 |
| 2026-08-20T08:32:03.440Z | 3m 7s | 47 | 0 | 3/50 | idle | 5 | 0 |
| 2026-08-20T08:33:06.471Z | 4m 11s | 46 | 0 | 4/50 | idle | 6 | 0 |
| 2026-08-20T08:34:08.951Z | 5m 13s | 46 | 0 | 4/50 | idle | 6 | 0 |
| 2026-08-20T08:35:12.836Z | 6m 17s | 45 | 0 | 5/50 | idle | 7 | 0 |
| 2026-08-20T08:36:15.953Z | 7m 20s | 44 | 0 | 6/50 | idle | 8 | 0 |
| 2026-08-20T08:37:18.726Z | 8m 23s | 44 | 0 | 6/50 | idle | 8 | 0 |
| 2026-08-20T08:38:21.251Z | 9m 25s | 43 | 0 | 7/50 | idle | 9 | 0 |
| 2026-08-20T08:39:24.678Z | 10m 29s | 42 | 0 | 8/50 | idle | 10 | 0 |
| 2026-08-20T08:40:27.226Z | 11m 31s | 41 | 0 | 9/50 | idle | 11 | 0 |
| 2026-08-20T08:41:30.093Z | 12m 34s | 41 | 0 | 9/50 | idle | 11 | 0 |
| 2026-08-20T08:42:32.912Z | 13m 37s | 40 | 0 | 10/50 | idle | 12 | 0 |
| 2026-08-20T08:43:36.110Z | 14m 40s | 39 | 0 | 11/50 | idle | 13 | 0 |
| 2026-08-20T08:44:39.334Z | 15m 43s | 38 | 0 | 12/50 | idle | 14 | 0 |
| 2026-08-20T08:45:42.329Z | 16m 46s | 38 | 0 | 12/50 | idle | 14 | 0 |
| 2026-08-20T08:46:45.214Z | 17m 49s | 37 | 0 | 13/50 | idle | 15 | 0 |
| 2026-08-20T08:47:47.957Z | 18m 52s | 37 | 0 | 13/50 | idle | 15 | 0 |
| 2026-08-20T08:48:50.657Z | 19m 55s | 36 | 0 | 14/50 | idle | 16 | 0 |
| 2026-08-20T08:49:53.714Z | 20m 58s | 36 | 0 | 14/50 | idle | 16 | 0 |
| 2026-08-20T08:50:56.412Z | 22m 0s | 35 | 0 | 15/50 | idle | 17 | 0 |
| 2026-08-20T08:51:59.233Z | 23m 3s | 34 | 0 | 16/50 | idle | 18 | 0 |
| 2026-08-20T08:53:02.325Z | 24m 6s | 33 | 0 | 17/50 | idle | 19 | 0 |
| 2026-08-20T08:54:05.117Z | 25m 9s | 32 | 0 | 18/50 | idle | 20 | 0 |
| 2026-08-20T08:55:07.975Z | 26m 12s | 32 | 0 | 18/50 | idle | 20 | 0 |
| 2026-08-20T08:56:10.944Z | 27m 15s | 31 | 0 | 19/50 | idle | 21 | 0 |
| 2026-08-20T08:57:13.716Z | 28m 18s | 30 | 0 | 20/50 | idle | 22 | 0 |
| 2026-08-20T08:58:17.084Z | 29m 21s | 29 | 0 | 21/50 | idle | 23 | 0 |
| 2026-08-20T08:59:20.095Z | 30m 24s | 29 | 0 | 21/50 | idle | 23 | 0 |
| 2026-08-20T09:00:23.257Z | 31m 27s | 28 | 0 | 22/50 | idle | 24 | 0 |
| 2026-08-20T09:01:26.031Z | 32m 30s | 27 | 0 | 23/50 | idle | 25 | 0 |
| 2026-08-20T09:02:29.218Z | 33m 33s | 27 | 0 | 23/50 | idle | 25 | 0 |
| 2026-08-20T09:03:32.093Z | 34m 36s | 26 | 0 | 24/50 | idle | 26 | 0 |
| 2026-08-20T09:04:34.207Z | 35m 38s | 26 | 0 | 24/50 | idle | 26 | 0 |
| 2026-08-20T09:05:37.185Z | 36m 41s | 25 | 0 | 25/50 | idle | 27 | 0 |
| 2026-08-20T09:06:39.977Z | 37m 44s | 24 | 0 | 26/50 | idle | 28 | 0 |
| 2026-08-20T09:07:42.870Z | 38m 47s | 23 | 0 | 27/50 | idle | 29 | 0 |
| 2026-08-20T09:08:46.378Z | 39m 50s | 23 | 0 | 27/50 | idle | 29 | 0 |
| 2026-08-20T09:09:49.910Z | 40m 54s | 22 | 0 | 28/50 | idle | 30 | 0 |
| 2026-08-20T09:10:52.604Z | 41m 57s | 21 | 0 | 29/50 | idle | 31 | 0 |
| 2026-08-20T09:11:55.209Z | 42m 59s | 21 | 0 | 29/50 | idle | 31 | 0 |
| 2026-08-20T09:12:57.811Z | 44m 2s | 20 | 0 | 30/50 | idle | 32 | 0 |
| 2026-08-20T09:14:01.095Z | 45m 5s | 19 | 0 | 31/50 | idle | 33 | 0 |
| 2026-08-20T09:15:04.443Z | 46m 8s | 18 | 0 | 32/50 | processing | 34 | 0 |
| 2026-08-20T09:16:07.385Z | 47m 11s | 18 | 0 | 32/50 | idle | 34 | 0 |
| 2026-08-20T09:17:10.395Z | 48m 14s | 17 | 0 | 33/50 | idle | 35 | 0 |
| 2026-08-20T09:18:13.333Z | 49m 17s | 17 | 0 | 33/50 | idle | 35 | 0 |
| 2026-08-20T09:19:16.267Z | 50m 20s | 16 | 0 | 34/50 | idle | 36 | 0 |
| 2026-08-20T09:20:19.345Z | 51m 23s | 15 | 0 | 35/50 | idle | 37 | 0 |
| 2026-08-20T09:21:22.060Z | 52m 26s | 14 | 0 | 36/50 | idle | 38 | 0 |
| 2026-08-20T09:22:25.034Z | 53m 29s | 14 | 0 | 36/50 | idle | 38 | 0 |
| 2026-08-20T09:23:27.990Z | 54m 32s | 13 | 0 | 37/50 | idle | 39 | 0 |
| 2026-08-20T09:24:30.785Z | 55m 35s | 12 | 0 | 38/50 | idle | 40 | 0 |
| 2026-08-20T09:25:33.769Z | 56m 38s | 12 | 0 | 38/50 | idle | 40 | 0 |
| 2026-08-20T09:26:37.082Z | 57m 41s | 11 | 0 | 39/50 | idle | 41 | 0 |
| 2026-08-20T09:27:40.297Z | 58m 44s | 10 | 0 | 40/50 | idle | 42 | 0 |
| 2026-08-20T09:28:43.324Z | 59m 47s | 10 | 0 | 40/50 | idle | 42 | 0 |
| 2026-08-20T09:29:46.194Z | 60m 50s | 9 | 0 | 41/50 | idle | 43 | 0 |
| 2026-08-20T09:30:49.326Z | 61m 53s | 8 | 0 | 42/50 | idle | 44 | 0 |
| 2026-08-20T09:31:52.149Z | 62m 56s | 7 | 0 | 43/50 | idle | 45 | 0 |
| 2026-08-20T09:32:55.007Z | 63m 59s | 6 | 0 | 44/50 | idle | 46 | 0 |
| 2026-08-20T09:33:58.284Z | 65m 2s | 5 | 0 | 45/50 | idle | 47 | 0 |
| 2026-08-20T09:35:01.338Z | 66m 5s | 5 | 0 | 45/50 | idle | 47 | 0 |
| 2026-08-20T09:36:03.902Z | 67m 8s | 4 | 0 | 46/50 | idle | 48 | 0 |
| 2026-08-20T09:37:07.465Z | 68m 12s | 3 | 0 | 47/50 | idle | 49 | 0 |
| 2026-08-20T09:38:10.194Z | 69m 14s | 3 | 0 | 47/50 | idle | 49 | 0 |
| 2026-08-20T09:39:12.931Z | 70m 17s | 2 | 0 | 48/50 | idle | 50 | 0 |
| 2026-08-20T09:40:15.823Z | 71m 20s | 1 | 0 | 49/50 | idle | 51 | 0 |
| 2026-08-20T09:41:18.832Z | 72m 23s | 0 | 0 | 50/50 | idle | 52 | 0 |

---

## PROXY_LIST empty — did it cause any observable degradation under this load?

**No.** `PROXY_LIST` (read in `worker/proxy-manager.ts:36`, consumed via `ProxyManager.rotateForSubmission()` at `worker/queue-processor.ts:1085-1091`, immediately before `StealthBrowser.launch()`) is only ever read **after** the `no_portal_or_email` fast-skip check at `worker/queue-processor.ts:571`. Every one of this run's 50 items resolved via that fast-skip path by design (see Setup above), so **zero of the 50 items ever reached the code that reads `PROXY_LIST` or calls `rotateForSubmission()`** — `PROXY_LIST` being empty had no code path to affect in this run. This is a real, numeric finding (0/50 items reached that code), not an assumption — but it also means **this soak test cannot speak to PROXY_LIST's effect on real browser-automation submissions**, since exercising that would require queuing items against funders with a real `giving_portal_url`, which is the exact real-external-site risk this test's design deliberately avoided. That would need a separate, differently-scoped test explicitly authorized to hit real (or realistic sandbox) portals — out of scope here.

---

## Railway platform logs — access attempted, real result

- **Attempted:** yes
- **Succeeded:** yes
- **Detail:** railway CLI (`railway logs --service bd9f0c6b-fe01-4f31-9ef7-5fe9d7d0b127 --json --since 2026-08-20T08:28:55.948Z --until 2026-08-20T09:41:18.832Z --filter "@level:error"`) reached real, authenticated Railway platform logs for the run window and returned 15 error-level line(s).
- **Matched error lines:**
  - `[2026-08-20T08:32:19.001074131Z] [gmail-confirmation-monitor] Skipping cycle — GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET / GMAIL_CONFIRMATION_MONITOR_REFRESH_TOKEN not fully configured. This requires a one-time human OAuth consent as apply@benavora.com — see AUTOAPPLY_ARCHITECTURE_V2.md §10A.`
  - `[2026-08-20T08:37:18.987197015Z] [gmail-confirmation-monitor] Skipping cycle — GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET / GMAIL_CONFIRMATION_MONITOR_REFRESH_TOKEN not fully configured. This requires a one-time human OAuth consent as apply@benavora.com — see AUTOAPPLY_ARCHITECTURE_V2.md §10A.`
  - `[2026-08-20T08:42:18.995255053Z] [gmail-confirmation-monitor] Skipping cycle — GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET / GMAIL_CONFIRMATION_MONITOR_REFRESH_TOKEN not fully configured. This requires a one-time human OAuth consent as apply@benavora.com — see AUTOAPPLY_ARCHITECTURE_V2.md §10A.`
  - `[2026-08-20T08:47:19.140428470Z] [gmail-confirmation-monitor] Skipping cycle — GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET / GMAIL_CONFIRMATION_MONITOR_REFRESH_TOKEN not fully configured. This requires a one-time human OAuth consent as apply@benavora.com — see AUTOAPPLY_ARCHITECTURE_V2.md §10A.`
  - `[2026-08-20T08:52:18.985833310Z] [gmail-confirmation-monitor] Skipping cycle — GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET / GMAIL_CONFIRMATION_MONITOR_REFRESH_TOKEN not fully configured. This requires a one-time human OAuth consent as apply@benavora.com — see AUTOAPPLY_ARCHITECTURE_V2.md §10A.`
  - `[2026-08-20T08:57:27.080771139Z] [gmail-confirmation-monitor] Skipping cycle — GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET / GMAIL_CONFIRMATION_MONITOR_REFRESH_TOKEN not fully configured. This requires a one-time human OAuth consent as apply@benavora.com — see AUTOAPPLY_ARCHITECTURE_V2.md §10A.`
  - `[2026-08-20T09:00:32.986551020Z] [AutonomousOrchestrator] AG-38 self-improvement pipeline failed: Failed to start AG-38 platform-level run: null value in column "organization_id" of relation "agent_runs" violates not-null constraint`
  - `[2026-08-20T09:02:19.000177819Z] [gmail-confirmation-monitor] Skipping cycle — GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET / GMAIL_CONFIRMATION_MONITOR_REFRESH_TOKEN not fully configured. This requires a one-time human OAuth consent as apply@benavora.com — see AUTOAPPLY_ARCHITECTURE_V2.md §10A.`
  - `[2026-08-20T09:07:18.996163046Z] [gmail-confirmation-monitor] Skipping cycle — GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET / GMAIL_CONFIRMATION_MONITOR_REFRESH_TOKEN not fully configured. This requires a one-time human OAuth consent as apply@benavora.com — see AUTOAPPLY_ARCHITECTURE_V2.md §10A.`
  - `[2026-08-20T09:12:18.999392735Z] [gmail-confirmation-monitor] Skipping cycle — GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET / GMAIL_CONFIRMATION_MONITOR_REFRESH_TOKEN not fully configured. This requires a one-time human OAuth consent as apply@benavora.com — see AUTOAPPLY_ARCHITECTURE_V2.md §10A.`
  - `[2026-08-20T09:17:18.999392521Z] [gmail-confirmation-monitor] Skipping cycle — GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET / GMAIL_CONFIRMATION_MONITOR_REFRESH_TOKEN not fully configured. This requires a one-time human OAuth consent as apply@benavora.com — see AUTOAPPLY_ARCHITECTURE_V2.md §10A.`
  - `[2026-08-20T09:22:19.063950387Z] [gmail-confirmation-monitor] Skipping cycle — GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET / GMAIL_CONFIRMATION_MONITOR_REFRESH_TOKEN not fully configured. This requires a one-time human OAuth consent as apply@benavora.com — see AUTOAPPLY_ARCHITECTURE_V2.md §10A.`
  - `[2026-08-20T09:27:19.009856687Z] [gmail-confirmation-monitor] Skipping cycle — GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET / GMAIL_CONFIRMATION_MONITOR_REFRESH_TOKEN not fully configured. This requires a one-time human OAuth consent as apply@benavora.com — see AUTOAPPLY_ARCHITECTURE_V2.md §10A.`
  - `[2026-08-20T09:32:19.020189707Z] [gmail-confirmation-monitor] Skipping cycle — GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET / GMAIL_CONFIRMATION_MONITOR_REFRESH_TOKEN not fully configured. This requires a one-time human OAuth consent as apply@benavora.com — see AUTOAPPLY_ARCHITECTURE_V2.md §10A.`
  - `[2026-08-20T09:37:19.057082748Z] [gmail-confirmation-monitor] Skipping cycle — GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET / GMAIL_CONFIRMATION_MONITOR_REFRESH_TOKEN not fully configured. This requires a one-time human OAuth consent as apply@benavora.com — see AUTOAPPLY_ARCHITECTURE_V2.md §10A.`
- **Fallback signal actually used for "any errors" in the Results table above:** `submission_queue.error_message` on every one of our 50 known row ids (real, DB-observed, not inferred) plus the `worker_status.items_failed` delta across the run (also real and DB-observed). This is the same class of DB-observable signal this project has relied on elsewhere when direct platform-log access wasn't available this session — it is not a substitute for real Railway log text, and is reported as such rather than presented as equivalent.

---

## Verdict

The AutoApply queue processor drained all 50 disposable burst-inserted items cleanly under real production conditions — no crashes, no genuine failures, no orphaned `processing` rows, and `worker_status` heartbeats stayed live throughout. **The dominant, load-bearing finding is not a bug** but a real architectural characteristic: the unconditional 60-120s `waitBetweenSubmissions()` delay (see above) means burst-drain throughput is capped at roughly 1 item/60-120s regardless of how trivial an individual item's work is — worth knowing before assuming the queue can absorb a large burst quickly.

---

## Cleanup

Deleted 3 disposable organization(s), their funders, and their submission_queue rows. **Confirmed via a final count query** (not assumed from the delete calls' own reported success):

| Table | Rows remaining for this run's disposable org ids |
|---|---|
| `organizations` | 0 |
| `funders` | 0 |
| `submission_queue` | 0 |

All three disposable test orgs and every associated row were fully removed from production.
