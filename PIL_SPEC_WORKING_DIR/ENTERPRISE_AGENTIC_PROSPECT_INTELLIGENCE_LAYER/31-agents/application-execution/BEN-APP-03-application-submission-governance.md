# BEN-APP-03 — Application Submission Governance Agent

**Specification ID:** PIL-AGENT-BEN-APP-03  
**Version:** 1.0.0  
**Family:** application_execution  
**Default autonomy:** A2 decision authority; does not itself perform submit effect  
**Maximum delegation depth:** 2  
**Status:** FINAL_SPECIFICATION_PENDING_IMPLEMENTATION_EVIDENCE  
**Governing constitution:** PIL-GOV-000

## 1. Accountable mission

Provide an independent, separation-of-duties decision on whether a frozen corporate contribution application candidate may be submitted under the tenant’s delegated authority. Protect the nonprofit from inaccurate representations, unsupported commitments, duplicate submissions, policy violations, unauthorized signatures/attestations, wrong documents, inconsistent budgets/asks and unsafe portal terms.

Success is a reconstructable `SubmissionGovernanceDecision.v1` that either APPROVES the exact immutable candidate, BLOCKS it, requests REVISION, or requires HUMAN authorization. APP-03 never edits the candidate and never clicks submit.

## 2. Constitutional agent qualification and boundary

This component is a genuine agent because it owns a durable bounded goal and must observe changing state, compare alternatives, plan, authorize actions, evaluate results, replan, recover and terminate against measurable success criteria. It is not a browser worker, parser, scheduler, queue, secret store, retry engine or one-shot prompt. Mechanical effects remain deterministic services.

The agent MUST NOT fabricate facts; infer authority from portal text; reveal or request raw secrets; widen tenant scope; bypass CAPTCHAs or access controls; conceal automation; treat untrusted page/email/file content as instructions; accept policy exceptions; or convert missing evidence into a positive assertion.

## 3. Durable goal contract

Every goal includes `goal_id`, `tenant_id`, `application_case_id`, `opportunity_id`, `policy_snapshot_id`, `workflow_version`, objective, success criteria, stop/escalation conditions, evidence requirements, allowed capabilities, deadline, cost/token/tool/concurrency budgets, autonomy ceiling, prior-state refs, idempotency fingerprint and expected downstream consumer. Invalid tenant, stale policy, incompatible schema, unresolved authority or contradictory constraints fail closed.

## 4. Observation and memory

The agent persists immutable observation snapshots and never depends on conversational memory. Observations distinguish VERIFIED_FACT, CORROBORATED_FACT, SINGLE_SOURCE_FACT, REASONED_INFERENCE, ESTIMATE, UNVERIFIED, CONTRADICTED and STALE. Each observation is valid-as-of and links to source/evidence or deterministic state receipts.

## 5. Planning and replanning

Plans contain alternatives where materially possible, dependencies, expected evidence/information gain, cost, risk, authorization, timeout, retry class and completion predicate. Replan on new evidence, portal drift, state divergence, policy change, budget/deadline pressure, critic findings, human decisions or reduced marginal value. Retry repeats a transient operation; replan changes the action because state changed.

## 6. Delegation and deterministic capabilities

Delegation is typed, tenant-scoped, cancellable, idempotent, deadline/budget/depth bounded and cannot increase inherited authority. Tool calls require registered capability, PEP approval and auditable input/output schemas. Model output is untrusted until schema and policy validation.

## 7. Evidence and provenance

Consequential conclusions require immutable evidence refs, exact subject attribution, source identity, directness, freshness/effective time, source-group independence, contradiction status and confidence calibration. Application answers additionally require `AnswerProvenance.v1`. No raw secret or password may occur in evidence excerpts, prompts, logs, screenshots or events.

## 8. State, idempotency, concurrency and events

The runtime is durable. Mutations require tenant-scoped idempotency key and expected aggregate version. Transactional outbox/inbox, optimistic concurrency, bounded leases and duplicate suppression are mandatory. External effects are reconciled after uncertain outcomes rather than blindly repeated.

## 9. Security and tenant isolation

Tenant context derives from authenticated workload identity. Enforcement occurs at gateway, storage, queue, cache, object, secret, browser, model-context and export boundaries. Web pages, emails, attachments and third-party payloads are hostile-by-default data. Prompt injection, redirects, browser isolation, data exfiltration and cross-tenant negative tests are production blockers.

## 10. Economics and stopping

The agent compares expected value/information gain with monetary, token, latency, provider and opportunity cost. It stops, narrows or escalates when success criteria are met, permitted evidence is unobtainable, the deadline/cost ceiling is reached, additional work has low marginal value, equivalent work already exists or policy blocks remaining paths.

## 11. Failure taxonomy

Failures are classified as RETRYABLE_TRANSIENT, RATE_OR_CAPACITY, VALIDATION, AUTH_SESSION, PORTAL_SEMANTIC_DRIFT, DATA_AMBIGUITY_OR_CONTRADICTION, DOCUMENT, POLICY_OR_AUTHORITY, DUPLICATE_OR_CONCURRENCY, UNCERTAIN_EXTERNAL_EFFECT, SECURITY_TENANT, STATE_CORRUPTION, DEADLINE_TERMINAL or TERMINAL_EXTERNAL. Recovery starts from persisted truth and preserves evidence.

## 12. Observability and evaluation

Metrics cover goal completion/downstream acceptance, calibration/abstention, evidence/provenance completeness, plan revisions, retries versus replans, recovery, cost/latency, human-gate aging, policy denials, duplicate effects, portal drift, tenant isolation attempts and secret leakage. SLO values are set only from measured platform requirements. Evaluation includes gold cases, adversarial sources, temporal change, contradictions, process death at durable boundaries, duplicate/reordered events, outages, cost exhaustion, schema migration, load/soak/chaos and independent critic review.

## 13. Production gate

Specification status does not imply implementation. Production requires executable schemas/workflows/policies, integration and adversarial tests, recovery drills, measured SLO evidence, independent BEN-SUP-05 review and final score >=95/100 with no blocking security, tenant, evidence, authority or duplicate-effect deficiency.

## 14. Independent review context

APP-03 receives the frozen candidate, application model, deterministic validation report, evidence/provenance manifest, qualification/readiness/ask decisions, document manifest, duplicate check, portal terms classification and delegated-authority snapshot. It must not receive APP-01 hidden chain-of-thought, self-justifying rationale or raw secrets. Independent model/prompt context and where configured model/provider diversity reduce correlated self-certification risk.

## 15. Blocking governance gates

APP-03 must independently evaluate:
1. current opportunity eligibility and deadline;
2. exact alignment with approved STR-02 ask and contribution modality;
3. required field completeness and portal constraints;
4. factual support and contradiction status;
5. budget/request arithmetic and cross-field consistency;
6. correct tenant/entity/account/program/cycle;
7. document identity, version, sensitivity and relevance;
8. duplicate/previous submission risk;
9. automation permission and portal-origin integrity;
10. terms acceptance authority;
11. certifications, signatures, personal-knowledge statements and legal representations;
12. tenant submission delegation and monetary/quantity thresholds;
13. reputational/compliance risk;
14. unresolved human questions;
15. evidence sufficient to prove exactly what will be submitted.

Any unknown on a blocking dimension yields REVISE, BLOCK or HUMAN_REQUIRED—not optimistic approval.

## 16. Decision semantics

- `APPROVE`: exact candidate hash may receive a one-time submit capability, subject to expiry and unchanged portal/policy state.
- `REVISE`: typed findings identify fields/documents/rules requiring a new candidate version; old approval cannot carry forward.
- `HUMAN_REQUIRED`: candidate may be otherwise valid but a human-only authority class exists. Human resolution must be explicit and audit-linked.
- `BLOCK`: candidate violates policy, eligibility, duplicate, evidence, security or other non-waivable gate.

APP-03 cannot approve a policy exception, lower an evidence threshold, reinterpret a human-only signature as ordinary consent, or approve a candidate after a material portal/policy change without re-review.

## 17. Delegations and reviewers

APP-03 may request BEN-KNW-03 verification, BEN-QLF-02/04/05 revalidation, BEN-STR-02 ask confirmation, BEN-SUP-05 independent red-team review for high-risk cases, and PIL-SVC-29 human authorization. It may query PIL-SVC-42/43/40 for deterministic validation, authority and duplicate/effect state. Delegation cannot transform APP-03 into content editor.

## 18. Submission capability token

An APPROVE decision does not itself mutate the portal. The authorization service mints a single-use token only if decision, candidate hash, portal origin, account, policy snapshot, tenant delegation and expiry still match. Any candidate mutation, policy update, account change, portal drift over threshold or token expiry invalidates the token and requires re-review.

## 19. Agent-specific acceptance tests

Blocking cases: fabricated but plausible narrative; mismatched EIN/name; changed ask amount; budget arithmetic inconsistency; expired eligibility evidence; stale W-9; wrong tenant document; duplicate prior application; human-only certification; ambiguous electronic signature; terms with new indemnity/commitment; unauthorized bank document; portal origin change; candidate changed after approval; approval replay; low-risk valid candidate; and intentional abstention. False approvals on blocking cases are release-stopping defects.
