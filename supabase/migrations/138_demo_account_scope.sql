-- 138_demo_account_scope.sql — Demo Account Scope (DEMO_ACCOUNT_SCOPE_2026-08-15.md)
--
-- Adds a restricted-write flag to profiles and enforces it at the database
-- layer (the only layer that can guarantee correctness — see spec §3.2: at
-- least one real write path, settings/page.tsx's direct client-side
-- organizations.update(), never touches an API route at all, so app-layer
-- guard clauses alone cannot close that gap).
--
-- Prerequisite: migration 104_organizations_extended_profile.sql defines
-- organizations.extended_profile but was never applied to this live database
-- (confirmed via live information_schema.columns query, 2026-08-15 — the
-- column genuinely does not exist yet). That column is one of the fields this
-- spec must protect (§2.1), so it is applied here as a prerequisite — a
-- verbatim copy of 104's own idempotent DO block, safe to run whether or not
-- 104 is ever separately applied later (IF NOT EXISTS guarded either way).

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'organizations' AND column_name = 'extended_profile') THEN
    ALTER TABLE organizations ADD COLUMN extended_profile jsonb NOT NULL DEFAULT '{}'::jsonb;
  END IF;
END $$;

-- profiles.restricted_onboarding_edit — Option B from the spec (§3.1): a flag
-- layered on top of the existing role, not a new user_role enum value. Purely
-- additive; every existing profile defaults to false (unchanged behavior).
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS restricted_onboarding_edit boolean NOT NULL DEFAULT false;

-- is_onboarding_edit_restricted() — mirrors current_org_id()'s existing
-- pattern (001_initial_schema.sql) exactly: STABLE SECURITY DEFINER SQL
-- function reading the caller's own profile row via auth.uid().
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

-- Full-table block trigger function, used on the five tables (§2.2-§2.6)
-- that need whole-table protection with no column-level nuance.
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

DROP TRIGGER IF EXISTS block_restricted_write ON public.board_members;
CREATE TRIGGER block_restricted_write
  BEFORE INSERT OR UPDATE OR DELETE ON public.board_members
  FOR EACH ROW EXECUTE FUNCTION public.block_if_onboarding_edit_restricted();

DROP TRIGGER IF EXISTS block_restricted_write ON public.programs;
CREATE TRIGGER block_restricted_write
  BEFORE INSERT OR UPDATE OR DELETE ON public.programs
  FOR EACH ROW EXECUTE FUNCTION public.block_if_onboarding_edit_restricted();

DROP TRIGGER IF EXISTS block_restricted_write ON public.organizational_digital_twins;
CREATE TRIGGER block_restricted_write
  BEFORE INSERT OR UPDATE OR DELETE ON public.organizational_digital_twins
  FOR EACH ROW EXECUTE FUNCTION public.block_if_onboarding_edit_restricted();

DROP TRIGGER IF EXISTS block_restricted_write ON public.documents;
CREATE TRIGGER block_restricted_write
  BEFORE INSERT OR UPDATE OR DELETE ON public.documents
  FOR EACH ROW EXECUTE FUNCTION public.block_if_onboarding_edit_restricted();

-- organizations — column-scoped block (§2.1). This is the one table that
-- needs column-level, not whole-table, protection: branding fields
-- (logo_url, primary/secondary/accent color) and address/contact fields are
-- NOT in the protected list and must remain editable via Settings.
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
