# Evaluation and Production-Readiness Architecture

**Document ID:** PIL-EVAL-014  
**Version:** 1.0.0  
**Normative:** Yes

## Evaluation layers

1. Schema and contract conformance.
2. Deterministic service correctness.
3. Agent-loop authenticity and adaptation.
4. Domain-task quality and calibration.
5. Evidence/provenance and critic independence.
6. Security, privacy, policy, and tenant isolation.
7. Reliability, concurrency, recovery, and chaos.
8. Cost, latency, scale, and marginal-value efficiency.
9. Human usability, correction, and operational control.
10. Outcome learning without uncontrolled self-modification.

## Dataset governance

Gold datasets are versioned by domain and risk. Every case contains input snapshot, permitted sources/tools, expected decision boundaries, evidence ground truth, acceptable uncertainty, prohibited behavior, budget, and evaluator rubric. Include sparse, ambiguous, contradictory, stale, negative, adversarial, high-value, and policy-variation cases. Training and evaluation sets are separated; contamination checks are recorded.

## Agent authenticity gates

An agent must demonstrate persistent goal state, at least two action alternatives where available, authorized tool/delegation choice, result evaluation, justified plan revision, durable restart, explicit stop/escalation, and reconstructable decision lineage. A single-pass successful tool call does not pass.

## Quality and calibration

Measure precision, recall where ground truth permits, evidence completeness, source independence, contradiction detection, identity error, false qualification, calibration/Brier or suitable scoring, human correction, critic overturn, downstream acceptance, and outcome lift. Segment by domain, prospect class, evidence sparsity, geography, model, provider, and policy version without using protected traits for targeting.

## Security and reliability gates

Blocking failures include cross-tenant access, policy/autonomy escalation, prohibited data use, secret leakage, duplicate consequential effect, unbounded recursion/fan-out, evidence loss, unauditable decision, self-certification, unrecoverable ordinary worker failure, or bypassed human gate.

Execute unit/property, contract, integration, end-to-end, adversarial, penetration, load, soak, concurrency, fault-injection, backup/restore, regional recovery, dead-letter replay, kill-switch, and rollback tests. Record actual commands and outputs; skipped is never passed.

## Production progression

`OFFLINE → SHADOW → INTERNAL_TENANT → LIMITED_CANARY → EXPANDED_CANARY → GENERAL_AVAILABILITY`.

Each stage has entrance/exit thresholds, duration/sample requirements, error budget, rollback triggers, kill switch, owner, and approval. Model/prompt/tool/policy/domain-pack changes repeat risk-appropriate evaluation.

## Score and verdict

Use the cumulative 100-point scorecard. Production requires at least 95/100, every blocking gate, no critical unresolved defect, calibrated domain performance, load evidence for declared capacity, operational runbooks, on-call ownership, recovery proof, and rollback. Score is generated from evidence, never preassigned in a specification.

Verdicts: `NOT_READY`, `CONDITIONALLY_READY`, `PRODUCTION_READY`.

## Required report

Include revision IDs, environment, datasets/evaluators, model/provider versions, policy/domain-pack versions, tests pass/fail/skip, metrics with confidence intervals where appropriate, red-team findings, defects, residual risks, SLO/load results, recovery/rollback evidence, score calculation, approvals, and signed gate decision.

