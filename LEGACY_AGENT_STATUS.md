# LEGACY AGENT STATUS — 30-DAY EXECUTION EVIDENCE (2026-09-15)

Phase 0 audit deliverable 4 of 5.

## Premise correction

The task brief's query (`SELECT agent_id, status, COUNT(*), MAX(created_at) FROM agent_runs...`)
does not run — **`agent_runs` has no `agent_id` column.** The real identifying column is
`agent_type` (text). Corrected query used throughout this report:

```sql
SELECT agent_type, status, count(*), max(created_at)
FROM agent_runs WHERE created_at > now() - interval '30 days'
GROUP BY agent_type, status ORDER BY agent_type, status;
```

This returned 33 distinct `agent_type` values with any activity in the trailing 30 days (out of
71 distinct values ever used, out of an 85-value DB enum). The remainder of this report classifies
every legacy agent — not just the ones with 30-day rows — since "zero rows" is itself a finding.

## Real tally: not 13/18/4 — the task's assumed split undercounts the problem

The task brief assumed "13 working / 18 unused / 4 blocked" (35 total). Real counts, cross-checked
against the full file inventory in `AGENT_INVENTORY_COMPLETE.md`:

- **~29 working `agent_type` DB buckets** (real, recent, mostly-successful completions) — higher
  than 13, but several of these buckets are shared by 2-4 different implementation files (see
  collision list), so "29 healthy buckets" is not the same as "29 healthy files."
- **4 blocked** — this one roughly matches: `success_probability` (78% failure rate, WGR-170,
  unfixed), `review` (stuck + failing), `recursive_learning` (stuck), and `ag-29-knowledge-indexer`
  (technically "completed" every time but 100% silently failing its real work — see below).
- **~43 agent files with zero executions in 30 days** — far more than 18. The gap is explained by
  two things the original "18" estimate predates: the fully-dead **EA-01..EA-10** 10-agent
  enrichment pipeline (discovered this session), and the **collision-shadow duplicate files**
  (e.g. `ag-07-compliance-check.ts` sitting unused next to the working `compliance-checker.ts`)
  that a file-count audit surfaces but a DB-bucket-count audit hides.

## Working — DB buckets with real, recent activity (29)

`corporate_research`, `foundation_research`, `government_research`, `government_research_nofa_parser`,
`local_sponsorship`, `eligibility_scoring`, `grant_summary`, `narrative_drafting`, `compliance_check`,
`funder_intel`, `funder_relationship`, `grants_gov_research`, `sam_gov_research`, `state_portal`,
`custom_api_research`, `deadline_prediction`, `ag-17-discovery`, `ag-19-relationship`,
`ag-30-donor-intent`, `ag-digest`, `autonomous_orchestrator` (28 completed, but see caveat below),
`ag-32-relationship-graph`, `ag-10-grant-dna`, `ag-26-forecast`, `ag-42-change-monitor`,
`ag22_propensity_scoring`, `ag-36-learning-network`, `browser_automation`, `semantic_matching`.

**Caveat on `autonomous_orchestrator`:** 28 completed in 30 days, but also **7 rows stuck in
`status='pending'`** since 2026-08-21 — a growing backlog that isn't failing outright but also
isn't completing. Worth a look before calling this bucket fully healthy.

## Blocked — 4, confirmed broken

| agent_type | Evidence | Known cause |
|---|---|---|
| `success_probability` | 29 completed, **100 failed (78% failure rate)**, last failure 2026-09-11 | WGR-170 — an `onConflict`/upsert bug, on record and unfixed across multiple prior audits |
| `review` | 1 stuck `running` since 2026-08-23 (3+ weeks), 2 timeout-failed | No timeout/watchdog on stuck runs |
| `recursive_learning` | 1 stuck `running` since 2026-09-11 | Same — no stuck-run watchdog |
| `ag-29-knowledge-indexer` | 5,401 runs in the last 4 days alone, **100% report `status='completed'` while doing 0/2 real embeds every time** | Likely `OPENAI_API_KEY` missing/invalid in the Railway production worker (present locally, unverified in prod); real error is swallowed before it reaches `error_message` — see `AGENT_INVENTORY_COMPLETE.md` §4 for full analysis |

## Zero-execution agents (~43 files) — NOT a uniform "delete these" list

Breaking this into sub-categories, because bulk-deleting all of these would be a mistake — several
are legitimate features that are simply idle, not broken, and at least one category is actively
scheduled but silently not firing (a bug worth fixing, not code worth deleting):

**A. Scheduled but never fires — investigate, do not delete (3):** `self-improvement-agent.ts`
(AG-38, `worker/scheduler.ts` runs it daily at 04:00, yet zero 30-day executions — this is the
single most suspicious entry in this whole list and deserves the first look), `board-packet-agent.ts`
(AG-27, scheduled daily + queued via `agent_queue`, zero executions), `followup-generator-agent.ts`
(AG-28, part of the nightly sweep, zero executions).

**B. Collision-shadow duplicates of a working bucket — consolidation candidates, not blind
deletes (8 files):** `ag-07-compliance-check.ts` (dup of working `compliance-checker.ts`),
`deadline-extractor.ts`/`deadline-extraction-agent.ts` (dup pair), `budget-builder.ts` +
`budget-agent.ts` + `budget-builder-agent.ts` (3-way dup), `probability-scoring-agent.ts` (dead
shadow of `success-probability.ts`, which is itself blocked — fixing the WGR-170 bug should happen
on the live file, not this one), `eligibility-scoring-agent.ts` (bare `"ag-02"` label, likely
superseded by working `eligibility-scorer.ts`'s `eligibility_scoring` bucket).

**C. Real API route exists, nothing recently called it — needs a UI/usage check before any
action, likely just idle features (8 files):** `form-analyzer.ts`, `form-filler.ts`,
`application-cloner.ts`, `automation-worker.ts`, `competitor-intel.ts`, `giving-history.ts`,
`email-campaign.ts` (route itself is one of the 6 never-auto-triggered outbound crons — see
`SCHEDULING_AUDIT.md` §3), `propublica.ts`.

**D. Confirmed zero callers anywhere in the codebase — genuine zombie candidates, still requires
a trace-usage pass before deletion per the standing constraint (11 files):** `usaspending.ts`,
`cold-outreach.ts`, `simulation-agent.ts` (AG-37), `roi-optimizer-agent.ts` (AG-39),
`strategic-advisor-agent.ts` (AG-40), `impact-simulation-agent.ts` (AG-41),
`funder-signal-monitor-agent.ts` (AG-43), `community-need-predictor-agent.ts` (AG-35),
`fundability-scorer-agent.ts` (AG-29 label collision, functionally separate from the working
knowledge-indexer), `simpler-grants.ts`, `hud-monitor.ts`, `follow-up-generator.ts`.

**E. `ea-01-giving-detector.ts` through `ea-10-social-media-analyzer.ts` — one dead 10-agent
pipeline, not 10 independent decisions (10 files):** Fully built, zero callers anywhere, and
directly relevant to a *working* agent's health — `ag-22-propensity-scoring.ts` depends on this
pipeline's enrichment output and is functionally starved without it (see
`AGENT_INVENTORY_COMPLETE.md` §1). Treat as a single go/no-go decision (wire it up, since AG-22
needs it, or formally decouple AG-22 from the dependency) rather than 10 separate deletions.

**F. Not measurable via `agent_runs` by design (2 files, not "unused," just wrong evidence
source):** `morning-digest.ts` and `disaster-response-agent.ts` are plain async functions that
never write to `agent_runs` — confirmed by their own code comments. Their real health has to be
checked against `alerts`/`disaster_declarations` row counts instead. `disaster-response-agent.ts`'s
comment also reveals it had a live bug (FEMA's endpoint is case-sensitive; the lowercase variant
404'd on every call) that was fixed recently — can't confirm current health from this table.
