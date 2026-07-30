# Schema Drift Audit — Code References vs Live Production Schema

**Date:** 2026-07-30
**Method:** Static analysis. Walked every `.ts`/`.tsx` file under `src/` and `worker/`
(946 files, excluding `__tests__`, `node_modules`, `.next`), regex-extracted every
`.from("table")`, `.select("col,col,...")`, and `.rpc("name")` call, and cross-referenced
the referenced tables/columns against the **live production PostgREST OpenAPI schema**
(fetched directly from the production REST API — the actual `information_schema` as
Supabase/PostgREST sees it, not a migrations file or generated `database.ts`).

Scripts used: `parse_schema.js` (schema fetch/flatten) and `audit_schema_drift.js`
(extraction + cross-reference), raw output in `audit_result.json`. Live schema snapshot
in `schema_tables.tsv` (152 tables/views).

This is a **discovery pass only** — nothing below has been fixed. Findings should be
triaged before any repair work starts, since some entries are known-accepted design
(e.g. deliberately shared cross-org tables) and some are regex false positives (noted below).

## Summary

| Metric | Count |
|---|---|
| Files scanned | 946 |
| Distinct tables referenced in code | 178 |
| Live tables/views in production | 152 |
| **Tables referenced in code but missing in production** | **40** |
| `.select()` calls found / successfully parsed | 1,815 / 1,739 |
| Columns checked (against tables that DO exist) | 4,476 |
| **Columns referenced but missing from their (existing) table** | **55** |
| Joined/embedded-resource name mismatches (PostgREST nested selects) | 1 |

Parse gaps (calls skipped, not silent failures): 21 dynamic-content selects (template
literals — can't statically resolve column names), 5 ambiguous (semicolon between
`.from()` and `.select()` made the pairing unreliable), 2 no preceding `.from()` found.
These are omissions from coverage, not false negatives resolved in code's favor.

## Missing tables (40), sorted by reference count

Each entry: table name, number of call sites, and files that reference it (top 8 shown
per table; several tables have more call sites than listed — see `audit_result.json`
`missingTables[].refs` for the full list per table).

| Table | Refs | Key files |
|---|---|---|
| `corporate_prospects` | 18 | donor-discovery/intent-signals page, intelligence/outreach routes, ag-22-propensity-scoring.ts, corporate-enrichment-shared.ts — **known** ([[benavora-corporate-prospects-confirmed-missing-breaks-outreach]]) |
| `queue_controls` | 13 | admin/autoapply-ops route, lib/autoapply/queue-controls.ts (whole module) |
| `pig_nodes` | 10 | intelligence/relationship-graph routes + analytics, relationship-builder-agent.ts |
| `submission_usage` | 9 | autoapply/usage page, usage-meter.ts, alerting.ts, response-analytics.ts |
| `funder_relationships` | 9 | follow-up-scheduler.ts, relationship-manager.ts (whole module), risk-engine.ts |
| `grant_budgets` | 8 | financials/page.tsx, applications/[id]/budget route, reconcile route, financials/budgets route |
| `ab_test_variants` | 8 | autoapply/ab-tests route, lib/autoapply/ab-testing.ts (whole module) |
| `pig_edges` | 8 | intelligence/relationship-graph routes, relationship-builder-agent.ts, relationship-graph-builder-agent.ts |
| `grant_expenses` | 6 | financials/page.tsx, applications/[id]/expenses route, reconcile route, financials/expenses route |
| `schoolfunder_students` | 6 | schoolfunder/page.tsx, schoolfunder/donate + hours + root routes |
| `reputation_alerts` | 6 | intelligence/reputation route, morning-digest.ts, strategic-advisor-agent.ts, reputation-agent.ts, worker/autonomous-orchestrator.ts |
| `relationship_recommendations` | 6 | autonomous-digest-agent.ts, morning-digest.ts, relationship-builder-agent.ts, strategic-advisor-agent.ts |
| `tier_limits` | 5 | autoapply/usage page, usage-meter.ts (4 call sites) |
| `funding_sources` | 5 | research/page.tsx, api/sources/registry route, state-sources-registry.ts |
| `disaster_declarations` | 5 | api/agents/disaster route, disaster-response-agent.ts (4 call sites) |
| `compliance_events` | 4 | api/compliance/events route + [id] route |
| `digest_item_log` | 4 | autonomous-digest-agent.ts (4 call sites) |
| `session_recordings` | 3 | autoapply/recordings page (2), worker/queue-processor.ts |
| `schoolfunder_donations` | 3 | schoolfunder/page.tsx, donate route, root route |
| `schoolfunder_volunteer_hours` | 3 | schoolfunder/page.tsx, hours route, root route |
| `knowledge_base_entries` | 3 | autoapply/templates/test route, form-filler-agent.ts, org-profile-mapper.ts |
| `compliance_requirements` | 3 | api/compliance route (3 call sites) |
| `consultant_client_access` | 3 | api/consultant/clients route (3 call sites) |
| `notification_preferences` | 3 | api/settings/notifications route (2), notify.ts |
| `deadline_predictions` | 3 | autonomous-digest-agent.ts, deadline-prediction-agent.ts (2) |
| `digest_priority_weights` | 3 | autonomous-digest-agent.ts (3 call sites) |
| `application_followups` | 3 | followup-generator-agent.ts, src/worker/jobs/process-followups.ts (2) |
| `org_settings` | 2 | api/autoapply/mode route (2 call sites) |
| `followup_sequences` | 2 | api/outreach/sequences route (2 call sites) |
| `outreach_templates` | 2 | api/outreach/templates route (2 call sites) |
| `stripe_webhook_events` | 2 | api/webhooks/stripe route (2 call sites) — table name undocumented, see [[benavora-stripe-webhook-real-location-and-tables]] |
| `relationship_memory` | 2 | relationship-builder-agent.ts, reputation-agent.ts |
| `scrape_jobs` | 2 | lib/scraper-v2/job-store.ts (2 call sites) |
| `state_portals` | 1 | settings/integrations page |
| `grant_reconciliation_reports` | 1 | applications/[id]/reconcile route |
| `disaster_emergency_funds` | 1 | disaster-response-agent.ts |
| `funding_forecasts` | 1 | strategic-advisor-agent.ts |
| `reputation_signals` | 1 | reputation-agent.ts (also appears as a joined-resource mismatch, see below) |
| `scrape_results` | 1 | lib/scraper-v2/job-store.ts |
| `org_portal_accounts` | 1 | worker/queue-processor.ts |

Full refs for every table (not just the top 8) are in `audit_result.json` → `missingTables`.

### Flagged for triage, not necessarily bugs

- `stripe_webhook_events` — memory notes this table exists in prod but is undocumented
  in `SCHEMA_REGISTRY_v2.md`. The live OpenAPI schema pull used here did **not** find it,
  which either means the earlier note was wrong, the table was dropped, or the schema
  pull missed it (RLS/grants can hide a table from the anon/service-role OpenAPI doc
  depending on how the key used to fetch it was scoped) — needs a direct
  `information_schema` check before treating as confirmed-missing.
- `corporate_prospects` — already independently confirmed missing via direct REST query
  ([[benavora-corporate-prospects-confirmed-missing-breaks-outreach]]); this pass just
  corroborates it and adds the full reference list (18 call sites, more than previously
  scoped — includes `ag-22-propensity-scoring.ts` and `corporate-enrichment-shared.ts`
  which weren't in the earlier incident notes).

## Missing columns (55), on tables that DO exist

Grouped by table (full detail incl. every ref in `audit_result.json` → `missingColumns`):

| Table | Missing columns |
|---|---|
| `intelligence_grantmaker_profiles` | `program_priorities`, `name`, `foundation_id`, `total_annual_giving`, `typical_award_range`, `language_patterns` — 6 columns, all read by funder-recommender.ts / grantmaker-profiles.ts / unified-search.ts / intelligence-library dashboard |
| `funder_relationship_scores` | `relationship_score`, `is_stale`, `trend`, `last_interaction_at`, `recent_events`, `total_interactions`, `successful_applications` — 7 columns, funders page + FunderDetail.tsx + funder-relationship.ts |
| `opportunities` | `title`, `probability_score`, `requirements`, `eligibility_text`, `raw_content`, `funder_name` — 6 columns, deadlines page, compliance routes, rubric-extractor.ts, board-report-page.ts |
| `org_autonomous_config` | `auto_autoapply_enabled`, `max_nightly_autoapply_submissions` — autoapply/autonomous-status route, donor-intent-monitor-agent.ts, worker/autoapply-autonomous-orchestrator.ts |
| `custom_api_connections` | `error_count` — api/integrations/custom-api routes, custom-api.ts |
| `applications` | `metadata`, `funder_id` — draft-generator/autonomous page, drafts routes, autonomous-digest-agent.ts |
| `autoapply_submissions` | `response_received_at`, `variant_id`, `count` — response-analytics.ts, analytics page |
| `competitor_tracking` | `competition_level`, `estimated_applicants`, `observed_at` — intelligence/competitors page, success-probability.ts |
| `agent_decisions` | `action_payload`, `agent_run_id`, `human_reviewer_id` — api/autonomous/decisions route |
| `email_templates` | `subject`, `body` — api/email/templates route, sequence-engine.ts |
| `organizations` | `service_areas`, `extended_profile`, `analytics` — donor-intent-monitor-agent.ts, strategic-advisor-agent.ts, dashboard page, outcome-analyzer-agent.ts |
| `board_members` | `role`, `expertise` — relationship-builder-agent.ts, relationship-graph-builder-agent.ts |
| `funders` | `portal_type`, `city`, `state` — worker/autoapply-autonomous-orchestrator.ts, auto-queue-populator.ts |
| `alerts` | `title`, `alert_type` — api/activity route |
| `agent_registry` | `avg_tokens_per_run` — api/agents/registry route |
| `automation_notifications` | `title`, `related_entity_type`, `related_entity_id` — api/notifications route |
| `agent_performance_metrics` | `runs_failed` — self-improvement-agent.ts |
| `funder_giving_history` | `grant_purpose` — competitor-intel.ts |
| `platform_learning_patterns` | `weight` — learning-network-aggregator-agent.ts. **Known** src-only table, see [[benavora-two-parallel-migrations-directories]] — the table itself is unresolved-live, this column gap is secondary to that. |
| `submission_queue` | `count` (aggregate alias, likely a false positive — see below) |
| `webhook_configs` | `type` — webhook-notifier.ts |
| `donor_discovery_prospects` | `enrichment_private` — run-connector-enrichment.ts |

### Likely false positives / needs manual check

- `submission_queue.count` and `autoapply_submissions.count` — these are almost
  certainly PostgREST count-aggregate syntax (e.g. `select('*', { count: 'exact' })`
  or a `.count()` alias) that the regex misparsed as a literal column named `count`.
  Not a real schema gap; the extractor's aggregate-stripping regex didn't catch this
  particular form.
- `reputation_signals` appears in both `missingTables` (1 direct `.from()` ref) and
  `joinedMismatches` (2 refs as a nested/embedded PostgREST resource under
  `reputation_alerts(...)`) — since `reputation_alerts` itself is a missing table, the
  nested-resource check against it is moot; the real gap is just the one parent table.

## Joined/embedded resource mismatches

PostgREST supports nested selects like `.select('*, reputation_signals(...)')`. One
such embedded name didn't match any live table:

| Embedded name | Count | Referenced from (parent table in the same select) | Files |
|---|---|---|---|
| `reputation_signals` | 2 | `reputation_alerts` | `src/app/api/intelligence/reputation/route.ts:80`, `src/lib/agents/strategic-advisor-agent.ts:640` |

## All tables referenced in code (178) and all RPCs called (9)

Full lists in `audit_result.json` → `allTablesReferenced` / `rpcNames`. RPCs were
recorded but not cross-referenced against live Postgres functions in this pass (no
`.rpc()`-to-function-signature check was performed) — flagging as a gap in this
audit's coverage, not a finding either way.

## Known limitations of this pass

- Regex-based extraction, not a real SQL/TS parser — handles the common
  `.from('table').select('col, col, rel(col)')` shape well but will miss or
  misclassify: dynamic/templated column lists (21 skipped), `.rpc()` argument shapes,
  raw SQL via `execute_sql`-style escapes, and count-aggregate second-argument syntax
  (see false positives above).
- Cross-references against a single point-in-time OpenAPI pull of the production
  schema. If RLS/grants scope what a given key can see in the OpenAPI doc, a
  genuinely-existing table could show as "missing" here — flagged above for
  `stripe_webhook_events` specifically, worth spot-checking with a direct
  `information_schema.tables` query before trusting this list wholesale.
- Some "missing" tables may be intentional stubs, deprecated code paths, or
  work-in-progress features rather than the "should exist but migration wasn't
  applied" pattern this audit was launched to generalize (`automation_level`,
  `contact_name`, `request_profiles`/`org_documents`). Each entry needs a
  human/agent triage pass to sort "apply the migration" from "delete the dead code"
  from "this is fine, it's WIP."

## Next step

This is discovery only, per the task — no fixes applied. Recommend triaging the 40
missing tables and 55 missing columns against the two migrations directories
([[benavora-two-parallel-migrations-directories]]) to find which already have a
pending, unapplied migration vs. which need one written from scratch.
