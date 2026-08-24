-- ============================================================================
-- BENAVORA - Migration 162: Prospect Intelligence Layer, PIL-02 -- Deferred FK Verification
--
-- PIL-02's task spec asked for three ALTER TABLE ... ADD CONSTRAINT IF NOT EXISTS
-- statements applying deferred FKs left open by the PIL-01 batch (migrations 150-161).
-- Live verification via the Management API PAT against pg_constraint (see
-- PIL_MIGRATION_PLAN.md Sec 8) found all three already satisfied, applied as backfill
-- ALTER TABLE statements inside migrations 154-155 themselves -- not left dangling as the
-- task spec assumed:
--
--   pil_prospects_created_by_agent_id_fkey              -- added in migration 155 (Sec 6.3 backfill)
--   pil_prospect_classifications_evidence_id_fkey        -- added in migration 154 (Sec 5.3 backfill)
--   pil_prospect_opportunities_qualified_by_agent_id_fkey -- added in migration 155 (Sec 6.3 backfill)
--
-- The task spec's third statement, `pil_prospects_qualified_by_agent_id_fkey`, does not
-- correspond to any real column: pil_prospects has no qualified_by_agent_id column -- that
-- column exists only on pil_prospect_opportunities, whose FK is the third one listed above,
-- already live. The spec also targeted `pil_agent_registry(id)`; the live table has no `id`
-- column at all (its primary key is `agent_id text`), and the already-applied FKs correctly
-- reference `pil_agent_registry(agent_id)`.
--
-- Postgres has no `ADD CONSTRAINT IF NOT EXISTS` syntax (only DROP CONSTRAINT IF EXISTS is
-- supported), so this migration does not attempt to re-run the task's literal statements --
-- doing so would either raise a duplicate-constraint error or a does-not-exist column error.
-- Instead it asserts, via a DO block, that each real constraint already exists, so this
-- migration is safe to run in any environment and fails loudly if a target environment is
-- missing a constraint the PIL-01 batch was supposed to have applied.
-- ============================================================================

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'pil_prospects_created_by_agent_id_fkey'
      AND conrelid = 'public.pil_prospects'::regclass
  ) THEN
    RAISE EXCEPTION 'pil_prospects_created_by_agent_id_fkey missing -- PIL-01 migration 155 not fully applied';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'pil_prospect_classifications_evidence_id_fkey'
      AND conrelid = 'public.pil_prospect_classifications'::regclass
  ) THEN
    RAISE EXCEPTION 'pil_prospect_classifications_evidence_id_fkey missing -- PIL-01 migration 154 not fully applied';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'pil_prospect_opportunities_qualified_by_agent_id_fkey'
      AND conrelid = 'public.pil_prospect_opportunities'::regclass
  ) THEN
    RAISE EXCEPTION 'pil_prospect_opportunities_qualified_by_agent_id_fkey missing -- PIL-01 migration 155 not fully applied';
  END IF;
END $$;
