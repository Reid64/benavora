CREATE TABLE IF NOT EXISTS pig_nodes (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  node_type    text NOT NULL,
  entity_id    uuid NOT NULL,
  entity_table text NOT NULL,
  label        text NOT NULL,
  metadata     jsonb NOT NULL DEFAULT '{}',
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE(entity_table, entity_id)
);

CREATE TABLE IF NOT EXISTS pig_edges (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_node_id   uuid REFERENCES pig_nodes(id) ON DELETE CASCADE,
  target_node_id   uuid REFERENCES pig_nodes(id) ON DELETE CASCADE,
  relationship_type text NOT NULL,
  weight           numeric NOT NULL DEFAULT 1.0,
  evidence         text,
  verified         boolean NOT NULL DEFAULT false,
  metadata         jsonb NOT NULL DEFAULT '{}',
  discovered_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE(source_node_id, target_node_id, relationship_type)
);

CREATE TABLE IF NOT EXISTS corporate_monitoring_events (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  prospect_id      uuid NOT NULL,
  event_type       text NOT NULL,
  description      text,
  change_detected  jsonb NOT NULL DEFAULT '{}',
  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_pig_edges_source ON pig_edges(source_node_id);
CREATE INDEX IF NOT EXISTS idx_pig_edges_target ON pig_edges(target_node_id);
CREATE INDEX IF NOT EXISTS idx_pig_edges_type ON pig_edges(relationship_type);
CREATE INDEX IF NOT EXISTS idx_pig_nodes_entity ON pig_nodes(entity_table, entity_id);
