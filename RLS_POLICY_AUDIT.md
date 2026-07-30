# Benavora — Systematic RLS Policy Audit

## Status: DISCOVERY ONLY — nothing in this document has been remediated.
## Date: July 30, 2026
## Scope: All 153 tables/views live in the production PostgREST schema (project `vbjplpquqxxfbpazyalt`), plus the 6 Supabase Storage buckets.

---

## 0. Why this document exists

This session found two RLS/auth gaps by accident — a `storage.objects` policy gap on the `documents`
bucket, and an admin role-gating gap — before this audit was requested. Both were incident-driven
discoveries, not systematic ones. This document is the systematic pass: for every live table, it
answers three questions — (1) is RLS actually enabled, (2) what policies exist and which commands do
they cover, and (3) does live, unauthenticated behavior match what the policy source says it should
do. The answer to (3) surfaced **16 more tables that are currently readable by a fully unauthenticated
client**, several of which are exactly the kind of gap the two incidents above represent — this
audit found them systematically instead of by accident, which was the point.

**No fixes have been applied.** This is a discovery document only, per the task instructions.

---

## 1. Methodology and a credential blocker you should know about

The clean way to do this audit is `SELECT * FROM pg_policies` plus `SELECT relrowsecurity, relforcerowsecurity
FROM pg_class` — a few queries, complete and authoritative. **That path was not available this
session.** Two credentialed routes were tried and both failed:

- **Supabase Management API** (`POST /v1/projects/{ref}/database/query`) using the PAT documented in
  BLUEPRINT_v2.md §8.3 (`sbp_a635...`) — returned `401 Unauthorized` on every endpoint tested,
  including `GET /v1/projects` (not just the query endpoint). This is the same token project memory
  already flagged as rejected on 2026-07-19; it is still dead 11 days later, so it should be treated
  as permanently revoked, not transiently unavailable.
- **The claude.ai Supabase MCP connector** — available as a tool this session, but every call
  (`list_projects`, `execute_sql`) returned an authorization error (`MCP error -32600: You do not have
  permission to perform this action`) rather than a harness permission prompt, meaning the connected
  Supabase OAuth account does not have access to this project. This needs to be fixed on Reid's end
  (claude.ai connector settings) before a future session can use it.
- No direct Postgres connection string (`DATABASE_URL` / `POSTGRES_URL`) exists in `.env.local` —
  only the PostgREST URL, anon key, and service-role key.

**Given that, this audit is built from three independent read-only signals instead, cross-referenced
against each other:**

1. **Migration source scan** — every `.sql` file in both `supabase/migrations/` (112 files, 001–110)
   and `src/supabase/migrations/` (32 files, 072–103) — the two parallel, disputed migration tracks
   documented in project memory — parsed in filename order for `CREATE TABLE`, `ALTER TABLE ...
   ENABLE/DISABLE ROW LEVEL SECURITY`, `CREATE POLICY` (name, table, `FOR` command, `TO` role), and
   `DROP POLICY`. This tells you what the **intended** state is, per the tracked source. It does
   **not** tell you the live state — this project has a well-documented, self-acknowledged pattern of
   migrations being written but never applied (see `MIGRATION_AUDIT.md`: 28 of 108 not applied as of
   2026-07-28), and separately of live schema being hand-edited via the Management API / Studio SQL
   Editor outside any tracked migration file at all. Treat the "migration-source RLS status" column in
   the appendix as *declared intent*, not *confirmed live state*.
2. **Live anon-key exposure probe** — for all 153 tables/views actually present in the live PostgREST
   schema (confirmed via `GET /rest/v1/` OpenAPI introspection with the service-role key), issued a
   `GET .../rest/v1/<table>?select=*` with `Range: 0-0`, `Prefer: count=exact`, authenticated as
   **only the anon key** (no signed-in user session — i.e. the `anon` Postgres role with `auth.uid()
   IS NULL`), and read the `Content-Range` total from the response header (no row payload beyond the
   1-row range needed). The same call was repeated with the **service-role key** (which always bypasses
   RLS) to get a true total row count for comparison. This is real, live, unauthenticated behavior —
   the strongest signal in this document, and the one the findings below are ranked by.
3. **Storage bucket probe** — `GET /storage/v1/bucket` (service key) to enumerate buckets and their
   `public` flag, then `POST /storage/v1/object/list/<bucket>` as both anon and service-role keys.

**What this audit deliberately did NOT do:** re-run the existing live cross-org leak test
(`src/__tests__/integration/rls.test.ts`). That suite creates and deletes real organizations, users,
and rows in production to test authenticated cross-org access — a mutation, not a read, and out of
scope for a "discovery only, don't fix" pass without explicit sign-off. Project memory already
records its most recent result: **24 of 100 org-scoped tables leak cross-org SELECT** (dated
2026-07-30 — today). That number is real but this audit did not reproduce or update it; treat it as a
separate, complementary data point, not verified here. Re-running it (with approval, since it writes
to prod) would give per-table names to merge into the findings below.

**A structural limitation of anon-key-only exposure testing:** the anon probe reliably detects
"unauthenticated clients can read this data" (unambiguous — that's a real, confirmed exposure,
independent of anything else). It does **not** reliably distinguish, for a table where anon correctly
gets 0 rows, between (a) RLS working as intended, (b) RLS enabled with zero policies (default-deny,
over-restrictive, "locked" per the task's framing), and (c) a policy that's correct for anon but
still leaks cross-org for authenticated users of a different org (the exact failure mode the existing
24-table leak result describes, and which an anon-only probe cannot see). Where the migration source
shows a table with RLS enabled and zero `CREATE POLICY` statements, that's flagged explicitly below;
everywhere else, "anon blocked" should be read as "not proven safe," not "confirmed safe."

---

## 2. Headline numbers

| | Count |
|---|---|
| Live tables/views in production PostgREST schema | 153 |
| — RLS enabled + ≥1 policy found in migration source | 98 |
| — **No `ENABLE ROW LEVEL SECURITY` found in any migration for this table** | 52 |
| — No `CREATE TABLE` found in any migration at all (created outside tracked migrations) | 3 |
| — RLS enabled with **zero** policies found in source | 0 (see caveat below) |
| Tables confirmed **readable by a fully unauthenticated (anon) request**, live, right now | **16** |
| — of those, migration source shows RLS enabled + policies anyway (live/source drift) | 5 |
| — of those, migration source shows no RLS-enable statement at all | 11 |
| Tables inconclusive due to `COUNT(*)` statement timeout (very large tables) | 2 (`nonprofits`, `foundation_directory` — both confirmed anon-readable via a lighter `limit=1` probe; exact row-level filtering unverified) |
| Tables documented in a migration file but **absent from the live schema entirely** | 46 |

**Zero "RLS enabled, zero policies" tables were found by source scan** — this project's convention
never explicitly disables RLS or leaves it bare once enabled, so that specific failure mode (task's
"fully locked, likely unintentional" case) doesn't show up as a *source* pattern here. It may still
exist *live* if a policy was dropped by hand outside git — the Management API/MCP blockers above mean
that can't be ruled out from this session, only from source. This is the single biggest reason a
follow-up with real `pg_policies` access matters (§6).

---

## 3. CONFIRMED: tables readable by an unauthenticated client, right now

These are not inferred — each was independently re-verified with a raw `fetch` outside the batch
probe, comparing the anon-key response against the service-role response for the same table. All 16
below show the anon key retrieving **the exact same row count as the service-role key** (full match:
nothing is being filtered from anon at all).

### 3a. Tables where the migration source shows RLS enabled with a policy — yet the live table leaks anyway

This is the most important subset in this document. These are not "someone forgot RLS" — the
migration files show a textbook-correct, org-scoped policy matching the project's documented "RLS
Master Policy Pattern." The fact that they still leak, with an identical pattern that visibly *works*
for other tables (`organizations`, `applications`, `funders`, etc. all correctly return `[]` to the
same anon probe), points at **live/source drift** — i.e. these specific `ALTER TABLE ... ENABLE ROW
LEVEL SECURITY` / `CREATE POLICY` statements most likely were never actually executed against the
live database, consistent with this project's independently-documented migration-application gap
(`MIGRATION_AUDIT.md`: 28/108 migrations not applied as of 2026-07-28) — not a bug in the policy text
itself.

| Table | Anon reads | Source policies (all textbook-correct `organization_id = profiles.organization_id` pattern) | What's in it |
|---|---|---|---|
| `organizational_digital_twins` | **10 of 10 rows** | 2 policies (`organizational_digital_twins_org` from `093_digital_twins.sql`, `digital_twins_org` from `src:094_twin_powered_draft_generation.sql` — two migration tracks independently created this table, both with correct RLS) | Per-org financial profile, board composition, `known_weaknesses` — one of the most sensitive tables in the schema |
| `opportunity_probability_scores` | **995 of 995 rows** | 1 policy (`opportunity_probability_scores_org`, `093_digital_twins.sql`) | Every org's AI-scored opportunity recommendations, risk factors, confidence — competitive intelligence, readable across every tenant |
| `autoapply_submissions` | **1 of 1 rows** | 4 policies (SELECT/INSERT/UPDATE/DELETE, `066_fix_autoapply_rls_policies.sql` — itself a migration explicitly written to *fix* a prior broken policy) | Funder submission records, confirmation numbers, error messages |
| `submission_queue` | **1 of 1 rows** | 4 policies (SELECT/INSERT/UPDATE/DELETE, same `066_fix...` migration) | AutoApply job queue, screenshot URLs, error messages |
| `form_templates` | **12 of 12 rows** | 4 policies (SELECT/INSERT/UPDATE/DELETE, same `066_fix...` migration) | Funder portal form field mappings, login-requirement flags |

Verified directly (not just via the count probe) for `organizational_digital_twins` and
`opportunity_probability_scores`: a plain unauthenticated `GET .../rest/v1/organizational_digital_twins?select=*&limit=2`
returns full JSON rows with real `organization_id` values, while the identical call against
`organizations` correctly returns `[]`. `organizational_digital_twins`'s live row also has **both**
an `org_id` column (currently `null`) and an `organization_id` column (populated) — physical evidence
that both migration tracks' `CREATE TABLE IF NOT EXISTS` statements landed on the same live table.

### 3b. Tables with no RLS-enable statement found in any migration, confirmed open live

| Table | Anon reads | Notes |
|---|---|---|
| `platform_admins` | **1 of 1 rows** | Registry of platform super-admin users — `email`, `full_name`, `permissions`. An unauthenticated client can currently enumerate platform super-admins. Highest-severity single finding in this audit. |
| `request_profiles` | **1 of 1 rows** | Per project memory, this table was believed **not to exist live** as of 2026-07-28 ("migration 051 never applied, no DDL path found"). It exists now — a change since that memory was written — and it's anon-readable. |
| `donor_discovery_directory` | **133,815 of 133,815 rows** | Full corporate/donor prospect directory. Schema doc lists this as `org_id NOT NULL — Discovering org (tenant-scoped)`, i.e. designed to be scoped, though project memory elsewhere describes a "shared-pool" model for sibling table `corporate_prospects` — worth a product decision on intent, not just a bug fix. |
| `intelligence_funded_proposals` | 3,169 of 3,169 | Documented as a shared corpus (no org column) — likely intentional |
| `donor_discovery_taxonomy` | 1,345 of 1,345 | Shared NAICS reference data — likely intentional |
| `intelligence_proposal_sections` | 105 of 105 | Child of `intelligence_funded_proposals` — likely intentional (same shared corpus) |
| `knowledge_patterns` | 30 of 30 | Documented as shared aggregated patterns, no org column — likely intentional |
| `intelligence_budget_patterns` | 5 of 5 | Shared reference content — likely intentional |
| `worker_status` | 2 of 2 | Internal worker heartbeat/ops status — minor infra info leak, not tenant data |
| `intelligence_scoring_rubrics` | 1 of 1 | Shared reference content — likely intentional |
| `foundation_profiles` | 1 of 1 | Computed foundation analytics, no org column — likely intentional |

"Likely intentional" above means: the table has no `organization_id`/`org_id` column in its documented
schema and is described elsewhere as shared/platform-level reference content, so open-read may be a
deliberate design choice rather than a gap. It is flagged anyway because that decision does not
appear to have been made explicitly anywhere (no migration grants public SELECT on any of these; they
are just never-RLS'd tables that happen to be non-sensitive) — worth a one-line confirmation rather
than an assumption.

### 3c. Confirmed anon-readable, inconclusive exact scope (large tables, `COUNT(*)` timed out)

`nonprofits` and `foundation_directory` both returned `500 canceling statement due to statement
timeout` on the exact-count probe (they're large — target 1.8M and current 133,812 rows
respectively), but a lighter `?select=id&limit=1` call succeeded for both as anon, returning real row
data. Both are documented as shared/platform-level tables with no org column, so open-read is very
likely intentional/by-design — flagged for completeness, not as a probable gap.

### 3d. One unexplained anomaly worth a live look

`donor_discovery_taxonomy_aliases` has **no RLS-enable statement in its migration** (`075_donor_discovery_taxonomy_aliases.sql`
creates the table with no `ALTER TABLE ... ROW LEVEL SECURITY` and no policy at all — identical
situation to its sibling `donor_discovery_taxonomy`, which is fully open per §3b) — yet empirically
anon gets **0 of 6,157 rows**, correctly blocked. No `GRANT`/`REVOKE` statement targeting this table
exists in any migration either (the only `GRANT`/`REVOKE` in the entire migration tree is in
`002_register_organization.sql`, unrelated). This is the one case in the whole audit where live
behavior is *more* restrictive than migration source would predict, with no found explanation. Most
likely explanation: RLS was enabled directly against the live database (Studio or Management API)
outside any tracked migration — consistent with this project's known practice — but that's inference,
not confirmed. Worth a `pg_policies` check specifically on this table once real SQL access exists,
if only to understand what's protecting it so the same thing can be applied to its wide-open sibling.

---

## 4. Storage buckets

| Bucket | `public` flag | Anon `LIST objects` | Explicit `storage.objects` policy found in migrations |
|---|---|---|---|
| `nofa-pdfs` | **true** | 200, 1 object visible | Yes — `044_nofa_pdfs_bucket.sql`: `nofa_pdfs_public_read` (SELECT), `nofa_pdfs_authenticated_insert` (INSERT), `nofa_pdfs_authenticated_update` (UPDATE). Public read is by design for this bucket (public NOFA PDFs). |
| `documents` | false | 200, 0 objects | **None found in any migration** |
| `autoapply-screenshots` | false | 200, 0 objects | **None found in any migration** |
| `org-documents` | false | 200, 0 objects | **None found in any migration** |
| `session-recordings` | false | 200, 0 objects | **None found in any migration** |
| `org-b1ab7402-dfc2-4712-869f-70ea3566cc1d` | false | 200, 0 objects | **None found in any migration** — bucket name is a literal org UUID; looks like a one-off per-org bucket created outside the shared `org-documents` bucket pattern (created 2026-07-28, recent). Worth confirming this was intentional and not a stray artifact. |

Every non-public bucket currently has **zero files**, so the anon `LIST` calls all returned `200`
with empty arrays — which is exactly what a correctly-locked-down bucket looks like, but is
*indistinguishable* from an open bucket that simply has nothing in it yet. `storage.objects` has RLS
enabled by default in every Supabase project with zero policies out of the box (default-deny), and no
migration in this repo grants any policy on `documents`, `autoapply-screenshots`, `org-documents`, or
`session-recordings` — so the *source-only* read is that these should currently be closed. But this
project's own history includes a same-session incident on exactly the `documents` bucket's
`storage.objects` policy, and per §1 this project also makes live storage/DB changes outside tracked
migrations — so "no policy in source" is not the same as "confirmed closed live." This could not be
resolved further without either uploading a real test file (a write, out of scope here) or direct
`pg_policies`/Storage API admin access to `storage.objects` for these specific buckets.

---

## 5. Full per-table matrix (all 153 live tables)

Columns: migration-source RLS status (declared intent, per §1); active policies found and which
commands they cover; live anon-key probe result (`anon rows / service-role rows` — `service-role`
always bypasses RLS so this is the true total). **Bold `OPEN`** = anon reads the same count as
service-role, i.e. fully unfiltered live exposure, cross-referenced in §3 above.

| Table | Migration-source RLS status | Policies (commands) | Live anon-key probe |
|---|---|---|---|
| `adapter_usage_log` | no ENABLE RLS found in any migration | — (0) | blocked (0/0) |
| `agent_configurations` | RLS enabled + policies | ALL(implicit) (1) | blocked (0/0) |
| `agent_decisions` | RLS enabled + policies | ALL(implicit) (1) | blocked (0/0) |
| `agent_performance_metrics` | no ENABLE RLS found in any migration | — (0) | blocked (0/0) |
| `agent_queue` | RLS enabled + policies | ALL(implicit) (1) | blocked (0/0) |
| `agent_registry` | no ENABLE RLS found in any migration | — (0) | blocked (0/0) |
| `agent_runs` | RLS enabled + policies | ALL(implicit) (1) | blocked (0/263) |
| `ai_usage_log` | no ENABLE RLS found in any migration | — (0) | blocked (0/0) |
| `alerts` | RLS enabled + policies | ALL(implicit) (1) | blocked (0/23) |
| `application_documents` | RLS enabled + policies | ALL(implicit) (1) | blocked (0/0) |
| `applications` | RLS enabled + policies | ALL(implicit) (1) | blocked (0/7) |
| `audit_logs` | RLS enabled + policies | ALL(implicit), SELECT, INSERT (3) | blocked (0/210) |
| `auto_queue_config` | RLS enabled + policies | ALL(implicit) (1) | blocked (0/0) |
| `autoapply_follow_ups` | RLS enabled + policies | SELECT, INSERT, UPDATE (3) | blocked (0/0) |
| `autoapply_review_queue` | RLS enabled + policies | SELECT, INSERT, UPDATE (3) | blocked (0/0) |
| `autoapply_screenshots` | RLS enabled + policies | SELECT, INSERT (2) | blocked (0/0) |
| `autoapply_submissions` | RLS enabled + policies | SELECT, INSERT, UPDATE, DELETE (4) | **OPEN (1/1)** |
| `automation_notifications` | RLS enabled + policies | ALL(implicit) (1) | blocked (0/0) |
| `automation_queue` | RLS enabled + policies | ALL(implicit) (1) | blocked (0/0) |
| `automation_screenshots` | RLS enabled + policies | ALL(implicit), SELECT, INSERT (3) | blocked (0/1) |
| `automation_sessions` | RLS enabled + policies | ALL(implicit) (1) | blocked (0/1) |
| `automation_steps` | RLS enabled + policies | ALL(implicit), SELECT, INSERT (3) | blocked (0/3) |
| `autonomous_triggers` | RLS enabled + policies | ALL(implicit) (1) | blocked (0/0) |
| `board_members` | RLS enabled + policies | ALL(implicit) (1) | blocked (0/8) |
| `calendar_connections` | RLS enabled + policies | ALL(implicit) (1) | blocked (0/0) |
| `calendar_events` | RLS enabled + policies | ALL(implicit) (1) | blocked (0/0) |
| `campaign_sends` | RLS enabled + policies | ALL(implicit) (1) | blocked (0/1) |
| `campaign_steps` | RLS enabled + policies | ALL(implicit) (1) | blocked (0/2) |
| `community_foundation_registry` | no ENABLE RLS found in any migration | — (0) | blocked (0/0) |
| `community_need_signals` | RLS enabled + policies | ALL(implicit) (1) | blocked (0/0) |
| `competitor_tracking` | RLS enabled + policies | ALL(implicit) (1) | blocked (0/0) |
| `contacts` | RLS enabled + policies | ALL(implicit) (1) | blocked (0/5) |
| `corporate_giving_targets` | no ENABLE RLS found in any migration | — (0) | blocked (0/0) |
| `corporate_intent_signals` | RLS enabled + policies | ALL(implicit) (1) | blocked (0/0) |
| `corporate_relationships` | no CREATE TABLE found in any migration | — (0) | blocked (0/0) |
| `cross_client_submissions` | no ENABLE RLS found in any migration | — (0) | blocked (0/0) |
| `custom_api_connections` | RLS enabled + policies | ALL(implicit) (1) | blocked (0/0) |
| `dd_api_spend` | no ENABLE RLS found in any migration | — (0) | blocked (0/0) |
| `dd_prospect_requests` | RLS enabled + policies | ALL(implicit) (1) | blocked (0/133812) |
| `dd_robots_cache` | no ENABLE RLS found in any migration | — (0) | blocked (0/0) |
| `deadlines` | RLS enabled + policies | ALL(implicit) (1) | blocked (0/47) |
| `discovery_matches` | RLS enabled + policies | ALL(implicit) (1) | blocked (0/0) |
| `discovery_runs` | RLS enabled + policies | ALL(implicit) (1) | blocked (0/0) |
| `documents` | RLS enabled + policies | ALL(implicit) (1) | blocked (0/5) |
| `donor_discovery_connectors` | RLS enabled + policies | ALL(implicit) (1) | blocked (0/0) |
| `donor_discovery_directory` | no ENABLE RLS found in any migration | — (0) | **OPEN (133815/133815)** |
| `donor_discovery_geocache` | no ENABLE RLS found in any migration | — (0) | blocked (0/0) |
| `donor_discovery_prospects` | RLS enabled + policies | ALL(implicit) (1) | blocked (0/133812) |
| `donor_discovery_requests` | RLS enabled + policies | ALL(implicit) (1) | blocked (0/1) |
| `donor_discovery_taxonomy` | no ENABLE RLS found in any migration | — (0) | **OPEN (1345/1345)** |
| `donor_discovery_taxonomy_aliases` | no ENABLE RLS found in any migration | — (0) | blocked (0/6157) |
| `donor_discovery_tos_registry` | no ENABLE RLS found in any migration | — (0) | blocked (0/0) |
| `draft_automation_config` | RLS enabled + policies | ALL(implicit) (1) | blocked (0/1) |
| `draft_queue` | RLS enabled + policies | ALL(implicit) (1) | blocked (0/0) |
| `draft_versions` | RLS enabled + policies | ALL(implicit) (1) | blocked (0/25) |
| `email_activity` | RLS enabled + policies | ALL(implicit) (1) | blocked (0/0) |
| `email_campaign_sequences` | RLS enabled + policies | ALL(implicit) (1) | blocked (0/0) |
| `email_campaigns` | RLS enabled + policies | ALL(implicit) (1) | blocked (0/1) |
| `email_connections` | RLS enabled + policies | ALL(implicit) (1) | blocked (0/0) |
| `email_sequence_enrollments` | RLS enabled + policies | ALL(implicit) (1) | blocked (0/0) |
| `email_sequence_steps` | RLS enabled + policies | ALL(implicit) (1) | blocked (0/0) |
| `email_templates` | RLS enabled + policies | ALL(implicit) (1) | blocked (0/0) |
| `email_thread_links` | RLS enabled + policies | ALL(implicit) (1) | blocked (0/0) |
| `enrichment_jobs` | no ENABLE RLS found in any migration | — (0) | blocked (0/0) |
| `enrichment_results` | no ENABLE RLS found in any migration | — (0) | blocked (0/0) |
| `form_templates` | RLS enabled + policies | SELECT, INSERT, UPDATE, DELETE (4) | **OPEN (12/12)** |
| `foundation_directory` | no ENABLE RLS found in any migration | — (0) | inconclusive (COUNT timeout — large table) |
| `foundation_profiles` | no ENABLE RLS found in any migration | — (0) | **OPEN (1/1)** |
| `fundability_deficiencies` | no CREATE TABLE found in any migration | — (0) | blocked (0/0) |
| `fundability_scores` | RLS enabled + policies | ALL(implicit) (1) | blocked (0/0) |
| `funder_credentials` | RLS enabled + policies | SELECT, INSERT, UPDATE, DELETE (4) | blocked (0/0) |
| `funder_giving_history` | RLS enabled + policies | ALL(implicit) (1) | blocked (0/0) |
| `funder_intelligence` | RLS enabled + policies | ALL(implicit) (1) | blocked (0/0) |
| `funder_relationship_events` | RLS enabled + policies | ALL(implicit) (1) | blocked (0/0) |
| `funder_relationship_scores` | RLS enabled + policies | ALL(implicit) (1) | blocked (0/0) |
| `funders` | RLS enabled + policies | ALL(implicit) (1) | blocked (0/27) |
| `grant_agreements` | no ENABLE RLS found in any migration | — (0) | blocked (0/0) |
| `historical_awards` | RLS enabled + policies | ALL(implicit) (1) | blocked (0/0) |
| `impersonation_log` | no ENABLE RLS found in any migration | — (0) | blocked (0/0) |
| `improvement_proposals` | no ENABLE RLS found in any migration | — (0) | blocked (0/0) |
| `integration_keys` | RLS enabled + policies | ALL(implicit) (1) | blocked (0/0) |
| `integrations` | RLS enabled + policies | ALL(implicit) (1) | blocked (0/0) |
| `intelligence_budget_patterns` | no ENABLE RLS found in any migration | — (0) | **OPEN (5/5)** |
| `intelligence_budget_templates` | no ENABLE RLS found in any migration | — (0) | blocked (0/0) |
| `intelligence_evaluation_frameworks` | no ENABLE RLS found in any migration | — (0) | blocked (0/0) |
| `intelligence_funded_proposals` | no ENABLE RLS found in any migration | — (0) | **OPEN (3169/3169)** |
| `intelligence_grant_dna_scores` | no ENABLE RLS found in any migration | — (0) | blocked (0/0) |
| `intelligence_grantmaker_profiles` | no ENABLE RLS found in any migration | — (0) | blocked (0/0) |
| `intelligence_logic_models` | no ENABLE RLS found in any migration | — (0) | blocked (0/0) |
| `intelligence_narrative_patterns` | no ENABLE RLS found in any migration | — (0) | blocked (0/0) |
| `intelligence_need_data` | no ENABLE RLS found in any migration | — (0) | blocked (0/0) |
| `intelligence_post_award_reports` | no ENABLE RLS found in any migration | — (0) | blocked (0/0) |
| `intelligence_proposal_sections` | no ENABLE RLS found in any migration | — (0) | **OPEN (105/105)** |
| `intelligence_scoring_rubrics` | no ENABLE RLS found in any migration | — (0) | **OPEN (1/1)** |
| `invoices` | RLS enabled + policies | ALL(implicit) (1) | blocked (0/0) |
| `kb_extended_needs` | no ENABLE RLS found in any migration | — (0) | blocked (0/0) |
| `knowledge_base` | RLS enabled + policies | ALL(implicit) (1) | blocked (0/53) |
| `knowledge_patterns` | no ENABLE RLS found in any migration | — (0) | **OPEN (30/30)** |
| `knowledge_queries` | RLS enabled + policies | ALL(implicit) (1) | blocked (0/0) |
| `nonprofits` | no ENABLE RLS found in any migration | — (0) | inconclusive (COUNT timeout — large table) |
| `notes` | RLS enabled + policies | ALL(implicit) (1) | blocked (0/1) |
| `onboarding_steps` | RLS enabled + policies | ALL(implicit) (1) | blocked (0/0) |
| `opportunities` | RLS enabled + policies | ALL(implicit) (1) | blocked (0/1005) |
| `opportunity_keywords` | RLS enabled + policies | ALL(implicit) (1) | blocked (0/8) |
| `opportunity_probability_scores` | RLS enabled + policies | ALL(implicit) (1) | **OPEN (995/995)** |
| `org_autonomous_config` | RLS enabled + policies | ALL(implicit) (1) | blocked (0/74) |
| `org_documents` | no ENABLE RLS found in any migration | — (0) | blocked (0/0) |
| `org_learning_contributions` | no CREATE TABLE found in any migration | — (0) | blocked (0/0) |
| `org_usage_summary` | RLS enabled + policies | ALL(implicit) (1) | blocked (0/0) |
| `organizational_digital_twins` | RLS enabled + policies | ALL(implicit), ALL(implicit) (2) | **OPEN (10/10)** |
| `organizations` | RLS enabled + policies | ALL(implicit) (1) | blocked (0/88) |
| `outcomes` | RLS enabled + policies | ALL(implicit) (1) | blocked (0/3) |
| `outreach_contacts` | RLS enabled + policies | ALL(implicit) (1) | blocked (0/1) |
| `pipeline_history` | RLS enabled + policies | ALL(implicit) (1) | blocked (0/10) |
| `pitch_cache` | no ENABLE RLS found in any migration | — (0) | blocked (0/0) |
| `platform_admins` | no ENABLE RLS found in any migration | — (0) | **OPEN (1/1)** |
| `platform_config` | RLS enabled + policies | ALL(implicit) (1) | blocked (0/890) |
| `platform_learning_patterns` | no ENABLE RLS found in any migration | — (0) | blocked (0/0) |
| `platform_tasks` | no ENABLE RLS found in any migration | — (0) | blocked (0/0) |
| `profiles` | RLS enabled + policies | ALL(implicit) (1) | blocked (0/72) |
| `programs` | RLS enabled + policies | ALL(implicit) (1) | blocked (0/11) |
| `prospect_lists` | no ENABLE RLS found in any migration | — (0) | blocked (0/0) |
| `prospects` | no ENABLE RLS found in any migration | — (0) | blocked (0/0) |
| `proven_narratives` | RLS enabled + policies | ALL(implicit) (1) | blocked (0/2) |
| `renewals` | RLS enabled + policies | ALL(implicit) (1) | blocked (0/0) |
| `request_profiles` | no ENABLE RLS found in any migration | — (0) | **OPEN (1/1)** |
| `research_cache` | RLS enabled + policies | ALL(implicit) (1) | blocked (0/0) |
| `roi_insights` | RLS enabled + policies | ALL(implicit) (1) | blocked (0/0) |
| `sales_campaign_steps` | no ENABLE RLS found in any migration | — (0) | blocked (0/0) |
| `sales_campaigns` | no ENABLE RLS found in any migration | — (0) | blocked (0/0) |
| `sales_sends` | no ENABLE RLS found in any migration | — (0) | blocked (0/0) |
| `scraping_targets` | RLS enabled + policies | ALL(implicit) (1) | blocked (0/0) |
| `search_profiles` | RLS enabled + policies | ALL(implicit) (1) | blocked (0/2) |
| `sending_domains` | no ENABLE RLS found in any migration | — (0) | blocked (0/0) |
| `simulation_scenarios` | RLS enabled + policies | ALL(implicit) (1) | blocked (0/0) |
| `solicitation_registrations` | RLS enabled + policies | SELECT, INSERT, UPDATE (3) | blocked (0/0) |
| `strategic_recommendations` | RLS enabled + policies | ALL(implicit) (1) | blocked (0/0) |
| `submission_queue` | RLS enabled + policies | SELECT, INSERT, UPDATE, DELETE (4) | **OPEN (1/1)** |
| `submission_receipts` | no ENABLE RLS found in any migration | — (0) | blocked (0/0) |
| `submission_variables` | RLS enabled + policies | ALL(implicit) (1) | blocked (0/0) |
| `subscriptions` | RLS enabled + policies | ALL(implicit) (1) | blocked (0/2) |
| `success_probability_scores` | RLS enabled + policies | ALL(implicit) (1) | blocked (0/0) |
| `suppression_list` | no ENABLE RLS found in any migration | — (0) | blocked (0/0) |
| `synced_email_messages` | RLS enabled + policies | ALL(implicit) (1) | blocked (0/0) |
| `synced_email_threads` | RLS enabled + policies | ALL(implicit) (1) | blocked (0/0) |
| `system_errors` | no ENABLE RLS found in any migration | — (0) | blocked (0/0) |
| `team_activity_log` | RLS enabled + policies | ALL(implicit) (1) | blocked (0/0) |
| `usage_metrics` | RLS enabled + policies | ALL(implicit) (1) | blocked (0/22) |
| `usage_tracking` | RLS enabled + policies | SELECT, INSERT, UPDATE (3) | blocked (0/2) |
| `user_invitations` | RLS enabled + policies | ALL(implicit) (1) | blocked (0/0) |
| `validations` | RLS enabled + policies | ALL(implicit) (1) | blocked (0/3) |
| `webhook_configs` | RLS enabled + policies | ALL(implicit) (1) | blocked (0/0) |
| `worker_status` | no ENABLE RLS found in any migration | — (0) | **OPEN (2/2)** |

---

## 6. Tables documented in a migration file but not present in the live schema (46)

Cross-check, not the focus of this audit, but relevant context: these table names appear in
`CREATE TABLE` statements somewhere in the migration tree but do not exist in the live PostgREST
schema at all — so RLS is moot for them (nothing to secure). This list closely matches (and
independently reproduces) the drift table already documented in `SCHEMA_REGISTRY_v2.md`'s July 19
live-database audit, which is a good cross-validation that this session's migration scan is sound.

| Table (found in migration source) | Notes |
|---|---|
| `ab_test_variants` | Documented in a migration file; not present in the live PostgREST schema as of this audit |
| `application_followups` | Documented in a migration file; not present in the live PostgREST schema as of this audit |
| `board_meeting_packets` | Documented in a migration file; not present in the live PostgREST schema as of this audit |
| `board_meetings` | Documented in a migration file; not present in the live PostgREST schema as of this audit |
| `compliance_events` | Documented in a migration file; not present in the live PostgREST schema as of this audit |
| `compliance_requirements` | Documented in a migration file; not present in the live PostgREST schema as of this audit |
| `consultant_client_access` | Documented in a migration file; not present in the live PostgREST schema as of this audit |
| `corporate_monitoring_events` | Documented in a migration file; not present in the live PostgREST schema as of this audit |
| `corporate_prospects` | Documented in a migration file; not present in the live PostgREST schema as of this audit |
| `deadline_predictions` | Documented in a migration file; not present in the live PostgREST schema as of this audit |
| `digest_item_log` | Documented in a migration file; not present in the live PostgREST schema as of this audit |
| `digest_priority_weights` | Documented in a migration file; not present in the live PostgREST schema as of this audit |
| `disaster_declarations` | Documented in a migration file; not present in the live PostgREST schema as of this audit |
| `disaster_emergency_funds` | Documented in a migration file; not present in the live PostgREST schema as of this audit |
| `email_messages` | Documented in a migration file; not present in the live PostgREST schema as of this audit |
| `email_threads` | Documented in a migration file; not present in the live PostgREST schema as of this audit |
| `followup_enrollments` | Documented in a migration file; not present in the live PostgREST schema as of this audit |
| `followup_sequences` | Documented in a migration file; not present in the live PostgREST schema as of this audit |
| `funder_relationships` | Documented in a migration file; not present in the live PostgREST schema as of this audit |
| `funding_forecasts` | Documented in a migration file; not present in the live PostgREST schema as of this audit |
| `funding_sources` | Documented in a migration file; not present in the live PostgREST schema as of this audit |
| `grant_budgets` | Documented in a migration file; not present in the live PostgREST schema as of this audit |
| `grant_expenses` | Documented in a migration file; not present in the live PostgREST schema as of this audit |
| `grant_reconciliation_reports` | Documented in a migration file; not present in the live PostgREST schema as of this audit |
| `impact_simulations` | Documented in a migration file; not present in the live PostgREST schema as of this audit |
| `notification_preferences` | Documented in a migration file; not present in the live PostgREST schema as of this audit |
| `org_portal_accounts` | Documented in a migration file; not present in the live PostgREST schema as of this audit |
| `org_settings` | Documented in a migration file; not present in the live PostgREST schema as of this audit |
| `outreach_templates` | Documented in a migration file; not present in the live PostgREST schema as of this audit |
| `pig_edges` | Documented in a migration file; not present in the live PostgREST schema as of this audit |
| `pig_nodes` | Documented in a migration file; not present in the live PostgREST schema as of this audit |
| `queue_controls` | Documented in a migration file; not present in the live PostgREST schema as of this audit |
| `relationship_memory` | Documented in a migration file; not present in the live PostgREST schema as of this audit |
| `relationship_recommendations` | Documented in a migration file; not present in the live PostgREST schema as of this audit |
| `reputation_alerts` | Documented in a migration file; not present in the live PostgREST schema as of this audit |
| `reputation_signals` | Documented in a migration file; not present in the live PostgREST schema as of this audit |
| `schoolfunder_donations` | Documented in a migration file; not present in the live PostgREST schema as of this audit |
| `schoolfunder_students` | Documented in a migration file; not present in the live PostgREST schema as of this audit |
| `schoolfunder_volunteer_hours` | Documented in a migration file; not present in the live PostgREST schema as of this audit |
| `scrape_jobs` | Documented in a migration file; not present in the live PostgREST schema as of this audit |
| `scrape_results` | Documented in a migration file; not present in the live PostgREST schema as of this audit |
| `session_recordings` | Documented in a migration file; not present in the live PostgREST schema as of this audit |
| `storage` | Documented in a migration file; not present in the live PostgREST schema as of this audit |
| `stripe_webhook_events` | Documented in a migration file; not present in the live PostgREST schema as of this audit |
| `submission_usage` | Documented in a migration file; not present in the live PostgREST schema as of this audit |
| `tier_limits` | Documented in a migration file; not present in the live PostgREST schema as of this audit |

---

## 7. What this audit could not do, and what would close the gap

1. **No `pg_policies` access.** Everything above is inferred from migration source text plus live
   *behavioral* probing (anon-key reads). It is not a substitute for the actual policy catalog. Get
   either the claude.ai Supabase MCP connector authorized for project `vbjplpquqxxfbpazyalt`, or a
   fresh Management API PAT (the one in BLUEPRINT_v2.md §8.3 is dead — confirmed both by memory and
   independently by this session), and re-run: `SELECT schemaname, tablename, relrowsecurity,
   relforcerowsecurity FROM pg_tables JOIN pg_class ON ...` plus `SELECT * FROM pg_policies`. That
   single pass would upgrade every "source-inferred" line in §5 to "confirmed," and would resolve the
   `donor_discovery_taxonomy_aliases` anomaly in §3d and the "RLS enabled, zero policies" question in
   §2 definitively.
2. **The existing authenticated cross-org leak test wasn't re-run.** `src/__tests__/integration/rls.test.ts`
   already does real authenticated two-org SELECT/INSERT/UPDATE leak testing for every table with an
   `organization_id`/`org_id` column, live. It mutates production (creates/deletes test orgs, users,
   rows), so this audit didn't run it without sign-off. Project memory's most recent number (24 of
   100 org-scoped tables leak cross-org SELECT, dated today) is real but not reproduced or given
   per-table names here — running it fresh and merging its per-table output into §5 would close the
   biggest remaining blind spot (this audit's anon probe cannot see a policy that correctly blocks
   anon but still leaks between two authenticated orgs).
3. **Two tables (`nonprofits`, `foundation_directory`) couldn't get an exact anon row count** — the
   `COUNT(*)` timed out on their scale. Confirmed anon-readable via a lighter query; exact behavior
   (e.g. whether a specific row can be targeted vs just existence) wasn't fully probed.
4. **Non-public storage buckets are all currently empty**, so the `storage.objects` anon-list test in
   §4 can't distinguish "correctly locked" from "open but nothing to leak yet" for `documents`,
   `autoapply-screenshots`, `org-documents`, and `session-recordings`. Direct policy inspection (or a
   deliberate, approved test upload + anon read-back) would resolve this.
