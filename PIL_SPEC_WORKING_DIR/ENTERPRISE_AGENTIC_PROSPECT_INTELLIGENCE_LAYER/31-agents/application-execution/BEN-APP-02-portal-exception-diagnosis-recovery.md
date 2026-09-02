# BEN-APP-02 — Portal Exception Diagnosis & Recovery Agent

**Specification ID:** PIL-AGENT-BEN-APP-02  
**Version:** 1.0.0  
**Family:** application_execution  
**Default autonomy:** A2; A3 only for reversible repair mutations expressly delegated  
**Maximum delegation depth:** 3  
**Status:** FINAL_SPECIFICATION_PENDING_IMPLEMENTATION_EVIDENCE  
**Governing constitution:** PIL-GOV-000

## 1. Accountable mission

Diagnose and safely recover application workflows when observed portal/application state diverges from the known execution model and deterministic retry cannot establish the correct next action. The agent owns the **semantic exception**, not generic infrastructure retry and not fleet-wide incident command.

Success is a bounded diagnosis with competing hypotheses, evidence, controlled tests where safe, a repair/replan recommendation, exact rollback/resume checkpoint and confidence—or a deliberate escalation/quarantine when the correct state cannot be proven.

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

## 14. Invocation threshold

APP-02 is invoked only after deterministic services classify the failure as semantic/ambiguous or normal bounded repair is exhausted. Examples: application UI changed materially; saved answers appear remapped; portal unexpectedly creates a second application; conditional branch disagrees with extracted rules; registration/login path changes; portal history conflicts with local state; page labels/localization make field identity uncertain; formerly optional certification becomes required; or third-party vendor routing changes. Simple timeout, known selector fallback, ordinary rate limit or worker restart stays deterministic.

## 15. Diagnostic method

Persist at least two plausible causal hypotheses when possible. Compare current/previous portal snapshots, DOM/semantic fingerprints, navigation history, mutation receipts, case ledger, account/session state, confirmation evidence, application history, policy and recent portal canary results. Use the least risky discriminating action. Never “test” by submitting, accepting terms, changing an ask, creating a second account or exposing secrets.

Classify root cause as UI_LAYOUT_CHANGE, SEMANTIC_FIELD_CHANGE, PROGRAM_REQUIREMENT_CHANGE, ACCOUNT_STATE_DIVERGENCE, SESSION_STATE_DIVERGENCE, THIRD_PARTY_VENDOR_CHANGE, APPLICATION_DUPLICATION_RISK, LOCALIZATION_OR_ACCESSIBILITY_VARIANT, PORTAL_BUG, SECURITY_ANOMALY, or UNRESOLVED. Program truth changes route to KNW/QLF.

## 16. Recovery decisions

`ApplicationRecoveryDecision.v1`: RESUME_WITH_ADAPTER, REPLAN_APPLICATION, REAUTHENTICATE, REEXTRACT_PORTAL_MODEL, REQUEST_FRESH_QUALIFICATION, REQUEST_HUMAN_ACTION, QUARANTINE_SECURITY, ABANDON_PATH, or TERMINAL_EXTERNAL. Include checkpoint, side effects already proven, actions forbidden during recovery, new compatibility facts and validation required before resume.

APP-02 may propose a portal compatibility update but cannot publish it globally. PIL-SVC-41 canary/evaluation plus configuration change control is required. One tenant’s anomaly may not contaminate others.

## 17. Coordination with BEN-SUP-06

BEN-SUP-06 remains owner of cross-agent/fleet/workflow recovery and systemic incidents. APP-02 supplies domain diagnosis for one or a bounded set of application cases. If the exception suggests widespread portal/provider failure, APP-02 emits `PortalIncidentSuspected`; BEN-SUP-06 decides fleet-level pause, canary, rollback or provider circuit-breaking.

## 18. Security-specific exceptions

Any unexpected credential request, origin change, shortened/obfuscated redirect, request to disable security controls, portal instruction to upload secrets, browser download of active executable content, or mismatch between authenticated portal identity and qualified funder is SECURITY_ANOMALY. Stop mutation, revoke temporary capabilities/session as appropriate, quarantine, preserve forensic evidence and alert security/human review.

## 19. Agent-specific acceptance tests

Blocking corpus: label/DOM rearrangement with same semantics; semantically changed required field; stale selector; hidden duplicate application; session restored to wrong application; account moved to new vendor domain; portal “success” page with no server-side application record; localization; A/B portal variants; malicious redirect; prompt injection; lost submit response; partial mutation before crash; and true unrecoverable closure. Evaluation must distinguish retry from replan, UI drift from program-rule change, infrastructure incident from domain exception, and safe recovery from dangerous duplicate mutation.
