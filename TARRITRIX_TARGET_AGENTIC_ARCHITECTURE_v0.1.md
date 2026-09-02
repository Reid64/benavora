# Tarritrix Target Autonomous Architecture v0.1

## Objective

Transform Tarritrix into a bounded-autonomy, multi-tenant local growth operating system in which agents own goals and decisions while deterministic tools own reliable execution.

## Target layers

```text
                    HUMAN / TENANT OBJECTIVES
                              |
                    Mission & Goal Manager
                              |
                 Strategic Orchestrator Agent
                              |
                       Planner / Arbiter
                              |
              Policy + Authority Decision Point
                              |
        ------------------------------------------------
        |             |             |                 |
   GEO/LOCAL       CONTENT       SEARCH/GBP        AUTHORITY
  supervisors     supervisors     supervisors       supervisors
        |             |             |                 |
        +-------------+-------------+-----------------+
                              |
                    Typed Tool Registry
                              |
        deterministic APIs / crawlers / renderers /
        GSC / GBP / CMS / Supabase / analytics / LLM
                              |
                     Evidence & Event Plane
                              |
     Knowledge Graph + Memory + Experiment Registry
                              |
                 Outcome Evaluation Service
                              |
          Recursive Learning / Policy Proposals
                              |
            Self-Healing & Integrity Supervisor
```

## Architectural laws

1. Agents decide; tools execute.
2. Every autonomous action is tenant-scoped, policy-scoped, traceable and reversible where technically possible.
3. No agent can mint its own authority.
4. No learning becomes production behavior without evidence, evaluation, versioning and rollback.
5. No agent validates its own consequential output as the sole validator.
6. External mutations require idempotency, evidence capture and risk-class enforcement.
7. Deterministic code remains deterministic unless uncertainty genuinely requires model reasoning.
8. A mission may survive process/server restarts; execution state cannot live only in memory.
9. All inter-agent communication uses versioned contracts/events, not free-form hidden coupling.
10. Tenant identity is resolved once at a trusted boundary and propagated explicitly through every layer.

## Core control-plane components

### Mission & Goal Manager
Stores durable goals, success metrics, constraints, deadlines, budgets and current status per tenant.

### Strategic Orchestrator
Observes signals and mission state, selects domain supervisors, requests plans, arbitrates priorities and triggers replanning.

### Planner
Produces typed plans containing steps, dependencies, tools, risk classes, expected effects, evidence requirements, compensation/rollback and completion tests.

### Agent Registry
Versioned identity and runtime metadata for each agent: domain, objective class, authority, tools, model policies, cost limits and lifecycle state.

### Tool Registry
Versioned contract for every callable capability. Each tool declares side effects, input/output schemas, tenant requirements, auth, idempotency semantics, retry policy, cost class and rollback ability.

### Workflow & Checkpoint Engine
Durable state machine for missions and plans. Supports pause, approval wait, retry, compensation, cancellation and resumption.

### Policy Engine
Evaluates principal, tenant, risk, evidence, quotas, external-service policy, approval state and action reversibility before a tool call is allowed.

### Knowledge Graph & Memory
Separates source-backed tenant truth from agent observations, hypotheses and learned procedures. Every fact has provenance and freshness.

### Outcome Evaluator
Compares expected and actual effects using independent evidence. Produces success, partial success, failure or inconclusive states.

### Experimentation & Learning Governor
Manages hypotheses, cohorts, metrics, confidence and promotion of learned strategies. Production promotion is a governed change.

### Self-Healing & Integrity Supervisor
Detects runtime and code/system integrity incidents, performs root-cause analysis, selects safe repair classes, verifies in isolation/canary, rolls back on regression and escalates unsafe repairs.

## Domain supervisor architecture

The final number of agents remains intentionally unfrozen. Domains should be decomposed only after tools and responsibilities are separated. Expected top-level supervisors include:

- Local/Geo Growth Supervisor
- Content Strategy Supervisor
- Content Integrity & Publication Supervisor
- Technical SEO/Indexation Supervisor
- Google Search Console Supervisor
- Google Business Profile Supervisor
- Entity/Citation Consistency Supervisor
- Reputation Supervisor
- Authority/Backlink/Digital PR Supervisor
- AEO/LLM Visibility Supervisor
- Social Search/Distribution Supervisor
- Conversion Intelligence Supervisor
- Market/Competitive Intelligence Supervisor
- Experimentation/Learning Supervisor
- Reliability/Security/Integrity Supervisor

Each supervisor may own multiple specialized agents and deterministic tools. Product monetization boundaries should map to domains/modules, not force separate infrastructure per individual agent.

## Tenant propagation contract

Canonical tenant key remains the existing `client_id`/`clients.id` unless a deliberate migration is ratified. Internally the control plane may use the semantic field name `tenant_id`, but adapters must map it one-to-one to the canonical database key and never create a second independent tenant identifier.

Flow:

```text
Authenticated principal
      -> requested tenant selector
      -> TenantContextResolver verifies grant
      -> immutable TenantExecutionContext
      -> mission
      -> plan
      -> agent
      -> tool
      -> repository/API
      -> DB row constrained by same tenant
```

Missing tenant context at any privileged boundary is a hard failure, not something inferred from payload content.

## Autonomy model

- A0 Observe
- A1 Recommend
- A2 Prepare/queue action
- A3 Execute low-risk reversible actions
- A4 Execute and recover autonomously within bounded policy
- A5 Domain autonomy under explicit budget/authority with platform supervisor veto

Autonomy is assigned per action class, not merely per agent name.
