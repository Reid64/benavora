# STATE_OF_THE_BUILD.md
## BENAVORA -- Current Build Status (compacted 2026-08-24; full history superseded by this snapshot)

**Build/test gates (re-verified 2026-08-25, this session):** `pnpm tsc --noEmit` exits 0. `pnpm run build` exits 0. `npx vitest run` exits 0: 71 files passed + 1 skipped, 590 tests passed + 13 todo, 0 failed (was 65 files/569 tests as of the 2026-08-24 compaction; growth is the PIL-03 agent-batch test files added since). `.githooks/pre-push` runs build+vitest on every push (DIRECTIVE-021).

**Last production deploy (app code):** SHA `4957040`, deployment `dpl_6MxKyiY2jtK9DdtNaUQ4ckVq424b`, `https://www.benavora.com`, READY (Session 30, 2026-08-23). Includes WGR-099 Safari/WebKit fix and the `src/lib/knowledge/db.ts` rewrite (Supabase JS client instead of direct `pg.Pool`).

**Last production deploy (docs-only, no app code change):** SHA `dc8e18d`, deployment `dpl_HLEuUukURh8SQZNTcMvqsWVtdSUN`, `https://www.benavora.com`, READY (Session 31, 2026-08-23) -- Prospect Intelligence Layer design-spec docs only.

**Local commits beyond what this doc's session log covers:** `ec60e68`, `13394ac`, `1cf87d8`, `c6c9a0e`, `e112613`, `2bbbf71` (PIL-01 migration files + PIL-02 deferred-FK/types/db-wrapper/policy/cost/audit/sources/evidence services). `e112613` matches Session 32 below (migrations 150-161 applied directly to prod DB via Management API, not a Vercel deploy). `2bbbf71` (PIL-02) is not yet reflected in any session entry here -- status of whether it needs a fresh `vercel deploy --prod` is unconfirmed from these docs alone.

**Marketing site:** current and healthy. 23/23 marketing routes returned live HTTP 200 with non-empty titles against `https://www.benavora.com` (Session 27, 2026-08-23, `test-evidence/verification/final/smoke.json`). mkt-002 (20 MDX pages + catch-all route), mkt-003 (home page "Forest and paper" theme), and mkt-08/knw-003 (Benavora Assist public chatbot widget) are all built and live. The Assist chatbot **backend** is still broken in prod -- see WGR-174 below.

**Audit program:** PT-00 through PT-15 complete. `test-evidence/_register/WIRING_GAP_REGISTER.md` (173 rows, WGR-001..WGR-174) is the single source of truth for platform status; this file's WGR list below is a live-recomputed extract of that register (re-verified by direct read 2026-08-24), not the original 2026-08-20 audit-close snapshot. `test-evidence/pt-15/GO-NO-GO.md` recorded NO-GO at audit close (2026-08-20: 16 P0/66 P1/28 P2/8 P3 open); most P0s and many P1s have since been resolved by remediation sessions through 2026-08-23. Current live count: **3 open P0, 62 open P1** (below).

---

## PIL (Prospect Intelligence Layer) migration status -- current state

Design spec complete (`PROSPECT_INTELLIGENCE_SCHEMA.md`, `PROSPECT_INTELLIGENCE_AGENTS.md`, `PROSPECT_INTELLIGENCE_ARCHITECTURE.md`, repo root). PIL-01 (12 migration groups, files `150_pil_prospects.sql` .. `161_pil_monitoring.sql`) **applied live to production** 2026-08-23 via a Supabase Management API PAT (the Supabase MCP connector is scoped to an unrelated account and cannot see project `vbjplpquqxxfbpazyalt`; no working `DATABASE_URL` password was available). Live-verified: 31 `pil_*` tables exist matching the schema doc 1:1; `pil_agent_registry` has 44 rows matching the agent-contracts doc; all 12 versions recorded in `supabase_migrations.schema_migrations`.

**Not yet done:** the deferred-FK ALTERs the migration file headers call out (`created_by_agent_id`/`qualified_by_agent_id` -> `pil_agent_registry.agent_id`, `pil_prospect_classifications.evidence_id` -> `pil_evidence.id`), a `get_advisors` RLS/security review of the 31 new tables. Local commit `2bbbf71` ("PIL-02: deferred FKs, types, db wrapper, policy, cost, audit, sources, evidence services") exists but is not described in this doc's session log -- verify its actual DB/deploy state before assuming it's live.

**Note:** since a Management API PAT is now proven to reach this production project directly, it may also unblock WGR-174/WGR-166 (migration 147, previously blocked on DDL access) -- not yet attempted with this credential path.

**PIL-03 agent implementation (application code against the PIL-01 schema):** 36 `src/lib/pil/agents/**/BEN-*.ts` files exist, wired through `src/lib/pil/agents/index.ts`'s `AGENT_FACTORIES` map. 34 of these implement a real `pil_agent_registry` agent_id: all 6 Family 1 Supervisory agents (BEN-SUP-01..06) plus 2 built beyond the 44-agent registry (BEN-SUP-07/08, kept per an earlier session's explicit decision), all 8 Family 2 Discovery agents (BEN-DIS-01..08), all 10 Family 3 Core Prospect Intelligence agents (BEN-INT-01..10), all 6 Family 4 Relationship & Graph Intelligence agents (BEN-REL-01..06), 1 of 5 Family 5 Qualification agents (BEN-QLF-04 Opportunity Qualification), and 3 of 4 Family 7 Knowledge Integrity agents (BEN-KNW-01 Prospect Digital Twin, BEN-KNW-02 Entity Resolution, BEN-KNW-03 Evidence & Provenance Verification). **10 registry agents remain unimplemented:** BEN-QLF-01/02/03/05, all 4 Family 6 Strategy agents (BEN-STR-01..04), BEN-KNW-04 (Contradiction & Freshness Investigator), and BEN-OPS-01. Unimplemented agent_ids resolve through `NotImplementedAgent` (`agents/index.ts`), which records a graceful `pil_agent_runs` failure row rather than crashing the runner. Also added (prior session): `POST /api/pil/monitoring/subscribe` + `GET /api/pil/monitoring/events`, and a `ProspectOpportunity` TS interface for `pil_prospect_opportunities`. This session added a `ProspectDigitalTwin` TS interface for `pil_prospect_digital_twins` (migration 150 had no TS binding until now) alongside BEN-KNW-01. Several task-given agent numbers/names across this multi-session batch (`BEN-QUA-01`, `BEN-KNW-01` for entity resolution, `BEN-KNW-02` for evidence/provenance) did not match the registry -- each new agent file's header comment documents the reconciliation to the real agent_id and mission, the same pattern used by every prior PIL-03 batch (BEN-DIS/BEN-INT/BEN-REL). No `BEN-QUA` family exists in the registry (the Fleet Summary caps Qualification & Decision Intelligence at 5 agents, `BEN-QLF-01..05`) and this session's task-described "final qualification decision" mission is already covered verbatim by the already-implemented BEN-QLF-04 -- no file was created at the task's literal `src/lib/pil/agents/qua/BEN-QUA-01.ts` path since it would either exceed the 44-agent registry or duplicate BEN-QLF-04.

---

## Open P0 findings (3) -- one line each, full detail/evidence/repro in WIRING_GAP_REGISTER.md

- **WGR-023** (API/Middleware) -- `src/middleware.ts` has no explicit exemption list for `/api/cron/*`, `/api/sources/*`, `/api/webhooks/*`, `/api/admin/webhooks/*`; every such route only reaches its own CRON_SECRET/signature check because it happens to also require a session cookie today. Not an active exploit (over-broad, not under-protective) but real Vercel Cron/Stripe/Resend calls may not carry a session cookie in production -- automation/webhooks plausibly unreachable by their real callers. CONFIRMED-BROKEN.
- **WGR-074** (Auth/Admin) -- Admin impersonation's `impersonation_org_id` cookie is read by zero other call sites in the repo; "starting impersonation" does not itself restrict which org an owner can reach beyond the standard role gate (cookie lifetime is bounded to 1hr, but the scoping gap itself is unfixed). CONFIRMED-BROKEN.
- **WGR-167** (Autoapply/Infra) -- Manual browser-automation trigger (`POST /api/agents/automation`, `BrowserAutomationAgent`) is 100% non-functional in production: it launches its own Playwright Chromium instance inside the Vercel serverless function, which has no Chromium binary installed. Every session fails at first browser action. Does NOT affect the separate, working Railway `worker/queue-processor.ts` AutoApply pipeline. CONFIRMED-BROKEN.

## Open P1 findings (62) -- one line each, full detail/evidence/repro in WIRING_GAP_REGISTER.md

- **WGR-002** -- `VERCEL_TOKEN`/`VERCEL_PROJECT_ID` (DIRECTIVE-019 deploy-verifier prereqs) absent from local `.env.local`. Known, documented gap.
- **WGR-005** -- `GET /api/agents/discovery` 500s ("Failed to load discovery matches") on an authenticated no-param request; not consumed by any found dashboard page.
- **WGR-006** -- `GET /api/consultant/clients` 500s ("Failed to load client access grants"); backs `/settings/...` consultant-access UI.
- **WGR-007** -- `GET /api/outreach/sequences` 500s ("Failed to load follow-up sequences", db_error).
- **WGR-008** -- `GET /api/schoolfunder` 500s ("Failed to load students"); backs the standalone Faith Foundation school-funder feature.
- **WGR-009** -- `GET /api/settings/notifications` 500s ("Failed to load notification preferences", db_error).
- **WGR-027** -- `POST /api/email/templates` unconditionally 500s for every request/org/role -- route selects columns that don't match the live table shape.
- **WGR-033** -- `worker/enrichment-processor.ts` (EA-01..EA-10 corporate-enrichment pipeline + AG-22 PropensityScoringAgent) is a complete real processor that is never registered/started anywhere.
- **WGR-035** -- `/api/cron/draft-automation` (DraftQueueEngine + DraftAutoGenerator daily cron) is registered nowhere -- not in `vercel.json`, no other trigger.
- **WGR-036** -- `SalesCampaignEngine.processQueuedSends()`, the only code path that sends queued `sales_sends` rows, has no cron/trigger wiring it to actually run.
- **WGR-037** -- Two-layer gap in the AutoApply 14/30/60-day donation follow-up email system (`autoapply_follow_ups`, `follow-up-scheduler.ts`) -- distinct from AG-28's separate follow-up system.
- **WGR-038** -- `sequenceEngine.processScheduledSends()` (email_sequence_enrollments sends) reachable only via `/api/cron/email-...`, wiring/reconciliation gap noted in PT-08-002.
- **WGR-040** -- `worker/autonomous-orchestrator.ts`'s `processAgentQueue()`/`runQueueItem()` has no per-item timeout wrapper around a claimed job's execution. UNVERIFIED.
- **WGR-047** -- Migration `078_forecast_board.sql` (src/supabase/migrations tree) defines `board_members` columns that don't match the live table's real columns -- schema drift.
- **WGR-053** -- Migration `097_deadline_prediction_agent.sql` defines `deadline_predictions` + `funders.next_predicted_open_date`/`.avg_cycle_length_days`; none exist live, despite real live consumers.
- **WGR-054** -- `applications.funder_id` does not exist live (real column is `opportunity_id` only; funder reachable one hop via `opportunities.funder_id`) -- code assumes the missing column in places.
- **WGR-055** -- `rubric-extractor.ts`'s `extractRubricFromOpportunity()` selects 5 of 6 requested columns off `opportunities` that don't exist live.
- **WGR-056** -- `funders.city`/`.state` don't exist live (only free-text `geographic_focus`); `auto-queue-populator.ts` selects them anyway.
- **WGR-057** -- `funders.portal_type` doesn't exist live; referenced 4x in `worker/autoapply-autonomous-orchestrator.ts`'s funder-auto-creation path.
- **WGR-058** -- `alerts.title`/`.alert_type` don't exist live (real columns `message`/`type`); `src/app/api/activity/route.ts` selects the wrong names.
- **WGR-059** -- `organizations.service_areas` (plural) doesn't exist live, only singular `service_area` -- same class of bug already fixed elsewhere once.
- **WGR-060** -- `intelligence_grantmaker_profiles` has drifted column names across 5 real live call sites (`foundation_id`/`name`/`program_priorities`/etc.).
- **WGR-064** -- 13 of 120 live org-scoped tables have no live FK constraint referencing `organizations` (tenant-FK gap).
- **WGR-065** -- 6 of 26 identifier-shaped columns checked have no unique index AND real live data already contains duplicate values.
- **WGR-067** -- `foundation_directory.email`/`.contact_emails` are NULL on 100% of 133,812 rows; code reads them as a signal, not just display.
- **WGR-068** -- Migration idempotency test against a disposable local Postgres: of 142 migration files replayed in order, 121 applied clean, the rest had issues (see register for full breakdown).
- **WGR-075** -- The `impersonation_log` audit table is unwritable for every real production caller today: its `admin_id` FK points to `platform_admins`, which has only 1 row.
- **WGR-077** -- AG-05 (research family, `corporate-giving.ts`) execution-proof finding from PT-09-002 -- see register for the specific gap.
- **WGR-078** -- AG-13 (`foundation-scraper.ts` `enrichSingleFoundation()`) runs clean but returns `enriched=false, strategy="none"` -- effectively a no-op.
- **WGR-079** -- AG-14 (`worker/dd-request-processor.ts`, DdRequestProcessor) -- two distinct execution-proof findings from PT-09-002 (see register).
- **WGR-080** -- AG-18 (`reputation-agent.ts`) completes but `itemsProcessed=0` despite `itemsFound=1` -- writes nothing.
- **WGR-081** -- AG-23/AG-32 canonical-number collision in `relationship-graph-builder-agent.ts` is a genuine, confirmed single-class collision, not a naming coincidence.
- **WGR-082** -- AG-24 (`/api/intelligence/outreach/generate`) is not agent-framework code at all -- makes zero database writes despite being registered as an agent.
- **WGR-083** -- AG-25 Deadline Prediction runs clean (`agent_runs` written, no errors) but writes zero `deadline_predictions` rows. UNVERIFIED.
- **WGR-084** -- AG-26 (`funding-forecast-agent.ts`) runs clean but writes zero `funding_forecasts` rows.
- **WGR-085** -- AG-30 (`donor-intent-monitor-agent.ts`) runs clean, makes 3 real Claude web-search calls, but see register for the specific gap found. UNVERIFIED.
- **WGR-086** -- AG-36 (`learning-network-aggregator-agent.ts`) is confirmed WIRED (corrects a prior stale "unwired" assumption) but still has a real gap -- see register.
- **WGR-087** -- AG-40 (`strategic-advisor-agent.ts`) independently reproduces WGR-059 live (`loadOrgProfile()` selects the wrong `service_area`/`service_areas` column).
- **WGR-088** -- AG-42 (`change-monitor-agent.ts`) runs clean but writes zero `corporate_monitoring_events` rows. UNVERIFIED.
- **WGR-089** -- AG-43 (`funder-signal-monitor-agent.ts`) runs clean but writes zero `funder_relationship_signals` rows (agent exists but is unregistered on the watch list). UNVERIFIED.
- **WGR-090** -- AG-20 (`ea-01-giving-detector.ts`) is TRIGGER-BROKEN, a distinct root cause from the other zero-output agent findings above.
- **WGR-093** -- 6 more agent-number/registration mismatches beyond the 3 the seed script's own header already documents as deliberate.
- **WGR-095** -- Incidental finding from a Railway platform-log pull during the AutoApply queue-processor soak test (PT-11-003) -- see register for detail.
- **WGR-100** -- `e2e/critical-paths.spec.ts`'s "creating an application... adds a row to /applications/list" test fails on both chromium and firefox, both of 2 independent runs -- cross-browser, not WebKit-specific.
- **WGR-101** -- `form-filler.ts:253` (AutoApply form-filler agent, file-upload field handler) has a silent-catch flagged by the PT-13-001 census of 2365 catch sites.
- **WGR-104** -- `worker/index.ts:144` is the one background sub-process in the worker boot sequence whose unhandled failure does NOT crash the process or mark `worker_status.status="error"`.
- **WGR-105** -- `src/app/api/admin/system/route.ts:71-73` filters `donor_discovery_requests` on `status="pending"`, a value the real status enum doesn't use the same way.
- **WGR-122** -- PT-10-001 fuzzing of `POST /api/notifications` (CRON_SECRET-bearer-gated) found all 3 malformed-payload cases behaved unexpectedly -- see register.
- **WGR-124** -- Fault-injection scenario 1 (db_slow, +15000ms latency): public path (`/`) behavior at the harness's 30000ms bound -- see register for the specific gap graded P1.
- **WGR-125** -- Fault-injection scenario 2: a standalone child process could claim a real `submission_queue` row via the same two-step claim predicate `dequeue()` uses -- race-condition concern.
- **WGR-132** -- `canMoveToStage()` restricts moving an application to 'submitted' to owner/admin, but a 'viewer'-role session's direct `executeTransition()` call bypasses that UI-layer check.
- **WGR-135** -- `computeGrantProbability()`'s persisted `opportunity_probability_scores` rows are never recomputed when their underlying input data changes -- live, reproducing staleness bug.
- **WGR-140** -- SAM.gov `opportunities/v2/search`: once a valid date range is supplied, the real `description` field is always a URL to a separate `noticedesc` endpoint, never literal text -- code doesn't follow it.
- **WGR-145** -- ScraperAPI proxy rotation (`stealth-engine.ts`) -- `SCRAPER_API_KEY` confirmed absent from this environment.
- **WGR-148** -- The `supabase_realtime` Postgres publication has zero member tables in production (publication exists, nothing attached).
- **WGR-160** -- Audit gap: PT-08/PT-09 both passed without ever exercising the real Donor Discovery request pipeline end to end (the pipeline that WGR-158, since resolved, found 100% broken).
- **WGR-168** -- `/autoapply/recordings` ("Session Recordings") always shows a red "Could not load recordings." banner on every load, every org.
- **WGR-169** -- `POST /api/ai/review` 504s with `{"error":"Agent timed out after 60s.","code":"timeout"}` on every real-length draft.
- **WGR-170** -- `POST /api/agents/success-probability` returns `500 {"error":"Failed to save probability score.","code":"write_failed"}` on every real request.
- **WGR-171** -- `POST /api/intelligence/strategic-advisor` ("Run" action) returns a bare `500`, empty body, `content-type: null`, in under 1 second.
- **WGR-172** -- `POST /api/intelligence/community-need` ("Run Analysis" action) returns a bare `500`, empty body, `content-type: null`, in under 1 second.
- **WGR-174** -- Public Assist chatbot (`POST /api/public/assist`) 500s in prod. Code fix (commit `d502269`) is correct; target migration `supabase/migrations/147_knowledge_public_wrappers.sql` has never been applied to production. BLOCKED-ON-DEPLOY -- see PIL note above, a Management API PAT that reaches this project is now proven to exist (used for PIL-01 in Session 32) and may unblock this without further credential hunting.

---

*Superseded content: the full session-by-session narrative (Sessions 1-32, July-August 2026) and the original 2026-08-20 audit-close register snapshot were removed in this 2026-08-24 compaction pass. `test-evidence/_register/WIRING_GAP_REGISTER.md` remains the permanent, uncompacted historical record with full evidence paths and repro commands for every row above (and for all P2/P3/RESOLVED/CONFIRMED-OK rows not listed here). `SESSION_STATE.md` carries the last 3 session summaries and current next actions/blockers.*
