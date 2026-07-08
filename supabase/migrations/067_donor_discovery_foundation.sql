-- 067_donor_discovery_foundation.sql — Donor Discovery engine, Phase 1 schema
-- (DONOR_DISCOVERY_ARCHITECTURE.md §1C, §3, §6). Five tables: taxonomy and
-- directory are shared platform-wide reference data (no organization_id, no
-- RLS — same posture as foundation_directory, migration 046); requests,
-- prospects, and connectors are tenant-scoped with RLS following the funders
-- table's single-policy master pattern (organization_id = public.current_org_id(),
-- see migration 001).
--
-- File only — not applied to production per this task's instructions.

-- ── Enums ────────────────────────────────────────────────────────────────────
CREATE TYPE donor_discovery_taxonomy_kind AS ENUM ('naics', 'civic', 'association');

CREATE TYPE donor_discovery_request_status AS ENUM (
  'queued', 'enumerating', 'enriching', 'scoring', 'complete', 'failed'
);

CREATE TYPE donor_discovery_pipeline_stage AS ENUM (
  'new', 'reviewing', 'contacted', 'applied', 'received', 'rejected', 'archived'
);

CREATE TYPE donor_discovery_connector_provider AS ENUM ('apollo', 'hunter', 'zoominfo', 'clay');

CREATE TYPE donor_discovery_connector_status AS ENUM ('pending', 'active', 'invalid', 'revoked');

-- ── donor_discovery_taxonomy (§1C) ──────────────────────────────────────────
-- SHARED, no organization_id: seeded once (NAICS codes + civic entity types),
-- subscribers reference nodes but never edit them. No RLS — same posture as
-- foundation_directory (migration 046).
create table public.donor_discovery_taxonomy (
  id               uuid primary key default gen_random_uuid(),
  kind             donor_discovery_taxonomy_kind not null,
  code             text not null,
  label            text not null,
  parent_id        uuid references public.donor_discovery_taxonomy(id) on delete set null,
  default_sources  jsonb not null default '[]'::jsonb,
  created_at       timestamptz not null default now()
);

create unique index donor_discovery_taxonomy_kind_code_idx on public.donor_discovery_taxonomy(kind, code);
create index donor_discovery_taxonomy_parent_id_idx on public.donor_discovery_taxonomy(parent_id);

-- ── donor_discovery_requests (§3) ────────────────────────────────────────────
create table public.donor_discovery_requests (
  id             uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name           text not null,
  taxonomy_ids   uuid[] not null default '{}',
  geography      jsonb not null default '{}'::jsonb,
  status         donor_discovery_request_status not null default 'queued',
  counts         jsonb not null default '{}'::jsonb,
  created_by     uuid references public.profiles(id),
  created_at     timestamptz not null default now(),
  completed_at   timestamptz
);

alter table public.donor_discovery_requests enable row level security;

create policy "donor_discovery_requests_org_isolation" on public.donor_discovery_requests
  using (organization_id = public.current_org_id());

create index donor_discovery_requests_organization_id_status_idx on public.donor_discovery_requests(organization_id, status);

-- ── donor_discovery_directory (§3) ───────────────────────────────────────────
-- SHARED, no organization_id: the compounding-moat directory populated by
-- enumeration/enrichment across all tenants. No RLS — same posture as
-- foundation_directory (migration 046).
create table public.donor_discovery_directory (
  id               uuid primary key default gen_random_uuid(),
  legal_name       text not null,
  dba_name         text,
  naics_codes      text[] not null default '{}',
  civic_kind       text,
  website          text,
  hq_address       text,
  geo              point,
  phone            text,
  enrichment       jsonb not null default '{}'::jsonb,
  enriched_at      timestamptz,
  source_adapters  text[] not null default '{}',
  created_at       timestamptz not null default now()
);

-- Extracts a bare, lowercased host (no scheme/www/path/port) for directory
-- dedup. IMMUTABLE so it can back a unique index.
create or replace function public.donor_discovery_extract_domain(url text)
returns text
language sql
immutable
as $$
  select lower(regexp_replace(url, '^(?:https?://)?(?:www\.)?([^/:?#]+).*$', '\1'))
  where url is not null and btrim(url) <> '';
$$;

-- Dedup key: same legal name + same website domain is the same company.
-- NULLs (no website on file) don't collide, per Postgres unique-index semantics.
create unique index donor_discovery_directory_dedup_idx
  on public.donor_discovery_directory (lower(legal_name), public.donor_discovery_extract_domain(website));

create index donor_discovery_directory_geo_idx on public.donor_discovery_directory using gist(geo);

-- ── donor_discovery_prospects (§3) ───────────────────────────────────────────
create table public.donor_discovery_prospects (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations(id) on delete cascade,
  directory_id     uuid not null references public.donor_discovery_directory(id) on delete cascade,
  request_id       uuid not null references public.donor_discovery_requests(id) on delete cascade,
  score            integer check (score >= 0 and score <= 100),
  score_rationale  text,
  pipeline_stage   donor_discovery_pipeline_stage not null default 'new',
  notes            text,
  assigned_to      uuid references public.profiles(id),
  created_at       timestamptz not null default now()
);

alter table public.donor_discovery_prospects enable row level security;

create policy "donor_discovery_prospects_org_isolation" on public.donor_discovery_prospects
  using (organization_id = public.current_org_id());

create index donor_discovery_prospects_organization_id_pipeline_stage_idx on public.donor_discovery_prospects(organization_id, pipeline_stage);
create index donor_discovery_prospects_score_idx on public.donor_discovery_prospects(score desc);
create index donor_discovery_prospects_directory_id_idx on public.donor_discovery_prospects(directory_id);
create index donor_discovery_prospects_request_id_idx on public.donor_discovery_prospects(request_id);

-- ── donor_discovery_connectors (§6) ──────────────────────────────────────────
-- BYO-key third-party enrichment connectors (Apollo/Hunter/etc). API keys are
-- encrypted at rest by the application layer before insert, same pattern as
-- the existing BYO-key infrastructure (July 4 audit work).
create table public.donor_discovery_connectors (
  id                 uuid primary key default gen_random_uuid(),
  organization_id    uuid not null references public.organizations(id) on delete cascade,
  provider           donor_discovery_connector_provider not null,
  encrypted_api_key  text not null,
  status             donor_discovery_connector_status not null default 'pending',
  activated_at       timestamptz,
  created_at         timestamptz not null default now(),
  unique (organization_id, provider)
);

alter table public.donor_discovery_connectors enable row level security;

create policy "donor_discovery_connectors_org_isolation" on public.donor_discovery_connectors
  using (organization_id = public.current_org_id());

create index donor_discovery_connectors_organization_id_idx on public.donor_discovery_connectors(organization_id);
