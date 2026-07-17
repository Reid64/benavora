CREATE TABLE IF NOT EXISTS agent_registry (
  agent_id            text PRIMARY KEY,
  name                text NOT NULL,
  description         text NOT NULL,
  version             text NOT NULL DEFAULT '1.0',
  plan_requirement    text NOT NULL DEFAULT 'starter',
  trigger_type        text NOT NULL DEFAULT 'manual',
  schedule_cron       text,
  avg_runtime_seconds integer,
  active              boolean NOT NULL DEFAULT true,
  created_at          timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS agent_configurations (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id                 uuid NOT NULL,
  agent_id               text NOT NULL,
  enabled                boolean NOT NULL DEFAULT false,
  config                 jsonb NOT NULL DEFAULT '{}',
  last_run_at            timestamptz,
  run_count              integer NOT NULL DEFAULT 0,
  total_tokens_consumed  integer NOT NULL DEFAULT 0,
  created_at             timestamptz NOT NULL DEFAULT now(),
  UNIQUE(org_id, agent_id)
);

CREATE TABLE IF NOT EXISTS discovery_runs (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_date               date NOT NULL,
  opportunities_found    integer NOT NULL DEFAULT 0,
  opportunities_matched  integer NOT NULL DEFAULT 0,
  sources_checked        text[],
  runtime_seconds        integer,
  created_at             timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS discovery_matches (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id              uuid NOT NULL,
  opportunity_id      uuid,
  external_title      text,
  external_source     text,
  external_url        text,
  discovery_run_id    uuid REFERENCES discovery_runs(id),
  match_score         numeric,
  match_reasons       text[],
  status              text NOT NULL DEFAULT 'pending',
  actioned_at         timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_agent_configs_org ON agent_configurations(org_id);
CREATE INDEX IF NOT EXISTS idx_discovery_matches_org ON discovery_matches(org_id, status);
