# MIGRATION_AUDIT.md
## Migration-vs-Production Schema Audit — RE-VERIFIED
**Original run: July 28, 2026. Re-verification run: July 30, 2026, after migrations 051 and 052 were manually applied via the Supabase SQL Editor.**

## Why this re-run happened

The July 28 audit found that migration 051 (`051_submission_intelligence.sql`) had silently never been applied to production. Reid applied 051 and 052 manually via the SQL Editor this session. The task for this pass was: confirm 051/052 are now actually live, and — critically — **do not assume they were the only gaps**. This re-run does not trust the July 28 audit's own conclusions; it re-derives table/column existence from scratch against the current live schema and flags every divergence from the July 28 report.

**Result: the July 28 audit itself had a real blind spot.** Its own methodology note said it couldn't distinguish "this migration's statements executed" from "an object with this name happens to exist." In practice its tooling checked table *existence* for `CREATE TABLE IF NOT EXISTS` migrations but did not fully verify every column those statements define — so when a table already existed (created earlier, with fewer/differently-named columns) and a later migration's `CREATE TABLE IF NOT EXISTS`/`ALTER TABLE ADD COLUMN` no-op'd against it, the July 28 pass marked the whole migration "APPLIED." This re-run parses every `CREATE TABLE` and `ALTER TABLE ... ADD COLUMN` statement (including ones nested inside `DO $$ ... $$` idempotent blocks, and multi-column `ADD COLUMN a, ADD COLUMN b` clauses under one `ALTER TABLE`) and checks **every individual column**, not just table presence. That stricter check surfaces **11 additional migrations** with real gaps that July 28 missed entirely (034, 035, 036, 037, 038, 039, 041, 094, 095, 096, plus the two brand-new files 107/110 that postdate that audit).

## Methodology (same as July 28, tightened)

1. Fetched the live production schema directly from project `vbjplpquqxxfbpazyalt` via `GET {SUPABASE_URL}/rest/v1/` with `Accept: application/openapi+json` and the service-role key (same PostgREST-introspection method as both prior audits). **153 tables/views** returned (up from 145 on July 28, up from 132 on July 19 — reflecting 051/052's tables landing, plus other changes).
2. Attempted the `claude.ai Supabase` MCP connector (newly available this session) as a possible faster/authoritative path — `list_projects` was denied by the permission gate, so this pass reverted to the proven direct-PostgREST method rather than retrying.
3. Also considered the Supabase Management API PAT from `BLUEPRINT_v2.md` §8.3 for `supabase_migrations.schema_migrations` — **not re-attempted this session** since it has returned 401 on every prior check (project memory `benavora-management-api-pat-rejected`); PostgREST introspection remains the sole source of truth.
4. **Parsed all 112 `.sql` files** now in `supabase/migrations/` (up from 108 on July 28 — four new files: `107_corporate_prospects.sql`, `108_corporate_prospects_ea06_ea10.sql`, `109_corporate_prospects_ag22_propensity_scoring.sql`, `110_scrape_jobs_universal_scraper.sql`). Extracted every `CREATE TABLE` and `ALTER TABLE ... ADD COLUMN` statement, including those nested inside `DO $$ BEGIN ... END $$` conditional blocks (a pattern used by ~10 migrations, e.g. 072/099/100/101/104/105, that the July 28 tooling appears to have skipped) and multi-column `ADD COLUMN x, ADD COLUMN y` clauses under a single `ALTER TABLE` (e.g. 039, 106).
5. Checked every extracted table/column against the live schema from step 1.
6. As a supplementary check (out of the original audit's stated scope, but cheap to verify since PostgREST exposes enum value lists inline on any column using that enum type), diffed every `ALTER TYPE agent_type ADD VALUE` and the one `ALTER TYPE subscription_tier ADD VALUE` statement across all 112 files against the live enum value lists. Findings below.
7. For every newly-missing table/column, grepped `src/`, `worker/`, and `scripts/` for live consumers, and where a consumer was found, read the actual query/write code to determine whether the gap is a **currently-active bug** (the live code queries/writes the missing name) or a **dead/superseded design** (no live code references it, or the app already uses a different column name that IS live).

**Same caveat as before:** this is table/column *existence*, not RLS policy correctness (PostgREST introspection doesn't expose `pg_policies`).

## Summary

- **Total migration files:** 112 (was 108)
- **APPLIED** (every `CREATE TABLE`/`ADD COLUMN` checked, found live): **55**
- **NOT APPLIED** (at least one missing table or column): **41**
- **NO_DDL** (no `CREATE TABLE`/`ADD COLUMN` in the file — enum additions, RLS fixes, data backfills; not part of the table/column check): **16**, three of which (005, 006, 007) turned out to have their *sole* statement — an enum value addition — also never applied (see enum section below)

### Migrations 051 and 052 — confirmed status

**051 (`051_submission_intelligence.sql`): FULLY APPLIED, confirmed.** All 8 tables now live with the exact columns the migration defines: `request_profiles`, `kb_extended_needs`, `pitch_cache`, `org_documents`, `submission_receipts`, `grant_agreements`, `webhook_configs`, `cross_client_submissions`. All 8 `submission_queue`/`autoapply_submissions` columns (`request_profile_id`, `submission_channel`, `personalized_pitch`, `optimized_amount`, `timing_score`, `confirmation_data`, `documents_attached`) are present. This was the AutoApply blocker from project memory `benavora-request-profiles-table-missing-blocks-autoapply` — it is now resolved.

**"052" is two files, and only one of them was actually fixed:**
- `052_webhook_configs.sql`: **NOT applied, and its gap now masks a live bug.** `webhook_configs` exists — but it was created by 051's definition (`webhook_type`, `active`, no `updated_at`), not this file's (`type`, `is_active`, `updated_at`). Since `051_submission_intelligence.sql` and `052_webhook_configs.sql` both use `CREATE TABLE IF NOT EXISTS webhook_configs` with different column names for the same concept, whichever ran first "won" and the other became a permanent no-op. **`src/lib/autoapply/webhook-notifier.ts:96,98` queries `.select('id, type, webhook_url, events').eq('is_active', true)` — both `type` and `is_active` are columns that do not exist on the live table.** This means the query errors on every call and `WebhookNotifier.notify()` silently returns without sending any webhook, for every org, for every event type, always. This is a new, currently-active bug this pass found — not present in the July 28 report at all (it only flagged the table as fully missing, which is no longer the case now that 051 landed).
- `052_governance_layer.sql`: **NOT applied — this is the larger and more consequential "052" file, and it appears Reid's manual fix did not include it.** `funder_relationships`, `queue_controls`, `submission_usage`, `tier_limits` are all still missing, and `submission_queue.risk_score`/`risk_factors` are still missing. This is the entire AutoApply governance/risk-gating/tier-limit layer — unchanged from July 28, still a real gap with 20+ live call sites across `risk-engine.ts`, `relationship-manager.ts`, `follow-up-scheduler.ts`, `usage-meter.ts`, `alerting.ts`, `response-analytics.ts`, and `/api/admin/autoapply-ops/route.ts`.

## Highest-priority findings — NEW this pass (beyond 051/052)

These were marked "APPLIED" by the July 28 audit (or not covered at all, for 107-110) but are confirmed broken against the live schema right now:

1. **`success_probability_scores.data_quality`/`updated_at` (migration 038) — the live, wired Success Probability Agent (Agent 22) throws on every run.** `src/lib/agents/success-probability.ts:166-179` does `.upsert({ ..., data_quality: dataQuality, calculated_at: ..., updated_at: ... }, { onConflict: "application_id" })`. Neither `data_quality` nor `updated_at` exists on the live table (live columns: `id, organization_id, application_id, probability_score, factors, calculated_at`). The upsert errors, and the code explicitly `throw new AgentError("Failed to save probability score.", "write_failed")` on that error — this is not a silent no-op, it's a hard failure on every invocation of a live agent.
2. **`funder_giving_history.grant_purpose` (migration 037) — Competitor Intel Agent's read fails.** `src/lib/agents/competitor-intel.ts:97` selects `"recipient_name, amount, grant_purpose, fiscal_year"` from `funder_giving_history`. The live table has `purpose`, not `grant_purpose` (and `recipient_ein`/`source_filing_url` instead of the migration's `source`) — the table was evidently created out-of-band with a different column layout than the checked-in `037_giving_history.sql` file defines. The query fails, breaking the agent's giving-history read. (Its later write to `competitor_tracking.grant_purpose` is fine — that column does exist on `competitor_tracking`, which was created by migration 040 instead.)
3. **`automation_notifications.title`/`related_entity_type`/`related_entity_id` (migration 036) — the notification dispatcher's insert shape doesn't match the live table.** Live table (confirmed via direct introspection, matching `SCHEMA_REGISTRY_v2.md`'s documented columns exactly): `id, organization_id, session_id, event_type, message, is_read, sent_via, created_at`. No `title`, no `related_entity_*`. `CREATE TABLE IF NOT EXISTS` no-op'd against a table that already existed with a different, smaller shape (note the live table also has a `session_id` column this migration file never mentions — it was created by an entirely different, unidentified process).
4. **`custom_api_connections.error_count` (migration 034) — Agent 19's auto-pause-at-3-failures logic is broken.** `src/lib/agents/custom-api.ts:73,118,129,135` selects, reads, and increments `error_count` to auto-pause a connection after 3 consecutive failures (per `BEHAVIORAL_CONTRACTS §20`). Column doesn't exist live — every read of `conn.error_count` returns `undefined`/errors, so the auto-pause safety mechanism cannot function.
5. **`agent_registry.avg_tokens_per_run` (migration 094) — `/api/agents/registry` breaks.** `src/app/api/agents/registry/route.ts:52` selects this column by name directly. Missing live.
6. **`organizations.extended_profile` (migration 104) — the Knowledge Base Editor 10-section profile UI has no backing column.** 5 live consumers found (`dashboard/page.tsx`, `knowledge-base/edit/page.tsx`, `/api/knowledge-base/route.ts`, `lib/knowledge-base/profile.ts`, `src/types/database.ts`). The migration file's own header explicitly says "NOT YET APPLIED to the live database as of this migration file's creation" — self-documented, and this pass confirms that's still true.
7. **`organizational_digital_twins.twin_auto_populate_log` (migration 101, root tree) — twin auto-populate's audit log has nowhere to write.** Live consumer: `src/lib/intelligence/twin-auto-populate.ts`. Note: the identical column is also defined in `src/supabase/migrations/102_twin_auto_populate_log.sql` (the parallel migrations tree, project memory `benavora-two-parallel-migrations-directories`) — neither fork's version has landed.
8. **`applications.metadata` (migration 105, root tree) — Narrative Humanizer's `humanization_score` has nowhere to write.** Live consumers: `src/lib/intelligence/narrative-humanizer.ts`, `src/lib/agents/draft-generation-agent.ts`, `/api/drafts/[id]/humanize/route.ts`, `/api/drafts/[id]/route.ts`, `DraftQualityPanel.tsx`. Same dual-fork pattern — also defined in `src/supabase/migrations/103_narrative_humanizer.sql`, also not live.
9. **`prospects.contact_name`/`contact_title` (migration 100) — Sales Outreach personalization has no named contact.** Live consumer: `scripts/seed-outreach-prospects.ts` (per the migration's own header, this is the intended write path). Contradicts project memory `benavora-outreach-table-names-collide`, which stated "prospects needed migration 100 for contact_name/contact_title" as if resolved — it was written but never actually landed live. That memory should be treated as describing an intended fix, not a confirmed one.
10. **`funder_relationship_scores.trend`/`recent_events`/`is_stale` (migration 039) — unchanged from July 28, still broken.** Confirmed again: live table has `id, organization_id, funder_id, score, events, last_updated_at, created_at` — none of the three AG-19 FunderRelationshipAgent columns exist.

## Confirmed dead/superseded — not active bugs (lower priority)

These showed up as "missing" against their originating migration file, but the live app already uses a different (live) column name for the same purpose, and no code references the missing name:

- **`agent_configurations.organization_id`/`updated_at` (migration 094)** and **`discovery_runs`/`discovery_matches.organization_id` (migration 095)** — all three tables are actually defined by `src/supabase/migrations/075_agent_marketplace.sql` (the *other* migrations tree) using `org_id`, which **is** what's live and what all real consumers (`/api/agents/registry/*`, `/api/agents/discovery/route.ts`, `morning-digest.ts`) query. 094/095's `organization_id` additions in the root tree are an abandoned parallel-naming attempt.
- **`knowledge_queries.organization_id` (migration 096)** — same pattern; live/real code uses `org_id`. (096's other gap, `intelligence_funded_proposals.embedding`, is real and unchanged from July 28 — see below.)
- **`automation_queue.worker_id` (migration 035)** — no live code references it (the `worker_id` matches found in `WorkerStatus.tsx`/`/api/admin/system/route.ts` are for the unrelated, live `worker_status` table).
- **`intelligence_grantmaker_profiles` redesign (migration 060)** — unchanged from July 28's conclusion: abandoned redesign, no live consumer uses the new column names.
- **`automation_sessions` extra columns (migration 020)**, **`scraping_targets.updated_at` (migrations 034/041)** — unchanged from July 28: type-only or cosmetic, no functional live-code dependency found.

## Supplementary finding: `agent_type` / `subscription_tier` enum gaps (new this pass, outside original scope)

The July 28 audit explicitly excluded `ALTER TYPE ... ADD VALUE` statements. Since PostgREST's OpenAPI introspection conveniently inlines the full live enum value list on any column using that type, this pass diffed every `ALTER TYPE agent_type ADD VALUE` / `ALTER TYPE subscription_tier ADD VALUE` statement across all 112 files against production. **Missing agent_type values:**

- `browser_automation` (005), `email_matching` (006), `email_campaign` (007) — three early, otherwise-DDL-free migrations whose *entire content* is one enum add, and none of the three ever landed.
- `custom_scrape_research`, `giving_history_extractor`, `competitor_intelligence`, `semantic_matching`, `automation_worker`, `csv_import`, `notification_dispatcher`, `financial_reconciliation` — all from `033_integration_keys.sql`'s enum block.
- `automation_worker` (035, duplicate attempt), `giving_history_extractor` (037, duplicate attempt), `competitor_intelligence` (040, duplicate attempt) — same three values, attempted again in later files, still not live.
- `ea01_giving_detector` through `ea05_career_page_analyzer` (107), `ea06_press_release_analyzer` through `ea10_social_media_analyzer` (108), `ag22_propensity_scoring` (109) — the entire Corporate Intelligence Engine agent-type roster. Each of these three files self-documents "NOT CONFIRMED APPLIED TO PRODUCTION this session" in its own header, and this pass confirms that self-assessment is correct.

**Missing subscription_tier value:** `consultant` (021_billing_tables.sql) — the White-Label Consultant plan tier cannot actually be set on `subscriptions.tier` in production; the live enum is still just `free, starter, professional, enterprise`.

This directly compounds project memory `benavora-agent-type-enum-gap` (previously only ag-25/ag-28/autonomous_orchestrator were known missing) — the real gap is significantly larger. Any agent whose `agent_type` value isn't in the live enum will fail its `agent_runs` insert with a type-constraint violation the moment it tries to log a run. Worth a dedicated follow-up pass rather than folding entirely into this table/column-scoped audit.

## Migrations — NOT APPLIED (41 of 112)

Ordered by filename. Entries unchanged from July 28 are marked *(unchanged)*; everything else is new to this pass.

### `008_stripe_billing.sql` — NOT APPLIED *(unchanged)*
- Missing table: `stripe_webhook_events`. Live consumer: `src/app/api/webhooks/stripe/route.ts` (idempotency check + insert).

### `012_opportunity_match_percentage.sql` / `025_fix_alerts.sql` / `026_fix_alerts_schema.sql` — NOT APPLIED *(unchanged)*
- Missing columns: `opportunities.is_high_priority`, `opportunities.match_mismatch_reasons`. Actively written by the live, nightly-wired AG-02 eligibility scorer (`src/lib/agents/eligibility-scorer.ts:185,188`) and read by 4 UI components. Still the highest-standing active-agent write failure carried over from July 28 — unresolved across three separate attempts (012, 025, 026) to add the same two columns.

### `020_automation_sessions.sql` — NOT APPLIED *(unchanged, low priority)*
- Missing columns: `session_type`, `steps`, `screenshots`, `approval_required_at`. Type-only references in `src/types/automation.ts`; real runtime uses the live `automation_steps`/`automation_screenshots` child tables instead. Superseded design.

### `034_custom_connections.sql` — NOT APPLIED *(new finding)*
- Missing columns: `custom_api_connections.error_count` (active bug — see priority finding #4 above), `scraping_targets.updated_at` (cosmetic, no functional consumer found).

### `035_automation_queue.sql` — NOT APPLIED *(new finding, low priority)*
- Missing column: `automation_queue.worker_id`. No live consumer found — dead column.

### `036_automation_notifications.sql` — NOT APPLIED *(new finding — priority #3 above)*
- Missing columns: `title`, `related_entity_type`, `related_entity_id`.

### `037_giving_history.sql` — NOT APPLIED *(new finding — priority #2 above)*
- Missing columns: `funder_giving_history.grant_purpose`, `funder_giving_history.source`. Live table instead has `purpose`/`recipient_ein`/`source_filing_url` — created out-of-band with a different schema than this checked-in file.

### `038_intelligence_tables.sql` — NOT APPLIED *(new finding — priority #1 above, most severe of this batch)*
- Missing columns: `funder_relationship_scores.relationship_score/total_interactions/successful_applications/last_interaction_at/notes/updated_at`, `success_probability_scores.data_quality/created_at/updated_at`, `competitor_tracking.opportunity_id/estimated_applicants/competition_level/observed_at`.
- This migration's `CREATE TABLE` (no `IF NOT EXISTS`) statements for all three tables define schemas that don't match what's live at all — all three tables exist in production today with entirely different column sets, evidently created by other means (competitor_tracking's live shape matches migration 040 instead; the other two match no other migration file found in either tree). `success_probability_scores` is the active-throw bug (#1 above).

### `039_funder_relationship_agent.sql` — NOT APPLIED *(unchanged — priority #10 above)*
- Missing columns: `trend`, `recent_events`, `is_stale` on `funder_relationship_scores`.

### `041_scraping_targets.sql` — NOT APPLIED *(new finding, low priority — duplicate of 034's `scraping_targets.updated_at`)*

### `052_governance_layer.sql` — NOT APPLIED *(unchanged — see "052" section above)*
- Missing tables: `funder_relationships`, `queue_controls`, `submission_usage`, `tier_limits`. Missing columns: `submission_queue.risk_score`, `risk_factors`.

### `052_webhook_configs.sql` — NOT APPLIED *(status changed — table now exists via 051, but this file's specific columns still don't; new active bug found — see "052" section above)*
- Missing columns: `webhook_configs.type`, `is_active`, `updated_at` (live table has `webhook_type`/`active`, no `updated_at`, from 051's competing definition).

### `053_multichannel_analytics.sql` — NOT APPLIED *(unchanged)*
- Missing tables: `session_recordings` (`worker/queue-processor.ts:1348`, `/autoapply/recordings/page.tsx`), `ab_test_variants` (`/api/autoapply/ab-tests/route.ts`, `lib/autoapply/ab-testing.ts`). Missing columns: `autoapply_submissions.variant_id/response_received_at/follow_up_status`.

### `054_email_calendar_integration.sql` — NOT APPLIED *(unchanged, superseded/no risk)*
- Missing tables: `email_threads`, `email_messages` — no live references; the actually-live equivalents are `synced_email_threads`/`synced_email_messages` (migration 002).

### `060_grantmaker_profiles.sql` — NOT APPLIED *(unchanged, abandoned redesign)*
- 9 columns missing on `intelligence_grantmaker_profiles`; no live code references any of the new names, all real consumers still use the original migration-048 schema (live).

### `078_donor_discovery_prospects_scored_at.sql` — NOT APPLIED *(unchanged)*
- Missing column: `donor_discovery_prospects.scored_at`. Live consumers: `worker/jobs/score-donor-prospect.ts:76`, `scoring-engine.ts:516`, `ProspectDetail.tsx:531`. Still a strong candidate root cause for `benavora-donor-discovery-pipeline-empty-in-prod`.

### `079_donor_discovery_prospects_enrichment_private.sql` — NOT APPLIED *(unchanged)*
- Missing column: `donor_discovery_prospects.enrichment_private`. Live consumer: `worker/jobs/run-connector-enrichment.ts:120,200,204,246`.

### `080_org_settings.sql` — NOT APPLIED *(unchanged)*
- Missing table: `org_settings`. Live consumer: `/api/autoapply/mode/route.ts:26,68` (automation-mode toggle).

### `082_outreach_templates.sql` — NOT APPLIED *(unchanged)*
- Missing table: `outreach_templates`. Live consumers: `/api/outreach/templates/route.ts`, `/outreach/templates/page.tsx`.

### `083_followup_sequences.sql` — NOT APPLIED *(unchanged)*
- Missing tables: `followup_sequences`, `followup_enrollments`. Live consumers: `/api/outreach/sequences/route.ts`, `/outreach/sequences/page.tsx`.

### `084_grant_financials.sql` — NOT APPLIED *(unchanged)*
- Missing tables: `grant_budgets`, `grant_expenses`. Live consumers across `/api/financials/*`, `/api/applications/[id]/{budget,expenses,reconcile}`, `/financials/page.tsx`.

### `085_compliance_requirements.sql` — NOT APPLIED *(unchanged)*
- Missing table: `compliance_requirements`. Live consumers: `/api/compliance/route.ts`, `IntelligenceBriefingPanel.tsx`, `lib/intelligence/unified-search.ts`, `/api/intelligence/briefing/route.ts`.

### `086_white_label.sql` — NOT APPLIED *(unchanged)*
- Missing table: `consultant_client_access`. Live consumer: `/api/consultant/clients/route.ts`.

### `087_notification_preferences.sql` — NOT APPLIED *(unchanged)*
- Missing table: `notification_preferences`. Live consumer: `lib/notifications/notify.ts:31` — gates all notification dispatch per Behavioral Contracts §32.

### `089_financial_reconciliation.sql` — NOT APPLIED *(unchanged)*
- Missing table: `grant_reconciliation_reports`; downstream missing columns on the also-missing `grant_budgets`/`grant_expenses`.

### `090_compliance_calendar.sql` — NOT APPLIED *(unchanged)*
- Missing table: `compliance_events`. Live consumers: `/api/compliance/events/route.ts`, `/api/compliance/events/[id]/route.ts`, `/compliance/page.tsx:89`.

### `094_agent_registry.sql` — NOT APPLIED *(new finding, mixed severity)*
- `agent_registry.avg_tokens_per_run` — **active bug** (priority #5 above). `agent_configurations.organization_id/updated_at` — dead/superseded (app uses live `org_id`).

### `095_discovery_matches.sql` — NOT APPLIED *(new finding, superseded — no active bug)*
- `discovery_runs.organization_id`, `discovery_matches.organization_id` — both superseded by the live `org_id` naming from the other migrations tree.

### `096_knowledge_engine.sql` — NOT APPLIED *(partially unchanged, partially new)*
- `intelligence_funded_proposals.embedding` — unchanged from July 28, real gap (pgvector embeddings never land). `knowledge_queries.organization_id` — new finding this pass, superseded/no active bug (app uses `org_id`).

### `097_funding_sources.sql` — NOT APPLIED *(unchanged)*
- Missing table: `funding_sources`. Live consumers: `/api/sources/registry/route.ts`, `/research/page.tsx:561`, `lib/sources/*-registry.ts`.

### `100_prospects_contact_fields.sql` — NOT APPLIED *(new finding — priority #9 above)*

### `101_twin_auto_populate_log.sql` — NOT APPLIED *(new finding — priority #7 above)*

### `102_org_portal_accounts.sql` — NOT APPLIED *(unchanged)*
- Missing table: `org_portal_accounts`. Live consumers: `worker/queue-processor.ts:1695,1702`, `scripts/setup-sparkgood-account.ts`.

### `103_schoolfunder.sql` — NOT APPLIED *(unchanged)*
- Missing tables: `schoolfunder_students`, `schoolfunder_volunteer_hours`, `schoolfunder_donations`. All of `/api/schoolfunder/*` and `/schoolfunder/page.tsx` remain built against a schema never applied.

### `104_organizations_extended_profile.sql` — NOT APPLIED *(new finding — priority #6 above)*

### `105_applications_metadata_column.sql` — NOT APPLIED *(new finding — priority #8 above)*

### `106_intelligence_library_schema_upgrade.sql` — NOT APPLIED *(unchanged)*
- All 19 added columns on `intelligence_funded_proposals` still absent (`funder_category`, `ntee_major`, `ntee_code`, `success_factors`, `keywords`, `persuasive_elements`, `winning_phrases`, `theory_of_change`, `evaluation_approach`, `budget_structure`, `geographic_scope`, `org_size_category`, `submission_timing`, `application_word_count`, `sections_included`, `ai_quality_score`, `is_verified`, `source_type`, `import_batch`, `full_text_search_vector`).

### `107_corporate_prospects.sql` — NOT APPLIED *(new file, not in July 28 audit)*
- Missing table: `corporate_prospects` — the master Corporate Intelligence Engine table (SCHEMA_REGISTRY_v2.md table 36), documented as a live-consumer target since it's the write destination for EA-01 through EA-10 enrichment agents, but the table itself has never existed in production (independently re-confirmed here — this migration file's own header already flags it as "NOT CONFIRMED APPLIED").

### `110_scrape_jobs_universal_scraper.sql` — NOT APPLIED *(new file, not in July 28 audit)*
- Missing tables: `scrape_jobs`, `scrape_results` — backing the Universal Scraper feature referenced in recent commits (`queue-10-universal-scraper-verification.yaml`, `5ee9528`).

## Migrations — APPLIED (55 of 112)

Every `CREATE TABLE` / `ADD COLUMN` statement in these migrations — including ones nested in `DO $$...$$` blocks — was confirmed present in the live production schema.

<details>
<summary>Expand full list</summary>

- `001_initial_schema.sql`
- `002_phases_2_5.sql`
- `003_onboarding.sql`
- `009_draft_versions.sql`
- `010_opportunity_source_type.sql`
- `011_search_profile_configuration.sql`
- `013_alerts.sql`
- `014_validations.sql`
- `015_funder_intelligence.sql`
- `016_renewals.sql`
- `017_success_patterns.sql`
- `018_email_activity.sql`
- `022_usage_tracking.sql`
- `023_onboarding_step.sql`
- `024_audit_logs.sql`
- `027_missing_columns.sql`
- `033_integration_keys.sql` *(table/column-level only — its enum additions are a separate, partial gap; see enum section)*
- `040_competitor_intel_agent.sql`
- `042_historical_awards.sql`
- `043_opportunity_documents.sql`
- `045_autoapply_tables.sql`
- `046_foundation_directory.sql`
- `047_worker_status.sql`
- `048_grant_intelligence.sql`
- `049_auto_queue_config.sql`
- `050_funder_credentials.sql`
- `051_submission_intelligence.sql` — **newly confirmed applied this session**
- `053_autoapply_missing_columns.sql`
- `054_funders_contact_email.sql`
- `055_admin_sales_outreach.sql`
- `055_sequence_enrollment_variables.sql`
- `056_four_tier_admin_system.sql`
- `057_draft_automation_pipeline.sql`
- `058_lead_enrichment_system.sql`
- `059_budget_patterns.sql`
- `061_corporate_giving_targets.sql`
- `062_community_foundations.sql`
- `063_white_label.sql`
- `065_autoapply_follow_ups.sql`
- `067_donor_discovery_foundation.sql`
- `068_donor_discovery_crawler_core.sql`
- `069_donor_discovery_places_adapter.sql`
- `071_donor_discovery_directory_dedup.sql`
- `072_foundation_directory_990_enrichment.sql`
- `073_onboarding_progress.sql`
- `074_donor_discovery_foundation_linkage_and_scoring.sql`
- `075_donor_discovery_taxonomy_aliases.sql`
- `076_adapter_usage_log.sql`
- `077_donor_discovery_geocache.sql`
- `081_foundation_profiles.sql`
- `088_foundation_profiles_enrichment.sql`
- `091_funder_relationship_events.sql`
- `093_digital_twins.sql`
- `098_nonprofits_bmf.sql`
- `099_nonprofits_enrichment.sql`

</details>

## Migrations — NO_DDL (16 of 112)

No `CREATE TABLE`/`ADD COLUMN` statement found — enum additions, RLS-only fixes, or data backfills. Not part of the table/column check, but three of these (marked below) turned out to have their sole statement — an enum value addition — also never applied; see the enum section above.

- `002_register_organization.sql`
- `004_research_cron.sql`
- `005_browser_automation_agent_type.sql` — **enum value `browser_automation` also missing live**
- `006_email_matching_agent_type.sql` — **enum value `email_matching` also missing live**
- `007_email_campaign_agent.sql` — **enum value `email_campaign` also missing live**
- `021_billing_tables.sql` — **enum value `consultant` (subscription_tier) also missing live**
- `022_fix_model_name.sql`
- `028_increase_tokens.sql`
- `044_nofa_pdfs_bucket.sql`
- `058_backfill_opportunity_deadlines.sql`
- `064_drop_orphaned_email_tables.sql`
- `066_fix_autoapply_rls_policies.sql`
- `070_donor_discovery_request_claim.sql`
- `092_consultant_client_access_check.sql`
- `108_corporate_prospects_ea06_ea10.sql` — all 5 EA-06..EA-10 enum values missing live (self-documented as unapplied in the file's own header)
- `109_corporate_prospects_ag22_propensity_scoring.sql` — `ag22_propensity_scoring` enum value missing live (self-documented as unapplied)

## Not covered by this audit

- `src/supabase/migrations/` (the second parallel migrations tree, project memory `benavora-two-parallel-migrations-directories`) — out of scope for the table/column pass, same as July 28, though this pass did cross-reference it twice (for `agent_configurations`/`discovery_runs`/`discovery_matches`'s real `org_id` origin via `075_agent_marketplace.sql`, and for the duplicate `applications.metadata`/`organizational_digital_twins.twin_auto_populate_log` definitions in `103_narrative_humanizer.sql`/`102_twin_auto_populate_log.sql`).
- RLS policy text (PostgREST introspection does not expose `pg_policies`) — table/column *existence* verified, not policy correctness.
- A full, exhaustive diff of every `ALTER TYPE ... ADD VALUE` across every enum type in every migration — the supplementary section above covers `agent_type` and `subscription_tier` only (the two enum types this session's investigation happened to touch); other enums (`pipeline_stage`, `funder_category`, etc.) were not systematically diffed and would be worth a dedicated follow-up pass given how many gaps turned up in just these two.

## Next steps (priority order)

1. **`success_probability_scores` (migration 038)** — the Success Probability Agent throws on every run right now. This is the single most severe active-code-path break found this session; fix ahead of everything else in this list.
2. **`052_webhook_configs.sql` column mismatch** — cheap one-column-rename-or-add fix; currently silently disables all AutoApply webhook notifications.
3. **`052_governance_layer.sql`** — apply in full; this is the AutoApply kill-switch/tier-limit/risk-gating layer, still entirely absent despite 051 landing.
4. **`opportunities.is_high_priority`/`match_mismatch_reasons` (012/025/026)** — carried over three sessions now as the highest-standing wired-agent write failure; still unresolved.
5. **`agent_type` enum gaps** — a dedicated pass to add every missing value in one batch (18+ values across 8 files), since any of these agents will hard-fail their `agent_runs` insert the moment they're actually invoked.
6. Everything else in the NOT-APPLIED list, roughly in the order given (grant financials/compliance/SchoolFunder/corporate intelligence remain the largest fully-unbuilt-in-prod feature areas).
