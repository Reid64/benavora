# TAR-GOV-001 — Tarritrix Enterprise Engineering Constitution
Version: 1.0.0-draft
Authority: Constitutional
Status: Draft for ratification
Canonical tenant key: `client_id`

## 1. Purpose
This constitution governs every Tarritrix requirement, architecture decision, agent, tool, API, database change, workflow, implementation task, test, deployment, repair, and learned behavior. Lower-order artifacts may strengthen these rules but may not weaken or contradict them.

## 2. Authority order
When artifacts conflict, the higher artifact controls:
1. Enterprise Engineering Constitution
2. Agentic Autonomy & Governance Standard
3. Ratified Architecture Decision Records
4. Enterprise Transformation PRD
5. Authoritative Target System Architecture
6. Security / tenant / policy specifications
7. Contract Registry
8. Agent and tool specifications
9. Implementation specifications and migration plans
10. Forge execution units / Q-YAML
11. Session instructions and ad-hoc prompts
12. Existing code and historical prose

Existing code is evidence of the as-built system, not authority over ratified target architecture.

## 3. Constitutional engineering laws
### C-01 — Architecture before implementation
No material implementation begins until its governing requirements, ownership, interfaces, data boundaries, failure behavior, tests, and rollback conditions are specified.

### C-02 — Evidence before completion
No feature, agent, migration, repair, or deployment is complete because code exists or a build passes. Completion requires the applicable acceptance evidence.

### C-03 — Tenant isolation is invariant
Every multi-tenant operation is bound to an authenticated and authorized `client_id`. Privileged code may not trust a tenant identifier supplied only by an untrusted request body. Missing or ambiguous tenant context fails closed.

### C-04 — Agents decide; tools execute
Reasoning, planning, prioritization, arbitration, and uncertainty management belong to agents. Stable deterministic operations remain typed tools/services. Agentization may not convert reliable deterministic logic into probabilistic logic without a documented reason.

### C-05 — Authority cannot self-expand
An agent, tool, workflow, model, or implementation session cannot grant itself additional permissions, autonomy, budget, scope, or policy exemptions.

### C-06 — Consequential actions are governed
External mutations, publishing, destructive operations, credential use, billing-impacting actions, schema changes, production deployments, and policy-sensitive actions require declared risk classification, authorization, idempotency where possible, audit evidence, and rollback/compensation behavior.

### C-07 — Independent validation
A consequential producer may not be the sole validator of its own output. Validation must use independent rules, tests, evidence, or a separate evaluator.

### C-08 — Durable state over session memory
Mission, workflow, approval, execution, learning, repair, and handoff state must survive process/session loss. Chat context and model memory are never authoritative system state.

### C-09 — Contracts over implicit coupling
Agent-to-agent, component-to-component, API, event, tool, and data interactions use versioned typed contracts. Hidden coupling, undocumented payloads, and inferred field semantics are prohibited.

### C-10 — Reversibility by design
Changes must be reversible where technically possible. Irreversible actions require elevated risk classification and explicit authorization.

### C-11 — Observability is part of functionality
A production capability is incomplete without sufficient logs, metrics, traces/events, audit attribution, error classification, and evidence to determine what happened and why.

### C-12 — Learning is governed change
Observed correlations, model conclusions, experiments, and self-generated procedures are hypotheses until independently evaluated. No learned behavior is promoted to production policy without provenance, measurable evidence, versioning, approval appropriate to risk, and rollback.

### C-13 — Self-healing is bounded
Self-healing may detect, diagnose, propose, test, canary, roll back, and automatically repair only within explicitly authorized repair classes. It may never bypass governance to “fix” a system.

### C-14 — Security fails closed
Authentication, authorization, tenant resolution, policy evaluation, secrets access, and validation failures default to denial. Security-critical failures may not be silently swallowed.

### C-15 — No fabricated production truth
Production decisions and claims must be grounded in real system data or identified external evidence. Mock, fixture, synthetic, or inferred data cannot masquerade as production truth.

### C-16 — Commercial modularity without premature infrastructure fragmentation
Monetizable domains must have explicit ownership, contracts, data boundaries, and extractability. They do not require separate repositories or databases unless justified by scale, security, compliance, or operational isolation.

### C-17 — Change traceability
Every material change traces to a requirement/defect/decision, implementation unit, verification evidence, and resulting build state.

### C-18 — Honest incompleteness
Partial implementation, failed verification, unresolved ambiguity, or missing evidence must be reported as such. Passing superficial gates may not be used to claim completion.

## 4. Tarritrix Six Laws — preserved and strengthened
The repository's existing Six Laws remain binding:
1. SCHEMA
2. API
3. UI
4. DATA
5. WIRING
6. VERIFICATION

For the autonomous platform, each law becomes machine-testable wherever possible. “Human verification” remains required where the governing acceptance contract explicitly requires real-browser/live confirmation; automation supplements but does not falsify that evidence.

## 5. Mandatory artifact declaration
Every implementation-authoritative artifact must declare:
- artifact ID and version
- authority level
- owner/domain
- dependencies
- requirements satisfied
- affected files/components
- data/contracts touched
- security/tenant implications
- failure modes
- verification suite
- rollback/compensation
- evidence required
- Definition of Done

## 6. Prohibited implementation behavior
- inventing tables, columns, routes, APIs, credentials, or capabilities
- accepting privileged `client_id` solely from untrusted payloads
- direct production schema mutation outside versioned migrations
- silent scope reduction
- placeholder/stub completion claims
- disabling tests or governance gates to obtain a pass
- broad service-role access without tenant predicates and authorization
- self-approval of high-risk agent actions
- unversioned breaking contracts
- uncontrolled recursive prompt/policy mutation
- production self-modification without isolated verification and authorized promotion
- undocumented cross-domain writes

## 7. Definition of constitutional compliance
An artifact passes constitutional review only when:
- no rule above is contradicted;
- all applicable requirements have objective verification;
- authority and tenant boundaries are explicit;
- rollback/compensation is specified for consequential change;
- unresolved conflicts are escalated rather than guessed.

## 8. Amendment
Constitutional amendments require an ADR describing the reason, affected guarantees, migration impact, backward compatibility, verification plan, and rollback. A lower-level prompt cannot amend this constitution.
