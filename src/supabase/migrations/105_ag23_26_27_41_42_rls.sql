-- Migration 105 — RLS for the tables applied via 077/078 while grounding
-- AGENTS_v2.md's new AG-10/23/26/27/29/41/42 enterprise specs (2026-08-03).
--
-- 077_intelligence_graph.sql and 078_forecast_board.sql existed in this same
-- src/supabase/migrations/ tree but were never applied to production (the
-- same never-synced pattern already documented for the agent_type enum gap).
-- Applied directly via DATABASE_URL/psql (STANDING_DIRECTIVES.md
-- DIRECTIVE-017) immediately before this file. Neither original migration
-- included RLS — this file adds it, matching the exact org_id-based pattern
-- migration 080 already established for agent_queue/agent_decisions.
--
-- board_members' CREATE TABLE in 078 no-op'd (IF NOT EXISTS) against the
-- live table, which already exists from root supabase/migrations/001 under
-- a different column set (organization_id/title/bio/is_active, not
-- 078's org_id/role/committee/expertise/active) — confirmed live, not
-- reapplied here, already has its own RLS from migration 001.
--
-- pig_nodes/pig_edges/corporate_monitoring_events have no org_id/
-- organization_id column at all — they model a graph and a monitoring log
-- over entities (funders, prospects, board members) that can span multiple
-- orgs, the same shared-pool ambiguity already documented in project memory
-- for corporate_prospects. Rather than force an incorrect per-org policy
-- onto a table with no org column, these get an authenticated-only baseline
-- (blocks anon, matching this project's own RLS-audit priority) — full
-- cross-org access modeling for this shared graph is a real product
-- decision, not resolved here. Flagged in the AG-23/AG-42 specs below.

ALTER TABLE funding_forecasts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "forecasts_org" ON funding_forecasts;
CREATE POLICY "forecasts_org" ON funding_forecasts USING (org_id = (SELECT organization_id FROM profiles WHERE id = auth.uid()));

ALTER TABLE board_meetings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "board_meetings_org" ON board_meetings;
CREATE POLICY "board_meetings_org" ON board_meetings USING (org_id = (SELECT organization_id FROM profiles WHERE id = auth.uid()));

ALTER TABLE board_meeting_packets ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "board_packets_org" ON board_meeting_packets;
CREATE POLICY "board_packets_org" ON board_meeting_packets USING (org_id = (SELECT organization_id FROM profiles WHERE id = auth.uid()));

ALTER TABLE impact_simulations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "simulations_org" ON impact_simulations;
CREATE POLICY "simulations_org" ON impact_simulations USING (org_id = (SELECT organization_id FROM profiles WHERE id = auth.uid()));

ALTER TABLE pig_nodes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "pig_nodes_authenticated" ON pig_nodes;
CREATE POLICY "pig_nodes_authenticated" ON pig_nodes USING (auth.role() = 'authenticated');

ALTER TABLE pig_edges ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "pig_edges_authenticated" ON pig_edges;
CREATE POLICY "pig_edges_authenticated" ON pig_edges USING (auth.role() = 'authenticated');

ALTER TABLE corporate_monitoring_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "monitoring_events_authenticated" ON corporate_monitoring_events;
CREATE POLICY "monitoring_events_authenticated" ON corporate_monitoring_events USING (auth.role() = 'authenticated');
