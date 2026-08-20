# GO / NO-GO — Production Readiness Verdict

**Date:** 2026-08-20
**Basis:** Full audit program PT-00 through PT-15 (build/boot, page-render, E2E workflows,
business logic, cross-tenant RLS, DB schema-vs-migration drift, third-party integrations, worker
boot, autonomous-agent execution, adversarial fault injection, test-suite execution, load/soak,
error handling/silent catches, SSRF/RLS-anon/bundle security, ops readiness). Source of truth:
`test-evidence/_register/WIRING_GAP_REGISTER.md` (153 findings, WGR-001..WGR-153), consolidated,
deduplicated, and sorted P0→P3 as of commit `5c747ee174c0abd83bff2cd266d825c511ebba5f`.

**Verdict: NO-GO.**

Do not represent this platform to an investor, a design partner, or a paying customer as
production-ready until the P0 list below is closed and the security-relevant P1/P2 items
(SSRF-adjacent, anon-grant, RPC-exposure) are at minimum triaged with a committed fix date. Details
and reasoning follow.

---

## 1. Finding counts by severity × scope tag

| Severity | CONFIRMED-BROKEN | UNVERIFIED | PENDING-SCOPE | CONFIRMED-OK | RESOLVED | **Total** |
|---|---|---|---|---|---|---|
| **P0** | 15 | 1 | 0 | 0 | 1 | **17** |
| **P1** | 61 | 5 | 0 | 0 | 3 | **69** |
| **P2** | 24 | 0 | 4 | 0 | 2 | **30** |
| **P3** | 4 | 2 | 2 | 29 | 0 | **37** |
| **Total** | **104** | **8** | **6** | **29** | **6** | **153** |

- **Open findings** (excludes RESOLVED and CONFIRMED-OK — i.e. everything still requiring either a
  fix or a scope decision): **P0 = 16, P1 = 66, P2 = 28, P3 = 8. Total open = 118.**
- **Resolved this audit cycle, with a real committed fix, live-reverified against production data:**
  6 rows — WGR-012, WGR-017 (commit `d5500cd`, 2026-08-19 — `/donor-discovery/prospects/[id]`
  blank-render crash on incomplete `enrichment` jsonb); WGR-029, WGR-030, WGR-031, WGR-032 (commit
  `5c747ee`, 2026-08-20 — four API routes silently truncated at PostgREST's 1000-row cap; fixed by
  paginating own-table aggregates and pushing id-filters into the query as `!inner` embeds rather
  than client-side `.in()` lists; each live-reverified against real production data before
  committing).
- **Confirmed non-issues (CONFIRMED-OK), kept in the register so the question isn't re-asked:** 29,
  all P3 — code paths investigated and found to work as designed.

## 2. Must-fix-before-investor list — open P0

All 16. Every row below is either **CONFIRMED-BROKEN** (live-reproduced against real data/a real
request) or **UNVERIFIED** (plausible from a direct code read, not yet exercised) — see the
register's Scope-tag legend. Full text, evidence path, and exact reproduction command for each is
in `WIRING_GAP_REGISTER.md`; this table is a pointer, not a substitute.

| ID | Layer | Scope Tag | Finding (summary — see register for full text/evidence/repro) |
|---|---|---|---|
| WGR-004 | Frontend/Page | CONFIRMED-BROKEN | `/documents` page: authenticated Playwright navigation timed out after 30000ms during the PT-00-005 smoke sweep (`navigation failed: page.goto: Timeout 30000ms exceeded.`) — a real hang, not a… |
| WGR-023 | API/Middleware | CONFIRMED-BROKEN | unauthenticated-rejection sweep (318 API routes) found every cron_secret- and webhook_signature-classified route rejects an unauthenticated call safely (307 redirect to /login, no data exposure --… |
| WGR-074 | Auth/Admin | CONFIRMED-BROKEN | Admin impersonation (POST /api/admin/orgs/[id]/impersonate) is unbounded: the impersonation_org_id cookie it sets is read by ZERO other call sites anywhere in the repo (git grep confirms; it appears… |
| WGR-099 | Frontend / Cross-browser | CONFIRMED-BROKEN | (`cross-browser` suite, real execution against the real port-3100 Benavora server, run twice specifically to check persistence per this task's explicit instruction). `e2e/critical-paths.spec.ts` on… |
| WGR-108 | API/SSRF | CONFIRMED-BROKEN | POST /api/intelligence/ingest {source:'url', url} (requireRole('writer'), src/app/api/intelligence/ingest/route.ts:61-77) does `fetch(url.trim(), {headers, signal})` on a fully user-supplied URL with… |
| WGR-109 | Autoapply/SSRF | CONFIRMED-BROKEN | WebhookNotifier.notify() (src/lib/autoapply/webhook-notifier.ts:123) does `fetch(config.webhook_url, {method:'POST', headers, body, signal})` on a URL read from webhook_configs.webhook_url with zero… |
| WGR-110 | Autoapply/SSRF | UNVERIFIED | AutoApply's real submission pipeline (worker/queue-processor.ts:566 reads funders.giving_portal_url, a free-text field with no server-side URL/host validation found anywhere in the funders write… |
| WGR-111 | Middleware/Availability | CONFIRMED-BROKEN | src/middleware.ts's catch-all matcher requires a valid Supabase session (a real, non-empty session cookie that passes supabase.auth.getUser()) for every path not explicitly listed in… |
| WGR-129 | API/AI-Drafts | CONFIRMED-BROKEN | core journey stage 4 (draft generation): POST /api/ai/draft can return a genuine HTTP 200 with a full, real generated draft while persisting ZERO rows to draft_versions -- confirmed via an isolated… |
| WGR-130 | API/Kanban | CONFIRMED-BROKEN | PT03-KA-F02 (test-evidence/pt-03/kanban-auth.json, kanban.enforcement_gap_tests[0]): getTransitionRule(discovered, drafting) correctly reports this stage-skip as illegal (allowed=false,… |
| WGR-131 | Data/RLS | CONFIRMED-BROKEN | PT03-KA-F03 (test-evidence/pt-03/kanban-auth.json, kanban.enforcement_gap_tests[1]): a raw supabase.from('applications').update({stage:'awarded'}) call -- with NO call to executeTransition() at all,… |
| WGR-133 | Auth/PKCE | CONFIRMED-BROKEN | PT03-KA-F04 (test-evidence/pt-03/kanban-auth.json, findings[3]; also auth_flows.password_reset, outcome='FAIL'): a real, freshly-issued recovery link (not expired, not reused, real Mailpit-delivered… |
| WGR-138 | Integration/Parser | CONFIRMED-BROKEN | Grants.gov (src/lib/sources/grantsgov-client.ts searchGrantsGovOpportunities(), the live path behind the daily Vercel Cron /api/cron/grantsgov "0 7 * * *" and /api/sources/grantsgov): the app-coded… |
| WGR-139 | Integration/Parser | CONFIRMED-BROKEN | SAM.gov opportunities/v2/search (src/lib/sources/samgov-client.ts searchSamGovOpportunities(), the live path behind /api/sources/samgov): as coded, the request omits postedFrom/postedTo. The real,… |
| WGR-142 | Integration/Parser | CONFIRMED-BROKEN | SAM.gov Entity Management API v3 (src/lib/donor-discovery/adapters/samgov-adapter.ts searchEntitiesByNaics(), a separate implementation from samgov-client.ts, same api.sam.gov host): the request… |
| WGR-143 | Integration/Parser | CONFIRMED-BROKEN | SAM.gov Award Notices (src/lib/donor-discovery/adapters/samgov-adapter.ts searchRecentAwardRecipients()/normalizeAwardee(), ptype=a on the same opportunities/v2/search endpoint as WGR-139/140/141, a… |

**Why these are P0, in plain terms:**
- **Real, live SSRF surface** (WGR-108/109/110): three separate code paths make an outbound
  server-side `fetch()` to a fully or partially user-/org-controlled URL with no host/scheme/private-
  IP validation. This is a real attack surface on internal infrastructure (cloud metadata endpoints,
  internal services), not a theoretical one — it needs closing before any external party is trusted
  to touch these fields.
- **Authorization/state-machine bypass on the applications pipeline** (WGR-130/131/132 cluster, the
  132 instance is P1 but the same root cause): a raw DB write can move an application to `awarded`
  skipping every intermediate stage and its own enforcement layer entirely, live-confirmed.
- **Silent data loss on the core product action**: generating a grant draft can return a real,
  complete draft to the user (HTTP 200) while the platform loses it — zero rows land in
  `draft_versions` (WGR-129).
- **A real user cannot reset their own password**: the PKCE recovery-link flow rejects a real,
  fresh, unexpired, unreused link (WGR-133).
- **Every external funding-source integration this platform's core value proposition depends on
  (Grants.gov, SAM.gov ×3 distinct call sites) is currently broken against the real, current
  third-party API** (WGR-138/139/142/143) — this is not a hypothetical degradation, these are the
  live paths behind the daily crons that populate the opportunity pipeline.
- **The entire product is unusable in Safari/WebKit** (WGR-099, 0% pass rate on the real E2E suite
  under that engine) and the middleware blocks any legitimate non-cookie caller (cron/webhook
  bearer-token traffic) from ever reaching route logic (WGR-111).

## 3. Must-fix-before-investor list — open P1 (summary; full detail in REMEDIATION-BACKLOG.md)

**66 open P1 findings.** These are confirmed-broken-but-contained (single feature, degrades
gracefully, or has a workaround) rather than the immediate-blast-radius P0 tier, but at this volume
they represent a real, load-bearing pattern, not scattered noise. Full itemized table (all 66 IDs)
is below for completeness; REMEDIATION-BACKLOG.md groups the same 66 into actionable batches with a
recommended fix order.

**The single largest cluster (≈21 of the 66) is schema drift**: a migration file exists on disk,
defines a table/column, and real application code was written against that migration's shape — but
the migration was never applied to the live database, or was applied from a different, conflicting
migration file that defines the same table with different columns. WGR-041 through WGR-060,
WGR-064/065/067/068 are this cluster. This is not 21 independent bugs; it's one systemic gap
(migration tracking) surfacing 21 times. See REMEDIATION-BACKLOG.md §2 for the consolidated fix.

**Second largest cluster (≈15) is autonomous-agent execution proof**: WGR-077 through WGR-090,
WGR-093, WGR-095 — real agent classes run to completion with `agent_runs.errors = []` but write zero
rows to their real target table, either because seed data doesn't have a real-world footprint to
find (a test-environment artifact, several UNVERIFIED) or because of a genuine wiring/table-name gap
(several CONFIRMED-BROKEN). Every one of these means a feature the registry/UI claims is "running
nightly" has, in this audit, never been observed to actually produce output.

**Third cluster (4) is missed scheduled jobs**: WGR-035/036/037/038 — draft-automation, sales-send,
AutoApply follow-up, and email-sequence crons that either don't exist, were never wired into
`vercel.json`, or reference a function that isn't the one actually processing the data.

| ID | Layer | Scope Tag | Finding (summary — see register for full text/evidence/repro) |
|---|---|---|---|
| WGR-002 | Config/Deploy | CONFIRMED-BROKEN | `STANDING_DIRECTIVES.md` DIRECTIVE-019 deploy-verifier prerequisites (`VERCEL_TOKEN`, `VERCEL_PROJECT_ID`) confirmed absent from local `.env.local`. Previously-known,… |
| WGR-005 | API | CONFIRMED-BROKEN | `GET /api/agents/discovery` returns `500 {"error":"Failed to load discovery matches."}` on an authenticated, no-query-param request during the PT-00-005 smoke sweep. P1… |
| WGR-006 | API | CONFIRMED-BROKEN | `GET /api/consultant/clients` returns `500 {"error":"Failed to load client access grants.","code":"load_failed"}` on an authenticated, no-query-param request during the… |
| WGR-007 | API | CONFIRMED-BROKEN | `GET /api/outreach/sequences` returns `500 {"error":"Failed to load follow-up sequences.","code":"db_error"}` on an authenticated, no-query-param request during the… |
| WGR-008 | API | CONFIRMED-BROKEN | `GET /api/schoolfunder` returns `500 {"error":"Failed to load students.","code":"load_failed"}` on an authenticated, no-query-param request during the PT-00-005 smoke… |
| WGR-009 | API | CONFIRMED-BROKEN | `GET /api/settings/notifications` returns `500 {"error":"Failed to load notification preferences.","code":"db_error"}` on an authenticated, no-query-param request during… |
| WGR-027 | API | CONFIRMED-BROKEN | CRUD cycle: POST /api/email/templates unconditionally 500s ("Failed to create template.", code db_error) for every request, on any org, at writer role. Root cause: the… |
| WGR-033 | Worker/Boot | CONFIRMED-BROKEN | PT-08 worker boot inventory: worker/enrichment-processor.ts (a complete, real start()/stop()/waitForIdle() processor -- the EA-01..EA-10 corporate-enrichment agent… |
| WGR-035 | API/Scheduling | CONFIRMED-BROKEN | cron reconciliation: `/api/cron/draft-automation` (daily draft-automation cron -- `DraftQueueEngine.processDeadlineApproaching()` + `DraftAutoGenerator.processQueue()`,… |
| WGR-036 | API/Scheduling | CONFIRMED-BROKEN | cron reconciliation: `SalesCampaignEngine.processQueuedSends()` (`src/lib/admin/sales-campaign-engine.ts`) -- the only code path in the repo that ever reads and sends… |
| WGR-037 | API/Scheduling | CONFIRMED-BROKEN | cron reconciliation: two-layer gap in the AutoApply 14/30/60-day donation follow-up email system (`autoapply_follow_ups` table,… |
| WGR-038 | API/Scheduling | CONFIRMED-BROKEN | cron reconciliation: `sequenceEngine.processScheduledSends()` (`src/lib/email/sequence-engine.ts`) -- the sole consumer of scheduled `email_sequence_enrollments` sends… |
| WGR-040 | Worker/Queue | UNVERIFIED | agent_queue lifecycle exercise: `worker/autonomous-orchestrator.ts`'s `processAgentQueue()`/`runQueueItem()` has no per-item timeout wrapper around a claimed job's… |
| WGR-041 | Data/Infra | CONFIRMED-BROKEN | migration drift map: this project has NO Supabase-CLI migration-tracking table (supabase_migrations.schema_migrations does not exist -- confirmed live, two independent… |
| WGR-042 | API/Agent | CONFIRMED-BROKEN | migration 037_giving_history.sql's funder_giving_history.grant_purpose and .source columns are missing live (real live columns are… |
| WGR-043 | API/Agent | CONFIRMED-BROKEN | migration 038_intelligence_tables.sql's success_probability_scores.data_quality, .created_at, and .updated_at columns are missing live (live columns: id,… |
| WGR-044 | API/Worker | CONFIRMED-BROKEN | migration 052_webhook_configs.sql's webhook_configs.type/.is_active/.updated_at columns are missing live -- the table exists but was created by the conflicting sibling… |
| WGR-045 | API/Worker | CONFIRMED-BROKEN | migration 052_governance_layer.sql's funder_relationships, queue_controls, submission_usage, and tier_limits tables do not exist live at all -- this is the entire… |
| WGR-046 | API | CONFIRMED-BROKEN | migration 060_grantmaker_profiles.sql's intelligence_grantmaker_profiles table is missing 9 of its defined columns live, including foundation_id, name,… |
| WGR-047 | API | CONFIRMED-BROKEN | migration 078_forecast_board.sql (src/supabase/migrations tree) defines board_members with org_id/role/committee/term_start/term_end/expertise/active columns -- the LIVE… |
| WGR-048 | API | CONFIRMED-BROKEN | migrations 101_twin_auto_populate_log.sql (root) and 102_twin_auto_populate_log.sql (src/supabase/migrations, the parallel-tree duplicate) both define… |
| WGR-049 | API/Agent | CONFIRMED-BROKEN | migration 105_applications_metadata_column.sql's applications.metadata column is missing live. Real, live consumers all write/read it directly:… |
| WGR-050 | Frontend/Page | CONFIRMED-BROKEN | migration 106_intelligence_library_schema_upgrade.sql adds 20 columns to intelligence_funded_proposals; none exist live. Of those 20, column-specific grep confirms at… |
| WGR-051 | Data/Script | CONFIRMED-BROKEN | migration 100_prospects_contact_fields.sql's prospects.contact_name/.contact_title columns are missing live. Real, live intended consumer confirmed directly:… |
| WGR-052 | API/Frontend | CONFIRMED-BROKEN | migration 054_email_calendar_integration.sql's email_threads and email_messages tables do not exist live (among other tables this file also defines). Real, live… |
| WGR-053 | API/Agent | CONFIRMED-BROKEN | migration 097_deadline_prediction_agent.sql (src/supabase/migrations tree) defines the deadline_predictions table and… |
| WGR-054 | API/Agent | CONFIRMED-BROKEN | (code-vs-live-schema cross-reference audit): `applications.funder_id` does not exist live -- the real column is `opportunity_id` only (funder is reachable via… |
| WGR-055 | Lib | CONFIRMED-BROKEN | `src/lib/intelligence/rubric-extractor.ts:85`'s `extractRubricFromOpportunity()` selects `'requirements, eligibility_text, description, raw_content, funder_name, title'`… |
| WGR-056 | Lib | CONFIRMED-BROKEN | `funders.city`/`funders.state` don't exist live (the table has no structured location columns, only free-text `geographic_focus`).… |
| WGR-057 | Worker | CONFIRMED-BROKEN | `funders.portal_type` doesn't exist live. `worker/autoapply-autonomous-orchestrator.ts` references it 4 times in the same funder-auto-creation function: two… |
| WGR-058 | API | CONFIRMED-BROKEN | `alerts.title`/`alerts.alert_type` don't exist live (real columns: `message`, `type`). `src/app/api/activity/route.ts:85` selects `'id, title, message, alert_type,… |
| WGR-059 | Agent | CONFIRMED-BROKEN | `organizations.service_areas` (plural) doesn't exist live -- only the singular `service_area` does. This is the same class of bug already fixed in… |
| WGR-060 | Lib | CONFIRMED-BROKEN | `intelligence_grantmaker_profiles` has drifted column names across 5 real, live call sites -- code expects… |
| WGR-064 | Data/Infra | CONFIRMED-BROKEN | Tenant FK gap: of 120 live tables carrying an `org_id`/`organization_id` column, 13 have no live FOREIGN KEY constraint referencing `organizations`: `adapter_usage_log`,… |
| WGR-065 | Data/Infra | CONFIRMED-BROKEN | Unique-index gaps: of 26 identifier-shaped columns checked (name matches an identity-column naming pattern, e.g. `*_id`, `ein`, `email`, `website`), 6 have no unique… |
| WGR-067 | Data/Infra | CONFIRMED-BROKEN | Null-rate audit on columns real application code reads as a signal, not just a display field: `foundation_directory.email` is NULL on 100% of 133,812 rows and… |
| WGR-068 | Data/Infra | CONFIRMED-BROKEN | Migration idempotency test, run for real against a disposable local Postgres database (status: RAN, not PENDING/skipped): first-apply pass replayed all 142 files in… |
| WGR-075 | Auth/Admin | CONFIRMED-BROKEN | The dedicated impersonation_log audit table (SCHEMA_REGISTRY §55) is unwritable for every real production caller today: its admin_id column has a foreign key to… |
| WGR-077 | Autonomous Agents | CONFIRMED-BROKEN | execution proof: AG-05 (ag-05-research family; representative member tested: src/lib/agents/research/corporate-giving.ts, CorporateGivingResearchAgent) ran end-to-end… |
| WGR-078 | Autonomous Agents | CONFIRMED-BROKEN | execution proof: AG-13 (ag-13-foundation-enrichment, src/lib/scraper/foundation-scraper.ts, enrichSingleFoundation()) ran to completion cleanly (no throw) and returned… |
| WGR-079 | Autonomous Agents | CONFIRMED-BROKEN | execution proof: AG-14 (ag-14-donor-discovery, worker/dd-request-processor.ts, DdRequestProcessor) -- two real, distinct findings from directly exercising this class… |
| WGR-080 | Autonomous Agents | CONFIRMED-BROKEN | execution proof: AG-18 (ag-18-reputation, src/lib/intelligence/reputation-agent.ts, ReputationIntelligenceAgent.runForFunder()) completed cleanly (agent_runs output:… |
| WGR-081 | Autonomous Agents | CONFIRMED-BROKEN | execution proof: AG-23/AG-32 canonical-number collision (src/lib/agents/relationship-graph-builder-agent.ts, RelationshipGraphBuilderAgent) is a genuine, confirmed… |
| WGR-082 | Autonomous Agents | CONFIRMED-BROKEN | execution proof: AG-24 (src/app/api/intelligence/outreach/generate/route.ts) is not agent-framework code at all -- confirmed by direct execution and source read: the… |
| WGR-083 | Autonomous Agents | UNVERIFIED | execution proof: AG-25 Deadline Prediction (src/lib/agents/deadline-prediction-agent.ts, ag-25-deadline-prediction) ran to completion cleanly (agent_runs written,… |
| WGR-084 | Autonomous Agents | CONFIRMED-BROKEN | execution proof: AG-26 (src/lib/agents/funding-forecast-agent.ts, ag-26-forecast) ran to completion cleanly (agent_runs written, errors reported empty) but wrote zero… |
| WGR-085 | Autonomous Agents | UNVERIFIED | execution proof: AG-30 (src/lib/agents/donor-intent-monitor-agent.ts, ag-30-donor-intent) ran cleanly (agent_runs completed, itemsFound=2, itemsProcessed=2, errors=[])… |
| WGR-086 | Autonomous Agents | CONFIRMED-BROKEN | execution proof, priority suspect (learningAggregatorNowWired_correctsStaleAssumption): AG-36 (src/lib/agents/learning-network-aggregator-agent.ts,… |
| WGR-087 | Autonomous Agents | CONFIRMED-BROKEN | execution proof: AG-40 (src/lib/agents/strategic-advisor-agent.ts, ag-40-strategic-advisor) independently reproduces WIRING_GAP_REGISTER.md WGR-059 live:… |
| WGR-088 | Autonomous Agents | UNVERIFIED | execution proof: AG-42 (src/lib/agents/change-monitor-agent.ts, ag-42-change-monitor) ran cleanly (agent_runs completed) but wrote zero corporate_monitoring_events rows.… |
| WGR-089 | Autonomous Agents | UNVERIFIED | execution proof: AG-43 (src/lib/agents/funder-signal-monitor-agent.ts, ag-43-funder-signals, watchListRef ag43ExistsButUnregistered) ran cleanly (agent_runs completed)… |
| WGR-090 | Autonomous Agents | CONFIRMED-BROKEN | consolidation (finding surfaced by PT-09-002 execution proof but not previously given its own register row): AG-20 (src/lib/agents/ea-01-giving-detector.ts,… |
| WGR-093 | Autonomous Agents / Data Integrity | CONFIRMED-BROKEN | consolidation: beyond the 3 agent-number collisions scripts/seed-agent-registry.ts's own header comment already documents as deliberate (AG-23/AG-32 merged, AG-25… |
| WGR-095 | Autonomous Agents | CONFIRMED-BROKEN | (AutoApply queue-processor soak test), incidental finding surfaced by a real Railway platform-log pull scoped to the run window (`railway logs --deployment --json… |
| WGR-100 | Frontend / E2E | CONFIRMED-BROKEN | (`cross-browser` suite, same 2 runs as WGR-099). `e2e/critical-paths.spec.ts`'s "creating an application... adds a row to `/applications/list`" test failed on **both… |
| WGR-101 | Autonomous Agents / AutoApply | CONFIRMED-BROKEN | silent-catch census (census-silent-catches.mjs, real static scan, 2365 catch sites): src/lib/agents/form-filler.ts:253 -- inside the AutoApply real form-filler agent's… |
| WGR-104 | Worker/Boot | CONFIRMED-BROKEN | observability audit (F11): worker/index.ts:144 is the ONE background sub-process in the worker's boot sequence wired so that an unhandled failure does NOT crash the… |
| WGR-105 | Frontend / Observability | CONFIRMED-BROKEN | observability audit (F20): src/app/api/admin/system/route.ts:71-73 (donor_discovery_requests depth query) filters .eq("status", "pending") -- but… |
| WGR-122 | Middleware/Availability | CONFIRMED-BROKEN | fuzzing POST /api/notifications (the one CRON_SECRET-bearer-gated route deliberately included in the malformed-payload set, exercised with a real bearer token instead of… |
| WGR-124 | Middleware/Availability | CONFIRMED-BROKEN | scenario 1 (db_slow phase, +15000ms latency injected before the fault proxy forwards to the real local Supabase stack, harness-bounded client wait 30000ms): the public… |
| WGR-125 | Worker/Queue | CONFIRMED-BROKEN | scenario 2: a real, standalone child process was let claim a real submission_queue row via the exact two-step claim predicate worker/queue-processor.ts's dequeue() uses… |
| WGR-132 | Frontend/Kanban | CONFIRMED-BROKEN | PT03-KA-F01 (test-evidence/pt-03/kanban-auth.json, kanban.enforcement_gap_tests[2]): canMoveToStage() says only owner/admin may move an application to 'submitted', but a… |
| WGR-135 | Business Logic | CONFIRMED-BROKEN | /PT-04-004: computeGrantProbability()'s persisted opportunity_probability_scores rows are never recomputed when their underlying input data changes -- a real, live,… |
| WGR-140 | Integration/Parser | CONFIRMED-BROKEN | SAM.gov opportunities/v2/search (same file as WGR-139): once a valid date range is supplied, real hits' "description" field is always a URL to a separate GET… |
| WGR-145 | Integration | CONFIRMED-BROKEN | ScraperAPI proxy rotation (src/lib/scraper/stealth-engine.ts resolveProxy()/StealthEngine.launchContext()): SCRAPER_API_KEY is confirmed absent from this environment's… |
| WGR-148 | Data/Realtime | CONFIRMED-BROKEN | The `supabase_realtime` Postgres publication has ZERO member tables in production -- confirmed live via a direct query of pg_publication_tables (the publication itself… |

## 4. P2 and P3 — not blocking, but not silently accepted either

**28 open P2** (real gaps, low blast radius — admin-only, cosmetic, rare path, or a deprecated
feature) and **8 open P3** (unverified suspicion or a real product-decision gap, not yet a
classified bug) exist in the register with full evidence. Two P2 items are worth calling out
explicitly despite the tier, because they compound the P0 security picture in §2 rather than being
independent of it:

- **WGR-118** (P2, CONFIRMED-BROKEN): 107 of 184 public-schema tables still carry an unrevoked
  default grant to `anon`/`authenticated` beyond what RLS alone should allow.
- **WGR-119** (P2, CONFIRMED-BROKEN): the full public-schema RPC surface was enumerated live via
  `pg_proc` + `has_function_privilege('anon', ...)`; several functions are `EXECUTE`-able by the
  anon role without having been individually invoked to confirm real-world impact.

Full P2/P3 tables are in `WIRING_GAP_REGISTER.md` (sorted, same format as above) and in
`REMEDIATION-BACKLOG.md` §§4–5.

## 5. Known limits — not bugs, product/scope facts to disclose plainly

The following are stated to any external party as **known, accepted platform limits**, not defects
in progress. Two categories:

**(a) Confirmed live in this audit's own PT-15 evidence, with a real evidence pointer — safe to
state as fact:**

| Limit | Evidence | Real-world effect |
|---|---|---|
| No transactional/notification email currently sends | WGR-146 (`test-evidence/pt-15/vercel-env-ls-production-raw.txt`, `test-evidence/pt-15/local-env-names-raw.txt`) — `RESEND_API_KEY` is absent from both local `.env.local` and the entire Vercel production environment (only 12 env vars total exist there, none Resend-prefixed). | Any code path that calls the Resend client (draft-ready notices, morning digest, urgent alerts, welcome email) will fail or no-op at send time. |
| No Google OAuth (Gmail / Calendar) integration is currently usable | WGR-147, same `vercel env ls` evidence — `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET`/`GOOGLE_REDIRECT_URI` absent from every environment. | Gmail-based email-thread ingestion and Calendar sync features cannot authenticate against a real Google account today. |
| 2 live production tables have no origin migration | WGR-069 — `corporate_relationships`, `fundability_deficiencies` exist in the live schema but match no `CREATE TABLE` in either migration tree. Not a correctness bug per se, but their schema can't be reproduced from a clean migration replay. | A fresh environment stood up from the migration files alone will not have these two tables. |
| A 7th, undocumented public storage bucket exists | WGR-117 — `org-branding`, created after 2026-07-30, `public=true`, not in the original 6-bucket inventory. | Needs a scope decision: intentional (document it) or accidental (lock it down) — not yet decided. |
| AutoApply (AG-12) has no automated test coverage of its own | WGR-092 — the real submission pipeline (`worker/queue-processor.ts` + `stealth-browser`/`form-filler-agent`/`captcha-solver`/`confirmation-monitor`/`email-submitter`) has zero dedicated unit/integration tests found in this audit. | Regressions in the platform's highest-stakes automated action (submitting a real form on a real funder's real portal) would not be caught by CI today. |
| 4 tenant-scoped tables have RLS enabled with zero policies | WGR-072 — `ai_usage_log`, `enrichment_jobs`, `kb_extended_needs`, `system_errors`: RLS is `ON` but no policy exists, which (Postgres default) denies all non-service-role access rather than leaking data — safer than the alternative, but likely unintentional and needs a scope call either way. | These tables are currently unreadable by any authenticated app-level session; if that's not intended, some feature reading them is silently getting nothing back. |

**(b) Named in this task's own framing but not independently corroborated by any PT-00–PT-14
evidence located in this audit — stated here exactly as given, with that caveat attached rather than
silently dropped or presented as verified fact:**

- **"Places off"** — no PT-00–PT-14 finding or PT-15 ops-readiness check in this audit's evidence
  base shows Google Places API access currently disabled or blocked. PT-15's own env-parity check
  (`test-evidence/pt-15/env-parity.json`, `var: "GOOGLE_PLACES_API_KEY"`) found the key present in
  local, Vercel production, and Railway production with `status: "ok_all_relevant_environments"` and
  zero gap environments. If Places is deliberately turned off at the product/feature level (as
  opposed to a credentials problem), that is a real, live product-scope fact worth stating
  explicitly to any external party — but it should be re-confirmed directly (e.g. a live donor-
  discovery Places-backed search) before being asserted as current status, since this audit did not
  independently observe it.
- **"Unlicensed business registry"** — no finding under this exact name exists in the register. The
  closest, real, evidenced findings in the same subject area are WGR-138/139/142/143 (P0: Grants.gov
  and 3 separate SAM.gov integration paths broken against the real, current third-party API) and
  WGR-140/141 (P1/P2: SAM.gov description/awardAmount field gaps) — all integration-code defects,
  not a licensing constraint. If a specific business-registry data source is genuinely unlicensed
  (as opposed to broken), name it explicitly in a follow-up pass so it gets its own register row with
  real evidence.
- **"Embeddings pending"** — no finding under this name exists in the register either. The Knowledge
  Engine's retrieval path is documented elsewhere in this project's governance history as
  keyword/`ILIKE`-based rather than vector/embedding-based by design (not evidenced fresh in this
  audit cycle). If a specific embeddings-generation job is genuinely queued/pending rather than a
  deliberate design choice, it should get its own register row with real evidence in a follow-up
  pass.

## 6. Reasoning for the verdict

A GO verdict on a platform this task explicitly wants judged by "the honest production-readiness
verdict" standard is not defensible with:

1. **A live, unauthenticated-writable SSRF surface** (§2, WGR-108/109/110) reachable from at least
   one authenticated non-admin role — a real security incident waiting to happen, not a hypothetical
   one, the moment an untrusted or compromised org account exists.
2. **A confirmed authorization/state-machine bypass** on the core applications pipeline
   (WGR-130/131/132) that lets a raw database write skip the stage-transition rules entirely.
3. **Silent data loss on the platform's single core value-delivery action** — AI draft generation
   can report success to the user while writing nothing to the database (WGR-129).
4. **A broken password-reset flow** (WGR-133) — a real user cannot recover their own account today.
5. **Every external funding-data integration this platform's pitch depends on is confirmed broken
   against the real, current third-party API** (WGR-138/139/142/143) — the opportunity pipeline this
   product is built around is not being populated correctly right now.
6. **Total failure on one of three baseline browser engines** (WGR-099, 0% E2E pass on WebKit) —
   a real fraction of any real user base is currently unable to use the product at all.

None of these are edge cases, deprecated paths, or admin-only surfaces — every one is either a
security hole or a break in the platform's primary, advertised user journey, and every one is
**CONFIRMED-BROKEN or UNVERIFIED-but-plausible against real, live evidence**, not a theoretical
code-smell.

**Conditional path to GO:** close the 16 open P0 items in §2, and at minimum triage-and-schedule the
security-adjacent P1/P2 cluster (WGR-111 middleware bypass, WGR-118/119 anon-grant/RPC exposure,
WGR-075 impersonation-audit gap, WGR-112 SQLi-shaped interpolation, WGR-113 email-template XSS) with
committed fix dates. The 66 open P1 and 28 open P2 items do not each individually block a GO verdict,
but the schema-drift cluster (≈21 items, §3) and the autonomous-agent execution-proof cluster
(≈15 items, §3) both represent a single systemic root cause each and should be closed as a batch,
not left as 36 individually-triaged tickets — see `REMEDIATION-BACKLOG.md` for the batched plan.

---
*Generated as the closing deliverable of the PT-00→PT-15 audit program. Supersedes any prior
production-readiness claim in `STATE_OF_THE_BUILD.md`/`SESSION_STATE.md` — see those files' updated
headers for the pointer back to this register.*
