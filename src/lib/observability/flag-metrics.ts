// Per-variant metrics for the `pil-autoapply-source` flag
// (queue-feature-flags-pil-rollout-REAL.yaml, id: monitoring-and-metrics-by-flag)
// -- lets the canary/GA rollout phases in that same file's `rollout-schedule`
// entry compare the "dossiers" variant against the "prospects" baseline and
// catch degradation before it reaches 100% of orgs.
//
// Deviations from the task's own illustrative sketch, and why:
//
// 1. Registration: the sketch does `new Counter(...)` at module scope. This
//    codebase's actual metrics module (src/lib/observability/metrics.ts) had
//    to work around Next.js re-evaluating modules on hot reload, which throws
//    prom-client's "metric already registered" error on the second load --
//    see that file's header. Reusing its exported `counter`/`histogram`
//    helpers here instead of duplicating that workaround.
//
// 2. Outcome granularity: the sketch's `success` label is boolean. The real
//    dossiers path (populateFromDossiers in queue-populator.ts) legitimately
//    returns early with a `skippedReason` ("no_research_runs_yet",
//    "no_priority_scores_yet", "blocked_by_policy") for orgs that simply have
//    no PIL data yet -- that's not degradation, and counting it as an error
//    would let a handful of not-yet-onboarded orgs trip the >10% auto-revert
//    threshold for everyone. `outcome` is `success | error | skipped` instead
//    of a boolean so the alert below can distinguish real failures from that.
//
// 3. Where it's wired in: the sketch shows an inline `if (source ===
//    'dossiers')` block "in the queue populator." The actual variant switch
//    happens once, in `populateSubmissionQueue()`, which dispatches to
//    *either* populateFromDossiers or populateFromProspects. Instrumentation
//    is wired around that dispatch (both branches) rather than only the
//    dossiers branch, so the two variants are actually comparable -- a
//    prospects-only view can't show whether dossiers is degrading relative to
//    the baseline it's meant to replace.
//
// 4. No separate `pilErrorRate`/per-agent metric: `agentRunDuration` and
//    `agentEventsLogged` (src/lib/observability/metrics.ts) already record
//    every BEN-APP-03 run from inside AgentRunner (src/lib/pil/agent-runner.ts),
//    including its `status` and duration. A new counter at the dispatch level
//    would double-count the same agent failures under a different metric
//    name. Only the missing view -- per-source-variant outcome and latency,
//    covering both the agent-backed dossiers path and the plain-query
//    prospects path -- is added here.
//
// 5. `error.type` in the sketch's catch block doesn't compile: caught errors
//    are `unknown` by default. Not needed here anyway, since this module only
//    records outcome + duration and lets the error propagate (see deviation
//    3 in queue-populator.ts's own header for why populateSubmissionQueue
//    doesn't swallow errors).

import { counter, histogram } from "./metrics";

export const autoapplySourceRun = counter({
  name: "benavora_autoapply_source_run_total",
  help: "AutoApply queue-populate runs by pil-autoapply-source flag variant and outcome",
  labelNames: ["source", "outcome"], // source: prospects | dossiers; outcome: success | error | skipped
});

export const autoapplySourceRunDuration = histogram({
  name: "benavora_autoapply_source_run_duration_ms",
  help: "AutoApply queue-populate wall time by pil-autoapply-source flag variant",
  labelNames: ["source"],
  // Upper end past the sketch's 30s: the dossiers path re-derives from
  // already-computed scores (no model calls, budget: 0) but still sweeps
  // every prospect in the org, so a large org's run can run longer.
  buckets: [100, 500, 1000, 5000, 15000, 30000, 60000],
});
