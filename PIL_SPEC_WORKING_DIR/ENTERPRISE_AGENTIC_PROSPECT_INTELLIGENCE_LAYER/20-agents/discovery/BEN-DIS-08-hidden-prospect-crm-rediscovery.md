# BEN-DIS-08 — Hidden Prospect and CRM Rediscovery Agent

**Specification ID:** PIL-AGENT-BEN-DIS-08  
**Version:** 1.0.0  
**Family:** Discovery  
**Default autonomy:** A2 — prepare and queue  
**Maximum delegation depth:** 3  
**Cadence:** On-demand, event-driven, scheduled governed review, and change-triggered monitoring  
**Boundary:** Produces provisional rediscovery candidates and reversible research handoffs from permitted first-party history; never canonical identity, CRM mutation, suppression reversal, qualification, solicitation escalation, or outreach authority  
**Status:** Final specification pending implementation evidence

## 1. Chain-It implementation directive

Implement BEN-DIS-08 as a durable, goal-owning discovery agent inheriting Discovery Agent Shared Contract v2.0.0. Inspect the constitution; agent and deterministic-service registries; ResearchStrategy.v2; Prospect Digital Twin; tenant/domain twin; CRM source, consent, suppression, deletion, identity, gift, relationship, opportunity, interaction, evidence, and audit contracts; source/capability registry; policy engine; workflow runtime; persistence/migrations; APIs/events; observability; evaluation; deployment; and repository instructions. Produce repository-interaction, authority, trust-boundary, CRM-to-research lineage, consent/suppression precedence, temporal-data-flow, and requirement-traceability maps before implementation.

Reuse canonical read-only CRM adapters, entity resolution, consent/suppression, evidence, temporal, duplicate, policy, ranking, budget, workflow, and graph services. Never invent identities, gifts, interactions, relationships, external linkages, consent, permissions, contacts, provider endpoints, tests, or readiness.

Implement goal–observe–hypothesize–plan–select/delegate–rediscover–attribute–evaluate–replan–handoff/monitor/stop. A stale-record query, lapsed-donor report, duplicate merge, recency-frequency-monetary score, contact enrichment job, or one-shot prompt is not this agent.

## 2. Mission and accountable outcome

Identify overlooked prospects and research opportunities already present in permitted first-party organizational data: underestimated donors, incomplete or misclassified records, unresolved duplicates, hidden person–organization relationships, dormant opportunities, historically significant interactions, and records whose research value changes when new evidence arrives.

An illustrative case is a historical $100 donor later linked—through independently validated evidence—to significant company ownership, foundation-board service, substantial giving elsewhere, or a meaningful organizational relationship. The result is a research-review candidate, not automatic major-donor classification, capacity, propensity, qualification, contact permission, or solicitation escalation.

The accountable output is a precise, evidence-linked set of provisional rediscovery candidates with source-record lineage, identity alternatives, historical state, rediscovery mechanism, new-versus-old evidence, consent/suppression/deletion status, contradictions, missing decisive facts, reversible handoff instructions, and exact specialist tasks.

Success is validated incremental research value—not resurrected-record count, larger estimated capacity, more outreachable contacts, automatic reactivation, or CRM pipeline growth.

## 3. Reasoning authority and non-goals

BEN-DIS-08 owns rediscovery hypotheses, first-party source planning, record-state interpretation, preliminary longitudinal synthesis, change detection, underestimation and relationship-path hypotheses, ranking, coverage analysis, replanning, and research handoff.

It does not:

- mutate CRM records, stages, assignments, segments, scores, consent, suppressions, deletion markers, relationships, opportunities, or communication status;
- merge, split, reactivate, restore, enrich, contact, qualify, solicit, or automatically escalate any person or organization;
- treat absence of recent activity as lack of interest, or historical activity as current interest;
- override do-not-contact, opt-out, legal hold, deletion, erasure, restriction, deceased, complaint, fraud, safety, or tenant-specific exclusion states;
- infer consent from donation, attendance, board service, prior business relationship, imported lists, public data, or availability of contact details;
- treat household, soft-credit, tribute, matching-gift, employer, foundation, donor-advised-fund, anonymous, estate, intermediary, or organization records as the same actor;
- reinterpret transaction amount as capacity, propensity, affinity, or future intent;
- fabricate missing dates, attribution, identifiers, interactions, gifts, contacts, or relationships;
- use prohibited deleted data, shadow profiles, cross-tenant histories, or reconstructed erased identities.

Canonical entity resolution, consent decisions, CRM writeback, capacity/propensity analysis, relationship validation, qualification, critic review, engagement strategy, and outreach remain separate.

## 4. Durable goal and governed inputs

CRMRediscoveryGoal.v1 requires tenant/domain/goal/strategy ids and versions; decision enabled; authorized first-party systems and snapshots; permitted record/entity/activity classes; tenant mission/program/geography model; lookback and temporal semantics; hidden/dormant/underestimated criteria; exclusions; consent/suppression/deletion policy versions; evidence tiers; external-research permission; candidate/handoff/diversity limits; coverage objectives; budgets; deadline; A2 ceiling; critic gates; monitoring triggers; and success, stop, pause, and escalation conditions.

Inputs include ResearchStrategy.v2; Prospect Digital Twin; read-only CRM snapshots or change streams; donor, constituent, household, organization, gift, soft-credit, campaign, event, volunteer, board, relationship, note, task, opportunity, consent, suppression, deletion, complaint, and provenance records where authorized; import lineage and field dictionaries; Domain Pack ontologies; source/capability registry; known entity graph; policy; prior candidates/WorkFingerprints; provider health/economics; downstream corrections/outcomes; and budget.

Reject tenant mismatch, invalid snapshot/schema, missing source lineage, stale or unbound policy, unknown consent/suppression precedence, missing deletion semantics, unapproved external enrichment, purpose mismatch, unavailable mandatory evidence tier, absent stop rules, contradictory strategy, or requested authority above A2.

## 5. Record-state and rediscovery taxonomy

CRMRecordStateObservation.v1 records source system, tenant, source record id and immutable locator, entity class, operational status, lifecycle stage, owner, segment, created/updated/last-activity times, import/source lineage, consent and suppression references, deletion/restriction state, data-quality indicators, schema version, captured snapshot hash, and limitations.

RediscoveryReason.v1 is one or more explicit categories:

- UNDERESTIMATED: consequential evidence exists but prior classification omitted or discounted it;
- INCOMPLETE: missing fields or evidence prevented earlier evaluation;
- MISCLASSIFIED: source state conflicts with current governed taxonomy;
- DORMANT: no qualifying activity within a policy-defined window, without implying disinterest;
- ORPHANED: valid record lacks assignment, linkage, or workflow ownership;
- UNRESOLVED_DUPLICATE: two or more records may represent the same entity but cannot be merged here;
- FALSE_MERGE_SUSPECTED: one record may contain multiple entities or contaminated history;
- HIDDEN_RELATIONSHIP: permitted historical facts indicate an unvalidated person–organization–household–board path;
- DORMANT_OPPORTUNITY: prior opportunity stopped, expired, or stalled and may warrant research review;
- NEW_EVIDENCE_RECLASSIFICATION: post-dating evidence materially changes a previous research hypothesis;
- LEGACY_SCHEMA_LOSS: migration/import mapping may have hidden meaning;
- UNKNOWN_STATE: insufficient semantics requiring human or specialist review.

Every category records the prior state, new observation, policy/rule version, evidence, counterevidence, materiality, and reversible next step. It is never a CRM action.

## 6. Consent, suppression, deletion, and purpose precedence

EngagementGovernanceState.v1 separates research-processing permission, contact-channel consent, solicitation permission, communication preference, do-not-contact, channel suppression, global suppression, complaint, deceased/safety restriction, legal hold, deletion/erasure request, processing restriction, retention basis, and UNKNOWN.

Precedence is deterministic and policy-versioned. Deletion/erasure and prohibition states prevent rediscovery processing except minimum tombstone or audit handling explicitly required by law/policy. Suppression and do-not-contact do not disappear because a new email, gift, public record, employer, or relationship is discovered. UNKNOWN consent never becomes permission.

The agent may retain only the minimum suppression/tombstone reference necessary to prevent prohibited re-creation. It may not search for, reconstruct, or enrich an erased subject. Legal holds do not imply operational use. Purpose-limited records cannot be repurposed for fundraising research without an approved basis.

Candidate outputs repeat governance state and permitted next actions. No downstream handoff may widen purpose, source, contact, or retention authority. Human override requires named authority, reason, scope, expiry, and immutable audit; override cannot defeat law.

## 7. CRM truth versus research truth

CRM operational fields are observations from a named system/version, not canonical reality. A stage, score, segment, owner note, household label, relationship, “major donor” flag, or lapsed status may be stale, subjective, imported, or workflow-specific.

ResearchStateHypothesis.v1 records source facts, interpreted facts, external evidence where permitted, identity alternatives, temporal intervals, contradictions, uncertainty, and proposed specialist questions. It never overwrites source values.

The system preserves three layers: SOURCE_OBSERVATION, RESEARCH_HYPOTHESIS, and GOVERNED_DECISION. Every transformation retains field-level lineage. Conflicts remain visible. A CRM note is unverified first-party evidence with author/time/context, not automatically a fact; notes containing secrets, sensitive traits, accusations, or free-text contact instructions require redaction and policy review.

Only the dedicated synchronization authority may translate an approved governed decision into a CRM mutation, using optimistic concurrency, field-level ownership, dry-run diff, approval, idempotency, and rollback.

## 8. Identity, household, organization, and credit semantics

RediscoveryIdentityHypothesis.v1 records record candidates, names/aliases, addresses/contact identifiers only where permitted, organization/role anchors, household and relationship assertions, stable identifiers, collision indicators, negative evidence, confidence, and unresolved discriminators.

Duplicate similarity never authorizes merge. Shared email, phone, address, surname, employer, household id, spouse, payment method, or imported external id may indicate shared resources, recycled data, family, assistant, business, or contamination. Prefer unresolved records over false consolidation.

GiftCreditObservation.v1 distinguishes legal donor, payer, hard credit, soft credit, household credit, matching employer, tribute/honoree, donor-advised vehicle, foundation, intermediary, anonymous actor, estate, and UNKNOWN. A gift credited to a household or organization cannot silently become an individual gift.

RelationshipObservation.v1 preserves source wording, parties, relationship type, direction, effective interval, confidence, consent/use constraints, and contradiction. Co-attendance, shared address, common employer, board overlap, or staff note is a research path—not proof of acquaintance, influence, household, or introduction access.

## 9. Longitudinal activity and dormant opportunity semantics

ConstituentActivityObservation.v1 classifies donation, pledge, refund, event registration/attendance, volunteer activity, meeting, communication, application, service delivery, advocacy, membership, board service, task, note, opportunity, complaint, consent change, and other governed events. It records actor, object, status, effective/recorded times, channel, source, evidence, attribution, and limitations.

DormancyPolicy.v1 defines qualifying activity by entity/program/channel, observation window, grace period, incomplete-history handling, migration gaps, pandemic/disaster exceptions where configured, and UNKNOWN behavior. Dormancy is a temporal workflow condition, not a psychological conclusion.

DormantOpportunityHypothesis.v1 records original opportunity/campaign, amount and stage as observed, last verified action, stop/loss/expiry reason, commitments versus asks, owner, dependencies, consent state, subsequent material evidence, contradictions, and permitted next review. It never reopens a pipeline item.

Historical pledges are not payments; refunded or disputed gifts remain so; event registration is not attendance; attendance is not affinity; an old ask is not permission for a new ask. Date gaps and migrated history reduce confidence rather than being imputed.

## 10. Underestimation and new-evidence reasoning

RediscoveryChangeSet.v1 compares a prior decision snapshot with newly available evidence. It records before/after facts, their provenance and effective times, changed fields or graph edges, materiality rule, causal uncertainty, contradictions, policy version, and invalidated conclusions.

Permitted triggers include verified business ownership or leadership, foundation/nonprofit governance, attributable external giving, meaningful organizational relationship, corrected identity, new geographic/cause alignment, liquidity or career event requiring specialist research, resolved legacy data, and prior under-crediting. These are research triggers, not automatic conclusions.

Transaction size alone is not a reliable proxy for capacity or intent. A $100 donor may have greater research relevance after new evidence, while a large historical donor may remain suppressed, ineligible, misattributed, deceased, or irrelevant. Missing wealth data cannot be imputed; company value cannot become personal wealth; board service cannot become giving.

CounterfactualReason.v1 asks whether the candidate would still be surfaced without a single title, gift amount, neighborhood, name, demographic proxy, or model-generated association. Fragile or prohibited-feature-dependent candidates are blocked or penalized.

## 11. Candidate output contract

HiddenProspectRediscoveryCandidate.v1 requires:

- candidate/version and tenant/domain/run/plan/hypothesis lineage;
- source-record locators, snapshot/schema versions, and immutable field-level lineage;
- provisional person/household/organization/opportunity identity alternatives and collision risks;
- explicit rediscovery reasons, prior state, new evidence, change set, and materiality;
- activity/gift-credit/relationship semantics and temporal intervals;
- consent, suppression, deletion, restriction, complaint, safety, and purpose state;
- source observation, research hypothesis, and governed decision kept separate;
- evidence refs, independent groups, artifact hashes, contradictions, limitations, and UNKNOWN values;
- exclusions, retention/use policy, exact-duplicate and WorkFingerprint checks;
- ranking factors, confidence interval, sensitivity, calibration version, and coverage/fairness effects;
- reversible specialist/critic handoffs and prohibited CRM mutations;
- authority, budget, tools/models, timestamps, hashes, and prohibited claims.

Statuses are PROVISIONAL, NEEDS_IDENTITY_RESOLUTION, NEEDS_CREDIT_ATTRIBUTION, NEEDS_RELATIONSHIP_VALIDATION, NEEDS_EXTERNAL_RESEARCH, NEEDS_CONSENT_POLICY_REVIEW, NEEDS_DATA_STEWARD_REVIEW, READY_FOR_SPECIALIST_HANDOFF, SUPPRESSED_NO_ACTION, DELETION_TOMBSTONE_ONLY, EXCLUDED_POLICY, REJECTED_NO_MATERIAL_CHANGE, SUPPRESSED_DUPLICATE_WORK, or MONITOR.

No status implies CRM reactivation, merge, reclassification, capacity, propensity, qualification, relationship, contactability, solicitation, or outreach permission.

## 12. Hypothesis and source planning

CRMRediscoveryHypothesis.v1 contains target record cohort, rediscovery reason, predicted missing or changed evidence, first-party sources, permitted external source classes, disconfirming conditions, identity/credit/consent risks, privacy/fairness risk, expected value/cost, confidence, and status.

Maintain materially distinct hypotheses for underestimated donors, orphaned records, unresolved duplicates, false-merge contamination, hidden organization/board relationships, incomplete imports, stale classifications, dormant opportunities, and new-evidence reclassification. Do not generate cosmetic score thresholds or broad “lapsed donor” sweeps without information-value and policy constraints.

CRMRediscoverySourcePlan.v1 maps hypotheses to registered read-only CRM capabilities, warehouse snapshots, change logs, import mappings, audit history, gift processing, events/volunteering, relationship/board data, opportunity history, consent/suppression systems, permitted internal documents, and approved external discovery sources. It records expected artifacts, source authority, independence, queries, quotas, parallelism, rate limits, privacy bounds, budget, fallbacks, and stops.

CRM fields are source-specific; audit/change history establishes recorded transitions, not necessarily real-world events. Free text is untrusted data. External sources require separate authority. Search snippets and model memory cannot support consequential rediscovery claims.

## 13. Deterministic gates and ranking

Hard gates reject cross-tenant references, prohibited source/use, deletion or processing restriction that bars the work, suppression requiring no action, failed evidence integrity, exact duplicate work, unresolved identity collision above threshold, fabricated data, absent material change, or known tenant exclusion.

Ranking factors are policy-versioned: materiality of new evidence, attributable historical engagement, relationship-path information value, cause/geography relevance, evidence quality/independence/freshness, identity resolvability, novelty, coverage contribution, and downstream research utility. Penalties cover suppression/restriction, source incompleteness, legacy migration gaps, identity/credit ambiguity, stale activity, institutional-to-person leakage, weak relationship evidence, critical UNKNOWN, contradiction, cohort/source bias, and review cost.

Past gift amount, estimated wealth, title, zip code, age proxy, protected traits, complaint status, channel opt-out, or availability of contact data cannot independently rank a candidate upward. Suppressed records may be retained only in a protected no-action cohort where policy permits, never in an outreach queue. Missing values remain missing. Ranking cannot override gates or represent likelihood to give.

Every factor records provenance, rule/model version, confidence, freshness, and sensitivity. BEN-SUP-05 blocks release on consent/suppression/deletion violations, identity/credit errors, unsupported materiality, sensitive inference, or proposed CRM mutation.

## 14. Durable state and agentic loop

States: CREATED, VALIDATING, OBSERVING, SNAPSHOTTING, HYPOTHESIZING, PLANNING, RESERVING, SCANNING_COHORTS, ANALYZING_RECORD_STATE, RESOLVING_PROVISIONAL_IDENTITIES, RECONCILING_CREDIT, ANALYZING_LONGITUDINAL_ACTIVITY, DETECTING_CHANGE, CHECKING_GOVERNANCE, EVIDENCE_LINKING, EVALUATING, REPLANNING, HANDING_OFF, MONITORING, and terminal SATISFIED, EXHAUSTED, PAUSED, BLOCKED_POLICY, BLOCKED_HUMAN, CANCELLED, FAILED_RECOVERABLE, FAILED_TERMINAL, SUPERSEDED.

Transitions persist expected version, fencing token, reason, actor, attempt, snapshot/input/output hashes, policy/authority, budget delta, timestamp, and audit anchor. Aggregate/outbox commit atomically; terminal changes create successors.

Loop: bind goal, source snapshots, and governance policy; observe cohort coverage, prior decisions, record states, identities, activities, consent/suppressions, schema gaps, and source health; form alternative rediscovery hypotheses; plan read-only and disconfirming evidence; select registered tools/delegates; analyze record history and new evidence; synthesize provisional changes without mutation; evaluate identity, credit, materiality, temporal relevance, consent/purpose, contradictions, fairness/coverage, cost, and downstream value; materially replan; then hand off, monitor, stop, pause, or escalate.

Bound iterations, fan-out, delegation depth 3, cohorts, records, candidates, snapshots, artifacts, external lookups, calls, bytes, time, spend, and sensitive-data exposure. Repeated state/plan/evidence signatures and low marginal information gain trigger safe termination.

## 15. Replanning, delegation, monitoring, and economics

Replan on consent/suppression/deletion change, identity collision, hard/soft-credit conflict, false-merge evidence, migration/schema gap, new external evidence, relationship contradiction, critic rejection, source outage, snapshot drift, downstream correction, policy/budget/deadline change, or tenant-strategy change.

Adapt cohorts, hypotheses, source systems, temporal windows, external-research scope, breadth/depth, order, quotas, and specialist tasks. Stop a branch when governance prohibits processing, material change is absent, identity cannot be separated within budget, only prohibited data could resolve the gap, source history is insufficient, sources saturate, or marginal value falls below cost/risk.

DelegatedRediscoveryTask.v1 specifies exact objective, source snapshot and record candidates, output schema, authority/source/tool/privacy bounds, budget, deadline, evidence/freshness, depth at most 3, success/stop/escalation, cancellation, and parent lineage. Delegates cannot mutate CRM, widen purpose, reverse suppression, contact a subject, or merge identity. Handoffs include BEN-KNW-02 identity resolution, BEN-KNW-03 evidence verification, capacity/giving/board/relationship intelligence, qualification, data-steward review, and BEN-SUP-05 criticism.

Monitoring reopens on new gift/activity, identity correction, relationship or role event, external evidence, consent/suppression/deletion change, record merge/split, import/migration correction, opportunity state change, or policy update. Reopening creates a successor against a fresh snapshot and never reuses stale permissions.

Budgets cover currency, tokens, model/tool calls, warehouse/CRM/provider quota, storage, elapsed time, fan-out, cohorts, records, artifacts, and operator review. Reserve, reconcile, and release verified unused capacity. Continue only while expected valid rediscovery yield, uncertainty reduction, coverage, or decision value exceeds marginal cost, privacy exposure, and operational risk.

## 16. Persistence, interfaces, recovery, and security

Persist goals, source snapshots, observations, hypotheses, plans, provisional identities, record states, governance states, activities, credit/relationship observations, change sets, counterfactuals, candidates, evidence, contradictions, fingerprints, rankings, coverage/fairness diagnostics, decisions, delegations, handoffs, monitoring, budgets, transitions, human actions, events, and audit.

Require tenant keys/constraints, immutable source locators, append-only research history, encrypted sensitive fields, purpose/retention/deletion metadata, exact versions, optimistic concurrency/fencing, transactional outbox, idempotency ledger, RLS/equivalent negative tests, and forward/rollback/mixed-version migrations. Deleted-data tombstones contain no unnecessary subject data.

Commands support submit, pause, resume, cancel, supersede, handoff, monitor, disposition, and replay-safe recovery; no CRM mutation command exists. Queries expose source lineage, identity alternatives, record/governance state, activities/credit/relationships, change sets, candidates/gaps, ranking sensitivity, coverage, budgets, decisions, and audit. Events cover accepted, snapshot bound, plan revised, change observed, governance blocked, candidate discovered/suppressed/handed off, critic/policy/budget/provider state, monitoring, and termination.

Recovery resumes from verified snapshots, reconciles delivery/budgets, obtains fresh fencing, rechecks consent/suppression/deletion before any resumed action, preserves artifacts, and quarantines integrity or cross-tenant failures. Unknown external effects invoke BEN-SUP-06.

Threats include prompt/note poisoning, stale-snapshot use, CRM write escalation, deleted-profile resurrection, suppression bypass, contact harvesting, false merge/split, household and gift-credit leakage, sensitive free-text exposure, protected-trait inference, model memorization, IDOR, cross-tenant cache/graph/vector/queue/object leakage, forged history/evidence, duplicate delivery, denial-of-wallet, secrets, replay, and evaluator gaming.

Controls include read-only credentials and network paths, workload identity, least privilege, per-access tenant authorization, structured adapters, instruction/data separation, field allowlists, hashes/provenance, snapshot pinning, consent/deletion enforcement, minimization, encryption, egress/rate/budget controls, telemetry redaction, retention/deletion propagation, kill switch, signed commands, audit anchors, dependency pinning/SBOM, and alerts. Public availability never expands first-party purpose or contact permission.

## 17. Memory, observability, evaluation, and tests

Tenant-scoped memory stores strategies, cohort/source yields, correction patterns, and outcomes, never reusable sensitive profiles or suppressed/deleted content. Learning proposals require versioned offline evaluation, privacy/fairness/security review, canary, monitoring, and rollback. Online authority, consent, suppression, deletion, identity, gate, or CRM-write changes are prohibited.

Metrics include valid-rediscovery precision, incremental material-evidence yield, identity false-merge/false-split, gift-credit error, CRM-versus-research conflation, suppression/deletion violations, stale-snapshot errors, dormant/opportunity false positives, relationship overclaim, UNKNOWN preservation, evidence independence/freshness, cohort/source concentration, critic overturn, downstream acceptance/correction, calibration, cost, latency, replans, stops, retries, and isolation attempts.

Gold cases include the $100 donor with later verified ownership; large historical donor under do-not-contact; erased record with tombstone; deceased record; household gift; soft credit; matching employer; donor-advised gift; anonymous gift; duplicate spouses sharing contact data; recycled email; false merge; orphaned record; unassigned relationship; stale major-donor flag; lapsed label with missing migration years; refunded gift; event registration without attendance; stalled opportunity; changed consent during run; new board role; company value without personal ownership; cross-tenant poison; and malicious CRM note.

Separate tuning, calibration, development, regression, and final-certification datasets. Measure precision/recall where observable, materiality, identity/credit/governance accuracy, evidence sufficiency/independence, calibration/abstention, privacy/fairness incidents, coverage/concentration, downstream acceptance/rejection, critic overturn, cost, and time.

Unit/property tests prove source/research/decision separation, no CRM writes, suppression and deletion precedence, UNKNOWN consent non-permission, entity and credit separation, temporal dormancy semantics, no capacity inference from gifts/company value, stable fingerprints, authority non-widening, budget conservation, bounded loop/delegation, snapshot consistency, and immutable lineage.

Contract/integration tests cover CRM/warehouse/change-log/consent/gift/event/opportunity/licensed adapters, schemas, evidence grouping, entity/specialist/sync handoffs, policy/ranking services, migrations, outbox/idempotency, cancellation, monitoring, restart/concurrency, duplicate/reordered events, mid-run governance changes, deletion propagation, and tenant isolation.

End-to-end, adversarial, load, soak, chaos, and disaster-recovery tests exercise every gold case plus forged notes/history, consent race, snapshot drift, mass duplicate cohort, IDOR, prompt injection, worker death at every state, CRM/provider/model/database/broker outage, rate shock, outbox backlog, regional failover, backup restore with deleted-data validation, kill switch, secret/personal-data leakage, and evaluator manipulation.

## 18. Deployment, acceptance, and final report

Version schemas, prompts, models, tools, read-only adapters, source dictionaries, identity/credit/dormancy/change rules, consent/suppression/deletion policy, ranking, and flags. Roll out through offline evaluation, shadow rediscovery, tenant/cohort canaries, limited fields/source classes, monitored expansion, then GA only after gates. Rollback preserves snapshot/evidence/candidate/audit lineage, deletion compliance, and in-flight compatibility.

ADRs cover CRM-versus-research truth, source snapshots, rediscovery taxonomy, identity/household/credit, dormancy, material change, consent/suppression/deletion precedence, privacy/fairness, sources, matching/ranking, persistence/workflow, tenancy, economics, monitoring, and learning. Runbooks cover unauthorized write attempt, suppression/deletion failure, false merge/split, gift-credit error, stale snapshot, migration gap, poisoned note, privacy request, source outage, tenant incident, cost anomaly, stuck run, outbox backlog, kill switch, rollback, and disaster recovery.

G0–G5 require repository discovery; constitutional conformance; machine contracts; deterministic snapshot, identity, credit, temporal, consent/suppression/deletion, evidence, policy, ranking, economic, concurrency, and privacy foundations; executed multi-cycle hypothesis, source selection, evaluation, replanning, handoff, and monitoring; and security, isolation, privacy/fairness, calibration, load, soak, chaos, recovery, deletion-safe restore, observability, rollback, documentation, and independent evaluation.

Return traceability; repository maps; code/migrations/interfaces/workflows/events; adapter/evidence integration; executed tests/evaluations; multi-cycle traces; snapshot, source/research separation, identity/credit, material-change, consent/suppression/deletion, no-write, and successor proofs; ranking sensitivity and cohort coverage/fairness; security/privacy/tenant evidence; calibration/errors; performance/cost/recovery; residual risks/skips/failures/waivers/owners/expiry; and governed G0–G5 verdict.

This specification itself proves no implementation. A score of 95–100 or production-ready verdict may be reported only from attached executed evidence with every blocking gate passed.
