-- Migration 112 — AG-41 Impact Simulation Agent (AGENTS_v2.md §5, AG-41).
--
-- Adds 'ag-41-impact-simulation' to the agent_type enum (AGENTS_v2.md §1.2's
-- enum-gap pattern, same root cause as the 15-value fix in
-- fix-agent-type-enum-gap.sql, and the 108/110/111 follow-ups for
-- AG-10/AG-26/AG-27). Without this, ImpactSimulationAgent.startRun() fails
-- immediately on its first agent_runs insert with "22P02: invalid input
-- value for enum agent_type" on every call.
--
-- No other schema change needed: impact_simulations already exists live
-- (migration 078, RLS added migration 105) with exactly the spec's column
-- set (org_id, scenario_type, scenario_params jsonb, simulation_result
-- jsonb, confidence text, generated_at, created_by) — confirmed via a live
-- \d impact_simulations query before writing this agent. No uniqueness
-- constraint is added (unlike AG-26/AG-27's own migrations): per the spec's
-- own Idempotency section, re-running the same scenario twice is expected,
-- normal behavior for this agent — "each simulation is its own immutable
-- historical record," not a duplicate to prevent.

ALTER TYPE agent_type ADD VALUE IF NOT EXISTS 'ag-41-impact-simulation';
