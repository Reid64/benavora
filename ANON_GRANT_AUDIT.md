# Benavora — Full-Schema `anon`-Grant Exposure Audit

## Status: PARTIALLY REMEDIATED — see §8 for exactly what changed and what's still open.
## Date: August 3, 2026 (discovery pass); remediation pass same day, second session.
## Scope: All 162 real tables (`pg_class.relkind = 'r'`) live in the `public` schema, production project `vbjplpquqxxfbpazyalt`, queried directly via `DATABASE_URL`.

---

## 8. Remediation status (second pass, same day)

**12 of 162 tables are now fully secured** (RLS enabled, `anon` grants fully revoked, correct
`authenticated` policy applied, verified live against real query shapes from actual app code — same
discipline as the original `foundation_directory`/`corporate_prospects` fixes):

| Table | Fix | Migration | Policy shape |
|---|---|---|---|
| `corporate_prospects` | (prior session) | `111` | No `authenticated` policy — no real read path exists |
| `foundation_directory` | (prior session) | `112` | `authenticated`-only shared read |
| `nonprofits` | 1.98M rows, largest table in the schema | `114` | `authenticated`-only shared read |
| `form_templates` | RLS was off despite 4 correct org-scoped policies already existing in `pg_policies` (migration drift) — also closes 2 live cross-tenant IDOR call sites with no app-level tenant filter | `115` | Org-scoped (pre-existing policies, just now enforced) |
| `organizational_digital_twins` | RLS off, zero live policies despite 2 migration tracks claiming to add one | `116` | Org-scoped (new policy, most sensitive table fixed this pass — `financial_profile`/`board_composition`/`known_weaknesses`) |
| `intelligence_budget_patterns` | RLS off | `117` | `authenticated`-only shared read |
| `donor_discovery_directory` | RLS off, 133,780 rows | `118` | `authenticated`-only shared read |
| `intelligence_funded_proposals` | RLS off, 3,169 rows | `119` | `authenticated` shared read + insert (real write path via `/api/intelligence/ingest`) |
| `donor_discovery_taxonomy` | RLS off, 1,345 rows | `120` | `authenticated`-only shared read |
| `opportunity_probability_scores` | RLS off, zero live policies despite migration 093 claiming to add one — also closes a live cross-tenant leak at `opportunities/page.tsx:180` (zero app-level org filter) | `121` | Org-scoped (new policy) |
| `intelligence_proposal_sections` | RLS off, 105 rows | `122` | `authenticated` shared read + insert (real write path via `/api/intelligence/ingest`) |
| `knowledge_patterns` | RLS off, 33 rows | `123` | `authenticated`-only shared read |

**95 of 162 tables (all of former Category B) had their universal `TRUNCATE` bypass closed** in one
batch migration (`113`) — `anon`'s `TRUNCATE` grant revoked across all 95 in a single statement, since
this was identical across every one of them (this project's default-privilege pattern, not
per-table). **Not otherwise reclassified**: this pass did not re-verify each of the 95 tables'
existing `SELECT`/`INSERT`/`UPDATE`/`DELETE` policies for correctness — `RLS_POLICY_AUDIT.md`
and `rls.test.ts` already found real exceptions among them (24 of 100 org-scoped tables leak
cross-org `SELECT`), so treat these 95 as "TRUNCATE-safe" specifically, not "fully audited."
`authenticated` still holds `TRUNCATE` on all 95 — out of scope for this pass, flagged in `113`'s own
header, not touched.

**55 of 162 tables (former Category C, minus the 10 fixed above) remain completely untouched** —
RLS still disabled, fully open to `anon` for every operation. Per this task's explicit instruction,
these were deliberately left for a follow-up pass rather than designing 55 more table policies in one
prompt. Ranked by row count, the largest remaining exposures are (§5's original table, minus the 10
now fixed): `agent_configurations`, `intelligence_evaluation_frameworks`, `intelligence_grant_dna_scores`,
`intelligence_grantmaker_profiles`, `intelligence_logic_models`, `intelligence_narrative_patterns`,
`intelligence_need_data`, `intelligence_post_award_reports`, `intelligence_scoring_rubrics`,
`kb_extended_needs`, `platform_admins`, `funder_credentials`, `foundation_profiles`, `pitch_cache`,
and 41 more near-empty tables — see §5 below for the full original list (still accurate for what
remains unfixed; the 10 rows for tables now fixed are the only ones no longer current).

Every fix in this section was independently verified live, not assumed from migration success output:
`anon` tested directly at the Postgres role level (`SET LOCAL ROLE anon`) against `SELECT`,
`INSERT`, `UPDATE`, `DELETE`, and `TRUNCATE` on every one of the 9 individually-designed tables plus
a 5-table random sample of the 95 batch-fixed tables — all blocked (`42501`). `authenticated` was
tested against real query shapes copied from the actual consuming code (e.g. `intelligence_budget_
patterns`' `program_category`/`grant_type` lookup, `intelligence_funded_proposals`' real `INSERT`
path), not synthetic queries. `service_role` was confirmed unaffected on every table (full row counts
still visible, matching pre-fix counts).

---

## 0. Why this document exists (original discovery pass, unchanged below)

Two incidents this session — `corporate_prospects` (before it was created) and `foundation_directory`
(133,812 rows, found live fully open to the anon key) — traced to the same root cause: this project's
`public` schema `ALTER DEFAULT PRIVILEGES` grants every new table full
`SELECT/INSERT/UPDATE/DELETE/TRUNCATE` to both `anon` and `authenticated` automatically, and nobody
has been explicitly revoking it. `RLS_POLICY_AUDIT.md` (2026-07-30) already found 16 tables
unexpectedly readable by an unauthenticated client — but that audit tested live read behavior
table-by-table; it did not query the grant/ACL layer directly, so it could not see the
default-grant pattern itself, only one of its symptoms (readability). This document targets the
grant layer specifically, for every table, to find every instance of that pattern — not just the
ones that happen to also lack a SELECT policy.

**No fixes have been applied.** This is a discovery document only, per the task instructions.

---

## 1. Methodology

Queried live via `DATABASE_URL` (`psql` itself hit a DNS resolution quirk in this session's sandbox —
same known issue noted in prior sessions' `SESSION_STATE.md` entries — so the `pg` Node client, already
a project dependency, was used instead; read-only queries, no DDL):

- `pg_class.relrowsecurity` / `relforcerowsecurity` — is RLS actually enabled, per table.
- `information_schema.role_table_grants` — every live grant held by `anon` and `authenticated`,
  per table, per privilege type.
- `pg_policies` — every real policy: name, target role(s), command, `USING`/`WITH CHECK` expression.

A table was scored using this decision tree, applied uniformly:

- **RLS disabled** → **Category C**, regardless of current grants — matches `foundation_directory`'s
  pre-fix state exactly; the table is either already open, or one stray `GRANT` (or the schema's own
  default-privilege behavior re-asserting itself on a future `CREATE TABLE ... LIKE` or restore) away
  from being open, with nothing in the table's own definition preventing it.
- **RLS enabled, `anon` holds `TRUNCATE`** → **Category B.** This is the single most important
  finding of this audit: **`TRUNCATE` is never governed by RLS policies in Postgres** — it is
  privilege-gated only, exactly like `DROP TABLE`. A table can have flawless, fully-audited,
  org-scoped `SELECT`/`INSERT`/`UPDATE`/`DELETE` policies and still be completely truncatable by the
  `anon` key if the `TRUNCATE` grant was never revoked. This is true independent of whatever
  `RLS_POLICY_AUDIT.md` found about that table's read behavior.
- **RLS enabled, `anon` has zero grants** → **Category A** (matches `corporate_prospects`,
  `foundation_directory` post-fix).
- **RLS enabled, `anon` has grants but no policy exists for `anon`/`public`** → **Category A** in
  practice (Postgres RLS default-denies `SELECT`/`INSERT`/`UPDATE`/`DELETE` when no policy matches
  the connecting role, so the leftover grant is inert for those four operations) — but still flagged,
  since a vestigial grant is a smell and, per the `TRUNCATE` rule above, would still be a real
  bypass if `TRUNCATE` happened to be among those inert-for-CRUD grants (checked separately, see
  the `TRUNCATE` branch above, which runs first).

This audit deliberately does **not** re-verify whether each table's org-scoping policy is itself
airtight (e.g. whether `current_org_id()`/`auth.uid()` truly resolves to `NULL` for a literal
unauthenticated `anon` connection in every case) — that is `RLS_POLICY_AUDIT.md`'s question, already
partially answered there (16 tables found readable) and in the later `rls.test.ts` integration-test
finding (24 of 100 org-scoped tables leak cross-org `SELECT`). This audit is scoped to the grant layer
specifically, which neither of those prior passes queried directly.

---

## 2. Summary

**This section (§2-§7) is the original discovery-pass snapshot from earlier August 3, 2026 — counts
below are as they were BEFORE remediation. See §8 above for current status: 12 tables now fully
fixed, 95 tables' `TRUNCATE` bypass closed, 55 tables still exactly as described below.**

| Category | Count | Meaning |
|---|---|---|
| **A — properly locked down** | **2** | RLS enabled, `anon` has no exploitable grant. |
| **B — RLS enabled, `anon` grants bypass intent** | **95** | Every one of these is truncatable by the anon key via the `TRUNCATE`-ignores-RLS gap, regardless of how good their other policies are. |
| **C — RLS not enabled at all** | **65** | Fully open to `anon` for every operation, exactly like `foundation_directory` before this session's fix — no policy layer exists at all. |
| **Total** | **162** | |

**Only 2 of 162 tables (1.2%) are actually safe from `anon` right now** — and both were fixed by this
session's own prior two commits, not by any pre-existing convention in this codebase. Every other
table inherited the project's permissive default privileges and nothing ever revoked them.

**Approximate row exposure:**
- Category C (fully open, every operation): **2,119,486 rows**, dominated by `nonprofits`
  (1,980,011 rows) and `donor_discovery_directory` (133,780 rows).
- Category B (truncatable regardless of other policies): **277,646 rows**, dominated by
  `dd_prospect_requests` (133,850) and `donor_discovery_prospects` (133,828).
- Combined: **2,397,132 rows** across 160 tables sit behind either no access control at all, or
  access control that stops short of the one operation (`TRUNCATE`) capable of destroying the entire
  table in one statement.

**A secondary, unrelated-to-`anon` finding surfaced by the same query:** `automation_screenshots` and
`automation_steps` have RLS enabled with **zero policies of any kind** — meaning `authenticated`
users currently get **zero rows** from these tables too (Postgres RLS default-denies when no policy
matches, for every role, not just `anon`). This may be a functional bug (a missing org-scoping
policy that was never added) rather than a security gap — flagged here since this audit's query
surfaced it, but out of this document's scope to diagnose further.

---

## 3. Category A — properly locked down (2)

| Table | Approx. rows |
|---|---|
| `corporate_prospects` | 1 |
| `foundation_directory` | 133,812 |

Both fixed this session (migrations 111, 112): RLS enabled, `anon` grants explicitly revoked,
`authenticated` given only the precise access the real app code needs (none for
`corporate_prospects`; read-only for `foundation_directory`). These are the only two tables in the
entire `public` schema where this was done deliberately — every other table below still carries
whatever the project's default privileges assigned it, unexamined.

---

## 4. Category B — RLS enabled, but `anon` grants bypass intent (95)

**Every single row below holds the identical `anon` grant set:
`DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE`** — this is not per-table
configuration, it is the same default-privilege stamp applied uniformly at table-creation time.
`TRUNCATE` is the operative bypass in every case, since RLS policies do not govern it.

**A closer read of the policies themselves, for context (not the focus of this document, but
material to how urgently each should be treated):**
- **90 of 95** have a real `PERMISSIVE` policy scoped to `{public}` (which covers `anon` and
  `authenticated` both) using an `organization_id = current_org_id()`-style condition, or a
  `service_role`-only policy (`donor_discovery_taxonomy_aliases`) — meaning `SELECT`/`INSERT`/
  `UPDATE`/`DELETE` are *probably* practically blocked for a literal unauthenticated `anon` caller
  (an unauthenticated connection has no `auth.uid()`, so the org match should fail closed) — **not
  independently re-verified live per-table this session**, and `RLS_POLICY_AUDIT.md`/`rls.test.ts`
  already found real exceptions to this assumption elsewhere in the schema, so treat "probably fine
  for CRUD" as provisional, not confirmed, for any specific table here.
- **3 of 95** (`automation_screenshots`, `automation_steps`, and `corporate_prospects` — the last is
  Category A, listed here only because it shares the zero-policy shape) have **no policy at all**,
  meaning CRUD is fully default-denied for every role including `authenticated`.
- Regardless of which of the above applies to a given table, **all 95 remain truncatable by `anon`
  today.**

| Table | Approx. rows | Table | Approx. rows |
|---|---|---|---|
| `agent_decisions` | 95 | `notes` | 1 |
| `agent_queue` | 22 | `onboarding_steps` | 1 |
| `agent_runs` | 922 | `opportunities` | 1,035 |
| `alerts` | 24 | `opportunity_keywords` | 8 |
| `application_documents` | 0 | `org_autonomous_config` | 74 |
| `applications` | 7 | `org_documents` | 1 |
| `audit_logs` | 213 | `org_usage_summary` | 1 |
| `autoapply_follow_ups` | 0 | `organizations` | 91 |
| `automation_notifications` | 1 | `outcomes` | 3 |
| `automation_queue` | 1 | `outreach_contacts` | 1 |
| `automation_screenshots` | 1 | `pig_edges` | 20 |
| `automation_sessions` | 1 | `pig_nodes` | 21 |
| `automation_steps` | 3 | `pipeline_history` | 10 |
| `autonomous_triggers` | 1 | `platform_config` | 920 |
| `board_meeting_packets` | 0 | `profiles` | 72 |
| `board_meetings` | 0 | `programs` | 11 |
| `board_members` | 8 | `proven_narratives` | 2 |
| `calendar_connections` | 0 | `renewals` | 0 |
| `calendar_events` | 1 | `request_profiles` | 1 |
| `campaign_sends` | 1 | `research_cache` | 1 |
| `campaign_steps` | 2 | `roi_insights` | 1 |
| `community_need_signals` | 1 | `scraping_targets` | 1 |
| `competitor_tracking` | 1 | `search_profiles` | 2 |
| `contacts` | 5 | `simulation_scenarios` | 0 |
| `corporate_intent_signals` | 1 | `strategic_recommendations` | 0 |
| `corporate_monitoring_events` | 0 | `submission_variables` | 1 |
| `corporate_relationships` | 1 | `subscriptions` | 2 |
| `custom_api_connections` | 1 | `success_probability_scores` | 1 |
| `dd_prospect_requests` | 133,850 | `synced_email_messages` | 1 |
| `deadlines` | 47 | `synced_email_threads` | 1 |
| `documents` | 8 | `team_activity_log` | 1 |
| `donor_discovery_connectors` | 1 | `usage_metrics` | 24 |
| `donor_discovery_prospects` | 133,828 | `usage_tracking` | 2 |
| `donor_discovery_requests` | 1 | `user_invitations` | 0 |
| `donor_discovery_taxonomy_aliases` | 6,157 | `validations` | 3 |
| `draft_automation_config` | 1 | `email_sequence_steps` | 0 |
| `draft_queue` | 0 | `email_templates` | 1 |
| `draft_versions` | 25 | `email_thread_links` | 1 |
| `email_activity` | 1 | `fundability_scores` | 1 |
| `email_campaign_sequences` | 0 | `funder_dna_profiles` | 0 |
| `email_campaigns` | 1 | `funder_giving_history` | 1 |
| `email_connections` | 1 | `funder_intelligence` | 0 |
| `email_sequence_enrollments` | 1 | `funder_relationship_events` | 0 |
| `funder_relationship_scores` | 1 | `funders` | 27 |
| `funding_forecasts` | 4 | `historical_awards` | 1 |
| `impact_simulations` | 4 | `integration_keys` | 1 |
| `integrations` | 1 | `invoices` | 1 |
| `knowledge_base` | 53 | | |

(95 tables total; two-column layout above for density, alphabetical within each column.)

---

## 5. Category C — RLS not enabled at all (65)

Fully open to `anon` for every operation — `SELECT`, `INSERT`, `UPDATE`, `DELETE`, `TRUNCATE` — with
no policy layer of any kind. This is exactly `foundation_directory`'s pre-fix state, replicated
across 65 more tables, three of which carry real production data at meaningful scale:
`nonprofits` (1,980,011 rows — by far the single largest exposure in the schema), `donor_discovery_directory`
(133,780 rows), and `intelligence_funded_proposals` (3,169 rows). Most of the remainder are
currently near-empty (0-1 rows) but are exactly as structurally open as `foundation_directory` was —
row count is a measure of current blast radius, not of risk, since any of these could accumulate real
data at any time with zero additional migration required to become exploitable.

| Table | Approx. rows | Table | Approx. rows |
|---|---|---|---|
| `adapter_usage_log` | 1 | `intelligence_narrative_patterns` | 0 |
| `agent_configurations` | 1 | `intelligence_need_data` | 0 |
| `agent_performance_metrics` | 0 | `intelligence_post_award_reports` | 0 |
| `agent_registry` | 0 | `intelligence_proposal_sections` | 105 |
| `ai_usage_log` | 0 | `intelligence_scoring_rubrics` | 1 |
| `auto_queue_config` | 0 | `kb_extended_needs` | 1 |
| `autoapply_review_queue` | 1 | `knowledge_patterns` | 33 |
| `autoapply_screenshots` | 0 | `knowledge_queries` | 0 |
| `autoapply_submissions` | 1 | `nonprofits` | **1,980,011** |
| `community_foundation_registry` | 0 | `opportunity_probability_scores` | 995 |
| `corporate_giving_targets` | 0 | `org_learning_contributions` | 1 |
| `cross_client_submissions` | 0 | `organizational_digital_twins` | 10 |
| `dd_api_spend` | 0 | `pitch_cache` | 1 |
| `dd_robots_cache` | 0 | `platform_admins` | 1 |
| `discovery_matches` | 1 | `platform_learning_patterns` | 0 |
| `discovery_runs` | 0 | `platform_tasks` | 0 |
| `donor_discovery_directory` | 133,780 | `prospect_lists` | 0 |
| `donor_discovery_geocache` | 0 | `prospects` | 0 |
| `donor_discovery_taxonomy` | 1,345 | `sales_campaign_steps` | 0 |
| `donor_discovery_tos_registry` | 0 | `sales_campaigns` | 0 |
| `enrichment_jobs` | 1 | `sales_sends` | 0 |
| `enrichment_results` | 0 | `sending_domains` | 0 |
| `form_templates` | 12 | `solicitation_registrations` | 1 |
| `foundation_profiles` | 1 | `submission_queue` | 1 |
| `fundability_deficiencies` | 0 | `submission_receipts` | 1 |
| `funder_credentials` | 1 | `suppression_list` | 0 |
| `grant_agreements` | 1 | `system_errors` | 1 |
| `impersonation_log` | 0 | `webhook_configs` | 1 |
| `improvement_proposals` | 0 | `worker_status` | 2 |
| `intelligence_budget_patterns` | 5 | | |
| `intelligence_budget_templates` | 0 | | |
| `intelligence_evaluation_frameworks` | 0 | | |
| `intelligence_funded_proposals` | 3,169 | | |
| `intelligence_grant_dna_scores` | 0 | | |
| `intelligence_grantmaker_profiles` | 0 | | |
| `intelligence_logic_models` | 0 | | |

(65 tables total; two-column layout above for density, alphabetical within each column.)

Several of these table names match findings already logged elsewhere and are worth cross-referencing
rather than treating as new: `platform_admins`, `organizational_digital_twins`, and
`opportunity_probability_scores` were already flagged readable by anon in `RLS_POLICY_AUDIT.md`
(2026-07-30) — this audit confirms the same root cause (RLS never enabled) rather than a regression.
`submission_queue` and `form_templates` were likewise already known-exposed. `nonprofits` at
1,980,011 rows, however, does not appear to have been called out by row-count scale in any prior
document reviewed this session — worth prioritizing given it is the single largest exposed table in
the schema by a wide margin.

---

## 6. Root cause (unchanged from the two incidents that motivated this audit)

Confirmed previously via `pg_default_acl`: this project's `public` schema grants every table created
by `postgres`/`supabase_admin` full `anon`+`authenticated` privileges automatically, with no explicit
`GRANT` required. Categories B and C above are simply every table that has never had that default
grant explicitly revoked — which, until this session's two fixes, was every table in the schema. This
is a schema-provisioning default, not a per-migration mistake repeated 160 times; fixing it durably
(rather than one table at a time) would mean either changing the default privilege grant itself going
forward, or treating "explicit RLS + explicit `REVOKE`" as a mandatory step in every future
`CREATE TABLE`, and retrofitting the 160 tables identified here.

---

## 7. Explicitly not done in this pass

Per the task's scope, nothing above was remediated. Not attempted:
- No `ALTER TABLE ... ENABLE ROW LEVEL SECURITY`, `REVOKE`, or policy changes to any of the 160
  non-compliant tables.
- No re-verification of whether each Category B table's existing org-scoping policy is airtight
  against a real unauthenticated `anon` request — `RLS_POLICY_AUDIT.md` and `rls.test.ts` partially
  cover this already and found real exceptions; this document's B/C split is about the grant layer,
  not a re-confirmation of policy correctness.
- No diagnosis of the `automation_screenshots`/`automation_steps` zero-policy finding beyond noting
  it exists.
- No prioritized remediation plan or migration draft — this is an inventory, matching the brief.
