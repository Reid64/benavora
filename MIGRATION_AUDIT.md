# MIGRATION_AUDIT.md
## Migration-vs-Production Schema Audit
**Run: July 28, 2026. Diagnostic only — no migrations were applied.**

## Purpose

Migration 051 (`051_submission_intelligence.sql`) was discovered to have silently never been applied to production (see project memory `benavora-request-profiles-table-missing-blocks-autoapply`), causing a real AutoApply production bug (the `automation_level` org-readiness check). This audit reads every migration in `supabase/migrations/` (root — the "live" directory per project memory `benavora-two-parallel-migrations-directories`; the separate `src/supabase/migrations/` tree, 32 files, is out of scope for this pass), extracts every `CREATE TABLE` / `ALTER TABLE ... ADD COLUMN` statement, and checks whether each table/column actually exists on production — to find any *other* migrations with the same silent-failure pattern before they cause a production bug the way 051 did.

## Methodology

1. **Parsed 108 `.sql` files** in `supabase/migrations/` in filename order. For each file, extracted every top-level `CREATE TABLE [IF NOT EXISTS] <table>` and `ALTER TABLE <table> ADD COLUMN [IF NOT EXISTS] <column>` statement via a semicolon-statement-boundary parser (comments stripped first). 167 `CREATE TABLE` statements and 110 `ADD COLUMN` statements found.
2. **Fetched the live production schema** directly from project `vbjplpquqxxfbpazyalt` via `GET {SUPABASE_URL}/rest/v1/` with `Accept: application/openapi+json` and the service-role key (same PostgREST-introspection method SCHEMA_REGISTRY_v2.md's July 19, 2026 live audit used). This returned 145 tables/views with full column lists.
3. **Also attempted** the Supabase Management API (`POST /v1/projects/vbjplpquqxxfbpazyalt/database/query`) with the PAT documented in `BLUEPRINT_v2.md` §8.3, specifically to query `supabase_migrations.schema_migrations` for an authoritative applied-migrations list. **This PAT is still rejected — HTTP 401 Unauthorized** (re-confirming project memory `benavora-management-api-pat-rejected`, now stale-checked again as of this session, still invalid). PostgREST introspection was used as the sole source of truth instead.
4. For every table/column found **missing** from the live schema, grepped `src/`, `worker/`, and `scripts/` for references to find live code paths depending on it.

**Important caveat on what "APPLIED" means here:** without access to `supabase_migrations.schema_migrations`, this audit cannot distinguish "this exact migration file's statements executed successfully" from "an object with this name/shape happens to exist in production now (possibly created by a different migration)". What it **can** state with confidence is binary and directly useful: does the table/column this migration defines actually exist in production right now, yes or no. That is the same question that made migration 051's gap a real bug, and it is what this report answers for all 108 migrations.

## Summary

- **Total migrations audited:** 108
- **APPLIED** (every CREATE TABLE / ADD COLUMN checked was found live): **80**
- **NOT APPLIED** (at least one missing table or column): **28**
- **Distinct missing tables:** 33
- **Distinct missing columns on existing tables:** 14 (plus 2 grouped multi-column redesigns, see below)

### Duplicate migration-number collisions (found during parsing, worth flagging on their own)

Two pairs of files share the same leading number. This makes "migration 002" or "migration 052" an ambiguous reference in any future governance doc or code comment — both should be confirmed/renamed before more migrations are added on top:

- `002_phases_2_5.sql` and `002_register_organization.sql`
- `052_governance_layer.sql` and `052_webhook_configs.sql` — **both are NOT APPLIED** (see below). Notably, `052_webhook_configs.sql` exists specifically to create `webhook_configs`, and `051_submission_intelligence.sql` *also* tries to create `webhook_configs` — neither succeeded.

## Migrations — NOT APPLIED (28 of 108)

Ordered by filename. For each: the missing tables/columns this migration defines, and every live code path found referencing them.

### `008_stripe_billing.sql` — NOT APPLIED

**Missing tables:**

- `stripe_webhook_events` — Stripe webhook idempotency table. Live code path.
  - Live code references:
    - `src/app/api/webhooks/stripe/route.ts (idempotency check + insert, lines ~56, 76)`

### `012_opportunity_match_percentage.sql` — NOT APPLIED

**Missing columns (table exists, column does not):**

- `opportunities.is_high_priority` — Actively written by the live AG-02 eligibility scorer (src/lib/agents/eligibility-scorer.ts, wired into the nightly autonomous pipeline and agent_queue) and read by 4 UI components. Every autonomous eligibility-scoring run since migration 012 has been writing to a column that does not exist -- this is a genuine, currently-active silent-failure risk on a wired nightly agent.
  - Live code references:
    - `src/lib/agents/eligibility-scorer.ts:185`
    - `src/components/opportunities/OpportunityTable.tsx:297`
    - `src/components/opportunities/OpportunityDetail.tsx:324,1075,1078`
    - `src/components/opportunities/OpportunityCard.tsx:39`
    - `src/lib/grants/grants-service.ts:91`
- `opportunities.match_mismatch_reasons` — Same write path as is_high_priority -- eligibility-scorer.ts:188.
  - Live code references:
    - `src/lib/agents/eligibility-scorer.ts:188`
    - `src/components/opportunities/OpportunityDetail.tsx:1083`
    - `src/lib/grants/grants-service.ts:92`

### `020_automation_sessions.sql` — NOT APPLIED

**Missing columns (table exists, column does not):**

- `automation_sessions.session_type` — Only found in TypeScript type definitions (src/types/automation.ts), not in an active Supabase query. The actual runtime appears to use the separate, live automation_steps/automation_screenshots child tables (migration 002) instead of these JSONB columns -- likely a superseded design, lower risk than the AutoApply items above.
  - Live code references:
    - `src/types/automation.ts (type only)`
- `automation_sessions.steps` — Same superseded-design pattern as session_type -- type-only reference, real runtime uses automation_steps table.
  - Live code references:
    - `src/types/automation.ts:189 (type only)`
- `automation_sessions.screenshots` — Same superseded-design pattern -- type-only reference, real runtime uses automation_screenshots table.
  - Live code references:
    - `src/types/automation.ts:189, src/components/automation/automation.ts:313 (types only)`
- `automation_sessions.approval_required_at` — No live query reference found beyond the migration file itself.
  - No live code references found.

### `025_fix_alerts.sql` — NOT APPLIED

**Missing columns (table exists, column does not):**

- `opportunities.is_high_priority` — Actively written by the live AG-02 eligibility scorer (src/lib/agents/eligibility-scorer.ts, wired into the nightly autonomous pipeline and agent_queue) and read by 4 UI components. Every autonomous eligibility-scoring run since migration 012 has been writing to a column that does not exist -- this is a genuine, currently-active silent-failure risk on a wired nightly agent.
  - Live code references:
    - `src/lib/agents/eligibility-scorer.ts:185`
    - `src/components/opportunities/OpportunityTable.tsx:297`
    - `src/components/opportunities/OpportunityDetail.tsx:324,1075,1078`
    - `src/components/opportunities/OpportunityCard.tsx:39`
    - `src/lib/grants/grants-service.ts:91`
- `opportunities.match_mismatch_reasons` — Same write path as is_high_priority -- eligibility-scorer.ts:188.
  - Live code references:
    - `src/lib/agents/eligibility-scorer.ts:188`
    - `src/components/opportunities/OpportunityDetail.tsx:1083`
    - `src/lib/grants/grants-service.ts:92`

### `026_fix_alerts_schema.sql` — NOT APPLIED

**Missing columns (table exists, column does not):**

- `opportunities.is_high_priority` — Actively written by the live AG-02 eligibility scorer (src/lib/agents/eligibility-scorer.ts, wired into the nightly autonomous pipeline and agent_queue) and read by 4 UI components. Every autonomous eligibility-scoring run since migration 012 has been writing to a column that does not exist -- this is a genuine, currently-active silent-failure risk on a wired nightly agent.
  - Live code references:
    - `src/lib/agents/eligibility-scorer.ts:185`
    - `src/components/opportunities/OpportunityTable.tsx:297`
    - `src/components/opportunities/OpportunityDetail.tsx:324,1075,1078`
    - `src/components/opportunities/OpportunityCard.tsx:39`
    - `src/lib/grants/grants-service.ts:91`
- `opportunities.match_mismatch_reasons` — Same write path as is_high_priority -- eligibility-scorer.ts:188.
  - Live code references:
    - `src/lib/agents/eligibility-scorer.ts:188`
    - `src/components/opportunities/OpportunityDetail.tsx:1083`
    - `src/lib/grants/grants-service.ts:92`

### `039_funder_relationship_agent.sql` — NOT APPLIED

**Missing columns (table exists, column does not):**

- `funder_relationship_scores.trend` — Actively written by the live AG-19 FunderRelationshipAgent (wired into agent_queue case 'funder_relationship' per AGENTS_v2.md).
  - Live code references:
    - `src/lib/agents/funder-relationship.ts`
- `funder_relationship_scores.recent_events` — Actively read by the same live agent.
  - Live code references:
    - `src/lib/agents/funder-relationship.ts:109`
- `funder_relationship_scores.is_stale` — Actively written by the same live agent.
  - Live code references:
    - `src/lib/agents/funder-relationship.ts:146`

### `051_submission_intelligence.sql` — NOT APPLIED

**Missing tables:**

- `request_profiles` — AUTOAPPLY_ARCHITECTURE_V2 Request Profile System. Confirmed missing per project memory 'benavora-request-profiles-table-missing-blocks-autoapply' (2026-07-28) -- this is the current AutoApply blocker.
  - Live code references:
    - `src/app/api/autoapply/profiles/route.ts`
    - `src/app/api/autoapply/profiles/[id]/route.ts`
    - `src/lib/autoapply/auto-queue-populator.ts`
    - `src/lib/autoapply/submission-validator.ts`
    - `src/lib/autoapply/receipt-generator.ts (type import)`
    - `src/components/autoapply/SubmissionPreview.tsx`
    - `worker/queue-processor.ts:549`
- `kb_extended_needs` — No live code references found anywhere in src/, worker/, or scripts/ beyond the migration file itself. Appears genuinely dead/unused -- lower priority than the others.
  - No live code references found.
- `pitch_cache` — Live code path, but written defensively -- pitch-personalizer.ts already contains comments acknowledging the table 'may not exist yet' and degrades gracefully. Confirms this gap was previously suspected/worked around, not fully fixed.
  - Live code references:
    - `src/lib/autoapply/pitch-personalizer.ts (lines 73, 84, 100, 212, 251, 259 -- explicit 'may not exist yet' comments)`
- `org_documents` — Live code path -- AutoApply document vault.
  - Live code references:
    - `src/lib/autoapply/document-vault.ts`
    - `src/lib/autoapply/submission-validator.ts:190`
    - `src/components/autoapply/SubmissionPreview.tsx:299`
    - `src/components/autoapply/ManualQueue.tsx:339`
    - `src/app/(dashboard)/autoapply/documents/page.tsx:212`
- `submission_receipts` — Live code path -- PDF receipt generation after every AutoApply submission.
  - Live code references:
    - `src/lib/autoapply/receipt-generator.ts:336`
- `grant_agreements` — Live code path -- post-award agreement tracking.
  - Live code references:
    - `src/app/api/autoapply/agreements/route.ts`
    - `src/app/api/autoapply/agreements/[id]/route.ts`
    - `src/lib/autoapply/response-analytics.ts:342,396`
- `webhook_configs` — Live code path -- both migration 051 and migration 052_webhook_configs.sql attempt to create this same table (see numbering collision note). Neither succeeded.
  - Live code references:
    - `src/app/api/autoapply/webhooks/route.ts`
    - `src/lib/autoapply/webhook-notifier.ts:95`
    - `src/app/(dashboard)/autoapply/webhooks/page.tsx:136`
- `cross_client_submissions` — Live code path -- anonymized cross-tenant dedup log.
  - Live code references:
    - `src/lib/autoapply/submission-controls.ts (lines 81, 192, 263)`

**Missing columns (table exists, column does not):**

- `submission_queue.request_profile_id` — FK link to the also-missing request_profiles table -- part of the same AutoApply Request Profile System gap.
  - Live code references:
    - `migration 051 only; no direct code reference to this exact column name found, but downstream of the request_profiles gap`
- `autoapply_submissions.request_profile_id`
- `autoapply_submissions.submission_channel`
- `autoapply_submissions.personalized_pitch`
- `autoapply_submissions.optimized_amount`
- `autoapply_submissions.timing_score`
- `autoapply_submissions.confirmation_data`
- `autoapply_submissions.documents_attached`

### `052_governance_layer.sql` — NOT APPLIED

**Missing tables:**

- `funder_relationships` — Live code path -- AutoApply risk engine and relationship manager (distinct from funder_relationship_scores, which does exist).
  - Live code references:
    - `src/lib/autoapply/risk-engine.ts:98,129`
    - `src/lib/autoapply/relationship-manager.ts (6 call sites)`
    - `src/lib/autoapply/follow-up-scheduler.ts:159`
- `queue_controls` — Live code path -- AutoApply queue pause/kill-switch control plane referenced in Behavioral Contracts. Central to the AutoApply Ops admin page.
  - Live code references:
    - `src/lib/autoapply/queue-controls.ts (12 call sites)`
    - `src/lib/drafts/submission-bridge.ts:280`
    - `src/app/api/admin/autoapply-ops/route.ts:70`
- `submission_usage` — Live code path -- monthly/daily submission usage tracking for tier enforcement.
  - Live code references:
    - `src/lib/autoapply/usage-meter.ts (7 call sites)`
    - `src/lib/autoapply/alerting.ts:76`
    - `src/lib/autoapply/response-analytics.ts:402`
    - `src/app/api/admin/autoapply-ops/route.ts:135`
    - `src/app/(dashboard)/autoapply/usage/UsagePageClient.tsx:297`
- `tier_limits` — Live code path -- tier-based usage caps (usage-meter.ts explicitly has hardcoded fallback constants for when this table isn't seeded, but the table itself is still queried first).
  - Live code references:
    - `src/lib/autoapply/usage-meter.ts:172,276,369,424`
    - `src/app/(dashboard)/autoapply/usage/UsagePageClient.tsx:307`

**Missing columns (table exists, column does not):**

- `submission_queue.risk_score` — Part of migration 052_governance_layer.sql's risk-gating design.
  - Live code references:
    - `migration 052_governance_layer.sql only; risk scoring itself lives in src/lib/autoapply/risk-engine.ts but was not confirmed writing to this exact column name`
- `submission_queue.risk_factors` — Same migration 052_governance_layer.sql risk-gating design as risk_score.
  - Live code references:
    - `migration 052_governance_layer.sql only`

### `052_webhook_configs.sql` — NOT APPLIED

**Missing tables:**

- `webhook_configs` — Live code path -- both migration 051 and migration 052_webhook_configs.sql attempt to create this same table (see numbering collision note). Neither succeeded.
  - Live code references:
    - `src/app/api/autoapply/webhooks/route.ts`
    - `src/lib/autoapply/webhook-notifier.ts:95`
    - `src/app/(dashboard)/autoapply/webhooks/page.tsx:136`

### `053_multichannel_analytics.sql` — NOT APPLIED

**Missing tables:**

- `session_recordings` — Live code path -- Playwright .webm video audit trail per AutoApply submission.
  - Live code references:
    - `worker/queue-processor.ts:1348`
    - `src/app/(dashboard)/autoapply/recordings/page.tsx:301,369`
- `ab_test_variants` — Live code path -- A/B testing of pitch styles.
  - Live code references:
    - `src/app/api/autoapply/ab-tests/route.ts`
    - `src/lib/autoapply/ab-testing.ts (6 call sites)`

**Missing columns (table exists, column does not):**

- `autoapply_submissions.variant_id`
- `autoapply_submissions.response_received_at`
- `autoapply_submissions.follow_up_status`

### `054_email_calendar_integration.sql` — NOT APPLIED

**Missing tables:**

- `email_threads` — No live code references found. The actually-live email thread table is 'synced_email_threads' (migration 002_phases_2_5.sql), confirmed present in production. This migration 054 table appears to be an abandoned/superseded redesign, not a silent-failure risk.
  - No live code references found.
- `email_messages` — No live code references found. The actually-live email message table is 'synced_email_messages' (migration 002_phases_2_5.sql), confirmed present in production. Same superseded-redesign pattern as email_threads.
  - No live code references found.

### `060_grantmaker_profiles.sql` — NOT APPLIED

**Missing columns (table exists, column does not):**

- `intelligence_grantmaker_profiles` — 9 columns added by this migration, none present: `foundation_id`, `name`, `total_annual_giving`, `program_priorities`, `typical_award_range`, `language_patterns`, `application_url`, `last_profiled_at`, `profile_data`
  - No live code found querying intelligence_grantmaker_profiles by any of migration 060's new column names (foundation_id, name, total_annual_giving, program_priorities, typical_award_range, language_patterns, application_url, last_profiled_at, profile_data). All real consumers (grantmaker-profiles.ts, funder-recommender.ts, funder-intel.ts, etc.) still use the ORIGINAL migration-048 schema (funder_id, priorities, avg_award_amount, award_range_min/max, geographic_focus, typical_language, common_keywords, decision_timeline, application_tips, source, last_updated_at, embedding) -- which IS live. Migration 060 looks like an abandoned redesign that was never adopted by any code, not an active silent-failure risk.

### `078_donor_discovery_prospects_scored_at.sql` — NOT APPLIED

**Missing columns (table exists, column does not):**

- `donor_discovery_prospects.scored_at` — Actively written by the live donor-discovery scoring worker job on every run, and used to find stale/unscored prospects. If this column doesn't exist, src/worker/jobs/score-donor-prospect.ts's `.or('scored_at.is.null,scored_at.lt....')` filter and the `.update({..., scored_at: ...})` call would both fail. This is a strong candidate root cause for project memory 'benavora-donor-discovery-pipeline-empty-in-prod' (2026-07-20: all donor discovery tables confirmed empty except taxonomy).
  - Live code references:
    - `src/worker/jobs/score-donor-prospect.ts:76`
    - `src/lib/donor-discovery/scoring-engine.ts:516`
    - `src/components/donor-discovery/ProspectDetail.tsx:531`

### `079_donor_discovery_prospects_enrichment_private.sql` — NOT APPLIED

**Missing columns (table exists, column does not):**

- `donor_discovery_prospects.enrichment_private` — Actively read/written by the live connector-enrichment worker job on every run.
  - Live code references:
    - `src/worker/jobs/run-connector-enrichment.ts:120,200,204,246`

### `080_org_settings.sql` — NOT APPLIED

**Missing tables:**

- `org_settings` — Live code path -- powers the AutoApply automation-mode toggle API (GET/PATCH). This is a likely contributor to the AutoApply automation_level issues already tracked in project memory.
  - Live code references:
    - `src/app/api/autoapply/mode/route.ts:26,68`

### `082_outreach_templates.sql` — NOT APPLIED

**Missing tables:**

- `outreach_templates` — Live code path -- reusable multi-channel outreach templates.
  - Live code references:
    - `src/app/api/outreach/templates/route.ts`
    - `src/app/(dashboard)/outreach/templates/page.tsx:14`

### `083_followup_sequences.sql` — NOT APPLIED

**Missing tables:**

- `followup_sequences` — Live code path -- multi-step post-submission follow-up sequences.
  - Live code references:
    - `src/app/api/outreach/sequences/route.ts`
    - `src/app/(dashboard)/outreach/sequences/page.tsx:12`
- `followup_enrollments` — Live code path -- per-application progress through a followup_sequence (FK dependency on followup_sequences, also missing).
  - Live code references:
    - `referenced via followup_sequences relations in src/types/database.ts:4899`

### `084_grant_financials.sql` — NOT APPLIED

**Missing tables:**

- `grant_budgets` — Live code path -- per-application budget envelope. NOTE: this table name collides with the ALREADY-DOCUMENTED SCHEMA_REGISTRY_v2.md finding that grant_budgets does not exist in prod (July 19 2026 audit). This audit independently re-confirms that finding via direct schema introspection.
  - Live code references:
    - `src/app/api/financials/budgets/route.ts`
    - `src/app/api/applications/[id]/budget/route.ts`
    - `src/app/api/applications/[id]/reconcile/route.ts:37`
    - `src/app/(dashboard)/financials/page.tsx:19,95`
- `grant_expenses` — Live code path -- expense line items against a grant_budgets envelope. Same SCHEMA_REGISTRY_v2.md corroboration as grant_budgets.
  - Live code references:
    - `src/app/api/financials/expenses/route.ts`
    - `src/app/api/applications/[id]/expenses/route.ts`
    - `src/app/api/applications/[id]/reconcile/route.ts:50`
    - `src/app/(dashboard)/financials/page.tsx:20,98`

### `085_compliance_requirements.sql` — NOT APPLIED

**Missing tables:**

- `compliance_requirements` — Live code path -- manually tracked compliance obligations, also surfaced in the Intelligence Briefing panel and unified search.
  - Live code references:
    - `src/app/api/compliance/route.ts`
    - `src/components/intelligence/IntelligenceBriefingPanel.tsx:77`
    - `src/lib/intelligence/unified-search.ts`
    - `src/app/api/intelligence/briefing/route.ts`

### `086_white_label.sql` — NOT APPLIED

**Missing tables:**

- `consultant_client_access` — Live code path -- White-label consultant portal access. Also independently documented as missing in SCHEMA_REGISTRY_v2.md's July 19 audit.
  - Live code references:
    - `src/app/api/consultant/clients/route.ts (3 call sites)`

### `087_notification_preferences.sql` — NOT APPLIED

**Missing tables:**

- `notification_preferences` — Live code path -- gates ALL notification dispatch per Behavioral Contracts §32. If missing, notify.ts's gating query fails/defaults, meaning per-user notification preferences are not actually being honored.
  - Live code references:
    - `src/lib/notifications/notify.ts:31`
    - `src/app/api/settings/notifications/route.ts:40,100`

### `089_financial_reconciliation.sql` — NOT APPLIED

**Missing tables:**

- `grant_reconciliation_reports` — Live code path -- computed budget-vs-actual reports. Depends on grant_budgets/grant_expenses, both also missing.
  - Live code references:
    - `src/app/api/applications/[id]/reconcile/route.ts:75`
    - `src/lib/reports/impact-report.ts (comment acknowledges this gap already, citing the July 19 2026 audit)`

**ADD COLUMN targets a table that itself does not exist** (downstream of a missing table above):

- `grant_budgets.line_items`
- `grant_budgets.total_approved`
- `grant_budgets.updated_at`
- `grant_expenses.application_id`
- `grant_expenses.receipt_url`

### `090_compliance_calendar.sql` — NOT APPLIED

**Missing tables:**

- `compliance_events` — Live code path -- compliance calendar (reports/audits/renewals/meetings/filings), distinct from compliance_requirements.
  - Live code references:
    - `src/app/api/compliance/events/route.ts`
    - `src/app/api/compliance/events/[id]/route.ts`
    - `src/app/(dashboard)/compliance/page.tsx:89`

### `096_knowledge_engine.sql` — NOT APPLIED

**Missing columns (table exists, column does not):**

- `intelligence_funded_proposals.embedding`

### `097_funding_sources.sql` — NOT APPLIED

**Missing tables:**

- `funding_sources` — Live code path -- shared, non-org-scoped funding source registry (100+ sources per Directive 5).
  - Live code references:
    - `src/app/api/sources/registry/route.ts`
    - `src/app/(dashboard)/research/page.tsx:561`
    - `src/lib/sources/state-sources-registry.ts`
    - `src/lib/sources/funding-source-registry.ts`

### `102_org_portal_accounts.sql` — NOT APPLIED

**Missing tables:**

- `org_portal_accounts` — Live code path -- AutoApply portal account verification state (e.g. Walmart Spark Good).
  - Live code references:
    - `worker/queue-processor.ts:1695,1702`
    - `scripts/setup-sparkgood-account.ts (multiple)`

### `103_schoolfunder.sql` — NOT APPLIED

**Missing tables:**

- `schoolfunder_students` — Live code path -- SchoolFunder is a real, live Faith Foundation showcase feature per nav-items.ts (confirmed NOT removed per STATE_OF_THE_BUILD.md July 23 session). This entire feature is backed by 3 tables, none of which exist in prod.
  - Live code references:
    - `src/app/api/schoolfunder/route.ts`
    - `src/app/api/schoolfunder/hours/route.ts`
    - `src/app/api/schoolfunder/donate/route.ts`
    - `src/app/(dashboard)/schoolfunder/page.tsx:117`
- `schoolfunder_volunteer_hours` — Same SchoolFunder feature as schoolfunder_students -- missing table.
  - Live code references:
    - `src/app/api/schoolfunder/hours/route.ts:58`
    - `src/app/(dashboard)/schoolfunder/page.tsx:137`
- `schoolfunder_donations` — Same SchoolFunder feature -- missing table.
  - Live code references:
    - `src/app/api/schoolfunder/route.ts:55`
    - `src/app/api/schoolfunder/donate/route.ts:84`
    - `src/app/(dashboard)/schoolfunder/page.tsx:124`

### `106_intelligence_library_schema_upgrade.sql` — NOT APPLIED

**Missing columns (table exists, column does not):**

- `intelligence_funded_proposals` — 20 columns added by this migration, none present: `funder_category`, `ntee_major`, `ntee_code`, `success_factors`, `keywords`, `persuasive_elements`, `winning_phrases`, `theory_of_change`, `evaluation_approach`, `budget_structure`, `geographic_scope`, `org_size_category`, `submission_timing`, `application_word_count`, `sections_included`, `ai_quality_score`, `is_verified`, `source_type`, `import_batch`, `full_text_search_vector`
  - Actively referenced by real, live code -- pattern-extractor.ts, proposals-query.ts, draft-generation-agent.ts (platform_learning_patterns consumer), grant-style-guide.ts, and the /api/intelligence/library/search route. This matches an ALREADY-DOCUMENTED gap: STATE_OF_THE_BUILD.md's July 23 2026 session note explicitly states 'winning-phrases/persuasive-elements sections... only render when migration 106's columns are populated (they are not, in prod, as of this session)'. This audit confirms that observation at the full-migration level (19 of 19 added columns absent) rather than just the two fields previously spot-checked.
  - Live code references:
    - `src/lib/intelligence/pattern-extractor.ts`
    - `src/lib/intelligence/proposals-query.ts`
    - `src/app/api/intelligence/library/search/route.ts`
    - `src/lib/agents/draft-generation-agent.ts`
    - `src/lib/intelligence/grant-style-guide.ts`
    - `src/app/(dashboard)/intelligence-library/page.tsx`

## Migrations — APPLIED (80 of 108)

Every `CREATE TABLE` / `ADD COLUMN` statement in these migrations was confirmed present in the live production schema.

<details>
<summary>Expand full list</summary>

- `001_initial_schema.sql`
- `002_phases_2_5.sql`
- `002_register_organization.sql`
- `003_onboarding.sql`
- `004_research_cron.sql`
- `005_browser_automation_agent_type.sql`
- `006_email_matching_agent_type.sql`
- `007_email_campaign_agent.sql`
- `009_draft_versions.sql`
- `010_opportunity_source_type.sql`
- `011_search_profile_configuration.sql`
- `013_alerts.sql`
- `014_validations.sql`
- `015_funder_intelligence.sql`
- `016_renewals.sql`
- `017_success_patterns.sql`
- `018_email_activity.sql`
- `021_billing_tables.sql`
- `022_fix_model_name.sql`
- `022_usage_tracking.sql`
- `023_onboarding_step.sql`
- `024_audit_logs.sql`
- `027_missing_columns.sql`
- `028_increase_tokens.sql`
- `033_integration_keys.sql`
- `034_custom_connections.sql`
- `035_automation_queue.sql`
- `036_automation_notifications.sql`
- `037_giving_history.sql`
- `038_intelligence_tables.sql`
- `040_competitor_intel_agent.sql`
- `041_scraping_targets.sql`
- `042_historical_awards.sql`
- `043_opportunity_documents.sql`
- `044_nofa_pdfs_bucket.sql`
- `045_autoapply_tables.sql`
- `046_foundation_directory.sql`
- `047_worker_status.sql`
- `048_grant_intelligence.sql`
- `049_auto_queue_config.sql`
- `050_funder_credentials.sql`
- `053_autoapply_missing_columns.sql`
- `054_funders_contact_email.sql`
- `055_admin_sales_outreach.sql`
- `055_sequence_enrollment_variables.sql`
- `056_four_tier_admin_system.sql`
- `057_draft_automation_pipeline.sql`
- `058_backfill_opportunity_deadlines.sql`
- `058_lead_enrichment_system.sql`
- `059_budget_patterns.sql`
- `061_corporate_giving_targets.sql`
- `062_community_foundations.sql`
- `063_white_label.sql`
- `064_drop_orphaned_email_tables.sql`
- `065_autoapply_follow_ups.sql`
- `066_fix_autoapply_rls_policies.sql`
- `067_donor_discovery_foundation.sql`
- `068_donor_discovery_crawler_core.sql`
- `069_donor_discovery_places_adapter.sql`
- `070_donor_discovery_request_claim.sql`
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
- `092_consultant_client_access_check.sql`
- `093_digital_twins.sql`
- `094_agent_registry.sql`
- `095_discovery_matches.sql`
- `098_nonprofits_bmf.sql`
- `099_nonprofits_enrichment.sql`
- `100_prospects_contact_fields.sql`
- `101_twin_auto_populate_log.sql`
- `104_organizations_extended_profile.sql`
- `105_applications_metadata_column.sql`

</details>

## Highest-priority findings (beyond the already-known 051/request_profiles gap)

1. **`opportunities.is_high_priority` / `opportunities.match_mismatch_reasons` (migration 012)** — actively written on every run of the live, nightly-wired AG-02 eligibility scorer (`src/lib/agents/eligibility-scorer.ts`) and read by 4 UI components (OpportunityTable, OpportunityDetail ×2, OpportunityCard). This is a currently-active write failure on a wired autonomous agent, not a dormant/dead-code risk.
2. **`donor_discovery_prospects.scored_at` (migration 078)** — the live donor-discovery scoring worker job (`src/worker/jobs/score-donor-prospect.ts`) filters on and writes this column on every run. Plausible root cause (or contributing factor) for project memory `benavora-donor-discovery-pipeline-empty-in-prod` (all donor discovery tables confirmed empty except taxonomy, 2026-07-20).
3. **`org_settings` (migration 080)** — powers `/api/autoapply/mode/route.ts`, the AutoApply automation-mode toggle API. Likely contributor to the AutoApply `automation_level` issues already tracked in project memory.
4. **`funder_relationship_scores.trend/recent_events/is_stale` (migration 039)** — actively read/written by the live, queue-wired AG-19 FunderRelationshipAgent (`src/lib/agents/funder-relationship.ts`).
5. **`notification_preferences` (migration 087)** — gates all notification dispatch per Behavioral Contracts §32 (`src/lib/notifications/notify.ts`). If this table is missing, per-user notification preferences are not actually being honored platform-wide.
6. **Duplicate `052` migration filenames, both unapplied** — `052_governance_layer.sql` and `052_webhook_configs.sql`. The whole `queue_controls` / `submission_usage` / `tier_limits` / `funder_relationships` / risk-scoring governance layer (52) and the AutoApply webhook notification system (also 52) are both fully absent from production, and both have substantial live consumer code already written against them (queue-controls.ts alone has 12 call sites).
7. **The whole AutoApply "Request Profile System" (migration 051) is far larger than just `request_profiles`** — 8 tables total (`request_profiles`, `kb_extended_needs`, `pitch_cache`, `org_documents`, `submission_receipts`, `grant_agreements`, `webhook_configs`, `cross_client_submissions`) plus 8 columns on `submission_queue`/`autoapply_submissions`. Every one of these except `kb_extended_needs` has live consumer code. This is a much bigger gap than the single-table framing in prior sessions suggested.
8. **SchoolFunder (migration 103) has zero backing tables in production** — all 3 tables (`schoolfunder_students`, `schoolfunder_volunteer_hours`, `schoolfunder_donations`) are missing, despite SchoolFunder being confirmed a real, live, intentionally-kept feature (STATE_OF_THE_BUILD.md, July 23 2026 session: "SchoolFunder was NOT removed... real and live"). Every route under `/api/schoolfunder/*` and the `/schoolfunder` dashboard page will fail against production today.
9. **Financial Reconciliation (migrations 084/089) has zero backing tables** — `grant_budgets`, `grant_expenses`, `grant_reconciliation_reports` all missing, independently corroborating SCHEMA_REGISTRY_v2.md's July 19, 2026 finding. The `/financials` page and all `/api/applications/[id]/{budget,expenses,reconcile}` routes are built against a schema that was never applied.
10. **Compliance (migrations 085/087/090) has zero backing tables** — `compliance_requirements`, `notification_preferences`, `compliance_events` all missing. The `/compliance` calendar page and `/api/compliance*` routes are affected.

## Lower-priority / likely-abandoned findings

- **`intelligence_grantmaker_profiles` (migration 060)** — a 9-column redesign that no live code was found to reference by its new column names. All real consumers still use the original migration-048 schema, which is live. Looks like an abandoned redesign, not an active risk.
- **`email_threads` / `email_messages` (migration 054)** — no live code references. The actually-live equivalent tables are `synced_email_threads` / `synced_email_messages` (migration 002, confirmed present in production). Superseded design, not a risk.
- **`automation_sessions.session_type/steps/screenshots/approval_required_at` (migration 020)** — only found in TypeScript type definitions, not in an active query. The real runtime uses the separate, live `automation_steps`/`automation_screenshots` child tables instead. Superseded design, not a risk.
- **`kb_extended_needs` (migration 051)** — no live code references found anywhere. Genuinely dead.

## Not covered by this audit

- `src/supabase/migrations/` (32 files, the second parallel migrations directory per project memory `benavora-two-parallel-migrations-directories`) — out of scope; this audit only covers root `supabase/migrations/` as the task specified.
- RLS policy text (PostgREST introspection does not expose `pg_policies`) — table/column *existence* was verified, not policy correctness.
- Postgres `enum` type values added via `ALTER TYPE ... ADD VALUE` (e.g. the `agent_type` gap documented in AGENTS_v2.md §1.2) — out of scope; this audit covers `CREATE TABLE`/`ALTER TABLE ... ADD COLUMN` only, per the task.
