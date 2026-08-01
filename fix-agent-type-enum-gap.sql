-- ============================================================================
-- Fix: agent_type enum gap (AGENTS_v2.md §1.2, AGENT_VERIFICATION_LOG.md
-- AG-15/AG-17/AG-19/AG-25/AG-28/AG-30 entries)
--
-- STATUS AS OF THIS FILE'S GENERATION: NOT YET APPLIED TO PRODUCTION.
-- No automated DDL path was available this session:
--   - Management API PAT (BLUEPRINT_v2.md §8.3, sbp_a63...) -> HTTP 401,
--     re-verified live immediately before generating this file.
--   - Supabase MCP connector (execute_sql/get_project) -> authenticated to a
--     DIFFERENT Supabase account entirely (only "tarritrix"/"tarritrix-audit"
--     projects visible); zero access to this project (vbjplpquqxxfbpazyalt),
--     confirmed via list_projects + a direct permission-denied error on
--     get_project(vbjplpquqxxfbpazyalt).
--   - Supabase CLI (`supabase projects list`) -> same wrong account as the
--     MCP connector, same zero access.
--   - Direct psql connection -> psql IS installed on this machine, but no
--     DATABASE_URL / direct Postgres connection string or DB password exists
--     anywhere checked (.env.local, Railway variables, Vercel env, this
--     repo) — reconfirms DEMO_READINESS_AUDIT.md / RLS_POLICY_AUDIT.md /
--     STORAGE_POLICY_AUDIT.md's prior identical finding. The service-role
--     key is a PostgREST JWT, not a Postgres role password — it cannot be
--     used as a psql connection password.
--
-- Reid: run this via psql once you have the project's direct-connection
-- string + DB password (Supabase dashboard -> Project Settings -> Database
-- -> Connection string), e.g.:
--
--   psql "postgresql://postgres:<DB_PASSWORD>@db.vbjplpquqxxfbpazyalt.supabase.co:5432/postgres" \
--        -f fix-agent-type-enum-gap.sql
--
-- Running it this way (not pasting the whole file into one Supabase Studio
-- SQL Editor query box) matters: psql does NOT wrap a script in an implicit
-- transaction by default, so each ALTER TYPE below runs and commits as its
-- own separate statement. This deliberately avoids the exact silent-failure
-- pattern already documented for migrations 093/088 (RLS_POLICY_AUDIT.md /
-- AGENT_VERIFICATION_LOG.md AG-30 entry): both files' table DDL landed live
-- while their ALTER TYPE lines silently didn't, most plausibly because they
-- were pasted as one multi-statement batch into the Studio SQL Editor and a
-- later statement in that same batch errored, rolling back everything after
-- the point of failure within that one implicit transaction. If Studio's SQL
-- Editor is used instead of psql, paste and run each ALTER TYPE line ONE AT
-- A TIME, not all 15 at once.
--
-- 15 values total, in two groups (see AGENT_VERIFICATION_LOG.md's root-cause
-- entries for the full derivation):
--
--   Group A (7) — a migration already exists for these in
--   src/supabase/migrations/ (never in the root supabase/migrations/ tree,
--   never applied to production), confirmed live-missing via a direct 22P02
--   reproduction for 3 of them (ag-17-discovery, ag-30-donor-intent,
--   ag-38-self-improvement) and presumed the same unapplied pattern for the
--   rest (ag-19-relationship, ag-25-deadline-prediction, ag-digest,
--   autonomous_orchestrator).
--
--   Group B (8) — no migration exists in EITHER tree for these; genuinely
--   never written, not just unapplied (ag-15-probability, ag-28-followup,
--   ag-02, ag-03-deadline-extraction, ag-04-fit-analysis, ag-05-draft,
--   ag-06-budget-builder, ag-07-compliance-check).
--
-- Every statement uses IF NOT EXISTS, so this file is safe to re-run in
-- full even if some values already landed from a partial prior attempt.
-- ============================================================================

-- --- Group A: migration exists, presumed/confirmed unapplied to prod -------

ALTER TYPE agent_type ADD VALUE IF NOT EXISTS 'ag-17-discovery';

ALTER TYPE agent_type ADD VALUE IF NOT EXISTS 'ag-19-relationship';

ALTER TYPE agent_type ADD VALUE IF NOT EXISTS 'ag-25-deadline-prediction';

ALTER TYPE agent_type ADD VALUE IF NOT EXISTS 'ag-30-donor-intent';

ALTER TYPE agent_type ADD VALUE IF NOT EXISTS 'ag-38-self-improvement';

ALTER TYPE agent_type ADD VALUE IF NOT EXISTS 'ag-digest';

ALTER TYPE agent_type ADD VALUE IF NOT EXISTS 'autonomous_orchestrator';

-- --- Group B: no migration exists anywhere, net-new -------------------------

ALTER TYPE agent_type ADD VALUE IF NOT EXISTS 'ag-15-probability';

ALTER TYPE agent_type ADD VALUE IF NOT EXISTS 'ag-28-followup';

ALTER TYPE agent_type ADD VALUE IF NOT EXISTS 'ag-02';

ALTER TYPE agent_type ADD VALUE IF NOT EXISTS 'ag-03-deadline-extraction';

ALTER TYPE agent_type ADD VALUE IF NOT EXISTS 'ag-04-fit-analysis';

ALTER TYPE agent_type ADD VALUE IF NOT EXISTS 'ag-05-draft';

ALTER TYPE agent_type ADD VALUE IF NOT EXISTS 'ag-06-budget-builder';

ALTER TYPE agent_type ADD VALUE IF NOT EXISTS 'ag-07-compliance-check';

-- --- Verification: run after all 15 above complete --------------------------
-- Expect all 15 literals above present in the result set.

SELECT unnest(enum_range(NULL::agent_type)) AS agent_type_value ORDER BY 1;
