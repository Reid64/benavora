-- 109_corporate_prospects_ag22_propensity_scoring.sql
--
-- Registers the AG-22 Propensity Scoring agent_type value
-- (CORPORATE_INTELLIGENCE_ARCHITECTURE.md §3, AGENTS_v2.md AG-22) that
-- PropensityScoringAgent logs to agent_runs. corporate_prospects.scores /
-- scores_computed_at already exist from 107_corporate_prospects.sql -- no
-- table changes needed here. This agent writes PS-01..PS-10 plus a
-- `ranking` sub-object into the existing `scores` jsonb column (canonical
-- rule §12.3: "All scoring data stored as jsonb. Never add columns per
-- score type.").
--
-- NOT CONFIRMED APPLIED TO PRODUCTION this session -- same caveat as
-- 107_corporate_prospects.sql / 108_corporate_prospects_ea06_ea10.sql (no
-- working Management API / MCP DDL path exercised). Apply manually via the
-- Supabase SQL Editor: https://supabase.com/dashboard/project/vbjplpquqxxfbpazyalt/sql/new

ALTER TYPE agent_type ADD VALUE IF NOT EXISTS 'ag22_propensity_scoring';
