# REMEDIATION_PLAN.md — Ranked Root-Cause Remediation Plan (AR-13.4)

**Date:** 2026-09-19
**Scope:** synthesis only — no production code changed. Reads
`test-evidence/AGENT_CENSUS.md` (AR-13.1), `test-evidence/SCHEDULER_MAP.md`
(AR-13.2), and `test-evidence/DATA_PIPELINE_AUDIT.md` (AR-13.3) and groups
their combined findings — 145 tracked agent/worker rows, 116 of them
non-operational — into root causes a build agent can act on tonight,
instead of a 60-line per-agent punch list nobody can execute.

**Method:** every agent in the three source audits was assigned to exactly
one bucket below by shared underlying cause (shared file, shared bug
signature, shared upstream table, shared config gate), not by family name
or verdict label. Where a fix for one agent plausibly cascades to unblock
others, that cascade is stated explicitly and separately from the directly
verified count, so this document's coverage numbers are never inflated by
counting a hoped-for unblock as a confirmed recovery.

---

## Ranking rationale

"Agents recovered per unit of effort" is the literal sort key below, with
one deliberate exception: **RC-1 (`ag-29-knowledge-indexer`) is ranked
first despite "recovering" only 1 of 145 agents**, because that one agent
is 96.1% of all `agent_runs` rows ever written (SCHEDULER_MAP.md §0) — the
fix is small, isolated, fully understood, and its payoff is not "one more
working agent," it is "every future audit, dashboard, and on-call query
against `agent_runs` stops being dominated by noise." Every other ranking
follows recovered-agents ÷ effort directly.

---

## RC-1 — `ag-29-knowledge-indexer`: producer/consumer field mismatch + write-before-check polling

**Agents affected:** `ag-29-knowledge-indexer` (1 agent; 64,551 lifetime
runs, 96.1% of the entire platform's `agent_runs` table).

**Evidence** (`DATA_PIPELINE_AUDIT.md` §1, `AGENT_CENSUS.md` line 19):
> "`foundation_directory` has 133,812/133,812 rows with `embedding IS
> NULL`, and every one of those rows also has `programs IS NULL` and no
> `enrichment.mission` key — the only two text sources
> `flattenFoundationText()` can index... Not one of them, anywhere in this
> codebase, ever writes to `programs` or `enrichment.mission`."

> (`SCHEDULER_MAP.md` §1) "`KnowledgeIndexerAgent.run()`... calls
> `this.startRun(triggerSource)` — which writes a real `agent_runs` row —
> **before** it queries for indexable rows at all... it is the only poller
> in the codebase that records a formal 'run' for the act of finding
> nothing."

**Fix:**
1. `src/lib/agents/knowledge-indexer-agent.ts`'s `flattenFoundationText()`
   (lines ~153-168): add a third source read from the field that is
   actually populated — `enrichment.propublica` (name, `ntee_code`,
   `subsection_code`, `totrevenue`, `totassetsend`, `totfuncexpns`) —
   synthesized into a short indexable description. Complementary,
   longer-term option: backfill the `programs` column from the 990
   Schedule I data `enrich-foundations-990.ts` already parses upstream but
   never assigns (per `AGENT_CENSUS.md`'s own note).
2. `worker/knowledge-indexer-processor.ts`: move `this.agent.run()`'s
   `startRun()` call to fire only after `loadPendingBatch()` confirms
   `itemsFound > 0` — same shape `enrichment-processor.ts` already uses.
**Blast radius:** step 1 triggers real OpenAI embedding calls across
133,812 rows — batch/throttle it, don't fire it as one burst. Step 2
changes `agent_runs` volume/shape for this agent_type going forward; any
existing dashboard math that assumes "1 row ≈ 1 minute of uptime" for this
agent needs to be told the row semantics changed.
**Verification:** `foundation_directory` count WHERE `embedding IS NOT
NULL` climbs off zero for the first time since 2026-06-19; a fresh
`agent_runs` row for `ag-29-knowledge-indexer` with `items_processed > 0`
— something that has happened exactly 3 times, ever, in this table's
history.
**Effort:** small-medium (two isolated files).

---

## RC-2 — AutoApply submission chain: fixes already shipped, needs cache-clear + live verification, not new code

**Agents affected:** `autoapply_queue_processor`, `autoapply_submission_validator`,
`autoapply_form_analyzer`, `autoapply_form_filler`, `autoapply_captcha_solver`,
`autoapply_confirmation_parser`, `autoapply_registration`,
`autoapply_risk_engine`, `autoapply_pitch_personalizer`,
`autoapply_receipt` — **10 agents**, currently 0 confirmed organic
completions across this codebase's entire history.

**Evidence** (`AGENT_CENSUS.md` line 206, cross-referenced against
`AUTOAPPLY_BLOCKER_CHAIN.md` and current source):
> "0/59 completions ever. Per AGENT_FAILURE_LEDGER.md and
> AUTOAPPLY_BLOCKER_CHAIN.md: the first 55 failures were legitimate
> SkipError... mis-logged as failed by a run-logger.ts classification bug
> (fixed this cycle — migration 199)... the remaining recent failures
> trace to a separately-found, still-referenced FormAnalyzerAgent bug
> (never calls page.goto() on first encounter with a funder, caching a
> poisoned 0-field template for 7 days)."

Both fixes are **confirmed already merged and on `main`** — verified this
session by reading current source: `worker/queue-processor.ts:1353` calls
`page.goto(portalUrl!, ...)` unconditionally before the
`needsReanalysis` branch (commit `2027a944`, AR-12.2), and `run-logger.ts`'s
`withAgentRun()` classifies `SkipError`/`AccountSetupRequiredError`/
`CaptchaPauseError` as `'skipped'`, not `'failed'` (AR-11.1). So the
0/59 figure in the census is a **lifetime metric still carrying pre-fix
history**, not proof the current code is still broken.

**Fix (what's actually left):**
1. Query `form_templates` live for rows with `field_count = 0` (or
   `form_structure = '{"fields": [], "formAction": ""}'`) and
   `last_verified_at` older than the AR-12.2 deploy timestamp — these are
   pre-fix poisoned caches that will keep short-circuiting reanalysis
   until their own 7-day staleness window naturally expires.
   `UPDATE form_templates SET last_verified_at = NULL WHERE field_count =
   0 AND last_verified_at < '<AR-12.2 deploy time>'` forces immediate
   re-analysis instead of waiting out the window.
2. Confirm (via the same `railway deployment list` check AR-9.3 used for
   the Chromium fix) that the currently-running Railway worker deployment
   actually descends from commit `2027a944` — a merged fix that hasn't
   been redeployed doesn't count.
3. Seed one real ready org+funder pair (not a synthetic
   `AUTOAPPLY_*_TEST_*`/`RLS_TEST_ORG_*` org — those were this session's
   own integration-test debris, per AR-12.1/12.2) and let the live worker
   process a real queue item start to finish.
**Blast radius:** the `UPDATE` in step 1 touches the one shared
`form_templates` cache every future first- and re-analysis reads from —
scope the WHERE clause tightly (`field_count = 0` only) so it never
force-invalidates a legitimately-analyzed template.
**Verification:** the first-ever `agent_runs` row for
`autoapply_queue_processor` with `status = 'completed'`, and a real row in
`autoapply_submissions` for a genuine (non-test) org+funder.
**Effort:** small — both code fixes already shipped; what's left is a
scoped cache-clear query and one live verification run.

---

## RC-3 — PIL `BEN-SUP-05`: dropped delegation field blocks the one agent every submit path depends on

**Agents affected:** `BEN-SUP-05` directly (1 agent, 0/11 completed, 100%
failure). Gating role: `BEN-APP-01`'s own registry `human_boundary`
"always delegates a BEN-SUP-05 critic review" before recommending a
submission — so this bug sits directly between PIL research and any
AutoApply handoff.

**Evidence** (`AGENT_CENSUS.md` line 154):
> "Hard-requires context.plan.targetAgentRunId or immediately fails.
> Nothing in the codebase ever sets that field: research-orchestrator.ts..."

**Fix:** in `src/lib/pil/agent-runner.ts`'s `AgentRunner.delegate()`, thread
`plan.targetAgentRunId` through to the child context the same way every
other plan field is forwarded. Locate every call site that delegates to
`childAgentCode='BEN-SUP-05'`, confirm the caller populates
`targetAgentRunId` in its delegation payload, then fix `delegate()` itself
to stop dropping it.
**Blast radius:** `delegate()` is the shared path for every PIL
agent-to-agent call (`BEN-SUP-01`'s `DISCOVERY_ENTRYPOINT_AGENT` handoff,
`BEN-INT-08`'s fan-out to `BEN-INT-03`/`BEN-INT-09`/`BEN-QLF-03`, etc.) —
regression-test the delegation targets that already work today
(`BEN-DIS-02` via `BEN-DIS-01`, `BEN-INT-03`/`09` via `BEN-INT-08`) so this
fix doesn't change their behavior while fixing SUP-05's.
**Verification:** the first-ever `pil_agent_runs` row for `BEN-SUP-05`
with `status = 'completed'` (currently 0 completed / 11 failed).
**Effort:** small (one field, one file) — flagged medium-risk only because
the touched function is shared by every PIL delegation.

---

## RC-4 — PIL stuck-run hang: shared 30-minute timeout across SUP/DIS/INT/REL agents, blocking most of the pipeline positionally

**Agents affected directly:** `BEN-SUP-01`, `BEN-SUP-03`, `BEN-DIS-08`,
`BEN-INT-03`, `BEN-INT-09`, `BEN-REL-03` — **6 agents**, each with the
identical `stuck-run-watchdog.ts:255` timeout signature.
**Cascading blast radius (not counted as recovered, stated honestly):**
because `runFamilies()` aborts a family on the first member's failure/hang,
this same root cause is the practical reason `BEN-DIS-03..07` (5),
`BEN-QLF-01/02/05` (3), `BEN-STR-01..03` (3, currently mislabeled ORPHANED
per the task-brief correction in `AGENT_CENSUS.md` line 193), `BEN-OPS-01`
(1), and `BEN-APP-01/02/03` (3) have never once been reached in a
production run — roughly 24 more agents whose fix depends on this one
plus RC-3, not a separate code change. **Caveat, not overpromised:**
`BEN-INT-02/04/05/06/07/10`'s starvation has a second, independent cause
(the only live `pil_prospects` row has `entity_type='other'`, and INT
requires `individual` — see `AGENT_CENSUS.md` note on line 167) that this
fix alone will not resolve; that is a discovery-classification/data-volume
question, not a hang.

**Evidence** (`AGENT_CENSUS.md` lines 150, 152, 165, 168, 174, 178):
> "All 6 failed rows carry the identical stuck-run-watchdog.ts:255 timeout
> message" (BEN-SUP-01) ... "7/8 rows are stuck-run-watchdog timeouts"
> (BEN-SUP-03) ... "same hang signature as BEN-SUP-01/03" (BEN-DIS-08,
> BEN-INT-03, BEN-INT-09, BEN-REL-03).

**Fix:** this needs a short investigation before it's a patch. Read the
`execute()` bodies of these six files side by side and find the shared
blocking call — most likely a web-search/external-lookup tool invocation
with no per-call timeout, since these are specifically the DIS/INT/REL
"research a real external entity" family (the KNW/STR agents, which only
read prior evidence rows and never hang, are conspicuously absent from
this list — a strong signal the hang is tied to an external call, not
generic PIL plumbing). Wrap the identified call in an explicit timeout
(reuse AR-11.4's `AGENT_TIMEOUT_CLAUDE_CALL_MS`/180s class) so a hang fails
fast and loud instead of silently consuming the full 30-minute watchdog
window.
**Blast radius:** if the shared call lives in a common PIL tool-execution
helper, the fix applies platform-wide to every `BEN-*` agent using it —
audit all families, not just the six with an observed hang (note
`BEN-QLF-03` shows a *different* failure signature despite similar tool
usage — RC-9 — so the hang may be data-dependent, e.g. only trips against
a slow/unresponsive external target, not universal).
**Verification:** `BEN-DIS-03` (or any of the ~24 positionally-unreachable
agents above) recording a `pil_agent_runs` row — completed, or a fast
named failure — for the first time ever, where today it has zero rows
because the family aborts upstream before ever reaching it.
**Effort:** medium — needs a build agent with time to trace the shared
call across 6 files before a fix is possible; this is a diagnosis-then-patch
task, not a one-line change.

---

## RC-5 — EA-family (10 agents) + AG-22: corporate-prospect queue permanently drained, no scheduled refill

**Agents affected:** `ea01_giving_detector` .. `ea10_social_media_analyzer`
(10) + `ag22_propensity_scoring` (chained automatically after every EA
pass) — **11 agents**.

**Evidence** (`DATA_PIPELINE_AUDIT.md` §3, cross-referenced with
`SCHEDULER_MAP.md` §5 and `SESSION_STATE.md`'s AR-9.3 entry):
> "`corporate_prospects` | 50 | 1 (test-harness) | 2026-09-17 |
> `scripts/acquire-corporate-prospects.ts` (manual CLI, not scheduled
> anywhere) | No — the one 7d row is synthetic | Effectively no real
> organic feed"

> (AR-9.3, `SESSION_STATE.md`) "the 'nightly' sweep the route's own
> comment claims does not exist anywhere in `worker/scheduler.ts` or
> `vercel.json` — it's aspirational documentation, not live behavior... a
> row can never re-enter the `.is('enrichment_completed_at', null)` queue"
> once `enrichProspect()`'s unconditional stamp marks it "attempted."

**Note on current DEGRADED/NO-OP labels:** `ea01/02/05/08/09`'s
lifetime 84-86% failure rates predate AR-7.1's Chromium-launcher fix,
which AR-9.3 already **proved live** — a reset-and-rerun of all 10 EA
agents + AG-22 against a real production row completed with zero errors
on 2026-09-18. The browser bug is closed; what remains is that no new row
has entered the queue since 2026-08-04, so there has been nothing left to
prove it against again.
**Fix:**
1. Add a real scheduled trigger for `acquireFromGooglePlaces()` — a new
   `worker/scheduler.ts` daily/weekly slot, wired the same way its other
   11 jobs are (`SCHEDULER_MAP.md` §4), rather than leaving the route's
   comment's claim unbuilt.
2. Fix `enrichProspect()`/`mergeEnrichmentPatch()`'s completion-flag
   semantics so `enrichment_completed_at` means "all 10 EA sub-agents +
   AG-22 genuinely completed," not "attempted" — a partially-completed row
   should be able to re-enter the `.is('enrichment_completed_at', null)`
   queue.
**Blast radius:** every consumer of `corporate_prospects.enrichment_completed_at`
(AG-22, any UI status badge) needs to agree on the new semantics; a naive
migration could spuriously re-queue already-legitimately-complete rows if
it doesn't backfill carefully.
**Verification:** `corporate_prospects` count WHERE `enrichment_completed_at
IS NULL` rising above 0 for the first time since 2026-08-04; a fresh
`agent_runs` row for any EA agent with genuinely new `runs_7d` volume that
isn't another manual test batch.
**Effort:** medium (a scheduler entry + a shared completion-flag contract
read by more than one consumer).

---

## RC-6 — `hud_monitor`: unconditional call site, zero runs ever — a real anomaly, not starvation

**Agents affected:** `hud_monitor` (1 agent).

**Evidence** (`AGENT_CENSUS.md` line 99):
> "ANOMALY: 0 agent_runs rows ever despite a confirmed unconditional call
> site inside an agent (government-grants.ts) that itself has [49 real
> production runs]."

**Fix:** trace `research/government-grants.ts:626`'s `runHudBranch()` call
into `hud-monitor.ts`'s entry point directly — since the call is
unconditional but the callee has literally never self-logged a run,
something between the call site and `BaseAgent.startRun()` either throws
before `startRun()` executes (and is swallowed by a bare catch) or the
"unconditional" branch has a silent early-return guard (env var/feature
flag) invisible from the outside. One log line or a `system_errors` query
scoped to this call site should surface it directly.
**Blast radius:** isolated — single call site, single agent.
**Verification:** first-ever `agent_runs` row for `hud_monitor`.
**Effort:** small.

---

## RC-7 — `follow_up_generator`: structurally-impossible zero-item completions

**Agents affected:** `follow_up_generator` (1 agent).

**Evidence** (`AGENT_CENSUS.md` line 97):
> "UNRESOLVED ANOMALY: completed_with_zero_items=4/4 even though the code
> path structurally cannot produce 0 -- parseSequenceResponse..."

**Fix:** read `parseSequenceResponse()` in `follow-up-generator-agent.ts` —
the likely bug is `items_processed` being read from the wrong field or
miscounted after the parse returns, rather than the agent genuinely doing
zero work on every single run.
**Blast radius:** isolated. Do not conflate with `ag-28-followup` (a
separate module recommended for deletion below, not repair) despite the
similar name and domain.
**Verification:** a fresh run reporting `items_processed` matching the
actual number of sequence steps generated.
**Effort:** small.

---

## RC-8 — `review`: 100% failure, zero `ai_usage_log` rows, consistent with an un-raised timeout class

**Agents affected:** `review` (1 agent, 0/4 completed, ever).

**Evidence** (`AGENT_CENSUS.md` line 109, cross-referenced with
`SESSION_STATE.md`'s AR-7.3 entry naming `review-agent.ts` as one of the
platform's chronic-timeout agents):
> "4 lifetime runs, 0 completed, 4 failed (100% failure rate) -- has NEVER
> once succeeded. Zero ai_usage_log rows despite calling Claude."

**Fix:** confirm whether `review-agent.ts` received AR-11.4's per-class
timeout raise (`AGENT_TIMEOUT_CLAUDE_CALL_MS`/180s or
`AGENT_TIMEOUT_MULTI_STEP_MS`/270s) or is still on the 60s deterministic
default; if still 60s, reclassify it the same way `budget-builder.ts`/
`success-probability.ts` already were.
**Blast radius:** isolated — reuses an existing, already-tested mechanism.
**Verification:** a fresh `/api/ai/review` call completing instead of
timing out, and the first-ever non-empty `ai_usage_log` row for this
agent_type.
**Effort:** small.

---

## RC-9 — `BEN-QLF-03`/`BEN-QLF-04`: serialization bug likely already fixed, needs re-verification

**Agents affected:** `BEN-QLF-03`, `BEN-QLF-04` (2 agents, both BROKEN).

**Evidence** (`AGENT_CENSUS.md` lines 186-187):
> "All 3/3 failed runs recorded error text literally '[object Object]' --
> a real historical bug, now fixed via serializePilError()..."

**Fix:** confirm the fix landed on the specific call path these two agents
use (not just the general PIL error surface), then re-trigger both via a
live delegation (`BEN-INT-08` → `BEN-QLF-03`, and QLF-03/04's normal
family sequence) to produce a fresh, real error message or completion.
**Blast radius:** none beyond these two if the fix is already generic.
**Verification:** a fresh `pil_agent_runs` row for `BEN-QLF-04` with a
real (non-`[object Object]`) error message, or a completion.
**Effort:** small — likely verification-only.

---

## Governance hygiene — registry gap (not a functional fix)

**Agents affected:** `narrative_drafting`, `autonomous_orchestrator`,
`fit_analysis`, `ag-26-forecast`, `ag-43-funder-signals` (plus
`ag22_propensity_scoring`, already covered under RC-5) — 6 `agent_type`
values with real, executed production history absent from the 144-module
registry (`AGENT_CENSUS.md` "Registry-gap agents" table). These agents are
**not broken** — several (`narrative_drafting`: 63/88 completed;
`ag22_propensity_scoring`: 59/63 completed) are among the platform's most
actively-used agents. The only defect is that the registry that's supposed
to be the ground-truth module list doesn't know they exist, which is
exactly the kind of gap that makes future inventories "confusing" per this
task's own framing. **Fix:** add all 6 (minus `autonomous_orchestrator`,
which is a wrapper row, not a leaf agent) to
`scripts/audit/agent-exercise-registry.ts` with their real source file
paths. **Effort:** small (documentation/registry only, zero runtime
change). Not ranked in the leverage list above because nothing here is
"recovered" — it is bookkeeping that prevents the next audit from
re-discovering these agents from scratch.

---

## NEEDS REID — product decisions, credentials, or accounts only he can provide

### N-1. Autonomous AG-family: expand beyond the single enabled org?

**Agents affected:** `ag-35-community-need`, `ag-09-outcome-analyzer`,
`ag-11-knowledge-gap`, `ag-39-roi-optimizer`, `ag-08-renewal-tracker`,
`ag-12-search-optimizer`, `ag-40-strategic-advisor` — **7 agents**, all
NEVER-INVOKED despite real, live, firing scheduler slots.
**Evidence** (`SCHEDULER_MAP.md` §7): "Wired into `worker/scheduler.ts`'s
nightly sweep but gated on `org_autonomous_config` having only 1 of ~74
orgs enabled." **This is not a bug** — a build agent flipping the config
for more orgs is a business decision (is autonomous mode ready for
general availability?), not a technical fix. Reid needs to decide which
orgs, if any, should have `org_autonomous_config` enabled next, and
whether these 7 agent classes are ready for that exposure.

### N-2. Manual-only features never once surfaced or exercised

**Agents affected (15):** `cold_outreach`, `custom_scrape_research`,
`giving_history_extractor`, `foundation_research_finder`,
`competitor_intelligence`, `government_research_housing_scrapers`,
`state_portal_housing_scrapers`, `state_portal_tdhca`,
`government_research_usaspending`, `simpler_grants_research` (additionally
blocked by a missing `SIMPLER_GRANTS_API_KEY`), `propublica_mining`,
`ag-37-simulation`, `email_campaign`, `final_assembly`, `deadline_prediction`.
**Evidence:** each has a real, wired, unmodified manual API route or
event trigger (`AGENT_CENSUS.md` per-row evidence) that has simply never
been called in this platform's history — not dead code, not
misconfigured, just never exposed anywhere a user or scheduler would hit
it. **This is a product-surface decision, not a bug list:** for each of
these 15, Reid needs to say whether it's (a) worth building a UI entry
point or scheduler slot so it finally gets exercised, or (b) safe to leave
manual/dormant, or (c) a candidate for retirement alongside the DELETE
list below. No build agent should guess this list's priority order
unprompted.

### N-3. `alert-notifier.ts`: 637 critical alerts, zero ever delivered to Slack

**Evidence** (`SCHEDULER_MAP.md` §5): "`alerts.notified_at` is `NULL` on
every single row in the table, including 637 `severity='critical'` rows
dating back to 2026-06-22... either `FORGE_SLACK_WEBHOOK` is unset in the
Railway production environment or every delivery attempt has failed."
**Needs:** Reid's Railway dashboard access (or the credential itself) to
confirm whether `FORGE_SLACK_WEBHOOK` is set in production, and if it is,
to check delivery logs for the actual failure. No build agent in this
sandbox has Railway env access this session (same gap logged in
`benavora-vercel-cli-team-mismatch-2026-09-15.md`'s sibling finding for
Railway).

### N-4. `ENABLE_SCRAPER` production value — is the 6-7-week enrichment stall a flag or a deeper bug?

**Evidence** (`DATA_PIPELINE_AUDIT.md` §4): the two weekly scraper jobs
fire on schedule (confirmed via Railway scheduler logs) but every
downstream enrichment timestamp has been flat for 6-7 weeks — "(a)
`ENABLE_SCRAPER` is not set to `'true'`... or (b) the job runs but its
Chromium-dependent scraping fails silently." **Needs:** Reid's Railway
env access to check the literal flag value; without it, a build agent
would be guessing between two different fixes.

### N-5. Vercel cron dashboard liveness

**Evidence** (`SCHEDULER_MAP.md` §3): the Vercel MCP connector in this
session resolves under an account/team that does not include "benavora" —
code confirms all 7 cron entries exist in `vercel.json`, but no tool this
session can confirm they're actually enabled in the deployed dashboard.
**Needs:** Reid to grant access under the correct Vercel team, or manually
confirm the 7 entries are live.

---

## RECOMMEND DELETE — dead code duplicating a working agent, not worth repairing

Per this task's explicit instruction: an agent with zero lifetime runs, no
real invoker (or an invoker only a one-time exercise harness ever hit),
that duplicates a working agent, should be deleted, not wired. Wiring any
of these would only add a second, worse path to functionality the
platform already has.

1. **`budget_builder_worker`** (`src/lib/agents/budget-builder.ts`) — 0
   lifetime runs; the `routeQueueItem()` dispatch case exists but nothing
   in the codebase ever enqueues an `agent_queue` row with this id. The
   real, working budget agent is `budget_builder` (`budget-agent.ts`,
   reachable via `/api/ai/budget`, DEGRADED but genuinely used, 4 lifetime
   runs). Delete the worker variant rather than building the missing
   enqueue path for a second implementation.

2. **`form_filler`** (`src/lib/agents/form-filler.ts`) — 0 lifetime runs,
   reachable only via a manual route nobody has called, **and** per
   `AGENT_CENSUS.md`'s own "three most surprising findings": "fills and
   clicks submit on a live funder form directly inside `execute()`, with
   zero human review... contradicting the 'Automation NEVER auto-submits
   forms' contract `playwright-agent.ts` visibly enforces two files away."
   The real, gated path is `autoapply_form_filler`
   (`src/lib/autoapply/form-filler-agent.ts`), already integrated into
   `worker/queue-processor.ts`'s approval-gated pipeline. Do not wire this
   module — its only demonstrated behavior is a safety violation waiting
   to happen. Delete it.

3. **`form_analyzer`** (`src/lib/agents/form-analyzer.ts`) — same shape:
   0 lifetime runs, superseded by the queue-integrated
   `autoapply_form_analyzer` (`form-analyzer-agent.ts`), which is the
   version `worker/queue-processor.ts` actually calls.

4. **`application_cloning`** (`src/lib/agents/application-cloner.ts`) — 0
   lifetime runs. Per memory (`benavora-application-cloning-two-entry-points.md`)
   this predates the lighter, actually-used `/api/applications/[id]/clone`
   route. `AGENT_CENSUS.md` line 83 independently confirms the lighter
   route "never imports ApplicationClonerAgent."

5. **`ag-25-deadline-prediction`** (`deadline-prediction-agent.ts`) — the
   census's own invoker column reads "NONE FOUND. No case in
   routeQueueItem, no instantiation anywhere" (line 122); its one lifetime
   run was the same-day exercise-harness batch (2026-08-02, alongside
   `ag-28-followup` and `ag-15-probability` below). Duplicates the real,
   wired pair `deadline_extraction` (OPERATIONAL) / `deadline_prediction`
   (has a real invoker, just data-starved).

6. **`ag-28-followup`** (`followup-generator-agent.ts`) — one lifetime run
   (the same harness batch), duplicates the real, actively-wired
   `follow_up_generator` (RC-7 above, needs a fix but is genuinely
   invoked via `routeQueueItem()` and `process-followups`).

7. **`ag-15-probability`** (`probability-scoring-agent.ts`) — one lifetime
   run (same harness batch), duplicates the real, heavily-used
   `success_probability` (158 lifetime runs, nightly cadence, the
   platform's actual grant-success scorer).

**Do not delete** (named here only to head off the obvious
over-generalization): `deadline_prediction` and `follow_up_generator`
themselves — both have real invokers and real production traffic; they
are the *targets* of the duplication above, not duplicates themselves.

---

## No action needed — correct behavior, not a defect

Called out so this plan doesn't imply every non-OPERATIONAL row needs
work. These genuinely do the right thing given the data in front of them:

- `ea03/04/06/07/10` (NO-OP): scrape real pages successfully; the target
  content (sponsorships, ESG initiatives, social presence) genuinely isn't
  there on this nonprofit set.
- `government_research`, `sam_gov_research`, `custom_api_research`,
  `state_portal` (NO-OP): query real live government APIs/portals
  successfully; the query scope rarely matches anything right now — a
  tuning question, not a bug.
- `BEN-SUP-02`, `BEN-INT-01`, `BEN-KNW-02`, `BEN-REL-04`, `BEN-STR-04`
  (DEGRADED, but by design): each returns a correctly-reasoned
  `{skipped: true, reason: ...}` payload — "no_active_sources,"
  "entity_type=other, not individual," "requires ≥2 candidate prospect
  ids" — accurate self-reporting of nothing-to-do, not a failure to fix.
- `ag-27-board-packet`, `ag-30-donor-intent`, `ag-10-document-expiry`,
  `ag-17-discovery`, `ag-29-fundability`, `deadline_extraction`,
  `success_probability`'s current post-fix traffic, `ag-digest`: all
  OPERATIONAL/healthy per `SCHEDULER_MAP.md` §4 — no action.

---

## Coverage tally

| Bucket | Root causes | Agents covered |
|---|---|---|
| Build-agent-actionable (RC-1..RC-9) | 9 | 1 + 10 + 1 + 6 (+ ~24 cascade, not counted) + 11 + 1 + 1 + 1 + 2 = **34 directly, ~58 including the honestly-labeled PIL cascade** |
| Governance hygiene (registry gap) | 1 | 6 (already-working agents, bookkeeping only) |
| Needs Reid (N-1..N-5) | 5 | 7 + 15 = **22** (N-3/N-4/N-5 are infrastructure findings, not agent counts) |
| Recommend delete | — | **7** |
| No action needed (correct behavior) | — | 14 |

**14 distinct root causes** identified (9 build-agent-actionable, 1
governance/registry hygiene item, and 5 requiring a Reid decision or
credential), directly covering **34 non-operational agents** with a
named, concrete fix (rising to roughly **58** once the PIL stuck-run
fix's honestly-labeled cascade potential in RC-4 is included), plus **22
more** whose remediation depends on a product decision or credential only
Reid can provide, plus **14** confirmed correct-as-is. **7 agents are
recommended for outright deletion**, not repair.

---

## End-of-run verification

`pnpm typecheck` and `pnpm test` — real numbers, no code changed this
session (synthesis only): see the STATE_OF_THE_BUILD.md / SESSION_STATE.md
AR-13.4 entries for the exact pass/fail counts from this run.
