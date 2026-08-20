// ============================================================================
// PT-05-002 (support step) -- fetch the REAL, live RLS posture (relrowsecurity
// + pg_policies + anon/authenticated grants) for every tenant-scoped table
// PT-06 identified (120 tables carrying organization_id or org_id, per
// live-schema.json), via a read-only production connection.
//
// This is the ground-truth data source cross-read.json's per-table verdicts
// are built from -- NOT a guess, not derived from application code, but the
// actual live policy definitions on the real production database, read
// through the same read-only-enforced connection method PT-06-001 already
// proved (SET default_transaction_read_only = on; every write attempt on
// this connection is rejected by Postgres itself, not just by convention).
//
// Evidence: test-evidence/pt-05/production-rls-policies.json
//
// Usage: node scripts/audit/pt05-002-fetch-production-rls.mjs
// ============================================================================

import fs from "node:fs";
import path from "node:path";
import pg from "pg";

const ENV_FILE = ".env.local";
const OUT_DIR = path.join("test-evidence", "pt-05");
const OUT_FILE = path.join(OUT_DIR, "production-rls-policies.json");
const LIVE_SCHEMA_FILE = path.join("test-evidence", "pt-06", "live-schema.json");
const PRODUCTION_REF = "vbjplpquqxxfbpazyalt";

function loadEnv(filePath) {
  const raw = fs.readFileSync(filePath, "utf8");
  const env = {};
  for (const line of raw.split(/\r?\n/)) {
    if (!line || line.startsWith("#") || !line.includes("=")) continue;
    const i = line.indexOf("=");
    env[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  return env;
}

function deriveTenantTables() {
  const schema = JSON.parse(fs.readFileSync(LIVE_SCHEMA_FILE, "utf8"));
  const out = [];
  for (const [table, def] of Object.entries(schema.tables)) {
    const colNames = def.columns.map((c) => c.column_name);
    if (colNames.includes("organization_id")) out.push({ table, col: "organization_id" });
    else if (colNames.includes("org_id")) out.push({ table, col: "org_id" });
  }
  out.sort((a, b) => a.table.localeCompare(b.table));
  return out;
}

async function main() {
  if (!fs.existsSync(ENV_FILE)) {
    console.error(`HALT: ${ENV_FILE} not found.`);
    process.exit(1);
  }
  const env = loadEnv(ENV_FILE);
  if (!env.DATABASE_URL) {
    console.error(`HALT: DATABASE_URL not present in ${ENV_FILE}.`);
    process.exit(1);
  }
  if (!env.DATABASE_URL.includes(PRODUCTION_REF)) {
    console.error(
      `HALT: DATABASE_URL does not reference the production ref "${PRODUCTION_REF}". ` +
        `This step deliberately reads production's real RLS policy state (read-only) -- refusing to proceed against an unexpected target.`,
    );
    process.exit(1);
  }

  const tenantTables = deriveTenantTables();
  console.log(`Derived ${tenantTables.length} tenant-scoped tables from ${LIVE_SCHEMA_FILE}.`);

  const client = new pg.Client({
    connectionString: env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 15000,
    statement_timeout: 20000,
  });

  await client.connect();
  const who = await client.query("select current_database() as db, inet_server_addr()::text as addr");
  console.log(`Connected: database=${who.rows[0].db} server_addr=${who.rows[0].addr}`);

  await client.query("SET default_transaction_read_only = on");
  const roCheck = await client.query("SHOW default_transaction_read_only");
  if (roCheck.rows[0].default_transaction_read_only !== "on") {
    console.error("HALT: could not confirm read-only mode is active.");
    await client.end();
    process.exit(1);
  }
  console.log("Read-only mode confirmed active for this session.");

  const out = {};
  for (const { table, col } of tenantTables) {
    const relRes = await client.query(
      `select relrowsecurity, relforcerowsecurity from pg_class c
       join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and c.relname = $1`,
      [table],
    );
    const pol = await client.query(
      `select policyname, permissive, roles, cmd, qual, with_check
       from pg_policies where schemaname = 'public' and tablename = $1
       order by policyname`,
      [table],
    );
    const grants = await client.query(
      `select grantee, privilege_type from information_schema.role_table_grants
       where table_schema='public' and table_name=$1 and grantee in ('anon','authenticated')
       order by grantee, privilege_type`,
      [table],
    );
    out[table] = {
      tenant_column: col,
      rls_enabled: relRes.rows[0]?.relrowsecurity ?? null,
      rls_forced: relRes.rows[0]?.relforcerowsecurity ?? null,
      table_exists: relRes.rows.length > 0,
      policies: pol.rows,
      anon_authenticated_grants: grants.rows,
    };
  }

  await client.end();

  fs.mkdirSync(OUT_DIR, { recursive: true });
  const payload = {
    generated_at: new Date().toISOString(),
    database: `production (${PRODUCTION_REF}), read-only session`,
    method:
      "pg_class.relrowsecurity/relforcerowsecurity + pg_policies (qual/with_check text) + information_schema.role_table_grants, over a connection forced into default_transaction_read_only=on",
    source_of_tenant_table_list: LIVE_SCHEMA_FILE,
    table_count: tenantTables.length,
    tables: out,
  };
  fs.writeFileSync(OUT_FILE, JSON.stringify(payload, null, 2), "utf8");
  console.log(`Wrote ${OUT_FILE} (${tenantTables.length} tables).`);
}

main().catch((err) => {
  console.error(`HALT: ${err.stack || err.message}`);
  process.exit(1);
});
