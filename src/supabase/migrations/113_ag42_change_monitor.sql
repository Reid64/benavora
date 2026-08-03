-- Migration 113 — AG-42 Change Monitor Agent (CM-01) (AGENTS_v2.md §5, AG-42).
--
-- Adds 'ag-42-change-monitor' to the agent_type enum (AGENTS_v2.md §1.2's
-- enum-gap pattern, same root cause as the 15-value fix in
-- fix-agent-type-enum-gap.sql, and the 108/110/111/112 follow-ups for
-- AG-10/AG-26/AG-27/AG-41). Without this, ChangeMonitorAgent.startRun()
-- fails immediately on its first agent_runs insert with "22P02: invalid
-- input value for enum agent_type" on every call.
--
-- No other schema change needed: corporate_monitoring_events already
-- exists live (migration 077, RLS added migration 105) with exactly the
-- spec's column set (id, prospect_id, event_type, description,
-- change_detected jsonb, created_at) — confirmed via a live query before
-- writing this agent. foundation_directory's enrichment jsonb column
-- (migration 072) is also already real and live; this agent writes new
-- keys under it (change_monitor_snapshot / change_monitor_last_checked_at /
-- change_monitor_last_change) without any DDL, same convention every other
-- jsonb-extending agent in this codebase already uses.

ALTER TYPE agent_type ADD VALUE IF NOT EXISTS 'ag-42-change-monitor';
