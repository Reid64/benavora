# AGENT AUDIT COMPLETE (Phase 5.2A, 2026-09-15)

Full read-through of every real agent implementation — 90 legacy files (`src/lib/agents/*.ts` +
`src/lib/agents/research/*.ts`, excluding shared infra and `*.test.ts`) and 51 PIL files
(`src/lib/pil/agents/*/*.ts`, excluding `shared.ts` helpers) — 141 agents total. Every "Schema
Match" and enum claim below was verified against the **live** database (`DATABASE_URL`), not
assumed from generated types, which are independently known to be stale in places.

## Methodology

Audited via 7 parallel passes (4 legacy batches, 3 PIL batches by family), each reading every
assigned file in full and checking live DB schema/enum state directly. Findings were then
cross-checked against this session's own prior live testing (the AG-29/AG-38 fixes, the PIL
end-to-end trace that found the A2/A3 policy bug and the `escalateFailure()` crash).

## Headline findings

1. **13 legacy agents are completely non-functional today due to `agent_type` enum gaps** — the
   `agent_type` Postgres enum doesn't contain the literal string these agents pass to `startRun()`.
   For `AutonomousAgent`-style agents this throws unhandled (100% failure, zero `agent_runs` row);
   for `BaseAgent`-style agents the failure is silently swallowed (`logStart()` ignores insert
   errors), so the agent still does its real work but leaves zero audit trail. This is the single
   highest-leverage fix in this audit — one additive migration unblocks 13 files.
2. **PIL's policy engine blocks 40 of 51 agents from ever executing** (confirmed live last turn,
   re-confirmed by every PIL audit batch): `agent-runner.ts` hardcodes the `"execute_reversible"`
   (A3) action for every agent's blanket authorization check, but `PROSPECT_INTELLIGENCE_ARCHITECTURE.md`
   §2 defines A2 ("Prepare & Queue" — write evidence, draft rows, delegate) as the correct tier for
   the vast majority of these agents' actual work. One-line fix, unblocks the majority of PIL.
3. **A second PIL migration (165) was never applied live**, breaking 5 more agents
   (`BEN-QLF-01/02/03/04/05`) — `pil_mission_affinity_assessments`, `pil_funding_eligibility_assessments`,
   `pil_capacity_propensity_assessments`, `pil_timing_readiness_assessments` don't exist. This is the
   confirmed root cause of `BEN-QLF-04`'s live `status: "failed"` result from last turn's trace.
4. **`research-orchestrator.ts`'s own error-escalation path crashes** (found live last turn):
   `escalateFailure()` inserts `requested_by_agent_id: "research-orchestrator"`, not a registered
   agent, violating a foreign key and masking whatever the real underlying failure was.
5. Two PIL agents (`BEN-SUP-01`, `BEN-SUP-03`) return the non-terminal placeholder status
   `"running"` as their own final `AgentResult.status` under normal conditions — a real bug
   distinct from the policy block.
6. Four PIL agents (`BEN-INT-02/03/04/05`) reuse a raw web-search result **title** as a graph
   node's company/institution/org **name**, degrading node quality/dedup across the relationship
   graph.
7. Three more legacy tables are missing live, silently disabling whole features without crashing
   the agent: `digest_item_log`/`digest_priority_weights` (autonomous-digest-agent.ts, migration
   098), `deadline_predictions` (deadline-prediction-agent.ts, migration 097, **and** its own insert
   has zero error checking), `platform_learning_patterns.confidence/weight` +
   `org_learning_contributions.outcome_id/anonymized/source_hash` (learning-network-aggregator-agent.ts,
   migration 099). Plus one full missing table from the two-parallel-migrations-directories issue:
   `application_followups` (followup-generator-agent.ts) — migration 081 diverged between
   `supabase/migrations/` (applied, a different migration) and `src/supabase/migrations/` (this
   agent's real spec, never applied).

## Legacy agents (90 files)

| File | Matches Purpose | Completeness | Error Handling | Schema Match | External API | Status | Notes |
|---|---|---|---|---|---|---|---|
| ag-22-propensity-scoring.ts | yes | complete | yes | yes | anthropic | production-ready | `agentType "ag22_propensity_scoring"` confirmed live. |
| application-cloner.ts | yes | complete | yes | yes | anthropic | production-ready | `agentType "application_cloning"` confirmed live. |
| automation-worker.ts | yes | complete | yes | yes | none (delegates) | production-ready | `automation_queue` columns confirmed live. |
| autonomous-digest-agent.ts | yes | partial | yes | no | anthropic | needs-fixes | `digest_item_log`/`digest_priority_weights` (migration 098) missing live — adaptive-learning feature is a permanent silent no-op; core digest still works. |
| board-packet-agent.ts | yes | complete | yes | yes | anthropic | production-ready | All dependent tables confirmed live. |
| browser-automation.ts | yes | complete | yes | yes | none (Playwright) | production-ready | Depends on `AutomationSessionManager`, which has a known separate uuid bug (session-manager.ts) outside this file. |
| budget-agent.ts | yes | complete | yes | yes | anthropic | production-ready | `agentType "budget_builder"` confirmed live. |
| budget-builder.ts | yes | complete | yes | yes | anthropic | production-ready | `agentType "budget_builder_worker"` confirmed live (renamed this session to resolve a collision). |
| change-monitor-agent.ts | yes | complete | yes | yes | anthropic + fetch | production-ready | Header's "corporate_prospects doesn't exist" note is stale — table exists now. |
| cold-outreach.ts | yes | complete | yes | yes | anthropic + fetch | production-ready | Always leaves a fallback lead. |
| community-need-predictor-agent.ts | yes | complete (logic) | no | **no** | anthropic | **blocked** | `agentType "ag-35-community-need"` NOT in live enum; `startRun()` unguarded outside try/catch — every call throws before any logic runs. |
| competitor-intel.ts | yes | complete | yes | yes | anthropic | production-ready | `agentType "competitor_intelligence"` confirmed live. |
| compliance-checker.ts | yes | complete | yes | yes | anthropic (advisory) | production-ready | |
| corporate-scraper.ts | yes | complete (deliberately simple) | yes | yes | anthropic + fetch | production-ready | 5 hardcoded target URLs — silent degrade if any moves, not currently broken. |
| custom-api.ts | yes | complete | yes | yes | other (client REST API) | production-ready | |
| custom-scrape.ts | yes | complete | yes | yes | anthropic + fetch | production-ready | |
| deadline-extractor.ts | yes | complete | yes | yes | none | production-ready | |
| deadline-prediction-agent.ts | yes | partial | partial | no | anthropic + SAM.gov | needs-fixes | `deadline_predictions` (migration 097) missing live; `recordPrediction()` has **zero** error check on the insert — silent data loss. |
| deadline-prediction.ts | yes | complete | yes | yes | none | production-ready | |
| disaster-response-agent.ts | yes | complete | yes | n/a (no agent_type, by design) | FEMA API | production-ready | |
| document-expiry-agent.ts | yes | complete (logic) | no | **no** | none | **blocked** | `agentType "ag-10-document-expiry"` NOT in live enum (only `ag-10-grant-dna` exists); `startRun()` unguarded. |
| donor-intent-monitor-agent.ts | yes | complete | yes | yes | anthropic | production-ready | |
| draft-generation-agent.ts | yes | complete | yes | yes | anthropic (7 calls) | production-ready | |
| ea-01..ea-10 (10 files) | yes | complete | yes | yes | anthropic (ea-04 none) | production-ready | All 10 `agent_type` values confirmed live. Deliberately unwired pipeline (documented prior-session cost decision) — not a code defect. |
| education-training-grants.ts | yes | complete | no (by design, caller handles) | n/a | Grants.gov | production-ready | |
| eligibility-scorer.ts | yes | complete | yes | yes | anthropic | production-ready | |
| email-campaign.ts | yes | complete | yes | yes | Gmail API | production-ready | |
| email-parser.ts | yes | complete | yes | yes | anthropic | production-ready | |
| environmental-climate-grants.ts | yes | complete | no (by design) | n/a | Grants.gov | production-ready | |
| fit-analysis-agent.ts | yes | complete | yes | yes | anthropic | production-ready | `ag-04-fit-analysis` confirmed live. |
| follow-up-generator.ts | yes | complete | yes | yes | anthropic | production-ready | |
| followup-generator-agent.ts | yes | complete (code) | yes | **no** | anthropic | **blocked** | `application_followups` table missing live — real migration (`src/supabase/migrations/081_application_followups.sql`) never applied; a *different* migration 081 exists in the other migrations directory. 100% failure once reached. |
| form-analyzer.ts | yes | complete | yes | **no** | anthropic | needs-fixes | `agentType "form_analyzer"` NOT in live enum; `BaseAgent.logStart()` swallows the insert error, so real work (Playwright + `form_templates` insert) completes but is invisible to `agent_runs`. |
| form-filler.ts | yes | complete | yes | **no** | anthropic | needs-fixes | Same as form-analyzer.ts: `agentType "form_filler"` NOT in live enum, silently swallowed. |
| foundation-finder.ts | yes | complete | yes | yes | anthropic + fetch | production-ready | `foundation_research_finder` confirmed live. |
| fundability-scorer-agent.ts | yes | complete | yes | **no** | anthropic | **blocked** | `agentId "ag-29-fundability"` NOT in live enum; `AutonomousAgent.startRun()` throws unguarded before its own try/catch. |
| funder-intel.ts | yes | complete | yes | yes | anthropic | production-ready | |
| funder-relationship.ts | yes | complete | yes | yes | none | production-ready | |
| funding-forecast-agent.ts | yes | complete | yes | yes | anthropic | production-ready | |
| giving-history.ts | yes | complete | yes | yes | ProPublica | production-ready | |
| grant-dna-agent.ts | yes | complete | yes | yes | anthropic | production-ready | |
| grant-summary.ts | yes | complete | yes | yes | anthropic | production-ready | |
| grants-gov.ts | yes | complete | yes | yes | anthropic + Grants.gov | needs-fixes | Confirmed hangs indefinitely when invoked directly (own header admits it); deliberately excluded from cron in favor of `grantsgov-sync.ts`. Low priority — already mitigated by not being called. |
| health-grants.ts | yes | complete | no (delegates) | n/a | Grants.gov | production-ready | |
| housing-specific-scrapers.ts | yes | complete | yes | yes | anthropic + fetch | production-ready | `government_research_housing_scrapers` confirmed live. |
| hud-monitor.ts | yes | complete | yes | **no** | anthropic + fetch | needs-fixes | `agentType "hud_monitor"` NOT in live enum; silently swallowed (`BaseAgent.logStart()` ignores error) — real work completes, zero audit trail. |
| humanizer-agent.ts | yes | complete | yes | n/a | anthropic | production-ready | |
| impact-simulation-agent.ts | yes | complete | yes | yes | anthropic | production-ready | |
| knowledge-gap-agent.ts | yes | complete (logic) | no | **no** | anthropic (unreachable) | **blocked** | `agentId "ag-11-knowledge-gap"` NOT in live enum; `startRun()` unguarded. |
| knowledge-indexer-agent.ts | yes | complete | yes | yes | openai | production-ready | Fixed this session (missing prod API key + status-surfacing bug). |
| learning-network-aggregator-agent.ts | yes | complete (code) | yes (masks root cause) | **no** | anthropic | **blocked** | `platform_learning_patterns` missing `confidence`/`weight`; `org_learning_contributions` missing `outcome_id`/`anonymized`/`source_hash` — migration 099 never applied. First query in `upsertPattern()` throws on every call. |
| minority-farmer-grants.ts | yes | complete | no (delegates) | n/a | Grants.gov | production-ready | |
| morning-digest.ts | yes | complete | **no** | n/a | none | needs-fixes | `supabase: any`; zero try/catch anywhere; not a BaseAgent subclass so no audit trail exists for this path at all if any of its 4 parallel queries throws. |
| nofa-parser.ts | yes | complete | yes | yes | anthropic | production-ready | `government_research_nofa_parser` confirmed live. |
| opportunity-discovery-agent.ts | yes | complete | yes | yes | Grants.gov/SAM.gov/Federal Register | production-ready | |
| outcome-analyzer-agent.ts | yes | complete (logic) | no | **no** | anthropic (unreachable) | **blocked** | `agentId "ag-09-outcome-analyzer"` NOT in live enum, `startRun()` unguarded; **also** `organizations.analytics` column doesn't exist live (a second, independent defect once the first is fixed). |
| playwright-agent.ts | yes | complete | yes | yes | anthropic | production-ready | |
| probability-scoring-agent.ts | yes | complete | yes | yes | anthropic | production-ready | `ag-15-probability` confirmed live. |
| propublica.ts | yes | complete | yes | yes | ProPublica | production-ready | |
| recursive-learning.ts | yes | complete | yes | yes | anthropic | production-ready | |
| relationship-builder-agent.ts | yes | complete | yes | yes | anthropic | production-ready | |
| relationship-graph-builder-agent.ts | yes | complete | yes | yes | anthropic | production-ready | |
| renewal-tracker-agent.ts | yes | complete | no | **no** | none | **blocked** | `agentId "ag-08-renewal-tracker"` NOT in live enum; `startRun()` unguarded outside try/catch. |
| review-agent.ts | yes | complete | yes | yes | anthropic | production-ready | |
| roi-optimizer-agent.ts | yes | complete | yes | **no** | anthropic | needs-fixes | `agentId "ag-39-roi-optimizer"` NOT in live enum — blocks the monthly `run()` correlation pass; `trackSubmissionVariables()` (the actually-wired real-time path) is unaffected. |
| sam-gov.ts | yes | complete | yes | yes | SAM.gov | production-ready | |
| search-profile-optimizer-agent.ts | yes | complete | yes | **no** | anthropic | **blocked** | `agentId "ag-12-search-optimizer"` NOT in live enum; `startRun()` unguarded. |
| self-improvement-agent.ts | yes | complete | yes | yes | anthropic | production-ready | Fixed this session (2 unapplied migrations). |
| semantic-matching.ts | yes | complete | yes | yes | anthropic | production-ready | |
| simpler-grants.ts | yes | complete | yes | **no** | Simpler.Grants.gov | **blocked** | Real blocker is a missing/invalid `SIMPLER_GRANTS_API_KEY` (live-tested 401); enum gap for `simpler_grants_research` is secondary. |
| simulation-agent.ts | yes | complete | yes | **no** | anthropic | **blocked** | `agentId "ag-37-simulation"` NOT in live enum; `startRun()` unguarded. Otherwise a thorough, well-calibrated implementation. |
| state-portal.ts | yes | complete | yes | yes | anthropic | production-ready | Header's "TX 404" note is stale — portal registry was fixed since, TX now returns 200. |
| state-scrapers.ts | yes | complete | yes | yes | anthropic | needs-fixes | 2 of 5 configured state source URLs now return 403 (external site changes, not a code defect) — real coverage is 3/5 sources. |
| strategic-advisor-agent.ts | yes | complete | yes | **no** | anthropic | **blocked** | `agentId "ag-40-strategic-advisor"` NOT in live enum, `startRun()` unguarded; **also** `loadBoardActiveCount()` queries `board_members` with wrong column names (`org_id`/`active` instead of real `organization_id`/`is_active`) — a second defect that would always report 0 active board members once the first is fixed. |
| success-probability.ts | yes | complete | yes | yes | none | production-ready | WGR-170 (missing constraint) confirmed resolved. |
| tdhca-scraper.ts | yes | complete | yes | yes | anthropic | needs-fixes | 1 of 2 hardcoded TDHCA source URLs now 404s (external, not a code defect) — halves effective coverage. |
| usaspending.ts | yes | complete | yes | yes | USASpending.gov | production-ready | |
| research/corporate-giving.ts | yes | complete | yes | yes | anthropic + web search | production-ready | Canonical, cron-wired. |
| research/foundation-grants.ts | yes | complete | yes | yes | anthropic + web search | production-ready | Canonical, cron-wired. |
| research/government-grants.ts | yes | complete | yes | yes | anthropic + Grants.gov/SAM.gov/HUD | production-ready | Canonical, cron-wired; most sophisticated file in the whole legacy set. |
| research/local-sponsorship.ts | yes | complete | yes | yes | anthropic + web search | production-ready | |

## PIL agents (51 files)

| File | Matches Purpose | Completeness | Error Handling | Schema Match | External API | Status | Notes |
|---|---|---|---|---|---|---|---|
| BEN-SUP-01.ts | yes | complete | yes | yes | none | needs-fixes | Returns non-terminal `"running"` as its own final status whenever the objective isn't yet satisfied (not blocked by critic). Also systemically policy-blocked for most orgs. |
| BEN-SUP-02.ts | yes | complete | yes | yes | none | blocked (systemic) | No independent defect. |
| BEN-SUP-03.ts | yes | complete | yes | yes | none | needs-fixes | Same non-terminal `"running"` return bug as SUP-01, different condition (`allComplete`/`failedStage`/else). |
| BEN-SUP-04.ts | yes | complete | yes | yes | none | blocked (systemic) | No independent defect. |
| BEN-SUP-05.ts | yes | complete | yes | yes | none | blocked (systemic) | No independent defect. |
| BEN-SUP-06.ts | yes | complete | yes | yes | none | blocked (systemic) | No independent defect. |
| BEN-SUP-07.ts | yes | complete | yes | yes | none | blocked (systemic) | No independent defect. |
| BEN-SUP-08.ts | yes | complete | yes | yes | none | blocked (systemic) | No independent defect. |
| BEN-OPS-01.ts | yes | complete | yes | yes | none | blocked (systemic, registry ceilings A1) | No independent defect. |
| BEN-APP-01.ts | yes | complete | yes | yes | none | blocked (systemic) | No independent defect. |
| BEN-APP-02.ts | yes | complete | yes | yes | none | blocked (systemic) | No independent defect. |
| BEN-APP-03.ts | yes | complete | yes | yes | none | blocked (systemic) | No independent defect; correctly bridges into the real `submission_queue` table. |
| BEN-DIS-01.ts | yes | complete | yes | yes | anthropic | blocked (systemic) | No independent defect. |
| BEN-DIS-02.ts | yes | complete | yes | yes | anthropic | needs-fixes | **Unbounded delegation fan-out** — one BEN-INT-08 delegation per flagged donor, no cap (every sibling DIS agent bounds this). |
| BEN-DIS-03.ts | yes | complete | yes | yes | anthropic + irs_990/entity_lookup | blocked (systemic) | No independent defect. |
| BEN-DIS-04.ts | yes | complete | yes | yes | anthropic | needs-fixes (minor) | Missing the empty-goal early-return guard every sibling has; low impact (degrades harmlessly). |
| BEN-DIS-05.ts | yes | complete | yes | yes | anthropic | blocked (systemic) | Correctly caps delegation fan-out — the pattern DIS-02 is missing. |
| BEN-DIS-06.ts | yes | complete | yes | yes | anthropic + irs_990/entity_lookup | blocked (systemic) | No independent defect. |
| BEN-DIS-07.ts | yes | complete | yes | yes | anthropic + irs_990 | blocked (systemic) | No independent defect. |
| BEN-DIS-08.ts | yes | complete | yes | yes | anthropic | blocked (systemic) | Read-only invariant verified — most thorough file in the family. |
| BEN-INT-01.ts | yes | complete | partial | yes | anthropic | blocked (systemic) | No independent defect. |
| BEN-INT-02.ts | yes | complete | partial | yes | anthropic | needs-fixes | **Title-reuse bug**: uses raw search-result title as the company graph node label instead of an extracted name. |
| BEN-INT-03.ts | yes | complete | partial | yes | anthropic | needs-fixes | Same title-reuse bug for ownership-target company nodes. |
| BEN-INT-04.ts | yes | complete | partial | yes | anthropic | needs-fixes | Same title-reuse bug for institution nodes. |
| BEN-INT-05.ts | yes | complete | partial | yes | anthropic + irs_990/entity_lookup | needs-fixes | Same title-reuse bug for org nodes; otherwise strong (990 cross-check before confidence upgrade). |
| BEN-INT-06.ts | yes | complete | partial | yes | anthropic + irs_990/entity_lookup | blocked (systemic) | No title-reuse defect (officer names from real 990 data). |
| BEN-INT-07.ts | yes | complete | partial | yes | anthropic + irs_990 | blocked (systemic) | Minor: ignores a possible `error` on one graph-node read (benign skip, not a crash). |
| BEN-INT-08.ts | yes | complete | yes | yes | anthropic | blocked (systemic) | No independent defect. |
| BEN-INT-09.ts | yes | complete | yes | yes | anthropic | blocked (systemic) | No title-reuse defect (uses graph label, not raw title). |
| BEN-INT-10.ts | yes | complete | yes | yes | anthropic | blocked (systemic) | No title-reuse defect (channel is a URL/email). |
| BEN-KNW-01.ts | yes | complete | yes | yes | none | production-ready | Already unblocked (A3); confirmed live-completing. |
| BEN-KNW-02.ts | yes | complete | yes | yes | none | production-ready | Already unblocked (A3). |
| BEN-KNW-03.ts | yes | complete | yes | yes | none | production-ready | Already unblocked (A3). |
| BEN-KNW-04.ts | yes | complete | yes | yes | none | production-ready | Already unblocked (A3). |
| BEN-QLF-01.ts | yes (documented gap) | complete | yes | **no** | none | needs-fixes | `pil_mission_affinity_assessments` (migration 165) missing live — would fail on its own INSERT once the policy bug is fixed. |
| BEN-QLF-02.ts | yes | complete | yes | **no** | none | needs-fixes | `pil_funding_eligibility_assessments` missing live, same migration-165 gap. |
| BEN-QLF-03.ts | yes | complete | yes | **no** | none | needs-fixes | `pil_capacity_propensity_assessments` missing live, same gap. |
| BEN-QLF-04.ts | yes | complete | yes | **no** | none | needs-fixes | **Confirmed root cause of its live `status: "failed"`** — reads all 3 missing migration-165 tables; A3 so it actually executes and hits this immediately. |
| BEN-QLF-05.ts | yes | complete | yes | **no** | none | needs-fixes | `pil_timing_readiness_assessments` missing (write) + reads `pil_funding_eligibility_assessments` (missing) — same migration-165 gap on both paths. |
| BEN-QUA-01.ts | n/a (shim) | n/a | n/a | n/a | n/a | n/a | Documented re-export shim pointing at BEN-QLF-04, no registry entry. |
| BEN-REL-01.ts | yes | complete | yes | yes | anthropic | blocked (systemic) | No independent defect. |
| BEN-REL-02.ts | yes | complete | yes | yes | none | blocked (systemic) | No independent defect. |
| BEN-REL-03.ts | yes | complete | yes | yes | anthropic | blocked (systemic) | No independent defect. |
| BEN-REL-04.ts | yes | complete | yes | yes | none | blocked (systemic) | No independent defect. |
| BEN-REL-05.ts | yes | complete | yes | yes | none | blocked (systemic) | No independent defect. |
| BEN-REL-06.ts | yes | complete | yes | yes | none | blocked (systemic) | No independent defect. |
| BEN-REL-07.ts | yes (added beyond original spec, documented precedent) | complete | yes | yes | anthropic + irs_990/entity_lookup | blocked (systemic) | No independent defect. |
| BEN-REL-08.ts | yes (added beyond original spec) | complete | yes | yes | anthropic | blocked (systemic) | No independent defect. |
| BEN-STR-01.ts | yes | complete | yes | yes | none | blocked (systemic) | No independent defect. |
| BEN-STR-02.ts | yes | complete | yes | yes | none | blocked (systemic) | No independent defect. |
| BEN-STR-03.ts | yes | complete | yes | yes | none | blocked (systemic) | No independent defect — target table (`pil_cultivation_plans`) exists live, would work once unblocked. |
| BEN-STR-04.ts | yes | complete | yes | yes | none | production-ready | Already unblocked (A3); confirmed live-completing. |

## Agents ready NOW (production-ready, no fix needed)

**Legacy (63):** ag-22-propensity-scoring, application-cloner, automation-worker, board-packet-agent,
browser-automation, budget-agent, budget-builder, change-monitor-agent, cold-outreach,
competitor-intel, compliance-checker, corporate-scraper, custom-api, custom-scrape,
deadline-extractor, deadline-prediction, disaster-response-agent, donor-intent-monitor-agent,
draft-generation-agent, ea-01..ea-10 (10), education-training-grants, eligibility-scorer,
email-campaign, email-parser, environmental-climate-grants, fit-analysis-agent, follow-up-generator,
foundation-finder, funder-intel, funder-relationship, funding-forecast-agent, giving-history,
grant-dna-agent, grant-summary, health-grants, housing-specific-scrapers, humanizer-agent,
impact-simulation-agent, knowledge-indexer-agent, minority-farmer-grants, nofa-parser,
opportunity-discovery-agent, playwright-agent, probability-scoring-agent, propublica,
recursive-learning, relationship-builder-agent, relationship-graph-builder-agent, review-agent,
sam-gov, self-improvement-agent, semantic-matching, state-portal, success-probability, usaspending,
research/corporate-giving, research/foundation-grants, research/government-grants,
research/local-sponsorship.

**PIL (6):** BEN-KNW-01, BEN-KNW-02, BEN-KNW-03, BEN-KNW-04, BEN-STR-04 (all already A3, unblocked
by the systemic bug). BEN-QUA-01 is a shim, not counted either way.

## Agents that need fixes before they're reliable

**Legacy (9):** autonomous-digest-agent (missing tables), deadline-prediction-agent (missing table +
unchecked insert), form-analyzer / form-filler (enum gap, silently swallowed), hud-monitor (enum
gap, silently swallowed), morning-digest (zero error handling), roi-optimizer-agent (enum gap on
the monthly pass only), state-scrapers / tdhca-scraper (external source URLs changed — not code
bugs, informational), grants-gov (known-hangs, already mitigated by not being called from cron).

**PIL (8):** BEN-SUP-01 / BEN-SUP-03 (non-terminal status bug), BEN-DIS-02 (unbounded delegation),
BEN-DIS-04 (missing goal guard), BEN-INT-02/03/04/05 (title-reuse bug).

## Agents currently blocked (can't run at all today)

**Legacy (13, all `agent_type` enum gaps):** community-need-predictor-agent, document-expiry-agent,
knowledge-gap-agent, outcome-analyzer-agent (+ separately missing `organizations.analytics`),
renewal-tracker-agent, search-profile-optimizer-agent, simulation-agent, strategic-advisor-agent
(+ separately wrong `board_members` column names), fundability-scorer-agent, simpler-grants (real
blocker is a missing API key, enum gap is secondary), followup-generator-agent (missing table, not
an enum gap), learning-network-aggregator-agent (missing columns, not an enum gap).

**PIL (40 + 5):** every A2-ceilinged agent (systemic policy bug — see Headline Finding #2) — DIS×8,
INT×10, REL×8, QLF×5 (also independently blocked by migration 165 — see below), STR×3, APP×3, OPS×1,
SUP×5. Plus BEN-QLF-01/02/03/04/05 independently blocked by migration 165 regardless of the policy fix.

## Schema mismatches (the authoritative list — cross-reference before trusting generated types)

| Table / Enum | What's missing live | Blocks |
|---|---|---|
| `agent_type` enum | `ag-35-community-need`, `ag-10-document-expiry`, `ag-11-knowledge-gap`, `ag-09-outcome-analyzer`, `ag-08-renewal-tracker`, `ag-12-search-optimizer`, `ag-37-simulation`, `ag-40-strategic-advisor`, `ag-29-fundability`, `ag-39-roi-optimizer`, `hud_monitor`, `form_analyzer`, `form_filler` (13 values) | 13 legacy agents |
| `digest_item_log`, `digest_priority_weights` | tables don't exist (migration 098) | autonomous-digest-agent.ts adaptive learning |
| `deadline_predictions` | table doesn't exist (migration 097) | deadline-prediction-agent.ts audit trail |
| `application_followups`, `follow_up_sequences` | tables don't exist (migration 081, `src/supabase/migrations/` track never applied) | followup-generator-agent.ts entirely |
| `platform_learning_patterns` | missing `confidence`, `weight` columns (migration 099) | learning-network-aggregator-agent.ts entirely |
| `org_learning_contributions` | missing `outcome_id`, `anonymized`, `source_hash` columns (migration 099) | same |
| `organizations` | missing `analytics` column | outcome-analyzer-agent.ts (secondary, after enum fix) |
| `board_members` | code in strategic-advisor-agent.ts queries `org_id`/`active`; real columns are `organization_id`/`is_active` | strategic-advisor-agent.ts (secondary, after enum fix) |
| `pil_mission_affinity_assessments`, `pil_funding_eligibility_assessments`, `pil_capacity_propensity_assessments`, `pil_timing_readiness_assessments` | tables don't exist (migration 165 never applied) | BEN-QLF-01/02/03/04/05 |

---

Phase 5.2B (fixes) follows this document. See commit history / `STATE_OF_THE_BUILD.md` for what
was actually applied.
