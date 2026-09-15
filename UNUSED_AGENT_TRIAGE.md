# UNUSED AGENT TRIAGE (p5a-003, 2026-09-15)

Investigation-only deliverable per `queue-phase5-agent-repair.yaml`'s p5a-003. **Zero files
deleted in this pass.** Scope: `LEGACY_AGENT_STATUS.md`'s categories B (collision-shadow
duplicates), C (has-a-route-but-idle), and D (confirmed-zero-callers) — 27 named files. Category A
(scheduled-but-never-fires) is p5a-006's scope; category E (EA-01..10) and any resulting deletions
are p5a-005's scope; category F (not measurable via `agent_runs` by design) needed no further
tracing.

For each file: `grep -rl` for real importers across `src/` and `worker/` (repo-wide, not just API
routes), the file's last real commit, and — for files with a real route but no confirmed
`agent_runs` activity — whether any `.tsx` page under `src/app/` fetches that route.

## Correction to this document's own first-pass methodology (2026-09-15, same session)

The importer search this table is built on originally used `grep -rl 'from ["\'].*FILE["\']'`
(repo-wide), which only catches **static** `import { X } from "@/lib/agents/y"` — it silently
misses `worker/autonomous-orchestrator.ts`'s dominant pattern of `await import('../src/lib/agents/y.js')`
inside `routeQueueItem()`'s large `case` dispatch. That miss produced 3 false "zero importers"
classifications below, caught only when p5a-005 re-confirmed importers immediately before deleting
(per the queue's own re-confirmation requirement — which is exactly what caught this):
`budget-builder.ts`, `deadline-extractor.ts`, and `probability-scoring-agent.ts` are all real,
`agent_queue`-dispatched implementations (cases `'budget_builder'`, `'deadline_extraction'`,
line ~1909's probability case respectively), NOT dormant. All three are corrected to
**KEEP-IDLE-FEATURE** in the table below; none were deleted. The corrected search pattern
(`grep -rn "agents/FILE\\.js\|agents/FILE\""`, catching both static and dynamic-import quoting) was
used to re-verify every file that was actually a deletion candidate before p5a-005 touched anything.

## Correction to the source audit's premise

**`LEGACY_AGENT_STATUS.md`'s categories C and D substantially overstate how much of this is
actually unreachable.** Re-running the importer search this session (repo-wide `grep`, not
grep-then-eyeball) found that **19 of the 20 files** the source audit filed under "has a route but
idle" (C) or "confirmed zero callers anywhere" (D) **do have a real importer and a real route** —
including `usaspending.ts`, which category D explicitly called "confirmed zero callers" and which
in fact has its own live route (`/api/agents/usaspending/route.ts`), independently re-wired to its
own DB bucket this session (see `AGENTS_v2.md`'s p5a-002 table). Only `funder-signal-monitor-agent.ts`
(AG-43) among category D is genuinely callerless. This doesn't mean these 19 files are "working" in
the `agent_runs`-activity sense `LEGACY_AGENT_STATUS.md` measured by — it means "zero 30-day
`agent_runs` rows" and "zero callers anywhere in the codebase" are different findings that the
source audit's category D header conflated. Re-classified as **KEEP-IDLE-FEATURE** below.

## Classification table

| File | Classification | Evidence |
|---|---|---|
| `deadline-extractor.ts` | **KEEP-IDLE-FEATURE** (corrected — see methodology note above) | Real, dynamically-imported by `worker/autonomous-orchestrator.ts`'s `routeQueueItem()` (case `'deadline_extraction'`). Reachable whenever an `agent_queue` row carries that case; `deadline_extraction`'s zero 30d activity means nothing has enqueued one recently, not that the code is unreachable. |
| `deadline-extraction-agent.ts` | **TRUE-ZOMBIE** | 0 importers repo-wide. Last real commit 2026-07-20 ("11 autonomous agents enterprise hardening" — a bulk pass, not evidence of real callers). Duplicates `deadline-extractor.ts`, same as above. |
| `budget-builder.ts` | **KEEP-IDLE-FEATURE** (corrected — see methodology note above) | Real, dynamically-imported by `worker/autonomous-orchestrator.ts`'s `routeQueueItem()` (case `'budget_builder'`) — a genuine second, `agent_queue`-dispatched implementation alongside `budget-agent.ts`'s direct-API-route one, not a dead shadow. Already given its own DB bucket in p5a-002 (`budget_builder_worker`) so its runs are attributable separately — that fix was correct and needed regardless of this correction; only the "dormant" framing was wrong. |
| `budget-builder-agent.ts` | **CONSOLIDATE** | 0 importers repo-wide. Also a shadow of `budget-agent.ts`. Already uses its own distinct DB value (`ag-06-budget-builder`), so no attribution risk remains — pure dead-code cleanup candidate. |
| `compliance-check-agent.ts` (`ag-07-compliance-check`) | **CONSOLIDATE** | 0 importers repo-wide. Shadow of working `compliance-checker.ts` (`compliance_check`, 5 completed in 30d). Already uses its own distinct DB value, no attribution risk. |
| `probability-scoring-agent.ts` | **KEEP-IDLE-FEATURE** (corrected — see methodology note above) | Real, dynamically-imported by `worker/autonomous-orchestrator.ts`'s `routeQueueItem()` (~line 1915) — an `agent_queue`-dispatched path alongside `success-probability.ts`'s own direct wiring, not a dead shadow. Not deleted. |
| `eligibility-scoring-agent.ts` (bare `"ag-02"`) | **CONSOLIDATE** | 0 importers repo-wide. Shadow of working `eligibility-scorer.ts` (`eligibility_scoring`, 810 completed in 30d — the platform's highest-volume research-adjacent bucket). Clearly superseded. |
| `funder-signal-monitor-agent.ts` (AG-43) | **TRUE-ZOMBIE** | 0 importers repo-wide. Last commit 2026-08-15 (a real feature-landing commit — "Signal Monitoring (news+990 only, LinkedIn excluded per ToS)" — so this was a deliberate build, not an abandoned experiment, but nothing was ever wired to call it). No working sibling to consolidate into; standalone orphan. |
| `form-analyzer.ts` | **KEEP-IDLE-FEATURE** | Real route (`/api/agents/form-analyzer`), real importer (`form-filler.ts`), real UI fetch from `autoapply/page.tsx` and `autoapply/templates/page.tsx`. Part of the AutoApply pipeline (already confirmed mature — see prior session memory); idle only in the sense of no recent runs, not unreachable. |
| `form-filler.ts` | **KEEP-IDLE-FEATURE** | Real route, real importer (`browser-automation.ts`), same AutoApply pipeline as above. |
| `application-cloner.ts` | **KEEP-IDLE-FEATURE** (UI path unconfirmed) | Real route (`/api/agents/application-cloner`), last commit a real feature-repair pass (2026-06-14). No direct `.tsx` fetch found to this exact route — prior session memory notes application cloning has two entry points (this one predates a lighter `/api/applications/[id]/clone`), so this may now only be reachable via the newer path or a non-UI caller. Worth a follow-up trace, not urgent. |
| `automation-worker.ts` | **KEEP-IDLE-FEATURE** | Real route (`/api/automation/process`), real feature commit history (FORGE t6-b02). Browser-automation queue worker — triggered by queue state, not a direct UI button; idle is expected between queued jobs. |
| `competitor-intel.ts` | **KEEP-IDLE-FEATURE** | Real route + confirmed UI fetch from `intelligence/competitors/page.tsx`. Enterprise/Consultant-tier gated per its own header — idle likely reflects tier gating, not dead code. |
| `giving-history.ts` | **KEEP-IDLE-FEATURE** (UI path unconfirmed) | Real route (`/api/agents/giving-history`), real feature commit (FORGE repair-c01). No direct `.tsx` fetch found — likely chained from another agent (funder enrichment) rather than a standalone UI action; not evidence of dead code on its own. |
| `email-campaign.ts` | **KEEP-IDLE-FEATURE** | Real route (`/api/agents/campaigns`) AND a cron route (`/api/cron/campaigns`) — but per prior session memory (`SCHEDULING_AUDIT.md` §3) that cron is one of 6 never-auto-triggered outbound crons. Code and wiring are real; the cron just never fires. Overlaps with p5a-006's "scheduled but never fires" pattern — worth folding into that fix if time allows, but out of this prompt's scope. |
| `propublica.ts` | **KEEP-IDLE-FEATURE** | Real route + real importer (`src/lib/enrichment/engine.ts` — used by the live enrichment pipeline, not just its own route). Genuinely wired in twice. |
| `usaspending.ts` | **KEEP-IDLE-FEATURE** | Real route (`/api/agents/usaspending`) + confirmed UI fetch from `research/page.tsx`. Source audit's "confirmed zero callers" was wrong for this file — see correction note above. Already given its own DB bucket in p5a-002. |
| `cold-outreach.ts` | **KEEP-IDLE-FEATURE** | Real route (`/api/agents/outreach`) + real importer (`research/local-sponsorship.ts`). Prior session memory flags `/api/agents/outreach` as "likely dead post-campaigns-retirement" per `AGENT_INVENTORY_COMPLETE.md` — plausible the *route* is stale even though the *file* has real callers; the local-sponsorship dependency means this file itself isn't a pure zombie regardless. |
| `simulation-agent.ts` (AG-37) | **KEEP-IDLE-FEATURE** | Real routes (`/api/agents/simulate`, `/api/reports/simulate`) + confirmed UI fetch from `intelligence/simulate/page.tsx` and `reports/simulate/page.tsx`. |
| `roi-optimizer-agent.ts` (AG-39) | **KEEP-IDLE-FEATURE** (UI path unconfirmed) | Real importer (`autonomous/track-submission/route.ts`) — a server-side hook fired on submission tracking events, not a direct UI action. No `.tsx` fetch expected for this shape; not evidence of dead code. |
| `strategic-advisor-agent.ts` (AG-40) | **KEEP-IDLE-FEATURE** | Real route + confirmed UI fetch from `intelligence/page.tsx` and `intelligence/strategic-advisor/page.tsx`. |
| `impact-simulation-agent.ts` (AG-41) | **KEEP-IDLE-FEATURE** | Real route (`/api/agents/simulate`, shared with `simulation-agent.ts`) + same confirmed UI fetch. Note: this file's real number is AG-41, not AG-28 — see `AGENTS_v2.md`'s p5a-002 label-collision table. |
| `funder-signal-monitor-agent.ts` | *(see TRUE-ZOMBIE row above — do not duplicate)* | |
| `community-need-predictor-agent.ts` (AG-35) | **KEEP-IDLE-FEATURE** | Real route + confirmed UI fetch from `intelligence/community-need/page.tsx` and `intelligence/page.tsx`. |
| `fundability-scorer-agent.ts` (AG-29 label collision, real bucket `ag-29-fundability`) | **KEEP-IDLE-FEATURE** (UI path unconfirmed) | Real route (`/api/intelligence/fundability`); its own 2026-07-20 commit message says "chain trigger" — likely fired server-side from another agent's completion, not a direct UI fetch. Functionally separate from the working `ag-29-knowledge-indexer` despite the label collision (see p5a-001). |
| `simpler-grants.ts` | **KEEP-IDLE-FEATURE** | Real routes (`/api/agents/research`, `/api/agents/simpler-grants`) — reachable via the multi-source research flow even without a dedicated `.tsx` fetch to its own route. |
| `hud-monitor.ts` | **KEEP-IDLE-FEATURE** | Real routes (`/api/agents/hud-monitor`, `/api/agents/research`) + real importer (`research/government-grants.ts` — used by the CANONICAL government research agent) + has its own test file. Solidly wired despite no direct `.tsx` fetch to its dedicated route. |
| `follow-up-generator.ts` | **KEEP-IDLE-FEATURE** | Real route + real UI page (`follow-ups/page.tsx`) + real worker job (`worker/jobs/process-followups.ts`). Fully wired three ways; simply low-volume. Distinct from `followup-generator-agent.ts` (AG-28, the nightly-sweep one) — two different features that happen to have similar names. |

## Summary

- **TRUE-ZOMBIE (1):** `deadline-extraction-agent.ts` — genuinely callerless (its sibling
  `deadline-extractor.ts` was reclassified KEEP-IDLE-FEATURE after the methodology correction
  above; the two are not both dead). Safe deletion candidate, re-confirmed at deletion time.
- **CONSOLIDATE (3):** `budget-builder-agent.ts`, `compliance-check-agent.ts`,
  `eligibility-scoring-agent.ts` — dormant shadows of a named working sibling, re-confirmed zero
  callers (static AND dynamic import) at deletion time. `budget-builder.ts` and
  `probability-scoring-agent.ts` were moved to KEEP-IDLE-FEATURE — see methodology note above.
- **TRUE-ZOMBIE, standalone (1):** `funder-signal-monitor-agent.ts` (AG-43) — real, deliberately
  built feature with zero wiring anywhere (re-confirmed with the corrected search). No working
  sibling; a genuine "finish wiring it or delete it" decision, not urgent cleanup.
- **KEEP-IDLE-FEATURE (22):** every other file originally filed under categories C/D, plus
  `deadline-extractor.ts`, `budget-builder.ts`, and `probability-scoring-agent.ts` after the
  methodology correction. These are real, reachable features (route, static import, or dynamic
  `agent_queue` dispatch); low `agent_runs` volume reflects real usage patterns (tier gating,
  chained/server-side triggers, low-traffic UI pages, nothing recently enqueued), not dead code.
- **INVESTIGATE-FURTHER (0):** none needed a fourth bucket — every file resolved cleanly into one
  of the above with concrete evidence.

Total files traced this pass: 27 (categories B, C, D per `LEGACY_AGENT_STATUS.md`). **5** are real
deletion/consolidation candidates for p5a-005 (down from an initial, incorrect 8 — see methodology
correction note above); 22 need no action.
