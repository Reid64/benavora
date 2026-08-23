# Benavora Prospect Intelligence Layer — Database Schema

Complete database schema for the Enterprise Agentic Prospect Intelligence Layer specified in
`BENAVORA ENTERPRISE AGENTIC PROSPECT INTELLIGENCE LAYER.docx`. Covers all 12 required table
groups: prospects, identity/resolution, knowledge graph, evidence/provenance, research runs, agent
registry/runs, delegation, source registry, cost ledger, audit, human review queue, monitoring.

This is a design specification, not an applied migration. See `queue-pil-01-migrations.yaml` for
the FORGE queue that turns this document into numbered Supabase migrations against the real
database (next available number in `src/supabase/migrations/` at time of writing: `128_*`).

## Conventions

- **Table prefix.** Every table in this layer is prefixed `pil_` to keep a clean namespace distinct
  from the existing `opportunities` (grants), `prospects`-adjacent, and `intelligence_*` tables
  already live in this codebase. `pil_prospects` is a **new, separate concept** from the grants
  `opportunities` table — do not conflate. See `benavora-grants-api-maps-to-opportunities` and
  `benavora-two-source-type-concepts` in project memory for the precedent this is avoiding.
- **Tenancy.** Every tenant-scoped table carries a denormalized `organization_id uuid NOT NULL
  REFERENCES organizations(id) ON DELETE CASCADE`, matching the pattern already established across
  `src/supabase/migrations/119_org_scoped_tables_rls_hardening.sql` and siblings, rather than
  requiring a join to a parent row to determine tenancy. A small number of tables are deliberately
  platform-level shared (the agent registry, the source registry) and are called out explicitly.
- **RLS is the tenant boundary; role authorization is an application-layer concern.** Every table
  is `ENABLE ROW LEVEL SECURITY`, `REVOKE ALL ... FROM anon`, and scoped
  `organization_id = (SELECT organization_id FROM profiles WHERE id = auth.uid())` for the
  `authenticated` role — the exact precedent set by migrations 118-122. Role-gating (owner/admin
  vs. writer/viewer) happens in API routes via `requireRole()`, consistent with how the rest of
  this codebase divides the two concerns (see `benavora-auth-model-diverges-from-contracts` and
  `benavora-platform-admin-vs-platform-admins-table` in project memory). Tables that hold
  budget/policy configuration additionally note the expected role gate in a comment; RLS alone does
  not enforce it, the deterministic Policy Enforcement service (see
  `PROSPECT_INTELLIGENCE_ARCHITECTURE.md` §Deterministic Services) does.
- **No hardcoded agent-id enums.** `agent_runs.agent_type` in the existing codebase (migration-era
  table, unrelated to this layer) is a `CHECK (... IN (...))` enum that silently breaks whenever a
  new agent ID is added and the constraint isn't updated in lockstep — see
  `benavora-agent-type-enum-gap` in project memory. Every table in this schema that references an
  agent does so via `agent_id text NOT NULL REFERENCES pil_agent_registry(agent_id)`, a real
  foreign key against the live registry, never a `CHECK` enum of agent IDs. `CHECK` enums are used
  only for genuinely fixed, spec-defined vocabularies (e.g. `verification_status`, evidence-quality
  labels) that do not grow as the agent fleet grows.
- **IDs.** `uuid PRIMARY KEY DEFAULT gen_random_uuid()` everywhere except `pil_agent_registry`,
  whose natural key is the spec's own agent ID (`BEN-SUP-01`, etc.), matching the existing
  `agent_registry.agent_id text PRIMARY KEY` precedent (migration 075).
- **Timestamps.** `timestamptz NOT NULL DEFAULT now()` for `created_at`; no update-trigger
  convention exists elsewhere in this codebase (checked — none found), so `updated_at` columns are
  maintained by application code, matching existing practice.
- **Audit tables are append-only.** `pil_audit_log` and `pil_agent_run_events` have no `UPDATE` or
  `DELETE` policy for any role — not even the row owner — by design.

---

## Group 1 — Prospects

The canonical prospect/entity layer: the thing every other group ultimately hangs off of.

### 1.1 `pil_prospects`

The canonical prospect record — an individual, foundation, or corporate entity under research.
Distinguished from `pil_graph_nodes` (Group 3): a prospect is always also a graph node, but not
every graph node (a company that merely employs a prospect, a cause taxonomy term) is a prospect.

```sql
CREATE TABLE IF NOT EXISTS pil_prospects (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id         uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  entity_type             text NOT NULL CHECK (entity_type IN (
                             'individual', 'family_foundation', 'private_foundation',
                             'community_foundation', 'corporate_foundation', 'corporation',
                             'executive', 'business_owner', 'board_member', 'trustee',
                             'wealth_holder', 'community_leader', 'institutional_funder', 'other'
                           )),
  display_name            text NOT NULL,
  canonical_name           text NOT NULL,
  status                  text NOT NULL DEFAULT 'active' CHECK (status IN (
                             'active', 'archived', 'merged'
                           )),
  merged_into_prospect_id uuid REFERENCES pil_prospects(id),
  source_of_record        text NOT NULL DEFAULT 'discovery' CHECK (source_of_record IN (
                             'discovery', 'crm_import', 'manual', 'rediscovery'
                           )),
  created_by_agent_id     text REFERENCES pil_agent_registry(agent_id),
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_pil_prospects_org ON pil_prospects(organization_id, status);
CREATE INDEX IF NOT EXISTS idx_pil_prospects_entity_type ON pil_prospects(organization_id, entity_type);
CREATE INDEX IF NOT EXISTS idx_pil_prospects_merged_into ON pil_prospects(merged_into_prospect_id) WHERE merged_into_prospect_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_pil_prospects_canonical_name_trgm ON pil_prospects USING gin (canonical_name gin_trgm_ops);

ALTER TABLE pil_prospects ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON pil_prospects FROM anon;
CREATE POLICY pil_prospects_org_select ON pil_prospects FOR SELECT TO authenticated
  USING (organization_id = (SELECT organization_id FROM profiles WHERE id = auth.uid()));
CREATE POLICY pil_prospects_org_insert ON pil_prospects FOR INSERT TO authenticated
  WITH CHECK (organization_id = (SELECT organization_id FROM profiles WHERE id = auth.uid()));
CREATE POLICY pil_prospects_org_update ON pil_prospects FOR UPDATE TO authenticated
  USING (organization_id = (SELECT organization_id FROM profiles WHERE id = auth.uid()));
```

`gin_trgm_ops` requires `CREATE EXTENSION IF NOT EXISTS pg_trgm;` — include once at the top of the
first applied migration (see queue PIL-01-001).

### 1.2 `pil_prospect_digital_twins`

BEN-KNW-01's living structured representation of a prospect (spec §"Required Research
Deliverables" + agent BEN-KNW-01). One row per prospect, versioned on every material update.

```sql
CREATE TABLE IF NOT EXISTS pil_prospect_digital_twins (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  prospect_id             uuid NOT NULL UNIQUE REFERENCES pil_prospects(id) ON DELETE CASCADE,
  organization_id         uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  twin_version            integer NOT NULL DEFAULT 1,
  identity                jsonb NOT NULL DEFAULT '{}',
  biography               jsonb NOT NULL DEFAULT '{}',
  organizations_summary   jsonb NOT NULL DEFAULT '[]',
  companies               jsonb NOT NULL DEFAULT '[]',
  foundations             jsonb NOT NULL DEFAULT '[]',
  giving_history          jsonb NOT NULL DEFAULT '[]',
  wealth_indicators       jsonb NOT NULL DEFAULT '{}',
  relationships_summary   jsonb NOT NULL DEFAULT '[]',
  evidence_summary        jsonb NOT NULL DEFAULT '{}',
  timeline                jsonb NOT NULL DEFAULT '[]',
  affinity                jsonb NOT NULL DEFAULT '{}',
  capacity                jsonb NOT NULL DEFAULT '{}',
  opportunities_summary   jsonb NOT NULL DEFAULT '[]',
  research_gaps           jsonb NOT NULL DEFAULT '[]',
  contradictions_summary  jsonb NOT NULL DEFAULT '[]',
  current_strategy        jsonb NOT NULL DEFAULT '{}',
  monitoring_events_summary jsonb NOT NULL DEFAULT '[]',
  completeness_score      numeric CHECK (completeness_score BETWEEN 0 AND 1),
  last_updated_by_agent_id text REFERENCES pil_agent_registry(agent_id),
  updated_at              timestamptz NOT NULL DEFAULT now(),
  created_at              timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_pil_twins_org ON pil_prospect_digital_twins(organization_id);
CREATE INDEX IF NOT EXISTS idx_pil_twins_completeness ON pil_prospect_digital_twins(organization_id, completeness_score);

ALTER TABLE pil_prospect_digital_twins ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON pil_prospect_digital_twins FROM anon;
CREATE POLICY pil_twins_org_select ON pil_prospect_digital_twins FOR SELECT TO authenticated
  USING (organization_id = (SELECT organization_id FROM profiles WHERE id = auth.uid()));
CREATE POLICY pil_twins_org_insert ON pil_prospect_digital_twins FOR INSERT TO authenticated
  WITH CHECK (organization_id = (SELECT organization_id FROM profiles WHERE id = auth.uid()));
CREATE POLICY pil_twins_org_update ON pil_prospect_digital_twins FOR UPDATE TO authenticated
  USING (organization_id = (SELECT organization_id FROM profiles WHERE id = auth.uid()));
```

### 1.3 `pil_prospect_classifications`

Many-to-many dimension tags on a prospect (cause alignment, geography, affiliation) — spec §3/§7.

```sql
CREATE TABLE IF NOT EXISTS pil_prospect_classifications (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  prospect_id      uuid NOT NULL REFERENCES pil_prospects(id) ON DELETE CASCADE,
  dimension        text NOT NULL CHECK (dimension IN (
                      'cause', 'geography', 'affiliation', 'wealth_indicator', 'other'
                    )),
  value            text NOT NULL,
  confidence       numeric CHECK (confidence BETWEEN 0 AND 1),
  evidence_id      uuid REFERENCES pil_evidence(id),
  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_pil_classifications_prospect ON pil_prospect_classifications(prospect_id, dimension);
CREATE INDEX IF NOT EXISTS idx_pil_classifications_value ON pil_prospect_classifications(organization_id, dimension, value);

ALTER TABLE pil_prospect_classifications ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON pil_prospect_classifications FROM anon;
CREATE POLICY pil_classifications_org_select ON pil_prospect_classifications FOR SELECT TO authenticated
  USING (organization_id = (SELECT organization_id FROM profiles WHERE id = auth.uid()));
CREATE POLICY pil_classifications_org_insert ON pil_prospect_classifications FOR INSERT TO authenticated
  WITH CHECK (organization_id = (SELECT organization_id FROM profiles WHERE id = auth.uid()));
```

### 1.4 `pil_prospect_opportunities`

A fundraising opportunity derived from a prospect (BEN-QLF-04's classification output). **Not**
the same table as the existing grants `opportunities` table — see the naming-collision note under
Conventions.

```sql
CREATE TABLE IF NOT EXISTS pil_prospect_opportunities (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id          uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  prospect_id              uuid NOT NULL REFERENCES pil_prospects(id) ON DELETE CASCADE,
  classification           text NOT NULL DEFAULT 'research_more' CHECK (classification IN (
                              'tier_1_priority', 'tier_2_cultivate', 'tier_3_monitor',
                              'research_more', 'low_probability', 'ineligible', 'disqualified'
                            )),
  mission_affinity_score   numeric CHECK (mission_affinity_score BETWEEN 0 AND 1),
  capacity_estimate_low    numeric,
  capacity_estimate_high   numeric,
  recommended_ask_low      numeric,
  recommended_ask_high     numeric,
  timing_status            text CHECK (timing_status IN (
                              'approach_now', 'cultivate_first', 'monitor', 'defer'
                            )),
  engagement_strategy      text,
  confidence               numeric CHECK (confidence BETWEEN 0 AND 1),
  qualified_by_agent_id    text REFERENCES pil_agent_registry(agent_id),
  qualified_at             timestamptz,
  status                   text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed_won', 'closed_lost')),
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_pil_prospect_opps_org ON pil_prospect_opportunities(organization_id, classification, status);
CREATE INDEX IF NOT EXISTS idx_pil_prospect_opps_prospect ON pil_prospect_opportunities(prospect_id);

ALTER TABLE pil_prospect_opportunities ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON pil_prospect_opportunities FROM anon;
CREATE POLICY pil_prospect_opps_org_select ON pil_prospect_opportunities FOR SELECT TO authenticated
  USING (organization_id = (SELECT organization_id FROM profiles WHERE id = auth.uid()));
CREATE POLICY pil_prospect_opps_org_insert ON pil_prospect_opportunities FOR INSERT TO authenticated
  WITH CHECK (organization_id = (SELECT organization_id FROM profiles WHERE id = auth.uid()));
CREATE POLICY pil_prospect_opps_org_update ON pil_prospect_opportunities FOR UPDATE TO authenticated
  USING (organization_id = (SELECT organization_id FROM profiles WHERE id = auth.uid()));
```

---

## Group 2 — Identity / Resolution

BEN-KNW-02's working tables: candidate matches, resolved aliases, and the merge/split audit trail.

### 2.1 `pil_entity_resolution_candidates`

```sql
CREATE TABLE IF NOT EXISTS pil_entity_resolution_candidates (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id      uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  prospect_id_a        uuid NOT NULL REFERENCES pil_prospects(id) ON DELETE CASCADE,
  prospect_id_b        uuid NOT NULL REFERENCES pil_prospects(id) ON DELETE CASCADE,
  match_score          numeric CHECK (match_score BETWEEN 0 AND 1),
  status               text NOT NULL DEFAULT 'unresolved' CHECK (status IN (
                          'match', 'probable_match', 'unresolved', 'not_match'
                        )),
  evidence             jsonb NOT NULL DEFAULT '{}',
  resolved_by_agent_id text REFERENCES pil_agent_registry(agent_id),
  resolved_at          timestamptz,
  created_at           timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pil_resolution_candidates_distinct CHECK (prospect_id_a <> prospect_id_b)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_pil_resolution_pair ON pil_entity_resolution_candidates(
  LEAST(prospect_id_a, prospect_id_b), GREATEST(prospect_id_a, prospect_id_b)
);
CREATE INDEX IF NOT EXISTS idx_pil_resolution_status ON pil_entity_resolution_candidates(organization_id, status);

ALTER TABLE pil_entity_resolution_candidates ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON pil_entity_resolution_candidates FROM anon;
CREATE POLICY pil_resolution_org_select ON pil_entity_resolution_candidates FOR SELECT TO authenticated
  USING (organization_id = (SELECT organization_id FROM profiles WHERE id = auth.uid()));
CREATE POLICY pil_resolution_org_insert ON pil_entity_resolution_candidates FOR INSERT TO authenticated
  WITH CHECK (organization_id = (SELECT organization_id FROM profiles WHERE id = auth.uid()));
CREATE POLICY pil_resolution_org_update ON pil_entity_resolution_candidates FOR UPDATE TO authenticated
  USING (organization_id = (SELECT organization_id FROM profiles WHERE id = auth.uid()));
```

### 2.2 `pil_entity_aliases`

```sql
CREATE TABLE IF NOT EXISTS pil_entity_aliases (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  prospect_id   uuid NOT NULL REFERENCES pil_prospects(id) ON DELETE CASCADE,
  alias_type    text NOT NULL CHECK (alias_type IN (
                   'name_variant', 'email', 'org_name', 'ein', 'crm_id', 'external_id'
                 )),
  alias_value   text NOT NULL,
  source        text,
  confidence    numeric CHECK (confidence BETWEEN 0 AND 1),
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_pil_aliases_prospect ON pil_entity_aliases(prospect_id);
CREATE INDEX IF NOT EXISTS idx_pil_aliases_value ON pil_entity_aliases(organization_id, alias_type, alias_value);

ALTER TABLE pil_entity_aliases ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON pil_entity_aliases FROM anon;
CREATE POLICY pil_aliases_org_select ON pil_entity_aliases FOR SELECT TO authenticated
  USING (organization_id = (SELECT organization_id FROM profiles WHERE id = auth.uid()));
CREATE POLICY pil_aliases_org_insert ON pil_entity_aliases FOR INSERT TO authenticated
  WITH CHECK (organization_id = (SELECT organization_id FROM profiles WHERE id = auth.uid()));
```

### 2.3 `pil_identity_resolution_log`

Append-only audit of merge/split/link/unlink actions — feeds `pil_audit_log` (Group 10) but kept
separate because it carries identity-specific structure the generic audit log doesn't need.

```sql
CREATE TABLE IF NOT EXISTS pil_identity_resolution_log (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id        uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  action                 text NOT NULL CHECK (action IN ('merge', 'split', 'link', 'unlink')),
  primary_prospect_id    uuid NOT NULL REFERENCES pil_prospects(id),
  secondary_prospect_id  uuid REFERENCES pil_prospects(id),
  agent_id               text REFERENCES pil_agent_registry(agent_id),
  rationale              text NOT NULL,
  created_at             timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_pil_id_resolution_log_prospect ON pil_identity_resolution_log(primary_prospect_id);

ALTER TABLE pil_identity_resolution_log ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON pil_identity_resolution_log FROM anon;
CREATE POLICY pil_id_res_log_org_select ON pil_identity_resolution_log FOR SELECT TO authenticated
  USING (organization_id = (SELECT organization_id FROM profiles WHERE id = auth.uid()));
CREATE POLICY pil_id_res_log_org_insert ON pil_identity_resolution_log FOR INSERT TO authenticated
  WITH CHECK (organization_id = (SELECT organization_id FROM profiles WHERE id = auth.uid()));
```

---

## Group 3 — Knowledge Graph

First-class graph model per spec §4. Not merely flat CRM records — nodes and typed, provenance-
bearing, temporally-valid edges.

### 3.1 `pil_graph_nodes`

```sql
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
```

### 3.2 `pil_graph_edges`

```sql
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
```

### 3.3 `pil_graph_edge_evidence`

Many-to-many join preserving which evidence rows support which edge (spec §4: "The graph must
preserve source provenance, edge provenance...").

```sql
CREATE TABLE IF NOT EXISTS pil_graph_edge_evidence (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  edge_id      uuid NOT NULL REFERENCES pil_graph_edges(id) ON DELETE CASCADE,
  evidence_id  uuid NOT NULL REFERENCES pil_evidence(id) ON DELETE CASCADE,
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
```

---

## Group 4 — Evidence / Provenance

The evidence ledger — spec §11's schema, applied field-for-field, plus source snapshots and
contradiction tracking (BEN-KNW-03, BEN-KNW-04).

### 4.1 `pil_evidence`

```sql
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
  agent_id               text NOT NULL REFERENCES pil_agent_registry(agent_id),
  research_run_id         uuid REFERENCES pil_research_runs(id),
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
```

Note: `entity_id`/`entity_table` is a polymorphic reference (evidence can attach to a prospect, a
node, or an edge) rather than a plain foreign key — Postgres cannot enforce a real FK across a
polymorphic target, so `pil_evidence_org_insert`'s `WITH CHECK` combined with application-layer
validation in the Evidence/Provenance Ledger service is the enforcement point. See
`PROSPECT_INTELLIGENCE_ARCHITECTURE.md` §Deterministic Services.

### 4.2 `pil_source_snapshots`

Source Snapshot Service (spec §13) — the actual captured content behind an evidence row, for
reproducibility per spec §17 ("Evidence Success... reconstructed from attributable evidence").

```sql
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
```

### 4.3 `pil_contradictions`

BEN-KNW-04's working table.

```sql
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
  investigated_by_agent_id text REFERENCES pil_agent_registry(agent_id),
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
```

---

## Group 5 — Research Runs

Persistent goal lifecycle (spec §10) and the bounded research executions and loop steps that
pursue those goals (spec §7's GOAL→OBSERVE→PLAN→...→STOP loop).

### 5.1 `pil_research_goals`

```sql
CREATE TABLE IF NOT EXISTS pil_research_goals (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  prospect_id      uuid REFERENCES pil_prospects(id) ON DELETE CASCADE,
  goal_type        text NOT NULL CHECK (goal_type IN (
                      'portfolio_discovery', 'prospect_research', 'qualification', 'strategy',
                      'monitoring', 'recovery'
                    )),
  objective        text NOT NULL,
  state            text NOT NULL DEFAULT 'proposed' CHECK (state IN (
                      'proposed', 'validated', 'active', 'planning', 'researching', 'executing',
                      'observing', 'replanning', 'qualified', 'disqualified', 'engagement_ready',
                      'cultivation', 'awaiting_response', 'monitoring', 'research_stale',
                      'blocked_policy', 'blocked_human', 'failed_recoverable', 'failed_terminal',
                      'satisfied', 'paused', 'reopened'
                    )),
  owner_agent_id   text REFERENCES pil_agent_registry(agent_id),
  priority         integer NOT NULL DEFAULT 50 CHECK (priority BETWEEN 0 AND 100),
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  satisfied_at     timestamptz
);

CREATE INDEX IF NOT EXISTS idx_pil_goals_org_state ON pil_research_goals(organization_id, state);
CREATE INDEX IF NOT EXISTS idx_pil_goals_prospect ON pil_research_goals(prospect_id);
CREATE INDEX IF NOT EXISTS idx_pil_goals_priority ON pil_research_goals(organization_id, priority DESC) WHERE state NOT IN ('satisfied', 'failed_terminal');

ALTER TABLE pil_research_goals ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON pil_research_goals FROM anon;
CREATE POLICY pil_goals_org_select ON pil_research_goals FOR SELECT TO authenticated
  USING (organization_id = (SELECT organization_id FROM profiles WHERE id = auth.uid()));
CREATE POLICY pil_goals_org_insert ON pil_research_goals FOR INSERT TO authenticated
  WITH CHECK (organization_id = (SELECT organization_id FROM profiles WHERE id = auth.uid()));
CREATE POLICY pil_goals_org_update ON pil_research_goals FOR UPDATE TO authenticated
  USING (organization_id = (SELECT organization_id FROM profiles WHERE id = auth.uid()));
```

### 5.2 `pil_research_runs`

The structured research plan (spec §5) that a natural-language query compiles into, plus its
execution/budget state.

```sql
CREATE TABLE IF NOT EXISTS pil_research_runs (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id           uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  goal_id                   uuid REFERENCES pil_research_goals(id) ON DELETE CASCADE,
  prospect_id               uuid REFERENCES pil_prospects(id),
  initiating_agent_id       text NOT NULL REFERENCES pil_agent_registry(agent_id),
  natural_language_query    text,
  structured_plan           jsonb NOT NULL DEFAULT '{}',
  status                    text NOT NULL DEFAULT 'planning' CHECK (status IN (
                               'planning', 'running', 'completed', 'failed', 'cancelled'
                             )),
  token_budget              integer,
  tokens_consumed           integer NOT NULL DEFAULT 0,
  financial_budget          numeric,
  financial_spent           numeric NOT NULL DEFAULT 0,
  started_at                timestamptz,
  completed_at              timestamptz,
  created_at                timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_pil_runs_org_status ON pil_research_runs(organization_id, status);
CREATE INDEX IF NOT EXISTS idx_pil_runs_goal ON pil_research_runs(goal_id);
CREATE INDEX IF NOT EXISTS idx_pil_runs_prospect ON pil_research_runs(prospect_id);

ALTER TABLE pil_research_runs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON pil_research_runs FROM anon;
CREATE POLICY pil_runs_org_select ON pil_research_runs FOR SELECT TO authenticated
  USING (organization_id = (SELECT organization_id FROM profiles WHERE id = auth.uid()));
CREATE POLICY pil_runs_org_insert ON pil_research_runs FOR INSERT TO authenticated
  WITH CHECK (organization_id = (SELECT organization_id FROM profiles WHERE id = auth.uid()));
CREATE POLICY pil_runs_org_update ON pil_research_runs FOR UPDATE TO authenticated
  USING (organization_id = (SELECT organization_id FROM profiles WHERE id = auth.uid()));
```

### 5.3 `pil_research_run_steps`

One row per loop iteration (spec §7's `GOAL→OBSERVE→...→STOP`), linked to the concrete agent run
that executed it.

```sql
CREATE TABLE IF NOT EXISTS pil_research_run_steps (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  research_run_id    uuid NOT NULL REFERENCES pil_research_runs(id) ON DELETE CASCADE,
  agent_run_id       uuid REFERENCES pil_agent_runs(id),
  step_number        integer NOT NULL,
  loop_phase         text NOT NULL CHECK (loop_phase IN (
                        'goal', 'observe_state', 'plan', 'select_tools_or_delegate', 'execute',
                        'collect_evidence', 'evaluate', 'observe_result', 'revise_plan',
                        'continue', 'escalate', 'stop'
                      )),
  state_snapshot     jsonb NOT NULL DEFAULT '{}',
  decision           text,
  created_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (research_run_id, step_number)
);

CREATE INDEX IF NOT EXISTS idx_pil_run_steps_run ON pil_research_run_steps(research_run_id, step_number);
CREATE INDEX IF NOT EXISTS idx_pil_run_steps_agent_run ON pil_research_run_steps(agent_run_id);

ALTER TABLE pil_research_run_steps ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON pil_research_run_steps FROM anon;
CREATE POLICY pil_run_steps_select ON pil_research_run_steps FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM pil_research_runs r WHERE r.id = research_run_id
      AND r.organization_id = (SELECT organization_id FROM profiles WHERE id = auth.uid())
  ));
CREATE POLICY pil_run_steps_insert ON pil_research_run_steps FOR INSERT TO authenticated
  WITH CHECK (EXISTS (
    SELECT 1 FROM pil_research_runs r WHERE r.id = research_run_id
      AND r.organization_id = (SELECT organization_id FROM profiles WHERE id = auth.uid())
  ));
```

---

## Group 6 — Agent Registry / Runs

The 44-agent fleet catalog and every concrete invocation of it. `pil_agent_registry` is
**platform-level shared** (one row per agent ID, identical across every tenant), the same pattern
already used for the existing `agent_registry` table (migration 075) and hardened in migration 121.

### 6.1 `pil_agent_registry`

```sql
CREATE TABLE IF NOT EXISTS pil_agent_registry (
  agent_id                text PRIMARY KEY,
  name                    text NOT NULL,
  family                  text NOT NULL CHECK (family IN (
                            'supervisory', 'discovery', 'prospect_intelligence',
                            'relationship_intelligence', 'qualification', 'strategy',
                            'knowledge_integrity', 'operations_evaluation_learning'
                          )),
  mission                 text NOT NULL,
  default_autonomy_level  text NOT NULL CHECK (default_autonomy_level IN ('A0', 'A1', 'A2', 'A3', 'A4')),
  human_boundary          text,
  cadence                 text NOT NULL,
  version                 text NOT NULL DEFAULT '1.0',
  spec_ref                text NOT NULL,
  active                  boolean NOT NULL DEFAULT true,
  created_at              timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE pil_agent_registry ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON pil_agent_registry FROM anon;
CREATE POLICY pil_agent_registry_shared_select ON pil_agent_registry FOR SELECT TO authenticated USING (true);
-- No authenticated INSERT/UPDATE policy: the registry is seeded and maintained by the service-role
-- deploy pipeline only (see queue-pil-01-migrations.yaml PIL-01-014), consistent with how
-- agent_registry (migration 075/121) is administered.
```

### 6.2 `pil_agent_runs`

```sql
CREATE TABLE IF NOT EXISTS pil_agent_runs (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id       uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  agent_id              text NOT NULL REFERENCES pil_agent_registry(agent_id),
  research_run_id       uuid REFERENCES pil_research_runs(id),
  delegated_task_id     uuid REFERENCES pil_delegated_tasks(task_id),
  goal_id               uuid REFERENCES pil_research_goals(id),
  status                text NOT NULL DEFAULT 'queued' CHECK (status IN (
                           'queued', 'planning', 'running', 'observing', 'replanning',
                           'completed', 'blocked', 'failed', 'escalated'
                         )),
  autonomy_level_used   text CHECK (autonomy_level_used IN ('A0', 'A1', 'A2', 'A3', 'A4')),
  input                 jsonb NOT NULL DEFAULT '{}',
  output                jsonb,
  tokens_consumed       integer NOT NULL DEFAULT 0,
  cost_usd              numeric NOT NULL DEFAULT 0,
  started_at            timestamptz,
  completed_at          timestamptz,
  error                 text,
  created_at            timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_pil_agent_runs_org_agent ON pil_agent_runs(organization_id, agent_id);
CREATE INDEX IF NOT EXISTS idx_pil_agent_runs_status ON pil_agent_runs(organization_id, status);
CREATE INDEX IF NOT EXISTS idx_pil_agent_runs_research_run ON pil_agent_runs(research_run_id);
CREATE INDEX IF NOT EXISTS idx_pil_agent_runs_delegated_task ON pil_agent_runs(delegated_task_id);

ALTER TABLE pil_agent_runs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON pil_agent_runs FROM anon;
CREATE POLICY pil_agent_runs_org_select ON pil_agent_runs FOR SELECT TO authenticated
  USING (organization_id = (SELECT organization_id FROM profiles WHERE id = auth.uid()));
CREATE POLICY pil_agent_runs_org_insert ON pil_agent_runs FOR INSERT TO authenticated
  WITH CHECK (organization_id = (SELECT organization_id FROM profiles WHERE id = auth.uid()));
CREATE POLICY pil_agent_runs_org_update ON pil_agent_runs FOR UPDATE TO authenticated
  USING (organization_id = (SELECT organization_id FROM profiles WHERE id = auth.uid()));
```

### 6.3 `pil_agent_run_events`

Append-only, fine-grained observability trail for a single agent run (tool calls, delegations
issued, evidence collected, replans). Feeds the Agent Activity/Audit UI.

```sql
CREATE TABLE IF NOT EXISTS pil_agent_run_events (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_run_id   uuid NOT NULL REFERENCES pil_agent_runs(id) ON DELETE CASCADE,
  event_type     text NOT NULL CHECK (event_type IN (
                    'tool_call', 'delegation_issued', 'evidence_collected', 'replan',
                    'escalation', 'budget_warning', 'stop_condition_met'
                  )),
  payload        jsonb NOT NULL DEFAULT '{}',
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_pil_agent_run_events_run ON pil_agent_run_events(agent_run_id, created_at);

ALTER TABLE pil_agent_run_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON pil_agent_run_events FROM anon;
CREATE POLICY pil_agent_run_events_select ON pil_agent_run_events FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM pil_agent_runs r WHERE r.id = agent_run_id
      AND r.organization_id = (SELECT organization_id FROM profiles WHERE id = auth.uid())
  ));
CREATE POLICY pil_agent_run_events_insert ON pil_agent_run_events FOR INSERT TO authenticated
  WITH CHECK (EXISTS (
    SELECT 1 FROM pil_agent_runs r WHERE r.id = agent_run_id
      AND r.organization_id = (SELECT organization_id FROM profiles WHERE id = auth.uid())
  ));
-- No UPDATE/DELETE policy for any role: append-only by design.
```

---

## Group 7 — Delegation

The typed `DelegatedTask` schema from spec §8, applied verbatim, plus org-level delegation bounds
(spec §8: "Default delegation depth should be bounded", "Fan-out must be budget controlled").

### 7.1 `pil_delegated_tasks`

```sql
CREATE TABLE IF NOT EXISTS pil_delegated_tasks (
  task_id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id         uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  parent_agent_run_id     uuid REFERENCES pil_agent_runs(id),
  parent_agent_id         text NOT NULL REFERENCES pil_agent_registry(agent_id),
  child_agent_id          text NOT NULL REFERENCES pil_agent_registry(agent_id),
  objective               text NOT NULL,
  constraints             jsonb NOT NULL DEFAULT '{}',
  context_refs            jsonb NOT NULL DEFAULT '[]',
  allowed_tools           text[] NOT NULL DEFAULT '{}',
  allowed_data_classes    text[] NOT NULL DEFAULT '{}',
  prohibited_data_classes text[] NOT NULL DEFAULT '{}',
  evidence_budget         integer,
  tool_budget             integer,
  token_budget            integer,
  financial_budget        numeric,
  deadline                timestamptz,
  freshness_requirement   interval,
  minimum_confidence      numeric CHECK (minimum_confidence BETWEEN 0 AND 1),
  success_criteria        jsonb NOT NULL DEFAULT '{}',
  stop_conditions         jsonb NOT NULL DEFAULT '{}',
  escalation_conditions   jsonb NOT NULL DEFAULT '{}',
  max_autonomy            text NOT NULL CHECK (max_autonomy IN ('A0', 'A1', 'A2', 'A3', 'A4')),
  status                  text NOT NULL DEFAULT 'pending' CHECK (status IN (
                             'pending', 'accepted', 'running', 'completed', 'cancelled',
                             'failed', 'escalated'
                           )),
  child_agent_run_id      uuid REFERENCES pil_agent_runs(id),
  delegation_depth        integer NOT NULL DEFAULT 1 CHECK (delegation_depth >= 1),
  created_at              timestamptz NOT NULL DEFAULT now(),
  cancelled_at            timestamptz,
  CONSTRAINT pil_delegated_tasks_no_self_delegation CHECK (parent_agent_id <> child_agent_id)
);

CREATE INDEX IF NOT EXISTS idx_pil_delegated_org_status ON pil_delegated_tasks(organization_id, status);
CREATE INDEX IF NOT EXISTS idx_pil_delegated_parent_run ON pil_delegated_tasks(parent_agent_run_id);
CREATE INDEX IF NOT EXISTS idx_pil_delegated_child_agent ON pil_delegated_tasks(child_agent_id, status);
CREATE INDEX IF NOT EXISTS idx_pil_delegated_depth ON pil_delegated_tasks(organization_id, delegation_depth);

ALTER TABLE pil_delegated_tasks ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON pil_delegated_tasks FROM anon;
CREATE POLICY pil_delegated_org_select ON pil_delegated_tasks FOR SELECT TO authenticated
  USING (organization_id = (SELECT organization_id FROM profiles WHERE id = auth.uid()));
CREATE POLICY pil_delegated_org_insert ON pil_delegated_tasks FOR INSERT TO authenticated
  WITH CHECK (organization_id = (SELECT organization_id FROM profiles WHERE id = auth.uid()));
CREATE POLICY pil_delegated_org_update ON pil_delegated_tasks FOR UPDATE TO authenticated
  USING (organization_id = (SELECT organization_id FROM profiles WHERE id = auth.uid()));
```

The FK from `pil_agent_runs.delegated_task_id` (Group 6) to this table, and this table's
`child_agent_run_id` back to `pil_agent_runs`, form a deliberate two-table cycle (a delegated task
spawns a run; that run is recorded back onto the task). Both FKs are added in the migration queue
after both tables exist (see PIL-01-006/007 ordering in `queue-pil-01-migrations.yaml`).

### 7.2 `pil_delegation_budgets`

Deterministic, per-org ceilings the Policy Enforcement service reads before allowing a delegation
to be created (spec §8: recursive delegation must terminate; agents cannot approve their own
authority increases). One row per organization.

```sql
CREATE TABLE IF NOT EXISTS pil_delegation_budgets (
  id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id             uuid NOT NULL UNIQUE REFERENCES organizations(id) ON DELETE CASCADE,
  max_delegation_depth        integer NOT NULL DEFAULT 5,
  max_fanout_per_task         integer NOT NULL DEFAULT 8,
  default_token_budget        integer NOT NULL DEFAULT 50000,
  default_financial_budget    numeric NOT NULL DEFAULT 5.00,
  created_at                  timestamptz NOT NULL DEFAULT now(),
  updated_at                  timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE pil_delegation_budgets ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON pil_delegation_budgets FROM anon;
CREATE POLICY pil_delegation_budgets_org_select ON pil_delegation_budgets FOR SELECT TO authenticated
  USING (organization_id = (SELECT organization_id FROM profiles WHERE id = auth.uid()));
-- INSERT/UPDATE intentionally has no authenticated policy here beyond org match; the API route
-- backing this table additionally requires requireRole('owner') before issuing a write, per the
-- RLS/role-split convention documented under Conventions above.
CREATE POLICY pil_delegation_budgets_org_update ON pil_delegation_budgets FOR UPDATE TO authenticated
  USING (organization_id = (SELECT organization_id FROM profiles WHERE id = auth.uid()));
CREATE POLICY pil_delegation_budgets_org_insert ON pil_delegation_budgets FOR INSERT TO authenticated
  WITH CHECK (organization_id = (SELECT organization_id FROM profiles WHERE id = auth.uid()));
```

---

## Group 8 — Source Registry

The permitted-sources catalog (spec §13, §19). **Platform-level shared** — the catalog of what
sources exist and their permissibility status is identical across tenants; per-tenant credential
pointers are the only tenant-scoped piece.

### 8.1 `pil_source_registry`

```sql
CREATE TABLE IF NOT EXISTS pil_source_registry (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_key            text NOT NULL UNIQUE,
  source_name           text NOT NULL,
  source_type           text NOT NULL CHECK (source_type IN (
                           'open_web', 'public_records', 'news', 'nonprofit_filing',
                           'irs_form_990', 'sec_edgar', 'corporate_information',
                           'foundation_information', 'licensed_database', 'permitted_api',
                           'crm', 'internal'
                         )),
  provider              text,
  permissibility_status text NOT NULL DEFAULT 'restricted' CHECK (permissibility_status IN (
                           'permitted', 'restricted', 'prohibited'
                         )),
  tos_notes             text,
  rate_limit_per_minute integer,
  cost_per_call         numeric,
  requires_license      boolean NOT NULL DEFAULT false,
  active                boolean NOT NULL DEFAULT true,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_pil_source_registry_type ON pil_source_registry(source_type, active);

ALTER TABLE pil_source_registry ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON pil_source_registry FROM anon;
CREATE POLICY pil_source_registry_shared_select ON pil_source_registry FOR SELECT TO authenticated USING (true);
-- No authenticated write policy: seeded/maintained by the service-role deploy pipeline, same
-- administration model as pil_agent_registry (§6.1) and the existing agent_registry table.
```

### 8.2 `pil_source_provider_credentials`

Pointer-only: never stores a raw secret, only a reference into the platform secret store (Vercel
env / secret manager), matching how this codebase already handles provider keys elsewhere.
`organization_id IS NULL` marks a platform-level shared credential (e.g. a shared licensed-data
subscription); a non-null value marks a tenant's own BYO credential.

```sql
CREATE TABLE IF NOT EXISTS pil_source_provider_credentials (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id   uuid REFERENCES organizations(id) ON DELETE CASCADE,
  source_id         uuid NOT NULL REFERENCES pil_source_registry(id),
  credential_ref    text NOT NULL,
  status            text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'revoked', 'expired')),
  last_verified_at  timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_pil_provider_creds_source ON pil_source_provider_credentials(source_id, status);
CREATE INDEX IF NOT EXISTS idx_pil_provider_creds_org ON pil_source_provider_credentials(organization_id) WHERE organization_id IS NOT NULL;

ALTER TABLE pil_source_provider_credentials ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON pil_source_provider_credentials FROM anon;
CREATE POLICY pil_provider_creds_select ON pil_source_provider_credentials FOR SELECT TO authenticated
  USING (organization_id IS NULL OR organization_id = (SELECT organization_id FROM profiles WHERE id = auth.uid()));
CREATE POLICY pil_provider_creds_insert ON pil_source_provider_credentials FOR INSERT TO authenticated
  WITH CHECK (organization_id = (SELECT organization_id FROM profiles WHERE id = auth.uid()));
CREATE POLICY pil_provider_creds_update ON pil_source_provider_credentials FOR UPDATE TO authenticated
  USING (organization_id = (SELECT organization_id FROM profiles WHERE id = auth.uid()));
```

---

## Group 9 — Cost Ledger

Every billable unit of agent/tool/API work (spec §13 Cost Ledger, §17 Efficiency Success, §21 Cost-
control architecture).

### 9.1 `pil_cost_ledger`

```sql
CREATE TABLE IF NOT EXISTS pil_cost_ledger (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id    uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  agent_run_id       uuid REFERENCES pil_agent_runs(id),
  research_run_id    uuid REFERENCES pil_research_runs(id),
  delegated_task_id  uuid REFERENCES pil_delegated_tasks(task_id),
  cost_type          text NOT NULL CHECK (cost_type IN (
                        'model_tokens', 'api_call', 'licensed_data', 'browser_automation', 'storage'
                      )),
  provider           text,
  units              numeric NOT NULL,
  unit_cost          numeric NOT NULL,
  total_cost_usd     numeric NOT NULL,
  model_name         text,
  token_count        integer,
  occurred_at        timestamptz NOT NULL DEFAULT now(),
  created_at         timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_pil_cost_ledger_org ON pil_cost_ledger(organization_id, occurred_at);
CREATE INDEX IF NOT EXISTS idx_pil_cost_ledger_agent_run ON pil_cost_ledger(agent_run_id);
CREATE INDEX IF NOT EXISTS idx_pil_cost_ledger_research_run ON pil_cost_ledger(research_run_id);
CREATE INDEX IF NOT EXISTS idx_pil_cost_ledger_type ON pil_cost_ledger(organization_id, cost_type);

ALTER TABLE pil_cost_ledger ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON pil_cost_ledger FROM anon;
CREATE POLICY pil_cost_ledger_org_select ON pil_cost_ledger FOR SELECT TO authenticated
  USING (organization_id = (SELECT organization_id FROM profiles WHERE id = auth.uid()));
CREATE POLICY pil_cost_ledger_org_insert ON pil_cost_ledger FOR INSERT TO authenticated
  WITH CHECK (organization_id = (SELECT organization_id FROM profiles WHERE id = auth.uid()));
-- No UPDATE/DELETE policy: a cost ledger is append-only, corrected via offsetting entries, not edits.
```

### 9.2 `pil_cost_budgets`

Budget ceilings the Cost Ledger service (deterministic) checks before allowing further spend; the
`hard_stop` flag is what the Autonomy Governor (BEN-SUP agents) and Policy Enforcement service
consult to force a `BLOCKED_POLICY` goal state.

```sql
CREATE TABLE IF NOT EXISTS pil_cost_budgets (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id     uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  scope_type          text NOT NULL CHECK (scope_type IN ('org', 'agent', 'research_run')),
  scope_id            text NOT NULL,
  budget_period       text NOT NULL CHECK (budget_period IN ('daily', 'monthly', 'per_run')),
  budget_limit_usd    numeric NOT NULL,
  spent_usd           numeric NOT NULL DEFAULT 0,
  alert_threshold_pct numeric NOT NULL DEFAULT 0.8 CHECK (alert_threshold_pct BETWEEN 0 AND 1),
  hard_stop           boolean NOT NULL DEFAULT true,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, scope_type, scope_id, budget_period)
);

CREATE INDEX IF NOT EXISTS idx_pil_cost_budgets_org ON pil_cost_budgets(organization_id, scope_type);

ALTER TABLE pil_cost_budgets ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON pil_cost_budgets FROM anon;
CREATE POLICY pil_cost_budgets_org_select ON pil_cost_budgets FOR SELECT TO authenticated
  USING (organization_id = (SELECT organization_id FROM profiles WHERE id = auth.uid()));
CREATE POLICY pil_cost_budgets_org_insert ON pil_cost_budgets FOR INSERT TO authenticated
  WITH CHECK (organization_id = (SELECT organization_id FROM profiles WHERE id = auth.uid()));
CREATE POLICY pil_cost_budgets_org_update ON pil_cost_budgets FOR UPDATE TO authenticated
  USING (organization_id = (SELECT organization_id FROM profiles WHERE id = auth.uid()));
-- Write access is additionally gated to requireRole('owner') at the API layer (budget changes are
-- consequential, per Conventions above).
```

---

## Group 10 — Audit

Complete audit trails (spec §20/§21). Immutable, append-only.

### 10.1 `pil_audit_log`

```sql
CREATE TABLE IF NOT EXISTS pil_audit_log (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  actor_type       text NOT NULL CHECK (actor_type IN ('agent', 'human', 'system')),
  actor_id         text NOT NULL,
  action           text NOT NULL,
  resource_type    text NOT NULL,
  resource_id      text NOT NULL,
  before_state     jsonb,
  after_state      jsonb,
  policy_decision  text,
  ip_address       inet,
  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_pil_audit_org ON pil_audit_log(organization_id, created_at);
CREATE INDEX IF NOT EXISTS idx_pil_audit_resource ON pil_audit_log(resource_type, resource_id);
CREATE INDEX IF NOT EXISTS idx_pil_audit_actor ON pil_audit_log(actor_type, actor_id);

ALTER TABLE pil_audit_log ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON pil_audit_log FROM anon;
CREATE POLICY pil_audit_log_org_select ON pil_audit_log FOR SELECT TO authenticated
  USING (organization_id = (SELECT organization_id FROM profiles WHERE id = auth.uid()));
CREATE POLICY pil_audit_log_org_insert ON pil_audit_log FOR INSERT TO authenticated
  WITH CHECK (organization_id = (SELECT organization_id FROM profiles WHERE id = auth.uid()));
-- No UPDATE/DELETE policy for any role, including owner: append-only by design. Corrections are
-- new rows referencing the corrected row's id in after_state, never edits.
```

### 10.2 `pil_policy_decisions`

The Policy Enforcement service's own decision record — every ALLOW/DENY/REQUIRE_HUMAN it issues
for a consequential agent action (spec §8/§9/§12).

```sql
CREATE TABLE IF NOT EXISTS pil_policy_decisions (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id           uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  actor_agent_id            text NOT NULL REFERENCES pil_agent_registry(agent_id),
  action_requested          text NOT NULL,
  policy_name               text NOT NULL,
  decision                  text NOT NULL CHECK (decision IN ('allow', 'deny', 'require_human')),
  reason                    text NOT NULL,
  related_delegated_task_id uuid REFERENCES pil_delegated_tasks(task_id),
  created_at                timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_pil_policy_decisions_org ON pil_policy_decisions(organization_id, created_at);
CREATE INDEX IF NOT EXISTS idx_pil_policy_decisions_agent ON pil_policy_decisions(actor_agent_id, decision);

ALTER TABLE pil_policy_decisions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON pil_policy_decisions FROM anon;
CREATE POLICY pil_policy_decisions_org_select ON pil_policy_decisions FOR SELECT TO authenticated
  USING (organization_id = (SELECT organization_id FROM profiles WHERE id = auth.uid()));
CREATE POLICY pil_policy_decisions_org_insert ON pil_policy_decisions FOR INSERT TO authenticated
  WITH CHECK (organization_id = (SELECT organization_id FROM profiles WHERE id = auth.uid()));
```

---

## Group 11 — Human Review Queue

Human-in-the-loop surface for H1/H2 boundaries (spec §9) and Critic `BLOCK_*` outcomes (spec §12).

### 11.1 `pil_human_review_queue`

```sql
CREATE TABLE IF NOT EXISTS pil_human_review_queue (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id      uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  review_type          text NOT NULL CHECK (review_type IN (
                          'identity_linkage', 'capacity_determination', 'policy_exception',
                          'autonomy_increase', 'high_impact_action', 'critic_block',
                          'contact_outreach_approval'
                        )),
  subject_type         text NOT NULL,
  subject_id           uuid NOT NULL,
  requested_by_agent_id text REFERENCES pil_agent_registry(agent_id),
  priority             text NOT NULL DEFAULT 'normal' CHECK (priority IN ('low', 'normal', 'high', 'urgent')),
  status               text NOT NULL DEFAULT 'pending' CHECK (status IN (
                          'pending', 'in_review', 'approved', 'rejected', 'changes_requested', 'expired'
                        )),
  summary              text NOT NULL,
  evidence_refs        jsonb NOT NULL DEFAULT '[]',
  assigned_to_user_id  uuid REFERENCES profiles(id),
  created_at           timestamptz NOT NULL DEFAULT now(),
  resolved_at          timestamptz
);

CREATE INDEX IF NOT EXISTS idx_pil_review_queue_org_status ON pil_human_review_queue(organization_id, status, priority);
CREATE INDEX IF NOT EXISTS idx_pil_review_queue_subject ON pil_human_review_queue(subject_type, subject_id);
CREATE INDEX IF NOT EXISTS idx_pil_review_queue_assignee ON pil_human_review_queue(assigned_to_user_id) WHERE assigned_to_user_id IS NOT NULL;

ALTER TABLE pil_human_review_queue ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON pil_human_review_queue FROM anon;
CREATE POLICY pil_review_queue_org_select ON pil_human_review_queue FOR SELECT TO authenticated
  USING (organization_id = (SELECT organization_id FROM profiles WHERE id = auth.uid()));
CREATE POLICY pil_review_queue_org_insert ON pil_human_review_queue FOR INSERT TO authenticated
  WITH CHECK (organization_id = (SELECT organization_id FROM profiles WHERE id = auth.uid()));
CREATE POLICY pil_review_queue_org_update ON pil_human_review_queue FOR UPDATE TO authenticated
  USING (organization_id = (SELECT organization_id FROM profiles WHERE id = auth.uid()));
```

### 11.2 `pil_human_review_decisions`

```sql
CREATE TABLE IF NOT EXISTS pil_human_review_decisions (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  review_id        uuid NOT NULL REFERENCES pil_human_review_queue(id) ON DELETE CASCADE,
  decided_by_user_id uuid NOT NULL REFERENCES profiles(id),
  decision         text NOT NULL CHECK (decision IN ('approved', 'rejected', 'changes_requested')),
  rationale        text NOT NULL,
  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_pil_review_decisions_review ON pil_human_review_decisions(review_id);

ALTER TABLE pil_human_review_decisions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON pil_human_review_decisions FROM anon;
CREATE POLICY pil_review_decisions_select ON pil_human_review_decisions FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM pil_human_review_queue q WHERE q.id = review_id
      AND q.organization_id = (SELECT organization_id FROM profiles WHERE id = auth.uid())
  ));
CREATE POLICY pil_review_decisions_insert ON pil_human_review_decisions FOR INSERT TO authenticated
  WITH CHECK (EXISTS (
    SELECT 1 FROM pil_human_review_queue q WHERE q.id = review_id
      AND q.organization_id = (SELECT organization_id FROM profiles WHERE id = auth.uid())
  ) AND decided_by_user_id = auth.uid());
```

---

## Group 12 — Monitoring

Continuous intelligence (spec §15) — subscriptions per prospect and the trigger events detected
against them.

### 12.1 `pil_monitoring_subscriptions`

```sql
CREATE TABLE IF NOT EXISTS pil_monitoring_subscriptions (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  prospect_id      uuid NOT NULL REFERENCES pil_prospects(id) ON DELETE CASCADE,
  trigger_types    text[] NOT NULL DEFAULT '{}',
  status           text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused')),
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (prospect_id)
);

CREATE INDEX IF NOT EXISTS idx_pil_monitoring_subs_org ON pil_monitoring_subscriptions(organization_id, status);

ALTER TABLE pil_monitoring_subscriptions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON pil_monitoring_subscriptions FROM anon;
CREATE POLICY pil_monitoring_subs_org_select ON pil_monitoring_subscriptions FOR SELECT TO authenticated
  USING (organization_id = (SELECT organization_id FROM profiles WHERE id = auth.uid()));
CREATE POLICY pil_monitoring_subs_org_insert ON pil_monitoring_subscriptions FOR INSERT TO authenticated
  WITH CHECK (organization_id = (SELECT organization_id FROM profiles WHERE id = auth.uid()));
CREATE POLICY pil_monitoring_subs_org_update ON pil_monitoring_subscriptions FOR UPDATE TO authenticated
  USING (organization_id = (SELECT organization_id FROM profiles WHERE id = auth.uid()));
```

### 12.2 `pil_monitoring_events`

```sql
CREATE TABLE IF NOT EXISTS pil_monitoring_events (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id       uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  prospect_id           uuid NOT NULL REFERENCES pil_prospects(id) ON DELETE CASCADE,
  trigger_type          text NOT NULL CHECK (trigger_type IN (
                           'company_sale', 'acquisition', 'ipo', 'executive_appointment',
                           'retirement', 'foundation_appointment', 'board_appointment',
                           'new_nonprofit_affiliation', 'major_charitable_gift',
                           'new_foundation_filing', 'corporate_giving_program_launch',
                           'geographic_expansion', 'significant_business_event',
                           'philanthropic_announcement'
                         )),
  detected_by_agent_id  text NOT NULL REFERENCES pil_agent_registry(agent_id),
  evidence_id           uuid REFERENCES pil_evidence(id),
  impact_assessment     jsonb NOT NULL DEFAULT '{}',
  status                text NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'reviewed', 'actioned', 'dismissed')),
  detected_at           timestamptz NOT NULL DEFAULT now(),
  created_at            timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_pil_monitoring_events_org_status ON pil_monitoring_events(organization_id, status);
CREATE INDEX IF NOT EXISTS idx_pil_monitoring_events_prospect ON pil_monitoring_events(prospect_id, detected_at DESC);

ALTER TABLE pil_monitoring_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON pil_monitoring_events FROM anon;
CREATE POLICY pil_monitoring_events_org_select ON pil_monitoring_events FOR SELECT TO authenticated
  USING (organization_id = (SELECT organization_id FROM profiles WHERE id = auth.uid()));
CREATE POLICY pil_monitoring_events_org_insert ON pil_monitoring_events FOR INSERT TO authenticated
  WITH CHECK (organization_id = (SELECT organization_id FROM profiles WHERE id = auth.uid()));
CREATE POLICY pil_monitoring_events_org_update ON pil_monitoring_events FOR UPDATE TO authenticated
  USING (organization_id = (SELECT organization_id FROM profiles WHERE id = auth.uid()));
```

---

## Cross-group foreign key summary

Several tables reference tables defined in a later group (`pil_prospects.created_by_agent_id` →
`pil_agent_registry`, Group 6; `pil_prospect_classifications.evidence_id` → `pil_evidence`, Group
4; `pil_evidence.research_run_id` → `pil_research_runs`, Group 5; `pil_agent_runs.delegated_task_id`
→ `pil_delegated_tasks`, Group 7). This is a specification document organized by conceptual group,
not an applied migration — `queue-pil-01-migrations.yaml` sequences the actual `CREATE TABLE`
statements in dependency order (agent registry and source registry first, since almost everything
references them; prospects and evidence next; then research runs, delegation, cost, audit, human
review, and monitoring), and adds any forward-referencing foreign key as a separate `ALTER TABLE
... ADD CONSTRAINT` once both sides exist.

## Table count

12 groups, 31 tables total: Prospects (4), Identity/Resolution (3), Knowledge Graph (3),
Evidence/Provenance (3), Research Runs (3), Agent Registry/Runs (3), Delegation (2), Source
Registry (2), Cost Ledger (2), Audit (2), Human Review Queue (2), Monitoring (2).
