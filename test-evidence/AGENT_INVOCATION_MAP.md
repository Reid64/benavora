# Agent Invocation Map — Phase 9.3 (AR-9.3)

**Date:** 2026-09-18
**Trigger:** AR-7.1 fixed the missing Chromium executable (215 failures across
ea01/ea02/ea05/ea08/ea09) but in the hours after deploy, EA agent_runs stayed
at 0 while 184 other agent runs happened. This doc traces why, proves the
fix live, and maps every agent family's actual invocation path so the
"59 agents never executed" triage in the 144-agent inventory can tell
*quietly disabled* apart from *never wired* apart from *starved of input*.

---

## 1. EA family (Corporate Intelligence Enrichment, EA-01..EA-10)

**Invoked by:** `worker/enrichment-processor.ts`, a continuous poll loop
started at worker boot (`worker/index.ts:177`, confirmed live in Railway logs
— `[EnrichmentProcessor] Starting`). Not a cron entry, not an API route, not
gated by any registry.

**Trigger condition:** `runEnrichmentBatch()` selects up to 500 rows from
`corporate_prospects` where `enrichment_completed_at IS NULL`. If it finds
zero rows, it sleeps 60s and checks again — forever. If it finds rows, it
runs EA-01 through EA-10 sequentially (each wrapped in its own try/catch so
one agent's failure doesn't block the rest), stamps
`enrichment_completed_at`, then triggers the Score Engine (AG-22
PropensityScoringAgent), and immediately loops to the next row (no
sleep) — it only backs off when the queue is empty.

### Why EA agent_runs was 0 for three hours — NOT a disabling mechanism

No circuit breaker, feature flag, or registry gate exists for the EA family.
Confirmed by grep: `src/lib/resilience/circuit-breaker.ts` is used by
AutoApply/scraper modules only (`worker/queue-processor.ts`,
`worker/proxy-manager.ts`, `src/lib/scraper/stealth-engine.ts`,
`src/lib/agents/custom-scrape.ts`) — never imported by
`worker/enrichment-processor.ts` or any `ea-0*` agent. The PIL agent family's
`pil_agent_registry.active` flag (see §5) does not cover EA agents; EA agents
aren't registry rows at all.

The real cause is **queue exhaustion, two layers deep**:

1. **The queue's only feed — on-demand acquisition — isn't scheduled.**
   `corporate_prospects` is populated by
   `acquireFromGooglePlaces()` in `src/lib/sources/corporate-acquisition-adapter.ts`,
   called from exactly two places: `POST /api/prospects/acquire` (a
   manual, per-org, human-triggered API route) and
   `scripts/acquire-corporate-prospects.ts` (a manual CLI runner,
   `pnpm acquire:prospects`). The API route's own comment claims this is
   "Same Google Places sweep as scripts/acquire-corporate-prospects.ts (all
   onboarded orgs, **nightly**)" — but grepping `worker/scheduler.ts`,
   `vercel.json`, and every `src/app/api/cron/*` route for
   `acquire-corporate-prospects` / `acquireFromGooglePlaces` /
   `corporate-acquisition-adapter` returns nothing. **The "nightly" sweep
   the code comments describe does not exist in the deployed schedule.**
   It is aspirational documentation, not live behavior.
2. **Once attempted, a row never re-enters the queue.** Live data:
   `corporate_prospects` has 50 rows total, `first_seen_at` ranging
   2026-08-03 to 2026-08-04 (plus one stray `EXERCISE-HARNESS-Fixture
   Prospect Inc` test-fixture row from 2026-09-17, unrelated to real
   ingestion). All 50 already carry `enrichment_completed_at` — most
   stamped 2026-09-17 ~07:2x–08:3x UTC, **before** AR-7.1's fix landed
   (commit `119139d`, 2026-09-18T02:29 UTC). That run hit the still-broken
   Chromium path for ea01/02/05/08/09, but every row was still stamped
   `enrichment_completed_at` regardless — both `enrichProspect()`'s
   unconditional stamp at the end of the 10-agent loop, and
   `mergeEnrichmentPatch()` in `corporate-enrichment-shared.ts` (which
   stamps `enrichment_completed_at` on every individual agent's successful
   merge, not just full-pipeline success) mean "attempted" and "fully
   enriched" are indistinguishable in this schema. Once a row is
   attempted, it can never be selected by
   `.is('enrichment_completed_at', null)` again.

Combine the two: no new rows have entered the queue since 2026-08-04, and
the 50 that exist were fully drained (successfully or not) before AR-7.1
even existed. So the queue has been sitting at 0 unenriched rows
independent of the Chromium fix — the fix *couldn't* have produced a new
agent_runs row on its own, because nothing was left to process. This is
exactly the "queue that only enqueues when upstream data exists, and that
upstream being empty" pattern the task asked to check for — confirmed real,
just not previously named.

This also means: the 49 rows other than the one manually re-queued below may
still be carrying empty/incomplete `enrichment` data for ea01/02/05/08/09
from their pre-fix attempt (their agent_runs history predates the fix and
several `agent_runs` rows for those five agent types on those rows are very
likely `failed`/threw before AR-7.1). Not re-verified row-by-row in this
session — flagged as a follow-up, not silently assumed fixed.

### Step 3 — live proof (this session)

Manually reset one production `corporate_prospects` row
(`3d15c0f2-e524-4d94-a7fa-e03c82d965b6`, "GOOD HOUSING CONSTRUCTION LLC",
originally enriched 2026-08-03, long before the Chromium bug's failure
window) to `enrichment_completed_at = null`, then called the real,
unmodified `runEnrichmentBatch()` from `worker/enrichment-processor.ts`
against production (service-role client, same code Railway runs). Real
`agent_runs` rows resulted:

| agent_type | status | started_at (UTC) | completed_at (UTC) | error |
|---|---|---|---|---|
| ea01_giving_detector | completed | 08:23:16.350 | 08:23:16.635 | none |
| ea02_community_outreach_detector | completed | 08:23:16.788 | 08:23:23.627 | none |
| ea03_sponsorship_detector | completed | 08:23:23.848 | 08:23:24.171 | none |
| ea04_foundation_detector | completed | 08:23:24.319 | 08:23:45.960 | none |
| ea05_career_page_analyzer | completed | 08:23:46.179 | 08:23:46.474 | none |
| ea06_press_release_analyzer | completed | 08:23:46.617 | 08:23:57.025 | none |
| ea07_esg_analyzer | completed | 08:23:57.293 | 08:23:57.569 | none |
| ea08_executive_biography_analyzer | completed | 08:23:57.709 | 08:23:58.065 | none |
| ea09_contact_extractor | completed | 08:23:58.207 | 08:23:58.480 | none |
| ea10_social_media_analyzer | completed | 08:23:58.634 | 08:24:10.882 | none |
| ag22_propensity_scoring (Score Engine, chained) | completed | 08:24:11.157 | 08:24:40.786 | none |

All 10 EA agents plus the chained Score Engine ran to completion with zero
errors. **AR-7.1's Chromium fix is PROVEN live** — the exact five agents
named in the original 215-failure incident (ea01, ea02, ea05, ea08, ea09)
ran clean. `corporate_prospects.enrichment_completed_at` was re-stamped
2026-09-18T08:24:11Z and the row's `enrichment` jsonb was rewritten by the
run.

Also confirmed via `railway status`: the deployed worker image
(deployment `90f6c81f`, created `2026-09-18T08:06:51Z`) builds from commit
`72e6f774` — which is descended from `119139d` (AR-7.1). The Railway worker
was already running AR-7.1's code before this session started; the prior
"worker not yet redeployed" state noted after AR-7.1 landed
(2026-09-17 session) has since resolved.

**Minor unrelated finding:** Railway's dashboard still has an environment
variable named `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` (the pre-AR-7.1 name).
It's harmless — `worker/Dockerfile` sets `ENV CHROMIUM_EXECUTABLE_PATH=...`
(the new name) directly in the image, so the stale dashboard variable is
just unused cruft, not a live conflict. Worth deleting for hygiene, not
blocking anything.

---

## 2. Scheduler-driven AG-* families (`worker/scheduler.ts`)

**Invoked by:** a plain `setInterval` (60s tick) checking wall-clock time in
`America/Chicago` against a fixed table of jobs — no `node-cron` dependency,
confirmed running (`[Scheduler]` boot log present via `worker/index.ts:182`).
Each job dynamically imports its pipeline function from
`worker/autonomous-orchestrator.ts` and awaits it; a thrown error is caught
and logged per-job, never disables the job going forward (no failure
counter exists in `scheduler.ts`).

| Job | Time (CST) | Cadence | Gate |
|---|---|---|---|
| nightly autonomous pipeline + AG-28 followups sweep | 02:00 | daily | none |
| AG-27 board packet daily pipeline | 02:00 | daily | none |
| AutoApply autonomous overnight orchestrator | 03:00 | daily | none |
| AG-10 grant DNA weekly pipeline | 03:00 | daily tick, self-gates to Sunday inside the pipeline function | none at scheduler level |
| **foundation-enrichment-weekly** | 03:00 | daily tick, self-gates to Sunday | **`ENABLE_SCRAPER === 'true'` — a real, live feature flag** |
| AG-38 self-improvement pipeline | 04:00 | daily | none |
| AG-26 funding forecast monthly pipeline | 04:00 | daily tick, self-gates to 1st-of-month inside pipeline | none |
| **nonprofit-enrichment-weekly** | 04:00 | daily tick, self-gates to Sunday | **`ENABLE_SCRAPER === 'true'`** |
| AG-42 change monitor daily pipeline | 05:00 | daily, unconditional | none |
| AG-25 disaster response pipeline | 05:45 | daily, unconditional | none |
| AG-23 relationship graph incremental pipeline | 05:30 | daily | none |
| AG-36 learning network aggregator | 06:00 | daily tick, self-gates to Sunday | none |
| morning digest pipeline | 07:00 | daily | none |

**This is a genuine disabling mechanism** — `ENABLE_SCRAPER` gates the two
scraper-based weekly jobs (`foundation-enrichment-weekly`,
`nonprofit-enrichment-weekly`) because they launch real headless Chromium
instances and scrape live sites. Not checked for its current production
value in this session — worth a follow-up `railway variables` check if
either of those two families shows up in a future "never executed" triage,
since this flag would fully explain it.

---

## 3. AutoApply / submission_queue family (`worker/queue-processor.ts`)

**Invoked by:** a continuous poll loop over `submission_queue` rows
(`status = 'queued'`), same "wired at worker boot, drains on the row's own
existence" shape as the EA family. Dispatches to
`FormAnalyzerAgent`/`FormFillerAgent`/`CaptchaSolver`/`RegistrationAgent`/
etc. per queue item, plus three sub-job-queue claim functions
(`claimNextEnrichDonorProspectJob`, `claimNextScoreDonorProspectJob`,
`claimNextRunConnectorEnrichmentJob`).

**Upstream feed:** `submission_queue` rows are inserted from user-facing API
routes (`/api/autoapply/queue`, `/api/agents/automation`,
`/api/drafts/queue/[id]`) and from
`worker/autoapply-autonomous-orchestrator.ts`'s nightly 03:00 CST sweep (see
§2). Unlike EA, this family has a real scheduled upstream feed in addition
to manual triggers, so starvation here would be a different failure mode
than EA's — worth checking `submission_queue` row counts directly rather
than assuming this family behaves like EA.

**Disabling mechanism:** `src/lib/resilience/circuit-breaker.ts` is
imported here — this family (not EA) is the one that actually has
failure-count-based circuit-breaking available. Not audited in this session
whether it currently has any breaker open; flagged for the next AutoApply-
specific pass.

---

## 4. Vercel cron routes (`vercel.json`)

Seven serverless cron entries, all confirmed present in `vercel.json` (i.e.
"exists in code" — Vercel's own dashboard is the only way to confirm a cron
actually fires in the deployed environment, not checked here):

| Path | Schedule | Family |
|---|---|---|
| `/api/cron/research` | `0 6 * * *` | Research agents (12-21 per prior ground-truth audit) |
| `/api/cron/grantsgov` | `0 7 * * *` | Grants.gov ingestion |
| `/api/cron/reminders` | `0 8 * * *` | Notification reminders |
| `/api/cron/autoapply` | `0 2 * * *` | AutoApply nightly |
| `/api/cron/domain-warmup` | `0 6 * * *` | Email domain warmup |
| `/api/cron/autoapply-retry` | `0 * * * *` | AutoApply retry sweep |
| `/api/cron/pil-research` | `*/10 * * * *` | PIL research-run poller |

All gated by `CRON_SECRET` bearer-token auth (`isAuthorized()` pattern,
confirmed in `pil-research/route.ts`) — a request without the right secret
gets a 401, not a silent no-op. That's an auth gate, not an agent-disabling
mechanism.

---

## 5. PIL / BEN-* family (`pil_agent_registry`, 51 rows live)

**Invoked by:** `POST /api/pil/research` or `/api/pil/discover` create a
`pil_research_runs` row (gated by `isPilEnabledForOrg()`, a LaunchDarkly
rollout flag checked at creation time — **a real, org-level disabling
mechanism**), then `/api/cron/pil-research` (every 10 min) calls
`pollAndOrchestratePendingRuns()` in `src/lib/pil/research-orchestrator.ts`,
which resumes/advances each pending run's `structured_plan` and dispatches
individual `BEN-*` agents via `src/lib/pil/agent-runner.ts`.

**Per-agent disabling mechanism — real, and worth naming explicitly for the
59-agent triage:** `pil_agent_registry.active` (boolean). Checked before
every dispatch in `agent-registry-service.ts`, `agent-runner.ts`,
`policy.ts`, and `research-orchestrator.ts` (`agent.active` guards). Live
query this session: **all 51 registry rows currently have `active = true`
— nothing is presently suppressed by this flag**, but the mechanism is real
and enforced, unlike the EA family which has no equivalent column at all.
If a future triage of the 59 finds a `BEN-*` agent with zero runs, checking
`pil_agent_registry.active` for that `agent_id` is the first move — for
EA-family or scheduler-family agents, that check doesn't apply, because no
such table/column governs them.

---

## 6. Answering the framing question directly

> If agents stop being invoked after they start failing — by a circuit
> breaker, a disabled flag, a scheduler that drops them, a queue that no
> longer enqueues them — then "never executed" may mean "quietly switched
> off" rather than "never wired."

For the EA family specifically: **no, nothing switched it off.** There is no
circuit breaker, no flag, no registry row for EA-0x agents anywhere in the
codebase. The silence was **queue starvation**, caused by (a) an
undocumented gap between what code comments claim ("nightly" acquisition
sweep) and what's actually scheduled (nothing — acquisition is 100% manual),
and (b) a schema/semantics choice (`enrichment_completed_at` means
"attempted," not "fully succeeded") that makes every row permanently
ineligible for re-queueing after one pass, successful or not.

But the framing question's premise IS true elsewhere in this codebase:

- **`ENABLE_SCRAPER`** (env flag) really does silently no-op
  `foundation-enrichment-weekly` and `nonprofit-enrichment-weekly` every
  single week if unset — those two families are exactly the "disabled flag"
  case the question describes, and weren't checked for their current value
  in this session.
- **`pil_agent_registry.active`** really is a per-agent kill switch for
  every `BEN-*` agent, enforced at four call sites — currently all-true,
  but real and worth checking first for any `BEN-*` agent in the 59.
- **`isPilEnabledForOrg()`** (LaunchDarkly) really does gate whether a PIL
  research run is ever created for a given org in the first place.
- **`src/lib/resilience/circuit-breaker.ts`** really is wired into the
  AutoApply/scraper stack (`queue-processor.ts`, `proxy-manager.ts`,
  `stealth-engine.ts`, `custom-scrape.ts`) — not audited for open-breaker
  state this session, but it's the one family where a failure-count-based
  breaker tripping is actually possible in this codebase.

**Conclusion for the 59-agent triage:** don't apply one answer to all 59.
Check, per agent, which of these five mechanisms (env flag, PIL registry
`active`, LaunchDarkly org gate, circuit breaker, or plain queue/cron
starvation like EA) actually governs it — the invocation path differs by
family, and at least three of the five mechanisms above are real and can
independently explain "zero runs" without the agent being broken at all.
