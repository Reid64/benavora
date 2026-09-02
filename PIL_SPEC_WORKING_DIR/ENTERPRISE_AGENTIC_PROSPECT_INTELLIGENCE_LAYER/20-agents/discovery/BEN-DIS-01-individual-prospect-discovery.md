# BEN-DIS-01 — Individual Prospect Discovery Agent

**Specification ID:** PIL-AGENT-BEN-DIS-01  
**Version:** 2.0.0  
**Family:** Discovery  
**Default autonomy:** A2 — prepare and queue  
**Delegation depth:** Maximum 3  
**Cadence:** On-demand, event-driven, and governed continuous monitoring  
**Boundary:** Produces provisional individual candidates, never canonical identities, qualified donors, opportunities, outreach, or CRM records  
**Status:** Specification remediated; production readiness requires executed G0–G5 evidence

## 1. Chain-It directive

Implement BEN-DIS-01 as a durable open-ended discovery agent. Read the constitution, registries, shared discovery contract v2, strategy, evidence graph, source/capability registry, policy, tenant/domain twin, workflow runtime, migrations, APIs/events, observability, tests, deployment, and repository instructions. Produce repository interaction, authority, data-flow, and requirement-traceability maps. Reuse canonical services; never invent endpoints, sources, permissions, data, benchmarks, tests, or readiness.

Implement goal–observe–hypothesize–plan–select/delegate–discover–link evidence–evaluate–replan–handoff/monitor/stop. Do not implement a crawler, static query list, scheduled ETL, deterministic ranker, or one-shot prompt and call it an agent.

## 2. Mission and accountable outcome

Discover evidence-supported individual prospect candidates matching an approved tenant research strategy across permitted sources. Explore geography, cause relevance, professional role, documented charitable activity, business ownership, community participation, public influence, organizational overlap, and credible relationship pathways.

The accountable output is a diverse, reproducible, policy-compliant set of provisional candidates with sufficient preliminary evidence and uncertainty to justify entity resolution or specialist research. Success is decision usefulness and validated discovery yield—not raw name volume.

## 3. Reasoning and truth boundary

BEN-DIS-01 owns search-hypothesis generation, source-mix adaptation, candidate synthesis, preliminary evidence linkage, novelty/coverage evaluation, and next-step recommendation.

It does not:

- establish canonical identity or merge records;
- attach another person’s giving, wealth, role, relationship, or ownership;
- infer propensity from wealth, title, fame, residence, or employment;
- treat home address as giving geography;
- establish verified capacity, affinity, access, eligibility, or qualification;
- harvest private contact information;
- target protected or highly sensitive traits;
- initiate outreach or mutate CRM;
- certify its own consequential findings.

Identity resolution, enrichment, capacity, giving history, relationships, qualification, critic review, strategy, and CRM synchronization remain separate agents/services.

## 4. Durable goal and inputs

IndividualDiscoveryGoal.v2 requires tenant/domain/goal/strategy ids and versions; objective; decision enabled; candidate population; inclusion/exclusion; cause concepts; geography semantics; time horizon; permitted individual subtypes; discovery dimensions; evidence minimums; source classes; diversity/coverage objectives; candidate and handoff limits; budgets; deadline; autonomy ceiling; policy snapshot; monitoring triggers; and success/stop/escalation conditions.

Inputs include ResearchStrategy, Prospect Digital Twin snapshot, tenant/domain twin, cause and geography ontologies, source/capability registry, evidence/source-tier/freshness policy, first-party exclusions, consent/suppression state, prior candidates, canonical entity references for duplicate screening, active work fingerprints, provider health/economics, prior discovery outcomes, human constraints, and current budget.

Reject tenant mismatch, invalid schema, stale/unknown policy, absent purpose or stopping rules, unsupported geography, prohibited source/data, unavailable mandatory evidence tier, contradictory strategy, or authority above A2.

## 5. Typed observations and hypotheses

IndividualDiscoveryObservation.v2 is an immutable, hashed view of goal, strategy, policy, source availability, prior coverage, candidate/exclusion state, active work, provider health, budget, deadline, and material changes.

IndividualSearchHypothesis.v2 requires hypothesis id/version, target segment, rationale, discovery dimensions, cause/geography semantics, source classes and independence expectation, query concepts, predicted yield and evidence, disconfirming observations, risks/bias, estimated cost, priority, and status.

Maintain multiple materially distinct hypotheses when feasible—for example documented giving, nonprofit governance, business/community leadership, institutional overlap, and issue-specific public activity. Do not produce cosmetic query variants.

Hypotheses are falsifiable and updated from observed yield, precision, novelty, source concentration, missing segments, and downstream feedback.

## 6. Source planning and evidence

IndividualSourcePlan.v2 maps each hypothesis to permitted capability IDs, independent source groups, query families, geography/cause ontology terms, expected evidence, quotas, budget, ordering/parallelism, rate limits, fallback paths, and stop conditions.

Provider adapters—not this agent—own endpoints, credentials, robots/terms controls, rate limits, parsing, normalization, and snapshots. Arbitrary HTTP/browser access is prohibited unless a registered capability explicitly authorizes it.

Every preliminary claim links to preserved EvidenceRecord references with source, underlying-source group, exact locator, snapshot hash, publication/effective/retrieval times, subject applicability, source tier, collection/use policy, freshness, limitations, and contradiction state.

Search snippets are discovery hints only. Repeated coverage of one press release is one source group. Model memory never becomes evidence. Current-role claims require temporally current support or explicit historical qualification.

## 7. Candidate contract

IndividualCandidate.v2 requires:

- candidate id/version, tenant/domain, run/plan/hypothesis lineage;
- provisional person reference and observed name variants;
- identity ambiguity and collision indicators;
- individual subtype hypotheses;
- discovery dimensions and evidence-linked rationale;
- cause mappings with ontology versions;
- geography assertions with semantics, times, and evidence;
- preliminary role, giving, ownership, participation, influence, and overlap claims;
- evidence refs, source groups, freshness, contradictions, and gaps;
- exclusion, consent, suppression, policy, and duplicate checks;
- WorkFingerprint.v2 and novelty classification;
- candidate confidence interval and calibration version;
- uncertainty, limitations, risk flags, and prohibited inferences;
- recommended next agents/capabilities with exact objectives;
- cost, budget, policy, authority, timestamps, and hashes.

Candidates are statuses PROVISIONAL, NEEDS_RESOLUTION, NEEDS_MORE_EVIDENCE, READY_FOR_SPECIALIST_HANDOFF, SUPPRESSED_DUPLICATE, EXCLUDED_POLICY, REJECTED_LOW_SUPPORT, or MONITOR.

No candidate field may imply qualification or outreach authorization.

## 8. Identity safety and duplicate control

Lightweight duplicate screening uses normalized names, contextual attributes, existing canonical references, source ids, and tenant-scoped WorkFingerprint. It may suppress an exact known duplicate but cannot merge ambiguous persons.

Material collisions—common names, changed surnames, shared households, parent/child names, role transitions, conflicting locations, or inconsistent biographies—produce NEEDS_RESOLUTION and a typed entity-resolution task. Evidence remains attached to the observed provisional subject, never transferred to a likely match.

WorkFingerprint.v2 incorporates tenant, strategy, subject/query identity, hypothesis, source group, temporal window, and material constraints. It prevents redundant concurrent work while permitting a new version when evidence, strategy, policy, or freshness materially changes.

## 9. Candidate ranking and deterministic gates

Ranking is a deterministic, versioned reducer over policy-approved factors. Candidate strength may include strategy relevance, preliminary evidence coverage/quality/independence/freshness, novelty, cause/geography fit, feasible next-step value, uncertainty reduction potential, and source diversity.

Penalties include identity ambiguity, stale/circular/weak evidence, contradictions, duplicate likelihood, exclusion risk, source concentration, unsupported inference, privacy/policy risk, and excessive expected follow-up cost.

Missing values remain missing and are never silently zero. Each factor records value, evidence/input refs, estimator version, confidence interval, freshness, and sensitivity. Policy owns weights and thresholds. Sensitivity analysis detects unstable rankings.

Hard gates suppress cross-tenant references, policy denial, prohibited traits/data, excluded/opted-out subjects, unverifiable evidence, and exact duplicates. Ranking cannot convert a failed hard gate into a candidate.

## 10. Durable state machine and loop

States: CREATED, VALIDATING, OBSERVING, HYPOTHESIZING, PLANNING, RESERVING, DISCOVERING, EVIDENCE_LINKING, EVALUATING, REPLANNING, HANDING_OFF, MONITORING, and terminal SATISFIED, EXHAUSTED, PAUSED, BLOCKED_POLICY, BLOCKED_HUMAN, CANCELLED, FAILED_RECOVERABLE, FAILED_TERMINAL, SUPERSEDED.

Every transition uses expected version, lease/fencing token, input/output hash, actor, reason, attempt, policy/authority, budget delta, timestamp, and audit anchor. Aggregate and outbox commit atomically. Terminal changes create successors.

Loop:

1. Bind goal, population, evidence, coverage, and stopping criteria.
2. Observe current search space, prior work, sources, budget, and gaps.
3. Form multiple search hypotheses and predicted evidence.
4. Plan diverse sources, parallel branches, quotas, and fallbacks.
5. Select registered tools/delegates under intersected authority.
6. Gather seeds and preserved evidence through adapters.
7. Synthesize provisional candidates without canonical merging.
8. Evaluate precision, novelty, coverage, bias, cost, contradictions, and evidence sufficiency.
9. Replan when yield, source health, contradictions, gaps, budget, policy, or feedback changes.
10. Handoff, monitor, stop, pause, or escalate explicitly.

Bound iterations, parallel fan-out, delegation depth 3, candidate count, tool/model calls, bytes, time, and spend. Loop-signature detection prevents repetitive search.

## 11. Replanning and monitoring

Replan on low precision, duplicate saturation, sparse evidence, source concentration, missing population segments, ontology/query mismatch, provider degradation, material contradiction, identity collisions, downstream rejection, policy revision, budget change, deadline pressure, or new monitoring signals.

Permitted adaptations include revising concepts, source mix, breadth/depth, ordering, parallelism, quotas, and segment allocation; requesting bounded specialist help; suspending weak branches; or terminating saturated hypotheses.

Monitoring reopens only on registered material changes such as new filings, roles, governance, giving disclosures, business events, or newly available permitted sources. Every reopen creates a new run/version and respects freshness and budget policy.

## 12. Delegation and downstream handoff

Delegations use DelegatedDiscoveryTask.v2 with exact objective, inputs, output schema, authority intersection, tool/source allowlist, budget, deadline, recursion depth, evidence rules, success/stop criteria, and parent linkage. Cycles and depth above 3 are rejected.

Typical handoffs include entity resolution for identity ambiguity; charitable-history, capacity, relationship, ownership, foundation, executive, or public-record specialists for bounded research; and critic review where consequence policy requires it.

CandidateHandoff.v2 contains immutable candidate version, unresolved questions, exact requested work, evidence/gap refs, exclusions/policy, expected output, and no implied acceptance. Downstream rejection or correction becomes governed feedback, not an automatic canonical change.

## 13. Authority, budgets, and stopping economics

Effective authority intersects system, tenant, Domain Pack, strategy, task, classification, source, budget, and human policy and can only narrow.

BudgetEnvelope is multidimensional: currency, tokens, model/tool calls, provider quotas, storage, elapsed time, fan-out, candidates, and operator effort. Reserve before dispatch, reconcile after, release verified unused amounts, and persist the ledger.

Continue only when expected novel supported-candidate yield, coverage improvement, uncertainty reduction, or decision value exceeds configured marginal cost and risk. Stop on goal satisfaction, diminishing returns, saturation, no feasible sources, hard budget/deadline, policy block, unacceptable bias, or excessive identity contamination.

## 14. Persistence, APIs, events, and recovery

Persist goals, observations, hypotheses, source plans, plan versions, candidate versions, evidence links, fingerprints, exclusions, ranking factors, decisions, delegations, handoffs, monitoring subscriptions, budgets, state transitions, human actions, and audit anchors.

Require tenant-scoped keys/constraints, append-only candidate/decision history, encrypted sensitive fields, retention/deletion, exact version references, optimistic concurrency/fencing, transactional outbox, idempotency ledger, RLS or equivalent negative tests, and forward/rollback/mixed-version migrations.

Commands support submit, pause, resume, cancel, supersede, handoff, monitor, human disposition, and replay-safe recovery. Queries expose run/plan/hypotheses, source coverage, candidates/evidence/gaps, ranking sensitivity, budgets, decisions, and audit. Events cover accepted, hypothesis/plan created/revised, candidate discovered/suppressed/handed off, blocked, provider degraded, monitoring triggered, and run terminated.

Recovery resumes only from verified durable state, reconciles delivered candidates and budgets, acquires fresh fencing, and quarantines evidence-integrity or cross-tenant failures.

## 15. Security, privacy, and threat model

Threats include source prompt injection, malicious SEO/source poisoning, entity contamination, protected-trait inference, public-data purpose laundering, arbitrary tool requests, cross-tenant ids, IDOR, cache/vector leakage, forged evidence, duplicate delivery, denial-of-wallet, secret exposure, event replay, and evaluator gaming.

Controls include workload identity, least privilege, per-access tenant authorization, structured adapter I/O, content/instruction separation, snapshot hashes, provenance, source allowlists, secret references, encryption, egress controls, rate/budget limits, redacted telemetry, retention, kill switch, signed commands, audit anchors, dependency pinning/SBOM, and security alerts.

Public availability does not establish permission. Collect only necessary data for approved purpose; prohibit highly sensitive targeting. Automated negative tests and independent evidence prove controls.

## 16. Memory, learning, and observability

Working memory holds current hypotheses and candidates; durable episodic memory stores plan versions, yields, source performance, corrections, and outcomes. Canonical entity/evidence stores remain authoritative. Memory is tenant-scoped, provenance-linked, expiring where required, and excluded when policy changes.

Learning may propose query, source-allocation, ranking, or stopping changes only through versioned datasets, offline evaluation, bias/security review, canary, monitoring, and rollback. Online self-modification of authority, policy, hard gates, source permissions, or protected-data rules is prohibited.

Metrics cover hypothesis yield, candidate precision/novelty, duplicate suppression, evidence coverage/independence/freshness, contradictions, identity ambiguity/contamination, segment coverage, source concentration, provider health, downstream acceptance/critic overturn, calibration, bias slices, cost, latency, replans, stops, retries, and isolation attempts.

Trace goal, observation, hypothesis, source plan, reservation, adapter/delegation, evidence linkage, candidate synthesis, ranking, evaluation, replan, handoff, monitoring, and termination. Operators can inspect, pause/resume, cancel, narrow, suppress, request review, kill, and export audit.

Model and tool routing is governed by task consequence, structured-output reliability, context requirement, approved region, data classification, current evaluation status, latency, and cost. Fallbacks cannot weaken schemas, evidence requirements, source permissions, tenant isolation, or candidate hard gates. Record every prompt, model, adapter, tool, ontology, ranking, and configuration version. Provider or model degradation produces bounded fallback, reduced-scope replanning, waiting, or explicit termination; it never permits unsupported candidate synthesis.

Typed errors include INPUT_INVALID, POLICY_DENIED, AUTHORITY_EXCEEDED, TENANT_MISMATCH, SOURCE_PROHIBITED, SOURCE_UNAVAILABLE, RATE_LIMITED, EVIDENCE_UNPRESERVED, EVIDENCE_INTEGRITY_FAILURE, ENTITY_AMBIGUITY, DUPLICATE_WORK, BUDGET_EXHAUSTED, DEADLINE_EXCEEDED, STALE_VERSION, LEASE_LOST, MODEL_SCHEMA_FAILURE, ADAPTER_SCHEMA_FAILURE, CANCELLED, RECOVERY_REQUIRED, and SECURITY_INCIDENT. Each declares retryability, maximum attempts, backoff/jitter, circuit-breaker behavior, budget treatment, state transition, operator visibility, and stable machine code. Policy, authority, tenant, integrity, and deterministic validation failures are never blindly retried.

Operational dashboards must expose discovery funnel by hypothesis and segment, evidence/source concentration, candidate aging, ambiguity and contradiction queues, downstream handoff latency/outcome, provider quotas and health, budgets and forecast variance, monitoring backlog, policy/security blocks, and SLO/error-budget burn. Alerts require actionable ownership and links to runbooks rather than raw metric thresholds alone.

Every dashboard and evaluation view must support tenant-safe drill-down from aggregate metrics to the exact plan, candidate version, evidence locator, ranking decision, model/tool version, policy decision, and human disposition. Aggregation must not expose low-count personal information or permit cross-tenant inference. Metric definitions, sampling, late-arrival handling, and cardinality limits are version controlled.

## 17. Agent-specific evaluation dataset

Maintain adjudicated cases for common names, changed surnames/employment, sparse footprints, historical/current roles, local leaders without wealth, wealthy people without giving, documented donors, corporate versus personal giving, stale bios, circular sources, duplicate CRM/entity records, residence-versus-giving geography, community participation without affinity, foundation/company relationships, exclusions/opt-outs, protected traits, cross-tenant poison, prompt injection, provider outage, and strong negative candidates.

Separate tuning, calibration, development, regression, and final certification sets. Label synthetic data. Measure precision, recall where observable, novelty, duplicate suppression, evidence sufficiency, identity contamination, calibration, source diversity, coverage by relevant segment, false discovery, downstream acceptance/rejection, critic overturn, human correction, cost per accepted seed, and time.

## 18. Required tests

Unit/property tests prove non-widening authority, deterministic ranking/gates, bounded confidence, missingness preservation, stable tenant fingerprints, duplicate suppression, temporal semantics, budget conservation, terminal immutability, and bounded loop/delegation.

Contract/integration tests cover schemas, adapters, provenance, policy, entity-resolution handoff, evidence graph, source grouping, migrations, transactional outbox, idempotency, cancellation, monitoring, restart at every state, duplicate/reordered events, concurrent runs, and tenant isolation.

End-to-end scenarios prove multi-cycle replanning; common-name quarantine; stale-role qualification; source-circularity collapse; provider fallback; budget stop; strategy change; low-yield termination; novel supported handoff; exact duplicate suppression; prohibited source/data block; and critic rejection followed by bounded research.

Security, load, soak, chaos, and DR tests cover prompt injection, poisoned evidence, forged approval, IDOR, cross-tenant cache/queue/graph/vector/object references, worker death, database/broker/provider/model outage, rate shock, outbox backlog, regional failover, backup restore, and kill switch.

## 19. Deployment, ADRs, runbooks, and acceptance

Version schemas, prompts, models, tools, adapters, ontologies, ranking policies, and flags. Roll out through offline evaluation, shadow discovery, tenant-isolated canary, limited source classes, monitored expansion, and GA only after gates. Rollback preserves candidate/evidence/audit lineage and in-flight compatibility.

ADRs cover reasoning boundary, candidate schema, source strategy, identity safety, ranking, fingerprints, persistence/workflow, evidence, policy, tenancy, economics, monitoring, and learning. Runbooks cover source outage, precision collapse, duplicate spike, identity contamination, prohibited data, tenant incident, cost anomaly, stuck run, outbox backlog, kill switch, rollback, and DR.

G0–G5 require repository discovery; constitutional conformance; machine contracts; deterministic gates/economics/concurrency; executed multi-cycle observation, hypotheses, source selection, evaluation, replanning, handoff and monitoring; and production security, isolation, calibration, load, soak, chaos, recovery, observability, rollback, documentation, and independent evaluation.

A score of at least 95/100 may be reported only from executed governed scorecard evidence with every blocking gate passed. This specification itself does not confer implementation or production readiness.

## 20. Required final implementation report

Return traceability; repository maps; schemas/migrations/interfaces/workflows/events; adapter and evidence integration; executed tests/evaluations; representative multi-cycle traces; ranking sensitivity; source and segment coverage; identity/tenant/security evidence; calibration and error analysis; performance/cost/recovery results; residual risks, skips, failures, waivers, owners, expiry; and governed G0–G5 verdict.

Never claim enterprise, production, or scale readiness—or a 95–100 score—from prose, simulation, assumptions, or skipped/failing evidence.
