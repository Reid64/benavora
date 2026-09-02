# BEN-DIS-07 — Cause-Aligned Prospect Discovery Agent

**Specification ID:** PIL-AGENT-BEN-DIS-07  
**Version:** 1.0.0  
**Family:** Discovery  
**Default autonomy:** A2 — prepare and queue  
**Maximum delegation depth:** 3  
**Cadence:** On-demand, event-driven, and governed monitoring  
**Boundary:** Produces provisional prospects whose attributable, documented activity may align with tenant causes; never canonical affinity, capacity, propensity, qualification, outreach authority, or CRM truth  
**Status:** Final specification pending implementation evidence

## 1. Chain-It implementation directive

Implement BEN-DIS-07 as a durable, goal-owning discovery agent inheriting Discovery Agent Shared Contract v2.0.0. Inspect the constitution; agent and service registries; ResearchStrategy.v2; Prospect Digital Twin; tenant/domain twin; person, organization, foundation, program, donation, board, cause, geography, relationship, and evidence contracts; ontology and capability registries; policy engine; workflow runtime; persistence/migrations; APIs/events; observability; evaluation; deployment; and repository instructions. Produce repository-interaction, authority, trust-boundary, cause-ontology, attribution, temporal-data-flow, privacy/fairness, and requirement-traceability maps before implementation.

Reuse canonical entity resolution, ontology mapping, evidence, attribution, temporal, policy, ranking, budget, workflow, and graph services. Never invent prospects, identities, gifts, causes, affiliations, board service, beliefs, protected traits, relationships, contacts, provider endpoints, permissions, tests, or readiness.

Implement goal–observe–hypothesize–plan–select/delegate–discover–attribute–evaluate–replan–handoff/monitor/stop. A keyword search, social-profile classifier, political or religious profiler, similarity score, directory scraper, or one-shot prompt is not this agent.

## 2. Mission and accountable outcome

Discover individual and institutional prospects whose documented charitable giving, grantmaking, nonprofit governance, program leadership, volunteering, public commitments, or other policy-permitted activity demonstrates a plausible and temporally relevant connection to the tenant’s versioned mission, programs, populations, activities, outcomes, and geographies.

For the Benavora Domain Pack, example cause concepts include affordable housing, homelessness, recovery, reentry, workforce development, education, veterans, community development, and poverty reduction. These are examples, not hard-coded universal categories.

The accountable output is a precise, diverse, evidence-linked set of provisional candidates with actor attribution, activity/evidence class, cause ontology mappings, semantic distance, temporal strength, geography, counterevidence, alternative explanations, unknowns, privacy/policy basis, and exact downstream validation tasks.

Success is downstream-valid discovery—not candidate volume, keyword overlap, celebrity, political similarity, presumed personal experience, model confidence alone, or a claim that a person “cares about” a cause.

## 3. Reasoning boundary and non-goals

BEN-DIS-07 owns cause-aligned search hypotheses, source-mix adaptation, provisional prospect synthesis, activity classification, cause-concept mapping, preliminary alignment reasoning, contradiction and coverage analysis, ranking, replanning, and specialist handoff.

It does not:

- establish canonical person, household, company, foundation, nonprofit, donation, board, program, or cause identity;
- infer beliefs, motives, ideology, religion, medical history, disability, addiction/recovery status, criminal history, veteran status, race, ethnicity, sex, gender identity, sexual orientation, or any other sensitive/protected characteristic;
- infer a donor’s personal cause affinity from a spouse, relative, employer, corporate foundation, family foundation, employee fund, advised fund, board colleague, neighborhood, school, surname, social connection, or demographic proxy;
- treat a gift, grant, sponsorship, board role, volunteer activity, public statement, event attendance, petition, purchase, or political contribution as equivalent evidence;
- infer current alignment from stale or isolated activity without temporal qualification;
- convert recipient mission, grant purpose, campaign label, or model topic into donor intent beyond documented attribution;
- conclude capacity, propensity, eligibility, relationship strength, contactability, qualification, or willingness to support the tenant;
- scrape prohibited sources, fabricate contacts, bypass access controls, send outreach, or mutate CRM.

Entity resolution, giving-history verification, board and relationship intelligence, capacity/propensity analysis, qualification, critic review, engagement strategy, outreach, and CRM synchronization remain separate.

## 4. Durable goal and inputs

CauseAlignedDiscoveryGoal.v1 requires tenant/domain/goal/strategy ids and versions; decision enabled; tenant mission/program/outcome model; approved cause, population, activity, intervention, outcome, and geography concepts; inclusion/exclusion and negative causes; target prospect/entity classes; evidence tiers; attribution and semantic thresholds; temporal windows and decay rules; permitted source/data classes; diversity/coverage objectives; candidate/handoff limits; budgets; deadline; A2 ceiling; critic gates; monitoring triggers; and success, stop, pause, and escalation conditions.

Inputs include ResearchStrategy.v2; Prospect Digital Twin; tenant mission, programs, theory of change, populations, services, outcomes, geographies, exclusions, and known relationships; Domain Pack ontologies and mappings; known persons/organizations/foundations; donation, grant, board, program, affiliation, and award observations; source/capability registry; evidence/freshness/corroboration, privacy, fairness, and sensitive-trait policy; prior candidates and WorkFingerprints; provider health/economics; downstream corrections/outcomes; policy snapshot; and budget.

Reject cross-tenant input, invalid schema, stale policy or tenant twin, undefined cause semantics, missing negative/exclusion rules, prohibited data/source, unavailable mandatory evidence tier, missing purpose/stopping rules, contradictory strategy, or requested authority above A2.

## 5. Cause ontology and semantic governance

CauseConcept.v1 records ontology/version, canonical id and label, aliases, definition, broader/narrower/related concepts, populations, problems, interventions, activities, outcomes, geographies, exclusions, disputed mappings, Domain Pack provenance, and effective interval.

Cause dimensions remain distinct. A population is not a problem; a problem is not an intervention; an intervention is not an outcome. “Housing,” for example, may mean homelessness prevention, rental assistance, permanent supportive housing, shelter, affordable homeownership, housing construction, policy advocacy, or disaster recovery. Alignment in one dimension does not imply alignment in all dimensions.

CauseMappingHypothesis.v1 records source phrase, source context, candidate concepts, mapping type, semantic distance, hierarchy path, exact/broader/narrower/related/opposed status, exclusions, model/rule version, evidence, confidence, contradiction, and human-review requirement.

Ontology expansion is governed and versioned. Models may propose mappings but cannot silently create canonical causes, collapse contested terminology, or override tenant exclusions. Ambiguity above policy threshold sets NEEDS_CAUSE_MAPPING and blocks an alignment-ready result.

## 6. Actor and activity attribution

CauseActivityObservation.v1 requires provisional actor identity and actor class; action type; recipient/program/campaign; amount/range/currency where documented; role; source attribution language; cause/purpose phrase; geography; announcement/commitment/payment/service/effective interval; source group; locator and captured artifact hash; identity certainty; attribution certainty; privacy class; and limitations.

Actor classes distinguish PERSON, HOUSEHOLD, FOUNDATION, DONOR_ADVISED_VEHICLE, CORPORATION, CORPORATE_FOUNDATION, NONPROFIT, GOVERNMENT, COLLECTIVE, INTERMEDIARY, and UNKNOWN. Activity types distinguish personal gift, household gift, foundation grant, advised recommendation where disclosed, corporate contribution, sponsorship, board/trustee service, staff/program leadership, volunteering, pledge, campaign leadership, public statement, award, event participation, political activity, and other governed classes.

The named actor, economic source, legal donor, recommending party, announcing party, intermediary, recipient, beneficiary, and program owner remain separate. A surname, employer, family relationship, board role, or co-appearance cannot transfer activity from one actor to another.

Statuses such as ANNOUNCED, PLEDGED, COMMITTED, PAID, GRANTED, SERVED, PARTICIPATED, REPORTED_UNCLEAR, RESCINDED, and UNKNOWN retain their meanings. Announcement is not payment; board service is not giving; attendance is not support.

## 7. Evidence-class hierarchy and inference limits

CauseAlignmentEvidence.v1 assigns a governed class rather than a universal score:

- DIRECT_DOCUMENTED_SUPPORT: attributable completed/committed gift or grant with documented cause/purpose;
- REPEATED_DOCUMENTED_SUPPORT: multiple independently evidenced activities over a defined window;
- GOVERNANCE_OR_PROGRAM_SERVICE: verified board, trustee, leadership, or program role;
- VOLUNTEER_OR_CAMPAIGN_SERVICE: documented non-governance service;
- EXPLICIT_PUBLIC_COMMITMENT: attributable statement or pledge in context;
- INDIRECT_INSTITUTIONAL_ASSOCIATION: employer, foundation, or organization relationship without personal attribution;
- OBSERVED_PARTICIPATION: event, award, or activity with limited intent evidence;
- THEMATIC_DISCOVERY_HINT: keyword or semantic lead requiring primary evidence;
- COUNTEREVIDENCE, UNKNOWN, or PROHIBITED_INFERENCE.

Each class has policy-defined permissible downstream uses. Lower classes cannot be numerically inflated until they mimic direct support. Multiple copies of one announcement remain one source group. Search snippets, model memory, embeddings, social reactions, follows, and unsourced directories are discovery hints only.

Public statements are interpreted in full context, including speaker role, audience, quotation accuracy, date, negation, criticism, reporting versus endorsement, and later correction. The agent must search for disconfirming and alternative evidence before labeling alignment.

## 8. Giving, governance, and service semantics

GivingAlignmentObservation.v1 preserves donor/vehicle attribution, recipient, gift/grant status, amount if documented, restriction/purpose, fund designation, matching/pass-through status, anonymity limitations, effective interval, and evidence. General operating support to a multi-cause organization cannot automatically map to every recipient program.

GovernanceAlignmentObservation.v1 records exact legal organization and board type, fiduciary/advisory/honorary status, committee, role, service interval, cause mapping, and evidence. Nonprofit board service is relevant affiliation evidence, not proof of donation, motive, continuing alignment after departure, or willingness to fund another organization.

ServiceAlignmentObservation.v1 records volunteer, campaign, professional, program, or public-service activity; actor capacity; paid/unpaid/unknown status; recurrence; directness; beneficiaries; and evidence. Employment in an aligned sector may be professional activity rather than philanthropy and cannot become personal charitable propensity.

Political donations, lobbying, advocacy, religious participation, health-related activity, recovery/reentry involvement, and veteran-related activity require heightened policy review because they may expose or invite sensitive inferences. They are not used for personalized targeting unless expressly lawful, purpose-limited, and approved; protected or sensitive status is never inferred.

## 9. Temporal alignment and behavioral patterns

CauseEngagementPattern.v1 records actor, included observations, independent source groups, time window, recency, cadence, continuity, breadth/depth, activity classes, cause dimensions, geographic scope, new/repeat recipients, role changes, source gaps, counterevidence, and confidence.

Temporal rules distinguish one-time emergency response, recurring support, multi-year commitment, former board service, current leadership, and stale historical activity. Decay is evidence-class and cause-specific, versioned, calibrated, and never deletes history.

Cause transition, program sunset, leadership departure, corrected attribution, and changed tenant mission create successor assessments. A past activity may remain historically relevant while current alignment is UNKNOWN.

Repeated behavior may strengthen evidence of a pattern but does not prove motive, future giving, capacity, or tenant-specific interest. Candidate output includes an “as of” time and the evidence window used.

## 10. Alignment assessment contract

CauseAlignmentAssessment.v1 compares tenant concepts to observation concepts dimension by dimension and returns SUPPORTED_DIRECT, SUPPORTED_RELATED, PARTIAL, OPPOSED_OR_EXCLUDED, UNKNOWN, CONFLICTING, or NOT_APPLICABLE.

It requires actor and activity; tenant and source ontology versions; mapped population/problem/intervention/outcome/geography; semantic paths; evidence classes; temporal weight with explanation; positive and negative evidence; alternative explanations; source independence; confidence interval; and unresolved facts.

Exact concept matches do not override actor attribution, evidence-class, time, geography, exclusion, or policy. Broader/narrower relationships state direction. Related concepts never become exact matches. PARTIAL identifies matching and nonmatching dimensions. UNKNOWN never becomes support.

An aggregate cause-alignment view is an explainable synthesis of dimension-level assessments, not a personality label, hidden psychographic profile, donation probability, or permanent person attribute.

## 11. Candidate output contract

CauseAlignedProspectCandidate.v1 requires:

- candidate/version and tenant/domain/run/plan/hypothesis lineage;
- provisional prospect identity, actor class, alternatives, and collision risk;
- attributable activity observations by evidence class and temporal status;
- cause mappings across population, problem, intervention, activity, outcome, and geography;
- direct, related, partial, excluded, unknown, and conflicting assessments kept separate;
- giving, governance, service, statement, participation, and institutional-association evidence kept separate;
- negative evidence, alternative explanations, counterfactual tests, limitations, and UNKNOWN values;
- evidence refs, independent source groups, artifact hashes, freshness, and temporal intervals;
- privacy/sensitive-trait/fairness policy results, source/use restrictions, exclusions, and minimization;
- exact-duplicate and WorkFingerprint checks; ranking factors, confidence interval, sensitivity, calibration, and coverage effects;
- exact specialist/critic tasks; authority, budget, tools/models, timestamps, hashes, and prohibited claims.

Statuses are PROVISIONAL, NEEDS_ENTITY_RESOLUTION, NEEDS_ATTRIBUTION_VALIDATION, NEEDS_CAUSE_MAPPING, NEEDS_GIVING_VALIDATION, NEEDS_GOVERNANCE_VALIDATION, NEEDS_TEMPORAL_RESEARCH, NEEDS_POLICY_REVIEW, READY_FOR_SPECIALIST_HANDOFF, SUPPRESSED_DUPLICATE, EXCLUDED_POLICY, REJECTED_CAUSE_MISMATCH, or MONITOR.

No status implies canonical affinity, capacity, propensity, relationship, contactability, qualification, willingness, or solicitation permission.

## 12. Hypothesis and source planning

CauseAlignedDiscoveryHypothesis.v1 contains target prospect/entity segment; activity and evidence class; predicted cause dimensions; rationale; permitted source classes and independent groups; predicted supporting and disconfirming evidence; attribution/entity/ontology risks; privacy/fairness risk; expected value/cost; confidence; and status.

Maintain materially distinct hypotheses such as repeat donors, foundation grantmakers, nonprofit directors/trustees, aligned program leaders, documented volunteers/campaign leaders, public commitment makers, and institutional affiliations requiring personal-attribution validation. Do not produce cosmetic keyword variants or target people based on sensitive experiences.

CauseAlignedSourcePlan.v1 maps hypotheses to registered capabilities, official foundation/nonprofit/corporate materials, public filings, grant and donation records, annual/impact reports, board rosters, recipient acknowledgements, program biographies, licensed sources, query concepts, expected artifacts, quotas, parallelism, rate limits, budgets, fallbacks, and stop conditions.

Filings establish only their reported actor, period, and fact. Recipient acknowledgements may corroborate an activity but not canonical identity or donor intent. Biographies establish stated roles in context. Aggregators and search results are discovery aids. Consequential claims require captured evidence and applicable temporal scope.

## 13. Deterministic gates and ranking

Hard gates reject cross-tenant references, prohibited source/data/use, failed evidence integrity, exact duplicate work, unresolved actor collision above threshold, prohibited sensitive inference, known tenant exclusion, fabricated activity or contact, absent required attributable evidence, and proven cause mismatch.

Ranking factors are policy-versioned: attributable evidence strength, cause-dimension relevance, temporal currency/continuity, source quality/independence, geography where relevant, novelty, coverage contribution, information gain, and downstream utility. Penalties cover actor ambiguity, institutional-to-person leakage, stale/isolated activity, weak evidence class, broad semantic mapping, counterevidence, source concentration, critical UNKNOWN, contradiction, overrepresented cause/prospect/source segments, and follow-up cost.

Political/religious views, medical/recovery/reentry/veteran status, protected traits, names, demographic proxies, inferred personal experience, and psychographic labels are prohibited ranking features. Missing values remain missing. Ranking cannot override gates or represent likelihood to donate.

Every factor records provenance, rule/model version, confidence, freshness, and sensitivity. Run coverage and concentration diagnostics across cause dimensions, prospect/entity classes, evidence classes, geographies, and sources. BEN-SUP-05 blocks downstream release for unsupported attribution, ontology mapping, sensitive inference, or overclaimed alignment.

## 14. Durable state and agentic loop

States: CREATED, VALIDATING, OBSERVING, HYPOTHESIZING, PLANNING, RESERVING, DISCOVERING_PROSPECTS, DISCOVERING_ACTIVITIES, RESOLVING_PROVISIONAL_ENTITIES, ATTRIBUTING_ACTIVITIES, MAPPING_CAUSES, ANALYZING_TEMPORAL_PATTERNS, ASSESSING_ALIGNMENT, EVIDENCE_LINKING, EVALUATING, REPLANNING, HANDING_OFF, MONITORING, and terminal SATISFIED, EXHAUSTED, PAUSED, BLOCKED_POLICY, BLOCKED_HUMAN, CANCELLED, FAILED_RECOVERABLE, FAILED_TERMINAL, SUPERSEDED.

Transitions persist expected version, fencing token, reason, actor, attempt, input/output hashes, policy/authority, budget delta, timestamp, and audit anchor. Aggregate and outbox commit atomically; terminal changes create successors.

Loop: bind goal and tenant cause model; observe existing prospect/activity coverage, exclusions, source health, ontology gaps, and corrections; form alternative prospect/activity hypotheses; plan independent, primary, and disconfirming sources; select registered tools/delegates; capture evidence; synthesize provisional entities and attribute activities; map cause dimensions; evaluate evidence class, actor attribution, semantic path, temporal relevance, counterevidence, privacy/fairness, diversity/coverage, cost, and downstream value; materially replan; then hand off, monitor, stop, pause, or escalate.

Bound iterations, fan-out, delegation depth 3, candidates, observations, mappings, sources, calls, bytes, time, spend, and sensitive-data exposure. Repeated state/plan/evidence signatures and low marginal information gain trigger safe termination.

## 15. Replanning, delegation, monitoring, and economics

Replan on identity collision, attribution conflict, cause ambiguity, ontology change, stale or corrected gift/role, institutional-versus-person conflict, counterevidence, sensitive-data risk, critic rejection, provider outage, source poisoning, downstream correction, policy/budget/deadline change, or tenant mission/program change.

Adapt prospect segments, evidence classes, cause dimensions, ontology paths, source mix, temporal window, breadth/depth, order, quota, and verification tasks. Stop a branch when actor attribution fails, only prohibited inference could establish alignment, tenant exclusion is proven, required evidence remains absent after bounded effort, sources saturate, or marginal value falls below cost/risk.

DelegatedCauseDiscoveryTask.v1 specifies exact objective, subject/activity alternatives, ontology version, input claims, output schema, authority/source/tool/privacy bounds, budget, deadline, evidence/freshness, depth at most 3, success/stop/escalation, and parent lineage. Delegates cannot infer sensitive traits, widen sources, canonicalize identities, or conclude affinity/propensity. Handoffs include BEN-KNW-02 entity resolution, BEN-KNW-03 evidence verification, giving/board/relationship intelligence, qualification, and BEN-SUP-05 criticism.

Monitoring reopens on new/corrected donation or grant, board appointment/departure, program/service change, public pledge/correction, foundation or corporate-control change, ontology revision, tenant mission/program change, or policy update. Reopening creates a successor.

Budgets cover currency, tokens, model/tool calls, licensed-provider quota, storage, elapsed time, fan-out, candidates, activities, mappings, artifacts, and operator review. Reserve, reconcile, and release verified unused capacity. Continue only while expected valid-candidate yield, uncertainty reduction, coverage, or decision value exceeds marginal cost, privacy exposure, and operational risk.

## 16. Persistence, interfaces, recovery, and security

Persist goals, observations, hypotheses, source plans, provisional entities, activities, attributions, ontology mappings, patterns, assessments, candidates, evidence, contradictions, fingerprints, rankings, coverage/fairness diagnostics, decisions, delegations, handoffs, monitoring, budgets, transitions, human actions, events, and audit.

Require tenant keys/constraints, append-only history, encrypted sensitive fields, purpose/retention/source-use metadata, exact versions, optimistic concurrency/fencing, transactional outbox, idempotency ledger, RLS/equivalent negative tests, and forward/rollback/mixed-version migrations.

Commands support submit, pause, resume, cancel, supersede, handoff, monitor, disposition, and replay-safe recovery. Queries expose entity alternatives, activities/attribution, mappings, alignment/counterevidence/gaps, evidence classes, ranking sensitivity, privacy/policy, coverage, budgets, decisions, and audit. Events cover accepted, hypothesis/plan revision, activity observed, attribution or mapping conflict, candidate discovered/suppressed/handed off, critic/policy/budget/provider state, monitoring, and termination.

Recovery resumes verified state, reconciles delivery/budgets, obtains fresh fencing, preserves artifacts, and quarantines integrity or cross-tenant failures. Unknown external effects invoke BEN-SUP-06.

Threats include prompt/source poisoning, fabricated gifts/boards/statements, entity and actor misattribution, sensitive-trait inference, political/religious or health profiling, guilt by association, stale-cause laundering, psychographic targeting, IDOR, cross-tenant cache/graph/vector/queue/object leakage, forged evidence, licensing breach, duplicate delivery, denial-of-wallet, secrets, replay, and evaluator gaming.

Controls include workload identity, least privilege, per-access tenant authorization, structured adapters, instruction/data separation, hashes/provenance, source/use allowlists, field-level classification, minimization, purpose limitation, retention/deletion, encryption, egress/rate/budget controls, telemetry redaction, kill switch, signed commands, audit anchors, dependency pinning/SBOM, and alerts. Public availability never implies permitted collection, profiling, or targeting.

## 17. Memory, observability, evaluation, and tests

Tenant-scoped memory stores strategies, source yields, ontology mapping proposals, corrections, and outcomes, never unverified person truth, sensitive profiles, or reusable psychographics. Learning proposals require versioned offline evaluation, ontology/privacy/fairness/security review, canary, monitoring, and rollback. Online authority, policy, gate, sensitive-feature, or canonical-ontology changes are prohibited.

Metrics include valid-candidate precision, entity/actor attribution error, activity-class confusion, institutional-to-person leakage, cause-mapping error, semantic overreach, temporal error, sensitive-inference incidents, evidence independence/freshness, UNKNOWN preservation, cause/prospect/source concentration, critic overturn, downstream acceptance/correction, calibration, cost, latency, replans, stops, retries, and isolation attempts.

Gold cases include personal versus corporate gift; family foundation versus namesake; spouse/household gift; donor-advised disclosure limits; unrestricted gift to multi-cause nonprofit; restricted program gift; repeat versus emergency gift; current versus former board service; fiduciary versus honorary board; paid employment versus volunteering; event attendance; public quotation reporting versus endorsement; political contribution; recovery/reentry/veteran cause without status inference; broad “housing” mismatch; related versus exact intervention; negative cause exclusion; anonymous donor; pass-through intermediary; stale activity; corrected attribution; common-name actor; cross-tenant poison; and prompt injection.

Separate tuning, calibration, development, regression, and final-certification datasets. Measure precision/recall where observable, attribution/activity/mapping accuracy, semantic and temporal calibration, evidence sufficiency/independence, abstention, sensitive-inference false positives, coverage/concentration, downstream acceptance/rejection, critic overturn, cost, and time.

Unit/property tests prove entity/activity separation, actor attribution, evidence-class non-equivalence, ontology directionality, UNKNOWN preservation, no institutional-to-person leakage, no protected/sensitive inference, ranking feature prohibition, non-widening authority, budget conservation, stable fingerprints, bounded loop/delegation, temporal semantics, and immutable lineage.

Contract/integration tests cover schemas, filing/foundation/nonprofit/board/donation/licensed adapters, ontology and evidence grouping, entity/specialist handoffs, policy/ranking services, migrations, outbox/idempotency, cancellation, monitoring, restart/concurrency, duplicate/reordered events, deletion/retention, and tenant isolation.

End-to-end, adversarial, load, soak, chaos, and disaster-recovery tests exercise every gold case plus forged gifts/quotes/boards, malicious pages, euphemistic sensitive proxies, embedding leakage, IDOR, prompt injection, worker death at every state, provider/model/database/broker outage, rate shock, outbox backlog, regional failover, backup restore, kill switch, secret/personal-data leakage, and evaluator manipulation.

## 18. Deployment, acceptance, and final report

Version schemas, prompts, models, tools, adapters, cause ontology/mappings, activity/evidence classes, attribution/temporal rules, privacy/fairness policy, ranking, and flags. Roll out through offline evaluation, shadow discovery, tenant and cause canaries, limited evidence/source classes, monitored expansion, then GA only after gates. Rollback preserves entity/activity/mapping/evidence/candidate/audit lineage and in-flight compatibility.

ADRs cover cause ontology, actor/activity attribution, evidence hierarchy, giving/governance/service semantics, temporal alignment, sensitive-trait limits, privacy/fairness, sources, matching/ranking, persistence/workflow, tenancy, economics, monitoring, and learning. Runbooks cover wrong actor, false gift/board attribution, cause-mapping error, institutional-to-person leakage, sensitive inference, fake statement/activity, source outage, privacy request, tenant incident, cost anomaly, stuck run, outbox backlog, kill switch, rollback, and disaster recovery.

G0–G5 require repository discovery; constitutional conformance; machine contracts; deterministic entity, attribution, ontology, temporal, evidence, policy, ranking, economic, concurrency, and privacy foundations; executed multi-cycle hypothesis, source selection, evaluation, replanning, handoff, and monitoring; and security, isolation, privacy/fairness, calibration, load, soak, chaos, recovery, observability, rollback, documentation, and independent evaluation.

Return traceability; repository maps; code/migrations/interfaces/workflows/events; adapter/evidence/ontology integration; executed tests/evaluations; multi-cycle traces; actor, activity, evidence-class, mapping, temporal, counterevidence, and sensitive-inference proofs; ranking sensitivity and coverage/fairness analysis; security/privacy/tenant evidence; calibration/errors; performance/cost/recovery; residual risks/skips/failures/waivers/owners/expiry; and governed G0–G5 verdict.

This specification itself proves no implementation. A score of 95–100 or production-ready verdict may be reported only from attached executed evidence with every blocking gate passed.
