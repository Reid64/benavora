-- Migration 096: Knowledge Engine RAG infrastructure (Pillar 18, Funding
-- Knowledge Engine foundation).
--
-- Deviations from the task-given spec, per this project's established practice
-- of checking real state before applying a literal migration spec (see
-- 093/094/095 headers for prior instances of this pattern):
--   - Path/number: the task specified `src/supabase/migrations/097_...sql`.
--     `src/supabase/migrations/` is a stray duplicate directory the Management
--     API apply step never reads (confirmed again here -- it tops out at 8
--     files, 072-079, none of which appear in src/types/database.ts). The real
--     tree is `supabase/migrations/`, currently at 095, so this file uses 096
--     at the real path.
--   - `CREATE EXTENSION IF NOT EXISTS vector` is kept for idempotency but is a
--     no-op: pgvector was already enabled by migration 048_grant_intelligence.sql.
--   - intelligence_funded_proposals currently has no embedding column (only
--     intelligence_proposal_sections and the other intelligence_* library
--     tables carry one) -- the ADD COLUMN IF NOT EXISTS here is a genuine net
--     new addition, not a duplicate.
--   - knowledge_patterns has no organization_id/RLS: it mirrors the existing
--     intelligence_scoring_rubrics / intelligence_logic_models / etc. tables,
--     which are shared, cross-org intelligence library data, not per-org data.
--   - `org_id` -> `organization_id` on knowledge_queries, FK'd to
--     organizations(id) with RLS matching this schema's universal org-scoping
--     pattern -- every other per-org table in this schema uses that column
--     name; `org_id` would be the only exception. knowledge_queries is a log
--     of what an org's users searched for, so it is genuinely org-scoped
--     (unlike knowledge_patterns).

CREATE EXTENSION IF NOT EXISTS vector;

ALTER TABLE intelligence_funded_proposals
  ADD COLUMN IF NOT EXISTS embedding vector(1536);

CREATE TABLE IF NOT EXISTS knowledge_patterns (
  id                   uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  pattern_type         text        NOT NULL,
  category             text,
  funder_name          text,
  pattern_description  text        NOT NULL,
  success_rate         numeric,
  sample_count         integer,
  confidence           text        NOT NULL DEFAULT 'low',
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS knowledge_queries (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  query_text       text        NOT NULL,
  results          jsonb,
  created_at       timestamptz NOT NULL DEFAULT now()
);

-- Real drift found 2026-08-21 (migration-drift remediation, same pattern as
-- 095_discovery_matches.sql): a prior out-of-band process already created
-- knowledge_queries using `org_id` with 2 separate insert/select policies
-- instead of this migration's single unified organization_id-based one.
-- Table confirmed empty (0 rows) before this fix -- safe rename.
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'knowledge_queries' AND column_name = 'org_id'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'knowledge_queries' AND column_name = 'organization_id'
  ) THEN
    ALTER TABLE knowledge_queries RENAME COLUMN org_id TO organization_id;
  END IF;
END $$;

DROP POLICY IF EXISTS "knowledge_queries_org_insert" ON knowledge_queries;
DROP POLICY IF EXISTS "knowledge_queries_org_select" ON knowledge_queries;

ALTER TABLE knowledge_queries ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "knowledge_queries_org" ON knowledge_queries;
CREATE POLICY "knowledge_queries_org" ON knowledge_queries
  USING (organization_id = (SELECT organization_id FROM profiles WHERE id = auth.uid()));

CREATE INDEX IF NOT EXISTS idx_knowledge_queries_org ON knowledge_queries(organization_id);
CREATE INDEX IF NOT EXISTS idx_knowledge_patterns_type ON knowledge_patterns(pattern_type);
CREATE INDEX IF NOT EXISTS idx_knowledge_patterns_category ON knowledge_patterns(category);

CREATE INDEX IF NOT EXISTS idx_proposals_embedding
  ON intelligence_funded_proposals USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);
