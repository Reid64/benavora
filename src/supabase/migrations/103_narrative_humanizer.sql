-- 103_narrative_humanizer.sql — adds applications.metadata, a general-
-- purpose jsonb field. src/lib/intelligence/narrative-humanizer.ts's
-- integration into draft-generation-agent.ts (ag-05-draft) writes
-- humanization_score here per autonomously-generated draft.
--
-- No `metadata` column existed anywhere on `applications` before this
-- (confirmed absent from supabase/migrations/001_initial_schema.sql's
-- original CREATE TABLE, every later ALTER TABLE applications in both
-- migration forks, and src/types/database.ts's generated Row type). Every
-- other agent-written jsonb column on this table (budget_data,
-- compliance_check_result, fit_analysis — all added in
-- 080_autonomous_agent_infrastructure.sql) is scoped to one specific
-- agent's output shape; this one is intentionally general-purpose so small
-- per-draft annotations from future agents don't each need their own
-- column.
--
-- Mirrored in supabase/migrations/105_applications_metadata_column.sql —
-- see [[benavora-two-parallel-migrations-directories]] (project memory):
-- it is unresolved which of the two migration forks is actually applied to
-- the live database, so this column-add is applied in both places rather
-- than guessing, matching 101/102's own precedent for the same problem.

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'applications')
     AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'applications' AND column_name = 'metadata') THEN
    ALTER TABLE applications ADD COLUMN metadata jsonb DEFAULT '{}';
  END IF;
END $$;
