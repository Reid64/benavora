# BENAVORA — State of the Build

**Session close:** 2026-09-17
**Scope:** independent agent audit → four-phase remediation program executed to green → Phase 5/6 authored and held
**Standard applied:** no claim in this document is written from documentation. Every figure was read from the live schema (project `vbjplpquqxxfbpazyalt`), from the repository on disk, or from a FORGE run log.

---

## 1. Where the build stands

| | |
|---|---|
| Remediation queues run | **2 of 2 launched, 2 passed, 0 failed** (orchestrator run 11:46–12:59) |
| Remediation phases complete | **4 of 4** (AR-1 … AR-4) |
| Head commit | `5b035c8` |
| Full test suite | **103 files passed / 1 skipped; 915 tests / 13 todo / 0 failures** |
| Agents discovered on disk | **144** (83 in `src/lib/agents/**`, 51 PIL, 9 AutoApply, 1 intelligence) |
| FORGE false-pass paths found | **9 — all 9 fixed, 8/8 verification checks passed on your machine** |
| Phase 5/6 queues | **authored, gate-tested, HELD pending your authorization** |

The headline defect is closed. AutoApply can no longer write `status='submitted'` for a submission it did not make — that is proven by four integration assertions running against a real local server, real Playwright and real Claude, not by a mock.

---

## 2. What the four phases actually changed

**AR-1 — Identity and observability.** PIL error serialization no longer collapses to `[object Object]`; stuck runs are reaped; AutoApply agents have identities, so they appear in `agent_runs` at all. Without this phase nothing downstream is measurable.

**AR-2 — Cross-cutting defects.** Wrong-table reads, agent timeouts, Claude concurrency, schema drift. Worth recording honestly: the AR-2.2 agent **refuted my own audit premise**. `corporate_prospects` already existed (migrations 107/108/109/111/179) and those agents had been succeeding since 2026-09-11. My audit had read stale `agent_runs` error rows as current state. The queue corrected me rather than building on my error.

**AR-3 — The P0.** Three root causes, all confirmed by code read and reproduced experimentally:

1. The `field_mapping` contract was inverted. `FormAnalyzerAgent` returned an array; `FormFillerAgent` accepted only a non-array object and silently discarded it, so the primary mapping path filled zero fields on every run.
2. `submitForm()` clicked and returned — it never awaited navigation or a response, so it could not tell a refused click from a successful submit.
3. An empty `catch {}` swallowed the failure, and `queue-processor.ts` then set `submissionStatus = 'submitted'` unconditionally.

Now: an adapter accepts both shapes; `submitForm()` throws `SubmissionNotVerifiedError` when no submission signal arrives; a pre-submit gate throws `IncompleteSubmissionError` rather than submitting a form known to be incomplete; `FillResult.outcome` is `'submitted' | 'not_submitted' | 'unverified'`; `mapFillOutcomeToStatus()` derives the status; migration 184 added `submit_unverified` and is applied live.

**AR-4 — The keystone.** `scripts/audit/agent-exercise-registry.ts`, `seed-exercise-org.ts` and `exercise-all-agents.ts`. The harness never calls an agent a success without a verified completed `agent_runs` / `pil_agent_runs` row. It refuses any org not prefixed `EXERCISE-HARNESS-`, caps at 25 agents by default, and points browser agents at a local fixture. Three real smoke invocations proved the paths and surfaced a genuine silent-failure bug in `sam_gov_research`.

**On the agent count.** The prior audit said 154. The harness finds 144 and my static inventory found 147. No file in the repository claims 154 — that number does not reconcile against anything on disk.

---

## 3. FORGE hardening — what was actually wrong

You were right that FORGE passed things it should have failed. Nine distinct false-pass paths, all fixed and tagged `2026-09-16/FG-n` in `forge.ps1`:

| Path | Before | After |
|---|---|---|
| FG-2 | A null process `ExitCode` was treated as `0` | `-2`, an explicit failure |
| FG-3 | A prompt with **no gates defined** passed | `NO GATES DEFINED` → fail |
| FG-4 | A YAML parse failure silently yielded zero prompts | throws on non-zero exit, empty output, or zero prompts |
| FG-5 | An **unknown gate type** passed | fails and lists the valid types |
| FG-6 | The `schema` gate was a stub that always passed | disabled, returns fail |
| FG-7 | `build_model` was inert | wired, with a model-rejection fallback |
| FG-9 | `-dryRun` reported a pass it had not earned | returns `dryRun = true`; skipped gates logged as "NOT a pass" |
| gates/test.ps1 | **Finding no tests counted as a pass** | no tests found = exit 1 |
| chain-forge.ps1 | git add/commit/push ran regardless of outcome | conditioned on `$exitCode -eq 0` |

The test gate was the worst of these: a queue whose test discovery found nothing at all reported green.

---

## 4. My own two failures this session, recorded

Both had the same shape — **I put something into the critical path without executing it first.**

**Bug 1 — FG-7 killed the first orchestrator run.** Wiring `--model $model` made the previously inert `build_model: claude-sonnet-4-6-20250514` live, the CLI rejected that ID, the Build Agent died at invocation, both retries burned, and zero code was written. Fixed with a model-rejection fallback, and `build_model` stripped from every queue.

**Bug 2 — a shell gate false FAIL on Phase 3.** An inline `node -e` with nested escaping mangled through YAML → PowerShell temp script → node argv and produced `SyntaxError: Invalid or unexpected token`. That gate could never have passed. The work itself had succeeded.

The correction is procedural, and it is why this session's new gates were handled differently: every gate now ships as a real `.mjs` file that I execute before it goes anywhere near a queue. The five AR-5/AR-6 gates were run against a synthetic passing fixture (**4/4 and 5/5 pass**) and against **17 deliberate violating mutations (17/17 caught, each with a precise message)**.

I also overstated one finding and corrected it: "fills zero fields" was not universally true. Your local pass of `form-analyzer-filler.test.ts` proved a fallback label-matching path does fill. The accurate statement is that the *primary* mapping path was dead in all cases, and the fallback fills only the two or three keys `buildFillData()` can populate.

---

## 5. Phase 5 and 6 — authored, gate-tested, held

Your Orchestration Logging & Alerting Specification v1.0 is sound engineering. Deterministic Postgres triggers instead of meta-agents in the hot path is the right call; "no interpretive AI summaries of logs" is exactly correct for a forensic layer; and `schema_validation_passed` is the single most valuable field in the design — the AutoApply defect above *is* an evidence-validation failure that nothing recorded.

But it was written without visibility into what already exists. Six of its assumptions are wrong about this codebase. All are cheap to fix now and expensive to fix after a build agent has followed the spec literally.

| # | Spec v1.0 assumption | Live reality (verified 2026-09-17) | Correction baked into the queue |
|---|---|---|---|
| 1 | Scope every table and RLS policy by `company_id` | **146** columns named `organization_id`; **0** named `company_id` | `organization_id`, enforced by a gate that fails the build if `company_id` appears in any migration ≥ 185 |
| 2 | Create `orchestration_alerts` with ack/dismiss/severity/dedup | `alerts` has **1,806 rows**, fired this morning, and already has all four (`is_read`, `is_dismissed`, `snoozed_until`, `uq_alerts_org_dedup`) | Extend the existing enum with the 8 types; **do not fork the inbox** |
| 3 | Add `orchestration_cost_budget` and cost columns | 14 cost/usage/budget/alert tables already exist, 9 empty, 3 disagreeing. `ai_usage_log` is empty, correctly named, and written by nothing | `ai_usage_log` becomes the single ledger; `orchestration_logs` holds execution facts only with a FK to the cost row |
| 4 | Diff `STATE_OF_THE_BUILD.md` per task, raise **critical** `state_drift` on mismatch | That file is a governance doc build agents write every run | Reconcile against the **database**. A critical alert that fires on normal operation trains you to ignore critical alerts |
| 5 | Triggers notify Slack | **`pg_net`, `pg_cron` and `http` are all available but NOT installed.** A trigger calling `net.http_post` errors inside the transaction that raised the alert — losing the alert | Delivery is a poller in the existing Railway worker, using `FORGE_SLACK_WEBHOOK`, setting `notified_at` only on 2xx |
| 6 | Rate card listing `claude-opus-4` / `claude-sonnet-4`, dated Sept 2025 | Neither ID appears anywhere in `src/` or `worker/`. The models actually called are `claude-sonnet-4-6` (41 refs) and `claude-haiku-4-5-20251001` (5 refs) | Seeded from pricing verified today, with `source` and `effective_from`, plus a test that fails if a rate is older than 180 days |

Two further defects surfaced while grounding the spec, and both are now fixed by the queue:

- **`ai_usage_log.estimated_cost_cents` is an INTEGER.** A Haiku call of 1,000 in / 500 out costs $0.0035 — zero cents. Per-call tracking in integer cents records most of this platform's spend as nothing. The queue adds `cost_usd numeric(14,6)`.
- **`spent_usd` is read in three places and written by nothing.** Budget enforcement is decorative: spend never accrues, so `remaining` is always the full limit, so `hard_stop` can never fire. Two agents compute a spend percentage from a number frozen at its insert value. The queue adds an accrual trigger on the cost ledger.

### The two queues

**`ar-5-cost-consolidation`** — 2 prompts, ~5h. One cost ledger; real budget enforcement. This runs first because building the orchestration layer on an incoherent cost model produces a fourth cost model inside the system whose job is telling you the truth about the others.

**`ar-6-orchestration-observability`** — 4 prompts, ~12h. `orchestration_logs` (org-scoped, RLS, `schema_validation_passed` + `reconciliation_passed`, no cost columns); the 8 alert types on the live `alerts` table; deterministic rules 1–5; worker-side Slack delivery, verified rate card, RLS-safe dashboard views.

Both are `status: planned` in the manifest — **held, not armed.** Zero ungated prompts; each of the six carries compile + test + file_exists + a self-tested shell gate. Your secret-redaction constraint is written into the prompts that touch `error_message`, `state_delta` and the Slack body.

**Why held rather than armed.** The correct position for this spec is *after the exercise harness reports*, so it instruments the paths the harness proves actually execute rather than all 144 speculatively. The harness exists; the live 144-agent pass has not been run, because it spends Console credits and needs your cost approval.

---

## 6. What I need from you

**One decision, two commands.**

The decision: run the 144-agent harness pass first (it costs Console credits and will tell us which agents are worth instrumenting), or arm Phase 5 now from the corrected spec.

To arm Phase 5/6, change `status: planned` to `status: pending` on both entries in `FORGE\library\benavora\library-manifest.yaml`, then:

```powershell
cd C:\Users\manag\Documents\FORGE; .\forge-orchestrator.ps1 -project benavora -dryRun
```

Confirm the plan lists `ar-5-cost-consolidation` then `ar-6-orchestration-observability` in that order, then drop `-dryRun`.

The nine gate scripts are **staged but not committed** — the Linux side of the bridge has no git identity configured, so the commit has to come from your machine:

```powershell
cd C:\Users\manag\Documents\benavora; git commit -m "[FORGE] Add the nine forge-gate scripts as real files"; git push origin main
```

---

## 7. Open items, honestly stated

| Item | Impact | Status |
|---|---|---|
| `DATABASE_URL` password is stale | Parks the WGR-170 guard; blocks local integration runs | Needs rotation — **blocks AR-5.2's integration test** |
| `VERCEL_TOKEN` / `VERCEL_PROJECT_ID` unset | `deploy_verify` returns INDETERMINATE every queue | Set them, or accept the indeterminate |
| 6 abandoned `.claude/worktrees/` registrations | `git status` fails from the bridge; noise in every agent's diff | Prune |
| Uncommitted retry-logic diff in `form-filler-agent.ts` | Unrelated to AR-3; the AR-3 agent correctly declined to misattribute it | Your call: keep or revert |
| Stale queue copies in `FORGE\archive\benavora\` | Cosmetic | Delete when convenient |
| `gates/file_exists.ps1` duplicates inline logic (FG-8) | Latent divergence | Deferred |
| ~30 remaining FORGE hardening items | Provider wrapper, git checkpoint/rollback, Recovery Agent scope limits, preflight validation, `expected_outputs`, evidence JSONL, resume safety | Deferred by design — the 9 false-pass paths were the ones that mattered |
| Legacy phase queues 1–4 | Authored 2026-09-10 from the code-only audit that misclassified `renewal-tracker-agent.ts` | **HELD.** Re-validate against harness output before arming |

One recorded observation that is not in scope but will bite eventually: several agents build `dedup_key` with `crypto.randomUUID()` appended (`base-agent.ts:232`, `autonomous-base.ts:292`, `deadline-prediction-agent.ts:560` and others). Every key is therefore unique, so `uq_alerts_org_dedup` never fires and those alerts never dedup at all. The AR-6 prompts forbid copying that pattern and log it as follow-up work.

---

## 8. The one thing worth remembering from this session

The platform's most expensive defect was not a crash. It was a success report that had not been earned — `status='submitted'`, no confirmation number, no screenshot, no error, nothing thrown. Every structural change in these four phases points the same direction: make a claim of success falsifiable, and make failure loud. `schema_validation_passed`, `reconciliation_passed`, `submit_unverified`, gates that fail when they find no tests, and a harness that refuses to call an agent successful without a database row proving it.

Phase 5/6 is the layer that makes every remaining claim in this build checkable. That is why it is worth doing properly rather than quickly.
