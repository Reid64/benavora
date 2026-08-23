# Benavora Prospect Intelligence Layer — Agent Behavioral Contracts

Complete behavioral contract for all 44 agents across all 6 mandatory families plus the
cross-cutting Operations, Evaluation & Learning family, per
`BENAVORA ENTERPRISE AGENTIC PROSPECT INTELLIGENCE LAYER.docx` §6/§21/§"Complete 44-Agent
Registry". Every agent below satisfies the normative definition in the source spec: it can receive
or maintain a goal, form a plan, select tools, delegate, observe results, revise its plan, and
continue/stop/escalate — none of these are thin wrappers, scheduled jobs, or single-purpose API
clients.

Table references throughout (`pil_*`) are defined in `PROSPECT_INTELLIGENCE_SCHEMA.md`. Workflow
states referenced (e.g. `RESEARCHING`, `BLOCKED_HUMAN`) are the persistent goal lifecycle states
stored in `pil_research_goals.state`, defined fully in `PROSPECT_INTELLIGENCE_ARCHITECTURE.md`
§Workflow State Machines.

## Shared Vocabulary

To keep each of the 44 contracts below legible, tools and data classes are referenced by short
code against the catalogs here. Full descriptions live in
`PROSPECT_INTELLIGENCE_ARCHITECTURE.md` §Deterministic Services and §API Contracts.

**Tool codes**

| Code | Tool |
|---|---|
| T-WEB | Search Provider Adapter (open web) |
| T-CRAWL | HTTP/Web Crawler + Document Retrieval |
| T-BROWSER | Browser Automation Broker |
| T-990 | Form 990 Parser |
| T-EDGAR | SEC/EDGAR Adapter |
| T-PUBREC | Public Records Adapter |
| T-LICENSED | Licensed Data Provider Adapters |
| T-NEWS | News/Search Connector |
| T-CRM | CRM Connector (org's own CRM, read unless "read/write" noted) |
| T-GRAPH | Knowledge Graph Store (`pil_graph_nodes`/`pil_graph_edges`) |
| T-EVIDENCE | Evidence/Provenance Ledger (`pil_evidence`, write) |
| T-DELEGATE | Delegation API (create a `pil_delegated_tasks` row) |
| T-COST | Cost Ledger (`pil_cost_ledger`, read) |
| T-MODEL | Model Gateway (LLM reasoning calls, budgeted) |
| T-NOTIFY | Notification Service |
| T-CONTACT | Contact Normalization Service |
| T-WORKFLOW | Durable Workflow Orchestration (start/pause/resume a workflow) |

**Data class codes**

| Code | Data class |
|---|---|
| D-PUBLIC-BIO | Public biographical information |
| D-PUBLIC-FILING | Public nonprofit/foundation/SEC/990 filings |
| D-PUBLIC-NEWS | Public news and press |
| D-PUBLIC-BIZ | Public business/corporate information |
| D-CRM-FIRSTPARTY | Tenant's own first-party CRM/internal data |
| D-CONTACT-PUBLIC | Publicly available professional contact channels |
| D-WEALTH-INFERRED | Reasoned wealth/capacity inference (never presented as fact — spec §3) |
| D-LICENSED | Licensed/authorized third-party provider data |
| D-GRAPH-DERIVED | Derived relationship/graph facts from other agents' output |

**Fleet-wide prohibition (applies to every agent below, not repeated per-agent):** no agent may
access, infer, or target on protected or highly sensitive personal characteristics (health,
religion, sexual orientation, disability, immigration status, precise home address/financial
account numbers) for fundraising solicitation purposes, per spec §19. Public availability of a
fact alone never grants unrestricted permissible use. Each agent's **Prohibited data classes**
field below lists only *additional*, agent-specific restrictions beyond this fleet-wide baseline.

**Autonomy levels** (spec §9): A0 Observe Only · A1 Research & Recommend · A2 Prepare & Queue · A3
Autonomous Reversible Execution · A4 Policy-Bounded Autonomous Execution. **Human boundaries**: H1
Human Approval Required · H2 Human Execution Required. No agent may increase its own autonomy
level or approve its own authority increase (spec §9/§12) — this is enforced by the deterministic
Policy Enforcement service, not by agent self-restraint.

**Delegation** (spec §8): every delegation is a typed `pil_delegated_tasks` row. A child agent
cannot exceed its parent's authority, cannot rewrite the parent's objective, and delegation depth
is bounded by `pil_delegation_budgets.max_delegation_depth` (default 5) — enforced deterministically,
not by agent discretion.

---

# FAMILY 1 — SUPERVISORY & ORCHESTRATION (6 agents)

The supervisory layer owns persistent objectives, decides what research happens next, and can
stop, redirect, deepen, or terminate any research path (spec §6/§16).

## BEN-SUP-01 — Chief Prospect Intelligence Orchestrator

- **Mission:** Own the persistent prospect-intelligence objective for each tenant and coordinate the entire research fleet.
- **Autonomy:** default **A4** — **Human boundary:** H1 for strategic changes outside tenant policy (e.g. widening scope beyond the tenant's configured cause/geography bounds).
- **Cadence:** Continuous.
- **Inputs:** User objectives (natural-language or structured), tenant digital twin, `pil_prospects`/`pil_prospect_opportunities` inventory, `pil_research_goals` state, `pil_agent_runs` performance history, `pil_cost_ledger`.
- **Outputs:** Active `pil_research_goals` rows, `pil_delegated_tasks` fan-out to specialists, priority changes on existing goals, stop/research-more decisions, `pil_human_review_queue` escalations, final intelligence packages (digital twin summaries).
- **Permitted tools:** T-DELEGATE, T-GRAPH (read), T-COST (read), T-MODEL, T-WORKFLOW, T-NOTIFY.
- **Permitted data classes:** D-CRM-FIRSTPARTY, D-GRAPH-DERIVED (aggregate only — this agent reasons over portfolio state, not raw source content). **Prohibited:** direct source scraping (delegates all primary research; never calls T-WEB/T-CRAWL/T-BROWSER itself).
- **Planning behavior:** Maintains a rolling portfolio plan across all active `pil_research_goals` for the tenant; replans on every significant state change (new prospect discovered, goal satisfied, budget threshold crossed, critic block).
- **Observation behavior:** Polls `pil_research_goals`, `pil_agent_runs`, and `pil_cost_ledger` continuously via the Durable Workflow Orchestrator's event bus; observes on every `pil_agent_run_events` completion/escalation event.
- **Replanning triggers:** New high-value prospect discovered; a specialist escalates; Portfolio Allocator recommends reallocation; cost budget threshold crossed; a monitoring trigger fires on a `MONITORING`-state goal; human review decision returned.
- **Delegation permissions:** May delegate to any Discovery, Prospect Intelligence, Relationship, Qualification, or Strategy agent. Cannot delegate to Knowledge Integrity agents directly (delegates through BEN-KNW-01 as the entry point) or to itself.
- **Success criteria:** Portfolio research value (spec §17 Outcome Success) trending upward; no `pil_research_goals` stuck in an active state past its staleness threshold without a decision.
- **Failure criteria:** A tenant's research portfolio has zero active goals for longer than the tenant's configured idle threshold with unresolved discovery backlog; repeated (3+) failed delegations to the same specialist without recovery.
- **Escalation conditions:** Any action that would exceed tenant policy scope; irreconcilable conflict between Portfolio Allocator and Research Strategy Architect recommendations; budget hard-stop reached.
- **Memory scope:** org (persistent across the tenant's full portfolio; survives process restarts via `pil_research_goals`/`pil_agent_runs`, not in-process state).
- **Token budget:** 40,000 tokens / planning cycle.
- **Financial budget:** $5.00 / day / org, configurable via `pil_cost_budgets` (scope_type='org').
- **Evaluation suite:** portfolio-value trend (qualified prospects / week vs. prior period); goal-staleness rate; delegation success rate; budget adherence (spend vs. `pil_cost_budgets`); time-to-decision on new discoveries.

## BEN-SUP-02 — Research Strategy Architect

- **Mission:** Transform broad fundraising objectives into evidence-driven prospect-research strategies.
- **Autonomy:** default **A2** — **Human boundary:** H1 for fundamental fundraising strategy changes (e.g. redefining the tenant's core cause taxonomy).
- **Cadence:** On demand (triggered by a new natural-language objective) + periodic review (weekly).
- **Inputs:** Raw fundraising objective (natural language or structured), tenant digital twin, prior strategy performance from BEN-OPS-01.
- **Outputs:** Structured research strategy (geography, prospect classes, cause taxonomy, time range, evidence requirements, capacity thresholds, relationship requirements, search strategy, qualification gates) written to `pil_research_goals.objective`/`structured_plan` fields via a new `pil_research_runs` row.
- **Permitted tools:** T-MODEL, T-GRAPH (read), T-DELEGATE (to BEN-SUP-03 only).
- **Permitted data classes:** D-CRM-FIRSTPARTY, D-PUBLIC-BIO (aggregate/taxonomy reference only).
- **Planning behavior:** Decomposes the objective into named research dimensions before any specialist is invoked; treats the strategy as revisable, not fixed.
- **Observation behavior:** Reviews BEN-OPS-01's routing/strategy-performance reports on its weekly cadence; observes qualification-rate trends per active strategy.
- **Replanning triggers:** BEN-OPS-01 flags a strategy dimension as underperforming; user issues a revised objective; qualification rate for the current strategy falls below the tenant's configured floor.
- **Delegation permissions:** May delegate exactly one task per invocation: hand the finalized strategy to BEN-SUP-03 (Cross-Agent Research Planner) for execution planning. No other delegation.
- **Success criteria:** Strategy decomposition is complete (all required dimensions populated) and passes BEN-SUP-05 critic review before execution begins.
- **Failure criteria:** Strategy produces a research plan the Cross-Agent Research Planner cannot decompose into assignable specialist work (ambiguous geography, unresolvable cause taxonomy).
- **Escalation conditions:** Objective requests research outside tenant policy scope; objective is ambiguous after one clarification attempt.
- **Memory scope:** org (strategy history retained per tenant to inform future strategy revisions).
- **Token budget:** 15,000 tokens / strategy.
- **Financial budget:** $0.75 / strategy.
- **Evaluation suite:** downstream qualification rate per strategy; critic pass rate on first submission; time from objective to actionable plan.

## BEN-SUP-03 — Cross-Agent Research Planner

- **Mission:** Convert research strategy into dependency-aware multi-agent execution plans.
- **Autonomy:** default **A4** — **Human boundary:** H1 for workflows requiring actions beyond research authority (e.g. any step that would touch CRM write access or outbound contact).
- **Cadence:** Per objective / replan.
- **Inputs:** Finalized strategy from BEN-SUP-02, `pil_agent_registry` (which specialists exist and their current load), `pil_delegation_budgets`.
- **Outputs:** A dependency-ordered `pil_research_run_steps` skeleton and the initial batch of `pil_delegated_tasks` for parallelizable branches (e.g. Individual/Foundation/Board/Giving/Business Intelligence run concurrently; entity reconciliation → affinity → relationship → qualification run after).
- **Permitted tools:** T-DELEGATE, T-WORKFLOW, T-GRAPH (read).
- **Permitted data classes:** D-CRM-FIRSTPARTY, D-GRAPH-DERIVED.
- **Planning behavior:** Builds an explicit DAG of specialist assignments before issuing any delegation; identifies which branches can run in parallel vs. which have hard dependencies (e.g. qualification cannot start before entity reconciliation).
- **Observation behavior:** Watches `pil_delegated_tasks.status` transitions for every task it issued; observes redundant-research risk by checking existing `pil_evidence` before assigning new research on the same claim.
- **Replanning triggers:** A delegated branch fails or times out; a dependency's output changes the shape of downstream work (e.g. entity reconciliation discovers a merge that invalidates in-flight parallel research); Portfolio Allocator reprioritizes mid-plan.
- **Delegation permissions:** May delegate to any Discovery, Prospect Intelligence, Relationship, or Qualification agent. Bounded recursion: a plan step delegated by this agent may itself delegate one further level (e.g. BEN-INT-06 delegating a sub-check to BEN-KNW-03) but no deeper without escalation.
- **Success criteria:** All plan branches reach a terminal `pil_delegated_tasks.status` (completed/failed/cancelled) with no orphaned tasks past deadline.
- **Failure criteria:** Plan produces a delegation cycle (detected via `delegation_depth` bound violation) or redundant research on an already-fresh claim.
- **Escalation conditions:** Plan requires a fan-out beyond `pil_delegation_budgets.max_fanout_per_task`; a branch requests authority beyond A2 without prior tenant policy grant.
- **Memory scope:** run (plan state scoped to the research run; historical plans retained in `pil_research_runs.structured_plan` for reuse-pattern learning by BEN-OPS-01).
- **Token budget:** 20,000 tokens / plan.
- **Financial budget:** $1.00 / plan (excludes delegated specialists' own budgets).
- **Evaluation suite:** redundant-research rate (research reissued on already-fresh evidence); plan-completion rate without orphaned tasks; parallel-branch wall-clock efficiency vs. serial baseline.

## BEN-SUP-04 — Research Portfolio Allocator

- **Mission:** Allocate research resources toward prospects with the highest expected fundraising intelligence value.
- **Autonomy:** default **A3** — **Human boundary:** H1 for budget increases beyond tenant-configured limits.
- **Cadence:** Continuous / daily rebalance.
- **Inputs:** `pil_prospects`/`pil_prospect_opportunities` inventory with current evidence completeness, `pil_cost_ledger`, `pil_research_goals` priority field.
- **Outputs:** Updated `pil_research_goals.priority` values; suspend/resume decisions (goal state → `PAUSED` or reactivated); depth-increase delegations for high-value candidates.
- **Permitted tools:** T-DELEGATE (priority-change only, not new research kickoff), T-COST (read), T-GRAPH (read).
- **Permitted data classes:** D-GRAPH-DERIVED, D-CRM-FIRSTPARTY.
- **Planning behavior:** Runs a marginal-value comparison across the full active portfolio each cycle (spec §16's worked example): estimates incremental research value per remaining dollar/token against each candidate's current evidence completeness.
- **Observation behavior:** Observes `pil_prospect_digital_twins.completeness_score` and `pil_cost_ledger` spend velocity per prospect continuously.
- **Replanning triggers:** A prospect crosses a completeness threshold (research value declining); new evidence reopens a previously suspended prospect (spec §10 `REOPENED` state); daily rebalance cadence fires.
- **Delegation permissions:** May issue depth-increase `pil_delegated_tasks` to any specialist already active on a prospect; cannot originate brand-new discovery work (that is BEN-SUP-01/03's role).
- **Success criteria:** Portfolio-wide research spend correlates positively with qualified-prospect yield (measured by BEN-OPS-01); no candidate receives unbounded investigation.
- **Failure criteria:** A low-value candidate continues consuming budget past 2 consecutive cycles of declining marginal value without being suspended.
- **Escalation conditions:** Rebalance would require a budget increase beyond the org's `pil_cost_budgets.budget_limit_usd`.
- **Memory scope:** org (portfolio allocation history retained to detect systematic misallocation patterns).
- **Token budget:** 10,000 tokens / daily cycle.
- **Financial budget:** $0.50 / daily cycle (excludes reallocated specialist budgets).
- **Evaluation suite:** marginal-value-per-dollar trend; suspend/resume accuracy (did suspended prospects later prove low-value); reopened-prospect yield rate.

## BEN-SUP-05 — Prospect Research Critic & Red-Team Agent

- **Mission:** Independently challenge consequential research findings before they become trusted intelligence.
- **Autonomy:** default **A2** — **Human boundary:** H1; cannot override policy or certify its own prior work (spec §12: a research-producing agent cannot certify its own high-impact conclusions — this agent must run in a context separate from the agent whose work it reviews).
- **Cadence:** Per consequential dossier (any prospect approaching `TIER_1_PRIORITY`/`TIER_2_CULTIVATE` classification, or any `pil_evidence` row flagged `verification_status IN ('reasoned_inference','estimate')` feeding a capacity or giving conclusion).
- **Inputs:** The candidate dossier (digital twin + underlying `pil_evidence` + `pil_graph_edges`), independent re-retrieval of cited sources.
- **Outputs:** One of `PASS`/`PASS_WITH_CAVEATS`/`RESEARCH_MORE`/`BLOCK_INSUFFICIENT_EVIDENCE`/`BLOCK_ENTITY_AMBIGUITY`/`BLOCK_POLICY`, written to `pil_agent_run_events` and, on any `BLOCK_*`, a `pil_human_review_queue` row (review_type='critic_block').
- **Permitted tools:** T-MODEL, T-EVIDENCE (read), T-CRAWL (independent re-verification only), T-GRAPH (read).
- **Permitted data classes:** Same as the dossier under review (D-PUBLIC-BIO, D-PUBLIC-FILING, D-PUBLIC-NEWS, D-PUBLIC-BIZ, D-WEALTH-INFERRED, D-LICENSED). **Prohibited:** may not write to `pil_prospect_digital_twins` or `pil_evidence` directly — findings only, never silent corrections.
- **Planning behavior:** For each dossier, plans a targeted challenge list (unsupported claims, entity-confusion risk, circular sourcing, staleness, causation leaps) rather than re-deriving the dossier from scratch.
- **Observation behavior:** Re-fetches a sample of cited sources independently rather than trusting the excerpt stored in `pil_evidence`; observes whether the excerpt still supports the claim.
- **Replanning triggers:** Initial spot-check surfaces one confirmed defect — expands the challenge to a full pass of that dossier's evidence.
- **Delegation permissions:** May delegate a targeted re-verification task to BEN-KNW-03 (Evidence & Provenance Verification Agent). Cannot delegate the certification decision itself.
- **Success criteria:** Every `BLOCK_*` verdict is defensible against a second independent reviewer sample (measured by BEN-OPS-01); no consequential dossier reaches `TIER_1_PRIORITY` without a critic pass on record.
- **Failure criteria:** Critic issues a `PASS` on a dossier later found (via human correction or outcome data) to contain an unsupported material claim.
- **Escalation conditions:** `BLOCK_POLICY` verdict (always routes to human review, never auto-resolved); repeated `BLOCK_ENTITY_AMBIGUITY` on the same prospect (routes to BEN-KNW-02).
- **Memory scope:** run (fresh context per review — no memory of the producing agent's reasoning, by design, to preserve independence).
- **Token budget:** 12,000 tokens / dossier review.
- **Financial budget:** $0.60 / dossier review.
- **Evaluation suite:** false-pass rate (later-discovered defects in passed dossiers); false-block rate (human overturns a block); inter-reviewer agreement on a held-out sample.

## BEN-SUP-06 — Research Recovery Investigator

- **Mission:** Diagnose failed, incomplete, contradictory, or corrupted research workflows and determine the safest recovery path.
- **Autonomy:** default **A3** — **Human boundary:** H1/H2 for irreversible destructive recovery (e.g. discarding a partially-completed research run's evidence rather than salvaging it).
- **Cadence:** Event-driven (triggered by a `pil_agent_runs.status = 'failed'`, a `pil_research_runs.status = 'failed'`, a Durable Workflow Orchestration dead-letter event, or a detected duplicate-execution signature).
- **Inputs:** The failed workflow's `pil_agent_runs`/`pil_research_run_steps` history, `pil_agent_run_events` error payloads, connector health from the Connector Gateway.
- **Outputs:** A recovery recommendation (resume/retry/rollback/salvage-partial/abandon) and, if authorized at A3, the resume/retry action itself via T-WORKFLOW.
- **Permitted tools:** T-WORKFLOW, T-GRAPH (read), T-COST (read), T-EVIDENCE (read).
- **Permitted data classes:** D-CRM-FIRSTPARTY, D-GRAPH-DERIVED (operational metadata, not new source research).
- **Planning behavior:** Classifies the failure mode first (connector outage, timeout, duplicate execution, graph corruption, budget exhaustion) before choosing a recovery strategy — different classes have different safe defaults.
- **Observation behavior:** Checks whether evidence already collected before the failure remains valid/reusable versus needing re-verification (staleness check).
- **Replanning triggers:** Chosen recovery strategy itself fails (e.g. resume retried and failed again) — escalates rather than looping indefinitely (bounded retry, matches `max_retries_per_prompt`-style ceilings used elsewhere in this codebase's FORGE queues).
- **Delegation permissions:** May delegate a targeted re-verification to the original specialist agent for the specific failed step only, not the full research run.
- **Success criteria:** Recoverable failures resume without data loss; unrecoverable failures are correctly classified as such rather than retried indefinitely.
- **Failure criteria:** A recovery action causes duplicate evidence rows or double-charges the cost ledger for the same work (idempotency violation).
- **Escalation conditions:** Any recovery path that would delete or overwrite existing `pil_evidence` rows; 3 consecutive recovery attempts on the same failure signature.
- **Memory scope:** org (failure-pattern history retained to recognize recurring connector/infra issues).
- **Token budget:** 8,000 tokens / investigation.
- **Financial budget:** $0.30 / investigation.
- **Evaluation suite:** recovery success rate; duplicate-execution incidence post-recovery; mean time to recovery decision.

---

# FAMILY 2 — DISCOVERY (8 agents)

Discovery agents surface candidate prospects; they do not build full dossiers (that is Family 3's
job) — output is a ranked candidate list with preliminary evidence and research justification.

## BEN-DIS-01 — Individual Prospect Discovery Agent

- **Mission:** Discover individual philanthropic prospects matching tenant-defined fundraising objectives.
- **Autonomy:** default **A2**. **Human boundary:** none beyond standard A2 (dossiers/candidates only, no outreach).
- **Cadence:** Continuous / on demand.
- **Inputs:** Active strategy from BEN-SUP-02/03 (geography, cause alignment, professional-position criteria), existing `pil_prospects` to avoid re-discovering known entities.
- **Outputs:** Ranked candidate `pil_prospects` rows (entity_type='individual') with preliminary `pil_evidence`.
- **Permitted tools:** T-WEB, T-CRAWL, T-NEWS, T-GRAPH (write: new nodes only), T-EVIDENCE (write), T-MODEL.
- **Permitted data classes:** D-PUBLIC-BIO, D-PUBLIC-NEWS, D-PUBLIC-BIZ, D-CRM-FIRSTPARTY (dedup check only).
- **Planning behavior:** Plans search queries across geography × cause × professional-position dimensions; deduplicates against existing prospects before creating new candidate rows.
- **Observation behavior:** Observes result density per query dimension; abandons a dimension yielding no new candidates after 3 consecutive empty searches.
- **Replanning triggers:** A dimension is exhausted; strategy is revised mid-run; a discovered candidate looks like a probable duplicate of an existing prospect (routes to BEN-KNW-02 rather than guessing).
- **Delegation permissions:** May delegate entity-resolution ambiguity to BEN-KNW-02. Cannot delegate discovery itself further.
- **Success criteria:** Candidates surfaced convert to `RESEARCH_MORE` or better qualification at a rate above the tenant's historical baseline (tracked by BEN-OPS-01).
- **Failure criteria:** High duplicate-creation rate (should route to BEN-KNW-02 dedup instead of creating a new prospect row).
- **Escalation conditions:** A discovered individual's profile suggests a protected-characteristic-only match signal (fleet-wide prohibition) — discard the candidate and log, do not escalate for approval.
- **Memory scope:** run, with a rolling org-scoped dedup index (prospect names/aliases already known) consulted every run.
- **Token budget:** 18,000 tokens / run.
- **Financial budget:** $0.80 / run.
- **Evaluation suite:** candidate-to-qualified conversion rate; duplicate-creation rate; search-dimension yield curve.

## BEN-DIS-02 — Major Donor Discovery Agent

- **Mission:** Identify individuals with evidence suggesting capacity and propensity for significant philanthropic giving.
- **Autonomy:** default **A2**.
- **Cadence:** Continuous / on demand.
- **Inputs:** Active strategy, public charitable-history sources, existing foundation-relationship graph edges.
- **Outputs:** Ranked candidates flagged for deep capacity research (routed to BEN-INT-08/BEN-QLF-03), never a capacity number itself.
- **Permitted tools:** T-WEB, T-NEWS, T-990, T-GRAPH (read/write nodes), T-EVIDENCE (write).
- **Permitted data classes:** D-PUBLIC-FILING, D-PUBLIC-NEWS, D-PUBLIC-BIO.
- **Planning behavior:** Searches for prior-gift-magnitude signals and foundation-relationship overlap before flagging a candidate; explicitly does not treat wealth alone (e.g. a Forbes-list mention with no giving signal) as sufficient — spec §6 "Important rule: Wealth alone does not establish donor propensity."
- **Observation behavior:** Cross-checks each capacity signal against at least one giving-behavior signal before flagging.
- **Replanning triggers:** A candidate has strong wealth signal but zero giving signal after a full search pass — reclassify as lower priority rather than flag for deep research.
- **Delegation permissions:** May delegate a flagged candidate to BEN-INT-08 (Wealth & Capacity Intelligence) for deep research; cannot delegate to Strategy family directly.
- **Success criteria:** Flagged candidates show materially higher qualification rate than the general Individual Discovery pool.
- **Failure criteria:** Flags candidates on wealth-only signal without a giving-behavior corroborant, contradicting the agent's own mission rule.
- **Escalation conditions:** none beyond standard A2.
- **Memory scope:** run + org-scoped dedup index.
- **Token budget:** 20,000 tokens / run.
- **Financial budget:** $1.00 / run.
- **Evaluation suite:** wealth-only false-flag rate; flagged-candidate qualification conversion; precision vs. BEN-INT-08's eventual capacity finding.

## BEN-DIS-03 — Foundation Discovery Agent

- **Mission:** Discover private, family, corporate, and community foundations aligned with tenant programs.
- **Autonomy:** default **A2**.
- **Cadence:** Continuous / on demand.
- **Inputs:** Tenant program taxonomy, cause alignment criteria, geographic scope.
- **Outputs:** Ranked candidate `pil_prospects` rows (entity_type in foundation classes) with stated priorities, historical grants summary, geographic limitations, trustees/officers.
- **Permitted tools:** T-WEB, T-990, T-PUBREC, T-GRAPH (write), T-EVIDENCE (write).
- **Permitted data classes:** D-PUBLIC-FILING, D-PUBLIC-BIO (trustee/officer names).
- **Planning behavior:** Searches Form 990 filings and public foundation databases by program-area and geography before general web search, since filings are the highest-authority source for this agent's mission.
- **Observation behavior:** Confirms stated priorities against actual historical grant recipients (a foundation's mission statement and its real giving pattern can diverge — flags divergence as a note, not a disqualifier).
- **Replanning triggers:** A foundation's most recent filing is stale (>2 fiscal years) — flags for BEN-KNW-04 freshness follow-up rather than treating current-year data as certain.
- **Delegation permissions:** May delegate trustee/officer identity resolution to BEN-KNW-02.
- **Success criteria:** Discovered foundations show real, evidenced program-area alignment with the tenant, not keyword-only matches.
- **Failure criteria:** Surfaces a foundation whose 990 shows an explicit exclusion matching the tenant's cause (should have been filtered).
- **Escalation conditions:** none beyond standard A2.
- **Memory scope:** run + org-scoped dedup index.
- **Token budget:** 18,000 tokens / run.
- **Financial budget:** $0.80 / run (990 retrieval may carry a per-document licensed-data cost depending on provider).
- **Evaluation suite:** stated-vs-actual-priority divergence rate; alignment precision (spot-checked against actual grant history); staleness-flag accuracy.

## BEN-DIS-04 — Corporate Giving Discovery Agent

- **Mission:** Identify companies with relevant charitable-giving, sponsorship, employee-giving, or community-investment programs.
- **Autonomy:** default **A2**.
- **Cadence:** Continuous / on demand.
- **Inputs:** Active strategy, geography, cause alignment.
- **Outputs:** Corporate opportunity candidates (`pil_prospects`, entity_type='corporation') plus eligibility rationale.
- **Permitted tools:** T-WEB, T-EDGAR, T-CRAWL, T-GRAPH (write), T-EVIDENCE (write).
- **Permitted data classes:** D-PUBLIC-BIZ, D-PUBLIC-FILING.
- **Planning behavior:** Searches for corporate foundations, CSR pages, matching-gift and volunteer-grant program pages as distinct sub-searches, since each is evidenced differently.
- **Observation behavior:** Confirms a program is currently active (not a discontinued/legacy CSR page) before flagging.
- **Replanning triggers:** A company's CSR page is unreachable/stale — falls back to EDGAR filings or news mentions of the program before giving up.
- **Delegation permissions:** May delegate executive-level detail to BEN-DIS-05.
- **Success criteria:** Flagged companies have a verifiably active giving program at time of discovery.
- **Failure criteria:** Flags a company on a stale/discontinued program page.
- **Escalation conditions:** none beyond standard A2.
- **Memory scope:** run + org-scoped dedup index.
- **Token budget:** 16,000 tokens / run.
- **Financial budget:** $0.70 / run.
- **Evaluation suite:** program-currency accuracy (active vs. stale at discovery time); eligibility-rationale completeness.

## BEN-DIS-05 — Executive Prospect Discovery Agent

- **Mission:** Identify executives, founders, owners, and senior decision-makers who may have philanthropic relevance.
- **Autonomy:** default **A2**.
- **Cadence:** Continuous / on demand.
- **Inputs:** Corporate candidates from BEN-DIS-04, geographic/cause strategy.
- **Outputs:** Executive candidate `pil_prospects` rows linked (via `pil_graph_edges`, edge_type='employed_by') to their companies, with nonprofit-board involvement flagged where found.
- **Permitted tools:** T-WEB, T-CRAWL, T-GRAPH (read/write), T-EVIDENCE (write).
- **Permitted data classes:** D-PUBLIC-BIO, D-PUBLIC-BIZ.
- **Planning behavior:** Prioritizes executives with a documented external nonprofit-board seat over those with none, since board involvement is the strongest early philanthropic-relevance signal available at discovery stage.
- **Observation behavior:** Confirms current role (not a former title still indexed by search) before creating the employment edge.
- **Replanning triggers:** Company leadership page contradicts a news-derived title — routes to BEN-KNW-04 rather than picking one silently.
- **Delegation permissions:** May delegate board-membership verification to BEN-INT-05.
- **Success criteria:** Employment edges reflect current, not historical, roles at time of creation.
- **Failure criteria:** Creates a stale employment edge without a temporal_validity_end when a role has clearly ended.
- **Escalation conditions:** none beyond standard A2.
- **Memory scope:** run + org-scoped dedup index.
- **Token budget:** 16,000 tokens / run.
- **Financial budget:** $0.70 / run.
- **Evaluation suite:** role-currency accuracy; board-overlap discovery rate vs. later confirmed by BEN-INT-05.

## BEN-DIS-06 — Geographic Funding Discovery Agent

- **Mission:** Discover prospects based on geographic relevance (e.g. "Texas philanthropists," "within 150 miles of Austin").
- **Autonomy:** default **A2**.
- **Cadence:** Continuous / on demand.
- **Inputs:** Parsed geographic constraint from the natural-language interface (radius, state, region), cause taxonomy.
- **Outputs:** Candidates and local foundations matching the resolved geographic footprint.
- **Permitted tools:** T-WEB, T-990, T-PUBREC, T-GRAPH (write), T-EVIDENCE (write).
- **Permitted data classes:** D-PUBLIC-FILING, D-PUBLIC-BIO, D-PUBLIC-BIZ.
- **Planning behavior:** Resolves the geographic constraint to a concrete boundary (geocoded radius or jurisdiction list) before searching, rather than treating "Texas" or "150 miles of Austin" as a keyword.
- **Observation behavior:** Confirms a candidate's operating footprint (not just a mailing address) actually falls within the resolved boundary.
- **Replanning triggers:** Geocoding is ambiguous (e.g. a company headquartered elsewhere but with a major regional office in-boundary) — flags the ambiguity rather than silently including/excluding.
- **Delegation permissions:** May delegate cause-alignment refinement to BEN-DIS-07.
- **Success criteria:** Zero candidates outside the resolved geographic boundary in the output set.
- **Failure criteria:** Geocoding ambiguity silently resolved without a note in `pil_prospect_classifications` (dimension='geography').
- **Escalation conditions:** none beyond standard A2.
- **Memory scope:** run.
- **Token budget:** 15,000 tokens / run.
- **Financial budget:** $0.60 / run.
- **Evaluation suite:** boundary-accuracy rate (spot-check candidates against resolved geography); ambiguity-flag rate.

## BEN-DIS-07 — Cause-Aligned Prospect Discovery Agent

- **Mission:** Discover prospects whose documented charitable interests align with the tenant's mission.
- **Autonomy:** default **A2**.
- **Cadence:** Continuous / on demand.
- **Inputs:** Tenant cause taxonomy (affordable housing, homelessness, recovery, reentry, workforce development, education, veterans, community development, poverty reduction, etc.), existing giving-history evidence.
- **Outputs:** Prospects with evidence-supported mission alignment, written as `pil_prospect_classifications` rows (dimension='cause').
- **Permitted tools:** T-WEB, T-990, T-NEWS, T-GRAPH (write), T-EVIDENCE (write).
- **Permitted data classes:** D-PUBLIC-FILING, D-PUBLIC-NEWS, D-PUBLIC-BIO.
- **Planning behavior:** Requires at least one documented giving/board/statement signal per cause tag — never tags a prospect to a cause on inferred affinity alone at discovery stage (that inference belongs to BEN-QLF-01 downstream).
- **Observation behavior:** Distinguishes a one-time gift from a sustained cause commitment when assigning confidence.
- **Replanning triggers:** A cause-tag candidate has only a single, old (>5 year) signal — lowers confidence rather than treating it as current alignment.
- **Delegation permissions:** none beyond standard research delegation to Knowledge Integrity for evidence verification.
- **Success criteria:** Every cause tag traces to at least one `pil_evidence` row.
- **Failure criteria:** A cause tag with zero linked evidence exists in `pil_prospect_classifications`.
- **Escalation conditions:** none beyond standard A2.
- **Memory scope:** run + org-scoped cause-taxonomy reference.
- **Token budget:** 15,000 tokens / run.
- **Financial budget:** $0.60 / run.
- **Evaluation suite:** evidence-linkage completeness (100% target); recency-weighted confidence accuracy.

## BEN-DIS-08 — Hidden Prospect & CRM Rediscovery Agent

- **Mission:** Identify overlooked high-potential prospects already present within first-party organizational data.
- **Autonomy:** default **A2** — **Human boundary:** no automatic solicitation escalation (spec §6: reclassification only, never triggers outreach itself).
- **Cadence:** Continuous / on demand, plus triggered on new CRM import.
- **Inputs:** Tenant's own CRM records (`pil_prospects` sourced `source_of_record='crm_import'` and existing organizational CRM connector), current giving totals on file.
- **Outputs:** Reclassification flags on existing `pil_prospects` rows (e.g. a nominal $100/year donor flagged for major-donor review) with supporting new evidence.
- **Permitted tools:** T-CRM (read), T-WEB, T-GRAPH (read/write), T-EVIDENCE (write).
- **Permitted data classes:** D-CRM-FIRSTPARTY, D-PUBLIC-BIZ, D-PUBLIC-FILING.
- **Planning behavior:** Scans existing CRM records for external-wealth/board signals (company ownership, foundation board seats) not reflected in the CRM's own giving-tier field, then verifies externally before flagging.
- **Observation behavior:** Compares CRM-recorded giving level against newly discovered external capacity/affiliation signals; only flags when there's a material gap.
- **Replanning triggers:** A flagged record turns out to already have an open `pil_prospect_opportunities` row — merges rather than duplicating.
- **Delegation permissions:** May delegate capacity verification to BEN-INT-08.
- **Success criteria:** Flagged reclassifications show materially higher true-positive rate than cold discovery (since these are already known, engaged entities).
- **Failure criteria:** Flags a reclassification with no new external evidence beyond what the CRM already contained.
- **Escalation conditions:** none beyond standard A2; explicitly never escalates to solicitation.
- **Memory scope:** org (full CRM-derived prospect history retained for longitudinal reclassification).
- **Token budget:** 15,000 tokens / run.
- **Financial budget:** $0.60 / run.
- **Evaluation suite:** reclassification true-positive rate; dormant-opportunity surfacing rate; duplicate-flag rate.

---

# FAMILY 3 — CORE PROSPECT INTELLIGENCE (10 agents)

Builds the canonical evidence-backed dossier once a prospect exists. Every output here is a
`pil_evidence` row (or several) plus updates to the prospect's `pil_prospect_digital_twins` row —
never a bare, uncited assertion (spec §11).

## BEN-INT-01 — Individual Intelligence Agent

- **Mission:** Build the canonical evidence-backed biographical intelligence profile for an individual prospect.
- **Autonomy:** default **A2**.
- **Cadence:** Per prospect, on discovery + on monitoring-triggered refresh.
- **Inputs:** Prospect identity from `pil_prospects`, existing `pil_evidence`.
- **Outputs:** Identity, geography, career summary, public biography, community-participation, philanthropic-activity fields on `pil_prospect_digital_twins.identity`/`.biography`, each field evidence-linked.
- **Permitted tools:** T-WEB, T-CRAWL, T-NEWS, T-EVIDENCE (write), T-GRAPH (write).
- **Permitted data classes:** D-PUBLIC-BIO, D-PUBLIC-NEWS.
- **Planning behavior:** Builds the profile section by section (identity → geography → career → biography → community), stopping a section once corroborated by 2 independent sources or exhausting reasonable search depth.
- **Observation behavior:** Checks whether newly retrieved facts corroborate or contradict existing `pil_evidence`; routes contradictions to BEN-KNW-04 rather than overwriting.
- **Replanning triggers:** A section yields insufficient evidence (single unverifiable source) — widens the search before accepting `single_source_fact` status.
- **Delegation permissions:** May delegate career depth to BEN-INT-02, education to BEN-INT-04.
- **Success criteria:** Every biographical claim in the digital twin has a `pil_evidence` row with `verification_status` at least `single_source_fact`.
- **Failure criteria:** A claim in `pil_prospect_digital_twins.biography` with no backing evidence row (a hard invariant checked by BEN-KNW-03).
- **Escalation conditions:** Identity ambiguity that basic string matching can't resolve — routes to BEN-KNW-02.
- **Memory scope:** prospect (retains this prospect's research history across runs to avoid re-searching corroborated facts).
- **Token budget:** 14,000 tokens / prospect.
- **Financial budget:** $0.60 / prospect.
- **Evaluation suite:** evidence-linkage completeness (100% target); corroboration rate (% of claims with 2+ sources); contradiction-routing accuracy.

## BEN-INT-02 — Employment & Career Intelligence Agent

- **Mission:** Reconstruct the prospect's relevant professional history.
- **Autonomy:** default **A2**.
- **Cadence:** Per prospect, on discovery + monitoring refresh.
- **Inputs:** Prospect identity, existing employment `pil_graph_edges` (edge_type='employed_by').
- **Outputs:** Time-aware professional chronology — a sequence of employment edges with `temporal_validity_start`/`_end` and role/seniority in `properties`.
- **Permitted tools:** T-WEB, T-CRAWL, T-EDGAR, T-EVIDENCE (write), T-GRAPH (write).
- **Permitted data classes:** D-PUBLIC-BIO, D-PUBLIC-BIZ.
- **Planning behavior:** Orders search by recency (current role first, then works backward) rather than searching all history at once, so the highest-value (current) data is verified first under any budget cutoff.
- **Observation behavior:** Detects gaps or overlaps in the reconstructed timeline and searches specifically to resolve them rather than leaving silent gaps.
- **Replanning triggers:** A gap or overlap is detected in the chronology.
- **Delegation permissions:** May delegate business-ownership depth to BEN-INT-03.
- **Success criteria:** Chronology has no unexplained gap greater than 1 year without a note.
- **Failure criteria:** Two overlapping "current" roles left unresolved in the graph.
- **Escalation conditions:** none beyond standard A2.
- **Memory scope:** prospect.
- **Token budget:** 12,000 tokens / prospect.
- **Financial budget:** $0.50 / prospect.
- **Evaluation suite:** timeline-gap rate; overlap-resolution rate; current-role accuracy.

## BEN-INT-03 — Business Ownership Intelligence Agent

- **Mission:** Investigate documented ownership, founder, partnership, and significant business relationships.
- **Autonomy:** default **A2**.
- **Cadence:** Per prospect, on discovery + monitoring refresh (especially `acquisition`/`company_sale` triggers).
- **Inputs:** Prospect identity, employment chronology from BEN-INT-02.
- **Outputs:** Ownership/founder edges (`pil_graph_edges`, edge_type='owns') with acquisition/sale events noted in `properties`.
- **Permitted tools:** T-WEB, T-EDGAR, T-PUBREC, T-EVIDENCE (write), T-GRAPH (write).
- **Permitted data classes:** D-PUBLIC-BIZ, D-PUBLIC-FILING.
- **Planning behavior:** Searches state business-registry and SEC sources before general web search, since these are the highest-authority sources for ownership claims.
- **Observation behavior:** Distinguishes a documented ownership stake from a mere directorship or advisory role — different edge semantics, not interchangeable.
- **Replanning triggers:** A claimed ownership stake can't be corroborated by a registry/filing source — downgrades to `reasoned_inference` rather than `verified_fact`.
- **Delegation permissions:** May delegate liquidity-event depth to BEN-INT-09.
- **Success criteria:** Ownership edges distinguish verified-by-filing from inferred-from-news.
- **Failure criteria:** An ownership edge presented as `verified_fact` with only a single unverifiable web source.
- **Escalation conditions:** none beyond standard A2.
- **Memory scope:** prospect.
- **Token budget:** 14,000 tokens / prospect.
- **Financial budget:** $0.60 / prospect (registry lookups may carry licensed-data cost).
- **Evaluation suite:** verification-status accuracy (spot-check filing-backed vs. inferred claims); ownership-edge precision.

## BEN-INT-04 — Education & Alumni Intelligence Agent

- **Mission:** Research educational affiliations relevant to relationship discovery or philanthropic behavior.
- **Autonomy:** default **A2**.
- **Cadence:** Per prospect, on discovery.
- **Inputs:** Prospect identity/biography.
- **Outputs:** Education edges (`pil_graph_edges`, edge_type='related_to', properties.relationship='alumnus_of'), alumni-board involvement, known institutional giving where documented.
- **Permitted tools:** T-WEB, T-CRAWL, T-EVIDENCE (write), T-GRAPH (write).
- **Permitted data classes:** D-PUBLIC-BIO, D-PUBLIC-FILING (institutional giving records where public).
- **Planning behavior:** Treats education data as a relationship-discovery input first, biography-completeness second — prioritizes searches likely to surface shared-alumni relationship value.
- **Observation behavior:** Confirms institution names against a canonical institution list (avoids "State University" ambiguity across states).
- **Replanning triggers:** Institution name ambiguous after initial search — narrows using graduation-era/degree-program context.
- **Delegation permissions:** none.
- **Success criteria:** Every education edge resolves to a disambiguated, real institution.
- **Failure criteria:** An ambiguous institution match left unresolved and used downstream for relationship pathfinding.
- **Escalation conditions:** none beyond standard A2.
- **Memory scope:** prospect.
- **Token budget:** 8,000 tokens / prospect.
- **Financial budget:** $0.30 / prospect.
- **Evaluation suite:** institution-disambiguation accuracy; downstream relationship-pathfinding usefulness (tracked via BEN-REL-05 pathway usage).

## BEN-INT-05 — Nonprofit Board Intelligence Agent

- **Mission:** Identify and verify nonprofit board memberships and leadership roles.
- **Autonomy:** default **A2**.
- **Cadence:** Per prospect, on discovery + monitoring refresh (`board_appointment` trigger).
- **Inputs:** Prospect identity.
- **Outputs:** Board/trustee/officer edges (`pil_graph_edges`, edge_type='serves_on_board_of'/'trustee_of').
- **Permitted tools:** T-WEB, T-990, T-EVIDENCE (write), T-GRAPH (write).
- **Permitted data classes:** D-PUBLIC-FILING, D-PUBLIC-BIO.
- **Planning behavior:** Primary evidence preference, in order: nonprofit website → Form 990 → official biography → other authoritative filing (spec §6 explicit ordering) — only falls back to general web search once these are exhausted.
- **Observation behavior:** Confirms current vs. past board status; a 990 is only as current as its filing year, so cross-checks against the org's live website when available.
- **Replanning triggers:** 990 and website disagree on current board composition — routes to BEN-KNW-04.
- **Delegation permissions:** none.
- **Success criteria:** Board edges cite the highest-authority source available (990/website preferred over secondary mentions).
- **Failure criteria:** A board edge sourced only from a low-authority mention when a 990 or org website was available and unchecked.
- **Escalation conditions:** none beyond standard A2.
- **Memory scope:** prospect.
- **Token budget:** 10,000 tokens / prospect.
- **Financial budget:** $0.40 / prospect.
- **Evaluation suite:** source-authority compliance rate (did it check 990/website before accepting a lesser source); current-vs-past accuracy.

## BEN-INT-06 — Foundation Intelligence Agent

- **Mission:** Develop detailed intelligence on foundations associated with prospects.
- **Autonomy:** default **A2**.
- **Cadence:** Per foundation prospect, on discovery + monitoring refresh (`new_foundation_filing`).
- **Inputs:** Foundation prospect identity.
- **Outputs:** Assets, officers, directors, trustees, grant history, geographic/cause priorities, recipient history, giving trends, application practices — written to the foundation's digital twin plus `pil_graph_edges` linking to trustees/officers.
- **Permitted tools:** T-990, T-WEB, T-EVIDENCE (write), T-GRAPH (write).
- **Permitted data classes:** D-PUBLIC-FILING, D-PUBLIC-BIO.
- **Planning behavior:** Builds a multi-year grant-history view (not just the latest filing) to detect genuine giving trend vs. single-year noise.
- **Observation behavior:** Cross-references stated program priorities against the actual grant-recipient list (same divergence check as BEN-DIS-03, at greater depth here).
- **Replanning triggers:** Fewer than 2 years of filing history available — flags trend confidence as low rather than asserting a trend.
- **Delegation permissions:** May delegate trustee identity resolution to BEN-KNW-02.
- **Success criteria:** Trend claims are backed by at least 2 years of filing data or explicitly marked low-confidence.
- **Failure criteria:** A "giving trend" claim asserted from a single fiscal year.
- **Escalation conditions:** none beyond standard A2.
- **Memory scope:** prospect.
- **Token budget:** 16,000 tokens / prospect.
- **Financial budget:** $0.70 / prospect.
- **Evaluation suite:** trend-confidence calibration; stated-vs-actual priority divergence detection rate.

## BEN-INT-07 — Giving History Intelligence Agent

- **Mission:** Reconstruct documented charitable-giving behavior.
- **Autonomy:** default **A2**.
- **Cadence:** Per prospect, on discovery + monitoring refresh (`major_charitable_gift`).
- **Inputs:** Prospect identity, foundation grant history from BEN-INT-06 where the prospect is a foundation officer/trustee.
- **Outputs:** Documented donations, magnitude, recipients, causes, geographic pattern, frequency, recency — kept in a distinct `pil_prospect_digital_twins.giving_history` array from `capacity` (never merged, per spec §6's explicit distinction).
- **Permitted tools:** T-WEB, T-NEWS, T-990, T-EVIDENCE (write).
- **Permitted data classes:** D-PUBLIC-FILING, D-PUBLIC-NEWS.
- **Planning behavior:** Records every found gift as a discrete, evidenced event rather than an aggregated total, preserving recipient/cause/date granularity for downstream affinity reasoning.
- **Observation behavior:** Flags any figure that appears only as an estimate/press-release round number (e.g. "$1 million commitment") as `estimate` status, not `verified_fact`, until a filing confirms it.
- **Replanning triggers:** A named gift can't be corroborated by a second source — downgrades status rather than dropping or asserting.
- **Delegation permissions:** none.
- **Success criteria:** giving_history contains zero entries that conflate documented giving with estimated capacity.
- **Failure criteria:** A capacity estimate leaks into the giving_history array (the exact conflation spec §6 prohibits).
- **Escalation conditions:** none beyond standard A2.
- **Memory scope:** prospect.
- **Token budget:** 12,000 tokens / prospect.
- **Financial budget:** $0.50 / prospect.
- **Evaluation suite:** giving/capacity conflation rate (target zero); verification-status accuracy on gift figures.

## BEN-INT-08 — Wealth & Capacity Intelligence Agent

- **Mission:** Evaluate evidence relevant to philanthropic capacity without treating estimated net worth as confirmed giving ability.
- **Autonomy:** default **A2** — **Human boundary:** H1 for sensitive/high-impact capacity determinations (any capacity range that would place a prospect in `TIER_1_PRIORITY` on capacity alone).
- **Cadence:** Per flagged prospect (from BEN-DIS-02 or BEN-DIS-08), on demand.
- **Inputs:** Business ownership (BEN-INT-03), giving history (BEN-INT-07), liquidity events (BEN-INT-09), public asset indicators.
- **Outputs:** Estimated capacity range, evidence, confidence, and explicit major uncertainties, distinguishing wealth / liquidity / philanthropic capacity / propensity as four separate fields, never collapsed into one number (spec §6).
- **Permitted tools:** T-WEB, T-EDGAR, T-PUBREC, T-LICENSED, T-EVIDENCE (write), T-MODEL.
- **Permitted data classes:** D-PUBLIC-BIZ, D-PUBLIC-FILING, D-WEALTH-INFERRED, D-LICENSED. **Prohibited (agent-specific):** precise real-estate/financial account numbers beyond what a public record legitimately discloses (spec §3 "Real-estate indicators where legally and appropriately sourced").
- **Planning behavior:** Builds the capacity range from a weighted combination of indicators rather than any single signal; always produces a range, never a point estimate presented as fact.
- **Observation behavior:** Actively checks whether new evidence narrows or widens the uncertainty band; a growing evidence base should tighten the range, not just add more inputs to an unchanged range.
- **Replanning triggers:** Indicators conflict materially (e.g. public exit value vs. reported net worth diverge >2x) — routes to BEN-KNW-04 before finalizing a range.
- **Delegation permissions:** May delegate liquidity-event verification to BEN-INT-09.
- **Success criteria:** Every capacity range ships with an explicit confidence and uncertainty list; range is never asserted as `verified_fact`.
- **Failure criteria:** A capacity range presented without an uncertainty list, or with `verification_status='verified_fact'` (capacity is definitionally inference, never a verified fact).
- **Escalation conditions:** Any capacity determination that would materially change a prospect's tier and rests on `D-WEALTH-INFERRED` alone without a giving-behavior corroborant — routes to `pil_human_review_queue` (review_type='capacity_determination').
- **Memory scope:** prospect.
- **Token budget:** 16,000 tokens / prospect.
- **Financial budget:** $0.90 / prospect (licensed wealth-data lookups add cost).
- **Evaluation suite:** range-calibration accuracy (does the stated confidence match empirical hit rate over time, tracked by BEN-OPS-01); fact/inference-label discipline (zero `verified_fact` capacity claims).

## BEN-INT-09 — Wealth Origin & Liquidity Event Agent

- **Mission:** Explain, with citations, the documented mechanisms through which substantial wealth or liquidity appears to have arisen.
- **Autonomy:** default **A2**.
- **Cadence:** Per prospect with a flagged capacity signal, on demand + monitoring refresh (`ipo`/`acquisition`/`company_sale`).
- **Inputs:** Business ownership history (BEN-INT-03), public filings.
- **Outputs:** A narrative chain of liquidity-relevant events (company sale → acquisition → documented sale → foundation creation, per spec §6's example), each event labeled `VERIFIED`/`INFERRED`/`UNKNOWN`.
- **Permitted tools:** T-WEB, T-EDGAR, T-NEWS, T-EVIDENCE (write).
- **Permitted data classes:** D-PUBLIC-BIZ, D-PUBLIC-FILING, D-PUBLIC-NEWS.
- **Planning behavior:** Builds the causal chain event-by-event, requiring a citation at each link; a chain with an unlabeled gap is incomplete, not filled in by assumption.
- **Observation behavior:** Distinguishes a documented sale price from a rumored/estimated one when labeling `VERIFIED` vs. `INFERRED`.
- **Replanning triggers:** A chain link has no available evidence — labels `UNKNOWN` and stops extending that branch rather than guessing.
- **Delegation permissions:** none.
- **Success criteria:** Every chain link carries one of the three required labels; no unlabeled links.
- **Failure criteria:** A narrative presents an `INFERRED` or `UNKNOWN` link with the same confidence language as a `VERIFIED` one.
- **Escalation conditions:** none beyond standard A2.
- **Memory scope:** prospect.
- **Token budget:** 12,000 tokens / prospect.
- **Financial budget:** $0.50 / prospect.
- **Evaluation suite:** label-accuracy (spot-checked VERIFIED claims actually verifiable); chain-completeness (gaps correctly marked UNKNOWN vs. silently skipped).

## BEN-INT-10 — Contact Intelligence Agent

- **Mission:** Identify permissible and relevant contact pathways.
- **Autonomy:** default **A2**.
- **Cadence:** Per qualified/near-qualified prospect, on demand.
- **Inputs:** Prospect identity, employer/foundation affiliations.
- **Outputs:** Public professional contact channels, organization/foundation/corporate-giving contact channels, appropriate introduction routes — written via T-CONTACT normalization into `pil_graph_nodes` (node_type='contact').
- **Permitted tools:** T-WEB, T-CRAWL, T-CONTACT, T-CRM (read, for existing-contact dedup), T-EVIDENCE (write).
- **Permitted data classes:** D-CONTACT-PUBLIC, D-CRM-FIRSTPARTY. **Prohibited (agent-specific):** no prohibited data-brokerage sources, no inappropriate private-contact harvesting (spec §6 explicit restriction) — this agent may only use sources on `pil_source_registry` with `permissibility_status='permitted'`, enforced deterministically by the Connector Gateway, not by agent judgment alone.
- **Planning behavior:** Prefers organization/foundation-published contact channels over personal-search results, since the former is unambiguously intended for professional contact.
- **Observation behavior:** Confirms a channel is still live (not a bounced/defunct address) before recording it as usable.
- **Replanning triggers:** Only a personal (non-professional) contact channel is found — does not record it; flags "no permissible contact channel found" instead.
- **Delegation permissions:** none.
- **Success criteria:** 100% of recorded contact channels sourced from `pil_source_registry` permitted sources.
- **Failure criteria:** Any recorded contact channel traced to a restricted/prohibited source (a hard policy violation, always escalated).
- **Escalation conditions:** Any attempted use of a `permissibility_status != 'permitted'` source is blocked deterministically by the Connector Gateway before this agent can even attempt the call; a repeated attempt pattern escalates to `pil_human_review_queue`.
- **Memory scope:** prospect.
- **Token budget:** 8,000 tokens / prospect.
- **Financial budget:** $0.30 / prospect.
- **Evaluation suite:** source-permissibility compliance (100% target); channel-liveness accuracy.

---

# FAMILY 4 — RELATIONSHIP & GRAPH INTELLIGENCE (6 agents)

Reasons across graph hops (spec §4) rather than isolated fields — this family's entire value is in
connecting Family 3's individually-correct facts into pathways.

## BEN-REL-01 — Relationship Discovery Agent

- **Mission:** Discover documented relationships between prospects and relevant people or organizations.
- **Autonomy:** default **A2**.
- **Cadence:** Per prospect, on discovery + monitoring refresh.
- **Inputs:** Prospect's employment/board/education/business edges from Family 3.
- **Outputs:** New `pil_graph_edges` connecting the prospect to other known entities (employment, board, foundation, business, professional-association, alumni, nonprofit, community-organization relationship types).
- **Permitted tools:** T-GRAPH (read/write), T-WEB, T-EVIDENCE (write).
- **Permitted data classes:** D-GRAPH-DERIVED, D-PUBLIC-BIO.
- **Planning behavior:** Starts from the prospect's existing edges and searches outward one hop at a time, rather than an unbounded open-ended relationship search.
- **Observation behavior:** Checks whether a discovered relationship already exists as an edge (avoids duplicate edges with divergent confidence values).
- **Replanning triggers:** A relationship candidate is found but the target entity doesn't yet exist as a `pil_graph_nodes` row — creates the node first, then the edge.
- **Delegation permissions:** May delegate deep board-network analysis to BEN-REL-02, corporate-network analysis to BEN-REL-03.
- **Success criteria:** New edges are non-duplicative and reference real, evidence-backed nodes.
- **Failure criteria:** Duplicate edges for the same relationship with conflicting confidence values left unreconciled.
- **Escalation conditions:** none beyond standard A2.
- **Memory scope:** prospect.
- **Token budget:** 14,000 tokens / prospect.
- **Financial budget:** $0.60 / prospect.
- **Evaluation suite:** duplicate-edge rate; one-hop discovery yield.

## BEN-REL-02 — Board Relationship Mapping Agent

- **Mission:** Analyze board and trustee networks for introduction opportunities.
- **Autonomy:** default **A2**.
- **Cadence:** On demand (triggered by BEN-REL-01 delegation or a qualification workflow needing introduction pathways).
- **Inputs:** Board/trustee edges across the graph (not just this prospect's — the wider board network).
- **Outputs:** Board-network paths (e.g. prospect → foundation board → trustee → local nonprofit → existing Benavora contact, per spec §6's example) as ordered `pil_graph_edges` traversals.
- **Permitted tools:** T-GRAPH (read), T-EVIDENCE (read), T-MODEL.
- **Permitted data classes:** D-GRAPH-DERIVED.
- **Planning behavior:** Performs bounded multi-hop graph traversal (default max 4 hops) from the prospect toward any node connected to the tenant's own organization.
- **Observation behavior:** Evaluates each candidate path's edge confidence product, not just hop count, when ranking paths.
- **Replanning triggers:** No path found within the hop bound — widens by one hop before giving up, then reports "no path found" rather than fabricating a weak connection.
- **Delegation permissions:** May delegate path-strength scoring to BEN-REL-06.
- **Success criteria:** Reported paths are traceable, edge-by-edge, back to real evidence.
- **Failure criteria:** A reported path includes an edge that doesn't actually exist in the graph (a fabrication, treated as a critical defect).
- **Escalation conditions:** none beyond standard A2.
- **Memory scope:** run (graph traversal is computed fresh each time against current graph state, not cached stale).
- **Token budget:** 12,000 tokens / analysis.
- **Financial budget:** $0.50 / analysis.
- **Evaluation suite:** path-traceability (100% target, zero fabricated edges); path-usefulness (introducer acceptance rate, tracked downstream).

## BEN-REL-03 — Corporate Relationship Mapping Agent

- **Mission:** Identify relationships connecting the tenant to corporations and decision-makers.
- **Autonomy:** default **A2**.
- **Cadence:** On demand.
- **Inputs:** Tenant's own vendor/employee/partner/customer records (where authorized), corporate philanthropy personnel data.
- **Outputs:** Corporate-side relationship edges from the tenant's organization node to relevant corporate entities/executives.
- **Permitted tools:** T-GRAPH (read/write), T-CRM (read), T-WEB, T-EVIDENCE (write).
- **Permitted data classes:** D-CRM-FIRSTPARTY, D-PUBLIC-BIZ. **Prohibited (agent-specific):** customer relationship data may only be used where the tenant has confirmed authorization for that data class — enforced at the Connector Gateway per-tenant configuration, not agent discretion.
- **Planning behavior:** Starts from the tenant's own first-party relationship data (highest-confidence source) before searching externally for corroboration.
- **Observation behavior:** Confirms a vendor/partner relationship is current, not historical, before using it as an introduction pathway.
- **Replanning triggers:** Customer-data class use is attempted without tenant authorization on file — blocked deterministically, agent reports the gap rather than retrying.
- **Delegation permissions:** May delegate to BEN-REL-05 for full pathway construction.
- **Success criteria:** All CRM-sourced relationship edges are current and authorized.
- **Failure criteria:** An edge built from customer data without on-file tenant authorization (policy violation, always blocked before execution).
- **Escalation conditions:** authorization gap detected → `pil_human_review_queue` (review_type='policy_exception') if the tenant wants to enable that data class.
- **Memory scope:** org.
- **Token budget:** 12,000 tokens / analysis.
- **Financial budget:** $0.50 / analysis.
- **Evaluation suite:** authorization-compliance rate (100% target); relationship-currency accuracy.

## BEN-REL-04 — Organizational Overlap Agent

- **Mission:** Identify shared organizational memberships among prospects and tenant-connected individuals.
- **Autonomy:** default **A2**.
- **Cadence:** On demand + periodic batch sweep (weekly) across the active prospect pool.
- **Inputs:** All board/education/company/community-organization edges across the graph.
- **Outputs:** Overlap edges (`pil_graph_edges`, edge_type='related_to', properties.overlap_type) connecting two prospects/contacts who share an organization.
- **Permitted tools:** T-GRAPH (read/write), T-EVIDENCE (read).
- **Permitted data classes:** D-GRAPH-DERIVED.
- **Planning behavior:** Runs a set-intersection pass across all prospects' organizational-affiliation edges (board, university, chamber, professional association, foundation, company, community organization) rather than pairwise search, since this is fundamentally a graph query problem, not a research problem.
- **Observation behavior:** Distinguishes a substantive shared organization (e.g. serving on the same 8-person board) from an incidental one (e.g. both attended the same large public university decades apart) when assigning relationship_strength.
- **Replanning triggers:** none — this is largely a deterministic graph-query task with agentic judgment applied only to strength-scoring; a full sweep either completes or reports partial coverage under budget.
- **Delegation permissions:** May delegate strength-scoring to BEN-REL-06.
- **Success criteria:** Overlap edges correctly rank substantive over incidental connections.
- **Failure criteria:** A weak/incidental overlap surfaced with `relationship_strength='strong'` or higher.
- **Escalation conditions:** none beyond standard A2.
- **Memory scope:** org (batch sweep state retained to avoid full re-scan every run — incremental on new edges only).
- **Token budget:** 10,000 tokens / sweep.
- **Financial budget:** $0.40 / sweep.
- **Evaluation suite:** strength-scoring accuracy vs. human-reviewed sample; sweep coverage rate.

## BEN-REL-05 — Warm Introduction Pathfinding Agent

- **Mission:** Find the strongest evidence-backed introduction path between the organization and a prospect.
- **Autonomy:** default **A2**.
- **Cadence:** On demand (triggered when a prospect reaches `TIER_1_PRIORITY`/`TIER_2_CULTIVATE`).
- **Inputs:** Full graph traversal capability (via BEN-REL-02/03/04's edges), tenant's own contact roster.
- **Outputs:** One or more ranked paths (hop count, relationship evidence, confidence, relationship strength, freshness, recommended introducer, friction estimate, alternative paths — spec §6's exact output shape) written to `pil_prospect_digital_twins.relationships_summary`.
- **Permitted tools:** T-GRAPH (read), T-EVIDENCE (read), T-MODEL.
- **Permitted data classes:** D-GRAPH-DERIVED, D-CRM-FIRSTPARTY.
- **Planning behavior:** Computes multiple candidate paths (not just the shortest) and ranks by a composite of hop count, edge confidence, strength, and freshness — a short but stale/weak path may rank below a longer but strong, fresh one.
- **Observation behavior:** Re-checks path freshness against `pil_graph_edges.is_current` before finalizing a recommendation — a path through a now-lapsed board seat is not usable.
- **Replanning triggers:** Top-ranked path becomes stale between computation and use — recomputes rather than serving cached output.
- **Delegation permissions:** Delegates strength scoring to BEN-REL-06 for each candidate path.
- **Success criteria:** Top recommended path is fresh, evidenced, and includes a friction estimate.
- **Failure criteria:** A recommended path includes a stale (superseded) edge presented as current.
- **Escalation conditions:** none beyond standard A2.
- **Memory scope:** run (recomputed fresh per request against current graph state).
- **Token budget:** 14,000 tokens / pathfinding request.
- **Financial budget:** $0.60 / request.
- **Evaluation suite:** path-freshness accuracy; introducer-acceptance rate (does the recommended introducer actually agree, tracked via outcome data feeding BEN-OPS-01).

## BEN-REL-06 — Relationship Strength Agent

- **Mission:** Evaluate the practical strength and usefulness of identified relationship paths.
- **Autonomy:** default **A2**.
- **Cadence:** On demand, called by BEN-REL-01/02/04/05.
- **Inputs:** A candidate edge or path with its underlying evidence.
- **Outputs:** One of `VERY_STRONG`/`STRONG`/`MODERATE`/`WEAK`/`SPECULATIVE` written to `pil_graph_edges.relationship_strength`, with the factor breakdown (direct vs. indirect, current vs. historical, professional vs. nominal, evidence strength, frequency where known, shared-organization count, recency, hop count) recorded in `properties`.
- **Permitted tools:** T-GRAPH (read), T-EVIDENCE (read), T-MODEL.
- **Permitted data classes:** D-GRAPH-DERIVED.
- **Planning behavior:** Applies the same weighted factor model consistently across every call (not ad hoc per-request judgment) so strength labels remain comparable across the graph.
- **Observation behavior:** Observes when new evidence should trigger a re-score of an already-labeled edge (e.g. a board seat lapses — an existing STRONG edge should downgrade).
- **Replanning triggers:** Underlying evidence for an already-scored edge changes.
- **Delegation permissions:** none — this is a leaf specialist other Relationship-family agents call into.
- **Success criteria:** Strength labels are stable and reproducible given the same evidence (low variance across repeated scoring of the same edge).
- **Failure criteria:** Two edges with materially similar evidence profiles receive materially different strength labels.
- **Escalation conditions:** none beyond standard A2.
- **Memory scope:** run.
- **Token budget:** 4,000 tokens / scoring call (called frequently, kept cheap).
- **Financial budget:** $0.15 / scoring call.
- **Evaluation suite:** scoring consistency (variance across repeated calls on identical evidence); calibration against human-reviewed strength labels.

---

# FAMILY 5 — QUALIFICATION & DECISION INTELLIGENCE (5 agents)

Independently determines whether and how strongly a researched prospect should be pursued — the
bridge from research to fundraising decision.

## BEN-QLF-01 — Mission Affinity Agent

- **Mission:** Determine how strongly documented philanthropic behavior aligns with the tenant mission.
- **Autonomy:** default **A2**.
- **Cadence:** On demand, once Family 3/4 research reaches sufficiency for a prospect.
- **Inputs:** Giving history (BEN-INT-07), board memberships (BEN-INT-05), cause classifications (BEN-DIS-07), corporate program alignment (BEN-DIS-04), geographic relevance.
- **Outputs:** Score (0-1), evidence list, explanation, confidence, and any contradictions, written to `pil_prospect_opportunities.mission_affinity_score`.
- **Permitted tools:** T-GRAPH (read), T-EVIDENCE (read), T-MODEL.
- **Permitted data classes:** D-GRAPH-DERIVED.
- **Planning behavior:** Weighs sustained/recent/direct signals (repeated gifts to the same cause) above single/old/indirect signals (one old board seat) when scoring.
- **Observation behavior:** Checks for contradicting evidence (e.g. a prospect with strong housing-cause giving also on record opposing a related local initiative) before finalizing.
- **Replanning triggers:** Underlying evidence changes (new giving-history evidence arrives).
- **Delegation permissions:** none.
- **Success criteria:** Score, evidence, and explanation are mutually consistent (score is explainable from the cited evidence, not a black-box number).
- **Failure criteria:** A high score with no supporting evidence citation, or evidence that contradicts the score without being surfaced.
- **Escalation conditions:** none beyond standard A2.
- **Memory scope:** prospect.
- **Token budget:** 8,000 tokens / scoring.
- **Financial budget:** $0.35 / scoring.
- **Evaluation suite:** explainability audit (does cited evidence actually support the score, sampled); score-outcome correlation (do high-affinity scores predict actual engagement success, tracked by BEN-OPS-01).

## BEN-QLF-02 — Funding Eligibility Agent

- **Mission:** Determine whether a foundation, corporation, or funding program is actually available to the tenant.
- **Autonomy:** default **A2**.
- **Cadence:** On demand, per foundation/corporate prospect.
- **Inputs:** Foundation/corporate intelligence (BEN-INT-06/BEN-DIS-04), tenant's own 501(c)(3)/program profile.
- **Outputs:** Eligibility determination against 501(c)(3) requirements, geography, program eligibility, organization type, grant size, deadlines, invitation requirements, excluded causes, prior recipients — written to `pil_prospect_opportunities` classification input.
- **Permitted tools:** T-990, T-WEB, T-EVIDENCE (read), T-MODEL.
- **Permitted data classes:** D-PUBLIC-FILING, D-CRM-FIRSTPARTY (tenant's own program profile).
- **Planning behavior:** Checks hard-disqualifying criteria first (excluded causes, invitation-only with no pathway, geography exclusion) before spending budget on soft-fit analysis — cheap disqualification beats expensive full analysis.
- **Observation behavior:** Confirms eligibility criteria are from the funder's current cycle, not a stale prior-year filing.
- **Replanning triggers:** Eligibility criteria conflict between the funder's website and its 990 — routes to BEN-KNW-04.
- **Delegation permissions:** none.
- **Success criteria:** Ineligible funders are correctly excluded before further (wasted) qualification work.
- **Failure criteria:** A prospect proceeds to `TIER_1_PRIORITY` classification despite a documented hard-disqualifying eligibility criterion.
- **Escalation conditions:** none beyond standard A2.
- **Memory scope:** prospect.
- **Token budget:** 8,000 tokens / determination.
- **Financial budget:** $0.35 / determination.
- **Evaluation suite:** false-eligible rate (a later-discovered disqualifier that should have been caught); staleness-check compliance.

## BEN-QLF-03 — Philanthropic Capacity & Propensity Agent

- **Mission:** Combine capacity and behavior evidence without conflating them.
- **Autonomy:** default **A2**.
- **Cadence:** On demand, once capacity (BEN-INT-08) and giving history (BEN-INT-07) are available.
- **Inputs:** Capacity range (BEN-INT-08), giving history/recency/frequency (BEN-INT-07), cause relevance (BEN-QLF-01), typical gift scale, foundation access, relationship strength (BEN-REL-06).
- **Outputs:** An evidence-backed likelihood and potential-range output — explicitly not a single certain number (spec §6).
- **Permitted tools:** T-GRAPH (read), T-EVIDENCE (read), T-MODEL.
- **Permitted data classes:** D-GRAPH-DERIVED, D-WEALTH-INFERRED.
- **Planning behavior:** Keeps capacity and propensity as two explicit dimensions throughout its reasoning and only combines them into a single likelihood at the final output step, never earlier — prevents an early conflation from silently propagating.
- **Observation behavior:** Flags when capacity is strong but propensity is weak (or vice versa) as a distinct pattern worth surfacing to Strategy, rather than averaging them into a mediocre combined score that hides the actual shape of the opportunity.
- **Replanning triggers:** Either input dimension is updated (new capacity range or new giving history).
- **Delegation permissions:** none.
- **Success criteria:** Output clearly separates capacity-driven vs. propensity-driven confidence.
- **Failure criteria:** Capacity and propensity are blended into an unexplained single score with no dimensional breakdown.
- **Escalation conditions:** none beyond standard A2.
- **Memory scope:** prospect.
- **Token budget:** 8,000 tokens / determination.
- **Financial budget:** $0.35 / determination.
- **Evaluation suite:** dimensional-separation compliance (100% target); likelihood-calibration accuracy vs. actual outcomes.

## BEN-QLF-04 — Opportunity Qualification Agent

- **Mission:** Integrate research into a defensible fundraising-opportunity classification.
- **Autonomy:** default **A3**.
- **Cadence:** On demand, as the final qualification step before a prospect enters Strategy family workflows.
- **Inputs:** Every upstream Family 3/4/5 finding for the prospect, BEN-SUP-05 critic verdict.
- **Outputs:** `pil_prospect_opportunities.classification` (`TIER_1_PRIORITY`/`TIER_2_CULTIVATE`/`TIER_3_MONITOR`/`RESEARCH_MORE`/`LOW_PROBABILITY`/`INELIGIBLE`/`DISQUALIFIED`).
- **Permitted tools:** T-GRAPH (read), T-EVIDENCE (read), T-DELEGATE (to BEN-SUP-05 for critic review), T-MODEL.
- **Permitted data classes:** D-GRAPH-DERIVED, D-WEALTH-INFERRED.
- **Planning behavior:** Requires a BEN-SUP-05 critic pass before any classification of `TIER_1_PRIORITY` or `TIER_2_CULTIVATE` becomes final — never self-certifies a high-impact classification (spec §12).
- **Observation behavior:** Identifies missing research (a required dimension with no evidence at all) and returns `RESEARCH_MORE` rather than guessing a classification with a gap.
- **Replanning triggers:** Critic returns `RESEARCH_MORE`/`BLOCK_*` — routes back to the relevant specialist rather than overriding.
- **Delegation permissions:** Must delegate to BEN-SUP-05 for any Tier 1/2 classification; may delegate a specific gap back to the originating specialist agent.
- **Success criteria:** No `TIER_1_PRIORITY`/`TIER_2_CULTIVATE` classification exists without a recorded critic `PASS`/`PASS_WITH_CAVEATS`.
- **Failure criteria:** A high-tier classification with no critic record (a hard invariant, checked by BEN-KNW-03/audit).
- **Escalation conditions:** Critic issues `BLOCK_POLICY` → `pil_human_review_queue`.
- **Memory scope:** prospect.
- **Token budget:** 10,000 tokens / classification.
- **Financial budget:** $0.40 / classification (excludes the critic's own budget).
- **Evaluation suite:** critic-compliance rate (100% target for Tier 1/2); classification-accuracy vs. eventual outcome.

## BEN-QLF-05 — Timing & Readiness Agent

- **Mission:** Determine whether the opportunity should be approached now, cultivated first, monitored, or deferred.
- **Autonomy:** default **A2**.
- **Cadence:** On demand + monitoring-triggered re-evaluation.
- **Inputs:** Recent-gift/foundation-cycle/board-appointment/liquidity-event/CSR-initiative/leadership-transition signals (from BEN-INT family and `pil_monitoring_events`), existing relationship state, grant deadlines.
- **Outputs:** `pil_prospect_opportunities.timing_status` (`approach_now`/`cultivate_first`/`monitor`/`defer`).
- **Permitted tools:** T-GRAPH (read), T-EVIDENCE (read), T-MODEL.
- **Permitted data classes:** D-GRAPH-DERIVED.
- **Planning behavior:** Weighs a hard external deadline (grant cycle close date) as a forcing constraint above soft readiness signals — timing recommendations respect real-world deadlines first.
- **Observation behavior:** Re-evaluates automatically whenever a relevant `pil_monitoring_events` row fires for the prospect (spec §15).
- **Replanning triggers:** A monitoring trigger materially changes timing (e.g. a new CSR initiative launch).
- **Delegation permissions:** none.
- **Success criteria:** `approach_now` recommendations correlate with successful engagement outcomes above the tenant's baseline.
- **Failure criteria:** A hard grant deadline missed because the agent recommended `cultivate_first` past the deadline window.
- **Escalation conditions:** none beyond standard A2.
- **Memory scope:** prospect.
- **Token budget:** 6,000 tokens / evaluation.
- **Financial budget:** $0.25 / evaluation.
- **Evaluation suite:** deadline-miss rate (target zero); timing-recommendation outcome correlation.

---

# FAMILY 6 — STRATEGY & NEXT-BEST-ACTION (4 agents)

Converts a qualified opportunity into an operational fundraising plan. This family recommends;
final solicitation decisions remain an explicit human boundary throughout.

## BEN-STR-01 — Prospect Engagement Strategy Agent

- **Mission:** Determine the most appropriate evidence-based engagement strategy for a qualified prospect.
- **Autonomy:** default **A2**.
- **Cadence:** On demand, once a prospect reaches `TIER_1_PRIORITY`/`TIER_2_CULTIVATE`.
- **Inputs:** Full qualification package (BEN-QLF family), relationship pathways (BEN-REL-05), timing (BEN-QLF-05).
- **Outputs:** Recommended strategy (warm introduction / direct introduction / cultivation / event invitation / information sharing / corporate partnership inquiry / foundation application / sponsorship proposal / relationship development), written to `pil_prospect_opportunities.engagement_strategy`.
- **Permitted tools:** T-GRAPH (read), T-EVIDENCE (read), T-MODEL.
- **Permitted data classes:** D-GRAPH-DERIVED.
- **Planning behavior:** Selects strategy based on the strongest available relationship pathway and timing status jointly — a strong pathway with poor timing yields a cultivation-first recommendation, not an immediate ask.
- **Observation behavior:** Checks whether a previously recommended strategy for this prospect has already been attempted and stalled (avoids re-recommending a failed approach unchanged).
- **Replanning triggers:** Timing status or relationship pathway changes materially.
- **Delegation permissions:** May delegate specific-ask sizing to BEN-STR-02, multi-step planning to BEN-STR-03.
- **Success criteria:** Recommended strategy is grounded in an actual relationship pathway or documented direct-approach precedent, never a generic default.
- **Failure criteria:** A "warm introduction" strategy recommended with no actual BEN-REL-05 pathway on record.
- **Escalation conditions:** none beyond standard A2.
- **Memory scope:** prospect (strategy history retained to avoid repeating a stalled approach).
- **Token budget:** 8,000 tokens / recommendation.
- **Financial budget:** $0.35 / recommendation.
- **Evaluation suite:** pathway-grounding compliance (100% target); strategy-outcome success rate.

## BEN-STR-02 — Best First Ask Agent

- **Mission:** Recommend an appropriate initial ask or engagement objective.
- **Autonomy:** default **A2** — **Human boundary:** H1, final solicitation decision always remains human.
- **Cadence:** On demand.
- **Inputs:** Historical giving, capacity (BEN-QLF-03), affinity (BEN-QLF-01), relationship strength (BEN-REL-06), comparable gifts within the tenant's own history, program requirements, timing.
- **Outputs:** A recommended ask range with confidence and an explicit rationale list (spec §6's worked example: "Recommended initial ask: $10,000-$15,000, Confidence: 0.79, Rationale: [previous gifts, housing affinity, regional connection, relationship pathway, comparable nonprofit gifts]").
- **Permitted tools:** T-GRAPH (read), T-EVIDENCE (read), T-CRM (read, comparable-gift lookup), T-MODEL.
- **Permitted data classes:** D-GRAPH-DERIVED, D-CRM-FIRSTPARTY.
- **Planning behavior:** Anchors the ask range to real comparable gifts (from this tenant's own history or documented external gifts of similar prospects) rather than an unconstrained model guess.
- **Observation behavior:** Checks the ask range against the prospect's own documented capacity range (BEN-INT-08) — never recommends an ask exceeding the upper capacity bound.
- **Replanning triggers:** Capacity range or comparable-gift data updates.
- **Delegation permissions:** none.
- **Success criteria:** Ask range always falls within the prospect's documented capacity range; rationale always cites at least 3 concrete factors.
- **Failure criteria:** Recommended ask exceeds the documented capacity upper bound.
- **Escalation conditions:** none beyond standard A2 — the recommendation itself never becomes a solicitation without human action (H1).
- **Memory scope:** prospect.
- **Token budget:** 6,000 tokens / recommendation.
- **Financial budget:** $0.25 / recommendation.
- **Evaluation suite:** capacity-bound compliance (100% target); ask-acceptance rate vs. human-adjusted final ask (tracked by BEN-OPS-01 as a learning signal, per spec §18).

## BEN-STR-03 — Cultivation Strategy Agent

- **Mission:** Create a multi-step relationship-development plan when immediate solicitation is not appropriate.
- **Autonomy:** default **A2**.
- **Cadence:** On demand, when BEN-QLF-05/BEN-STR-01 indicate `cultivate_first`.
- **Inputs:** Research gaps (`pil_prospect_digital_twins.research_gaps`), relationship pathway state, prior cultivation history for this prospect.
- **Outputs:** A sequenced plan (milestones, information gaps to close, relationship-building opportunities, advancement signals, explicit stop conditions), written to `pil_prospect_opportunities`-linked cultivation records.
- **Permitted tools:** T-GRAPH (read), T-EVIDENCE (read), T-MODEL.
- **Permitted data classes:** D-GRAPH-DERIVED, D-CRM-FIRSTPARTY.
- **Planning behavior:** Builds the plan as an explicit milestone sequence with named advancement signals per milestone, not an open-ended "keep engaging" instruction.
- **Observation behavior:** Tracks whether milestones are being hit on the expected timeline; a plan idling well past its own milestones is a signal for BEN-STR-04 to reconsider next-best-action.
- **Replanning triggers:** A milestone signal fires early (accelerate) or the plan stalls past its expected timeline (reconsider approach or disqualify).
- **Delegation permissions:** none.
- **Success criteria:** Plan includes explicit stop conditions (spec §6: "Determine when cultivation should stop").
- **Failure criteria:** A cultivation plan with no stop condition, allowed to run indefinitely.
- **Escalation conditions:** none beyond standard A2.
- **Memory scope:** prospect.
- **Token budget:** 8,000 tokens / plan.
- **Financial budget:** $0.35 / plan.
- **Evaluation suite:** stop-condition presence (100% target); milestone-hit rate; plan-to-ask-readiness conversion rate.

## BEN-STR-04 — Next-Best-Action Agent

- **Mission:** Continuously determine the most valuable next action for each qualified opportunity.
- **Autonomy:** default **A3**.
- **Cadence:** Continuous, per active `pil_prospect_opportunities` row.
- **Inputs:** Full opportunity state (qualification, timing, strategy, cultivation-plan progress, monitoring events).
- **Outputs:** One of: research deeper / wait / seek introduction / update profile / prepare foundation request / request human review / add to cultivation / monitor for event / disqualify / reprioritize.
- **Permitted tools:** T-DELEGATE, T-GRAPH (read), T-NOTIFY.
- **Permitted data classes:** D-GRAPH-DERIVED.
- **Planning behavior:** Re-evaluates next-best-action on every material state change to the opportunity, closing the loop between research and operational strategy (spec §6: "This agent closes the loop between research and operational fundraising strategy").
- **Observation behavior:** Observes `pil_prospect_opportunities`, `pil_monitoring_events`, and cultivation-plan milestone status continuously.
- **Replanning triggers:** Any of the above state changes; no action taken for longer than the opportunity's expected cadence (staleness).
- **Delegation permissions:** May delegate the chosen next action to the relevant specialist agent (e.g. "research deeper" delegates to the specific Family 3 agent covering the identified gap).
- **Success criteria:** No qualified opportunity sits with a stale (no-action) state past its expected cadence without a deliberate `wait` decision on record.
- **Failure criteria:** An opportunity silently stalls with no `pil_agent_run_events` decision recorded for longer than its cadence threshold.
- **Escalation conditions:** Chosen action is `request human review`.
- **Memory scope:** prospect (full action history retained to avoid repeating an already-tried, already-failed action).
- **Token budget:** 6,000 tokens / decision cycle.
- **Financial budget:** $0.25 / decision cycle.
- **Evaluation suite:** stall rate (opportunities with no decision past cadence, target zero); action-outcome correlation (does the chosen action correlate with opportunity advancement).

---

# FAMILY 7 — KNOWLEDGE INTEGRITY (4 agents)

Guarantees the canonical state is trustworthy: identity is correctly resolved, evidence actually
supports its claims, and contradictions/staleness are surfaced rather than silently absorbed.

## BEN-KNW-01 — Prospect Digital Twin Agent

- **Mission:** Maintain the living structured representation of each prospect.
- **Autonomy:** default **A3**.
- **Cadence:** Continuous (updates on every accepted write from any Family 3/4/5/6 agent).
- **Inputs:** Every accepted output from Families 3-6, contradiction resolutions from BEN-KNW-04.
- **Outputs:** `pil_prospect_digital_twins` row per prospect — the single canonical state consumers (dashboard, CRM sync, other agents) read.
- **Permitted tools:** T-GRAPH (read), T-EVIDENCE (read), T-WORKFLOW.
- **Permitted data classes:** D-GRAPH-DERIVED (this agent aggregates; it does not perform primary research itself).
- **Planning behavior:** Treats every incoming update as a proposed patch to a specific twin field, not a full-document overwrite — preserves history via `twin_version` increment and keeps superseded values (spec §4's "superseded facts").
- **Observation behavior:** Detects when an incoming update conflicts with current canonical state and routes to BEN-KNW-04 rather than silently applying a later-write-wins overwrite.
- **Replanning triggers:** A conflicting update arrives; `completeness_score` drops below a threshold, surfacing a fresh research gap.
- **Delegation permissions:** May delegate conflict resolution to BEN-KNW-04, verification of a specific field to BEN-KNW-03.
- **Success criteria:** `research_gaps` and `contradictions_summary` fields are always current relative to the underlying evidence base.
- **Failure criteria:** A conflicting update applied without routing through BEN-KNW-04 (a silent-overwrite defect).
- **Escalation conditions:** none beyond standard A3.
- **Memory scope:** prospect (this agent *is* the prospect's persistent state).
- **Token budget:** 4,000 tokens / update cycle (frequent, kept cheap; heavy reasoning happens upstream).
- **Financial budget:** $0.15 / update cycle.
- **Evaluation suite:** conflict-routing compliance (100% target); completeness-score accuracy vs. human-reviewed dossier completeness.

## BEN-KNW-02 — Entity Resolution Agent

- **Mission:** Reason through ambiguous identities and determine whether records refer to the same entity.
- **Autonomy:** default **A3** — **Human boundary:** H1 for sensitive/high-impact identity linkage (a merge that would materially change a prospect's giving-history attribution or capacity classification).
- **Cadence:** On demand (triggered by any agent surfacing an ambiguous match) + periodic batch sweep.
- **Inputs:** Candidate pairs in `pil_entity_resolution_candidates`, aliases in `pil_entity_aliases`.
- **Outputs:** `MATCH`/`PROBABLE_MATCH`/`UNRESOLVED`/`NOT_MATCH` with evidence and confidence; on `MATCH`, executes the merge via `pil_identity_resolution_log` + `pil_prospects.merged_into_prospect_id`.
- **Permitted tools:** T-GRAPH (read/write), T-EVIDENCE (read), T-MODEL.
- **Permitted data classes:** D-PUBLIC-BIO, D-GRAPH-DERIVED, D-CRM-FIRSTPARTY.
- **Planning behavior:** Weighs multiple independent signals (name, employer overlap, address, alias history) rather than any single strong-looking signal (e.g. same name alone is never sufficient for `MATCH`).
- **Observation behavior:** Checks whether a `PROBABLE_MATCH` accumulates further corroborating evidence over time, upgrading to `MATCH` only when warranted.
- **Replanning triggers:** New evidence arrives for an `UNRESOLVED` or `PROBABLE_MATCH` pair.
- **Delegation permissions:** none.
- **Success criteria:** `MATCH` decisions are reversible-with-audit-trail and rarely (per BEN-OPS-01 tracking) overturned by human review.
- **Failure criteria:** A `MATCH` executed (merge performed) on single-signal evidence alone.
- **Escalation conditions:** Any merge that would materially change giving-history/capacity attribution → `pil_human_review_queue` (review_type='identity_linkage') before executing, even at A3.
- **Memory scope:** org (full resolution history retained; this is exactly the kind of cross-prospect reasoning that benefits from org-wide pattern memory).
- **Token budget:** 8,000 tokens / resolution.
- **Financial budget:** $0.35 / resolution.
- **Evaluation suite:** merge-reversal rate (human overturns a completed merge, target near zero); false-`NOT_MATCH` rate (two records later proven to be the same entity).

## BEN-KNW-03 — Evidence & Provenance Verification Agent

- **Mission:** Verify that consequential claims are supported by permissible, traceable evidence.
- **Autonomy:** default **A3**.
- **Cadence:** Continuous (runs against every new `pil_evidence` row feeding a consequential claim — capacity, giving, qualification tier) + on-demand from BEN-SUP-05.
- **Inputs:** `pil_evidence` rows, `pil_source_snapshots`, `pil_source_registry` permissibility status.
- **Outputs:** Updated `verification_status`/`freshness_status` on `pil_evidence`, flagged circular-citation and source-tier assignments.
- **Permitted tools:** T-EVIDENCE (read/write status fields only, never claim content), T-CRAWL (re-verification).
- **Permitted data classes:** whatever the evidence row's own claim_type implies (inherits the producing agent's permitted classes for verification purposes only).
- **Planning behavior:** Checks, in order: source permissibility (is this source on `pil_source_registry` and permitted) → citation validity (does the URL/document actually exist and match) → excerpt-supports-claim (does the retrieved excerpt actually say what the claim states) → circularity (does this source itself just cite another Benavora-produced claim).
- **Observation behavior:** Re-fetches a sample of source URLs to confirm the excerpt still matches current content (source content changes over time).
- **Replanning triggers:** A source fails permissibility or circularity check — downgrades `verification_status` and notifies the producing agent's twin via BEN-KNW-01.
- **Delegation permissions:** none.
- **Success criteria:** No `verified_fact`-status evidence row exists for a claim whose excerpt doesn't actually support it (checked by sampling).
- **Failure criteria:** A circular citation (Benavora-derived content cited as if it were an independent source) passes verification.
- **Escalation conditions:** none beyond standard A3.
- **Memory scope:** run (each verification is a fresh check against current source state).
- **Token budget:** 5,000 tokens / verification.
- **Financial budget:** $0.20 / verification.
- **Evaluation suite:** excerpt-support accuracy (sampled); circular-citation catch rate; source-tier assignment consistency.

## BEN-KNW-04 — Contradiction & Freshness Investigator

- **Mission:** Detect conflicting or outdated prospect information and determine what should remain canonical.
- **Autonomy:** default **A3**.
- **Cadence:** Continuous (triggered on any two `pil_evidence` rows for the same claim_type/entity with divergent values) + periodic staleness sweep.
- **Inputs:** `pil_evidence` pairs flagged by any producing agent, `pil_contradictions`.
- **Outputs:** Temporal-truth determination (which value is current, which is historical), writes to `pil_contradictions.resolution_status`/`resolved_value`, triggers a `pil_graph_edges.superseded_by_edge_id` update where applicable.
- **Permitted tools:** T-GRAPH (read/write), T-EVIDENCE (read), T-MODEL.
- **Permitted data classes:** whatever the conflicting claims' own claim_type implies.
- **Planning behavior:** Defaults to treating more-recently-`published_at` evidence as the current value only when both sources are independently credible — a recent low-quality source doesn't automatically override an older high-quality one without checking why they diverge.
- **Observation behavior:** Runs a periodic sweep over `pil_evidence.last_verified_at` to catch staleness proactively (spec §6's chairman/left-board-in-2024 example), not only reactively when a new contradicting fact arrives.
- **Replanning triggers:** A staleness sweep finds evidence past its freshness threshold with no newer corroboration — flags for re-research rather than silently leaving it stale.
- **Delegation permissions:** May delegate re-research of a stale claim back to the originating Family 3/4 specialist.
- **Success criteria:** Every `pil_contradictions` row reaches a `resolution_status` other than `open` within the tenant's configured SLA.
- **Failure criteria:** A contradiction sits `open` past SLA with no re-research delegated.
- **Escalation conditions:** none beyond standard A3.
- **Memory scope:** org (contradiction-pattern history informs which source types tend to go stale fastest, feeding BEN-OPS-01).
- **Token budget:** 6,000 tokens / investigation.
- **Financial budget:** $0.25 / investigation.
- **Evaluation suite:** SLA compliance rate; resolution accuracy (spot-checked); proactive-staleness-catch rate (sweep-found vs. reactively-found).

---

# CROSS-CUTTING — OPERATIONS, EVALUATION & LEARNING (1 agent)

## BEN-OPS-01 — Agent Fleet Performance & Learning Agent

- **Mission:** Continuously evaluate whether the Prospect Intelligence agent fleet is actually improving research outcomes and determine where behaviors, routing, tools, or research strategies should be adjusted.
- **Autonomy:** default **A1/A2** — **Human boundary:** may recommend but may not independently increase autonomy, change security/privacy policy, modify canonical facts, remove safety controls, or rewrite production governance (spec's own explicit boundary list for this agent).
- **Cadence:** Continuous + scheduled evaluation (nightly rollup, weekly deep review).
- **Inputs:** `pil_agent_runs` history, `pil_cost_ledger`, human corrections (`pil_human_review_decisions`), qualification/disqualification outcomes, donation/grant outcomes fed back from CRM sync, `pil_evidence` completeness scores, per-agent evaluation-suite results (every field above, across all 43 other agents).
- **Outputs:** Agent-performance reports, routing recommendations, model-selection recommendations, research-policy recommendations, evaluation failures, controlled learning proposals — written to a learning-proposal queue that a human or the Autonomy Governor (BEN-SUP-01, within tenant policy) must apply; this agent never applies its own recommendations directly.
- **Permitted tools:** T-COST (read), T-GRAPH (read), T-MODEL, T-NOTIFY.
- **Permitted data classes:** D-GRAPH-DERIVED, D-CRM-FIRSTPARTY (aggregate outcome data only, no new primary research).
- **Planning behavior:** Compares predicted vs. actual outcomes systematically across the fleet (per-agent precision/recall against eventual human-confirmed or donation-outcome ground truth) rather than reacting to individual incidents.
- **Observation behavior:** Tracks research cost per qualified prospect, evidence completeness trend, false-positive rate per Discovery/Qualification agent, redundant-research incidence, excessive-tool-usage patterns, continuously.
- **Replanning triggers:** An agent's performance metric crosses a configured regression threshold; a new evaluation-suite result contradicts a standing learning proposal.
- **Delegation permissions:** none — this agent evaluates other agents but does not delegate work to them.
- **Success criteria:** Learning proposals, once human/Governor-applied, measurably improve the targeted metric in the following period (closed-loop validation, not just proposal volume).
- **Failure criteria:** A proposal recommends an autonomy increase, policy change, or canonical-fact modification directly rather than routing it through the human/Governor boundary (a hard violation of this agent's own explicit human boundary).
- **Escalation conditions:** Any finding suggesting a systemic safety, privacy, or policy-compliance gap routes immediately to `pil_human_review_queue` regardless of its normal reporting cadence.
- **Memory scope:** fleet (platform-level; retains cross-tenant *pattern* data such as "Discovery agents in region X have elevated false-positive rates" without carrying any individual tenant's prospect content across tenant boundaries).
- **Token budget:** 35,000 tokens / evaluation cycle.
- **Financial budget:** $2.00 / day (platform-level, not billed to a single tenant).
- **Evaluation suite:** proposal-application success rate (did an applied proposal improve the target metric); boundary-compliance rate (100% target — zero direct self-modifications); coverage (fraction of the 43-agent fleet with a current evaluation-suite result each cycle).

---

## Fleet Summary

| Family | Count | Agent IDs |
|---|---|---|
| Supervisory & Orchestration | 6 | BEN-SUP-01 .. BEN-SUP-06 |
| Discovery | 8 | BEN-DIS-01 .. BEN-DIS-08 |
| Core Prospect Intelligence | 10 | BEN-INT-01 .. BEN-INT-10 |
| Relationship & Graph Intelligence | 6 | BEN-REL-01 .. BEN-REL-06 |
| Qualification & Decision Intelligence | 5 | BEN-QLF-01 .. BEN-QLF-05 |
| Strategy & Next-Best-Action | 4 | BEN-STR-01 .. BEN-STR-04 |
| Knowledge Integrity | 4 | BEN-KNW-01 .. BEN-KNW-04 |
| Operations, Evaluation & Learning | 1 | BEN-OPS-01 |
| **Total** | **44** | |

**Execution principle (spec §"Execution Principle"), preserved here without dilution:** this
registry defines the fleet, not an invocation requirement — the Orchestrator (BEN-SUP-01) and
Portfolio Allocator (BEN-SUP-04) determine research depth per prospect dynamically. A weak
candidate might invoke 3-5 agents; a normal qualified prospect 8-15; a high-value major-donor
prospect 15-25; a strategically important or ambiguous prospect may trigger additional critic,
contradiction, relationship, capacity, and recovery work beyond that. Roughly 20-30 deterministic
supporting services back this fleet — see `PROSPECT_INTELLIGENCE_ARCHITECTURE.md` §Deterministic
Services Registry for the complete list; those services are infrastructure, not agents, and are
never counted toward the 44.
