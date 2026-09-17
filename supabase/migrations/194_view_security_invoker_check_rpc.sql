-- ============================================================================
-- BENAVORA - Migration 194: AR-6.4 test support - security_invoker
-- introspection RPC for alert-delivery.test.ts.
--
-- PostgREST does not expose pg_catalog, and this suite is required to use
-- the Supabase service-role client rather than a raw DATABASE_URL/
-- node-postgres connection (per the AR-6.4 prompt's DATABASE CONNECTION
-- section -- tests/setup.ts's .env.test carries no DATABASE_URL, and that
-- var is reserved for one-off migration scripts and integration-live/).
-- This is the only way to assert "declared security_invoker = true" on
-- migration 193's five views from that client. Read-only, parameterized
-- (no dynamic SQL against user input), service_role only.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.debug_view_is_security_invoker(p_view_name text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    (SELECT 'security_invoker=true' = ANY(c.reloptions)
     FROM pg_class c
     WHERE c.relname = p_view_name AND c.relkind = 'v'),
    false
  );
$$;

REVOKE ALL ON FUNCTION public.debug_view_is_security_invoker(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.debug_view_is_security_invoker(text) TO service_role;

-- ============================================================================
-- END Migration 194
-- ============================================================================
