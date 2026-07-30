# MASTER_BACKLOG.md
## Consolidated, Ranked Findings from RLS_POLICY_AUDIT.md, STORAGE_POLICY_AUDIT.md, SCHEMA_DRIFT_AUDIT.md, MIGRATION_AUDIT.md
## Date: July 30, 2026
## Status: This is the definitive next-session priority list. Nothing here has been fixed — all four source audits were discovery-only.

---

## How to read this

Ranked in three tiers: **(1) security/data-isolation gaps** — unauthenticated or cross-tenant
data exposure, fix first regardless of how small the table looks; **(2) functional gaps** —
broken features from schema drift or unapplied migrations, ordered active-throw > silent-failure >
missing-table-blocks-whole-feature > minor missing column; **(3) cosmetic/doc-accuracy** — memory
corrections, audit-vs-audit contradictions, and inert findings with no live consumer. Within each
tier, items are ordered by blast radius and confirmation strength (live-verified > source-inferred).

Nothing below has real `pg_policies` access behind it (Management API PAT dead since 2026-07-19,
Supabase MCP connector unauthorized for this project) — every RLS-status claim is either a live
anon-key probe result (strong signal) or migration-source inference (weaker; flagged inline).

---

## TIER 1 — Security / Data-Isolation Gaps

### 1.1 CONFIRMED live, unauthenticated data exposure (anon key reads real rows, right now)

Ranked by sensitivity of the data, not just row count. All independently re-verified — anon key
returns the identical row count as service-role (zero filtering).

1. **`platform_admins` — anon can enumerate platform super-admins.** `email`, `full_name`,
   `permissions` fully exposed. No RLS-enable statement found in any migration. **Highest-severity
   single finding across all four audits.**
2. **`organizational_digital_twins` — anon reads 10/10 rows.** Per-org financial profile, board
   composition, `known_weaknesses` — among the most sensitive tables in the schema. Migration source
   shows a textbook-correct org-scoped policy (from *two* competing migrations,
   `093_digital_twins.sql` and `src:094_...`) — this is **live/source drift**: the policy was almost
   certainly never actually executed against production, not a bad policy.
3. **`opportunity_probability_scores` — anon reads 995/995 rows.** Every org's AI-scored opportunity
   recommendations and competitive intelligence, readable across every tenant. Same live/source-drift
   pattern as #2.
4. **`donor_discovery_directory` — anon reads all 133,815/133,815 rows.** Full corporate/donor
   prospect directory. No RLS-enable statement in any migration at all. Schema doc describes this as
   tenant-scoped (`org_id NOT NULL`) — needs either a real policy or an explicit "shared pool" product
   decision (c.f. sibling `corporate_prospects`'s documented shared-pool model).
5. **`autoapply_submissions` — anon OPEN (1/1).** Funder submission records, confirmation numbers,
   error messages. Migration `066_fix_autoapply_rls_policies.sql` — a file explicitly written to *fix*
   a prior broken policy — still doesn't work live.
6. **`submission_queue` — anon OPEN (1/1).** AutoApply job queue, screenshot URLs, error messages.
   Same `066_fix...` migration, same drift.
7. **`form_templates` — anon OPEN (12/12).** Funder portal form field mappings, login-requirement
   flags. Same `066_fix...` migration, same drift.
8. **`request_profiles` — anon OPEN (1/1).** No RLS-enable statement found. Project memory previously
   said this table didn't exist live as of 2026-07-28 — it exists now (051 was manually applied
   2026-07-30) and is anon-readable from day one. Update memory once fixed.

**Fix pattern for #2, #3, #5, #6, #7:** the org-scoped policy text already exists correctly in a
migration file — this is very likely a "re-run this specific migration's `ALTER TABLE ENABLE ROW
LEVEL SECURITY` / `CREATE POLICY` statements against production" fix, not a design/rewrite job.
**Fix pattern for #1, #4, #8:** no policy exists anywhere in source — needs a new org-scoped (or,
for `platform_admins`, admin-only) policy written and applied from scratch.

### 1.2 Storage buckets: 5 of 6 have zero `storage.objects` policy

9. **`session-recordings` — confirmed user-facing break, not just a theoretical gap.**
   `src/app/(dashboard)/autoapply/recordings/page.tsx:365` calls `.storage.from("session-recordings").remove(paths)`
   from the browser session client. Zero policy → default-deny → every user's "delete my recording"
   click fails today.
10. **`org-b1ab7402-dfc2-4712-869f-70ea3566cc1d` — confirmed user-facing break for that org.** The
    live instance of the `org-{organizationId}` per-tenant bucket convention (referenced by
    `DocumentUploader.tsx` and `settings/branding/page.tsx`, both session-bound clients). Zero policy
    → that org's document/branding uploads fail. No bucket-creation code path exists anywhere in
    `src/`/`worker/`/`scripts/` — this bucket was almost certainly created out-of-band, outside any
    tracked process, which is exactly the antipattern `storage-rls.test.ts` exists to catch.
11. **`documents` bucket — zero policy, degrades silently rather than erroring** (route only checks
    `if (!dlErr && blob)` per file). Tangled with a **separate bucket-name mismatch bug** (see Tier 2
    #16) that needs resolving first so the right bucket gets the policy.
12. **`autoapply-screenshots` / `org-documents` — zero policy, currently masked by service-role-only
    usage.** Not an active break today, but "works because only service-role touches it" is not a
    guarantee — flag and fix before any future UI path reads these with a session-bound client.
13. **`nofa-pdfs` write policy is unscoped-authenticated, not org/owner-scoped** — any authenticated
    user from any org can insert/overwrite any object in this public-PDF-mirror bucket. Plausibly
    intentional given the bucket's purpose; needs a one-line confirmation, not necessarily a code
    change.

### 1.3 Authenticated cross-org leak (separate from the anon probe, not re-verified this session)

14. **24 of 100 org-scoped tables leak cross-org SELECT to authenticated users of a different org**
    — per `src/__tests__/integration/rls.test.ts`, last run 2026-07-30 (same day, not reproduced by
    these four audits, which only tested unauthenticated anon access). This is the single biggest
    remaining blind spot: an anon-only probe cannot see a policy that correctly blocks anon but still
    leaks between two authenticated orgs. **Re-running this suite (with sign-off — it mutates
    production) and merging its per-table output into the Tier 1.1 matrix should be the first action
    of the next session with real DB access.**

### 1.4 Needs a one-line intentionality confirmation, not necessarily a fix

Open to anon, but each has no `organization_id`/`org_id` column and is documented as shared/platform
reference content — likely fine as-is, but no migration explicitly grants public SELECT; it's simply
never-RLS'd:

- `intelligence_funded_proposals` (3,169 rows), `donor_discovery_taxonomy` (1,345), `knowledge_patterns`
  (30), `intelligence_budget_patterns` (5), `intelligence_scoring_rubrics` (1), `foundation_profiles`
  (1), `worker_status` (2, minor infra-info leak only), `intelligence_proposal_sections` (105),
  `nonprofits` / `foundation_directory` (inconclusive exact count, `COUNT(*)` timeout at scale, but
  confirmed anon-readable via `limit=1`).
- **Anomaly worth a direct look once `pg_policies` access exists:** `donor_discovery_taxonomy_aliases`
  has no RLS-enable statement in source (identical to its wide-open sibling `donor_discovery_taxonomy`)
  yet is empirically **blocked** live (0/6,157) — the one case in the whole audit where live behavior
  is *more* restrictive than source predicts. Understanding what's protecting it would show how to fix
  its open sibling.

### 1.5 What would close the gap fastest

Get either a fresh Supabase Management API PAT or the claude.ai Supabase MCP connector authorized for
project `vbjplpquqxxfbpazyalt` (currently denied both ways) and run `SELECT * FROM pg_policies` +
`SELECT relrowsecurity FROM pg_class` once. That single pass converts every "source-inferred" line in
this document to "confirmed," resolves the `donor_discovery_taxonomy_aliases` anomaly, and answers
whether any "RLS enabled, zero policies" tables exist live (none found in source, but a policy could
have been dropped by hand outside git).

---

## TIER 2 — Functional Gaps (schema drift / unapplied migrations)

### 2.1 Active hard failures — code throws on every invocation, right now

1. **`success_probability_scores` missing `data_quality`/`updated_at`** — Success Probability Agent
   (Agent 22) `throw`s `AgentError("Failed to save probability score.")` on every run.
   `src/lib/agents/success-probability.ts:168`. **Single most severe active-code-path break found
   across both migration audits — fix first.**
2. **`agent_configurations` missing `organization_id`/`updated_at`** — every POST to
   `/api/agents/registry/configure` returns HTTP 500. **Note:** `MIGRATION_AUDIT.md` called this
   dead/superseded ("real consumers use `org_id`"); `SCHEMA_DRIFT_AUDIT.md` read the actual file and
   found it uses `organization_id` throughout, including the `onConflict` target — the two audits
   disagree, and direct code inspection sides with "this is a live active bug." Resolve on next visit.
3. **`automation_sessions` missing `session_type`** — `worker/queue-processor.ts:1554`,
   `createApprovedAutomationSession()` (called from the main `processItem()` loop), throws on every
   auto-approval. Same audit-vs-audit disagreement as #2 (`MIGRATION_AUDIT.md` called it superseded).
4. **`platform_learning_patterns` missing `confidence`/`weight`** — table now exists live (contradicts
   project memory's "confirmed absent" note — update memory), but
   `learning-network-aggregator-agent.ts:1005` throws `Failed to insert platform_learning_patterns row`
   on every insert.
5. **`webhook_configs` column mismatch** (`type`/`is_active` vs. live `webhook_type`/`active`, no
   `updated_at`) — two competing `CREATE TABLE IF NOT EXISTS` migrations (051 vs. 052) raced and only
   one won. `webhook-notifier.ts:96,98` queries the losing names → **every AutoApply webhook silently
   never sends, for every org, always.** Cheap fix (rename or add columns) with wide blast radius.
6. **`discovery_matches`/`discovery_runs` missing `organization_id`** (real column is `org_id`) —
   `src/app/api/agents/discovery/route.ts:55` and `morning-digest.ts:38` both query the wrong name.
   Same audit-disagreement pattern as #2/#3 — `MIGRATION_AUDIT.md` called this superseded, direct code
   read says it's live and broken.
7. **`custom_api_connections` missing `error_count`** — Agent 19's 3-failures auto-pause (Behavioral
   Contracts §20) cannot function; every read of `conn.error_count` errors.
8. **`opportunities` missing `is_high_priority`/`match_mismatch_reasons`** — AG-02 eligibility scorer
   write fails. **Carried across three prior fix attempts (migrations 012, 025, 026) and three audit
   sessions — highest-standing unresolved wired-agent failure by tenure.**
9. **`alerts` missing `title`/`alert_type`** (live has `type`, no `title`, only `message`) — breaks the
   dashboard activity feed's alerts panel. New finding, not in `MIGRATION_AUDIT.md`.
10. **`intelligence_grantmaker_profiles` missing 6 columns** (`program_priorities`, `name`,
    `foundation_id`, `total_annual_giving`, `typical_award_range`, `language_patterns`) — live consumers
    across the funder-recommendation engine, the Intelligence Library dashboard client, and unified
    search. `MIGRATION_AUDIT.md` called this an "abandoned redesign, no live consumer" — that verdict
    is contradicted by direct code inspection.
11. **`funder_relationship_scores` missing 8 columns** (`relationship_score`, `is_stale`, `trend`,
    `last_interaction_at`, `recent_events`, `total_interactions`, `successful_applications`,
    `updated_at`) — wider blast radius than previously documented: funders page, `FunderDetail.tsx`,
    `funder-relationship.ts`, **and** `relationship-builder-agent.ts` (a live consumer neither prior
    audit had cited).
12. **`funder_giving_history` missing `grant_purpose`** (live has `purpose`) — Competitor Intel Agent's
    giving-history read fails (`competitor-intel.ts:97`).
13. **`agent_registry` missing `avg_tokens_per_run`** — breaks `/api/agents/registry`.

### 2.2 Confirmed silent failures (write/read no-ops, no thrown error — harder to notice, easy to miss in monitoring)

14. **`submission_queue` missing `error_message`** — `worker/queue-processor.ts:294` updates it on
    `AccountSetupRequiredError` without checking the result; silent no-op. Same table already has the
    known `risk_score`/`risk_factors` silent-write gap (`queue-processor.ts:918`) — two separate silent
    gaps on one table.
15. **`knowledge_queries` missing `organization_id`** (real column `org_id`) —
    `knowledge-engine.ts:109` insert is wrapped in a swallowed `try/catch`; every knowledge-engine query
    log silently fails to write. Same audit-disagreement pattern as 2.1 #2/#3/#6.

### 2.3 Storage bucket-name / functional bugs (adjacent to Tier 1 but a code bug, not a policy gap)

16. **`documents` vs `org-${organizationId}` bucket mismatch.** `DocumentUploader.tsx:138` (the actual
    UI users upload through) writes to a dynamic `org-${organizationId}` bucket; `api/documents/assemble/route.ts`
    reads from the literal `"documents"` bucket for the same `documents.storage_path` rows. If both
    paths are live, assemble silently can't find anything uploaded via the real UI component. **Resolve
    which bucket is canonical before writing the Tier-1 storage policy** — a correct policy can't be
    written against the wrong bucket.

### 2.4 Entire features built against schema that was never applied (grouped by area, missing tables only)

Ordered roughly by number of live call sites / feature completeness already invested:

17. **AutoApply governance/risk layer** (`052_governance_layer.sql`) — `funder_relationships` (9
    refs), `queue_controls` (13 refs, entire `admin/autoapply-ops` route + `lib/autoapply/queue-controls.ts`
    module), `submission_usage` (9 refs), `tier_limits` (5 refs). This is the AutoApply kill-switch /
    risk-gating / tier-limit layer — entirely absent despite 051 (the companion migration) having
    landed. Wired into `usage-meter.ts`, `alerting.ts`, `response-analytics.ts`, the usage page.
18. **Financial Reconciliation** — `grant_budgets` (8 refs), `grant_expenses` (6 refs),
    `grant_reconciliation_reports` (1 ref). Entire Financials page (`/financials`) and
    `/api/applications/[id]/{budget,expenses,reconcile}` built against nothing.
19. **Compliance** — `compliance_requirements` (3 refs), `compliance_events` (4 refs). Compliance
    page, briefing panel, and unified search all reference these.
20. **Corporate Intelligence Engine** — `corporate_prospects` (18 refs, more than any prior audit
    found — includes propensity scoring, enrichment agents, the acquisition adapter,
    `worker/enrichment-processor.ts`, and two other agents). Largest single missing-table blast radius
    in this pass.
21. **Relationship Intelligence Graph** — `pig_nodes` (10 refs), `pig_edges` (8 refs). An entire live
    API (`/api/intelligence/relationship-graph/*`) plus two dedicated agents
    (`relationship-builder-agent.ts`, `relationship-graph-builder-agent.ts`) with zero backing table in
    either migration tree. Not mentioned in `MIGRATION_AUDIT.md` at all — found only via the code-side
    pass.
22. **Autonomous Digest / Reputation / Relationship cluster** — `relationship_recommendations` (6),
    `reputation_alerts` (6), `reputation_signals` (1), `relationship_memory` (2), `digest_item_log` (4),
    `digest_priority_weights` (3), `deadline_predictions` (3) — 7 tables, 25 combined refs, across
    `autonomous-digest-agent.ts`, `morning-digest.ts`, `strategic-advisor-agent.ts`,
    `reputation-agent.ts`, `relationship-builder-agent.ts`, `worker/autonomous-orchestrator.ts`. A
    large, coherent feature slice built entirely against a schema never migrated in either tree — not
    in `MIGRATION_AUDIT.md` at all.
23. **SchoolFunder** — `schoolfunder_students` (6), `schoolfunder_donations` (3),
    `schoolfunder_volunteer_hours` (3). Whole `/schoolfunder` page and its 3 API routes unbacked.
24. **Disaster Response Agent** — `disaster_declarations` (5), `disaster_emergency_funds` (1). Entire
    feature unbacked; not in `MIGRATION_AUDIT.md`.
25. **Universal Scraper** — `scrape_jobs` (2), `scrape_results` (1) — referenced in recent commits.
26. **Outreach** — `followup_sequences` (2) + dead sibling `followup_enrollments` (0 refs, genuinely
    unused), `outreach_templates` (2), `notification_preferences` (3, gates all notification dispatch
    per Behavioral Contracts §32).
27. **White-label consultant portal** — `consultant_client_access` (3 refs).
28. **`org_settings`** (2 refs) — blocks the AutoApply automation-mode toggle
    (`/api/autoapply/mode/route.ts`).
29. **`org_portal_accounts`** (1 ref, `worker/queue-processor.ts:1700`).
30. **`state_portals`** (1 ref) — Settings → Integrations page.
31. **`stripe_webhook_events`** (2 refs) — idempotency check on `/api/webhooks/stripe` has nothing to
    check against. **Caveat:** worth a direct `information_schema.tables` spot-check before treating as
    fully confirmed-missing — PostgREST only lists objects in its exposed schema, so a table in a
    non-public schema would falsely show as absent.
32. **`ab_test_variants`** (8 refs) — AB-testing feature (`/api/autoapply/ab-tests`,
    `lib/autoapply/ab-testing.ts`).
33. **`session_recordings`** table (3 refs) — separate from the storage bucket of the same name (Tier
    1.2 #9); both the DB row and the bucket policy are missing for this feature.
34. **`knowledge_base_entries` — very likely a naming bug, not a missing migration.** Three call sites
    (`api/autoapply/templates/test/route.ts:95`, `form-filler-agent.ts:383`,
    `org-profile-mapper.ts:192`) query a table that has never existed in any migration file. The real,
    live KB table is `knowledge_base` (already established in project memory for an unrelated reason).
    Likely a one-line rename fix per call site rather than a schema gap — verify each site's intent
    before changing.

### 2.5 Enum gaps — agents will hard-fail their `agent_runs` insert the moment they're invoked

35. **`agent_type` enum missing 18+ values** across 8 migration files: `browser_automation`,
    `email_matching`, `email_campaign` (005-007, each file's *entire* content), `custom_scrape_research`,
    `giving_history_extractor`, `competitor_intelligence`, `semantic_matching`, `automation_worker`,
    `csv_import`, `notification_dispatcher`, `financial_reconciliation` (033), plus duplicate later
    attempts (035/037/040), plus the entire Corporate Intelligence Engine agent-type roster —
    `ea01_giving_detector` through `ea10_social_media_analyzer` (107/108), `ag22_propensity_scoring`
    (109). Any agent whose type isn't in the live enum fails its run-logging insert with a
    type-constraint violation on first invocation. Significantly larger gap than project memory's
    previous "ag-25/ag-28/autonomous_orchestrator only" note — update that memory once fixed.
36. **`subscription_tier` missing `consultant`** (021) — the White-Label Consultant plan literally
    cannot be set on `subscriptions.tier` in production.

### 2.6 Minor missing columns (existing tables, narrower blast radius — lower priority within Tier 2)

- `automation_notifications`: `title`, `related_entity_type`, `related_entity_id` (9 call sites across
  notification dispatch, calendar reminders, draft auto-generator).
- `organizations`: `analytics`, `extended_profile` (Knowledge Base Editor's 10-section profile UI has
  no backing column — self-documented as not-yet-applied in its own migration header), `service_areas`.
- `board_members`: `org_id`, `role`, `active`, `expertise` — 4 columns across 4 files in the
  relationship-graph/strategic-advisor agent cluster; table not mentioned in `MIGRATION_AUDIT.md` at all.
- `donor_discovery_prospects`: `scored_at` (strong root-cause candidate for the known "pipeline empty in
  prod" issue), `enrichment_private`.
- `funders`: `city`, `state`, `portal_type`, `avg_cycle_length_days`, `next_predicted_open_date`.
- `opportunity_probability_scores`: `org_id`.
- `org_autonomous_config`: `auto_autoapply_enabled`, `max_nightly_autoapply_submissions`, `updated_at`.
- `org_learning_contributions`: `anonymized`, `outcome_id`, `source_hash`.
- `agent_decisions`: `action_payload`, `agent_run_id`, `human_reviewer_id`.
- `agent_performance_metrics`: `runs_failed`.
- `improvement_proposals`: `affected_agent_id`.
- `email_templates`: `subject`, `body`.
- `form_templates`: `automation_assessment`.
- `pitch_cache`: `request_type`.
- `applications`: `metadata` (Narrative Humanizer has nowhere to write `humanization_score`),
  `funder_id`.
- `organizational_digital_twins`: `twin_auto_populate_log`.
- `intelligence_funded_proposals`: `embedding` never populated (pgvector column exists, stays NULL);
  all 19 columns from migration 106 (`funder_category`, `ntee_major`, keywords, etc.) absent.
- `competitor_tracking`: `competition_level`, `estimated_applicants`, `observed_at`, `opportunity_id`.
- `scraping_targets`: `updated_at` — flagged specifically because `MIGRATION_AUDIT.md` called this
  "cosmetic, no functional consumer" and `SCHEMA_DRIFT_AUDIT.md` found 2 real consumer sites in
  `custom-scrape.ts` — another audit-vs-audit disagreement to resolve.
- `prospects`: `contact_name`, `contact_title` — sole consumer is a `scripts/`-only seed script, so
  genuinely lower priority than everything else in this section.

---

## TIER 3 — Cosmetic / Doc-Accuracy Items

### 3.1 Audit-vs-audit contradictions needing a tie-breaking pass (do this before trusting either fully)

`SCHEMA_DRIFT_AUDIT.md` (code-side) directly contradicts `MIGRATION_AUDIT.md` (migration-side) on
four items — each was independently re-read at the source line by the later audit, so the code-side
read should be trusted provisionally, but a fresh look would settle it:

- `agent_configurations`/`discovery_matches` — "dead, superseded by `org_id`" vs. "live active bug
  using `organization_id`" (Tier 2 #2, #6).
- `automation_sessions.session_type` — "type-only reference, superseded design" vs. "live throw in the
  main worker loop" (Tier 2 #3).
- `intelligence_grantmaker_profiles` — "abandoned redesign, no consumer" vs. "6 columns, 4 live files"
  (Tier 2 #10).
- `scraping_targets.updated_at` — "cosmetic" vs. "2 real consumer sites" (Tier 2 #2.6).

### 3.2 Project memory corrections needed once verified

- `platform_learning_patterns` now exists live (memory said "confirmed absent" as of 2026-07-20) —
  update, but note it's still missing 2 columns (Tier 2 #4).
- `request_profiles` now exists live (memory said "no DDL path found") — update, but flag it's
  anon-readable from day one (Tier 1.1 #8).
- `benavora-agent-type-enum-gap` memory understates the gap — real count is 18+ missing values across
  8 files, not just 3 agent IDs (Tier 2 #35).
- `benavora-outreach-table-names-collide` memory treats migration 100
  (`prospects.contact_name`/`contact_title`) as a resolved fix — it was written but never actually
  applied live; the memory describes intent, not confirmed state.

### 3.3 Confirmed dead / no live consumer (safe to deprioritize or formally drop)

- `followup_enrollments` (083) — zero code references anywhere in `src/`/`worker/`.
- `automation_queue.worker_id` (035) — no live consumer (unrelated to the live `worker_status` table
  of a similar name).
- `automation_sessions` extra columns (`steps`, `screenshots`, `approval_required_at`, 020) — real
  runtime uses the live `automation_steps`/`automation_screenshots` child tables instead.

### 3.4 Documented-in-migration but absent live entirely, with no live code reference (pure doc drift, zero functional impact)

46 tables total cross-referencing cleanly with `SCHEMA_REGISTRY_v2.md`'s own July 19 audit — most
already covered above where they have live consumers (Tier 2.4). The remainder have zero code
references and are pure documentation drift, safe to leave for a future SCHEMA_REGISTRY_v2.md cleanup
pass rather than urgent action: `ab_test_variants` sibling tables not already listed, `board_meeting_packets`,
`board_meetings`, `funding_forecasts`, `impact_simulations`, `funder_relationships` variants already
counted, `email_messages`/`email_threads` (superseded by live `synced_email_*` tables), `org_settings`
already counted, `queue_controls` already counted, `tier_limits` already counted, `session_recordings`
already counted, `storage`, `submission_usage` already counted, `digest_item_log`/`digest_priority_weights`
already counted, `followup_sequences` already counted, `outreach_templates` already counted,
`relationship_memory`/`relationship_recommendations`/`reputation_alerts`/`reputation_signals` already
counted, `schoolfunder_*` already counted, `scrape_jobs`/`scrape_results` already counted.

### 3.5 Unverified/out-of-scope items for a future pass

- 9 `.rpc(...)` call sites (`donor_discovery_claim_request`, `donor_discovery_geo_within_postgis`,
  `donor_discovery_increment_api_spend`, `donor_discovery_match_foundations`,
  `donor_discovery_upsert_directory_record`, `increment_usage_tracking`, `match_logic_models`,
  `match_proposal_sections`, `register_organization`) never cross-checked against live Postgres
  function signatures.
- A full enum diff was only done for `agent_type` and `subscription_tier` — `pipeline_stage`,
  `funder_category`, and other enum types were not systematically checked and could hide similar gaps.
- 3 tables have no `CREATE TABLE` in any migration at all (`corporate_relationships`,
  `fundability_deficiencies`, `org_learning_contributions`) — created entirely out-of-band; worth
  confirming their live column set matches what code expects, since no source-of-truth file exists for
  them.
- Non-public storage buckets are all currently empty, so "zero policy" vs. "policy exists but nothing
  uploaded yet" can't be fully distinguished without either running `storage-rls.test.ts` (blocked this
  session by a tool-approval gate, not a credential problem) or a deliberate approved test upload.

---

## Immediate next-session action order

1. Get real `pg_policies`/SQL access (Management API PAT refresh or MCP connector authorization —
   Reid-side action) — this one unblock upgrades the majority of Tier 1 findings from inferred to
   confirmed and resolves the `donor_discovery_taxonomy_aliases` anomaly.
2. With sign-off, re-run `src/__tests__/integration/rls.test.ts` and merge its per-table cross-org leak
   results into Tier 1.
3. Fix Tier 1.1 #1-8 (anon-exposed tables) — the 5 with correct-looking source policies (#2,3,5,6,7)
   are likely a re-apply, not a rewrite.
4. Fix Tier 1.2 storage bucket policies, after resolving the `documents`-vs-`org-{id}` bucket mismatch
   (Tier 2 #16) first.
5. Fix Tier 2.1 active throws in priority order (success_probability_scores first).
6. Resolve the four Tier 3.1 audit-vs-audit contradictions with a direct source read each.
7. Everything else in Tier 2, roughly in the listed order.
