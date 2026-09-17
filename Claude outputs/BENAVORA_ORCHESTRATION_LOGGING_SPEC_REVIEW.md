# BENAVORA Orchestration Logging & Alerting Spec — Engineering Review

**Reviewed:** 2026-09-17
**Spec version reviewed:** 1.0 (dated September 2025)
**Reviewer method:** every claim below checked against the live production schema (`vbjplpquqxxfbpazyalt`), not against documentation.
**Verdict:** Accept the design. Reject three of its assumptions. It must not be queued as written.

---

## 1. Verdict in one paragraph

The spec is sound engineering. Deterministic Postgres triggers instead of meta-agents in the hot path is the right call, the alert taxonomy is well chosen, and the "no interpretive AI summaries of logs" constraint is exactly correct for a forensic layer. Three of its assumptions are wrong about *this* codebase, and one of them — the tenancy column — would corrupt the schema if an agent built it verbatim. All three are cheap to fix before the build, and expensive to fix after.

---

## 2. Blocker — the tenancy column does not exist

The spec scopes every table, every RLS policy, and every dashboard query by **`company_id`**.

Live schema, queried 2026-09-17:

| Check | Result |
|---|---|
| Columns named `organization_id` in `public` | **146** |
| Columns named `company_id` in `public` | **0** |
| `agent_runs.organization_id` exists | yes |
| `agent_runs.company_id` exists | **no** |

`company_id` appears nowhere in Benavora. The convention is `organization_id`, used by 146 columns including `agent_runs`, `alerts`, `pil_agent_runs`, and every RLS policy in the migration set.

**If this spec is handed to a build agent unmodified, one of two things happens.** Either it creates `orchestration_logs.company_id` and Benavora now has two tenancy conventions — at which point RLS is enforced inconsistently and cross-tenant leakage becomes a live risk — or the build fails on the first foreign key. Neither is acceptable.

**Fix:** global rename `company_id` → `organization_id` throughout the spec before any queue references it. One pass, zero ambiguity.

**Related governance note.** Your Six Laws state Law 1 as *"tables in real DB, RLS + company_id policy applied."* That wording is correct for DialStars and Cordial, which do use `company_id`. It is wrong for Benavora. The Six Laws are project-agnostic but this clause is not — worth qualifying it per-project so the next spec doesn't inherit the same error.

---

## 3. Blocker — you already have a working alerting system, and this would fork it

The spec proposes a new `orchestration_alerts` table with acknowledge/dismiss lifecycle, severity, and dedup.

**The live `alerts` table already has all of that**, and it is firing right now:

```
alerts columns: id, organization_id, type (enum), severity (enum), message, link,
                is_read, read_at, is_dismissed, dismissed_at, snoozed_until,
                dedup_key, opportunity_id, application_id, deadline_id,
                created_by, created_at, updated_at
```

| Alert type | Rows | Latest |
|---|---|---|
| `new_opportunity` | 1,203 | 2026-09-02 |
| `system` | 503 | **2026-09-17 07:05 — this morning** |
| `deadline_due` | 30 | 2026-09-02 |
| `draft_review` | 5 | 2026-09-08 |
| **Total** | **1,741** | live |

That table already provides, natively: org scoping, a severity enum, acknowledge (`is_read`/`read_at`), dismiss (`is_dismissed`/`dismissed_at`), snooze (`snoozed_until`), and noise suppression (`dedup_key`). The spec asks for every one of those as if they don't exist.

**Fix:** do not create `orchestration_alerts`. Extend the existing `alerts` type enum with the spec's eight values — `task_failed`, `cost_overage`, `schema_mismatch`, `state_drift`, `rate_limit`, `timeout`, `rollback`, `manual_review_required` — and add a nullable `orchestration_id` FK. You inherit 1,741 rows of history, the existing dashboard, the dedup logic, and the acknowledge flow for free, and you avoid maintaining two alert inboxes.

---

## 4. Blocker — this would be your fourth cost-tracking system

Live inventory of cost, usage, budget and alert tables:

| Table | Rows | Status |
|---|---|---|
| `alerts` | **1,741** | live, firing today |
| `usage_metrics` | 111 | live |
| `pil_cost_ledger` | **49** | live |
| `usage_tracking` | 4 | barely used |
| `submission_usage` | 2 | barely used |
| `intelligence_budget_patterns` | 5 | live |
| `adapter_usage_log` | 0 | empty |
| `ai_usage_log` | 0 | **empty — and named exactly for this purpose** |
| `org_usage_summary` | 0 | empty |
| `pil_cost_budgets` | 0 | empty |
| `pil_delegation_budgets` | 0 | empty |
| `grant_budgets` | 0 | empty |
| `intelligence_budget_templates` | 0 | empty |
| `reputation_alerts` | 0 | empty |

**Fourteen tables. Nine of them empty.** Three already track cost (`pil_cost_ledger`, `submission_usage`, `usage_metrics`) and none of them agree with each other. `ai_usage_log` exists, is named for precisely what this spec wants, and has never been written to.

Adding `orchestration_logs` + `orchestration_cost_budget` without consolidating makes seventeen tables and a fourth cost model. This is the same duplication pattern the 2026-09-16 agent audit found throughout the agent layer — about to be repeated one layer up, in the system whose entire job is telling you the truth about the others.

**Fix:** before building, decide which of the existing tables is canonical. My recommendation: `ai_usage_log` becomes the single per-call cost ledger (it's empty, correctly named, and nothing depends on it), `pil_cost_ledger` is migrated into it, and `orchestration_logs` carries execution facts only — status, timings, tokens, error codes, state deltas — with a FK to the cost row rather than its own cost columns. One source of cost truth.

---

## 5. Correction — the model cost table is a year stale, and only half applies

The spec's rate card is dated September 2025 and lists `claude-opus-4` / `claude-sonnet-4`. Those rates must be re-verified against current pricing before they are written into `model_cost_reference`; a stale rate card produces confidently wrong cost numbers, which is worse than no cost tracking because it gets trusted.

More importantly, **the cost model only applies to one of your two spend paths**, and the spec doesn't distinguish them:

- **Benavora runtime agents** (the Railway worker, API routes) call the Anthropic API with `ANTHROPIC_API_KEY` and consume Console credits. Per-token cost tracking is meaningful here. This is what the spec should cover.
- **FORGE build runs** call the `claude` CLI, which authenticates against the Max subscription. There is no per-token dollar cost to track. `forge-orchestrator.ps1` explicitly sets `$env:ANTHROPIC_API_KEY = $null` to force this.

If `orchestration_logs` is meant to cover FORGE runs too, its cost columns are meaningless for those rows and will read as $0.00 spend against a real subscription. Scope the spec to runtime agents, or add a `billing_path` discriminator.

---

## 6. Design question — reconciling runtime state against a markdown file

Section 8 proposes snapshotting `STATE_OF_THE_BUILD.md` before and after each task, diffing it, and raising a **critical** `state_drift` alert on mismatch.

`STATE_OF_THE_BUILD.md` is a governance document maintained by build agents. It is not runtime state. Diffing it per-task will produce drift alerts constantly — every governance update an agent makes is, by this definition, drift — and a critical alert that fires on normal operation trains you to ignore critical alerts.

**Recommendation:** reconcile runtime state against the database, which is the actual source of truth — did the `agent_runs` row reach a terminal status, did the expected rows appear in the target table, does `items_processed` match what was written. Keep `STATE_OF_THE_BUILD.md` reconciliation as a separate, low-frequency governance check at session close, not a per-task critical alert.

---

## 7. What the spec gets right and should be preserved verbatim

- **Deterministic Postgres triggers, no meta-agents in the hot path.** Correct. A monitoring agent that can itself fail is not monitoring.
- **No interpretive AI summaries of logs.** Correct, and directly addresses the failure mode the agent audit documented: a system that reported success it had not earned.
- **`schema_validation_passed` as a first-class column.** This is the single most valuable field in the design. The audit's headline defect — AutoApply writing `status='submitted'` with no confirmation number and no screenshot — is exactly a schema/evidence validation failure that nothing recorded.
- **`reconciliation_passed` blocking downstream tasks.** Correct, and it is what would have stopped the AutoApply pipeline from chaining off a phantom submission.
- **Alert taxonomy.** All eight types are real failure modes this platform has actually produced. `timeout` alone would have surfaced the six agent types silently dying on the 60-second `AGENT_TIMEOUT_MS` for months.
- **Manual acknowledge/dismiss on every alert.** Correct — and already implemented in the `alerts` table.

---

## 8. Corrected build sequence and where it belongs in the program

This spec is the mature version of what the remediation program's **Phase 1** does minimally. Phase 1.1 fixes PIL error serialization and stuck-run reaping; Phase 1.2 gives AutoApply agents identities so they appear in `agent_runs` at all. Both are prerequisites for this spec — you cannot log orchestration decisions for agents that have no identity, and you cannot alert on failures whose error column reads `[object Object]`.

Correct position: **Phase 5**, immediately after the Phase 4 exercise harness reports. The harness tells you which agents actually execute and how they fail; this spec then instruments precisely those paths rather than all 316 modules speculatively.

Revised sequence, with the corrections above applied:

| Step | Work | Change from spec v1.0 |
|---|---|---|
| 5.1 | Consolidate cost tracking into `ai_usage_log`; migrate `pil_cost_ledger` | **New** — not in spec |
| 5.2 | Extend `alerts` enum with the 8 orchestration types + `orchestration_id` FK | **Replaces** the `orchestration_alerts` table |
| 5.3 | Create `orchestration_logs` scoped by `organization_id`, execution facts only | `company_id` → `organization_id`; cost columns removed |
| 5.4 | Create `orchestration_cost_budget` on `organization_id` | `company_id` → `organization_id` |
| 5.5 | Trigger functions for Rules 1–5, writing into `alerts` | Rule 4 reconciles against the DB, not `STATE_OF_THE_BUILD.md` |
| 5.6 | Re-verify and populate `model_cost_reference` from current pricing | Rate card must not be copied from the 2025 spec |
| 5.7 | Slack Edge Function | Reuse the existing `FORGE_SLACK_WEBHOOK` / `forge-slack.ps1` webhook rather than provisioning a second |
| 5.8 | Dashboard views | Unchanged — the five views in §5 are well specified |

---

## 9. Bottom line

The design is right and the instinct behind it — replace judgment with deterministic rules, keep ground truth in Postgres, make failures loud — is exactly what this platform needs and exactly what it has been missing.

But it was written without visibility into what already exists. Built as specified, it would add a second alerting system beside one with 1,741 live rows, a fourth cost model beside three that disagree, and a tenancy column that appears nowhere in 146 org-scoped columns.

Fix those three things and this becomes the most valuable phase in the program. It is the layer that makes every other claim in this build falsifiable.
