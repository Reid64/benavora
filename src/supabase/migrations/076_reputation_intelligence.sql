CREATE TABLE IF NOT EXISTS reputation_signals (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_id    uuid NOT NULL,
  entity_type  text NOT NULL,
  signal_type  text NOT NULL,
  severity     text NOT NULL DEFAULT 'yellow',
  headline     text NOT NULL,
  summary      text,
  source_url   text,
  signal_date  date,
  verified     boolean NOT NULL DEFAULT false,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS reputation_alerts (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      uuid NOT NULL,
  signal_id   uuid REFERENCES reputation_signals(id),
  status      text NOT NULL DEFAULT 'unread',
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS relationship_memory (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id       uuid NOT NULL,
  entity_id    uuid NOT NULL,
  entity_type  text NOT NULL DEFAULT 'funder',
  memory_type  text NOT NULL,
  content      text NOT NULL,
  signal_date  date,
  actioned     boolean NOT NULL DEFAULT false,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS relationship_recommendations (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id              uuid NOT NULL,
  entity_id           uuid NOT NULL,
  entity_type         text NOT NULL DEFAULT 'funder',
  recommendation_text text NOT NULL,
  urgency             text NOT NULL DEFAULT 'normal',
  status              text NOT NULL DEFAULT 'pending',
  created_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_reputation_alerts_org ON reputation_alerts(org_id, status);
CREATE INDEX IF NOT EXISTS idx_rel_memory_org ON relationship_memory(org_id, entity_id);
CREATE INDEX IF NOT EXISTS idx_rel_recs_org ON relationship_recommendations(org_id, status);
