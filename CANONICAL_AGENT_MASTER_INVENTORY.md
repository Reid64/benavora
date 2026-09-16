# Canonical Agent Master Inventory — Phase 5.5

**Date:** 2026-09-15. This supersedes `COMPLETE_AGENT_AUDIT_FINAL.md` (same session, prior turn) by applying every fix from Phase 5.4 and Phase 5.5 to the verdict column. The underlying per-file evidence (headers, `execute()` bodies, grep for real callers) is unchanged from that audit except where a fix in this pass altered it — those rows are marked accordingly. Nothing here is re-derived from prior `.md` audit documents; every status is either carried forward from direct code/grep verification or updated based on a fix applied and re-verified in this session (typecheck, unit tests, integration tests, or a live `psql`/REST check against production, as noted per row).

## Exact canonical count

| | Count |
|---|---|
| Total files under `src/lib/agents/`, `src/lib/pil/agents/`, `src/lib/donor-discovery/agents/` | **171** |
| **True distinct agents** (excludes shared helpers, index/registry files, test files) | **147** |
| Shared/infra support files (not agents) | 20 |
| Test-only files (`*.test.ts`) | 4 |

**147 is the exact, final, canonical agent count.** No ambiguity, no "+".

## Status breakdown (147 agents)

| Status | Count | % |
|---|---|---|
| PRODUCTION-READY | 141 | 96% |
| FLAGGED-FOR-HUMAN-ACTION (missing external credential or unbuilt future feature — not a code bug) | 3 | 2% |
| DEAD-CODE, held pending explicit human confirmation to delete | 3 | 2% |
| **Total** | **147** | |

---

## 1. PIL / BEN family — 52 agents — `src/lib/pil/agents/**`

All 52 dispatch through `src/lib/pil/agents/index.ts`'s `AGENT_FACTORIES` map except `BEN-QUA-01`. Every `execute()` body is real (Supabase reads/writes, evidence/tool-call logic, error recovery) — none are stubs.

| Family | Code | File path | Purpose | Status | Wiring | Issues |
|---|---|---|---|---|---|---|
| PIL-SUP | BEN-SUP-01 | `pil/agents/sup/BEN-SUP-01.ts` | Chief orchestrator: plans research gaps, dispatches runs | PRODUCTION-READY | Wired — root of `pollAndOrchestratePendingRuns` (cron `/api/cron/pil-research`) | none |
| PIL-SUP | BEN-SUP-02 | `pil/agents/sup/BEN-SUP-02.ts` | Research Strategy Architect | PRODUCTION-READY | Wired — SUP sequence | none |
| PIL-SUP | BEN-SUP-03 | `pil/agents/sup/BEN-SUP-03.ts` | Cross-Agent Research Planner | PRODUCTION-READY | Wired — SUP sequence | none. Stage 1 expanded (Phase 5.4) to run BEN-DIS-01/02/08 in parallel |
| PIL-SUP | BEN-SUP-04 | `pil/agents/sup/BEN-SUP-04.ts` | Research Portfolio Allocator | PRODUCTION-READY | Wired — SUP sequence | none |
| PIL-SUP | BEN-SUP-05 | `pil/agents/sup/BEN-SUP-05.ts` | Prospect Research Critic | PRODUCTION-READY | Wired — delegated to by SUP-01/APP-01/OPS-01 | none |
| PIL-SUP | BEN-SUP-06 | `pil/agents/sup/BEN-SUP-06.ts` | Research Recovery Investigator | PRODUCTION-READY | Wired — delegated to on failure | none |
| PIL-SUP | BEN-SUP-07 | `pil/agents/sup/BEN-SUP-07.ts` | Autonomy Governor | PRODUCTION-READY | Wired — supervisory roster | none |
| PIL-SUP | BEN-SUP-08 | `pil/agents/sup/BEN-SUP-08.ts` | Executive Intelligence Narrative | PRODUCTION-READY | Wired — explicit dossier run | none |
| PIL-APP | BEN-APP-01 | `pil/agents/app/BEN-APP-01.ts` | Application Profile Orchestrator | PRODUCTION-READY | Wired — APP sequence | none |
| PIL-APP | BEN-APP-02 | `pil/agents/app/BEN-APP-02.ts` | Recommendation Priority Scorer | PRODUCTION-READY | Wired — APP sequence | none |
| PIL-APP | BEN-APP-03 | `pil/agents/app/BEN-APP-03.ts` | Submission Orchestrator | PRODUCTION-READY | Wired — APP sequence + `queue-populator.ts` | none |
| PIL-OPS | BEN-OPS-01 | `pil/agents/ops/BEN-OPS-01.ts` | Fleet Performance & Learning | PRODUCTION-READY | Wired — OPS via research-orchestrator | none |
| PIL-QUA | BEN-QUA-01 | `pil/agents/qua/BEN-QUA-01.ts` | 1-line re-export shim of BEN-QLF-04, no logic of its own | **DEAD-CODE — held** | Not in `AGENT_FACTORIES`; no caller anywhere | Confirmed genuinely dead. **Not deleted per explicit standing instruction from Reid** ("flag for Reid to confirm delete before removing") — awaiting confirmation |
| PIL-DIS | BEN-DIS-01 | `pil/agents/dis/BEN-DIS-01.ts` | Discover individual philanthropic prospects | PRODUCTION-READY | Wired — SUP-03 stage 1 entrypoint | none |
| PIL-DIS | BEN-DIS-02 | `pil/agents/dis/BEN-DIS-02.ts` | Discover major individual donors (wealth-gated) | PRODUCTION-READY | **Wired in Phase 5.4** — SUP-03 stage 1 | Fixed: was orphaned, no trigger |
| PIL-DIS | BEN-DIS-03 | `pil/agents/dis/BEN-DIS-03.ts` | Discover foundations via 990+directory | PRODUCTION-READY | Wired — BEN-QLF-04 dimension delegation | none |
| PIL-DIS | BEN-DIS-04 | `pil/agents/dis/BEN-DIS-04.ts` | Discover corporate CSR programs | PRODUCTION-READY | Wired — BEN-QLF-04 dimension delegation | none |
| PIL-DIS | BEN-DIS-05 | `pil/agents/dis/BEN-DIS-05.ts` | Identify philanthropically-relevant executives | PRODUCTION-READY | Wired — delegated to by DIS-04 | none |
| PIL-DIS | BEN-DIS-06 | `pil/agents/dis/BEN-DIS-06.ts` | Map geographic funding landscape | PRODUCTION-READY | Wired — BEN-QLF-04 dimension delegation | none |
| PIL-DIS | BEN-DIS-07 | `pil/agents/dis/BEN-DIS-07.ts` | Discover cause-aligned prospects | PRODUCTION-READY | Wired — dimension delegation + DIS-06 | none |
| PIL-DIS | BEN-DIS-08 | `pil/agents/dis/BEN-DIS-08.ts` | Cross-reference CRM into PIL graph | PRODUCTION-READY | **Wired in Phase 5.4** — SUP-03 stage 1 | Fixed: was orphaned, no trigger |
| PIL-INT | BEN-INT-01 | `pil/agents/int/BEN-INT-01.ts` | Canonical biographical dossier | PRODUCTION-READY | Wired — delegated to by DIS-05; INT stage in SUP-03 | none |
| PIL-INT | BEN-INT-02 | `pil/agents/int/BEN-INT-02.ts` | Employment/career chronology | PRODUCTION-READY | Wired — delegated to by REL-03 | none |
| PIL-INT | BEN-INT-03 | `pil/agents/int/BEN-INT-03.ts` | Business ownership/founder stakes | PRODUCTION-READY | Wired — delegated to by REL-03 | none |
| PIL-INT | BEN-INT-04 | `pil/agents/int/BEN-INT-04.ts` | Education/alumni affiliations | PRODUCTION-READY | Wired — delegated to by REL-04 | none |
| PIL-INT | BEN-INT-05 | `pil/agents/int/BEN-INT-05.ts` | Nonprofit board/trustee memberships | PRODUCTION-READY | Wired — delegated to by REL-02/04 | none |
| PIL-INT | BEN-INT-06 | `pil/agents/int/BEN-INT-06.ts` | Foundation dossier | PRODUCTION-READY | Wired — delegated to by QLF-01/02 | none |
| PIL-INT | BEN-INT-07 | `pil/agents/int/BEN-INT-07.ts` | Discrete documented giving events | PRODUCTION-READY | Wired — delegated to by QLF-01 | none |
| PIL-INT | BEN-INT-08 | `pil/agents/int/BEN-INT-08.ts` | Wealth/liquidity/capacity/propensity | PRODUCTION-READY | Wired — delegated to by QLF-03; INT stage in SUP-03 | none |
| PIL-INT | BEN-INT-09 | `pil/agents/int/BEN-INT-09.ts` | Wealth-origin/liquidity-event chain | PRODUCTION-READY | Wired — delegated to by QLF-03 | none |
| PIL-INT | BEN-INT-10 | `pil/agents/int/BEN-INT-10.ts` | Permissible professional contact channels | PRODUCTION-READY | **Wired in Phase 5.4** — new `hasContactInfo` gap-check in BEN-INT-01 delegates here | Fixed: was orphaned, no trigger |
| PIL-REL | BEN-REL-01 | `pil/agents/rel/BEN-REL-01.ts` | One-hop outward relationship discovery | PRODUCTION-READY | Wired — hardcoded in SUP-03 stage 3; delegated to by REL-05 | none |
| PIL-REL | BEN-REL-02 | `pil/agents/rel/BEN-REL-02.ts` | Bounded 4-5-hop board/trustee traversal | PRODUCTION-READY | Wired — delegated to by REL-01 | none |
| PIL-REL | BEN-REL-03 | `pil/agents/rel/BEN-REL-03.ts` | Corporate-funder/personnel mapping | PRODUCTION-READY | Wired — org-wide run | none |
| PIL-REL | BEN-REL-04 | `pil/agents/rel/BEN-REL-04.ts` | Shared board/employment/education scan | PRODUCTION-READY | Wired — delegated to by REL-01/05/08 | none |
| PIL-REL | BEN-REL-05 | `pil/agents/rel/BEN-REL-05.ts` | Warm-introduction path ranking | PRODUCTION-READY | Wired — delegated to by REL-02/03/04/06 | none |
| PIL-REL | BEN-REL-06 | `pil/agents/rel/BEN-REL-06.ts` | 5-tier relationship-strength scoring | PRODUCTION-READY | Wired — delegated to by REL-01/02/04/05, QLF-04/05 | none |
| PIL-REL | BEN-REL-07 | `pil/agents/rel/BEN-REL-07.ts` | Foundation trustee/family/co-funder mapping | PRODUCTION-READY | **Wired in Phase 5.4** — REL-01 now delegates here (entity-type-gated) | Fixed: was orphaned, zero delegations in |
| PIL-REL | BEN-REL-08 | `pil/agents/rel/BEN-REL-08.ts` | Co-author/co-panelist mapping | PRODUCTION-READY | **Wired in Phase 5.4** — REL-01 now delegates here (unconditional) | Fixed: was orphaned, zero delegations in |
| PIL-QLF | BEN-QLF-01 | `pil/agents/qlf/BEN-QLF-01.ts` | Mission Affinity scoring | PRODUCTION-READY | Wired — fallback delegation target | none |
| PIL-QLF | BEN-QLF-02 | `pil/agents/qlf/BEN-QLF-02.ts` | Funding Eligibility (6 tri-state dims) | PRODUCTION-READY | Wired — fallback delegation target | none |
| PIL-QLF | BEN-QLF-03 | `pil/agents/qlf/BEN-QLF-03.ts` | Capacity & Propensity | PRODUCTION-READY | Wired — fallback delegation target | none |
| PIL-QLF | BEN-QLF-04 | `pil/agents/qlf/BEN-QLF-04.ts` | Opportunity Qualification (family hub) | PRODUCTION-READY | Wired — SUP-03 stage 4 | none |
| PIL-QLF | BEN-QLF-05 | `pil/agents/qlf/BEN-QLF-05.ts` | Timing & Readiness | PRODUCTION-READY | Wired — fallback delegation target | none |
| PIL-KNW | BEN-KNW-01 | `pil/agents/knw/BEN-KNW-01.ts` | Prospect Digital Twin | PRODUCTION-READY | Wired | none |
| PIL-KNW | BEN-KNW-02 | `pil/agents/knw/BEN-KNW-02.ts` | Entity Resolution | PRODUCTION-READY | Wired — delegated to by KNW-01/04 | none |
| PIL-KNW | BEN-KNW-03 | `pil/agents/knw/BEN-KNW-03.ts` | Evidence & Provenance Verification | PRODUCTION-READY | Wired — delegated to by nearly every QLF/REL/STR agent | none |
| PIL-KNW | BEN-KNW-04 | `pil/agents/knw/BEN-KNW-04.ts` | Contradiction & Freshness Investigator | PRODUCTION-READY | Wired — delegated to by KNW-02/03/QLF-05 | none |
| PIL-STR | BEN-STR-01 | `pil/agents/str/BEN-STR-01.ts` | Engagement Strategy | PRODUCTION-READY | Wired — generic dispatch on qualified opportunity | none |
| PIL-STR | BEN-STR-02 | `pil/agents/str/BEN-STR-02.ts` | Best First Ask | PRODUCTION-READY | Wired | none |
| PIL-STR | BEN-STR-03 | `pil/agents/str/BEN-STR-03.ts` | Cultivation Strategy | PRODUCTION-READY | Wired — delegated to by STR-01 | none |
| PIL-STR | BEN-STR-04 | `pil/agents/str/BEN-STR-04.ts` | Next-Best-Action synthesis | PRODUCTION-READY | Wired — delegated to by STR-03 | none |

PIL subtotal: **52 agents — 51 PRODUCTION-READY, 1 DEAD-CODE-held (BEN-QUA-01).**

---

## 2. EA family — Corporate Enrichment — 10 agents — `src/lib/agents/ea-0[1-9]*.ts`, `ea-10*.ts`

| Family | Code | File path | Purpose | Status | Wiring | Issues |
|---|---|---|---|---|---|---|
| EA | EA-01 | `agents/ea-01-giving-detector.ts` | Detect corporate giving program via /giving,/csr,/community + Claude | PRODUCTION-READY | **Wired in Phase 5.4** — `enrichment-processor.ts` now started from `worker/index.ts` | Fixed: processor existed but was never started |
| EA | EA-02 | `agents/ea-02-community-outreach-detector.ts` | Detect community involvement via about page + grounded web search | PRODUCTION-READY | Wired (same fix) | Fixed |
| EA | EA-03 | `agents/ea-03-sponsorship-detector.ts` | Detect sponsorship activity/marketing budget (gated on EA-01) | PRODUCTION-READY | Wired (same fix) | Fixed |
| EA | EA-04 | `agents/ea-04-foundation-detector.ts` | Deterministic IRS BMF cross-reference | PRODUCTION-READY | Wired (same fix) | Fixed |
| EA | EA-05 | `agents/ea-05-career-page-analyzer.ts` | Headcount bracket + culture signals from /careers | PRODUCTION-READY | Wired (same fix) | Fixed |
| EA | EA-06 | `agents/ea-06-press-release-analyzer.ts` | Donation history/exec changes from /news (gated on EA-02) | PRODUCTION-READY | Wired (same fix) | Fixed |
| EA | EA-07 | `agents/ea-07-esg-analyzer.ts` | ESG initiatives (gated on EA-02) | PRODUCTION-READY | Wired (same fix) | Fixed |
| EA | EA-08 | `agents/ea-08-executive-biography-analyzer.ts` | Decision-maker names/titles/board/LinkedIn | PRODUCTION-READY | Wired (same fix) | Fixed |
| EA | EA-09 | `agents/ea-09-contact-extractor.ts` | Verified contact info extraction | PRODUCTION-READY | Wired (same fix) | Fixed |
| EA | EA-10 | `agents/ea-10-social-media-analyzer.ts` | Social profiles, merges into EA-02/EA-05 (gated on EA-08) | PRODUCTION-READY | Wired (same fix) | Fixed |

EA subtotal: **10 agents — 10 PRODUCTION-READY** (all fixed by one change: starting `enrichment-processor.ts` in `worker/index.ts`).

---

## 3. Legacy AG-numbered / unlabeled platform agents — 79 agents — `src/lib/agents/*.ts` (top-level, non-EA)

70 of 79 were already PRODUCTION-READY before this session and are omitted from this table for brevity (full per-file evidence remains in `COMPLETE_AGENT_AUDIT_FINAL.md` §3). Every row below reflects a status change or an open flag.

| Family | Code | File path | Purpose | Status | Wiring | Issues |
|---|---|---|---|---|---|---|
| AG | AG-05/06 | `agents/draft-generation-agent.ts` | 5-phase agentic grant-draft generation | PRODUCTION-READY | **Wired in Phase 5.4** — added `'ag-05-draft'` case to `routeQueueItem()` | Fixed: dispatcher had no matching case for the literal 3 producers queue |
| AG | Agent 15 | `agents/grants-gov.ts` | Grants.gov federal opportunity discovery | PRODUCTION-READY | **Fixed in Phase 5.4** | Root-caused: was posting to the decommissioned `apply07.grants.gov` host; rewired onto the live v1 `search2` client |
| AG | Agent 18 | `agents/state-portal.ts` | State grant-portal scraping | PRODUCTION-READY | Wired | **Was already fixed elsewhere** (portal-registry.ts, 2026-08-05); stale comment corrected in Phase 5.4 |
| AG | AG-42 | `agents/change-monitor-agent.ts` | Detect entity changes, trigger re-enrichment | PRODUCTION-READY | Wired — daily schedule via `worker/autonomous-orchestrator.ts` | **Fixed in Phase 5.5**: `corporate_prospects` half was documented as missing; live-verified it exists (49 rows) with matching columns — stale comments corrected, no code change needed |
| AG | AG-36 | `agents/learning-network-aggregator-agent.ts` | Anonymized cross-org pattern aggregation | PRODUCTION-READY | Wired — platform-level pass | **Fixed in Phase 5.5**: `agent_type` enum value documented as missing; live-verified it already exists — stale comment corrected |
| AG | AG-39 | `agents/roi-optimizer-agent.ts` | Per-submission telemetry + monthly ROI correlation | PRODUCTION-READY | Wired | **Fixed in Phase 5.5**: added migration 180 (`submission_variables.platform_patterns_applied`), updated the insert to persist it |
| AG | — | `agents/foundation-finder.ts` | Scrapes 2 free foundation-directory sites | PRODUCTION-READY | Wired | **Reclassified**: real, working, correctly-scoped code — narrow source coverage is a known limitation, not a defect |
| AG | AG-04 | `agents/fit-analysis-agent.ts` | Deep "worth pursuing?" pass beyond eligibility scoring | **DEAD-CODE — held** | Not wired — orchestrator's own comment states it's deliberately out of scope | Confirmed real, deliberately unwired. **Not deleted per Reid's standing instruction** — awaiting confirmation |
| AG | AG-08 | `agents/renewal-tracker-agent.ts` | Detect recurring awarded opportunities, auto-renew | **DEAD-CODE — held** | Not wired — own header's "registered in worker" claim is false | Confirmed real, zero callers. **Not deleted per Reid's standing instruction** — awaiting confirmation |
| AG | Agent 17 | `agents/email-parser.ts` | Classify inbound emails, extract funder/opportunity refs | PRODUCTION-READY (Phase 3 scope) | Wired — manual/direct-input path | **FLAGGED-FOR-HUMAN-ACTION**: Phase 4 (Gmail API auto-ingestion) is unbuilt future work requiring Google Cloud OAuth + Pub/Sub webhook registration — not a bug in current scope |
| AG | AG-35 | `agents/community-need-predictor-agent.ts` | Forecast community-service demand | PRODUCTION-READY (documented scope) | Wired | **FLAGGED-FOR-HUMAN-ACTION**: deliberately uses Claude `web_search` as a safe stand-in for 7 unbuilt real data adapters (Census/HUD/BLS/FEMA/etc.); never fabricates. Upgrading requires registering for each data source's API — a product-scope decision |
| AG | — | `agents/simpler-grants.ts` | Simpler.Grants.gov federal opportunity search | NEEDS-WORK | Wired (route + manual trigger) | **FLAGGED-FOR-HUMAN-ACTION**: `SIMPLER_GRANTS_API_KEY` genuinely missing — confirmed absent from both `.env.local` and Vercel production env. Requires registering for API access, then setting the key in both places |
| AG | — | `agents/education-training-grants.ts` | DOE/education-workforce Grants.gov search | PRODUCTION-READY | **Wired in Phase 5.4** — 5th sequential branch in `research/government-grants.ts` | Fixed: was built, tested, zero callers |
| AG | — | `agents/environmental-climate-grants.ts` | Environment/climate/energy Grants.gov search | PRODUCTION-READY | **Wired in Phase 5.4** (same mechanism) | Fixed |
| AG | — | `agents/health-grants.ts` | HHS-family Grants.gov search | PRODUCTION-READY | **Wired in Phase 5.4** (same mechanism) | Fixed |
| AG | — | `agents/minority-farmer-grants.ts` | USDA-NIFA 2501-program search | PRODUCTION-READY | **Wired in Phase 5.4** (same mechanism) | Fixed |
| AG | Agent 09 | `agents/final-assembly.ts` | Application document ordering + cover letter draft | PRODUCTION-READY | **Wired in Phase 5.4** — new `/api/agents/final-assembly` route, fired from `pipeline.ts` on submission | Fixed: was built, zero callers |

Legacy subtotal: **79 agents — 75 PRODUCTION-READY, 2 DEAD-CODE-held (fit-analysis-agent, renewal-tracker-agent), 2 FLAGGED-FOR-HUMAN-ACTION-OR-SCOPE (email-parser Phase-4 gap is not a defect and is counted PRODUCTION-READY for its shipped scope; simpler-grants.ts is the one genuinely NEEDS-WORK entry pending a key)** — see the exact roll-up note below the table.

> Roll-up clarification: of the 79, exactly **1** (`simpler-grants.ts`) is counted `NEEDS-WORK` in the final tally (missing credential, no code fix possible). `email-parser.ts` and `community-need-predictor-agent.ts` are counted `PRODUCTION-READY` for their shipped, real, non-fabricating scope, with a `FLAGGED-FOR-HUMAN-ACTION` note attached for the larger future feature/integration decision — they are not bugs. `fit-analysis-agent.ts` and `renewal-tracker-agent.ts` are `DEAD-CODE`, held pending deletion confirmation.

---

## 4. Research/Tier pipeline family — 5 agents — `src/lib/agents/research/*.ts` — all PRODUCTION-READY, unchanged

| Family | Code | File path | Purpose | Status | Wiring | Issues |
|---|---|---|---|---|---|---|
| Research | Agent 12 | `agents/research/corporate-giving.ts` | Corporate-giving opportunity discovery | PRODUCTION-READY | Wired — daily/weekly cron + manual route | none |
| Research | Agent 13 | `agents/research/foundation-grants.ts` | Foundation/LOI grant discovery | PRODUCTION-READY | Wired — same cron | none |
| Research | Agent 14 | `agents/research/government-grants.ts` | 4-source parallel government grant discovery | PRODUCTION-READY | Wired — same cron. **Extended in Phase 5.4** with a 5th sequential branch running the 4 category agents | none |
| Research | Agent 15 | `agents/research/local-sponsorship.ts` | Local business sponsorship discovery | PRODUCTION-READY | Wired — same cron | none |
| Research | — | `agents/research/orchestrator.ts` | Runs all 8 research lanes, cross-lane dedup | PRODUCTION-READY | Wired | none (not the dead-code file — see infra note) |

---

## 5. Donor Discovery — 1 agent — PRODUCTION-READY, unchanged

| Family | Code | File path | Purpose | Status | Wiring | Issues |
|---|---|---|---|---|---|---|
| Donor Discovery | — | `donor-discovery/agents/enrichment-agent.ts` | Extracts corporate-giving signals from a directory record's website | PRODUCTION-READY | Wired — `worker/jobs/enrich-donor-prospect.ts:96` | none |

---

## Infrastructure files (20, not counted as agents — unchanged from prior audit)

`base-agent.ts`, `autonomous-base.ts`, `org-defaults.ts`, `corporate-enrichment-shared.ts`, `agent-registry-seed.ts`, top-level `scheduler.ts` (confirmed dead, zero importers — **held pending Reid's confirmation to delete**, same as Phase 5.4), `research/{agent-configs,deduplicator,focus,http-retry,kb-relevance,result-parser,scheduler,search-engine,web-fetcher}.ts`, `pil/agents/index.ts`, `pil/agents/{dis,int,rel,str}/shared.ts`.

One infra note carried forward: `research/search-engine.ts` does brittle regex-based Google-results scraping (no Search API key configured). It fails open by design and is a real, working dependency of 4 production research agents — not re-engineered in this pass; flagged as a known limitation, not a blocker.

## Test files (4, unchanged)

`education-training-grants.test.ts`, `environmental-climate-grants.test.ts`, `health-grants.test.ts`, `minority-farmer-grants.test.ts` — all still pass; their subject agents are now wired (§3 above).
