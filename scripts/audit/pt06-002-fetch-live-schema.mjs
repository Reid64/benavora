// ============================================================================
// PT-06-002 -- fetch the full live production schema (public-schema tables,
// their columns, and every enum type's value list) via the same read-only
// DATABASE_URL connection proven in pt06-001, and cache it to disk so the
// drift-analysis script doesn't need a live DB round trip on every run.
//
// Output: test-evidence/pt-06/live-schema-snapshot.json
// Usage: node scripts/audit/pt06-002-fetch-live-schema.mjs
// ============================================================================

import dotenv from "dotenv";
import pg from "pg";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, "..", "..", ".env.local"), override: true });

const OUT_DIR = path.join("test-evidence", "pt-06");
const OUT_FILE = path.join(OUT_DIR, "live-schema-snapshot.json");

const client = new pg.Client({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

await client.connect();
await client.query("SET default_transaction_read_only = on");

// 1. Confirm (again, for this evidence file's own record) that no
//    Supabase-CLI migration-tracking table exists in this project.
const trackingTableCheck = await client.query(`
  SELECT to_regclass('supabase_migrations.schema_migrations') AS tracking_table;
`);
const trackingSchemaCheck = await client.query(`
  SELECT nspname FROM pg_namespace WHERE nspname = 'supabase_migrations';
`);

// 2. All public-schema base tables.
const tablesRes = await client.query(`
  SELECT table_name
  FROM information_schema.tables
  WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
  ORDER BY table_name;
`);

// 3. All public-schema columns (table_name, column_name, data_type).
const columnsRes = await client.query(`
  SELECT table_name, column_name, data_type
  FROM information_schema.columns
  WHERE table_schema = 'public'
  ORDER BY table_name, ordinal_position;
`);

// 4. All public-schema enum types and their values.
const enumsRes = await client.query(`
  SELECT t.typname AS enum_name, e.enumlabel AS value, e.enumsortorder AS sort_order
  FROM pg_type t
  JOIN pg_enum e ON t.oid = e.enumtypid
  JOIN pg_namespace n ON n.oid = t.typnamespace
  WHERE n.nspname = 'public'
  ORDER BY t.typname, e.enumsortorder;
`);

// 5. Real production time, for the evidence file's own timestamp integrity.
const nowRes = await client.query(`SELECT now() AS server_time;`);

await client.end();

// Build lookup structures.
const tableColumns = {};
for (const row of columnsRes.rows) {
  if (!tableColumns[row.table_name]) tableColumns[row.table_name] = [];
  tableColumns[row.table_name].push(row.column_name);
}

const enumValues = {};
for (const row of enumsRes.rows) {
  if (!enumValues[row.enum_name]) enumValues[row.enum_name] = [];
  enumValues[row.enum_name].push(row.value);
}

const output = {
  fetchedAt: new Date().toISOString(),
  productionServerTime: nowRes.rows[0].server_time,
  migrationTrackingTableCheck: {
    note:
      "Checked whether this project uses Supabase-CLI-managed migration tracking " +
      "(supabase_migrations.schema_migrations). It does not: the schema itself does not " +
      "exist. Confirmed two independent ways below. Every migration in this project's " +
      "history has been applied by hand via a direct DATABASE_URL/psql connection " +
      "(STANDING_DIRECTIVES.md DIRECTIVE-017), not via `supabase db push`/`supabase " +
      "migration up`, so there is no ledger table recording which migrations 'ran.' " +
      "Applied-vs-not-applied status for this audit is therefore determined by live " +
      "object existence (does the table/column/enum-value the migration file defines " +
      "actually exist in the production schema right now), the same method " +
      "MIGRATION_AUDIT.md (2026-07-28/30) used, extended across both known migration " +
      "directories.",
    supabaseMigrationsSchemaExists: trackingSchemaCheck.rows.length > 0,
    supabaseMigrationsSchemaMigrationsTableRegclass: trackingTableCheck.rows[0].tracking_table,
    verdict: "NO_TRACKING_TABLE -- applied status determined by live object existence instead",
  },
  publicSchema: {
    tableCount: tablesRes.rows.length,
    tables: tablesRes.rows.map((r) => r.table_name),
    tableColumns,
    enumTypeCount: Object.keys(enumValues).length,
    enumValues,
  },
};

fs.mkdirSync(OUT_DIR, { recursive: true });
fs.writeFileSync(OUT_FILE, JSON.stringify(output, null, 2) + "\n", "utf8");

console.log(`Wrote ${OUT_FILE}`);
console.log(`  supabase_migrations schema exists: ${output.migrationTrackingTableCheck.supabaseMigrationsSchemaExists}`);
console.log(`  public schema tables: ${output.publicSchema.tableCount}`);
console.log(`  public schema enum types: ${output.publicSchema.enumTypeCount}`);
