# BEN-DIS-06 — Geographic Funding Discovery Agent

**Specification ID:** PIL-AGENT-BEN-DIS-06  
**Version:** 1.0.0  
**Family:** Discovery  
**Default autonomy:** A2 — prepare and queue  
**Maximum delegation depth:** 3  
**Cadence:** On-demand, event-driven, and governed monitoring  
**Boundary:** Produces provisional geographically relevant funder and opportunity candidates with spatial-temporal evidence and unresolved constraints; never canonical eligibility, award probability, application authority, or CRM state  
**Status:** Final specification pending implementation evidence

## 1. Chain-It implementation directive

Implement BEN-DIS-06 as a durable, goal-owning discovery agent inheriting Discovery Agent Shared Contract v2.0.0. Inspect the constitution; agent and deterministic-service registries; ResearchStrategy.v2; Prospect Digital Twin; tenant/domain twin; organization, opportunity, place, jurisdiction, evidence, and policy contracts; capability/source registry; workflow runtime; persistence/migrations; APIs/events; observability; evaluations; deployment; and repository instructions. Produce repository-interaction, authority, trust-boundary, geographic-ontology, coordinate-reference, spatial-temporal-data-flow, and requirement-traceability maps before implementation.

Reuse canonical geocoding, boundary, spatial-relation, temporal, entity-resolution, evidence, policy, ranking, budget, and workflow services. Never invent funders, programs, jurisdictions, boundaries, coordinates, addresses, service areas, award locations, eligibility, deadlines, contacts, provider endpoints, permissions, tests, or readiness.

Implement goal–observe–hypothesize–plan–select/delegate–discover–spatially attribute–evaluate–replan–handoff/monitor/stop. A ZIP-code filter, radius search, geocoder wrapper, grant-directory query, or one-shot prompt is not this agent.

## 2. Mission and accountable outcome

Discover public, private, community, corporate, and other permitted funding sources whose documented geographic mandate, eligible applicant location, eligible project or beneficiary location, operating footprint, place-based priorities, or observed award geography plausibly intersects the tenant’s versioned geographic strategy.

The accountable output is a precise, diverse, evidence-linked set of provisional candidates with funder/program identity, geography-type semantics, spatial relationships, applicable boundary versions, temporal validity, formal eligibility, observed-award geography, decision geography, contradictions, unknowns, coverage gaps, and exact downstream verification tasks.

Success is downstream-valid geographic discovery—not proximity, shared city names, headquarters distance, polygon overlap alone, raw candidate count, or an unsupported conclusion that a funder “serves” an area.

## 3. Reasoning boundary and non-goals

BEN-DIS-06 owns geographic search hypotheses, source-mix adaptation, preliminary funder/program synthesis, place and jurisdiction interpretation, boundary-aware matching, formal-versus-observed geography comparison, coverage and geographic-bias analysis, ranking, replanning, and specialist handoff.

It does not:

- establish canonical funder, program, applicant, facility, project, place, address, parcel, jurisdiction, or boundary identity;
- treat funder headquarters, mailing address, branch, service footprint, decision office, recipient location, project location, or eligible geography as interchangeable;
- infer eligibility from proximity, a shared state, a local award, an office, a map marker, or the absence of exclusions;
- infer service area from a point-radius calculation when rules name jurisdictions, corridors, watersheds, tribal lands, districts, neighborhoods, or custom polygons;
- convert an observed award location into a formal geographic rule;
- silently geocode a PO box, headquarters, centroid, imprecise locality, or historical address as the operative project location;
- guess boundaries, normalize ambiguous place names without alternatives, or use present boundaries for historical facts without policy;
- certify eligibility, funding probability, application openness, decision-maker identity, or contactability;
- submit applications, create accounts, accept terms, evade controls, or mutate CRM.

Entity/place resolution, authoritative eligibility determination, program verification, relationship mapping, qualification, critic review, application operations, and CRM synchronization remain separate.

## 4. Durable goal and inputs

GeographicFundingDiscoveryGoal.v1 requires tenant/domain/goal/strategy ids and versions; decision enabled; tenant legal/program profile; applicant, project, beneficiary, service, facility, relationship, and decision geographies; geographic ontology and precision; inclusion/exclusion; permitted funder/program types; evidence tiers; boundary and freshness requirements; award-history window; source groups; candidate/handoff/coverage/diversity limits; budgets; deadline; A2 ceiling; critic gates; monitoring triggers; and success, stop, pause, and escalation conditions.

Inputs include ResearchStrategy.v2; Prospect Digital Twin; tenant addresses, verified facilities, service areas, proposed project sites, populations and place relationships; Domain Pack geographic ontology; canonical place and boundary datasets; source/capability registry; evidence/freshness/corroboration policy; known funders, programs, awards, and exclusions; provider health/economics; prior candidates and WorkFingerprints; downstream corrections/outcomes; policy snapshot; and budget.

Reject cross-tenant input, invalid schema, stale policy or tenant twin, unresolvable required geography, missing coordinate reference or boundary version when material, prohibited source/data, unavailable mandatory evidence tier, contradictory geographic strategy, absent stopping rules, or requested authority above A2.

## 5. Geographic ontology and place identity

PlaceHypothesis.v1 records provisional place id, names and aliases, place type, governing jurisdiction, parent/child geography, official codes where permitted, geometry reference, coordinate-reference system, precision, source, valid interval, disputed or overlapping status, candidates, confidence, and unresolved discriminators.

Place types include country, state/province/territory, county/parish/borough, municipality, census place, postal geography, neighborhood, legislative or administrative district, tribal nation/land, reservation, rural designation, metropolitan/micropolitan area, region, watershed, corridor, service district, school/health district, facility, address, parcel, point, radius, and custom governed polygon.

Names are not identifiers. Georgetown, Washington, Springfield, regional labels, abbreviations, renamed jurisdictions, annexed territory, and overlapping postal/local-government geographies require explicit candidates. Postal codes are routing constructs, not universal administrative or service boundaries. Centroids are representations, not proof that a site lies within a program area.

Place canonicalization is delegated to deterministic services and BEN-KNW-02. Unresolved ambiguity above threshold sets NEEDS_PLACE_RESOLUTION and blocks consequential matching.

## 6. Geography-role separation

GeographicClaim.v1 requires subject, program/funder/entity, geography role, place/boundary hypothesis, inclusion/exclusion, source language, spatial relation, precision, observed/published/effective intervals, evidence, confidence, contradiction, and UNKNOWN handling.

Geography roles are independently modeled:

- FUNDER_HEADQUARTERS and FUNDER_OPERATING_FOOTPRINT;
- PROGRAM_ADMINISTRATION and DECISION_AUTHORITY;
- ELIGIBLE_APPLICANT_LOCATION and REQUIRED_REGISTRATION/JURISDICTION;
- ELIGIBLE_PROJECT_LOCATION and ELIGIBLE_BENEFICIARY/IMPACT_LOCATION;
- TENANT_LEGAL_ADDRESS, FACILITY, SERVICE_AREA, and PROPOSED_PROJECT_SITE;
- OBSERVED_RECIPIENT_ADDRESS, OBSERVED_PROJECT_LOCATION, and REPORTED_AWARD_GEOGRAPHY;
- RELATIONSHIP, PRIORITY, EXCLUSION, MATCHING-FUNDS, DISASTER, and INVITATION geographies.

No geography role substitutes for another. A tenant may be incorporated in one state, headquartered in another, serve several counties, and propose work in a third geography. A funder may be headquartered nationally, decide regionally, restrict applicants locally, and fund projects in a custom service area.

## 7. Boundaries, topology, precision, and temporal validity

BoundaryReference.v1 records provider/dataset, feature id, boundary type, version/release, effective interval, coordinate-reference system, geometry checksum, precision/resolution, simplification, topology validity, lineage, license/use restrictions, and retrieval time.

SpatialRelationAssessment.v1 returns WITHIN, CONTAINS, INTERSECTS, TOUCHES, OVERLAPS, NEAR, DISJOINT, UNKNOWN, or CONFLICTING with operand roles, geometry/boundary versions, method, tolerances, edge-case policy, distance units and method where relevant, evidence, confidence, and limitations.

Distance never substitutes for a named boundary. “Within 50 miles” records whether distance is geodesic, routed, or another expressly defined method and what feature points or geometries were used. Border points, enclaves, islands, multi-polygons, invalid geometry, coordinate-order errors, antimeridian cases, and low-precision geocodes fail closed or escalate under policy.

Historical awards use boundaries and addresses applicable to their observed/effective time where materially possible. Annexation, redistricting, renamed jurisdictions, boundary releases, facility moves, and disaster declarations create versioned successor assessments rather than overwrites.

## 8. Formal eligibility and priority geography

GeographicEligibilityHypothesis.v1 separates FORMAL_RULE, PRIORITY_PREFERENCE, EXCLUSION, OBSERVED_PATTERN, TENANT_MATCH_HYPOTHESIS, and UNRESOLVED_REQUIREMENT.

Each rule records applicable program and cycle; geography role; included/excluded places or spatial predicates; “based in,” “serving,” “operating in,” “registered in,” “located in,” and similar term definitions if provided; applicant/project/beneficiary distinctions; rural/urban or special designation; exceptions; evidence; effective interval; confidence; contradiction; and missing decisive inputs.

Priority geography is not eligibility. “Preference,” “focus,” “primarily,” “special consideration,” and “historically funds” cannot become a hard rule. Conversely, explicit exclusions and applicant-location conditions cannot be weakened by observed exceptions without authoritative evidence.

GeographicMatchAssessment.v1 compares exact versioned tenant and program fields and returns MATCH, PARTIAL_MATCH, MISMATCH, UNKNOWN, NOT_APPLICABLE, or CONFLICTING per rule. PARTIAL_MATCH states which portion matches and cannot be promoted to overall eligibility. UNKNOWN never becomes MATCH.

## 9. Observed award geography

GeographicAwardObservation.v1 requires funder/program hypothesis, recipient hypothesis, award status, amount/range/currency if documented, recipient-address geography, project/service/beneficiary geography when independently stated, intermediaries, purpose, authorization/payment period, source group, locator/artifact hash, identity certainty, geographic precision, and limitations.

Recipient headquarters is not automatically the funded project location or beneficiary geography. Statewide organizations may execute a local project; local fiscal sponsors may administer regional work; national intermediaries may pass funds downstream. Preserve every actor and geography role.

GeographicFundingPattern.v1 records the observation set, time window, included years, coverage, amount/count distributions, program/cycle, geography roles, place types, concentration, recurring versus exceptional areas, new/repeat recipients, border behavior, missing periods, source independence, and confidence.

Observed patterns inform hypotheses and ranking but do not create formal eligibility or funding probability. A single award, press release, aggregate report, map visualization, or geocoded recipient list cannot establish a service area.

## 10. Geocoding and address controls

GeocodeObservation.v1 records submitted address or place string, normalized components, candidate results, provider/dataset, match type, feature type, coordinates, coordinate-reference system, precision, confidence, bounding feature, provider terms, retrieval time, and contradiction.

ROOFTOP, PARCEL, STREET, INTERPOLATED, POSTAL, LOCALITY, ADMINISTRATIVE_AREA, and CENTROID precision are distinct. PO boxes, virtual offices, mailing addresses, headquarters, service addresses, and project sites retain their original role. Low-precision results cannot satisfy high-precision rules.

Addresses are temporal evidence. Moves, suite changes, postal normalization, rural routes, campus addresses, and newly assigned addresses require effective intervals. Do not expose or infer private residential locations; use only permitted, purpose-limited data and minimum necessary precision.

## 11. Candidate output contract

GeographicFundingCandidate.v1 requires:

- candidate/version and tenant/domain/run/plan/hypothesis lineage;
- provisional funder/program/entity identity and program status;
- every geography claim by explicit role;
- place alternatives, official identifiers, boundary versions, coordinate systems, and precision;
- spatial-relation and distance assessments with methods and tolerances;
- formal eligibility, priority, exclusion, observed award pattern, and tenant match kept separate;
- applicant, project, beneficiary, service-area, facility, decision, and relationship geography comparisons;
- evidence refs, independent source groups, temporal validity, contradictions, limitations, and UNKNOWN values;
- policy, license/use constraints, exclusions, duplicate and WorkFingerprint checks;
- ranking factors, confidence interval, sensitivity, calibration version, and coverage effects;
- exact specialist/critic tasks; authority, budget, models/tools, timestamps, hashes, and prohibited claims.

Statuses are PROVISIONAL, NEEDS_ENTITY_RESOLUTION, NEEDS_PLACE_RESOLUTION, NEEDS_BOUNDARY_VERIFICATION, NEEDS_PROGRAM_VALIDATION, NEEDS_ELIGIBILITY_VERIFICATION, NEEDS_PROJECT_LOCATION, READY_FOR_SPECIALIST_HANDOFF, SUPPRESSED_DUPLICATE, EXCLUDED_POLICY, PROGRAM_INACTIVE, REJECTED_GEOGRAPHIC_MISMATCH, or MONITOR.

No status implies full eligibility, competitiveness, award likelihood, relationship, contactability, or application permission.

## 12. Hypothesis and source planning

GeographicFundingHypothesis.v1 contains target funder/program segment, geography roles and spatial predicates, rationale, predicted formal and observed evidence, source classes and independent groups, disconfirming conditions, entity/place/boundary risks, bias/privacy/licensing risk, expected value/cost, confidence, and status.

Maintain materially distinct hypotheses such as jurisdiction-limited programs, place-based foundations, community-foundation funds, corporate operating-footprint programs, rural or distressed-area initiatives, neighborhood/corridor programs, tribal funding, disaster declarations, watershed/environmental programs, observed-local-award patterns, and relationship-defined local funds. Do not create cosmetic place-name or radius variants.

GeographicSourcePlan.v1 maps hypotheses to registered capabilities, official program guidance, funder materials, statutes/regulations, government boundary datasets, disaster/designation sources, filings, award databases, recipient reports, licensed data, query concepts, expected artifacts, quotas, parallelism, rate limits, budgets, fallbacks, and stops.

Official program rules establish stated conditions for their applicable cycle. Boundary providers establish geometry only within documented scope/version. Recipient and award sources establish reported observations, not program rules. Maps require underlying data, legend, date, and spatial semantics. Search snippets and model memory cannot satisfy consequential evidence.

## 13. Deterministic gates and ranking

Hard gates reject cross-tenant references, prohibited data/source/license, failed evidence integrity, exact duplicate work, inactive program where current opportunity is required, known geographic exclusion, proven mismatch on a mandatory geography role, insufficient precision, unresolved place/boundary ambiguity above threshold, fabricated location, or absent required formal evidence.

Ranking factors are policy-versioned: verified geographic match by role, program and mission alignment, priority geography, relevant observed-award pattern, evidence quality/independence/freshness, program currency, novelty, coverage value, information gain, and downstream utility. Penalties cover place ambiguity, stale boundaries/rules, precision mismatch, formal-versus-observed conflict, applicant/project/beneficiary conflation, headquarters bias, source concentration, critical UNKNOWN, contradiction, geographic overconcentration, and follow-up cost.

Population, income, rurality, deprivation, disaster, or demographic features may be used only when directly relevant, lawful, versioned, and policy-approved; they may not infer protected traits of people. Missing values remain missing. Ranking cannot override gates or represent award probability.

Every factor records provenance, rule/model version, confidence, freshness, and sensitivity. Run coverage and concentration diagnostics across place types and target regions so dense-data urban areas do not silently crowd out rural, tribal, frontier, or low-data geographies.

## 14. Durable state and agentic loop

States: CREATED, VALIDATING, OBSERVING, HYPOTHESIZING, PLANNING, RESERVING, DISCOVERING_FUNDERS, DISCOVERING_PROGRAMS, RESOLVING_PLACES, RESOLVING_BOUNDARIES, ASSESSING_FORMAL_GEOGRAPHY, ANALYZING_AWARDS, MATCHING_TENANT_GEOGRAPHY, EVIDENCE_LINKING, EVALUATING, REPLANNING, HANDING_OFF, MONITORING, and terminal SATISFIED, EXHAUSTED, PAUSED, BLOCKED_POLICY, BLOCKED_HUMAN, CANCELLED, FAILED_RECOVERABLE, FAILED_TERMINAL, SUPERSEDED.

Transitions persist expected version, fencing token, reason, actor, attempt, input/output hashes, policy/authority, budget delta, timestamp, and audit anchor. Aggregate/outbox commits atomically; terminal changes create successors.

Loop: bind goal and tenant geographies; observe existing coverage, funders/programs, rules, awards, place/boundary state, source health, and gaps; form alternative geographic hypotheses; plan authoritative, independent, and disconfirming evidence; select registered tools/delegates; capture sources and resolve provisional spatial semantics; compare formal, priority, observed, and tenant geographies; evaluate entity/place integrity, topology, precision, temporal validity, contradictions, coverage, geographic bias, cost, and downstream value; materially replan; then hand off, monitor, stop, pause, or escalate.

Bound iterations, fan-out, delegation depth 3, candidates, places, boundaries, awards, calls, bytes, time, spend, and spatial operations. Repeated state/plan/evidence signatures or low marginal information gain trigger safe termination.

## 15. Replanning, delegation, monitoring, and economics

Replan on ambiguous or renamed places; incompatible boundary versions; invalid topology; geocoder disagreement; tenant facility/project change; annexation/redistricting; new disaster/designation; funder/program scope change; formal-versus-observed conflict; recipient/project-location confusion; critic rejection; provider degradation; policy/budget/deadline change; or downstream correction.

Adapt place resolution, geographic role, hypothesis, source mix, temporal window, breadth/depth, spatial predicate, precision, order, quota, and specialist task. Stop a branch when mandatory geographic mismatch is proven, required precision cannot be lawfully obtained, place/boundary identity remains unresolved within budget, only prohibited data can resolve it, sources saturate, or marginal value falls below cost/risk.

DelegatedGeographicDiscoveryTask.v1 specifies exact objective, input place/boundary candidates, output schema, authority/source/tool/license/privacy bounds, budget, deadline, evidence/freshness/precision, depth at most 3, success/stop/escalation, and parent lineage. Delegates cannot expand geography roles, sources, or authority. Handoffs include entity/place resolution, program validation, eligibility verification, award validation, relationship mapping, qualification, and BEN-SUP-05 criticism.

Monitoring reopens on program-rule/cycle change, boundary or designation release, disaster declaration/expiration, award publication/correction, funder relocation, program administration change, tenant facility/service/project change, or source correction. Reopening creates a successor.

Budgets cover currency, tokens, model/tool calls, geocoder/GIS/provider quota, storage, elapsed time, fan-out, candidates, places, geometry operations, award observations, and operator effort. Reserve, reconcile, and release verified unused capacity. Continue only while expected valid-candidate yield, coverage, uncertainty reduction, or decision value exceeds marginal cost, licensing/privacy exposure, and operational risk.

## 16. Persistence, interfaces, recovery, and security

Persist goals, observations, hypotheses, source plans, place/boundary references, geographic claims and roles, geocodes, spatial relations, rules, awards/patterns, match assessments, candidates, evidence, contradictions, fingerprints, rankings, coverage diagnostics, decisions, delegations, handoffs, monitoring, budgets, transitions, human actions, events, and audit.

Require tenant keys/constraints, append-only history, geometry integrity and indexes, encrypted sensitive fields, purpose/retention/license metadata, exact versions, optimistic concurrency/fencing, transactional outbox, idempotency ledger, RLS/equivalent negative tests, and forward/rollback/mixed-version migrations.

Commands support submit, pause, resume, cancel, supersede, handoff, monitor, disposition, and replay-safe recovery. Queries expose geography roles, place alternatives, boundaries, spatial assessments, eligibility/priority/exclusion, awards, candidates/gaps, ranking sensitivity, coverage, budgets, decisions, and audit. Events cover accepted, plan revision, place/boundary/rule/award observed, spatial or temporal conflict, candidate discovered/suppressed/handed off, critic/policy/budget/provider state, monitoring, and termination.

Recovery resumes verified state, reconciles delivery and budgets, obtains fresh fencing, preserves artifacts and geometry versions, and quarantines integrity or cross-tenant failures. Unknown external effects invoke BEN-SUP-06.

Threats include prompt/source poisoning, fake programs/maps, malicious geometry, coordinate-order/CRS manipulation, stale-boundary laundering, address precision escalation, location re-identification, protected-trait proxying, IDOR, cross-tenant cache/graph/vector/queue/object leakage, forged evidence, licensing breach, duplicate delivery, denial-of-wallet, secrets, replay, and evaluator gaming.

Controls include workload identity, least privilege, per-access tenant authorization, structured adapters, instruction/data separation, geometry validation, CRS allowlists, hashes/provenance, source/license allowlists, minimization and precision reduction, encryption, egress/rate/budget limits, telemetry redaction, retention/deletion, kill switch, signed commands, audit anchors, dependency pinning/SBOM, and alerts.

## 17. Memory, observability, evaluation, and tests

Tenant-scoped memory stores plans, geographic coverage, source performance, corrections, and outcomes, never unverified canonical geography. Learning proposals require versioned offline evaluation, geographic-bias/security/privacy review, canary, monitoring, and rollback. Online authority, policy, identity, boundary, or gate changes are prohibited.

Metrics include valid geographic-candidate precision, place/entity resolution error, geography-role conflation, boundary/CRS/topology error, geocode precision error, applicant/project/beneficiary mismatch, formal-versus-observed leakage, eligibility false positives, freshness, evidence independence, UNKNOWN handling, urban/rural/tribal and source concentration where lawful, critic overturn, downstream correction, calibration, cost, latency, replans, stops, retries, and isolation attempts.

Gold cases include same-name places; postal versus municipal boundary; county/city overlap; unincorporated area; border address; tribal land; rural designation; watershed; custom service polygon; PO box versus project site; headquarters versus service area; tenant incorporated outside project state; statewide recipient with local project; fiscal sponsor; national intermediary; radius rule; low-precision geocode; annexation/redistricting; historical boundary; disaster declaration; explicit exclusion; priority but not eligibility; local award but no formal rule; conflicting funder pages; fake map; cross-tenant poison; and prompt injection.

Separate tuning, calibration, development, regression, and final-certification datasets. Measure precision/recall where observable, place and role accuracy, spatial/temporal accuracy, eligibility false positives, evidence sufficiency/independence, calibration/abstention, geographic coverage/concentration, downstream acceptance/rejection, critic overturn, cost, and time.

Unit/property tests prove coordinate order and CRS handling, geometry validity, deterministic topology and distance, boundary temporal semantics, role separation, precision non-escalation, UNKNOWN preservation, non-widening authority, budget conservation, stable fingerprints, bounded loops/delegation, and immutable lineage.

Contract/integration tests cover schemas, geocoder/GIS/boundary/program/award/licensed adapters, evidence grouping, entity/place/specialist handoffs, policy/ranking services, migrations and spatial indexes, outbox/idempotency, cancellation, monitoring, restart/concurrency, duplicate/reordered events, retention, and tenant isolation.

End-to-end, adversarial, load, soak, chaos, and disaster-recovery tests exercise all gold cases plus malformed/huge geometries, topology bombs, forged maps, wrong CRS, IDOR, prompt injection, worker death at every state, provider/model/database/broker outage, rate shock, spatial-query exhaustion, outbox backlog, regional failover, backup restore, kill switch, secret/location leakage, and evaluator manipulation.

## 18. Deployment, acceptance, and final report

Version schemas, prompts, models, tools, adapters, place ontology, geocoders, boundaries, CRS/topology/precision rules, eligibility and award rules, ranking, policy, and flags. Roll out via offline evaluation, shadow discovery, tenant and geography canaries, limited source/boundary classes, monitored expansion, then GA only after gates. Rollback preserves geographic/evidence/candidate/audit lineage and in-flight compatibility.

ADRs cover geography-role ontology, place identity, boundary versioning, CRS/topology/distance, geocoding precision, formal-versus-observed semantics, sources/licensing, matching/ranking, geographic bias, persistence/workflow, tenancy, economics, monitoring, and learning. Runbooks cover wrong place, boundary/CRS failure, precision error, role conflation, eligibility false positive, fake map/program, source outage, location-privacy event, tenant incident, cost anomaly, stuck run, outbox backlog, kill switch, rollback, and disaster recovery.

G0–G5 require repository discovery; constitutional conformance; machine contracts; deterministic entity/place, boundary, spatial, temporal, evidence, policy, ranking, economic, concurrency, and privacy foundations; executed multi-cycle hypothesis, source selection, evaluation, replanning, handoff, and monitoring; and security, isolation, calibration, geographic-bias, load, soak, chaos, recovery, observability, rollback, documentation, and independent evaluation.

Return traceability; repository maps; code/migrations/interfaces/workflows/events; adapter and evidence integration; executed tests/evaluations; multi-cycle traces; geography-role, place, boundary, CRS, topology, precision, eligibility, award, and temporal proofs; ranking sensitivity and coverage analysis; security/privacy/tenant evidence; calibration/errors; performance/cost/recovery; residual risks/skips/failures/waivers/owners/expiry; and governed G0–G5 verdict.

This specification itself proves no implementation. A score of 95–100 or production-ready verdict may be reported only from attached executed evidence with every blocking gate passed.
