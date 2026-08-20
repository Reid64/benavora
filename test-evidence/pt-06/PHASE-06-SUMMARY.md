# PT-06 — Phase 06 Summary (DB Integrity + Migration Drift Map)

Consolidated numbers for the PT-06 phase. Every number below cites the evidence artifact it came
from — re-run the cited verifier or read the cited file directly to reproduce it; nothing here is
asserted from memory.

## Scope

PT-02 root-caused 5 real production 500s to a mix of missing tables and one column-name mismatch,
and found this pattern matched `MIGRATION_AUDIT.md`'s already-documented, platform-wide "28 of 108
migrations never applied" claim from 2026-07-28. PT-06 goes and settles that question directly
against the live database, rather than continuing to cite a stale count: which migrations are
actually applied to production right now, which tables/columns real application code depends on
that don't exist, whether the schema's own internal integrity (foreign keys, primary keys, unique
constraints) holds, how clean the data in the largest tables actually is, and whether migrations can
even be safely re-run.

Six steps, each producing its own evidence file under `test-evidence/pt-06/`:

1. **PT-06-001 — Preflight, read-only connection proof, migration-file inventory.** Established a
   genuinely read-only `DATABASE_URL` connection (engine-enforced, not just requested) and inventoried
   every migration file across both known directories.
2. **PT-06-002 — Applied-vs-on-disk migration drift map.** For every migration file, checked whether
   its `CREATE TABLE`/`ALTER TABLE ADD COLUMN`/`CREATE TYPE`/`ALTER TYPE ADD VALUE` statements are
   actually live in production.
3. **PT-06-003 — Live schema census + code-vs-schema mismatch audit.** Censused the full live public
   schema, then cross-referenced it against every real `.from(...)` call site in `src/`/`worker/`.
4. **PT-06-004 — Constraint/FK/orphan integrity audit.** Checked every live FK constraint for orphaned
   rows, every tenant-scoped table for a live FK back to `organizations`, every table for a primary
   key, and identifier-shaped columns for missing unique constraints against real duplicate data.
5. **PT-06-005 — Dup/null data-quality audit + migration idempotency test.** Measured duplicate-row
   and null-rate rates on the three largest tables, then actually replayed migrations against a
   disposable database to test whether they can be safely re-run.
6. **PT-06-006 — This consolidation.** Register reconciliation, summary, review pack.

## PT-06-001 — Connection proof + migration-file inventory

**Read-only connection proven, not just requested**: connected via `DATABASE_URL`, set
`default_transaction_read_only = on`, confirmed with `SHOW`, ran a real `SELECT 1`, then attempted a
real `CREATE TABLE` in the same session — Postgres itself rejected it (`25006
read_only_sql_transaction`). This is the database engine enforcing the property, not application-level
discipline. (`test-evidence/pt-06/connection-proof.txt`)

**199 migration files inventoried** across the two known directories (`test-evidence/pt-06/migration-files.json`):

| Directory | File count |
|---|---|
| `supabase/migrations` | 142 |
| `src/supabase/migrations` | 57 |
| **Total** | **199** |

**The two-directory collision problem, precisely quantified for the first time:** from prefix `072`
through `127` — 56 consecutive numbers — both directories independently used the identical numeric
prefix for completely unrelated content (e.g. prefix `072` is `donor_discovery_taxonomy_aliases.sql`
in `src/supabase/migrations` vs. `foundation_directory_990_enrichment.sql` in `supabase/migrations` —
different tables, different purpose, coincidentally the same number). This means the two trees'
numbering diverged into two independent sequences somewhere before prefix `072` and never
re-synchronized; applying migrations "in numeric order" across both directories together is
meaningless — the number carries no cross-directory ordering information past that point.
(`test-evidence/pt-06/migration-files.json`, `crossDirectoryCollisions`, 56 entries)

**Separately, 8 same-directory duplicate-prefix collisions** — two files sharing one number inside the
*same* directory, a distinct and smaller problem from the cross-directory one above:

| Directory | Duplicated prefix | Files |
|---|---|---|
| `src/supabase/migrations` | `111` | `111_ag27_board_packet.sql`, `111_ag29_knowledge_indexer_enum.sql` |
| `supabase/migrations` | `002` | `002_phases_2_5.sql`, `002_register_organization.sql` |
| `supabase/migrations` | `022` | `022_fix_model_name.sql`, `022_usage_tracking.sql` |
| `supabase/migrations` | `052` | `052_governance_layer.sql`, `052_webhook_configs.sql` |
| `supabase/migrations` | `053` | `053_autoapply_missing_columns.sql`, `053_multichannel_analytics.sql` |
| `supabase/migrations` | `054` | `054_email_calendar_integration.sql`, `054_funders_contact_email.sql` |
| `supabase/migrations` | `055` | `055_admin_sales_outreach.sql`, `055_sequence_enrollment_variables.sql` |
| `supabase/migrations` | `058` | `058_backfill_opportunity_deadlines.sql`, `058_lead_enrichment_system.sql` |

`052_governance_layer.sql`/`052_webhook_configs.sql` was already flagged by name in
`STATE_OF_THE_BUILD.md`'s 2026-08-06 session; this phase confirms it's one instance of an 8-instance
pattern, not an isolated case.

## PT-06-002 — Applied-vs-on-disk migration drift map: the real, current number

**No migration-tracking table exists in this project** (`supabase_migrations.schema_migrations` —
confirmed absent two independent ways: `to_regclass()` and a direct `pg_namespace` check). Every
migration in this project's history was applied by hand via a direct `DATABASE_URL`/psql connection
(`STANDING_DIRECTIVES.md` DIRECTIVE-017), never via the Supabase CLI's own migration workflow — so
there is no ledger recording which migration "ran." Applied status is therefore determined by live
object existence: for every file, every `CREATE TABLE`/`ADD COLUMN`/`CREATE TYPE ... AS ENUM`/`ALTER
TYPE ADD VALUE` statement (including ones inside `DO $$ ... $$` blocks) is extracted and checked
against the live production schema.

**The settled number, replacing the stale "28 of 108" figure from `MIGRATION_AUDIT.md` (2026-07-28)
and PT-02's carried-forward reference to it:**

| Bucket | Count | Meaning |
|---|---|---|
| `appliedAndOnDisk` | **108** | Every required table/column/enum-value this file defines is confirmed live. |
| `onDiskNotApplied` | **57** | At least one required table/column/enum-value this file defines is NOT live. |
| `noDdlUnverifiable` | 34 | RLS-only / data-backfill-only / comment-only files with no `CREATE`/`ALTER` statement to check — recorded separately, never defaulted into either bucket. |
| **Checkable total** | **199** | `108 + 57 + 34` — exactly matches `totalMigrationFilesOnDisk`, confirmed via `partitionIntegrity` (no overlap, no gaps, all 199 files land in exactly one bucket). |
| `appliedNotOnDisk` | 2 | Live tables (`corporate_relationships`, `fundability_deficiencies`) matching no `CREATE TABLE` in either directory — see WGR-069. |

(`test-evidence/pt-06/migration-drift.json`, `counts`, `partitionIntegrity`)

**The real current drift rate is 57 of 165 checkable migrations (34.5%) unapplied**, not 28 of 108
(25.9%) as previously cited — a materially larger gap than the stale figure suggested, though not
directly comparable 1:1 since `MIGRATION_AUDIT.md`'s 2026-07-28 count only covered the root
`supabase/migrations` tree (108 files at the time) and used a different checking method (schema
introspection at a single point in time, not a full DDL-statement extraction across both directories).

**Of the 57 unapplied files, 14 are missing an entire table** (not just a column or enum value) —
these are the ones capable of causing a full route 500, the same failure mode PT-02 already found for
4 of them:

| Migration file | Missing table(s) | PT-02 500 it causes |
|---|---|---|
| `src/supabase/migrations/081_application_followups.sql` | `application_followups` | None captured directly by PT-00's smoke sweep, but named in WGR-007 as the (also-missing) alternative to `followup_sequences` |
| `src/supabase/migrations/097_deadline_prediction_agent.sql` | `deadline_predictions` | None captured; real live consumers documented in WGR-053 |
| `src/supabase/migrations/098_digest_agent_upgrade.sql` | `digest_item_log`, `digest_priority_weights` | None captured |
| `supabase/migrations/008_stripe_billing.sql` | `stripe_webhook_events` | None captured |
| `supabase/migrations/052_governance_layer.sql` | `funder_relationships`, `queue_controls`, `submission_usage`, `tier_limits` | None captured directly; this is the entire AutoApply governance/risk-gating/usage-tracking layer, per WGR-045 |
| `supabase/migrations/053_multichannel_analytics.sql` | `session_recordings`, `ab_test_variants` | None captured |
| `supabase/migrations/054_email_calendar_integration.sql` | `email_threads`, `email_messages` | None captured directly; see WGR-052 for real consumers |
| `supabase/migrations/083_followup_sequences.sql` | `followup_sequences`, `followup_enrollments` | **WGR-007** — `GET /api/outreach/sequences` |
| `supabase/migrations/085_compliance_requirements.sql` | `compliance_requirements` | None captured |
| `supabase/migrations/086_white_label.sql` | `consultant_client_access` | **WGR-006** — `GET /api/consultant/clients` |
| `supabase/migrations/087_notification_preferences.sql` | `notification_preferences` | **WGR-009** — `GET /api/settings/notifications` |
| `supabase/migrations/097_funding_sources.sql` | `funding_sources` | None captured |
| `supabase/migrations/102_org_portal_accounts.sql` | `org_portal_accounts` | None captured |
| `supabase/migrations/103_schoolfunder.sql` | `schoolfunder_students`, `schoolfunder_volunteer_hours`, `schoolfunder_donations` | **WGR-008** — `GET /api/schoolfunder` |

"None captured" means PT-00's authenticated, no-query-param smoke sweep did not hit a route that
surfaces this specific missing table as a 500 — not a claim the gap is harmless, only that PT-00's
sweep methodology (GET, no params, primary routes) didn't happen to reach it. `test-evidence/pt-06/
consumer-check.json` independently confirms 53 of these 57 files have at least one real, non-test call
site in `src/`/`worker/` referencing a table/column they define (`hasLiveConsumer: true`) — these are
live, currently-broken code paths waiting to be hit, not dead migrations for dead code.

The remaining 43 unapplied files add columns/enum values to tables that already exist — see the
register (WGR-042 through WGR-053, WGR-054 through WGR-061) for the ones individually read-verified
against real call sites this phase, and WGR-062 for the honest index of what wasn't.

## PT-06-003 — Code-vs-schema cross-reference (the other headline check)

**1,070 files scanned, 2,727 real `.from(...)` call sites extracted, 11,474 column references
checked against the live schema.** (`test-evidence/pt-06/schema-mismatch.json`)

| Check | Result |
|---|---|
| Runtime query code (`.from("table")`) — missing tables | **21** |
| Runtime query code — column-name mismatches | **50** distinct `table.column` pairs, **96** real (non-test) call sites |
| Typed interface (`src/types/database.ts`) — missing tables | 0 |
| Typed interface — column mismatches | 0 |

The generated TypeScript types are fully clean against the live schema — every drift finding is in
hand-written Supabase-js query code, not the typed layer, meaning `pnpm tsc --noEmit` cannot catch any
of these; they only surface at runtime.

PT-02's own `discovery_matches.organization_id`-vs-`org_id` finding (WGR-005) is independently
re-confirmed here via this completely separate method (static code scan vs. PT-02's live HTTP
reproduction) — both land on the identical two call sites (`src/app/api/agents/discovery/route.ts`,
`src/lib/agents/morning-digest.ts`).

Of the 21 missing tables and 50 column mismatches, this phase individually read-verified and
registered 8 missing-table cases (via migration-drift, WGR-041/047/049/053) and 8 column-mismatch
cases (WGR-054 through WGR-061) against their real source call sites. The remainder — 9 missing
tables, 34 column mismatches — is recorded in full in the raw evidence file and indexed, not
individually verified, in **WGR-062**; a future session should triage from that list rather than
re-scanning from scratch.

## PT-06-004 — Constraint/FK/orphan integrity audit

**267 live FK constraints checked. 0 orphaned rows.** Every declared foreign key in this schema is
currently intact — no dangling child row with no matching parent. 0 tables lack a primary key.
(`test-evidence/pt-06/integrity.json`, `WGR-063`)

**Tenant FK gap — 13 of 120 tenant-scoped tables have no live FK back to `organizations`**:
`adapter_usage_log`, `agent_configurations`, `autoapply_review_queue`, `board_meeting_packets`,
`board_meetings`, `discovery_matches`, `funding_forecasts`, `impact_simulations`, `knowledge_queries`,
`opportunity_probability_scores`, `organizational_digital_twins`, `pitch_cache`,
`submission_receipts`. Nothing in the database enforces that a value in these columns actually
corresponds to a real organization — a real, concrete input for whatever tests PT-05 (tenant
isolation) runs next. (`WGR-064`)

**Unique-index gaps — 6 identifier-shaped columns with no unique index AND real live duplicate data**:
`foundation_directory.website` (P1, 151 distinct values repeat), `nonprofits.website` (P1, 7,318
distinct values repeat), plus 4 smaller P2 cases (`funders.website`, `organizations.ein`,
`organizations.website`, `profiles.email`). (`WGR-065`)

## PT-06-005 — Data quality (duplicate/null rates) + migration idempotency

**Duplicate-row-rate audit, 3 largest tables**: `ein`-based exact-match duplication is clean on both
tables with a live `UNIQUE` index on `ein` (`foundation_directory`: 0/133,812; `nonprofits`:
0/1,978,526 — confirms those indexes are genuinely enforced). Looser identity keys show real
collision: `foundation_directory` name+state 0.13% extra-row rate; `nonprofits` name+state 13.37%
(264,519 extra rows — the largest raw number in this audit, though not automatically a defect at ~2M
rows); `donor_discovery_directory` legal_name 2.43%, dropping to 0.03% under a stricter
legal_name+address key. (`WGR-066`)

**Null-rate audit on columns real app code reads as a signal**: `foundation_directory.email`/
`.contact_emails` are 100% null (the scraper enrichment pipeline has never populated either, live);
`.website` is 38.04% null, removing the foundation-linkage primary signal for over a third of the
table. `nonprofits.officer_email`/`.contact_emails` are 100% null at IRS-BMF-import scale (1,978,523 of
1,978,526 rows); `.website` is 74.86% null (an app-acknowledged segment, not a universal requirement).
`donor_discovery_directory.website` is 100% null — disabling both the foundation-linkage signal AND
this table's own dedup unique index for every row today, a compounding effect confirmed via
`pg_get_functiondef`; `.phone` is 100% null but no code path hard-requires it. (`WGR-067`)

**Migration idempotency — actually RAN, not PENDING.** A disposable local Postgres database was
created, every file in `supabase/migrations/*.sql` was applied in order (121/142 OK, 21 failed —
almost entirely on missing prerequisites from the parallel `src/supabase/migrations` tree, the same
cross-directory drift documented above, not a new defect), then an 8-file sample was re-applied a
second time to test idempotency. **6 of 7 testable files are NOT idempotent.** 5 are `CREATE TABLE`
statements with no `IF NOT EXISTS` guard that fail loudly on re-apply (P2 — safe failure mode). The
6th, `003_onboarding.sql`, is the one P1 in this whole phase's data-quality/idempotency work and a
materially different kind of bug: it is a data backfill with no guard scoping it to rows that still
need it, and re-running it against a real seeded row silently flipped `onboarding_completed` from
`false` to `true` with **zero error** — a second run of this migration corrupts real data rather than
failing safely. Only 1 of 7 (`058_backfill_opportunity_deadlines.sql`) is genuinely idempotent,
confirmed via a real establish-then-reapply cycle. (`test-evidence/pt-06/idempotency.json`, `status:
"RAN"`, `WGR-068`)

## Register coverage

All PT-06 findings are recorded in `test-evidence/_register/WIRING_GAP_REGISTER.md` as rows
**WGR-041 through WGR-070** (30 rows — the register's largest single-phase contribution so far),
continuing numbering from PT-08's last row (WGR-040). This consolidation pass also fixed an existing
defect in rows WGR-041 through WGR-053: their Scope Tag cell held the literal string `PT-06`, which is
not one of the 5 values the register's own legend defines — corrected to `CONFIRMED-BROKEN` (all 13
are live-verified drift, matching every sibling row's tag). No PT-06 finding from this phase exists
outside the register; WGR-062 is the honest index for the subset (9 missing tables, 34 column
mismatches) not yet individually read-verified against source.

## Verifier status

```
node scripts/audit/verify-pt06-001.mjs
  -> PASS: connection-proof.txt shows a real select-1 success and a real engine-rejected write
     attempt. migration-files.json is valid, non-empty, every entry has a directory and sha256.

node scripts/audit/verify-pt06-002.mjs
  -> PASS: applied-migrations.json records the tracking-table check. migration-drift.json's
     three buckets partition the on-disk file set with no overlap, no gaps. All 4 migrations
     already known from PT-02 (WGR-006/007/008/009) appear in onDiskNotApplied.

node scripts/audit/verify-pt06-003.mjs
  -> PASS: live-schema.json and schema-mismatch.json are both real, non-empty artifacts. The
     known discovery_matches org_id/organization_id case (WGR-005) is present in the recorded
     findings, independently re-confirmed via this static-scan method.

node scripts/audit/verify-pt06-004.mjs
  -> PASS: integrity.json records a real FK/orphan result set (267 constraints, each with a
     live orphan-row count and the query that produced it) and a real constraint-gap result
     set (tenant FK gaps, PK coverage, unique-constraint gaps), each entry carrying its query.

node scripts/audit/verify-pt06-005.mjs
  -> PASS: data-quality.json records duplicate-rate AND null-rate results, each carrying its
     exact query, for all three named large tables. idempotency.json is a real result set
     (status: RAN) from migrations actually re-run against a disposable database, not a
     PENDING-SCOPE placeholder and not a run against production.

node scripts/audit/verify-pt06-006.mjs   -> this phase's closing verifier (see REVIEW-PACK.md)
```
