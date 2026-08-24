-- ============================================================================
-- BENAVORA - Migration 153: Prospect Intelligence Layer, PIL-01 Group 4 -- Evidence / Provenance
--
-- Fourth of 4 sequential migrations (150-153) applying PROSPECT_INTELLIGENCE_SCHEMA.md
-- groups 1-4 verbatim. See migration 150's header for the full PIL-01 context and the
-- deferred-FK convention this migration also follows for pil_agent_registry-referencing
-- columns (pil_agent_registry, Group 6, is not part of this batch).
--
-- pil_evidence.research_run_id is intentionally created without its REFERENCES
-- pil_research_runs(id) clause: pil_research_runs (Group 5) is not part of this batch.
-- Per the task instructions, that constraint -- along with
-- pil_prospect_classifications.evidence_id -> pil_evidence(id) from migration 150 -- is
-- deferred to migration pil-01-005, added via ALTER TABLE ... ADD CONSTRAINT once
-- pil_research_runs exists.
--
-- pil_graph_edge_evidence.evidence_id -> pil_evidence(id) (created without a REFERENCES
-- clause in migration 152, since pil_evidence did not exist yet at that point in the
-- sequence) is added below, now that pil_evidence exists within this same batch.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 4.1 pil_evidence
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS pil_evidence (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id       uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  entity_id             uuid NOT NULL,
  entity_table          text NOT NULL DEFAULT 'pil_prospects' CHECK (entity_table IN (
                           'pil_prospects', 'pil_graph_nodes', 'pil_graph_edges'
                         )),
  claim                 text NOT NULL,
  value                 jsonb,
  claim_type            text NOT NULL,
  source_url            text,
  source_title          text,
  source_type           text NOT NULL,
  publisher              text,
  retrieved_at           timestamptz NOT NULL DEFAULT now(),
  published_at           timestamptz,
  last_verified_at        timestamptz,
  evidence_excerpt        text,
  agent_id               text NOT NULL, -- FK -> pil_agent_registry(agent_id) added once that table exists (later queue)
  research_run_id         uuid, -- FK -> pil_research_runs(id) deferred to pil-01-005 once that table exists
  confidence              numeric NOT NULL CHECK (confidence BETWEEN 0 AND 1),
  verification_status     text NOT NULL DEFAULT 'unverified' CHECK (verification_status IN (
                             'verified_fact', 'corroborated_fact', 'single_source_fact',
                             'reasoned_inference', 'estimate', 'unverified', 'contradicted', 'stale'
                           )),
  freshness_status        text NOT NULL DEFAULT 'fresh' CHECK (freshness_status IN ('fresh', 'aging', 'stale')),
  inference_status        text NOT NULL DEFAULT 'direct' CHECK (inference_status IN ('direct', 'inferred')),
  contradiction_status    text NOT NULL DEFAULT 'none' CHECK (contradiction_status IN (
                             'none', 'contradicted', 'superseded'
                           )),
  lineage                 jsonb NOT NULL DEFAULT '[]',
  created_at              timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_pil_evidence_org ON pil_evidence(organization_id);
CREATE INDEX IF NOT EXISTS idx_pil_evidence_entity ON pil_evidence(entity_table, entity_id);
CREATE INDEX IF NOT EXISTS idx_pil_evidence_run ON pil_evidence(research_run_id);
CREATE INDEX IF NOT EXISTS idx_pil_evidence_verification ON pil_evidence(organization_id, verification_status);
CREATE INDEX IF NOT EXISTS idx_pil_evidence_agent ON pil_evidence(agent_id);

ALTER TABLE pil_evidence ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON pil_evidence FROM anon;
CREATE POLICY pil_evidence_org_select ON pil_evidence FOR SELECT TO authenticated
  USING (organization_id = (SELECT organization_id FROM profiles WHERE id = auth.uid()));
CREATE POLICY pil_evidence_org_insert ON pil_evidence FOR INSERT TO authenticated
  WITH CHECK (organization_id = (SELECT organization_id FROM profiles WHERE id = auth.uid()));
CREATE POLICY pil_evidence_org_update ON pil_evidence FOR UPDATE TO authenticated
  USING (organization_id = (SELECT organization_id FROM profiles WHERE id = auth.uid()));

-- Now that pil_evidence exists, add the forward-referencing FK from migration 152's
-- pil_graph_edge_evidence.evidence_id -- both sides exist within this PIL-01 batch.
ALTER TABLE pil_graph_edge_evidence
  ADD CONSTRAINT pil_graph_edge_evidence_evidence_id_fkey
  FOREIGN KEY (evidence_id) REFERENCES pil_evidence(id) ON DELETE CASCADE;

-- ----------------------------------------------------------------------------
-- 4.2 pil_source_snapshots
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS pil_source_snapshots (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  evidence_id            uuid NOT NULL REFERENCES pil_evidence(id) ON DELETE CASCADE,
  source_url             text NOT NULL,
  snapshot_storage_path  text NOT NULL,
  content_hash           text NOT NULL,
  http_status            integer,
  captured_at            timestamptz NOT NULL DEFAULT now(),
  created_at             timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_pil_snapshots_evidence ON pil_source_snapshots(evidence_id);
CREATE INDEX IF NOT EXISTS idx_pil_snapshots_hash ON pil_source_snapshots(content_hash);

ALTER TABLE pil_source_snapshots ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON pil_source_snapshots FROM anon;
CREATE POLICY pil_snapshots_select ON pil_source_snapshots FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM pil_evidence ev WHERE ev.id = evidence_id
      AND ev.organization_id = (SELECT organization_id FROM profiles WHERE id = auth.uid())
  ));
CREATE POLICY pil_snapshots_insert ON pil_source_snapshots FOR INSERT TO authenticated
  WITH CHECK (EXISTS (
    SELECT 1 FROM pil_evidence ev WHERE ev.id = evidence_id
      AND ev.organization_id = (SELECT organization_id FROM profiles WHERE id = auth.uid())
  ));

-- ----------------------------------------------------------------------------
-- 4.3 pil_contradictions
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS pil_contradictions (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id        uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  prospect_id            uuid NOT NULL REFERENCES pil_prospects(id) ON DELETE CASCADE,
  claim_type             text NOT NULL,
  evidence_id_a          uuid NOT NULL REFERENCES pil_evidence(id),
  evidence_id_b          uuid NOT NULL REFERENCES pil_evidence(id),
  resolution_status      text NOT NULL DEFAULT 'open' CHECK (resolution_status IN (
                            'open', 'resolved_a', 'resolved_b', 'resolved_both_stale', 'unresolved'
                          )),
  resolved_value         jsonb,
  investigated_by_agent_id text, -- FK -> pil_agent_registry(agent_id) added once that table exists (later queue)
  resolved_at            timestamptz,
  created_at             timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pil_contradictions_distinct_evidence CHECK (evidence_id_a <> evidence_id_b)
);

CREATE INDEX IF NOT EXISTS idx_pil_contradictions_prospect ON pil_contradictions(prospect_id, resolution_status);
CREATE INDEX IF NOT EXISTS idx_pil_contradictions_org ON pil_contradictions(organization_id, resolution_status);

ALTER TABLE pil_contradictions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON pil_contradictions FROM anon;
CREATE POLICY pil_contradictions_org_select ON pil_contradictions FOR SELECT TO authenticated
  USING (organization_id = (SELECT organization_id FROM profiles WHERE id = auth.uid()));
CREATE POLICY pil_contradictions_org_insert ON pil_contradictions FOR INSERT TO authenticated
  WITH CHECK (organization_id = (SELECT organization_id FROM profiles WHERE id = auth.uid()));
CREATE POLICY pil_contradictions_org_update ON pil_contradictions FOR UPDATE TO authenticated
  USING (organization_id = (SELECT organization_id FROM profiles WHERE id = auth.uid()));
