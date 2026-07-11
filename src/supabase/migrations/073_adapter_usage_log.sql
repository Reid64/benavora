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

ALTER TYPE donor_discovery_connector_provider ADD VALUE IF NOT EXISTS 'google_places';
