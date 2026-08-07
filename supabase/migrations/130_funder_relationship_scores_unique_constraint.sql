-- 130_funder_relationship_scores_unique_constraint.sql
--
-- Real production gap found 2026-08-07 while live-testing
-- RelationshipBuilderAgent (src/lib/agents/relationship-builder-agent.ts,
-- agentId "ag-19-relationship") Phase A against the real Faith Foundation
-- org, after fixing that same run's board_members and funder_relationship_
-- scores column-name mismatches (see AGENT_VERIFICATION_LOG.md): the
-- agent's upsert onto funder_relationship_scores targets
-- (organization_id, funder_id), but the live table (created directly
-- against prod, no prior migration file for its current real shape) has no
-- unique constraint on that pair — only a primary key on `id`. Every upsert
-- failed live with "there is no unique or exclusion constraint matching the
-- ON CONFLICT specification". Confirmed live before applying: the table is
-- empty (0 rows) and has zero (organization_id, funder_id) duplicates, so
-- this constraint is safe to add without a prior dedup pass.

ALTER TABLE funder_relationship_scores
  ADD CONSTRAINT funder_relationship_scores_org_funder_unique
  UNIQUE (organization_id, funder_id);
