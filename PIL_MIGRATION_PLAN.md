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
