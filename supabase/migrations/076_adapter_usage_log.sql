-- 076_adapter_usage_log.sql — per-organization acquisition adapter usage
-- ledger (DONOR_DISCOVERY_ARCHITECTURE.md §2A, §6). Backs
-- src/lib/donor-discovery/adapters/google-places-adapter.ts's Faith
-- Foundation monthly budget throttle and gives every future registry adapter
-- (state license boards, land bank directory, trade associations, ...) one
-- shared place to log cost/cache-hit telemetry per org, not just the
-- platform-wide `dd_api_spend` ledger (migration 069) that only tracks the
-- shared Google Places key's total spend.
--
-- Requested as migration "073_adapter_usage_log.sql" in the task, but 073 is
-- already taken by 073_onboarding_progress.sql and 074/075 are also in use —
-- numbered 076 to follow the next-available convention (see queue.yaml).
--
-- No RLS: this is an internal cost/telemetry ledger written by server-side
-- adapter code with the service-role client, never queried directly by
-- tenant-facing routes. organization_id is nullable because platform-wide
-- adapter runs (e.g. shared taxonomy/civic-directory refreshes) have no
-- single owning org.
--
-- File only — not applied to production per this task's instructions.

CREATE TABLE IF NOT EXISTS adapter_usage_log (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id   uuid,
  adapter_name      text NOT NULL,
  api_cost_cents    int NOT NULL DEFAULT 0,
  records_returned  int NOT NULL DEFAULT 0,
  cache_hit         bool NOT NULL DEFAULT false,
  called_at         timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_adapter_usage_log_org_adapter_called_at
  ON adapter_usage_log (organization_id, adapter_name, called_at DESC);

-- The Faith Foundation throttle in google-places-adapter.ts checks this
-- table's records_returned = 0 cache_hit = false / api_cost_cents rows
-- exclusively for organization_id = FAITH_FOUNDATION_ORG_ID and
-- adapter_name = 'google_places' — this index makes that monthly SUM scan
-- an index range scan instead of a sequential scan as the table grows.

-- ── donor_discovery_connector_provider: add google_places ───────────────────
-- google-places-adapter.ts's BYOK path (non-Faith-Foundation orgs) reads
-- donor_discovery_connectors WHERE provider = 'google_places'. Migration 067
-- only seeded ('apollo','hunter','zoominfo','clay') per
-- DONOR_DISCOVERY_ARCHITECTURE.md §6's V1 connector list, which predates
-- this adapter's BYOK requirement.
ALTER TYPE donor_discovery_connector_provider ADD VALUE IF NOT EXISTS 'google_places';
