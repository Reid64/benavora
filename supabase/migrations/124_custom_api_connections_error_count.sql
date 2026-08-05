-- 124_custom_api_connections_error_count.sql
--
-- Closes a real, live schema-drift bug found 2026-08-05 while live-testing
-- Research agents: custom_api_connections is missing `error_count`, one
-- column from migration 034_custom_connections.sql's original CREATE TABLE
-- (every other column in that definition matches live exactly -- this is the
-- one gap, same "some of a migration's DDL landed, some didn't" pattern seen
-- repeatedly in this project). `CustomApiResearchAgent` (custom-api.ts)
-- selects this column on every real invocation and fails with
-- `42703 column custom_api_connections.error_count does not exist` before
-- ever reaching its own logic.
--
-- Using a targeted ALTER TABLE rather than re-running migration 034's
-- CREATE TABLE IF NOT EXISTS, since the table already exists live -- that
-- guard would make the original statement a no-op for this one missing
-- column.

ALTER TABLE custom_api_connections
  ADD COLUMN IF NOT EXISTS error_count integer DEFAULT 0;
