# TARRITRIX 1.0 — SCHEMA REGISTRY
**Version:** 1.0 | **Format:** Supabase Migration SQL + Annotations
**Migration File:** supabase/migrations/20250101000001_tarritrix_complete_schema.sql

> **Note (2026-09-17, AR-1.2):** This document is a stale initial-scaffold template — it predates
> and does not reflect the live schema (the real migration history starts at
> `supabase/migrations/001_initial_schema.sql`, now at `182_autoapply_agent_identity.sql`).
> Recorded here for traceability only: migration 182 added 10 new `agent_type` enum values
> (`autoapply_form_analyzer`, `autoapply_form_filler`, `autoapply_registration`,
> `autoapply_submission_validator`, `autoapply_receipt`, `autoapply_risk_engine`,
> `autoapply_pitch_personalizer`, `autoapply_captcha_solver`, `autoapply_confirmation_parser`,
> `autoapply_queue_processor`) via `ALTER TYPE agent_type ADD VALUE IF NOT EXISTS`, applied live.
> The authoritative `agent_type` union is `src/types/agents.ts`; see `AGENTS_v2.md`'s "AutoApply
> agent identity (AR-1.2, 2026-09-17)" section for context.
>
> **Note (2026-09-17, AR-2.1):** Also stale on the Knowledge Base table name — this template
> never had one to be wrong about, but `SCHEMA_REGISTRY_v2.md`'s real "knowledge_base" section did
> (it said `knowledge_base_entries`, which doesn't exist). See that file's own AR-2.1 correction
> note and `STATE_OF_THE_BUILD.md`'s "AR-2.1" section.

---

## AGENT READING INSTRUCTIONS

- This is the single source of truth for all database structure
- Every table listed here exists from Migration 001 — Day 1
- Phase 2/3 tables are present but empty — do not write to them until feature flag is enabled
- Never ALTER a table outside a new versioned migration file
- RLS is enabled on every table — no exceptions
- client_id always from authenticated session — never from request body
- Service role key bypasses RLS — never use in client-facing code

---

## MIGRATION FILE

```sql
-- =============================================================================
-- TARRITRIX 1.0 COMPLETE SCHEMA
-- Migration: 20250101000001_tarritrix_complete_schema.sql
-- =============================================================================

-- Extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";
CREATE EXTENSION IF NOT EXISTS "pgmq";
CREATE EXTENSION IF NOT EXISTS "pg_cron";
CREATE EXTENSION IF NOT EXISTS "vector";

-- =============================================================================
-- ENUMS
-- =============================================================================

CREATE TYPE client_status AS ENUM (
  'onboarding','active','suspended','paused','cancelled','onboarding_failed'
);
CREATE TYPE tier_name AS ENUM ('starter','growth','authority');
CREATE TYPE page_status AS ENUM (
  'pending','generating','validating','queued',
  'flagged_for_review','published','noindex','consolidated','removed','generation_failed'
);
CREATE TYPE lifecycle_state AS ENUM (
  'fresh','stable','stale','underperforming','pruned'
);
CREATE TYPE population_tier AS ENUM ('large','mid','small');
CREATE TYPE intent_angle AS ENUM ('emergency','routine','seasonal','quality');
CREATE TYPE evidence_type AS ENUM ('photo','review','job_record','certification');
CREATE TYPE conversion_type AS ENUM ('form_submission','phone_call','chat');
CREATE TYPE agent_name AS ENUM (
  'A-01','A-02','A-03','A-04','A-05','A-06','A-07',
  'A-08','A-09','A-10','A-11','A-12','A-13','A-14',
  'A-15','A-16','A-17','A-18','A-19','CRON-01','CRON-02'
);
CREATE TYPE subscription_status AS ENUM (
  'trialing','active','past_due','cancelled','paused'
);
CREATE TYPE dsar_status AS ENUM (
  'submitted','in_progress','completed','rejected'
);
CREATE TYPE integration_type AS ENUM (
  'servicetitan','jobber','housecallpro','fieldroutes','zapier','manual'
);
CREATE TYPE gbp_post_status AS ENUM ('draft','scheduled','published','failed');
CREATE TYPE review_request_status AS ENUM (
  'pending','sent','clicked','submitted','expired'
);
CREATE TYPE signal_source AS ENUM (
  'noaa','spc','cocorahs','building_permit','social_keyword',
  'competitor_review','weather_api','marketplace'
);

-- =============================================================================
-- HELPER FUNCTION
-- =============================================================================

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

-- =============================================================================
-- GROUP 1: CORE CLIENT & BILLING (Tables 1-6)
-- =============================================================================

-- 1. pricing_tiers
-- Purpose: Source of truth for tier limits. Seeded at migration. Operator-only writes.
CREATE TABLE pricing_tiers (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name            tier_name NOT NULL UNIQUE,
  setup_fee       INTEGER NOT NULL,
  monthly_fee     INTEGER NOT NULL,
  max_cities      INTEGER NOT NULL,
  max_services    INTEGER NOT NULL,
  max_pages       INTEGER NOT NULL,
  publish_phase1  INTEGER NOT NULL,
  publish_phase2  INTEGER NOT NULL,
  publish_phase3  INTEGER NOT NULL,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

INSERT INTO pricing_tiers
  (name,setup_fee,monthly_fee,max_cities,max_services,max_pages,publish_phase1,publish_phase2,publish_phase3)
VALUES
  ('starter',  99700, 49700,  5,1,  5, 10,15,20),
  ('growth',  249700, 99700, 15,3, 45, 15,25,35),
  ('authority',499700,199700,30,5,150, 20,35,50);

-- 2. clients
-- Purpose: One record per client business. Central tenant anchor.
-- RLS: Operators see only their own clients.
CREATE TABLE clients (
  id                      UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  operator_id             UUID NOT NULL,
  business_name           TEXT NOT NULL,
  business_legal_name     TEXT NOT NULL,
  dba                     TEXT,
  business_phone          TEXT NOT NULL,
  business_address        TEXT NOT NULL,
  industry                TEXT NOT NULL,
  business_type           TEXT NOT NULL CHECK (business_type IN ('B2B','B2C')),
  website_url             TEXT,
  tier                    tier_name NOT NULL,
  status                  client_status NOT NULL DEFAULT 'onboarding',
  onboarding_started_at   TIMESTAMPTZ,
  onboarding_completed_at TIMESTAMPTZ,
  google_maps_api_key     TEXT,
  google_gcp_project_id   TEXT,
  gbp_location_id         TEXT,
  gbp_review_url          TEXT,
  stripe_customer_id      TEXT,
  stripe_subscription_id  TEXT,
  llm_daily_cost_cap      NUMERIC(8,4) DEFAULT 5.00,
  llm_cost_today          NUMERIC(8,4) DEFAULT 0.00,
  pages_generated         INTEGER DEFAULT 0,
  pages_published         INTEGER DEFAULT 0,
  created_at              TIMESTAMPTZ DEFAULT NOW(),
  updated_at              TIMESTAMPTZ DEFAULT NOW(),
  deleted_at              TIMESTAMPTZ
);

ALTER TABLE clients ENABLE ROW LEVEL SECURITY;
CREATE POLICY "operators_see_own_clients" ON clients
  FOR ALL TO authenticated USING (operator_id = auth.uid());
CREATE INDEX idx_clients_operator ON clients(operator_id);
CREATE INDEX idx_clients_status ON clients(status) WHERE deleted_at IS NULL;
CREATE INDEX idx_clients_tier ON clients(tier);
CREATE TRIGGER set_clients_updated_at BEFORE UPDATE ON clients
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- 3. services
-- Purpose: Service types offered by each client.
CREATE TABLE services (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  client_id     UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  service_name  TEXT NOT NULL,
  service_slug  TEXT NOT NULL,
  is_primary    BOOLEAN DEFAULT FALSE,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  deleted_at    TIMESTAMPTZ
);

ALTER TABLE services ENABLE ROW LEVEL SECURITY;
CREATE POLICY "operators_see_client_services" ON services
  FOR ALL TO authenticated
  USING (client_id IN (SELECT id FROM clients WHERE operator_id = auth.uid()));
CREATE INDEX idx_services_client ON services(client_id);
CREATE UNIQUE INDEX idx_services_client_slug ON services(client_id, service_slug)
  WHERE deleted_at IS NULL;

-- 4. cities
-- Purpose: Target cities per client with full geo and Census data.
CREATE TABLE cities (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  client_id         UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  city_name         TEXT NOT NULL,
  state_code        TEXT NOT NULL,
  zip_codes         TEXT[] NOT NULL DEFAULT '{}',
  latitude          NUMERIC(10,7) NOT NULL,
  longitude         NUMERIC(10,7) NOT NULL,
  population        INTEGER,
  population_tier   population_tier,
  google_place_id   TEXT,
  drive_time_minutes INTEGER,
  neighborhoods     JSONB DEFAULT '[]',
  landmarks         JSONB DEFAULT '[]',
  created_at        TIMESTAMPTZ DEFAULT NOW(),
  deleted_at        TIMESTAMPTZ
);

ALTER TABLE cities ENABLE ROW LEVEL SECURITY;
CREATE POLICY "operators_see_client_cities" ON cities
  FOR ALL TO authenticated
  USING (client_id IN (SELECT id FROM clients WHERE operator_id = auth.uid()));
CREATE INDEX idx_cities_client ON cities(client_id);
CREATE INDEX idx_cities_population ON cities(population DESC);

-- 5. subscriptions
-- Purpose: Stripe subscription lifecycle per client.
CREATE TABLE subscriptions (
  id                     UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  client_id              UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  stripe_subscription_id TEXT NOT NULL UNIQUE,
  stripe_price_id        TEXT NOT NULL,
  status                 subscription_status NOT NULL,
  current_period_start   TIMESTAMPTZ NOT NULL,
  current_period_end     TIMESTAMPTZ NOT NULL,
  cancel_at              TIMESTAMPTZ,
  cancelled_at           TIMESTAMPTZ,
  created_at             TIMESTAMPTZ DEFAULT NOW(),
  updated_at             TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE subscriptions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "operators_see_client_subscriptions" ON subscriptions
  FOR ALL TO authenticated
  USING (client_id IN (SELECT id FROM clients WHERE operator_id = auth.uid()));
CREATE INDEX idx_subscriptions_client ON subscriptions(client_id);
CREATE INDEX idx_subscriptions_status ON subscriptions(status);
CREATE TRIGGER set_subscriptions_updated_at BEFORE UPDATE ON subscriptions
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- 6. invoices
-- Purpose: Invoice records synced from Stripe webhooks.
CREATE TABLE invoices (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  client_id         UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  stripe_invoice_id TEXT NOT NULL UNIQUE,
  amount_due        INTEGER NOT NULL,
  amount_paid       INTEGER NOT NULL DEFAULT 0,
  status            TEXT NOT NULL,
  invoice_pdf       TEXT,
  period_start      TIMESTAMPTZ,
  period_end        TIMESTAMPTZ,
  created_at        TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE invoices ENABLE ROW LEVEL SECURITY;
CREATE POLICY "operators_see_client_invoices" ON invoices
  FOR ALL TO authenticated
  USING (client_id IN (SELECT id FROM clients WHERE operator_id = auth.uid()));
CREATE INDEX idx_invoices_client ON invoices(client_id);
CREATE INDEX idx_invoices_status ON invoices(status);

-- =============================================================================
-- GROUP 2: PAGE GENERATION (Tables 7-13)
-- =============================================================================

-- 7. page_generation_queue
-- Purpose: Work queue for A-02. One record per city × service pair per client.
CREATE TABLE page_generation_queue (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  client_id     UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  city_id       UUID NOT NULL REFERENCES cities(id) ON DELETE CASCADE,
  service_id    UUID NOT NULL REFERENCES services(id) ON DELETE CASCADE,
  status        TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','processing','completed','failed')),
  attempts      INTEGER DEFAULT 0,
  last_error    TEXT,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE page_generation_queue ENABLE ROW LEVEL SECURITY;
CREATE POLICY "operators_see_client_queue" ON page_generation_queue
  FOR ALL TO authenticated
  USING (client_id IN (SELECT id FROM clients WHERE operator_id = auth.uid()));
CREATE INDEX idx_queue_pending ON page_generation_queue(status, created_at)
  WHERE status = 'pending';
CREATE INDEX idx_queue_client ON page_generation_queue(client_id);
CREATE TRIGGER set_queue_updated_at BEFORE UPDATE ON page_generation_queue
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- 8. pages
-- Purpose: One record per generated SEO page. Central content table.
CREATE TABLE pages (
  id                    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  client_id             UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  city_id               UUID NOT NULL REFERENCES cities(id),
  service_id            UUID NOT NULL REFERENCES services(id),
  slug                  TEXT NOT NULL,
  title                 TEXT NOT NULL,
  meta_description      TEXT NOT NULL,
  h1                    TEXT NOT NULL,
  body_html             TEXT NOT NULL,
  word_count            INTEGER,
  map_embed_html        TEXT,
  twilio_number         TEXT,
  status                page_status NOT NULL DEFAULT 'pending',
  lifecycle_state       lifecycle_state DEFAULT 'fresh',
  priority_tier         INTEGER CHECK (priority_tier IN (1,2,3)),
  indexation_directive  TEXT CHECK (indexation_directive IN ('index','noindex','canonical')),
  canonical_to_page_id  UUID REFERENCES pages(id),
  doorway_risk_score    FLOAT CHECK (doorway_risk_score BETWEEN 0 AND 1),
  publish_scheduled_at  TIMESTAMPTZ,
  published_at          TIMESTAMPTZ,
  last_refreshed_at     TIMESTAMPTZ,
  content_hash          TEXT,
  created_at            TIMESTAMPTZ DEFAULT NOW(),
  updated_at            TIMESTAMPTZ DEFAULT NOW(),
  deleted_at            TIMESTAMPTZ
);

ALTER TABLE pages ENABLE ROW LEVEL SECURITY;
CREATE POLICY "operators_see_client_pages" ON pages
  FOR ALL TO authenticated
  USING (client_id IN (SELECT id FROM clients WHERE operator_id = auth.uid()));
CREATE INDEX idx_pages_client ON pages(client_id);
CREATE INDEX idx_pages_status ON pages(status) WHERE deleted_at IS NULL;
CREATE INDEX idx_pages_publish_schedule ON pages(publish_scheduled_at)
  WHERE status = 'queued';
CREATE INDEX idx_pages_lifecycle ON pages(lifecycle_state);
CREATE INDEX idx_pages_client_slug ON pages(client_id, slug) WHERE deleted_at IS NULL;
CREATE TRIGGER set_pages_updated_at BEFORE UPDATE ON pages
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- 9. page_content_profile
-- Purpose: 4-layer differentiation inputs per page. Audit trail proving differentiation.
CREATE TABLE page_content_profile (
  id                    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  page_id               UUID NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
  client_id             UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  neighborhoods_used    JSONB NOT NULL DEFAULT '[]',
  landmarks_used        JSONB NOT NULL DEFAULT '[]',
  zip_codes_used        TEXT[] DEFAULT '{}',
  place_ids_used        TEXT[] DEFAULT '{}',
  population_tier       population_tier NOT NULL,
  population_count      INTEGER,
  intent_angle          intent_angle NOT NULL,
  intent_rationale      TEXT,
  entity_count          INTEGER NOT NULL DEFAULT 0,
  llm_model             TEXT NOT NULL,
  prompt_tokens         INTEGER,
  completion_tokens     INTEGER,
  generation_cost_usd   NUMERIC(8,6),
  claims_stripped       INTEGER DEFAULT 0,
  flagged_for_review    BOOLEAN DEFAULT FALSE,
  created_at            TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE page_content_profile ENABLE ROW LEVEL SECURITY;
CREATE POLICY "operators_see_page_profiles" ON page_content_profile
  FOR ALL TO authenticated
  USING (client_id IN (SELECT id FROM clients WHERE operator_id = auth.uid()));
CREATE INDEX idx_page_content_profile_page ON page_content_profile(page_id);
CREATE INDEX idx_page_content_profile_client ON page_content_profile(client_id);
CREATE INDEX idx_page_content_profile_flagged ON page_content_profile(flagged_for_review)
  WHERE flagged_for_review = TRUE;

-- 10. page_quality_scores
-- Purpose: Full 15-gate validation results. Immutable audit trail per page.
CREATE TABLE page_quality_scores (
  id                    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  page_id               UUID NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
  client_id             UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  v1_meta_title         BOOLEAN NOT NULL,
  v2_meta_desc          BOOLEAN NOT NULL,
  v3_h1_unique          BOOLEAN NOT NULL,
  v4_word_count         BOOLEAN NOT NULL,
  v5_keyword_density    BOOLEAN NOT NULL,
  v6_alt_text           BOOLEAN NOT NULL,
  v7_core_web_vitals    BOOLEAN NOT NULL,
  v8_wcag               BOOLEAN NOT NULL,
  v9_schema_valid       BOOLEAN NOT NULL,
  v10_tcpa_consent      BOOLEAN NOT NULL,
  v11_internal_links    BOOLEAN NOT NULL,
  v12_local_entities    BOOLEAN NOT NULL,
  v13_similarity        BOOLEAN NOT NULL,
  v14_geo_completeness  BOOLEAN NOT NULL,
  v15_no_superlatives   BOOLEAN NOT NULL,
  gates_passed          INTEGER NOT NULL,
  overall_quality_score NUMERIC(5,2),
  similarity_to_peers   FLOAT,
  doorway_risk_score    FLOAT,
  failed_gates          JSONB DEFAULT '[]',
  operator_override     BOOLEAN DEFAULT FALSE,
  override_reason       TEXT,
  override_by           UUID,
  created_at            TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE page_quality_scores ENABLE ROW LEVEL SECURITY;
CREATE POLICY "operators_see_quality_scores" ON page_quality_scores
  FOR ALL TO authenticated
  USING (client_id IN (SELECT id FROM clients WHERE operator_id = auth.uid()));
CREATE INDEX idx_page_quality_page ON page_quality_scores(page_id);
CREATE INDEX idx_page_quality_client ON page_quality_scores(client_id);
CREATE INDEX idx_page_quality_overall ON page_quality_scores(overall_quality_score);
CREATE INDEX idx_page_quality_similarity ON page_quality_scores(similarity_to_peers);

-- 11. page_schemas
-- Purpose: JSON-LD structured data per page. Generated by A-03 (Phase 1.5).
CREATE TABLE page_schemas (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  page_id         UUID NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
  client_id       UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  local_business  JSONB,
  service_schema  JSONB,
  faq_schema      JSONB,
  breadcrumb      JSONB,
  is_valid        BOOLEAN DEFAULT FALSE,
  validated_at    TIMESTAMPTZ,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE page_schemas ENABLE ROW LEVEL SECURITY;
CREATE POLICY "operators_see_page_schemas" ON page_schemas
  FOR ALL TO authenticated
  USING (client_id IN (SELECT id FROM clients WHERE operator_id = auth.uid()));
CREATE INDEX idx_page_schemas_page ON page_schemas(page_id);
CREATE INDEX idx_page_schemas_valid ON page_schemas(is_valid);
CREATE TRIGGER set_page_schemas_updated_at BEFORE UPDATE ON page_schemas
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- 12. page_internal_links
-- Purpose: Internal link graph per client. Built by A-06 (Phase 1.5).
CREATE TABLE page_internal_links (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  client_id       UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  source_page_id  UUID NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
  target_page_id  UUID NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
  anchor_text     TEXT NOT NULL,
  link_tier       INTEGER CHECK (link_tier IN (1,2,3)),
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE page_internal_links ENABLE ROW LEVEL SECURITY;
CREATE POLICY "operators_see_link_graph" ON page_internal_links
  FOR ALL TO authenticated
  USING (client_id IN (SELECT id FROM clients WHERE operator_id = auth.uid()));
CREATE INDEX idx_internal_links_source ON page_internal_links(source_page_id);
CREATE INDEX idx_internal_links_target ON page_internal_links(target_page_id);
CREATE INDEX idx_internal_links_client ON page_internal_links(client_id);

-- 13. page_sitemaps
-- Purpose: Versioned XML sitemaps per client. Updated on publish. A-07 (Phase 1.5).
CREATE TABLE page_sitemaps (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  client_id     UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  sitemap_xml   TEXT NOT NULL,
  page_count    INTEGER NOT NULL,
  segment       TEXT,
  is_current    BOOLEAN DEFAULT TRUE,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE page_sitemaps ENABLE ROW LEVEL SECURITY;
CREATE POLICY "operators_see_client_sitemaps" ON page_sitemaps
  FOR ALL TO authenticated
  USING (client_id IN (SELECT id FROM clients WHERE operator_id = auth.uid()));
CREATE INDEX idx_page_sitemaps_current ON page_sitemaps(client_id, is_current)
  WHERE is_current = TRUE;

-- =============================================================================
-- GROUP 3: CONTENT INTELLIGENCE (Tables 14-16)
-- =============================================================================

-- 14. claimed_facts
-- Purpose: Verified facts A-02 is permitted to reference. Unverified claims stripped.
CREATE TABLE claimed_facts (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  client_id     UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  fact_type     TEXT NOT NULL,
  fact_value    TEXT NOT NULL,
  verified      BOOLEAN DEFAULT FALSE,
  evidence_url  TEXT,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE claimed_facts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "operators_see_client_facts" ON claimed_facts
  FOR ALL TO authenticated
  USING (client_id IN (SELECT id FROM clients WHERE operator_id = auth.uid()));
CREATE INDEX idx_claimed_facts_client ON claimed_facts(client_id);
CREATE INDEX idx_claimed_facts_verified ON claimed_facts(verified);
CREATE TRIGGER set_claimed_facts_updated_at BEFORE UPDATE ON claimed_facts
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- 15. service_area_heatmaps
-- Purpose: 5km×5km grid cell data per client service area. Built by A-10.
CREATE TABLE service_area_heatmaps (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  client_id           UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  city_id             UUID NOT NULL REFERENCES cities(id) ON DELETE CASCADE,
  grid_cells          JSONB NOT NULL DEFAULT '[]',
  total_cells         INTEGER,
  reachable_cells     INTEGER,
  population_density  NUMERIC(10,2),
  generated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at          TIMESTAMPTZ,
  created_at          TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE service_area_heatmaps ENABLE ROW LEVEL SECURITY;
CREATE POLICY "operators_see_heatmaps" ON service_area_heatmaps
  FOR ALL TO authenticated
  USING (client_id IN (SELECT id FROM clients WHERE operator_id = auth.uid()));
CREATE INDEX idx_service_area_heatmaps_client ON service_area_heatmaps(client_id);
CREATE INDEX idx_service_area_heatmaps_generated ON service_area_heatmaps(generated_at DESC);

-- 16. evidence_items
-- Purpose: Photos, job records, certifications per client. Used by A-02 for content grounding.
CREATE TABLE evidence_items (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  client_id       UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  evidence_type   evidence_type NOT NULL,
  storage_url     TEXT NOT NULL,
  caption         TEXT,
  city_id         UUID REFERENCES cities(id),
  service_id      UUID REFERENCES services(id),
  job_date        DATE,
  verified        BOOLEAN DEFAULT FALSE,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  deleted_at      TIMESTAMPTZ
);

ALTER TABLE evidence_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "operators_see_client_evidence" ON evidence_items
  FOR ALL TO authenticated
  USING (client_id IN (SELECT id FROM clients WHERE operator_id = auth.uid()));
CREATE INDEX idx_evidence_client ON evidence_items(client_id);
CREATE INDEX idx_evidence_type ON evidence_items(evidence_type);

-- =============================================================================
-- GROUP 4: COMPLIANCE & LEGAL (Tables 17-21)
-- =============================================================================

-- 17. conversions
-- Purpose: Form submissions and call tracking. TCPA consent immutable after insert.
CREATE TABLE conversions (
  id                      UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  client_id               UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  page_id                 UUID REFERENCES pages(id),
  conversion_type         conversion_type NOT NULL,
  contact_name            TEXT,
  contact_phone_last_four TEXT,
  contact_email           TEXT,
  contact_address         TEXT,
  consent_client_entity   TEXT NOT NULL,
  tcpa_consent_text       TEXT NOT NULL,
  tcpa_consent_given      BOOLEAN NOT NULL,
  tcpa_consent_timestamp  TIMESTAMPTZ NOT NULL,
  tcpa_consent_ip         INET NOT NULL,
  tcpa_consent_ua         TEXT NOT NULL,
  callrail_call_id        TEXT,
  source_url              TEXT,
  created_at              TIMESTAMPTZ DEFAULT NOW()
);

-- TCPA Immutability Trigger — consent fields cannot be updated after insert
CREATE OR REPLACE FUNCTION prevent_consent_mutation()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD.tcpa_consent_text != NEW.tcpa_consent_text OR
     OLD.tcpa_consent_given != NEW.tcpa_consent_given OR
     OLD.tcpa_consent_timestamp != NEW.tcpa_consent_timestamp OR
     OLD.tcpa_consent_ip != NEW.tcpa_consent_ip OR
     OLD.tcpa_consent_ua != NEW.tcpa_consent_ua THEN
    RAISE EXCEPTION 'TCPA consent fields are immutable after insert';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER conversions_consent_immutability
  BEFORE UPDATE ON conversions
  FOR EACH ROW EXECUTE FUNCTION prevent_consent_mutation();

ALTER TABLE conversions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "operators_see_client_conversions" ON conversions
  FOR ALL TO authenticated
  USING (client_id IN (SELECT id FROM clients WHERE operator_id = auth.uid()));
CREATE INDEX idx_conversions_client ON conversions(client_id);
CREATE INDEX idx_conversions_created ON conversions(created_at DESC);
CREATE INDEX idx_conversions_page ON conversions(page_id);

-- 18. dsars
-- Purpose: Data Subject Access Requests — CPRA/GDPR compliance.
CREATE TABLE dsars (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  client_id       UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  requester_email TEXT NOT NULL,
  request_type    TEXT NOT NULL
    CHECK (request_type IN ('access','deletion','correction','portability')),
  status          dsar_status NOT NULL DEFAULT 'submitted',
  due_date        DATE NOT NULL,
  completed_at    TIMESTAMPTZ,
  notes           TEXT,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE dsars ENABLE ROW LEVEL SECURITY;
CREATE POLICY "operators_see_client_dsars" ON dsars
  FOR ALL TO authenticated
  USING (client_id IN (SELECT id FROM clients WHERE operator_id = auth.uid()));
CREATE INDEX idx_dsars_status ON dsars(status);
CREATE INDEX idx_dsars_due_date ON dsars(due_date);
CREATE TRIGGER set_dsars_updated_at BEFORE UPDATE ON dsars
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- 19. dsars_audit_log
-- Purpose: Immutable audit trail for every DSAR action.
CREATE TABLE dsars_audit_log (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  dsar_id       UUID NOT NULL REFERENCES dsars(id) ON DELETE CASCADE,
  action        TEXT NOT NULL,
  performed_by  UUID,
  notes         TEXT,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE dsars_audit_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "operators_see_dsar_log" ON dsars_audit_log
  FOR ALL TO authenticated
  USING (dsar_id IN (
    SELECT d.id FROM dsars d
    JOIN clients c ON d.client_id = c.id
    WHERE c.operator_id = auth.uid()
  ));
CREATE INDEX idx_dsar_log_dsar ON dsars_audit_log(dsar_id);

-- 20. sub_processors
-- Purpose: CPRA/GDPR sub-processor documentation. Operator managed.
CREATE TABLE sub_processors (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name            TEXT NOT NULL,
  purpose         TEXT NOT NULL,
  data_types      TEXT[] NOT NULL DEFAULT '{}',
  location        TEXT NOT NULL,
  privacy_url     TEXT,
  active          BOOLEAN DEFAULT TRUE,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE sub_processors ENABLE ROW LEVEL SECURITY;
CREATE POLICY "authenticated_read_subprocessors" ON sub_processors
  FOR SELECT TO authenticated USING (TRUE);
CREATE TRIGGER set_sub_processors_updated_at BEFORE UPDATE ON sub_processors
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Insert known sub-processors at migration time
INSERT INTO sub_processors (name, purpose, data_types, location, privacy_url) VALUES
  ('Supabase', 'Database and authentication', ARRAY['all'], 'USA', 'https://supabase.com/privacy'),
  ('Anthropic', 'LLM content generation', ARRAY['business_data'], 'USA', 'https://anthropic.com/privacy'),
  ('Google Cloud', 'Maps, Places, GBP, Search Console APIs', ARRAY['location','business_data'], 'USA', 'https://policies.google.com/privacy'),
  ('Stripe', 'Payment processing', ARRAY['payment_data'], 'USA', 'https://stripe.com/privacy'),
  ('Twilio', 'Call tracking, SMS', ARRAY['phone'], 'USA', 'https://twilio.com/privacy'),
  ('Resend', 'Email delivery', ARRAY['email'], 'USA', 'https://resend.com/privacy'),
  ('Vercel', 'Application hosting', ARRAY['request_logs'], 'USA', 'https://vercel.com/privacy'),
  ('DocuSign', 'Contract signatures', ARRAY['identity','signature'], 'USA', 'https://docusign.com/privacy'),
  ('PostHog', 'Analytics and session replay', ARRAY['usage_data'], 'USA', 'https://posthog.com/privacy'),
  ('CallRail', 'Call tracking', ARRAY['phone','call_recordings'], 'USA', 'https://callrail.com/privacy');

-- 21. domains
-- Purpose: Custom domains per client for white-label. Phase 3.
CREATE TABLE domains (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  client_id       UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  domain          TEXT NOT NULL UNIQUE,
  verified        BOOLEAN DEFAULT FALSE,
  ssl_active      BOOLEAN DEFAULT FALSE,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE domains ENABLE ROW LEVEL SECURITY;
CREATE POLICY "operators_see_client_domains" ON domains
  FOR ALL TO authenticated
  USING (client_id IN (SELECT id FROM clients WHERE operator_id = auth.uid()));
CREATE INDEX idx_domains_client ON domains(client_id);
CREATE TRIGGER set_domains_updated_at BEFORE UPDATE ON domains
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- =============================================================================
-- GROUP 5: AGENT OPERATIONS (Tables 22-24)
-- =============================================================================

-- 22. agent_events
-- Purpose: Immutable log of every agent action. Debugging, billing, audit trail.
CREATE TABLE agent_events (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  client_id         UUID REFERENCES clients(id) ON DELETE SET NULL,
  agent             agent_name NOT NULL,
  event_type        TEXT NOT NULL,
  payload           JSONB DEFAULT '{}',
  error_message     TEXT,
  duration_ms       INTEGER,
  prompt_tokens     INTEGER,
  completion_tokens INTEGER,
  cost_usd          NUMERIC(8,6),
  created_at        TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE agent_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "operators_see_client_events" ON agent_events
  FOR ALL TO authenticated
  USING (
    client_id IS NULL OR
    client_id IN (SELECT id FROM clients WHERE operator_id = auth.uid())
  );
CREATE INDEX idx_agent_events_client ON agent_events(client_id, created_at DESC);
CREATE INDEX idx_agent_events_agent ON agent_events(agent, created_at DESC);
CREATE INDEX idx_agent_events_type ON agent_events(event_type);

-- 23. platform_config
-- Purpose: Feature flags and platform configuration. Read by all agents. Write by operator only.
CREATE TABLE platform_config (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  feature_key   TEXT NOT NULL UNIQUE,
  enabled       BOOLEAN NOT NULL DEFAULT FALSE,
  phase         TEXT NOT NULL,
  agent         TEXT,
  description   TEXT,
  updated_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_by    UUID
);

ALTER TABLE platform_config ENABLE ROW LEVEL SECURITY;
CREATE POLICY "authenticated_read_config" ON platform_config
  FOR SELECT TO authenticated USING (TRUE);
CREATE POLICY "operators_write_config" ON platform_config
  FOR ALL TO authenticated USING (TRUE);

INSERT INTO platform_config (feature_key, enabled, phase, agent, description) VALUES
  ('intake_processor',          TRUE,  '1',   'A-01',    'Client onboarding and validation'),
  ('content_profile_builder',   TRUE,  '1',   'A-10',    '4-layer differentiation + heatmap'),
  ('page_generator',            TRUE,  '1',   'A-02',    'LLM content generation'),
  ('page_validator',            TRUE,  '1',   'A-05',    '15-gate quality check'),
  ('drip_publisher',            TRUE,  '1',   'CRON-01', 'Velocity-throttled publishing'),
  ('schema_generator',          FALSE, '1.5', 'A-03',    'JSON-LD structured data'),
  ('map_embed_generator',       FALSE, '1.5', 'A-04',    'Google Maps iframe + Twilio number'),
  ('internal_link_builder',     FALSE, '1.5', 'A-06',    'Hub-and-spoke internal linking'),
  ('sitemap_generator',         FALSE, '1.5', 'A-07',    'XML sitemap + robots.txt'),
  ('gbp_agent',                 FALSE, '1.5', 'A-12',    'GBP management + suspension prevention'),
  ('indexation_tracker',        FALSE, '2',   'A-08',    'GSC API indexation monitoring'),
  ('conversion_handler',        FALSE, '2',   'A-09',    'Form + CallRail webhook processor'),
  ('content_refresh',           FALSE, '2',   'A-11',    'Monthly top-page refresh cycle'),
  ('ai_visibility_tracker',     FALSE, '2',   'A-13',    'ChatGPT/Gemini/Perplexity tracking'),
  ('review_velocity',           FALSE, '2',   'A-14',    'Review request automation'),
  ('gbp_post_generator',        FALSE, '2',   'A-15',    'Automated GBP post creation'),
  ('qa_seed_manager',           FALSE, '2',   'A-16',    'GBP Q&A auto-population'),
  ('entity_consistency',        FALSE, '2',   'A-17',    'NAP consistency monitoring'),
  ('job_evidence_pipeline',     FALSE, '2',   'A-18',    'Job completion content pipeline'),
  ('universal_integration_hub', FALSE, '2',   'A-19',    'ServiceTitan/Jobber webhook router'),
  ('indexation_runner',         FALSE, '2',   'CRON-02', 'Daily GSC batch + pruning'),
  ('storm_intelligence_engine', FALSE, '3',   NULL,      'NOAA storm detection + page activation'),
  ('ai_visibility_premium',     FALSE, '3',   NULL,      'AI visibility premium add-on'),
  ('white_label_api',           FALSE, '3',   NULL,      'Reseller API access');

-- 24. stack_jobs
-- Purpose: Background job state tracking for pgmq queue.
CREATE TABLE stack_jobs (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  client_id     UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  job_type      TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','processing','completed','failed')),
  payload       JSONB DEFAULT '{}',
  result        JSONB,
  error         TEXT,
  attempts      INTEGER DEFAULT 0,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW(),
  completed_at  TIMESTAMPTZ
);

ALTER TABLE stack_jobs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "operators_see_client_jobs" ON stack_jobs
  FOR ALL TO authenticated
  USING (client_id IN (SELECT id FROM clients WHERE operator_id = auth.uid()));
CREATE INDEX idx_stack_jobs_client ON stack_jobs(client_id);
CREATE INDEX idx_stack_jobs_status ON stack_jobs(status, created_at);
CREATE TRIGGER set_stack_jobs_updated_at BEFORE UPDATE ON stack_jobs
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- =============================================================================
-- GROUP 6: GBP & ACTIVITY MOAT (Tables 25-30) — Phase 2
-- All empty until feature flags enabled
-- =============================================================================

-- 25. gbp_profiles
-- Purpose: GBP profile state and completeness per client. A-12.
CREATE TABLE gbp_profiles (
  id                    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  client_id             UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  gbp_location_id       TEXT NOT NULL,
  completeness_score    INTEGER CHECK (completeness_score BETWEEN 0 AND 100),
  last_edit_at          TIMESTAMPTZ,
  edits_today           INTEGER DEFAULT 0,
  suspicious_edits      INTEGER DEFAULT 0,
  image_category_scores JSONB DEFAULT '{}',
  raw_profile           JSONB,
  last_synced_at        TIMESTAMPTZ,
  created_at            TIMESTAMPTZ DEFAULT NOW(),
  updated_at            TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE gbp_profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "operators_see_gbp_profiles" ON gbp_profiles
  FOR ALL TO authenticated
  USING (client_id IN (SELECT id FROM clients WHERE operator_id = auth.uid()));
CREATE INDEX idx_gbp_profiles_client ON gbp_profiles(client_id);
CREATE TRIGGER set_gbp_profiles_updated_at BEFORE UPDATE ON gbp_profiles
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- 26. gbp_posts
-- Purpose: GBP posts generated by A-15.
CREATE TABLE gbp_posts (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  client_id     UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  city_id       UUID REFERENCES cities(id),
  job_evidence_id UUID,
  post_type     TEXT NOT NULL CHECK (post_type IN ('update','offer','event','product')),
  headline      TEXT NOT NULL,
  body          TEXT NOT NULL,
  cta_type      TEXT,
  cta_url       TEXT,
  photo_urls    TEXT[] DEFAULT '{}',
  status        gbp_post_status NOT NULL DEFAULT 'draft',
  scheduled_at  TIMESTAMPTZ,
  published_at  TIMESTAMPTZ,
  gbp_post_id   TEXT,
  storm_event_id UUID,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE gbp_posts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "operators_see_client_posts" ON gbp_posts
  FOR ALL TO authenticated
  USING (client_id IN (SELECT id FROM clients WHERE operator_id = auth.uid()));
CREATE INDEX idx_gbp_posts_client ON gbp_posts(client_id);
CREATE INDEX idx_gbp_posts_status ON gbp_posts(status);
CREATE TRIGGER set_gbp_posts_updated_at BEFORE UPDATE ON gbp_posts
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- 27. review_requests
-- Purpose: Review request tracking by A-14.
CREATE TABLE review_requests (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  client_id       UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  job_evidence_id UUID,
  contact_phone   TEXT,
  contact_email   TEXT,
  status          review_request_status NOT NULL DEFAULT 'pending',
  channel         TEXT NOT NULL CHECK (channel IN ('sms','email','both')),
  sent_at         TIMESTAMPTZ,
  clicked_at      TIMESTAMPTZ,
  review_url      TEXT,
  velocity_tier   TEXT CHECK (velocity_tier IN ('slow','healthy','suspicious')),
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE review_requests ENABLE ROW LEVEL SECURITY;
CREATE POLICY "operators_see_client_reviews" ON review_requests
  FOR ALL TO authenticated
  USING (client_id IN (SELECT id FROM clients WHERE operator_id = auth.uid()));
CREATE INDEX idx_review_requests_client ON review_requests(client_id);
CREATE INDEX idx_review_requests_status ON review_requests(status);
CREATE TRIGGER set_review_requests_updated_at BEFORE UPDATE ON review_requests
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- 28. qa_seeds
-- Purpose: GBP Q&A entries seeded by A-16.
CREATE TABLE qa_seeds (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  client_id     UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  question      TEXT NOT NULL,
  answer        TEXT NOT NULL,
  category      TEXT NOT NULL
    CHECK (category IN ('service','pricing','availability','location','process')),
  priority      TEXT NOT NULL CHECK (priority IN ('high','medium','low')),
  published     BOOLEAN DEFAULT FALSE,
  gbp_qa_id     TEXT,
  scheduled_at  TIMESTAMPTZ,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE qa_seeds ENABLE ROW LEVEL SECURITY;
CREATE POLICY "operators_see_client_qa" ON qa_seeds
  FOR ALL TO authenticated
  USING (client_id IN (SELECT id FROM clients WHERE operator_id = auth.uid()));
CREATE INDEX idx_qa_seeds_client ON qa_seeds(client_id);
CREATE INDEX idx_qa_seeds_published ON qa_seeds(published);

-- 29. entity_audit_log
-- Purpose: NAP consistency monitoring by A-17.
CREATE TABLE entity_audit_log (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  client_id       UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  field_checked   TEXT NOT NULL,
  expected_value  TEXT NOT NULL,
  found_value     TEXT,
  source          TEXT NOT NULL,
  is_consistent   BOOLEAN NOT NULL,
  auto_corrected  BOOLEAN DEFAULT FALSE,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE entity_audit_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "operators_see_entity_log" ON entity_audit_log
  FOR ALL TO authenticated
  USING (client_id IN (SELECT id FROM clients WHERE operator_id = auth.uid()));
CREATE INDEX idx_entity_audit_client ON entity_audit_log(client_id, created_at DESC);

-- 30. job_evidence
-- Purpose: Completed job records from A-18 / field service integrations.
CREATE TABLE job_evidence (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  client_id         UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  city_id           UUID REFERENCES cities(id),
  service_id        UUID REFERENCES services(id),
  source_system     integration_type NOT NULL,
  external_job_id   TEXT NOT NULL,
  job_date          DATE NOT NULL,
  job_address       TEXT,
  job_latitude      NUMERIC(10,7),
  job_longitude     NUMERIC(10,7),
  job_description   TEXT,
  photos_collected  INTEGER DEFAULT 0,
  photo_urls        TEXT[] DEFAULT '{}',
  processed         BOOLEAN DEFAULT FALSE,
  created_at        TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE job_evidence ENABLE ROW LEVEL SECURITY;
CREATE POLICY "operators_see_job_evidence" ON job_evidence
  FOR ALL TO authenticated
  USING (client_id IN (SELECT id FROM clients WHERE operator_id = auth.uid()));
CREATE INDEX idx_job_evidence_client ON job_evidence(client_id);
CREATE INDEX idx_job_evidence_processed ON job_evidence(processed) WHERE processed = FALSE;

-- =============================================================================
-- GROUP 7: INTEGRATIONS (Table 31) — Phase 2
-- =============================================================================

-- 31. client_integrations
-- Purpose: Field service software connection config per client.
CREATE TABLE client_integrations (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  client_id         UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  integration_type  integration_type NOT NULL,
  api_key_encrypted TEXT,
  webhook_secret    TEXT,
  webhook_token     TEXT UNIQUE,
  is_active         BOOLEAN DEFAULT FALSE,
  last_sync_at      TIMESTAMPTZ,
  created_at        TIMESTAMPTZ DEFAULT NOW(),
  updated_at        TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE client_integrations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "operators_see_client_integrations" ON client_integrations
  FOR ALL TO authenticated
  USING (client_id IN (SELECT id FROM clients WHERE operator_id = auth.uid()));
CREATE INDEX idx_client_integrations_client ON client_integrations(client_id);
CREATE INDEX idx_client_integrations_token ON client_integrations(webhook_token);
CREATE TRIGGER set_client_integrations_updated_at BEFORE UPDATE ON client_integrations
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- =============================================================================
-- GROUP 8: PERFORMANCE TRACKING (Tables 32-33) — Phase 2
-- =============================================================================

-- 32. indexation_records
-- Purpose: GSC API data per page. A-08.
CREATE TABLE indexation_records (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  page_id           UUID NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
  client_id         UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  coverage_state    TEXT,
  impressions_28d   INTEGER,
  clicks_28d        INTEGER,
  avg_position_28d  NUMERIC(5,2),
  is_indexed        BOOLEAN,
  last_checked_at   TIMESTAMPTZ NOT NULL,
  created_at        TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE indexation_records ENABLE ROW LEVEL SECURITY;
CREATE POLICY "operators_see_indexation" ON indexation_records
  FOR ALL TO authenticated
  USING (client_id IN (SELECT id FROM clients WHERE operator_id = auth.uid()));
CREATE INDEX idx_indexation_page ON indexation_records(page_id, last_checked_at DESC);
CREATE INDEX idx_indexation_client ON indexation_records(client_id);

-- 33. ai_visibility_scores
-- Purpose: AI platform rank tracking by A-13.
CREATE TABLE ai_visibility_scores (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  client_id       UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  platform        TEXT NOT NULL
    CHECK (platform IN ('chatgpt','gemini','perplexity','google_ai_overview')),
  query_used      TEXT NOT NULL,
  rank_position   INTEGER,
  mentioned       BOOLEAN NOT NULL,
  sentiment       TEXT CHECK (sentiment IN ('positive','neutral','negative')),
  checked_at      TIMESTAMPTZ NOT NULL,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE ai_visibility_scores ENABLE ROW LEVEL SECURITY;
CREATE POLICY "operators_see_ai_visibility" ON ai_visibility_scores
  FOR ALL TO authenticated
  USING (client_id IN (SELECT id FROM clients WHERE operator_id = auth.uid()));
CREATE INDEX idx_ai_visibility_client ON ai_visibility_scores(client_id, checked_at DESC);

-- =============================================================================
-- GROUP 9: STORM INTELLIGENCE ENGINE (Tables 34-37) — Phase 3
-- Tables present, all empty until Phase 3 begins
-- =============================================================================

-- 34. storm_events
-- Purpose: NOAA/SPC storm events detected by the Storm Intelligence Engine.
CREATE TABLE storm_events (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  source          signal_source NOT NULL,
  event_type      TEXT NOT NULL CHECK (event_type IN ('hail','wind','tornado','flood','freeze')),
  severity        TEXT NOT NULL CHECK (severity IN ('minor','moderate','severe','extreme')),
  hail_size_inches NUMERIC(4,2),
  affected_zips   TEXT[] NOT NULL DEFAULT '{}',
  latitude        NUMERIC(10,7),
  longitude       NUMERIC(10,7),
  event_at        TIMESTAMPTZ NOT NULL,
  detected_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  processed       BOOLEAN DEFAULT FALSE,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE storm_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "authenticated_read_storm_events" ON storm_events
  FOR SELECT TO authenticated USING (TRUE);
CREATE INDEX idx_storm_events_zips ON storm_events USING GIN(affected_zips);
CREATE INDEX idx_storm_events_detected ON storm_events(detected_at DESC);
CREATE INDEX idx_storm_events_processed ON storm_events(processed) WHERE processed = FALSE;

-- 35. page_activations
-- Purpose: Tracks dynamic content injections per page per storm event.
CREATE TABLE page_activations (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  page_id           UUID NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
  client_id         UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  storm_event_id    UUID NOT NULL REFERENCES storm_events(id),
  content_block     TEXT NOT NULL,
  activated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deactivated_at    TIMESTAMPTZ,
  is_active         BOOLEAN DEFAULT TRUE
);

ALTER TABLE page_activations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "operators_see_page_activations" ON page_activations
  FOR ALL TO authenticated
  USING (client_id IN (SELECT id FROM clients WHERE operator_id = auth.uid()));
CREATE INDEX idx_page_activations_page ON page_activations(page_id);
CREATE INDEX idx_page_activations_storm ON page_activations(storm_event_id);
CREATE INDEX idx_page_activations_active ON page_activations(is_active) WHERE is_active = TRUE;

-- 36. signal_leads
-- Purpose: Enriched lead records from storm and intent signal detection.
CREATE TABLE signal_leads (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  client_id         UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  storm_event_id    UUID REFERENCES storm_events(id),
  signal_source     signal_source NOT NULL,
  zip_code          TEXT NOT NULL,
  property_address  TEXT,
  attom_id          TEXT,
  estimated_value   INTEGER,
  lead_score        INTEGER CHECK (lead_score BETWEEN 0 AND 100),
  homeowner_name    TEXT,
  contact_method    TEXT,
  routed_at         TIMESTAMPTZ,
  routed_to         TEXT,
  created_at        TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE signal_leads ENABLE ROW LEVEL SECURITY;
CREATE POLICY "operators_see_signal_leads" ON signal_leads
  FOR ALL TO authenticated
  USING (client_id IN (SELECT id FROM clients WHERE operator_id = auth.uid()));
CREATE INDEX idx_signal_leads_client ON signal_leads(client_id);
CREATE INDEX idx_signal_leads_score ON signal_leads(lead_score DESC);
CREATE INDEX idx_signal_leads_zip ON signal_leads(zip_code);

-- 37. retargeting_events
-- Purpose: Meta Pixel + Google Tag fire log per page visit.
CREATE TABLE retargeting_events (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  page_id       UUID NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
  client_id     UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  platform      TEXT NOT NULL CHECK (platform IN ('meta','google')),
  event_type    TEXT NOT NULL,
  visitor_ip    INET,
  user_agent    TEXT,
  fired_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE retargeting_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "operators_see_retargeting" ON retargeting_events
  FOR ALL TO authenticated
  USING (client_id IN (SELECT id FROM clients WHERE operator_id = auth.uid()));
CREATE INDEX idx_retargeting_page ON retargeting_events(page_id, fired_at DESC);
CREATE INDEX idx_retargeting_client ON retargeting_events(client_id);

-- =============================================================================
-- CRON SCHEDULE
-- =============================================================================

SELECT cron.schedule(
  'tarritrix-drip-publisher',
  '0 3 * * *',
  $$SELECT net.http_post(
    url := current_setting('app.supabase_url') || '/functions/v1/cron-drip-publisher',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || current_setting('app.service_role_key')
    )
  )$$
);

SELECT cron.schedule(
  'tarritrix-indexation-runner',
  '0 6 * * *',
  $$SELECT net.http_post(
    url := current_setting('app.supabase_url') || '/functions/v1/cron-indexation-runner',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || current_setting('app.service_role_key')
    )
  )$$
);
```

---

## TABLE INVENTORY

| # | Table | Group | Phase Active | Agents |
|---|---|---|---|---|
| 1 | pricing_tiers | Core | 1 | A-01, CRON-01 |
| 2 | clients | Core | 1 | A-01, all |
| 3 | services | Core | 1 | A-01, A-10, A-02 |
| 4 | cities | Core | 1 | A-01, A-10, A-02 |
| 5 | subscriptions | Billing | 1 | Stripe webhook |
| 6 | invoices | Billing | 1 | Stripe webhook |
| 7 | page_generation_queue | Pages | 1 | A-01, A-02 |
| 8 | pages | Pages | 1 | A-02, A-05, CRON-01 |
| 9 | page_content_profile | Pages | 1 | A-10, A-02 |
| 10 | page_quality_scores | Pages | 1 | A-05 |
| 11 | page_schemas | Pages | 1.5 | A-03 |
| 12 | page_internal_links | Pages | 1.5 | A-06 |
| 13 | page_sitemaps | Pages | 1.5 | A-07 |
| 14 | claimed_facts | Content | 1 | A-02 read |
| 15 | service_area_heatmaps | Content | 1 | A-10 |
| 16 | evidence_items | Content | 1 | A-02 read |
| 17 | conversions | Compliance | 2 | A-09 |
| 18 | dsars | Compliance | 1 | Operator |
| 19 | dsars_audit_log | Compliance | 1 | Operator |
| 20 | sub_processors | Compliance | 1 | Reference |
| 21 | domains | Compliance | 3 | White-label |
| 22 | agent_events | Ops | 1 | All agents |
| 23 | platform_config | Ops | 1 | All agents |
| 24 | stack_jobs | Ops | 1 | A-02, pgmq |
| 25 | gbp_profiles | GBP | 1.5 | A-12 |
| 26 | gbp_posts | GBP | 2 | A-15 |
| 27 | review_requests | GBP | 2 | A-14 |
| 28 | qa_seeds | GBP | 2 | A-16 |
| 29 | entity_audit_log | GBP | 2 | A-17 |
| 30 | job_evidence | Jobs | 2 | A-18 |
| 31 | client_integrations | Jobs | 2 | A-19 |
| 32 | indexation_records | Performance | 2 | A-08 |
| 33 | ai_visibility_scores | Performance | 2 | A-13 |
| 34 | storm_events | Storm | 3 | Storm Engine |
| 35 | page_activations | Storm | 3 | Storm Engine |
| 36 | signal_leads | Storm | 3 | Storm Engine |
| 37 | retargeting_events | Storm | 3 | Storm Engine |

**Total: 37 tables. All created in Migration 001. Zero tables added later unless a new feature requires a genuinely new data shape requiring a new versioned migration file.**
