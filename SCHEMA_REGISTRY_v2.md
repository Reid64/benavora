# BENAVORA — Schema Registry v2.0
## Supersedes: SCHEMA_REGISTRY.md v1.0
## Date: July 17, 2026 — Live Database Audit addendum added July 19, 2026 (see below)
## Status: CANONICAL — All migrations listed here are the authoritative source of truth.
## Current migration count: 099 applied or queued — NOTE: this is stale. A July 19, 2026 audit
## found two live, divergent migration tracks (root `supabase/migrations/` runs 001-100; a separate
## `src/supabase/migrations/` runs 072-094) and a live table count of 132, not matching this number.
## See "Live Database Audit — July 19, 2026" below before trusting any count in this header.

---

## Migration Strategy

Migrations are sequential, idempotent, and applied via the Supabase Management API:
```
POST https://api.supabase.com/v1/projects/vbjplpquqxxfbpazyalt/database/query
Authorization: Bearer sbp_a63596024b79b5964d2dc2971ac9d4cc77a112c1
Content-Type: application/json
Body: {"query": "SQL_HERE"}
```

Rules:
- All DDL uses `IF NOT EXISTS`
- All indexes use `IF NOT EXISTS`
- Non-ASCII characters are forbidden — Supabase Management API rejects them
- Split large SQL into separate statements to avoid payload limits
- Never use `&&` in PowerShell — use semicolons

---

## Live Database Audit — July 19, 2026

This section reconciles this document against the ACTUAL production database (project `vbjplpquqxxfbpazyalt`), queried via PostgREST OpenAPI introspection (`GET /rest/v1/` with the service-role key) since both the Supabase MCP connector and the Management API token in this document's own §8.3 were unavailable/unauthorized this session (Management API returned 401 — see project memory `benavora-management-api-pat-rejected`). PostgREST introspection gives table/column/type/PK/FK data but **not RLS policy text** — RLS status below is inferred from the presence/absence of an `organization_id` column and the project's stated standard policy pattern (see "RLS Master Policy Pattern" above), not verified against `pg_policies`.

**Total live tables (public schema): 132.** Tables documented in this file's numbered sections above: 71. Of those 71, **28 do not exist in the live database at all** (migration-file-only, never applied, or superseded by a differently-named table). **89 live tables have no entry anywhere in this file.**

### Tables documented above that do NOT exist in production

These were written into this file (Tables — Shared Intelligence / AutoApply / Platform Vision Phase 1 sections) from migration files that were drafted but never applied to project `vbjplpquqxxfbpazyalt`, or the table was renamed before shipping. Confirmed via `SESSION_STATE.md`'s own note that Reputation Intelligence and Disaster Response tables "were only ever migrated to a stray `src/supabase/migrations/` directory and were never applied to the live database" — this audit shows the gap is much larger than those two features.

| Documented name | Real live table (if a rename/successor exists) |
|---|---|
| application_stage_history | pipeline_history |
| board_meeting_packets | — (no successor found; feature never shipped to prod) |
| board_meetings | — (no successor found; feature never shipped to prod) |
| compliance_events | — (no successor found; feature never shipped to prod) |
| consultant_client_access | — (no successor found; feature never shipped to prod) |
| corporate_enrichment_queue | — (no successor found; feature never shipped to prod) |
| corporate_monitoring_events | — (no successor found; feature never shipped to prod) |
| corporate_prospects | — (no successor found; feature never shipped to prod) |
| corporate_relationship_people | — (no successor found; feature never shipped to prod) |
| corporate_relationships | — (no successor found; feature never shipped to prod) |
| disaster_declarations | — (no successor found; feature never shipped to prod) |
| disaster_emergency_funds | — (no successor found; feature never shipped to prod) |
| donor_discovery_aliases | donor_discovery_taxonomy_aliases |
| drafts | draft_versions |
| form_analyses | form_templates |
| funding_forecasts | — (no successor found; feature never shipped to prod) |
| grant_budgets | — (no successor found; feature never shipped to prod) |
| grant_expenses | — (no successor found; feature never shipped to prod) |
| grant_reconciliation_reports | — (no successor found; feature never shipped to prod) |
| impact_simulations | — (no successor found; feature never shipped to prod) |
| knowledge_base_entries | knowledge_base |
| notification_preferences | — (no successor found; feature never shipped to prod) |
| pig_edges | — (no successor found; feature never shipped to prod) |
| pig_nodes | — (no successor found; feature never shipped to prod) |
| relationship_memory | — (no successor found; feature never shipped to prod) |
| relationship_recommendations | — (no successor found; feature never shipped to prod) |
| reputation_alerts | — (no successor found; feature never shipped to prod) |
| reputation_signals | — (no successor found; feature never shipped to prod) |

### Undocumented live tables, by feature area

89 tables exist in production with no entry in this document. Full column list, source migration, and known code consumers below (consumers found via repo-wide grep for `.from('table_name')`, not from RLS/DB introspection).

#### AutoApply/Automation

**`auto_queue_config`** — Per-org settings controlling AutoApply auto-queue population (schedule, batch size, exclusions).
- Migration: 049_auto_queue_config.sql
- Columns: id uuid NOT NULL, organization_id uuid NOT NULL, enabled boolean NOT NULL, max_per_batch integer NOT NULL, schedule text NOT NULL, categories string[], geographic_scope string[], min_company_size text, exclusion_list string[], dedup_window_days integer NOT NULL, last_run_at timestamp with time zone, last_run_queued integer, last_run_skipped integer, created_at timestamp with time zone, updated_at timestamp with time zone
- Consumers: src/app/api/autoapply/config/route.ts; src/app/api/cron/autoapply/route.ts; src/lib/autoapply/auto-queue-populator.ts; src/components/autoapply/QueuePreview.tsx
- Read/write: both
- RLS: org-scoped — standard `organization_id = profiles.organization_id` policy assumed (not verified against pg_policies)

**`autoapply_follow_ups`** — Scheduled/sent follow-up messages for AutoApply submissions.
- Migration: 065_autoapply_follow_ups.sql (also touched in 053_multichannel_analytics.sql)
- Columns: id uuid NOT NULL, organization_id uuid NOT NULL, submission_id uuid NOT NULL, funder_id uuid NOT NULL, sequence_number integer NOT NULL, scheduled_at timestamp with time zone NOT NULL, sent_at timestamp with time zone, status text NOT NULL, template_type text NOT NULL, content text, response_received boolean NOT NULL, cancel_reason text, created_at timestamp with time zone NOT NULL
- Consumers: src/lib/autoapply/follow-up-scheduler.ts; src/app/api/autoapply/follow-ups/route.ts; src/app/api/autoapply/follow-ups/[id]/route.ts; src/app/api/autoapply/follow-ups/stats/route.ts
- Read/write: both
- RLS: org-scoped — standard `organization_id = profiles.organization_id` policy assumed (not verified against pg_policies)

**`autoapply_review_queue`** — Queue of flagged/failed AutoApply submissions awaiting human review.
- Migration: 050_funder_credentials.sql
- Columns: id uuid NOT NULL, submission_id uuid, organization_id uuid NOT NULL, funder_id uuid NOT NULL, reason text NOT NULL, failure_count integer NOT NULL, status text NOT NULL, assigned_to uuid, resolved_at timestamp with time zone, resolution_notes text, created_at timestamp with time zone
- Consumers: worker/queue-processor.ts; src/components/autoapply/ReviewQueue.tsx
- Read/write: both
- RLS: org-scoped — standard `organization_id = profiles.organization_id` policy assumed (not verified against pg_policies)

**`autoapply_screenshots`** — Screenshots captured at each stage of an AutoApply submission.
- Migration: 050_funder_credentials.sql
- Columns: id uuid NOT NULL, submission_id uuid, stage text NOT NULL, storage_path text NOT NULL, captured_at timestamp with time zone, metadata jsonb
- Consumers: src/lib/autoapply/screenshot-manager.ts; src/components/autoapply/ReviewQueue.tsx; worker/queue-processor.ts
- Read/write: both
- RLS: no organization_id column — shared/platform-level table, RLS status not verified this session

**`autoapply_submissions`** — Core AutoApply submission records (status, confirmation, funder).
- Migration: 045_autoapply_tables.sql
- Columns: id uuid NOT NULL, organization_id uuid NOT NULL, funder_id uuid, form_template_id uuid, status text NOT NULL, request_description text, request_type text, request_amount numeric, pre_submit_screenshot_url text, confirmation_screenshot_url text, confirmation_number text, error_message text, error_screenshot_url text, retry_count integer NOT NULL, next_retry_at timestamp with time zone, submitted_at timestamp with time zone, created_at timestamp with time zone NOT NULL
- Consumers: worker/queue-processor.ts; src/lib/autoapply/response-analytics.ts; src/lib/agents/form-filler.ts; src/components/autoapply/SubmissionHistory.tsx
- Read/write: both
- RLS: org-scoped — standard `organization_id = profiles.organization_id` policy assumed (not verified against pg_policies)

**`automation_notifications`** — User-facing notifications emitted by automation/agent/draft workers.
- Migration: 036_automation_notifications.sql
- Columns: id uuid NOT NULL, organization_id uuid NOT NULL, session_id uuid, event_type text NOT NULL, message text NOT NULL, is_read boolean, sent_via text, created_at timestamp with time zone
- Consumers: src/lib/services/notification-dispatcher.ts; src/app/api/notifications/route.ts; src/lib/agents/automation-worker.ts; src/lib/calendar/reminder-engine.ts
- Read/write: both
- RLS: org-scoped — standard `organization_id = profiles.organization_id` policy assumed (not verified against pg_policies)

**`automation_queue`** — Queue of browser-automation jobs (form fill/doc upload) for applications — distinct from submission_queue.
- Migration: 035_automation_queue.sql
- Columns: id uuid NOT NULL, organization_id uuid NOT NULL, application_id uuid, priority integer, status text, automation_level text, retry_count integer, max_retries integer, error_log jsonb, created_at timestamp with time zone, started_at timestamp with time zone, completed_at timestamp with time zone
- Consumers: src/lib/agents/automation-worker.ts; src/app/api/automation/queue/route.ts; src/app/api/admin/monitor/route.ts; src/app/api/admin/jobs/[id]/retry/route.ts
- Read/write: both
- RLS: org-scoped — standard `organization_id = profiles.organization_id` policy assumed (not verified against pg_policies)

**`automation_screenshots`** — Screenshots captured during an automation_sessions run.
- Migration: 002_phases_2_5.sql
- Columns: id uuid NOT NULL, session_id uuid NOT NULL, step_id uuid, storage_path text NOT NULL, description text, page_url text, captured_at timestamp with time zone
- Consumers: src/lib/automation/session-manager.ts; src/app/api/agents/automation/[sessionId]/route.ts
- Read/write: both
- RLS: no organization_id column — shared/platform-level table, RLS status not verified this session

**`automation_sessions`** — Tracks individual browser-automation run sessions and their status.
- Migration: 002_phases_2_5.sql (extended by 020_automation_sessions.sql)
- Columns: id uuid NOT NULL, organization_id uuid NOT NULL, application_id uuid, opportunity_id uuid, funder_id uuid, status public.automation_status NOT NULL, target_url text, mapped_fields jsonb, unmapped_fields jsonb, confirmation_number text, error_message text, notes text, started_by uuid, approved_by uuid, started_at timestamp with time zone, completed_at timestamp with time zone, created_at timestamp with time zone, updated_at timestamp with time zone
- Consumers: src/lib/automation/session-manager.ts; src/lib/agents/playwright-agent.ts; src/lib/automation/verification.ts; worker/queue-processor.ts
- Read/write: both
- RLS: org-scoped — standard `organization_id = profiles.organization_id` policy assumed (not verified against pg_policies)

**`automation_steps`** — Step-by-step action log for an automation session.
- Migration: 002_phases_2_5.sql
- Columns: id uuid NOT NULL, session_id uuid NOT NULL, step_number integer NOT NULL, action text NOT NULL, description text, status text, input_data jsonb, output_data jsonb, error_message text, duration_ms integer, created_at timestamp with time zone
- Consumers: src/lib/automation/auto-filler.ts; src/lib/automation/document-uploader.ts; src/lib/automation/session-manager.ts
- Read/write: both
- RLS: no organization_id column — shared/platform-level table, RLS status not verified this session

**`competitor_tracking`** — Tracks competing grant awards/applicants for competitive-intelligence scoring.
- Migration: 040_competitor_intel_agent.sql
- Columns: id uuid NOT NULL, organization_id uuid NOT NULL, competitor_name text NOT NULL, competitor_ein text, funder_id uuid, grant_amount numeric, grant_purpose text, fiscal_year integer, source text, created_at timestamp with time zone
- Consumers: src/lib/agents/competitor-intel.ts; src/lib/agents/success-probability.ts; src/app/(dashboard)/intelligence/competitors/page.tsx
- Read/write: both
- RLS: org-scoped — standard `organization_id = profiles.organization_id` policy assumed (not verified against pg_policies)

**`draft_automation_config`** — Per-org config controlling auto-generation/auto-submission of drafts.
- Migration: 057_draft_automation_pipeline.sql
- Columns: id uuid NOT NULL, organization_id uuid NOT NULL, is_enabled boolean, min_eligibility_score integer, auto_generate_on_discovery boolean, auto_generate_on_deadline_days integer, daily_draft_limit integer, preferred_template_rules jsonb, excluded_categories string[], excluded_funder_ids string[], require_approval_before_submit boolean, auto_submit_above_confidence integer, notification_on_generation boolean, notification_on_deadline boolean, created_at timestamp with time zone, updated_at timestamp with time zone
- Consumers: src/lib/drafts/draft-queue-engine.ts; src/lib/drafts/auto-generator.ts; src/app/api/drafts/queue/config/route.ts; src/app/api/cron/draft-automation/route.ts
- Read/write: both
- RLS: org-scoped — standard `organization_id = profiles.organization_id` policy assumed (not verified against pg_policies)

**`draft_queue`** — Queue of AI-generated grant drafts pending review/auto-submission.
- Migration: 057_draft_automation_pipeline.sql
- Columns: id uuid NOT NULL, organization_id uuid NOT NULL, opportunity_id uuid NOT NULL, application_id uuid, status public.draft_queue_status, trigger_reason public.draft_trigger NOT NULL, template_type text NOT NULL, priority integer, draft_id uuid, confidence_score integer, gap_count integer, word_count integer, auto_generated_at timestamp with time zone, reviewed_by uuid, reviewed_at timestamp with time zone, review_notes text, approved_at timestamp with time zone, rejected_reason text, submitted_to_autoapply_at timestamp with time zone, deadline_date timestamp with time zone, scheduled_for date, error_message text, retry_count integer, max_retries integer, created_at timestamp with time zone, updated_at timestamp with time zone
- Consumers: src/lib/drafts/draft-queue-engine.ts; src/lib/drafts/auto-generator.ts; src/app/api/drafts/queue/route.ts; src/app/api/drafts/queue/[id]/route.ts
- Read/write: both
- RLS: org-scoped — standard `organization_id = profiles.organization_id` policy assumed (not verified against pg_policies)

**`draft_versions`** — Version history of generated application narrative drafts — the real live drafts table; SCHEMA_REGISTRY_v2.md's prior 'drafts' entry does not exist.
- Migration: 009_draft_versions.sql
- Columns: id uuid NOT NULL, organization_id uuid NOT NULL, opportunity_id uuid NOT NULL, application_id uuid, template_type public.draft_template_type NOT NULL, content text NOT NULL, confidence_score integer, knowledge_sources jsonb, version_number integer NOT NULL, humanization_status public.humanization_status NOT NULL, source text NOT NULL, created_by uuid, created_at timestamp with time zone
- Consumers: src/lib/drafts/generator.ts; src/lib/drafts/submission-bridge.ts; src/app/(dashboard)/draft-generator/page.tsx; src/app/api/drafts/queue/[id]/route.ts
- Read/write: both
- RLS: org-scoped — standard `organization_id = profiles.organization_id` policy assumed (not verified against pg_policies)

**`form_templates`** — Funder portal form field mappings used by the AutoApply form filler.
- Migration: 045_autoapply_tables.sql
- Columns: id uuid NOT NULL, organization_id uuid NOT NULL, funder_id uuid, portal_url text NOT NULL, form_structure jsonb, field_mapping jsonb, is_multi_step boolean NOT NULL, step_navigation jsonb, requires_login boolean NOT NULL, requires_file_upload boolean NOT NULL, file_upload_fields jsonb, last_verified_at timestamp with time zone, last_used_at timestamp with time zone, created_at timestamp with time zone NOT NULL, updated_at timestamp with time zone NOT NULL, auto_generated boolean NOT NULL, field_count integer
- Consumers: src/lib/agents/form-analyzer.ts; src/lib/agents/form-filler.ts; worker/queue-processor.ts; src/app/(dashboard)/autoapply/templates/page.tsx
- Read/write: both
- RLS: org-scoped — standard `organization_id = profiles.organization_id` policy assumed (not verified against pg_policies)

**`historical_awards`** — Historical grant award records ingested from USASpending for research.
- Migration: 042_historical_awards.sql
- Columns: id uuid NOT NULL, organization_id uuid NOT NULL, recipient_name text, award_amount numeric, award_date date, awarding_agency text, description text, award_id text, source text, created_at timestamp with time zone
- Consumers: src/lib/agents/usaspending.ts; src/app/(dashboard)/research/page.tsx
- Read/write: both
- RLS: org-scoped — standard `organization_id = profiles.organization_id` policy assumed (not verified against pg_policies)

**`pipeline_history`** — Audit log of application pipeline stage changes — the real live table; SCHEMA_REGISTRY_v2.md's prior 'application_stage_history' entry does not exist.
- Migration: 001_initial_schema.sql
- Columns: id uuid NOT NULL, organization_id uuid NOT NULL, application_id uuid NOT NULL, from_stage public.pipeline_stage, to_stage public.pipeline_stage NOT NULL, changed_by uuid, notes text, created_at timestamp with time zone
- Consumers: src/components/applications/pipeline.ts; src/components/applications/ApplicationDetail.tsx; src/lib/agents/application-cloner.ts; src/lib/agents/browser-automation.ts
- Read/write: both
- RLS: org-scoped — standard `organization_id = profiles.organization_id` policy assumed (not verified against pg_policies)

**`proven_narratives`** — Reusable 'winning' grant narrative sections extracted from awarded applications, with effectiveness scoring for future AI drafts.
- Migration: 001_initial_schema.sql
- Columns: id uuid NOT NULL, organization_id uuid NOT NULL, outcome_id uuid NOT NULL, knowledge_base_id uuid, narrative_text text NOT NULL, section_type text, funder_category public.funder_category, success_count integer, effectiveness_score numeric, last_used_at timestamp with time zone, created_at timestamp with time zone, success_patterns jsonb
- Consumers: src/lib/agents/recursive-learning.ts; src/lib/agents/draft-generation-agent.ts; src/lib/drafts/generator.ts; src/lib/agents/success-probability.ts
- Read/write: both
- RLS: org-scoped — standard `organization_id = profiles.organization_id` policy assumed (not verified against pg_policies)

**`renewals`** — Tracks recurring grant renewal deadlines/compliance created after an award outcome (rows written by a DB trigger, not app code).
- Migration: 016_renewals.sql
- Columns: id uuid NOT NULL, organization_id uuid NOT NULL, application_id uuid NOT NULL, opportunity_id uuid NOT NULL, funder_id uuid, renewal_type text NOT NULL, reporting_deadline date, renewal_window_start date, renewal_window_end date, compliance_status text NOT NULL, compliance_notes text, auto_narrative_draft text, alert_sent_60d boolean NOT NULL, alert_sent_30d boolean NOT NULL, alert_sent_14d boolean NOT NULL, created_at timestamp with time zone NOT NULL, updated_at timestamp with time zone NOT NULL
- Consumers: src/app/api/renewals/route.ts; src/app/api/compliance/route.ts; src/app/(dashboard)/deadlines/page.tsx
- Read/write: read (writes via DB trigger)
- RLS: org-scoped — standard `organization_id = profiles.organization_id` policy assumed (not verified against pg_policies)

#### Donor Discovery

**`adapter_usage_log`** — Logs per-call usage/cost of donor-discovery adapters (e.g. Google Places) for rate/cost tracking.
- Migration: 076_adapter_usage_log.sql
- Columns: id uuid NOT NULL, organization_id uuid, adapter_name text NOT NULL, api_cost_cents integer NOT NULL, records_returned integer NOT NULL, cache_hit boolean NOT NULL, called_at timestamp with time zone NOT NULL
- Consumers: src/lib/donor-discovery/connectors/usage-log.ts; src/lib/donor-discovery/adapters/google-places-adapter.ts; src/app/api/donor-discovery/connectors/route.ts
- Read/write: both
- RLS: org-scoped — standard `organization_id = profiles.organization_id` policy assumed (not verified against pg_policies)

**`community_foundation_registry`** — Registry of community foundations (name, website, grants page, assets) as donor-discovery scraping targets.
- Migration: 062_community_foundations.sql
- Columns: id uuid NOT NULL, name text NOT NULL, website text NOT NULL, grants_page text, state text, estimated_assets numeric, programs_found jsonb, last_checked_at timestamp with time zone, last_snapshot text, is_active boolean, created_at timestamp with time zone
- Consumers: none found — zero code references (dead/unused, migration + docs only)
- Read/write: dead/unused
- RLS: no organization_id column — shared/platform-level table, RLS status not verified this session

**`corporate_giving_targets`** — Registry of corporate giving programs (company, giving page, funding areas) as donor-discovery scraping targets.
- Migration: 061_corporate_giving_targets.sql
- Columns: id uuid NOT NULL, company_name text NOT NULL, website text NOT NULL, giving_page text, program_names string[], geographic_focus string[], funding_areas string[], estimated_annual_giving numeric, application_url text, last_checked_at timestamp with time zone, last_snapshot text, change_history jsonb, is_active boolean, created_at timestamp with time zone
- Consumers: none found — zero code references (dead/unused, migration + docs only)
- Read/write: dead/unused
- RLS: no organization_id column — shared/platform-level table, RLS status not verified this session

**`dd_api_spend`** — Monthly budget tracker for paid donor-discovery API usage (e.g. Google Places) to enforce spend caps.
- Migration: 069_donor_discovery_places_adapter.sql
- Columns: id uuid NOT NULL, provider text NOT NULL, month text NOT NULL, requests integer NOT NULL, est_cost_usd numeric NOT NULL, updated_at timestamp with time zone NOT NULL
- Consumers: src/lib/donor-discovery/adapters/google-places.ts
- Read/write: both
- RLS: no organization_id column — shared/platform-level table, RLS status not verified this session

**`dd_prospect_requests`** — Junction: which donor_discovery_prospects rows came from which donor_discovery_requests run.
- Migration: 071_donor_discovery_directory_dedup.sql
- Columns: id uuid NOT NULL, prospect_id uuid NOT NULL, request_id uuid NOT NULL, created_at timestamp with time zone NOT NULL
- Consumers: src/lib/donor-discovery/directory.ts; src/app/api/donor-discovery/prospects/route.ts; src/app/api/donor-discovery/requests/route.ts; src/app/api/donor-discovery/requests/[id]/route.ts
- Read/write: both
- RLS: no organization_id column — shared/platform-level table, RLS status not verified this session

**`dd_robots_cache`** — Cache of fetched robots.txt content per domain to avoid re-fetching during compliant scraping.
- Migration: 068_donor_discovery_crawler_core.sql
- Columns: domain text NOT NULL, robots_txt text NOT NULL, status_code integer, fetched_at timestamp with time zone NOT NULL
- Consumers: src/lib/donor-discovery/crawler-core.ts
- Read/write: both
- RLS: no organization_id column — shared/platform-level table, RLS status not verified this session

**`donor_discovery_connectors`** — Configured data-source connectors (e.g. Google Places adapter) used to enrich/run donor discovery jobs.
- Migration: 067_donor_discovery_foundation.sql
- Columns: id uuid NOT NULL, organization_id uuid NOT NULL, provider public.donor_discovery_connector_provider NOT NULL, encrypted_api_key text NOT NULL, status public.donor_discovery_connector_status NOT NULL, activated_at timestamp with time zone, created_at timestamp with time zone NOT NULL
- Consumers: src/worker/jobs/run-connector-enrichment.ts; src/lib/donor-discovery/adapters/google-places-adapter.ts; src/app/api/donor-discovery/connectors/route.ts
- Read/write: both
- RLS: org-scoped — standard `organization_id = profiles.organization_id` policy assumed (not verified against pg_policies)

**`donor_discovery_geocache`** — Cache of geocoding results (lat/lng) keyed by address to avoid repeat geocoding API calls.
- Migration: 077_donor_discovery_geocache.sql
- Columns: address_hash text NOT NULL, lat numeric NOT NULL, lng numeric NOT NULL, formatted_address text NOT NULL, state text, county text, zip text, cached_at timestamp with time zone NOT NULL
- Consumers: src/lib/donor-discovery/adapters/geocoding-adapter.ts; src/app/api/donor-discovery/geocode/route.ts
- Read/write: both
- RLS: no organization_id column — shared/platform-level table, RLS status not verified this session

**`donor_discovery_prospects`** — Core table of discovered/scored donor prospect organizations surfaced to users (distinct from donor_discovery_directory, the raw scraped-source table).
- Migration: 067_donor_discovery_foundation.sql
- Columns: id uuid NOT NULL, organization_id uuid NOT NULL, directory_id uuid NOT NULL, request_id uuid NOT NULL, score integer, score_rationale text, pipeline_stage public.donor_discovery_pipeline_stage NOT NULL, notes text, assigned_to uuid, created_at timestamp with time zone NOT NULL
- Consumers: src/lib/donor-discovery/directory.ts; src/lib/donor-discovery/scoring-engine.ts; src/worker/jobs/score-donor-prospect.ts; src/app/api/donor-discovery/prospects/route.ts
- Read/write: both
- RLS: org-scoped — standard `organization_id = profiles.organization_id` policy assumed (not verified against pg_policies)

**`donor_discovery_taxonomy_aliases`** — Alias/keyword mappings (trade names) linked to donor_discovery_taxonomy categories — the real live table; SCHEMA_REGISTRY_v2.md's prior 'donor_discovery_aliases' entry does not exist.
- Migration: 075_donor_discovery_taxonomy_aliases.sql
- Columns: id uuid NOT NULL, taxonomy_id uuid NOT NULL, alias text NOT NULL, alias_type text NOT NULL, created_at timestamp with time zone
- Consumers: src/lib/donor-discovery/adapters/google-places-adapter.ts; src/app/api/donor-discovery/taxonomy/search/route.ts; scripts/seed-dd-aliases.ts
- Read/write: read
- RLS: no organization_id column — shared/platform-level table, RLS status not verified this session

**`donor_discovery_tos_registry`** — Registry of domains with explicit scrape-permission exceptions (ToS compliance) checked before crawling.
- Migration: 068_donor_discovery_crawler_core.sql
- Columns: domain text NOT NULL, scrape_allowed boolean NOT NULL, notes text, created_at timestamp with time zone NOT NULL, updated_at timestamp with time zone NOT NULL
- Consumers: src/lib/donor-discovery/crawler-core.ts
- Read/write: read
- RLS: no organization_id column — shared/platform-level table, RLS status not verified this session

**`funder_credentials`** — Stores funder portal login credentials used by AutoApply to authenticate/submit applications.
- Migration: 050_funder_credentials.sql
- Columns: id uuid NOT NULL, organization_id uuid NOT NULL, funder_id uuid NOT NULL, portal_url text NOT NULL, username text NOT NULL, encrypted_password text NOT NULL, mfa_secret text, login_method text NOT NULL, last_login_at timestamp with time zone, login_success boolean, notes text, created_at timestamp with time zone, updated_at timestamp with time zone
- Consumers: src/lib/autoapply/credential-manager.ts
- Read/write: both
- RLS: org-scoped — standard `organization_id = profiles.organization_id` policy assumed (not verified against pg_policies)

**`funder_giving_history`** — Historical grant/giving records per funder used for risk scoring, amount optimization, and competitor intel.
- Migration: 037_giving_history.sql
- Columns: id uuid NOT NULL, organization_id uuid NOT NULL, funder_id uuid, recipient_name text, recipient_ein text, amount numeric, purpose text, fiscal_year integer, source_filing_url text, created_at timestamp with time zone
- Consumers: src/lib/agents/competitor-intel.ts; src/lib/agents/success-probability.ts; src/lib/autoapply/risk-engine.ts; src/lib/autoapply/amount-optimizer.ts
- Read/write: read
- RLS: org-scoped — standard `organization_id = profiles.organization_id` policy assumed (not verified against pg_policies)

**`funder_intelligence`** — Aggregated funder profile/intelligence data (semantic matching, funder detail views, giving-history agent).
- Migration: 015_funder_intelligence.sql
- Columns: id uuid NOT NULL, organization_id uuid NOT NULL, funder_id uuid NOT NULL, priorities string[], recent_grants jsonb, board_members jsonb, review_criteria text, funding_cycles text, average_grant_size numeric, total_annual_giving numeric, application_tips text, last_scraped_at timestamp with time zone, raw_data jsonb, created_at timestamp with time zone, updated_at timestamp with time zone
- Consumers: src/components/funders/FunderDetail.tsx; src/lib/agents/semantic-matching.ts; src/lib/agents/giving-history.ts; src/lib/agents/funder-intel.ts
- Read/write: read
- RLS: org-scoped — standard `organization_id = profiles.organization_id` policy assumed (not verified against pg_policies)

**`scraping_targets`** — User-configured custom scrape target definitions (URLs/rules) for the custom-connections integration.
- Migration: 041_scraping_targets.sql
- Columns: id uuid NOT NULL, organization_id uuid NOT NULL, url text NOT NULL, description text, scrape_schedule text, last_scraped_at timestamp with time zone, last_success_at timestamp with time zone, failure_count integer, is_active boolean, created_at timestamp with time zone
- Consumers: src/app/api/integrations/scraping-targets/route.ts; src/app/api/integrations/scraping-targets/[id]/route.ts; src/lib/agents/custom-scrape.ts
- Read/write: both
- RLS: org-scoped — standard `organization_id = profiles.organization_id` policy assumed (not verified against pg_policies)

#### Email/Calendar/Sales

**`calendar_connections`** — Stores OAuth tokens/config for a user's connected Google Calendar account.
- Migration: 054_email_calendar_integration.sql
- Columns: id uuid NOT NULL, organization_id uuid NOT NULL, user_id uuid NOT NULL, provider text NOT NULL, calendar_id text NOT NULL, calendar_name text, access_token_encrypted text, refresh_token_encrypted text, token_expires_at timestamp with time zone, sync_status public.calendar_sync_status, last_sync_at timestamp with time zone, sync_token text, created_at timestamp with time zone, updated_at timestamp with time zone
- Consumers: src/lib/calendar/gcal-auth.ts; src/lib/calendar/gcal-sync.ts; src/lib/calendar/reminder-engine.ts; src/app/(dashboard)/settings/integrations/page.tsx
- Read/write: both
- RLS: org-scoped — standard `organization_id = profiles.organization_id` policy assumed (not verified against pg_policies)

**`calendar_events`** — Synced Google Calendar events (deadlines/meetings) linked to a calendar_connection, drives reminders.
- Migration: 054_email_calendar_integration.sql
- Columns: id uuid NOT NULL, organization_id uuid NOT NULL, connection_id uuid NOT NULL, google_event_id text, title text NOT NULL, description text, start_time timestamp with time zone NOT NULL, end_time timestamp with time zone NOT NULL, all_day boolean, location text, event_type text, linked_deadline_id uuid, linked_opportunity_id uuid, linked_application_id uuid, is_synced boolean, recurrence_rule text, reminder_minutes integer[], created_at timestamp with time zone, updated_at timestamp with time zone
- Consumers: src/lib/calendar/gcal-sync.ts; src/lib/calendar/reminder-engine.ts
- Read/write: both
- RLS: org-scoped — standard `organization_id = profiles.organization_id` policy assumed (not verified against pg_policies)

**`email_activity`** — AI-classified log of inbound emails (funder match, type, action flags) written by the email parser agent.
- Migration: 018_email_activity.sql
- Columns: id uuid NOT NULL, organization_id uuid NOT NULL, funder_id uuid, opportunity_id uuid, application_id uuid, email_type text NOT NULL, subject text, sender text, received_at timestamp with time zone, summary text, action_required boolean, action_description text, urgency text, thread_id text, processed_at timestamp with time zone, created_at timestamp with time zone
- Consumers: src/lib/agents/email-parser.ts
- Read/write: write (insert-only log)
- RLS: org-scoped — standard `organization_id = profiles.organization_id` policy assumed (not verified against pg_policies)

**`email_campaign_sequences`** — Defines a multi-step outbound email nurture sequence that prospects/contacts enroll in.
- Migration: 054_email_calendar_integration.sql
- Columns: id uuid NOT NULL, organization_id uuid NOT NULL, name text NOT NULL, description text, trigger_type text NOT NULL, trigger_config jsonb, status public.campaign_status, total_enrolled integer, total_completed integer, total_replied integer, created_by uuid, created_at timestamp with time zone, updated_at timestamp with time zone
- Consumers: src/lib/email/sequence-engine.ts; src/app/api/email/sequences/route.ts; src/app/api/email/sequences/[id]/route.ts; src/app/api/donor-discovery/prospects/[id]/route-to-email/route.ts
- Read/write: both
- RLS: org-scoped — standard `organization_id = profiles.organization_id` policy assumed (not verified against pg_policies)

**`email_connections`** — Stores per-user Gmail OAuth connection used for sending/syncing mail.
- Migration: 054_email_calendar_integration.sql
- Columns: id uuid NOT NULL, organization_id uuid NOT NULL, user_id uuid NOT NULL, provider text NOT NULL, email_address text NOT NULL, access_token_encrypted text, refresh_token_encrypted text, token_expires_at timestamp with time zone, sync_status public.email_sync_status, last_sync_at timestamp with time zone, sync_cursor text, scopes string[], created_at timestamp with time zone, updated_at timestamp with time zone
- Consumers: src/lib/email/gmail-auth.ts; src/lib/email/gmail-sync.ts; src/lib/email/sender.ts; src/app/api/email/sync/route.ts
- Read/write: both
- RLS: org-scoped — standard `organization_id = profiles.organization_id` policy assumed (not verified against pg_policies)

**`email_sequence_enrollments`** — Tracks a contact/prospect's enrollment + progress (next_send_at, status) in an email_campaign_sequence.
- Migration: 054_email_calendar_integration.sql
- Columns: id uuid NOT NULL, organization_id uuid NOT NULL, sequence_id uuid NOT NULL, contact_id uuid, funder_id uuid, email_address text NOT NULL, current_step integer, status text, enrolled_at timestamp with time zone, completed_at timestamp with time zone, paused_at timestamp with time zone, last_sent_at timestamp with time zone, next_send_at timestamp with time zone, reply_detected boolean, created_at timestamp with time zone, variables jsonb NOT NULL
- Consumers: src/app/api/email/sequences/[id]/enroll/route.ts; src/lib/email/sequence-engine.ts; src/app/api/email/sequences/[id]/analytics/route.ts
- Read/write: both
- RLS: org-scoped — standard `organization_id = profiles.organization_id` policy assumed (not verified against pg_policies)

**`email_sequence_steps`** — Individual step definitions (delay, template) belonging to an email_campaign_sequence.
- Migration: 054_email_calendar_integration.sql
- Columns: id uuid NOT NULL, sequence_id uuid NOT NULL, step_number integer NOT NULL, template_id uuid, subject_override text, body_override text, delay_days integer NOT NULL, delay_hours integer, condition_type text, condition_config jsonb, created_at timestamp with time zone
- Consumers: src/lib/email/sequence-engine.ts; src/app/api/email/sequences/[id]/route.ts; src/app/api/email/analytics/route.ts
- Read/write: both
- RLS: no organization_id column — shared/platform-level table, RLS status not verified this session

**`email_templates`** — Reusable email copy/subject templates referenced by sequence steps.
- Migration: 054_email_calendar_integration.sql
- Columns: id uuid NOT NULL, organization_id uuid NOT NULL, name text NOT NULL, subject_template text NOT NULL, body_template text NOT NULL, template_type text NOT NULL, variables string[], is_active boolean, use_count integer, created_by uuid, created_at timestamp with time zone, updated_at timestamp with time zone
- Consumers: src/app/api/email/templates/route.ts; src/lib/email/sequence-engine.ts; src/app/api/email/analytics/route.ts
- Read/write: both
- RLS: org-scoped — standard `organization_id = profiles.organization_id` policy assumed (not verified against pg_policies)

**`email_thread_links`** — Links a synced email thread to a funder/contact/deal record for CRM-style association.
- Migration: 002_phases_2_5.sql
- Columns: id uuid NOT NULL, organization_id uuid NOT NULL, thread_id uuid NOT NULL, funder_id uuid, contact_id uuid, outreach_contact_id uuid, match_type text NOT NULL, created_at timestamp with time zone
- Consumers: src/lib/email/thread-linker.ts; src/lib/integrations/google/email-matcher.ts; src/app/api/email/threads/route.ts; src/app/api/email/link/route.ts
- Read/write: both
- RLS: org-scoped — standard `organization_id = profiles.organization_id` policy assumed (not verified against pg_policies)

**`prospect_lists`** — Named lists/batches grouping uploaded sales prospects (with total_prospects rollup).
- Migration: 055_admin_sales_outreach.sql
- Columns: id uuid NOT NULL, name text NOT NULL, description text, source text, total_prospects integer, imported_at timestamp with time zone, created_at timestamp with time zone
- Consumers: src/lib/admin/prospect-manager.ts
- Read/write: both
- RLS: no organization_id column — shared/platform-level table, RLS status not verified this session

**`prospects`** — Core outreach contact record (email, state, suppressed flag) used by sales campaigns/sends — the real prospect table; task-suggested 'outreach_prospects' does not exist.
- Migration: 055_admin_sales_outreach.sql
- Columns: id uuid NOT NULL, list_id uuid, ein text, org_name text NOT NULL, org_type text, email text, website text, city text, state text, zip text, annual_revenue numeric, employee_count integer, ntee_code text, subsection_code text, status text, suppressed boolean, suppressed_reason text, suppressed_at timestamp with time zone, last_contacted_at timestamp with time zone, total_emails_sent integer, has_replied boolean, has_converted boolean, converted_org_id uuid, created_at timestamp with time zone
- Consumers: src/lib/admin/prospect-manager.ts; src/app/api/admin/prospects/route.ts; src/app/api/admin/prospects/[id]/route.ts; src/lib/admin/sales-campaign-engine.ts
- Read/write: both
- RLS: no organization_id column — shared/platform-level table, RLS status not verified this session

**`sales_campaign_steps`** — Ordered outbound touch steps (email/wait) belonging to a sales_campaigns record.
- Migration: 055_admin_sales_outreach.sql
- Columns: id uuid NOT NULL, campaign_id uuid NOT NULL, step_number integer NOT NULL, subject_template text NOT NULL, body_template text NOT NULL, delay_days integer NOT NULL, created_at timestamp with time zone
- Consumers: src/lib/admin/sales-campaign-engine.ts
- Read/write: both
- RLS: no organization_id column — shared/platform-level table, RLS status not verified this session

**`sales_campaigns`** — Outbound sales/cold-email campaign definition referencing a prospect_lists list — the real campaign table; task-suggested 'outreach_campaigns' does not exist.
- Migration: 055_admin_sales_outreach.sql
- Columns: id uuid NOT NULL, name text NOT NULL, description text, list_id uuid, status text, sending_domain_ids string[], daily_send_target integer, send_window_start integer, send_window_end integer, send_timezone text, total_sent integer, total_opened integer, total_replied integer, total_unsubscribed integer, total_bounced integer, filter_criteria jsonb, created_at timestamp with time zone, updated_at timestamp with time zone
- Consumers: src/lib/admin/sales-campaign-engine.ts; src/app/api/admin/campaigns/route.ts; src/app/api/admin/campaigns/[id]/route.ts; src/app/api/admin/sales-analytics/route.ts
- Read/write: both
- RLS: no organization_id column — shared/platform-level table, RLS status not verified this session

**`sales_sends`** — Individual queued/sent outbound emails, one row per prospect per sales_campaign_steps touch, tracks delivery/reply status.
- Migration: 055_admin_sales_outreach.sql
- Columns: id uuid NOT NULL, campaign_id uuid NOT NULL, step_id uuid NOT NULL, prospect_id uuid NOT NULL, sending_domain_id uuid, from_address text NOT NULL, to_address text NOT NULL, subject text NOT NULL, body_html text, status text, sent_at timestamp with time zone, opened_at timestamp with time zone, replied_at timestamp with time zone, bounced_at timestamp with time zone, bounce_type text, unsubscribed_at timestamp with time zone, resend_message_id text, error_message text, scheduled_for timestamp with time zone, created_at timestamp with time zone
- Consumers: src/lib/admin/sales-campaign-engine.ts; src/app/api/admin/webhooks/email-events/route.ts; src/app/api/admin/webhooks/email-reply/route.ts; src/app/api/admin/sales-analytics/route.ts
- Read/write: both
- RLS: no organization_id column — shared/platform-level table, RLS status not verified this session

**`sending_domains`** — Outbound sending-domain inventory used for domain warmup/rotation and cold-email deliverability.
- Migration: 002_phases_2_5.sql
- Columns: id uuid NOT NULL, domain text NOT NULL, provider text NOT NULL, api_key_encrypted text, dns_verified boolean, warmup_status text, warmup_started_at timestamp with time zone, current_daily_limit integer, target_daily_limit integer, warmup_day integer, total_sent integer, total_bounced integer, total_complained integer, bounce_rate numeric, complaint_rate numeric, is_active boolean, health_status text, last_health_check_at timestamp with time zone, created_at timestamp with time zone, updated_at timestamp with time zone
- Consumers: src/lib/admin/domain-manager.ts; src/lib/admin/warmup-engine.ts; src/app/api/cron/domain-warmup/route.ts; src/app/api/admin/domains/route.ts
- Read/write: both
- RLS: no organization_id column — shared/platform-level table, RLS status not verified this session

**`suppression_list`** — Global do-not-email list (unsubscribes/bounces/complaints) checked before sales sends — the real live table; task-suggested 'email_suppressions' does not exist.
- Migration: 002_phases_2_5.sql
- Columns: id uuid NOT NULL, email text NOT NULL, reason text NOT NULL, source text, added_at timestamp with time zone
- Consumers: src/lib/admin/unsubscribe-agent.ts; src/app/api/unsubscribe/route.ts; src/app/api/admin/suppression/route.ts; src/lib/admin/sales-campaign-engine.ts
- Read/write: both
- RLS: no organization_id column — shared/platform-level table, RLS status not verified this session

**`synced_email_messages`** — Individual synced Gmail messages (per-thread) pulled in by Gmail sync.
- Migration: 002_phases_2_5.sql
- Columns: id uuid NOT NULL, organization_id uuid NOT NULL, thread_id uuid NOT NULL, gmail_message_id text NOT NULL, from_email text, from_name text, to_emails string[], cc_emails string[], subject text, body_text text, body_html text, sent_at timestamp with time zone, has_attachments boolean, attachment_names string[], created_at timestamp with time zone
- Consumers: src/lib/email/gmail-sync.ts; src/lib/email/contact-extractor.ts; src/lib/email/thread-linker.ts; src/app/api/email/summarize/route.ts
- Read/write: both
- RLS: org-scoped — standard `organization_id = profiles.organization_id` policy assumed (not verified against pg_policies)

**`synced_email_threads`** — Synced Gmail thread records (subject, participants) that email_thread_links and messages attach to.
- Migration: 002_phases_2_5.sql
- Columns: id uuid NOT NULL, organization_id uuid NOT NULL, gmail_thread_id text NOT NULL, subject text, snippet text, last_message_at timestamp with time zone, message_count integer, is_read boolean, labels string[], created_at timestamp with time zone, updated_at timestamp with time zone
- Consumers: src/lib/email/gmail-sync.ts; src/app/api/email/threads/route.ts; src/lib/integrations/google/email-matcher.ts
- Read/write: both
- RLS: org-scoped — standard `organization_id = profiles.organization_id` policy assumed (not verified against pg_policies)

#### Intelligence Library

**`intelligence_budget_patterns`** — Library of historical budget line-item templates/percentages by program category & grant type for budget justifications.
- Migration: 059_budget_patterns.sql (table also CREATE'd in 048_grant_intelligence.sql)
- Columns: id uuid NOT NULL, program_category text NOT NULL, grant_type text NOT NULL, line_items jsonb NOT NULL, typical_percentages jsonb, justification_examples jsonb, source text, created_at timestamp with time zone
- Consumers: src/lib/intelligence/budget-patterns.ts; src/app/(dashboard)/intelligence-library/dashboard/DashboardClient.tsx
- Read/write: read
- RLS: no organization_id column — shared/platform-level table, RLS status not verified this session

**`intelligence_budget_templates`** — Budget justification language templates by cost category with federal-reference citations.
- Migration: 048_grant_intelligence.sql
- Columns: id uuid NOT NULL, budget_category text NOT NULL, subcategory text, justification_template text NOT NULL, federal_reference text, example_language text, source text, embedding extensions.vector(1536), created_at timestamp with time zone
- Consumers: none found — no live consumer
- Read/write: dead/unused
- RLS: no organization_id column — shared/platform-level table, RLS status not verified this session

**`intelligence_evaluation_frameworks`** — KPI/evaluation-framework templates by program category for draft generation.
- Migration: 048_grant_intelligence.sql
- Columns: id uuid NOT NULL, category text NOT NULL, framework_name text, kpis jsonb NOT NULL, data_collection_methods jsonb, reporting_frequency text, example_text text, source text, embedding extensions.vector(1536), created_at timestamp with time zone
- Consumers: src/lib/intelligence/evaluation-library.ts
- Read/write: read
- RLS: no organization_id column — shared/platform-level table, RLS status not verified this session

**`intelligence_grant_dna_scores`** — Composite 'grant DNA' quality scoring (need statement, evidence strength, outcome specificity) for funded-proposal exemplars.
- Migration: 048_grant_intelligence.sql
- Columns: id uuid NOT NULL, proposal_id uuid, need_statement_score numeric, evidence_strength_score numeric, outcome_specificity_score numeric, evaluation_depth_score numeric, sustainability_score numeric, budget_alignment_score numeric, program_design_score numeric, reviewer_friendliness_score numeric, composite_score numeric, scoring_rationale jsonb, created_at timestamp with time zone
- Consumers: none found — no live consumer
- Read/write: dead/unused
- RLS: no organization_id column — shared/platform-level table, RLS status not verified this session

**`intelligence_grantmaker_profiles`** — Funder/foundation profile intelligence (priorities, award ranges, geographic focus) for funder matching/recommendations.
- Migration: 048_grant_intelligence.sql (extended by 060_grantmaker_profiles.sql)
- Columns: id uuid NOT NULL, funder_id uuid, ein text, priorities string[], avg_award_amount numeric, award_range_min numeric, award_range_max numeric, geographic_focus string[], typical_language text, common_keywords string[], decision_timeline text, application_tips text, source text, last_updated_at timestamp with time zone, embedding extensions.vector(1536), created_at timestamp with time zone
- Consumers: src/lib/intelligence/grantmaker-profiles.ts; src/lib/intelligence/funder-recommender.ts; scripts/build-grantmaker-profiles.ts; src/lib/intelligence/unified-search.ts
- Read/write: both
- RLS: no organization_id column — shared/platform-level table, RLS status not verified this session

**`intelligence_logic_models`** — Reusable logic-model templates (inputs/activities/outputs/outcomes/impact) by program category for program-design generation.
- Migration: 048_grant_intelligence.sql
- Columns: id uuid NOT NULL, category text NOT NULL, subcategory text, inputs jsonb NOT NULL, activities jsonb NOT NULL, outputs jsonb NOT NULL, outcomes jsonb NOT NULL, impact jsonb NOT NULL, source text, is_template boolean, embedding extensions.vector(1536), created_at timestamp with time zone
- Consumers: src/lib/intelligence/logic-model-generator.ts; src/lib/intelligence/rag-retrieval.ts; src/app/api/intelligence/logic-model/route.ts
- Read/write: both
- RLS: no organization_id column — shared/platform-level table, RLS status not verified this session

**`intelligence_narrative_patterns`** — Winning narrative structure/pattern library (win rates, frequency) intended for narrative-generation guidance.
- Migration: 048_grant_intelligence.sql
- Columns: id uuid NOT NULL, pattern_type text NOT NULL, category string[], structure jsonb NOT NULL, example_ids string[], frequency integer, win_rate numeric, description text, embedding extensions.vector(1536), created_at timestamp with time zone
- Consumers: none found — no live consumer
- Read/write: dead/unused
- RLS: no organization_id column — shared/platform-level table, RLS status not verified this session

**`intelligence_need_data`** — Statistical/need-statement evidence data (HUD/Census metrics by geography) used to substantiate need statements.
- Migration: 048_grant_intelligence.sql
- Columns: id uuid NOT NULL, source text NOT NULL, source_url text, data_type text NOT NULL, geographic_level text NOT NULL, state text, county text, city text, zip text, metric_name text NOT NULL, metric_value text NOT NULL, metric_year integer, context text, citation text NOT NULL, raw_data jsonb, embedding extensions.vector(1536), created_at timestamp with time zone, updated_at timestamp with time zone
- Consumers: scripts/ingest-hud-data.ts; scripts/ingest-census-data.ts; src/lib/intelligence/rag-retrieval.ts; src/app/api/intelligence/need-data/route.ts
- Read/write: both
- RLS: no organization_id column — shared/platform-level table, RLS status not verified this session

**`intelligence_post_award_reports`** — Post-award/outcome report exemplars (highlighted outcomes, reported metrics) for outcome-reporting guidance.
- Migration: 048_grant_intelligence.sql
- Columns: id uuid NOT NULL, source text NOT NULL, source_url text, funder_name text, grantee_name text, category string[], highlighted_outcomes text, reported_metrics jsonb, funder_language text, follow_on_funding boolean, full_text text, embedding extensions.vector(1536), created_at timestamp with time zone
- Consumers: none found — no live consumer
- Read/write: dead/unused
- RLS: no organization_id column — shared/platform-level table, RLS status not verified this session

**`intelligence_scoring_rubrics`** — Reviewer scoring rubric/dimension library by funder/program, used to rescore drafts against real reviewer criteria.
- Migration: 048_grant_intelligence.sql
- Columns: id uuid NOT NULL, source text NOT NULL, source_url text, funder_name text, grant_program text, category string[], dimensions jsonb NOT NULL, full_text text, embedding extensions.vector(1536), created_at timestamp with time zone
- Consumers: src/lib/intelligence/rag-retrieval.ts; src/lib/drafts/generator.ts; scripts/ingest-rubrics-from-opportunities.ts; scripts/ingest-reviewer-guides.ts
- Read/write: both
- RLS: no organization_id column — shared/platform-level table, RLS status not verified this session

**`knowledge_base`** — Org-level knowledge base of reusable narrative/answer content feeding draft generation, onboarding, and outreach personalization — the real live table; SCHEMA_REGISTRY_v2.md's prior 'knowledge_base_entries' entry does not exist.
- Migration: 001_initial_schema.sql
- Columns: id uuid NOT NULL, organization_id uuid NOT NULL, category public.knowledge_base_category NOT NULL, title text NOT NULL, content text NOT NULL, is_proven boolean, proven_count integer, funder_categories string[], keywords string[], version integer, created_by uuid, created_at timestamp with time zone, updated_at timestamp with time zone
- Consumers: src/app/api/onboarding/route.ts; src/lib/drafts/generator.ts; src/app/(dashboard)/knowledge-base/page.tsx; src/lib/agents/recursive-learning.ts
- Read/write: both
- RLS: org-scoped — standard `organization_id = profiles.organization_id` policy assumed (not verified against pg_policies)

**`research_cache`** — Per-org cache of fetched web-research content (by URL) with TTL/expiry, used by the research agent's web fetcher.
- Migration: 002_phases_2_5.sql
- Columns: id uuid NOT NULL, organization_id uuid NOT NULL, url text NOT NULL, content text, fetched_at timestamp with time zone, expires_at timestamp with time zone NOT NULL, status_code integer, created_at timestamp with time zone
- Consumers: src/lib/agents/research/web-fetcher.ts
- Read/write: both
- RLS: org-scoped — standard `organization_id = profiles.organization_id` policy assumed (not verified against pg_policies)

#### Platform/Admin

**`ai_usage_log`** — Per-org AI/LLM call usage log for the 4-tier admin system.
- Migration: 056_four_tier_admin_system.sql
- Columns: id uuid NOT NULL, organization_id uuid NOT NULL, model text NOT NULL, endpoint text NOT NULL, input_tokens integer, output_tokens integer, total_tokens integer, estimated_cost_cents integer, duration_ms integer, agent_type text, created_at timestamp with time zone
- Consumers: none found — no live consumer
- Read/write: dead/unused
- RLS: org-scoped — standard `organization_id = profiles.organization_id` policy assumed (not verified against pg_policies)

**`audit_logs`** — Records admin/security-relevant actions for a compliance audit trail.
- Migration: 024_audit_logs.sql (also created in 002_phases_2_5.sql)
- Columns: id uuid NOT NULL, organization_id uuid NOT NULL, user_id uuid, action public.audit_action NOT NULL, entity_type text, entity_id uuid, details jsonb, ip_address text, user_agent text, created_at timestamp with time zone
- Consumers: src/lib/audit/logger.ts; src/app/api/admin/audit-log/route.ts
- Read/write: both
- RLS: org-scoped — standard `organization_id = profiles.organization_id` policy assumed (not verified against pg_policies)

**`custom_api_connections`** — Stores org-configured custom API integration credentials/settings.
- Migration: 034_custom_connections.sql
- Columns: id uuid NOT NULL, organization_id uuid NOT NULL, name text NOT NULL, base_url text NOT NULL, auth_type text, auth_config jsonb, field_mapping jsonb, poll_schedule text, is_active boolean, last_polled_at timestamp with time zone, last_success_at timestamp with time zone, created_at timestamp with time zone, updated_at timestamp with time zone
- Consumers: src/lib/agents/custom-api.ts; src/app/api/integrations/custom-api/route.ts; src/app/api/integrations/custom-api/[id]/route.ts
- Read/write: both
- RLS: org-scoped — standard `organization_id = profiles.organization_id` policy assumed (not verified against pg_policies)

**`enrichment_jobs`** — Tracks lead/nonprofit enrichment job status and progress (queue-like).
- Migration: 058_lead_enrichment_system.sql
- Columns: id uuid NOT NULL, organization_id uuid, job_type text NOT NULL, status public.enrichment_job_status, target_table text NOT NULL, total_records integer, processed integer, enriched integer, failed integer, skipped integer, sources_used string[], config jsonb, started_at timestamp with time zone, completed_at timestamp with time zone, paused_at timestamp with time zone, last_processed_id text, error_log jsonb, results_summary jsonb, created_by uuid, created_at timestamp with time zone, updated_at timestamp with time zone
- Consumers: src/lib/enrichment/engine.ts; src/lib/enrichment/runner.ts
- Read/write: both
- RLS: org-scoped — standard `organization_id = profiles.organization_id` policy assumed (not verified against pg_policies)

**`enrichment_results`** — Stores per-job enrichment output data (contacts, signals, etc.).
- Migration: 058_lead_enrichment_system.sql
- Columns: id uuid NOT NULL, job_id uuid NOT NULL, entity_id text NOT NULL, entity_name text, entity_ein text, source public.enrichment_source NOT NULL, found_website text, found_emails string[], found_phones string[], found_officers jsonb, found_revenue numeric, found_assets numeric, found_giving numeric, found_programs string[], found_address jsonb, confidence numeric, raw_data jsonb, applied_to_db boolean, created_at timestamp with time zone
- Consumers: src/lib/enrichment/engine.ts; src/lib/intelligence/grantmaker-profiles.ts; scripts/build-grantmaker-profiles.ts
- Read/write: both
- RLS: no organization_id column — shared/platform-level table, RLS status not verified this session

**`impersonation_log`** — Audit log of platform-admin 'impersonate org/user' actions.
- Migration: 056_four_tier_admin_system.sql
- Columns: id uuid NOT NULL, admin_id uuid NOT NULL, target_org_id uuid NOT NULL, target_user_id uuid, started_at timestamp with time zone, ended_at timestamp with time zone, reason text NOT NULL, actions_taken string[]
- Consumers: none found — no live consumer
- Read/write: dead/unused
- RLS: no organization_id column — shared/platform-level table, RLS status not verified this session

**`integration_keys`** — Stores encrypted API keys for third-party integrations.
- Migration: 033_integration_keys.sql
- Columns: id uuid NOT NULL, organization_id uuid NOT NULL, service_name text NOT NULL, encrypted_key text NOT NULL, is_active boolean, last_validated_at timestamp with time zone, validation_status text, created_at timestamp with time zone, updated_at timestamp with time zone
- Consumers: src/app/api/integrations/keys/route.ts
- Read/write: both
- RLS: org-scoped — standard `organization_id = profiles.organization_id` policy assumed (not verified against pg_policies)

**`integrations`** — Stores connected integration state (Google, email, etc.) per org.
- Migration: 002_phases_2_5.sql
- Columns: id uuid NOT NULL, organization_id uuid NOT NULL, provider text NOT NULL, access_token text, refresh_token text, token_expires_at timestamp with time zone, connected_email text, scopes string[], is_active boolean, last_sync_at timestamp with time zone, settings jsonb, created_at timestamp with time zone, updated_at timestamp with time zone
- Consumers: src/lib/integrations/google/auth.ts; src/app/api/integrations/google/sync/route.ts; src/lib/agents/email-campaign.ts; src/app/api/cron/reminders/route.ts
- Read/write: both
- RLS: org-scoped — standard `organization_id = profiles.organization_id` policy assumed (not verified against pg_policies)

**`invoices`** — Stores Stripe-synced billing invoice records.
- Migration: 002_phases_2_5.sql
- Columns: id uuid NOT NULL, organization_id uuid NOT NULL, stripe_invoice_id text, amount_cents integer NOT NULL, currency text, status text NOT NULL, description text, invoice_url text, period_start timestamp with time zone, period_end timestamp with time zone, paid_at timestamp with time zone, created_at timestamp with time zone
- Consumers: src/lib/payments/stripe.ts; src/app/api/billing/route.ts
- Read/write: both
- RLS: org-scoped — standard `organization_id = profiles.organization_id` policy assumed (not verified against pg_policies)

**`nonprofits`** — Master nonprofit/BMF directory (Directive 2's 1.8M-record import target) used for donor-discovery and enrichment matching.
- Migration: 098_nonprofits_bmf.sql (enriched by 099_nonprofits_enrichment.sql)
- Columns: id uuid NOT NULL, ein text NOT NULL, name text NOT NULL, city text, state text, zip text, ntee_code text, subsection_code text, foundation_type text, ruling_date text, revenue_amount numeric, asset_amount numeric, income_amount numeric, status text, created_at timestamp with time zone, updated_at timestamp with time zone, website text, phone text, officer_name text, officer_title text, officer_email text, mission text, employee_count integer, linkedin_url text, facebook_url text, twitter_url text, instagram_url text, staff_contacts text, contact_emails text, last_enriched_at timestamp with time zone, enrichment_tier integer
- Consumers: src/lib/intelligence/foundation-matcher.ts; scripts/enrich-990-xml.ts; scripts/enrich-nonprofits-bmf-propublica.ts; scripts/ingest-nonprofit-bmf.ts
- Read/write: both
- RLS: no organization_id column — shared/platform-level table, RLS status not verified this session

**`onboarding_steps`** — Per-org onboarding wizard step tracking — superseded; app actually uses organizations.onboarding_step column instead.
- Migration: 002_phases_2_5.sql
- Columns: id uuid NOT NULL, organization_id uuid NOT NULL, step_number integer NOT NULL, step_name text NOT NULL, is_completed boolean, completed_at timestamp with time zone, step_data jsonb, created_at timestamp with time zone, updated_at timestamp with time zone
- Consumers: none found — no live consumer
- Read/write: dead/unused
- RLS: org-scoped — standard `organization_id = profiles.organization_id` policy assumed (not verified against pg_policies)

**`org_usage_summary`** — Rolled-up per-org usage summary for platform admin reporting.
- Migration: 056_four_tier_admin_system.sql
- Columns: id uuid NOT NULL, organization_id uuid NOT NULL, period_date date NOT NULL, ai_tokens_used integer, ai_cost_cents integer, drafts_generated integer, submissions_attempted integer, submissions_succeeded integer, agent_runs integer, storage_bytes_used bigint, active_users integer, created_at timestamp with time zone
- Consumers: none found — no live consumer
- Read/write: dead/unused
- RLS: org-scoped — standard `organization_id = profiles.organization_id` policy assumed (not verified against pg_policies)

**`platform_admins`** — Registry of platform-level (super-admin) users.
- Migration: 056_four_tier_admin_system.sql
- Columns: id uuid NOT NULL, user_id uuid NOT NULL, email text NOT NULL, full_name text NOT NULL, platform_role public.platform_role NOT NULL, permissions string[], is_active boolean, last_login_at timestamp with time zone, invited_by uuid, created_at timestamp with time zone, updated_at timestamp with time zone
- Consumers: src/app/api/platform/bootstrap/route.ts
- Read/write: both
- RLS: no organization_id column — shared/platform-level table, RLS status not verified this session

**`platform_tasks`** — Task queue/tracker for platform-admin operational tasks.
- Migration: 056_four_tier_admin_system.sql
- Columns: id uuid NOT NULL, title text NOT NULL, description text, assigned_to uuid, assigned_by uuid, status public.task_status, priority public.task_priority, category text, related_tenant_id uuid, related_entity_type text, related_entity_id uuid, due_date timestamp with time zone, completed_at timestamp with time zone, notes text, created_at timestamp with time zone, updated_at timestamp with time zone
- Consumers: none found — no live consumer
- Read/write: dead/unused
- RLS: no organization_id column — shared/platform-level table, RLS status not verified this session

**`programs`** — Nonprofit's program records used in narratives/budgets/onboarding.
- Migration: 001_initial_schema.sql
- Columns: id uuid NOT NULL, organization_id uuid NOT NULL, name text NOT NULL, description text, budget numeric, beneficiaries_served integer, start_date date, status text, impact_metrics jsonb, created_at timestamp with time zone, updated_at timestamp with time zone
- Consumers: src/app/api/onboarding/route.ts; src/lib/agents/budget-agent.ts; src/components/knowledge-base/ProfileEditor.tsx; worker/queue-processor.ts
- Read/write: both
- RLS: org-scoped — standard `organization_id = profiles.organization_id` policy assumed (not verified against pg_policies)

**`solicitation_registrations`** — Tracks state charitable-solicitation registration status for compliance gating in AutoApply.
- Migration: 050_funder_credentials.sql
- Columns: id uuid NOT NULL, organization_id uuid NOT NULL, state text NOT NULL, registration_number text, registered_at timestamp with time zone, expires_at timestamp with time zone, status text NOT NULL, created_at timestamp with time zone
- Consumers: src/lib/autoapply/compliance-guard.ts; src/app/(dashboard)/autoapply/compliance/page.tsx; src/components/autoapply/SubmissionPreview.tsx
- Read/write: both
- RLS: org-scoped — standard `organization_id = profiles.organization_id` policy assumed (not verified against pg_policies)

**`subscriptions`** — Stripe subscription/plan state per organization.
- Migration: 002_phases_2_5.sql
- Columns: id uuid NOT NULL, organization_id uuid NOT NULL, stripe_subscription_id text, stripe_customer_id text, tier public.subscription_tier NOT NULL, status text NOT NULL, current_period_start timestamp with time zone, current_period_end timestamp with time zone, cancel_at_period_end boolean, created_at timestamp with time zone, updated_at timestamp with time zone
- Consumers: src/lib/payments/stripe.ts; src/app/(dashboard)/admin/page.tsx; worker/autonomous-orchestrator.ts; worker/autoapply-autonomous-orchestrator.ts
- Read/write: both
- RLS: org-scoped — standard `organization_id = profiles.organization_id` policy assumed (not verified against pg_policies)

**`success_probability_scores`** — AI-computed probability-of-award score per application/opportunity (distinct from opportunity_probability_scores).
- Migration: 038_intelligence_tables.sql
- Columns: id uuid NOT NULL, organization_id uuid NOT NULL, application_id uuid, probability_score numeric, factors jsonb, calculated_at timestamp with time zone
- Consumers: src/lib/agents/success-probability.ts; src/components/applications/ApplicationDetail.tsx; src/components/applications/pipeline.ts; src/app/api/automation/queue/route.ts
- Read/write: both
- RLS: org-scoped — standard `organization_id = profiles.organization_id` policy assumed (not verified against pg_policies)

**`system_errors`** — Centralized system/error log for platform admin monitoring.
- Migration: 056_four_tier_admin_system.sql
- Columns: id uuid NOT NULL, source text NOT NULL, error_type text NOT NULL, message text NOT NULL, stack_trace text, organization_id uuid, user_id uuid, route text, request_body jsonb, severity text, is_resolved boolean, resolved_by uuid, resolved_at timestamp with time zone, resolution_notes text, occurrence_count integer, first_seen_at timestamp with time zone, last_seen_at timestamp with time zone, created_at timestamp with time zone
- Consumers: none found — no live consumer
- Read/write: dead/unused
- RLS: org-scoped — standard `organization_id = profiles.organization_id` policy assumed (not verified against pg_policies)

**`team_activity_log`** — Per-org team member activity audit trail for the admin tier.
- Migration: 056_four_tier_admin_system.sql
- Columns: id uuid NOT NULL, organization_id uuid NOT NULL, user_id uuid NOT NULL, action text NOT NULL, entity_type text, entity_id uuid, details jsonb, created_at timestamp with time zone
- Consumers: none found — no live consumer
- Read/write: dead/unused
- RLS: org-scoped — standard `organization_id = profiles.organization_id` policy assumed (not verified against pg_policies)

**`usage_metrics`** — Legacy/general per-org usage metrics used for billing enforcement.
- Migration: 002_phases_2_5.sql
- Columns: id uuid NOT NULL, organization_id uuid NOT NULL, metric_date date NOT NULL, metric_name text NOT NULL, metric_value bigint NOT NULL, created_at timestamp with time zone, updated_at timestamp with time zone
- Consumers: src/lib/billing/usage-tracker.ts
- Read/write: both
- RLS: org-scoped — standard `organization_id = profiles.organization_id` policy assumed (not verified against pg_policies)

**`usage_tracking`** — Period-bucketed resource usage counters (current billing system).
- Migration: 022_usage_tracking.sql
- Columns: id uuid NOT NULL, organization_id uuid NOT NULL, resource_type text NOT NULL, period_start date NOT NULL, period_end date NOT NULL, count integer NOT NULL, created_at timestamp with time zone NOT NULL, updated_at timestamp with time zone NOT NULL
- Consumers: src/lib/billing/usage-limiter.ts (reads directly; writes via increment_usage_tracking RPC)
- Read/write: both
- RLS: org-scoped — standard `organization_id = profiles.organization_id` policy assumed (not verified against pg_policies)

**`user_invitations`** — Pending team-member invite records (token, role, org).
- Migration: 002_phases_2_5.sql
- Columns: id uuid NOT NULL, organization_id uuid NOT NULL, email text NOT NULL, role public.user_role NOT NULL, token uuid NOT NULL, status public.invitation_status NOT NULL, invited_by uuid, accepted_by uuid, expires_at timestamp with time zone NOT NULL, created_at timestamp with time zone, updated_at timestamp with time zone
- Consumers: src/app/api/users/invite/route.ts; src/app/api/users/accept/route.ts; src/app/invite/[token]/page.tsx; src/app/(dashboard)/settings/page.tsx
- Read/write: both
- RLS: org-scoped — standard `organization_id = profiles.organization_id` policy assumed (not verified against pg_policies)

**`validations`** — Multi-agent consensus validation results for opportunities.
- Migration: 014_validations.sql
- Columns: id uuid NOT NULL, organization_id uuid NOT NULL, opportunity_id uuid NOT NULL, provider text NOT NULL, model text, verdict public.validation_verdict NOT NULL, confidence integer NOT NULL, details jsonb NOT NULL, created_by uuid, created_at timestamp with time zone NOT NULL, updated_at timestamp with time zone NOT NULL
- Consumers: src/lib/agents/consensus-validator.ts; src/components/opportunities/OpportunityDetail.tsx
- Read/write: both
- RLS: org-scoped — standard `organization_id = profiles.organization_id` policy assumed (not verified against pg_policies)

**`worker_status`** — Background worker heartbeat/health status for AutoApply ops monitoring.
- Migration: 047_worker_status.sql
- Columns: id uuid NOT NULL, worker_id text NOT NULL, status text NOT NULL, last_heartbeat_at timestamp with time zone NOT NULL, started_at timestamp with time zone NOT NULL, current_item_id uuid, items_processed integer NOT NULL, items_failed integer NOT NULL, version text, created_at timestamp with time zone NOT NULL
- Consumers: worker/heartbeat.ts; worker/index.ts; src/lib/autoapply/alerting.ts; src/components/autoapply/WorkerStatus.tsx
- Read/write: both
- RLS: no organization_id column — shared/platform-level table, RLS status not verified this session


---

## Enums (Migration 001)

```sql
CREATE TYPE user_role AS ENUM ('owner', 'admin', 'writer', 'viewer');
CREATE TYPE funder_category AS ENUM (
  'corporate_donation', 'corporate_sponsorship', 'corporate_foundation',
  'private_foundation', 'government_grant', 'local_community_grant',
  'housing_grant', 'education_grant', 'faith_compatible_grant',
  'in_kind_donation', 'materials_donation', 'down_payment_assistance'
);
CREATE TYPE pipeline_stage AS ENUM (
  'discovered', 'eligibility_review', 'qualified', 'drafting',
  'awaiting_documents', 'ready_for_review', 'submitted',
  'follow_up_due', 'awarded', 'denied', 'reporting_required',
  'renewal_opportunity'
);
CREATE TYPE outcome_result AS ENUM ('awarded', 'denied', 'partial');
CREATE TYPE document_category AS ENUM (
  'tax_documents', 'legal_documents', 'financial_documents',
  'program_documents', 'marketing_materials', 'letters_of_support',
  'application_attachments', 'photos'
);
CREATE TYPE deadline_type AS ENUM (
  'application_deadline', 'follow_up_date', 'reporting_deadline',
  'renewal_date', 'document_expiration'
);
CREATE TYPE draft_template_type AS ENUM (
  'grant_narrative', 'donation_request_letter', 'budget_narrative',
  'impact_statement', 'letter_of_inquiry', 'full_proposal'
);
CREATE TYPE contact_relationship AS ENUM ('cold', 'warm', 'active', 'champion');
CREATE TYPE opportunity_status AS ENUM ('open', 'applied', 'closed', 'expired');
CREATE TYPE knowledge_base_category AS ENUM (
  'mission', 'vision', 'need_statement', 'program_description',
  'impact', 'capacity', 'sustainability', 'partnerships',
  'budget_justification', 'organizational_history', 'custom'
);
CREATE TYPE agent_run_status AS ENUM ('pending', 'running', 'completed', 'failed');
CREATE TYPE campaign_status AS ENUM ('draft', 'active', 'paused', 'completed');
CREATE TYPE campaign_step_status AS ENUM ('pending', 'sent', 'opened', 'replied', 'bounced');
```

---

## RLS Master Policy Pattern

All org-scoped tables use:
```sql
ALTER TABLE <table> ENABLE ROW LEVEL SECURITY;
CREATE POLICY "<table>_org_isolation" ON <table>
  USING (organization_id = (
    SELECT organization_id FROM profiles WHERE id = auth.uid()
  ));
```

Shared tables (foundation_directory, corporate_prospects, intelligence_funded_proposals, pig_nodes, pig_edges, disaster_declarations) use read-only RLS or are service-role only.

---

## Tables — Core Tenant (Migrations 001-030)

### 1. organizations
Primary tenant entity. All other org-scoped tables reference this.

| Column | Type | Notes |
|---|---|---|
| id | uuid PK | gen_random_uuid() |
| name | text NOT NULL | Legal name |
| dba | text | Doing business as |
| ein | text | EIN |
| tax_status | text | e.g. 501(c)(3), 508(c)(1)(a) |
| mission_statement | text | |
| vision_statement | text | |
| founding_date | date | |
| founder_name | text | |
| founder_bio | text | |
| service_area | text | Geographic coverage |
| service_areas | text[] | Array of service areas |
| target_population | text | |
| annual_budget | numeric(12,2) | |
| total_staff | integer DEFAULT 0 | |
| total_volunteers | integer DEFAULT 0 | |
| website | text | |
| phone | text | |
| email | text | |
| address_line1 | text | |
| address_line2 | text | |
| city | text | |
| state | text | |
| zip | text | |
| logo_url | text | Supabase Storage path |
| stripe_customer_id | text | |
| stripe_subscription_id | text | |
| stripe_subscription_status | text | |
| subscription_tier | text DEFAULT 'free' | starter/professional/enterprise |
| onboarding_completed | boolean DEFAULT false | Controls middleware gate |
| analytics | jsonb DEFAULT '{}' | Aggregated computed metrics (win rate, pipeline value, agent activity) for dashboards |
| created_at | timestamptz DEFAULT now() | |
| updated_at | timestamptz DEFAULT now() | |

**Indexes:** idx_organizations_ein ON (ein)

### 2. profiles
User profiles linked to Supabase Auth.

| Column | Type | Notes |
|---|---|---|
| id | uuid PK | REFERENCES auth.users(id) ON DELETE CASCADE |
| organization_id | uuid NOT NULL | FK → organizations(id) |
| email | text NOT NULL | |
| full_name | text | |
| role | user_role NOT NULL DEFAULT 'viewer' | |
| avatar_url | text | |
| last_login_at | timestamptz | |
| created_at | timestamptz DEFAULT now() | |
| updated_at | timestamptz DEFAULT now() | |

**Indexes:** idx_profiles_org ON (organization_id), idx_profiles_email ON (email)

### 3. funders
Corporations, foundations, and agencies tracked per org.

| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| organization_id | uuid NOT NULL | FK → organizations(id) |
| name | text NOT NULL | |
| category | funder_category NOT NULL | |
| description | text | |
| website | text | |
| giving_portal_url | text | |
| portal_login_status | text | has_account/needs_account/no_portal |
| annual_giving_budget | numeric(12,2) | |
| geographic_focus | text | |
| preferred_application_method | text | |
| has_giving_page | boolean DEFAULT true | |
| notes | text | |
| last_contacted_at | timestamptz | |
| relationship_score | numeric | 0-100, from relationship scorer |
| relationship_momentum | text | rising/stable/declining |
| created_at | timestamptz DEFAULT now() | |
| updated_at | timestamptz DEFAULT now() | |

**Indexes:** idx_funders_org, idx_funders_category, idx_funders_name

### 4. contacts
People at funder organizations.

| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| organization_id | uuid NOT NULL | |
| funder_id | uuid NOT NULL | FK → funders(id) ON DELETE CASCADE |
| name | text NOT NULL | |
| title | text | |
| email | text | |
| phone | text | |
| preferred_contact_method | text | |
| relationship | contact_relationship DEFAULT 'cold' | |
| last_contacted_at | timestamptz | |
| notes | text | |
| created_at | timestamptz DEFAULT now() | |
| updated_at | timestamptz DEFAULT now() | |

### 5. opportunities
Grants, donation programs, sponsorships.

| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| organization_id | uuid NOT NULL | |
| funder_id | uuid | FK → funders(id) ON DELETE SET NULL |
| name | text NOT NULL | |
| category | funder_category NOT NULL | |
| description | text | |
| amount_available | numeric(12,2) | |
| amount_min | numeric(12,2) | |
| amount_max | numeric(12,2) | |
| deadline | timestamptz | |
| url | text | |
| eligibility_requirements | text | |
| required_documents | text[] | |
| application_method | text | |
| recurrence | text | one_time/annual/quarterly/rolling |
| geographic_restrictions | text | |
| eligibility_score | integer CHECK (0-100) | Set by Eligibility Agent |
| probability_score | integer CHECK (0-100) | Set by Probability Engine |
| probability_confidence | text | high/medium/low |
| probability_recommendation | text | apply/consider/skip |
| recommendation | text | apply/skip/review |
| recommendation_reasoning | text | |
| status | opportunity_status DEFAULT 'open' | |
| source | text | manual/agent/discovery |
| external_id | text | For dedup from external sources |
| discovered_at | timestamptz DEFAULT now() | |
| created_at | timestamptz DEFAULT now() | |
| updated_at | timestamptz DEFAULT now() | |

**Indexes:** idx_opportunities_org, idx_opportunities_funder, idx_opportunities_category, idx_opportunities_deadline, idx_opportunities_status, idx_opportunities_probability ON (probability_score DESC)

### 6. opportunity_keywords
Tags on opportunities.

| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| opportunity_id | uuid NOT NULL | FK → opportunities(id) ON DELETE CASCADE |
| keyword | text NOT NULL | |

### 7. applications
Grant applications in the 12-stage pipeline.

| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| organization_id | uuid NOT NULL | |
| opportunity_id | uuid | FK → opportunities(id) ON DELETE SET NULL |
| funder_id | uuid | FK → funders(id) ON DELETE SET NULL |
| stage | pipeline_stage DEFAULT 'discovered' | |
| requested_amount | numeric(12,2) | |
| draft_content | text | Current draft narrative |
| draft_confidence_score | integer | AI confidence 0-100 |
| notes | text | |
| submitted_at | timestamptz | |
| portal_submission_url | text | |
| cloned_from_id | uuid | FK → applications(id) — source if cloned |
| auto_generated | boolean DEFAULT false | True if created autonomously by the agent pipeline without user action |
| pending_review | boolean DEFAULT false | Awaiting human approval before the pipeline proceeds (autonomous mode) |
| draft_source | text | manual/ai_generated/cloned |
| budget_data | jsonb DEFAULT '{}' | Structured budget snapshot for quick reads (grant_budgets remains source of truth) |
| compliance_check_result | jsonb DEFAULT '{}' | Compliance Pre-Check agent output |
| fit_analysis | jsonb DEFAULT '{}' | Fit Analysis Agent (AG-04) output |
| created_at | timestamptz DEFAULT now() | |
| updated_at | timestamptz DEFAULT now() | |

**Indexes:** idx_applications_org, idx_applications_stage, idx_applications_funder

### 8. application_stage_history
Audit trail of stage transitions.

| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| application_id | uuid NOT NULL | FK → applications(id) ON DELETE CASCADE |
| from_stage | pipeline_stage | |
| to_stage | pipeline_stage NOT NULL | |
| changed_by | uuid | FK → profiles(id) |
| notes | text | |
| created_at | timestamptz DEFAULT now() | |

### 9. documents
File repository per organization.

| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| organization_id | uuid NOT NULL | |
| name | text NOT NULL | |
| category | document_category NOT NULL | |
| storage_path | text NOT NULL | Supabase Storage path |
| file_size | integer | Bytes |
| mime_type | text | |
| expiration_date | date | |
| is_expired | boolean DEFAULT false | |
| uploaded_by | uuid | FK → profiles(id) |
| created_at | timestamptz DEFAULT now() | |
| updated_at | timestamptz DEFAULT now() | |

### 10. application_documents
Junction: documents attached to applications.

| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| application_id | uuid NOT NULL | FK → applications(id) ON DELETE CASCADE |
| document_id | uuid NOT NULL | FK → documents(id) ON DELETE CASCADE |
| created_at | timestamptz DEFAULT now() | |

### 11. knowledge_base_entries
Reusable narrative blocks and standard answers.

| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| organization_id | uuid NOT NULL | |
| title | text NOT NULL | |
| content | text NOT NULL | |
| category | knowledge_base_category NOT NULL | |
| is_proven | boolean DEFAULT false | Set by learning agent |
| proven_count | integer DEFAULT 0 | Times used in awarded applications |
| funder_types | funder_category[] | Which funder types this works for |
| created_by | uuid | FK → profiles(id) |
| created_at | timestamptz DEFAULT now() | |
| updated_at | timestamptz DEFAULT now() | |

### 12. drafts
AI-generated draft versions per application.

| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| application_id | uuid NOT NULL | FK → applications(id) ON DELETE CASCADE |
| organization_id | uuid NOT NULL | |
| template_type | draft_template_type NOT NULL | |
| content | text NOT NULL | Generated text |
| confidence_score | integer | 0-100 |
| kb_entries_used | uuid[] | Knowledge base entries referenced |
| model_used | text | claude-sonnet-4-6 |
| tokens_used | integer | |
| version | integer DEFAULT 1 | Increments on regeneration |
| created_at | timestamptz DEFAULT now() | |

### 13. outcomes
Recorded results per application.

| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| organization_id | uuid NOT NULL | |
| application_id | uuid NOT NULL | FK → applications(id) |
| result | outcome_result NOT NULL | awarded/denied/partial |
| awarded_amount | numeric(12,2) | If awarded or partial |
| requested_amount | numeric(12,2) | Snapshot at time of outcome |
| funder_category | funder_category | Snapshot for analytics |
| opportunity_category | text | |
| denial_reason | text | |
| funder_feedback | text | |
| recorded_at | timestamptz DEFAULT now() | |
| created_at | timestamptz DEFAULT now() | |

### 14. alerts
In-app notification system.

| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| organization_id | uuid NOT NULL | |
| user_id | uuid | FK → profiles(id), null = all org users |
| title | text NOT NULL | |
| message | text | |
| alert_type | text | deadline/opportunity/system/agent/reputation |
| severity | text DEFAULT 'info' | info/warning/error/success |
| entity_type | text | What triggered this |
| entity_id | uuid | FK to triggering entity |
| is_read | boolean DEFAULT false | |
| read_at | timestamptz | |
| created_at | timestamptz DEFAULT now() | |

**Indexes:** idx_alerts_org ON (organization_id, is_read)

### 15. deadlines
All time-sensitive items.

| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| organization_id | uuid NOT NULL | |
| application_id | uuid | FK → applications(id) |
| opportunity_id | uuid | FK → opportunities(id) |
| deadline_type | deadline_type NOT NULL | |
| due_date | date NOT NULL | |
| title | text NOT NULL | |
| description | text | |
| is_completed | boolean DEFAULT false | |
| completed_at | timestamptz | |
| reminder_30d_sent | boolean DEFAULT false | |
| reminder_14d_sent | boolean DEFAULT false | |
| reminder_7d_sent | boolean DEFAULT false | |
| reminder_3d_sent | boolean DEFAULT false | |
| reminder_1d_sent | boolean DEFAULT false | |
| created_at | timestamptz DEFAULT now() | |
| updated_at | timestamptz DEFAULT now() | |

### 16. notes
Polymorphic notes (funder, opportunity, or application).

| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| organization_id | uuid NOT NULL | |
| funder_id | uuid | FK → funders(id) ON DELETE CASCADE |
| opportunity_id | uuid | FK → opportunities(id) ON DELETE CASCADE |
| application_id | uuid | FK → applications(id) ON DELETE CASCADE |
| content | text NOT NULL | |
| author_id | uuid | FK → profiles(id) |
| created_at | timestamptz DEFAULT now() | |
| updated_at | timestamptz DEFAULT now() | |

**Constraint:** Exactly one of funder_id, opportunity_id, application_id must be non-null.

### 17. search_profiles
Saved keyword configurations.

| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| organization_id | uuid NOT NULL | |
| name | text NOT NULL | |
| keywords | text[] NOT NULL | |
| categories | funder_category[] | |
| geographic_scope | text | |
| min_amount | numeric(12,2) | |
| max_amount | numeric(12,2) | |
| recurrence_preference | text | |
| is_active | boolean DEFAULT true | |
| last_run_at | timestamptz | |
| results_count | integer DEFAULT 0 | |
| created_at | timestamptz DEFAULT now() | |
| updated_at | timestamptz DEFAULT now() | |

### 18. outreach_contacts
Extracted contacts for cold outreach.

| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| organization_id | uuid NOT NULL | |
| company_name | text NOT NULL | |
| contact_name | text | |
| email | text | |
| phone | text | |
| contact_form_url | text | |
| source_url | text | |
| company_type | text | |
| giving_likelihood | text | high/medium/low |
| campaign_id | uuid | FK → email_campaigns(id) |
| status | text DEFAULT 'new' | |
| converted_to_funder_id | uuid | FK → funders(id) |
| created_at | timestamptz DEFAULT now() | |
| updated_at | timestamptz DEFAULT now() | |

### 19. email_campaigns
Drip campaign definitions.

| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| organization_id | uuid NOT NULL | |
| name | text NOT NULL | |
| status | campaign_status DEFAULT 'draft' | |
| total_steps | integer DEFAULT 0 | |
| total_contacts | integer DEFAULT 0 | |
| created_by | uuid | FK → profiles(id) |
| created_at | timestamptz DEFAULT now() | |
| updated_at | timestamptz DEFAULT now() | |

### 20. campaign_steps
Individual emails in drip sequence.

| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| campaign_id | uuid NOT NULL | FK → email_campaigns(id) ON DELETE CASCADE |
| step_number | integer NOT NULL | |
| subject_template | text NOT NULL | |
| body_template | text NOT NULL | |
| delay_days | integer NOT NULL DEFAULT 0 | |
| created_at | timestamptz DEFAULT now() | |

### 21. campaign_sends
Individual email send tracking.

| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| campaign_step_id | uuid NOT NULL | FK → campaign_steps(id) |
| outreach_contact_id | uuid NOT NULL | FK → outreach_contacts(id) |
| status | campaign_step_status DEFAULT 'pending' | |
| sent_at | timestamptz | |
| opened_at | timestamptz | |
| replied_at | timestamptz | |
| created_at | timestamptz DEFAULT now() | |

### 22. agent_runs
All agent execution logs.

| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| organization_id | uuid NOT NULL | |
| agent_type | text NOT NULL | Extended beyond original enum |
| status | agent_run_status DEFAULT 'pending' | |
| input_params | jsonb | |
| output_summary | text | |
| items_found | integer DEFAULT 0 | |
| items_processed | integer DEFAULT 0 | |
| error_message | text | |
| tokens_used | integer | |
| duration_ms | integer | |
| triggered_by | uuid | FK → profiles(id), null if automated |
| trigger_source | text | manual/scheduled/chain/event |
| next_action | text | Description of the follow-on agent/action this run queued, if any |
| confidence_score | integer | 0-100, autonomous decision confidence for this run |
| items_queued | integer DEFAULT 0 | Count of agent_queue rows this run enqueued |
| chained_from_run_id | uuid | FK → agent_runs(id) — parent run if this run was chain-triggered |
| started_at | timestamptz | |
| completed_at | timestamptz | |
| created_at | timestamptz DEFAULT now() | |

**Indexes:** idx_agent_runs_org, idx_agent_runs_type, idx_agent_runs_status

### 23. platform_config
Feature flags per org.

| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| organization_id | uuid NOT NULL | |
| key | text NOT NULL | |
| value | text NOT NULL | |
| created_at | timestamptz DEFAULT now() | |
| updated_at | timestamptz DEFAULT now() | |

**Unique:** (organization_id, key)

---

## Tables — Shared Intelligence (Migrations 031-060)

### 24. foundation_directory
133,812+ foundation records. Shared across all orgs.

| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| ein | text UNIQUE | IRS Employer ID |
| name | text NOT NULL | |
| city | text | |
| state | text | |
| zip | text | |
| ntee_code | text | National Taxonomy of Exempt Entities |
| subsection_code | text | IRS subsection |
| foundation_type | text | |
| ruling_date | text | IRS ruling date |
| asset_amount | numeric | From IRS data |
| income_amount | numeric | |
| revenue_amount | numeric | |
| website_url | text | |
| enrichment | jsonb DEFAULT '{}' | All enrichment fields |
| enrichment_version | integer DEFAULT 0 | |
| enrichment_completed_at | timestamptz | |
| created_at | timestamptz DEFAULT now() | |
| updated_at | timestamptz DEFAULT now() | |

**Indexes:** idx_foundation_directory_ein, idx_foundation_directory_state, idx_foundation_directory_ntee, idx_foundation_directory_enrichment (GIN)

### 25. foundation_profiles
Computed analytical profiles per foundation.

| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| foundation_id | uuid UNIQUE | FK → foundation_directory(id) ON DELETE CASCADE |
| avg_grant_size | numeric | |
| geographic_focus | text[] | |
| funding_categories | text[] | |
| total_grants_made | numeric | |
| top_recipients | jsonb | |
| computed_at | timestamptz DEFAULT now() | |

### 26. intelligence_funded_proposals
Corpus of funded grant proposals for the Knowledge Engine.

| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| title | text NOT NULL | |
| abstract | text | |
| funder_name | text | |
| agency | text | |
| award_amount | numeric | |
| fiscal_year | integer | |
| organization | text | Recipient org name |
| source | text NOT NULL | NIH_NIAID/NIH_REPORTER/NSF_AWARDS/etc |
| source_url | text UNIQUE | For dedup |
| narrative_sections | jsonb DEFAULT '{}' | Parsed narrative components |
| embedding | vector(1536) | pgvector — populated by indexer agent |
| created_at | timestamptz DEFAULT now() | |

**Indexes:** idx_proposals_source, idx_proposals_funder, idx_proposals_embedding (ivfflat)

**Dedup rule:** WHERE NOT EXISTS on source_url before every insert.

### 27. intelligence_proposal_sections
Parsed sections from funded proposals.

| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| proposal_id | uuid NOT NULL | FK → intelligence_funded_proposals(id) ON DELETE CASCADE |
| section_type | text NOT NULL | need_statement/narrative/budget/evaluation/etc |
| content | text NOT NULL | |
| word_count | integer | |
| created_at | timestamptz DEFAULT now() | |

**Unique:** (proposal_id, section_type)

### 28. knowledge_patterns
Aggregated funding success patterns.

| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| pattern_type | text NOT NULL | narrative/budget/timing/competitive/funder |
| category | text | funder category or NTEE |
| funder_name | text | Specific funder if applicable |
| pattern_description | text NOT NULL | |
| success_rate | numeric | 0-1 |
| sample_count | integer | Records this is based on |
| confidence | text DEFAULT 'low' | low/medium/high |
| created_at | timestamptz DEFAULT now() | |
| updated_at | timestamptz DEFAULT now() | |

### 29. knowledge_queries
Log of all Knowledge Engine queries.

| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| org_id | uuid NOT NULL | |
| query_text | text NOT NULL | |
| results | jsonb | |
| created_at | timestamptz DEFAULT now() | |

---

## Tables — AutoApply (Migrations 040-055)

### 30. submission_queue
AutoApply job queue.

| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| organization_id | uuid NOT NULL | |
| application_id | uuid | FK → applications(id) |
| funder_name | text | |
| portal_url | text | |
| status | text DEFAULT 'queued' | queued/processing/completed/failed/needs_review |
| session_id | text | Playwright session ID |
| screenshot_url | text | Confirmation screenshot |
| error_message | text | |
| requires_human_approval | boolean DEFAULT false | |
| approved_by | uuid | FK → profiles(id) |
| approved_at | timestamptz | |
| submitted_at | timestamptz | |
| created_at | timestamptz DEFAULT now() | |
| updated_at | timestamptz DEFAULT now() | |

### 31. form_analyses
Cached form analysis results from AutoApply.

| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| portal_url | text UNIQUE | |
| form_fields | jsonb | Detected fields and types |
| requires_captcha | boolean DEFAULT false | |
| captcha_type | text | |
| analyzed_at | timestamptz DEFAULT now() | |

---

## Tables — Donor Discovery (Migrations 056-075)

### 32. donor_discovery_taxonomy
NAICS taxonomy for business classification.

| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| naics_code | text UNIQUE NOT NULL | |
| title | text NOT NULL | Official NAICS title |
| friendly_name | text | Consumer-friendly plain English name |
| category | text | Sector grouping |
| level | integer | 2=sector, 3=subsector, 4=group, 5=industry, 6=national |
| parent_code | text | |
| created_at | timestamptz DEFAULT now() | |

### 33. donor_discovery_directory
Corporate prospect records discovered via Donor Discovery.

| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| org_id | uuid NOT NULL | Discovering org (tenant-scoped) |
| name | text NOT NULL | |
| naics_code | text | |
| address | text | |
| city | text | |
| state | text | |
| zip | text | |
| latitude | numeric | |
| longitude | numeric | |
| phone | text | |
| website | text | |
| google_place_id | text | |
| rating | numeric | Google rating |
| enrichment | jsonb DEFAULT '{}' | All enrichment data |
| scores | jsonb DEFAULT '{}' | All propensity scores |
| enrichment_completed_at | timestamptz | |
| created_at | timestamptz DEFAULT now() | |
| updated_at | timestamptz DEFAULT now() | |

### 34. donor_discovery_requests
Discovery run requests per org.

| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| org_id | uuid NOT NULL | |
| naics_code | text | |
| radius_miles | integer | |
| keywords | text[] | |
| status | text DEFAULT 'pending' | |
| prospects_found | integer DEFAULT 0 | |
| created_at | timestamptz DEFAULT now() | |
| updated_at | timestamptz DEFAULT now() | |

### 35. donor_discovery_aliases
Alternative name mappings for NAICS codes.

| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| naics_code | text NOT NULL | |
| alias | text NOT NULL | Plain English synonym |
| created_at | timestamptz DEFAULT now() | |

---

## Tables — Corporate Intelligence Engine (Migrations 076-085)

### 36. corporate_prospects
Master corporate intelligence table. Shared across all orgs. Tens of millions of records at scale.

| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| legal_name | text NOT NULL | |
| dba_name | text | |
| ein | text | |
| duns_number | text | |
| website | text | |
| phone | text | |
| email | text | |
| address_street | text | |
| address_city | text | |
| address_state | text | |
| address_zip | text | |
| address_lat | numeric | |
| address_lng | numeric | |
| naics_code | text | |
| naics_description | text | |
| sic_code | text | |
| industry_category | text | |
| employee_count_estimate | text | 1-10/11-50/51-200/201-500/500+ |
| revenue_estimate | text | <1M/1M-10M/10M-50M/50M+ |
| location_count | integer | |
| geographic_footprint | text[] | States of operation |
| ownership_type | text | public/private/nonprofit/government |
| is_family_owned | boolean | |
| is_veteran_owned | boolean | |
| is_minority_owned | boolean | |
| is_woman_owned | boolean | |
| parent_company_id | uuid | FK → corporate_prospects(id) |
| source_adapters | text[] | Which sources found this record |
| first_seen_at | timestamptz DEFAULT now() | |
| last_verified_at | timestamptz | |
| enrichment | jsonb DEFAULT '{}' | All 40+ enrichment fields from 10 agents |
| enrichment_version | integer DEFAULT 0 | |
| enrichment_started_at | timestamptz | |
| enrichment_completed_at | timestamptz | |
| scores | jsonb DEFAULT '{}' | PS-01 through PS-10 propensity scores |
| scores_computed_at | timestamptz | |
| giving_dna | jsonb DEFAULT '{}' | Corporate Giving DNA profile |
| created_at | timestamptz DEFAULT now() | |
| updated_at | timestamptz DEFAULT now() | |

**Unique:** (legal_name, address_city, address_state)
**Indexes:** idx_corporate_prospects_naics, idx_corporate_prospects_state, idx_corporate_prospects_scores (GIN), idx_corporate_prospects_enrichment (GIN)

### 37. corporate_relationships
Relationship edges between corporate entities.

| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| source_company_id | uuid | FK → corporate_prospects(id) |
| target_company_id | uuid | FK → corporate_prospects(id) |
| relationship_type | text NOT NULL | parent/subsidiary/supplier/board_overlap/foundation |
| confidence | numeric DEFAULT 0.5 | 0-1 |
| evidence | text | |
| discovered_at | timestamptz DEFAULT now() | |

**Unique:** (source_company_id, target_company_id, relationship_type)

### 38. corporate_relationship_people
People linked to multiple companies.

| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| company_id | uuid | FK → corporate_prospects(id) |
| person_name | text NOT NULL | |
| person_title | text | |
| board_memberships | text[] | |
| foundation_roles | text[] | |
| linkedin_url | text | |
| discovered_at | timestamptz DEFAULT now() | |

### 39. corporate_enrichment_queue
Job queue for enrichment agents.

| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| prospect_id | uuid NOT NULL | FK → corporate_prospects(id) |
| agent_id | text NOT NULL | EA-01 through EA-10 |
| status | text DEFAULT 'pending' | |
| attempts | integer DEFAULT 0 | |
| error | text | |
| created_at | timestamptz DEFAULT now() | |
| processed_at | timestamptz | |

### 40. corporate_monitoring_events
Change detection log.

| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| prospect_id | uuid NOT NULL | FK → corporate_prospects(id) |
| event_type | text NOT NULL | exec_change/acquisition/new_location/press_release/donation |
| description | text | |
| change_detected | jsonb DEFAULT '{}' | Before/after comparison |
| created_at | timestamptz DEFAULT now() | |

---

## Tables — Financial Reconciliation (Migration 085-087)

### 41. grant_budgets
Budget per application.

| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| application_id | uuid NOT NULL | |
| org_id | uuid NOT NULL | |
| line_items | jsonb NOT NULL DEFAULT '[]' | [{category, description, amount, justification}] |
| total_requested | numeric DEFAULT 0 | |
| total_approved | numeric | Set after award |
| created_at | timestamptz DEFAULT now() | |
| updated_at | timestamptz DEFAULT now() | |

### 42. grant_expenses
Actual expenses against awarded grants.

| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| application_id | uuid NOT NULL | |
| org_id | uuid NOT NULL | |
| category | text NOT NULL | |
| description | text NOT NULL | |
| amount | numeric NOT NULL | |
| expense_date | date | |
| receipt_url | text | Supabase Storage path |
| created_at | timestamptz DEFAULT now() | |

### 43. grant_reconciliation_reports
Computed budget vs actual reports.

| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| application_id | uuid NOT NULL | |
| org_id | uuid NOT NULL | |
| total_budget | numeric | |
| total_spent | numeric | |
| variance | numeric | budget - spent (positive = under budget) |
| compliance_status | text | compliant/over_budget/under_spent |
| generated_at | timestamptz DEFAULT now() | |

---

## Tables — Compliance + White-Label (Migrations 087-090)

### 44. compliance_events
Compliance calendar items.

| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| org_id | uuid NOT NULL | |
| application_id | uuid | |
| event_type | text NOT NULL | Report/Audit/Renewal/Meeting/Filing |
| title | text NOT NULL | |
| due_date | date NOT NULL | |
| recurrence | text | monthly/quarterly/annual |
| completed_at | timestamptz | |
| notes | text | |
| created_at | timestamptz DEFAULT now() | |

**Indexes:** idx_compliance_events_org_due ON (org_id, due_date)

### 45. consultant_client_access
White-label consultant org access.

| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| consultant_org_id | uuid NOT NULL | FK → organizations(id) |
| client_org_id | uuid NOT NULL | FK → organizations(id) |
| access_level | text DEFAULT 'read' | read/write/admin |
| granted_at | timestamptz DEFAULT now() | |
| active | boolean DEFAULT true | |

**Unique:** (consultant_org_id, client_org_id)

### 46. notification_preferences
Per-user notification settings.

| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| user_id | uuid NOT NULL | |
| org_id | uuid NOT NULL | |
| event_type | text NOT NULL | |
| in_app | boolean DEFAULT true | |
| email | boolean DEFAULT false | |

**Unique:** (user_id, org_id, event_type)

### 47. funder_relationship_events
Events in funder relationship history.

| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| org_id | uuid NOT NULL | |
| funder_id | uuid NOT NULL | |
| event_type | text NOT NULL CHECK IN ('award','application','response','outreach','meeting','rejection') | |
| event_date | timestamptz DEFAULT now() | |
| notes | text | |

### 48. funder_relationship_scores
Computed relationship scores per org-funder pair.

| Column | Type | Notes |
|---|---|---|
| funder_id | uuid NOT NULL | |
| org_id | uuid NOT NULL | |
| score | numeric DEFAULT 0 | 0-100 |
| momentum | text DEFAULT 'stable' | rising/stable/declining |
| computed_at | timestamptz DEFAULT now() | |

**Primary Key:** (funder_id, org_id)

---

## Tables — Platform Vision Phase 1 (Migrations 091-097)

### 49. organizational_digital_twins
AI model of each nonprofit org.

| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| org_id | uuid NOT NULL UNIQUE | |
| mission | text | |
| vision | text | |
| service_areas | text[] | |
| programs | jsonb DEFAULT '[]' | [{name, description, population, outcomes}] |
| financial_profile | jsonb DEFAULT '{}' | Budget, revenue sources, expenses |
| board_composition | jsonb DEFAULT '[]' | Board member records |
| proven_narrative_patterns | text[] | From successful grants |
| key_strengths | text[] | |
| known_weaknesses | text[] | |
| twin_completeness_score | integer DEFAULT 0 | 0-100 |
| last_rebuilt_at | timestamptz | |
| created_at | timestamptz DEFAULT now() | |
| updated_at | timestamptz DEFAULT now() | |

### 50. opportunity_probability_scores
Grant probability scores per org-opportunity pair.

| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| opportunity_id | uuid NOT NULL | |
| org_id | uuid NOT NULL | |
| overall_score | integer DEFAULT 0 | 0-100 |
| confidence | text DEFAULT 'low' | high/medium/low |
| factors | jsonb DEFAULT '[]' | [{name, weight, value, contribution}] |
| recommendation | text DEFAULT 'consider' | apply/consider/skip |
| key_risks | text[] | |
| key_strengths | text[] | |
| estimated_roi | text | |
| time_to_complete | text | |
| computed_at | timestamptz DEFAULT now() | |

**Unique:** (opportunity_id, org_id)

### 51. agent_registry
Master catalog of all available agents.

| Column | Type | Notes |
|---|---|---|
| agent_id | text PK | ag-01 through ag-30 |
| name | text NOT NULL | |
| description | text NOT NULL | |
| version | text DEFAULT '1.0' | |
| plan_requirement | text NOT NULL | starter/professional/enterprise |
| trigger_type | text NOT NULL | manual/scheduled/event |
| schedule_cron | text | Cron expression if scheduled |
| avg_runtime_seconds | integer | |
| active | boolean DEFAULT true | |
| created_at | timestamptz DEFAULT now() | |

### 52. agent_configurations
Per-org agent enable/disable and config.

| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| org_id | uuid NOT NULL | |
| agent_id | text NOT NULL | FK → agent_registry(agent_id) |
| enabled | boolean DEFAULT false | |
| config | jsonb DEFAULT '{}' | Agent-specific parameters |
| last_run_at | timestamptz | |
| run_count | integer DEFAULT 0 | |
| total_tokens_consumed | integer DEFAULT 0 | |
| created_at | timestamptz DEFAULT now() | |

**Unique:** (org_id, agent_id)

### 53. discovery_runs
Opportunity discovery run logs.

| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| run_date | date NOT NULL | |
| opportunities_found | integer DEFAULT 0 | |
| opportunities_matched | integer DEFAULT 0 | |
| sources_checked | text[] | |
| runtime_seconds | integer | |
| created_at | timestamptz DEFAULT now() | |

### 54. discovery_matches
Per-org discovered opportunity matches.

| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| org_id | uuid NOT NULL | |
| opportunity_id | uuid | FK → opportunities(id) if imported |
| external_title | text | If not yet imported |
| external_source | text | |
| external_url | text | |
| discovery_run_id | uuid | FK → discovery_runs(id) |
| match_score | numeric | 0-1 |
| match_reasons | text[] | |
| status | text DEFAULT 'pending' | pending/added/dismissed |
| actioned_at | timestamptz | |
| created_at | timestamptz DEFAULT now() | |

**Indexes:** idx_discovery_matches_org ON (org_id, status)

### 55. reputation_signals
Reputation events for any entity.

| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| entity_id | uuid NOT NULL | FK to any entity |
| entity_type | text NOT NULL | funder/corporate/foundation |
| signal_type | text NOT NULL | legal/leadership/financial/press/positive |
| severity | text NOT NULL DEFAULT 'yellow' | critical/high/medium/low/positive |
| headline | text NOT NULL | Max 100 chars |
| summary | text | Max 200 chars |
| source_url | text | |
| signal_date | date | |
| verified | boolean DEFAULT false | |
| created_at | timestamptz DEFAULT now() | |

### 56. reputation_alerts
Per-org reputation alert feed.

| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| org_id | uuid NOT NULL | |
| signal_id | uuid | FK → reputation_signals(id) |
| status | text DEFAULT 'unread' | unread/read/dismissed |
| created_at | timestamptz DEFAULT now() | |

**Indexes:** idx_reputation_alerts_org ON (org_id, status)

### 57. relationship_memory
Funder relationship event memory.

| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| org_id | uuid NOT NULL | |
| entity_id | uuid NOT NULL | |
| entity_type | text NOT NULL DEFAULT 'funder' | |
| memory_type | text NOT NULL | email/call/press/linkedin/990/meeting |
| content | text NOT NULL | |
| signal_date | date | |
| actioned | boolean DEFAULT false | |
| created_at | timestamptz DEFAULT now() | |

**Indexes:** idx_rel_memory_org ON (org_id, entity_id)

### 58. relationship_recommendations
AI-generated engagement recommendations.

| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| org_id | uuid NOT NULL | |
| entity_id | uuid NOT NULL | |
| entity_type | text NOT NULL DEFAULT 'funder' | |
| recommendation_text | text NOT NULL | |
| urgency | text DEFAULT 'normal' | urgent/normal/low |
| status | text DEFAULT 'pending' | pending/actioned/dismissed |
| created_at | timestamptz DEFAULT now() | |

### 59. pig_nodes
Philanthropic Intelligence Graph — entity nodes.

| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| node_type | text NOT NULL | business/foundation/government/person/nonprofit |
| entity_id | uuid NOT NULL | FK to source table |
| entity_table | text NOT NULL | Which table entity_id references |
| label | text NOT NULL | Display name |
| metadata | jsonb DEFAULT '{}' | |
| created_at | timestamptz DEFAULT now() | |
| updated_at | timestamptz DEFAULT now() | |

**Unique:** (entity_table, entity_id)
**Indexes:** idx_pig_nodes_entity ON (entity_table, entity_id)

### 60. pig_edges
Philanthropic Intelligence Graph — relationship edges.

| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| source_node_id | uuid | FK → pig_nodes(id) ON DELETE CASCADE |
| target_node_id | uuid | FK → pig_nodes(id) ON DELETE CASCADE |
| relationship_type | text NOT NULL | previously_donated_to/serves_on_board/shares_executives/etc |
| weight | numeric DEFAULT 1.0 | Relationship strength |
| evidence | text | |
| verified | boolean DEFAULT false | |
| metadata | jsonb DEFAULT '{}' | |
| discovered_at | timestamptz DEFAULT now() | |

**Unique:** (source_node_id, target_node_id, relationship_type)
**Indexes:** idx_pig_edges_source, idx_pig_edges_target, idx_pig_edges_type

### 61. disaster_declarations
FEMA disaster declaration tracking.

| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| fema_disaster_number | text UNIQUE | |
| disaster_type | text | |
| incident_type | text | |
| affected_states | text[] | |
| declaration_date | date | |
| incident_begin_date | date | |
| response_deployed | boolean DEFAULT false | |
| response_deployed_at | timestamptz | |
| created_at | timestamptz DEFAULT now() | |

**Indexes:** idx_disaster_decl_states USING GIN ON (affected_states)

### 62. disaster_emergency_funds
Standing database of emergency funding sources.

| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| name | text NOT NULL | |
| funder | text NOT NULL | |
| program_type | text | |
| typical_amount | text | |
| application_url | text | |
| notes | text | |
| disaster_types | text[] | Which disaster types this applies to |
| active | boolean DEFAULT true | |

### 63. funding_forecasts
90-day and 12-month funding projections.

| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| org_id | uuid NOT NULL | |
| forecast_date | date NOT NULL | |
| forecast_period | text NOT NULL | 90_day/12_month |
| projected_min | numeric | |
| projected_max | numeric | |
| projected_most_likely | numeric | |
| confidence | numeric | 0-1 |
| methodology | text | |
| factors | jsonb DEFAULT '{}' | |
| key_risks | text[] | |
| key_opportunities | text[] | |
| recommended_actions | text[] | |
| created_at | timestamptz DEFAULT now() | |

**Indexes:** idx_forecasts_org ON (org_id, forecast_date)

### 64. board_members
Org board member records.

| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| org_id | uuid NOT NULL | |
| name | text NOT NULL | |
| email | text | |
| role | text | Chair/Vice Chair/Treasurer/Secretary/Member |
| committee | text[] | |
| term_start | date | |
| term_end | date | |
| expertise | text[] | |
| active | boolean DEFAULT true | |
| created_at | timestamptz DEFAULT now() | |

**Indexes:** idx_board_members_org ON (org_id)

### 65. board_meetings
Scheduled board meetings.

| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| org_id | uuid NOT NULL | |
| meeting_date | date NOT NULL | |
| meeting_type | text DEFAULT 'regular' | regular/special/annual |
| agenda | text | |
| status | text DEFAULT 'scheduled' | scheduled/completed/cancelled |
| created_at | timestamptz DEFAULT now() | |

### 66. board_meeting_packets
AI-generated board meeting packets.

| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| org_id | uuid NOT NULL | |
| meeting_id | uuid | FK → board_meetings(id) |
| packet_content | jsonb NOT NULL | Full structured packet |
| generated_at | timestamptz DEFAULT now() | |
| viewed_by | text[] | Email addresses of viewers |

### 67. impact_simulations
What-if scenario modeling results.

| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| org_id | uuid NOT NULL | |
| scenario_type | text NOT NULL | receive_grant/lose_grant/new_location/hire_staff/serve_more |
| scenario_params | jsonb NOT NULL | Input parameters |
| simulation_result | jsonb | Full structured result |
| confidence | text | high/medium/low |
| generated_at | timestamptz DEFAULT now() | |
| created_by | uuid | FK → profiles(id) |

**Indexes:** idx_simulations_org ON (org_id)

---

## Tables — Autonomous Infrastructure (Migrations 098-099)

### 68. autonomous_triggers
Defines what conditions cause one agent's output to fire another agent, per org.

| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| org_id | uuid NOT NULL | |
| trigger_type | text NOT NULL | schedule/event/chain |
| source_agent_id | text | FK → agent_registry(agent_id) — agent whose completion fires this trigger |
| target_agent_id | text NOT NULL | FK → agent_registry(agent_id) — agent to enqueue |
| condition | jsonb DEFAULT '{}' | e.g. {min_probability_score: 40, status: 'completed'} |
| enabled | boolean DEFAULT true | |
| last_fired_at | timestamptz | |
| fire_count | integer DEFAULT 0 | |
| created_at | timestamptz DEFAULT now() | |
| updated_at | timestamptz DEFAULT now() | |

**Indexes:** idx_autonomous_triggers_org ON (org_id), idx_autonomous_triggers_source ON (source_agent_id)

### 69. agent_queue
Chaining queue — lets one agent's completion enqueue the next agent's invocation outside fixed nightly cron slots. Drained by the Agent Queue Processor (see WORKER_ARCHITECTURE_v2.md §11).

| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| org_id | uuid NOT NULL | |
| agent_id | text NOT NULL | FK → agent_registry(agent_id) |
| status | text DEFAULT 'pending' | pending/processing/completed/failed |
| priority | integer DEFAULT 5 | 1 (highest) to 10 (lowest) |
| input_params | jsonb DEFAULT '{}' | |
| chained_from_run_id | uuid | FK → agent_runs(id) — parent run, null if root trigger |
| trigger_source | text | schedule/chain/manual/event |
| attempts | integer DEFAULT 0 | |
| max_attempts | integer DEFAULT 3 | |
| error_message | text | |
| scheduled_for | timestamptz DEFAULT now() | |
| started_at | timestamptz | |
| completed_at | timestamptz | |
| created_at | timestamptz DEFAULT now() | |

**Indexes:** idx_agent_queue_status ON (status, priority, created_at), idx_agent_queue_org ON (org_id)

### 70. agent_decisions
Decision log — every autonomous action an agent takes or defers, surfaced on the dashboard decision log UI.

| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| org_id | uuid NOT NULL | |
| agent_run_id | uuid | FK → agent_runs(id) |
| agent_id | text NOT NULL | FK → agent_registry(agent_id) |
| decision_type | text NOT NULL | auto_apply/auto_draft/auto_queue/skip |
| entity_type | text | opportunity/application/funder/etc |
| entity_id | uuid | |
| action_taken | text NOT NULL | Human-readable description |
| confidence_score | integer | 0-100 |
| reasoning | text | |
| requires_review | boolean DEFAULT false | |
| reviewed_by | uuid | FK → profiles(id) |
| reviewed_at | timestamptz | |
| review_outcome | text | approved/rejected/modified |
| created_at | timestamptz DEFAULT now() | |

**Indexes:** idx_agent_decisions_org ON (org_id, created_at), idx_agent_decisions_review ON (org_id, requires_review)

### 71. org_autonomous_config
Per-org autonomous mode settings — the toggles and confidence threshold slider on the autonomous settings panel.

| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| org_id | uuid NOT NULL UNIQUE | |
| autonomous_mode_enabled | boolean DEFAULT false | Master toggle |
| auto_apply_enabled | boolean DEFAULT false | |
| auto_draft_enabled | boolean DEFAULT false | |
| confidence_threshold | integer DEFAULT 70 | 0-100, minimum confidence to act without review |
| max_auto_actions_per_day | integer DEFAULT 10 | |
| require_review_above_amount | numeric(12,2) | Dollar threshold above which review is always required |
| notification_preferences | jsonb DEFAULT '{}' | |
| last_updated_by | uuid | FK → profiles(id) |
| created_at | timestamptz DEFAULT now() | |
| updated_at | timestamptz DEFAULT now() | |

**Unique:** (org_id)

---

## Migration Index

| Migration | Description | Status |
|---|---|---|
| 001-030 | Core tenant tables (organizations through platform_config) | APPLIED |
| 031-040 | Foundation directory and intelligence corpus | APPLIED |
| 041-055 | AutoApply, submission queue, form analyses | APPLIED |
| 056-075 | Donor Discovery (taxonomy, directory, requests, aliases) | APPLIED |
| 076-084 | Corporate Intelligence Engine | APPLIED |
| 085 | Foundation profiles | APPLIED |
| 086 | Financial reconciliation (budgets, expenses, reports) | APPLIED |
| 087 | Compliance calendar | APPLIED |
| 088 | Funder relationship scoring | APPLIED |
| 089 | White-label consultant portal | APPLIED |
| 090 | Notification preferences | APPLIED |
| 091 | Digital Twin + Probability Scores | QUEUED (tonight) |
| 092 | Agent Marketplace + Discovery | QUEUED (tonight) |
| 093 | Reputation Intelligence + Relationship Builder | QUEUED (tonight) |
| 094 | Philanthropic Intelligence Graph | QUEUED (tonight) |
| 095 | Forecast + Board Advisor | QUEUED (tonight) |
| 096 | Disaster Response Engine | QUEUED (tonight) |
| 097 | Knowledge Engine (pgvector, patterns, queries) | QUEUED (tonight) |
| 098 | Autonomous triggers + agent queue (chaining infrastructure) | QUEUED |
| 099 | Agent decisions + org autonomous config | QUEUED |

---

## Data Volume Estimates

| Table | Current Records | Target Scale |
|---|---|---|
| foundation_directory | 133,812 | 200K+ |
| nonprofits (BMF import) | 0 | 1.8M |
| corporate_prospects | 0 | 10M+ |
| intelligence_funded_proposals | 11 | 2,000+ |
| donor_discovery_directory | Unknown | 500K+ per org |
| pig_nodes | 0 | 10M+ |
| pig_edges | 0 | 50M+ |
