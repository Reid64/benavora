# PT-13 — Phase 13 Summary (Observability: silent catches, run-log completeness, monitoring reality)

Consolidated numbers for the PT-13 phase. Every count below is quoted from a raw JSON file already
committed under `test-evidence/pt-13/` — re-open the cited file to reproduce the number; nothing
here is asserted from memory, from a prior session's narrative, or from
`WIRING_GAP_REGISTER.md`/`STATE_OF_THE_BUILD.md` text alone.

## Scope

PT-13 answers a question PT-09 and PT-11 didn't: **when something breaks in this platform's
background/agent layer, does anyone — human or system — ever find out?** PT-09 proved which agents
do real work; PT-11 proved which test suites actually run. Neither asked whether a real failure
leaves a trace, or whether that trace reaches a human. PT-13 does, in three steps, each producing
its own evidence file under `test-evidence/pt-13/`:

1. **PT-13-001 — Silent catch-block census.** A full static scan (`scripts/audit/census-silent-catches.mjs`)
   of every `try/catch` and `.catch()` site across `src/`, `worker/`, and `scripts/`, classifying
   each as swallowed-with-a-log, swallowed-and-silent, or swallowed-with-an-explicit-intentional-
   swallow rationale. `test-evidence/pt-13/silent-catches.json`.
2. **PT-13-002 — Run-log completeness + error-surfacing + monitoring reality.** Cross-referenced
   PT-09's 44 real per-agent execution-proof result files against both agent base classes' logging
   code to find agent executions that leave no `agent_runs`/`agent_decisions` trace; traced every
   real background-failure catch/error path to determine whether it reaches a database record, a
   server-log-only line, an in-app UI surface, or nothing; and enumerated what monitoring/alerting
   infrastructure genuinely exists in production versus what governance docs (`STANDING_DIRECTIVES.md`
   Directive 6) claim exists. `test-evidence/pt-13/observability.json`.
3. **PT-13-003 — This consolidation.** Cross-references both evidence files, files 7 new register
   rows (WGR-101 through WGR-107) for findings not already covered by an existing WGR row, and
   produces this summary plus `REVIEW-PACK.md`.

**Method note.** PT-13-001's census is a real static scan of source on disk (1,382 files, confirmed
via `silent-catches.json`'s own `summary.totalFilesScanned`), not a sample or an estimate — every
one of its 2,365 findings carries a `file`/`line` citation independently re-verified by
`verify-pt13-001.mjs` (re-run this phase, exit 0, confirmed all severity-P1/P2 file paths resolve to
a real file on disk). PT-13-002's observability audit is a direct source read of the two agent base
classes, every real background-processor entry point, and every real alerting/notification code
path — cross-referenced against PT-09's already-committed, independently-reproducible execution-proof
files rather than re-invoking any agent this phase. No production database was queried by PT-13-002;
every finding in it is grounded in a `file:line` citation to code currently on disk, or to a prior
phase's already-committed evidence file.

## Part 1 — Silent catch-block census (PT-13-001)

Full numbers, quoted verbatim from `silent-catches.json`'s `summary` object (re-verified this
session via `node scripts/audit/verify-pt13-001.mjs`, exit 0, and independently recomputed from the
raw `findings` array — both agree):

| Metric | Count | Source field |
|---|---|---|
| Total files scanned | 1,382 | `summary.totalFilesScanned` |
| Total catch sites found | 2,365 | `summary.totalCatchSites` |
| — `try/catch` blocks | 1,687 | `summary.tryCatchSites` |
| — `.catch()` calls | 678 | `summary.dotCatchSites` |
| Swallowed (no log, no rethrow, no forward) | 1,048 | `summary.swallowedTotal` |
| **Silent holes** — swallowed, no log, not a test file, no intentional-swallow rationale | **889** | `summary.silentHolesNonTest` |
| Documented intentional swallows (non-test) | 83 | `summary.documentedSwallowsNonTest` |
| Catch sites inside test files | 86 | `summary.testFileCatchSites` |
| Silent holes on a real-data or real-agent-execution code path | 427 | `summary.onRealDataOrAgentPath` |
| Severity P1 (worst-in-class real-path swallows, hand-worthy of individual registration) | 4 | `summary.p1Count` |
| Severity P2 (real-path silent holes) | 423 | `summary.p2Count` |
| Severity P3 (non-real-path silent holes — UI-only, admin scripts, low blast radius) | 462 | `summary.p3Count` |

**The severity split is structural, not editorial:** every one of the 423 P2 findings has
`onRealDataOrAgentPath: true`; every one of the 462 P3 findings has `onRealDataOrAgentPath: false`
(verified this session by direct recount against the raw findings array — 423/423 and 0/462
respectively). P1 (4 findings) is a hand-picked worst-in-class subset of the P2 pool, chosen for
individual WGR registration this phase (see below) rather than a distinct automated tier.

**"Documented" is a narrower bar than "has an explanatory comment."** The census's `documented` flag
requires the catch body or its immediately preceding comment to match one of 18 explicit
intentional-swallow phrases (`best-effort`, `intentional`, `non-fatal`, `fire-and-forget`,
`safe to ignore`, etc. — full list in `census-silent-catches.mjs`'s `DOC_PATTERNS`). Spot-checked
directly this session: several of the 889 "silent hole" catch bodies DO carry a plain-English
comment describing *what* happens (e.g. `src/lib/autoapply/form-filler-agent.ts`'s
`// org lookup failed — continue without it`) without stating *why* silently degrading is safe in
that specific case — a real middle ground between "no reasoning at all" and "a deliberately
justified swallow," not a false positive in the census's classification. This nuance is why the
figure below is reported as "undocumented by the census's stricter bar," not "has literally zero
commentary."

**Single densest concentration:** `src/lib/autoapply/form-filler-agent.ts` — 36 swallowed,
undocumented (by the stricter bar above), real-agent-path catch sites, more than double the
next-highest file (`scripts/audit/pt01-005-claimed-fixes-reverify.mjs`, an audit script, 17). This
is the real AutoApply form-filler agent PT-09 already confirmed does real, live work — registered as
WGR-102.

**Directory-level rollup of swallowed, undocumented, non-test catch sites** (recomputed this session
directly from the raw findings array, not carried from any prior claim):

| Directory | Silent-hole count |
|---|---|
| `scripts/` | 129 |
| `src/lib/agents/` | 110 |
| `src/app/api/` | 62 |
| `worker/` | 11 |

## Part 2 — Run-log completeness, error surfacing, monitoring reality (PT-13-002)

Full numbers, quoted verbatim from `observability.json`'s `summary` object (re-verified this session
via `node scripts/audit/verify-pt13-002.mjs`, exit 0):

| Metric | Count |
|---|---|
| Total findings across all 3 parts | 24 |
| Part 1 (run-log completeness) findings | 9 |
| Part 2 (error-surfacing path trace) findings | 8 |
| Part 3 (monitoring reality) findings | 7 |
| Findings flagging an unlogged execution | 9 |
| Findings flagging absent error-surfacing | 10 |
| Monitoring surfaces confirmed genuinely wired | 6 |
| Monitoring code confirmed dead (built, zero callers) | 1 |
| Monitoring described in governance docs but never built | 4 |
| Dashboard metrics confirmed structurally broken | 1 |
| Severity P1 | 4 |
| Severity P2 | 6 |
| Severity P3 | 14 |

### Run-log completeness — compared directly against PT-09's real execution proof

PT-09 (`test-evidence/pt-09/`) already live-invoked all 43 canonical agent slots (44 individually
verdicted rows — 2 dual-use agent numbers), each with a real before/after row-delta per write-target
table. This phase re-read every one of those 44 result files specifically for the `agent_runs` key
in `rowDelta`:

- **34 of 44** show a confirmed `agent_runs` delta greater than zero — a real trace was left.
- **4 of 44** were never invoked because no implementation exists (AG-12, AG-31, AG-33, AG-34 — 3 of
  the 4 confirmed by a fresh zero-match grep for an implementation file this session).
- **6 of 44** PT-09 didn't track the `agent_runs` key for at all. Read each agent's own real
  implementing file directly to resolve which of these 6 are a genuine gap vs. a tracking omission:
  - **2 use framework-level logging** the evidence file simply didn't isolate (AG-07 via
    `BaseAgent`; AG-38 via its own bespoke platform-level insert, since it runs with
    `organization_id = null` and the standard framework path hardcodes a non-null org).
  - **4 have a structural, unconditional absence of any `agent_runs` write**, confirmed by a
    zero-match grep of the entire implementing file for the literal string `agent_runs`: AG-13
    (`src/lib/scraper/foundation-scraper.ts`), AG-14 (`worker/dd-request-processor.ts`), AG-16
    (`src/lib/intelligence/digital-twin-builder.ts`), and AG-25 Disaster Response
    (`src/lib/agents/disaster-response-agent.ts`, whose own header comment states plainly:
    "no Claude call, nothing logged to agent_runs").

**Read both directions, not just "some runs leave no trace":** PT-09's own headline finding — 13 of
43 canonical agents (30%) carried a misleadingly-positive status under every prior check this
project had run, because a real, non-error `agent_runs.status='completed'` row was treated as proof
of real work, when 12 of those 13 wrote zero rows to any business table and 1 silently swallowed a
real failure — means a monitoring system built only on "does `agent_runs` have a recent completed
row" would be blind to both failure directions simultaneously: some real executions produce no row
at all, and some rows that exist and say "completed" did nothing real.

**Two structural logging-error gaps found in the shared base classes**, not scoped to any one agent:

- `BaseAgent.logStart()` (`src/lib/agents/base-agent.ts:160-181`) inserts the initial `running` row
  without checking or logging the insert's own `error` field. If that insert fails, `runId` is
  `null` and every subsequent `update()` call silently no-ops (`if (!runId) return;`, line 184-190)
  — the agent can complete its real work with zero `agent_runs` trace in any state.
- `AutonomousAgent.completeRun()`/`failRun()` (`src/lib/agents/autonomous-base.ts:158-204`) have the
  identical unchecked-`.update()`-error pattern. This is not theoretical — it already caused a real,
  documented production incident (AG-10/GrantDnaAgent, 2026-08-03, per `STATE_OF_THE_BUILD.md`: runs
  returned `success:true` while the real row stayed stuck at `status:'running'` forever because a
  migration-added column hadn't landed and the unchecked update silently failed). The code pattern
  is unchanged today. Registered as WGR-107.

### Error surfacing — the only automatic path from an agent failure to a human is a human going and looking

Traced every real catch/error-handling branch in the worker's boot sequence, both agent base
classes, and the codebase's three notification mechanisms (`alerts` table via `createNotification`,
`alerting.ts`'s `checkAlerts()`, `webhook-notifier.ts`). No autonomous agent automatically raises an
alert on its own failure: `createNotification()`'s `severity` parameter accepts `"error"`, but a
repo-wide grep found **zero real call sites** anywhere in `src/lib/agents` that actually pass it —
every real notification the agent fleet sends is a business-outcome notice at default `"info"`
severity, never an infrastructure-failure alert. `failRun()` is explicitly documented ("a logging
failure must never mask the original error") to only patch the `agent_runs` row — it never calls
`createNotification()` at all.

A fully-built threshold-alerting engine (`checkAlerts()` — worker-offline, low success rate, cost
overrun, tenant-anomaly detection) exists and has **zero callers anywhere in the codebase** outside
its own definition, confirmed by both a repo-wide grep and its own explicit self-documentation inside
`form-filler-agent.ts`'s header comment. Registered as WGR-106.

The one background sub-process in the worker's boot sequence NOT wired to mark `worker_status.status
= 'error'` on an unhandled failure (`agentQueueDone`'s outer `.catch()`, `worker/index.ts:144`) means
the platform's own health signal (a healthy heartbeat) is structurally compatible with a fully dead
agent-queue processor. Registered as WGR-104.

### Monitoring reality — what's genuinely wired, what's dead, what's never been built

**Genuinely real and wired** (`observability.json`'s `part3_monitoringReality.existsAndWired`, 6
items): `worker_status` + `worker/heartbeat.ts`'s 30s self-healing tick; `/admin/system` (pull-based
worker/queue/error dashboard); `/admin/autoapply-ops`; the `alerts` table + `/alerts` page + nav-bell
badge (real, org-scoped, customer-facing — confirmed read by 16 real files); `WebhookNotifier` (real,
6 real AutoApply lifecycle events, opt-in per org); a real scheduled GitHub Actions workflow
(`daily-tests.yml`, `pnpm test:unit`, 11PM CST).

**Exists but is dead code** (1 item): `checkAlerts()` — see above, WGR-106.

**Described by governance docs, never built** (4 items): `STANDING_DIRECTIVES.md` Directive 6's
10-category daily test suite with a `test_runs` table and a `/platform/test-results` dashboard —
`test_runs` has zero references anywhere in `src/`/`worker/` and no such route exists; the real
`daily-tests.yml` runs only `pnpm test:unit`, nothing else, persists nothing. No dedicated `/api/health`
endpoint exists for an external uptime monitor to poll. No error-tracking/APM SDK (Sentry, Bugsnag,
Datadog, etc.) appears anywhere in `package.json`. No external uptime-monitoring service reference
found anywhere in the codebase.

**One dashboard metric confirmed structurally broken**, not just absent: `/admin/system`'s query
meant to surface stuck donor-discovery requests (`src/app/api/admin/system/route.ts:71-73`) filters
on `status = 'pending'`, a value that has never existed in the real `donor_discovery_request_status`
enum (real values: `queued`/`enumerating`/`enriching`/`scoring`/`complete`/`failed`). This metric
reads `0` forever, regardless of real backlog — directly hiding the already-registered, real,
confirmed-broken AG-14 stuck-queue bug (WGR-079) from the one dashboard surface built specifically to
catch it. Registered as WGR-105.

## Register additions this phase (WGR-101 through WGR-107)

Seven findings were confirmed real, evidenced, and reproducible but had no register row before this
consolidation. Each was checked against the existing register first to confirm it was not already
covered by a prior phase's finding under a different framing (e.g. PT-09's WGR-079/WGR-082 already
cover AG-14/AG-24's *execution* proof — these new rows are the *observability* angle: does a trace
get left, does it reach a human). All seven are now in `WIRING_GAP_REGISTER.md`:

- **WGR-101** (P1) — `src/lib/agents/form-filler.ts:253` silently discards a real AutoApply
  file-upload failure; the agent proceeds to submit as if the attachment succeeded.
- **WGR-102** (P2) — `src/lib/autoapply/form-filler-agent.ts` (a second, separate form-filler
  implementation) has 36 undocumented real-agent-path swallows, the densest concentration in the
  2365-site census.
- **WGR-103** (P2) — `sequence-engine.ts:230`'s bare `catch { failed++; }` discards email-send error
  detail; currently dormant in production because its only caller is unregistered (WGR-038), but a
  real code gap for whenever that's fixed.
- **WGR-104** (P1) — `worker/index.ts:144`'s `agentQueueDone` catch is the one boot-sequence
  sub-process that doesn't mark `worker_status.status='error'` on failure — a "healthy" heartbeat can
  coexist with a fully dead agent-queue processor.
- **WGR-105** (P1) — `/admin/system`'s donor-discovery-stuck-requests metric filters on a
  `status` value that doesn't exist in the real enum, reading `0` forever and hiding WGR-079's real
  bug from the one dashboard built to catch it.
- **WGR-106** (P2) — `checkAlerts()`, a fully-built worker-offline/low-success-rate/cost-overrun/
  tenant-anomaly threshold engine, has zero callers anywhere.
- **WGR-107** (P2) — `AutonomousAgent.completeRun()`/`failRun()`'s unchecked `.update()` error path
  is the exact code pattern that already caused a documented production incident (AG-10,
  2026-08-03) and remains unchanged today, live for all 32 classes extending it.

`WIRING_GAP_REGISTER.md` now runs WGR-001 through WGR-107, unbroken (verified: `grep -c "^| WGR-"` =
107).

## Gates

`node scripts/audit/verify-pt13-001.mjs` and `verify-pt13-002.mjs` both re-run this session, exit 0.
`node scripts/audit/verify-pt13-003.mjs` (this consolidation's own gate) confirms
`PHASE-13-SUMMARY.md` and `REVIEW-PACK.md` are present and non-empty, and that
`WIRING_GAP_REGISTER.md` has grown past its pre-PT-13-003 state (WGR-100, the last row before this
consolidation) with this consolidation's new findings (WGR-101 through WGR-107).
