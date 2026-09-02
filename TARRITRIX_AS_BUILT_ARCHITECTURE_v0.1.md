# Tarritrix As-Built Architecture v0.1

## Architectural style observed

Tarritrix is currently a Next.js/Supabase multi-tenant SaaS with a large route-handler surface, deterministic/LLM-assisted “agent” executors, Vercel cron triggers, Supabase-backed event/audit persistence, and a separate Forge/Claude Code development-governance corpus.

## Runtime layers

```text
Browser / Operator Dashboard / Client Portal
                  |
          Next.js Route Handlers
                  |
       Auth + RBAC + API Validation
                  |
   ------------------------------------------------
   |                 |                            |
A-series calls   Domain APIs                  Cron routes
   |                 |                            |
   +----------- Agent/Service Layer --------------+
                     |
          BaseAgent execution lifecycle
    validate -> idempotency -> event -> retry
        -> run -> output validate -> persist
                     |
         Supabase / External APIs / LLMs
                     |
       Events + audit + domain tables
```

## Existing strengths

- Strong schema validation pattern in modern agents.
- Reusable `BaseAgent` lifecycle.
- Explicit event and cost tracking.
- Existing retry and idempotency concepts.
- Extensive migrations and tenant-key usage via `client_id`.
- Existing operator permissions and audit attribution.
- Existing evidence, risk and policy primitives.
- Strong existing feature breadth across content, GSC, geo, reputation, citations, backlinks and AI visibility.
- Mature development governance relative to typical projects: `MASTER_BUILD_SPEC.md`, `SCHEMA_REGISTRY.md`, `BEHAVIORAL_CONTRACTS.md`, `AGENTS.md`, build/session state and Forge prompt library.

## Existing weaknesses

### 1. Caller-driven rather than goal-driven
Most agents run because an API route, cron, or another hard-coded flow invoked a known operation. The agent does not own a durable objective and generally does not construct a dynamic plan.

### 2. No autonomous control plane
There is no repository-wide mission manager, planner, plan state machine, tool/capability registry, durable cross-agent workflow coordinator, or outcome evaluator.

### 3. Duplicate agent architecture
Capabilities exist under both `src/agents/**` and `src/lib/agents/**`. Some tests and routes still depend on the legacy tree.

### 4. Tenant context trust boundary is not uniform
Modern routes usually authenticate and authorize an action but often trust a request-body `client_id` without resolving it through a principal-to-tenant grant before privileged execution.

### 5. Governance primitives are not universally enforced as middleware/envelope
Risk classification, evidence, policy and audit are separate utilities rather than one mandatory lifecycle around every consequential tool call/action.

### 6. Learning is not yet recursive governance
A-29 provides performance-learning logic, but there is not yet a complete hypothesis -> experiment -> evidence -> promotion -> rollback lifecycle capable of safely changing system behavior.

### 7. Self-healing is not yet system-level
Retry/backoff exists, but there is no persistent incident graph, automated root-cause workflow, repair planner, sandbox validation, canary promotion and rollback governor.

## As-built ownership domains

- Identity/RBAC: `src/lib/auth/**`
- Tenant/domain hosting: `src/lib/tenant/**`, `/api/domains/**`
- Agent runtime: `src/lib/agents/**`
- Legacy agent capabilities: `src/agents/**`
- LLM access: `src/lib/llm/**`
- Governance: `src/lib/governance/**`
- Data/persistence: Supabase + migrations
- Programmatic content: A-02/A-05/A-06/A-07 plus page APIs
- Technical search/indexing: A-07/A-08/A-49/A-50/A-51/A-52
- Geo/local intelligence: A-21 and map-related components
- Reputation/trust: A-14/A-23/A-43
- Authority/off-site: A-13/A-39/A-40/A-45/A-46
- AEO/entity: A-25/A-26/A-27/A-47/A-53
- Learning: A-29
- Conversion: A-09 and lead modules
- Operations: Vercel cron, health endpoint, Sentry/logging

## Ground-truth rule for transformation

Executable code, migrations and current configuration outrank stale status prose when they conflict. Governance documents remain authoritative only where they describe intended policy and do not contradict observable current implementation.
