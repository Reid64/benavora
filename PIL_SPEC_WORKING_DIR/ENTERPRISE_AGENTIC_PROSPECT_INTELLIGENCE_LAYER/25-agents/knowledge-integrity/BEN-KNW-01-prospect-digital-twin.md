# BEN-KNW-01 — Prospect Digital Twin Agent

**Specification ID:** PIL-AGENT-BEN-KNW-01  
**Version:** 1.0.0  
**Family:** knowledge-integrity  
**Default autonomy:** A3  
**Maximum delegation depth:** 3  
**Status:** FINAL_SPECIFICATION_PENDING_IMPLEMENTATION_EVIDENCE  
**Governing constitution:** PIL-GOV-000  
**Shared contracts:** PIL Shared Agent Contracts; current compatible versions only

## 1. Accountable mission

Maintain a versioned, point-in-time prospect digital twin by proposing evidence-linked canonical updates while preserving source truth, temporal history, contradictions, and reversible change lineage.

This agent is a durable goal owner, not a prompt, crawler, parser, scoring function, scheduled job, or one-shot model call. Its runtime MUST implement the constitutional loop:

`GOAL → OBSERVE → PLAN → AUTHORIZE → ACT/DELEGATE → COLLECT → EVALUATE → REPLAN OR TERMINATE`.

The accountable output is a tenant-scoped, evidence-linked, versioned decision package whose claims, uncertainty, policy basis, lineage, costs, and next-state recommendation are reconstructable.

## 2. Reasoning boundary and prohibited conflation

The agent owns reasoning only inside its named domain. Mechanical retrieval, authentication, crawling, parsing, matching candidates, storage, authorization, policy enforcement, event delivery, cost accounting, and audit persistence remain deterministic services.

The agent MUST NOT:
- invent entities, relationships, amounts, dates, programs, contact details, capacity, giving, eligibility, or outcomes;
- treat model confidence as evidence;
- treat repeated copies of one source as independent corroboration;
- widen purpose, permissions, data classes, autonomy, or provider rights;
- mutate CRM as canonical truth;
- infer protected or highly sensitive traits for solicitation;
- expose secrets or raw sensitive values in model context, logs, traces, metrics, or errors;
- certify a consequential conclusion that it originated when independent review is required;
- treat missing evidence as a negative fact;
- bypass access controls, provider restrictions, robots/terms policy, consent, suppression, retention, or tenant isolation.

## 3. Durable objective contract

`BEN_KNW_01Goal.v1` MUST include:
- goal_id, tenant_id, domain_id, strategy_id/version, policy_snapshot_id, created_at, deadline, priority;
- objective, hypotheses, inclusion criteria, exclusion criteria, success criteria, stop conditions, escalation conditions;
- required dimensions, evidence tiers, minimum confidence, freshness rules, contradiction tolerance;
- allowed tools/capabilities, allowed and prohibited data classes, provider/source constraints;
- monetary, token, tool-call, wall-clock, concurrency, delegation, and depth budgets;
- autonomy ceiling and human boundary;
- prior-state refs, WorkFingerprints, monitoring triggers, and expected downstream consumers.

Input validation fails closed on tenant mismatch, stale/unknown policy, schema incompatibility, unavailable mandatory evidence tier, prohibited data class, unresolved authority, invalid budget, or contradictory goal constraints.

## 4. Observation model

Every run begins by persisting an immutable observation snapshot. The observation includes canonical entity state, current claims and evidence, contradiction/freshness flags, open tasks, downstream state, policy and provider health, budget availability, prior decisions, critic findings, and material changes since the previous run.

Domain observations:

- **Entity State**: observe source-specific facts, alternatives, uncertainty, effective time, and evidence lineage.
- **Claims And Evidence**: observe source-specific facts, alternatives, uncertainty, effective time, and evidence lineage.
- **Relationships**: observe source-specific facts, alternatives, uncertainty, effective time, and evidence lineage.
- **Opportunities**: observe source-specific facts, alternatives, uncertainty, effective time, and evidence lineage.
- **Temporal Versions**: observe source-specific facts, alternatives, uncertainty, effective time, and evidence lineage.
- **Conflicts And Uncertainty**: observe source-specific facts, alternatives, uncertainty, effective time, and evidence lineage.

Observations distinguish source fact, canonical fact, inference, estimate, unknown, contradiction, stale information, and prohibited inference. Every observation states an `as_of` time.

## 5. Planning and adaptive reasoning

The plan MUST contain at least two viable action alternatives unless only one action is legally or technically possible, in which case the reason is recorded. Each step declares dependencies, expected evidence, expected information gain, expected cost, risk, authorization requirement, timeout, retry class, and completion predicate.

The agent replans when:
- new evidence materially changes a hypothesis;
- identity or attribution becomes ambiguous;
- evidence is contradicted or stale;
- a required source is unavailable;
- cost or time approaches a hard budget;
- a policy/provider/tool decision changes;
- critic findings invalidate a premise;
- downstream state makes the current plan unnecessary;
- expected marginal information value drops below the configured threshold.

A retry repeats the same authorized action after a transient failure. A replan changes the action because observed state changed. The two are never conflated.

## 6. Evidence, provenance, and epistemic rules

Every consequential claim MUST reference immutable `EvidenceRecord` objects and source snapshots. Required checks:
1. source permissibility;
2. source identity and publisher;
3. directness of support;
4. independence/source-group deduplication;
5. publication, effective, retrieval, and verification time;
6. exact subject/object attribution;
7. quote/context integrity where textual evidence is used;
8. counterevidence search proportionate to impact;
9. confidence calibration;
10. contradiction and freshness status.

Permitted claim classes are exactly the constitutional classes: VERIFIED_FACT, CORROBORATED_FACT, SINGLE_SOURCE_FACT, REASONED_INFERENCE, ESTIMATE, UNVERIFIED, CONTRADICTED, and STALE. Repetition never upgrades a claim.

## 7. Delegation

Canonical delegations include:
- `BEN-KNW-02` when its canonical reasoning boundary is required; delegated work must use the current typed DelegatedTask contract and may not exceed inherited authority.
- `BEN-KNW-03` when its canonical reasoning boundary is required; delegated work must use the current typed DelegatedTask contract and may not exceed inherited authority.
- `BEN-KNW-04` when its canonical reasoning boundary is required; delegated work must use the current typed DelegatedTask contract and may not exceed inherited authority.
- `BEN-SUP-05` when its canonical reasoning boundary is required; delegated work must use the current typed DelegatedTask contract and may not exceed inherited authority.

Delegation is typed, tenant-scoped, cancellable, idempotent, depth-bounded, budget-bounded, deadline-aware, and trace-linked. A child cannot rewrite the parent objective or expand authority. Fan-out requires an explicit information-gain rationale.

## 8. Deterministic service/tool usage

- `PIL-SVC-19` only through registered capabilities and policy enforcement; the service remains deterministic and does not inherit agent authority.
- `PIL-SVC-20` only through registered capabilities and policy enforcement; the service remains deterministic and does not inherit agent authority.
- `PIL-SVC-21` only through registered capabilities and policy enforcement; the service remains deterministic and does not inherit agent authority.
- `PIL-SVC-22` only through registered capabilities and policy enforcement; the service remains deterministic and does not inherit agent authority.
- `PIL-SVC-23` only through registered capabilities and policy enforcement; the service remains deterministic and does not inherit agent authority.
- `PIL-SVC-24` only through registered capabilities and policy enforcement; the service remains deterministic and does not inherit agent authority.
- `PIL-SVC-25` only through registered capabilities and policy enforcement; the service remains deterministic and does not inherit agent authority.
- `PIL-SVC-27` only through registered capabilities and policy enforcement; the service remains deterministic and does not inherit agent authority.

All tool invocations are capability-based. Arbitrary shell, arbitrary HTTP, raw email, secret access, or unrestricted browser capability is prohibited unless separately registered, policy-authorized, and necessary to the domain. Model output is untrusted until schema validation and deterministic policy checks pass.

## 9. Decision contract

`BEN_KNW_01Decision.v1` requires:
- decision_id, tenant_id, goal_id, run_id, plan_id/version, agent_id/version;
- decision_type and selected action;
- at least two alternatives considered when applicable;
- rationale tied to evidence and policy decisions;
- claim/evidence refs and unresolved contradictions;
- confidence plus calibration cohort/version;
- cost and budget consumption;
- downstream handoff(s), monitor conditions, stop reason;
- human gate if required;
- created_at and valid_as_of.

The decision cannot directly erase prior truth. Supersession preserves lineage.

## 10. State machine and persistence

Required run states:
`CREATED → OBSERVING → PLANNING → AUTHORIZING → EXECUTING → EVALUATING → REPLANNING|WAITING|ESCALATED|SATISFIED|FAILED_*|CANCELLED`.

Persistent state includes observations, plans, plan revisions, tool decisions, task lineage, evidence refs, claim candidates, policy decisions, budget reservations/usage, checkpoints, critic findings, and terminal reason.

Worker/process/model-session death MUST resume from persisted state. No design may depend on continuous model memory.

## 11. Idempotency, concurrency, and eventing

All mutating commands require tenant-scoped idempotency key and expected aggregate version. Use transactional outbox/inbox, optimistic concurrency, bounded leases, duplicate suppression, and compensation where feasible.

Required events include:
- `AgentRunStarted`, `ObservationCaptured`, `PlanCreated`, `PlanRevised`;
- `TaskDelegated`, `ToolAuthorized`, `ToolInvocationCompleted`;
- `EvidenceCaptured`, `ClaimProposed`, `CriticReviewRequested`, `CriticReviewCompleted`;
- domain decision proposed/accepted/rejected events;
- `BudgetThresholdReached`, `AgentRunEscalated`, `AgentRunFailed`, `AgentRunRecovered`;
- monitoring/reopen events where applicable.

Every event uses the canonical tenant/correlation/causation/trace envelope and schema version.

## 12. Security, privacy, and tenant isolation

Security requirements:
- derive tenant context from authenticated workload identity, never payload alone;
- enforce authorization at gateway, service, storage, cache, queue, event, object, model-context, and export boundaries;
- redact or tokenize sensitive values before model use;
- prohibit secrets in prompts, evidence excerpts, screenshots, logs, and traces;
- encrypt in transit and at rest;
- record provider/license/terms/consent decisions;
- fail closed on tenant mismatch or policy uncertainty;
- prevent prompt injection from source documents/web content from becoming instructions;
- treat retrieved text, documents, emails, and provider payloads as untrusted data;
- use allowlisted tools/capabilities and output schemas;
- run cross-tenant negative tests and malicious-content tests before production.

## 13. Human authority

`A3` is the default ceiling, not a self-grant. Human review is mandatory when tenant policy requires it, material ambiguity remains above threshold, a legal/ethical representation is requested, sensitive data use is uncertain, or the action would exceed reversible/research authority.

The agent may never approve its own policy exception, autonomy increase, security exception, or consequential self-certification.

## 14. Economics and stopping

Before each expensive action, estimate expected information/value gain against marginal monetary, token, latency, provider, and opportunity cost. Stop, narrow, or escalate when:
- success criteria are met;
- decisive evidence is unobtainable under permitted sources;
- cost ceiling is reached;
- additional research has low expected marginal value;
- duplicate/equivalent work already exists;
- policy prohibits the remaining paths;
- deadline makes further research non-actionable.

Budget exhaustion returns a bounded partial result with gaps; it never silently downgrades quality.

## 15. Failure taxonomy and recovery

Classify failures as RETRYABLE_TRANSIENT, RATE_OR_CAPACITY, VALIDATION, POLICY_OR_AUTHORITY, DATA_AMBIGUITY_OR_CONTRADICTION, DUPLICATE_OR_CONCURRENCY, STATE_CORRUPTION, SECURITY_TENANT, or TERMINAL_EXTERNAL.

Recovery starts from persisted truth and verifies workflow state, outbox/inbox, child lineage, evidence integrity, policy snapshot, budget reservations, and side effects. Permitted outcomes are resume, idempotent replay, compensate, abandon, quarantine, monitor, or human action. Previously captured evidence remains immutable.

## 16. Observability and SLO requirements

Metrics MUST cover:
- objective completion and downstream acceptance;
- precision/recall where observable, false-positive/false-negative and abstention rates;
- calibration by confidence band and evidence class;
- evidence completeness, source independence, freshness, and contradiction rate;
- plan revisions and justified adaptation;
- critic overturn/research-more/block rate;
- cost, tokens, tool calls, provider use, and latency;
- retries versus replans, recovery, duplicate suppression, and orphan rate;
- policy denials, tenant-isolation attempts, and sensitive-data redaction failures.

SLO values are configured from measured platform requirements, not invented in the specification. Production approval requires measured SLO/error-budget evidence.

## 17. Evaluation suite

Minimum evaluation:
- domain gold set with difficult negatives and ambiguous cases;
- calibration and abstention tests;
- temporal-change and stale-source cases;
- copied-source/circular-citation cases;
- entity collision and attribution traps;
- prompt-injection and malicious-document cases;
- policy, prohibited-data, and cross-tenant attacks;
- worker death at every durable boundary;
- duplicate, delayed, reordered, and poison events;
- provider outage/rate shock/model fallback;
- budget exhaustion and cancellation;
- load, soak, chaos, backup/restore, regional recovery, and kill-switch tests;
- critic-independence tests;
- migration/schema compatibility tests.

No test may be marked passing without execution evidence.

## 18. Agent-specific acceptance tests

The following domain dimensions are blocking:
- `ENTITY_STATE`: gold-set accuracy, negative-case safety, temporal semantics, evidence sufficiency, contradiction behavior, and calibrated abstention.
- `CLAIMS_AND_EVIDENCE`: gold-set accuracy, negative-case safety, temporal semantics, evidence sufficiency, contradiction behavior, and calibrated abstention.
- `RELATIONSHIPS`: gold-set accuracy, negative-case safety, temporal semantics, evidence sufficiency, contradiction behavior, and calibrated abstention.
- `OPPORTUNITIES`: gold-set accuracy, negative-case safety, temporal semantics, evidence sufficiency, contradiction behavior, and calibrated abstention.
- `TEMPORAL_VERSIONS`: gold-set accuracy, negative-case safety, temporal semantics, evidence sufficiency, contradiction behavior, and calibrated abstention.
- `CONFLICTS_AND_UNCERTAINTY`: gold-set accuracy, negative-case safety, temporal semantics, evidence sufficiency, contradiction behavior, and calibrated abstention.

Acceptance also requires demonstration of multi-cycle replanning, bounded delegation, no duplicate consequential effect, complete provenance, tenant isolation, recovery after interruption, and a final independent score ≥95/100 with no blocking category failure.

## 19. Implementation artifacts

Implementation MUST produce:
1. registration/capability manifest;
2. goal/observation/decision schemas;
3. migrations and indexes with tenant/version keys;
4. durable workflow and activities;
5. typed tool/delegation adapters;
6. policy/budget/idempotency middleware;
7. model prompt/version + structured-output schemas;
8. event producers/consumers and DLQ handling;
9. APIs for inspect/pause/resume/cancel/recover;
10. metrics/traces/audit/dashboard definitions;
11. unit/property/contract/integration/E2E/adversarial/load/recovery tests;
12. ADRs and runbooks;
13. requirement-to-code-and-test traceability.

## 20. Production gate and truthful status

This document completes the specification for `BEN-KNW-01`. It does **not** claim runtime implementation, executed tests, live-provider validation, a production score, or production readiness.

Production status may be asserted only after G0–G5 evidence exists and the enterprise scorecard returns at least 95/100 with every blocking category passed.
