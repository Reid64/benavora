-- Migration 038: Intelligence tables for Success Probability Agent (AGENTS.md Agent 22).
-- Creates success_probability_scores (SCHEMA_REGISTRY v2 table 51),
-- funder_relationship_scores (table 50), and competitor_tracking (table 52).

ALTER TYPE agent_type ADD VALUE IF NOT EXISTS 'success_probability';

-- 50. funder_relationship_scores -----------------------------------------------
CREATE TABLE funder_relationship_scores (
  id                      uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id         uuid          NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  funder_id               uuid          NOT NULL REFERENCES funders(id) ON DELETE CASCADE,
  relationship_score      integer       NOT NULL DEFAULT 0 CHECK (relationship_score BETWEEN 0 AND 100),
  total_interactions      integer       NOT NULL DEFAULT 0,
  successful_applications integer       NOT NULL DEFAULT 0,
  last_interaction_at     timestamptz,
  notes                   text,
  created_at              timestamptz   NOT NULL DEFAULT now(),
  updated_at              timestamptz   NOT NULL DEFAULT now(),
  UNIQUE (organization_id, funder_id)
);

ALTER TABLE funder_relationship_scores ENABLE ROW LEVEL SECURITY;
CREATE POLICY "funder_relationship_scores_org" ON funder_relationship_scores
  USING (organization_id = (SELECT organization_id FROM profiles WHERE id = auth.uid()));

CREATE INDEX idx_funder_rel_org    ON funder_relationship_scores (organization_id);
CREATE INDEX idx_funder_rel_funder ON funder_relationship_scores (funder_id);

-- 51. success_probability_scores -----------------------------------------------
CREATE TABLE success_probability_scores (
  id               uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid          NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  application_id   uuid          NOT NULL REFERENCES applications(id) ON DELETE CASCADE UNIQUE,
  probability_score integer      NOT NULL CHECK (probability_score BETWEEN 0 AND 100),
  factors          jsonb         NOT NULL DEFAULT '{}',
  data_quality     text          NOT NULL DEFAULT 'full'
                                 CHECK (data_quality IN ('full', 'estimated', 'partial')),
  calculated_at    timestamptz   NOT NULL DEFAULT now(),
  created_at       timestamptz   NOT NULL DEFAULT now(),
  updated_at       timestamptz   NOT NULL DEFAULT now()
);

ALTER TABLE success_probability_scores ENABLE ROW LEVEL SECURITY;
CREATE POLICY "success_probability_scores_org" ON success_probability_scores
  USING (organization_id = (SELECT organization_id FROM profiles WHERE id = auth.uid()));

CREATE INDEX idx_prob_scores_org ON success_probability_scores (organization_id);
CREATE INDEX idx_prob_scores_app ON success_probability_scores (application_id);

-- 52. competitor_tracking ------------------------------------------------------
CREATE TABLE competitor_tracking (
  id                  uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id     uuid          NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  opportunity_id      uuid          REFERENCES opportunities(id) ON DELETE CASCADE,
  funder_id           uuid          REFERENCES funders(id) ON DELETE CASCADE,
  estimated_applicants integer,
  competition_level   text          CHECK (competition_level IN ('low', 'medium', 'high', 'very_high')),
  source              text,
  observed_at         timestamptz   NOT NULL DEFAULT now(),
  created_at          timestamptz   NOT NULL DEFAULT now()
);

ALTER TABLE competitor_tracking ENABLE ROW LEVEL SECURITY;
CREATE POLICY "competitor_tracking_org" ON competitor_tracking
  USING (organization_id = (SELECT organization_id FROM profiles WHERE id = auth.uid()));

CREATE INDEX idx_competitor_org         ON competitor_tracking (organization_id);
CREATE INDEX idx_competitor_opportunity ON competitor_tracking (opportunity_id);
CREATE INDEX idx_competitor_observed    ON competitor_tracking (observed_at DESC);
