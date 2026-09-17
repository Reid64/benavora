-- AR-1.2 (2026-09-17): AutoApply agent identity.
--
-- The 40-module AutoApply pipeline under src/lib/autoapply/** (called
-- directly from worker/queue-processor.ts, not via BaseAgent) wrote no
-- agent_type and logged nothing to agent_runs. A live query of agent_runs on
-- 2026-09-17 returned 51 distinct agent_type values and not one was an
-- AutoApply agent -- no execution of any AutoApply module was attributable.
-- This migration only adds new enum values so those modules can log via
-- src/lib/autoapply/run-logger.ts's withAgentRun(); it does not drop or
-- recreate the agent_type enum, and does not change AutoApply's behavior.
ALTER TYPE agent_type ADD VALUE IF NOT EXISTS 'autoapply_form_analyzer';
ALTER TYPE agent_type ADD VALUE IF NOT EXISTS 'autoapply_form_filler';
ALTER TYPE agent_type ADD VALUE IF NOT EXISTS 'autoapply_registration';
ALTER TYPE agent_type ADD VALUE IF NOT EXISTS 'autoapply_submission_validator';
ALTER TYPE agent_type ADD VALUE IF NOT EXISTS 'autoapply_receipt';
ALTER TYPE agent_type ADD VALUE IF NOT EXISTS 'autoapply_risk_engine';
ALTER TYPE agent_type ADD VALUE IF NOT EXISTS 'autoapply_pitch_personalizer';
ALTER TYPE agent_type ADD VALUE IF NOT EXISTS 'autoapply_captcha_solver';
ALTER TYPE agent_type ADD VALUE IF NOT EXISTS 'autoapply_confirmation_parser';
ALTER TYPE agent_type ADD VALUE IF NOT EXISTS 'autoapply_queue_processor';
