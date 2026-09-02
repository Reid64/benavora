# BEN-DIS-02 — Major Donor Discovery Agent

**Specification ID:** PIL-AGENT-BEN-DIS-02  
**Version:** 2.0.0  
**Family:** Discovery  
**Default autonomy:** A2 — prepare and queue  
**Maximum delegation depth:** 3  
**Cadence:** On-demand, event-driven, and governed monitoring  
**Boundary:** Produces provisional major-donor research candidates, never qualification, ask amounts, outreach authority, canonical identity, or CRM state  
**Status:** Specification remediated; production readiness requires executed G0–G5 evidence

## 1. Chain-It directive

Implement BEN-DIS-02 as a durable agent inheriting Discovery Agent Shared Contract v2.0.0. Inspect constitution, registries, strategy, evidence graph, source/capability registry, policy, tenant/domain twin, entity and giving contracts, workflow runtime, migrations, APIs/events, observability, evaluations, deployment, and repository instructions. Produce repository interaction, authority, trust, data-flow, and requirement-traceability maps. Reuse canonical services and adapters. Never invent sources, endpoints, permissions, identities, gifts, valuations, results, tests, or readiness.

Implement goal–observe–hypothesize–plan–select/delegate–discover–attribute evidence–evaluate–replan–handoff/monitor/stop. A static wealth filter, list scraper, scorecard, or one-shot model prompt is not this agent.

## 2. Mission and accountable outcome

Identify provisional individuals for whom permitted evidence suggests both potentially meaningful philanthropic capacity indicators and documented giving propensity. Discover giving history, gift magnitude and cadence, commitments, foundation relationships, major philanthropic participation, liquidity-relevant events, and cause/geography signals while preserving uncertainty.

Success is a precise, evidence-linked set of candidates worth specialist resolution and qualification—not a list of wealthy people. Candidate volume, net-worth estimates, or celebrity status are not success measures.

## 3. Semantic separation and non-goals

The agent keeps these constructs distinct:

- wealth: estimated stock of assets minus liabilities;
- liquidity: assets plausibly available within a time horizon;
- capacity: potential ability to make a gift under explicit assumptions;
- propensity: observed tendency to give;
- affinity: evidence of connection to cause or institution;
- access: credible relationship or communication pathway;
- intent/readiness: evidence of current willingness or timing;
- giving: attributable gift, commitment, or grant with status and source.

BEN-DIS-02 does not establish any construct as canonical, calculate a solicitation amount, infer giving from wealth/title, treat foundation assets as personal, treat company value as personal liquidity, treat corporate giving as executive giving, count a pledge as paid, treat one gift as a pattern, resolve ambiguous identity, perform outreach, or qualify a prospect.

## 4. Durable goal and inputs

MajorDonorDiscoveryGoal.v2 requires tenant/domain/goal/strategy ids and versions; decision enabled; candidate population; cause/geography/time horizon; major-gift semantics by tenant and Domain Pack; permitted donor/gift types; capacity and propensity evidence requirements; inclusion/exclusion; source classes; corroboration/freshness rules; candidate/handoff limits; diversity/coverage objectives; budgets; deadline; A2 ceiling; critic gates; monitoring triggers; and success/stop/escalation conditions.

Inputs include approved ResearchStrategy; Prospect Digital Twin and tenant/domain twin; gift, cause, geography, role, organization, and asset ontologies; permitted source/capability registry; evidence policy; known prospects/exclusions/suppressions; entity ambiguity state; prior candidates/fingerprints; source health/economics; outcomes/corrections; budget; and policy snapshot.

Reject invalid schema, tenant mismatch, stale policy, absent purpose or stopping rules, undefined major-gift semantics, unsupported geography, prohibited data/source, unresolved strategy conflict, or authority above A2.

## 5. Typed observation and hypothesis contracts

MajorDonorObservation.v2 is an immutable hashed snapshot of strategy, thresholds, source availability, known giving/capacity evidence, exclusions, entity ambiguity, prior coverage, active work, provider health, budgets, policy, deadline, and material changes.

MajorDonorHypothesis.v2 requires id/version, provisional subject/segment, hypothesis class, causal rationale, predicted giving and capacity observations, cause/geography/time semantics, source classes and independence expectations, disconfirming evidence, attribution risks, bias/privacy risks, estimated value/cost, confidence interval, priority, and status.

Hypothesis classes include documented major giver, repeated giver with growth, family-foundation participant, liquidity-event philanthropist, philanthropic campaign leader, donor-advised or intermediary participant where permitted, and cause-aligned major commitment. These are research hypotheses, not donor labels.

Maintain materially different hypotheses and falsify them using negative evidence. Do not create cosmetic query variants.

## 6. Giving evidence model

GiftObservation.v2 requires observed donor name/ref, recipient, amount or range, currency, gift type, announcement date, commitment date, payment period/status, restriction, anonymity/publicity qualifier, individual/family/foundation/corporate attribution, source/underlying group, locator/snapshot hash, publication/effective/retrieval times, identity certainty, attribution certainty, and limitations.

Gift types include paid gift, pledge/commitment, matching gift, grant, in-kind contribution, planned/deferred gift, campaign credit, sponsorship, and unknown. Types cannot be silently converted.

Amounts are normalized through deterministic currency/date services while retaining original values. Ranges remain ranges. “Million-dollar campaign” does not prove an individual gave one million. Naming recognition, board membership, gala attendance, or campaign leadership does not establish gift amount without evidence.

GivingPatternHypothesis.v2 records observation set, temporal window, cadence, magnitude distribution, recipient/cause diversity, growth/decline, source independence, missing periods, attribution uncertainty, and pattern confidence. One observation cannot establish recurrence.

## 7. Capacity and liquidity evidence model

CapacityIndicator.v2 records indicator type, subject attachment, observed value/range/unit, effective date, ownership/control semantics, liquidity relevance, liabilities/encumbrance uncertainty, source/evidence, confidence interval, assumptions, contradictions, and expiry.

Indicators may include verified ownership interests, compensation disclosures, transactions/liquidity events, real property where policy permits, public securities holdings, foundation/family context, executive role, and other registered Domain Pack signals. Each is an indicator only.

Company valuation is not individual wealth; ownership percentage is not assumed; paper value is not liquidity; gross proceeds are not net personal proceeds; foundation assets are controlled charitable assets; family assets are not automatically attributable to one member; real property value ignores debt unless evidenced.

CapacityRangeHypothesis.v2 must identify model/policy version, included/excluded indicators, transformations, uncertainty distribution, assumptions, sensitivity, missingness, conflicts, and prohibited interpretations. Deterministic services perform arithmetic; the agent reasons about applicability and gaps.

## 8. Candidate output contract

MajorDonorCandidate.v2 requires:

- candidate/version and tenant/domain/run/plan/hypothesis lineage;
- provisional person identity, names, ambiguity/collision flags;
- separately typed wealth, liquidity, capacity, propensity, affinity, access, intent, and giving hypotheses;
- GiftObservation and CapacityIndicator references;
- giving pattern, cause/geography mappings, and temporal scope;
- evidence refs, independent source groups, freshness, contradictions, and gaps;
- attribution and identity certainty;
- exclusions, consent/suppression, policy, and duplicate checks;
- tenant-scoped WorkFingerprint and novelty;
- configured ranking factors, confidence interval, sensitivity, and calibration version;
- uncertainty, limitations, negative evidence, and prohibited inferences;
- exact downstream research/critic tasks;
- budget, authority, policy, models/tools, timestamps, and hashes.

Statuses: PROVISIONAL, NEEDS_IDENTITY_RESOLUTION, NEEDS_GIFT_ATTRIBUTION, NEEDS_CAPACITY_RESEARCH, NEEDS_PROPENSITY_RESEARCH, READY_FOR_SPECIALIST_HANDOFF, SUPPRESSED_DUPLICATE, EXCLUDED_POLICY, REJECTED_INSUFFICIENT_GIVING, REJECTED_CONFLATION_RISK, or MONITOR.

## 9. Identity and attribution safety

Every gift, role, ownership, transaction, and relationship stays attached to its observed provisional subject until entity resolution proves identity. Common names, spouses/family, namesakes, changed names, donor collectives, joint gifts, foundations, corporations, trusts, and donor-advised intermediaries require explicit attribution semantics.

Lightweight duplicate screening may suppress exact known work but cannot merge people. Material ambiguity creates a typed entity-resolution or gift-attribution handoff and blocks READY_FOR_SPECIALIST_HANDOFF.

No evidence transfers between family members, company and executive, foundation and trustee, or household members without direct support and policy permission.

## 10. Source strategy and provenance

MajorDonorSourcePlan.v2 maps hypotheses to registered capability ids, independent source groups, query concepts, expected gift/capacity evidence, attribution checks, quotas, budget, ordering/parallelism, rate limits, fallbacks, and stop conditions.

Start with documented philanthropic observations and then investigate permitted capacity indicators; do not generate a wealth-first list and relabel it. Seek authoritative recipient disclosures, filings, institutional records, issuer/regulatory records, credible direct reporting, and other registered sources appropriate to the claim.

Provider adapters own endpoints, credentials, terms/robots compliance, parsing, normalization, and snapshots. Search snippets and model memory are discovery-only. Repeated articles derived from one announcement are one group. Preserve exact locators, hashes, dates, source tier, underlying lineage, purpose permission, and limitations.

## 11. Deterministic gates and ranking

Hard gates reject cross-tenant references, policy/protected-data violations, exclusions/opt-outs, exact duplicates, failed evidence integrity, unresolved identity or gift attribution above threshold, absent required documented giving, and unsupported conflation.

Ranking uses versioned policy factors: giving evidence quality/independence/freshness, attributable magnitude/cadence, capacity-indicator quality, cause/geography fit, novelty, feasible information gain, and downstream value. Penalties cover ambiguity, circular/stale/weak sources, contradictions, pledge/payment uncertainty, family/foundation/corporate confusion, capacity uncertainty, source concentration, privacy risk, and expected follow-up cost.

Missing values remain missing. Every factor carries provenance, estimator version, confidence interval, freshness, and sensitivity. Policy owns weights/thresholds. Ranking cannot override hard gates or imply an ask amount.

## 12. Durable state and agentic loop

States: CREATED, VALIDATING, OBSERVING, HYPOTHESIZING, PLANNING, RESERVING, DISCOVERING_GIVING, DISCOVERING_CAPACITY, ATTRIBUTING, EVIDENCE_LINKING, EVALUATING, REPLANNING, HANDING_OFF, MONITORING, and terminal SATISFIED, EXHAUSTED, PAUSED, BLOCKED_POLICY, BLOCKED_HUMAN, CANCELLED, FAILED_RECOVERABLE, FAILED_TERMINAL, SUPERSEDED.

Transitions persist expected version, fencing token, reason, actor, attempt, hashes, policy/authority, budget delta, time, and audit. Aggregate/outbox commit atomically.

Loop: bind goal and semantics; observe evidence/search state; form alternative giving/capacity hypotheses; plan diverse sources and attribution checks; select registered tools/delegates; gather/preserve observations; evaluate identity, attribution, independence, freshness, contradictions, propensity/capacity separation, coverage, bias, and cost; replan materially; then handoff, monitor, stop, pause, or escalate.

Bound iterations, fan-out, delegation depth 3, candidates, evidence, calls, bytes, time, and spend. Detect repeated plan/observation signatures.

## 13. Replanning, handoff, and monitoring

Replan when giving cannot be attributed, a pledge is mistaken for payment, sources collapse to one lineage, identity collides, capacity assumptions fail, evidence is stale/contradictory, segment/source concentration grows, provider health changes, downstream agents reject, policy/budget/deadline changes, or a feasible source could materially change candidacy.

Adapt concepts, source mix, breadth/depth, ordering, quotas, and bounded delegations. Stop weak paths when documented giving remains absent after configured effort or further capacity research cannot change the no-giving gate.

Downstream tasks may target entity resolution, charitable history, capacity, transaction/liquidity, ownership, relationship, foundation/family attribution, qualification, or BEN-SUP-05 critic review. Each task carries exact question, immutable evidence/gaps, authority/tool/source limits, budget, success/stop conditions, and no implied acceptance.

Monitoring reopens on material permitted signals such as a new gift/pledge/payment update, filing, liquidity event, governance role, campaign participation, correction, or source availability. Reopen creates a new version.

## 14. Authority, economics, persistence, and recovery

Effective authority intersects system, tenant, Domain Pack, strategy, task, classification, source, budget, and human policy and only narrows. No outreach, CRM mutation, private contact harvest, protected targeting, policy exception, identity merge, self-qualification, or ask recommendation.

Budgets cover currency, tokens, tool/model calls, provider quotas, storage, elapsed time, fan-out, candidates, and operator effort. Reserve before work, reconcile after, and release proven unused capacity. Continue only while expected supported-candidate yield, uncertainty reduction, coverage, or decision value exceeds marginal cost/risk.

Persist goals, observations, hypotheses, source plans, gifts, capacity indicators/ranges, patterns, candidates, evidence, fingerprints, rankings, exclusions, decisions, delegations, handoffs, monitoring, budgets, transitions, human actions, events, and audit anchors.

Require tenant constraints, append-only history, encryption/retention, exact version references, optimistic concurrency/fencing, transactional outbox, idempotency ledger, RLS or equivalent tests, and forward/rollback/mixed-version migrations.

Recovery resumes verified durable state, reconciles candidate delivery/budgets, uses fresh fencing, and quarantines integrity or cross-tenant failures.

## 15. APIs, events, errors, and operator controls

Commands support submit, pause, resume, cancel, supersede, handoff, monitor, disposition, and replay-safe recovery. Queries expose goals, hypotheses, sources, gifts, capacity indicators, candidate evidence/gaps, attribution, ranking sensitivity, budgets, decisions, and audit.

Events cover goal accepted, hypothesis/plan created/revised, gift/capacity observation linked, attribution blocked, candidate discovered/suppressed/handed off, critic requested, policy/budget/provider block, monitoring trigger, and run termination.

Typed errors include invalid input, policy/authority/tenant denial, prohibited source, source unavailable/rate limited, evidence integrity, identity/attribution ambiguity, duplicate work, budget/deadline, stale version/lease, model/adapter schema, cancellation, recovery, and security. Each defines retry, attempts, backoff, circuit breaker, budget treatment, state, and operator visibility. Deterministic denials are not blindly retried.

Operators can inspect, compare evidence, pause/resume, cancel, narrow, suppress, request specialist/critic review, kill, and export audit. They cannot convert a provisional candidate into qualification.

## 16. Security, memory, learning, and observability

Threats include prompt/source poisoning, fabricated gifts, namesake attribution, foundation/corporate asset laundering, protected-trait inference, public-data purpose laundering, arbitrary tool requests, IDOR, cross-tenant caches/graphs/vectors/queues/objects, forged evidence, duplicate delivery, denial-of-wallet, secrets, replay, and evaluator gaming.

Controls include workload identity, least privilege, tenant authorization per access, structured adapters, instruction/data separation, hashes/provenance, source allowlists, secret references, encryption, egress and rate/budget controls, telemetry redaction, retention, kill switch, signed commands, audit anchors, SBOM/pinning, and alerts.

Memory is tenant-scoped and provenance-linked. It stores plans, yields, source performance, corrections, and outcomes but never canonical prospect truth. Learning proposals for queries, ranking, or stopping require versioned offline evaluation, bias/security review, canary, monitoring, and rollback; online policy/authority/gate modification is prohibited.

Metrics include candidate precision/novelty, attributable-gift coverage, pledge/payment error, identity contamination, wealth-propensity conflation, capacity calibration, evidence independence/freshness, contradictions, source/segment concentration, downstream acceptance/critic overturn, human correction, cost, latency, replans, stops, retries, and isolation attempts. Trace every loop stage and decision.

## 17. Agent-specific evaluation and tests

Gold cases include wealthy non-donors; anonymous/undocumented giving; namesake gifts; joint/family gifts; family foundations; corporate versus personal giving; foundation assets; pledges versus paid gifts; campaign credit without amount; stale net-worth lists; private-company estimates; partial ownership; gross liquidity events; modest-wealth frequent donors; changing causes/geographies; conflicting amounts; circular announcements; exclusions; protected data; cross-tenant poison; prompt injection; and strong negative cases.

Separate tuning, calibration, development, regression, and final certification sets. Measure identity/attribution error, wealth-propensity and entity-asset conflation, precision/recall where observable, novelty, evidence sufficiency/independence, calibration, false discovery, downstream acceptance/rejection, critic overturn, cost per accepted seed, and time.

Unit/property tests prove construct separation, range preservation, currency/time normalization, deterministic gates/ranking, non-widening authority, budget conservation, stable fingerprints, temporal semantics, bounded delegation/loop, and immutable terminal lineage.

Contract/integration tests cover schemas, adapters, evidence/source grouping, entity/attribution handoff, capacity arithmetic service, policy, migrations, outbox/idempotency, cancellation, monitoring, restart/concurrency, duplicate/reordered events, and tenant isolation.

E2E/adversarial/load/chaos/DR tests exercise every gold case plus provider/model/database/broker outage, worker death at every state, rate shock, outbox backlog, regional failover, backup restore, kill switch, IDOR, cache leakage, forged approval/evidence, secret/PII leakage, and evaluator manipulation.

Quantitative validation must explicitly test interval coverage and calibration rather than rewarding point-estimate confidence. For gifts and capacity indicators, report coverage of stated ranges, directional error, magnitude error, abstention quality, and calibration by source tier, recency, attribution class, donor subtype, and evidence density. False positives involving namesakes, family attribution, foundation assets, corporate gifts, or unpaid pledges are blocking defects at policy-defined consequence levels. Evaluation must include benign high-capacity non-donors and modest-capacity repeat donors so the system cannot improve apparent accuracy by learning a wealth shortcut.

Model and tool routing is policy governed by consequence, structured-output reliability, context size, approved region, data classification, current evaluation status, latency, and cost. Fallbacks may not weaken output schemas, evidence minimums, attribution requirements, tenant isolation, critic gates, or prohibited-inference rules. Record prompt, model, adapter, tool, ontology, currency normalization, capacity model, ranking policy, and configuration versions for every decision. If an approved equivalent is unavailable, the agent narrows scope, waits, or terminates transparently.

Operational dashboards must support tenant-safe drill-down from aggregate funnel metrics to hypotheses, candidate versions, exact gift and capacity evidence, attribution decisions, rejected alternatives, ranking sensitivity, downstream disposition, and human correction. Low-count personal data must not leak through metrics. Metric definitions, late-arriving gift corrections, backfills, sampling, and cardinality controls are versioned and tested.

## 18. Deployment, acceptance, and final report

Version schemas, prompts, models, tools, adapters, ontologies, gift/capacity rules, ranking policies, and flags. Roll out via offline evaluation, shadow discovery, tenant canary, limited source classes, monitored expansion, then GA after gates. Rollback preserves evidence/candidate/audit lineage and in-flight compatibility.

ADRs cover semantic separation, gift/attribution model, capacity ranges, source strategy, ranking/gates, identity safety, workflow/persistence, tenancy, economics, monitoring, and learning. Runbooks cover fabricated/misattributed gift, conflation spike, source outage, identity contamination, prohibited data, tenant incident, cost anomaly, stuck run, outbox backlog, kill switch, rollback, and DR.

G0–G5 require repository discovery; constitutional conformance; machine contracts; deterministic attribution/gates/economics/concurrency; executed multi-cycle hypothesis, source selection, evidence attribution, evaluation, replanning, handoff, monitoring; and security, isolation, calibration, load, soak, chaos, recovery, observability, rollback, documentation, and independent evaluation.

Return traceability, repository maps, code/migrations/interfaces/workflows/events, evidence/adapters, executed tests/evaluations, multi-cycle traces, attribution and construct-separation proof, ranking sensitivity, source/segment coverage, security/tenant evidence, calibration/errors, performance/cost/recovery, residual risks/skips/failures/waivers/owners/expiry, and governed verdict.

A score ≥95/100 may be reported only from attached executed scorecard evidence with every blocker passed. Never claim enterprise, production, or scale readiness from prose, simulation, assumptions, or skipped/failing evidence.
