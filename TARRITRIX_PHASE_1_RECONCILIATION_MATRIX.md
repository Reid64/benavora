# Tarritrix Agentic Transformation — Phase 1 Repository Reconciliation Matrix

**Status:** Repository-grounded draft for architectural ratification  
**Source:** `tarritrix-main.zip` supplied by operator  
**Purpose:** Establish exact current-state disposition before defining final autonomous agent inventory.

## 1. Executive determination

Tarritrix should be transformed, not rebuilt. The repository already contains a substantial deterministic execution platform, a reusable agent lifecycle kernel, multi-tenant persistence, operator RBAC, audit logging, GSC integrations, programmatic page generation, validation, indexing, citations, content intelligence, and Forge governance. The principal deficiency is not lack of feature code; it is lack of a true autonomous control plane and inconsistent enforcement of tenant/action boundaries across older and newer code paths.

The governing migration rule is:

> Preserve reliable deterministic execution. Agentize decisions, planning, prioritization, coordination, recovery, experimentation, and learning. Do not convert deterministic functions into LLM calls merely to call them agents.

## 2. Repository baseline

- Next.js 16.2.6 / React 19.2.3 / TypeScript 5.7.3
- Supabase/Postgres persistence with 121 migration files
- 44 `/api/agents/*/trigger` routes
- 43 modern `src/lib/agents/a-*.ts` implementations, plus older implementations under `src/agents/*`
- 167 API route files total
- 134 files under `tests/`
- Existing agent lifecycle: Zod input/output validation, idempotency, retry/backoff, event persistence, cost accounting, standardized error shape
- Existing governance primitives: risk classifier, evidence gate, policy event logging, audit logger, RBAC/permission matrix, user action attribution
- Five Vercel cron schedules currently configured, including drip publishing and daily agent cycle

## 3. Critical findings requiring correction before high-autonomy operation

### P0-1 — Tenant target authorization is inconsistent

Most modern agent trigger routes authenticate an operator and check an action permission, but also accept `client_id` from the request body and then invoke agent code using privileged/service-role database access. The sampled routes do not call `verifyOperatorOwnsClient()` or an equivalent tenant-grant validator before execution. This creates a mismatch between the governance rule that tenant context must be trusted and the actual route implementation.

**Required target:** introduce one canonical `TenantExecutionContext` resolver. A route may receive a requested client identifier as a selector, but it must never become trusted execution context until the authenticated principal's tenant grant is verified. Every downstream agent/service receives only the resolved context.

### P0-2 — Legacy and modern agent implementations coexist

The repository contains both `src/agents/*` and `src/lib/agents/*`. Tests and production routes still import both families. This creates duplicate ownership and divergent lifecycle behavior.

**Required target:** consolidate all agent execution behind one canonical kernel and convert legacy implementations into tools/services or adapters. No domain capability may have two independent authoritative implementations.

### P0-3 — Several older trigger routes do not use the canonical operator context

A-03, A-04, A-05, A-07, A-08 and A-09 use older authentication patterns; A-09 intentionally has a public conversion path and must remain a special case. The remaining operator-only routes must converge on a single authorization contract.

### P0-4 — Existing “agent” classes are primarily bounded executors

`BaseAgent` provides excellent execution mechanics but no mission model, planner, capability discovery, memory strategy, delegation, dynamic workflow construction, outcome evaluator, or replanning loop. Existing agents generally execute a predefined action after a caller decides what should happen.

**Disposition:** KEEP the kernel; NEW BUILD the autonomous control plane above it.

### P0-5 — Existing governance is useful but not yet a closed autonomy loop

Risk classification, evidence gating, policy events, and audit logging exist as separate utilities. They are not yet a mandatory pre-action/post-action envelope for every consequential autonomous action.

**Disposition:** REFACTOR into a unified policy decision point + policy enforcement point used by all agents and tools.

## 4. Core platform migration matrix

| Area | Current evidence | Disposition | Required transformation |
|---|---|---|---|
| Next.js application shell | `src/app/**` | KEEP | Preserve UI/API foundation; add agent-control surfaces rather than rewrite app shell. |
| Supabase data layer | `supabase/migrations/**`, `src/lib/supabase/**` | KEEP + REFACTOR | Preserve schema where valid; add autonomy/memory/workflow/policy tables through versioned migrations only. |
| Tenant model | `clients`, `client_id`, tenant helpers | KEEP + HARDEN | Canonicalize `client_id`; add resolved tenant execution context and grant validation at every privileged boundary. |
| Modern agent kernel | `src/lib/agents/base-agent.ts` | KEEP + EXTEND | Retain validation/idempotency/retry/event/cost lifecycle; add cancellation, deadlines, policy envelope, trace context, tool-call evidence, checkpoints. |
| Agent events | `src/lib/agents/agent-events.ts` | KEEP + EXTEND | Make events causal/traceable across missions, plans, tool calls, recovery attempts and evaluations. |
| Agent DB client | `src/lib/agents/agent-supabase.ts` | REFACTOR | Remove implicit tenant trust; require resolved execution context or tenant-scoped repository interfaces. |
| Legacy agents | `src/agents/**` | WRAP / MIGRATE / RETIRE | Extract deterministic capabilities as tools; route through canonical kernel; eliminate duplicate ownership. |
| Agent trigger APIs | `src/app/api/agents/**` | REFACTOR | Standard request/response envelope, tenant resolution, authorization, idempotency, error/status mapping, trace IDs. |
| Cron orchestration | `src/app/api/cron/**`, `vercel.json` | WRAP AS TRIGGER | Cron should create missions/signals; autonomous orchestrator decides actions within policy instead of cron hard-coding full sequences. |
| Governance utilities | `src/lib/governance/**` | KEEP + REFACTOR | Unify risk, evidence, policy, approvals, rollback and audit into mandatory action-governance service. |
| RBAC | `src/lib/auth/**` | KEEP + EXTEND | Add agent identities, service principals, tenant grants, action scopes and delegated authority. |
| LLM layer | `src/lib/llm/**` | KEEP + EXTEND | Become model gateway with policy routing, structured output, budgets, fallbacks, eval metadata and prompt/version provenance. |
| Dashboard | `src/app/dashboard/**`, `src/components/dashboard/**` | KEEP + EXTEND | Add mission queue, agent plans, approval inbox, health graph, learning proposals, recovery incidents, evidence views. |
| Client portal | `src/app/portal/**` | KEEP | Preserve client-facing visibility; expose selected autonomous outcomes, not internal chain-of-thought. |
| Tests | `tests/**` | KEEP + EXPAND | Add agent behavioral/eval/chaos/tenant-isolation/tool-contract/recovery tests. |
| Forge governance | `.forge/**`, root governance docs | KEEP + RECONCILE | Use as implementation execution governance after corpus is rewritten into one non-conflicting authority hierarchy. |

## 5. Existing agent disposition matrix

The labels below classify code ownership, not final product naming. Final agent IDs should be assigned only after the target domain model is ratified.

| Existing agent | Current role | Disposition | Target role |
|---|---|---|---|
| A-01 Intake Processor | Client intake | WRAP AS TOOL + AGENTIZE DECISIONS | Deterministic intake normalization tool governed by Client Intelligence/Onboarding agent. |
| A-02 Page Generator | LLM geo/service page generation | REFACTOR | Content Generation executor/tool under Content Strategy agent; no independent campaign authority. |
| A-03 Schema Generator | Structured data | WRAP AS TOOL | Deterministic schema rendering/validation capability. |
| A-04 Map Embed Generator | Map embedding | WRAP AS TOOL | Map asset/embed execution capability, not autonomous strategist. |
| A-05 Page Validator | Publish gates | KEEP + ELEVATE | Independent Content Integrity/Publication Gate agent with veto authority. |
| A-06 Internal Link Builder | Link creation | REFACTOR | Execution tool plus internal-link strategy agent separated. |
| A-07 Sitemap Generator | Sitemap operations | WRAP AS TOOL | Technical SEO executor. |
| A-08 Indexation Tracker | GSC/index status | REFACTOR | Observation tool feeding GSC/Indexation Intelligence agent. |
| A-09 Conversion Handler | Lead/conversion recording | KEEP AS SERVICE | Public deterministic telemetry path; not an autonomous agent. |
| A-10 Content Profile Builder | Brand/content profile | REFACTOR | Knowledge extraction tool feeding Tenant Knowledge agent. |
| A-11 Content Refresh Engine | Content refresh | REFACTOR | Executor under Content Optimization agent with approval/policy gates. |
| A-13 Brand Mention Tracker | Mention monitoring | AGENTIZE | Off-site/entity intelligence observer with autonomous prioritization. |
| A-14 Review Velocity Engine | Review analytics | AGENTIZE | Reputation intelligence; never fabricate or manipulate reviews. |
| A-18 Job Evidence Ingestion | Evidence intake | KEEP + ELEVATE | Evidence/Provenance agent and deterministic ingestion pipeline. |
| A-19 Universal Integration Hub | External integration actions | REFACTOR | Split tool registry/connectors from planning; hub itself should not be a monolithic agent. |
| A-21 Hyperlocal Geographic Engine | Geographic targeting | AGENTIZE | Core Geo Opportunity/Expansion agent with planning authority. |
| A-23 Reputation Intelligence | Reputation analysis | AGENTIZE | Reputation strategy agent. |
| A-24 Competitive Intelligence | Competitor analysis | AGENTIZE | Market/competitive intelligence agent. |
| A-25 AEO Atomic Fact Engine | Answer facts | REFACTOR | Factual knowledge compiler + AEO strategy agent. |
| A-26 Entity Schema Engine | Entity schema | WRAP AS TOOL | Structured entity representation executor. |
| A-27 Voice Search Engine | Voice query optimization | MERGE / AGENTIZE | Merge into Search Experience/AEO domain unless independent commercial module is justified. |
| A-28 Topical Authority Engine | Topic analysis | AGENTIZE | Content/authority strategy agent. |
| A-29 Performance Learning Engine | Learning recommendations | REBUILD AS LEARNING SERVICE | Seed for recursive learning, but needs experiment registry, causal evidence, promotion gates, rollback and policy lifecycle. |
| A-30 Claim Recovery Workflow | Insurance workflow | DOMAIN-SEPARATE | Not core SEO control plane; isolate as optional vertical module. |
| A-32 Content Seed Variation | Content variation | REPLACE | Convert from variation-for-variation's-sake to evidence-based differentiation service. |
| A-33 Schema Scrambler | Schema variation | RETIRE / REPLACE | Canonical schema correctness should outrank artificial scrambling. Replace with schema quality/validation capability. |
| A-34 Image Metadata Randomizer | Metadata variation | RETIRE / REPLACE | Replace with truthful image metadata optimization/provenance tool. |
| A-35 Component Variation Engine | Layout variation | REFACTOR | Controlled UX experimentation tool governed by experiment service. |
| A-36 Internal Link Shuffler | Link-pattern variation | REPLACE | Use intentional graph optimization with measured objectives, not random shuffling. |
| A-37 Publish Cadence Jitter | Publishing timing | REFACTOR | Become policy-aware publishing scheduler using capacity, quality, freshness and campaign need. |
| A-38 HTTP Fingerprint Diffusion | HTTP fingerprint variation | RETIRE | No legitimate autonomous SEO objective requires deliberate fingerprint diffusion. |
| A-39 Link Graph Naturality Engine | Link graph analysis | REFACTOR | Link quality/graph health agent with transparent quality objectives. |
| A-40 External Signal Coordination | Off-site opportunities | AGENTIZE | Authority/PR opportunity planning agent; external mutations policy-gated. |
| A-41 Engagement Quality Engine | Engagement analysis | AGENTIZE | UX/conversion intelligence agent. |
| A-42 Penalty Pattern Detection | Risk detection | ELEVATE | Search Quality/Risk Sentinel with platform-level stop/escalation authority. |
| A-43 Trust Signal Composer | Trust signals | REFACTOR | Evidence-backed trust content tool under reputation/content integrity. |
| A-44 Knowledge Ingestion | Website/client knowledge | ELEVATE | Tenant Knowledge Ingestion agent; source provenance and versioned truth model required. |
| A-45 Backlink Intelligence | Backlink analysis | AGENTIZE | Authority intelligence agent. |
| A-46 Directory Registration | Directory actions | AGENTIZE WITH STRONG GATES | Citation/entity consistency agent using approved directories, idempotency, evidence and external-action approval policy. |
| A-47 LLM Citation Tracker | AI citation observation | AGENTIZE | LLM/AEO visibility intelligence agent. |
| A-49 GSC Intelligence | Search Console operations | AGENTIZE + SPLIT TOOLS | GSC domain supervisor with Search Analytics, Sitemap and URL Inspection tools. |
| A-50 Query Intelligence | Query analysis | AGENTIZE | Search opportunity agent, likely subordinate to GSC/Search Intelligence supervisor. |
| A-51 Page Intelligence | Page analysis | AGENTIZE | Page performance diagnostic agent. |
| A-52 URL Inspection Queue | URL inspection execution | WRAP AS TOOL/SCHEDULER | Quota-aware executor under Indexation/GSC supervisor. |
| A-53 Google Entity Resolution | Entity resolution | AGENTIZE | Entity reconciliation agent feeding knowledge graph. |

## 6. Missing autonomous platform components — NEW BUILD

These are not adequately represented by the existing A-series.

1. **Mission & Goal Manager** — durable tenant objectives, constraints, priorities, deadlines, budgets and completion conditions.
2. **Strategic Orchestrator** — converts objectives/signals into plans; chooses domains/agents; replans after outcomes.
3. **Planner / Plan Compiler** — emits versioned, machine-valid plans with dependencies, preconditions and rollback points.
4. **Capability & Tool Registry** — every callable deterministic capability declares input/output schema, side effects, risk, auth, cost and idempotency.
5. **Agent Registry** — canonical identity, version, domain, authority, tools, models, budget, SLAs/SLOs and lifecycle status.
6. **Durable Workflow/Checkpoint Service** — survives serverless execution boundaries and restarts; tracks mission/step state.
7. **Agent Memory Service** — episodic, semantic, procedural and tenant-scoped memory with provenance and retention policy.
8. **Knowledge Graph / Truth Layer** — typed entities and relationships for tenant, location, service, page, query, GBP, citation, backlink, competitor, signal, lead, experiment and decision.
9. **Policy Decision & Enforcement Service** — mandatory pre-action risk/authority/evidence/quota decision plus post-action verification.
10. **Outcome Evaluator** — evaluates whether an action accomplished its stated objective; cannot rely on agent self-report.
11. **Experimentation Service** — hypothesis, cohort, baseline, intervention, observation window, result, confidence and promotion decision.
12. **Recursive Learning Governor** — converts evidence into proposed policy/strategy updates; requires promotion gates and rollback.
13. **Recovery & Self-Healing Supervisor** — incident detection, diagnosis, safe repair planning, sandbox verification, rollback and escalation.
14. **System/Code Integrity Auditor** — continuously detects broken contracts, schema drift, orphan routes, dead code, dependency divergence, incomplete migrations and test regressions.
15. **Cost & Resource Governor** — per tenant/domain/mission budgets, anomaly detection and model/tool cost controls.
16. **Cross-Agent Arbitration Service** — resolves competing recommendations and resource conflicts deterministically under policy.
17. **Agent Evaluation Harness** — offline and online behavioral evaluations, adversarial tests, regression datasets and promotion gates.
18. **Human Approval/Intervention Queue** — structured approval objects, expiry, evidence, rationale and resumption semantics.

## 7. Canonical request context target

Every privileged execution path should converge on a non-forgeable server-created context similar to:

```ts
interface TenantExecutionContext {
  request_id: string;
  trace_id: string;
  tenant_id: string;          // canonical value maps to existing clients.id / client_id
  principal: {
    type: 'user' | 'agent' | 'system';
    id: string;
    role?: string;
  };
  authority: {
    scopes: string[];
    max_risk_class: number;
    approval_required_above: number;
  };
  trigger: {
    source: 'api' | 'cron' | 'webhook' | 'agent' | 'operator';
    parent_event_id?: string;
    mission_id?: string;
  };
  budgets: {
    cost_usd_remaining?: number;
    tool_calls_remaining?: number;
    deadline_at?: string;
  };
}
```

The caller can request a tenant, but only the server-side resolver can create this context after verifying principal-to-tenant authority.

## 8. API contract normalization target

All non-public agent/control APIs should converge on a single envelope:

```json
{
  "request_id": "uuid",
  "idempotency_key": "string",
  "tenant_selector": { "client_id": "uuid" },
  "operation": "domain.action.v1",
  "input": {}
}
```

Success:

```json
{
  "success": true,
  "request_id": "uuid",
  "trace_id": "uuid",
  "mission_id": "uuid|null",
  "agent_event_id": "uuid|null",
  "data": {},
  "warnings": []
}
```

Failure:

```json
{
  "success": false,
  "request_id": "uuid",
  "trace_id": "uuid",
  "error": {
    "code": "TENANT_ACCESS_DENIED",
    "message": "...",
    "retryable": false,
    "field_errors": null
  }
}
```

Canonical HTTP mapping: 400 malformed request, 401 unauthenticated, 403 authority/tenant denied, 404 authoritative resource not found, 409 idempotency/state conflict, 422 valid JSON but contract/semantic validation failure, 429 quota/rate limit, 503 transient dependency unavailable, 500 unexpected internal failure.

## 9. Required implementation order

1. Ratify current-state architecture and migration dispositions.
2. Establish canonical engineering corpus authority hierarchy and IDs.
3. Harden tenant execution context and normalize privileged route authorization.
4. Consolidate duplicate legacy/modern agent ownership.
5. Extend BaseAgent into an execution kernel, without adding planning directly into every executor.
6. Introduce tool registry and convert deterministic capabilities to typed tools.
7. Introduce mission, plan, workflow/checkpoint and agent registry schemas.
8. Introduce policy envelope and mandatory audit/evidence enforcement.
9. Build Strategic Orchestrator + Planner.
10. Build memory/knowledge graph and tenant truth provenance.
11. Refactor SEO domains one at a time into supervisor-agent + tool architecture.
12. Build outcome evaluation, experimentation and recursive learning.
13. Build self-healing/code integrity supervision.
14. Expand test/evaluation/chaos/tenant-isolation gates.
15. Activate autonomy progressively by risk class, never platform-wide in one cutover.

## 10. Phase-1 exit criteria

Phase 1 is not complete until all of the following are true:

- Every existing production agent/capability has exactly one disposition.
- Every privileged API route has a declared tenant-context source and authorization rule.
- Duplicate agent implementations are mapped to canonical owners.
- All existing tables touched by target autonomy are mapped to an owner/domain.
- Every NEW BUILD platform primitive has an owning spec ID.
- No final agent count is declared before domain decomposition and tool extraction are complete.
- Existing Six Laws are translated into measurable acceptance gates in the implementation corpus rather than referenced only by name.

