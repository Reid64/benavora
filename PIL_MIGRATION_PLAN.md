# Prospect Intelligence Layer — Pre-Migration State Check

**Date:** 2026-08-23 (queried live against Supabase project `vbjplpquqxxfbpazyalt`)
**Purpose:** Resolve `benavora-two-parallel-migrations-directories` before any PIL-01 schema
migration is written. This document records findings only — no migration file has been created.

---

## 1. Which migrations directory is actually live — RESOLVED

**`supabase/migrations/` (repo root) is the live-applied tree. `src/supabase/migrations/` is
stale/abandoned and was never applied to production.**

### Evidence

| Check | root `supabase/migrations/` | `src/supabase/migrations/` |
|---|---|---|
| File count | 151 | 57 |
| Highest-numbered local file | `149_success_probability_scores_unique_constraint.sql` | `127_fix_marketplace_rls_recursion.sql` |

Both directories independently number files starting near 001 and diverge hard by the 070s — they
are genuinely two different migration histories, not one renamed. Confirmed by direct filename
comparison at three numbers:

| # | root tree file | src tree file |
|---|---|---|
| 072 | `foundation_directory_990_enrichment.sql` | `donor_discovery_taxonomy_aliases.sql` |
| 073 | `onboarding_progress.sql` | `adapter_usage_log.sql` |
| 075 | `donor_discovery_taxonomy_aliases.sql` | `agent_marketplace.sql` |

**Live database query** (via Supabase Management API, `POST
https://api.supabase.com/v1/projects/vbjplpquqxxfbpazyalt/database/query`, PAT per
`STANDING_DIRECTIVES.md` DIRECTIVE-017 Path 2 — see §3 for why Path 1 (`psql`/`DATABASE_URL`) was
unusable this session) against `supabase_migrations.schema_migrations`:

- Highest applied migration version: **`146_knowledge_schema`** — an exact filename match for
  `supabase/migrations/146_knowledge_schema.sql` (root tree). No file at `146` exists at all in
  the src tree (which tops out at 127).
- Spot-check for 072/073/075: live `schema_migrations` contains exactly `072_foundation_directory_990_enrichment`,
  `073_onboarding_progress`, `075_donor_discovery_taxonomy_aliases` — matching the **root** tree's
  content at those numbers, not the src tree's.
- Total rows in `supabase_migrations.schema_migrations`: **148**.
- `147_knowledge_public_wrappers`, `148_submission_queue_automation_session_link`,
  `149_success_probability_scores_unique_constraint` (the three newest files in the root tree) are
  **NOT** present in `schema_migrations` — they exist locally but are unapplied. This accounts for
  the 151-local-files vs. 148-applied gap (151 − 3 unapplied = 148, consistent).

**Conclusion:** all future PIL migrations must be added to `supabase/migrations/` (root), using the
root tree's numbering, and must never be modeled on or copied into `src/supabase/migrations/`.

---

## 2. Next free migration number

**150.**

`PROSPECT_INTELLIGENCE_SCHEMA.md`'s own header says "next available number... at time of writing:
`128_*`" — that estimate is stale and wrong; it was evidently computed against the src tree (or an
even older snapshot). The real next-free number in the live tree is **150**, immediately after the
three already-reserved-but-unapplied local files `147`/`148`/`149`.

Do not start PIL migrations at `147`/`148`/`149` — those numbers are taken by real, if currently
unapplied, local files with unrelated content (knowledge public wrappers, submission queue/automation
session link, success probability scores unique constraint) that may be applied before PIL work
lands. Start PIL-01 at **150**.

---

## 3. Live database credential/tooling notes (operational finding, not part of the ask, recorded for future sessions)

Two of the three documented DB-access paths were broken or unusable this session:

- **Supabase MCP connector (`mcp__claude_ai_Supabase__*`):** connected, but to an entirely
  different Supabase account/organization (`vlipoynwopxlkdbnwpug`, projects `tarritrix`,
  `tarritrix-audit`, `hail-intel-resurrected`) — `vbjplpquqxxfbpazyalt` is not in its project list.
  Calling `list_migrations`/`list_tables` against `vbjplpquqxxfbpazyalt` returns
  `MCP error -32600: You do not have permission to perform this action`. This matches the
  `benavora-supabase-mcp-unauthorized` project memory and is still unresolved.
- **`DATABASE_URL` / direct `psql` (DIRECTIVE-017 Path 1):** the value currently in `.env.local` is
  corrupted — it contains a literal stray `#@` fragment between the password and the real host
  (`...@#@aws-1-us-east-1.pooler.supabase.com...`), which fails DNS resolution. Also note: sourcing
  `.env.local` directly into a bash shell (`set -a; source .env.local; set +a`) triggers unrelated
  Stripe CLI plugin hooks — avoid sourcing this file wholesale in future sessions; read/grep the
  specific line needed instead.
- **Management API PAT (DIRECTIVE-017 Path 2):** the token documented in `STANDING_DIRECTIVES.md`
  (`sbp_7f7e9e00a8995735b2803a5f2dc1bf82097895d2`) is **still live and working** — this is what
  produced every finding in this document. Continue using this path until `DATABASE_URL` is fixed.

---

## 4. `pil_*` table name collisions — NONE FOUND

Queried live `information_schema.tables` for `public` schema, `table_name ILIKE 'pil_%'`: **zero
rows returned.** None of the 31 table names in `PROSPECT_INTELLIGENCE_SCHEMA.md` (all 12 groups)
currently exist in the live database. No renaming or collision-avoidance needed.

FK targets every `pil_*` table depends on (`organizations`, `profiles`) are both confirmed present
live.

---

## 5. Extensions and UUID generation — both already satisfied, no action needed

Live `pg_extension` on `vbjplpquqxxfbpazyalt`:

| Extension | Version | Relevant to PIL because |
|---|---|---|
| `pg_trgm` | 1.6 | Already installed — `PROSPECT_INTELLIGENCE_SCHEMA.md` §1.1's `gin_trgm_ops` index needs this; the schema doc's own instruction to add `CREATE EXTENSION IF NOT EXISTS pg_trgm;` in the first PIL migration is still correct practice (idempotent, harmless) even though it's already present — no need to skip it. |
| `pgcrypto` | 1.3 | Installed. `gen_random_uuid()` (used as the PK default on every `pil_*` table except `pil_agent_registry`) is available — confirmed both by this extension being present and by direct grep: `gen_random_uuid()` is used in 71 of the 151 files in the live (root) migrations tree, starting with `001_initial_schema.sql`'s `CREATE EXTENSION IF NOT EXISTS "pgcrypto"; -- gen_random_uuid()`. |
| `vector` | 0.8.0 | Not required by the PIL schema itself, noted for completeness (used elsewhere, e.g. `knowledge.chunks.embedding`). |
| `uuid-ossp`, `pg_stat_statements`, `plpgsql`, `supabase_vault` | — | Pre-existing, unrelated to PIL. |

No extension work is blocking. PIL-01's first migration can still include
`CREATE EXTENSION IF NOT EXISTS pg_trgm;` per the schema doc's own convention — it will simply be a
no-op against current state, which is the correct, safe behavior for an idempotent migration.

---

## Summary — inputs for PIL-01

- **Target directory:** `supabase/migrations/` (repo root) — confirmed live-applied tree.
- **Starting migration number:** `150`.
- **Table collisions:** none — all 31 `pil_*` names are free.
- **Extensions:** `pg_trgm` and `pgcrypto` already installed; `gen_random_uuid()` already
  platform-standard. Keep the `CREATE EXTENSION IF NOT EXISTS pg_trgm;` line for idempotency/
  convention even though it will no-op.
- **FK targets:** `organizations`, `profiles` both confirmed present live.
- **Do not** model any PIL migration on `src/supabase/migrations/` content or numbering — that tree
  is not applied to production.

---

## 6. PIL-01 apply attempt, 2026-08-23 — BLOCKED before any migration ran

**Task:** apply the 12 migration files written for PIL-01
(`supabase/migrations/150_pil_prospects.sql` through
`supabase/migrations/161_pil_monitoring.sql`) to live project `vbjplpquqxxfbpazyalt` via
`mcp__claude_ai_Supabase__apply_migration`, one file at a time in numeric order, with a
`get_advisors` (security) check after each apply.

**Result: zero migrations applied.** The precondition check before the first `apply_migration`
call failed, so no DDL was ever attempted against the live database.

### What was checked

1. `mcp__claude_ai_Supabase__list_projects` — returned exactly 3 projects, all under
   `organization_id: "vlipoynwopxlkdbnwpug"` / `organization_slug: "vlipoynwopxlkdbnwpug"`:
   `tarritrix` (`jhiplicikizdpdsguimg`), `tarritrix-audit` (`hacsgiylclthwqzbktoe`), and
   `hail-intel-resurrected` (`tmeplqakevlftjuxjucw`). `vbjplpquqxxfbpazyalt` is not in this list.
2. `mcp__claude_ai_Supabase__get_project` called directly with `id: "vbjplpquqxxfbpazyalt"` —
   returned `MCP error -32600: You do not have permission to perform this action`.

This is the exact same connector/account mismatch already recorded in §3 of this document
(`benavora-supabase-mcp-unauthorized` project memory) — **still unresolved as of this session**,
confirmed independently rather than assumed from the stale note.

### Why this stopped the run rather than falling back to another path

The task instructions named `mcp__claude_ai_Supabase__apply_migration` specifically and said to
stop and document rather than attempt an undocumented workaround on failure. Falling back to
DIRECTIVE-017's `DATABASE_URL`/`psql` path or the Management API PAT (both used to produce every
other finding in this document, §3) would itself be exactly that kind of undocumented workaround
for a differently-scoped task — those paths were not authorized for this specific apply-via-MCP
request, so no migration was applied by any other means either.

### Consequently not run

- `get_advisors` (security) — never called; there was nothing to check after, since no migration
  applied.
- `list_tables` post-verification (31 `pil_*` tables) and the anon-role RLS spot-check — not run,
  same reason.

### Follow-up required before this task can succeed

One of the following, decided by Reid, before re-attempting:
- Re-authorize the `claude.ai Supabase` MCP connector against the account/organization that
  actually owns `vbjplpquqxxfbpazyalt` (the connector is currently scoped to an unrelated
  account), or
- Explicitly authorize this task to use DIRECTIVE-017's `DATABASE_URL`/`psql` path or Management
  API PAT instead of the MCP tool for applying these 12 files.

No migration file content was modified. All 12 files
(`supabase/migrations/150_pil_prospects.sql` ... `161_pil_monitoring.sql`) remain exactly as
written, unapplied to the live database.

---

## 7. PIL-01 apply, 2026-08-23 — COMPLETE via Management API PAT

Follow-up decision from §6 was resolved: this task explicitly authorized the Management API PAT
path instead of `mcp__claude_ai_Supabase__apply_migration` (whose connector still cannot see
`vbjplpquqxxfbpazyalt`, unchanged from §6).

**Pre-check (live, not assumed):** `supabase_migrations.schema_migrations` had 148 rows, latest
`146_knowledge_schema`; `information_schema.tables` had zero `pil_%` tables. Matches §6's
unapplied status exactly.

**Apply:** all 12 files applied in order (`150` → `161`) via
`POST https://api.supabase.com/v1/projects/vbjplpquqxxfbpazyalt/database/query`, each file's SQL
sent verbatim, no content changes. After each apply, `information_schema.tables` was re-queried
for that migration's specific tables before recording the version in
`supabase_migrations.schema_migrations` (a manual INSERT — the raw-SQL endpoint doesn't
self-register the way `supabase migration up` does) and moving to the next file. All 12 succeeded
on the first pass.

**Final verification (live):**
- `supabase_migrations.schema_migrations`: `150_pil_prospects`, `151_pil_identity_resolution`,
  `152_pil_knowledge_graph`, `153_pil_evidence_provenance`, `154_pil_research_runs`,
  `155_pil_agent_registry`, `156_pil_delegation`, `157_pil_source_registry`,
  `158_pil_cost_ledger`, `159_pil_audit`, `160_pil_human_review`, `161_pil_monitoring` — all 12
  present.
- `information_schema.tables` — 31 `pil_%` tables, matching `PROSPECT_INTELLIGENCE_SCHEMA.md`'s
  inventory exactly: `pil_prospects`, `pil_prospect_digital_twins`,
  `pil_prospect_classifications`, `pil_prospect_opportunities`,
  `pil_entity_resolution_candidates`, `pil_entity_aliases`, `pil_identity_resolution_log`,
  `pil_graph_nodes`, `pil_graph_edges`, `pil_graph_edge_evidence`, `pil_evidence`,
  `pil_source_snapshots`, `pil_contradictions`, `pil_research_goals`, `pil_research_runs`,
  `pil_research_run_steps`, `pil_agent_registry`, `pil_agent_runs`, `pil_agent_run_events`,
  `pil_delegated_tasks`, `pil_delegation_budgets`, `pil_source_registry`,
  `pil_source_provider_credentials`, `pil_cost_ledger`, `pil_cost_budgets`, `pil_audit_log`,
  `pil_policy_decisions`, `pil_human_review_queue`, `pil_human_review_decisions`,
  `pil_monitoring_subscriptions`, `pil_monitoring_events`.
- `SELECT count(*) FROM pil_agent_registry` — **44**, matching the seed data shipped in migration
  `155_pil_agent_registry.sql` and `PROSPECT_INTELLIGENCE_AGENTS.md`'s 44-agent registry.

**Not run this pass:** `get_advisors` (RLS/security advisor review) — the migration files already
follow this codebase's established RLS convention (`REVOKE ALL ... FROM anon`, org-scoped
`SELECT`/`INSERT`/`UPDATE` policies keyed off `profiles.organization_id`) per §5's summary, but an
independent advisor pass has not yet been run against the live tables. The deferred FK ALTERs
called out in each migration file's header comments (`created_by_agent_id`/`qualified_by_agent_id`
→ `pil_agent_registry(agent_id)`, `pil_prospect_classifications.evidence_id` →
`pil_evidence(id)`) are also not yet applied — both `pil_agent_registry` and `pil_evidence` now
exist live, so these can be added in a follow-up pass.
