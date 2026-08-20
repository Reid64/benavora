// PT-06: cross-reference the live schema (test-evidence/pt-06/live-schema.json)
// against every .from("table") query chain and every typed table interface in
// the codebase. Finds (a) tables the code/types reference that don't exist
// live, and (b) column names referenced on tables that DO exist live but
// don't have that column (the org_id/organization_id class of bug).
//
// Heuristic, not a full TS/JS parser -- built to catch string-literal table
// and column references reliably; dynamic (variable) table/column names are
// skipped since they can't be resolved statically.

import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const SCAN_DIRS = ["src", "worker"];
const EXCLUDE_DIR_NAMES = new Set([
  "node_modules",
  ".next",
  "dist",
  "out",
  "coverage",
  ".git",
]);
const FILE_EXTS = new Set([".ts", ".tsx"]);

const COLUMN_ARG_METHODS = new Set([
  "eq",
  "neq",
  "gt",
  "gte",
  "lt",
  "lte",
  "like",
  "ilike",
  "is",
  "in",
  "contains",
  "containedBy",
  "overlaps",
  "textSearch",
  "not",
  "order",
]);
const OBJECT_KEY_METHODS = new Set(["insert", "update", "upsert", "match"]);

// receivers whose `.from(...)` call has nothing to do with Supabase's
// PostgREST query builder (Buffer.from, Array.from, etc.) -- must be
// excluded or they pollute the missing-tables list with garbage.
const NON_SUPABASE_FROM_RECEIVERS = new Set([
  "Buffer",
  "Array",
  "Object",
  "String",
  "Number",
  "Date",
  "Promise",
  "RegExp",
  "Symbol",
  "Uint8Array",
  "Int8Array",
  "Uint16Array",
  "Int16Array",
  "Uint32Array",
  "Int32Array",
  "Float32Array",
  "Float64Array",
  "BigInt64Array",
  "BigUint64Array",
  "Uint8ClampedArray",
]);

// ---------- live schema ----------

const liveSchemaPath = path.join(ROOT, "test-evidence", "pt-06", "live-schema.json");
const liveSchema = JSON.parse(fs.readFileSync(liveSchemaPath, "utf8"));
const liveTables = new Map(); // tableName -> Set(columnName)
for (const [tableName, def] of Object.entries(liveSchema.tables)) {
  liveTables.set(tableName, new Set(def.columns.map((c) => c.column_name)));
}

// ---------- file walking ----------

function walk(dir, files) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.name.startsWith(".")) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (EXCLUDE_DIR_NAMES.has(entry.name)) continue;
      walk(full, files);
    } else if (entry.isFile()) {
      const ext = path.extname(entry.name);
      if (FILE_EXTS.has(ext)) files.push(full);
    }
  }
}

const allFiles = [];
for (const d of SCAN_DIRS) walk(path.join(ROOT, d), allFiles);

// ---------- balanced-paren / string-aware scanner ----------

function findMatchingBracket(s, openIdx) {
  const open = s[openIdx];
  const close = open === "(" ? ")" : open === "{" ? "}" : "]";
  let depth = 0;
  let i = openIdx;
  const n = s.length;
  while (i < n) {
    const ch = s[i];
    if (ch === "'" || ch === '"' || ch === "`") {
      const quote = ch;
      i++;
      while (i < n) {
        if (s[i] === "\\") {
          i += 2;
          continue;
        }
        if (s[i] === quote) {
          i++;
          break;
        }
        i++;
      }
      continue;
    }
    if (ch === "/" && s[i + 1] === "/") {
      while (i < n && s[i] !== "\n") i++;
      continue;
    }
    if (ch === "/" && s[i + 1] === "*") {
      i += 2;
      while (i < n && !(s[i] === "*" && s[i + 1] === "/")) i++;
      i += 2;
      continue;
    }
    if (ch === "(" || ch === "{" || ch === "[") {
      depth++;
      i++;
      continue;
    }
    if (ch === ")" || ch === "}" || ch === "]") {
      depth--;
      if (depth === 0) return i;
      i++;
      continue;
    }
    i++;
  }
  return -1;
}

// Marks every index that falls inside a // or /* */ comment (string
// literals are respected so a "//" inside a string isn't mistaken for a
// comment start). Used to filter out .from("table") occurrences that only
// appear in prose/comments, not real executed code.
function buildCommentMask(source) {
  const n = source.length;
  const mask = new Uint8Array(n);
  let i = 0;
  while (i < n) {
    const ch = source[i];
    if (ch === "'" || ch === '"' || ch === "`") {
      const quote = ch;
      i++;
      while (i < n) {
        if (source[i] === "\\") {
          i += 2;
          continue;
        }
        if (source[i] === quote) {
          i++;
          break;
        }
        i++;
      }
      continue;
    }
    if (ch === "/" && source[i + 1] === "/") {
      const start = i;
      while (i < n && source[i] !== "\n") i++;
      mask.fill(1, start, i);
      continue;
    }
    if (ch === "/" && source[i + 1] === "*") {
      const start = i;
      i += 2;
      while (i < n && !(source[i] === "*" && source[i + 1] === "/")) i++;
      i += 2;
      mask.fill(1, start, i);
      continue;
    }
    i++;
  }
  return mask;
}

function lineNumberAt(source, idx) {
  let line = 1;
  for (let i = 0; i < idx && i < source.length; i++) {
    if (source[i] === "\n") line++;
  }
  return line;
}

function extractStringLiteral(s) {
  const m = s.match(/^\s*["'`]([^"'`]*)["'`]/);
  return m ? m[1] : null;
}

// Split a select() column-list string on top-level commas (respecting
// parens for embedded joins like "opportunities(title)").
function splitTopLevel(str) {
  const parts = [];
  let depth = 0;
  let cur = "";
  for (const ch of str) {
    if (ch === "(" || ch === "[") depth++;
    else if (ch === ")" || ch === "]") depth--;
    if (ch === "," && depth === 0) {
      parts.push(cur);
      cur = "";
    } else {
      cur += ch;
    }
  }
  if (cur.trim()) parts.push(cur);
  return parts;
}

function parseSelectColumns(selectStr) {
  const cols = [];
  for (let token of splitTopLevel(selectStr)) {
    token = token.trim();
    if (!token) continue;
    if (token === "*") continue;
    if (token.includes("(")) {
      // embedded resource / join spec, e.g. "opportunities(name,amount)" or
      // "alias:opportunities(name)" -- skip; not a column of this table.
      continue;
    }
    if (token.includes("::")) token = token.split("::")[0].trim();
    if (token.includes(":")) {
      const parts = token.split(":");
      token = parts[parts.length - 1].trim();
    }
    if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(token)) continue;
    if (token === "count") continue;
    cols.push(token);
  }
  return cols;
}

// State-machine object-key extractor. Only treats "identifier:" as a real
// object key when it appears at a property-boundary position (right after
// "{"/"[" or right after a top-level ","); after capturing a key it skips
// the ENTIRE value expression up to the next top-level comma before looking
// for the next key -- this is what avoids misreading a colon inside a
// ternary value (e.g. `status: cond ? "a" : "b"`) as a second property.
function extractObjectKeys(argsStr) {
  const trimmed = argsStr.trimStart();
  // only resolve an inline object/array literal payload -- if the first
  // argument is a bare variable (e.g. `.upsert(data, { onConflict: "x" })`),
  // there's nothing to statically extract, and blindly grabbing the FIRST
  // "{" anywhere in argsStr would wrongly pick up a later options object.
  if (!(trimmed.startsWith("{") || trimmed.startsWith("["))) return [];
  const braceIdx = argsStr.indexOf(trimmed[0] === "{" ? "{" : "[");
  const isArray = argsStr[braceIdx] === "[";
  let objBraceIdx = braceIdx;
  if (isArray) {
    // find the first "{" inside the array (the first row object), must be
    // reachable without crossing a comma first (i.e. must be argsStr[braceIdx+1..] starts with "{" after whitespace)
    let j = braceIdx + 1;
    while (j < argsStr.length && /\s/.test(argsStr[j])) j++;
    if (argsStr[j] !== "{") return [];
    objBraceIdx = j;
  }
  const closeIdx = findMatchingBracket(argsStr, objBraceIdx);
  if (closeIdx === -1) return [];
  const body = argsStr.slice(objBraceIdx + 1, closeIdx);
  const keys = [];
  const n = body.length;
  let i = 0;

  function skipWs() {
    while (i < n) {
      if (/\s/.test(body[i])) {
        i++;
        continue;
      }
      if (body[i] === "/" && body[i + 1] === "/") {
        while (i < n && body[i] !== "\n") i++;
        continue;
      }
      if (body[i] === "/" && body[i + 1] === "*") {
        i += 2;
        while (i < n && !(body[i] === "*" && body[i + 1] === "/")) i++;
        i += 2;
        continue;
      }
      break;
    }
  }

  // Skip a value expression up to (and past) the next top-level comma, or
  // to end of body -- respects strings and nested brackets so a colon or
  // comma inside a ternary/nested-object/array value is never mistaken for
  // a property boundary of THIS object.
  function skipValue() {
    let depth = 0;
    while (i < n) {
      const ch = body[i];
      if (ch === "'" || ch === '"' || ch === "`") {
        const q = ch;
        i++;
        while (i < n) {
          if (body[i] === "\\") {
            i += 2;
            continue;
          }
          if (body[i] === q) {
            i++;
            break;
          }
          i++;
        }
        continue;
      }
      if (ch === "/" && body[i + 1] === "/") {
        while (i < n && body[i] !== "\n") i++;
        continue;
      }
      if (ch === "/" && body[i + 1] === "*") {
        i += 2;
        while (i < n && !(body[i] === "*" && body[i + 1] === "/")) i++;
        i += 2;
        continue;
      }
      if (ch === "{" || ch === "[" || ch === "(") {
        depth++;
        i++;
        continue;
      }
      if (ch === "}" || ch === "]" || ch === ")") {
        depth--;
        i++;
        continue;
      }
      if (ch === "," && depth === 0) {
        i++;
        return;
      }
      i++;
    }
  }

  let guard = 0;
  while (i < n && guard < 5000) {
    guard++;
    skipWs();
    if (i >= n) break;
    const rest = body.slice(i);

    if (rest.startsWith("...")) {
      i += 3;
      skipValue();
      continue;
    }

    const keyMatch = /^([a-zA-Z_][a-zA-Z0-9_]*)\s*:/.exec(rest);
    if (keyMatch) {
      keys.push(keyMatch[1]);
      i += keyMatch[0].length;
      skipValue();
      continue;
    }
    const quotedKeyMatch = /^["']([a-zA-Z_][a-zA-Z0-9_]*)["']\s*:/.exec(rest);
    if (quotedKeyMatch) {
      keys.push(quotedKeyMatch[1]);
      i += quotedKeyMatch[0].length;
      skipValue();
      continue;
    }
    // shorthand property: identifier followed directly by "," or end (no colon)
    const shorthandMatch = /^([a-zA-Z_][a-zA-Z0-9_]*)\s*(,|$)/.exec(rest);
    if (shorthandMatch) {
      keys.push(shorthandMatch[1]);
      i += shorthandMatch[1].length;
      skipValue();
      continue;
    }
    // computed key [expr]: value -- skip, can't statically resolve
    if (rest[0] === "[") {
      const closeB = findMatchingBracket(body, i);
      if (closeB === -1) break;
      i = closeB + 1;
      skipWs();
      if (body[i] === ":") {
        i++;
        skipValue();
      }
      continue;
    }
    // unrecognized token at a property-boundary position -- resync
    skipValue();
  }
  return keys;
}

// Returns true if `.from(` at `idx` in `source` is preceded by a receiver
// that means this is NOT a Supabase table query (Buffer.from, Array.from,
// supabase.storage.from, etc).
function isNonTableFromCall(source, idx) {
  const windowStart = Math.max(0, idx - 80);
  const before = source.slice(windowStart, idx);
  // supabase.storage.from("bucket") / client.storage\n  .from("bucket")
  if (/\.storage\s*$/.test(before)) return true;
  const receiverMatch = /([A-Za-z_$][A-Za-z0-9_$]*)\s*$/.exec(before);
  if (receiverMatch && NON_SUPABASE_FROM_RECEIVERS.has(receiverMatch[1])) return true;
  return false;
}

// ---------- main scan ----------

const references = []; // { table, column, method, file, line, snippet }
const dynamicTableSkips = { count: 0 };
const nonTableFromSkips = { count: 0 };

for (const file of allFiles) {
  const rel = path.relative(ROOT, file).replace(/\\/g, "/");
  const isTest = rel.includes("__tests__") || rel.includes(".test.");
  let source;
  try {
    source = fs.readFileSync(file, "utf8");
  } catch {
    continue;
  }

  const commentMask = buildCommentMask(source);
  const fromRe = /\.from\(/g;
  let m;
  while ((m = fromRe.exec(source))) {
    if (commentMask[m.index]) continue; // .from( only appears inside a comment
    if (isNonTableFromCall(source, m.index)) {
      nonTableFromSkips.count++;
      continue;
    }

    const openParenIdx = m.index + m[0].length - 1;
    const closeParenIdx = findMatchingBracket(source, openParenIdx);
    if (closeParenIdx === -1) continue;
    const fromArgsRaw = source.slice(openParenIdx + 1, closeParenIdx);
    const table = extractStringLiteral(fromArgsRaw);
    if (!table) {
      dynamicTableSkips.count++;
      continue; // dynamic table reference, can't resolve statically
    }

    const line = lineNumberAt(source, m.index);
    references.push({
      table,
      column: null,
      method: "from",
      file: rel,
      line,
      isTest,
      snippet: source.slice(Math.max(0, m.index - 5), m.index + 40).replace(/\s+/g, " ").trim(),
    });

    // Walk the chained calls that follow .from("table")...
    let pos = closeParenIdx + 1;
    let chainSteps = 0;
    while (chainSteps < 40) {
      while (pos < source.length) {
        if (/\s/.test(source[pos])) {
          pos++;
          continue;
        }
        if (source[pos] === "/" && source[pos + 1] === "/") {
          while (pos < source.length && source[pos] !== "\n") pos++;
          continue;
        }
        if (source[pos] === "/" && source[pos + 1] === "*") {
          pos += 2;
          while (pos < source.length && !(source[pos] === "*" && source[pos + 1] === "/")) pos++;
          pos += 2;
          continue;
        }
        break;
      }
      if (source[pos] !== ".") break;
      const methodMatch = /^\.([a-zA-Z_][a-zA-Z0-9_]*)\(/.exec(source.slice(pos));
      if (!methodMatch) break;
      const methodName = methodMatch[1];
      const methodOpenIdx = pos + methodMatch[0].length - 1;
      const methodCloseIdx = findMatchingBracket(source, methodOpenIdx);
      if (methodCloseIdx === -1) break;
      const methodArgs = source.slice(methodOpenIdx + 1, methodCloseIdx);
      const methodLine = lineNumberAt(source, pos);

      if (methodName === "select") {
        const selectStr = extractStringLiteral(methodArgs);
        if (selectStr) {
          for (const col of parseSelectColumns(selectStr)) {
            references.push({
              table,
              column: col,
              method: "select",
              file: rel,
              line: methodLine,
              isTest,
              snippet: `.select("${selectStr.slice(0, 80)}")`,
            });
          }
        }
      } else if (COLUMN_ARG_METHODS.has(methodName)) {
        const colStr = extractStringLiteral(methodArgs);
        if (colStr && /^[a-zA-Z_][a-zA-Z0-9_.]*$/.test(colStr)) {
          const baseCol = colStr.split(".")[0];
          references.push({
            table,
            column: baseCol,
            method: methodName,
            file: rel,
            line: methodLine,
            isTest,
            snippet: `.${methodName}("${colStr}", ...)`,
          });
        }
      } else if (OBJECT_KEY_METHODS.has(methodName)) {
        const keys = extractObjectKeys(methodArgs);
        for (const key of keys) {
          references.push({
            table,
            column: key,
            method: methodName,
            file: rel,
            line: methodLine,
            isTest,
            snippet: `.${methodName}({ ${key}: ... })`,
          });
        }
      }

      pos = methodCloseIdx + 1;
      chainSteps++;
    }
  }
}

// ---------- typed interface extraction (src/types/database.ts) ----------

const typedRefs = []; // { table, column, file, line }
const typesFile = path.join(ROOT, "src", "types", "database.ts");
if (fs.existsSync(typesFile)) {
  const source = fs.readFileSync(typesFile, "utf8");
  const lines = source.split("\n");
  let currentTable = null;
  let inRow = false;
  let rowBraceDepth = 0;
  for (let i = 0; i < lines.length; i++) {
    const lineText = lines[i];
    const tableMatch = /^      ([a-zA-Z_][a-zA-Z0-9_]*): \{$/.exec(lineText);
    if (tableMatch) {
      currentTable = tableMatch[1];
      inRow = false;
      continue;
    }
    if (currentTable && /^        Row: \{$/.test(lineText)) {
      inRow = true;
      rowBraceDepth = 1;
      continue;
    }
    if (inRow) {
      for (const ch of lineText) {
        if (ch === "{") rowBraceDepth++;
        if (ch === "}") rowBraceDepth--;
      }
      const colMatch = /^\s{10}([a-zA-Z_][a-zA-Z0-9_]*)\??:/.exec(lineText);
      if (colMatch) {
        typedRefs.push({ table: currentTable, column: colMatch[1], file: "src/types/database.ts", line: i + 1 });
      }
      if (rowBraceDepth <= 0) {
        inRow = false;
      }
    }
  }
}

// ---------- cross-reference ----------

function buildFindings(refs, sourceLabel) {
  const missingTablesMap = new Map();
  const columnMismatchMap = new Map();

  for (const ref of refs) {
    if (ref.method === "from") continue;
    if (!liveTables.has(ref.table)) continue;
    if (ref.column === null) continue;
    const cols = liveTables.get(ref.table);
    if (cols.has(ref.column)) continue;
    if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(ref.column)) continue;
    const key = `${ref.table}.${ref.column}`;
    if (!columnMismatchMap.has(key)) {
      columnMismatchMap.set(key, {
        table: ref.table,
        column: ref.column,
        live_columns_for_table: Array.from(cols).sort(),
        source: sourceLabel,
        sites: [],
      });
    }
    columnMismatchMap.get(key).sites.push({
      file: ref.file,
      line: ref.line,
      method: ref.method,
      isTest: ref.isTest ?? false,
      snippet: ref.snippet,
    });
  }

  const seenTables = new Set(refs.map((r) => r.table));
  for (const t of seenTables) {
    if (liveTables.has(t)) continue;
    missingTablesMap.set(t, { table: t, source: sourceLabel, sites: [] });
  }
  for (const ref of refs.filter((r) => r.method === "from")) {
    if (liveTables.has(ref.table)) continue;
    missingTablesMap.get(ref.table).sites.push({
      file: ref.file,
      line: ref.line,
      isTest: ref.isTest ?? false,
      snippet: ref.snippet,
    });
  }

  return {
    missing_tables: Array.from(missingTablesMap.values()).sort((a, b) => a.table.localeCompare(b.table)),
    column_mismatches: Array.from(columnMismatchMap.values()).sort((a, b) =>
      a.table === b.table ? a.column.localeCompare(b.column) : a.table.localeCompare(b.table),
    ),
  };
}

const codeFindings = buildFindings(references, "runtime_query_code");

const typedMissingTables = [];
const typedColumnMismatches = [];
{
  const tableNames = new Set(typedRefs.map((r) => r.table));
  for (const t of tableNames) {
    if (!liveTables.has(t)) {
      typedMissingTables.push({ table: t, source: "typed_interface_database_ts", file: "src/types/database.ts" });
    }
  }
  const byKey = new Map();
  for (const ref of typedRefs) {
    if (!liveTables.has(ref.table)) continue;
    const cols = liveTables.get(ref.table);
    if (cols.has(ref.column)) continue;
    const key = `${ref.table}.${ref.column}`;
    if (!byKey.has(key)) {
      byKey.set(key, {
        table: ref.table,
        column: ref.column,
        live_columns_for_table: Array.from(cols).sort(),
        source: "typed_interface_database_ts",
        sites: [],
      });
    }
    byKey.get(key).sites.push({ file: ref.file, line: ref.line });
  }
  typedColumnMismatches.push(...byKey.values());
}

// confirm the known org_id/organization_id case is present
const orgIdCase = codeFindings.column_mismatches.find(
  (f) => f.table === "discovery_matches" && f.column === "organization_id",
);

const output = {
  generated_at: new Date().toISOString(),
  method:
    'Heuristic static scan of .from("table") query chains (select/eq/neq/gt/gte/lt/lte/like/ilike/is/in/contains/containedBy/overlaps/textSearch/not/order/insert/update/upsert/match) across src/ and worker/ (*.ts, *.tsx), plus src/types/database.ts\'s hand-authored typed table interfaces, cross-referenced against test-evidence/pt-06/live-schema.json (live production information_schema). Dynamic (non-string-literal) table/column references, Buffer.from/Array.from/etc. built-in calls, supabase.storage.from(bucket) calls, and .from( occurrences inside comments are excluded. Object-literal payload keys (insert/update/upsert/match) are extracted with a small state machine that skips each value expression up to its top-level comma, so a colon inside a ternary value is never misread as a second property.',
  files_scanned: allFiles.length,
  dynamic_from_calls_skipped: dynamicTableSkips.count,
  non_table_from_calls_skipped: nonTableFromSkips.count,
  total_from_call_sites: references.filter((r) => r.method === "from").length,
  total_column_references_extracted: references.filter((r) => r.method !== "from").length,
  known_bug_confirmation: {
    description:
      "PT-02 found /api/agents/discovery querying organization_id where the live discovery_matches column is org_id. Re-confirmed here via live schema + static scan, plus its sibling call site in morning-digest.ts.",
    present_in_findings: !!orgIdCase,
    finding: orgIdCase ?? null,
  },
  runtime_query_code: {
    missing_tables: codeFindings.missing_tables,
    column_mismatches: codeFindings.column_mismatches,
  },
  typed_interface_database_ts: {
    tables_referenced: Array.from(new Set(typedRefs.map((r) => r.table))).length,
    missing_tables: typedMissingTables,
    column_mismatches: typedColumnMismatches,
  },
  summary: {
    runtime_missing_tables: codeFindings.missing_tables.length,
    runtime_column_mismatches: codeFindings.column_mismatches.length,
    runtime_column_mismatch_non_test_sites: codeFindings.column_mismatches.reduce(
      (acc, f) => acc + f.sites.filter((s) => !s.isTest).length,
      0,
    ),
    typed_interface_missing_tables: typedMissingTables.length,
    typed_interface_column_mismatches: typedColumnMismatches.length,
  },
};

const outPath = path.join(ROOT, "test-evidence", "pt-06", "schema-mismatch.json");
fs.writeFileSync(outPath, JSON.stringify(output, null, 2));
console.log(
  `Wrote ${outPath}: ${output.summary.runtime_missing_tables} missing tables, ${output.summary.runtime_column_mismatches} column mismatches (${output.summary.runtime_column_mismatch_non_test_sites} non-test call sites), org_id/organization_id case present: ${output.known_bug_confirmation.present_in_findings}`,
);
