# FORGE 2.0 — Behavioral Contracts

**Last Updated:** June 22, 2026

These contracts are hard rules enforced during every FORGE build. Violation of a MUST DO or MUST NOT DO is a build failure. These are not suggestions.

---

## Global Contracts (Apply to ALL Agents)

### MUST DO
- All code must be PowerShell (.ps1 or .psm1 files). No Python, no JavaScript, no Bash, no batch files.
- All functions must include `param()` blocks with explicit parameter types.
- All database operations must use `Invoke-Sqlite` from ForgeLearning.psm1. No raw SQLite calls.
- All file writes must include error handling (`try/catch` or `-ErrorAction Stop`).
- All console output must use `Write-Host` with explicit `-ForegroundColor` for status indication: Green = PASS/success, Red = FAIL/error, Yellow = WARN/caution, Cyan = INFO/progress, Gray = DEBUG/detail.
- All functions that write to the learning database must include `machine_id` from `Get-MachineId`.
- All records written to the learning database must include a UUID `id` field generated via `[guid]::NewGuid().ToString()`.
- All timestamps must use ISO 8601 format via `(Get-Date -Format 'o')`.
- All JSON serialization must use `ConvertTo-Json -Depth 10` to prevent shallow serialization.
- Every module (.psm1) must export its public functions explicitly via `Export-ModuleMember`.
- Every prompt must update STATE_OF_THE_BUILD.md with current completion status before finishing.
- Every git commit must use the structured format: `FORGE-[project]-P[phase]-T[task]-[status]`.

### MUST NOT DO
- Must NOT use any language other than PowerShell for FORGE's own codebase.
- Must NOT use Supabase for FORGE's learning database. SQLite only.
- Must NOT write directly to the master sync database on the 18TB drive during a run. Only via Sync-ForgeMemory at SessionEnd.
- Must NOT hardcode file paths. All paths must be relative to `$ProjectPath` or derived from configuration.
- Must NOT use `Write-Output` for status messages (it pollutes the pipeline). Use `Write-Host`.
- Must NOT use `Invoke-Expression` for arbitrary code execution outside of the hook system.
- Must NOT modify hooks.json directly from code. Hook evolution goes through pending_evolutions with human approval.
- Must NOT store API keys, passwords, or secrets in any FORGE source file, config file, or learning database.
- Must NOT assume a specific machine. All machine-specific values come from `Get-MachineId` or configuration.
- Must NOT catch exceptions silently. Every `catch` block must either re-throw, log to the learning database via `Register-Error`, or write a visible console message.

### MUST VALIDATE
- Before any SQLite operation: verify `forge_memory.db` exists via `Get-ForgeDbPath`. If missing, call `Initialize-ForgeMemory`.
- Before any sync operation: verify the master drive path is accessible. If not, skip sync with WARN (never fail a build because the external drive isn't mounted).
- Before any git operation: verify the project path contains a `.git` directory. If not, initialize git.
- Before executing any hook: verify hooks.json parses as valid JSON. If malformed, fall back to hardcoded minimal hooks (tsc-check, gitleaks-scan only).

---

## Contract: ForgeLearning

### MUST DO
- `Initialize-ForgeMemory` must be idempotent. Running it on an existing database must not drop or modify existing data.
- All `Get-*` functions must return empty arrays (not null) when no results match.
- `Get-ErrorFingerprint` must produce identical fingerprints for the same error pattern across different files (generalized path, templated message).
- `Invoke-Sqlite` must support parameterized queries (never string-interpolate user data into SQL).

### MUST NOT DO
- Must NOT delete records from the learning database. All data is append-only. "Deletion" is done by setting an `active` flag to 0.
- Must NOT run `DROP TABLE` or `DELETE FROM` without a WHERE clause under any circumstance.

---

## Contract: ForgeSync

### MUST DO
- Must acquire file lock before writing to master database. Always release lock in a `finally` block.
- Must detect stale locks (>2 minutes old) and remove them automatically.
- Must use INSERT OR IGNORE to prevent duplicate records. Never UPDATE master records — append only.

### MUST NOT DO
- Must NOT sync during a run. Only at SessionStart (Pull) and SessionEnd (Push).
- Must NOT sync if the lock file is held by another machine and is less than 2 minutes old. Wait and retry.

---

## Contract: ForgeHooks

### MUST DO
- Must execute hooks in priority order (ascending) within each event.
- Must enforce timeout on every hook execution. No hook runs indefinitely.
- Must log every hook execution to hook_execution_log, including SKIP results.
- Must prevent hook recursion (depth > 2 suppressed with WARN).

### MUST NOT DO
- Must NOT execute disabled hooks. Skip silently, no logging.
- Must NOT execute hooks concurrently within the same event. Sequential only.
- Must NOT modify hooks.json during execution. Changes go through pending_evolutions.

---

## Contract: ForgeRetrofit

### MUST DO
- SCAN must execute all 14 operations even if some fail. Failures are logged, not fatal.
- Dynamic analysis (Operation 13) must use GET requests only on first RETROFIT. No POST/PUT/DELETE.
- DIAGNOSE must run adversarial review on every Architecture Health Report. No skipping.
- RECONCILE must persist all decisions to the learning database before executing any changes.
- RECONCILE must present UNBUILT items as BUILD/DEFER/ABANDON choices. Never auto-build undiscussed features.

### MUST NOT DO
- Must NOT modify any project files during SCAN or DIAGNOSE. These are read-only analysis phases.
- Must NOT auto-apply CRITICAL fixes without presenting them to Reid first (auto-approve with override).
- Must NOT delete governance documents. ABANDONED features are removed from content, not by deleting files.

---

## Contract: ForgeSession

### MUST DO
- Must create `forge_running.lock` at SessionStart and remove it at SessionEnd (in a `finally` block).
- Must serialize complete state to `session_state.json` at every SessionEnd, regardless of end reason.
- Must verify build fingerprint at every SessionStart before resuming. Mismatch requires human decision.
- Must check for crash recovery (stale lock file) before any other SessionStart action.

### MUST NOT DO
- Must NOT resume from a stale session without fingerprint verification.
- Must NOT overwrite session_state.json during a run. Only at SessionEnd.

---

## Contract: ForgeCore

### MUST DO
- Must route to the correct phase module based on command-line arguments. No silent defaults.
- Must create a git snapshot (tag) before every prompt execution.
- Must enforce all configured gates after every prompt. Gate failures trigger retry logic.
- Must generate a build report at SessionEnd summarizing pass/fail per prompt.

### MUST NOT DO
- Must NOT execute a prompt if the prior prompt's blocking gate failed and max retries are exhausted. Skip and log.
- Must NOT modify middleware.ts without explicit approval flag. (Inherited from Reid's canonical rules.)

---

## Contract: ForgeSentinel (Run 2-3)

### MUST DO
- Must gracefully degrade when a tool is not installed. Log SKIP, never block the build for optional tools.
- Must run Ring 1 tools (tsc, ESLint, schema drift) on every prompt during EXECUTE. No exceptions.
- Must log all tool results to the learning database via Register-Error for failures.

### MUST NOT DO
- Must NOT run Ring 4 tools (CodeQL, OWASP ZAP, k6) during EXECUTE phase. Ring 4 is pre-deploy only.
- Must NOT treat SKIP as FAIL. Missing tools degrade gracefully.

---

## Contract: ForgeComposer (Run 3-4)

### MUST DO
- Must validate the dependency graph for cycles before producing any prompts. Cycles halt composition.
- Must cap each prompt at one module, one feature, one testable outcome. Never combine unrelated tasks.
- Must include all 7 canonical sections in every prompt. No section may be omitted.
- Must inject only relevant governance slices, never entire documents.

### MUST NOT DO
- Must NOT produce prompts that reference "the previous prompt" or assume shared context. Every prompt is self-contained.

---

## Contract: ForgeArchitect (Run 4)

### MUST DO
- Must run all four PRD refinement passes. No shortcuts.
- Must validate the generated schema before proceeding to SCAFFOLD. Validation failure blocks Phase 2.
- Must record every architectural decision to decision_weights.

### MUST NOT DO
- Must NOT proceed past Phase 1 without Reid's explicit PRD approval (Pass 4).

---

## Contract: ForgeDeploy (Run 4-5)

### MUST DO
- Must apply Supabase migrations to production BEFORE deploying code to Vercel. Migration-first, always.
- Must deploy to Vercel preview (canary) before production. Never deploy directly to production.
- Must verify environment parity before deployment. Missing CRITICAL env vars block deploy.
- Must execute production rollback if health check fails after promotion.

### MUST NOT DO
- Must NOT apply migrations containing DROP TABLE or DROP COLUMN without explicit human approval.
- Must NOT deploy if Ring 3 Sentinel has not passed.

---

## Contract: Relationship Scoring (Benavora product, not FORGE)

Note on numbering: several agent source files (e.g.
`src/lib/agents/funder-relationship.ts`,
`src/lib/agents/relationship-builder-agent.ts`) cite this document as
"BEHAVIORAL_CONTRACTS.md §25/§26" for product conventions. This file has no
`§NN` numbering scheme and, until this section, contained no content about
the Benavora SaaS product at all — every other section above governs FORGE,
the separate PowerShell build tool. Those citations reference sections that
were never written here (see project memory
`benavora-governance-docs-missing-v1-sections`). This section is added at
the literal location those citations point to, without inventing a fake
numbering scheme to match them.

### Canonical formula

The single source of truth for a funder's relationship score is
`scoreFromEvents()` / `computeRelationshipScore()` in
`src/lib/intelligence/relationship-scorer.ts`, computed from the
`funder_relationship_events` table (migration 091):

- **Event weights** (`event_type` is a fixed 6-value CHECK constraint):
  `award` +30, `response` +20, `meeting` +15, `application` +10,
  `outreach` +5, `rejection` -10. Any other value scores 0.
- **Score**: the sum of every recorded event's weight for that funder,
  clamped to the 0-100 range. No time decay is applied to the score itself.
- **Momentum**: `rising` if the weighted sum of events in the last 90 days
  exceeds the weighted sum of events in the prior 90-180 day window,
  `declining` if less, `stable` if equal. Events older than 180 days count
  toward the score but not toward either momentum window.

### MUST DO
- Any agent or route that reports a funder's relationship score MUST call
  `computeRelationshipScore()` (or `scoreFromEvents()` for an
  already-fetched event list) rather than re-implementing scoring logic.
- Any agent that records a funder interaction with a scoring effect MUST
  insert a row into `funder_relationship_events` using one of the six
  canonical `event_type` values, then recompute via the canonical function.
- Any write to `funder_relationship_scores` MUST set the same score value
  under both of that table's live column families (`relationship_score` and
  `score`) so no reader can observe two different scores for one funder.

### MUST NOT DO
- Must NOT derive a relationship score from `relationship_memory`, a
  decay/delta model, or any other input than `funder_relationship_events`.
- Must NOT add a new `event_type` value without a corresponding migration
  updating the CHECK constraint and this section's weight table.

### History
Before this contract, three agents touched "relationship" data with three
different formulas: `funder-relationship.ts` (Agent 23) ran a decay-based
delta model independent of any event log; `relationship-builder-agent.ts`
(AG-19) derived a score from `relationship_memory` recency/volume/award
signals; and the canonical scorer above (already the read path for
`/api/funders/[id]/relationship` and `/api/funders/relationship-scores`) was
never called by either agent. Both agents wrote overlapping but
never-reconciled columns on the same `funder_relationship_scores` row
(migration 139), so the Funders list/detail pages and the funder's
relationship tab could show different scores for the same funder. Both
agents are now consolidated onto the canonical formula.
`relationship-graph-builder-agent.ts` (AG-32) was audited as part of this
consolidation and does not compute a relationship score at all — it builds
the `pig_nodes`/`pig_edges` warm-introduction graph, an unrelated feature
sharing only the word "relationship."

---

## Contract: AutoApply Automation Session Lifecycle (Benavora product, not FORGE)

Note on numbering: `src/lib/automation/session-manager.ts`,
`worker/queue-processor.ts`, and several other source files cite this
document as "BEHAVIORAL_CONTRACTS §18" for the human-approval gate on
AutoApply submissions. As with the Relationship Scoring section above, that
section number was never written here — see project memory
`benavora-governance-docs-missing-v1-sections`. This section is added at the
literal location that citation points to (AR-7.2, 2026-09-17), without
inventing a fake numbering scheme to match it.

### The approval gate (what §18 citations mean)
The automation drives an `automation_sessions` row to `awaiting_approval` and
STOPS. The only path to `submitted` runs through a human's `approve()` call
followed by `markSubmitted()`, which refuses unless a human has already
approved (`src/lib/automation/session-manager.ts`). There is deliberately no
method that approves-and-submits in one step. This gate is orthogonal to the
lifecycle contract below — the second AutoApply implementation
(`worker/queue-processor.ts`'s `submission_queue` pipeline) auto-approves
its own sessions for its own autonomous submissions (no per-item human
review in that pipeline by design), and both implementations share one
`automation_sessions` table and one mutual-exclusion guard
(`SubmissionValidator.checkConcurrentAutomation()`).

### The lifecycle contract (added AR-7.2, 2026-09-17)
An `automation_sessions` row that never reaches a terminal status blocks
`checkConcurrentAutomation()` for that org+funder pair forever — live
production data showed 7 rows stuck this way (one 99 days old) and
`autoapply_queue_processor` failing 32/32 runs as a direct result.

### MUST DO
- Any code path that creates an `automation_sessions` row MUST finalize it
  (`submitted`/`failed`/`cancelled`, or `awaiting_approval` for the
  human-review pause specifically) on every exit, including a thrown error —
  from a `finally`, not a catch block that merely happens not to re-throw.
- Any new automation pipeline sharing this table MUST be covered by
  `worker/stuck-run-watchdog.ts`'s `reapStaleAutomationSessions()` sweep or
  an equivalent staleness reap — a `finally` block cannot survive a process
  crash or kill, so a bounded-time reap is the only backstop for that
  failure class.
- A session reaped for staleness MUST raise a `manual_review_required` alert
  (`raiseOrchestrationAlert()`) — a silently-cleaned-up deadlock teaches
  nothing the next time it happens.

### MUST NOT DO
- Must NOT reap `awaiting_approval` on the same short threshold as the
  technical mid-flight statuses (`pending`/`in_progress`/`approved`) — it is
  a genuine human wait, not a bug, and a short timeout would destroy a
  review a human is still plausibly about to complete.
- Must NOT swallow a finalize-write failure silently (a bare `.catch()` with
  only a log line) — a session that is still non-terminal because the write
  itself failed is exactly as blocking as one nobody ever tried to finalize.

### History
AR-3.1 (2026-09-17, earlier the same day) made `worker/queue-processor.ts`'s
form-fill failures throw (`IncompleteSubmissionError`,
`SubmissionNotVerifiedError`) rather than being silently swallowed, in order
to stop AutoApply from reporting a submission it never made. AR-7.2 checked,
rather than assumed, whether that change made this deadlock worse for the
`submission_queue` pipeline — it did not: every throw reachable after a
session's creation already fell through to the existing finalize call before
this fix (`SkipError`/`CaptchaPauseError` are the only re-throws, and both
only ever occur before a session exists). The real causes were narrower: the
finalize call's placement relied on no future catch re-throwing (moved into
`finally`, AR-7.2), a swallowed finalize-write failure (now alerts), and —
the actual explanation for the stuck `pending`/`approved` rows — a crashed
or killed worker process, which no amount of `try`/`catch`/`finally` can
protect against. That last class is why `reapStaleAutomationSessions()`
exists. Full incident detail, the 7 reaped row ids, and per-status threshold
rationale: `STATE_OF_THE_BUILD.md`'s "AR-7.2" section.

### A test's dummy-target data is not exempt from production guards (AR-12.2, 2026-09-18)
`SubmissionControls.checkCrossClientDedup()` (a *different* guard from this
section's mutex — it blocks a new org's submission to a funder domain if a
*different* org submitted there in the last 7 days, keyed by
`SHA-256(orgId)` in `cross_client_submissions`) applies with no exception
to `https://httpbin.org/forms/post`, this repo's own designated safe
non-funder test target. That is correct — the guard has no way to know a
domain is "just a test fixture," and must not be taught one, since a
special-cased domain is exactly the kind of thing that quietly rots into a
real bypass. The actual lesson: any test that writes to
`cross_client_submissions` (i.e., drives a real submission all the way
through) MUST clean up its own rows in `afterAll`, the same as every other
table it touches — `autoapply-queue-live-worker.test.ts` did not, and its
orphaned rows (owning orgs long since deleted) permanently blocked every
future attempt at a real completion by any org, not just future test runs.
Do not "fix" a cross-client-dedup block on a known-safe domain by touching
`checkCrossClientDedup()` itself or by special-casing the domain — check
first whether the blocking rows are orphaned test debris
(`cross_client_submissions` has no other legitimate source) and, if so,
delete only those, and fix the test that leaked them. Full incident:
`STATE_OF_THE_BUILD.md`'s "AR-12.2" section.

---

## Contract: SSRF Guard Test Injection Seam (Benavora product, not FORGE)

`src/lib/security/ssrf-guard.ts`'s `assertUrlSafe()` is a real protection
against a real attack (private-range/loopback/cloud-metadata addresses,
non-http schemes) — it is not a test inconvenience to be routed around.
Every prior AutoApply integration suite that needed a local fixture portal
(AR-9.3, AR-12.2, and others) documented this guard as the reason
`worker/queue-processor.ts`'s `processItem()` itself could never be driven
end to end, since the guard unconditionally rejects the loopback address any
hermetic local fixture must use. AR-16.1 closed that gap with a
dependency-injection seam rather than a guard change.

### MUST DO
- `QueueProcessor`'s constructor's `urlSafetyCheck` parameter MUST default to
  the real, unmodified `assertUrlSafe` — every production call site
  (`start()`, bottom of `queue-processor.ts`) MUST continue to construct
  `QueueProcessor` with exactly 2–3 arguments, never passing an override.
- A test that injects an override MUST have that override delegate to the
  real `assertUrlSafe` for every host it does not explicitly carve out — an
  override that unconditionally returns "safe" for any input is a disguised
  guard bypass, not a test seam, regardless of which file it lives in.
- A suite that adds such an override MUST also assert the guard is still
  live for a host outside the carve-out (see
  `processitem-orchestration.test.ts` test A3) — an injection seam with no
  test proving its boundary is exactly the kind of thing that quietly rots
  into a real bypass, the same concern AR-12.2's contract above raises for
  domain-based special-casing.

### MUST NOT DO
- Must NOT modify `src/lib/security/ssrf-guard.ts` itself to make a test
  target reachable (widening a blocked range, adding an env-var escape
  hatch, special-casing a hostname inside the guard). Every carve-out lives
  in the calling test, never in the guard.
- Must NOT reach for this seam to avoid genuinely proving a code path — it
  exists specifically for the orchestration wrapper *around* a chain that
  real Playwright/Claude suites (AR-9.3) already prove for real; it is not a
  general-purpose substitute for a real fixture portal where one is
  achievable (see AR-9.3's own header for why it used a real local HTTP
  server, not this seam, to prove the submission chain itself).

### History
AR-16.1 (2026-09-19) added the seam and used it to prove `processItem()`'s
five business gates (queue control plane, org readiness, portal health
check, risk engine, login-gating) with real, distinguishable, recorded
reasons. Full detail: `AGENTS_v2.md`'s "AR-16.1" section; `TESTING_v2.md`
§17; `STATE_OF_THE_BUILD.md`'s "AR-16.1" section.

---

## Contract: Scoring Output — Evidence and Insufficient Data (Benavora product, not FORGE)

Applies to every agent or module that persists a score, probability, rank,
match strength, or confidence value anywhere on the platform (the
`eligibility_scoring`, `ag-15-probability`, `ag-29-fundability`,
`success_probability`, `ag22_propensity_scoring`, `funder_relationship`,
`autoapply_risk_engine`, `corporate_intent_signals`, and PIL qualification-
squad families, and any future one). Written after AR-17.2
(`test-evidence/AGENT_OUTPUT_QUALITY_SCORING.md`) found
`opportunity_probability_scores` DEGENERATE for 95.6% of sampled rows: three
of its four weighted factors were silently substituted with hardcoded
neutral constants whenever the real input was missing, producing a number
that was mechanically a linear echo of one unrelated field while looking
like a personalized 0-100 probability, wrapped in templated "risk" language
that made it look more computed than it was. AR-17.5 fixed the mechanism in
`src/lib/intelligence/grant-probability-engine.ts` and
`src/lib/agents/probability-scoring-agent.ts`; this section generalizes the
rule so the same defect class doesn't recur in a different agent.

### MUST DO
- A scoring agent MUST track, per weighted factor, whether its value came
  from real stored data or a fallback/neutral constant (an `isFallback`
  boolean, or equivalent) — never silently blend the two into one opaque
  number.
- When too few of an agent's weighted factors have real data behind them to
  produce a meaningful score (this platform's threshold, traced to the exact
  AR-17.2 degenerate pattern: fewer than 2 of 4, or fewer than 2 of 5,
  factors real), the agent MUST persist an explicit, first-class
  insufficient-data outcome — a `status` (or equivalent) column value the UI
  can render as its own state — with the numeric score column left `null`.
  `null` is acceptable here specifically because it is paired with an
  explicit status flag; `null` alone, with no such flag, is not sufficient
  (see MUST NOT DO below).
- Every persisted score, and every persisted insufficient-data result, MUST
  carry an evidence record identifying which stored inputs (table + column,
  or equivalent) produced it, or were missing. A number or an
  insufficient-data verdict with nothing behind it is the same defect class
  as a `status='submitted'` row with no confirmation of the submission it
  claims happened.
- A UI that renders a score MUST render the insufficient-data state as its
  own distinct visual state (not the same "gray, not scored" treatment used
  for "this has never been computed at all" — those are different facts:
  one is "never attempted," the other is "attempted, declined to fabricate").

### MUST NOT DO
- Must NOT add jitter, randomization, or artificial spread to a score's
  output to make a distribution look more varied. If a formula produces a
  narrow or repetitive distribution because most of its inputs are
  genuinely missing across the sampled population, the fix is the
  insufficient-data rule above, never cosmetic variance.
- Must NOT represent "insufficient data to compute" using a magic sentinel
  number (`0`, `-1`, `50`) instead of an explicit status flag. A downstream
  reader cannot distinguish a sentinel from a real low score; several
  ripples from exactly this ambiguity were found and fixed in the same pass
  that added this contract (`match-feed.ts` collapsed a null score to `0`
  before checking whether a score existed at all).
- Must NOT recompute or reclassify historical rows via a bulk `UPDATE`
  guessing at what their status "should have been." The remediation path is
  re-running the real scoring computation against each row's live current
  inputs (as AR-17.5's one-time recompute script and the existing nightly
  batch jobs both do) — a status inferred without actually recomputing is
  itself an unevidenced claim.

### History
AR-17.5 (2026-09-19) is both the first violation found (AG-15) and the
contract's origin. Full trace of the mechanism, the before/after production
distributions, and what was explicitly deferred (THIN, not DEGENERATE,
findings on `eligibility_scoring`/`ag-29-fundability` — a suspected
LLM-prompt-calibration effect with no single traced code cause, left for a
future pass once volume grows): `STATE_OF_THE_BUILD.md`'s "AR-17.5" section;
`AGENTS_v2.md`'s "AR-17.5" section; `test-evidence/AGENT_OUTPUT_QUALITY_SCORING.md`
(the AR-17.2 diagnosis this contract responds to).
