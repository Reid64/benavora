# BENAVORA — State of the Build

**Overnight run:** 2026-09-18, 00:13 → 07:52 — **7h 39m unattended, one RUN**
**Queues:** ar-8, ar-9, ar-10, ar-11, ar-12 — **5 launched, 5 passed, 0 failed**
**Prompts:** 16 of 16 complete
**Standard:** every figure below was read from the live database or the repository after the run. Agent self-reports are marked as such and were checked, not relayed.

---

## 1. Throughput — the estimate correction holds

| Run | Prompts | Wall clock | Per prompt |
|---|---|---|---|
| AR-5 | 2 | 85.6 min | 43 min |
| AR-6 | 4 | 175.7 min | 44 min |
| AR-7 | 3 | 122.4 min | 41 min |
| **AR-8…12 (overnight)** | **16** | **459 min** | **29 min** |

Sixteen prompts in under eight hours. The earlier "~5h / ~12h / ~17h" estimates were 3–4x over; the real figure is now 29–43 minutes per prompt including gates and retries. **Use 35 min/prompt for planning.**

---

## 2. The headline: the observability layer now actually observes

This was the defect the run was built around. Before it, Phase 5 and Phase 6 were both marked complete, both deployed, and both capturing nothing from real traffic.

| | Before (09-17 ~21:00) | After (09-18 ~08:00) |
|---|---|---|
| `orchestration_logs` rows, all time | **0** | **580** |
| `orchestration_logs`, last 6h | 0 | **396** (against 384 agent runs) |
| `ai_usage_log` rows | 49 — *all backfill* | **70** |
| `ai_usage_log` recorded spend | $0.377100 (backfill only) | **$0.561057** |
| EA-family agent invocations | **0** in 3h | **9** in 8h |
| Migrations applied | 194 | **200** |

`orchestration_logs` going 0 → 580 against real production traffic is the single most important number on this page. It is the first time this platform's execution record has been real rather than asserted.

**The gate that made it real.** `live-capture.mjs` queries production and fails when a deployed writer captures nothing. It did exactly that at 02:50 — `ai_usage_log received 0 row(s) in the last 6h while agent_runs logged 417` — forcing a retry that produced an actual fix rather than a green checkmark. Every prior gate on this work had passed by confirming the migration, the table and the writer existed.

---

## 3. Honest partial: cost capture is wired but thin

`ai_usage_log` is capturing, and the total moved. But **only 4 rows landed in the last 6 hours against 384 agent runs.** The AR-9.2 agent named the reason itself rather than hiding it: roughly 30 raw `new Anthropic(...)` construction sites in autoapply, intelligence and donor-discovery still bypass the tracked wrapper.

So the claim "every Anthropic call records cost" is **not yet true**. What is true: the path that most core agents take now records, the ledger is no longer empty, and the remaining bypass is enumerated rather than unknown.

---

## 4. What the agents found that I had wrong

Three corrections came from the build agents, and all three were right.

**`funder_not_found` was one event, not six.** My AR-12.1 prompt asserted it was the recurring blocker. The agent checked and found it occurred **exactly once, ever** (02:42:18 UTC). The real root cause it then traced: `FunderDetail.tsx`'s delete button runs a client-side `funders.delete()` with no awareness of `submission_queue`, and the FK is `ON DELETE SET NULL` rather than a block — so deleting a funder silently orphans its queue items. Migration 200 now cancels dependents terminally and raises an alert, covering every deletion path rather than one button.

**The "~29 files" of hardcoded rates was stale.** The real figure was **54 files** carrying a single `MODEL_TOKEN_UNIT_COST_USD = 0.00002` constant — a flat, unsourced $20/MTok.

**And the finding that matters most for your numbers:** while wiring that, the agent found `AgentRunner.finalizeRun()` was writing a **second, duplicate** `ai_usage_log` row for every PIL agent run. Combined with the wrong rate, **PIL-sourced dollar figures were overstated by roughly 4.4x** (2.22x bad rate × 2x double-write). Rows also recorded `model: "unknown"`, so even correctly-priced rows could not be traced back to the rate card. All three fixed.

---

## 5. A FORGE behaviour worth knowing about

**Five of the sixteen prompts ended mid-sentence in a wait state** — "I'll pause here and wait for the background verification", "Waiting on `pnpm run build` to finish" — and their gates ran and passed anyway, because FORGE gates the working tree, not the agent's narration.

Four times that was harmless: the artifact existed, the tests passed, the work was committed.

**Once it was not.** `ar-10-3-budget-teeth` passed all four gates at 04:59 with its work sitting **uncommitted**. Migration 198 had been applied to production — `cost_budgets.period_start` is live, verified — while the migration file and the `cost.ts` code calling its new `get_cost_budget_with_reset()` RPC were never committed. Production schema was ahead of source control, and the next agent reading the repo would have seen no period logic at all.

Landed as `c1ae360b` this morning, along with AR-9.3's `AGENT_INVOCATION_MAP.md`, orphaned the same way. Working tree is now clean.

**The lesson for the next queue set:** a gate should assert the work is *committed*, not merely present. That is a one-line addition to the gate library and it belongs in the next run.

---

## 6. Your CI emails

Both root causes are now fixed.

- **`exit 128`** — six `.claude/worktrees` gitlinks (mode 160000, no `.gitmodules`, pointing at absolute Windows paths). Fixed in `dfd7d78`.
- **`exit 1`** — `createAdminClient()` throwing without `SUPABASE_SERVICE_ROLE_KEY`, which no workflow supplied. Fixed in `dbe8ab1` with a deliberate placeholder (never the real key — it bypasses every RLS policy in the platform), then AR-8.1 added `export const dynamic` to all 76 remaining route handlers and a fail-fast guard script.

**The proof that matters:** the AR-8.1 agent moved `.env.local` aside and ran the production build with *only* the workflow's four environment variables. **Exit 0.** No third missing variable. That is the first time this has actually been demonstrated rather than assumed.

---

## 7. Still open

**`autoapply_queue_processor` has still never completed a run.** 0 completed. It now records 3 runs as `status='skipped'` — a new status from migration 199, correctly distinguishing business-rule skips from failures, which is progress in honesty rather than in function. The blocker has moved three times (field mapping → session deadlock → funder resolution) and each move was real.

**`processItem()` is still unproven end to end.** The AR-12.3 agent was explicit about this rather than quietly narrowing its test: `assertUrlSafe()`'s SSRF guard blocks every private address, so a local fixture portal can never reach the outer orchestration. What *is* proven is the named submission chain — mutex guard → StealthBrowser → FormAnalyzerAgent → FormFillerAgent → status mapping → `autoapply_submissions` → session finalization, 5/5 assertions against real Playwright and real Claude.

**A real production bug that proof surfaced:** `FormFillerAgent.buildFillData()` sourced EIN, email, phone and address from `knowledge_base.category` string matches, but `knowledge_base_category` is a closed Postgres enum with no such members. Those fields were **silently unfillable for every organization**, regardless of profile completeness — and because a "mapped" field is excluded from the Claude fallback, they were doubly dead. Fixed.

**Deploy verification is still INDETERMINATE on every queue** — `VERCEL_TOKEN` / `VERCEL_PROJECT_ID` unset. AR-8.3 documented exactly what is needed in `.env.local.example` without inventing values. Five consecutive queues have now ended with production drift unchecked.

**~30 raw `Anthropic()` sites** still bypass the cost ledger (§3).

**10 sites** where an error is discarded by omission rather than conflated — a distinct shape from the 55 AR-11.2 fixed, ledgered in `test-evidence/ERROR_CONFLATION_LEDGER.md`.

**The 59 never-executed agents** have not been triaged. `AGENT_INVOCATION_MAP.md` now exists to build that on.

---

## 8. What changed in how this gets built

The run validated one design change and exposed the need for another.

**Validated: forensics-before-fix.** After AR-7.2 dutifully fixed a hypothesis I handed it as fact, AR-9.1 and AR-12.1 were written to investigate and report, with the fix in a later prompt. AR-12.1 immediately corrected my premise on its first step. That structure works and should be the default wherever the cause is not already proven.

**Exposed: gates must assert landed work.** §5. Compile, test and file_exists all pass against an uncommitted tree.

**And the one that produced tonight's headline:** a gate that asks the repository whether code exists cannot tell you whether the system works. `live-capture.mjs` asks production whether a row arrived. Every observability claim from here forward should be gated that way.
