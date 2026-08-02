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
| 96 | Change Monitor (CM-01, canonical AG-30) | NOT-BUILT | Confirmed zero code exists anywhere for change-detection/re-enrichment trigger |
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
| 141 | Simulation Agent (AG-28, canonical Impact Simulation) | NOT-BUILT | Zero code found anywhere. Note: on-disk literal `"ag-28-followup"` belongs to a *different*, unrelated, actually-live Follow-Up Generator agent — don't conflate |
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

## 2. AGENTS — AG-01 through AG-30, verification-log authoritative

**Updated 2026-08-02, superseding the 2026-07-30 version below in full.** Since the original
compilation, the `agent_type` enum gap (the single biggest cross-cutting blocker in the prior
version of this section) was fixed live in production, live-re-verified for 6 agents, and two new
schema-drift bugs the fix exposed were found and fixed in the same pass — see
`AGENT_VERIFICATION_LOG.md`'s `agent_type` enum-gap entries (the three most recent entries in that
file) for full evidence. This section's original "no live database" scope-honesty caveat no longer
applies: a working direct Postgres connection (`DATABASE_URL`) now exists
(`STANDING_DIRECTIVES.md` DIRECTIVE-017) and was used for live schema checks and DDL throughout
today's work, alongside the same PostgREST/live-execution methods used previously. The dead local
`ANTHROPIC_API_KEY` and the missing `corporate_prospects` table are both still unresolved and still
apply exactly as before.

**Categorization (per this task's explicit scheme, superseding the old
BUILT-AND-VERIFIED/BUILT-BUT-UNVERIFIED/PARTIALLY-BUILT/NOT-BUILT key used through 2026-07-30):**
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
| AG-25 Disaster Response (canonical, manual API route) | Spec matches code exactly, no drift; two real functions. (Reachable only manually — see category 2 for the missing automatic cron.) |
| **AG-25's on-disk collision: Deadline Prediction Agent (`ag-25-deadline-prediction`)** | **Fixed and re-verified live 2026-08-02.** Enum gap closed; re-run completed cleanly, `itemsFound: 15`, zero errors. |
| AG-28's on-disk collision: Follow-Up Generator Agent (`ag-28-followup`) | Enum gap closed, re-verified 2026-08-02: completes via its documented no-op path when no `agent_queue` trigger is present. A full trigger-driven run (with a real applicationId payload) has not been exercised in this log yet. |
| AG-29's on-disk collision: Fundability Scorer (`ag-29-fundability`) | Real, wired into `worker/autonomous-orchestrator.ts`. Not independently live-execution-tested in this log. |
| AG-29 canonical — underlying capability, not an agent | `src/lib/intelligence/embeddings.ts` is real and live-verified (105/105 `intelligence_proposal_sections` rows have genuine, non-placeholder 1536-dim embeddings) — but this is manually-triggered library code, not an autonomous agent. See category 4 for the agent itself. |

### 2. BUILT BUT NOT WIRED

| Agent | Evidence |
|---|---|
| AG-02 Eligibility Scoring — Generation-2 rewrite (`eligibility-scoring-agent.ts`, `EligibilityScoringAgent`) | Real class, `agentId: "ag-02"` — enum value now fixed (2026-08-02), but never instantiated anywhere in the codebase. Dead code, not a blocked one. |
| AG-03 Deadline Extraction | Real, callable on-demand (a manual path exists) — but the specific documented behavior (automatically creating `deadlines` rows on new-opportunity creation) has no code path triggering it. The intended default behavior is unwired even though the capability itself works when invoked. |
| AG-04 Fit Analysis — autonomous version | Coded, but never instantiated; the worker's own header comment calls wiring it "out of scope." Enum value now valid, doesn't change this. |
| AG-06 Draft Generator — "Twin-Powered" Generation-2 class | `FEATURE_REGISTRY_v2.md` row #110 credits this enhancement to a dead class; the class that's actually live is the plain-function path (category 1). |
| AG-18 Reputation Intelligence — `ReputationIntelligenceAgent` class | Real, full `agent_decisions` audit trail, richer than the live plain-function path — but appears nowhere outside its own file declaration. `agentId: "ag-18-reputation"` is **not** in the fixed-enum batch (confirmed absent from both migration trees) — still enum-blocked on top of being unwired. |
| **AG-19 Relationship Builder (actual production status)** | The real, 1,174-line class (includes an undocumented multi-hop BFS warm-intro feature over `pig_nodes`/`pig_edges`) works standalone — re-confirmed 2026-08-02 — but `worker/autonomous-orchestrator.ts` still substitutes a narrower, unrelated live agent (`funder-relationship.ts`, event-delta only) wherever "the relationship builder" is requested. Re-grepped 2026-08-02: `new RelationshipBuilderAgent` still appears nowhere outside its own file. |
| AG-23's real implementation, under a colliding number: AG-32 Relationship Graph Builder (`relationship-graph-builder-agent.ts`) | Real, writes real graph rows — but `agentId: "ag-32-relationship-graph"` was **not** part of the 2026-08-02 enum fix batch, so it remains enum-blocked in addition to having zero scheduler/queue wiring (reachable only manually). Two separate open issues, not one. |
| AG-25 canonical (Disaster Response) — automatic trigger | Reachable only via `/api/agents/disaster`; zero cron/worker wiring despite other docs claiming a 6-hour poll. |

### 3. BUILT BUT BLOCKED

| Agent | Blocked by |
|---|---|
| AG-14 Donor Discovery | `worker/dd-request-processor.ts` is real and starts unconditionally, but source tables are empty in production except taxonomy — the pipeline runs correctly and has nothing to act on. |
| AG-15 Grant Probability — autonomous wrapper (`ProbabilityScoringAgent`) | Enum gap fixed 2026-08-02, re-verified live: the run itself now completes (`status: completed`, real `agent_runs` row) with zero enum errors — but every per-opportunity scoring call fails on the pre-existing, still-dead local `ANTHROPIC_API_KEY` (401), so it scores 0 of 20 real candidates. Blocked by the API key, not the enum, as of today. |
| AG-20 Corporate Giving Detector (EA-01) | Missing `corporate_prospects` table (404) + invalid local Claude API key. Also has an independent accuracy defect (hardcoded 3-path guess scored 1/9 real hits; a 404 page counts as a "successful fetch"). |
| AG-21 Executive Biography Analyzer (EA-08) | Same two blockers as AG-20. Worse accuracy (0/6 real hits); a Claude-throws error path silently drops the enrichment patch. |
| AG-22 Propensity Scoring | Same two blockers as AG-20/21 (downstream in the same enrichment chain). Rubric math itself verified to discriminate real inputs — the blocker is upstream data, not this agent's own logic. |
| AG-24 Personalized Outreach Generator | Real, live-wired (`/api/intelligence/outreach/generate` → `/donor-discovery/outreach` UI) — blocked at runtime by the same `corporate_prospects`/API-key issues as AG-20/21/22. |
| **AG-30's real implementation: Donor Intent Monitor (`ag-30-donor-intent`)** | **Enum gap fixed 2026-08-02, and a second real bug fixed in the same pass** — `loadOrgProfile()` was querying a nonexistent `organizations.service_areas` column (fixed to the real `service_area`). Re-verified live: the run now completes cleanly instead of crashing — but produces zero real signals because `corporate_prospects` doesn't exist in production, the same table-missing blocker as AG-20/21/22/24. Reported as a clean, caught error rather than a crash — a real improvement, but still blocked. |

### 4. NOT BUILT AT ALL

| Agent | Spec depth in `AGENTS_v2.md` |
|---|---|
| AG-10 Grant DNA Analysis | Thin: purpose (1-2 sentences), type, tier gate, "real implementation: none found," Autonomous Mode entirely "not designed in code." Not build-ready as written. |
| AG-23 Relationship Mapper (RA-01), under this specific identity | Same thin template. (The real capability exists under AG-32 — category 2 above — not under this name.) |
| AG-26 Funding Forecast | Same thin template. Zero code confirmed by direct grep of `src/lib/agents/`; `funding_forecasts` table exists (migration 078) but has no writer anywhere in the repo. |
| AG-27 Board Meeting Packet | Same thin template. |
| AG-28 Impact Simulation, under this specific identity | Same thin template. (The on-disk `"ag-28-followup"` is a different, real, live agent — category 1 above — not this one.) |
| AG-29 Knowledge Engine Indexer, as an autonomous agent | Same thin template — no indexer class, no worker wiring, no registry entry. (The underlying embedding-generation capability is real — see category 1's note. The colliding `"ag-29-fundability"` is also a different, real agent — category 1.) |
| AG-30 Change Monitor (CM-01), under this specific identity | Same thin template. Zero code, zero wiring. (The on-disk `"ag-30-donor-intent"` is a different, real agent — category 3 above, not this one.) |

**Cross-reference finding for category 4, as requested:** all 7 NOT-BUILT canonical agents share the
exact same short template in `AGENTS_v2.md` — a one-to-two-sentence purpose statement, a type (AI/
Claude or embedding model), a tier gate, and an "Autonomous Mode" section that is entirely
placeholder text ("PLANNED," "not designed in code," "undetermined"). **None of the 7 have a
detailed, implementation-ready spec** — no designed trigger conditions, chain outputs, decision-log
shape, or data-flow beyond the one-line purpose. They are not "just an ID with nothing written"
either — each has a named purpose and tier gate — but real design work (trigger logic, data
contracts, chain wiring) would need to happen before any of these are buildable, not just
implementation.

**Cross-cutting system bug — now fixed for most of the agents it affected:** `agent_runs.agent_type`
is a strict Postgres enum. As of 2026-07-30, at least 15 real agent-ID literals used in code had
never been added to it, so every one of those agents failed at the very first `agent_runs` insert
(`22P02: invalid input value for enum agent_type`). **Fixed live in production 2026-08-01/02** — all
15 target literals confirmed present via the live PostgREST OpenAPI schema, and 6 of the affected
agents (AG-15's wrapper, AG-17, AG-19, AG-25's collision, AG-28's collision, AG-30's collision)
individually re-run live to confirm. **Two literals used by other real agents were NOT part of that
fix batch and remain enum-blocked today**: `ag-18-reputation` (the orphaned `ReputationIntelligenceAgent`
class) and `ag-32-relationship-graph` (the real AG-23/RA-01 capability). Don't assume "the enum gap
is fixed" applies platform-wide — it was fixed for the 15 specific literals in
`fix-agent-type-enum-gap.sql`, not universally.

Second cross-cutting issue, unchanged: `FEATURE_REGISTRY_v2.md` rows #197–212 label agents by their
on-disk Generation-2 literal, not by the canonical AG-XX taxonomy in `AGENTS_v2.md` — a documented
≥9-way numbering collision (`AGENTS_v2.md` §1.4).

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
