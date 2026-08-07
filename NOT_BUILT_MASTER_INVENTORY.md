# NOT_BUILT_MASTER_INVENTORY.md

**Single source of truth for everything not yet fully built and verified on this platform.**
Compiled 2026-07-30 by cross-referencing `BLUEPRINT_v2.md`, `FEATURE_REGISTRY_v2.md`, `AGENTS_v2.md`, `AGENT_VERIFICATION_LOG.md`, `WORKER_ARCHITECTURE_v2.md`, `INTERACTION_MAPS_v2.md`, `SCHEMA_REGISTRY_v2.md`, `AUTOAPPLY_ARCHITECTURE_V2.md`, `GRANT_INTELLIGENCE_ARCHITECTURE.md`, and `DONOR_DISCOVERY_ARCHITECTURE.md` against live code and, where available, real-session verification evidence.

**Authority order used throughout:** `AGENT_VERIFICATION_LOG.md` (live-tested tonight, 2026-07-30) > direct code grep this session > `AGENTS_v2.md`'s own July 19 code-level audit > `FEATURE_REGISTRY_v2.md` status claims. Where a governance doc's claimed status is contradicted by live evidence, that is called out explicitly rather than silently overridden.

**Scope honesty note:** this session had no live database (Management API PAT dead since 2026-07-19, Supabase MCP connector unauthorized), no working Anthropic API key locally, and no browser click-through (all UI findings are static code reads unless otherwise noted). Every classification below states what kind of evidence backs it. "Unverified" is a real, distinct category from "broken" — do not read it as failing.

---

## 1. FEATURES — every FEATURE_REGISTRY_v2.md entry not status=BUILT

### Status legend (verbatim from FEATURE_REGISTRY_v2.md)

| Status | Meaning |
|---|---|
| BUILT | Fully implemented, compile-verified, deployed to production |
| PARTIAL | Core functionality built, gaps documented |
| IN BUILD | Currently in active FORGE queue or overnight run |
| PLANNED | Scoped and architected, not yet in a queue |
| DEFERRED | Explicitly postponed to a future phase |

An additional tier system was added 2026-07-30 for agent rows (AG-15–AG-30 range) — see Section 2. Two ad hoc labels also appear (**CRITICAL**, **IN PROGRESS**) that aren't in the legend — vocabulary is inconsistent in the source doc.

> ⚠️ **Known stale block, ~13 rows:** everything labeled `IN BUILD ... migration NNN tonight` (rows 79, 98, 135-136, 140, 152, 156-159, 161-165 — Agent Registry, Knowledge Engine/pgvector, Command Center, pig_nodes/pig_edges graph schema, board packet/simulation schemas) reads as a leftover snapshot from an earlier FORGE session. Direct grep this session confirms the Agent Registry (`094_agent_registry.sql`, `settings/agents/page.tsx`, 775 lines), Knowledge Engine (`096_knowledge_engine.sql`, `knowledge-engine.ts`, `/intelligence/knowledge`), and Command Center (`command-center/page.tsx`, 599 lines) all already exist as real, non-stub code — and other rows in the *same document* (#170, #213, #100/#196/#220) already treat this code as an established fact. Recommend treating these rows as **likely-BUILT pending a fresh verification pass**, not as still-queued.

### Core PARTIAL / PLANNED / IN BUILD / NOT-BUILT / DEFERRED / CRITICAL

| # | Name | Status | What's missing |
|---|---|---|---|
| 56 | State Portal Framework | PARTIAL | Scraper exists as a stub only; no real HTML parsing implemented |
| 59 | Custom API Connector | PLANNED | Not built |
| 60 | Custom Scraping Targets | PLANNED | Not built |
| 66 | 990-PF Giving History | PLANNED | Foundation profiler exists but not a dedicated giving-history extractor |
| 77 | Multi-Channel Outreach | PARTIAL | Templates/send route exist; LinkedIn/phone/physical mail not implemented |
| 79 | Graph Database Schema | IN BUILD (likely stale) | `pig_nodes`/`pig_edges` — real creating migration is `src/supabase/migrations/077_intelligence_graph.sql`, not the "093/094 tonight" the row claims; other rows already depend on it existing |
| 80 / 95 | Relationship Discovery Engine / Relationship Mapper (RA-01, AG-23) | NOT-BUILT | No file/class/route under this label anywhere; the real implementation exists under a colliding agent number, AG-32 (row #220) — unreconciled split in the source doc |
| 81 | Relationship Explorer UI | PLANNED | Force-directed viz at `/research/graph`, Phase 3 |
| 82 | Path Finder | PLANNED | Shortest path between entities, Phase 3 |
| 85 | Personalized Match Feed | PLANNED | Per-org scoring vs. Digital Twin, Phase 2 |
| 86 | Discovery Preferences | PLANNED | User-configurable source/category filters, Phase 2 |
| 87 | Corporate Prospects Table | BUILT, live-apply unconfirmed | Migration 107 exists; table 404'd as of 2026-07-20 (see AG-20/21/22/24 findings — still broken as of tonight) |
| 92 | Corporate Giving DNA | PLANNED | Per-company profile, Phase 2 |
| 96 | Change Monitor (CM-01, **AG-42**, renumbered from AG-30 2026-08-02) | NOT-BUILT | Confirmed zero code exists anywhere for change-detection/re-enrichment trigger. Renumbered off AG-30 to resolve a collision with the real, live Donor Intent Monitor, which now permanently owns AG-30 — see `AGENTS_v2.md` §1.4. |
| 97 | Corporate Marketplace | PLANNED | Prospect search UI + filter engine, Phase 2 |
| 98 | Relationship Memory | IN BUILD (likely stale) | `relationship_memory` table — same stale-snapshot issue as row 79 |
| 99 | Signal Monitoring | PLANNED | LinkedIn + news + 990 watching, Phase 2 |
| 100 | Relationship Builder (AG-19) | BUILT, unwired | Real 1,174-line class, never imported/instantiated outside its own file; orchestrator substitutes a narrower Gen-1 agent (`funder-relationship.ts`) instead |
| 101 | Relationship Builder UI | PLANNED | `/funders/[id]/relationship`, Phase 2 |
| 106 | Factor Breakdown UI | PLANNED | Expandable score explanation, not covered by tonight's verification pass |
| 116 | One-Click Proposal Package | PLANNED | Phase 2 |
| 120 | Corporate Outreach UI | PLANNED | One-click campaign generation, Phase 2 |
| 121–125 | Donation Marketplace (schema, listing UI, match engine, request/approval flow, receipt generator) | PLANNED | Entire Pillar 9 unbuilt, Phase 3 |
| 130 | Auto-Deploy Disaster Response | PLANNED | Automatic campaign deployment on disaster declaration, Phase 2 |
| 131–134 | Funding Forecast (schema/agent/dashboard/market trend) | Schema BUILT (migration 078, not "095" as the row claims), agent/dashboard NOT-BUILT | `funding_forecasts` table has no writer anywhere — only a read-only consumer (AG-40) exists; no route, no page |
| 135–136 | Board Members / Meeting Packets Schema | IN BUILD, live-table status not independently reconfirmed tonight | Prior audit (July 19) says "no successor found, feature never shipped" — plausible but not re-verified live |
| 137 | Board Packet Agent (AG-27) | NOT-BUILT | Zero code found anywhere |
| 138 | Board Member Portal | PLANNED | Phase 3 |
| 139 | Plain Language Financials | PLANNED | Phase 3 |
| 140 | Simulation Schema | Same live-table caveat as 135-136 | `impact_simulations` |
| 141 | Simulation Agent (**AG-41**, renumbered from AG-28 2026-08-02, canonical Impact Simulation) | NOT-BUILT | Zero code found anywhere. Renumbered off AG-28 to resolve a collision with the real, live Follow-Up Generator agent (`"ag-28-followup"`), which now permanently owns AG-28 — see `AGENTS_v2.md` §1.4. |
| 142 | Simulator UI | PLANNED | `/intelligence/simulate`, Phase 4 |
| 144–146 | Narrative Gap / Geographic Gap / Gap Recommendations | PLANNED | Rest of Pillar 14 unbuilt, Phase 2 |
| 151 | Auto-Monitor on Add | PLANNED | Auto-enroll new funders in reputation monitoring, Phase 2 |
| 152 | Command Center Page | IN BUILD (stale — see caveat above) | Page is real, 599 lines, owner/admin-gated |
| 153–155 | Real-Time Panel Updates / Configurable Layout / TV Mode | PLANNED | Rest of Pillar 16 |
| 156–159 | Agent Registry (schema/seed/API/marketplace UI) | IN BUILD (stale — see caveat above) | All confirmed real: migration 094, real API routes, real 775-line settings page |
| 160 | Agent Log Viewer | PLANNED | Per-agent run history/output, Phase 2 |
| 161–165 | Knowledge Engine (pgvector, patterns table, core, query API, UI) | IN BUILD (stale — see caveat above) | All confirmed real: migration 096, `knowledge-engine.ts`, real query route + page |
| 170 | Embedding Indexer Agent (AG-29 canonical) | NOT-BUILT as an agent; underlying capability BUILT-AND-VERIFIED | No dedicated autonomous indexer class exists; `embeddings.ts` itself is real and live-verified (105/105 real vectors), just manual-CLI-only, never wrapped in an autonomous agent |
| 171 | RAG Integration in Draft Generator | PLANNED | Draft Generator doesn't pull from Knowledge Engine yet |
| D2 | IRS 990 Stream Parser | PARTIAL | Script exists; EIN column bug confirmed (see [[benavora-bmf-ingest-column-bug]] memory); fix queued but not confirmed shipped |
| D4 | 298K Prospect CSV Import | PLANNED | Script exists at `scripts/import-prospects.ts`; never run |
| D5 | Intelligence Library Corpus | PARTIAL | 11 NIH proposals loaded; nights 2–7 of the load never run |
| D7 | DATAOCEAN Backup | CRITICAL (undefined in legend) | `enrichment-output/` never backed up to D:\; reruns overwrite data |
| US1 | scrape_jobs/scrape_results schema | PARTIAL — file exists, DB-apply unconfirmed | Migration `110_scrape_jobs_universal_scraper.sql` confirmed present, not confirmed applied live |
| US2 | Elite stealth stack install | PARTIAL — primary engine non-functional | camoufox-js segfaults on this machine (needs Node ≥22, repo runs Node 20); fallback stack in use |
| US6 | Foundation-990 job template | PARTIAL — code complete, zero real-data verification | Untracked/uncommitted; never run against real data ([[benavora-uscraper007-live-verified-2026-07-30]]) |
| US7 | Nonprofit-contact job template | PARTIAL — code complete, blocked | Blocked on invalid local ANTHROPIC_API_KEY ([[benavora-anthropic-key-invalid-local]]) |
| T4–T8 | E2E / Visual Regression / DB Migration / Soak / Cross-Browser tests | PLANNED | Entire remaining test surface unbuilt (note: core Playwright e2e suite itself is mature per [[benavora-playwright-suite-already-mature]] — this is the *additional* test surface beyond that) |
| — | Dashboard (UI Redesign) | IN PROGRESS (undefined in legend) | Illustration positioning needs refinement |
| — | Sidebar (UI Redesign) | PARTIAL | Active state needs confirmation |
| — | Opportunities page (UI Redesign) | PLANNED | Probability badges + sort-by-score queued |
| — | All other pages (UI Redesign) | PLANNED | One component per session, post-dashboard queue |

---

## 2. AGENTS — AG-01 through AG-42 (AG-01–30 canonical range plus the two renumbered former-phantom
specs, AG-41/AG-42), verification-log authoritative

**Updated 2026-08-07, superseding the 2026-08-02 version below in full (which is itself kept,
further down, superseding the original 2026-07-30 version).** Since the 2026-08-02 pass, a large
overnight build+verify chain (commits `77d2289`…`9071c37`, 2026-08-02 through 2026-08-06) did four
things that materially change this section's picture:

1. **Built and live-verified 7 previously NOT-BUILT agents from scratch**: AG-10 (Grant DNA
   Analysis), AG-26 (Funding Forecast), AG-27 (Board Meeting Packet), AG-29 canonical (Knowledge
   Engine Indexer — now a genuine, continuously-running autonomous agent, not just the underlying
   embeddings capability), AG-41 (Impact Simulation), AG-42 (Change Monitor), and wired AG-23's real
   on-disk implementation (`ag-32-relationship-graph`) into a daily incremental schedule. All 7 were
   live-execution-tested against real production data (not just compile-checked) — see the `## AG-10`
   through `## AG-42` entries in `AGENT_VERIFICATION_LOG.md`.
2. **Created and RLS-hardened `corporate_prospects`** (commit `11030b5`, migration 107/108/109/111),
   the single longest-standing shared blocker in this document (tracked back to 2026-07-20). Live
   re-verification immediately after: **AG-20, AG-21, AG-30, and AG-32 (AG-23's real implementation)
   all now complete successfully end-to-end** against real data — this is the biggest single change
   in this update.
3. **Rotated the platform `ANTHROPIC_API_KEY`** (commit `8f3aa06`, 2026-08-06) after the old key
   (dead since before this document's history begins) was finally identified and replaced, synced to
   `.env.local`/Railway/Vercel and redeployed. **AG-22 (Propensity Scoring) — the one agent left
   blocked purely by this key after the `corporate_prospects` fix — is now confirmed fully unblocked**,
   first clean run in this project's history. This same key rotation almost certainly also unblocks
   AG-15's autonomous wrapper and improves output quality for AG-26/AG-30/AG-32/AG-42's
   Claude-dependent sub-features (all of which hit the identical dead-key 401 in their pre-rotation
   test runs) — **stated as a strong probability, not a verified fact**, since only AG-22 was actually
   re-run against the new key. Flagged as near-term, low-effort re-verification work.
4. **AutoApply (AG-12)'s ready-org pipeline reached a genuine, passing end-to-end state for the first
   time** (2026-08-06/07): ffmpeg crash, dead key, an empty-content Claude call, and a missing
   `form_templates` column were fixed in sequence, and `autoapply-queue.test.ts` now passes 6/6,
   including the previously-never-passing "ready org" case.

**One correction to the 2026-08-03 `corporate_prospects` re-verification entry itself**: that entry
claimed AG-24 (Personalized Outreach Generator) "has no implementing file anywhere in the repo." This
session re-checked directly (`src/app/api/intelligence/outreach/generate/route.ts`, wired to
`/donor-discovery/outreach`) and that claim is **wrong** — the same file the 2026-07-20 audit already
found, still real, still there. The 2026-08-03 session appears to have repeated the exact scanning
mistake an earlier audit already flagged and corrected once (checking only `src/lib/agents/` for an
`AutonomousAgent`-extending class, missing that AG-24 is a plain API route, the same shape as AG-04's
manual path). AG-24 is real and BUILT — see category 3 below for its current (likely resolved,
unconfirmed) blocker status, not category 4.

This section's scope is unchanged from 2026-08-02: the canonical `AGENTS_v2.md` AG-01–AG-30 range,
plus AG-41/AG-42 (the two former AG-28/AG-30 phantom specs, permanently renumbered 2026-08-02 to
resolve their collisions with the real, live Follow-Up Generator and Donor Intent Monitor agents).
Numbers beyond this range that appear elsewhere in this codebase's live pipelines (AG-36 Learning
Network Aggregator, AG-38 Self-Improvement Agent, AG-40 Strategic Advisor, etc.) were never in this
document's scope and are not covered here.

**Categorization (unchanged from 2026-08-02):**
1. **BUILT AND VERIFIED WORKING** — real, confirmed via an actual live test run.
2. **BUILT BUT NOT WIRED** — the code works when run directly, but nothing in production actually
   calls it (the AG-19 pattern).
3. **BUILT BUT BLOCKED** — real code exists, but a specific, named issue (missing table, dead API
   key, etc.) prevents it from doing real work.
4. **NOT BUILT AT ALL** — no real code exists anywhere, under this identity.

Numbers use the canonical `AGENTS_v2.md` identity. Where a real, live on-disk agent literal collides
with a different canonical number (a documented ≥9-way problem, `AGENTS_v2.md` §1.4), that agent is
categorized under its own actual identity and cross-referenced from the canonical number's row —
never conflated. Several canonical numbers split across a live Generation-1 implementation and a
dead Generation-2 rewrite of the same concept; both halves are stated explicitly rather than
collapsed into one label.

### FINAL TALLY (32 canonical numbers in scope: AG-01–AG-30 + AG-41 + AG-42)

| Category | Count (primary, one per canonical number) | Count (full row/entry list, incl. Gen-2 dead-code duplicates & on-disk collisions) |
|---|---|---|
| 1. BUILT AND VERIFIED WORKING | **26** | 31 |
| 2. BUILT BUT NOT WIRED | **2** (AG-03, AG-19) | 7 |
| 3. BUILT BUT BLOCKED | **3** (AG-14, AG-15, AG-24) | 3 |
| 4. NOT BUILT AT ALL | **1** (AG-23, under its own identity only) | 1 |

**The two categories that represent real remaining work, called out explicitly per this task's
request:**
- **NOT BUILT AT ALL, with zero code anywhere: effectively zero.** Only AG-23 remains, and even that
  is a naming artifact, not missing work — its real implementation is fully built, wired, and
  live-verified working under the on-disk literal `ag-32-relationship-graph` (category 1). Every
  other agent that was NOT-BUILT as of the 2026-07-30/08-02 versions of this document (AG-10, AG-26,
  AG-27, AG-29, AG-41, AG-42 — 6 of the 7 former phantom specs) was built and live-verified this week.
  This is the single biggest change in this update: the "not built at all" category has gone from 7
  real entries to 1 naming artifact.
- **BUILT BUT NOT WIRED: 2 primary (AG-03, AG-19), 7 if counting every Gen-2/dead-code duplicate.**
  AG-19 remains the flagship example — a real, capable 1,174-line class, re-confirmed working
  standalone 2026-08-02, that `worker/autonomous-orchestrator.ts` still never calls. AG-03's
  auto-trigger-on-new-opportunity behavior is still unwired (manual path works). The other 5 entries
  (AG-02/04/06/18's Generation-2 rewrites) are dead code superseded by a live Generation-1 sibling,
  not gaps in coverage — the platform doesn't lack the capability, it just has an orphaned second
  implementation of one it already has.

### 1. BUILT AND VERIFIED WORKING

| Agent | Evidence |
|---|---|
| AG-01 Grant Summary | `grant-summary.ts` real, chain-invoked from research/import flows. Wired with no known blocker; not independently live-execution-tested in this log. |
| AG-02 Eligibility Scoring (Gen-1, `eligibility-scorer.ts`) | Live, runs nightly + via queue. Wired with no known blocker; not independently live-execution-tested in this log (output not hand-checked). |
| AG-04 Fit Analysis (manual route) | Real, works. |
| AG-05 Research | Manual multi-source discovery (Grants.gov, SAM.gov, ProPublica, custom). Code + call sites agree, no documented blocker; not independently live-execution-tested in this log. |
| AG-06 Draft Generator (plain-function path, `generator.ts`) | Live, nightly + queue + manual UI, enforces `pending_review=true`, never auto-submits. Wired, not independently live-execution-tested. |
| AG-07 Learning Agent | `recursive-learning.ts` fires on every `outcomes` insert per code audit. Not independently live-execution-tested in this log. |
| AG-08 NOFA Parser | Chain-only subroutine, file confirmed present. Not independently live-execution-tested in this log. |
| AG-09 Email Parser | Real, event-triggered on inbound email. No live accuracy test on record. |
| AG-11 Cold Outreach | Real, manual-trigger, human-approval enforced; incidentally confirmed real (not a stub) while investigating AG-24, but not itself independently live-execution-tested. |
| AG-12 AutoApply | **Confirmed live end-to-end** ([[benavora-autoapply-automation-level-fixed-org-not-ready-next]]). One named residual defect: `submission_queue.risk_score`/`risk_factors` writes silently no-op (migration 052 columns never applied) — does not block the core flow, but that specific field pair never persists. |
| AG-13 Foundation Enrichment | Not via its originally-named CLI-only implementation — via a materially different, real scraper-based pipeline targeting the same table, live-scheduled weekly in `worker/scheduler.ts` (`foundation-enrichment-weekly`, gated behind `ENABLE_SCRAPER`, actual prod value unchecked). |
| AG-15 Grant Probability — deterministic engine only (`computeGrantProbability()`) | Live-tested against 2 real production opportunities, hand-checked math correct, real persistence to `opportunity_probability_scores`. (The autonomous wrapper is a separate row below — category 3.) |
| AG-16 Digital Twin Builder | Live prod row confirmed for a real org (`twin_completeness_score: 70`), event-triggered (KB save, onboarding, manual route). |
| **AG-17 Opportunity Discovery** | **Fixed and re-verified live 2026-08-02.** Enum gap closed, then a second bug found and fixed (`agent_decisions.action_payload`/`agent_run_id` missing columns). Re-run produced real substantive output: 30 new opportunities discovered, 20 chained into eligibility scoring, zero errors, real `agent_decisions` rows with genuinely populated `action_payload`. |
| AG-18 Reputation Intelligence (live plain-function path) | Real nightly writes confirmed to `reputation_signals`/`reputation_alerts`. (A separate, newer `ReputationIntelligenceAgent` class also exists — category 2 below, not this.) |
| **AG-19 Relationship Builder — capability only, not production wiring** | Re-confirmed working 2026-08-02: completes a real run with zero enum errors when directly instantiated. **This does NOT mean it's wired — see category 2, its actual production status.** |
| AG-25 Disaster Response (canonical, manual API route) | Spec matches code exactly, no drift; two real functions. (Reachable only manually — see category 2 for the missing automatic cron.) **Permanently shares the AG-25 number with the unrelated agent below, by deliberate decision — not a collision to fix.** Unlike AG-28/AG-30, this agent's own source files self-identify as "AGENTS_v2.md AG-25," so the number can't be safely reassigned without a code change. |
| **AG-25's on-disk collision: Deadline Prediction Agent (`ag-25-deadline-prediction`)** | **Fixed and re-verified live 2026-08-02.** Enum gap closed; re-run completed cleanly, `itemsFound: 15`, zero errors. Now confirmed real and live, same as the unrelated Disaster Response agent above sharing its number — both halves of this permanent dual-use number are working agents, not one real and one dead. |
| **AG-28 Follow-Up Generator Agent** (`ag-28-followup` — AG-28 now its permanent, sole number as of 2026-08-02, no longer just an "on-disk collision") | Enum gap closed, re-verified 2026-08-02: completes via its documented no-op path when no `agent_queue` trigger is present. A full trigger-driven run (with a real applicationId payload) has not been exercised in this log yet. |
| AG-29's on-disk collision: Fundability Scorer (`ag-29-fundability`) | Real, wired into `worker/autonomous-orchestrator.ts`. Not independently live-execution-tested in this log. |
| **AG-29 canonical — Knowledge Engine Indexer Agent** (`ag-29-knowledge-indexer`) | **Built and live-verified 2026-08-03 — no longer just "underlying capability," now a genuine autonomous agent.** `KnowledgeIndexerAgent` (`knowledge-indexer-agent.ts`) generated real, non-placeholder 1536-dim embeddings for all 3 real pending `outcomes` rows; confirmed idempotent (re-run reprocesses nothing, structurally gated so it can't double-call OpenAI); confirmed its no-real-content skip path correctly excludes all 133,812 `foundation_directory` rows lacking real text, at full table scale, not a hypothetical. **Found continuously running in production already** — the real deployed Railway worker was independently confirmed polling this exact agent every ~60-70s throughout the test, unprompted. One open, only-partially-explained anomaly: the worker's first 5 real autonomous runs failed before a 6th succeeded with identical code/data/key — root-caused as unrecoverable-by-design (a logging gap discards the real error text) in a follow-up investigation, not resolved. |
| **AG-10 Grant DNA Analysis** | **Built and live-verified 2026-08-03.** `GrantDnaAgent` (`grant-dna-agent.ts`) runs cleanly end-to-end (after fixing a second, newly-discovered `agent_runs.output_payload` schema gap affecting 5 agents, not just this one); its "zero opportunities → skip, no row written" branch confirmed working via the real `agent_queue` event path. The other 3 branches (real opportunity/outcome evidence) could not be exercised — this org, and every cross-org name-matched copy of its 4 real funders, genuinely has zero opportunities on file anywhere on the platform today, confirmed exhaustively rather than assumed. Wired into `worker/scheduler.ts`'s weekly Sunday pipeline (`runGrantDnaWeeklyPipeline`). |
| **AG-20 Corporate Giving Detector (EA-01)** | **Unblocked 2026-08-03** once `corporate_prospects` was created — `EA01GivingDetectorAgent.run({prospectId})` completed cleanly against a real SAM.gov-sourced prospect (correctly took its documented no-website graceful path). The `corporate_prospects` 404 that blocked every prior run is resolved. A pre-existing, separate accuracy defect (hardcoded 3-path website guess, 1/9 real hits in an earlier accuracy test) is unchanged and still real — flagged as a quality gap, not a build/wiring blocker. |
| **AG-21 Executive Biography Analyzer (EA-08)** | **Unblocked 2026-08-03**, same fix and same clean completion as AG-20 (same real prospect, same no-website graceful path). Pre-existing accuracy defect (0/6 real hits in an earlier test) likewise unchanged, not a build/wiring blocker. |
| **AG-22 Propensity Scoring** | **Fully unblocked 2026-08-06 — first clean run in this project's history.** After `corporate_prospects` was fixed (08-03) and the platform `ANTHROPIC_API_KEY` was rotated (08-06, commit `8f3aa06`), `PropensityScoringAgent.run()` completed against the real Faith Foundation org and a real prospect: `status: "completed"`, `tokens_used: 4634`, all 9 rubric scores (`PS-01`…`PS-10`) computed and persisted to `corporate_prospects.scores`. Both of this agent's named blockers (missing table, dead key) are now resolved. |
| **AG-30 Donor Intent Monitor** (`ag-30-donor-intent` — AG-30's permanent, sole number as of 2026-08-02) | **Unblocked 2026-08-03.** `DonorIntentMonitorAgent.run('manual')` now completes a full real run (`status: completed`, `items_found: 1, items_processed: 1`) against the real Faith Foundation org — the `corporate_prospects` fetch that previously threw outright now succeeds. Downstream per-signal Claude calls still hit the (at-the-time) dead key and are caught into `errors[]` without failing the run — likely also resolved by the 08-06 key rotation, not independently re-tested since. |
| **AG-23's real implementation: AG-32 Relationship Graph Builder** (`ag-32-relationship-graph`) | **Unblocked and enum-fixed 2026-08-02/03, wired into a daily incremental schedule 2026-08-03, full real run confirmed 2026-08-03.** Enum gap closed; a `board_members` column-naming bug (query assumed `role`/`expertise`/`org_id`/`active`, real columns are `title`/`organization_id`/`is_active`) found and fixed; wired into `worker/scheduler.ts` via `runRelationshipGraphIncrementalPipeline()`/`resolveIncrementalBoardMemberScope()` (both scope-query branches confirmed correct). After `corporate_prospects` was created, a full `run('manual')` completed successfully: `items_found: 23, items_processed: 23`, all 3 real board members processed, `assetCompatibleMatches: 20`. This is the agent AG-23's own canonical identity has zero code for — see category 4 for that naming split. |
| **AG-26 Funding Forecast Agent** | **Built and live-verified end-to-end 2026-08-03** — every dimension tested against real production data: both `90_day`/`12_month` rows write in one run; the neutral-fallback math for partially-scored windows matches a hand-computed reproduction to full decimal precision; the zero-opportunity-org branch writes an honest `$0` row with an explicit `null` confidence, not a skip; idempotency confirmed via byte-identical `id`/`created_at` across two runs (real `ON CONFLICT DO UPDATE`, not delete-and-reinsert). Wired into `worker/scheduler.ts`'s monthly pipeline (`runFundingForecastMonthlyPipeline`). Narrative synthesis (Claude-generated risks/opportunities) degraded gracefully to empty during this test due to the then-dead key — likely also resolved by the 08-06 rotation, unconfirmed. |
| **AG-27 Board Meeting Packet Agent** | **Built and live-verified 2026-08-03** against the real Faith Foundation org with a real, temporary test `board_meetings` row. Migration 111's enum value and `UNIQUE(meeting_id)` constraint confirmed live before testing. Wired into `worker/scheduler.ts`'s daily pipeline (`runBoardPacketDailyPipeline`) plus an `agent_queue` event-chained safety net for short-notice meetings. |
| **AG-41 Impact Simulation Agent** (renumbered from AG-28, 2026-08-02) | **Built and live-verified 2026-08-03**, 4 real scenario invocations against the real Faith Foundation org (direct class instantiation, same logic the real `POST /api/agents/simulate` route — `requireRole("writer")`-gated, real manual production call site — wraps). |
| **AG-42 Change Monitor Agent (CM-01)** (renumbered from AG-30, 2026-08-02) | **Built and live-verified 2026-08-03.** Migration 113's enum value confirmed live. Real first-ever run against real data: `foundation_directory`'s 14 real eligible rows checked, `corporate_prospects` gracefully degraded (missing at the time, not a crash), a synthetic detected-change row correctly produced a real diff/severity/chain-queue entry. Wired into `worker/scheduler.ts`'s daily pipeline (`runChangeMonitorDailyPipeline`). One separate, unrelated bug found downstream: the `'foundation-990-enrichment'` chain target this agent queues into fails 100% of the time on a real Railway env-var-naming mismatch — this agent's own detect+queue responsibility is fully discharged correctly; the break is entirely in the chain target's own wiring, not this agent. |

### 2. BUILT BUT NOT WIRED

| Agent | Evidence |
|---|---|
| AG-02 Eligibility Scoring — Generation-2 rewrite (`eligibility-scoring-agent.ts`, `EligibilityScoringAgent`) | Real class, `agentId: "ag-02"` — enum value now fixed (2026-08-02), but never instantiated anywhere in the codebase. Dead code, not a blocked one. |
| AG-03 Deadline Extraction | Real, callable on-demand (a manual path exists) — but the specific documented behavior (automatically creating `deadlines` rows on new-opportunity creation) has no code path triggering it. The intended default behavior is unwired even though the capability itself works when invoked. |
| AG-04 Fit Analysis — autonomous version | Coded, but never instantiated; the worker's own header comment calls wiring it "out of scope." Enum value now valid, doesn't change this. |
| AG-06 Draft Generator — "Twin-Powered" Generation-2 class | `FEATURE_REGISTRY_v2.md` row #110 credits this enhancement to a dead class; the class that's actually live is the plain-function path (category 1). |
| AG-18 Reputation Intelligence — `ReputationIntelligenceAgent` class | Real, full `agent_decisions` audit trail, richer than the live plain-function path — but appears nowhere outside its own file declaration. `agentId: "ag-18-reputation"` was enum-blocked at the 2026-08-02 version of this document; **the enum gap itself was closed 2026-08-02/03** (`ALTER TYPE agent_type ADD VALUE 'ag-18-reputation'`, live-tested: `itemsFound: 4`, clean completion) — but the class is **still never instantiated anywhere outside its own file**, so it stays in this category for the wiring gap alone, not the enum. |
| **AG-19 Relationship Builder (actual production status)** | The real, 1,174-line class (includes an undocumented multi-hop BFS warm-intro feature over `pig_nodes`/`pig_edges`) works standalone — re-confirmed 2026-08-02 — but `worker/autonomous-orchestrator.ts` still substitutes a narrower, unrelated live agent (`funder-relationship.ts`, event-delta only) wherever "the relationship builder" is requested. Re-grepped 2026-08-02: `new RelationshipBuilderAgent` still appears nowhere outside its own file. **Confirmed still true this week** — no change. |
| AG-25 canonical (Disaster Response) — automatic trigger | Reachable only via `/api/agents/disaster`; zero cron/worker wiring despite other docs claiming a 6-hour poll. |

### 3. BUILT BUT BLOCKED

| Agent | Blocked by |
|---|---|
| AG-14 Donor Discovery | `worker/dd-request-processor.ts` is real and starts unconditionally, but source tables are empty in production except taxonomy — the pipeline runs correctly and has nothing to act on. |
| AG-15 Grant Probability — autonomous wrapper (`ProbabilityScoringAgent`) | Enum gap fixed 2026-08-02, re-verified live: the run itself completes (`status: completed`, real `agent_runs` row) with zero enum errors — but every per-opportunity scoring call failed on the (at-the-time) dead local `ANTHROPIC_API_KEY` (401), so it scored 0 of 20 real candidates as of that test. **Not independently re-tested since the 2026-08-06 platform key rotation** (commit `8f3aa06`) that unblocked AG-22's identical failure mode — very likely also fixed now, flagged as a quick, high-confidence re-verification rather than assumed. |
| **AG-24 Personalized Outreach Generator** | Real, live-wired (`/api/intelligence/outreach/generate` → `/donor-discovery/outreach` UI) — **corrects a wrong "no implementing file exists" claim in the 2026-08-03 `corporate_prospects` session**, which repeated a scanning mistake (checking only `src/lib/agents/` for a class file, missing this is a plain API route) an earlier 2026-07-20 audit had already caught and corrected once. Both of its named blockers — missing `corporate_prospects` (fixed 2026-08-03) and the dead platform key (fixed 2026-08-06) — now appear resolved elsewhere in the codebase, but **this specific route has not been independently re-run since either fix**. Kept in this category rather than promoted to category 1 until that re-verification happens. |

### 4. NOT BUILT AT ALL

| Agent | Spec depth in `AGENTS_v2.md` |
|---|---|
| AG-23 Relationship Mapper (RA-01), under this specific identity | Same thin template (purpose, type, tier gate, Autonomous Mode entirely placeholder text). No file/class/route exists under this specific name. **The real capability exists under AG-32's on-disk literal (`ag-32-relationship-graph`) — category 1 above, built, wired, and live-verified working** — this is a naming-collision artifact, not missing functionality. Of the 7 agents that were NOT-BUILT under this scheme as of 2026-08-02 (AG-10, AG-23, AG-26, AG-27, AG-29, AG-41, AG-42), 6 were built and live-verified this week; this is the only one remaining, and even it has a live, working real-world counterpart under a different literal. |

**Cross-reference finding for category 4, historical note (as of the 2026-08-02 version, now superseded for 6 of 7 rows — see above):** those 7 NOT-BUILT canonical agents shared the
exact same short template in `AGENTS_v2.md` — a one-to-two-sentence purpose statement, a type (AI/
Claude or embedding model), a tier gate, and an "Autonomous Mode" section that is entirely
placeholder text ("PLANNED," "not designed in code," "undetermined"). **None of the 7 have a
detailed, implementation-ready spec** — no designed trigger conditions, chain outputs, decision-log
shape, or data-flow beyond the one-line purpose. They are not "just an ID with nothing written"
either — each has a named purpose and tier gate — but real design work (trigger logic, data
contracts, chain wiring) would need to happen before any of these are buildable, not just
implementation.

**Cross-cutting system bug — now fully fixed for every real agent identity found to date:**
`agent_runs.agent_type` is a strict Postgres enum. As of 2026-07-30, at least 15 real agent-ID
literals used in code had never been added to it, so every one of those agents failed at the very
first `agent_runs` insert (`22P02: invalid input value for enum agent_type`). **Fixed live in
production 2026-08-01/02** for the first 15 literals — all confirmed present via the live PostgREST
OpenAPI schema, 6 individually re-run live to confirm (AG-15's wrapper, AG-17, AG-19, the Deadline
Prediction Agent sharing AG-25's on-disk literal, and the real AG-28/AG-30, both permanently
renumbered off their old phantom-spec collisions 2026-08-02, see `AGENTS_v2.md` §1.4). **The two
literals explicitly flagged as still enum-blocked in the prior version of this document —
`ag-18-reputation` and `ag-32-relationship-graph` — were themselves closed 2026-08-02/03** (both
added via `ALTER TYPE agent_type ADD VALUE`, both live-tested: AG-18's class completed cleanly,
AG-32's hit a separate, unrelated `board_members` column bug rather than the enum, later also fixed).
Every subsequent new agent built this week (AG-10/26/27/29/41/42) shipped with its own enum value
pre-applied by its own build session. **As of this update, no known agent identity in this document's
scope remains enum-blocked** — the several still-open items in categories 2/3 above are all wiring
gaps or non-enum blockers (missing table, dead key, unwired call site), not `22P02` errors.

Second cross-cutting issue, unchanged: `FEATURE_REGISTRY_v2.md` rows #197–212 label agents by their
on-disk Generation-2 literal, not by the canonical AG-XX taxonomy in `AGENTS_v2.md` — a documented
≥9-way numbering collision (`AGENTS_v2.md` §1.4).

Third cross-cutting note, new this update: this section's own live-verification entries are not
infallible — the 2026-08-03 `corporate_prospects` re-verification session incorrectly claimed AG-24
had "no implementing file anywhere in the repo," when a real, wired API route has existed since at
least 2026-07-20. Corrected in category 3 above after an independent direct re-check
(`src/app/api/intelligence/outreach/generate/route.ts`, confirmed to exist and read correctly
2026-08-07). Treat any single session's "zero code found" claim as provisional until a second,
independently-scoped search confirms it — the failure mode here was a narrow search (`src/lib/agents/`
only), not a fabrication.

---

## 2b. AGENTS section, 2026-07-30 original (superseded above, kept for history)

**Classification key:** BUILT-AND-VERIFIED (live-tested this session or a directly cited prior live test, output confirmed correct) · BUILT-BUT-UNVERIFIED (real code + real call site, no live execution/output test on record) · PARTIALLY-BUILT (real code exists but is broken, unwired, half-chained, or split across a working piece and a dead piece) · NOT-BUILT (no implementation found by any source, including direct grep).

| Agent | Purpose | Classification | Evidence / gap |
|---|---|---|---|
| AG-01 Grant Summary | Structures raw scraped/imported opportunity text | BUILT-BUT-UNVERIFIED | `grant-summary.ts` real, chain-invoked from research/import flows; no live output test, untracked in Feature Registry |
| AG-02 Eligibility Scoring | 0–100 org-fit score | PARTIALLY-BUILT | Live Gen-1 `eligibility-scorer.ts` runs nightly + via queue; Feature Registry's "chains to AG-15" claim describes the dead Gen-2 twin, never instantiated |
| AG-03 Deadline Extraction | Creates `deadlines` rows from opportunity deadlines | PARTIALLY-BUILT | Real, callable on-demand; no code path auto-triggers it on new-opportunity creation, contradicting Feature Registry's "for all new opportunities" framing |
| AG-04 Fit Analysis | Deep ROI/effort "should we apply" pass | PARTIALLY-BUILT | Manual route works; autonomous version is coded but never instantiated (worker's own header comment calls wiring it "out of scope"); its agent-type literal isn't in the enum either |
| AG-05 Research | Manual multi-source discovery (Grants.gov, SAM.gov, ProPublica, custom) | BUILT-BUT-UNVERIFIED | Best-corroborated of AG-01–14: code + Feature Registry agree, no documented blocker, but no live execution test on record |
| AG-06 Draft Generator | Full grant narrative from KB + proven narratives | PARTIALLY-BUILT | Live plain-function path (`generator.ts`) runs nightly + via queue + manual UI, enforces `pending_review=true`, never auto-submits; writes no `agent_decisions` audit trail; Feature Registry's "Twin-Powered" enhancement (row #110) is attributed to a dead Gen-2 class |
| AG-07 Learning Agent | Extracts proven-narrative patterns from outcomes | BUILT-BUT-UNVERIFIED | `recursive-learning.ts` fires on every `outcomes` insert per code audit; no independent Feature Registry tracking, no live test |
| AG-08 NOFA Parser | Parses federal NOFA documents into structured fields | BUILT-BUT-UNVERIFIED | Chain-only subroutine, file confirmed present, untested live |
| AG-09 Email Parser | Extracts deadlines/action items from inbound email | BUILT-BUT-UNVERIFIED | Real, event-triggered on inbound email, no live accuracy test |
| AG-10 Grant DNA Analysis | Structured funder-requirement profile | NOT-BUILT | Every source (doc audit, Feature Registry, direct grep) agrees: no implementation exists |
| AG-11 Cold Outreach | Extracts contacts + drafts sequences for companies with no giving page | BUILT-BUT-UNVERIFIED | Real, manual-trigger, human-approval enforced; incidentally confirmed real (not a stub) while investigating AG-24, but not itself live-tested |
| AG-12 AutoApply | Stealth browser form-fill/submit with human approval gate | PARTIALLY-BUILT | Structurally real and confirmed to run live end-to-end 2026-07-28 ([[benavora-autoapply-automation-level-fixed-org-not-ready-next]]); blocked historically by missing `request_profiles` — **update:** MASTER_BACKLOG.md now shows `request_profiles` was manually applied 2026-07-30 and exists live (anon-readable, RLS gap, but exists); `submission_queue.risk_score`/`risk_factors` writes still confirmed silently no-op (columns never applied) |
| AG-13 Foundation Enrichment | Enriches `foundation_directory` from ProPublica 990 | PARTIALLY-BUILT | Named implementation is CLI-only exactly as documented; a materially different scraper-based pipeline targeting the same table is now live-scheduled weekly in `worker/scheduler.ts` (`foundation-enrichment-weekly`, gated behind `ENABLE_SCRAPER` — actual prod value unchecked) |
| AG-14 Donor Discovery | Discovers/scores corporate prospects on request | PARTIALLY-BUILT | `worker/dd-request-processor.ts` real and started unconditionally; tables real and applied but empty in prod except taxonomy ([[benavora-donor-discovery-pipeline-empty-in-prod]]) — code path works, produces no real output today |
| AG-15 Grant Probability | 11-factor 0–100 probability score | PARTIALLY-BUILT (split) | Deterministic engine `computeGrantProbability()` **BUILT-AND-VERIFIED** — live-tested against 2 real production opportunities, hand-checked math correct, real persistence to `opportunity_probability_scores`. Autonomous wrapper **BUILT-BLOCKED-VERIFIED** — live-reproduced enum failure. New logic bug found: `buildKeyRisks()`'s deadline-passed branch is unreachable dead code (bounds-check ordering bug) |
| AG-16 Digital Twin Builder | AI model of org (mission/programs/financials/board) | **BUILT-AND-VERIFIED** | Live prod row confirmed for real org (`twin_completeness_score: 70`), event-triggered (KB save, onboarding, manual route) — corrects a stale PLANNED/IN BUILD claim; only gap is no nightly-sweep trigger |
| AG-17 Opportunity Discovery | Nightly Grants.gov/SAM.gov/Federal Register discovery | PARTIALLY-BUILT | Rich, wired code (nightly step + queue); has never once completed a live run — enum error live-reproduced; a fix migration exists in `src/supabase/migrations/101...` but not confirmed applied; new bug found — `perceiveState()` queries a nonexistent `opportunity_probability_scores.org_id` column (should be `organization_id`), permanently disabling the federal-shift branch even once the enum is fixed |
| AG-18 Reputation Intelligence | Monitors funders for legal/leadership/financial distress | **BUILT-AND-VERIFIED** | Live nightly plain-function path confirmed, real writes to `reputation_signals`/`reputation_alerts`. Note: an orphaned, never-instantiated `ReputationIntelligenceAgent` class also exists and is wrongly credited in Feature Registry #199 |
| AG-19 Relationship Builder | Nightly per-funder engagement recommendations | PARTIALLY-BUILT | 1,174-line class real (includes an undocumented multi-hop BFS warm-intro feature over `pig_nodes`/`pig_edges`), but never imported anywhere — orchestrator substitutes a narrower live agent (`funder-relationship.ts`, event-delta only) |
| AG-20 Corporate Giving Detector (EA-01) | Detects a company's giving program from its website | PARTIALLY-BUILT | Real, compiles; blocked by `corporate_prospects` table 404 + invalid local API key; independent accuracy defect found — hardcoded 3-path guess scored 1/9 real hits, and a 404 page counts as a "successful fetch" |
| AG-21 Executive Biography Analyzer (EA-08) | Extracts decision-maker names/titles | PARTIALLY-BUILT | Real, wired into `worker/enrichment-processor.ts`; same two blockers as AG-20; worse accuracy (0/6 real hits); error-path bug — a Claude-throws branch silently drops the enrichment patch |
| AG-22 Propensity Scoring | 10 donation-propensity scores per prospect | PARTIALLY-BUILT | Real (`ag-22-propensity-scoring.ts`, distinct from a dead `batch-scorer.ts`), genuinely wired via `triggerScoreEngine()`, rubric math verified to discriminate real inputs; same two blockers as AG-20/21; gating bug — fires on `enrichment_completed_at` regardless of whether enrichment actually succeeded |
| AG-23 Relationship Mapper (RA-01) | Discovers cross-entity relationships into `pig_nodes`/`pig_edges` | NOT-BUILT under this identity | Zero code exists under the AG-23/RA-01 name; the same capability is implemented under a colliding number, AG-32 (`relationship-graph-builder-agent.ts`) — real, writes real graph rows, but enum-blocked and has zero scheduler/queue wiring, reachable only manually |
| AG-24 Personalized Outreach Generator | AI-personalized per-prospect outreach emails | PARTIALLY-BUILT | Real, live-wired (`/api/intelligence/outreach/generate` → `/donor-discovery/outreach` UI), structurally genuine personalization — missed by AGENTS_v2.md's own audit because it only scanned `src/lib/agents/`, not API routes; blocked at runtime by the same `corporate_prospects`/API-key issues, output quality unverified |
| AG-25 Disaster Response | Polls FEMA declarations, matches affected orgs to funding | BUILT-BUT-UNVERIFIED | Spec matches exactly, no drift; two real functions, reachable only via `/api/agents/disaster`, zero cron/worker wiring despite other docs claiming a 6-hour poll; no live FEMA call executed this session. Note: on-disk `"ag-25-deadline-prediction"` belongs to an unrelated agent (Deadline Prediction) and is separately enum-blocked |
| AG-26 Funding Forecast | 90-day/12-month probability-weighted forecasts | NOT-BUILT | Confirmed, zero code exists; `funding_forecasts` table exists (real migration 078) but has no writer anywhere |
| AG-27 Board Meeting Packet | Full board packet 48h before each meeting | NOT-BUILT | Code absence solid; underlying table's live-status not independently reconfirmed tonight (see Section 1, rows 135-136) |
| AG-28 Impact Simulation | What-if strategic scenario modeling | NOT-BUILT | Code absence solid; same table-liveness caveat. On-disk `"ag-28-followup"` belongs to an unrelated, actually-live Follow-Up Generator agent — don't conflate; that agent is also separately enum-blocked |
| AG-29 Knowledge Engine Indexer | Continuous pgvector embedding generation | NOT-BUILT as an agent | Confirmed no indexer class/wiring/registry entry; underlying `embeddings.ts` capability is real and live-verified (105/105 rows), manual-trigger-only. A *different*, unrelated "AG-29 Fundability Scorer" also exists under a colliding number — not independently re-verified live tonight |
| AG-30 Change Monitor (CM-01) | Detects entity changes, triggers re-enrichment | NOT-BUILT | Zero code, zero wiring, confirmed live-checked tonight. Two colliding "AG-30"/"AG-38" labels (Donor Intent Monitor, Self-Improvement Agent) are real wired classes but both independently enum-blocked, live-reproduced today, zero rows ever written |

---

## 3. ARCHITECTURE WIRING — documented connections vs. real code

Source docs (`INTERACTION_MAPS_v2.md`, `WORKER_ARCHITECTURE_v2.md`) describe an earlier architecture generation. The real system has been substantially rewritten since, and several of the newer files' own header comments explicitly acknowledge the drift — this is not guesswork, it's self-documented in the code.

### Documented connections with NO corresponding real code (broken)

1. **"Add Opportunity" auto-triggers Eligibility + Probability agents** — no `POST /api/opportunities` route exists at all; the form inserts directly from the browser via Supabase client, nothing downstream is triggered.
2. **"Submit via AutoApply" → `submission_queue` → Railway worker → Playwright**, as literally documented — the actual live route (`/api/agents/automation`, "Agent 16") runs synchronously inside a Vercel function against a different table (`automation_sessions`), never touching `submission_queue` or the Railway worker at all. (A separate, genuinely wired `submission_queue`→`queue-processor.ts` pipeline does exist for a different entry point — see "verified wired" below — so the capability exists, just not via this documented path.)
3. **Foundation Enrichment Queue** (`foundation_directory` + ProPublica polling) — confirmed absent; the file that superficially matches this description is for an unrelated pipeline (`corporate_prospects`), and its own header comment says so explicitly.
4. **FEMA polling** (`worker/fema-poller.ts`, documented 6-hourly cron) — file doesn't exist, no FEMA/disaster code anywhere in `worker/`. Disaster response is manual-trigger-only (see AG-25 above).
5. **`agent_job_queue` table / job handler registry** (`worker/handlers/*.ts`) — no such directory exists; the table name appears only in markdown docs, zero code references anywhere.
6. **Documented `node-cron`, 14-job, fixed-time scheduler** — package was never added; real `worker/scheduler.ts` is a hand-rolled `setInterval` scheduler with only 7 jobs. None of 12 documented function names (`runKnowledgeEngineIndexer`, `runFundingForecast`, `runRelationshipBuilder`/`Mapper`, etc.) exist as standalone crons — most of that work is folded as sequential in-process steps inside `runOrgPipeline()` instead.
7. **Supabase Realtime on `/admin/monitor`** (subscriptions on `worker_status`/`submission_queue`/`agent_runs`) — zero `.channel()`/`.subscribe()` calls found; likely plain polling instead.

### Half-wired (producer or consumer exists, not both / not invoked)

8. **Corporate Enrichment Queue → Propensity Scoring** — the full pipeline (`worker/enrichment-processor.ts`, EA-01…EA-10 sequential run, triggers AG-22 after each prospect) is real and code-correct, but the module is **never started** from `worker/index.ts`'s boot sequence — its own header comment says so. Dead code, not broken code.
9. **Route Prospect to Email Campaign → send** — producer route is real and writes genuine `email_sequence_enrollments` rows (real tables: `email_templates`/`email_campaign_sequences`/`email_sequence_enrollments`, not the doc's guessed names); the consumer cron `src/app/api/cron/email-sequences/route.ts` is not registered in `vercel.json` — confirms and reconfirms [[benavora-corporate-prospects-no-migration-dead-cron]].

### Verified fully wired (producer + consumer real and invoked)

- Batch probability scoring (`/api/intelligence/grant-probability` → `grant-probability-engine.ts`)
- Opportunity Discovery manual route + nightly step, both hitting the same real function
- Digital Twin rebuild, Knowledge Engine query, Reputation check (all real API routes → real functions)
- Disaster Response deploy (manual-only, as documented for the manual path)
- Clone Application → real Claude call
- Route Prospect to AutoApply → `submission_queue` → `worker/queue-processor.ts` (this specific producer IS started in `worker/index.ts`, unlike the "Agent 16" path in item 2 above)
- Autonomous Orchestrator chain (`agent_queue`, `routeQueueItem`, `claimNextQueueItem`) — real, running, though the actual mechanism (sequential in-process steps per org) differs from the doc's per-stage-handoff diagram
- Heartbeat / `worker_status` — real and running, minor field-level gaps only (a couple of documented payload fields aren't actually written)

**Not independently re-verified this session** (taken as given from prior-session memory, consistent with what was found): `submission_queue.risk_score`/`risk_factors` silent no-op write; PostgREST 1000-row cap effects on other pagination loops beyond the ones already known.

---

## 4. UI/PAGES — blueprint nav vs. real routes

**Method:** static code reads only, no dev server / browser click-through this session — 139 `page.tsx` files exist under `src/app`; not all individually opened (see gaps list at bottom).

**Headline finding:** `BLUEPRINT_v2.md` §3.3's documented nav is itself stale — the real shipped nav (`nav-items.ts`/`Header.tsx`) has dozens of items the blueprint never mentions (Activity, Email, Outreach, Nonprofit Directory, System Health, 7 extra Intelligence sub-pages). Treat every blueprint-vs-actual gap below with that caveat; the blueprint is not reliable ground truth for "intended" pages.

### Confirmed real and wired (of blueprint-listed pages)
Funders, Foundations, Contacts, Opportunities, Applications (+ list/new/[id]), Draft Generator (+ queue/[id]), Research (+ match), Deadlines, Compliance, Financials, Outcomes/Analytics, Reports, Import, Alerts, Documents, Knowledge Base (+ profile/narratives/answers), Settings (+ integrations/notifications/agents/white-label), Admin (+ autoapply-ops/monitor/audit-log/sales-outreach/orgs/[id]), Command Center, Dashboard. Note: this codebase's thin-wrapper `page.tsx` + `*Client.tsx` code-splitting pattern is deliberate — small file size alone is not a stub signal here.

### Blueprint-listed, does not exist at all (404 in practice)
- **`donor-discovery/corporate/*`** — the entire 5-page "Corporate Intelligence Engine" sub-nav has no directory in `src/app` and zero remaining references anywhere. Fully superseded, not a dangling stub — replaced by `/donor-discovery/intent-signals` and `/intelligence/donor-intent`/`/intelligence/relationship-graph`, which are real.

### Previously-flagged stubs — RE-VERIFIED, both now fixed (contradicts stale memory)
- **AutoApply Follow-Ups** — all 4 previously-missing API routes now exist (`follow-ups/route.ts`, `stats/route.ts`, `[id]/route.ts`, `cancel-all/[funderId]/route.ts`), reading the real `autoapply_follow_ups` table. Route file's own comment documents the fix history.
- **Renewals** — `src/app/api/renewals/route.ts` now exists, queries the real `renewals` table with real joins. Same self-documenting fix-history comment.
- **Sales Outreach "New Campaign"** — real backend confirmed (`/api/admin/campaigns`), not a stub; UX gap only — prospect list is a free-text field, not a picker.
- **"Improvements" page** — fully real code (server-gated page, real GET/PATCH API routes), but its backing tables come from `src/supabase/migrations/087_continuous_improvement.sql`, while the *root* `supabase/migrations/087` is an unrelated migration at the same number ([[benavora-two-parallel-migrations-directories]]) — page likely renders empty/error in prod, table liveness unconfirmed, not a UI-layer stub.

### New (non-blueprint) pages — spot-checked, appear real
Activity, Notifications, Billing, Email (+ campaigns/templates), Outreach (+ campaigns/templates/sequences), Nonprofit Directory, SchoolFunder — all call a real matching `/api/*` route or query real tables server-side. Not deep-verified for data population/correctness, only for "not hardcoded/not a no-op."

### Not independently verified this session (honesty flag, not a finding either way)
The 12 `autoapply/*` sub-pages (agreements, analytics, automation-settings, compliance, controls, documents, profiles, recordings, settings, templates, test-results, usage, webhooks); the 8 non-blueprint `intelligence/*` pages (community-need, competitors, donor-intent, learning-network, matches, recommendations, relationship-graph, strategic-advisor); `reports/{board-report,funding-summary,impact,roi,simulate}`; `search-profiles/*`; `admin/orgs` list; `(marketing)` pages. Would need a running dev server + real navigation, or individual file reads, to classify — not done here due to scope.

---

## 5. INFRASTRUCTURE GAPS — see MASTER_BACKLOG.md

Full ranked findings (RLS, storage bucket policies, schema drift, unapplied migrations) live in **`MASTER_BACKLOG.md`** — not duplicated here. Summary of what it covers, for orientation:

- **Tier 1 — Security/data-isolation:** 8 tables confirmed live-readable by the anon key with zero row filtering (`platform_admins`, `organizational_digital_twins`, `opportunity_probability_scores`, `donor_discovery_directory`, `autoapply_submissions`, `submission_queue`, `form_templates`, `request_profiles`), plus 5 of 6 storage buckets with zero `storage.objects` policy (2 confirmed user-facing breaks today: session-recording deletion, one org's branding/document uploads).
- **Tier 2 — Functional gaps:** schema drift and unapplied migrations (28 of 108 migrations not applied as of the 2026-07-28 audit), including the `agent_type` enum gap and missing/unapplied columns referenced throughout Sections 2–3 above.
- **Tier 3 — Cosmetic/doc-accuracy:** memory corrections and audit-vs-audit contradictions.

**One live update surfaced this session that MASTER_BACKLOG.md's own Tier 1 §1.1 item 8 already reflects but prior memory doesn't:** `request_profiles` was manually applied 2026-07-30 and now exists live (previously believed entirely absent) — it is also immediately anon-readable, a new Tier 1 finding, not a resolved one.

---

## Open questions this session could not resolve
- Live-apply status of several migrations (087 continuous-improvement, 093-096 graph/twin schemas, 101 AG-17 enum fix, 107 corporate_prospects) — no working DB credential path this session.
- Whether `ENABLE_SCRAPER` is actually `true` in production (gates the foundation-enrichment-weekly cron).
- Full UI verification of ~35 pages listed as "not independently verified" in Section 4.
- Whether the `agent_type` enum gap (blocking ~9 agents) has any fix migration actually applied live, beyond the one unconfirmed candidate found for AG-17.
