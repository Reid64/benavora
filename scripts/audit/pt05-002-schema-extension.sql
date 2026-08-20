-- ============================================================================
-- PT-05-002 schema extension -- applied on top of pt05-schema.sql (PT-05-001).
--
-- Adds:
--   1. public.current_org_id() -- the exact real production function
--      (fetched read-only via pg_get_functiondef, not reconstructed from
--      memory), which the 7 already-seeded tables' real RLS policies call.
--   2. RLS enabled + the real production policy (same predicate, same
--      "_org_isolation" naming) on the 7 tables PT-05-001 seeded but never
--      enabled RLS on (funders, opportunities, applications, draft_versions,
--      contacts, donor_discovery_prospects, deadlines).
--   3. Thirteen new tables, one per PT-06 tenant_fk_gap finding
--      (integrity.json, check=tenant_fk_gap) -- these are the tables flagged
--      as carrying an organization_id/org_id column with NO live FK
--      constraint to organizations, and are this task's named "prime
--      suspects". Columns are copied verbatim from
--      test-evidence/pt-06/live-schema.json (name/type/nullability/default);
--      the tenant column deliberately has NO foreign key, matching
--      production's real (flawed) state exactly -- this is not an oversight,
--      it is the condition under test. Each table's real RLS policy (fetched
--      read-only from production via pg_policies) is reproduced verbatim.
--
-- Every policy predicate below is a byte-for-byte copy of what
-- pt05-002-fetch-production-rls.mjs read from the live production
-- pg_policies table -- not reconstructed from convention or memory.
-- ============================================================================

-- --------------------------------------------------------------------------
-- 1. current_org_id() -- exact copy of the real production function
-- --------------------------------------------------------------------------
create or replace function public.current_org_id()
returns uuid
language sql
stable security definer
set search_path to 'public'
as $function$
  select organization_id from public.profiles where id = auth.uid();
$function$;

-- --------------------------------------------------------------------------
-- 2. RLS on the 7 already-seeded tables (real production policy: ALL roles
--    public, qual = organization_id = current_org_id())
-- --------------------------------------------------------------------------
alter table funders enable row level security;
create policy funders_org_isolation on funders for all
  using (organization_id = current_org_id());

alter table opportunities enable row level security;
create policy opportunities_org_isolation on opportunities for all
  using (organization_id = current_org_id());

alter table applications enable row level security;
create policy applications_org_isolation on applications for all
  using (organization_id = current_org_id());

alter table draft_versions enable row level security;
create policy draft_versions_org_isolation on draft_versions for all
  using (organization_id = current_org_id());

alter table contacts enable row level security;
create policy contacts_org_isolation on contacts for all
  using (organization_id = current_org_id());

alter table donor_discovery_prospects enable row level security;
create policy donor_discovery_prospects_org_isolation on donor_discovery_prospects for all
  using (organization_id = current_org_id());

alter table deadlines enable row level security;
create policy deadlines_org_isolation on deadlines for all
  using (organization_id = current_org_id());

-- --------------------------------------------------------------------------
-- 3. The 13 PT-06 tenant_fk_gap tables -- prime suspects, extra scrutiny.
--    Tenant column has NO foreign key (matches production exactly).
-- --------------------------------------------------------------------------

create table adapter_usage_log (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid,
  adapter_name text not null,
  api_cost_cents integer not null default 0,
  records_returned integer not null default 0,
  cache_hit boolean not null default false,
  called_at timestamptz not null default now()
);
alter table adapter_usage_log enable row level security;
create policy adapter_usage_log_org_select on adapter_usage_log for select to authenticated
  using (organization_id = ( select profiles.organization_id from profiles where (profiles.id = auth.uid()) ));
create policy adapter_usage_log_org_insert on adapter_usage_log for insert to authenticated
  with check (organization_id = ( select profiles.organization_id from profiles where (profiles.id = auth.uid()) ));

create table agent_configurations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  agent_id text not null,
  enabled boolean default false,
  config jsonb default '{}'::jsonb,
  last_run_at timestamptz,
  run_count integer default 0,
  total_tokens_consumed integer default 0,
  created_at timestamptz default now(),
  updated_at timestamptz not null default now()
);
alter table agent_configurations enable row level security;
create policy agent_configurations_org on agent_configurations for all
  using (organization_id = ( select profiles.organization_id from profiles where (profiles.id = auth.uid()) ));

create table autoapply_review_queue (
  id uuid primary key default gen_random_uuid(),
  submission_id uuid,
  organization_id uuid not null,
  funder_id uuid not null references funders(id),
  reason text not null,
  failure_count integer not null default 0,
  status text not null default 'pending',
  assigned_to uuid,
  resolved_at timestamptz,
  resolution_notes text,
  created_at timestamptz default now()
);
alter table autoapply_review_queue enable row level security;
create policy autoapply_review_queue_org_select on autoapply_review_queue for select to authenticated
  using (organization_id = ( select profiles.organization_id from profiles where (profiles.id = auth.uid()) ));
create policy autoapply_review_queue_org_insert on autoapply_review_queue for insert to authenticated
  with check (organization_id = ( select profiles.organization_id from profiles where (profiles.id = auth.uid()) ));
create policy autoapply_review_queue_org_update on autoapply_review_queue for update to authenticated
  using (organization_id = ( select profiles.organization_id from profiles where (profiles.id = auth.uid()) ));

create table board_meetings (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  meeting_date date not null,
  meeting_type text not null default 'regular',
  agenda text,
  status text not null default 'scheduled',
  created_at timestamptz not null default now()
);
alter table board_meetings enable row level security;
create policy board_meetings_org on board_meetings for all
  using (org_id = ( select profiles.organization_id from profiles where (profiles.id = auth.uid()) ));

create table board_meeting_packets (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  meeting_id uuid references board_meetings(id),
  packet_content jsonb not null,
  generated_at timestamptz not null default now(),
  viewed_by uuid[]
);
alter table board_meeting_packets enable row level security;
create policy board_packets_org on board_meeting_packets for all
  using (org_id = ( select profiles.organization_id from profiles where (profiles.id = auth.uid()) ));

create table discovery_matches (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  opportunity_id uuid references opportunities(id),
  external_title text,
  external_source text,
  external_url text,
  discovery_run_id uuid,
  match_score numeric,
  match_reasons text[],
  status text default 'pending',
  actioned_at timestamptz,
  created_at timestamptz default now()
);
alter table discovery_matches enable row level security;
create policy discovery_matches_org_select on discovery_matches for select to authenticated
  using (org_id = ( select profiles.organization_id from profiles where (profiles.id = auth.uid()) ));
create policy discovery_matches_org_insert on discovery_matches for insert to authenticated
  with check (org_id = ( select profiles.organization_id from profiles where (profiles.id = auth.uid()) ));
create policy discovery_matches_org_update on discovery_matches for update to authenticated
  using (org_id = ( select profiles.organization_id from profiles where (profiles.id = auth.uid()) ));

create table funding_forecasts (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  forecast_date date not null,
  forecast_period text not null,
  projected_min numeric,
  projected_max numeric,
  projected_most_likely numeric,
  confidence numeric,
  methodology text,
  factors jsonb not null default '{}'::jsonb,
  key_risks text[],
  key_opportunities text[],
  recommended_actions text[],
  created_at timestamptz not null default now()
);
alter table funding_forecasts enable row level security;
create policy forecasts_org on funding_forecasts for all
  using (org_id = ( select profiles.organization_id from profiles where (profiles.id = auth.uid()) ));

create table impact_simulations (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  scenario_type text not null,
  scenario_params jsonb not null,
  simulation_result jsonb,
  confidence text,
  generated_at timestamptz not null default now(),
  created_by uuid
);
alter table impact_simulations enable row level security;
create policy simulations_org on impact_simulations for all
  using (org_id = ( select profiles.organization_id from profiles where (profiles.id = auth.uid()) ));

create table knowledge_queries (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null,
  query_text text not null,
  results jsonb,
  created_at timestamptz default now()
);
alter table knowledge_queries enable row level security;
create policy knowledge_queries_org_select on knowledge_queries for select to authenticated
  using (org_id = ( select profiles.organization_id from profiles where (profiles.id = auth.uid()) ));
create policy knowledge_queries_org_insert on knowledge_queries for insert to authenticated
  with check (org_id = ( select profiles.organization_id from profiles where (profiles.id = auth.uid()) ));

create table opportunity_probability_scores (
  id uuid primary key default gen_random_uuid(),
  opportunity_id uuid not null references opportunities(id),
  organization_id uuid not null,
  overall_score integer default 0,
  confidence text default 'low',
  factors jsonb default '[]'::jsonb,
  recommendation text default 'consider',
  key_risks text[],
  key_strengths text[],
  estimated_roi text,
  time_to_complete text,
  computed_at timestamptz default now()
);
alter table opportunity_probability_scores enable row level security;
create policy opportunity_probability_scores_org_isolation on opportunity_probability_scores for all
  using (organization_id = ( select profiles.organization_id from profiles where (profiles.id = auth.uid()) ))
  with check (organization_id = ( select profiles.organization_id from profiles where (profiles.id = auth.uid()) ));

create table organizational_digital_twins (
  id uuid primary key default gen_random_uuid(),
  org_id uuid,
  organization_id uuid not null,
  mission text,
  vision text,
  service_areas text[],
  programs jsonb default '[]'::jsonb,
  financial_profile jsonb default '{}'::jsonb,
  board_composition jsonb default '[]'::jsonb,
  proven_narrative_patterns text[],
  key_strengths text[],
  known_weaknesses text[],
  twin_completeness_score integer default 0,
  last_rebuilt_at timestamptz,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
alter table organizational_digital_twins enable row level security;
create policy organizational_digital_twins_org_isolation on organizational_digital_twins for all
  using (organization_id = ( select profiles.organization_id from profiles where (profiles.id = auth.uid()) ))
  with check (organization_id = ( select profiles.organization_id from profiles where (profiles.id = auth.uid()) ));

create table pitch_cache (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  funder_id uuid not null references funders(id),
  request_profile_id uuid,
  personalized_pitch text not null,
  pitch_hash text not null,
  created_at timestamptz default now(),
  expires_at timestamptz default (now() + interval '30 days')
);
alter table pitch_cache enable row level security;
create policy pitch_cache_org_select on pitch_cache for select to authenticated
  using (organization_id = ( select profiles.organization_id from profiles where (profiles.id = auth.uid()) ));
create policy pitch_cache_org_insert on pitch_cache for insert to authenticated
  with check (organization_id = ( select profiles.organization_id from profiles where (profiles.id = auth.uid()) ));
create policy pitch_cache_org_update on pitch_cache for update to authenticated
  using (organization_id = ( select profiles.organization_id from profiles where (profiles.id = auth.uid()) ));
create policy pitch_cache_org_delete on pitch_cache for delete to authenticated
  using (organization_id = ( select profiles.organization_id from profiles where (profiles.id = auth.uid()) ));

create table submission_receipts (
  id uuid primary key default gen_random_uuid(),
  submission_id uuid,
  organization_id uuid not null,
  receipt_pdf_path text,
  receipt_data jsonb not null,
  generated_at timestamptz default now()
);
alter table submission_receipts enable row level security;
create policy submission_receipts_org_select on submission_receipts for select to authenticated
  using (organization_id = ( select profiles.organization_id from profiles where (profiles.id = auth.uid()) ));
