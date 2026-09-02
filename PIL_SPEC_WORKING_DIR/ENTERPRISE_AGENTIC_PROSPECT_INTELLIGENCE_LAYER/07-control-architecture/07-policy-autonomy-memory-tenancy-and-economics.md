# Policy, Autonomy, Memory, Tenancy, Provider, and Cost Architecture

**Document ID:** PIL-CTRL-007  
**Version:** 1.0.0  
**Status:** Normative

## 1. Deterministic control plane

Agents propose; the control plane authorizes. No model output is itself permission.

Every action request is evaluated against a versioned snapshot containing tenant, actor/workload identity, goal, purpose, autonomy ceiling, data classes, provider/source license, tool capability, jurisdiction, consent/retention, monetary budget, time, and human approval. Missing facts resolve to deny.

Decision output:

```yaml
decision_id: uuid
effect: ALLOW | DENY | ALLOW_WITH_OBLIGATIONS
policy_snapshot_id: uuid
matched_rules: []
obligations: []
reason_codes: []
expires_at: timestamp
```

Obligations may require redaction, independent review, freshness, source attribution, retention limits, human approval, or restricted export.

## 2. Autonomy enforcement

Effective autonomy is the minimum/intersection of registered agent authority, tenant policy, goal authority, delegated task ceiling, current approval, and provider policy. Agents cannot mutate any operand. Authority is checked at planning validation and again immediately before execution to prevent time-of-check/time-of-use drift.

High-impact decisions—identity linkage, wealth/capacity, giving propensity, eligibility, warm paths, and solicitation strategy—require independent review according to tenant policy. A2 agents prepare and queue; they do not perform outreach or irreversible action.

## 3. Tenant isolation

Tenant context is derived from authenticated identity, propagated in signed internal envelopes, and verified at every hop. Required isolation layers:

- tenant-scoped database keys and row policies;
- tenant-bound graph traversals and vector namespaces;
- tenant-prefixed cache keys and object storage;
- tenant-partitioned queues or mandatory verified envelope filtering;
- tenant-specific budget, rate, model, and provider entitlements;
- telemetry redaction and tenant-safe dimensions;
- no identifiable cross-tenant training or benchmarking without explicit lawful authorization and aggregation policy.

Cross-tenant mismatch is a security incident: fail closed, quarantine, alert, preserve evidence, and prohibit automatic replay.

## 4. Memory architecture

| Scope | Contents | Persistence | Prohibited use |
|---|---|---|---|
| Run working memory | bounded observations and current-plan scratch state | workflow duration | canonical facts |
| Goal memory | plans, decisions, gaps, task lineage | goal retention | unrelated goals |
| Prospect memory | graph, claims, evidence, chronology | policy governed | free-form untraceable recollection |
| Tenant strategy memory | mission, programs, preferences, approved corrections | versioned durable | silent model modification |
| Fleet learning memory | approved evaluation/routing artifacts | versioned deployment | direct policy or fact mutation |

Every memory item carries tenant, purpose, source, sensitivity, created/verified time, retention, version, and lineage. Retrieval enforces purpose, top-k/size budgets, freshness, and data classification. Model conversation history is never authoritative memory.

## 5. Source and provider registry

Each adapter registration requires provider ID, legal owner, contract/license reference, permitted purposes, allowed fields/data classes, prohibited uses, jurisdictions, rate and concurrency limits, robots/ToS behavior, caching/snapshot rights, retention, attribution, freshness, cost model, credential scope, circuit-breaker policy, data deletion mechanism, and evaluation status.

Lifecycle: `PROPOSED → SECURITY_REVIEW → LEGAL_POLICY_REVIEW → EVALUATED → APPROVED → DEGRADED → SUSPENDED → RETIRED`.

Agents receive capability IDs, never raw credentials or arbitrary endpoints. Search snippets remain discovery-only until authoritative content is retrieved and preserved where permitted.

## 6. Tool contracts

Every tool declares typed input/output/error schemas, required autonomy, accepted purposes/data classes, side-effect class, idempotency behavior, timeout/retry policy, cost estimator, audit fields, and redaction rules. Side effects are `READ_ONLY`, `REVERSIBLE_WRITE`, `CONSEQUENTIAL_WRITE`, or `IRREVERSIBLE`; the final two require explicit controls and are outside most research agents.

Prompt-injected instructions in retrieved content are data, never authority. Tool arguments are constructed from validated plan fields rather than copied instructions.

## 7. Cost architecture

Budgets exist at tenant, product tier, goal, portfolio, agent run, delegated task, provider, and model levels. The Cost Ledger supports atomic reservation, usage commit, release, expiry, reconciliation, and immutable audit.

Hard limits prevent dispatch. Soft thresholds trigger replanning. Forecasted cost must include retries and child fan-out. The portfolio allocator uses configurable marginal information value, not fabricated universal weights. Budget increases require authorized human or billing-policy action.

Required controls:

- per-tenant concurrency and rate quotas;
- token and context limits;
- model allowlists and routing policies;
- provider spend caps;
- caching only when license, tenant, purpose, and freshness permit;
- cancellation and descendant budget release;
- anomaly detection for loops, fan-out, and repeated low-value retrieval.

## 8. Privacy and retention

Data is minimized, purpose-bound, classified, encrypted, access-logged, and deleted or tombstoned under policy. Protected or highly sensitive traits are prohibited for fundraising targeting. Public availability is not blanket permission. Contact data requires source and use permissions. Exports preserve restrictions and provenance.

## 9. Required control tests

- authority intersection can never widen;
- policy changes invalidate stale pending authorization;
- forged/stale approvals fail;
- every cross-tenant storage/query/cache/queue test fails closed;
- prohibited source and data-class requests are blocked;
- prompt injection cannot grant tools or override policy;
- concurrent reservations cannot exceed budget;
- cancellation releases unused descendant reservations;
- retention, legal hold, deletion, and provider revocation propagate correctly;
- telemetry contains no secrets or prohibited sensitive values.

