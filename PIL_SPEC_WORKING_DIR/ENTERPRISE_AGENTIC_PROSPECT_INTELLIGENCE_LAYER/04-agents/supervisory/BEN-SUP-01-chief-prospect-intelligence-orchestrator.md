# BEN-SUP-01 — Chief Prospect Intelligence Orchestrator

**Specification ID:** PIL-AGENT-BEN-SUP-01  
**Version:** 2.0.0  
**Family:** Supervisory and Orchestration  
**Default autonomy:** A4 — Policy-Bounded Autonomous Execution  
**Human boundaries:** H1 for strategy outside approved tenant policy; H2 for solicitation, legal determinations, policy exceptions, and irreversible actions  
**Maximum delegation depth:** 3  
**Platform boundary:** Generic Prospect Intelligence core; Benavora is the first Domain Pack/adapter  
**Status:** Specification remediated after final cross-contract audit; implementation readiness requires executed G0–G5 evidence

## 0. Claude Code execution directive

You are implementing BEN-SUP-01 inside an existing or new repository. Do not merely create a prompt or a class that makes one model call. Implement the durable agent behavior, deterministic enforcement, schemas, migrations, events, observability, tests, and operator controls described here.

Before editing:

1. Read the repository instructions and every Release 01 file.
2. Inventory the current architecture, data model, queues, workflow runtime, authorization, model gateway, graph/evidence stores, and test conventions.
3. Produce a requirement-to-code map and identify conflicts.
4. Preserve existing user changes.
5. Use existing stack conventions where they satisfy this specification; introduce technology only when a requirement cannot otherwise be met.
6. Never invent live provider endpoints, credentials, performance results, or completed tests.

Continue through implementation, migrations, tests, remediation, and evidence collection without waiting between ordinary phases. Stop only under a registered Chain-It stop condition.

## 1. Mission and accountable outcome

BEN-SUP-01 durably owns each tenant’s approved prospect-intelligence objective and coordinates the specialist fleet until the objective is satisfied, paused, blocked, superseded, disqualified, or terminally failed.

It is accountable for improving fundraising intelligence value—not maximizing tool calls, dossier length, candidate count, or agent activity.

The orchestrator must:

- translate validated strategy into an active research portfolio;
- observe candidates, evidence gaps, opportunity state, workflow health, budgets, policies, and agent performance;
- select which specialist should act next and why;
- allocate bounded work through typed delegations;
- run independent branches where useful and join only after declared dependencies complete;
- deepen promising investigations and suspend low-value paths;
- require independent criticism for consequential conclusions;
- respond to new evidence, contradiction, cost, failure, and human correction;
- decide when evidence is sufficient for qualification or strategy;
- preserve complete decision and evidence lineage.

It does not perform specialist research merely because it can. Its reasoning boundary is portfolio orchestration, dependency management, sufficiency, prioritization, and goal completion.

## 2. Non-responsibilities

BEN-SUP-01 must not:

- crawl websites, parse filings, normalize contacts, directly write graph storage, or enforce policy itself;
- impersonate specialist agents or combine their conclusions without source references;
- treat deterministic services as delegated agents;
- originate and independently certify the same consequential conclusion;
- initiate solicitations, send outreach, submit applications, or make legal/privacy determinations;
- increase its autonomy, budget, delegation depth, tool permissions, or data access;
- merge ambiguous identities or overwrite contradicted canonical facts;
- optimize for research volume when marginal intelligence value is low;
- expose one tenant’s context to another tenant, including through caches or model prompts.

## 3. Required inputs

All inputs are tenant-scoped, schema-validated, versioned references—not unbounded prompt text.

| Input | Contract | Required use |
|---|---|---|
| Persistent goal | `Goal.v1` | Objective, success, stop, priority, autonomy, policy snapshot |
| Tenant intelligence policy | versioned policy snapshot | Causes, geographies, prospect classes, evidence thresholds, budgets, exclusions |
| Tenant digital twin | immutable/versioned reference | Mission, programs, service areas, known relationships, strategic constraints |
| Portfolio state | `ResearchPortfolio.v1` | Candidates, opportunity scores, gaps, active work, marginal-value estimates |
| Prospect graph view | temporal graph query response | Entities, relationships, evidence, contradictions, freshness |
| Evidence ledger view | evidence and claim references | Claim support and sufficiency; never raw unverifiable summaries alone |
| Agent registry/capabilities | registry snapshot | Eligible specialists, authority, tools, cost, health, evaluation status |
| Workflow state | `AgentRun.v1` and child task states | Resume, join, cancel, retry, recover |
| Cost ledger | budget reservation and usage | Enforce hard limits and optimize allocation |
| Performance view | approved evaluation metrics | Routing choice; never unreviewed self-modification |
| Human decisions | signed approval/correction record | Apply scoped approval and preserve provenance |

Reject the run on tenant mismatch, invalid schema, stale policy snapshot where freshness is mandatory, missing success criteria, missing stop conditions, or an autonomy request exceeding registration.

## 4. Outputs

BEN-SUP-01 produces only typed, durable outputs:

- `ResearchPortfolioCreated.v1`
- `ResearchPortfolioRebalanced.v1`
- `DelegatedTask.v1`
- `Plan.v1` and plan revisions
- `AgentDecision.v1`
- `ResearchDepthChanged.v1`
- `CandidateSuspended.v1` / `CandidateReopened.v1`
- `CriticReviewRequested.v1`
- `QualificationRequested.v1`
- `StrategyRequested.v1`
- `GoalPaused.v1`, `GoalBlocked.v1`, `GoalSatisfied.v1`, or failure events
- `FinalIntelligencePackage.v1`, containing references to canonical entities, claims, evidence, critic decisions, opportunity state, open uncertainties, costs, and freshness—not copied unsupported prose.

Every output mutation includes `tenant_id`, `idempotency_key`, `expected_version`, `policy_snapshot_id`, `correlation_id`, `causation_id`, and `trace_id`.

## 5. Authority envelope

### 5.1 Permitted at A4

- Create and revise research plans within an approved goal.
- Reserve and redistribute an already approved research budget.
- Delegate research, integrity, relationship, qualification, strategy, and recovery tasks within the child’s registered authority.
- Pause, cancel, or suspend pending reversible research.
- Reopen research when a registered material trigger occurs.
- Request independent criticism.
- Mark an objective satisfied only after success and critic gates pass.
- Queue recommendations and intelligence packages for human or downstream review.

### 5.2 Always policy checked

- Every tool capability and provider source.
- Every requested data class and purpose.
- Every delegation and context reference.
- Every model route.
- Every budget reservation.
- Every export or CRM synchronization request.

### 5.3 Prohibited

- Policy exceptions or self-authorization.
- Access to protected/sensitive characteristics for targeting.
- Unapproved contact harvesting.
- Cross-tenant retrieval or aggregation of identifiable data.
- Direct outreach, financial commitment, application submission, or irreversible deletion.
- Declaring ambiguous identity resolved without BEN-KNW-02 or required human review.
- Certifying evidence it originated when independent review is required.

Effective authority is computed deterministically:

`effective = registered_agent ∩ tenant_policy ∩ goal_authority ∩ parent_task ∩ provider_policy ∩ current_human_approval`

Default deny applies when any term is missing or ambiguous.

## 6. Durable state model

The workflow engine persists state after each transition:

```text
CREATED
  → OBSERVING
  → PLANNING
  → AUTHORIZING
  → EXECUTING
  → WAITING (zero or more child tasks/timers)
  → EVALUATING
  → REPLANNING ─────────┐
       └────────────────┘ to OBSERVING/PLANNING
  → SATISFIED | PAUSED | ESCALATED | FAILED_RECOVERABLE | FAILED_TERMINAL | CANCELLED
```

Transition invariants:

- optimistic concurrency rejects stale writers;
- state transition and outbox event commit atomically;
- duplicate commands return the prior result;
- redelivery never duplicates a child task or budget reservation;
- terminal state cannot mutate without a versioned `REOPENED` or recovery command;
- heartbeats do not define correctness; durable state does;
- expired leases are reclaimable without losing completed evidence.

## 7. Observation model

At the start of every cycle and after every material event, construct `OrchestratorObservation.v1` from bounded references:

- current goal version and policy version;
- portfolio candidates and their last material change;
- active, completed, failed, cancelled, and orphaned tasks;
- evidence completeness, contradiction, entity ambiguity, and freshness gaps;
- qualification and critic decisions;
- remaining budget and current marginal-value curve;
- source/provider availability and rate-limit status;
- agent health, approved capability, and evaluation status;
- human approvals, corrections, and pending queues;
- time/deadline and monitoring triggers.

The observation builder is deterministic. The model receives only policy-permitted, tenant-scoped, size-bounded context and references. Record the observation hash so decisions are reproducible.

## 8. Planning behavior

For every planning cycle, BEN-SUP-01 must:

1. Restate the objective and unresolved success criteria.
2. Identify candidate research hypotheses and gaps.
3. Generate at least two viable allocation/action alternatives unless only one authorized action exists.
4. Estimate expected information gain, fundraising relevance, urgency, cost, uncertainty reduction, and risk.
5. Identify dependencies and parallelizable branches.
6. Choose specialists by registered reasoning boundary, not convenience.
7. Assign bounded budgets and explicit success/stop/escalation conditions.
8. Include independent critic work where consequential.
9. Validate the plan structurally and against policy before execution.
10. Persist the plan and rationale before dispatch.

### 8.1 Portfolio utility model

Implement an explainable configurable utility calculation; do not hard-code unsupported business weights. A default policy may use normalized factors:

`utility = expected_information_gain × opportunity_relevance × urgency × evidence_gap_reduction × execution_probability − cost_penalty − risk_penalty − redundancy_penalty`

The model may propose factor estimates. Deterministic code validates ranges, applies tenant-configured weights, records inputs, and prevents budget breaches. Rankings must support sensitivity analysis and reason codes.

### 8.2 Depth policy

- Weak candidate: normally 3–5 relevant agents.
- Normal qualified candidate: normally 8–15.
- Major or ambiguous candidate: normally 15–25.

These are planning bands, not quotas. The orchestrator must justify deviations and must never invoke all 44 by default.

## 9. Delegation behavior

Delegation uses `DelegatedTask.v1` only. Before dispatch:

1. Verify child registration and production eligibility.
2. Intersect authority envelopes.
3. Minimize context and data classes.
4. Reserve budget atomically.
5. Set freshness, confidence, success, stop, escalation, deadline, and max autonomy.
6. Generate an idempotency key from tenant, goal, parent run, child, objective fingerprint, and plan version.
7. Persist task and outbox event in one transaction.

Never delegate a vague objective such as “research this person.” State the missing intelligence, decision it enables, evidence standard, permitted sources/tools, and exact completion condition.

Parallel branches must declare join semantics:

- `ALL_REQUIRED`
- `QUORUM(n)`
- `FIRST_SUFFICIENT`
- `DEADLINE_BEST_EFFORT`

Cancellation propagates to descendants. Completed evidence remains immutable and may be reused if policy, tenant, purpose, and freshness permit.

## 10. Evaluation and replanning

After each material result, evaluate:

- Did the child satisfy its explicit success criteria?
- Does evidence directly support its claims?
- Are identity, contradiction, freshness, or permissibility unresolved?
- Did confidence improve in a calibrated way?
- Did the result change qualification, relationship, timing, or strategy?
- Is more research expected to change a decision?
- Is remaining work redundant or lower value than another candidate?
- Are costs and deadlines within envelope?
- Is independent criticism required or complete?

Replan when:

- a hypothesis is disproven;
- new high-value evidence or a material trigger appears;
- entity ambiguity or contradiction blocks synthesis;
- a provider fails and another permitted route exists;
- a task exhausts its budget with unresolved criteria;
- critic returns `RESEARCH_MORE` or a blocking decision;
- opportunity priority changes materially;
- marginal expected value falls below threshold;
- policy, human instruction, or goal version changes.

Every replan creates a new immutable `Plan.v1` version with reason codes and a link to the superseded plan.

## 11. Sufficiency and termination

BEN-SUP-01 may mark a goal `SATISFIED` only when:

- every required success criterion has machine-verifiable evidence;
- required entity resolutions are `MATCH` or otherwise appropriately bounded;
- consequential claims meet source, corroboration, confidence, and freshness policy;
- contradictions are resolved or prominently retained as unresolved;
- qualification/strategy outputs required by the goal exist;
- independent critic outcome is `PASS` or policy-permitted `PASS_WITH_CAVEATS`;
- no blocking policy, security, privacy, tenant, or budget violation exists;
- the final package includes uncertainty, limitations, costs, and next monitoring action.

It must pause, block, fail, or disqualify rather than manufacture completeness.

## 12. Failure and recovery

| Failure | Required behavior |
|---|---|
| Transient provider or network failure | Retry within registered class; use jitter; respect deadline and circuit breaker |
| Rate limit | Backpressure, reschedule, or select another permitted adapter; never bypass provider policy |
| Invalid model output | Reject at schema boundary; retry with bounded repair; route fallback model only through Model Gateway |
| Duplicate delivery | Return idempotent prior result; emit duplicate-suppressed metric |
| Worker/process loss | Reclaim expired lease and resume from persisted state |
| Child terminal failure | Evaluate alternate specialist/path, partial sufficiency, or recovery delegation |
| Orphaned task | Pause affected join; invoke BEN-SUP-06 when recovery threshold is met |
| Evidence contradiction | Delegate BEN-KNW-04; preserve competing claims |
| Identity ambiguity | Delegate BEN-KNW-02; block consequential synthesis as required |
| Budget exhaustion | Stop new dispatch, cancel optional work, produce bounded partial result or request human increase |
| Policy denial | Record denial; do not retry unchanged request; replan using permitted paths or block |
| State corruption | Stop mutation, preserve logs/evidence, invoke recovery investigation and operator alert |
| Cross-tenant signal | Fail closed, quarantine run, alert security, prohibit automated replay |

Retries are not replanning. A retry repeats an authorized action after a retryable fault; replanning changes the action or strategy based on observed state.

## 13. Memory and context

Memory scopes:

- **Run working memory:** bounded plan-local state; expires after retention window.
- **Goal memory:** durable decisions, plan versions, unresolved questions, and task lineage.
- **Prospect memory:** canonical graph and evidence references, never free-form model recollection.
- **Tenant strategy memory:** approved mission, causes, policies, and human decisions.
- **Fleet learning memory:** approved, versioned routing/evaluation artifacts only.

Retrieval is tenant- and purpose-scoped. Summaries must link to source records and version. Model conversational history is never the system of record.

## 14. Model and tool policy

The Model Gateway selects models using task risk, structured-output reliability, context requirement, cost, latency, approved region, and evaluation status. Model identity and version are recorded. Fallbacks may not weaken policy or output schema.

BEN-SUP-01 may invoke only capability IDs registered for orchestration, such as:

- portfolio state query;
- graph/evidence query;
- task delegation/cancellation;
- policy check;
- budget reserve/release;
- workflow wait/timer;
- human review request;
- final package assembly.

It does not receive raw crawler, browser, arbitrary HTTP, shell, email, or CRM-write capabilities.

## 15. Security and tenant isolation

- Require workload identity with short-lived credentials.
- Derive tenant context from verified identity, never request payload alone.
- Enforce database row-level or equivalent policy plus service authorization.
- Partition queues, cache keys, vector namespaces, graph queries, object paths, metrics dimensions, and rate budgets by tenant.
- Encrypt data in transit and at rest using managed key policy; support tenant-specific keys where required.
- Redact sensitive fields before model context and telemetry.
- Sign or authenticate internal commands and reject replay outside the idempotency window.
- Audit every denied action.
- Include cross-tenant negative tests in CI and pre-production certification.

## 16. Observability and SLOs

Required metrics:

- goal completion, qualification yield, critic pass, false-positive, reopen, and human-correction rates;
- research cost and latency per qualified prospect;
- evidence completeness, claim support, freshness, and contradiction rates;
- task fan-out, depth, cancellation, redundancy, retry, recovery, and orphan rates;
- plan revisions per run and percent of runs demonstrating justified adaptation;
- budget utilization and prevented overrun;
- policy denial and tenant-isolation violation attempts;
- model/schema failure by model and version.

Required trace spans:

`goal.observe`, `plan.create`, `plan.validate`, `budget.reserve`, `policy.authorize`, `task.delegate`, `task.join`, `result.evaluate`, `plan.revise`, `critic.request`, `goal.terminate`.

Service-level objectives must be configured from measured platform needs. The specification does not invent latency or throughput figures. Define SLOs, load profile, error budget, and alert thresholds before production approval.

## 17. Required implementation artifacts

Claude Code must create or adapt:

1. Agent registration and capability manifest.
2. Goal, run, plan, observation, portfolio, decision, and delegation schemas.
3. Database migrations with tenant keys, indexes, version columns, constraints, retention, and outbox tables.
4. Durable orchestration workflow and activities.
5. Deterministic policy, budget, and idempotency middleware.
6. Model structured-output schemas and prompt/version registry.
7. Events, handlers, retry policies, and dead-letter recovery.
8. Operator APIs for inspect, pause, resume, cancel, approve, reject, and replay-safe recovery.
9. Metrics, tracing, audit, dashboards, and alert definitions.
10. Unit, property, contract, integration, end-to-end, adversarial, load, security, and recovery tests.
11. Architecture decision records for material choices.
12. Runbook covering failure, budget, provider, policy, stuck workflow, and tenant incident response.

## 18. Minimum API surface

Use the repository’s API conventions. Equivalent operations must exist:

- `POST /v1/intelligence-goals` — create proposed goal
- `POST /v1/intelligence-goals/{id}:validate`
- `POST /v1/intelligence-goals/{id}:activate`
- `POST /v1/intelligence-goals/{id}:pause`
- `POST /v1/intelligence-goals/{id}:resume`
- `POST /v1/intelligence-goals/{id}:cancel`
- `GET /v1/intelligence-goals/{id}`
- `GET /v1/intelligence-goals/{id}/plans`
- `GET /v1/intelligence-goals/{id}/tasks`
- `GET /v1/intelligence-goals/{id}/decisions`
- `GET /v1/intelligence-goals/{id}/audit`
- `POST /v1/agent-runs/{id}:recover` — privileged, replay-safe recovery

Mutations require idempotency and expected-version headers/fields. List endpoints require bounded pagination. Authorization and tenant scope are server-derived.

## 19. Test and evaluation suite

### 19.1 Unit and property tests

- authority intersection never widens permission;
- budget allocation never exceeds reserved total under concurrency;
- delegation depth and fan-out terminate;
- utility ranking is deterministic for fixed inputs and produces reason codes;
- terminal-state and version invariants hold under generated transition sequences;
- idempotency fingerprinting suppresses equivalent duplicate dispatch;
- model output cannot bypass schema or policy validation.

### 19.2 Contract tests

- every command/event validates against the shared contract;
- backward/forward compatibility follows version policy;
- unknown fields and enum values fail or are handled by declared compatibility rules;
- producer and consumer tests run in CI.

### 19.3 Agentic behavior scenarios

1. **Multi-cycle success:** initial discovery is insufficient; orchestrator delegates intelligence, observes a gap, replans to relationship work, requests criticism, and terminates only after pass.
2. **Low-value suspension:** 370 candidates exist; 42 are sufficient; the agent suspends broad low-value research and reallocates to the top 15 with recorded utility rationale.
3. **Contradiction:** current and historical board-role sources conflict; the agent delegates contradiction investigation and blocks current-role synthesis.
4. **Identity ambiguity:** same-name executives exist; the agent requests entity resolution and prevents capacity evidence from crossing identities.
5. **Provider degradation:** preferred source fails; the agent uses a permitted fallback or pauses without inventing data.
6. **Critic rejection:** critic returns `RESEARCH_MORE`; the agent revises the plan and cannot self-certify.
7. **Budget boundary:** hard limit is reached mid-portfolio; optional tasks cancel and a partial, transparent package is produced.
8. **Goal supersession:** human changes geography; obsolete descendants cancel and a new plan version uses the new policy without corrupting prior audit.

### 19.4 Reliability tests

- kill worker after dispatch, after child completion, before outbox publish, and during evaluation;
- duplicate every command and event;
- delay, reorder, and drop permitted test events;
- exhaust provider rate limit and open circuit;
- corrupt noncanonical cache and rebuild it;
- prove no duplicated side effect or lost evidence.

### 19.5 Security and privacy tests

- cross-tenant IDOR at every endpoint and storage layer;
- poisoned context containing tool or policy override instructions;
- prohibited-data request inside delegated objective;
- secret and PII leakage in prompts/logs/traces;
- forged approval, stale approval, replayed command, and autonomy escalation;
- provider adapter returning data outside permitted license/purpose.

### 19.6 Quality evaluation dataset

Maintain versioned gold cases containing:

- sparse prospects;
- common-name ambiguity;
- stale/conflicting records;
- major donor with wealth but no propensity;
- strong affinity but low capacity;
- foundation invitation-only eligibility;
- direct and multi-hop relationships;
- deliberately circular citations;
- negative/disqualification cases;
- tenant-policy variations.

Blind scoring must evaluate orchestration choice, evidence sufficiency, calibration, cost, policy compliance, and termination correctness. Store evaluator version and disagreement.

## 20. Acceptance gates

BEN-SUP-01 is rejected unless all are evidenced:

- It performs at least one demonstrated observe–plan–act–evaluate–replan cycle.
- It selects among authorized alternatives and records those alternatives.
- It delegates through typed bounded tasks.
- It survives process loss and duplicate delivery.
- It cannot exceed authority or budget under concurrency.
- It cannot cross tenant boundaries.
- It does not certify its own consequential findings.
- It preserves evidence, claim, decision, plan, task, cost, and policy lineage.
- It stops low-value research and can deepen high-value research.
- It emits complete metrics, traces, and audit records.
- All blocking tests pass and the independent scorecard result is at least 95/100.

## 21. Required final Chain-It report

## 22. Cross-contract orchestration model

BEN-SUP-01 consumes BEN-SUP-02 ResearchStrategy.v2, BEN-SUP-03 ExecutionPlan.v2 and PlanConformanceReport.v2, BEN-SUP-04 PortfolioAllocationPlan, BEN-SUP-05 CriticReviewDecision.v2, BEN-SUP-06 RecoveryValidationReport.v2, and specialist candidate/intelligence contracts. It may support v1 contracts during a declared migration window, but new runs use the latest registry-approved compatible version.

The orchestrator never silently translates incompatible contracts. ContractAdapterDecision.v2 records source/target versions, losslessness, defaulted fields, prohibited downgrade, policy approval, tests, expiry, and selected adapter. A lossy adapter cannot satisfy a mandatory evidence, authority, tenant, critic, identity, or recovery gate.

OrchestrationGoal.v2 links the approved tenant goal, ResearchStrategy.v2, active ExecutionPlan.v2, portfolio version, effective authority, multidimensional budget, policy/twin/registry snapshots, maximum delegation depth 3, success/stop/escalation, monitoring, and version lineage.

OrchestrationObservation.v2 records exact strategy/plan/portfolio versions; candidates/opportunities; child task and join states; evidence/identity/contradiction/freshness gaps; critic decisions; recovery cases; budgets; provider/capability health; human decisions; monitoring events; and current time. Mixed-version observations are rejected unless a declared read-consistency policy proves compatibility.

OrchestrationDecision.v2 records alternatives, selected action, expected value and uncertainty, evidence/input refs, strategy/plan conformance, policy/authority/budget decisions, critic/recovery requirements, sensitivity, limitations, model/tool versions, and immutable signature.

FinalIntelligencePackage.v2 contains references to canonical entities, temporal claims, evidence, contradictions, qualification/opportunity state, critic verdicts, open recovery cases, strategy and plan versions, uncertainty, permitted/prohibited downstream uses, freshness/expiry, costs, and monitoring. It cannot copy unsupported narrative into trusted truth.

## 23. Supervisory ownership and non-overlap matrix

BEN-SUP-01 owns goal/portfolio orchestration, cross-agent progress evaluation, sufficiency, and final package assembly. BEN-SUP-02 owns strategy formation and revision. BEN-SUP-03 owns executable topology. BEN-SUP-04 owns cross-candidate/action budget allocation. BEN-SUP-05 independently critiques consequential claims. BEN-SUP-06 diagnoses and safely recovers failed execution.

The orchestrator may request, accept, reject, pause, or supersede those artifacts through typed contracts. It cannot perform their specialized reasoning internally merely to reduce latency or agent count.

When supervisory outputs conflict:

1. constitution and policy blocks dominate;
2. tenant/security/integrity quarantine dominates ordinary progress;
3. BEN-SUP-05 blocking verdict prevents consequential progression;
4. BEN-SUP-06 unresolved integrity/recovery state prevents affected completion;
5. current approved ResearchStrategy governs intent;
6. validated active ExecutionPlan governs topology;
7. authorized PortfolioAllocationPlan governs current resource distribution;
8. human decisions apply only within scope/version/expiry.

ConflictResolutionRecord.v2 preserves both inputs, precedence rule, selected result, affected work, cancellations/replanning, human requirement, and audit.

## 24. Goal, plan, portfolio, critic, and recovery lifecycle coupling

A new or materially revised goal requires BEN-SUP-02 strategy formation. A published strategy requires BEN-SUP-03 conformance and executable planning. Plan activation requires BEN-SUP-04 allocation/reservation where portfolio policy applies. Consequential synthesis requires BEN-SUP-05 independent review. Execution corruption or unknown side effects invoke BEN-SUP-06.

The orchestrator cannot mark SATISFIED while:

- strategy is draft, rejected, expired, superseded, or incomplete;
- PlanConformanceReport has an unmapped mandatory requirement;
- required plan nodes/joins are incomplete or resolved from invalid partial results;
- mandatory budgets/effects are unreconciled;
- identity, evidence, contradiction, freshness, policy, or eligibility blockers remain;
- critic verdict is blocking or required review absent;
- affected recovery case is open, quarantined, human-required, or terminal without accepted safe disposition;
- final package contract or downstream-use permissions are incomplete.

Material strategy change supersedes the plan and triggers impact analysis. Material execution evidence may replan topology without changing strategy. Allocation changes cannot remove mandatory evidence/critic/recovery gates. Critic remediation creates bounded research through SUP-03, not an informal child task. Recovery evidence returns through validated recovery contracts before affected joins reopen.

## 25. Durable orchestration state and atomic coordination

The v2 lifecycle is CREATED, VALIDATING, STRATEGIZING, PLANNING, ALLOCATING, AUTHORIZING, ACTIVATING, EXECUTING, WAITING, EVALUATING, CRITIQUING, RECOVERING, REPLANNING, PACKAGING, VALIDATING_COMPLETION, and terminal SATISFIED, PAUSED, WAITING_HUMAN, BLOCKED_POLICY, DISQUALIFIED, SUPERSEDED, CANCELLED, FAILED_RECOVERABLE, FAILED_TERMINAL, or QUARANTINED.

Every transition persists expected version, actor, reason, attempt, fencing token, strategy/plan/portfolio/critic/recovery versions, hashes, policy/authority/registry snapshots, budget delta, timestamp, and audit anchor. Compare-and-swap prevents stale writes.

Cross-aggregate coordination uses sagas with explicit invariants rather than distributed transactions across services. Each step defines forward action, idempotency, durable acknowledgement, timeout, compensation/cancellation, and reconciliation. No compensation deletes evidence, audit, verdict, or original history.

Activation sequence revalidates goal, strategy, plan, policy, registry, authority, budgets, and kill switches against immutable hashes; reserves authorized budget; persists active orchestration/dispatch intents and outbox atomically; publishes idempotently; then reconciles child identities. TOCTOU change triggers re-observation rather than unsafe activation.

## 26. Sufficiency calculus and truthful completion

GoalSufficiencyReport.v2 is produced by a deterministic reducer over strategy-defined success criteria and typed state. Each criterion records required contract, evidence/gate, current state, missingness, contradiction, freshness, critic/recovery result, expiry, and pass/fail/unknown.

Completion values are SATISFIED, SATISFIED_WITH_POLICY_PERMITTED_LIMITATIONS, PARTIAL_NOT_SATISFIED, HUMAN_REQUIRED, POLICY_BLOCKED, RECOVERY_BLOCKED, DISQUALIFIED, and FAILED. UNKNOWN never becomes PASS.

The model may explain results but cannot set deterministic gate outcomes. SATISFIED_WITH_POLICY_PERMITTED_LIMITATIONS is legal only when limitations are nonblocking, explicitly allowed by strategy/policy, included in the final package, and do not conceal identity, tenant, security, evidence-integrity, critic, or recovery uncertainty.

Marginal-value stopping does not equal success. It may produce PARTIAL_NOT_SATISFIED with the best safe package and exact unmet criteria. Budget exhaustion, deadline, or provider failure cannot be narrated as completion.

## 27. Portfolio economics and anti-thrashing controls

The orchestrator consumes SUP-04 allocations and independently ensures aggregate goal economics. Budget dimensions include currency, tokens, model/tool calls, provider quotas, storage, elapsed time, active workflows, fan-out, recursion, candidates, and operator effort.

Before every delegation, reserve the child’s expected/tail/retry budget. Reconcile on completion/cancellation/recovery. Conservation must hold across goal, portfolio, plan, task descendants, contingencies, and human adjustments.

Anti-thrashing controls include material-change thresholds, minimum decision hold time where policy permits, hysteresis for suspend/reopen, replan-rate limits, repeated-plan signatures, provider circuit breakers, and bounded critic/remediation loops. They never delay security, policy, tenant, integrity, or kill-switch response.

The orchestrator records why work was deepened, suspended, reopened, reused, cancelled, or displaced. Starvation and concentration monitoring ensures new/sparse candidates receive policy-approved exploration without displacing mandatory evidence.

## 28. Operator control, security, and emergency behavior

Operators can inspect goal, strategy, plan DAG, portfolio, tasks/joins, evidence gaps, critic/recovery states, budgets, alternatives, decisions, and audit; pause/resume; cancel; narrow authority; approve scoped human gates; adjust authorized budgets; supersede; quarantine; invoke recovery; kill; and export evidence.

They cannot edit immutable artifacts or active topology in place, erase verdicts/history, grant cross-tenant access, convert UNKNOWN to PASS, waive policy/security/integrity blocks, or let the originator certify its own work.

Emergency kill switches are scoped by tenant, goal, capability, provider, data class, model, agent, or global platform. Dispatch stops at the next deterministic boundary. In-flight actions follow declared cancellation/containment semantics; external-effect status is reconciled before replay. Evidence, audit, and reservations remain recoverable.

Threats include prompt/strategy/Domain-Pack injection, goal hijacking, authority escalation, critic collusion, recovery bypass, cross-tenant context/cache/vector/graph/queue/object leakage, forged approval, stale policy, arbitrary capability selection, recursive fan-out, budget denial-of-wallet, cancellation race, event replay, model/tool poisoning, secret leakage, and audit tampering.

Controls require signed/versioned inputs, workload identity, least privilege, tenant authorization at every access, structured predicates/tool I/O, content/instruction separation, context minimization, secret references, encryption, egress/rate/budget controls, graph/fan-out/depth limits, hashes/signatures, kill switch, anomaly detection, redacted telemetry, dependency pinning/SBOM, and tamper-evident audit.

## 29. Cross-contract persistence, interfaces, and migration

Persist orchestration goals, observations, decisions, supervisory links, sufficiency reports, conflict records, saga steps, reservations, child/join state, final package versions, monitoring rules, transitions, human actions, events, and audit anchors.

Require tenant-scoped keys/constraints; append-only decision and package lineage; exact strategy/plan/portfolio/critic/recovery versions; optimistic concurrency/fencing; transactional outbox and inbox/dedupe; encrypted sensitive fields; retention/legal holds; RLS/equivalent negative tests; and forward/rollback/mixed-version migrations.

Commands include create/activate/pause/resume/cancel/supersede goal, request strategy/plan/allocation/critic/recovery, submit human decision, rebalance, package, validate completion, reopen, quarantine, and replay-safe recover. Queries expose every linked artifact, state timeline, sufficiency, economics, alternatives, tool/model/policy decisions, and audit.

Events preserve tenant, aggregate/version, idempotency, correlation/causation, policy/authority, schema, timestamps, and payload hash. Consumers tolerate duplicate/reordered events and reject stale aggregate versions. Contract tests prove compatibility across all SUP and specialist handoffs.

Migration from v1 to v2 uses explicit adapters, dual-read or shadow validation where necessary, canary tenants, invariant comparison, rollback, and expiry. A migration cannot silently default mandatory v2 safety fields.

## 30. Final cross-contract evaluation and certification

The orchestration gold dataset includes:

1. simple goal with one feasible plan;
2. ambiguous goal requiring SUP-02 human decision;
3. strategy-plan conformance failure;
4. identity ambiguity blocking consequential branches;
5. parallel research with mandatory joins;
6. SUP-04 reallocation under budget change;
7. SUP-05 blocking verdict and targeted remediation;
8. SUP-06 recovery after unknown child effect;
9. strategy supersession with active-plan cancellation;
10. policy/registry TOCTOU change during activation;
11. provider/model failure with safe fallback;
12. partial deadline result that must not satisfy;
13. cross-tenant poisoned reference;
14. critic-originator context conflict;
15. budget conservation under cancellation/retry/recovery;
16. repeated monitoring triggers and anti-thrashing;
17. no feasible path under mandatory gates;
18. complete high-quality goal with independently validated package.

Measure goal satisfaction correctness, false completion, strategy/plan conformance, portfolio value, evidence sufficiency, identity/contradiction/freshness outcomes, critic overturn/remediation, recovery correctness, budget conservation, cost/latency, replan quality, duplicate suppression, human correction, tenant isolation, and calibration.

Test unit/property invariants; all schemas/interfaces/migrations; deterministic authority/policy/budget/sufficiency; distributed idempotency/concurrency/outbox; full supervisory E2E; prompt injection/IDOR/cross-tenant/forged approval; load, burst, soak, saturation, noisy-neighbor; worker/dependency/database/broker/region failure; backup/restore; kill switch; rollback; and disaster recovery.

Capacity profiles derive from tenants, active goals, portfolios, candidates, plan nodes, child events, monitoring triggers, evidence volume, and retention. Report reproducible throughput, percentile latency, queue age, contention, telemetry/cardinality, cost, RTO/RPO, and scaling inflections.

G0 requires repository/trust/dependency discovery and a concrete interaction map. G1 requires constitutional and ownership-boundary conformance. G2 requires all cross-contract schemas and compatibility. G3 requires deterministic policy, authority, budget, idempotency, sufficiency, and activation. G4 requires executed observe–plan–delegate–evaluate–replan, criticism, recovery, monitoring, and termination traces. G5 requires security, privacy, tenant isolation, calibration, load, soak, chaos, DR, observability, rollback, documentation, and an independent scorecard with no blockers.

This final specification audit does not prove implementation. A score ≥95/100 or production-ready verdict may be reported only from attached executed G0–G5 evidence.

Claude Code must return:

- requirement-to-file traceability;
- migrations and rollback instructions;
- all executed commands;
- tests with actual pass/fail/skip counts;
- coverage and load results where executed;
- security and tenant-isolation evidence;
- sample trace of a full replanning run;
- unresolved assumptions and provider dependencies;
- known limitations and residual risks;
- scorecard with evidence links;
- explicit verdict: `NOT_READY`, `CONDITIONALLY_READY`, or `PRODUCTION_READY`.

Do not use `PRODUCTION_READY` if any blocking gate is skipped, simulated, assumed, or failing.
