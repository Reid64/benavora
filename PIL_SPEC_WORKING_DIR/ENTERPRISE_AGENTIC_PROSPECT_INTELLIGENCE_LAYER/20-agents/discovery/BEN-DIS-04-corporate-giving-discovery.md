# BEN-DIS-04 — Corporate Giving Discovery Agent

**Specification ID:** PIL-AGENT-BEN-DIS-04  
**Version:** 1.0.0  
**Family:** Discovery  
**Default autonomy:** A2 — prepare and queue  
**Maximum delegation depth:** 3  
**Cadence:** On-demand, event-driven, and governed monitoring  
**Boundary:** Produces provisional corporate-giving program candidates and research gaps, never verified eligibility, application authority, award probability, executive giving, or CRM state  
**Status:** Final specification pending implementation evidence

## 1. Chain-It directive

Implement BEN-DIS-04 as a durable goal-owning discovery agent inheriting Discovery Agent Shared Contract v2.0.0. Inspect constitution, registries, ResearchStrategy.v2, Prospect Digital Twin, tenant/domain twin, organization/entity/evidence/program contracts, source/capability registry, policy, workflow runtime, persistence/migrations, APIs/events, observability, evaluations, deployment, and repository instructions. Produce repository interaction, authority, trust-boundary, corporate-structure, data-flow, temporal-model, and requirement-traceability maps.

Reuse canonical adapters and deterministic services. Never invent corporate programs, legal entities, parent/subsidiary relationships, locations, funding, eligibility, application status, portals, deadlines, contacts, provider endpoints, permissions, test results, or readiness.

Implement goal–observe–hypothesize–plan–select/delegate–discover–attribute–evaluate–replan–handoff/monitor/stop. A directory scraper, employer list, keyword matcher, or one-shot prompt is not this agent.

## 2. Mission and accountable outcome

Discover companies and corporate-controlled giving mechanisms whose documented community-investment priorities, giving behavior, operating footprint, eligibility, contribution types, and access paths plausibly align with the tenant’s approved research strategy.

The accountable output is a precise, diverse, evidence-linked set of provisional corporate-giving candidates with legal/brand structure, program ownership, decision geography, contribution mechanism, formal and observed behavior, eligibility gaps, application-access state, contradictions, and exact downstream research tasks.

Success is downstream-valid opportunity discovery—not company size, employer count, revenue, brand familiarity, local physical presence, or raw candidate volume.

## 3. Reasoning and truth boundary

BEN-DIS-04 owns corporate-giving search hypotheses, source-mix adaptation, preliminary company/program structure synthesis, giving-mechanism classification, formal-versus-observed eligibility comparison, location/decision-authority reasoning, access-path discovery, ranking, coverage analysis, and handoff.

It does not:

- establish canonical company, subsidiary, facility, foundation, or program identity;
- infer giving from company revenue, valuation, profitability, headcount, or local presence;
- attribute corporate giving to an executive or employee;
- treat a corporate foundation and operating company as interchangeable;
- treat marketing sponsorship, commercial rebate, political contribution, employee benefit, and charitable grant as equivalent;
- infer that a local facility controls a national application or vice versa;
- certify eligibility, application openness, award probability, or decision-maker identity;
- fabricate portals, deadlines, URLs, email addresses, contacts, or donation limits;
- submit forms, create accounts, accept terms, evade access controls, or mutate CRM.

Entity resolution, corporate structure, facility/location intelligence, giving verification, relationship mapping, eligibility qualification, critic review, application operations, and CRM synchronization remain separate.

## 4. Durable goal and inputs

CorporateGivingDiscoveryGoal.v1 requires tenant/domain/goal/strategy ids and versions; decision enabled; tenant legal/program/geographic profile; cause/population/activity/geography/time semantics; permitted corporate and contribution types; inclusion/exclusion; evidence tiers; formal/observed eligibility requirements; giving-history window; source classes; company/program/handoff limits; diversity/coverage objectives; budgets; deadline; A2 ceiling; critic gates; monitoring triggers; and success/stop/escalation.

Inputs include ResearchStrategy.v2; Prospect Digital Twin; tenant legal status, programs, populations, service areas, project types, budgets, fiscal sponsorship, operating history, contribution needs, exclusions, and relationships; Domain Pack ontologies; source/capability registry; evidence/freshness/corroboration policy; known organizations/opportunities; entity/brand/parent/subsidiary state; prior candidates/fingerprints; provider health/economics; outcomes/corrections; policy snapshot; and budget.

Reject tenant mismatch, invalid schema, stale policy/twin, missing purpose/stopping rules, undefined corporate/contribution semantics, prohibited source/data, unavailable mandatory evidence tier, contradictory strategy, or authority above A2.

## 5. Corporate identity and control model

CorporateIdentityHypothesis.v1 records provisional legal name, trade names, former names, legal form, jurisdiction, identifiers where permitted, public/private status, parent/subsidiary/affiliate/franchise/joint-venture relationships, brand ownership, headquarters, facilities, operating geographies with intervals, merger/acquisition/spin-off/dissolution hypotheses, entity candidates, collision indicators, evidence, confidence, and gaps.

ControlRelationship.v1 records controller, controlled entity/program, relationship type, ownership/control confidence, effective interval, source, contradiction, and operational implication. Brand similarity, shared domain, shared address, common officers, or historical ownership cannot alone establish current control.

Franchise locations are not automatically corporate-controlled. A retailer brand, operating subsidiary, corporate foundation, charitable trust, employee fund, and local facility may have separate eligibility and decision authority.

Material ambiguity creates a BEN-KNW-02 or BEN-INT-03 handoff and blocks opportunity-ready status.

## 6. Giving mechanism classification

CorporateGivingMechanism.v1 distinguishes:

- corporate-foundation grant;
- direct corporate charitable contribution;
- community-investment grant;
- local facility/store giving;
- sponsorship with charitable or marketing terms;
- in-kind product/service donation;
- employee matching;
- employee volunteer grant;
- workplace giving;
- disaster/emergency response;
- cause-marketing campaign;
- nonprofit partnership or capacity support;
- donation-card/customer nomination;
- other governed mechanism.

Each mechanism records owning legal entity, administering entity, funding source, program name, contribution type, cause/population/activity/geography, decision level, effective interval, status, formal evidence, observed evidence, policy classification, and uncertainty.

Political contributions, lobbying, commercial discounts, procurement, advertising, rebates, customer rewards, and employee benefits are excluded unless a Domain Pack explicitly defines a charitable pathway and policy permits it.

## 7. Corporate giving observation model

CorporateContributionObservation.v1 requires donor legal/program identity, recipient observed identity, contribution amount/range/currency or noncash description, valuation basis, mechanism, authorization/payment/delivery status, purpose, geography, restriction, announcement/effective/payment period, source group, locator/snapshot hash, parent/facility attribution, recipient/donor identity certainty, pass-through/intermediary state, and limitations.

Statuses are ANNOUNCED, AUTHORIZED, COMMITTED, PAID, DELIVERED_IN_KIND, PARTIALLY_DELIVERED, RESCINDED, REFUNDED, REPORTED_UNCLEAR, and UNKNOWN. An announcement does not prove payment; pledged retail value does not equal fair-market value or tenant utility; aggregate campaign totals do not establish one company’s amount.

CorporateGivingPattern.v1 records observation set, time window, cadence, magnitude/value distribution, mechanisms, recipient types, causes, geographies, local-versus-central decisions, new/repeat recipients, concentration, multi-year behavior, source independence, missing periods, and confidence.

Observed recipients are behavioral evidence, not formal eligibility. Pass-through, pooled, and co-branded contributions preserve all actors and roles.

## 8. Geography and decision-authority semantics

CorporateGeographyHypothesis.v1 separates headquarters, incorporation, operations, facility/store/service area, employee residence, customer market, community-investment priority, disaster footprint, eligible nonprofit location, eligible project location, and decision-office geography.

Local presence does not prove local giving. National giving does not prove every location participates. A facility’s charitable budget may be controlled locally, regionally, by corporate headquarters, by a separate foundation, or be UNKNOWN.

DecisionAuthorityHypothesis.v1 records decision level, administering unit, role class, evidence, effective interval, confidence, contradiction, and verification task. It never fabricates a named person or contact.

GeographicMatchAssessment compares versioned tenant fields and returns MATCH, MISMATCH, UNKNOWN, NOT_APPLICABLE, or CONFLICTING with evidence on both sides. UNKNOWN never becomes MATCH.

## 9. Eligibility and access model

CorporateEligibilityHypothesis.v1 separates FORMAL_ELIGIBILITY, OBSERVED_RECIPIENT_PATTERN, TENANT_MATCH_HYPOTHESIS, and UNRESOLVED_REQUIREMENT.

Dimensions include nonprofit/tax status, organization type, geography, population, cause, project/activity, operating history, budget/revenue, fiscal sponsorship, religious restrictions, nondiscrimination, grant/contribution size, matching funds, prior relationship, employee nomination, customer voting, facility proximity, invitation, application frequency, and exclusions. Each rule carries source, effective interval, scope, confidence, contradiction, and UNKNOWN handling.

CorporateAccessObservation.v1 statuses are OPEN_CYCLE, ROLLING, PERIODIC_CLOSED, INVITATION_ONLY_VERIFIED, EMPLOYEE_NOMINATION, CUSTOMER_NOMINATION, FACILITY_REQUEST, RELATIONSHIP_REQUIRED, NO_UNSOLICITED_REQUESTS, PROGRAM_INACTIVE, PORTAL_AUTH_REQUIRED, UNKNOWN, or CONFLICTING.

Every portal, URL, deadline, timezone, cycle, contribution cap, required document, nomination condition, and contact channel requires current authoritative evidence and applicable program/entity. Absence of public instructions does not prove invitation-only status.

## 10. Candidate output contract

CorporateGivingCandidate.v1 requires:

- candidate/version and tenant/domain/run/plan/hypothesis lineage;
- provisional company/program identities and corporate-control graph;
- mechanism classifications and owning/administering entities;
- operating, eligible, project, and decision geographies;
- contribution observations/patterns with status and attribution;
- formal eligibility, observed behavior, tenant match, and gaps kept separate;
- access/application observations and freshness;
- decision-authority hypotheses without invented contacts;
- evidence refs, independent source groups, contradictions, limitations, and UNKNOWN values;
- exclusions, policy, exact-duplicate and WorkFingerprint checks;
- ranking factors, confidence interval, sensitivity, calibration version;
- exact specialist/critic tasks;
- authority, budget, models/tools, timestamps, hashes, and prohibited claims.

Statuses: PROVISIONAL, NEEDS_ENTITY_RESOLUTION, NEEDS_STRUCTURE_RESEARCH, NEEDS_GIVING_VALIDATION, NEEDS_ELIGIBILITY_VERIFICATION, NEEDS_ACCESS_VERIFICATION, READY_FOR_SPECIALIST_HANDOFF, SUPPRESSED_DUPLICATE, EXCLUDED_POLICY, PROGRAM_INACTIVE, REJECTED_MISMATCH, or MONITOR.

No status implies eligibility, funding likelihood, executive affinity, or application permission.

## 11. Hypothesis and source planning

CorporateGivingHypothesis.v1 contains target segment, company/program/mechanism type, rationale, cause/population/geography, predicted formal and observed evidence, source classes/independence, disconfirming conditions, structure/attribution risks, privacy/bias risk, expected value/cost, confidence, and status.

Maintain materially different hypotheses where appropriate: corporate-foundation program, direct corporate community investment, local-facility giving, sponsorship, in-kind, employee matching/nomination, disaster response, and nonprofit partnership. Do not generate cosmetic query variants.

CorporateSourcePlan.v1 maps hypotheses to registered capability ids, official corporate/foundation materials, filings, sustainability/impact reports, recipient reports, facility pages, licensed sources, independent groups, query concepts, expected artifacts, quotas, parallelism, rate limits, budget, fallbacks, and stop conditions.

Official pages establish current statements only in context; reports and filings establish reported historical facts; recipient pages may corroborate contributions but not corporate policy; databases are discovery aids. Search snippets and model memory cannot satisfy consequential evidence.

## 12. Deterministic gates and ranking

Hard gates reject cross-tenant references, prohibited source/data, exclusions, failed evidence integrity, exact duplicate work, inactive program when current opportunity is required, unresolved owning entity/control above threshold, fabricated access data, absent required giving evidence, or formal known ineligibility.

Ranking factors are policy-versioned: current program alignment, observed contribution alignment, geography, recipient similarity, evidence quality/independence/freshness, contribution relevance, verified access pathway, novelty, information gain, and downstream value. Penalties cover structure ambiguity, stale programs/reports, formal mismatch, UNKNOWN critical requirements, contradictions, source concentration, announcement/payment confusion, local/national decision confusion, sponsorship/grant conflation, and follow-up cost.

Missing values remain missing. Every factor records provenance, estimator version, confidence, freshness, and sensitivity. Ranking cannot override gates or represent funding probability.

## 13. Durable state and agentic loop

States: CREATED, VALIDATING, OBSERVING, HYPOTHESIZING, PLANNING, RESERVING, DISCOVERING_ENTITIES, DISCOVERING_PROGRAMS, ANALYZING_GIVING, ASSESSING_GEOGRAPHY, ASSESSING_ELIGIBILITY, VERIFYING_ACCESS, EVIDENCE_LINKING, EVALUATING, REPLANNING, HANDING_OFF, MONITORING, and terminal SATISFIED, EXHAUSTED, PAUSED, BLOCKED_POLICY, BLOCKED_HUMAN, CANCELLED, FAILED_RECOVERABLE, FAILED_TERMINAL, SUPERSEDED.

Transitions persist expected version, fencing token, reason, actor, attempt, hashes, policy/authority, budget delta, timestamp, and audit anchor. Aggregate/outbox commit atomically; terminal changes create successors.

Loop: bind goal and tenant profile; observe prior coverage, structure, programs, giving, geography, eligibility and access; form alternative hypotheses; plan independent sources and parallel branches; select registered tools/delegates; gather/preserve evidence; synthesize provisional candidates; evaluate structure, attribution, temporal validity, formal/observed alignment, access, contradictions, coverage, bias, cost, and downstream value; materially replan; then handoff, monitor, stop, pause, or escalate.

Bound iterations, fan-out, delegation depth 3, candidates, programs, observations, calls, bytes, time, and spend. Repeated signatures trigger safe termination.

## 14. Replanning, delegation, monitoring, and economics

Replan when corporate ownership/control changes; parent and program conflict; stated priorities conflict with observed giving; reports/pages are stale; facility decision authority is wrong; contributions are announcement-only; formal eligibility conflicts with recipients; application status changes; provider/downstream feedback changes; or policy, budget, deadline, or tenant twin changes.

Adapt hypotheses, terms, sources, breadth/depth, order, quotas, and bounded tasks. Stop when a formal mismatch is proven, program is inactive, required evidence remains absent after configured effort, sources saturate, or marginal value falls below cost/risk.

DelegatedCorporateDiscoveryTask.v1 specifies exact objective, inputs, output schema, authority/source/tool bounds, budget, deadline, evidence/freshness, depth at most 3, success/stop/escalation, and parent lineage. Handoffs include entity resolution, corporate structure, facility intelligence, giving verification, eligibility/access verification, relationship mapping, qualification, and BEN-SUP-05 criticism.

Monitoring reopens on merger/acquisition/spin-off, new/closed program, impact report, contribution, facility opening/closure, geography change, cycle/deadline change, leadership/administration change, disaster response, or correction. Reopen creates a successor.

Budgets cover currency, tokens, model/tool calls, provider quotas, storage, elapsed time, fan-out, candidates, programs, contribution observations, and operator effort. Reserve, reconcile, and release verified unused capacity. Continue only while expected valid-candidate yield, coverage, uncertainty reduction, or decision value exceeds marginal cost/risk.

## 15. Persistence, APIs, events, recovery, and security

Persist goals, observations, hypotheses, source plans, identities/control relationships, mechanisms, contribution observations/patterns, geographies/authority, eligibility/access, match assessments, candidates, evidence, fingerprints, rankings, decisions, delegations, handoffs, monitoring, budgets, transitions, human actions, events, and audit.

Require tenant keys/constraints, append-only history, encrypted sensitive fields, retention, exact versions, optimistic concurrency/fencing, transactional outbox, idempotency ledger, RLS/equivalent negative tests, and forward/rollback/mixed-version migrations.

Commands support submit, pause, resume, cancel, supersede, handoff, monitor, disposition, and replay-safe recovery. Queries expose structure, mechanisms, giving, geography, eligibility/access, candidates/evidence/gaps, ranking sensitivity, budgets, decisions, and audit. Events cover accepted, hypothesis/plan revision, entity/program/contribution observed, structure/access conflict, candidate discovered/suppressed/handed off, critic/policy/budget/provider state, monitoring, and termination.

Recovery resumes verified state, reconciles delivery/budgets, uses fresh fencing, preserves artifacts, and quarantines integrity or cross-tenant failures. Unknown external effects invoke BEN-SUP-06.

Threats include prompt/source poisoning, fake corporate programs/portals, stale policy laundering, parent/subsidiary/facility conflation, corporate/executive attribution, protected-data inference, IDOR, cross-tenant cache/graph/vector/queue/object leakage, forged reports/evidence, duplicate delivery, denial-of-wallet, secrets, replay, and evaluator gaming.

Controls include workload identity, least privilege, per-access tenant authorization, structured adapters, instruction/data separation, hashes/provenance, source allowlists, secret references, encryption, egress/rate/budget controls, telemetry redaction, retention, kill switch, signed commands, audit anchors, SBOM/pinning, and alerts.

## 16. Memory, observability, evaluation, and tests

Tenant-scoped memory stores plans, yields, source performance, corrections, and outcomes, never canonical corporate truth. Learning proposals require versioned offline evaluation, bias/security review, canary, monitoring, and rollback; online authority/policy/gate changes are prohibited.

Metrics include valid-program precision, legal/control error, corporate/executive conflation, contribution status/valuation error, eligibility/access false positives, geography/decision-authority error, freshness, evidence independence, UNKNOWN handling, source/segment concentration, downstream acceptance/critic overturn, calibration, correction, cost, latency, replans, stops, retries, and isolation attempts.

Gold cases include corporate foundation versus CSR; parent versus subsidiary; franchise; local facility versus national program; sponsorship versus grant; in-kind valuation; announced versus paid contribution; employee nomination; matching program; inactive/stale program; acquisition/rebrand; invitation ambiguity; geographic exclusion; pooled/pass-through gift; aligned but ineligible tenant; nonprofit fiscal sponsor; excluded industry; cross-tenant poison; fake portal; and prompt injection.

Separate tuning, calibration, development, regression, and final certification. Measure precision/recall where observable, structure/attribution error, eligibility/access false positives, evidence sufficiency/independence, calibration/abstention, false discovery, downstream acceptance/rejection, critic overturn, cost, and time.

Unit/property tests prove entity/mechanism/status/geography separation, UNKNOWN preservation, deterministic gates/ranking, non-widening authority, budget conservation, stable fingerprints, bounded loop/delegation, temporal semantics, and immutable lineage.

Contract/integration tests cover schemas, corporate/filing/report/licensed adapters, evidence grouping, entity/structure/specialist handoff, ontology/match/policy services, migrations, outbox/idempotency, cancellation, monitoring, restart/concurrency, duplicate/reordered events, and tenant isolation.

E2E/adversarial/load/soak/chaos/DR tests exercise every gold case plus forged program/portal/report, IDOR, prompt injection, worker death at every state, provider/model/database/broker outage, rate shock, outbox backlog, regional failover, backup restore, kill switch, secret/PII leakage, and evaluator manipulation.

## 17. Deployment, acceptance, and final report

Version schemas, prompts, models, tools, adapters, ontologies, structure/giving/eligibility rules, ranking, and flags. Roll out via offline evaluation, shadow discovery, tenant canary, limited source classes, monitored expansion, then GA after gates. Rollback preserves evidence/candidate/audit lineage and in-flight compatibility.

ADRs cover corporate identity/control, mechanism taxonomy, contribution status/valuation, geography/decision authority, eligibility/access, matching/ranking, sources, persistence/workflow, tenancy, economics, monitoring, and learning. Runbooks cover structure conflict, fake/stale program, contribution error, local/national mismatch, access false positive, source outage, tenant incident, cost anomaly, stuck run, outbox backlog, kill switch, rollback, and DR.

G0–G5 require repository discovery; constitutional conformance; machine contracts; deterministic identity/mechanism/temporal/match/gate/economic/concurrency foundations; executed multi-cycle hypothesis, source selection, evaluation, replanning, handoff, and monitoring; and security, isolation, calibration, load, soak, chaos, recovery, observability, rollback, documentation, and independent evaluation.

Return traceability; repository maps; code/migrations/interfaces/workflows/events; adapter/evidence integration; executed tests/evaluations; multi-cycle traces; corporate-control, mechanism, giving, geography, eligibility, and access proof; ranking sensitivity; source/segment coverage; security/tenant evidence; calibration/errors; performance/cost/recovery; residual risks/skips/failures/waivers/owners/expiry; and governed G0–G5 verdict.

This specification itself proves no implementation. A score ≥95/100 or production-ready verdict may be reported only from attached executed evidence with every blocking gate passed.
