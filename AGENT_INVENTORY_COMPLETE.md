# AGENT INVENTORY — COMPLETE (2026-09-15)

Phase 0 audit deliverable 1 of 5. Code- and live-DB-verified. Supersedes any inventory in
`AGENTS.md`, `AGENTS_v2.md`, `COMPLETE_AGENT_INVENTORY.md`, or prior session memory where they
conflict with what's written here — those documents were treated as leads to verify, not facts.

## Corrections to this task's stated premises

The Phase 0 task brief that requested this document assumed several things that are **not true**
of the current codebase. Recorded here once so the rest of this doc (and the other 4 reports) can
state findings without re-litigating them:

| Task assumed | Reality |
|---|---|
| "AG-43 to AG-93 (PIL)" | PIL agents are **not** AG-numbered. 51 real agents use `BEN-*` codes (`BEN-APP-01..03`, `BEN-DIS-01..08`, `BEN-INT-01..10`, `BEN-KNW-01..04`, `BEN-OPS-01`, `BEN-QLF-01..05`, `BEN-REL-01..08`, `BEN-STR-01..04`, `BEN-SUP-01..08`), confirmed live in `pil_agent_registry`. No `AG-43`..`AG-93` numbering exists anywhere in code or DB. |
| `src/lib/orchestrators/*.ts` | Directory doesn't exist. Legacy scheduling lives in `worker/scheduler.ts` + `worker/autonomous-orchestrator.ts`; PIL's orchestrator is `src/lib/pil/research-orchestrator.ts`. |
| `src/jobs/*.ts`, `src/workers/*.ts` | Neither exists. Real worker code is at repo-root `worker/` (a separate Railway-deployed process), not under `src/`. |
| `src/app/api/crons/*.ts` (plural) | Real path is `src/app/api/cron/` (singular), 12 subdirectories, only 6 wired into `vercel.json`. |
| `agent_runs.agent_id` column | Doesn't exist. The real identifying column is `agent_type` (text). |
| `pil_dossiers`, `pil_recommendations`, `pil_intelligence_gaps` tables | None exist. Real PIL schema has 35 tables (see `PIL_WIRING_AUDIT.md`); the closest real analogue to "dossiers" is `pil_prospect_dossiers` (schema exists, 0 rows). |

None of this is a criticism of the brief — it's exactly the kind of drift this audit exists to
catch (this project's history shows task briefs colliding with real state repeatedly; see prior
session memory on that pattern). Findings below are keyed to verified code and live data.

---

## 1. Legacy system — three coexisting numbering schemes, not one

The legacy system is not a clean AG-01..AG-42 sequence. Three independent, unrelated numbering
schemes exist in `src/lib/agents/` (104 files):

- **AG-NN** — the original scheme, partially spec'd in `AGENTS_v2.md` (AG-01 through AG-30 only;
  everything above 30 is undocumented code/DB additions).
- **EA-NN** — a fully separate 10-agent corporate-enrichment pipeline (`ea-01-giving-detector.ts`
  through `ea-10-social-media-analyzer.ts`), spec'd in `CORPORATE_INTELLIGENCE_ARCHITECTURE.md`.
- **BEN-\*** — the PIL system (covered in `PIL_WIRING_AUDIT.md`), entirely separate from both.

### AG-01 to AG-42 — status table

Real DB `agent_type` string used as the row key (not the ambiguous AG-NN label — see collision
section below for why). "30d activity" = executions in the trailing 30 days as of 2026-09-15.

| agent_type | AG label | File | Wiring | 30d activity | Verdict |
|---|---|---|---|---|---|
| grant_summary | AG-01 | grant-summary.ts | event | 8 completed | **WORKING** |
| eligibility_scoring | AG-02 (shadow) | eligibility-scorer.ts | event/worker queue | 810 completed, 2 failed | **WORKING** |
| "ag-02" (bare label) | AG-02 | eligibility-scoring-agent.ts | event/worker queue | not seen under this string | WIRED-BUT-UNVERIFIED — likely a duplicate of the row above |
| deadline_extraction | AG-03 | deadline-extraction-agent.ts / deadline-extractor.ts (dup) | — | none | **UNUSED-30D** |
| fit_analysis | AG-04 | fit-analysis-agent.ts | — | none | **UNUSED-30D** |
| narrative_drafting | AG-05/06 (doc drift) | draft-generation-agent.ts | manual/UI | 10 completed, 0 in last 7d | WIRED — dormant |
| ag-06-budget-builder | AG-06 | budget-builder-agent.ts | — | none | **UNUSED-30D** (2 more shadow dups: budget-builder.ts, budget-agent.ts, sharing DB bucket `budget_builder`, also unused) |
| compliance_check | AG-07 (shadow) | compliance-checker.ts | manual | 5 completed | **WORKING** |
| ag-07-compliance-check | AG-07 | compliance-check-agent.ts | manual | none | shadow duplicate, unused |
| recursive_learning | AG-07 (alt mapping, per worker files) | recursive-learning.ts | event, on award | 1 run, stuck `running` since 09-11 | **BLOCKED** |
| government_research (collides — 4 files write this) | AG-14 (canonical, per its own header) | research/government-grants.ts | cron/research, agent-configs.ts | 11 completed, 1 failed | **WORKING**, attribution-ambiguous |
| — same bucket | AG-08 (worker/scheduler.ts's def) | renewal-tracker-agent.ts | worker | none | **UNUSED-30D** |
| — same bucket, different file | AG-08 (worker/autonomous-orchestrator.ts's def — collides) | housing-specific-scrapers.ts | /api/agents/housing-specific | shares government_research count | attribution-ambiguous |
| — | AG-08 collider #3 | nofa-parser.ts | /api/agents/nofa-parser, cron/research | shares count | attribution-ambiguous |
| — | (no label) | usaspending.ts | none found | shares count | **ORPHANED-NO-WIRING** |
| — | AG-09 (scheduler.ts's def) | outcome-analyzer-agent.ts | worker | none | **UNUSED-30D** |
| email_parser | AG-09 (autonomous-orchestrator.ts's def — collides) | email-parser.ts | manual | none | **UNUSED-30D** |
| ag-10-grant-dna | AG-10 (scheduler.ts's def) | grant-dna-agent.ts | scheduler.ts weekly | 8 completed | **WORKING** |
| ag-10-document-expiry | AG-10 (autonomous-orchestrator.ts's def — collides) | document-expiry-agent.ts | autonomous-orchestrator.ts | none | **UNUSED-30D** |
| ag-11-knowledge-gap | AG-11 (scheduler.ts's def) | knowledge-gap-agent.ts | worker | none | **UNUSED-30D** |
| — | AG-11 (autonomous-orchestrator.ts's def — collides) | cold-outreach.ts | /api/agents/outreach (likely dead post-campaigns-retirement) | none | **ORPHANED-NO-WIRING** |
| corporate_research (collides — 2 files) | AG-12 | research/corporate-giving.ts | cron/research, agent-configs.ts | 6 completed | **WORKING**, attribution-ambiguous |
| — same bucket | AG-12 (autonomous-orchestrator.ts's def — collides) | corporate-scraper.ts | /api/agents/corporate-research, /api/agents/research | shares count | attribution-ambiguous |
| ag-12-search-optimizer | AG-12 (scheduler.ts's def, third collider) | search-profile-optimizer-agent.ts | worker | none | **UNUSED-30D** |
| foundation_research (collides — 2 files) | AG-13 | research/foundation-grants.ts | cron/research, agent-configs.ts | 10 completed | **WORKING**, attribution-ambiguous |
| — same bucket | — | foundation-finder.ts | /api/agents/foundation-finder | shares count | attribution-ambiguous |
| ag-15-probability (shadow) | AG-15 | probability-scoring-agent.ts | worker scheduler | none under this exact string | dead/superseded |
| success_probability | AG-15 canonical | success-probability.ts | worker scheduler | 29 completed, **100 failed (78%)** | **BLOCKED — WGR-170** |
| ag-17-discovery | AG-17 | opportunity-discovery-agent.ts | worker daily | 28 completed | **WORKING** |
| (none — plain function, never logs to agent_runs) | AG-17 (doc label) | morning-digest.ts | called directly by orchestrator | not measurable via agent_runs | **WORKING-BY-DESIGN** — wrong evidence source, see §4 |
| ag-19-relationship | AG-19 | relationship-builder-agent.ts | worker daily | 2 completed | WIRED, thin volume |
| ag22_propensity_scoring | AG-22 | ag-22-propensity-scoring.ts | manual/cron | 7 completed, 2 failed | **WORKING but structurally starved** — see §3, depends on dead EA-01..10 pipeline |
| local_sponsorship | — | research/local-sponsorship.ts | cron/research | 2 completed | WORKING, thin |
| (none — plain functions, never log to agent_runs) | AG-25 (disaster-response doc label) | disaster-response-agent.ts | scheduler.ts 5:45 daily | not measurable via agent_runs | Recently un-broken (FEMA endpoint was case-sensitive, 404'd every call until a recent fix per file's own comment) — can't verify current health via agent_runs, check `disaster_declarations`/`alerts` instead |
| ag-25-deadline-prediction (collides with AG-25 disaster label above) | AG-25 | deadline-prediction-agent.ts | worker | 29 completed (under `deadline_prediction`) | **WORKING** |
| ag-26-forecast | AG-26 | funding-forecast-agent.ts | scheduler.ts monthly | 2 completed | WORKING, thin/monthly |
| ag-27-board-packet | AG-27 | board-packet-agent.ts | scheduler.ts daily, agent_queue | none | **UNUSED-30D** |
| ag-28-followup | AG-28 | followup-generator-agent.ts | scheduler.ts (nightly sweep) | none | **UNUSED-30D** |
| ag-29-knowledge-indexer | AG-29 | knowledge-indexer-agent.ts | continuous ~60s poll | 40,528 completed | **SILENT FAIL — see §4** |
| ag-29-fundability (collides) | AG-29 | fundability-scorer-agent.ts | none found | none | **ORPHANED-NO-WIRING** |
| ag-30-donor-intent | AG-30 | donor-intent-monitor-agent.ts | autonomous-orchestrator.ts nightly | 28 completed | **WORKING** |
| ag-32-relationship-graph | AG-23 (seed doc) / AG-32 (impl label — drift) | relationship-graph-builder-agent.ts | scheduler.ts daily | 26 completed | **WORKING** |
| ag-36-learning-network | AG-36 | learning-network-aggregator-agent.ts | scheduler.ts **and** autonomous-orchestrator.ts | 4 completed | WORKING, **double-scheduled** |
| ag-37-simulation | AG-37 | simulation-agent.ts | none found | none | **ORPHANED-NO-WIRING** |
| ag-38-self-improvement | AG-38 | self-improvement-agent.ts | scheduler.ts daily 4:00 | **none, despite being scheduled** | scheduled but never fires — investigate |
| ag-39-roi-optimizer | AG-39 | roi-optimizer-agent.ts | none found | none | **ORPHANED-NO-WIRING** |
| ag-40-strategic-advisor | AG-40 | strategic-advisor-agent.ts | none found | none | **ORPHANED-NO-WIRING** |
| ag-41-impact-simulation | AG-41 (impl) / AG-28 "Impact Simulation" (seed doc — collides with the real AG-28 followup agent above) | impact-simulation-agent.ts | none found | none | **ORPHANED-NO-WIRING** |
| ag-42-change-monitor | AG-42 | change-monitor-agent.ts | scheduler.ts daily | 30 completed | **WORKING** |
| ag-43-funder-signals | AG-43 (undocumented) | funder-signal-monitor-agent.ts | none found | none | **ORPHANED-NO-WIRING** |
| ag-35-community-need | AG-35 (undocumented) | community-need-predictor-agent.ts | none found | none | **ORPHANED-NO-WIRING** |
| review | — | review-agent.ts | manual | 1 stuck `running` 3+ weeks, 2 timeout-failed | **BLOCKED** |
| funder_intel | — | funder-intel.ts | manual/cron | 1 completed | WORKING, thin |
| funder_relationship | — | funder-relationship.ts | manual | 3 completed | WORKING, thin |
| grants_gov_research | — | grants-gov.ts | scheduler.ts (research) | 16 completed | **WORKING** |
| sam_gov_research | — | sam-gov.ts | scheduler.ts | 4 completed | **WORKING** |
| propublica_mining | — | propublica.ts | scheduler.ts | none | **UNUSED-30D** |
| state_portal (3-way collide) | — | state-portal.ts, state-scrapers.ts, tdhca-scraper.ts | scheduler.ts | 5 completed | WORKING, attribution-ambiguous |
| custom_api_research (collides) | — | custom-scrape.ts, custom-api.ts | scheduler.ts | 5 completed | WORKING, attribution-ambiguous |
| simpler_grants_research | — | simpler-grants.ts | none found | none | **ORPHANED-NO-WIRING** |
| browser_automation (collides) | — | browser-automation.ts, playwright-agent.ts | /api/agents/playwright | 3 completed | WORKING, attribution-ambiguous |
| semantic_matching | — | semantic-matching.ts | /api/agents/semantic-matching | 4 completed | WORKING, thin |
| hud_monitor | — | hud-monitor.ts | none found | none | **ORPHANED-NO-WIRING** |
| email_campaign | — | email-campaign.ts | src/app/api/cron/sales-sends (orphaned route, see SCHEDULING_AUDIT.md) | none | **UNUSED-30D** |
| follow_up_generator | — | follow-up-generator.ts | none found | none | **ORPHANED-NO-WIRING** |
| form_analyzer / form_filler | — | form-analyzer.ts / form-filler.ts | /api/agents/form-analyzer, /api/agents/form-filler | none | **UNUSED-30D** |
| application_cloning | — | application-cloner.ts | /api/agents/application-cloner | none | **UNUSED-30D** |
| automation_worker | — | automation-worker.ts | /api/agents/automation | none | **UNUSED-30D** |
| competitor_intelligence | — | competitor-intel.ts | /api/agents/competitor-intel | none | **UNUSED-30D** |
| giving_history_extractor | — | giving-history.ts | /api/agents/giving-history | none | **UNUSED-30D** |
| ag-digest | — | autonomous-digest-agent.ts | worker daily, successor to morning-digest.ts | 60 completed | **WORKING** |
| autonomous_orchestrator | — | (worker infra, not a single file) | scheduler.ts nightly | 28 completed, 7 stuck `pending` | WORKING, backlog building |

Infra/shared modules, not independent agents (excluded above): `base-agent.ts`, `autonomous-base.ts`,
`org-defaults.ts`, `final-assembly.ts`, `consensus-validator.ts`, `corporate-enrichment-shared.ts`,
`knowledge-base-completeness.ts`, `scheduler.ts` (the `src/lib/agents/` one, distinct from
`worker/scheduler.ts` — defines research agentType configs only), `education-training-grants.ts`,
`environmental-climate-grants.ts`, `health-grants.ts`, `minority-farmer-grants.ts` (thin filters on
the research agents via a `focus:` param, not independently scheduled or measurable).

### EA-01 to EA-10 — a fully separate, fully dead pipeline

`CORPORATE_INTELLIGENCE_ARCHITECTURE.md` §2B/§6 spec's a sequential 10-agent corporate-enrichment
pipeline: `ea01_giving_detector` … `ea10_social_media_analyzer`. All 10 files are real,
non-trivial implementations. **None appear anywhere in 30 days of `agent_runs` data, and no caller
of any EA-0X class exists in `src/app/api/` or `worker/`.** This is a bigger finding than it looks:
`ag-22-propensity-scoring.ts`'s own header states it only runs meaningfully once EA-01..EA-10 have
enriched a prospect — AG-22's "working but scores a tiny static table" status (confirmed in the
prior session's audit) is not really AG-22's fault. It's fed by a pipeline that has never run once.

## 2. PIL system — see `PIL_WIRING_AUDIT.md` for full detail

Summary for cross-reference: 51 `BEN-*` agents registered, `active=true` for all, but effectively
zero real production executions (38 rows in `pil_agent_runs`, all from one 2026-09-09 test burst).

## 3. ID collision audit — full list

**AG-NN slot collisions** (same numeric label, different code, confirmed by reading the literal
`agent_id`/DB string each file writes — not inferred from filenames):

| Slot | Collides between |
|---|---|
| AG-08 | renewal-tracker-agent.ts vs housing-specific-scrapers.ts vs nofa-parser.ts (3-way) |
| AG-09 | outcome-analyzer-agent.ts vs email-parser.ts |
| AG-10 | grant-dna-agent.ts vs document-expiry-agent.ts |
| AG-11 | knowledge-gap-agent.ts vs cold-outreach.ts |
| AG-12 | search-profile-optimizer-agent.ts vs corporate-scraper.ts/research/corporate-giving.ts |
| AG-25 | disaster-response-agent.ts vs deadline-prediction-agent.ts |
| AG-28 | followup-generator-agent.ts (real, scheduled) vs impact-simulation-agent.ts (seed-doc mislabel) |
| AG-29 | knowledge-indexer-agent.ts vs fundability-scorer-agent.ts |

**DB-level `agent_type` string collisions** — more serious than label drift, since multiple
distinct classes write the *same* value into `agent_runs.agent_type`, making it impossible to
attribute a given run to a specific implementation from the DB alone:

`government_research` (4 writers), `corporate_research` (2), `foundation_research` (2),
`state_portal` (3), `browser_automation` (2), `custom_api_research` (2), `budget_builder` (2, plus
a third functional duplicate under a different label), `compliance_check`/`ag-07-compliance-check`
(shadow pair), `eligibility_scoring`/"ag-02" (shadow pair).

**Numbering-scheme collision precedent inside PIL itself:** `src/lib/pil/agents/qua/BEN-QUA-01.ts`
exists because a task prompt was issued **three separate times** (commits `c54555e`, `9a266c3`,
`04f3a97`) asking for a nonexistent "BEN-QUA-01" agent describing a mission identical to the real,
registered `BEN-QLF-04`. A prior session resolved it as a re-export shim rather than a phantom
registry row. This exact failure mode — a task handed down with a wrong agent code — has already
happened at least 3 times on this codebase before this Phase 0 brief's own AG-43-93 mistake made it
a 4th.

## 4. AG-29 (Knowledge Indexer) — false-completion pattern, full analysis

Independently re-verified via direct read-only `psql` against the live DB (not sub-agent-reported):

```
SELECT status, count(*), avg(items_found), avg(items_processed) FROM agent_runs
WHERE agent_type='ag-29-knowledge-indexer' AND started_at > now() - interval '4 days'
GROUP BY status;

 status    | count | avg_items_found | avg_items_processed
 completed | 5401  | 2.0000000000000 | 0.0000000000000
```

**Every one of 5,401 runs in the last 4 days reports `status='completed'` while embedding 0 of 2
rows found, every time.** `output_summary` reads literally: *"Embedded 0/2 row(s) (2 failed);
pattern aggregation not due."* This is the platform's single highest-volume agent — 40,528 of
61,122 all-time `agent_runs` rows (66%) — firing on a continuous ~60-second poll since 2026-08-03.

**Root cause (narrowed, not fully confirmed):** `src/lib/intelligence/embeddings.ts` throws
`Missing required env var: OPENAI_API_KEY` when that key is absent.
`knowledge-indexer-agent.ts` retries the embedding call 3× then gives up, storing the real error
text in a local variable that gets folded into `output_summary` but is **never written to
`agent_runs.error_message`** (stays `null`). `OPENAI_API_KEY` is present in local `.env.local`;
whether it's present/valid in the Railway production worker environment could not be checked from
this sandbox — flagged as the top follow-up item, same class of gap as the already-known missing
`RESEND_API_KEY` in Vercel Production.

**Why it's invisible:** confirmed in `CROSS_WIRING_REPORT.md` — no UI screen, alert, or monitoring
integration would ever catch a "completed but did nothing" run. This is not a status-check gap
that's merely inconvenient; it's a structural blind spot across the entire platform.
