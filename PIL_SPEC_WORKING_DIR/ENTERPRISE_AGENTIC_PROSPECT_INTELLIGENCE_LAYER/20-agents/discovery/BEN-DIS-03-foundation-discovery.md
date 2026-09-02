# BEN-DIS-03 — Foundation Discovery Agent

**Specification ID:** PIL-AGENT-BEN-DIS-03  
**Version:** 2.0.0  
**Family:** Discovery  
**Default autonomy:** A2 — prepare and queue  
**Maximum delegation depth:** 3  
**Cadence:** On-demand, event-driven, and governed monitoring  
**Boundary:** Produces provisional foundation candidates and research gaps, never verified eligibility, award probability, application authority, or CRM state  
**Status:** Specification remediated; readiness requires executed G0–G5 evidence

## 1. Chain-It directive

Implement BEN-DIS-03 as a durable agent inheriting Discovery Agent Shared Contract v2.0.0. Inspect constitution, registries, strategy, Prospect Digital Twin, tenant/domain twin, organization/entity/evidence/grant contracts, source/capability registry, policy, workflow runtime, persistence/migrations, APIs/events, observability, evaluations, deployment, and repository instructions. Produce repository interaction, authority, trust-boundary, data-flow, temporal-model, and requirement-traceability maps.

Reuse canonical adapters and deterministic services. Never invent foundation identities, tax status, filings, grants, assets, priorities, eligibility, invitation status, deadlines, application URLs, contacts, provider endpoints, permissions, test results, or readiness.

Implement goal–observe–hypothesize–plan–select/delegate–discover–link evidence–evaluate–replan–handoff/monitor/stop. A foundation directory scraper, keyword matcher, ETL job, or one-shot prompt is not this agent.

## 2. Mission and accountable outcome

Discover private, family, corporate, community, operating, and other policy-approved foundations whose documented purposes, programs, grantmaking behavior, geography, recipient characteristics, eligibility signals, and application pathways plausibly match an approved tenant strategy.

The accountable outcome is a precise, diverse, evidence-linked set of provisional foundation candidates with legal-entity ambiguity, temporal state, formal and observed funding behavior, eligibility gaps, application-access state, contradictions, and exact downstream research tasks.

Success is downstream-valid opportunity discovery—not raw foundation count, superficial mission-text similarity, asset size, or inferred award likelihood.

## 3. Reasoning and truth boundary

BEN-DIS-03 owns foundation search hypotheses, source-mix adaptation, preliminary legal/entity synthesis, program and grant-pattern hypotheses, formal-versus-observed eligibility comparison, application-path discovery, ranking, coverage analysis, and handoff.

It does not:

- establish canonical organization identity, tax status, or active legal status;
- certify eligibility or application openness;
- infer current priorities from one old grant or stale filing;
- treat historical recipients as formal eligibility rules;
- treat trustees’ personal interests as foundation policy;
- treat foundation assets as annual giving or available grant budget;
- treat authorized grants, paid grants, pass-through funds, and commitments as equivalent;
- treat a corporate foundation as its parent company’s CSR program;
- treat a donor-advised fund sponsor, account, fund, and advisor as one entity;
- fabricate deadlines, URLs, contacts, portals, or invitation status;
- predict awards, recommend ask amounts, submit applications, or mutate CRM.

Entity resolution, filing normalization, grant extraction, eligibility verification, relationship research, qualification, critic review, strategy, application operations, and CRM synchronization remain separate.

## 4. Durable goal and inputs

FoundationDiscoveryGoal.v2 requires tenant/domain/goal/strategy ids/versions; decision enabled; tenant legal/program/geographic profile reference; cause/program/geography/time semantics; permitted foundation types; inclusion/exclusion; minimum evidence tiers; formal/observed eligibility requirements; grant-history window; source classes; candidate/handoff limits; diversity/coverage objectives; budgets; deadline; A2 ceiling; critic gates; monitoring triggers; and success/stop/escalation rules.

Inputs include ResearchStrategy; Prospect Digital Twin; tenant legal classification, programs, populations, service areas, budgets, fiscal sponsorship, operating history, and exclusions; Domain Pack taxonomies; source/capability registry; evidence/freshness/corroboration policy; known entities and opportunities; identity/termination/merger state; prior candidates and fingerprints; provider health/cost; outcome corrections; policy snapshot; and budget.

Reject invalid schema, tenant mismatch, stale policy/twin, missing purpose/stopping rules, undefined foundation types or geography, prohibited source/data, unavailable mandatory evidence tier, contradictory strategy, or authority above A2.

## 5. Foundation identity and lifecycle contract

FoundationIdentityHypothesis.v2 records provisional name, former/alternate names, legal type, jurisdiction, tax identifiers where permitted, parent/sponsor/affiliate relationships, addresses with effective intervals, formation/termination/merger/conversion hypotheses, filing periods, entity candidates, collision indicators, evidence, confidence interval, and unresolved questions.

Lifecycle states are ACTIVE_VERIFIED, ACTIVE_UNCONFIRMED, INACTIVE, TERMINATED, MERGED, CONVERTED, SUSPENDED, UNKNOWN, and CONFLICTING. Discovery never upgrades a lifecycle state without required evidence.

Name similarity, shared address, shared trustees, or parent branding cannot alone merge entities. Renamed foundations, similarly named family foundations, regional affiliates, supporting organizations, corporate parents/subsidiaries, community-foundation component funds, and DAF structures require explicit relationship semantics.

Material ambiguity creates an entity-resolution handoff and blocks opportunity-ready status.

## 6. Foundation and program classification

FoundationProfileHypothesis.v2 distinguishes private nonoperating, private operating, family, independent, corporate, company-sponsored, community, conversion/health legacy, supporting organization, grantmaking public charity, intermediary, and other governed classes. Classification includes legal evidence, operating behavior, uncertainty, and time interval.

FoundationProgramHypothesis.v2 records program name, formal description, cause ontology mapping, population, activity, geography, funding mechanism, restrictions, effective dates, status, official and observed evidence, contradictions, confidence, and gaps.

Corporate foundation, corporate giving program, CSR/sustainability initiative, marketing sponsorship, employee matching, and in-kind donation are separate. Community foundation discretionary grants, field-of-interest funds, designated funds, scholarships, DAFs, and fiscal-sponsor flows are separate.

## 7. Filing and financial-period semantics

FilingObservation.v2 requires foundation/entity ref, filing type, tax/fiscal period, received/published/retrieved dates, amendment status, source locator/snapshot hash, extraction version, currency, beginning/end assets, contributions received, grants/assistance, qualifying distributions, administrative expenses, officers, recipients, schedules, anomalies, and limitations.

Deterministic services parse and normalize filings. The agent reasons about relevance, conflicts, and gaps. Calendar year, fiscal year, filing receipt year, and publication year remain distinct. Amended filings supersede values only through explicit lineage. Missing schedules, OCR errors, duplicated pages, and multi-year overlaps are not silently repaired.

Assets are a balance-sheet stock, not annual giving. Qualifying distributions are not identical to grants paid. Contributions received are not grant budget. Program-related investments, set-asides, administrative expenses, and pass-through grants require distinct treatment.

FoundationFinancialHypothesis.v2 uses ranges and preserves original values, transformations, currency/date basis, missingness, contradictions, confidence, and prohibited interpretations.

## 8. Grant observation and pattern model

FoundationGrantObservation.v2 requires funder and recipient observed identities, amount/range/currency, authorization and payment status, purpose text and ontology mapping, geography, grant type, restriction, period, source group, locator/snapshot, filing/report linkage, pass-through/intermediary state, attribution certainty, identity certainty, effective/retrieval times, and limitations.

Grant statuses include AUTHORIZED, COMMITTED, PAID, PARTIALLY_PAID, RESCINDED, REFUNDED, REPORTED_UNCLEAR, and UNKNOWN. Do not infer payment from an announcement or infer current availability from historical payment.

GrantPatternHypothesis.v2 records adjudicated observation set, time window, cadence, amount distribution, recipient types, causes, geographies, new-versus-repeat recipients, concentration, multi-year behavior, outliers, source independence, missing periods, and confidence.

Recipient history is behavioral evidence, not formal eligibility. Pass-through grants remain attributed to original and intermediary actors with typed roles. Joint grants and pooled funds preserve multiple funders.

## 9. Eligibility and application-access model

FoundationEligibilityHypothesis.v2 separates:

- FORMAL_ELIGIBILITY: explicit current rule from authoritative material;
- OBSERVED_RECIPIENT_PATTERN: historical behavior;
- TENANT_MATCH_HYPOTHESIS: comparison to current tenant twin;
- UNRESOLVED_REQUIREMENT: evidence gap requiring verification.

Eligibility dimensions include legal/tax status, organization type, geography, population, program/activity, operating history, budget/revenue, fiscal sponsorship, religious restrictions, nondiscrimination, project stage, capital/operating use, grant size, matching requirement, relationship/invitation, prior recipient status, and exclusions. Each rule carries effective interval, scope, source, confidence, contradiction, and UNKNOWN support.

ApplicationAccessObservation.v2 records OPEN_CYCLE, ROLLING, PERIODIC_CLOSED, INVITATION_ONLY_VERIFIED, NO_UNSOLICITED_PROPOSALS, LETTER_OF_INQUIRY, NOMINATION, RELATIONSHIP_REQUIRED, PROGRAM_INACTIVE, UNKNOWN, or CONFLICTING.

Every deadline, portal, URL, required document, contact channel, and cycle has exact authoritative evidence, retrieval time, timezone, applicable program, and verification state. Absence of a public application page does not prove invitation-only status.

## 10. Candidate output contract

FoundationCandidate.v2 requires:

- candidate/version and tenant/domain/run/plan/hypothesis lineage;
- provisional identity/lifecycle/classification and ambiguity;
- parent, affiliate, sponsor, fund, and intermediary relationships;
- program and cause/geography hypotheses;
- filing observations and financial ranges;
- grant observations/patterns with attribution;
- formal eligibility, observed patterns, tenant-match hypothesis, and gaps kept separate;
- application-access observations and freshness;
- officer/trustee references without inferred policy;
- evidence refs, independent source groups, contradictions, and limitations;
- exclusion/policy/duplicate checks and tenant WorkFingerprint;
- ranking factors, confidence interval, sensitivity, calibration version;
- exact specialist/critic tasks;
- authority, budget, tools/models, timestamps, hashes, and prohibited claims.

Statuses: PROVISIONAL, NEEDS_ENTITY_RESOLUTION, NEEDS_FILING_RESEARCH, NEEDS_GRANT_VALIDATION, NEEDS_ELIGIBILITY_VERIFICATION, NEEDS_APPLICATION_VERIFICATION, READY_FOR_SPECIALIST_HANDOFF, SUPPRESSED_DUPLICATE, EXCLUDED_POLICY, TERMINATED_ENTITY, REJECTED_MISMATCH, or MONITOR.

No status implies eligibility, award likelihood, or permission to apply.

## 11. Hypotheses, source strategy, and evidence

FoundationSearchHypothesis.v2 includes target segment, rationale, foundation/program types, cause/population/geography terms, predicted formal and observed evidence, source classes/independence, disconfirming conditions, bias/risk, cost/value, confidence, and status.

Maintain materially distinct hypotheses: formal program alignment, observed recipient pattern, geographic funder, community-foundation pathway, corporate foundation, family foundation, operating foundation partnership, and issue-specific historical grantmaker where appropriate.

FoundationSourcePlan.v2 maps hypotheses to registered capabilities, filing/official/recipient/licensed source classes, independent groups, query concepts, expected artifacts, quotas, parallelism, rate limits, budget, fallbacks, and stop rules.

Official sites establish current statements only within their effective context; filings establish reported historical/legal-financial facts; recipient reports may confirm grants but not funder policy; licensed databases are discovery aids subject to provenance. Search snippets and model memory are not evidence. Repeated copies of one announcement are one group.

## 12. Deterministic gates, matching, and ranking

Hard gates reject cross-tenant references, prohibited data/source, exclusions, failed evidence integrity, exact duplicate work, terminated/inactive entity when strategy requires active grantmaking, unresolved identity above threshold, fabricated/unverified application data, absent required giving evidence, and formal known ineligibility.

TenantMatchAssessment.v2 compares each eligibility dimension to a versioned Prospect Digital Twin field and returns MATCH, MISMATCH, UNKNOWN, NOT_APPLICABLE, or CONFLICTING with evidence on both sides. UNKNOWN never becomes MATCH.

Ranking uses policy-versioned factors: current program alignment, observed grant alignment, geography, recipient similarity, evidence quality/independence/freshness, grant-band relevance, access-path evidence, novelty, uncertainty reduction, and downstream value. Penalties include identity/lifecycle ambiguity, stale filings/site, formal mismatch, unknown critical requirements, contradictions, source concentration, pass-through confusion, and follow-up cost.

Missing values remain missing. Every factor records provenance, estimator version, confidence, freshness, and sensitivity. Ranking cannot override hard gates or represent award probability.

## 13. Durable state and agentic loop

States: CREATED, VALIDATING, OBSERVING, HYPOTHESIZING, PLANNING, RESERVING, DISCOVERING_ENTITIES, DISCOVERING_PROGRAMS, ANALYZING_FILINGS, ANALYZING_GRANTS, ASSESSING_ELIGIBILITY, VERIFYING_ACCESS, EVIDENCE_LINKING, EVALUATING, REPLANNING, HANDING_OFF, MONITORING, and terminal SATISFIED, EXHAUSTED, PAUSED, BLOCKED_POLICY, BLOCKED_HUMAN, CANCELLED, FAILED_RECOVERABLE, FAILED_TERMINAL, SUPERSEDED.

Transitions persist expected version, fencing token, reason, actor, attempt, hashes, policy/authority, budget delta, timestamp, and audit anchor. Aggregate/outbox commit atomically; terminal changes create successors.

Loop: bind goal and tenant profile; observe sources, prior coverage, legal/program/grant/application state; form alternative hypotheses; plan independent source classes and parallel branches; select registered tools/delegates; gather and preserve evidence; synthesize provisional candidates; evaluate identity, lifecycle, temporal validity, formal/observed alignment, access, contradictions, coverage, bias, cost, and downstream value; materially replan; handoff, monitor, stop, pause, or escalate.

Bound iterations, fan-out, depth 3, candidates, filings, grants, calls, bytes, time, and spend. Loop-signature detection prevents repetitive searches.

## 14. Replanning, delegation, and monitoring

Replan when stated priorities conflict with grants, identity/subentity collisions emerge, lifecycle changes, filings are stale/amended/missing, fiscal periods mismatch, pass-through attribution changes, formal eligibility contradicts recipient patterns, application status changes, geography is ambiguous, provider availability changes, downstream review rejects, or budget/policy/deadline changes.

Adapt hypothesis, concepts, sources, breadth/depth, ordering, quotas, and bounded specialist tasks. Stop when critical formal mismatch is proven, entity is terminated, evidence remains inadequate after configured effort, source paths saturate, or marginal value falls below risk/cost.

DelegatedFoundationTask.v2 carries exact objective, immutable inputs, output schema, authority/source/tool limits, budget, deadline, evidence/freshness, depth, success/stop/escalation, and parent lineage. Typical handoffs include entity resolution, filing normalization, grant validation, eligibility verification, application-cycle verification, relationship research, qualification, and BEN-SUP-05 critic review.

Monitoring reopens on new/amended filing, program/priority change, new grant cycle, deadline/application change, leadership change, merger/termination, new grant, geographic change, or correction. Reopen creates a new version and reevaluates affected candidates.

## 15. Authority, economics, persistence, and recovery

Effective authority intersects system, tenant, Domain Pack, strategy, task, classification, source, budget, and human policy and only narrows. No outreach, application submission, CRM mutation, private contact harvest, protected targeting, policy exception, canonical merge, qualification, or award prediction.

Budgets cover currency, tokens, model/tool calls, provider quotas, storage, elapsed time, fan-out, candidates, filings, grants, and operator effort. Reserve, reconcile, and release verified unused capacity. Continue only while expected valid-candidate yield, coverage, uncertainty reduction, or decision value exceeds marginal cost/risk.

Persist goals, observations, hypotheses, source plans, identities/lifecycles, programs, filings, financial hypotheses, grants/patterns, eligibility/access, match assessments, candidates, evidence, fingerprints, rankings, decisions, delegations, handoffs, monitoring, budgets, transitions, human actions, events, and audit.

Require tenant constraints, append-only history, encryption/retention, exact versions, optimistic concurrency/fencing, transactional outbox, idempotency ledger, RLS/equivalent negative tests, and forward/rollback/mixed-version migrations.

Recovery resumes verified state, reconciles candidate delivery/budgets, uses fresh fencing, preserves source artifacts, and quarantines integrity or cross-tenant failures.

## 16. APIs, events, errors, security, and operations

Commands support submit, pause, resume, cancel, supersede, handoff, monitor, human disposition, and replay-safe recovery. Queries expose goal/hypotheses, identities/lifecycle, programs, filings, grants, eligibility/access, match, candidates/evidence/gaps, ranking sensitivity, budgets, decisions, and audit.

Events cover accepted, hypothesis/plan created/revised, entity/program/filing/grant observed, lifecycle conflict, eligibility/access gap, candidate discovered/suppressed/handed off, critic requested, provider/policy/budget block, monitoring trigger, and termination.

Typed errors include invalid input, policy/authority/tenant denial, prohibited/unavailable/rate-limited source, evidence integrity, entity/lifecycle conflict, filing parse/period conflict, grant attribution conflict, eligibility/access unknown, duplicate work, budget/deadline, stale version/lease, model/adapter schema, cancellation, recovery, and security. Each defines retry, attempts, backoff, circuit breaker, budget treatment, state, and operator visibility.

Threats include prompt/source poisoning, fabricated deadlines/portals, stale-policy laundering, entity/fund conflation, pass-through misattribution, protected-data inference, IDOR, cross-tenant cache/graph/vector/queue/object leakage, forged filings/evidence, duplicate delivery, denial-of-wallet, secrets, replay, and evaluator gaming.

Controls include workload identity, least privilege, per-access tenant authorization, structured adapters, instruction/data separation, hashes/provenance, source allowlists, secret references, encryption, egress/rate/budget controls, telemetry redaction, retention, kill switch, signed commands, audit anchors, SBOM/pinning, and alerts.

## 17. Memory, observability, evaluation, and testing

Tenant-scoped memory stores plans, yields, source performance, corrections, and outcomes, never canonical truth. Learning proposals for queries, matching, ranking, or stopping require versioned offline evaluation, bias/security review, canary, monitoring, and rollback; online authority/policy/gate modification is prohibited.

Metrics include valid-foundation precision, legal-entity/lifecycle error, grant attribution, eligibility false positive, application-data error, freshness, evidence independence, source/segment concentration, UNKNOWN handling, downstream acceptance/critic overturn, calibration, human correction, cost, latency, replans, stops, retries, and isolation attempts. Trace every loop stage and decision; operators can inspect, compare, pause/resume, cancel, narrow, suppress, request review, kill, and export audit.

Gold cases include renamed/terminated/merged foundations, DAFs, community component funds, corporate foundation versus CSR, invitation-only ambiguity, geographic exclusions, stale/amended 990-PF, pass-through/pooled grants, fiscal-year mismatch, paid versus committed grants, operating foundation, conversion foundation, aligned but formally ineligible tenant, fiscal sponsor, repeat recipients, old one-off grants, conflicting websites/filings, exclusions, cross-tenant poison, and prompt injection.

Separate tuning, calibration, development, regression, and final certification. Measure precision/recall where observable, identity/lifecycle error, eligibility/access false positives, evidence sufficiency/independence, calibration/abstention, false discovery, downstream acceptance/rejection, critic overturn, cost, and time.

Unit/property tests prove temporal and fiscal semantics, asset/distribution/grant separation, UNKNOWN preservation, deterministic gates/ranking/matching, non-widening authority, budget conservation, stable fingerprints, bounded loop/delegation, and immutable lineage.

Contract/integration tests cover schemas, filing/official/licensed adapters, evidence/source grouping, entity and specialist handoff, ontology/match service, policy, migrations, outbox/idempotency, cancellation, monitoring, restart/concurrency, duplicate/reordered events, and tenant isolation.

E2E/adversarial/load/soak/chaos/DR tests exercise every gold case plus forged filing/deadline/portal, IDOR, prompt injection, worker death at every state, provider/model/database/broker outage, rate shock, outbox backlog, regional failover, backup restore, kill switch, secret/PII leakage, and evaluator manipulation.

## 18. Deployment, acceptance, and final report

Version schemas, prompts, models, tools, adapters, ontologies, filing/grant/eligibility rules, ranking, and flags. Roll out via offline evaluation, shadow discovery, tenant canary, limited source classes, monitored expansion, then GA after gates. Rollback preserves evidence/candidate/audit lineage and in-flight compatibility.

ADRs cover identity/lifecycle, classification, temporal filing model, grant attribution, eligibility/access, matching/ranking, source strategy, persistence/workflow, tenancy, economics, monitoring, and learning. Runbooks cover legal-status conflict, stale/corrupt filing, fabricated deadline, attribution error, eligibility false-positive spike, source outage, tenant incident, cost anomaly, stuck run, outbox backlog, kill switch, rollback, and DR.

G0–G5 require repository discovery; constitutional conformance; machine contracts; deterministic temporal/match/gate/economic/concurrency foundations; executed multi-cycle hypotheses, source selection, evaluation, replanning, handoff, and monitoring; and security, isolation, calibration, load, soak, chaos, recovery, observability, rollback, documentation, and independent evaluation.

Return traceability; repository maps; code/migrations/interfaces/workflows/events; adapter/evidence integration; executed tests/evaluations; multi-cycle traces; entity/lifecycle, filing, grant, eligibility, and application-access proof; matching sensitivity; source/segment coverage; security/tenant evidence; calibration/errors; performance/cost/recovery; residual risks/skips/failures/waivers/owners/expiry; and governed G0–G5 verdict.

A score ≥95/100 may be reported only from attached executed evidence with every blocker passed. Never claim enterprise, production, or scale readiness from prose, simulation, assumptions, or skipped/failing evidence.
