-- 201_forge_migration_ledger_rpc.sql
-- Read-only access to the migration ledger for the work-landed FORGE gate.
--
-- Why this exists: scripts/audit/forge-gates/work-landed.mjs check 3 must read
-- supabase_migrations.schema_migrations. The only credentials that reach that
-- schema are DATABASE_URL (dead: 28P01 password authentication failed, live
-- re-tested 2026-09-19) and the Management API PATs in BLUEPRINT_v2.md (dead:
-- both return 401, live re-tested 2026-09-19). SUPABASE_SERVICE_ROLE_KEY is
-- alive, but PostgREST only exposes the public and graphql_public schemas, so
-- the ledger is unreachable over REST without a public-schema wrapper.
--
-- This is that wrapper: SECURITY DEFINER, SELECT-only, no arguments, no
-- writes, granted to service_role only. anon and authenticated are explicitly
-- revoked because this project's public schema default-grants to anon
-- (see ANON_GRANT_AUDIT.md).

create or replace function public.forge_migration_ledger()
returns table (version text, name text)
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select m.version::text, m.name::text
  from supabase_migrations.schema_migrations m
  order by m.version
$$;

revoke all on function public.forge_migration_ledger() from public;
revoke all on function public.forge_migration_ledger() from anon;
revoke all on function public.forge_migration_ledger() from authenticated;
grant execute on function public.forge_migration_ledger() to service_role;

comment on function public.forge_migration_ledger() is
  'Read-only migration ledger for the work-landed FORGE gate. service_role only.';
