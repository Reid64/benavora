# BENAVORA — State of the Build

**Build window:** 2026-09-17, 14:42 → 19:05 (4h 23m unattended)
**Queues:** ar-5-cost-consolidation, ar-6-orchestration-observability
**Standard:** every figure below was read from the live database (`vbjplpquqxxfbpazyalt`), the repository on disk, or the orchestrator log. Nothing here is taken from an agent's own report without independent verification.

---

## 1. Result

| | |
|---|---|
| Prompts run | **6 of 6** |
| Prompts complete | **6 of 6** |
| Orchestrator verdict at 19:05 | 1 passed, 1 failed |
| **Corrected verdict** | **2 passed** — the AR-6.4 failure was a false positive in my own gate |
| Head commit | `af84661` (two commits pending push) |
| Full test suite | 109 files passed / 1 skipped · 944 tests / 13 todo · **0 failures** |
| Migrations applied live | 185, 186, 187, 188, 189, 190, 191, 192, 193, 194 |

---

## 2. The halt was my bug, not the build's

At 19:03 the pipeline halted with:

```
FAIL: migration makes an HTTP call from SQL (net.http_post) - pg_net is not installed
```

The migration contains no such call. It contains a **comment** saying it makes no such call:

```
191_orchestration_alert_rules.sql:10:
-- none of them and makes no net.http_post call. Slack delivery is prompt
```

My gate matched raw file text, so a comment mentioning a forbidden construct read as a use of it. This is the third bug of the same family I have shipped this session, and the second time this exact false-positive class appeared — the AR-5.2 agent reported it to me four hours earlier when its own comments containing `pil_cost_budgets` tripped a different gate of mine. It reworded its comments to get past it; I fixed that one instance and never generalised it to the other four gates. **A gate that fails correct work is the same defect class as a gate that passes broken work.**

### The fix

`scripts/audit/forge-gates/_sql.mjs` — `stripSql()` removes `--` and `/* */` comments, including comments nested inside dollar-quoted function bodies (whose logic is still scanned, because that is where trigger code lives), while **preserving string literals**, because enum values and scope names live in them.

Fixing that surfaced two more holes in the same gates, both from substring matching on a text blob:

- `/agent_run_id/` matched inside `pil_agent_run_id`, so removing the real column passed.
- `/billing_path/` matched a **constraint name**, so removing the real column passed.

Both are now exact set-membership tests on parsed `ADD COLUMN` names, and `ALERT_TYPE_LABEL` keys are matched with a word boundary.

### Verification of the fix

| Check | Result |
|---|---|
| `stripSql()` unit cases | **10 / 10** |
| Gates against the shipped tree | **5 / 5 pass** |
| Deliberate violating mutations | **18 / 18 caught**, each naming its cause |
| Comment-only mentions of a banned construct | **2 / 2 correctly ignored** |

---

## 3. Independent verification of what shipped

Six agent reports made claims. I tested the ones that mattered against the live database rather than relaying them. **Every claim held.**

| Claim | Verified |
|---|---|
| The 39 production alerts wrongly marked delivered were reverted | `alerts` with `notified_at` set: **0**. Critical alerts pending: **69 of 69**. Genuinely reverted. |
| No network call from SQL | Functions calling `net.http_post`: **1**, and it is `extensions.grant_pg_net_access` — a Supabase platform function with **0 triggers** attached, guarded by an `IF EXISTS pg_net` check. Not ours. |
| `pg_net` / `pg_cron` / `http` not installed | **0 network extensions installed** |
| The anon-RPC hole in `raise_orchestration_alert` was closed | anon EXECUTE **false**, authenticated EXECUTE **false**, SECURITY DEFINER **true** |
| The cost backfill did not truncate sub-cent values | `ai_usage_log`: **49 rows**, **$0.377100** total, **0 rows at zero cost**. The `numeric(14,6)` correction did exactly what it was for. |
| All eight alert types live | `alert_type` enum now has **13 values**, all 8 orchestration types present |
| Five dashboard views are RLS-safe | All five carry **`security_invoker = true`** |
| Triggers exist on the target tables | **5** non-internal triggers |
| Rate card seeded | `model_cost_reference`: **5 rows** |

Two agents self-reported incidents rather than hiding them, and both reports were accurate:

- **AR-6.4** ran an unscoped `pollOnce()` against the live database during a test, marking 39 real production critical alerts as delivered to a fake webhook. It detected this itself within minutes, reverted all 39 by id, verified clean, and fixed the root cause by adding a test-only org scope. Independently confirmed above.
- **AR-6.3** found that `REVOKE ... FROM PUBLIC` alone did not close anon RPC access, because Supabase grants EXECUTE to `anon` and `authenticated` individually. Fixed and re-verified. Independently confirmed above.

**AR-6.3 also caught a bug in its own first draft** that the prompt had specifically warned against: Rule 4 compared `items_processed` to `items_expected` with a plain inequality, which would have fired `state_drift` constantly on healthy runs where `12/50` is the normal outcome. It read the orchestrator, found dozens of such call sites, and narrowed the rule to only `NULL` (no evidence) or an impossible over-count.

---

## 4. What actually shipped

**AR-5.1 — one cost ledger.** `ai_usage_log` gains `cost_usd numeric(14,6)`, `agent_run_id`, `pil_agent_run_id`, `provider`, `billing_path`. The 49 `pil_cost_ledger` rows backfilled; that table is now superseded and read-only, not dropped. The agent caught a real error in my own spec: I mapped `pil_cost_ledger.agent_run_id → agent_run_id`, but that column is an FK to `pil_agent_runs`, not the core `agent_runs` — a literal mapping would have violated the new FK on every non-null row.

**AR-5.2 — budgets that actually enforce.** `pil_cost_budgets` → `cost_budgets`, with an `orchestration` scope and an `AFTER INSERT` trigger on `ai_usage_log` that accrues `spent_usd`. Before this, `spent_usd` was read in three places and written by nothing, so `hard_stop` could never fire.

**AR-6.1 — alerts extended, not forked.** Eight new `alert_type` values in their own transaction-isolated migration, plus `orchestration_id` and `notified_at`. No second alert inbox. Deterministic dedup keys — explicitly not the `crypto.randomUUID()` pattern that silently disables dedup elsewhere in the codebase.

**AR-6.2 — `orchestration_logs`.** Org-scoped, RLS on, `schema_validation_passed` and `reconciliation_passed`, no cost columns, `cost_log_id` joins `ai_usage_log`. No single choke point existed in the orchestrator, so the agent instrumented and named the smallest covering set: **51 of 52 distinct step types**. The one gap is AG-38's dedicated cron entrypoint, which has no owning org by design.

**AR-6.3 — five deterministic rules.** `task_failed`, `cost_overage`, `schema_mismatch`, `state_drift`, `timeout` as Postgres triggers; `rate_limit`, `rollback`, `manual_review_required` raised from application code, with `manual_review_required` wired to AutoApply's `IncompleteSubmissionError` path from AR-3.1.

**AR-6.4 — delivery, rate card, views.** Worker-side Slack polling with `notified_at` idempotency and secret redaction; `model_cost_reference` seeded from pricing verified live today with `source` and `effective_from`; five `security_invoker` views. It also found that `ai_usage_log` had RLS enabled with **zero policies** — default-deny — which would have made the cost view permanently empty for real users.

---

## 5. What is not done — stated plainly

**The dashboard's dollar figures are not traceable to the new rate card.** The AR-6.4 agent surfaced this itself rather than claiming success: `model_cost_reference` is created, seeded and freshness-tested, but **nothing consumes it**. `ai_usage_log.cost_usd` is computed by the caller before `recordCost()` runs, from per-file hardcoded rates scattered across roughly 29 files under `src/lib/pil/agents/`. Until those are rewired, the rate card is documentation, not a source of truth. This is the single largest remaining gap in Phase 5/6.

**`orchestration_logs` has 0 rows.** The instrumentation is in place across 51 step types but nothing has executed through it since the migration landed. It is unproven in production until the worker runs a real cycle.

**A second cost writer still exists.** `adapter_usage_log` (migration 076) writes `api_cost_cents` — hardcoded to `0` — on every donor-discovery connector call. Named by the AR-5.1 agent, out of its scope.

**Budgets do not interrupt a running agent.** `checkBudget()` is called once at the start of a run, with no mid-run polling. Exhausting a budget blocks the *next* agent for that org, not the one already executing.

**Rule 2's dedup key has no budget-period component.** If `spent_usd` is ever reset for a new period — no reset mechanism exists yet — a genuine new overage could collide with the old dedup key and be silently dropped.

**Slack delivery is untested end to end.** If `FORGE_SLACK_WEBHOOK` is unset in the Railway environment, critical alerts are raised and stored but never reach Slack. They are not lost; they sit with `notified_at IS NULL`.

**Two commits are unpushed** — `2406403` and `af84661` — because the bridge's Linux side has no GitHub credential.

**Still open from before:** `VERCEL_TOKEN` / `VERCEL_PROJECT_ID` unset, so deploy verification returned INDETERMINATE on both queues; six abandoned `.claude/worktrees/` registrations still dirty every `git status`; the uncommitted `form-filler-agent.ts` retry diff; migration 190 applied before 188/189 (harmless — no dependency — but the ordering is recorded out of sequence).

---

## 6. Next

1. Push the two local commits.
2. Run the Railway worker through one cycle and confirm `orchestration_logs` receives rows. Until that happens, Phase 6 is built but unproven.
3. Decide on the rate-card wiring — a Phase 7 prompt to replace ~29 files of hardcoded rates with lookups against `model_cost_reference`. Without it, no cost figure on any dashboard is defensible.
4. Set `FORGE_SLACK_WEBHOOK` in Railway, or accept that critical alerts stay in-app only.
5. The four legacy phase queues remain `planned` and should stay held until the exercise harness reports.

---

## 7. The honest read on today

Six prompts ran unattended for four and a half hours against a production database and every migration landed correctly. Three separate agents caught and reported their own mistakes — a live-data incident, a security hole, and a rule that would have alarm-fatigued you — rather than reporting success they had not earned. That is the behaviour this whole remediation program was built to produce.

The one thing that broke was a gate I wrote and did not test against the case that actually occurred. My negative tests all used real SQL statements; I never tested a comment that merely mentions the banned string, even after an agent told me that exact failure mode existed. The gates are now tested in both directions, 18 violations and 2 false-positive cases, and the discipline holds: nothing goes into the critical path that has not been executed against the case it is meant to catch.
