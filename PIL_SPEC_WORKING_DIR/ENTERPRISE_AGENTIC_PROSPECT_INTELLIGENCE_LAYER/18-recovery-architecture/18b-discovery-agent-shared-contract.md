# Discovery Agent Shared Contract

All BEN-DIS agents inherit the system constitution and cumulative schemas. A discovery agent owns an open-ended candidate-discovery objective; it is not a crawler or scheduled query.

Each agent must durably execute `GOAL → OBSERVE SEARCH STATE → FORM/REVISE HYPOTHESES → PLAN SOURCE DIVERSITY → SELECT PERMITTED TOOLS/DELEGATE → GATHER SEEDS/EVIDENCE → RESOLVE ENOUGH TO AVOID OBVIOUS DUPLICATES → EVALUATE PRECISION, NOVELTY, COVERAGE, COST AND BIAS → REPLAN/STOP`.

Discovery outputs are provisional candidates, never canonical identity, capacity, propensity, eligibility, or qualification. Every candidate includes tenant, domain, candidate entity/type, discovery rationale, preliminary claim/evidence references, source independence, freshness, confidence, ambiguity flags, exclusion checks, duplicate/work fingerprint, recommended next specialist, cost, plan/run lineage, and limitations.

All agents use adapter capabilities rather than invented endpoints; search snippets are discovery-only; authority is A2; no outreach, private contact harvesting, protected-trait targeting, policy exception, self-qualification, or unsupported wealth claim is allowed. Candidate limits, breadth/depth, source classes, geography, causes, evidence thresholds, and weights come from strategy/Domain Pack/tenant policy.

Minimum testing for every discovery agent: multi-cycle replanning; novel-versus-duplicate handling; sparse and contradictory sources; provider degradation; budget stop; prompt injection; prohibited data/source; cross-tenant denial; duplicate delivery; worker restart; calibration/precision; negative candidates; bias and coverage evaluation; evidence lineage; independent score ≥95 with all blocking gates.

## Version and applicability

**Contract version:** 2.0.0. This contract governs all BEN-DIS agents but does not replace agent-specific specifications. Shared requirements establish the minimum floor; each agent must define its unique candidate type, search hypotheses, evidence semantics, risk model, gold dataset, and downstream handoff.

## Mandatory durable contracts

Every discovery agent implements DiscoveryGoal.v2, DiscoveryObservation.v2, SearchHypothesis.v2, SourcePlan.v2, DiscoveryPlan.v2, DiscoveryCandidate.v2, DiscoveryDecision.v2, DiscoveryGap.v2, WorkFingerprint.v2, DelegatedDiscoveryTask.v2, DiscoveryRunReport.v2, and typed error/event contracts.

All records carry tenant, domain, goal, strategy, plan, run, policy, authority, budget, correlation, causation, schema, model/tool, timestamps, and immutable input/output hashes.

## State machine and concurrency

The durable lifecycle is CREATED, VALIDATING, OBSERVING, HYPOTHESIZING, PLANNING, RESERVING, DISCOVERING, EVIDENCE_LINKING, EVALUATING, REPLANNING, HANDING_OFF, MONITORING, and terminal SATISFIED, EXHAUSTED, PAUSED, BLOCKED_POLICY, BLOCKED_HUMAN, CANCELLED, FAILED_RECOVERABLE, FAILED_TERMINAL, or SUPERSEDED.

Transitions use expected versions, leases/fencing, append-only decisions, transactional outbox, and idempotency keys. Worker death, duplicate commands, reordered events, concurrent runs, cancellation, and plan supersession cannot duplicate candidate delivery or external effects.

## Source and tool governance

Agents select capability IDs from the governed Source and Capability Registries. Adapters own provider-specific endpoints, authentication, rate limits, licensing, schemas, and normalization. Agents never construct arbitrary provider calls.

Each source observation records source identity/tier, underlying-source group, locator, snapshot hash, publication/effective/retrieval times, allowed purpose, retention, geographic and entity applicability, and limitations. Search snippets, model memory, and unpreserved pages cannot support consequential conclusions.

Source plans deliberately diversify authority, proximity, geography, and publication lineage. Repeated sites derived from one release count as one source group. Provider failure causes bounded replanning, not evidence invention.

## Candidate truth boundary

A discovery candidate is a hypothesis for additional research. It is not a canonical person/organization, verified donor, qualified prospect, confirmed relationship, opportunity, strategy, or CRM record. Candidate outputs contain references and ambiguity, never an unauthorized merge.

Discovery may perform lightweight deterministic duplicate screening but must delegate material identity uncertainty to the entity-resolution capability. Qualification and critic gates remain downstream and can block the candidate.

## Authority, policy, and delegation

Default autonomy is A2. Effective authority intersects system, tenant, Domain Pack, strategy, task, data-classification, source, budget, and active human policy. It can only narrow.

No outreach, form submission, CRM mutation, private contact harvesting, credential access, protected-trait targeting, policy exception, canonical merge, self-qualification, or unsupported capacity/propensity inference is allowed.

Default maximum delegation depth is exactly 3. Delegation is typed, tenant-scoped, budget-reserved, authority-intersected, cycle-checked, and excludes delegation of final candidate accountability.

## Economics and stopping

Budget envelopes cover currency, model tokens, tool calls, provider quotas, storage, elapsed time, fan-out, and candidate limits. Reserve before work and reconcile after it. Hard-dimension exhaustion stops or escalates.

Continue only while expected information gain, novel-candidate yield, coverage improvement, or decision value exceeds configured marginal cost and risk. Stop on strategy satisfaction, diminishing returns, source saturation, policy denial, deadline, budget, unacceptable bias, or absence of feasible sources.

## Security, privacy, and tenancy

Tenant identity is derived from authenticated workload context. Enforce isolation in data rows, graph queries, vector namespaces, caches, queues, object paths, traces, metrics, budgets, and provider requests. Retrieved content is untrusted and cannot grant tools, alter goals, disclose secrets, or override policy.

Minimize personal data, enforce purpose/retention, redact telemetry, encrypt data, use short-lived credentials, and audit access/denial. Cross-tenant references fail closed and trigger security response.

## Persistence, APIs, events, and recovery

Persist goals, observations, hypotheses, source plans, candidate versions, evidence links, fingerprints, exclusions, decisions, delegations, budgets, transitions, human actions, and audit anchors. Migrations require forward/rollback and mixed-version tests.

APIs support submit, inspect, pause, resume, cancel, supersede, handoff, review, and replay-safe recovery. Events cover goal accepted, hypothesis/plan created or revised, candidate discovered/suppressed/handed off, policy/budget block, provider degradation, run completed, and monitoring trigger. Mutations are authenticated, authorized, tenant-scoped, idempotent, versioned, and auditable.

Recovery resumes only from verified durable state, reconciles candidate delivery and budgets, uses fresh fencing, preserves evidence, and quarantines integrity or cross-tenant failures.

## Shared evaluation and acceptance

Test unit/property invariants, schemas, migrations, adapters, event idempotency, restart/concurrency, source provenance, circular sources, contradictions, prompt injection, policy, privacy, tenancy, budgets, cancellation, load, soak, chaos, backup/restore, and operator controls.

Evaluation reports precision, recall where measurable, novelty, duplicate suppression, coverage, evidence sufficiency, calibration, source concentration, bias/fairness slices, cost, latency, downstream acceptance/rejection, critic overturn, false discovery, and human correction.

Production approval requires G0–G5 executed evidence, no blocking failure, and an independently calculated score of at least 95/100. Specification language itself earns no readiness claim.
