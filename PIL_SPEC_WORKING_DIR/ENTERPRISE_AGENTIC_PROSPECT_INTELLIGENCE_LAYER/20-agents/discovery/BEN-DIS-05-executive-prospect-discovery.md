# BEN-DIS-05 — Executive Prospect Discovery Agent

**Specification ID:** PIL-AGENT-BEN-DIS-05  
**Version:** 1.0.0  
**Family:** Discovery  
**Default autonomy:** A2 — prepare and queue  
**Maximum delegation depth:** 3  
**Cadence:** On-demand, event-driven, and governed monitoring  
**Boundary:** Produces provisional executive-person prospect candidates and explicit research gaps; never canonical identity, verified capacity, philanthropic propensity, contact permission, qualification, solicitation authority, or CRM state  
**Status:** Final specification pending implementation evidence

## 1. Chain-It directive

Implement BEN-DIS-05 as a durable, goal-owning discovery agent inheriting Discovery Agent Shared Contract v2.0.0. Before changing code, inspect the constitution, agent and service registries, ResearchStrategy.v2, Prospect Digital Twin, tenant/domain twin, person/organization/role/evidence contracts, source and capability registry, policy engine, workflow runtime, persistence and migrations, APIs/events, observability, evaluations, deployment controls, and repository instructions. Produce repository interaction, authority, trust-boundary, person–organization–role, temporal-data-flow, privacy, and requirement-traceability maps.

Reuse registered adapters and deterministic services. Never invent people, roles, tenure, employers, directorships, ownership, compensation, equity, liquidity, wealth, giving, affiliations, locations, contact details, provider endpoints, permissions, test results, or readiness.

Implement goal–observe–hypothesize–plan–select/delegate–discover–attribute–evaluate–replan–handoff/monitor/stop. A title scraper, employer directory, biography summarizer, wealth filter, contact enricher, or one-shot prompt is not this agent.

## 2. Mission and accountable outcome

Discover executives, founders, owners, partners, and board leaders whose verified current or historically relevant professional positions, governance responsibilities, geographic relationships, sector experience, and separately evidenced philanthropic or community activity make them legitimate candidates for governed downstream research under the tenant strategy.

The accountable output is a precise, diverse, evidence-linked set of provisional person candidates with identity alternatives, role and board-service intervals, organization attribution, mobility events, capacity indicators, philanthropic indicators, relationship hypotheses, contradictions, missing decisive facts, and exact specialist tasks.

Success is downstream-valid discovery with calibrated uncertainty. It is not the number of names, senior titles, prestigious employers, boards, presumed wealth, estimated net worth, emails, or superficial keyword matches.

## 3. Reasoning authority and non-goals

BEN-DIS-05 owns executive search hypotheses, source-mix adaptation, provisional person synthesis, temporal role reasoning, executive mobility analysis, preliminary board and organization attribution, signal classification, ranking, coverage analysis, and specialist handoff.

It does not:

- establish canonical person, household, company, subsidiary, family office, foundation, or board identity;
- infer personal wealth, liquidity, disposable capacity, beneficial ownership, or giving capacity from employer revenue, market capitalization, title, compensation, stock awards, options, share price, or company success;
- infer personal philanthropy from corporate, employer-foundation, family-foundation, spouse, household, customer, or employee giving;
- treat an officer, independent director, advisory-board member, trustee, observer, investor, consultant, or honorary title as interchangeable;
- treat current, acting, interim, incoming, former, retired, emeritus, nominee, or announced roles as equivalent;
- infer affinity, ideology, religion, health, protected traits, or personal cause commitment from employer, board, residence, name, biography, or model association;
- fabricate or enrich private contact details, scrape prohibited sources, bypass access controls, accept terms, send messages, solicit, score protected traits, or mutate CRM;
- certify identity, capacity, propensity, affinity, relationship strength, qualification, or solicitation readiness.

Identity resolution, wealth/capacity research, philanthropic-history validation, relationship mapping, contact governance, qualification, critic review, outreach, and CRM synchronization remain separate responsibilities.

## 4. Durable goal and inputs

ExecutiveDiscoveryGoal.v1 requires tenant/domain/goal/strategy ids and versions; decision enabled; target executive and governance role classes; organization, industry, cause, population, geography, time, and relationship semantics; inclusion/exclusion; permitted public and licensed data classes; evidence tiers; identity and temporal thresholds; source groups; candidate/handoff/diversity limits; coverage objectives; budgets; deadline; A2 ceiling; critic gates; monitoring triggers; and success, stop, pause, and escalation conditions.

Inputs include ResearchStrategy.v2; Prospect Digital Twin; tenant programs, service geographies, constituencies, alumni and governed relationship seeds; Domain Pack ontologies; known persons and organizations; public company, private company, nonprofit, association, and board universe where licensed and permitted; source/capability registry; evidence, freshness, corroboration, privacy, fairness, and contact policy; prior candidates and WorkFingerprints; provider health/economics; downstream outcomes/corrections; policy snapshot; and budget.

Reject tenant mismatch, invalid schema, stale policy or tenant twin, undefined person/role semantics, missing stopping rules, prohibited sources or data classes, unavailable mandatory evidence tier, strategy contradiction, unresolved lawful-use basis where required, or requested authority above A2.

## 5. Person identity and namesake protection

PersonIdentityHypothesis.v1 records provisional person id, display and normalized names, documented variants, former names only when lawfully sourced and relevant, honorifics/suffixes, organization and role anchors, geography anchors, education or credential anchors where permitted, stable public identifiers, source-specific identifiers, candidate matches, negative evidence, collision indicators, confidence, and unresolved discriminators.

Names are observations, not identifiers. Shared names, initials, titles, employers, schools, cities, portraits, or biography phrases cannot alone merge records. Name changes, transliteration, diacritics, nicknames, suffixes, shared family names, and recycled biography text are preserved without speculative equivalence.

IdentityClaim.v1 contains subject hypothesis, predicate, value, source group, locator and captured artifact hash, observed/published/effective intervals, extraction method, confidence, contradiction set, and privacy classification. Claims remain source-bound until the deterministic identity service and BEN-INT-01 approve canonicalization.

A possible collision above policy threshold sets NEEDS_IDENTITY_RESOLUTION and blocks person-level aggregation, capacity/propensity synthesis, contact linkage, and downstream qualification. The system must prefer two unresolved people over one contaminated profile.

## 6. Organization, role, and tenure model

ExecutiveRoleObservation.v1 requires person hypothesis, organization hypothesis and legal entity, brand if different, role title as published, normalized role class, employment/governance relationship, seniority scope, business unit, function, geography, appointment/status language, announced/start/end/observed intervals, source, confidence, and contradiction.

Normalized role classes include founder/co-founder, beneficial owner where verified, executive officer, C-suite functional leader, business-unit executive, managing partner, general partner, operating partner, elected officer, independent director, executive director, trustee, board chair, committee chair/member, advisory-board member, observer, consultant, and other governed categories.

Status values are ANNOUNCED_INCOMING, CURRENT_VERIFIED, CURRENT_UNCERTAIN, ACTING, INTERIM, ON_LEAVE, DEPARTURE_ANNOUNCED, FORMER, RETIRED, EMERITUS, NOMINEE, WITHDRAWN, DECEASED, and UNKNOWN. “Present” on an undated or stale biography is not current verification. Search snippets, cached profiles, and model memory cannot establish tenure.

One person may hold simultaneous roles. Each role has an independent effective interval and evidence clock. Parent, subsidiary, portfolio company, franchise, joint venture, brand, fund, management company, and board entity remain distinct. A parent-company title cannot silently transfer to a subsidiary, and a portfolio-company board role does not establish employment by its investor.

## 7. Board and governance intelligence

BoardServiceHypothesis.v1 records legal board entity, governing/advisory classification, public/private/nonprofit/association/foundation context, director independence, appointment mechanism, officer role, committee memberships and chair status, fiduciary status if documented, representation capacity, service interval, source, conflicts, and confidence.

Board service must distinguish statutory directors and trustees from advisory councils, honorary boards, event committees, councils, observers, and informal advisors. Committee membership is separately time-bounded. “Board member” language is not enough when the board type or entity is ambiguous.

BoardOverlapObservation.v1 may identify a research path between the candidate, tenant, known supporter, organization, cause, or geography, but it does not prove acquaintance, influence, access, affinity, or willingness to introduce. Relationship strength remains UNKNOWN until BEN-REL-01 and applicable evidence rules resolve it.

Service on an employer-controlled foundation is not personal giving. Service on a nonprofit board is a governance/affiliation signal and cannot by itself become a donation, cause commitment, or propensity claim.

## 8. Mobility and temporal change reasoning

ExecutiveMobilityEvent.v1 represents appointment, promotion, role expansion, interim assignment, leave, resignation, termination, retirement, board election, board departure, merger/acquisition transfer, spin-off, company rename, bankruptcy, dissolution, relocation, and death. It records event date versus announcement date, affected role intervals, successor/predecessor evidence, entity lineage, source independence, confidence, and required revalidation.

Conflicting current-role claims trigger temporal reconciliation using source authority, event time, publication time, effective time, source freshness, directness, and independent corroboration. Newer is not automatically more authoritative; a current official filing may supersede an old biography, while a recent copied directory may not.

Candidate outputs state “as of” time and temporal confidence. A later mobility event creates a successor candidate/version, invalidates affected rankings and handoffs, and invokes targeted monitoring; history is never overwritten.

## 9. Capacity indicators without wealth inference

ExecutiveCapacityIndicator.v1 records only the observed fact and its limitations: documented compensation components and fiscal period, equity award, option, reported beneficial ownership, transaction, partnership/fund role, founder liquidity event, property or asset evidence where lawful and policy-permitted, or other registered indicator. It includes currency, valuation date/basis, vested/unvested/restricted/contingent status, direct/indirect ownership, reporting threshold, source, confidence, and privacy class.

Company valuation, revenue, assets, fundraising, market capitalization, or stock price is organization data and never a person’s wealth. Compensation is not disposable wealth. Awards and options are not ownership or liquidity. Reported beneficial ownership may be indirect, shared, thresholded, stale, pledged, or economically constrained. Private-company ownership percentages and valuations remain UNKNOWN absent evidence.

The agent may emit a capacity-research hypothesis, never a net-worth estimate or capacity tier unless a separately governed deterministic service and specialist contract authorize it. Missing capacity data cannot become zero, median imputation, or a negative signal.

## 10. Philanthropic, community, and affiliation evidence

ExecutivePhilanthropicObservation.v1 separates personal donation; jointly attributed household donation; donor-advised-fund recommendation where disclosed; personal/family foundation role; foundation grant; nonprofit board/service; volunteer activity; public pledge; event participation; award; advocacy; and employer-sponsored activity.

Each observation records actor and role, recipient, intermediary, amount/range/currency if published, commitment/payment status, attribution language, purpose, geography, effective interval, source group, evidence, uncertainty, and privacy classification. PERSONAL, HOUSEHOLD, FOUNDATION, CORPORATE, EMPLOYEE_PROGRAM, and UNKNOWN attribution may not be collapsed.

A foundation sharing a surname is not a family foundation without evidence. A spouse’s or relative’s gift is not the executive’s gift. Attendance, quotes, awards, board service, social follows, political activity, or event sponsorship do not establish charitable giving. Corporate matching does not reveal the employee’s amount beyond what is explicitly documented.

CauseAffinityHypothesis.v1 must identify the exact evidence class, alternative explanations, recency, consistency, and disconfirming evidence. It remains a hypothesis for specialist validation and cannot infer sensitive or protected traits.

## 11. Candidate output contract

ExecutiveProspectCandidate.v1 requires:

- candidate/version and tenant/domain/run/plan/hypothesis lineage;
- provisional person identity, alternatives, collision risks, and discriminating gaps;
- organization/entity graph and independent role/board intervals;
- current-role assessment with as-of time and mobility events;
- capacity indicators separated from capacity conclusions;
- philanthropy, governance, community, and affiliation observations separated by actor and evidence class;
- geographic, sector, cause, and relationship hypotheses with alternatives;
- evidence refs, independent source groups, contradictions, limitations, UNKNOWN values, and privacy labels;
- exclusions, consent/use restrictions, policy result, exact-duplicate and WorkFingerprint checks;
- ranking factors, confidence interval, sensitivity, calibration version, and fairness diagnostics;
- exact specialist and critic tasks;
- authority, budget, models/tools, timestamps, hashes, and prohibited claims.

Statuses are PROVISIONAL, NEEDS_IDENTITY_RESOLUTION, NEEDS_ROLE_VERIFICATION, NEEDS_ENTITY_ATTRIBUTION, NEEDS_CAPACITY_RESEARCH, NEEDS_PHILANTHROPY_VALIDATION, NEEDS_RELATIONSHIP_VALIDATION, READY_FOR_SPECIALIST_HANDOFF, SUPPRESSED_DUPLICATE, EXCLUDED_POLICY, REJECTED_MISMATCH, DECEASED_OR_INACTIVE, or MONITOR.

No status implies wealth, propensity, affinity, relationship, contactability, qualification, or permission to solicit.

## 12. Hypothesis and source planning

ExecutiveDiscoveryHypothesis.v1 contains target segment, role/governance pattern, organization/industry/geography/cause rationale, predicted identity and temporal evidence, permitted source classes and independent groups, disconfirming conditions, collision and attribution risks, privacy/fairness risk, expected value/cost, confidence, and status.

Maintain materially distinct hypotheses where useful: current senior executive, founder/owner, portfolio operating leader, independent director, nonprofit trustee, recent executive mover, local corporate leader, and documented philanthropic leader. Do not generate cosmetic title or query variants, and do not restrict discovery to culturally narrow executive-title conventions.

ExecutiveSourcePlan.v1 maps hypotheses to registered capabilities, official organization leadership/governance pages, regulatory filings, proxy and annual reports, appointment/departure releases, professional biographies, nonprofit filings and reports, foundation records, recipient acknowledgements, licensed sources, query concepts, expected artifacts, quotas, parallelism, rate limits, budget, fallbacks, and stop conditions.

Official sources establish only what they state and when. Regulatory filings may be authoritative for specified roles, compensation, and ownership as of defined periods, not present personal wealth. Recipient sources may establish attributed activity but not identity alone. Aggregators and search results are discovery aids. Every consequential fact retains the captured source and temporal context.

## 13. Deterministic gates and ranking

Hard gates reject cross-tenant references, prohibited source/data, exclusions, failed evidence integrity, exact duplicate work, unresolved identity collision above threshold, absent required current-role evidence, deceased/inactive candidates where excluded, fabricated contact or financial data, and known strategy mismatch.

Ranking factors are versioned policy: role relevance, verified temporal currency, organization/sector alignment, geography, separately evidenced philanthropic or governance relevance, lawful relationship-path value, evidence quality/independence/freshness, novelty, information gain, and downstream utility. Penalties cover namesake risk, entity ambiguity, stale or interim roles, source concentration, corporate-to-person attribution risk, weak signal class, critical UNKNOWN values, contradictions, bias/concentration, and follow-up cost.

Title prestige, employer size, inferred protected traits, name origin, age proxy, neighborhood proxy, presumed gender, and unsupported wealth are prohibited ranking factors. Geographic and education signals require purpose limitation and fairness testing. Missing values remain missing. Ranking cannot override gates or be described as donation probability.

Every factor records provenance, estimator/rule version, confidence, freshness, and sensitivity. Produce distribution and subgroup diagnostics where lawful, without inferring protected characteristics. BEN-SUP-05 blocks release on unsupported identity, role, capacity, philanthropy, or relationship claims.

## 14. Durable state and agentic loop

States: CREATED, VALIDATING, OBSERVING, HYPOTHESIZING, PLANNING, RESERVING, DISCOVERING_PERSONS, RESOLVING_PROVISIONAL_IDENTITIES, DISCOVERING_ROLES, RECONCILING_TENURE, ANALYZING_GOVERNANCE, CLASSIFYING_SIGNALS, EVIDENCE_LINKING, EVALUATING, REPLANNING, HANDING_OFF, MONITORING, and terminal SATISFIED, EXHAUSTED, PAUSED, BLOCKED_POLICY, BLOCKED_HUMAN, CANCELLED, FAILED_RECOVERABLE, FAILED_TERMINAL, SUPERSEDED.

Transitions persist expected version, fencing token, reason, actor, attempt, input/output hashes, policy/authority, budget delta, timestamp, and audit anchor. Aggregate and outbox commit atomically. Terminal changes create successors.

Loop: bind the goal and tenant strategy; observe existing people, organizations, roles, gaps, source health, exclusions, and coverage; form alternative person/role hypotheses; plan independent sources and disconfirming searches; select registered tools or bounded delegates; capture evidence; synthesize provisional identity and temporal-role graphs; classify capacity and philanthropic indicators without conversion to conclusions; evaluate identity separation, role currency, entity attribution, signal provenance, contradictions, fairness, coverage, cost, and downstream value; materially replan; then hand off, monitor, stop, pause, or escalate.

Bound iterations, fan-out, delegation depth 3, candidates, roles, sources, calls, bytes, time, spend, and sensitive-data exposure. Repeated state/plan/evidence signatures and low marginal information gain trigger safe termination.

## 15. Replanning, delegation, monitoring, and economics

Replan on person collisions, conflicting biographies, appointment or departure, merger/spin-off/rebrand, board turnover, entity ambiguity, stale filings, unverified compensation/ownership interpretation, attribution conflict, source poisoning, source outage, critic rejection, downstream correction, policy change, budget pressure, deadline, or tenant-strategy change.

Adapt target segments, discriminators, source mix, breadth/depth, temporal windows, order, quotas, and specialist tasks. Stop a branch when identity cannot be separated within budget, current role is disproven, strategy mismatch is established, only prohibited data could resolve the gap, sources saturate, or marginal value falls below cost/risk.

DelegatedExecutiveDiscoveryTask.v1 specifies exact objective, subject alternatives, input claims, output schema, authority/source/tool/privacy bounds, budget, deadline, evidence/freshness, depth at most 3, success/stop/escalation, and parent lineage. Delegates cannot expand source classes, contact people, merge identity, or conclude capacity/propensity. Handoffs include BEN-INT-01 person resolution, BEN-INT-03 organization resolution, capacity research, philanthropic validation, relationship mapping, qualification, and BEN-SUP-05 criticism.

Monitoring reopens on appointment/departure, compensation or ownership filing, board election/resignation, organization transaction, public philanthropic event, identity correction, death, source correction, tenant relationship change, or policy change. Reopening creates a successor.

Budgets cover currency, tokens, model/tool calls, licensed-provider quota, storage, elapsed time, fan-out, people, roles, artifacts, and operator review. Reserve before work, reconcile actual use, and release verified unused capacity. Continue only while expected valid-candidate yield, uncertainty reduction, coverage, or decision value exceeds marginal cost, privacy exposure, and operational risk.

## 16. Persistence, interfaces, recovery, and security

Persist goals, observations, hypotheses, source plans, provisional identities, role and board intervals, mobility events, capacity and philanthropy observations, candidates, evidence, contradictions, fingerprints, rankings, fairness diagnostics, decisions, delegations, handoffs, monitoring, budgets, transitions, human actions, events, and audit records.

Require tenant keys and constraints, append-only history, encrypted sensitive fields, purpose and retention metadata, exact versions, optimistic concurrency and fencing, transactional outbox, idempotency ledger, row-level or equivalent isolation negative tests, and forward/rollback/mixed-version migrations.

Commands support submit, pause, resume, cancel, supersede, handoff, monitor, disposition, and replay-safe recovery. Queries expose identity alternatives, role/board timeline, source artifacts, signal classes, contradictions/gaps, ranking sensitivity, privacy/policy basis, budget, decisions, and audit. Events cover accepted, hypothesis/plan revision, person/role/board/mobility observed, identity or temporal conflict, signal classified, candidate discovered/suppressed/handed off, critic/policy/budget/provider state, monitoring, and termination.

Recovery resumes from verified state, reconciles delivery and budgets, obtains fresh fencing, preserves captured artifacts, and quarantines integrity or cross-tenant failures. Unknown external effects invoke BEN-SUP-06.

Threats include prompt/source poisoning, fake biographies, forged appointments, same-name contamination, employer/board/entity conflation, stale-role laundering, compensation-to-wealth inference, corporate-to-person giving attribution, contact-data fabrication, protected-trait inference, doxxing, IDOR, cross-tenant cache/graph/vector/queue/object leakage, forged evidence, duplicate delivery, denial-of-wallet, secrets, replay, and evaluator gaming.

Controls include workload identity, least privilege, per-access tenant authorization, structured adapters, instruction/data separation, hashes/provenance, source allowlists, field-level privacy classification, minimization, purpose limitation, retention/deletion, secret references, encryption, egress/rate/budget controls, telemetry redaction, kill switch, signed commands, audit anchors, dependency pinning/SBOM, and alerts. Public availability never implies permitted collection or use.

## 17. Memory, observability, evaluation, and tests

Tenant-scoped memory stores strategies, source yields, corrections, and outcomes, never unverified person truth or reusable sensitive profiles. Learning proposals require versioned offline evaluation, privacy/fairness/security review, canary, monitoring, and rollback. Online changes to identity thresholds, authority, policy, gates, or protected-feature rules are prohibited.

Metrics include candidate precision, person collision/false-merge/false-split rates, current-role and tenure error, legal-entity attribution error, board-type error, corporate-to-person leakage, capacity overclaim, philanthropic attribution error, UNKNOWN preservation, evidence independence/freshness, temporal calibration, source/segment concentration, subgroup distribution where lawful, critic overturn, downstream acceptance/correction, cost, latency, replans, stops, retries, and isolation attempts.

Gold cases include common-name executives; suffix and name change; two executives at related entities; concurrent roles; acting/interim/incoming/former role; stale company biography; acquisition and spin-off; parent versus subsidiary officer; independent director versus advisor; nonprofit trustee versus event committee; employer-foundation gift; spouse or household gift; namesake foundation; equity award versus beneficial ownership; company valuation versus personal capacity; private founder with unknown ownership; moved executive; deceased executive; fabricated email; prohibited-source record; protected-trait proxy; cross-tenant poison; and prompt injection.

Separate tuning, calibration, development, regression, and final-certification datasets. Measure precision/recall where observable, temporal accuracy, identity/role/entity error, signal-attribution false positives, evidence sufficiency and independence, calibration/abstention, false discovery, fairness and concentration, downstream acceptance/rejection, critic overturn, cost, and time.

Unit/property tests prove names are not identifiers; identity alternatives remain separate; role intervals do not overlap incorrectly; status semantics are preserved; parent/subsidiary and board types remain distinct; company metrics never become person capacity; corporate/household/foundation activity never becomes personal giving; UNKNOWN is preserved; ranking excludes prohibited features; authority cannot widen; budgets conserve; fingerprints are stable; loops/delegation are bounded; and lineage is immutable.

Contract/integration tests cover schemas, leadership/filing/biography/nonprofit/licensed adapters, evidence grouping, identity/entity/specialist handoffs, policy and ranking services, migrations, outbox/idempotency, cancellation, monitoring, restart/concurrency, duplicate/reordered events, deletion/retention workflows, and tenant isolation.

End-to-end, adversarial, load, soak, chaos, and disaster-recovery tests exercise every gold case plus forged filings/biographies, malicious pages, IDOR, prompt injection, worker death at every state, provider/model/database/broker outage, rate shock, outbox backlog, regional failover, backup restore, kill switch, secret or personal-data leakage, and evaluator manipulation.

## 18. Deployment, acceptance, and final report

Version schemas, prompts, models, tools, adapters, ontologies, identity/role/temporal rules, privacy and evidence rules, ranking, and flags. Roll out through offline evaluation, shadow discovery, tenant canary, limited sources and data classes, monitored expansion, then general availability only after gates. Rollback preserves identity, role, evidence, candidate, decision, and audit lineage plus in-flight compatibility.

Architecture decisions cover provisional person identity, temporal roles, board classification, mobility, capacity-indicator limits, philanthropy attribution, source trust, privacy/fairness, ranking, persistence/workflow, tenancy, economics, monitoring, and learning. Runbooks cover false merge/split, stale role, wrong entity or board type, capacity/philanthropy overclaim, prohibited-data exposure, fake biography/filing, privacy request, source outage, tenant incident, cost anomaly, stuck run, outbox backlog, kill switch, rollback, and disaster recovery.

G0–G5 require repository discovery; constitutional conformance; machine contracts; deterministic identity, temporal, entity, evidence, policy, ranking, economic, concurrency, and privacy foundations; executed multi-cycle hypothesis, source selection, evaluation, replanning, handoff, and monitoring; and security, isolation, privacy/fairness, calibration, load, soak, chaos, recovery, observability, rollback, documentation, and independent evaluation.

Return traceability; repository maps; code, migrations, interfaces, workflows, and events; adapter/evidence integration; executed tests/evaluations; multi-cycle traces; identity alternatives and collision proof; role/board temporal reconciliation; entity attribution; capacity/philanthropy separation; ranking sensitivity and fairness evidence; source/segment coverage; security, privacy, and tenant evidence; calibration/errors; performance/cost/recovery; residual risks, skips, failures, waivers, owners, and expiry; and governed G0–G5 verdict.

This specification itself proves no implementation. A score of 95–100 or production-ready verdict may be reported only from attached executed evidence with every blocking gate passed.
