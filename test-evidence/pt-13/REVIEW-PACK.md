# PT-13 Review Pack — read this one, not the raw evidence, unless you want the raw evidence

For the full numbers and how every count was produced, see `PHASE-13-SUMMARY.md` in this same
directory. This doc is the short version: when something breaks in the background, does it show up
anywhere a human would actually see it — and what should happen next.

## The question you actually care about: if AutoApply/an agent/the worker breaks in production right now, would anyone find out before a customer complains?

**Mostly no, and this phase found concrete, evidenced reasons why — not a vague impression.** Three
independent layers each have a real gap, and they compound rather than offset each other:

1. **A real failure can leave zero trace at all.** 4 of 44 canonical agent slots have no
   implementation; 4 more have a *structural, code-confirmed* absence of any `agent_runs` write on
   every execution (AG-13, AG-14, AG-16, AG-25). Both shared agent base classes (`BaseAgent`,
   `AutonomousAgent`) have an unchecked-database-error code path capable of losing a run's
   completion state silently — one of these already caused a real, documented production incident
   (AG-10, 2026-08-03).
2. **Even when a trace exists, nothing automatically turns it into an alert.** No autonomous agent
   ever calls `createNotification()` with `severity:"error"` — confirmed by a repo-wide grep
   returning zero real invocations. A fully-built, sophisticated threshold-alerting engine
   (`checkAlerts()` — worker-offline, low success rate, cost overrun, tenant anomaly) exists and has
   never been called by anything. The one worker sub-process wired to NOT crash on failure also
   doesn't mark the worker unhealthy, so a healthy heartbeat can coexist with a fully dead
   agent-queue processor.
3. **The one dashboard built to catch a known real bug can't.** `/admin/system`'s donor-discovery
   stuck-requests counter filters on a status value (`'pending'`) that has never existed in the real
   database enum — it reads `0` forever, hiding the already-documented, live, confirmed-broken AG-14
   stuck-queue bug from the one screen built specifically to surface it.

**Net: production monitoring here is real but narrow, and pull-only.** `worker_status`/heartbeat and
`/admin/system` genuinely work — but nothing pushes their state to anyone. A human has to actively
navigate to `/admin/system` or `/alerts` and notice something's wrong. There is no error-tracking
SDK, no external uptime monitor, no push notification on any agent-infrastructure failure, and the
one automated daily test run (`daily-tests.yml`) executes a far narrower slice than
`STANDING_DIRECTIVES.md` Directive 6 describes and persists nothing anywhere for anyone to review
later.

## Are failures visible in production today? — direct answer, not hedged

**For the specific failure modes this phase traced: no, not automatically, and in one documented
case (AG-10) a real failure has already gone unnoticed because of exactly this gap.**

| Failure mode | Reaches a DB record? | Reaches a UI a human would see without being told to look? | Reaches an automatic alert? |
|---|---|---|---|
| AG-14 donor-discovery RPC failure (WGR-079, already confirmed broken) | No — `console.error` only | No — and the one metric meant to show it can't (WGR-105) | No |
| AG-10-class silent-stuck-running agent runs (WGR-107) | Partial — row exists but frozen at `status:'running'` forever, indistinguishable from "still working" | Only if a human queries `agent_runs` directly with the right filter | No |
| `agentQueueDone` crash (WGR-104) | No | No — `worker_status` stays "online" | No |
| AutoApply file-upload silently not attached (WGR-101) | No | No | No |
| Uncaught exception / unhandled rejection in the worker's main process | **Yes** — `worker_status.status='error'` | Yes, on `/admin/system`, if a human is looking before the next heartbeat overwrites it | No — still requires a human to visit the page |
| A business-outcome event (digest ready, board packet ready, compliance blocked) | Yes | Yes — real, org-scoped `alerts` + bell badge | N/A (this is the one real working notification path, but it's customer-facing, not operator-facing) |

The bottom row is the one genuinely solid path this phase found — it's real, it's live, 16 files
read from it. Every other row in the table above requires either a human to already suspect
something is wrong and go looking, or doesn't reach anywhere at all.

## Highest severity — what to fix first if you fix one thing

**WGR-105 (broken monitoring metric) and WGR-104 (zombie worker) are the two highest-leverage
fixes**, not because they're the most severe bugs in isolation, but because each one is currently
*masking* other real, already-known bugs from the one surface built to catch them:

1. **WGR-105** — a one-line fix (`'pending'` → `'queued'` in `src/app/api/admin/system/route.ts`)
   restores visibility into WGR-079's real, already-broken donor-discovery pipeline. Right now a
   human diligently checking the dashboard every day sees "0" and has no reason to escalate.
2. **WGR-104** — wiring `agentQueueDone`'s catch to also set `worker_status.status='error'` (matching
   the pattern already used two handlers above it in the same file) closes the one gap where the
   platform's own health signal can lie.
3. **WGR-101** (AutoApply file-upload silently not attached) is the highest real-world *consequence*
   finding even though it's a single-line fix — a real grant submission missing a required document,
   recorded as a normal success, is the kind of failure a customer discovers from a funder's
   rejection letter, not from this platform.
4. **WGR-107** (unchecked `agent_runs` update errors in the shared base class) is the highest
   *leverage* finding — it's one code pattern, shared by 32 agent classes, that has already caused
   one real incident and will cause another the next time any migration or RLS change touches
   `agent_runs` without every consumer being checked first.

Everything else registered this phase (WGR-102, 103, 106) is real and worth fixing, but lower
urgency: WGR-102 is a concentration-of-risk finding rather than one specific bug; WGR-103 is
currently dormant (blocked by WGR-038's own unregistered cron); WGR-106 is dead code whose absence
is a missed opportunity, not an active failure.

## What this phase deliberately did NOT do

No code was fixed this phase — PT-13 is an audit, not a remediation pass, matching every prior
phase's scope. No production database was queried by PT-13-002 (every finding is a direct source
read or a citation to a prior phase's already-committed evidence). PT-13-001's census is a static
scan; it did not attempt to determine at runtime how often each swallowed catch actually fires in
production — severity here is "could this matter," not "how often does it happen." That's a genuine
open question for a future phase, not answered here.

## Next-phase note

Two concrete follow-ups fall directly out of this phase's own scope boundaries, stated rather than
silently dropped:

1. **Runtime frequency, not just static risk.** This phase found *where* silent failures can happen
   (2,365 catch sites, 889 silent holes) and traced *whether* a handful of specific known-real bugs
   (AG-10, AG-14, AG-38) are visible. It did not instrument production to find out how often any of
   the other 885 silent holes actually trigger. A future phase pulling real Railway/Vercel log
   volume for a sample of the P1/P2 sites in `silent-catches.json` would turn "structurally capable
   of hiding a failure" into "actually hides N failures/week."
2. **Remediation pass on the highest-leverage items above (WGR-101, 104, 105, 107).** All four are
   small, well-scoped, single-file fixes with a clear before/after verification path (re-run the
   relevant `verify-pt13-*` check or a targeted live query) — good candidates for the next fix cycle
   rather than another audit pass.
