// ============================================================================
// PT-05-004 investigation -- READ-ONLY reconnaissance against real production
// (DIRECTIVE-017 DATABASE_URL path, same connect-then-set-read-only pattern
// proven in pt06-001-readonly-connection.mjs). Not the final evidence file --
// this just gathers ground truth so the behavioral test (run against the
// local pt05-local-stack, never production) is built on real facts, not
// assumptions:
//   1. Does migration 138's demo-protection actually exist live -- not just
//      "the required columns exist" (PT-06's own methodology only checks
//      column/table presence, never trigger/function existence) but the real
//      functions and all 6 real triggers.
//   2. impersonation_log's real column/FK shape, and whether admin_id's FK
//      to platform_admins(id) is satisfiable by any real owner-role user
//      today (platform_admins row count + overlap with profiles.role='owner'
//      ids) -- this determines whether the impersonation route's own audit
//      insert can ever succeed for a real caller.
//   3. audit_logs' real shape/RLS (the second, FK-free audit write the same
//      route makes).
//   4. profiles.role='owner' population size, to size the "any org owner
//      reaches any org's admin page" exposure precisely, not just assert it.
//
// Usage: node scripts/audit/pt05-004-investigate.mjs
// ============================================================================

import dotenv from "dotenv";
import pg from "pg";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, "..", "..", ".env.local"), override: true });

const OUT_DIR = path.join("test-evidence", "pt-05");
const OUT_FILE = path.join(OUT_DIR, "pt05-004-production-investigation.json");
const PRODUCTION_REF = "vbjplpquqxxfbpazyalt";

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error("HALT: DATABASE_URL not present in .env.local.");
    process.exit(1);
  }
  if (!process.env.DATABASE_URL.includes(PRODUCTION_REF)) {
    console.error(`HALT: DATABASE_URL does not reference the expected production ref ${PRODUCTION_REF}. Refusing to proceed on an unexpected target.`);
    process.exit(1);
  }

  const client = new pg.Client({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();
  await client.query("SET default_transaction_read_only = on");

  const result = {
    generated_at: new Date().toISOString(),
    target: "production (read-only session)",
  };

  // 1a. profiles.restricted_onboarding_edit + organizations.extended_profile columns
  const cols = await client.query(`
    select table_name, column_name, data_type, is_nullable, column_default
    from information_schema.columns
    where (table_name = 'profiles' and column_name = 'restricted_onboarding_edit')
       or (table_name = 'organizations' and column_name = 'extended_profile')
    order by table_name, column_name
  `);
  result.demo_protection_columns = cols.rows;

  // 1b. the 3 real functions migration 138 defines
  const funcs = await client.query(`
    select p.proname as function_name, pg_get_functiondef(p.oid) as definition
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('is_onboarding_edit_restricted', 'block_if_onboarding_edit_restricted', 'block_restricted_organizations_update')
    order by p.proname
  `);
  result.demo_protection_functions = funcs.rows.map((r) => ({
    function_name: r.function_name,
    definition_sha_prefix: r.definition.slice(0, 40),
    full_definition: r.definition,
  }));

  // 1c. every trigger currently attached to any of the 6 tables migration 138 targets,
  // and which function each one calls (tgfoid -> proname), not just trigger name --
  // proves the trigger is actually wired to the real protection function, not a
  // same-named decoy.
  const triggers = await client.query(`
    select
      c.relname as table_name,
      t.tgname as trigger_name,
      p.proname as calls_function,
      t.tgenabled as enabled_flag,
      pg_get_triggerdef(t.oid) as definition
    from pg_trigger t
    join pg_class c on c.oid = t.tgrelid
    join pg_namespace n on n.oid = c.relnamespace
    join pg_proc p on p.oid = t.tgfoid
    where n.nspname = 'public'
      and c.relname in ('knowledge_base', 'board_members', 'programs', 'organizational_digital_twins', 'documents', 'organizations')
      and not t.tgisinternal
    order by c.relname, t.tgname
  `);
  result.demo_protection_triggers = triggers.rows;

  // 2a. impersonation_log real shape + FK targets
  const impLogCols = await client.query(`
    select column_name, data_type, is_nullable
    from information_schema.columns
    where table_name = 'impersonation_log'
    order by ordinal_position
  `);
  const impLogFks = await client.query(`
    select
      kcu.column_name as fk_column,
      ccu.table_name as references_table,
      ccu.column_name as references_column
    from information_schema.table_constraints tc
    join information_schema.key_column_usage kcu on kcu.constraint_name = tc.constraint_name
    join information_schema.constraint_column_usage ccu on ccu.constraint_name = tc.constraint_name
    where tc.table_name = 'impersonation_log' and tc.constraint_type = 'FOREIGN KEY'
  `);
  result.impersonation_log = {
    columns: impLogCols.rows,
    foreign_keys: impLogFks.rows,
  };

  // 2b. platform_admins population, and whether any current profiles.role='owner'
  // user id is present in it -- this is the exact FK the impersonation_log insert
  // needs to satisfy for admin_id.
  let platformAdminsCount = null;
  let platformAdminsCols = null;
  let ownerIdsInPlatformAdmins = null;
  let totalOwnerProfiles = null;
  try {
    const pac = await client.query(`select count(*)::int as n from platform_admins`);
    platformAdminsCount = pac.rows[0].n;
    const pacols = await client.query(`
      select column_name, data_type from information_schema.columns
      where table_name = 'platform_admins' order by ordinal_position
    `);
    platformAdminsCols = pacols.rows;
    const overlap = await client.query(`
      select count(*)::int as n
      from profiles p
      join platform_admins pa on pa.id = p.id
      where p.role = 'owner'
    `);
    ownerIdsInPlatformAdmins = overlap.rows[0].n;
    const ownerCount = await client.query(`select count(*)::int as n from profiles where role = 'owner'`);
    totalOwnerProfiles = ownerCount.rows[0].n;
  } catch (err) {
    platformAdminsCount = `ERROR: ${err.message}`;
  }
  result.platform_admins = {
    row_count: platformAdminsCount,
    columns: platformAdminsCols,
    owner_role_profiles_present_in_platform_admins: ownerIdsInPlatformAdmins,
    total_owner_role_profiles: totalOwnerProfiles,
  };

  // 2c. has impersonation_log ever actually received a row? (evidence of whether
  // this insert has ever succeeded in the wild, or whether it has silently never
  // fired -- either because the FK always rejects it, or because the caller's
  // insert error is silently swallowed by not checking supabase-js's {error}.)
  const impLogRows = await client.query(`select count(*)::int as n from impersonation_log`);
  result.impersonation_log.row_count = impLogRows.rows[0].n;

  // 3. audit_logs real shape + RLS state (the second, FK-free write the same route makes)
  const auditCols = await client.query(`
    select column_name, data_type, is_nullable
    from information_schema.columns where table_name = 'audit_logs' order by ordinal_position
  `);
  const auditFks = await client.query(`
    select
      kcu.column_name as fk_column,
      ccu.table_name as references_table
    from information_schema.table_constraints tc
    join information_schema.key_column_usage kcu on kcu.constraint_name = tc.constraint_name
    join information_schema.constraint_column_usage ccu on ccu.constraint_name = tc.constraint_name
    where tc.table_name = 'audit_logs' and tc.constraint_type = 'FOREIGN KEY'
  `);
  const auditImpersonationRows = await client.query(`
    select count(*)::int as n from audit_logs
    where details->>'admin_action' = 'impersonate'
  `);
  result.audit_logs = {
    columns: auditCols.rows,
    foreign_keys: auditFks.rows,
    rows_with_admin_action_impersonate: auditImpersonationRows.rows[0].n,
  };

  // 4. ROLE_HIERARCHY sanity: is there ANY org-scoping column on profiles that
  // distinguishes a "platform admin" from an ordinary org owner? Read the real
  // profiles table shape to settle whether 'owner' is genuinely per-org.
  const profileCols = await client.query(`
    select column_name, data_type from information_schema.columns
    where table_name = 'profiles' order by ordinal_position
  `);
  result.profiles_columns = profileCols.rows;

  await client.end();

  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(OUT_FILE, JSON.stringify(result, null, 2), "utf8");
  console.log(`Wrote ${OUT_FILE}`);
  console.log(JSON.stringify({
    demo_protection_columns_found: result.demo_protection_columns.length,
    demo_protection_functions_found: result.demo_protection_functions.length,
    demo_protection_triggers_found: result.demo_protection_triggers.length,
    impersonation_log_row_count: result.impersonation_log.row_count,
    platform_admins_row_count: result.platform_admins.row_count,
    owner_role_profiles_present_in_platform_admins: result.platform_admins.owner_role_profiles_present_in_platform_admins,
    total_owner_role_profiles: result.platform_admins.total_owner_role_profiles,
  }, null, 2));
}

main().catch((err) => {
  console.error("FATAL:", err);
  process.exit(1);
});
