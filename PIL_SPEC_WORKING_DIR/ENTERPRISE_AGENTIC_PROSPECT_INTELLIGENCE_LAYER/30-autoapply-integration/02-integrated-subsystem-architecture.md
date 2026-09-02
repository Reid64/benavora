# Benavora AutoApply Integrated Subsystem Architecture

**Architecture ID:** PIL-AUTOAPPLY-ARCH-001  
**Version:** 1.0.0

## 1. Purpose and boundary

AutoApply is the execution arm of the Enterprise Agentic Prospect Intelligence Layer. It never re-researches a corporation merely because an application exists. It consumes a versioned, evidence-qualified `ContributionOpportunity` and a tenant-authorized nonprofit knowledge profile. If the opportunity becomes materially stale or contradictory, it routes back to the appropriate PIL owner rather than creating shadow truth.

## 2. Components

### Reasoning
- BEN-APP-01 Corporate Application Planning & Execution.
- BEN-APP-02 Portal Exception Diagnosis & Recovery.
- BEN-APP-03 Application Submission Governance.

### Deterministic services added
- PIL-SVC-31 Browser Execution Sandbox & Broker.
- PIL-SVC-32 Portal Extraction, Semantic Model & Drift Detector.
- PIL-SVC-33 Application Credential & Secret Vault.
- PIL-SVC-34 Portal Account, Authentication & Session Manager.
- PIL-SVC-35 Scoped Application Mailbox & Confirmation Correlator.
- PIL-SVC-36 Tenant Application Document Catalog & Secure Object Store.
- PIL-SVC-37 Document Assembly, Conversion & Validation Service.
- PIL-SVC-38 Form Mutation, Upload & Submission Effect Service.
- PIL-SVC-39 Application Case Ledger & State Projection Store.
- PIL-SVC-40 Application Idempotency, Lease & Reconciliation Service.
- PIL-SVC-41 Portal Change Canary & Compatibility Registry.
- PIL-SVC-42 Application Validation Engine.
- PIL-SVC-43 Attestation, Signature & Delegated-Authority Registry.
- PIL-SVC-44 Application CRM/Graph Synchronization Projection.
- PIL-SVC-45 Application Communications Correlator.
- PIL-SVC-46 Award, Fulfillment & Reporting Obligation Tracker.

Existing PIL-SVC-01..30 remain authoritative for identity, tenancy, authorization, PEP, workflow, queue/eventing, connector/search, graph/evidence/audit, model, cost, rate limiting, observability, evaluation, human review and configuration.

## 3. Application Case aggregate

`ApplicationCase.v1` is the authoritative execution aggregate. It references rather than copies canonical prospect/opportunity truth.

Required identity: `application_case_id`, `tenant_id`, `opportunity_id`, `canonical_funder_id`, `program_id`, `application_cycle_id`, `contribution_type`, `request_strategy_ref`, `policy_snapshot_id`, `workflow_version`, `created_at`.

Required execution state: current state/version, account ref, session ref, portal-model ref/version, application-plan version, candidate submission version, document manifest, unresolved questions, human gates, deadline, idempotency fingerprint, submission effect state, confirmation evidence refs, communications and fulfillment refs.

## 4. State machines

### Application case
`INTAKE_PENDING → INTAKE_ACCEPTED → ACCOUNT_RESOLUTION → PORTAL_DISCOVERY → APPLICATION_MODEL_READY → PLANNING → DRAFTING_EXECUTION → VALIDATING → GOVERNANCE_REVIEW → READY_TO_SUBMIT → SUBMITTING → SUBMISSION_RECONCILIATION → SUBMITTED_CONFIRMED → UNDER_REVIEW → APPROVED|PARTIALLY_APPROVED|DECLINED|WITHDRAWN → FULFILLMENT|REPORTING_REQUIRED|CLOSED → REAPPLICATION_ELIGIBLE`.

Side states: `WAITING_HUMAN`, `WAITING_DOCUMENT`, `WAITING_EXTERNAL`, `EXCEPTION_DIAGNOSIS`, `SECURITY_QUARANTINE`, `POLICY_BLOCKED`, `DEADLINE_EXPIRED`, `FAILED_TERMINAL`.

### Portal account
`UNKNOWN → EXISTING_ACCOUNT_CHECK → REGISTRATION_REQUIRED|ACCOUNT_FOUND → REGISTRATION_IN_PROGRESS → EMAIL_CONFIRMATION_PENDING → ACTIVE → AUTHENTICATED`, with `MFA_REQUIRED`, `LOCKED`, `RESET_REQUIRED`, `DISABLED`, `TERMINAL` side states.

### Submission effect
`NOT_ATTEMPTED → MUTATION_AUTHORIZED → SUBMIT_CLICKED → EFFECT_UNKNOWN|CONFIRMED|REJECTED`. `EFFECT_UNKNOWN` must reconcile before any additional submit action.

## 5. Closed-loop workflow

1. `OpportunityQualified.v2` arrives with evidence and readiness package.
2. Intake validates tenant, window, policy, duplicate fingerprint, opportunity version and minimum evidence.
3. APP-01 observes case and plans account/application path.
4. Account manager checks existing authorized account before registration.
5. Registration terms are parsed as untrusted data; PEP and APP-03/human gate apply where terms constitute consequential acceptance.
6. Scoped mailbox correlates confirmation using case-specific token and sender/origin validation.
7. Portal extractor produces immutable page snapshot + normalized `ApplicationModel.v1` with confidence and unknowns.
8. APP-01 generates `ApplicationPlan.v1`: field-by-field source, transformation, attachment, validation and human-gate plan.
9. Browser/form services execute reversible steps; every field mutation produces a `FieldMutationReceipt` and provenance link.
10. APP-02 is invoked only when normal bounded repair fails or portal semantics materially drift.
11. Application validation engine independently checks deterministic constraints; BEN-KNW-03/QLF agents resolve factual/eligibility uncertainty.
12. APP-03 receives a frozen candidate package through an independent context channel and returns APPROVE, BLOCK, REVISE, or HUMAN_REQUIRED.
13. If approved and delegated, APP-01 requests a one-time submission capability token bound to candidate hash, portal origin and expiry.
14. Submit service performs exactly one authorized effect and immediately records evidence.
15. If effect is uncertain, reconciliation inspects portal history/confirmation/email before any retry.
16. Confirmed submission emits immutable evidence bundle and synchronizes CRM/graph projections.
17. Communications/fulfillment are correlated to the case; new factual or strategic questions route to PIL/APP reasoning owners.
18. Outcome signal is quarantined and evaluated by BEN-OPS-01 before influencing future behavior.

## 6. API boundary

Northbound APIs expose inspect/create-from-qualified-opportunity/pause/resume/cancel/human-resolution operations. No API accepts arbitrary tenant_id as authority; authenticated identity determines tenant and payload tenant values must match.

Critical commands require `Idempotency-Key`, `If-Match` aggregate version, policy snapshot and caller capability. Submission additionally requires `submission_governance_decision_id`, candidate content hash and one-time authority token.

## 7. Eventing

All events use `PIL_EventEnvelope.v2` with `event_id`, `event_type`, `schema_version`, `tenant_id`, `aggregate_id`, `aggregate_version`, `correlation_id`, `causation_id`, `trace_id`, `actor`, `policy_snapshot_id`, `occurred_at`, `data_classification`, and payload hash.

Required events are defined in `04-events-and-contracts.yaml`. Consumers implement inbox dedupe and producers transactional outbox.

## 8. Browser security

- Ephemeral per-case browser worker; no cross-tenant cookie/profile reuse.
- Egress allowlist bound to approved portal origins and explicitly validated redirect targets.
- DNS rebinding/private-network/metadata service protection.
- No arbitrary downloads into model/runtime; downloads are quarantined, scanned, typed and content-disarmed where applicable.
- Browser page text is data, never instructions. Tool use is selected from system-authorized capabilities only.
- Clipboard, local filesystem, browser extension, shell, developer protocol and cross-origin storage access denied unless a narrowly scoped service requires it.
- Screenshots are classified artifacts and must be redacted or omitted if secrets/sensitive data could appear.
- CAPTCHA/anti-bot/human verification triggers `WAITING_HUMAN`; no bypass or concealment.

## 9. Email safety

The mailbox service receives only an explicitly authorized mailbox/folder/label or provider query scope. It stores message metadata and minimum required excerpts, not unrelated inbox content. Links are not opened by the mail listener. It produces a candidate confirmation action containing sender, authenticated headers where available, destination chain preview, expiry, correlation confidence and risk flags. Browser execution opens only a PEP-approved link bound to the case.

## 10. Evidence and provenance

Every submitted answer must be reconstructable through `AnswerProvenance.v1`: portal field locator and semantic field id; final value hash; value type; source fact/document refs; transformation/narrative template/model version; human edits/approvals; verification decision; timestamps; candidate submission version. Submitted documents are referenced by immutable content digest and catalog version.

## 11. Policy as code

Blocking policy families:
- `AUTO-ORIGIN`: allowed portal/origin/redirect policy.
- `AUTO-AUTOMATION`: whether automated interaction is allowed for the site/program.
- `AUTO-TERMS`: acceptance authority and prohibited terms.
- `AUTO-ATTEST`: certifications/personal knowledge/signature rules.
- `AUTO-DATA`: allowed data/document classifications per portal.
- `AUTO-ASK`: tenant amount/quantity/contribution limits and required approvals.
- `AUTO-DEADLINE`: window and timezone rules.
- `AUTO-SUBMIT`: tenant class-level submission delegation and separation of duties.
- `AUTO-COMMS`: response/commitment authority.
- `AUTO-LEARN`: outcome-signal quarantine and learning eligibility.

## 12. Observability

Application-specific SLIs: qualified-to-intake latency; deadline-risk queue age; portal-model completeness; field provenance completeness; save/resume success; duplicate mutation rate; uncertain-effect rate; submission confirmation capture; human-gate aging; exception diagnosis success; portal drift detection lead time; cross-tenant denial count; secret exposure count; cost per completed application; applications per portal/version; approval/decline outcome calibration.

No numerical SLO is invented at specification time. SLOs must be set from measured business requirements and load testing.
