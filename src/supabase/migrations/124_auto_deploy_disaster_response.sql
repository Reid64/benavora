-- 124_auto_deploy_disaster_response.sql
-- AGENTS_v2.md AG-25 / FEATURE_REGISTRY_v2.md row #130 "Auto-Deploy Response".
--
-- Adds the org-level opt-in toggle gating whether a newly-detected FEMA
-- disaster declaration deploys a response (deployDisasterResponse) fully
-- unsupervised, or is queued as a pending agent_decisions row requiring
-- one-click human approval (the default). Deploying a live outreach/alert
-- campaign unsupervised is a meaningful behavior change with real
-- money/outreach implications, so this must be an explicit per-org opt-in —
-- default false for every org, existing and new, never auto-enabled.

ALTER TABLE org_autonomous_config
  ADD COLUMN IF NOT EXISTS auto_deploy_disaster_response boolean NOT NULL DEFAULT false;
