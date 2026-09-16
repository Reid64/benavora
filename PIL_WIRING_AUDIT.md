# PIL WIRING AUDIT (2026-09-15)

Phase 0 audit deliverable 2 of 5. Code- and live-DB-verified (read-only queries only — no writes,
no agent invocations, no real emails/submissions triggered during this audit).

## Premise correction

The task brief that requested this audit assumed PIL agents are numbered "AG-43 to AG-93" and
that tables named `pil_dossiers`, `pil_recommendations`, `pil_intelligence_gaps` exist. **Both are
wrong.** PIL agents use `BEN-*` codes (confirmed live in `pil_agent_registry`, exactly 51 rows).
None of the three named tables exist; the real schema has 35 `pil_*` tables (full list below). This
correction matters beyond pedantry: it means any external doc or task queue still using "AG-43..93"
or those table names will misfire immediately if acted on literally.

## 1. Full 51-agent registry table

| agent_id | family | file | autonomy tier | denied by hardcoded policy check? | real (non-synthetic) executions |
|---|---|---|---|---|---|
| BEN-APP-01/02/03 | application | `src/lib/pil/agents/app/BEN-APP-0{1,2,3}.ts` | A2 | **YES** | 0 |
| BEN-DIS-01 | discovery | `agents/dis/BEN-DIS-01.ts` | A2 | **YES** | 1 (test burst) |
| BEN-DIS-02..08 | discovery | `agents/dis/BEN-DIS-0{2..8}.ts` | A2 | **YES** | 0 |
| BEN-INT-01, 03, 08, 09 | prospect_intelligence | `agents/int/BEN-INT-0{1,3,8,9}.ts` | A2 | **YES** | 1-2 each (test burst) |
| BEN-INT-02, 04-07, 10 | prospect_intelligence | `agents/int/BEN-INT-0{2,4,5,6,7,10}.ts` | A2 | **YES** | 0 |
| BEN-KNW-01/02/04 | knowledge_integrity | `agents/knw/BEN-KNW-0{1,2,4}.ts` | A3 | no (meets floor) | 0 |
| BEN-KNW-03 | knowledge_integrity | `agents/knw/BEN-KNW-03.ts` | A3 | no | 1 (test burst) |
| BEN-OPS-01 | operations_evaluation_learning | `agents/ops/BEN-OPS-01.ts` | A1 | **YES** | 0 |
| BEN-QLF-01/02/05 | qualification | `agents/qlf/BEN-QLF-0{1,2,5}.ts` | A2 | **YES** | 0 |
| BEN-QLF-03 | qualification | `agents/qlf/BEN-QLF-03.ts` | A2 | **YES** | 1 (test burst) |
| BEN-QLF-04 | qualification | `agents/qlf/BEN-QLF-04.ts` | A3 | no | 1 (test burst, recorded **FAILED**) |
| BEN-REL-01, 03, 04 | relationship_intelligence | `agents/rel/BEN-REL-0{1,3,4}.ts` | A2 | **YES** | 1 each (test burst) |
| BEN-REL-02, 05-08 | relationship_intelligence | `agents/rel/BEN-REL-0{2,5,6,7,8}.ts` | A2 | **YES** | 0 |
| BEN-STR-01/02/03 | strategy | `agents/str/BEN-STR-0{1,2,3}.ts` | A2 | **YES** | 0 |
| BEN-STR-04 | strategy | `agents/str/BEN-STR-04.ts` | A3 | no | 0 |
| BEN-SUP-01 | supervisory | `agents/sup/BEN-SUP-01.ts` | A4 | no | 4 (test burst) |
| BEN-SUP-02 | supervisory | `agents/sup/BEN-SUP-02.ts` | A2 | **YES** (but ran anyway, as a delegated sub-task from an A4 supervisor — see note) | 8 |
| BEN-SUP-03 | supervisory | `agents/sup/BEN-SUP-03.ts` | A4 | no | 5 |
| BEN-SUP-04 | supervisory | `agents/sup/BEN-SUP-04.ts` | A3 | no | 4 |
| BEN-SUP-05 | supervisory | `agents/sup/BEN-SUP-05.ts` | A2 | **YES** (ran anyway, same delegation path) | 5 |
| BEN-SUP-06 | supervisory | `agents/sup/BEN-SUP-06.ts` | A3 | no | 0 |
| BEN-SUP-07 | supervisory | `agents/sup/BEN-SUP-07.ts` | A4 | no | 0 |
| BEN-SUP-08 | supervisory | `agents/sup/BEN-SUP-08.ts` | A2 | **YES** | 0 |

**40 of 51 agents (A1/A2 tier) are denied by the hardcoded policy check.** Only 11 (the A3/A4 tier)
would clear it. Note: `BEN-SUP-02`/`BEN-SUP-05` show real test-burst runs despite being A2 — they
were invoked as delegated sub-tasks from an A4 supervisor, which appears to bypass the parent-level
check inconsistently. Not independently re-verified line-by-line in this pass; flagged for the repair
queue rather than asserted as fully understood.

Corrected live count: `pil_agent_runs` = **38 rows**, all traceable to one 2026-09-09 test burst
(the row's own `goal` field says *"synthetic prospect, not a real research target"*). 16 of 51
agents show at least 1 run; 35 have never executed even once, ever, including in testing.

## 2. Orchestrator — confirmed zero callers, independently re-verified twice

`src/lib/pil/research-orchestrator.ts` exports `orchestrateResearchRun()` and
`pollAndOrchestratePendingRuns()` — the only two functions that invoke `AgentRunner`.

```
grep -rl "orchestrateResearchRun\|pollAndOrchestratePendingRuns" src worker
→ only research-orchestrator.ts itself
```

Zero importers anywhere in `src/` or `worker/` (compiled `dist/` excluded, and also checked —
same result). No cron route, no worker scheduler entry, no API route calls either function.

## 3. Auto-trigger migration — claimed, does not exist

A route-file comment claims migration 170 installed a database trigger
(`pil_create_research_run_on_prospect_insert`) that auto-creates a `pil_research_run` whenever a
row is inserted into `pil_prospects`. Live `pg_trigger` catalog check on `pil_prospects`: **no such
trigger exists** — only standard FK constraint triggers. Consistent with the data: 15
`pil_prospects` rows exist against only 4 `pil_research_runs`, all stuck in `status='running'` for
6+ days with nothing polling them (per §2, nothing ever calls the poller).

## 4. Hardcoded policy blocker — confirmed unchanged

`src/lib/pil/agent-runner.ts` hardcodes every agent run to request policy action
`execute_reversible`, which `policy.ts`'s `ACTION_MIN_AUTONOMY` table requires autonomy tier **A3**.
Confirmed identical in current `HEAD` and in the compiled worker `dist/` — unchanged since a
2026-09-01 commit. This is the single hardcoded string driving the "40 of 51 denied" figure in §1.

## 5. Manual trigger check — answer: no route can actually start a real PIL agent run today

| Route | What it actually does | Would hit the policy wall? |
|---|---|---|
| `POST /api/pil/research` | Calls `createResearchRun()` in `src/lib/pil/workflow.ts` — **only inserts a `pil_research_runs` row.** Never calls `AgentRunner`, `orchestrateResearchRun`, or `pollAndOrchestratePendingRuns` (grepped `workflow.ts`: zero matches). | N/A — never reaches the policy check at all |
| `POST /api/pil/discover` | Same pattern, same `createResearchRun()` call, same result | N/A |
| `/api/pil/agents/[agentCode]/...` | The actual file is `.../[agentCode]/runs/route.ts` and is **`GET`-only** — a run-history viewer, not a trigger. There is no `route.ts` directly under `[agentCode]/`. | N/A — read-only |

**Conclusion: no shipped HTTP route can make a real PIL agent execute right now.** The only way
the 2026-09-09 test burst happened was direct code-level invocation in a dev session, bypassing
every route in the app. Anyone wanting to "just manually trigger a PIL run" via the UI or API
today cannot — the row gets created and then sits forever, exactly matching the stuck-`running`
rows already observed.

## 6. PIL database reality check — 35 real tables, 13 live data, 22 empty

Confirmed live counts, corrected against the task's wrong assumed table names:

**Non-empty (13):** `pil_agent_registry` (51), `pil_agent_runs` (38), `pil_audit_log` (85),
`pil_contradictions` (31), `pil_cost_ledger` (27), `pil_delegated_tasks` (17), `pil_evidence` (34),
`pil_graph_edges` (10), `pil_graph_nodes` (12), `pil_human_review_queue` (10),
`pil_policy_decisions` (44), `pil_prospects` (15), `pil_research_runs` (4).

**Empty (22):** `pil_agent_run_events`, `pil_application_profiles`, `pil_cost_budgets`,
`pil_cultivation_plans`, `pil_delegation_budgets`, `pil_entity_aliases`,
`pil_entity_resolution_candidates`, `pil_feature_flags`, `pil_graph_edge_evidence`,
`pil_human_review_decisions`, `pil_identity_resolution_log`, `pil_monitoring_events`,
`pil_monitoring_subscriptions`, `pil_priority_scores`, `pil_prospect_classifications`,
`pil_prospect_digital_twins`, `pil_prospect_dossiers`, `pil_prospect_opportunities`,
`pil_research_goals`, `pil_research_run_steps`, `pil_source_provider_credentials`,
`pil_source_registry`, `pil_source_snapshots`, `pil_submission_queue`.

Every non-empty table's rows trace back to the same single 2026-09-09 test session — none show
activity outside that window.

## 7. The qlf/qua directory — resolved, documented precedent

`src/lib/pil/agents/qua/BEN-QUA-01.ts` is a deliberate shim, not a bug. Its own header explains a
task prompt was reissued three times (commits `c54555e`, `9a266c3`, `04f3a97`) asking for a
nonexistent "BEN-QUA-01" agent whose described mission is materially identical to the real,
registered `BEN-QLF-04`. Rather than create a phantom registry row, the file is a straight
re-export: `export { OpportunityQualificationAgent as ProspectQualificationAgent } from
".../BEN-QLF-04"`. No registry row, no independent behavior, zero external importers. **This is
the same failure mode as this Phase 0 brief's own "AG-43-93" mistake, and it's now happened at
least 4 times on this codebase.** Worth a standing note in project docs so it isn't recreated a
5th time.

## 8. Net assessment

The PIL layer is not a small wiring gap — it's a fully-built (51 real agent implementations, real
policy engine, real cost/evidence/graph schema) system with **two independent, compounding
disconnections from production**: nothing calls the orchestrator (§2-3), and even a manual or
future automated caller would be denied for 40 of 51 agents by a hardcoded policy string (§4).
Shipping this requires both fixed together — fixing only the trigger path would just move today's
"stuck running forever" bug from "never starts" to "starts, then gets denied."
