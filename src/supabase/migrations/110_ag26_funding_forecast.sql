-- Migration 110 — AG-26 Funding Forecast Agent (AGENTS_v2.md §5, AG-26).
--
-- 1. Adds 'ag-26-forecast' to the agent_type enum (AGENTS_v2.md §1.2's
--    enum-gap pattern, same root cause as the 15-value fix in
--    fix-agent-type-enum-gap.sql, the ag-18-reputation/ag-32-relationship-graph
--    follow-up, and 108_ag10_grant_dna_enum.sql). Without this,
--    FundingForecastAgent.startRun() fails immediately on its first
--    agent_runs insert with "22P02: invalid input value for enum agent_type"
--    on every trigger path.
--
-- 2. Adds UNIQUE(org_id, forecast_date, forecast_period) to funding_forecasts
--    (migration 078, RLS added migration 105) — the spec's own idempotency
--    guarantee ("this constraint does not exist yet on the table as created
--    by migration 078 and must be added as part of this agent's own build
--    task"). Confirmed live via direct schema query before writing this file:
--    funding_forecasts currently has only a primary key on `id` — a second
--    run for the same org/date/period would insert a duplicate row without
--    this constraint. The agent's own upsert uses onConflict:
--    "org_id,forecast_date,forecast_period", which requires this exact
--    constraint to exist for Postgres to recognize it as a valid ON CONFLICT
--    target.

ALTER TYPE agent_type ADD VALUE IF NOT EXISTS 'ag-26-forecast';

ALTER TABLE funding_forecasts
  ADD CONSTRAINT funding_forecasts_org_date_period_unique
  UNIQUE (org_id, forecast_date, forecast_period);
