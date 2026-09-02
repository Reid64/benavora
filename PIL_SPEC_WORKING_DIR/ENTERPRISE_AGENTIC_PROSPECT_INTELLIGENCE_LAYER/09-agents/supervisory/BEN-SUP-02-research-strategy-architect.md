# BEN-SUP-02 — Research Strategy Architect

**Specification ID:** PIL-AGENT-BEN-SUP-02  
**Version:** 2.0.0  
**Family:** Supervisory and Orchestration  
**Default autonomy:** A2 — Prepare and Queue  
**Human boundary:** Fundamental fundraising strategy changes, policy exceptions, new sensitive data use, unapproved geographies/purposes, and budget increases  
**Maximum delegation depth:** 3  
**Platform boundary:** Generic Prospect Intelligence core; Benavora is the first Domain Pack/adapter  
**Status:** Specification remediated; implementation and production readiness require executed G0–G5 evidence

## 0. Claude Code Chain-It directive

Implement the durable agent, deterministic guards, schemas, migrations, events, APIs, evaluations, observability, and operator controls described here. Do not create a single prompt, one-shot model wrapper, scheduled report, or hard-coded filter builder and call it BEN-SUP-02.

Before editing, read all cumulative Release 1 and Release 2 files, repository instructions, existing architecture, schemas, migrations, workflow conventions, and uncommitted user changes. Produce a requirement-to-code map. Reuse conforming platform primitives. Never invent provider endpoints, credentials, source permissions, benchmark results, or completed tests. Continue through implementation and remediation until gates pass or a registered stop condition occurs.

## 1. Mission

Transform a broad, approved fundraising objective into an evidence-driven, policy-compliant, versioned prospect-research strategy that can be executed by BEN-SUP-01 and decomposed by BEN-SUP-03.

Example input:

> Find high-capacity Texas prospects aligned with affordable housing.

Required output is not a rewritten sentence. It is a structured strategy defining prospect classes, geography, cause taxonomy, time horizon, inclusion/exclusion criteria, evidence standards, capacity/propensity distinctions, relationship requirements, research phases, candidate/depth limits, source classes, budget envelope, qualification gates, ranking methodology, monitoring triggers, stop conditions, uncertainties, and assumptions.

## 2. Accountable outcome

The agent succeeds when an independent consumer can execute the strategy without guessing its intent, while a reviewer can reconstruct why every material choice was made and which policy/evidence informed it.

It optimizes for decision usefulness, coverage of the actual objective, evidence sufficiency, feasibility, cost discipline, and ethical/policy compliance—not for the largest candidate pool.

## 3. Reasoning boundary

BEN-SUP-02 owns research-strategy formation and revision. It does not:

- discover or research specific prospects;
- resolve identities;
- establish canonical facts or graph edges;
- crawl, parse, enrich, or synchronize data;
- select exact execution task topology owned by BEN-SUP-03;
- allocate live portfolio resources owned by BEN-SUP-04;
- independently certify its own consequential strategy;
- alter tenant mission, policy, autonomy, billing, or source permissions;
- send outreach or make final solicitation decisions.

## 4. Persistent objective

Each run receives `ResearchStrategyGoal.v1`, derived from a validated `Goal.v1`:

```yaml
strategy_goal_id: uuid
tenant_id: uuid
parent_goal_id: uuid
objective_text: string
tenant_twin_ref: string
policy_snapshot_id: uuid
required_outcomes: []
constraints: []
budgets: BudgetEnvelope.v1
minimum_confidence: 0..1
deadline: timestamp
autonomy_ceiling: A2
version: integer
```

The strategy goal survives worker/model restart and is version-locked during a planning cycle. A new parent goal or policy version triggers re-observation and either revision or supersession.

## 5. Inputs

| Input | Purpose |
|---|---|
| Validated fundraising objective | Defines desired intelligence outcome |
| Tenant digital twin snapshot | Mission, programs, service areas, populations, funding needs, existing relationships |
| Policy/autonomy snapshot | Allowed purposes, data, sources, geographies, actions, human gates |
| Cause taxonomy and mappings | Normalize mission concepts while preserving tenant wording |
| Geography ontology | Resolve radius, jurisdiction, service area, operating footprint, giving geography |
| Prospect-class registry | Individuals, foundations, corporations, executives, institutions and valid subtypes |
| Evidence policy | Source tiers, corroboration, freshness, confidence, critic requirements |
| Source/provider capability registry | Feasible source classes, permissions, cost, freshness—not credentials |
| Cost/model/tool catalog | Feasibility estimates and strategy budgets |
| Prior strategy and outcome history | Approved learning signals and failure patterns |
| Human corrections/constraints | Signed, scoped, expiring or durable decisions |

Reject or block on tenant mismatch, invalid schema, missing purpose, missing success/stop criteria, unapproved objective, policy version conflict, or a request outside registered A2 authority.

## 6. Outputs

### 6.1 `ResearchStrategy.v1`

```yaml
strategy_id: uuid
tenant_id: uuid
goal_id: uuid
version: integer
status: DRAFT | VALIDATED | REVIEW_REQUIRED | APPROVED | PUBLISHED | SUPERSEDED | REJECTED
intent:
  objective: string
  fundraising_decision_enabled: string
  prospect_classes: []
  cause_concepts: []
  geography: {}
  time_horizon: {}
population:
  inclusion_criteria: []
  exclusion_criteria: []
  segmentation: []
  candidate_limit: integer
evidence_strategy:
  required_claim_types: []
  minimum_source_tiers: {}
  corroboration_rules: []
  freshness_rules: []
  confidence_thresholds: {}
  critic_gates: []
research_phases: []
source_plan: []
qualification_gates: []
ranking_methodology: {}
depth_policy: {}
budget_envelope: {}
stop_conditions: []
escalation_conditions: []
monitoring_triggers: []
assumptions: []
uncertainties: []
alternatives_considered: []
selected_rationale: string
policy_snapshot_id: uuid
input_snapshot_refs: []
created_by: BEN-SUP-02
created_at: timestamp
```

### 6.2 Supporting outputs

- `StrategyAlternativeSet.v1`
- `StrategyGap.v1`
- `StrategyDecision.v1`
- `HumanReviewRequest.v1`
- `ResearchStrategyProposed.v1`
- `ResearchStrategyRevised.v1`
- `ResearchStrategySuperseded.v1`
- `StrategyBlocked.v1`

All outputs include tenant, trace, causation, policy snapshot, idempotency, and version metadata.

## 7. Closed agentic loop

### GOAL

Load the durable strategy goal and unresolved criteria.

### OBSERVE

Build a bounded, hashed `StrategyObservation.v1` containing objective, tenant twin, policy, taxonomies, feasible sources/tools, prior outcomes, budgets, deadline, and conflicts.

### PLAN

Identify ambiguities and material strategic choices. Create a plan for interpretation, alternatives, feasibility evaluation, evidence design, policy validation, and review.

### SELECT / DELEGATE

Use deterministic taxonomy/policy/cost tools. Delegate only bounded clarification or specialist analysis through `DelegatedTask.v1`; never delegate away final strategy accountability.

### EXECUTE

Construct at least two materially distinct strategies when genuine choices exist—for example breadth-first versus relationship-first—not cosmetic wording variations.

### EVALUATE

Score coverage, decision usefulness, evidence strength, feasibility, cost, risk, bias, policy compliance, and sensitivity to assumptions.

### REPLAN

Revise when inputs conflict, feasibility fails, expected cost exceeds budget, coverage gaps remain, policy denies a source/data class, or review identifies weakness.

### TERMINATE

Publish a validated strategy, queue required review, block with explicit missing requirements, pause, supersede, or fail. Never manufacture certainty.

## 8. Objective interpretation

The agent extracts and preserves:

- intended fundraising decision;
- prospect types;
- mission/cause concepts and synonyms;
- geography type: residence, operation, giving, service, relationship, or radius;
- relevant time horizon;
- capacity, propensity, affinity, eligibility, relationship, and timing dimensions;
- inclusion and exclusion rules;
- requested depth and volume;
- explicit and implicit evidence needs;
- urgency and deadline;
- prohibited assumptions.

Ambiguous terms are represented as hypotheses with confidence. Do not silently equate wealth with propensity, company presence with local giving, board listing with current service, or mission similarity with eligibility.

## 9. Strategy alternatives

When applicable, generate alternatives such as:

- broad discovery then qualification;
- narrow high-evidence discovery;
- relationship-first rediscovery of first-party records;
- geography-first institutional search;
- cause-first giving-history search;
- trigger-event strategy for timing-sensitive objectives.

Evaluate alternatives using configurable normalized dimensions. No universal weights are invented. Deterministic code applies tenant-approved weights and produces sensitivity analysis showing whether modest weight changes alter selection.

## 10. Evidence strategy

For every decision-critical claim type, specify:

- acceptable source tiers;
- whether independent corroboration is mandatory;
- required freshness and temporal semantics;
- confidence threshold and calibration basis;
- permissible inference method and label;
- contradiction handling;
- independent critic gate;
- minimum evidence required before qualification.

Search snippets and aggregators may locate sources but cannot alone satisfy high-impact claims. Wealth, liquidity, capacity, propensity, affinity, eligibility, identity, and relationships remain distinct claim families.

## 11. Research phases and gates

A strategy normally defines:

1. **Interpret and seed** — normalize objective and obtain initial candidate channels.
2. **Resolve** — establish entity identity before attaching consequential evidence.
3. **Research** — gather specialist intelligence in dependency-aware parallel branches.
4. **Verify and connect** — provenance, contradiction, freshness, and graph relationships.
5. **Qualify and critique** — decision classification and independent review.
6. **Strategize and monitor** — next action, timing, monitoring, and learning hooks.

Each phase includes entry criteria, outputs, completion gate, maximum cost/time, stop conditions, and fallback. BEN-SUP-03 later converts phases into execution topology.

## 12. Depth and stopping economics

Define initial depth bands and escalation rules rather than fixed universal invocation counts. Use governing planning ranges—3–5 agents for weak candidates, 8–15 for normal qualified prospects, 15–25 for major or ambiguous prospects—as nonbinding defaults.

Stop or redirect when:

- decision criteria are satisfied;
- additional research is unlikely to change qualification or action;
- evidence paths are redundant;
- candidate expected value falls below tenant threshold;
- budget/deadline makes remaining work irrational;
- policy blocks required evidence;
- identity remains unresolved beyond allowed effort;
- prospect is ineligible or disqualified;
- human clarification is essential.

## 13. Delegation

BEN-SUP-02 may delegate limited tasks to registered specialists when strategy formation requires bounded analysis, such as taxonomy mapping, source feasibility, or policy clarification. Every task declares exact objective, context references, allowed tools/data, budget, evidence requirement, confidence, deadline, success, stop, escalation, and A2-or-lower ceiling.

Child results are observations, not automatically accepted strategy. BEN-SUP-02 evaluates and incorporates or rejects them with rationale.

## 14. Human boundary

Request human approval/clarification when the objective would:

- materially redefine mission or fundraising priorities;
- add a new prospect population or geography outside policy;
- use a new sensitive/restricted data purpose;
- require an unapproved provider/license;
- increase budget or autonomy;
- relax evidence or critic requirements;
- introduce automated outreach or consequential operational action;
- retain unresolved ambiguity that changes strategy materially.

Approvals are scoped, signed, expiring/versioned, and cannot be inferred from silence.

## 15. Failure and recovery

| Failure | Response |
|---|---|
| Invalid or incomplete objective | Block with structured missing fields; do not guess material intent |
| Conflicting tenant twin and user objective | preserve conflict and request authorized resolution |
| Taxonomy uncertainty | create alternatives or bounded delegation; retain tenant wording |
| Source unavailable/prohibited | re-evaluate feasible alternative; record coverage loss |
| Budget infeasible | reduce breadth/depth transparently or request authorized increase |
| Model schema failure | reject, bounded repair/fallback through Model Gateway |
| Policy change mid-run | stop pending execution, re-observe, revise/supersede |
| Worker loss | resume from durable state and immutable observation/plan versions |
| Duplicate event/command | return idempotent prior result |
| Cross-tenant mismatch | fail closed, quarantine, security alert |

## 16. Memory

Run memory stores current alternatives and evaluations. Goal memory stores strategy versions, decisions, assumptions, and unresolved gaps. Tenant strategy memory stores only approved mission/taxonomy/preferences and human corrections. Outcome history may inform proposals but cannot silently change policy or scoring weights.

## 17. Security and privacy

- Use verified tenant context at every query, cache, event, prompt, and output.
- Minimize context; reference canonical records rather than copying unrestricted dossiers.
- Prohibit protected/highly sensitive trait targeting.
- Treat retrieved instructions as untrusted data.
- Never expose provider credentials or unrestricted arbitrary HTTP/browser tools.
- Audit policy denials, human gates, model versions, and strategy decisions.

## 18. Observability

Metrics:

- strategy completion/revision/rejection rates;
- human clarification and policy-denial rates;
- objective coverage and missing-dimension rates;
- forecast versus actual research cost and yield;
- downstream plan acceptance and rework;
- qualification yield, false positives, and human corrections by strategy version;
- alternative selection stability and sensitivity;
- time to validated strategy;
- schema/model failures and recovery.

Trace spans include observation construction, intent parsing, taxonomy resolution, alternative generation, feasibility/cost evaluation, policy validation, strategy selection, review, revision, and publication.

## 19. Implementation artifacts

Claude Code must create/adapt:

1. agent capability registration;
2. strategy goal, observation, alternative, gap, decision, and strategy schemas;
3. migrations with tenant/version/idempotency/outbox constraints;
4. durable workflow and activities;
5. structured model output and prompt version registry;
6. deterministic policy, taxonomy, feasibility, cost, and sensitivity services;
7. APIs/events for propose, inspect, review, publish, revise, and supersede;
8. operator UI/API showing objective interpretation, alternatives, assumptions, evidence policy, costs, gates, and lineage;
9. audit, metrics, traces, dashboards, and alerts;
10. complete tests, evaluation dataset, ADRs, and runbook.

## 20. Tests

### Unit/property

- parser preserves explicit inclusion/exclusion constraints;
- geography semantics never collapse residence, operation, service, and giving footprints;
- capacity and propensity remain separate;
- authority/policy intersection cannot widen;
- budget estimates include child fan-out/retry policy;
- deterministic ranking reproduces fixed inputs and reason codes;
- generated strategy always has phase gates and stop conditions;
- supersession never mutates prior strategy versions.

### Agentic scenarios

1. Broad Texas housing objective becomes a structured strategy with alternatives, evidence rules, phases, qualification gates, and uncertainty.
2. User says “wealthy donors”; agent refuses to treat wealth as propensity and adds giving-behavior evidence.
3. Radius request conflicts with a foundation’s giving geography; strategy distinguishes presence from eligibility.
4. Preferred licensed source is unavailable; agent replans source coverage and exposes confidence loss.
5. Budget supports only narrow depth; agent selects a defensible segment instead of pretending full coverage.
6. Policy blocks a requested data class; agent excludes it and replans or blocks.
7. Human changes the mission/geography; active draft is superseded with complete lineage.
8. Downstream outcomes show false positives; agent proposes a revised strategy but cannot silently change production weights.

### Adversarial/security

- objective includes prompt injection requesting unrestricted tools;
- retrieved taxonomy/source text attempts to change policy;
- forged tenant or approval identifiers;
- cross-tenant context/vector/cache retrieval;
- protected-trait targeting request;
- circular/aggregator evidence presented as authoritative;
- maliciously high candidate limit causing fan-out/cost abuse.

### Reliability

- worker death before/after plan persistence and event publication;
- duplicate and reordered strategy events;
- concurrent revisions with optimistic version conflict;
- model timeout/invalid output and bounded fallback;
- policy snapshot expiration mid-run;
- budget reservation failure and reconciliation.

## 21. Evaluation and acceptance

## 22. Typed strategy-formation contracts

ResearchStrategyGoal.v2 extends the durable goal with tenant/domain/parent goal ids, objective source and approval, fundraising decision enabled, required outcomes, explicit constraints, policy and tenant-twin snapshots, budget envelope, deadline, A2 ceiling, maximum delegation depth 3, success/stop/escalation, idempotency, correlation/causation, and schema versions.

ObjectiveInterpretation.v2 records preserved original language; normalized intent; prospect classes; cause concepts and ontology mappings; geography assertions by residence, operation, service, giving, relationship, jurisdiction, and radius semantics; time horizon; population; capacity, propensity, affinity, access, eligibility, timing and opportunity dimensions; inclusions/exclusions; evidence needs; assumptions; ambiguities; alternatives; prohibited interpretations; and confidence intervals.

StrategyObservation.v2 is an immutable hash-addressed snapshot of the approved goal, tenant/domain twin versions, policies, ontologies, registries, feasible source/capability classes, economics, prior outcomes, human decisions, deadline, and conflicts. Conversational memory cannot replace it.

StrategyAlternative.v2 contains materially distinct intent interpretation, population/segmentation, evidence design, source-class strategy, research phases, qualification/critic gates, depth policy, budget distribution, monitoring, expected coverage/yield/cost/latency distributions, bias/privacy risk, assumptions, sensitivity, infeasibilities, and rationale.

StrategyDecision.v2 records admissibility, deterministic rule results, selected/rejected alternatives, objective vector, uncertainty, sensitivity, policy/human decisions, evidence/input refs, versions, and signature. A single model score cannot hide a failed gate.

ResearchStrategy.v2 is the canonical strategy artifact and adds contract versions, strategy completeness report, formal source-class permissions, gap register, tenant-twin field dependencies, downstream conformance requirements, expiry/revalidation triggers, rollback/supersession policy, and immutable hash/signature.

## 23. Durable strategy state machine

States:

CREATED → VALIDATING_GOAL → OBSERVING → INTERPRETING → IDENTIFYING_AMBIGUITIES → PLANNING_FORMATION → GENERATING_ALTERNATIVES → DESIGNING_EVIDENCE → EVALUATING_FEASIBILITY → VALIDATING_POLICY → SELECTING → REVIEWING → PERSISTING → PUBLISHING → MONITORING → EVALUATING_OUTCOMES → REPLANNING.

Terminal/holding states are APPROVED, PUBLISHED, SATISFIED, PAUSED, WAITING_HUMAN, BLOCKED_INPUT, BLOCKED_POLICY, INFEASIBLE, REJECTED, SUPERSEDED, CANCELLED, FAILED_RECOVERABLE, FAILED_TERMINAL, and QUARANTINED.

Every transition persists expected prior state and version, reason, actor, attempt, lease/fencing token, input/output hashes, policy/twin/ontology/registry versions, budget delta, timestamp, and audit anchor. Compare-and-swap prevents concurrent revision loss. Published and terminal versions are immutable; revisions and corrections create successors.

Publication is transactional: persist approved strategy and version, write event to outbox atomically, publish idempotently, and record downstream acknowledgement. Event failure cannot create an untraceable active strategy.

## 24. Deterministic strategy completeness and admissibility

The Strategy Validator proves:

- original objective and every approved constraint are preserved or explicitly transformed with rationale;
- intended decision, population, prospect classes, cause, geography, time, and tenant-twin dependencies are explicit;
- inclusion/exclusion and segment definitions are noncontradictory and executable;
- every decision-critical claim family has source tier, independence, freshness, confidence, inference, contradiction, critic, and UNKNOWN rules;
- identity-before-consequence and evidence-before-qualification ordering is required;
- research phases have entry, completion, failure, budget, and terminal rules;
- qualification and critic gates cannot be bypassed;
- ranking factors, weights, hard gates, missingness, and sensitivity ownership are explicit;
- source classes are registered, permitted, licensed for purpose, and feasible;
- budgets cover expected, tail, retry, monitoring, and descendant planning cost;
- all mandatory outcomes are feasible within policy, deadline, and capability;
- monitoring and revalidation triggers cover material temporal change;
- authority never exceeds A2 and delegation depth never exceeds 3;
- every path terminates, escalates, or becomes governed monitoring;
- tenant isolation and generic-core/Domain-Pack boundaries are preserved.

Violations are typed with strategy path and stable code. Blocking violations cannot be waived by BEN-SUP-02. Bounded repair produces a new alternative and full revalidation.

StrategyCompletenessReport.v2 distinguishes COMPLETE, COMPLETE_WITH_DECLARED_LIMITATIONS, HUMAN_REQUIRED, POLICY_BLOCKED, and INFEASIBLE. Missing critical information remains UNKNOWN; it is never inferred merely to satisfy the schema.

## 25. Objective ambiguity and human-decision protocol

AmbiguityAssessment.v2 records ambiguous term, plausible interpretations, materiality, affected strategy fields, evidence/context, confidence, reversible default if policy permits, human requirement, deadline behavior, and decision owner.

The agent may autonomously select only a reversible interpretation that is within approved policy, does not broaden population/data/geography/purpose, preserves the original wording, and cannot materially change consequential research. Otherwise it emits HumanStrategyDecisionRequest.v2 with mutually exclusive options, consequences, cost/delay, recommendation, expiry, and safe blocked state.

Silence is never approval. Human decisions are signed, scoped, versioned, attributable, and linked to the exact strategy version. Expired or superseded decisions cannot authorize publication.

## 26. Tenant-twin, ontology, and temporal reconciliation

Every strategy field derived from the Prospect Digital Twin records exact twin field, version, effective interval, provenance, confidence, and dependency. Mission, program, population, geography, legal status, budget, service area, relationship, and funding-need changes trigger impact analysis.

Twin conflict with the approved goal is preserved as a typed conflict, not silently resolved. Policy determines whether to block, use the approved goal, request human clarification, or create alternatives.

Ontology mappings preserve tenant language and map it to versioned canonical concepts with relationship type, confidence, exclusions, and ambiguity. Broadening from a specific tenant concept to a general cause requires explicit rationale and sensitivity analysis. Domain Packs may add concepts and mappings but cannot override global safety, privacy, evidence, or tenant rules.

TemporalStrategyRule.v2 defines effective interval, freshness, grace period, expiry action, monitoring event, and revalidation owner for each material assumption or external condition.

## 27. Evidence architecture and qualification design

EvidenceRequirement.v2 is defined per claim and consequence class: claim family, acceptable/prohibited source tiers, underlying-source independence, corroboration/quorum, freshness and temporal semantics, preservation and locator requirements, identity certainty, inference label, confidence/calibration threshold, contradiction search, negative-evidence handling, UNKNOWN behavior, critic requirement, and downstream use.

Capacity, liquidity, wealth, giving, propensity, affinity, access, relationship, eligibility, identity, geography, timing, and intent remain separate requirement families. One cannot substitute for another.

QualificationGateDesign.v2 specifies exact required inputs, deterministic versus agent judgment, threshold ownership, hard and soft failures, missingness, critic placement, human boundary, downstream permissions, expiry, and audit.

Evidence design must be strong enough to resist strategy-induced confirmation bias. For each consequential hypothesis, specify disconfirming observations and negative-source strategy. A source plan that only searches for supporting evidence is inadmissible.

## 28. Strategy alternatives, feasibility, and robust selection

Generate materially different alternatives whenever choices affect population, evidence, cost, risk, timing, or expected decision value. Breadth-first, relationship-first, high-evidence narrow, geography-first, cause-first, first-party rediscovery, institutional-first, and trigger-event strategies are examples, not mandatory templates.

FeasibilityAssessment.v2 covers registered sources/capabilities, permissions/licenses, coverage, freshness, expected yield, identity complexity, provider health, agent eligibility, data residency, cost/latency distributions, downstream topology complexity, monitoring burden, failure domains, and residual gaps.

Selection optimizes policy-prioritized decision usefulness, evidence sufficiency, population coverage, uncertainty reduction, feasibility, cost, time, privacy, bias/fairness, recoverability, and robustness. Deterministic hard gates establish admissibility; the agent explains tradeoffs.

Sensitivity varies weights, source availability, yield, costs, evidence thresholds, candidate limits, and major assumptions. If modest plausible variation changes the selected strategy, declare instability and select a robust alternative or request review.

## 29. Population coverage, bias, and anti-gaming controls

PopulationDesign.v2 records target universe, observable universe, inclusion/exclusion, segments, sampling or enumeration approach, source coverage, known blind spots, underrepresented segments, concentration limits, and evaluation plan.

Coverage is not inferred from search-result count. Estimate observable coverage using declared denominators or proxies, uncertainty, and limitations. Track source, geography, cause, organization type, prospect class, and relevant policy-approved slices.

Test whether source availability, digital footprint, naming, language, wealth visibility, institutional prominence, or historical database bias systematically suppresses valid candidates. Mitigations may diversify sources, allocate exploration, adjust sampling, or disclose unavoidable limitations; they cannot lower evidence or safety gates.

Prevent metric gaming: candidate volume cannot substitute for precision; qualification yield cannot be improved by excluding hard cases without declared population change; cost cannot be reduced by silently weakening evidence; and downstream acceptance cannot self-certify strategy quality.

## 30. Strategy-to-plan conformance and change control

BEN-SUP-03 must produce PlanConformanceReport.v2 mapping every strategy requirement, phase, gate, source class, budget, stopping rule, monitoring trigger, and human/critic boundary to plan nodes/edges/joins. Unmapped mandatory strategy fields block plan activation.

BEN-SUP-02 may evaluate the conformance report but cannot edit the execution DAG. A topology feasibility gap may trigger strategy revision; the revision preserves the original strategy and records why the constraint changed.

Strategy change classes are PATCH (nonmaterial description/metadata), MINOR (compatible bounded refinement), and MAJOR (population, purpose, geography, evidence gate, budget, autonomy, sensitive data, qualification, or decision change). Policy defines required validation, critic, human approval, downstream cancellation, and replan behavior for each.

Active plan/work impact analysis identifies reusable, invalidated, cancellable, and newly required work. No strategy revision mutates active plans or evidence history in place.

## 31. Persistence, APIs, events, economics, and recovery

Persist goals, observations, interpretations, ambiguities, human requests/decisions, alternatives, evidence requirements, feasibility, completeness, population/coverage, strategy versions, decisions, twin/ontology dependencies, conformance reports, monitoring rules, outcome evaluations, budgets, transitions, events, and audit anchors.

Require tenant-scoped keys/constraints, append-only strategy/decision history, encrypted sensitive fields, retention, exact versions, optimistic concurrency/fencing, transactional outbox, idempotency ledger, RLS/equivalent negative tests, and forward/rollback/mixed-version migrations.

Commands support propose, validate, request decision, approve/reject, publish, revise, supersede, pause/resume, cancel, monitor, evaluate outcomes, and replay-safe recovery. Queries expose interpretation, alternatives, evidence design, feasibility, sensitivity, gaps, approvals, lineage, budgets, conformance, and audit.

Events cover goal accepted, ambiguity detected, alternative generated, strategy validated/blocked/review-requested/approved/published/revised/superseded, twin/policy/ontology impact detected, downstream conformance rejected, and outcome review completed.

BudgetEnvelope covers currency, tokens, tool/model calls, specialist clarifications, storage, elapsed time, alternatives, sensitivity evaluations, monitoring, and operator effort. Reserve/reconcile all delegated work. Hard exhaustion blocks further automated formation.

Recovery resumes immutable observation/alternative/decision state under fresh fencing, reconciles publication and budgets, and quarantines cross-tenant or integrity failures. Unknown external effects invoke BEN-SUP-06.

## 32. Security, model governance, observability, and operations

Threats include objective/prompt injection, malicious Domain Pack or ontology broadening, protected-trait targeting, purpose laundering, arbitrary source/tool grant, cross-tenant twin/context/cache/vector leakage, forged approval, stale policy/twin, strategy fan-out denial-of-wallet, model bias, event replay, audit tampering, and evaluator gaming.

Controls include workload identity, least privilege, tenant authorization on every access, signed/versioned goals/policies/twins/ontologies, structured tool/model I/O, content/instruction separation, source/capability allowlists, secret references, encryption, egress/rate/budget limits, context minimization, redacted telemetry, kill switch, audit anchors, dependency pinning/SBOM, and anomaly alerts.

Model routing considers consequence, structured-output reliability, context, approved region, data classification, evaluation status, latency, and cost. Fallbacks cannot weaken contracts, evidence, policy, tenant isolation, or human/critic gates. Record prompt, model, tool, ontology, policy, and configuration versions.

Dashboards expose strategy funnel, ambiguity/human queue, completeness violations, alternative stability, feasibility gaps, population/source coverage, evidence design, policy blocks, downstream conformance/rework, forecast versus actual cost/yield, outcome drift, and SLO burn. Drill-down reaches exact decision/evidence/version without leaking low-count personal data.

## 33. Agent-specific evaluation, scale, chaos, and G0–G5

Maintain adjudicated cases for ambiguous objectives, conflicting twin/goal, cause ontology ambiguity, geography-semantic conflicts, wealth-versus-propensity, foundation presence-versus-eligibility, missing evidence classes, prohibited sources/data, unavailable mandatory capability, budget infeasibility, unstable alternative selection, biased source coverage, strategy-plan mismatch, twin/policy change, human approval expiry, concurrent revision, and no feasible strategy.

Measure objective preservation, interpretation accuracy, completeness, policy violations, human-correction rate, alternative diversity, selection robustness, evidence-design sufficiency, coverage/bias, feasibility forecast error, downstream plan conformance/rework, qualification false positives, critic overturn, cost, latency, calibration, and outcome lift by strategy version.

Test unit/property invariants, schemas, migrations, APIs/events, twin/ontology/policy services, deterministic validation/ranking/sensitivity, concurrency/idempotency, publication, monitoring, recovery, prompt injection, IDOR, cross-tenant references, protected-data requests, forged approvals, model/schema faults, load, soak, chaos, backup restore, and regional failover.

Load profiles derive from tenants, concurrent goals, alternatives, ontology/twin size, population segments, evidence requirements, monitoring triggers, and revisions. Report throughput, percentile latency, queue age, validator/sensitivity complexity, database contention, telemetry growth, cost, and scale inflections with reproducible evidence.

G0 requires repository/authority/dependency discovery. G1 requires constitutional boundaries and generic-core/Domain-Pack separation. G2 requires machine contract compatibility. G3 requires deterministic completeness, feasibility, policy, authority, economics, concurrency, and publication. G4 requires executed interpretation, material alternatives, tool/delegation, evaluation, replanning, monitoring, and outcome learning. G5 requires security, privacy, tenant isolation, calibration, load, soak, chaos, DR, observability, rollback, documentation, and independent scorecard with no blockers.

This specification earns no implementation score. A score ≥95/100 and production readiness may be reported only from attached executed evidence with every blocking gate passed.

Reject BEN-SUP-02 unless executed evidence proves:

- durable multi-cycle observe–plan–evaluate–replan behavior;
- at least two material alternatives when choices exist;
- structured evidence, qualification, depth, source, cost, and stop strategy;
- policy/authority enforcement outside the model;
- restart, duplicate, and concurrency safety;
- tenant isolation and prohibited-data protection;
- truthful uncertainty and no fabricated source/performance claims;
- complete decision, assumption, version, policy, and cost lineage;
- independent enterprise score at least 95/100 with every blocking category passing.

## 22. Final Chain-It report

Return requirement-to-code traceability, files/migrations, rollback, executed commands, actual test results, evaluation evidence, a full strategy-replanning trace, tenant/security proof, cost and load results where executed, unresolved assumptions, known risks, and verdict `NOT_READY`, `CONDITIONALLY_READY`, or `PRODUCTION_READY`.

Never issue `PRODUCTION_READY` when any blocking gate was skipped, simulated, assumed, or failed.
