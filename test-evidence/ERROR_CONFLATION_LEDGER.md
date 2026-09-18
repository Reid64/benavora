# AR-11.2 — Error/Empty Conflation Ledger

AR-7.3 fixed 16 sites where a caught error's real cause was discarded before
being logged. It explicitly left open a broader class: `if (error || !data)`
and its variants, which treat a genuine database failure and a legitimate
empty result as the same outcome. This sweep covered `src/lib/agents`,
`src/lib/pil`, `src/lib/autoapply`, and both worker trees (`worker/` and
`src/worker/jobs/`, since the latter is dispatched into by the former via
`await import()` and is equally "worker" code).

## Counts

- **Before:** 46 sites matched `if (error || !data)` or a named-variable
  equivalent (`if (fooError || !fooData)`, `if (error !== null || data ===
  null)`, etc.) across 22 files in the four scoped directories.
- **Found during the fix (re-grepped per file, not in the original count):**
  9 additional sites of the identical shape in the same files — several
  where `error` wasn't even destructured from the query result, which is a
  strictly worse case of the same defect (the error never reached a branch
  at all, conflated or otherwise).
- **Total addressed:** 55 sites, across 31 files.
- **After:** 0 sites matching `if (error || !data)` or a named-variable
  equivalent remain in the four scoped directories (verified by re-running
  the sweep's own grep pattern against all four after the fix — zero hits).
- **Left unconverted (different defect shape, out of scope, listed below):**
  10 sites — `error` discarded by omission (never destructured, never
  checked at all), not the `if (error || !data)` branch-conflation this task
  targeted. Real gap, but a distinct fix (add an error check where none
  exists at all) rather than "separate a conflated branch."

## Resolution key

- **SEPARATED-THROW** — the error branch now logs via `causeOf`/`withCause`
  and throws (`AgentError` inside a `BaseAgent` subclass, plain `Error`
  otherwise), distinct from the empty-data branch, which keeps its original
  return value.
- **SEPARATED-RETURN** — same split, but the error branch returns a
  distinguishable result to the caller instead of throwing (matches an
  established convention already in that file).
- **CONFLATED-JUSTIFIED** — both branches still produce the same outcome
  (documented best-effort/fail-open functions: a nightly sweep with nothing
  pending, a documented fallback, a non-fatal enhancement lookup) — but the
  error is now always logged distinctly via `causeOf`/`withCause` before
  falling through, so it no longer vanishes silently. This is the accepted
  "some sites genuinely want treat both as nothing to do" case, on the
  condition that the error is visible in logs.

## Sites addressed

### src/lib/agents (36 sites)

| file | site(s) | resolution |
|---|---|---|
| ag-22-propensity-scoring.ts | `fetchFullProspect`, `refreshPriorityRanking` | SEPARATED-THROW ×2 |
| corporate-enrichment-shared.ts | `fetchProspect` | SEPARATED-THROW |
| deadline-prediction-agent.ts | `loadCalibrationSummary` | SEPARATED-THROW |
| deadline-prediction-agent.ts | duplicate-opportunity check (error previously undestructured; found during re-grep) | SEPARATED-THROW |
| deadline-prediction-agent.ts | insert-and-read-back after `insertError \|\| !inserted` | CONFLATED-JUSTIFIED (both branches are genuine failures, not error-vs-empty; now logged via `causeOf`) |
| change-monitor-agent.ts | `loadFoundationScope` | CONFLATED-JUSTIFIED (mirrors already-fixed sibling `loadProspectScope`; daily scan, no false action on a miss) |
| autonomous-base.ts | `logDecision`, `startRun` | SEPARATED-THROW ×2 |
| autonomous-base.ts | `getOrgConfig` (error previously undestructured; found during re-grep) | CONFLATED-JUSTIFIED (fails closed to `SAFE_DEFAULT_CONFIG`, now logged) |
| autonomous-digest-agent.ts | `collectStrategicRecommendations` | SEPARATED-RETURN (matches file's own convention in 6 sibling `collect*` methods) |
| autonomous-digest-agent.ts | `resolveOutstandingLog` | CONFLATED-JUSTIFIED (doc-commented: must never block the nightly digest) |
| autonomous-digest-agent.ts | `recalculateWeights` | CONFLATED-JUSTIFIED (adaptive-learning tick, same rationale) |
| eligibility-scorer.ts | opportunity fetch, application fetch (2nd found during re-grep) | SEPARATED-THROW ×2 |
| final-assembly.ts | application fetch, opportunity fetch (2nd found during re-grep) | SEPARATED-THROW ×2 |
| review-agent.ts | application fetch, opportunity fetch (2nd found during re-grep) | SEPARATED-THROW ×2 |
| semantic-matching.ts | org profile fetch | SEPARATED-THROW |
| email-parser.ts | insert-then-select on `email_activity` | SEPARATED-THROW (both branches still throw `write_failed`; error branch now carries real cause) |
| relationship-graph-builder-agent.ts | `ensurePigNode`, `loadOrg` | SEPARATED-THROW ×2 |
| relationship-builder-agent.ts | `ensurePigNode`, `computeFunderReadiness`, `computeOpportunityValue` | SEPARATED-THROW ×3 |
| roi-optimizer-agent.ts | `getSubmissionRecommendations` | CONFLATED-JUSTIFIED (optional enhancement; worst case a draft lacks ROI hints, no wrong action taken) |
| self-improvement-agent.ts | `startRun` | SEPARATED-THROW |
| self-improvement-agent.ts | `checkDuplicate` | CONFLATED-JUSTIFIED (worst case one extra proposal for human review, per the file's own hard-limit design) |
| research/government-grants.ts | `applyKbFilter`, `applyReflectionFilter` | CONFLATED-JUSTIFIED ×2 (documented fail-open design: "cannot judge must never mean reject"; `applyReflectionFilter` had zero prior logging, now has `causeOf`) |
| draft-generation-agent.ts | opportunity fetch | SEPARATED-THROW |
| follow-up-generator.ts | application fetch, opportunity fetch | SEPARATED-THROW ×2 |
| nofa-parser.ts | opportunity fetch | SEPARATED-THROW |

### src/lib/pil (2 sites)

| file | site(s) | resolution |
|---|---|---|
| model-pricing.ts | rate-card lookup | CONFLATED-JUSTIFIED (file documents a stale-cache-beats-no-pricing fallback; now logged) |
| tools/irs-990-tool.ts | `lookupFoundationDirectory` | CONFLATED-JUSTIFIED (first leg of a documented two-source waterfall that falls through to ProPublica; now logged) |

### src/lib/autoapply (10 sites)

| file | site(s) | resolution |
|---|---|---|
| confirmation-monitor.ts | candidate-window query | SEPARATED-THROW (error) / SEPARATED-RETURN (empty) |
| email-submitter.ts | send-result check | SEPARATED-THROW (both branches still throw — a null result with no error is itself anomalous for a send call — but now with distinct causes) |
| document-vault.ts | insert-and-return-id, storage download | SEPARATED-THROW ×2 (both branches still throw — no legitimate "empty" case for either — but now with distinct causes) |
| ab-testing.ts | `getVariant`, `recordOutcome`, `checkForWinner`, `getTestResults` (last 2 found during re-grep) | CONFLATED-JUSTIFIED ×4 (documented best-effort variant selection; `error` was not even being destructured in any of the four — now captured and logged via `causeOf`, swallow-to-default behavior unchanged) |

### worker/ + src/worker/jobs/ (14 sites)

| file | site(s) | resolution |
|---|---|---|
| worker/stream-server.ts | WebSocket auth check | SEPARATED (error logged distinctly; both still close the socket — no legitimate reason to accept a connection after either outcome) |
| worker/queue-processor.ts | submission insert | SEPARATED-THROW |
| worker/heartbeat.ts | `incrementProcessed`, `incrementFailed` | CONFLATED-JUSTIFIED ×2 (best-effort counter ticks, not queue items; already logged before this sweep — upgraded to `causeOf` and split into two distinguishable log branches) |
| src/worker/jobs/score-donor-prospect.ts | claim, prospect fetch, request fetch, taxonomy lookup | SEPARATED-THROW ×3, CONFLATED-JUSTIFIED ×1 (taxonomy lookup has a documented raw-id fallback) |
| src/worker/jobs/run-connector-enrichment.ts | prospect load, directory load, active-key resolve, claim scan, per-candidate scan (last 2 found during re-grep) | SEPARATED-THROW ×4, SEPARATED-RETURN ×1 (per-candidate scan `continue`s to the next connector rather than aborting the whole claim on one connector's transient error) |
| src/worker/jobs/process-discovery-request.ts | job handler | SEPARATED-THROW |

## Left unconverted — different defect shape, not fixed here

These sites discard `error` by never destructuring/checking it at all — the
error doesn't reach a *conflated* branch, it never reaches any branch. Same
family of bug (a real failure is invisible), but the fix is "add a check
where none exists," not "separate an existing conflated check," which is a
larger, more error-prone class of edit than this task's scope. Flagged by
the agents who found them while fixing the named sites in the same files;
left in place rather than fixed speculatively under time pressure.

| file | site | reason left unconverted |
|---|---|---|
| src/lib/agents/autonomous-digest-agent.ts | `isPlatformOwnerOrg` (~line 695) | `error` never destructured from the query result |
| src/lib/agents/autonomous-digest-agent.ts | `resolveBucket`'s 5 per-item-type lookups (~801/817/834/850/866) | same — `error` never destructured across all 5 |
| src/lib/agents/autonomous-digest-agent.ts | `existingApps` sub-query (~473) | same |
| src/lib/agents/autonomous-digest-agent.ts | `digest_priority_weights` upsert (~944) | same |
| src/lib/autoapply/document-vault.ts | `getDocument` (~105) | same — task's assignment for this file was literally scoped to the two named `if (error || !data)` sites |
| src/lib/autoapply/document-vault.ts | `getAllDocuments` (~129) | same |

Recommended follow-up: a dedicated sweep for "`error` destructured-but-never-
checked" and "`error` never destructured at all" across the same four
directories — a related but distinct pattern from the one this task fixed.
