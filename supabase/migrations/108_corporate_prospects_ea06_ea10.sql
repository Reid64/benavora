-- 108_corporate_prospects_ea06_ea10.sql
--
-- Registers the 5 remaining EA-0X corporate enrichment agent_type values
-- (EA-06..EA-10, CORPORATE_INTELLIGENCE_ARCHITECTURE.md Section 2B/2C) that
-- these agents log to agent_runs. corporate_prospects itself already exists
-- from 107_corporate_prospects.sql -- no table changes needed here.
--
-- NOT CONFIRMED APPLIED TO PRODUCTION this session -- same caveat as
-- 107_corporate_prospects.sql (no working Management API / MCP DDL path
-- exercised). Apply manually via the Supabase SQL Editor:
-- https://supabase.com/dashboard/project/vbjplpquqxxfbpazyalt/sql/new

ALTER TYPE agent_type ADD VALUE IF NOT EXISTS 'ea06_press_release_analyzer';
ALTER TYPE agent_type ADD VALUE IF NOT EXISTS 'ea07_esg_analyzer';
ALTER TYPE agent_type ADD VALUE IF NOT EXISTS 'ea08_executive_biography_analyzer';
ALTER TYPE agent_type ADD VALUE IF NOT EXISTS 'ea09_contact_extractor';
ALTER TYPE agent_type ADD VALUE IF NOT EXISTS 'ea10_social_media_analyzer';
