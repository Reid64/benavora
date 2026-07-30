# SCHEMA_DRIFT_AUDIT.md
## Code-Reference-vs-Live-Production-Schema Audit

**Date:** 2026-07-30
**Companion document to `MIGRATION_AUDIT.md`** (root of repo), which audited *migration files*
against the live schema. This audit is the code-facing complement: it greps every real
Supabase call site in the application (not the migration `.sql` files) and cross-checks
every table/column the running code actually touches against the live production schema.

## Purpose

`MIGRATION_AUDIT.md` answers "did this migration's `CREATE TABLE`/`ADD COLUMN` statement
actually land in production?" That is necessary but not sufficient — a table can be
correctly documented as "not applied" while the audit still doesn't tell you *how many
call sites break*, whether those call sites are on a currently-invoked path (a cron-run
agent, a live API route, the worker loop) versus dead/unreachable code, or whether a table
was created **out-of-band with a different column layout than any checked-in migration
file defines** (several cases below). This audit answers those questions directly from
the code side.

## Methodology

1. **Live schema.** Read `NEXT_PUBLIC_SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` from
   `.env.local` (read-only, never modified) and fetched
   `GET {SUPABASE_URL}/rest/v1/` with `Accept: application/openapi+json` and the
   service-role key — the same PostgREST-OpenAPI-introspection method used by
   `SCHEMA_REGISTRY_v2.md` and both prior `MIGRATION_AUDIT.md` passes. Returned **153
   table/view definitions** with their full column lists. Saved to a local scratch file
   for repeated lookups (not committed).
2. **Code extraction.** Walked every `.ts`/`.tsx` file under `src/` and `worker/`
   (**946 files**; `__tests__`, `tests`, `.next`, `node_modules` excluded; `scripts/` was
   deliberately excluded per this audit's scope — migration-audit-style "live consumer"
   checks for scripts/-only tables like `prospects.contact_name/contact_title` are
   already covered in `MIGRATION_AUDIT.md` and were not re-derived here). A small
   purpose-built Node script (regex-based, not a real TS/SQL parser) stripped comments
   and string-literal-safe `//`/`/* */` content first (to avoid matching commented-out
   example code — see caveats), then for every `.from('table')`/`.from("table")` call:
   - Recorded the table name and call site.
   - Scanned forward from that call to the end of the enclosing statement (first `;` at
     bracket-depth 0, capped at 3000 chars or the next `.from(` — whichever comes
     first) and extracted every `.select(...)` column list (splitting on top-level
     commas, skipping embedded-resource/join syntax like `col:other_table(...)`),
     every `.insert({...})`/`.update({...})`/`.upsert({...})` object-literal key (incl.
     JS shorthand properties), and every `.eq/.neq/.gt/.gte/.lt/.lte/.like/.ilike/.is/
     .in/.contains/.order/.filter/.not/.overlaps/.textSearch('column', ...)` first
     argument.
   - Explicitly excluded `supabase.storage.from('bucket')` (Storage bucket references,
     not database tables — found and fixed one false positive here, `"autoapply"`).
   - Also recorded every `.rpc('name')` call (9 found; **not** cross-referenced against
     live Postgres function signatures — out of scope for this pass, noted as a gap).
3. **Cross-reference.** For each of the **178 distinct tables** referenced in code:
   flagged as MISSING if absent from the live schema entirely; otherwise diffed every
   referenced column against that table's live column list and flagged individual
   missing columns.
4. **Manual verification pass.** Every finding below with more than a handful of refs,
   and every one flagged as a live-wired priority item, was spot-checked by reading the
   actual source around the call site (not just trusting the regex) — this caught and
   fixed two classes of false positive during this run (documented in Known Limitations)
   and confirmed error-handling behavior (does the write throw, get silently swallowed,
   or go unchecked) for the highest-priority items.

## Summary

| Metric | Count |
|---|---|
| Files scanned (`src/` + `worker/`, `.ts`/`.tsx`) | 946 |
| Live tables/views in production (PostgREST OpenAPI) | 153 |
| Distinct tables referenced in code via `.from(...)` | 178 |
| **Tables referenced in code, entirely missing live** | **40** |
| Tables that exist live but have ≥1 column referenced in code that doesn't exist | **34** |
| **Total missing-column findings** (table × column pairs) | **86** |
| RPC functions called (`.rpc(...)`, not cross-checked against live function signatures) | 9 |
| Known false positives found and excluded during this pass | 2 classes (Storage bucket `.from()`, commented-out example code) |

## Highest-priority findings

Ordered roughly by "how bad is this right now," not alphabetically. Full detail with
every file:line for every table/column is in the **Full Findings** section below.

### A. Confirmed active, user-facing/throwing failures (not silent)

1. **`agent_configurations` — the whole "configure an agent" feature is broken, and this
   contradicts `MIGRATION_AUDIT.md`'s own conclusion.** `src/app/api/agents/registry/configure/route.ts:60-79`
   upserts `{ organization_id, agent_id, enabled, config, updated_at }` with
   `onConflict: "organization_id,agent_id"` into `agent_configurations`, then returns
   HTTP 500 (`config_save_failed`) if the upsert errors. The live table's real columns
   are `id, org_id, agent_id, enabled, config, last_run_at, run_count,
   total_tokens_consumed, created_at` — no `organization_id`, no `updated_at`.
   **`MIGRATION_AUDIT.md`'s July 30 pass explicitly named this exact file as a "real
   consumer" that correctly "quer[ies] org_id"** (see its migration-094/095 section) —
   direct inspection of the file shows it uses `organization_id` throughout, including
   in the `onConflict` target, not `org_id`. This looks like a factual error in that
   audit's conclusion, not a case of dead code: every POST to this endpoint fails.
2. **`discovery_matches.organization_id` — same pattern, same contradiction.**
   `src/app/api/agents/discovery/route.ts:52-57` does
   `.from("discovery_matches").select("*").eq("organization_id", ctx.orgId)`. Live
   columns are `id, org_id, opportunity_id, external_title, external_source,
   external_url, discovery_run_id, match_score, match_reasons, status, actioned_at,
   created_at` — `organization_id` doesn't exist; `org_id` does. `morning-digest.ts:38`
   has the identical bug on the same table (`.eq("organization_id", orgId)`), while the
   *same file* correctly uses `.eq("org_id", orgId)` two lines later for a different
   table (line 44) — this is a real, live mixed-naming bug, not a documentation issue.
3. **`success_probability_scores.data_quality`/`updated_at`** — confirmed, matches
   `MIGRATION_AUDIT.md` priority #1 exactly. `src/lib/agents/success-probability.ts:168`
   upserts these into the live table (real columns: `id, organization_id, application_id,
   probability_score, factors, calculated_at`) and the code explicitly
   `throw`s an `AgentError` on failure. Agent 22 fails every run.
4. **`platform_learning_patterns.confidence`/`weight` — table now EXISTS live (this
   contradicts project memory), but the insert still fails.** Live table has 11 columns
   (`id, pattern_type, funder_category, ntee_code, pattern_content, success_rate,
   sample_count, avg_award_amount, winning_examples, last_updated, created_at`) — real,
   not a stub. But `src/lib/agents/learning-network-aggregator-agent.ts:1005-1020`
   inserts `confidence` and `weight` (via JS shorthand) which aren't in that list, and
   throws `Failed to insert platform_learning_patterns row: ...` on error. Project
   memory `benavora-two-parallel-migrations-directories` says this table was "confirmed
   absent from live DB" on 2026-07-20 — it exists now (created since then, by an
   unidentified process, with a different column set than the src-tree migration
   defines), so that memory needs updating.
5. **`automation_sessions.session_type` — the live AutoApply worker's auto-approval
   path throws on every call, contradicting `MIGRATION_AUDIT.md`'s "no live consumer"
   verdict for migration 020.** `worker/queue-processor.ts:1552-1572`,
   `createApprovedAutomationSession()` (called from the main `processItem()` loop at
   line 1162) inserts `session_type: 'form_fill'` into `automation_sessions` and
   `throw`s `Failed to create automation session: ...` if the insert errors. Live
   table's real columns (`id, organization_id, application_id, opportunity_id,
   funder_id, status, target_url, mapped_fields, unmapped_fields,
   confirmation_number, error_message, notes, started_by, approved_by, started_at,
   completed_at, created_at, updated_at`) have no `session_type`. `MIGRATION_AUDIT.md`
   called this column "type-only references... superseded design" — that conclusion
   appears wrong; this is a real, currently-invoked write.
6. **`alerts.title`/`alert_type`** — `src/app/api/activity/route.ts:83-88` selects
   `"id, title, message, alert_type, created_at"` from `alerts`. Live columns:
   `id, organization_id, type, severity, message, link, is_read, read_at,
   is_dismissed, dismissed_at, snoozed_until, opportunity_id, application_id,
   deadline_id, dedup_key, created_by, created_at, updated_at` — has `type`, not
   `alert_type`; no `title` at all (only `message`). Breaks the dashboard activity feed's
   alerts panel. New finding, not in `MIGRATION_AUDIT.md`.
7. **`intelligence_grantmaker_profiles` — 6 columns, and this also contradicts
   `MIGRATION_AUDIT.md`'s "abandoned redesign, no live consumer" verdict for migration
   060.** `src/lib/intelligence/funder-recommender.ts:41,129-130`,
   `src/lib/intelligence/grantmaker-profiles.ts:66,109,181-182`,
   `src/app/(dashboard)/intelligence-library/dashboard/DashboardClient.tsx:290,365`, and
   `src/lib/intelligence/unified-search.ts:208` all actively select `program_priorities`,
   `name`, `foundation_id`, `total_annual_giving`, `typical_award_range`, and/or
   `language_patterns` — the exact "new" column names migration 060 tried to add and
   `MIGRATION_AUDIT.md` said had zero live consumers. These are real, current call
   sites across a funder-recommendation engine, a dashboard client component, and
   unified search — not dead code.
8. **`funder_relationship_scores` — 8 missing columns, wider blast radius than
   `MIGRATION_AUDIT.md` documented.** Confirms the audit's migrations-038/039 findings
   (`relationship_score`, `is_stale`, `trend`, `last_interaction_at`, `recent_events`,
   `total_interactions`, `successful_applications`, `updated_at`), but this pass found
   **`src/lib/agents/relationship-builder-agent.ts:734,793`** also reads/writes
   `relationship_score`, `trend`, and `updated_at` on this table — a live consumer
   `MIGRATION_AUDIT.md` didn't cite, in addition to the `funders` page, `FunderDetail.tsx`,
   and `funder-relationship.ts` it did cite.
9. **`opportunities.is_high_priority`/`match_mismatch_reasons`** — confirmed, matches
   `MIGRATION_AUDIT.md`'s "highest-standing wired-agent write failure" (012/025/026,
   carried 3 sessions). `src/lib/agents/eligibility-scorer.ts:180`.
10. **`custom_api_connections.error_count`** — confirmed, matches migration 034 finding;
    Agent 19's 3-failures auto-pause (Behavioral Contracts §20) cannot function.
11. **`webhook_configs.type`/`is_active`** — confirmed, matches the `052_webhook_configs.sql`
    finding exactly (live table has `webhook_type`/`active` from 051's competing
    definition). `src/lib/autoapply/webhook-notifier.ts:96,98` and
    `src/app/api/autoapply/webhooks/route.ts:108`.

### B. Confirmed silent failures (write/read no-ops, no thrown error)

12. **`submission_queue.error_message`** — `worker/queue-processor.ts:292-299` updates
    `{ status: 'requires_account_setup', error_message: err.message, ... }` on
    `AccountSetupRequiredError`, without checking the update's result. Live columns
    (`id, organization_id, funder_id, priority, status, automation_mode,
    scheduled_for, started_at, completed_at, submission_id, created_at,
    request_profile_id`) have no `error_message` — the write silently no-ops. New
    finding; same failure pattern as the already-known `risk_score`/`risk_factors` gap
    on the same table (`worker/queue-processor.ts:918`, confirmed here too — corroborates
    `052_governance_layer.sql` and memory `benavora-risk-score-columns-missing-silent-write-failure`).
13. **`knowledge_queries.organization_id`** — `src/lib/intelligence/knowledge-engine.ts:109`
    inserts inside a `try {} catch {}` that swallows the error. Live column is `org_id`.
    Silent no-op on every knowledge-engine query log. Contradicts
    `MIGRATION_AUDIT.md`'s "superseded, app uses org_id" verdict the same way as findings
    #1/#2 above — worth checking whether that "unchanged, no active bug" conclusion for
    migration 096 needs the same correction as 094/095.

### C. Entirely missing tables, clustered by feature area (dormant or unbuilt)

These corroborate `MIGRATION_AUDIT.md`'s existing NOT-APPLIED list closely (see next
section) — grouped here by feature to show blast radius:

- **AutoApply governance/risk layer** (`052_governance_layer.sql`, confirmed unchanged):
  `funder_relationships` (9 refs), `queue_controls` (13 refs, `admin/autoapply-ops`
  route + the entire `lib/autoapply/queue-controls.ts` module), `submission_usage`
  (9 refs), `tier_limits` (5 refs) — all live-wired into `usage-meter.ts`,
  `alerting.ts`, `response-analytics.ts`, and the usage page.
- **Relationship Intelligence Graph — NOT in `MIGRATION_AUDIT.md` at all.**
  `pig_nodes` (10 refs) / `pig_edges` (8 refs) back
  `src/app/api/intelligence/relationship-graph/route.ts`,
  `.../relationship-graph/analytics/route.ts`, `relationship-builder-agent.ts`, and
  `relationship-graph-builder-agent.ts` — an entire live API + two dedicated agents
  with zero backing tables in any migration file found in either tree.
- **Autonomous Digest / Reputation / Relationship cluster — NOT in
  `MIGRATION_AUDIT.md`.** `relationship_recommendations` (6), `reputation_alerts` (6),
  `reputation_signals` (1), `relationship_memory` (2), `digest_item_log` (4),
  `digest_priority_weights` (3), `deadline_predictions` (3) — all referenced from
  `autonomous-digest-agent.ts`, `morning-digest.ts`, `strategic-advisor-agent.ts`,
  `reputation-agent.ts`, `relationship-builder-agent.ts`, and
  `worker/autonomous-orchestrator.ts`. This looks like a large, coherent feature slice
  (the autonomous morning-digest/relationship/reputation intelligence system) that was
  built entirely against a schema that was never migrated, in either migrations tree.
- **Financials**: `grant_budgets` (8), `grant_expenses` (6),
  `grant_reconciliation_reports` (1) — confirms `084_grant_financials.sql`/
  `089_financial_reconciliation.sql`.
- **Compliance**: `compliance_requirements` (3), `compliance_events` (4) — confirms
  `085`/`090`.
- **SchoolFunder**: `schoolfunder_students` (6), `schoolfunder_donations` (3),
  `schoolfunder_volunteer_hours` (3) — confirms `103_schoolfunder.sql`.
- **Corporate Intelligence Engine**: `corporate_prospects` (18 refs — more than any
  prior incident note found: includes `ag-22-propensity-scoring.ts`,
  `corporate-enrichment-shared.ts`, `corporate-acquisition-adapter.ts`,
  `worker/enrichment-processor.ts`, `donor-intent-monitor-agent.ts`, and
  `relationship-graph-builder-agent.ts`) — confirms `107_corporate_prospects.sql`.
- **Universal Scraper**: `scrape_jobs` (2), `scrape_results` (1) — confirms
  `110_scrape_jobs_universal_scraper.sql`.
- **AutoApply misc**: `ab_test_variants` (8), `session_recordings` (3),
  `org_settings` (2) — confirms `053`/`080`.
- **Outreach**: `followup_sequences` (2), `outreach_templates` (2) — confirms `082`/`083`
  (note: `083`'s second table, `followup_enrollments`, has zero code references anywhere
  in `src/`/`worker/` — genuinely dead, more so than even the audit implied).
- **Misc, not in `MIGRATION_AUDIT.md` at all**: `disaster_declarations` (5) +
  `disaster_emergency_funds` (1) (Disaster Response Agent, entire feature unbacked),
  `funding_forecasts` (1, Strategic Advisor Agent), `funding_sources` (5, confirms
  `097`), `state_portals` (1, Settings → Integrations page),
  `knowledge_base_entries` (3), `application_followups` (3), `notification_preferences`
  (3, confirms `087`), `consultant_client_access` (3, confirms `086`),
  `org_portal_accounts` (1, confirms `102`), `stripe_webhook_events` (2, confirms
  memory `benavora-stripe-webhook-real-location-and-tables` — still absent on a fresh
  fetch today).
- **`knowledge_base_entries` is very likely a naming bug, not a missing migration.**
  `src/app/api/autoapply/templates/test/route.ts:95`, `form-filler-agent.ts:383`, and
  `org-profile-mapper.ts:192` all query `.from('knowledge_base_entries')` — no such
  table, and no migration file anywhere defines one. Project memory
  `benavora-notification-center-two-systems`-adjacent memory
  (`benavora-two-parallel-migrations-directories`) already established "Real KB table
  is `knowledge_base`" for an unrelated reason; these three call sites look like they
  should target `knowledge_base` and were never wired to it. Worth a follow-up read of
  those three files specifically — flagging here as discovery only, not fixed.

## Corroborates `MIGRATION_AUDIT.md`

Point-for-point matches (table/column existence agrees exactly with that audit's
conclusions): `stripe_webhook_events` (008), `opportunities.is_high_priority`/
`match_mismatch_reasons` (012/025/026), `custom_api_connections.error_count` (034),
`automation_notifications.title`/`related_entity_type`/`related_entity_id` (036),
`funder_giving_history.grant_purpose` (037), `success_probability_scores.data_quality`/
`updated_at` and `competitor_tracking.competition_level`/`estimated_applicants`/
`observed_at`/`opportunity_id` (038), `funder_relationship_scores` (038/039),
`funder_relationships`/`queue_controls`/`submission_usage`/`tier_limits` and
`submission_queue.risk_score`/`risk_factors` (052_governance_layer), `webhook_configs.type`/
`is_active` (052_webhook_configs), `session_recordings`/`ab_test_variants` (053),
`intelligence_grantmaker_profiles` column set (060, though see the contradiction noted
above for the "no active bug" part), `donor_discovery_prospects.scored_at` (078),
`donor_discovery_prospects.enrichment_private` (079), `org_settings` (080),
`outreach_templates` (082), `followup_sequences` (083), `grant_budgets`/`grant_expenses`
(084), `compliance_requirements` (085), `consultant_client_access` (086),
`notification_preferences` (087), `grant_reconciliation_reports` (089),
`compliance_events` (090), `agent_registry.avg_tokens_per_run` (094),
`organizational_digital_twins.twin_auto_populate_log` (101), `org_portal_accounts` (102),
`schoolfunder_students`/`schoolfunder_donations`/`schoolfunder_volunteer_hours` (103),
`organizations.extended_profile` (104), `applications.metadata` (105), `corporate_prospects`
(107), `scrape_jobs`/`scrape_results` (110), `funding_sources` (097).

## New findings not in `MIGRATION_AUDIT.md`

Not present anywhere in that document's NOT-APPLIED list, its "confirmed dead" list, or
its enum-gap section:

- **`agent_configurations.organization_id`/`updated_at` and
  `discovery_matches.organization_id`** — likely **corrections**, not just additions:
  `MIGRATION_AUDIT.md` explicitly said these are dead/superseded because "real
  consumers... query org_id"; direct code inspection shows the opposite for the exact
  files it named (see Priority items #1/#2 above).
- **`knowledge_queries.organization_id`** — same pattern, weaker confidence (only one
  call site, inside a swallowed `try/catch`), flagged as worth the same re-check.
- **`automation_sessions.session_type`** — `MIGRATION_AUDIT.md` said no live consumer;
  `worker/queue-processor.ts:1554` is one, and it throws (Priority #5).
- **`platform_learning_patterns` now exists live** (contradicts memory
  `benavora-two-parallel-migrations-directories`'s "confirmed absent" note from
  2026-07-20) but is still missing `confidence`/`weight`, which the live
  `learning-network-aggregator-agent.ts` writes and throws on.
- **`alerts.title`/`alert_type`** — not mentioned in `MIGRATION_AUDIT.md` at all.
- **`board_members.org_id`/`role`/`active`/`expertise`** — 4 columns, 6 files
  (`relationship-builder-agent.ts`, `relationship-graph-builder-agent.ts`,
  `strategic-advisor-agent.ts`, `intelligence/relationship-graph/*` routes) — `board_members`
  isn't mentioned anywhere in `MIGRATION_AUDIT.md`.
- **`pig_nodes`/`pig_edges`** (Relationship Intelligence Graph, 18 combined refs) — an
  entire live API + 2 agents with no backing table in either migrations tree.
- **The Autonomous Digest/Reputation/Relationship table cluster** — `relationship_recommendations`,
  `reputation_alerts`, `reputation_signals`, `relationship_memory`, `digest_item_log`,
  `digest_priority_weights`, `deadline_predictions` (7 tables, 25 combined refs) — none
  appear in `MIGRATION_AUDIT.md`.
- **Disaster Response Agent** (`disaster_declarations`, `disaster_emergency_funds`) and
  **Strategic Advisor's `funding_forecasts`** — not mentioned in `MIGRATION_AUDIT.md`.
- **`state_portals`** (Settings → Integrations page) and **`knowledge_base_entries`**
  (likely should be `knowledge_base` — see note above) and **`application_followups`**
  — none mentioned in `MIGRATION_AUDIT.md`.
- **`submission_queue.error_message`** — a second silent-write-failure column on the
  same table as the already-known `risk_score`/`risk_factors` gap, triggered on the
  `AccountSetupRequiredError` path specifically.
- **`opportunity_probability_scores.org_id`**, **`improvement_proposals.affected_agent_id`**,
  **`org_learning_contributions.anonymized`/`outcome_id`/`source_hash`**,
  **`agent_decisions.action_payload`/`agent_run_id`/`human_reviewer_id`**,
  **`agent_performance_metrics.runs_failed`**, **`email_templates.subject`/`body`**,
  **`form_templates.automation_assessment`**, **`organizations.analytics`/`service_areas`**,
  **`funders.city`/`state`/`avg_cycle_length_days`/`next_predicted_open_date`**,
  **`pitch_cache.request_type`**, **`scraping_targets.updated_at`** (this one *is* in
  `MIGRATION_AUDIT.md`, but listed as "cosmetic, no functional consumer" — this pass
  found 2 live consumer sites in `custom-scrape.ts`, contradicting that "no consumer"
  characterization) — none of these appear in `MIGRATION_AUDIT.md`'s NOT-APPLIED list at
  all; likely out-of-scope for that audit because no migration file in either tree
  defines these columns/tables in the first place (code-only drift, nothing to trace
  back to a migration).

## Full findings (74 tables, alphabetical)

Every table from the 178 referenced in code that has at least one drift finding (missing
table, or missing column). Tables not listed here had every referenced column present
live — no finding. `kind` suffixes on file:line entries (`select`/`insert`/`update`/
`upsert`/`eq`/`order`/etc., and `-shorthand` for JS object shorthand properties) show how
the column was referenced.

### `ab_test_variants` — MISSING TABLE

Referenced 8 time(s), table absent from live production schema entirely:

- `src/app/api/autoapply/ab-tests/route.ts:109`
- `src/app/api/autoapply/ab-tests/route.ts:67`
- `src/lib/autoapply/ab-testing.ts:132`
- `src/lib/autoapply/ab-testing.ts:143`
- `src/lib/autoapply/ab-testing.ts:176`
- `src/lib/autoapply/ab-testing.ts:214`
- `src/lib/autoapply/ab-testing.ts:234`
- `src/lib/autoapply/ab-testing.ts:70`

### `agent_configurations` — LIVE, MISSING COLUMNS

Table exists live. Missing columns:

- **`organization_id`**
  - `src/app/api/agents/registry/configure/route.ts:62:upsert`
  - `src/app/api/agents/registry/route.ts:66:eq`
- **`updated_at`**
  - `src/app/api/agents/registry/configure/route.ts:62:upsert`

### `agent_decisions` — LIVE, MISSING COLUMNS

Table exists live. Missing columns:

- **`action_payload`**
  - `src/app/api/autonomous/decisions/route.ts:104:select`
  - `src/app/api/autonomous/decisions/route.ts:125:select`
  - `src/lib/agents/autonomous-base.ts:107:insert`
  - `worker/autoapply-autonomous-orchestrator.ts:352:insert`
- **`agent_run_id`**
  - `src/app/api/autonomous/decisions/route.ts:39:select`
  - `src/lib/agents/autonomous-base.ts:107:insert`
  - `worker/autoapply-autonomous-orchestrator.ts:352:insert`
- **`human_reviewer_id`**
  - `src/app/api/autonomous/decisions/route.ts:125:select`

### `agent_performance_metrics` — LIVE, MISSING COLUMNS

Table exists live. Missing columns:

- **`runs_failed`**
  - `src/lib/agents/self-improvement-agent.ts:584:select`

### `agent_registry` — LIVE, MISSING COLUMNS

Table exists live. Missing columns:

- **`avg_tokens_per_run`**
  - `src/app/api/agents/registry/route.ts:51:select`

### `alerts` — LIVE, MISSING COLUMNS

Table exists live. Missing columns:

- **`alert_type`**
  - `src/app/api/activity/route.ts:85:select`
- **`title`**
  - `src/app/api/activity/route.ts:85:select`

### `application_followups` — MISSING TABLE

Referenced 3 time(s), table absent from live production schema entirely:

- `src/lib/agents/followup-generator-agent.ts:196`
- `src/worker/jobs/process-followups.ts:129`
- `src/worker/jobs/process-followups.ts:164`

### `applications` — LIVE, MISSING COLUMNS

Table exists live. Missing columns:

- **`funder_id`**
  - `src/lib/agents/autonomous-digest-agent.ts:500:select`
  - `src/lib/agents/relationship-builder-agent.ts:742:eq`
- **`metadata`**
  - `src/app/(dashboard)/draft-generator/autonomous/page.tsx:149:select`
  - `src/app/api/drafts/[id]/humanize/route.ts:129:update`
  - `src/app/api/drafts/[id]/humanize/route.ts:250:update`
  - `src/app/api/drafts/[id]/humanize/route.ts:62:select`
  - `src/app/api/drafts/[id]/route.ts:42:select`

### `autoapply_submissions` — LIVE, MISSING COLUMNS

Table exists live. Missing columns:

- **`count`** (likely a false positive — see Known Limitations; PostgREST count-aggregate
  syntax `.select('count', {count:'exact', head:true})` misread as a literal column)
  - `src/lib/autoapply/response-analytics.ts:408:select`
- **`response_received_at`**
  - `src/lib/autoapply/response-analytics.ts:148:select`
  - `src/lib/autoapply/response-analytics.ts:271:select`
  - `src/lib/autoapply/response-analytics.ts:338:select`
- **`variant_id`**
  - `src/app/(dashboard)/autoapply/analytics/AnalyticsPageClient.tsx:407:select`

### `automation_notifications` — LIVE, MISSING COLUMNS

Table exists live. Missing columns:

- **`related_entity_id`**
  - `src/app/api/notifications/route.ts:159:insert`
  - `src/app/api/notifications/route.ts:50:select`
  - `src/components/autoapply/ManualQueue.tsx:538:insert`
  - `src/lib/agents/automation-worker.ts:369:insert`
  - `src/lib/calendar/reminder-engine.ts:166:insert`
  - `src/lib/calendar/reminder-engine.ts:217:insert`
  - `src/lib/drafts/auto-generator.ts:261:insert`
  - `src/lib/drafts/submission-bridge.ts:214:insert`
  - `src/lib/services/notification-dispatcher.ts:108:insert`
- **`related_entity_type`**
  - `src/app/api/notifications/route.ts:159:insert`
  - `src/app/api/notifications/route.ts:50:select`
  - `src/components/autoapply/ManualQueue.tsx:538:insert`
  - `src/lib/agents/automation-worker.ts:369:insert`
  - `src/lib/calendar/reminder-engine.ts:166:insert`
  - `src/lib/calendar/reminder-engine.ts:217:insert`
  - `src/lib/drafts/auto-generator.ts:261:insert`
  - `src/lib/drafts/submission-bridge.ts:214:insert`
  - `src/lib/services/notification-dispatcher.ts:108:insert`
- **`title`**
  - `src/app/api/notifications/route.ts:159:insert-shorthand`
  - `src/app/api/notifications/route.ts:50:select`
  - `src/components/autoapply/ManualQueue.tsx:538:insert`
  - `src/lib/agents/automation-worker.ts:369:insert-shorthand`
  - `src/lib/agents/custom-api.ts:148:insert`
  - `src/lib/agents/custom-scrape.ts:139:insert`
  - `src/lib/calendar/reminder-engine.ts:166:insert-shorthand`
  - `src/lib/calendar/reminder-engine.ts:217:insert`
  - `src/lib/drafts/auto-generator.ts:261:insert`
  - `src/lib/drafts/submission-bridge.ts:214:insert`
  - `src/lib/services/notification-dispatcher.ts:108:insert-shorthand`

### `automation_sessions` — LIVE, MISSING COLUMNS

Table exists live. Missing columns:

- **`session_type`**
  - `worker/queue-processor.ts:1554:insert`

### `board_members` — LIVE, MISSING COLUMNS

Table exists live. Missing columns:

- **`active`**
  - `src/lib/agents/relationship-builder-agent.ts:908:eq`
  - `src/lib/agents/relationship-graph-builder-agent.ts:936:eq`
  - `src/lib/agents/strategic-advisor-agent.ts:759:eq`
- **`expertise`**
  - `src/lib/agents/relationship-graph-builder-agent.ts:934:select`
- **`org_id`**
  - `src/app/api/intelligence/relationship-graph/analytics/route.ts:108:eq`
  - `src/app/api/intelligence/relationship-graph/route.ts:101:eq`
  - `src/app/api/intelligence/relationship-graph/route.ts:239:eq`
  - `src/lib/agents/relationship-builder-agent.ts:907:eq`
  - `src/lib/agents/relationship-graph-builder-agent.ts:935:eq`
  - `src/lib/agents/strategic-advisor-agent.ts:758:eq`
- **`role`**
  - `src/lib/agents/relationship-builder-agent.ts:906:select`
  - `src/lib/agents/relationship-graph-builder-agent.ts:934:select`

### `competitor_tracking` — LIVE, MISSING COLUMNS

Table exists live. Missing columns:

- **`competition_level`**
  - `src/app/(dashboard)/intelligence/competitors/page.tsx:162:select`
  - `src/lib/agents/success-probability.ts:109:select`
- **`estimated_applicants`**
  - `src/app/(dashboard)/intelligence/competitors/page.tsx:162:select`
- **`observed_at`**
  - `src/app/(dashboard)/intelligence/competitors/page.tsx:162:select`
  - `src/app/(dashboard)/intelligence/competitors/page.tsx:165:order`
  - `src/lib/agents/success-probability.ts:112:order`
- **`opportunity_id`**
  - `src/lib/agents/success-probability.ts:111:eq`

### `compliance_events` — MISSING TABLE

Referenced 4 time(s), table absent from live production schema entirely:

- `src/app/api/compliance/events/[id]/route.ts:20`
- `src/app/api/compliance/events/[id]/route.ts:40`
- `src/app/api/compliance/events/route.ts:123`
- `src/app/api/compliance/events/route.ts:36`

### `compliance_requirements` — MISSING TABLE

Referenced 3 time(s), table absent from live production schema entirely:

- `src/app/api/compliance/route.ts:201`
- `src/app/api/compliance/route.ts:242`
- `src/app/api/compliance/route.ts:62`

### `consultant_client_access` — MISSING TABLE

Referenced 3 time(s), table absent from live production schema entirely:

- `src/app/api/consultant/clients/route.ts:111`
- `src/app/api/consultant/clients/route.ts:144`
- `src/app/api/consultant/clients/route.ts:32`

### `corporate_prospects` — MISSING TABLE

Referenced 18 time(s), table absent from live production schema entirely:

- `src/app/(dashboard)/donor-discovery/intent-signals/page.tsx:434`
- `src/app/api/intelligence/outreach/generate/route.ts:71`
- `src/app/api/intelligence/outreach/prospects/route.ts:54`
- `src/lib/agents/ag-22-propensity-scoring.ts:166`
- `src/lib/agents/ag-22-propensity-scoring.ts:296`
- `src/lib/agents/ag-22-propensity-scoring.ts:352`
- `src/lib/agents/ag-22-propensity-scoring.ts:410`
- `src/lib/agents/corporate-enrichment-shared.ts:43`
- `src/lib/agents/corporate-enrichment-shared.ts:67`
- `src/lib/agents/donor-intent-monitor-agent.ts:439`
- `src/lib/agents/donor-intent-monitor-agent.ts:454`
- `src/lib/agents/relationship-graph-builder-agent.ts:947`
- `src/lib/sources/corporate-acquisition-adapter.ts:140`
- `src/lib/sources/corporate-acquisition-adapter.ts:148`
- `src/lib/sources/corporate-acquisition-adapter.ts:249`
- `src/lib/sources/corporate-acquisition-adapter.ts:258`
- `worker/enrichment-processor.ts:184`
- `worker/enrichment-processor.ts:198`

### `custom_api_connections` — LIVE, MISSING COLUMNS

Table exists live. Missing columns:

- **`error_count`**
  - `src/app/api/integrations/custom-api/[id]/route.ts:61:select`
  - `src/app/api/integrations/custom-api/route.ts:116:insert`
  - `src/app/api/integrations/custom-api/route.ts:130:select`
  - `src/app/api/integrations/custom-api/route.ts:38:select`
  - `src/lib/agents/custom-api.ts:117:update`
  - `src/lib/agents/custom-api.ts:134:update`
  - `src/lib/agents/custom-api.ts:72:select`

### `deadline_predictions` — MISSING TABLE

Referenced 3 time(s), table absent from live production schema entirely:

- `src/lib/agents/autonomous-digest-agent.ts:448`
- `src/lib/agents/deadline-prediction-agent.ts:353`
- `src/lib/agents/deadline-prediction-agent.ts:511`

### `digest_item_log` — MISSING TABLE

Referenced 4 time(s), table absent from live production schema entirely:

- `src/lib/agents/autonomous-digest-agent.ts:706`
- `src/lib/agents/autonomous-digest-agent.ts:734`
- `src/lib/agents/autonomous-digest-agent.ts:756`
- `src/lib/agents/autonomous-digest-agent.ts:886`

### `digest_priority_weights` — MISSING TABLE

Referenced 3 time(s), table absent from live production schema entirely:

- `src/lib/agents/autonomous-digest-agent.ts:911`
- `src/lib/agents/autonomous-digest-agent.ts:924`
- `src/lib/agents/autonomous-digest-agent.ts:945`

### `disaster_declarations` — MISSING TABLE

Referenced 5 time(s), table absent from live production schema entirely:

- `src/app/api/agents/disaster/route.ts:39`
- `src/lib/agents/disaster-response-agent.ts:137`
- `src/lib/agents/disaster-response-agent.ts:58`
- `src/lib/agents/disaster-response-agent.ts:64`
- `src/lib/agents/disaster-response-agent.ts:96`

### `disaster_emergency_funds` — MISSING TABLE

Referenced 1 time(s), table absent from live production schema entirely:

- `src/lib/agents/disaster-response-agent.ts:113`

### `discovery_matches` — LIVE, MISSING COLUMNS

Table exists live. Missing columns:

- **`organization_id`** (see Priority finding #2 — contradicts `MIGRATION_AUDIT.md`'s
  "real consumers use org_id" claim for this exact table/files)
  - `src/app/api/agents/discovery/route.ts:55:eq`
  - `src/lib/agents/morning-digest.ts:38:eq`

### `donor_discovery_prospects` — LIVE, MISSING COLUMNS

Table exists live. Missing columns:

- **`enrichment_private`**
  - `src/worker/jobs/run-connector-enrichment.ts:120:select`
  - `src/worker/jobs/run-connector-enrichment.ts:204:update`
- **`scored_at`**
  - `src/lib/donor-discovery/scoring-engine.ts:516:update`

### `email_templates` — LIVE, MISSING COLUMNS

Table exists live. Missing columns:

- **`body`**
  - `src/app/api/donor-discovery/prospects/[id]/route-to-email/route.ts:139:insert`
  - `src/app/api/email/templates/route.ts:122:select`
  - `src/app/api/email/templates/route.ts:75:insert`
  - `src/lib/email/sequence-engine.ts:167:select`
- **`subject`**
  - `src/app/api/donor-discovery/prospects/[id]/route-to-email/route.ts:139:insert`
  - `src/app/api/email/templates/route.ts:122:select`
  - `src/app/api/email/templates/route.ts:75:insert`
  - `src/lib/email/sequence-engine.ts:167:select`

### `followup_sequences` — MISSING TABLE

Referenced 2 time(s), table absent from live production schema entirely:

- `src/app/api/outreach/sequences/route.ts:21`
- `src/app/api/outreach/sequences/route.ts:62`

### `form_templates` — LIVE, MISSING COLUMNS

Table exists live. Missing columns:

- **`automation_assessment`**
  - `src/lib/agents/form-analyzer.ts:149:insert`
  - `src/lib/autoapply/form-analyzer-agent.ts:240:insert`

### `funder_giving_history` — LIVE, MISSING COLUMNS

Table exists live. Missing columns:

- **`grant_purpose`**
  - `src/lib/agents/competitor-intel.ts:97:select`

### `funder_relationship_scores` — LIVE, MISSING COLUMNS

Table exists live. Missing columns:

- **`is_stale`**
  - `src/app/(dashboard)/funders/page.tsx:48:select`
  - `src/components/funders/FunderDetail.tsx:166:select`
  - `src/lib/agents/funder-relationship.ts:139:upsert`
- **`last_interaction_at`**
  - `src/lib/agents/funder-relationship.ts:100:select`
  - `src/lib/agents/funder-relationship.ts:139:upsert`
- **`recent_events`**
  - `src/lib/agents/funder-relationship.ts:100:select`
  - `src/lib/agents/funder-relationship.ts:139:upsert`
- **`relationship_score`**
  - `src/app/(dashboard)/funders/page.tsx:48:select`
  - `src/components/funders/FunderDetail.tsx:166:select`
  - `src/lib/agents/funder-relationship.ts:100:select`
  - `src/lib/agents/funder-relationship.ts:139:upsert`
  - `src/lib/agents/relationship-builder-agent.ts:734:select`
  - `src/lib/agents/relationship-builder-agent.ts:793:upsert`
- **`successful_applications`**
  - `src/lib/agents/funder-relationship.ts:100:select`
  - `src/lib/agents/funder-relationship.ts:139:upsert`
- **`total_interactions`**
  - `src/lib/agents/funder-relationship.ts:100:select`
  - `src/lib/agents/funder-relationship.ts:139:upsert`
- **`trend`**
  - `src/components/funders/FunderDetail.tsx:166:select`
  - `src/lib/agents/funder-relationship.ts:139:upsert-shorthand`
  - `src/lib/agents/relationship-builder-agent.ts:793:upsert`
- **`updated_at`**
  - `src/lib/agents/funder-relationship.ts:139:upsert`
  - `src/lib/agents/relationship-builder-agent.ts:793:upsert`

### `funder_relationships` — MISSING TABLE

Referenced 9 time(s), table absent from live production schema entirely:

- `src/lib/autoapply/follow-up-scheduler.ts:159`
- `src/lib/autoapply/relationship-manager.ts:114`
- `src/lib/autoapply/relationship-manager.ts:133`
- `src/lib/autoapply/relationship-manager.ts:150`
- `src/lib/autoapply/relationship-manager.ts:193`
- `src/lib/autoapply/relationship-manager.ts:49`
- `src/lib/autoapply/relationship-manager.ts:83`
- `src/lib/autoapply/risk-engine.ts:129`
- `src/lib/autoapply/risk-engine.ts:98`

### `funders` — LIVE, MISSING COLUMNS

Table exists live. Missing columns:

- **`avg_cycle_length_days`**
  - `src/lib/agents/deadline-prediction-agent.ts:786:update`
- **`city`**
  - `src/lib/autoapply/auto-queue-populator.ts:195:select`
- **`next_predicted_open_date`**
  - `src/lib/agents/deadline-prediction-agent.ts:786:update`
- **`portal_type`**
  - `worker/autoapply-autonomous-orchestrator.ts:261:select`
  - `worker/autoapply-autonomous-orchestrator.ts:271:select`
  - `worker/autoapply-autonomous-orchestrator.ts:282:insert`
  - `worker/autoapply-autonomous-orchestrator.ts:299:update`
- **`state`**
  - `src/lib/autoapply/auto-queue-populator.ts:195:select`

### `funding_forecasts` — MISSING TABLE

Referenced 1 time(s), table absent from live production schema entirely:

- `src/lib/agents/strategic-advisor-agent.ts:567`

### `funding_sources` — MISSING TABLE

Referenced 5 time(s), table absent from live production schema entirely:

- `src/app/(dashboard)/research/page.tsx:561`
- `src/app/api/sources/registry/route.ts:27`
- `src/app/api/sources/registry/route.ts:31`
- `src/lib/sources/state-sources-registry.ts:511`
- `src/lib/sources/state-sources-registry.ts:526`

### `grant_budgets` — MISSING TABLE

Referenced 8 time(s), table absent from live production schema entirely:

- `src/app/(dashboard)/financials/page.tsx:95`
- `src/app/api/applications/[id]/budget/route.ts:143`
- `src/app/api/applications/[id]/budget/route.ts:168`
- `src/app/api/applications/[id]/budget/route.ts:173`
- `src/app/api/applications/[id]/budget/route.ts:78`
- `src/app/api/applications/[id]/reconcile/route.ts:37`
- `src/app/api/financials/budgets/route.ts:32`
- `src/app/api/financials/budgets/route.ts:85`

### `grant_expenses` — MISSING TABLE

Referenced 6 time(s), table absent from live production schema entirely:

- `src/app/(dashboard)/financials/page.tsx:98`
- `src/app/api/applications/[id]/expenses/route.ts:117`
- `src/app/api/applications/[id]/expenses/route.ts:47`
- `src/app/api/applications/[id]/reconcile/route.ts:50`
- `src/app/api/financials/expenses/route.ts:24`
- `src/app/api/financials/expenses/route.ts:80`

### `grant_reconciliation_reports` — MISSING TABLE

Referenced 1 time(s), table absent from live production schema entirely:

- `src/app/api/applications/[id]/reconcile/route.ts:75`

### `improvement_proposals` — LIVE, MISSING COLUMNS

Table exists live. Missing columns:

- **`affected_agent_id`**
  - `src/lib/agents/self-improvement-agent.ts:1145:insert`
  - `src/lib/agents/self-improvement-agent.ts:949:eq`

### `intelligence_grantmaker_profiles` — LIVE, MISSING COLUMNS

Table exists live. Missing columns:

- **`foundation_id`**
  - `src/lib/intelligence/funder-recommender.ts:130:eq`
  - `src/lib/intelligence/funder-recommender.ts:41:select`
  - `src/lib/intelligence/grantmaker-profiles.ts:109:select`
  - `src/lib/intelligence/grantmaker-profiles.ts:182:eq`
  - `src/lib/intelligence/grantmaker-profiles.ts:66:eq`
  - `src/lib/intelligence/unified-search.ts:208:select`
- **`language_patterns`**
  - `src/lib/intelligence/grantmaker-profiles.ts:181:select`
- **`name`**
  - `src/app/(dashboard)/intelligence-library/dashboard/DashboardClient.tsx:365:select`
  - `src/lib/intelligence/funder-recommender.ts:129:select`
  - `src/lib/intelligence/funder-recommender.ts:41:select`
  - `src/lib/intelligence/grantmaker-profiles.ts:109:select`
  - `src/lib/intelligence/unified-search.ts:208:select`
- **`program_priorities`**
  - `src/app/(dashboard)/intelligence-library/dashboard/DashboardClient.tsx:290:select`
  - `src/lib/intelligence/funder-recommender.ts:129:select`
  - `src/lib/intelligence/funder-recommender.ts:41:select`
  - `src/lib/intelligence/grantmaker-profiles.ts:109:select`
  - `src/lib/intelligence/unified-search.ts:208:select`
- **`total_annual_giving`**
  - `src/lib/intelligence/funder-recommender.ts:129:select`
  - `src/lib/intelligence/funder-recommender.ts:41:select`
  - `src/lib/intelligence/grantmaker-profiles.ts:109:select`
- **`typical_award_range`**
  - `src/lib/intelligence/funder-recommender.ts:129:select`
  - `src/lib/intelligence/funder-recommender.ts:41:select`
  - `src/lib/intelligence/grantmaker-profiles.ts:109:select`

### `knowledge_base_entries` — MISSING TABLE

Referenced 3 time(s), table absent from live production schema entirely. Likely should
be `knowledge_base` (the real, live KB table per project memory) — see note above.

- `src/app/api/autoapply/templates/test/route.ts:95`
- `src/lib/autoapply/form-filler-agent.ts:383`
- `src/lib/autoapply/org-profile-mapper.ts:192`

### `knowledge_queries` — LIVE, MISSING COLUMNS

Table exists live. Missing columns:

- **`organization_id`** (write is inside a swallowed `try/catch` — silent no-op, not a
  throw; see Priority finding #13)
  - `src/lib/intelligence/knowledge-engine.ts:109:insert`

### `notification_preferences` — MISSING TABLE

Referenced 3 time(s), table absent from live production schema entirely:

- `src/app/api/settings/notifications/route.ts:100`
- `src/app/api/settings/notifications/route.ts:40`
- `src/lib/notifications/notify.ts:31`

### `opportunities` — LIVE, MISSING COLUMNS

Table exists live. Missing columns:

- **`eligibility_text`**
  - `src/lib/intelligence/rubric-extractor.ts:85:select`
- **`funder_name`**
  - `src/lib/intelligence/rubric-extractor.ts:85:select`
- **`is_high_priority`**
  - `src/lib/agents/eligibility-scorer.ts:180:update`
- **`match_mismatch_reasons`**
  - `src/lib/agents/eligibility-scorer.ts:180:update`
- **`probability_score`**
  - `src/app/api/admin/orgs/[id]/route.ts:82:select`
  - `src/lib/reports/board-report-page.ts:120:select`
- **`raw_content`**
  - `src/lib/intelligence/rubric-extractor.ts:85:select`
- **`requirements`**
  - `src/lib/intelligence/rubric-extractor.ts:85:select`
- **`title`**
  - `src/lib/intelligence/rubric-extractor.ts:85:select`

### `opportunity_probability_scores` — LIVE, MISSING COLUMNS

Table exists live. Missing columns:

- **`org_id`**
  - `src/lib/agents/autonomous-digest-agent.ts:590:eq`
  - `src/lib/agents/opportunity-discovery-agent.ts:556:eq`

### `org_autonomous_config` — LIVE, MISSING COLUMNS

Table exists live. Missing columns:

- **`auto_autoapply_enabled`**
  - `src/app/api/autoapply/autonomous-status/route.ts:33:select`
  - `src/lib/agents/donor-intent-monitor-agent.ts:490:select`
  - `src/lib/payments/stripe.ts:315:update`
  - `worker/autoapply-autonomous-orchestrator.ts:158:select`
  - `worker/autoapply-autonomous-orchestrator.ts:196:select`
  - `worker/autoapply-autonomous-orchestrator.ts:198:eq`
- **`max_nightly_autoapply_submissions`**
  - `src/app/api/autoapply/autonomous-status/route.ts:33:select`
  - `src/lib/agents/donor-intent-monitor-agent.ts:490:select`
  - `worker/autoapply-autonomous-orchestrator.ts:196:select`
- **`updated_at`**
  - `src/lib/payments/stripe.ts:315:update`

### `org_learning_contributions` — LIVE, MISSING COLUMNS

Table exists live. Missing columns:

- **`anonymized`**
  - `src/lib/agents/learning-network-aggregator-agent.ts:1051:insert`
- **`outcome_id`**
  - `src/lib/agents/learning-network-aggregator-agent.ts:1051:insert`
  - `src/lib/agents/learning-network-aggregator-agent.ts:1075:eq`
  - `src/lib/agents/learning-network-aggregator-agent.ts:1094:neq`
- **`source_hash`**
  - `src/lib/agents/learning-network-aggregator-agent.ts:1051:insert`
  - `src/lib/agents/learning-network-aggregator-agent.ts:1093:eq`

### `org_portal_accounts` — MISSING TABLE

Referenced 1 time(s), table absent from live production schema entirely:

- `worker/queue-processor.ts:1700`

### `org_settings` — MISSING TABLE

Referenced 2 time(s), table absent from live production schema entirely:

- `src/app/api/autoapply/mode/route.ts:26`
- `src/app/api/autoapply/mode/route.ts:68`

### `organizational_digital_twins` — LIVE, MISSING COLUMNS

Table exists live. Missing columns:

- **`twin_auto_populate_log`**
  - `src/lib/intelligence/twin-auto-populate.ts:903:update`

### `organizations` — LIVE, MISSING COLUMNS

Table exists live. Missing columns:

- **`analytics`**
  - `src/lib/agents/outcome-analyzer-agent.ts:194:select`
  - `src/lib/agents/outcome-analyzer-agent.ts:202:update`
- **`extended_profile`**
  - `src/app/(dashboard)/dashboard/page.tsx:302:select`
- **`service_areas`**
  - `src/lib/agents/donor-intent-monitor-agent.ts:409:select`
  - `src/lib/agents/strategic-advisor-agent.ts:453:select`

### `outreach_templates` — MISSING TABLE

Referenced 2 time(s), table absent from live production schema entirely:

- `src/app/api/outreach/templates/route.ts:31`
- `src/app/api/outreach/templates/route.ts:78`

### `pig_edges` — MISSING TABLE

Referenced 8 time(s), table absent from live production schema entirely:

- `src/app/api/intelligence/relationship-graph/analytics/route.ts:146`
- `src/app/api/intelligence/relationship-graph/route.ts:122`
- `src/app/api/intelligence/relationship-graph/route.ts:216`
- `src/app/api/intelligence/relationship-graph/route.ts:253`
- `src/lib/agents/relationship-builder-agent.ts:385`
- `src/lib/agents/relationship-graph-builder-agent.ts:1032`
- `src/lib/agents/relationship-graph-builder-agent.ts:571`
- `src/lib/agents/relationship-graph-builder-agent.ts:836`

### `pig_nodes` — MISSING TABLE

Referenced 10 time(s), table absent from live production schema entirely:

- `src/app/api/intelligence/relationship-graph/analytics/route.ts:118`
- `src/app/api/intelligence/relationship-graph/analytics/route.ts:131`
- `src/app/api/intelligence/relationship-graph/analytics/route.ts:163`
- `src/app/api/intelligence/relationship-graph/route.ts:109`
- `src/app/api/intelligence/relationship-graph/route.ts:140`
- `src/app/api/intelligence/relationship-graph/route.ts:228`
- `src/app/api/intelligence/relationship-graph/route.ts:246`
- `src/lib/agents/relationship-builder-agent.ts:350`
- `src/lib/agents/relationship-builder-agent.ts:493`
- `src/lib/agents/relationship-graph-builder-agent.ts:506`

### `pitch_cache` — LIVE, MISSING COLUMNS

Table exists live. Missing columns:

- **`request_type`**
  - `src/lib/autoapply/pitch-personalizer.ts:100:upsert`
  - `src/lib/autoapply/pitch-personalizer.ts:77:eq`

### `platform_learning_patterns` — LIVE, MISSING COLUMNS

Table exists live (contradicts project memory that it was fully absent — see Priority
finding #4). Missing columns:

- **`confidence`**
  - `src/lib/agents/learning-network-aggregator-agent.ts:1005:insert-shorthand`
- **`weight`**
  - `src/lib/agents/learning-network-aggregator-agent.ts:1005:insert`
  - `src/lib/agents/learning-network-aggregator-agent.ts:918:select`

### `queue_controls` — MISSING TABLE

Referenced 13 time(s), table absent from live production schema entirely:

- `src/app/api/admin/autoapply-ops/route.ts:70`
- `src/lib/autoapply/queue-controls.ts:115`
- `src/lib/autoapply/queue-controls.ts:135`
- `src/lib/autoapply/queue-controls.ts:155`
- `src/lib/autoapply/queue-controls.ts:175`
- `src/lib/autoapply/queue-controls.ts:198`
- `src/lib/autoapply/queue-controls.ts:217`
- `src/lib/autoapply/queue-controls.ts:222`
- `src/lib/autoapply/queue-controls.ts:44`
- `src/lib/autoapply/queue-controls.ts:61`
- `src/lib/autoapply/queue-controls.ts:78`
- `src/lib/autoapply/queue-controls.ts:95`
- `src/lib/drafts/submission-bridge.ts:280`

### `relationship_memory` — MISSING TABLE

Referenced 2 time(s), table absent from live production schema entirely:

- `src/lib/agents/relationship-builder-agent.ts:725`
- `src/lib/intelligence/reputation-agent.ts:434`

### `relationship_recommendations` — MISSING TABLE

Referenced 6 time(s), table absent from live production schema entirely:

- `src/lib/agents/autonomous-digest-agent.ts:617`
- `src/lib/agents/autonomous-digest-agent.ts:838`
- `src/lib/agents/morning-digest.ts:47`
- `src/lib/agents/relationship-builder-agent.ts:830`
- `src/lib/agents/relationship-builder-agent.ts:861`
- `src/lib/agents/strategic-advisor-agent.ts:625`

### `reputation_alerts` — MISSING TABLE

Referenced 6 time(s), table absent from live production schema entirely:

- `src/app/api/intelligence/reputation/route.ts:126`
- `src/app/api/intelligence/reputation/route.ts:79`
- `src/lib/agents/morning-digest.ts:42`
- `src/lib/agents/strategic-advisor-agent.ts:639`
- `src/lib/intelligence/reputation-agent.ts:390`
- `worker/autonomous-orchestrator.ts:531`

### `reputation_signals` — MISSING TABLE

Referenced 1 time(s), table absent from live production schema entirely. Also appears as
a joined/embedded-resource name (`reputation_alerts(...)`-nested select) in
`src/app/api/intelligence/reputation/route.ts:80` and
`src/lib/agents/strategic-advisor-agent.ts:640` — moot since the parent table
(`reputation_alerts`) is itself missing.

- `src/lib/intelligence/reputation-agent.ts:267`

### `schoolfunder_donations` — MISSING TABLE

Referenced 3 time(s), table absent from live production schema entirely:

- `src/app/(dashboard)/schoolfunder/page.tsx:124`
- `src/app/api/schoolfunder/donate/route.ts:84`
- `src/app/api/schoolfunder/route.ts:55`

### `schoolfunder_students` — MISSING TABLE

Referenced 6 time(s), table absent from live production schema entirely:

- `src/app/(dashboard)/schoolfunder/page.tsx:117`
- `src/app/api/schoolfunder/donate/route.ts:59`
- `src/app/api/schoolfunder/hours/route.ts:44`
- `src/app/api/schoolfunder/hours/route.ts:80`
- `src/app/api/schoolfunder/route.ts:146`
- `src/app/api/schoolfunder/route.ts:23`

### `schoolfunder_volunteer_hours` — MISSING TABLE

Referenced 3 time(s), table absent from live production schema entirely:

- `src/app/(dashboard)/schoolfunder/page.tsx:137`
- `src/app/api/schoolfunder/hours/route.ts:58`
- `src/app/api/schoolfunder/route.ts:41`

### `scrape_jobs` — MISSING TABLE

Referenced 2 time(s), table absent from live production schema entirely:

- `src/lib/scraper-v2/job-store.ts:153`
- `src/lib/scraper-v2/job-store.ts:58`

### `scrape_results` — MISSING TABLE

Referenced 1 time(s), table absent from live production schema entirely:

- `src/lib/scraper-v2/job-store.ts:105`

### `scraping_targets` — LIVE, MISSING COLUMNS

Table exists live. Missing columns:

- **`updated_at`** (`MIGRATION_AUDIT.md` called this "cosmetic, no functional consumer" —
  this pass found 2 real consumer sites)
  - `src/lib/agents/custom-scrape.ts:109:update`
  - `src/lib/agents/custom-scrape.ts:126:update`

### `session_recordings` — MISSING TABLE

Referenced 3 time(s), table absent from live production schema entirely:

- `src/app/(dashboard)/autoapply/recordings/page.tsx:301`
- `src/app/(dashboard)/autoapply/recordings/page.tsx:369`
- `worker/queue-processor.ts:1353`

### `state_portals` — MISSING TABLE

Referenced 1 time(s), table absent from live production schema entirely:

- `src/app/(dashboard)/settings/integrations/page.tsx:148`

### `stripe_webhook_events` — MISSING TABLE

Referenced 2 time(s), table absent from live production schema entirely:

- `src/app/api/webhooks/stripe/route.ts:56`
- `src/app/api/webhooks/stripe/route.ts:76`

### `submission_queue` — LIVE, MISSING COLUMNS

Table exists live. Missing columns:

- **`count`** (likely a false positive — see Known Limitations)
  - `src/lib/autoapply/response-analytics.ts:333:select`
- **`error_message`** (silent no-op — update result not checked; see Priority finding #12)
  - `worker/queue-processor.ts:294:update`
- **`risk_factors`**
  - `worker/queue-processor.ts:918:update`
- **`risk_score`**
  - `worker/queue-processor.ts:918:update`

### `submission_usage` — MISSING TABLE

Referenced 9 time(s), table absent from live production schema entirely:

- `src/app/(dashboard)/autoapply/usage/UsagePageClient.tsx:297`
- `src/app/api/admin/autoapply-ops/route.ts:135`
- `src/lib/autoapply/alerting.ts:76`
- `src/lib/autoapply/response-analytics.ts:402`
- `src/lib/autoapply/usage-meter.ts:188`
- `src/lib/autoapply/usage-meter.ts:285`
- `src/lib/autoapply/usage-meter.ts:319`
- `src/lib/autoapply/usage-meter.ts:333`
- `src/lib/autoapply/usage-meter.ts:351`

### `success_probability_scores` — LIVE, MISSING COLUMNS

Table exists live. Missing columns:

- **`data_quality`**
  - `src/lib/agents/success-probability.ts:168:upsert`
- **`updated_at`**
  - `src/lib/agents/success-probability.ts:168:upsert`

### `tier_limits` — MISSING TABLE

Referenced 5 time(s), table absent from live production schema entirely:

- `src/app/(dashboard)/autoapply/usage/UsagePageClient.tsx:307`
- `src/lib/autoapply/usage-meter.ts:172`
- `src/lib/autoapply/usage-meter.ts:276`
- `src/lib/autoapply/usage-meter.ts:369`
- `src/lib/autoapply/usage-meter.ts:424`

### `webhook_configs` — LIVE, MISSING COLUMNS

Table exists live. Missing columns:

- **`is_active`**
  - `src/app/(dashboard)/autoapply/webhooks/page.tsx:137:update`
  - `src/app/api/autoapply/webhooks/route.ts:108:insert`
  - `src/lib/autoapply/webhook-notifier.ts:98:eq`
- **`type`**
  - `src/app/api/autoapply/webhooks/route.ts:108:insert-shorthand`
  - `src/lib/autoapply/webhook-notifier.ts:96:select`

## Known limitations / false-positive risk

- **Regex-based extraction, not a real TS/SQL parser.** Two false-positive classes were
  found and fixed during this pass (worth naming so a future re-run doesn't reintroduce
  them): (1) `supabase.storage.from('bucket-name')` — Storage bucket references, not
  database tables — excluded by checking ~60 chars of preceding context for `storage`;
  (2) commented-out example code (e.g. a header comment block quoting
  `supabase.from('notifications').insert(...)` as an example of what *not* to do) — fixed
  by stripping `//` and `/* */` comment content (string-literal-aware) before matching.
  A prior, cruder version of this same script (informally run earlier the same day) had
  a third bug — a fixed-character "chain window" that misattributed later, unrelated
  statements (e.g. Google Calendar API's `calendar.events.insert({calendarId,
  requestBody})`) to whatever table's `.from()` call happened to precede it within 3000
  characters — fixed by terminating each chain at the actual statement boundary
  (first `;` at bracket-depth 0) instead of a raw character count.
- **`.select('count', {count:'exact', head:true})` count-aggregate syntax** on
  `submission_queue` and `autoapply_submissions` is flagged as a "missing column" named
  `count` — almost certainly not a real gap, just an artifact of this regex not
  special-casing that call shape (same false positive the informal earlier pass also
  hit). Noted inline above rather than silently dropped.
- **PostgREST embedded-resource/join syntax** (`.select('*, other_table(cols)')`) is
  excluded from column extraction on purpose (treated as a join, not a column) — this
  is why, e.g., `reputation_signals` shows up once as a missing table and separately as
  a joined-resource reference under `reputation_alerts(...)`, noted as moot in that
  table's entry above.
- **RLS/schema-exposure blind spot.** This audit used the service-role key (bypasses
  row-level security), but PostgREST's OpenAPI document only lists objects in its
  configured "exposed schema(s)" (typically just `public`). A table that exists in a
  non-exposed Postgres schema would still show as "missing" here even though it exists
  in the database. `stripe_webhook_events` is the one finding worth a direct
  `information_schema.tables` spot-check before treating as fully confirmed-missing, per
  the same caveat the prior informal pass raised.
- **`scripts/` was out of scope** for this pass per its stated purpose (code-in-production
  only) — a few tables/columns that `MIGRATION_AUDIT.md` cites with a `scripts/`-only
  consumer (e.g. `prospects.contact_name`/`contact_title`, whose only writer is
  `scripts/seed-outreach-prospects.ts`) correctly do **not** appear as findings here;
  that's expected, not a miss.
- **`.rpc(...)` calls were recorded but not verified** against live Postgres function
  signatures — 9 distinct RPC names found (`donor_discovery_claim_request`,
  `donor_discovery_geo_within_postgis`, `donor_discovery_increment_api_spend`,
  `donor_discovery_match_foundations`, `donor_discovery_upsert_directory_record`,
  `increment_usage_tracking`, `match_logic_models`, `match_proposal_sections`,
  `register_organization`) — worth a dedicated follow-up pass, same gap the informal
  earlier version of this audit flagged.
- **Dynamic/templated table or column names** (e.g. a table name built from a variable
  or template literal rather than a string literal) are invisible to this method by
  construction — an omission from coverage, not a false negative resolved in code's
  favor. Not quantified this pass; spot checks while verifying priority findings didn't
  surface any, but a systematic count wasn't done.
- **Destructured/shorthand JS properties that happen to share a column's name** are a
  real risk in principle (e.g. a local variable named `id` used as insert shorthand)
  but every shorthand-flagged finding above was manually read at its source line during
  verification and confirmed to be a genuine column write, not a coincidental name
  collision — see Priority section for specific reads (e.g.
  `platform_learning_patterns`'s `confidence`/`weight`, `automation_notifications`'s
  `title`).
- **This is table/column *existence* only** — like both `MIGRATION_AUDIT.md` passes, RLS
  policy correctness is not checked (PostgREST introspection doesn't expose
  `pg_policies`).

## Next step

Discovery only, per this task — nothing above was fixed. Given the volume, a reasonable
triage order: (1) the four Priority-A items that directly contradict `MIGRATION_AUDIT.md`'s
own "no active bug" conclusions (`agent_configurations`/`discovery_matches`
`organization_id` vs `org_id`, `automation_sessions.session_type`,
`intelligence_grantmaker_profiles`'s 6 columns, `scraping_targets.updated_at`) — these
need a second, independent look since two audits now disagree about live-code impact;
(2) the `platform_learning_patterns` table-existence correction to project memory; (3)
everything else, roughly in the priority order above.
