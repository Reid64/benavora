# Benavora Enterprise Agentic Prospect Intelligence Layer — Complete Gap Analysis and Integrated AutoApply Extension

**Release:** 43 / Integrated Architecture v3.0.0  
**Status:** FINAL_SPECIFICATION_PENDING_IMPLEMENTATION_AND_EXECUTED_EVIDENCE  
**Canonical pre-extension PIL fleet:** 44 genuine agents  
**New irreducible AutoApply reasoning agents:** 3  
**Canonical integrated fleet after this release:** 47 genuine agents  
**Deterministic service count after this release:** 46

## 1. Executive finding

The existing package is a strong, internally disciplined **prospect-intelligence specification**: it correctly separates agents from deterministic services; establishes tenant isolation, evidence/provenance, policy, durable workflow, recovery, evaluation and release gates; and truthfully does not claim runtime implementation or production readiness. Its largest remaining gap is not a defect in the 44-agent PIL fleet itself. It is the intentionally deferred downstream Corporate Funding, Grant, and In-Kind Contribution Application Automation System described in the AutoApply handoff.

The integration therefore MUST preserve the 44-agent PIL as the authoritative intelligence, qualification, prioritization, relationship and strategic reasoning layer, and append a bounded execution subsystem. The subsystem converts a qualified `ContributionOpportunity` into a governed application lifecycle and returns execution outcomes to the PIL.

Exactly **three new genuine agents** are justified after capability-overlap analysis:

1. **BEN-APP-01 Corporate Application Planning & Execution Agent** — owns the durable application goal, interprets application requirements, constructs and adaptively executes the field/document plan, and coordinates deterministic portal/email/browser services.
2. **BEN-APP-02 Portal Exception Diagnosis & Recovery Agent** — owns diagnosis and replanning when the application path departs from the normal execution model because of portal mutation, ambiguous state, broken sessions, conflicting instructions, unexpected workflows or recoverable external failure.
3. **BEN-APP-03 Application Submission Governance Agent** — independently decides whether a completed application is authorized and safe to submit, enforces separation of duties, and blocks or escalates certifications/signatures/terms/representations outside delegated authority.

No additional agents are created for account creation, mailbox listening, confirmation links, credentials, browser interaction, screenshots, uploads, queues, retries, CRM synchronization, or monitoring because those are deterministic execution capabilities.

## 2. Authoritative 44-vs-45 reconciliation

The original binding registry and v2 completion registry establish 44 agents: 6 supervisory + 8 discovery + 10 intelligence + 6 relationship + 5 qualification + 4 strategy + 4 knowledge-integrity + 1 operations/evaluation/learning = 44. References to 45 were presentation-level/noncanonical and did not identify a valid additional goal-owning agent. Release 43 preserves that historical conclusion.

Release 43 then appends three new application-execution agents under a new `application_execution` family. The new authoritative integrated count is **47**, not 48. The count transition is explicit: `44 PIL + 3 AutoApply = 47 integrated agents`.

## 3. Gap inventory and remediation

| Gap | Severity | Existing coverage | Remediation in Release 43 |
|---|---:|---|---|
| Downstream application execution absent | Critical | Handoff only | Add 3 agents, 16 deterministic services, contracts, workflows, policies and integration specs |
| No canonical application aggregate/schema | Critical | Generic graph/evidence schemas | Add `ApplicationCase`, `PortalAccount`, `ApplicationModel`, `FieldAnswer`, `SubmissionDecision`, `FulfillmentRecord` v1 |
| No application lifecycle state machine | Critical | General workflow architecture | Add durable multi-aggregate state machines and compensation rules |
| No portal/browser trust-boundary design | Critical | Generic web retrieval controls | Add browser broker isolation, origin allowlisting, download quarantine, navigation policy and anti-injection boundary |
| No dedicated mailbox safety architecture | Critical | Generic connector/policy controls | Add scoped mailbox service, correlation tokens, sender/domain/link validation and minimum-content retention |
| Secrets/session lifecycle not specialized for portals | High | General secret prohibition | Add credential vault, session broker, rotation/revocation, log/prompt redaction and tenant/portal namespace |
| No portal account uniqueness/idempotency model | High | Generic idempotency | Add `(tenant, portal, org)` uniqueness, account fingerprint and durable registration saga |
| No field-level answer provenance | Critical | Claim/evidence lineage | Add `AnswerProvenance` linking field → fact/narrative → source/version → transformer → reviewer |
| No application document assembly gate | High | Document retrieval only | Add tenant document catalog, sensitivity labels, malware scanning, version/date/file-size validation and upload manifest |
| No independent submission governance | Critical | Critic and policy controls | Add BEN-APP-03 with hard separation-of-duties and human authority matrix |
| No portal exception owner | High | General recovery investigator | BEN-SUP-06 owns fleet/runtime recovery; BEN-APP-02 owns application/portal semantic diagnosis; explicit handoff prevents overlap |
| No communication-to-application correlation | High | Generic connectors | Add scoped Application Communications service and correlation contract |
| No award/fulfillment lifecycle | High | CRM tracking concept | Add fulfillment states for cash, product, vehicle, material, service, logistics and reporting obligations |
| No application-specific policy-as-code | Critical | General PEP | Add automation-permission, terms, attestation, signature, amount, document, geography, deadline and tenant-delegation policies |
| No portal change detection | High | Mentioned as requirement | Add DOM/semantic fingerprinting, canary extraction, drift thresholds and forced exception/review path |
| No application-specific SLO/SLI vocabulary | Medium | Generic observability | Add queue age, deadline risk, resume success, duplicate effect, provenance completeness and confirmation capture metrics |
| No application adversarial corpus | Critical | General red team | Add prompt-injection web/email/file corpus, malicious redirect, credential phishing, tenant collision, replay and poisoned-outcome tests |
| No execution feedback contract to PIL | High | Handoff only | Add versioned `ApplicationOutcomeLearningSignal.v1` with quarantine/evaluation before learning adoption |
| Ambiguous CRM system-of-record role | Medium | CRM connector is noncanonical | Clarify graph/application ledger are canonical; CRM remains synchronized projection |
| Completion language could be misread as implemented system | Medium | README truthfully qualifies it | Preserve status and strengthen release manifest: specification complete ≠ code/test/production complete |

## 4. Ownership decision: existing agent reuse versus extension

### Existing PIL agents retained as authoritative owners

- `BEN-DIS-04` discovers corporate giving/community programs and contribution paths.
- `BEN-DIS-06` and `BEN-DIS-07` expand geography/cause-aligned opportunity discovery.
- `BEN-KNW-02` resolves corporate/brand/foundation/portal entities.
- `BEN-KNW-03` verifies opportunity evidence and provenance.
- `BEN-KNW-04` investigates contradiction/freshness.
- `BEN-QLF-01/02/04/05` own mission fit, eligibility, opportunity qualification and readiness.
- `BEN-REL-03/04/06` own corporate relationship and overlap/strength reasoning.
- `BEN-STR-02` selects the best ask; `BEN-STR-04` supplies next-best-action strategy.
- `BEN-SUP-01/03/04/05/06` retain orchestration, cross-agent planning, portfolio allocation, independent criticism and fleet/research recovery.
- `BEN-OPS-01` owns validated fleet learning and performance optimization.

### Existing agents extended by contract, not by mission expansion

`BEN-DIS-04`, `BEN-QLF-02`, `BEN-QLF-04`, `BEN-QLF-05`, `BEN-STR-02`, `BEN-KNW-03`, `BEN-KNW-04`, `BEN-SUP-01`, `BEN-SUP-05`, `BEN-SUP-06`, and `BEN-OPS-01` receive new typed inputs/outputs and events but do not inherit browser mechanics or application submission authority.

## 5. Why exactly three new agents

The agent qualification law requires a bounded goal, contextual reasoning, planning, adaptive tool selection, result evaluation, replanning/recovery, durable memory/state, measurable success criteria and independent authority. Applying that test:

- **Application planning/execution** qualifies because a portal is an open-world, multi-step goal where requirements and conditional branches are discovered progressively and the agent must continuously reconcile verified nonprofit knowledge, application semantics, documents, deadlines and portal state.
- **Portal exception diagnosis/recovery** qualifies because abnormal workflows require causal diagnosis among competing hypotheses, controlled experiments, rollback/resume reasoning, portal-change interpretation and selection among repair strategies. A retry engine cannot safely own that reasoning.
- **Submission governance** qualifies because the action is consequential and requires an independent decision boundary. It must evaluate facts, eligibility, internal consistency, policy, delegation, attestations, terms and duplicate risk without sharing the executor’s self-certification context.

All other functions are deterministic capabilities. A fourth “communications agent” is not justified because classification/correlation can be deterministic + model-assisted under schemas, while strategic response decisions route to BEN-APP-01 or existing PIL strategy/human review. A separate “learning agent” would duplicate BEN-OPS-01.

## 6. Integrated architecture

The system is divided into five planes:

1. **Intelligence plane (PIL):** discovers, resolves, verifies, qualifies, prioritizes and selects the ask.
2. **Application reasoning plane:** BEN-APP-01 plans/executes; BEN-APP-02 diagnoses exceptions; BEN-APP-03 independently authorizes submission.
3. **Deterministic execution plane:** browser, portal extraction/modeling, account/session, mailbox, secret, documents, uploads, workflow, idempotency and communications services.
4. **Trust/governance plane:** identity, tenant isolation, RBAC/ABAC, PEP, consent, audit, evidence, cost, rate limits, human review and policy bundles.
5. **Learning/observability plane:** application outcome telemetry → quarantine → BEN-OPS-01 evaluation → controlled proposal → canary → adoption/rollback.

Canonical flow:

`PIL OpportunityQualified → AutoApply Intake Gate → Account/Auth Saga → Portal Model → Application Plan → Fact/Document Resolution → Browser Execution → Independent Submission Governance → Submit or Escalate → Confirmation/Evidence → CRM/Graph Projection → Communications/Fulfillment → Outcome Signal → BEN-OPS-01 learning pipeline`.

## 7. Systems of record

- **Prospect/entity/opportunity truth:** PIL Knowledge Graph Store (`PIL-SVC-21`).
- **Source evidence:** Evidence and Source Snapshot Ledger (`PIL-SVC-22`).
- **Application execution truth:** new Application Case Ledger (`PIL-SVC-39`).
- **Credentials/secrets:** new Application Credential Vault (`PIL-SVC-33`); only opaque refs leave the vault.
- **Documents:** new Tenant Application Document Catalog (`PIL-SVC-36`) backed by tenant-isolated object storage.
- **Policy decisions:** existing PEP + new application policy bundle versions.
- **Audit:** existing append-only Audit Ledger (`PIL-SVC-23`).
- **CRM:** projection/synchronization only; never authoritative for contested identity, eligibility, evidence or submitted-content truth.

## 8. Trust boundaries

Every website, portal page, email, link, attachment and third-party payload is untrusted. Source content can supply data but can never issue runtime instructions, change tool permissions, request secrets, redefine tenant scope, alter policy, or grant itself authority. Browser workers run in isolated ephemeral sandboxes with egress restricted to policy-approved origins. Downloads enter quarantine and are scanned before any parser/model receives content. Confirmation links must pass exact tenant/workflow correlation, domain/origin checks, redirect-chain policy and expiry validation.

## 9. Data minimization and tenant isolation

Every application aggregate and event carries `tenant_id`, `application_case_id`, `opportunity_id`, `correlation_id`, schema version and policy snapshot. Tenant context is derived from authenticated workload identity. Database RLS/partitioning, object-store prefixes/KMS keys, secret namespaces, queues, caches, indexes, model-context assembly and exported evidence all enforce tenant separation. No cross-tenant learning uses raw facts or documents; only approved de-identified aggregate metrics may cross tenant boundaries under policy.

## 10. Autonomy model

- **A0:** observe only.
- **A1:** recommend/draft.
- **A2:** perform reversible low-risk operations under policy (save draft, retrieve approved files, navigate permitted portal paths).
- **A3:** perform bounded external mutations expressly delegated (account creation, update profile, request replacement confirmation, submit only if tenant policy allows and BEN-APP-03 approves).
- **A4/A5:** prohibited for application submission by default. Any future expansion requires constitutional change and explicit tenant delegation.

Human action is mandatory for personal-knowledge certifications, wet/electronic signatures without delegated authority, MFA/human verification, CAPTCHA, ambiguous legal terms, banking/payment changes, material commitments, unsupported facts, exceptions to policy, or tenant-specified approval classes.

## 11. Duplicate prevention

Three independent idempotency layers are mandatory:

1. Opportunity-level fingerprint: `(tenant, canonical_funder, program, cycle/window, contribution_type, beneficiary/program)`.
2. Application-case uniqueness: one active case per approved opportunity/cycle unless an explicit supersession relationship exists.
3. Submission effect key: portal + account + program + cycle + case + content hash. A successful or uncertain submission blocks automatic resubmission until confirmation/reconciliation resolves state.

## 12. Failure model

Failures are classified as transient transport, rate/capacity, portal validation, auth/session, portal semantic drift, evidence/data ambiguity, document failure, policy/authority, duplicate/concurrency, uncertain external effect, hostile/security, tenant isolation, state corruption, deadline terminal, or external terminal. An **uncertain external effect** after clicking submit is never retried blindly; the workflow enters `SUBMISSION_RECONCILIATION` and inspects confirmation page/email/portal history before any new mutation.

## 13. Production gate

Release 43 completes the **integrated specification**, not the runtime. Production readiness remains blocked until schemas, migrations, OpenAPI/events, policies, durable workflows, secrets, browser isolation, email controls, test corpus, chaos/recovery drills, red-team results and G0–G5 evidence are implemented and independently scored ≥95/100 with no blocking security/tenancy/authority deficiency.
