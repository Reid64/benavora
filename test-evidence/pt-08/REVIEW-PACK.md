# PT-08 Review Pack — read this one, not the raw evidence, unless you want the raw evidence

For the full numbers and how each was produced, see `PHASE-08-SUMMARY.md` in this same directory.
This doc is the short version: is the background tier operational, what's built but never runs,
which automations are silently dead, what's the status of the cron/middleware question, and what
we recommend next. PT-09 (agents) depends on the answer here — it's about to audit *which* agents
work; this phase answers whether the machinery that would run them automatically actually exists.

## The question you actually care about: is the background tier operational?

**Yes, for the part that matters most — the agent pipeline scheduler. Genuinely, live-confirmed,
not inferred.**

`worker/scheduler.ts` runs 13 real jobs (AG-10, AG-23/32, AG-25, AG-26, AG-27, AG-36, AG-38, AG-42,
the nightly autonomous pipeline, the morning digest, the AutoApply overnight orchestrator, and both
Directive-1 scraper jobs) inside the always-on Railway worker process. We didn't just confirm the
code is wired — we pulled 5 days of real production logs (2026-08-15 through 2026-08-19) and every
one of the 13 fired at its correct scheduled time, every day, on the live deployment. Separately,
`worker/index.ts` itself starts 24 of 26 inventoried processors/consumers at boot, confirmed against
a real Railway boot log for the current deployment (running continuously since 2026-08-15) and a
live query against the production heartbeat table.

**But there's a real crack, and it's not where you'd expect it.** The other scheduling mechanism —
5 jobs registered as Vercel Crons that hit real HTTP routes (`/api/cron/research`,
`/api/cron/grantsgov`, `/api/cron/reminders`, `/api/cron/autoapply`, `/api/cron/domain-warmup`) —
might be silently blocked in production by the app's own login middleware before they ever reach
their code. We can't tell you which way that resolves. See the section below — this is the one
open item we're flagging loudest.

## What's built but never runs (dead code, not maybe-broken — confirmed zero reachability)

**`worker/enrichment-processor.ts` — WGR-033, P1.** This is a real, complete processor (all 10
EA-01..EA-10 corporate enrichment agents plus AG-22 propensity scoring) that nothing anywhere calls.
Not from `worker/index.ts`'s boot sequence, not from any dynamic import, not from any CLI script in
`scripts/`. The project's own architecture doc (`WORKER_ARCHITECTURE_v2.md` line 92) documents this
as boot step 6 — the real code has no such step. Every one of those 11 agent classes has, as far as
we could find, only ever executed via a manually-written, throwaway verification script someone ran
by hand. This is the single most consequential finding in this phase for PT-09: 11 agents that exist
in code and are documented as built have zero automatic or on-demand production trigger.

**`src/worker/jobs/process-discovery-request.ts` — WGR-034, P3.** Also zero reachability, but lower
stakes — the capability it would provide (processing a donor-discovery request) is already fully
covered by a different, confirmed-running processor (`ddRequestProcessor`). Genuine dead code, not
a missing feature.

## Which automations are silently dead

Six real `/api/cron/*` route handlers are registered nowhere — not in `vercel.json`, not in the
worker scheduler:

- **`/api/cron/sales-sends` — WGR-036, P1, the sharpest one.** We confirmed the *producer* side is
  live and clickable right now: an admin clicking "Schedule" on a real Sales Outreach campaign
  really inserts rows waiting to be sent. Nothing in production ever sends them. This isn't a
  hypothetical gap in an unused feature — it's a feature an admin can use today that quietly does
  nothing after the click.
- **`/api/cron/follow-ups` — WGR-037, P1.** Two-layer dead: the route that would send AutoApply's
  14/30/60-day donation follow-ups is unregistered, *and* nothing anywhere in the codebase ever
  creates the rows it would send in the first place. This entire feature is inert end-to-end.
- **`/api/cron/email-sequences` — WGR-038, P1.** Scheduled email sequence sends never fire
  automatically. This was already known and documented before this phase (in
  `WORKFLOW_PAGE_PLAN_2026-08-15.md`), but had never been given a register entry or evidence file
  until now.
- **`/api/cron/draft-automation` — WGR-035, P1.** Deadline-approaching drafts never auto-queue, and
  queued drafts never bulk-auto-generate. Manual substitute exists but is capped at 3 items/call.
- **`/api/cron/draft-queue-check` — WGR-039, P3, not actually a gap.** Duplicates a call the
  registered `/api/cron/research` cron already makes. Orphaned, but the capability isn't missing.
- **`/api/cron/campaigns` — no WGR row, intentionally retired 2026-08-13**, already documented with
  rationale (0 orgs had the feature enabled). Not a gap, just listed for completeness.

## The cron/middleware question — status, stated plainly

This is unresolved, and we want to say that clearly rather than bury it in the numbers above.

`src/middleware.ts` requires a valid session cookie to reach almost any `/api/` route, with no
exemption list for `/api/cron/*` at all. Confirmed on a local dev server: every single
`/api/cron/*` route — **including all 5 that ARE registered in `vercel.json`** — gets redirected to
`/login` (`307`) before the route's own `CRON_SECRET` bearer-token check ever executes, when hit
with zero cookies. Vercel Cron's real invocation is a server-to-server call with no session cookie,
same as our test.

Reid has told us production returns `401` (not a redirect) for the same kind of call — the opposite
of what local dev shows. We have not independently verified either claim against the deployed
Vercel URL; this phase's scope was explicitly prod-safe/read-only, so we didn't run a live `curl`
against production this pass either.

**What we can say with confidence: this question does not touch the agent pipeline scheduler.**
`worker/scheduler.ts`'s 13 jobs never go over HTTP and are structurally immune to this whole
question — that's the machinery confirmed running above. What's actually at stake here is narrower:
5 specific sync/reminder jobs (research sweep, Grants.gov sync, deadline reminders, domain warmup,
nightly AutoApply queue population). If the local-dev finding also holds in production, those 5
would be silently non-functional. If Reid's report holds, they're fine. **A single real
`curl -i --no-location <production-url>/api/cron/reminders` with zero cookies, compared against the
identical call to local dev, would settle this in five minutes** — we recommend doing that before
trusting either claim.

## `agent_queue`'s actual state machine — sound, with one caveat

We exercised the queue's claim/retry/terminal/completion logic against a disposable local database
using the real, unmodified failure path (not a simulation) for 4 scenarios: clean success, a
transient failure that retries and recovers, a permanently-failing job that exhausts retries and
reaches a real terminal state, and a poison job queued ahead of a good job. All four came back
exactly as designed — a bad job never blocks a good job behind it, and a job that keeps throwing
gets bounded and stops retrying after 3 attempts, never reclaimed again.

**One real gap we found by reading the code, not by reproducing it live: no per-item timeout.** If
a claimed job's work *hangs* — never resolves, never rejects, unlike every failure mode we actually
tested — nothing at the queue-processor layer would notice or move on. It would sit there blocking
every other queued item indefinitely. We didn't (and structurally can't easily) reproduce a genuine
infinite hang in a test run, so this is flagged **WGR-040, UNVERIFIED** — a real risk worth a
deliberate timeout wrapper, not a confirmed live incident.

## Recommendation for PT-09

**Go, with two things to hand off.** The core question PT-09 needs answered — does the machinery
exist to run agents automatically, not just when someone manually invokes them — is now answered
concretely for `worker/scheduler.ts`'s 13 pipeline jobs (yes, confirmed live) and for the
`enrichment-processor.ts` corporate-enrichment/AG-22 pipeline (no, zero reachability — WGR-033).
When PT-09 evaluates whether a given agent "works," it should check whether that agent's own trigger
path is one of the confirmed-running 13 jobs, is inside the confirmed-dead enrichment-processor, or
is something else entirely (a manual API route, an event trigger) — this phase's boot inventory
(`test-evidence/pt-08/boot-inventory.json`) is the map to check against, so PT-09 doesn't have to
re-derive worker registration state from scratch.

Two things worth a dedicated 10-minute check before or alongside PT-09, not blockers:

- The production `curl` test described above, to close the WGR-023/WGR-003 vercel.json-cron
  question — it's narrow (5 routes) and doesn't gate PT-09's own scope, but it's cheap to settle and
  currently just sitting open.
- Whether `worker/enrichment-processor.ts` should be wired into `worker/index.ts`'s boot sequence
  (closing WGR-033) is a real product decision, not something this audit program should decide
  unilaterally — 11 agent classes are sitting fully built with no way to run except by hand.
