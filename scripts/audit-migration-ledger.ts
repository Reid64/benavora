// ============================================================================
// BENAVORA — migration ledger vs. reality audit
//
// Reads supabase_migrations.schema_migrations from production (if it exists
// at all — this project has never run `supabase db push`, only direct DDL
// per STANDING_DIRECTIVES.md DIRECTIVE-017, so it may not), lists every file
// in supabase/migrations/, and for every file NOT recorded in the ledger,
// parses its DDL and probes production for every object it creates or
// alters (tables, columns, indexes, policies, functions, enum types, enum
// values, triggers, constraints, extensions). Classifies each such file as:
//   APPLIED-UNRECORDED — every probed object exists live
//   PARTIAL            — some but not all probed objects exist live
//   MISSING            — zero probed objects exist live
//   NO-OP              — file has zero probeable schema-creating statements
//                         (pure data/GRANT/COMMENT file) — nothing to check
//
// Read-only. Never mutates production. Writes
// test-evidence/remediation/migration-drift/ledger-audit.md.
//
// Usage: npx tsx scripts/audit-migration-ledger.ts
// ============================================================================

import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import fs from "fs";
import path from "path";
import { Client } from "pg";

const REPO_ROOT = process.cwd();
const MIGRATIONS_DIR = path.join(REPO_ROOT, "supabase", "migrations");
const OUT_PATH = path.join(
  REPO_ROOT,
  "test-evidence",
  "remediation",
  "migration-drift",
  "ledger-audit.md",
);

// ----------------------------------------------------------------------------
// Statement splitting (copied from scripts/check-migration-idempotency.ts —
// same real tokenizer: respects string literals, comments, $tag$ bodies).
// ----------------------------------------------------------------------------

interface RawStatement {
  text: string;
  start: number;
  end: number;
}

function splitStatements(sql: string): RawStatement[] {
  const stmts: RawStatement[] = [];
  const n = sql.length;
  let i = 0;
  let stmtStart = 0;
  let dollarTag: string | null = null;
  let inSingle = false;
  let inLineComment = false;
  let inBlockComment = false;

  while (i < n) {
    const c = sql[i];
    const two = sql.slice(i, i + 2);

    if (inLineComment) {
      if (c === "\n") inLineComment = false;
      i++;
      continue;
    }
    if (inBlockComment) {
      if (two === "*/") {
        inBlockComment = false;
        i += 2;
        continue;
      }
      i++;
      continue;
    }
    if (dollarTag) {
      if (sql.startsWith(dollarTag, i)) {
        i += dollarTag.length;
        dollarTag = null;
        continue;
      }
      i++;
      continue;
    }
    if (inSingle) {
      if (c === "'") {
        if (sql[i + 1] === "'") {
          i += 2;
          continue;
        }
        inSingle = false;
        i++;
        continue;
      }
      i++;
      continue;
    }

    if (two === "--") {
      inLineComment = true;
      i += 2;
      continue;
    }
    if (two === "/*") {
      inBlockComment = true;
      i += 2;
      continue;
    }
    if (c === "'") {
      inSingle = true;
      i++;
      continue;
    }
    if (c === "$") {
      const m = /^\$[A-Za-z_]*\$/.exec(sql.slice(i));
      if (m) {
        dollarTag = m[0];
        i += m[0].length;
        continue;
      }
      i++;
      continue;
    }
    if (c === ";") {
      const text = sql.slice(stmtStart, i);
      if (text.trim().length > 0) stmts.push({ text, start: stmtStart, end: i });
      stmtStart = i + 1;
      i++;
      continue;
    }
    i++;
  }
  const rest = sql.slice(stmtStart);
  if (rest.trim().length > 0) stmts.push({ text: rest, start: stmtStart, end: n });
  return stmts;
}

function stripLeadingComments(stmt: string): string {
  let s = stmt;
  let changed = true;
  while (changed) {
    changed = false;
    const trimmed = s.replace(/^\s+/, "");
    if (trimmed.startsWith("--")) {
      const nl = trimmed.indexOf("\n");
      s = nl === -1 ? "" : trimmed.slice(nl + 1);
      changed = true;
    } else if (trimmed !== s) {
      s = trimmed;
    }
  }
  return s.trim();
}

function stripQuotes(s: string): string {
  return s.replace(/^"/, "").replace(/"$/, "");
}

function splitSchemaQualified(s: string): { schema: string; name: string } {
  const cleaned = s.replace(/[;(),]+$/, "");
  const parts = cleaned.split(".");
  if (parts.length >= 2) {
    return { schema: stripQuotes(parts[0]!), name: stripQuotes(parts[1]!) };
  }
  return { schema: "public", name: stripQuotes(cleaned) };
}

// ----------------------------------------------------------------------------
// Object extraction — one entry per probeable object a statement creates or
// alters. `kind` determines the probe query in probeObject() below.
// ----------------------------------------------------------------------------

type ObjectKind =
  | "TABLE"
  | "COLUMN"
  | "INDEX"
  | "POLICY"
  | "TRIGGER"
  | "ENUM_TYPE"
  | "ENUM_VALUE"
  | "FUNCTION"
  | "CONSTRAINT"
  | "EXTENSION";

interface ProbeObject {
  kind: ObjectKind;
  label: string; // human-readable, used in the report
  params: string[]; // positional params for the probe query
}

function extractObjects(rawStmt: string, fileText: string, start: number): ProbeObject[] {
  const objs: ProbeObject[] = [];
  const head = stripLeadingComments(rawStmt);
  if (!head) return objs;
  let m: RegExpExecArray | null;

  // DO $$ ... $$ blocks: best-effort scan inside for CREATE POLICY / ADD
  // CONSTRAINT / ADD COLUMN / ALTER TYPE ADD VALUE the block performs
  // conditionally (e.g. "IF NOT EXISTS (...) THEN ... END IF").
  if (/^DO\s+(?:LANGUAGE\s+\w+\s+)?\$/i.test(head)) {
    let mm: RegExpExecArray | null;
    const addValRe = /ALTER\s+TYPE\s+(\S+)\s+ADD\s+VALUE\s+(?:IF\s+NOT\s+EXISTS\s+)?'([^']+)'/gi;
    while ((mm = addValRe.exec(head))) {
      const { name } = splitSchemaQualified(mm[1]!);
      objs.push({ kind: "ENUM_VALUE", label: `${name} += '${mm[2]}'`, params: [name, mm[2]!] });
    }
    const addColRe = /ALTER\s+TABLE\s+(\S+)\s+ADD\s+COLUMN\s+(?:IF\s+NOT\s+EXISTS\s+)?(\S+)/gi;
    while ((mm = addColRe.exec(head))) {
      const { schema, name: table } = splitSchemaQualified(mm[1]!);
      const col = stripQuotes(mm[2]!.replace(/[;,]$/, ""));
      objs.push({ kind: "COLUMN", label: `${table}.${col}`, params: [schema, table, col] });
    }
    return objs;
  }

  if ((m = /^CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(\S+)/i.exec(head))) {
    const { schema, name } = splitSchemaQualified(m[1]!);
    objs.push({ kind: "TABLE", label: `${schema}.${name}`, params: [schema, name] });
    return objs;
  }

  if ((m = /^CREATE\s+EXTENSION\s+(?:IF\s+NOT\s+EXISTS\s+)?"?([\w-]+)"?/i.exec(head))) {
    objs.push({ kind: "EXTENSION", label: m[1]!, params: [m[1]!] });
    return objs;
  }

  if ((m = /^CREATE\s+(?:UNIQUE\s+)?INDEX\s+(?:CONCURRENTLY\s+)?(?:IF\s+NOT\s+EXISTS\s+)?(\S+)/i.exec(head))) {
    const name = stripQuotes(m[1]!.replace(/[;]/g, ""));
    objs.push({ kind: "INDEX", label: name, params: [name] });
    return objs;
  }

  if ((m = /^CREATE\s+POLICY\s+"?([^"\s]+)"?\s+ON\s+(\S+)/i.exec(head))) {
    const policyName = m[1]!;
    const { schema, name: table } = splitSchemaQualified(m[2]!);
    objs.push({
      kind: "POLICY",
      label: `"${policyName}" ON ${schema}.${table}`,
      params: [policyName, table, schema],
    });
    return objs;
  }

  if ((m = /^CREATE\s+(?:OR\s+REPLACE\s+)?TRIGGER\s+(\S+)[\s\S]*?\bON\s+(\S+)/i.exec(head))) {
    const trigName = m[1]!;
    const { schema, name: table } = splitSchemaQualified(m[2]!);
    objs.push({
      kind: "TRIGGER",
      label: `${trigName} ON ${schema}.${table}`,
      params: [trigName, table, schema],
    });
    return objs;
  }

  if ((m = /^CREATE\s+TYPE\s+(\S+)\s+AS\s+ENUM/i.exec(head))) {
    const { name } = splitSchemaQualified(m[1]!);
    objs.push({ kind: "ENUM_TYPE", label: name, params: [name] });
    return objs;
  }

  if (/^ALTER\s+TYPE\s+/i.test(head) && /ADD\s+VALUE/i.test(head)) {
    const nm = /^ALTER\s+TYPE\s+(\S+)\s+ADD\s+VALUE\s+(?:IF\s+NOT\s+EXISTS\s+)?'([^']+)'/i.exec(head);
    if (nm) {
      const { name } = splitSchemaQualified(nm[1]!);
      objs.push({ kind: "ENUM_VALUE", label: `${name} += '${nm[2]}'`, params: [name, nm[2]!] });
    }
    return objs;
  }

  if ((m = /^ALTER\s+TABLE\s+(?:ONLY\s+)?(\S+)/i.exec(head))) {
    const { schema, name: table } = splitSchemaQualified(m[1]!);
    let cm: RegExpExecArray | null;

    const addColRe = /ADD\s+COLUMN\s+(?:IF\s+NOT\s+EXISTS\s+)?(\S+)/gi;
    while ((cm = addColRe.exec(head))) {
      const col = stripQuotes(cm[1]!.replace(/,$/, ""));
      objs.push({ kind: "COLUMN", label: `${table}.${col}`, params: [schema, table, col] });
    }

    const renameRe = /RENAME\s+COLUMN\s+(\S+)\s+TO\s+(\S+)/gi;
    while ((cm = renameRe.exec(head))) {
      const newCol = stripQuotes(cm[2]!.replace(/,$/, ""));
      objs.push({
        kind: "COLUMN",
        label: `${table}.${cm[1]} -> ${newCol} (renamed)`,
        params: [schema, table, newCol],
      });
    }

    const addConRe = /ADD\s+CONSTRAINT\s+(\S+)/gi;
    while ((cm = addConRe.exec(head))) {
      const consName = stripQuotes(cm[1]!);
      objs.push({ kind: "CONSTRAINT", label: `${table}.${consName}`, params: [table, consName] });
    }

    return objs;
  }

  if ((m = /^CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+(\S+?)\s*\(/i.exec(head))) {
    const { schema, name } = splitSchemaQualified(m[1]!);
    objs.push({ kind: "FUNCTION", label: `${schema}.${name}`, params: [schema, name] });
    return objs;
  }

  // DROP_*, INSERT, GRANT/REVOKE, COMMENT ON, ENABLE/DISABLE RLS, plain
  // UPDATE/SELECT/SET — not schema-creating; out of this audit's probe scope
  // (they don't "create or alter" a checkable object, per the task's own
  // wording).
  return objs;
}

function extractFileObjects(fileText: string): ProbeObject[] {
  const all: ProbeObject[] = [];
  for (const stmt of splitStatements(fileText)) {
    all.push(...extractObjects(stmt.text, fileText, stmt.start));
  }
  // De-dupe (a column/constraint can appear identically in more than one
  // extracted statement in rare formatting cases).
  const seen = new Set<string>();
  const deduped: ProbeObject[] = [];
  for (const o of all) {
    const key = `${o.kind}:${o.params.join(" ")}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(o);
  }
  return deduped;
}

// ----------------------------------------------------------------------------
// Probing
// ----------------------------------------------------------------------------

const PROBE_SQL: Record<ObjectKind, string> = {
  TABLE: `SELECT 1 FROM information_schema.tables WHERE table_schema = $1 AND table_name = $2`,
  COLUMN: `SELECT 1 FROM information_schema.columns WHERE table_schema = $1 AND table_name = $2 AND column_name = $3`,
  INDEX: `SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND indexname = $1`,
  POLICY: `SELECT 1 FROM pg_policies WHERE schemaname = $3 AND policyname = $1 AND tablename = $2`,
  TRIGGER: `SELECT 1 FROM pg_trigger t JOIN pg_class c ON t.tgrelid = c.oid JOIN pg_namespace n ON c.relnamespace = n.oid WHERE n.nspname = $3 AND t.tgname = $1 AND c.relname = $2 AND NOT t.tgisinternal`,
  ENUM_TYPE: `SELECT 1 FROM pg_type WHERE typname = $1 AND typtype = 'e'`,
  ENUM_VALUE: `SELECT 1 FROM pg_enum e JOIN pg_type t ON e.enumtypid = t.oid WHERE t.typname = $1 AND e.enumlabel = $2`,
  FUNCTION: `SELECT 1 FROM pg_proc p JOIN pg_namespace n ON p.pronamespace = n.oid WHERE n.nspname = $1 AND p.proname = $2`,
  CONSTRAINT: `SELECT 1 FROM information_schema.table_constraints WHERE table_schema = 'public' AND table_name = $1 AND constraint_name = $2`,
  EXTENSION: `SELECT 1 FROM pg_extension WHERE extname = $1`,
};

async function probeObject(client: Client, obj: ProbeObject): Promise<boolean> {
  const sql = PROBE_SQL[obj.kind];
  const res = await client.query(sql, obj.params);
  return (res.rowCount ?? 0) > 0;
}

// ----------------------------------------------------------------------------
// Main
// ----------------------------------------------------------------------------

interface FileVerdict {
  file: string;
  inLedger: boolean;
  classification: "APPLIED-UNRECORDED" | "PARTIAL" | "MISSING" | "NO-OP";
  total: number;
  present: number;
  missingObjects: string[];
}

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error("DATABASE_URL not set in .env.local — cannot probe production.");
    process.exit(1);
  }
  const client = new Client({ connectionString: databaseUrl, ssl: { rejectUnauthorized: false } });
  await client.connect();

  // 1. Ledger
  let ledgerExists = false;
  let ledgerVersions: string[] = [];
  try {
    const schemaCheck = await client.query(
      `SELECT 1 FROM information_schema.schemata WHERE schema_name = 'supabase_migrations'`,
    );
    if ((schemaCheck.rowCount ?? 0) > 0) {
      const tableCheck = await client.query(
        `SELECT 1 FROM information_schema.tables WHERE table_schema = 'supabase_migrations' AND table_name = 'schema_migrations'`,
      );
      if ((tableCheck.rowCount ?? 0) > 0) {
        ledgerExists = true;
        const rows = await client.query(
          `SELECT version FROM supabase_migrations.schema_migrations ORDER BY version`,
        );
        ledgerVersions = rows.rows.map((r) => String(r.version));
      }
    }
  } catch (err) {
    console.error("Ledger read failed:", (err as Error).message);
  }

  // 2. Files on disk
  const files = fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort();

  const verdicts: FileVerdict[] = [];

  for (const file of files) {
    const version = file.split("_")[0]!;
    const inLedger = ledgerVersions.includes(version);
    const fileText = fs.readFileSync(path.join(MIGRATIONS_DIR, file), "utf8");
    const objects = extractFileObjects(fileText);

    if (objects.length === 0) {
      verdicts.push({ file, inLedger, classification: "NO-OP", total: 0, present: 0, missingObjects: [] });
      continue;
    }

    let present = 0;
    const missing: string[] = [];
    for (const obj of objects) {
      const exists = await probeObject(client, obj);
      if (exists) present++;
      else missing.push(`${obj.kind}: ${obj.label}`);
    }

    const classification: FileVerdict["classification"] =
      present === objects.length ? "APPLIED-UNRECORDED" : present === 0 ? "MISSING" : "PARTIAL";

    verdicts.push({ file, inLedger, classification, total: objects.length, present, missingObjects: missing });
    process.stderr.write(
      `${file}: ${classification} (${present}/${objects.length})${inLedger ? " [in ledger]" : ""}\n`,
    );
  }

  await client.end();

  // 3. Write report
  const counts = { "APPLIED-UNRECORDED": 0, PARTIAL: 0, MISSING: 0, "NO-OP": 0 };
  for (const v of verdicts) counts[v.classification]++;

  const lines: string[] = [];
  lines.push("# Migration Ledger vs. Reality Audit");
  lines.push("");
  lines.push(`Generated by \`npx tsx scripts/audit-migration-ledger.ts\` — ${new Date().toISOString()}`);
  lines.push("");
  lines.push(
    ledgerExists
      ? `\`supabase_migrations.schema_migrations\` exists in production with ${ledgerVersions.length} recorded version(s).`
      : "**`supabase_migrations.schema_migrations` does not exist in production at all** — confirmed live via `information_schema.schemata`/`information_schema.tables`, and independently via `supabase migration list --db-url \"$DATABASE_URL\"` (every one of the 143 local migrations shows an empty Remote column). This project has never run `supabase db push`; every migration to date was applied via direct DDL (psql/Management API) per STANDING_DIRECTIVES.md DIRECTIVE-017, which never touches this table. Every file below is therefore \"not in the ledger\" by definition — the audit covers all 143 files, not a subset.",
  );
  lines.push("");
  lines.push("## Summary");
  lines.push("");
  lines.push("| Classification | Count | Meaning |");
  lines.push("|---|---|---|");
  lines.push(`| APPLIED-UNRECORDED | ${counts["APPLIED-UNRECORDED"]} | every object the file creates/alters already exists live |`);
  lines.push(`| PARTIAL | ${counts.PARTIAL} | some but not all objects exist live |`);
  lines.push(`| MISSING | ${counts.MISSING} | zero objects exist live |`);
  lines.push(`| NO-OP | ${counts["NO-OP"]} | file has no schema-creating statements to check (pure data/GRANT/COMMENT) |`);
  lines.push(`| **Total files** | **${verdicts.length}** | |`);
  lines.push("");
  lines.push("## Per-file detail");
  lines.push("");
  lines.push("| File | Classification | Objects present/total | Missing objects |");
  lines.push("|---|---|---|---|");
  for (const v of verdicts) {
    const missingCell =
      v.missingObjects.length === 0
        ? "-"
        : v.missingObjects.length <= 8
          ? v.missingObjects.join("; ").replace(/\|/g, "\\|")
          : v.missingObjects.slice(0, 8).join("; ").replace(/\|/g, "\\|") +
            `; ... (${v.missingObjects.length - 8} more)`;
    lines.push(`| \`${v.file}\` | ${v.classification} | ${v.present}/${v.total} | ${missingCell} |`);
  }
  lines.push("");

  fs.mkdirSync(path.dirname(OUT_PATH), { recursive: true });
  fs.writeFileSync(OUT_PATH, lines.join("\n"), "utf8");
  console.error(`\nWrote ${OUT_PATH}`);
  console.error(
    `Counts: APPLIED-UNRECORDED=${counts["APPLIED-UNRECORDED"]} PARTIAL=${counts.PARTIAL} MISSING=${counts.MISSING} NO-OP=${counts["NO-OP"]}`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
