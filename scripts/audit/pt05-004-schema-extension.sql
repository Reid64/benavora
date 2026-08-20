-- ============================================================================
-- PT-05-004 schema extension -- applied on top of pt05-schema.sql (PT-05-001)
-- + pt05-002-schema-extension.sql (PT-05-002/003), against the LOCAL
-- pt05-local-stack (never production).
--
-- Adds exactly what's needed to behaviorally re-verify migration 138's demo
-- write-protection (already confirmed LIVE in production this phase via a
-- read-only schema/function/trigger inspection -- see
-- pt05-004-production-investigation.json -- this extension is for the live
-- BEHAVIORAL test the task explicitly asks for, which a read-only inspection
-- cannot provide):
--
--   1. profiles.restricted_onboarding_edit -- exact copy of migration 138.
--   2. The organizations columns migration 138's column-scoped trigger
--      checks that pt05-schema.sql didn't already have (tax_status,
--      vision_statement, founding_date, founder_name, founder_bio,
--      target_population, annual_budget, total_staff, total_volunteers,
--      onboarding_completed_at), plus one column migration 138 explicitly
--      does NOT protect (logo_url, a real branding column per the spec's
--      own §2.1 carve-out) for a negative control.
--   3. A new, minimal knowledge_base table (organization_id + a couple of
--      real-shaped columns, RLS org-isolation policy matching the same
--      pattern already proven in pt05-002-schema-extension.sql's
--      organizational_digital_twins) -- one whole-table-block trigger target
--      migration 138 didn't already have available (organizational_digital_
--      twins already exists from PT-05-002 and is reused as the second
--      whole-table-block sample). board_members/programs/documents are NOT
--      separately recreated here: production inspection this phase already
--      confirmed byte-identical trigger definitions
--      (tgfoid -> block_if_onboarding_edit_restricted) on all 5 real tables,
--      so knowledge_base + organizational_digital_twins is corroborating
--      behavioral coverage of the same shared, table-agnostic function, not
--      a claim that only 2 of 5 tables are protected.
--   4. The exact function/trigger definitions from
--      supabase/migrations/138_demo_account_scope.sql, copied verbatim
--      (byte-for-byte matching what production inspection already read back
--      via pg_get_functiondef/pg_get_triggerdef this phase).
-- ============================================================================

alter table profiles add column if not exists restricted_onboarding_edit boolean not null default false;

alter table organizations add column if not exists tax_status text;
alter table organizations add column if not exists vision_statement text;
alter table organizations add column if not exists founding_date date;
alter table organizations add column if not exists founder_name text;
alter table organizations add column if not exists founder_bio text;
alter table organizations add column if not exists target_population text;
alter table organizations add column if not exists annual_budget numeric;
alter table organizations add column if not exists total_staff integer;
alter table organizations add column if not exists total_volunteers integer;
alter table organizations add column if not exists onboarding_completed_at timestamptz;
alter table organizations add column if not exists logo_url text; -- NOT in migration 138's protected list

create table if not exists knowledge_base (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  category text,
  content text,
  created_at timestamptz default now()
);
alter table knowledge_base enable row level security;
create policy knowledge_base_org_isolation on knowledge_base for all
  using (organization_id = ( select profiles.organization_id from profiles where (profiles.id = auth.uid()) ))
  with check (organization_id = ( select profiles.organization_id from profiles where (profiles.id = auth.uid()) ));

-- --------------------------------------------------------------------------
-- migration 138's real functions and triggers, copied verbatim
-- --------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.is_onboarding_edit_restricted()
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT COALESCE(
    (SELECT restricted_onboarding_edit FROM public.profiles WHERE id = auth.uid()),
    false
  );
$function$;

CREATE OR REPLACE FUNCTION public.block_if_onboarding_edit_restricted()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF public.is_onboarding_edit_restricted() THEN
    RAISE EXCEPTION 'This demo account cannot modify organizational profile data.'
      USING ERRCODE = '42501';
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$function$;

DROP TRIGGER IF EXISTS block_restricted_write ON public.knowledge_base;
CREATE TRIGGER block_restricted_write
  BEFORE INSERT OR UPDATE OR DELETE ON public.knowledge_base
  FOR EACH ROW EXECUTE FUNCTION public.block_if_onboarding_edit_restricted();

DROP TRIGGER IF EXISTS block_restricted_write ON public.organizational_digital_twins;
CREATE TRIGGER block_restricted_write
  BEFORE INSERT OR UPDATE OR DELETE ON public.organizational_digital_twins
  FOR EACH ROW EXECUTE FUNCTION public.block_if_onboarding_edit_restricted();

CREATE OR REPLACE FUNCTION public.block_restricted_organizations_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF public.is_onboarding_edit_restricted() THEN
    IF NEW.name IS DISTINCT FROM OLD.name
      OR NEW.ein IS DISTINCT FROM OLD.ein
      OR NEW.tax_status IS DISTINCT FROM OLD.tax_status
      OR NEW.mission_statement IS DISTINCT FROM OLD.mission_statement
      OR NEW.vision_statement IS DISTINCT FROM OLD.vision_statement
      OR NEW.founding_date IS DISTINCT FROM OLD.founding_date
      OR NEW.founder_name IS DISTINCT FROM OLD.founder_name
      OR NEW.founder_bio IS DISTINCT FROM OLD.founder_bio
      OR NEW.service_area IS DISTINCT FROM OLD.service_area
      OR NEW.target_population IS DISTINCT FROM OLD.target_population
      OR NEW.annual_budget IS DISTINCT FROM OLD.annual_budget
      OR NEW.total_staff IS DISTINCT FROM OLD.total_staff
      OR NEW.total_volunteers IS DISTINCT FROM OLD.total_volunteers
      OR NEW.extended_profile IS DISTINCT FROM OLD.extended_profile
      OR NEW.onboarding_step IS DISTINCT FROM OLD.onboarding_step
      OR NEW.onboarding_progress IS DISTINCT FROM OLD.onboarding_progress
      OR NEW.onboarding_completed IS DISTINCT FROM OLD.onboarding_completed
      OR NEW.onboarding_completed_at IS DISTINCT FROM OLD.onboarding_completed_at
    THEN
      RAISE EXCEPTION 'This demo account cannot modify this organization field.'
        USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS block_restricted_organizations_update ON public.organizations;
CREATE TRIGGER block_restricted_organizations_update
  BEFORE UPDATE ON public.organizations
  FOR EACH ROW EXECUTE FUNCTION public.block_restricted_organizations_update();

-- --------------------------------------------------------------------------
-- PT-05-004 impersonation audit tables -- exact copies of the real
-- production shape (columns + FK targets), confirmed this phase via
-- read-only production inspection (pt05-004-production-investigation.json).
-- platform_admins is included specifically because impersonation_log's real
-- admin_id FK references it -- reproducing that FK locally is the whole
-- point of this part of the extension (to demonstrate the same constraint
-- production has, not a simplified version that hides it).
-- --------------------------------------------------------------------------

create table if not exists platform_admins (
  id uuid primary key default gen_random_uuid(),
  user_id uuid,
  email text,
  full_name text,
  is_active boolean default true,
  created_at timestamptz default now()
);

create table if not exists impersonation_log (
  id uuid primary key default gen_random_uuid(),
  admin_id uuid not null references platform_admins(id),
  target_org_id uuid not null references organizations(id),
  target_user_id uuid,
  started_at timestamptz default now(),
  ended_at timestamptz,
  reason text not null,
  actions_taken text[]
);

create type audit_action as enum ('login', 'create', 'update', 'delete', 'view');

create table if not exists audit_logs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  user_id uuid references profiles(id),
  action audit_action not null,
  entity_type text,
  entity_id uuid,
  details jsonb,
  ip_address text,
  user_agent text,
  created_at timestamptz default now()
);
