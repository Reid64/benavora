-- Migration 092: AutoApply Autonomous Overnight Orchestrator
-- Phase 2 per AUTONOMOUS_PLATFORM_VISION.md "AutoApply Full Autonomous Mode" --
-- that section extends the existing AG-12 AutoApply pipeline rather than
-- introducing a new agent number, so this migration does not add a new
-- "ag-XX" id. It adds the two org_autonomous_config toggle columns the task
-- spec asked for, plus one agent_type enum value for this orchestrator's own
-- agent_runs row.
--
-- agent_runs.agent_type is a strict enum (migration 001) and every agent that
-- inserts into agent_runs must add its literal here first (see migrations
-- 082/085/086/088/090/091) -- repeated below rather than skipped.

ALTER TABLE org_autonomous_config
  ADD COLUMN IF NOT EXISTS auto_autoapply_enabled boolean DEFAULT false;

ALTER TABLE org_autonomous_config
  ADD COLUMN IF NOT EXISTS max_nightly_autoapply_submissions integer DEFAULT 50;

ALTER TYPE agent_type ADD VALUE IF NOT EXISTS 'autoapply_autonomous_orchestrator';
