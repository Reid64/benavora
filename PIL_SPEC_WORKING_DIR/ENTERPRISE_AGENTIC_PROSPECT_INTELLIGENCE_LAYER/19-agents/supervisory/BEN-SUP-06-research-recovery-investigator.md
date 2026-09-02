# BEN-SUP-06 — Research Recovery Investigator

**Specification ID:** PIL-AGENT-BEN-SUP-06  
**Version:** 2.0.0  
**Autonomy:** A3 — reversible recovery only  
**Criticality:** Tier 0 integrity control  
**Cadence:** Event-driven plus governed anomaly sweeps  
**Human boundary:** destructive or irreversible repair, ambiguous external compensation, cross-tenant remediation, policy exceptions, canonical evidence deletion, identity merge/split  
**Status:** Specification remediated; implementation readiness requires executed G0–G5 evidence

## 1. Chain-It directive

Implement a durable forensic investigator and bounded recovery decision-maker. Before code changes, inspect repository instructions, constitution, registries, recovery contracts, workflow/event architecture, persistence, evidence graph, outbox/inbox, leases, idempotency, policy, budget, operators, observability, deployment, and tests. Produce repository, trust-boundary, failure-surface, and requirement-traceability maps. Reuse canonical primitives. Never invent checkpoints, provider outcomes, schemas, results, or readiness.

This is not a retry button or log summarizer. Implement persistent contain–preserve–observe–hypothesize–plan–diagnose–evaluate–replan–authorize–recover–validate behavior with typed forensic evidence, alternative comparison, deterministic safety gates, bounded tools, immutable lineage, and human escalation.

## 2. Mission and accountable outcome

Diagnose failed, incomplete, contradictory, duplicated, abandoned, stalled, or corrupted research execution and restore trustworthy progress without duplicated effects, corruption laundering, evidence loss, authority widening, budget leakage, or history rewriting.

Success requires reconstruction of the last verifiable state; root and contributing cause analysis; blast-radius determination; evidence preservation; side-effect reconciliation; comparison of safe alternatives; execution of authorized reversible recovery; independent validation; residual-risk disclosure; and an explicit terminal verdict.

## 3. Non-goals

The agent never treats all failures as retryable, assumes a missing acknowledgement means no effect, manufactures checkpoints from logs or model memory, rewrites history, rebuilds canonical truth from projections, widens authority, auto-repairs cross-tenant signals, deletes immutable evidence, performs destructive rollback, resolves ambiguous identity, or validates its own consequential recovery.

## 4. Recovery invariants

1. Contain first and preserve before mutation.
2. Durable stores and verified receipts outrank logs and narrative.
3. Unknown effect status is not “not executed.”
4. Replay requires idempotency proof and effect reconciliation.
5. Canonical evidence cannot be reconstructed from cache, projection, summary, or memory.
6. Effective authority is intersected and can only narrow.
7. Cross-tenant evidence/effects trigger quarantine and security escalation.
8. Original failures, decisions, and artifacts remain immutable.
9. Partial or unvalidated recovery cannot be resolved.
10. Compensation is authorized, semantic, observable, and validated.
11. High-consequence recovery requires independent validation.
12. Kill switch, cancellation, policy, and deadline apply at every mutation.

## 5. Incident taxonomy and triggers

Support abandoned/stalled workflows, connector failure, partial commit, duplicate execution/effect, workflow or aggregate corruption, graph/index/cache corruption, evidence integrity failure, budget inconsistency, missing/duplicate/reordered/poison events, orphan descendants, stale leases/fencing, policy TOCTOU, schema/model/tool corruption, cross-tenant signals, and unknown anomalies.

Triggers may originate from deterministic workflow, invariant, audit, outbox/inbox, budget, evidence, policy, operator, or security controls. Detection services remain separate from the agent.

RecoveryTrigger.v2 requires trigger and tenant identities, detector/version, incident/severity, affected references, symptoms, invariant/evidence references, policy and authority, classification, correlation/causation, idempotency key, deadline, budget, and schemas. Reject unsigned, malformed, expired, tenant-mismatched, authority-inconsistent, or conflicting duplicate triggers.

## 6. Typed case and forensic contracts

RecoveryCase.v2 stores immutable trigger linkage, case version, containment state, evidence integrity, external-effect certainty, blast-radius hypothesis, owner, lease/fencing token, goal, budget, and status.

ForensicObservation.v2 records queried system/object/version, authorization, query hash, observation time, returned hash/value, provenance, consistency level, canonical/derived/ephemeral class, expected and observed invariant, reliability, freshness, limitations, and chain of custody.

Required observations include workflow history, aggregate versions, transactions, idempotency ledger, leases, outbox/inbox, broker offsets, tool ledger, provider receipts, evidence hashes, object versions, graph changes, budgets, policy decisions, deployments, flags, audit anchors, and operator actions where applicable. Logs and traces only corroborate.

## 7. Preservation and chain of custody

PreservationManifest.v2 identifies case scope, source objects/versions, cryptographic hashes, signed times, collector, retention/legal hold, encryption/key references, access controls, and immutable locations.

Use consistent snapshots or document inconsistency; avoid business effects; retain original suspect artifacts; separate evidence and working copies; audit every access; apply governed redaction while preserving verification; support independent reconstruction. Preservation failure blocks automated mutation except explicitly authorized containment.

## 8. Durable state machine

Primary states:

DETECTED → VALIDATING → CONTAINING → PRESERVING → OBSERVING → HYPOTHESIZING → DIAGNOSTIC_PLANNING → DIAGNOSING → EVALUATING → REPLANNING or RECOVERY_PROPOSED → AUTHORIZING → RECOVERING → VALIDATING_RECOVERY → CLOSING → RESOLVED.

Exceptional states are WAITING_DEPENDENCY, WAITING_HUMAN, BUDGET_CONSTRAINED, CANCEL_REQUESTED, CANCELLED, QUARANTINED, HUMAN_REQUIRED, FAILED_RETRYABLE, and FAILED_TERMINAL.

Every transition persists prior state, case version, reason, actor, attempt, fencing token, hashes, policy/authority, budget delta, time, and audit anchor. Compare-and-swap prevents double transition. Terminal changes require a linked case.

## 9. Persistent agentic loop

1. Goal: bind safe terminal conditions and prohibited outcomes.
2. Contain: pause propagation with least-disruptive authorized control.
3. Preserve: capture immutable evidence.
4. Observe: reconstruct durable and external state.
5. Hypothesize: generate multiple falsifiable causes.
6. Plan: rank diagnostics by information gain, safety, cost, and deadline.
7. Select: invoke permitted read-only tools or bounded specialists.
8. Act: execute diagnostics and update causal/blast-radius maps.
9. Evaluate: test hypotheses and recovery prerequisites.
10. Replan: revise when evidence, scope, policy, or uncertainty changes.
11. Authorize: apply deterministic recovery and human gates.
12. Recover: execute one versioned reversible plan.
13. Validate: reconcile invariants using independent validators.
14. Terminate: RESOLVED, HUMAN_REQUIRED, QUARANTINED, or FAILED_TERMINAL.

Bound iterations, time, tools, retrieved bytes, and spend. Repeated hypothesis/observation/plan signatures trigger safe escalation.

## 10. Causal and blast-radius analysis

CausalHypothesis.v2 contains causal claim, components, predicted observations, disconfirming/supporting evidence, confidence interval, alternatives, diagnostics, and status. Maintain multiple plausible hypotheses until deterministically disproven; never confuse correlation with cause.

AffectedStateMap.v2 models workflows, tasks, artifacts, events, evidence, projections, external effects, budgets, policies, tenants, and dependencies as typed nodes/edges marked confirmed, probable, possible, cleared, or unknown. Propagation stops at verified transaction, tenant, authorization, and version boundaries.

## 11. Recovery alternatives and calculus

Evaluate verified checkpoint resume, idempotent replay, subtree re-execution, semantic compensation, derived-state rebuild, reversible rollback, abandon/restart, quarantine, and human repair where applicable.

RecoveryAlternative.v2 records prerequisites, scope, effect certainty, idempotency proof, authority, policy, evidence impact, data-loss and duplicate-risk, cost, downtime, rollback/compensation, validation, and residual risk.

Deterministic gates reject failed tenant/policy/authority checks, missing preservation, uncertain non-idempotent effects, unverified checkpoints, destructive automation, insufficient budget, or missing validation. Among admissible options, minimize integrity loss, harm, irreversibility, recurrence, downtime, and cost using versioned policy priorities and sensitivity analysis.

## 12. Replay, side-effect, and checkpoint proof

IdempotencyProof.v2 includes command identity, semantic operation, scope, mechanism, dedupe window, ledger record, request/response hashes, provider receipt, reconciliation time, ambiguity, and verifier.

Effect states are CONFIRMED_NOT_EXECUTED, CONFIRMED_EXECUTED_ONCE, CONFIRMED_EXECUTED_MULTIPLE, COMPENSATED, PARTIALLY_EXECUTED, and UNKNOWN. Replay is prohibited for unknown, partial, or non-idempotent effects without human-approved reconciliation.

CheckpointProof.v2 includes run/checkpoint/version, committed transaction, aggregate versions, event positions, outbox/inbox, children, budgets, policy/authority, evidence hashes, schema/runtime compatibility, and verifier. Logs, traces, or summaries cannot substitute.

## 13. Compensation and derived rebuild

Compensation is a new auditable business action, not deletion. CompensationPlan.v2 specifies original effect, semantic inverse/mitigation, authority, policy, target, idempotency, order, partial-failure behavior, validation, forward-fix/rollback, and human gate.

Derived state rebuilds only from verified canonical inputs. RebuildPlan.v2 records source/version, projection definition, target namespace, shadow build, comparison thresholds, cutover, rollback, cache invalidation, and validation. Prefer shadow build and atomic switch over in-place overwrite.

## 14. Authority and human control

Effective authority intersects constitution, tenant, agent, incident grant, classification, tool, safety, and action policy.

A3 may pause work, quarantine reversible state, preserve evidence, run read-only diagnostics, release proven-unused reservations, rebuild derived state from verified truth, resume verified checkpoints, replay proven-idempotent commands, and perform explicitly approved reversible compensation.

H1/H2 is mandatory for destructive/irreversible repair, ambiguous compensation, evidence deletion, cross-tenant remediation, policy exception, identity merge/split, exposure decisions, or excessive residual risk. Operators may narrow, cancel, approve a bounded action, or execute human-only steps, but cannot erase lineage or label unknown effects safe.

## 15. Commands, APIs, queries, and events

Commands include OpenRecoveryCase.v2, ContainRecoveryCase.v2, SubmitRecoveryEvidence.v2, ProposeRecoveryPlan.v2, AuthorizeRecoveryPlan.v2, ExecuteRecoveryPlan.v2, CancelRecoveryCase.v1, QuarantineRecoveryCase.v2, RecordHumanRecoveryAction.v1, and CloseRecoveryCase.v2.

Queries expose status/timeline, preservation, observations, hypotheses, affected map, alternatives, proofs, authorization, actions, validation, budgets, risks, and audit.

Events cover opened, contained, preserved/failed, hypothesis created/falsified, scope expanded, plan proposed/rejected/authorized, human requested, action started/completed/failed, validation passed/failed, quarantined, resolved, and terminal failure.

Interfaces are versioned, authenticated, authorized, tenant-scoped, idempotent where mutating, rate-limited, auditable, and machine-documented. Consumers tolerate duplicates and reordering.

## 16. Persistence, concurrency, and migrations

Persist cases, triggers, containment, preservation, observations, hypotheses, affected-state graphs, diagnostics, alternatives, proofs, authorizations, actions, compensations, validations, transitions, leases, budgets, human actions, events, and audit anchors.

Require tenant keys/constraints, append-only forensic and decision history, optimistic concurrency and fencing, transactional outbox, idempotency ledger, encryption, retention/legal hold, exact version references, forward/rollback and mixed-version migrations, row-level or equivalent isolation with negative tests, and measured partition/archive design. Do not assume storage technology before discovery.

## 17. Failure and recursive recovery

Forensic store outage keeps containment and escalates deadline. Hash mismatch quarantines dependent state. Policy change stops mutation and replans. Validator disagreement prevents resolution. Action timeout requires effect reconciliation before retry. Worker death resumes with a fresh fencing token. Duplicate commands return the prior result. Stale case writes fail. Budget exhaustion contains and escalates. Cross-tenant signal quarantines. Reproduced faults stop repetition and reopen causal analysis. Failed compensation remains visible and requires forward-fix, quarantine, or human action.

A linked child case may investigate recovery-action failure, but depth, retries, and aggregate budget are bounded. The same plan cannot replay recursively.

## 18. Independent validation

RecoveryValidationReport.v2 is produced by deterministic validators and, for consequential recovery, an independent agent/session.

Validate workflow and aggregate invariants; exact effect count/state; outbox/inbox/broker reconciliation; parent/child dependencies; evidence integrity; graph/projection agreement; budget conservation; policy/authority; tenant isolation; absence of orphan work; recurrence monitors; and rollback/forward-fix readiness.

RESOLVED requires every mandatory validation. Accepted residual risk must be policy-permitted, attributable, time-bounded, and nonblocking.

## 19. Security, privacy, and forensic integrity

Threats include spoofed triggers, forged checkpoints/receipts, evidence tampering, privilege escalation through recovery, cross-tenant repair, replay/compensation abuse, poisoned diagnostics, prompt injection, secret exposure, audit deletion, kill-switch bypass, malicious operator, and recovery-induced denial of service.

Controls include signed triggers, workload identity, least privilege, dual control, per-access tenant authorization, immutable hashes/signatures, forensic retention, structured tool I/O, content/data separation, secret references, encryption, egress/provider allowlists, anomaly detection, rate/blast limits, kill switch, break-glass audit, dependency pinning/SBOM, and tamper-evident anchors. Automated negative tests and independent evidence are mandatory.

## 20. Memory, observability, and operations

Tenant-scoped case memory stores symptoms, hypotheses, diagnostics, causes, plans, outcomes, recurrence, and decisions, never canonical prospect truth. Learning proposals for detectors/playbooks require versioned offline evaluation, review, canary, monitoring, and rollback. Online authority, action, verdict, or safety-rule modification is prohibited.

Metrics include time to detect/contain/preserve/diagnose/recover/validate, case age, cause, blast radius, hypothesis revisions, diagnostic yield, orphan/duplicate rates, replay suppression, evidence integrity, budget reconciliation, validation failure, recurrence, escalation, quarantine, cost, and noisy-neighbor effects.

Trace every trigger, containment, preservation item, forensic read, hypothesis, plan, tool/delegation, decision, authorization, action, compensation, validation, and close. Logs are structured, redacted, correlated, tenant-aware, and retention-governed.

SLOs cover containment, preservation, recovery integrity, completion, audit, isolation, RTO/RPO, and recurrence. Numeric targets require measured rationale. Operator controls include inspect, pause/resume, contain, cancel, quarantine, dry-run, approve/reject, human execution, kill switch, dead-letter inspection, safeguarded replay, audit export, rollback/forward-fix, and post-incident review.

## 21. Agent-specific evaluation dataset

Maintain adjudicated versioned cases for crashes around every transaction; timeout with unknown effect; duplicate commands/effects; missing/reordered events; partial outbox/inbox; stale lease/split brain; orphan child; corrupt projection with intact evidence; corrupt evidence; budget leak/double release; policy change; schema mismatch; repeated recovery fault; failed compensation; cross-tenant poison; benign delayed workflow; identity ambiguity mistaken for corruption; and regional failover/failback.

Measure diagnosis accuracy, containment safety, root-cause ranking, blast-radius precision/recall, plan selection, unnecessary intervention, duplicate prevention, preservation, budget conservation, recovery success, recurrence, escalation correctness, calibration, cost, and latency with confidence intervals and adjudicator disagreement.

## 22. Required test program

Unit/property tests prove containment-before-mutation; non-widening authority/scope; deterministic unsafe-plan rejection; replay proof; canonical-source requirement; budget/effect conservation; immutable terminal lineage; idempotent commands; fencing; and deterministic scoring.

Contract/integration tests cover malformed/unknown versions; interface parity; forward/rollback and mixed-version migrations; workflow/outbox/inbox/ledger/evidence/graph/policy/budget/audit reconciliation; ambiguous receipts; containment/cancel/kill-switch propagation; human gates; independent validator separation; recursion limits; and cross-tenant negatives.

End-to-end, adversarial, chaos, and DR tests kill workers at every boundary; duplicate/reorder/drop events; expire leases; corrupt checkpoints/projections/hashes; inject timeout/throttling; fail databases, brokers, policy, model, and object stores; create budget leaks; fail compensation; trigger regional failover; and restore backups.

Test forged triggers/proofs, prompt injection, poisoned artifacts, privilege escalation, IDOR, cross-tenant IDs, replay abuse, malicious operators, audit tampering, secret/PII leakage, kill-switch bypass, and evaluator gaming. Demonstrate no illegal mutation, no lost lineage, no duplicated unproven effect, isolation, and measured RTO/RPO.

## 23. Performance, deployment, ADRs, and runbooks

Derive workloads from tenant/workflow volume, incident rate/bursts, graph size, forensic volume, concurrency, retention, and topology. Test steady, burst, soak, saturation, failover, and noisy-neighbor conditions. Report throughput, queue age, percentile latency, contention, storage/telemetry growth, model/tool use, cost, scale inflections, and degradation with reproducible raw evidence.

Recovery economics must use a multidimensional BudgetEnvelope covering currency, model tokens, tool calls, provider quotas, database work, storage, elapsed time, diagnostic fan-out, and operator effort. Reserve before work, reconcile after every diagnostic or recovery action, release verified unused capacity, and preserve an append-only ledger. The agent must compare the expected value of another diagnostic with its cost and the risk of acting under uncertainty. Exhausting one hard dimension blocks further automated work even if other dimensions remain. Budget increases require the authority defined by tenant policy and cannot be silently borrowed from unrelated cases.

Error handling must use a typed taxonomy: validation, authentication, authorization, policy, tenant-isolation, evidence-integrity, concurrency, lease/fencing, idempotency, provider ambiguity, transient dependency, permanent dependency, budget, deadline, cancellation, compensation, validation disagreement, and terminal corruption. Each error type defines retry eligibility, maximum attempts, backoff and jitter, circuit-breaker behavior, state transition, containment requirement, operator visibility, and whether the attempt consumes budget. An unchanged retry is prohibited for policy, tenant, integrity, authorization, or deterministic validation failures.

Model and tool routing must be policy governed. Selection considers consequence, structured-output reliability, context requirement, approved region, data classification, latency, cost, and current evaluation status. Fallbacks cannot weaken schema, policy, isolation, independence, or recovery gates. Every prompt, model, tool, configuration, and fallback version is recorded. Provider degradation must lead to bounded waiting, an approved equivalent, partial diagnostic status, or escalation—not invented observations.

Backups and disaster recovery are part of the recovery system rather than assumptions beneath it. Certification must prove restoration of case state, immutable preservation manifests, audit anchors, idempotency ledgers, outbox/inbox state, policy snapshots, and encryption access in an isolated environment. Restore tests must reconcile hashes and counts before workflows resume and must demonstrate that stale restored fencing tokens cannot authorize mutation.

Version detectors, playbooks, schemas, prompts, models, tools, policies, and flags. Roll out via offline replay, shadow recommendations, dry-run, tenant canary, limited reversible actions, monitored expansion, and GA only after gates. Rollback preserves cases, evidence, proofs, actions, and compatibility; false-safe or isolation regression halts rollout.

ADRs cover containment, forensic storage, custody, causal analysis, checkpoint/effect proof, recovery calculus, compensation, rebuild, persistence, authority, validation independence, tenancy, and learning.

Runbooks cover containment failure, evidence corruption, policy outage, ambiguous/duplicate effect, tenant incident, budget inconsistency, stuck recovery, compensation failure, saturation, outbox backlog, provider outage, kill switch, rollback, DR, and audit export. Each defines trigger, diagnosis, safe action, owner, evidence preservation, verification, and post-incident review.

## 24. Acceptance gates G0–G5

G0 requires evidenced repository, trust, failure, owner, schema, deployment, recovery, and rollback discovery.

G1 requires constitutional containment, preservation, bounded authority, immutable history, tenant isolation, human control, and independent validation traced to code/tests.

G2 requires machine validation of triggers, cases, observations, hypotheses, maps, alternatives, proofs, plans, actions, validation, errors, commands, events, and compatibility.

G3 requires executed deterministic state reconstruction, authority/policy intersection, checkpoint/idempotency/effect proof, safety gates, budget conservation, concurrency, and audit integrity.

G4 requires executed multi-hypothesis diagnosis, information-gain planning, evidence-driven replanning, alternative comparison, bounded recovery, recurrence handling, and independent validation.

G5 requires security, privacy, isolation, calibration, false-safe/false-intervention, load, soak, chaos, DR, observability, rollback, documentation, and independent scorecard with no blocking failures. A score ≥95/100 is reportable only from attached executed evidence.

## 25. Required final implementation report

Return requirement traceability; repository/trust maps; schemas, migrations, workflows, interfaces, controls, deployment, rollback; executed tests and resilience results; multi-hypothesis traces; custody proof; idempotency, checkpoint, side-effect, budget, and tenant evidence; calibration/error analysis; measured SLO/capacity/cost; residual risks, skips, failures, waivers, owners, expiry; and governed G0–G5 result.

Never claim enterprise, production, or scale readiness—or a 95–100 score—from specification prose, simulation, assumptions, or skipped/failing evidence.
