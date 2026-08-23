# Benavora Prospect Intelligence Layer — Architecture

Workflow state machines, autonomy architecture, API contracts, deterministic services registry,
multi-tenant isolation design, implementation roadmap, and security/privacy model for the
Enterprise Agentic Prospect Intelligence Layer specified in
`BENAVORA ENTERPRISE AGENTIC PROSPECT INTELLIGENCE LAYER.docx`. Reads alongside
`PROSPECT_INTELLIGENCE_SCHEMA.md` (tables) and `PROSPECT_INTELLIGENCE_AGENTS.md` (the 44-agent
fleet this architecture runs).

---

## 1. Workflow State Machines (6 Lifecycles)

The spec's single high-level operating model — `DISCOVER → RESOLVE → RESEARCH → VERIFY → CONNECT →
REASON → QUALIFY → PRIORITIZE → STRATEGIZE → SYNCHRONIZE → MONITOR → OBSERVE OUTCOMES → LEARN →
REPLAN` (spec §22) — is realized as 6 distinct, durable state machines, one per persistent object
type in the schema. Each survives process restarts because its state lives in a table
(`pil_*`), never in in-memory agent state, per spec §20 ("No architecture decision should assume
that a single worker, model session, server, or process remains continuously alive").

### 1.1 Research Goal Lifecycle (`pil_research_goals.state`)

The persistent objective lifecycle, spec §10, verbatim 21-state set:

```
PROPOSED --> VALIDATED --> ACTIVE --> PLANNING --> RESEARCHING --> EXECUTING --> OBSERVING
   OBSERVING --> REPLANNING --> PLANNING            (loop while evidence keeps arriving)
   OBSERVING --> QUALIFIED --> ENGAGEMENT_READY --> CULTIVATION --> AWAITING_RESPONSE
   OBSERVING --> DISQUALIFIED --> SATISFIED
   ACTIVE|RESEARCHING|... --> BLOCKED_POLICY        (Policy Enforcement Engine deny)
   ACTIVE|RESEARCHING|... --> BLOCKED_HUMAN         (H1/H2 boundary hit, or critic BLOCK_*)
   BLOCKED_POLICY|BLOCKED_HUMAN --> ACTIVE           (unblocked by human/policy decision)
   any active state --> FAILED_RECOVERABLE --> ACTIVE (via BEN-SUP-06 recovery)
   any active state --> FAILED_TERMINAL --> SATISFIED (recovery investigator gives up)
   ENGAGEMENT_READY|CULTIVATION|AWAITING_RESPONSE --> MONITORING
   MONITORING --> RESEARCH_STALE --> REPLANNING      (freshness sweep finds staleness)
   any non-terminal state --> PAUSED --> ACTIVE      (Portfolio Allocator suspend/resume)
   SATISFIED|DISQUALIFIED --> REOPENED --> ACTIVE    (new evidence reopens a closed goal)
```

**Owner:** BEN-SUP-01 (Chief Prospect Intelligence Orchestrator) drives `PROPOSED → ACTIVE`
transitions; BEN-SUP-04 (Portfolio Allocator) drives `PAUSED`/resume; BEN-QLF-04 drives
`QUALIFIED`/`DISQUALIFIED`; BEN-KNW-04 drives `RESEARCH_STALE`; the deterministic Policy
Enforcement Engine drives every `BLOCKED_POLICY` transition unilaterally (no agent can veto it).

**Invariant:** a goal cannot move directly from any state to `ENGAGEMENT_READY` without passing
through `QUALIFIED`, and cannot reach `QUALIFIED` at `TIER_1_PRIORITY`/`TIER_2_CULTIVATE` without a
recorded BEN-SUP-05 critic pass (spec §12) — enforced by a check the Durable Workflow Orchestration
service runs before accepting the transition, not by agent self-discipline.

### 1.2 Research Run Lifecycle (`pil_research_runs.status` + `pil_research_run_steps.loop_phase`)

Outer status: `planning → running → (completed | failed | cancelled)`.

Inner loop, one `pil_research_run_steps` row per iteration (spec §7's closed reasoning loop):

```
GOAL --> OBSERVE_STATE --> PLAN --> SELECT_TOOLS_OR_DELEGATE --> EXECUTE --> COLLECT_EVIDENCE
   --> EVALUATE --> OBSERVE_RESULT --> REVISE_PLAN --> { CONTINUE | ESCALATE | STOP }
   CONTINUE --> OBSERVE_STATE   (loop)
   ESCALATE --> (outer run status unaffected; creates a pil_human_review_queue row, run stays running)
   STOP --> (outer run status --> completed)
```

**Invariant (spec §7):** an agent run must not terminate on `STOP` merely because one tool call
returned data — the `EVALUATE` phase explicitly checks: sufficient evidence? additional sources
required? contradictory evidence? another specialist needed? identity uncertain? confidence too
low? research value declining? qualify/disqualify signal present? human decision needed? Only after
this checklist does `REVISE_PLAN` choose `CONTINUE`/`ESCALATE`/`STOP`. This checklist is a hard gate
in the agent runtime harness (built in PIL-03, §7 below), not agent-optional behavior.

### 1.3 Agent Run Lifecycle (`pil_agent_runs.status`)

```
QUEUED --> PLANNING --> RUNNING --> OBSERVING --> REPLANNING --> RUNNING   (loop)
RUNNING|OBSERVING --> COMPLETED
RUNNING|OBSERVING|REPLANNING --> BLOCKED     (awaiting a human decision or policy resolution)
BLOCKED --> RUNNING                          (unblocked)
any state --> FAILED                         (unrecoverable error; BEN-SUP-06 investigates)
any state --> ESCALATED                      (critic BLOCK_*, or agent-issued escalation)
```

One `pil_agent_runs` row corresponds to exactly one agent's execution of the Research Run inner
loop (§1.2) for its assigned scope — a research run typically spans many agent runs.

### 1.4 Delegated Task Lifecycle (`pil_delegated_tasks.status`)

```
PENDING --> ACCEPTED --> RUNNING --> COMPLETED
PENDING --> CANCELLED                         (parent cancels before child accepts)
ACCEPTED|RUNNING --> FAILED --> (parent decides: re-delegate, or ESCALATED)
ACCEPTED|RUNNING --> ESCALATED                (child hits its own H1/H2 boundary)
```

**Invariant (spec §8):** `ACCEPTED` is only reachable if `max_autonomy` on the task is ≤ the
child agent's `pil_agent_registry.default_autonomy_level` ceiling for its family, and
`delegation_depth` is ≤ `pil_delegation_budgets.max_delegation_depth` — both checked by the Policy
Enforcement Engine at task-creation time, before `PENDING` is even written, so an over-authority or
over-depth delegation never enters the table in the first place.

### 1.5 Human Review Lifecycle (`pil_human_review_queue.status`)

```
PENDING --> IN_REVIEW --> { APPROVED | REJECTED | CHANGES_REQUESTED }
CHANGES_REQUESTED --> PENDING                 (re-submitted after the requesting agent updates)
PENDING|IN_REVIEW --> EXPIRED                 (SLA breach, tenant-configured)
```

Every terminal decision writes a `pil_human_review_decisions` row (append-only) referencing the
deciding `profiles.id` — this is the one lifecycle where a human, not an agent, drives every
transition; agents may only create `PENDING` rows and read the outcome.

### 1.6 Monitoring Trigger Lifecycle (`pil_monitoring_subscriptions.status` + `pil_monitoring_events.status`)

```
Subscription: ACTIVE <--> PAUSED
Event:        NEW --> REVIEWED --> { ACTIONED | DISMISSED }
              NEW --> ACTIONED   (BEN-STR-04 acts directly at A3 without a manual REVIEWED step,
                                   when the trigger maps to a pre-authorized reversible action)
```

A `NEW` event on an `ACTIVE` subscription is what BEN-QLF-05/BEN-STR-04 observe to drive their own
replanning triggers (spec §15) — this lifecycle is the entry point that reopens `MONITORING`-state
goals back into `REPLANNING` (§1.1).

---

## 2. Autonomy Architecture — Full Implementation

Spec §9's A0-A4 / H1-H2 model, made concrete:

| Level | Name | What it means operationally | Enforcement point |
|---|---|---|---|
| A0 | Observe Only | Agent reads state, writes nothing beyond its own `pil_agent_run_events` trace. | Policy Enforcement Engine rejects any `pil_evidence`/`pil_graph_*`/`pil_prospect_*` write attempt from an A0-ceilinged agent. |
| A1 | Research & Recommend | May write `pil_evidence`, propose classifications/scores — never mutates `pil_prospects`/`pil_prospect_opportunities` status fields directly. | Write path for status-mutating columns checks `autonomy_level_used` before commit. |
| A2 | Prepare & Queue | May create dossiers, briefs, `pil_delegated_tasks`, draft `pil_prospect_opportunities` rows and cultivation plans — never executes an irreversible or externally-visible action. | Same as A1, plus: any action tagged `reversible=false` in its tool contract is rejected outright at this level. |
| A3 | Autonomous Reversible Execution | May execute pre-authorized, low-risk, reversible operations — e.g. BEN-SUP-04 pausing a goal, BEN-KNW-01 applying an accepted twin update, BEN-STR-04 choosing "monitor for event." | Tool contracts declare `reversible: true/false` per action; the Policy Enforcement Engine is the sole authority that checks this flag, not the calling agent. |
| A4 | Policy-Bounded Autonomous Execution | May execute higher-impact actions, but only within explicit tenant policy and a durable workflow (BEN-SUP-01's global coordination, BEN-SUP-03's plan execution). | Requires a matching `pil_cost_budgets`/tenant-policy row explicitly granting the action class; absent that row, the action is denied and the goal moves to `BLOCKED_POLICY`. |
| H1 | Human Approval Required | Action is prepared but held; a `pil_human_review_queue` row must reach `APPROVED` before it proceeds. | Enforced structurally: the action's own downstream effect (e.g. a solicitation) simply has no code path that does not read a `pil_human_review_decisions` row first. |
| H2 | Human Execution Required | Agent may recommend, but the system provides no automated execution path at all — a human must perform the action outside the agent runtime (e.g. actually placing a solicitation call). | No tool exists in any agent's `allowed_tools` that could perform the action; it is a structural absence, not a permission check. |

**Self-escalation is structurally impossible, not merely disallowed (spec §9/§12):**

1. `pil_agent_registry.default_autonomy_level` is written only by the service-role deploy pipeline
   (§Deterministic Services below), never by an agent-facing API route.
2. `pil_delegated_tasks.max_autonomy` cannot exceed the parent's own `autonomy_level_used` — a
   `CHECK`-equivalent enforced in the Policy Enforcement Engine at task-creation (not a DB
   `CHECK` constraint, since it requires a cross-row comparison against the live parent run).
3. BEN-OPS-01, the one agent whose entire mission is fleet performance and *recommending* autonomy
   changes, is explicitly and permanently barred from applying its own recommendations (its
   contract's Human boundary field is a hard architectural line, re-stated in
   `PROSPECT_INTELLIGENCE_AGENTS.md`, not a suggestion).
4. Every autonomy-adjacent change (raising a `default_autonomy_level`, granting an A4 policy row)
   is itself an audited `pil_audit_log` entry with `actor_type='human'` required — a service-role
   script alone cannot flip this without a human-attributed audit row, closing the "who actually
   approved this" gap.

---

## 3. Persistent Goal Lifecycle — Durability Guarantee

Every field the spec requires (§10) survives a full process/worker/session restart because it
lives in `pil_research_goals`/`pil_research_runs`/`pil_agent_runs`, and the Durable Workflow
Orchestration service (§Deterministic Services) is the only component permitted to hold in-memory
state about "what happens next" — and even that in-memory state is a cache of the DB row, rebuilt
on restart by re-reading `state`/`status`, never authoritative on its own. A killed worker mid-run
leaves the affected `pil_agent_runs` row in `RUNNING`; a heartbeat/lease timeout (owned by the same
orchestration service) reclassifies it to `FAILED` and hands it to BEN-SUP-06 for recovery — the
same idempotent-resume pattern already used by this codebase's existing worker
(`worker/queue-processor.ts`), applied consistently here.

---

## 4. API Contracts (13 endpoints)

All endpoints follow this codebase's existing convention: Next.js route handlers under
`src/app/api/pil/`, `requireRole()`-gated session client for tenant-scoped reads/writes (never a
raw service-role client on a human-facing route), `organization_id` derived from the authenticated
session — never trusted from the request body, matching the precedent already fixed elsewhere in
this codebase (`benavora-platform-config-org-scope-fixed-2026-08-11` in project memory: the fix
there was exactly "stop trusting a client-supplied org id").

| # | Method & Path | Purpose | Backing table(s) | Min role |
|---|---|---|---|---|
| 1 | `POST /api/pil/research/query` | Natural-language discovery request (spec §5) → compiles to a structured plan, creates `pil_research_goals` + `pil_research_runs`, kicks off BEN-SUP-02/03. | `pil_research_goals`, `pil_research_runs` | writer |
| 2 | `GET /api/pil/research/runs/{runId}` | Run status, structured plan, live progress (loop-phase, tokens/cost consumed). | `pil_research_runs`, `pil_research_run_steps` | viewer |
| 3 | `POST /api/pil/research/runs/{runId}/cancel` | Cancel an in-flight run; cascades to cancel its open `pil_delegated_tasks`. | `pil_research_runs`, `pil_delegated_tasks` | writer |
| 4 | `GET /api/pil/prospects` | Search/list/filter prospects (entity_type, classification, status, cause/geography dimensions) — backs the Research Queue UI. | `pil_prospects`, `pil_prospect_opportunities`, `pil_prospect_classifications` | viewer |
| 5 | `GET /api/pil/prospects/{prospectId}` | Full dossier — the digital twin, spec §3's complete deliverable list. | `pil_prospect_digital_twins` | viewer |
| 6 | `GET /api/pil/prospects/{prospectId}/graph` | Relationship graph traversal centered on this prospect (bounded hop count, query param `maxHops`). | `pil_graph_nodes`, `pil_graph_edges` | viewer |
| 7 | `GET /api/pil/prospects/{prospectId}/evidence` | Evidence/provenance inspector — every claim, source, confidence, verification_status for this prospect. | `pil_evidence`, `pil_source_snapshots` | viewer |
| 8 | `GET /api/pil/opportunities` | Ranked opportunity list (Opportunity-Ranking UI), sortable by classification/capacity/timing. | `pil_prospect_opportunities` | viewer |
| 9 | `POST /api/pil/opportunities/{opportunityId}/next-best-action` | Trigger BEN-STR-04's evaluation on demand (normally continuous); returns the recommended action. | `pil_prospect_opportunities`, `pil_agent_runs` | writer |
| 10 | `GET /api/pil/agents/runs` | Agent Activity/Audit UI feed — filterable by `agentId`, `prospectId`, `researchRunId`, `status`. | `pil_agent_runs`, `pil_agent_run_events` | viewer |
| 11 | `GET /api/pil/human-review` | Human review queue list, filterable by `review_type`/`status`/`priority`. | `pil_human_review_queue` | writer |
| 12 | `POST /api/pil/human-review/{reviewId}/decision` | Approve/reject/request-changes on a review item; writes the decision and unblocks the associated goal/task. | `pil_human_review_decisions`, `pil_human_review_queue` | owner (identity-linkage/policy-exception review types) or writer (others) |
| 13 | `GET /api/pil/cost-ledger` | Cost/budget dashboard — spend by agent/family/research-run, budget adherence vs. `pil_cost_budgets`. | `pil_cost_ledger`, `pil_cost_budgets` | owner |

All 13 return the standard error envelope already used across this codebase's API routes
(`{"error": "..."}` with an appropriate HTTP status), and every mutating endpoint (1, 3, 9, 12)
writes a corresponding `pil_audit_log` row before returning success — matching the "complete audit
trails" requirement (spec §20) at the API boundary, not only inside agent runs.

---

## 5. Deterministic Services Registry (27 services)

Per spec §13: "Do not represent deterministic infrastructure as agents." None of the following can
receive a goal, plan, or revise a plan — they are called by agents and by each other under fixed
logic. Grouped by the phase of work they support.

### 5.1 Identity, Tenancy & Policy

| Service | Responsibility | Backing / integrates with |
|---|---|---|
| Identity/Auth | Session auth for human users. | Existing Supabase Auth + `profiles` (unchanged by this layer). |
| Tenant Isolation Service | Shared helper library enforcing `organization_id` derivation from session, never from client input, on every PIL route. | Wraps `requireRole()`, used by all 13 API contracts. |
| RBAC/ABAC | Role gate (owner/admin/writer/viewer) per endpoint per §4's Min role column. | `profiles.role`. |
| Policy Enforcement Engine | Central ALLOW/DENY/REQUIRE_HUMAN authority for every consequential agent action — autonomy ceilings, delegation depth/fanout, data-class permissibility, budget hard-stops. | Reads `pil_agent_registry`, `pil_delegation_budgets`, `pil_source_registry`, `pil_cost_budgets`; writes `pil_policy_decisions`. |
| Consent Ledger | Tracks which data classes/sources a tenant has explicitly authorized (e.g. customer-relationship data for BEN-REL-03). | New `pil_tenant_consent` table (documented for PIL-02; not part of the 12 core groups since it is policy configuration, not research data). |

### 5.2 Orchestration & Messaging

| Service | Responsibility | Backing / integrates with |
|---|---|---|
| Durable Workflow Orchestration | Drives all 6 lifecycles (§1); owns lease/heartbeat and restart-recovery for `pil_agent_runs`. | `pil_research_goals`, `pil_research_runs`, `pil_agent_runs`. |
| Transactional Outbox / Event Bus | Publishes `pil_agent_run_events`/`pil_monitoring_events` reliably even across a mid-write crash. | Outbox pattern over the same Postgres transaction as the triggering write. |
| Notification Service | Delivers escalations, review-queue items, and monitoring alerts to the right human channel. | `pil_human_review_queue`, existing `automation_notifications` infrastructure. |
| Rate Limiter | Per-source, per-tenant call throttling. | `pil_source_registry.rate_limit_per_minute`. |

### 5.3 Research Acquisition

| Service | Responsibility | Backing / integrates with |
|---|---|---|
| Connector Gateway | Single choke point every source call passes through; checks `pil_source_registry.permissibility_status` before allowing any T-WEB/T-CRAWL/T-990/etc. call — this is the enforcement point for spec §19's "public availability alone must not automatically constitute unrestricted permissible use." | `pil_source_registry`, `pil_source_provider_credentials`. |
| API Gateway | Routes/authenticates the 13 human-facing API contracts. | Next.js route handlers under `src/app/api/pil/`. |
| Browser Automation Broker | Headless-browser research for JS-heavy sources, reusing this codebase's existing browser-automation infrastructure (`src/lib/agents/browser-automation.ts`) rather than a parallel implementation. | Existing anti-detection/session infra. |
| HTTP/Web Crawler | Plain HTTP retrieval for static sources. | — |
| Document Retrieval Service | Fetches and caches source documents (PDF, HTML) referenced by evidence. | `pil_source_snapshots`. |
| Document Parsing Service | Extracts structured text/tables from retrieved documents. | Feeds Form 990/SEC parsers below. |
| Form 990 Parser | Structured extraction from IRS Form 990/990-PF filings. | Feeds BEN-INT-05/06/07/09, BEN-DIS-03. |
| SEC/EDGAR Adapter | Structured extraction from SEC filings (ownership, executive comp, material events). | Feeds BEN-INT-03/08/09. |
| Public Records Adapter | State business-registry and public-records lookups. | Feeds BEN-INT-03, BEN-DIS-06. |
| Licensed Data Provider Adapters | Adapter layer per licensed/authorized provider, isolated behind a common interface so provider swaps don't touch agent code (spec §22: "isolate provider access behind adapters"). | `pil_source_provider_credentials`. |
| Search Provider Adapter | Open-web and news search. | — |
| CRM Connectors | Bidirectional sync between PIL canonical state and the tenant's CRM (Benavora's own or external) — the boundary spec §14 requires: "Research truth / Canonical entity truth / Opportunity intelligence / CRM operational state" stay separate, sync is explicit and controlled, never implicit. | `pil_prospects`, existing CRM tables. |
| Contact Normalization Service | Validates/normalizes/dedupes contact channels before they're recorded. | Feeds BEN-INT-10. |

### 5.4 Knowledge & Evidence Infrastructure

| Service | Responsibility | Backing / integrates with |
|---|---|---|
| Entity Resolution Support Engine | Deterministic matching algorithms (fuzzy name match, address normalization) that feed candidate pairs to BEN-KNW-02 — the agent reasons over ambiguous cases; this service does the mechanical matching. | `pil_entity_resolution_candidates`. |
| Deduplication Engine | Prevents duplicate `pil_prospects`/`pil_graph_nodes` creation at write time. | Called by every Discovery-family write path. |
| Knowledge Graph Store | Query engine over `pil_graph_nodes`/`pil_graph_edges` (bounded-hop traversal, path-ranking primitives) that BEN-REL agents call rather than hand-writing recursive SQL per agent. | `pil_graph_nodes`, `pil_graph_edges`. |
| Evidence/Provenance Ledger | Enforces the append-only/immutability invariant on `pil_evidence`; the only write path into that table. | `pil_evidence`. |
| Source Snapshot Service | Captures and hashes raw source content at retrieval time for reproducibility. | `pil_source_snapshots`. |
| Audit Ledger | The only write path into `pil_audit_log`; guarantees before/after state capture on every consequential mutation. | `pil_audit_log`. |

### 5.5 Cost, Models & Operations

| Service | Responsibility | Backing / integrates with |
|---|---|---|
| Cost Ledger Service | Records every billable unit, checks `pil_cost_budgets` before allowing further spend, triggers `hard_stop`. | `pil_cost_ledger`, `pil_cost_budgets`. |
| Model Gateway | Routes every T-MODEL call, applies per-agent token budgets, supports model-selection recommendations from BEN-OPS-01 without agent code changes. | `pil_agent_runs.tokens_consumed`. |
| Feature Flags | Gradual rollout of new agents/queues per tenant. | — |
| Kill Switches | Immediate hard-stop for a single agent, a family, or the entire fleet, independent of the normal autonomy/policy path — the emergency override. | Read by the Durable Workflow Orchestration service before dispatching any agent run. |
| Observability | Metrics + distributed tracing across the full loop (§1.2), correlated by `research_run_id`. | — |
| Evaluation Infrastructure | Runs each agent's Evaluation Suite (defined per-agent in `PROSPECT_INTELLIGENCE_AGENTS.md`) on a schedule; feeds results to BEN-OPS-01. | Reads `pil_agent_runs`, `pil_human_review_decisions`, outcome data. |

27 services total — within the spec's "approximately 20-30" guidance (§13/§21).

---

## 6. Multi-Tenant Isolation Design

Two enforcement layers, deliberately redundant:

1. **RLS (session-respecting client path).** Every `pil_*` table's policies (defined in
   `PROSPECT_INTELLIGENCE_SCHEMA.md`) scope `organization_id = (SELECT organization_id FROM
   profiles WHERE id = auth.uid())`. This protects every one of the 13 human-facing API contracts,
   which use a session-respecting client, and any future client-side component that queries a
   `pil_*` table directly — the same defense-in-depth this codebase already relies on for
   client-side queries (`benavora-rls-24-tables-leak-cross-org-select`,
   `benavora-storage-buckets-5of6-zero-policy` in project memory document exactly what happens when
   this layer is skipped).

2. **Explicit `organization_id` scoping in the agent runtime (service-role path).** Agents do not
   act as a logged-in user — the agent runtime typically executes via a service-role/admin Supabase
   client, which **bypasses RLS entirely**. This is the single most important security invariant in
   this architecture: RLS provides zero protection for anything the agent runtime writes. Every
   agent-runtime write must carry an explicit `organization_id` filter/value sourced from the
   originating `pil_research_goals`/`pil_delegated_tasks` row — never inferred, never omitted. The
   Policy Enforcement Engine (§5.1) is the component responsible for rejecting any agent-runtime
   write that lacks or mismatches this scoping, functioning as RLS's equivalent for the service-role
   path. This mirrors — and is designed specifically to avoid repeating — this exact codebase's own
   audit history: `benavora-platform-config-org-scope-fixed-2026-08-11` (a cross-org leak in
   `platform_config` from missing explicit org-scoping at ~28 call sites) and the broader
   `benavora-rls-24-tables-leak-cross-org-select`/`benavora-anon-grant-remediation-2026-08-03`
   findings. PIL-14 (§7 below) includes a dedicated audit pass modeled directly on
   `ANON_GRANT_AUDIT.md`'s methodology, run against every `pil_*` table before this layer is
   considered production-ready.

3. **Platform-level shared tables are the explicit exception, not a default.** Only
   `pil_agent_registry` and `pil_source_registry` (plus null-`organization_id` rows in
   `pil_source_provider_credentials`) have no tenant boundary — by design, matching the same
   `agent_registry`/shared-reference-table pattern already established and hardened in this
   codebase (migrations 075/121). Every other table denormalizes `organization_id` and is
   RLS-enabled with `REVOKE ALL ... FROM anon`.

---

## 7. Implementation Roadmap — 14 FORGE Queues (PIL-01 .. PIL-14)

Dependency-ordered: infrastructure and knowledge-integrity foundations first, specialists
bottom-up (leaf agents before the supervisors that coordinate them), then learning, UI, monitoring,
and a final hardening pass. Each queue's gate conditions are written to be checkable the same way
this codebase's existing FORGE queues already check gates (`file_exists`, a passing test command,
a migration-applied check) — see `queue-pil-01-migrations.yaml` for PIL-01 expressed as a runnable
queue file in the exact format already used by `queue-06-corporate-enrichment-agent-verification.yaml`
and its siblings.

| Queue | Title | Deliverables | Gate conditions |
|---|---|---|---|
| **PIL-01** | Schema migrations | All 12 table groups (31 tables) applied as numbered Supabase migrations, `pg_trgm` extension enabled, `pil_agent_registry` seeded with all 44 agent rows. | `mcp__supabase__list_tables` shows all 31 `pil_*` tables; `get_advisors` (security) returns zero new findings; every `pil_*` table has RLS enabled (spot-checked via `SELECT relrowsecurity FROM pg_class WHERE relname LIKE 'pil\_%'`). |
| **PIL-02** | Deterministic core services | Policy Enforcement Engine, Connector Gateway, Cost Ledger Service, Evidence/Provenance Ledger, Audit Ledger, Tenant Isolation helper library. | Unit tests for policy-decision logic (autonomy ceiling, delegation depth/fanout, budget hard-stop) pass; a service-role write missing `organization_id` is provably rejected in an integration test. |
| **PIL-03** | Agent runtime harness | The generic `GOAL→OBSERVE→...→STOP` loop executor (§1.2) that every one of the 44 agents runs inside; Model Gateway with per-agent token budgeting; Durable Workflow Orchestration wiring for lease/heartbeat/restart-recovery. | A synthetic no-op agent completes a full loop, is killed mid-run, and resumes correctly without duplicate `pil_evidence` rows (idempotency test). |
| **PIL-04** | Knowledge Integrity family | BEN-KNW-01..04 built and live-verified. | Each of the 4 agents' Evaluation Suite (per `PROSPECT_INTELLIGENCE_AGENTS.md`) run once against seeded test data with real, non-mocked output recorded in `AGENT_VERIFICATION_LOG.md`, matching this codebase's existing agent-verification standard. |
| **PIL-05** | Discovery family | BEN-DIS-01..08 built and live-verified against at least 3 real, distinct search scenarios (one per major dimension: individual, foundation, geographic). | `AGENT_VERIFICATION_LOG.md` entries for all 8 agents with real (not mocked) discovered candidates and spot-checked accuracy, following the exact precedent in `queue-06-corporate-enrichment-agent-verification.yaml`. |
| **PIL-06** | Core Prospect Intelligence family | BEN-INT-01..10 built and live-verified against the candidates PIL-05 discovered. | Evidence-linkage completeness check (100% target per each agent's contract) passes on the live-verified sample; full pipeline handoff test (Discovery → Core Intelligence, mirroring the existing `queue-06` §q6-003 pattern) confirms real data flows, not defaults. |
| **PIL-07** | Relationship & Graph Intelligence family | BEN-REL-01..06 built and live-verified; Knowledge Graph Store query primitives (bounded-hop traversal, path ranking) implemented. | Zero fabricated-edge findings in a sampled path-traceability audit (per BEN-REL-02's contract); path output for at least one synthetic warm-introduction scenario matches the graph ground truth exactly. |
| **PIL-08** | Qualification family | BEN-QLF-01..05 built and live-verified. | Dimensional-separation compliance (capacity vs. propensity never blended, per BEN-QLF-03's contract) verified on the live sample; zero `TIER_1_PRIORITY`/`TIER_2_CULTIVATE` classifications without a recorded critic pass. |
| **PIL-09** | Strategy family | BEN-STR-01..04 built and live-verified. | Capacity-bound compliance (BEN-STR-02: ask range never exceeds documented capacity, 100% target) verified; every cultivation plan has an explicit stop condition. |
| **PIL-10** | Supervisory & Orchestration family | BEN-SUP-01..06 built; full end-to-end research run (natural-language query → discovery → intelligence → relationship → qualification → strategy) executed live for at least one real test scenario. | A single `pil_research_runs` row completes `planning → running → completed` end to end with every intermediate `pil_delegated_tasks`/`pil_agent_runs` row terminal and no orphaned tasks; BEN-SUP-05 critic ran at least once and its verdict is on record. |
| **PIL-11** | Learning & Evaluation | BEN-OPS-01 built; Evaluation Infrastructure running all 44 agents' evaluation suites on schedule. | BEN-OPS-01 produces at least one real learning proposal from live PIL-04..10 run data, routed to human/Governor review (never self-applied) — proposal-routing verified by inspecting the actual `pil_human_review_queue` row it created. |
| **PIL-12** | Human-in-the-loop UI | All 13 API contracts (§4) implemented; Operator Command Center, Prospect Dossier UI, Relationship Graph UI, Source/Evidence Inspection UI, Opportunity-Ranking UI, Research Queue UI, Agent Activity/Audit UI, natural-language search interface. | Each of the 13 endpoints has a passing integration test hitting a real (not mocked) database; a manual click-through of every listed UI surface against live PIL-04..11 data is screenshotted per `benavora-ui-claims-need-visual-proof` project-memory standard — tsc/build passing is not sufficient evidence on its own. |
| **PIL-13** | Continuous Intelligence & CRM Sync | `pil_monitoring_subscriptions`/`pil_monitoring_events` wired to real trigger sources (news/filing feeds); CRM Connector service syncing qualified opportunities out to the tenant's CRM under the spec §14 boundary (research truth stays in PIL tables, CRM sync is one-directional-by-default and explicit). | A real monitoring trigger (seeded test event) correctly reopens a `MONITORING`-state goal into `REPLANNING` and is visible in the Agent Activity/Audit UI within the tenant's configured SLA. |
| **PIL-14** | Hardening & Production Readiness | Full RLS/anon-grant audit pass over all 31 `pil_*` tables (methodology matching `ANON_GRANT_AUDIT.md`); load test on the agent runtime harness; chaos test (kill a worker mid-run, confirm §1.3's recovery path); security review of the Policy Enforcement Engine's self-escalation prevention (§2); evaluation-suite baseline recorded for all 44 agents. | Security review finds zero cross-tenant read/write paths; chaos test confirms zero duplicate-evidence/double-cost-charge on a killed-and-resumed run; every agent has a non-empty, non-mocked evaluation-suite baseline on record in `AGENT_VERIFICATION_LOG.md`. |

Each queue is expected to produce its own `AGENT_VERIFICATION_LOG.md` entries and a
`STATE_OF_THE_BUILD.md`/`SESSION_STATE.md` session-close entry, per this codebase's established
convention (see the `STATE_OF_THE_BUILD.md` update accompanying this document's own creation).

---

## 8. Security and Privacy Model

Directly implements spec §19 (Privacy, Compliance and Ethical Research) and §20 (Enterprise
Engineering Standard):

- **Data minimization & permissibility.** Every source call is mediated by the Connector Gateway
  against `pil_source_registry.permissibility_status` (§5.3) — an agent cannot reach a source that
  isn't `permitted`, regardless of what the agent's own reasoning concludes. Licensed-data
  limitations are enforced the same way via `pil_source_provider_credentials`.
- **No protected-characteristic targeting.** The fleet-wide prohibition stated once in
  `PROSPECT_INTELLIGENCE_AGENTS.md` (§Shared Vocabulary) — never inferring or targeting on health,
  religion, sexual orientation, disability, immigration status, or similarly protected/sensitive
  characteristics for solicitation — is enforced structurally: no data class code
  (`PROSPECT_INTELLIGENCE_AGENTS.md`'s catalog) exists for any such characteristic, so no
  `pil_delegated_tasks.allowed_data_classes` array can ever contain one. Public availability of a
  fact never overrides this (spec §19's explicit statement, carried through verbatim).
- **Fact vs. inference discipline.** `pil_evidence.verification_status` and the wealth/capacity
  agents' contracts (BEN-INT-08/09, BEN-QLF-03) structurally prevent inference from being presented
  as fact — a capacity range can never carry `verification_status='verified_fact'` (schema-level
  `CHECK` plus contract-level rule), directly satisfying spec §3's "No inference may be presented
  as fact."
- **Credential handling.** `pil_source_provider_credentials.credential_ref` is a pointer only,
  never a raw secret — matching this codebase's existing encrypted-credential pattern
  (`benavora-byo-keys-encrypted` in project memory: keys encrypted at rest, masked on read). Actual
  secrets live in the platform secret manager / Vercel environment, not in any `pil_*` table.
- **Retention.** `pil_evidence`/`pil_source_snapshots` are retained per the tenant's configured
  retention policy (a `pil_tenant_consent`-adjacent setting, introduced in PIL-02); expired
  snapshots are purged by a scheduled job, but the `pil_evidence` row's claim/citation metadata is
  retained even after snapshot purge, preserving auditability without indefinitely storing raw
  scraped content.
- **Auditability.** Every consequential action (agent write, human decision, policy denial) has an
  append-only record in `pil_audit_log`, `pil_policy_decisions`, or `pil_human_review_decisions` —
  none of the three support `UPDATE`/`DELETE` for any role.
- **Tenant isolation.** Two-layer enforcement per §6 above (RLS + explicit service-role scoping),
  the second layer existing specifically because this codebase's own history shows RLS-only
  enforcement has previously failed silently (`benavora-rls-24-tables-leak-cross-org-select`,
  `benavora-rls-audit-16-tables-anon-exposed` in project memory).
- **Human review as a real control, not a formality.** `pil_human_review_queue` review types map
  directly to spec §12's critic-block reasons and §9's H1/H2 boundaries; a `REJECTED`/
  `CHANGES_REQUESTED` decision structurally blocks the associated goal (`BLOCKED_HUMAN` state,
  §1.1) rather than merely logging a warning the agent can proceed past.
- **Automated outreach stays out of scope for this layer.** No agent in the 44-agent fleet has
  `T-CRM` write access to trigger an actual outreach send, and BEN-STR-02's contract explicitly
  keeps the final solicitation decision at H1 — outreach execution is a downstream Benavora
  capability this layer feeds recommendations into, never a capability this layer performs itself.
