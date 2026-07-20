-- Migration 097: Deadline Prediction Agent (ag-25-deadline-prediction) full
-- agentic upgrade -- historical accuracy tracking, multi-source detection,
-- and per-funder recurrence prediction.
--
-- deadline_predictions is new: SCHEMA_REGISTRY_v2.md does not describe a
-- table by this name anywhere in its 71-table catalog (confirmed by a full
-- read before writing this migration, and by a repo-wide grep turning up no
-- prior reference) -- this task's own SQL sketch
-- ("SELECT dp.predicted_deadline, o.deadline as actual_deadline FROM
-- deadline_predictions dp JOIN opportunities o ON dp.opportunity_id=o.id")
-- names a table that has never existed in this build. It is created here
-- from scratch, matching this session's established convention of adding
-- the schema a task assumes rather than silently working around its
-- absence (see migration 091/093's own header comments for prior
-- instances). opportunity_id is nullable and ON DELETE SET NULL rather than
-- CASCADE so a prediction's accuracy history survives even if the
-- placeholder/predicted opportunity it was attached to is later deleted.
--
-- agent_runs.agent_type is a strict enum (migration 001) and
-- AutonomousAgent's startRun() inserts agent_type unconditionally before any
-- real work happens (AGENTS_v2.md section 1.2) -- 'ag-25-deadline-prediction'
-- was never added, so every run of this agent has failed at startRun()
-- before its per-funder loop ever executed. Adding it here follows the same
-- one-migration-per-newly-wired-agent convention used for every other
-- AutonomousAgent upgrade in this history (085, 086, 088, 090, 091, 092,
-- 093, 096).

CREATE TABLE IF NOT EXISTS deadline_predictions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  opportunity_id uuid REFERENCES opportunities(id) ON DELETE SET NULL,
  funder_id uuid REFERENCES funders(id) ON DELETE SET NULL,
  predicted_deadline date NOT NULL,
  source text NOT NULL CHECK (source IN ('description_text','sam_gov','web_search','cycle_pattern','estimated_cycle')),
  confidence numeric NOT NULL CHECK (confidence BETWEEN 0 AND 1),
  urgency_tier text CHECK (urgency_tier IN ('red','amber','yellow','green')),
  source_detail text,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE deadline_predictions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS deadline_predictions_org ON deadline_predictions;
CREATE POLICY deadline_predictions_org ON deadline_predictions
  USING (org_id = (SELECT organization_id FROM profiles WHERE id = auth.uid()));

CREATE INDEX IF NOT EXISTS idx_deadline_predictions_org ON deadline_predictions(org_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_deadline_predictions_opportunity ON deadline_predictions(opportunity_id);
CREATE INDEX IF NOT EXISTS idx_deadline_predictions_funder ON deadline_predictions(funder_id);

-- Recurrence prediction fields (task item 5): "Store in a separate field" --
-- funders is the natural per-funder home for a next-predicted-open-cycle
-- value, distinct from any one opportunity row.
ALTER TABLE funders
  ADD COLUMN IF NOT EXISTS next_predicted_open_date date,
  ADD COLUMN IF NOT EXISTS avg_cycle_length_days integer;

ALTER TYPE agent_type ADD VALUE IF NOT EXISTS 'ag-25-deadline-prediction';
