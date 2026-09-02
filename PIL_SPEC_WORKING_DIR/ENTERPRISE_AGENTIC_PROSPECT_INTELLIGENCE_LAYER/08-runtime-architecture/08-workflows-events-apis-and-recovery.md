# Workflows, Events, APIs, and Recovery Architecture

**Document ID:** PIL-RUN-008  
**Version:** 1.0.0  
**Status:** Normative

## 1. Durable workflow law

No model session, process, or worker is presumed alive. Goals, runs, plans, tasks, timers, joins, approvals, budget reservations, and compensation state are durable. State mutations and outbox events commit atomically. Consumers use inbox deduplication and idempotent handlers.

## 2. Canonical workflows

### Goal lifecycle

`PROPOSED → VALIDATED → ACTIVE → PLANNING → RESEARCHING/EXECUTING → OBSERVING → REPLANNING → QUALIFIED/DISQUALIFIED/ENGAGEMENT_READY/MONITORING → SATISFIED`

Holding/failure states: `PAUSED`, `BLOCKED_POLICY`, `BLOCKED_HUMAN`, `RESEARCH_STALE`, `FAILED_RECOVERABLE`, `FAILED_TERMINAL`, `SUPERSEDED`, `REOPENED`.

### Research strategy lifecycle

`OBJECTIVE_RECEIVED → CONTEXT_VALIDATED → INTENT_STRUCTURED → ALTERNATIVES_CREATED → STRATEGY_SELECTED → POLICY_VALIDATED → CRITIC_REVIEWED_WHEN_REQUIRED → PUBLISHED → MONITORED → REVISED/SUPERSEDED`.

### Delegation lifecycle

`CREATED → AUTHORIZED → BUDGET_RESERVED → DISPATCHED → ACCEPTED → RUNNING → SUCCEEDED/FAILED/CANCELLED/EXPIRED → EVALUATED → BUDGET_RECONCILED`.

## 3. Event envelope

All events include event ID, schema version, tenant, aggregate ID/version, occurred time, producer, correlation, causation, trace, policy snapshot, and typed payload. Events are immutable. Consumers never infer tenant from payload content.

Core taxonomy includes goal, plan, strategy, delegation, tool authorization, evidence, claim, contradiction, critic, qualification, budget, monitoring, failure, recovery, human decision, and configuration events. Breaking schema changes use a new major version; additive optional fields use minor versions with consumer compatibility tests.

## 4. API architecture

APIs are versioned, authenticated, authorized, tenant-derived, paginated, rate-limited, and schema validated. Mutations require idempotency key and expected aggregate version. Errors use stable codes and trace IDs without sensitive detail.

Minimum surfaces:

- goals: create, validate, activate, pause, resume, supersede, inspect;
- strategies: propose, compare, approve where required, publish, supersede, inspect lineage;
- runs/tasks: inspect, cancel, retry-safe recover, view decisions/evidence/cost;
- prospects/graph/evidence: tenant-scoped queries and point-in-time views;
- policies/providers/tools: read approved snapshots; privileged controlled administration;
- human review: claim, approve, reject, correct, expire;
- operations: health, metrics, dead letters, quarantines, replay-safe recovery, kill switches.

## 5. Failure taxonomy

- `RETRYABLE_TRANSIENT`: bounded retry with exponential backoff and jitter.
- `RATE_OR_CAPACITY`: backpressure, timer, circuit breaker, permitted fallback.
- `VALIDATION`: no unchanged retry; correct or block.
- `POLICY_OR_AUTHORITY`: no unchanged retry; replan within permission or escalate.
- `DATA_AMBIGUITY_OR_CONTRADICTION`: specialist investigation.
- `DUPLICATE_OR_CONCURRENCY`: idempotent prior result or optimistic-conflict re-observation.
- `STATE_CORRUPTION`: quarantine and recovery investigation.
- `SECURITY_TENANT`: fail closed and incident response.
- `TERMINAL_EXTERNAL`: bounded partial output and explicit failure.

Retries repeat the same authorized action after transient failure. Replanning changes the action based on observation. These must be separately recorded.

## 6. Recovery

Recovery begins from persisted truth, not model recollection. It verifies workflow state, outbox/inbox status, leases, child lineage, evidence integrity, budget reservations, policy version, and side effects. It selects resume, replay idempotently, compensate, abandon, quarantine, or require human action. Evidence already collected remains immutable.

Dead-letter replay requires root-cause classification, corrected condition, authorization, idempotency proof, scoped batch, dry-run where possible, operator identity, and post-replay reconciliation.

## 7. Observability

Use correlated metrics, logs, traces, and append-only audit. Required views include goal/strategy progress, agent decisions, task topology, evidence gaps, costs, provider health, policy denials, failures, recoveries, critic outcomes, and tenant-isolation alerts. High-cardinality identifiers belong in traces/audit rather than unrestricted metric labels.

## 8. Testing

- event producer/consumer compatibility;
- duplicate, delayed, reordered, and poison events;
- worker death at every transaction boundary;
- outbox publication interruption;
- timer, lease, and join recovery;
- optimistic concurrency conflicts;
- budget reservation and compensation failures;
- circuit breaker and fallback;
- dead-letter quarantine and scoped replay;
- cross-tenant envelopes and forged tenant payloads;
- API idempotency, pagination, authorization, and version conflicts;
- recovery preserves evidence and prevents duplicate consequential effects.

