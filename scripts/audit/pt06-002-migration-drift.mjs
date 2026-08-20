// ============================================================================
// PT-06-002 -- reconcile every migration file on disk (both known
// directories) against the live production schema, and produce the
// three-way drift partition:
//
//   APPLIED-AND-ON-DISK  -- every table/column/enum-value this file defines
//                           is confirmed present in the live public schema.
//   ON-DISK-NOT-APPLIED  -- the file defines at least one table, column, or
//                           enum value that is NOT present live. This is the
//                           dangerous set: code written against this file's
//                           schema will fail in production.
//   APPLIED-NOT-ON-DISK  -- a live public-schema table with no corresponding
//                           CREATE TABLE statement in ANY on-disk migration
//                           file (either directory). Orphan/rogue objects.
//
// A fourth bucket, NO_DDL_UNVERIFIABLE, holds files with zero checkable
// CREATE TABLE / ADD COLUMN / CREATE TYPE / ALTER TYPE ADD VALUE statements
// (RLS-only, data-backfill-only, comment-only files) -- these cannot be
// classified applied/unapplied by schema introspection at all, so they are
// kept out of the three primary lists rather than silently defaulted into
// one of them.
//
// Methodology note (ported from MIGRATION_AUDIT.md, 2026-07-28/30, and
// extended to cover BOTH migration directories instead of just the root
// tree): this checks table/column/enum-value EXISTENCE, not RLS policy
// correctness (PostgREST/information_schema introspection doesn't expose
// pg_policies content in a way this script queries) and not whether the
// exact DEFAULT/CHECK constraint text matches. A table that exists with the
// right name and the right column names, created by ANY process (this file,
// a different file, or manual DDL), reads as "applied" for this file's
// purposes -- the real-world question this audit answers is "would code
// written against this migration's schema work against production today,"
// not "did this exact file's bytes execute."
//
// Extraction approach: rather than a full statement-level parser tracking
// DO $$ ... $$ nesting (which the sibling scripts/check-migration-idempotency.ts
// does for a different purpose), this uses a comment-stripped, full-text
// regex scan for the four statement shapes this audit needs. This correctly
// finds CREATE TABLE / ALTER TABLE ADD COLUMN / CREATE TYPE / ALTER TYPE ADD
// VALUE statements regardless of whether they sit inside a DO $$ block,
// since it never depends on statement boundaries -- only on the literal
// keyword sequences, which is sufficient for the existence-check this task
// needs (not a correctness check of the SQL itself).
//
// Evidence: test-evidence/pt-06/migration-drift.json
// Inputs:   test-evidence/pt-06/migration-files.json (pt06-001 file inventory)
//           test-evidence/pt-06/live-schema-snapshot.json (pt06-002 live fetch)
//
// Usage: node scripts/audit/pt06-002-migration-drift.mjs
// ============================================================================

import fs from "node:fs";
import path from "node:path";

const OUT_DIR = path.join("test-evidence", "pt-06");
const FILES_JSON = path.join(OUT_DIR, "migration-files.json");
const SCHEMA_JSON = path.join(OUT_DIR, "live-schema-snapshot.json");
const OUT_FILE = path.join(OUT_DIR, "migration-drift.json");
const APPLIED_MIGRATIONS_FILE = path.join(OUT_DIR, "applied-migrations.json");

// ----------------------------------------------------------------------------
// Comment stripping (respects single-quoted strings and $tag$ bodies so a
// "--" or "/*" inside a string literal or a dollar-quoted body is not
// mistaken for a real comment start).
// ----------------------------------------------------------------------------

function stripComments(sql) {
  let out = "";
  const n = sql.length;
  let i = 0;
  let dollarTag = null;
  let inSingle = false;

  while (i < n) {
    const c = sql[i];
    const two = sql.slice(i, i + 2);

    if (dollarTag) {
      out += c;
      if (sql.startsWith(dollarTag, i)) {
        out += dollarTag.slice(1);
        i += dollarTag.length;
        continue;
      }
      i++;
      continue;
    }
    if (inSingle) {
      out += c;
      if (c === "'") {
        if (sql[i + 1] === "'") {
          out += "'";
          i += 2;
          continue;
        }
        inSingle = false;
      }
      i++;
      continue;
    }
    if (two === "--") {
      // Line comment: skip to end of line, but keep the newline for line-based reasoning.
      const nl = sql.indexOf("\n", i);
      i = nl === -1 ? n : nl;
      continue;
    }
    if (two === "/*") {
      const end = sql.indexOf("*/", i + 2);
      i = end === -1 ? n : end + 2;
      continue;
    }
    if (c === "'") {
      inSingle = true;
      out += c;
      i++;
      continue;
    }
    if (c === "$") {
      const m = /^\$[A-Za-z_]*\$/.exec(sql.slice(i));
      if (m) {
        dollarTag = m[0];
        out += m[0];
        i += m[0].length;
        continue;
      }
    }
    out += c;
    i++;
  }
  return out;
}

function unquote(ident) {
  return ident.replace(/^"(.*)"$/, "$1").toLowerCase();
}

// Find the matching closing paren for an opening paren at index `openIdx`.
function findMatchingParen(text, openIdx) {
  let depth = 0;
  for (let i = openIdx; i < text.length; i++) {
    if (text[i] === "(") depth++;
    else if (text[i] === ")") {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

// Split a paren body's top-level comma-separated clauses (ignoring commas
// nested inside their own parens, e.g. numeric(10,2)).
function splitTopLevel(body) {
  const parts = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < body.length; i++) {
    if (body[i] === "(") depth++;
    else if (body[i] === ")") depth--;
    else if (body[i] === "," && depth === 0) {
      parts.push(body.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(body.slice(start));
  return parts.map((p) => p.trim()).filter(Boolean);
}

const TABLE_CLAUSE_KEYWORDS = /^(CONSTRAINT|PRIMARY\s+KEY|UNIQUE|FOREIGN\s+KEY|CHECK|EXCLUDE|LIKE)\b/i;

function extractColumnNamesFromCreateTableBody(body) {
  const clauses = splitTopLevel(body);
  const cols = [];
  for (const clause of clauses) {
    const trimmed = clause.trim();
    if (!trimmed) continue;
    if (TABLE_CLAUSE_KEYWORDS.test(trimmed)) continue;
    const m = /^("(?:[^"]|"")+"|[A-Za-z_][A-Za-z0-9_]*)/.exec(trimmed);
    if (m) cols.push(unquote(m[1]));
  }
  return cols;
}

// ----------------------------------------------------------------------------
// Extraction: scan comment-stripped text for the four statement shapes.
// ----------------------------------------------------------------------------

function extractRequiredObjects(rawSql) {
  const sql = stripComments(rawSql);
  const tables = new Map(); // tableName -> Set(columnNames) required to exist
  const enumValues = new Map(); // enumName -> Set(values) required to exist
  let hasAnyDdl = false;

  // --- CREATE TABLE [IF NOT EXISTS] name ( ... ) ---
  const createTableRe = /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:public\.)?("(?:[^"]|"")+"|[A-Za-z_][A-Za-z0-9_]*)\s*\(/gi;
  let m;
  while ((m = createTableRe.exec(sql)) !== null) {
    const tableName = unquote(m[1]);
    const openIdx = m.index + m[0].length - 1;
    const closeIdx = findMatchingParen(sql, openIdx);
    if (closeIdx === -1) continue;
    const body = sql.slice(openIdx + 1, closeIdx);
    const cols = extractColumnNamesFromCreateTableBody(body);
    if (!tables.has(tableName)) tables.set(tableName, new Set());
    for (const c of cols) tables.get(tableName).add(c);
    hasAnyDdl = true;
  }

  // --- ALTER TABLE [ONLY] name  <clauses up to the statement's terminating ;> ---
  // Extract ADD COLUMN [IF NOT EXISTS] col within each ALTER TABLE statement.
  const alterTableRe = /ALTER\s+TABLE\s+(?:ONLY\s+)?(?:public\.)?("(?:[^"]|"")+"|[A-Za-z_][A-Za-z0-9_]*)\s*([\s\S]*?);/gi;
  while ((m = alterTableRe.exec(sql)) !== null) {
    const tableName = unquote(m[1]);
    const clauseText = m[2];
    const addColRe = /ADD\s+COLUMN\s+(?:IF\s+NOT\s+EXISTS\s+)?("(?:[^"]|"")+"|[A-Za-z_][A-Za-z0-9_]*)/gi;
    let cm;
    let found = false;
    while ((cm = addColRe.exec(clauseText)) !== null) {
      const colName = unquote(cm[1]);
      if (!tables.has(tableName)) tables.set(tableName, new Set());
      tables.get(tableName).add(colName);
      found = true;
    }
    if (found) hasAnyDdl = true;
  }

  // --- CREATE TYPE name AS ENUM ( 'a', 'b', ... ) ---
  const createTypeRe = /CREATE\s+TYPE\s+(?:public\.)?("(?:[^"]|"")+"|[A-Za-z_][A-Za-z0-9_]*)\s+AS\s+ENUM\s*\(/gi;
  while ((m = createTypeRe.exec(sql)) !== null) {
    const enumName = unquote(m[1]);
    const openIdx = m.index + m[0].length - 1;
    const closeIdx = findMatchingParen(sql, openIdx);
    if (closeIdx === -1) continue;
    const body = sql.slice(openIdx + 1, closeIdx);
    const values = [...body.matchAll(/'((?:[^']|'')*)'/g)].map((mm) => mm[1].replace(/''/g, "'"));
    if (!enumValues.has(enumName)) enumValues.set(enumName, new Set());
    for (const v of values) enumValues.get(enumName).add(v);
    hasAnyDdl = true;
  }

  // --- ALTER TYPE name ADD VALUE [IF NOT EXISTS] 'value' ---
  const alterTypeRe = /ALTER\s+TYPE\s+(?:public\.)?("(?:[^"]|"")+"|[A-Za-z_][A-Za-z0-9_]*)\s+ADD\s+VALUE\s+(?:IF\s+NOT\s+EXISTS\s+)?'((?:[^']|'')*)'/gi;
  while ((m = alterTypeRe.exec(sql)) !== null) {
    const enumName = unquote(m[1]);
    const value = m[2].replace(/''/g, "'");
    if (!enumValues.has(enumName)) enumValues.set(enumName, new Set());
    enumValues.get(enumName).add(value);
    hasAnyDdl = true;
  }

  return { tables, enumValues, hasAnyDdl };
}

// ----------------------------------------------------------------------------
// Verification against the live schema snapshot.
// ----------------------------------------------------------------------------

function verifyAgainstLiveSchema(required, liveSchema) {
  const liveTables = new Set(liveSchema.publicSchema.tables.map((t) => t.toLowerCase()));
  const liveTableColumns = {};
  for (const [t, cols] of Object.entries(liveSchema.publicSchema.tableColumns)) {
    liveTableColumns[t.toLowerCase()] = new Set(cols.map((c) => c.toLowerCase()));
  }
  const liveEnumValues = {};
  for (const [e, vals] of Object.entries(liveSchema.publicSchema.enumValues)) {
    liveEnumValues[e.toLowerCase()] = new Set(vals);
  }

  const missing = [];

  for (const [tableName, cols] of required.tables.entries()) {
    if (!liveTables.has(tableName)) {
      missing.push({ kind: "table", table: tableName, detail: "table does not exist live" });
      continue;
    }
    const liveCols = liveTableColumns[tableName] || new Set();
    for (const col of cols) {
      if (!liveCols.has(col)) {
        missing.push({ kind: "column", table: tableName, column: col, detail: "column does not exist live on this table" });
      }
    }
  }

  for (const [enumName, values] of required.enumValues.entries()) {
    const liveVals = liveEnumValues[enumName];
    if (!liveVals) {
      missing.push({ kind: "enum_type", enumType: enumName, detail: "enum type does not exist live" });
      continue;
    }
    for (const v of values) {
      if (!liveVals.has(v)) {
        missing.push({ kind: "enum_value", enumType: enumName, value: v, detail: "enum value not present live" });
      }
    }
  }

  return missing;
}

// ----------------------------------------------------------------------------
// Main
// ----------------------------------------------------------------------------

function main() {
  if (!fs.existsSync(FILES_JSON)) {
    throw new Error(`Missing ${FILES_JSON} -- run pt06-002-migration-inventory.mjs (pt06-001) first.`);
  }
  if (!fs.existsSync(SCHEMA_JSON)) {
    throw new Error(`Missing ${SCHEMA_JSON} -- run pt06-002-fetch-live-schema.mjs first.`);
  }

  const filesInventory = JSON.parse(fs.readFileSync(FILES_JSON, "utf8"));
  const liveSchema = JSON.parse(fs.readFileSync(SCHEMA_JSON, "utf8"));

  const appliedAndOnDisk = [];
  const onDiskNotApplied = [];
  const noDdlUnverifiable = [];

  // Track every table name created by ANY on-disk migration file, across
  // both directories, for the APPLIED-NOT-ON-DISK (orphan) check below.
  const allOnDiskCreatedTables = new Set();

  for (const dirEntry of filesInventory.perDirectory) {
    if (!dirEntry.exists) continue;
    for (const fileMeta of dirEntry.files) {
      const fullPath = path.join(dirEntry.directory, fileMeta.filename);
      const rawSql = fs.readFileSync(fullPath, "utf8");
      const required = extractRequiredObjects(rawSql);

      for (const tableName of required.tables.keys()) {
        allOnDiskCreatedTables.add(tableName);
      }

      const record = {
        filename: fileMeta.filename,
        directory: dirEntry.directory,
        fullPath: fullPath.split(path.sep).join("/"),
        prefixRaw: fileMeta.prefixRaw,
        sha256: fileMeta.sha256,
        requiredTables: Object.fromEntries(
          [...required.tables.entries()].map(([t, cols]) => [t, [...cols].sort()]),
        ),
        requiredEnumValues: Object.fromEntries(
          [...required.enumValues.entries()].map(([e, vals]) => [e, [...vals].sort()]),
        ),
      };

      if (!required.hasAnyDdl) {
        noDdlUnverifiable.push(record);
        continue;
      }

      const missing = verifyAgainstLiveSchema(required, liveSchema);
      if (missing.length === 0) {
        appliedAndOnDisk.push(record);
      } else {
        onDiskNotApplied.push({ ...record, missing });
      }
    }
  }

  // APPLIED-NOT-ON-DISK: live public-schema tables with no CREATE TABLE
  // anywhere on disk. Note this will also catch tables created purely via
  // ALTER TABLE ... ADD COLUMN against a table this audit's own extraction
  // never saw a CREATE TABLE for (e.g. the table's CREATE TABLE predates
  // both known migration directories, or was created by raw DDL outside
  // any migration file, per STANDING_DIRECTIVES.md DIRECTIVE-017's own
  // documented practice of applying ad hoc DDL directly). Flagged, not
  // silently dropped.
  const KNOWN_NON_MIGRATION_TABLES_NOTE =
    "Some entries here may be Supabase/Postgres-managed tables in the public schema " +
    "(rare) or tables created by hand-run DDL outside any committed migration file -- " +
    "both are real possibilities in this project's history per STANDING_DIRECTIVES.md " +
    "DIRECTIVE-017. This list is exhaustive against the two known migration directories, " +
    "not a claim that every entry is illegitimate.";
  const appliedNotOnDisk = liveSchema.publicSchema.tables
    .map((t) => t.toLowerCase())
    .filter((t) => !allOnDiskCreatedTables.has(t))
    .sort()
    .map((t) => ({ table: t, columns: liveSchema.publicSchema.tableColumns[t] || liveSchema.publicSchema.tableColumns[Object.keys(liveSchema.publicSchema.tableColumns).find(k => k.toLowerCase() === t)] || [] }));

  // ---- Sanity: partition must not overlap ----
  const onDiskKeys = new Set([...appliedAndOnDisk, ...onDiskNotApplied, ...noDdlUnverifiable].map(r => `${r.directory}/${r.filename}`));
  const totalOnDiskFiles = filesInventory.summary.totalFilesAcrossKnownDirectories;

  const output = {
    generatedAt: new Date().toISOString(),
    methodology:
      "No supabase_migrations.schema_migrations tracking table exists in this project " +
      "(confirmed live, see applied-migrations.json / live-schema-snapshot.json). Applied " +
      "status is therefore determined by live object existence: for every migration file " +
      "across both known directories (src/supabase/migrations, supabase/migrations), every " +
      "CREATE TABLE / ALTER TABLE ADD COLUMN / CREATE TYPE ... AS ENUM / ALTER TYPE ADD VALUE " +
      "statement is extracted (including ones textually inside DO $$ ... $$ blocks) and each " +
      "resulting table/column/enum-value is checked against the live production public " +
      "schema. A file with zero such statements (RLS-only, data-backfill-only, comment-only) " +
      "cannot be classified this way and is recorded separately as NO_DDL_UNVERIFIABLE rather " +
      "than defaulted into either applied or unapplied.",
    sourceFiles: {
      migrationFilesInventory: FILES_JSON.split(path.sep).join("/"),
      liveSchemaSnapshot: SCHEMA_JSON.split(path.sep).join("/"),
    },
    counts: {
      totalMigrationFilesOnDisk: totalOnDiskFiles,
      appliedAndOnDisk: appliedAndOnDisk.length,
      onDiskNotApplied: onDiskNotApplied.length,
      noDdlUnverifiable: noDdlUnverifiable.length,
      checkableTotal: appliedAndOnDisk.length + onDiskNotApplied.length,
      appliedNotOnDisk: appliedNotOnDisk.length,
      livePublicSchemaTableCount: liveSchema.publicSchema.tableCount,
    },
    partitionIntegrity: {
      sumOfThreeBuckets: appliedAndOnDisk.length + onDiskNotApplied.length + noDdlUnverifiable.length,
      matchesTotalOnDiskFiles:
        appliedAndOnDisk.length + onDiskNotApplied.length + noDdlUnverifiable.length === totalOnDiskFiles,
      distinctFileKeysAcrossBuckets: onDiskKeys.size,
      noOverlapAcrossBuckets:
        onDiskKeys.size === appliedAndOnDisk.length + onDiskNotApplied.length + noDdlUnverifiable.length,
    },
    appliedAndOnDisk,
    onDiskNotApplied,
    noDdlUnverifiable,
    appliedNotOnDisk: {
      note: KNOWN_NON_MIGRATION_TABLES_NOTE,
      entries: appliedNotOnDisk,
    },
  };

  fs.writeFileSync(OUT_FILE, JSON.stringify(output, null, 2) + "\n", "utf8");

  // ---- Step 1 deliverable: applied-migrations.json ----
  // The task asks to "query the production migration-tracking table... capture
  // the full list of APPLIED migration versions with their timestamps." The
  // live query (pt06-002-fetch-live-schema.mjs) already proved, two
  // independent ways, that no such tracking table exists in this project --
  // there is no ledger of "applied migration versions" with timestamps to
  // capture, because none was ever written (every migration in this
  // project's history was applied by hand via direct DATABASE_URL/psql, not
  // via `supabase db push`/`migration up`). That absence is itself the
  // primary finding recorded here, not glossed over. The practical
  // substitute -- the same one MIGRATION_AUDIT.md used -- is object-existence:
  // a migration file counts as "applied" if every table/column/enum-value it
  // defines is confirmed present in the live schema right now. That list
  // (with no real timestamp, since none exists to report) is included below
  // for completeness and cross-referenced against migration-drift.json.
  const appliedMigrationsOutput = {
    generatedAt: new Date().toISOString(),
    trackingTableQuery: {
      queriedFor: "supabase_migrations.schema_migrations (Supabase CLI's standard migration ledger)",
      result: "DOES_NOT_EXIST",
      evidence: liveSchema.migrationTrackingTableCheck,
      conclusion:
        "This project has no migration-tracking table. Every migration was applied by hand " +
        "(psql/DATABASE_URL per STANDING_DIRECTIVES.md DIRECTIVE-017), not via Supabase CLI's " +
        "migration workflow, so there is no ledger of applied migration versions or the " +
        "timestamps they ran at. 'Applied' below is therefore determined by live " +
        "object-existence (does the table/column/enum-value the file defines exist in " +
        "production right now), the same method migration-drift.json uses, not by a " +
        "recorded version+timestamp pair -- because no such record exists anywhere to query.",
    },
    appliedMigrations: appliedAndOnDisk.map((r) => ({
      filename: r.filename,
      directory: r.directory,
      prefixRaw: r.prefixRaw,
      appliedVerdictBasis: "live-object-existence (see migration-drift.json)",
      timestamp: null,
      timestampUnavailableReason: "no migration-tracking ledger exists in this project (see trackingTableQuery above)",
    })),
    appliedMigrationsCount: appliedAndOnDisk.length,
  };
  fs.writeFileSync(APPLIED_MIGRATIONS_FILE, JSON.stringify(appliedMigrationsOutput, null, 2) + "\n", "utf8");
  console.log(`Wrote ${APPLIED_MIGRATIONS_FILE}`);
  console.log(`  tracking table exists: false (see trackingTableQuery.result)`);
  console.log(`  applied (object-existence basis): ${appliedAndOnDisk.length}`);

  console.log(`Wrote ${OUT_FILE}`);
  console.log(`  total migration files on disk: ${totalOnDiskFiles}`);
  console.log(`  APPLIED-AND-ON-DISK: ${appliedAndOnDisk.length}`);
  console.log(`  ON-DISK-NOT-APPLIED (drift): ${onDiskNotApplied.length}`);
  console.log(`  NO_DDL_UNVERIFIABLE: ${noDdlUnverifiable.length}`);
  console.log(`  APPLIED-NOT-ON-DISK (orphan tables): ${appliedNotOnDisk.length}`);
  console.log(`  partition sums to total files: ${output.partitionIntegrity.matchesTotalOnDiskFiles}`);
}

main();
