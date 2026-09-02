# PIL System Constitution

**Document ID:** PIL-GOV-000  
**Version:** 1.0.0  
**Normative status:** Binding  
**Applies to:** All agents, services, tools, models, data stores, operators, and tenant configurations

## 1. Product boundary

The Prospect Intelligence Layer is a standalone, multi-tenant, evidence-driven prospect research and decision-intelligence subsystem. It may synchronize selected outputs to Benavora or external CRMs, but CRM state is not canonical research truth.

Four stores remain logically distinct:

1. evidence truth;
2. canonical entity and graph truth;
3. opportunity intelligence;
4. CRM operational state.

No integration may collapse these boundaries.

## 2. Agent qualification law

A runtime component may be registered as an agent only when all of the following are demonstrable:

1. It receives or durably maintains a typed objective.
2. It observes relevant current state before deciding.
3. It creates a plan containing steps, dependencies, budgets, risks, and stop conditions.
4. It chooses among more than one permitted action, tool, or delegation path.
5. It executes or delegates through authorized, typed interfaces.
6. It evaluates whether results satisfy the objective and evidence threshold.
7. It revises its plan when evidence, cost, policy, state, or failure conditions change.
8. It persists state across worker, process, and model-session failure.
9. It terminates only as `SATISFIED`, `PAUSED`, `BLOCKED_*`, `FAILED_*`, `DISQUALIFIED`, `SUPERSEDED`, or another registered terminal/holding state.
10. It produces reconstructable decisions, evidence lineage, and an audit trail.

A prompt, scheduled job, crawler, parser, model call, tool wrapper, workflow step, or API request that lacks any of these properties is not an agent.

## 3. Mandatory operating loop

Every agent run implements:

`GOAL → OBSERVE → PLAN → AUTHORIZE → ACT/DELEGATE → COLLECT → EVALUATE → REPLAN OR TERMINATE`

The loop is durable. A queue redelivery or process restart resumes from persisted state and does not silently restart reasoning or duplicate side effects.

## 4. Autonomy and human boundaries

Autonomy levels:

- `A0 OBSERVE_ONLY`: inspect and report; no mutation.
- `A1 RESEARCH_RECOMMEND`: research and recommend; no operational mutation.
- `A2 PREPARE_QUEUE`: create dossiers, plans, drafts, and proposed tasks.
- `A3 REVERSIBLE_EXECUTION`: execute pre-authorized, reversible, low-risk actions.
- `A4 POLICY_BOUNDED_EXECUTION`: execute higher-impact actions only within durable tenant policy.

Human boundaries are orthogonal:

- `H1 APPROVAL_REQUIRED`
- `H2 HUMAN_EXECUTION_REQUIRED`

An agent may not increase its own autonomy, widen its data access, change policy, waive an evaluation gate, approve its own exception, or certify its own consequential conclusion.

## 5. Delegation law

All delegation uses `DelegatedTask.v1`. Child authority is the intersection of parent authority, tenant policy, tool policy, data policy, and child registration. Delegation depth defaults to three. Fan-out, tokens, time, tools, and money are bounded. Tasks are traceable, idempotent, cancellable, deadline-aware, and terminate recursively.

## 6. Evidence law

Every consequential claim must reference one or more immutable evidence records. Claims are labeled only as:

`VERIFIED_FACT`, `CORROBORATED_FACT`, `SINGLE_SOURCE_FACT`, `REASONED_INFERENCE`, `ESTIMATE`, `UNVERIFIED`, `CONTRADICTED`, or `STALE`.

Inferences never become facts through repetition. Absence of evidence is not evidence of absence. Search snippets are discovery aids, not sufficient final evidence. Source permissibility, quality, independence, freshness, and direct support must be evaluated independently.

High-impact identity, capacity, giving, eligibility, relationship, or strategy conclusions require independent criticism by an agent that did not originate the conclusion and receives deliberately separate context.

## 7. Data and privacy law

- Enforce tenant isolation at authorization, query, storage, cache, queue, event, log, trace, export, and model-context boundaries.
- Use minimum necessary data and purpose-bound access.
- Never target or infer protected or highly sensitive traits for fundraising solicitation.
- Public availability does not automatically establish permitted use.
- Provider licenses, terms, robots controls, retention, consent, and data-subject restrictions are machine-enforced policies.
- Private contact harvesting and prohibited data brokerage are forbidden.
- Secrets and raw sensitive data must not enter prompts, logs, traces, analytics, or error messages unless explicitly authorized and redacted.

## 8. Reliability law

All externally visible mutations require tenant-scoped idempotency keys. Durable workflows use transactional outbox/inbox, retry classes, exponential backoff with jitter, circuit breakers, dead-letter handling, compensation where feasible, and concurrency/version controls. Exactly-once claims are prohibited unless proven; effectively-once processing is the default requirement.

No architecture assumes a continuously alive worker, model session, process, or server.

## 9. Economics law

Every plan contains time, token, model, API, tool, and monetary budgets. Agents must estimate marginal research value and stop or redirect work when expected value falls below policy thresholds. Budget exhaustion produces an explicit partial result or escalation, never silent degradation.

## 10. Learning law

Learning is proposal-driven and reversible. Outcome feedback may recommend changes to retrieval, routing, prompts, models, evaluations, or strategy. It may not silently modify policy, permissions, canonical facts, security controls, privacy rules, or autonomy. Production changes require versioning, offline evaluation, approval when required, staged rollout, monitoring, and rollback.

## 11. Observability and audit law

Every goal, plan revision, delegation, tool invocation, policy decision, evidence mutation, model invocation, output validation, escalation, and state transition emits a tenant-scoped audit event and trace correlation identifiers. Audit records are append-only and tamper-evident. Metrics must support outcome, operational, quality, efficiency, learning, and evidence success.

## 12. Production gate

No agent is production-ready until it:

- passes schema and contract tests;
- demonstrates multi-cycle replanning;
- survives worker interruption and duplicate delivery;
- proves tenant isolation;
- blocks unauthorized tools and data classes;
- produces complete evidence lineage;
- passes independent-critic scenarios;
- passes adversarial, regression, load, and recovery tests relevant to its risk;
- scores at least 95/100 on the registered scorecard with no blocking category failure.

A score is an evaluation result, not a label authored into the specification.

