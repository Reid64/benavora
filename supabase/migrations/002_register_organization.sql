-- ============================================================================
-- Migration 002 — register_organization()
--
-- Registration must create an organization AND the owner's profile, but a
-- brand-new authenticated user has no profile yet, so current_org_id() returns
-- NULL and the org_isolation RLS policies block the inserts. Behavioral
-- Contracts §2 forbids the service-role client in user-facing routes, so the
-- bootstrap runs inside a SECURITY DEFINER function instead.
--
-- The function:
--   - Runs as the table owner (bypasses RLS) but only ever acts on auth.uid().
--   - Reads org name / full name from the user's auth metadata (set at sign-up),
--     never from a request body. role is hard-coded to 'owner'.
--   - Is idempotent: if the caller already has a profile it returns the existing
--     organization_id, so it is safe to call again from the auth callback after
--     email confirmation.
--   - platform_config defaults are seeded automatically by the existing
--     trg_seed_platform_config trigger on organizations INSERT.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.register_organization()
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uid        uuid := auth.uid();
  existing   uuid;
  new_org_id uuid;
  u_email    text;
  u_meta     jsonb;
  org_name   text;
  full_name  text;
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION 'register_organization: not authenticated';
  END IF;

  -- Idempotent: one organization per registering user.
  SELECT organization_id INTO existing FROM public.profiles WHERE id = uid;
  IF existing IS NOT NULL THEN
    RETURN existing;
  END IF;

  SELECT email, raw_user_meta_data
    INTO u_email, u_meta
    FROM auth.users
   WHERE id = uid;

  org_name  := NULLIF(btrim(COALESCE(u_meta->>'organization_name', '')), '');
  full_name := NULLIF(btrim(COALESCE(u_meta->>'full_name', '')), '');

  IF org_name IS NULL THEN
    org_name := 'My Organization';
  END IF;

  INSERT INTO public.organizations (name, email)
  VALUES (org_name, u_email)
  RETURNING id INTO new_org_id;

  INSERT INTO public.profiles (id, organization_id, email, full_name, role)
  VALUES (uid, new_org_id, u_email, full_name, 'owner');

  RETURN new_org_id;
END;
$$;

-- Only authenticated users may bootstrap their own organization.
REVOKE ALL ON FUNCTION public.register_organization() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.register_organization() TO authenticated;
