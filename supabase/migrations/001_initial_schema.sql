-- ============================================================================
-- BENAVORA — Migration 001: Initial Schema
-- Generated from SCHEMA_REGISTRY.md v1.0
--
-- Single-pass migration. Creates all enum types, 24 tables, foreign keys,
-- CHECK constraints, indexes, RLS policies, and seeds platform_config
-- defaults per organization via trigger.
--
-- Strategy: All tables (including Phase 2+) created Day 1, empty, gated by
-- feature flags in platform_config.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Extensions
-- ----------------------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS "pgcrypto"; -- gen_random_uuid()

-- ============================================================================
-- ENUM TYPES
-- ============================================================================

CREATE TYPE user_role AS ENUM ('owner', 'admin', 'writer', 'viewer');

CREATE TYPE funder_category AS ENUM (
  'corporate_donation', 'corporate_sponsorship', 'corporate_foundation',
  'private_foundation', 'government_grant', 'local_community_grant',
  'housing_grant', 'education_grant', 'faith_compatible_grant',
  'in_kind_donation', 'materials_donation', 'down_payment_assistance'
);

CREATE TYPE pipeline_stage AS ENUM (
  'discovered', 'eligibility_review', 'qualified', 'drafting',
  'awaiting_documents', 'ready_for_review', 'submitted',
  'follow_up_due', 'awarded', 'denied', 'reporting_required',
  'renewal_opportunity'
);

CREATE TYPE outcome_result AS ENUM ('awarded', 'denied', 'partial');

CREATE TYPE document_category AS ENUM (
  'tax_documents', 'legal_documents', 'financial_documents',
  'program_documents', 'marketing_materials', 'letters_of_support',
  'application_attachments', 'photos'
);

CREATE TYPE deadline_type AS ENUM (
  'application_deadline', 'follow_up_date', 'reporting_deadline',
  'renewal_date', 'document_expiration'
);

CREATE TYPE draft_template_type AS ENUM (
  'grant_narrative', 'donation_request_letter', 'budget_narrative',
  'impact_statement', 'letter_of_inquiry', 'full_proposal'
);

CREATE TYPE contact_relationship AS ENUM ('cold', 'warm', 'active', 'champion');

CREATE TYPE opportunity_status AS ENUM ('open', 'applied', 'closed', 'expired');

CREATE TYPE knowledge_base_category AS ENUM (
  'mission', 'vision', 'need_statement', 'program_description',
  'impact', 'capacity', 'sustainability', 'partnerships',
  'budget_justification', 'organizational_history', 'custom'
);

CREATE TYPE agent_type AS ENUM (
  'corporate_research', 'foundation_research', 'government_research',
  'local_sponsorship', 'eligibility_scoring', 'deadline_extraction',
  'grant_summary', 'fit_analysis', 'narrative_drafting', 'budget_builder',
  'compliance_check', 'review', 'final_assembly', 'recursive_learning',
  'cold_outreach'
);

CREATE TYPE agent_run_status AS ENUM ('pending', 'running', 'completed', 'failed');

CREATE TYPE campaign_status AS ENUM ('draft', 'active', 'paused', 'completed');

CREATE TYPE campaign_step_status AS ENUM ('pending', 'sent', 'opened', 'replied', 'bounced');

-- ============================================================================
-- HELPER FUNCTION — current user's organization_id
-- SECURITY DEFINER bypasses RLS internally so policies that reference
-- profiles (including the policy ON profiles) do not recurse.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.current_org_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT organization_id FROM public.profiles WHERE id = auth.uid();
$$;

-- ============================================================================
-- TABLES
-- ============================================================================

-- 1. organizations -----------------------------------------------------------
CREATE TABLE organizations (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name                text NOT NULL,
  dba                 text,
  ein                 text,
  tax_status          text,
  mission_statement   text,
  vision_statement    text,
  founding_date       date,
  founder_name        text,
  founder_bio         text,
  service_area        text,
  target_population   text,
  annual_budget       numeric(12,2),
  total_staff         integer DEFAULT 0,
  total_volunteers    integer DEFAULT 0,
  website             text,
  phone               text,
  email               text,
  address_line1       text,
  address_line2       text,
  city                text,
  state               text,
  zip                 text,
  logo_url            text,
  stripe_customer_id  text,
  subscription_tier   text DEFAULT 'free',
  created_at          timestamptz DEFAULT now(),
  updated_at          timestamptz DEFAULT now()
);
CREATE INDEX idx_organizations_ein ON organizations (ein);

-- 2. profiles ----------------------------------------------------------------
CREATE TABLE profiles (
  id               uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  organization_id  uuid NOT NULL REFERENCES organizations(id),
  email            text NOT NULL,
  full_name        text,
  role             user_role NOT NULL DEFAULT 'viewer',
  avatar_url       text,
  last_login_at    timestamptz,
  created_at       timestamptz DEFAULT now(),
  updated_at       timestamptz DEFAULT now()
);
CREATE INDEX idx_profiles_org ON profiles (organization_id);
CREATE INDEX idx_profiles_email ON profiles (email);

-- 3. funders -----------------------------------------------------------------
CREATE TABLE funders (
  id                            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id               uuid NOT NULL REFERENCES organizations(id),
  name                          text NOT NULL,
  category                      funder_category NOT NULL,
  description                   text,
  website                       text,
  giving_portal_url             text,
  portal_login_status           text,
  annual_giving_budget          numeric(12,2),
  geographic_focus              text,
  preferred_application_method  text,
  has_giving_page               boolean DEFAULT true,
  notes                         text,
  last_contacted_at             timestamptz,
  created_at                    timestamptz DEFAULT now(),
  updated_at                    timestamptz DEFAULT now()
);
CREATE INDEX idx_funders_org ON funders (organization_id);
CREATE INDEX idx_funders_category ON funders (category);
CREATE INDEX idx_funders_name ON funders (name);

-- 4. contacts ----------------------------------------------------------------
CREATE TABLE contacts (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id           uuid NOT NULL REFERENCES organizations(id),
  funder_id                 uuid NOT NULL REFERENCES funders(id) ON DELETE CASCADE,
  name                      text NOT NULL,
  title                     text,
  email                     text,
  phone                     text,
  preferred_contact_method  text,
  relationship              contact_relationship DEFAULT 'cold',
  last_contacted_at         timestamptz,
  notes                     text,
  created_at                timestamptz DEFAULT now(),
  updated_at                timestamptz DEFAULT now()
);
CREATE INDEX idx_contacts_org ON contacts (organization_id);
CREATE INDEX idx_contacts_funder ON contacts (funder_id);

-- 5. opportunities -----------------------------------------------------------
CREATE TABLE opportunities (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id           uuid NOT NULL REFERENCES organizations(id),
  funder_id                 uuid REFERENCES funders(id) ON DELETE SET NULL,
  name                      text NOT NULL,
  category                  funder_category NOT NULL,
  description               text,
  amount_available          numeric(12,2),
  amount_min                numeric(12,2),
  amount_max                numeric(12,2),
  deadline                  timestamptz,
  url                       text,
  eligibility_requirements  text,
  required_documents        text[],
  application_method        text,
  recurrence                text,
  geographic_restrictions   text,
  eligibility_score         integer CHECK (eligibility_score >= 0 AND eligibility_score <= 100),
  recommendation            text,
  recommendation_reasoning  text,
  status                    opportunity_status DEFAULT 'open',
  source                    text,
  discovered_at             timestamptz DEFAULT now(),
  created_at                timestamptz DEFAULT now(),
  updated_at                timestamptz DEFAULT now()
);
CREATE INDEX idx_opportunities_org ON opportunities (organization_id);
CREATE INDEX idx_opportunities_funder ON opportunities (funder_id);
CREATE INDEX idx_opportunities_category ON opportunities (category);
CREATE INDEX idx_opportunities_deadline ON opportunities (deadline);
CREATE INDEX idx_opportunities_status ON opportunities (status);

-- 6. opportunity_keywords ----------------------------------------------------
CREATE TABLE opportunity_keywords (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid NOT NULL REFERENCES organizations(id),
  opportunity_id   uuid NOT NULL REFERENCES opportunities(id) ON DELETE CASCADE,
  keyword          text NOT NULL,
  created_at       timestamptz DEFAULT now()
);
CREATE INDEX idx_opp_keywords_opp ON opportunity_keywords (opportunity_id);
CREATE INDEX idx_opp_keywords_keyword ON opportunity_keywords (keyword);

-- 7. applications ------------------------------------------------------------
CREATE TABLE applications (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id           uuid NOT NULL REFERENCES organizations(id),
  opportunity_id            uuid NOT NULL REFERENCES opportunities(id),
  stage                     pipeline_stage NOT NULL DEFAULT 'discovered',
  assigned_user_id          uuid REFERENCES profiles(id),
  requested_amount          numeric(12,2),
  submitted_at              timestamptz,
  awarded_amount            numeric(12,2),
  draft_content             text,
  draft_template_type       draft_template_type,
  draft_confidence_score    integer,
  draft_knowledge_sources   jsonb,
  notes                     text,
  created_at                timestamptz DEFAULT now(),
  updated_at                timestamptz DEFAULT now()
);
CREATE INDEX idx_applications_org ON applications (organization_id);
CREATE INDEX idx_applications_opp ON applications (opportunity_id);
CREATE INDEX idx_applications_stage ON applications (stage);
CREATE INDEX idx_applications_assigned ON applications (assigned_user_id);

-- 8. pipeline_history --------------------------------------------------------
CREATE TABLE pipeline_history (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid NOT NULL REFERENCES organizations(id),
  application_id   uuid NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
  from_stage       pipeline_stage,
  to_stage         pipeline_stage NOT NULL,
  changed_by       uuid REFERENCES profiles(id),
  notes            text,
  created_at       timestamptz DEFAULT now()
);
CREATE INDEX idx_pipeline_history_app ON pipeline_history (application_id);
CREATE INDEX idx_pipeline_history_date ON pipeline_history (created_at);

-- 9. documents ---------------------------------------------------------------
CREATE TABLE documents (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid NOT NULL REFERENCES organizations(id),
  file_name        text NOT NULL,
  storage_path     text NOT NULL,
  file_size        bigint,
  mime_type        text,
  category         document_category NOT NULL,
  description      text,
  expiration_date  date,
  uploaded_by      uuid REFERENCES profiles(id),
  created_at       timestamptz DEFAULT now(),
  updated_at       timestamptz DEFAULT now()
);
CREATE INDEX idx_documents_org ON documents (organization_id);
CREATE INDEX idx_documents_category ON documents (category);

-- 10. application_documents --------------------------------------------------
CREATE TABLE application_documents (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id  uuid NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
  document_id     uuid NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  created_at      timestamptz DEFAULT now(),
  CONSTRAINT uq_application_documents UNIQUE (application_id, document_id)
);

-- 11. knowledge_base ---------------------------------------------------------
CREATE TABLE knowledge_base (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id    uuid NOT NULL REFERENCES organizations(id),
  category           knowledge_base_category NOT NULL,
  title              text NOT NULL,
  content            text NOT NULL,
  is_proven          boolean DEFAULT false,
  proven_count       integer DEFAULT 0,
  funder_categories  funder_category[],
  keywords           text[],
  version            integer DEFAULT 1,
  created_by         uuid REFERENCES profiles(id),
  created_at         timestamptz DEFAULT now(),
  updated_at         timestamptz DEFAULT now()
);
CREATE INDEX idx_kb_org ON knowledge_base (organization_id);
CREATE INDEX idx_kb_category ON knowledge_base (category);
CREATE INDEX idx_kb_proven ON knowledge_base (is_proven);
CREATE INDEX idx_kb_keywords ON knowledge_base USING GIN (keywords);

-- 12. board_members ----------------------------------------------------------
CREATE TABLE board_members (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid NOT NULL REFERENCES organizations(id),
  name             text NOT NULL,
  title            text,
  bio              text,
  email            text,
  phone            text,
  start_date       date,
  is_active        boolean DEFAULT true,
  created_at       timestamptz DEFAULT now(),
  updated_at       timestamptz DEFAULT now()
);

-- 13. programs ---------------------------------------------------------------
CREATE TABLE programs (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id       uuid NOT NULL REFERENCES organizations(id),
  name                  text NOT NULL,
  description           text,
  budget                numeric(12,2),
  beneficiaries_served  integer,
  start_date            date,
  status                text DEFAULT 'active',
  impact_metrics        jsonb,
  created_at            timestamptz DEFAULT now(),
  updated_at            timestamptz DEFAULT now()
);

-- 14. outcomes ---------------------------------------------------------------
CREATE TABLE outcomes (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id       uuid NOT NULL REFERENCES organizations(id),
  application_id        uuid NOT NULL UNIQUE REFERENCES applications(id),
  result                outcome_result NOT NULL,
  awarded_amount        numeric(12,2),
  requested_amount      numeric(12,2),
  funder_feedback       text,
  denial_reason         text,
  narrative_snapshot    text,
  funder_category       funder_category,
  opportunity_category  funder_category,
  keywords_used         text[],
  recorded_by           uuid REFERENCES profiles(id),
  recorded_at           timestamptz DEFAULT now(),
  created_at            timestamptz DEFAULT now()
);
CREATE INDEX idx_outcomes_org ON outcomes (organization_id);
CREATE INDEX idx_outcomes_app ON outcomes (application_id);
CREATE INDEX idx_outcomes_result ON outcomes (result);
CREATE INDEX idx_outcomes_funder_cat ON outcomes (funder_category);

-- 15. proven_narratives ------------------------------------------------------
CREATE TABLE proven_narratives (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id     uuid NOT NULL REFERENCES organizations(id),
  outcome_id          uuid NOT NULL REFERENCES outcomes(id),
  knowledge_base_id   uuid REFERENCES knowledge_base(id),
  narrative_text      text NOT NULL,
  section_type        text,
  funder_category     funder_category,
  success_count       integer DEFAULT 1,
  effectiveness_score numeric(5,2),
  last_used_at        timestamptz,
  created_at          timestamptz DEFAULT now()
);
CREATE INDEX idx_proven_org ON proven_narratives (organization_id);
CREATE INDEX idx_proven_category ON proven_narratives (funder_category);
CREATE INDEX idx_proven_score ON proven_narratives (effectiveness_score DESC);

-- 16. deadlines --------------------------------------------------------------
CREATE TABLE deadlines (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id    uuid NOT NULL REFERENCES organizations(id),
  application_id     uuid REFERENCES applications(id) ON DELETE CASCADE,
  opportunity_id     uuid REFERENCES opportunities(id) ON DELETE CASCADE,
  deadline_type      deadline_type NOT NULL,
  due_date           date NOT NULL,
  title              text NOT NULL,
  description        text,
  is_completed       boolean DEFAULT false,
  completed_at       timestamptz,
  reminder_30d_sent  boolean DEFAULT false,
  reminder_14d_sent  boolean DEFAULT false,
  reminder_7d_sent   boolean DEFAULT false,
  reminder_3d_sent   boolean DEFAULT false,
  reminder_1d_sent   boolean DEFAULT false,
  created_at         timestamptz DEFAULT now(),
  updated_at         timestamptz DEFAULT now()
);
CREATE INDEX idx_deadlines_org ON deadlines (organization_id);
CREATE INDEX idx_deadlines_due ON deadlines (due_date);
CREATE INDEX idx_deadlines_completed ON deadlines (is_completed);

-- 17. notes ------------------------------------------------------------------
CREATE TABLE notes (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid NOT NULL REFERENCES organizations(id),
  funder_id        uuid REFERENCES funders(id) ON DELETE CASCADE,
  opportunity_id   uuid REFERENCES opportunities(id) ON DELETE CASCADE,
  application_id   uuid REFERENCES applications(id) ON DELETE CASCADE,
  content          text NOT NULL,
  author_id        uuid REFERENCES profiles(id),
  created_at       timestamptz DEFAULT now(),
  updated_at       timestamptz DEFAULT now(),
  CONSTRAINT notes_exactly_one_parent
    CHECK (num_nonnulls(funder_id, opportunity_id, application_id) = 1)
);
CREATE INDEX idx_notes_funder ON notes (funder_id);
CREATE INDEX idx_notes_opp ON notes (opportunity_id);
CREATE INDEX idx_notes_app ON notes (application_id);

-- 18. search_profiles --------------------------------------------------------
CREATE TABLE search_profiles (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id        uuid NOT NULL REFERENCES organizations(id),
  name                   text NOT NULL,
  keywords               text[] NOT NULL,
  categories             funder_category[],
  geographic_scope       text,
  min_amount             numeric(12,2),
  max_amount             numeric(12,2),
  recurrence_preference  text,
  is_active              boolean DEFAULT true,
  last_run_at            timestamptz,
  results_count          integer DEFAULT 0,
  created_at             timestamptz DEFAULT now(),
  updated_at             timestamptz DEFAULT now()
);

-- 19. email_campaigns --------------------------------------------------------
-- (Defined before outreach_contacts to satisfy campaign_id FK in one pass.)
CREATE TABLE email_campaigns (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid NOT NULL REFERENCES organizations(id),
  name             text NOT NULL,
  status           campaign_status DEFAULT 'draft',
  total_steps      integer DEFAULT 0,
  total_contacts   integer DEFAULT 0,
  created_by       uuid REFERENCES profiles(id),
  created_at       timestamptz DEFAULT now(),
  updated_at       timestamptz DEFAULT now()
);

-- 20. campaign_steps ---------------------------------------------------------
CREATE TABLE campaign_steps (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id       uuid NOT NULL REFERENCES email_campaigns(id) ON DELETE CASCADE,
  step_number       integer NOT NULL,
  subject_template  text NOT NULL,
  body_template     text NOT NULL,
  delay_days        integer NOT NULL DEFAULT 0,
  created_at        timestamptz DEFAULT now()
);

-- 21. outreach_contacts ------------------------------------------------------
CREATE TABLE outreach_contacts (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id          uuid NOT NULL REFERENCES organizations(id),
  company_name             text NOT NULL,
  contact_name             text,
  email                    text,
  phone                    text,
  contact_form_url         text,
  source_url               text,
  company_type             text,
  giving_likelihood        text,
  campaign_id              uuid REFERENCES email_campaigns(id),
  status                   text DEFAULT 'new',
  converted_to_funder_id   uuid REFERENCES funders(id),
  created_at               timestamptz DEFAULT now(),
  updated_at               timestamptz DEFAULT now()
);

-- 22. campaign_sends ---------------------------------------------------------
CREATE TABLE campaign_sends (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_step_id     uuid NOT NULL REFERENCES campaign_steps(id),
  outreach_contact_id  uuid NOT NULL REFERENCES outreach_contacts(id),
  status               campaign_step_status DEFAULT 'pending',
  sent_at              timestamptz,
  opened_at            timestamptz,
  replied_at           timestamptz,
  created_at           timestamptz DEFAULT now()
);

-- 23. agent_runs -------------------------------------------------------------
CREATE TABLE agent_runs (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid NOT NULL REFERENCES organizations(id),
  agent_type       agent_type NOT NULL,
  status           agent_run_status DEFAULT 'pending',
  input_params     jsonb,
  output_summary   text,
  items_found      integer DEFAULT 0,
  items_processed  integer DEFAULT 0,
  error_message    text,
  tokens_used      integer,
  duration_ms      integer,
  triggered_by     uuid REFERENCES profiles(id),
  started_at       timestamptz,
  completed_at     timestamptz,
  created_at       timestamptz DEFAULT now()
);
CREATE INDEX idx_agent_runs_org ON agent_runs (organization_id);
CREATE INDEX idx_agent_runs_type ON agent_runs (agent_type);
CREATE INDEX idx_agent_runs_status ON agent_runs (status);

-- 24. platform_config --------------------------------------------------------
CREATE TABLE platform_config (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  uuid NOT NULL REFERENCES organizations(id),
  key              text NOT NULL,
  value            text NOT NULL,
  created_at       timestamptz DEFAULT now(),
  updated_at       timestamptz DEFAULT now(),
  CONSTRAINT uq_platform_config_org_key UNIQUE (organization_id, key)
);

-- ============================================================================
-- ROW LEVEL SECURITY
-- Master policy pattern: organization_id = public.current_org_id()
-- Junction tables without organization_id traverse to their parent.
-- ============================================================================

-- Tables with a direct organization_id column ------------------------------

ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "organizations_org_isolation" ON organizations
  USING (id = public.current_org_id());

ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "profiles_org_isolation" ON profiles
  USING (id = auth.uid() OR organization_id = public.current_org_id());

ALTER TABLE funders ENABLE ROW LEVEL SECURITY;
CREATE POLICY "funders_org_isolation" ON funders
  USING (organization_id = public.current_org_id());

ALTER TABLE contacts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "contacts_org_isolation" ON contacts
  USING (organization_id = public.current_org_id());

ALTER TABLE opportunities ENABLE ROW LEVEL SECURITY;
CREATE POLICY "opportunities_org_isolation" ON opportunities
  USING (organization_id = public.current_org_id());

ALTER TABLE opportunity_keywords ENABLE ROW LEVEL SECURITY;
CREATE POLICY "opportunity_keywords_org_isolation" ON opportunity_keywords
  USING (organization_id = public.current_org_id());

ALTER TABLE applications ENABLE ROW LEVEL SECURITY;
CREATE POLICY "applications_org_isolation" ON applications
  USING (organization_id = public.current_org_id());

ALTER TABLE pipeline_history ENABLE ROW LEVEL SECURITY;
CREATE POLICY "pipeline_history_org_isolation" ON pipeline_history
  USING (organization_id = public.current_org_id());

ALTER TABLE documents ENABLE ROW LEVEL SECURITY;
CREATE POLICY "documents_org_isolation" ON documents
  USING (organization_id = public.current_org_id());

ALTER TABLE knowledge_base ENABLE ROW LEVEL SECURITY;
CREATE POLICY "knowledge_base_org_isolation" ON knowledge_base
  USING (organization_id = public.current_org_id());

ALTER TABLE board_members ENABLE ROW LEVEL SECURITY;
CREATE POLICY "board_members_org_isolation" ON board_members
  USING (organization_id = public.current_org_id());

ALTER TABLE programs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "programs_org_isolation" ON programs
  USING (organization_id = public.current_org_id());

ALTER TABLE outcomes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "outcomes_org_isolation" ON outcomes
  USING (organization_id = public.current_org_id());

ALTER TABLE proven_narratives ENABLE ROW LEVEL SECURITY;
CREATE POLICY "proven_narratives_org_isolation" ON proven_narratives
  USING (organization_id = public.current_org_id());

ALTER TABLE deadlines ENABLE ROW LEVEL SECURITY;
CREATE POLICY "deadlines_org_isolation" ON deadlines
  USING (organization_id = public.current_org_id());

ALTER TABLE notes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "notes_org_isolation" ON notes
  USING (organization_id = public.current_org_id());

ALTER TABLE search_profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "search_profiles_org_isolation" ON search_profiles
  USING (organization_id = public.current_org_id());

ALTER TABLE email_campaigns ENABLE ROW LEVEL SECURITY;
CREATE POLICY "email_campaigns_org_isolation" ON email_campaigns
  USING (organization_id = public.current_org_id());

ALTER TABLE outreach_contacts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "outreach_contacts_org_isolation" ON outreach_contacts
  USING (organization_id = public.current_org_id());

ALTER TABLE agent_runs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "agent_runs_org_isolation" ON agent_runs
  USING (organization_id = public.current_org_id());

ALTER TABLE platform_config ENABLE ROW LEVEL SECURITY;
CREATE POLICY "platform_config_org_isolation" ON platform_config
  USING (organization_id = public.current_org_id());

-- Junction tables without organization_id (isolation via parent) ------------

ALTER TABLE application_documents ENABLE ROW LEVEL SECURITY;
CREATE POLICY "application_documents_org_isolation" ON application_documents
  USING (
    application_id IN (
      SELECT id FROM applications WHERE organization_id = public.current_org_id()
    )
  );

ALTER TABLE campaign_steps ENABLE ROW LEVEL SECURITY;
CREATE POLICY "campaign_steps_org_isolation" ON campaign_steps
  USING (
    campaign_id IN (
      SELECT id FROM email_campaigns WHERE organization_id = public.current_org_id()
    )
  );

ALTER TABLE campaign_sends ENABLE ROW LEVEL SECURITY;
CREATE POLICY "campaign_sends_org_isolation" ON campaign_sends
  USING (
    campaign_step_id IN (
      SELECT cs.id FROM campaign_steps cs
      JOIN email_campaigns ec ON ec.id = cs.campaign_id
      WHERE ec.organization_id = public.current_org_id()
    )
  );

-- ============================================================================
-- PLATFORM CONFIG SEEDING
-- platform_config.organization_id is NOT NULL, so defaults cannot exist as
-- standalone rows. Per SCHEMA_REGISTRY ("seeded per organization"), defaults
-- are inserted by trigger whenever a new organization is created.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.seed_default_platform_config()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO platform_config (organization_id, key, value) VALUES
    (NEW.id, 'feature.research_agents',          'false'),
    (NEW.id, 'feature.browser_automation',       'false'),
    (NEW.id, 'feature.email_integration',        'false'),
    (NEW.id, 'feature.cold_outreach_email',      'false'),
    (NEW.id, 'feature.stripe_billing',           'false'),
    (NEW.id, 'ai.model',                         'claude-sonnet-4-6'),
    (NEW.id, 'ai.max_tokens',                    '4096'),
    (NEW.id, 'ai.confidence_threshold',          '70'),
    (NEW.id, 'learning.min_outcomes_for_scoring','5'),
    (NEW.id, 'learning.proven_narrative_threshold','2');
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_seed_platform_config
  AFTER INSERT ON organizations
  FOR EACH ROW
  EXECUTE FUNCTION public.seed_default_platform_config();

-- ============================================================================
-- END Migration 001
-- ============================================================================
