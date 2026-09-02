# BEN-SUP-05 — Prospect Research Critic and Red-Team Agent

**Specification ID:** PIL-AGENT-BEN-SUP-05  
**Version:** 2.0.0  
**Family:** Supervisory and Orchestration  
**Default autonomy:** A2 — Prepare and Queue  
**Criticality:** Tier 0 independent assurance control  
**Human boundary:** Cannot waive policy, evidence, identity, independence, or tenant-isolation blocks  
**Platform boundary:** Generic Prospect Intelligence core; Domain Packs supply governed evaluation policy  
**Implementation status:** Specification remediated; production readiness requires G0–G5 evidence

## 1. Chain-It implementation directive

Implement BEN-SUP-05 as a durable, independently contextualized adversarial agent. It challenges consequential prospect-intelligence conclusions before they become trusted intelligence or influence qualification, prioritization, solicitation strategy, relationship routing, or downstream automation.

Before code changes, inspect the repository, constitution, registries, shared and critic contracts, policy model, evidence graph, events, migrations, workflow runtime, observability, test harness, deployment topology, and repository instructions. Produce a repository interaction map and requirement traceability matrix. Reuse canonical primitives. Never invent providers, endpoints, schemas, benchmarks, results, or production claims.

This is not a stylistic second-opinion prompt. Implement a persistent goal–observe–plan–select–act–evaluate–replan loop, bounded tools and authority, deterministic guardrails, immutable review lineage, typed findings/verdicts, independent context construction, durable recovery, adversarial evaluation, and human-review controls.

## 2. Mission, required outcomes, and non-goals

Determine independently whether consequential claims are sufficiently supported, correctly attributed, temporally valid, policy-permitted, calibrated, and complete enough for their proposed downstream decision.

Required outcomes:

- detect unsupported, overstated, stale, contradictory, circular, and misattributed claims;
- distinguish fact, estimate, inference, hypothesis, and recommendation;
- prevent capacity, liquidity, propensity, affinity, access, and intent conflation;
- expose entity confusion, duplicate identities, relationship overstatement, and missing negative evidence;
- require claim-level provenance and reconstructable evidence locators;
- produce exact remediation work when a gap is resolvable;
- fail closed on defective independence, policy, tenancy, or critical evidence;
- preserve immutable versioned review history.

BEN-SUP-05 does not create canonical facts, merge entities, waive policy, perform outreach, set fundraising strategy, alter source snapshots, adjudicate law, or certify its earlier work. It cannot execute downstream prospect activation.

## 3. Constitutional invariants

1. A research-producing agent cannot certify its own consequential output.
2. Critic context is separately built from canonical references and preserved evidence.
3. Originator prose is an assertion under review, never authoritative evidence.
4. Every reviewed claim maps to evidence, policy, temporal scope, and consequence.
5. Repeated reports from one underlying source form one independence group.
6. Search snippets and model memory cannot substantiate consequential claims.
7. Public availability alone does not establish permissible collection or use.
8. Partial execution, budget exhaustion, blocking findings, failed independence, or policy uncertainty prohibit `PASS`.
9. Authority may narrow but never widen without a new authorized request.
10. Tenant data, caches, retrievals, traces, metrics, and memory remain isolated.
11. Verdicts are immutable; remediation creates a linked review version.
12. Human override cannot convert policy, tenancy, evidence-integrity, or independence blocks into pass.

Any violation transitions the review to a terminal or quarantined state and emits security and audit events.

## 4. Repository interaction map

| Concern | Required integration |
|---|---|
| Constitution | autonomy, evidence, safety, tenancy, human-control rules |
| Agent registry | identity, version, owner, dependencies, kill switch |
| Service registry | policy, evidence, snapshot, entity, graph, budget, audit, workflow |
| Critic contracts | request, proof, finding, decision, remediation types |
| Workflow runtime | durable state, retries, timers, idempotency, compensation |
| Evidence graph | claims, locators, snapshots, derivation, independence groups |
| Policy engine | source, data class, purpose, retention, geography, action |
| Operator surface | queue, evidence comparison, findings, re-review, escalation |
| Evaluation harness | gold sets, mutations, adversarial, calibration, load suites |

Unknown repository facts become explicit discovery findings, never guessed details.

## 5. Typed request and observation contracts

### `CriticReviewRequest.v2`

Required fields:

- `review_id`, `request_id`, `tenant_id`, `correlation_id`, `causation_id`;
- `subject_refs[]`, `claim_refs[]`, `evidence_refs[]`, `decision_context_ref`;
- `originating_agent_ids[]`, `originating_run_ids[]`;
- `required_checks[]`, `consequence_class`, `review_depth_policy`;
- `policy_snapshot_id`, `domain_pack_version`, `schema_versions`;
- `authority_grant`, `tool_allowlist`, `data_classification_ceiling`;
- `budget_envelope`, `deadline`, `requested_at`, `idempotency_key`;
- `independence_requirements`, `response_contract_version`.

Reject empty claim sets, unknown versions, expired policy, tenant mismatch, inaccessible immutable evidence, authority/budget inconsistency, invalid consequence class, and duplicate keys with nonidentical payloads.

### `ReviewObservation.v2`

Contains canonical claims, exact locators, snapshot hashes, source metadata, derivation lineage, entity candidates, temporal qualifiers, contradictions, policy decisions, origin metadata, checklist, budget state, provenance, freshness, and observation time.

### `IndependenceProof.v2`

Required proof:

- critic agent/runtime session differs from all originating sessions;
- deterministic context builder identity and version;
- no originator hidden reasoning or unreviewed narrative summary included;
- model/provider separation policy result when consequence policy requires it;
- prompt, retrieval, cache, tool-result, and memory isolation attestations;
- conflict-of-role and prior-review checks;
- canonical-reference manifest hash;
- proof signature and verification time.

The proof is deterministic, machine-verifiable, immutable, and revalidated before verdict.

## 6. Claim and evidence model

`ReviewClaim.v2` records claim id, subject, predicate, value, unit, type, temporal interval, geography, asserted confidence, consequence, downstream use, evidence links, inference method, and origin run.

Claim types are `OBSERVED_FACT`, `DERIVED_FACT`, `ESTIMATE`, `INFERENCE`, `HYPOTHESIS`, and `RECOMMENDATION`. Type changes create a new version.

`EvidenceAssessment.v2` records source authority, proximity, incentives, editorial control, publication/effective/retrieval/preservation/expiry times, locator validity, snapshot integrity, direct/partial/contextual/contradictory/irrelevant support, entity and temporal applicability, derivation parent, independence group, policy result, retention, limitations, and confidence.

`ClaimEvidenceMatrix.v2` covers every consequential claim and includes coverage, independent corroboration count, strongest source tier, contradictions, identity certainty, freshness, inference validity, policy result, and threshold. A deterministic reducer calculates coverage; the model cannot self-report it.

## 7. Finding, remediation, and decision contracts

`CriticFinding.v2` requires finding id, review/version, tenant, severity, category, target refs, falsifiable assertion, evidence refs, rule refs, rationale, consequence, remediation, owner class, status, timestamps, and audit linkage.

Severity: `INFO`, `CAVEAT`, `MATERIAL`, `BLOCKING`, `POLICY_BLOCK`, `SECURITY_BLOCK`.

Categories include insufficient evidence, entity confusion, unsupported wealth/giving/causation, circular sourcing, stale evidence, weak source, invalid inference, relationship or eligibility error, duplicate identity, improper data use, missing contradiction, calibration error, temporal mismatch, incomplete review, evidence-integrity failure, and independence failure.

`CriticRemediationTask.v2` specifies exact target claim, missing evidence property, permitted source tiers, prohibited approaches, authority/tool bounds, success criterion, stop conditions, budget, deadline, dependency, and output contract. Vague “research more” instructions are invalid.

`CriticReviewDecision.v2` verdicts:

- `PASS`;
- `PASS_WITH_CAVEATS`;
- `RESEARCH_MORE`;
- `BLOCK_INSUFFICIENT_EVIDENCE`;
- `BLOCK_ENTITY_AMBIGUITY`;
- `BLOCK_POLICY`;
- `BLOCK_INDEPENDENCE`;
- `BLOCK_EVIDENCE_INTEGRITY`;
- `QUARANTINE_SECURITY`.

The decision stores reviewed claims, matrix hash, findings, deterministic rule results, confidence interval, limitations, permitted/prohibited uses, expiry/re-review conditions, independence proof, cost, versions, and signature.

## 8. Deterministic verdict calculus

Verdict selection is a policy-controlled deterministic reducer over typed findings and completed checks. The agent supplies structured judgments but cannot bypass the reducer.

Precedence:

1. security or tenant breach → `QUARANTINE_SECURITY`;
2. evidence tamper/hash failure → `BLOCK_EVIDENCE_INTEGRITY`;
3. independence failure → `BLOCK_INDEPENDENCE`;
4. prohibited source/data/purpose/action → `BLOCK_POLICY`;
5. unresolved critical identity ambiguity → `BLOCK_ENTITY_AMBIGUITY`;
6. unsupported consequential claim without feasible remediation → `BLOCK_INSUFFICIENT_EVIDENCE`;
7. feasible material gap → `RESEARCH_MORE`;
8. permitted nonblocking caveats only → `PASS_WITH_CAVEATS`;
9. all checks and thresholds satisfied → `PASS`.

Thresholds are versioned policy inputs by consequence class, never hard-coded marketing claims. Missing policy fails closed.

## 9. Durable state machine

Primary states:

`RECEIVED → VALIDATING → CONTEXT_BUILDING → INDEPENDENCE_VERIFYING → OBSERVING → PLANNING → REVIEWING → EVALUATING → REPLANNING | VERDICTING → PERSISTING → EMITTING → COMPLETED`

Exceptional states:

`WAITING_DEPENDENCY`, `WAITING_HUMAN`, `BUDGET_CONSTRAINED`, `CANCEL_REQUESTED`, `CANCELLED`, `BLOCKED`, `QUARANTINED`, `FAILED_RETRYABLE`, `FAILED_TERMINAL`.

Every transition persists expected prior state, reason, attempt, fencing token, actor, hashes, policy snapshot, authority, budget delta, and time. Compare-and-swap or equivalent prevents double transition. Terminal states are immutable.

## 10. Persistent agentic loop

1. **Goal:** bind exact claims, consequence, decision, success, and stop criteria.
2. **Observe:** retrieve independently built canonical context and preserved evidence.
3. **Plan:** create a risk-ranked adversarial matrix and coverage plan.
4. **Select:** choose allowlisted evidence, entity, graph, snapshot, contradiction, policy, and evaluation tools.
5. **Act:** execute claim tests and bounded independent delegations.
6. **Evaluate:** compare observations to evidence and consequence thresholds.
7. **Replan:** target material gaps whose resolution can change the verdict.
8. **Terminate:** issue one signed typed verdict or explicit block/quarantine.

Bound iterations, wall time, model/tool calls, retrieval bytes, evidence count, and spend. Repeated plan/observation signatures trigger loop termination.

## 11. Adversarial review planning

`CriticPlan.v2` contains hypotheses to falsify, claim/check dependency graph, ordered checks, expected observations, tool choices, source strategy, contradiction searches, coverage targets, uncertainty priorities, budget reservations, escalation rules, and stop conditions.

Mandatory test families when applicable:

- identity and entity attachment;
- direct evidentiary support;
- source quality and independence;
- freshness and temporal validity;
- contradiction and counterevidence;
- inference and causation validity;
- capacity/liquidity/propensity/affinity/access separation;
- relationship-path validity;
- eligibility and geographic applicability;
- completeness and material omission;
- privacy, purpose, retention, and action policy;
- confidence calibration.

High-consequence claims require claim-level inspection. Sampling requires explicit policy, persisted population, seed, design, and confidence bounds.

## 12. Tool governance and delegation

Every tool invocation carries tenant, authority, purpose, policy snapshot, budget reservation, idempotency key, timeout, retry class, and output schema. Outputs are untrusted observations subject to schema, provenance, injection, and tenant checks.

Delegations use typed tasks, intersect authority, reserve budget, bound recursion, exclude every originator, and require independent provenance. Delegates cannot issue the parent verdict. Cycles are rejected.

The critic cannot invoke outreach, canonical mutation, identity merge, policy override, payment, credential management, or destructive administration.

## 13. Authority and human control

Effective authority is the intersection of constitutional, tenant, agent, request, data-classification, tool, and current safety policy.

Operators may accept a nonblocking caveat, request a new review with evidence, cancel work, narrow authority/use, or dispute a finding with attributable evidence. They may not erase history, bypass isolation, retroactively authorize prohibited data, or turn a blocking verdict into `PASS`. Proceeding despite a nonpolicy risk is recorded separately and never rewrites the verdict.

## 14. Persistence and migrations

Persist normalized records for requests, versions, claims, evidence assessments, matrices, independence groups, observations, plans, checks, tool calls, delegations, findings, remediation, decisions, proofs, transitions, leases, budgets, human actions, events, and audit anchors.

Requirements:

- tenant key and tenant-scoped constraints on every record;
- append-only verdict, proof, audit, and evidence history;
- encrypted sensitive fields and governed retention/deletion;
- exact claim/evidence/policy referential integrity;
- forward/rollback migrations and mixed-version compatibility;
- row-level security or equivalent with negative tests;
- transactional outbox, idempotency ledger, uniqueness constraints;
- partition/archive design based on verified measurements.

Do not assume persistence technology before repository discovery.

## 15. Commands, queries, APIs, and events

Commands: `SubmitCriticReview.v2`, `CancelCriticReview.v1`, `SubmitRemediationEvidence.v2`, `RequestCriticReReview.v2`, `RecordHumanDisposition.v1`, `QuarantineCriticReview.v1`.

Queries expose status/timeline, claim-evidence matrix, findings/remediation, immutable verdicts, independence proof, cost/budget/tool/policy detail, and audit history.

Events cover accepted, independence verified/failed, plan created/replanned, check completed, finding opened/remediated, remediation requested, verdict issued, blocked/quarantined/cancelled, human disposition, and re-review completed.

All interfaces are versioned, authenticated, authorized, tenant-scoped, idempotent where mutating, rate-limited, auditable, and machine-documented. Consumers tolerate duplicate and reordered events.

## 16. Failure and recovery semantics

| Failure | Required behavior |
|---|---|
| Snapshot unavailable | permitted recovery or block; never model memory |
| Locator/hash mismatch | quarantine evidence and block integrity |
| Policy denial | block without unchanged retry |
| Independence failure | discard context, quarantine, rebuild independently |
| Invalid model output | schema reject; bounded repair/fallback; never coerce pass |
| Worker death | resume checkpoint under new fencing token |
| Duplicate command | return idempotent prior result |
| Concurrent review conflict | serialize lineage or reject stale write |
| Cross-tenant reference | fail closed, quarantine, security event |
| Budget/deadline exhausted | incomplete/block result; never pass |
| Dependency degradation | bounded backoff/circuit breaker with deadline |
| Event publish failure | atomic outbox and retried publication |

Retries distinguish transient, throttling, authentication, policy, validation, integrity, and terminal errors. Compensation never deletes immutable evidence or verdicts.

## 17. Security, privacy, and threat model

Threats include prompt injection, originator manipulation, critic collusion, forged snapshots/locators, evidence substitution, source laundering, poisoned memory, tenant confusion, IDOR, cache leakage, excessive retrieval, protected-trait inference, tool-output injection, event replay, verdict tampering, secret exposure, and evaluator gaming.

Controls include least privilege, workload identity, tenant authorization on every access, signed/hashed immutable artifacts, content/data separation, structured tool I/O, deterministic sanitization, provider/network allowlists, secret references, encryption, audit anchoring, retention, egress control, kill switch, anomaly alerts, dependency pinning/SBOM, and break-glass logging.

Automated negative tests and independent review—not prose—prove these controls.

## 18. Memory and governed learning

Episodic memory stores review tactics, plan outcomes, finding patterns, remediation effectiveness, disagreement, and calibration. It never becomes canonical prospect truth and never crosses tenants.

Learning proposals are versioned, reproducible, evaluated against frozen gold/adversarial sets, checked for subgroup and consequence regressions, approved, canaried, monitored, and rollbackable. Online self-modification of verdict rules, policy, prompts, models, or thresholds is prohibited.

## 19. Observability, SLOs, and operations

Metrics include intake, state/end-to-end latency, evidence coverage, circular-source collapse, entity and contradiction discovery, verdict distribution, finding severity/category, remediation success, re-review overturn, false-pass/false-block estimates, calibration error, policy/security blocks, human disagreement, tool/model error, retries, cost, budget variance, and tenant fairness.

Trace spans cover context build, independence, observation, planning, each check, tool/delegation, matrix reduction, verdict, persistence, event publication, remediation, and re-review. Logs are structured, redacted, correlated, tenant-aware, and retention-governed.

SLOs derive from measured workload and consequence. Cover availability, queue age, decision latency, durable completion, verdict integrity, audit completeness, isolation, RTO/RPO, false-pass risk, and cost. No numeric SLO is accepted without rationale and owner.

Controls include pause/resume, cancel, kill switch, quarantine, evidence comparison, finding disposition, re-review, dead-letter inspection, safeguarded replay, authorized budget adjustment, and audit export.

## 20. Gold and adversarial datasets

Create versioned, provenance-controlled, adjudicated datasets with inter-rater agreement for:

- same-name and duplicate entities;
- current versus historical positions;
- independent versus circular sources;
- fact/inference and causal overreach;
- wealth, liquidity, capacity, propensity, affinity, and intent;
- direct, partial, contextual, contradictory, irrelevant evidence;
- relationship strength and staleness;
- eligibility, geography, material omissions;
- permitted/prohibited data and uses;
- injection, tampering, and originator influence;
- incomplete, budget-exhausted, degraded reviews;
- benign high-quality dossiers that must not be overblocked.

Tune, calibration, development, regression, and final certification sets remain separate. Synthetic cases are labeled and never replace representative adjudicated cases.

## 21. Required test program

### Unit and property

- verdict precedence is total, deterministic, order-independent;
- blocking findings can never reduce to pass;
- duplicated evidence cannot increase coverage;
- authority and data classification never widen;
- budget cannot exceed reservation without authorization;
- confidence remains bounded and calibration reproducible;
- verdict lineage is immutable;
- material matrix mutation changes its hash;
- temporal/freshness rules handle clocks and timezones.

### Contract and integration

- supported backward/forward compatibility;
- unknown schema/policy versions fail safely;
- malformed model/tool outputs are rejected;
- commands/events preserve idempotency and causation;
- migration forward/rollback and mixed-version operation;
- context excludes originator hidden/unreviewed content;
- locator and snapshot hashes validate;
- source graph collapses derivation;
- entity ambiguity does not cause unauthorized merge;
- policy blocks prohibited source/purpose/action;
- workflow resumes at every transition;
- outbox prevents lost effects;
- cancellation, kill switch, quarantine, deadlines propagate;
- remediation creates immutable linked review.

### End-to-end domain scenarios

1. Net-worth article used as propensity evidence: reject conflation.
2. Outdated board biography supports current role: qualify or block.
3. Five sites repeat one release: count one independence group.
4. Donation belongs to namesake: block entity ambiguity.
5. Corporate-foundation giving asserted as executive affinity: reject.
6. Stale membership represented as warm relationship: downgrade/block.
7. Mission alignment omits geographic ineligibility: blocking omission.
8. Causal giving claim relies on temporal correlation: reject causation.
9. Polished narrative hides contradictory primary evidence: surface it.
10. High-quality dossier has independent primary support: pass without overblocking.
11. Remediation adds authoritative permitted evidence: linked re-review/new verdict.
12. Budget expires before critical checks: explicit incomplete block.

### Adversarial, security, reliability, and chaos

Test originator commands to pass; source/tool prompt injection; session/cache contamination; forged locators, hashes, signatures, policy snapshots; cross-tenant IDs in every layer; IDOR/privilege escalation; protected-trait and purpose laundering; hidden contradiction/source laundering; replay/reordering/stale fencing; evaluator manipulation; and secret/PII leakage.

Inject worker death, database failover, queue duplication/reordering, partitions, dependency throttling, policy/model outage, corrupt checkpoint, outbox backlog, clock skew, and regional failover. Demonstrate bounded recovery, no illegal pass, no lost lineage, and measured RTO/RPO.

## 22. Performance and scale certification

Derive profiles from tenants, concurrent reviews, claims/evidence per review, consequence mix, source-graph size, remediation rate, bursts, and retention. Test steady state, burst, soak, saturation, failover, and noisy-neighbor isolation.

Report throughput, queue age, percentile latency, errors/retries, contention, model/tool utilization, cost per review/claim, scale inflections, and recovery. Claims require reproducible environment, dataset, configuration, raw results, and bottleneck analysis. Unsupported “multi-million scale” language is prohibited.

## 23. Deployment, rollout, rollback, and operations

Version schemas, policy, prompts, models, tools, and flags. Roll out through offline certification, shadow review, tenant-isolated canary, limited consequence classes, monitored expansion, then general availability only after all gates pass.

Rollback preserves verdict lineage, policy snapshots, audit evidence, and in-flight compatibility. Model/prompt/rule changes require regression and calibration comparison; security or false-pass regression halts rollout.

ADRs cover independent context, source grouping, verdict calculus, workflow/persistence, evidence immutability, tenant enforcement, policy, model/tool selection, sampling, human disposition, remediation lineage, and learning controls.

Runbooks cover stuck review, independence failure, evidence corruption, policy outage, tenant incident, false-pass signal, overblocking spike, cost anomaly, provider degradation, queue saturation, outbox backlog, kill switch, rollback, DR, and audit export. Each names triggers, diagnosis, safe action, escalation owner, evidence preservation, recovery verification, and post-incident review.

## 24. Acceptance gates G0–G5

### G0 — Repository and authority discovery

Repository map, owners, boundaries, policies, dependencies, schemas, migrations, deployment, and rollback are evidenced; unknowns are resolved or blocking.

### G1 — Constitutional conformance

Independence, bounded autonomy, evidence, tenancy, policy, human control, and no-self-certification invariants trace to code and tests.

### G2 — Contract conformance

Commands, observations, plans, findings, remediation, decisions, events, errors, and compatibility are machine-validated.

### G3 — Deterministic foundations

Independence, authority intersection, policy, evidence integrity, source grouping, coverage, verdict precedence, idempotency, and budget enforcement pass.

### G4 — Demonstrated agent behavior

Executed traces prove observation, risk-based planning, tool choice, material replanning, bounded delegation, transparent termination, restart safety, and remediation/re-review.

### G5 — Production quality

Security, privacy, tenant isolation, calibration, false-pass/false-block, performance, soak, chaos, recovery, observability, rollback, documentation, and independent evaluation pass with no blocking failures. A ≥95/100 score may be reported only from the governed scorecard and attached evidence.

## 25. Required final implementation report

Return requirement-to-code/test/evidence traceability; repository map and ADRs; schemas, migrations, APIs, events, workflows, controls, rollback; executed test and reliability results; adversarial and remediation traces; independence and isolation evidence; dataset provenance, adjudication, calibration, error analysis; measured SLO/capacity/cost results; residual risks, skips, failures, waivers, owners, expiry; and the governed G0–G5 result.

Never claim enterprise readiness, production readiness, scale readiness, or a 95–100 score from specification prose, simulated output, assumed infrastructure, or skipped/failing evidence.
