-- 183_applications_knowledge_patterns_applied.sql
--
-- AR-2.2 task premise was that `applications.knowledge_patterns_applied` is
-- missing in production, citing 2 historical ag-05-draft failures
-- ("Could not find the 'knowledge_patterns_applied' column of 'applications'
-- in the schema cache", both 2026-08-08). Live verification this session
-- (direct Postgres query via the Supabase project, 2026-09-17) found the
-- column already exists in production:
--   column_name: knowledge_patterns_applied, data_type: jsonb,
--   is_nullable: NO, column_default: '[]'::jsonb
-- exactly matching src/lib/agents/draft-generation-agent.ts's
-- DraftApplicationPayload (an array of knowledge_patterns.id strings) and
-- src/lib/drafts/generator.ts's equivalent write. So this column was already
-- added to prod at some point after 2026-08-08 -- just never through this
-- (canonical, per benavora-two-parallel-migrations-directories memory) migrations
-- directory. The only file that ever defined it is
-- src/supabase/migrations/123_knowledge_engine_draft_integration.sql, in the
-- OTHER, non-canonical migrations tree.
--
-- This migration backfills that already-applied change into the canonical
-- history so a fresh environment built from supabase/migrations/ alone ends
-- up with the same schema production already has. IF NOT EXISTS makes this
-- safe to run again against the database that already has the column.

ALTER TABLE applications
  ADD COLUMN IF NOT EXISTS knowledge_patterns_applied jsonb NOT NULL DEFAULT '[]'::jsonb;
