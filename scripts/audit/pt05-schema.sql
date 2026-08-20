-- ============================================================================
-- PT-05 isolation environment schema.
--
-- Minimal, real-shaped subset of the production public schema (per
-- test-evidence/pt-06/live-schema.json + integrity.json, live-verified
-- 2026-08-20), applied against a LOCAL Supabase CLI stack (not production).
-- Covers organizations, profiles (FK to auth.users), and the tenant-scoped
-- tables named in the PT-05 task plus the minimal supporting parent tables
-- needed to satisfy their real foreign keys (funders, donor_discovery_directory,
-- donor_discovery_requests).
--
-- Column names, types, nullability, and FK targets are copied directly from
-- the real production schema snapshot -- not invented. Enum labels were
-- read live, read-only, from production (see pt05-001-provision-isolation-env.mjs).
-- ============================================================================

create extension if not exists pgcrypto;

create type user_role as enum ('owner','admin','writer','viewer');
create type funder_category as enum (
  'corporate_donation','corporate_sponsorship','corporate_foundation',
  'private_foundation','government_grant','local_community_grant',
  'housing_grant','education_grant','faith_compatible_grant',
  'in_kind_donation','materials_donation','down_payment_assistance'
);
create type opportunity_status as enum ('open','applied','closed','expired');
create type pipeline_stage as enum (
  'discovered','eligibility_review','qualified','drafting','awaiting_documents',
  'ready_for_review','submitted','follow_up_due','awarded','denied',
  'reporting_required','renewal_opportunity'
);
create type draft_template_type as enum (
  'grant_narrative','donation_request_letter','budget_narrative',
  'impact_statement','letter_of_inquiry','full_proposal'
);
create type humanization_status as enum ('not_humanized','pending','humanized','failed');
create type contact_relationship as enum ('cold','warm','active','champion');
create type donor_discovery_pipeline_stage as enum (
  'new','reviewing','contacted','applied','received','rejected','archived'
);
create type donor_discovery_request_status as enum (
  'queued','enumerating','enriching','scoring','complete','failed'
);
create type deadline_type as enum (
  'application_deadline','follow_up_date','reporting_deadline',
  'renewal_date','document_expiration'
);

-- --------------------------------------------------------------------------
-- organizations (tenant root)
-- --------------------------------------------------------------------------
create table organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  ein text,
  mission_statement text,
  service_area text,
  onboarding_completed boolean not null default false,
  onboarding_step integer not null default 0,
  onboarding_progress jsonb not null default '{}'::jsonb,
  extended_profile jsonb not null default '{}'::jsonb,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- --------------------------------------------------------------------------
-- profiles (real FK: profiles.id -> auth.users.id, profiles.organization_id -> organizations.id)
-- --------------------------------------------------------------------------
create table profiles (
  id uuid primary key references auth.users(id),
  organization_id uuid not null references organizations(id),
  email text not null,
  full_name text,
  role user_role not null default 'viewer',
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- --------------------------------------------------------------------------
-- funders (parent of opportunities.funder_id, contacts.funder_id)
-- --------------------------------------------------------------------------
create table funders (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  name text not null,
  category funder_category not null,
  description text,
  created_at timestamptz default now()
);

-- --------------------------------------------------------------------------
-- opportunities
-- --------------------------------------------------------------------------
create table opportunities (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  funder_id uuid references funders(id),
  name text not null,
  category funder_category not null,
  description text,
  amount_min numeric,
  amount_max numeric,
  deadline timestamptz,
  eligibility_requirements text,
  required_documents text[],
  status opportunity_status default 'open',
  is_high_priority boolean not null default false,
  match_mismatch_reasons text[],
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- --------------------------------------------------------------------------
-- applications
-- --------------------------------------------------------------------------
create table applications (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  opportunity_id uuid not null references opportunities(id),
  stage pipeline_stage not null default 'discovered',
  assigned_user_id uuid references profiles(id),
  requested_amount numeric,
  draft_content text,
  draft_template_type draft_template_type,
  notes text,
  knowledge_patterns_applied jsonb not null default '[]'::jsonb,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- --------------------------------------------------------------------------
-- draft_versions ("drafts")
-- --------------------------------------------------------------------------
create table draft_versions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  opportunity_id uuid not null references opportunities(id),
  application_id uuid references applications(id),
  template_type draft_template_type not null,
  content text not null,
  confidence_score integer,
  version_number integer not null,
  humanization_status humanization_status not null default 'not_humanized',
  source text not null default 'generated',
  created_by uuid references profiles(id),
  created_at timestamptz default now()
);

-- --------------------------------------------------------------------------
-- contacts
-- --------------------------------------------------------------------------
create table contacts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  funder_id uuid not null references funders(id),
  name text not null,
  title text,
  email text,
  phone text,
  relationship contact_relationship default 'cold',
  notes text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- --------------------------------------------------------------------------
-- donor_discovery_directory (parent of donor_discovery_prospects.directory_id;
-- NOT tenant-scoped in production -- shared cross-org directory)
-- --------------------------------------------------------------------------
create table donor_discovery_directory (
  id uuid primary key default gen_random_uuid(),
  legal_name text not null,
  naics_codes text[] not null default '{}',
  website text,
  created_at timestamptz default now()
);

-- --------------------------------------------------------------------------
-- donor_discovery_requests (parent of donor_discovery_prospects.request_id)
-- --------------------------------------------------------------------------
create table donor_discovery_requests (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  name text not null,
  taxonomy_ids uuid[] not null default '{}',
  geography jsonb not null default '{}'::jsonb,
  status donor_discovery_request_status not null default 'queued',
  counts jsonb not null default '{}'::jsonb,
  created_by uuid references profiles(id),
  created_at timestamptz default now()
);

-- --------------------------------------------------------------------------
-- donor_discovery_prospects
-- --------------------------------------------------------------------------
create table donor_discovery_prospects (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  directory_id uuid not null references donor_discovery_directory(id),
  request_id uuid not null references donor_discovery_requests(id),
  score integer,
  score_rationale text,
  pipeline_stage donor_discovery_pipeline_stage not null default 'new',
  notes text,
  assigned_to uuid references profiles(id),
  created_at timestamptz not null default now()
);

-- --------------------------------------------------------------------------
-- deadlines
-- --------------------------------------------------------------------------
create table deadlines (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  application_id uuid references applications(id),
  opportunity_id uuid references opportunities(id),
  deadline_type deadline_type not null,
  due_date date not null,
  title text not null,
  description text,
  is_completed boolean default false,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
