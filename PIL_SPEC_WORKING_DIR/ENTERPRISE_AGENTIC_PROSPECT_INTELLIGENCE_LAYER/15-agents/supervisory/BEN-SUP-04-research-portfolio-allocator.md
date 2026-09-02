# BEN-SUP-04 — Research Portfolio Allocator

**Specification ID:** PIL-AGENT-BEN-SUP-04  
**Version:** 2.0.0  
**Family:** Supervisory and Orchestration  
**Default autonomy:** A3 — Autonomous Reversible Execution  
**Human boundary:** Budget increases, strategy changes, policy exceptions, irreversible actions  
**Platform boundary:** Domain-configurable core

## Chain-It directive

Implement a durable portfolio-allocation agent plus deterministic scoring, budget, policy, state, API, event, evaluation, observability, and recovery support. Read cumulative specifications and repository instructions; map requirements; preserve user changes; never invent weights, endpoints, costs, benchmarks, or passing tests.

Claude Code must proceed through repository discovery, requirements traceability, architecture reconciliation, schemas, migrations, workflow implementation, deterministic optimizer integration, tests, remediation, operational documentation, and final evidence collection. A prose-only implementation, one model call, scheduled ranking query, or static score sort is a blocking failure.

Before mutation, produce a repository-specific interaction map identifying the owners of goal state, portfolio state, opportunity state, agent registry, policy decisions, budget reservations, workflows, events, audit, evidence, models, and operator approvals. Unknown dependencies remain explicit blockers; they are never replaced with imagined modules or endpoints.

## Mission

Continuously allocate an approved research budget across candidate prospects and research gaps so the next unit of time, money, model capacity, or provider access produces the greatest expected decision-useful intelligence. Balance breadth and depth; deepen promising cases; suspend weak or sufficiently researched cases; preserve exploration; prevent starvation, loops, and unlimited investigation.

## Boundary

BEN-SUP-04 chooses **where research resources go**. BEN-SUP-02 defines strategy, BEN-SUP-03 builds task topology, specialists research, BEN-SUP-01 owns the tenant goal, and deterministic services enforce budgets/policy. It cannot raise budgets, change strategy/weights/policy, perform research, certify evidence, qualify prospects, or initiate outreach.

## Inputs

- goal, strategy, portfolio, and execution-plan versions;
- candidates/opportunities with evidence gaps, qualification uncertainty, relationships, timing, and priority;
- completed/active/failed tasks and work fingerprints;
- calibrated historical research yield and human corrections;
- remaining/reserved budgets, provider capacity, agent health, deadline, and cost forecasts;
- tenant/domain allocation policy including weights, exploration floor, fairness, minimum/maximum depth, and stop thresholds;
- policy/autonomy/kill-switch snapshot.

## Outputs

`PortfolioAllocationPlan.v1`, `AllocationDecision.v1`, budget reservation/release commands, `CandidateDeepened`, `CandidateSuspended`, `CandidateReopened`, `ResearchReprioritized`, and escalation events. Every decision records alternatives, normalized factors, configured weights, uncertainty, sensitivity, expected information gain, expected cost, reason codes, evidence/input refs, policy version, and trace.

## Typed contracts

### PortfolioAllocationGoal.v1

Required fields: `allocation_goal_id`, `tenant_id`, `domain_pack_id`, `parent_goal_id`, `strategy_id`, `portfolio_id`, `objective`, `success_criteria`, `stop_conditions`, `budget_envelope`, `allocation_policy_id`, `policy_snapshot_id`, `autonomy_ceiling`, `deadline`, `created_at`, and `version`.

### PortfolioObservation.v1

Required fields: `observation_id`, tenant/domain/goal/portfolio versions, candidate snapshots, evidence gaps, active work fingerprints, child-task states, qualification and critic decisions, provider/agent capacity, budget availability/reservations/usage, deadlines, monitoring triggers, policy/configuration/kill-switch versions, input hashes, `observed_at`, and `trace_id`.

The deterministic observation builder must reject mixed tenant, inconsistent aggregate versions, unknown currency, negative available budget, untraceable factor values, and stale policy snapshots. Model-generated summaries cannot replace canonical references.

### CandidateAllocationVector.v1

Required fields: `candidate_id`, `opportunity_id`, `factor_values`, `factor_confidence_intervals`, `evidence_refs`, `open_gap_refs`, `active_work_refs`, `estimated_action_set`, `estimated_information_gain`, `estimated_decision_change_probability`, `estimated_cost_distribution`, `deadline_urgency`, `redundancy_score`, `exploration_value`, `risk_flags`, `eligibility_state`, `last_material_change`, and `version`.

Every factor includes value, unit/scale, source type (`DETERMINISTIC`, `CALIBRATED_MODEL`, `HUMAN_APPROVED`), estimator version, evidence/input references, confidence interval, freshness, and missingness reason. Missing values are not silently converted to zero.

### AllocationAlternative.v1

Required fields: `alternative_id`, `epoch_id`, selected candidate/action pairs, per-action reservations, expected portfolio utility distribution, exploration share, concentration measures, constraint slack, critical assumptions, sensitivity results, risks, and rejected/selected status.

### PortfolioAllocationPlan.v1

Required fields: `plan_id`, `epoch_id`, tenant/domain/goal/portfolio IDs, immutable input observation, selected alternative, allocation actions, reservation set, cancellation/release set, monitoring conditions, success/stop/escalation conditions, expected outcome distribution, policy snapshot, `created_at`, and version.

### AllocationDecision.v1

Required fields: `decision_id`, `epoch_id`, decision type, subject, alternatives considered, selected action, deterministic optimizer result, model contribution, configured weights/constraints, sensitivity, rationale, evidence/input refs, policy/budget decision refs, uncertainty, limitations, and timestamp.

### Error contract

Stable categories: `INPUT_INVALID`, `STALE_VERSION`, `POLICY_DENIED`, `AUTHORITY_EXCEEDED`, `BUDGET_CONFLICT`, `INFEASIBLE_PORTFOLIO`, `ESTIMATOR_UNAVAILABLE`, `PROVIDER_CAPACITY_CHANGED`, `DUPLICATE_EPOCH`, `WORKFLOW_RECOVERY_REQUIRED`, `TENANT_MISMATCH`, and `SECURITY_INCIDENT`. Each error declares retryability; policy, authority, schema, and tenant failures are never blindly retried.

## Durable state machine

`CREATED → OBSERVING → ESTIMATING → GENERATING_ALTERNATIVES → OPTIMIZING → VALIDATING → RESERVING → PUBLISHING → MONITORING → EVALUATING → REPLANNING`.

Terminal/holding states: `SATISFIED`, `PAUSED`, `BLOCKED_POLICY`, `BLOCKED_HUMAN`, `FAILED_RECOVERABLE`, `FAILED_TERMINAL`, `CANCELLED`, and `SUPERSEDED`.

State invariants:

- observation, alternatives, decision, and plan are immutable versioned records;
- aggregate mutation and outbox event commit atomically;
- budget reservation completes before dispatch publication;
- failed publication does not lose reservations or duplicate dispatch;
- a new epoch requires a new material observation or registered periodic boundary;
- only one active allocation epoch exists per portfolio/version unless policy explicitly supports partitioned epochs;
- terminal epochs cannot mutate; reopening creates a successor;
- lease expiry permits safe continuation from durable state;
- cancellation propagates to planned-but-unstarted work and releases verified unused reservations.

## Authority calculus and human override

Effective authority is the deterministic intersection of registered A3 authority, global/domain/tenant policy, parent goal, strategy, task, budget entitlement, active human approval, provider entitlement, and kill-switch configuration. BEN-SUP-04 cannot alter any operand.

Permitted reversible actions: reserve/release existing approved research budget, reprioritize queued research, pause/cancel optional unstarted work, deepen within depth/budget policy, suspend candidates, and reopen on registered triggers.

H1 is mandatory for budget increase, allocation-policy or weight change, exploration/concentration override, strategy change, new provider/data purpose, or resuming work blocked by policy. H2 is mandatory for irreversible external effects. Human override records scope, reason, actor, expiration, affected epoch, and before/after allocation; silence is not approval. Overrides never authorize prohibited data or weaken global security/privacy policy.

## Durable loop

`GOAL → OBSERVE PORTFOLIO → GENERATE ALLOCATIONS → SCORE/SIMULATE → POLICY/BUDGET VALIDATE → RESERVE/RELEASE/QUEUE → OBSERVE YIELD → EVALUATE FORECAST → REPLAN`.

The agent must complete multiple cycles as evidence and costs arrive. It persists allocation epochs; duplicate epochs are idempotent; concurrent changes trigger optimistic-conflict re-observation.

## Allocation model

Use policy-configured, explainable dimensions, never universal invented weights:

- expected information gain;
- probability research changes a decision;
- opportunity relevance/value band;
- evidence gap severity;
- identity/contradiction risk;
- relationship/timing urgency;
- success probability and source feasibility;
- monetary, token, provider, time, and opportunity cost;
- redundancy/staleness;
- exploration value and uncertainty.

Deterministic code validates inputs and weights, computes base utility and confidence bounds, and performs sensitivity analysis. The model may estimate bounded factors with rationale; it cannot set policy weights.

### Optimization contract

The selected solver must support hard constraints, explicit infeasibility, deterministic replay for fixed inputs/version, and reason extraction. The implementation may use integer/linear, stochastic, bandit, or hybrid optimization only when the chosen formulation is documented and evaluated for the portfolio’s scale and uncertainty. A language model must not directly emit the final reservation set.

The objective is tenant/domain policy configured. A generic form is expected utility under uncertainty minus cost, risk, redundancy, and opportunity-cost penalties, subject to mandatory evidence, exploration, concentration, capacity, deadline, and budget constraints. This form is illustrative—not permission to invent coefficients.

For uncertain estimates, compute distributions or defensible bounds rather than false point precision. Apply scenario analysis for optimistic, expected, and adverse cases. Sensitivity analysis perturbs each configurable weight and material estimate within its registered range; unstable selections receive an explicit risk flag or human review threshold.

### Exploration and fairness safeguards

Exploration is designed to reduce model lock-in and feedback loops, not to satisfy demographic targeting. Policies define minimum/maximum exploration, candidate aging, starvation limits, maximum portfolio concentration, and diversity across permitted prospect/source classes. Protected traits are neither allocation factors nor proxy targets. The allocator must measure whether repeated downstream outcomes cause entrenched source or segment exclusion and emit governed review proposals.

## Portfolio constraints

- total reservations never exceed approved envelope;
- per-candidate, agent, provider, model, tenant, and concurrent-work limits apply;
- maintain configured exploration budget so novel candidates are not permanently starved;
- prevent one high-uncertainty prospect from consuming unlimited resources;
- independent corroboration is not penalized as duplicate when required;
- weak candidates normally receive shallow depth, qualified prospects moderate depth, and major/ambiguous prospects conditional deeper work—not quotas;
- required policy/evidence gates cannot be removed to save cost.

## Decisions

### Deepen

Additional research has high expected decision impact, feasible evidence paths, and acceptable marginal cost.

### Suspend

Expected marginal value is below threshold, sufficient evidence already exists, work is redundant, candidate is weak/ineligible, or higher-value work dominates. Suspension preserves state and monitoring triggers.

### Reopen

Material evidence, relationship, liquidity, role, giving, filing, geographic, policy, or human trigger changes expected value. Reopening requires reason and new allocation epoch.

### Stop portfolio research

Success criteria are met, remaining candidates are low-value, budget/deadline reached, policy blocks necessary work, or uncertainty cannot be reduced economically. Produce transparent partial outcome rather than inflate activity.

## Economics and reservations

Forecast descendant fan-out/retries and reserve atomically through the Cost Ledger. Commit actual usage, release unused budget on cancellation, reconcile provider invoices, and detect leaks. Soft thresholds trigger reallocation; hard thresholds block dispatch. Budget increase is H1.

Each reservation uses tenant, goal, portfolio, epoch, candidate/action, model/provider/tool, currency, maximum amount, expiry, idempotency key, and parent reservation. Monetary values use decimal minor units and ISO currency; tokens, tool calls, provider quotas, wall time, storage, and concurrency remain separate dimensions and cannot be exchanged without policy.

Reconciliation compares estimate, reservation, committed usage, provider invoice where applicable, released amount, and variance reason. Unexplained leakage activates a scoped kill switch and blocks new dispatch. Cached/reused evidence receives cost credit only when tenant, purpose, license, freshness, and output contract permit reuse.

## Persistence and database requirements

Required logical tables/collections: `allocation_goals`, `allocation_epochs`, `portfolio_observations`, `candidate_allocation_vectors`, `allocation_alternatives`, `allocation_plans`, `allocation_decisions`, `allocation_actions`, `allocation_reservation_links`, `suspension_records`, `reopen_triggers`, `optimizer_runs`, `sensitivity_runs`, `human_overrides`, and transactional `outbox`/consumer `inbox`.

Every record contains tenant key, opaque ID, schema version, timestamps, policy/configuration/model/estimator versions, trace/correlation IDs, and retention class. Mutable aggregates use optimistic versions. Foreign keys include tenant ID. Row-level or equivalent authorization defaults to deny. Audit and evidence are append-only. Indexes support tenant+portfolio+status, open triggers, active epoch uniqueness, idempotency, deadlines, and recovery without creating cross-tenant identifiable indexes.

Migrations require forward/backward compatibility plan, online/backfill strategy, tenant-scoped verification, rollback or compensating migration, data-volume test, and recovery checkpoint. No migration assumes a single worker or maintenance window unless explicitly approved.

## APIs, commands, and events

Minimum API-equivalent operations:

- create/validate/activate allocation goal;
- inspect portfolio observation, alternatives, plan, decision, reservations, and sensitivity;
- pause/resume/cancel/supersede epoch;
- approve/reject scoped override;
- inspect suspended candidates and triggers;
- initiate privileged replay-safe recovery.

Mutations require authenticated workload/human identity, server-derived tenant, idempotency key, expected version, policy snapshot, and trace. List/query operations are bounded and paginated.

Required events include `AllocationGoalActivated`, `PortfolioObserved`, `AllocationAlternativesGenerated`, `PortfolioOptimizationInfeasible`, `AllocationPlanValidated`, `BudgetReservationRequested/Confirmed/Denied`, `ResearchReprioritized`, `CandidateDeepened/Suspended/Reopened`, `AllocationEpochPublished`, `YieldObserved`, `AllocationForecastMissed`, `AllocationReplanningStarted`, `AllocationEpochSuperseded`, `BudgetLeakDetected`, and `AllocationBlocked`. All use the canonical event envelope and compatibility tests.

## Replanning triggers

New/contradictory evidence; qualification or critic decision; research-yield deviation; cost/rate/provider change; agent degradation; deadline; strategy/policy version; human correction; monitoring trigger; duplicate work; budget threshold; or material change in sensitivity ranking.

## Failure and recovery

- stale portfolio/version conflict: re-observe and recalculate;
- reservation conflict: never overcommit; retry calculation, not blind reservation;
- missing/unreliable factor: widen uncertainty and favor bounded information-gathering or escalate;
- provider/agent unavailable: recompute feasible frontier;
- worker loss: resume from persisted epoch/reservations;
- duplicate event: return prior decision;
- budget leak: stop new work, reconcile, alert;
- policy denial: remove route and replan, no unchanged retry;
- cross-tenant signal: quarantine/security incident.

Recovery begins from aggregate, reservation, outbox/inbox, task, and audit truth. It verifies whether each allocation action was only planned, reserved, published, accepted, started, or completed. Resume/replay is allowed only with idempotency proof. Derived ranking/optimizer state may be rebuilt; evidence and historical decisions are preserved. BEN-SUP-06 investigates corrupted or ambiguous recovery. After recovery, independently validate budget conservation, exactly/effectively-once dispatch, portfolio version, task topology, and audit completeness.

## Memory and learning

Goal memory stores epochs, forecasts, outcomes, reasons, and suspended triggers. Fleet learning supplies governed estimates only. Outcomes may propose recalibration; no silent weight, policy, autonomy, or production routing change.

Estimator changes require versioned training data lineage, offline evaluation, leakage/contamination checks, calibration by relevant domain segments, human approval when policy requires, shadow/canary deployment, monitoring, and rollback. Outcomes cannot overwrite historical factor estimates. The current allocation always records the exact estimator/model version.

## Security and audit

Use reference-based minimum context, verified tenant and purpose, default-deny policy, no provider credentials, no sensitive/protected targeting, and append-only decision/budget audit. Retrieved content cannot change allocations or authority directly.

Threat model includes prompt injection through candidate/evidence text, manipulated factor inputs, extreme/NaN values, forged approvals, stale policy/configuration, budget replay, tenant-ID substitution, side-channel telemetry, optimizer denial-of-service, explosive fan-out, poisoning of outcome learning, and unauthorized override. Validate and normalize all factors outside the model; cap input sizes; sandbox solver resources; sign internal envelopes; redact logs/traces; rotate short-lived credentials; and test every storage/cache/queue boundary for tenant isolation.

## Observability

Metrics: research cost per qualified prospect, marginal yield, forecast error, breadth/depth, suspension/reopen, exploration share, starvation, concentration, redundancy, budget utilization/leak, provider/model mix, critic overturn, human correction, and outcome lift by allocation version.

Traces: observe, factor-estimate, alternatives, score, sensitivity, constraint-solve, authorize, reserve, queue, release, evaluate-yield, reallocate, suspend, reopen, terminate.

Dashboards must expose current epoch, portfolio budget conservation, selected/rejected alternatives, confidence bounds, unstable sensitivity, exploration/concentration/starvation, forecast-versus-actual yield, reservations/usage/releases, suspended/reopen queue, policy denials, overrides, provider/agent health, failures, and recovery. Alerts require actionable owner/runbook links and avoid identifiable high-cardinality metric labels.

SLOs are set from measured product requirements. The specification invents no latency or throughput target. Define and load-test declared portfolio size, candidate count, allocation cadence, concurrent tenants, update/event rate, optimizer deadline, and recovery objective before production certification.

## Implementation artifacts

Create schemas and migrations; durable allocation workflow; factor/uncertainty registry; deterministic constrained optimizer and sensitivity engine; budget integration; APIs/events; operator portfolio view with reason codes and override workflow; audit/metrics/traces; ADRs/runbook; and complete test suite.

The runbook covers optimizer infeasibility/timeouts, stale observations, reservation conflict/leak, outbox failure, provider capacity collapse, estimator degradation, excessive concentration/starvation, kill switch, human override, cross-tenant incident, rollback, and disaster recovery. ADRs justify solver/formulation, uncertainty treatment, cadence, storage consistency, event ordering, and exploration policy.

## Tests

### Unit/property

- allocations never exceed budgets under concurrency;
- weights are policy sourced and normalized;
- rankings reproducible for fixed inputs;
- sensitivity identifies unstable rankings;
- exploration floor and concentration caps hold;
- cancellation releases reservations;
- suspended candidates preserve triggers;
- child authority cannot widen.

- total committed plus reserved plus released conserves the parent budget;
- missing/NaN/infinite/out-of-range factors fail or use declared missingness policy;
- infeasible optimization returns explicit infeasibility, never a partial unauthorized allocation;
- immutable epochs and decisions cannot be rewritten;
- only one active epoch exists per portfolio/version;
- all selected actions map to a strategy requirement and registered capability;
- hard evidence/policy constraints dominate utility;
- sensitivity results are reproducible and flag policy-defined instability;
- exploration and concentration constraints hold across generated portfolios;
- work reuse requires tenant/purpose/license/freshness compatibility.

### Contract/integration/end-to-end

- command, event, schema, and producer/consumer compatibility;
- policy decision expiry between planning and reservation;
- cost-ledger atomic reservation under competing allocators;
- workflow/outbox/inbox effectively-once publication;
- task cancellation and reservation release;
- critic/qualification/monitoring events trigger correct epoch behavior;
- operator override approval, expiry, rejection, and audit;
- point-in-time reconstruction of any allocation;
- full objective-to-observation-to-plan-to-yield-to-replan flow.

### Agentic scenarios

1. From 370 prospects, 42 become sufficient; broad low-value work suspends and relationship research receives budget for top 15.
2. Major prospect gains credible liquidity trigger; candidate reopens and deepens.
3. Wealth signal without propensity evidence receives targeted giving research, not automatic priority.
4. Cost spike makes a provider infeasible; portfolio reallocates without weakening evidence policy.
5. Critic rejects top candidate; bounded gap research is funded and redundant branches remain suppressed.
6. Budget halves mid-run; optional work cancels, reservations reconcile, mandatory gates remain.
7. Sparse new candidates receive exploration allocation without displacing all high-value exploitation.
8. Forecasts consistently overstate yield; controlled recalibration proposal is emitted, not self-applied.

### Security/reliability/adversarial

Cross-tenant candidate injection; manipulated values/extreme weights; prompt injection; forged budget/approval; duplicate/concurrent epochs; worker death at reservation/queue/release; provider outage; kill switch; cost-ledger inconsistency; starvation/fan-out/loop attack.

Execute worker/process death before and after observation persistence, optimizer result, validation, reservation, aggregate/outbox commit, publication, child acceptance, cancellation, release, reconciliation, and replan. Inject delayed/reordered/duplicate/missing events; network partitions; database failover; provider throttling; model invalid output; solver timeout/resource exhaustion; cache corruption; and backup restore. Prove no budget overcommit, duplicate dispatch, lost decision/evidence, or cross-tenant disclosure.

## Agent-specific evaluation dataset

Maintain versioned blinded cases including:

1. large noisy pool with a small evidence-sufficient subset;
2. high-value/high-uncertainty prospect with diminishing returns;
3. documented wealth but absent giving propensity;
4. modest capacity with strong repeated giving and relationship;
5. new sparse candidates requiring exploration;
6. stale/circular evidence that appears high-confidence;
7. policy-prohibited attractive source;
8. provider price/rate shock;
9. mid-epoch budget reduction;
10. critic rejection and targeted remediation;
11. deadline-driven foundation opportunity;
12. cross-tenant poisoned candidate;
13. manipulated extreme factors/optimizer attack;
14. outcome-feedback drift and proposed recalibration;
15. no feasible allocation under mandatory gates.

Score allocation regret against a policy-defined oracle where feasible, decision-change yield, cost per evidence-sufficient/qualified prospect, calibration/forecast error, precision of deepen/suspend/reopen, exploration discovery yield, starvation/concentration, policy violations, human override/correction, critic overturn, recovery correctness, and outcome lift. Report uncertainty and evaluator disagreement; do not hide negative cases.

## Load, scale, and chaos certification

Benchmark declared tenant and portfolio distributions, not a single average case. Exercise hot tenants, large portfolios, frequent triggers, simultaneous epochs, provider degradation, and model/optimizer fallbacks. Measure queue lag, allocation staleness, solver timeouts, reservation contention, database/index behavior, memory/context size, telemetry volume, and recovery time. Capacity claims require reproducible environment/configuration and raw result artifacts.

Chaos experiments verify kill-switch containment, workflow resumption, budget reconciliation, outbox recovery, read-model rebuild, regional/dependency failure, and audit continuity. Define abort thresholds to protect real data and cost.

## Acceptance gates

Reject unless executed evidence proves durable multi-cycle reallocation, explainable alternatives and sensitivity, policy-owned weights, constrained budgets, economic stopping, exploration and anti-starvation, restart/duplicate/concurrency safety, tenant isolation, audit/observability, and independent score ≥95/100 with all blocking gates.

Additionally, no production verdict is permitted without schema/contract compatibility, optimizer correctness/infeasibility, policy TOCTOU, budget conservation, human override, security/privacy, cross-tenant, prompt injection, load/scale, chaos/recovery, backup/restore, monitoring/runbook, and rollback gates. An independent evaluator—not BEN-SUP-04—calculates the score from executed evidence.

## Final report

Return requirement traceability, code/migrations/rollback, actual test and evaluation results, full allocation/reallocation trace, budget reconciliation, security/tenant proof, load evidence where executed, assumptions/risks, and verdict. Never claim production readiness on skipped, simulated, assumed, or failing gates.

Required machine-readable totals include tests passed/failed/skipped, blocking gates, dataset/evaluator/model/optimizer/policy versions, coverage, load profile/results, security findings, open defects, score calculation, residual risks, approvals, and exact revision identifiers. Verdict remains `NOT_READY` until evidence exists; this specification itself does not confer a production score.
