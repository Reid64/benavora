// ============================================================================
// PT-06-004 — data-integrity structural audit, read-only against production.
//
// Four checks, each producing its own section of test-evidence/pt-06/integrity.json:
//
//   1. foreign_keys       — every FK constraint in the public schema (via pg_catalog,
//                            multi-column safe), and for each one a live COUNT(*) of
//                            orphaned child rows (child.col IS NOT NULL AND no matching
//                            parent row). A non-zero orphan count on an FK that Postgres
//                            is actively enforcing is impossible under normal operation
//                            (the constraint would reject the insert) — it can only mean
//                            the constraint was added after bad data already existed and
//                            existing rows were never backfilled/cleaned, or (for FKs that
//                            turn out not to exist for a column that reads like one) that
//                            no constraint enforces the relationship at all. Both are
//                            captured: declared FKs are checked directly; a second pass
//                            (tenant_fk_gap) finds org_id/organization_id columns with NO
//                            declared FK, which is the "missing constraint" half of the
//                            same failure mode.
//
//   2. tenant_fk_gap       — every table with an organization_id/org_id column, cross-
//                            referenced against the FK list from (1): does that column
//                            have a live FK constraint pointing at organizations.id (or
//                            organizations(<pk>))? Tables with the column but no FK are
//                            flagged P1 (feeds PT-05 isolation / PT-14 security — RLS
//                            policies commonly reference this column, and referential
//                            integrity on it is a prerequisite for those policies being
//                            trustworthy).
//
//   3. primary_keys        — every base table in the public schema, and whether it has a
//                            PRIMARY KEY constraint (via pg_index indisprimary, the
//                            authoritative source — not just information_schema, which
//                            can miss unique indexes created without an explicit ADD
//                            CONSTRAINT). Tables with no PK are findings.
//
//   4. unique_gaps          — heuristic scan for columns whose name matches a real-world
//                            identifier pattern (email, ein, slug, external ids, stripe/
//                            google/webhook ids, uei, duns, domain/website) that do NOT
//                            already have a unique index covering them, then a live
//                            COUNT(*) ... GROUP BY ... HAVING COUNT(*) > 1 to find rows
//                            that already violate what a UNIQUE constraint on that column
//                            would enforce, if one existed. This is deliberately a
//                            heuristic over column *names*, not a claim that every match
//                            is wrong — it surfaces candidates for a human to confirm.
//
// Safety: same read-only pattern as pt06-001 — the session is put into
// default_transaction_read_only=on immediately after connecting, before any other
// query runs, so every statement below is rejected by Postgres itself (not just
// application discipline) if it is ever accidentally a write.
//
// Every query used to produce a result is recorded verbatim alongside that result in
// integrity.json, per task instruction 4 ("per-check results with the actual queries
// and counts").
//
// Usage: node scripts/audit/pt06-004-integrity-audit.mjs
// ============================================================================

import fs from "node:fs";
import path from "node:path";
import pg from "pg";

const ENV_FILE = ".env.local";
const OUT_DIR = path.join("test-evidence", "pt-06");
const OUT_FILE = path.join(OUT_DIR, "integrity.json");
const LIVE_SCHEMA_FILE = path.join(OUT_DIR, "live-schema.json");

const PER_QUERY_TIMEOUT_MS = 45000;

// Candidate identifier-like column-name patterns for the unique_gaps heuristic (check 4).
// Matched case-insensitively against the column's own name, not the table's.
const IDENTIFIER_COLUMN_PATTERNS = [
  /^email$/i,
  /^ein$/i,
  /^uei$/i,
  /^duns$/i,
  /^slug$/i,
  /^domain$/i,
  /^website$/i,
  /^external_id$/i,
  /^stripe_customer_id$/i,
  /^stripe_subscription_id$/i,
  /^google_place_id$/i,
  /^webhook_id$/i,
  /^api_key$/i,
  /^ntee_code$/i, // not identifier-like per se but flagged for completeness of the pattern match, filtered out below if noisy
];

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

function redact(connectionString) {
  return connectionString.replace(/(postgres(?:ql)?:\/\/[^:]+:)[^@]+(@)/, "$1***$2");
}

async function q(client, sql, params, label) {
  const start = Date.now();
  try {
    const res = await client.query(sql, params);
    return { ok: true, rows: res.rows, durationMs: Date.now() - start };
  } catch (err) {
    return {
      ok: false,
      rows: [],
      durationMs: Date.now() - start,
      error: `${err.code || "unknown"}: ${err.message}`,
    };
  } finally {
    void label;
  }
}

async function main() {
  if (!fs.existsSync(ENV_FILE)) {
    console.error(`HALT: ${ENV_FILE} not found -- cannot establish a connection.`);
    process.exit(1);
  }
  const env = loadEnv(ENV_FILE);
  if (!env.DATABASE_URL) {
    console.error(`HALT: DATABASE_URL not present in ${ENV_FILE} -- cannot establish a connection.`);
    process.exit(1);
  }
  if (!fs.existsSync(LIVE_SCHEMA_FILE)) {
    console.error(
      `HALT: ${LIVE_SCHEMA_FILE} not found -- run pt06-002-fetch-live-schema.mjs first (this audit reuses its column census instead of re-querying it).`,
    );
    process.exit(1);
  }

  const liveSchema = JSON.parse(fs.readFileSync(LIVE_SCHEMA_FILE, "utf8"));
  const allTables = Object.keys(liveSchema.tables).sort();

  fs.mkdirSync(OUT_DIR, { recursive: true });

  const client = new pg.Client({
    connectionString: env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 15000,
    statement_timeout: PER_QUERY_TIMEOUT_MS,
  });

  console.log("PT-06-004 integrity audit");
  console.log(`Connection string (redacted): ${redact(env.DATABASE_URL)}`);

  await client.connect();
  await client.query("SET default_transaction_read_only = on");
  const roCheck = await client.query("SHOW default_transaction_read_only");
  if (roCheck.rows[0].default_transaction_read_only !== "on") {
    console.error("HALT: could not confirm read-only mode -- refusing to proceed.");
    await client.end();
    process.exit(1);
  }
  console.log("Session confirmed read-only. Proceeding.");

  const result = {
    generated_at: new Date().toISOString(),
    database: redact(env.DATABASE_URL),
    method:
      "Live, read-only queries against pg_catalog/information_schema on the production Postgres " +
      "instance (session forced to default_transaction_read_only=on before any query ran, per the " +
      "same enforcement proof as pt06-001). Table/column inventory reused from " +
      "test-evidence/pt-06/live-schema.json rather than re-queried. Every result below records the " +
      "exact SQL that produced it.",
    checks: {},
    findings: [],
  };

  // ---------------------------------------------------------------------
  // Check 1: foreign keys + orphan counts
  // ---------------------------------------------------------------------
  console.log("\n[1/4] Enumerating foreign key constraints...");

  const FK_QUERY = `
    SELECT
      con.conname AS constraint_name,
      cl.relname AS child_table,
      array_agg(att.attname::text ORDER BY u.ord) AS child_columns,
      clf.relname AS parent_table,
      array_agg(attf.attname::text ORDER BY u.ord) AS parent_columns,
      con.confdeltype AS on_delete
    FROM pg_constraint con
    JOIN pg_class cl ON cl.oid = con.conrelid
    JOIN pg_namespace nsp ON nsp.oid = cl.relnamespace
    JOIN pg_class clf ON clf.oid = con.confrelid
    JOIN unnest(con.conkey) WITH ORDINALITY AS u(attnum, ord) ON true
    JOIN pg_attribute att ON att.attrelid = con.conrelid AND att.attnum = u.attnum
    JOIN unnest(con.confkey) WITH ORDINALITY AS uf(attnum, ord) ON uf.ord = u.ord
    JOIN pg_attribute attf ON attf.attrelid = con.confrelid AND attf.attnum = uf.attnum
    WHERE con.contype = 'f' AND nsp.nspname = 'public'
    GROUP BY con.conname, cl.relname, clf.relname, con.confdeltype
    ORDER BY cl.relname, con.conname;
  `;
  const fkRes = await q(client, FK_QUERY, [], "fk-enumeration");
  if (!fkRes.ok) {
    console.error(`  FK enumeration FAILED: ${fkRes.error}`);
    result.checks.foreign_keys = { query: FK_QUERY.trim(), error: fkRes.error, constraints: [] };
  } else {
    console.log(`  Found ${fkRes.rows.length} FK constraints.`);
    const constraints = [];
    for (const row of fkRes.rows) {
      const childCols = row.child_columns;
      const parentCols = row.parent_columns;
      let orphanEntry = {
        constraint_name: row.constraint_name,
        child_table: row.child_table,
        child_columns: childCols,
        parent_table: row.parent_table,
        parent_columns: parentCols,
        on_delete: row.on_delete,
      };

      if (childCols.length === 1 && parentCols.length === 1) {
        const childCol = childCols[0];
        const parentCol = parentCols[0];
        const orphanSql = `
          SELECT count(*)::int AS orphan_count
          FROM "${row.child_table}" c
          WHERE c."${childCol}" IS NOT NULL
            AND NOT EXISTS (
              SELECT 1 FROM "${row.parent_table}" p WHERE p."${parentCol}" = c."${childCol}"
            );
        `;
        const orphanRes = await q(client, orphanSql, [], `orphan-check:${row.constraint_name}`);
        if (!orphanRes.ok) {
          orphanEntry.orphan_check = { query: orphanSql.trim(), error: orphanRes.error };
        } else {
          const count = orphanRes.rows[0].orphan_count;
          orphanEntry.orphan_check = { query: orphanSql.trim(), orphan_count: count, duration_ms: orphanRes.durationMs };
          if (count > 0) {
            console.log(`  ORPHANS: ${row.child_table}.${childCol} -> ${row.parent_table}.${parentCol}: ${count} orphaned rows`);
            result.findings.push({
              check: "foreign_keys",
              severity: count > 100 ? "P1" : "P2",
              table: row.child_table,
              column: childCol,
              references: `${row.parent_table}.${parentCol}`,
              orphan_count: count,
              description: `${count} row(s) in ${row.child_table}.${childCol} reference a value in ${row.parent_table}.${parentCol} that no longer exists. FK constraint "${row.constraint_name}" is declared but ${count} pre-existing row(s) violate it -- either the constraint was added after bad data existed and was never backfilled, or the parent rows were deleted through a path that bypassed the FK (e.g. a hard delete via service-role credentials, which Postgres FKs do still enforce, so this specific combination is unusual and worth investigating directly).`,
              query: orphanSql.trim(),
            });
          }
        }
      } else {
        // Multi-column FK -- build a positional equality check across all column pairs.
        const conditions = childCols.map((c, i) => `c."${c}" = p."${parentCols[i]}"`).join(" AND ");
        const notNullConditions = childCols.map((c) => `c."${c}" IS NOT NULL`).join(" AND ");
        const orphanSql = `
          SELECT count(*)::int AS orphan_count
          FROM "${row.child_table}" c
          WHERE ${notNullConditions}
            AND NOT EXISTS (
              SELECT 1 FROM "${row.parent_table}" p WHERE ${conditions}
            );
        `;
        const orphanRes = await q(client, orphanSql, [], `orphan-check-multicol:${row.constraint_name}`);
        if (!orphanRes.ok) {
          orphanEntry.orphan_check = { query: orphanSql.trim(), error: orphanRes.error };
        } else {
          const count = orphanRes.rows[0].orphan_count;
          orphanEntry.orphan_check = { query: orphanSql.trim(), orphan_count: count, duration_ms: orphanRes.durationMs };
          if (count > 0) {
            console.log(`  ORPHANS (multi-col): ${row.child_table} -> ${row.parent_table}: ${count} orphaned rows`);
            result.findings.push({
              check: "foreign_keys",
              severity: count > 100 ? "P1" : "P2",
              table: row.child_table,
              column: childCols.join(","),
              references: `${row.parent_table}.${parentCols.join(",")}`,
              orphan_count: count,
              description: `${count} row(s) in ${row.child_table} (composite FK "${row.constraint_name}") reference a parent row in ${row.parent_table} that no longer exists.`,
              query: orphanSql.trim(),
            });
          }
        }
      }
      constraints.push(orphanEntry);
    }
    result.checks.foreign_keys = { query: FK_QUERY.trim(), constraint_count: constraints.length, constraints };
  }

  // ---------------------------------------------------------------------
  // Check 2: tenant FK gap (org_id/organization_id columns without a live FK)
  // ---------------------------------------------------------------------
  console.log("\n[2/4] Checking tenant (org_id/organization_id) column FK coverage...");

  const fkByChild = new Map(); // "table.column" -> fk row
  if (result.checks.foreign_keys.constraints) {
    for (const c of result.checks.foreign_keys.constraints) {
      if (c.child_columns.length === 1) {
        fkByChild.set(`${c.child_table}.${c.child_columns[0]}`, c);
      }
    }
  }

  const TENANT_COL_NAMES = new Set(["organization_id", "org_id"]);
  const tenantTables = [];
  for (const tableName of allTables) {
    const cols = liveSchema.tables[tableName].columns.map((c) => c.column_name.toLowerCase());
    const tenantCol = cols.find((c) => TENANT_COL_NAMES.has(c));
    if (tenantCol) {
      const key = `${tableName}.${tenantCol}`;
      const fk = fkByChild.get(key);
      tenantTables.push({
        table: tableName,
        tenant_column: tenantCol,
        has_fk: !!fk,
        fk_references: fk ? `${fk.parent_table}.${fk.parent_columns.join(",")}` : null,
      });
    }
  }

  const missingTenantFk = tenantTables.filter((t) => !t.has_fk);
  console.log(
    `  ${tenantTables.length} tables have an org_id/organization_id column; ${missingTenantFk.length} of those have no FK constraint on it.`,
  );

  const TENANT_COL_QUERY_NOTE =
    "Derived from test-evidence/pt-06/live-schema.json (column census) cross-referenced against the " +
    "foreign_keys check above (no live query beyond the FK enumeration already run in check 1).";

  result.checks.tenant_fk_gap = {
    method: TENANT_COL_QUERY_NOTE,
    tables_with_tenant_column: tenantTables.length,
    tables_missing_fk: missingTenantFk.length,
    details: tenantTables,
  };

  for (const t of missingTenantFk) {
    result.findings.push({
      check: "tenant_fk_gap",
      severity: "P1",
      table: t.table,
      column: t.tenant_column,
      description: `${t.table}.${t.tenant_column} exists as a column but has no live FOREIGN KEY constraint referencing organizations. RLS policies on this table commonly filter on this column; without a live FK, nothing in the database enforces that every value in it actually corresponds to a real organization, which weakens the referential guarantee PT-05 (isolation) and PT-14 (security) policies implicitly assume. Feeds PT-05/PT-14.`,
    });
  }

  // Also record tables with NEITHER organization_id nor org_id at all, for completeness --
  // this is the harder-to-automate half of instruction 2 ("SHOULD have... but don't declare
  // one"); a DB-only audit cannot judge intent, so this list is reported as a candidate set
  // for human triage, not asserted as findings on its own.
  const noTenantColAtAll = allTables.filter((t) => {
    const cols = liveSchema.tables[t].columns.map((c) => c.column_name.toLowerCase());
    return !cols.some((c) => TENANT_COL_NAMES.has(c));
  });
  result.checks.tenant_fk_gap.tables_with_no_tenant_column_at_all = {
    count: noTenantColAtAll.length,
    note:
      "Tables with neither organization_id nor org_id at all. Whether each SHOULD have one is a " +
      "product/app-layer judgment this DB-only audit cannot make blind (some are legitimately " +
      "platform-wide/shared reference tables -- see RLS_POLICY_AUDIT.md and ANON_GRANT_AUDIT.md, " +
      "which already classify several of these by reading real application call sites). Listed here " +
      "as the candidate set for human triage, not asserted as a finding by itself.",
    tables: noTenantColAtAll,
  };

  // ---------------------------------------------------------------------
  // Check 3: primary keys
  // ---------------------------------------------------------------------
  console.log("\n[3/4] Enumerating primary key coverage...");

  const PK_QUERY = `
    SELECT
      cl.relname AS table_name,
      array_agg(att.attname::text ORDER BY u.ord) AS pk_columns
    FROM pg_index ix
    JOIN pg_class cl ON cl.oid = ix.indrelid
    JOIN pg_namespace nsp ON nsp.oid = cl.relnamespace
    JOIN unnest(ix.indkey) WITH ORDINALITY AS u(attnum, ord) ON true
    JOIN pg_attribute att ON att.attrelid = cl.oid AND att.attnum = u.attnum
    WHERE ix.indisprimary AND nsp.nspname = 'public' AND cl.relkind = 'r'
    GROUP BY cl.relname
    ORDER BY cl.relname;
  `;
  const pkRes = await q(client, PK_QUERY, [], "pk-enumeration");
  if (!pkRes.ok) {
    console.error(`  PK enumeration FAILED: ${pkRes.error}`);
    result.checks.primary_keys = { query: PK_QUERY.trim(), error: pkRes.error };
  } else {
    const tablesWithPk = new Set(pkRes.rows.map((r) => r.table_name));
    const tablesWithoutPk = allTables.filter((t) => !tablesWithPk.has(t));
    console.log(`  ${tablesWithPk.size} of ${allTables.length} base tables have a PRIMARY KEY. ${tablesWithoutPk.length} do not.`);
    result.checks.primary_keys = {
      query: PK_QUERY.trim(),
      total_base_tables: allTables.length,
      tables_with_pk: tablesWithPk.size,
      tables_without_pk: tablesWithoutPk,
    };
    for (const t of tablesWithoutPk) {
      result.findings.push({
        check: "primary_keys",
        severity: "P2",
        table: t,
        description: `${t} has no PRIMARY KEY constraint. Without one, no row in this table can be uniquely and reliably referenced by another table's FK, ON CONFLICT upserts against it cannot target a row deterministically, and logical replication/CDC on this table (if ever enabled) would be degraded or impossible.`,
      });
    }
  }

  // ---------------------------------------------------------------------
  // Check 4: unique-constraint gaps (identifier-shaped columns with real duplicates)
  // ---------------------------------------------------------------------
  console.log("\n[4/4] Scanning for identifier-shaped columns lacking a unique index, with real duplicate data...");

  const UNIQUE_INDEX_QUERY = `
    SELECT
      cl.relname AS table_name,
      array_agg(att.attname::text ORDER BY u.ord) AS columns
    FROM pg_index ix
    JOIN pg_class cl ON cl.oid = ix.indrelid
    JOIN pg_namespace nsp ON nsp.oid = cl.relnamespace
    JOIN unnest(ix.indkey) WITH ORDINALITY AS u(attnum, ord) ON true
    JOIN pg_attribute att ON att.attrelid = cl.oid AND att.attnum = u.attnum
    WHERE ix.indisunique AND nsp.nspname = 'public' AND cl.relkind = 'r'
    GROUP BY cl.relname, ix.indexrelid
    ORDER BY cl.relname;
  `;
  const uniqRes = await q(client, UNIQUE_INDEX_QUERY, [], "unique-index-enumeration");

  const uniqueSingleCols = new Set(); // "table.column" already covered by a single-column unique index
  if (uniqRes.ok) {
    for (const row of uniqRes.rows) {
      if (row.columns.length === 1) {
        uniqueSingleCols.add(`${row.table_name}.${row.columns[0]}`);
      }
    }
  }
  result.checks.unique_indexes = uniqRes.ok
    ? { query: UNIQUE_INDEX_QUERY.trim(), index_count: uniqRes.rows.length, indexes: uniqRes.rows }
    : { query: UNIQUE_INDEX_QUERY.trim(), error: uniqRes.error };

  // Build candidate list: identifier-shaped columns not already single-column-unique-indexed.
  const candidates = [];
  for (const tableName of allTables) {
    for (const col of liveSchema.tables[tableName].columns) {
      const colName = col.column_name;
      if (colName.toLowerCase() === "ntee_code") continue; // not a real identity column, drop noise
      const matches = IDENTIFIER_COLUMN_PATTERNS.some((re) => re.test(colName));
      if (!matches) continue;
      const key = `${tableName}.${colName}`;
      if (uniqueSingleCols.has(key)) continue; // already enforced
      candidates.push({ table: tableName, column: colName });
    }
  }
  console.log(`  ${candidates.length} identifier-shaped column(s) found with no single-column unique index.`);

  const uniqueGapResults = [];
  for (const cand of candidates) {
    const dupSql = `
      SELECT count(*)::int AS group_count, sum(cnt - 1)::int AS extra_row_count
      FROM (
        SELECT "${cand.column}" AS val, count(*) AS cnt
        FROM "${cand.table}"
        WHERE "${cand.column}" IS NOT NULL
        GROUP BY "${cand.column}"
        HAVING count(*) > 1
      ) dupes;
    `;
    const dupRes = await q(client, dupSql, [], `dup-check:${cand.table}.${cand.column}`);
    if (!dupRes.ok) {
      uniqueGapResults.push({ table: cand.table, column: cand.column, query: dupSql.trim(), error: dupRes.error });
      continue;
    }
    const row = dupRes.rows[0];
    const groupCount = row.group_count || 0;
    const extraRows = row.extra_row_count || 0;
    const entry = {
      table: cand.table,
      column: cand.column,
      query: dupSql.trim(),
      duplicate_value_groups: groupCount,
      extra_row_count: extraRows,
      duration_ms: dupRes.durationMs,
    };
    uniqueGapResults.push(entry);
    if (groupCount > 0) {
      console.log(`  DUPLICATES: ${cand.table}.${cand.column}: ${groupCount} distinct value(s) repeated, ${extraRows} extra row(s)`);
      result.findings.push({
        check: "unique_gaps",
        severity: extraRows > 50 ? "P1" : "P2",
        table: cand.table,
        column: cand.column,
        duplicate_value_groups: groupCount,
        extra_row_count: extraRows,
        description: `${cand.table}.${cand.column} looks identifier-shaped (matches an identity-column naming pattern) and has no unique index, and real data already has ${groupCount} distinct value(s) that repeat across ${extraRows + groupCount} row(s) (${extraRows} more than the ${groupCount} "first" rows). Adding a UNIQUE constraint on this column today would fail against real, already-existing data -- the constraint was never added, or was added and then dropped, specifically because this duplication already exists.`,
        query: dupSql.trim(),
      });
    }
  }
  result.checks.unique_gaps = {
    candidate_columns_checked: candidates.length,
    candidates_with_duplicates: uniqueGapResults.filter((r) => r.duplicate_value_groups > 0).length,
    results: uniqueGapResults,
  };

  // ---------------------------------------------------------------------
  await client.end();
  console.log("\nConnection closed cleanly.");

  result.summary = {
    fk_constraints_checked: result.checks.foreign_keys.constraints ? result.checks.foreign_keys.constraints.length : 0,
    fk_orphan_findings: result.findings.filter((f) => f.check === "foreign_keys").length,
    tenant_fk_gap_findings: result.findings.filter((f) => f.check === "tenant_fk_gap").length,
    tables_without_pk: result.findings.filter((f) => f.check === "primary_keys").length,
    unique_gap_findings: result.findings.filter((f) => f.check === "unique_gaps").length,
    total_findings: result.findings.length,
    p1_findings: result.findings.filter((f) => f.severity === "P1").length,
    p2_findings: result.findings.filter((f) => f.severity === "P2").length,
  };

  fs.writeFileSync(OUT_FILE, JSON.stringify(result, null, 2), "utf8");
  console.log(`\nWrote ${OUT_FILE}`);
  console.log(JSON.stringify(result.summary, null, 2));
}

main().catch(async (err) => {
  console.error(`HALT: unexpected error: ${err.stack || err.message}`);
  process.exit(1);
});
