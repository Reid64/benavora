# FORGE Queue Backlog — Launch Guide

Generated 2026-08-27 from `INVENTORY_AUDIT_2026-08-26.md`'s backlog (items 0-14). 7 queue files, all validated with `js-yaml` (the same parser `forge.ps1` uses) and confirmed to follow `FORGE_CANONICAL_INSTRUCTIONS.md`'s exact format (single-line double-quoted prompts, `gates:` on every prompt, no `|` block scalars). Ready to copy to `queue.yaml` and launch.

Two corrections happened during generation that are worth knowing before you launch anything: the audit doc's original RLS finding for the sales/suppression tables was upgraded (a fix already existed in the non-canonical migrations track, unconfirmed live — not simply missing), and a BMF ingest bug was reassigned from the wrong script filename to the right one (`ingest-irs-bmf-full.ts`, not `ingest-nonprofit-bmf.ts`, which is actually correct). Both are reflected in `INVENTORY_AUDIT_2026-08-26.md` and in the queue prompts below — if you read the audit doc before today, re-read those two sections.

## Summary Table

| Queue file | Covers | Prompts | Est. time | Sequencing | Key risk flags |
|---|---|---|---|---|---|
| `queue-fix-priority-0-4.yaml` | Items 0-4: RLS port, cron registration, follow-up wiring, grants API wiring, BMF fix | 5, linear | 5-10 hrs | **Run first.** No blockers. Hardcodes migration number 165 — see numbering note below. | Item 0 applies a live DDL change to production (RLS + REVOKE) if `DATABASE_URL` is available — confirmed with you, auto-apply is intentional. Item 1's `*/30`/hourly cron schedules assume a Vercel Pro-tier-or-higher plan; the prompt flags this if it can't confirm plan tier. |
| `queue-autosave-email-ux.yaml` | Auto-save (drafts only, scoped decision — see below), suppression-list check in `sequence-engine.ts`, `email_templates` anon-revoke hardening | 6, linear | 8-12 hrs | Independent of Queue 1, but **run after it** — its migration (prompt 6) dynamically picks "next free number," which is only safe if Queue 1's 165 is already committed. | Deliberately did NOT route autosave through `PATCH /api/drafts/[id]` (verified that route is gated to the review-queue workflow, not general editing — using it would 409). Scoped "all user content" to draft-generator pages only, not `NarrativeEditor.tsx` — documented as a deliberate choice. |
| `queue-pil-agents-complete.yaml` | Items 6-9: `BEN-STR-01..04`, `BEN-OPS-01`, `BEN-QLF-01/02/03/05`, `BEN-KNW-04` | 4, linear (one per family) | 8-16 hrs | **Fully independent** — no migration involvement, touches only `src/lib/pil/agents/*`. Safe to run concurrently with any other queue via a separate worktree if you want wall-clock parallelism; the orchestrator itself (`forge.ps1`) has no native parallel-prompt execution, which is why this is one linear queue rather than "4 parallel sub-queues." | `BEN-QLF-04`'s own header comment says its scoring should hand off to `QLF-01/02/05` once they exist — the QLF prompt wires that hand-off, not just the 4 new files standalone. Spec source is `PROSPECT_INTELLIGENCE_AGENTS.md` + migration `155_pil_agent_registry.sql`, not `AGENTS.md` as originally assumed — corrected during generation. |
| `queue-migrations-reconciliation.yaml` | Items 10, 12, 13: reconcile the two migration directories, re-verify anon-exposure live, `email_templates` RLS (again, lighter, additive — safe to run even if Queue 2 already did its version) | 1, single large multi-sub-step prompt | 24-40 hrs (dominated by item 10) | **Run last**, after Queues 1 and 2 have settled the migration-number sequence. Hard-blocked on live DB access (`DATABASE_URL` or equivalent) — the prompt is explicitly instructed to stop after Sub-step A and report rather than guess if it can't get live access. | **Highest-risk file in this entire backlog.** Explicitly forbidden from renaming the 7 duplicate-numbered migration file pairs (could desync Supabase's migration-tracking history) — documents them instead. Never drops a live column/table even if a "losing" directory's file suggests it. |
| `queue-ci-workflow.yaml` | Item 5: Playwright in CI | 1 | 1-2 hrs | Fully independent, any time. | Starts with `chromium` project only + `setup`/`public`/`critical-paths` (not `authed`) to avoid silently provisioning a new secret-tier credential into CI — flags if `authed` needs more. |
| `queue-env-vars-cleanup.yaml` | Item 11: `.env.local.example` completeness | 1 | 1 hr | Fully independent, any time. Purely additive (never deletes an existing documented var). | None — lowest-risk file in the set. |
| `queue-propublica-error-handling.yaml` | Item 14: ProPublica `search.json` 404-vs-zero-results | 1 | 1-2 hrs | Fully independent, any time. | Prompt requires a live API call against the real ProPublica endpoint to confirm the actual response shape before changing code — verify network egress is available in whatever environment runs this. |

## Recommended launch order

1. **`queue-fix-priority-0-4.yaml`** — highest-priority security fix, establishes migration 165 as the baseline for everyone else.
2. **`queue-autosave-email-ux.yaml`** — depends on (1)'s migration number being settled; otherwise independent.
3. **`queue-pil-agents-complete.yaml`**, **`queue-ci-workflow.yaml`**, **`queue-env-vars-cleanup.yaml`**, **`queue-propublica-error-handling.yaml`** — any order, any time, no interdependencies with each other or with (1)/(2). Run in parallel via separate `forge.ps1` invocations against isolated worktrees if you want wall-clock speed.
4. **`queue-migrations-reconciliation.yaml`** — run last. Longest, highest-risk, and benefits from a settled migration sequence from (1) and (2). Requires live DB access to do its real work; will partially degrade gracefully (still completes its anon-exposure and `email_templates` sub-steps) if that's unavailable when it runs.

## Migration-number safety note

Only 3 of the 7 queues touch `supabase/migrations/`: Queue 1 (hardcodes **165**, since 164 was confirmed the current highest at generation time), Queue 2 (dynamically checks the current highest number at execution time), and Queue 4 (same, dynamic). As long as Queue 1 runs — or its migration file is at least committed to disk — before Queues 2 or 4, there's no collision risk. If you ever run Queue 2 or Queue 4 without Queue 1 having run first, they'll still pick a safe next-free number on their own; the only real risk is running Queues 2 and 4 in the same window before either has committed, which could both pick the same "next free" number. Prefer running them sequentially, not simultaneously, if you skip Queue 1 for some reason.

## How to launch

```powershell
Copy-Item "C:\Users\manag\Documents\benavora\queue-fix-priority-0-4.yaml" "C:\Users\manag\Documents\FORGE\projects\benavora\queue.yaml" -Force
cd C:\Users\manag\Documents\FORGE; $env:NODE_OPTIONS="--max-old-space-size=8192"; powershell -ExecutionPolicy Bypass -File .\forge.ps1 -project benavora -startFrom 0
```

Repeat with each subsequent queue file in the recommended order above, copying it to `queue.yaml` before each `forge.ps1` invocation.
