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
// Usage:
//   pnpm check:migrations            # static analysis + live spot-check
//   pnpm check:migrations --no-live  # static analysis only (no DB needed)
//
// Writes MIGRATION_IDEMPOTENCY_AUDIT.md at the repo root with full findings.
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
