# Migration Rehearsal Summary

Rehearsal DB: Docker container running `public.ecr.aws/supabase/postgres:17.6.1.131` (matches
production's real Postgres version, 17.6 -- the task said "Postgres 15" but a live `SELECT version()`
against production found 17.6; used the matching version instead of the stale assumption, per this
project's established practice of checking real state before applying a literal spec).

Baseline: `pg_dump --schema-only --no-owner --no-privileges -n public` from production, restored into
a freshly created `public` schema (dropped/recreated first) with the same extensions production has
(`uuid-ossp`, `pgcrypto`, `pg_trgm`, `vector`) pre-installed. Public-schema-scoped only: the only
migrations touching another schema (`storage.objects`, migrations 044/140/143) are all already
APPLIED-UNRECORDED/verified-live and not in the apply set, so a full multi-schema dump (which would
also require reconciling `auth`/`storage`/`realtime` schema versions between the Supabase platform
image and real production, out of scope here) was unnecessary.

`supabase_migrations.schema_migrations` created fresh in the rehearsal DB (see ledger-audit.md --
this table does not exist in production at all), then seeded with a ledger-row-only INSERT for all
98 APPLIED-UNRECORDED files (no re-apply, per task instruction).

## Pass 1 (first attempt, from the initial fresh dump)

47 MISSING/PARTIAL migrations attempted, one transaction each (`psql -1 -v ON_ERROR_STOP=1 -a`),
filename order. **9 failed**:

| Migration | Error | Root cause |
|---|---|---|
| `002_phases_2_5.sql` | `type "automation_status" already exists` | Unguarded `CREATE TYPE ... AS ENUM` (4x), plus (found on the next pass) 14 unguarded `CREATE TABLE`, 14 unguarded `CREATE POLICY`, 27 unguarded `CREATE INDEX` |
| `037_giving_history.sql` | `relation "funder_giving_history" already exists` | Unguarded `CREATE TABLE` |
| `038_intelligence_tables.sql` | `relation "funder_relationship_scores" already exists` | Unguarded `CREATE TABLE` (x3), `CREATE POLICY` (x3), `CREATE INDEX` (x7) |
| `041_scraping_targets.sql` | `policy "scraping_targets_org" ... already exists` | Unguarded `CREATE POLICY` |
| `050_funder_credentials.sql` | `relation "organization_members" does not exist` | **Real bug, not an idempotency gap**: every policy in this file referenced a table (`organization_members`) that has never existed anywhere in this schema -- this file could never have succeeded as originally written, on any database, ever. The real, live, working policies on these same tables (confirmed via `pg_policies`) use `profiles.organization_id` instead, this schema's actual and only org-membership pattern. |
| `052_webhook_configs.sql` | `column "is_active" does not exist` | **Real bug**: the live table (created out-of-band) has `webhook_type`/`active` instead of this file's `type`/`is_active`/`updated_at` -- and real application code (`src/app/api/autoapply/webhooks/route.ts`, `src/lib/autoapply/webhook-notifier.ts`, `src/types/database.ts`) queries `type`/`is_active`, confirming the live table's columns, not this file's, are the ones out of sync with the app. |
| `054_email_calendar_integration.sql` | `type "email_sync_status" already exists` | Unguarded `CREATE TYPE` (x3), `CREATE POLICY` (x9), `CREATE INDEX` (x8) |
| `095_discovery_matches.sql` | `column "organization_id" does not exist` | **Real bug**: `discovery_runs` already existed (out-of-band) without `organization_id` at all, RLS never enabled, zero policies -- readable/writable by any authenticated user, any org. `discovery_matches` already existed using `org_id` instead of `organization_id`, with 3 separate policies instead of this file's 1 unified one. |
| `096_knowledge_engine.sql` | `column "organization_id" does not exist` | Same pattern as 095: `knowledge_queries` already existed using `org_id`, 2 separate policies. |

## Fixes applied (all to the migration files themselves, intended end state unchanged)

- **Idempotency guards** (`002`, `037`, `038`, `041`, `054`, and `052`'s own `CREATE POLICY`): added
  `IF NOT EXISTS` to every `CREATE TABLE`/`CREATE INDEX`, `DROP POLICY IF EXISTS` before every
  `CREATE POLICY`, and wrapped every top-level `CREATE TYPE ... AS ENUM` in a
  `DO $$ BEGIN ... EXCEPTION WHEN duplicate_object THEN NULL; END $$;` block (Postgres has no native
  `IF NOT EXISTS` for enum creation).
- **`050_funder_credentials.sql`**: rewrote every policy's `organization_members`-based check to the
  real, live, correct `profiles`-based pattern (confirmed identical to already-working policies of the
  same name via `pg_policies`), added `TO authenticated` to match, and fixed
  `autoapply_screenshots_org_select`/`_insert` to allow `submission_id IS NULL` (matching the real
  live policy and `screenshot-manager.ts`'s documented "may be null while the record is not yet
  created" case -- an earlier draft of this fix omitted the NULL allowance and would have silently
  broken screenshot capture for in-flight submissions; caught by diffing rehearsal's resulting schema
  against production and finding an unexplained policy-body difference, not by inspection alone).
- **`052_webhook_configs.sql`**: added `DO` blocks that rename `webhook_type` -> `type` and
  `active` -> `is_active` only if the old name exists and the new one doesn't (idempotent both ways),
  plus `ADD COLUMN IF NOT EXISTS updated_at`. Table confirmed empty (0 rows) before this fix -- safe
  rename, no data loss.
- **`095_discovery_matches.sql`**: added a `DO` block that adds `organization_id` to `discovery_runs`
  only if missing (table confirmed empty, 0 rows), and a `DO` block that renames
  `discovery_matches.org_id` -> `organization_id` only if needed (also confirmed empty), plus
  `DROP POLICY IF EXISTS` for the 3 old `org_id`-based policies this file's single new policy
  replaces.
- **`096_knowledge_engine.sql`**: same pattern as 095 for `knowledge_queries.org_id` ->
  `organization_id` and its 2 old policies.

## Pass 2 (all 9 fixes applied, from a fresh dump)

46/47 succeeded. `002_phases_2_5.sql` still failed (`relation "research_cache" already exists`) --
the enum fix alone wasn't sufficient; the file also has 14 unguarded `CREATE TABLE`, 14 unguarded
`CREATE POLICY`, and 27 unguarded `CREATE INDEX` statements after the enums (confirmed programmatically
against the file, then fixed the same way).

## Pass 3, 4, 5 (final, each from a fresh dump)

**47/47 succeeded, 0 errors**, three consecutive times (re-run from a fresh prod dump each time per
the task's "re-run rehearsal from a fresh dump until it completes clean" instruction -- the extra
re-runs were to also validate the `050`/discovery-policy diff fixes below).

## Schema diff (rehearsal post-apply vs. a fresh pre-apply prod dump)

`test-evidence/remediation/migration-drift/rehearsal-vs-prod.diff`. 1942 added lines, 58 removed
lines. Every removed line accounted for:

- 2 lines: pg_dump's per-dump random `\restrict`/`\unrestrict` token pair -- a dump-format artifact,
  not a schema difference (the same content is confirmed present in both dumps by direct `grep -c`).
- ~24 lines: text-diff position-shift noise -- unrelated `CREATE TYPE`/function-body/column-list
  lines that are byte-identical in both dumps but appear as remove+re-add because content inserted
  elsewhere in the same multi-line SQL block shifted their position (confirmed via direct `grep -c`
  against the post-apply dump: each affected string still appears exactly once).
- ~10 lines: **intentional column renames** (`discovery_matches.org_id`, `knowledge_queries.org_id`,
  `webhook_configs.webhook_type`/`active`) -- the corresponding `+` lines show the renamed column.
- ~22 lines: **intentional policy replacements** -- the old `org_id`-based
  `discovery_matches_org_insert/select/update` and `knowledge_queries_org_insert/select` policies,
  replaced by each file's own new, single, `organization_id`-based policy (095/096's explicit,
  documented intent).

No unexplained removal. **Gate: PASS** -- proceeding to production apply.

## Production apply

All 47 MISSING/PARTIAL migrations applied to production in filename order, one transaction each
(`psql -1 -v ON_ERROR_STOP=1 -a`), immediately after a full `pg_dump --schema-only` backup
(`prod-pre-<timestamp>.sql`). **47/47 succeeded, 0 errors** -- identical outcome to the final
rehearsal pass. Ledger row inserted after each success; the 98 APPLIED-UNRECORDED files got a
ledger-row-only insert (no re-apply), per the task's own instruction. Ledger now has 145 rows,
matching all 145 files on disk at that point.

## Post-apply verification finding: migration 144 (new, not part of the original 47)

Step 6 verification (`npx vitest run`) found 1 new failure after the prod apply:
`src/__tests__/integration/rls.test.ts`'s full cross-org sweep flagged 4 tables — `ab_test_variants`,
`funder_relationships`, `session_recordings`, `submission_usage` — leaking rows cross-org via SELECT.
Root cause: `052_governance_layer.sql` and `053_multichannel_analytics.sql` (both part of the original
47, both applied clean in rehearsal and production) create these 4 org-scoped tables but, as
originally written, never enable RLS or create any policy on any of them at all — a gap the rehearsal
process itself could not have caught, since rehearsal only validates that migrations *apply* without
error, not that their resulting schema is secure. This repo's default schema ACLs grant
anon+authenticated full CRUD on every new table (STANDING_DIRECTIVES.md), so these 4 tables were
genuinely readable/writable cross-org in production for the short window between the 47-migration
apply and this fix.

Fixed via a new `144_governance_analytics_rls_hardening.sql` (RLS + org-isolation policy on all 4;
`queue_controls`/`tier_limits`, the other 2 tables `052_governance_layer.sql` creates, deliberately
excluded — neither has an `organization_id` column, both are genuinely global/shared config).
Rehearsed against the still-running rehearsal DB (already had all 47 prior migrations applied) —
clean, 0 errors — then applied to production immediately given the live-leak severity, same
one-transaction/`ON_ERROR_STOP=1` discipline, ledger row inserted after success. Ledger now has 146
rows, matching 146 files on disk.

Re-ran `npx vitest run` after: **exit 0, 521 passed, 0 failed** (`vitest-final-2026-08-21.log`).
`storage-rls.test.ts` and `agent-runs.test.ts` (this task's specifically-named checks) both pass —
8/8 buckets OK for the storage sweep, 6/6 for agent-runs.
