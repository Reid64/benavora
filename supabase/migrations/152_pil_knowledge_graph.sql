-- ============================================================================
-- BENAVORA - Migration 152: Prospect Intelligence Layer, PIL-01 Group 3 -- Knowledge Graph
--
-- Third of 4 sequential migrations (150-153) applying PROSPECT_INTELLIGENCE_SCHEMA.md
-- groups 1-4 verbatim. See migration 150's header for the full PIL-01 context.
--
-- pil_graph_edge_evidence.evidence_id is a genuine within-batch forward reference: it
-- points at pil_evidence(id), which this migration's own predecessor-in-sequence,
-- migration 153 (PIL-01 Group 4), creates -- not yet created at this point in the
-- migration order. Per PROSPECT_INTELLIGENCE_SCHEMA.md's own "Cross-group foreign key
-- summary" convention (add any forward-referencing FK as a separate ALTER TABLE ... ADD
-- CONSTRAINT once both sides exist), the column is created here without the REFERENCES
-- clause, and migration 153 adds the constraint via ALTER TABLE immediately after
-- creating pil_evidence, since both sides exist by then within this same PIL-01 batch.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 3.1 pil_graph_nodes
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS pil_graph_nodes (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  node_type        text NOT NULL CHECK (node_type IN (
                      'person', 'company', 'foundation', 'board', 'nonprofit', 'donation',
                      'cause', 'geography', 'relationship', 'contact', 'opportunity'
                    )),
  prospect_id      uuid REFERENCES pil_prospects(id) ON DELETE CASCADE,
  label            text NOT NULL,
  properties       jsonb NOT NULL DEFAULT '{}',
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_pil_nodes_org_type ON pil_graph_nodes(organization_id, node_type);
CREATE INDEX IF NOT EXISTS idx_pil_nodes_prospect ON pil_graph_nodes(prospect_id) WHERE prospect_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_pil_nodes_properties_gin ON pil_graph_nodes USING gin (properties);

ALTER TABLE pil_graph_nodes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON pil_graph_nodes FROM anon;
CREATE POLICY pil_nodes_org_select ON pil_graph_nodes FOR SELECT TO authenticated
  USING (organization_id = (SELECT organization_id FROM profiles WHERE id = auth.uid()));
CREATE POLICY pil_nodes_org_insert ON pil_graph_nodes FOR INSERT TO authenticated
  WITH CHECK (organization_id = (SELECT organization_id FROM profiles WHERE id = auth.uid()));
CREATE POLICY pil_nodes_org_update ON pil_graph_nodes FOR UPDATE TO authenticated
  USING (organization_id = (SELECT organization_id FROM profiles WHERE id = auth.uid()));

-- ----------------------------------------------------------------------------
-- 3.2 pil_graph_edges
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS pil_graph_edges (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id           uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  source_node_id            uuid NOT NULL REFERENCES pil_graph_nodes(id) ON DELETE CASCADE,
  target_node_id            uuid NOT NULL REFERENCES pil_graph_nodes(id) ON DELETE CASCADE,
  edge_type                 text NOT NULL CHECK (edge_type IN (
                               'owns', 'employed_by', 'serves_on_board_of', 'trustee_of',
                               'donated_to', 'operates_in', 'supports_cause', 'related_to',
                               'introduces_to', 'has_contact', 'presents_opportunity'
                             )),
  relationship_strength     text CHECK (relationship_strength IN (
                               'very_strong', 'strong', 'moderate', 'weak', 'speculative'
                             )),
  confidence                numeric CHECK (confidence BETWEEN 0 AND 1),
  temporal_validity_start   date,
  temporal_validity_end     date,
  is_current                boolean NOT NULL DEFAULT true,
  superseded_by_edge_id     uuid REFERENCES pil_graph_edges(id),
  properties                jsonb NOT NULL DEFAULT '{}',
  created_at                timestamptz NOT NULL DEFAULT now(),
  updated_at                timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_pil_edges_org_type ON pil_graph_edges(organization_id, edge_type);
CREATE INDEX IF NOT EXISTS idx_pil_edges_source ON pil_graph_edges(source_node_id) WHERE is_current;
CREATE INDEX IF NOT EXISTS idx_pil_edges_target ON pil_graph_edges(target_node_id) WHERE is_current;
CREATE INDEX IF NOT EXISTS idx_pil_edges_current ON pil_graph_edges(organization_id, is_current);

ALTER TABLE pil_graph_edges ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON pil_graph_edges FROM anon;
CREATE POLICY pil_edges_org_select ON pil_graph_edges FOR SELECT TO authenticated
  USING (organization_id = (SELECT organization_id FROM profiles WHERE id = auth.uid()));
CREATE POLICY pil_edges_org_insert ON pil_graph_edges FOR INSERT TO authenticated
  WITH CHECK (organization_id = (SELECT organization_id FROM profiles WHERE id = auth.uid()));
CREATE POLICY pil_edges_org_update ON pil_graph_edges FOR UPDATE TO authenticated
  USING (organization_id = (SELECT organization_id FROM profiles WHERE id = auth.uid()));

-- ----------------------------------------------------------------------------
-- 3.3 pil_graph_edge_evidence
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS pil_graph_edge_evidence (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  edge_id      uuid NOT NULL REFERENCES pil_graph_edges(id) ON DELETE CASCADE,
  evidence_id  uuid NOT NULL, -- FK -> pil_evidence(id) added by migration 153 once that table exists
  created_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (edge_id, evidence_id)
);

CREATE INDEX IF NOT EXISTS idx_pil_edge_evidence_edge ON pil_graph_edge_evidence(edge_id);
CREATE INDEX IF NOT EXISTS idx_pil_edge_evidence_evidence ON pil_graph_edge_evidence(evidence_id);

ALTER TABLE pil_graph_edge_evidence ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON pil_graph_edge_evidence FROM anon;
CREATE POLICY pil_edge_evidence_select ON pil_graph_edge_evidence FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM pil_graph_edges e WHERE e.id = edge_id
      AND e.organization_id = (SELECT organization_id FROM profiles WHERE id = auth.uid())
  ));
CREATE POLICY pil_edge_evidence_insert ON pil_graph_edge_evidence FOR INSERT TO authenticated
  WITH CHECK (EXISTS (
    SELECT 1 FROM pil_graph_edges e WHERE e.id = edge_id
      AND e.organization_id = (SELECT organization_id FROM profiles WHERE id = auth.uid())
  ));
