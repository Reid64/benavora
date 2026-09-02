# BEN-SUP-03 — Cross-Agent Research Planner

**Specification ID:** PIL-AGENT-BEN-SUP-03  
**Version:** 2.0.0  
**Family:** Supervisory and Orchestration  
**Default autonomy:** A4 — Policy-Bounded Autonomous Execution  
**Human boundary:** Actions outside research authority, new policy/provider/data purpose, budget increase, consequential operational action  
**Platform boundary:** Generic core; domain behavior arrives through a versioned Domain Pack
**Maximum delegation depth:** 3
**Implementation status:** Specification remediated; production readiness requires executed G0–G5 evidence

## 0. Chain-It implementation directive

Implement a durable dependency-aware planning agent, not a prompt that emits a checklist. Read every cumulative release file and the target repository instructions, map requirements to existing code, preserve user changes, and continue through schemas, migrations, runtime, tests, remediation, observability, ADRs, and runbooks. Never invent provider endpoints, credentials, permissions, benchmarks, or test results.

## 1. Mission

Convert an approved `ResearchStrategy.v1` into an executable, policy-valid, budget-reserved, dependency-aware multi-agent plan. Decompose objectives, choose specialists, identify parallel work, establish dependencies and joins, assign bounded budgets, prevent duplicate research, define success/stop/escalation conditions, manage recursion, and preserve recovery semantics.

BEN-SUP-03 owns execution topology. BEN-SUP-02 owns research strategy; BEN-SUP-04 owns portfolio allocation across prospects; specialist agents own their reasoning domains; deterministic services own enforcement and execution primitives.

## 2. Success definition

A plan succeeds as a planning artifact when:

- every strategy requirement maps to one or more typed plan nodes;
- every node has available inputs or explicit dependencies;
- critical research can run in parallel without violating ordering or evidence integrity;
- joins define completeness and partial-result behavior;
- agent/tool selections are registered, authorized, and evaluation-eligible;
- budgets reserve without overcommit;
- critic independence and identity-before-consequence ordering are enforced;
- every path terminates or escalates;
- replay, cancellation, recovery, and replanning are safe;
- a downstream durable workflow can execute without guessing.

## 3. Inputs

- validated `Goal.v1` and `ResearchStrategy.v1`;
- Domain Pack snapshot defining ontology, agent capability mappings, qualification and evaluation rules;
- tenant/policy/autonomy snapshot using `GLOBAL → DOMAIN → TENANT → GOAL → TASK` precedence;
- agent registry and current production eligibility;
- tool/service capability registry;
- canonical graph/evidence/research state references;
- budget availability and cost estimates;
- provider health/rate limits where planning-relevant;
- prior task fingerprints, active workflows, cached permitted evidence, and outcome history;
- deadline, human approvals, and kill-switch/configuration state.

Reject on tenant/domain mismatch, invalid strategy, expired policy, unregistered required capability, missing success/stop criteria, or authority above A4.

## 4. Outputs

Primary output is `ExecutionPlan.v1` from PIL-PLAN-010. Supporting outputs:

- `PlanAlternativeSet.v1`;
- `CapabilitySelectionDecision.v1`;
- `RedundancyDecision.v1`;
- `BudgetReservationSet.v1`;
- `PlanValidationReport.v1`;
- `PlanCreated`, `PlanAuthorized`, `PlanRevised`, `PlanRejected`, `PlanSuperseded` events;
- typed `DelegatedTask.v1` instances created only after plan authorization and atomic reservation.

## 5. Non-responsibilities

The planner does not research prospects, resolve facts, modify evidence, change strategy, set tenant priorities, grant permissions, create providers, make qualification judgments, or certify child results. It may identify a missing strategic decision and return to BEN-SUP-02 rather than guess.

## 6. Durable agentic loop

1. **Goal:** load the durable planning objective and unresolved requirements.
2. **Observe:** snapshot strategy, existing state, capability health, active/duplicate work, budgets, policy, deadlines, and prior outcomes.
3. **Plan:** decompose into outcome-oriented work packages and generate materially distinct DAG alternatives.
4. **Select:** compare topology, critical path, evidence coverage, cost, risk, latency, redundancy, and recoverability.
5. **Authorize:** validate schema, policy, authority, budgets, critic independence, and terminal reachability deterministically.
6. **Act:** persist immutable plan version, reserve budgets, and queue authorized root nodes through the workflow engine.
7. **Evaluate:** observe validation/execution signals; determine whether topology remains sufficient.
8. **Replan:** supersede the plan when dependencies, evidence, failures, policy, strategy, cost, or deadlines materially change.
9. **Terminate:** publish, pause, block, supersede, fail, or satisfy planning objective explicitly.

## 7. Decomposition method

Decompose by decision-enabling outcome, not by arbitrary document section. For a typical prospect investigation, a Domain Pack may yield:

- seed/candidate validation;
- entity resolution gate;
- parallel individual, employment, business, foundation, board, giving, geography, and news intelligence;
- evidence/provenance verification;
- contradiction investigation where triggered;
- graph relationship construction and warm-path analysis;
- affinity, capacity/propensity, eligibility, timing, and opportunity qualification;
- independent critic gate;
- engagement/next-action strategy;
- monitoring and learning hooks.

Not every candidate invokes every branch. Optional nodes need explicit information-gain hypotheses and cancellation rules.

## 8. Dependency laws

- Identity resolution precedes attaching consequential claims across ambiguous records.
- Source capture precedes claim verification.
- Claims/edges precede qualification based upon them.
- Critic review follows consequential synthesis and is context-independent.
- Strategy work follows required qualification gates.
- CRM synchronization follows canonical persistence and policy authorization.
- A node cannot consume outputs not named in an incoming dependency/data reference.
- Cycles are forbidden except registered bounded iteration with maximum attempts, budget, improvement threshold, and exit.

## 9. Parallelism and joins

Parallelize independent branches only when shared mutable state is protected by versioning and evidence remains immutable. Choose explicit join mode:

- `ALL_REQUIRED` for mandatory evidence families;
- `QUORUM(n)` for independent corroboration;
- `FIRST_SUFFICIENT` for alternative permitted sources with a defined sufficiency function;
- `DEADLINE_BEST_EFFORT` for optional enrichment where transparent partial output is allowed.

Every join specifies deadline behavior, cancellation of remaining optional work, missing-output representation, and budget reconciliation.

## 10. Capability selection

Select agents by distinct reasoning responsibility, permitted data/tools, domain compatibility, output contract, evaluation status, calibrated quality, cost/latency, health, and conflict-of-interest constraints. Never select a generalist merely to reduce agent count when a registered specialist is required.

Model performance history may inform selection only through approved evaluation data. BEN-OPS-01 proposals do not change production routing until governed deployment.

## 11. Redundancy prevention

Compute a tenant-scoped work fingerprint from goal, subject/entity, objective semantics, required output contract, policy/source constraints, freshness window, and plan version. Before dispatch, inspect active/completed equivalent work.

Reuse is allowed only when tenant, purpose, license, policy, freshness, evidence quality, and output contract match. Otherwise create new work and record why. Independent corroboration is not redundancy when independence is an explicit requirement.

## 12. Budgets and economics

Estimate cost for models, providers, tools, tokens, retries, storage, time, and descendant fan-out. Reserve atomically before dispatch. Sum of child reservations cannot exceed the plan/parent envelope. Optional branches receive cancellable sub-budgets.

When infeasible, generate a lower-cost alternative, reduce optional breadth/depth transparently, return to strategy, or request authorized budget increase. Never silently weaken evidence gates.

## 13. Delegation and recursion

Each `AGENT_TASK` compiles to `DelegatedTask.v1` with exact objective, context refs, authority, allowed/prohibited data, tools, budget, deadline, freshness, confidence, success, stop, escalation, and max autonomy. Depth defaults to three. Fan-out and descendant budgets are explicit. Cancellation propagates. Children cannot rewrite the parent objective or approve policy exceptions.

## 14. Replanning triggers

- strategy or policy version change;
- identity ambiguity or contradiction changes dependencies;
- new evidence satisfies or invalidates a planned branch;
- provider/tool/agent becomes unavailable or ineligible;
- cost/latency forecast breaches threshold;
- critic demands more research;
- child failure changes feasibility;
- deadline or human instruction changes;
- redundancy detected after concurrent plan activation;
- marginal information value falls below threshold.

Replanning starts with fresh observation, preserves completed permissible evidence, cancels obsolete descendants, releases budget, and creates an immutable superseding version with reason codes.

## 15. Failure and recovery

| Failure | Required response |
|---|---|
| Invalid DAG or unreachable terminal | reject plan; repair boundedly |
| Capability absent | alternate registered capability or strategy gap |
| Policy denial | remove prohibited route and replan; never retry unchanged |
| Budget reservation conflict | re-observe available budget and recompute |
| Worker loss | workflow resumes from persisted plan and reservations |
| Duplicate command/event | return prior idempotent result |
| Child orphan/corruption | pause affected join and invoke BEN-SUP-06 threshold |
| Cross-tenant signal | quarantine and security incident |
| Kill switch | stop dispatch; cancel/reconcile according to switch scope |

## 16. Memory

Working memory holds current DAG alternatives. Goal memory holds immutable plan versions, selection decisions, task fingerprints, risks, and unresolved gaps. Canonical evidence/graph stores remain authoritative. No conversational history substitutes for persisted topology or decisions.

## 17. Security and privacy

Plans contain references, not unnecessary raw personal data. Tenant context is verified at every node and event. Retrieved content cannot introduce nodes, tools, authority, or policy. Context propagation uses allowlisted fields and redaction. Provider credentials are inaccessible. Every denial and plan mutation is audited.

## 18. Observability

Metrics: plan validation/revision rates, DAG size/depth/width, critical-path duration, parallel efficiency, join waits, redundancy suppressed, budget forecast error, optional cancellation, orphan/recovery, policy denials, capability fallback, and downstream success by plan version.

Traces: observe, decompose, alternative-build, dependency-validate, capability-select, redundancy-check, cost-estimate, policy-authorize, reserve, persist, dispatch, join, evaluate, replan, cancel, terminate.

## 19. Implementation artifacts

Create/adapt agent registration; schemas; tenant-safe migrations; DAG validator; plan compiler; capability resolver; work-fingerprint service; cost estimator/reservations; durable planning workflow; events/APIs; operator plan visualization and controls; metrics/traces/audit; ADRs; runbook; and full test/evaluation suite.

Minimum APIs: propose plan, validate, authorize, activate, pause, cancel, supersede, inspect DAG/critical path/budgets/decisions/tasks, and privileged replay-safe recovery. Mutations require idempotency and expected version.

## 20. Tests

### Unit/property/contract

- generated DAGs are acyclic and terminal-reachable;
- bounded iterations terminate;
- dependency inputs exist before consumption;
- authority and budgets never widen/overcommit;
- work fingerprint is stable and tenant-scoped;
- critic cannot be originator or context clone;
- joins implement all success/failure/deadline modes;
- cancellation releases reservations and propagates;
- contracts and events pass compatibility tests.

### Agentic scenarios

1. Parallel intelligence branches join before resolution, qualification, critic, and strategy.
2. Same-name ambiguity inserts entity-resolution gate and blocks cross-record capacity attachment.
3. Existing fresh evidence suppresses redundant work; stale evidence triggers refresh.
4. Provider fails; planner selects permitted alternative and revises cost/critical path.
5. Critic requests more research; bounded branch is added without duplicating completed work.
6. Budget shrinks; optional branches cancel while mandatory evidence gates remain.
7. Strategy changes geography; obsolete tasks cancel and new version preserves audit.
8. Weak candidate terminates after minimal agents; major ambiguous prospect deepens conditionally.

### Adversarial/security/reliability

- malicious strategy text tries to grant arbitrary tools;
- Domain Pack attempts to override global privacy policy;
- cross-tenant task/evidence/cache reference;
- forged approval or stale policy snapshot;
- explosive fan-out/recursive loop;
- duplicated/reordered events and concurrent activation;
- worker death before/after reservation, persistence, outbox, dispatch, join, and cancel;
- state corruption quarantine and recovery.

## 21. Acceptance gates

Reject unless executed evidence proves durable observe–plan–act–evaluate–replan behavior; material DAG alternatives; deterministic validation; typed bounded delegation; safe parallelism/joins; redundancy control; critic independence; budget and authority enforcement; restart/duplicate/concurrency safety; tenant isolation; full lineage/observability; and an independent score ≥95/100 with all blocking categories passed.

## 22. Final Chain-It report

Return traceability, files/migrations, rollback, executed commands, actual tests, a complete plan and replanning trace, security/tenant evidence, cost/load results where executed, skips/assumptions/risks, and verdict. `PRODUCTION_READY` is forbidden when any blocking gate is skipped, simulated, assumed, or failing.

## 23. Typed planning model

### PlanningGoal.v2

Required fields include planning goal id/version, tenant/domain/parent goal, approved strategy id/version/hash, decision enabled, required outcomes, mandatory and optional evidence families, policy/authority snapshots, capability and agent-registry versions, budget envelope, deadline, maximum delegation depth exactly 3, fan-out ceiling, criticality, success/stop/escalation conditions, idempotency key, correlation/causation, and schema versions.

Reject mutable or unapproved strategy, tenant mismatch, stale policy, unavailable mandatory capability, undefined terminal criteria, incompatible schemas, contradictory budgets, or authority above A4.

### PlanNode.v2

Each node records node id/version, node type, outcome objective, subject/context references, required input contracts, produced output contracts, preconditions, capability/agent selection constraints, authority intersection, permitted/prohibited data and tools, evidence/freshness/confidence requirements, budget reservation, deadline, retry class, idempotency semantics, optionality, activation predicate, success/stop/escalation, compensation/cancellation behavior, observability, and parent/descendant lineage.

Node types are AGENT_TASK, DETERMINISTIC_SERVICE, POLICY_GATE, HUMAN_GATE, EVIDENCE_GATE, IDENTITY_GATE, CRITIC_GATE, JOIN, DECISION, TIMER, MONITOR, and TERMINAL. A deterministic service is never represented as an agent task.

### PlanEdge.v2

Edges record source/target, dependency type, data references, activation predicate, required status, version compatibility, timeout behavior, failure propagation, and optionality. Types are DATA, CONTROL, EVIDENCE, POLICY, BUDGET, TEMPORAL, COMPENSATION, and CANCELLATION.

Edges cannot reference unavailable outputs, cross tenants, bypass gates, or create unregistered cycles.

### JoinContract.v2

Join contracts define mode, required branches, quorum and independence groups, sufficiency reducer, deadline, partial-result policy, missing-output representation, late-result handling, cancellation behavior, budget reconciliation, and downstream contract.

FIRST_SUFFICIENT uses a deterministic sufficiency function and cannot accept a model’s unsupported self-assessment. QUORUM counts independent source/result groups, not duplicate agents processing common evidence. DEADLINE_BEST_EFFORT is prohibited for mandatory evidence, identity, policy, security, or critic gates.

### PlanAlternative.v2 and ExecutionPlan.v2

Each alternative contains immutable observation, complete DAG, topological order, critical path, branch/fan-out profile, required capability set, budget and latency distributions, evidence coverage forecast, failure domains, recovery profile, assumptions, sensitivity, risks, and admissibility.

ExecutionPlan.v2 records selected and rejected alternatives, deterministic validation report, reservations, activation transaction, monitoring/replanning rules, rollback/cancellation policy, policy/registry snapshots, plan hash/signature, and immutable supersession lineage.

## 24. Durable planning state machine

States:

CREATED → VALIDATING_INPUT → OBSERVING → DECOMPOSING → GENERATING_ALTERNATIVES → VALIDATING_DAGS → ESTIMATING → SELECTING → AUTHORIZING → RESERVING → PERSISTING → ACTIVATING → MONITORING → EVALUATING → REPLANNING.

Terminal/holding states are SATISFIED, PAUSED, WAITING_HUMAN, BLOCKED_POLICY, BLOCKED_CAPABILITY, BUDGET_INFEASIBLE, CANCEL_REQUESTED, CANCELLED, SUPERSEDED, FAILED_RECOVERABLE, FAILED_TERMINAL, and QUARANTINED.

Every transition persists expected prior state, planning/plan version, transition reason, actor, attempt, lease/fencing token, input/output hashes, policy/authority/registry versions, budget delta, timestamp, and audit anchor. Compare-and-swap prevents double transition. Terminal plans are immutable; correction creates a successor.

Planning state and executable workflow state are distinct. BEN-SUP-03 proposes and activates versioned topology; the workflow runtime executes nodes and reports observations. The planner cannot rewrite already committed child history.

## 25. Deterministic plan-validity calculus

The Plan Validator independently proves:

- graph acyclicity after expanding registered bounded loops;
- every node is reachable from a root and can reach a terminal;
- every required strategy outcome has node/output coverage;
- each consumed input has a compatible producing path;
- identity, evidence, policy, human, and critic gates dominate all protected downstream nodes;
- child authority/data/tool scope is a subset of parent and effective policy;
- maximum delegation depth is at most 3 and fan-out within policy;
- mandatory joins cannot resolve from partial or nonindependent results;
- deadlines are feasible or explicitly blocked;
- retry/compensation/cancellation semantics exist for mutable effects;
- budgets conserve across plan, nodes, descendants, retries, and contingencies;
- capabilities and agents are registered, healthy enough, version-compatible, and production-eligible;
- no cross-tenant references, cache namespaces, or event routes exist;
- all paths terminate, escalate, or enter a governed monitor state.

Validation returns typed violations with node/edge/path references and stable codes. Blocking violations cannot be waived by the planner. Bounded repair creates a new alternative and reruns the entire validator.

## 26. Alternative generation and selection calculus

Generate materially different admissible topologies when genuine tradeoffs exist: breadth-first versus depth-first; primary-source-first versus low-cost screening; parallel versus staged; reuse-first versus refresh; or direct specialist versus conditional branch. Alternatives must not differ only in wording or node order.

Selection considers expected decision-enabling evidence, completion probability, uncertainty, information gain, critical-path latency, total and tail cost, source/capability independence, failure-domain concentration, recovery complexity, redundancy, privacy exposure, fairness/coverage, and deadline risk.

Policy owns objective priorities, hard constraints, and risk tolerances. The agent supplies structured estimates and rationale; deterministic gates establish admissibility. Sensitivity analysis varies uncertain costs, latencies, yields, provider availability, and branch probabilities. If the selected plan changes under small plausible perturbations, record instability and prefer a robust alternative or escalate.

No single scalar score may hide a failed mandatory gate. Missing estimates remain missing and trigger conservative ranges, additional diagnostic planning, or infeasibility.

## 27. Conditional execution, partial results, and replanning protocol

Activation predicates are typed expressions over immutable/versioned observations, not free-form model text. Predicates may evaluate evidence sufficiency, identity certainty, policy decision, child status, budget availability, deadline, critic finding, contradiction, or monitoring event. Deterministic evaluators execute predicates.

Optional branches state their information-gain hypothesis and cancellation threshold. When a branch becomes unnecessary, the planner emits versioned cancellation, waits for acknowledged terminal/cancel state, reconciles external effects and budgets, and updates joins. Late results remain auditable and may be stored as evidence but cannot mutate a superseded plan without a new evaluation.

Partial results identify completed, failed, cancelled, missing, stale, contradictory, and policy-blocked outputs separately. The planner cannot coerce partial output into a complete required contract.

Replanning creates PlanChangeSet.v2: triggering observation, preserved reusable nodes/results, invalidated nodes, newly added nodes/edges, cancelled descendants, reservation changes, join changes, critical-path delta, evidence-coverage delta, risks, validation, and superseded plan reference.

In-flight work is reused only after tenant, purpose, policy, license, freshness, evidence quality, output schema, and strategy relevance checks. Replanning is idempotent and serializes on expected active-plan version.

## 28. Atomic activation, persistence, and recovery

Persist planning goals, observations, decomposition decisions, alternatives, nodes, edges, joins, capability decisions, fingerprints, estimates, validation reports, plans, change sets, reservations, activation records, dispatch intents, child links, cancellations, monitoring rules, transitions, human actions, and audit anchors.

Require tenant-scoped keys and constraints, append-only plan/decision history, exact schema/policy/registry references, encrypted sensitive fields, retention, optimistic concurrency/fencing, transactional outbox, idempotency ledger, row-level or equivalent tenant enforcement, and forward/rollback/mixed-version migrations.

Activation protocol:

1. revalidate policy, registry, strategy, deadline, and available budget against the selected plan hash;
2. atomically persist authorized plan/version and reserve all required root/contingency budgets;
3. atomically write dispatch intents to the outbox;
4. publish idempotently;
5. record child workflow identities and reconcile acknowledgement;
6. enter monitoring only after durable activation state is reconstructable.

Policy or registry change between observation and activation fails the TOCTOU check and triggers replan. Publication failure cannot lose reservations or duplicate tasks.

Recovery from worker loss uses persisted topology, outbox/inbox, child ids, reservations, and fencing. Unknown child-effect status invokes BEN-SUP-06 rather than replay. Cross-tenant or graph-integrity failure quarantines the plan.

## 29. Capability routing, economics, security, and operations

CapabilitySelectionDecision.v2 records required reasoning/service boundary, candidate capabilities, eligibility/evaluation status, schema compatibility, tenant/domain/policy fit, tools/data, health, latency/cost distributions, failure domains, conflicts, fallback chain, selected capability, rejected reasons, and versions.

Fallback cannot weaken evidence, policy, schema, critic independence, identity ordering, security, or tenant isolation. A model or generalist cannot replace a required specialist merely because it is available.

BudgetEnvelope is multidimensional: currency, model tokens, tool calls, provider quotas, storage, elapsed time, fan-out, recursion, active nodes, and operator effort. Reservations include expected, tail, retry, and contingency amounts. Conservation is tested transactionally. Hard-dimension exhaustion stops activation/replanning even when other dimensions remain.

Threats include strategy/prompt injection, malicious Domain Pack topology, arbitrary capability grant, graph explosion, recursive budget attack, fingerprint collision, cross-tenant reuse, forged approval/registry status, stale policy, critic-context collusion, cancellation race, event replay, secret leakage, and denial-of-wallet.

Controls include signed/versioned strategy and registry snapshots, workload identity, least privilege, per-node tenant authorization, structured predicates and tool I/O, context allowlists, secret references, graph-size/depth/fan-out limits, budget/rate controls, immutable hashes, signed commands, audit anchors, kill switch, anomaly detection, dependency pinning/SBOM, and redacted telemetry.

Operator controls include inspect DAG and alternatives, explain selection, validate, dry-run, authorize/reject, pause/resume, cancel, supersede, narrow authority, adjust authorized budget, inspect joins/dead letters, invoke recovery, kill, and export audit. Operators cannot edit an active DAG in place.

## 30. Agent-specific evaluation, scale, chaos, and acceptance

Maintain adjudicated planning cases for:

1. straightforward candidate with minimal required branches;
2. common-name identity gate before consequential research;
3. parallel independent evidence branches with ALL_REQUIRED join;
4. corroboration QUORUM with circular-source collapse;
5. FIRST_SUFFICIENT alternatives with late-result cancellation;
6. critic requests targeted additional research;
7. policy change between validation and activation;
8. provider/capability loss and permitted fallback;
9. budget contraction preserving mandatory gates;
10. deadline compression requiring an explicit infeasible result;
11. fresh reusable evidence versus stale or differently licensed evidence;
12. concurrent equivalent plans and fingerprint collision;
13. explosive Domain Pack fan-out/recursion attack;
14. worker death around reservation, persistence, outbox, dispatch, join, cancel, and supersession;
15. cross-tenant poisoned task/evidence/cache reference;
16. recovery investigation after unknown child side effect;
17. strategy revision invalidating active branches;
18. no feasible plan under mandatory evidence policy.

Measure strategy-outcome coverage, DAG validity, terminal reachability, critical-path forecast error, cost forecast error, parallel efficiency, redundant-work suppression without lost corroboration, join correctness, cancellation latency, budget conservation, replan quality, recovery correctness, policy/security violations, human correction, and downstream outcome by plan version.

Load profiles derive from tenants, concurrent planning goals, nodes/edges/joins per plan, alternative count, event rate, monitoring frequency, and descendant fan-out. Test steady, burst, soak, saturation, noisy-neighbor, provider degradation, database/broker failover, and regional recovery. Report planning throughput, percentile latency, queue age, validator complexity, lock/contention, graph/persistence growth, telemetry cardinality, cost, and scaling inflections with reproducible raw evidence.

Chaos kills workers and dependencies at every durable boundary, duplicates/reorders events, expires leases, corrupts projections, delays children, fails outbox publication, changes policy/registry, and exercises backup restore and regional failover. Demonstrate no lost lineage, duplicate unproven effect, authority widening, budget leakage, or illegal join completion.

ADRs cover decomposition, graph model, bounded loops, join semantics, capability routing, fingerprint/reuse, selection calculus, activation transaction, cancellation, recovery, tenancy, policy TOCTOU, and learning. Runbooks cover invalid/explosive DAG, capability outage, join stall, cancellation race, budget conflict, duplicate plan, outbox backlog, tenant incident, critic loop, recovery escalation, kill switch, rollback, and DR.

G0–G5 require repository/failure-surface discovery; constitutional conformance; machine contracts; executed deterministic validation, authority, budget, idempotency and activation foundations; demonstrated alternative generation, tool selection, conditional execution, joins, replanning, cancellation and recovery; and security, isolation, calibration, load, soak, chaos, DR, observability, rollback, documentation, and independent scorecard.

No readiness or score follows from this specification. A score of at least 95/100 may be reported only from attached executed evidence with every blocking gate passed.
