// ============================================================================
// BENAVORA — migration idempotency verification harness
//
// Per FEATURE_REGISTRY_v2.md row T6 ("DB Migration Tests — idempotency
// verification per migration"). This repo has two parallel, independently
// numbered migration directories (root `supabase/migrations/` and
// `src/supabase/migrations/`) — which one is actually the live-applied
// source of truth against production is disputed/unresolved per project
// history (see memory `benavora-two-parallel-migrations-directories`). This
// harness does NOT resolve that dispute; it checks both directories' files
// as they exist on disk, since either may end up being the real one.
//
// Two independent checks:
//
// 1. STATIC ANALYSIS (always runs, no DB needed): parses every .sql file's
//    top-level statements (respecting $$-quoted DO/function bodies and
//    string literals so semicolons inside them don't split statements) and
//    classifies each DDL-shaped statement as GUARDED (has the appropriate
//    IF NOT EXISTS / IF EXISTS / ON CONFLICT / OR REPLACE / DROP-then-CREATE
//    idempotency guard for its statement type) or NOT GUARDED (re-running it
//    against a database that already has the change applied would error).
//    This is real static analysis of the SQL text, not a filename guess.
//
// 2. LIVE SPOT-CHECK (best-effort, requires DATABASE_URL): for a handful of
//    already-applied migrations per directory (confirmed applied via a real
//    query against the live schema, not assumed), re-runs the migration's
//    full SQL inside `BEGIN; ... ROLLBACK;` so nothing is ever committed by
//    this script, and records whether it truly no-ops, fails with a clean
//    "already exists"-class error (expected, non-idempotent but harmless),
//    or fails with something unexpected.
//
// 3. DRY RUN (opt-in via --dry-run, requires DRY_RUN_DATABASE_URL): applies
//    every migration in src/supabase/migrations, in order, against a
//    disposable database — never production — committing each file as it
//    succeeds (so later files see earlier files' real schema state), then
//    immediately re-applies that same file inside BEGIN;...;ROLLBACK; to
//    prove idempotency the same way the live spot-check does. Also scans
//    every file (independent of whether it was actually applied) for
//    destructive statements (DROP TABLE/TYPE/COLUMN, TRUNCATE, DELETE with
//    no WHERE) and checks for a corresponding down-migration. Reports the
//    first migration (in file order) that either fails to apply or is
//    destructive with no down-migration. See DRY_RUN_SETUP_INSTRUCTIONS
//    below for how to provision the disposable database — this script does
//    NOT provision one for you, and it hard-refuses to run if
//    DRY_RUN_DATABASE_URL matches DATABASE_URL (host, project ref, or
//    literal string) by any of three independent checks.
//
// Usage:
//   pnpm check:migrations            # static analysis + live spot-check
//   pnpm check:migrations --no-live  # static analysis only (no DB needed)
//   pnpm check:migrations:dry-run    # dry-run mode only (see above)
//
// Writes MIGRATION_IDEMPOTENCY_AUDIT.md (modes 1+2) or
// MIGRATION_DRY_RUN_REPORT.md (mode 3) at the repo root with full findings.
// ============================================================================

import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import fs from "fs";
import path from "path";
import { Client } from "pg";

const REPO_ROOT = process.cwd();

const DIRECTORIES = [
  { label: "root supabase/migrations/", relPath: "supabase/migrations" },
  { label: "src/supabase/migrations/", relPath: "src/supabase/migrations" },
] as const;

const SPOT_CHECK_TARGET_PER_DIR = 5;
const SPOT_CHECK_SCAN_LIMIT = 40; // how many earliest-numbered files to scan for a confirmed-applied candidate

// ----------------------------------------------------------------------------
// Statement splitting — top-level statements only, respecting string
// literals, line/block comments, and $tag$-quoted bodies (DO blocks,
// function bodies) so semicolons inside them never split a statement.
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

// ----------------------------------------------------------------------------
// Classification
// ----------------------------------------------------------------------------

interface Check {
  type: string;
  guarded: boolean;
  detail: string;
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function stripLeadingComments(stmt: string): string {
  // Strip leading `-- ...` line-comment lines and blank lines so the
  // classifier regexes see the real first keyword.
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

function classifyStatement(rawStmt: string, fileText: string, start: number): Check[] {
  const checks: Check[] = [];
  const head = stripLeadingComments(rawStmt);
  if (!head) return checks;

  let m: RegExpExecArray | null;

  // DO $$ ... $$ blocks — check for a recognized guard idiom inside.
  if (/^DO\s+(?:LANGUAGE\s+\w+\s+)?\$/i.test(head)) {
    const mentionsDDL =
      /CREATE\s+TYPE|ADD\s+CONSTRAINT|CREATE\s+POLICY|CREATE\s+TRIGGER|ALTER\s+TABLE|ADD\s+COLUMN/i.test(head);
    if (!mentionsDDL) return checks;
    const guarded =
      /EXCEPTION\s+WHEN\s+duplicate_(object|column|table)/i.test(head) ||
      /IF\s+NOT\s+EXISTS\s*\(/i.test(head) ||
      /IF\s+EXISTS\s*\(/i.test(head) ||
      /pg_type|pg_constraint|pg_policy|pg_trigger|pg_class|information_schema/i.test(head);
    checks.push({
      type: "DO_BLOCK_DDL",
      guarded,
      detail: head.replace(/\s+/g, " ").slice(0, 90),
    });
    return checks;
  }

  // CREATE TABLE
  if ((m = /^CREATE\s+TABLE\s+(IF\s+NOT\s+EXISTS\s+)?(\S+)/i.exec(head))) {
    checks.push({ type: "CREATE_TABLE", guarded: !!m[1], detail: m[2].replace(/[(,]$/, "") });
    return checks;
  }

  // CREATE EXTENSION
  if ((m = /^CREATE\s+EXTENSION\s+(IF\s+NOT\s+EXISTS\s+)?"?([\w-]+)"?/i.exec(head))) {
    checks.push({ type: "CREATE_EXTENSION", guarded: !!m[1], detail: m[2] });
    return checks;
  }

  // CREATE [UNIQUE] INDEX [CONCURRENTLY] [IF NOT EXISTS]
  if ((m = /^CREATE\s+(?:UNIQUE\s+)?INDEX\s+(?:CONCURRENTLY\s+)?(IF\s+NOT\s+EXISTS\s+)?(\S+)/i.exec(head))) {
    checks.push({ type: "CREATE_INDEX", guarded: !!m[1], detail: m[2] });
    return checks;
  }

  // CREATE POLICY "name" ON table
  if ((m = /^CREATE\s+POLICY\s+"?([^"\s]+)"?\s+ON\s+(\S+)/i.exec(head))) {
    const policyName = m[1];
    const table = m[2].replace(/[;]/g, "");
    const before = fileText.slice(0, start);
    const dropRe = new RegExp(
      `DROP\\s+POLICY\\s+IF\\s+EXISTS\\s+"?${escapeRe(policyName)}"?\\s+ON\\s+${escapeRe(table)}`,
      "i"
    );
    checks.push({ type: "CREATE_POLICY", guarded: dropRe.test(before), detail: `"${policyName}" ON ${table}` });
    return checks;
  }

  // CREATE [OR REPLACE] TRIGGER name ... ON table
  if ((m = /^CREATE\s+(OR\s+REPLACE\s+)?TRIGGER\s+(\S+)[\s\S]*?\bON\s+(\S+)/i.exec(head))) {
    const orReplace = !!m[1];
    const trigName = m[2];
    const table = m[3].replace(/[;]/g, "");
    const before = fileText.slice(0, start);
    const dropRe = new RegExp(
      `DROP\\s+TRIGGER\\s+IF\\s+EXISTS\\s+${escapeRe(trigName)}\\s+ON\\s+${escapeRe(table)}`,
      "i"
    );
    checks.push({
      type: "CREATE_TRIGGER",
      guarded: orReplace || dropRe.test(before),
      detail: `${trigName} ON ${table}`,
    });
    return checks;
  }

  // CREATE TYPE name AS ENUM — only ever reached here (top-level, not inside
  // a DO block, which is handled and returned above), so Postgres has no
  // IF NOT EXISTS for this statement form: always unguarded.
  if ((m = /^CREATE\s+TYPE\s+(\S+)\s+AS\s+ENUM/i.exec(head))) {
    checks.push({ type: "CREATE_TYPE_ENUM", guarded: false, detail: m[1] });
    return checks;
  }

  // ALTER TYPE x ADD VALUE [IF NOT EXISTS] 'y'
  if (/^ALTER\s+TYPE\s+/i.test(head) && /ADD\s+VALUE/i.test(head)) {
    const nm = /^ALTER\s+TYPE\s+(\S+)/i.exec(head);
    checks.push({
      type: "ALTER_TYPE_ADD_VALUE",
      guarded: /ADD\s+VALUE\s+IF\s+NOT\s+EXISTS/i.test(head),
      detail: nm ? nm[1] : head.slice(0, 40),
    });
    return checks;
  }

  // ALTER TABLE [ONLY] table <action[, action...]>
  if ((m = /^ALTER\s+TABLE\s+(?:ONLY\s+)?(\S+)/i.exec(head))) {
    const table = m[1].replace(/[;]/g, "");
    let cm: RegExpExecArray | null;

    const addColRe = /ADD\s+COLUMN\s+(IF\s+NOT\s+EXISTS\s+)?(\S+)/gi;
    while ((cm = addColRe.exec(head))) {
      checks.push({ type: "ALTER_ADD_COLUMN", guarded: !!cm[1], detail: `${table}.${cm[2].replace(/,$/, "")}` });
    }

    const dropColRe = /DROP\s+COLUMN\s+(IF\s+EXISTS\s+)?(\S+)/gi;
    while ((cm = dropColRe.exec(head))) {
      checks.push({ type: "ALTER_DROP_COLUMN", guarded: !!cm[1], detail: `${table}.${cm[2].replace(/,$/, "")}` });
    }

    const renameRe = /RENAME\s+COLUMN\s+(\S+)\s+TO\s+(\S+)/gi;
    while ((cm = renameRe.exec(head))) {
      // Postgres has no guard mechanism for RENAME COLUMN at all — always
      // flagged (a second run either errors "column does not exist" or,
      // worse, silently renames the wrong thing if names collide).
      checks.push({ type: "ALTER_RENAME_COLUMN", guarded: false, detail: `${table}.${cm[1]} -> ${cm[2].replace(/,$/, "")}` });
    }

    const addConRe = /ADD\s+CONSTRAINT\s+(\S+)/gi;
    while ((cm = addConRe.exec(head))) {
      const consName = cm[1];
      const before = fileText.slice(0, start);
      const dropRe = new RegExp(`DROP\\s+CONSTRAINT\\s+IF\\s+EXISTS\\s+${escapeRe(consName)}`, "i");
      checks.push({ type: "ALTER_ADD_CONSTRAINT", guarded: dropRe.test(before), detail: `${table}.${consName}` });
    }

    return checks;
  }

  // INSERT INTO table ...
  if ((m = /^INSERT\s+INTO\s+(\S+)/i.exec(head))) {
    const guarded = /ON\s+CONFLICT/i.test(head) || /WHERE\s+NOT\s+EXISTS/i.test(head);
    checks.push({ type: "INSERT", guarded, detail: m[1] });
    return checks;
  }

  // DROP TABLE|TYPE|INDEX|FUNCTION|TRIGGER|POLICY|VIEW|EXTENSION [IF EXISTS] name
  if ((m = /^DROP\s+(TABLE|TYPE|INDEX|FUNCTION|TRIGGER|POLICY|VIEW|EXTENSION)\s+(IF\s+EXISTS\s+)?(\S+)/i.exec(head))) {
    checks.push({ type: `DROP_${m[1].toUpperCase()}`, guarded: !!m[2], detail: m[3] });
    return checks;
  }

  // CREATE [OR REPLACE] FUNCTION name(...)
  if ((m = /^CREATE\s+(OR\s+REPLACE\s+)?FUNCTION\s+(\S+)/i.exec(head))) {
    checks.push({ type: "CREATE_FUNCTION", guarded: !!m[1], detail: m[2] });
    return checks;
  }

  // CREATE [OR REPLACE] VIEW name
  if ((m = /^CREATE\s+(OR\s+REPLACE\s+)?VIEW\s+(\S+)/i.exec(head))) {
    checks.push({ type: "CREATE_VIEW", guarded: !!m[1], detail: m[2] });
    return checks;
  }

  // Everything else (GRANT/REVOKE, COMMENT ON, ENABLE/DISABLE ROW LEVEL
  // SECURITY, UPDATE/DELETE/SELECT data statements, SET, etc.) is either
  // inherently safe to re-run or out of this harness's DDL-idempotency
  // scope per the task's own explicit list — not checked, not counted.
  return checks;
}

// ----------------------------------------------------------------------------
// Per-file / per-directory analysis
// ----------------------------------------------------------------------------

interface FileResult {
  file: string;
  checks: Check[];
  failing: Check[];
}

interface DirResult {
  label: string;
  dirPath: string;
  files: FileResult[];
}

function analyzeDirectory(label: string, relPath: string): DirResult {
  const dirPath = path.join(REPO_ROOT, relPath);
  const files = fs
    .readdirSync(dirPath)
    .filter((f) => f.endsWith(".sql"))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

  const results: FileResult[] = files.map((file) => {
    const fileText = fs.readFileSync(path.join(dirPath, file), "utf8");
    const stmts = splitStatements(fileText);
    const checks: Check[] = [];
    for (const s of stmts) {
      checks.push(...classifyStatement(s.text, fileText, s.start));
    }
    const failing = checks.filter((c) => !c.guarded);
    return { file, checks, failing };
  });

  return { label, dirPath, files: results };
}

// ----------------------------------------------------------------------------
// Live spot-check
// ----------------------------------------------------------------------------

interface SpotCheckResult {
  file: string;
  confirmedAppliedVia: string;
  outcome: "clean-noop" | "expected-error" | "unexpected-error";
  message: string;
}

interface LiveCheckSummary {
  attempted: boolean;
  skipReason?: string;
  results: Record<string, SpotCheckResult[]>; // by directory label
}

const EXPECTED_ERROR_PATTERN =
  /already exists|duplicate_object|duplicate_column|duplicate_table|already exists as|column .* of relation .* already exists|relation .* already exists|type .* already exists|policy .* already exists|index .* already exists|trigger .* for relation .* already exists|extension .* already exists|constraint .* for relation .* already exists|does not exist/i;

function findPrimaryObject(fileText: string): { kind: "table" | "column" | "type"; a: string; b?: string } | null {
  const stmts = splitStatements(fileText);
  for (const s of stmts) {
    const head = stripLeadingComments(s.text);
    let m: RegExpExecArray | null;
    if ((m = /^CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(\S+)/i.exec(head))) {
      const raw = m[1].replace(/[(,;]$/, "");
      const table = raw.includes(".") ? raw.split(".").pop()! : raw;
      return { kind: "table", a: table };
    }
    if ((m = /^ALTER\s+TABLE\s+(?:ONLY\s+)?(\S+)[\s\S]*?ADD\s+COLUMN\s+(?:IF\s+NOT\s+EXISTS\s+)?(\S+)/i.exec(head))) {
      const tableRaw = m[1].replace(/[;]/g, "");
      const table = tableRaw.includes(".") ? tableRaw.split(".").pop()! : tableRaw;
      const col = m[2].replace(/,$/, "");
      return { kind: "column", a: table, b: col };
    }
    if ((m = /^CREATE\s+TYPE\s+(\S+)\s+AS\s+ENUM/i.exec(head))) {
      return { kind: "type", a: m[1] };
    }
  }
  return null;
}

async function objectExistsLive(client: Client, obj: { kind: "table" | "column" | "type"; a: string; b?: string }): Promise<boolean> {
  if (obj.kind === "table") {
    const r = await client.query("SELECT to_regclass($1) IS NOT NULL AS exists", [`public.${obj.a}`]);
    return !!r.rows[0]?.exists;
  }
  if (obj.kind === "column") {
    const r = await client.query(
      "SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name=$1 AND column_name=$2) AS exists",
      [obj.a, obj.b]
    );
    return !!r.rows[0]?.exists;
  }
  // type
  const r = await client.query("SELECT EXISTS (SELECT 1 FROM pg_type WHERE typname=$1) AS exists", [obj.a]);
  return !!r.rows[0]?.exists;
}

async function runLiveSpotCheck(dirs: { label: string; dirPath: string; files: string[] }[]): Promise<LiveCheckSummary> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    return { attempted: false, skipReason: "DATABASE_URL not set in .env.local", results: {} };
  }

  const client = new Client({ connectionString: databaseUrl, ssl: { rejectUnauthorized: false } });
  try {
    await client.connect();
  } catch (err: any) {
    return { attempted: false, skipReason: `could not connect via DATABASE_URL: ${err?.message ?? err}`, results: {} };
  }

  const results: Record<string, SpotCheckResult[]> = {};

  for (const dir of dirs) {
    const picked: { file: string; via: string }[] = [];
    const scanFiles = dir.files.slice(0, SPOT_CHECK_SCAN_LIMIT);
    for (const file of scanFiles) {
      if (picked.length >= SPOT_CHECK_TARGET_PER_DIR) break;
      const fileText = fs.readFileSync(path.join(dir.dirPath, file), "utf8");
      const primary = findPrimaryObject(fileText);
      if (!primary) continue;
      let exists = false;
      try {
        exists = await objectExistsLive(client, primary);
      } catch {
        continue;
      }
      if (exists) {
        const via =
          primary.kind === "table"
            ? `table public.${primary.a} exists`
            : primary.kind === "column"
            ? `column ${primary.a}.${primary.b} exists`
            : `enum type ${primary.a} exists`;
        picked.push({ file, via });
      }
    }

    const dirResults: SpotCheckResult[] = [];
    for (const { file, via } of picked) {
      const fileText = fs.readFileSync(path.join(dir.dirPath, file), "utf8");
      let outcome: SpotCheckResult["outcome"] = "clean-noop";
      let message = "re-ran with no error (fully idempotent on this data)";
      try {
        await client.query("BEGIN");
        await client.query(fileText);
        // No error thrown — fully idempotent re-run.
      } catch (err: any) {
        const msg: string = err?.message ?? String(err);
        if (EXPECTED_ERROR_PATTERN.test(msg)) {
          outcome = "expected-error";
          message = msg;
        } else {
          outcome = "unexpected-error";
          message = msg;
        }
      } finally {
        try {
          await client.query("ROLLBACK");
        } catch {
          // ignore — connection may already be out of a failed transaction state; ROLLBACK still clears it
        }
      }
      dirResults.push({ file, confirmedAppliedVia: via, outcome, message });
    }
    results[dir.label] = dirResults;
  }

  await client.end();
  return { attempted: true, results };
}

// ----------------------------------------------------------------------------
// Dry run — full apply + idempotency verification against a disposable DB
//
// Scope: src/supabase/migrations only, per this mode's own spec — this is
// deliberately narrower than the two-directory static analysis above. A
// bare disposable database only ever sees this one tree's statements, so a
// migration here that ALTERs a table created only in the *other* directory
// (root supabase/migrations/) will legitimately fail to apply. That is not
// a harness bug — it is real, previously-unproven signal about whether
// src/supabase/migrations is self-contained, directly relevant to the
// long-unresolved "which directory is the live one" question (see memory
// `benavora-two-parallel-migrations-directories`). Report it honestly.
// ----------------------------------------------------------------------------

const DRY_RUN_TARGET_RELPATH = "src/supabase/migrations";
const KNOWN_PROD_PROJECT_REF = "vbjplpquqxxfbpazyalt"; // benavora production Supabase project ref (STANDING_DIRECTIVES.md DIRECTIVE-017) — hardcoded as an independent third safety check, not just diffing against DATABASE_URL

const DRY_RUN_SETUP_INSTRUCTIONS = `
DRY_RUN_DATABASE_URL is not set. This mode refuses to fall back to
DATABASE_URL (production) under any circumstances — you must point it at a
disposable database yourself. Two supported paths:

  PATH A — Supabase disposable branch (preferred; mirrors production schema
  history, matches the intended production path for this check):
    1. Via the Supabase MCP tools (not from this script — MCP tools are only
       reachable from the agent/chat session, not a standalone Node process):
         get_cost(type: "branch", organization_id: <org id>)
         confirm_cost(type: "branch", amount: <amount>, recurrence: <...>)
         create_branch(project_id: "${KNOWN_PROD_PROJECT_REF}", name: "migration-dry-run", confirm_cost_id: <id>)
       This is a real, billed resource — get explicit user confirmation of
       the cost before calling create_branch, every time.
    2. Read the branch's own Postgres connection string (its project_id is
       DIFFERENT from "${KNOWN_PROD_PROJECT_REF}" — that's what makes it safe).
    3. $env:DRY_RUN_DATABASE_URL = "<branch connection string>"   (PowerShell)
       or: export DRY_RUN_DATABASE_URL="<branch connection string>"   (bash)
    4. pnpm check:migrations:dry-run
    5. delete_branch(branch_id: <branch id>) to tear down when done.

  PATH B — local Postgres instance (fallback when a branch can't be created
  in this environment — no MCP tool permission, no billing consent, etc.):
    Using a native local install (what this repo's own session used,
    via "scoop install postgresql" on Windows — any local Postgres 14+
    works identically):
       initdb -D <data-dir> -U postgres -A trust -E UTF8
       pg_ctl -D <data-dir> -l <log-file> -o "-p 55432" -w start
       psql -h 127.0.0.1 -p 55432 -U postgres -c "CREATE DATABASE benavora_dryrun"
    Or via Docker, if available and running:
       docker run --name benavora-dryrun-pg -e POSTGRES_PASSWORD=postgres -p 55432:5432 -d postgres:16
       docker exec benavora-dryrun-pg psql -U postgres -c "CREATE DATABASE benavora_dryrun"
    Then either way:
       $env:DRY_RUN_DATABASE_URL = "postgres://postgres@127.0.0.1:55432/benavora_dryrun"   (PowerShell)
       or: export DRY_RUN_DATABASE_URL="postgres://postgres@127.0.0.1:55432/benavora_dryrun"   (bash)
       pnpm check:migrations:dry-run
    Teardown: pg_ctl -D <data-dir> stop   (or: docker rm -f benavora-dryrun-pg)
`.trim();

interface DestructiveFinding {
  type: string;
  detail: string;
}

// Deliberately narrower/simpler than classifyStatement() above — this only
// needs to catch statement shapes that can destroy data or drop objects
// with no corresponding recreation later in the same file. Not a duplicate
// of the idempotency classifier (different question: "is this safe to lose
// forever", not "is this safe to re-run").
function scanDestructiveStatements(fileText: string): DestructiveFinding[] {
  const stmts = splitStatements(fileText);
  const findings: DestructiveFinding[] = [];
  for (const s of stmts) {
    const head = stripLeadingComments(s.text);
    if (!head) continue;
    let m: RegExpExecArray | null;

    if ((m = /^DROP\s+TABLE\s+(?:IF\s+EXISTS\s+)?(\S+)/i.exec(head))) {
      findings.push({ type: "DROP_TABLE", detail: m[1].replace(/[;,]$/, "") });
      continue;
    }
    if ((m = /^DROP\s+TYPE\s+(?:IF\s+EXISTS\s+)?(\S+)/i.exec(head))) {
      findings.push({ type: "DROP_TYPE", detail: m[1].replace(/[;,]$/, "") });
      continue;
    }
    if (/^TRUNCATE\b/i.test(head)) {
      findings.push({ type: "TRUNCATE", detail: head.replace(/\s+/g, " ").slice(0, 80) });
      continue;
    }
    if ((m = /^DELETE\s+FROM\s+(\S+)/i.exec(head))) {
      if (!/\bWHERE\b/i.test(head)) {
        findings.push({ type: "DELETE_NO_WHERE", detail: m[1].replace(/[;,]$/, "") });
      }
      continue;
    }
    if ((m = /^ALTER\s+TABLE\s+(?:ONLY\s+)?(\S+)/i.exec(head))) {
      const table = m[1].replace(/[;]/g, "");
      const dropColRe = /DROP\s+COLUMN\s+(?:IF\s+EXISTS\s+)?(\S+)/gi;
      let cm: RegExpExecArray | null;
      while ((cm = dropColRe.exec(head))) {
        findings.push({ type: "ALTER_DROP_COLUMN", detail: `${table}.${cm[1].replace(/,$/, "")}` });
      }
    }
  }
  return findings;
}

// No down-migration convention exists anywhere in this repo today (confirmed
// by repo-wide search of both migration directories before writing this
// harness) — so every candidate naming pattern below is checked for
// forward-compatibility with a convention this repo might adopt later, not
// because one is expected to match today. Expect this to report "no down
// migration" for every destructive statement found until that changes.
function hasDownMigration(dirPath: string, file: string, fileText: string): boolean {
  const base = file.replace(/\.sql$/i, "");
  const candidates = [`${base}.down.sql`, `${base}_down.sql`, `down_${file}`, `${base}.rollback.sql`];
  for (const c of candidates) {
    if (fs.existsSync(path.join(dirPath, c))) return true;
  }
  if (/--\s*(migrate:down|Down:|DOWN MIGRATION)/i.test(fileText)) return true;
  return false;
}

function parseConnectionIdentity(urlStr: string): { host: string; ref: string | null } | null {
  try {
    const u = new URL(urlStr);
    const host = u.hostname;
    let ref: string | null = null;
    const direct = /^db\.([a-z0-9]+)\.supabase\.co$/i.exec(host);
    if (direct) ref = direct[1];
    const poolerUser = /^postgres\.([a-z0-9]+)$/i.exec(decodeURIComponent(u.username || ""));
    if (poolerUser) ref = poolerUser[1];
    return { host, ref };
  } catch {
    return null;
  }
}

// Three independent checks, any one of which aborts: literal string match,
// parsed host match, and parsed Supabase project-ref match (covers both the
// direct db.<ref>.supabase.co host form and the pooler's postgres.<ref>
// username form) — plus a fourth, hardcoded-constant check against the
// known production ref so this still catches the production target even if
// DATABASE_URL itself is unset or altered in this process's environment.
function guardDryRunTargetIsSafe(dryRunUrl: string): void {
  const prodUrl = process.env.DATABASE_URL;
  if (prodUrl && dryRunUrl.trim() === prodUrl.trim()) {
    throw new Error(
      "REFUSING TO RUN: DRY_RUN_DATABASE_URL is identical to DATABASE_URL (production). This harness must never run against production."
    );
  }
  const dryId = parseConnectionIdentity(dryRunUrl);
  const prodId = prodUrl ? parseConnectionIdentity(prodUrl) : null;
  if (dryId?.ref && prodId?.ref && dryId.ref === prodId.ref) {
    throw new Error(
      `REFUSING TO RUN: DRY_RUN_DATABASE_URL resolves to the same Supabase project ref (${dryId.ref}) as DATABASE_URL (production).`
    );
  }
  if (dryId?.host && prodId?.host && dryId.host === prodId.host) {
    throw new Error(
      `REFUSING TO RUN: DRY_RUN_DATABASE_URL host (${dryId.host}) matches DATABASE_URL host (production).`
    );
  }
  if (dryId?.ref === KNOWN_PROD_PROJECT_REF) {
    throw new Error(
      `REFUSING TO RUN: DRY_RUN_DATABASE_URL resolves to the known Benavora production project ref (${KNOWN_PROD_PROJECT_REF}).`
    );
  }
}

interface DryRunFileResult {
  file: string;
  applyOutcome: "applied" | "apply-failed" | "skipped-after-earlier-failure";
  applyError?: string;
  reapplyOutcome: "idempotent" | "non-idempotent-expected" | "non-idempotent-unexpected" | "not-tested";
  reapplyMessage?: string;
  destructive: DestructiveFinding[];
  hasDownMigration: boolean;
}

interface DryRunSummary {
  mode: "supabase-branch" | "local-postgres" | "unknown";
  targetHost: string;
  totalFiles: number;
  files: DryRunFileResult[];
  firstBlocking: { file: string; reason: "apply-failed" | "destructive-without-down"; detail: string } | null;
}

async function runDryRun(): Promise<DryRunSummary> {
  const dryRunUrl = process.env.DRY_RUN_DATABASE_URL;
  if (!dryRunUrl) {
    throw new Error(DRY_RUN_SETUP_INSTRUCTIONS);
  }
  guardDryRunTargetIsSafe(dryRunUrl);

  const identity = parseConnectionIdentity(dryRunUrl);
  const mode: DryRunSummary["mode"] =
    identity?.host?.includes("supabase.co") || identity?.host?.includes("pooler.supabase.com")
      ? "supabase-branch"
      : identity?.host
      ? "local-postgres"
      : "unknown";

  const dirPath = path.join(REPO_ROOT, DRY_RUN_TARGET_RELPATH);
  const files = fs
    .readdirSync(dirPath)
    .filter((f) => f.endsWith(".sql"))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

  const client = new Client({
    connectionString: dryRunUrl,
    ssl: mode === "supabase-branch" ? { rejectUnauthorized: false } : undefined,
  });
  await client.connect();

  const results: DryRunFileResult[] = [];
  let stopApplying = false;
  let firstBlocking: DryRunSummary["firstBlocking"] = null;

  try {
    for (const file of files) {
      const fileText = fs.readFileSync(path.join(dirPath, file), "utf8");
      const destructive = scanDestructiveStatements(fileText);
      const downExists = destructive.length === 0 || hasDownMigration(dirPath, file, fileText);

      if (!firstBlocking && destructive.length > 0 && !downExists) {
        firstBlocking = {
          file,
          reason: "destructive-without-down",
          detail: destructive.map((d) => `${d.type}: ${d.detail}`).join("; "),
        };
      }

      if (stopApplying) {
        results.push({
          file,
          applyOutcome: "skipped-after-earlier-failure",
          reapplyOutcome: "not-tested",
          destructive,
          hasDownMigration: downExists,
        });
        continue;
      }

      let applyOutcome: DryRunFileResult["applyOutcome"] = "applied";
      let applyError: string | undefined;
      try {
        await client.query(fileText);
      } catch (err: any) {
        applyOutcome = "apply-failed";
        applyError = err?.message ?? String(err);
        stopApplying = true;
        if (!firstBlocking) {
          firstBlocking = { file, reason: "apply-failed", detail: applyError };
        }
      }

      let reapplyOutcome: DryRunFileResult["reapplyOutcome"] = "not-tested";
      let reapplyMessage: string | undefined;
      if (applyOutcome === "applied") {
        try {
          await client.query("BEGIN");
          await client.query(fileText);
          reapplyOutcome = "idempotent";
          reapplyMessage = "re-ran with no error (fully idempotent on this data)";
        } catch (err: any) {
          const msg: string = err?.message ?? String(err);
          reapplyOutcome = EXPECTED_ERROR_PATTERN.test(msg) ? "non-idempotent-expected" : "non-idempotent-unexpected";
          reapplyMessage = msg;
        } finally {
          try {
            await client.query("ROLLBACK");
          } catch {
            // ignore — ROLLBACK still clears a failed-transaction state
          }
        }
      }

      results.push({ file, applyOutcome, applyError, reapplyOutcome, reapplyMessage, destructive, hasDownMigration: downExists });
    }
  } finally {
    await client.end();
  }

  return {
    mode,
    targetHost: identity?.host ?? "(unparsable)",
    totalFiles: files.length,
    files: results,
    firstBlocking,
  };
}

function buildDryRunReport(summary: DryRunSummary): string {
  const now = new Date().toISOString().slice(0, 10);
  let out = `# MIGRATION_DRY_RUN_REPORT.md\n\n`;
  out += `Generated by \`scripts/check-migration-idempotency.ts --dry-run\` (\`pnpm check:migrations:dry-run\`). Real full apply of every migration in \`${DRY_RUN_TARGET_RELPATH}\`, in order, against a disposable database (never production — see the three independent safety checks in \`guardDryRunTargetIsSafe()\`), followed immediately by a \`BEGIN; ... ROLLBACK;\` re-apply of the same file to prove idempotency, plus a static scan of every file for destructive statements lacking a corresponding down-migration.\n\n`;
  out += `Last run: ${now}\n\n`;
  out += `Target: ${summary.mode} (\`${summary.targetHost}\`)\n\n---\n\n`;

  out += `## Result\n\n`;
  if (summary.firstBlocking) {
    out += `**First blocking migration: \`${summary.firstBlocking.file}\`** — ${summary.firstBlocking.reason}\n\n`;
    out += `\`\`\`\n${summary.firstBlocking.detail.slice(0, 1000)}\n\`\`\`\n\n`;
    if (summary.firstBlocking.reason === "apply-failed") {
      out += `All files from \`${summary.firstBlocking.file}\` onward were skipped (not applied) since later migrations in this directory may depend on this one's schema changes having actually landed.\n\n`;
    }
  } else {
    out += `No blocking issues found — every migration applied cleanly in order, and every destructive statement found (if any) has a corresponding down-migration.\n\n`;
  }

  const applied = summary.files.filter((f) => f.applyOutcome === "applied").length;
  const failed = summary.files.filter((f) => f.applyOutcome === "apply-failed").length;
  const skipped = summary.files.filter((f) => f.applyOutcome === "skipped-after-earlier-failure").length;
  const idempotent = summary.files.filter((f) => f.reapplyOutcome === "idempotent").length;
  const nonIdempotentExpected = summary.files.filter((f) => f.reapplyOutcome === "non-idempotent-expected").length;
  const nonIdempotentUnexpected = summary.files.filter((f) => f.reapplyOutcome === "non-idempotent-unexpected").length;
  const destructiveNoDown = summary.files.filter((f) => f.destructive.length > 0 && !f.hasDownMigration).length;

  out += `## Summary\n\n`;
  out += `| Metric | Count |\n|---|---|\n`;
  out += `| Total files in ${DRY_RUN_TARGET_RELPATH} | ${summary.totalFiles} |\n`;
  out += `| Applied cleanly | ${applied} |\n`;
  out += `| Failed to apply | ${failed} |\n`;
  out += `| Skipped (after earlier failure) | ${skipped} |\n`;
  out += `| Confirmed idempotent on re-apply | ${idempotent} |\n`;
  out += `| Non-idempotent, expected "already exists"-class error | ${nonIdempotentExpected} |\n`;
  out += `| Non-idempotent, **unexpected** error on re-apply | ${nonIdempotentUnexpected} |\n`;
  out += `| Files with a destructive statement and NO down-migration | ${destructiveNoDown} |\n\n`;

  out += `---\n\n## Per-file detail\n\n`;
  out += `| File | Apply | Re-apply (idempotency) | Destructive statements | Down-migration? |\n|---|---|---|---|---|\n`;
  for (const f of summary.files) {
    const applyBadge =
      f.applyOutcome === "applied" ? "✅ applied" : f.applyOutcome === "apply-failed" ? "🔴 FAILED" : "⏭️ skipped";
    const reapplyBadge =
      f.reapplyOutcome === "idempotent"
        ? "✅ idempotent"
        : f.reapplyOutcome === "non-idempotent-expected"
        ? "⚠️ non-idempotent (expected)"
        : f.reapplyOutcome === "non-idempotent-unexpected"
        ? "🔴 non-idempotent (UNEXPECTED)"
        : "—";
    const destructiveText =
      f.destructive.length === 0 ? "—" : f.destructive.map((d) => `\`${d.type}\`: ${d.detail}`).join("<br>");
    const downText = f.destructive.length === 0 ? "n/a" : f.hasDownMigration ? "✅ yes" : "🔴 NO";
    out += `| ${f.file} | ${applyBadge} | ${reapplyBadge} | ${destructiveText} | ${downText} |\n`;
  }
  out += `\n`;

  const errored = summary.files.filter((f) => f.applyError || f.reapplyOutcome === "non-idempotent-unexpected");
  if (errored.length > 0) {
    out += `---\n\n## Error detail\n\n`;
    for (const f of errored) {
      out += `**${f.file}**\n\n`;
      if (f.applyError) {
        out += `Apply error:\n\`\`\`\n${f.applyError.slice(0, 800)}\n\`\`\`\n\n`;
      }
      if (f.reapplyOutcome === "non-idempotent-unexpected" && f.reapplyMessage) {
        out += `Unexpected re-apply error:\n\`\`\`\n${f.reapplyMessage.slice(0, 800)}\n\`\`\`\n\n`;
      }
    }
  }

  out += `---\n\n## Methodology notes\n\n`;
  out += `- Scope is deliberately \`${DRY_RUN_TARGET_RELPATH}\` only, not both migration directories — a migration here that depends on a table/type created only in the root \`supabase/migrations/\` tree will legitimately fail to apply against a bare disposable database. That is real signal about this tree's self-containedness, not a harness defect — see the note at the top of this script's "Dry run" section.\n`;
  out += `- "Applied cleanly" commits each file for real (not wrapped in a throwaway transaction) so later files see earlier files' actual schema changes, matching how these migrations would really be replayed in order.\n`;
  out += `- The idempotency re-apply immediately follows each successful apply, wrapped in \`BEGIN; ... ROLLBACK;\` so the re-apply attempt never actually double-commits.\n`;
  out += `- Destructive-statement detection (DROP TABLE/TYPE, ALTER TABLE DROP COLUMN, TRUNCATE, DELETE with no WHERE) is a static text scan of every file's top-level statements, run independent of whether that file was actually applied this pass — so it still covers files skipped after an earlier failure.\n`;
  out += `- No down-migration convention exists anywhere in this repo as of when this harness was written — expect every destructive statement found to report "NO" down-migration until one is adopted.\n`;
  out += `- This run's disposable database is never torn down by this script — see \`DRY_RUN_SETUP_INSTRUCTIONS\` (printed when \`DRY_RUN_DATABASE_URL\` is unset) for the matching teardown command for whichever setup path was used.\n`;

  return out;
}

function buildDryRunAbortedReport(message: string): string {
  const now = new Date().toISOString().slice(0, 10);
  return (
    `# MIGRATION_DRY_RUN_REPORT.md\n\n` +
    `Generated by \`scripts/check-migration-idempotency.ts --dry-run\` (\`pnpm check:migrations:dry-run\`).\n\n` +
    `Last run: ${now}\n\n---\n\n` +
    `## Aborted before any migration was applied\n\n\`\`\`\n${message}\n\`\`\`\n`
  );
}

// ----------------------------------------------------------------------------
// Report generation
// ----------------------------------------------------------------------------

function typeBreakdown(files: FileResult[]): Record<string, { pass: number; fail: number }> {
  const byType: Record<string, { pass: number; fail: number }> = {};
  for (const f of files) {
    for (const c of f.checks) {
      byType[c.type] ??= { pass: 0, fail: 0 };
      if (c.guarded) byType[c.type].pass++;
      else byType[c.type].fail++;
    }
  }
  return byType;
}

function buildReport(dirResults: DirResult[], live: LiveCheckSummary): string {
  const now = new Date().toISOString().slice(0, 10);
  let out = `# MIGRATION_IDEMPOTENCY_AUDIT.md\n\n`;
  out += `Generated by \`scripts/check-migration-idempotency.ts\` (\`pnpm check:migrations\`). Real static analysis of every migration file's top-level SQL statements in both migration directories, plus a best-effort live re-run spot-check against production wrapped in \`BEGIN; ... ROLLBACK;\` (nothing is ever committed by this harness).\n\n`;
  out += `Per project history, which of the two directories below is the actual live-applied source of truth against production is disputed/unresolved — this audit deliberately does not resolve that; it covers both as they exist on disk, since either may end up being the real one. See memory \`benavora-two-parallel-migrations-directories\`.\n\n`;
  out += `Static analysis and the live spot-check below never mutate anything (spot-checks are wrapped in \`BEGIN; ... ROLLBACK;\`). A separate, opt-in **dry-run mode** (\`pnpm check:migrations:dry-run\`) actually applies every migration in \`src/supabase/migrations\` against a disposable database (never production) and reports the first one that fails or is destructive with no down-migration — see \`MIGRATION_DRY_RUN_REPORT.md\` if that mode has been run.\n\n`;
  out += `Last run: ${now}\n\n---\n\n`;

  out += `## Summary\n\n`;
  out += `| Directory | Files checked | Files fully idempotent | Files with ≥1 non-idempotent statement | Total DDL statements classified | Non-idempotent statements found |\n`;
  out += `|---|---|---|---|---|---|\n`;
  for (const d of dirResults) {
    const totalChecks = d.files.reduce((n, f) => n + f.checks.length, 0);
    const totalFail = d.files.reduce((n, f) => n + f.failing.length, 0);
    const passFiles = d.files.filter((f) => f.failing.length === 0).length;
    const failFiles = d.files.filter((f) => f.failing.length > 0).length;
    out += `| ${d.label} | ${d.files.length} | ${passFiles} | ${failFiles} | ${totalChecks} | ${totalFail} |\n`;
  }
  out += `\n"Fully idempotent" means every classifiable DDL statement in the file (CREATE TABLE, ADD COLUMN, CREATE INDEX, CREATE POLICY, CREATE TYPE, ALTER TYPE ADD VALUE, ADD CONSTRAINT, CREATE TRIGGER, INSERT, DROP *, RENAME COLUMN, CREATE FUNCTION/VIEW) carries the guard appropriate to its statement type (IF NOT EXISTS / IF EXISTS / ON CONFLICT / OR REPLACE / a prior DROP ... IF EXISTS of the same name). Files with zero classifiable statements (pure data-fix UPDATE/SELECT/GRANT/COMMENT files) count as "fully idempotent" vacuously — there was nothing DDL-shaped to check.\n\n`;

  out += `---\n\n## Per-directory statement-type breakdown\n\n`;
  for (const d of dirResults) {
    out += `### ${d.label}\n\n`;
    const bt = typeBreakdown(d.files);
    const types = Object.keys(bt).sort();
    if (types.length === 0) {
      out += `No classifiable DDL statements found.\n\n`;
      continue;
    }
    out += `| Statement type | Guarded (pass) | Unguarded (fail) |\n|---|---|---|\n`;
    for (const t of types) {
      out += `| ${t} | ${bt[t].pass} | ${bt[t].fail} |\n`;
    }
    out += `\n`;
  }

  out += `---\n\n## Files with non-idempotent statements\n\n`;
  for (const d of dirResults) {
    out += `### ${d.label}\n\n`;
    const failing = d.files.filter((f) => f.failing.length > 0);
    if (failing.length === 0) {
      out += `None — every classifiable statement in every file carries an appropriate guard.\n\n`;
      continue;
    }
    for (const f of failing) {
      out += `**${f.file}** — ${f.failing.length} non-idempotent statement(s):\n`;
      for (const c of f.failing) {
        out += `- \`${c.type}\`: ${c.detail}\n`;
      }
      out += `\n`;
    }
  }

  out += `---\n\n## Live re-run spot-check\n\n`;
  if (!live.attempted) {
    out += `**Not run this pass.** ${live.skipReason ?? "unknown reason"}.\n\n`;
  } else {
    out += `For each directory, up to ${SPOT_CHECK_TARGET_PER_DIR} migrations were selected by scanning the earliest-numbered ${SPOT_CHECK_SCAN_LIMIT} files and confirming — via a real live query against the production schema (\`DATABASE_URL\`, per STANDING_DIRECTIVES.md DIRECTIVE-017) — that the migration's primary object (its first \`CREATE TABLE\`, first \`ADD COLUMN\`, or first \`CREATE TYPE ... AS ENUM\`) genuinely already exists live. Each confirmed-applied migration's full SQL was then re-executed inside \`BEGIN; ... ROLLBACK;\` — nothing was committed by this run regardless of outcome.\n\n`;
    out += `| Directory | Result |\n|---|---|\n`;
    for (const [label, results] of Object.entries(live.results)) {
      const clean = results.filter((r) => r.outcome === "clean-noop").length;
      const expected = results.filter((r) => r.outcome === "expected-error").length;
      const unexpected = results.filter((r) => r.outcome === "unexpected-error").length;
      out += `| ${label} | ${results.length} tested — ${clean} clean no-op, ${expected} expected "already exists"-class error, ${unexpected} unexpected error |\n`;
    }
    out += `\n`;
    for (const [label, results] of Object.entries(live.results)) {
      out += `### ${label}\n\n`;
      if (results.length === 0) {
        out += `No already-applied migration with a determinable primary object was found in the first ${SPOT_CHECK_SCAN_LIMIT} files of this directory.\n\n`;
        continue;
      }
      for (const r of results) {
        const badge =
          r.outcome === "clean-noop" ? "✅ clean no-op" : r.outcome === "expected-error" ? "⚠️ expected error (non-idempotent, harmless)" : "🔴 UNEXPECTED ERROR";
        out += `**${r.file}** — confirmed applied via: ${r.confirmedAppliedVia}\n`;
        out += `${badge}\n`;
        out += `\`\`\`\n${r.message.slice(0, 500)}\n\`\`\`\n\n`;
      }
    }
  }

  out += `---\n\n## Methodology notes\n\n`;
  out += `- Static analysis parses each file's top-level SQL statements with a real tokenizer that tracks single-quoted string literals, \`--\` line comments, \`/* */\` block comments, and \`$tag$\`-quoted bodies (DO blocks, function bodies) so semicolons inside them never incorrectly split a statement.\n`;
  out += `- \`CREATE POLICY\`/\`CREATE TRIGGER\`/\`ADD CONSTRAINT\` are considered guarded if the file contains a matching \`DROP POLICY IF EXISTS\` / \`DROP TRIGGER IF EXISTS\` / \`DROP CONSTRAINT IF EXISTS\` of the same name earlier in the same file (the idiom already used elsewhere in this repo, e.g. migration 128) — not just a bare \`CREATE ...\`.\n`;
  out += `- \`CREATE TYPE ... AS ENUM\` at the top level (outside a \`DO $$ ... EXCEPTION WHEN duplicate_object ...\` block) is always flagged non-idempotent — Postgres has no \`IF NOT EXISTS\` for this statement form at all.\n`;
  out += `- \`ALTER TABLE ... RENAME COLUMN\` is always flagged non-idempotent — Postgres has no guard mechanism for it under any syntax.\n`;
  out += `- \`GRANT\`/\`REVOKE\`/\`COMMENT ON\`/\`ENABLE|DISABLE ROW LEVEL SECURITY\`/plain \`UPDATE\`/\`SELECT\`/\`SET\` statements are not classified — they are either inherently safe to re-run or outside this harness's DDL-idempotency scope.\n`;
  out += `- This is heuristic regex-based static analysis of real SQL text, not a full SQL parser — it can misclassify unusual formatting it hasn't been calibrated against. Treat findings as a strong signal, not a proof.\n`;

  return out;
}

// ----------------------------------------------------------------------------
// Main
// ----------------------------------------------------------------------------

async function main() {
  const noLive = process.argv.includes("--no-live");
  const dryRun = process.argv.includes("--dry-run");

  if (dryRun) {
    console.log(`Migration dry-run — full apply + idempotency verification (${DRY_RUN_TARGET_RELPATH})\n`);
    const outPath = path.join(REPO_ROOT, "MIGRATION_DRY_RUN_REPORT.md");
    let summary: DryRunSummary;
    try {
      summary = await runDryRun();
    } catch (err: any) {
      const message: string = err?.message ?? String(err);
      console.error(`\nDRY RUN ABORTED:\n${message}\n`);
      fs.writeFileSync(outPath, buildDryRunAbortedReport(message), "utf8");
      console.log(`Wrote ${outPath}`);
      process.exit(1);
    }

    for (const f of summary.files) {
      const destructiveFlag = f.destructive.length > 0 && !f.hasDownMigration ? " ⚠️ DESTRUCTIVE, NO DOWN MIGRATION" : "";
      console.log(`  ${f.file}: apply=${f.applyOutcome} reapply=${f.reapplyOutcome}${destructiveFlag}`);
    }
    if (summary.firstBlocking) {
      console.log(`\nFIRST BLOCKING MIGRATION: ${summary.firstBlocking.file} (${summary.firstBlocking.reason})`);
    } else {
      console.log("\nNo blocking issues found.");
    }

    fs.writeFileSync(outPath, buildDryRunReport(summary), "utf8");
    console.log(`\nWrote ${outPath}`);
    return;
  }

  console.log("Migration idempotency check — static analysis\n");

  const dirResults: DirResult[] = DIRECTORIES.map((d) => analyzeDirectory(d.label, d.relPath));

  for (const d of dirResults) {
    const totalChecks = d.files.reduce((n, f) => n + f.checks.length, 0);
    const totalFail = d.files.reduce((n, f) => n + f.failing.length, 0);
    const passFiles = d.files.filter((f) => f.failing.length === 0).length;
    console.log(
      `${d.label}: ${d.files.length} files, ${totalChecks} DDL statements classified, ${totalFail} non-idempotent, ${passFiles}/${d.files.length} files fully clean`
    );
  }

  let live: LiveCheckSummary = { attempted: false, skipReason: "--no-live passed", results: {} };
  if (!noLive) {
    console.log("\nLive spot-check — connecting via DATABASE_URL...");
    live = await runLiveSpotCheck(
      dirResults.map((d) => ({ label: d.label, dirPath: d.dirPath, files: d.files.map((f) => f.file) }))
    );
    if (!live.attempted) {
      console.log(`Live spot-check skipped: ${live.skipReason}`);
    } else {
      for (const [label, results] of Object.entries(live.results)) {
        console.log(`  ${label}: ${results.length} migrations re-run live (transaction rolled back)`);
        for (const r of results) {
          console.log(`    - ${r.file}: ${r.outcome}`);
        }
      }
    }
  }

  const report = buildReport(dirResults, live);
  const outPath = path.join(REPO_ROOT, "MIGRATION_IDEMPOTENCY_AUDIT.md");
  fs.writeFileSync(outPath, report, "utf8");
  console.log(`\nWrote ${outPath}`);
}

main().catch((err) => {
  console.error("FATAL:", err);
  process.exit(1);
});
