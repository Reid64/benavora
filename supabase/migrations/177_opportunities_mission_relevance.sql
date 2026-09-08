-- Root cause: the Opportunities dashboard (src/app/(dashboard)/opportunities/page.tsx)
-- read every row of an org's `opportunities` table with zero relevance filtering of
-- any kind. RLS (`opportunities_org_isolation`, migration 001) correctly scopes rows
-- to the org, but nothing scoped rows to the org's actual mission — so opportunities
-- from unfiltered direct-feed sources (grants.gov, federal_register, ca_grants_portal,
-- hud.gov, land_bank, etc.) that were never passed through any relevance step landed
-- in front of the client alongside real housing matches. Confirmed live: rows like
-- "Department of Defense HIV/AIDS Prevention Program" and "Sustaining Global Health
-- Security... Kenya" exist with eligibility_score = null - i.e. never scored by
-- anything, not merely scored-and-mis-ranked.
--
-- This column is intentionally distinct from `eligibility_score` (win-probability /
-- fit, computed by grant-probability-engine.ts and itself sparse - see migration
-- 135's own note that only 6 of 1,247 opportunities database-wide ever had it
-- populated). `mission_relevance_score` answers a narrower, cheaper question - "is
-- this even topically about what the org does" - using the same embedding-based KB
-- relevance mechanism already proven in
-- src/lib/agents/research/kb-relevance.ts (buildKbScorer/buildOrgFocusText), which
-- GovernmentGrantsResearchAgent already uses to reject discoveries at ingestion time
-- (KB_REJECT_THRESHOLD = 15, government-grants.ts). This migration lets the read path
-- apply that same mechanism/threshold to opportunities that never went through it.

alter table opportunities
  add column mission_relevance_score integer
    check (mission_relevance_score >= 0 and mission_relevance_score <= 100),
  add column mission_relevance_scored_at timestamptz;

comment on column opportunities.mission_relevance_score is
  'Embedding-based cosine-similarity score (0-100) of this opportunity''s text against the owning org''s configured mission/focus (search_profiles keywords + knowledge_base), via src/lib/agents/research/kb-relevance.ts. NULL means never scored - absence of a score is not evidence of irrelevance, and must not be treated as such by any filter.';

comment on column opportunities.mission_relevance_scored_at is
  'When mission_relevance_score was last computed. NULL alongside a null score means never scored.';
